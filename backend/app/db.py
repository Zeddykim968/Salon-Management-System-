"""Supabase / Postgres access helpers (service-role client, backend only)."""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

from supabase import Client, create_client

from .config import settings

log = logging.getLogger("api.db")

_client: Client | None = None
_lock = threading.Lock()


class DatabaseNotConfigured(RuntimeError):
    """Raised when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing."""


def get_client() -> Client:
    """Lazily build the service-role client (bypasses RLS — backend only)."""
    global _client
    with _lock:
        if _client is None:
            if not settings.supabase_url or not settings.supabase_service_role_key:
                raise DatabaseNotConfigured(
                    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment"
                )
            _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        return _client


def table(name: str):
    return get_client().table(name)


def rows(res: Any) -> list[dict]:
    """Normalise postgrest responses across versions (response object or raw data)."""
    err = getattr(res, "error", None)
    if err:
        raise RuntimeError(str(err))
    data = getattr(res, "data", res)
    if data is None:
        return []
    if isinstance(data, dict):
        # PostgREST error payload that did not raise
        if data.get("message") and data.get("code"):
            raise RuntimeError(str(data))
        return [data]
    return list(data)


def one(res: Any) -> dict | None:
    data = rows(res)
    return data[0] if data else None


# ---------------------------------------------------------------------------
# profiles
# ---------------------------------------------------------------------------
def get_profile(user_id: str) -> dict | None:
    return one(table("profiles").select("*").eq("id", user_id).limit(1))


def get_staff_details(user_id: str) -> dict | None:
    return one(table("staff_details").select("*").eq("staff_id", user_id).limit(1))


# ---------------------------------------------------------------------------
# activity feed (never let logging break a request)
# ---------------------------------------------------------------------------
def log_activity(actor_id: str | None, action: str, meta: dict | None = None) -> None:
    try:
        table("activity_log").insert(
            {"actor_id": actor_id, "action": action, "meta": meta or {}}
        ).execute()
    except Exception:  # noqa: BLE001
        log.exception("activity_log insert failed (%s)", action)


# ---------------------------------------------------------------------------
# auth admin: resolve a user's email for notifications
# ---------------------------------------------------------------------------
_email_cache: dict[str, tuple[float, str | None]] = {}
_email_lock = threading.Lock()


def get_user_email(user_id: str) -> str | None:
    cached = _email_cache.get(user_id)
    if cached and time.time() - cached[0] < 300:
        return cached[1]
    email: str | None = None
    try:
        res = get_client().auth.admin.get_user_by_id(user_id)
        user = res
        if isinstance(res, dict):
            user = res.get("user", res)
        else:
            for attr in ("user", "data"):
                inner = getattr(user, attr, None)
                if inner is not None and inner is not user:
                    user = inner
                    break
        if isinstance(user, dict):
            email = user.get("email")
        else:
            email = getattr(user, "email", None)
    except Exception:  # noqa: BLE001
        log.exception("get_user_email failed for %s", user_id)
    with _email_lock:
        _email_cache[user_id] = (time.time(), email)
    return email


# ---------------------------------------------------------------------------
# storage (buckets: gallery, site — public read, backend-only writes)
# ---------------------------------------------------------------------------
def storage_upload(bucket: str, path: str, content: bytes, content_type: str) -> str:
    client = get_client()
    store = client.storage.from_(bucket)
    options: dict[str, str] = {"content-type": content_type, "x-upsert": "true"}
    try:
        store.upload(path, content, options)
    except TypeError:
        # newer storage3 wants a FileOptions object instead of a dict
        try:
            from storage3 import FileOptions  # type: ignore
        except Exception:  # noqa: BLE001
            from storage3._types import FileOptions  # type: ignore
        store.upload(path, content, FileOptions(content_type=content_type, upsert=True))
    return store.get_public_url(path)


def storage_delete(bucket: str, url: str) -> None:
    marker = f"/{bucket}/"
    idx = url.find(marker)
    if idx < 0:
        return
    path = url[idx + len(marker):].split("?")[0].split("#")[0]
    if not path:
        return
    try:
        get_client().storage.from_(bucket).remove([path])
    except Exception:  # noqa: BLE001
        log.exception("storage delete failed for %s", url)


def extension_for(content_type: str) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/avif": ".avif",
    }.get(content_type.lower(), ".jpg")
