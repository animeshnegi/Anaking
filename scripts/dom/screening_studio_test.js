/* jsdom check of the Studio screening UI:
 *   the Screening tab on every question, the three modes, building a rule over a group of
 *   options, the hand-picked "Try it" tester, the per-option Screen out switch, the outline
 *   badge, the design check, and that it all lands in the saved study.
 * Needs the server on :8000 and jsdom.
 *   node scripts/dom/screening_studio_test.js */
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (l, c, d = "") => { console.log((c ? "PASS  " : "FAIL  ") + l + (c ? "" : "  -> " + d)); if (!c) fails++; };

(async () => {
  const dom = new JSDOM(await get("/studio/"), { url: BASE + "/studio/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {}; w.requestAnimationFrame = f => setTimeout(f, 0);
  w.Element.prototype.scrollIntoView = function () {};
  w.confirm = () => true;
  w.BEACON_PREVIEW_MODE = true;                       // survey.js renders, never boots
  w.fetch = (u, o) => {
    const U = new URL(u, BASE);
    return req((o && o.method) || "GET", U.pathname + U.search, o && o.body)
      .then(x => ({ ok: x.status < 400, status: x.status, json: () => Promise.resolve(JSON.parse(x.body)) }));
  };
  const errs = []; w.addEventListener("error", e => errs.push(e.message));
  for (const f of ["qlogic.js", "survey.js", "explainer.js", "studio.js"]) w.eval(await get("/static/js/" + f));
  await sleep(800);
  const d = w.document, $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const click = el => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));

  // ---------- open the seeded BEACON study (it ships with screening on Q1 / Q3) ----------
  w.location.hash = "beacon";
  fire(w, "hashchange");
  await sleep(1200);
  check("the editor is open on BEACON", $$(".st-qi").length > 5, $$(".st-qi").length);

  const tabs = $$(".st-etab").map(b => b.textContent.replace(/\d+$/, "").trim());
  check("every question offers a Screening tab", tabs.includes("Screening"), JSON.stringify(tabs));
  check("the display-logic tab is called Show IF", tabs.includes("Show IF"), JSON.stringify(tabs));

  // ---------- Q1: options marked Screen out ----------
  // The switch mirrors the saved study: a question whose block is parked off shows off
  // (and hides everything); a question whose option switches fire with no authored block
  // shows on.  The live studio may hold either, so read the truth first.
  const beaconCfg = JSON.parse(await get("/api/studio/study?slug=beacon")).cfg;
  const q1Saved = (beaconCfg.questions || []).find(q => q.id === "Q1");
  const q1Off = !!(q1Saved && q1Saved.screening && q1Saved.screening.enabled === false);
  click($$(".st-etab").find(b => /Screening/.test(b.textContent))); await sleep(120);
  check("the Screening tab opens its card", !!$("#card-screening"), !!$("#card-screening"));
  check("the On/Off switch mirrors the saved study", $("#f-scr-on").checked === !q1Off,
    "checked=" + $("#f-scr-on").checked + " savedOff=" + q1Off);
  if (q1Off) {
    check("an off switch hides every piece of screening logic, option marks included",
      !$("#f-scr-rules") && !$("#card-screening .st-scr-test") &&
      !/Radiation oncology/.test($("#card-screening").textContent) &&
      /Screening is switched off/.test($("#card-screening").textContent),
      $("#card-screening").textContent.slice(0, 160));
  } else {
    check("the live option switches are named on the card",
      /Radiation oncology/.test($("#card-screening").textContent), $("#card-screening").textContent.slice(0, 120));
  }
  // Badge count tracks whatever screening is actually switched on in the live study
  // (authors flip the master switch between runs), so derive the expectation from it.
  const expectBadges = (beaconCfg.questions || []).filter(q => {
    const s = q.screening || {};
    return s.enabled !== false && ((s.rules || []).length || (s.rows || []).length);
  }).length;
  const badges = $$(".st-qi .st-badge.screen").length;
  check("the outline marks screening questions with a badge", badges === expectBadges,
    badges + " shown vs " + expectBadges + " with live screening");

  // ---------- the tester: pick an answer by hand (needs the switch on) ----------
  if (!q1Off) {
    const pickChip = label => $$("#card-screening .st-scr-test .st-chip").find(c => new RegExp(label).test(c.textContent));
    click(pickChip("Radiation oncology")); await sleep(120);
    check("picking a terminating option reads SCREENED OUT",
      /SCREENED OUT/.test(($(".st-scr-verdict") || {}).textContent || ""),
      ($(".st-scr-verdict") || {}).textContent);
    click(pickChip("Medical oncology")); await sleep(120);
    check("picking an eligible option reads CONTINUES",
      /CONTINUES/.test(($(".st-scr-verdict") || {}).textContent || ""),
      ($(".st-scr-verdict") || {}).textContent);
  }

  // ---------- build a group rule on a multi-select ----------
  // add a question we can shape freely: duplicate Q1 then make it multi select
  click($('[data-act="qdup"]')); await sleep(200);
  check("the duplicate opens in the editor", !!$("#f-id"), !!$("#f-id"));
  const typeSel = $("#f-type");
  typeSel.value = "multi_select"; fire(typeSel, "change"); await sleep(250);
  check("the question is now a multi select", $("#f-type").value === "multi_select", $("#f-type").value);

  const swOn = $("#f-scr-on");
  swOn.checked = true; fire(swOn, "change"); await sleep(250);
  check("choosing 'Screen out when…' seeds one condition", $$("#f-scr-rules .st-rule").length === 1,
    $$("#f-scr-rules .st-rule").length);
  // a duplicate can inherit its source's conditions - clear them to build from scratch
  $$("#f-scr-rules [data-act='scr-del']").forEach(x => { click(x); });
  await sleep(200);
  click($('[data-act="scr-add"]')); await sleep(200);
  check("a fresh condition starts on the current question", $$("#f-scr-rules .st-rule").length === 1,
    $$("#f-scr-rules .st-rule").length);
  check("the condition defaults to the current question",
    ($('[data-sf="q"]') || {}).value === $("#f-id").value, ($('[data-sf="q"]') || {}).value);

  const opSel = $('[data-sf="op"]');
  opSel.value = "any_of"; fire(opSel, "change"); await sleep(200);
  check("'is any of' offers a chip per option", $$("#f-scr-rules .st-scr-chips .st-chip").length >= 3,
    $$("#f-scr-rules .st-scr-chips .st-chip").length);
  const chips = $$("#f-scr-rules .st-scr-chips .st-chip");
  check("the condition keeps the option it already had", chips[0].classList.contains("on"), chips.map(c => c.textContent).join(" | "));
  click(chips[1]); await sleep(150);
  click($$("#f-scr-rules .st-scr-chips .st-chip")[2]); await sleep(150);
  const hidden = $('[data-sf="value"]');
  check("ticking chips builds the option group", hidden.value.split(",").length === 3, hidden.value);

  click($('[data-act="scr-add"]')); await sleep(200);
  check("a second condition can be added", $$("#f-scr-rules .st-rule").length === 2,
    $$("#f-scr-rules .st-rule").length);
  check("the connector reads 'and' for match=all",
    /and/.test($$("#f-scr-rules .st-rule-no")[1].textContent), $$("#f-scr-rules .st-rule-no")[1].textContent);

  const matchSel = $("#f-scr-match");
  matchSel.value = "any"; fire(matchSel, "change"); await sleep(200);
  check("switching to 'any' changes the connector",
    /or/.test($$("#f-scr-rules .st-rule-no")[1].textContent), $$("#f-scr-rules .st-rule-no")[1].textContent);

  check("the rule is written out in plain English",
    /screen out when/.test($(".st-scr-plain").textContent), $(".st-scr-plain").textContent.slice(0, 120));
  check("the tester reports what the rule does", !!$(".st-scr-verdict"), !!$(".st-scr-verdict"));

  // ---------- qualify mode + custom closing text ----------
  const qual = $$('input[name="f-scr-dir"]').find(r => r.value === "qualify");
  qual.checked = true; fire(qual, "change"); await sleep(250);
  check("Screen In rewords the plain-English line",
    /carry on only when/.test($(".st-scr-plain").textContent), $(".st-scr-plain").textContent.slice(0, 200));
  const msg = $("#f-scr-msg");
  msg.value = "Thank you - this study is for oncologists only.";
  fire(msg, "input"); await sleep(150);
  check("a closing message can be typed", ($("#f-scr-msg") || {}).value.length > 10);

  // ---------- the per-option switch ----------
  click($$(".st-etab").find(b => /Content/.test(b.textContent))); await sleep(200);
  const termFlag = $$('#card-answers .st-flag').find(l => /Screen out/.test(l.textContent));
  check("each answer option offers a Screen out switch", !!termFlag, !!termFlag);
  const box = termFlag.querySelector("input");
  box.checked = true; fire(box, "change"); await sleep(200);
  check("ticking it marks the option", !!$("#card-answers .st-flag.on"));

  // ---------- off means off: the switch mutes rules AND option switches ----------
  click($$(".st-etab").find(b => /Screening/.test(b.textContent))); await sleep(180);
  const badgesBefore = $$(".st-qi .st-badge.screen").length;
  check("the card is on while this question carries rules and an option switch",
    $("#f-scr-on").checked === true, $("#f-scr-on").checked);
  const swM = $("#f-scr-on");
  swM.checked = false; fire(swM, "change"); await sleep(280);
  check("switching off hides every screening control, tester and note",
    !$("#f-scr-rules") && !$("#card-screening .st-scr-test") &&
    !/oncology/i.test($("#card-screening").textContent) &&
    /Screening is switched off/.test($("#card-screening").textContent),
    $("#card-screening").textContent.slice(0, 160));
  check("...and the outline badge for this question goes away",
    $$(".st-qi .st-badge.screen").length === badgesBefore - 1,
    $$(".st-qi .st-badge.screen").length + " vs " + badgesBefore);
  const swM2 = $("#f-scr-on");
  swM2.checked = true; fire(swM2, "change"); await sleep(300);
  check("switching back on restores the rules, the tester and the option note",
    !!$("#f-scr-rules") && !!$("#card-screening .st-scr-test") &&
    /marked .Screen out.|Screen out/i.test($("#card-screening").textContent),
    $("#card-screening").textContent.slice(0, 160));

  // ---------- numbers: the operator row with a number box ----------
  click($('[data-act="qdup"]')); await sleep(250);           // a copy we can reshape freely
  click($$(".st-etab").find(b => /Screening/.test(b.textContent))); await sleep(150);
  let swN = $("#f-scr-on");
  if (swN.checked) { swN.checked = false; fire(swN, "change"); await sleep(220); }
  click($$(".st-etab").find(b => /Content/.test(b.textContent))); await sleep(200);
  const tSel1 = $("#f-type"); tSel1.value = "numeric"; fire(tSel1, "change"); await sleep(300);
  const numId = $("#f-id").value;
  click($$(".st-etab").find(b => /Screening/.test(b.textContent))); await sleep(150);
  check("the Screening tab opens with its own On / Off switch", !!$("#f-scr-on"), !!$("#f-scr-on"));
  swN = $("#f-scr-on"); swN.checked = true; fire(swN, "change"); await sleep(250);
  check("switching it on spells out what happens",
    /Respondents will/.test($("#card-screening").textContent) &&
    /if the answer criteria is met/.test($("#card-screening").textContent),
    $("#card-screening").textContent.slice(0, 200));
  // reshape whatever the duplicate inherited into one plain numeric condition
  // (pointing it at this question first resets the operator, so set q then op)
  {
    const qN = $('[data-sf="q"]');
    if (qN.value !== numId) { qN.value = numId; fire(qN, "change"); await sleep(240); }
    const opN = $('[data-sf="op"]');
    opN.value = "lt"; fire(opN, "change"); await sleep(240);
  }
  check("a numeric question opens with one condition", $$("#f-scr-rules .st-rule").length === 1,
    $$("#f-scr-rules .st-rule").length);
  let numBox = $('[data-sf="value"].st-scr-num');
  check("a numeric condition is a number box", !!numBox, ($("#f-scr-rules") || {}).innerHTML.slice(0, 200));
  check("the number box knows the question's own range",
    !!numBox && numBox.getAttribute("min") !== null, numBox && numBox.outerHTML);
  const numOps = [...($('[data-sf="op"]') || { options: [] }).options].map(o => o.textContent);
  check("the operator row is = \u2260 < \u2264 > \u2265 plus between / outside",
    ["<", "\u2264", ">", "\u2265", "=", "\u2260"].every(t => numOps.includes(t)) &&
    numOps.some(t => /between/.test(t)) && numOps.some(t => /outside/.test(t)), numOps.join(" | "));
  check("the operator reads as a symbol, not a sentence",
    ($('[data-sf="op"]').selectedOptions[0] || {}).textContent === "<",
    ($('[data-sf="op"]').selectedOptions[0] || {}).textContent);
  numBox.value = "25"; fire(numBox, "input"); await sleep(220);
  check("typing a number rewrites the plain-English line",
    new RegExp(numId + " < 25").test($(".st-scr-plain").textContent), $(".st-scr-plain").textContent);
  let opSel2 = $('[data-sf="op"]');
  opSel2.value = "between"; fire(opSel2, "change"); await sleep(240);
  check("'is between' swaps the single box for two",
    !!$('[data-sf="valueLo"]') && !!$('[data-sf="valueHi"]'), ($("#f-scr-rules") || {}).innerHTML.slice(0, 240));
  opSel2 = $('[data-sf="op"]');
  opSel2.value = "lt"; fire(opSel2, "change"); await sleep(240);
  numBox = $('[data-sf="value"].st-scr-num');
  numBox.value = "5"; fire(numBox, "input"); await sleep(220);
  check("the numeric rule settles back to one operator and a number",
    new RegExp(numId + " < 5").test($(".st-scr-plain").textContent), $(".st-scr-plain").textContent);
  check("a numeric answer is judged when Next is pressed",
    ($("#f-scr-when") || {}).value === "next", ($("#f-scr-when") || {}).value);

  await sleep(1500);                       // the autosave has landed - read it back
  const savedNum = JSON.parse(await get("/api/studio/study?slug=beacon")).cfg;
  const numSaved = (savedNum.questions || []).find(q => q.id === numId);
  check("the numeric rule reaches the saved study",
    !!numSaved && numSaved.screening && (numSaved.screening.rules[0] || {}).op === "lt" &&
    String((numSaved.screening.rules[0] || {}).value) === "5",
    JSON.stringify(numSaved && numSaved.screening));

  // ---------- allocation: Individual and Sum of responses ----------
  click($$(".st-etab").find(b => /Screening/.test(b.textContent))); await sleep(150);
  let swA = $("#f-scr-on");
  if (swA.checked) { swA.checked = false; fire(swA, "change"); await sleep(220); }
  click($$(".st-etab").find(b => /Content/.test(b.textContent))); await sleep(200);
  const tSel2 = $("#f-type"); tSel2.value = "sum_to_100"; fire(tSel2, "change"); await sleep(320);
  // the Constant Sum template starts with two answers - grow it so the dropdown has a list to show
  for (let r = 0; r < 5; r++) { const b = $('[data-act="it-add"][data-kind="row"]'); if (!b) break;
    click(b); await sleep(120); }
  await sleep(240);
  const rowCount = $$('[data-it="row"][data-k="label"]').length;
  const allocId = $("#f-id").value;
  click($$(".st-etab").find(b => /Screening/.test(b.textContent))); await sleep(150);
  swA = $("#f-scr-on"); swA.checked = true; fire(swA, "change"); await sleep(280);

  check("an allocation offers the two screener types",
    $$('input[name="f-scr-type"]').map(r => r.value).join(",") === "individual,sum",
    $$('input[name="f-scr-type"]').map(r => r.value).join(","));

  check("the condition it carried over from the numeric question is kept under More conditions",
    $$("#f-scr-rules .st-rule").length === 1 && /More conditions/.test($("#card-screening").textContent),
    $$("#f-scr-rules .st-rule").length);
  const addSel0 = $("#f-scr-add-row");
  check("both screeners offer a dropdown of every answer of the question",
    !!addSel0 && addSel0.options.length === rowCount + 1,
    !!addSel0 + " / " + ((addSel0 || { options: [] }).options.length) + " for " + rowCount + " answers");
  check("the dropdown opens on a prompt, not a blank",
    /Add an answer/.test((addSel0.options[0] || {}).textContent || ""),
    (addSel0.options[0] || {}).textContent);
  addSel0.value = addSel0.options[1].value; fire($("#f-scr-add-row"), "change"); await sleep(280);
  check("picking an answer from the dropdown gives it a Minimum and a Maximum",
    $$("[data-scr-min]").length === 1 && $$("[data-scr-max]").length === 1,
    $$("[data-scr-min]").length + "/" + $$("[data-scr-max]").length);
  check("the band names its answer in a dropdown of all the answers",
    $$("[data-scr-at]").length === 1 && $$("[data-scr-at]")[0].options.length === rowCount,
    $$("[data-scr-at]").length + " x " + ($$("[data-scr-at]")[0] || { options: [] }).options.length);
  const addSel = $("#f-scr-add-row");
  check("the add-an-answer dropdown lists every answer still free",
    addSel.options.length === rowCount, addSel.options.length);
  addSel.value = addSel.options[1].value; fire($("#f-scr-add-row"), "change"); await sleep(280);
  check("a second answer gets a band of its own", $$("[data-scr-min]").length === 2,
    $$("[data-scr-min]").length);
  check("...named in its own dropdown", $$("[data-scr-at]").length === 2, $$("[data-scr-at]").length);
  const bandMatch = $("#f-scr-match");
  check("two bands can be combined with any / all", !!bandMatch, !!bandMatch);
  bandMatch.value = "any"; fire($("#f-scr-match"), "change"); await sleep(260);
  const at0 = $$("[data-scr-at]")[0];
  const firstCode = at0.value, before = $(".st-scr-plain").textContent;
  const freeOpt = [...at0.options].find(o => !o.disabled && o.value !== at0.value);
  at0.value = freeOpt.value; fire($$("[data-scr-at]")[0], "change"); await sleep(280);
  check("a band can be re-pointed at another answer from the dropdown",
    $$("[data-scr-at]")[0].value !== firstCode && $(".st-scr-plain").textContent !== before &&
    new RegExp(allocId + ": .+ is outside 0 to 100 or " + allocId + ": .+ is outside 0 to 100")
      .test($(".st-scr-plain").textContent), $(".st-scr-plain").textContent);
  click($('[data-act="scr-del-row"]')); await sleep(280);
  check("an answer can be taken back out", $$("[data-scr-min]").length === 1,
    $$("[data-scr-min]").length);
  const addSel2 = $("#f-scr-add-row");
  addSel2.value = addSel2.options[1].value; fire($("#f-scr-add-row"), "change"); await sleep(280);
  check("and put back", $$("[data-scr-min]").length === 2, $$("[data-scr-min]").length);
  let min1 = $$("[data-scr-min]")[0], max1 = $$("[data-scr-max]")[0];
  min1.value = "20"; fire(min1, "input"); await sleep(220);
  max1.value = "60"; fire($$("[data-scr-max]")[0], "input"); await sleep(220);
  check("an Individual range reads as plain English",
    new RegExp(allocId + ": .+ is outside 20 to 60").test($(".st-scr-plain").textContent),
    $(".st-scr-plain").textContent);

  const dirIn = $$('input[name="f-scr-dir"]').find(r => r.value === "qualify");
  dirIn.checked = true; fire(dirIn, "change"); await sleep(260);
  check("Screen In turns the band round - carry on when the answer is inside it",
    /is between 20 and 60/.test($(".st-scr-plain").textContent) &&
    ($("#f-scr-outside") || {}).value === "inside", $(".st-scr-plain").textContent);
  const outsideSel = $("#f-scr-outside");
  outsideSel.value = "outside"; fire(outsideSel, "change"); await sleep(260);
  check("...and it can be turned back by hand",
    /is outside 20 to 60/.test($(".st-scr-plain").textContent), $(".st-scr-plain").textContent);
  const dirOut = $$('input[name="f-scr-dir"]').find(r => r.value === "screen_out");
  dirOut.checked = true; fire(dirOut, "change"); await sleep(260);

  // Sum of responses: equal to / less than / greater than / Min to Max
  const typeSum = $$('input[name="f-scr-type"]').find(r => r.value === "sum");
  typeSum.checked = true; fire(typeSum, "change"); await sleep(280);
  const cmpOpts = [...($("#f-scr-sum-op") || { options: [] }).options].map(o => o.value);
  check("Sum of responses offers equal to, less than, greater than and Min to Max",
    cmpOpts.join(",") === "eq,lt,gt,between", cmpOpts.join(","));
  const sumAdd = $("#f-scr-add-row");
  check("Sum of responses offers the same dropdown of every answer",
    !!sumAdd && sumAdd.options.length === rowCount - 1,
    (sumAdd || { options: [] }).options.length + " for " + rowCount + " answers, 2 already in");
  const thirdCode = sumAdd.options[1].value;
  sumAdd.value = thirdCode; fire($("#f-scr-add-row"), "change"); await sleep(280);
  check("an answer added from the dropdown joins the sum",
    new RegExp(allocId + ": the sum of [^=]+ \\+ [^=]+ \\+ [^=]+").test($(".st-scr-plain").textContent),
    $(".st-scr-plain").textContent);
  click($('[data-act="scr-pick-row"][data-code="' + thirdCode + '"]')); await sleep(280);
  check("...and the chips take it back out",
    new RegExp(allocId + ": the sum of [^=]+ \\+ [^=]+").test($(".st-scr-plain").textContent) &&
    !new RegExp("\\+ [^=]+ \\+ [^=]+ \\+ ").test($(".st-scr-plain").textContent),
    $(".st-scr-plain").textContent);
  let sumOp = $("#f-scr-sum-op");
  sumOp.value = "gt"; fire(sumOp, "change"); await sleep(260);
  let sumVal = $('[data-sf="f-scr-sum-val"]');
  sumVal.value = "80"; fire($('[data-sf="f-scr-sum-val"]'), "input"); await sleep(240);
  check("a sum rule reads as plain English",
    new RegExp(allocId + ": the sum of .+ > 80").test($(".st-scr-plain").textContent),
    $(".st-scr-plain").textContent);
  sumOp = $("#f-scr-sum-op");
  sumOp.value = "between"; fire(sumOp, "change"); await sleep(260);
  check("'Min to Max' swaps the single box for two",
    !!$('[data-sf="f-scr-sum-lo"]') && !!$('[data-sf="f-scr-sum-hi"]'),
    ($(".st-scr-sumrow") || {}).innerHTML);
  let loB = $('[data-sf="f-scr-sum-lo"]'), hiB = $('[data-sf="f-scr-sum-hi"]');
  loB.value = "10"; fire($('[data-sf="f-scr-sum-lo"]'), "input"); await sleep(200);
  hiB.value = "90"; fire($('[data-sf="f-scr-sum-hi"]'), "input"); await sleep(240);
  check("a Min to Max sum reads as a range",
    new RegExp(allocId + ": the sum of .+ is between 10 and 90").test($(".st-scr-plain").textContent),
    $(".st-scr-plain").textContent);
  sumOp = $("#f-scr-sum-op");
  sumOp.value = "eq"; fire(sumOp, "change"); await sleep(260);
  sumVal = $('[data-sf="f-scr-sum-val"]');
  sumVal.value = "100"; fire($('[data-sf="f-scr-sum-val"]'), "input"); await sleep(240);
  check("switching the comparison never loses the number",
    new RegExp(allocId + ": the sum of .+ = 100").test($(".st-scr-plain").textContent),
    $(".st-scr-plain").textContent);

  check("the tester takes an allocation row by row and shows the running total",
    $$("#card-screening .st-scr-rownum").length >= 2 && /Total/.test($("#card-screening .st-scr-test").textContent),
    $$("#card-screening .st-scr-rownum").length);
  const rowA = $$("#card-screening .st-scr-rownum");
  rowA[0].value = "95"; fire(rowA[0], "input"); await sleep(240);
  rowA[1].value = "5"; fire($$("#card-screening .st-scr-rownum")[1], "input"); await sleep(240);
  check("the tester verdict follows the numbers typed",
    /CONTINUES|SCREENED OUT/.test(($(".st-scr-verdict") || {}).textContent || ""),
    ($(".st-scr-verdict") || {}).textContent);

  // the row / group / total conditions are still there for anyone who wants them
  check("the row, group and total conditions live on under More conditions",
    $$(".st-scr-more [data-sf='op']").length >= 0 &&
    /More conditions/.test($("#card-screening").textContent));

  // ---------- switching it off keeps the rules, and switching back restores them ----------
  const swOff = $("#f-scr-on");
  swOff.checked = false; fire(swOff, "change"); await sleep(260);
  check("switching screening off hides the screener but keeps the sentence gone",
    !$(".st-scr-plain") && !$('input[name="f-scr-type"]'), !!$('input[name="f-scr-type"]'));
  click($$(".st-etab").find(b => /Content/.test(b.textContent))); await sleep(240);
  check("an off switch leaves no rule line on the question", !$(".st-scr-linebar"), !!$(".st-scr-linebar"));
  click($$(".st-etab").find(b => /Screening/.test(b.textContent))); await sleep(240);
  const swBack = $("#f-scr-on");
  swBack.checked = true; fire(swBack, "change"); await sleep(300);
  check("switching it back on brings the screener back exactly as it was",
    new RegExp(allocId + ": the sum of .+ = 100").test($(".st-scr-plain").textContent),
    ($(".st-scr-plain") || {}).textContent);

  // ---------- the rule is visible on the question, not only inside the tab ----------
  click($$(".st-etab").find(b => /Content/.test(b.textContent))); await sleep(260);
  check("the rule also shows as a line on the question itself",
    /screen out when/.test(($(".st-scr-linebar") || {}).textContent || ""),
    ($(".st-scr-linebar") || {}).textContent);
  check("the line carries a way back to the Screening tab",
    !!$$(".st-scr-linebar [data-act='edtab'][data-t='screen']").length);
  click($$(".st-etab").find(b => /Screening/.test(b.textContent))); await sleep(220);
  check("the Screening tab shows the sentence once, not twice",
    $$(".st-scr-plain").length === 1, $$(".st-scr-plain").length);

  // ---------- it all reaches the saved study ----------
  await sleep(1600);
  const saved = JSON.parse(await get("/api/studio/study?slug=beacon")).cfg;
  const allocSaved = (saved.questions || []).find(q => q.id === allocId && q.type === "sum_to_100");
  check("the Sum of responses screener reaches the saved study",
    !!allocSaved && allocSaved.screening && allocSaved.screening.type === "sum" &&
    (allocSaved.screening.rows || []).length === 2 &&
    (allocSaved.screening.sum || {}).op === "eq" && String((allocSaved.screening.sum || {}).value) === "100",
    JSON.stringify(allocSaved && allocSaved.screening));
  const mine = saved.questions.find(q => q.type === "multi_select" && q.screening);
  check("the screening block is saved with the question", !!mine, JSON.stringify((saved.questions || []).map(q => !!q.screening)));
  if (mine) {
    check("mode, match and message are stored",
      mine.screening.mode === "qualify" && mine.screening.match === "any" &&
      /Thank you/.test(mine.screening.message || ""), JSON.stringify(mine.screening));
    check("the option group is stored as codes",
      (mine.screening.rules[0].op === "any_of") && String(mine.screening.rules[0].value).split(",").length === 3,
      JSON.stringify(mine.screening.rules[0]));
    check("the option switch is stored on the option",
      (mine.options || []).some(o => o.terminate), JSON.stringify(mine.options));
  }
  check("no script errors", errs.length === 0, errs.join(" | "));

  // leave the study as we found it: drop the question we added
  const mine2 = (saved.questions || []).filter(q => q === mine || q.id === allocId || q.id === numId);
  if (mine2.length) {
    const del = { slug: "beacon", title: saved.title, cfg: saved };
    del.cfg.questions = saved.questions.filter(q => mine2.indexOf(q) < 0);
    await req("POST", "/api/studio/save", JSON.stringify(del));
  }
  console.log(fails ? "\n" + fails + " FAILED" : "\nall Studio screening checks passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
