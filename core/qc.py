"""
Data-quality rules: speeders, attention checks, straight-lining, uniform conjoint choices,
thin or gibberish verbatims, and AI-generated / pasted free-text answers.
Configured per study through ``cfg["qc"]``.

The free-text checks cover **every** open-text answer the study can collect - each
``open_text`` question and each "please specify" box - not just the hand-picked
``qc["verbatim_qs"]`` list.  Style scoring lives in :mod:`core.ai_detect` so the live
warning shown while the respondent types and the flag raised after the field closes are
produced by exactly the same code.
"""

from __future__ import annotations

import re

from .ai_detect import (VERDICT_LIKELY, VERDICT_POSSIBLE, ai_settings, score_text,
                        text_fields)

def _gibberish(t: str) -> bool:
    s = t.strip().lower()
    if len(s) < 8:
        return False
    if "lorem ipsum" in s:
        return True
    words = [w for w in re.split(r"[^a-z]+", s) if len(w) >= 5]
    if len(words) >= 3:
        bad = 0
        for w in words:
            max_run = run = 0
            has_vowel = False
            for ch in w:
                if ch in "aeiou":
                    has_vowel, run = True, 0
                else:
                    run += 1
                    max_run = max(max_run, run)
            if not has_vowel or max_run >= 4:
                bad += 1
        if bad / len(words) >= 0.5:
            return True
    letters = re.sub(r"[^a-z]", "", s)
    if len(letters) >= 8 and sum(1 for c in letters if c in "aeiou") / len(letters) < 0.1:
        return True
    for row in ("qwertyuiop", "asdfghjkl", "zxcvbnm"):
        if row in s or row[::-1] in s:
            return True
    if re.search(r"(.)\1{5,}", s):
        return True
    words_all = s.split()
    if len(words_all) >= 4 and len(set(words_all)) / len(words_all) <= 0.3:
        return True
    for chunk in range(2, 9):
        pat, reps = s[:chunk], len(s) // chunk
        if reps >= 3 and pat * reps == s[: reps * chunk] and len(s) - reps * chunk < chunk:
            return True
    return False


def free_text(answers: dict, cfg: dict, extra: list | None = None) -> list[dict]:
    """Every non-empty free-text answer on one record.

    Each entry is ``{qid, item, text, meta, question}`` - ``meta`` is the browser telemetry
    the survey client stores with the answer (keystrokes, pastes, typing time), when it is
    there.  ``extra`` adds ``(qid, item)`` pairs the study named explicitly in
    ``qc["verbatim_qs"]``.  Used by ``qc_flags`` and by the Admin review queue.
    """
    by_id = {q.get("id"): q for q in cfg.get("questions", []) or []}
    pairs = list(text_fields(cfg)) + [tuple(x) for x in (extra or [])]
    out = []
    for qid, item in dict.fromkeys(pairs):
        a = (answers or {}).get(qid) or {}
        txt = a.get(item)
        if not isinstance(txt, str) or not txt.strip():
            continue
        meta = a.get("_meta")
        out.append({"qid": qid, "item": item, "text": txt.strip(),
                    "meta": meta if isinstance(meta, dict) else None,
                    "question": by_id.get(qid, {})})
    return out


def score_free_text(answers: dict, cfg: dict, extra: list | None = None) -> dict:
    """AI suspicion per question: ``{qid: {score, verdict, words, signals, proofread}}``.

    ``check_all_text: false`` narrows the check back to the ids listed in
    ``qc["verbatim_qs"]``; ``qc["ai"]["enabled"]: false`` switches it off entirely.
    """
    extra = [tuple(x) for x in (extra or [])]
    check_all = cfg.get("qc", {}).get("check_all_text", True)
    fields = free_text(answers, cfg, extra)
    if not check_all:
        fields = [f for f in fields if (f["qid"], f["item"]) in extra]
    out = {}
    for f in fields:
        st = ai_settings(cfg, f["qid"])
        if not st.get("enabled", True):
            continue
        res = score_text(f["text"], f["meta"], st)
        if not res["scored"]:
            continue
        out[f["qid"]] = {"score": res["score"], "verdict": res["verdict"],
                         "words": res["words"],
                         "signals": [s["label"] for s in res["signals"] if s["weight"] > 0],
                         "proofread": [n["note"] for n in res["proofread"]],
                         "action": st.get("action", "confirm")}
    return out


def qc_flags(answers: dict, elapsed: float, cfg: dict, status: str = "complete") -> dict:
    if status == "screened_out":
        return {"flags": [], "clean": True, "ai": {}}
    qc = cfg.get("qc", {})
    flags = []
    if elapsed and elapsed < qc.get("min_seconds", 480):
        flags.append("speeder")
    aq, aok = qc.get("attention_q"), qc.get("attention_ok")
    if aq:
        v = answers.get(aq, {}).get("_")
        if v is not None and str(v) != str(aok):
            flags.append("attention_check_failed")
    sq = qc.get("straightline_q")
    if sq:
        vals = [v for k, v in answers.get(sq, {}).items() if not k.startswith("_")]
        if len(vals) >= 10 and len(set(vals)) == 1:
            flags.append(f"straightliner_{sq}")
    uq = qc.get("uniform_q")
    if uq and cfg.get("conjoint"):
        n_tasks = cfg["conjoint"]["n_tasks"]
        u = {k: v for k, v in answers.get(uq, {}).items() if k.startswith("T")}
        if len(u) >= n_tasks and len(set(u.values())) == 1:
            flags.append("conjoint_uniform_choice")

    # ---- free text: thin / gibberish / AI-generated -----------------------------------
    check_all = qc.get("check_all_text", True)
    verbatim_qs = qc.get("verbatim_qs", [])
    fields = free_text(answers, cfg, [(q, "_") for q in verbatim_qs])
    for f in fields:
        qid, is_main = f["qid"], f["item"] == "_"
        if is_main and (check_all or qid in verbatim_qs):
            # "please specify" boxes are meant to be a word or two, so thin/gibberish only
            # ever applies to a real open-text answer
            if len(f["text"].split()) < 3:
                flags.append(f"thin_verbatim_{qid}")
            if _gibberish(f["text"]):
                flags.append(f"gibberish_verbatim_{qid}")

    ai = score_free_text(answers, cfg, [(q, "_") for q in verbatim_qs])
    for qid, res in ai.items():
        if res["verdict"] == VERDICT_LIKELY:
            flags.append(f"ai_generated_{qid}")
        elif res["verdict"] == VERDICT_POSSIBLE:
            flags.append(f"ai_suspect_{qid}")
    if any(r["verdict"] == VERDICT_LIKELY for r in ai.values()):
        flags.append("ai_generated_verbatim")     # respondent-level roll-up for the dashboard
    return {"flags": flags, "clean": not flags, "ai": ai}
