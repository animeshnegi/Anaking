"""
In-process tests for the Flask platform (no running server needed).

    python3 -m pytest
"""

import base64
import io

from openpyxl import load_workbook

PILOT_CFG = {
    "sections": [{"id": "S1", "title": "Intro"}],
    "questions": [
        {"id": "Q1", "section": "S1", "type": "single_select", "stem": "Pick one",
         "options": [{"code": 1, "label": "A"}, {"code": 2, "label": "B"}]},
        {"id": "Q2", "section": "S1", "type": "open_text", "stem": "Why?"},
    ],
    "qc": {"min_seconds": 10, "verbatim_qs": ["Q2"]},
}


def _start(client, study="beacon", is_test=True):
    r = client.post("/api/start", json={"study": study, "is_test": is_test})
    assert r.status_code == 200, r.get_json()
    return r.get_json()


# ---------------------------------------------------------------- pages & assets
def test_health(client):
    assert client.get("/healthz").get_json()["ok"] is True


def test_home_page_links_to_all_apps(client, token):
    r = client.get("/")
    assert r.status_code == 200
    for link in (b'href="/survey/"', b'href="/studio/"', b'href="/admin/"', b'href="/login'):
        assert link in r.data
    assert b"PROJECT BEACON - US Oncologist" in r.data       # seeded study listed
    assert b"sign in required" in r.data
    r = client.get("/", query_string={"token": "nope"})     # wrong token: no session
    assert b"not correct" in r.data
    # a ?token= on the home page signs the browser in (old bookmarks keep working)
    r = client.get("/", query_string={"token": token})
    assert b"Signed in as research team" in r.data
    assert b'href="/studio/#beacon"' in r.data and b'href="/admin/?study=beacon"' in r.data
    assert b"sign in required" not in r.data


def test_survey_pages_inject_study_slug(client):
    for path in ("/survey/", "/survey/test", "/survey/beacon", "/survey/beacon/test"):
        r = client.get(path)
        assert r.status_code == 200, path
        assert b'window.STUDY={slug:"beacon"}' in r.data
        assert b"/static/js/survey.js" in r.data
    assert client.get("/survey/does-not-exist").status_code == 404


def test_legacy_urls_redirect(client):
    assert client.get("/test").headers["Location"].endswith("/survey/test")
    r = client.get("/s/beacon/test", query_string={"preview": "x"})
    assert r.status_code == 301 and r.headers["Location"].endswith("/survey/beacon/test?preview=x")


def test_static_assets_served(client):
    assert client.get("/static/js/survey.js").status_code == 200
    assert client.get("/static/css/survey.css").mimetype == "text/css"
    assert client.get("/survey.js").status_code == 404   # old flat paths are gone
    assert client.get("/audio/welcome.mp3").mimetype == "audio/mpeg"
    r = client.get("/audio/welcome.mp3", headers={"Range": "bytes=0-9"})
    assert r.status_code == 206 and len(r.data) == 10
    assert client.get("/audio/app.py").status_code == 404


def test_api_errors_are_json(client):
    r = client.get("/api/spec/nope")
    assert r.status_code == 404 and r.get_json()["error"] == "unknown study"
    assert client.get("/api/does-not-exist").status_code == 404
    assert client.get("/api/does-not-exist").is_json


# ---------------------------------------------------------------- auth
def test_admin_and_studio_need_token(client, token):
    # pages redirect an anonymous browser to the sign-in form; APIs answer 403 JSON
    for path in ("/admin/", "/studio/"):
        r = client.get(path)
        assert r.status_code == 302 and r.headers["Location"].startswith("/login?next="), path
        assert client.get(path, query_string={"token": "wrong"}).status_code == 302, path
    for path in ("/api/admin/data", "/api/studio/list", "/admin/export.xlsx", "/admin/export.csv"):
        assert client.get(path).status_code == 403, path
        assert client.get(path, query_string={"token": "wrong"}).status_code == 403, path
    assert client.post("/admin/reset").status_code == 403
    assert client.post("/api/studio/save", json={}).status_code == 403
    # explicit ?token= still works everywhere (scripts, printed start-up links)
    for path in ("/admin/", "/studio/", "/api/admin/data", "/api/studio/list",
                 "/admin/export.xlsx", "/admin/export.csv"):
        assert client.get(path, query_string={"token": token}).status_code == 200, path


