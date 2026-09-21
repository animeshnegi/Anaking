"""
Globalisation: one study, many respondent languages.

A study is authored once in its default language (``cfg["language"]``, default
``en-US``) and can be *globalised* into any language from :data:`LANGUAGES`.  Only
**respondent-visible** strings are translatable - question stems, option and row
labels, section titles, the welcome / thank-you pages, walkthrough scene captions,
placeholders - while everything aimed at the research team (Studio labels, QC notes,
data-dictionary text) stays in the default language by construction, because only the
respondent strings are ever extracted.

Translations live on the study config:

    cfg["translations"] = {"es": {"q:Q1:stem": "…", "q:Q1:opt:1": "…", …}, …}

Keys are stable paths produced by :func:`extract_strings`; :func:`apply_language`
returns a copy of the config with one language merged in (missing strings fall back
to the default language, so a half-translated study still renders).  Rich-text fields
are translated as whole HTML strings; the machine translator in core.translator knows
how to translate only the text between the tags.
"""

from __future__ import annotations

import copy
import re

DEFAULT_LANGUAGE = "en-US"

# Globally approved field languages: code, English name, native name, reading direction.
LANGUAGES = [
    ("en-US", "English (US)", "English (US)", "ltr"),
    ("en-GB", "English (UK)", "English (UK)", "ltr"),
    ("es", "Spanish", "Español", "ltr"),
    ("es-MX", "Spanish (Mexico)", "Español (México)", "ltr"),
    ("fr", "French", "Français", "ltr"),
    ("fr-CA", "French (Canada)", "Français (Canada)", "ltr"),
    ("de", "German", "Deutsch", "ltr"),
    ("it", "Italian", "Italiano", "ltr"),
    ("pt", "Portuguese", "Português", "ltr"),
    ("pt-BR", "Portuguese (Brazil)", "Português (Brasil)", "ltr"),
    ("nl", "Dutch", "Nederlands", "ltr"),
    ("pl", "Polish", "Polski", "ltr"),
    ("ru", "Russian", "Русский", "ltr"),
    ("uk", "Ukrainian", "Українська", "ltr"),
    ("tr", "Turkish", "Türkçe", "ltr"),
    ("ar", "Arabic", "العربية", "rtl"),
    ("he", "Hebrew", "עברית", "rtl"),
    ("hi", "Hindi", "हिन्दी", "ltr"),
    ("bn", "Bengali", "বাংলা", "ltr"),
    ("ur", "Urdu", "اردو", "rtl"),
    ("zh-CN", "Chinese (Simplified)", "简体中文", "ltr"),
    ("zh-TW", "Chinese (Traditional)", "繁體中文", "ltr"),
    ("ja", "Japanese", "日本語", "ltr"),
    ("ko", "Korean", "한국어", "ltr"),
    ("th", "Thai", "ไทย", "ltr"),
    ("vi", "Vietnamese", "Tiếng Việt", "ltr"),
    ("id", "Indonesian", "Bahasa Indonesia", "ltr"),
    ("ms", "Malay", "Bahasa Melayu", "ltr"),
    ("sv", "Swedish", "Svenska", "ltr"),
    ("da", "Danish", "Dansk", "ltr"),
    ("nb", "Norwegian", "Norsk", "ltr"),
    ("fi", "Finnish", "Suomi", "ltr"),
    ("el", "Greek", "Ελληνικά", "ltr"),
    ("cs", "Czech", "Čeština", "ltr"),
    ("sk", "Slovak", "Slovenčina", "ltr"),
    ("hu", "Hungarian", "Magyar", "ltr"),
    ("ro", "Romanian", "Română", "ltr"),
]
LANG_BY_CODE = {code: {"code": code, "name": name, "native": native, "dir": d}
                for code, name, native, d in LANGUAGES}


def default_language(cfg: dict) -> str:
    return cfg.get("language") or DEFAULT_LANGUAGE


