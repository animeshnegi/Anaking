"""
Globalisation + the new builder features: language catalogue, extraction of
respondent-visible strings only, manual and machine translation, spec merging,
Word outline, Move survey, and the new question types end to end.

    python3 -m pytest tests/test_globalize.py
"""

import csv
import io
import json
import zipfile

import pytest

from core.i18n import apply_language, coverage, extract_strings, valid_language
from core.outline import build_outline
from core.translator import TranslationError, machine_translate, translate_html


GLOBAL_CFG = {
    "title": "Global study",
    "language": "en-US",
    "welcome_title": "Welcome",
    "welcome_text": "Ten minutes of your time.",
    "thanks_title": "Thank you",
    "thanks_text": "That is everything.",
    "embedded": [{"name": "panel"}],
    "sections": [{"id": "S1", "title": "Intro"}],
    "questions": [
        {"id": "TB1", "section": "S1", "type": "text_block", "required": False,
         "body": "Please read the instructions carefully."},
        {"id": "Q1", "section": "S1", "type": "single_select", "stem": "Pick one",
         "options": [{"code": 1, "label": "Option A"}, {"code": 2, "label": "Option B"}]},
        {"id": "Q2", "section": "S1", "type": "open_text", "stem": "Why?",
         "help": "A sentence is fine", "placeholder": "Type here",
         "notes_for_team": "probe for spontaneity"},          # team-facing: never extracted
    ],
    "qc": {"min_seconds": 5},
}


# ---------------------------------------------------------------- extraction & merging
def test_only_respondent_strings_are_extracted():
    keys = {x["key"] for x in extract_strings(GLOBAL_CFG)}
    assert "q:Q1:stem" in keys and "q:Q1:opt:1" in keys
    assert "study:welcome_text" in keys and "sec:S1:title" in keys
    assert "q:Q2:help" in keys and "q:Q2:placeholder" in keys and "q:TB1:body" in keys
    # team-facing content must never appear - it stays in the default language
    assert not any("notes" in x["text"].lower() for x in extract_strings(GLOBAL_CFG))
    assert not any("qc" in k or "notes" in k for k in keys)


def test_apply_language_merges_and_falls_back():
    cfg = dict(GLOBAL_CFG, translations={"es": {
        "q:Q1:stem": "Elige uno", "q:Q1:opt:1": "Opción A",
        "study:welcome_text": "Diez minutos de su tiempo."}})
    out = apply_language(cfg, "es")
    q1 = out["questions"][1]
    assert q1["stem"] == "Elige uno"
    assert q1["options"][0]["label"] == "Opción A"
    assert q1["options"][1]["label"] == "Option B"          # untranslated -> fallback
    assert out["welcome_text"] == "Diez minutos de su tiempo."
    assert out["thanks_text"] == "That is everything."      # untranslated -> fallback
    assert out["render_language"] == "es"
    # the original config is untouched
    assert GLOBAL_CFG["questions"][1]["stem"] == "Pick one"
    # default language renders untouched
    assert apply_language(cfg, "en-US")["questions"][1]["stem"] == "Pick one"


def test_coverage_counts_missing_strings():
    cfg = dict(GLOBAL_CFG, translations={"es": {"q:Q1:stem": "Elige uno"}})
    cov = coverage(cfg, "es")
    assert cov["translated"] == 1 and cov["total"] == len(extract_strings(GLOBAL_CFG))
    assert "q:Q1:opt:1" in cov["missing"]


def test_valid_language():
    assert valid_language("es") and valid_language("zh-CN")
    assert not valid_language("") and not valid_language("!!")


# ---------------------------------------------------------------- machine translation
def _fake(url):
    assert "translate.googleapis.com" in url and "tl=es" in url
    return json.dumps([[["UNO\nDOS", "one\ntwo", None, None]], None, "en"])


def test_machine_translate_uses_the_endpoint_and_joins_segments():
    assert machine_translate("one", "es", fetcher=_fake) == "UNO\nDOS"


def test_machine_translate_fails_softly():
    def boom(url):
        raise OSError("no network")
    with pytest.raises(TranslationError):
        machine_translate("text", "es", fetcher=boom)
    with pytest.raises(TranslationError):
        machine_translate("text", "es", fetcher=lambda u: "not json")


def test_translate_html_keeps_tags_and_translates_text():
    from urllib.parse import unquote

    def fake(url):
        q = unquote(url.split("q=")[1])
        return json.dumps([[["[" + q + "]", None, None, None]], None, "en"])
    out = translate_html("Hello <b>doctor</b>, thanks", "es", fetcher=fake)
    assert out.count("<b>") == 1 and out.count("</b>") == 1
    assert out == "[Hello]<b>[doctor]</b>[, thanks]"   # text nodes stripped, tags kept


