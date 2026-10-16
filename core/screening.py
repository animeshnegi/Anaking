"""
Screening (screen in / screen out) - the server-side half.

The rules are *executed* in the browser by ``BeaconQ.screeningVerdict``
(static/js/qlogic.js), so a respondent is screened out the moment they answer.
This module owns everything that happens on the server instead:

    normalize(q)   clean a question's screening block on save, so hand-edited JSON
                   (the Advanced card) can never put the runtime into a bad state
    blocks(q)      the screening blocks of a question, explicit rules first, then the
                   legacy shorthand (options[].terminate, terminate_if_lt)
    describe(q)    the same rules in plain English, for the Word outline and the
                   data dictionary in the Excel export

A question carries at most one authored block::

    screening: { mode:  "screen_out" | "qualify",
                 match: "all" | "any",
                 when:  "live" | "next",
                 message: "what the respondent reads when it fires",
                 reason:  "short line recorded in the screen-out report",
                 rules: [ {q: "Q1", op: "any_of", value: "5,6,7,8"} ] }

``screen_out`` ends the survey when the rules match; ``qualify`` ends it for
everybody the rules do *not* match.
"""

from __future__ import annotations

MODES = ("screen_out", "qualify")
WHEN = ("live", "next")

# operator -> plain words, for the outline and the data dictionary
OP_WORDS = {
    "selected": "is", "not_selected": "is not",
    "any_of": "is any of", "none_of": "is none of",
    "all_of": "includes all of", "exactly": "is exactly",
    "count_gte": "selects at least", "count_lte": "selects at most",
    "count_eq": "selects exactly",
    # numbers read as the operator itself: "Q3 < 10"
    "eq": "=", "ne": "\u2260", "gt": ">", "gte": "\u2265", "lt": "<", "lte": "\u2264",
    "between": "is between", "not_between": "is outside",
    "contains": "mentions", "not_contains": "does not mention",
    "words_lt": "is shorter than",
    # rows, groups of rows and totals (constant sum / numeric matrix)
    "row_eq": "row =", "row_ne": "row \u2260", "row_gte": "row \u2265", "row_lte": "row \u2264",
    "row_gt": "row >", "row_lt": "row <",
    "row_between": "is between", "row_outside": "is outside",
    "sum_of_gte": "\u2265", "sum_of_lte": "\u2264",
    "sum_eq": "=", "sum_lt": "<", "sum_gt": ">", "sum_between": "is between",
    "total_eq": "total =", "total_ne": "total \u2260", "total_gte": "total \u2265",
    "total_lte": "total \u2264",
    "ranked_first": "ranks first", "ranked_top": "ranks in the top",
    # a grid row pointing at a column: "Q2: Ease of use is Column one"
    "cell_is": "is", "cell_not": "is not",
    "cell_includes": "includes", "cell_lacks": "does not include",
    # one number box of a rows x columns numeric matrix: "Q4: Treated x This year >= 40"
    "cell_gte": "is at least", "cell_lte": "is at most",
    "cell_gt": "is more than", "cell_lt": "is less than",
    "cell_eq": "is", "cell_ne": "is not", "cell_between": "is between",
    "answered": "was answered", "not_answered": "was skipped",
}


SUM_OPS = ("eq", "lt", "gt", "between")


def _num(value, default):
    """A hand-edited bound can be '' or 'abc' - fall back rather than crash."""
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return int(out) if out == int(out) else out


def _is_structured(screening: dict) -> bool:
    """A block the Individual / Sum builder owns - it has rows of its own."""
    return bool(screening.get("rows")) and screening.get("type") in ("individual", "sum")


def _structured_rules(screening: dict, q: dict) -> list[dict]:
    """The "Individual" / "Sum of responses" screener, written out as rules.

    Individual keeps a Min - Max band per answer and fires when any answer breaks
    its band; Sum of responses is one comparison over the whole group.
    """
    qid = q.get("id")
    rows = [str(r) for r in (screening.get("rows") or [])]
    if screening.get("type") == "sum":
        sum_ = screening.get("sum") or {}
        op = sum_.get("op") if sum_.get("op") in SUM_OPS else "eq"
        value = sum_.get("value")
        value = 0 if value is None or value == "" else value
        return [{"q": qid, "op": "sum_" + op, "value": ",".join(rows) + "=" + str(value)}]
    out = []
    for code in rows:
        low = (screening.get("min") or {}).get(code)
        high = (screening.get("max") or {}).get(code)
        if low is None and high is None:
            continue
        out.append({"q": qid,
                    "op": "row_between" if screening.get("outside") is False else "row_outside",
                    "value": "%s=%s-%s" % (code, _num(low, 0), _num(high, 100))})
    return out