def test_login_session_unlocks_everything(client, token):
    assert client.get("/login").status_code == 200
    r = client.post("/login", data={"token": "wrong", "next": "/studio/"})
    assert r.status_code == 401 and b"not correct" in r.data
    r = client.post("/login", data={"token": token, "next": "/studio/#beacon"})
    assert r.status_code == 302 and r.headers["Location"] == "/studio/#beacon"
    # no token anywhere from here on
    for path in ("/studio/", "/admin/", "/api/studio/list", "/api/admin/data", "/admin/export.csv"):
        assert client.get(path).status_code == 200, path
    assert client.post("/api/studio/save", json={"title": "Draft X", "cfg": {
        "sections": [{"id": "S1", "title": "A"}],
        "questions": [{"id": "Q1", "section": "S1", "type": "open_text", "stem": "x"}]}}).status_code == 200
    assert client.get("/survey/draft-x").status_code == 200            # drafts previewable when signed in
    assert b"Research-team view" in client.get("/survey/draft-x/test").data
    # open redirects are refused
    r = client.post("/login", data={"token": token, "next": "https://evil.example/"})
    assert r.headers["Location"] == "/"
    client.get("/logout")
    assert client.get("/studio/").status_code == 302
    assert client.get("/survey/draft-x").status_code == 403


def test_login_without_cookies_falls_back_to_url_token(client, token):
    # no prior GET /login -> no probe cookie -> token is carried in the redirect URL
    r = client.post("/login", data={"token": token, "next": "/studio/?x=1#beacon"})
    assert r.status_code == 302 and r.headers["Location"] == f"/studio/?x=1&token={token}#beacon"
    r = client.get("/", query_string={"token": token})
    assert b"Signed in" in r.data


def test_respondents_never_see_team_chrome(client):
    r = client.get("/survey/")
    assert b"Research-team view" not in r.data and b"appnav" not in r.data


# ---------------------------------------------------------------- respondent flow
def test_beacon_seeded_and_spec_shape(client):
    spec = client.get("/api/spec").get_json()
    assert len(spec["questions"]) >= 20
    assert spec["conjoint"]["n_tasks"] == 9
    assert isinstance(spec["conjoint"]["tasks"], dict)   # engine addresses tasks by key
    assert spec["terminate_text"]


def test_start_assigns_codes_and_design(client):
    a = _start(client, is_test=True)
    b = _start(client, is_test=False)
    c = _start(client, is_test=True)
    assert (a["respondent_code"], b["respondent_code"], c["respondent_code"]) == \
        ("T001", "R001", "T002")
    assert sorted(b["task_order"]) == list(range(1, 10))
    assert b["from_prebuilt_map"] is True   # R001 comes from respondent_task_map.csv
    assert len(b["alt_positions"]) == 9


def test_save_submit_progress_roundtrip(client, token):
    s = _start(client)
    sid = s["session_id"]
    r = client.post("/api/save", json={"session_id": sid, "elapsed_seconds": 30,
                                       "answers": {"Q12": {"_": "5"},
                                                   "Q4": {"codes": [1, 3]}}})
    assert r.get_json() == {"ok": True, "status": "in_progress"}
    p = client.get("/api/progress", query_string={"sid": sid}).get_json()
    assert p["exists"] and p["answers"]["Q12"]["_"] == "5"
    assert p["answers"]["Q4"]["codes"] == [1, 3]

    r = client.post("/api/submit", json={"session_id": sid, "elapsed_seconds": 60})
    body = r.get_json()
    assert body["ok"] and body["respondent_code"] == "T001"
    assert "speeder" in body["flags"]           # 60 s << 480 s minimum

    data = client.get("/api/admin/data", query_string={"token": token}).get_json()
    assert data["counts"] == {"total": 1, "complete": 1, "screened_out": 0, "in_progress": 0}
    assert client.get("/api/progress", query_string={"sid": "nope"}).get_json() == \
        {"exists": False}


def test_unknown_session_rejected(client):
    assert client.post("/api/save", json={"session_id": "x"}).status_code == 400
    assert client.post("/api/submit", json={"session_id": "x"}).status_code == 400
    assert client.post("/api/save", data="not json",
                       content_type="application/json").status_code == 400


def test_voice_upload(client, token, app):
    s = _start(client)
    blob = base64.b64encode(b"\x1aE\xdf\xa3fake-webm").decode()
    r = client.post("/api/voice", json={"session_id": s["session_id"], "qid": "Q8b",
                                        "ext": "webm", "data": blob})
    assert r.get_json()["file"] == "beacon__T001_Q8b.webm"
    r = client.get("/admin/voice/beacon__T001_Q8b.webm", query_string={"token": token})
    assert r.status_code == 200 and r.mimetype == "audio/webm"
    bad = client.post("/api/voice", json={"session_id": s["session_id"], "qid": "../x",
                                          "data": blob})
    assert bad.status_code == 400
    bad = client.post("/api/voice", json={"session_id": s["session_id"], "qid": "Q1",
                                          "data": "%%%not-base64%%%"})
    assert bad.status_code == 400


