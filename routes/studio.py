"""
STUDIO  -  the survey builder.

Page
    GET  /studio/                          builder UI

API (used by static/js/studio.js)
    GET  /api/studio/list                  all studies with respondent counts
    GET  /api/studio/study?slug=           one study incl. config
    GET  /api/studio/analysis?study=       quick analysis aggregates
    POST /api/studio/save                  create or update {slug?, title, cfg}
    POST /api/studio/status                {slug, status: draft|live|paused|closed}
    POST /api/studio/delete                {slug}
    POST /api/studio/duplicate             {slug} -> {slug, title}   (a full copy, as a draft)
    POST /api/studio/launch                {slug, recipients, subject?, message?} -> invite summary
    POST /api/studio/pause                 {slug}   (new starts stop, in-progress carry on)
    POST /api/studio/relaunch              {slug}
    POST /api/studio/remind                {slug, subject?, message?} -> reminder summary
    GET  /api/studio/invites?study=        recipients, outbox and what is still pending
    GET  /api/studio/invites.csv?study=    the outbox as a download
    POST /api/studio/make_conjoint         {attributes, n_tasks, seed} -> design
    POST /api/studio/narration?study=      multipart upload of a scene clip -> {clip, src, seconds}
    POST /api/studio/narration/delete      {study, clip}
    POST /api/studio/media?study=<slug>    multipart image/video attached to a question
    GET  /media/<slug>/<file>              public: respondents load attachments here
    GET  /narration/<study>/<file>         serves an uploaded clip (public - respondents play it)
"""

from __future__ import annotations

import os
import re
import secrets
import shutil
import zipfile
from io import BytesIO
from xml.etree import ElementTree

from datetime import datetime

from flask import Blueprint, abort, current_app, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

from core.conjoint import make_conjoint
from core import mailer
from core.i18n import (LANGUAGES, coverage, default_language, extract_strings,
                       valid_language)
LANGUAGES_MAP = {c: {"name": n, "native": nv, "dir": d} for c, n, nv, d in LANGUAGES}
from core.narration import clip_duration
from core.outline import build_outline
from core.reporting import analysis_for
from core.translator import TranslationError, translate_string
from models import Study, StudyError

AUDIO_EXT = {"mp3": "audio/mpeg", "m4a": "audio/mp4", "mp4": "audio/mp4",
             "ogg": "audio/ogg", "opus": "audio/ogg", "wav": "audio/wav", "webm": "audio/webm"}

from .helpers import attachment, error, json_body, records, study_arg, stamp

bp = Blueprint("studio", __name__)


@bp.get("/studio/")
def page():
    return render_template("studio/studio.html")


@bp.get("/api/studio/list")
def list_studies():
    return jsonify(Study.list_with_counts())


@bp.get("/api/studio/study")
def get_study():
    study = Study.get(request.args.get("slug") or "")
    if not study:
        return jsonify({"error": "unknown study"}), 404
    return jsonify({"slug": study.slug, "title": study.title, "status": study.status,
                    "cfg": study.cfg, "updated_at": study.updated_at})


@bp.get("/api/studio/analysis")
def analysis():
    slug = study_arg()
    return jsonify(analysis_for(records(slug), Study.cfg_of(slug)))


@bp.post("/api/studio/save")
def save():
    try:
        return jsonify({"ok": True, "slug": Study.save(json_body())})
    except StudyError as e:
        return error(e)


@bp.post("/api/studio/import-document")
def import_document():
    """Extract source text for the new-study assistant from TXT, MD or DOCX files."""
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"error": "Choose a questionnaire or brief to upload."}), 400
    name = secure_filename(upload.filename)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    raw = upload.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        return jsonify({"error": "The document must be smaller than 8 MB."}), 413
    try:
        if ext in ("txt", "md", "csv"):
            text = raw.decode("utf-8", errors="replace")
        elif ext == "docx":
            with zipfile.ZipFile(BytesIO(raw)) as doc:
                xml = doc.read("word/document.xml")
            root = ElementTree.fromstring(xml)
            text = "\n".join("".join(node.itertext()) for node in root.iter()
                               if node.tag.endswith("}p"))
        else:
            return jsonify({"error": "Use a DOCX, TXT, MD or CSV file."}), 400
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError):
        return jsonify({"error": "That document could not be read."}), 400
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return jsonify({"ok": True, "filename": name, "text": text[:50000]})


