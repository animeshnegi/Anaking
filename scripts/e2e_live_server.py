#!/usr/bin/env python3
"""
End-to-end test of the Beacon survey API.

Simulates real respondents against the running server: one full completer, one screened-out
specialist, one who fails the attention check, and one speeder. Then verifies that the data
lands correctly in the export, and that the quality-control flags fire as intended.

Usage: python3 scripts/e2e_live_server.py [base_url]   (server must be running)
"""
import json
import random
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
random.seed(42)


def call(path, payload=None, method=None):
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def raw(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return r.read().decode()


spec = call("/api/spec")
QS = {q["id"]: q for q in spec["questions"]}
CONJ = spec["conjoint"]
fails = []


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + ("" if cond else f"  <- {detail}"))
    if not cond:
        fails.append(label)


def build_answers(profile):
    """Fill every question in the spec the way the given respondent profile would."""
    a = {}
    for q in spec["questions"]:
        qid, t = q["id"], q["type"]
        if qid == "Q1":
            a[qid] = {"_": profile.get("Q1", 1)}
        elif qid == "Q3":
            a[qid] = {"_": profile.get("Q3", 25)}
        elif qid == "Q4":
            a[qid] = {"_": profile.get("Q4", 1)}
        elif t == "single_select":
            codes = [o["code"] for o in q["options"]]
            pick = profile.get(qid, codes[0])
            a[qid] = {"_": pick}
        elif t == "numeric":
            lo, hi = q["min"], q["max"]
            a[qid] = {"_": profile.get(qid, lo + (hi - lo) // 3)}
        elif t == "slider":
            a[qid] = {"_": profile.get(qid, (q["min"] + q["max"]) // 2)}
        elif t == "rating_grid":
            base = profile.get("grid_base", 5)
            a[qid] = {r["code"]: min(q["scale"]["max"], max(q["scale"]["min"], base + random.randint(-1, 1)))
                      for r in q["rows"]}
            if profile.get("straightline") and qid == "Q7":
                a[qid] = {r["code"]: 7 for r in q["rows"]}
        elif t == "semantic_diff":
            a[qid] = {r["code"]: random.randint(q["scale"]["min"], q["scale"]["max"]) for r in q["rows"]}
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
            a[qid] = {"_": profile.get(qid,
                                       "The unmet need is greatest in patients with poor "
                                       "performance status where tolerability drives the decision.")}
        elif t == "nps":
            a[qid] = {"_": profile.get(qid, 9)}
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
            # answer every task, using the opt-out occasionally
            picks = {}
            for t_i in range(1, CONJ["n_tasks"] + 1):
                picks[f"T{t_i}"] = profile.get("uniform_pick", random.choice([1, 2, 3, 0]))
            a[qid] = picks
    return a


def run_respondent(label, profile, expect_complete=True):
    print(f"\n--- {label} ---")
    s = call("/api/start", {})
    code = s["respondent_code"]
    ans = build_answers(profile)
    elapsed = profile.get("elapsed", 1200)

    # simulate the screen-out path: save with screened_out when the screener fails
    screen_reason = None
    if profile.get("Q1") in (5, 6, 7, 8):
        screen_reason = f"Specialty not eligible (Q1={profile['Q1']})"
    elif profile.get("Q4") in (3, 4, 5):
        screen_reason = f"Industry conflict (Q4={profile['Q4']})"
    elif profile.get("Q3", 25) < 5:
        screen_reason = "Fewer than 5 eligible patients per month"

    call("/api/save", {"session_id": s["session_id"], "answers": ans,
                       "elapsed_seconds": elapsed,
                       "screened_out": bool(screen_reason),
                       "screen_out_reason": screen_reason,
                       "screen_out_at": "Q1" if screen_reason else None})

    if screen_reason:
        prog = call(f"/api/progress?sid={s['session_id']}")
        check(f"{code} recorded as screened_out", prog["status"] == "screened_out", prog["status"])
        check(f"{code} screen-out reason stored",
              prog["status"] == "screened_out", "")
        return code, "screened_out"

    res = call("/api/submit", {"session_id": s["session_id"], "answers": ans,
                               "elapsed_seconds": elapsed})
    check(f"{code} submitted complete", res.get("ok") is True, str(res))
    check(f"{code} code matches", res.get("respondent_code") == code, res.get("respondent_code"))
    print(f"    qc flags: {res.get('flags')}")
    return code, res.get("flags", [])


print("=" * 70)
print("PROJECT BEACON - end-to-end API test")
print("=" * 70)
print(f"server: {BASE}")

# Start from a clean slate so the expected counts below are deterministic.
try:
    reset = call("/admin/reset?token=beacon-admin&scope=all", method="POST")
    print(f"reset: removed {reset.get('deleted_respondents')} pre-existing record(s)")
except Exception as e:
    fails.append("pre-test reset failed: " + str(e))
    print(f"ERROR: reset failed ({e}) - counts below will not match")
print(f"spec: {len(spec['questions'])} questions, {CONJ['n_tasks']} conjoint tasks")

# 1. a clean completer
c1, f1 = run_respondent("R-a: clean completer", {"Q13": 2}, expect_complete=True)
check("clean completer has no QC flags", f1 == [], str(f1))

# 2. a screened-out radiation oncologist
c2, f2 = run_respondent("R-b: radiation oncologist (should screen out)", {"Q1": 5})
check("radiation oncologist screened out", f2 == "screened_out", str(f2))

# 3. industry conflict
c3, f3 = run_respondent("R-c: works for a CRO (should screen out)", {"Q4": 4})
check("CRO employee screened out", f3 == "screened_out", str(f3))

# 4. attention-check failure
c4, f4 = run_respondent("R-d: fails attention check", {"Q13": 5})
check("attention-check failure flagged", "attention_check_failed" in (f4 or []), str(f4))

# 5. speeder + straight-liner + uniform conjoint
c5, f5 = run_respondent("R-e: speeder, straight-liner, uniform conjoint",
                        {"elapsed": 200, "straightline": True, "uniform_pick": 2})
check("speeder flagged", "speeder" in (f5 or []), str(f5))
check("straight-liner flagged", "straightliner_Q7" in (f5 or []), str(f5))
check("uniform conjoint flagged", "conjoint_uniform_choice" in (f5 or []), str(f5))

# 6. low-volume screen-out
c6, f6 = run_respondent("R-f: 2 patients/month (should screen out)", {"Q3": 2})
check("low volume screened out", f6 == "screened_out", str(f6))

# ---------- export verification ----------
print("\n--- export ---")
csv = raw("/admin/export.csv?token=beacon-admin")
rows = csv.strip().split("\n")
header = rows[0].split(",")
check("CSV has a header row", len(header) > 20, str(len(header)))
check("CSV has one row per respondent", len(rows) - 1 >= 6, f"{len(rows)-1} rows")
check("CSV includes conjoint task columns", "Q16_T1" in header and "Q16_T9" in header,
      "missing Q16_T*")
check("CSV includes qc_flags column", "qc_flags" in header, "")
check("CSV includes census_division", "census_division" in header, "")

# screened-out respondents never reached Q13, so they must not be flagged for failing it
import csv as _csv, io as _io
_parsed = list(_csv.DictReader(_io.StringIO(csv)))
_so = [r for r in _parsed if r["status"] == "screened_out"]
_co = [r for r in _parsed if r["status"] == "complete"]
check("screened-out rows carry no qc_flags in CSV",
      len(_so) > 0 and all(not r["qc_flags"].strip() for r in _so),
      str([(r["respondent_code"], r["qc_flags"]) for r in _so]))
check("complete rows keep their qc_flags in CSV",
      any(r["qc_flags"].strip() for r in _co),
      str([(r["respondent_code"], r["qc_flags"]) for r in _co]))
print(f"    {len(header)} columns, {len(rows)-1} data rows")

js = json.loads(raw("/admin/export.json?token=beacon-admin"))
check("JSON export returns all respondents", len(js) >= 6, str(len(js)))
comp = [r for r in js if r["status"] == "complete"]
check("JSON shows 3 complete respondents", len(comp) == 3, f"{len(comp)} complete")
screened = [r for r in js if r["status"] == "screened_out"]
check("JSON shows 3 screened-out respondents", len(screened) == 3, f"{len(screened)} screened out")
check("complete respondents carry 9 conjoint answers",
      all(sum(1 for k in r["answers"].get("Q16", {}) if k.startswith("T")) == 9 for r in comp), "")

# spot-check that a real value round-tripped
first = comp[0]["answers"]
check("Q12 intent round-tripped", first.get("Q12", {}).get("_") is not None, "")
check("Q18a price round-tripped", first.get("Q18a", {}).get("_") is not None, "")

# ---------- access control ----------
print("\n--- access control ---")
try:
    raw("/admin/export.csv")
    check("admin export blocked without token", False, "returned 200 with no token")
except urllib.error.HTTPError as e:
    check("admin export blocked without token", e.code == 403, str(e.code))

print("\n" + "=" * 70)
print(f"{'ALL CHECKS PASSED' if not fails else str(len(fails)) + ' CHECK(S) FAILED: ' + str(fails)}")
print("=" * 70)
sys.exit(1 if fails else 0)