def _codes(value) -> list[str]:
    return [str(v).strip() for v in str(value if value is not None else "").split(",")
            if str(v).strip()]


def _label(q: dict, code) -> str:
    for item in (q.get("options") or []) + (q.get("rows") or []):
        if str(item.get("code")) == str(code):
            return str(item.get("label") or code)
    return str(code)


def normalize(q: dict) -> dict:
    """Clean one question's screening block in place. Unknown fields are dropped so
    the stored config always matches what the builder can render."""
    if not isinstance(q, dict):
        return q
    s = q.get("screening")
    if not isinstance(s, dict):
        q.pop("screening", None)
        return q
    rules = [r for r in (s.get("rules") or []) if isinstance(r, dict) and r.get("q") and r.get("op")]
    rows = [str(r) for r in (s.get("rows") or [])]
    if not rules and not rows:
        # nothing authored - but an explicit off must survive the save, or the
        # legacy shorthand it mutes would switch itself back on
        if s.get("enabled") is False:
            q["screening"] = {"enabled": False}
        else:
            q.pop("screening", None)
        return q
    clean = []
    for r in rules:
        item = {"q": str(r.get("q")), "op": str(r.get("op"))}
        if r.get("value") is not None:
            item["value"] = r.get("value")
        clean.append(item)
    out = {
        "enabled": s.get("enabled") is not False,
        "mode": s.get("mode") if s.get("mode") in MODES else "screen_out",
        # a band per answer fires when any one of them breaks; everything else waits for all
        "match": ("any" if s.get("match") == "any" else "all") if s.get("match") in ("all", "any")
                 else ("any" if (rows and s.get("type") != "sum") else "all"),
        "when": s.get("when") if s.get("when") in WHEN else "live",
        "rules": clean,
    }
    # the Individual / Sum of responses screener keeps its own fields
    if rows:
        out["rows"] = rows
        out["type"] = "sum" if s.get("type") == "sum" else "individual"
        if out["type"] == "sum":
            sum_ = s.get("sum") or {}
            value = sum_.get("value")
            out["sum"] = {"op": sum_.get("op") if sum_.get("op") in SUM_OPS else "eq",
                          "value": _num(value, 0) if sum_.get("op") != "between" else str(value or "0-100")}
        else:
            lows, highs = {}, {}
            for code in rows:
                low = (s.get("min") or {}).get(code)
                high = (s.get("max") or {}).get(code)
                if low is not None or high is not None:
                    lows[code], highs[code] = _num(low, 0), _num(high, 100)
            out["min"], out["max"] = lows, highs
        if s.get("outside") is False:
            out["outside"] = False
    for key in ("message", "reason"):
        text = str(s.get(key) or "").strip()
        if text:
            out[key] = text
    q["screening"] = out
    return q


def blocks(q: dict) -> list[dict]:
    """Every screening block of a question: the authored one, then the legacy shorthand.

    The Studio on/off switch owns the whole feature: a block stored with
    ``enabled: False`` mutes the authored rules *and* the legacy shorthand, so
    nothing the question carries can fire while the switch is off.
    """
    out = []
    if not isinstance(q, dict):
        return out
    s = q.get("screening")
    if isinstance(s, dict) and s.get("enabled") is False:
        return out
    if isinstance(s, dict) and s.get("enabled") is not False:
        built = _structured_rules(s, q) if _is_structured(s) else []
        rules = built + [r for r in (s.get("rules") or [])]
        if rules:
            if built and s.get("type") == "sum":
                match = "all"                       # one sum test
            elif built:
                match = "all" if s.get("match") == "all" else "any"   # any answer off its band
            else:
                match = "any" if s.get("match") == "any" else "all"
            out.append({
                "mode": "qualify" if s.get("mode") == "qualify" else "screen_out",
                "match": match,
                "when": "next" if s.get("when") == "next" else "live",
                "rules": rules, "source": "rules",
            })
    marked = [o for o in (q.get("options") or []) if isinstance(o, dict) and o.get("terminate")]
    if marked:
        out.append({
            "mode": "screen_out", "match": "any", "when": "live", "source": "options",
            "rules": [{"q": q.get("id"), "op": "selected", "value": o.get("code")} for o in marked],
        })
    if q.get("terminate_if_lt") not in (None, ""):
        out.append({
            "mode": "screen_out", "match": "all", "when": "next", "source": "legacy",
            "rules": [{"q": q.get("id"), "op": "lt", "value": q["terminate_if_lt"]}],
        })
    return out


