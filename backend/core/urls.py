"""API routes — paths match what the Next.js client already calls."""
from django.urls import path

from .views import admin as admin_views
from .views import auth as auth_views
from .views import bookings as booking_views
from .views import messages as message_views
from .views import public as public_views
from .views import staff as staff_views

urlpatterns = [
    path("health", public_views.health),
    # --- auth -----------------------------------------------------------------
    path("auth/register", auth_views.register),
    path("auth/verify-email", auth_views.verify_email),
    path("auth/login", auth_views.login),
    path("auth/refresh", auth_views.refresh),
    path("auth/set-password", auth_views.set_password),
    path("auth/password-reset", auth_views.password_reset_request),
    path("auth/password-reset/confirm", auth_views.password_reset_confirm),
    path("me", auth_views.me),
    # --- public ---------------------------------------------------------------
    path("services", public_views.services_list),
    path("services/<str:service_id>/staff", public_views.service_staff),
    path("stylists", public_views.stylists),
    path("staff/<str:staff_id>/availability", public_views.availability),
    path("gallery", public_views.gallery),
    path("site-assets", public_views.site_assets),
    # --- bookings -------------------------------------------------------------
    path("bookings", booking_views.create_booking),
    path("bookings/mine", booking_views.my_bookings),
    path("bookings/<str:booking_id>/confirm", booking_views.confirm_booking),
    path("bookings/<str:booking_id>/decline", booking_views.decline_booking),
    path("bookings/<str:booking_id>/cancel", booking_views.cancel_booking),
    path("bookings/<str:booking_id>/complete", booking_views.complete_booking),
    # --- staff workspace ------------------------------------------------------
    path("staff/schedule", staff_views.schedule),
    path("staff/profile", staff_views.profile),
    path("staff/status", staff_views.set_status),
    path("staff/avatar", staff_views.upload_avatar),
    path("staff/gallery", staff_views.my_gallery),
    path("staff/gallery/<str:photo_id>", staff_views.delete_photo),
    # --- chat -----------------------------------------------------------------
    path("messages", message_views.thread),
    path("messages/contacts", message_views.contacts),
    # --- admin ----------------------------------------------------------------
    path("admin/overview", admin_views.overview),
    path("admin/staff", admin_views.staff_list),
    path("admin/staff/invite", admin_views.invite_staff),
    path("admin/staff/<str:staff_id>", admin_views.update_staff),
    path("admin/customers", admin_views.customers),
    path("admin/activity", admin_views.activity),
    path("admin/gallery", admin_views.gallery_moderation),
    path("admin/gallery/<str:photo_id>", admin_views.moderate_photo),
    path("admin/site-assets/<str:key>", admin_views.set_site_asset),
    path("admin/campaigns", admin_views.campaigns),
]
