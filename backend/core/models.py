"""Data model — mirrors the original Supabase schema, now owned by Django.

UUID primary keys are kept deliberately: the Next.js client already treats ids
as opaque strings. Double booking is prevented by the database itself via the
GiST exclusion constraint on `Booking`.
"""
from __future__ import annotations

import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField
from django.contrib.postgres.indexes import GistIndex
from django.db import models
from django.db.models import F, Q
from django.utils import timezone


class Role(models.TextChoices):
    CUSTOMER = "customer", "Customer"
    SALONIST = "salonist", "Salonist"
    NAIL_TECH = "nail_tech", "Nail Tech"
    ADMIN = "admin", "Admin"

    @classmethod
    def staff_roles(cls) -> list[str]:
        return [cls.SALONIST, cls.NAIL_TECH, cls.ADMIN]


class StaffStatus(models.TextChoices):
    AVAILABLE = "available", "Available"
    BUSY = "busy", "Busy"
    OFF = "off", "Off"


class BookingStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    CONFIRMED = "confirmed", "Confirmed"
    DECLINED = "declined", "Declined"
    CANCELLED = "cancelled", "Cancelled"
    COMPLETED = "completed", "Completed"

    def is_active(self) -> bool:
        return self.value in {self.PENDING, self.CONFIRMED}


ACTIVE_BOOKING_STATUSES = ("pending", "confirmed")


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra):
        if not email:
            raise ValueError("Users must have an email address")
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("role", Role.ADMIN)
        if extra.get("is_staff") is not True or extra.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_staff=True and is_superuser=True.")
        return self._create_user(email, password, **extra)

    def staff(self):
        return self.filter(role__in=Role.staff_roles())


class User(AbstractBaseUser, PermissionsMixin):
    """One table for accounts and profiles (Supabase `profiles` + `auth.users`)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=120, default="")
    phone = models.CharField(max_length=30, blank=True, null=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.CUSTOMER)
    avatar_url = models.TextField(blank=True, null=True)
    marketing_opt_in = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # Django /backoffice access
    is_active = models.BooleanField(default=True)  # disabled staff cannot sign in
    date_joined = models.DateTimeField(default=timezone.now)
    # Which services a stylist may perform — admin assigns them, the booking
    # flow and /services/<id>/staff both read this.
    services = models.ManyToManyField(
        "core.Service", blank=True, related_name="assigned_staff"
    )

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        ordering = ["-date_joined"]
        indexes = [models.Index(fields=["role"], name="idx_profiles_role")]

    def __str__(self) -> str:
        return self.full_name or self.email

    @property
    def is_staff_member(self) -> bool:
        return self.role in Role.staff_roles()


class StaffDetail(models.Model):
    """Public staff signal: bio, WhatsApp number, Available/Busy toggle."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        primary_key=True,
        related_name="staff_detail",
        on_delete=models.CASCADE,
    )
    bio = models.TextField(blank=True, null=True)
    whatsapp = models.CharField(
        max_length=20, blank=True, null=True, help_text="E.164 without '+', e.g. 2547XXXXXXXX"
    )
    status = models.CharField(max_length=12, choices=StaffStatus.choices, default=StaffStatus.AVAILABLE)
    status_note = models.CharField(max_length=160, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"staff detail of {self.user_id}"


class Service(models.Model):
    CATEGORY_CHOICES = [("hair", "Hair"), ("nails", "Nails")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    category = models.CharField(max_length=10, choices=CATEGORY_CHOICES)
    price_kes = models.PositiveIntegerField()
    duration_min = models.PositiveIntegerField()
    image_url = models.TextField(blank=True, null=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["category", "price_kes"]

    def __str__(self) -> str:
        return f"{self.name} ({self.category})"

    def clean(self) -> None:
        from django.core.exceptions import ValidationError

        if not 5 <= self.duration_min <= 600:
            raise ValidationError({"duration_min": "Duration must be between 5 and 600 minutes."})


class WorkingHours(models.Model):
    """When a staff member can be booked. weekday: 0 = Sunday … 6 = Saturday."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="working_hours", on_delete=models.CASCADE
    )
    weekday = models.PositiveSmallIntegerField()
    start_time = models.TimeField()
    end_time = models.TimeField()

    class Meta:
        ordering = ["weekday", "start_time"]
        verbose_name_plural = "working hours"
        constraints = [
            models.CheckConstraint(condition=Q(start_time__lt=F("end_time")), name="hours_start_before_end"),
            models.CheckConstraint(condition=Q(weekday__lte=6), name="weekday_0_to_6"),
        ]
        indexes = [models.Index(fields=["user", "weekday"], name="idx_working_hours_staff")]

    def __str__(self) -> str:
        return f"{self.user} {self.get_weekday_display()} {self.start_time:%H:%M}-{self.end_time:%H:%M}"


class Booking(models.Model):
    """A slot request. The exclusion constraint below is the double-booking guard."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="bookings_made", on_delete=models.CASCADE
    )
    staff = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="bookings_received", on_delete=models.CASCADE
    )
    service = models.ForeignKey(Service, related_name="bookings", on_delete=models.PROTECT)
    during = DateTimeRangeField()
    status = models.CharField(max_length=12, choices=BookingStatus.choices, default=BookingStatus.PENDING)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            ExclusionConstraint(
                name="booking_no_overlap_per_staff",
                expressions=[("staff_id", "="), ("during", "&&")],
                condition=Q(status__in=ACTIVE_BOOKING_STATUSES),
                violation_error_message="That time is already booked for this stylist — pick another slot.",
            ),
        ]
        indexes = [
            GistIndex(fields=["staff_id", "during"], name="idx_bookings_staff_during"),
            models.Index(fields=["customer", "-created_at"], name="idx_bookings_customer"),
            models.Index(fields=["staff", "-created_at"], name="idx_bookings_staff_created"),
        ]

    @property
    def start(self):
        return self.during.lower if self.during else None

    @property
    def end(self):
        return self.during.upper if self.during else None

    def __str__(self) -> str:
        return f"{self.service} · {self.start} ({self.status})"


