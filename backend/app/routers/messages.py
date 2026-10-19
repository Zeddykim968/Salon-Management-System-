"""In-app chat between customers, staff and admin (Supabase Realtime on top)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .. import db
from ..auth import CurrentUser, get_current_user
from ..ratelimit import limiter
from fastapi import Request  # noqa: E402

router = APIRouter(prefix="/messages", tags=["messages"])


class MessageIn(BaseModel):
    recipient_id: str
    body: str = Field(..., min_length=1, max_length=2000)


def _profile_summary(profile: dict) -> dict:
    return {
        "id": str(profile.get("id")),
        "full_name": profile.get("full_name", "") or "Member",
        "role": profile.get("role", "customer"),
        "avatar_url": profile.get("avatar_url"),
        "phone": profile.get("phone"),
    }


@router.get("/contacts")
def contacts(user: CurrentUser = Depends(get_current_user)) -> list[dict]:
    """Who this user can chat with, with last message + unread count."""
    if user.role == "admin":
        rows = db.rows(
            db.table("profiles")
            .select("id, full_name, role, avatar_url, phone, active")
            .eq("active", True)
            .neq("id", user.id)
            .order("full_name")
            .limit(500)
        )
    elif user.role == "customer":
        staff_rows = db.rows(
            db.table("profiles")
            .select("id, full_name, role, avatar_url, phone, active")
            .in_("role", ["salonist", "nail_tech", "admin"])
            .eq("active", True)
            .neq("id", user.id)
            .order("full_name")
            .limit(100)
        )
        rows = staff_rows
    else:  # salonist / nail_tech — customers they booked, plus admins and the team
        booked = db.rows(
            db.table("bookings")
            .select("customer_id")
            .eq("staff_id", user.id)
            .limit(500)
        )
        customer_ids = list({str(b["customer_id"]) for b in booked})
        rows = db.rows(
            db.table("profiles")
            .select("id, full_name, role, avatar_url, phone, active")
            .in_("role", ["salonist", "nail_tech", "admin"])
            .eq("active", True)
            .neq("id", user.id)
            .order("full_name")
            .limit(100)
        )
        if customer_ids:
            for chunk_start in range(0, len(customer_ids), 100):
                chunk = customer_ids[chunk_start:chunk_start + 100]
                rows += db.rows(
                    db.table("profiles")
                    .select("id, full_name, role, avatar_url, phone, active")
                    .in_("id", chunk)
                    .eq("active", True)
                )

    if not rows:
        return []

    # last message + unread count for each pair (single query over my messages)
    recent = db.rows(
        db.table("messages")
        .select("sender_id, recipient_id, body, created_at, read_at")
        .or_(f"sender_id.eq.{user.id},recipient_id.eq.{user.id}")
        .order("created_at", desc=True)
        .limit(1000)
    )
    threads: dict[str, dict] = {}
    for msg in recent:
        other = (
            str(msg["recipient_id"])
            if str(msg["sender_id"]) == user.id
            else str(msg["sender_id"])
        )
        thread = threads.setdefault(
            other, {"last": None, "unread": 0, "last_at": ""}
        )
        if thread["last"] is None:
            thread["last"] = {
                "body": msg.get("body", ""),
                "created_at": msg.get("created_at"),
                "from_me": str(msg["sender_id"]) == user.id,
            }
            thread["last_at"] = str(msg.get("created_at") or "")
        if (
            str(msg["recipient_id"]) == user.id
            and str(msg["sender_id"]) != user.id
            and not msg.get("read_at")
        ):
            thread["unread"] += 1

    contacts_out = []
    for profile in rows:
        pid = str(profile["id"])
        thread = threads.get(pid, {"last": None, "unread": 0, "last_at": ""})
        contacts_out.append(
            {
                **_profile_summary(profile),
                "last_message": thread["last"],
                "unread": thread["unread"],
            }
        )
    contacts_out.sort(
        key=lambda c: (
            c["last_message"]["created_at"] if c["last_message"] else "",
            c["full_name"].lower(),
        ),
        reverse=True,
    )
    return contacts_out


@router.get("")
def thread(
    user_id: str = Query(..., alias="user_id"),
    user: CurrentUser = Depends(get_current_user),
    limit: int = 200,
) -> list[dict]:
    """Full conversation with one user; marks their messages as read."""
    other = db.get_profile(user_id)
    if other is None:
        raise HTTPException(status_code=404, detail="User not found")

    rows = db.rows(
        db.table("messages")
        .select("*")
        .or_(
            f"and(sender_id.eq.{user.id},recipient_id.eq.{user_id}),"
            f"and(sender_id.eq.{user_id},recipient_id.eq.{user.id})"
        )
        .order("created_at")
        .limit(min(limit, 500))
    )

    # mark their side as read
    unread_ids = [
        str(r["id"])
        for r in rows
        if str(r["sender_id"]) == user_id and not r.get("read_at")
    ]
    if unread_ids:
        try:
            db.table("messages").update(
                {"read_at": datetime.now(timezone.utc).isoformat()}
            ).in_("id", unread_ids).execute()
        except Exception:  # noqa: BLE001
            pass

    return [
        {
            **row,
            "from_me": str(row["sender_id"]) == user.id,
        }
        for row in rows
    ]


@router.post("", status_code=201)
@limiter.limit("60/minute")
def send_message(
    body: MessageIn,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    if body.recipient_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    recipient = db.get_profile(body.recipient_id)
    if recipient is None or not recipient.get("active", True):
        raise HTTPException(status_code=404, detail="Recipient not found")

    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    row = db.one(
        db.table("messages")
        .insert(
            {
                "sender_id": user.id,
                "recipient_id": body.recipient_id,
                "body": text[:2000],
            }
        )
        .select("*")
        .limit(1)
    )
    db.log_activity(user.id, "message.send", {"to": body.recipient_id})
    return {**(row or {}), "from_me": True}
