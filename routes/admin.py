"""
ADMIN  -  live dashboard, exports and resets (token protected: ?token=<ADMIN_TOKEN>).

Page
    GET  /admin/                           dashboard UI

API (used by static/js/admin.js)
    GET  /api/admin/data?study=&scope=     counts, quota, headlines, QC flags, recent
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

from flask import (Blueprint, Response, current_app, jsonify, render_template,
                   send_from_directory)

from core import xlsx_export
from core.auth import admin_required
from core.qc import qc_flags
from core.reporting import build_sheets
from models import Respondent, Study, StudyError

from .helpers import attachment, error, records, scope_arg, stamp, study_arg

bp = Blueprint("admin", __name__)


@bp.get("/admin/")
@admin_required("page")
def page():
    return render_template("admin/dashboard.html")


@bp.get("/api/admin/data")
@admin_required()
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
        "token": current_app.config["ADMIN_TOKEN"],
    })


@bp.post("/admin/reset")
@admin_required()
def reset():
    slug, scope = study_arg(), scope_arg("test")
    try:
        n = Respondent.reset(Study.get(slug), scope)
    except StudyError as e:
        return error(e)
    return jsonify({"ok": True, "scope": scope, "study": slug, "deleted_respondents": n})


@bp.get("/admin/export.xlsx")
@admin_required("text")
def export_xlsx():
    slug, scope = study_arg(), scope_arg()
    sheets = build_sheets(records(slug, scope), scope, Study.cfg_of(slug))
    data, backend = xlsx_export.build_workbook(sheets)
    return attachment(
        data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        f"{slug}_responses_{scope}_{stamp()}.xlsx", {"X-Export-Backend": backend})


@bp.get("/admin/export.csv")
@admin_required("text")
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
@admin_required("text")
def export_json():
    slug, scope = study_arg(), scope_arg()
    out = [{k: v for k, v in r.items() if k != "flat"} for r in records(slug, scope)]
    return attachment(json.dumps(out, indent=2).encode(), "application/json; charset=utf-8",
                      f"{slug}_responses_{scope}_{stamp()}.json")


@bp.get("/admin/voice/<path:name>")
@admin_required("text")
def voice(name):
    name = os.path.basename(name)
    ctype = ("audio/mp4" if name.endswith((".m4a", ".mp4"))
             else "audio/ogg" if name.endswith((".ogg", ".opus")) else "audio/webm")
    return send_from_directory(current_app.config["VOICE_DIR"], name, mimetype=ctype,
                               conditional=True)