@bp.post("/api/studio/status")
def status():
    body = json_body()
    try:
        Study.set_status(body.get("slug") or "", body.get("status") or "")
    except StudyError as e:
        return error(e)
    return jsonify({"ok": True})


@bp.post("/api/studio/delete")
def delete():
    slug = json_body().get("slug") or ""
    try:
        Study.delete_with_children(slug)
    except StudyError as e:
        return error(e)
    # uploaded narration clips belong to the study - remove them with it
    for folder in (_narration_dir(secure_filename(slug)), _media_dir(secure_filename(slug))):
        if slug and os.path.isdir(folder):
            shutil.rmtree(folder, ignore_errors=True)
    return jsonify({"ok": True})


MAX_RECIPIENTS = 500          # one launch should not be able to mail a whole country by accident
MAX_REMINDERS = 2             # "Increase Reminders (2 left)" in the reference builder
EMAIL_RE = re.compile(r"^[^@\s,;<>]{1,64}@[^@\s,;<>]{1,190}\.[A-Za-z]{2,}$")


def _recipients(raw) -> tuple[list[dict], list[str]]:
    """Normalise ``["a@x.com, Dr A", {email,name}, …]`` into unique recipients + rejects."""
    out, seen, bad = [], set(), []
    for item in (raw if isinstance(raw, list) else str(raw or "").splitlines()):
        if isinstance(item, dict):
            email, name = str(item.get("email") or ""), str(item.get("name") or "")
        else:
            text = str(item or "").strip()
            email, _, name = text.partition(",")
            email, name = email.strip(), name.strip()
        if not email:
            continue
        if not EMAIL_RE.match(email) or len(email) > 254:
            bad.append(email[:80])
            continue
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"email": email, "name": name[:80]})
    return out[:MAX_RECIPIENTS], bad


def _public_link(slug: str, token: str = "", origin: str = "") -> str:
    base = (origin or "").rstrip("/")
    link = f"{base}/survey/{slug}"
    return f"{link}?rid={token}" if token else link


def _send(kind: str, slug: str, study, recipients: list[dict], subject: str, message: str,
          origin: str, tokens: dict | None = None) -> dict:
    """Send (or queue) one mail per recipient and write the outbox. Returns the summary."""
    tokens = tokens or {}
    settings = mailer.smtp_settings()
    subject = subject.strip() or mailer.invite_subject(study.title, kind)
    rows, sent, failed = [], 0, 0
    for r in recipients:
        token = tokens.get(r["email"].lower()) or secrets.token_urlsafe(8)
        link = _public_link(slug, token, origin)
        body = mailer.invite_body(study.title, link, message, kind)
        status, err = "queued", ""
        if settings:
            try:
                mailer.send_mail(r["email"], subject, body, settings)
                status, sent = "sent", sent + 1
            except mailer.MailError as e:
                status, err, failed = "failed", str(e)[:300], failed + 1
        rows.append({"email": r["email"], "name": r.get("name", ""), "kind": kind,
                     "status": status, "error": err, "link": link, "token": token})
    Study.add_invites(slug, rows)
    return {"sent": sent, "failed": failed, "queued": len(rows) - sent - failed,
            "total": len(rows), "smtp": bool(settings)}


