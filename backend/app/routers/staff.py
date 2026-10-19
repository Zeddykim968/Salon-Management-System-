"""Staff endpoints: schedule, Available/Busy toggle, profile, uploads."""
from __future__ import annotations

import logging
import uuid
from datetime import date as date_cls
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from .. import db
from ..auth import CurrentUser, require_role
from ..config import settings
from ..helpers import attach_names, normalise_whatsapp, salon_tz

log = logging.getLogger("api.staff")

router = APIRouter(prefix="/staff", tags=["staff"])

STAFF_ROLES = ("salonist", "nail_tech", "admin")

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
}


class StatusIn(BaseModel):
    status: str  # available | busy | off
    status_note: str | None = None


class ProfileIn(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    bio: str | None = None
    whatsapp: str | None = None
    service_ids: list[str] | None = None


async def _image_bytes(file: UploadFile) -> tuple[bytes, str]:
    ctype = (file.content_type or "").lower()
    if ctype not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Only JPEG/PNG/WebP/GIF/AVIF images")
    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Image larger than 8 MB")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    return data, ALLOWED_IMAGE_TYPES[ctype]


def _require_staff(user: CurrentUser) -> None:
    if user.role not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Staff only")


# ---------------------------------------------------------------------------
# schedule (own bookings)
# ---------------------------------------------------------------------------
@router.get("/schedule")
def my_schedule(
    days: int = 14,
    user: CurrentUser = Depends(require_role("salonist", "nail_tech", "admin")),
) -> list[dict]:
    days = max(1, min(days, 90))
    tz = salon_tz()
    today_local = datetime.now(tz).date()
    from_day = today_local - timedelta(days=1)
    to_day = today_local + timedelta(days=days)

    rows = db.rows(
        db.table("bookings")
        .select("*")
        .eq("staff_id", user.id)
        .order("created_at", desc=True)
        .limit(500)
    )

    out = []
    for row in rows:
        try:
            enriched = attach_names([row])[0]
        except ValueError:
            continue
        try:
            start_local = datetime.fromisoformat(enriched["start"]).astimezone(tz).date()
        except ValueError:
            continue
        if from_day <= start_local <= to_day:
            out.append(enriched)

    order = {"pending": 0, "confirmed": 1, "completed": 2, "declined": 3, "cancelled": 4}
    out.sort(
        key=lambda b: (order.get(b.get("status"), 9), b.get("start", "")),
    )
    return out


# ---------------------------------------------------------------------------
# Available / Busy / Off toggle (public signal, slots stay the source of truth)
# ---------------------------------------------------------------------------
@router.patch("/status")
def set_status(
    body: StatusIn,
    user: CurrentUser = Depends(require_role("salonist", "nail_tech", "admin")),
) -> dict:
    if body.status not in ("available", "busy", "off"):
        raise HTTPException(status_code=400, detail="status must be available|busy|off")

    payload = {
        "staff_id": user.id,
        "status": body.status,
        "status_note": (body.status_note or "").strip()[:140] or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    updated = db.one(
        db.table("staff_details")
        .upsert(payload, on_conflict="staff_id")
        .select("*")
        .limit(1)
    )
    db.log_activity(user.id, f"status.{body.status}", {})
    return updated or payload


# ---------------------------------------------------------------------------
# profile (bio, WhatsApp number, name, phone, offered services)
# ---------------------------------------------------------------------------
@router.get("/profile")
def get_profile(
    user: CurrentUser = Depends(require_role("salonist", "nail_tech", "admin")),
) -> dict:
    profile = db.get_profile(user.id) or {}
    details = db.get_staff_details(user.id) or {}
    links = db.rows(
        db.table("staff_services").select("service_id").eq("staff_id", user.id)
    )
    services = db.rows(db.table("services").select("*").eq("active", True).order("name"))
    assigned = {str(link["service_id"]) for link in links}
    for service in services:
        service["assigned"] = str(service["id"]) in assigned
    return {
        "id": user.id,
        "full_name": profile.get("full_name", ""),
        "phone": profile.get("phone"),
        "avatar_url": profile.get("avatar_url"),
        "role": profile.get("role"),
        "bio": details.get("bio"),
        "whatsapp": details.get("whatsapp"),
        "status": details.get("status", "available"),
        "status_note": details.get("status_note"),
        "services": services,
    }


@router.put("/profile")
def update_profile(
    body: ProfileIn,
    user: CurrentUser = Depends(require_role("salonist", "nail_tech", "admin")),
) -> dict:
    profile_patch: dict = {}
    if body.full_name is not None:
        name = body.full_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        profile_patch["full_name"] = name[:120]
    if body.phone is not None:
        profile_patch["phone"] = body.phone.strip()[:30] or None

    whatsapp: str | None = None
    if body.whatsapp is not None:
        try:
            whatsapp = normalise_whatsapp(body.whatsapp) or None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if profile_patch:
        db.table("profiles").update(profile_patch).eq("id", user.id).execute()

    details_patch: dict = {
        "staff_id": user.id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.bio is not None:
        details_patch["bio"] = body.bio.strip()[:1000]
    if body.whatsapp is not None:
        details_patch["whatsapp"] = whatsapp

    db.table("staff_details").upsert(details_patch, on_conflict="staff_id").execute()

    if body.service_ids is not None:
        valid = {
            str(s["id"])
            for s in db.rows(db.table("services").select("id").eq("active", True))
        }
        chosen = [sid for sid in {str(s) for s in body.service_ids} if sid in valid]
        db.table("staff_services").delete().eq("staff_id", user.id).execute()
        if chosen:
            db.table("staff_services").insert(
                [{"staff_id": user.id, "service_id": sid} for sid in chosen]
            ).execute()

    db.log_activity(user.id, "staff.profile_update", {})
    return get_profile(user=user)


# ---------------------------------------------------------------------------
# avatar + work-photo uploads (stored in the public-read `gallery` bucket)
# ---------------------------------------------------------------------------
@router.post("/avatar", status_code=201)
async def upload_avatar(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_role("salonist", "nail_tech", "admin")),
) -> dict:
    data, ext = await _image_bytes(file)
    path = f"avatars/{user.id}{ext}"
    url = db.storage_upload("gallery", path, data, file.content_type or "image/jpeg")
    db.table("profiles").update({"avatar_url": url}).eq("id", user.id).execute()
    db.log_activity(user.id, "staff.avatar_upload", {})
    return {"avatar_url": url}


@router.post("/gallery", status_code=201)
async def upload_work_photo(
    file: UploadFile = File(...),
    caption: str = Form(""),
    user: CurrentUser = Depends(require_role("salonist", "nail_tech", "admin")),
) -> dict:
    data, ext = await _image_bytes(file)
    path = f"work/{user.id}/{uuid.uuid4().hex}{ext}"
    url = db.storage_upload("gallery", path, data, file.content_type or "image/jpeg")

    row = db.one(
        db.table("gallery")
        .insert(
            {
                "staff_id": user.id,
                "image_url": url,
                "caption": caption.strip()[:200] or None,
                "approved": True,
            }
        )
        .select("*")
        .limit(1)
    )
    db.log_activity(user.id, "gallery.upload", {"url": url})
    return row or {"image_url": url, "staff_id": user.id}


@router.get("/gallery")
def my_gallery(
    user: CurrentUser = Depends(require_role("salonist", "nail_tech", "admin")),
) -> list[dict]:
    return db.rows(
        db.table("gallery")
        .select("*")
        .eq("staff_id", user.id)
        .order("created_at", desc=True)
        .limit(200)
    )


@router.delete("/gallery/{photo_id}", status_code=204)
def delete_work_photo(
    photo_id: str,
    user: CurrentUser = Depends(require_role("salonist", "nail_tech", "admin")),
) -> None:
    row = db.one(db.table("gallery").select("*").eq("id", photo_id).limit(1))
    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    if str(row.get("staff_id")) != user.id:
        raise HTTPException(status_code=403, detail="Not your photo")
    db.storage_delete("gallery", str(row.get("image_url", "")))
    db.table("gallery").delete().eq("id", photo_id).execute()
    db.log_activity(user.id, "gallery.delete", {"photo_id": photo_id})
