"""
ADMIN  -  live dashboard, exports and resets.

Page
    GET  /admin/                           dashboard UI

API (used by static/js/admin.js)
    GET  /api/admin/data?study=&scope=     counts, quota, headlines, QC flags, recent
    GET  /api/admin/verbatims?study=&scope=  free-text review queue (AI / proofreading)
    POST /admin/reset?study=&scope=        clear respondents (scope test|real|all)
    GET  /admin/export.xlsx|.csv|.json     downloads (?study=&scope=)
    GET  /admin/voice/<file>               a respondent's voice recording
"""

from __future__ import annotations

import csv
import io
import json
import os
import time

from flask import (Blueprint, Response, current_app, jsonify, render_template, request,
                   send_from_directory)

from core import xlsx_export
from core.ai_detect import VERDICT_LIKELY, VERDICT_POSSIBLE, ai_settings, duplicate_verbatims
from core.qc import free_text, qc_flags, score_free_text
from core.reporting import build_sheets
from models import Respondent, Study, StudyError

from .helpers import attachment, error, records, scope_arg, stamp, study_arg

bp = Blueprint("admin", __name__)


@bp.get("/admin/")
def page():
    return render_template("admin/dashboard.html")


def _verbatim_qs(cfg: dict) -> list:
    return [(q, "_") for q in (cfg.get("qc", {}) or {}).get("verbatim_qs", [])]


def ai_summary(recs: list, cfg: dict) -> dict:
    """Roll-up of the free-text AI check across the whole field, for the dashboard."""
    answers_total = likely = possible = confirmed = 0
    per_q: dict = {}
    for r in recs:
        scored = score_free_text(r["answers"], cfg, _verbatim_qs(cfg))
        for qid, res in scored.items():
            answers_total += 1
            if res["verdict"] == VERDICT_LIKELY:
                likely += 1
            elif res["verdict"] == VERDICT_POSSIBLE:
                possible += 1
            if (r["answers"].get(qid, {}).get("_ai") or {}).get("ack"):
                confirmed += 1
            q = per_q.setdefault(qid, {"id": qid, "answers": 0, "likely": 0, "possible": 0})
            q["answers"] += 1
            q["likely"] += res["verdict"] == VERDICT_LIKELY
            q["possible"] += res["verdict"] == VERDICT_POSSIBLE
    return {"settings": cfg.get("qc", {}).get("ai", {}) or {}, "answers_scored": answers_total,
            "likely_ai": likely, "possible_ai": possible, "confirmed_own_words": confirmed,
            "respondents_flagged": sum(1 for r in recs
                                       if "ai_generated_verbatim" in
                                       qc_flags(r["answers"], r["elapsed_seconds"] or 0,
                                                cfg, r["status"] or "complete")["flags"]),
            "per_question": sorted(per_q.values(),
                                   key=lambda x: (-x["likely"], -x["possible"], x["id"]))}


@bp.get("/api/admin/data")
def data():
    slug, scope = study_arg(), scope_arg()
    cfg = Study.cfg_of(slug)
    recs = records(slug, scope)
    complete = [r for r in recs if r["status"] == "complete"]
    screened = [r for r in recs if r["status"] == "screened_out"]
    in_prog = [r for r in recs if r["status"] == "in_progress"]

    def flags(r):
        return qc_flags(r["answers"], r["elapsed_seconds"] or 0, cfg,
                        r["status"] or "complete")["flags"]

    divisions, settings = {}, {}
    for r in complete:
        d = r["flat"].get("census_division") or "(unset)"
        s = r["flat"].get("practice_setting_group") or "(unset)"
        divisions[d] = divisions.get(d, 0) + 1
        settings[s] = settings.get(s, 0) + 1
    metrics = cfg.get("metrics") or {}
    intent_q, pct_q = metrics.get("intent_q"), metrics.get("pct_q")
    intent = [float(r["answers"].get(intent_q, {}).get("_") or 0) for r in complete] \
        if intent_q else []
    pct = [float(r["answers"].get(pct_q, {}).get("_") or 0) for r in complete] if pct_q else []
    return jsonify({
        "study": slug, "scope": scope,
        "generated": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()) + " UTC",
        "counts": {"total": len(recs), "complete": len(complete),
                   "screened_out": len(screened), "in_progress": len(in_prog)},
        "quota": {"census_division": divisions, "practice_setting": settings},
        "headlines": {
            "top2box_intent_pct": round(100 * sum(1 for v in intent if v >= 4) / len(intent), 1)
            if intent else None,
            "mean_pct_eligible": round(sum(pct) / len(pct), 1) if pct else None,
            "mean_minutes": round(sum(r["elapsed_seconds"] or 0 for r in complete) / 60 /
                                  len(complete), 1) if complete else None},
        "qc_flagged": [{"code": r["respondent_code"], "flags": flags(r)}
                       for r in complete if flags(r)],
        "recent": [{
            "code": r["respondent_code"], "is_test": bool(r["is_test"]),
            "status": r["status"], "started_at": r["started_at"],
            "completed_at": r["completed_at"],
            "minutes": round((r["elapsed_seconds"] or 0) / 60, 1),
            "screen_out": r["screen_out_at"] or "", "flags": flags(r),
        } for r in recs[-25:]][::-1],
        "conjoint": {"n_tasks": (cfg.get("conjoint") or {}).get("n_tasks", 0)},
        "ai_text": ai_summary(recs, cfg),
    })


