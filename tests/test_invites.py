"""
Request E - the Actions buttons on the Studio dashboard:

    duplicate a study, launch it to a recipient list, pause / relaunch it,
    send the (capped) reminders and read back the per-recipient outbox.

    python3 -m pytest tests/test_invites.py
"""

import io

STUDY = {
    "sections": [{"id": "S1", "title": "Intro"}],
    "questions": [{"id": "Q1", "section": "S1", "type": "open_text", "stem": "Say something"}],
}


def _study(client, title="Panel study", slug=""):
    r = client.post("/api/studio/save",
                    json={"slug": slug, "title": title, "cfg": dict(STUDY)})
    assert r.status_code == 200, r.get_json()
    return r.get_json()["slug"]


def _launch(client, slug, people="a@clinic.org, Dr A\nb@clinic.org\nc@clinic.org", **extra):
    body = {"slug": slug, "recipients": people}
    body.update(extra)
    r = client.post("/api/studio/launch", json=body)
    assert r.status_code == 200, r.get_json()
    return r.get_json()


# ------------------------------------------------------------------ duplicate
def test_duplicate_copies_config_as_a_draft(client):
    slug = _study(client, "Copy me")
    client.post("/api/studio/status", json={"slug": slug, "status": "live"})
    r = client.post("/api/studio/duplicate", json={"slug": slug})
    assert r.status_code == 200, r.get_json()
    new = r.get_json()["slug"]
    assert new.startswith(slug + "-copy") and new != slug
    copy = client.get("/api/studio/study", query_string={"slug": new}).get_json()
    assert copy["status"] == "draft"                      # a copy never goes live on its own
    assert copy["title"] == "Copy me (copy)"
    assert copy["cfg"]["questions"][0]["stem"] == "Say something"
    assert "invites" not in copy["cfg"]                   # the recipient list is not inherited
    # the same title duplicated twice gets a distinct slug
    second = client.post("/api/studio/duplicate", json={"slug": slug}).get_json()["slug"]
    assert second != new and second.startswith(slug + "-copy")
    assert client.post("/api/studio/duplicate", json={"slug": "nope"}).status_code == 404


def test_duplicate_rewrites_media_urls(client):
    slug = _study(client, "Media")
    cfg = dict(STUDY)
    cfg["questions"][0]["media"] = {"kind": "image", "src": f"/media/{slug}/m_1.png"}
    client.post("/api/studio/save", json={"slug": slug, "title": "Media", "cfg": cfg})
    new = client.post("/api/studio/duplicate", json={"slug": slug}).get_json()["slug"]
    copy = client.get("/api/studio/study", query_string={"slug": new}).get_json()
    assert copy["cfg"]["questions"][0]["media"]["src"] == f"/media/{new}/m_1.png"


# --------------------------------------------------------------------- launch
def test_launch_creates_link_records_outbox_and_goes_live(client):
    slug = _study(client, "Launch me")
    out = _launch(client, slug)
    assert out["ok"] is True and out["status"] == "live"
    assert out["link"].endswith("/survey/" + slug)
    assert out["total"] == 3 and out["smtp"] is False        # no SMTP in tests: recorded only
    assert out["queued"] == 3 and out["sent"] == 0
    assert [r["email"] for r in out["outbox"]] == ["c@clinic.org", "b@clinic.org", "a@clinic.org"]
    assert all(r["kind"] == "invite" and r["link"].startswith(out["link"] + "?rid=") for r in out["outbox"])
    state = client.get("/api/studio/invites", query_string={"study": slug}).get_json()
    assert state["status"] == "live"
    assert state["summary"] == {"recipients": 3, "sent": 0, "failed": 0, "queued": 3,
                                "completed": 0, "pending": 3}
    assert state["reminders_sent"] == 0 and state["reminders_left"] == 2 and state["max_reminders"] == 2
    row = {"email": "a@clinic.org", "name": "Dr A", "invited": True, "completed": False}
    assert {k: v for k, v in state["recipients"][0].items() if k not in ("token", "link")} == row
    assert state["recipients"][0]["link"] == state["outbox"][-1]["link"]   # oldest invite wins
    assert state["smtp"]["configured"] is False and "password" not in state["smtp"]
    # the invite token rides along so the export can attribute the response to a person
    assert {"name": "rid"} in client.get("/api/studio/study", query_string={"slug": slug}).get_json()["cfg"]["embedded"]


def test_launch_accepts_a_list_dedupes_and_reports_junk(client):
    slug = _study(client, "Dedupe")
    out = _launch(client, slug, ["A@x.org", "a@x.org  ", {"email": "b@x.org", "name": "Bee"}, "not-an-email"])
    assert out["rejected"] == ["not-an-email"]
    assert [r["email"] for r in out["recipients"]] == ["A@x.org", "b@x.org"]
    assert out["recipients"][1]["name"] == "Bee"


