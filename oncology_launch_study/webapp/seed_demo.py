#!/usr/bin/env python3
"""
Seed a handful of demo respondents and download a sample Excel workbook.

Useful for checking the export format before real fielding, and for rehearsing the
analysis pipeline. Everything it creates is marked as TEST data, so a single
"Clear test data" on the admin dashboard removes it.

Usage: python3 seed_demo.py [base_url] [--keep]
       --keep leaves the demo records in place instead of clearing them afterwards.
"""
import json
import random
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
TOKEN = "beacon-admin"
KEEP = "--keep" in sys.argv
random.seed(11)


def call(path, payload=None, method=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


spec = json.loads(call("/api/spec"))
QS = spec["questions"]
N_TASKS = spec["conjoint"]["n_tasks"]


def make_answers(style):
    a = {}
    for q in QS:
        qid, t = q["id"], q["type"]
        if qid == "Q1":
            a[qid] = {"_": style.get("Q1", 1)}
        elif qid == "Q3":
            a[qid] = {"_": style.get("Q3", 25)}
        elif qid == "Q4":
            a[qid] = {"_": style.get("Q4", 1)}
        elif qid == "Q13":
            a[qid] = {"_": style.get("Q13", 2)}
        elif t == "single_select":
            opts = q["options"]
            pick = style.get(qid, opts[random.randrange(len(opts))]["code"])
            a[qid] = {"_": pick}
        elif t == "numeric":
            if qid in ("Q18a", "Q18b"):
                a[qid] = {"_": style.get(qid, random.choice([85000, 110000, 135000, 160000]))}
            elif qid == "Q12b":
                a[qid] = {"_": style.get("Q12b", random.choice([15, 25, 30, 40, 55]))}
            else:
                a[qid] = {"_": style.get(qid, q["min"] + (q["max"] - q["min"]) // 3)}
        elif t == "slider":
            a[qid] = {"_": style.get(qid, random.randint(q["min"] + 2, q["max"]))}
        elif t == "rating_grid":
            if style.get("straightline") and qid == "Q7":
                a[qid] = {r["code"]: 7 for r in q["rows"]}
            else:
                a[qid] = {r["code"]: random.randint(q["scale"]["min"], q["scale"]["max"])
                          for r in q["rows"]}
        elif t == "semantic_diff":
            a[qid] = {r["code"]: random.randint(q["scale"]["min"], q["scale"]["max"])
                      for r in q["rows"]}
        elif t == "sum_to_100":
            n = len(q["rows"])
            vals = [max(0, 100 // n + random.randint(-8, 8)) for _ in range(n)]
            vals[0] += 100 - sum(vals)
            a[qid] = {r["code"]: vals[i] for i, r in enumerate(q["rows"])}
        elif t == "multi_select":
            k = min(3, len(q["options"]))
            a[qid] = {"codes": [o["code"] for o in
                                random.sample(q["options"], k)]}
        elif t == "rank":
            order = [r["code"] for r in q["rows"]]
            random.shuffle(order)
            a[qid] = {"order": order}
        elif t == "open_text":
            a[qid] = {"_": random.choice([
                "Survival benefit and tolerability drive my decision in this line.",
                "Access is the real constraint - if prior authorisation is slow, I will not start it.",
                "I need subgroup data for patients with borderline performance status.",
                "The oral option would change practice if the efficacy holds up.",
            ])}
        elif t == "choice_task":
            if style.get("uniform"):
                a[qid] = {f"T{i}": 2 for i in range(1, N_TASKS + 1)}
            else:
                a[qid] = {f"T{i}": random.choice([1, 2, 3, 0]) for i in range(1, N_TASKS + 1)}
    return a


PROFILES = [
    ("enthusiastic adopter", {"Q12": 5, "Q12b": 55, "Q18a": 135000, "Q18b": 160000, "Q20": 9}),
    ("cautious adopter", {"Q12": 4, "Q12b": 25, "Q18a": 110000, "Q18b": 130000, "Q20": 7}),
    ("sceptic", {"Q12": 2, "Q12b": 10, "Q18a": 85000, "Q18b": 95000, "Q20": 4}),
    ("fails attention check", {"Q13": 5, "Q12": 4, "Q20": 8}),
    ("speeder + straight-liner + uniform conjoint",
     {"straightline": True, "uniform": True, "Q12": 5, "Q20": 9}),
    ("screened out - radiation oncology", {"Q1": 5}),
    ("screened out - low volume", {"Q3": 3}),
]

print("Seeding demo respondents (all marked as TEST data)...")
for label, style in PROFILES:
    s = json.loads(call("/api/start", {"is_test": True}))
    elapsed = 190 if "speeder" in label else random.randint(900, 1500)
    if style.get("Q1") in (5, 6, 7, 8) or style.get("Q3", 25) < 5:
        call("/api/save", {"session_id": s["session_id"], "answers": make_answers(style),
                           "elapsed_seconds": elapsed, "screened_out": True,
                           "screen_out_reason": "demo screen-out",
                           "screen_out_at": "Q1" if style.get("Q1") in (5, 6, 7, 8) else "Q3"})
        print(f"  {s['respondent_code']}  screened out  ({label})")
    else:
        call("/api/submit", {"session_id": s["session_id"], "answers": make_answers(style),
                             "elapsed_seconds": elapsed})
        print(f"  {s['respondent_code']}  complete      ({label})")

print("\nDownloading sample workbook...")
blob = call(f"/admin/export.xlsx?token={TOKEN}&scope=all")
out = "../BEACON_sample_export.xlsx"
with open(out, "wb") as f:
    f.write(blob)
print(f"  wrote {out} ({len(blob):,} bytes)")

if not KEEP:
    r = json.loads(call(f"/admin/reset?token={TOKEN}&scope=test", method="POST"))
    print(f"\nCleared {r['deleted_respondents']} demo record(s). "
          "Re-run with --keep to leave them in place.")
else:
    print("\n--keep specified: demo records left in the database.")