def study_languages(cfg: dict) -> list[str]:
    """Default language first, then every language with at least one translation."""
    langs = [default_language(cfg)]
    for code in (cfg.get("translations") or {}):
        if code not in langs:
            langs.append(code)
    return langs


# ======================================================================================
# EXTRACTION - the respondent-visible strings, as stable (key, text) pairs
# ======================================================================================
def _put(out: list, key: str, text, kind: str, qid: str | None = None) -> None:
    if isinstance(text, str) and text.strip():
        out.append({"key": key, "text": text, "kind": kind,
                    **({"qid": qid} if qid else {})})


def extract_strings(cfg: dict) -> list[dict]:
    """Every respondent-visible string in the study, in authoring order.

    Each entry is ``{key, text, kind, qid?}`` where ``kind`` is one of ``study``,
    ``section``, ``question``, ``option``, ``row``, ``scale``, ``scene``.  Team-facing
    strings are never listed, so they can never be translated.
    """
    out: list[dict] = []
    _put(out, "study:welcome_title", cfg.get("welcome_title"), "study")
    _put(out, "study:welcome_text", cfg.get("welcome_text"), "study")
    _put(out, "study:thanks_title", cfg.get("thanks_title"), "study")
    _put(out, "study:thanks_text", cfg.get("thanks_text"), "study")
    for s in cfg.get("sections", []) or []:
        _put(out, f"sec:{s.get('id')}:title", s.get("title"), "section")
    for i, sc in enumerate(cfg.get("explainer_scenes", []) or []):
        _put(out, f"scene:{i}:title", sc.get("title"), "scene")
        _put(out, f"scene:{i}:caption", sc.get("caption"), "scene")
    cs = cfg.get("conjoint_scene") or {}
    _put(out, "conjoint_scene:title", cs.get("title"), "scene")
    _put(out, "conjoint_scene:caption", cs.get("caption"), "scene")
    for q in cfg.get("questions", []) or []:
        qid = q.get("id")
        _put(out, f"q:{qid}:stem_html", q.get("stem_html"), "question", qid)
        if not q.get("stem_html"):
            _put(out, f"q:{qid}:stem", q.get("stem"), "question", qid)
        _put(out, f"q:{qid}:help", q.get("help"), "question", qid)
        _put(out, f"q:{qid}:placeholder", q.get("placeholder"), "question", qid)
        _put(out, f"q:{qid}:vignette", q.get("vignette"), "question", qid)
        _put(out, f"q:{qid}:concept_html", q.get("concept_html"), "question", qid)
        if not q.get("concept_html"):
            _put(out, f"q:{qid}:concept", q.get("concept"), "question", qid)
        _put(out, f"q:{qid}:body_html", q.get("body_html"), "question", qid)
        if not q.get("body_html"):
            _put(out, f"q:{qid}:body", q.get("body"), "question", qid)
        for o in q.get("options", []) or []:
            _put(out, f"q:{qid}:opt:{o.get('code')}", o.get("label"), "option", qid)
        for r in q.get("rows", []) or []:
            _put(out, f"q:{qid}:row:{r.get('code')}", r.get("label"), "row", qid)
        for c in q.get("cols", []) or []:
            _put(out, f"q:{qid}:col:{c.get('code')}", c.get("label"), "row", qid)
        sc_ = q.get("scale") or {}
        _put(out, f"q:{qid}:min_label", sc_.get("min_label"), "scale", qid)
        _put(out, f"q:{qid}:max_label", sc_.get("max_label"), "scale", qid)
        for i, fl in enumerate(sc_.get("face_labels", []) or []):
            _put(out, f"q:{qid}:face:{i}", fl, "scale", qid)
        _put(out, f"q:{qid}:before_label", q.get("before_label"), "scale", qid)
        _put(out, f"q:{qid}:after_label", q.get("after_label"), "scale", qid)
        for it in q.get("items", []) or []:
            _put(out, f"q:{qid}:loopitem:{it.get('code')}", it.get("label"), "row", qid)
    return out