def test_launch_can_store_the_list_without_going_live(client):
    slug = _study(client, "Draft list")
    out = _launch(client, slug, "one@x.org", draft_only=True)
    assert out["status"] == "draft" and out["total"] == 1         # `status` describes the study
    assert client.get("/api/studio/study", query_string={"slug": slug}).get_json()["status"] == "draft"
    state = client.get("/api/studio/invites", query_string={"study": slug}).get_json()
    assert state["recipients"] and state["outbox"]                # the log is always written


def test_launch_requires_recipients_when_asked(client):
    slug = _study(client, "No list")
    r = client.post("/api/studio/launch", json={"slug": slug, "recipients": "", "require_recipients": True})
    assert r.status_code == 400
    assert "email" in r.get_json()["error"].lower()
    assert client.post("/api/studio/launch", json={"slug": "ghost"}).status_code == 404


def test_invite_csv_download(client):
    slug = _study(client, "CSV")
    _launch(client, slug, "a@x.org, Dr A")
    r = client.get("/api/studio/invites.csv", query_string={"study": slug})
    assert r.status_code == 200 and r.mimetype == "text/csv"
    assert "attachment" in r.headers["Content-Disposition"]
    text = r.data.decode()
    assert text.splitlines()[0] == "email,name,kind,status,error,link,created_at,sent_at"
    assert "a@x.org,Dr A,invite,queued" in text
    assert client.get("/api/studio/invites.csv", query_string={"study": "ghost"}).status_code == 404


# ------------------------------------------------------------------- reminders
def test_reminders_are_capped_and_skip_people_who_finished(client):
    slug = _study(client, "Remind")
    out = _launch(client, slug, "a@x.org\nb@x.org")
    tokens = {r["email"]: r["token"] for r in out["outbox"]}
    s = client.post("/api/start", json={"study": slug,
                                        "embedded": {"rid": tokens["b@x.org"]}}).get_json()   # b@ finished
    client.post("/api/submit", json={"session_id": s["session_id"], "elapsed_seconds": 30,
                                     "answers": {"Q1": {"_": "all done"}}})
    state = client.get("/api/studio/invites", query_string={"study": slug}).get_json()
    assert state["summary"]["completed"] == 1 and state["summary"]["pending"] == 1

    r = client.post("/api/studio/remind", json={"slug": slug})
    assert r.status_code == 200, r.get_json()
    j = r.get_json()
    assert j["reminded"] == 1 and j["total"] == 1                 # only a@ was nudged
    assert j["outbox"][0]["kind"] == "reminder"
    assert j["outbox"][0]["email"] == "a@x.org"
    assert j["outbox"][0]["token"] == tokens["a@x.org"]           # same person, same personal link
    assert j["reminders_sent"] == 1 and j["reminders_left"] == 1

    assert client.post("/api/studio/remind", json={"slug": slug}).status_code == 200
    third = client.post("/api/studio/remind", json={"slug": slug})
    assert third.status_code == 400 and "2 reminders" in third.get_json()["error"]
    assert client.post("/api/studio/remind", json={"slug": "ghost"}).status_code == 404


def test_reminder_with_everybody_done(client):
    slug = _study(client, "All done")
    out = _launch(client, slug, "only@x.org")
    s = client.post("/api/start", json={"study": slug,
                                        "embedded": {"rid": out["outbox"][0]["token"]}}).get_json()
    client.post("/api/submit", json={"session_id": s["session_id"], "elapsed_seconds": 30,
                                     "answers": {"Q1": {"_": "done"}}})
    r = client.post("/api/studio/remind", json={"slug": slug})
    assert r.status_code == 400 and "taken part" in r.get_json()["error"]


# ----------------------------------------------------------------- pause / relaunch
def test_pause_stops_new_starts_but_lets_people_finish(client):
    slug = _study(client, "Pause me")
    _launch(client, slug, "")
    first = client.post("/api/start", json={"study": slug}).get_json()      # already answering

    r = client.post("/api/studio/pause", json={"slug": slug})
    assert r.status_code == 200 and r.get_json()["status"] == "paused"
    assert client.post("/api/studio/pause", json={"slug": slug}).status_code == 400   # only from live

    page = client.get("/survey/" + slug)
    assert page.status_code == 200 and b"paused:true" in page.data
    late = client.post("/api/start", json={"study": slug})
    assert late.status_code == 403 and late.get_json()["paused"] is True
    # the person already inside can keep saving and submit
    assert client.post("/api/save", json={"session_id": first["session_id"], "answers": {"Q1": {"_": "part"}}}).status_code == 200
    ok = client.post("/api/submit", json={"session_id": first["session_id"], "elapsed_seconds": 30,
                                          "answers": {"Q1": {"_": "finished anyway"}}})
    assert ok.status_code == 200 and ok.get_json()["ok"] is True

    r = client.post("/api/studio/relaunch", json={"slug": slug})
    assert r.status_code == 200 and r.get_json()["status"] == "live"
    assert client.post("/api/start", json={"study": slug}).status_code == 200
    assert client.post("/api/studio/relaunch", json={"slug": slug}).status_code == 400
    assert client.post("/api/studio/pause", json={"slug": "ghost"}).status_code == 404