def _invite_state(study, rows_only: bool = False) -> dict:
    """Everything the Actions buttons and the Launch/Reminder/Outbox modals need."""
    slug = study.slug
    inv = study.cfg.get("invites") or {}
    done = Study.completed_tokens(slug)
    outbox = Study.invites_of(slug)
    first_invite = {}
    for row in reversed(outbox):                       # oldest invite wins for the token
        if row["kind"] == "invite":
            first_invite.setdefault(row["email"].lower(), row)
    recipients = []
    for r in inv.get("recipients") or []:
        row = first_invite.get(str(r.get("email", "")).lower()) or {}
        token = row.get("token") or ""
        recipients.append({"email": r.get("email", ""), "name": r.get("name", ""),
                           "invited": bool(row), "link": row.get("link") or "",
                           "token": token,          # so a reminder reuses the same personal link
                           "completed": bool(token) and token in done})
    sent = sum(1 for r in outbox if r["status"] == "sent")
    failed = sum(1 for r in outbox if r["status"] == "failed")
    queued = sum(1 for r in outbox if r["status"] == "queued")
    reminders = int(inv.get("reminders") or 0)
    state = {
        "slug": slug, "status": study.status, "title": study.title,
        "link": _public_link(slug, "", request.host_url if request else ""),
        "launched_at": inv.get("launched_at") or "",
        "subject": inv.get("subject") or mailer.invite_subject(study.title),
        "message": inv.get("message") or "",
        "recipients": recipients,
        "outbox": [] if rows_only else outbox,
        "summary": {"recipients": len(recipients), "sent": sent, "failed": failed,
                    "queued": queued, "completed": sum(1 for r in recipients if r["completed"]),
                    "pending": sum(1 for r in recipients if not r["completed"])},
        "reminders_sent": reminders,
        "reminders_left": max(0, MAX_REMINDERS - reminders),
        "max_reminders": MAX_REMINDERS,
        "smtp": mailer.smtp_status(),
    }
    return state


@bp.post("/api/studio/duplicate")
def duplicate():
    slug = json_body().get("slug") or ""
    try:
        new_slug = Study.duplicate(slug)
    except StudyError as e:
        return error(e)
    return jsonify({"ok": True, "slug": new_slug, "title": Study.get(new_slug).title})


@bp.get("/api/studio/invites")
def invites():
    study = Study.get(study_arg())
    if not study:
        return jsonify({"error": "unknown study"}), 404
    return jsonify(_invite_state(study))


@bp.get("/api/studio/invites.csv")
def invites_csv():
    """The outbox as a spreadsheet: email, kind, status, link, when."""
    import csv
    from io import StringIO
    slug = study_arg()
    if not Study.get(slug):
        return jsonify({"error": "unknown study"}), 404
    buf = StringIO()
    w = csv.writer(buf)
    w.writerow(["email", "name", "kind", "status", "error", "link", "created_at", "sent_at"])
    for r in Study.invites_of(slug):
        w.writerow([r["email"], r["name"], r["kind"], r["status"], r["error"], r["link"],
                    r["created_at"], r["sent_at"]])
    return attachment(buf.getvalue().encode("utf-8"), "text/csv", f"{slug}-invites.csv")


