"""
"Download Word Outline" - a client-circulation .docx of any study, written with the
standard library only (the platform has no python-docx dependency).

The document is deliberately lean and easy to edit in Word: one heading per section,
one bold line per question, its answer options / rows as a bulleted list, and the
applied logic (show-if conditions, screening / termination) in plain words right under
the question.  Nothing else - no welcome copy, no metrics, no team notes.  Pass
``lang`` to render a translated (child) version of the same questionnaire.
"""

from __future__ import annotations

import io
import re
import zipfile
from xml.sax.saxutils import escape

from .i18n import apply_language

_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

_OP_WORDS = {"selected": "has selected", "not_selected": "has not selected",
             "any_of": "has selected any of", "none_of": "has selected none of",
             "eq": "=", "ne": "\u2260", "gt": ">", "gte": "\u2265", "lt": "<", "lte": "\u2264"}


def _run(text: str, bold: bool = False, size: int = 21, muted: bool = False,
         italic: bool = False) -> str:
    rpr = ("<w:rPr>" + ("<w:b/>" if bold else "") + ("<w:i/>" if italic else "") +
           f"<w:sz w:val=\"{size}\"/>" +
           ("<w:color w:val=\"5A5A5A\"/>" if muted else "") + "</w:rPr>")
    return f"<w:r>{rpr}<w:t xml:space=\"preserve\">{escape(text or '')}</w:t></w:r>"


def _para(runs: str, after: int = 120, indent: int = 0) -> str:
    ind = f"<w:ind w:left=\"{indent}\"/>" if indent else ""
    return (f"<w:p><w:pPr><w:spacing w:after=\"{after}\"/>{ind}</w:pPr>{runs}</w:p>")


def _strip(html: str) -> str:
    return re.sub(r"<[^>]+>", "", html or "")


def _logic_line(q: dict) -> str:
    """Show-if / screening logic as one plain-English line, or ''."""
    parts = []
    si = q.get("show_if") or {}
    rules = si.get("rules") or []
    if rules:
        join = " AND " if si.get("match", "all") == "all" else " OR "
        txt = join.join(
            f"{r.get('q')} {_OP_WORDS.get(r.get('op'), r.get('op'))} {r.get('value', '')}".strip()
            for r in rules)
        if si.get("negate"):
            txt = "NOT (" + txt + ")"
        parts.append("Show only if " + txt)
    if any(o.get("terminate") for o in q.get("options", []) or []):
        parts.append("screening: options marked TERMINATES end the survey")
    return "  \u00B7  ".join(parts)


def _question_paras(q: dict) -> list[str]:
    out = []
    stem = _strip(q.get("stem_html")) or q.get("stem") or _strip(q.get("concept_html")) \
        or q.get("concept") or _strip(q.get("body_html")) or q.get("body") or "(no text)"
    out.append(_para(_run(f"{q.get('id')}.  ", bold=True) + _run(stem, bold=True),
                     after=60))
    logic = _logic_line(q)
    if logic:
        out.append(_para(_run("Logic: " + logic, muted=True, italic=True, size=18),
                         after=60, indent=240))
    for o in q.get("options", []) or []:
        tags = ""
        if o.get("terminate"):
            tags += "  [TERMINATES]"
        if o.get("exclusive"):
            tags += "  [exclusive]"
        if o.get("other"):
            tags += "  [other - please specify]"
        out.append(_para(_run(f"-  {o.get('code')}. {o.get('label')}{tags}", size=19),
                         after=40, indent=480))
    for r in q.get("rows", []) or []:
        extra = f"  ({r.get('left')} \u2194 {r.get('right')})" if r.get("left") else ""
        out.append(_para(_run(f"-  {r.get('label')}{extra}", size=19), after=40, indent=480))
    for c in q.get("cols", []) or []:
        out.append(_para(_run(f"-  column: {c.get('label')}", size=19, muted=True),
                         after=40, indent=480))
    sc = q.get("scale") or {}
    if sc:
        ends = ""
        if sc.get("min_label") or sc.get("max_label"):
            ends = f"  ({sc.get('min_label', '')} \u2026 {sc.get('max_label', '')})"
        out.append(_para(_run(f"-  scale {sc.get('min', 1)}\u2013{sc.get('max', 7)}{ends}",
                              size=19, muted=True), after=40, indent=480))
    for it in q.get("items", []) or []:
        out.append(_para(_run(f"-  loop over: {it.get('label')}", size=19), after=40,
                         indent=480))
    out.append(_para("", after=160))          # breathing room between questions
    return out


def build_outline(study_cfg: dict, lang: str | None = None) -> bytes:
    cfg = apply_language(study_cfg, lang)
    body = [_para(_run(cfg.get("title", "Study"), bold=True, size=32), after=40),
            _para(_run("Questionnaire outline" +
                       (f" \u2013 {lang}" if lang and lang != cfg.get("language") else ""),
                       muted=True, size=18), after=240)]
    sec_titles = {s.get("id"): s.get("title") for s in cfg.get("sections", []) or []}
    for sec_id in dict.fromkeys(q.get("section") for q in cfg.get("questions", []) or []):
        qs = [q for q in cfg.get("questions", []) or [] if q.get("section") == sec_id]
        if not qs:
            continue
        body.append(_para(_run(sec_titles.get(sec_id, sec_id) or sec_id, bold=True,
                               size=26), after=120))
        for q in qs:
            body.extend(_question_paras(q))

    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                "<w:body>" + "".join(body) +
                "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/>"
                "<w:pgMar w:top=\"1134\" w:bottom=\"1134\" w:left=\"1134\" w:right=\"1134\"/>"
                "</w:sectPr></w:body></w:document>")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CONTENT_TYPES)
        z.writestr("_rels/.rels", _RELS)
        z.writestr("word/document.xml", document)
    return buf.getvalue()
