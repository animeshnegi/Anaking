"""
Machine translation for the Globalize-survey flow.

The platform ships with no model of its own, so "AI translate" calls a public
neural machine-translation endpoint (Google's keyless ``gtx`` service) server-side.
The network hop is isolated behind a ``fetcher`` argument so tests can inject a fake,
and every failure raises :class:`TranslationError` - the Studio then simply leaves the
string for manual translation, which is always available and never requires the
network.  Only respondent-visible strings are ever sent out: they come from
:func:`core.i18n.extract_strings`, the same list the manual editor uses.

Rich text is translated tag-safely: the HTML is split into tags and text nodes and
only the text nodes travel, so formatting survives the round trip.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request

URL = ("https://translate.googleapis.com/translate_a/single?client=gtx&dt=t"
       "&sl={sl}&tl={tl}&q={q}")
TIMEOUT = 8          # seconds; a slow translator must never hang the Studio
MAX_CHARS = 1500     # one answer-length string per request


class TranslationError(Exception):
    """The machine translator could not serve this string right now."""


def _default_fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Anaking-studio/3"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read().decode("utf-8")


def _decode(payload: str) -> str:
    """The gtx endpoint returns nested arrays; segment [i][0] is the translated text."""
    try:
        data = json.loads(payload)
    except (ValueError, TypeError) as e:
        raise TranslationError("translator returned an unreadable response") from e
    parts = []
    try:
        for segment in data[0]:
            if isinstance(segment, (list, tuple)) and segment and segment[0]:
                parts.append(str(segment[0]))
    except (IndexError, TypeError) as e:
        raise TranslationError("translator returned an unexpected shape") from e
    out = "".join(parts).strip()
    if not out:
        raise TranslationError("translator returned no text")
    return out


# Offline English-variant localisation.  When the target is another English flavour
# (en-GB, en-AU, ...) we never need the network: a deterministic spelling pass turns
# US spellings into the target flavour.  This keeps "AI-translate" genuinely useful
# for English regional studies even where no translation service is reachable.
_IZE_KEEP = {"size", "sizes", "sized", "sizing", "prize", "prizes", "prized",
             "seize", "seizes", "seized", "seizing", "capsize", "capsized"}
_OUR_BASE = ("color", "favor", "honor", "labor", "humor", "rumor", "odor", "flavor",
             "behavior", "neighbor", "harbor", "savor", "vapor", "ardor", "fervor",
             "clamor", "endeavor", "armor")
_OUR_SUFFIX = ("", "s", "ed", "ing", "ite", "ites", "able", "ably", "less", "ful",
               "fully", "ism")
_RE_WORDS = {"center": "centre", "centers": "centres", "theater": "theatre",
             "theaters": "theatres", "fiber": "fibre", "fibers": "fibres",
             "liter": "litre", "liters": "litres", "maneuver": "manoeuvre",
             "maneuvers": "manoeuvres", "gray": "grey", "grays": "greys"}


def localize_english(text: str, target: str) -> str:
    """US -> other-English spelling localisation (offline, deterministic)."""
    def ize(m):
        base, suf = m.group(1), m.group(2)
        if (base + suf).lower() in _IZE_KEEP:
            return base + suf
        return base + suf.replace("z", "s")

    def our(m):
        base = m.group(1)[:-2] + "our"          # color -> colour, honored -> honoured
        if m.group(1)[0].isupper():
            base = base[0].upper() + base[1:]
        return base + m.group(2)

    out = re.sub(r"\b([A-Za-z]+?)(ize|izes|ized|izing|ization|izations)\b", ize, text)
    pat = (r"\b(" + "|".join(_OUR_BASE) + r")(" +
           "|".join(sorted(_OUR_SUFFIX, key=len, reverse=True)) + r")\b")
    out = re.sub(pat, our, out, flags=re.IGNORECASE)
    out = re.sub(r"\b([A-Za-z]+?)yze(s|d)?\b",
                 lambda m: m.group(1) + "yse" + (m.group(2) or ""), out)
    out = re.sub(r"\b(catalog|analog|dialog|monolog|prolog|epilog)(ue)?(s)?\b",
                 lambda m: m.group(1) + "ue" + ("s" if m.group(3) else ""), out)
    out = re.sub(r"\b(travel|marvel)(ed|ing|er|ers)\b",
                 lambda m: m.group(1) + m.group(1)[-1] + m.group(2), out)
    for us, uk in _RE_WORDS.items():
        out = re.sub(r"\b%s\b" % us, uk, out, flags=re.IGNORECASE)
    return out


def machine_translate(text: str, target: str, source: str = "en",
                       fetcher=None) -> str:
    """Translate one plain-text string. Raises :class:`TranslationError` on any failure."""
    text = (text or "").strip()
    if not text:
        return ""
    if source.split("-")[0] == "en" and target.startswith("en-") and target != source:
        return localize_english(text, target)
    if len(text) > MAX_CHARS:
        raise TranslationError(f"string longer than {MAX_CHARS} characters - translate by hand")
    url = URL.format(sl=urllib.parse.quote(source.split("-")[0]),
                     tl=urllib.parse.quote(target.split("-")[0]),
                     q=urllib.parse.quote(text))
    fetch = fetcher or _default_fetch
    try:
        return _decode(fetch(url))
    except TranslationError:
        raise
    except Exception as e:                      # network down, blocked, DNS, HTTP error…
        raise TranslationError(f"machine translation unavailable ({e.__class__.__name__})") from e


TAG_SPLIT = re.compile(r"(<[^>]+>)")


def translate_html(html: str, target: str, source: str = "en", fetcher=None) -> str:
    """Translate only the text nodes of a rich-text string, keeping every tag in place."""
    out, pending, joined = [], [], []

    def flush():
        if not pending:
            return
        # one request per run of adjacent text nodes keeps tags where they were
        blob = "\n".join(joined)
        done = machine_translate(blob, target, source, fetcher)
        lines = done.split("\n")
        for i, node in enumerate(pending):
            out.append(lines[i] if i < len(lines) else done)
        pending.clear(), joined.clear()

    for token in TAG_SPLIT.split(str(html)):
        if token.startswith("<") and token.endswith(">"):
            flush()
            out.append(token)
        elif token.strip():
            pending.append(token)
            joined.append(token)
        else:
            out.append(token)
    flush()
    return "".join(out)


def translate_string(text: str, target: str, source: str = "en",
                     fetcher=None, html: bool = False) -> str:
    return (translate_html(text, target, source, fetcher) if html
            else machine_translate(text, target, source, fetcher))