# ---------------------------------------------------------------- studio lifecycle
def test_studio_create_launch_respond_delete(client, token):
    q = {"token": token}
    r = client.post("/api/studio/save", query_string=q,
                    json={"title": "Pilot Study", "cfg": PILOT_CFG})
    assert r.get_json() == {"ok": True, "slug": "pilot-study"}

    # drafts are hidden from the public but visible with the preview token
    assert client.get("/survey/pilot-study").status_code == 403
    assert client.get("/survey/pilot-study", query_string={"preview": token}).status_code == 200
    r = client.post("/api/start", json={"study": "pilot-study"})
    assert r.status_code == 403 and r.get_json()["error"] == "study not live"

    r = client.post("/api/studio/status", query_string=q,
                    json={"slug": "pilot-study", "status": "live"})
    assert r.get_json()["ok"]
    s = _start(client, "pilot-study")
    assert s["task_order"] == []   # no conjoint in this study
    client.post("/api/save", json={"session_id": s["session_id"], "elapsed_seconds": 5,
                                   "answers": {"Q1": {"_": "2"},
                                               "Q2": {"_": "qwertyuiop asdfghjkl zxcvbnm"}}})
    done = client.post("/api/submit", json={"session_id": s["session_id"],
                                            "elapsed_seconds": 5}).get_json()
    assert set(done["flags"]) == {"speeder", "gibberish_verbatim_Q2"}

    # data is isolated per study
    listing = {x["slug"]: x for x in client.get("/api/studio/list",
                                                 query_string=q).get_json()}
    assert listing["pilot-study"]["complete"] == 1
    assert listing["beacon"]["started"] == 0

    csv_txt = client.get("/admin/export.csv",
                         query_string={"token": token, "study": "pilot-study"}).data.decode()
    header, row = csv_txt.splitlines()[:2]
    rec = dict(zip(header.split(","), row.split(",")))
    assert rec["Q1"] == "2" and rec["Q1_text"] == "B" and rec["is_test"] == "test"
    assert "gibberish_verbatim_Q2" in rec["qc_flags"]

    assert client.post("/api/studio/delete", query_string=q,
                       json={"slug": "beacon"}).status_code == 400
    assert client.post("/api/studio/delete", query_string=q,
                       json={"slug": "pilot-study"}).get_json()["ok"]
    assert client.get("/survey/pilot-study").status_code == 404


def test_studio_validation(client, token):
    q = {"token": token}
    bad = dict(PILOT_CFG, questions=[{"id": "Q1", "section": "S1", "type": "open_text",
                                      "stem": ""}] * 2)
    r = client.post("/api/studio/save", query_string=q, json={"title": "x", "cfg": bad})
    assert r.status_code == 400 and "duplicate" in r.get_json()["error"]
    bad = dict(PILOT_CFG, questions=[{"id": "Q1", "section": "NOPE", "type": "open_text",
                                      "stem": ""}])
    r = client.post("/api/studio/save", query_string=q, json={"title": "x", "cfg": bad})
    assert r.status_code == 400 and "unknown section" in r.get_json()["error"]
    r = client.post("/api/studio/status", query_string=q,
                    json={"slug": "beacon", "status": "bogus"})
    assert r.status_code == 400


def test_make_conjoint_is_balanced(client, token):
    attrs = [{"id": "price", "levels": ["$1", "$2", "$3"], "higher_is_bad": True},
             {"id": "efficacy", "levels": ["low", "mid", "high"]}]
    r = client.post("/api/studio/make_conjoint", query_string={"token": token},
                    json={"attributes": attrs, "n_tasks": 9, "seed": 3})
    d = r.get_json()
    assert len(d["tasks"]) == 9 and all(len(t) == 3 for t in d["tasks"])
    # exact level balance: 9 tasks x 3 alts = 27 profiles, 3 levels -> 9 each
    for attr in ("price", "efficacy"):
        assert list(d["balance"][attr].values()) == [9, 9, 9]
    # no alternative fully dominates another within a task
    for task in d["tasks"]:
        for x in task:
            for y in task:
                if x is y:
                    continue
                gx = (2 - x["price"], x["efficacy"])
                gy = (2 - y["price"], y["efficacy"])
                assert not (gx[0] >= gy[0] and gx[1] >= gy[1] and gx != gy), task
    r = client.post("/api/studio/make_conjoint", query_string={"token": token},
                    json={"attributes": [{"id": "x"}]})
    assert r.status_code == 400


