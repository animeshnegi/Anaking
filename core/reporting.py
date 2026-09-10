"""
Config-driven flattening, export sheets and quick analysis aggregates.
"""

from __future__ import annotations

import time

from .conjoint import task_list
from .qc import qc_flags

def flatten(respondent, answers: dict, cfg: dict) -> dict:
    quota = cfg.get("quota", {})
    out = {
        "respondent_code": respondent["respondent_code"],
        "is_test": "test" if respondent["is_test"] else "real",
        "status": respondent["status"],
        "screen_out_at": respondent["screen_out_at"] or "",
        "screen_out_reason": respondent["screen_out_reason"] or "",
        "started_at": respondent["started_at"] or "",
        "completed_at": respondent["completed_at"] or "",
        "elapsed_seconds": round(respondent["elapsed_seconds"] or 0, 1),
        "elapsed_minutes": round((respondent["elapsed_seconds"] or 0) / 60, 1),
        "qc_flags": ";".join(qc_flags(answers, respondent["elapsed_seconds"] or 0,
                                      cfg, respondent["status"] or "complete")["flags"]),
    }
    # quota lookups when the study defines them
    setting_code = answers.get(quota.get("setting_q", ""), {}).get("_") if quota else None
    out["practice_setting_group"] = (quota.get("setting_quota", {}) or {}).get(
        str(setting_code), "") if setting_code else ""
    states = quota.get("states", []) or []
    st_code = answers.get(quota.get("state_q", ""), {}).get("_") if quota else None
    try:
        out["state"] = states[int(st_code) - 1] if st_code else ""
    except (ValueError, IndexError):
        out["state"] = ""
    out["census_division"] = (quota.get("divisions", {}) or {}).get(out["state"], "")

    for q in cfg.get("questions", []):
        qid, a, t = q["id"], answers.get(q["id"], {}), q["type"]
        if t in ("single_select", "numeric", "slider"):
            raw = a.get("_", "")
            out[qid] = raw
            opt = next((o for o in q.get("options", []) if str(o["code"]) == str(raw)), None)
            if opt:
                out[qid + "_text"] = opt["label"]
            if a.get("other_text"):
                out[qid + "_other"] = a["other_text"]
        elif t == "open_text":
            out[qid] = a.get("_", "")
            if a.get("voice"):
                out[qid + "_voice"] = "recorded"
        elif t == "nps":
            raw = a.get("_", "")
            out[qid] = raw
            try:
                n = int(raw)
                out[qid + "_segment"] = ("Promoter" if n >= 9 else "Passive" if n >= 7
                                         else "Detractor")
            except (ValueError, TypeError):
                out[qid + "_segment"] = ""
        elif t in ("rating_grid", "semantic_diff", "emoji_grid", "sum_to_100"):
            for r in q["rows"]:
                out[f"{qid}_{r['code']}"] = a.get(r["code"], "")
        elif t == "heatmap":
            for r in q["rows"]:
                for c in q["cols"]:
                    out[f"{qid}_{r['code']}_{c['code']}"] = a.get(
                        r["code"] + "_" + c["code"], "")
        elif t == "multi_select":
            out[qid] = ";".join(str(c) for c in sorted(a.get("codes", []), key=str))
            out[qid + "_text"] = "; ".join(
                o["label"] for o in q.get("options", []) if str(o["code"]) in
                {str(c) for c in a.get("codes", [])})
        elif t == "rank":
            out[qid] = ";".join(str(c) for c in (a.get("order") or [])[:q.get("rank_count", 3)])
        elif t == "maxdiff":
            for i in range(1, len(q.get("rounds", [])) + 1):
                b, w = a.get(f"R{i}_best", ""), a.get(f"R{i}_worst", "")
                out[f"{qid}_R{i}_best"] = b
                out[f"{qid}_R{i}_worst"] = w
        elif t == "choice_task":
            n_tasks = (cfg.get("conjoint") or {}).get("n_tasks", 0)
            for i in range(1, n_tasks + 1):
                out[f"{qid}_T{i}"] = a.get(f"T{i}", "")
        if q.get("randomize") and q.get("randomize") != "none":
            out[qid + "_order_shown"] = a.get("_order", "")
    return out


