"""
"Download Word Outline" - a real .docx questionnaire outline for any study, written
with the standard library only (the platform has no python-docx dependency).

The document is what a client circulates for review: sections, every question with
its type, required/min-word notes, answer options, rows and scales, show-if logic in
plain words, and the welcome / thank-you copy.  Pass ``lang`` to render a globalised
version - respondent strings are merged from the study's translations first.
"""

from __future__ import annotations

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

_TYPE_NAMES = {
    "single_select": "Single choice", "multi_select": "Multiple choice",
    "rating_grid": "Rating grid", "semantic_diff": "Semantic differential",
    "emoji_grid": "Emoji scale", "sum_to_100": "Allocate to 100", "heatmap": "Heat map",
    "rank": "Rank order", "maxdiff": "Max-diff", "choice_task": "Conjoint choice task",
    "nps": "Net promoter score", "numeric": "Numeric entry", "slider": "Scale / slider",
    "open_text": "Text entry", "date": "Date", "numeric_matrix": "Numeric matrix",
    "delta": "Delta (before / after)", "concept_test": "Concept test",
    "text_block": "Text block", "loop": "Question loop",
}


def _run(text: str, bold: bool = False, size: int = 20, muted: bool = False) -> str:
    rpr = "<w:rPr>" + ("<w:b/>" if bold else "") + f"<w:sz w:val=\"{size}\"/>" + \
          ("<w:color w:val=\"5A5A5A\"/>" if muted else "") + "</w:rPr>"
    return f"<w:r>{rpr}<w:t xml:space=\"preserve\">{escape(text or '')}</w:t></w:r>"


def _para(runs: str, space_after: int = 120) -> str:
    return (f"<w:p><w:pPr><w:spacing w:after=\"{space_after}\"/></w:pPr>{runs}</w:p>")


def _question_lines(q: dict) -> list[str]:
    paras = []
    meta = [_TYPE_NAMES.get(q.get("type"), q.get("type", ""))]
    if q.get("required"):
        meta.append("required")
    if q.get("min_words"):
        meta.append(f"min {q['min_words']} words")
    if q.get("show_if", {}).get("rules"):
        rules = " AND " if q["show_if"].get("match", "all") == "all" else " OR "
        meta.append("shown when " + rules.join(
            f"{r.get('q')} {r.get('op')} {r.get('value', '')}".strip()
            for r in q["show_if"]["rules"]))
    paras.append(_para(_run(f"{q.get('id')}.  ", bold=True) +
                       _run(q.get("stem_html") and _strip(q.get("stem_html")) or
                            q.get("stem") or q.get("concept") or "(text block)", bold=True) +
                       _run("   [" + "; ".join(meta) + "]", muted=True, size=16)))
    if q.get("type") == "text_block":
        return paras
    for o in q.get("options", []) or []:
        extra = ("  (TERMINATES)" if o.get("terminate") else "") + \
                ("  (exclusive)" if o.get("exclusive") else "") + \
                ("  (other, please specify)" if o.get("other") else "")
        paras.append(_para(_run(f"    {o.get('code')}. {o.get('label')}{extra}", size=18), 60))
    for r in q.get("rows", []) or []:
        paras.append(_para(_run(f"    - {r.get('label')}", size=18), 60))
    if q.get("scale"):
        sc = q["scale"]
        paras.append(_para(_run(f"    scale {sc.get('min', 1)}-{sc.get('max', 7)}"
                                + (f" ({sc['min_label']} … {sc['max_label']})"
                                   if sc.get("min_label") else ""), muted=True, size=16), 60))
    if q.get("items"):
        for it in q["items"]:
            paras.append(_para(_run(f"    loop over: {it.get('label')}", size=18), 60))
    return paras


def _strip(html: str) -> str:
    import re as _re
    return _re.sub(r"<[^>]+>", "", html or "")


def build_outline(study_cfg: dict, lang: str | None = None) -> bytes:
    cfg = apply_language(study_cfg, lang)
    body = [_para(_run(cfg.get("title", "Study"), bold=True, size=32)),
           _para(_run("Questionnaire outline" +
                      (f" - language {lang}" if lang and lang != cfg.get("language") else ""),
                      muted=True, size=18))]
    if cfg.get("welcome_title") or cfg.get("welcome_text"):
        body.append(_para(_run("Welcome: ", bold=True) +
                          _run(cfg.get("welcome_text") or cfg.get("welcome_title") or "")))
    sec_titles = {s.get("id"): s.get("title") for s in cfg.get("sections", []) or []}
    for sec_id in dict.fromkeys(q.get("section") for q in cfg.get("questions", []) or []):
        qs = [q for q in cfg.get("questions", []) or [] if q.get("section") == sec_id]
        if not qs:
            continue
        body.append(_para(_run(f"SECTION - {sec_titles.get(sec_id, sec_id)}",
                               bold=True, size=24)))
        for q in qs:
            body.extend(_question_lines(q))
    if cfg.get("thanks_title") or cfg.get("thanks_text"):
        body.append(_para(_run("Thank-you: ", bold=True) +
                          _run(cfg.get("thanks_text") or cfg.get("thanks_title") or "")))

    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                "<w:body>" + "".join(body) +
                "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/>"
                "<w:pgMar w:top=\"1134\" w:bottom=\"1134\" w:left=\"1134\" w:right=\"1134\"/>"
                "</w:sectPr></w:body></w:document>")

    import io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CONTENT_TYPES)
        z.writestr("_rels/.rels", _RELS)
        z.writestr("word/document.xml", document)
    return buf.getvalue()
