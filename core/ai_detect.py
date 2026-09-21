"""
AI-generated / copy-pasted answer detection for open-text questions.

Verbatims are the most valuable part of any study - and now the easiest part to fake by
pasting a ChatGPT answer into the box.  This module is the defence: plain-Python
heuristics (no model weights, no network call, no new dependency) that turn one written
answer into a 0-100 suspicion score, a verdict and a list of the evidence behind it.

The same rules run three times over the same text, which is what makes the flag defensible:

  1. live, while the respondent is still typing   POST /api/check_text -> warning chip,
     with the option to make them confirm the answer is their own before moving on;
  2. on submit                                    core.qc.qc_flags -> QC flags on the record;
  3. after the field closes                       Admin "Verbatim AI check" review queue
     and the export workbook, including cross-respondent duplicates.

Two families of evidence are combined:

  linguistic   the stylistic fingerprint of LLM output - hallmark vocabulary ("delve",
               "moreover", "it is important to note"), refusal phrasing ("as an AI language
               model"), markdown and smart-quote artefacts nobody types by hand, a metronome
               sentence rhythm, an impersonal register with no contractions and no
               first person, numbered "firstly / secondly / finally" scaffolding.
  behavioural  what the browser actually saw - pasted characters, keystroke count,
               characters per second of active typing, one-shot paste bursts, tab-switching
               while "writing".  Only available when the survey client sends ``meta``.

Human evidence subtracts from the score, so an informal, contracted, first-person answer
with concrete numbers cannot be pushed over the threshold by a stray "overall,".

``proofread()`` is the companion sanity check: the mechanical problems a human coder
spots on first read (doubled words, placeholder brackets, runaway sentences, ALL CAPS,
stray markdown, a non-answer like "N/A").  Those notes are shown to the respondent in the
final proofreading step and to the reviewer in the Admin queue.
"""

from __future__ import annotations

import re
import unicodedata

# --- thresholds (overridable per study through cfg["qc"]["ai"]) -------------------------
MIN_WORDS = 8          # fewer words than this and there is not enough style to judge
WARN_AT = 35           # "possible AI" - shown to the respondent, listed for review
FLAG_AT = 60           # "likely AI" - raised as a QC flag
MAX_TEXT = 8000        # anything longer is truncated before scoring

VERDICT_HUMAN = "human"
VERDICT_POSSIBLE = "possible_ai"
VERDICT_LIKELY = "likely_ai"
VERDICT_SHORT = "too_short"

# ======================================================================================
# EVIDENCE: LINGUISTIC
# ======================================================================================
# Weight >= 40 marks "self-evident" evidence that survives the short-text discount.
DISCLAIMERS = (
    (r"\bas an (ai|a\.i\.|artificial intelligence|llm|language model)\b", "identifies itself as an AI"),
    (r"\bas (a|an) (large )?language model\b", "identifies itself as a language model"),
    (r"\bi('| a|\u2019)?m (just |only )?(an? )?(ai|llm|language model|virtual assistant|chatbot)\b",
     "speaks as an assistant, not a respondent"),
    (r"\bi (cannot|can't|can\u2019t|am unable to) (provide|generate|give|offer|answer|help)\b",
     "assistant-style refusal"),
    (r"\bi do not have (personal |real )?(opinions|feelings|experiences)\b",
     "assistant-style disclaimer"),
    (r"\bi hope this (helps|is helpful)\b", "closes like an assistant reply"),
    (r"\b(great|good|excellent) question\b", "opens like an assistant reply"),
)
# An answer that introduces itself as an AI is not a respondent's answer at all, so this
# outweighs every other signal and survives the short-text discount.
DISCLAIMER_WEIGHT = 70

