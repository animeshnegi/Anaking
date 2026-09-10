/* PROJECT BEACON - admin dashboard. */
(function () {
  "use strict";

  // Auth: the browser is signed in via /login (cookie). A ?token= in the URL still works
  // for bookmarks/scripts and is forwarded on every request when present.
  var PARAMS = new URLSearchParams(location.search);
  var TOKEN = PARAMS.get("token") || "";
  var STUDY = PARAMS.get("study") || "beacon";
  var scope = "all";
  var $ = function (s) { return document.querySelector(s); };

  function qs(path, extra) {
    var parts = [];
    if (path.indexOf("study=") < 0) parts.push("study=" + encodeURIComponent(STUDY));
    if (extra) parts.push(extra);
    if (TOKEN) parts.push("token=" + encodeURIComponent(TOKEN));
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + parts.join("&");
  }

  function toast(msg, isErr) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    t.hidden = false;
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.hidden = true; }, 3600);
  }

  function api(path) {
    return fetch(qs(path), { credentials: "same-origin" }).then(function (r) {
      if (r.status === 403) { needSignIn(); throw new Error("not signed in"); }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function needSignIn() {
    location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
  }

  function download(path, label, btn) {
    var url = qs(path);
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = "Preparing…";
    // fetch so we can report the real outcome instead of a silent download failure
    fetch(url, { credentials: "same-origin" }).then(function (r) {
      if (r.status === 403) { needSignIn(); }
      if (!r.ok) throw new Error("HTTP " + r.status);
      var backend = r.headers.get("X-Export-Backend");
      return r.blob().then(function (b) { return { blob: b, backend: backend }; });
    }).then(function (res) {
      var a = document.createElement("a");
      var name = url.match(/filename=([^;&]+)/);
      a.href = URL.createObjectURL(res.blob);
      a.download = name ? decodeURIComponent(name[1]) : "export";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      toast(label + " downloaded" + (res.backend ? " (backend: " + res.backend + ")" : ""));
    }).catch(function (e) {
      toast("Export failed: " + e.message, true);
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = old;
    });
  }

  function reset(kind, label, btn) {
    var confirmMsg = {
      test: "Clear all TEST responses? Codes restart from T001.",
      real: "Clear all REAL responses? This deletes collected data.",
      all: "Clear EVERYTHING - all test and real responses? This cannot be undone."
    }[kind];
    if (!confirm(confirmMsg)) return;
    btn.disabled = true;
    fetch(qs("/admin/reset", "scope=" + kind), { method: "POST", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.error) throw new Error(res.error);
        toast("Removed " + res.deleted_respondents + " respondent record(s). " + (res.note || ""));
        load();
      })
      .catch(function (e) { toast("Reset failed: " + e.message, true); })
      .finally(function () { btn.disabled = false; });
  }

  function bar(label, value, max) {
    var pct = max ? Math.round(100 * value / max) : 0;
    return '<div class="bar-row"><span>' + label + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="bar-val">' + value + '</span></div>';
  }

  function metric(label, value, suffix) {
    if (value === null || value === undefined) {
      return '<div class="metric"><span>' + label + '</span><span class="na">no data yet</span></div>';
    }
    return '<div class="metric"><span>' + label + '</span><b>' + value +
      (suffix || "") + '</b></div>';
  }

  function render(d) {
    $("#generated").textContent = d.generated;

    var c = d.counts;
    var rate = c.total ? Math.round(100 * c.complete / c.total) : 0;
    $("#cards").innerHTML = [
      ["Respondents started", c.total, "", ""],
      ["Completed", c.complete, "complete", rate + "% of starts"],
      ["Screened out", c.screened_out, "warn", "at screener"],
      ["In progress", c.in_progress, "", "started, not finished"]
    ].map(function (x) {
      return '<div class="card ' + x[2] + '"><div class="k">' + x[0] + '</div>' +
        '<div class="v">' + x[1] + '</div><div class="n">' + x[3] + '</div></div>';
    }).join("");

    // quota
    var div = d.quota.census_division, set = d.quota.practice_setting;
    var divMax = Math.max(1, Math.max.apply(null, [0].concat(Object.values(div))));
    var setMax = Math.max(1, Math.max.apply(null, [0].concat(Object.values(set))));
    var html = '<div style="font-size:11.5px;color:#5f7284;margin-bottom:7px">Census division</div>';
    ["Northeast", "Midwest", "South", "West"].forEach(function (k) {
      html += bar(k, div[k] || 0, divMax);
    });
    html += '<div style="font-size:11.5px;color:#5f7284;margin:14px 0 7px">Practice setting</div>';
    ["community", "academic"].forEach(function (k) {
      html += bar(k, set[k] || 0, setMax);
    });
    $("#quota").innerHTML = html;

    // headlines + qc
    var h = d.headlines;
    $("#headlines").innerHTML =
      metric("Top-2-box intent to prescribe", h.top2box_intent_pct, "%") +
      metric("Mean share of eligible patients", h.mean_pct_eligible, "%") +
      metric("Mean interview length", h.mean_minutes, " min") +
      metric("Conjoint tasks per respondent", d.conjoint.n_tasks);

    if (!d.qc_flagged.length) {
      $("#qc").innerHTML = '<div class="qc-empty">No quality-control flags raised.</div>';
    } else {
      $("#qc").innerHTML = d.qc_flagged.map(function (f) {
        return '<div class="qc-item"><code>' + f.code + '</code> ' +
          f.flags.map(function (x) { return '<span class="chip">' + x + "</span>"; }).join(" ") +
          "</div>";
      }).join("");
    }

    // recent table
    var t = $("#recent");
    if (!d.recent.length) {
      t.innerHTML = '<tr><td class="empty">No respondents yet. Open the survey link to begin.</td></tr>';
    } else {
      t.innerHTML = "<thead><tr><th>Code</th><th>Type</th><th>Status</th><th>Started</th>" +
        "<th>Completed</th><th>Min</th><th>Screen-out</th><th>QC flags</th></tr></thead><tbody>" +
        d.recent.map(function (r) {
          return "<tr><td><code>" + r.code + "</code></td>" +
            "<td>" + (r.is_test ? '<span class="pill test">test</span>' : "real") + "</td>" +
            '<td><span class="pill ' + r.status + '">' + r.status.replace("_", " ") + "</span></td>" +
            "<td>" + (r.started_at || "").replace("T", " ") + "</td>" +
            "<td>" + (r.completed_at || "").replace("T", " ") + "</td>" +
            "<td>" + (r.minutes || 0) + "</td>" +
            "<td>" + (r.screen_out || "") + "</td>" +
            "<td>" + (r.flags.length
              ? r.flags.map(function (x) { return '<span class="chip">' + x + "</span>"; }).join(" ")
              : "") + "</td></tr>";
        }).join("") + "</tbody>";
    }
  }

  function load() {
    api("/api/admin/data?scope=" + scope).then(render)
      .catch(function (e) { toast("Could not load admin data: " + e.message, true); });
  }

  // ---- wiring ----
  document.querySelectorAll("#scope-seg button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#scope-seg button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      scope = b.dataset.scope;
      load();
    });
  });

  $("#dl-xlsx").addEventListener("click", function () {
    download("/admin/export.xlsx?scope=" + scope, "Excel workbook", this);
  });
  $("#dl-csv").addEventListener("click", function () {
    download("/admin/export.csv?scope=" + scope, "CSV", this);
  });
  $("#dl-json").addEventListener("click", function () {
    download("/admin/export.json?scope=" + scope, "JSON", this);
  });
  $("#refresh").addEventListener("click", load);

  $("#reset-test").addEventListener("click", function () { reset("test", "test", this); });
  $("#reset-real").addEventListener("click", function () { reset("real", "real", this); });
  $("#reset-all").addEventListener("click", function () { reset("all", "all", this); });

  // ---- study switcher (all studies on the server; selection lives in ?study=)
  var sel = $("#study-select");
  function fillStudies() {
    api("/api/studio/list").then(function (list) {
      sel.innerHTML = list.map(function (s) {
        return '<option value="' + s.slug + '"' + (s.slug === STUDY ? " selected" : "") + ">" +
          s.title.replace(/</g, "&lt;") + " (" + s.status + ")</option>";
      }).join("");
      var known = list.some(function (s) { return s.slug === STUDY; });
      if (!known && list.length) { sel.value = list[0].slug; switchStudy(list[0].slug); }
    }).catch(function () {});
  }
  function switchStudy(slug) {
    STUDY = slug;
    var p = new URLSearchParams(location.search);
    p.set("study", slug);
    history.replaceState(null, "", location.pathname + "?" + p.toString());
    $("#take-survey").href = "/survey/" + slug + "/test";
    document.querySelectorAll(".appnav-link").forEach(function (a) {
      if (a.textContent === "Studio") a.href = "/studio/#" + slug;
      if (a.textContent === "Survey") a.href = "/survey/" + slug;
    });
    load();
  }
  sel.addEventListener("change", function () { switchStudy(sel.value); });
  $("#take-survey").href = "/survey/" + STUDY + "/test";

  fillStudies();
  load();
  setInterval(load, 15000);
})();
