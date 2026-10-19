"""Public, unauthenticated endpoints (+ /me for whoever is logged in)."""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db, slots
from ..auth import CurrentUser, get_current_user
from ..helpers import attach_names, fetch_profiles_map, fetch_services_map

router = APIRouter(tags=["public"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "salon-api"}


# ---------------------------------------------------------------------------
# services (styles)
# ---------------------------------------------------------------------------
@router.get("/services")
def list_services() -> list[dict]:
    rows = db.rows(
        db.table("services")
        .select("*")
        .eq("active", True)
        .order("category")
        .order("name")
    )
    return rows


# ---------------------------------------------------------------------------
# website images (hero, banners)
# ---------------------------------------------------------------------------
@router.get("/site-assets")
def site_assets() -> dict:
    rows = db.rows(db.table("site_assets").select("*"))
    return {row["key"]: row["image_url"] for row in rows}


# ---------------------------------------------------------------------------
# stylists for a service (status badge + WhatsApp)
# ---------------------------------------------------------------------------
@router.get("/services/{service_id}/staff")
def staff_for_service(service_id: str) -> list[dict]:
    service = db.one(
        db.table("services").select("*").eq("id", service_id).limit(1)
    )
    if service is None:
        raise HTTPException(status_code=404, detail="Service not found")

    links = db.rows(
        db.table("staff_services").select("staff_id").eq("service_id", service_id)
    )
    staff_ids = [str(link["staff_id"]) for link in links]
    if not staff_ids:
        return []

    profiles = fetch_profiles_map(staff_ids)
    details_rows = db.rows(
        db.table("staff_details").select("*").in_("staff_id", staff_ids)
    )
    details = {str(row["staff_id"]): row for row in details_rows}
    photos = db.rows(
        db.table("gallery")
        .select("staff_id, image_url, caption, created_at")
        .in_("staff_id", staff_ids)
        .eq("approved", True)
        .order("created_at", desc=True)
        .limit(120)
    )
    photos_by_staff: dict[str, list[dict]] = {}
    for photo in photos:
        photos_by_staff.setdefault(str(photo["staff_id"]), []).append(
            {"image_url": photo["image_url"], "caption": photo.get("caption")}
        )

    result = []
    for staff_id in staff_ids:
        profile = profiles.get(staff_id)
        if not profile or not profile.get("active", True):
            continue
        if profile.get("role") not in ("salonist", "nail_tech", "admin"):
            continue
        info = details.get(staff_id, {})
        result.append(
            {
                "id": staff_id,
                "full_name": profile.get("full_name", ""),
                "role": profile.get("role"),
                "avatar_url": profile.get("avatar_url"),
                "bio": info.get("bio"),
                "whatsapp": info.get("whatsapp"),
                "status": info.get("status", "available"),
                "status_note": info.get("status_note"),
                "photos": photos_by_staff.get(staff_id, [])[:6],
            }
        )
    return result


# ---------------------------------------------------------------------------
# every active stylist (landing page + booking shortcuts)
# ---------------------------------------------------------------------------
@router.get("/stylists")
def stylists() -> list[dict]:
    profiles = db.rows(
        db.table("profiles")
        .select("id, full_name, avatar_url, role, active")
        .in_("role", ["salonist", "nail_tech"])
        .eq("active", True)
        .order("full_name")
        .limit(100)
    )
    if not profiles:
        return []
    ids = [str(p["id"]) for p in profiles]
    details = {
        str(row["staff_id"]): row
        for row in db.rows(
            db.table("staff_details").select("*").in_("staff_id", ids)
        )
    }
    links = db.rows(
        db.table("staff_services").select("staff_id, service_id").in_("staff_id", ids)
    )
    services_map = fetch_services_map(link["service_id"] for link in links)
    photos = db.rows(
        db.table("gallery")
        .select("staff_id, image_url, caption")
        .in_("staff_id", ids)
        .eq("approved", True)
        .order("created_at", desc=True)
        .limit(200)
    )

    services_by_staff: dict[str, list[str]] = {}
    for link in links:
        service = services_map.get(str(link["service_id"]))
        if service:
            services_by_staff.setdefault(str(link["staff_id"]), []).append(
                str(service["name"])
            )
    photos_by_staff: dict[str, list[dict]] = {}
    for photo in photos:
        photos_by_staff.setdefault(str(photo["staff_id"]), []).append(
            {"image_url": photo["image_url"], "caption": photo.get("caption")}
        )

    result = []
    for profile in profiles:
        pid = str(profile["id"])
        info = details.get(pid, {})
        result.append(
            {
                "id": pid,
                "full_name": profile.get("full_name", ""),
                "role": profile.get("role"),
                "avatar_url": profile.get("avatar_url"),
                "bio": info.get("bio"),
                "whatsapp": info.get("whatsapp"),
                "status": info.get("status", "available"),
                "status_note": info.get("status_note"),
                "services": services_by_staff.get(pid, []),
                "photos": photos_by_staff.get(pid, [])[:4],
            }
        )
    return result


# ---------------------------------------------------------------------------
# availability for one day: working hours − pending/confirmed bookings
# ---------------------------------------------------------------------------
@router.get("/staff/{staff_id}/availability")
def availability(
    staff_id: str,
    date_str: str = Query(..., alias="date"),
    service_id: str | None = Query(None),
) -> dict:
    try:
        day = date.fromisoformat(date_str)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD") from exc
    if day < date.today().replace(year=date.today().year - 1) or day > date.today().replace(
        year=date.today().year + 1
    ):
        raise HTTPException(status_code=400, detail="date out of range")

    profile = db.one(
        db.table("profiles")
        .select("id, full_name, avatar_url, role, active")
        .eq("id", staff_id)
        .limit(1)
    )
    if not profile or not profile.get("active", True):
        raise HTTPException(status_code=404, detail="Stylist not found")

    duration = 60
    service = None
    if service_id:
        service = db.one(
            db.table("services").select("*").eq("id", service_id).limit(1)
        )
        if service is None:
            raise HTTPException(status_code=404, detail="Service not found")
        duration = int(service.get("duration_min") or 60)

    info = db.get_staff_details(staff_id) or {}
    payload = slots.compute_slots(staff_id, day, duration, service_id=service_id)
    payload["staff"] = {
        "id": staff_id,
        "full_name": profile.get("full_name", ""),
        "avatar_url": profile.get("avatar_url"),
        "role": profile.get("role"),
        "bio": info.get("bio"),
        "whatsapp": info.get("whatsapp"),
        "status": info.get("status", "available"),
        "status_note": info.get("status_note"),
    }
    payload["service"] = (
        {
            "id": service.get("id"),
            "name": service.get("name"),
            "price_kes": service.get("price_kes"),
            "duration_min": service.get("duration_min"),
            "category": service.get("category"),
        }
        if service
        else None
    )
    return payload


# ---------------------------------------------------------------------------
# public gallery
# ---------------------------------------------------------------------------
@router.get("/gallery")
def gallery(limit: int = Query(60, ge=1, le=200)) -> list[dict]:
    rows = db.rows(
        db.table("gallery")
        .select("*")
        .eq("approved", True)
        .order("created_at", desc=True)
        .limit(limit)
    )
    profiles = fetch_profiles_map(row.get("staff_id") for row in rows)
    return [
        {
            **row,
            "staff_name": profiles.get(str(row.get("staff_id")), {}).get("full_name", ""),
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# who am I (role for middleware / nav)
# ---------------------------------------------------------------------------
@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)) -> dict:
    details = db.get_staff_details(user.id) if user.role != "customer" else None
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "phone": user.phone,
        "role": user.role,
        "staff_details": details,
    }