# ---------------------------------------------------------------- exports & reset
def test_xlsx_export_and_reset(client, token):
    _start(client, is_test=True)
    real = _start(client, is_test=False)
    client.post("/api/submit", json={"session_id": real["session_id"], "elapsed_seconds": 900})

    r = client.get("/admin/export.xlsx", query_string={"token": token, "scope": "all"})
    assert r.status_code == 200 and r.data[:2] == b"PK"
    assert "spreadsheetml" in r.mimetype
    assert r.headers["X-Export-Backend"] in ("openpyxl", "stdlib")
    wb = load_workbook(io.BytesIO(r.data))
    assert {"Field summary", "Responses", "Conjoint long", "Screen-outs", "QC flags",
            "Data dictionary"} <= set(wb.sheetnames)
    assert wb["Responses"].max_row - 1 == 2

    r = client.get("/admin/export.json", query_string={"token": token, "scope": "real"})
    body = r.get_json()
    assert [x["respondent_code"] for x in body] == ["R001"]
    assert "flat" not in body[0]

    r = client.post("/admin/reset", query_string={"token": token, "scope": "test"})
    assert r.get_json()["deleted_respondents"] == 1
    r = client.post("/admin/reset", query_string={"token": token, "scope": "bogus"})
    assert r.status_code == 400
    data = client.get("/api/admin/data", query_string={"token": token}).get_json()
    assert data["counts"]["total"] == 1


# ---------------------------------------------------------------- narration clips
def _mp3_bytes():
    # minimal MP3: a few valid MPEG-1 Layer III frame headers with silent payload
    frame = b"\xff\xfb\x90\x00" + b"\x00" * 413
    return frame * 8


def test_narration_upload_serve_delete(client, token, app):
    q = {"token": token, "study": "beacon"}
    r = client.post("/api/studio/narration", query_string=q,
                    data={"file": (io.BytesIO(_mp3_bytes()), "welcome.mp3")},
                    content_type="multipart/form-data")
    body = r.get_json()
    assert r.status_code == 200 and body["ok"], body
    assert body["clip"].startswith("clip_") and body["src"].startswith("/narration/beacon/")
    assert body["seconds"] is None or body["seconds"] > 0

    # public playback, with Range support
    r = client.get(body["src"])
    assert r.status_code == 200 and r.mimetype == "audio/mpeg"
    r = client.get(body["src"], headers={"Range": "bytes=0-99"})
    assert r.status_code == 206 and len(r.data) == 100

    # attach to a scene, save, and the spec exposes it to the survey
    study = client.get("/api/studio/study", query_string={"token": token, "slug": "beacon"}).get_json()
    cfg = study["cfg"]
    cfg["explainer_scenes"] = [{"id": "sc_1", "art": "dosing", "title": "Dose", "caption": "Once daily",
                                "src": body["src"], "seconds": body["seconds"]},
                               {"id": "sc_2", "art": "generic", "title": "Custom", "caption": "Anything"}]
    r = client.post("/api/studio/save", query_string={"token": token},
                    json={"slug": "beacon", "title": study["title"], "cfg": cfg})
    assert r.get_json()["ok"]
    spec = client.get("/api/spec/beacon").get_json()
    assert [s["art"] for s in spec["explainer_scenes"]] == ["dosing", "generic"]
    assert spec["explainer_scenes"][0]["src"] == body["src"]

    r = client.post("/api/studio/narration/delete", query_string={"token": token},
                    json={"study": "beacon", "clip": body["clip"]})
    assert r.get_json() == {"ok": True, "removed": 1}
    assert client.get(body["src"]).status_code == 404


def test_narration_upload_validation(client, token):
    q = {"token": token, "study": "beacon"}
    assert client.post("/api/studio/narration", query_string=q).status_code == 400
    r = client.post("/api/studio/narration", query_string=q,
                    data={"file": (io.BytesIO(b"x"), "notes.txt")},
                    content_type="multipart/form-data")
    assert r.status_code == 400 and "unsupported" in r.get_json()["error"]
    r = client.post("/api/studio/narration", query_string={"token": token, "study": "nope"},
                    data={"file": (io.BytesIO(b"x"), "a.mp3")}, content_type="multipart/form-data")
    assert r.status_code == 404
    assert client.post("/api/studio/narration", query_string={"study": "beacon"}).status_code == 403
    r = client.post("/api/studio/narration/delete", query_string={"token": token},
                    json={"study": "beacon", "clip": "../../etc"})
    assert r.status_code == 400
    assert client.get("/narration/beacon/missing.mp3").status_code == 404
    assert client.get("/narration/beacon/app.py").status_code == 404


