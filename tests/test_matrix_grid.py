"""
Matrix / grid questions end to end: the export carries the new answer shapes (a cell
per row x column, the comment boxes, N/A and the order each respondent saw), and the
respondent-visible wording of a grid can be translated like any other text.

    python3 -m pytest tests/test_matrix_grid.py
"""

from core.i18n import apply_language, extract_strings
from core.reporting import flatten


GRID_CFG = {
    "title": "Grid study",
    "sections": [{"id": "S1", "title": "Grids"}],
    "questions": [
        {"id": "G1", "section": "S1", "type": "rating_grid", "stem": "Rate each",
         "grid": {"title": "How much does each matter?", "row_label": "Attribute",
                  "col_label": "Importance"},
         "na": {"rows": True, "col": True, "label": "Not applicable"},
         "comments": {"mode": "allow", "label": "Anything else?"},
         "randomize": {"rows": "shuffle", "cols": "rotate"},
         "rows": [{"code": "a", "label": "Efficacy", "comment": "require"},
                  {"code": "b", "label": "Safety"}],
         "scale": {"min": 1, "max": 3,
                   "points": [{"v": 1, "label": "Low"}, {"v": 3, "label": "High"}]}},
        {"id": "G2", "section": "S1", "type": "numeric_matrix", "stem": "Patients a year",
         "rows": [{"code": "p1", "label": "Treated"}, {"code": "p2", "label": "Eligible"}],
         "cols": [{"code": "this", "label": "This year"}, {"code": "next", "label": "Next year"}]},
    ],
}

ANSWERS = {
    "G1": {"a": 2, "b": "NA", "_comment": "Efficacy drives it", "c_a": "Because it works",
           "_order": "b,a", "_order_cols": "3,1,2"},
    "G2": {"p1_this": 40, "p1_next": 55, "p2_this": 90, "p2_next": 120},
}

RESPONDENT = {
    "respondent_code": "T001", "is_test": 1, "status": "complete",
    "screen_out_at": None, "screen_out_reason": None, "started_at": "2026-01-01 10:00:00",
    "completed_at": "2026-01-01 10:06:00", "elapsed_seconds": 360, "embedded": "{}",
    "language": "en-US",
}


def test_a_grid_exports_one_column_per_row():
    flat = flatten(RESPONDENT, ANSWERS, GRID_CFG)
    assert flat["G1_a"] == 2
    assert flat["G1_b"] == "NA"                     # the exclusive N/A is exported as-is
    assert flat["G1_comment"] == "Efficacy drives it"
    assert flat["G1_a_comment"] == "Because it works"     # the row that asked for a comment
    assert "G1_b_comment" not in flat                     # and only that row
    assert flat["G1_order_shown"] == "b,a"
    assert flat["G1_order_cols_shown"] == "3,1,2"


def test_a_numeric_matrix_exports_one_column_per_cell():
    flat = flatten(RESPONDENT, ANSWERS, GRID_CFG)
    assert flat["G2_p1_this"] == 40 and flat["G2_p1_next"] == 55
    assert flat["G2_p2_this"] == 90 and flat["G2_p2_next"] == 120
    assert "G2_p1" not in flat                      # no plain row column once it has columns


def test_a_numeric_matrix_without_columns_keeps_the_old_shape():
    cfg = {"sections": [{"id": "S1", "title": "G"}], "questions": [
        {"id": "G3", "section": "S1", "type": "numeric_matrix", "stem": "How many",
         "rows": [{"code": "p1", "label": "Treated"}]}]}
    flat = flatten(RESPONDENT, {"G3": {"p1": 7}}, cfg)
    assert flat["G3_p1"] == 7


def test_grid_wording_is_extracted_for_translation():
    keys = {s["key"]: s["text"] for s in extract_strings(GRID_CFG)}
    assert keys["q:G1:grid_title"] == "How much does each matter?"
    assert keys["q:G1:row_label"] == "Attribute"
    assert keys["q:G1:col_label"] == "Importance"
    assert keys["q:G1:na_label"] == "Not applicable"
    assert keys["q:G1:comment_label"] == "Anything else?"
    assert keys["q:G1:pt:1"] == "Low" and keys["q:G1:pt:3"] == "High"
    assert keys["q:G2:col:this"] == "This year"          # axis columns, as before


def test_grid_wording_translates_and_writes_back():
    cfg = {
        "title": "Grid study", "language": "en-US",
        "translations": {"fr": {
            "q:G1:grid_title": "Combien cela compte-t-il ?",
            "q:G1:row_label": "Attribut",
            "q:G1:col_label": "Importance",
            "q:G1:na_label": "Sans objet",
            "q:G1:comment_label": "Autre chose ?",
            "q:G1:pt:1": "Faible",
            "q:G1:row:a": "Efficacité",
        }},
        "questions": [GRID_CFG["questions"][0]],
        "sections": [{"id": "S1", "title": "Grids"}],
    }
    out = apply_language(cfg, "fr")
    q = out["questions"][0]
    assert q["grid"]["title"] == "Combien cela compte-t-il ?"
    assert q["grid"]["row_label"] == "Attribut"
    assert q["grid"]["col_label"] == "Importance"
    assert q["na"]["label"] == "Sans objet"
    assert q["comments"]["label"] == "Autre chose ?"
    assert q["scale"]["points"][0]["label"] == "Faible"
    assert q["rows"][0]["label"] == "Efficacité"


def test_a_grid_without_the_new_fields_is_untouched():
    cfg = {"sections": [{"id": "S1", "title": "G"}], "questions": [
        {"id": "G4", "section": "S1", "type": "rating_grid", "stem": "Rate",
         "rows": [{"code": "a", "label": "One"}], "scale": {"min": 1, "max": 5}}]}
    flat = flatten(RESPONDENT, {"G4": {"a": 4}}, cfg)
    assert flat["G4_a"] == 4 and "G4_comment" not in flat
    assert [s["key"] for s in extract_strings(cfg) if "grid" in s["key"]] == []