# ---------------------------------------------------------------- Word outline
def test_word_outline_is_a_real_docx_with_the_questionnaire():
    import copy
    cfg = copy.deepcopy(GLOBAL_CFG)
    cfg["questions"][1]["options"][0]["terminate"] = True     # screening / termination
    cfg["questions"][2]["show_if"] = {"rules": [{"q": "Q1", "op": "selected", "value": "1"}]}
    cfg["translations"] = {"es": {"q:Q1:stem": "Elige uno"}}
    data = build_outline(cfg)
    assert data[:2] == b"PK"
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = z.namelist()
        assert "[Content_Types].xml" in names and "word/document.xml" in names
        doc = z.read("word/document.xml").decode("utf-8")
    # questions + options + applied logic, well formatted
    assert "Global study" in doc and "Pick one" in doc
    assert "-  1. Option A  [TERMINATES]" in doc and "-  2. Option B" in doc
    assert "Show only if Q1 has selected 1" in doc
    assert "screening: options marked TERMINATES end the survey" in doc
    assert "Intro" in doc
    # lean on purpose: no welcome / thank-you copy in the outline
    assert "Diez minutos" not in doc and "That is everything" not in doc
    # globalised outline renders the translated respondent text
    doc_es = zipfile.ZipFile(io.BytesIO(build_outline(cfg, "es"))).read("word/document.xml").decode("utf-8")
    assert "Elige uno" in doc_es and "\u2013 es" in doc_es


# ---------------------------------------------------------------- studio endpoints
def _save(client, cfg, slug="global-test", title="Global study"):
    r = client.post("/api/studio/save", json={"slug": slug, "title": title, "cfg": cfg})
    assert r.status_code == 200, r.get_json()
    return r.get_json()["slug"]


def test_language_catalogue(client):
    d = client.get("/api/studio/languages").get_json()
    codes = [x["code"] for x in d["languages"]]
    assert d["default"] == "en-US"
    for c in ("en-US", "es", "fr", "de", "ar", "hi", "zh-CN", "ja", "pt-BR"):
        assert c in codes
    ar = next(x for x in d["languages"] if x["code"] == "ar")
    assert ar["native"] == "العربية" and ar["dir"] == "rtl"


def test_strings_endpoint_lists_respondent_text_only(client):
    _save(client, GLOBAL_CFG)
    d = client.get("/api/studio/strings", query_string={"study": "global-test"}).get_json()
    keys = {x["key"] for x in d["strings"]}
    assert "q:Q1:stem" in keys and "study:welcome_text" in keys
    assert all("notes" not in k for k in keys)
    assert d["default_language"] == "en-US" and d["languages"] == []


def test_manual_translation_round_trip_and_spec_merge(client):
    _save(client, GLOBAL_CFG)
    r = client.post("/api/studio/translate", json={
        "slug": "global-test", "lang": "es",
        "strings": {"q:Q1:stem": "Elige uno", "q:Q1:opt:1": "Opción A",
                    "study:welcome_text": "Diez minutos.", "qc:min_seconds": "hack"}})
    d = r.get_json()
    assert d["ok"] and d["coverage"]["translated"] == 3          # unknown key ignored
    # spec in the default language is unchanged
    base = client.get("/api/spec/global-test").get_json()
    assert base["questions"][1]["stem"] == "Pick one"
    assert base["default_language"] == "en-US"
    assert [x["code"] for x in base["languages"]] == ["en-US", "es"]
    assert base["embedded"] == ["panel"]
    # spec in es is merged, with fallbacks
    es = client.get("/api/spec/global-test", query_string={"lang": "es"}).get_json()
    assert es["questions"][1]["stem"] == "Elige uno"
    assert es["questions"][1]["options"][0]["label"] == "Opción A"
    assert es["questions"][1]["options"][1]["label"] == "Option B"
    assert es["welcome_text"] == "Diez minutos."
    assert es["render_language"] == "es"
    # team-facing settings are identical in both languages
    assert es["ai_check"] == base["ai_check"]


def test_translate_rejects_the_default_language(client):
    _save(client, GLOBAL_CFG)
    r = client.post("/api/studio/translate", json={"slug": "global-test", "lang": "en-US",
                                                   "strings": {"q:Q1:stem": "nope"}})
    assert r.status_code == 400


