"""Staff workspace: schedule, profile, status toggle, uploads."""
from __future__ import annotations

import logging
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from .. import notify, storage
from ..models import ACTIVE_BOOKING_STATUSES, Booking, Gallery, Role, Service, StaffDetail, StaffStatus, User, log_activity
from ..serializers import BookingSerializer, GalleryPhotoSerializer, MeSerializer, StaffProfileSerializer

log = logging.getLogger("api.staff")


def _staff_detail(user: User) -> StaffDetail:
    detail, _ = StaffDetail.objects.get_or_create(user=user)
    return detail


def _require_staff_role(user: User) -> None:
    if user.role not in Role.staff_roles():
        from rest_framework.exceptions import PermissionDenied

        raise PermissionDenied("Staff only.")


@api_view(["GET"])
def schedule(request):
    """Today + the next N days for this staff member (default 21)."""
    _require_staff_role(request.user)
    try:
        days = max(1, min(int(request.query_params.get("days", 21)), 120))
    except ValueError:
        days = 21

    today = timezone.now()
    horizon = today + timedelta(days=days)
    bookings = (
        Booking.objects.filter(staff=request.user, during__startswith__lt=horizon)
        .filter(Q(during__endswith__gte=today) | Q(during__startswith__gte=today))
        .select_related("customer", "staff", "service")
        .order_by("during")
    )
    return Response(BookingSerializer(bookings, many=True).data)


@api_view(["GET", "PUT"])
def profile(request):
    """GET returns the workspace profile; PUT saves it."""
    _require_staff_role(request.user)
    if request.method == "GET":
        return Response(StaffProfileSerializer(request.user).data)

    user = request.user

    full_name = str(request.data.get("full_name", user.full_name)).strip()
    phone = str(request.data.get("phone") or "").strip() or None
    bio = str(request.data.get("bio") or "").strip()[:2000] or None
    whatsapp = "".join(ch for ch in str(request.data.get("whatsapp") or "") if ch.isdigit()) or None

    if full_name:
        user.full_name = full_name
    user.phone = phone
    user.save(update_fields=["full_name", "phone"])

    detail = _staff_detail(user)
    detail.bio = bio
    detail.whatsapp = whatsapp
    detail.save(update_fields=["bio", "whatsapp", "updated_at"])

    service_ids = request.data.get("service_ids")
    if service_ids is not None:
        if not isinstance(service_ids, list):
            raise ValidationError({"service_ids": "Expected a list of service ids."})
        valid = list(Service.objects.filter(pk__in=service_ids).values_list("id", flat=True))
        user.services.set(valid)

    log_activity(user, "profile.update", {"fields": sorted(request.data.keys())})
    return Response(StaffProfileSerializer(user).data)


@api_view(["PATCH"])
def set_status(request):
    """The public Available/Busy/Off badge."""
    _require_staff_role(request.user)
    status_value = str(request.data.get("status", ""))
    if status_value not in StaffStatus.values:
        raise ValidationError({"status": "Use available, busy or off."})
    note = str(request.data.get("status_note") or "").strip()[:160] or None

    detail = _staff_detail(request.user)
    detail.status = status_value
    detail.status_note = note
    detail.save(update_fields=["status", "status_note", "updated_at"])
    log_activity(request.user, f"status.{status_value}", {"note": note})
    return Response(MeSerializer(request.user).data)


@api_view(["POST"])
def upload_avatar(request):
    _require_staff_role(request.user)
    file = request.FILES.get("file")
    if file is None:
        raise ValidationError({"file": "Choose an image to upload."})
    try:
        url = storage.upload_image(file, folder="avatars", request=request)
    except ValueError as exc:
        raise ValidationError({"file": str(exc)}) from exc

    request.user.avatar_url = url
    request.user.save(update_fields=["avatar_url"])
    log_activity(request.user, "avatar.upload")
    return Response({"avatar_url": url})


@api_view(["GET", "POST"])
def my_gallery(request):
    """GET lists own photos (including unapproved); POST uploads one."""
    _require_staff_role(request.user)
    if request.method == "GET":
        photos = Gallery.objects.filter(staff=request.user).select_related("staff")
        return Response(GalleryPhotoSerializer(photos, many=True).data)

    file = request.FILES.get("file")
    if file is None:
        raise ValidationError({"file": "Choose an image to upload."})
    caption = str(request.data.get("caption") or "").strip()[:200] or None
    try:
        url = storage.upload_image(file, folder="gallery", request=request)
    except ValueError as exc:
        raise ValidationError({"file": str(exc)}) from exc

    photo = Gallery.objects.create(staff=request.user, image_url=url, caption=caption, approved=True)
    log_activity(request.user, "gallery.upload", {"caption": caption})
    return Response(GalleryPhotoSerializer(photo).data, status=201)


@api_view(["DELETE"])
def delete_photo(request, photo_id):
    _require_staff_role(request.user)
    photo = Gallery.objects.filter(pk=photo_id).first()
    if photo is None:
        raise NotFound("Photo not found.")
    if photo.staff_id != request.user.id and request.user.role != Role.ADMIN:
        from rest_framework.exceptions import PermissionDenied

        raise PermissionDenied("Forbidden")
    photo.delete()
    return Response(status=204)
