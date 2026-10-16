"""
Screening (screen in / screen out) - the server-side half.

The rules themselves are executed in the browser (BeaconQ.screeningVerdict in
static/js/qlogic.js, covered by scripts/dom/screening_engine_test.js).  These tests
cover what Python owns: the config is cleaned on save, the legacy shorthand still
reads, and the rules are written into the Word outline and the Excel data dictionary
in plain English.
"""

import io
import zipfile

from core import screening
from core.outline import build_outline
from core.reporting import build_sheets

SINGLE = {
    "id": "Q1", "section": "S1", "type": "single_select", "stem": "Specialty",
    "options": [{"code": 1, "label": "Medical oncology"},
                {"code": 2, "label": "Radiation oncology", "terminate": True}],
}
NUMERIC = {
    "id": "Q3", "section": "S1", "type": "numeric", "stem": "Patients per month",
    "screening": {"enabled": True, "mode": "screen_out", "match": "all", "when": "next",
                  "reason": "Haematology-only, low volume",
                  "rules": [{"q": "Q1", "op": "selected", "value": 4},
                            {"q": "Q3", "op": "lt", "value": 10}]},
}
CFG = {"title": "Screening study",
       "sections": [{"id": "S1", "title": "Screeners"}],
       "questions": [SINGLE, NUMERIC]}


# ---------------------------------------------------------------- normalise on save
def test_empty_or_broken_blocks_are_dropped():
    q = {"id": "Q1", "screening": {"mode": "screen_out", "rules": []}}
    screening.normalize(q)
    assert "screening" not in q

    q = {"id": "Q1", "screening": {"rules": [{"op": "selected"}, {"nonsense": 1}]}}
    screening.normalize(q)
    assert "screening" not in q                      # a rule without a question is unusable

    q = {"id": "Q1", "screening": "screen out everyone"}
    screening.normalize(q)
    assert "screening" not in q


def test_a_saved_block_is_cleaned_to_exactly_the_stored_shape():
    q = {"id": "Q1", "screening": {"mode": "nonsense", "match": "any", "when": "whenever",
                                   "junk": True, "message": "  Sorry  ",
                                   "rules": [{"q": "Q1", "op": "any_of", "value": "2,3"},
                                             "not a rule"]}}
    screening.normalize(q)
    s = q["screening"]
    assert s["mode"] == "screen_out"                 # unknown values fall back, never break
    assert s["match"] == "any" and s["when"] == "live"
    assert s["message"] == "Sorry" and "junk" not in s
    assert s["rules"] == [{"q": "Q1", "op": "any_of", "value": "2,3"}]


# ---------------------------------------------------------------- legacy shorthand
def test_options_marked_terminate_are_still_read():
    blocks = screening.blocks(dict(SINGLE))
    assert len(blocks) == 1 and blocks[0]["mode"] == "screen_out"
    assert blocks[0]["rules"] == [{"q": "Q1", "op": "selected", "value": 2}]


def test_terminate_if_lt_is_still_read():
    q = {"id": "Q3", "type": "numeric", "terminate_if_lt": 5, "terminate_message": "Thanks"}
    blocks = screening.blocks(q)
    assert blocks[0]["rules"] == [{"q": "Q3", "op": "lt", "value": 5}]
    assert blocks[0]["when"] == "next"               # never fires while the box is half typed


def test_authored_rules_and_legacy_options_both_count():
    q = dict(SINGLE)
    q["screening"] = {"mode": "qualify", "match": "all",
                      "rules": [{"q": "Q1", "op": "none_of", "value": "1"}]}
    blocks = screening.blocks(q)
    assert [b["mode"] for b in blocks] == ["qualify", "screen_out"]


# ---------------------------------------------------------------- plain English
def test_describe_reads_as_a_sentence():
    assert screening.describe(NUMERIC, [SINGLE, NUMERIC]) == [
        "screen out when Q1 is 4 and Q3 < 10"]
    assert screening.describe(SINGLE, [SINGLE, NUMERIC]) == [
        "screen out when Q1 is Radiation oncology"]


def test_describe_uses_option_labels_not_codes():
    q = {**SINGLE, "options": [dict(o) for o in SINGLE["options"]]}
    q["options"][1].pop("terminate")             # a copy without the legacy switch
    q["screening"] = {"mode": "screen_out", "match": "any",
                      "rules": [{"q": "Q1", "op": "any_of", "value": "1,2"}]}
    assert screening.describe(q, [SINGLE]) == [
        "screen out when Q1 is any of Medical oncology, Radiation oncology"]


# ---------------------------------------------------------------- numbers and allocations
ALLOC = {
    "id": "Q19", "section": "S1", "type": "sum_to_100", "stem": "Split 100 points",
    "rows": [{"code": "d1", "label": "Brand A"}, {"code": "d2", "label": "Brand B"},
             {"code": "d3", "label": "Brand C"}],
}


def _blocked(q, rules, mode="screen_out"):
    q = {**q, "screening": {"mode": mode, "match": "all", "when": "next", "rules": rules}}
    return screening.describe(q, [ALLOC, NUMERIC])


def test_numeric_rules_read_with_their_operator():
    assert _blocked(NUMERIC, [{"q": "Q3", "op": "lt", "value": 5}]) == [
        "screen out when Q3 < 5"]
    assert _blocked(NUMERIC, [{"q": "Q3", "op": "gte", "value": 40}]) == [
        "screen out when Q3 \u2265 40"]
    assert _blocked(NUMERIC, [{"q": "Q3", "op": "ne", "value": 40}]) == [
        "screen out when Q3 \u2260 40"]