def test_draft_and_closed_studies_keep_the_old_page(client):
    slug = _study(client, "Not live")
    early = client.get("/survey/" + slug)
    assert early.status_code == 403 and b"has not been launched yet" in early.data
    client.post("/api/studio/status", json={"slug": slug, "status": "live"})
    client.post("/api/studio/status", json={"slug": slug, "status": "closed"})
    closed = client.get("/survey/" + slug)
    assert closed.status_code == 403 and b"paused" not in closed.data.lower()


def test_paused_status_shows_on_the_dashboard(client):
    slug = _study(client, "Paused card")
    client.post("/api/studio/status", json={"slug": slug, "status": "live"})
    client.post("/api/studio/pause", json={"slug": slug})
    card = next(s for s in client.get("/api/studio/list").get_json() if s["slug"] == slug)
    assert card["status"] == "paused"
    assert {"recipients", "reminders_sent", "invites_sent", "invites_failed", "launched_at"} <= set(card)


def test_launch_sends_through_smtp_when_it_is_configured(client, app, monkeypatch):
    """With a mail server configured every row is really sent and marked so in the log."""
    sent = []
    monkeypatch.setattr("core.mailer.smtp_settings", lambda: {"host": "smtp.test", "port": 25,
                                                              "user": "", "password": "", "from": "team@test",
                                                              "tls": False})
    monkeypatch.setattr("core.mailer.send_mail", lambda to, subject, body, settings: sent.append((to, subject)))

    slug = _study(client, "Mail")
    out = _launch(client, slug, "a@x.org, Dr A\nb@x.org")
    assert out["smtp"] is True and out["sent"] == 2 and out["queued"] == 0
    assert [t[0] for t in sent] == ["a@x.org", "b@x.org"]
    assert "Mail" in sent[0][1]
    state = client.get("/api/studio/invites", query_string={"study": slug}).get_json()
    assert state["summary"]["sent"] == 2
    assert all(r["status"] == "sent" and r["sent_at"] for r in state["outbox"])


def test_a_failed_send_is_recorded_and_visible(client, monkeypatch):
    from core.mailer import MailError
    monkeypatch.setattr("core.mailer.smtp_settings", lambda: {"host": "smtp.test", "port": 25,
                                                              "user": "", "password": "", "from": "team@test",
                                                              "tls": False})

    def boom(to, subject, body, settings):
        raise MailError("mailbox unavailable")

    monkeypatch.setattr("core.mailer.send_mail", boom)
    slug = _study(client, "Broken mail")
    out = _launch(client, slug, "a@x.org")
    assert out["failed"] == 1 and out["sent"] == 0
    state = client.get("/api/studio/invites", query_string={"study": slug}).get_json()
    assert state["summary"]["failed"] == 1
    assert state["outbox"][0]["error"] == "mailbox unavailable"
    assert "a@x.org" in client.get("/api/studio/invites.csv", query_string={"study": slug}).data.decode()


def test_deleting_a_study_clears_its_outbox(client):
    slug = _study(client, "Tidy up")
    _launch(client, slug, "a@x.org")
    client.post("/api/studio/delete", json={"slug": slug})
    assert client.get("/api/studio/invites", query_string={"study": slug}).status_code == 404
    assert client.get("/api/studio/invites.csv", query_string={"study": slug}).status_code == 404


def test_invites_endpoint_rejects_an_unknown_study(client):
    assert client.get("/api/studio/invites", query_string={"study": "ghost"}).status_code == 404


def test_invite_body_carries_the_personal_link():
    from core import mailer
    body = mailer.invite_body("PROJECT BEACON", "https://x.test/survey/beacon?rid=abc", "Two minutes, please.", "reminder")
    assert "https://x.test/survey/beacon?rid=abc" in body and "Two minutes, please." in body
    assert mailer.invite_subject("PROJECT BEACON")
    assert mailer.smtp_settings() is None or isinstance(mailer.smtp_settings(), dict)


def test_front_end_files_still_parse():
    """The dashboard is one big script: a stray quote would take the whole Studio down."""
    import subprocess
    for path in ("static/js/studio.js", "static/js/survey.js", "static/js/qlogic.js"):
        r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
