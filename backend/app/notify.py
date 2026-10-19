"""Email (Resend) + WhatsApp Cloud API senders.

Both integrations fail soft: when a key is missing or a provider errors, the
event is logged and the caller falls back to the other channel (or simply
continues). Templates used with WhatsApp must be pre-approved in Meta
Business Manager: booking_request, booking_confirmation, reminder, promotion.
"""
from __future__ import annotations

import logging
from typing import Iterable

import httpx

from .config import settings

log = logging.getLogger("api.notify")

_TIMEOUT = 8.0


# ---------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------
def send_email(to: str, subject: str, html: str, text: str = "") -> bool:
    if not to:
        return False
    if not settings.resend_configured:
        log.info("[email:skipped] RESEND_API_KEY missing — to=%s subject=%r", to, subject)
        return False
    try:
        import resend

        resend.api_key = settings.resend_api_key
        resend.Emails.send(
            {
                "from": settings.email_from,
                "to": [to],
                "subject": subject,
                "html": html,
                "text": text or _strip_tags(html),
            }
        )
        log.info("[email:sent] to=%s subject=%r", to, subject)
        return True
    except Exception:  # noqa: BLE001
        log.exception("email to %s failed", to)
        return False


def send_whatsapp_template(
    phone: str | None,
    template: str,
    params: Iterable[str] | None = None,
    language: str = "en",
) -> bool:
    """Send an approved template message via the WhatsApp Cloud API."""
    phone = _normalise_phone(phone)
    if not phone:
        return False
    if not settings.whatsapp_configured:
        log.info(
            "[whatsapp:skipped] token missing — template=%s to=%s", template, phone
        )
        return False

    components = None
    values = [str(p) for p in (params or []) if p is not None]
    if values:
        components = [
            {
                "type": "body",
                "parameters": [{"type": "text", "text": v} for v in values],
            }
        ]

    payload: dict = {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "template",
        "template": {"name": template, "language": {"code": language}},
    }
    if components:
        payload["template"]["components"] = components

    url = (
        f"https://graph.facebook.com/{settings.whatsapp_api_version}"
        f"/{settings.whatsapp_phone_number_id}/messages"
    )
    try:
        resp = httpx.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {settings.whatsapp_token}"},
            timeout=_TIMEOUT,
        )
        if resp.status_code >= 400:
            log.warning(
                "whatsapp template %s to %s failed: %s %s",
                template,
                phone,
                resp.status_code,
                resp.text[:300],
            )
            return False
        log.info("[whatsapp:sent] template=%s to=%s", template, phone)
        return True
    except Exception:  # noqa: BLE001
        log.exception("whatsapp to %s failed", phone)
        return False


def _normalise_phone(phone: str | None) -> str | None:
    """E.164 digits only, no leading '+' (Kenya default: 254…)."""
    if not phone:
        return None
    digits = "".join(c for c in str(phone) if c.isdigit())
    if not digits:
        return None
    if len(digits) < 7 or len(digits) > 15:
        return None
    return digits


# ---------------------------------------------------------------------------
# booking lifecycle notifications (WhatsApp template, email fallback)
# ---------------------------------------------------------------------------
def notify_booking_requested(
    *,
    staff_name: str,
    staff_email: str | None,
    staff_whatsapp: str | None,
    customer_name: str,
    service_name: str,
    when_label: str,
) -> None:
    ok = send_whatsapp_template(
        staff_whatsapp,
        "booking_request",
        [customer_name or "A customer", service_name, when_label],
    )
    if not ok:
        send_email(
            staff_email or "",
            f"New booking request — {service_name}",
            _wrap(
                f"Hi {staff_name},",
                f"<p><b>{customer_name or 'A customer'}</b> requested <b>{service_name}</b> "
                f"on <b>{when_label}</b>.</p>"
                "<p>Open your schedule to confirm or decline.</p>",
            ),
        )


def notify_booking_confirmed(
    *,
    customer_name: str,
    customer_email: str | None,
    customer_phone: str | None,
    staff_name: str,
    service_name: str,
    when_label: str,
) -> None:
    ok = send_whatsapp_template(
        customer_phone,
        "booking_confirmation",
        [service_name, when_label, staff_name],
    )
    if not ok:
        send_email(
            customer_email or "",
            f"Booking confirmed — {service_name}",
            _wrap(
                f"Hi {customer_name or 'there'},",
                f"<p>Your <b>{service_name}</b> with <b>{staff_name}</b> is "
                f"<b>confirmed</b> for <b>{when_label}</b>.</p>"
                "<p>See you at the salon 💇‍♀️💅</p>",
            ),
        )


def notify_booking_closed(
    *,
    kind: str,  # declined | cancelled | completed
    to_name: str,
    to_email: str | None,
    service_name: str,
    when_label: str,
    other_name: str,
) -> None:
    headlines = {
        "declined": "Booking declined",
        "cancelled": "Booking cancelled",
        "completed": "Appointment complete",
    }
    sentences = {
        "declined": f"{other_name} declined your appointment. Pick another slot anytime.",
        "cancelled": f"{other_name} cancelled the appointment for {when_label}.",
        "completed": f"Your {service_name} appointment is marked complete. Rate us soon!",
    }
    kind = kind if kind in sentences else "cancelled"
    send_email(
        to_email or "",
        f"{headlines[kind]} — {service_name}",
        _wrap(
            f"Hi {to_name or 'there'},",
            f"<p>{sentences[kind]}</p>",
        ),
    )


def notify_reminder(
    *,
    to_name: str,
    to_email: str | None,
    to_phone: str | None,
    service_name: str,
    when_label: str,
    staff_name: str,
) -> None:
    ok = send_whatsapp_template(
        to_phone,
        "reminder",
        [service_name, when_label, staff_name],
    )
    if not ok:
        send_email(
            to_email or "",
            f"Reminder — {service_name} {when_label}",
            _wrap(
                f"Hi {to_name or 'there'},",
                f"<p>Reminder: <b>{service_name}</b> with <b>{staff_name}</b> "
                f"on <b>{when_label}</b>.</p>",
            ),
        )


def send_campaign_email(to: str, subject: str, body: str) -> bool:
    paragraphs = "".join(f"<p>{line}</p>" for line in body.splitlines() if line.strip())
    return send_email(to, subject or "Salon offer", _wrap("Special offer 🎉", paragraphs))


def send_campaign_whatsapp(phone: str | None, body: str, subject: str = "") -> bool:
    # Promotions must use a pre-approved template.
    return send_whatsapp_template(phone, "promotion", [subject or "", body])


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _wrap(greeting: str, html: str) -> str:
    return (
        '<div style="font-family:Inter,Arial,sans-serif;max-width:560px;'
        'margin:0 auto;padding:24px;background:#12121a;color:#f4f4f6">'
        '<h2 style="color:#ff4fa3;margin:0 0 12px">Salon ✨</h2>'
        f'<p style="font-size:15px">{greeting}</p>'
        f'<div style="font-size:15px;line-height:1.6">{html}</div>'
        '<p style="margin-top:24px;font-size:12px;color:#8b8b9a">'
        "You are receiving this because you booked with us.</p></div>"
    )


def _strip_tags(html: str) -> str:
    out, depth = [], 0
    for ch in html:
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(ch)
    return "".join(out)
