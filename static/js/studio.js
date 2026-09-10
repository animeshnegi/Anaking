/* BEACON Studio - survey builder.
   Workspace: Outline (sections + questions) · Editor (one scrolling form) · Live preview.
   Every edit writes straight into the study and is autosaved a moment later. */
(function () {
  "use strict";
  // Auth: signed-in session cookie (see /login). A ?token= in the URL is still honoured
  // for bookmarks and is appended to every request when present.
  var TOKEN = (location.search.match(/token=([^&]+)/) || [])[1] || "";
  var TQ = TOKEN ? "&token=" + encodeURIComponent(TOKEN) : "";     // query-string suffix
  var root = document.getElementById("st-root");
  var cur = null;          // {slug,title,status,cfg}
  var tab = "questions";
  var sel = -1;            // index of the question open in the editor
  var studies = [];        // dashboard cache
  var Q = window.BeaconQ;

  function needSignIn() {
    location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search + location.hash);
  }
  function api(path, body) {
    return fetch(path + (TQ ? (path.indexOf("?") < 0 ? "?" : "&") + TQ.slice(1) : ""), {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 403) { needSignIn(); throw new Error("not signed in"); }
      return r.json();
    });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
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
    single_select: { name: "Choose one", icon: "\u25C9", desc: "One answer from a list", group: "Choice" },
    multi_select: { name: "Choose many", icon: "\u2611", desc: "Tick all that apply", group: "Choice" },
    rank: { name: "Rank items", icon: "\u21C5", desc: "Put items in order of preference", group: "Choice" },
    rating_grid: { name: "Rating grid", icon: "\u25A6", desc: "Rate several items on one scale", group: "Scales" },
    semantic_diff: { name: "Word pairs", icon: "\u27F7", desc: "Slide between two opposite words", group: "Scales" },
    nps: { name: "NPS 0\u201310", icon: "\u2469", desc: "Likelihood to recommend", group: "Scales", noprev: true },
    emoji_grid: { name: "Emoji reaction", icon: "\u263A", desc: "Faces instead of numbers", group: "Scales", noprev: true },
    numeric: { name: "Number", icon: "#", desc: "Type a number - %, $, count", group: "Numbers" },
    slider: { name: "Slider", icon: "\u2696", desc: "Drag to a value", group: "Numbers" },
    sum_to_100: { name: "Allocate 100", icon: "\u03A3", desc: "Split 100 points across items", group: "Numbers" },
    open_text: { name: "Open text", icon: "\u00B6", desc: "Free text, with optional voice note", group: "Text" },
    heatmap: { name: "Heat map", icon: "\u25A9", desc: "Intensity per row \u00D7 column", group: "Advanced", noprev: true },
    maxdiff: { name: "MaxDiff", icon: "\u2194", desc: "Best / worst trade-offs", group: "Advanced", noprev: true },
    choice_task: { name: "Conjoint choice task", icon: "\u21C4", desc: "Alternatives from the conjoint design", group: "Advanced" }
  };
  var TYPES = Object.keys(TYPE_INFO);
  var GROUPS = ["Choice", "Scales", "Numbers", "Text", "Advanced"];
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
      q.scale = { min: 1, max: 7, min_label: "Not at all", max_label: "Extremely" };
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
    return q;
  }

  function blankCfg() {
    return {
      title: "New study",
      sections: [{ id: "S1", title: "Introduction", blurb: null },
                 { id: "S2", title: "Main questions", blurb: null }],
      questions: [
        qTemplate("single_select", "Q1", "S1"),
        qTemplate("rating_grid", "Q2", "S2"),
        qTemplate("nps", "Q3", "S2"),
        qTemplate("open_text", "Q4", "S2")
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
  function flushSave(cb) {
    if (!cur) { if (cb) cb(); return; }
    clearTimeout(auto.timer);
    if (auto.saving) { auto.queued = true; if (cb) auto.cbs = (auto.cbs || []).concat([cb]); return; }
    if (!auto.dirty) { if (cb) cb(); return; }
    var seq = auto.seq, slug = cur.slug;
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
      if (navigator.sendBeacon("/api/studio/save?" + (TQ ? TQ.slice(1) : "_=1"), blob)) { auto.dirty = false; auto.lastSaved = new Date(); renderSaveState(); }
    }
  });
  window.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { if (cur) { e.preventDefault(); flushSave(function () { toast("Saved"); }); } }
    if (e.key === "Escape") { closeModal(); closePipePicker(); var ov = document.getElementById("qtest"); if (ov) ov.hidden = true; }
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
    var live = studies.filter(function (s) { return s.status === "live"; }).length;
    var html = '<div class="st-page"><div class="st-home">' +
      '<div class="st-hero"><div><h1>Your studies</h1><p>Draft questions, preview exactly what respondents see, then launch. ' +
      studies.length + " stud" + (studies.length === 1 ? "y" : "ies") + (live ? " \u00B7 " + live + " live" : "") + "</p></div>" +
      '<div class="st-hero-actions"><button class="st-btn big on" data-act="new">+ New study</button>' +
      '<button class="st-btn big" data-act="dup-beacon">Start from PROJECT BEACON</button></div></div>' +
      '<div class="st-home-tools"><input id="home-search" class="st-search" placeholder="Search studies\u2026" value="' + esc(homeSearch) + '">' +
      '<div class="st-seg">' + [["all", "All"], ["draft", "Draft"], ["live", "Live"], ["closed", "Closed"]].map(function (f) {
        return '<button class="st-seg-btn' + (homeFilter === f[0] ? " on" : "") + '" data-act="home-filter" data-f="' + f[0] + '">' + f[1] + "</button>"; }).join("") + "</div></div>" +
      '<div class="st-grid" id="home-grid">' + homeCards() + "</div></div></div>";
    root.innerHTML = html;
  }
  function homeCards() {
    var q = homeSearch.trim().toLowerCase();
    var list = studies.filter(function (s) {
      return (homeFilter === "all" || s.status === homeFilter) && (!q || (s.title + " " + s.slug).toLowerCase().indexOf(q) >= 0);
    });
    if (!list.length) return '<div class="st-empty">' + (studies.length ? "No studies match." : "No studies yet - create one to get started.") + "</div>";
    return list.map(function (s) {
      var pct = s.started ? Math.round(100 * s.complete / s.started) : 0;
      return '<div class="st-card" data-slug="' + esc(s.slug) + '">' +
        '<div class="st-card-top"><h3>' + esc(s.title) + '</h3><span class="st-pill ' + s.status + '">' + s.status + "</span></div>" +
        '<div class="st-meta">/survey/' + esc(s.slug) + " \u00B7 updated " + esc(ago(s.updated_at)) + "</div>" +
        '<div class="st-stats"><div><strong>' + s.started + "</strong><span>started</span></div><div><strong>" + s.complete + "</strong><span>complete</span></div>" +
        '<div class="st-stat-bar"><i style="width:' + pct + '%"></i></div><span class="st-meta">' + pct + "% completion</span></div>" +
        '<div class="st-card-actions">' +
        '<button class="st-btn on" data-act="open" data-slug="' + esc(s.slug) + '">Open builder</button>' +
        '<a class="st-btn" href="/survey/' + esc(s.slug) + '/test' + (TOKEN ? "?preview=" + encodeURIComponent(TOKEN) : "") + '" target="_blank" rel="noopener">Preview</a>' +
        (s.status === "live"
          ? '<button class="st-btn bad" data-act="status" data-status="closed" data-slug="' + esc(s.slug) + '">Close</button>'
          : '<button class="st-btn good" data-act="status" data-status="live" data-slug="' + esc(s.slug) + '">Launch</button>') +
        '<span class="st-more"><button class="st-ibtn" title="Duplicate" data-act="dup" data-slug="' + esc(s.slug) + '">\u2398</button>' +
        '<button class="st-ibtn" title="Copy respondent link" data-act="copylink" data-slug="' + esc(s.slug) + '">\uD83D\uDD17</button>' +
        (s.slug !== "beacon" ? '<button class="st-ibtn danger" title="Delete study" data-act="del" data-slug="' + esc(s.slug) + '">\u2715</button>' : "") +
        "</span></div></div>";
    }).join("");
  }

  // ------------------------------------------------------------ builder shell
  function openEditor(slug) {
    api("/api/studio/study?slug=" + encodeURIComponent(slug))
      .then(function (s) {
        if (s.error) { toast("Study not found: /" + slug); loadList(); return; }
        cur = s; tab = "questions"; sel = s.cfg.questions.length ? 0 : -1;
        auto.dirty = false; auto.error = null; auto.lastSaved = null;
        renderEditor();
        if (location.hash !== "#" + slug) history.replaceState(null, "", location.pathname + location.search + "#" + slug);
      });
  }

  function renderEditor() {
    var c = cur.cfg;
    var html = '<div class="st-bar">' +
      '<button class="st-btn ghost" data-act="back" title="Back to all studies">\u2190 Studies</button>' +
      '<input type="text" id="ed-title" class="st-title" value="' + esc(cur.title) + '" title="Study title">' +
      '<div class="st-status-seg" title="Draft: only the team can open it. Live: respondents can answer. Closed: no new starts.">' +
        ["draft", "live", "closed"].map(function (s) {
          return '<button class="st-status-btn ' + s + (s === cur.status ? " on" : "") + '" data-act="setstatus" data-status="' + s + '">' + s + "</button>"; }).join("") + "</div>" +
      '<div id="st-savestate" class="st-savestate"></div>' +
      '<label class="st-switch" title="Save automatically a moment after every change"><input type="checkbox" id="st-autosave"' + (auto.on ? " checked" : "") + '><i></i>Autosave</label>' +
      '<button class="st-btn" data-act="save" title="Ctrl/Cmd + S">Save now</button>' +
      '<button class="st-btn play" data-act="viewlive">\u25B6 Preview survey</button>' +
      "</div>" +
      '<nav class="st-tabs">' +
      [["questions", "Questions", c.questions.length], ["tpp", "Walkthrough", (c.explainer_scenes || []).length || ""],
       ["conjoint", "Conjoint", ""], ["settings", "Settings & QC", ""], ["responses", "Responses", ""], ["analysis", "Analysis", ""]].map(function (t) {
        return '<button class="st-tab' + (tab === t[0] ? " on" : "") + '" data-tab="' + t[0] + '">' + t[1] +
          (t[2] !== "" ? '<span class="st-count">' + t[2] + "</span>" : "") + "</button>";
      }).join("") + "</nav>" +
      '<div id="st-panel" class="st-panel-host"></div>';
    root.innerHTML = html;
    renderSaveState();
    renderTab();
  }

  function renderTab() {
    var p = document.getElementById("st-panel");
    $$(".st-tab").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === tab); });
    if (tab === "questions") { p.innerHTML = workspace(); renderOutline(); renderEditorPane(); return; }
    p.innerHTML = '<div class="st-page"><div class="st-panel">' +
      (tab === "tpp" ? tppTab() : tab === "conjoint" ? conjointTab() : tab === "settings" ? settingsTab() : "<p>Loading\u2026</p>") + "</div></div>";
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
    if (q.show_if && q.show_if.rules && q.show_if.rules.length) b += '<span class="st-badge logic" title="Shown only when its conditions are met">logic</span>';
    if (q.randomize && q.randomize !== "none") b += '<span class="st-badge" title="Randomised order">rnd</span>';
    if (q.media && q.media.src) b += '<span class="st-badge" title="Has image / video">media</span>';
    if ((q.options || []).some(function (o) { return o.exclusive; })) b += '<span class="st-badge" title="Has an exclusive option">excl</span>';
    return b;
  }
  function outlineRow(q, qi) {
    var t = tinfo(q.type);
    return '<div class="st-qi' + (qi === sel ? " on" : "") + '" data-qi="' + qi + '" data-act="qsel" tabindex="0">' +
      '<span class="st-qi-ic" title="' + esc(t.name) + '">' + t.icon + "</span>" +
      '<span class="st-qi-main"><span class="st-qi-id">' + esc(q.id) + '</span><span class="st-qi-stem">' + esc(q.stem || "(no text yet)") + "</span>" +
      '<span class="st-qi-badges">' + qBadges(q) + "</span></span>" +
      '<span class="st-qi-tools">' +
      '<button class="st-ibtn" data-act="qup" data-i="' + qi + '" title="Move up">\u25B2</button>' +
      '<button class="st-ibtn" data-act="qdown" data-i="' + qi + '" title="Move down">\u25BC</button>' +
      '<button class="st-ibtn" data-act="qdup" data-i="' + qi + '" title="Duplicate">\u2398</button>' +
      '<button class="st-ibtn danger" data-act="qdel" data-i="' + qi + '" title="Delete">\u2715</button></span></div>';
  }
  function renderOutline() {
    var host = document.getElementById("st-outline"); if (!host) return;
    var c = cur.cfg, html = '<div class="st-outline-head"><strong>Questions</strong><span class="st-meta">' + c.questions.length + " total</span></div>";
    c.sections.forEach(function (sec, si) {
      var n = c.questions.filter(function (q) { return q.section === sec.id; }).length;
      html += '<div class="st-sec"><div class="st-sec-head">' +
        '<input value="' + esc(sec.title) + '" data-sec-title="' + si + '" title="Section title (respondents see it)" placeholder="Section title">' +
        '<span class="st-meta">' + n + "</span>" +
        '<button class="st-ibtn danger" title="Delete section" data-act="delsec" data-i="' + si + '">\u2715</button></div>';
      c.questions.forEach(function (q, qi) { if (q.section === sec.id) html += outlineRow(q, qi); });
      if (!n) html += '<div class="st-sec-empty">No questions in this section yet.</div>';
      html += '<button class="st-addq" data-act="qadd" data-sec="' + esc(sec.id) + '">+ Add question</button></div>';
    });
    html += '<button class="st-btn ghost wide" data-act="addsec">+ Add section</button>';
    host.innerHTML = html;
  }
  function refreshOutlineRow() {
    var row = $('.st-qi[data-qi="' + sel + '"]'); var q = cur.cfg.questions[sel];
    if (!row || !q) return;
    $(".st-qi-id", row).textContent = q.id;
    $(".st-qi-stem", row).textContent = q.stem || "(no text yet)";
    $(".st-qi-badges", row).innerHTML = qBadges(q);
    $(".st-qi-ic", row).textContent = tinfo(q.type).icon;
  }
  function refreshSectionSelect() {
    var sl = document.getElementById("f-section"); if (!sl || !ed) return;
    sl.innerHTML = cur.cfg.sections.map(function (s) { return '<option value="' + esc(s.id) + '"' + (ed.section === s.id ? " selected" : "") + ">" + esc(s.title) + "</option>"; }).join("");
  }
  function selectQuestion(qi) {
    sel = qi;
    $$(".st-qi").forEach(function (r) { r.classList.toggle("on", Number(r.getAttribute("data-qi")) === qi); });
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
      '<button class="ex-close" data-act="modal-close" type="button">&times;</button></div>';
    GROUPS.forEach(function (g) {
      html += '<div class="st-type-group">' + g + '</div><div class="st-type-grid">';
      TYPES.filter(function (t) { return TYPE_INFO[t].group === g; }).forEach(function (t) {
        var i = TYPE_INFO[t];
        html += '<button class="st-type" data-act="qadd-type" data-type="' + t + '" data-sec="' + esc(secId) + '" data-after="' + afterQi + '">' +
          '<span class="st-type-ic">' + i.icon + '</span><span><b>' + esc(i.name) + "</b><small>" + esc(i.desc) + (i.noprev ? " \u00B7 no live preview yet" : "") + "</small></span></button>";
      });
      html += "</div>";
    });
    openModal(html, "st-typepick");
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

  // ------------------------------------------------------------ question editor pane
  var ed = null;           // live reference to cur.cfg.questions[sel]
  var OPS = [["selected", "has selected"], ["not_selected", "has not selected"],
    ["any_of", "selected any of (codes a,b)"], ["none_of", "selected none of (codes a,b)"],
    ["eq", "equals"], ["ne", "does not equal"], ["gt", "is greater than"], ["gte", "is at least"], ["lt", "is less than"], ["lte", "is at most"],
    ["contains", "answer text contains"], ["answered", "was answered"], ["not_answered", "was skipped"],
    ["row_eq", "row rating equals (row=value)"]];
  var FONTS = [["", "Default"], ["Georgia, serif", "Georgia (serif)"], ["'Times New Roman', serif", "Times New Roman"],
    ["Arial, Helvetica, sans-serif", "Arial"], ["Verdana, sans-serif", "Verdana"], ["'Trebuchet MS', sans-serif", "Trebuchet"],
    ["'Courier New', monospace", "Courier (mono)"]];
  var SIZES = [["", "Default"], ["15px", "Small"], ["19px", "Normal"], ["22px", "Large"], ["26px", "X-Large"], ["32px", "Huge"]];
  var LIST_KEY = { opt: "options", row: "rows", col: "cols" };
  var FLAG_INFO = {
    pin: { label: "\uD83D\uDCCC Pin", tip: "Keeps its place when the list is randomised" },
    exclusive: { label: "\u2298 Exclusive", tip: "Selecting it clears every other answer - for None / Not applicable" },
    other: { label: "\u270E Other", tip: "Adds a free-text box next to this option" }
  };

  function hasOptions(t) { return t === "single_select" || t === "multi_select"; }
  function hasRows(t) { return ["rating_grid", "semantic_diff", "sum_to_100", "rank", "emoji_grid", "heatmap"].indexOf(t) >= 0; }

  function card(id, title, hint, body, collapsed) {
    return '<details class="st-ecard" id="card-' + id + '"' + (collapsed ? "" : " open") + '><summary><span>' + title + "</span>" +
      (hint ? '<small>' + hint + "</small>" : "") + "</summary><div class=\"st-ecard-body\">" + body + "</div></details>";
  }
  function rerenderCard(id) {
    var c = document.getElementById("card-" + id); if (!c) return;
    var body = $(".st-ecard-body", c);
    var fn = { q: qCard, answers: answersCard, display: displayCard, logic: logicCard, media: mediaCard, advanced: advancedCard }[id];
    if (fn) body.innerHTML = fn();
    if (id === "logic" || id === "media") { var sm = $("summary span", c); if (sm) sm.innerHTML = (id === "logic" ? "Show only when\u2026" : "Image or video") + (isOn(id) ? ' <em class="st-dot">on</em>' : ""); }
  }
  function isOn(id) { return id === "logic" ? !!(ed.show_if && ed.show_if.rules && ed.show_if.rules.length) : !!(ed.media && ed.media.src); }
  function answersTitle() {
    var t = ed.type;
    return hasOptions(t) ? "Answer options" : hasRows(t) ? "Rows & scale" : t === "open_text" ? "Text box" :
      t === "numeric" || t === "slider" ? "Number range" : t === "nps" ? "Scale" : t === "maxdiff" ? "Rounds" : t === "choice_task" ? "Choice task" : "Settings";
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
          '<label class="st-mini">ID <input id="f-id" value="' + esc(ed.id) + '" title="Short reference used in exports and piping, e.g. Q3"></label>' +
          '<label class="st-mini">Type <select id="f-type" title="Change the question type - compatible answers are kept">' + GROUPS.map(function (g) {
            return '<optgroup label="' + g + '">' + TYPES.filter(function (x) { return TYPE_INFO[x].group === g; }).map(function (x) {
              return '<option value="' + x + '"' + (x === ed.type ? " selected" : "") + ">" + esc(TYPE_INFO[x].name) + "</option>"; }).join("") + "</optgroup>"; }).join("") + "</select></label>" +
          '<label class="st-mini">Section <select id="f-section">' + cur.cfg.sections.map(function (s) {
            return '<option value="' + esc(s.id) + '"' + (ed.section === s.id ? " selected" : "") + ">" + esc(s.title) + "</option>"; }).join("") + "</select></label>" +
          '<label class="st-switch" title="Respondents must answer before continuing"><input type="checkbox" id="f-required"' + (ed.required !== false ? " checked" : "") + "><i></i>Required</label>" +
        "</div></div>" +
        '<div class="st-ehead-tools"><button class="st-ibtn" data-act="qdup" data-i="' + sel + '" title="Duplicate question">\u2398</button>' +
        '<button class="st-ibtn danger" data-act="qdel" data-i="' + sel + '" title="Delete question">\u2715</button></div>' +
      "</div>" +
      '<nav class="st-jump">' + [["q", "Question"], ["answers", answersTitle()], ["display", "Display & order"], ["logic", "Show only when\u2026"], ["media", "Image / video"], ["advanced", "Advanced"]].map(function (j) {
        return '<a href="#card-' + j[0] + '" data-act="jump" data-card="' + j[0] + '">' + j[1] + "</a>"; }).join("") + "</nav>" +
      card("q", "Question", "What respondents read", qCard()) +
      card("answers", answersTitle(), "", answersCard()) +
      card("display", "Display & order", "Layout, randomisation, text style", displayCard()) +
      card("logic", "Show only when\u2026" + (ed.show_if && ed.show_if.rules && ed.show_if.rules.length ? ' <em class="st-dot">on</em>' : ""), "Conditions that decide who sees this question", logicCard()) +
      card("media", "Image or video" + (ed.media && ed.media.src ? ' <em class="st-dot">on</em>' : ""), "Shown under the question text", mediaCard()) +
      card("advanced", "Advanced (JSON)", "Everything the form does is stored here", advancedCard(), true);
    renderPreview();
  }

  // ---- card: question text -------------------------------------------------------------
  function qCard() {
    return '<div class="st-field"><label>Question text</label>' + richToolbar("f-stem-rich") +
      '<div class="st-rich" id="f-stem-rich" contenteditable="true" data-rich="stem_html" data-placeholder="Type the question\u2026">' + chipify(Q.sanitize(ed.stem_html || "")) + "</div>" +
      '<div class="st-hint">Select text to format it. <b>\u27A4 Pipe in answer</b> inserts something the respondent said earlier - e.g. <code>{Q1}</code> becomes their Q1 answer.</div></div>' +
      '<div class="st-field"><label>Help text <span class="st-opt">optional - smaller text under the question</span></label>' + richToolbar("f-help-rich", true) +
      '<div class="st-rich sm" id="f-help-rich" contenteditable="true" data-rich="help_html" data-placeholder="e.g. Think about the last 3 months">' + chipify(Q.sanitize(ed.help_html || esc(ed.help || ""))) + "</div></div>";
  }

  function richToolbar(target, small) {
    var b = function (cmd, label, title, val) {
      return '<button type="button" class="st-tb" data-cmd="' + cmd + '" data-val="' + (val || "") + '" data-target="' + target + '" title="' + title + '">' + label + "</button>";
    };
    return '<div class="st-toolbar">' +
      b("bold", "<b>B</b>", "Bold") + b("italic", "<i>I</i>", "Italic") + b("underline", "<u>U</u>", "Underline") +
      b("strikeThrough", "<s>S</s>", "Strikethrough") + b("superscript", "x<sup>2</sup>", "Superscript") +
      '<span class="st-tb-sep"></span>' +
      '<label class="st-tb st-tb-color" title="Text colour">A<input type="color" data-cmd="foreColor" data-target="' + target + '" value="#b3261e"></label>' +
      '<label class="st-tb st-tb-color hl" title="Highlight colour">&#9639;<input type="color" data-cmd="hiliteColor" data-target="' + target + '" value="#fff3a3"></label>' +
      b("removeFormat", "T&#818;", "Clear formatting") +
      '<span class="st-tb-sep"></span>' +
      b("insertUnorderedList", "&#8226; list", "Bulleted list") + b("insertOrderedList", "1. list", "Numbered list") +
      (small ? "" : b("fontSize", "A&#8593;", "Bigger", "5") + b("fontSize", "A&#8595;", "Smaller", "2")) +
      '<span class="st-tb-sep"></span>' +
      pipeButton(target) +
      "</div>";
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

  function pipeButton(target, small) {
    return '<button type="button" class="st-pipe-btn' + (small ? " sm" : "") + '" data-pipe-for="' + target + '" title="Insert an earlier answer into this text">' +
      '&#10132; Pipe in answer</button>';
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
  function itemTable(kind, items, spec) {
    var html = '<div class="st-items" data-kind="' + kind + '">' +
      '<div class="st-item st-item-head"><span></span><span>Code</span><span>' + (spec.labelHead || "Label") + "</span>" +
      (spec.left ? "<span>Left pole</span><span>Right pole</span>" : "") + (spec.flags.length ? "<span>Behaviour</span>" : "") + "<span></span></div>" +
      items.map(function (it, i) {
        var idl = "f-" + kind + "-" + i;
        return '<div class="st-item" data-i="' + i + '"><span class="st-grip" title="Use the arrows to reorder">\u22EE\u22EE</span>' +
          '<input class="st-it-code" data-it="' + kind + '" data-k="code" data-i="' + i + '" value="' + esc(it.code) + '" title="Code stored in the data">' +
          '<div class="st-with-pipe"><input id="' + idl + '" data-it="' + kind + '" data-k="label" data-i="' + i + '" value="' + esc(it.label) + '" placeholder="' + esc(spec.ph || "Label") + '">' + pipeButton(idl, true) + "</div>" +
          (spec.left ? '<input data-it="' + kind + '" data-k="left" data-i="' + i + '" value="' + esc(it.left || "") + '" placeholder="e.g. Poor">' +
                       '<input data-it="' + kind + '" data-k="right" data-i="' + i + '" value="' + esc(it.right || "") + '" placeholder="e.g. Excellent">' : "") +
          (spec.flags.length ? '<span class="st-flags">' + spec.flags.map(function (f) {
            return '<label class="st-flag' + (it[f] ? " on" : "") + '" title="' + FLAG_INFO[f].tip + '"><input type="checkbox" data-it="' + kind + '" data-k="' + f + '" data-i="' + i + '"' + (it[f] ? " checked" : "") + ">" + FLAG_INFO[f].label + "</label>"; }).join("") + "</span>" : "") +
          '<span class="st-item-tools">' +
          (spec.image ? (it.image ? '<span class="st-thumb" title="' + esc(it.image.split("/").pop()) + '"><img src="' + esc(it.image) + '" alt=""><button class="st-x" data-act="it-img-del" data-i="' + i + '" title="Remove image">&times;</button></span>'
            : '<label class="st-ibtn" title="Attach an image">\uD83D\uDDBC<input type="file" accept="image/*" data-act="opt-img" data-oi="' + i + '" hidden></label>') : "") +
          '<button class="st-ibtn" data-act="it-up" data-kind="' + kind + '" data-i="' + i + '" title="Move up">\u25B2</button>' +
          '<button class="st-ibtn" data-act="it-down" data-kind="' + kind + '" data-i="' + i + '" title="Move down">\u25BC</button>' +
          '<button class="st-ibtn danger" data-act="it-del" data-kind="' + kind + '" data-i="' + i + '" title="Remove">\u2715</button></span></div>';
      }).join("") + "</div>" +
      '<div class="st-item-actions"><button class="st-btn sm on" data-act="it-add" data-kind="' + kind + '">+ Add ' + spec.noun + "</button>" +
      (spec.quick || "") +
      '<button class="st-btn sm ghost" data-act="it-paste" data-kind="' + kind + '">Paste a list\u2026</button></div>';
    return html;
  }
  function answersCard() {
    var t = ed.type, html = "";
    if (hasOptions(t)) {
      html += itemTable("opt", ed.options || [], { noun: "option", flags: ["pin", "exclusive", "other"], image: true, ph: "Option label",
        quick: '<button class="st-btn sm" data-act="opt-add-none">+ None of these</button><button class="st-btn sm" data-act="opt-add-na">+ Not applicable</button><button class="st-btn sm" data-act="opt-add-other">+ Other (specify)</button>' });
      html += '<div class="st-hint"><b>Pin</b> keeps an option in place when the list is shuffled \u00B7 <b>Exclusive</b> clears the other answers (None / N/A) \u00B7 <b>Other</b> adds a text box.</div>';
      if (t === "multi_select") html += '<div class="st-grid2"><div class="st-field"><label>Maximum they may tick <span class="st-opt">blank = no limit</span></label><input id="f-maxselect" type="number" min="1" value="' + (ed.max_select || "") + '"></div></div>';
    }
    if (hasRows(t)) {
      html += itemTable("row", ed.rows || [], { noun: "row", flags: ["pin"], left: t === "semantic_diff", ph: t === "rank" ? "Item to rank" : "Row / statement", labelHead: t === "rank" ? "Item" : "Row" });
      if (t === "heatmap") html += '<h4 class="st-h4">Columns</h4>' + itemTable("col", ed.cols || [], { noun: "column", flags: [], ph: "Column label" });
    }
    if (t === "rating_grid" || t === "semantic_diff" || t === "nps") {
      var sc = ed.scale || {};
      html += '<h4 class="st-h4">Scale</h4><div class="st-grid4">' +
        '<div class="st-field"><label>From</label><input id="f-smin" type="number" value="' + (sc.min != null ? sc.min : 1) + '"></div>' +
        '<div class="st-field"><label>To</label><input id="f-smax" type="number" value="' + (sc.max != null ? sc.max : 7) + '"></div>' +
        '<div class="st-field"><label>Low-end label</label><input id="f-sminl" value="' + esc(sc.min_label || "") + '" placeholder="e.g. Not at all"></div>' +
        '<div class="st-field"><label>High-end label</label><input id="f-smaxl" value="' + esc(sc.max_label || "") + '" placeholder="e.g. Extremely"></div></div>';
    }
    if (t === "numeric" || t === "slider") {
      html += '<div class="st-grid4"><div class="st-field"><label>Minimum</label><input id="f-min" type="number" value="' + (ed.min != null ? ed.min : 0) + '"></div>' +
        '<div class="st-field"><label>Maximum</label><input id="f-max" type="number" value="' + (ed.max != null ? ed.max : 100) + '"></div>' +
        (t === "slider" ? '<div class="st-field"><label>Step</label><input id="f-step" type="number" value="' + (ed.step || 1) + '"></div>' : "") +
        '<div class="st-field"><label>Prefix <span class="st-opt">e.g. $</span></label><input id="f-prefix" value="' + esc(ed.prefix || "") + '"></div>' +
        '<div class="st-field"><label>Suffix <span class="st-opt">e.g. %</span></label><input id="f-suffix" value="' + esc(ed.suffix || "") + '"></div></div>';
    }
    if (t === "open_text") {
      html += '<div class="st-grid2"><div class="st-field"><label>Minimum words</label><input id="f-minwords" type="number" value="' + (ed.min_words || 3) + '"></div>' +
        '<div class="st-field"><label>Placeholder <span class="st-opt">grey text inside the empty box</span></label><div class="st-with-pipe"><input id="f-placeholder" value="' + esc(ed.placeholder || "") + '">' + pipeButton("f-placeholder", true) + "</div></div></div>";
    }
    if (t === "rank") html += '<div class="st-grid2"><div class="st-field"><label>How many ranks to record <span class="st-opt">top-N</span></label><input id="f-rankcount" type="number" value="' + (ed.rank_count || 3) + '"></div></div>';
    if (t === "maxdiff") html += '<div class="st-field"><label>Rounds <span class="st-opt">comma-separated item codes, one round per line</span></label><textarea id="f-rounds">' +
      (ed.rounds || []).map(function (r) { return r.items.join(","); }).join("\n") + "</textarea></div>";
    if (t === "choice_task") html += '<div class="st-field"><label>Patient vignette</label><textarea id="f-vignette">' + esc(ed.vignette || "") + "</textarea></div>" +
      '<div class="st-note">The alternatives shown come from the design on the <b>Conjoint</b> tab.</div>';
    return html || '<div class="st-note">This question type has no answer settings.</div>';
  }

  // ---- card: display & order -------------------------------------------------------------
  function displayCard() {
    var t = ed.type, st = ed.style || {}, html = "";
    if (hasOptions(t)) {
      var lay = ed.layout || (t === "multi_select" ? "grid" : "list");
      html += '<div class="st-field"><label>Layout</label><div class="st-seg" id="f-layout-seg">' + [["list", "\u2630 List"], ["grid", "\u25A6 Two columns"], ["inline", "\u25AD Chips"]].map(function (l) {
        return '<button type="button" class="st-seg-btn' + (lay === l[0] ? " on" : "") + '" data-act="set-layout" data-v="' + l[0] + '">' + l[1] + "</button>"; }).join("") + "</div></div>";
    }
    if (hasOptions(t) || hasRows(t)) html += randomizeBlock(hasOptions(t) ? "options" : "rows");
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
  function logicCard() {
    var c = cur.cfg, sif = ed.show_if || { match: "all", rules: [] };
    var others = c.questions.filter(function (q) { return q.id !== ed.id && q.type !== "choice_task"; });
    var idx = c.questions.indexOf(ed);
    var rules = sif.rules || [];
    var html = '<div class="st-logic-intro">' + (rules.length
      ? 'Show this question <b>only when</b> <select id="f-sif-match"><option value="all"' + (sif.match !== "any" ? " selected" : "") + '>all</option><option value="any"' + (sif.match === "any" ? " selected" : "") + '>any</option></select> of these are true:'
      : "<b>Always shown.</b> Add a condition to show it only to some respondents - e.g. only those who chose \u201COncology\u201D in Q1.") + "</div>";
    html += '<div id="f-rules">' + rules.map(function (r, i) {
      var q = others.filter(function (x) { return x.id === r.q; })[0];
      var valField;
      if (q && q.options && ["selected", "not_selected", "eq", "ne"].indexOf(r.op) >= 0) {
        valField = '<select data-rule="value" data-ri="' + i + '">' + q.options.map(function (o) {
          return '<option value="' + esc(o.code) + '"' + (String(o.code) === String(r.value) ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("") + "</select>";
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

  // ---- card: media -----------------------------------------------------------------------
  function mediaCard() {
    var m = ed.media || {};
    return '<div class="st-media-row">' +
      (m.src ? '<div class="st-media-cur">' + (m.kind === "video" ? '<video src="' + esc(m.src) + '" controls></video>' : '<img src="' + esc(m.src) + '" alt="">') +
        '<div><code>' + esc(m.src.split("/").pop()) + '</code><br><button class="st-btn sm danger" data-act="media-del">Remove</button></div></div>' : "") +
      '<div class="st-media-pick"><label class="st-upload big">\u2B06 ' + (m.src ? "Replace" : "Upload") + ' image or video<input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" data-act="media-upload" hidden></label>' +
      '<div class="st-meta">png, jpg, gif, webp, svg, mp4, webm, mov \u00B7 max 10 MB</div>' +
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
      '<span class="st-meta">Fields: stem_html, help_html, style, options[].exclusive/pin/other/image, randomize, show_if, media, layout, hide_codes, hide_number.</span></div></div>';
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
    if (val("f-section") !== undefined) ed.section = val("f-section");
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
    if (t === "rating_grid" || t === "semantic_diff" || t === "nps") {
      if (val("f-smin") !== undefined) {
        ed.scale = ed.scale || {}; ed.scale.min = num("f-smin") != null ? num("f-smin") : 1; ed.scale.max = num("f-smax") != null ? num("f-smax") : 7;
        setOrDel(ed.scale, "min_label", val("f-sminl")); setOrDel(ed.scale, "max_label", val("f-smaxl"));
      }
    }
    if ((t === "numeric" || t === "slider") && val("f-min") !== undefined) { ed.min = num("f-min"); ed.max = num("f-max"); setOrDel(ed, "step", num("f-step")); setOrDel(ed, "prefix", val("f-prefix")); setOrDel(ed, "suffix", val("f-suffix")); }
    if (t === "open_text" && val("f-minwords") !== undefined) { setOrDel(ed, "min_words", num("f-minwords")); setOrDel(ed, "placeholder", val("f-placeholder")); }
    if (t === "rank" && val("f-rankcount") !== undefined) setOrDel(ed, "rank_count", num("f-rankcount"));
    if (t === "maxdiff" && val("f-rounds") !== undefined) ed.rounds = String(val("f-rounds")).split("\n").filter(function (l) { return l.trim(); }).map(function (l) { return { items: l.split(",").map(function (x) { return x.trim(); }).filter(Boolean) }; });
    if (t === "choice_task" && val("f-vignette") !== undefined) ed.vignette = val("f-vignette");
    // logic
    if (document.getElementById("f-rules")) {
      var rules = [];
      $$("#f-rules .st-rule").forEach(function (row) {
        var r = {};
        $$("[data-rule]", row).forEach(function (n) { r[n.getAttribute("data-rule")] = n.value; });
        if (r.q && r.op) rules.push(r);
      });
      if (rules.length) { ed.show_if = { match: val("f-sif-match") || (ed.show_if && ed.show_if.match) || "all", rules: rules }; if (chk("f-sif-negate")) ed.show_if.negate = true; }
      else delete ed.show_if;
    }
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
  // form -> question -> autosave + preview + outline row
  function changed() { syncFromForm(); markChanged(); renderPreview(); refreshOutlineRow(); }

  function applyId(input) {
    var id = input.value.trim();
    if (!id) { input.value = ed.id; return; }
    if (cur.cfg.questions.some(function (q) { return q !== ed && q.id === id; })) { toast("Another question already uses id " + id); input.value = ed.id; input.classList.add("bad"); setTimeout(function () { input.classList.remove("bad"); }, 1200); return; }
    if (id !== ed.id) { ed.id = id; markChanged(); refreshOutlineRow(); renderPreview(); }
  }
  function convertType(newType) {
    var old = ed, fresh = qTemplate(newType, old.id, old.section);
    ["stem", "stem_html", "help", "help_html", "required", "show_if", "media", "style", "hide_number", "randomize"].forEach(function (k) { if (old[k] !== undefined) fresh[k] = old[k]; });
    if (hasOptions(newType) && old.options) fresh.options = old.options;
    if (hasRows(newType) && old.rows) fresh.rows = old.rows;
    if (old.scale && fresh.scale) fresh.scale = Object.assign(fresh.scale, old.scale);
    cur.cfg.questions[sel] = fresh; markChanged(); renderOutline(); renderEditorPane();
    toast("Changed to " + tinfo(newType).name);
  }

  function uploadMedia(file, cb) {
    var fd = new FormData(); fd.append("file", file, file.name);
    toast("Uploading " + file.name + "\u2026");
    fetch("/api/studio/media?study=" + encodeURIComponent(cur.slug) + TQ, { method: "POST", body: fd, credentials: "same-origin" })
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
    var pb = e.target.closest("[data-pipe-for]");
    if (pb) { e.preventDefault(); openPipePicker(document.getElementById(pb.getAttribute("data-pipe-for"))); return; }
    var pi = e.target.closest(".st-pipe-item");
    if (pi) { insertPipe(pi.getAttribute("data-token")); return; }
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act"), i = Number(b.getAttribute("data-i")), kind = b.getAttribute("data-kind"), ri = Number(b.getAttribute("data-ri"));
    if (act === "pipe-close") { closePipePicker(); return; }
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
      syncFromForm(); var L = ed[LIST_KEY[kind]], j = act === "it-up" ? i - 1 : i + 1;
      if (j < 0 || j >= L.length) return;
      var tmp = L[j]; L[j] = L[i]; L[i] = tmp; rerenderCard("answers"); changed(); return;
    }
    if (act === "it-img-del") { syncFromForm(); delete ed.options[i].image; rerenderCard("answers"); changed(); return; }
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
      ed.show_if = ed.show_if || { match: "all", rules: [] };
      ed.show_if.rules.push({ q: q0.id, op: q0.options ? "selected" : "answered", value: q0.options ? q0.options[0].code : "" });
      rerenderCard("logic"); changed(); return;
    }
    if (act === "rule-del") { syncFromForm(); ed.show_if.rules.splice(ri, 1); if (!ed.show_if.rules.length) delete ed.show_if; rerenderCard("logic"); changed(); return; }
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
    if (act === "opt-img" && t.files && t.files[0]) {
      var oi = Number(t.getAttribute("data-oi"));
      uploadMedia(t.files[0], function (r) { syncFromForm(); ed.options[oi].image = r.src; rerenderCard("answers"); changed(); });
      return;
    }
    if (t.id === "f-id") { applyId(t); return; }
    if (t.id === "f-type") { if (t.value !== ed.type) convertType(t.value); return; }
    if (t.id === "f-section") { changed(); renderOutline(); return; }
    if (t.getAttribute("data-rule") === "q" || t.getAttribute("data-rule") === "op" || t.id === "f-sif-match") { syncFromForm(); rerenderCard("logic"); changed(); return; }
    if (t.name === "f-rz") { $$("#st-editor .st-radio").forEach(function (l) { l.classList.toggle("on", l.querySelector("input").checked); }); }
    if (t.closest(".st-flag")) t.closest(".st-flag").classList.toggle("on", t.checked);
    if (t.type === "checkbox" && t.closest(".st-flag")) { changed(); return; }
    changed();
  });
  root.addEventListener("input", function (e) {
    if (!inEditor(e) || !ed) return;
    if (e.target.id === "f-raw" || e.target.id === "f-id" || e.target.classList.contains("st-pipe-search")) return;
    changed();
  });
  root.addEventListener("keydown", function (e) {
    if (e.target.id === "f-id" && e.key === "Enter") { e.preventDefault(); applyId(e.target); }
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
    if (act === "qadd-type") addQuestion(b.getAttribute("data-type"), b.getAttribute("data-sec"), Number(b.getAttribute("data-after")));
    if (act === "ask-ok") { var v = (document.getElementById("st-ask") || {}).value; closeModal(); if (askCb) askCb(v); askCb = null; }
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
    fetch("/api/studio/narration?study=" + encodeURIComponent(cur.slug) + TQ, { method: "POST", body: fd, credentials: "same-origin" })
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
    var cj = cur.cfg.conjoint;
    var attrs = cj ? cj.attributes : [];
    return '<div class="st-page-head"><h2>Conjoint design</h2><p>Define attributes with three levels each, then generate a balanced best-worst-safe design. ' +
      "A <b>choice task</b> question is added to the last section if the study has none.</p></div>" +
      '<div class="st-field"><label>Attributes <span class="st-opt">one per line: id | label | level 1 | level 2 | level 3 | higher_is_bad 0/1</span></label>' +
      '<textarea id="f-attrs" style="min-height:140px;font-family:ui-monospace,monospace;font-size:12.5px">' +
      (attrs.map(function (a) { return a.id + "|" + (a.label || a.id) + "|" + a.levels.join("|") + "|" + (a.higher_is_bad ? 1 : 0); }).join("\n") ||
        "OS|Overall survival|no proven benefit|+3 months|+6 months|0") + "</textarea></div>" +
      '<div class="st-grid2"><div class="st-field"><label>Choice tasks per respondent</label><input id="f-ntasks" type="number" value="' + (cj ? cj.n_tasks : 9) + '"></div>' +
      '<div class="st-field"><label>Minimum seconds on each task <span class="st-opt">speeder guard</span></label><input id="f-dwell" type="number" data-set="conjoint_min_dwell" value="' + (cur.cfg.conjoint_min_dwell || 10) + '"></div></div>' +
      '<div class="st-field"><label>Patient vignette shown with the choice tasks</label><textarea id="f-cvignette" data-set="vignette">' + esc((cur.cfg.conjoint_scene && cur.cfg.vignette) || cur.cfg.vignette || "") + "</textarea></div>" +
      '<button class="st-btn on" data-act="genconj">Generate design</button>' +
      (cj ? '<div class="st-note">Current design: <b>' + cj.n_tasks + " tasks</b> \u00D7 " + (cj.tasks && cj.tasks[0] ? cj.tasks[0].length : 3) + " alternatives over " + attrs.length + " attributes.</div>" : "");
  }
  function settingsTab() {
    var c = cur.cfg, qc = c.qc || {}, m = c.metrics || {};
    var f = function (id, label, hint, value, ph, type) {
      return '<div class="st-field"><label>' + label + (hint ? ' <span class="st-opt">' + hint + "</span>" : "") + '</label><input id="' + id + '" data-set="1"' + (type ? ' type="' + type + '"' : "") + ' value="' + esc(value == null ? "" : value) + '"' + (ph ? ' placeholder="' + ph + '"' : "") + "></div>";
    };
    return '<div class="st-page-head"><h2>Settings & quality control</h2><p>Links, speeder limits and the automatic data-quality flags applied to every respondent.</p></div>' +
      '<div class="st-grid2">' +
      '<div class="st-field"><label>Respondent link</label><div class="st-linkbox"><code>/survey/' + esc(cur.slug) + '</code><button class="st-btn sm" data-act="copylink" data-slug="' + esc(cur.slug) + '">Copy</button></div>' +
      '<div class="st-meta">Test link (not counted as real data): <code>/survey/' + esc(cur.slug) + "/test</code></div></div>" +
      f("f-minsec", "Minimum time to complete", "seconds - faster respondents are flagged as speeders", qc.min_seconds || 300, "", "number") +
      "</div>" +
      '<h4 class="st-h4">Quality flags</h4><div class="st-grid2">' +
      f("f-attq", "Attention-check question id", "", qc.attention_q, "e.g. Q13") +
      f("f-attok", "\u2026correct answer code", "", qc.attention_ok, "e.g. 2") +
      f("f-strq", "Straight-lining check", "id of a rating grid", qc.straightline_q, "e.g. Q7") +
      f("f-uniq", "Uniform conjoint choices", "id of the choice task", qc.uniform_q, "e.g. CT1") +
      f("f-verb", "Verbatim quality checks", "open-text ids, comma separated", (qc.verbatim_qs || []).join(", "), "e.g. Q20, Q21") +
      "</div>" +
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
      c.metrics = c.metrics || {};
      setOrDel(c.metrics, "intent_q", (val("f-m1") || "").trim()); setOrDel(c.metrics, "pct_q", (val("f-m2") || "").trim()); setOrDel(c.metrics, "wtp_q", (val("f-m3") || "").trim());
    }
    if (val("f-dwell") !== undefined) c.conjoint_min_dwell = num("f-dwell") || 10;
    if (val("f-cvignette") !== undefined) c.vignette = val("f-cvignette");
  }

  // ------------------------------------------------------------ responses / analysis
  function responsesTab(p) {
    api("/api/admin/data?study=" + encodeURIComponent(cur.slug) + "&scope=all")
      .then(function (d) {
        var html = '<div class="st-page-head"><h2>Responses</h2><p>Everyone who has started this study, with their QC flags. Full dashboards live in <a href="/admin/?study=' + esc(cur.slug) + (TOKEN ? "&token=" + encodeURIComponent(TOKEN) : "") + '">Admin</a>.</p></div>' +
          '<div class="st-kpis">' + kpi(d.counts.total, "started") + kpi(d.counts.complete, "complete") + kpi(d.counts.screened_out, "screened out") + kpi(d.counts.in_progress, "in progress") + "</div>" +
          '<div class="st-row" style="margin-bottom:12px">' +
          '<a class="st-btn" href="/admin/export.xlsx?study=' + cur.slug + "&scope=all" + TQ + '">Excel (all)</a>' +
          '<a class="st-btn" href="/admin/export.csv?study=' + cur.slug + "&scope=all" + TQ + '">CSV</a>' +
          '<a class="st-btn" href="/admin/export.json?study=' + cur.slug + "&scope=all" + TQ + '">JSON</a>' +
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
    fetch("/api/studio/analysis?study=" + encodeURIComponent(cur.slug) + TQ, { credentials: "same-origin" })
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
              return "<tr><td>" + esc(row.label) + "</td><td>" + (row.mean == null ? "\u2013" : m) + '</td><td><div class="st-bar"><i style="width:' + Math.min(100, m * 14) + '%"></i></div></td></tr>';
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

  // ------------------------------------------------------------ study-level events
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
    var i = Number(b.getAttribute("data-i"));

    if (act === "new") createStudy(blankCfg());
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
    if (act === "dup") {
      api("/api/studio/study?slug=" + slug).then(function (s) {
        var cfg = JSON.parse(JSON.stringify(s.cfg)); cfg.title = s.title + " (copy)";
        api("/api/studio/save", { slug: "", title: cfg.title, cfg: cfg }).then(function (r) { toast("Duplicated as /" + r.slug); loadList(); });
      });
    }
    if (act === "copylink") copyLink(slug || cur.slug);
    if (act === "del") {
      if (confirm("Delete study /" + slug + " and all of its responses? This cannot be undone.")) api("/api/studio/delete", { slug: slug }).then(function () { loadList(); });
    }
    if (act === "save") { if (tab === "settings" || tab === "conjoint") readSettings(); auto.dirty = true; flushSave(function () { toast("Saved"); }); }
    if (act === "viewlive") {
      var w = window.open("", "_blank");
      var url = "/survey/" + cur.slug + "/test" + (TOKEN ? "?preview=" + encodeURIComponent(TOKEN) : "");
      flushSave(function () { if (w) w.location = url; else window.open(url, "_blank"); });
    }
    if (act === "addsec") {
      var n = cur.cfg.sections.length + 1, id = "S" + n;
      while (cur.cfg.sections.some(function (s) { return s.id === id; })) id += "b";
      cur.cfg.sections.push({ id: id, title: "Section " + n, blurb: null });
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
      var copy = JSON.parse(JSON.stringify(cur.cfg.questions[i])); copy.id = nextQid();
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
    if (act === "genconj") {
      var attrs = String(document.getElementById("f-attrs").value).split("\n").filter(function (l) { return l.trim(); }).map(function (l) {
        var p = l.split("|");
        return { id: p[0].trim(), label: (p[1] || p[0]).trim(), levels: [p[2] || "low", p[3] || "mid", p[4] || "high"], higher_is_bad: p[5] === "1" };
      });
      api("/api/studio/make_conjoint", { attributes: attrs, n_tasks: Number(document.getElementById("f-ntasks").value) || 9, seed: 7 }).then(function (d) {
        if (d.error) { toast("Design failed: " + d.error); return; }
        cur.cfg.conjoint = {
          attributes: d.attributes.map(function (id) { return { id: id, levels: d.levels[id] }; }),
          tasks: d.tasks.map(function (task) { return task.map(function (p, k) { return { alt_id: k + 1, levels: p }; }); }),
          n_tasks: d.n_tasks, has_opt_out: true
        };
        readSettings();
        if (!cur.cfg.questions.some(function (q) { return q.type === "choice_task"; })) {
          var q = qTemplate("choice_task", "CT1", cur.cfg.sections[cur.cfg.sections.length - 1].id);
          q.vignette = cur.cfg.vignette; cur.cfg.questions.push(q);
        }
        markChanged(); renderTab();
        toast("Design generated: " + d.n_tasks + " balanced tasks");
      });
    }
    if (act === "reset") {
      if (confirm("Reset " + b.getAttribute("data-scope") + " responses for /" + cur.slug + "?")) {
        fetch("/admin/reset?study=" + cur.slug + "&scope=" + b.getAttribute("data-scope") + TQ, { method: "POST", credentials: "same-origin" })
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