def _rule_text(rule: dict, questions: dict) -> str:
    q = questions.get(str(rule.get("q")), {})
    op = str(rule.get("op") or "")
    word = OP_WORDS.get(op, op)
    value = rule.get("value")
    if op in ("selected", "not_selected", "any_of", "none_of", "all_of", "exactly", "ranked_first"):
        joiner = " and " if op == "all_of" else ", "
        labels = [_label(q, c) for c in _codes(value)]
        value = joiner.join(labels) or "…"
    elif op == "ranked_top":
        head, _, n = str(value or "").partition("=")
        value = f"{_label(q, head)} (top {n})"
    elif op in ("row_between", "row_outside"):       # "a=10-60" -> one answer's Min - Max band
        head, _, tail = str(value or "").partition("=")
        low, _, high = tail.partition("-")
        joiner = " and " if op == "row_between" else " to "
        return f"{rule.get('q')}: {_label(q, head)} {word} {low or 0}{joiner}{high or 0}"
    elif op.startswith("sum_"):             # "a,b=80" -> what a group of rows adds up to
        head, _, tail = str(value or "").partition("=")
        names = " + ".join(_label(q, c) for c in _codes(head)) or "the rows"
        if op == "sum_between":
            low, _, high = tail.partition("-")
            return f"{rule.get('q')}: the sum of {names} is between {low or 0} and {high or 0}"
        return f"{rule.get('q')}: the sum of {names} {word} {tail or 0}"
    elif op in ("cell_gte", "cell_lte", "cell_gt", "cell_lt",
                "cell_eq", "cell_ne", "cell_between"):      # "a=c1=40" -> one number box
        head, _, tail = str(value or "").partition("=")
        colcode, _, num = tail.partition("=")
        col = next((c.get("label") or c.get("code") for c in (q.get("cols") or [])
                    if str(c.get("code")) == colcode), colcode or "…")
        if op == "cell_between":
            low, _, high = num.partition("-")
            return f"{rule.get('q')}: {_label(q, head)} \u00D7 {col} {word} {low or 0} and {high or 0}"
        value = f"{_label(q, head)} \u00D7 {col} {num}"
    elif op.startswith("cell_"):            # "a=c1" -> one grid row and the column it picked
        head, _, tail = str(value or "").partition("=")
        col = next((c.get("label") or c.get("code") for c in (q.get("cols") or [])
                    if str(c.get("code")) == tail), tail or "…")
        value = f"{_label(q, head)} {col}"
    elif op.startswith("row_"):
        head, _, tail = str(value or "").partition("=")
        value = f"{_label(q, head)} {tail}"
    elif op in ("between", "not_between"):
        halves = str(value or "").split("-")
        value = " and ".join(halves) if op == "between" else " – ".join(halves)
    elif op == "words_lt":
        value = f"{value} words"
    return f"{rule.get('q')} {word} {value}".strip()


def describe(q: dict, questions: list | None = None) -> list[str]:
    """One plain-English line per screening block, or [] when nothing screens here."""
    index = {str(x.get("id")): x for x in (questions or []) if isinstance(x, dict)}
    index.setdefault(str(q.get("id")), q if isinstance(q, dict) else {})
    out = []
    for b in blocks(q):
        joiner = " or " if b["match"] == "any" else " and "
        text = joiner.join(_rule_text(r, index) for r in b["rules"])
        lead = "carry on only when " if b["mode"] == "qualify" else "screen out when "
        out.append(lead + text)
    return out
