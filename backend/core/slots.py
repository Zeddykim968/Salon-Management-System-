"""Free-slot computation: working hours minus pending/confirmed bookings.

The exclusion constraint in the database is the real double-booking guard —
this module only *displays* candidate slots and double-checks a request.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.utils import timezone

from .models import ACTIVE_BOOKING_STATUSES, Booking, Service, User, WorkingHours

STEP_MINUTES = 15  # grid resolution; slots are rounded to it
DATE_FMT = "%Y-%m-%d"


def _tz():
    from zoneinfo import ZoneInfo

    return ZoneInfo(settings.TIME_ZONE)


def parse_date(value: str | None) -> date:
    if not value:
        return timezone.localdate()
    try:
        return date.fromisoformat(value)
    except ValueError as raise_:
        raise ValueError("date must be YYYY-MM-DD") from raise_


def day_bounds(day: date) -> tuple[datetime, datetime]:
    tz = _tz()
    start = datetime.combine(day, time.min, tzinfo=tz)
    return start, start + timedelta(days=1)


def working_windows(user: User, day: date) -> list[tuple[time, time]]:
    weekday = day.weekday()  # Python: 0 = Monday
    # schema weekday: 0 = Sunday … 6 = Saturday
    pg_weekday = (weekday + 1) % 7
    rows = WorkingHours.objects.filter(user=user, weekday=pg_weekday).order_by("start_time")
    return [(row.start_time, row.end_time) for row in rows]


def build_slots(
    *,
    user: User,
    service: Service | None,
    day: date,
    now: datetime | None = None,
) -> dict:
    tz = _tz()
    now = now or timezone.now()
    duration = service.duration_min if service else 30
    day_start, day_end = day_bounds(day)

    windows = working_windows(user, day)
    hours = [{"start": w[0].strftime("%H:%M"), "end": w[1].strftime("%H:%M")} for w in windows]

    booked_qs = Booking.objects.filter(
        staff=user, status__in=ACTIVE_BOOKING_STATUSES, during__overlap=(day_start, day_end)
    ).order_by("during")
    booked = [
        {
            "id": str(booking.id),
            "start": _local_iso(booking.start),
            "end": _local_iso(booking.end),
            "status": booking.status,
        }
        for booking in booked_qs
    ]

    slots = []
    for start_h, end_h in windows:
        cursor = datetime.combine(day, start_h, tzinfo=tz)
        window_end = datetime.combine(day, end_h, tzinfo=tz)
        while cursor + timedelta(minutes=duration) <= window_end:
            slot_end = cursor + timedelta(minutes=duration)
            if cursor >= now and not _collides(booked_qs, cursor, slot_end):
                slots.append(
                    {
                        "start": _local_iso(cursor),
                        "end": _local_iso(slot_end),
                        "label": f"{cursor:%H:%M} – {slot_end:%H:%M}",
                    }
                )
            cursor += timedelta(minutes=STEP_MINUTES)

    return {
        "date": day.isoformat(),
        "duration_min": duration,
        "hours": hours,
        "slots": slots,
        "booked": booked,
    }


def _local_iso(dt: datetime | None) -> str:
    if dt is None:
        return ""
    local = timezone.localtime(dt) if timezone.is_aware(dt) else dt
    return local.isoformat()


def _collides(booked_qs, start: datetime, end: datetime) -> bool:
    for booking in booked_qs:
        if booking.start and booking.end and booking.start < end and start < booking.end:
            return True
    return False


def slot_is_free(*, user: User, start: datetime, duration_min: int, ignore_pk: str | None = None) -> bool:
    """Server-side re-check before creating/changing a booking."""
    end = start + timedelta(minutes=duration_min)
    queryset = Booking.objects.filter(staff=user, status__in=ACTIVE_BOOKING_STATUSES)
    if ignore_pk:
        queryset = queryset.exclude(pk=ignore_pk)
    for booking in queryset:
        if booking.start < end and start < booking.end:
            return False
    return True


def within_working_hours(user: User, start: datetime, end: datetime) -> bool:
    day = timezone.localtime(start).date() if timezone.is_aware(start) else start.date()
    local_start = timezone.localtime(start) if timezone.is_aware(start) else start
    local_end = timezone.localtime(end) if timezone.is_aware(end) else end
    for start_h, end_h in working_windows(user, day):
        window_start = datetime.combine(day, start_h, tzinfo=start.tzinfo)
        window_end = datetime.combine(day, end_h, tzinfo=start.tzinfo)
        if window_start <= local_start and local_end <= window_end:
            return True
    return False