def conjoint_long(records: list, cfg: dict) -> tuple:
    design = cfg.get("conjoint")
    if not design:
        return [], []
    tl = task_list(design)
    attrs = [a["id"] for a in design["attributes"]]
    levels = {a["id"]: a["levels"] for a in design["attributes"]}
    n_tasks = design["n_tasks"] if design.get("n_tasks") else len(tl)
    uq = next((q["id"] for q in cfg["questions"] if q["type"] == "choice_task"), None)
    headers = ["respondent_code", "is_test", "task_id", "alt_id", "is_opt_out", "chosen"] + \
              attrs + [a + "_text" for a in attrs]
    rows = []
    if not uq:
        return headers, rows
    for rec in records:
        if rec["status"] != "complete":
            continue
        qa = rec["answers"].get(uq, {})
        for t_i in range(1, n_tasks + 1):
            picked = qa.get(f"T{t_i}")
            if picked is None or picked == "":
                continue
            picked = int(picked)
            for a_i, alt in enumerate(tl[t_i - 1], start=1):
                profile = alt["levels"] if isinstance(alt, dict) else alt
                rows.append([rec["respondent_code"], rec["is_test_label"], t_i, a_i, 0,
                             int(picked == a_i)] + [int(p) + 1 for p in profile] +
                            [levels[attrs[k]][int(profile[k])] for k in range(len(attrs))])
            rows.append([rec["respondent_code"], rec["is_test_label"], t_i, 0, 1,
                         int(picked == 0)] + [""] * (2 * len(attrs)))
    return headers, rows


