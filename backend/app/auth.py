"""JWT verification + role guard (the server never trusts the browser)."""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable

import httpx
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db
from .config import settings

log = logging.getLogger("api.auth")

_bearer = HTTPBearer(auto_error=False)

_jwks: dict | None = None
_jwks_fetched_at = 0.0
_jwks_lock = threading.Lock()
_JWKS_TTL = 3600


@dataclass
class CurrentUser:
    id: str
    email: str | None
    role: str
    full_name: str
    phone: str | None
    active: bool


def _fetch_jwks() -> dict:
    """Supabase publishes RS256 keys at /auth/v1/.well-known/jwks.json."""
    global _jwks, _jwks_fetched_at
    with _jwks_lock:
        if _jwks is not None and time.time() - _jwks_fetched_at < _JWKS_TTL:
            return _jwks
        url = settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"
        resp = httpx.get(url, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        _jwks = data
        _jwks_fetched_at = time.time()
        return data


def _decode(token: str) -> dict:
    header = jwt.get_unverified_header(token)
    alg = (header.get("alg") or "").upper()

    if alg.startswith("HS"):
        if not settings.supabase_jwt_secret:
            raise HTTPException(
                status_code=401,
                detail="Project uses RS256 tokens; set SUPABASE_JWT_SECRET or use JWKS",
            )
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )

    # RS256 (default for modern Supabase projects)
    try:
        jwks = _fetch_jwks()
    except Exception as exc:  # noqa: BLE001
        log.exception("JWKS fetch failed")
        raise HTTPException(status_code=401, detail=f"Cannot verify token: {exc}") from exc

    keys = jwks.get("keys") or []
    kid = header.get("kid")
    jwk = next((k for k in keys if k.get("kid") == kid), None)
    if jwk is None and len(keys) == 1:
        jwk = keys[0]
    if jwk is None:
        raise HTTPException(status_code=401, detail="Signing key not found in JWKS")

    key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
    return jwt.decode(token, key, algorithms=["RS256"], audience="authenticated")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> CurrentUser:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        claims = _decode(credentials.credentials)
    except HTTPException:
        raise
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token has no subject")

    try:
        profile = db.get_profile(user_id)
    except Exception as exc:  # noqa: BLE001
        log.exception("profile lookup failed")
        raise HTTPException(status_code=503, detail="Database unavailable") from exc

    if profile is None:
        raise HTTPException(status_code=403, detail="Profile not found")
    if not profile.get("active", True):
        raise HTTPException(status_code=403, detail="Account disabled")

    return CurrentUser(
        id=str(profile["id"]),
        email=claims.get("email"),
        role=str(profile.get("role", "customer")),
        full_name=str(profile.get("full_name") or ""),
        phone=profile.get("phone"),
        active=bool(profile.get("active", True)),
    )


def require_role(*roles: str) -> Callable[..., CurrentUser]:
    """Dependency factory — mirrors the shape in the README."""

    def dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user

    return dep
