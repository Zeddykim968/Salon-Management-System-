"""Booking lifecycle: request, list, cancel, confirm, decline, complete."""
from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from slowapi.extension import Limiter  # type: ignore  # noqa: F401

from .. import db, notify, slots
from ..auth import CurrentUser, require_role
from ..helpers import attach_names, fmt_when, parse_iso_datetime, range_literal
from ..ratelimit import limiter

log = logging.getLogger("api.bookings")

router = APIRouter(prefix="/bookings", tags=["bookings"])


class BookingIn(BaseModel):
    staff_id: str
    service_id: str
    start: str = Field(..., description="ISO-8601 datetime of the slot start")
    notes: str | None = None


def _load(booking_id: str) -> dict:
    row = db.one(db.table("bookings").select("*").eq("id", booking_id).limit(1))
    if row is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    return row


def _owned_by_staff(booking: dict, user: CurrentUser) -> None:
    if str(booking.get("staff_id")) != user.id:
        raise HTTPException(status_code=403, detail="Not your booking")


def _notify_counterparty(booking: dict, kind: str, *, actor: CurrentUser) -> None:
    """Notify the other side of a booking transition (never fails the request)."""
    try:
        enriched = attach_names([booking])[0]
        service_name = enriched["service"]["name"]
        when_label = enriched["when"]
        customer = enriched["customer"]
        staff = enriched["staff"]

        customer_profile = db.get_profile(str(booking["customer_id"])) or {}
        customer_email = db.get_user_email(str(booking["customer_id"]))
        staff_profile = db.get_profile(str(booking["staff_id"])) or {}
        staff_email = db.get_user_email(str(booking["staff_id"]))
        staff_details = db.get_staff_details(str(booking["staff_id"])) or {}

        if kind == "requested":
            notify.notify_booking_requested(
                staff_name=staff.get("full_name") or "Stylist",
                staff_email=staff_email,
                staff_whatsapp=staff_details.get("whatsapp"),
                customer_name=customer.get("full_name") or actor.full_name,
                service_name=service_name,
                when_label=when_label,
            )
        elif kind == "confirmed":
            notify.notify_booking_confirmed(
                customer_name=customer.get("full_name"),
                customer_email=customer_email,
                customer_phone=customer_profile.get("phone"),
                staff_name=staff.get("full_name") or "your stylist",
                service_name=service_name,
                when_label=when_label,
            )
        elif kind in ("declined", "cancelled", "completed"):
            notify.notify_booking_closed(
                kind=kind,
                to_name=customer.get("full_name"),
                to_email=customer_email,
                service_name=service_name,
                when_label=when_label,
                other_name=staff.get("full_name") or "The salon",
            )
            if kind in ("declined", "cancelled"):
                notify.notify_booking_closed(
                    kind=kind,
                    to_name=staff.get("full_name") or "Stylist",
                    to_email=staff_email,
                    service_name=service_name,
                    when_label=when_label,
                    other_name=customer.get("full_name") or "A customer",
                )
    except Exception:  # noqa: BLE001
        log.exception("booking notification failed (%s)", kind)


def _auto_message(sender_id: str, recipient_id: str, body: str) -> None:
    """In-app message that seeds the chat around a booking event."""
    try:
        db.table("messages").insert(
            {"sender_id": sender_id, "recipient_id": recipient_id, "body": body}
        ).execute()
    except Exception:  # noqa: BLE001
        log.exception("auto message insert failed")


# ---------------------------------------------------------------------------
# customer: request a slot (held as pending — the DB excludes double booking)
# ---------------------------------------------------------------------------
@router.post("", status_code=201)
@limiter.limit("10/minute")
def create_booking(
    body: BookingIn,
    request: Request,
    user: CurrentUser = Depends(require_role("customer")),
) -> dict:
    service = db.one(
        db.table("services")
        .select("*")
        .eq("id", body.service_id)
        .eq("active", True)
        .limit(1)
    )
    if service is None:
        raise HTTPException(status_code=404, detail="Service not found")

    staff_profile = db.one(
        db.table("profiles")
        .select("id, full_name, active")
        .eq("id", body.staff_id)
        .eq("active", True)
        .limit(1)
    )
    if staff_profile is None or staff_profile.get("role") not in (
        "salonist",
        "nail_tech",
        "admin",
    ):
        raise HTTPException(status_code=404, detail="Stylist not found")

    try:
        start = parse_iso_datetime(body.start)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid start datetime") from exc

    duration = int(service.get("duration_min") or 60)
    end = start + timedelta(minutes=duration)

    # friendly pre-check — the exclusion constraint is the real guard
    free, reason = slots.slot_is_free(str(body.staff_id), start, end)
    if not free:
        raise HTTPException(status_code=409, detail=reason)

    row = {
        "customer_id": user.id,
        "staff_id": str(body.staff_id),
        "service_id": str(body.service_id),
        "during": range_literal(start, end),
        "status": "pending",
        "notes": (body.notes or "").strip()[:1000] or None,
    }
    try:
        created = db.one(db.table("bookings").insert(row).select("*").limit(1))
    except Exception as exc:  # noqa: BLE001
        message = str(exc).lower()
        if "conflict" in message or "exclusion" in message or "overlap" in message:
            raise HTTPException(status_code=409, detail="That slot was just taken") from exc
        raise

    if created is None:
        raise HTTPException(status_code=409, detail="That slot was just taken")

    db.log_activity(
        user.id,
        "booking.create",
        {
            "booking_id": str(created.get("id")),
            "staff_id": str(body.staff_id),
            "service": service.get("name"),
            "start": start.isoformat(),
        },
    )

    when_label = fmt_when(start, end)
    _auto_message(
        user.id,
        str(body.staff_id),
        f"📅 Booking request: {service.get('name')} on {when_label}. "
        "Let's confirm the details here — or on WhatsApp!",
    )
    _notify_counterparty(created, "requested", actor=user)

    return attach_names([created])[0]