def build_sheets(records: list, scope: str, cfg: dict):
    total = len(records)
    complete = [r for r in records if r["status"] == "complete"]
    screened = [r for r in records if r["status"] == "screened_out"]
    in_prog = [r for r in records if r["status"] == "in_progress"]

    def count(pred, seq=records):
        return sum(1 for r in seq if pred(r))

    metrics = cfg.get("metrics", {})
    summary_rows = [
        ["Study", cfg.get("title", "")],
        ["Export scope", scope],
        ["Generated (UTC)", time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())],
        ["", ""],
        ["Total respondents started", total],
        ["Completed", len(complete)],
        ["Screened out", len(screened)],
        ["In progress / abandoned", len(in_prog)],
        ["Completion rate (%)", round(100 * len(complete) / total, 1) if total else 0],
        ["", ""],
        ["Mean elapsed, completed (min)",
         round(sum(r["elapsed_seconds"] or 0 for r in complete) / 60 / len(complete), 1)
         if complete else 0],
        ["Respondents with QC flags",
         sum(1 for r in complete if qc_flags(r["answers"], r["elapsed_seconds"] or 0,
                                             cfg)["flags"])],
        ["", ""],
    ]
    if cfg.get("quota"):
        for div in sorted({v for v in (cfg["quota"].get("divisions") or {}).values()}):
            summary_rows.append([f"Quota - division: {div}",
                                 count(lambda r, d=div: r["flat"].get("census_division") == d,
                                       complete)])
        for grp in sorted({v for v in (cfg["quota"].get("setting_quota") or {}).values()
                           if v}):
            summary_rows.append([f"Quota - setting: {grp}",
                                 count(lambda r, g=grp:
                                       r["flat"].get("practice_setting_group") == g, complete)])
    if metrics.get("intent_q"):
        intent = [float(r["answers"].get(metrics["intent_q"], {}).get("_") or 0)
                  for r in complete]
        summary_rows += [["", ""], ["Demand headline (completed respondents)", ""]]
        summary_rows.append([f"Top-2-box intent ({metrics['intent_q']}>=4) (%)",
                             round(100 * sum(1 for v in intent if v >= 4) / len(intent), 1)
                             if intent else 0])
    if metrics.get("pct_q"):
        pct = [float(r["answers"].get(metrics["pct_q"], {}).get("_") or 0) for r in complete]
        summary_rows.append([f"Mean % eligible patients ({metrics['pct_q']})",
                             round(sum(pct) / len(pct), 1) if pct else 0])
    if metrics.get("wtp_q"):
        wtp = [float(r["answers"].get(metrics["wtp_q"], {}).get("_") or 0) for r in complete]
        summary_rows.append([f"Mean stated good-value cost ({metrics['wtp_q']}) ($)",
                             round(sum(wtp) / len(wtp)) if wtp else 0])

    flat_rows = [r["flat"] for r in records]
    if flat_rows:
        cols = list(flat_rows[0].keys())
        for f in flat_rows:
            for k in f:
                if k not in cols:
                    cols.append(k)
        wide_headers, wide_rows = cols, [[f.get(c, "") for c in cols] for f in flat_rows]
    else:
        wide_headers, wide_rows = ["respondent_code"], []

    conj_headers, conj_rows = conjoint_long(records, cfg)

    so_headers = ["respondent_code", "is_test", "screened_out_at", "reason", "started_at"]
    so_rows = [[r["respondent_code"], "test" if r["is_test"] else "real",
                r["screen_out_at"] or "", r["screen_out_reason"] or "", r["started_at"] or ""]
               for r in screened]

    qc_headers = ["respondent_code", "is_test", "elapsed_minutes", "flags", "clean"]
    qc_rows = []
    for r in complete:
        q = qc_flags(r["answers"], r["elapsed_seconds"] or 0, cfg)
        qc_rows.append([r["respondent_code"], "test" if r["is_test"] else "real",
                        round((r["elapsed_seconds"] or 0) / 60, 1), ";".join(q["flags"]),
                        "yes" if q["clean"] else "no"])

    dd_headers = ["question_id", "section", "type", "stem", "item", "item_label",
                  "values_or_scale"]
    dd_rows = []
    for q in cfg.get("questions", []):
        stem = q["stem"]
        if q.get("show_if") and q["show_if"].get("rules"):
            rules = " %s " % ("OR" if q["show_if"].get("match") == "any" else "AND")
            dd_rows.append([q["id"], q["section"], q["type"], stem, "(show-if)",
                            rules.join(f"{r.get('q')} {r.get('op')} {r.get('value', '')}".strip()
                                       for r in q["show_if"]["rules"]),
                            "hidden unless true" if not q["show_if"].get("negate") else "hidden when true"])
        if q["type"] in ("single_select", "multi_select"):
            for o in q.get("options", []):
                dd_rows.append([q["id"], q["section"], q["type"], stem, o["code"], o["label"],
                                "option" + (" - TERMINATES" if o.get("terminate") else "")
                                + (" - EXCLUSIVE" if o.get("exclusive") else "")
                                + (" - pinned" if o.get("pin") else "")])
        elif q["type"] in ("rating_grid", "semantic_diff", "sum_to_100", "emoji_grid"):
            scale = (f"{q['scale']['min']}-{q['scale']['max']}" if "scale" in q
                     else "0-100, rows sum to 100")
            for r in q["rows"]:
                dd_rows.append([q["id"], q["section"], q["type"], stem, r["code"], r["label"],
                                scale])
        elif q["type"] == "heatmap":
            for r in q["rows"]:
                for c in q["cols"]:
                    dd_rows.append([q["id"], q["section"], q["type"], stem,
                                    f"{r['code']}_{c['code']}", f"{r['label']} x {c['label']}",
                                    "0-3 heat intensity"])
        elif q["type"] == "maxdiff":
            for i, rnd in enumerate(q.get("rounds", []), 1):
                dd_rows.append([q["id"], q["section"], q["type"], stem, f"R{i}",
                                " / ".join(rnd["items"]), "best-worst round codes"])
        elif q["type"] == "rank":
            for r in q["rows"]:
                dd_rows.append([q["id"], q["section"], q["type"], stem, r["code"], r["label"],
                                f"rank 1-{len(q['rows'])}; top {q.get('rank_count', 3)} recorded"])
        elif q["type"] == "choice_task":
            n_tasks = (cfg.get("conjoint") or {}).get("n_tasks", 0)
            dd_rows.append([q["id"], q["section"], q["type"], stem, "T1..T" + str(n_tasks),
                            "chosen alternative per task", "1-3 chosen, 0 = opt-out"])
        elif q["type"] == "nps":
            dd_rows.append([q["id"], q["section"], q["type"], stem, "_", "0-10 NPS",
                            "9-10 promoter, 7-8 passive, 0-6 detractor"])
        else:
            dd_rows.append([q["id"], q["section"], q["type"], stem, "_", "single value",
                            f"{q.get('min', '')}-{q.get('max', '')}" if q["type"] in
                            ("numeric", "slider") else "free text"])

    widths_map = {"Field summary": [52, 22], "Screen-outs": [16, 9, 16, 44, 20],
                  "QC flags": [16, 9, 15, 46, 8],
                  "Data dictionary": [18, 8, 14, 58, 10, 52, 40]}
    return [
        ("Field summary", ["Metric", "Value"], summary_rows, widths_map["Field summary"]),
        ("Responses", wide_headers, wide_rows, None),
        ("Conjoint long", conj_headers, conj_rows, None),
        ("Screen-outs", so_headers, so_rows, widths_map["Screen-outs"]),
        ("QC flags", qc_headers, qc_rows, widths_map["QC flags"]),
        ("Data dictionary", dd_headers, dd_rows, widths_map["Data dictionary"]),
    ]