# ---------------------------------------------------------------- question editor features
def test_rich_text_is_sanitised_on_save(client, token):
    cfg = {"sections": [{"id": "S1", "title": "A"}],
           "questions": [{"id": "Q1", "section": "S1", "type": "single_select",
                          "stem": "old", "stem_html": '<b onclick="x()">Hi</b><script>evil()</script>'
                          '<span style="color:#f00;position:absolute">red</span> {Q0}',
                          "help_html": '<img src=x onerror=alert(1)>',
                          "options": [{"code": 1, "label": "A"}, {"code": 99, "label": "None", "exclusive": True}]}]}
    r = client.post("/api/studio/save", query_string={"token": token}, json={"title": "Rich", "cfg": cfg})
    assert r.get_json()["ok"]
    saved = client.get("/api/studio/study", query_string={"token": token, "slug": "rich"}).get_json()["cfg"]
    q = saved["questions"][0]
    assert q["stem_html"] == '<b>Hi</b>evil()<span style="color: #f00">red</span> {Q0}'
    assert "help_html" not in q                      # only an unsafe img -> nothing left
    assert q["stem"] == "Hievil()red {Q0}"           # plain stem kept in step for exports/TTS
    spec = client.get("/api/spec/rich").get_json()
    assert spec["questions"][0]["options"][1]["exclusive"] is True


def test_media_upload_serve_delete(client, token):
    q = {"token": token, "study": "beacon"}
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    r = client.post("/api/studio/media", query_string=q,
                    data={"file": (io.BytesIO(png), "diagram.png")}, content_type="multipart/form-data")
    j = r.get_json()
    assert r.status_code == 200 and j["kind"] == "image" and j["src"].startswith("/media/beacon/m_")
    assert client.get(j["src"]).status_code == 200
    assert client.get(j["src"]).mimetype == "image/png"
    # bad types / svg with script are refused
    r = client.post("/api/studio/media", query_string=q,
                    data={"file": (io.BytesIO(b"x"), "evil.exe")}, content_type="multipart/form-data")
    assert r.status_code == 400
    r = client.post("/api/studio/media", query_string=q,
                    data={"file": (io.BytesIO(b"<svg onload=alert(1)></svg>"), "e.svg")},
                    content_type="multipart/form-data")
    assert r.status_code == 400
    assert client.post("/api/studio/media", data={"file": (io.BytesIO(png), "a.png")},
                       content_type="multipart/form-data").status_code == 403
    r = client.post("/api/studio/media/delete", query_string={"token": token},
                    json={"study": "beacon", "file": j["file"]})
    assert r.get_json()["removed"] == 1
    assert client.get(j["src"]).status_code == 404


def test_export_includes_order_and_logic(client, token):
    cfg = {"sections": [{"id": "S1", "title": "A"}],
           "questions": [{"id": "Q1", "section": "S1", "type": "multi_select", "randomize": "shuffle",
                          "options": [{"code": 1, "label": "A"}, {"code": 2, "label": "B"}], "stem": "pick"},
                         {"id": "Q2", "section": "S1", "type": "open_text", "stem": "why",
                          "show_if": {"match": "all", "rules": [{"q": "Q1", "op": "selected", "value": "2"}]}}]}
    client.post("/api/studio/save", query_string={"token": token}, json={"title": "Logic", "cfg": cfg})
    client.post("/api/studio/status", query_string={"token": token}, json={"slug": "logic", "status": "live"})
    s = _start(client, "logic")
    client.post("/api/submit", json={"session_id": s["session_id"], "elapsed_seconds": 30,
                                     "answers": {"Q1": {"codes": [2, 1], "_order": "2,1"}, "Q2": {"_": "because"}}})
    import csv as _csv
    csv_txt = client.get("/admin/export.csv", query_string={"token": token, "study": "logic"}).data.decode()
    rec = next(_csv.DictReader(io.StringIO(csv_txt)))
    assert rec["Q1_order_shown"] == "2,1" and rec["Q1"] == "1;2"
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(client.get("/admin/export.xlsx", query_string={"token": token, "study": "logic"}).data))
    dd = [tuple(r) for r in wb["Data dictionary"].iter_rows(values_only=True)]
    assert any(r[4] == "(show-if)" and "Q1 selected 2" in str(r[5]) for r in dd)