@bp.get("/api/admin/verbatims")
def verbatims():
    """The proofreading queue: every free-text answer, worst first, with the evidence.

    Filters: ``qid`` (one question), ``verdict`` (likely_ai | possible_ai | flagged),
    ``q`` (text search).  This is the "after the field" half of the AI check - the same
    scores the respondent was warned about while answering.
    """
    slug, scope = study_arg(), scope_arg()
    cfg = Study.cfg_of(slug)
    recs = records(slug, scope)
    dups = duplicate_verbatims(recs, cfg)
    want_q, want_v = request.args.get("qid"), request.args.get("verdict")
    needle = (request.args.get("q") or "").strip().lower()

    rows = []
    for r in recs:
        scored = score_free_text(r["answers"], cfg, _verbatim_qs(cfg))
        for f in free_text(r["answers"], cfg, _verbatim_qs(cfg)):
            res = scored.get(f["qid"])
            verdict = (res or {}).get("verdict", "too_short")
            if want_q and f["qid"] != want_q:
                continue
            if want_v == "flagged" and verdict not in (VERDICT_LIKELY, VERDICT_POSSIBLE):
                continue
            if want_v and want_v != "flagged" and verdict != want_v:
                continue
            if needle and needle not in f["text"].lower():
                continue
            meta = f["meta"] or {}
            typed = (meta.get("typed_ms") or 0) / 1000.0
            rows.append({
                "code": r["respondent_code"], "is_test": bool(r["is_test"]),
                "status": r["status"], "qid": f["qid"],
                "stem": (f["question"].get("stem") or "")[:120],
                "text": f["text"][:2000], "words": len(f["text"].split()),
                "score": (res or {}).get("score"), "verdict": verdict,
                "confirmed": bool((r["answers"].get(f["qid"], {}).get("_ai") or {}).get("ack")),
                "signals": (res or {}).get("signals", []),
                "proofread": (res or {}).get("proofread", []),
                "pasted_chars": meta.get("pasted_chars", 0),
                "pasted_pct": round(100 * (meta.get("pasted_chars") or 0) /
                                    max(1, len(f["text"]))),
                "keystrokes": meta.get("keystrokes", 0),
                "chars_per_second": round(len(f["text"]) / typed, 1) if typed else None,
                "duplicate_of": dups.get((r["respondent_code"], f["qid"]), []),
            })
    order = {VERDICT_LIKELY: 0, VERDICT_POSSIBLE: 1, "human": 2, "too_short": 3}
    rows.sort(key=lambda x: (order.get(x["verdict"], 4), -(x["score"] or 0)))
    return jsonify({"study": slug, "scope": scope, "rows": rows[:500],
                    "truncated": len(rows) > 500, "settings": ai_settings(cfg),
                    "summary": ai_summary(recs, cfg)})


@bp.post("/admin/reset")
def reset():
    slug, scope = study_arg(), scope_arg("test")
    try:
        n = Respondent.reset(Study.get(slug), scope)
    except StudyError as e:
        return error(e)
    return jsonify({"ok": True, "scope": scope, "study": slug, "deleted_respondents": n})


@bp.get("/admin/export.xlsx")
def export_xlsx():
    slug, scope = study_arg(), scope_arg()
    sheets = build_sheets(records(slug, scope), scope, Study.cfg_of(slug))
    data, backend = xlsx_export.build_workbook(sheets)
    return attachment(
        data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        f"{slug}_responses_{scope}_{stamp()}.xlsx", {"X-Export-Backend": backend})


@bp.get("/admin/export.csv")
def export_csv():
    slug, scope = study_arg(), scope_arg()
    flat = [r["flat"] for r in records(slug, scope)]
    if not flat:
        return Response("respondent_code\n", mimetype="text/csv")
    cols = list(flat[0].keys())
    for f in flat:
        for k in f:
            if k not in cols:
                cols.append(k)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    w.writerows(flat)
    return attachment(buf.getvalue().encode(), "text/csv; charset=utf-8",
                      f"{slug}_responses_{scope}_{stamp()}.csv")


@bp.get("/admin/export.json")
def export_json():
    slug, scope = study_arg(), scope_arg()
    out = [{k: v for k, v in r.items() if k != "flat"} for r in records(slug, scope)]
    return attachment(json.dumps(out, indent=2).encode(), "application/json; charset=utf-8",
                      f"{slug}_responses_{scope}_{stamp()}.json")


@bp.get("/admin/voice/<path:name>")
def voice(name):
    name = os.path.basename(name)
    ctype = ("audio/mp4" if name.endswith((".m4a", ".mp4"))
             else "audio/ogg" if name.endswith((".ogg", ".opus")) else "audio/webm")
    return send_from_directory(current_app.config["VOICE_DIR"], name, mimetype=ctype,
                               conditional=True)