def test_autotranslate_uses_machine_translation_and_reports_failures(client, monkeypatch):
    import routes.studio as studio_routes

    def fake_translate(text, target, source="en", fetcher=None, html=False):
        if "Option B" in text:
            raise TranslationError("network down for this one")
        return f"<{target}>{text}>"

    monkeypatch.setattr(studio_routes, "translate_string", fake_translate)
    _save(client, GLOBAL_CFG)
    d = client.post("/api/studio/autotranslate",
                    json={"slug": "global-test", "lang": "fr"}).get_json()
    total = len(extract_strings(GLOBAL_CFG))
    assert d["ok"] and d["translated"] == total - 1
    assert list(d["failed"]) == ["q:Q1:opt:2"]
    assert d["coverage"]["translated"] == total - 1
    # the machine text was stored and renders
    fr = client.get("/api/spec/global-test", query_string={"lang": "fr"}).get_json()
    assert fr["questions"][1]["stem"] == "<fr>Pick one>"
    assert fr["questions"][1]["options"][1]["label"] == "Option B"   # failed -> fallback
    # manual text is never overwritten by the machine; missing strings still fill in
    client.post("/api/studio/translate", json={"slug": "global-test", "lang": "es",
                                               "strings": {"q:Q1:stem": "Elige uno"}})
    d2 = client.post("/api/studio/autotranslate",
                     json={"slug": "global-test", "lang": "es",
                           "keys": ["q:Q1:stem", "q:Q2:help"]}).get_json()
    assert d2["translated"] == 1          # stem keeps manual text, help gets machine text
    es2 = client.get("/api/spec/global-test", query_string={"lang": "es"}).get_json()
    assert es2["questions"][1]["stem"] == "Elige uno"                # manual work kept
    assert es2["questions"][2]["help"] == "<es>A sentence is fine>"


def test_move_survey(client):
    _save(client, GLOBAL_CFG)
    r = client.post("/api/studio/move", json={"slug": "global-test", "new_slug": "moved-study"})
    assert r.get_json()["slug"] == "moved-study"
    assert client.get("/api/spec/moved-study").status_code == 200
    assert client.get("/api/spec/global-test").status_code == 404
    r2 = client.post("/api/studio/move", json={"slug": "moved-study", "new_slug": "Bad Slug!"})
    assert r2.status_code == 400
    assert client.post("/api/studio/move",
                       json={"slug": "moved-study", "new_slug": "beacon"}).status_code == 400


def test_outline_download(client):
    _save(client, GLOBAL_CFG)
    r = client.get("/api/studio/outline.docx", query_string={"study": "global-test"})
    assert r.status_code == 200
    assert r.data[:2] == b"PK"
    assert "attachment" in r.headers["Content-Disposition"]


# ---------------------------------------------------------------- respondent flow
NEW_TYPES_CFG = {
    "title": "New types",
    "language": "en-US",
    "embedded": [{"name": "panel"}, {"name": "rid"}],
    "sections": [{"id": "S1", "title": "Main"}],
    "questions": [
        {"id": "D1", "section": "S1", "type": "date", "stem": "When?"},
        {"id": "M1", "section": "S1", "type": "numeric_matrix", "stem": "How many?",
         "min": 0, "max": 10, "rows": [{"code": "a", "label": "Row A"}]},
        {"id": "DL1", "section": "S1", "type": "delta", "stem": "Before / after"},
        {"id": "C1", "section": "S1", "type": "concept_test", "stem": "Rate the concept",
         "concept": "A new idea", "scale": {"min": 1, "max": 5},
         "rows": [{"code": "r1", "label": "Clear"}]},
        {"id": "L1", "section": "S1", "type": "loop", "stem": "Tell us about each",
         "items": [{"code": "i1", "label": "First"}]},
        {"id": "TB", "section": "S1", "type": "text_block", "required": False,
         "body": "Nearly done."},
    ],
    "qc": {"min_seconds": 1},
}


