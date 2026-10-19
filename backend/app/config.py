"""Environment settings for the Salon Platform API."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[1]   # .../backend
_ROOT_DIR = _BACKEND_DIR.parent                      # repo root

# Real environment variables always win; then backend/.env, then root .env.
ENV_FILES = (str(_BACKEND_DIR / ".env"), str(_ROOT_DIR / ".env"))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILES,
        extra="ignore",
        case_sensitive=False,
    )

    # --- Supabase ---
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_service_role_key: str = ""
    # Legacy projects use an HS256 secret; newer projects verify via JWKS (RS256).
    supabase_jwt_secret: str = ""

    # --- Server ---
    frontend_origin: str = "http://localhost:3000"
    environment: str = "development"

    # --- Email (Resend) ---
    resend_api_key: str = ""
    email_from: str = "Salon <hello@yourdomain.com>"

    # --- WhatsApp Cloud API ---
    whatsapp_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_api_version: str = "v21.0"

    # --- Booking rules ---
    salon_timezone: str = "Africa/Nairobi"   # prices are KES, salon runs on EAT
    slot_step_min: int = 15
    booking_lead_min: int = 30
    max_upload_bytes: int = 8 * 1024 * 1024

    # Convenience: comma separated extra origins, e.g. "https://a.vercel.app,https://b.vercel.app"
    extra_origins: str = ""

    @property
    def cors_origins(self) -> list[str]:
        origins = [o.strip() for o in self.frontend_origin.split(",") if o.strip()]
        origins += [o.strip() for o in self.extra_origins.split(",") if o.strip()]
        return origins or ["http://localhost:3000"]

    @property
    def whatsapp_configured(self) -> bool:
        return bool(self.whatsapp_token and self.whatsapp_phone_number_id)

    @property
    def resend_configured(self) -> bool:
        return bool(self.resend_api_key)


settings = Settings()
