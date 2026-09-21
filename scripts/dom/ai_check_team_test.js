/* jsdom check of the team-facing side of the AI answer check: the Studio settings that
   switch it on/off, the per-question override, and the Admin "Written answers" review
   queue.  Needs a running server on :8000 and jsdom (npm i jsdom in /tmp):
   node scripts/dom/ai_check_team_test.js */
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
let fails = 0;
const check = (l, c, d = "") => { console.log((c ? "PASS  " : "FAIL  ") + l + (c ? "" : "  -> " + d)); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const AI = "Oncologists play a crucial role in navigating the complex landscape of treatment. " +
  "Moreover, the safety profile appears robust. Furthermore, once-weekly dosing offers a " +
  "compelling convenience advantage which could streamline clinic workflows. In conclusion, " +
  "uptake would be meaningful where infusion capacity is constrained.";

async function loadPage(path, files, setup) {
  const dom = new JSDOM(await get(path), { url: BASE + path, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {}; w.requestAnimationFrame = fn => setTimeout(fn, 0);
  w.Element.prototype.scrollIntoView = function () {};
  w.fetch = (u, o) => {
    const uu = new URL(u, BASE);
    return req((o && o.method) || "GET", uu.pathname + uu.search, o && o.body)
      .then(x => ({ ok: x.status < 400, status: x.status, json: () => Promise.resolve(JSON.parse(x.body)) }));
  };
  if (setup) setup(w);
  const errs = []; w.addEventListener("error", e => errs.push(e.message));
  for (const f of files) w.eval(await get("/static/js/" + f));
  await sleep(900);
  return { w, $: s => w.document.querySelector(s), $$: s => [...w.document.querySelectorAll(s)], errs };
}
const fire = (el, type) => el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));

(async () => {
  // ---- a study with one pasted chatbot answer and one typed human answer ---------------
  const cfg = {
    sections: [{ id: "S1", title: "A" }],
    questions: [
      { id: "Q1", section: "S1", type: "single_select", stem: "Setting?",
        options: [{ code: 1, label: "Community" }, { code: 2, label: "Other", other: true }] },
      { id: "Q2", section: "S1", type: "open_text", stem: "Why would you hesitate?", min_words: 3 }
    ],
    qc: { min_seconds: 5, verbatim_qs: ["Q2"], ai: { enabled: true, action: "confirm" } }
  };
  const slug = JSON.parse((await req("POST", "/api/studio/save",
    JSON.stringify({ title: "AI Team Test", cfg }))).body).slug;
  await req("POST", "/api/studio/status", JSON.stringify({ slug, status: "live" }));
  await req("POST", "/admin/reset?study=" + slug + "&scope=all");
  for (const text of [AI, "honestly the chairs are the problem for us. we are full by 9am most " +
    "days so anything shorter gets used. i'd want the AE breakdown first though."]) {
    const s = JSON.parse((await req("POST", "/api/start",
      JSON.stringify({ study: slug, is_test: true }))).body);
    await req("POST", "/api/save", JSON.stringify({
      session_id: s.session_id, elapsed_seconds: 600,
      answers: { Q2: { _: text, _meta: { keystrokes: text === AI ? 0 : 240,
        pastes: text === AI ? 1 : 0, pasted_chars: text === AI ? text.length : 0,
        input_events: text === AI ? 1 : 200, typed_ms: text === AI ? 200 : 55000 } } }
    }));
    await req("POST", "/api/submit", JSON.stringify({ session_id: s.session_id, elapsed_seconds: 600 }));
  }

  // ============================================================ Studio settings tab
  const S = await loadPage("/studio/#" + slug, ["qlogic.js", "survey.js", "explainer.js", "studio.js"],
    w => { w.BEACON_PREVIEW_MODE = true; });   // survey.js only lends its renderer in the Studio
  S.$('[data-tab="settings"]').click(); await sleep(300);
  check("settings tab offers the AI answer check", !!S.$("#f-aiaction") && !!S.$("#f-aiall") &&
        !!S.$("#f-aiwarn") && !!S.$("#f-aiflag"), S.$("#st-root").textContent.slice(0, 80));
  check("current study setting is shown", S.$("#f-aiaction").value === "confirm" &&
        S.$("#f-aiwarn").value === "35" && S.$("#f-aiflag").value === "60",
        [S.$("#f-aiaction").value, S.$("#f-aiwarn").value].join("/"));

  S.$("#f-aiaction").value = "warn"; fire(S.$("#f-aiaction"), "change");
  S.$("#f-aiwarn").value = "45"; fire(S.$("#f-aiwarn"), "input");
  S.$("#f-aiall").value = "listed"; fire(S.$("#f-aiall"), "change");
  await sleep(1800);                                          // autosave
  let saved = JSON.parse(await get("/api/studio/study?slug=" + slug)).cfg;
  check("study setting saved to the config",
        saved.qc.ai.enabled === true && saved.qc.ai.action === "warn" &&
        saved.qc.ai.warn_at === 45 && saved.qc.check_all_text === false,
        JSON.stringify({ ai: saved.qc.ai, all: saved.qc.check_all_text }));

  // switching the whole check off
  S.$("#f-aiaction").value = "off"; fire(S.$("#f-aiaction"), "change");
  await sleep(1800);
  saved = JSON.parse(await get("/api/studio/study?slug=" + slug)).cfg;
  check("the check can be switched off for the study", saved.qc.ai.enabled === false,
        JSON.stringify(saved.qc.ai));

  // ============================================================ per-question override
  S.$('[data-tab="questions"]').click(); await sleep(400);
  S.$$(".st-qi")[1].click(); await sleep(200);                // the open-text question
  check("the open-text editor offers its own override", !!S.$("#f-aiaction") &&
        /Study default/.test(S.$("#f-aiaction").textContent), S.$("#f-aiaction").textContent.slice(0, 60));
  S.$("#f-aiaction").value = "confirm"; fire(S.$("#f-aiaction"), "change");
  await sleep(1800);
  saved = JSON.parse(await get("/api/studio/study?slug=" + slug)).cfg;
  check("per-question action saved", saved.questions[1].ai_action === "confirm",
        JSON.stringify(saved.questions[1]));
  S.$("#f-aiaction").value = "off"; fire(S.$("#f-aiaction"), "change");
  await sleep(1800);
  saved = JSON.parse(await get("/api/studio/study?slug=" + slug)).cfg;
  check("per-question opt-out saved", saved.questions[1].ai_check === false,
        JSON.stringify(saved.questions[1]));
  check("no Studio JS errors", S.errs.length === 0, S.errs.join(" | "));
  S.w.close();

  // ============================================================ Admin review queue
  // back to "check everything, warn" so the queue has something to show
  cfg.qc.ai = { enabled: true, action: "confirm", warn_at: 35, flag_at: 60 };
  cfg.qc.check_all_text = true;
  delete cfg.questions[1].ai_check; delete cfg.questions[1].ai_action;
  await req("POST", "/api/studio/save", JSON.stringify({ title: "AI Team Test", cfg }));

  const A = await loadPage("/admin/?study=" + slug, ["admin.js"]);
  await sleep(1200);
  check("dashboard shows the AI roll-up",
        /Likely AI-generated/.test(A.$("#ai-summary").textContent) &&
        /Written answers scored/.test(A.$("#ai-summary").textContent),
        A.$("#ai-summary").textContent.replace(/\s+/g, " ").slice(0, 120));
  check("the queue opens on the flagged answers", A.$$(".vb").length === 1 &&
        A.$$(".vb.likely_ai").length === 1, String(A.$$(".vb").length));
  A.$("#ai-verdict").value = ""; fire(A.$("#ai-verdict"), "change"); await sleep(900);
  check("and can be widened to every written answer",
        A.$$(".vb").length === 2 && A.$$(".vb.human").length === 1,
        A.$$(".vb").map(x => x.className).join(" | "));
  const first = A.$$(".vb")[0];
  check("worst answer first, with score and evidence",
        /likely AI/i.test(first.querySelector(".vb-score").textContent) &&
        /\d+\/100/.test(first.querySelector(".vb-score").textContent) &&
        /no keystrokes recorded/.test(first.querySelector(".vb-meta").textContent) &&
        first.querySelector(".vb-why").textContent.length > 10,
        first.textContent.replace(/\s+/g, " ").slice(0, 160));
  check("the question filter lists the open-text questions",
        A.$$("#ai-qid option").length === 2 && /Q2/.test(A.$("#ai-qid").textContent),
        A.$("#ai-qid").textContent.slice(0, 60));

  A.$("#ai-verdict").value = "likely_ai"; fire(A.$("#ai-verdict"), "change");
  await sleep(900);
  check("verdict filter narrows the queue", A.$$(".vb").length === 1 &&
        A.$$(".vb.likely_ai").length === 1, String(A.$$(".vb").length));
  A.$("#ai-verdict").value = ""; fire(A.$("#ai-verdict"), "change"); await sleep(700);
  A.$("#ai-search").value = "chairs";
  A.$("#ai-search").dispatchEvent(new A.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(900);
  check("text search finds a specific answer", A.$$(".vb").length === 1 &&
        /chairs/.test(A.$(".vb-text").textContent), A.$("#ai-list").textContent.slice(0, 80));
  A.$("#ai-search").value = "zzzz-no-match";
  A.$("#ai-search").dispatchEvent(new A.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(900);
  check("an empty result says so", /Nothing flagged|No written answers/.test(A.$("#ai-list").textContent),
        A.$("#ai-list").textContent.slice(0, 90));
  check("no Admin JS errors", A.errs.length === 0, A.errs.join(" | "));
  A.w.close();

  console.log(fails ? "\n" + fails + " check(s) FAILED" : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error("ERROR", e); process.exit(1); });
