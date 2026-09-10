"""
Data-quality rules: speeders, attention checks, straight-lining, uniform conjoint choices,
thin or gibberish verbatims. Configured per study through ``cfg["qc"]``.
"""

from __future__ import annotations

import re

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


def qc_flags(answers: dict, elapsed: float, cfg: dict, status: str = "complete") -> dict:
    if status == "screened_out":
        return {"flags": [], "clean": True}
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
    for qid in qc.get("verbatim_qs", []):
        txt = answers.get(qid, {}).get("_")
        if txt and len(str(txt).split()) < 3:
            flags.append(f"thin_verbatim_{qid}")
        if txt and _gibberish(str(txt)):
            flags.append(f"gibberish_verbatim_{qid}")
    return {"flags": flags, "clean": not flags}
