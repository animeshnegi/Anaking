"""Small helpers shared by the route modules."""

from __future__ import annotations

import time

from flask import Response, jsonify, request

from core.reporting import flatten
from models import Respondent, Study, StudyError


def json_body() -> dict:
    return request.get_json(silent=True) or {}


def error(e: StudyError):
    return jsonify({"error": e.message}), e.status


def study_arg() -> str:
    return request.args.get("study") or "beacon"


def scope_arg(default: str = "all") -> str:
    return request.args.get("scope") or default


def records(slug: str, scope: str = "all") -> list[dict]:
    """Respondents of a study as dicts with ``answers`` and a flattened ``flat`` row."""
    study = Study.get(slug)
    if not study:
        return []
    out = []
    for r in Respondent.for_study(study.id, scope):
        rec = {k: r[k] for k in r.keys()}
        rec["answers"] = Respondent(r).answers()
        rec["is_test_label"] = "test" if r["is_test"] else "real"
        rec["flat"] = flatten(rec, rec["answers"], study.cfg)
        out.append(rec)
    return out


def attachment(data: bytes, mimetype: str, filename: str, extra: dict | None = None):
    headers = {"Content-Disposition": f"attachment; filename={filename}",
               "Cache-Control": "no-store", **(extra or {})}
    return Response(data, mimetype=mimetype, headers=headers)


def stamp() -> str:
    return time.strftime("%Y%m%d_%H%M%S")
