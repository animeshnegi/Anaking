/* BEACON Studio - multi-study survey builder. */
(function () {
  "use strict";
  var TOKEN = (location.search.match(/token=([^&]+)/) || [])[1] || "";
  var root = document.getElementById("st-root");
  var drawer = document.getElementById("st-drawer");
  var cur = null;          // {slug,title,status,cfg}
  var tab = "questions";

  function api(path, body) {
    var sep = path.indexOf("?") < 0 ? "?" : "&";
    return fetch(path + sep + "token=" + encodeURIComponent(TOKEN), {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function toast(msg) {
    var t = document.getElementById("st-toast");
    t.textContent = msg;
    t.hidden = false;
    setTimeout(function () { t.hidden = true; }, 2600);
  }
  function scenesFromTpp(t) {
    t = t || {};
    return [
      { id: "patient", clip: null, at: 0, title: "The patient in front of you", caption: t.patient || "" },
      { id: "trial", clip: null, at: 0, title: "The pivotal trial", caption: t.trial || "" },
      { id: "mechanism", clip: null, at: 0, title: "Mechanism of action", caption: t.mechanism || "" },
      { id: "efficacy", clip: null, at: 0, title: "Headline efficacy", caption: t.efficacy || "" },
      { id: "safety", clip: null, at: 0, title: "Safety at a glance", caption: t.safety || "" },
      { id: "cdx", clip: null, at: 0, title: "Companion diagnostic", caption: t.cdx || "" }
    ];
  }

  // ------------------------------------------------------------ question templates
  var TYPES = ["single_select", "multi_select", "numeric", "slider", "open_text",
    "rating_grid", "semantic_diff", "sum_to_100", "rank", "nps", "emoji_grid",
    "heatmap", "maxdiff", "choice_task"];

  function qTemplate(type, id, secId) {
    var q = { id: id, section: secId, type: type, required: true,
              stem: "New " + type.replace(/_/g, " ") + " question" };
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
      q.scale = { min: 1, max: 5, faces: ["😞", "", "😐", "🙂", "😍"],
                  face_labels: ["Very negative", "Negative", "Neutral", "Positive", "Delighted"] };
      q.rows = [{ code: "a", label: "First impression" }];
    }
    if (type === "heatmap") {
      q.rows = [{ code: "a", label: "First row" }];
      q.cols = [{ code: "c1", label: "Column one" }, { code: "c2", label: "Column two" }];
      q.heat_max = 3;
    }
    if (type === "maxdiff") {
      q.rounds = [{ items: ["a", "b", "c", "d"] }];
    }
    if (type === "choice_task") { q.vignette = "Describe the patient here."; }
    return q;
  }

  function blankCfg() {
    return {
      title: "New study",
      sections: [{ id: "S1", title: "Introduction", blurb: null },
                 { id: "S2", title: "Main questions", blurb: null }],
      questions: [
        qTemplate("single_select", "N1", "S1"),
        qTemplate("rating_grid", "N2", "S2"),
        qTemplate("nps", "N3", "S2"),
        qTemplate("open_text", "N4", "S2")
      ],
      tpp: { patient: "", mechanism: "", trial: "", efficacy: "", safety: "",
             administration: "", cdx: "" },
      narration: {},
      explainer_scenes: scenesFromTpp({}),
      conjoint_scene: null,
      conjoint: null,
      conjoint_min_dwell: 10,
      use_tts: true,
      metrics: {},
      qc: { min_seconds: 300, verbatim_qs: [] }
    };
  }

  // ------------------------------------------------------------ list view
  function loadList() {
    api("/api/studio/list").then(function (list) {
      cur = null;
      var html = '<div class="st-grid">';
      list.forEach(function (s) {
        html += '<div class="st-card">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:start">' +
          "<h3>" + esc(s.title) + '</h3><span class="st-pill ' + s.status + '">' + s.status +
          "</span></div>" +
          '<div class="st-meta">/' + esc(s.slug) + " &middot; " + s.started + " started, " +
          s.complete + " complete &middot; updated " + esc(s.updated_at || "") + "</div>" +
          '<div class="st-card-actions">' +
          '<button class="st-btn" data-act="open" data-slug="' + esc(s.slug) + '">Open builder</button>' +
          (s.status === "live"
            ? '<button class="st-btn bad" data-act="status" data-status="closed" data-slug="' + esc(s.slug) + '">Close</button>'
            : '<button class="st-btn good" data-act="status" data-status="live" data-slug="' + esc(s.slug) + '">Launch live</button>') +
          '<button class="st-btn" data-act="dup" data-slug="' + esc(s.slug) + '">Duplicate</button>' +
          (s.slug !== "beacon"
            ? '<button class="st-btn bad" data-act="del" data-slug="' + esc(s.slug) + '">Delete</button>'
            : "") +
          "</div>" +
          '<div class="st-link">live: /s/' + esc(s.slug) + " &middot; test: /s/" + esc(s.slug) +
          "/test</div></div>";
      });
      html += "</div>";
      root.innerHTML = html;
    });
  }

  // ------------------------------------------------------------ editor
  function openEditor(slug) {
    api("/api/studio/study", null).then(function () {}); // noop keep-alive
    fetch("/api/studio/study?slug=" + encodeURIComponent(slug) + "&token=" + TOKEN)
      .then(function (r) { return r.json(); })
      .then(function (s) { cur = s; tab = "questions"; renderEditor(); });
  }

  function saveStudy(cb) {
    api("/api/studio/save", { slug: cur.slug, title: cur.title, cfg: cur.cfg })
      .then(function (r) {
        if (r.error) toast("Save failed: " + r.error);
        else { toast("Saved"); if (cb) cb(); }
      });
  }

  function renderEditor() {
    var c = cur.cfg;
    var html = '<div class="st-edhead">' +
      '<button class="st-btn" data-act="back">&larr; Studies</button>' +
      '<input type="text" id="ed-title" value="' + esc(cur.title) + '">' +
      '<select id="ed-status" class="st-btn">' +
      ["draft", "live", "closed"].map(function (s) {
        return '<option value="' + s + '"' + (s === cur.status ? " selected" : "") + ">" + s +
          "</option>";
      }).join("") + "</select>" +
      '<button class="st-btn on" data-act="save">Save study</button>' +
      '<button class="st-btn" data-act="viewlive">Open respondent link</button>' +
      "</div>" +
      '<div class="st-tabs">' +
      [["questions", "Questions (" + c.questions.length + ")"],
       ["tpp", "TPP & walkthrough"], ["conjoint", "Conjoint"],
       ["settings", "Settings & QC"], ["responses", "Responses"],
       ["analysis", "Analysis"]].map(function (t) {
        return '<button class="st-tab' + (tab === t[0] ? " on" : "") + '" data-tab="' + t[0] +
          '">' + t[1] + "</button>";
      }).join("") + "</div>" +
      '<div class="st-panel" id="st-panel"></div>';
    root.innerHTML = html;
    renderTab();
  }

  function renderTab() {
    var p = document.getElementById("st-panel");
    if (tab === "questions") p.innerHTML = questionsTab();
    if (tab === "tpp") { p.innerHTML = tppTab(); renderScenePrev(); }
    if (tab === "conjoint") p.innerHTML = conjointTab();
    if (tab === "settings") p.innerHTML = settingsTab();
    if (tab === "responses") { p.innerHTML = "<p>Loading responses…</p>"; responsesTab(p); }
    if (tab === "analysis") { p.innerHTML = "<p>Computing analysis…</p>"; analysisTab(p); }
  }

  // ------------------------------------------------------------ questions tab
  function lines(rows, extra) {
    return (rows || []).map(function (r) {
      return r.code + "|" + r.label + (extra ? "|" + (r.left || "") + "|" + (r.right || "") : "");
    }).join("\n");
  }
  function parseLines(txt, four) {
    return String(txt || "").split("\n").map(function (l) { return l.trim(); })
      .filter(Boolean).map(function (l, i) {
        var p = l.split("|");
        var o = { code: (p[0] || "").trim() || String(i + 1), label: (p[1] || p[0] || "").trim() };
        if (four) { o.left = (p[2] || "").trim(); o.right = (p[3] || "").trim(); }
        return o;
      });
  }

  function questionsTab() {
    var c = cur.cfg;
    var html = "";
    c.sections.forEach(function (sec, si) {
      html += '<div class="st-sec"><div class="st-sec-head">' +
        '<input value="' + esc(sec.title) + '" data-sec-title="' + si + '">' +
        '<span class="st-meta">' + esc(sec.id) + "</span>" +
        '<button class="st-ibtn" title="Delete section" data-act="delsec" data-i="' + si +
        '">&#10005;</button></div>';
      c.questions.forEach(function (q, qi) {
        if (q.section !== sec.id) return;
        html += '<div class="st-qrow"><span class="qid">' + esc(q.id) + "</span>" +
          '<span class="qtype">' + esc(q.type) + "</span>" +
          '<span class="qstem">' + esc(q.stem) + "</span>" +
          '<button class="st-ibtn" data-act="qup" data-i="' + qi + '" title="Move up">&#9650;</button>' +
          '<button class="st-ibtn" data-act="qdown" data-i="' + qi + '" title="Move down">&#9660;</button>' +
          '<button class="st-ibtn" data-act="qedit" data-i="' + qi + '" title="Edit">&#9998;</button>' +
          '<button class="st-ibtn" data-act="qdel" data-i="' + qi + '" title="Delete">&#10005;</button>' +
          "</div>";
      });
      html += '<div style="padding:10px 12px;display:flex;gap:8px;align-items:center">' +
        '<select id="addtype-' + si + '" class="st-btn">' +
        TYPES.map(function (t) { return "<option>" + t + "</option>"; }).join("") +
        "</select>" +
        '<button class="st-btn" data-act="qadd" data-sec="' + esc(sec.id) + '" data-si="' + si +
        '">+ Add question</button></div></div>';
    });
    html += '<button class="st-btn" data-act="addsec">+ Add section</button>';
    return html;
  }

  // ------------------------------------------------------------ question drawer
  function openQuestionDrawer(qi) {
    var c = cur.cfg;
    var q = qi === -1 ? null : c.questions[qi];
    var type = q ? q.type : "single_select";
    var html = "<h3>" + (q ? "Edit " + esc(q.id) : "New question") + "</h3>" +
      '<div class="st-field"><label>Type</label><select id="f-type" ' + (q ? "disabled" : "") + ">" +
      TYPES.map(function (t) {
        return "<option" + (t === type ? " selected" : "") + ">" + t + "</option>";
      }).join("") + "</select></div>" +
      '<div class="st-field"><label>Question id</label><input id="f-id" value="' +
      esc(q ? q.id : "") + '" placeholder="e.g. N5"></div>' +
      '<div class="st-field"><label>Section</label><select id="f-section">' +
      c.sections.map(function (s) {
        return '<option value="' + esc(s.id) + '"' +
          (q && q.section === s.id ? " selected" : "") + ">" + esc(s.title) + "</option>";
      }).join("") + "</select></div>" +
      '<div class="st-field"><label>Question text (stem)</label><textarea id="f-stem">' +
      esc(q ? q.stem : "") + "</textarea></div>" +
      '<div class="st-field"><label>Help text (optional)</label><input id="f-help" value="' +
      esc(q ? q.help : "") + '"></div>' +
      '<div class="st-field"><label><input type="checkbox" id="f-required" style="width:auto" ' +
      (!q || q.required ? "checked" : "") + "> Required</label></div>";

    var t = q ? q.type : type;
    if (t === "single_select" || t === "multi_select") {
      html += '<div class="st-field"><label>Options (code|label per line)</label>' +
        '<textarea id="f-options">' + lines(q && q.options) + "</textarea></div>";
      if (t === "multi_select") html += '<div class="st-field"><label>Max selections</label>' +
        '<input id="f-maxselect" type="number" value="' + (q && q.max_select ? q.max_select : 3) +
        '"></div>';
    }
    if (t === "numeric" || t === "slider") {
      html += '<div class="st-field"><label>Min</label><input id="f-min" type="number" value="' +
        (q ? q.min : 0) + '"></div><div class="st-field"><label>Max</label>' +
        '<input id="f-max" type="number" value="' + (q ? q.max : 100) + '"></div>';
      if (t === "slider") html += '<div class="st-field"><label>Step</label>' +
        '<input id="f-step" type="number" value="' + (q && q.step ? q.step : 5) + '"></div>';
    }
    if (t === "open_text") html += '<div class="st-field"><label>Minimum words</label>' +
      '<input id="f-minwords" type="number" value="' + (q && q.min_words ? q.min_words : 3) +
      '"></div>';
    if (t === "rating_grid" || t === "semantic_diff" || t === "sum_to_100" ||
        t === "rank" || t === "emoji_grid" || t === "heatmap") {
      html += '<div class="st-field"><label>Rows (code|label' +
        (t === "semantic_diff" ? "|left|right" : "") + ' per line)</label>' +
        '<textarea id="f-rows">' + lines(q && q.rows, t === "semantic_diff") + "</textarea></div>";
    }
    if (t === "rating_grid" || t === "semantic_diff") {
      html += '<div class="st-field"><label>Scale min / max</label>' +
        '<input id="f-smin" type="number" value="' + (q && q.scale ? q.scale.min : 1) +
        '" style="width:70px;display:inline-block"> <input id="f-smax" type="number" value="' +
        (q && q.scale ? q.scale.max : 7) + '" style="width:70px;display:inline-block"></div>' +
        '<div class="st-field"><label>Min label / max label</label><input id="f-sminl" value="' +
        esc(q && q.scale ? q.scale.min_label || "" : "") +
        '" style="width:48%;display:inline-block"> <input id="f-smaxl" value="' +
        esc(q && q.scale ? q.scale.max_label || "" : "") +
        '" style="width:48%;display:inline-block"></div>';
    }
    if (t === "rank") html += '<div class="st-field"><label>Top-N recorded</label>' +
      '<input id="f-rankcount" type="number" value="' + (q && q.rank_count ? q.rank_count : 3) +
      '"></div>';
    if (t === "heatmap") {
      html += '<div class="st-field"><label>Columns (code|label per line)</label>' +
        '<textarea id="f-cols">' + lines(q && q.cols) + "</textarea></div>";
    }
    if (t === "maxdiff") {
      html += '<div class="st-field"><label>Rounds (comma-separated item codes per line)</label>' +
        '<textarea id="f-rounds">' + (q ? q.rounds.map(function (r) {
          return r.items.join(",");
        }).join("\n") : "") + "</textarea></div>";
    }
    if (t === "choice_task") {
      html += '<div class="st-field"><label>Patient vignette</label><textarea id="f-vignette">' +
        esc(q && q.vignette ? q.vignette : "") + "</textarea></div>" +
        '<div class="st-note">The choice alternatives come from the conjoint design on the ' +
        "Conjoint tab.</div>";
    }
    html += '<div class="st-field"><label>Advanced - raw JSON (overrides the form when ' +
      'valid)</label><textarea id="f-raw" style="min-height:110px;font-family:monospace">' +
      esc(q ? JSON.stringify(q, null, 1) : "") + "</textarea></div>" +
      '<div class="st-draw-actions"><button class="st-btn on" data-act="qsave" data-qi="' + qi +
      '">Save question</button><button class="st-btn" data-act="qclose">Cancel</button></div>';
    drawer.innerHTML = html;
    drawer.hidden = false;
    requestAnimationFrame(function () { drawer.classList.add("open"); });
  }

  function readQuestionForm(qi) {
    function v(id) { var n = document.getElementById(id); return n ? n.value : undefined; }
    function n(id) { var x = v(id); return x === undefined || x === "" ? undefined : Number(x); }
    var raw = v("f-raw");
    if (raw && raw.trim()) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.id && parsed.type && parsed.stem) return parsed;
        toast("Raw JSON invalid (needs id/type/stem) - using form fields");
      } catch (e) {
        toast("Raw JSON did not parse - using form fields");
      }
    }
    var t = qi === -1 ? v("f-type") : cur.cfg.questions[qi].type;
    var q = qi === -1 ? qTemplate(t, v("f-id") || "N" + (cur.cfg.questions.length + 1),
                                  v("f-section"))
                      : cur.cfg.questions[qi];
    q.id = v("f-id") || q.id;
    q.section = v("f-section");
    q.stem = v("f-stem");
    if (v("f-help")) q.help = v("f-help"); else delete q.help;
    q.required = document.getElementById("f-required").checked;
    if (t === "single_select" || t === "multi_select") {
      q.options = parseLines(v("f-options")).map(function (o, i) {
        o.code = isNaN(Number(o.code)) ? i + 1 : Number(o.code); return o;
      });
      if (t === "multi_select" && n("f-maxselect")) q.max_select = n("f-maxselect");
    }
    if (t === "numeric" || t === "slider") { q.min = n("f-min"); q.max = n("f-max"); }
    if (t === "slider" && n("f-step")) q.step = n("f-step");
    if (t === "open_text" && n("f-minwords")) q.min_words = n("f-minwords");
    if (["rating_grid", "sum_to_100", "rank", "emoji_grid", "heatmap"].indexOf(t) >= 0) {
      q.rows = parseLines(v("f-rows"));
    }
    if (t === "semantic_diff") q.rows = parseLines(v("f-rows"), true);
    if (t === "rating_grid" || t === "semantic_diff") {
      q.scale = q.scale || {};
      q.scale.min = n("f-smin") || 1; q.scale.max = n("f-smax") || 7;
      if (v("f-sminl")) q.scale.min_label = v("f-sminl");
      if (v("f-smaxl")) q.scale.max_label = v("f-smaxl");
    }
    if (t === "rank" && n("f-rankcount")) q.rank_count = n("f-rankcount");
    if (t === "heatmap") q.cols = parseLines(v("f-cols"));
    if (t === "maxdiff") {
      q.rounds = String(v("f-rounds") || "").split("\n").filter(function (l) { return l.trim(); })
        .map(function (l) {
          return { items: l.split(",").map(function (x) { return x.trim(); }).filter(Boolean) };
        });
    }
    if (t === "choice_task") q.vignette = v("f-vignette");
    return q;
  }

  // ------------------------------------------------------------ tpp / conjoint / settings tabs
  function tppTab() {
    var t = cur.cfg.tpp || {};
    var fields = [["patient", "Patient population"], ["trial", "Pivotal trial"],
      ["mechanism", "Mechanism of action"], ["efficacy", "Headline efficacy"],
      ["safety", "Safety summary"], ["administration", "Administration"],
      ["cdx", "Companion diagnostic"]];
    var html = '<div class="st-note">The animated walkthrough is generated from this text - ' +
      "edit it, regenerate, and the respondent-facing visualization updates on save." +
      (cur.cfg.use_tts ? " This study uses browser-voice narration." : "") + "</div>" +
      fields.map(function (f) {
        return '<div class="st-field"><label>' + f[1] + '</label><textarea data-tpp="' + f[0] +
          '">' + esc(t[f[0]] || "") + "</textarea></div>";
      }).join("") +
      '<div class="st-field"><label><input type="checkbox" id="f-tts" style="width:auto" ' +
      (cur.cfg.use_tts ? "checked" : "") + '> Narrate the walkthrough with browser ' +
      "text-to-speech</label></div>" +
      '<button class="st-btn on" data-act="regen">Regenerate walkthrough from text</button>' +
      '<div id="scene-prev" style="margin-top:12px"></div>';
    return html;
  }

  function renderScenePrev() {
    var el = document.getElementById("scene-prev");
    if (!el) return;
    el.innerHTML = (cur.cfg.explainer_scenes || []).map(function (s, i) {
      return '<div class="st-note"><strong>' + (i + 1) + ". " + esc(s.title) + "</strong><br>" +
        esc(s.caption) + "</div>";
    }).join("");
  }

  function conjointTab() {
    var cj = cur.cfg.conjoint;
    var attrs = cj ? cj.attributes : [];
    var html = '<div class="st-note">Define attributes with three levels each, then generate ' +
      "a balanced best-worst-safe design. A choice_task question will be added if missing." +
      "</div>" +
      '<div class="st-field"><label>Attributes (id|label|level1|level2|level3|higher_is_bad ' +
      '0/1 per line)</label><textarea id="f-attrs" style="min-height:140px">' +
      (attrs.map(function (a) {
        return a.id + "|" + (a.label || a.id) + "|" + a.levels.join("|") + "|" +
          (a.higher_is_bad ? 1 : 0);
      }).join("\n") || "OS|Overall survival|no proven benefit|+3 months|+6 months|0") +
      "</textarea></div>" +
      '<div class="st-field"><label>Choice tasks per respondent</label>' +
      '<input id="f-ntasks" type="number" value="' + (cj ? cj.n_tasks : 9) + '"></div>' +
      '<div class="st-field"><label>Patient vignette for the choice tasks</label>' +
      '<textarea id="f-cvignette">' + esc((cur.cfg.conjoint_scene && cur.cfg.vignette) ||
        cur.cfg.vignette || "") + '</textarea></div>' +
      '<button class="st-btn on" data-act="genconj">Generate design</button>' +
      (cj ? '<div class="st-note">Current design: ' + cj.n_tasks + " tasks x " +
        (cj.tasks && cj.tasks[0] ? cj.tasks[0].length : 3) + " alternatives over " +
        attrs.length + " attributes.</div>" : "");
    return html;
  }

  function settingsTab() {
    var c = cur.cfg, qc = c.qc || {};
    return '<div class="st-field"><label>Study slug (link /s/' + esc(cur.slug) +
      ')</label><input value="' + esc(cur.slug) + '" disabled></div>' +
      '<div class="st-field"><label>Conjoint minimum dwell (seconds)</label>' +
      '<input id="f-dwell" type="number" value="' + (c.conjoint_min_dwell || 10) + '"></div>' +
      '<div class="st-field"><label>QC - minimum elapsed seconds (speeder flag)</label>' +
      '<input id="f-minsec" type="number" value="' + (qc.min_seconds || 300) + '"></div>' +
      '<div class="st-field"><label>QC - attention-check question id (correct code)</label>' +
      '<input id="f-attq" value="' + esc(qc.attention_q || "") + '" placeholder="Q13" ' +
      'style="width:48%;display:inline-block"><input id="f-attok" value="' +
      esc(qc.attention_ok || "") + '" placeholder="2" style="width:48%;display:inline-block">' +
      "</div>" +
      '<div class="st-field"><label>QC - straightline question id / uniform conjoint ' +
      'id</label><input id="f-strq" value="' + esc(qc.straightline_q || "") +
      '" style="width:48%;display:inline-block"><input id="f-uniq" value="' +
      esc(qc.uniform_q || "") + '" style="width:48%;display:inline-block"></div>' +
      '<div class="st-field"><label>QC - verbatim question ids (comma separated)</label>' +
      '<input id="f-verb" value="' + esc((qc.verbatim_qs || []).join(", ")) + '"></div>' +
      '<div class="st-field"><label>Headline metric question ids (intent / pct / wtp, ' +
      'optional)</label><input id="f-m1" value="' + esc((c.metrics || {}).intent_q || "") +
      '" placeholder="intent" style="width:32%;display:inline-block"><input id="f-m2" value="' +
      esc((c.metrics || {}).pct_q || "") + '" placeholder="pct" ' +
      'style="width:32%;display:inline-block"><input id="f-m3" value="' +
      esc((c.metrics || {}).wtp_q || "") + '" placeholder="wtp" ' +
      'style="width:32%;display:inline-block"></div>';
  }

  // ------------------------------------------------------------ responses / analysis
  function responsesTab(p) {
    fetch("/api/admin/data?study=" + encodeURIComponent(cur.slug) + "&scope=all&token=" + TOKEN)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var html = '<div class="st-kpis">' +
          kpi(d.counts.total, "started") + kpi(d.counts.complete, "complete") +
          kpi(d.counts.screened_out, "screened out") + kpi(d.counts.in_progress, "in progress") +
          "</div>" +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
          '<a class="st-btn" href="/admin/export.xlsx?study=' + cur.slug +
          '&scope=all&token=' + TOKEN + '">Excel (all)</a>' +
          '<a class="st-btn" href="/admin/export.csv?study=' + cur.slug + "&scope=all&token=" +
          TOKEN + '">CSV</a>' +
          '<a class="st-btn" href="/admin/export.json?study=' + cur.slug + "&scope=all&token=" +
          TOKEN + '">JSON</a>' +
          '<button class="st-btn bad" data-act="reset" data-scope="test">Reset test data</button>' +
          '<button class="st-btn bad" data-act="reset" data-scope="all">Reset all</button>' +
          "</div>" +
          '<table class="st-tbl"><tr><th>Code</th><th>Status</th><th>Min</th><th>QC flags</th>' +
          "<th>Started</th></tr>" +
          d.recent.map(function (r) {
            return "<tr><td>" + esc(r.code) + "</td><td>" + esc(r.status) + "</td><td>" +
              r.minutes + "</td><td>" + esc(r.flags.join(", ") || "clean") + "</td><td>" +
              esc(r.started_at || "") + "</td></tr>";
          }).join("") + "</table>";
        p.innerHTML = html;
      });
    function kpi(v, l) { return '<div class="st-kpi"><strong>' + v + "</strong><span>" + l +
      "</span></div>"; }
  }

  function analysisTab(p) {
    fetch("/api/studio/analysis?study=" + encodeURIComponent(cur.slug) + "&token=" + TOKEN)
      .then(function (r) { return r.json(); })
      .then(function (a) {
        var html = '<div class="st-kpis">' +
          '<div class="st-kpi"><strong>' + a.n_complete + "/" + a.n_started +
          "</strong><span>completed</span></div>" +
          '<div class="st-kpi"><strong>' + a.mean_minutes + "</strong><span>mean minutes</span></div>" +
          (a.nps ? '<div class="st-kpi"><strong>' + a.nps.score + "</strong><span>NPS</span></div>" : "") +
          "</div>";
        a.ratings.forEach(function (r) {
          html += "<h4>" + esc(r.id) + " - " + esc(r.stem) + "</h4>" +
            '<table class="st-tbl"><tr><th>Item</th><th style="width:200px">Mean</th><th></th></tr>' +
            r.rows.map(function (row) {
              var m = row.mean == null ? 0 : row.mean;
              return "<tr><td>" + esc(row.label) + "</td><td>" + (row.mean == null ? "–" : m) +
                '</td><td><div class="st-bar"><i style="width:' + Math.min(100, m * 14) +
                '%"></i></div></td></tr>';
            }).join("") + "</table>";
        });
        if (a.nps) html += '<div class="st-note">NPS segments: Promoter ' +
          a.nps.segments.Promoter + ", Passive " + a.nps.segments.Passive + ", Detractor " +
          a.nps.segments.Detractor + "</div>";
        a.maxdiff.forEach(function (m) {
          html += "<h4>MaxDiff " + esc(m.id) + " (best minus worst)</h4>" +
            '<table class="st-tbl"><tr><th>Code</th><th>Best</th><th>Worst</th><th>B-W</th></tr>' +
            m.scores.sort(function (x, y) { return y.bw - x.bw; }).map(function (s) {
              return "<tr><td>" + esc(s.code) + "</td><td>" + s.best + "</td><td>" + s.worst +
                "</td><td><strong>" + s.bw + "</strong></td></tr>";
            }).join("") + "</table>";
        });
        a.heatmap.forEach(function (h) {
          html += "<h4>Heat map " + esc(h.id) + "</h4>" +
            '<table class="st-tbl"><tr><th>Cell</th><th>Mean intensity (0-3)</th></tr>' +
            h.cells.map(function (c) {
              return "<tr><td>" + esc(c.row) + " × " + esc(c.col) + "</td><td>" +
                (c.mean == null ? "–" : c.mean) + "</td></tr>";
            }).join("") + "</table>";
        });
        if (a.choice_share) {
          html += "<h4>Conjoint: share of choices when level shown</h4>" +
            '<table class="st-tbl"><tr><th>Attribute</th><th>Level</th><th>Choice share</th></tr>' +
            a.choice_share.map(function (s) {
              return "<tr><td>" + esc(s.attr) + "</td><td>" + esc(s.level) + "</td><td>" +
                s.share + '%</td></tr>';
            }).join("") + "</table>";
        }
        p.innerHTML = html || "<p>No responses yet.</p>";
      });
  }

  // ------------------------------------------------------------ events
  document.getElementById("new-study").addEventListener("click", function () {
    var cfg = blankCfg();
    api("/api/studio/save", { slug: "", title: cfg.title, cfg: cfg }).then(function (r) {
      toast("Created /" + r.slug);
      openEditor(r.slug);
    });
  });
  document.getElementById("dup-beacon").addEventListener("click", function () {
    fetch("/api/studio/study?slug=beacon&token=" + TOKEN).then(function (r) { return r.json(); })
      .then(function (s) {
        var cfg = JSON.parse(JSON.stringify(s.cfg));
        cfg.title = s.title + " (copy)";
        api("/api/studio/save", { slug: "", title: cfg.title, cfg: cfg }).then(function (r) {
          toast("Duplicated as /" + r.slug);
          openEditor(r.slug);
        });
      });
  });

  root.addEventListener("click", function (e) {
    var t = e.target;
    var tabBtn = t.closest("[data-tab]");
    if (tabBtn) { tab = tabBtn.getAttribute("data-tab"); renderEditor(); return; }
    var b = t.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    var slug = b.getAttribute("data-slug");
    var i = Number(b.getAttribute("data-i"));

    if (act === "open") openEditor(slug);
    if (act === "back") loadList();
    if (act === "status") {
      api("/api/studio/status", { slug: slug, status: b.getAttribute("data-status") })
        .then(function () { toast("Status updated"); loadList(); });
    }
    if (act === "dup") {
      fetch("/api/studio/study?slug=" + slug + "&token=" + TOKEN)
        .then(function (r) { return r.json(); })
        .then(function (s) {
          var cfg = JSON.parse(JSON.stringify(s.cfg));
          cfg.title = s.title + " (copy)";
          api("/api/studio/save", { slug: "", title: cfg.title, cfg: cfg })
            .then(function (r) { toast("Duplicated as /" + r.slug); loadList(); });
        });
    }
    if (act === "del") {
      if (confirm("Delete study /" + slug + " and all of its responses?")) {
        api("/api/studio/delete", { slug: slug }).then(function () { loadList(); });
      }
    }
    if (act === "save") {
      cur.title = document.getElementById("ed-title").value;
      var st = document.getElementById("ed-status").value;
      saveStudy(function () {
        if (st !== cur.status) {
          api("/api/studio/status", { slug: cur.slug, status: st })
            .then(function () { cur.status = st; toast("Saved & status: " + st); });
        }
      });
    }
    if (act === "viewlive") {
      window.open("/s/" + cur.slug + "?preview=" + TOKEN, "_blank");
    }
    if (act === "addsec") {
      var id = "S" + (cur.cfg.sections.length + 1);
      cur.cfg.sections.push({ id: id, title: "Section " + (cur.cfg.sections.length + 1),
                              blurb: null });
      renderTab();
    }
    if (act === "delsec") {
      if (cur.cfg.questions.some(function (q) { return q.section === cur.cfg.sections[i].id; })) {
        toast("Move or delete its questions first"); return;
      }
      cur.cfg.sections.splice(i, 1); renderTab();
    }
    if (act === "qadd") {
      var type = document.getElementById("addtype-" + b.getAttribute("data-si")).value;
      var q = qTemplate(type, "", b.getAttribute("data-sec"));
      q.id = "N" + (cur.cfg.questions.length + 1);
      cur.cfg.questions.push(q);
      openQuestionDrawer(cur.cfg.questions.length - 1);
    }
    if (act === "qedit") openQuestionDrawer(i);
    if (act === "qdel") { cur.cfg.questions.splice(i, 1); renderTab(); }
    if (act === "qup" && i > 0) {
      var a1 = cur.cfg.questions; var t1 = a1[i - 1]; a1[i - 1] = a1[i]; a1[i] = t1; renderTab();
    }
    if (act === "qdown" && i < cur.cfg.questions.length - 1) {
      var a2 = cur.cfg.questions; var t2 = a2[i + 1]; a2[i + 1] = a2[i]; a2[i] = t2; renderTab();
    }
    if (act === "regen") {
      var tpp = {};
      root.querySelectorAll("[data-tpp]").forEach(function (n) {
        tpp[n.getAttribute("data-tpp")] = n.value;
      });
      cur.cfg.tpp = tpp;
      cur.cfg.use_tts = document.getElementById("f-tts").checked;
      cur.cfg.explainer_scenes = scenesFromTpp(tpp);
      renderScenePrev();
      toast("Walkthrough regenerated - save to publish");
    }
    if (act === "genconj") {
      var attrs = String(document.getElementById("f-attrs").value).split("\n")
        .filter(function (l) { return l.trim(); }).map(function (l) {
          var p = l.split("|");
          return { id: p[0].trim(), label: (p[1] || p[0]).trim(),
                   levels: [p[2] || "low", p[3] || "mid", p[4] || "high"],
                   higher_is_bad: p[5] === "1" };
        });
      api("/api/studio/make_conjoint", {
        attributes: attrs, n_tasks: Number(document.getElementById("f-ntasks").value) || 9,
        seed: 7
      }).then(function (d) {
        if (d.error) { toast("Design failed: " + d.error); return; }
        cur.cfg.conjoint = {
          attributes: d.attributes.map(function (id) {
            return { id: id, levels: d.levels[id] };
          }),
          tasks: d.tasks.map(function (task) {
            return task.map(function (p, i) { return { alt_id: i + 1, levels: p }; });
          }),
          n_tasks: d.n_tasks, has_opt_out: true
        };
        cur.cfg.vignette = document.getElementById("f-cvignette").value || cur.cfg.vignette;
        if (!cur.cfg.questions.some(function (q) { return q.type === "choice_task"; })) {
          var q = qTemplate("choice_task", "CT1",
                            cur.cfg.sections[cur.cfg.sections.length - 1].id);
          q.vignette = cur.cfg.vignette;
          cur.cfg.questions.push(q);
        }
        renderTab();
        toast("Design generated: " + d.n_tasks + " balanced tasks");
      });
    }
    if (act === "reset") {
      if (confirm("Reset " + b.getAttribute("data-scope") + " responses for /" + cur.slug + "?")) {
        fetch("/admin/reset?study=" + cur.slug + "&scope=" + b.getAttribute("data-scope") +
              "&token=" + TOKEN, { method: "POST" })
          .then(function (r) { return r.json(); })
          .then(function (r) { toast("Deleted " + r.deleted_respondents); responsesTab(
            document.getElementById("st-panel")); });
      }
    }
  });

  root.addEventListener("input", function (e) {
    var t = e.target;
    if (t.id === "ed-title") cur.title = t.value;
    var si = t.getAttribute && t.getAttribute("data-sec-title");
    if (si != null) cur.cfg.sections[Number(si)].title = t.value;
  });

  drawer.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    if (act === "qclose") { drawer.classList.remove("open"); setTimeout(function () {
      drawer.hidden = true; }, 350); }
    if (act === "qsave") {
      var qi = Number(b.getAttribute("data-qi"));
      var q = readQuestionForm(qi);
      if (!q.id || !q.stem) { toast("Question needs an id and text"); return; }
      if (qi === -1) cur.cfg.questions.push(q);
      else cur.cfg.questions[qi] = q;
      drawer.classList.remove("open");
      setTimeout(function () { drawer.hidden = true; }, 350);
      renderTab();
      toast("Question updated - save the study to publish");
    }
  });

  loadList();
})();