# ======================================================================================
# APPLICATION - merge one language over the default config
# ======================================================================================
def _set(cfg: dict, key: str, value: str) -> bool:
    """Write ``value`` at the path named by ``key``. Returns True when the path exists."""
    where, rest = (key.split(":", 1) + [""])[:2]
    if where == "study":
        if rest in cfg:
            cfg[rest] = value
            return True
        return False
    if where == "sec":
        sid, field = rest.split(":")
        for s in cfg.get("sections", []) or []:
            if s.get("id") == sid:
                s[field] = value
                return True
        return False
    if where == "scene":
        i, field = rest.split(":")
        scenes = cfg.get("explainer_scenes", []) or []
        if 0 <= int(i) < len(scenes):
            scenes[int(i)][field] = value
            return True
        return False
    if where == "conjoint_scene":
        cs = cfg.get("conjoint_scene")
        if cs is not None:
            cs[rest] = value
            return True
        return False
    if where == "q":
        parts = rest.split(":")
        qid, field = parts[0], parts[1]
        q = next((x for x in cfg.get("questions", []) or [] if x.get("id") == qid), None)
        if q is None:
            return False
        if field in ("stem", "stem_html", "help", "placeholder", "vignette",
                     "concept", "concept_html", "body", "body_html", "min_label",
                     "max_label", "before_label", "after_label"):
            if field in ("min_label", "max_label", "before_label", "after_label"):
                if field in ("min_label", "max_label"):
                    q.setdefault("scale", {})[field] = value
                else:
                    q[field] = value
            else:
                q[field] = value
            return True
        if field == "opt" and len(parts) == 3:
            o = next((x for x in q.get("options", []) or []
                      if str(x.get("code")) == parts[2]), None)
            if o is not None:
                o["label"] = value
                return True
        if field == "row" and len(parts) == 3:
            r = next((x for x in q.get("rows", []) or []
                      if str(x.get("code")) == parts[2]), None)
            if r is not None:
                r["label"] = value
                return True
        if field == "col" and len(parts) == 3:
            c = next((x for x in q.get("cols", []) or []
                      if str(x.get("code")) == parts[2]), None)
            if c is not None:
                c["label"] = value
                return True
        if field == "face" and len(parts) == 3:
            fl = q.get("scale", {}).get("face_labels") or []
            if 0 <= int(parts[2]) < len(fl):
                fl[int(parts[2])] = value
                return True
        if field == "loopitem" and len(parts) == 3:
            it = next((x for x in q.get("items", []) or []
                       if str(x.get("code")) == parts[2]), None)
            if it is not None:
                it["label"] = value
                return True
    return False


def apply_language(cfg: dict, lang: str | None) -> dict:
    """A copy of ``cfg`` with ``lang`` merged over the default language.

    Unknown languages, or strings with no translation, fall back to the default text.
    """
    out = copy.deepcopy(cfg)
    lang = lang or default_language(cfg)
    if lang == default_language(cfg):
        return out
    table = (cfg.get("translations") or {}).get(lang) or {}
    for key, value in table.items():
        if isinstance(value, str) and value.strip():
            _set(out, key, value)
    out["language"] = default_language(cfg)          # remember the authoring language
    out["render_language"] = lang
    out["render_dir"] = LANG_BY_CODE.get(lang, {}).get("dir", "ltr")
    return out


def coverage(cfg: dict, lang: str) -> dict:
    """Translation completeness of one language over the extractable strings."""
    strings = extract_strings(cfg)
    table = (cfg.get("translations") or {}).get(lang) or {}
    done = [s for s in strings if (table.get(s["key"]) or "").strip()]
    return {"language": lang, "total": len(strings), "translated": len(done),
            "missing": [s["key"] for s in strings if not (table.get(s["key"]) or "").strip()],
            "pct": round(100 * len(done) / len(strings), 1) if strings else 100}


SAFE_LANG = re.compile(r"^[a-z]{2,3}(-[A-Za-z]{2,4})?$")


def valid_language(code: str) -> bool:
    return bool(code) and code in LANG_BY_CODE or bool(SAFE_LANG.fullmatch(code or ""))