@bp.post("/api/studio/launch")
def launch():
    """Set the study live, keep the recipient list and send the invites (outbox always)."""
    body = json_body()
    slug = body.get("slug") or ""
    study = Study.get(slug)
    if not study:
        return jsonify({"error": "unknown study"}), 404
    recipients, bad = _recipients(body.get("recipients"))
    if not recipients and body.get("require_recipients"):
        return jsonify({"error": "Add at least one email address to send invites to."}), 400
    subject = str(body.get("subject") or "")
    message = str(body.get("message") or "")
    cfg = study.cfg
    inv = cfg.get("invites") or {}
    if recipients:
        inv["recipients"] = recipients
    inv["subject"] = subject[:200]
    inv["message"] = message[:4000]
    inv["launched_at"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")   # ISO, so the card can say "just now"
    cfg["invites"] = inv
    # a tracked invite link only counts as completed when the study stores the token
    embedded = cfg.get("embedded") or []
    if recipients and not any(e.get("name") == "rid" for e in embedded):
        embedded.append({"name": "rid"})
        cfg["embedded"] = embedded
    if not body.get("draft_only"):
        study.set_status(slug, "live")
    Study.save({"slug": slug, "title": study.title, "cfg": cfg})
    result = _send("invite", slug, study, inv.get("recipients") or [], subject, message,
                   request.host_url)
    # the full invite state first, then the send summary on top: `smtp` must stay the boolean
    # ("did we really email them?") the buttons read, not the connection details
    out = _invite_state(Study.get(slug))
    out.update({"ok": True, "rejected": bad, "status": out["status"], "link": out["link"],
                "sent": result["sent"], "failed": result["failed"], "queued": result["queued"],
                "total": result["total"], "smtp": result["smtp"]})
    return jsonify(out)


@bp.post("/api/studio/remind")
def remind():
    """Nudge the recipients who have not finished yet (capped, like the reference builder)."""
    body = json_body()
    slug = body.get("slug") or ""
    study = Study.get(slug)
    if not study:
        return jsonify({"error": "unknown study"}), 404
    state = _invite_state(study)
    if state["reminders_left"] <= 0:
        return jsonify({"error": f"All {MAX_REMINDERS} reminders have already been sent."}), 400
    pending = [r for r in state["recipients"] if not r["completed"]]
    if not pending:
        return jsonify({"error": "Everyone on the list has already taken part."}), 400
    subject = str(body.get("subject") or (study.cfg.get("invites") or {}).get("subject") or "")
    message = str(body.get("message") or (study.cfg.get("invites") or {}).get("message") or "")
    tokens = {r["email"].lower(): r["token"] for r in pending if r.get("token")}
    result = _send("reminder", slug, study, [{"email": r["email"], "name": r["name"]} for r in pending],
                   subject, message, request.host_url, tokens)
    cfg = dict(study.cfg)
    inv = cfg.get("invites") or {}
    inv["reminders"] = int(inv.get("reminders") or 0) + 1
    inv["subject"] = subject[:200]
    inv["message"] = message[:4000]
    cfg["invites"] = inv
    Study.save({"slug": slug, "title": study.title, "cfg": cfg})
    state = _invite_state(Study.get(slug))
    state.update({"ok": True, "reminded": len(pending), "sent": result["sent"],
                  "failed": result["failed"], "queued": result["queued"],
                  "total": result["total"], "smtp": result["smtp"]})
    return jsonify(state)


@bp.post("/api/studio/pause")
def pause():
    """Pause a live study: no new respondents, anyone already answering can still finish."""
    slug = json_body().get("slug") or ""
    study = Study.get(slug)
    if not study:
        return jsonify({"error": "unknown study"}), 404
    if study.status != "live":
        return jsonify({"error": "Only a live study can be paused."}), 400
    study.set_status(slug, "paused")
    return jsonify({"ok": True, "status": "paused"})


@bp.post("/api/studio/relaunch")
def relaunch():
    slug = json_body().get("slug") or ""
    study = Study.get(slug)
    if not study:
        return jsonify({"error": "unknown study"}), 404
    if study.status not in ("paused", "closed", "draft"):
        return jsonify({"error": "This study is already live."}), 400
    study.set_status(slug, "live")
    return jsonify({"ok": True, "status": "live", "link": _public_link(slug, "", request.host_url)})


@bp.get("/api/studio/languages")
def languages():
    """The globalisation catalogue: every approved field language."""
    return jsonify({"default": "en-US",
                    "languages": [{"code": c, "name": n, "native": nv, "dir": d}
                                  for c, n, nv, d in LANGUAGES]})


def _base_of(study):
    """The question config a study translates: its own, or its parent's when it is a
    translation child.  Children therefore inherit every parent edit automatically."""
    if study.is_child():
        parent = study.parent_study()
        return parent.cfg if parent else study.cfg
    return study.cfg


@bp.get("/api/studio/children")
def children():
    """The translation children of a parent study."""
    study = Study.get(study_arg())
    if not study:
        return jsonify({"error": "unknown study"}), 404
    return jsonify({"children": [
        {"slug": ch.slug, "language": ch.cfg.get("language"),
         "title": ch.title, "translations": ch.cfg.get("translations") or {},
         "complete": 0} for ch in Study.children_of(study.slug)]})


@bp.post("/api/studio/globalize")
def globalize():
    """Create (or return) the translation child for one language of a parent study."""
    body = json_body()
    parent = Study.get(body.get("slug") or "")
    lang = body.get("lang") or ""
    if not parent or parent.is_child():
        return jsonify({"error": "unknown parent study"}), 404
    if not valid_language(lang) or lang == default_language(parent.cfg):
        return jsonify({"error": "bad language"}), 400
    slug = f"{parent.slug}--{lang.lower()}"
    if Study.get(slug):
        return jsonify({"ok": True, "slug": slug, "existing": True})
    meta = LANGUAGES_MAP.get(lang, {})
    cfg = {"parent": parent.slug, "language": lang,
           "translations": {lang: dict((parent.cfg.get("translations") or {}).get(lang) or {})},
           "title": f"{parent.title} \u2013 {meta.get('native', lang)}"}
    Study.save({"slug": slug, "title": cfg["title"], "cfg": cfg})
    return jsonify({"ok": True, "slug": slug})


@bp.get("/api/studio/strings")
def strings():
    """The respondent-visible strings plus one language's translations, for the
    Globalize panel.  Team-facing text never appears here, so it can't be translated."""
    study = Study.get(study_arg())
    if not study:
        return jsonify({"error": "unknown study"}), 404
    base = _base_of(study)
    lang = request.args.get("lang") or (study.cfg.get("language") if study.is_child() else "") or ""
    strings = extract_strings(base)
    table = (study.cfg.get("translations") or {}).get(lang) or {}
    merged = dict(base)
    if lang:
        merged["translations"] = {lang: table}
    return jsonify({"strings": strings, "default_language": default_language(base),
                    "language": lang, "translations": table,
                    "parent": study.cfg.get("parent") or "",
                    "coverage": coverage(merged, lang) if lang else None,
                    "languages": sorted((study.cfg.get("translations") or {}).keys())})


@bp.post("/api/studio/move")
def move():
    body = json_body()
    old_slug = body.get("slug") or ""
    kids = [ch.slug for ch in Study.children_of(old_slug)]
    try:
        new_slug = Study.move(old_slug, body.get("new_slug") or "")
    except StudyError as e:
        return error(e)
    for kslug in kids:                      # keep translation children attached
        ch = Study.get(kslug)
        ch.cfg["parent"] = new_slug
        Study.save({"slug": ch.slug, "title": ch.title, "cfg": ch.cfg})
    # uploaded media and narration clips are keyed by slug - they travel with the study
    for folder in (_media_dir, _narration_dir):
        src, dst = folder(secure_filename(old_slug)), folder(secure_filename(new_slug))
        if old_slug != new_slug and os.path.isdir(src):
            shutil.move(src, dst)
    return jsonify({"ok": True, "slug": new_slug})


@bp.get("/api/studio/outline.docx")
def outline():
    """Download Word Outline - a client-circulation .docx of the questionnaire."""
    study = Study.get(study_arg())
    if not study:
        return jsonify({"error": "unknown study"}), 404
    lang = request.args.get("lang") or (study.cfg.get("language") if study.is_child() else None)
    data = build_outline(_base_of(study), lang)
    return attachment(data,
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                      f"{study.slug}_outline_{lang or default_language(study.cfg)}_{stamp()}.docx")


def _merged_for(study, lang: str) -> dict:
    study = Study.get(study.slug) or study          # re-read: translations may have saved
    base = _base_of(study)
    merged = dict(base)
    merged["translations"] = {lang: (study.cfg.get("translations") or {}).get(lang) or {}}
    return merged


def _save_translations(slug: str, lang: str, strings: dict) -> None:
    study = Study.get(slug)
    cfg = study.cfg
    table = cfg.setdefault("translations", {}).setdefault(lang, {})
    known = {x["key"] for x in extract_strings(_base_of(study))}
    for key, text in (strings or {}).items():
        if key in known:
            if (text or "").strip():
                table[key] = str(text)[:MAX_TR]
            else:
                table.pop(key, None)
    if not table:
        cfg["translations"].pop(lang, None)
    Study.save({"slug": slug, "title": study.title, "cfg": cfg})


MAX_TR = 4000


@bp.post("/api/studio/translate")
def translate():
    """Manual translation: save respondent-visible strings for one language."""
    body = json_body()
    slug, lang = body.get("slug") or "", body.get("lang") or ""
    study = Study.get(slug)
    if not study:
        return jsonify({"error": "unknown study"}), 404
    if not valid_language(lang) or lang == default_language(_base_of(study)):
        return jsonify({"error": "bad language"}), 400
    _save_translations(slug, lang, body.get("strings") or {})
    return jsonify({"ok": True, "coverage": coverage(_merged_for(study, lang), lang)})


@bp.post("/api/studio/autotranslate")
def autotranslate():
    """AI-translate respondent-visible strings that have no manual translation yet.

    Keys may be passed to translate a subset; by default every missing string is done.
    Strings that already have a manual translation are never overwritten.  On a network
    failure each string is reported in ``failed`` and left for manual translation.
    """
    body = json_body()
    slug, lang = body.get("slug") or "", body.get("lang") or ""
    study = Study.get(slug)
    if not study:
        return jsonify({"error": "unknown study"}), 404
    cfg = study.cfg
    src = default_language(_base_of(study))
    if not valid_language(lang) or lang == src:
        return jsonify({"error": "bad language"}), 400
    table = (cfg.get("translations") or {}).get(lang) or {}
    want = body.get("keys")
    strings, failed, done = {}, {}, 0
    for x in extract_strings(_base_of(study)):
        if want is not None and x["key"] not in want:
            continue
        if (table.get(x["key"]) or "").strip():
            continue
        html = x["key"].endswith("_html")
        try:
            strings[x["key"]] = translate_string(x["text"], lang, src.split("-")[0],
                                                 html=html)
            done += 1
        except TranslationError as e:
            failed[x["key"]] = str(e)
    if strings:
        _save_translations(slug, lang, strings)
    return jsonify({"ok": True, "translated": done, "failed": failed,
                    "coverage": coverage(_merged_for(study, lang), lang)})


@bp.post("/api/studio/make_conjoint")
def conjoint():
    """Build a design from the attributes authored on the conjoint question.

    ``n_tasks`` is the number of choice sets and ``n_alts`` the number of cards per set.
    """
    body = json_body()
    n_tasks = max(1, min(60, int(body.get("n_tasks", 9) or 9)))
    n_alts = max(2, min(6, int(body.get("n_alts", 3) or 3)))
    try:
        design = make_conjoint(body.get("attributes", []), n_tasks,
                               int(body.get("seed", 1)), n_alts)
    except (KeyError, ValueError, TypeError, ZeroDivisionError, IndexError) as e:
        return jsonify({"error": str(e)}), 400
    design["generated_at"] = stamp()
    return jsonify(design)


# ---------------------------------------------------------------- narration clips
def _narration_dir(slug: str) -> str:
    return os.path.join(current_app.config["NARRATION_DIR"], slug)


@bp.post("/api/studio/narration")
def upload_narration():
    slug = request.args.get("study") or ""
    if not Study.get(slug):
        return jsonify({"error": "unknown study"}), 404
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "no file"}), 400
    ext = secure_filename(f.filename).rsplit(".", 1)[-1].lower() if "." in f.filename else ""
    if ext not in AUDIO_EXT:
        return jsonify({"error": "unsupported audio format (mp3, m4a, ogg, wav, webm)"}), 400
    data = f.read()
    if not data:
        return jsonify({"error": "empty file"}), 400
    if len(data) > current_app.config["NARRATION_MAX_BYTES"]:
        return jsonify({"error": "clip too large (max 8 MB)"}), 400
    clip = "clip_" + secrets.token_hex(4)
    folder = _narration_dir(slug)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{clip}.{ext}")
    with open(path, "wb") as out:
        out.write(data)
    seconds = clip_duration(path)
    return jsonify({"ok": True, "clip": clip, "file": f"{clip}.{ext}",
                    "src": f"/narration/{slug}/{clip}.{ext}", "seconds": seconds,
                    "bytes": len(data)})


