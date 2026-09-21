"""
STUDIO  -  the survey builder.

Page
    GET  /studio/                          builder UI

API (used by static/js/studio.js)
    GET  /api/studio/list                  all studies with respondent counts
    GET  /api/studio/study?slug=           one study incl. config
    GET  /api/studio/analysis?study=       quick analysis aggregates
    POST /api/studio/save                  create or update {slug?, title, cfg}
    POST /api/studio/status                {slug, status: draft|live|closed}
    POST /api/studio/delete                {slug}
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

from flask import Blueprint, abort, current_app, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

from core.conjoint import make_conjoint
from core.i18n import LANGUAGES, coverage, default_language, extract_strings, valid_language
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
        Study.delete(slug)
    except StudyError as e:
        return error(e)
    # uploaded narration clips belong to the study - remove them with it
    for folder in (_narration_dir(secure_filename(slug)), _media_dir(secure_filename(slug))):
        if slug and os.path.isdir(folder):
            shutil.rmtree(folder, ignore_errors=True)
    return jsonify({"ok": True})


@bp.get("/api/studio/languages")
def languages():
    """The globalisation catalogue: every approved field language."""
    return jsonify({"default": "en-US",
                    "languages": [{"code": c, "name": n, "native": nv, "dir": d}
                                  for c, n, nv, d in LANGUAGES]})


@bp.get("/api/studio/strings")
def strings():
    """The respondent-visible strings plus one language's translations, for the
    Globalize panel.  Team-facing text never appears here, so it can't be translated."""
    study = Study.get(study_arg())
    if not study:
        return jsonify({"error": "unknown study"}), 404
    lang = request.args.get("lang") or ""
    strings = extract_strings(study.cfg)
    table = (study.cfg.get("translations") or {}).get(lang) or {}
    return jsonify({"strings": strings, "default_language": default_language(study.cfg),
                    "language": lang, "translations": table,
                    "coverage": coverage(study.cfg, lang) if lang else None,
                    "languages": sorted((study.cfg.get("translations") or {}).keys())})


@bp.post("/api/studio/move")
def move():
    body = json_body()
    old_slug = body.get("slug") or ""
    try:
        new_slug = Study.move(old_slug, body.get("new_slug") or "")
    except StudyError as e:
        return error(e)
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
    lang = request.args.get("lang") or None
    data = build_outline(study.cfg, lang)
    return attachment(data,
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                      f"{study.slug}_outline_{lang or default_language(study.cfg)}_{stamp()}.docx")


def _save_translations(slug: str, lang: str, strings: dict) -> None:
    study = Study.get(slug)
    cfg = study.cfg
    table = cfg.setdefault("translations", {}).setdefault(lang, {})
    known = {x["key"] for x in extract_strings(cfg)}
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
    if not Study.get(slug):
        return jsonify({"error": "unknown study"}), 404
    if not valid_language(lang) or lang == default_language(Study.get(slug).cfg):
        return jsonify({"error": "bad language"}), 400
    _save_translations(slug, lang, body.get("strings") or {})
    return jsonify({"ok": True, "coverage": coverage(Study.get(slug).cfg, lang)})


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
    src = default_language(cfg)
    if not valid_language(lang) or lang == src:
        return jsonify({"error": "bad language"}), 400
    table = (cfg.get("translations") or {}).get(lang) or {}
    want = body.get("keys")
    strings, failed, done = {}, {}, 0
    for x in extract_strings(cfg):
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
                    "coverage": coverage(Study.get(slug).cfg, lang)})


@bp.post("/api/studio/make_conjoint")
def conjoint():
    body = json_body()
    try:
        return jsonify(make_conjoint(body.get("attributes", []), int(body.get("n_tasks", 9)),
                                     int(body.get("seed", 1))))
    except (KeyError, ValueError, TypeError, ZeroDivisionError, IndexError) as e:
        return jsonify({"error": str(e)}), 400


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
MEDIA_EXT = dict(IMAGE_EXT, **VIDEO_EXT)


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
        return jsonify({"error": "unsupported file (png, jpg, gif, webp, svg, mp4, webm, mov)"}), 400
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
                    "kind": "video" if ext in VIDEO_EXT else "image", "bytes": len(data)})


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