# Hallmark vocabulary of LLM prose. Each distinct hit scores HALLMARK_WEIGHT, capped.
HALLMARKS = (
    "delve", "delves", "delving", "tapestry", "multifaceted", "underscores", "underscore",
    "underscoring", "testament", "pivotal", "paramount", "crucial", "crucially",
    "in conclusion", "to summarize", "to summarise", "in summary", "it is important to note",
    "it's important to note", "it is worth noting", "it's worth noting",
    "plays a crucial role", "plays a vital role", "plays a key role", "a wide range of",
    "various factors", "when it comes to", "at the end of the day",
    "in today's fast-paced world", "navigating the complexities", "state-of-the-art",
    "cutting-edge", "game-changer", "seamlessly", "streamline", "streamlines",
    "leverage", "leverages", "leveraging", "harness", "harnesses", "harnessing",
    "foster", "fosters", "fostering", "empower", "empowers", "unlock", "unlocks",
    "holistic", "robust", "comprehensive", "landscape", "elevate", "elevates",
    "nuanced", "firstly", "secondly", "thirdly", "lastly", "moreover", "furthermore",
    "additionally", "consequently", "thereby", "hence,", "paradigm", "myriad",
    "plethora", "meticulous", "unwavering", "showcase", "in the realm of",
    "it's essential to", "it is essential to", "ever-evolving", "on the other hand",
    "let's dive", "dive deeper", "feel free to", "i hope this helps", "notably,",
)
HALLMARK_WEIGHT = 7
HALLMARK_CAP = 30

MARKDOWN = (
    (r"\*\*[^*]+\*\*", "bold with ** markdown"),
    (r"(?m)^\s{0,3}#{1,6}\s", "markdown heading"),
    (r"(?m)^\s*[-*\u2022]\s+\S", "bulleted list"),
    (r"(?m)^\s*\d+[.)]\s+\S", "numbered list"),
    (r"`[^`]+`", "code formatting"),
    (r"(?m)^\s*>+\s", "blockquote marker"),
    (r"\|.*\|", "markdown table"),
)

SMART_TYPE = ("\u2014", "\u2013", "\u201c", "\u201d", "\u2019\u2019")

# Words and patterns that mark real, unpolished human writing. Each hit is credit.
HUMAN_MARKERS = (
    "i think", "i guess", "i reckon", "honestly", "to be honest", "tbh", "imo", "kinda",
    "kind of", "sort of", "gonna", "wanna", "lol", "idk", "well,", "i'd say", "probably",
    "not sure", "maybe", "frankly", "worries me", "i worry", "a bit", "pretty much",
    "in my experience", "my practice", "my patient", "my patients", "we see", "i see",
    "i've", "i have", "we've", "our practice", "i would guess", "hard to say",
    "the thing is", "to be fair", "i mean",
)
HUMAN_WEIGHT = 4
HUMAN_CAP = 16

CONCRETE = re.compile(r"(\d+\s?(%|percent|mg|mcg|q\d|days?|weeks?|months?|years?|hours?|"
                      r"patients?|cases?|beds?|chairs?|visits?|k\b)|[$\u00a3\u20ac]\s?\d)", re.I)
CONTRACTION = re.compile(r"\b\w+'\w+\b|\b\w+\u2019\w+\b")
ENUMERATION = re.compile(r"\b(firstly|secondly|thirdly|finally|lastly|next,|also,|"
                         r"first,|second,|third,)\b|\b\d\)", re.I)
PLACEHOLDER = re.compile(r"\[(insert|insert here|your|text|tbd|xxx)[^\]]*\]|\{[^}]{0,40}\}|"
                         r"\b(tbd|xxx+|lorem ipsum|n/?a|no comment|none|nothing|idk)\b", re.I)
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
WORD = re.compile(r"[a-z]+(?:'[a-z]+)?")


# ======================================================================================
# TEXT HELPERS
# ======================================================================================
def _flat(text: str) -> str:
    """Lower-case, unicode-folded text for matching (keeps apostrophes for contractions)."""
    return unicodedata.normalize("NFKC", str(text or "")).lower()


