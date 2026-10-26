"""Admin: overview, staff invites, gallery moderation, site images, campaigns."""
from __future__ import annotations

import logging
import re
from datetime import datetime, time, timedelta

from django.contrib.auth.tokens import default_token_generator
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django_ratelimit.decorators import ratelimit
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from .. import notify, storage
from ..config_helpers import frontend_origin
from ..models import (
    ACTIVE_BOOKING_STATUSES,
    ActivityLog,
    Booking,
    Campaign,
    Gallery,
    Role,
    SiteAsset,
    StaffDetail,
    User,
    log_activity,
)
from ..serializers import (
    ActivityItemSerializer,
    BookingSerializer,
    CampaignSerializer,
    GalleryPhotoSerializer,
    StaffMemberSerializer,
)

log = logging.getLogger("api.admin")

KEY_PATTERN = re.compile(r"^[a-z0-9_]{1,40}$")


def _require_admin(request) -> User:
    from rest_framework.exceptions import PermissionDenied

    if request.user.role != Role.ADMIN:
        raise PermissionDenied("Admins only.")
    return request.user


@api_view(["GET"])
def overview(request):
    _require_admin(request)
    today = timezone.localdate()
    day_start = timezone.make_aware(datetime.combine(today, time.min))
    day_end = day_start + timedelta(days=1)
    bookings = Booking.objects.all()
    return Response(
        {
            "customers": User.objects.filter(role=Role.CUSTOMER).count(),
            "staff": User.objects.filter(role__in=Role.staff_roles()).count(),
            "pending_bookings": bookings.filter(status="pending").count(),
            "confirmed_bookings": bookings.filter(status="confirmed").count(),
            "today_bookings": bookings.filter(
                status__in=ACTIVE_BOOKING_STATUSES, during__overlap=(day_start, day_end)
            ).count(),
            "total_bookings": bookings.count(),
        }
    )


@api_view(["GET"])
def staff_list(request):
    _require_admin(request)
    staff = User.objects.filter(role__in=Role.staff_roles()).select_related("staff_detail")
    return Response(StaffMemberSerializer(staff, many=True).data)


@api_view(["POST"])
@ratelimit(key="user", rate="20/hour", method="POST", block=False)
def invite_staff(request):
    """Admin adds a salonist / nail tech; they set a password from the email."""
    admin = _require_admin(request)
    if getattr(request, "limited", False):
        return Response({"detail": "Too many invites — try again later."}, status=429)

    email = str(request.data.get("email", "")).strip().lower()
    full_name = str(request.data.get("full_name", "")).strip()
    role = str(request.data.get("role", ""))
    if not email or "@" not in email:
        raise ValidationError({"email": "Enter a valid email address."})
    if role not in (Role.SALONIST, Role.NAIL_TECH, Role.ADMIN):
        raise ValidationError({"role": "Choose salonist, nail_tech or admin."})
    if User.objects.filter(email__iexact=email).exists():
        raise ValidationError({"email": "That email already has an account."})

    user = User.objects.create_user(
        email=email,
        password=None,
        full_name=full_name or email.split("@")[0],
        role=role,
        is_active=False,
    )
    StaffDetail.objects.get_or_create(user=user)
    log_activity(admin, "staff.invite", {"email": email, "role": role})

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    notify.email_invite(
        to=email,
        full_name=user.full_name,
        role=role,
        link=f"{frontend_origin()}/set-password?uid={uid}&token={token}",
    )
    return Response(StaffMemberSerializer(user).data, status=201)


def _delete_staff(admin: User, user: User) -> Response:
    """Remove a staff account together with everything it owns.

    `user.delete()` cascades to StaffDetail, WorkingHours, Bookings and Messages;
    gallery photos are unlinked by the schema (SET_NULL), so they are removed
    explicitly here — a deleted stylist should not leave their work in the feed.
    """
    if user.pk == admin.pk:
        raise ValidationError({"detail": "You cannot delete your own account."})
    if user.role == Role.ADMIN and not (
        User.objects.filter(role=Role.ADMIN).exclude(pk=user.pk).exists()
    ):
        raise ValidationError({"detail": "That is the last admin — invite another one first."})

    payload = {
        "email": user.email,
        "full_name": user.full_name,
        "bookings": Booking.objects.filter(staff=user).count(),
        "photos": Gallery.objects.filter(staff=user).count(),
    }
    with transaction.atomic():
        Gallery.objects.filter(staff=user).delete()
        user.delete()
    log_activity(admin, "staff.delete", payload)
    return Response(status=204)


@api_view(["PATCH", "DELETE"])
def update_staff(request, staff_id):
    admin = _require_admin(request)
    user = User.objects.filter(pk=staff_id, role__in=Role.staff_roles()).first()
    if user is None:
        raise NotFound("Staff member not found.")

    if request.method == "DELETE":
        return _delete_staff(admin, user)

    if "active" in request.data:
        user.is_active = bool(request.data.get("active"))
        user.save(update_fields=["is_active"])
        log_activity(admin, "staff.activate" if user.is_active else "staff.disable", {"email": user.email})
    if "role" in request.data:
        role = str(request.data.get("role"))
        if role not in Role.values:
            raise ValidationError({"role": "Unknown role."})
        user.role = role
        user.save(update_fields=["role"])
        if role in Role.staff_roles():
            StaffDetail.objects.get_or_create(user=user)
        log_activity(admin, "staff.role", {"email": user.email, "role": role})
    if "full_name" in request.data:
        user.full_name = str(request.data.get("full_name") or "").strip() or user.full_name
        user.save(update_fields=["full_name"])
    if "phone" in request.data:
        user.phone = str(request.data.get("phone") or "").strip() or None
        user.save(update_fields=["phone"])

    return Response(StaffMemberSerializer(user).data)