def analysis_for(records: list, cfg: dict) -> dict:
    complete = [r for r in records if r["status"] == "complete"]
    out = {"n_started": len(records), "n_complete": len(complete),
           "n_screened": sum(1 for r in records if r["status"] == "screened_out"),
           "mean_minutes": round(sum(r["elapsed_seconds"] or 0 for r in complete) / 60 /
                                 len(complete), 1) if complete else 0,
           "ratings": [], "nps": None, "maxdiff": [], "heatmap": [], "emoji": [],
           "choice_share": None}

    def mean(vals):
        vals = [float(v) for v in vals if v not in (None, "")]
        return round(sum(vals) / len(vals), 2) if vals else None

    for q in cfg.get("questions", []):
        t = q["type"]
        if t in ("rating_grid", "semantic_diff", "emoji_grid"):
            rows = []
            for r in q["rows"]:
                rows.append({"label": r["label"],
                             "mean": mean([rec["answers"].get(q["id"], {}).get(r["code"])
                                           for rec in complete])})
            out["ratings"].append({"id": q["id"], "stem": q["stem"][:60], "rows": rows})
        elif t == "nps":
            seg = {"Promoter": 0, "Passive": 0, "Detractor": 0}
            for rec in complete:
                v = rec["answers"].get(q["id"], {}).get("_")
                try:
                    n = int(v)
                except (TypeError, ValueError):
                    continue
                seg["Promoter" if n >= 9 else "Passive" if n >= 7 else "Detractor"] += 1
            tot = sum(seg.values()) or 1
            out["nps"] = {"id": q["id"], "segments": seg,
                          "score": round(100 * (seg["Promoter"] - seg["Detractor"]) / tot)}
        elif t == "maxdiff":
            best, worst = {}, {}
            for rec in complete:
                a = rec["answers"].get(q["id"], {})
                for i in range(1, len(q.get("rounds", [])) + 1):
                    b, w = a.get(f"R{i}_best"), a.get(f"R{i}_worst")
                    if b:
                        best[b] = best.get(b, 0) + 1
                    if w:
                        worst[w] = worst.get(w, 0) + 1
            codes = sorted(set(best) | set(worst))
            out["maxdiff"].append({"id": q["id"],
                                   "scores": [{"code": c, "best": best.get(c, 0),
                                               "worst": worst.get(c, 0),
                                               "bw": best.get(c, 0) - worst.get(c, 0)}
                                              for c in codes]})
        elif t == "heatmap":
            cells = []
            for r in q["rows"]:
                for c in q["cols"]:
                    cells.append({"row": r["label"], "col": c["label"],
                                  "mean": mean([rec["answers"].get(q["id"], {})
                                                .get(r["code"] + "_" + c["code"])
                                                for rec in complete])})
            out["heatmap"].append({"id": q["id"], "cells": cells})
    design = cfg.get("conjoint")
    if design and complete:
        uq = next((q for q in cfg["questions"] if q["type"] == "choice_task"), None)
        if uq:
            lvl_chosen, lvl_seen = {}, {}
            for rec in complete:
                qa = rec["answers"].get(uq["id"], {})
                tl = task_list(design)
                for t_i, task in enumerate(tl, 1):
                    picked = qa.get(f"T{t_i}")
                    if picked in (None, ""):
                        continue
                    for a_i, alt in enumerate(task, 1):
                        profile = alt["levels"] if isinstance(alt, dict) else alt
                        chosen = int(picked) == a_i
                        for ai, attr in enumerate(design["attributes"]):
                            key = (attr["id"], int(profile[ai]))
                            lvl_seen[key] = lvl_seen.get(key, 0) + 1
                            if chosen:
                                lvl_chosen[key] = lvl_chosen.get(key, 0) + 1
            share = []
            for attr in design["attributes"]:
                for li in range(len(attr["levels"])):
                    seen = lvl_seen.get((attr["id"], li), 0)
                    share.append({"attr": attr["id"], "level": attr["levels"][li],
                                  "share": round(100 * lvl_chosen.get((attr["id"], li), 0) /
                                                 seen, 1) if seen else 0})
            out["choice_share"] = share
    return out
