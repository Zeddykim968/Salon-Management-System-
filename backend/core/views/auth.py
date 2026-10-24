"""Auth endpoints: register → verify email → login → JWT, plus staff invites."""
from __future__ import annotations

import logging

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django_ratelimit.decorators import ratelimit
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .. import notify
from ..config_helpers import frontend_origin
from ..models import Role, User
from ..serializers import MeSerializer

log = logging.getLogger("api.auth")


def _uid(user: User) -> str:
    return urlsafe_base64_encode(force_bytes(user.pk))


def _decode_uid(value: str) -> str:
    return force_str(urlsafe_base64_decode(value))


def _issue_tokens(user: User) -> dict:
    refresh = RefreshToken.for_user(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "role": user.role,
        "user": MeSerializer(user).data,
    }


def _limited(request) -> bool:
    return bool(getattr(request, "limited", False))


def _bad_request(detail: str, status: int = 400) -> Response:
    return Response({"detail": detail}, status=status)


@api_view(["POST"])
@permission_classes([AllowAny])
@ratelimit(key="ip", rate="10/hour", method="POST", block=False)
def register(request):
    """Customer self-signup. Role always starts as `customer`."""
    if _limited(request):
        return Response({"detail": "Too many attempts — try again in an hour."}, status=429)

    email = str(request.data.get("email", "")).strip().lower()
    password = str(request.data.get("password", ""))
    full_name = str(request.data.get("full_name", "")).strip()
    phone = str(request.data.get("phone", "")).strip() or None

    if not email or "@" not in email:
        return _bad_request("Enter a valid email address.")
    if not full_name:
        return _bad_request("Tell us your name.")
    try:
        validate_password(password)
    except DjangoValidationError as exc:
        return _bad_request(" ".join(exc.messages))
    if User.objects.filter(email__iexact=email).exists():
        return _bad_request("An account with this email already exists. Try signing in.")

    user = User.objects.create_user(
        email=email, password=password, full_name=full_name, phone=phone, is_active=False
    )
    token = default_token(user)
    link = f"{frontend_origin()}/auth/verify?uid={_uid(user)}&token={token}"
    notify.email_verify(to=email, full_name=full_name, link=link)
    log.info("registered %s (pending verification)", email)
    return Response(
        {"detail": "Account created — open the verification link we just emailed you.", "email": email},
        status=201,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def verify_email(request):
    """Confirm the address from the email link, then the user can sign in."""
    try:
        user = _resolve_user(str(request.data.get("uid", "")), str(request.data.get("token", "")))
    except ValueError as exc:
        return _bad_request(str(exc))
    if not user.is_active:
        user.is_active = True
        user.save(update_fields=["is_active"])
    return Response({"detail": "Email verified — you can sign in now."})


@api_view(["POST"])
@permission_classes([AllowAny])
@ratelimit(key="ip", rate="20/minute", method="POST", block=False)
def login(request):
    if _limited(request):
        return Response({"detail": "Too many sign-in attempts — wait a minute."}, status=429)

    email = str(request.data.get("email", "")).strip().lower()
    password = str(request.data.get("password", ""))
    user = authenticate(request, email=email, password=password)
    if user is None:
        return Response({"detail": "Wrong email or password."}, status=401)
    if not user.is_active:
        return Response(
            {"detail": "This account is inactive — check your inbox for the verification link."},
            status=403,
        )
    return Response(_issue_tokens(user))


@api_view(["POST"])
@permission_classes([AllowAny])
def refresh(request):
    try:
        serializer = TokenRefreshSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
    except (InvalidToken, TokenError) as exc:
        return Response({"detail": "Session expired — sign in again."}, status=401)
    data = dict(serializer.validated_data)
    data["role"] = _role_from_access(str(data.get("access", "")))
    return Response(data)


@api_view(["GET"])
def me(request):
    return Response(MeSerializer(request.user).data)


@api_view(["POST"])
@permission_classes([AllowAny])
@ratelimit(key="ip", rate="20/hour", method="POST", block=False)
def set_password(request):
    """Used by invited staff (and any account setting its first password)."""
    if _limited(request):
        return Response({"detail": "Too many attempts — try again later."}, status=429)
    try:
        user = _resolve_user(str(request.data.get("uid", "")), str(request.data.get("token", "")))
    except ValueError as exc:
        return _bad_request(str(exc))
    password = str(request.data.get("password", ""))
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        return _bad_request(" ".join(exc.messages))
    user.set_password(password)
    user.is_active = True
    user.save()
    return Response({"detail": "Password set — you can sign in now."})


@api_view(["POST"])
@permission_classes([AllowAny])
@ratelimit(key="ip", rate="10/hour", method="POST", block=False)
def password_reset_request(request):
    if _limited(request):
        return Response({"detail": "Too many attempts — try again later."}, status=429)
    email = str(request.data.get("email", "")).strip().lower()
    user = User.objects.filter(email__iexact=email).first()
    if user:  # same response either way: no account enumeration
        link = f"{frontend_origin()}/auth/reset?uid={_uid(user)}&token={default_token(user)}"
        notify.email_password_reset(to=email, full_name=user.full_name, link=link)
    return Response({"detail": "If that email has an account, a reset link is on its way."})


@api_view(["POST"])
@permission_classes([AllowAny])
@ratelimit(key="ip", rate="20/hour", method="POST", block=False)
def password_reset_confirm(request):
    if _limited(request):
        return Response({"detail": "Too many attempts — try again later."}, status=429)
    try:
        user = _resolve_user(str(request.data.get("uid", "")), str(request.data.get("token", "")))
    except ValueError as exc:
        return _bad_request(str(exc))
    password = str(request.data.get("password", ""))
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        return _bad_request(" ".join(exc.messages))
    user.set_password(password)
    user.is_active = True
    user.save()
    return Response({"detail": "Password updated — sign in with your new password."})


# --- helpers -----------------------------------------------------------------


def default_token(user: User) -> str:
    return default_token_generator.make_token(user)


def _resolve_user(uid: str, token: str) -> User:
    try:
        user = User.objects.get(pk=_decode_uid(uid))
    except Exception as exc:  # bad base64, unknown pk, malformed uuid
        raise ValueError("This link is invalid.") from exc
    if not default_token_generator.check_token(user, token):
        raise ValueError("This link has expired — request a new one.")
    return user


def _role_from_access(access: str) -> str:
    """Read the role claim out of a freshly minted access token."""
    try:
        from rest_framework_simplejwt.tokens import AccessToken

        payload = AccessToken(access).payload
        user = User.objects.filter(pk=payload.get("user_id")).first()
        return user.role if user else Role.CUSTOMER
    except Exception:  # pragma: no cover - token was just issued, so this is defensive
        return Role.CUSTOMER
