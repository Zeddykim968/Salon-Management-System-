"""Image uploads: Cloudinary when CLOUDINARY_URL is set, local MEDIA otherwise."""
from __future__ import annotations

import logging
from uuid import uuid4

from django.conf import settings

log = logging.getLogger("api.storage")

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MB


def upload_image(file, folder: str, request=None) -> str:
    """Store `file` and return a URL the browser can load.

    Raises ValueError with a friendly message for oversize/unsupported files.
    """
    content_type = getattr(file, "content_type", "") or ""
    if content_type not in ALLOWED_TYPES:
        raise ValueError("Only JPEG, PNG, WebP, GIF or AVIF images are allowed.")

    size = getattr(file, "size", 0) or 0
    if size > MAX_UPLOAD_BYTES:
        raise ValueError("Image is larger than 8 MB — please upload a smaller file.")

    if settings.CLOUDINARY_URL:
        import cloudinary.uploader

        result = cloudinary.uploader.upload(
            file,
            folder=f"salon/{folder}",
            resource_type="image",
            overwrite=False,
            unique_filename=True,
        )
        url = result.get("secure_url")
        if not url:
            raise ValueError("Cloudinary did not return a URL for this upload.")
        return url

    # Local fallback so development works without a Cloudinary account.
    from django.core.files.storage import default_storage
    from django.core.files.utils import get_valid_filename

    name = get_valid_filename(f"{folder}/{uuid4().hex[:12]}_{getattr(file, 'name', 'image')}")
    saved = default_storage.save(name, file)
    if request is not None:
        return request.build_absolute_uri(settings.MEDIA_URL + saved)
    return settings.MEDIA_URL + saved
