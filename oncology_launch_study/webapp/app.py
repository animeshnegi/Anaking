#!/usr/bin/env python3
"""
PROJECT BEACON - survey platform server.

A multi-study platform: every survey is a "study" - a JSON config (sections, questions,
TPP text, walkthrough scenes, conjoint design, QC rules) stored in SQLite. Studies can
be drafted, edited, launched live and closed independently; respondent data is captured
separately per study and exported per study.

The original PROJECT BEACON oncology study is seeded automatically as study "beacon".

Routes
  Respondent engine (any study)
    GET  /                          beacon survey
    GET  /test                      beacon survey, test mode
    GET  /s/<slug>  /s/<slug>/test  any launched study (?preview=<token> for drafts)
    GET  /api/spec/<slug>           study definition consumed by survey.js
    POST /api/start /api/save /api/submit /api/voice
    GET  /api/progress?sid=

  Studio (builder dashboard, ?token=...)
    GET  /studio                    builder UI
    GET  /api/studio/list           all studies with counts
    GET  /api/studio/study?slug=    one study incl. config
    POST /api/studio/save           create or update a study {slug?, title, status, cfg}
    POST /api/studio/status         {slug, status: draft|live|closed}
    POST /api/studio/delete         {slug}
    POST /api/studio/make_conjoint  {attributes, n_tasks, seed} -> generated design
    GET  /api/studio/analysis?slug= quick analysis aggregates

  Admin / export (per study, ?study=<slug>, default beacon)
    GET  /admin?token=&study=
    GET  /api/admin/data?token=&study=
    GET  /admin/export.xlsx|.csv|.json?token=&study=&scope=all|real|test
    POST /admin/reset?token=&study=&scope=
    GET  /admin/voice/<file>?token=

Run:  python3 app.py [--port 8000] [--admin-token TOKEN]
"""

from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import math
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import survey_spec as spec  # noqa: E402  (used only to seed the beacon study)
import xlsx_export  # noqa: E402

DB_PATH = os.path.join(HERE, "survey.db")
VOICE_DIR = os.path.join(HERE, "voice")
DESIGN_PATH = os.path.join(PROJECT, "output", "design.json")
TASKMAP_PATH = os.path.join(PROJECT, "output", "respondent_task_map.csv")
MAX_BODY = 4 * 1024 * 1024

_db_lock = threading.Lock()


