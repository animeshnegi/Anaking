/* BEACON question logic shared by the respondent survey and the Studio preview.
 *
 *   BeaconQ.sanitize(html)             whitelist rich text (mirrors core/sanitize.py)
 *   BeaconQ.pipe(text, ctx)            replace {Q1} {Q1.text} {Q1.opt:3} ... with answers
 *   BeaconQ.richInto(el, html, ctx)    sanitize + pipe + inject as DOM
 *   BeaconQ.showIf(q, ctx)             evaluate q.show_if -> true/false
 *   BeaconQ.screening(q)               screening blocks of a question (explicit + legacy)
 *   BeaconQ.screeningVerdict(qs, a, o) first block that ends the survey -> {qid,reason,message}|null
 *   BeaconQ.screenSummary(q, qs)       the same rules in plain English, one line per block
 *   BeaconQ.opsFor(q)                  conditions valid for that question type
 *   BeaconQ.order(list, q, seed)       apply q.randomize to options / rows (pinned kept)
 *   BeaconQ.sampleAnswers(questions)   plausible answers for every question (preview/piping)
 *
 * ctx = { answers: {qid: {...}}, questions: [...] }
 */
(function () {
  "use strict";

  var TAGS = { b: 1, strong: 1, i: 1, em: 1, u: 1, s: 1, span: 1, mark: 1, sup: 1, sub: 1, br: 1,
               p: 1, div: 1, ul: 1, ol: 1, li: 1, a: 1, font: 1,
               table: 1, thead: 1, tbody: 1, tr: 1, td: 1, th: 1 };
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
    return Object.keys(a).some(function (k) {
      if (k === "_order") return false;
      var v = a[k];
      if (Array.isArray(v)) return v.length > 0;      // a multi-select grid row with nothing ticked
      return v !== undefined && v !== "";
    });
  }
  // One cell of a rows x columns grid: which column the row picked (stored on the row's
  // own key), shared by the show-if conditions and the screening rules.
  function cellPickTrue(op, a, value) {
    var ckey = rowKey(value), cw = rowWant(value);
    if (!ckey) return false;                      // no row chosen yet: the rule is not ready
    var got2 = a[ckey];
    var picked = Array.isArray(got2) ? got2.map(String)
               : (got2 === undefined || got2 === null || got2 === "" ? [] : [String(got2)]);
    var has = picked.indexOf(cw) >= 0;
    return op === "cell_is" ? has : op === "cell_not" ? !has
         : op === "cell_includes" ? has : !has;
  }
  // One number box of a rows x columns numeric matrix, stored as "row_col".  The rule's
  // value reads "row=col=N" (or "row=col=lo-hi" for the between condition).
  function cellNumTrue(op, a, value) {
    var nkey = rowKey(value), ntail = rowWant(value);
    if (!nkey || ntail.indexOf("=") < 0) return false;   // the rule is not ready yet
    var bits = ntail.split("="), ncol = bits[0].trim(), nwant = bits.slice(1).join("=").trim();
    var nv = Number(a[nkey + "_" + ncol]);
    if (isNaN(nv)) return false;
    if (op === "cell_between") {
      var nb = String(nwant || "").split("-");
      return nv >= Number(nb[0]) && nv <= Number(nb[1]);
    }
    var nw = Number(nwant);
    if (isNaN(nw)) return false;
    return op === "cell_gte" ? nv >= nw : op === "cell_lte" ? nv <= nw
         : op === "cell_gt" ? nv > nw : op === "cell_lt" ? nv < nw
         : op === "cell_eq" ? nv === nw : nv !== nw;
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
      case "cell_is": case "cell_not": case "cell_includes": case "cell_lacks":
        return cellPickTrue(r.op, a, want);
      case "cell_gte": case "cell_lte": case "cell_gt": case "cell_lt":
      case "cell_eq": case "cell_ne": case "cell_between":
        return cellNumTrue(r.op, a, want);
    }
    return true;
  }
  function showIf(q, ctx) {
    var s = q && q.show_if;
    if (!s || s.off === true || !s.rules || !s.rules.length) return true;
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
  // list = q.options, q.rows, q.cols or the scale points.  Items with pin:true keep their
  // index.  seed = respondent id.  axis = "rows" | "cols" - a grid gives each axis its own
  // order, and a plain string (the older shape) always meant the rows.
  function order(list, q, seed, axis) {
    var rz = q && q.randomize, mode;
    if (rz && typeof rz === "object") mode = axis ? rz[axis] : (rz.mode != null ? rz.mode : rz.rows);
    else mode = axis === "cols" ? null : rz;
    if (!list || !mode || mode === "none") return list.slice();
    var r = rng(hash(String(seed || "") + "|" + (q.id || "") + "|" + (axis || "")));
    var free = [], slots = [];
    list.forEach(function (it, i) { if (!it.pin) { free.push(it); slots.push(i); } });
    if (mode === "shuffle") {
      for (var i = free.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = free[i]; free[i] = free[j]; free[j] = t; }
    } else if (mode === "reverse") {            // half the respondents see the list flipped
      if (r() < 0.5) free.reverse();
    } else if (mode === "revall") {             // everybody sees it the other way round
      free.reverse();
    } else if (mode === "rotate") {             // random start point, relative order kept
      var k = Math.floor(r() * free.length);
      free = free.slice(k).concat(free.slice(0, k));
    }
    var out = list.slice();
    slots.forEach(function (s, i) { out[s] = free[i]; });
    return out;
  }

  // ---------------------------------------------------------------- screening
  // SCREEN IN / SCREEN OUT - per-question, per-option-group, fully data driven.
  //
  // A question can carry a screening block next to its content:
  //
  //   screening: { mode:  "screen_out" | "qualify",
  //                match: "all" | "any",
  //                when:  "live" | "next",           // as soon as it matches / on Next
  //                message: "text respondents read when it fires",
  //                reason:  "short line recorded in the screen-out report",
  //                rules: [ { q: "Q1", op: "any_of", value: "5,6,7,8" }, ... ] }
  //
  //   screen_out  - when the rules match the respondent is screened out.
  //   qualify     - the respondent may only continue when the rules match;
  //                 everybody else is screened out at this question.
  //
  // The legacy shorthand still works and is merged in as extra blocks, so older
  // studies keep behaving exactly as they did:
  //   options[].terminate = true       -> screens out when that option is picked
  //   terminate_if_lt / terminate_message on a numeric question
  //
  // Everything is evaluated against the same ctx as show-if:
  //   ctx = { answers: {qid: {...}}, questions: [...] }

  // op -> { label, value, kinds, sym?, unit? }.  kinds [] means "every question type".
  // The order is the order of the dropdown, so the most common screening test comes first.
  var SCREEN_OPS = [
    // ---- choice questions: one option, a group of options, or a count of them
    { op: "any_of",       label: "is any of",                value: "codes", kinds: ["choice"] },
    { op: "none_of",      label: "is none of",               value: "codes", kinds: ["choice"] },
    { op: "selected",     label: "is",                       value: "codes", kinds: ["choice"] },
    { op: "not_selected", label: "is not",                   value: "codes", kinds: ["choice"] },
    { op: "all_of",       label: "includes all of",          value: "codes", kinds: ["choice", "rank"] },
    { op: "exactly",      label: "is exactly these",         value: "codes", kinds: ["choice"] },
    { op: "count_gte",    label: "selects at least",         value: "count", kinds: ["choice"] },
    { op: "count_lte",    label: "selects at most",          value: "count", kinds: ["choice"] },
    { op: "count_eq",     label: "selects exactly",          value: "count", kinds: ["choice"] },
    // ---- numbers: the operator row with a number box
    { op: "lt",           label: "is less than",             value: "number", kinds: ["number"], sym: "<" },
    { op: "lte",          label: "is at most",               value: "number", kinds: ["number"], sym: "\u2264" },
    { op: "gt",           label: "is more than",             value: "number", kinds: ["number"], sym: ">" },
    { op: "gte",          label: "is at least",              value: "number", kinds: ["number"], sym: "\u2265" },
    { op: "eq",           label: "equals",                   value: "number", kinds: ["number"], sym: "=" },
    { op: "ne",           label: "does not equal",           value: "number", kinds: ["number"], sym: "\u2260" },
    { op: "between",      label: "is between",               value: "between", kinds: ["number"] },
    { op: "not_between",  label: "is outside",               value: "between", kinds: ["number"] },
    // ---- allocations (constant sum, numeric matrix): one row, a group, or the total
    { op: "row_gte",      label: "row is at least",          value: "rowvalue", kinds: ["grid", "alloc", "numrows"], sym: "\u2265" },
    { op: "row_lte",      label: "row is at most",           value: "rowvalue", kinds: ["grid", "alloc", "numrows"], sym: "\u2264" },
    { op: "row_gt",       label: "row is more than",         value: "rowvalue", kinds: ["grid", "alloc", "numrows"], sym: ">" },
    { op: "row_lt",       label: "row is less than",         value: "rowvalue", kinds: ["grid", "alloc", "numrows"], sym: "<" },
    { op: "row_eq",       label: "row is",                   value: "rowvalue", kinds: ["grid", "alloc", "numrows"], sym: "=" },
    { op: "row_ne",       label: "row is not",               value: "rowvalue", kinds: ["grid", "alloc", "numrows"], sym: "\u2260" },
    { op: "row_between",  label: "is between",               value: "rowrange", kinds: ["grid", "alloc", "numrows"] },
    { op: "row_outside",  label: "is outside",               value: "rowrange", kinds: ["grid", "alloc", "numrows"] },
    { op: "sum_of_gte",   label: "these rows add up to at least", value: "rowsum", kinds: ["alloc", "numrows"], sym: "\u2265" },
    { op: "sum_of_lte",   label: "these rows add up to at most",  value: "rowsum", kinds: ["alloc", "numrows"], sym: "\u2264" },
    // ---- "Sum of responses": one comparison over the whole group
    { op: "sum_eq",       label: "the sum is",               value: "rowsum", kinds: ["grid", "alloc", "numrows"], sym: "=" },
    { op: "sum_lt",       label: "the sum is less than",     value: "rowsum", kinds: ["grid", "alloc", "numrows"], sym: "<" },
    { op: "sum_gt",       label: "the sum is more than",     value: "rowsum", kinds: ["grid", "alloc", "numrows"], sym: ">" },
    { op: "sum_between",  label: "the sum is between",       value: "rowsum", kinds: ["grid", "alloc", "numrows"] },
    { op: "total_gte",    label: "the total is at least",    value: "number", kinds: ["alloc", "numrows"], sym: "\u2265" },
    { op: "total_lte",    label: "the total is at most",     value: "number", kinds: ["alloc", "numrows"], sym: "\u2264" },
    { op: "total_eq",     label: "the total is",             value: "number", kinds: ["alloc", "numrows"], sym: "=" },
    { op: "total_ne",     label: "the total is not",         value: "number", kinds: ["alloc", "numrows"], sym: "\u2260" },
    // ---- text
    { op: "contains",     label: "mentions",                 value: "text", kinds: ["text"] },
    { op: "not_contains", label: "does not mention",         value: "text", kinds: ["text"] },
    { op: "words_lt",     label: "is shorter than",          value: "count", kinds: ["text"], unit: "words" },
    // ---- ranking
    { op: "ranked_first", label: "ranks first",              value: "codes", kinds: ["rank"] },
    { op: "ranked_top",   label: "ranks in the top",         value: "ranktop", kinds: ["rank"] },
    // ---- choice grids: one row picks one column (or several)
    { op: "cell_is",       label: "row is",                  value: "rowcode", kinds: ["choicegrid"], sym: "=" },
    { op: "cell_not",      label: "row is not",              value: "rowcode", kinds: ["choicegrid"], sym: "\u2260" },
    { op: "cell_includes", label: "row includes",            value: "rowcode", kinds: ["choicegrid"] },
    { op: "cell_lacks",    label: "row does not include",    value: "rowcode", kinds: ["choicegrid"] },
    { op: "cell_gte",      label: "cell is at least",        value: "cellnum", kinds: ["nummatrix"], sym: "\u2265" },
    { op: "cell_lte",      label: "cell is at most",         value: "cellnum", kinds: ["nummatrix"], sym: "\u2264" },
    { op: "cell_gt",       label: "cell is more than",       value: "cellnum", kinds: ["nummatrix"], sym: ">" },
    { op: "cell_lt",       label: "cell is less than",       value: "cellnum", kinds: ["nummatrix"], sym: "<" },
    { op: "cell_eq",       label: "cell is",                 value: "cellnum", kinds: ["nummatrix"], sym: "=" },
    { op: "cell_ne",       label: "cell is not",             value: "cellnum", kinds: ["nummatrix"], sym: "\u2260" },
    { op: "cell_between",  label: "cell is between",         value: "cellrange", kinds: ["nummatrix"] },
    // ---- every question type
    { op: "answered",     label: "was answered",             value: "none", kinds: [] },
    { op: "not_answered", label: "was skipped",              value: "none", kinds: [] }
  ];
  var SCREEN_OP_BY_ID = {};
  SCREEN_OPS.forEach(function (o) { SCREEN_OP_BY_ID[o.op] = o; });

  // Which family of controls the condition needs, per question type:
  //   choice      - options / codes
  //   number      - one number (numeric entry, scale, NPS, date, delta)
  //   alloc       - an allocation split across rows (constant sum)
  //   numrows     - a number per row, with no forced total (a numeric matrix without columns)
  //   nummatrix   - a numeric matrix of rows x columns, one number per cell
  //   grid        - a scale value per row (rating scale, word pairs, heat map, concept test,
  //                 and older scale-based grids)
  //   choicegrid  - a grid of rows x columns where each row picks one or several columns
  var TYPE_KIND = {
    single_select: "choice", multi_select: "choice",
    numeric: "number", slider: "number", nps: "number", date: "number", delta: "number",
    open_text: "text", loop: "text",
    rank: "rank",
    rating_grid: "grid", rating_scale: "grid", semantic_diff: "grid", emoji_grid: "grid",
    heatmap: "grid", concept_test: "grid",
    sum_to_100: "alloc", numeric_matrix: "numrows"
  };
  function qKind(q) {
    if (!q) return "any";
    // a question loop is text by default, but numbers when its children are numbers
    if (q.type === "loop") return q.child === "numeric" ? "numrows" : "text";
    // a grid with columns is a rows x columns choice grid; without columns it is the
    // older scale-based grid (one rating per row)
    if (q.type === "rating_grid") return (q.cols && q.cols.length) ? "choicegrid" : "grid";
    // a numeric matrix with columns is a rows x columns table of number boxes; without
    // columns it keeps the older one-number-per-row shape
    if (q.type === "numeric_matrix") return (q.cols && q.cols.length) ? "nummatrix" : "numrows";
    return TYPE_KIND[q.type] || "any";
  }

  function opsFor(q) {
    var k = qKind(q);
    return SCREEN_OPS.filter(function (o) { return !o.kinds.length || o.kinds.indexOf(k) >= 0; });
  }
  function opInfo(op) { return SCREEN_OP_BY_ID[op] || { op: op, label: op, value: "text", kinds: [] }; }
  function valueKind(op) { return opInfo(op).value; }

  function codeList(value) {
    return String(value === undefined || value === null ? "" : value)
      .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }
  // the codes the respondent picked for a question, whichever shape the answer has
  function pickedCodes(q, a) {
    a = a || {};
    if (q && q.type === "multi_select") return (a.codes || []).map(String);
    if (q && q.type === "rank") return (a.order || []).map(String);
    if (a._ !== undefined && a._ !== null && String(a._) !== "") return [String(a._)];
    return [];
  }
  function numOf(a) {
    if (!a) return NaN;
    if (a.delta !== undefined && a.before !== undefined) return Number(a.delta);
    return a._ === undefined || a._ === null || a._ === "" ? NaN : Number(a._);
  }
  function textOf(q, a) {
    a = a || {};
    if (q && q.type === "loop") {
      return (q.items || []).map(function (it) { return String(a[it.code] || ""); }).join(" ");
    }
    return String(a._ === undefined || a._ === null ? "" : a._);
  }
  function wordsOf(t) { return String(t).trim().split(/\s+/).filter(Boolean).length; }
  function rowKey(item) { return String(item || "").split("=")[0].trim(); }
  function rowWant(item) { var p = String(item || "").split("="); return p.length > 1 ? p.slice(1).join("=").trim() : ""; }
  function rowList(value) {                    // "a,b=40" -> the rows the author ticked
    var p = String(value || "").split("=");
    return (p[0] || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }
  // The numbers a row-based question holds: every row of a grid / allocation, or every
  // item of a loop.  Used by the per-row, group and total conditions.
  function rowCodes(q) {
    var list = (q && (q.rows || q.items)) || [];
    return list.map(function (r) { return String(r.code); });
  }
  function numIn(a, code) {
    var v = a ? Number(a[code]) : NaN;
    return isFinite(v) ? v : 0;
  }
  function sumOf(a, codes) {
    var total = 0;
    codes.forEach(function (c) { total += numIn(a, c); });
    return total;
  }
  function totalOf(q, a) { return sumOf(a, rowCodes(q)); }

  function screenRuleTrue(r, ctx) {
    var q = findQ(ctx, r.q);
    var a = (ctx && ctx.answers && ctx.answers[r.q]) || {};
    var codes = pickedCodes(q, a);
    var want = codeList(r.value);
    var num = numOf(a);
    switch (r.op) {
      case "selected": return codes.indexOf(want[0]) >= 0;
      case "not_selected": return codes.indexOf(want[0]) < 0;
      case "any_of": return want.some(function (v) { return codes.indexOf(v) >= 0; });
      case "none_of": return !want.some(function (v) { return codes.indexOf(v) >= 0; });
      case "all_of": return want.length > 0 && want.every(function (v) { return codes.indexOf(v) >= 0; });
      case "exactly": return codes.length === want.length && want.every(function (v) { return codes.indexOf(v) >= 0; });
      case "count_gte": return codes.length >= Number(r.value);
      case "count_lte": return codes.length <= Number(r.value);
      case "count_eq": return codes.length === Number(r.value);
      case "eq": return num === Number(r.value);
      case "ne": return !(num === Number(r.value));
      case "gt": return isFinite(num) && num > Number(r.value);
      case "gte": return isFinite(num) && num >= Number(r.value);
      case "lt": return isFinite(num) && num < Number(r.value);
      case "lte": return isFinite(num) && num <= Number(r.value);
      case "between": case "not_between": {
        var p = String(r.value || "").split("-");
        var lo = Number(p[0]), hi = Number(p[1]);
        var inside = isFinite(num) && num >= lo && num <= hi;
        return r.op === "between" ? inside : !inside;
      }
      case "contains": return textOf(q, a).toLowerCase().indexOf(String(r.value || "").toLowerCase()) >= 0;
      case "not_contains": return textOf(q, a).toLowerCase().indexOf(String(r.value || "").toLowerCase()) < 0;
      case "words_lt": return wordsOf(textOf(q, a)) < Number(r.value);
      case "row_eq": case "row_ne": case "row_gte": case "row_lte":
      case "row_gt": case "row_lt": {
        var key = rowKey(r.value), target = Number(rowWant(r.value));
        if (!key) return false;                     // no row chosen yet: the rule is not ready
        var got = a[key];
        if (got === undefined || got === "" || got === null) return false;
        var g = Number(got);
        switch (r.op) {
          case "row_eq": return g === target;
          case "row_ne": return !(g === target);
          case "row_gte": return g >= target;
          case "row_lte": return g <= target;
          case "row_gt": return g > target;
          default: return g < target;
        }
      }
      // how much of an allocation went to a chosen group of rows
      case "sum_of_gte": case "sum_of_lte": {
        var group = rowList(r.value);
        if (!group.length) return false;            // no rows ticked: the rule is not ready
        var want = Number(rowWant(r.value) || 0);
        return r.op === "sum_of_gte" ? sumOf(a, group) >= want : sumOf(a, group) <= want;
      }
      // one answer against its own Min - Max band
      case "row_between": case "row_outside": {
        var band = String(rowWant(r.value) || "").split("-");
        var blo = Number(band[0]), bhi = Number(band[1]);
        var code = rowKey(r.value);
        if (!code) return false;
        var bgot = a[code];
        if (bgot === undefined || bgot === "" || bgot === null) return false;
        var bnum = Number(bgot), bin = bnum >= blo && bnum <= bhi;
        return r.op === "row_between" ? bin : !bin;
      }
      // the four "Sum of responses" comparisons
      case "sum_eq": case "sum_lt": case "sum_gt": case "sum_between": {
        var grp = rowList(r.value);
        if (!grp.length) return false;                  // nothing ticked: the rule is not ready
        var tail = rowWant(r.value), gsum = sumOf(a, grp);
        if (r.op === "sum_between") {
          var g = String(tail || "").split("-");
          return gsum >= Number(g[0]) && gsum <= Number(g[1]);
        }
        if (r.op === "sum_eq") return gsum === Number(tail);
        return r.op === "sum_lt" ? gsum < Number(tail) : gsum > Number(tail);
      }
      case "total_eq": return totalOf(q, a) === Number(r.value);
      case "total_ne": return totalOf(q, a) !== Number(r.value);
      case "total_gte": return totalOf(q, a) >= Number(r.value);
      case "total_lte": return totalOf(q, a) <= Number(r.value);
      case "ranked_first": return codes.length > 0 && codes[0] === want[0];
      case "ranked_top": {
        var n = Number(rowWant(r.value));
        return codes.slice(0, n).indexOf(rowKey(r.value)) >= 0;
      }
      // a grid row picks one column (single select) or several (multi select)
      case "cell_is": case "cell_not": case "cell_includes": case "cell_lacks":
        return cellPickTrue(r.op, a, r.value);
      // a numeric matrix cell holds one number, stored under "row_col"
      case "cell_gte": case "cell_lte": case "cell_gt": case "cell_lt":
      case "cell_eq": case "cell_ne": case "cell_between":
        return cellNumTrue(r.op, a, r.value);
      case "answered": return isAnswered(q, a);
      case "not_answered": return !isAnswered(q, a);
    }
    return ruleTrue(r, ctx);              // fall back to the show-if operators
  }

  // ---- the structured screener: "Individual" (a Min - Max band per answer) and
  // "Sum of responses" (one comparison over the group).  Both are stored in their own
  // fields and expanded here into an ordinary rule list, so the verdict, the plain-English
  // line and the exports all keep working without knowing anything about them.
  //   Individual  -> one rule per answer, joined so that ANY answer outside its band fires
  //   Sum         -> one rule over the group, with the comparison the author picked
  function structuredRules(s, q) {
    var rows = (s.rows || []).map(String), out = [], i;
    if (s.type === "sum") {
      var sum = s.sum || {};
      var op = ["eq", "lt", "gt", "between"].indexOf(sum.op) >= 0 ? sum.op : "eq";
      var val = (sum.value === undefined || sum.value === null || sum.value === "") ? 0 : sum.value;
      return [{ q: q.id, op: "sum_" + op, value: rows.join(",") + "=" + val }];
    }
    for (i = 0; i < rows.length; i++) {
      var lo = (s.min || {})[rows[i]], hi = (s.max || {})[rows[i]];
      if (lo === undefined && hi === undefined) continue;
      out.push({
        q: q.id,
        op: s.outside === false ? "row_between" : "row_outside",
        value: rows[i] + "=" + (isFinite(Number(lo)) ? Number(lo) : 0) +
               "-" + (isFinite(Number(hi)) ? Number(hi) : 100)
      });
    }
    return out;
  }

  // Every screening block a question carries, explicit + legacy, normalised.
  // The Studio switch owns the whole feature: when it is off, nothing fires -
  // not the authored rules, not the Screen-out marks on the answer options,
  // not the legacy terminate shorthand.
  function screening(q) {
    var out = [];
    if (!q) return out;
    var s = q.screening;
    if (s && s.enabled === false) return out;
    if (s && s.enabled !== false) {
      var extra = (s.rules || []).slice();
      var built = structuredRules(s, q);
      var rules = built.concat(extra);
      if (rules.length) {
        // a band per answer fires when ANY answer breaks it; a sum is a single test
        var match = built.length && s.type === "sum" ? "all"
                  : built.length ? (s.match === "all" ? "all" : "any")
                  : (s.match === "any" ? "any" : "all");
        out.push({
          owner: q.id,
          mode: s.mode === "qualify" ? "qualify" : "screen_out",
          match: match,
          when: s.when === "next" ? "next" : "live",
          rules: rules, message: s.message || "", reason: s.reason || "", source: "rules"
        });
      }
    }
    var term = ((q.options) || []).filter(function (o) { return o.terminate; });
    if (term.length) {
      out.push({
        owner: q.id, mode: "screen_out", match: "any", when: "live",
        rules: term.map(function (o) { return { q: q.id, op: "selected", value: o.code }; }),
        message: q.terminate_message || "", reason: "", source: "options"
      });
    }
    if (q.terminate_if_lt !== undefined && q.terminate_if_lt !== null && String(q.terminate_if_lt) !== "") {
      out.push({
        owner: q.id, mode: "screen_out", match: "all", when: "next",
        rules: [{ q: q.id, op: "lt", value: q.terminate_if_lt }],
        message: q.terminate_message || "", reason: "", source: "legacy"
      });
    }
    return out;
  }
  function hasScreening(q) { return screening(q).length > 0; }

  // Has the respondent finished this question? Stricter than `isAnswered` (which is
  // happy with any answer at all) because a screening rule on a grid should wait for
  // the whole grid, not fire on the first row somebody happens to tap.
  function complete(q, a) {
    a = a || {};
    if (!q) return false;
    switch (q.type) {
      case "single_select": case "numeric": case "slider": case "nps":
      case "open_text": case "date":
        return a._ !== undefined && a._ !== null && String(a._) !== "";
      case "multi_select": return (a.codes || []).length > 0;
      case "rank": return (a.order || []).length === (q.rows || []).length && (q.rows || []).length > 0;
      case "delta": return a.before !== undefined && a.after !== undefined;
      case "sum_to_100": return (q.rows || []).some(function (r) { return a[r.code] !== undefined; });
      case "numeric_matrix":
        if ((q.cols || []).length) return (q.rows || []).every(function (r) {
          if (a[r.code] === "NA") return true;                 // N/A stands in for the row
          return (q.cols || []).every(function (c) {
            var v = a[r.code + "_" + c.code];
            return v !== undefined && String(v) !== "";
          });
        });
        return (q.rows || []).every(function (r) {
          return a[r.code] !== undefined && String(a[r.code]) !== ""; });
      case "loop": return (q.items || []).length > 0 && (q.items || []).every(function (it) {
        return String(a[it.code] || "").trim() !== ""; });
      default:
        if ((q.rows || []).length) return (q.rows || []).every(function (r) {
          return a[r.code] !== undefined && a[r.code] !== ""; });
        return isAnswered(q, a);
    }
  }

  // "match" / "no" / "pending" - pending until the questions it reads are answered.
  function blockState(block, ctx) {
    var answers = (ctx && ctx.answers) || {};
    var owner = findQ(ctx, block.owner);
    if (!complete(owner, answers[block.owner])) return "pending";
    for (var i = 0; i < block.rules.length; i++) {
      var r = block.rules[i];
      if (r.q === block.owner) continue;
      if (!isAnswered(findQ(ctx, r.q), answers[r.q] || {})) return "pending";
    }
    var res = block.rules.map(function (r) { return screenRuleTrue(r, ctx); });
    var ok = block.match === "any" ? res.some(Boolean) : res.every(Boolean);
    return ok ? "match" : "no";
  }

  // First block that ends the survey, in questionnaire order. Returns
  // { qid, mode, reason, message } or null.
  //   opts.phase = "live"  - only blocks that fire as soon as they match
  //   opts.upto            - last question index to consider
  function screeningVerdict(questions, answers, opts) {
    opts = opts || {};
    var ctx = { answers: answers || {}, questions: questions || [] };
    for (var i = 0; i < ctx.questions.length; i++) {
      if (opts.upto != null && i > opts.upto) break;
      var q = ctx.questions[i];
      var blocks = screening(q);
      for (var b = 0; b < blocks.length; b++) {
        var blk = blocks[b];
        if (opts.phase === "live" && blk.when !== "live") continue;
        var st = blockState(blk, ctx);
        if (blk.mode === "screen_out" && st === "match") return hit(q, blk, ctx);
        if (blk.mode === "qualify" && st === "no") return hit(q, blk, ctx);
      }
    }
    return null;
  }
  function hit(q, blk, ctx) {
    return {
      qid: q.id,
      mode: blk.mode,
      message: blk.message || "",
      reason: blk.reason ? String(blk.reason)
        : (q.id + ": " + (blk.mode === "qualify"
            ? "did not qualify - " + blockText(blk, ctx.questions)
            : blockText(blk, ctx.questions)))
    };
  }

  // ------------------------------------------------- screening in plain words
  function itemLabel(q, code) {
    var l = optLabel(q, code) || rowLabel(q, code);
    return l ? String(l) : String(code);
  }
  function valueText(r, questions) {
    var q = null;
    for (var i = 0; i < (questions || []).length; i++) if (questions[i].id === r.q) q = questions[i];
    var kind = valueKind(r.op);
    if (kind === "codes") {
      var codes = codeList(r.value);
      var labels = codes.map(function (c) { return itemLabel(q, c); });
      if (r.op === "ranked_first") return labels.join(" / ") || "…";
      return labels.length ? labels.join(r.op === "all_of" ? " and " : ", ") : "…";
    }
    if (kind === "ranktop") return itemLabel(q, rowKey(r.value)) + " (top " + rowWant(r.value) + ")";
    if (kind === "rowcode") {
      var col = null;
      ((q && q.cols) || []).forEach(function (c) { if (String(c.code) === rowWant(r.value)) col = c; });
      return itemLabel(q, rowKey(r.value)) + " " + (opInfo(r.op).sym || "=") + " " +
        (col ? (col.label || String(col.code)) : rowWant(r.value));
    }
    if (kind === "cellnum" || kind === "cellrange") {   // "row=col=N" - one number box
      var nt = String(rowWant(r.value) || ""), nb2 = nt.split("=");
      var col2 = null, ccode2 = (nb2[0] || "").trim();
      ((q && q.cols) || []).forEach(function (c) { if (String(c.code) === ccode2) col2 = c; });
      var base2 = itemLabel(q, rowKey(r.value)) + " \u00D7 " +
        (col2 ? (col2.label || String(col2.code)) : ccode2);
      if (kind === "cellrange") {
        var cb2 = nb2.slice(1).join("=").split("-");
        return base2 + " between " + (cb2[0] || "?") + " and " + (cb2[1] || "?");
      }
      return base2 + " " + (opInfo(r.op).sym || "=") + " " + nb2.slice(1).join("=");
    }
    if (kind === "rowvalue") return itemLabel(q, rowKey(r.value)) + " " + (opInfo(r.op).sym || "=") +
      " " + rowWant(r.value);
    if (kind === "rowrange") {                       // "code=10-60" -> the Min - Max band
      var band2 = String(rowWant(r.value) || "").split("-");
      return itemLabel(q, rowKey(r.value)) + " " + (band2[0] || "0") + " to " + (band2[1] || "0");
    }
    if (kind === "rowsum") {
      var rows = rowList(r.value).map(function (c) { return itemLabel(q, c); });
      return (rows.length ? rows.join(" + ") : "the rows") + " " + (opInfo(r.op).sym || "") +
        " " + (rowWant(r.value) === "" ? "0" : rowWant(r.value));
    }
    if (kind === "between") {
      var p = String(r.value || "").split("-");
      return (p[0] || "?") + (r.op === "between" ? " and " : " \u2013 ") + (p[1] || "?");
    }
    if (kind === "count") {
      var unit = opInfo(r.op).unit;
      return String(r.value) + (unit ? " " + unit : "");
    }
    if (kind === "none") return "";
    return String(r.value === undefined || r.value === null ? "" : r.value);
  }
  // Numbers read the way a questionnaire reads them: "Q3 < 10", "Q19 total \u2265 90".
  function ruleText(r, questions) {
    var info = opInfo(r.op), v = valueText(r, questions);
    var op = String(r.op);
    var q = null;
    for (var i = 0; i < (questions || []).length; i++) if (questions[i].id === r.q) q = questions[i];
    // "Q19: Brand A is outside 10 to 60"
    if (valueKind(op) === "rowrange") {
      var band3 = String(rowWant(r.value) || "").split("-");
      return (r.q || "?") + ": " + itemLabel(q, rowKey(r.value)) + " " + (info.label || op) +
        " " + (band3[0] || "0") + (op === "row_between" ? " and " : " to ") + (band3[1] || "0");
    }
    // "Q19: the sum of Brand A + Brand B = 80" / "... is between 10 and 90"
    if (op.indexOf("sum_") === 0) {
      var names = rowList(r.value).map(function (c) { return itemLabel(q, c); });
      var want3 = rowWant(r.value) === "" ? "0" : rowWant(r.value);
      var head3 = (names.length ? names.join(" + ") : "the rows");
      if (op === "sum_between") {
        var g3 = String(want3).split("-");
        return (r.q || "?") + ": the sum of " + head3 + " is between " + (g3[0] || "0") +
          " and " + (g3[1] || "0");
      }
      return (r.q || "?") + ": the sum of " + head3 + " " + (info.sym || info.label) + " " + want3;
    }
    var word = op.indexOf("total_") === 0 ? "total " + (info.sym || "")
             : op.indexOf("row_") === 0 ? "row "
             : (info.sym ? info.sym : info.label);
    return (r.q || "?") + " " + word + (v ? " " + v : "");
  }
  function blockText(block, questions) {
    var join = block.match === "any" ? " or " : " and ";
    return block.rules.map(function (r) { return ruleText(r, questions); }).join(join);
  }
  // One readable line per block, for the Studio, the Word outline and the data.
  function screenSummary(q, questions) {
    return screening(q).map(function (b) {
      return {
        mode: b.mode, when: b.when, source: b.source,
        text: (b.mode === "qualify" ? "carry on only when " : "screen out when ") + blockText(b, questions || [q])
      };
    });
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
        case "rating_scale": case "semantic_diff": case "emoji_grid":
          (q.rows || []).forEach(function (r) { a[r.code] = q.scale ? Math.ceil((q.scale.min + q.scale.max) / 2) : 4; }); break;
        case "rating_grid":
          if ((q.cols || []).length) {                // a rows x columns choice grid
            (q.rows || []).forEach(function (r) {
              a[r.code] = q.select === "multi" ? [q.cols[0].code] : q.cols[0].code;
            });
          } else {                                    // an older scale-based grid
            (q.rows || []).forEach(function (r) { a[r.code] = q.scale ? Math.ceil((q.scale.min + q.scale.max) / 2) : 4; });
          }
          break;
        case "sum_to_100":
          (q.rows || []).forEach(function (r, k, arr) { a[r.code] = k === 0 ? 100 - 10 * (arr.length - 1) : 10; }); break;
        case "date": a._ = "2026-01-15"; break;
        case "numeric_matrix": {
          var nmc = q.cols || [];
          (q.rows || []).forEach(function (r, k) {
            if (nmc.length) nmc.forEach(function (c, ci) { a[r.code + "_" + c.code] = 10 + k * 5 + ci; });
            else a[r.code] = 10 + k * 5;
          });
          break;
        }
        case "delta": a.before = 40; a.after = 60; a.delta = 20; break;
        case "concept_test":
          (q.rows || []).forEach(function (r) { a[r.code] = q.scale ? Math.ceil((q.scale.min + q.scale.max) / 2) : 4; }); break;
        case "loop":
          (q.items || []).forEach(function (it, k) { a[it.code] = q.child === "numeric" ? 5 + k : "(sample " + it.label + ")"; }); break;
        case "text_block": break;
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
    sampleAnswers: sampleAnswers, pipeTokens: pipeTokens, answerText: answerText,
    // screening (screen in / screen out)
    SCREEN_OPS: SCREEN_OPS, opsFor: opsFor, opInfo: opInfo, valueKind: valueKind,
    qKind: qKind, screening: screening, hasScreening: hasScreening, blockState: blockState,
    screeningVerdict: screeningVerdict, screenSummary: screenSummary,
    ruleText: ruleText, blockText: blockText, valueText: valueText, codeList: codeList
  };
})();
