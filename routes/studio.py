"""
STUDIO  -  the survey builder (token protected: ?token=<ADMIN_TOKEN>).

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

from core.auth import admin_required
from core.conjoint import make_conjoint
from core.narration import clip_duration
from core.reporting import analysis_for
from models import Study, StudyError

AUDIO_EXT = {"mp3": "audio/mpeg", "m4a": "audio/mp4", "mp4": "audio/mp4",
             "ogg": "audio/ogg", "opus": "audio/ogg", "wav": "audio/wav", "webm": "audio/webm"}

from .helpers import error, json_body, records, study_arg

bp = Blueprint("studio", __name__)


@bp.get("/studio/")
@admin_required("page")
def page():
    return render_template("studio/studio.html")


@bp.get("/api/studio/list")
@admin_required()
def list_studies():
    return jsonify(Study.list_with_counts())


@bp.get("/api/studio/study")
@admin_required()
def get_study():
    study = Study.get(request.args.get("slug") or "")
    if not study:
        return jsonify({"error": "unknown study"}), 404
    return jsonify({"slug": study.slug, "title": study.title, "status": study.status,
                    "cfg": study.cfg, "updated_at": study.updated_at})


@bp.get("/api/studio/analysis")
@admin_required()
def analysis():
    slug = study_arg()
    return jsonify(analysis_for(records(slug), Study.cfg_of(slug)))


@bp.post("/api/studio/save")
@admin_required()
def save():
    try:
        return jsonify({"ok": True, "slug": Study.save(json_body())})
    except StudyError as e:
        return error(e)


@bp.post("/api/studio/status")
@admin_required()
def status():
    body = json_body()
    try:
        Study.set_status(body.get("slug") or "", body.get("status") or "")
    except StudyError as e:
        return error(e)
    return jsonify({"ok": True})


@bp.post("/api/studio/delete")
@admin_required()
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


@bp.post("/api/studio/make_conjoint")
@admin_required()
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
@admin_required()
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
@admin_required()
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
@admin_required()
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
@admin_required()
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
