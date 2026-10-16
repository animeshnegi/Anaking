/* BEACON Studio - survey builder.
   Workspace: Outline (sections + questions) · Editor (one scrolling form) · Live preview.
   Every edit writes straight into the study and is autosaved a moment later. */
(function () {
  "use strict";
  var root = document.getElementById("st-root");
  var cur = null;          // {slug,title,status,cfg}
  var tab = "questions";
  var sel = -1;            // index of the question open in the editor
  var studies = [];        // dashboard cache
  var Q = window.BeaconQ;

  function api(path, body) {
    return fetch(path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }
  var LANGCAT = [];
  var langPanel = { lang: null, onlyMissing: false, q: "", data: null };
  api("/api/studio/languages").then(function (d) { LANGCAT = d.languages || []; }).catch(function () {});
  function langMeta(code) {
    for (var i = 0; i < LANGCAT.length; i++) if (LANGCAT[i].code === code) return LANGCAT[i];
    return { code: code, name: code, native: code };
  }
  function langOptions(sel) {
    var cat = LANGCAT.length ? LANGCAT : [{ code: sel, name: sel, native: sel }];
    return cat.map(function (l) {
      return '<option value="' + l.code + '"' + (l.code === sel ? " selected" : "") + ">" + esc(l.name) + " (" + esc(l.native) + ")</option>";
    }).join("");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function kpi(v, l) { return '<div class="st-kpi"><strong>' + v + "</strong><span>" + l + "</span></div>"; }
  var toastTimer = null;
  function toast(msg, action, fn) {
    var t = document.getElementById("st-toast");
    t.innerHTML = esc(msg) + (action ? ' <button class="st-toast-btn" type="button">' + esc(action) + "</button>" : "");
    t.onclick = function (e) { if (e.target.classList.contains("st-toast-btn")) { t.hidden = true; if (fn) fn(); } };
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, action ? 7000 : 2600);
  }
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function ago(iso) {
    if (!iso) return "";
    var d = new Date(iso.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? "" : "Z"));
    if (isNaN(d)) return iso;
    var s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    if (s < 86400 * 14) return Math.round(s / 86400) + " d ago";
    return d.toLocaleDateString();
  }
  function hhmm(d) { return d.toTimeString().slice(0, 5); }

  // ------------------------------------------------------------ question types
  var TYPE_INFO = {
    single_select: { name: "Single Select", icon: "\u25C9", desc: "One answer from a list", group: "Questions" },
    multi_select: { name: "Multiple Choice (many)", icon: "\u2611", desc: "Tick all that apply", group: "Questions" },
    rank: { name: "Rank Order", icon: "\u21C5", desc: "Put items in order of preference", group: "Questions" },
    rating_grid: { name: "Grid", icon: "\u25A6", desc: "Rows \u00D7 columns - one or several picks per row", group: "Questions" },
    rating_scale: { name: "Rating Scale", icon: "\u2605", desc: "Rate rows on one scale, with low-end, mid and high-end labels", group: "Questions" },
    semantic_diff: { name: "Word pairs", icon: "\u27F7", desc: "Slide between two opposite words", group: "Questions" },
    nps: { name: "Net Promoter", icon: "\u2469", desc: "Likelihood to recommend", group: "Questions", noprev: true },
    emoji_grid: { name: "Emoji reaction", icon: "\u263A", desc: "Faces instead of numbers", group: "Questions" },
    numeric: { name: "Numeric Entry", icon: "#", desc: "Type a number - %, $, count", group: "Questions" },
    slider: { name: "Scale", icon: "\u2696", desc: "Drag to a value", group: "Questions" },
    sum_to_100: { name: "Constant Sum", icon: "\u03A3", desc: "Split 100 points across items", group: "Questions" },
    open_text: { name: "Text Entry", icon: "\u00B6", desc: "Free text, with optional voice note", group: "Questions" },
    date: { name: "Date", icon: "\uD83D\uDCC5", desc: "Pick a calendar date", group: "Questions" },
    numeric_matrix: { name: "Numeric Matrix", icon: "\u25A4", desc: "A number for every row", group: "Questions" },
    delta: { name: "Delta", icon: "\u0394", desc: "Before / after values and the change", group: "Questions" },
    concept_test: { name: "Concept Test", icon: "\uD83D\uDCA1", desc: "Show a concept, rate it on rows", group: "Methodologies" },
    heatmap: { name: "Heatmap", icon: "\u25A9", desc: "Intensity per row \u00D7 column", group: "Methodologies" },
    maxdiff: { name: "Max Diff", icon: "\u2194", desc: "Best / worst trade-offs - the Max Diff experiment", group: "Methodologies", noprev: true },
    choice_task: { name: "Conjoint", icon: "\u21C4", desc: "Choice tasks from the conjoint design", group: "Methodologies" },
    loop: { name: "Question Loop", icon: "\u27F3", desc: "Ask the same thing for a list of items", group: "Survey flow" },
    text_block: { name: "Text Block", icon: "\u2261", desc: "Rich text as its own step - no answer stored", group: "Objects" }
  };
  var TYPES = Object.keys(TYPE_INFO);
  var GROUPS = ["Questions", "Methodologies", "Survey flow", "Objects"];
  function tinfo(t) { return TYPE_INFO[t] || { name: t, icon: "?", desc: "" }; }

  function qTemplate(type, id, secId) {
    var q = { id: id, section: secId, type: type, required: true,
              stem: "New " + tinfo(type).name.toLowerCase() + " question" };
    if (type === "single_select" || type === "multi_select") {
      q.options = [{ code: 1, label: "Option one" }, { code: 2, label: "Option two" },
                   { code: 3, label: "Option three" }];
      if (type === "multi_select") q.max_select = 3;
    }
    if (type === "numeric") { q.min = 0; q.max = 100; }
    if (type === "slider") { q.min = 0; q.max = 100; q.step = 5; }
    if (type === "open_text") { q.min_words = 3; }
    if (type === "rating_grid") {
      q.select = "single";
      q.rows = [{ code: "a", label: "First row" }, { code: "b", label: "Second row" }];
      q.cols = [{ code: "c1", label: "Column one" }, { code: "c2", label: "Column two" },
                { code: "c3", label: "Column three" }];
    }
    if (type === "rating_scale") {
      q.scale = { min: 1, max: 5, min_label: "Not at all", mid_label: "Neutral", max_label: "Extremely" };
      q.rows = [{ code: "a", label: "First item" }, { code: "b", label: "Second item" }];
    }
    if (type === "semantic_diff") {
      q.scale = { min: 1, max: 7 };
      q.rows = [{ code: "a", label: "First item", left: "Poor", right: "Excellent" }];
    }
    if (type === "sum_to_100") {
      q.rows = [{ code: "a", label: "First item" }, { code: "b", label: "Second item" }];
    }
    if (type === "rank") {
      q.rank_count = 3;
      q.rows = [{ code: "a", label: "First item" }, { code: "b", label: "Second item" },
                { code: "c", label: "Third item" }];
    }
    if (type === "nps") { q.scale = { min: 0, max: 10 }; }
    if (type === "choice_task") q.conjoint = conjointTemplate();
    if (type === "emoji_grid") {
      q.scale = { min: 1, max: 5, faces: ["\uD83D\uDE1E", "\uD83D\uDE41", "\uD83D\uDE10", "\uD83D\uDE42", "\uD83D\uDE0D"],
                  face_labels: ["Very negative", "Negative", "Neutral", "Positive", "Delighted"] };
      q.rows = [{ code: "a", label: "First impression" }];
    }
    if (type === "heatmap") {
      q.rows = [{ code: "a", label: "First row" }];
      q.cols = [{ code: "c1", label: "Column one" }, { code: "c2", label: "Column two" }];
      q.heat_max = 3;
    }
    if (type === "maxdiff") { q.rounds = [{ items: ["a", "b", "c", "d"] }]; }
    if (type === "choice_task") { q.vignette = "Describe the patient here."; }
    if (type === "date") { q.help = ""; }
    if (type === "numeric_matrix") {
      q.min = 0; q.max = 100;
      q.rows = [{ code: "a", label: "First row" }, { code: "b", label: "Second row" }];
      q.cols = [{ code: "c1", label: "Column one" }, { code: "c2", label: "Column two" }];
    }
    if (type === "delta") { q.min = 0; q.max = 100; q.before_label = "Before"; q.after_label = "After"; }
    if (type === "concept_test") {
      q.concept = "Describe the concept here.";
      q.scale = { min: 1, max: 7, min_label: "Strongly disagree", max_label: "Strongly agree" };
      q.rows = [{ code: "a", label: "It is easy to understand" }, { code: "b", label: "It is relevant to me" }];
    }
    if (type === "loop") {
      q.child = "open_text"; q.prompt_template = "{label}"; q.text_rows = 2;
      q.items = [{ code: "i1", label: "First item" }, { code: "i2", label: "Second item" }];
    }
    if (type === "text_block") { q.required = false; q.body = "Add instructions, an introduction or a story here."; }
    return q;
  }

  function blankCfg() {
    return {
      title: "New study",
      // no predefined sections: a new study starts with one section for you to name
      sections: [{ id: "S1", title: "", blurb: null }],
      questions: [
        qTemplate("single_select", "Q1", "S1"),
        qTemplate("rating_grid", "Q2", "S1"),
        qTemplate("nps", "Q3", "S1"),
        qTemplate("open_text", "Q4", "S1")
      ],
      tpp: { patient: "", mechanism: "", trial: "", efficacy: "", safety: "",
             administration: "", cdx: "" },
      narration: {},
      explainer_scenes: [],
      conjoint_scene: null,
      conjoint: null,
      conjoint_min_dwell: 10,
      use_tts: true,
      metrics: {},
      qc: { min_seconds: 300, verbatim_qs: [] }
    };
  }

  // ---- conjoint experiment (authored on the choice_task question) -------------------------
  // Everything the author defines lives here: the experiment reference, the description the
  // respondent reads, the attributes with their levels, the toggles and the sampling plan.
  // cfg.conjoint (the generated design) is derived from it by "Generate design".
  function conjointTemplate() {
    return {
      title: "",
      description_html: "We will show you {amount} combinations of {product}. " +
        "Please indicate which one you would be most likely to purchase.",
      attributes: [
        { id: "A1", label: "Attribute 1", levels: ["Level 1", "Level 2"], images: [],
          higher_is_bad: false, group_inclusion: false, range: null },
        { id: "A2", label: "Attribute 2", levels: ["Level 1", "Level 2"], images: [],
          higher_is_bad: false, group_inclusion: false, range: null }
      ],
      allow_none: true, none_label: "None of these",
      n_cards: 2, n_sets: 6
    };
  }
  // An older question may carry no experiment of its own: derive one from the study design, so
  // the editor never shows an empty card on a study that already has a conjoint.
  function conjointOf(q) {
    if (q.conjoint) {
      var cj = q.conjoint;
      cj.attributes = cj.attributes || [];
      if (cj.n_cards == null) cj.n_cards = 2;
      if (cj.n_sets == null) cj.n_sets = 6;
      return cj;
    }
    var design = cur && cur.cfg && cur.cfg.conjoint, attrs = [];
    if (design && design.attributes) {
      attrs = design.attributes.map(function (a, i) {
        return { id: String(a.id || ("A" + (i + 1))), label: a.label || a.id || ("Attribute " + (i + 1)),
                 levels: (a.levels || []).slice(), images: a.images || [],
                 higher_is_bad: !!a.higher_is_bad, group_inclusion: !!a.group_inclusion, range: null };
      });
    }
    q.conjoint = {
      title: cj_title(design),
      description_html: conjointTemplate().description_html,
      attributes: attrs.length ? attrs : conjointTemplate().attributes,
      allow_none: design ? design.has_opt_out !== false : true,
      none_label: "None of these",
      n_cards: (design && design.n_alts) || 2,
      n_sets: (design && design.n_tasks) || 6
    };
    return q.conjoint;
  }
  function cj_title(design) { return (design && design.title) || ""; }

  // read the conjoint card back into the question.  Level inputs are read by (attribute, level)
  // index so a delete elsewhere in the form cannot shift values onto the wrong row.
  function syncConjointForm() {
    var cj = conjointOf(ed);
    var rich = document.getElementById("f-cj-desc");
    if (rich) { cj.description_html = unchip(Q.sanitize(rich.innerHTML)); cj.description = Q.stripTags(cj.description_html); }
    if (val("f-cj-title") !== undefined) cj.title = String(val("f-cj-title")).trim();
    if (val("f-vignette") !== undefined) setOrDel(ed, "vignette", val("f-vignette"));
    if (chk("f-cj-none") !== undefined) cj.allow_none = chk("f-cj-none") !== false;
    if (val("f-cj-nonelabel") !== undefined) cj.none_label = String(val("f-cj-nonelabel")).trim() || "None of these";
    if (val("f-cj-cards") !== undefined) cj.n_cards = Math.max(2, Math.min(5, num("f-cj-cards") || 2));
    if (val("f-cj-sets") !== undefined) cj.n_sets = Math.max(1, Math.min(30, num("f-cj-sets") || 6));
    $$('#st-editor [data-cj-field="label"]').forEach(function (n) {
      var a = cj.attributes[Number(n.getAttribute("data-i"))]; if (a) a.label = n.value;
    });
    $$('#st-editor [data-cj-field="level"]').forEach(function (n) {
      var a = cj.attributes[Number(n.getAttribute("data-i"))]; if (!a) return;
      var li = Number(n.getAttribute("data-l")); if (li >= 0 && li < a.levels.length) a.levels[li] = n.value;
    });
    $$("#st-editor [data-cj-range]").forEach(function (n) {
      var a = cj.attributes[Number(n.getAttribute("data-i"))]; if (!a) return;
      a.range = a.range || {};
      var k = n.getAttribute("data-cj-range");
      a.range[k] = k === "suffix" ? n.value : (n.value === "" ? null : Number(n.value));
    });
  }

  function nextQid() {
    var max = 0;
    cur.cfg.questions.forEach(function (q) { var m = /(\d+)$/.exec(q.id || ""); if (m) max = Math.max(max, Number(m[1])); });
    var id = "Q" + (max + 1);
    while (cur.cfg.questions.some(function (q) { return q.id === id; })) id += "b";
    return id;
  }

  // ------------------------------------------------------------ autosave
  var AUTOSAVE_KEY = "beacon.studio.autosave";
  var auto = { on: true, dirty: false, saving: false, queued: false, seq: 0, timer: null, lastSaved: null, error: null };
  try { auto.on = localStorage.getItem(AUTOSAVE_KEY) !== "off"; } catch (e) { /* private mode */ }

  function markChanged() {
    if (!cur) return;
    auto.dirty = true; auto.seq++;
    renderSaveState();
    if (auto.on) { clearTimeout(auto.timer); auto.timer = setTimeout(function () { flushSave(); }, 1100); }
  }
  // Rendering the Screening card seeds an empty rule set on the question being edited, and
  // the grid fields can be opened and left blank.  Neither is worth persisting, so an
  // author who only looked at a tab never ends up with a screener they did not write.
  function scrBlank(s) {
    if (!s || typeof s !== "object") return true;
    if (s.enabled === false) return false;                    // parked on purpose - keep it
    if ((s.rules || []).length || (s.rows || []).length) return false;
    if (String(s.message || "").trim() || String(s.reason || "").trim()) return false;
    if (s.sum && String(s.sum.value || "") !== "") return false;
    if (s.min && Object.keys(s.min).length) return false;
    if (s.max && Object.keys(s.max).length) return false;
    return true;
  }
  function anyText(o) { return o ? Object.keys(o).map(function (k) { return String(o[k] || ""); }).join("").trim() : ""; }
  function pruneEmptyExtras() {
    (cur && cur.cfg && cur.cfg.questions || []).forEach(function (q) {
      if (scrBlank(q.screening)) delete q.screening;
      if (q.grid && !anyText(q.grid)) delete q.grid;
      if (q.na && !q.na.rows && !q.na.col && String(q.na.label || "N/A") === "N/A") delete q.na;
      if (q.comments && String(q.comments.mode || "none") === "none" && !anyText({ l: q.comments.label })) delete q.comments;
    });
  }
  function flushSave(cb) {
    if (!cur) { if (cb) cb(); return; }
    clearTimeout(auto.timer);
    if (auto.saving) { auto.queued = true; if (cb) auto.cbs = (auto.cbs || []).concat([cb]); return; }
    if (!auto.dirty) { if (cb) cb(); return; }
    var seq = auto.seq, slug = cur.slug;
    pruneEmptyExtras();
    auto.saving = true; auto.error = null; renderSaveState();
    api("/api/studio/save", { slug: cur.slug, title: cur.title, cfg: cur.cfg }).then(function (r) {
      auto.saving = false;
      if (r.error) { auto.error = r.error; renderSaveState(); toast("Could not save: " + r.error); return; }
      if (cur && cur.slug === slug && auto.seq === seq) { auto.dirty = false; auto.lastSaved = new Date(); }
      renderSaveState();
      var cbs = auto.cbs || []; auto.cbs = [];
      if (auto.queued || auto.dirty) { auto.queued = false; setTimeout(function () { flushSave(); }, 150); }
      if (cb) cb();
      cbs.forEach(function (f) { if (f) f(); });
    }).catch(function () { auto.saving = false; auto.error = "network"; renderSaveState(); });
  }
  function renderSaveState() {
    var el = document.getElementById("st-savestate");
    if (!el) return;
    var html;
    if (auto.saving) html = '<span class="st-ss saving"><i class="st-spin"></i> Saving\u2026</span>';
    else if (auto.error) html = '<span class="st-ss err">\u26A0 Not saved</span><button class="st-btn sm warnb" data-act="save">Retry</button>';
    else if (auto.dirty) html = auto.on
      ? '<span class="st-ss dirty">\u25CF Unsaved changes \u00B7 saving shortly</span>'
      : '<span class="st-ss dirty">\u25CF Unsaved changes</span><button class="st-btn sm on" data-act="save">Save now</button>';
    else html = '<span class="st-ss ok">\u2713 All changes saved' + (auto.lastSaved ? " \u00B7 " + hhmm(auto.lastSaved) : "") + "</span>";
    el.innerHTML = html;
    var sw = document.getElementById("st-autosave"); if (sw) sw.checked = auto.on;
  }
  window.addEventListener("beforeunload", function (e) {
    if (cur && auto.dirty) { e.preventDefault(); e.returnValue = ""; }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && cur && auto.dirty && navigator.sendBeacon) {
      var blob = new Blob([JSON.stringify({ slug: cur.slug, title: cur.title, cfg: cur.cfg })], { type: "application/json" });
      if (navigator.sendBeacon("/api/studio/save", blob)) { auto.dirty = false; auto.lastSaved = new Date(); renderSaveState(); }
    }
  });
  window.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { if (cur) { e.preventDefault(); flushSave(function () { toast("Saved"); }); } }
    if (e.key === "Escape") { closeModal(); closePipePicker(); var ov = document.getElementById("qtest"); if (ov) ov.hidden = true; }
  });
  // A CSV of recipients is read in the browser and merged into the launch list: no upload,
  // no server-side file handling, and the addresses are visible before anything is sent.
  document.addEventListener("change", function (e) {
    var input = e.target;
    if (!input.getAttribute || input.getAttribute("data-act") !== "inv-csv" ||
        !input.files || !input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function () {
      var lines = String(reader.result || "").split(/\r?\n/);
      if ((lines[0] || "").toLowerCase().indexOf("email") >= 0) lines = lines.slice(1);
      var parsed = lines.map(function (ln) {
        var bits = ln.split(/[,;\t]/).map(function (x) { return x.trim().replace(/^"|"$/g, ""); });
        var email = bits.filter(function (b) { return b.indexOf("@") > 0; })[0] || "";
        var name = bits.filter(function (b) { return b && b !== email; }).join(" ");
        return email ? email + (name ? ", " + name : "") : "";
      }).filter(Boolean);
      var ta = document.getElementById("lf-recipients");
      if (!ta || !parsed.length) { toast("No email addresses found in that file"); input.value = ""; return; }
      var have = ta.value.split(/\r?\n/).map(function (x) { return x.split(",")[0].trim().toLowerCase(); });
      var added = 0;
      parsed.forEach(function (row) {
        var email = row.split(",")[0].trim().toLowerCase();
        if (have.indexOf(email) < 0) {
          ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/, "") + "\n" : "") + row;
          have.push(email); added++;
        }
      });
      var note = document.getElementById("lf-csv-note");
      if (note) note.textContent = added + " address" + (added === 1 ? "" : "es") + " read from the file";
      toast("Added " + added + " address" + (added === 1 ? "" : "es") + " from the CSV");
      input.value = "";                     // so the same file can be picked again
    };
    reader.readAsText(input.files[0]);
  });

  window.BeaconStudio = { flush: flushSave, state: auto, current: function () { return cur; } };

  // ------------------------------------------------------------ dashboard
  var homeFilter = "all", homeSearch = "";
  function loadList() {
    cur = null; sel = -1;
    root.innerHTML = '<div class="st-page"><div class="st-home"><div class="st-loading">Loading studies\u2026</div></div></div>';
    api("/api/studio/list").then(function (list) { studies = list; renderHome(); });
  }
  function renderHome() {
    var tops = studies.filter(function (s) { return !s.parent; });
    var kidsN = studies.length - tops.length;
    var live = tops.filter(function (s) { return s.status === "live"; }).length;
    var html = '<div class="st-page"><div class="st-home">' +
      '<div class="st-hero"><div><h1>Your studies</h1><p>Draft questions, preview exactly what respondents see, then launch. ' +
      tops.length + " stud" + (tops.length === 1 ? "y" : "ies") + (live ? " \u00B7 " + live + " live" : "") +
      (kidsN ? " \u00B7 " + kidsN + " translation" + (kidsN === 1 ? "" : "s") : "") + "</p></div>" +
      '<div class="st-hero-actions"><button class="st-btn big on" data-act="new">+ New study</button>' +
      '<button class="st-btn big" data-act="dup-beacon">Start from PROJECT BEACON</button></div></div>' +
      '<div class="st-ai-banner"><span class="st-ai-spark">✦</span><div><b>Research design, with an AI guide</b><p>Turn a business need, rough objectives or an existing questionnaire into a fully customizable study.</p></div><button class="st-btn sm" data-act="new">Explore ways to start</button></div>' +
      '<div class="st-home-tools"><input id="home-search" class="st-search" placeholder="Search studies\u2026" value="' + esc(homeSearch) + '">' +
      '<div class="st-seg">' + [["all", "All"], ["draft", "Draft"], ["live", "Live"], ["paused", "Paused"], ["closed", "Closed"]].map(function (f) {
        return '<button class="st-seg-btn' + (homeFilter === f[0] ? " on" : "") + '" data-act="home-filter" data-f="' + f[0] + '">' + f[1] + "</button>"; }).join("") + "</div></div>" +
      '<div class="st-grid" id="home-grid">' + homeCards() + "</div></div></div>";
    root.innerHTML = html;
  }
  function homeCards() {
    var q = homeSearch.trim().toLowerCase();
    var kids = {};
    studies.forEach(function (s) { if (s.parent) (kids[s.parent] = kids[s.parent] || []).push(s); });
    function matchQ(x) { return !q || (x.title + " " + x.slug).toLowerCase().indexOf(q) >= 0; }
    var list = studies.filter(function (s) {
      if (s.parent) return false;              // translations live inside the parent card
      return (homeFilter === "all" || s.status === homeFilter) &&
        (matchQ(s) || (kids[s.slug] || []).some(matchQ));
    });
    if (!list.length) return '<div class="st-empty">' + (studies.length ? "No studies match." : "No studies yet - create one to get started.") + "</div>";
    return list.map(function (s) {
      var pct = s.started ? Math.round(100 * s.complete / s.started) : 0;
      var ch = kids[s.slug] || [];
      var kidHtml = ch.length
        ? '<div class="st-card-kids"><div class="st-kids-head">Translations \u00B7 ' + ch.length + " \u2014 child surveys of this study</div>" +
          ch.map(function (k) {
            return '<div class="st-kid"><span class="st-kid-lang"><b>' + esc(langMeta(k.language).native) + "</b>" +
              "<small>/survey/" + esc(k.slug) + "</small></span>" +
              '<span class="st-kid-tools">' +
              '<button class="st-btn sm" data-act="open" data-slug="' + esc(k.slug) + '">Translate</button>' +
              '<a class="st-btn sm" href="/survey/' + esc(k.slug) + '/test" target="_blank" rel="noopener">Preview</a>' +
              '<button class="st-btn sm" data-act="copylink" data-slug="' + esc(k.slug) + '">Link</button>' +
              "</span></div>";
          }).join("") + "</div>"
        : "";
      return '<div class="st-card" data-slug="' + esc(s.slug) + '">' +
        '<div class="st-card-top"><h3>' + esc(s.title) + '</h3><span class="st-pill ' + s.status + '">' + s.status + "</span></div>" +
        '<div class="st-study-id">' + esc(s.study_id || "") + (s.group_name ? ' <span>· ' + esc(s.group_name) + '</span>' : '') + (s.parent_study ? ' <span>· child of ' + esc(s.parent_study) + '</span>' : '') + '</div>' +
        '<div class="st-meta">/survey/' + esc(s.slug) + " \u00B7 updated " + esc(ago(s.updated_at)) + "</div>" + kidHtml +
        '<div class="st-stats"><div><strong>' + s.started + "</strong><span>started</span></div><div><strong>" + s.complete + "</strong><span>complete</span></div>" +
        '<div class="st-stat-bar"><i style="width:' + pct + '%"></i></div><span class="st-meta">' + pct + "% completion</span></div>" +
        '<div class="st-card-actions">' +
        '<button class="st-btn on" data-act="open" data-slug="' + esc(s.slug) + '">Open builder</button>' +
        '<a class="st-btn st-act-preview" href="/survey/' + esc(s.slug) + '/test" target="_blank" rel="noopener"' +
        ' data-act="preview" title="Opens the testing link in a new window - question jump, tester notes and AI test answers">\uD83D\uDC41 Preview Survey</a>' +
        '<button class="st-btn st-act-dup" data-act="dup" data-slug="' + esc(s.slug) + '">\u2398 Duplicate Survey</button>' +
        "</div>" +
        '<div class="st-card-actions">' + homeRunButtons(s) + "</div>" +
        homeInviteLine(s) +
        '<div class="st-card-tools">' +
        '<span class="st-more">' +
        '<button class="st-ibtn" title="Copy respondent link" data-act="copylink" data-slug="' + esc(s.slug) + '">\uD83D\uDD17</button>' +
        (s.status !== "closed" ? '<button class="st-ibtn" title="Close the study - no new respondents and no new submissions" data-act="status" data-status="closed" data-slug="' + esc(s.slug) + '">\u23F9</button>' : "") +
        (s.slug !== "beacon" ? '<button class="st-ibtn danger" title="Delete study" data-act="del" data-slug="' + esc(s.slug) + '">\u2715</button>' : "") +
        "</span></div></div>";
    }).join("");
  }

  // Launch / Pause / Relaunch / Reminder, and the invite summary under them.  The buttons
  // follow the study status: a draft gets Launch, a live study gets Pause + Reminder, and a
  // paused one gets Relaunch.
  function homeRunButtons(s) {
    var left = Math.max(0, 2 - (s.reminders_sent || 0));
    var out = "";
    if (s.status === "live") {
      out += '<button class="st-btn st-act-pause" data-act="pause" data-slug="' + esc(s.slug) +
        '" title="Stop new respondents starting; anyone already answering can finish">\u23F8 Pause Survey</button>';
    } else if (s.status === "paused") {
      out += '<button class="st-btn st-act-launch" data-act="relaunch" data-slug="' + esc(s.slug) +
        '" title="Open the study to new respondents again">\u25B6 Relaunch Survey</button>';
    } else {
      out += '<button class="st-btn st-act-launch" data-act="launch" data-slug="' + esc(s.slug) +
        '" title="Go live, create the public link and send the invites">\u{1F680} Launch Survey</button>';
    }
    var remindTip = !s.recipients
      ? "Add recipients when you launch, then send them a reminder"
      : (left ? "Email everyone on the list who has not taken part yet" : "Both reminders have already been sent");
    out += '<button class="st-btn st-act-remind" data-act="remind" data-slug="' + esc(s.slug) + '"' +
      (s.recipients && left && s.status !== "draft" ? "" : " disabled") + ' title="' + esc(remindTip) + '">' +
      "\u{1F514} Send Reminder (" + left + " left)</button>";
    return out;
  }
  function homeInviteLine(s) {
    if (!s.recipients && !s.invites_sent && !s.invites_failed) {
      return '<div class="st-meta st-invites">No invite list yet - launch to create the public link and email your panel.</div>';
    }
    var bits = [s.recipients + " recipient" + (s.recipients === 1 ? "" : "s")];
    if (s.invites_sent) bits.push(s.invites_sent + " sent");
    if (s.invites_queued) bits.push(s.invites_queued + " recorded in the log");
    if (s.invites_failed) bits.push('<span class="bad">' + s.invites_failed + " failed</span>");
    if (s.launched_at) bits.push("launched " + esc(ago(s.launched_at)));
    return '<div class="st-meta st-invites">' + bits.join(" \u00B7 ") +
      ' <button class="st-link" data-act="outbox" data-slug="' + esc(s.slug) +
      '">View invite log</button></div>';
  }

  // ------------------------------------------------------------ launch / reminder / outbox
  function openLaunchModal(slug) {
    api("/api/studio/invites?study=" + encodeURIComponent(slug)).then(function (d) {
      if (d.error) { toast(d.error); return; }
      var who = (d.recipients || []).map(function (r) { return r.email + (r.name ? ", " + r.name : ""); }).join("\n");
      var link = d.link || location.origin + "/survey/" + slug;   // already absolute
      var smtp = d.smtp.configured
        ? 'Invites are emailed through <b>' + esc(d.smtp.host) + "</b> as <b>" + esc(d.smtp.from) +
          "</b>, and every send is kept in the log below."
        : "No SMTP server is configured, so invites are <b>recorded in the log</b> with their personal " +
          "links (copy them from the log, or set <code>BEACON_SMTP_HOST</code> to send for real).";
      openModal(
        '<div class="st-modal-head"><strong>Launch ' + esc(d.title) + "</strong>" +
          '<span class="st-meta">' + (d.recipients.length ? d.recipients.length + " on the list" : "no recipients yet") + "</span>" +
          '<button class="ex-close" data-act="modal-close" type="button">&times;</button></div>' +
        '<div class="st-new-form">' +
        '<label class="st-field"><span>Public link <em class="st-opt">goes live when you launch</em></span>' +
          '<span class="st-copyrow"><input id="lf-link" readonly value="' + esc(link) + '">' +
          '<button class="st-btn sm" type="button" data-act="copy-public" data-slug="' + esc(slug) + '">Copy</button></span></label>' +
        '<label class="st-field"><span>Invite these people <em class="st-opt">one per line: email, or email, name</em></span>' +
          '<textarea id="lf-recipients" rows="6" placeholder="dr.smith@clinic.org, Dr A Smith\npanel@example.com">' + esc(who) + "</textarea></label>" +
        '<div class="st-row"><label class="st-btn sm ghost" title="A CSV with an email column (and an optional name column)">' +
          "\u2B06 Upload CSV<input type=\"file\" accept=\".csv,text/csv\" data-act=\"inv-csv\" hidden></label>" +
          '<span class="st-meta" id="lf-csv-note">or paste the list above</span></div>' +
        '<div class="st-grid2"><label class="st-field"><span>Subject</span><input id="lf-subject" value="' +
          esc(d.subject) + '"></label>' +
          '<label class="st-field"><span>How many reminders allowed</span><input value="' + d.max_reminders +
          ' per launch" readonly></label></div>' +
        '<label class="st-field"><span>Message <em class="st-opt">optional - the link is added automatically</em></span>' +
          '<textarea id="lf-message" rows="3" placeholder="Why their view matters, how long it takes...">' + esc(d.message) + "</textarea></label>" +
        '<div class="st-note">' + smtp + "</div>" +
        '<div class="st-modal-actions">' +
          '<button class="st-btn" data-act="modal-close" type="button">Cancel</button>' +
          '<button class="st-btn" data-act="launch-save" data-slug="' + esc(slug) + '" type="button" title="Store the list without going live">Save list only</button>' +
          '<button class="st-btn on" data-act="launch-go" data-slug="' + esc(slug) + '" type="button">Launch &amp; send invites</button>' +
        "</div></div>", "st-launch-modal");
    });
  }

  function openOutboxModal(slug) {
    api("/api/studio/invites?study=" + encodeURIComponent(slug)).then(function (d) {
      if (d.error) { toast(d.error); return; }
      var rows = d.outbox || [];
      var label = { sent: "sent", queued: "queued (not emailed)", failed: "failed" };
      openModal(
        '<div class="st-modal-head"><strong>Invite log</strong><span class="st-meta">' + esc(d.title) +
          '</span><button class="ex-close" data-act="modal-close" type="button">&times;</button></div>' +
        '<div class="st-new-form">' +
        '<div class="st-kpis">' + kpi(d.summary.recipients, "recipients") + kpi(d.summary.sent, "emailed") +
          kpi(d.summary.queued, "recorded only") + kpi(d.summary.completed, "took part") + "</div>" +
        '<div class="st-note">' + (d.smtp.configured
            ? "Sending through <b>" + esc(d.smtp.host) + "</b>."
            : "No SMTP configured - each row below is a ready-to-send invite with its own personal link.") +
          " Reminders sent: " + d.reminders_sent + " of " + d.max_reminders + ".</div>" +
        '<div class="st-outbox">' + (rows.length ? '<table class="st-tbl-out"><thead><tr>' +
            "<th>Email</th><th>Type</th><th>Status</th><th>When</th><th>Personal link</th></tr></thead><tbody>" +
            rows.map(function (r) {
              return "<tr><td>" + esc(r.email) + (r.name ? '<small> ' + esc(r.name) + "</small>" : "") +
                "</td><td>" + esc(r.kind) + '</td><td class="' + esc(r.status) + '">' + esc(label[r.status] || r.status) +
                (r.error ? '<small title="' + esc(r.error) + '"> ' + esc(r.error.slice(0, 40)) + "</small>" : "") +
                "</td><td>" + esc(ago(r.created_at)) + "</td>" +
                '<td><input readonly value="' + esc(r.link) + '" class="st-link-in"></td></tr>'; }).join("") +
            "</tbody></table>"
          : '<div class="st-empty">Nothing has been sent yet.</div>') + "</div>" +
        '<div class="st-modal-actions">' +
          '<a class="st-btn" href="/api/studio/invites.csv?study=' + encodeURIComponent(slug) + '">Download CSV</a>' +
          '<button class="st-btn" data-act="modal-close" type="button">Close</button>' +
          (d.summary.pending && d.reminders_left ? '<button class="st-btn on" data-act="remind" data-slug="' +
            esc(slug) + '" type="button">Send reminder to ' + d.summary.pending + "</button>" : "") +
        "</div></div>", "st-outbox-modal");
    });
  }

  function launchStudy(slug, draftOnly) {
    var ta = document.getElementById("lf-recipients");
    api("/api/studio/launch", {
      slug: slug,
      recipients: ta ? ta.value : "",
      subject: (document.getElementById("lf-subject") || {}).value || "",
      message: (document.getElementById("lf-message") || {}).value || "",
      draft_only: !!draftOnly,
    }).then(function (r) {
      if (r.error) { toast(r.error); return; }
      closeModal();
      var bits = r.total ? r.total + " invite" + (r.total === 1 ? "" : "s") +
        (r.smtp ? " emailed (" + r.sent + " sent, " + r.failed + " failed)" : " recorded in the invite log") : "link created";
      if (r.rejected && r.rejected.length) bits += " \u00B7 " + r.rejected.length + " address(es) skipped";
      toast((draftOnly ? "List saved \u00B7 " : "Live at /survey/" + slug + " \u00B7 ") + bits);
      loadList();
    });
  }

  function remindStudy(slug) {
    api("/api/studio/remind", { slug: slug }).then(function (r) {
      if (r.error) { toast(r.error); return; }
      closeModal();
      toast("Reminder " + (r.reminders_sent) + " of " + r.max_reminders + " sent to " + r.reminded +
        " " + (r.reminded === 1 ? "person" : "people") +
        (r.smtp ? " (" + r.sent + " emailed, " + r.failed + " failed)" : " - recorded in the invite log"));
      loadList();
    });
  }

  // ------------------------------------------------------------ builder shell
  function openEditor(slug, done) {
    api("/api/studio/study?slug=" + encodeURIComponent(slug))
      .then(function (s) {
        if (s.error) { toast("Study not found: /" + slug); loadList(); return; }
        cur = s; tab = "questions"; sel = (s.cfg.questions || []).length ? 0 : -1;
        auto.dirty = false; auto.error = null; auto.lastSaved = null;
        renderEditor();
        if (location.hash !== "#" + slug) history.replaceState(null, "", location.pathname + location.search + "#" + slug);
        if (done) setTimeout(done, 60);
      });
  }

  function renderEditor() {
    if (cur && cur.cfg && cur.cfg.parent) { renderChildEditor(); return; }
    var c = cur.cfg;
    var html = '<div class="st-bar">' +
      '<button class="st-btn ghost" data-act="back" title="Back to all studies">\u2190 Studies</button>' +
      '<input type="text" id="ed-title" class="st-title" value="' + esc(cur.title) + '" title="Study title">' +
      '<div class="st-status-seg" title="Draft: only the team can open it. Live: respondents can answer. Paused: nobody new can start. Closed: no new starts or submissions.">' +
        ["draft", "live", "paused", "closed"].map(function (s) {
          return '<button class="st-status-btn ' + s + (s === cur.status ? " on" : "") + '" data-act="setstatus" data-status="' + s + '">' + s + "</button>"; }).join("") + "</div>" +
      '<div id="st-savestate" class="st-savestate"></div>' +
      '<label class="st-switch" title="Save automatically a moment after every change"><input type="checkbox" id="st-autosave"' + (auto.on ? " checked" : "") + '><i></i>Autosave</label>' +
      '<button class="st-btn" data-act="save" title="Ctrl/Cmd + S">Save now</button>' +
      '<button class="st-btn play" data-act="viewlive" title="Open the full test environment with question jump, notes, AI answers and team review links">\u25B6 Test survey</button>' +
      '<div class="st-menu-wrap"><button class="st-btn" data-act="sopts" title="Survey options">SURVEY OPTIONS \u25BE</button>' +
        '<div class="st-menu" id="st-sopts" hidden>' +
        '<button type="button" data-act="so-settings">Settings</button>' +
        '<button type="button" data-act="so-share">Share survey preview</button>' +
        '<button type="button" data-act="so-move">Move survey\u2026</button>' +
        '<button type="button" data-act="so-dup">Duplicate</button>' +
        '<button type="button" data-act="so-word">Download Word Outline</button>' +
        '<button type="button" data-act="so-track">Start Tracking</button>' +
        '<button type="button" data-act="so-duptr">Duplicate &amp; Translate\u2026</button>' +
        '<button type="button" data-act="so-global">Globalize Survey\u2026</button>' +
        '<button type="button" data-act="so-title">Edit title and language\u2026</button>' +
        '<button type="button" class="danger" data-act="so-del">Delete survey</button>' +
        "</div></div>" +
      "</div>" +
      '<nav class="st-tabs">' +
      tabList(c).map(function (t) {
        return '<button class="st-tab' + (tab === t[0] ? " on" : "") + '" data-tab="' + t[0] + '">' + t[1] +
          (t[2] !== "" ? '<span class="st-count">' + t[2] + "</span>" : "") + "</button>";
      }).join("") + "</nav>" +
      '<div id="st-panel" class="st-panel-host"></div>' +
      '<button class="st-ai-fab" data-act="ai-guide"><span>✦</span><b>Ask research agent</b><small>Guidance throughout your build</small></button>';
    root.innerHTML = html;
    renderSaveState();
    renderTab();
  }

  // The Conjoint tab is only relevant once a conjoint question exists - until then it is not in
  // the bar at all, so a plain questionnaire is not cluttered with an empty tab.
  function hasConjointQuestion(cfg) {
    var c = cfg || (cur && cur.cfg) || {};
    return (c.questions || []).some(function (q) { return q.type === "choice_task"; }) ||
      !!(c.conjoint && c.conjoint.tasks);
  }
  function tabList(c) {
    var t = [["questions", "Questions", c.questions.length], ["translations", "Translations", ""],
             ["tpp", "Walkthrough", (c.explainer_scenes || []).length || ""]];
    if (hasConjointQuestion(c)) t.push(["conjoint", "Conjoint", ""]);
    return t.concat([["settings", "Settings & QC", ""], ["responses", "Responses", ""], ["analysis", "Analysis", ""]]);
  }
  // keep the bar in step with the questions (adding/removing a conjoint question changes it).
  // Rebuilding the shell re-enters this, so guard against recursing.
  var syncingTabs = false;
  function syncTabs() {
    if (!cur || syncingTabs) return;
    var nav = $(".st-tabs"); if (!nav) return;
    var wanted = tabList(cur.cfg).map(function (t) { return t[0]; });
    var have = $$(".st-tab", nav).map(function (b) { return b.getAttribute("data-tab"); });
    if (wanted.join(",") !== have.join(",")) {
      syncingTabs = true;
      try { renderEditor(); } finally { syncingTabs = false; }
      return;
    }
    if (tab === "conjoint" && wanted.indexOf("conjoint") < 0) { tab = "questions"; renderTab(); }
  }

  function renderTab() {
    var p = document.getElementById("st-panel");
    $$(".st-tab").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === tab); });
    if (tab === "questions") { p.innerHTML = workspace(); renderOutline(); renderEditorPane(); return; }
    p.innerHTML = '<div class="st-page"><div class="st-panel">' +
      (tab === "translations" ? translationsTab() : tab === "tpp" ? tppTab() : tab === "conjoint" ? conjointTab() : tab === "settings" ? settingsTab() : "<p>Loading\u2026</p>") + "</div></div>";
    if (tab === "translations") refreshTranslationsTab();
    if (tab !== "questions") {
      var ph = p.querySelector(".st-page-head");
      if (ph) ph.insertAdjacentHTML("afterbegin",
        '<button class="st-backtab" data-act="tab-back" type="button" title="Back to the Questions workspace">\u2190 Questions</button>');
    }
    if (tab === "tpp") renderScenePrev();
    if (tab === "responses") responsesTab($(".st-panel", p));
    if (tab === "analysis") analysisTab($(".st-panel", p));
  }

  // ------------------------------------------------------------ questions workspace
  function workspace() {
    return '<div class="st-ws">' +
      '<aside class="st-outline" id="st-outline"></aside>' +
      '<section class="st-editor" id="st-editor"></section>' +
      '<aside class="st-preview" id="st-previewpane">' +
        '<div class="st-prev-head"><strong>Live preview</strong>' +
        '<div class="st-seg sm"><button class="st-seg-btn on" data-act="prev-dev" data-dev="desktop" title="Desktop width">\uD83D\uDDA5</button>' +
        '<button class="st-seg-btn" data-act="prev-dev" data-dev="phone" title="Phone width">\uD83D\uDCF1</button></div>' +
        '<label class="st-inline" title="Fill earlier questions with sample answers so piping and logic can be checked"><input type="checkbox" id="prev-sample" checked> sample answers</label>' +
        '<button class="st-btn sm" data-act="prev-reshuffle" title="Draw a new random order">\u21BB</button>' +
        '<button class="st-btn sm" data-act="qtest-cur" title="Open this question full size">\u25B6 Test</button></div>' +
        '<div id="st-prev-body" class="survey-skin st-prev-body"></div>' +
        '<div id="st-prev-note" class="st-note"></div>' +
      "</aside></div>";
  }

  function qBadges(q) {
    var b = "";
    if (q.required === false) b += '<span class="st-badge" title="Optional">optional</span>';
    if (q.show_if && q.show_if.rules && q.show_if.rules.length && q.show_if.off !== true) b += '<span class="st-badge logic" title="Shown only when its conditions are met">logic</span>';
    var sc = Q.screening(q);
    if (sc.length) b += '<span class="st-badge screen" title="' + esc(sc.map(function (x) {
      return (x.mode === "qualify" ? "Qualify: " : "Screen out: ") + Q.blockText(x, cur.cfg.questions);
    }).join(" \u00B7 ")) + '">screen</span>';
    if (q.randomize && q.randomize !== "none") b += '<span class="st-badge" title="Randomised order">rnd</span>';
    if (q.media && q.media.src) b += '<span class="st-badge" title="Has image / video">media</span>';
    if ((q.options || []).some(function (o) { return o.exclusive; })) b += '<span class="st-badge" title="Has an exclusive option">excl</span>';
    return b;
  }
  // The outline lists the questions either as compact rows or as thumbnails.  The choice lives in
  // localStorage so it survives a reload, the same way the autosave switch does.
  var OUTLINE_VIEW_KEY = "beacon.studio.outline_view";
  var outlineView = "list";
  try { if (localStorage.getItem(OUTLINE_VIEW_KEY) === "thumbs") outlineView = "thumbs"; } catch (e) { /* private mode */ }

  function qTitle(q) { return String(q.title || "").trim(); }
  // An unnamed section is named by the author, not by us - show it as a prompt, never as
  // "Section 2".  Empty titles are stored empty so nothing predefined is ever written.
  function secLabel(sec) { return String((sec && sec.title) || "").trim() || "Untitled section"; }
  function qMoveTools(qi) {
    return '<button class="st-ibtn" data-act="qup" data-i="' + qi + '" title="Move up">\u25B2</button>' +
      '<button class="st-ibtn" data-act="qdown" data-i="' + qi + '" title="Move down">\u25BC</button>' +
      '<button class="st-ibtn" data-act="qdup" data-i="' + qi + '" title="Duplicate">\u2398</button>' +
      '<button class="st-ibtn danger" data-act="qdel" data-i="' + qi + '" title="Delete">\u2715</button>';
  }

  function outlineRow(q, qi) {
    var t = tinfo(q.type), title = qTitle(q);
    return '<div class="st-qi' + (qi === sel ? " on" : "") + '" data-qi="' + qi + '" data-act="qsel" tabindex="0">' +
      '<span class="st-qi-ic" title="' + esc(t.name) + '">' + t.icon + "</span>" +
      '<span class="st-qi-main' + (title ? " has-title" : "") + '">' +
      '<span class="st-qi-id">' + esc(q.id) + "</span>" +
      (title ? '<span class="st-qi-title">' + esc(title) + "</span>" : "") +
      '<span class="st-qi-stem">' + esc(q.stem || "(no text yet)") + "</span>" +
      '<span class="st-qi-badges">' + qBadges(q) + "</span></span>" +
      '<span class="st-qi-tools">' + qMoveTools(qi) + "</span></div>";
  }

  // ---- thumbnail view ---------------------------------------------------------------------
  // A miniature of the question as the respondent sees it: the wording, then a schematic of the
  // answer area drawn from the question itself.  Cheap enough to redraw on every keystroke.
  function thumbOptions(q, max) {
    var opts = (q.options || []).slice(0, max || 4);
    if (!opts.length) return "";
    var multi = q.type === "multi_select";
    var html = '<div class="st-tb-opts">' + opts.map(function (o) {
      return '<span class="st-tb-opt"><i class="' + (multi ? "st-tb-box" : "st-tb-radio") + '"></i>' +
        esc(String(o.label || "").slice(0, 26)) + "</span>";
    }).join("");
    var extra = (q.options || []).length - opts.length;
    if (extra > 0) html += '<span class="st-tb-more">+' + extra + " more</span>";
    return html + "</div>";
  }
  function thumbScale(q) {
    var sc = q.scale || {}, lo = Number(sc.min != null ? sc.min : 1), hi = Number(sc.max != null ? sc.max : 7);
    var n = Math.max(2, Math.min(7, hi - lo + 1)), cells = "";
    for (var i = 0; i < n; i++) cells += '<i class="st-tb-cell"></i>';
    return '<div class="st-tb-scale">' + (sc.min_label ? '<span class="st-tb-lab">' + esc(String(sc.min_label).slice(0, 14)) + "</span>" : "") +
      '<span class="st-tb-cells">' + cells + "</span>" +
      (sc.max_label ? '<span class="st-tb-lab">' + esc(String(sc.max_label).slice(0, 14)) + "</span>" : "") + "</div>";
  }
  function thumbRows(q, max) {
    var rows = (q.rows || []).slice(0, max || 3);
    if (!rows.length) return "";
    return '<div class="st-tb-rows">' + rows.map(function (r) {
      return '<span class="st-tb-row"><b>' + esc(String(r.label || "").slice(0, 20)) + "</b><i></i></span>";
    }).join("") + ((q.rows || []).length > rows.length ? '<span class="st-tb-more">+' + ((q.rows || []).length - rows.length) + " more</span>" : "") + "</div>";
  }
  function thumbBody(q) {
    switch (q.type) {
      case "single_select":
      case "multi_select":
        return thumbOptions(q);
      case "rating_grid":
        return thumbRows(q, 3);
      case "rating_scale":
      case "semantic_diff":
      case "nps":
      case "concept_test":
        return (q.type === "concept_test" ? thumbRows(q, 2) : "") + thumbScale(q);
      case "heatmap":
        return thumbRows(q, 2) + thumbScale(q);
      case "rank":
        return '<div class="st-tb-rows">' + (q.rows || []).slice(0, 3).map(function (r, i) {
          return '<span class="st-tb-row"><b>' + (i + 1) + ".</b>" + esc(String(r.label || "").slice(0, 20)) + "</span>";
        }).join("") + "</div>";
      case "open_text":
        return '<div class="st-tb-text">' + '<i></i><i></i><i class="short"></i>' + "</div>";
      case "numeric":
      case "slider": {
        var unit = q.suffix || q.prefix || "";
        return '<div class="st-tb-num"><span class="st-tb-input"></span>' +
          (unit ? '<span class="st-tb-lab">' + esc(String(unit).slice(0, 8)) + "</span>" : "") + "</div>";
      }
      case "date":
        return '<div class="st-tb-num"><span class="st-tb-input wide"></span></div>';
      case "loop":
        return '<div class="st-tb-rows">' + '<span class="st-tb-row"><b>' + esc(String((q.items || [])[0] && (q.items[0].label || "")).slice(0, 20)) + "</b><i></i></span>" +
          '<span class="st-tb-text"><i></i><i class="short"></i></span>' + "</div>";
      case "sum_to_100":
        return '<div class="st-tb-rows">' + (q.rows || []).slice(0, 3).map(function (r) {
          return '<span class="st-tb-row"><b>' + esc(String(r.label || "").slice(0, 20)) + '</b><span class="st-tb-pct">%</span></span>';
        }).join("") + "</div>";
      case "text_block":
        return '<div class="st-tb-text"><i></i><i></i><i class="short"></i></div>';
      case "conjoint":
      case "choice_task":
      case "maxdiff":
        return '<div class="st-tb-cards"><i></i><i></i><i></i></div>';
      default:
        return '<div class="st-tb-text"><i></i><i class="short"></i></div>';
    }
  }
  function thumbCard(q, qi) {
    var t = tinfo(q.type), title = qTitle(q);
    return '<div class="st-tcard' + (qi === sel ? " on" : "") + '" data-qi="' + qi + '" data-act="qsel" tabindex="0">' +
      '<div class="st-tcard-top"><span class="st-tcard-ic" title="' + esc(t.name) + '">' + t.icon + "</span>" +
      '<span class="st-tcard-id">' + esc(q.id) + "</span>" +
      '<span class="st-tcard-tools">' + qMoveTools(qi) + "</span></div>" +
      (title ? '<div class="st-tcard-title">' + esc(title) + "</div>" : "") +
      '<div class="st-tcard-stem">' + esc(q.stem || "(no text yet)") + "</div>" +
      '<div class="st-tcard-body">' + thumbBody(q) + "</div>" +
      '<div class="st-tcard-foot">' + qBadges(q) + '<span class="st-meta">' + esc(t.name) + "</span></div></div>";
  }

  function renderOutline() {
    var host = document.getElementById("st-outline"); if (!host) return;
    var c = cur.cfg, thumbs = outlineView === "thumbs";
    var html = '<div class="st-outline-head"><strong>Questions</strong><span class="st-meta">' + c.questions.length + " total</span>" +
      '<div class="st-seg sm st-viewseg"><button class="st-seg-btn' + (thumbs ? "" : " on") + '" data-act="outline-view" data-v="list" title="Compact list">\u2261 List</button>' +
      '<button class="st-seg-btn' + (thumbs ? " on" : "") + '" data-act="outline-view" data-v="thumbs" title="Preview thumbnails">\u25A6 Thumbnails</button></div>' +
      '<button class="st-ibtn" data-act="addsec" title="Add a section">+ Section</button></div>';
    c.sections.forEach(function (sec, si) {
      var n = c.questions.filter(function (q) { return q.section === sec.id; }).length;
      html += '<div class="st-sec' + (thumbs ? " thumbs" : "") + '"><div class="st-sec-head">' +
        '<input value="' + esc(sec.title) + '" data-sec-title="' + si + '" title="Click to rename this section - used in the Studio outline and in exports; respondents never see it" placeholder="Name this section">' +
        '<span class="st-meta">' + n + "</span>" +
        '<button class="st-ibtn danger" title="Delete section" data-act="delsec" data-i="' + si + '">\u2715</button></div>';
      if (thumbs) html += '<div class="st-tgrid">';
      c.questions.forEach(function (q, qi) {
        if (q.section !== sec.id) return;
        html += thumbs ? thumbCard(q, qi) : outlineRow(q, qi);
      });
      if (thumbs) html += "</div>";
      if (!n) html += '<div class="st-sec-empty">No questions in this section yet.</div>';
      html += '<button class="st-addq" data-act="qadd" data-sec="' + esc(sec.id) + '">+ Add question</button></div>';
    });
    html += '<button class="st-btn ghost wide" data-act="addsec">+ Add section</button>';
    host.innerHTML = html;
    syncTabs();
  }
  function refreshOutlineRow() {
    var q = cur.cfg.questions[sel];
    if (!q) return;
    var row = $('.st-qi[data-qi="' + sel + '"]');
    if (row) {
      $(".st-qi-id", row).textContent = q.id;
      $(".st-qi-stem", row).textContent = q.stem || "(no text yet)";
      $(".st-qi-badges", row).innerHTML = qBadges(q);
      $(".st-qi-ic", row).textContent = tinfo(q.type).icon;
      var main = $(".st-qi-main", row), title = qTitle(q);
      var tn = $(".st-qi-title", row);
      if (title && !tn) { tn = document.createElement("span"); tn.className = "st-qi-title"; main.insertBefore(tn, $(".st-qi-stem", row)); }
      if (tn) { tn.textContent = title; if (!title) tn.remove(); }
      main.classList.toggle("has-title", !!title);
    }
    var tc = $('.st-tcard[data-qi="' + sel + '"]');
    if (tc) {
      var tt = $(".st-tcard-title", tc), t2 = qTitle(q), tn2 = $(".st-tcard-title", tc);
      if (t2 && !tn2) { tn2 = document.createElement("div"); tn2.className = "st-tcard-title"; tc.insertBefore(tn2, $(".st-tcard-stem", tc)); }
      if (tn2) { tn2.textContent = t2; if (!t2) tn2.remove(); }
      $(".st-tcard-stem", tc).textContent = q.stem || "(no text yet)";
      $(".st-tcard-body", tc).innerHTML = thumbBody(q);
      $(".st-tcard-foot", tc).innerHTML = qBadges(q) + '<span class="st-meta">' + esc(tinfo(q.type).name) + "</span>";
      $(".st-tcard-id", tc).textContent = q.id;
      $(".st-tcard-ic", tc).textContent = tinfo(q.type).icon;
    }
  }
  function refreshSectionSelect() {
    var sl = document.getElementById("f-section"); if (!sl || !ed) return;
    sl.innerHTML = cur.cfg.sections.map(function (s) { return '<option value="' + esc(s.id) + '"' + (ed.section === s.id ? " selected" : "") + ">" + esc(secLabel(s)) + "</option>"; }).join("");
  }
  function selectQuestion(qi) {
    if (qi !== sel) scrTest = {};          // the screening tester starts clean per question
    sel = qi;
    if (migrateLegacyGrid(cur.cfg.questions[qi])) markChanged();
    // the outline may be showing rows or thumbnails - mark the selection in whichever is up
    $$(".st-qi, .st-tcard").forEach(function (r) { r.classList.toggle("on", Number(r.getAttribute("data-qi")) === qi); });
    renderEditorPane();
    var row = $('.st-qi[data-qi="' + qi + '"]'); if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
  }

  // ---- type picker (modal) ---------------------------------------------------------------
  function openModal(html, cls) {
    var m = document.getElementById("st-modal");
    m.innerHTML = '<div class="st-modal-box ' + (cls || "") + '">' + html + "</div>";
    m.hidden = false;
    setTimeout(function () { var f = $("[autofocus]", m); if (f) f.focus(); }, 20);
  }
  function closeModal() { var m = document.getElementById("st-modal"); if (m) { m.hidden = true; m.innerHTML = ""; } }
  function openTypePicker(secId, afterQi) {
    var html = '<div class="st-modal-head"><strong>Add a question</strong><span class="st-meta">Pick the kind of answer you need - you can change it later.</span>' +
      '<button class="st-btn sm ghost" data-act="modal-close" type="button">\u2190 Back</button><button class="ex-close" data-act="modal-close" type="button">&times;</button></div>';
    GROUPS.forEach(function (g) {
      html += '<div class="st-type-group">' + g + '</div><div class="st-type-grid">';
      TYPES.filter(function (t) { return TYPE_INFO[t].group === g; }).forEach(function (t) {
        var i = TYPE_INFO[t];
        html += '<button class="st-type" data-act="qadd-type" data-type="' + t + '" data-sec="' + esc(secId) + '" data-after="' + afterQi + '">' +
          '<span class="st-type-ic">' + i.icon + '</span><span><b>' + esc(i.name) + "</b><small>" + esc(i.desc) + (i.noprev ? " \u00B7 no live preview yet" : "") + "</small></span></button>";
      });
      html += "</div>";
    });
    html += '<div class="st-type-group">Survey flow \u00B7 pages &amp; objects</div><div class="st-type-grid">' +
      [["cmd-welcome", "\u2615", "Welcome Page", "The introduction respondents see before question 1"],
       ["cmd-thanks", "\u2714", "Thank You Page", "Shown when they finish the survey"],
       ["cmd-page", "\u25A1", "Question Page", "Start a new page of questions"],
       ["cmd-randomizer", "\u21C4", "Page Randomizer", "Respondents see the middle pages in a random order"],
       ["cmd-embedded", "\u207D\u207E", "Embedded Variable", "Capture values passed in the survey link, e.g. ?panel=A"]]
      .map(function (c2) {
        return '<button class="st-type" data-act="' + c2[0] + '" data-sec="' + esc(secId) + '" data-after="' + afterQi + '">' +
          '<span class="st-type-ic">' + c2[1] + '</span><span><b>' + c2[2] + "</b><small>" + c2[3] + "</small></span></button>";
      }).join("") + "</div>";
    openModal(html, "st-typepick");
  }
  function addPage(afterSec) {
    var n = cur.cfg.sections.length + 1, id = "S" + n;
    while (cur.cfg.sections.some(function (s2) { return s2.id === id; })) { n++; id = "S" + n; }
    var at = cur.cfg.sections.length;
    if (afterSec) { for (var i2 = 0; i2 < cur.cfg.sections.length; i2++) if (cur.cfg.sections[i2].id === afterSec) at = i2 + 1; }
    cur.cfg.sections.splice(at, 0, { id: id, title: "New page", blurb: null });
    markChanged(); renderOutline(); refreshSectionSelect();
    toast("Added a question page - rename it in the outline");
  }
  function addQuestion(type, secId, afterQi) {
    var q = qTemplate(type, nextQid(), secId);
    var at = afterQi >= 0 ? afterQi + 1 : cur.cfg.questions.length;
    // keep it inside its section: insert after the last question of that section when appending
    if (afterQi < 0) { for (var i = cur.cfg.questions.length - 1; i >= 0; i--) if (cur.cfg.questions[i].section === secId) { at = i + 1; break; } }
    cur.cfg.questions.splice(at, 0, q);
    closeModal(); markChanged(); renderOutline(); selectQuestion(at);
    setTimeout(function () { var f = document.getElementById("f-stem-rich"); if (f) { f.focus(); var r = document.createRange(); r.selectNodeContents(f); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } }, 30);
  }
  function askText(title, hint, initial, cb) {
    openModal('<div class="st-modal-head"><strong>' + esc(title) + '</strong><span class="st-meta">' + esc(hint) + '</span><button class="ex-close" data-act="modal-close" type="button">&times;</button></div>' +
      '<textarea id="st-ask" class="st-ask" autofocus>' + esc(initial || "") + "</textarea>" +
      '<div class="st-modal-actions"><button class="st-btn on" data-act="ask-ok">Use this list</button><button class="st-btn" data-act="modal-close">Cancel</button></div>');
    askCb = cb;
  }
  var askCb = null;

  // ------------------------------------------------------------ Globalize Survey panel
  // Parent/child model: the parent survey stays intact and is the default; every
  // language becomes a *child* study that stores only its translation table and reads
  // its questions from the parent, so parent edits flow into every child at once.
  function openLangPanel(lang) {
    langPanel.lang = lang || null;
    langPanel.q = "";
    langPanel.onlyMissing = false;
    refreshLangPanel();
  }
  function refreshLangPanel() {
    var base = "/api/studio/strings?study=" + encodeURIComponent(cur.slug);
    Promise.all([api(base), api("/api/studio/children?study=" + encodeURIComponent(cur.slug))])
      .then(function (r) {
        langPanel.data = r[0];
        langPanel.children = r[1].children || [];
        renderLangPanel();
      });
  }
  function saveTranslations() {
    var out2 = {};
    $$("#st-modal [data-tr], #lang-tr-host [data-tr]").forEach(function (n) { out2[n.getAttribute("data-tr")] = n.value; });
    api("/api/studio/translate", { slug: cur.slug, lang: langPanel.lang, strings: out2 }).then(function (r) {
      if (r.error) { toast("Save failed: " + r.error); return; }
      toast("Saved - " + r.coverage.translated + " of " + r.coverage.total + " respondent strings translated");
      syncTranslationsFromServer(function () {
        if (cur.cfg.parent) {
          api("/api/studio/strings?study=" + encodeURIComponent(cur.slug)).then(function (d) {
            langPanel.data = d;
            var host = document.getElementById("lang-tr-host");
            if (host) host.innerHTML = trTableHtml();
          });
        } else refreshLangViews();
      });
    });
  }
  function aiTranslate(b) {
    var lg = b.getAttribute("data-lang") || langPanel.lang;
    if (!lg) return;
    var aiSlug = cur.slug;
    if (!cur.cfg.parent) {
      var m = ((langPanel.children || []).filter(function (x) { return x.language === lg; })[0] || {});
      aiSlug = m.slug || cur.slug;
    }
    b.disabled = true; b.textContent = "Translating\u2026";
    flushSave(function () {
      api("/api/studio/autotranslate", { slug: aiSlug, lang: lg }).then(function (r) {
        if (r.error) { toast("AI translate failed: " + r.error); refreshLangViews(); return; }
        var nf = Object.keys(r.failed || {}).length;
        if (!r.translated && nf) toast("Machine translation could not be reached right now - " + nf + " string(s) left for manual translation below.");
        else toast("AI translated " + r.translated + " string(s)" + (nf ? " \u00B7 " + nf + " could not be translated - finish them by hand" : ""));
        syncTranslationsFromServer(function () {
          if (cur.cfg.parent) {
            api("/api/studio/strings?study=" + encodeURIComponent(cur.slug)).then(function (d) {
              langPanel.data = d;
              var host = document.getElementById("lang-tr-host");
              if (host) host.innerHTML = trTableHtml();
            });
          } else refreshLangViews();
        });
      });
    });
  }
  function syncTranslationsFromServer(then) {
    api("/api/studio/study?slug=" + encodeURIComponent(cur.slug)).then(function (s2) {
      cur.cfg = s2.cfg; cur.title = s2.title;
      if (then) then();
    });
  }
  function contextLabel(x) {
    if (x.kind === "study") return /welcome/.test(x.key) ? "Welcome page" : "Thank-you page";
    if (x.kind === "section") return "Page title";
    if (x.kind === "scene") return "Walkthrough scene";
    var qid = x.qid || (x.key.split(":")[1] || "");
    if (x.kind === "option") return qid + " \u00B7 option";
    if (x.kind === "row") return qid + " \u00B7 row";
    if (x.kind === "scale") return qid + " \u00B7 scale label";
    if (x.kind === "axis") return qid + " \u00B7 grid heading";
    if (/help$/.test(x.key)) return qid + " \u00B7 help text";
    if (/placeholder$/.test(x.key)) return qid + " \u00B7 placeholder";
    return qid + " \u00B7 question";
  }
  function trTableHtml() {
    var d = langPanel.data;
    if (!d || !langPanel.lang) return "";
    var tbl = (cur.cfg.translations || {})[langPanel.lang] || {};
    var rows = "";
    (d.strings || []).forEach(function (x) {
      var tv = tbl[x.key] || "";
      if (langPanel.onlyMissing && tv.trim()) return;
      if (langPanel.q && (x.text + " " + x.key + " " + tv).toLowerCase().indexOf(langPanel.q.toLowerCase()) < 0) return;
      rows += '<div class="st-tr-row"><span class="st-tr-ctx" title="' + esc(x.key) + '">' + contextLabel(x) + "</span>" +
        '<span class="st-tr-src">' + esc(x.text) + "</span>" +
        '<textarea data-tr="' + esc(x.key) + '" rows="2" placeholder="Translation\u2026">' + esc(tv) + "</textarea></div>";
    });
    if (!rows) rows = '<div class="st-tr-row"><span></span><span class="st-meta">No strings match.</span><span></span></div>';
    return '<div class="st-tr-row st-tr-head"><span>Context</span><span>' + esc(d.default_language) + " (parent \u00B7 source)</span><span>" + esc(langPanel.lang) + "</span></div>" + rows;
  }
  function childCoverage(child) {
    var d = langPanel.data, tbl = (child.translations || {})[child.language] || {};
    var total = (d.strings || []).length;
    var done = (d.strings || []).filter(function (x) { return (tbl[x.key] || "").trim(); }).length;
    return total ? Math.round(100 * done / total) : 100;
  }
  function langRowsHtml(defLang) {
    var html = "";
    if (!(langPanel.children || []).length) html += '<div class="st-note">No child surveys yet. Add a language below to create one.</div>';
    (langPanel.children || []).forEach(function (ch) {
      var meta = langMeta(ch.language);
      var pct = childCoverage(ch);
      html += '<div class="st-lang-row">' +
        "<span><b>" + esc(meta.native) + "</b><small>child survey /" + esc(ch.slug) + " \u00B7 " + pct + "% translated</small></span>" +
        '<span class="st-lang-bar"><i style="width:' + pct + '%"></i></span><span class="st-meta">' + pct + "%</span>" +
        '<span class="st-lang-tools"><button class="st-btn sm on" data-act="child-open" data-slug="' + esc(ch.slug) + '">Translate</button>' +
        '<button class="st-btn sm" data-act="lang-ai" data-lang="' + esc(ch.language) + '">AI-translate missing</button>' +
        '<button class="st-btn sm" data-act="child-link" data-slug="' + esc(ch.slug) + '">Respondent link</button>' +
        '<button class="st-btn sm danger" data-act="lang-del" data-lang="' + esc(ch.language) + '">Remove</button></span></div>';
    });
    return html;
  }
  function langAddHtml(defLang) {
    var have = (langPanel.children || []).map(function (ch) { return ch.language; });
    return '<div class="st-lang-add"><select id="lang-add-sel">' +
      LANGCAT.filter(function (l) { return l.code !== defLang && have.indexOf(l.code) < 0; }).map(function (l) {
        return '<option value="' + l.code + '">' + esc(l.name) + " (" + esc(l.native) + ")</option>"; }).join("") +
      '</select><button class="st-btn on sm" data-act="lang-add">Create child survey</button></div>';
  }
  function createChild(la) {
    if (!la) return;
    api("/api/studio/globalize", { slug: cur.slug, lang: la }).then(function (r) {
      if (r.error) { toast("Could not create child: " + r.error); return; }
      closeModal();
      toast("Child survey /" + r.slug + " created" + (r.existing ? " (already existed)" : ""));
      openEditor(r.slug);
    });
  }
  function removeChild(dl) {
    var chSlug = ((langPanel.children || []).filter(function (x) { return x.language === dl; })[0] || {}).slug;
    if (confirm("Remove the " + langMeta(dl).native + " child survey and its responses? The parent survey is not affected.")) {
      api("/api/studio/delete", { slug: chSlug }).then(function () { refreshLangViews(); });
    }
  }
  function refreshLangViews() {
    if (document.getElementById("st-modal")) refreshLangPanel();
    refreshTranslationsTab();
  }
  function renderLangPanel() {
    var d = langPanel.data;
    var defLang = d.default_language || "en-US";
    var html = '<div class="st-modal-head"><strong>Globalize Survey</strong>' +
      '<span class="st-meta">The parent survey stays intact - each language becomes a connected child survey</span>' +
      '<button class="st-btn sm ghost" data-act="modal-close" type="button">\u2190 Back</button><button class="ex-close" data-act="modal-close" type="button">&times;</button></div>';
    html += '<div class="st-note">This study (<b>' + esc(cur.slug) + "</b>) is the <b>parent</b> in " + esc(defLang) +
      ". Every translation below is a <b>child survey</b> with its own respondent link and data; it reads its questions live from the parent, so updating the parent updates every child.</div>";
    html += '<div class="st-lang-list">' + langRowsHtml(defLang) + langAddHtml(defLang) + "</div>";
    openModal(html, "st-langmodal");
  }

  function translationsTab() {
    return '<div class="st-page-head"><h2>Translations</h2>' +
      "<p>Every language this study is globalized into \u2014 each one a child survey connected to this parent, with its own respondent link and data.</p></div>" +
      '<div id="trtab-host"><div class="st-meta">Loading translations\u2026</div></div>';
  }
  function refreshTranslationsTab() {
    if (tab !== "translations" || !cur || (cur.cfg || {}).parent) return;
    var host = document.getElementById("trtab-host");
    if (!host) return;
    Promise.all([api("/api/studio/strings?study=" + encodeURIComponent(cur.slug)),
                 api("/api/studio/children?study=" + encodeURIComponent(cur.slug))])
      .then(function (r) {
        var h2 = document.getElementById("trtab-host");
        if (tab !== "translations" || !h2) return;
        langPanel.data = r[0]; langPanel.children = r[1].children || [];
        var defLang = r[0].default_language || "en-US";
        h2.innerHTML = '<div class="st-note">This study (<b>' + esc(cur.slug) + "</b>) is the <b>parent</b> in " + esc(defLang) +
          ". Updating it updates every child below.</div>" +
          '<div class="st-lang-list">' + langRowsHtml(defLang) + langAddHtml(defLang) + "</div>";
      });
  }

  // translation child editor: parent questions are managed by the parent, this page
  // only translates the respondent-visible strings of this child's language
  function renderChildEditor() {
    var lang = cur.cfg.language || "";
    var meta = langMeta(lang);
    langPanel.lang = lang;
    root.innerHTML = '<div class="st-bar">' +
      '<button class="st-btn ghost" data-act="back" title="Back to all studies">\u2190 Studies</button>' +
      '<input type="text" id="ed-title" class="st-title" value="' + esc(cur.title) + '" title="Child survey title">' +
      '<div id="st-savestate" class="st-savestate"></div>' +
      '<span class="st-child-note">Child of <b>' + esc(cur.cfg.parent) + "</b> \u00B7 " + esc(meta.native) + " \u2014 questions update with the parent</span>" +
      '<a class="st-btn play" href="/survey/' + esc(cur.slug) + '/test" target="_blank" rel="noopener">\u25B6 Preview translation</a>' +
      '<div class="st-menu-wrap"><button class="st-btn" data-act="sopts" title="Survey options">SURVEY OPTIONS \u25BE</button>' +
        '<div class="st-menu" id="st-sopts" hidden>' +
        '<button type="button" data-act="so-word">Download Word Outline</button>' +
        '<button type="button" data-act="so-share">Share survey preview</button>' +
        '<button type="button" data-act="copylink">Copy respondent link</button>' +
        '<button type="button" data-act="child-open-parent">Open parent survey</button>' +
        "</div></div>" +
      '<button class="st-btn" data-act="child-open-parent">\u2190 Parent</button>' +
      "</div>" +
      '<nav class="st-tabs"><button class="st-tab on">Translation</button></nav>' +
      '<div id="st-panel" class="st-panel-host"><div class="st-page"><div class="st-panel">' +
      '<div class="st-page-head"><h2>Translate into ' + esc(meta.native) + "</h2>" +
      "<p>Only respondent-visible text is translated; notes and directions for the team stay in the parent language.</p></div>" +
      '<div class="st-lang-editor"><div class="st-lang-editor-head"><strong>' + esc(meta.native) + " translation</strong>" +
      '<input id="lang-search" placeholder="Search text\u2026" value="">' +
      '<label class="st-inline"><input type="checkbox" id="lang-missing"> missing only</label>' +
      '<span class="st-lang-grow"></span>' +
      '<button class="st-btn sm" data-act="lang-ai">AI-translate missing</button>' +
      '<button class="st-btn sm on" data-act="lang-save">Save translations</button></div>' +
      '<div class="st-tr-table" id="lang-tr-host"><div class="st-meta">Loading strings\u2026</div></div></div>' +
      "</div></div></div>";
    renderSaveState();
    api("/api/studio/strings?study=" + encodeURIComponent(cur.slug)).then(function (d) {
      langPanel.data = d;
      langPanel.lang = lang;
      var host = document.getElementById("lang-tr-host");
      if (host) host.innerHTML = trTableHtml();
    });
  }

  // ------------------------------------------------------------ Survey options menu
  function closeSopts() { var mn = document.getElementById("st-sopts"); if (mn) mn.hidden = true; }
  function dupCurrent(andTranslate) {
    flushSave(function () {
      var cfg = JSON.parse(JSON.stringify(cur.cfg));
      cfg.title = cur.title + " (copy)";
      api("/api/studio/save", { slug: "", title: cfg.title, cfg: cfg }).then(function (r) {
        toast("Duplicated as /" + r.slug);
        openEditor(r.slug, andTranslate ? function () { openLangPanel(null); } : null);
      });
    });
  }
  function moveStudy() {
    askText("Move survey", "New address: /survey/<slug> - links to the old address stop working", cur.slug, function (v) {
      var ns = (v || "").trim().toLowerCase();
      if (!ns || ns === cur.slug) return;
      flushSave(function () {
        api("/api/studio/move", { slug: cur.slug, new_slug: ns }).then(function (r) {
          if (r.error) { toast("Move failed: " + r.error); return; }
          cur.slug = r.slug;
          toast("Moved to /survey/" + r.slug);
          renderEditor();
        });
      });
    });
  }
  function shareModal() {
    var base = location.origin + "/survey/" + cur.slug;
    openModal('<div class="st-modal-head"><strong>Share survey preview</strong><span class="st-meta">' +
      (cur.status === "live" ? "The study is live - the respondent link answers for real" : "Draft study - the respondent link is blocked until you go live") +
      '</span><button class="st-btn sm ghost" data-act="modal-close" type="button">\u2190 Back</button><button class="ex-close" data-act="modal-close" type="button">&times;</button></div>' +
      '<div class="st-field"><label>Preview / test link <span class="st-opt">answers are marked as test data</span></label>' +
      '<div class="st-linkbox"><code>' + esc(base + "/test") + '</code><button class="st-btn sm" data-act="copylink" data-slug="' + esc(cur.slug) + '">Copy</button></div></div>' +
      '<div class="st-field"><label>Respondent link</label><div class="st-linkbox"><code>' + esc(base) + "</code></div></div>" +
      '<div class="st-note">Both links open exactly what respondents see, in whichever language they pick.</div>' +
      '<div class="st-modal-actions"><button class="st-btn on" data-act="modal-close">Done</button></div>');
  }
  function openTitleLang() {
    openModal('<div class="st-modal-head"><strong>Edit title and language</strong><span class="st-meta">The authoring language - translations are made from it</span>' +
      '<button class="st-btn sm ghost" data-act="modal-close" type="button">\u2190 Back</button><button class="ex-close" data-act="modal-close" type="button">&times;</button></div>' +
      '<div class="st-field"><label>Survey title</label><input id="tl-title" value="' + esc(cur.title) + '"></div>' +
      '<div class="st-field"><label>Survey language (default)</label><select id="tl-lang">' + langOptions(cur.cfg.language || "en-US") + "</select></div>" +
      '<div class="st-note">Notes, directions and everything aimed at the research team always stay in this language. Only respondent-visible text is offered for translation.</div>' +
      '<div class="st-modal-actions"><button class="st-btn on" data-act="tl-save">Save</button><button class="st-btn" data-act="modal-close">Cancel</button></div>');
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest(".st-menu-wrap")) closeSopts();
  });

  // ------------------------------------------------------------ question editor pane
  var ed = null;           // live reference to cur.cfg.questions[sel]
  var OPS = [["selected", "has selected"], ["not_selected", "has not selected"],
    ["any_of", "selected any of (codes a,b)"], ["none_of", "selected none of (codes a,b)"],
    ["eq", "equals"], ["ne", "does not equal"], ["gt", "is greater than"], ["gte", "is at least"], ["lt", "is less than"], ["lte", "is at most"],
    ["contains", "answer text contains"], ["answered", "was answered"], ["not_answered", "was skipped"],
    ["row_eq", "row rating equals (row=value)"],
    ["cell_is", "grid row is column (row=col)"], ["cell_not", "grid row is not column (row=col)"],
    ["cell_includes", "grid row includes column (row=col)"], ["cell_lacks", "grid row does not include column (row=col)"],
    ["cell_gte", "matrix cell is at least (row=col=number)"], ["cell_lte", "matrix cell is at most (row=col=number)"],
    ["cell_gt", "matrix cell is more than (row=col=number)"], ["cell_lt", "matrix cell is less than (row=col=number)"],
    ["cell_eq", "matrix cell equals (row=col=number)"], ["cell_ne", "matrix cell is not (row=col=number)"],
    ["cell_between", "matrix cell is between (row=col=min-max)"]];
  var FONTS = [["", "Default"], ["Georgia, serif", "Georgia (serif)"], ["'Times New Roman', serif", "Times New Roman"],
    ["Arial, Helvetica, sans-serif", "Arial"], ["Verdana, sans-serif", "Verdana"], ["'Trebuchet MS', sans-serif", "Trebuchet"],
    ["'Courier New', monospace", "Courier (mono)"]];
  var SIZES = [["", "Default"], ["15px", "Small"], ["19px", "Normal"], ["22px", "Large"], ["26px", "X-Large"], ["32px", "Huge"]];
  var LIST_KEY = { opt: "options", row: "rows", col: "cols", item: "items" };
  var FLAG_INFO = {
    pin: { label: "\uD83D\uDCCC Pin", tip: "Keeps its place when the list is randomised" },
    exclusive: { label: "\u2298 Exclusive", tip: "Selecting it clears every other answer - for None / Not applicable" },
    other: { label: "\u270E Other", tip: "Adds a free-text box next to this option" },
    terminate: { label: "\u26D4 Screen out", tip: "Ends the survey the moment this option is picked" }
  };

  function hasOptions(t) { return t === "single_select" || t === "multi_select"; }
  function hasRows(t) { return ["rating_grid", "rating_scale", "semantic_diff", "sum_to_100", "rank", "emoji_grid", "heatmap", "numeric_matrix", "concept_test"].indexOf(t) >= 0; }

  // ---- matrix / grid questions ----------------------------------------------------------
  // A grid always has a Question title plus two axes.  On a rating grid the columns ARE the
  // scale points (1..7, each with a label of its own); on a heat map and a numeric matrix
  // they are a second list.  Both axes are edited the same way: add, label, format, attach
  // an image / video / audio clip, duplicate, move, delete - and the two can be swapped.
  var GRID_TYPES = ["rating_grid", "semantic_diff", "emoji_grid", "heatmap", "numeric_matrix", "concept_test"];
  var SCALE_TYPES = ["semantic_diff", "emoji_grid", "concept_test"];   // columns = scale points
  var AXIS_TYPES = ["rating_grid", "heatmap", "numeric_matrix"];       // columns = a second list
  var RZ_MODES = [
    ["none", "Fixed", "Everyone sees the list as written"],
    ["shuffle", "Shuffle", "A fresh random order for every respondent"],
    ["rotate", "Rotate", "Random start point, relative order kept"],
    ["reverse", "Flip 50/50", "Half of the respondents see it reversed"],
    ["revall", "Reverse", "Everybody sees it the other way round"]
  ];
  var COMMENT_MODES = [
    ["none", "No comment", "No comment box is shown"],
    ["allow", "Allow comment", "A box they may fill in if they want to"],
    ["require", "Require comment", "They cannot carry on until it is filled in"]
  ];
  var FMT_MODES = [["", "Plain", "Plain label"], ["b", "Bold", "Bold label"],
                   ["i", "Italic", "Italic label"], ["bi", "Bold italic", "Bold and italic"]];

  function isGrid(t) { return GRID_TYPES.indexOf(t) >= 0; }
  function hasScale(t) { return SCALE_TYPES.indexOf(t) >= 0; }
  function hasColAxis(t) { return AXIS_TYPES.indexOf(t) >= 0; }

  // Older studies carried grids with a scale (one rating per row).  A grid is now rows x
  // columns with a pick per row, so the first time such a question is opened its scale
  // points become the columns - codes and labels travel with them, nothing is thrown away.
  function migrateLegacyGrid(q) {
    if (!q || q.type !== "rating_grid" || (q.cols && q.cols.length)) return false;
    var sc = q.scale || {};
    var min = sc.min != null ? Number(sc.min) : 1, max = sc.max != null ? Number(sc.max) : 5;
    if (!(max >= min)) max = min;
    var pts = {};
    (sc.points || []).forEach(function (p) { pts[Number(p.v)] = p; });
    var cols = [];
    for (var v = min; v <= max; v++) {
      var c = { code: String(v), label: (pts[v] && pts[v].label) || String(v) };
      if (pts[v] && pts[v].media) c.media = pts[v].media;
      cols.push(c);
    }
    q.cols = cols;
    if (!q.select) q.select = "single";
    delete q.scale;
    if (q.na && q.na.col) { delete q.na.col; if (!Object.keys(q.na).length) delete q.na; }
    return true;
  }
  function gridOf() { return (ed && ed.grid) || {}; }
  function naOf() { return (ed && ed.na) || {}; }
  function commentsOf() { return (ed && ed.comments) || {}; }

  function scaleRange(q) {
    var sc = (q && q.scale) || {};
    var min = sc.min != null ? Number(sc.min) : 1;
    var max = sc.max != null ? Number(sc.max) : 5;
    if (!(max >= min)) max = min;
    return [min, max];
  }
  function faceLabel(q, v) {                       // emoji grids ship with a face per point
    var sc = (q && q.scale) || {};
    if (q && q.type === "emoji_grid" && sc.faces) {
      var f = sc.faces[v - scaleRange(q)[0]];
      if (f) return f;
    }
    return "";
  }
  // One entry for every value between min and max, keeping whatever the author stored.
  function scalePoints(q) {
    var r = scaleRange(q), have = {};
    ((q.scale || {}).points || []).forEach(function (p) { have[Number(p.v)] = p; });
    var out = [];
    for (var v = r[0]; v <= r[1]; v++) {
      var p = have[v] || {};
      out.push({ v: v, label: p.label || faceLabel(q, v) || "", fmt: p.fmt || "", media: p.media,
                 comment: p.comment || "" });
    }
    return out;
  }
  // The points are positional: the first is min, the last is max.  Only edited ones are stored.
  function writeScalePoints(list) {
    ed.scale = ed.scale || {};
    var min = scaleRange(ed)[0], pts = [];
    list.forEach(function (p, i) {
      var e = { v: min + i };
      if (String(p.label || "").trim()) e.label = p.label;
      if (p.fmt) e.fmt = p.fmt;
      if (p.media && p.media.src) e.media = p.media;
      if (p.comment && p.comment !== "none") e.comment = p.comment;
      if (e.label || e.fmt || e.media || e.comment) pts.push(e);
    });
    ed.scale.min = min;
    ed.scale.max = min + list.length - 1;
    if (pts.length) ed.scale.points = pts; else delete ed.scale.points;
  }
  // One media slot - image, video or audio - for a row, a column or a scale point.
  function mediaOf(it) {
    if (!it) return null;
    if (it.media && it.media.src) return it.media;
    if (it.image) return { kind: "image", src: it.image };
    return null;
  }
  function mediaCell(it, kind, i) {
    var m = mediaOf(it);
    if (m) {
      return '<span class="st-thumb" title="' + esc(String(m.src).split("/").pop()) + '">' +
        (m.kind === "video" ? '<video src="' + esc(m.src) + '" muted></video>'
          : m.kind === "audio" ? '<span class="st-thumb-ic" title="Audio clip">\\u266B</span>'
            : '<img src="' + esc(m.src) + '" alt="">') +
        '<button class="st-x" data-act="it-media-del" data-kind="' + kind + '" data-i="' + i +
        '" title="Remove this attachment">\\u00D7</button></span>';
    }
    return '<label class="st-ibtn" title="Attach an image, video or audio clip to this ' + esc(kind === "pt" ? "point" : kind) + '">' +
      "\\uD83D\\uDCE5" + '<input type="file" accept="image/*,video/*,audio/*" data-act="it-media" data-kind="' +
      kind + '" data-i="' + i + '" hidden></label>';
  }
  // The scale points: one row per value, each with its own label, format and media.
  function scalePointEditor() {
    var pts = scalePoints(ed);
    var html = '<div class="st-items st-pts" data-kind="pt">' +
      '<div class="st-item st-item-head"><span>#</span><span>Value</span><span>Label respondents read</span>' +
      "<span>Format</span><span>Attachment</span><span>Actions</span></div>";
    pts.forEach(function (p, i) {
      var pid = "f-pt-" + i;
      html += '<div class="st-item" data-i="' + i + '">' +
        '<span class="st-seq" title="Position ' + (i + 1) + " of " + pts.length + '">' + (i + 1) + ".</span>" +
        '<span class="st-pt-val" title="The number stored for this point">' + p.v + "</span>" +
        '<div class="st-with-pipe"><input id="' + pid + '" data-pt="label" data-i="' + i + '" value="' + esc(p.label || "") +
        '" placeholder="' + (i === 0 ? "e.g. Not at all" : i === pts.length - 1 ? "e.g. Extremely" : "optional") + '">' +
        pipeButton(pid, true, true) + "</div>" +
        '<select data-pt="fmt" data-i="' + i + '" title="How the label is styled">' + FMT_MODES.map(function (f) {
          return '<option value="' + f[0] + '"' + ((p.fmt || "") === f[0] ? " selected" : "") + ">" + f[1] + "</option>";
        }).join("") + "</select>" +
        mediaCell(p, "pt", i) +
        '<span class="st-item-tools">' +
        '<button class="st-ibtn" data-act="pt-up" data-i="' + i + '" title="Move this label up one point"' +
        (i === 0 ? " disabled" : "") + ">\\u25B2</button>" +
        '<button class="st-ibtn" data-act="pt-down" data-i="' + i + '" title="Move this label down one point"' +
        (i === pts.length - 1 ? " disabled" : "") + ">\\u25BC</button>" +
        '<button class="st-ibtn" data-act="pt-dup" data-i="' + i + '" title="Duplicate this point">\\u2398</button>' +
        '<button class="st-ibtn danger" data-act="pt-del" data-i="' + i + '" title="Delete this point"' +
        (pts.length <= 2 ? " disabled" : "") + ">\\uD83D\\uDDD1</button></span></div>";
    });
    html += "</div>" +
      '<div class="st-item-actions"><button class="st-btn sm on" data-act="pt-add">+ Add column</button>' +
      '<button class="st-btn sm ghost" data-act="pt-paste">Enter multiple\\u2026</button>' +
      '<span class="st-meta">Adding a column extends the scale \\u00B7 deleting one shortens it. ' +
      "The numbers stored stay in step.</span></div>";
    return html;
  }
  // The title above the grid and the two group names (the row heading and the column heading).
  function gridHeadFields() {
    var g = gridOf();
    return '<div class="st-grid3">' +
      '<div class="st-field"><label>Question title <span class="st-opt">shown above the grid</span></label>' +
      '<input id="f-gtitle" value="' + esc(g.title || "") + '" placeholder="e.g. How important is each attribute?"></div>' +
      '<div class="st-field"><label>Rows are called <span class="st-opt">heading over the row labels</span></label>' +
      '<input id="f-rowlabel" value="' + esc(g.row_label || "") + '" placeholder="e.g. Attribute"></div>' +
      '<div class="st-field"><label>Columns are called <span class="st-opt">heading over the columns</span></label>' +
      '<input id="f-collabel" value="' + esc(g.col_label || "") + '" placeholder="e.g. Rating"></div></div>';
  }
  // The exclusive N/A: on every row, and/or as a column of the scale.
  function naBlock() {
    var n = naOf();
    return '<div class="st-mtx-na"><label class="st-switch"><input type="checkbox" id="f-na-rows"' +
      (n.rows ? " checked" : "") + '><i></i>N/A on every row</label>' +
      '<label class="st-switch"><input type="checkbox" id="f-na-col"' + (n.col ? " checked" : "") +
      '><i></i>N/A as a column</label>' +
      '<label class="st-mini">Wording <input id="f-na-label" class="st-narrow" value="' + esc(n.label || "N/A") +
      '" placeholder="N/A"></label>' +
      '<span class="st-meta">N/A is exclusive - it clears the rating on that row and counts as answered. ' +
      "Offer it on every row, or give it a column of its own in the header.</span></div>";
  }
  // The choice grid keeps the exclusive N/A on every row (there is no scale column for it).
  function naRowsBlock() {
    var n = naOf();
    return '<div class="st-mtx-na"><label class="st-switch"><input type="checkbox" id="f-na-rows"' +
      (n.rows ? " checked" : "") + '><i></i>N/A on every row</label>' +
      '<label class="st-mini">Wording <input id="f-na-label" class="st-narrow" value="' + esc(n.label || "N/A") +
      '" placeholder="N/A"></label>' +
      '<span class="st-meta">N/A is exclusive - it clears the picks on that row and counts as answered.</span></div>';
  }
  // Comments: one box for the whole question, and a box under any row you like.
  function commentBlock() {
    var c = commentsOf();
    var rowModes = (ed.rows || []).filter(function (r) { return r.comment && r.comment !== "none"; }).length;
    return '<div class="st-mtx-comments"><div class="st-grid3">' +
      '<div class="st-field"><label>Comment box for the question</label><select id="f-cmt-mode">' +
      COMMENT_MODES.map(function (m) {
        return '<option value="' + m[0] + '"' + ((c.mode || "none") === m[0] ? " selected" : "") + ">" + m[1] + "</option>";
      }).join("") + "</select></div>" +
      '<div class="st-field"><label>Prompt <span class="st-opt">what the box says</span></label>' +
      '<input id="f-cmt-label" value="' + esc(c.label || "Any other comments?") + '"></div>' +
      '<div class="st-field"><label>Mandatory for <span class="st-opt">rows that must be explained</span></label>' +
      '<select id="f-cmt-rows" multiple size="3" title="Hold Ctrl / \\u2318 to pick several rows">' +
      (ed.rows || []).map(function (r) {
        var on = (c.require_when || []).map(String).indexOf(String(r.code)) >= 0;
        return '<option value="' + esc(r.code) + '"' + (on ? " selected" : "") + ">" + esc(rowText(r)) + "</option>";
      }).join("") + "</select></div></div>" +
      '<div class="st-hint">A required comment blocks Next until it is filled in \\u00B7 ' +
      (rowModes ? "<b>" + rowModes + " row(s)</b> carry a comment box of their own - set it on the row below."
        : "set <b>Comment</b> on a row below to give that row its own box.") + "</div></div>";
  }
  // Order of the rows and of the columns, each in its own right.
  function randomizeAxesBlock() {
    var rz = ed.randomize || {};
    function axis(id, name, what) {
      var mode = typeof rz === "object" ? (rz[name] || "none") : (name === "rows" ? (rz || "none") : "none");
      return '<div class="st-field"><label>Order of ' + what + '</label><select id="' + id + '">' +
        RZ_MODES.map(function (m) {
          return '<option value="' + m[0] + '"' + (mode === m[0] ? " selected" : "") + ">" + m[1] + " \\u00B7 " + m[2] + "</option>";
        }).join("") + "</select></div>";
    }
    return '<div class="st-grid2">' + axis("f-rz-rows", "rows", (ed.rows || []).length ? "rows" : "rows") +
      axis("f-rz-cols", "cols", hasColAxis(ed.type) ? "columns" : "columns (the scale points)") + "</div>" +
      '<div class="st-hint">Pinned rows and columns keep their place whatever the order \\u00B7 the order each ' +
      "respondent saw is exported with the data.</div>";
  }

  // A fresh code for a copied item:  b -> b2, r3 -> r4, 2 -> 3, and so on.
  function nextItemCode(list, code) {
    var used = {}; list.forEach(function (x) { used[String(x.code)] = 1; });
    var m = String(code || "x").match(/^(.*?)(\d+)$/);
    var stem = m ? m[1] : String(code || "x"), n = m ? Number(m[2]) : 1;
    var out = stem + (n + 1), guard = 0;
    while (used[out] && guard++ < 500) { n++; out = stem + (n + 1); }
    return out;
  }
  // Rows <-> columns.  On a heat map or a numeric matrix the two lists change places; on a
  // rating scale the rows change places with the scale points.  Either way it is reversible.
  function swapAxes() {
    function plain(list) {
      return (list || []).map(function (r) {
        var e = { code: r.code, label: r.label || "" };
        if (r.fmt) e.fmt = r.fmt;
        if (r.media) e.media = r.media;
        return e;
      });
    }
    var rows = ed.rows || [];
    if (hasColAxis(ed.type)) {
      var cols = ed.cols || [];
      if (!rows.length || !cols.length) return false;
      ed.rows = plain(cols); ed.cols = plain(rows);
      var g = ed.grid = ed.grid || {}, rl = g.row_label || "", cl = g.col_label || "";
      g.row_label = cl; g.col_label = rl;
      if (!g.row_label) delete g.row_label;
      if (!g.col_label) delete g.col_label;
      return true;
    }
    if (hasScale(ed.type)) {
      var pts = scalePoints(ed);
      if (!rows.length || !pts.length) return false;
      ed.scale = ed.scale || {};
      ed.scale.min = 1; ed.scale.max = rows.length;
      ed.scale.points = rows.map(function (r, i) {
        var e = { v: i + 1, label: r.label || "" };
        if (r.fmt) e.fmt = r.fmt;
        if (r.media) e.media = r.media;
        if (r.comment && r.comment !== "none") e.comment = r.comment;   // carried both ways
        return e;
      });
      ed.rows = pts.map(function (p, i) {
        var e = { code: "p" + (i + 1), label: p.label || String(p.v) };
        if (p.fmt) e.fmt = p.fmt;
        if (p.media) e.media = p.media;
        if (p.comment && p.comment !== "none") e.comment = p.comment;
        return e;
      });
      return true;
    }
    return false;
  }
  function scaleRangeFields() {
    var sc = ed.scale || {};
    return '<div class="st-grid4">' +
      '<div class="st-field"><label>From</label><input id="f-smin" type="number" value="' + (sc.min != null ? sc.min : 1) + '"></div>' +
      '<div class="st-field"><label>To</label><input id="f-smax" type="number" value="' + (sc.max != null ? sc.max : 7) + '"></div>' +
      '<div class="st-field"><label>Low-end label</label><input id="f-sminl" value="' + esc(sc.min_label || "") + '" placeholder="e.g. Not at all"></div>' +
      '<div class="st-field"><label>High-end label</label><input id="f-smaxl" value="' + esc(sc.max_label || "") + '" placeholder="e.g. Extremely"></div></div>';
  }

  // The whole matrix, in the order a respondent reads it: title, scale, columns, rows,
  // then the swap, the N/A, the comments and the order of both axes.
  // A grid is rows x columns.  The dropdown at the top decides whether a respondent may
  // pick one column per row (single select) or several (multi select).
  function gridSelectField() {
    var sel = ed.select === "multi" ? "multi" : "single";
    return '<div class="st-field"><label>Answers <span class="st-opt">what a respondent may pick in every row</span></label>' +
      '<select id="f-gselect">' +
      '<option value="single"' + (sel === "single" ? " selected" : "") + ">Single select - one column per row</option>" +
      '<option value="multi"' + (sel === "multi" ? " selected" : "") + ">Multi select - several columns per row</option>" +
      "</select></div>";
  }
  function gridBlock() {
    var t = ed.type, html = "";
    if (t === "rating_grid") html += gridSelectField();
    html += gridHeadFields();
    if (t === "concept_test") {
      html += '<div class="st-field"><label>Concept shown to respondents</label><textarea id="f-concept" rows="4">' +
        esc(ed.concept || "") + '</textarea><div class="st-hint">Attach an image or video under <b>Image / video</b>, ' +
        "or use rich text in the question text above.</div></div>";
    }
    if (hasScale(t)) {
      html += '<h4 class="st-h4">Scale</h4>' + scaleRangeFields();
      html += '<h4 class="st-h4">Columns <span class="st-h4-n">' + scalePoints(ed).length + " scale points</span></h4>" +
        scalePointEditor();
    }
    if (hasColAxis(t)) {
      html += '<h4 class="st-h4">Columns <span class="st-h4-n">' + (ed.cols || []).length + "</span></h4>" +
        itemTable("col", ed.cols || [], { noun: "column", flags: ["pin"], media: true, fmt: true, ph: "Column label" });
    }
    html += '<h4 class="st-h4">Rows <span class="st-h4-n">' + (ed.rows || []).length + "</span></h4>" +
      itemTable("row", ed.rows || [], { noun: "row", flags: ["pin"], media: true, fmt: true, comment: true,
        left: t === "semantic_diff", ph: "Row / statement", labelHead: "Row" });
    html += '<div class="st-item-actions"><button class="st-btn sm" data-act="mtx-swap" title="Rows become columns and ' +
      'columns become rows - codes, labels and attachments travel with them">\u21C4 Swap rows and columns</button>' +
      '<span class="st-meta">' + (hasColAxis(t)
        ? "Swaps the two lists over. The grid keeps the same cells, just read the other way."
        : "Swaps the rows with the scale points: every row becomes a column of the scale.") + "</span></div>";
    html += (t === "rating_grid" ? naRowsBlock() : naBlock()) + commentBlock() + randomizeAxesBlock();
    return html;
  }

  // ---- rating scale questions -----------------------------------------------------------
  // A rating scale keeps rows like a grid, but its scale carries three anchor labels -
  // the low end, the middle and the high end - instead of a caption per column.
  function ratingScaleRangeFields() {
    var sc = ed.scale || {};
    return '<div class="st-grid2">' +
      '<div class="st-field"><label>From</label><input id="f-smin" type="number" value="' + (sc.min != null ? sc.min : 1) + '"></div>' +
      '<div class="st-field"><label>To</label><input id="f-smax" type="number" value="' + (sc.max != null ? sc.max : 5) + '"></div></div>' +
      '<div class="st-grid3">' +
      '<div class="st-field"><label>Low-End Label</label><input id="f-sminl" value="' + esc(sc.min_label || "") + '" placeholder="e.g. Not at all"></div>' +
      '<div class="st-field"><label>Mid Label</label><input id="f-smidl" value="' + esc(sc.mid_label || "") + '" placeholder="e.g. Neutral"></div>' +
      '<div class="st-field"><label>High-End Label</label><input id="f-smaxl" value="' + esc(sc.max_label || "") + '" placeholder="e.g. Extremely"></div></div>' +
      '<div class="st-hint">The three labels sit under the scale: the Low-End Label under the first point, ' +
      "the Mid Label under the middle point and the High-End Label under the last one. All three are optional.</div>";
  }
  function ratingScaleBlock() {
    var html = '<h4 class="st-h4">Scale</h4>' + ratingScaleRangeFields();
    html += '<h4 class="st-h4">Rows <span class="st-h4-n">' + (ed.rows || []).length + "</span></h4>" +
      itemTable("row", ed.rows || [], { noun: "row", flags: ["pin"], media: true, fmt: true,
        ph: "Row / statement", labelHead: "Row" });
    return html;
  }

  function card(id, title, hint, body, collapsed) {
    return '<details class="st-ecard" id="card-' + id + '"' + (collapsed ? "" : " open") + '><summary><span>' + title + "</span>" +
      (hint ? '<small>' + hint + "</small>" : "") + "</summary><div class=\"st-ecard-body\">" + body + "</div></details>";
  }
  function rerenderCard(id) {
    var c = document.getElementById("card-" + id); if (!c) return;
    var body = $(".st-ecard-body", c);
    var fn = { q: qCard, answers: answersCard, display: displayCard, logic: logicCard,
               screening: screeningCard, media: mediaCard, advanced: advancedCard }[id];
    if (fn) body.innerHTML = fn();
    if (id === "logic" || id === "media" || id === "screening") {
      var sm = $("summary span", c); if (sm) sm.innerHTML =
        (id === "logic" ? "Show IF" : id === "media" ? "Image or video" : "Screen in / screen out") +
        (isOn(id) ? ' <em class="st-dot">on</em>' : "");
    }
  }
  function isOn(id) {
    if (id === "screening") return scrCount() > 0;
    return id === "logic" ? (sifOn() && !!(ed.show_if && ed.show_if.rules && ed.show_if.rules.length))
                          : !!(ed.media && ed.media.src);
  }
  function answersTitle() {
    var t = ed.type;
    return hasOptions(t) ? "Answer options" : hasRows(t) ? "Rows & scale" : t === "open_text" ? "Text box" :
      t === "numeric" || t === "slider" ? "Number range" : t === "nps" ? "Scale" : t === "maxdiff" ? "Rounds" : t === "choice_task" ? "Choice task" : "Settings";
  }

  // The question editor follows the reference design: a strip with Content & Settings and
  // Conditional Display, and a PREVIEW button for the full-size question.
  var edTab = "content";
  function edStrip() {
    var rules = (ed.show_if && ed.show_if.rules) || [];
    var nscr = scrCount();
    return '<nav class="st-etabs">' +
      [["content", "Content &amp; Settings"], ["cond", "Show IF"],
       ["screen", "Screening"]].map(function (t) {
        var n = t[0] === "cond" ? (sifOn() ? rules.length : 0) : t[0] === "screen" ? nscr : 0;
        return '<button type="button" class="st-etab' + (edTab === t[0] ? " on" : "") +
          '" data-act="edtab" data-t="' + t[0] + '">' + t[1] +
          (n ? '<span class="st-count' + (t[0] === "screen" ? " warn" : "") + '">' + n + "</span>" : "") +
          "</button>";
      }).join("") +
      '<span class="st-etab-sp"></span>' +
      '<button type="button" class="st-etab prev" data-act="qtest-cur"' +
        (sel >= 0 ? ' data-i="' + sel + '"' : "") +
        ' title="Open this question full size, exactly as a respondent sees it">PREVIEW</button></nav>';
  }

  function renderEditorPane() {
    var host = document.getElementById("st-editor"); if (!host) return;
    closePipePicker();
    ed = sel >= 0 ? cur.cfg.questions[sel] : null;
    if (!ed) {
      host.innerHTML = '<div class="st-editor-empty"><div class="st-editor-empty-ic">\u270E</div><h3>' +
        (cur.cfg.questions.length ? "Pick a question on the left to edit it" : "This study has no questions yet") +
        '</h3><p>Or add a new one - press <b>+ Add question</b> under a section.</p>' +
        (cur.cfg.sections.length ? '<button class="st-btn on" data-act="qadd" data-sec="' + esc(cur.cfg.sections[0].id) + '">+ Add question</button>' : "") + "</div>";
      renderPreview(); return;
    }
    if (!ed.stem_html) ed.stem_html = esc(ed.stem || "");
    var t = tinfo(ed.type);
    host.innerHTML =
      '<div id="st-pipe-pop" class="st-pipe-pop" hidden></div>' +
      '<div class="st-ehead">' +
        '<span class="st-ehead-ic" title="' + esc(t.name) + '">' + t.icon + "</span>" +
        '<div class="st-ehead-main"><div class="st-ehead-row">' +
          // ID with the question Title stacked directly underneath it
          '<div class="st-ehead-idcol">' +
            '<label class="st-mini">ID <input id="f-id" value="' + esc(ed.id) + '" title="Short reference used in exports and piping, e.g. Q3"></label>' +
            '<label class="st-mini">Title <input id="f-title" value="' + esc(ed.title || "") + '" placeholder="Short label, e.g. Specialty screener" title="A short name for this question - shown in the outline and thumbnails, and used in exports. Respondents never see it."></label>' +
          "</div>" +
          '<label class="st-mini">Type <select id="f-type" title="Change the question type - compatible answers are kept">' + GROUPS.map(function (g) {
            return '<optgroup label="' + g + '">' + TYPES.filter(function (x) { return TYPE_INFO[x].group === g; }).map(function (x) {
              return '<option value="' + x + '"' + (x === ed.type ? " selected" : "") + ">" + esc(TYPE_INFO[x].name) + "</option>"; }).join("") + "</optgroup>"; }).join("") + "</select></label>" +
          '<label class="st-mini">Section <select id="f-section">' + cur.cfg.sections.map(function (s) {
            return '<option value="' + esc(s.id) + '"' + (ed.section === s.id ? " selected" : "") + ">" + esc(secLabel(s)) + "</option>"; }).join("") + "</select></label>" +
          '<label class="st-switch" title="Respondents must answer before continuing"><input type="checkbox" id="f-required"' + (ed.required !== false ? " checked" : "") + "><i></i>Required</label>" +
        "</div></div>" +
        '<div class="st-ehead-tools"><button class="st-ibtn" data-act="qdup" data-i="' + sel + '" title="Duplicate question">\u2398</button>' +
        '<button class="st-ibtn danger" data-act="qdel" data-i="' + sel + '" title="Delete question">\u2715</button></div>' +
      "</div>" +
      '<div id="st-qcheck">' + questionCheckHtml() + '</div>' +
      edStrip() +
      (edTab === "screen" ? "" : scrLineHtml()) +
      (edTab === "cond"
        ? '<nav class="st-jump">' + [["logic", "Show IF"]].map(function (j) {
            return '<a href="#card-' + j[0] + '" data-act="jump" data-card="' + j[0] + '">' + j[1] + "</a>"; }).join("") + "</nav>" +
          card("logic", "Show IF" + (sifOn() && ((ed.show_if || {}).rules || []).length ? ' <em class="st-dot">on</em>' : ""),
               "Show IF - exactly who gets this question and who skips it", logicCard())
        : edTab === "screen"
        ? '<nav class="st-jump">' + [["screening", "Screen in / screen out"]].map(function (j) {
            return '<a href="#card-' + j[0] + '" data-act="jump" data-card="' + j[0] + '">' + j[1] + "</a>"; }).join("") + "</nav>" +
          card("screening", "Screen in / screen out" + (scrCount() ? ' <em class="st-dot">on</em>' : ""),
               "Who carries on past this question - and who is ended", screeningCard())
        : '<nav class="st-jump">' + [["q", "Question"], ["answers", answersTitle()], ["display", "Display & order"], ["media", "Image / video"], ["advanced", "Advanced"]].map(function (j) {
            return '<a href="#card-' + j[0] + '" data-act="jump" data-card="' + j[0] + '">' + j[1] + "</a>"; }).join("") + "</nav>" +
          card("q", "Question", "What respondents read", qCard()) +
          card("answers", answersTitle(), "", answersCard()) +
          card("display", "Display & order", "Layout, randomisation, text style", displayCard()) +
          card("media", "Image or video" + (ed.media && ed.media.src ? ' <em class="st-dot">on</em>' : ""), "Shown under the question text", mediaCard()) +
          card("advanced", "Advanced (JSON)", "Everything the form does is stored here", advancedCard(), true));
    renderPreview();
  }

  // ---- live design QA -----------------------------------------------------------------
  function questionIssues() {
    if (!ed) return [];
    var out = [], stem = String(ed.stem || "").trim(), lower = stem.toLowerCase();
    if (!stem || /^new .* question$/i.test(stem)) out.push({key:"stem", level:"error", text:"Question wording is still a placeholder.", fix:"Write a clear starter question"});
    if (stem.length > 220) out.push({key:"shorten", level:"warn", text:"This question is long and may increase drop-off.", fix:"Shorten wording"});
    if (/\b(and|or)\b/.test(lower) && stem.length > 95) out.push({key:"double", level:"warn", text:"This may ask two things at once (double-barrelled).", fix:"Focus on one idea"});
    if (/don't you|obviously|clearly|best|excellent/.test(lower)) out.push({key:"leading", level:"warn", text:"Potentially leading language could bias the answer.", fix:"Make wording neutral"});
    if ((ed.type === "single_select" || ed.type === "multi_select") && (!ed.options || ed.options.length < 2)) out.push({key:"options", level:"error", text:"Add at least two answer options.", fix:"Add starter options"});
    if (ed.options && ed.options.some(function(o){return !String(o.label || '').trim();})) out.push({key:"emptyopt", level:"error", text:"One or more answer options are blank.", fix:"Label blank options"});
    if (isGrid(ed.type) || ed.type === "rating_scale") {
      if (!(ed.rows || []).length) out.push({ key: "gridrows", level: "error",
        text: (ed.type === "rating_scale" ? "This rating scale" : "This grid") + " has no rows yet.", fix: "Add starter rows" });
      if (hasColAxis(ed.type) && ed.type !== "numeric_matrix" && !(ed.cols || []).length) out.push({ key: "gridcols", level: "error",
        text: "This grid has no columns yet.", fix: "Add starter columns" });
    }
    var rules = ed.show_if && ed.show_if.rules || [];
    rules.forEach(function(r){ var qi = cur.cfg.questions.findIndex(function(q){return q.id === r.q;}); if(qi < 0 || qi >= sel) out.push({key:"logic",level:"error",text:"Show-if logic references a missing or later question.",fix:"Repair logic"}); });
    var scr = ed.screening && ed.screening.rules || [];
    scr.forEach(function(r){
      var qi = cur.cfg.questions.findIndex(function(q){return q.id === r.q;});
      if (qi < 0) out.push({key:"screen",level:"error",text:"A screening condition points at a question that no longer exists.",fix:"Remove screening"});
      else if (qi > sel) out.push({key:"screen",level:"warn",text:"A screening condition reads " + r.q + ", which comes later - it can never fire here.",fix:"Remove screening"});
    });
    if (ed.screening && ed.screening.mode === "qualify" && scr.length && ed.type === "multi_select" &&
        scr.some(function(r){ return String(r.op).indexOf("count_") === 0; }) && ed.screening.when === "live")
      out.push({key:"screen-next",level:"warn",text:"Counting answers 'on the spot' can end the survey before the respondent has finished ticking.",fix:"Check on Next"});
    if ((ed.options || []).length && (ed.options || []).every(function(o){ return o.terminate; }))
      out.push({key:"screen-opts",level:"warn",text:"Every answer option is marked Screen out - nobody can get past this question.",fix:"Clear screening"});
    if (!out.length) out.push({key:"ok",level:"ok",text:"No design issues found. This question is ready to test."});
    return out;
  }
  function questionCheckHtml() {
    var issues = questionIssues(), bad = issues.filter(function(x){return x.level !== 'ok';}).length;
    return '<div class="st-qcheck ' + (bad ? 'has-issues' : 'is-ok') + '"><div class="st-qcheck-head"><span>✦</span><b>AI design check</b><em>' + (bad ? bad + ' suggestion' + (bad === 1 ? '' : 's') : 'Looks good') + '</em><button class="st-btn sm" data-act="q-ai-help">Ask agent</button></div>' + issues.map(function(x){return '<div class="st-qissue ' + x.level + '"><i>' + (x.level === 'ok' ? '✓' : x.level === 'error' ? '!' : '△') + '</i><span>' + esc(x.text) + '</span>' + (x.fix ? '<button data-act="q-fix" data-fix="' + x.key + '">' + esc(x.fix) + '</button>' : '') + '</div>';}).join('') + '<small>Nothing is changed without your approval.</small></div>';
  }
  function refreshQuestionCheck() { var h = document.getElementById('st-qcheck'); if (h) h.innerHTML = questionCheckHtml(); }
  function applyQuestionFix(key) {
    if (!confirm('Apply this suggested edit to ' + ed.id + '? You can continue editing it afterwards.')) return;
    if (key === 'stem') { ed.stem = 'Which of the following best describes your experience?'; ed.stem_html = ed.stem; }
    if (key === 'shorten') { ed.stem = String(ed.stem).split(/[?.]/)[0].slice(0,160) + '?'; ed.stem_html = esc(ed.stem); }
    if (key === 'double') { ed.stem = String(ed.stem).replace(/\s+(and|or)\s+.*?(\?|$)/i, '?'); ed.stem_html = esc(ed.stem); }
    if (key === 'leading') { ed.stem = String(ed.stem).replace(/obviously|clearly|excellent|best/gi, '').replace(/don't you/gi, 'do you'); ed.stem_html = esc(ed.stem); }
    if (key === 'options') ed.options = [{code:1,label:'Option one'},{code:2,label:'Option two'},{code:99,label:'Other',other:true,pin:true}];
    if (key === 'gridrows') ed.rows = [{code:'a',label:'First row'},{code:'b',label:'Second row'},{code:'c',label:'Third row'}];
    if (key === 'gridcols') ed.cols = [{code:'c1',label:'First column'},{code:'c2',label:'Second column'},{code:'c3',label:'Third column'}];
    if (key === 'emptyopt') (ed.options || []).forEach(function(o,i){if(!String(o.label || '').trim()) o.label='Option ' + (i+1);});
    if (key === 'logic') { var prior = cur.cfg.questions.slice(0,sel)[0]; if (prior) ed.show_if = {match:'all',rules:[{q:prior.id,op:prior.options?'selected':'answered',value:prior.options?prior.options[0].code:''}]}; else delete ed.show_if; }
    if (key === 'screen') delete ed.screening;
    if (key === 'screen-next' && ed.screening) ed.screening.when = 'next';
    if (key === 'screen-opts') (ed.options || []).forEach(function(o){ delete o.terminate; });
    markChanged(); renderOutline(); renderEditorPane(); toast('Suggestion applied — review before publishing');
  }

  // ---- card: question text -------------------------------------------------------------
  function qCard() {
    return '<div class="st-field"><label>Question text</label>' + richToolbar("f-stem-rich") +
      '<div class="st-rich" id="f-stem-rich" contenteditable="true" data-rich="stem_html" data-placeholder="Type the question\u2026">' + chipify(Q.sanitize(ed.stem_html || "")) + "</div>" +
      '<button type="button" class="st-addmedia' + (ed.media && ed.media.src ? " on" : "") + '" data-act="media-add-quick"' +
        ' title="Attach an image or a video to this question - it is shown under the question text">' +
        (ed.media && ed.media.src ? "\u2713 Image or video attached" : "+ Add Image &amp; Video Attachments") + "</button>" +
      '<div class="st-hint">Select text to format it. <b>\u27A4 Pipe in answer</b> inserts something the respondent said earlier - e.g. <code>{Q1}</code> becomes their Q1 answer.</div></div>' +
      '<div class="st-field"><label>Help text <span class="st-opt">optional - smaller text under the question</span></label>' + richToolbar("f-help-rich", true) +
      '<div class="st-rich sm" id="f-help-rich" contenteditable="true" data-rich="help_html" data-placeholder="e.g. Think about the last 3 months">' + chipify(Q.sanitize(ed.help_html || esc(ed.help || ""))) + "</div></div>";
  }

  // The rich-text toolbar mirrors the reference editor: size and font, B/I/U, a "more"
  // row, colours, alignment, lists, link, table, superscript, image, pipe, fullscreen and a
  // source view.  Everything it can produce survives core/sanitize.py + BeaconQ.sanitize.
  function richToolbar(target, small) {
    var b = function (cmd, label, title, val) {
      return '<button type="button" class="st-tb" data-cmd="' + cmd + '" data-val="' + (val || "") + '" data-target="' + target + '" title="' + title + '">' + label + "</button>";
    };
    var act = function (a, label, title) {
      return '<button type="button" class="st-tb" data-tb-act="' + a + '" data-target="' + target + '" title="' + title + '">' + label + "</button>";
    };
    var pick = function (cmd, title, opts) {
      return '<select class="st-tb-sel" data-cmd="' + cmd + '" data-target="' + target + '" title="' + title + '" aria-label="' + title + '">' + opts + "</select>";
    };
    var sizes = [["", "12px"], ["1", "10px"], ["2", "12px"], ["3", "14px"], ["4", "16px"], ["5", "20px"], ["6", "24px"], ["7", "32px"]]
      .map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === "" ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
    var fonts = [["", "Sans Serif"], ["Arial, Helvetica, sans-serif", "Arial"], ["Georgia, serif", "Georgia"], ["'Times New Roman', serif", "Times New Roman"], ["'Courier New', monospace", "Courier New"]]
      .map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === "" ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
    return '<div class="st-toolbar">' +
      pick("fontSize", "Text size", sizes) + (small ? "" : pick("fontName", "Font", fonts)) +
      b("bold", "<b>B</b>", "Bold") + b("italic", "<i>I</i>", "Italic") + b("underline", "<u>U</u>", "Underline") +
      act("more", "\u2026", "More formatting") +
      '<label class="st-tb st-tb-color" title="Text colour">A<input type="color" data-cmd="foreColor" data-target="' + target + '" value="#b3261e"></label>' +
      '<label class="st-tb st-tb-color hl" title="Highlight colour">&#9639;<input type="color" data-cmd="hiliteColor" data-target="' + target + '" value="#fff3a3"></label>' +
      b("justifyLeft", "\u2261", "Align left") + b("justifyCenter", "\u2261", "Align centre") + b("justifyRight", "\u2261", "Align right") +
      b("insertUnorderedList", "&#8226; list", "Bulleted list") + b("insertOrderedList", "1. list", "Numbered list") +
      act("link", "\u{1F517}", "Insert link") + act("table", "\u25A6", "Insert table") +
      b("superscript", "x<sup>2</sup>", "Superscript") +
      act("image", "\u{1F5BC}", "Attach an image or video to this question") +
      (small ? "" : b("fontSize", "A&#8593;", "Bigger", "5") + b("fontSize", "A&#8595;", "Smaller", "2")) +
      '<span class="st-tb-sep"></span>' +
      pipeButton(target) +
      '<span class="st-tb-extra">' +
        b("strikeThrough", "<s>S</s>", "Strikethrough") + b("subscript", "x<sub>2</sub>", "Subscript") +
        b("removeFormat", "T&#818;", "Clear formatting") +
        act("source", "&lt;/&gt;", "Edit the HTML source") +
        act("fullscreen", "\u26F6", "Full screen") +
      "</span></div>";
  }

  // show {Q1} tokens as chips inside the rich editors (plain text again once saved)
  function chipify(html) {
    var tpl = document.createElement("template"); tpl.innerHTML = html;
    var walker = document.createTreeWalker(tpl.content, 4), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      if (!/\{[A-Za-z0-9_]+(\.[A-Za-z0-9_:]+)?\}/.test(n.nodeValue)) return;
      if (n.parentNode && n.parentNode.classList && n.parentNode.classList.contains("pipe")) return;
      var frag = document.createDocumentFragment();
      n.nodeValue.split(/(\{[A-Za-z0-9_]+(?:\.[A-Za-z0-9_:]+)?\})/).forEach(function (part) {
        if (/^\{[A-Za-z0-9_]+(\.[A-Za-z0-9_:]+)?\}$/.test(part)) {
          var sp = document.createElement("span"); sp.className = "pipe"; sp.setAttribute("contenteditable", "false"); sp.textContent = part; frag.appendChild(sp);
        } else if (part) frag.appendChild(document.createTextNode(part));
      });
      n.parentNode.replaceChild(frag, n);
    });
    var d = document.createElement("div"); d.appendChild(tpl.content); return d.innerHTML;
  }
  function unchip(html) { return html.replace(/<span class="pipe">(\{[^}]+\})<\/span>(?:&nbsp;|\u00a0)?/g, "$1 "); }

  // `compact` drops the words and keeps only the arrow - used inside the option / row list, where
  // the labelled pill would eat the whole label column.
  function pipeButton(target, small, compact) {
    return '<button type="button" class="st-pipe-btn' + (small ? " sm" : "") + (compact ? " icon" : "") + '" data-pipe-for="' + target + '" title="Insert an earlier answer into this text"' +
      (compact ? ' aria-label="Pipe in answer"' : "") + ">" +
      (compact ? "&#10132;" : "&#10132; Pipe in answer") + "</button>";
  }

  // ---- pipe picker -----------------------------------------------------------------------
  var pipeTarget = null, pipeCaret = null;
  function isRichField(el) { return !!el && !/^(INPUT|TEXTAREA)$/.test(el.tagName); }
  function rememberCaret(target) {
    if (isRichField(target)) {
      var s = window.getSelection();
      if (s.rangeCount && target.contains(s.anchorNode)) pipeCaret = s.getRangeAt(0).cloneRange();
      else pipeCaret = null;
    } else pipeCaret = { start: target.selectionStart, end: target.selectionEnd };
  }
  function openPipePicker(target) {
    pipeTarget = target;
    if (!pipeCaret) rememberCaret(target);
    var earlier = [];
    for (var i = 0; i < cur.cfg.questions.length; i++) {
      var q = cur.cfg.questions[i];
      if (q.id === ed.id) break;
      if (q.type !== "choice_task") earlier.push(q);
    }
    var sample = { answers: Q.sampleAnswers(cur.cfg.questions, ed.id), questions: cur.cfg.questions };
    var ex = function (tok) { var v = Q.pipe(tok, sample, ""); return v ? '<span class="st-pipe-ex">e.g. "' + esc(v.slice(0, 60)) + '"</span>' : ""; };
    var row = function (tok, label) {
      return '<button type="button" class="st-pipe-item" data-token="' + esc(tok) + '"><b>' + esc(label) + '</b><code>' + esc(tok) + "</code>" + ex(tok) + "</button>";
    };
    var html = '<div class="st-pipe-head"><strong>Pipe in an earlier answer</strong>' +
      '<span class="st-meta">Click an item to insert it where your cursor was. Respondents see their own answer in its place.</span>' +
      '<button type="button" class="ex-close" data-act="pipe-close">&times;</button></div>' +
      '<input class="st-pipe-search" placeholder="Search questions\u2026" autofocus>';
    if (!earlier.length) html += '<div class="st-note">No earlier questions yet - piping pulls answers from questions that come <em>before</em> this one.</div>';
    earlier.forEach(function (q) {
      html += '<details class="st-pipe-q" open><summary><span class="qid">' + esc(q.id) + "</span> " + esc(String(q.stem).slice(0, 90)) + "</summary><div class=\"st-pipe-list\">";
      html += row("{" + q.id + "}", "Their answer (as text)");
      if (q.options && q.options.length) {
        if (q.type === "multi_select") { html += row("{" + q.id + ".first}", "First option they ticked") + row("{" + q.id + ".last}", "Last option they ticked"); }
        html += row("{" + q.id + ".code}", "Answer code (number)");
        if (q.options.some(function (o) { return o.other; })) html += row("{" + q.id + ".other}", "Text typed in 'Other'");
        html += '<div class="st-pipe-sub">A fixed option label (does not depend on their answer)</div>';
        q.options.forEach(function (o) { html += row("{" + q.id + ".opt:" + o.code + "}", "Option " + o.code + ": " + String(o.label).slice(0, 50)); });
      }
      if (q.rows && q.rows.length) {
        html += '<div class="st-pipe-sub">Rows</div>';
        q.rows.forEach(function (r) {
          if (q.scale) html += row("{" + q.id + ".r:" + r.code + "}", "Their rating for: " + String(r.label).slice(0, 45));
          html += row("{" + q.id + ".row:" + r.code + "}", "Row label: " + String(r.label).slice(0, 50));
        });
      }
      html += row("{" + q.id + ".stem}", "The question text itself");
      html += "</div></details>";
    });
    var pop = document.getElementById("st-pipe-pop");
    pop.innerHTML = html; pop.hidden = false;
    var srch = $(".st-pipe-search", pop);
    srch.addEventListener("input", function () {
      var t = srch.value.toLowerCase();
      $$(".st-pipe-q", pop).forEach(function (d) { var hit = !t || d.textContent.toLowerCase().indexOf(t) >= 0; d.style.display = hit ? "" : "none"; d.open = true; });
    });
    setTimeout(function () { srch.focus(); }, 30);
  }
  function insertPipe(tok) {
    var t = pipeTarget; if (!t) return;
    if (isRichField(t)) {
      t.focus();
      var s = window.getSelection(), range = pipeCaret;
      if (!range || !t.contains(range.startContainer)) { range = document.createRange(); range.selectNodeContents(t); range.collapse(false); }
      s.removeAllRanges(); s.addRange(range);
      range.deleteContents();
      var node = document.createElement("span");
      node.className = "pipe"; node.setAttribute("contenteditable", "false"); node.textContent = tok;
      range.insertNode(node);
      var space = document.createTextNode("\u00a0");
      node.parentNode.insertBefore(space, node.nextSibling);
      range.setStartAfter(space); range.collapse(true);
      s.removeAllRanges(); s.addRange(range);
    } else {
      var v = t.value, a = pipeCaret ? pipeCaret.start : v.length, b = pipeCaret ? pipeCaret.end : v.length;
      if (a == null) a = b = v.length;
      t.value = v.slice(0, a) + tok + v.slice(b);
      t.focus(); t.selectionStart = t.selectionEnd = a + tok.length;
    }
    closePipePicker();
    changed();
    toast("Inserted " + tok);
  }
  function closePipePicker() { var pop = document.getElementById("st-pipe-pop"); if (pop) pop.hidden = true; pipeTarget = null; pipeCaret = null; }

  // ---- card: answers --------------------------------------------------------------------
  // One row per option / row / column: a drag grip, its position, the stored code, the label and
  // an always-visible tool strip (image, move up, move down, delete).  Behaviour chips (Pin /
  // Exclusive / Other) sit on a second line so they can never push the buttons out of the pane.
  function itemTable(kind, items, spec) {
    var noun = spec.noun || "item";
    var last = items.length - 1;
    var html = '<div class="st-items' + (spec.left ? " has-poles" : "") + '" data-kind="' + kind + '">' +
      '<div class="st-item st-item-head"><span></span><span>#</span><span>Code</span><span>' + (spec.labelHead || "Label") + "</span>" +
      (spec.left ? "<span>Left pole</span><span>Right pole</span>" : "") + "<span>Actions</span></div>" +
      items.map(function (it, i) {
        var idl = "f-" + kind + "-" + i;
        return '<div class="st-item" data-i="' + i + '">' +
          '<span class="st-grip" draggable="true" tabindex="0" role="button" aria-label="Reorder ' + esc(noun) + " " + (i + 1) + '" title="Drag to reorder \u00B7 focus and press \u2191 / \u2193 to swap">\u283F</span>' +
          '<span class="st-seq" title="Position ' + (i + 1) + ' of ' + items.length + '">' + (i + 1) + ".</span>" +
          '<input class="st-it-code" data-it="' + kind + '" data-k="code" data-i="' + i + '" value="' + esc(it.code) + '" title="Code stored in the data">' +
          '<div class="st-with-pipe"><input id="' + idl + '" data-it="' + kind + '" data-k="label" data-i="' + i + '" value="' + esc(it.label) + '" placeholder="' + esc(spec.ph || "Label") + '">' + pipeButton(idl, true, true) + "</div>" +
          (spec.left ? '<input data-it="' + kind + '" data-k="left" data-i="' + i + '" value="' + esc(it.left || "") + '" placeholder="e.g. Poor">' +
                       '<input data-it="' + kind + '" data-k="right" data-i="' + i + '" value="' + esc(it.right || "") + '" placeholder="e.g. Excellent">' : "") +
          '<span class="st-item-tools">' +
          (spec.media ? mediaCell(it, kind, i)
            : spec.image ? (it.image ? '<span class="st-thumb" title="' + esc(it.image.split("/").pop()) + '"><img src="' + esc(it.image) + '" alt=""><button class="st-x" data-act="it-img-del" data-i="' + i + '" title="Remove image">&times;</button></span>'
              : '<label class="st-ibtn" title="Attach an image">\uD83D\uDDBC<input type="file" accept="image/*" data-act="opt-img" data-oi="' + i + '" hidden></label>') : "") +
          (spec.fmt ? '<select class="st-it-fmt" data-it="' + kind + '" data-k="fmt" data-i="' + i + '" title="How the label is styled">' +
            FMT_MODES.map(function (f) {
              return '<option value="' + f[0] + '"' + ((it.fmt || "") === f[0] ? " selected" : "") + ">" + f[1] + "</option>"; }).join("") + "</select>" : "") +
          '<button class="st-ibtn" data-act="it-up" data-kind="' + kind + '" data-i="' + i + '" title="Move up"' + (i === 0 ? " disabled" : "") + '>\u25B2</button>' +
          '<button class="st-ibtn" data-act="it-down" data-kind="' + kind + '" data-i="' + i + '" title="Move down"' + (i === last ? " disabled" : "") + '>\u25BC</button>' +
          (spec.dup === false ? "" : '<button class="st-ibtn" data-act="it-dup" data-kind="' + kind + '" data-i="' + i + '" title="Duplicate this ' + esc(noun) + '">\u2398</button>') +
          '<button class="st-ibtn danger" data-act="it-del" data-kind="' + kind + '" data-i="' + i + '" title="Delete this ' + esc(noun) + '">\uD83D\uDDD1</button></span>' +
          ((spec.flags.length || spec.comment) ? '<span class="st-flags">' + (spec.flags.length ? '<span class="st-flags-lbl">Behaviour</span>' + spec.flags.map(function (f) {
            return '<label class="st-flag' + (it[f] ? " on" : "") + '" title="' + FLAG_INFO[f].tip + '"><input type="checkbox" data-it="' + kind + '" data-k="' + f + '" data-i="' + i + '"' + (it[f] ? " checked" : "") + ">" + FLAG_INFO[f].label + "</label>"; }).join("") : "") +
            (spec.comment ? '<label class="st-flag st-flag-sel" title="A comment box under this ' + esc(noun) + '">Comment ' +
              '<select data-it="' + kind + '" data-k="comment" data-i="' + i + '">' + COMMENT_MODES.map(function (m) {
                return '<option value="' + m[0] + '"' + ((it.comment || "none") === m[0] ? " selected" : "") + ">" + m[1] + "</option>"; }).join("") + "</select></label>" : "") +
            "</span>" : "") +
          "</div>";
      }).join("") + "</div>" +
      '<div class="st-item-actions"><button class="st-btn sm on" data-act="it-add" data-kind="' + kind + '">+ Add ' + spec.noun + "</button>" +
      (spec.quick || "") +
      '<button class="st-btn sm ghost" data-act="it-paste" data-kind="' + kind + '">Enter multiple\u2026</button></div>';
    return html;
  }

  // Move one list entry to another position.  Used by the \u25B2 / \u25BC buttons, the drag grip and
  // the keyboard, so all three routes share exactly the same reordering + persistence.
  function moveItem(kind, from, to, keepFocus) {
    var L = ed && ed[LIST_KEY[kind]];
    if (!L || !L.length) return;
    to = Math.max(0, Math.min(L.length - 1, to));
    if (to === from) return;
    var it = L.splice(from, 1)[0];
    L.splice(to, 0, it);
    rerenderCard("answers"); changed();
    if (keepFocus) {
      var g = $('#st-editor .st-items[data-kind="' + kind + '"] .st-item[data-i="' + to + '"] .st-grip');
      if (g) g.focus();
    }
  }
  function answersCard() {
    var t = ed.type, html = "";
    if (hasOptions(t)) {
      html += itemTable("opt", ed.options || [], { noun: "option", flags: ["pin", "exclusive", "other", "terminate"], image: true, ph: "Option label",
        quick: '<button class="st-btn sm" data-act="opt-add-none">+ None of these</button><button class="st-btn sm" data-act="opt-add-na">+ Not applicable</button><button class="st-btn sm" data-act="opt-add-other">+ Other (specify)</button>' });
      html += '<div class="st-hint"><b>Pin</b> keeps an option in place when the list is shuffled \u00B7 <b>Exclusive</b> clears the other answers (None / N/A) \u00B7 <b>Other</b> adds a text box \u00B7 <b>Screen out</b> ends the survey there and then. Groups of options, counts and conditions on other questions belong on the <b>Screening</b> tab.</div>';
      if (t === "multi_select") html += '<div class="st-grid2"><div class="st-field"><label>Maximum they may tick <span class="st-opt">blank = no limit</span></label><input id="f-maxselect" type="number" min="1" value="' + (ed.max_select || "") + '"></div></div>';
    }
    if (isGrid(t)) html += gridBlock();
    else if (t === "rating_scale") html += ratingScaleBlock();
    else if (hasRows(t)) html += itemTable("row", ed.rows || [], { noun: "row", flags: ["pin"], media: true, fmt: true, left: t === "semantic_diff", ph: t === "rank" ? "Item to rank" : "Row / statement", labelHead: t === "rank" ? "Item" : "Row" });
    if (t === "loop") {
      html += '<div class="st-field"><label>What each loop asks <span class="st-opt">{label} is replaced with the item name</span></label><input id="f-ptmpl" value="' + esc(ed.prompt_template || "{label}") + '" placeholder="{label}"></div>' +
        '<div class="st-grid3"><div class="st-field"><label>Answer type</label><select id="f-child">' +
        [["open_text", "Text entry"], ["numeric", "Numeric entry"]].map(function (o) {
          return '<option value="' + o[0] + '"' + ((ed.child || "open_text") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></div>" +
        '<div class="st-field"><label>Text rows</label><input id="f-textrows" type="number" min="1" value="' + (ed.text_rows || 2) + '"></div>' +
        '<div class="st-field"><label>Placeholder</label><input id="f-placeholder" value="' + esc(ed.placeholder || "") + '"></div></div>' +
        '<h4 class="st-h4">Loop over</h4>' + itemTable("item", ed.items || [], { noun: "item", flags: [], ph: "Item label" });
    }

    if (t === "nps") html += '<h4 class="st-h4">Scale</h4>' + scaleRangeFields();
    if (t === "numeric_matrix" || t === "delta") {
      html += '<div class="st-grid4"><div class="st-field"><label>Minimum <span class="st-opt">blank = no limit</span></label><input id="f-nmin" type="number" value="' + (ed.min != null ? ed.min : "") + '"></div>' +
        '<div class="st-field"><label>Maximum</label><input id="f-nmax" type="number" value="' + (ed.max != null ? ed.max : "") + '"></div>' +
        '<div class="st-field"><label>Step</label><input id="f-nstep" type="number" value="' + (ed.step != null ? ed.step : "") + '"></div>' +
        (t === "delta" ? '<div class="st-field"><label>&nbsp;</label><div class="st-meta">The change (after \u2212 before) is stored as <code>' + esc(ed.id) + '_delta</code>.</div></div>' : "") +
        "</div>";
      if (t === "delta") {
        html += '<div class="st-grid2"><div class="st-field"><label>\u201CBefore\u201D label</label><input id="f-beforel" value="' + esc(ed.before_label || "Before") + '"></div>' +
          '<div class="st-field"><label>\u201CAfter\u201D label</label><input id="f-afterl" value="' + esc(ed.after_label || "After") + '"></div></div>';
      }
    }
    if (t === "date") {
      html += '<div class="st-grid2"><div class="st-field"><label>Earliest date <span class="st-opt">blank = any</span></label><input id="f-datemin" type="date" value="' + esc(ed.min || "") + '"></div>' +
        '<div class="st-field"><label>Latest date</label><input id="f-datemax" type="date" value="' + esc(ed.max || "") + '"></div></div>';
    }
    if (t === "text_block") {
      html += '<div class="st-field"><label>Block text</label>' + richToolbar("f-body-rich") +
        '<div class="st-rich" id="f-body-rich" contenteditable="true" data-placeholder="What should this page say?">' + chipify(Q.sanitize(ed.body_html || esc(ed.body || ""))) + "</div>" +
        '<div class="st-hint">Shown as its own step with a Continue button. Nothing is stored for it.</div></div>';
    }
    if (t === "numeric" || t === "slider") {
      html += '<div class="st-grid4"><div class="st-field"><label>Minimum</label><input id="f-min" type="number" value="' + (ed.min != null ? ed.min : 0) + '"></div>' +
        '<div class="st-field"><label>Maximum</label><input id="f-max" type="number" value="' + (ed.max != null ? ed.max : 100) + '"></div>' +
        (t === "slider" ? '<div class="st-field"><label>Step</label><input id="f-step" type="number" value="' + (ed.step || 1) + '"></div>' : "") +
        '<div class="st-field"><label>Prefix <span class="st-opt">e.g. $</span></label><input id="f-prefix" value="' + esc(ed.prefix || "") + '"></div>' +
        '<div class="st-field"><label>Suffix <span class="st-opt">e.g. %</span></label><input id="f-suffix" value="' + esc(ed.suffix || "") + '"></div></div>';
    }
    if (t === "open_text") {
      var aiAct = ed.ai_check === false ? "off" : (ed.ai_action || "");
      html += '<div class="st-grid2"><div class="st-field"><label>Minimum words</label><input id="f-minwords" type="number" value="' + (ed.min_words || 3) + '"></div>' +
        '<div class="st-field"><label>Placeholder <span class="st-opt">grey text inside the empty box</span></label><div class="st-with-pipe"><input id="f-placeholder" value="' + esc(ed.placeholder || "") + '">' + pipeButton("f-placeholder", true) + "</div></div></div>";
      html += '<h4 class="st-h4">Written-answer quality</h4>' +
        '<div class="st-field"><label>AI-generated answer check <span class="st-opt">overrides the study-wide setting for this question</span></label>' +
        '<select id="f-aiaction">' +
        [["", "Study default - warn and ask them to confirm"],
         ["confirm", "On - warn and ask them to confirm it is their own"],
         ["warn", "On - warn only, never block"],
         ["off", "Off for this question"]].map(function (o) {
          return '<option value="' + o[0] + '"' + (aiAct === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
        }).join("") + "</select></div>" +
        '<div class="st-note">The answer is scored while they type and again on the server, so a respondent who pastes a chatbot reply is warned in the moment and flagged on their record afterwards.</div>';
    }
    if (t === "rank") html += '<div class="st-grid2"><div class="st-field"><label>How many ranks to record <span class="st-opt">top-N</span></label><input id="f-rankcount" type="number" value="' + (ed.rank_count || 3) + '"></div></div>';
    if (t === "maxdiff") html += '<div class="st-field"><label>Rounds <span class="st-opt">comma-separated item codes, one round per line</span></label><textarea id="f-rounds">' +
      (ed.rounds || []).map(function (r) { return r.items.join(","); }).join("\n") + "</textarea></div>";
    if (t === "choice_task") html += conjointCard();
    return html || '<div class="st-note">This question type has no answer settings.</div>';
  }

  // ---- card: conjoint experiment (the choice_task question's own design) ------------------
  function conjointCard() {
    var cj = conjointOf(ed);
    var info = function (txt) { return '<span class="st-info" title="' + esc(txt) + '">\u24D8</span>'; };
    var body = '<div class="st-cj">' +
      '<div class="st-field"><label>Title or reference to this Conjoint Experiment ' +
        info("Internal name for the experiment - shown to the research team, never to respondents.") + "</label>" +
        '<input id="f-cj-title" value="' + esc(cj.title || "") + '" placeholder="Title or reference to this Conjoint Experiment"></div>' +
      '<div class="st-field"><label>Description ' + info("What the respondent reads above the choice tasks. {amount} and {product} are filled in automatically.") + "</label>" +
        richToolbar("f-cj-desc") +
        '<div class="st-rich sm" id="f-cj-desc" contenteditable="true" data-cj-rich="description_html" data-placeholder="We will show you {amount} combinations of {product}...">' +
        chipify(Q.sanitize(cj.description_html || "")) + "</div></div>" +
      '<div class="st-field"><label>Patient vignette <span class="st-opt">optional - shown with every choice task</span></label>' +
        '<textarea id="f-vignette">' + esc(ed.vignette || "") + "</textarea></div>" +

      '<h4 class="st-h4">Attributes ' + info("One row per attribute. Each attribute needs at least two levels; the design balances them across the choice sets.") + "</h4>" +
      '<div class="st-cj-attrs">' + cj.attributes.map(function (a, ai) { return conjointAttrRow(a, ai); }).join("") + "</div>" +
      '<div class="st-item-actions"><button class="st-btn sm on" data-act="cj-attr-add">+ Add Attribute</button>' +
        '<button class="st-btn sm ghost" data-act="cj-attr-json">Edit as list\u2026</button></div>' +

      '<div class="st-toggles">' +
        '<label class="st-switch" title="Adds a \u201cNone of these\u201d alternative to every choice task">' +
          '<input type="checkbox" id="f-cj-none"' + (cj.allow_none !== false ? " checked" : "") + "><i></i>Allow \u201Cnone\u201D</label>" +
      "</div>" +
      '<div class="st-field"><label>Text on the \u201Cnone\u201D alternative</label>' +
        '<input id="f-cj-nonelabel" value="' + esc(cj.none_label || "None of these") + '"></div>' +

      '<h4 class="st-h4">Configure Sampling</h4><div class="st-grid2">' +
        '<div class="st-field"><label>Number of Cards ' + info("Alternatives shown side by side on each choice task.") + "</label>" +
          '<input id="f-cj-cards" type="number" min="2" max="5" value="' + (cj.n_cards || 2) + '"></div>' +
        '<div class="st-field"><label>Number of Sets ' + info("Choice tasks each respondent completes.") + "</label>" +
          '<input id="f-cj-sets" type="number" min="1" max="30" value="' + (cj.n_sets || 6) + '"></div>' +
      "</div>" +
      '<div class="st-field"><label>Minimum seconds on each task ' + info("Speeder guard - Next stays locked until the respondent has looked at the profiles.") + "</label>" +
        '<input id="f-dwell" type="number" data-set="conjoint_min_dwell" value="' + (cur.cfg.conjoint_min_dwell || 10) + '"></div>' +
      '<button class="st-btn on" data-act="genconj">Generate design</button>' + conjointStatus() +
      "</div>";
    return body;
  }

  function conjointStatus() {
    var d = cur.cfg.conjoint;
    if (!d || !d.tasks) return '<div class="st-note">No design generated yet - the choice tasks stay empty until you generate one.</div>';
    var t = Object.keys(d.tasks).length || d.tasks.length || 0;
    var alts = d.n_alts || (d.attributes && d.tasks[String(Object.keys(d.tasks)[0])] ? d.tasks[String(Object.keys(d.tasks)[0])].length : 3);
    return '<div class="st-note">Current design: <b>' + t + " sets \u00D7 " + alts + " cards</b> \u00D7 " +
      ((d.attributes || []).length) + " attributes" + (d.generated_at ? " \u00B7 generated " + esc(d.generated_at) : "") + ".</div>";
  }

  function conjointAttrRow(a, ai) {
    var tool = function (tip, cls) { return '<span class="st-info" title="' + esc(tip) + '">\u24D8</span>'; };
    return '<div class="st-cj-attr" data-cj="' + ai + '">' +
      '<div class="st-cj-attr-head">' +
        '<span class="st-grip" draggable="true" tabindex="0" role="button" aria-label="Reorder attribute ' + (ai + 1) +
          '" title="Drag to reorder">\u283F</span>' +
        '<span class="st-seq">' + (ai + 1) + ".</span>" +
        '<input class="st-cj-name" data-cj-field="label" data-i="' + ai + '" value="' + esc(a.label || "") +
          '" placeholder="Attribute name, e.g. Color">' +
        '<span class="st-item-tools">' +
          '<button class="st-ibtn" data-act="cj-attr-up" data-i="' + ai + '" title="Move up"' + (ai === 0 ? " disabled" : "") + ">\u25B2</button>" +
          '<button class="st-ibtn" data-act="cj-attr-down" data-i="' + ai + '" title="Move down"' +
            (ai === ed.conjoint.attributes.length - 1 ? " disabled" : "") + ">\u25BC</button>" +
          '<button class="st-ibtn danger" data-act="cj-attr-del" data-i="' + ai + '" title="Delete this attribute">\uD83D\uDDD1</button>' +
        "</span></div>" +
      '<div class="st-cj-attr-toggles">' +
        '<label class="st-switch" title="Generate the levels from a numeric range instead of typing each one">' +
          '<input type="checkbox" data-act="cj-attr-range" data-i="' + ai + '"' + (a.range ? " checked" : "") + "><i></i>Add Range Levels</label>" +
        '<label class="st-switch" title="Attach a picture to each level - it is shown on the choice cards">' +
          '<input type="checkbox" data-act="cj-attr-images" data-i="' + ai + '"' + (a.images && a.images.length ? " checked" : "") + "><i></i>Add Images</label>" +
        '<label class="st-switch" title="Shown in a rotating subset of the choice sets rather than in every one">' +
          '<input type="checkbox" data-act="cj-attr-group" data-i="' + ai + '"' + (a.group_inclusion ? " checked" : "") + "><i></i>Group Inclusion</label>" +
        '<label class="st-switch" title="Lower is better (price, toxicity) - the design avoids putting the best level on one card every time">' +
          '<input type="checkbox" data-act="cj-attr-bad" data-i="' + ai + '"' + (a.higher_is_bad ? " checked" : "") + "><i></i>Lower is better</label>" +
      "</div>" +
      (a.range ? conjointRangeRow(a, ai) : "") +
      '<div class="st-cj-levels"><span class="st-cj-levels-lbl">Levels ' +
        tool("The values this attribute can take. At least two are needed.") + "</span>" +
        (a.levels || []).map(function (lv, li) { return conjointLevelRow(a, ai, lv, li); }).join("") +
        '<button class="st-cj-addlevel" data-act="cj-level-add" data-i="' + ai + '">+ Add Level</button>' +
      "</div></div>";
  }

  function conjointLevelRow(a, ai, lv, li) {
    var img = (a.images && a.images[li]) || "";
    return '<div class="st-cj-level" data-cj-level="' + li + '">' +
      (a.images && a.images.length
        ? (img ? '<span class="st-thumb" title="' + esc(String(img).split("/").pop()) + '"><img src="' + esc(img) + '" alt="">' +
                 '<button class="st-x" data-act="cj-level-img-del" data-i="' + ai + '" data-l="' + li + '" title="Remove image">&times;</button></span>'
               : '<label class="st-ibtn" title="Attach an image to this level">\uD83D\uDDBC' +
                 '<input type="file" accept="image/*" data-act="cj-level-img" data-i="' + ai + '" data-l="' + li + '" hidden></label>')
        : "") +
      '<input data-cj-field="level" data-i="' + ai + '" data-l="' + li + '" value="' + esc(lv) + '" placeholder="Level ' + (li + 1) + '">' +
      '<button class="st-ibtn danger" data-act="cj-level-del" data-i="' + ai + '" data-l="' + li + '" title="Delete this level">\uD83D\uDDD1</button>' +
      "</div>";
  }

  function conjointRangeRow(a, ai) {
    var r = a.range || {};
    return '<div class="st-cj-range">' +
      '<label>From <input type="number" data-cj-range="from" data-i="' + ai + '" value="' + (r.from != null ? r.from : 1) + '"></label>' +
      '<label>To <input type="number" data-cj-range="to" data-i="' + ai + '" value="' + (r.to != null ? r.to : 5) + '"></label>' +
      '<label>Step <input type="number" min="1" data-cj-range="step" data-i="' + ai + '" value="' + (r.step != null ? r.step : 1) + '"></label>' +
      '<label>Suffix <input data-cj-range="suffix" data-i="' + ai + '" value="' + esc(r.suffix || "") + '" placeholder="% or mg"></label>' +
      '<button class="st-btn sm" data-act="cj-range-apply" data-i="' + ai + '">Build levels</button></div>';
  }

  // ---- card: display & order -------------------------------------------------------------
  function displayCard() {
    var t = ed.type, st = ed.style || {}, html = "";
    if (hasOptions(t)) {
      var lay = ed.layout || (t === "multi_select" ? "grid" : "list");
      html += '<div class="st-field"><label>Layout</label><div class="st-seg" id="f-layout-seg">' + [["list", "\u2630 List"], ["grid", "\u25A6 Two columns"], ["inline", "\u25AD Chips"]].map(function (l) {
        return '<button type="button" class="st-seg-btn' + (lay === l[0] ? " on" : "") + '" data-act="set-layout" data-v="' + l[0] + '">' + l[1] + "</button>"; }).join("") + "</div></div>";
    }
    // a grid keeps its row / column order next to the rows themselves, not here
    if (hasOptions(t) || (hasRows(t) && !isGrid(t))) html += randomizeBlock(hasOptions(t) ? "options" : "rows");
    html += '<div class="st-toggles">' +
      '<label class="st-switch"><input type="checkbox" id="f-hidenum"' + (ed.hide_number ? " checked" : "") + "><i></i>Hide the question number</label>" +
      (hasOptions(t) ? '<label class="st-switch"><input type="checkbox" id="f-hidecodes"' + (ed.hide_codes ? " checked" : "") + "><i></i>Hide option codes (1., 2., \u2026)</label>" : "") +
      "</div>" +
      '<h4 class="st-h4">Text style</h4><div class="st-grid3">' +
      '<div class="st-field"><label>Font</label><select id="f-font">' + FONTS.map(function (f) { return '<option value="' + esc(f[0]) + '"' + ((st.font || "") === f[0] ? " selected" : "") + ">" + f[1] + "</option>"; }).join("") + "</select></div>" +
      '<div class="st-field"><label>Size</label><select id="f-size">' + SIZES.map(function (f) { return '<option value="' + f[0] + '"' + ((st.size || "") === f[0] ? " selected" : "") + ">" + f[1] + "</option>"; }).join("") + "</select></div>" +
      '<div class="st-field"><label>Alignment</label><select id="f-align">' + [["", "Left"], ["center", "Centre"], ["right", "Right"]].map(function (f) { return '<option value="' + f[0] + '"' + ((st.align || "") === f[0] ? " selected" : "") + ">" + f[1] + "</option>"; }).join("") + "</select></div></div>";
    return html;
  }
  function randomizeBlock(what) {
    var rz = ed.randomize; var mode = rz && typeof rz === "object" ? rz.mode : (rz || "none");
    return '<div class="st-field"><label>Order of ' + what + '</label><div class="st-radio-row">' +
      [["none", "Fixed", "Everyone sees the list as written"],
       ["shuffle", "Shuffle", "Fully random order per respondent"],
       ["rotate", "Rotate", "Random start point, relative order kept"],
       ["reverse", "Flip 50/50", "Half see the list reversed"]].map(function (m) {
        return '<label class="st-radio' + (mode === m[0] ? " on" : "") + '"><input type="radio" name="f-rz" value="' + m[0] + '"' + (mode === m[0] ? " checked" : "") + "> " + m[1] + "<small>" + m[2] + "</small></label>";
      }).join("") + "</div>" +
      '<div class="st-hint">Pinned ' + what + ' keep their position - use it for "Other", "None" or "Don\'t know". The order each respondent saw is exported as <code>' + esc(ed.id) + "_order_shown</code>.</div></div>";
  }

  // ---- card: logic -------------------------------------------------------------------
  // Show IF has its own On / Off switch: the conditions are kept when it is off.
  function sifOn() { var s = ed && ed.show_if; return !s || s.off !== true; }
  function logicCard() {
    var c = cur.cfg, sif = ed.show_if || { match: "all", rules: [] };
    var others = c.questions.filter(function (q) { return q.id !== ed.id && q.type !== "choice_task"; });
    var idx = c.questions.indexOf(ed);
    var rules = sif.rules || [];
    var on = sifOn();
    var html = '<div class="st-scr-top">' +
      '<label class="st-switch big" title="Switch the show-if conditions on or off">' +
        '<input type="checkbox" id="f-sif-on"' + (on ? " checked" : "") + "><i></i>Show IF</label>" +
      '<span class="st-meta">' + (on
        ? (rules.length ? "This question is shown only to the respondents who match." : "No conditions yet - everybody sees this question.")
        : (rules.length ? "Shown to everybody - the conditions below are kept but never applied." : "Switched off - everybody sees this question.")) +
      "</span></div>";
    html += '<div class="st-logic-guide"><span>✦</span><div><b>Need help with display logic?</b><small>Tell the agent who should see this question. It will prepare the rule and ask before applying it.</small></div><button class="st-btn sm" data-act="logic-guide">Guide me</button></div>' +
      '<div class="st-logic-intro">' + (rules.length
      ? 'Show this question <b>only when</b> <select id="f-sif-match"><option value="all"' + (sif.match !== "any" ? " selected" : "") + '>all</option><option value="any"' + (sif.match === "any" ? " selected" : "") + '>any</option></select> of these are true:'
      : "<b>Always shown.</b> Add a condition to show it only to some respondents - e.g. only those who chose \u201COncology\u201D in Q1.") + "</div>";
    if (!on && rules.length) html += '<div class="st-scr-off">Show IF is switched off - the conditions below are parked, not deleted.</div>';
    html += '<div id="f-rules">' + rules.map(function (r, i) {
      var q = others.filter(function (x) { return x.id === r.q; })[0];
      var valField;
      if (q && q.options && ["selected", "not_selected", "eq", "ne"].indexOf(r.op) >= 0) {
        valField = '<select data-rule="value" data-ri="' + i + '">' + q.options.map(function (o) {
          return '<option value="' + esc(o.code) + '"' + (String(o.code) === String(r.value) ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("") + "</select>";
      } else if (q && (q.cols || []).length && ["cell_is", "cell_not", "cell_includes", "cell_lacks"].indexOf(r.op) >= 0) {
        valField = '<select data-rule="value" data-ri="' + i + '">' + (q.rows || []).map(function (rr) {
          return '<optgroup label="' + esc(String(rr.label || rr.code)) + '">' + q.cols.map(function (cc) {
            var v = rr.code + "=" + cc.code;
            return '<option value="' + esc(v) + '"' + (v === String(r.value) ? " selected" : "") + ">" +
              esc(String(rr.label || rr.code) + " \u2192 " + String(cc.label || cc.code)) + "</option>";
          }).join("") + "</optgroup>";
        }).join("") + "</select>";
      } else if (q && q.type === "numeric_matrix" && (q.cols || []).length &&
                 ["cell_gte", "cell_lte", "cell_gt", "cell_lt", "cell_eq", "cell_ne", "cell_between"].indexOf(r.op) >= 0) {
        var nvp = String(r.value == null ? "" : r.value).split("=");
        var nvc = nvp[0] + "=" + (nvp[1] || ""), nvn = nvp.slice(2).join("=");
        valField = '<select data-rule="value" data-ri="' + i + '">' + (q.rows || []).map(function (rr) {
          return '<optgroup label="' + esc(String(rr.label || rr.code)) + '">' + q.cols.map(function (cc) {
            var v = rr.code + "=" + cc.code;
            return '<option value="' + esc(v) + '"' + (v === nvc ? " selected" : "") + ">" +
              esc(String(rr.label || rr.code) + " \u00D7 " + String(cc.label || cc.code)) + "</option>";
          }).join("") + "</optgroup>";
        }).join("") + '</select><input data-rule="cellnum" data-ri="' + i + '" type="number" class="st-scr-cellnum" value="' +
          esc(nvn) + '" placeholder="number">';
      } else if (r.op === "answered" || r.op === "not_answered") valField = "<span></span>";
      else valField = '<input data-rule="value" data-ri="' + i + '" value="' + esc(r.value == null ? "" : r.value) + '" placeholder="value">';
      return '<div class="st-rule"><span class="st-rule-no">' + (i ? (sif.match === "any" ? "or" : "and") : "when") + "</span>" +
        '<select data-rule="q" data-ri="' + i + '">' + others.map(function (x) {
          return '<option value="' + esc(x.id) + '"' + (x.id === r.q ? " selected" : "") + ">" + esc(x.id + " \u00B7 " + String(x.stem).slice(0, 48)) + (c.questions.indexOf(x) > idx ? " (comes later)" : "") + "</option>"; }).join("") + "</select>" +
        '<select data-rule="op" data-ri="' + i + '">' + OPS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === r.op ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>" +
        valField + '<button class="st-ibtn danger" data-act="rule-del" data-ri="' + i + '" title="Remove condition">\u2715</button></div>';
    }).join("") + "</div>";
    html += '<div class="st-item-actions"><button class="st-btn sm' + (rules.length ? "" : " on") + '" data-act="rule-add"' + (others.length ? "" : " disabled") + ">+ Add condition</button>" +
      (rules.length ? '<label class="st-switch"><input type="checkbox" id="f-sif-negate"' + (sif.negate ? " checked" : "") + "><i></i>Invert - <em>hide</em> when true</label>" : "") +
      (others.length ? "" : '<span class="st-meta">Add other questions first.</span>') + "</div>";
    if (rules.length) html += '<div class="st-note">With the sample answers in the preview this question is currently <b id="sif-result"></b>. Hidden questions are skipped and any answer they held is cleared.</div>';
    return html;
  }

  // ---- card: screening ------------------------------------------------------------------
  // Screen in / screen out, written as data on the question:
  //   screening: { enabled, mode: "screen_out" | "qualify", match, when: "live" | "next",
  //                message, reason, rules: [{ q, op, value }] }
  // Row-based questions (grids, allocations, numeric matrices) can also be screened the
  // structured way instead, which only needs a band or a total:
  //   screening: { type: "individual", rows: [...], min: {code: n}, max: {code: n} }
  //   screening: { type: "sum", rows: [...], sum: { op: "eq|lt|gt|between", value } }
  // Both are expanded into the same rule list by BeaconQ.screening, so the verdict, the
  // plain-English line and the exports stay in one piece.
  // The switches on individual answer options (options[].terminate) are shown here too, so
  // everything that can end the survey on this question reads in one place.
  var scrTest = {};          // {qid: answer} - the tester's own picks, on top of the sample answers

  function qById(id) {
    for (var i = 0; i < cur.cfg.questions.length; i++) if (cur.cfg.questions[i].id === id) return cur.cfg.questions[i];
    return null;
  }
  function scrOf() { return (ed && ed.screening) || null; }
  function scrRules() { var s = scrOf(); return s && s.enabled !== false ? (s.rules || []) : []; }
  // every rule the block fires, structured ones included
  function scrMode() { var s = scrOf(); return s && s.mode === "qualify" ? "qualify" : "screen_out"; }
  function optTerm() { return ((ed && ed.options) || []).filter(function (o) { return o.terminate; }); }
  // every rule that can end the survey here: the authored block + the option switches + legacy
  function scrCount() {
    if (!ed) return 0;
    return Q.screening(ed).reduce(function (n, b) { return n + b.rules.length; }, 0);
  }
  // A sensible starting value for any operator, so switching condition never leaves an
  // empty box (and never a rule that quietly matches everybody).
  function scrDefault(q, op) {
    var kind = Q.valueKind(op);
    if (kind === "none") return undefined;
    if (kind === "codes") { var o = (q.options || q.rows || q.items || [])[0]; return o ? String(o.code) : ""; }
    if (kind === "count") return 1;
    if (kind === "text") return "";
    if (kind === "between") return (q.min === undefined ? 0 : q.min) + "-" + (q.max === undefined ? 100 : q.max);
    var row = (q.rows || q.items || [])[0], code = row ? String(row.code) : "";
    if (kind === "rowvalue") return code + "=" + (q.scale ? q.scale.max : 0);
    if (kind === "rowcode") return code + "=" + ((q.cols || [])[0] ? String(q.cols[0].code) : "");
    if (kind === "cellnum") return code + "=" + ((q.cols || [])[0] ? String(q.cols[0].code) : "") +
      "=" + (q.min === undefined ? 0 : q.min);
    if (kind === "cellrange") return code + "=" + ((q.cols || [])[0] ? String(q.cols[0].code) : "") +
      "=" + (q.min === undefined ? 0 : q.min) + "-" + (q.max === undefined ? 100 : q.max);
    if (kind === "ranktop") return code + "=1";
    if (kind === "rowsum") return "=0";
    if (String(op).indexOf("total_") === 0) return q.type === "sum_to_100" ? 100 : 0;
    return q.min === undefined ? 0 : q.min;
  }
  function scrDefaultRule(q, op) {
    var r = { q: q.id, op: op }, v = scrDefault(q, op);
    if (v !== undefined) r.value = v;
    return r;
  }
  // The condition a brand new rule starts from: the one an author of this type usually wants.
  function scrSeed(q) {
    var kind = Q.qKind(q), ops = Q.opsFor(q);
    var want = (kind === "alloc" || kind === "numrows" || kind === "grid") ? "row_gte"
             : kind === "choicegrid" ? "cell_is"
             : kind === "nummatrix" ? "cell_gte"
             : kind === "number" ? "lt"
             : kind === "choice" ? "any_of"
             : kind === "rank" ? "ranked_first"
             : kind === "text" ? "contains" : "answered";
    var op = ops.filter(function (o) { return o.op === want; })[0] ? want
           : (ops.length ? ops[0].op : "answered");
    return scrDefaultRule(q, op);
  }
  // A value only survives a switch of condition if it still makes sense for the new one.
  function scrValueFits(value, kind) {
    if (kind === "none") return true;
    if (kind === "number" || kind === "count") return typeof value === "number" && isFinite(value);
    if (kind === "codes" || kind === "text") return typeof value === "string" && value !== "";
    if (kind === "between") return typeof value === "string" && value.indexOf("-") > 0;
    if (kind === "rowsum") return typeof value === "string" && value.indexOf("=") >= 0;
    if (kind === "cellnum" || kind === "cellrange") return typeof value === "string" && value.split("=").length === 3;
    return typeof value === "string" && value.indexOf("=") > 0;      // rowvalue / ranktop
  }

  function scrEnsure() {
    if (!ed.screening || typeof ed.screening !== "object") ed.screening = { mode: "screen_out", match: "all", when: "live", rules: [] };
    if (!ed.screening.rules) ed.screening.rules = [];
    ed.screening.enabled = true;
    return ed.screening;
  }
  // Numbers, grids and text are still being typed into - those rules wait for Next unless
  // the author asks for otherwise.  Choice questions fire the moment the option is picked.
  function scrWhenDefault(rules) {
    var next = (rules || []).some(function (r) {
      var k = Q.qKind(qById(r.q));
      return k === "number" || k === "text" || k === "grid" || k === "alloc" || k === "numrows" || k === "nummatrix";
    });
    return next ? "next" : "live";
  }
  function scrWhen() { var s = scrOf(); return (s && s.when) || scrWhenDefault(scrRules()); }
  function optText(o) { return Q.stripTags ? Q.stripTags(o.label) : String(o.label || ""); }
  function rowText(r) { return Q.stripTags ? Q.stripTags(r.label) : String(r.label || ""); }

  // Numbers are typed into a box that carries the question's own range and unit
  // ($, %, patients per month, points…) so an impossible threshold is hard to set.
  function unitOf(q, op) {
    var kind = Q.qKind(q), u = "";
    if (String(op || "").indexOf("total_") === 0 || Q.valueKind(op) === "rowsum" || kind === "alloc") {
      u = "points";
    }
    if (q.suffix) u = String(q.suffix);
    if (q.prefix) u = q.prefix + (u ? " " + u : "");
    return u;
  }
  function unitTag(unit) {
    return unit ? '<em class="st-scr-unit">' + esc(unit) + "</em>" : "";
  }
  // the question's own lower / upper bound, used as the placeholder of a range pair
  function numHint(q, end) {
    var v = end === "min" ? q.min : q.max;
    return v === undefined || v === null ? "" : String(v);
  }
  function numBox(q, op, value, field, opts) {
    opts = opts || {};
    var attrs = ' data-sf="' + field + '" value="' + esc(value == null ? "" : value) +
      '" placeholder="' + esc(opts.placeholder || "") + '"';
    if (opts.date) {
      return '<input class="st-scr-num" type="date"' + attrs +
        (q.min ? ' min="' + esc(q.min) + '"' : "") + (q.max ? ' max="' + esc(q.max) + '"' : "") + ">";
    }
    if (opts.range) {
      if (q.min !== undefined) attrs += ' min="' + esc(q.min) + '"';
      if (q.max !== undefined) attrs += ' max="' + esc(q.max) + '"';
      if (q.step) attrs += ' step="' + esc(q.step) + '"';
    }
    return '<span class="st-scr-numwrap"><input class="st-scr-num" type="number"' + attrs + ">" +
      unitTag(unitOf(q, op)) + "</span>";
  }
  function rowItemsOf(q) {
    if (q.type === "heatmap" && (q.cols || []).length) {          // a heat map stores row x column
      var cells = [];
      (q.rows || []).forEach(function (rr) {
        (q.cols || []).forEach(function (cc) {
          cells.push({ code: rr.code + "_" + cc.code, label: rowText(rr) + " \u00D7 " + rowText(cc) });
        });
      });
      return cells;
    }
    return q.rows || q.items || [];
  }

  // The operator dropdown is a row of symbols: = ≠ < ≤ > ≥, prefixed with a short
  // word when the number belongs to a row, a group of rows or a total.
  function opOptionText(o) {
    var fam = /^row_/.test(o.op) ? "row" : /^sum_of_/.test(o.op) ? "share" : /^total_/.test(o.op) ? "total" : "";
    if (!o.sym) return o.label;
    return fam ? fam + " " + o.sym : o.sym;
  }

  function scrValueField(r, i) {
    var q = qById(r.q) || ed, kind = Q.valueKind(r.op), codes = Q.codeList(r.value);
    var isDate = q.type === "date" && (kind === "number" || kind === "between");
    if (kind === "codes") {
      var list = (q.options || q.rows || []);
      if (!list.length) return '<input type="hidden" data-sf="value" value="' + esc(r.value == null ? "" : r.value) + '"><span class="st-meta">no options yet</span>';
      return '<div class="st-scr-chips">' + list.map(function (o) {
        var on = codes.indexOf(String(o.code)) >= 0;
        return '<button type="button" class="st-chip' + (on ? " on" : "") + '" data-act="scr-code" data-ri="' + i +
          '" data-code="' + esc(o.code) + '" title="' + (on ? "Remove from this group" : "Add to this group") + '">' +
          (on ? "\u2713 " : "+ ") + esc(optText(o) || rowText(o)) + "</button>";
      }).join("") + '<input type="hidden" data-sf="value" value="' + esc(codes.join(",")) + '"></div>';
    }
    if (kind === "count" || kind === "number" || kind === "text") {
      return numBox(q, r.op, r.value, "value", {
        date: isDate, range: kind === "number" && String(r.op).indexOf("total_") !== 0,
        placeholder: kind === "text" ? "word or phrase" : kind === "count" ? "number" : "value"
      });
    }
    if (kind === "between") {
      var p = String(r.value || "").split("-");
      return '<span class="st-scr-pair">' +
        numBox(q, r.op, p[0], "valueLo", { date: isDate, range: !isDate, placeholder: numHint(q, "min") }) +
        '<em>and</em>' +
        numBox(q, r.op, p[1], "valueHi", { date: isDate, range: !isDate, placeholder: numHint(q, "max") }) +
        "</span>";
    }
    // "these rows add up to at least N" - tick the rows, then type the number
    if (kind === "rowsum") {
      var bits = String(r.value || "").split("=");
      var picked = Q.codeList(bits[0]), rows2 = rowItemsOf(q);
      if (!rows2.length) return '<span class="st-meta">no rows yet</span>';
      return '<span class="st-scr-group"><input type="hidden" data-sf="value" value="' +
        esc(picked.join(",") + "=" + (bits[1] || "")) + '"><em>of</em>' +
        '<div class="st-scr-chips">' + rows2.map(function (o) {
          var on = picked.indexOf(String(o.code)) >= 0;
          return '<button type="button" class="st-chip' + (on ? " on" : "") + '" data-act="scr-row-code" data-ri="' + i +
            '" data-code="' + esc(o.code) + '" title="' + (on ? "Leave this row out of the group" : "Add this row to the group") + '">' +
            (on ? "\u2713 " : "+ ") + esc(rowText(o)) + "</button>";
        }).join("") + "</div>" +
        '<div class="st-scr-pickrow">' + numBox(q, r.op, bits[1], "valueSum", { placeholder: "points" }) + "</div></span>";
    }
    if (kind === "rowvalue" || kind === "ranktop") {
      var rows = rowItemsOf(q);
      if (!rows.length) return '<span class="st-meta">no rows yet</span>';
      var parts = String(r.value || "").split("=");
      var want = parts[0], num = parts[1] || "";
      var pts = [];
      if (kind === "ranktop") { for (var n = 1; n <= rows.length; n++) pts.push(n); }
      else if (q.scale) { for (var v = q.scale.min; v <= q.scale.max; v++) pts.push(v); }
      return '<span class="st-scr-pair"><select data-sf="row">' + rows.map(function (o) {
        return '<option value="' + esc(o.code) + '"' + (String(o.code) === want ? " selected" : "") + ">" + esc(rowText(o)) + "</option>";
      }).join("") + "</select>" +
        (kind === "ranktop" ? '<em>top</em>' : "<span></span>") +
        (pts.length
          ? '<select data-sf="value">' + pts.map(function (v) {
              return '<option value="' + esc(v) + '"' + (String(v) === num ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("") + "</select>"
          : numBox(q, r.op, num, "value", { placeholder: "value" })) + "</span>";
    }
    // "row is [column]" - pick the row, then the column it must point at
    if (kind === "rowcode") {
      var grows = rowItemsOf(q), gcols = q.cols || [];
      if (!grows.length || !gcols.length) return '<span class="st-meta">no rows or columns yet</span>';
      var gparts = String(r.value || "").split("=");
      var gwant = gparts[0], gcol = gparts[1] || "";
      var gword = { cell_is: "is", cell_not: "is not", cell_includes: "includes",
                    cell_lacks: "does not include" }[r.op] || "is";
      return '<span class="st-scr-pair"><select data-sf="row">' + grows.map(function (o) {
        return '<option value="' + esc(o.code) + '"' + (String(o.code) === gwant ? " selected" : "") + ">" + esc(rowText(o)) + "</option>";
      }).join("") + "</select><em>" + gword + '</em><select data-sf="col">' + gcols.map(function (c) {
        return '<option value="' + esc(c.code) + '"' + (String(c.code) === gcol ? " selected" : "") + ">" + esc(rowText(c)) + "</option>";
      }).join("") + "</select></span>";
    }
    // "cell is at least [number]" - pick the row and the column, then the number to compare
    if (kind === "cellnum" || kind === "cellrange") {
      var nrows = rowItemsOf(q), ncolz = q.cols || [];
      if (!nrows.length || !ncolz.length) return '<span class="st-meta">no rows or columns yet</span>';
      var nparts = String(r.value || "").split("=");
      var nwantR = nparts[0] || "", nwantC = nparts[1] || "", ntail = nparts.slice(2).join("=");
      var nword = { cell_gte: "is at least", cell_lte: "is at most", cell_gt: "is more than",
                    cell_lt: "is less than", cell_eq: "is", cell_ne: "is not",
                    cell_between: "is between" }[r.op] || "is";
      var nhtml = '<span class="st-scr-pair"><select data-sf="row">' + nrows.map(function (o) {
        return '<option value="' + esc(o.code) + '"' + (String(o.code) === nwantR ? " selected" : "") + ">" + esc(rowText(o)) + "</option>";
      }).join("") + '</select><em>\u00D7</em><select data-sf="col">' + ncolz.map(function (c) {
        return '<option value="' + esc(c.code) + '"' + (String(c.code) === nwantC ? " selected" : "") + ">" + esc(rowText(c)) + "</option>";
      }).join("") + '</select><em>' + nword + "</em>";
      if (kind === "cellrange") {
        var nband = String(ntail || "").split("-");
        return nhtml + numBox(q, r.op, nband[0], "valueLo", { range: true, placeholder: "min" }) +
          "<em>and</em>" + numBox(q, r.op, nband[1], "valueHi", { range: true, placeholder: "max" }) + "</span>";
      }
      return nhtml + numBox(q, r.op, ntail, "value", { range: true, placeholder: "value" }) + "</span>";
    }
    return "<span></span>";
  }

  function scrRuleRow(r, i, match) {
    var q = qById(r.q) || ed;
    var ops = Q.opsFor(q);
    if (!ops.some(function (o) { return o.op === r.op; })) r.op = ops.length ? ops[0].op : "answered";
    var idx = cur.cfg.questions.indexOf(ed);
    var earlier = cur.cfg.questions.filter(function (x, xi) { return xi < idx; });
    var later = cur.cfg.questions.filter(function (x, xi) { return xi > idx; });
    function qOpts(list) {
      return list.map(function (x) {
        return '<option value="' + esc(x.id) + '"' + (x.id === r.q ? " selected" : "") + ">" +
          esc(x.id + " \u00B7 " + String(x.stem || "").slice(0, 46)) + "</option>"; }).join("");
    }
    return '<div class="st-rule">' +
      '<span class="st-rule-no">' + (i ? (match === "any" ? "or" : "and") : "when") + "</span>" +
      '<select data-sf="q" data-ri="' + i + '">' +
        '<optgroup label="This question">' +
        '<option value="' + esc(ed.id) + '"' + (ed.id === r.q ? " selected" : "") + ">" +
          esc(ed.id + " (this question)") + "</option></optgroup>" +
        (earlier.length ? '<optgroup label="Earlier questions">' + qOpts(earlier) + "</optgroup>" : "") +
        (later.length ? '<optgroup label="Later questions - cannot fire here">' + qOpts(later) + "</optgroup>" : "") +
      "</select>" +
      '<select data-sf="op" data-ri="' + i + '" class="st-scr-op">' + ops.map(function (o) {
        return '<option value="' + o.op + '"' + (o.op === r.op ? " selected" : "") +
          ' title="' + esc(o.label) + '">' + esc(opOptionText(o)) + "</option>"; }).join("") + "</select>" +
      scrValueField(r, i) +
      '<button class="st-ibtn danger" data-act="scr-del" data-ri="' + i + '" title="Remove condition">\u2715</button></div>';
  }

  // ---- the tester: pick answers by hand and see exactly what the rules do -----------------
  function scrTestAnswers() {
    var answers = Q.sampleAnswers(cur.cfg.questions, ed.id);
    Object.keys(scrTest).forEach(function (qid) {
      if (qid === ed.id && !Q.screening(ed).length) return;
      answers[qid] = scrTest[qid];
    });
    return answers;
  }
  function scrPick(q, code) {
    var a = scrTest[q.id] || (scrTest[q.id] = {});
    if (q.type === "multi_select") {
      var codes = (a.codes || []).slice(), i = codes.indexOf(code);
      if (i >= 0) codes.splice(i, 1); else codes.push(code);
      a.codes = codes;
    } else if (q.type === "rank") {
      var order = (a.order || []).slice(), j = order.indexOf(code);
      if (j >= 0) order.splice(j, 1); else order.push(code);
      a.order = order;
    } else if (a._ === code) delete a._;
    else a._ = code;
    scrTest[q.id] = a;
  }
  function scrTester() {
    var q = ed, t = q.type, a = scrTest[q.id] || {};
    var picks = "";
    if (t === "single_select" || t === "multi_select" || t === "rank") {
      var chosen = t === "multi_select" ? (a.codes || []) : t === "rank" ? (a.order || []) : [a._];
      picks = '<div class="st-scr-chips">' + (q.options || q.rows || []).map(function (o, i) {
        var at = chosen.indexOf(o.code);
        return '<button type="button" class="st-chip' + (at >= 0 ? " on" : "") + '" data-act="scr-pick" data-code="' + esc(o.code) + '">' +
          (t === "rank" && at >= 0 ? (at + 1) + ". " : "") + esc(optText(o) || rowText(o)) + "</button>";
      }).join("") + "</div>";
      if (t === "rank") picks += '<div class="st-hint">Tap the items in the order the respondent would rank them \u00B7 tap again to remove.</div>';
    } else if (Q.qKind(q) === "choicegrid") {
      var multiG = q.select === "multi", colsG = q.cols || [];
      picks = '<div class="st-scr-rows">' + (q.rows || []).map(function (r) {
        var cur = a[r.code], on = Array.isArray(cur) ? cur.map(String) : cur === undefined ? [] : [String(cur)];
        return '<div class="st-scr-row"><span>' + esc(rowText(r)) + "</span>" + colsG.map(function (c) {
          var hit = on.indexOf(String(c.code)) >= 0;
          return '<button type="button" class="st-chip sm' + (hit ? " on" : "") + '" data-act="scr-cell" data-row="' +
            esc(r.code) + '" data-col="' + esc(c.code) + '">' + esc(rowText(c)) + "</button>";
        }).join("") + (a[r.code] === "NA" ? '<button type="button" class="st-chip sm on" disabled>N/A</button>' : "") +
          "</div>";
      }).join("") + "</div>" +
      '<div class="st-hint">' + (multiG
        ? "Tap the columns each row would tick - tap again to untick."
        : "Tap the column each row would pick - like the respondent's radio buttons.") + "</div>";
    } else if (Q.qKind(q) === "nummatrix") {
      var colsN = q.cols || [];
      picks = '<div class="st-scr-rows">' + (q.rows || []).map(function (r) {
        return '<div class="st-scr-row"><span>' + esc(rowText(r)) + "</span>" + colsN.map(function (c) {
          var key = r.code + "_" + c.code, v = a[key];
          return '<span class="st-scr-cell"><i>' + esc(rowText(c)) + '</i><input type="number" class="st-scr-rownum" data-scr-row="' +
            esc(key) + '" value="' + esc(v === undefined ? "" : v) + '" placeholder="0"></span>';
        }).join("") + (a[r.code] === "NA" ? '<button type="button" class="st-chip sm on" disabled>N/A</button>' : "") +
          "</div>";
      }).join("") + "</div>" +
      '<div class="st-hint">Type the number the respondent would enter in each cell.</div>';
    } else if (["grid", "alloc", "numrows"].indexOf(Q.qKind(q)) >= 0) {
      var k2 = Q.qKind(q), rows2 = q.rows || q.items || [], running = 0;
      picks = '<div class="st-scr-rows">' + rows2.map(function (r) {
        if (q.scale) {                                  // a scale: tap a point on the scale
          var pts = Array.apply(null, { length: q.scale.max - q.scale.min + 1 }).map(function (_, k) { return q.scale.min + k; });
          return '<div class="st-scr-row"><span>' + esc(rowText(r)) + "</span>" + pts.map(function (v) {
            return '<button type="button" class="st-chip sm' + (String(a[r.code]) === String(v) ? " on" : "") +
              '" data-act="scr-row" data-row="' + esc(r.code) + '" data-v="' + esc(v) + '">' + esc(v) + "</button>";
          }).join("") + "</div>";
        }
        running += Number(a[r.code] || 0);              // an allocation: type a number per row
        return '<div class="st-scr-row"><span>' + esc(rowText(r)) + "</span>" +
          '<input type="number" class="st-scr-rownum" data-scr-row="' + esc(r.code) + '" value="' +
          esc(a[r.code] === undefined ? "" : a[r.code]) + '" placeholder="0">' +
          unitTag(unitOf(q, "row_gte")) + "</div>";
      }).join("") + (k2 === "alloc"
        ? '<div class="st-scr-total">Total <b>' + esc(running) + "</b> " + esc(unitOf(q, "total_eq")) + "</div>" : "") +
        "</div>";
    } else if (Q.qKind(q) === "number") {
      var lo = q.min !== undefined ? q.min : 0, hi = q.max !== undefined ? q.max : 10;
      picks = '<div class="st-scr-pickrow"><input type="number" id="f-scr-try" value="' +
        esc(a._ === undefined ? Math.round((Number(lo) + Number(hi)) / 2) : a._) + '"><span class="st-meta">e.g. ' +
        esc(lo) + " to " + esc(hi) + "</span></div>";
    } else if (Q.qKind(q) === "text") {
      picks = '<div class="st-scr-pickrow"><input type="text" id="f-scr-try" value="' + esc(a._ || "") +
        '" placeholder="What the respondent writes"></div>';
    } else {
      picks = '<div class="st-hint">Use <b>\u25B6 Test</b> above to try this question type by hand.</div>';
    }
    var answers = scrTestAnswers();
    var v = Q.screeningVerdict(cur.cfg.questions, answers, { upto: cur.cfg.questions.indexOf(q) });
    var out = v
      ? '<div class="st-scr-verdict out"><b>SCREENED OUT</b><span>' + esc(v.reason) + "</span>" +
        '<em>Respondent reads: “' + esc(v.message || "the study's closing text") + '”</em></div>'
      : '<div class="st-scr-verdict pass"><b>CONTINUES</b><span>No screening rule fires for this answer.</span></div>';
    return '<div class="st-scr-test"><div class="st-scr-test-head"><b>Try it</b>' +
      '<span class="st-meta">Earlier questions use sample answers</span>' +
      '<button class="st-btn sm ghost" data-act="scr-test-clear">Reset</button></div>' +
      picks + out + "</div>";
  }

  // The rules in one readable line, shown on every tab of the question so no one has to
  // go looking for them.  Refreshed in place while an author types a number.
  function scrPlainHtml() {
    return Q.screenSummary(ed, cur.cfg.questions).map(function (b) {
      return '<div class="st-scr-linerow ' + b.mode + '"><i>' + (b.mode === "qualify" ? "\u2713" : "\u26D4") + "</i>" +
        "<span>" + esc(b.text) + "</span><em>" + (b.when === "live" ? "on the spot" : "on Next") + "</em>" +
        (b.source === "options" ? "<u>from the answer options</u>" : "") + "</div>";
    }).join("");
  }
  function refreshScrPlain() {
    var host = document.getElementById("f-scr-plain"); if (!host) return;
    host.innerHTML = scrPlainHtml();
  }
  function scrLineHtml() {
    if (!ed || !Q.screenSummary(ed, cur.cfg.questions).length) return "";
    return '<div class="st-scr-linebar"><div id="f-scr-plain-2">' + scrPlainHtml() + "</div>" +
      '<button class="st-btn sm" data-act="edtab" data-t="screen">Edit screening</button></div>';
  }

  // ---- the screener: direction, screener type, On / Off ----------------------------------
  var SCR_DIR = [
    ["screen_out", "Screen Out", "Respondents who match are ended here"],
    ["qualify", "Screen In", "Only respondents who match carry on past this question"]
  ];
  var SCR_TYPES = [
    ["individual", "Individual", "A Minimum and Maximum for each answer on its own"],
    ["sum", "Sum of responses", "One comparison over the answers put together"]
  ];
  var SUM_CMP = [["eq", "is equal to"], ["lt", "is less than"], ["gt", "is greater than"],
                 ["between", "is between (Min to Max)"]];
  var SCR_STRUCTURED = ["grid", "alloc", "numrows"];

  function scrIsStructured() { return ed && SCR_STRUCTURED.indexOf(Q.qKind(ed)) >= 0; }
  function scrType() { var s = scrOf(); return s && s.type === "sum" ? "sum" : "individual"; }
  function scrOutside() { var s = scrOf(); return !s || s.outside !== false; }
  function scrSum() { var s = scrOf(); return (s && s.sum) || { op: "eq", value: 0 }; }
  function scrRows() { var s = scrOf(); return ((s && s.rows) || []).map(String); }
  function scrOn() {
    var s = scrOf();
    if (s) return s.enabled !== false;
    // no authored block yet: the switch mirrors whatever legacy logic is already
    // live on this question (Screen-out marks on options, terminate_if_lt) so the
    // card never claims to be off while something still fires
    return optTerm().length > 0 ||
      (ed && ed.terminate_if_lt !== undefined && ed.terminate_if_lt !== null &&
       String(ed.terminate_if_lt) !== "");
  }
  function scrBand(code, end) {                    // the Min / Max held for one answer
    var s = scrOf() || {}, have = (s.min || {})[code] !== undefined || (s.max || {})[code] !== undefined;
    if (!have) return end === "min" ? (ed.scale ? ed.scale.min : 0) : (ed.scale ? ed.scale.max : 100);
    return end === "min" ? Number((s.min || {})[code] || 0) : Number((s.max || {})[code] || 0);
  }
  function rowByCode(code) {
    var rows = rowItemsOf(ed);
    for (var i = 0; i < rows.length; i++) if (String(rows[i].code) === String(code)) return rows[i];
    return { code: code, label: code };
  }
  // A two-way (or three-way) choice as one connected strip of buttons.
  function scrSeg(name, list, current) {
    return '<span class="st-seg">' + list.map(function (o) {
      return '<label class="st-seg-btn' + (current === o[0] ? " on" : "") + '" title="' + esc(o[2] || "") + '">' +
        '<input type="radio" name="' + name + '" value="' + o[0] + '"' + (current === o[0] ? " checked" : "") + ">" +
        esc(o[1]) + "</label>";
    }).join("") + "</span>";
  }

  // Every answer of the question as a dropdown - used to add an answer to the screener and
  // to point an existing band at a different one.  Answers already spoken for are disabled.
  function scrAnswerSelect(current, attrs) {
    var used = scrRows();
    return "<select " + attrs + ">" + rowItemsOf(ed).map(function (o) {
      var code = String(o.code);
      var taken = used.indexOf(code) >= 0 && code !== String(current);
      return '<option value="' + esc(code) + '"' + (code === String(current) ? " selected" : "") +
        (taken ? " disabled" : "") + ">" + esc(rowText(o)) + "</option>";
    }).join("") + "</select>";
  }
  function scrAddSelect() {
    var used = scrRows(), all = rowItemsOf(ed);
    var free = all.filter(function (o) { return used.indexOf(String(o.code)) < 0; });
    var lead = !all.length ? "This question has no answers yet"
      : free.length ? "\uFF0B Add an answer\u2026" : "Every answer is already in";
    return '<select id="f-scr-add-row" class="st-scr-addrow"' + (free.length ? "" : " disabled") + ">" +
      '<option value="">' + lead + "</option>" + free.map(function (o) {
        return '<option value="' + esc(o.code) + '">' + esc(rowText(o)) + "</option>"; }).join("") + "</select>";
  }

  // "Individual": a Minimum and Maximum for every answer that takes part.
  function scrIndividualEditor(picked) {
    var inside = !scrOutside();
    var html = '<div class="st-scr-block"><div class="st-scr-blockhead">Minimum and maximum for each answer' +
      '<span class="st-scr-inline">each answer must be <select id="f-scr-outside">' +
      '<option value="inside"' + (inside ? " selected" : "") + ">inside</option>" +
      '<option value="outside"' + (inside ? "" : " selected") + ">outside</option></select> its range</span></div>";
    if (!picked.length) {
      html += '<div class="st-scr-empty">No answer yet - add one below and give it a range.</div>';
    }
    html += picked.map(function (code, i) {
      return '<div class="st-scr-minmax" data-band="' + i + '">' +
        scrAnswerSelect(code, 'data-sf="scrat" data-scr-at="' + i + '" title="Which answer this range belongs to"') +
        '<label class="st-mini">Minimum <input class="st-scr-num" type="number" data-sf="scrmin" data-scr-min value="' +
          esc(scrBand(code, "min")) + '"></label>' +
        '<label class="st-mini">Maximum <input class="st-scr-num" type="number" data-sf="scrmax" data-scr-max value="' +
          esc(scrBand(code, "max")) + '"></label>' +
        '<span class="st-meta">' + esc(scrUnit()) + "</span>" +
        '<button class="st-ibtn danger" data-act="scr-del-row" data-i="' + i +
          '" title="Take this answer out of the screener">\u2715</button>' +
        "</div>";
    }).join("");
    return html + '<div class="st-item-actions">' + scrAddSelect() +
      '<span class="st-meta">Every answer of the question is in the list.</span></div></div>';
  }
  // "Sum of responses": one comparison over the answers put together.
  function scrSumEditor(picked) {
    var sum = scrSum(), cmp = sum.op;
    if (!SUM_CMP.some(function (o) { return o[0] === cmp; })) cmp = "eq";
    var html = '<div class="st-scr-block"><div class="st-scr-blockhead">The sum of these answers' +
      (picked.length ? "" : ' <span class="st-scr-inline">pick the answers that take part first</span>') +
      "</div>" + '<div class="st-scr-sumrow"><select id="f-scr-sum-op">' + SUM_CMP.map(function (o) {
        return '<option value="' + o[0] + '"' + (cmp === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select>";
    if (cmp === "between") {
      var g = String(sum.value === undefined || sum.value === null ? "0-100" : sum.value).split("-");
      html += numBox(ed, "sum_between", g[0], "f-scr-sum-lo", { placeholder: "Min" }) +
        '<em>to</em>' + numBox(ed, "sum_between", g[1], "f-scr-sum-hi", { placeholder: "Max" });
    } else {
      html += numBox(ed, "sum_" + cmp, sum.value, "f-scr-sum-val", { placeholder: "value" });
    }
    html += "</div>";                                  // close the comparison row
    html += '<div class="st-item-actions">' + scrAddSelect() +
      '<span class="st-meta">Only the answers you add are added up.</span></div>';
    return html + "</div>";
  }
  function scrUnit() { return unitOf(ed, "row_gte") ? String(unitOf(ed, "row_gte")) : "points"; }

  // The extra conditions (and the only conditions on questions without rows): the full
  // rule builder - one option, a group of options, a count, a number, anything.
  function scrRulesEditor(s, rules, primary) {
    var html = '<div id="f-scr-rules">' + rules.map(function (r, i) {
      return scrRuleRow(r, i, s.match === "any" ? "any" : "all"); }).join("") + "</div>";
    html += '<div class="st-item-actions"><button class="st-btn sm' + (rules.length ? "" : " on") +
      '" data-act="scr-add">+ Add condition</button>' +
      '<span class="st-meta">' + (rules.length
        ? "Group a set of options with <b>is any of</b> \u00B7 count them with <b>selects at least</b>."
        : "Start with this question, or point the condition at an earlier one.") + "</span></div>";
    // a band per answer fires when any one of them breaks; everything else waits for all
    var bands = scrIsStructured() && s.type !== "sum" ? scrRows().length : 0;
    if (rules.length || bands > 1) {
      var isAny = s.match ? s.match === "any" : bands > 0;
      html = '<div class="st-scr-combine">Combine these with <select id="f-scr-match">' +
        '<option value="any"' + (isAny ? " selected" : "") + ">any</option>" +
        '<option value="all"' + (isAny ? "" : " selected") + ">all</option></select>" +
        '<span class="st-meta">"any" fires as soon as one of them is true.</span></div>' + html;
    }
    return primary ? html : '<details class="st-scr-more"' + (rules.length || bands > 1 ? " open" : "") +
      "><summary>More conditions" + (rules.length ? " (" + rules.length + ")" : "") + "</summary>" + html + "</details>";
  }

  function screeningCard() {
    var s = scrOf() || {}, on = scrOn(), mode = scrMode(), rules = scrRules();
    var structured = scrIsStructured(), type = scrType(), picked = scrRows();
    var legacy = optTerm();
    var html = '<div class="st-scr-top">' +
      '<label class="st-switch big" title="Turn screening on this question on or off">' +
        '<input type="checkbox" id="f-scr-on"' + (on ? " checked" : "") + "><i></i>Screening</label>" +
      '<span class="st-meta">' + (on
        ? "This question can end the survey."
        : "Screening is off - nobody is ended on this question.") +
      "</span></div>";
    if (!on) {
      // off means off: no rule, no tester, no "still screening" note anywhere on the card.
      // Everything the author set up is kept on the question and comes back with the switch.
      html += '<div class="st-scr-off">Screening is switched off, so no screening logic is shown or ' +
        'applied. Any conditions and the Screen-out marks on answer options are kept - switch it on ' +
        'to see and edit them.</div>';
      return html;
    }
    html += '<div class="st-scr-lead">Respondents will ' + scrSeg("f-scr-dir", SCR_DIR, mode) +
      " <b>if the answer criteria is met</b>.</div>";
    if (structured) {
      html += '<div class="st-scr-block"><div class="st-scr-blockhead">Screener type</div>' +
        scrSeg("f-scr-type", SCR_TYPES, type) + "</div>";
      // Individual names its answers row by row, so it needs no separate picker;
      // Sum is a set, so it keeps the chips and gets the same dropdown.
      if (type === "sum") {
        var rows = rowItemsOf(ed);
        html += '<div class="st-scr-block"><div class="st-scr-blockhead">Which answers take part</div>' +
          '<div class="st-scr-chips">' + (rows.length ? rows.map(function (o) {
            var code = String(o.code), onRow = picked.indexOf(code) >= 0;
            return '<button type="button" class="st-chip' + (onRow ? " on" : "") +
              '" data-act="scr-pick-row" data-code="' + esc(code) + '" title="' +
              (onRow ? "Leave this answer out of the screener" : "Screen this answer") + '">' +
              (onRow ? "\u2713 " : "+ ") + esc(rowText(o)) + "</button>";
          }).join("") : '<span class="st-meta">no rows yet</span>') + "</div></div>";
        html += scrSumEditor(picked);
      } else {
        html += scrIndividualEditor(picked);
      }
      html += scrRulesEditor(s, rules, false);
    } else {
      html += scrRulesEditor(s, rules, true);
    }
    if (rules.length || (structured && picked.length)) {
      html += '<div class="st-grid2">' +
        '<div class="st-field"><label>Check the rule <span class="st-opt">when is it applied?</span></label><select id="f-scr-when">' +
        [["live", "\u26A1 As soon as it matches - the survey ends on the spot"],
         ["next", "\u2192 When they press Next - they can still change their mind"]].map(function (w) {
          return '<option value="' + w[0] + '"' + (scrWhen() === w[0] ? " selected" : "") + ">" + esc(w[1]) + "</option>"; }).join("") +
        "</select></div>" +
        '<div class="st-field"><label>Reason for the data <span class="st-opt">optional - screen-out report</span></label>' +
        '<input id="f-scr-reason" value="' + esc(s.reason || "") + '" placeholder="e.g. Allocation out of range"></div></div>' +
        '<div class="st-field"><label>Text the respondent reads <span class="st-opt">blank = the study\'s closing text</span></label>' +
        '<div class="st-with-pipe"><textarea id="f-scr-msg" rows="2" placeholder="Thank you for your time\u2026">' +
        esc(s.message || "") + "</textarea></div></div>";
      html += '<div class="st-scr-plain" id="f-scr-plain">' + scrPlainHtml() + "</div>";
    }
    if (legacy.length) html += '<div class="st-note">The answer options <b>' +
      legacy.map(function (o) { return esc(optText(o)); }).join(", ") +
      '</b> are also marked <b>Screen out</b> in the Content &amp; Settings tab.</div>';
    html += scrTester();
    return html;
  }

  // ---- card: media -----------------------------------------------------------------------
  function mediaCard() {
    var m = ed.media || {};
    return '<div class="st-media-row">' +
      (m.src ? '<div class="st-media-cur">' + (m.kind === "video" ? '<video src="' + esc(m.src) + '" controls></video>' : '<img src="' + esc(m.src) + '" alt="">') +
        '<div><code>' + esc(m.src.split("/").pop()) + '</code><br><button class="st-btn sm danger" data-act="media-del">Remove</button></div></div>' : "") +
      '<div class="st-media-pick"><label class="st-upload big">\u2B06 ' + (m.src ? "Replace" : "Upload") + ' image, video or audio<input type="file" accept="image/*,video/*,audio/*" data-act="media-upload" hidden></label>' +
      '<div class="st-meta">png, jpg, gif, webp, svg, mp3, wav, m4a, ogg, mp4, webm, mov \u00B7 max 10 MB</div>' +
      '<div class="st-field"><label>\u2026or paste a link</label><input id="f-media-url" placeholder="https://\u2026/diagram.png or \u2026/clip.mp4" value="' + (m.external ? esc(m.src) : "") + '"></div></div></div>' +
      '<div class="st-grid3">' +
        '<div class="st-field"><label>Width</label><select id="f-media-width">' + [["", "Natural"], ["240px", "Small (240px)"], ["420px", "Medium (420px)"], ["100%", "Full width"]].map(function (w) {
          return '<option value="' + w[0] + '"' + ((m.width || "") === w[0] ? " selected" : "") + ">" + w[1] + "</option>"; }).join("") + "</select></div>" +
        '<div class="st-field"><label>Alignment</label><select id="f-media-align">' + [["", "Left"], ["center", "Centre"], ["right", "Right"]].map(function (w) {
          return '<option value="' + w[0] + '"' + ((m.align || "") === w[0] ? " selected" : "") + ">" + w[1] + "</option>"; }).join("") + "</select></div>" +
        '<div class="st-field"><label>Video</label><label class="st-switch"><input type="checkbox" id="f-media-autoplay"' + (m.autoplay ? " checked" : "") + "><i></i>Autoplay (muted)</label></div>" +
      "</div>" +
      '<div class="st-grid2"><div class="st-field"><label>Caption <span class="st-opt">optional</span></label><div class="st-with-pipe"><input id="f-media-cap" value="' + esc(m.caption || "") + '">' + pipeButton("f-media-cap", true) + "</div></div>" +
      '<div class="st-field"><label>Alt text <span class="st-opt">for screen readers</span></label><input id="f-media-alt" value="' + esc(m.alt || "") + '"></div></div>';
  }
  function advancedCard() {
    return '<div class="st-field"><textarea id="f-raw" class="st-raw">' + esc(JSON.stringify(ed, null, 2)) + "</textarea>" +
      '<div class="st-item-actions"><button class="st-btn sm" data-act="raw-apply">Load JSON into the question</button>' +
      '<span class="st-meta">Fields: stem_html, help_html, style, options[].exclusive/pin/other/terminate/image, randomize, show_if, screening, media, layout, hide_codes, hide_number.</span></div></div>';
  }

  // ---- live preview ------------------------------------------------------------------------
  var prevSeed = "preview-1";
  function renderPreview() {
    var host = document.getElementById("st-prev-body");
    if (!host || !window.BeaconSurveyPreview) return;
    var note = document.getElementById("st-prev-note");
    if (!ed) { host.innerHTML = ""; if (note) note.textContent = "Select a question to preview it."; return; }
    var useSample = document.getElementById("prev-sample");
    var answers = (!useSample || useSample.checked) ? Q.sampleAnswers(cur.cfg.questions, ed.id) : {};
    var res = window.BeaconSurveyPreview.render(host, ed, { answers: answers, questions: cur.cfg.questions, sections: cur.cfg.sections }, prevSeed);
    var visible = Q.showIf(ed, { answers: answers, questions: cur.cfg.questions });
    var bits = [];
    if (!visible) bits.push("<b>Hidden</b> for these sample answers - respondents matching them would skip it.");
    var scrNow = Q.screeningVerdict(cur.cfg.questions, scrTestAnswers(),
                   { upto: cur.cfg.questions.indexOf(ed) });
    if (scrNow) bits.push("<b>Screened out</b> by the rule on this question - " + esc(scrNow.reason) + ".");
    if (ed.randomize && ed.randomize !== "none") bits.push("Order shown is one random draw - press \u21BB for another.");
    if (res && res.unresolved && res.unresolved.length) bits.push("Unresolved piping: <code>" + res.unresolved.map(esc).join("</code> <code>") + "</code>.");
    if (tinfo(ed.type).noprev) bits.push("This type has no respondent renderer yet - the survey will skip it.");
    if (note) note.innerHTML = bits.join(" ") || "Interactive - try answering it. Nothing here is saved.";
    var sr = document.getElementById("sif-result"); if (sr) sr.textContent = visible ? "SHOWN" : "HIDDEN";
  }

  // ---- read form -> question -----------------------------------------------------------------
  function val(id) { var n = document.getElementById(id); return n ? n.value : undefined; }
  function num(id) { var x = val(id); return x === undefined || x === "" ? undefined : Number(x); }
  function chk(id) { var n = document.getElementById(id); return n ? n.checked : undefined; }
  function setOrDel(obj, key, v) { if (v === undefined || v === "" || v === false || v === null) delete obj[key]; else obj[key] = v; }

  function syncFromForm() {
    if (!ed) return;
    var t = ed.type;
    // an open "</>" source view is authoritative for its editor
    $$("#st-editor .st-src").forEach(function (ta) {
      var host = document.getElementById(ta.getAttribute("data-for"));
      if (host) host.innerHTML = Q.sanitize(ta.value);
    });
    if (val("f-section") !== undefined) ed.section = val("f-section");
    if (ed.type === "choice_task") syncConjointForm();
    if (val("f-title") !== undefined) setOrDel(ed, "title", String(val("f-title")).trim());
    var rich = document.getElementById("f-stem-rich");
    if (rich) { ed.stem_html = unchip(Q.sanitize(rich.innerHTML)); ed.stem = Q.stripTags(ed.stem_html) || ""; }
    var hr = document.getElementById("f-help-rich");
    if (hr) { var hh = unchip(Q.sanitize(hr.innerHTML)); if (Q.stripTags(hh)) { ed.help_html = hh; ed.help = Q.stripTags(hh); } else { delete ed.help_html; delete ed.help; } }
    if (chk("f-required") !== undefined) ed.required = chk("f-required") !== false;
    // lists
    $$("#st-editor [data-it]").forEach(function (n) {
      var list = ed[LIST_KEY[n.getAttribute("data-it")]]; var it = list && list[Number(n.getAttribute("data-i"))]; if (!it) return;
      var k = n.getAttribute("data-k");
      if (n.type === "checkbox") setOrDel(it, k, n.checked);
      else if (k === "code") it.code = n.getAttribute("data-it") === "opt" && n.value.trim() !== "" && !isNaN(Number(n.value)) ? Number(n.value) : n.value.trim();
      else it[k] = n.value;
    });
    if (t === "multi_select") setOrDel(ed, "max_select", num("f-maxselect"));
    if (document.getElementById("f-hidecodes")) setOrDel(ed, "hide_codes", chk("f-hidecodes"));
    if (document.getElementById("f-hidenum")) setOrDel(ed, "hide_number", chk("f-hidenum"));
    var rz = $("#st-editor input[name=f-rz]:checked");
    if (rz) setOrDel(ed, "randomize", rz.value === "none" ? "" : rz.value);
    if (val("f-font") !== undefined) {
      ed.style = ed.style || {};
      setOrDel(ed.style, "font", val("f-font")); setOrDel(ed.style, "size", val("f-size")); setOrDel(ed.style, "align", val("f-align"));
      if (!Object.keys(ed.style).length) delete ed.style;
    }
    if (t === "rating_grid" || t === "rating_scale" || t === "semantic_diff" || t === "nps" || t === "concept_test") {
      if (val("f-smin") !== undefined) {
        ed.scale = ed.scale || {}; ed.scale.min = num("f-smin") != null ? num("f-smin") : 1; ed.scale.max = num("f-smax") != null ? num("f-smax") : 7;
        setOrDel(ed.scale, "min_label", val("f-sminl")); setOrDel(ed.scale, "max_label", val("f-smaxl"));
        if (t === "rating_scale") setOrDel(ed.scale, "mid_label", val("f-smidl"));
      }
    }
    // the scale points follow the From / To boxes: the list is rebuilt from the new range
    if ($$("#st-editor [data-pt]").length) {
      var spts = scalePoints(ed);
      $$("#st-editor [data-pt]").forEach(function (n) {
        var pi2 = Number(n.getAttribute("data-i"));
        if (!spts[pi2]) return;
        if (n.getAttribute("data-pt") === "label") spts[pi2].label = n.value; else spts[pi2].fmt = n.value;
      });
      if (spts.length >= 2) writeScalePoints(spts);
    }
    if (document.getElementById("f-gselect")) {         // single or several picks per row
      ed.select = val("f-gselect") === "multi" ? "multi" : "single";
    }
    if (document.getElementById("f-gtitle")) {          // title, row name, column name
      var gm = ed.grid = ed.grid || {};
      setOrDel(gm, "title", val("f-gtitle"));
      setOrDel(gm, "row_label", val("f-rowlabel"));
      setOrDel(gm, "col_label", val("f-collabel"));
      if (!Object.keys(gm).length) delete ed.grid;
    }
    if (document.getElementById("f-na-rows")) {         // the exclusive N/A
      var nm = {};
      if (chk("f-na-rows")) nm.rows = true;
      if (chk("f-na-col")) nm.col = true;
      setOrDel(nm, "label", val("f-na-label"));
      if (Object.keys(nm).length) ed.na = nm; else delete ed.na;
    }
    if (document.getElementById("f-cmt-mode")) {        // comments: question-wide and per row
      var cm = {};
      var cmode = val("f-cmt-mode");
      if (cmode && cmode !== "none") cm.mode = cmode;
      setOrDel(cm, "label", val("f-cmt-label"));
      var creq = ($("#f-cmt-rows") ? [...$("#f-cmt-rows").selectedOptions].map(function (o) { return o.value; }) : []);
      if (creq.length) cm.require_when = creq;
      if (Object.keys(cm).length) ed.comments = cm; else delete ed.comments;
    }
    var rzR = $("#f-rz-rows"), rzC = $("#f-rz-cols");
    if (rzR || rzC) {                                   // rows and columns, each with its own order
      var rzo = {};
      if (rzR && rzR.value !== "none") rzo.rows = rzR.value;
      if (rzC && rzC.value !== "none") rzo.cols = rzC.value;
      if (ed.randomize && typeof ed.randomize === "object") {
        Object.keys(ed.randomize).forEach(function (kk) { if (kk !== "rows" && kk !== "cols") rzo[kk] = ed.randomize[kk]; });
      }
      setOrDel(ed, "randomize", Object.keys(rzo).length ? rzo : "");
    }
    if ((t === "numeric" || t === "slider") && val("f-min") !== undefined) { ed.min = num("f-min"); ed.max = num("f-max"); setOrDel(ed, "step", num("f-step")); setOrDel(ed, "prefix", val("f-prefix")); setOrDel(ed, "suffix", val("f-suffix")); }
    if (t === "open_text" && val("f-minwords") !== undefined) { setOrDel(ed, "min_words", num("f-minwords")); setOrDel(ed, "placeholder", val("f-placeholder")); }
    if (t === "open_text" && val("f-aiaction") !== undefined) {
      var qaa = val("f-aiaction");                    // "" = follow the study setting
      setOrDel(ed, "ai_action", qaa);
      if (qaa === "off") ed.ai_check = false; else delete ed.ai_check;
    }
    if (t === "concept_test" && val("f-concept") !== undefined) setOrDel(ed, "concept", val("f-concept"));
    if (t === "numeric_matrix" || t === "delta") {
      if (val("f-nmin") !== undefined) { setOrDel(ed, "min", num("f-nmin")); setOrDel(ed, "max", num("f-nmax")); setOrDel(ed, "step", num("f-nstep")); }
    }
    if (t === "delta" && val("f-beforel") !== undefined) { setOrDel(ed, "before_label", val("f-beforel")); setOrDel(ed, "after_label", val("f-afterl")); }
    if (t === "date" && val("f-datemin") !== undefined) { setOrDel(ed, "min", val("f-datemin")); setOrDel(ed, "max", val("f-datemax")); }
    if (t === "loop" && val("f-child") !== undefined) {
      setOrDel(ed, "child", val("f-child") === "open_text" ? "" : val("f-child"));
      setOrDel(ed, "prompt_template", val("f-ptmpl"));
      setOrDel(ed, "text_rows", num("f-textrows"));
      setOrDel(ed, "placeholder", val("f-placeholder"));
    }
    var bodyRich = document.getElementById("f-body-rich");
    if (bodyRich) {
      var bh = unchip(Q.sanitize(bodyRich.innerHTML));
      if (Q.stripTags(bh)) { ed.body_html = bh; ed.body = Q.stripTags(bh); } else { delete ed.body_html; delete ed.body; }
    }
    if (t === "rank" && val("f-rankcount") !== undefined) setOrDel(ed, "rank_count", num("f-rankcount"));
    if (t === "maxdiff" && val("f-rounds") !== undefined) ed.rounds = String(val("f-rounds")).split("\n").filter(function (l) { return l.trim(); }).map(function (l) { return { items: l.split(",").map(function (x) { return x.trim(); }).filter(Boolean) }; });
    if (t === "choice_task" && val("f-vignette") !== undefined) ed.vignette = val("f-vignette");
    // logic
    if (document.getElementById("f-rules")) {
      var rules = [];
        $$("#f-rules .st-rule").forEach(function (row) {
        var r = {};
        $$("[data-rule]", row).forEach(function (n) { r[n.getAttribute("data-rule")] = n.value; });
        if (r.cellnum !== undefined) { r.value = (r.value || "") + "=" + r.cellnum; delete r.cellnum; }
        if (r.q && r.op) rules.push(r);
      });
      var sifNode = document.getElementById("f-sif-on");
      if (rules.length) {
        ed.show_if = { match: val("f-sif-match") || (ed.show_if && ed.show_if.match) || "all", rules: rules };
        if (chk("f-sif-negate")) ed.show_if.negate = true;
        if (sifNode) ed.show_if.off = !sifNode.checked;
      }
      // switched off with no conditions yet: keep that choice, or the switch would spring back on
      else if (sifNode && !sifNode.checked) ed.show_if = { match: (ed.show_if && ed.show_if.match) || "all", rules: [], off: true };
      else delete ed.show_if;
    }
    syncScreening();
    // media
    if (document.getElementById("f-media-url")) {
      var m = ed.media || {};
      var url = (val("f-media-url") || "").trim();
      if (url && /^https?:\/\//i.test(url)) { m.src = url; m.external = true; m.kind = /\.(mp4|webm|mov)(\?|$)/i.test(url) ? "video" : "image"; }
      else if (m.external && !url) { m = {}; }
      setOrDel(m, "width", val("f-media-width")); setOrDel(m, "align", val("f-media-align"));
      setOrDel(m, "autoplay", chk("f-media-autoplay")); setOrDel(m, "caption", val("f-media-cap")); setOrDel(m, "alt", val("f-media-alt"));
      if (m.src) ed.media = m; else delete ed.media;
    }
  }
  // ---- screening: form -> question -------------------------------------------------------
  // Runs on every edit while the Screening tab is open.  When the tab is closed the
  // controls are not in the DOM and whatever is stored on the question is left alone.
  function fieldIn(row, name) { var n = $('[data-sf="' + name + '"]', row); return n ? n.value : ""; }
  function sfVal(name) { var n = $('[data-sf="' + name + '"]'); return n ? n.value : ""; }
  function readScrRules() {
    var out = [];
    $$("#f-scr-rules .st-rule").forEach(function (row) {
      var qid = fieldIn(row, "q"), op = fieldIn(row, "op");
      if (!qid || !op) return;
      var kind = Q.valueKind(op), value = "";
      if (kind === "codes") value = fieldIn(row, "value");
      else if (kind === "between") value = fieldIn(row, "valueLo") + "-" + fieldIn(row, "valueHi");
      else if (kind === "rowvalue" || kind === "ranktop") value = fieldIn(row, "row") + "=" + fieldIn(row, "value");
      else if (kind === "rowcode") value = fieldIn(row, "row") + "=" + fieldIn(row, "col");
      else if (kind === "cellnum") value = fieldIn(row, "row") + "=" + fieldIn(row, "col") + "=" + fieldIn(row, "value");
      else if (kind === "cellrange") value = fieldIn(row, "row") + "=" + fieldIn(row, "col") + "=" +
        fieldIn(row, "valueLo") + "-" + fieldIn(row, "valueHi");
      else if (kind === "rowsum") {
        var held = String(fieldIn(row, "value") || "");
        value = (held.split("=")[0] || "") + "=" + fieldIn(row, "valueSum");
      }
      else if (kind === "count" || kind === "number" || kind === "text") value = fieldIn(row, "value");
      var r = { q: qid, op: op };
      if (kind !== "none") r.value = kind === "count" || kind === "number" ? Number(value || 0) : value;
      out.push(r);
    });
    return out;
  }
  // The starting point when screening is switched on: for a row-based question an
  // Individual screener over its first answer, otherwise one plain condition.
  function scrSeedBlock() {
    var s = scrEnsure(), first = rowItemsOf(ed)[0];
    if (scrIsStructured() && first) {
      s.type = "individual";
      s.rows = [String(first.code)];
      s.min = {}; s.max = {};
      s.min[first.code] = ed.scale ? ed.scale.min : 0;
      s.max[first.code] = ed.scale ? ed.scale.max : 100;
      s.outside = s.mode !== "qualify";
      s.rules = [];
    } else {
      delete s.type; delete s.rows; delete s.min; delete s.max; delete s.sum; delete s.outside;
      s.rules = [scrSeed(ed)];
    }
    s.when = scrWhenDefault(Q.screening(ed).length ? Q.screening(ed)[0].rules : s.rules);
    return s;
  }
  function syncScreening() {
    if (!ed) return;
    var onNode = document.getElementById("f-scr-on");
    if (!onNode) return;                                  // the Screening tab is not open
    var s = scrOf();
    if (!onNode.checked) {                                // off: keep everything, fire nothing
      var sHold = scrEnsure(); sHold.enabled = false;
      return;
    }
    if (s) delete s.enabled;
    s = scrEnsure();
    var dirNode = $('input[name="f-scr-dir"]:checked');
    if (!dirNode) return;                 // switch just flicked on: the controls are not drawn yet
    s.mode = dirNode.value === "qualify" ? "qualify" : "screen_out";
    if (scrIsStructured()) {
      var tNode = $('input[name="f-scr-type"]:checked');
      s.type = tNode && tNode.value === "sum" ? "sum" : "individual";
      var outNode = document.getElementById("f-scr-outside");
      if (outNode) s.outside = outNode.value !== "inside";
      if (s.type === "sum") {
        var opNode = document.getElementById("f-scr-sum-op");
        if (opNode) {                                // the sum row is on screen: read it
          var op = opNode.value;
          if (!SUM_CMP.some(function (o) { return o[0] === op; })) op = "eq";
          var loBox = $('[data-sf="f-scr-sum-lo"]'), hiBox = $('[data-sf="f-scr-sum-hi"]');
          var valBox = $('[data-sf="f-scr-sum-val"]');
          if (op === "between") {
            if (loBox && hiBox) s.sum = { op: op, value: Number(loBox.value || 0) + "-" + Number(hiBox.value || 0) };
            else if (String(s.sum && s.sum.value).indexOf("-") < 0) {   // one number -> a range
              var one = Number(s.sum && s.sum.value || 0);
              s.sum = { op: op, value: "0-" + (one || 100) };      // "up to what it was"
            } else s.sum.op = op;
          } else {
            if (valBox) s.sum = { op: op, value: Number(valBox.value || 0) };
            else if (String(s.sum && s.sum.value).indexOf("-") >= 0) {  // a range -> its top
              s.sum = { op: op, value: Number(String(s.sum.value).split("-")[1] || 0) };
            } else s.sum.op = op;
          }
        } else if (!s.sum) {                         // just switched to Sum: a sensible start
          s.sum = { op: "eq", value: ed.type === "sum_to_100" ? 100 : 0 };
        }
      } else {
        var mins = {}, maxs = {}, rows = [];
        $$(".st-scr-minmax").forEach(function (el) {
          var sel = $("[data-scr-at]", el), lo = $("[data-scr-min]", el), hi = $("[data-scr-max]", el);
          var code = sel ? String(sel.value || "") : "";
          if (!code || rows.indexOf(code) >= 0) return;          // no duplicates
          rows.push(code);
          mins[code] = Number(lo && lo.value || 0);
          maxs[code] = Number(hi && hi.value || 0);
        });
        s.rows = rows; s.min = mins; s.max = maxs;
      }
    } else {
      delete s.type; delete s.rows; delete s.min; delete s.max; delete s.sum; delete s.outside;
    }
    s.rules = readScrRules();
    setOrDel(s, "match", val("f-scr-match"));
    setOrDel(s, "when", val("f-scr-when"));
    setOrDel(s, "reason", (val("f-scr-reason") || "").trim());
    setOrDel(s, "message", (val("f-scr-msg") || "").trim());
  }

  // form -> question -> autosave + preview + outline row
  function changed() { syncFromForm(); markChanged(); renderPreview(); refreshOutlineRow(); refreshQuestionCheck(); }

  function applyId(input) {
    var id = input.value.trim();
    if (!id) { input.value = ed.id; return; }
    if (cur.cfg.questions.some(function (q) { return q !== ed && q.id === id; })) { toast("Another question already uses id " + id); input.value = ed.id; input.classList.add("bad"); setTimeout(function () { input.classList.remove("bad"); }, 1200); return; }
    if (id !== ed.id) { ed.id = id; markChanged(); refreshOutlineRow(); renderPreview(); }
  }
  function convertType(newType) {
    var old = ed, fresh = qTemplate(newType, old.id, old.section);
    ["stem", "stem_html", "help", "help_html", "required", "show_if", "screening", "media", "style", "hide_number", "randomize", "concept", "body", "body_html", "vignette"].forEach(function (k) { if (old[k] !== undefined) fresh[k] = old[k]; });
    if (hasOptions(newType) && old.options) fresh.options = old.options;
    if (hasRows(newType) && old.rows) fresh.rows = old.rows;
    if (old.items && fresh.items) fresh.items = old.items;
    if (old.cols && fresh.cols) fresh.cols = old.cols;
    if (old.scale && fresh.scale) fresh.scale = Object.assign(fresh.scale, old.scale);
    cur.cfg.questions[sel] = fresh; markChanged(); renderOutline(); renderEditorPane();
    toast("Changed to " + tinfo(newType).name);
  }

  function uploadMedia(file, cb) {
    var fd = new FormData(); fd.append("file", file, file.name);
    toast("Uploading " + file.name + "\u2026");
    fetch("/api/studio/media?study=" + encodeURIComponent(cur.slug), { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (r) { if (r.error) { toast("Upload failed: " + r.error); return; } cb(r); })
      .catch(function () { toast("Upload failed"); });
  }

  // quick "test view" of a question straight from the outline / preview pane
  function openTestView(qi) {
    var q = cur.cfg.questions[qi];
    var ov = document.getElementById("qtest");
    if (!ov || !q) return;
    ov.hidden = false;
    var host = document.getElementById("qtest-body");
    document.getElementById("qtest-title").textContent = q.id + " \u00B7 " + tinfo(q.type).name;
    var answers = Q.sampleAnswers(cur.cfg.questions, q.id);
    window.BeaconSurveyPreview.render(host, q, { answers: answers, questions: cur.cfg.questions, sections: cur.cfg.sections }, "test-" + Date.now());
    var vis = Q.showIf(q, { answers: answers, questions: cur.cfg.questions });
    document.getElementById("qtest-note").textContent = vis ? "Interactive test - answers are not saved." : "Note: with sample answers this question would be hidden by its conditions.";
  }

  function openQuestionAgent() {
    syncFromForm(); var issues = questionIssues().filter(function(x){return x.level !== 'ok';});
    openModal('<div class="st-modal-head"><strong>✦ Question agent · ' + esc(ed.id) + '</strong><span class="st-meta">Review, explain, then apply only with permission</span><button class="ex-close" data-act="modal-close">&times;</button></div><div class="st-agent-chat"><div class="st-agent-msg"><b>' + (issues.length ? 'I found ' + issues.length + ' point' + (issues.length === 1 ? '' : 's') + ' to review.' : 'This question looks structurally sound.') + '</b><p>' + esc(issues.map(function(x){return x.text;}).join(' ' ) || 'I can still help improve wording, answer options, validation or logic.') + '</p></div><div class="st-agent-chips"><button data-act="agent-action" data-agent="wording">Improve wording</button><button data-act="agent-action" data-agent="options">Review answer options</button><button data-act="logic-guide">Build show-if logic</button></div><textarea placeholder="Describe what this question needs to achieve…"></textarea><div class="st-modal-actions"><button class="st-btn" data-act="modal-close">Keep as is</button><button class="st-btn on" data-act="agent-action" data-agent="wording">Prepare suggestion</button></div></div>', 'st-agent-modal');
  }
  function openLogicGuide() {
    syncFromForm(); var prior = cur.cfg.questions.slice(0,sel).filter(function(q){return q.type !== 'choice_task';});
    openModal('<div class="st-modal-head"><strong>Show-if logic guide</strong><span class="st-meta">Who should see ' + esc(ed.id) + '?</span><button class="ex-close" data-act="modal-close">&times;</button></div><div class="st-new-form"><div class="st-agent-note">Choose an earlier question and condition. I’ll create the rule after you approve it.</div><label class="st-field"><span>Based on</span><select id="lg-q">' + prior.map(function(q){return '<option value="' + esc(q.id) + '">' + esc(q.id + ' · ' + q.stem.slice(0,70)) + '</option>';}).join('') + '</select></label><label class="st-field"><span>Respondent condition</span><select id="lg-op"><option value="selected">selected an answer</option><option value="not_selected">did not select an answer</option><option value="answered">answered the question</option><option value="not_answered">did not answer</option></select></label><label class="st-field"><span>Answer code (for selected/not selected)</span><input id="lg-value" placeholder="e.g. 1"></label><div class="st-modal-actions"><button class="st-btn" data-act="modal-close">Cancel</button><button class="st-btn on" data-act="logic-apply"' + (prior.length ? '' : ' disabled') + '>Review and apply rule</button></div></div>', 'st-agent-modal');
  }

  // ------------------------------------------------------------ rich-text toolbar actions
  function tbAction(a, target) {
    var host = document.getElementById(target);
    var focus = function () { if (host) host.focus(); };
    var run = function (cmd, val) {
      focus();
      document.execCommand("styleWithCSS", false, true);
      document.execCommand(cmd, false, val === undefined ? null : val);
      changed();
    };
    if (a === "more") { var tb = $(".st-toolbar[data-for='" + target + "']") || $(".st-toolbar");
      if (tb) tb.classList.toggle("more-open"); return; }
    if (a === "link") {
      focus();
      var url = window.prompt("Link address", "https://");
      if (url) run("createLink", url);
      return;
    }
    if (a === "table") {
      run("insertHTML", '<table class="st-tbl"><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr>' +
        "<tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>");
      return;
    }
    if (a === "image") { var fi = $("[data-act=media-upload]"); if (fi) fi.click(); return; }
    if (a === "fullscreen") {
      if (!host) return;
      host.classList.toggle("fs");
      if (host.classList.contains("fs")) focus();
      return;
    }
    if (a === "source") {
      if (!host) return;
      var wrap = host.parentElement || document.getElementById("st-editor");
      var ta = wrap.querySelector(".st-src");
      if (!ta) {
        ta = document.createElement("textarea");
        ta.className = "st-src";
        ta.value = host.innerHTML;
        ta.setAttribute("data-for", target);
        host.hidden = true;
        wrap.insertBefore(ta, host.nextSibling);
        ta.focus();
      } else {
        host.innerHTML = Q.sanitize(ta.value);
        ta.parentNode.removeChild(ta);
        host.hidden = false;
        focus();
        changed();
      }
      return;
    }
  }

  // ------------------------------------------------------------ editor events (delegated on root)
  function inEditor(e) { return !!e.target.closest("#st-editor"); }
  root.addEventListener("click", function (e) {
    if (!inEditor(e) || !ed) return;
    var cmd = e.target.closest("button[data-cmd]");
    if (cmd) {
      e.preventDefault();
      var target = document.getElementById(cmd.getAttribute("data-target"));
      target.focus();
      document.execCommand("styleWithCSS", false, true);
      document.execCommand(cmd.getAttribute("data-cmd"), false, cmd.getAttribute("data-val") || null);
      changed(); return;
    }
    var tba = e.target.closest("button[data-tb-act]");
    if (tba) {
      e.preventDefault();
      tbAction(tba.getAttribute("data-tb-act"), tba.getAttribute("data-target"));
      return;
    }
    var pb = e.target.closest("[data-pipe-for]");
    if (pb) { e.preventDefault(); openPipePicker(document.getElementById(pb.getAttribute("data-pipe-for"))); return; }
    var pi = e.target.closest(".st-pipe-item");
    if (pi) { insertPipe(pi.getAttribute("data-token")); return; }
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act"), i = Number(b.getAttribute("data-i")), kind = b.getAttribute("data-kind"), ri = Number(b.getAttribute("data-ri"));
    if (act === "pipe-close") { closePipePicker(); return; }
    if (act === "q-fix") { syncFromForm(); applyQuestionFix(b.getAttribute("data-fix")); return; }
    if (act === "q-ai-help") { openQuestionAgent(); return; }
    if (act === "logic-guide") { openLogicGuide(); return; }
    if (act === "jump") { e.preventDefault(); var c = document.getElementById("card-" + b.getAttribute("data-card")); if (c) { c.open = true; c.scrollIntoView({ behavior: "smooth", block: "start" }); } return; }
    if (act === "set-layout") { syncFromForm(); var v = b.getAttribute("data-v"); setOrDel(ed, "layout", v === (ed.type === "multi_select" ? "grid" : "list") ? "" : v); $$("#f-layout-seg .st-seg-btn").forEach(function (x) { x.classList.toggle("on", x === b); }); markChanged(); renderPreview(); return; }
    if (act === "it-add" || act === "opt-add-none" || act === "opt-add-na" || act === "opt-add-other") {
      syncFromForm();
      var k2 = act === "it-add" ? kind : "opt", key = LIST_KEY[k2], list = ed[key] = ed[key] || [];
      var it;
      if (k2 === "opt") {
        var codes = list.map(function (o) { return Number(o.code); }).filter(function (n) { return !isNaN(n); });
        it = { code: (codes.length ? Math.max.apply(null, codes) : 0) + 1, label: "New option" };
        if (act === "opt-add-none") { it.label = "None of these"; it.exclusive = true; it.pin = true; it.code = 99; }
        if (act === "opt-add-na") { it.label = "Not applicable"; it.exclusive = true; it.pin = true; it.code = 98; }
        if (act === "opt-add-other") { it.label = "Other (please specify)"; it.other = true; it.pin = true; it.code = 97; }
      } else {
        var n = list.length, code = k2 === "col" ? "c" + (n + 1) : String.fromCharCode(97 + (n % 26)) + (n >= 26 ? Math.floor(n / 26) : "");
        while (list.some(function (r) { return String(r.code) === code; })) code += "x";
        it = { code: code, label: k2 === "col" ? "New column" : "New row" };
        if (ed.type === "semantic_diff") { it.left = ""; it.right = ""; }
      }
      list.push(it); rerenderCard("answers"); markChanged(); renderPreview(); refreshOutlineRow();
      var last = $('#st-editor .st-items[data-kind="' + k2 + '"] .st-item:last-child input[data-k=label]'); if (last) { last.focus(); last.select(); }
      return;
    }
    if (act === "it-del") { syncFromForm(); ed[LIST_KEY[kind]].splice(i, 1); rerenderCard("answers"); changed(); return; }
    if (act === "it-up" || act === "it-down") {
      syncFromForm(); moveItem(kind, i, act === "it-up" ? i - 1 : i + 1); return;
    }
    if (act === "it-img-del") { syncFromForm(); delete ed.options[i].image; rerenderCard("answers"); changed(); return; }
    if (act === "it-dup") {                      // copy a row / column / item, straight below it
      syncFromForm();
      var dlist = ed[LIST_KEY[kind]]; if (!dlist || !dlist[i]) return;
      var copy = JSON.parse(JSON.stringify(dlist[i]));
      copy.code = nextItemCode(dlist, String(copy.code || ""));
      copy.label = String(copy.label || "") + " (copy)";
      dlist.splice(i + 1, 0, copy);
      rerenderCard("answers"); changed(); return;
    }
    if (act === "it-media-del") {                // drop the image / video / audio on a row or column
      syncFromForm();
      var mdel = (ed[LIST_KEY[b.getAttribute("data-kind")]] || [])[Number(b.getAttribute("data-i"))];
      if (mdel) { delete mdel.media; delete mdel.image; }
      rerenderCard("answers"); changed(); return;
    }
    if (act === "pt-add") {                      // one more column of the scale
      syncFromForm();
      var pa = scalePoints(ed); pa.push({ v: scaleRange(ed)[1] + 1, label: "" });
      writeScalePoints(pa); rerenderCard("answers"); changed(); return;
    }
    if (act === "pt-del") {
      syncFromForm();
      var pd = scalePoints(ed); if (pd.length <= 2) return;
      pd.splice(i, 1); writeScalePoints(pd); rerenderCard("answers"); changed(); return;
    }
    if (act === "pt-dup") {
      syncFromForm();
      var pu = scalePoints(ed), pc = JSON.parse(JSON.stringify(pu[i] || {}));
      pu.splice(i + 1, 0, pc); writeScalePoints(pu); rerenderCard("answers"); changed(); return;
    }
    if (act === "pt-up" || act === "pt-down") {   // the label moves to the neighbouring point
      syncFromForm();
      var pm = scalePoints(ed), pj = act === "pt-up" ? i - 1 : i + 1;
      if (i < 0 || pj < 0 || pj >= pm.length) return;
      var swapL = pm[i].label, swapF = pm[i].fmt, swapM = pm[i].media;
      pm[i].label = pm[pj].label; pm[i].fmt = pm[pj].fmt; pm[i].media = pm[pj].media;
      pm[pj].label = swapL; pm[pj].fmt = swapF; pm[pj].media = swapM;
      writeScalePoints(pm); rerenderCard("answers"); changed(); return;
    }
    if (act === "pt-paste") {
      syncFromForm();
      askText("Paste the columns", "One scale point per line. The first line is the lowest, the last is the highest.",
        scalePoints(ed).map(function (x) { return x.label || ""; }).join("\n"),
        function (txt) {
          var lines = String(txt || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
          if (lines.length < 2) { toast("A scale needs at least two points"); return; }
          writeScalePoints(lines.map(function (l) { return { label: l }; }));
          rerenderCard("answers"); changed();
        });
      return;
    }
    if (act === "mtx-swap") {                    // rows <-> columns
      syncFromForm();
      if (swapAxes()) { rerenderCard("answers"); changed(); toast("Rows and columns swapped over"); }
      else toast("Add a few columns first - then the two axes can be swapped");
      return;
    }
    if (act === "it-paste") {
      syncFromForm();
      var key3 = LIST_KEY[kind];
      askText("Paste a list", "One " + (kind === "opt" ? "option" : kind === "col" ? "column" : "row") + " per line. Optionally code | label" + (ed.type === "semantic_diff" && kind === "row" ? " | left | right" : "") + ".",
        (ed[key3] || []).map(function (o) { return o.code + " | " + o.label + (o.left !== undefined ? " | " + (o.left || "") + " | " + (o.right || "") : ""); }).join("\n"),
        function (txt) {
          var items = String(txt || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean).map(function (l, n) {
            var p = l.split("|").map(function (x) { return x.trim(); });
            var o = p.length > 1 ? { code: p[0] || String(n + 1), label: p[1] } : { code: kind === "opt" ? n + 1 : String.fromCharCode(97 + (n % 26)), label: p[0] };
            if (kind === "opt" && !isNaN(Number(o.code))) o.code = Number(o.code);
            if (ed.type === "semantic_diff" && kind === "row") { o.left = p[2] || ""; o.right = p[3] || ""; }
            return o;
          });
          if (items.length) { ed[key3] = items; rerenderCard("answers"); changed(); }
        });
      return;
    }
    if (act === "rule-add") {
      syncFromForm();
      var others = cur.cfg.questions.filter(function (q) { return q.id !== ed.id && q.type !== "choice_task"; });
      var q0 = others[0]; if (!q0) return;
      var firstRule = !((ed.show_if && ed.show_if.rules) || []).length;
      ed.show_if = ed.show_if || { match: "all", rules: [] };
      if (firstRule) delete ed.show_if.off;          // the first condition switches Show IF on: nothing is parked yet
      ed.show_if.rules.push({ q: q0.id, op: q0.options ? "selected" : "answered", value: q0.options ? q0.options[0].code : "" });
      rerenderCard("logic"); changed(); return;
    }
    if (act === "rule-del") { syncFromForm(); ed.show_if.rules.splice(ri, 1); if (!ed.show_if.rules.length && ed.show_if.off !== true) delete ed.show_if; rerenderCard("logic"); changed(); return; }

    // ---- screening builder -------------------------------------------------------------
    if (act === "scr-add") {
      syncFromForm();
      var s0 = scrEnsure();
      if (!s0.rules.length) { s0.mode = "screen_out"; s0.match = "all"; }
      s0.rules.push(scrSeed(ed));
      s0.when = scrWhenDefault(s0.rules);
      rerenderCard("screening"); changed(); return;
    }
    if (act === "scr-del") {
      syncFromForm();
      var s1 = scrOf(); if (!s1) return;
      s1.rules.splice(ri, 1);
      if (!s1.rules.length) delete ed.screening;
      rerenderCard("screening"); changed(); return;
    }
    if (act === "scr-code") {                      // add / remove an option from a rule's group
      syncFromForm();
      var s2 = scrOf(), code = String(b.getAttribute("data-code"));
      if (s2 && s2.rules[ri]) {
        var list = Q.codeList(s2.rules[ri].value), at = list.indexOf(code);
        if (at >= 0) list.splice(at, 1); else list.push(code);
        s2.rules[ri].value = list.join(",");
      }
      rerenderCard("screening"); changed(); return;
    }
    if (act === "scr-del-row") {                  // take one answer out of the screener
      syncFromForm();
      var sdr = scrEnsure(), gone = Number(b.getAttribute("data-i"));
      var left = scrRows(); left.splice(gone, 1);
      sdr.rows = left;
      rerenderCard("screening"); changed(); return;
    }
    if (act === "scr-pick-row") {                 // which answers the screener looks at
      syncFromForm();
      var sp = scrEnsure(), code4 = String(b.getAttribute("data-code"));
      var picked4 = scrRows(), at4 = picked4.indexOf(code4);
      if (at4 >= 0) picked4.splice(at4, 1); else picked4.push(code4);
      sp.rows = picked4;
      sp.min = sp.min || {}; sp.max = sp.max || {};
      if (sp.min[code4] === undefined) {
        sp.min[code4] = ed.scale ? ed.scale.min : 0;
        sp.max[code4] = ed.scale ? ed.scale.max : 100;
      }
      if (!(sp.rows || []).length && !(sp.rules || []).length) sp.type = scrType();
      rerenderCard("screening"); changed(); return;
    }
    if (act === "scr-row-code") {                 // add / remove a row from a group share
      syncFromForm();
      var s5 = scrOf(), code5 = String(b.getAttribute("data-code"));
      if (s5 && s5.rules[ri]) {
        var bits5 = String(s5.rules[ri].value || "").split("=");
        var rows5 = Q.codeList(bits5[0]), at5 = rows5.indexOf(code5);
        if (at5 >= 0) rows5.splice(at5, 1); else rows5.push(code5);
        s5.rules[ri].value = rows5.join(",") + "=" + (bits5[1] || "");
      }
      rerenderCard("screening"); changed(); return;
    }
    if (act === "scr-clear-opts") {
      syncFromForm();
      (ed.options || []).forEach(function (o) { delete o.terminate; });
      delete ed.terminate_if_lt; delete ed.terminate_message;
      rerenderCard("screening"); changed();
      toast("Screening cleared from the answer options"); return;
    }
    if (act === "scr-pick") {                      // tester: pick an answer by hand
      syncFromForm();
      scrPick(ed, b.getAttribute("data-code"));
      rerenderCard("screening"); changed(); return;
    }
    if (act === "scr-row") {
      syncFromForm();
      var ta = scrTest[ed.id] || (scrTest[ed.id] = {});
      ta[b.getAttribute("data-row")] = Number(b.getAttribute("data-v"));
      rerenderCard("screening"); changed(); return;
    }
    if (act === "scr-cell") {
      syncFromForm();
      var tg = scrTest[ed.id] || (scrTest[ed.id] = {});
      var rcode = b.getAttribute("data-row"), ccode = b.getAttribute("data-col");
      if (ed.select === "multi") {
        var have = Array.isArray(tg[rcode]) ? tg[rcode].slice() : [];
        var at = have.map(String).indexOf(String(ccode));
        if (at >= 0) have.splice(at, 1); else have.push(ccode);
        tg[rcode] = have;
      } else {
        tg[rcode] = String(tg[rcode]) === String(ccode) ? undefined : ccode;
        if (tg[rcode] === undefined) delete tg[rcode];
      }
      rerenderCard("screening"); changed(); return;
    }
    if (act === "scr-test-clear") { syncFromForm(); delete scrTest[ed.id]; rerenderCard("screening"); changed(); return; }

    if (act === "media-del") {
      syncFromForm();
      var m = ed.media;
      if (m && !m.external && m.src) api("/api/studio/media/delete", { study: cur.slug, file: m.src.split("/").pop() });
      delete ed.media; rerenderCard("media"); changed(); return;
    }
    if (act === "raw-apply") {
      try {
        var parsed = JSON.parse(val("f-raw"));
        if (!parsed || !parsed.id || !parsed.type) { toast("JSON needs at least id and type"); return; }
        if (cur.cfg.questions.some(function (q) { return q !== ed && q.id === parsed.id; })) { toast("Another question already uses id " + parsed.id); return; }
        cur.cfg.questions[sel] = parsed; markChanged(); renderOutline(); renderEditorPane(); toast("Loaded");
      } catch (err) { toast("JSON did not parse: " + err.message); }
    }
  });
  // ---- reorder by dragging the grip ------------------------------------------------------
  // The grip is the only draggable part of a row, so text selection inside the inputs still works.
  var dragKind = null, dragFrom = -1;
  function itemRows(wrap) { return Array.prototype.slice.call(wrap.querySelectorAll(".st-item:not(.st-item-head)")); }
  function clearDropMarks() {
    $$("#st-editor .st-item.drop-before").forEach(function (n) { n.classList.remove("drop-before"); });
    $$("#st-editor .st-items.drop-end").forEach(function (n) { n.classList.remove("drop-end"); });
  }
  function insertIndexAt(wrap, y) {                       // 0..n = where the row would land
    var rows = itemRows(wrap);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return rows.length;
  }
  function markDrop(wrap, at) {
    clearDropMarks();
    var rows = itemRows(wrap);
    if (at >= rows.length) wrap.classList.add("drop-end");
    else if (rows[at]) rows[at].classList.add("drop-before");
  }
  root.addEventListener("dragstart", function (e) {
    if (!ed || !e.target.closest) return;
    var grip = e.target.closest(".st-grip");
    if (!grip) return;
    var row = grip.closest(".st-item"), wrap = grip.closest(".st-items");
    if (!row || !wrap) return;
    syncFromForm();                                       // flush any half-typed label first
    dragKind = wrap.getAttribute("data-kind");
    dragFrom = Number(row.getAttribute("data-i"));
    row.classList.add("dragging");
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(dragFrom));
      e.dataTransfer.setDragImage(row, 16, 16);
    } catch (err) { /* browser without a real DataTransfer - the drop still works */ }
    e.stopPropagation();
  });
  root.addEventListener("dragover", function (e) {
    if (dragKind === null || !e.target.closest) return;
    var wrap = e.target.closest(".st-items");
    if (!wrap || wrap.getAttribute("data-kind") !== dragKind) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = "move"; } catch (err) { }
    markDrop(wrap, insertIndexAt(wrap, e.clientY));
  });
  root.addEventListener("drop", function (e) {
    if (dragKind === null || !e.target.closest) return;
    var wrap = e.target.closest(".st-items");
    if (!wrap || wrap.getAttribute("data-kind") !== dragKind) { clearDropMarks(); return; }
    e.preventDefault();
    var at = insertIndexAt(wrap, e.clientY), kind = dragKind, from = dragFrom;
    dragKind = null; dragFrom = -1; clearDropMarks();
    syncFromForm();
    moveItem(kind, from, at > from ? at - 1 : at);
  });
  root.addEventListener("dragend", function () {
    dragKind = null; dragFrom = -1;
    clearDropMarks();
    $$("#st-editor .st-item.dragging").forEach(function (n) { n.classList.remove("dragging"); });
  });

  root.addEventListener("change", function (e) {
    if (!inEditor(e) || !ed) return;
    var t = e.target;
    var cmdIn = t.closest("input[type=color][data-cmd]");
    if (cmdIn) {
      var target = document.getElementById(cmdIn.getAttribute("data-target"));
      target.focus();
      document.execCommand("styleWithCSS", false, true);
      document.execCommand(cmdIn.getAttribute("data-cmd"), false, cmdIn.value);
      changed(); return;
    }
    var act = t.getAttribute("data-act");
    if (act === "media-upload" && t.files && t.files[0]) {
      uploadMedia(t.files[0], function (r) { syncFromForm(); ed.media = Object.assign(ed.media || {}, { src: r.src, kind: r.kind, external: false }); rerenderCard("media"); changed(); toast("Attached " + r.file); });
      return;
    }
    if (t.tagName === "SELECT" && t.getAttribute("data-cmd") && t.getAttribute("data-target")) {
      var th = document.getElementById(t.getAttribute("data-target"));
      if (th) {
        th.focus();
        document.execCommand("styleWithCSS", false, true);
        document.execCommand(t.getAttribute("data-cmd"), false, t.value || null);
        changed();
      }
      return;
    }
    if (act === "cj-level-img" && t.files && t.files[0]) {
      var cji = Number(t.getAttribute("data-i")), cjl = Number(t.getAttribute("data-l"));
      uploadMedia(t.files[0], function (r) {
        syncFromForm();
        var a = conjointOf(ed).attributes[cji];
        a.images = a.images || []; a.images[cjl] = r.src;
        rerenderCard("answers"); changed();
      });
      return;
    }
    if (act === "cj-attr-range" || act === "cj-attr-images" || act === "cj-attr-group" || act === "cj-attr-bad") {
      syncFromForm();
      var ai2 = Number(t.getAttribute("data-i")), at = conjointOf(ed).attributes[ai2];
      if (act === "cj-attr-range") {
        at.range = t.checked ? (at.range || { from: 1, to: 5, step: 1, suffix: "" }) : null;
      } else if (act === "cj-attr-images") {
        at.images = t.checked ? (at.images || []).slice(0, at.levels.length)
                    .concat(new Array(Math.max(0, at.levels.length - (at.images || []).length)).fill(""))
                    : [];
      } else if (act === "cj-attr-group") {
        at.group_inclusion = t.checked;
      } else {
        at.higher_is_bad = t.checked;
      }
      rerenderCard("answers"); changed();
      return;
    }
    if (act === "it-media" && t.files && t.files[0]) {
      var mkind = t.getAttribute("data-kind"), midx = Number(t.getAttribute("data-i"));
      uploadMedia(t.files[0], function (r) {
        syncFromForm();
        var media = { kind: r.kind || "image", src: r.src };
        if (mkind === "pt") {
          var pp = scalePoints(ed); if (!pp[midx]) return;
          pp[midx].media = media; writeScalePoints(pp);
        } else {
          var host = (ed[LIST_KEY[mkind]] || [])[midx]; if (!host) return;
          host.media = media; delete host.image;
        }
        rerenderCard("answers"); changed();
      });
      return;
    }
    if (act === "opt-img" && t.files && t.files[0]) {
      var oi = Number(t.getAttribute("data-oi"));
      uploadMedia(t.files[0], function (r) { syncFromForm(); ed.options[oi].image = r.src; rerenderCard("answers"); changed(); });
      return;
    }
    if (t.id === "f-id") { applyId(t); return; }
    if (t.id === "f-type") { if (t.value !== ed.type) convertType(t.value); return; }
    if (t.id === "f-section") { changed(); renderOutline(); return; }
    if (t.getAttribute("data-rule") === "q" || t.getAttribute("data-rule") === "op" || t.id === "f-sif-match") { syncFromForm(); rerenderCard("logic"); changed(); return; }
    // screening: switching the question or the condition rebuilds the value control
    if (t.getAttribute("data-sf") === "q" || t.getAttribute("data-sf") === "op") {
      var isQ = t.getAttribute("data-sf") === "q", ri3 = Number(t.getAttribute("data-ri"));
      var before = (scrRules()[ri3] || {});
      syncFromForm();
      var s3 = scrOf();
      if (s3 && s3.rules[ri3]) {
        var qn = qById(s3.rules[ri3].q) || ed;
        if (isQ) {                                    // new question -> its own first condition
          var opsN = Q.opsFor(qn);
          s3.rules[ri3] = scrDefaultRule(qn, opsN.length ? opsN[0].op : "answered");
        } else if (!scrValueFits(s3.rules[ri3].value, Q.valueKind(s3.rules[ri3].op)) ||
                   Q.valueKind(before.op) !== Q.valueKind(s3.rules[ri3].op)) {
          s3.rules[ri3] = scrDefaultRule(qn, s3.rules[ri3].op);      // the number moves to a new home
        }
        s3.when = scrWhenDefault(s3.rules);
      }
      rerenderCard("screening"); changed(); return;
    }
    if (t.id === "f-scr-on") {                     // the Screening On / Off switch
      syncFromForm();
      if (t.checked) {
        var s0 = scrEnsure(); delete s0.enabled;
        if (!(s0.rows || []).length && !(s0.rules || []).length) scrSeedBlock();
      } else {
        var sOff = scrEnsure(); sOff.enabled = false;   // off covers the option marks too
      }
      rerenderCard("screening"); changed(); return;
    }
    if (t.name === "f-scr-dir") {                  // Respondents will Screen In / Screen Out
      syncFromForm();
      var sd = scrEnsure();
      sd.mode = t.value === "qualify" ? "qualify" : "screen_out";
      if (scrIsStructured() && (sd.rows || []).length) {
        sd.outside = sd.mode !== "qualify";        // the usual reading of each direction
      }
      rerenderCard("screening"); changed(); return;
    }
    if (t.name === "f-scr-type") {                 // Individual / Sum of responses
      syncFromForm();
      var st = scrEnsure();
      st.type = t.value === "sum" ? "sum" : "individual";
      if (st.type === "sum" && !st.sum) {
        st.sum = { op: "eq", value: ed.type === "sum_to_100" ? 100 : 0 };
      }
      if (st.type === "individual" && !st.outside) st.outside = st.mode !== "qualify";
      rerenderCard("screening"); changed(); return;
    }
    if (t.id === "f-scr-add-row") {                // the dropdown of every answer
      syncFromForm();
      var sa2 = scrEnsure(), addCode = String(t.value || "");
      if (addCode) {
        var have2 = scrRows();
        if (have2.indexOf(addCode) < 0) have2.push(addCode);
        sa2.rows = have2;
        sa2.min = sa2.min || {}; sa2.max = sa2.max || {};
        if (sa2.min[addCode] === undefined) {
          sa2.min[addCode] = ed.scale ? ed.scale.min : 0;
          sa2.max[addCode] = ed.scale ? ed.scale.max : 100;
        }
      }
      rerenderCard("screening"); changed(); return;
    }
    if (t.getAttribute && t.getAttribute("data-scr-at") !== null) {   // a band moved to another answer
      syncFromForm(); rerenderCard("screening"); changed(); return;
    }
    if (t.id === "f-scr-outside") {                // each answer inside or outside its range
      syncFromForm();
      var so = scrEnsure();
      so.outside = t.value !== "inside";
      rerenderCard("screening"); changed(); return;
    }
    if (t.id === "f-scr-sum-op") {                 // equal to / less than / greater than / Min to Max
      syncFromForm();
      var ss = scrEnsure();
      if (!ss.sum) ss.sum = { op: "eq", value: 0 };
      ss.sum.op = t.value;                           // syncScreening reshapes the number
      rerenderCard("screening"); changed(); return;
    }
    if (t.id === "f-sif-on") { syncFromForm(); renderEditorPane(); changed(); return; }
    if (t.id === "f-scr-match" || t.id === "f-scr-when") { syncFromForm(); rerenderCard("screening"); changed(); return; }
    if (t.getAttribute && t.getAttribute("data-sf") && !t.classList.contains("st-scr-rownum")) {
      changed(); refreshScrPlain(); return;         // a number being typed: update the sentence only
    }
    if (t.name === "f-rz") { $$("#st-editor .st-radio").forEach(function (l) { l.classList.toggle("on", l.querySelector("input").checked); }); }
    if (t.closest(".st-flag")) t.closest(".st-flag").classList.toggle("on", t.checked);
    if (t.type === "checkbox" && t.closest(".st-flag")) { changed(); return; }
    changed();
  });
  root.addEventListener("input", function (e) {
    if (!inEditor(e) || !ed) return;
    if (e.target.id === "f-raw" || e.target.id === "f-id" || e.target.classList.contains("st-pipe-search")) return;
    if (e.target.id === "f-scr-try") {                  // tester: a hand-typed answer
      syncFromForm();
      var ta2 = scrTest[ed.id] || (scrTest[ed.id] = {});
      ta2._ = Q.qKind(ed) === "number" ? Number(e.target.value || 0) : e.target.value;
      rerenderCard("screening"); changed(); return;
    }
    if (e.target.classList && e.target.classList.contains("st-scr-rownum")) {   // tester: an allocation
      syncFromForm();
      var ta3 = scrTest[ed.id] || (scrTest[ed.id] = {});
      ta3[e.target.getAttribute("data-scr-row")] = Number(e.target.value || 0);
      rerenderCard("screening"); changed(); return;
    }
    var sfName = e.target.getAttribute ? e.target.getAttribute("data-sf") : null;
    if (sfName === "valueSum") {              // keep the hidden "rows=number" in step as it is typed
      var hold = e.target.closest(".st-rule").querySelector('[data-sf="value"]');
      if (hold) hold.value = String(hold.value).split("=")[0] + "=" + e.target.value;
    }
    changed();
    if (sfName) refreshScrPlain();            // the sentence follows the number as it is typed
  });
  root.addEventListener("keydown", function (e) {
    var t = e.target;
    if (t && t.id === "f-id" && e.key === "Enter") { e.preventDefault(); applyId(t); }
    // \u2191 / \u2193 on a focused grip swaps that entry with its neighbour
    if (!ed || !t || !t.closest || !t.closest(".st-grip")) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    var row = t.closest(".st-item"), wrap = row && row.closest(".st-items");
    if (!row || !wrap) return;
    e.preventDefault();
    var kind = wrap.getAttribute("data-kind"), from = Number(row.getAttribute("data-i"));
    syncFromForm();
    moveItem(kind, from, from + (e.key === "ArrowUp" ? -1 : 1), true);
  });
  // keep selection-based commands working when the toolbar button steals focus
  root.addEventListener("mousedown", function (e) {
    if (e.target.closest("button.st-tb, .st-tb-color")) e.preventDefault();      // keep the text selection
    var pb = e.target.closest("[data-pipe-for]");
    if (pb) { e.preventDefault(); pipeCaret = null; rememberCaret(document.getElementById(pb.getAttribute("data-pipe-for"))); }
  });
  root.addEventListener("paste", function (e) {
    var rich = e.target.closest("[data-rich]"); if (!rich) return;
    e.preventDefault();
    var html = e.clipboardData.getData("text/html"), text = e.clipboardData.getData("text/plain");
    document.execCommand("insertHTML", false, html ? Q.sanitize(html) : esc(text).replace(/\n/g, "<br>"));
  });
  document.addEventListener("click", function (e) {
    if (e.target.closest("#qtest-close") || (e.target.id === "qtest")) { var ov = document.getElementById("qtest"); if (ov) ov.hidden = true; }
    if (e.target.id === "st-modal") closeModal();
    var b = e.target.closest("#st-modal [data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    if (act === "modal-close") closeModal();
    // Launch / Reminder / copy live in the modal, which sits outside #st-root
    if (act === "launch-go") launchStudy(b.getAttribute("data-slug"), false);
    if (act === "launch-save") launchStudy(b.getAttribute("data-slug"), true);
    if (act === "remind") remindStudy(b.getAttribute("data-slug"));
    if (act === "copy-public") copyLink(b.getAttribute("data-slug"));
    if (act === "new-mode") showNewStudyForm(b.getAttribute("data-mode"));
    if (act === "new-back") openNewStudy();
    if (act === "new-create") createFromWizard();
    if (act === "agent-send") { var msg = $(".st-agent-msg"); if (msg) msg.innerHTML = '<b>Recommended next step</b><p>Start by confirming one primary business decision, then keep each question tied to it. I recommend reviewing screening criteria and removing any double-barrelled wording before launch.</p>'; }
    if (act === "agent-action") { var box = $(".st-agent-msg"); if (box) box.innerHTML = '<b>Suggested edit ready</b><p>I recommend concise, neutral wording and mutually exclusive answer choices. Use the real-time fixes beside each flagged issue to apply a specific change with confirmation.</p>'; }
    if (act === "logic-guide") { closeModal(); openLogicGuide(); }
    if (act === "logic-apply") { var qid = val('lg-q'), op = val('lg-op'), value = val('lg-value'); if (!qid) return; if (!confirm('Apply this show-if rule to ' + ed.id + '?')) return; ed.show_if = ed.show_if || {match:'all',rules:[]}; if (!((ed.show_if.rules || []).length)) delete ed.show_if.off; ed.show_if.rules.push({q:qid,op:op,value:value}); closeModal(); markChanged(); renderEditorPane(); toast('Show-if rule applied — test it in the live preview'); }
    if (act === "qadd-type") addQuestion(b.getAttribute("data-type"), b.getAttribute("data-sec"), Number(b.getAttribute("data-after")));
    if (act === "ask-ok") { var v = (document.getElementById("st-ask") || {}).value; closeModal(); if (askCb) askCb(v); askCb = null; }
    if (act === "cmd-welcome" || act === "cmd-thanks") {
      closeModal(); tab = "settings"; renderEditor();
      toast(act === "cmd-welcome" ? "Write the welcome page under Survey pages & flow" : "Write the thank-you page under Survey pages & flow");
      var wf = document.getElementById(act === "cmd-welcome" ? "f-welcomet" : "f-thankst");
      if (wf) { wf.scrollIntoView({ block: "center" }); wf.focus(); }
    }
    if (act === "cmd-page") { closeModal(); addPage(b.getAttribute("data-sec")); }
    if (act === "cmd-randomizer") {
      cur.cfg.randomize_pages = !cur.cfg.randomize_pages; markChanged();
      toast(cur.cfg.randomize_pages ? "Page Randomizer on - middle pages shuffle per respondent" : "Page Randomizer off");
      openTypePicker(b.getAttribute("data-sec"), Number(b.getAttribute("data-after")));
    }
    if (act === "cmd-embedded") {
      closeModal();
      askText("Embedded variable", "Name to capture from the survey link - e.g. panel for /survey/" + cur.slug + "?panel=A", "", function (v2) {
        var name = (v2 || "").trim().replace(/[^a-zA-Z0-9_.-]/g, "");
        if (!name) return;
        cur.cfg.embedded = cur.cfg.embedded || [];
        if (cur.cfg.embedded.some(function (e2) { return e2.name === name; })) { toast("Already captured"); return; }
        cur.cfg.embedded.push({ name: name }); markChanged();
        toast("Embedded variable {" + name + "} captured from the link");
      });
    }
    if (act === "lang-add") { createChild(val("lang-add-sel")); }
    if (act === "child-open") { closeModal(); openEditor(b.getAttribute("data-slug")); }
    if (act === "child-open-parent") { openEditor(cur.cfg.parent); }
    if (act === "child-link") { copyLink(b.getAttribute("data-slug")); }
    if (act === "lang-del") { removeChild(b.getAttribute("data-lang")); }
    if (act === "lang-ai") { aiTranslate(b); }
    if (act === "lang-save") { saveTranslations(); }
    if (act === "tl-save") {
      var nt = (val("tl-title") || "").trim();
      if (nt) cur.title = nt;
      var nl = val("tl-lang") || "en-US";
      if (nl === "en-US") delete cur.cfg.language; else cur.cfg.language = nl;
      var ti = document.getElementById("ed-title"); if (ti && nt) ti.value = nt;
      closeModal(); markChanged(); flushSave(function () { toast("Saved"); });
    }
  });

  // search / missing-only inside the language panel (delegated so re-renders keep focus)
  document.addEventListener("change", function (e) {
    if (!e.target || e.target.id !== "ns-file" || !e.target.files[0]) return;
    var fd = new FormData(); fd.append("file", e.target.files[0]);
    var state = document.getElementById("ns-file-state"); if (state) state.textContent = "Reading document…";
    fetch("/api/studio/import-document", {method:"POST", body:fd}).then(function(r){return r.json();}).then(function(d){
      if (d.error) { if (state) state.textContent = d.error; return; }
      var area = document.getElementById("ns-objectives"); if (area) area.value = d.text || "";
      if (state) state.textContent = "✓ " + d.filename + " · ready to generate";
      var title = document.getElementById("ns-title"); if (title && title.value === "New research study") title.value = d.filename.replace(/\.[^.]+$/, "");
    }).catch(function(){ if(state) state.textContent = "Could not upload the document."; });
  });
  document.addEventListener("input", function (e) {
    if (e.target && e.target.id === "lang-search") {
      langPanel.q = e.target.value;
      var host = document.getElementById("lang-tr-host");
      if (host) host.innerHTML = trTableHtml();
    }
    if (e.target && e.target.id === "lang-missing") {
      langPanel.onlyMissing = e.target.checked;
      var host2 = document.getElementById("lang-tr-host");
      if (host2) host2.innerHTML = trTableHtml();
    }
  });

  // ------------------------------------------------------------ TPP + walkthrough tab
  var TPP_FIELDS = [["patient", "Patient population", "patient"], ["trial", "Pivotal trial", "trial"],
    ["mechanism", "Mechanism of action", "mechanism"], ["efficacy", "Headline efficacy", "efficacy"],
    ["safety", "Safety summary", "safety"], ["administration", "Administration", "dosing"],
    ["cdx", "Companion diagnostic", "cdx"]];

  function artLabels() { return window.BEACON_ART_LABELS || [["generic", "Generic"]]; }
  function artLabel(id) { var hit = artLabels().filter(function (a) { return a[0] === id; })[0]; return hit ? hit[1] : id; }
  function newSceneId() { return "sc_" + Math.random().toString(36).slice(2, 8); }
  function scenes() {
    if (!Array.isArray(cur.cfg.explainer_scenes)) cur.cfg.explainer_scenes = [];
    cur.cfg.explainer_scenes.forEach(function (sc) {
      if (!sc.art) sc.art = (window.BEACON_ART || {})[sc.id] ? sc.id : "generic";
      if (!sc.id) sc.id = newSceneId();
    });
    return cur.cfg.explainer_scenes;
  }

  function tppTab() {
    var t = cur.cfg.tpp || {};
    return '<div class="st-page-head"><h2>Product walkthrough</h2><p>The animated explainer respondents watch before the questions. ' +
      "<b>Quick start:</b> fill in the product profile and press <em>Build scenes from text</em>. Then fine-tune scenes, artwork and narration below. " +
      "<em>Preview walkthrough</em> always plays what is on this page right now.</p></div>" +
      '<details class="st-details"' + (scenes().length ? "" : " open") + '><summary>Product profile text (quick start)</summary><div class="st-grid2">' +
      TPP_FIELDS.map(function (f) {
        return '<div class="st-field"><label>' + f[1] + '</label><textarea data-tpp="' + f[0] + '">' + esc(t[f[0]] || "") + "</textarea></div>";
      }).join("") + "</div>" +
      '<div class="st-row"><button class="st-btn on" data-act="regen">Build scenes from text</button>' +
      '<span class="st-muted-note">Replaces the scene list below with one scene per filled-in field.</span></div>' +
      "</details>" +
      '<h3 class="st-h3">Walkthrough scenes <span class="st-count" id="scene-count"></span></h3>' +
      '<div class="st-row"><label class="st-switch"><input type="checkbox" id="f-tts"' + (cur.cfg.use_tts ? " checked" : "") + '><i></i>Narrate scenes without an uploaded clip using the browser voice</label></div>' +
      '<div class="st-row">' +
      '<button class="st-btn play" data-act="preview-tpp">&#9654; Preview walkthrough</button>' +
      '<button class="st-btn" data-act="scene-add">+ Add scene</button></div>' +
      '<div id="scene-prev" style="margin-top:12px"></div>';
  }
  function draftTpp() {
    var tpp = {};
    root.querySelectorAll("[data-tpp]").forEach(function (n) { tpp[n.getAttribute("data-tpp")] = n.value; });
    return tpp;
  }
  function scenesFromTppText(t) {
    t = t || {};
    var titles = { patient: "The patient in front of you", trial: "The pivotal trial",
      mechanism: "Mechanism of action", efficacy: "Headline efficacy", safety: "Safety at a glance",
      administration: "Dosing and administration", cdx: "Companion diagnostic" };
    return TPP_FIELDS.filter(function (f) { return (t[f[0]] || "").trim(); }).map(function (f) {
      return { id: newSceneId(), art: f[2], clip: null, at: 0, title: titles[f[0]], caption: t[f[0]].trim() };
    });
  }
  function renderScenePrev() {
    var el = document.getElementById("scene-prev");
    if (!el) return;
    var list = scenes();
    var cnt = document.getElementById("scene-count");
    if (cnt) cnt.textContent = list.length ? list.length + (list.length === 1 ? " scene" : " scenes") : "";
    if (!list.length) {
      el.innerHTML = '<div class="st-empty">No scenes yet. Fill in the product profile text above and press <em>Build scenes from text</em>, or <em>+ Add scene</em> to start from a blank one.</div>';
      return;
    }
    var opts = artLabels().map(function (a) { return a[0]; });
    el.innerHTML = '<div class="st-scenes">' + list.map(function (sc, i) {
      var empty = !(sc.caption || "").trim();
      var clip = sc.src ? '<span class="st-clip">&#127911; ' + esc(sc.file || "clip") + (sc.seconds ? " &middot; " + sc.seconds + "s" : "") +
        ' <button class="st-x" data-act="scene-clip-del" data-i="' + i + '" title="Remove clip">&times;</button></span>' :
        '<label class="st-upload">&#8679; Upload narration<input type="file" accept="audio/*,.mp3,.m4a,.ogg,.wav,.webm" data-act="scene-clip" data-i="' + i + '" hidden></label>';
      return '<div class="st-scene' + (empty ? " empty" : "") + '" data-scene-i="' + i + '">' +
        '<div class="st-scene-head">' +
        '<span class="st-scene-no">' + (i + 1) + "</span>" +
        '<span class="st-scene-thumb" data-act="scene-thumb" data-i="' + i + '" title="Change artwork">' + sceneThumb(sc.art) + "</span>" +
        '<div class="st-scene-fields">' +
        '<input type="text" class="st-scene-title" data-scene-title="' + i + '" placeholder="Scene title" value="' + esc(sc.title || "") + '">' +
        '<textarea class="st-scene-cap" data-scene-cap="' + i + '" placeholder="What the respondent reads / hears">' + esc(sc.caption || "") + "</textarea>" +
        "</div>" +
        '<div class="st-scene-tools">' +
        '<button class="st-btn sm" data-act="preview-scene" data-i="' + i + '" title="Play from this scene">&#9654;</button>' +
        '<button class="st-btn sm" data-act="scene-up" data-i="' + i + '" title="Move up"' + (i === 0 ? " disabled" : "") + ">&#8593;</button>" +
        '<button class="st-btn sm" data-act="scene-down" data-i="' + i + '" title="Move down"' + (i === list.length - 1 ? " disabled" : "") + ">&#8595;</button>" +
        '<button class="st-btn sm danger" data-act="scene-del" data-i="' + i + '" title="Remove scene">&#128465;</button>' +
        "</div></div>" +
        '<div class="st-scene-foot">' +
        '<label class="st-inline">Artwork <select data-scene-art="' + i + '">' +
        opts.map(function (a) { return '<option value="' + a + '"' + (a === sc.art ? " selected" : "") + ">" + esc(artLabel(a)) + "</option>"; }).join("") +
        "</select></label>" +
        '<span class="st-inline">Narration ' + clip + "</span>" +
        (empty ? '<span class="st-warn-note">no text yet</span>' : "") +
        "</div></div>";
    }).join("") + "</div>";
  }
  function sceneThumb(art) { var A = window.BEACON_ART || {}; return A[art] || A.generic || '<svg viewBox="0 0 400 240"></svg>'; }
  function uploadClip(i, file) {
    if (!file) return;
    var sc = scenes()[i]; if (!sc) return;
    var fd = new FormData(); fd.append("file", file, file.name);
    toast("Uploading " + file.name + "\u2026");
    fetch("/api/studio/narration?study=" + encodeURIComponent(cur.slug), { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (r.error) { toast("Upload failed: " + r.error); return; }
        sc.src = r.src; sc.file = r.file; sc.seconds = r.seconds || 0; sc.clipId = r.clip;
        renderScenePrev(); markChanged();
        toast("Clip attached" + (r.seconds ? " (" + r.seconds + "s)" : ""));
      })
      .catch(function () { toast("Upload failed"); });
  }
  function removeClip(i) {
    var sc = scenes()[i]; if (!sc) return;
    var id = sc.clipId || (sc.src || "").split("/").pop().split(".")[0];
    if (id) api("/api/studio/narration/delete", { study: cur.slug, clip: id });
    delete sc.src; delete sc.file; delete sc.seconds; delete sc.clipId;
    renderScenePrev(); markChanged();
  }

  // walkthrough preview overlay
  var previewer = null;
  function closePreview() {
    var ov = document.getElementById("explainer");
    if (!ov || ov.hidden) return;
    ov.hidden = true; closePreviewer();
    document.getElementById("ex-mount").innerHTML = "";
  }
  function closePreviewer() { if (previewer) { try { previewer.finish(); } catch (e) { /* already done */ } previewer = null; } }
  function previewWalkthrough(startAt) {
    if (!window.BeaconExplainer) { toast("Explainer script not loaded"); return; }
    var list = scenes();
    var ttsBox = document.getElementById("f-tts");
    var tts = ttsBox ? ttsBox.checked : !!cur.cfg.use_tts;
    var filled = list.filter(function (s) { return (s.caption || "").trim(); }).length;
    if (!list.length) { toast("Add at least one scene first"); return; }
    if (!filled) { toast("All scenes are empty - add some text first"); return; }
    var ov = document.getElementById("explainer");
    var clips = list.filter(function (s) { return s.src; }).length;
    document.getElementById("ex-hint").textContent = filled < list.length
      ? (list.length - filled) + " scene(s) still empty"
      : (clips === list.length ? "Uploaded narration on every scene"
        : clips ? clips + " uploaded clip(s), rest " + (tts ? "browser voice" : "silent")
        : (tts ? "Browser voice narration on" : "Silent, timed walkthrough"));
    ov.hidden = false;
    closePreviewer();
    previewer = new window.BeaconExplainer(document.getElementById("ex-mount"), {
      scenes: JSON.parse(JSON.stringify(list)), narration: cur.cfg.narration || {}, muted: false, tts: tts,
      onDone: function () { previewer = null; closePreview(); }
    });
    previewer.start();
    if (startAt) previewer.loadScene(startAt);
  }
  window.addEventListener("keydown", function (e) { if (e.key === "Escape") closePreview(); });
  document.addEventListener("click", function (e) { if (e.target && e.target.id === "ex-close") closePreview(); });
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (!t || !t.hasAttribute || !cur) return;
    if (t.hasAttribute("data-tpp")) { cur.cfg.tpp = draftTpp(); markChanged(); }
    var i;
    if (t.hasAttribute("data-scene-title")) { i = Number(t.getAttribute("data-scene-title")); scenes()[i].title = t.value; markChanged(); }
    if (t.hasAttribute("data-scene-cap")) {
      i = Number(t.getAttribute("data-scene-cap")); scenes()[i].caption = t.value;
      var c = t.closest(".st-scene"); if (c) c.classList.toggle("empty", !t.value.trim());
      markChanged();
    }
    if (t.hasAttribute("data-set")) { readSettings(); markChanged(); }
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || !t.hasAttribute || !cur) return;
    if (t.hasAttribute("data-scene-art")) {
      var i = Number(t.getAttribute("data-scene-art"));
      scenes()[i].art = t.value;
      var th = document.querySelector('[data-act="scene-thumb"][data-i="' + i + '"]');
      if (th) th.innerHTML = sceneThumb(t.value);
      markChanged();
    }
    if (t.getAttribute("data-act") === "scene-clip") uploadClip(Number(t.getAttribute("data-i")), t.files && t.files[0]);
    if (t.id === "f-tts") { cur.cfg.use_tts = t.checked; markChanged(); }
    if (t.id === "st-autosave") { auto.on = t.checked; try { localStorage.setItem(AUTOSAVE_KEY, auto.on ? "on" : "off"); } catch (err) { /* ignore */ } renderSaveState(); if (auto.on && auto.dirty) flushSave(); }
    if (t.hasAttribute("data-set")) { readSettings(); markChanged(); }
  });

  // ------------------------------------------------------------ conjoint / settings
  function conjointTab() {
    var c = cur.cfg, cj = c.conjoint;
    var qs = (c.questions || []).filter(function (x) { return x.type === "choice_task"; });
    var head = '<div class="st-page-head"><h2>Conjoint design</h2><p>The experiment is authored on its ' +
      '<b>Conjoint question</b> in Questions - this tab shows what that study will actually field.</p>' +
      '<button class="st-btn" data-act="cj-open-q" type="button">Open the conjoint question \u2192</button></div>';
    var dwell = '<div class="st-field" style="max-width:320px"><label>Minimum seconds on each task ' +
      '<span class="st-opt">speeder guard</span></label><input id="f-dwell" type="number" data-set="1" value="' +
      (c.conjoint_min_dwell == null ? 10 : c.conjoint_min_dwell) + '"></div>';
    if (!qs.length) {
      return head + '<div class="st-note">This study has no conjoint question yet. Add one from ' +
        '<b>+ Add question</b> \u2192 Methodologies \u2192 Conjoint, then fill in its attributes and press ' +
        '<b>Generate design</b>.</div>' + dwell;
    }
    if (!cj || !cj.tasks) {
      return head + '<div class="st-note">No design has been generated yet. Open the conjoint question ' +
        '(' + esc(qs[0].id) + '), fill in its attributes and levels, and press <b>Generate design</b>.</div>' + dwell;
    }
    var kpi = function (v, l) { return '<div class="st-kpi"><strong>' + v + "</strong><span>" + l + "</span></div>"; };
    var tasks = Array.isArray(cj.tasks) ? cj.tasks : Object.keys(cj.tasks).map(function (k) { return cj.tasks[k]; });
    var nCards = tasks.length && tasks[0] ? tasks[0].length : (cj.n_alts || 0);
    var html = head +
      '<div class="st-kpis">' + kpi(tasks.length, "sets") + kpi(nCards, "cards per set") +
      kpi((cj.attributes || []).length, "attributes") +
      kpi(cj.has_opt_out === false ? "off" : "on", "allow \u201Cnone\u201D") + "</div>" + dwell +
      '<div class="st-cj-sum"><div class="st-cj-attrs-head"><b>Attributes</b><span class="st-meta">' +
      (cj.generated_at ? "generated " + esc(cj.generated_at) : "") + '</span></div>';
    (cj.attributes || []).forEach(function (a, i) {
      var looked = (cj.groups && cj.groups[a.id]) ? cj.groups[a.id].length : 0;
      html += '<div class="st-cj-attr"><div class="st-cj-attr-top"><span class="st-seq">' + (i + 1) + '.</span>' +
        '<b>' + esc(a.label || a.id) + '</b>' +
        (a.higher_is_bad ? ' <span class="st-chip warn">higher is worse</span>' : "") +
        ' <span class="st-meta">' + (a.levels || []).length + " levels" +
        (a.group_inclusion ? " \u00B7 asked in " + looked + " of " + tasks.length + " sets" : " \u00B7 every set") +
        "</span></div><div class=\"st-cj-levels\">" +
        (a.levels || []).map(function (lv, li) {
          return '<span class="st-cj-chip">' + esc(lv) +
            ((a.images || [])[li] ? ' <span class="st-opt">img</span>' : "") + "</span>";
        }).join("") + "</div></div>";
    });
    // the first design row, so it is obvious the design is real and not just a description
    html += '</div><div class="st-field" style="margin-top:12px"><label>First set <span class="st-opt">as the ' +
      'respondent sees it (order is reshuffled per respondent)</span></label>' +
      (tasks[0] || []).map(function (alt, ai) {
        var profile = alt && alt.levels !== undefined ? alt.levels : alt;
        var rows = (cj.attributes || []).map(function (a, i2) {
          var lv = Array.isArray(profile) ? profile[i2] : profile[a.id];
          if (lv === null || lv === undefined) return "";
          return "<div>" + esc(a.label || a.id) + ": <b>" + esc((a.levels || [])[lv]) + "</b></div>";
        }).join("");
        return '<div class="st-cj-setcard"><b>Card ' + (ai + 1) + "</b>" + rows + "</div>";
      }).join("") + "</div>";
    return html;
  }
  function settingsTab() {
    var c = cur.cfg, qc = c.qc || {}, m = c.metrics || {}, ai = qc.ai || {};
    var aiAction = ai.enabled === false ? "off" : (ai.action || "confirm");
    var checkAll = qc.check_all_text === false ? "listed" : "all";
    var f = function (id, label, hint, value, ph, type) {
      return '<div class="st-field"><label>' + label + (hint ? ' <span class="st-opt">' + hint + "</span>" : "") + '</label><input id="' + id + '" data-set="1"' + (type ? ' type="' + type + '"' : "") + ' value="' + esc(value == null ? "" : value) + '"' + (ph ? ' placeholder="' + ph + '"' : "") + "></div>";
    };
    return '<div class="st-page-head"><h2>Settings & quality control</h2><p>Links, speeder limits and the automatic data-quality flags applied to every respondent.</p></div>' +
      '<div class="st-grid2">' +
      '<div class="st-field"><label>Respondent link</label><div class="st-linkbox"><code>/survey/' + esc(cur.slug) + '</code><button class="st-btn sm" data-act="copylink" data-slug="' + esc(cur.slug) + '">Copy</button></div>' +
      '<div class="st-meta">Test link (not counted as real data): <code>/survey/' + esc(cur.slug) + "/test</code></div></div>" +
      f("f-minsec", "Minimum time to complete", "seconds - faster respondents are flagged as speeders", qc.min_seconds || 300, "", "number") +
      "</div>" +
      '<h4 class="st-h4">Survey pages &amp; flow <span class="st-opt">welcome page, thank-you page, link variables, page order</span></h4>' +
      '<div class="st-grid2">' +
      f("f-welcomet", "Welcome page title", "first screen before question 1", c.welcome_title, "Welcome to the study") +
      f("f-thankst", "Thank-you page title", "shown when they finish", c.thanks_title, "Thank you") +
      "</div>" +
      '<div class="st-grid2">' +
      '<div class="st-field"><label>Welcome page text</label><textarea id="f-welcome" data-set="1" rows="3" placeholder="A sentence or two about what to expect">' + esc(c.welcome_text || "") + "</textarea></div>" +
      '<div class="st-field"><label>Thank-you page text</label><textarea id="f-thanks" data-set="1" rows="3" placeholder="What happens next for them">' + esc(c.thanks_text || "") + "</textarea></div></div>" +
      '<div class="st-grid2">' +
      '<div class="st-field"><label>Authoring language <span class="st-opt">default - English US unless changed</span></label><select id="f-deflang" data-set="1">' + langOptions(c.language || "en-US") + "</select>" +
      '<div class="st-meta">Translate respondent text into other languages with <b>Survey options \u2192 Globalize Survey\u2026</b> - by hand or with AI.</div></div>' +
      '<div class="st-field"><label>Embedded variables <span class="st-opt">names captured from the survey link, comma separated</span></label><input id="f-embedded" data-set="1" value="' + esc((c.embedded || []).map(function (e2) { return e2.name; }).join(", ")) + '" placeholder="panel, rid">' +
      '<div class="st-meta">A respondent opening <code>/survey/' + esc(cur.slug) + "?panel=A</code> is stored with <code>ev_panel = A</code> and it appears in every export.</div></div></div>" +
      '<label class="st-switch"><input type="checkbox" id="f-randpages" data-set="1"' + (c.randomize_pages ? " checked" : "") + '><i></i>Page Randomizer - respondents see the middle pages in a random order</label>' +
      '<h4 class="st-h4">Respondent experience <span class="st-opt">gamified feel &amp; answer by voice</span></h4>' +
      '<label class="st-switch"><input type="checkbox" id="f-gamify" data-set="1"' + (c.gamify === false ? "" : " checked") + '><i></i>Gamified feel - progress ring, insight points, ranks and confetti; the strip stays on top while questions are shown (on by default)</label>' +
      '<div class="st-meta"><b>Answer by voice (free to deploy).</b> Respondents who pick it on the welcome page say an option (or its number, several joined with \u201cand\u201d) and \u201cnext\u201d. ' +
      'It runs on the browser\u2019s own speech recognition (Chrome, Edge, Safari), so there is no server key, account or cost. ' +
      'That browser\u2019s speech service does the recognising (Google\u2019s in Chrome), so check it suits your respondents. Tapping always works too.</div>' +
      '<h4 class="st-h4">Quality flags</h4><div class="st-grid2">' +
      f("f-attq", "Attention-check question id", "", qc.attention_q, "e.g. Q13") +
      f("f-attok", "\u2026correct answer code", "", qc.attention_ok, "e.g. 2") +
      f("f-strq", "Straight-lining check", "id of a rating grid", qc.straightline_q, "e.g. Q7") +
      f("f-uniq", "Uniform conjoint choices", "id of the choice task", qc.uniform_q, "e.g. CT1") +
      f("f-verb", "Verbatim quality checks", "open-text ids, comma separated", (qc.verbatim_qs || []).join(", "), "e.g. Q20, Q21") +
      "</div>" +
      '<h4 class="st-h4">Written-answer AI check <span class="st-opt">AI-generated / pasted text in open boxes</span></h4>' +
      '<div class="st-grid3">' +
      '<div class="st-field"><label>What the respondent sees</label><select id="f-aiaction" data-set="1">' +
      [["confirm", "Warn, and ask them to confirm the answer is their own"],
       ["warn", "Warn only - never hold them up"],
       ["off", "Off for this study"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (aiAction === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
      }).join("") + "</select></div>" +
      f("f-aiwarn", "Warn from score", "0-100 - respondent sees a caution", ai.warn_at == null ? 35 : ai.warn_at, "", "number") +
      f("f-aiflag", "Flag from score", "0-100 - raised as a QC flag, listed for review", ai.flag_at == null ? 60 : ai.flag_at, "", "number") +
      "</div>" +
      '<div class="st-field"><label>Which written answers are checked</label><select id="f-aiall" data-set="1">' +
      [["all", "Every open-text and \u201cplease specify\u201d answer"],
       ["listed", "Only the verbatim ids listed above"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (checkAll === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
      }).join("") + "</select></div>" +
      '<div class="st-note">Each answer is scored live while the respondent types and again after the field closes, from its writing style (AI-typical vocabulary, markdown, even sentence rhythm, impersonal register) and from how it arrived (pasted characters, keystrokes, typing speed). Scores and evidence appear in Admin under <b>Written answers</b> and in the <b>Verbatim AI check</b> export sheet. Nothing is ever deleted - flagged answers stay in the data.</div>' +
      '<h4 class="st-h4">Headline metrics <span class="st-opt">optional - shown on the Admin dashboard</span></h4><div class="st-grid3">' +
      f("f-m1", "Intent question", "top-2-box", m.intent_q, "e.g. Q15") +
      f("f-m2", "Share-of-patients question", "mean %", m.pct_q, "e.g. Q16") +
      f("f-m3", "Willingness-to-pay question", "mean $", m.wtp_q, "e.g. Q17") +
      "</div>";
  }
  function readSettings() {
    var c = cur.cfg;
    if (val("f-minsec") !== undefined) {
      c.qc = c.qc || {};
      c.qc.min_seconds = num("f-minsec") || 300;
      setOrDel(c.qc, "attention_q", (val("f-attq") || "").trim()); setOrDel(c.qc, "attention_ok", (val("f-attok") || "").trim());
      setOrDel(c.qc, "straightline_q", (val("f-strq") || "").trim()); setOrDel(c.qc, "uniform_q", (val("f-uniq") || "").trim());
      c.qc.verbatim_qs = (val("f-verb") || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (val("f-aiaction") !== undefined) {
        c.qc.ai = c.qc.ai || {};
        var aa = val("f-aiaction");
        c.qc.ai.enabled = aa !== "off";
        setOrDel(c.qc.ai, "action", aa === "confirm" ? "" : aa);
        c.qc.ai.warn_at = num("f-aiwarn") == null ? 35 : num("f-aiwarn");
        c.qc.ai.flag_at = num("f-aiflag") == null ? 60 : num("f-aiflag");
        if (!Object.keys(c.qc.ai).length) delete c.qc.ai;
      }
      // setOrDel drops false, so this one is written out by hand
      if (val("f-aiall") === "listed") c.qc.check_all_text = false;
      else delete c.qc.check_all_text;
      c.metrics = c.metrics || {};
      setOrDel(c.metrics, "intent_q", (val("f-m1") || "").trim()); setOrDel(c.metrics, "pct_q", (val("f-m2") || "").trim()); setOrDel(c.metrics, "wtp_q", (val("f-m3") || "").trim());
    }
    if (val("f-welcomet") !== undefined) {
      setOrDel(c, "welcome_title", (val("f-welcomet") || "").trim());
      setOrDel(c, "welcome_text", (val("f-welcome") || "").trim());
      setOrDel(c, "thanks_title", (val("f-thankst") || "").trim());
      setOrDel(c, "thanks_text", (val("f-thanks") || "").trim());
      setOrDel(c, "language", val("f-deflang") === "en-US" ? "" : val("f-deflang"));
      c.randomize_pages = chk("f-randpages") === true;
      if (chk("f-gamify") === false) c.gamify = false; else delete c.gamify;
      c.embedded = (val("f-embedded") || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean)
        .map(function (nm) { return { name: nm }; });
    }
    if (val("f-dwell") !== undefined) c.conjoint_min_dwell = num("f-dwell") || 10;
    if (val("f-cvignette") !== undefined) c.vignette = val("f-cvignette");
  }

  // ------------------------------------------------------------ responses / analysis
  function responsesTab(p) {
    api("/api/admin/data?study=" + encodeURIComponent(cur.slug) + "&scope=all")
      .then(function (d) {
        var html = '<div class="st-page-head"><h2>Responses</h2><p>Everyone who has started this study, with their QC flags. Full dashboards live in <a href="/admin/?study=' + esc(cur.slug) + '">Admin</a>.</p></div>' +
          '<div class="st-kpis">' + kpi(d.counts.total, "started") + kpi(d.counts.complete, "complete") + kpi(d.counts.screened_out, "screened out") + kpi(d.counts.in_progress, "in progress") + "</div>" +
          '<div class="st-row" style="margin-bottom:12px">' +
          '<a class="st-btn" href="/admin/export.xlsx?study=' + cur.slug + '&scope=all">Excel (all)</a>' +
          '<a class="st-btn" href="/admin/export.csv?study=' + cur.slug + '&scope=all">CSV</a>' +
          '<a class="st-btn" href="/admin/export.json?study=' + cur.slug + '&scope=all">JSON</a>' +
          '<span style="flex:1"></span>' +
          '<button class="st-btn bad" data-act="reset" data-scope="test">Reset test data</button>' +
          '<button class="st-btn bad" data-act="reset" data-scope="all">Reset all</button></div>' +
          '<table class="st-tbl"><tr><th>Code</th><th>Status</th><th>Min</th><th>QC flags</th><th>Started</th></tr>' +
          d.recent.map(function (r) {
            return "<tr><td>" + esc(r.code) + "</td><td>" + esc(r.status) + "</td><td>" + r.minutes + "</td><td>" + esc(r.flags.join(", ") || "clean") + "</td><td>" + esc(r.started_at || "") + "</td></tr>";
          }).join("") + "</table>";
        p.innerHTML = html;
      });
    function kpi(v, l) { return '<div class="st-kpi"><strong>' + v + "</strong><span>" + l + "</span></div>"; }
  }
  function analysisTab(p) {
    fetch("/api/studio/analysis?study=" + encodeURIComponent(cur.slug), { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (a) {
        var html = '<div class="st-page-head"><h2>Analysis</h2><p>Quick aggregates over completed responses.</p></div><div class="st-kpis">' +
          '<div class="st-kpi"><strong>' + a.n_complete + "/" + a.n_started + "</strong><span>completed</span></div>" +
          '<div class="st-kpi"><strong>' + a.mean_minutes + "</strong><span>mean minutes</span></div>" +
          (a.nps ? '<div class="st-kpi"><strong>' + a.nps.score + "</strong><span>NPS</span></div>" : "") + "</div>";
        a.ratings.forEach(function (r) {
          html += "<h4>" + esc(r.id) + " - " + esc(r.stem) + "</h4>" +
            '<table class="st-tbl"><tr><th>Item</th><th style="width:200px">Mean</th><th></th></tr>' +
            r.rows.map(function (row) {
              var m = row.mean == null ? 0 : row.mean;
              return "<tr><td>" + esc(row.label) + "</td><td>" + (row.mean == null ? "\u2013" : m) + '</td><td><div class="st-meter"><i style="width:' + Math.min(100, m * 14) + '%"></i></div></td></tr>';
            }).join("") + "</table>";
        });
        if (a.nps) html += '<div class="st-note">NPS segments: Promoter ' + a.nps.segments.Promoter + ", Passive " + a.nps.segments.Passive + ", Detractor " + a.nps.segments.Detractor + "</div>";
        a.maxdiff.forEach(function (m) {
          html += "<h4>MaxDiff " + esc(m.id) + " (best minus worst)</h4>" +
            '<table class="st-tbl"><tr><th>Code</th><th>Best</th><th>Worst</th><th>B-W</th></tr>' +
            m.scores.sort(function (x, y) { return y.bw - x.bw; }).map(function (s) {
              return "<tr><td>" + esc(s.code) + "</td><td>" + s.best + "</td><td>" + s.worst + "</td><td><strong>" + s.bw + "</strong></td></tr>";
            }).join("") + "</table>";
        });
        a.heatmap.forEach(function (h) {
          html += "<h4>Heat map " + esc(h.id) + "</h4><table class=\"st-tbl\"><tr><th>Cell</th><th>Mean intensity (0-3)</th></tr>" +
            h.cells.map(function (c) { return "<tr><td>" + esc(c.row) + " \u00D7 " + esc(c.col) + "</td><td>" + (c.mean == null ? "\u2013" : c.mean) + "</td></tr>"; }).join("") + "</table>";
        });
        if (a.choice_share) {
          html += "<h4>Conjoint: share of choices when level shown</h4><table class=\"st-tbl\"><tr><th>Attribute</th><th>Level</th><th>Choice share</th></tr>" +
            a.choice_share.map(function (s) { return "<tr><td>" + esc(s.attr) + "</td><td>" + esc(s.level) + "</td><td>" + s.share + "%</td></tr>"; }).join("") + "</table>";
        }
        p.innerHTML = html || "<p>No responses yet.</p>";
      });
  }

  // ------------------------------------------------------------ new-study launchpad + study-level events
  var newStudyMode = "scratch";
  function openNewStudy() {
    var cards = [
      ["scratch", "＋", "Build from scratch", "Start with a clean, flexible questionnaire."],
      ["prompt", "✦", "Describe the business need", "Give AI a prompt or rough objectives; it will propose a questionnaire."],
      ["agent", "◈", "Design with AI agent", "Work step by step with a research copilot from objectives to programming."],
      ["upload", "⇧", "Upload a document", "Import a brief, sales document or existing questionnaire (DOCX, TXT, MD, CSV)."]
    ];
    openModal('<div class="st-modal-head"><strong>Create a new study</strong><span class="st-meta">Choose a starting point. Everything remains editable.</span><button class="ex-close" data-act="modal-close">&times;</button></div>' +
      '<div class="st-start-grid">' + cards.map(function (x) { return '<button class="st-start-card" data-act="new-mode" data-mode="' + x[0] + '"><i>' + x[1] + '</i><b>' + x[2] + '</b><span>' + x[3] + '</span></button>'; }).join('') + '</div>', 'st-newstudy');
  }
  function showNewStudyForm(mode) {
    newStudyMode = mode;
    var labels = {scratch:"Build from scratch", prompt:"Describe your business need", agent:"Design with the AI agent", upload:"Import an existing document"};
    var source = mode === "scratch" ? '' : '<label class="st-field"><span>' + (mode === "upload" ? 'Source document' : 'Objectives or business need') + '</span>' +
      (mode === "upload" ? '<div class="st-drop"><input id="ns-file" type="file" accept=".docx,.txt,.md,.csv"><b>Choose a DOCX, TXT, MD or CSV</b><small id="ns-file-state">Maximum 8 MB</small></div><textarea id="ns-objectives" hidden></textarea>' :
       '<textarea id="ns-objectives" rows="7" placeholder="Example: Understand why sales declined, assess unmet needs, test three concepts and identify purchase drivers…"></textarea>') + '</label>';
    openModal('<div class="st-modal-head"><strong>' + labels[mode] + '</strong><span class="st-meta">AI suggestions are a starting point—not a locked template.</span><button class="st-btn sm ghost" data-act="new-back">← Back</button><button class="ex-close" data-act="modal-close">&times;</button></div><div class="st-new-form">' +
      '<div class="st-form-2"><label class="st-field"><span>Study title</span><input id="ns-title" value="New research study" autofocus></label><label class="st-field"><span>Study group <em>optional</em></span><input id="ns-group" placeholder="e.g. Brand tracking 2027"></label></div>' +
      '<label class="st-field"><span>Parent study ID <em>optional</em></span><input id="ns-parent" placeholder="e.g. STU-000014"><small>Create a child wave or related survey under a parent.</small></label>' + source +
      (mode === "agent" ? '<div class="st-agent-note">◈ The research agent will stay available in Studio to guide objectives, sample, question wording, logic and quality checks.</div>' : '') +
      '<div class="st-modal-actions"><button class="st-btn" data-act="new-back">Back</button><button class="st-btn on" data-act="new-create">' + (mode === "scratch" ? 'Create study' : 'Generate editable questionnaire') + '</button></div></div>', 'st-newstudy');
  }
  function generatedCfg(title, objectives) {
    var c = blankCfg(); c.title = title; var text = (objectives || '').toLowerCase();
    c.questions[0].stem = "Which option best describes your role or relationship to this category?";
    c.questions[1].stem = text.indexOf("sales") >= 0 ? "Please rate the factors that influence your purchasing decisions." : "Please rate the importance of each factor when making your decision.";
    c.questions[1].rows = [{code:"quality",label:"Product or service quality"},{code:"value",label:"Value for money"},{code:"support",label:"Sales and customer support"},{code:"trust",label:"Brand trust"}];
    c.questions[2].stem = "How likely are you to recommend this brand or solution?";
    c.questions[3].stem = "What is the single most important improvement you would like to see, and why?";
    if (objectives) c.research_brief = objectives;
    return c;
  }
  function createFromWizard() {
    var title = (document.getElementById('ns-title') || {}).value || 'New research study';
    var obj = (document.getElementById('ns-objectives') || {}).value || '';
    var cfg = newStudyMode === 'scratch' ? blankCfg() : generatedCfg(title, obj);
    cfg.title = title; cfg.group_name = ((document.getElementById('ns-group') || {}).value || '').trim();
    cfg.parent_study = ((document.getElementById('ns-parent') || {}).value || '').trim().toUpperCase();
    cfg.creation_mode = newStudyMode; cfg.ai_assistant = newStudyMode !== 'scratch';
    closeModal(); createStudy(cfg);
  }
  function createStudy(cfg) {
    api("/api/studio/save", { slug: "", title: cfg.title, cfg: cfg }).then(function (r) {
      if (r.error) { toast(r.error); return; }
      toast("Created /" + r.slug); openEditor(r.slug);
    });
  }
  function copyLink(slug) {
    var url = location.origin + "/survey/" + slug;
    var done = function () { toast("Link copied: " + url); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt("Respondent link", url); });
    else prompt("Respondent link", url);
  }
  function setStatus(slug, st, after) {
    var go = function () {
      api("/api/studio/status", { slug: slug, status: st }).then(function (r) {
        if (r.error) { toast(r.error); return; }
        if (cur && cur.slug === slug) { cur.status = st; $$(".st-status-btn").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-status") === st); }); }
        toast(st === "live" ? "Live - respondents can start at /survey/" + slug : "Status: " + st);
        if (after) after();
      });
    };
    if (st === "live" && !confirm("Launch /survey/" + slug + " live? Respondents will be able to start answering.")) return;
    if (cur && cur.slug === slug) flushSave(go); else go();
  }

  root.addEventListener("click", function (e) {
    var t = e.target;
    var tabBtn = t.closest("[data-tab]");
    if (tabBtn) { if (tab === "settings" || tab === "conjoint") readSettings(); tab = tabBtn.getAttribute("data-tab"); renderTab(); return; }
    var b = t.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    var slug = b.getAttribute("data-slug");
    if (act === "child-open-parent") { if (cur) openEditor(cur.cfg.parent); return; }
    if (act === "child-open") { openEditor(b.getAttribute("data-slug")); return; }
    if (act === "child-link") { copyLink(b.getAttribute("data-slug")); return; }
    if (act === "lang-add") { createChild(val("lang-add-sel")); return; }
    if (act === "lang-del") { removeChild(b.getAttribute("data-lang")); return; }
    if (act === "lang-save") { saveTranslations(); return; }
    if (act === "lang-ai") { aiTranslate(b); return; }
    var i = Number(b.getAttribute("data-i"));

    if (act === "new") openNewStudy();
    if (act === "ai-guide") {
      openModal('<div class="st-modal-head"><strong>✦ Research design agent</strong><span class="st-meta">Your study-aware guide</span><button class="ex-close" data-act="modal-close">&times;</button></div><div class="st-agent-chat"><div class="st-agent-msg"><b>How can I help with this study?</b><p>I can review the objectives, recommend question types, improve wording, suggest logic, check bias and prepare the study for launch.</p></div><div class="st-agent-chips"><button>Review my questionnaire</button><button>Suggest the next question</button><button>Check for bias</button><button>Help with sample design</button></div><textarea placeholder="Ask about your objectives, questionnaire or study design…"></textarea><div class="st-modal-actions"><span class="st-meta">Suggestions never change your study until you approve them.</span><button class="st-btn on" data-act="agent-send">Send</button></div></div>', 'st-agent-modal');
    }
    if (act === "dup-beacon") {
      api("/api/studio/study?slug=beacon").then(function (s) {
        if (s.error) { toast("PROJECT BEACON template not found"); return; }
        var cfg = JSON.parse(JSON.stringify(s.cfg)); cfg.title = s.title + " (copy)"; createStudy(cfg);
      });
    }
    if (act === "home-filter") { homeFilter = b.getAttribute("data-f"); renderHome(); }
    if (act === "open") openEditor(slug);
    if (act === "back") { flushSave(function () { history.replaceState(null, "", location.pathname + location.search); loadList(); }); }
    if (act === "status") setStatus(slug, b.getAttribute("data-status"), loadList);
    if (act === "setstatus") { if (b.classList.contains("on")) return; setStatus(cur.slug, b.getAttribute("data-status")); }
    if (act === "media-add-quick") {
      syncFromForm();
      if (edTab !== "content") { edTab = "content"; renderEditorPane(); }
      var mcard = document.getElementById("card-media");
      if (mcard && mcard.scrollIntoView) mcard.scrollIntoView({ block: "nearest" });
      var fi2 = $("[data-act=media-upload]");
      if (fi2) fi2.click();
      return;
    }
    if (act === "edtab") {
      syncFromForm();
      var want = t.getAttribute("data-t");
      edTab = want === "cond" ? "cond" : want === "screen" ? "screen" : "content";
      renderEditorPane();
      return;
    }
    if (act === "cj-open-q") {
      readSettings();
      var qi = (cur.cfg.questions || []).findIndex(function (x) { return x.type === "choice_task"; });
      tab = "questions"; renderEditor();
      if (qi >= 0) selectQuestion(qi);
      return;
    }
    if (act === "tab-back") { if (tab === "settings" || tab === "conjoint") readSettings(); tab = "questions"; renderEditor(); return; }
    if (act === "sopts") { var mn = document.getElementById("st-sopts"); if (mn) mn.hidden = !mn.hidden; return; }
    if (act === "so-settings") { closeSopts(); tab = "settings"; renderEditor(); }
    if (act === "so-share") { closeSopts(); shareModal(); }
    if (act === "so-move") { closeSopts(); moveStudy(); }
    if (act === "so-dup") { closeSopts(); dupCurrent(false); }
    if (act === "so-word") { closeSopts(); flushSave(function () {
      var url = "/api/studio/outline.docx?study=" + encodeURIComponent(cur.slug);
      // inside the preview iframe a location.href download is swallowed - fetch the
      // file and save it through a blob anchor instead (new tab as fallback)
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.blob();
      }).then(function (bl) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(bl);
        a.download = cur.slug + "_outline.docx";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        toast("Word outline downloaded - check your browser downloads.");
      }).catch(function () { window.open(url, "_blank"); });
    }); }
    if (act === "so-track") { closeSopts(); if (confirm("Go live? Anyone with the respondent link can start answering.")) setStatus(cur.slug, "live"); }
    if (act === "so-duptr") { closeSopts(); dupCurrent(true); }
    if (act === "so-global") { closeSopts(); flushSave(openLangPanel); }
    if (act === "so-title") { closeSopts(); openTitleLang(); }
    if (act === "so-del") { closeSopts(); if (confirm("Delete study /" + cur.slug + " and all of its responses? This cannot be undone.")) api("/api/studio/delete", { slug: cur.slug }).then(function () { cur = null; loadList(); }); }
    if (act === "dup") {
      api("/api/studio/duplicate", { slug: slug }).then(function (r) {
        if (r.error) { toast(r.error); return; }
        toast("Duplicated as /" + r.slug, "Open", function () { openEditor(r.slug); });
        loadList();
      });
    }
    if (act === "launch") openLaunchModal(slug);
    if (act === "pause") {
      api("/api/studio/pause", { slug: slug }).then(function (r) {
        if (r.error) { toast(r.error); return; }
        toast("Paused - nobody new can start; anyone mid-survey can still finish");
        loadList();
      });
    }
    if (act === "relaunch") {
      api("/api/studio/relaunch", { slug: slug }).then(function (r) {
        if (r.error) { toast(r.error); return; }
        toast("Live again at " + r.link);
        loadList();
      });
    }
    if (act === "remind") remindStudy(slug);
    if (act === "outbox") openOutboxModal(slug);
    if (act === "copy-public") copyLink(slug);
    if (act === "copylink") copyLink(slug || cur.slug);
    if (act === "del") {
      if (confirm("Delete study /" + slug + " and all of its responses? This cannot be undone.")) api("/api/studio/delete", { slug: slug }).then(function () { loadList(); });
    }
    if (act === "save") { if (tab === "settings" || tab === "conjoint") readSettings(); auto.dirty = true; flushSave(function () { toast("Saved"); }); }
    if (act === "viewlive") {
      // Navigate in the current preview frame. Hosted previews commonly block pop-up
      // windows, which made this button appear to do nothing.
      var url = "/survey/" + cur.slug + "/test";
      flushSave(function () { window.location.assign(url); });
    }
    if (act === "outline-view") {
      outlineView = b.getAttribute("data-v") === "thumbs" ? "thumbs" : "list";
      try { localStorage.setItem(OUTLINE_VIEW_KEY, outlineView); } catch (err) { /* private mode */ }
      renderOutline();
      return;
    }
    if (act === "addsec") {
      var n = cur.cfg.sections.length + 1, id = "S" + n;
      while (cur.cfg.sections.some(function (s) { return s.id === id; })) id += "b";
      // blank, not "Section 3" - section names are whatever the author types, never predefined
      cur.cfg.sections.push({ id: id, title: "", blurb: null });
      markChanged(); renderOutline(); refreshSectionSelect();
      var inp = $('[data-sec-title="' + (cur.cfg.sections.length - 1) + '"]'); if (inp) { inp.focus(); inp.select(); }
    }
    if (act === "delsec") {
      var secId = cur.cfg.sections[i].id, inSec = cur.cfg.questions.filter(function (q) { return q.section === secId; });
      if (cur.cfg.sections.length === 1) { toast("A study needs at least one section"); return; }
      if (inSec.length && !confirm("Delete this section and its " + inSec.length + " question(s)?")) return;
      cur.cfg.questions = cur.cfg.questions.filter(function (q) { return q.section !== secId; });
      cur.cfg.sections.splice(i, 1);
      sel = cur.cfg.questions.length ? Math.min(sel < 0 ? 0 : sel, cur.cfg.questions.length - 1) : -1;
      markChanged(); renderOutline(); renderEditorPane();
    }
    if (act === "qadd") openTypePicker(b.getAttribute("data-sec"), sel >= 0 && cur.cfg.questions[sel] && cur.cfg.questions[sel].section === b.getAttribute("data-sec") ? sel : -1);
    if (act === "qsel") { if (t.closest(".st-qi-tools")) return; selectQuestion(Number(b.getAttribute("data-qi"))); }
    if (act === "qtest") openTestView(i);
    if (act === "qtest-cur") { if (sel >= 0) openTestView(sel); }
    if (act === "qdup") {
      var src = cur.cfg.questions[i];
      var copy = JSON.parse(JSON.stringify(src)); copy.id = nextQid();
      // conditions that point at the source question follow the copy; conditions that
      // read other questions stay as they are
      [copy.screening, copy.show_if].forEach(function (blk) {
        ((blk && blk.rules) || []).forEach(function (r) { if (r && r.q === src.id) r.q = copy.id; });
      });
      cur.cfg.questions.splice(i + 1, 0, copy); markChanged(); renderOutline(); selectQuestion(i + 1); toast("Duplicated as " + copy.id);
    }
    if (act === "qdel") {
      var victim = cur.cfg.questions[i];
      cur.cfg.questions.splice(i, 1);
      sel = cur.cfg.questions.length ? Math.min(i, cur.cfg.questions.length - 1) : -1;
      markChanged(); renderOutline(); renderEditorPane();
      toast("Deleted " + victim.id, "Undo", function () { cur.cfg.questions.splice(i, 0, victim); markChanged(); renderOutline(); selectQuestion(i); });
    }
    if (act === "qup" && i > 0) { var a1 = cur.cfg.questions, t1 = a1[i - 1]; a1[i - 1] = a1[i]; a1[i] = t1; if (sel === i) sel = i - 1; else if (sel === i - 1) sel = i; markChanged(); renderOutline(); }
    if (act === "qdown" && i < cur.cfg.questions.length - 1) { var a2 = cur.cfg.questions, t2 = a2[i + 1]; a2[i + 1] = a2[i]; a2[i] = t2; if (sel === i) sel = i + 1; else if (sel === i + 1) sel = i; markChanged(); renderOutline(); }
    if (act === "prev-reshuffle") { prevSeed = "preview-" + Math.random().toString(36).slice(2, 8); renderPreview(); }
    if (act === "prev-dev") { $$('[data-act="prev-dev"]').forEach(function (x) { x.classList.toggle("on", x === b); }); var pb = document.getElementById("st-prev-body"); if (pb) pb.classList.toggle("phone", b.getAttribute("data-dev") === "phone"); }
    if (act === "regen") {
      cur.cfg.tpp = draftTpp();
      var built = scenesFromTppText(cur.cfg.tpp);
      if (!built.length) { toast("Fill in at least one product-profile field first"); return; }
      if (scenes().length && !confirm("Replace the current " + scenes().length + " scene(s) with " + built.length + " built from the text?")) return;
      cur.cfg.explainer_scenes = built; renderScenePrev(); markChanged();
      toast(built.length + " scene(s) built");
    }
    if (act === "preview-tpp") previewWalkthrough(0);
    if (act === "preview-scene") previewWalkthrough(i || 0);
    if (act === "scene-add") {
      scenes().push({ id: newSceneId(), art: "generic", clip: null, at: 0, title: "New scene", caption: "" });
      renderScenePrev(); markChanged();
      var last = document.querySelector(".st-scene:last-child textarea"); if (last) last.focus();
    }
    if (act === "scene-del") {
      var v = scenes()[i];
      if (v && (v.caption || "").trim() && !confirm("Remove scene " + (i + 1) + "?")) return;
      if (v && v.src) removeClip(i);
      scenes().splice(i, 1); renderScenePrev(); markChanged();
    }
    if (act === "scene-up" && i > 0) { var L = scenes(), tmp = L[i - 1]; L[i - 1] = L[i]; L[i] = tmp; renderScenePrev(); markChanged(); }
    if (act === "scene-down" && i < scenes().length - 1) { var L2 = scenes(), tmp2 = L2[i + 1]; L2[i + 1] = L2[i]; L2[i] = tmp2; renderScenePrev(); markChanged(); }
    if (act === "scene-clip-del") removeClip(i);
    if (act === "scene-thumb") { var s2 = document.querySelector('[data-scene-art="' + i + '"]'); if (s2) s2.focus(); }
    // ---- conjoint experiment controls ----
    if (act === "cj-attr-add") {
      syncFromForm();
      var cj = conjointOf(ed), n2 = cj.attributes.length + 1;
      var nid = "A" + n2;
      while (cj.attributes.some(function (a) { return a.id === nid; })) nid += "b";
      cj.attributes.push({ id: nid, label: "", levels: ["", ""], images: [],
                           higher_is_bad: false, group_inclusion: false, range: null });
      rerenderCard("answers"); changed();
      var nm = $('#st-editor .st-cj-attr:last-child [data-cj-field=label]'); if (nm) nm.focus();
      return;
    }
    if (act === "cj-attr-del") {
      syncFromForm();
      var cja = conjointOf(ed).attributes;
      if (cja.length <= 1) { toast("A conjoint experiment needs at least one attribute"); return; }
      cja.splice(i, 1); rerenderCard("answers"); changed(); return;
    }
    if (act === "cj-attr-up" || act === "cj-attr-down") {
      syncFromForm();
      var cjL = conjointOf(ed).attributes, j2 = act === "cj-attr-up" ? i - 1 : i + 1;
      if (j2 < 0 || j2 >= cjL.length) return;
      var tmpA = cjL[j2]; cjL[j2] = cjL[i]; cjL[i] = tmpA;
      rerenderCard("answers"); changed(); return;
    }
    if (act === "cj-level-add") {
      syncFromForm();
      var a3 = conjointOf(ed).attributes[i];
      a3.levels.push(""); if (a3.images && a3.images.length) a3.images.push("");
      rerenderCard("answers"); changed();
      var li3 = $('#st-editor [data-cj-field=level][data-i="' + i + '"][data-l="' + (a3.levels.length - 1) + '"]');
      if (li3) li3.focus();
      return;
    }
    if (act === "cj-level-del") {
      syncFromForm();
      var a4 = conjointOf(ed).attributes[i];
      if (a4.levels.length <= 2) { toast("An attribute needs at least two levels"); return; }
      a4.levels.splice(Number(b.getAttribute("data-l")), 1);
      if (a4.images && a4.images.length) a4.images.splice(Number(b.getAttribute("data-l")), 1);
      rerenderCard("answers"); changed(); return;
    }
    if (act === "cj-level-img-del") {
      syncFromForm();
      var a5 = conjointOf(ed).attributes[i];
      if (a5.images) a5.images[Number(b.getAttribute("data-l"))] = "";
      rerenderCard("answers"); changed(); return;
    }
    if (act === "cj-range-apply") {
      syncFromForm();
      var a6 = conjointOf(ed).attributes[i], r = a6.range || {};
      var from = r.from == null ? 1 : Number(r.from), to = r.to == null ? 5 : Number(r.to);
      var step = Math.max(1, Number(r.step) || 1);
      if (to < from) { toast("\u201CTo\u201D must be at least \u201CFrom\u201D"); return; }
      var lv2 = [];
      for (var v = from; v <= to && lv2.length < 12; v += step) lv2.push(String(v) + (r.suffix || ""));
      if (lv2.length < 2) { toast("That range gives fewer than two levels"); return; }
      a6.levels = lv2;
      rerenderCard("answers"); changed(); toast("Built " + lv2.length + " levels");
      return;
    }
    if (act === "cj-attr-json") {
      syncFromForm();
      var cj6 = conjointOf(ed);
      askText("Attributes as a list", "One attribute per line: name | level | level | \u2026",
        cj6.attributes.map(function (a) { return a.label + " | " + a.levels.join(" | "); }).join("\n"),
        function (txt) {
          var lines = String(txt || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
          var out = [];
          lines.forEach(function (l) {
            var p2 = l.split("|").map(function (x) { return x.trim(); });
            if (p2.length < 3) return;                       // name + at least two levels
            out.push({ id: "A" + (out.length + 1), label: p2[0], levels: p2.slice(1),
                       images: [], higher_is_bad: false, group_inclusion: false, range: null });
          });
          if (!out.length) { toast("Each line needs a name and at least two levels"); return; }
          cj6.attributes = out; rerenderCard("answers"); changed();
        });
      return;
    }
    if (act === "genconj") {
      syncFromForm();
      var spec = conjointOf(ed);
      var bad = spec.attributes.filter(function (a) { return a.levels.length < 2 || a.levels.some(function (l) { return !String(l).trim(); }); });
      if (bad.length) { toast("Every attribute needs at least two filled-in levels"); return; }
      var attrs = spec.attributes.map(function (a, i) {
        return { id: a.id || ("A" + (i + 1)), label: a.label || ("Attribute " + (i + 1)),
                 levels: a.levels.slice(), images: a.images || [],
                 higher_is_bad: !!a.higher_is_bad, group_inclusion: !!a.group_inclusion };
      });
      api("/api/studio/make_conjoint", { attributes: attrs, n_tasks: spec.n_sets || 6,
                                         n_alts: spec.n_cards || 2, seed: 7 }).then(function (d) {
        if (d.error) { toast("Design failed: " + d.error); return; }
        var ids = (d.attributes || []).map(function (a) { return a.id; });
        cur.cfg.conjoint = {
          // levels are stored positionally (same order as attributes), null where a
          // group-inclusion attribute is hidden in that task - the shape the survey
          // renderer, the CSV export and the seeded design all read.
          attributes: d.attributes, tasks: d.tasks.map(function (task) {
            return task.map(function (p, k) {
              return { alt_id: k + 1, levels: ids.map(function (id) {
                return p[id] === undefined || p[id] === null ? null : p[id]; }) };
            });
          }),
          n_tasks: d.n_tasks, n_alts: d.n_alts, has_opt_out: spec.allow_none !== false,
          title: spec.title || "", description_html: spec.description_html || "",
          none_label: spec.none_label || "None of these",
          groups: d.groups || {}, generated_at: d.generated_at || ""
        };
        if (cur.cfg.vignette) ed.vignette = ed.vignette || cur.cfg.vignette;
        markChanged();
        rerenderCard("answers"); renderPreview();
        toast("Design generated: " + d.n_tasks + " sets \u00D7 " + d.n_alts + " cards");
      });
    }
    if (act === "reset") {
      if (confirm("Reset " + b.getAttribute("data-scope") + " responses for /" + cur.slug + "?")) {
        fetch("/admin/reset?study=" + cur.slug + "&scope=" + b.getAttribute("data-scope"), { method: "POST", credentials: "same-origin" })
          .then(function (r) { return r.json(); })
          .then(function (r) { toast("Deleted " + r.deleted_respondents); responsesTab($("#st-panel .st-panel")); });
      }
    }
  });
  root.addEventListener("keydown", function (e) {
    var row = e.target.closest && e.target.closest(".st-qi");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selectQuestion(Number(row.getAttribute("data-qi"))); }
  });
  root.addEventListener("input", function (e) {
    var t = e.target;
    if (t.id === "ed-title") { cur.title = t.value; markChanged(); }
    if (t.id === "home-search") { homeSearch = t.value; var g = document.getElementById("home-grid"); if (g) g.innerHTML = homeCards(); }
    var si = t.getAttribute && t.getAttribute("data-sec-title");
    if (si != null) {
      cur.cfg.sections[Number(si)].title = t.value; markChanged();
      var opt = $('#f-section option[value="' + cur.cfg.sections[Number(si)].id + '"]'); if (opt) opt.textContent = t.value;
    }
  });

  // deep link: /studio/#<slug> opens that study's builder directly (used by Home and Admin)
  function openFromHash() {
    var slug = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (slug) openEditor(slug); else loadList();
  }
  window.addEventListener("hashchange", function () {
    var slug = location.hash.replace(/^#/, "");
    if (slug && (!cur || cur.slug !== slug)) openEditor(slug);
    if (!slug && cur) loadList();
  });
  openFromHash();
})();