@bp.post("/api/studio/narration/delete")
def delete_narration():
    body = json_body()
    slug, clip = str(body.get("study") or ""), str(body.get("clip") or "")
    if not re.fullmatch(r"clip_[0-9a-f]{8}", clip):
        return jsonify({"error": "bad clip id"}), 400
    folder = _narration_dir(slug)
    removed = 0
    if os.path.isdir(folder):
        for name in os.listdir(folder):
            if name.rsplit(".", 1)[0] == clip:
                os.remove(os.path.join(folder, name))
                removed += 1
    return jsonify({"ok": True, "removed": removed})


# ---------------------------------------------------------------- question media
IMAGE_EXT = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
             "webp": "image/webp", "svg": "image/svg+xml"}
VIDEO_EXT = {"mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime"}
# audio shares the media folder with images and video - a row or a column can carry any of them
AUDIO_MEDIA_EXT = {"mp3": "audio/mpeg", "m4a": "audio/mp4", "ogg": "audio/ogg",
                   "opus": "audio/ogg", "wav": "audio/wav", "aac": "audio/aac"}
MEDIA_EXT = dict(IMAGE_EXT, **AUDIO_MEDIA_EXT, **VIDEO_EXT)


def _media_dir(slug: str) -> str:
    return os.path.join(current_app.config["MEDIA_DIR"], slug)


