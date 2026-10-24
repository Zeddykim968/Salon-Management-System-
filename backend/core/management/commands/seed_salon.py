"""Seed the salon: services, default working hours, optional first admin.

    python manage.py seed_salon
    python manage.py seed_salon --admin-email you@example.com --admin-password 'ChangeMe!123'
"""
from __future__ import annotations

import uuid

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Role, Service, StaffDetail, User, WorkingHours

SERVICES = [
    ("11111111-1111-4111-8111-111111111101", "Box Braids", "hair", 2500, 240),
    ("11111111-1111-4111-8111-111111111102", "Knotless Braids", "hair", 3000, 300),
    ("11111111-1111-4111-8111-111111111103", "Wig Install", "hair", 1500, 120),
    ("11111111-1111-4111-8111-111111111104", "Retwist", "hair", 1000, 90),
    ("11111111-1111-4111-8111-111111111105", "Silk Press", "hair", 2000, 120),
    ("11111111-1111-4111-8111-111111111106", "Trim & Style", "hair", 800, 45),
    ("22222222-2222-4222-8222-222222222201", "Gel Manicure", "nails", 1200, 60),
    ("22222222-2222-4222-8222-222222222202", "Acrylic Full Set", "nails", 2000, 120),
    ("22222222-2222-4222-8222-222222222203", "Nail Art", "nails", 500, 45),
    ("22222222-2222-4222-8222-222222222204", "Pedicure", "nails", 1000, 60),
    ("22222222-2222-4222-8222-222222222205", "Gel Refill", "nails", 1500, 90),
]

# Mon–Sat 09:00–18:00 (weekday: 0 = Sunday … 6 = Saturday)
DEFAULT_HOURS = [(weekday, "09:00", "18:00") for weekday in (1, 2, 3, 4, 5, 6)]


class Command(BaseCommand):
    help = "Seed services, default working hours for staff, and optionally the first admin."

    def add_arguments(self, parser):
        parser.add_argument("--admin-email", help="Create this account with role=admin")
        parser.add_argument("--admin-password", help="Password for --admin-email")
        parser.add_argument("--admin-name", default="Salon Admin")

    @transaction.atomic
    def handle(self, *args, **options):
        created_services = 0
        for raw_id, name, category, price, duration in SERVICES:
            _, created = Service.objects.get_or_create(
                pk=uuid.UUID(raw_id),
                defaults={
                    "name": name,
                    "category": category,
                    "price_kes": price,
                    "duration_min": duration,
                },
            )
            created_services += int(created)
        self.stdout.write(self.style.SUCCESS(f"services: {created_services} created"))

        hours_added = 0
        for user in User.objects.filter(role__in=Role.staff_roles()):
            StaffDetail.objects.get_or_create(user=user)
            for weekday, start, end in DEFAULT_HOURS:
                from datetime import time as dtime

                _, created = WorkingHours.objects.get_or_create(
                    user=user,
                    weekday=weekday,
                    start_time=dtime.fromisoformat(start),
                    end_time=dtime.fromisoformat(end),
                )
                hours_added += int(created)
        self.stdout.write(self.style.SUCCESS(f"working hours: {hours_added} rows created"))

        email = options.get("admin_email")
        if email:
            password = options.get("admin_password")
            if not password:
                raise CommandError("Pass --admin-password when using --admin-email.")
            try:
                validate_password(password)
            except DjangoValidationError as exc:
                raise CommandError(" ".join(exc.messages))
            user, created = User.objects.get_or_create(
                email=email.lower(),
                defaults={
                    "full_name": options.get("admin_name") or "Salon Admin",
                    "role": Role.ADMIN,
                    "is_active": True,
                },
            )
            if created:
                user.set_password(password)
                user.save()
                self.stdout.write(self.style.SUCCESS(f"admin created: {email}"))
            else:
                self.stdout.write(f"admin already exists: {email}")

        self.stdout.write(self.style.SUCCESS("seed complete"))
