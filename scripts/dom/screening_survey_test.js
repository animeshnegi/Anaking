/* jsdom check of the respondent side of screening: the BEACON study ships with screening
 * on Q1 (option switches), Q3 (a cross-question rule) and Q4, and the rules are data -
 * survey.js contains no hard-coded study logic any more.
 * Needs the server on :8000 and jsdom.
 *   node scripts/dom/screening_survey_test.js */
let JSDOM;
for (const p of ["jsdom", "/tmp/node_modules/jsdom", "/tmp/domtest/node_modules/jsdom"]) {
  try { ({ JSDOM } = require(p)); break; } catch (e) { /* try the next location */ }
}
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
const post = (p, body) => req("POST", p, JSON.stringify(body)).then(r => JSON.parse(r.body));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (l, c, d = "") => { console.log((c ? "PASS  " : "FAIL  ") + l + (c ? "" : "  -> " + d)); if (!c) fails++; };

let TEST_SLUG = "beacon";
async function session() {
  const dom = new JSDOM(await get("/survey/" + TEST_SLUG + "/test"), { url: BASE + "/survey/" + TEST_SLUG + "/test", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {}; w.requestAnimationFrame = f => setTimeout(f, 0);
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = (u, o) => {
    const U = new URL(u, BASE);
    return req((o && o.method) || "GET", U.pathname + U.search, o && o.body)
      .then(x => ({ ok: x.status < 400, status: x.status, json: () => Promise.resolve(JSON.parse(x.body)) }));
  };
  const errs = []; w.addEventListener("error", e => errs.push(e.message));
  // the page's inline window.STUDY never runs under jsdom - point it at the test study
  w.STUDY = { slug: TEST_SLUG, paused: false };
  for (const f of ["qlogic.js", "survey.js", "explainer.js"]) w.eval(await get("/static/js/" + f));
  await sleep(600);
  const d = w.document;
  return {
    w, d, errs,
    $: s => d.querySelector(s), $$: s => [...d.querySelectorAll(s)],
    click: el => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })),
    fire: (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true })),
  };
}

(async () => {
  // The live study's screening switch may be off (an author's choice), so the respondent
  // checks run on a throwaway clone whose Q1 switch is removed - the seeded option marks
  // then fire exactly as they did when the study shipped.
  {
    const base = JSON.parse(await get("/api/studio/study?slug=beacon")).cfg;
    const q1 = (base.questions || []).find(q => q.id === "Q1");
    if (q1) delete q1.screening;
    TEST_SLUG = (await post("/api/studio/save", { title: "Screening Survey Test", cfg: base })).slug;
    await post("/api/studio/status", { slug: TEST_SLUG, status: "live" });
  }

  // ---------------- an ineligible specialty ends the survey on the spot ----------------
  {
    const s = await session();
    s.click(s.$("#start-btn")); await sleep(400);
    check("the first question is the specialty screener", /Q1/i.test(s.$("#app").textContent),
      s.$("#app").textContent.slice(0, 80));
    const opts = s.$$("#app .opt");
    const rad = opts.find(o => /Radiation oncology/.test(o.textContent));
    s.click(rad); await sleep(500);
    check("picking Radiation oncology screens out immediately, without pressing Next",
      /End of survey/.test(s.$("#app").textContent), s.$("#app").textContent.slice(0, 160));
    check("the screen-out names the question", /Q1/.test(s.$("#app").textContent));
    check("no script errors on the spot", s.errs.length === 0, s.errs.join(" | "));
  }

  // ---------------- an eligible specialty carries straight on ----------------
  {
    const s = await session();
    s.click(s.$("#start-btn")); await sleep(400);
    const ok = s.$$("#app .opt").find(o => /Medical oncology/.test(o.textContent));
    s.click(ok); await sleep(400);
    check("an eligible specialty does not end the survey",
      !/End of survey/.test(s.$("#app").textContent), s.$("#app").textContent.slice(0, 120));
    const nextBtn = s.$$("#app .nav .btn").find(b => /Next/.test(b.textContent));
    s.click(nextBtn); await sleep(500);
    check("Next moves on to the next question", /Q2a|setting/i.test(s.$("#app").textContent),
      s.$("#app").textContent.slice(0, 120));
    check("no script errors while continuing", s.errs.length === 0, s.errs.join(" | "));
  }

  // ---------------- the server records why the respondent was screened out ----------------
  {
    const started = await post("/api/start", { study: TEST_SLUG, is_test: true });
    const sid = started.session_id;
    await post("/api/save", { session_id: sid, answers: { Q1: { _: 5 } }, screened_out: true,
      screen_out_at: "Q1", screen_out_reason: "Q1: Q1 is Radiation oncology", elapsed_seconds: 30 });
    const dash = JSON.parse(await get("/api/admin/data?study=" + TEST_SLUG));
    const row = (dash.recent || []).find(r => /Radiation oncology/.test(r.screen_out_reason || ""));
    check("the screen-out reason is stored on the respondent record", !!row,
      JSON.stringify((dash.recent || []).slice(0, 3)));
    check("...and the question it fired at is recorded too",
      !!row && row.screen_out === "Q1", row && row.screen_out);
  }

  await post("/api/studio/delete", { slug: TEST_SLUG });
  console.log(fails ? "\n" + fails + " FAILED" : "\nall respondent screening checks passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
