"""Messaging integrations: Brevo (email) + wa.me click-to-chat (WhatsApp).

Email is optional in development — with no BREVO_API_KEY every send is logged
instead of sent, so the app never breaks while you are wiring keys.

WhatsApp is deliberately *not* an API call: `whatsapp_link()` only builds a
`https://wa.me/<number>?text=…` URL that opens the recipient's own WhatsApp with
the message pre-filled. Nothing is sent from the server, so there is no token,
no Meta app review and no approved-template requirement.
"""
from __future__ import annotations

import logging
import re
from html import escape
from urllib.parse import quote

import requests

from .config_helpers import frontend_origin

log = logging.getLogger("api.notify")

BREVO_URL = "https://api.brevo.com/v3/smtp/email"


def _settings():
    from django.conf import settings

    return settings


def send_email(*, to: str, subject: str, html: str, text: str | None = None) -> bool:
    """Send one email through Brevo's SMTP v3 API. Returns True when accepted."""
    if not to:
        return False
    settings = _settings()
    if not settings.BREVO_API_KEY:
        # Development fallback: surface the CTA link so verify/reset/invite
        # flows stay testable without a Brevo key.
        link = _first_link(html)
        log.info(
            "[email:skipped — no BREVO_API_KEY] to=%s subject=%s%s",
            to,
            subject,
            f" link={link}" if link else "",
        )
        return False
    try:
        response = requests.post(
            BREVO_URL,
            headers={
                "api-key": settings.BREVO_API_KEY,
                "accept": "application/json",
                "Content-Type": "application/json",
            },
            json={
                "sender": {
                    "name": settings.EMAIL_FROM_NAME,
                    "email": settings.EMAIL_FROM_ADDRESS,
                },
                "to": [{"email": to}],
                "subject": subject,
                "htmlContent": html,
                **({"textContent": text} if text else {}),
            },
            timeout=15,
        )
        if response.status_code >= 400:
            log.error("Brevo rejected send (%s): %s", response.status_code, response.text[:300])
            return False
        return True
    except requests.RequestException as exc:
        log.error("Brevo unreachable: %s", exc)
        return False


def whatsapp_link(*, to: str | None, text: str) -> str | None:
    """Build a wa.me click-to-chat URL with `text` pre-filled.

    Returns None when there is no usable number — callers treat that as
    "nothing to show", which is the WhatsApp equivalent of a skipped send.
    """
    digits = "".join(ch for ch in str(to or "") if ch.isdigit())
    if not digits:
        return None
    if len(digits) < 7:
        log.warning("whatsapp_link ignored — number too short: %r", to)
        return None
    return f"https://wa.me/{digits}?text={quote(str(text))}"


# ---------------------------------------------------------------------------
# Pretty HTML emails
# ---------------------------------------------------------------------------
def _first_link(html: str) -> str | None:
    match = re.search(r'href="(https?://[^"]+)"', html or "")
    return match.group(1) if match else None


def _shell(title: str, body: str, cta_label: str | None = None, cta_href: str | None = None) -> str:
    button = (
        f'<p style="margin:24px 0"><a href="{escape(cta_href or "#")}" '
        f'style="background:#d94fa3;color:#fff;padding:12px 22px;border-radius:999px;'
        f'text-decoration:none;font-weight:700">{escape(cta_label)}</a></p>'
        if cta_label and cta_href
        else ""
    )
    return f"""<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;
background:#fdf2f8;color:#1f1235;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;
       padding:28px;border:1px solid #f3d9ec">
    <h2 style="margin:0 0 6px;color:#a121c9">{escape(title)}</h2>
    <div style="font-size:15px;line-height:1.6">{body}</div>
    {button}
    <p style="color:#7a6a92;font-size:12px;margin-top:26px">Salon Platform ·
      <a href="{escape(frontend_origin())}" style="color:#a121c9">Book your style</a></p>
  </div>
</body></html>"""


def email_verify(*, to: str, full_name: str, link: str) -> bool:
    return send_email(
        to=to,
        subject="Confirm your email — Salon Platform",
        html=_shell(
            "Confirm your email ✉️",
            f"<p>Hi {escape(full_name or 'there')} — one last tap and you're in.</p>",
            "Verify my email",
            link,
        ),
    )


def email_invite(*, to: str, full_name: str, role: str, link: str) -> bool:
    return send_email(
        to=to,
        subject="You're invited to join the Salon team",
        html=_shell(
            "Welcome to the team 💇‍♀️",
            f"<p>Hi {escape(full_name or 'there')},</p>"
            f"<p>You've been added as <strong>{escape(role.replace('_', ' '))}</strong>. "
            "Set your password to open your workspace.</p>",
            "Set my password",
            link,
        ),
    )


def email_password_reset(*, to: str, full_name: str, link: str) -> bool:
    return send_email(
        to=to,
        subject="Reset your password — Salon Platform",
        html=_shell(
            "Password reset 🔑",
            f"<p>Hi {escape(full_name or 'there')} — use the button below to choose a new "
            "password. The link expires soon and can be used once.</p>",
            "Choose a new password",
            link,
        ),
    )


def email_campaign(*, to: str, subject: str, body: str) -> bool:
    """One promotional email (campaigns loop over recipients)."""
    paragraphs = "".join(f"<p>{escape(line)}</p>" for line in body.splitlines() if line.strip())
    return send_email(
        to=to,
        subject=subject,
        html=_shell(subject, paragraphs or f"<p>{escape(body)}</p>", "Book now", f"{frontend_origin()}/"),
    )


def email_booking_created(*, to: str, staff_name: str, service_name: str, when_text: str) -> bool:
    return send_email(
        to=to,
        subject=f"Booking request sent — {service_name}",
        html=_shell(
            "Request received ✨",
            f"<p>Hi! Your request for <strong>{escape(service_name)}</strong> with "
            f"<strong>{escape(staff_name)}</strong> on <strong>{escape(when_text)}</strong> "
            "is <em>pending</em>. You'll get a message as soon as it's confirmed.</p>",
            "View my bookings",
            f"{frontend_origin()}/account",
        ),
    )


def email_booking_answered(
    *, to: str, staff_name: str, service_name: str, when_text: str, status: str
) -> bool:
    headline = {
        "confirmed": "Booking confirmed 🎉",
        "declined": "Booking declined",
        "cancelled": "Booking cancelled",
        "completed": "Appointment complete 💇‍♀️",
    }.get(status, f"Booking update: {status}")
    sentence = {
        "confirmed": "Your slot is locked in. See you there!",
        "declined": "Unfortunately this slot couldn't be taken — try another stylist or time.",
        "cancelled": "This booking was cancelled.",
        "completed": "Thanks for visiting — we hope you love the result.",
    }.get(status, "")
    return send_email(
        to=to,
        subject=f"{headline} — {service_name}",
        html=_shell(
            headline,
            f"<p>{escape(sentence)}</p><p><strong>{escape(service_name)}</strong> with "
            f"<strong>{escape(staff_name)}</strong> · <strong>{escape(when_text)}</strong></p>",
            "Open bookings",
            f"{frontend_origin()}/account",
        ),
    )