# ======================================================================================
# DATABASE
# ======================================================================================
def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with _db_lock, db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS studies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE,
            title TEXT,
            status TEXT DEFAULT 'draft',
            cfg TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS respondents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            respondent_code TEXT,
            session_id TEXT UNIQUE,
            study_id INTEGER DEFAULT 1,
            is_test INTEGER DEFAULT 0,
            status TEXT DEFAULT 'in_progress',
            screen_out_at TEXT,
            screen_out_reason TEXT,
            started_at TEXT,
            completed_at TEXT,
            elapsed_seconds REAL DEFAULT 0,
            task_order TEXT,
            alt_positions TEXT,
            user_agent TEXT
        );
        CREATE TABLE IF NOT EXISTS answers (
            respondent_id INTEGER,
            question_id TEXT,
            item TEXT,
            value TEXT,
            seconds REAL DEFAULT 0,
            PRIMARY KEY (respondent_id, question_id, item)
        );
        """)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(respondents)")}
        if "study_id" not in cols:
            conn.execute("ALTER TABLE respondents ADD COLUMN study_id INTEGER DEFAULT 1")
        if "is_test" not in cols:
            conn.execute("ALTER TABLE respondents ADD COLUMN is_test INTEGER DEFAULT 0")
        # codes are unique per study now; rebuild if the old global UNIQUE is still there
        tbl_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='respondents'"
        ).fetchone()[0]
        if "respondent_code TEXT UNIQUE" in tbl_sql:
            conn.executescript("""
            CREATE TABLE respondents_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                respondent_code TEXT,
                session_id TEXT UNIQUE,
                study_id INTEGER DEFAULT 1,
                is_test INTEGER DEFAULT 0,
                status TEXT DEFAULT 'in_progress',
                screen_out_at TEXT,
                screen_out_reason TEXT,
                started_at TEXT,
                completed_at TEXT,
                elapsed_seconds REAL DEFAULT 0,
                task_order TEXT,
                alt_positions TEXT,
                user_agent TEXT
            );
            INSERT INTO respondents_new
                SELECT id, respondent_code, session_id, study_id, is_test, status,
                       screen_out_at, screen_out_reason, started_at, completed_at,
                       elapsed_seconds, task_order, alt_positions, user_agent
                FROM respondents;
            DROP TABLE respondents;
            ALTER TABLE respondents_new RENAME TO respondents;
            CREATE UNIQUE INDEX ux_resp_code ON respondents(study_id, respondent_code);
            """)


def study_row(conn, slug: str):
    return conn.execute("SELECT * FROM studies WHERE slug=?", (slug,)).fetchone()


def study_cfg(row) -> dict:
    return json.loads(row["cfg"]) if row and row["cfg"] else {}


# ======================================================================================
# BEACON SEED + STUDY HELPERS
# ======================================================================================
def load_design() -> dict:
    with open(DESIGN_PATH) as f:
        return json.load(f)


def load_task_map() -> dict:
    out = {}
    with open(TASKMAP_PATH, newline="") as f:
        for row in csv.DictReader(f):
            out[row["respondent_id"]] = {
                "task_order": [int(x) for x in row["task_presentation_order"].split(",")],
                "alt_positions": {
                    k.replace("task", "").replace("_alternative_position_order", ""):
                        [int(v) for v in val.split(",")]
                    for k, val in row.items() if k.endswith("_alternative_position_order")
                },
            }
    return out


def conjoint_payload(design: dict) -> dict:
    attrs, levels = design["attributes"], design["levels"]
    tasks = {}
    for t_i, task in enumerate(design["tasks"], start=1):
        alts = []
        for a_i, profile in enumerate(task, start=1):
            alts.append({"alt_id": a_i, "levels": profile})
        tasks[str(t_i)] = alts
    return {"attributes": [{"id": a, "levels": levels[a]} for a in attrs],
            "tasks": tasks, "n_tasks": len(design["tasks"]),
            "has_opt_out": design.get("has_opt_out", True)}


def beacon_config() -> dict:
    design = load_design()
    narr = {k: {"src": "/audio/" + v["file"], "seconds": v["seconds"]}
            for k, v in spec.NARRATION.items()}
    return {
        "title": "PROJECT BEACON - US Oncologist Brand Demand Study",
        "sections": spec.sections_in_order(),
        "questions": spec.Q,
        "tpp": {
            "patient": "Advanced NSCLC, progressed on prior immunotherapy, ECOG 1",
            "mechanism": "Novel mechanism of action; details blinded for this study",
            "trial": "Randomised, controlled, Phase III versus current standard of care",
            "efficacy": "Significant improvement in progression-free survival; "
                        "overall survival data immature",
            "safety": "Treatment-related Grade 3+ adverse events in approximately "
                      "30% of patients",
            "administration": "As described in the choice tasks",
            "cdx": "Broad NGS panel",
        },
        "narration": narr,
        "explainer_scenes": spec.EXPLAINER_SCENES,
        "conjoint_scene": spec.CONJOINT_SCENE,
        "conjoint": conjoint_payload(design),
        "conjoint_min_dwell": spec.CONJOINT_MIN_DWELL,
        "use_tts": False,
        "metrics": {"intent_q": "Q12", "pct_q": "Q12b", "wtp_q": "Q18a"},
        "quota": {
            "state_q": "Q2b", "setting_q": "Q2a",
            "states": spec.STATES, "divisions": spec.CENSUS_DIVISION,
            "setting_quota": {str(o["code"]): o.get("quota", "")
                              for o in spec.BY_ID["Q2a"]["options"]},
        },
        "qc": {"attention_q": "Q13", "attention_ok": "2", "min_seconds": 480,
               "straightline_q": "Q7", "uniform_q": "Q16",
               "verbatim_qs": ["Q8b", "Q20b", "Q19c", "Q20c"]},
    }


def seed_beacon() -> None:
    with _db_lock, db() as conn:
        if conn.execute("SELECT 1 FROM studies WHERE slug='beacon'").fetchone():
            return
        conn.execute(
            "INSERT INTO studies (slug, title, status, cfg, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?)",
            ("beacon", "PROJECT BEACON - US Oncologist Brand Demand Study", "live",
             json.dumps(beacon_config()), time.strftime("%Y-%m-%dT%H:%M:%S"),
             time.strftime("%Y-%m-%dT%H:%M:%S")))
        # attach any pre-platform respondents to the beacon study
        conn.execute("UPDATE respondents SET study_id=1 WHERE study_id IS NULL")


def scenes_from_tpp(tpp: dict) -> list:
    """Regenerate walkthrough scenes from the editable TPP text."""
    t = tpp or {}
    return [
        {"id": "patient", "clip": None, "at": 0, "title": "The patient in front of you",
         "caption": t.get("patient", "")},
        {"id": "trial", "clip": None, "at": 0, "title": "The pivotal trial",
         "caption": t.get("trial", "")},
        {"id": "mechanism", "clip": None, "at": 0, "title": "Mechanism of action",
         "caption": t.get("mechanism", "")},
        {"id": "efficacy", "clip": None, "at": 0, "title": "Headline efficacy",
         "caption": t.get("efficacy", "")},
        {"id": "safety", "clip": None, "at": 0, "title": "Safety at a glance",
         "caption": t.get("safety", "")},
        {"id": "cdx", "clip": None, "at": 0, "title": "Companion diagnostic",
         "caption": t.get("cdx", "")},
    ]


# ======================================================================================
# CONJOINT DESIGN GENERATOR (for new studies)
# ======================================================================================
def make_conjoint(attributes: list, n_tasks: int = 9, seed: int = 1,
                  n_alts: int = 3) -> dict:
    """Main-effect balanced design: level = (task + alt*weight[attr]) mod L.
    Every level of every attribute appears equally often; a dominance repair
    pass then removes fully-dominated alternatives."""
    import random
    rng = random.Random(seed)
    attrs = [a["id"] for a in attributes]
    levels = {a["id"]: a["levels"] for a in attributes}
    L = {a: len(levels[a]) for a in attrs}
    weights = {a: (1 if i % 2 == 0 else 2) for i, a in enumerate(attrs)}
    higher_bad = {a: bool(attributes[i].get("higher_is_bad", False))
                  for i, a in enumerate(attrs)}

    tasks = []
    for t in range(n_tasks):
        task = []
        for alt in range(n_alts):
            task.append({a: (t + alt * weights[a]) % L[a] for a in attrs})
        tasks.append(task)

    def good(p, a):  # higher = better value
        return L[a] - 1 - p[a] if higher_bad[a] else p[a]

    for _ in range(60):
        fixed = True
        for ti, task in enumerate(tasks):
            for x in range(len(task)):
                for y in range(len(task)):
                    if x == y:
                        continue
                    gx = [good(task[x], a) for a in attrs]
                    gy = [good(task[y], a) for a in attrs]
                    if all(gx[i] >= gy[i] for i in range(len(attrs))) and gx != gy:
                        a = attrs[ti % len(attrs)]
                        tasks[ti][y][a] = (tasks[ti][y][a] + 1) % L[a]
                        fixed = False
        if fixed:
            break

    counts = {a: {i: 0 for i in range(L[a])} for a in attrs}
    for task in tasks:
        for p in task:
            for a in attrs:
                counts[a][p[a]] += 1
    return {"attributes": attrs, "levels": levels, "tasks": tasks,
            "has_opt_out": True, "balance": counts,
            "n_tasks": n_tasks, "n_alts": n_alts}


def task_list(design: dict) -> list:
    """Conjoint tasks may be stored as a list (generated designs) or as a dict keyed by
    task number (the beacon seed). Always return a list in task order."""
    t = design["tasks"]
    if isinstance(t, dict):
        return [t[k] for k in sorted(t, key=lambda x: int(x))]
    return t


def assignment_for(code: str, design: dict, task_map: dict | None) -> dict:
    tl = task_list(design)
    n_tasks = len(tl)
    n_alts = len(tl[0])
    if task_map and code in task_map:
        return task_map[code]
    rng = __import__("random").Random("beacon:" + code)
    order = list(range(1, n_tasks + 1))
    rng.shuffle(order)
    positions = {}
    for t in order:
        p = list(range(1, n_alts + 1))
        rng.shuffle(p)
        positions[str(t)] = p
    return {"task_order": order, "alt_positions": positions}


# ======================================================================================
# QUALITY CONTROL
# ======================================================================================
def _gibberish(t: str) -> bool:
    s = t.strip().lower()
    if len(s) < 8:
        return False
    if "lorem ipsum" in s:
        return True
    words = [w for w in re.split(r"[^a-z]+", s) if len(w) >= 5]
    if len(words) >= 3:
        bad = 0
        for w in words:
            max_run = run = 0
            has_vowel = False
            for ch in w:
                if ch in "aeiou":
                    has_vowel, run = True, 0
                else:
                    run += 1
                    max_run = max(max_run, run)
            if not has_vowel or max_run >= 4:
                bad += 1
        if bad / len(words) >= 0.5:
            return True
    letters = re.sub(r"[^a-z]", "", s)
    if len(letters) >= 8 and sum(1 for c in letters if c in "aeiou") / len(letters) < 0.1:
        return True
    for row in ("qwertyuiop", "asdfghjkl", "zxcvbnm"):
        if row in s or row[::-1] in s:
            return True
    if re.search(r"(.)\1{5,}", s):
        return True
    words_all = s.split()
    if len(words_all) >= 4 and len(set(words_all)) / len(words_all) <= 0.3:
        return True
    for chunk in range(2, 9):
        pat, reps = s[:chunk], len(s) // chunk
        if reps >= 3 and pat * reps == s[: reps * chunk] and len(s) - reps * chunk < chunk:
            return True
    return False


def qc_flags(answers: dict, elapsed: float, cfg: dict, status: str = "complete") -> dict:
    if status == "screened_out":
        return {"flags": [], "clean": True}
    qc = cfg.get("qc", {})
    flags = []
    if elapsed and elapsed < qc.get("min_seconds", 480):
        flags.append("speeder")
    aq, aok = qc.get("attention_q"), qc.get("attention_ok")
    if aq:
        v = answers.get(aq, {}).get("_")
        if v is not None and str(v) != str(aok):
            flags.append("attention_check_failed")
    sq = qc.get("straightline_q")
    if sq:
        vals = [v for k, v in answers.get(sq, {}).items() if k != "_"]
        if len(vals) >= 10 and len(set(vals)) == 1:
            flags.append(f"straightliner_{sq}")
    uq = qc.get("uniform_q")
    if uq and cfg.get("conjoint"):
        n_tasks = cfg["conjoint"]["n_tasks"]
        u = {k: v for k, v in answers.get(uq, {}).items() if k.startswith("T")}
        if len(u) >= n_tasks and len(set(u.values())) == 1:
            flags.append("conjoint_uniform_choice")
    for qid in qc.get("verbatim_qs", []):
        txt = answers.get(qid, {}).get("_")
        if txt and len(str(txt).split()) < 3:
            flags.append(f"thin_verbatim_{qid}")
        if txt and _gibberish(str(txt)):
            flags.append(f"gibberish_verbatim_{qid}")
    return {"flags": flags, "clean": not flags}


# ======================================================================================
# FLATTENING / SHEETS (config-driven)
# ======================================================================================
def all_answers_for(conn: sqlite3.Connection, rid: int) -> dict:
    rows = conn.execute("SELECT question_id, item, value FROM answers WHERE respondent_id=?",
                        (rid,))
    out: dict = {}
    for r in rows:
        out.setdefault(r["question_id"], {})
        if r["item"] in ("codes", "order"):
            try:
                out[r["question_id"]][r["item"]] = json.loads(r["value"])
            except (json.JSONDecodeError, TypeError):
                out[r["question_id"]][r["item"]] = []
        else:
            out[r["question_id"]][r["item"]] = r["value"]
    return out


def flatten(respondent, answers: dict, cfg: dict) -> dict:
    qmap = {q["id"]: q for q in cfg.get("questions", [])}
    quota = cfg.get("quota", {})
    out = {
        "respondent_code": respondent["respondent_code"],
        "is_test": "test" if respondent["is_test"] else "real",
        "status": respondent["status"],
        "screen_out_at": respondent["screen_out_at"] or "",
        "screen_out_reason": respondent["screen_out_reason"] or "",
        "started_at": respondent["started_at"] or "",
        "completed_at": respondent["completed_at"] or "",
        "elapsed_seconds": round(respondent["elapsed_seconds"] or 0, 1),
        "elapsed_minutes": round((respondent["elapsed_seconds"] or 0) / 60, 1),
        "qc_flags": ";".join(qc_flags(answers, respondent["elapsed_seconds"] or 0,
                                      cfg, respondent["status"] or "complete")["flags"]),
    }
    # quota lookups when the study defines them
    setting_code = answers.get(quota.get("setting_q", ""), {}).get("_") if quota else None
    out["practice_setting_group"] = (quota.get("setting_quota", {}) or {}).get(
        str(setting_code), "") if setting_code else ""
    states = quota.get("states", []) or []
    st_code = answers.get(quota.get("state_q", ""), {}).get("_") if quota else None
    try:
        out["state"] = states[int(st_code) - 1] if st_code else ""
    except (ValueError, IndexError):
        out["state"] = ""
    out["census_division"] = (quota.get("divisions", {}) or {}).get(out["state"], "")

    for q in cfg.get("questions", []):
        qid, a, t = q["id"], answers.get(q["id"], {}), q["type"]
        if t in ("single_select", "numeric", "slider"):
            raw = a.get("_", "")
            out[qid] = raw
            opt = next((o for o in q.get("options", []) if str(o["code"]) == str(raw)), None)
            if opt:
                out[qid + "_text"] = opt["label"]
            if a.get("other_text"):
                out[qid + "_other"] = a["other_text"]
        elif t == "open_text":
            out[qid] = a.get("_", "")
            if a.get("voice"):
                out[qid + "_voice"] = "recorded"
        elif t == "nps":
            raw = a.get("_", "")
            out[qid] = raw
            try:
                n = int(raw)
                out[qid + "_segment"] = ("Promoter" if n >= 9 else "Passive" if n >= 7
                                         else "Detractor")
            except (ValueError, TypeError):
                out[qid + "_segment"] = ""
        elif t in ("rating_grid", "semantic_diff", "emoji_grid", "sum_to_100"):
            for r in q["rows"]:
                out[f"{qid}_{r['code']}"] = a.get(r["code"], "")
        elif t == "heatmap":
            for r in q["rows"]:
                for c in q["cols"]:
                    out[f"{qid}_{r['code']}_{c['code']}"] = a.get(
                        r["code"] + "_" + c["code"], "")
        elif t == "multi_select":
            out[qid] = ";".join(str(c) for c in sorted(a.get("codes", []), key=str))
            out[qid + "_text"] = "; ".join(
                o["label"] for o in q.get("options", []) if str(o["code"]) in
                {str(c) for c in a.get("codes", [])})
        elif t == "rank":
            out[qid] = ";".join(str(c) for c in (a.get("order") or [])[:q.get("rank_count", 3)])
        elif t == "maxdiff":
            labels = {x: x for x in []}
            for i in range(1, len(q.get("rounds", [])) + 1):
                b, w = a.get(f"R{i}_best", ""), a.get(f"R{i}_worst", "")
                out[f"{qid}_R{i}_best"] = b
                out[f"{qid}_R{i}_worst"] = w
        elif t == "choice_task":
            n_tasks = (cfg.get("conjoint") or {}).get("n_tasks", 0)
            for i in range(1, n_tasks + 1):
                out[f"{qid}_T{i}"] = a.get(f"T{i}", "")
    return out


def conjoint_long(records: list, cfg: dict) -> tuple:
    design = cfg.get("conjoint")
    if not design:
        return [], []
    tl = task_list(design)
    attrs = [a["id"] for a in design["attributes"]]
    levels = {a["id"]: a["levels"] for a in design["attributes"]}
    n_tasks = design["n_tasks"] if design.get("n_tasks") else len(tl)
    uq = next((q["id"] for q in cfg["questions"] if q["type"] == "choice_task"), None)
    headers = ["respondent_code", "is_test", "task_id", "alt_id", "is_opt_out", "chosen"] + \
              attrs + [a + "_text" for a in attrs]
    rows = []
    if not uq:
        return headers, rows
    for rec in records:
        if rec["status"] != "complete":
            continue
        qa = rec["answers"].get(uq, {})
        for t_i in range(1, n_tasks + 1):
            picked = qa.get(f"T{t_i}")
            if picked is None or picked == "":
                continue
            picked = int(picked)
            for a_i, alt in enumerate(tl[t_i - 1], start=1):
                profile = alt["levels"] if isinstance(alt, dict) else alt
                rows.append([rec["respondent_code"], rec["is_test_label"], t_i, a_i, 0,
                             int(picked == a_i)] + [int(p) + 1 for p in profile] +
                            [levels[attrs[k]][int(profile[k])] for k in range(len(attrs))])
            rows.append([rec["respondent_code"], rec["is_test_label"], t_i, 0, 1,
                         int(picked == 0)] + [""] * (2 * len(attrs)))
    return headers, rows


def build_sheets(records: list, scope: str, cfg: dict):
    total = len(records)
    complete = [r for r in records if r["status"] == "complete"]
    screened = [r for r in records if r["status"] == "screened_out"]
    in_prog = [r for r in records if r["status"] == "in_progress"]

    def count(pred, seq=records):
        return sum(1 for r in seq if pred(r))

    metrics = cfg.get("metrics", {})
    summary_rows = [
        ["Study", cfg.get("title", "")],
        ["Export scope", scope],
        ["Generated (UTC)", time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())],
        ["", ""],
        ["Total respondents started", total],
        ["Completed", len(complete)],
        ["Screened out", len(screened)],
        ["In progress / abandoned", len(in_prog)],
        ["Completion rate (%)", round(100 * len(complete) / total, 1) if total else 0],
        ["", ""],
        ["Mean elapsed, completed (min)",
         round(sum(r["elapsed_seconds"] or 0 for r in complete) / 60 / len(complete), 1)
         if complete else 0],
        ["Respondents with QC flags",
         sum(1 for r in complete if qc_flags(r["answers"], r["elapsed_seconds"] or 0,
                                             cfg)["flags"])],
        ["", ""],
    ]
    if cfg.get("quota"):
        for div in sorted({v for v in (cfg["quota"].get("divisions") or {}).values()}):
            summary_rows.append([f"Quota - division: {div}",
                                 count(lambda r, d=div: r["flat"].get("census_division") == d,
                                       complete)])
        for grp in sorted({v for v in (cfg["quota"].get("setting_quota") or {}).values()
                           if v}):
            summary_rows.append([f"Quota - setting: {grp}",
                                 count(lambda r, g=grp:
                                       r["flat"].get("practice_setting_group") == g, complete)])
    if metrics.get("intent_q"):
        intent = [float(r["answers"].get(metrics["intent_q"], {}).get("_") or 0)
                  for r in complete]
        summary_rows += [["", ""], ["Demand headline (completed respondents)", ""]]
        summary_rows.append([f"Top-2-box intent ({metrics['intent_q']}>=4) (%)",
                             round(100 * sum(1 for v in intent if v >= 4) / len(intent), 1)
                             if intent else 0])
    if metrics.get("pct_q"):
        pct = [float(r["answers"].get(metrics["pct_q"], {}).get("_") or 0) for r in complete]
        summary_rows.append([f"Mean % eligible patients ({metrics['pct_q']})",
                             round(sum(pct) / len(pct), 1) if pct else 0])
    if metrics.get("wtp_q"):
        wtp = [float(r["answers"].get(metrics["wtp_q"], {}).get("_") or 0) for r in complete]
        summary_rows.append([f"Mean stated good-value cost ({metrics['wtp_q']}) ($)",
                             round(sum(wtp) / len(wtp)) if wtp else 0])

    flat_rows = [r["flat"] for r in records]
    if flat_rows:
        cols = list(flat_rows[0].keys())
        for f in flat_rows:
            for k in f:
                if k not in cols:
                    cols.append(k)
        wide_headers, wide_rows = cols, [[f.get(c, "") for c in cols] for f in flat_rows]
    else:
        wide_headers, wide_rows = ["respondent_code"], []

    conj_headers, conj_rows = conjoint_long(records, cfg)

    so_headers = ["respondent_code", "is_test", "screened_out_at", "reason", "started_at"]
    so_rows = [[r["respondent_code"], "test" if r["is_test"] else "real",
                r["screen_out_at"] or "", r["screen_out_reason"] or "", r["started_at"] or ""]
               for r in screened]

    qc_headers = ["respondent_code", "is_test", "elapsed_minutes", "flags", "clean"]
    qc_rows = []
    for r in complete:
        q = qc_flags(r["answers"], r["elapsed_seconds"] or 0, cfg)
        qc_rows.append([r["respondent_code"], "test" if r["is_test"] else "real",
                        round((r["elapsed_seconds"] or 0) / 60, 1), ";".join(q["flags"]),
                        "yes" if q["clean"] else "no"])

    dd_headers = ["question_id", "section", "type", "stem", "item", "item_label",
                  "values_or_scale"]
    dd_rows = []
    for q in cfg.get("questions", []):
        stem = q["stem"]
        if q["type"] in ("single_select", "multi_select"):
            for o in q.get("options", []):
                dd_rows.append([q["id"], q["section"], q["type"], stem, o["code"], o["label"],
                                "option" + (" - TERMINATES" if o.get("terminate") else "")])
        elif q["type"] in ("rating_grid", "semantic_diff", "sum_to_100", "emoji_grid"):
            scale = (f"{q['scale']['min']}-{q['scale']['max']}" if "scale" in q
                     else "0-100, rows sum to 100")
            for r in q["rows"]:
                dd_rows.append([q["id"], q["section"], q["type"], stem, r["code"], r["label"],
                                scale])
        elif q["type"] == "heatmap":
            for r in q["rows"]:
                for c in q["cols"]:
                    dd_rows.append([q["id"], q["section"], q["type"], stem,
                                    f"{r['code']}_{c['code']}", f"{r['label']} x {c['label']}",
                                    "0-3 heat intensity"])
        elif q["type"] == "maxdiff":
            for i, rnd in enumerate(q.get("rounds", []), 1):
                dd_rows.append([q["id"], q["section"], q["type"], stem, f"R{i}",
                                " / ".join(rnd["items"]), "best-worst round codes"])
        elif q["type"] == "rank":
            for r in q["rows"]:
                dd_rows.append([q["id"], q["section"], q["type"], stem, r["code"], r["label"],
                                f"rank 1-{len(q['rows'])}; top {q.get('rank_count', 3)} recorded"])
        elif q["type"] == "choice_task":
            n_tasks = (cfg.get("conjoint") or {}).get("n_tasks", 0)
            dd_rows.append([q["id"], q["section"], q["type"], stem, "T1..T" + str(n_tasks),
                            "chosen alternative per task", "1-3 chosen, 0 = opt-out"])
        elif q["type"] == "nps":
            dd_rows.append([q["id"], q["section"], q["type"], stem, "_", "0-10 NPS",
                            "9-10 promoter, 7-8 passive, 0-6 detractor"])
        else:
            dd_rows.append([q["id"], q["section"], q["type"], stem, "_", "single value",
                            f"{q.get('min', '')}-{q.get('max', '')}" if q["type"] in
                            ("numeric", "slider") else "free text"])

    widths_map = {"Field summary": [52, 22], "Screen-outs": [16, 9, 16, 44, 20],
                  "QC flags": [16, 9, 15, 46, 8],
                  "Data dictionary": [18, 8, 14, 58, 10, 52, 40]}
    return [
        ("Field summary", ["Metric", "Value"], summary_rows, widths_map["Field summary"]),
        ("Responses", wide_headers, wide_rows, None),
        ("Conjoint long", conj_headers, conj_rows, None),
        ("Screen-outs", so_headers, so_rows, widths_map["Screen-outs"]),
        ("QC flags", qc_headers, qc_rows, widths_map["QC flags"]),
        ("Data dictionary", dd_headers, dd_rows, widths_map["Data dictionary"]),
    ]


# ======================================================================================
# QUICK ANALYSIS
# ======================================================================================
def analysis_for(records: list, cfg: dict) -> dict:
    complete = [r for r in records if r["status"] == "complete"]
    out = {"n_started": len(records), "n_complete": len(complete),
           "n_screened": sum(1 for r in records if r["status"] == "screened_out"),
           "mean_minutes": round(sum(r["elapsed_seconds"] or 0 for r in complete) / 60 /
                                 len(complete), 1) if complete else 0,
           "ratings": [], "nps": None, "maxdiff": [], "heatmap": [], "emoji": [],
           "choice_share": None}

    def mean(vals):
        vals = [float(v) for v in vals if v not in (None, "")]
        return round(sum(vals) / len(vals), 2) if vals else None

    for q in cfg.get("questions", []):
        t = q["type"]
        if t in ("rating_grid", "semantic_diff", "emoji_grid"):
            rows = []
            for r in q["rows"]:
                rows.append({"label": r["label"],
                             "mean": mean([rec["answers"].get(q["id"], {}).get(r["code"])
                                           for rec in complete])})
            out["ratings"].append({"id": q["id"], "stem": q["stem"][:60], "rows": rows})
        elif t == "nps":
            seg = {"Promoter": 0, "Passive": 0, "Detractor": 0}
            for rec in complete:
                v = rec["answers"].get(q["id"], {}).get("_")
                try:
                    n = int(v)
                except (TypeError, ValueError):
                    continue
                seg["Promoter" if n >= 9 else "Passive" if n >= 7 else "Detractor"] += 1
            tot = sum(seg.values()) or 1
            out["nps"] = {"id": q["id"], "segments": seg,
                          "score": round(100 * (seg["Promoter"] - seg["Detractor"]) / tot)}
        elif t == "maxdiff":
            best, worst = {}, {}
            for rec in complete:
                a = rec["answers"].get(q["id"], {})
                for i in range(1, len(q.get("rounds", [])) + 1):
                    b, w = a.get(f"R{i}_best"), a.get(f"R{i}_worst")
                    if b:
                        best[b] = best.get(b, 0) + 1
                    if w:
                        worst[w] = worst.get(w, 0) + 1
            codes = sorted(set(best) | set(worst))
            out["maxdiff"].append({"id": q["id"],
                                   "scores": [{"code": c, "best": best.get(c, 0),
                                               "worst": worst.get(c, 0),
                                               "bw": best.get(c, 0) - worst.get(c, 0)}
                                              for c in codes]})
        elif t == "heatmap":
            cells = []
            for r in q["rows"]:
                for c in q["cols"]:
                    cells.append({"row": r["label"], "col": c["label"],
                                  "mean": mean([rec["answers"].get(q["id"], {})
                                                .get(r["code"] + "_" + c["code"])
                                                for rec in complete])})
            out["heatmap"].append({"id": q["id"], "cells": cells})
    design = cfg.get("conjoint")
    if design and complete:
        uq = next((q for q in cfg["questions"] if q["type"] == "choice_task"), None)
        if uq:
            lvl_chosen, lvl_seen = {}, {}
            for rec in complete:
                qa = rec["answers"].get(uq["id"], {})
                tl = task_list(design)
                for t_i, task in enumerate(tl, 1):
                    picked = qa.get(f"T{t_i}")
                    if picked in (None, ""):
                        continue
                    for a_i, alt in enumerate(task, 1):
                        profile = alt["levels"] if isinstance(alt, dict) else alt
                        chosen = int(picked) == a_i
                        for ai, attr in enumerate(design["attributes"]):
                            key = (attr["id"], int(profile[ai]))
                            lvl_seen[key] = lvl_seen.get(key, 0) + 1
                            if chosen:
                                lvl_chosen[key] = lvl_chosen.get(key, 0) + 1
            share = []
            for attr in design["attributes"]:
                for li in range(len(attr["levels"])):
                    seen = lvl_seen.get((attr["id"], li), 0)
                    share.append({"attr": attr["id"], "level": attr["levels"][li],
                                  "share": round(100 * lvl_chosen.get((attr["id"], li), 0) /
                                                 seen, 1) if seen else 0})
            out["choice_share"] = share
    return out


# ======================================================================================
# HTTP HANDLER
# ======================================================================================
class Handler(BaseHTTPRequestHandler):
    server_version = "BeaconPlatform/2.0"
    admin_token = "beacon-admin"

    def _send(self, body: bytes, ctype="application/json; charset=utf-8", code=200, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, obj, code=200):
        self._send(json.dumps(obj).encode(), code=code)

    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _static(self, path, ctype):
        full = os.path.join(HERE, path)
        if not os.path.isfile(full):
            return self._send(b"not found", "text/plain", 404)
        with open(full, "rb") as f:
            self._send(f.read(), ctype)

    # ---------- routing ----------
    def do_GET(self):
        try:
            self._route_get()
        except Exception as exc:
            import traceback
            traceback.print_exc()
            try:
                self._send(f"server error: {exc}".encode(), "text/plain", 500)
            except Exception:
                pass

    def do_POST(self):
        try:
            self._route_post()
        except Exception as exc:
            import traceback
            traceback.print_exc()
            try:
                self._send(f"server error: {exc}".encode(), "text/plain", 500)
            except Exception:
                pass

    # ---------- respondent pages ----------
    def _serve_survey_page(self, slug, is_test, preview_token):
        with db() as conn:
            row = study_row(conn, slug)
        if not row:
            return self._send(b"unknown study", "text/plain", 404)
        if row["status"] != "live" and preview_token != self.admin_token:
            return self._send(
                ("<html><body style='font-family:sans-serif;padding:60px;text-align:center'>"
                 "<h2>This study has not been launched yet.</h2>"
                 "<p>The research team must set it live from the Studio before respondents "
                 "can take part.</p></body></html>").encode(),
                "text/html; charset=utf-8", 403)
        with open(os.path.join(HERE, "index.html")) as f:
            html = f.read()
        inject = ('<script>window.STUDY={slug:"' + slug + '"};</script>\n')
        html = html.replace('<script src="/explainer.js', inject + '<script src="/explainer.js')
        return self._send(html.encode(), "text/html; charset=utf-8")

    def _route_get(self):
        parsed = urlparse(self.path)
        route, qs = parsed.path, parse_qs(parsed.query)
        token = (qs.get("token") or [""])[0]
        study_q = (qs.get("study") or ["beacon"])[0]

        if route in ("/", "/index.html"):
            return self._serve_survey_page("beacon", False, "live")
        if route == "/test":
            return self._serve_survey_page("beacon", True, "live")
        m = re.fullmatch(r"/s/([a-zA-Z0-9\-]+)(/test)?", route)
        if m:
            return self._serve_survey_page(m.group(1), bool(m.group(2)),
                                           (qs.get("preview") or [""])[0])

        if route == "/survey.css":
            return self._static("survey.css", "text/css; charset=utf-8")
        if route == "/survey.js":
            return self._static("survey.js", "application/javascript; charset=utf-8")
        if route == "/explainer.js":
            return self._static("explainer.js", "application/javascript; charset=utf-8")
        if route == "/admin.css":
            return self._static("admin.css", "text/css; charset=utf-8")
        if route == "/admin.js":
            return self._static("admin.js", "application/javascript; charset=utf-8")
        if route == "/studio.css":
            return self._static("studio.css", "text/css; charset=utf-8")
        if route == "/studio.js":
            return self._static("studio.js", "application/javascript; charset=utf-8")
        if route == "/studio":
            if token != self.admin_token:
                return self._send(b"admin token required (?token=...)", "text/plain", 403)
            return self._static("studio.html", "text/html; charset=utf-8")

        if route.startswith("/audio/"):
            name = os.path.basename(route)
            full = os.path.join(HERE, "audio", name)
            if not os.path.isfile(full) or not name.endswith(".mp3"):
                return self._send(b"not found", "text/plain", 404)
            with open(full, "rb") as f:
                data = f.read()
            rng = self.headers.get("Range")
            if rng and rng.startswith("bytes="):
                try:
                    a, b = rng[6:].split("-")
                    start = int(a) if a else 0
                    end = min(int(b) if b else len(data) - 1, len(data) - 1)
                    chunk = data[start:end + 1]
                    self.send_response(206)
                    self.send_header("Content-Type", "audio/mpeg")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
                    self.send_header("Content-Length", str(len(chunk)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(chunk)
                    return
                except (ValueError, IndexError):
                    pass
            return self._send(data, "audio/mpeg", 200, {"Accept-Ranges": "bytes"})

        if route == "/api/spec":
            route = "/api/spec/beacon"
        m = re.fullmatch(r"/api/spec/([a-zA-Z0-9\-]+)", route)
        if m:
            with db() as conn:
                row = study_row(conn, m.group(1))
            if not row:
                return self._json({"error": "unknown study"}, 404)
            cfg = study_cfg(row)
            conj = cfg.get("conjoint")
            if conj and isinstance(conj.get("tasks"), list):
                # the respondent engine addresses tasks by string key
                conj = dict(conj, tasks={str(i + 1): t
                                         for i, t in enumerate(conj["tasks"])})
            return self._json({
                "sections": cfg.get("sections", []),
                "questions": cfg.get("questions", []),
                "conjoint": conj,
                "terminate_text": spec.TERMINATE_TEXT,
                "narration": cfg.get("narration", {}),
                "explainer_scenes": cfg.get("explainer_scenes", []),
                "conjoint_scene": cfg.get("conjoint_scene"),
                "conjoint_min_dwell": cfg.get("conjoint_min_dwell", 12),
                "use_tts": cfg.get("use_tts", False),
                "tpp": cfg.get("tpp", {}),
            })

        if route == "/api/progress":
            return self._json(self._progress((qs.get("sid") or [""])[0]))

        # ---------- studio ----------
        if route == "/api/studio/list":
            if token != self.admin_token:
                return self._json({"error": "unauthorised"}, 403)
            return self._json(self._studio_list())
        if route == "/api/studio/study":
            if token != self.admin_token:
                return self._json({"error": "unauthorised"}, 403)
            with db() as conn:
                row = study_row(conn, (qs.get("slug") or [""])[0])
            if not row:
                return self._json({"error": "unknown study"}, 404)
            return self._json({"slug": row["slug"], "title": row["title"],
                               "status": row["status"], "cfg": study_cfg(row),
                               "updated_at": row["updated_at"]})
        if route == "/api/studio/analysis":
            if token != self.admin_token:
                return self._json({"error": "unauthorised"}, 403)
            return self._json(analysis_for(self._records(study_q, "all"),
                                           self._cfg_of(study_q)))

        # ---------- admin / exports ----------
        if route == "/admin":
            if token != self.admin_token:
                return self._send(b"admin token required (?token=...)", "text/plain", 403)
            return self._static("admin.html", "text/html; charset=utf-8")
        if route == "/api/admin/data":
            if token != self.admin_token:
                return self._json({"error": "unauthorised"}, 403)
            return self._json(self._admin_data(study_q, (qs.get("scope") or ["all"])[0]))
        if route == "/admin/export.xlsx":
            return self._export_xlsx(qs, study_q)
        if route == "/admin/export.csv":
            return self._export_csv(qs, study_q)
        if route == "/admin/export.json":
            return self._export_json(qs, study_q)
        if route.startswith("/admin/voice/"):
            if token != self.admin_token:
                return self._send(b"admin token required (?token=...)", "text/plain", 403)
            name = os.path.basename(route)
            full = os.path.join(VOICE_DIR, name)
            if not os.path.isfile(full):
                return self._send(b"not found", "text/plain", 404)
            with open(full, "rb") as f:
                data = f.read()
            ctype = ("audio/mp4" if name.endswith((".m4a", ".mp4"))
                     else "audio/ogg" if name.endswith((".ogg", ".opus")) else "audio/webm")
            return self._send(data, ctype, 200, {"Accept-Ranges": "bytes"})

        return self._send(b"not found", "text/plain", 404)

    def _route_post(self):
        parsed = urlparse(self.path)
        route, qs = parsed.path, parse_qs(parsed.query)
        body = self._read_json()

        if route == "/api/start":
            return self._start(body)
        if route == "/api/save":
            return self._save(body)
        if route == "/api/submit":
            return self._submit(body)
        if route == "/api/voice":
            return self._voice(body)
        if route == "/admin/reset":
            return self._reset(qs)
        if route == "/api/studio/save":
            return self._studio_save(body)
        if route == "/api/studio/status":
            return self._studio_status(body)
        if route == "/api/studio/delete":
            return self._studio_delete(body)
        if route == "/api/studio/make_conjoint":
            if (qs.get("token") or [""])[0] != self.admin_token:
                return self._json({"error": "unauthorised"}, 403)
            try:
                return self._json(make_conjoint(body.get("attributes", []),
                                                int(body.get("n_tasks", 9)),
                                                int(body.get("seed", 1))))
            except Exception as e:
                return self._json({"error": str(e)}, 400)
        return self._send(b"not found", "text/plain", 404)

    # ---------- study helpers ----------
    def _cfg_of(self, slug):
        with db() as conn:
            row = study_row(conn, slug)
        return study_cfg(row) if row else {}

    def _records(self, slug: str, scope: str) -> list:
        with db() as conn:
            srow = study_row(conn, slug)
            sid = srow["id"] if srow else -1
            rows = conn.execute("SELECT * FROM respondents WHERE study_id=? ORDER BY id",
                                (sid,)).fetchall()
            out = []
            for r in rows:
                if scope == "real" and r["is_test"]:
                    continue
                if scope == "test" and not r["is_test"]:
                    continue
                rec = {k: r[k] for k in r.keys()}
                rec["answers"] = all_answers_for(conn, r["id"])
                rec["is_test_label"] = "test" if r["is_test"] else "real"
                out.append(rec)
        cfg = self._cfg_of(slug)
        for rec in out:
            rec["flat"] = flatten(rec, rec["answers"], cfg)
        return out

    # ---------- respondent API ----------
    def _start(self, body):
        slug = body.get("study") or "beacon"
        is_test = 1 if body.get("is_test") else 0
        with db() as conn:
            srow = study_row(conn, slug)
            if not srow:
                return self._json({"error": "unknown study"}, 404)
            if srow["status"] != "live":
                return self._json({"error": "study not live"}, 403)
            cfg = study_cfg(srow)
            sid = secrets.token_urlsafe(16)
            prefix = "T" if is_test else "R"
            row = conn.execute(
                "SELECT MAX(CAST(SUBSTR(respondent_code,2) AS INTEGER)) AS m FROM "
                "respondents WHERE study_id=? AND respondent_code LIKE ?",
                (srow["id"], prefix + "%")).fetchone()
            code = f"{prefix}{(row['m'] or 0) + 1:03d}"
            conn.execute(
                "INSERT INTO respondents (respondent_code, session_id, study_id, is_test, "
                "started_at, user_agent) VALUES (?,?,?,?,?,?)",
                (code, sid, srow["id"], is_test, time.strftime("%Y-%m-%dT%H:%M:%S"),
                 self.headers.get("User-Agent", "")[:300]))
        design = cfg.get("conjoint")
        task_map = load_task_map() if slug == "beacon" else None
        assignment = (assignment_for(code, design, task_map) if design
                      else {"task_order": [], "alt_positions": {}})
        with db() as conn:
            conn.execute("UPDATE respondents SET task_order=?, alt_positions=? "
                         "WHERE session_id=?",
                         (json.dumps(assignment["task_order"]),
                          json.dumps(assignment["alt_positions"]), sid))
        return self._json({"session_id": sid, "respondent_code": code,
                           "is_test": bool(is_test), "study": slug,
                           "task_order": assignment["task_order"],
                           "alt_positions": assignment["alt_positions"],
                           "from_prebuilt_map": code in (task_map or {})})

    def _resolve(self, body):
        sid = body.get("session_id")
        if not sid:
            return None, None
        with db() as conn:
            row = conn.execute("SELECT * FROM respondents WHERE session_id=?",
                               (sid,)).fetchone()
        return (row["id"], row) if row else (None, None)

    def _persist(self, body):
        rid, row = self._resolve(body)
        if rid is None:
            return None, None
        seconds = float(body.get("elapsed_seconds") or 0)
        status = "screened_out" if body.get("screened_out") else row["status"]
        with _db_lock, db() as conn:
            for qid, payload in (body.get("answers") or {}).items():
                if not isinstance(payload, dict):
                    continue
                for item, val in payload.items():
                    conn.execute(
                        "INSERT INTO answers (respondent_id, question_id, item, value, "
                        "seconds) VALUES (?,?,?,?,?) ON CONFLICT(respondent_id, "
                        "question_id, item) DO UPDATE SET value=excluded.value, "
                        "seconds=excluded.seconds",
                        (rid, qid, item,
                         json.dumps(val) if isinstance(val, list) else str(val), seconds))
            conn.execute("UPDATE respondents SET elapsed_seconds=?, status=?, "
                         "screen_out_at=?, screen_out_reason=? WHERE id=?",
                         (seconds, status, body.get("screen_out_at") or row["screen_out_at"],
                          body.get("screen_out_reason") or row["screen_out_reason"], rid))
        return status, rid

    def _save(self, body):
        status, rid = self._persist(body)
        if rid is None:
            return self._json({"error": "unknown session"}, 400)
        return self._json({"ok": True, "status": status})

    def _submit(self, body):
        _status, rid = self._persist(body)
        if rid is None:
            return self._json({"error": "unknown session"}, 400)
        seconds = float(body.get("elapsed_seconds") or 0)
        with db() as conn:
            conn.execute("UPDATE respondents SET status='complete', completed_at=?, "
                         "elapsed_seconds=? WHERE id=?",
                         (time.strftime("%Y-%m-%dT%H:%M:%S"), seconds, rid))
            r = conn.execute("SELECT * FROM respondents WHERE id=?", (rid,)).fetchone()
            answers = all_answers_for(conn, rid)
            cfg = self._cfg_of_slug_id(r["study_id"])
        return self._json({"ok": True, "respondent_code": r["respondent_code"],
                           **qc_flags(answers, seconds, cfg)})

    def _cfg_of_slug_id(self, study_id):
        with db() as conn:
            row = conn.execute("SELECT * FROM studies WHERE id=?", (study_id,)).fetchone()
        return study_cfg(row) if row else {}

    def _voice(self, body):
        sid = body.get("session_id") or ""
        qid = str(body.get("qid") or "")
        ext = str(body.get("ext") or "webm").lower()
        data = body.get("data") or ""
        if ext not in ("webm", "mp4", "ogg", "opus", "m4a"):
            return self._json({"error": "unsupported format"}, 400)
        if not re.fullmatch(r"[A-Za-z0-9]+", qid):
            return self._json({"error": "bad question id"}, 400)
        try:
            raw = base64.b64decode(data, validate=True)
        except Exception:
            return self._json({"error": "bad audio payload"}, 400)
        if not raw or len(raw) > 2_500_000:
            return self._json({"error": "audio too large"}, 400)
        with db() as conn:
            row = conn.execute("SELECT r.respondent_code, s.slug FROM respondents r "
                               "JOIN studies s ON s.id=r.study_id WHERE r.session_id=?",
                               (sid,)).fetchone()
        if not row:
            return self._json({"error": "unknown session"}, 400)
        os.makedirs(VOICE_DIR, exist_ok=True)
        fname = f"{row['slug']}__{row['respondent_code']}_{qid}.{ext}"
        with open(os.path.join(VOICE_DIR, fname), "wb") as f:
            f.write(raw)
        return self._json({"ok": True, "file": fname})

    def _progress(self, sid):
        if not sid:
            return {"exists": False}
        with db() as conn:
            row = conn.execute("SELECT * FROM respondents WHERE session_id=?",
                               (sid,)).fetchone()
            if not row:
                return {"exists": False}
            answers = all_answers_for(conn, row["id"])
        return {"exists": True, "respondent_code": row["respondent_code"],
                "status": row["status"], "is_test": bool(row["is_test"]), "answers": answers,
                "task_order": json.loads(row["task_order"] or "[]"),
                "alt_positions": json.loads(row["alt_positions"] or "{}"),
                "elapsed_seconds": row["elapsed_seconds"]}

    # ---------- studio ----------
    def _studio_list(self):
        with db() as conn:
            rows = conn.execute(
                "SELECT s.id, s.slug, s.title, s.status, s.updated_at, "
                "(SELECT COUNT(*) FROM respondents r WHERE r.study_id=s.id) AS n, "
                "(SELECT COUNT(*) FROM respondents r WHERE r.study_id=s.id AND "
                "r.status='complete') AS c FROM studies s ORDER BY s.id").fetchall()
        return [{"slug": r["slug"], "title": r["title"], "status": r["status"],
                 "updated_at": r["updated_at"], "started": r["n"], "complete": r["c"]}
                for r in rows]

    def _studio_save(self, body):
        if (parse_qs(urlparse(self.path).query).get("token") or [""])[0] != self.admin_token:
            return self._json({"error": "unauthorised"}, 403)
        cfg = body.get("cfg") or {}
        title = str(body.get("title") or cfg.get("title") or "Untitled study")[:120]
        slug = str(body.get("slug") or "").lower().strip()
        if not re.fullmatch(r"[a-z0-9\-]{2,40}", slug):
            slug = re.sub(r"[^a-z0-9\-]+", "-", title.lower()).strip("-")[:40] or "study"
        cfg["title"] = title
        # light validation: unique question ids, sections exist
        ids = [q.get("id") for q in cfg.get("questions", [])]
        if len(ids) != len(set(ids)):
            return self._json({"error": "duplicate question ids"}, 400)
        sec_ids = {s.get("id") for s in cfg.get("sections", [])}
        if any(q.get("section") not in sec_ids for q in cfg.get("questions", [])):
            return self._json({"error": "question references unknown section"}, 400)
        now = time.strftime("%Y-%m-%dT%H:%M:%S")
        with _db_lock, db() as conn:
            row = study_row(conn, slug)
            if row:
                conn.execute("UPDATE studies SET title=?, cfg=?, updated_at=? WHERE slug=?",
                             (title, json.dumps(cfg), now, slug))
            else:
                conn.execute("INSERT INTO studies (slug, title, status, cfg, created_at, "
                             "updated_at) VALUES (?,?,?,?,?,?)",
                             (slug, title, "draft", json.dumps(cfg), now, now))
        return self._json({"ok": True, "slug": slug})

    def _studio_status(self, body):
        if (parse_qs(urlparse(self.path).query).get("token") or [""])[0] != self.admin_token:
            return self._json({"error": "unauthorised"}, 403)
        status = body.get("status")
        if status not in ("draft", "live", "closed"):
            return self._json({"error": "bad status"}, 400)
        with _db_lock, db() as conn:
            conn.execute("UPDATE studies SET status=?, updated_at=? WHERE slug=?",
                         (status, time.strftime("%Y-%m-%dT%H:%M:%S"), body.get("slug")))
        return self._json({"ok": True})

    def _studio_delete(self, body):
        if (parse_qs(urlparse(self.path).query).get("token") or [""])[0] != self.admin_token:
            return self._json({"error": "unauthorised"}, 403)
        slug = body.get("slug")
        if slug == "beacon":
            return self._json({"error": "the seeded beacon study cannot be deleted"}, 400)
        with _db_lock, db() as conn:
            row = study_row(conn, slug)
            if row:
                conn.execute("DELETE FROM answers WHERE respondent_id IN "
                             "(SELECT id FROM respondents WHERE study_id=?)", (row["id"],))
                conn.execute("DELETE FROM respondents WHERE study_id=?", (row["id"],))
                conn.execute("DELETE FROM studies WHERE id=?", (row["id"],))
        return self._json({"ok": True})

    # ---------- admin / export ----------
    def _check_admin(self, qs) -> bool:
        return (qs.get("token") or [""])[0] == self.admin_token

    def _admin_data(self, slug, scope):
        cfg = self._cfg_of(slug)
        records = self._records(slug, scope)
        complete = [r for r in records if r["status"] == "complete"]
        screened = [r for r in records if r["status"] == "screened_out"]
        in_prog = [r for r in records if r["status"] == "in_progress"]
        flagged = [{"code": r["respondent_code"],
                    "flags": qc_flags(r["answers"], r["elapsed_seconds"] or 0, cfg)["flags"]}
                   for r in complete
                   if qc_flags(r["answers"], r["elapsed_seconds"] or 0, cfg)["flags"]]
        divisions, settings = {}, {}
        for r in complete:
            d = r["flat"].get("census_division") or "(unset)"
            s = r["flat"].get("practice_setting_group") or "(unset)"
            divisions[d] = divisions.get(d, 0) + 1
            settings[s] = settings.get(s, 0) + 1
        intent_q = (cfg.get("metrics") or {}).get("intent_q")
        pct_q = (cfg.get("metrics") or {}).get("pct_q")
        intent = [float(r["answers"].get(intent_q, {}).get("_") or 0) for r in complete] \
            if intent_q else []
        pct = [float(r["answers"].get(pct_q, {}).get("_") or 0) for r in complete] \
            if pct_q else []
        recent = [{
            "code": r["respondent_code"], "is_test": bool(r["is_test"]),
            "status": r["status"], "started_at": r["started_at"],
            "completed_at": r["completed_at"],
            "minutes": round((r["elapsed_seconds"] or 0) / 60, 1),
            "screen_out": r["screen_out_at"] or "",
            "flags": qc_flags(r["answers"], r["elapsed_seconds"] or 0, cfg,
                              r["status"] or "complete")["flags"],
        } for r in records[-25:]][::-1]
        return {"study": slug, "scope": scope,
                "generated": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()) + " UTC",
                "counts": {"total": len(records), "complete": len(complete),
                           "screened_out": len(screened), "in_progress": len(in_prog)},
                "quota": {"census_division": divisions, "practice_setting": settings},
                "headlines": {
                    "top2box_intent_pct": round(100 * sum(1 for v in intent if v >= 4) /
                                                len(intent), 1) if intent else None,
                    "mean_pct_eligible": round(sum(pct) / len(pct), 1) if pct else None,
                    "mean_minutes": round(sum(r["elapsed_seconds"] or 0 for r in complete) /
                                          60 / len(complete), 1) if complete else None},
                "qc_flagged": flagged, "recent": recent,
                "conjoint": {"n_tasks": (cfg.get("conjoint") or {}).get("n_tasks", 0)},
                "token": self.admin_token}

    def _reset(self, qs):
        if not self._check_admin(qs):
            return self._json({"error": "unauthorised"}, 403)
        scope = (qs.get("scope") or ["test"])[0]
        slug = (qs.get("study") or ["beacon"])[0]
        if scope not in ("test", "real", "all"):
            return self._json({"error": "scope must be test, real or all"}, 400)
        with _db_lock, db() as conn:
            srow = study_row(conn, slug)
            sid = srow["id"] if srow else -1
            if scope == "all":
                conn.execute("DELETE FROM answers WHERE respondent_id IN "
                             "(SELECT id FROM respondents WHERE study_id=?)", (sid,))
                n = conn.execute("DELETE FROM respondents WHERE study_id=?", (sid,)).rowcount
            else:
                want = 1 if scope == "test" else 0
                ids = [r["id"] for r in conn.execute(
                    "SELECT id FROM respondents WHERE study_id=? AND is_test=?", (sid, want))]
                if ids:
                    q = ",".join("?" * len(ids))
                    conn.execute(f"DELETE FROM answers WHERE respondent_id IN ({q})", ids)
                    conn.execute(f"DELETE FROM respondents WHERE id IN ({q})", ids)
                n = len(ids)
        return self._json({"ok": True, "scope": scope, "study": slug,
                           "deleted_respondents": n})

    def _export_xlsx(self, qs, slug):
        if not self._check_admin(qs):
            return self._send(b"admin token required (?token=...)", "text/plain", 403)
        scope = (qs.get("scope") or ["all"])[0]
        cfg = self._cfg_of(slug)
        records = self._records(slug, scope)
        data, backend = xlsx_export.build_workbook(build_sheets(records, scope, cfg))
        stamp = time.strftime("%Y%m%d_%H%M%S")
        self._send(data,
                   "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 200,
                   {"Content-Disposition":
                    f'attachment; filename={slug}_responses_{scope}_{stamp}.xlsx',
                    "X-Export-Backend": backend})

    def _export_csv(self, qs, slug):
        if not self._check_admin(qs):
            return self._send(b"admin token required (?token=...)", "text/plain", 403)
        scope = (qs.get("scope") or ["all"])[0]
        flat = [r["flat"] for r in self._records(slug, scope)]
        if not flat:
            return self._send(b"respondent_code\n", "text/csv", 200)
        cols = list(flat[0].keys())
        for f in flat:
            for k in f:
                if k not in cols:
                    cols.append(k)
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for f in flat:
            w.writerow(f)
        stamp = time.strftime("%Y%m%d_%H%M%S")
        self._send(buf.getvalue().encode(), "text/csv; charset=utf-8", 200,
                   {"Content-Disposition":
                    f'attachment; filename={slug}_responses_{scope}_{stamp}.csv'})

    def _export_json(self, qs, slug):
        if not self._check_admin(qs):
            return self._send(b"admin token required (?token=...)", "text/plain", 403)
        scope = (qs.get("scope") or ["all"])[0]
        out = [{k: v for k, v in r.items() if k != "flat"}
               for r in self._records(slug, scope)]
        stamp = time.strftime("%Y%m%d_%H%M%S")
        self._send(json.dumps(out, indent=2).encode(), "application/json; charset=utf-8", 200,
                   {"Content-Disposition":
                    f'attachment; filename={slug}_responses_{scope}_{stamp}.json'})


# ======================================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--admin-token", default=os.environ.get("ADMIN_TOKEN", "beacon-admin"))
    args = ap.parse_args()

    Handler.admin_token = args.admin_token
    init_db()
    seed_beacon()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.daemon_threads = True
    print(f"PROJECT BEACON platform serving on http://{args.host}:{args.port}")
    print(f"  respondent link : http://{args.host}:{args.port}/")
    print(f"  studio builder  : http://{args.host}:{args.port}/studio?token={args.admin_token}")
    print(f"  admin dashboard : http://{args.host}:{args.port}/admin?token={args.admin_token}")
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
