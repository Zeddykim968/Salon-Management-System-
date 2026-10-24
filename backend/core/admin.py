"""Django /backoffice registrations — a safety net for manual data fixes."""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import (
    ActivityLog,
    Booking,
    Campaign,
    Gallery,
    Message,
    Service,
    SiteAsset,
    StaffDetail,
    User,
    WorkingHours,
)


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ("email", "full_name", "role", "is_active", "date_joined")
    list_filter = ("role", "is_active")
    search_fields = ("email", "full_name")
    ordering = ("email",)
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profile", {"fields": ("full_name", "phone", "role", "avatar_url", "marketing_opt_in")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups")}),
        ("Dates", {"fields": ("date_joined",)}),
    )
    add_fieldsets = ((None, {"fields": ("email", "password1", "password2")}),)
    filter_horizontal = ("groups",)


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ("service", "staff", "customer", "status", "start")
    list_filter = ("status",)
    search_fields = ("customer__email", "staff__email", "service__name")
    raw_id_fields = ("customer", "staff", "service")

    @admin.display(description="Start")
    def start(self, obj):
        return obj.start


@admin.register(Service)
class ServiceAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "price_kes", "duration_min", "active")
    list_filter = ("category", "active")


@admin.register(StaffDetail)
class StaffDetailAdmin(admin.ModelAdmin):
    list_display = ("user", "status", "whatsapp")
    list_filter = ("status",)


@admin.register(Gallery)
class GalleryAdmin(admin.ModelAdmin):
    list_display = ("staff", "caption", "approved", "created_at")
    list_filter = ("approved",)


admin.site.register([WorkingHours, SiteAsset, Message, Campaign, ActivityLog])
