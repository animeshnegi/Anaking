"""
Whitelist HTML sanitiser for rich question text written in the Studio.

Studio authors can format a question stem (bold, colour, highlight, lists, size, font).
That HTML is rendered in respondents' browsers, so everything outside a small whitelist
of tags, attributes and CSS properties is stripped here - on save - and again on the
client before rendering.
"""

from __future__ import annotations

import re
from html import escape
from html.parser import HTMLParser

ALLOWED_TAGS = {"b", "strong", "i", "em", "u", "s", "span", "mark", "sup", "sub", "br",
                "p", "div", "ul", "ol", "li", "a", "font"}
VOID_TAGS = {"br"}
ALLOWED_STYLE = {"color", "background-color", "font-family", "font-size", "font-weight",
                 "font-style", "text-decoration", "text-align"}
STYLE_VALUE = re.compile(r"^[#a-zA-Z0-9 ,.%()'\"-]+$")
PIPE_TOKEN = re.compile(r"\{[A-Za-z0-9_]+(?:\.[A-Za-z0-9_:]+)?\}")


def _clean_style(value: str) -> str:
    out = []
    for decl in value.split(";"):
        if ":" not in decl:
            continue
        prop, val = decl.split(":", 1)
        prop, val = prop.strip().lower(), val.strip()
        if prop in ALLOWED_STYLE and val and STYLE_VALUE.match(val) and "url(" not in val.lower():
            out.append(f"{prop}: {val}")
    return "; ".join(out)


class _Cleaner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.open: list[str] = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag not in ALLOWED_TAGS:
            return
        keep = []
        for k, v in attrs:
            k = (k or "").lower()
            v = v or ""
            if k == "style":
                v = _clean_style(v)
                if v:
                    keep.append(f'style="{escape(v, quote=True)}"')
            elif tag == "a" and k == "href" and re.match(r"^(https?:)?//|^mailto:", v.strip(), re.I):
                keep.append(f'href="{escape(v.strip(), quote=True)}" target="_blank" rel="noopener"')
            elif tag == "font" and k in ("color", "face", "size") and STYLE_VALUE.match(v):
                keep.append(f'{k}="{escape(v, quote=True)}"')
            elif k == "class" and re.fullmatch(r"[a-zA-Z0-9_ -]+", v):
                keep.append(f'class="{v}"')
        self.out.append("<" + tag + (" " + " ".join(keep) if keep else "") + ">")
        if tag not in VOID_TAGS:
            self.open.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ALLOWED_TAGS and tag not in VOID_TAGS and tag in self.open:
            # close anything opened after it too, keeping the tree well-formed
            while self.open:
                t = self.open.pop()
                self.out.append(f"</{t}>")
                if t == tag:
                    break

    def handle_data(self, data):
        self.out.append(escape(data, quote=False))

    def result(self) -> str:
        while self.open:
            self.out.append(f"</{self.open.pop()}>")
        return "".join(self.out)


def clean_html(html: str | None) -> str:
    """Return ``html`` reduced to the whitelist (empty string for falsy input)."""
    if not html:
        return ""
    p = _Cleaner()
    p.feed(str(html))
    p.close()
    out = p.result().strip()
    # the Studio wraps piping tokens in <span class="pipe"> chips - respondents get plain tokens
    out = re.sub(r'<span class="pipe">(\{[^}]+\})</span>(?:&nbsp;|\xa0)?', r"\1 ", out)
    return out.strip()


def strip_tags(html: str | None) -> str:
    """Plain-text version of rich text (for exports, narration and search)."""
    if not html:
        return ""
    text = re.sub(r"<br\s*/?>|</(p|div|li)>", "\n", str(html), flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    from html import unescape
    return unescape(text).strip()


def sanitize_question(q: dict) -> dict:
    """Clean the rich-text fields of one question config in place and return it."""
    for key in ("stem_html", "help_html"):
        if q.get(key):
            q[key] = clean_html(q[key])
            if not strip_tags(q[key]):
                q.pop(key, None)
    # keep the plain stem in step with the rich one so exports/TTS never see markup
    if q.get("stem_html"):
        plain = strip_tags(q["stem_html"])
        if plain:
            q["stem"] = plain
    return q
