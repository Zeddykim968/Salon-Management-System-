"""Serializers — each one mirrors a shape the Next.js client already expects."""
from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from .models import (
    ActivityLog,
    Booking,
    Campaign,
    Gallery,
    Message,
    Service,
    StaffDetail,
    User,
)


def _local(dt):
    if dt is None:
        return None
    return timezone.localtime(dt) if timezone.is_aware(dt) else dt


def _iso(dt) -> str | None:
    dt = _local(dt)
    return dt.isoformat() if dt else None


def _clock(dt) -> str:
    dt = _local(dt)
    return f"{dt:%H:%M}"


class ServiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Service
        fields = ["id", "name", "category", "price_kes", "duration_min", "image_url", "active"]


class StaffDetailFields:
    """Shared flattening of staff_details onto the user object."""

    @staticmethod
    def bio(user) -> str | None:
        detail = getattr(user, "staff_detail", None)
        return detail.bio if detail else None

    @staticmethod
    def whatsapp(user) -> str | None:
        detail = getattr(user, "staff_detail", None)
        return detail.whatsapp if detail else None

    @staticmethod
    def status(user) -> str:
        detail = getattr(user, "staff_detail", None)
        return detail.status if detail else "off"

    @staticmethod
    def status_note(user) -> str | None:
        detail = getattr(user, "staff_detail", None)
        return detail.status_note if detail else None


class StaffCardSerializer(serializers.ModelSerializer):
    bio = serializers.SerializerMethodField()
    whatsapp = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    status_note = serializers.SerializerMethodField()
    photos = serializers.SerializerMethodField()
    services = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "full_name",
            "role",
            "avatar_url",
            "bio",
            "whatsapp",
            "status",
            "status_note",
            "photos",
            "services",
        ]

    def get_bio(self, user):
        return StaffDetailFields.bio(user)

    def get_whatsapp(self, user):
        return StaffDetailFields.whatsapp(user)

    def get_status(self, user):
        return StaffDetailFields.status(user)

    def get_status_note(self, user):
        return StaffDetailFields.status_note(user)

    def get_photos(self, user) -> list[dict]:
        limit = self.context.get("photo_limit", 6)
        photos = user.gallery_photos.filter(approved=True)[:limit]
        return [{"image_url": p.image_url, "caption": p.caption} for p in photos]

    def get_services(self, user) -> list[str]:
        return list(user.services.filter(active=True).values_list("name", flat=True))


class MeSerializer(serializers.ModelSerializer):
    staff_details = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "phone", "role", "staff_details"]

    def get_staff_details(self, user) -> dict | None:
        detail = getattr(user, "staff_detail", None)
        if detail is None:
            return None
        return {
            "bio": detail.bio,
            "whatsapp": detail.whatsapp,
            "status": detail.status,
            "status_note": detail.status_note,
        }


class StaffProfileSerializer(MeSerializer):
    bio = serializers.SerializerMethodField()
    whatsapp = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    services = serializers.SerializerMethodField()

    class Meta(MeSerializer.Meta):
        fields = MeSerializer.Meta.fields + ["bio", "whatsapp", "status", "avatar_url", "services"]

    def get_bio(self, user):
        return StaffDetailFields.bio(user)

    def get_whatsapp(self, user):
        return StaffDetailFields.whatsapp(user)

    def get_status(self, user):
        return StaffDetailFields.status(user)

    def get_services(self, user) -> list[dict]:
        assigned = set(user.services.values_list("id", flat=True))
        return [
            {**ServiceSerializer(service).data, "assigned": service.id in assigned}
            for service in Service.objects.filter(active=True)
        ]


class BookingSerializer(serializers.ModelSerializer):
    start = serializers.SerializerMethodField()
    end = serializers.SerializerMethodField()
    when = serializers.SerializerMethodField()
    customer = serializers.SerializerMethodField()
    staff = serializers.SerializerMethodField()
    service = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            "id",
            "status",
            "start",
            "end",
            "when",
            "notes",
            "created_at",
            "customer",
            "staff",
            "service",
        ]

    def get_start(self, booking):
        return _iso(booking.start)

    def get_end(self, booking):
        return _iso(booking.end)

    def get_when(self, booking) -> str:
        start, end = _local(booking.start), _local(booking.end)
        if start is None:
            return "—"
        day = f"{start:%a %d %b}"
        return f"{day}, {_clock(booking.start)} – {_clock(booking.end)}" if end else day

    def get_customer(self, booking) -> dict:
        customer = booking.customer
        return {
            "id": str(customer.id),
            "full_name": customer.full_name,
            "phone": customer.phone,
            "avatar_url": customer.avatar_url,
        }

    def get_staff(self, booking) -> dict:
        staff = booking.staff
        return {"id": str(staff.id), "full_name": staff.full_name, "avatar_url": staff.avatar_url}

    def get_service(self, booking) -> dict:
        service = booking.service
        return {
            "id": str(service.id),
            "name": service.name,
            "price_kes": service.price_kes,
            "duration_min": service.duration_min,
            "category": service.category,
        }


class StaffMemberSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    whatsapp = serializers.SerializerMethodField()
    stats = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "full_name",
            "email",
            "role",
            "is_active",
            "phone",
            "avatar_url",
            "status",
            "whatsapp",
            "stats",
        ]

    def get_status(self, user) -> str:
        return StaffDetailFields.status(user)

    def get_whatsapp(self, user):
        return StaffDetailFields.whatsapp(user)

    def get_stats(self, user) -> dict:
        bookings = user.bookings_received.all()
        return {
            "total": bookings.count(),
            "pending": bookings.filter(status="pending").count(),
            "confirmed": bookings.filter(status="confirmed").count(),
        }

    def to_representation(self, instance) -> dict:
        data = super().to_representation(instance)
        # the client calls it `active`, not `is_active`
        data["active"] = data.pop("is_active", False)
        return data


class MessageSerializer(serializers.ModelSerializer):
    from_me = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ["id", "sender_id", "recipient_id", "body", "created_at", "read_at", "from_me"]

    def get_from_me(self, message) -> bool:
        return self.context.get("me_id") == message.sender_id


class ContactSerializer(serializers.Serializer):
    id = serializers.CharField()
    full_name = serializers.CharField()
    role = serializers.CharField()
    avatar_url = serializers.CharField(allow_null=True)
    phone = serializers.CharField(allow_null=True)
    last_message = serializers.DictField(allow_null=True)
    unread = serializers.IntegerField()


class GalleryPhotoSerializer(serializers.ModelSerializer):
    staff_name = serializers.SerializerMethodField()

    class Meta:
        model = Gallery
        fields = ["id", "staff_id", "image_url", "caption", "approved", "created_at", "staff_name"]

    def get_staff_name(self, photo) -> str | None:
        return photo.staff.full_name if photo.staff else None


class ActivityItemSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = ActivityLog
        fields = ["id", "action", "meta", "created_at", "actor_name"]

    def get_actor_name(self, entry) -> str:
        return entry.actor.full_name if entry.actor else "system"


class CampaignSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Campaign
        fields = [
            "id",
            "channel",
            "subject",
            "body",
            "audience",
            "sent_at",
            "created_at",
            "created_by_name",
        ]

    def get_created_by_name(self, campaign) -> str | None:
        return campaign.created_by.full_name if campaign.created_by_id else None


class StaffDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffDetail
        fields = ["bio", "whatsapp", "status", "status_note"]
