/* jsdom check of the globalisation + library features:
   SURVEY OPTIONS menu (all 10 items), grouped add-item library, new question types in the
   editor and respondent preview, Edit title and language, the Globalize panel (add language,
   manual translate, save), the survey pages settings, and the respondent-side language
   picker with translated welcome copy.  Needs the server on :8000 and jsdom:
   node scripts/dom/globalize_test.js */
let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (e) { ({ JSDOM } = require("/tmp/node_modules/jsdom")); }
const http = require("http"); const BASE = process.env.BASE || "http://127.0.0.1:8000";
function req(method, p, body) {
  return new Promise((res, rej) => {
    const u = new URL(BASE + p); const h = {};
    if (body) h["Content-Type"] = "application/json";
    const r = http.request(u, { method, headers: h }, x => {
      let d = ""; x.on("data", c => d += c); x.on("end", () => res({ status: x.statusCode, body: d }));
    });
    r.on("error", rej); if (body) r.write(body); r.end();
  });
}
const get = p => req("GET", p).then(r => r.body);
let fails = 0; const check = (l, c, d = "") => { console.log((c ? "PASS  " : "FAIL  ") + l + (c ? "" : "  -> " + d)); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const cfg = {
    sections: [{ id: "S1", title: "Intro" }, { id: "S2", title: "Main" }],
    questions: [
      { id: "Q1", section: "S1", type: "single_select", stem: "Pick one",
        options: [{ code: 1, label: "Option A" }, { code: 2, label: "Option B" }] },
      { id: "Q2", section: "S2", type: "open_text", stem: "Why?" }],
    explainer_scenes: []
  };
  await req("POST", "/api/studio/delete", JSON.stringify({ slug: "globalize-test" }));   // clear leftovers from earlier runs
  const slug = JSON.parse((await req("POST", "/api/studio/save",
    JSON.stringify({ title: "Globalize Test", cfg }))).body).slug;
  await req("POST", "/api/studio/status", JSON.stringify({ slug, status: "live" }));
  const saved = async () => JSON.parse(await get("/api/studio/study?slug=" + slug)).cfg;

  const dom = new JSDOM(await get("/studio/"), { url: BASE + "/studio/#" + slug, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.BEACON_PREVIEW_MODE = true; w.requestAnimationFrame = fn => setTimeout(fn, 0); w.scrollTo = () => {};
  w.Element.prototype.scrollIntoView = function () {}; w.confirm = () => true;
  w.fetch = (u, o) => {
    const U = new URL(u, BASE);
    return req((o && o.method) || "GET", U.pathname + U.search, o && o.body)
      .then(x => ({ ok: x.status < 400, status: x.status, json: () => Promise.resolve(JSON.parse(x.body)) }));
  };
  const errs = []; w.addEventListener("error", e => errs.push(e.message));
  for (const f of ["qlogic.js", "survey.js", "explainer.js", "studio.js"]) w.eval(await get("/static/js/" + f));
  await sleep(800);
  const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));

  // --- the top builder bar must stay visible (a meter style once collapsed it)
  const css = await get("/static/css/studio.css?v=260921c");
  check("top builder bar not collapsed by the save-meter style", !/\.st-bar\{[^}]*height:8px/.test(css));
  check("save meter has its own .st-meter class", /\.st-meter\{height:8px/.test(css) && !/<div class="st-bar"><i/.test(await get("/static/js/studio.js?v=260921c")));

  // --- SURVEY OPTIONS menu with the full item list
  const sopts = $('[data-act="sopts"]');
  check("SURVEY OPTIONS button in builder bar", !!sopts && /SURVEY OPTIONS/.test(sopts.textContent));
  sopts.click(); await sleep(20);
  const menu = $("#st-sopts");
  const labels = $$("#st-sopts button").map(b => b.textContent.trim());
  check("menu opens with all ten options", menu && !menu.hidden && labels.length === 10, labels.join(" | "));
  const want = ["Settings", "Share survey preview", "Move survey…", "Duplicate", "Download Word Outline",
    "Start Tracking", "Duplicate & Translate…", "Globalize Survey…", "Edit title and language…", "Delete survey"];
  check("every option from the reference menu is present", want.every(x => labels.includes(x)), JSON.stringify(labels));

  // --- Edit title and language
  $('[data-act="so-title"]').click(); await sleep(20);
  check("title & language dialog offers the catalogue", !!$("#tl-lang") && $$("#tl-lang option").length >= 30);
  const tl = $("#tl-title"); tl.value = "Renamed Global"; fire(tl, "input");
  $('[data-act="tl-save"]').click(); await sleep(700);
  check("title saved from the dialog", $("#ed-title").value === "Renamed Global");

  // --- Globalize panel: parent -> child translation model
  $('[data-act="sopts"]').click(); await sleep(20);
  $('[data-act="so-global"]').click(); await sleep(1400);
  check("Globalize panel explains the parent/child model",
    !!$("#lang-add-sel") && /parent/.test($("#st-modal").textContent) && /child/.test($("#st-modal").textContent),
    $("#st-modal") ? $("#st-modal").textContent.slice(0, 160) : "no modal");
  const selAdd = $("#lang-add-sel");
  selAdd.value = "es"; fire(selAdd, "change");
  $('[data-act="lang-add"]').click(); await sleep(1600);
  const childSlug = slug + "--es";
  check("creating a language opens its child survey editor",
    !!$(".st-child-note") && /Child of/.test($(".st-child-note").textContent),
    $(".st-child-note") ? $(".st-child-note").textContent : "no child note");
  const ta = $('textarea[data-tr="q:Q1:stem_html"]');
  const taRow = ta && ta.closest(".st-tr-row");
  check("child editor lists the parent's strings with context",
    !!taRow && /Pick one/.test(taRow.querySelector(".st-tr-src").textContent) && /Q1/.test(taRow.querySelector(".st-tr-ctx").textContent));
  ta.value = "Elige uno"; fire(ta, "input");
  $('[data-act="lang-save"]').click(); await sleep(1600);
  const childCfg = JSON.parse(await get("/api/studio/study?slug=" + childSlug)).cfg;
  const parentCfgNow = JSON.parse(await get("/api/studio/study?slug=" + slug)).cfg;
  check("translation stored on the child while the parent stays intact",
    childCfg.translations && childCfg.translations.es["q:Q1:stem_html"] === "Elige uno" &&
    !(parentCfgNow.translations || {}).es, JSON.stringify(childCfg.translations));
  check("child survey is connected to the parent and carries no question copy",
    childCfg.parent === slug && !(childCfg.questions || []).length);
  $('[data-act="child-open-parent"]').click(); await sleep(1000);
  check("Open parent returns to the parent builder", $("#ed-title") && $("#ed-title").value === "Renamed Global");
  $('[data-act="sopts"]').click(); await sleep(20);
  $('[data-act="so-global"]').click(); await sleep(1200);
  check("parent panel lists the child survey with coverage",
    $$(".st-lang-row").length === 1 && /Español/.test($(".st-lang-row").textContent) &&
    /child survey \//.test($(".st-lang-row").textContent),
    $(".st-lang-row") ? $(".st-lang-row").textContent : "none");
  $('[data-act="modal-close"]').click(); await sleep(20);

  // --- library: grouped add-item picker with every reference entry
  $('[data-act="qadd"]').click(); await sleep(30);
  const groups = $$(".st-type-group").map(g => g.textContent.trim());
  check("library groups: Questions / Methodologies / Survey flow / Objects",
    /Questions/.test(groups.join("|")) && /Methodologies/.test(groups.join("|")) &&
    /Survey flow/.test(groups.join("|")) && /Objects/.test(groups.join("|")), groups.join(" | "));
  const items = $$("#st-modal .st-type b").map(b => b.textContent.trim());
  ["Multiple Choice", "Grid / Rating Scale",
    "Rank Order", "Scale", "Text Entry", "Numeric Entry", "Net Promoter", "Constant Sum", "Max Diff",
    "Numeric Matrix", "Date", "Delta", "Conjoint", "Concept Test", "Heatmap",
    "Welcome Page", "Thank You Page", "Question Page", "Question Loop", "Page Randomizer",
    "Embedded Variable", "Text Block"  ].forEach(x => check("library item: " + x, items.includes(x), items.join(" | ")));

  // --- add a Date question through the library
  const dateBtn = $$("#st-modal .st-type").find(b => /(^|>)Date<|^Date$/.test(b.querySelector("b").textContent));
  dateBtn.click(); await sleep(60);
  check("Date question added with min/max editor", !!$("#f-datemin") && !!$("#f-datemax"));
  check("Date question live-previews", !!$("#st-prev-body input[type=date]"));

  // --- new-type renderers in the respondent preview engine
  const host = w.document.createElement("div"); w.document.body.appendChild(host);
  const R = (q, sel) => {
    host.innerHTML = "";
    w.BeaconSurveyPreview.render(host, q, { answers: {}, questions: [q], sections: [] }, "k" + q.type);
    return { html: host.innerHTML, has: s => !!host.querySelector(s), text: host.textContent };
  };
  let r = R({ id: "D1", type: "date", stem: "When?", section: "S1" }, "");
  check("date renders a calendar input", r.has("input[type=date]") && !/Cannot render/.test(r.text));
  r = R({ id: "M1", type: "numeric_matrix", stem: "How many?", section: "S1", min: 0, max: 10, rows: [{ code: "a", label: "Row A" }, { code: "b", label: "Row B" }] }, "");
  check("numeric matrix renders one number input per row", r.has(".nummatrix") && host.querySelectorAll(".nm-row input[type=number]").length === 2);
  r = R({ id: "X1", type: "delta", stem: "Change?", section: "S1", before_label: "Before", after_label: "After" }, "");
  check("delta renders before / after / change", r.has(".delta") && host.querySelectorAll(".delta input[type=number]").length === 2 && r.has(".delta-out"));
  r = R({ id: "C1", type: "concept_test", stem: "Rate", section: "S1", concept: "A new idea", scale: { min: 1, max: 7 }, rows: [{ code: "r1", label: "Clear" }] }, "");
  check("concept test shows the concept and its rating rows", r.has(".concept-test") && /A new idea/.test(r.text) && host.querySelectorAll(".concept-test .grid-row [role=slider]").length === 1);
  r = R({ id: "L1", type: "loop", stem: "Each", section: "S1", items: [{ code: "i1", label: "First" }, { code: "i2", label: "Second" }] }, "");
  check("question loop renders one box per item", r.has(".loopq") && host.querySelectorAll(".loop-row textarea").length === 2 && /First/.test(r.text));
  r = R({ id: "T1", type: "text_block", stem: "Notice", section: "S1", required: false, body: "Read this carefully" }, "");
  check("text block renders its copy", r.has(".textblock") && /Read this carefully/.test(r.text));

  // --- every sub page carries a back button to Questions
  $$("[data-tab]").find(b => b.getAttribute("data-tab") === "settings").click(); await sleep(40);
  check("settings page has a back-to-Questions button", !!$('[data-act="tab-back"]'));
  $('[data-act="tab-back"]').click(); await sleep(40);
  check("back button returns to the Questions workspace", !!$("#st-outline") && !!$("#st-editor"));
  $('[data-act="qadd"]').click(); await sleep(30);
  check("library modal has a Back button that closes it", !!$('#st-modal [data-act="modal-close"]') &&
    [...$$("#st-modal button")].some(b => /← Back/.test(b.textContent)));
  [...$$("#st-modal button")].find(b => /← Back/.test(b.textContent)).click(); await sleep(20);
  check("Back closes the library modal", $("#st-modal").hidden);

  // --- settings tab: survey pages & flow
  $$("[data-tab]").find(b => b.getAttribute("data-tab") === "settings").click(); await sleep(40);
  check("settings has survey pages & flow fields", !!$("#f-welcomet") && !!$("#f-welcome") && !!$("#f-thanks") && !!$("#f-embedded") && !!$("#f-randpages") && !!$("#f-deflang"));
  const wt = $("#f-welcomet"); wt.value = "Welcome to the global study"; fire(wt, "input");
  const emb = $("#f-embedded"); emb.value = "panel, rid"; fire(emb, "input");
  $("#f-randpages").click(); fire($("#f-randpages"), "change");
  await sleep(1700);
  const cfg2 = await saved();
  check("welcome copy + embedded vars + randomizer saved",
    cfg2.welcome_title === "Welcome to the global study" &&
    cfg2.embedded.map(e => e.name).join() === "panel,rid" && cfg2.randomize_pages === true,
    JSON.stringify({ wt: cfg2.welcome_title, emb: cfg2.embedded, rp: cfg2.randomize_pages }));

  // --- seed the Spanish welcome copy on the child like the panel would
  await req("POST", "/api/studio/translate", JSON.stringify({
    slug: childSlug, lang: "es", strings: {
      "study:welcome_title": "Bienvenido", "study:welcome_text": "Diez minutos de su tiempo.",
      "q:Q2:stem": "\u00BFPor qu\u00E9?" } }));

  // --- respondent side: child survey, family picker, per-question original toggle
  const url = "/survey/" + childSlug + "/test?panel=A";
  const dom2 = new JSDOM(await get(url), { url: BASE + url, runScripts: "outside-only", pretendToBeVisual: true });
  const w2 = dom2.window;
  w2.scrollTo = () => {}; w2.requestAnimationFrame = fn => setTimeout(fn, 0);
  w2.Element.prototype.scrollIntoView = function () {};
  w2.fetch = (u, o) => {
    const U = new URL(u, BASE);
    return req((o && o.method) || "GET", U.pathname + U.search, o && o.body)
      .then(x => ({ ok: x.status < 400, status: x.status, json: () => Promise.resolve(JSON.parse(x.body)) }));
  };
  const errs2 = []; w2.addEventListener("error", e => errs2.push(e.message));
  w2.STUDY = { slug: childSlug };
  for (const f of ["qlogic.js", "explainer.js", "survey.js"]) w2.eval(await get("/static/js/" + f));
  await sleep(900);
  const $2 = s2 => w2.document.querySelector(s2), $$2 = s2 => [...w2.document.querySelectorAll(s2)];
  check("child survey welcome renders the Spanish copy", $2("#welcome h1").textContent === "Bienvenido", $2("#welcome h1").textContent);
  const pick = $2("#lang-pick select");
  check("language picker lists the whole family with native names",
    !!pick && [...pick.options].map(o => o.value).join("|") === "en-US|es" && /Español/.test(pick.textContent),
    pick ? [...pick.options].map(o => o.value).join("|") : "no picker");
  w2.document.querySelector("#start-btn").click(); await sleep(500);
  check("first question renders translated", /Elige uno/.test($2("#app .card").textContent), $2("#app .card").textContent.slice(0, 120));
  const chip = $2(".i18n-chip");
  check("respondent can flip a question to the original wording", !!chip && /original/.test(chip.textContent));
  chip.click(); await sleep(60);
  check("flipped question shows the parent wording", /Pick one/.test($2("#app .card").textContent) && /Español/.test($2(".i18n-chip").textContent), $2("#app .card .stem").textContent);
  $2(".i18n-chip").click(); await sleep(60);
  check("flipping back restores the translation", /Elige uno/.test($2("#app .card").textContent));
  check("no JS errors in studio or survey", errs.length === 0 && errs2.length === 0, errs.concat(errs2).join("; "));

  await req("POST", "/api/studio/delete", JSON.stringify({ slug: childSlug }));
  await req("POST", "/api/studio/delete", JSON.stringify({ slug }));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error("ERR", e); process.exit(1); });