class Gallery(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    staff = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="gallery_photos", null=True, blank=True, on_delete=models.SET_NULL
    )
    image_url = models.TextField()
    caption = models.CharField(max_length=200, blank=True, null=True)
    approved = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["staff", "-created_at"], name="idx_gallery_staff")]

    def __str__(self) -> str:
        return self.image_url


class SiteAsset(models.Model):
    """Hero image, banners, etc. key: 'hero', 'banner_1', …"""

    key = models.CharField(max_length=60, primary_key=True)
    image_url = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return self.key


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="messages_sent", on_delete=models.CASCADE
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="messages_received", on_delete=models.CASCADE
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["sender", "recipient", "created_at"], name="idx_messages_pair"),
            models.Index(fields=["recipient", "-created_at"], name="idx_messages_recipient"),
        ]

    def __str__(self) -> str:
        return f"{self.sender} → {self.recipient}"

    def clean(self) -> None:
        from django.core.exceptions import ValidationError

        if not self.body.strip():
            raise ValidationError({"body": "Message cannot be empty."})
        if self.sender_id and self.sender_id == self.recipient_id:
            raise ValidationError({"recipient": "You cannot message yourself."})


class Campaign(models.Model):
    CHANNELS = [("email", "Email"), ("whatsapp", "WhatsApp")]
    AUDIENCES = [("all_customers", "All customers"), ("staff", "Staff")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="campaigns", on_delete=models.CASCADE
    )
    channel = models.CharField(max_length=10, choices=CHANNELS)
    subject = models.CharField(max_length=200, blank=True, null=True)
    body = models.TextField()
    audience = models.CharField(max_length=30, choices=AUDIENCES, default="all_customers")
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.channel}: {self.subject or self.body[:40]}"


class ActivityLog(models.Model):
    """What the admin watches on the overview page."""

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="activity_entries",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    action = models.CharField(max_length=60)  # 'booking.confirm', 'gallery.upload', …
    meta = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "activity log"
        indexes = [models.Index(fields=["-created_at"], name="idx_activity_created")]

    def __str__(self) -> str:
        return f"{self.action} @ {self.created_at:%Y-%m-%d %H:%M}"


def log_activity(actor, action: str, meta: dict | None = None) -> ActivityLog:
    return ActivityLog.objects.create(actor=actor, action=action, meta=meta)