@api_view(["GET"])
def customers(request):
    _require_admin(request)
    people = User.objects.filter(role=Role.CUSTOMER).order_by("-date_joined")[:200]
    data = [
        {
            "id": str(p.id),
            "full_name": p.full_name,
            "email": p.email,
            "phone": p.phone,
            "avatar_url": p.avatar_url,
            "marketing_opt_in": p.marketing_opt_in,
            "bookings": p.bookings_made.count(),
            "created_at": p.date_joined.isoformat(),
        }
        for p in people
    ]
    return Response(data)


@api_view(["GET"])
def activity(request):
    _require_admin(request)
    entries = ActivityLog.objects.select_related("actor")[:100]
    return Response(ActivityItemSerializer(entries, many=True).data)


@api_view(["GET"])
def gallery_moderation(request):
    _require_admin(request)
    photos = Gallery.objects.select_related("staff")
    return Response(GalleryPhotoSerializer(photos, many=True).data)


@api_view(["PATCH"])
def moderate_photo(request, photo_id):
    _require_admin(request)
    photo = Gallery.objects.filter(pk=photo_id).first()
    if photo is None:
        raise NotFound("Photo not found.")
    photo.approved = bool(request.data.get("approved", True))
    photo.save(update_fields=["approved"])
    log_activity(request.user, "gallery.moderate", {"approved": photo.approved})
    return Response(GalleryPhotoSerializer(photo).data)


@api_view(["DELETE"])
def delete_photo(request, photo_id):
    _require_admin(request)
    photo = Gallery.objects.filter(pk=photo_id).first()
    if photo is None:
        raise NotFound("Photo not found.")
    photo.delete()
    log_activity(request.user, "gallery.delete", {"id": str(photo_id)})
    return Response(status=204)


@api_view(["PUT"])
def set_site_asset(request, key):
    """Upload the hero / banner image. Multipart field name: `file`."""
    _require_admin(request)
    if not KEY_PATTERN.match(key):
        raise ValidationError({"key": "Use lowercase letters, numbers and underscores."})
    file = request.FILES.get("file")
    if file is None:
        raise ValidationError({"file": "Choose an image to upload."})
    try:
        url = storage.upload_image(file, folder="site", request=request)
    except ValueError as exc:
        raise ValidationError({"file": str(exc)}) from exc

    SiteAsset.objects.update_or_create(key=key, defaults={"image_url": url})
    log_activity(request.user, "site.asset", {"key": key})
    return Response({"key": key, "image_url": url})


@api_view(["GET", "POST"])
def campaigns(request):
    if request.method == "GET":
        _require_admin(request)
        return Response(CampaignSerializer(Campaign.objects.select_related("created_by"), many=True).data)

    admin = _require_admin(request)
    channel = str(request.data.get("channel", "email"))
    audience = str(request.data.get("audience", "all_customers"))
    subject = str(request.data.get("subject") or "").strip()[:200] or None
    body = str(request.data.get("body", "")).strip()
    if channel not in ("email", "whatsapp"):
        raise ValidationError({"channel": "Choose email or whatsapp."})
    if audience not in ("all_customers", "staff"):
        raise ValidationError({"audience": "Choose all_customers or staff."})
    if not body:
        raise ValidationError({"body": "Write the message first."})

    recipients = User.objects.filter(is_active=True, marketing_opt_in=True)
    if audience == "all_customers":
        recipients = recipients.filter(role=Role.CUSTOMER)
    else:
        recipients = recipients.filter(role__in=Role.staff_roles())

    attempted = sent = 0
    links: list[dict[str, str]] = []
    for person in recipients:
        attempted += 1
        if channel == "email":
            ok = notify.email_campaign(
                to=person.email, subject=subject or "An offer from the salon", body=body
            )
        else:
            # No WhatsApp API: build a click-to-chat link per recipient so the
            # admin can open each conversation with the offer pre-written.
            detail = getattr(person, "staff_detail", None)
            number = person.phone or (detail.whatsapp if detail else None)
            url = notify.whatsapp_link(to=number, text=body)
            if not url:
                continue
            ok = True
            links.append(
                {
                    "name": person.full_name or person.email,
                    "url": url,
                }
            )
        if ok:
            sent += 1

    campaign = Campaign.objects.create(
        created_by=admin,
        channel=channel,
        subject=subject,
        body=body,
        audience=audience,
        sent_at=timezone.now(),
    )
    log_activity(admin, "campaign.send", {"channel": channel, "audience": audience, "sent": sent})
    return Response(
        {"attempted": attempted, "sent": sent, "id": str(campaign.id), "links": links},
        status=201,
    )
