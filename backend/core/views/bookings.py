"""Booking lifecycle: request → confirm/decline → complete (or cancel)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from django_ratelimit.decorators import ratelimit
from rest_framework.decorators import api_view
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response

from .. import notify, slots
from ..models import Booking, BookingStatus, Role, Service, User, log_activity
from ..serializers import BookingSerializer

log = logging.getLogger("api.bookings")


class SlotConflict(APIException):
    """409: the slot was taken between loading the page and submitting."""

    status_code = 409
    default_detail = "That slot was just taken — refresh to see new times."


def _parse_start(value: str):
    if not value:
        raise ValidationError({"start": "Pick a time slot."})
    try:
        dt = datetime.fromisoformat(str(value))
    except ValueError as exc:
        raise ValidationError({"start": "Invalid date/time."}) from exc
    if timezone.is_naive(dt):
        from zoneinfo import ZoneInfo

        from django.conf import settings

        dt = dt.replace(tzinfo=ZoneInfo(settings.TIME_ZONE))
    return dt


@api_view(["POST"])
@ratelimit(key="user", rate="30/hour", method="POST", block=False)
def create_booking(request):
    if getattr(request, "limited", False):
        return Response({"detail": "That's a lot of requests — try again later."}, status=429)

    user = request.user
    if user.role not in (Role.CUSTOMER, Role.ADMIN):
        return Response({"detail": "Staff book from their own schedule view."}, status=403)

    staff = User.objects.filter(
        pk=request.data.get("staff_id"), is_active=True, role__in=Role.staff_roles()
    ).exclude(role=Role.ADMIN).select_related("staff_detail").first()
    if staff is None:
        raise ValidationError({"staff": "Stylist not found."})

    service = Service.objects.filter(pk=request.data.get("service_id"), active=True).first()
    if service is None:
        raise ValidationError({"service": "Service not found."})
    if not staff.services.filter(pk=service.pk).exists():
        raise ValidationError({"service": f"{staff.full_name} doesn't offer {service.name}."})

    start = _parse_start(request.data.get("start"))
    end = start + timedelta(minutes=service.duration_min)
    now = timezone.now()

    if start < now:
        raise ValidationError({"start": "That time is in the past."})
    if not slots.within_working_hours(staff, start, end):
        raise ValidationError({"start": "That time is outside this stylist's working hours."})
    if not slots.slot_is_free(user=staff, start=start, duration_min=service.duration_min):
        raise SlotConflict()

    notes = str(request.data.get("notes") or "").strip()[:1000] or None

    try:
        with transaction.atomic():
            booking = Booking.objects.create(
                customer=user,
                staff=staff,
                service=service,
                during=(start, end),
                status=BookingStatus.PENDING,
                notes=notes,
            )
    except IntegrityError:
        # the exclusion constraint said no — the real double-booking guard
        raise SlotConflict()

    log_activity(user, "booking.create", {"staff": staff.full_name, "service": service.name})
    serializer = BookingSerializer(booking)
    data = serializer.data

    # Notify the customer by email (best effort: a missing Brevo key just logs).
    notify.email_booking_created(
        to=user.email,
        staff_name=staff.full_name,
        service_name=service.name,
        when_text=data["when"],
    )
    # WhatsApp has no server-side send — hand the customer a click-to-chat
    # link that opens their own WhatsApp with a message already written.
    detail = getattr(staff, "staff_detail", None)
    data["whatsapp_link"] = notify.whatsapp_link(
        to=detail.whatsapp if detail else None,
        text=(
            f"Hi {staff.full_name}! I just booked {service.name} for {data['when']}. "
            "Is that all good on your side?"
        ),
    )
    return Response(data, status=201)


@api_view(["GET"])
def my_bookings(request):
    bookings = (
        Booking.objects.filter(customer=request.user)
        .select_related("customer", "staff", "service")
        .order_by("-created_at")
    )
    status_filter = request.query_params.get("status")
    if status_filter:
        bookings = bookings.filter(status=status_filter)
    return Response(BookingSerializer(bookings, many=True).data)


def _get_booking(request, booking_id):
    booking = (
        Booking.objects.filter(pk=booking_id)
        .select_related("customer", "staff", "service")
        .first()
    )
    if booking is None:
        return None, Response({"detail": "Booking not found."}, status=404)
    return booking, None


def _can_decide(user: User, booking: Booking) -> bool:
    if user.role == Role.ADMIN:
        return True
    return booking.staff_id == user.id


def _can_cancel(user: User, booking: Booking) -> bool:
    if user.role == Role.ADMIN:
        return True
    return booking.customer_id == user.id or booking.staff_id == user.id


TRANSITIONS = {
    "confirm": (BookingStatus.CONFIRMED, {"pending"}),
    "decline": (BookingStatus.DECLINED, {"pending", "confirmed"}),
    "complete": (BookingStatus.COMPLETED, {"confirmed"}),
    "cancel": (BookingStatus.CANCELLED, {"pending", "confirmed"}),
}


def _answer(request, booking_id, action: str):
    new_status, allowed_from = TRANSITIONS[action]
    booking, error = _get_booking(request, booking_id)
    if error:
        return error

    if action == "cancel":
        if not _can_cancel(request.user, booking):
            return Response({"detail": "Forbidden"}, status=403)
    elif not _can_decide(request.user, booking):
        return Response({"detail": "Forbidden"}, status=403)

    if booking.status not in allowed_from:
        return Response(
            {"detail": f"Cannot {action} a booking that is {booking.status}."},
            status=409,
        )

    booking.status = new_status
    booking.save(update_fields=["status"])

    log_activity(
        request.user,
        f"booking.{action}",
        {"customer": booking.customer.full_name, "service": booking.service.name},
    )

    data = BookingSerializer(booking).data
    notify.email_booking_answered(
        to=booking.customer.email,
        staff_name=booking.staff.full_name,
        service_name=booking.service.name,
        when_text=data["when"],
        status=new_status,
    )
    if action in {"confirm", "decline"}:
        # Wa.me link so the salon can continue the conversation in WhatsApp
        # with the booking details pre-written.
        spoken = {"confirm": "confirmed", "decline": "declined"}[action]
        data["whatsapp_link"] = notify.whatsapp_link(
            to=booking.customer.phone,
            text=(
                f"Hi {booking.customer.full_name or 'there'}! Your {booking.service.name} "
                f"on {data['when']} is {spoken}. Reply here if you need anything."
            ),
        )
    return Response(data)


@api_view(["PATCH"])
def confirm_booking(request, booking_id):
    return _answer(request, booking_id, "confirm")


@api_view(["PATCH"])
def decline_booking(request, booking_id):
    return _answer(request, booking_id, "decline")


@api_view(["PATCH"])
def cancel_booking(request, booking_id):
    return _answer(request, booking_id, "cancel")


@api_view(["PATCH"])
def complete_booking(request, booking_id):
    return _answer(request, booking_id, "complete")
