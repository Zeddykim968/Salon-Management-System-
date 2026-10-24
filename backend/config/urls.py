"""URL configuration: API first, Django admin parked at /backoffice."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

admin.site.site_header = "Salon Platform administration"
admin.site.site_title = "Salon admin"
admin.site.index_title = "Staff, bookings and content"

urlpatterns = [
    path("backoffice/", admin.site.urls),  # Django admin (not /admin — API owns it)
    path("", include("core.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
