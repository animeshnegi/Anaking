/* BEACON question logic shared by the respondent survey and the Studio preview.
 *
 *   BeaconQ.sanitize(html)             whitelist rich text (mirrors core/sanitize.py)
 *   BeaconQ.pipe(text, ctx)            replace {Q1} {Q1.text} {Q1.opt:3} ... with answers
 *   BeaconQ.richInto(el, html, ctx)    sanitize + pipe + inject as DOM
 *   BeaconQ.showIf(q, ctx)             evaluate q.show_if -> true/false
 *   BeaconQ.order(list, q, seed)       apply q.randomize to options / rows (pinned kept)
 *   BeaconQ.sampleAnswers(questions)   plausible answers for every question (preview/piping)
 *
 * ctx = { answers: {qid: {...}}, questions: [...] }
 */
(function () {
  "use strict";

  var TAGS = { b: 1, strong: 1, i: 1, em: 1, u: 1, s: 1, span: 1, mark: 1, sup: 1, sub: 1, br: 1,
               p: 1, div: 1, ul: 1, ol: 1, li: 1, a: 1, font: 1 };
  var STYLE = { "color": 1, "background-color": 1, "font-family": 1, "font-size": 1, "font-weight": 1,
                "font-style": 1, "text-decoration": 1, "text-align": 1 };
  var STYLE_VAL = /^[#a-zA-Z0-9 ,.%()'"-]+$/;

  function cleanStyle(v) {
    var out = [];
    String(v || "").split(";").forEach(function (d) {
      var i = d.indexOf(":"); if (i < 0) return;
      var p = d.slice(0, i).trim().toLowerCase(), val = d.slice(i + 1).trim();
      if (STYLE[p] && val && STYLE_VAL.test(val) && val.toLowerCase().indexOf("url(") < 0) out.push(p + ": " + val);
    });
    return out.join("; ");
  }

  function sanitizeNode(node, doc) {
    // returns a clean clone (or a text node / fragment) of node
    if (node.nodeType === 3) return doc.createTextNode(node.nodeValue);
    if (node.nodeType !== 1) return null;
    var tag = node.tagName.toLowerCase();
    var out;
    if (TAGS[tag]) {
      out = doc.createElement(tag);
      var st = node.getAttribute("style");
      if (st) { st = cleanStyle(st); if (st) out.setAttribute("style", st); }
      if (tag === "a") {
        var href = (node.getAttribute("href") || "").trim();
        if (/^(https?:)?\/\/|^mailto:/i.test(href)) {
          out.setAttribute("href", href); out.setAttribute("target", "_blank"); out.setAttribute("rel", "noopener");
        }
      }
      if (tag === "font") {
        ["color", "face", "size"].forEach(function (a) {
          var v = node.getAttribute(a); if (v && STYLE_VAL.test(v)) out.setAttribute(a, v);
        });
      }
      var cls = node.getAttribute("class");
      if (cls && /^[a-zA-Z0-9_ -]+$/.test(cls)) out.setAttribute("class", cls);
    } else if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object" || tag === "embed") {
      return null;
    } else {
      out = doc.createDocumentFragment();       // unknown tag: keep its children only
    }
    for (var c = node.firstChild; c; c = c.nextSibling) {
      var k = sanitizeNode(c, doc); if (k) out.appendChild(k);
    }
    return out;
  }

  function sanitizeToFragment(html) {
    var tpl = document.createElement("template");
    tpl.innerHTML = String(html || "");
    var frag = document.createDocumentFragment();
    for (var c = tpl.content.firstChild; c; c = c.nextSibling) {
      var k = sanitizeNode(c, document); if (k) frag.appendChild(k);
    }
    return frag;
  }

  function sanitize(html) {
    var d = document.createElement("div");
    d.appendChild(sanitizeToFragment(html));
    return d.innerHTML;
  }

  function stripTags(html) {
    var d = document.createElement("div");
    d.appendChild(sanitizeToFragment(String(html || "").replace(/<br\s*\/?>|<\/(p|div|li)>/gi, "\n")));
    return (d.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  }

  // ---------------------------------------------------------------- piping
  function findQ(ctx, qid) {
    var qs = (ctx && ctx.questions) || [];
    for (var i = 0; i < qs.length; i++) if (qs[i].id === qid) return qs[i];
    return null;
  }
  function optLabel(q, code) {
    var os = (q && q.options) || [];
    for (var i = 0; i < os.length; i++) if (String(os[i].code) === String(code)) return os[i].label;
    return "";
  }
  function rowLabel(q, code) {
    var rs = (q && q.rows) || [];
    for (var i = 0; i < rs.length; i++) if (String(rs[i].code) === String(code)) return rs[i].label;
    return "";
  }
  function answerText(q, a) {
    if (!q || !a) return "";
    switch (q.type) {
      case "single_select": return a._ === undefined ? "" : (optLabel(q, a._) || String(a._));
      case "multi_select": return (a.codes || []).map(function (c) { return optLabel(q, c) || String(c); }).join(", ");
      case "rank": return (a.order || []).slice(0, q.rank_count || 3).map(function (c) { return rowLabel(q, c) || c; }).join(", ");
      default: return a._ === undefined || a._ === null ? "" : String(a._);
    }
  }

  // {Q1} {Q1.text} {Q1.code} {Q1.other} {Q1.stem} {Q1.opt:2} {Q1.row:a} {Q1.r:a} {Q1.first} {Q1.last}
  var TOKEN = /\{([A-Za-z0-9_]+)(?:\.([A-Za-z0-9_]+)(?::([A-Za-z0-9_]+))?)?\}/g;

  function resolve(qid, field, arg, ctx) {
    var q = findQ(ctx, qid);
    var a = (ctx && ctx.answers && ctx.answers[qid]) || {};
    if (!q) return "";
    switch (field || "text") {
      case "text": return answerText(q, a);
      case "code": return a._ !== undefined ? String(a._) : (a.codes || []).join(",");
      case "other": return a.other_text || "";
      case "stem": return q.stem || "";
      case "opt": return optLabel(q, arg);
      case "row": return rowLabel(q, arg);
      case "r": return a[arg] === undefined ? "" : String(a[arg]);
      case "first": return (a.codes && a.codes.length) ? optLabel(q, a.codes[0]) : (a.order ? rowLabel(q, a.order[0]) : answerText(q, a));
      case "last": return (a.codes && a.codes.length) ? optLabel(q, a.codes[a.codes.length - 1]) : (a.order ? rowLabel(q, a.order[a.order.length - 1]) : answerText(q, a));
    }
    return "";
  }

  function pipe(text, ctx, fallback) {
    return String(text == null ? "" : text).replace(TOKEN, function (m, qid, field, arg) {
      var v = resolve(qid, field, arg, ctx);
      return v === "" ? (fallback === undefined ? "" : fallback) : v;
    });
  }

  function pipeFragment(frag, ctx, fallback) {
    var walker = document.createTreeWalker(frag, 4 /* TEXT */);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) { if (TOKEN.test(n.nodeValue)) { TOKEN.lastIndex = 0; n.nodeValue = pipe(n.nodeValue, ctx, fallback); } TOKEN.lastIndex = 0; });
    return frag;
  }

  function richInto(el, html, ctx, fallback) {
    el.innerHTML = "";
    el.appendChild(pipeFragment(sanitizeToFragment(html), ctx, fallback));
    return el;
  }

  // ---------------------------------------------------------------- show-if
  function isAnswered(q, a) {
    if (!q || !a) return false;
    if (q.type === "multi_select") return (a.codes || []).length > 0;
    if (q.type === "rank") return (a.order || []).length > 0;
    if (a._ !== undefined && a._ !== "") return true;
    return Object.keys(a).some(function (k) { return k !== "_order" && a[k] !== undefined && a[k] !== ""; });
  }
  function ruleTrue(r, ctx) {
    var q = findQ(ctx, r.q);
    var a = (ctx.answers && ctx.answers[r.q]) || {};
    var codes = q && q.type === "multi_select" ? (a.codes || []).map(String)
              : (a._ !== undefined ? [String(a._)] : []);
    var num = Number(a._);
    var want = r.value === undefined || r.value === null ? "" : String(r.value);
    switch (r.op) {
      case "answered": return isAnswered(q, a);
      case "not_answered": return !isAnswered(q, a);
      case "selected": return codes.indexOf(want) >= 0;
      case "not_selected": return codes.indexOf(want) < 0;
      case "any_of": return want.split(",").some(function (v) { return codes.indexOf(v.trim()) >= 0; });
      case "none_of": return !want.split(",").some(function (v) { return codes.indexOf(v.trim()) >= 0; });
      case "eq": return a._ !== undefined && String(a._) === want;
      case "ne": return a._ === undefined || String(a._) !== want;
      case "gt": return !isNaN(num) && a._ !== undefined && num > Number(want);
      case "gte": return !isNaN(num) && a._ !== undefined && num >= Number(want);
      case "lt": return !isNaN(num) && a._ !== undefined && num < Number(want);
      case "lte": return !isNaN(num) && a._ !== undefined && num <= Number(want);
      case "contains": return String(answerText(q, a)).toLowerCase().indexOf(want.toLowerCase()) >= 0;
      case "row_eq": { var parts = want.split("="); return parts.length === 2 && String(a[parts[0].trim()]) === parts[1].trim(); }
    }
    return true;
  }
  function showIf(q, ctx) {
    var s = q && q.show_if;
    if (!s || !s.rules || !s.rules.length) return true;
    var results = s.rules.map(function (r) { return ruleTrue(r, ctx || {}); });
    var ok = (s.match === "any") ? results.some(Boolean) : results.every(Boolean);
    return s.negate ? !ok : ok;
  }

  // ---------------------------------------------------------------- ordering
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {                      // mulberry32
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  // list = q.options or q.rows. Items with pin:true keep their index. seed = respondent id.
  function order(list, q, seed) {
    var rz = q && q.randomize;
    var mode = rz && typeof rz === "object" ? rz.mode : rz;
    if (!list || !mode || mode === "none") return list.slice();
    var r = rng(hash(String(seed || "") + "|" + (q.id || "")));
    var free = [], slots = [];
    list.forEach(function (it, i) { if (!it.pin) { free.push(it); slots.push(i); } });
    if (mode === "shuffle") {
      for (var i = free.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = free[i]; free[i] = free[j]; free[j] = t; }
    } else if (mode === "reverse") {            // half the respondents see the list flipped
      if (r() < 0.5) free.reverse();
    } else if (mode === "rotate") {             // random start point, relative order kept
      var k = Math.floor(r() * free.length);
      free = free.slice(k).concat(free.slice(0, k));
    }
    var out = list.slice();
    slots.forEach(function (s, i) { out[s] = free[i]; });
    return out;
  }

  // ---------------------------------------------------------------- sample answers (preview)
  function sampleAnswers(questions, uptoId) {
    var out = {};
    for (var i = 0; i < (questions || []).length; i++) {
      var q = questions[i];
      if (q.id === uptoId) break;
      var a = {};
      switch (q.type) {
        case "single_select": case "nps": a._ = q.options && q.options.length ? q.options[0].code : 7; break;
        case "multi_select": a.codes = (q.options || []).slice(0, 2).map(function (o) { return o.code; }); break;
        case "numeric": case "slider": a._ = Math.round(((q.min || 0) + (q.max || 100)) / 2); break;
        case "open_text": a._ = "(sample answer to " + q.id + ")"; break;
        case "rank": a.order = (q.rows || []).map(function (r) { return r.code; }); break;
        case "rating_grid": case "semantic_diff": case "emoji_grid":
          (q.rows || []).forEach(function (r) { a[r.code] = q.scale ? Math.ceil((q.scale.min + q.scale.max) / 2) : 4; }); break;
        case "sum_to_100":
          (q.rows || []).forEach(function (r, k, arr) { a[r.code] = k === 0 ? 100 - 10 * (arr.length - 1) : 10; }); break;
        default: break;
      }
      out[q.id] = a;
    }
    return out;
  }

  // labels for the Studio's "insert piped text" menu
  function pipeTokens(questions, uptoId) {
    var toks = [];
    for (var i = 0; i < (questions || []).length; i++) {
      var q = questions[i];
      if (q.id === uptoId) break;
      if (q.type === "choice_task") continue;
      toks.push({ token: "{" + q.id + "}", label: q.id + " - answer as text" });
      if (q.options && q.options.length) {
        toks.push({ token: "{" + q.id + ".code}", label: q.id + " - answer code" });
        if (q.type === "multi_select") {
          toks.push({ token: "{" + q.id + ".first}", label: q.id + " - first selected" });
          toks.push({ token: "{" + q.id + ".last}", label: q.id + " - last selected" });
        }
        if (q.options.some(function (o) { return o.other; })) toks.push({ token: "{" + q.id + ".other}", label: q.id + " - 'other' text" });
        q.options.forEach(function (o) {
          toks.push({ token: "{" + q.id + ".opt:" + o.code + "}", label: q.id + " option " + o.code + ": " + String(o.label).slice(0, 40) });
        });
      }
      if (q.rows && q.rows.length) {
        q.rows.forEach(function (r) {
          toks.push({ token: "{" + q.id + ".row:" + r.code + "}", label: q.id + " row " + r.code + ": " + String(r.label).slice(0, 40) });
          if (q.scale) toks.push({ token: "{" + q.id + ".r:" + r.code + "}", label: q.id + " rating for " + r.code });
        });
      }
      toks.push({ token: "{" + q.id + ".stem}", label: q.id + " - question text" });
    }
    return toks;
  }

  window.BeaconQ = {
    sanitize: sanitize, sanitizeToFragment: sanitizeToFragment, stripTags: stripTags,
    pipe: pipe, richInto: richInto, showIf: showIf, order: order, hash: hash,
    sampleAnswers: sampleAnswers, pipeTokens: pipeTokens, answerText: answerText
  };
})();
