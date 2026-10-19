"""Free-slot computation: working hours minus pending/confirmed bookings.

The exclusion constraint in the schema is the real double-booking guard; this
module only *displays* candidate slots and double-checks a requested slot.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from . import db
from .config import settings
from .helpers import day_bounds, fmt_when, parse_range, salon_tz

ACTIVE_STATUSES = ("pending", "confirmed")


def working_hours(staff_id: str, weekday: int) -> list[tuple[time, time]]:
    rows = db.rows(
        db.table("working_hours")
        .select("start_time, end_time")
        .eq("staff_id", staff_id)
        .eq("weekday", weekday)
        .order("start_time")
    )
    hours: list[tuple[time, time]] = []
    for row in rows:
        start = _parse_time(row["start_time"])
        end = _parse_time(row["end_time"])
        if start and end and start < end:
            hours.append((start, end))
    return hours


def _parse_time(value) -> time | None:
    if isinstance(value, time):
        return value
    text = str(value)
    try:
        parts = text.split(":")
        return time(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 0)
    except (ValueError, IndexError):
        return None


def busy_intervals(
    staff_id: str,
    day: date,
    exclude_booking_id: str | None = None,
) -> list[tuple[datetime, datetime, str, str]]:
    """[(start,end,status,id)] of pending/confirmed bookings on that day (UTC)."""
    day_start, day_end = day_bounds(day)
    rows = db.rows(
        db.table("bookings")
        .select("id, during, status")
        .eq("staff_id", staff_id)
        .in_("status", list(ACTIVE_STATUSES))
        .limit(500)
    )
    intervals = []
    for row in rows:
        if exclude_booking_id and str(row.get("id")) == exclude_booking_id:
            continue
        try:
            start, end = parse_range(row.get("during"))
        except ValueError:
            continue
        if start < day_end and end > day_start:  # overlaps the requested day
            intervals.append((start, end, str(row.get("status")), str(row.get("id"))))
    intervals.sort(key=lambda item: item[0])
    return intervals


def compute_slots(
    staff_id: str,
    day: date,
    duration_min: int,
    *,
    service_id: str | None = None,
    exclude_booking_id: str | None = None,
) -> dict:
    tz = salon_tz()
    hours = working_hours(staff_id, sql_weekday(day))
    busy = busy_intervals(staff_id, day, exclude_booking_id=exclude_booking_id)

    duration = max(5, int(duration_min or 60))
    step = timedelta(minutes=min(settings.slot_step_min, duration))
    duration_td = timedelta(minutes=duration)
    earliest = datetime.now(timezone.utc) + timedelta(minutes=settings.booking_lead_min)

    slots: list[dict] = []
    booked: list[dict] = [
        {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "status": status,
            "id": booking_id,
        }
        for start, end, status, booking_id in busy
    ]

    for start_t, end_t in hours:
        cursor = datetime.combine(day, start_t, tzinfo=tz).astimezone(timezone.utc)
        day_end_local = datetime.combine(day, end_t, tzinfo=tz).astimezone(timezone.utc)
        while cursor + duration_td <= day_end_local:
            slot_end = cursor + duration_td
            if cursor >= earliest and not _overlaps(cursor, slot_end, busy):
                slots.append(
                    {
                        "start": cursor.isoformat(),
                        "end": slot_end.isoformat(),
                        "label": fmt_when(cursor, slot_end),
                    }
                )
            cursor += step

    return {
        "date": day.isoformat(),
        "service_id": service_id,
        "duration_min": duration,
        "hours": [
            {"start": h_start.strftime("%H:%M"), "end": h_end.strftime("%H:%M")}
            for h_start, h_end in hours
        ],
        "slots": slots,
        "booked": booked,
    }


def slot_is_free(
    staff_id: str,
    start: datetime,
    end: datetime,
    *,
    exclude_booking_id: str | None = None,
) -> tuple[bool, str]:
    """Re-validate a requested slot: inside working hours + no active overlap."""
    local_start = start.astimezone(salon_tz())
    hours = working_hours(staff_id, sql_weekday(local_start))
    if not hours:
        return False, "The salon is closed on that day"

    within_hours = False
    for start_t, end_t in hours:
        opens = datetime.combine(local_start.date(), start_t, tzinfo=salon_tz())
        closes = datetime.combine(local_start.date(), end_t, tzinfo=salon_tz())
        if start >= opens.astimezone(timezone.utc) and end <= closes.astimezone(timezone.utc):
            within_hours = True
            break
    if not within_hours:
        return False, "That time is outside working hours"

    busy = busy_intervals(staff_id, local_start.date(), exclude_booking_id=exclude_booking_id)
    if _overlaps(start, end, busy):
        return False, "That slot was just taken"

    if start < datetime.now(timezone.utc) + timedelta(minutes=settings.booking_lead_min):
        return False, "Bookings must be made a little in advance"

    return True, "ok"


def _overlaps(
    start: datetime,
    end: datetime,
    intervals: list[tuple[datetime, datetime, str, str]],
) -> bool:
    return any(start < busy_end and end > busy_start for busy_start, busy_end, *_ in intervals)


def sql_weekday(day: date | datetime) -> int:
    """PostgreSQL extract(dow) convention: 0 = Sunday … 6 = Saturday."""
    return (day.weekday() + 1) % 7


def is_weekday_index_valid(weekday: int) -> bool:
    return 0 <= weekday <= 6