# ---------------------------------------------------------------------------
# customer: own bookings
# ---------------------------------------------------------------------------
@router.get("/mine")
def my_bookings(
    user: CurrentUser = Depends(require_role("customer")),
    limit: int = 100,
) -> list[dict]:
    rows = db.rows(
        db.table("bookings")
        .select("*")
        .eq("customer_id", user.id)
        .order("created_at", desc=True)
        .limit(min(limit, 300))
    )
    return attach_names(rows)


@router.patch("/{booking_id}/cancel")
def cancel_booking(
    booking_id: str,
    user: CurrentUser = Depends(require_role("customer")),
) -> dict:
    booking = _load(booking_id)
    if str(booking.get("customer_id")) != user.id:
        raise HTTPException(status_code=403, detail="Not your booking")
    if booking.get("status") not in ("pending", "confirmed"):
        raise HTTPException(status_code=409, detail=f"Cannot cancel {booking.get('status')}")

    updated = db.one(
        db.table("bookings")
        .update({"status": "cancelled"})
        .eq("id", booking_id)
        .select("*")
        .limit(1)
    ) or {**booking, "status": "cancelled"}

    db.log_activity(user.id, "booking.cancel", {"booking_id": booking_id})

    enriched = attach_names([updated])[0]
    _auto_message(
        user.id,
        str(booking["staff_id"]),
        f"I've cancelled my {enriched['service']['name']} booking on {enriched['when']}. "
        "Sorry for the change!",
    )
    _notify_counterparty(updated, "cancelled", actor=user)
    return enriched


# ---------------------------------------------------------------------------
# staff: state transitions
# ---------------------------------------------------------------------------
def _transition(
    booking_id: str,
    user: CurrentUser,
    *,
    allowed_from: tuple[str, ...],
    new_status: str,
) -> dict:
    booking = _load(booking_id)
    _owned_by_staff(booking, user)
    if booking.get("status") not in allowed_from:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot move a {booking.get('status')} booking to {new_status}",
        )
    updated = db.one(
        db.table("bookings")
        .update({"status": new_status})
        .eq("id", booking_id)
        .select("*")
        .limit(1)
    ) or {**booking, "status": new_status}
    return updated


@router.patch("/{booking_id}/confirm")
def confirm_booking(
    booking_id: str,
    user: CurrentUser = Depends(require_role("salonist", "nail_tech", "admin")),
) -> dict:
    updated = _transition(
        booking_id, user, allowed_from=("pending",), new_status="confirmed"
    )
    db.log_activity(user.id, "booking.confirm", {"booking_id": booking_id})

    enriched = attach_names([updated])[0]
    _auto_message(
        user.id,
        str(updated["customer_id"]),
        f"✅ Confirmed! Your {enriched['service']['name']} is set for "
        f"{enriched['when']}. See you there 💇‍♀️",
    )
    _notify_counterparty(updated, "confirmed", actor=user)
    return enriched


@router.patch("/{booking_id}/decline")
def decline_booking(
    booking_id: str,
    user: CurrentUser = Depends(require_role("salonist", "nail_tech", "admin")),
) -> dict:
    updated = _transition(
        booking_id, user, allowed_from=("pending",), new_status="declined"
    )
    db.log_activity(user.id, "booking.decline", {"booking_id": booking_id})

    enriched = attach_names([updated])[0]
    _auto_message(
        user.id,
        str(updated["customer_id"]),
        f"Unfortunately I can't make {enriched['when']} work — the booking was "
        "declined. Pick another slot and I'll be ready! 💛",
    )
    _notify_counterparty(updated, "declined", actor=user)
    return enriched


@router.patch("/{booking_id}/complete")
def complete_booking(
    booking_id: str,
    user: CurrentUser = Depends(require_role("salonist", "nail_tech", "admin")),
) -> dict:
    updated = _transition(
        booking_id, user, allowed_from=("confirmed",), new_status="completed"
    )
    db.log_activity(user.id, "booking.complete", {"booking_id": booking_id})
    enriched = attach_names([updated])[0]
    _notify_counterparty(updated, "completed", actor=user)
    return enriched
