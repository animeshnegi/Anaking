"""
Rating Scale questions end to end: the type is separate from a Grid, stores one value
per row, exports one column per row, documents its three anchor labels (low-end, mid,
high-end) in the data dictionary, and all three labels are translatable.

    python3 -m pytest tests/test_rating_scale.py
"""

from core.i18n import apply_language, extract_strings
from core.reporting import analysis_for, build_sheets, flatten


SCALE_CFG = {
    "title": "Rating scale study",
    "sections": [{"id": "S1", "title": "Scales"}],
    "questions": [
        {"id": "R1", "section": "S1", "type": "rating_scale", "stem": "Rate each aspect",
         "rows": [{"code": "a", "label": "Ease of use"},
                  {"code": "b", "label": "Trust"}],
         "scale": {"min": 1, "max": 5, "min_label": "Not at all",
                   "mid_label": "Neutral", "max_label": "Extremely"}},
    ],
}

ANSWERS = {"R1": {"a": 2, "b": 5}}

RESPONDENT = {
    "respondent_code": "T001", "is_test": 1, "status": "complete",
    "screen_out_at": None, "screen_out_reason": None, "started_at": "2026-01-01 10:00:00",
    "completed_at": "2026-01-01 10:06:00", "elapsed_seconds": 360, "embedded": "{}",
    "language": "en-US",
}


def test_a_rating_scale_exports_one_column_per_row():
    flat = flatten(RESPONDENT, ANSWERS, SCALE_CFG)
    assert flat["R1_a"] == 2
    assert flat["R1_b"] == 5


def test_a_rating_scale_appears_in_the_data_dictionary_with_its_labels():
    sheets = build_sheets([{**RESPONDENT, "answers": ANSWERS,
                            "is_test_label": "test", "flat": flatten(RESPONDENT, ANSWERS,
                                                                      SCALE_CFG)}],
                          "all", SCALE_CFG)
    dd = next(rows for name, headers, rows, _w in sheets if name == "Data dictionary")
    rows = [r for r in dd if r[0] == "R1" and r[4] in ("a", "b")]
    assert len(rows) == 2
    assert rows[0][2] == "rating_scale"
    assert rows[0][6] == "1-5 (Not at all / Neutral / Extremely)"


def test_a_rating_scale_feeds_the_rating_analysis():
    records = [{**RESPONDENT, "answers": ANSWERS}]
    out = analysis_for(records, SCALE_CFG)
    assert len(out["ratings"]) == 1
    block = out["ratings"][0]
    assert block["id"] == "R1"
    assert {r["label"]: r["mean"] for r in block["rows"]} == {"Ease of use": 2.0,
                                                               "Trust": 5.0}


def test_the_three_anchor_labels_are_extracted_for_translation():
    keys = {s["key"]: s["text"] for s in extract_strings(SCALE_CFG)}
    assert keys["q:R1:min_label"] == "Not at all"
    assert keys["q:R1:mid_label"] == "Neutral"
    assert keys["q:R1:max_label"] == "Extremely"
    assert keys["q:R1:row:a"] == "Ease of use"


def test_the_three_anchor_labels_translate_and_write_back():
    cfg = {
        "title": "Rating scale study", "language": "en-US",
        "translations": {"fr": {
            "q:R1:min_label": "Pas du tout",
            "q:R1:mid_label": "Neutre",
            "q:R1:max_label": "Extrêmement",
            "q:R1:row:a": "Facilité d'utilisation",
        }},
        "questions": [SCALE_CFG["questions"][0]],
        "sections": [{"id": "S1", "title": "Scales"}],
    }
    out = apply_language(cfg, "fr")
    q = out["questions"][0]
    assert q["scale"]["min_label"] == "Pas du tout"
    assert q["scale"]["mid_label"] == "Neutre"
    assert q["scale"]["max_label"] == "Extrêmement"
    assert q["rows"][0]["label"] == "Facilité d'utilisation"


def test_a_grid_question_is_not_affected_by_the_mid_label():
    cfg = {"sections": [{"id": "S1", "title": "G"}], "questions": [
        {"id": "G1", "section": "S1", "type": "rating_grid", "stem": "Rate",
         "rows": [{"code": "a", "label": "One"}],
         "scale": {"min": 1, "max": 5, "min_label": "Low", "max_label": "High"}}]}
    keys = {s["key"] for s in extract_strings(cfg)}
    assert "q:G1:mid_label" not in keys          # no mid label authored -> nothing extracted
    flat = flatten(RESPONDENT, {"G1": {"a": 4}}, cfg)
    assert flat["G1_a"] == 4