def _words(text: str) -> list[str]:
    return WORD.findall(_flat(text))


def _sentences(text: str) -> list[str]:
    out = [s.strip() for s in SENT_SPLIT.split(str(text or "").strip())]
    return [s for s in out if len(WORD.findall(s)) >= 1]


def _paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", str(text or "").strip()) if p.strip()]


def _mean(vals: list[float]) -> float:
    return sum(vals) / len(vals) if vals else 0.0


def _stdev(vals: list[float]) -> float:
    if len(vals) < 2:
        return 0.0
    m = _mean(vals)
    return (sum((v - m) ** 2 for v in vals) / len(vals)) ** 0.5


# ======================================================================================
# PROOFREADING / SANITY CHECK
# ======================================================================================
def proofread(text: str) -> list[dict]:
    """Mechanical read of one answer: the problems a human coder would notice at a glance.

    Returns ``[{"key": ..., "note": ...}]``; an empty list means the text reads cleanly.
    """
    raw = str(text or "").strip()
    if not raw:
        return []
    flat, notes = _flat(raw), []

    def note(key, msg):
        notes.append({"key": key, "note": msg})

    if PLACEHOLDER.search(raw) and len(_words(raw)) <= 6:
        note("placeholder", "looks like a placeholder or a non-answer")
    if "lorem ipsum" in flat:
        note("lorem", "contains lorem ipsum filler text")
    for m in re.finditer(r"\b(\w+)\s+\1\b", flat):
        if m.group(1) not in ("had", "that", "very"):
            note("doubled_word", f'word repeated: "{m.group(0)}"')
            break
    if re.search(r"[a-z]{2,}", raw) and not re.search(r"[A-Z]", raw):
        note("no_caps", "no capitalisation anywhere")
    caps = [s for s in _sentences(raw) if len(_words(s)) >= 4 and s.isupper()]
    if caps:
        note("all_caps", "written in capitals")
    if re.search(r"([!?,;:])\1{1,}", raw) or ",," in raw:
        note("punctuation", "doubled punctuation")
    if re.search(r"[*#`|]", raw):
        note("markdown", "contains markdown symbols (**, #, `, |)")
    long_s = [s for s in _sentences(raw) if len(_words(s)) > 45]
    if long_s:
        note("run_on", f"{len(long_s)} run-on sentence(s) over 45 words")
    sents = _sentences(raw)
    if len(sents) >= 2:
        if sum(1 for s in sents if s[:1].islower()) >= max(2, len(sents) // 2):
            note("sentence_case", "sentences do not start with a capital")
        if sum(1 for s in sents if s[-1] not in ".!?\u201d") >= max(2, len(sents) // 2):
            note("no_full_stop", "sentences do not end with a full stop")
    if raw.lower().startswith(("as an ai", "as a language model", "certainly", "of course,")):
        note("assistant_tone", "opens the way an AI assistant reply does")
    return notes


# ======================================================================================
# SCORING
# ======================================================================================
def _sig(signals: list, key: str, weight: float, label: str, detail: str = "") -> None:
    signals.append({"key": key, "weight": round(weight, 1), "label": label,
                    **({"detail": detail} if detail else {})})


def _linguistic(text: str, flat: str, signals: list) -> float:
    """Add stylistic evidence for machine authorship. Returns the raw weight added."""
    raw = 0.0

    for pat, label in DISCLAIMERS:
        if re.search(pat, flat):
            _sig(signals, "disclaimer", DISCLAIMER_WEIGHT, label)
            raw += DISCLAIMER_WEIGHT
            break

    hits = sorted({h for h in HALLMARKS if h in flat})
    if hits:
        w = min(HALLMARK_CAP, HALLMARK_WEIGHT * len(hits))
        _sig(signals, "ai_vocabulary", w, "AI-typical vocabulary",
             ", ".join(hits[:6]) + (" ..." if len(hits) > 6 else ""))
        raw += w

    marks = sorted({lbl for pat, lbl in MARKDOWN if re.search(pat, str(text), re.M)})
    if marks:
        w = min(26, 13 + 7 * (len(marks) - 1))
        _sig(signals, "markdown", w, "formatted like a document, not a typed answer",
             "; ".join(marks))
        raw += w
    lines = [ln.strip() for ln in str(text).splitlines() if ln.strip()]
    bullets = sum(1 for ln in lines if re.match(r"^([-*\u2022]\s|\d+[.)]\s)", ln))
    if bullets >= 3:
        _sig(signals, "list_shaped", 12, "the answer is a formatted list, not a typed reply",
             f"{bullets} list lines")
        raw += 12

    if any(ch in text for ch in SMART_TYPE):
        _sig(signals, "smart_punctuation", 6, "em dashes / curly quotes from a text generator")
        raw += 6

    words = _words(text)
    sents = [len(_words(s)) for s in _sentences(text)]
    if len(sents) >= 3:
        cv = _stdev([float(n) for n in sents]) / _mean([float(n) for n in sents])
        if cv < 0.35 and _mean([float(n) for n in sents]) >= 12:
            _sig(signals, "even_rhythm", 14,
                 "sentence lengths are unusually even (humans vary a lot)",
                 f"{len(sents)} sentences, {round(_mean([float(n) for n in sents]), 1)} words each")
            raw += 14

    paras = _paragraphs(text)
    if len(paras) >= 2:
        lens = [len(_words(p)) for p in paras]
        if min(lens) >= 12 and _stdev([float(n) for n in lens]) / _mean([float(n) for n in lens]) < 0.3:
            _sig(signals, "essay_shape", 8, "balanced essay paragraphs in a survey box")
            raw += 8

    if len(words) >= 30 and not re.search(r"\b(i|my|me|we|our|us)\b", flat):
        _sig(signals, "impersonal", 9, "no first person anywhere in the answer")
        raw += 9

    if len(words) >= 40 and not CONTRACTION.search(text):
        _sig(signals, "no_contractions", 8, "not one contraction - unusually formal")
        raw += 8

    if len(sents) >= 3 and all(s[-1] in ".!?" and s[:1].isupper() for s in _sentences(text)):
        _sig(signals, "perfect_mechanics", 6, "every sentence perfectly capitalised and closed")
        raw += 6

    enum = ENUMERATION.findall(flat)
    if len(enum) >= 3:
        _sig(signals, "scaffolding", 7, "firstly / secondly / finally scaffolding")
        raw += 7

    if len(words) >= 40:
        uniq = len(set(words)) / len(words)
        if uniq >= 0.72 and _mean([float(len(w)) for w in words]) >= 5.1:
            _sig(signals, "polished_lexis", 7, "high word variety with long, abstract words")
            raw += 7
        if not re.search(r"\d", text):
            _sig(signals, "no_specifics", 7,
                 "no numbers, doses or dates - nothing from a real caseload")
            raw += 7
    return raw


def _human_credit(text: str, flat: str, signals: list) -> float:
    """Evidence of genuine human writing. Returned as a positive number to subtract."""
    credit = 0.0
    marks = sorted({h for h in HUMAN_MARKERS if h in flat})
    if marks:
        c = min(HUMAN_CAP, HUMAN_WEIGHT * len(marks))
        _sig(signals, "human_voice", -c, "informal, first-person phrasing",
             ", ".join(marks[:6]) + (" ..." if len(marks) > 6 else ""))
        credit += c
    if CONTRACTION.search(text):
        _sig(signals, "contractions", -4, "uses contractions")
        credit += 4
    concrete = CONCRETE.findall(text)
    if concrete:
        _sig(signals, "concrete_detail", -6, "specific numbers / units from real practice")
        credit += 6
    if re.search(r"\.\.\.|!\s|\b(um|uh|er)\b", flat) or not re.search(r"[.!?]\s*$", text.strip()):
        _sig(signals, "unpolished", -4, "unfinished, informal mechanics")
        credit += 4
    issues = proofread(text)
    if issues:
        c = min(6, 3 * len(issues))
        _sig(signals, "mechanical_flaws", -c, "spelling / grammar slips a generator rarely makes",
             "; ".join(n["note"] for n in issues[:3]))
        credit += c
    return credit


def _behavioural(meta: dict | None, text: str, signals: list) -> tuple[float, float]:
    """Paste / keystroke evidence from the survey client. Returns (weight, credit)."""
    if not meta:
        return 0.0, 0.0
    raw = credit = 0.0
    chars = len(text)
    try:
        keys = int(meta.get("keystrokes") or 0)
        pasted_chars = int(meta.get("pasted_chars") or 0)
        pastes = int(meta.get("pastes") or 0)
        events = int(meta.get("input_events") or 0)
        typed_ms = float(meta.get("typed_ms") or 0)
        blur_ms = float(meta.get("blur_ms") or 0)
    except (TypeError, ValueError):
        return 0.0, 0.0
    if chars < 40:
        return 0.0, 0.0

    if pasted_chars and pasted_chars / chars >= 0.8:
        _sig(signals, "pasted_all", 22, "essentially the whole answer was pasted in",
             f"{pasted_chars} of {chars} characters")
        raw += 22
    elif pasted_chars and pasted_chars / chars >= 0.4:
        _sig(signals, "pasted_part", 11, "a large part of the answer was pasted in",
             f"{pasted_chars} of {chars} characters")
        raw += 11
    if keys == 0:
        _sig(signals, "no_keystrokes", 28, "no keystrokes were recorded for this answer")
        raw += 28
    if typed_ms > 0:
        cps = chars / (typed_ms / 1000.0)
        if cps > 30:
            _sig(signals, "too_fast", 18, "text appeared far faster than anyone types",
                 f"{round(cps, 1)} characters per second")
            raw += 18
        elif cps > 18:
            _sig(signals, "fast", 9, "text appeared very quickly", f"{round(cps, 1)} cps")
            raw += 9
        elif cps <= 14 and not pasted_chars and keys >= 20:
            _sig(signals, "typed_normally", -14, "typed in the box at a human pace",
                 f"{round(cps, 1)} cps, {keys} keystrokes")
            credit += 14
    if events and events <= 2 and chars >= 80:
        _sig(signals, "one_burst", 12, "the answer arrived in a single burst")
        raw += 12
    if blur_ms > 8000:
        _sig(signals, "tab_switch", 6, "the tab was left for a long time while writing",
             f"{round(blur_ms / 1000)}s away")
        raw += 6
    if pastes and not pasted_chars:
        _sig(signals, "pasted_part", 6, f"{pastes} paste action(s) detected")
        raw += 6
    return raw, credit


def score_text(text: str, meta: dict | None = None, ai_cfg: dict | None = None) -> dict:
    """Score one written answer.

    ``text``   the respondent's answer.
    ``meta``   optional browser telemetry from static/js/survey.js
               (keystrokes, pastes, pasted_chars, input_events, typed_ms, blur_ms).
    ``ai_cfg`` optional ``cfg["qc"]["ai"]`` overrides: ``warn_at``, ``flag_at``, ``enabled``.

    Returns ``{score, verdict, signals, proofread, words, scored}``. ``score`` is 0-100;
    ``verdict`` is one of ``human`` / ``possible_ai`` / ``likely_ai`` / ``too_short``.
    """
    cfg = ai_cfg or {}
    warn_at = float(cfg.get("warn_at", WARN_AT))
    flag_at = float(cfg.get("flag_at", FLAG_AT))
    text = str(text or "").strip()[:MAX_TEXT]
    words = _words(text)
    issues = proofread(text)

    if len(words) < MIN_WORDS:
        return {"score": 0, "verdict": VERDICT_SHORT, "signals": [], "proofread": issues,
                "words": len(words), "scored": False}

    flat = _flat(text)
    signals: list[dict] = []
    raw = _linguistic(text, flat, signals)
    b_raw, b_credit = _behavioural(meta, text, signals)
    raw += b_raw
    credit = _human_credit(text, flat, signals) + b_credit

    # Short answers carry less stylistic evidence, so discount - unless the text already
    # gave itself away ("as an AI language model"), which is decisive at any length.
    decisive = any(s["weight"] >= 40 for s in signals)
    confidence = min(1.0, len(words) / 40.0)
    if decisive:
        score = raw - credit
    else:
        score = max(raw * (0.55 + 0.45 * confidence), 0.0) - credit
    score = int(max(0, min(100, round(score))))

    verdict = (VERDICT_LIKELY if score >= flag_at else
               VERDICT_POSSIBLE if score >= warn_at else VERDICT_HUMAN)
    return {"score": score, "verdict": verdict, "signals": signals, "proofread": issues,
            "words": len(words), "scored": True}


# ======================================================================================
# STUDY WIDE HELPERS
# ======================================================================================
def text_fields(cfg: dict) -> list[tuple[str, str]]:
    """Every free-text answer a study can collect, as ``(question_id, item)`` pairs.

    That is every ``open_text`` question plus every "please specify" box hanging off a
    select question - so the checks cover all the questions, not just a hand-picked list.
    """
    out: list[tuple[str, str]] = []
    for q in cfg.get("questions", []) or []:
        if q.get("type") == "open_text":
            out.append((q["id"], "_"))
        for o in q.get("options", []) or []:
            if o.get("other"):
                out.append((q["id"], "other_text"))
    seen, dedup = set(), []
    for pair in out:
        if pair not in seen:
            seen.add(pair)
            dedup.append(pair)
    return dedup


def ai_settings(cfg: dict, qid: str | None = None) -> dict:
    """Effective AI-check settings: study defaults from ``cfg["qc"]["ai"]``, per-question
    overrides from the question config (``ai_check``, ``ai_action``)."""
    out = dict(cfg.get("qc", {}).get("ai", {}) or {})
    out.setdefault("enabled", True)
    out.setdefault("action", "confirm")           # "warn" | "confirm" | "off"
    out.setdefault("warn_at", WARN_AT)
    out.setdefault("flag_at", FLAG_AT)
    if qid:
        q = next((x for x in cfg.get("questions", []) or [] if x.get("id") == qid), None) or {}
        if q.get("ai_check") is False:
            out["enabled"] = False
        if q.get("ai_action"):
            out["action"] = q["ai_action"]
    if out.get("action") == "off":
        out["enabled"] = False
    return out


def normalise(text: str) -> str:
    """Collapse an answer for duplicate matching: folded, punctuation-free, space-normalised."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", _flat(text))).strip()


def duplicate_verbatims(records: list[dict], cfg: dict) -> dict[tuple, list[str]]:
    """Answers copied between respondents - the classic "one AI answer shared round a
    panel" pattern. Returns ``{(respondent_code, question_id): [other codes]}``."""
    by_text: dict[tuple, dict[str, list[str]]] = {}
    for rec in records:
        code = rec.get("respondent_code")
        answers = rec.get("answers") or {}
        for qid, item in text_fields(cfg):
            txt = answers.get(qid, {}).get(item)
            if not txt:
                continue
            key = normalise(txt)
            if len(key.split()) < 6:
                continue
            by_text.setdefault((qid, item), {}).setdefault(key, []).append(code)
    out: dict[tuple, list[str]] = {}
    for (qid, _item), groups in by_text.items():
        for codes in groups.values():
            if len(codes) > 1:
                for code in codes:
                    out[(code, qid)] = [c for c in codes if c != code]
    return out
