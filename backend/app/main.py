"""FastAPI app: CORS, rate limiting, error handling, router registration."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from .config import settings
from .ratelimit import limiter
from .routers import admin, bookings, messages, public, staff

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("api")

app = FastAPI(
    title="Salon Platform API",
    version="1.0.0",
    description=(
        "Booking website + management system API. Every request is verified "
        "against the Supabase JWT and the role stored in profiles.role."
    ),
)

# slowapi reads the limiter from app.state
app.state.limiter = limiter

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        {"detail": "Too many requests — please slow down."}, status_code=429
    )


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    path = request.url.path
    if isinstance(exc, (ConnectionError, TimeoutError)):
        log.error("upstream unreachable on %s: %s", path, exc)
        return JSONResponse(
            {"detail": "Database unreachable — check SUPABASE_URL"}, status_code=503
        )
    log.exception("unhandled error on %s", path)
    if settings.environment == "development":
        return JSONResponse({"detail": f"{type(exc).__name__}: {exc}"}, status_code=500)
    return JSONResponse({"detail": "Internal server error"}, status_code=500)


# Exact-path routers first (/staff/schedule before any /staff/{id} pattern)
app.include_router(staff.router)
app.include_router(bookings.router)
app.include_router(messages.router)
app.include_router(admin.router)
app.include_router(public.router)


@app.get("/openapi.json", include_in_schema=False)
def _openapi() -> dict:  # pragma: no cover
    return app.openapi()
