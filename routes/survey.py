"""
SURVEY  -  respondent-facing app.

Pages
    GET  /survey/                 the BEACON survey
    GET  /survey/test             same survey, stored as test data (T001, T002 ...)
    GET  /survey/<slug>           any study launched from the Studio
    GET  /survey/<slug>/test      ... in test mode (also previews drafts / closed studies)
    GET  /audio/<file>            narration clips

API (used by static/js/survey.js)
    GET  /api/spec/<slug>   GET /api/progress?sid=
    POST /api/start  /api/save  /api/submit  /api/voice  /api/check_text
"""

from __future__ import annotations

import base64
import os
import re

from flask import (Blueprint, abort, current_app, jsonify, render_template, request,
                   send_from_directory)

from core.ai_detect import MAX_TEXT, ai_settings, score_text
from core.conjoint import assignment_for
from core.i18n import (LANG_BY_CODE, apply_language, default_language, extract_strings,
                       valid_language)
from core.qc import qc_flags
from core.seed import load_task_map
from core.survey_spec import TERMINATE_TEXT
from models import Respondent, Study

from .helpers import json_body

bp = Blueprint("survey", __name__)

SLUG = r'<regex("[a-zA-Z0-9\-]+"):slug>'


# ---------------------------------------------------------------- pages
def _survey_page(slug: str):
    study = Study.get(slug)
    if not study:
        abort(404, "unknown study")
    is_test = request.path.rstrip("/").endswith("/test")
    # The respondent link only opens once the study is live; test mode always renders so
    # the team can preview a draft (the Studio's "Preview" button opens /survey/<slug>/test).
    if not study.effective_live() and not is_test:
        return render_template("survey/not_live.html", slug=slug), 403
    return render_template("survey/survey.html", slug=slug, study_title=study.title,
                           is_test=is_test, is_draft=not study.effective_live())


@bp.get("/survey/")
def beacon_survey():
    return _survey_page("beacon")


@bp.get("/survey/test")
def beacon_survey_test():
    return _survey_page("beacon")


@bp.get(f"/survey/{SLUG}")
@bp.get(f"/survey/{SLUG}/test")
def study_survey(slug):
    return _survey_page(slug)


@bp.get("/audio/<path:name>")
def audio(name):
    """Narration clips; ``send_from_directory`` handles Range requests for seeking."""
    if not name.endswith(".mp3"):
        abort(404)
    return send_from_directory(os.path.join(current_app.static_folder, "audio"), name,
                               mimetype="audio/mpeg", conditional=True)


# ---------------------------------------------------------------- API
def _family_languages(home, base: dict) -> list[dict]:
    """Default language first, then one entry per translation child (plus any legacy
    inline translation), each tagged with the child slug respondents should use."""
    codes = [default_language(base)]
    for ch in home.children_of(home.slug):
        c = ch.cfg.get("language")
        if c and c not in codes:
            codes.append(c)
    for c in (base.get("translations") or {}):
        if c not in codes:
            codes.append(c)
    out = []
    for c in codes:
        meta = LANG_BY_CODE.get(c, {"code": c, "native": c, "dir": "ltr"})
        child = next((ch.slug for ch in home.children_of(home.slug)
                      if ch.cfg.get("language") == c), "")
        out.append(dict(meta, child=child))
    return out


@bp.get("/api/spec")
@bp.get(f"/api/spec/{SLUG}")
def spec(slug="beacon"):
    study = Study.get(slug)
    if not study:
        return jsonify({"error": "unknown study"}), 404
    # Child studies are translations of their parent: questions always come from the
    # parent (so parent edits flow into every child) and the child contributes only its
    # language + translation table.  ?lang= on a parent merges that language's child.
    if study.is_child():
        parent = study.parent_study()
        if not parent:
            return jsonify({"error": "parent study missing"}), 404
        home, base = parent, parent.cfg
        lang = study.cfg.get("language") or default_language(base)
        table = (study.cfg.get("translations") or {}).get(lang) or {}
        merged_src = dict(base)
        merged_src["translations"] = {lang: table}
    else:
        home, base = study, study.cfg
        lang = request.args.get("lang") or default_language(base)
        merged_src = base
    # respondent-visible strings merged over the default language; team-facing strings
    # and the QC engine always use the default
    cfg = apply_language(merged_src, lang)
    conj = cfg.get("conjoint")
    if conj and isinstance(conj.get("tasks"), list):
        conj = dict(conj, tasks={str(i + 1): t for i, t in enumerate(conj["tasks"])})
    return jsonify({
        "sections": cfg.get("sections", []),
        "questions": cfg.get("questions", []),
        "conjoint": conj,
        "terminate_text": TERMINATE_TEXT,
        "narration": cfg.get("narration", {}),
        "explainer_scenes": cfg.get("explainer_scenes", []),
        "conjoint_scene": cfg.get("conjoint_scene"),
        "conjoint_min_dwell": cfg.get("conjoint_min_dwell", 12),
        "use_tts": cfg.get("use_tts", False),
        "tpp": cfg.get("tpp", {}),
        # study-wide AI-answer check settings; questions can override with ai_check/ai_action
        "ai_check": cfg.get("qc", {}).get("ai", {}),
        # globalisation + flow objects
        "default_language": default_language(base),
        "render_language": cfg.get("render_language") or default_language(study.cfg),
        "render_dir": cfg.get("render_dir", "ltr"),
        "languages": _family_languages(home, base),
        # the original wording of every respondent string, so respondents can flip any
        # question back to the default language whenever they prefer it
        "default_text": ({} if cfg.get("render_language") == default_language(base)
                         else {x["key"]: x["text"] for x in extract_strings(base)}),
        "embedded": [e.get("name") for e in cfg.get("embedded", []) or [] if e.get("name")],
        "randomize_pages": bool(cfg.get("randomize_pages")),
        "welcome_title": cfg.get("welcome_title"), "welcome_text": cfg.get("welcome_text"),
        "thanks_title": cfg.get("thanks_title"), "thanks_text": cfg.get("thanks_text"),
    })


