"""Role-based access control for the API.

With RLS gone, *this* is the security boundary: every request carries a JWT,
we load the role from the database and check it here.
"""
from __future__ import annotations

from functools import wraps

from rest_framework.exceptions import NotFound, PermissionDenied

from .models import Role, User


def user_from_request(request) -> User | None:
    return request.user if request.user and request.user.is_authenticated else None


def require_role(*roles: str):
    """Dependency-style guard: `admin = Depends(require_role("admin"))` in DRF form."""

    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            user = user_from_request(request)
            if user is None:
                from rest_framework.exceptions import NotAuthenticated

                raise NotAuthenticated()
            if user.role not in roles:
                raise PermissionDenied("Forbidden")
            return view(request, *args, **kwargs)

        return wrapper

    return decorator


def is_staff(user: User | None) -> bool:
    return bool(user and user.is_authenticated and user.role in Role.staff_roles())


def is_admin(user: User | None) -> bool:
    return bool(user and user.is_authenticated and user.role == Role.ADMIN)


def get_object_or_404_owned(queryset, *, user: User, owner_field: str, code: str = "Not found"):
    """Fetch a row the user is allowed to see, or 404 without leaking existence."""
    obj = queryset.filter(**{owner_field: user}).first()
    if obj is None:
        raise NotFound(code)
    return obj


def assert_staff_access(user: User, target: User) -> None:
    """Staff may only act on their own rows; admins may act on anyone's."""
    if user.role == Role.ADMIN:
        return
    if user.id != target.id:
        raise PermissionDenied("Forbidden")
