"""
Study invites and reminders: SMTP when the team has configured it, always an outbox row.

Sending never depends on a mail server being reachable.  Every invite and reminder is written
to the ``invites`` table with the link it carried and a status:

* ``sent``   - the SMTP server accepted it
* ``queued`` - no SMTP is configured, so the row is the record of what would have gone out
* ``failed`` - SMTP is configured but the send raised (the reason is stored)

Credentials are read from the environment and then from ``data/mail.json`` (never from the
database, and never echoed back to the browser - :func:`smtp_status` reports the host and the
from-address only)::

    BEACON_SMTP_HOST, BEACON_SMTP_PORT, BEACON_SMTP_USER, BEACON_SMTP_PASSWORD,
    BEACON_SMTP_FROM, BEACON_SMTP_TLS=starttls|ssl|none

``data/mail.json`` takes the same names in lower case, e.g.
``{"host": "smtp.example.com", "port": 587, "user": "…", "password": "…", "from": "…"}``.
"""

from __future__ import annotations

import json
import os
import smtplib
import ssl
from email.message import EmailMessage
from pathlib import Path

MAIL_CONFIG = Path(__file__).resolve().parent.parent / "data" / "mail.json"
DEFAULT_PORT = 587


class MailError(RuntimeError):
    """Raised when the SMTP server refuses or cannot be reached."""


def _from_file() -> dict:
    try:
        data = json.loads(MAIL_CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def smtp_settings() -> dict | None:
    """The SMTP settings in force, or ``None`` when no host has been configured."""
    src = _from_file()
    pick = lambda key, env: os.environ.get(env) or src.get(key) or ""
    host = pick("host", "BEACON_SMTP_HOST")
    if not host:
        return None
    tls = (pick("tls", "BEACON_SMTP_TLS") or "starttls").lower()
    try:
        port = int(pick("port", "BEACON_SMTP_PORT") or (465 if tls == "ssl" else DEFAULT_PORT))
    except ValueError:
        port = DEFAULT_PORT
    return {
        "host": host.strip(),
        "port": port,
        "user": pick("user", "BEACON_SMTP_USER").strip(),
        "password": pick("password", "BEACON_SMTP_PASSWORD"),
        "from": (pick("from", "BEACON_SMTP_FROM") or pick("user", "BEACON_SMTP_USER")
                 or f"no-reply@{host.split(':')[0]}").strip(),
        "tls": tls if tls in ("starttls", "ssl", "none") else "starttls",
    }


def smtp_status() -> dict:
    """What the Studio may show about mail: host and sender, never the password."""
    s = smtp_settings()
    if not s:
        return {"configured": False, "host": "", "from": "", "tls": "",
                "hint": "Set BEACON_SMTP_HOST (and user/password) or add data/mail.json to send "
                        "for real - invites are recorded in the outbox either way."}
    return {"configured": True, "host": s["host"], "port": s["port"], "from": s["from"],
            "tls": s["tls"], "hint": ""}


def send_mail(to: str, subject: str, body: str, settings: dict | None = None) -> None:
    """Send one plain-text message. Raises :class:`MailError` if it cannot be delivered."""
    s = settings or smtp_settings()
    if not s:
        raise MailError("no SMTP server configured")
    msg = EmailMessage()
    msg["From"] = s["from"]
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        if s["tls"] == "ssl":
            with smtplib.SMTP_SSL(s["host"], s["port"], timeout=20,
                                  context=ssl.create_default_context()) as smtp:
                if s["user"]:
                    smtp.login(s["user"], s["password"])
                smtp.send_message(msg)
            return
        with smtplib.SMTP(s["host"], s["port"], timeout=20) as smtp:
            smtp.ehlo()
            if s["tls"] == "starttls":
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
            if s["user"]:
                smtp.login(s["user"], s["password"])
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException) as e:
        raise MailError(str(e) or e.__class__.__name__) from e


def invite_subject(study_title: str, kind: str = "invite") -> str:
    if kind == "reminder":
        return f"Reminder: {study_title}"
    return f"You are invited: {study_title}"


def invite_body(study_title: str, link: str, message: str = "", kind: str = "invite") -> str:
    """The plain-text invite/reminder. The link always carries the recipient's own token."""
    lines = []
    if message.strip():
        lines += [message.strip(), ""]
    if kind == "reminder":
        lines += [f"A quick reminder about {study_title}.", ""]
    else:
        lines += [f"You have been invited to take part in {study_title}.", ""]
    lines += ["Take part here:", link, ""]
    lines += ["This link is personal to you - please do not forward it.",
              "The research team"]
    return "\n".join(lines)