@bp.post("/api/start")
def start():
    body = json_body()
    slug = body.get("study") or "beacon"
    study = Study.get(slug)
    if not study:
        return jsonify({"error": "unknown study"}), 404
    if not study.effective_live():
        return jsonify({"error": "study not live"}), 403
    lang = str(body.get("language") or "")[:12]
    if lang and not valid_language(lang):
        lang = ""
    wanted = [e.get("name") for e in study.cfg.get("embedded", []) or [] if e.get("name")]
    sent = body.get("embedded") if isinstance(body.get("embedded"), dict) else {}
    embedded = {k: str(v)[:200] for k, v in sent.items() if k in wanted}
    resp = Respondent.create(study, bool(body.get("is_test")),
                             request.headers.get("User-Agent", ""), lang, embedded)
    design = study.cfg.get("conjoint")
    task_map = load_task_map() if slug == "beacon" else None
    assignment = (assignment_for(resp.code, design, task_map) if design
                  else {"task_order": [], "alt_positions": {}})
    resp.set_assignment(assignment["task_order"], assignment["alt_positions"])
    return jsonify({"session_id": resp.session_id, "respondent_code": resp.code,
                    "is_test": resp.is_test, "study": slug,
                    "task_order": assignment["task_order"],
                    "alt_positions": assignment["alt_positions"],
                    "from_prebuilt_map": resp.code in (task_map or {})})


@bp.post("/api/save")
def save():
    body = json_body()
    resp = Respondent.by_session(body.get("session_id"))
    if resp is None:
        return jsonify({"error": "unknown session"}), 400
    return jsonify({"ok": True, "status": resp.persist(body)})


@bp.post("/api/submit")
def submit():
    body = json_body()
    resp = Respondent.by_session(body.get("session_id"))
    if resp is None:
        return jsonify({"error": "unknown session"}), 400
    resp.persist(body)
    seconds = float(body.get("elapsed_seconds") or 0)
    resp.complete(seconds)
    cfg = Study.get_by_id(resp.study_id).cfg
    return jsonify({"ok": True, "respondent_code": resp.code,
                    **qc_flags(resp.answers(), seconds, cfg)})


@bp.post("/api/check_text")
def check_text():
    """Live AI-generated / pasted answer check for one free-text box.

    Called by the survey while the respondent is still typing, so the warning - and any
    request to confirm the answer is their own - happens before the answer is locked in.
    The very same scoring runs again server-side on submit and in the Admin review queue,
    so a client that never calls this endpoint cannot hide anything.
    """
    body = json_body()
    qid = str(body.get("qid") or "")[:40]
    text = str(body.get("text") or "")[:MAX_TEXT]
    meta = body.get("meta") if isinstance(body.get("meta"), dict) else None
    study = Study.get(body.get("study") or "beacon") or Study.get("beacon")
    cfg = study.cfg if study else {}
    settings = ai_settings(cfg, qid)
    res = score_text(text, meta, settings)
    return jsonify({"ok": True, "qid": qid, "enabled": settings.get("enabled", True),
                    "action": settings.get("action", "confirm"),
                    "warn_at": settings.get("warn_at"), "flag_at": settings.get("flag_at"),
                    **res})


@bp.get("/api/progress")
def progress():
    resp = Respondent.by_session(request.args.get("sid"))
    return jsonify(resp.progress() if resp else {"exists": False})


@bp.post("/api/voice")
def voice():
    body = json_body()
    qid = str(body.get("qid") or "")
    ext = str(body.get("ext") or "webm").lower()
    if ext not in ("webm", "mp4", "ogg", "opus", "m4a"):
        return jsonify({"error": "unsupported format"}), 400
    if not re.fullmatch(r"[A-Za-z0-9]+", qid):
        return jsonify({"error": "bad question id"}), 400
    try:
        raw = base64.b64decode(body.get("data") or "", validate=True)
    except (ValueError, TypeError):
        return jsonify({"error": "bad audio payload"}), 400
    if not raw or len(raw) > 2_500_000:
        return jsonify({"error": "audio too large"}), 400
    resp = Respondent.by_session(body.get("session_id"))
    if resp is None:
        return jsonify({"error": "unknown session"}), 400
    voice_dir = current_app.config["VOICE_DIR"]
    os.makedirs(voice_dir, exist_ok=True)
    fname = resp.voice_filename(qid, ext)
    with open(os.path.join(voice_dir, fname), "wb") as f:
        f.write(raw)
    return jsonify({"ok": True, "file": fname})
