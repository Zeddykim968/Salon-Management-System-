"""Shared parsing / serialisation helpers for the API."""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from . import db
from .config import settings


def salon_tz() -> ZoneInfo | timezone:
    try:
        return ZoneInfo(settings.salon_timezone)
    except Exception:  # noqa: BLE001 — tzdata missing (some Windows setups)
        return timezone(timedelta(hours=3))  # East Africa Time fallback


def parse_iso_datetime(value: str) -> datetime:
    """Accept ISO-8601 with offset/Z; naive values are read as salon-local time."""
    raw = (value or "").strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=salon_tz())
    return dt.astimezone(timezone.utc)


def parse_range(value: Any) -> tuple[datetime, datetime]:
    """Parse a tstzrange as returned by PostgREST (list or string form)."""
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        start_s, end_s = str(value[0]), str(value[1])
    else:
        quoted = re.findall(r'"([^"]+)"', str(value))
        if len(quoted) >= 2:
            start_s, end_s = quoted[0], quoted[1]
        else:
            parts = str(value).strip().strip("[]()").split(",")
            if len(parts) != 2:
                raise ValueError(f"unparseable range: {value!r}")
            start_s, end_s = parts
    return parse_iso_datetime(start_s), parse_iso_datetime(end_s)


def range_literal(start: datetime, end: datetime) -> str:
    return f'["{start.isoformat()}","{end.isoformat()}")'


def fmt_when(start: datetime, end: datetime | None = None) -> str:
    """Human label in salon time: 'Sat 25 Oct, 10:00'."""
    tz = salon_tz()
    local = start.astimezone(tz)
    label = local.strftime("%a %d %b, %H:%M")
    if end:
        label += f"–{end.astimezone(tz).strftime('%H:%M')}"
    return label


def fmt_date(value: date) -> str:
    return value.strftime("%A %d %B %Y")


def day_bounds(day: date) -> tuple[datetime, datetime]:
    tz = salon_tz()
    start = datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    return start, end


def normalise_whatsapp(raw: str | None) -> str:
    """Store E.164 without '+', e.g. 254712345678 (matches schema comment)."""
    if not raw:
        return ""
    digits = "".join(c for c in str(raw) if c.isdigit())
    if len(digits) < 7 or len(digits) > 15:
        raise ValueError("WhatsApp number must be 7–15 digits, e.g. 254712345678")
    return digits


def body_to_dict(body: Any) -> dict:
    if hasattr(body, "model_dump"):
        return body.model_dump()
    if isinstance(body, dict):
        return body
    raise ValueError("unsupported body")


# ---------------------------------------------------------------------------
# bulk name joins (avoids version-sensitive PostgREST embed syntax)
# ---------------------------------------------------------------------------
def _chunk(items: list[str], size: int = 100) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def fetch_profiles_map(ids: Iterable[str]) -> dict[str, dict]:
    unique = list({str(i) for i in ids if i})
    out: dict[str, dict] = {}
    for chunk in _chunk(unique):
        rows = db.rows(
            db.table("profiles")
            .select("id, full_name, phone, avatar_url, role, active")
            .in_("id", chunk)
        )
        for row in rows:
            out[str(row["id"])] = row
    return out


def fetch_services_map(ids: Iterable[str]) -> dict[str, dict]:
    unique = list({str(i) for i in ids if i})
    out: dict[str, dict] = {}
    for chunk in _chunk(unique):
        rows = db.rows(db.table("services").select("*").in_("id", chunk))
        for row in rows:
            out[str(row["id"])] = row
    return out


def attach_names(
    bookings: list[dict],
    *,
    customers: dict[str, dict] | None = None,
    staff: dict[str, dict] | None = None,
    services: dict[str, dict] | None = None,
) -> list[dict]:
    """Return booking copies enriched with {customer, staff, service} summaries."""
    customers = customers if customers is not None else fetch_profiles_map(
        b.get("customer_id") for b in bookings
    )
    staff = staff if staff is not None else fetch_profiles_map(
        b.get("staff_id") for b in bookings
    )
    services = services if services is not None else fetch_services_map(
        b.get("service_id") for b in bookings
    )

    enriched = []
    for booking in bookings:
        row = dict(booking)
        start, end = parse_range(booking.get("during"))
        row.pop("during", None)
        row["start"] = start.isoformat()
        row["end"] = end.isoformat()
        row["when"] = fmt_when(start, end)
        cust = customers.get(str(booking.get("customer_id")), {})
        stf = staff.get(str(booking.get("staff_id")), {})
        svc = services.get(str(booking.get("service_id")), {})
        row["customer"] = {
            "id": booking.get("customer_id"),
            "full_name": cust.get("full_name", ""),
            "phone": cust.get("phone"),
            "avatar_url": cust.get("avatar_url"),
        }
        row["staff"] = {
            "id": booking.get("staff_id"),
            "full_name": stf.get("full_name", ""),
            "avatar_url": stf.get("avatar_url"),
        }
        row["service"] = {
            "id": booking.get("service_id"),
            "name": svc.get("name", "Service"),
            "price_kes": svc.get("price_kes"),
            "duration_min": svc.get("duration_min"),
            "category": svc.get("category"),
        }
        enriched.append(row)
    return enriched