def test_ranges_read_as_ranges():
    assert _blocked(NUMERIC, [{"q": "Q3", "op": "between", "value": "5-20"}]) == [
        "screen out when Q3 is between 5 and 20"]
    assert _blocked(NUMERIC, [{"q": "Q3", "op": "not_between", "value": "5-20"}]) == [
        "screen out when Q3 is outside 5 \u2013 20"]


def test_allocation_rules_read_as_shares_and_totals():
    assert _blocked(ALLOC, [{"q": "Q19", "op": "row_gte", "value": "d1=60"}]) == [
        "screen out when Q19 row \u2265 Brand A 60"]
    assert _blocked(ALLOC, [{"q": "Q19", "op": "sum_of_gte", "value": "d1,d3=80"}]) == [
        "screen out when Q19: the sum of Brand A + Brand C \u2265 80"]
    assert _blocked(ALLOC, [{"q": "Q19", "op": "total_lte", "value": 90}]) == [
        "screen out when Q19 total \u2264 90"]
    assert _blocked(ALLOC, [{"q": "Q19", "op": "total_eq", "value": 100}]) == [
        "screen out when Q19 total = 100"]


def test_a_new_allocation_rule_survives_a_save_round_trip():
    q = {**ALLOC, "screening": {"mode": "screen_out", "match": "all", "when": "next",
                                "rules": [{"q": "Q19", "op": "sum_of_gte", "value": "d1,d2=80"}]}}
    screening.normalize(q)
    assert q["screening"]["rules"] == [{"q": "Q19", "op": "sum_of_gte", "value": "d1,d2=80"}]


# ---------------------------------------------------------------- the structured screener
def _blocked_structured(block):
    q = {**ALLOC, "rows": [dict(r) for r in ALLOC["rows"]], "screening": block}
    screening.normalize(q)
    return q, screening.describe(q, [q])


def test_an_individual_screener_reads_as_a_band_per_answer():
    _, lines = _blocked_structured({
        "mode": "screen_out", "type": "individual", "rows": ["d1", "d2"],
        "min": {"d1": 10, "d2": 20}, "max": {"d1": 60, "d2": 40}})
    assert lines == ["screen out when Q19: Brand A is outside 10 to 60 "
                     "or Q19: Brand B is outside 20 to 40"]


def test_a_sum_screener_reads_as_one_comparison():
    for op, value, tail in (("eq", 100, "= 100"), ("lt", 80, "< 80"),
                            ("gt", 20, "> 20"), ("between", "10-90", "is between 10 and 90")):
        _, lines = _blocked_structured({
            "mode": "screen_out", "type": "sum", "rows": ["d1", "d3"],
            "sum": {"op": op, "value": value}})
        assert lines == ["screen out when Q19: the sum of Brand A + Brand C " + tail]


def test_the_structured_screener_survives_a_save():
    q, _ = _blocked_structured({
        "mode": "screen_out", "type": "sum", "rows": ["d1", "d2"],
        "sum": {"op": "between", "value": "10-90"}, "junk": True})
    block = q["screening"]
    assert block["type"] == "sum" and block["rows"] == ["d1", "d2"]
    assert block["sum"] == {"op": "between", "value": "10-90"}
    assert "junk" not in block
    assert screening.blocks(q)[0]["rules"] == [{"q": "Q19", "op": "sum_between", "value": "d1,d2=10-90"}]


def test_switching_a_block_off_keeps_its_rules():
    q = {**ALLOC, "screening": {"enabled": False, "mode": "qualify",
                                "rules": [{"q": "Q19", "op": "row_gte", "value": "d1=60"}]}}
    screening.normalize(q)
    assert q["screening"]["enabled"] is False          # kept, not dropped
    assert screening.describe(q, [q]) == []            # ...but it says nothing and fires nowhere


# ---------------------------------------------------------------- it reaches the documents
def test_the_word_outline_shows_the_screening_rules():
    data = build_outline(CFG)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        doc = z.read("word/document.xml").decode("utf-8")
    assert "screen out when Q1 is Radiation oncology" in doc
    assert "screen out when Q1 is 4 and Q3 &lt; 10" in doc


def test_the_data_dictionary_shows_the_screening_rules():
    sheets = build_sheets([], "all", CFG)
    dd = next(rows for name, headers, rows, _ in sheets if name == "Data dictionary")
    lines = [r[5] for r in dd if r[4] == "(screening)"]
    assert lines == ["screen out when Q1 is Radiation oncology",
                     "screen out when Q1 is 4 and Q3 < 10"]


# ---------------------------------------------------------------- the on/off switch owns everything
def test_the_off_switch_mutes_the_option_terminate_marks():
    q = {"id": "Q1", "type": "single_select", "stem": "Specialty",
         "options": [{"code": 1, "label": "Eligible"}, {"code": 2, "label": "Not", "terminate": True}],
         "screening": {"enabled": False}}
    assert screening.blocks(q) == []          # nothing fires while the switch is off
    assert screening.describe(q, [q]) == []


def test_without_a_block_the_option_marks_still_fire():
    q = {"id": "Q1", "type": "single_select", "stem": "Specialty",
         "options": [{"code": 1, "label": "Eligible"}, {"code": 2, "label": "Not", "terminate": True}]}
    blocks = screening.blocks(q)
    assert len(blocks) == 1 and blocks[0]["source"] == "options"
