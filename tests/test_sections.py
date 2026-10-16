"""Section names are entirely user-defined - nothing is predefined anywhere.

    python3 -m pytest tests/test_sections.py

The Studio creates a new study with a single *unnamed* section; the author names it.  The server
must not invent, default or rewrite a section title, and an unnamed section has to round-trip
untouched rather than being filled in with "Section 1".
"""

import pytest

import models


def _cfg(*titles):
    return {"sections": [{"id": f"S{i + 1}", "title": t, "blurb": None} for i, t in enumerate(titles)],
            "questions": [{"id": "Q1", "section": "S1", "type": "open_text", "stem": "x"}]}


def _saved(client, slug):
    return client.get(f"/api/studio/study?slug={slug}").get_json()["cfg"]


def test_an_unnamed_section_stays_unnamed(client):
    """No default title is written over an empty one."""
    r = client.post("/api/studio/save", json={"title": "Blank Section Study", "cfg": _cfg("")})
    assert r.status_code == 200, r.get_json()
    cfg = _saved(client, r.get_json()["slug"])
    assert cfg["sections"][0]["title"] == ""


def test_any_section_name_is_kept_verbatim(client):
    """Whatever the author types comes back byte for byte - including odd casing and symbols."""
    names = ["Screeners", "main questions", "Part 2 - Pricing & value", "Ünïcode ⓘ", ""]
    r = client.post("/api/studio/save", json={"title": "Named Study", "cfg": {
        "sections": [{"id": f"S{i + 1}", "title": t} for i, t in enumerate(names)],
        "questions": [{"id": "Q1", "section": "S1", "type": "open_text", "stem": "x"}]}})
    assert r.status_code == 200, r.get_json()
    assert [s["title"] for s in _saved(client, r.get_json()["slug"])["sections"]] == names


def test_renaming_a_section_round_trips(client):
    r = client.post("/api/studio/save", json={"title": "Rename Study", "cfg": _cfg("Start")})
    slug = r.get_json()["slug"]
    cfg = _saved(client, slug)
    cfg["sections"][0]["title"] = "Screening and eligibility"
    assert client.post("/api/studio/save", json={"slug": slug, "cfg": cfg}).status_code == 200
    assert _saved(client, slug)["sections"][0]["title"] == "Screening and eligibility"


def test_the_server_does_not_add_sections(client):
    """A study with one section keeps exactly one; nothing is created behind the author's back."""
    r = client.post("/api/studio/save", json={"title": "Single Section", "cfg": _cfg("Only")})
    assert len(_saved(client, r.get_json()["slug"])["sections"]) == 1


def test_no_section_migration_rewrites_titles(client):
    """models.init_db() must not touch a stored title - including the old defaults."""
    r = client.post("/api/studio/save",
                    json={"title": "Old Defaults", "cfg": _cfg("Introduction", "Main questions")})
    slug = r.get_json()["slug"]
    with client.application.app_context():
        models.init_db()
    assert [s["title"] for s in _saved(client, slug)["sections"]] == ["Introduction", "Main questions"]


def test_questions_must_point_at_a_real_section(client):
    """The one rule that survives: a section has to exist for a question to live in it."""
    r = client.post("/api/studio/save", json={"title": "Bad Ref", "cfg": {
        "sections": [{"id": "S1", "title": "Only"}],
        "questions": [{"id": "Q1", "section": "S9", "type": "open_text", "stem": "x"}]}})
    assert r.status_code == 400
    assert "unknown section" in r.get_json()["error"]
