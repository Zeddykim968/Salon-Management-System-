"""Small shared helpers that need no Django models."""
from __future__ import annotations

import os


def frontend_origin() -> str:
    return os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").rstrip("/")