def test_new_question_types_flow_into_the_export(client):
    _save(client, NEW_TYPES_CFG, slug="new-types", title="New types")
    client.post("/api/studio/status", json={"slug": "new-types", "status": "live"})
    s = client.post("/api/start", json={"study": "new-types", "is_test": False,
                                        "language": "es",
                                        "embedded": {"panel": "A", "secret": "x"}}).get_json()
    sid = s["session_id"]
    client.post("/api/save", json={"session_id": sid, "elapsed_seconds": 40, "answers": {
        "D1": {"_": "2026-03-01"},
        "M1": {"a": "7"},
        "DL1": {"before": "3", "after": "9", "delta": 6},
        "C1": {"r1": 4},
        "L1": {"i1": "notes on the first item"},
    }})
    client.post("/api/submit", json={"session_id": sid, "elapsed_seconds": 60})
    r = client.get("/admin/export.csv", query_string={"study": "new-types"})
    row = next(csv.DictReader(io.StringIO(r.data.decode())))
    assert row["language"] == "es"
    assert row["ev_panel"] == "A" and "ev_secret" not in row    # only declared variables
    assert row["D1"] == "2026-03-01"
    assert row["M1_a"] == "7"
    assert row["DL1_before"] == "3" and row["DL1_after"] == "9"
    assert float(row["DL1_delta"]) == 6
    assert row["C1_r1"] == "4"
    assert row["L1_i1"] == "notes on the first item"
    assert "TB" not in row                                     # text block stores nothing


def test_child_surveys_follow_the_parent(client):
    _save(client, GLOBAL_CFG, slug="par", title="Parent")
    client.post("/api/studio/status", json={"slug": "par", "status": "live"})
    r = client.post("/api/studio/globalize", json={"slug": "par", "lang": "es"}).get_json()
    assert r["ok"] and r["slug"] == "par--es"
    ch = client.get("/api/studio/children", query_string={"study": "par"}).get_json()["children"]
    assert [c["slug"] for c in ch] == ["par--es"] and ch[0]["language"] == "es"
    # the parent itself stays intact
    assert client.get("/api/spec/par").get_json()["questions"][1]["stem"] == "Pick one"
    # translate into the child
    client.post("/api/studio/translate", json={"slug": "par--es", "lang": "es",
                                               "strings": {"q:Q1:stem": "Elige uno"}})
    sp = client.get("/api/spec/par--es").get_json()
    assert sp["questions"][1]["stem"] == "Elige uno" and sp["render_language"] == "es"
    codes = {l["code"]: l.get("child") for l in sp["languages"]}
    assert codes["es"] == "par--es" and codes["en-US"] == ""
    assert sp["default_text"]["q:Q2:stem"] == "Why?"        # original wording for the toggle
    # a parent edit flows into the child automatically
    cfg = client.get("/api/studio/study", query_string={"slug": "par"}).get_json()["cfg"]
    cfg["questions"][2]["stem"] = "Why, exactly?"
    client.post("/api/studio/save", json={"slug": "par", "title": "Parent", "cfg": cfg})
    sp2 = client.get("/api/spec/par--es").get_json()
    assert sp2["questions"][2]["stem"] == "Why, exactly?"
    assert sp2["default_text"]["q:Q1:stem"] == "Pick one"
    # the child is live exactly when the parent is
    client.post("/api/studio/status", json={"slug": "par", "status": "closed"})
    assert client.post("/api/start", json={"study": "par--es"}).status_code == 403
    client.post("/api/studio/status", json={"slug": "par", "status": "live"})
    st = client.post("/api/start", json={"study": "par--es", "language": "es"}).get_json()
    assert st["session_id"]
    # deleting the parent deletes its children
    client.post("/api/studio/delete", json={"slug": "par"})
    assert client.get("/api/spec/par--es").status_code == 404


def test_offline_english_variant_localization():
    from core.translator import machine_translate
    assert machine_translate("Organize the color and analyze the center.", "en-GB") == \
        "Organise the colour and analyse the centre."
    assert machine_translate("What size is it? Realize the prize.", "en-GB") == \
        "What size is it? Realise the prize."
    assert machine_translate("The labor was humorous and honorary.", "en-GB") == \
        "The labour was humorous and honorary."


def test_autotranslate_english_child_works_offline(client):
    _save(client, GLOBAL_CFG, slug="par2", title="Parent Two")
    r = client.post("/api/studio/globalize", json={"slug": "par2", "lang": "en-GB"}).get_json()
    assert r["ok"] and r["slug"] == "par2--en-gb"
    d = client.post("/api/studio/autotranslate",
                    json={"slug": "par2--en-gb", "lang": "en-GB"}).get_json()
    assert d["ok"] and d["translated"] > 0 and not d["failed"]
    sp = client.get("/api/spec/par2--en-gb").get_json()
    assert sp["render_language"] == "en-GB"


def test_spec_exposes_new_flow_objects(client):
    _save(client, NEW_TYPES_CFG, slug="new-types", title="New types")
    spec = client.get("/api/spec/new-types").get_json()
    assert spec["embedded"] == ["panel", "rid"]
    assert spec["randomize_pages"] is False
    types = {q["type"] for q in spec["questions"]}
    assert {"date", "numeric_matrix", "delta", "concept_test", "loop", "text_block"} <= types
