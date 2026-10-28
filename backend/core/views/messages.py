"""Chat between users (customer ↔ stylist ↔ admin)."""
from __future__ import annotations

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from django.core.exceptions import ValidationError as DjangoValidationError

from ..models import Message, Role, User
from ..serializers import MessageSerializer


def _other_user(user_id, me: User) -> User:
    try:
        other = User.objects.get(pk=user_id, is_active=True).first()
    except (ValueError, DjangoValidationError):
        other = None
    if other is None:
        raise NotFound({"user_id": "User not found."})
    if other.id == me.id:
        raise ValidationError({"user_id": "You cannot message yyourself."})
    if me.role == Role.CUSTOMER and other.role == Role.CUSTOMER:
        raise NotFound("User not found.")
    return other

def _get_thread(request):
    """Messages between me and ?user_id=… — also marks their messages read."""
    me = request.user
    other_id = request.query_params.get("user_id")
    if not other_id:
        raise ValidationError({"user_id": "user_id is required."})
    other = _other_user(other_id, me)

    Message.objects.filter(sender=other, recipient=me, read_at__isnull=True).update(
        read_at=timezone.now()
    )

    latest = (
        Message.objects.filter(Q(sender=me, recipient=other) | Q(sender=other, recipient=me))
        .order_by("-created_at")[:500]
    )
    messages = list(reversed(latest))  # oldest first for display
    return Response(MessageSerializer(messages, many=True, context={"me_id": me.id}).data)

def _send_message(request):
    me = request.user
    body = str(request.data.get("body", "")).strip()
    if not body:
        raise ValidationError({"body": "Message cannot be empty."})
    if len(body) > 4000:
        raise ValidationError({"body": "Keep it under 4000 characters."})
    other = _other_user(request.data.get("recipient_id"), me)

    message = Message.objects.create(sender=me, recipient=other, body=body)
    return Response(MessageSerializer(message, context={"me_id": me.id}).data, status=201)



@api_view(["GET", "POST"])
def thread(request):
    if request.method == "POST":
        return _send_message(request)
    return _get_thread(request)


@api_view(["GET"])
def contacts(request):
    """Everyone I'm allowed to chat with, newest conversation first."""
    me = request.user
    others = User.objects.filter(is_active=True).exclude(pk=me.pk)
    if me.role == Role.CUSTOMER:
        others = others.filter(
            Q(role__in=Role.staff_roles())
            | Q(messages_sent__recipient=me)
            | Q(messages_received__sender=me)
        )

    contacts_list = []
    for other in others.distinct():
        last = (
            Message.objects.filter(
                Q(sender=me, recipient=other) | Q(sender=other, recipient=me)
            )
            .order_by("-created_at")
            .first()
        )
        unread = Message.objects.filter(sender=other, recipient=me, read_at__isnull=True).count()
        contacts_list.append(
            {
                "id": str(other.id),
                "full_name": other.full_name,
                "role": other.role,
                "avatar_url": other.avatar_url,
                "phone": other.phone,
                "last_message": (
                    {
                        "body": last.body,
                        "created_at": last.created_at.isoformat(),
                        "from_me": last.sender_id == me.id,
                    }
                    if last
                    else None
                ),
                "unread": unread,
                "_last_at": last.created_at if last else other.date_joined,
            }
        )

    contacts_list.sort(key=lambda c: c.pop("_last_at"), reverse=True)
    return Response(contacts_list)
