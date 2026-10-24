"""Uniform `{"detail": ...}` error payloads for the Next.js client."""
from __future__ import annotations

import logging

from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import (
    APIException,
    NotAuthenticated,
    NotFound,
    PermissionDenied,
    ValidationError,
)
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

log = logging.getLogger("api")


def _flatten(detail) -> str:
    if isinstance(detail, str):
        return detail
    if isinstance(detail, (list, tuple)):
        parts = []
        for item in detail:
            if isinstance(item, dict):
                parts.append(
                    " ".join(str(v) for v in item.values())
                    if "msg" not in item
                    else str(item["msg"])
                )
            else:
                parts.append(str(item))
        return "; ".join(parts) or "Invalid request"
    if isinstance(detail, dict):
        parts = []
        for field, messages in detail.items():
            if isinstance(messages, (list, tuple)):
                messages = "; ".join(str(m) for m in messages)
            parts.append(f"{field}: {messages}" if field != "detail" else str(messages))
        return "; ".join(parts) or "Invalid request"
    return str(detail)


def api_exception_handler(exc, context):
    """Every failure comes back as {"detail": "<human sentence>"}."""
    response = drf_exception_handler(exc, context)

    if response is None:
        if isinstance(exc, ValueError) and "uuid" in str(exc).lower():
            # a URL id that cannot be a UUID can never match a row
            return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        if isinstance(exc, (ConnectionError, TimeoutError)):
            log.error("upstream unreachable: %s", exc)
            return Response(
                {"detail": "Database unreachable — check DATABASE_URL"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        log.exception("unhandled error", exc_info=exc)
        detail = "Internal server error"
        if settings.DEBUG:
            detail = f"{type(exc).__name__}: {exc}"
        return Response({"detail": detail}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    if isinstance(exc, NotAuthenticated):
        message = "Not authenticated"
    elif isinstance(exc, PermissionDenied):
        message = _flatten(response.data) if response.data else "Forbidden"
    elif isinstance(exc, NotFound):
        message = "Not found"
    elif isinstance(exc, ValidationError):
        message = _flatten(exc.detail)
    elif isinstance(exc, APIException):
        message = _flatten(exc.detail)
    else:
        message = _flatten(response.data)

    response.data = {"detail": message}
    return response
