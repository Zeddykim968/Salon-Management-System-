"""Admin endpoints: staff invites, site images, gallery moderation, activity,
campaigns (Resend email / WhatsApp Cloud API)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from .. import db, notify
from ..auth import CurrentUser, require_role
from ..helpers import fetch_profiles_map
from ..ratelimit import limiter

log = logging.getLogger("api.admin")

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[])

ADMIN_ONLY = require_role("admin")
STAFF_ROLES = ("salonist", "nail_tech", "admin")
SITE_ASSET_KEYS = ("hero", "banner_1", "banner_2")

IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
}


class InviteIn(BaseModel):
    email: str = Field(..., max_length=254)
    full_name: str = Field(..., min_length=1, max_length=120)
    role: str  # salonist | nail_tech


class StaffPatch(BaseModel):
    role: str | None = None
    active: bool | None = None
    full_name: str | None = None


class GalleryPatch(BaseModel):
    approved: bool


class CampaignIn(BaseModel):
    channel: str  # email | whatsapp
    subject: str | None = Field(None, max_length=200)
    body: str = Field(..., min_length=1, max_length=5000)
    audience: str = "all_customers"  # all_customers | staff


def _require_admin(user: CurrentUser = ADMIN_ONLY) -> CurrentUser:
    return user


# ---------------------------------------------------------------------------
# overview
# ---------------------------------------------------------------------------
@router.get("/overview")
def overview(user: CurrentUser = ADMIN_ONLY) -> dict:
    def fetch(table: str, **filters) -> list[dict]:
        q = db.table(table).select("*").limit(5000)
        for key, value in filters.items():
            q = q.eq(key.rstrip("_"), value)
        return db.rows(q)

    profiles = fetch("profiles")
    bookings = fetch("bookings")
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    staff_count = sum(1 for p in profiles if p.get("role") in STAFF_ROLES)
    customers = [p for p in profiles if p.get("role") == "customer"]

    pending = sum(1 for b in bookings if b.get("status") == "pending")
    confirmed = sum(1 for b in bookings if b.get("status") == "confirmed")

    today_bookings = 0
    for booking in bookings:
        try:
            from ..helpers import parse_range

            start, _end = parse_range(booking.get("during"))
            if start >= today_start:
                today_bookings += 1
        except (ValueError, TypeError):
            continue

    return {
        "customers": len(customers),
        "staff": staff_count,
        "pending_bookings": pending,
        "confirmed_bookings": confirmed,
        "today_bookings": today_bookings,
        "total_bookings": len(bookings),
    }


# ---------------------------------------------------------------------------
# staff management
# ---------------------------------------------------------------------------
@router.get("/staff")
def list_staff(user: CurrentUser = ADMIN_ONLY) -> list[dict]:
    profiles = db.rows(
        db.table("profiles")
        .select("*")
        .in_("role", list(STAFF_ROLES))
        .order("created_at", desc=True)
        .limit(200)
    )
    details = {
        str(row["staff_id"]): row
        for row in db.rows(
            db.table("staff_details").select("*").in_(
                "staff_id", [str(p["id"]) for p in profiles]
            )
        )
    } if profiles else {}

    bookings = db.rows(
        db.table("bookings").select("staff_id, status").limit(5000)
    )
    stats: dict[str, dict] = {}
    for booking in bookings:
        sid = str(booking.get("staff_id"))
        entry = stats.setdefault(sid, {"total": 0, "pending": 0, "confirmed": 0})
        entry["total"] += 1
        if booking.get("status") in ("pending", "confirmed"):
            entry[booking["status"]] = entry.get(booking["status"], 0) + 1

    out = []
    for profile in profiles:
        pid = str(profile["id"])
        info = details.get(pid, {})
        out.append(
            {
                "id": pid,
                "full_name": profile.get("full_name", ""),
                "email": db.get_user_email(pid),
                "role": profile.get("role"),
                "active": profile.get("active", True),
                "phone": profile.get("phone"),
                "avatar_url": profile.get("avatar_url"),
                "created_at": profile.get("created_at"),
                "status": info.get("status", "available"),
                "whatsapp": info.get("whatsapp"),
                "stats": stats.get(pid, {"total": 0, "pending": 0, "confirmed": 0}),
            }
        )
    return out


@router.post("/staff/invite", status_code=201)
def invite_staff(
    body: InviteIn,
    user: CurrentUser = ADMIN_ONLY,
) -> dict:
    email = body.email.strip().lower()
    if "@" not in email or " " in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if body.role not in ("salonist", "nail_tech"):
        raise HTTPException(status_code=400, detail="role must be salonist or nail_tech")

    client = db.get_client()

    # reject duplicates when the API supports it; otherwise GoTrue errors out
    try:
        existing = client.auth.admin.get_user_by_email(email)
        if existing:
            raise HTTPException(status_code=409, detail="That email is already registered")
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — endpoint absent on some versions
        pass

    try:
        result = client.auth.admin.invite_user_by_email(
            email,
            options={
                "data": {"full_name": body.full_name.strip(), "role": body.role},
                "email_redirect_to": f"{settings_redirect_base()}/auth/callback?next=/set-password",
            },
        )
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if "already" in message.lower() or "exists" in message.lower():
            raise HTTPException(status_code=409, detail="That email is already registered") from exc
        log.exception("invite failed")
        raise HTTPException(status_code=502, detail=f"Invite failed: {message}") from exc

    user_id = _extract_user_id(result)
    if not user_id:
        raise HTTPException(status_code=502, detail="Invite returned no user id")

    # the signup trigger created a customer profile; promote it to staff
    db.table("profiles").upsert(
        {
            "id": user_id,
            "full_name": body.full_name.strip()[:120],
            "role": body.role,
            "active": True,
        },
        on_conflict="id",
    ).execute()

    db.table("staff_details").upsert(
        {"staff_id": user_id, "status": "available"}, on_conflict="staff_id"
    ).execute()

    _seed_services(user_id, body.role)
    _seed_working_hours(user_id)

    db.log_activity(
        user.id,
        "staff.invite",
        {"email": email, "role": body.role, "staff_id": user_id},
    )
    return {
        "id": user_id,
        "email": email,
        "full_name": body.full_name.strip(),
        "role": body.role,
        "active": True,
        "invited": True,
    }


@router.patch("/staff/{staff_id}")
def update_staff(
    staff_id: str,
    body: StaffPatch,
    user: CurrentUser = ADMIN_ONLY,
) -> dict:
    profile = db.get_profile(staff_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Staff member not found")

    patch: dict = {}
    if body.role is not None:
        if body.role not in (*STAFF_ROLES, "customer"):
            raise HTTPException(status_code=400, detail="Unknown role")
        if staff_id == user.id and body.role != "admin":
            raise HTTPException(status_code=400, detail="You cannot demote yourself")
        patch["role"] = body.role
    if body.active is not None:
        if staff_id == user.id and not body.active:
            raise HTTPException(status_code=400, detail="You cannot deactivate yourself")
        patch["active"] = body.active
    if body.full_name is not None:
        name = body.full_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        patch["full_name"] = name[:120]

    if patch:
        db.table("profiles").update(patch).eq("id", staff_id).execute()
        if patch.get("role") in STAFF_ROLES:
            db.table("staff_details").upsert(
                {"staff_id": staff_id, "status": "available"},
                on_conflict="staff_id",
            ).execute()
        db.log_activity(user.id, "staff.update", {"staff_id": staff_id, **patch})

    fresh = db.get_profile(staff_id) or profile
    return {
        "id": staff_id,
        "full_name": fresh.get("full_name", ""),
        "role": fresh.get("role"),
        "active": fresh.get("active", True),
    }


@router.get("/customers")
def list_customers(user: CurrentUser = ADMIN_ONLY) -> list[dict]:
    customers = db.rows(
        db.table("profiles")
        .select("*")
        .eq("role", "customer")
        .order("created_at", desc=True)
        .limit(1000)
    )
    bookings = db.rows(db.table("bookings").select("customer_id, status").limit(5000))
    counts: dict[str, int] = {}
    for booking in bookings:
        cid = str(booking.get("customer_id"))
        counts[cid] = counts.get(cid, 0) + 1

    out = []
    for profile in customers:
        pid = str(profile["id"])
        out.append(
            {
                "id": pid,
                "full_name": profile.get("full_name", "") or "Customer",
                "email": db.get_user_email(pid),
                "phone": profile.get("phone"),
                "avatar_url": profile.get("avatar_url"),
                "marketing_opt_in": profile.get("marketing_opt_in", True),
                "active": profile.get("active", True),
                "bookings": counts.get(pid, 0),
                "created_at": profile.get("created_at"),
            }
        )
    return out


# ---------------------------------------------------------------------------
# site images (hero, banners)
# ---------------------------------------------------------------------------
@router.put("/site-assets/{key}")
async def set_site_asset(
    key: str,
    file: UploadFile = File(...),
    user: CurrentUser = ADMIN_ONLY,
) -> dict:
    if key not in SITE_ASSET_KEYS:
        raise HTTPException(status_code=400, detail=f"key must be one of {SITE_ASSET_KEYS}")
    ctype = (file.content_type or "").lower()
    if ctype not in IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Only JPEG/PNG/WebP/GIF/AVIF images")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image larger than 8 MB")

    path = f"assets/{key}{IMAGE_TYPES[ctype]}"
    url = db.storage_upload("site", path, data, ctype)
    db.table("site_assets").upsert(
        {
            "key": key,
            "image_url": url,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="key",
    ).execute()
    db.log_activity(user.id, "site.asset_update", {"key": key})
    return {"key": key, "image_url": url}


# ---------------------------------------------------------------------------
# gallery moderation
# ---------------------------------------------------------------------------
@router.get("/gallery")
def admin_gallery(user: CurrentUser = ADMIN_ONLY) -> list[dict]:
    rows = db.rows(
        db.table("gallery").select("*").order("created_at", desc=True).limit(500)
    )
    profiles = fetch_profiles_map(row.get("staff_id") for row in rows)
    return [
        {
            **row,
            "staff_name": profiles.get(str(row.get("staff_id")), {}).get("full_name", ""),
        }
        for row in rows
    ]


@router.patch("/gallery/{photo_id}")
def moderate_gallery(
    photo_id: str,
    body: GalleryPatch,
    user: CurrentUser = ADMIN_ONLY,
) -> dict:
    updated = db.one(
        db.table("gallery")
        .update({"approved": bool(body.approved)})
        .eq("id", photo_id)
        .select("*")
        .limit(1)
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    db.log_activity(
        user.id, "gallery.moderate", {"photo_id": photo_id, "approved": body.approved}
    )
    return updated


@router.delete("/gallery/{photo_id}", status_code=204)
def delete_gallery(photo_id: str, user: CurrentUser = ADMIN_ONLY) -> None:
    row = db.one(db.table("gallery").select("*").eq("id", photo_id).limit(1))
    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    db.storage_delete("gallery", str(row.get("image_url", "")))
    db.table("gallery").delete().eq("id", photo_id).execute()
    db.log_activity(user.id, "gallery.delete", {"photo_id": photo_id})


# ---------------------------------------------------------------------------
# activity feed
# ---------------------------------------------------------------------------
@router.get("/activity")
def activity(
    limit: int = 100,
    user: CurrentUser = ADMIN_ONLY,
) -> list[dict]:
    rows = db.rows(
        db.table("activity_log")
        .select("*")
        .order("created_at", desc=True)
        .limit(min(limit, 500))
    )
    profiles = fetch_profiles_map(row.get("actor_id") for row in rows)
    return [
        {
            **row,
            "actor_name": profiles.get(str(row.get("actor_id")), {}).get(
                "full_name", "System"
            ),
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# campaigns: offers by email (Resend) / WhatsApp (approved template)
# ---------------------------------------------------------------------------
@router.get("/campaigns")
def list_campaigns(user: CurrentUser = ADMIN_ONLY) -> list[dict]:
    rows = db.rows(
        db.table("campaigns").select("*").order("created_at", desc=True).limit(200)
    )
    profiles = fetch_profiles_map(row.get("created_by") for row in rows)
    return [
        {
            **row,
            "created_by_name": profiles.get(str(row.get("created_by")), {}).get(
                "full_name", "Admin"
            ),
        }
        for row in rows
    ]


@router.post("/campaigns", status_code=201)
@limiter.limit("5/minute")
def send_campaign(
    body: CampaignIn,
    request: Request,
    user: CurrentUser = ADMIN_ONLY,
) -> dict:
    channel = body.channel.lower().strip()
    if channel not in ("email", "whatsapp"):
        raise HTTPException(status_code=400, detail="channel must be email or whatsapp")
    audience = body.audience.strip() or "all_customers"
    if audience not in ("all_customers", "staff"):
        raise HTTPException(status_code=400, detail="audience must be all_customers or staff")

    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message body cannot be empty")

    recipients = _campaign_recipients(audience)
    attempted = sent = 0
    subject = (body.subject or "").strip()

    for recipient in recipients:
        attempted += 1
        if channel == "email":
            email = recipient.get("email")
            if not email:
                attempted -= 1  # nothing to send to
                continue
            ok = notify.send_campaign_email(email, subject or "Special offer 🎉", text)
        else:
            phone = recipient.get("whatsapp") or recipient.get("phone")
            ok = notify.send_campaign_whatsapp(phone, text, subject)
        if ok:
            sent += 1

    db.table("campaigns").insert(
        {
            "created_by": user.id,
            "channel": channel,
            "subject": subject or None,
            "body": text,
            "audience": audience,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }
    ).execute()
    db.log_activity(
        user.id,
        "campaign.send",
        {"channel": channel, "audience": audience, "attempted": attempted, "sent": sent},
    )
    return {"channel": channel, "audience": audience, "attempted": attempted, "sent": sent}


def _campaign_recipients(audience: str) -> list[dict]:
    if audience == "staff":
        profiles = db.rows(
            db.table("profiles")
            .select("id, full_name, phone, active")
            .in_("role", list(STAFF_ROLES))
            .eq("active", True)
            .limit(200)
        )
        details = {
            str(row["staff_id"]): row
            for row in db.rows(
                db.table("staff_details").select("staff_id, whatsapp")
            )
        }
        out = []
        for profile in profiles:
            pid = str(profile["id"])
            out.append(
                {
                    "email": db.get_user_email(pid),
                    "phone": profile.get("phone"),
                    "whatsapp": details.get(pid, {}).get("whatsapp"),
                }
            )
        return out

    # only marketing opt-in customers, per the README
    profiles = db.rows(
        db.table("profiles")
        .select("id, full_name, phone")
        .eq("role", "customer")
        .eq("active", True)
        .eq("marketing_opt_in", True)
        .limit(5000)
    )
    return [
        {
            "email": db.get_user_email(str(p["id"])),
            "phone": p.get("phone"),
            "whatsapp": None,
        }
        for p in profiles
    ]


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def settings_redirect_base() -> str:
    from ..config import settings

    return settings.frontend_origin.split(",")[0].strip()


def _extract_user_id(result) -> str | None:
    user = result
    if isinstance(result, dict):
        user = result.get("user", result)
    else:
        for attr in ("user", "data"):
            inner = getattr(user, attr, None)
            if inner is not None and inner is not user:
                user = inner
                break
    if isinstance(user, dict):
        return user.get("id")
    return getattr(user, "id", None)


def _seed_services(staff_id: str, role: str) -> None:
    try:
        category = "nails" if role == "nail_tech" else "hair"
        services = db.rows(
            db.table("services")
            .select("id")
            .eq("category", category)
            .eq("active", True)
        )
        if not services:
            return
        existing = db.rows(
            db.table("staff_services").select("service_id").eq("staff_id", staff_id)
        )
        have = {str(row["service_id"]) for row in existing}
        rows = [
            {"staff_id": staff_id, "service_id": str(s["id"])}
            for s in services
            if str(s["id"]) not in have
        ]
        if rows:
            db.table("staff_services").insert(rows).execute()
    except Exception:  # noqa: BLE001
        log.exception("seed services failed for %s", staff_id)


def _seed_working_hours(staff_id: str) -> None:
    """Mon–Sat 09:00–18:00 when the staff member has no hours yet."""
    try:
        existing = db.rows(
            db.table("working_hours").select("id").eq("staff_id", staff_id).limit(1)
        )
        if existing:
            return
        rows = [
            {"staff_id": staff_id, "weekday": weekday, "start_time": "09:00", "end_time": "18:00"}
            for weekday in range(1, 7)  # Mon..Sat (0 = Sunday)
        ]
        db.table("working_hours").insert(rows).execute()
    except Exception:  # noqa: BLE001
        log.exception("seed working hours failed for %s", staff_id)
