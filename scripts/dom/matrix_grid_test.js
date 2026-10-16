/* jsdom check of matrix / grid / rating-scale questions:
 *   Studio  - title, rows and columns (add, duplicate, move, delete, label, format, attach),
 *             Swap rows / columns, the exclusive N/A, comment boxes, and row / column order.
 *   Engine  - the five orderings, applied to rows and to columns on their own.
 *   Survey  - the rendered grid: column captions, N/A, comments, media, heat map, emoji grid.
 * Needs the server on :8000 and jsdom.
 *   node scripts/dom/matrix_grid_test.js */
let JSDOM;
for (const p of ["jsdom", "/tmp/node_modules/jsdom", "/home/user/domtest/node_modules/jsdom"]) {
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

// ---------------------------------------------------------------- a studio session
async function studio(slug) {
  const dom = new JSDOM(await get("/studio/"), { url: BASE + "/studio/#" + slug, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.BEACON_PREVIEW_MODE = true; w.requestAnimationFrame = fn => setTimeout(fn, 0);
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {}; w.confirm = () => true;
  w.fetch = (u, o) => {
    const U = new URL(u, BASE);
    return req((o && o.method) || "GET", U.pathname + U.search, o && o.body)
      .then(x => ({ ok: x.status < 400, status: x.status, json: () => Promise.resolve(JSON.parse(x.body)) }));
  };
  const errs = []; w.addEventListener("error", e => errs.push(e.message));
  for (const f of ["qlogic.js", "survey.js", "explainer.js", "studio.js"]) w.eval(await get("/static/js/" + f));
  await sleep(900);
  const d = w.document;
  const $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
  return {
    w, d, errs, $, $$,
    fire: (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true })),
    click: el => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })),
    open: async (id) => {
      const qi = $$(".st-qi").find(n => n.querySelector(".st-qi-id") && n.querySelector(".st-qi-id").textContent === id);
      if (!qi) throw new Error("no outline row " + id);
      qi.querySelector(".st-qi-id").dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
      await sleep(260);
    },
    saved: async () => JSON.parse(await get("/api/studio/study?slug=" + slug)).cfg,
  };
}
const rowsOf = s => s.$$('[data-kind="row"] .st-item:not(.st-item-head)');
const colsOf = s => s.$$('[data-kind="col"] .st-item:not(.st-item-head)');
const ptsOf = s => s.$$('[data-kind="pt"] .st-item:not(.st-item-head)');

