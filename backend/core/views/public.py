"""Public endpoints — no account needed."""
from __future__ import annotations

from django.db.models import Prefetch
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .. import slots
from ..models import Gallery, Role, Service, SiteAsset, StaffDetail, User
from ..serializers import GalleryPhotoSerializer, ServiceSerializer, StaffCardSerializer


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok", "service": "salon-api"})


@api_view(["GET"])
@permission_classes([AllowAny])
def services_list(request):
    services = Service.objects.filter(active=True)
    return Response(ServiceSerializer(services, many=True).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def service_staff(request, service_id):
    """Stylists who perform a given service (landing → style → pick a person)."""
    staff = (
        User.objects.filter(
            is_active=True, role__in=Role.staff_roles(), services__pk=service_id
        )
        .distinct()
        .prefetch_related(
            Prefetch("gallery_photos", queryset=Gallery.objects.filter(approved=True)[:6])
        )
    )
    return Response(StaffCardSerializer(staff, many=True, context={"photo_limit": 6}).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def stylists(request):
    """Every active staff member with bio, status, photos and services."""
    staff = (
        User.objects.filter(is_active=True, role__in=Role.staff_roles())
        .select_related("staff_detail")
        .prefetch_related("services", "gallery_photos")
    )
    return Response(StaffCardSerializer(staff, many=True, context={"photo_limit": 6}).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def availability(request, staff_id):
    """Free slots for one stylist on one day: working hours minus bookings."""
    staff = (
        User.objects.filter(pk=staff_id, is_active=True, role__in=Role.staff_roles())
        .select_related("staff_detail")
        .first()
    )
    if staff is None:
        return Response({"detail": "Stylist not found."}, status=404)

    service = None
    service_id = request.query_params.get("service_id")
    if service_id:
        service = Service.objects.filter(pk=service_id, active=True).first()
        if service is None:
            return Response({"detail": "Service not found."}, status=404)

    try:
        day = slots.parse_date(request.query_params.get("date"))
    except ValueError:
        return Response({"detail": "date must be YYYY-MM-DD"}, status=400)

    payload = slots.build_slots(user=staff, service=service, day=day)
    detail = getattr(staff, "staff_detail", None)
    payload["staff"] = {
        "id": str(staff.id),
        "full_name": staff.full_name,
        "avatar_url": staff.avatar_url,
        "role": staff.role,
        "bio": detail.bio if detail else None,
        "whatsapp": detail.whatsapp if detail else None,
        "status": detail.status if detail else "off",
        "status_note": detail.status_note if detail else None,
    }
    payload["service"] = (
        {
            "id": str(service.id),
            "name": service.name,
            "price_kes": service.price_kes,
            "duration_min": service.duration_min,
            "category": service.category,
        }
        if service
        else None
    )
    return Response(payload)


@api_view(["GET"])
@permission_classes([AllowAny])
def gallery(request):
    limit = request.query_params.get("limit")
    photos = Gallery.objects.filter(approved=True)
    if limit and str(limit).isdigit():
        photos = photos[: int(limit)]
    return Response(GalleryPhotoSerializer(photos, many=True).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def site_assets(request):
    """{ "hero": "https://…", "banner_1": "https://…" }"""
    return Response({asset.key: asset.image_url for asset in SiteAsset.objects.all()})
