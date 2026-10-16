"""
Grid questions (rows x columns) end to end: a grid stores one column code per row
(or several when it is multi-select), the export carries both the code and its label,
the data dictionary names every column, the analysis reports column shares, and the
screening rules on a grid read row-by-row.

    python3 -m pytest tests/test_choice_grid.py
"""

from core.reporting import analysis_for, build_sheets, flatten
from core.screening import describe


GRID_CFG = {
    "title": "Grid study",
    "sections": [{"id": "S1", "title": "Grids"}],
    "questions": [
        {"id": "G1", "section": "S1", "type": "rating_grid", "stem": "Pick one per row",
         "select": "single",
         "rows": [{"code": "a", "label": "Ease of use"}, {"code": "b", "label": "Trust"}],
         "cols": [{"code": "c1", "label": "Poor"}, {"code": "c2", "label": "Okay"},
                  {"code": "c3", "label": "Great"}]},
        {"id": "G2", "section": "S1", "type": "rating_grid", "stem": "Tick all that apply",
         "select": "multi",
         "rows": [{"code": "x", "label": "Sources"}],
         "cols": [{"code": "s1", "label": "Journals"}, {"code": "s2", "label": "Peers"},
                  {"code": "s3", "label": "Conferences"}]},
    ],
}

ANSWERS = {
    "G1": {"a": "c2", "b": "NA"},
    "G2": {"x": ["s1", "s3"]},
}

RESPONDENT = {
    "respondent_code": "T001", "is_test": 1, "status": "complete",
    "screen_out_at": None, "screen_out_reason": None, "started_at": "2026-01-01 10:00:00",
    "completed_at": "2026-01-01 10:06:00", "elapsed_seconds": 360, "embedded": "{}",
    "language": "en-US",
}


def test_a_single_select_grid_exports_one_column_code_per_row():
    flat = flatten(RESPONDENT, ANSWERS, GRID_CFG)
    assert flat["G1_a"] == "c2"
    assert flat["G1_a_text"] == "Okay"
    assert flat["G1_b"] == "NA"                      # the exclusive N/A is exported as-is
    assert flat["G1_b_text"] == "NA"


def test_a_multi_select_grid_exports_every_tick():
    flat = flatten(RESPONDENT, ANSWERS, GRID_CFG)
    assert flat["G2_x"] == "s1;s3"
    assert flat["G2_x_text"] == "Journals; Conferences"


def test_the_data_dictionary_names_the_columns_and_the_mode():
    flat = flatten(RESPONDENT, ANSWERS, GRID_CFG)
    sheets = build_sheets([{**RESPONDENT, "answers": ANSWERS, "is_test_label": "test",
                            "flat": flat}], "all", GRID_CFG)
    dd = next(rows for name, _h, rows, _w in sheets if name == "Data dictionary")
    g1 = [r for r in dd if r[0] == "G1" and r[4] in ("a", "b")]
    g2 = [r for r in dd if r[0] == "G2" and r[4] == "x"]
    assert len(g1) == 2 and len(g2) == 1
    assert g1[0][6].startswith("single-select from: ")
    assert "c2 Okay" in g1[0][6]
    assert g2[0][6].startswith("multi-select from: ")
    assert "s3 Conferences" in g2[0][6]


def test_the_analysis_reports_column_shares_per_row():
    records = [{**RESPONDENT, "answers": ANSWERS}]
    out = analysis_for(records, GRID_CFG)
    assert out["ratings"] == []                      # a choice grid is not a mean-rating block
    blocks = out["choice_grids"]
    assert [b["id"] for b in blocks] == ["G1", "G2"]
    g1 = blocks[0]
    row_a = {c["label"]: c["share"] for c in g1["rows"][0]["cells"]}
    assert row_a == {"Poor": 0.0, "Okay": 100.0, "Great": 0.0}


def test_an_older_scale_grid_still_feeds_the_rating_means():
    cfg = {"sections": [{"id": "S1", "title": "G"}], "questions": [
        {"id": "L1", "section": "S1", "type": "rating_grid", "stem": "Rate",
         "rows": [{"code": "a", "label": "One"}],
         "scale": {"min": 1, "max": 5}}]}
    out = analysis_for([{**RESPONDENT, "answers": {"L1": {"a": 4}}}], cfg)
    assert len(out["ratings"]) == 1 and out["ratings"][0]["rows"][0]["mean"] == 4.0
    assert "choice_grids" not in out


def test_a_grid_screening_rule_reads_row_by_row():
    q = dict(GRID_CFG["questions"][0])
    q["screening"] = {"mode": "screen_out", "match": "all", "when": "next",
                      "rules": [{"q": "G1", "op": "cell_is", "value": "a=c1"}]}
    lines = describe(q, GRID_CFG["questions"])
    assert len(lines) == 1
    assert lines[0] == "screen out when G1 is Ease of use Poor"