(async () => {
  // =============================================================== Studio: the grid editor
  const cfg = {
    sections: [{ id: "S1", title: "Grids" }],
    questions: [
      { id: "G1", section: "S1", type: "rating_grid", stem: "How well does each describe it?",
        select: "single",
        rows: [{ code: "a", label: "Ease of use" }, { code: "b", label: "Trust" }, { code: "c", label: "Value" }],
        cols: [{ code: "c1", label: "Poor" }, { code: "c2", label: "Okay" }, { code: "c3", label: "Great" }] },
      { id: "G5", section: "S1", type: "rating_grid", stem: "An older scale-based grid",
        rows: [{ code: "a", label: "One" }, { code: "b", label: "Two" }],
        scale: { min: 1, max: 3, points: [{ v: 1, label: "Low" }, { v: 3, label: "High" }] } },
      { id: "G2", section: "S1", type: "numeric_matrix", stem: "How many patients a year?",
        rows: [{ code: "r1", label: "Treated" }, { code: "r2", label: "Eligible" }] },
      { id: "G3", section: "S1", type: "heatmap", stem: "Where do you want more evidence?",
        rows: [{ code: "OS", label: "Overall survival" }, { code: "AE", label: "Side effects" }],
        cols: [{ code: "cte", label: "Trial evidence" }, { code: "rwe", label: "Real world" }] },
      { id: "G4", section: "S1", type: "emoji_grid", stem: "Your gut reaction",
        rows: [{ code: "t", label: "Trust" }, { code: "i", label: "Innovation" }],
        scale: { min: 1, max: 5, faces: ["\uD83D\uDE1E", "\uD83D\uDE15", "\uD83D\uDE10", "\uD83D\uDE42", "\uD83D\uDE0D"] } },
      { id: "R1", section: "S1", type: "rating_scale", stem: "How well does each describe you?",
        rows: [{ code: "a", label: "Ease of use" }, { code: "b", label: "Trust" }],
        scale: { min: 1, max: 5, min_label: "Not at all", mid_label: "Neutral", max_label: "Extremely" } },
    ],
    tpp: {}, explainer_scenes: [],
  };
  const slug = (await post("/api/studio/save", { title: "Matrix Test", cfg })).slug;
  const s = await studio(slug);

  // ---------------------------------------------------------------- the grid: rows x columns
  await s.open("G1");
  check("a grid opens with the single / multi select dropdown at the top",
    !!s.$("#f-gselect") && s.$("#f-gselect").value === "single" &&
    [...s.$("#f-gselect").options].map(o => o.value).join(",") === "single,multi");
  check("a grid keeps its title and a name for each axis",
    !!s.$("#f-gtitle") && !!s.$("#f-rowlabel") && !!s.$("#f-collabel"));
  check("it lists its rows and its columns - the scale section is gone",
    rowsOf(s).length === 3 && colsOf(s).length === 3 && !s.$("#f-smin") && !s.$('[data-kind="pt"]'),
    rowsOf(s).length + " rows / " + colsOf(s).length + " cols");
  check("every row offers add, duplicate, move, delete and an attachment",
    !!s.$('[data-act="it-add"][data-kind="row"]') && !!s.$('[data-act="it-dup"][data-kind="row"]') &&
    !!s.$('[data-act="it-up"][data-kind="row"]') && !!s.$('[data-act="it-del"][data-kind="row"]') &&
    !!s.$('[data-act="it-media"][data-kind="row"]') &&
    /audio/.test(s.$('[data-act="it-media"][data-kind="row"]').accept),
    s.$('[data-act="it-media"][data-kind="row"]').accept);
  check("every column offers add, duplicate, move, delete and an attachment",
    !!s.$('[data-act="it-add"][data-kind="col"]') && !!s.$('[data-act="it-dup"][data-kind="col"]') &&
    !!s.$('[data-act="it-up"][data-kind="col"]') && !!s.$('[data-act="it-del"][data-kind="col"]') &&
    !!s.$('[data-act="it-media"][data-kind="col"]') &&
    /audio/.test(s.$('[data-act="it-media"][data-kind="col"]').accept));
  check("every row has a comment box of its own and a format",
    s.$$('select[data-it="row"][data-k="comment"]').length === 3 &&
    s.$$('select[data-it="row"][data-k="fmt"]').length === 3);

  // ---- columns: add, duplicate, move, delete, label
  s.click(s.$('[data-act="it-add"][data-kind="col"]')); await sleep(240);
  check("+ Add column grows the grid", colsOf(s).length === 4, colsOf(s).length);
  s.click(s.$$('[data-act="it-dup"][data-kind="col"]')[0]); await sleep(240);
  check("a column can be duplicated in place", colsOf(s).length === 5 &&
    /\(copy\)$/.test(s.$$('[data-it="col"][data-k="label"]')[1].value),
    s.$$('[data-it="col"][data-k="label"]').map(n => n.value).join("|"));
  check("the copy gets a code of its own",
    s.$$('[data-it="col"][data-k="code"]')[0].value !== s.$$('[data-it="col"][data-k="code"]')[1].value,
    s.$$('[data-it="col"][data-k="code"]').map(n => n.value).join(","));
  s.click(s.$$('[data-act="it-down"][data-kind="col"]')[1]); await sleep(240);
  check("a column can be moved along the header",
    /\(copy\)/.test(s.$$('[data-it="col"][data-k="label"]')[2].value),
    s.$$('[data-it="col"][data-k="label"]').map(n => n.value).join("|"));
  s.click(s.$$('[data-act="it-del"][data-kind="col"]')[2]); await sleep(240);
  check("a column can be deleted", colsOf(s).length === 4 &&
    !s.$$('[data-it="col"][data-k="label"]').some(n => /\(copy\)/.test(n.value)));
  s.click(s.$$('[data-act="it-del"][data-kind="col"]')[3]); await sleep(240);
  check("...and the grid is back to its three columns", colsOf(s).length === 3, colsOf(s).length);
  const col0 = s.$$('[data-it="col"][data-k="label"]')[0];
  col0.value = "Not good"; s.fire(col0, "change"); await sleep(240);
  check("each column keeps its own label",
    s.$$('[data-it="col"][data-k="label"]')[0].value === "Not good",
    s.$$('[data-it="col"][data-k="label"]').map(n => n.value).join("|"));

  // ---- rows
  s.click(s.$('[data-act="it-add"][data-kind="row"]')); await sleep(240);
  check("+ Add row grows the grid", rowsOf(s).length === 4, rowsOf(s).length);
  s.click(s.$$('[data-act="it-dup"][data-kind="row"]')[1]); await sleep(240);
  check("a row can be duplicated in place", rowsOf(s).length === 5 &&
    /\(copy\)$/.test(s.$$('[data-it="row"][data-k="label"]')[2].value),
    s.$$('[data-it="row"][data-k="label"]').map(n => n.value).join("|"));
  check("the copy gets a code of its own",
    s.$$('[data-it="row"][data-k="code"]')[1].value !== s.$$('[data-it="row"][data-k="code"]')[2].value,
    s.$$('[data-it="row"][data-k="code"]').map(n => n.value).join(","));
  s.click(s.$$('[data-act="it-up"][data-kind="row"]')[2]); await sleep(240);
  check("a row can be moved up the grid",
    /\(copy\)/.test(s.$$('[data-it="row"][data-k="label"]')[1].value),
    s.$$('[data-it="row"][data-k="label"]').map(n => n.value).join("|"));
  s.click(s.$$('[data-act="it-del"][data-kind="row"]')[1]); await sleep(240);
  check("a row can be deleted", rowsOf(s).length === 4 &&
    !s.$$('[data-it="row"][data-k="label"]').some(n => /\(copy\)/.test(n.value)));

  // ---- the title and the two group names
  const gt = s.$("#f-gtitle"); gt.value = "How well does each describe it?"; s.fire(gt, "change"); await sleep(200);
  const rl = s.$("#f-rowlabel"); rl.value = "Statement"; s.fire(rl, "change"); await sleep(200);
  const cl = s.$("#f-collabel"); cl.value = "Rating"; s.fire(cl, "change"); await sleep(200);

  // ---- single select or multi select, chosen from the dropdown at the top
  const gs = s.$("#f-gselect"); gs.value = "multi"; s.fire(gs, "change"); await sleep(240);
  check("the dropdown switches the grid to multi select", s.$("#f-gselect").value === "multi");

  // ---- the exclusive N/A, on every row
  const naR = s.$("#f-na-rows"); naR.checked = true; s.fire(naR, "change"); await sleep(240);
  const naL = s.$("#f-na-label"); naL.value = "Not applicable"; s.fire(naL, "change"); await sleep(240);
  check("the grid offers the exclusive N/A on every row",
    s.$("#f-na-rows").checked && !s.$("#f-na-col") && s.$("#f-na-label").value === "Not applicable");

  // ---- the order of the rows and of the columns
  const rzRows = s.$("#f-rz-rows");
  check("the rows offer every way of ordering them",
    rzRows && [...rzRows.options].map(o => o.value).join(",") === "none,shuffle,rotate,reverse,revall",
    rzRows && [...rzRows.options].map(o => o.value).join(","));
  rzRows.value = "shuffle"; s.fire(rzRows, "change"); await sleep(240);
  const rzCols = s.$("#f-rz-cols");
  rzCols.value = "rotate"; s.fire(rzCols, "change"); await sleep(240);
  check("rows and columns are ordered independently",
    s.$("#f-rz-rows").value === "shuffle" && s.$("#f-rz-cols").value === "rotate");

  // ---- Swap rows / columns: the two lists change places
  const before = {
    rows: s.$$('[data-it="row"][data-k="label"]').map(n => n.value).join("|"),
    cols: s.$$('[data-it="col"][data-k="label"]').map(n => n.value).join("|"),
  };
  s.click(s.$('[data-act="mtx-swap"]')); await sleep(320);
  check("Swap turns the rows into columns and the columns into rows",
    colsOf(s).length === 4 && rowsOf(s).length === 3,
    colsOf(s).length + " cols / " + rowsOf(s).length + " rows");
  check("...and the wording travels with them",
    s.$$('[data-it="row"][data-k="label"]').map(n => n.value).join("|") === before.cols &&
    s.$$('[data-it="col"][data-k="label"]').map(n => n.value).join("|") === before.rows,
    s.$$('[data-it="row"][data-k="label"]').map(n => n.value).join("|") + " / " +
    s.$$('[data-it="col"][data-k="label"]').map(n => n.value).join("|"));
  s.click(s.$('[data-act="mtx-swap"]')); await sleep(320);
  check("swapping again puts it back the way it was",
    rowsOf(s).length === 4 && colsOf(s).length === 3 &&
    s.$$('[data-it="row"][data-k="label"]').map(n => n.value).join("|") === before.rows,
    rowsOf(s).length + " / " + colsOf(s).length);

  // ---- comments for the whole question
  const cm = s.$("#f-cmt-mode"); cm.value = "allow"; s.fire(cm, "change"); await sleep(240);
  const cl2 = s.$("#f-cmt-label"); cl2.value = "Anything else we should know?"; s.fire(cl2, "change"); await sleep(240);
  check("the question carries its own comment box, allowed or required",
    s.$("#f-cmt-mode").value === "allow" && s.$("#f-cmt-label").value === "Anything else we should know?");
  const reqRows = s.$("#f-cmt-rows");
  check("the comment can be made mandatory for chosen rows",
    !!reqRows && reqRows.options.length === 4 && reqRows.multiple, reqRows && reqRows.options.length);
  reqRows.options[2].selected = true; s.fire(reqRows, "change"); await sleep(240);

  // ---- per row: comment box and format
  const cmtSel = s.$$('select[data-it="row"][data-k="comment"]')[0];
  cmtSel.value = "require"; s.fire(cmtSel, "change"); await sleep(260);
  const fmtSel = s.$$('select[data-it="row"][data-k="fmt"]')[0];
  fmtSel.value = "b"; s.fire(fmtSel, "change"); await sleep(260);
  check("a row can demand a comment and be set in bold",
    s.$$('select[data-it="row"][data-k="comment"]')[0].value === "require" &&
    s.$$('select[data-it="row"][data-k="fmt"]')[0].value === "b");

  // ---------------------------------------------------------------- the numeric matrix
  await s.open("G2");
  check("a numeric matrix opens with a column list of its own", !!s.$('[data-act="it-add"][data-kind="col"]'));
  s.click(s.$('[data-act="it-add"][data-kind="col"]')); await sleep(240);
  s.click(s.$('[data-act="it-add"][data-kind="col"]')); await sleep(240);
  const colLab = s.$$('[data-it="col"][data-k="label"]')[0];
  colLab.value = "This year"; s.fire(colLab, "change"); await sleep(240);
  const colLab2 = s.$$('[data-it="col"][data-k="label"]')[1];
  colLab2.value = "Next year"; s.fire(colLab2, "change"); await sleep(240);
  check("columns can be added and labelled", colsOf(s).length === 2 &&
    s.$$('[data-it="col"][data-k="label"]')[0].value === "This year",
    colsOf(s).length);
  s.click(s.$$('[data-act="it-dup"][data-kind="col"]')[0]); await sleep(240);
  s.click(s.$$('[data-act="it-del"][data-kind="col"]')[2]); await sleep(240);
  check("a column can be duplicated and deleted", colsOf(s).length === 2);
  const g2rows = s.$$('[data-it="row"][data-k="label"]').map(n => n.value).join("|");
  const g2cols = s.$$('[data-it="col"][data-k="label"]').map(n => n.value).join("|");
  s.click(s.$('[data-act="mtx-swap"]')); await sleep(320);
  check("Swap swaps the two lists over on a matrix with two axes",
    s.$$('[data-it="row"][data-k="label"]').map(n => n.value).join("|") === g2cols &&
    s.$$('[data-it="col"][data-k="label"]').map(n => n.value).join("|") === g2rows,
    s.$$('[data-it="row"][data-k="label"]').map(n => n.value).join("|") + " / " +
    s.$$('[data-it="col"][data-k="label"]').map(n => n.value).join("|"));
  s.click(s.$('[data-act="mtx-swap"]')); await sleep(320);

  // ---------------------------------------------------------------- the heat map
  await s.open("G3");
  check("a heat map keeps its rows and its columns side by side",
    rowsOf(s).length === 2 && colsOf(s).length === 2, rowsOf(s).length + " / " + colsOf(s).length);
  check("columns carry the same controls as rows",
    !!s.$('[data-act="it-dup"][data-kind="col"]') && !!s.$('[data-act="it-media"][data-kind="col"]'));
  await s.open("G4");
  check("an emoji grid reads its faces as the columns of the scale",
    ptsOf(s).length === 5 && /\uD83D\uDE1E/.test(s.$$('input[data-pt="label"]')[0].value),
    JSON.stringify(s.$$('input[data-pt="label"]').map(n => n.value)));

  // ---- an older scale-based grid becomes rows x columns when opened
  await s.open("G5");
  check("an older scale-based grid is migrated to rows x columns",
    colsOf(s).length === 3 && rowsOf(s).length === 2 && !s.$("#f-smin"),
    colsOf(s).length + " cols / " + rowsOf(s).length + " rows");
  check("...and its scale points become labelled columns",
    s.$$('[data-it="col"][data-k="label"]').map(n => n.value).join("|") === "Low|2|High",
    s.$$('[data-it="col"][data-k="label"]').map(n => n.value).join("|"));

  // ---------------------------------------------------------------- the rating scale
  await s.open("R1");
  check("a rating scale keeps its rows but has no column axis of its own",
    rowsOf(s).length === 2 && ptsOf(s).length === 0 && !s.$("#f-gtitle"),
    rowsOf(s).length + " rows / " + ptsOf(s).length + " points");
  check("a rating scale edits its range and its three anchor labels",
    !!s.$("#f-smin") && !!s.$("#f-smax") && !!s.$("#f-sminl") && !!s.$("#f-smidl") && !!s.$("#f-smaxl"),
    ["#f-smin", "#f-smax", "#f-sminl", "#f-smidl", "#f-smaxl"].map(x => x + "=" + (s.$(x) ? s.$(x).value : "?")).join(" "));
  check("the three anchor labels start from the question's own wording",
    s.$("#f-sminl").value === "Not at all" && s.$("#f-smidl").value === "Neutral" &&
    s.$("#f-smaxl").value === "Extremely");
  const mid = s.$("#f-smidl"); mid.value = "Somewhat"; s.fire(mid, "change"); await sleep(260);
  s.click(s.$('[data-act="it-add"][data-kind="row"]')); await sleep(240);
  check("a rating scale grows its rows like a grid", rowsOf(s).length === 3, rowsOf(s).length);

  // ---------------------------------------------------------------- it all reaches the study
  await sleep(1700);
  const saved = await s.saved();
  const g1 = saved.questions.find(q => q.id === "G1"), g2 = saved.questions.find(q => q.id === "G2");
  check("the title and the two group names are stored",
    g1.grid && g1.grid.title === "How well does each describe it?" && g1.grid.row_label === "Statement" &&
    g1.grid.col_label === "Rating", JSON.stringify(g1.grid));
  check("the select mode is stored on the grid", g1.select === "multi", g1.select);
  check("the columns are stored with their labels",
    g1.cols && g1.cols.length === 3 && g1.cols[0].label === "Not good" && g1.cols[2].label === "Great" &&
    !g1.scale, JSON.stringify(g1.cols));
  check("the N/A is stored on the rows",
    g1.na && g1.na.rows === true && !g1.na.col && g1.na.label === "Not applicable",
    JSON.stringify(g1.na));
  check("the comments are stored - the question's own and the rows'",
    g1.comments && g1.comments.mode === "allow" && g1.comments.label === "Anything else we should know?" &&
    (g1.comments.require_when || []).length === 1 && g1.rows[0].comment === "require",
    JSON.stringify(g1.comments) + " " + JSON.stringify(g1.rows[0]));
  check("the format of a row is stored", g1.rows[0].fmt === "b", JSON.stringify(g1.rows[0]));
  check("the order of the rows and of the columns is stored apart",
    g1.randomize && g1.randomize.rows === "shuffle" && g1.randomize.cols === "rotate",
    JSON.stringify(g1.randomize));
  check("a numeric matrix keeps the columns it was given",
    (g2.cols || []).length === 2 && g2.cols[0].label === "This year", JSON.stringify(g2.cols));
  const g5 = saved.questions.find(q => q.id === "G5");
  check("the migrated grid saves its columns in place of the scale",
    g5 && g5.cols.length === 3 && g5.cols[0].label === "Low" && !g5.scale && g5.select === "single",
    JSON.stringify(g5 && g5.cols));
  const r1 = saved.questions.find(q => q.id === "R1");
  check("a rating scale stores its three anchor labels on the scale",
    r1 && r1.scale.mid_label === "Somewhat" && r1.scale.min_label === "Not at all" &&
    r1.scale.max_label === "Extremely" && r1.rows.length === 3,
    JSON.stringify(r1 && r1.scale) + " rows=" + (r1 && r1.rows.length));
  check("no script errors in the Studio", s.errs.length === 0, s.errs.join(" | "));
  await post("/api/studio/delete", { slug });

  // =============================================================== Engine: the orderings
  {
    const dom = new JSDOM("<body></body>", { runScripts: "outside-only" });
    const w = dom.window;
    w.eval(await get("/static/js/qlogic.js"));
    const Q = w.BeaconQ;
    const list = ["a", "b", "c", "d", "e", "f"].map(c => ({ code: c }));
    const codes = l => l.map(x => x.code).join("");
    const qR = (mode, axis) => ({ id: "Q1", randomize: axis ? { rows: mode } : mode });
    check("Fixed leaves the list alone",
      codes(Q.order(list, qR("none"), "r1")) === "abcdef" && codes(Q.order(list, { id: "Q1" }, "r1")) === "abcdef");
    const shuffled = Q.order(list, qR("shuffle"), "r1");
    check("Shuffle really shuffles, and is stable for one respondent",
      codes(shuffled) !== "abcdef" && codes(Q.order(list, qR("shuffle"), "r1")) === codes(shuffled) &&
      codes(Q.order(list, qR("shuffle"), "r2")) !== codes(shuffled), codes(shuffled));
    const rot = codes(Q.order(list, qR("rotate"), "r1"));
    check("Rotate keeps the order and only moves the start point",
      rot.length === 6 && (rot + rot).indexOf("abcdef") >= 0 && rot !== "abcdef", rot);
    check("Reverse turns the whole list round for everybody",
      codes(Q.order(list, qR("revall"), "r1")) === "fedcba" && codes(Q.order(list, qR("revall"), "r9")) === "fedcba",
      codes(Q.order(list, qR("revall"), "r1")));
    const halves = {};
    for (let i = 0; i < 40; i++) { const c = codes(Q.order(list, qR("reverse"), "s" + i)); halves[c] = (halves[c] || 0) + 1; }
    check("Flip 50/50 gives half the respondents each way round",
      Object.keys(halves).length === 2 && !!halves["fedcba"], JSON.stringify(halves));
    const pinned = [{ code: "a", pin: true }, { code: "b" }, { code: "c" }, { code: "d", pin: true }];
    check("pinned entries keep their place whatever the order",
      Q.order(pinned, qR("revall"), "r1").map(x => x.code).join("") === "acbd" &&
      Q.order(pinned, qR("shuffle"), "r1").map(x => x.code).join("")[0] === "a",
      Q.order(pinned, qR("revall"), "r1").map(x => x.code).join(""));
    const both = { id: "Q1", randomize: { rows: "shuffle", cols: "revall" } };
    check("a grid can shuffle its rows and reverse its columns at the same time",
      codes(Q.order(list, both, "r1", "rows")) !== "abcdef" &&
      codes(Q.order(list, both, "r1", "cols")) === "fedcba",
      codes(Q.order(list, both, "r1", "rows")) + " / " + codes(Q.order(list, both, "r1", "cols")));
    check("the older one-word order still means the rows",
      codes(Q.order(list, { id: "Q1", randomize: "revall" }, "r1", "rows")) === "fedcba" &&
      codes(Q.order(list, { id: "Q1", randomize: "revall" }, "r1", "cols")) === "abcdef",
      codes(Q.order(list, { id: "Q1", randomize: "revall" }, "r1", "cols")));
  }

  // =============================================================== the respondent's view
  const rcfg = {
    sections: [{ id: "S1", title: "Grids" }],
    questions: [
      { id: "M1", section: "S1", type: "rating_grid", stem: "Pick the one that fits each row", required: false,
        select: "single",
        grid: { title: "How well does each one fit?", row_label: "Statement", col_label: "Rating" },
        na: { rows: true, label: "Not applicable" },
        comments: { mode: "allow", label: "Anything else?" },
        rows: [
          { code: "a", label: "Efficacy", comment: "require", fmt: "b",
            media: { kind: "image", src: "/media/matrixtest/row.png" } },
          { code: "b", label: "Safety", media: { kind: "audio", src: "/media/matrixtest/row.mp3" } },
        ],
        cols: [{ code: "c1", label: "Poor" }, { code: "c2", label: "Okay" }, { code: "c3", label: "Great" }] },
      { id: "M2", section: "S1", type: "heatmap", stem: "Tap the cells", required: false,
        rows: [{ code: "OS", label: "Survival" }, { code: "AE", label: "Side effects" }],
        cols: [{ code: "cte", label: "Trial" }, { code: "rwe", label: "Real world" }] },
      { id: "M3", section: "S1", type: "emoji_grid", stem: "Your reaction", required: false,
        rows: [{ code: "t", label: "Trust" }],
        scale: { min: 1, max: 5, faces: ["\uD83D\uDE1E", "\uD83D\uDE15", "\uD83D\uDE10", "\uD83D\uDE42", "\uD83D\uDE0D"] } },
      { id: "M4", section: "S1", type: "numeric_matrix", stem: "Patients a year", required: true,
        na: { rows: true, label: "Not applicable" },
        rows: [{ code: "p1", label: "Treated" }, { code: "p2", label: "Eligible" }],
        cols: [{ code: "this", label: "This year" }, { code: "next", label: "Next year" }] },
      { id: "M5", section: "S1", type: "rating_grid", stem: "One comment needed", required: false,
        comments: { mode: "require", label: "Tell us why" },
        rows: [{ code: "x", label: "Overall" }], scale: { min: 1, max: 3 } },
      { id: "MM", section: "S1", type: "rating_grid", stem: "Tick every source you use", required: true,
        select: "multi", na: { rows: true, label: "None apply" },
        rows: [{ code: "s", label: "Sources of information" }, { code: "t", label: "Trust in them" }],
        cols: [{ code: "j", label: "Journals" }, { code: "p", label: "Peers" }, { code: "c", label: "Conferences" }] },
      { id: "M6", section: "S1", type: "rating_scale", stem: "How well does each describe it?",
        required: true,
        rows: [{ code: "a", label: "Ease of use" }, { code: "b", label: "Trust" }],
        scale: { min: 1, max: 5, min_label: "Not at all", mid_label: "Neutral", max_label: "Extremely" } },
    ],
    tpp: {}, explainer_scenes: [],
  };
  const rslug = (await post("/api/studio/save", { title: "Matrix View Test", cfg: rcfg })).slug;
  await post("/api/studio/status", { slug: rslug, status: "live" });      // respondents can start

  async function run(slug) {
    const dom = new JSDOM(await get("/survey/" + slug + "/test"), { url: BASE + "/survey/" + slug + "/test", runScripts: "outside-only", pretendToBeVisual: true });
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
    // the page sets window.STUDY in an inline script, which jsdom does not run
    w.STUDY = { slug: slug, paused: false };
    for (const f of ["qlogic.js", "survey.js", "explainer.js"]) w.eval(await get("/static/js/" + f));
    await sleep(700);
    const d = w.document;
    return {
      w, d, errs,
      $: s2 => d.querySelector(s2), $$: s2 => [...d.querySelectorAll(s2)],
      click: el => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })),
      fire: (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true })),
      next: () => {
        const b = [...d.querySelectorAll("#app .nav .btn")].find(x => /Next|Submit/.test(x.textContent));
        b.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
      },
    };
  }

  {
    const r = await run(rslug);
    r.click(r.$("#start-btn")); await sleep(400);
    check("the grid title sits above the grid", /How well does each one fit/.test(r.$("#app").textContent));
    check("the header names the rows and carries one caption per column",
      /Statement/.test(r.$("#app .cg-head").textContent) &&
      r.$$("#app .cg-head .cg-col:not(.cg-col-na)").map(n => n.textContent.trim()).join("|") === "Poor|Okay|Great",
      r.$("#app .cg-head").textContent.replace(/\s+/g, " ").trim());
    check("a single-select grid offers one radio per row and column",
      r.$$("#app .choice-grid input[type=radio]").length === 6,
      r.$$("#app .choice-grid input[type=radio]").length);
    check("every row carries the exclusive N/A", r.$$("#app .cg-na input").length === 2,
      r.$$("#app .cg-na input").length);
    const radio = r.$$("#app .choice-grid input[type=radio]")[1];   // row a, column Okay
    radio.checked = true; r.fire(radio, "change"); await sleep(160);
    check("picking a column records it for the row",
      r.$$("#app .choice-grid input:checked").length === 1, r.$$("#app .choice-grid input:checked").length);
    check("a row's image and another row's audio clip are both shown",
      !!r.$("#app .rlabel img") && !!r.$("#app .rlabel audio"),
      r.$("#app .rlabel") && r.$("#app .rlabel").innerHTML.slice(0, 120));
    check("a row set in bold is drawn in bold", !!r.$("#app .rlabel b"), r.$("#app .rlabel").innerHTML.slice(0, 80));
    check("a row that asks for a comment gets a box under it",
      r.$$("#app .grid-cmtrow .cmt-box").length === 1 &&
      /required/i.test(r.$("#app .grid-cmtrow .cmt-box").placeholder),
      r.$$("#app .grid-cmtrow .cmt-box").length);
    check("the question's own comment box is there too",
      !!r.$("#app .q-comment .cmt-box") && /Anything else/.test(r.$("#app .q-comment").textContent));

    // a required comment on a row blocks Next until it is filled in
    r.next(); await sleep(300);
    check("a required row comment blocks Next", /comment/i.test(r.$("#err").textContent) &&
      /Efficacy/.test(r.$("#err").textContent), r.$("#err").textContent);
    const box = r.$("#app .grid-cmtrow .cmt-box");
    box.value = "Efficacy drives everything"; r.fire(box, "input"); await sleep(200);
    r.next(); await sleep(400);
    check("filling it in lets the respondent carry on", /Tap the cells/.test(r.$("#app").textContent),
      r.$("#app").textContent.slice(0, 80));

    // the heat map
    check("a heat map draws a cell for every row and column",
      r.$$("#app .hm-cell").length === 4 && r.$$("#app .hm-head .hm-th").length === 3,
      r.$$("#app .hm-cell").length + " / " + r.$$("#app .hm-head .hm-th").length);
    const cell = r.$$("#app .hm-cell")[0];
    r.click(cell); await sleep(120);
    r.click(cell); await sleep(120);
    check("tapping a cell raises how strongly it applies", cell.dataset.lvl === "2", cell.dataset.lvl);
    r.click(cell); await sleep(80); r.click(cell); await sleep(80);
    check("tapping past the strongest clears it again", cell.dataset.lvl === "0", cell.dataset.lvl);

    r.next(); await sleep(400);
    check("an emoji grid offers one face per column of the scale",
      r.$$("#app .emoji-btn").length === 5 && /\uD83D\uDE1E/.test(r.$("#app .emoji-btn").textContent),
      r.$$("#app .emoji-btn").length);
    const face = r.$$("#app .emoji-btn")[3];
    r.click(face); await sleep(200);
    check("tapping a face records it", /\bon\b/.test(face.className) &&
      r.$$("#app .emoji-btn.on").length === 1, face.className);

    r.next(); await sleep(400);
    check("a numeric matrix with columns becomes a table of number boxes",
      r.$$("#app .nm-input").length === 4 &&
      r.$$("#app .nm-head .nm-th:not(.nm-th-na)").length === 3,
      r.$$("#app .nm-input").length + " / " + r.$$("#app .nm-head .nm-th").length);
    check("the matrix offers the exclusive N/A on every row",
      r.$$("#app .nm-td-na input").length === 2, r.$$("#app .nm-td-na input").length);
    r.next(); await sleep(300);
    check("a required matrix holds until every cell is answered",
      /required/i.test(r.$("#err").textContent), r.$("#err").textContent);
    const nmIn = r.$$("#app .nm-input");
    nmIn[0].value = "42"; r.fire(nmIn[0], "input"); await sleep(150);
    nmIn[1].value = "57"; r.fire(nmIn[1], "input"); await sleep(150);
    nmIn[2].value = "7"; r.fire(nmIn[2], "input"); await sleep(150);
    const naM = r.$$("#app .nm-td-na input");
    r.click(naM[1]); await sleep(250);
    check("ticking N/A empties that row's cells",
      r.$$("#app .nm-input")[2].value === "", r.$$("#app .nm-input")[2].value);
    nmIn[2] = r.$$("#app .nm-input")[2];
    nmIn[2].value = "9"; r.fire(nmIn[2], "input"); await sleep(200);
    check("typing in a cell lifts the row's N/A",
      !r.$$("#app .nm-td-na input")[1].checked, r.$$("#app .nm-td-na input")[1].checked);
    r.click(r.$$("#app .nm-td-na input")[1]); await sleep(250);
    r.next(); await sleep(400);
    check("rows that are filled or N/A'd carry on",
      /One comment needed/.test(r.$("#app").textContent), r.$("#app").textContent.slice(0, 80));

    r.next(); await sleep(400);
    check("the last grid is the one that needs a comment", /One comment needed/.test(r.$("#app").textContent),
      r.$("#app").textContent.slice(0, 80));
    check("an older scale-based grid still renders its scale for respondents",
      r.$$("#app .grid .spectrum").length === 1 && !r.$$("#app .choice-grid").length,
      r.$$("#app .grid .spectrum").length);
    r.next(); await sleep(300);
    check("a required question comment blocks Next too", /comment/i.test(r.$("#err").textContent),
      r.$("#err").textContent);
    const qb = r.$("#app .q-comment .cmt-box");
    qb.value = "Because it matters"; r.fire(qb, "input"); await sleep(200);
    r.next(); await sleep(500);

    // the multi-select grid: checkboxes, several ticks per row, N/A stands in
    check("a multi-select grid shows a checkbox for every row and column",
      /Tick every source you use/.test(r.$("#app").textContent) &&
      r.$$("#app .choice-grid .cg-cell:not(.cg-na) input[type=checkbox]").length === 6 &&
      !r.$$("#app .choice-grid input[type=radio]").length,
      r.$$("#app .choice-grid .cg-cell:not(.cg-na) input[type=checkbox]").length);
    r.next(); await sleep(300);
    check("a required multi-select grid waits for every row", /required/i.test(r.$("#err").textContent),
      r.$("#err").textContent);
    const mmRows = r.$$("#app .choice-grid .cg-row:not(.cg-head)");
    const tick = box => { box.click(); r.fire(box, "change"); };
    tick(mmRows[0].querySelectorAll("input[type=checkbox]")[0]); await sleep(120);
    tick(mmRows[0].querySelectorAll("input[type=checkbox]")[2]); await sleep(120);
    check("a row may tick several columns at once",
      mmRows[0].querySelectorAll("input:checked").length === 2,
      mmRows[0].querySelectorAll("input:checked").length);
    const mmNa = mmRows[1].querySelector(".cg-na input");
    tick(mmNa); await sleep(120);
    check("N/A answers a row without any tick", mmNa.checked);
    r.next(); await sleep(500);

    // the rating scale: rows on one scale, labelled at the low end, the middle, the high end
    check("a rating scale shows its rows each with its own scale",
      /How well does each describe it/.test(r.$("#app").textContent) &&
      r.$$("#app .rating-scale .grid-row").length === 2 &&
      r.$$("#app .rating-scale [role=slider]").length === 2,
      r.$$("#app .rating-scale .grid-row").length + " rows");
    check("a rating scale labels the low end, the middle and the high end",
      !!r.$("#app .rs-ends .rs-end-low") && !!r.$("#app .rs-ends .rs-end-mid") &&
      !!r.$("#app .rs-ends .rs-end-high") &&
      /Not at all/.test(r.$("#app .rs-end-low").textContent) &&
      /Neutral/.test(r.$("#app .rs-end-mid").textContent) &&
      /Extremely/.test(r.$("#app .rs-end-high").textContent),
      r.$("#app .rs-ends") && r.$("#app .rs-ends").textContent.replace(/\s+/g, " ").trim());
    r.next(); await sleep(300);
    check("a required rating scale waits for every row", /required/i.test(r.$("#err").textContent),
      r.$("#err").textContent);
    const scales = r.$$("#app .rating-scale .spectrum");
    const key = (elm, k) => elm.dispatchEvent(new r.w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    key(scales[0], "ArrowRight"); await sleep(160);           // row a: midpoint 3 -> 4
    key(scales[1], "ArrowLeft"); await sleep(160);            // row b: midpoint 3 -> 2
    check("rating a row of a rating scale records its value",
      scales[0].getAttribute("aria-valuenow") === "4" && scales[1].getAttribute("aria-valuenow") === "2",
      scales.map(x => x.getAttribute("aria-valuenow")).join("/"));
    r.next(); await sleep(500);
    check("and the survey finishes once every row is rated",
      /Thank you|End of survey|complete/i.test(r.$("#app").textContent), r.$("#app").textContent.slice(0, 120));
    check("no script errors for the respondent", r.errs.length === 0, r.errs.join(" | "));
  }

  // ---- the N/A stands in for the rating: a required grid is satisfied by ticking it
  {
    const cfg2 = JSON.parse(JSON.stringify(rcfg));
    cfg2.questions = [Object.assign({}, rcfg.questions[0], { required: true, id: "N1" }),
                      { id: "N2", section: "S1", type: "open_text", stem: "Done", required: false }];
    const slug2 = (await post("/api/studio/save", { title: "Matrix NA Test", cfg: cfg2 })).slug;
    await post("/api/studio/status", { slug: slug2, status: "live" });
    const r = await run(slug2);
    r.click(r.$("#start-btn")); await sleep(400);
    r.next(); await sleep(300);
    check("a required grid that is unanswered holds the respondent",
      /required/i.test(r.$("#err").textContent), r.$("#err").textContent);
    const ticks = r.$$("#app .cg-na input");
    r.click(ticks[0]); await sleep(200); r.click(r.$$("#app .cg-na input")[1]); await sleep(200);
    r.next(); await sleep(400);
    check("ticking N/A on every row answers the grid without a pick",
      !r.$("#app .choice-grid") && /N2\./.test(r.$("#app").textContent) &&
      /Done/.test(r.$("#app").textContent),
      r.$("#app").textContent.slice(0, 90));
    check("no script errors on the N/A route", r.errs.length === 0, r.errs.join(" | "));
    await post("/api/studio/delete", { slug: slug2 });
  }

  await post("/api/studio/delete", { slug: rslug });
  console.log(fails ? "\n" + fails + " FAILED" : "\nall matrix / grid checks passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