@bp.post("/api/studio/media")
def upload_media():
    slug = request.args.get("study") or ""
    if not Study.get(slug):
        return jsonify({"error": "unknown study"}), 404
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "no file"}), 400
    ext = secure_filename(f.filename).rsplit(".", 1)[-1].lower() if "." in f.filename else ""
    if ext not in MEDIA_EXT:
        return jsonify({"error": "unsupported file (png, jpg, gif, webp, svg, mp3, wav, m4a, ogg, mp4, webm, mov)"}), 400
    data = f.read()
    if not data:
        return jsonify({"error": "empty file"}), 400
    if len(data) > current_app.config["MEDIA_MAX_BYTES"]:
        return jsonify({"error": "file too large (max 10 MB)"}), 400
    if ext == "svg" and re.search(rb"<script|on[a-z]+\s*=|javascript:", data, re.I):
        return jsonify({"error": "svg contains scripting"}), 400
    name = "m_" + secrets.token_hex(4) + "." + ext
    folder = _media_dir(slug)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), "wb") as out:
        out.write(data)
    return jsonify({"ok": True, "file": name, "src": f"/media/{slug}/{name}",
                    "kind": "video" if ext in VIDEO_EXT else "audio" if ext in AUDIO_MEDIA_EXT else "image",
                    "bytes": len(data)})


