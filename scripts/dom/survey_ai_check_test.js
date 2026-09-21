/* jsdom check of the respondent-side AI answer check: live warning chip while typing,
   the "I wrote this myself" gate, paste/keystroke telemetry and the final proofreading
   step before submit.  Needs a running server on :8000 and jsdom (npm i jsdom in /tmp):
   node scripts/dom/survey_ai_check_test.js */
const path = require("path");
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
  "Moreover, the safety profile appears robust and manageable. Furthermore, once-weekly " +
  "dosing offers a compelling convenience advantage which could streamline clinic workflows. " +
  "In conclusion, uptake would be meaningful where capacity is constrained.";
const HUMAN = "honestly the once-a-week shot is the big one for us. chairs are full by 9am so " +
  "anything that frees a chair gets used. the AE rate worries me a bit though - 30% grade 3+ " +
  "is not nothing. probably 10-15% of my patients in year 1.";

async function openSurvey(slug) {
  const url = "/survey/" + slug + "/test";
  const dom = new JSDOM(await get(url), { url: BASE + url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {}; w.requestAnimationFrame = fn => setTimeout(fn, 0);
  w.Element.prototype.scrollIntoView = function () {};
  w.fetch = (u, o) => {
    const url2 = new URL(u, BASE);
    return req((o && o.method) || "GET", url2.pathname + url2.search, o && o.body)
      .then(x => ({ ok: x.status < 400, status: x.status, json: () => Promise.resolve(JSON.parse(x.body)) }));
  };
  // the page's own inline <script> does not run under runScripts:"outside-only"
  w.STUDY = { slug: slug };
  const errs = []; w.addEventListener("error", e => errs.push(e.message));
  for (const f of ["qlogic.js", "explainer.js", "survey.js"]) w.eval(await get("/static/js/" + f));
  await sleep(900);
  const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
  $("#start-btn").click();
  await sleep(400);
  return { w, $, $$, errs, slug };
}

async function makeStudy(title, aiCfg) {
  const cfg = {
    sections: [{ id: "S1", title: "A" }],
    questions: [
      { id: "Q1", section: "S1", type: "single_select", stem: "Your setting?",
        options: [{ code: 1, label: "Community" }, { code: 2, label: "Academic" }] },
      { id: "Q2", section: "S1", type: "open_text", stem: "Why would you hesitate?", min_words: 3 }
    ],
    qc: { min_seconds: 5, ai: aiCfg }
  };
  const slug = JSON.parse((await req("POST", "/api/studio/save",
    JSON.stringify({ title, cfg }))).body).slug;
  await req("POST", "/api/studio/status", JSON.stringify({ slug, status: "live" }));
  await req("POST", "/admin/reset?study=" + slug + "&scope=all");   // start from a clean field
  return slug;
}

// replace the contents of a box the way a respondent does: keystrokes, not a value swap
async function retype(S, ta, text) {
  ta.focus();
  ta.value = "";
  ta.dispatchEvent(new S.w.Event("input", { bubbles: true }));
  for (let i = 0; i < text.length; i += 5) {
    ta.dispatchEvent(new S.w.KeyboardEvent("keydown", { key: "a", bubbles: true }));
    ta.value = text.slice(0, i + 5);
    ta.dispatchEvent(new S.w.Event("input", { bubbles: true }));
    await sleep(1);
  }
  await sleep(150);
}

const sidKey = slug => "study_" + slug + "_test_session_id";
const sessionOf = S => JSON.parse(S.w.localStorage.getItem(sidKey(S.slug)));

// type a real answer, or "paste" a chatbot one, into the open-text box
async function answer(S, text, pasted) {
  const ta = S.$("textarea");
  ta.focus();
  if (pasted) {
    const ev = new S.w.Event("paste", { bubbles: true });
    ev.clipboardData = { getData: () => text };
    ta.dispatchEvent(ev);                            // paste, then the input event it causes
    ta.value = text;
    ta.dispatchEvent(new S.w.Event("input", { bubbles: true }));
  } else {
    await retype(S, ta, text);                       // grow the box one keystroke at a time
  }
  await sleep(1600);                                  // debounce + /api/check_text round trip
}

(async () => {
  // ============ 1. "confirm" mode: warn in the moment, then ask them to own the answer
  const confirmSlug = await makeStudy("AI Check Confirm", { enabled: true, action: "confirm" });
  let S = await openSurvey(confirmSlug);
  S.$$(".opts .opt")[0].click(); await sleep(120);
  S.$(".nav .btn.primary").click(); await sleep(350);
  check("open-text question reached", !!S.$("textarea"));

  await answer(S, AI, true);
  const chip = S.$(".oq-chip");
  check("pasted chatbot answer raises the AI chip", chip.classList.contains("ai"),
        chip.className + " / " + chip.textContent.slice(0, 80));
  check("chip names the evidence and the score", /AI-written/i.test(chip.textContent) &&
        /\d+\/100/.test(chip.textContent), chip.textContent.slice(0, 120));
  check("respondent is offered a way to confirm or rewrite",
        S.$$(".ai-actions .g-btn").length === 2, String(S.$(".ai-actions").textContent));

  S.$(".nav .btn.primary").click(); await sleep(300);
  const err = S.$("#err");
  check("Next is held until the answer is owned or rewritten",
        err.classList.contains("show") && /AI-written/.test(err.textContent), err.textContent);

  S.$$(".ai-actions .g-btn")[0].click(); await sleep(200);
  check("confirming switches the chip to a thank-you", /own words/.test(S.$(".oq-chip").textContent),
        S.$(".oq-chip").textContent.slice(0, 90));
  const sid = sessionOf(S);                              // the session is cleared on submit
  S.$(".nav .btn.primary").click(); await sleep(1200);
  check("and lets them submit", /Thank you/.test(S.$("#app").textContent),
        S.$("#app").textContent.slice(0, 90));

  // telemetry + verdict were stored with the answer
  const prog = JSON.parse(await get("/api/progress?sid=" + encodeURIComponent(sid)));
  const meta = prog.answers.Q2._meta || {};
  check("paste telemetry stored with the answer", meta.pastes === 1 && meta.pasted_chars === AI.length,
        JSON.stringify(meta));
  check("client verdict stored with the answer",
        prog.answers.Q2._ai && prog.answers.Q2._ai.verdict === "likely_ai" && prog.answers.Q2._ai.ack === true,
        JSON.stringify(prog.answers.Q2._ai));
  S.w.close();

  // ============ 2. a typed, human answer stays clean
  S = await openSurvey(confirmSlug);
  S.$$(".opts .opt")[1].click(); await sleep(120);
  S.$(".nav .btn.primary").click(); await sleep(350);
  await answer(S, HUMAN, false);
  check("typed human answer reads clean", S.$(".oq-chip").classList.contains("ok") &&
        /own words/.test(S.$(".oq-chip").textContent), S.$(".oq-chip").textContent.slice(0, 90));
  check("no confirm button is demanded", S.$$(".ai-actions .g-btn").length === 0);
  const sid2 = sessionOf(S);
  S.$(".nav .btn.primary").click(); await sleep(1800);
  check("a human answer submits with no AI flag",
        /Thank you/.test(S.$("#app").textContent) && !/ai_/.test(S.$("#app").textContent),
        S.$("#app").textContent.slice(-160));
  const prog2 = JSON.parse(await get("/api/progress?sid=" + encodeURIComponent(sid2)));
  check("keystroke telemetry recorded while typing",
        ((prog2.answers.Q2 || {})._meta || {}).keystrokes > 10,
        JSON.stringify((prog2.answers.Q2 || {})._meta));
  S.w.close();

  // ============ 3. "warn" mode: never blocked, but the proofreading step still catches it
  const warnSlug = await makeStudy("AI Check Warn", { enabled: true, action: "warn" });
  S = await openSurvey(warnSlug);
  S.$$(".opts .opt")[0].click(); await sleep(120);
  S.$(".nav .btn.primary").click(); await sleep(350);
  await answer(S, AI, true);
  check("warn mode shows the chip without a confirm button",
        S.$(".oq-chip").classList.contains("ai") && S.$$(".ai-actions .g-btn").length === 1,
        String(S.$(".ai-actions").textContent));
  S.$(".nav .btn.primary").click(); await sleep(1800);
  check("the final proofreading step opens before submit", !!S.$(".proof-card"),
        S.$("#app").textContent.slice(0, 90));
  check("it lists the flagged answer with the reasons",
        S.$$(".proof-row").length === 1 && /AI/.test(S.$(".proof-chips").textContent),
        S.$(".proof-list").textContent.slice(0, 120));
  check("and offers a rewrite box plus an own-words button",
        !!S.$(".proof-text") && S.$(".proof-text").value === AI &&
        /I wrote this myself/.test(S.$(".proof-acts").textContent));

  await retype(S, S.$(".proof-text"), HUMAN);          // rewrite it in the review box
  S.$$(".proof-acts .g-btn")[1].click();               // re-check the edited answer
  await sleep(1400);
  check("re-checking an edited answer clears it", S.$$(".proof-row").length === 0,
        S.$(".proof-list").textContent.slice(0, 120));
  S.$(".proof-card .nav .btn.primary").click(); await sleep(1500);
  check("and the survey submits", /Thank you/.test(S.$("#app").textContent),
        S.$("#app").textContent.slice(0, 90));
  check("no page errors were thrown", S.errs.length === 0, S.errs.join(" | "));
  S.w.close();

  // the queue in Admin sees the same scores
  const queue = JSON.parse(await get("/api/admin/verbatims?study=" + warnSlug));
  check("Admin queue holds the rewritten answer as genuine",
        queue.rows.length === 1 && queue.rows[0].verdict === "human" &&
        queue.rows[0].score < 35, JSON.stringify(queue.rows.map(r => [r.verdict, r.score])));

  console.log(fails ? "\n" + fails + " check(s) FAILED" : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error("ERROR", e); process.exit(1); });
