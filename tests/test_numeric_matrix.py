"""
Numeric matrix questions with columns: one number per row x column.  The export
carries a field per cell, the data dictionary names every cell, and screening
rules can compare a single cell (row x column) against a number or a band.

    python3 - pytest tests/test_numeric_matrix.py
"""

from core.reporting import build_sheets, flatten
from core.screening import describe

NM = {
    "id": "N1", "section": "S1", "type": "numeric_matrix", "stem": "Patients a year",
    "rows": [{"code": "tr", "label": "Treated"}, {"code": "el", "label": "Eligible"}],
    "cols": [{"code": "now", "label": "This year"}, {"code": "next", "label": "Next year"}],
}

CFG = {
    "title": "Matrix study",
    "sections": [{"id": "S1", "title": "Numbers"}],
    "questions": [NM],
}

RESPONDENT = {
    "respondent_code": "T001", "is_test": 1, "status": "complete",
    "screen_out_at": None, "screen_out_reason": None, "started_at": "2026-01-01 10:00:00",
    "completed_at": "2026-01-01 10:06:00", "elapsed_seconds": 360, "embedded": "{}",
    "language": "en-US",
}


def test_flatten_writes_one_field_per_cell():
    rec = dict(RESPONDENT, answers={"N1": {"tr_now": 40, "tr_next": 55, "el_now": 12, "el_next": 14}})
    flat = flatten(RESPONDENT, rec["answers"], CFG)
    assert flat["N1_tr_now"] == 40 and flat["N1_tr_next"] == 55
    assert flat["N1_el_next"] == 14


def test_a_rows_only_matrix_keeps_one_field_per_row():
    cfg = {"title": "t", "sections": CFG["sections"],
           "questions": [{k: v for k, v in NM.items() if k != "cols"}]}
    rec = dict(RESPONDENT, answers={"N1": {"tr": 40, "el": 12}})
    flat = flatten(RESPONDENT, rec["answers"], cfg)
    assert flat["N1_tr"] == 40 and flat["N1_el"] == 12


def test_the_data_dictionary_names_every_cell():
    flat = flatten(RESPONDENT, {}, CFG)
    sheets = build_sheets([{**RESPONDENT, "answers": {}, "is_test_label": "test",
                            "flat": flat}], "all", CFG)
    dd = next(rows for name, _h, rows, _w in sheets if name == "Data dictionary")
    dd = [r for r in dd if r[0] == "N1"]
    codes = [r[4] for r in dd]
    assert codes == ["tr_now", "tr_next", "el_now", "el_next"], codes
    assert any("Treated × This year" in r[5] for r in dd)


def test_cell_screening_reads_as_plain_english():
    q = dict(NM, screening={"mode": "screen_out", "match": "all", "when": "live",
                            "rules": [{"q": "N1", "op": "cell_gte", "value": "tr=now=40"}]})
    line = describe(q, [q])[0]
    assert "Treated" in line and "This year" in line and "40" in line, line
    assert "at least" in line


def test_cell_between_reads_its_band():
    q = dict(NM, screening={"mode": "screen_out", "match": "all", "when": "live",
                            "rules": [{"q": "N1", "op": "cell_between", "value": "el=next=10-20"}]})
    line = describe(q, [q])[0]
    assert "between 10 and 20" in line, line
