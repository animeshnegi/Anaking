"""
Database layer.

Schema, migrations, a request-scoped SQLite connection, and thin model classes
(``Study``, ``Respondent``, ``Answer``) that own every SQL statement in the project.
Routes never talk to SQLite directly - they call these classes.
"""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
import threading
import time

from flask import current_app, g

from core.sanitize import sanitize_question

write_lock = threading.Lock()

SLUG_RE = re.compile(r"[a-z0-9\-]{2,40}")

SCHEMA = """
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_resp_code ON respondents(study_id, respondent_code);
CREATE TABLE IF NOT EXISTS answers (
    respondent_id INTEGER,
    question_id TEXT,
    item TEXT,
    value TEXT,
    seconds REAL DEFAULT 0,
    PRIMARY KEY (respondent_id, question_id, item)
);
"""

# Databases created by the very first server had a global UNIQUE on respondent_code.
_MIGRATE_OLD_UNIQUE = """
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
"""


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


class StudyError(Exception):
    """Validation / state error that maps directly to an HTTP status."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message, self.status = message, status


# ====================================================================================
# CONNECTION MANAGEMENT
# ====================================================================================
def connect(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or current_app.config["DB_PATH"], timeout=30,
                           check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def get_db() -> sqlite3.Connection:
    """One connection per request, closed automatically on teardown."""
    if "db" not in g:
        g.db = connect()
    return g.db


def close_db(_exc=None) -> None:
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db(path: str | None = None) -> None:
    conn = connect(path)
    try:
        with conn:
            conn.executescript(SCHEMA)
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(respondents)")}
            if "study_id" not in cols:
                conn.execute("ALTER TABLE respondents ADD COLUMN study_id INTEGER DEFAULT 1")
            if "is_test" not in cols:
                conn.execute("ALTER TABLE respondents ADD COLUMN is_test INTEGER DEFAULT 0")
            tbl_sql = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='respondents'"
            ).fetchone()[0]
            if "respondent_code TEXT UNIQUE" in tbl_sql:
                conn.executescript(_MIGRATE_OLD_UNIQUE)
    finally:
        conn.close()


def init_app(app) -> None:
    app.teardown_appcontext(close_db)


# ====================================================================================
# STUDY
# ====================================================================================
class Study:
    """A survey definition: slug, title, status and JSON config."""

    def __init__(self, row: sqlite3.Row):
        self.id = row["id"]
        self.slug = row["slug"]
        self.title = row["title"]
        self.status = row["status"]
        self.updated_at = row["updated_at"]
        self.created_at = row["created_at"]
        self.cfg: dict = json.loads(row["cfg"]) if row["cfg"] else {}

    @property
    def is_live(self) -> bool:
        return self.status == "live"

    # ---- lookups
    @staticmethod
    def get(slug: str) -> Study | None:
        row = get_db().execute("SELECT * FROM studies WHERE slug=?", (slug,)).fetchone()
        return Study(row) if row else None

    @staticmethod
    def get_by_id(study_id: int) -> Study | None:
        row = get_db().execute("SELECT * FROM studies WHERE id=?", (study_id,)).fetchone()
        return Study(row) if row else None

    @staticmethod
    def cfg_of(slug: str) -> dict:
        s = Study.get(slug)
        return s.cfg if s else {}

    @staticmethod
    def list_with_counts() -> list[dict]:
        rows = get_db().execute(
            "SELECT s.slug, s.title, s.status, s.updated_at, "
            "(SELECT COUNT(*) FROM respondents r WHERE r.study_id=s.id) AS n, "
            "(SELECT COUNT(*) FROM respondents r WHERE r.study_id=s.id AND "
            "r.status='complete') AS c FROM studies s ORDER BY s.id").fetchall()
        return [{"slug": r["slug"], "title": r["title"], "status": r["status"],
                 "updated_at": r["updated_at"], "started": r["n"], "complete": r["c"]}
                for r in rows]

    # ---- mutations
    @staticmethod
    def save(body: dict) -> str:
        """Create or update from a Studio payload ``{slug?, title?, cfg}``. Returns slug."""
        cfg = body.get("cfg") or {}
        title = str(body.get("title") or cfg.get("title") or "Untitled study")[:120]
        slug = str(body.get("slug") or "").lower().strip()
        if not SLUG_RE.fullmatch(slug):
            slug = re.sub(r"[^a-z0-9\-]+", "-", title.lower()).strip("-")[:40] or "study"
        cfg["title"] = title
        for q in cfg.get("questions", []):
            sanitize_question(q)
        ids = [q.get("id") for q in cfg.get("questions", [])]
        if len(ids) != len(set(ids)):
            raise StudyError("duplicate question ids")
        sec_ids = {s.get("id") for s in cfg.get("sections", [])}
        if any(q.get("section") not in sec_ids for q in cfg.get("questions", [])):
            raise StudyError("question references unknown section")
        conn, ts = get_db(), now()
        with write_lock, conn:
            if Study.get(slug):
                conn.execute("UPDATE studies SET title=?, cfg=?, updated_at=? WHERE slug=?",
                             (title, json.dumps(cfg), ts, slug))
            else:
                conn.execute("INSERT INTO studies (slug, title, status, cfg, created_at, "
                             "updated_at) VALUES (?,?,?,?,?,?)",
                             (slug, title, "draft", json.dumps(cfg), ts, ts))
        return slug

    @staticmethod
    def set_status(slug: str, status: str) -> None:
        if status not in ("draft", "live", "closed"):
            raise StudyError("bad status")
        conn = get_db()
        with write_lock, conn:
            conn.execute("UPDATE studies SET status=?, updated_at=? WHERE slug=?",
                         (status, now(), slug))

    @staticmethod
    def delete(slug: str) -> None:
        if slug == "beacon":
            raise StudyError("the seeded beacon study cannot be deleted")
        s = Study.get(slug)
        if not s:
            return
        conn = get_db()
        with write_lock, conn:
            conn.execute("DELETE FROM answers WHERE respondent_id IN "
                         "(SELECT id FROM respondents WHERE study_id=?)", (s.id,))
            conn.execute("DELETE FROM respondents WHERE study_id=?", (s.id,))
            conn.execute("DELETE FROM studies WHERE id=?", (s.id,))

    @staticmethod
    def seed(slug: str, title: str, cfg: dict, status: str = "live") -> bool:
        """Insert a study if it does not exist. Returns True when inserted."""
        conn = get_db()
        with write_lock, conn:
            if conn.execute("SELECT 1 FROM studies WHERE slug=?", (slug,)).fetchone():
                return False
            ts = now()
            conn.execute("INSERT INTO studies (slug, title, status, cfg, created_at, "
                         "updated_at) VALUES (?,?,?,?,?,?)",
                         (slug, title, status, json.dumps(cfg), ts, ts))
            conn.execute("UPDATE respondents SET study_id=1 WHERE study_id IS NULL")
        return True


# ====================================================================================
# RESPONDENT + ANSWERS
# ====================================================================================
class Answer:
    @staticmethod
    def for_respondent(rid: int) -> dict:
        """``{question_id: {item: value}}`` with list-valued items decoded."""
        rows = get_db().execute(
            "SELECT question_id, item, value FROM answers WHERE respondent_id=?", (rid,))
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

    @staticmethod
    def upsert_many(conn: sqlite3.Connection, rid: int, answers: dict, seconds: float) -> None:
        for qid, payload in (answers or {}).items():
            if not isinstance(payload, dict):
                continue
            for item, val in payload.items():
                conn.execute(
                    "INSERT INTO answers (respondent_id, question_id, item, value, seconds) "
                    "VALUES (?,?,?,?,?) ON CONFLICT(respondent_id, question_id, item) "
                    "DO UPDATE SET value=excluded.value, seconds=excluded.seconds",
                    (rid, qid, item,
                     json.dumps(val) if isinstance(val, list) else str(val), seconds))


class Respondent:
    """One survey session. ``row`` is the raw sqlite row; helpers wrap the lifecycle."""

    def __init__(self, row: sqlite3.Row):
        self.row = row
        self.id = row["id"]
        self.code = row["respondent_code"]
        self.session_id = row["session_id"]
        self.study_id = row["study_id"]
        self.is_test = bool(row["is_test"])
        self.status = row["status"]

    def __getitem__(self, key):           # keep dict-style access used by reporting
        return self.row[key]

    # ---- lookups
    @staticmethod
    def by_session(session_id: str | None) -> Respondent | None:
        if not session_id:
            return None
        row = get_db().execute("SELECT * FROM respondents WHERE session_id=?",
                               (session_id,)).fetchone()
        return Respondent(row) if row else None

    @staticmethod
    def by_id(rid: int) -> Respondent | None:
        row = get_db().execute("SELECT * FROM respondents WHERE id=?", (rid,)).fetchone()
        return Respondent(row) if row else None

    @staticmethod
    def for_study(study_id: int, scope: str = "all") -> list[sqlite3.Row]:
        rows = get_db().execute("SELECT * FROM respondents WHERE study_id=? ORDER BY id",
                                (study_id,)).fetchall()
        if scope == "real":
            return [r for r in rows if not r["is_test"]]
        if scope == "test":
            return [r for r in rows if r["is_test"]]
        return rows

    # ---- lifecycle
    @staticmethod
    def create(study: Study, is_test: bool, user_agent: str = "") -> Respondent:
        """Allocate the next T###/R### code for the study and open a session."""
        conn = get_db()
        sid = secrets.token_urlsafe(16)
        prefix = "T" if is_test else "R"
        with write_lock, conn:
            row = conn.execute(
                "SELECT MAX(CAST(SUBSTR(respondent_code,2) AS INTEGER)) AS m FROM respondents "
                "WHERE study_id=? AND respondent_code LIKE ?", (study.id, prefix + "%")
            ).fetchone()
            code = f"{prefix}{(row['m'] or 0) + 1:03d}"
            conn.execute(
                "INSERT INTO respondents (respondent_code, session_id, study_id, is_test, "
                "started_at, user_agent) VALUES (?,?,?,?,?,?)",
                (code, sid, study.id, int(is_test), now(), (user_agent or "")[:300]))
        return Respondent.by_session(sid)

    def set_assignment(self, task_order: list, alt_positions: dict) -> None:
        conn = get_db()
        with write_lock, conn:
            conn.execute("UPDATE respondents SET task_order=?, alt_positions=? WHERE id=?",
                         (json.dumps(task_order), json.dumps(alt_positions), self.id))

    def persist(self, body: dict) -> str:
        """Upsert answers + timing from a save/submit payload. Returns new status."""
        seconds = float(body.get("elapsed_seconds") or 0)
        status = "screened_out" if body.get("screened_out") else self.status
        conn = get_db()
        with write_lock, conn:
            Answer.upsert_many(conn, self.id, body.get("answers"), seconds)
            conn.execute(
                "UPDATE respondents SET elapsed_seconds=?, status=?, screen_out_at=?, "
                "screen_out_reason=? WHERE id=?",
                (seconds, status, body.get("screen_out_at") or self.row["screen_out_at"],
                 body.get("screen_out_reason") or self.row["screen_out_reason"], self.id))
        return status

    def complete(self, seconds: float) -> None:
        conn = get_db()
        with write_lock, conn:
            conn.execute("UPDATE respondents SET status='complete', completed_at=?, "
                         "elapsed_seconds=? WHERE id=?", (now(), seconds, self.id))

    def answers(self) -> dict:
        return Answer.for_respondent(self.id)

    def progress(self) -> dict:
        return {"exists": True, "respondent_code": self.code, "status": self.status,
                "is_test": self.is_test, "answers": self.answers(),
                "task_order": json.loads(self.row["task_order"] or "[]"),
                "alt_positions": json.loads(self.row["alt_positions"] or "{}"),
                "elapsed_seconds": self.row["elapsed_seconds"]}

    def voice_filename(self, qid: str, ext: str) -> str:
        study = Study.get_by_id(self.study_id)
        return f"{study.slug}__{self.code}_{qid}.{ext}"

    # ---- bulk
    @staticmethod
    def reset(study: Study | None, scope: str) -> int:
        """Delete respondents (and answers) of a study by scope. Returns count deleted."""
        if scope not in ("test", "real", "all"):
            raise StudyError("scope must be test, real or all")
        sid = study.id if study else -1
        conn = get_db()
        with write_lock, conn:
            if scope == "all":
                conn.execute("DELETE FROM answers WHERE respondent_id IN "
                             "(SELECT id FROM respondents WHERE study_id=?)", (sid,))
                return conn.execute("DELETE FROM respondents WHERE study_id=?",
                                    (sid,)).rowcount
            want = 1 if scope == "test" else 0
            ids = [r["id"] for r in conn.execute(
                "SELECT id FROM respondents WHERE study_id=? AND is_test=?", (sid, want))]
            if ids:
                q = ",".join("?" * len(ids))
                conn.execute(f"DELETE FROM answers WHERE respondent_id IN ({q})", ids)
                conn.execute(f"DELETE FROM respondents WHERE id IN ({q})", ids)
            return len(ids)
