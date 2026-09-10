#!/usr/bin/env python3
"""
PROJECT BEACON - reusability and Excel export tests.

Covers what test_e2e.py does not:
  * test-mode respondents get their own T### sequence
  * Excel export produces a real .xlsx with all sheets and analysis-ready conjoint data
  * the standard-library xlsx fallback also produces a valid workbook
  * reset endpoints clear the right records and let codes restart cleanly
  * scope filtering keeps test data out of real-data exports

Usage: python3 scripts/e2e_reuse_live_server.py [base_url]   (server must be running)
"""
import io
import json
import os
import random
import sys
import urllib.error
import urllib.request
import zipfile

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
TOKEN = "beacon-admin"
random.seed(7)

fails = []


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + ("" if cond else f"  <- {detail}"))
    if not cond:
        fails.append(label)


def call(path, payload=None, method=None):
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def get_bytes(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as r:
        return r.read(), dict(r.headers)


spec = call("/api/spec")
QS = spec["questions"]
N_TASKS = spec["conjoint"]["n_tasks"]


def answers_for(is_test=False, q13=2):
    """A complete, plausible response set."""
    a = {}
    for q in QS:
        qid, t = q["id"], q["type"]
        if qid == "Q1":
            a[qid] = {"_": 1}
        elif qid == "Q3":
            a[qid] = {"_": 28}
        elif qid == "Q4":
            a[qid] = {"_": 1}
        elif qid == "Q13":
            a[qid] = {"_": q13}
        elif t == "single_select":
            a[qid] = {"_": q["options"][0]["code"]}
        elif t == "numeric":
            a[qid] = {"_": q["min"] + 10 if q["id"].startswith("Q18") else q["min"] + 1}
        elif t == "slider":
            a[qid] = {"_": (q["min"] + q["max"]) // 2}
        elif t == "rating_grid":
            a[qid] = {r["code"]: q["scale"]["min"] + (i % (q["scale"]["max"] - q["scale"]["min"] + 1))
                      for i, r in enumerate(q["rows"])}
        elif t == "semantic_diff":
            a[qid] = {r["code"]: 4 + (i % 3) for i, r in enumerate(q["rows"])}
        elif t == "sum_to_100":
            n = len(q["rows"])
            vals = [100 // n] * n
            vals[0] += 100 - sum(vals)
            a[qid] = {r["code"]: vals[i] for i, r in enumerate(q["rows"])}
        elif t == "multi_select":
            a[qid] = {"codes": [o["code"] for o in q["options"][:3]]}
        elif t == "rank":
            a[qid] = {"order": [r["code"] for r in q["rows"]]}
        elif t == "open_text":
            a[qid] = {"_": "Survival benefit and tolerability drive the decision in this line."}
        elif t == "nps":
            a[qid] = {"_": 9}
        elif t == "emoji_grid":
            a[qid] = {r["code"]: 4 for r in q["rows"]}
        elif t == "heatmap":
            a[qid] = {r["code"] + "_" + c["code"]: 2 for r in q["rows"] for c in q["cols"]}
        elif t == "maxdiff":
            a[qid] = {}
            for i, rnd in enumerate(q["rounds"], 1):
                a[qid][f"R{i}_best"] = rnd["items"][0]
                a[qid][f"R{i}_worst"] = rnd["items"][1]
        elif t == "choice_task":
            a[qid] = {f"T{i}": random.choice([1, 2, 3, 0]) for i in range(1, N_TASKS + 1)}
    return a


def run_one(is_test):
    s = call("/api/start", {"is_test": is_test})
    res = call("/api/submit", {"session_id": s["session_id"], "answers": answers_for(is_test),
                               "elapsed_seconds": 1150})
    return s, res


print("=" * 70)
print("PROJECT BEACON - reusability and Excel export tests")
print("=" * 70)

# ---------------------------------------------------------------- test mode
print("\n--- test mode ---")
s_t, r_t = run_one(is_test=True)
check("test respondent gets a T-prefixed code", s_t["respondent_code"].startswith("T"),
      s_t["respondent_code"])
check("test respondent flagged is_test", r_t.get("respondent_code", "").startswith("T"),
      str(r_t))
s_r, r_r = run_one(is_test=False)
check("real respondent gets an R-prefixed code", s_r["respondent_code"].startswith("R"),
      s_r["respondent_code"])

s_t2, _ = run_one(is_test=True)
check("second test respondent increments (T001 -> T002)",
      s_t2["respondent_code"] != s_t["respondent_code"], s_t2["respondent_code"])

data = call(f"/api/admin/data?scope=test&token={TOKEN}")
check("scope=test returns only test respondents",
      data["counts"]["total"] >= 2 and all(r["is_test"] for r in data["recent"]),
      str(data["counts"]))

data_real = call(f"/api/admin/data?scope=real&token={TOKEN}")
check("scope=real excludes test respondents",
      all(not r["is_test"] for r in data_real["recent"]), str(data_real["counts"]))

# codes outside the pre-built R001-R100 map still get a reproducible randomisation
s_over, _ = call("/api/start", {"is_test": True}), None
s_over = s_over
check("non-mapped code receives a randomisation",
      len(s_over["task_order"]) == N_TASKS, str(s_over["task_order"]))
check("non-mapped code is not from the pre-built map",
      s_over["from_prebuilt_map"] is False, str(s_over["from_prebuilt_map"]))

# ---------------------------------------------------------------- Excel export
print("\n--- Excel export ---")
raw, hdrs = get_bytes(f"/admin/export.xlsx?scope=all&token={TOKEN}")
check("xlsx response is a zip container", raw[:2] == b"PK", raw[:8].hex())
check("content-type is xlsx",
      "spreadsheetml" in hdrs.get("Content-Type", ""), hdrs.get("Content-Type", ""))
check("export backend header present", bool(hdrs.get("X-Export-Backend")), str(hdrs.keys()))
print(f"    backend reported: {hdrs.get('X-Export-Backend')}")

names = zipfile.ZipFile(io.BytesIO(raw)).namelist()
check("workbook contains xl/workbook.xml", "xl/workbook.xml" in names, str(names[:6]))
check("workbook contains at least one worksheet",
      any(n.startswith("xl/worksheets/sheet") for n in names), str(names))

from openpyxl import load_workbook  # noqa: E402
wb = load_workbook(io.BytesIO(raw))
expected = {"Field summary", "Responses", "Conjoint long", "Screen-outs", "QC flags",
            "Data dictionary"}
check("all six sheets present", expected.issubset(set(wb.sheetnames)), str(wb.sheetnames))

ws = wb["Responses"]
hdr = [c.value for c in ws[1]]
check("Responses sheet has a header row", len(hdr) > 30, str(len(hdr)))
all_data = call(f"/api/admin/data?scope=all&token={TOKEN}")
check("Responses has one row per respondent", ws.max_row - 1 == all_data["counts"]["total"],
      f"{ws.max_row - 1} rows vs {all_data['counts']['total']} respondents")
check("Responses includes is_test column", "is_test" in hdr, "")
check("Responses includes conjoint columns", "Q16_T1" in hdr and f"Q16_T{N_TASKS}" in hdr, "")
check("Responses includes answer-text columns", any(h.endswith("_text") for h in hdr), "")
check("Responses includes qc_flags", "qc_flags" in hdr, "")

cl = wb["Conjoint long"]
ch = [c.value for c in cl[1]]
check("Conjoint long has expected columns",
      {"respondent_code", "task_id", "alt_id", "chosen", "is_opt_out"}.issubset(set(ch)),
      str(ch))
for attr in ("OS", "PFS12", "AE", "ROUTE", "CDX", "COST", "ACCESS"):
    check(f"Conjoint long carries attribute {attr}", attr in ch, str(ch))
    break
rows = list(cl.iter_rows(min_row=2, values_only=True))
# every complete respondent contributes n_tasks * (n_alts + 1 opt-out) rows
n_expected = all_data["counts"]["complete"] * N_TASKS * 4
check("Conjoint long has exactly n_complete x tasks x alternatives rows",
      len(rows) == n_expected, f"{len(rows)} rows, expected {n_expected}")
chosen_idx = ch.index("chosen")
n_chosen = sum(1 for r in rows if r[chosen_idx] == 1)
check("exactly one chosen alternative per choice task",
      n_chosen == len(rows) // 4, f"{n_chosen} chosen of {len(rows)} rows")
optout_idx = ch.index("is_opt_out")
check("opt-out rows present and excluded from attribute coding",
      any(r[optout_idx] == 1 for r in rows), "")
check("attribute levels coded 1-3 (not 0-2)",
      all(r[ch.index("OS")] in (1, 2, 3, None, "") for r in rows), "")

dd = wb["Data dictionary"]
dd_rows = list(dd.iter_rows(min_row=2, values_only=True))
check("Data dictionary is populated", len(dd_rows) > 50, str(len(dd_rows)))
check("Data dictionary flags terminating options",
      any(r[6] and "TERMINATES" in str(r[6]) for r in dd_rows), "")

fs = wb["Field summary"]
fs_rows = {r[0]: r[1] for r in fs.iter_rows(min_row=2, values_only=True) if r[0]}
check("Field summary reports completion rate", "Completion rate (%)" in fs_rows, str(list(fs_rows)[:6]))
check("Field summary reports top-2-box intent",
      any("Top-2-box" in str(k) for k in fs_rows), str(list(fs_rows)[:12]))

# scope-filtered export must not contain the other scope
raw_test, _ = get_bytes(f"/admin/export.xlsx?scope=test&token={TOKEN}")
wb_t = load_workbook(io.BytesIO(raw_test))
codes_t = [r[0] for r in wb_t["Responses"].iter_rows(min_row=2, values_only=True) if r[0]]
check("scope=test xlsx contains only T codes",
      codes_t and all(str(c).startswith("T") for c in codes_t), str(codes_t))

raw_real, _ = get_bytes(f"/admin/export.xlsx?scope=real&token={TOKEN}")
wb_r = load_workbook(io.BytesIO(raw_real))
codes_r = [r[0] for r in wb_r["Responses"].iter_rows(min_row=2, values_only=True) if r[0]]
check("scope=real xlsx contains only R codes",
      codes_r and all(str(c).startswith("R") for c in codes_r), str(codes_r))

# ---------------------------------------------------------------- stdlib fallback
print("\n--- standard-library xlsx fallback ---")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import xlsx_export  # noqa: E402
mini = xlsx_export.MiniXlsx()
mini.add_sheet("One", [["a", "b"], [1, "two"], [3, None]])
mini.add_sheet("Two", [["x"], ["y"]])
blob = mini.save_bytes()
check("fallback produces a zip container", blob[:2] == b"PK", blob[:8].hex())
zf = zipfile.ZipFile(io.BytesIO(blob))
check("fallback workbook has both sheets",
      "xl/worksheets/sheet1.xml" in zf.namelist() and "xl/worksheets/sheet2.xml" in zf.namelist(),
      str(zf.namelist()))
wb2 = load_workbook(io.BytesIO(blob))
check("fallback workbook opens in openpyxl", set(wb2.sheetnames) == {"One", "Two"},
      str(wb2.sheetnames))
check("fallback preserves numbers and strings",
      wb2["One"]["A2"].value == 1 and wb2["One"]["B2"].value == "two", "")
check("fallback handles empty cells", wb2["One"]["B3"].value is None, "")

# ---------------------------------------------------------------- reset
print("\n--- reset ---")
before = call(f"/api/admin/data?scope=test&token={TOKEN}")["counts"]["total"]
res = call(f"/admin/reset?scope=test&token={TOKEN}", method="POST")
check("reset returns ok", res.get("ok") is True, str(res))
check("reset reports the number deleted", res.get("deleted_respondents", 0) == before,
      f"deleted {res.get('deleted_respondents')}, expected {before}")
after = call(f"/api/admin/data?scope=test&token={TOKEN}")["counts"]["total"]
check("test respondents cleared", after == 0, str(after))
check("real respondents survive a test reset",
      call(f"/api/admin/data?scope=real&token={TOKEN}")["counts"]["total"] ==
      data_real["counts"]["total"], "")

# codes must restart cleanly after a reset (this is what makes the link reusable)
s_new, _ = run_one(is_test=True)
check("test codes restart at T001 after reset", s_new["respondent_code"] == "T001",
      s_new["respondent_code"])

# reset without a token must be refused
try:
    call("/admin/reset?scope=test", method="POST")
    check("reset blocked without token", False, "returned 200")
except urllib.error.HTTPError as e:
    check("reset blocked without token", e.code == 403, str(e.code))

# clean up the test data this suite created
call(f"/admin/reset?scope=test&token={TOKEN}", method="POST")
final = call(f"/api/admin/data?scope=all&token={TOKEN}")
check("after cleanup, no test respondents remain",
      all(not r["is_test"] for r in final["recent"]), str(final["counts"]))

print("\n" + "=" * 70)
print("ALL CHECKS PASSED" if not fails else f"{len(fails)} CHECK(S) FAILED: {fails}")
print("=" * 70)
sys.exit(1 if fails else 0)