@bp.post("/api/studio/media/delete")
def delete_media():
    body = json_body()
    slug, name = str(body.get("study") or ""), os.path.basename(str(body.get("file") or ""))
    if not re.fullmatch(r"m_[0-9a-f]{8}\.[a-z0-9]+", name):
        return jsonify({"error": "bad file"}), 400
    path = os.path.join(_media_dir(slug), name)
    if os.path.isfile(path):
        os.remove(path)
        return jsonify({"ok": True, "removed": 1})
    return jsonify({"ok": True, "removed": 0})


@bp.get('/media/<regex("[a-zA-Z0-9\\-]+"):slug>/<path:name>')
def serve_media(slug, name):
    name = os.path.basename(name)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in MEDIA_EXT:
        abort(404)
    resp = send_from_directory(_media_dir(slug), name, mimetype=MEDIA_EXT[ext], conditional=True)
    if ext == "svg":
        resp.headers["Content-Security-Policy"] = "script-src 'none'"
    return resp


@bp.get('/narration/<regex("[a-zA-Z0-9\\-]+"):slug>/<path:name>')
def serve_narration(slug, name):
    """Uploaded clips are public: respondents' browsers stream them during the walkthrough."""
    name = os.path.basename(name)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in AUDIO_EXT:
        abort(404)
    return send_from_directory(_narration_dir(slug), name, mimetype=AUDIO_EXT[ext],
                               conditional=True)
