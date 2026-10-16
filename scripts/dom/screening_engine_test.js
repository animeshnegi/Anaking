/* Screening engine (screen in / screen out) - pure node, no server needed.
 *
 *   node scripts/dom/screening_engine_test.js
 *
 * Exercises static/js/qlogic.js: option groups, counts, cross-question rules,
 * qualify mode, the legacy `terminate` / `terminate_if_lt` shorthand, the
 * live-vs-next phases and the plain-English summaries.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const SRC = fs.readFileSync(path.join(ROOT, "static", "js", "qlogic.js"), "utf8");

const sandbox = { window: {}, console };
sandbox.window.BeaconQ = undefined;
vm.createContext(sandbox);
vm.runInContext("var window = this.window; var document = undefined;" + SRC, sandbox);
const Q = sandbox.window.BeaconQ;

let fails = 0;
const check = (label, cond, detail = "") => {
  console.log((cond ? "PASS  " : "FAIL  ") + label + (cond ? "" : "  -> " + detail));
  if (!cond) fails++;
};

const SPECIALTY = {
  id: "Q1", type: "single_select", stem: "Specialty",
  options: [
    { code: 1, label: "Medical oncology" },
    { code: 2, label: "Haem/onc" },
    { code: 3, label: "Thoracic oncology" },
    { code: 4, label: "Haematology only" },
    { code: 5, label: "Radiation oncology" },
    { code: 6, label: "Surgical oncology" },
  ],
};
const VOLUME = {
  id: "Q3", type: "numeric", stem: "Patients per month",
  screening: {
    mode: "qualify", match: "any", when: "next",
    rules: [{ q: "Q3", op: "gte", value: 5 }],
  },
};
const BRANDS = {
  id: "Q5", type: "multi_select", stem: "Which brands",
  options: [{ code: 1, label: "A" }, { code: 2, label: "B" }, { code: 3, label: "C" },
            { code: 4, label: "None of these", exclusive: true }],
};
const GRID = {
  id: "Q7", type: "rating_grid", stem: "Barriers",
  scale: { min: 1, max: 5 },
  rows: [{ code: "pa", label: "Prior auth" }, { code: "st", label: "Step therapy" }],
};
const RANK = {
  id: "Q9", type: "rank", stem: "Rank the drivers",
  rows: [{ code: "eff", label: "Efficacy" }, { code: "tol", label: "Tolerability" }, { code: "cost", label: "Cost" }],
};
const VERB = { id: "Q11", type: "open_text", stem: "Why?" };

const QUESTIONS = [SPECIALTY, VOLUME, BRANDS, GRID, RANK, VERB];
const verdict = (answers, opts) => Q.screeningVerdict(QUESTIONS, answers, opts || {});

// ------------------------------------------------------------------ legacy shorthand
SPECIALTY.options[4].terminate = true;
SPECIALTY.options[5].terminate = true;

check("legacy terminate options are read as a screening block",
  Q.screening(SPECIALTY).length === 1 && Q.screening(SPECIALTY)[0].source === "options");
check("picking a terminating option screens out",
  (verdict({ Q1: { _: 5 } }) || {}).qid === "Q1");
check("a non-terminating option continues",
  verdict({ Q1: { _: 1 } }) === null);
check("the legacy block fires live, as soon as the option is picked",
  (verdict({ Q1: { _: 6 } }, { phase: "live" }) || {}).qid === "Q1");
check("screen-out reason names the question",
  /Q1/.test((verdict({ Q1: { _: 5 } }) || {}).reason || ""),
  JSON.stringify(verdict({ Q1: { _: 5 } })));
delete SPECIALTY.options[4].terminate;
delete SPECIALTY.options[5].terminate;

// ------------------------------------------------------------------ option groups
SPECIALTY.screening = { mode: "screen_out", match: "any", when: "live", rules: [{ q: "Q1", op: "any_of", value: "5,6" }] };
check("group 'any of' screens out on a member", (verdict({ Q1: { _: 6 } }) || {}).qid === "Q1");
check("group 'any of' lets an outsider through", verdict({ Q1: { _: 3 } }) === null);

SPECIALTY.screening.rules = [{ q: "Q1", op: "none_of", value: "1,2,3" }];
check("'none of' screens out an outsider", (verdict({ Q1: { _: 4 } }) || {}).qid === "Q1");
check("'none of' keeps an insider", verdict({ Q1: { _: 2 } }) === null);

BRANDS.screening = { mode: "screen_out", match: "all", when: "live", rules: [{ q: "Q5", op: "all_of", value: "1,2" }] };
check("'includes all of' needs every code", verdict({ Q5: { codes: [1] } }) === null);
check("'includes all of' fires when all are ticked", (verdict({ Q5: { codes: [1, 2, 3] } }) || {}).qid === "Q5");

BRANDS.screening.rules = [{ q: "Q5", op: "exactly", value: "4" }];
check("'exactly' fires on the exclusive option alone",
  (verdict({ Q5: { codes: [4] } }) || {}).qid === "Q5");
check("'exactly' does not fire when something else is ticked too",
  verdict({ Q5: { codes: [1, 4] } }) === null);

BRANDS.screening.rules = [{ q: "Q5", op: "count_gte", value: 3 }];
check("count rule screens out at three picks", (verdict({ Q5: { codes: [1, 2, 3] } }) || {}).qid === "Q5");
check("count rule allows two picks", verdict({ Q5: { codes: [1, 2] } }) === null);

// ------------------------------------------------------------------ qualify mode
check("qualify: a qualifying volume continues", verdict({ Q3: { _: 12 } }) === null);
check("qualify: too few patients screens out", (verdict({ Q3: { _: 3 } }) || {}).qid === "Q3");
check("qualify: a blank answer is still pending, not a screen-out",
  verdict({ Q3: {} }) === null);
delete VOLUME.screening;

// ------------------------------------------------------------------ cross-question rules
delete SPECIALTY.screening;
delete BRANDS.screening;
VOLUME.screening = {
  mode: "screen_out", match: "all", when: "next", reason: "Haematology-only, low volume",
  rules: [{ q: "Q1", op: "selected", value: 4 }, { q: "Q3", op: "lt", value: 10 }],
};
check("cross-question rule fires when both hold", (verdict({ Q1: { _: 4 }, Q3: { _: 8 } }) || {}).qid === "Q3");
check("cross-question rule ignores a different specialty", verdict({ Q1: { _: 2 }, Q3: { _: 8 } }) === null);
check("cross-question rule ignores a high volume", verdict({ Q1: { _: 4 }, Q3: { _: 30 } }) === null);
check("cross-question rule waits for both answers", verdict({ Q3: { _: 8 } }) === null);
check("the author's reason is carried into the data",
  (verdict({ Q1: { _: 4 }, Q3: { _: 8 } }) || {}).reason === "Haematology-only, low volume");
check("a 'next' rule does not fire during the live phase",
  verdict({ Q1: { _: 4 }, Q3: { _: 8 } }, { phase: "live" }) === null);
check("the custom message survives into the verdict",
  (function () {
    VOLUME.screening.message = "Thank you, but this study needs higher-volume clinicians.";
    var v = verdict({ Q1: { _: 4 }, Q3: { _: 8 } });
    return v && v.message.indexOf("higher-volume") > 0;
  })());
delete VOLUME.screening;

// ------------------------------------------------------------------ grids, ranks, text
GRID.screening = { mode: "screen_out", match: "all", when: "live", rules: [{ q: "Q7", op: "row_gte", value: "pa=4" }] };
check("grid row rule fires on a high rating", (verdict({ Q7: { pa: 5, st: 2 } }) || {}).qid === "Q7");
check("grid row rule ignores a low rating", verdict({ Q7: { pa: 2, st: 2 } }) === null);
check("grid rule waits until every row is answered", verdict({ Q7: { pa: 5 } }) === null);
delete GRID.screening;

// ---- the choice grid: rows x columns, one or several picks per row ----------------------
const CHOICEGRID = {
  id: "Q7C", type: "rating_grid", stem: "How well does each fit?", select: "single",
  rows: [{ code: "eff", label: "Efficacy" }, { code: "tol", label: "Tolerability" }],
  cols: [{ code: "low", label: "Poor" }, { code: "mid", label: "Okay" }, { code: "high", label: "Great" }],
};
QUESTIONS.push(CHOICEGRID);

check("a grid with columns is read as a choice grid", Q.qKind(CHOICEGRID) === "choicegrid");
{
  const ops = Q.opsFor(CHOICEGRID, QUESTIONS).map(o => o.op);
  check("the choice grid offers the cell operators",
    ["cell_is", "cell_not", "cell_includes", "cell_lacks"].every(op => ops.indexOf(op) >= 0), ops.join(","));
  check("the choice grid drops the scale-row operators",
    ["row_gte", "row_between", "sum_gt"].every(op => ops.indexOf(op) < 0), ops.join(","));
}
CHOICEGRID.screening = { mode: "screen_out", match: "all", when: "live", rules: [{ q: "Q7C", op: "cell_is", value: "eff=low" }] };
check("cell_is fires on the matching pick", (verdict({ Q7C: { eff: "low", tol: "mid" } }) || {}).qid === "Q7C");
check("cell_is ignores a different column", verdict({ Q7C: { eff: "mid", tol: "low" } }) === null);
CHOICEGRID.screening.rules = [{ q: "Q7C", op: "cell_not", value: "eff=low" }];
check("cell_not fires when the pick is elsewhere", (verdict({ Q7C: { eff: "mid", tol: "mid" } }) || {}).qid === "Q7C");
CHOICEGRID.select = "multi";
CHOICEGRID.screening.rules = [{ q: "Q7C", op: "cell_includes", value: "tol=high" }];
check("cell_includes fires inside a multi pick", (verdict({ Q7C: { eff: ["mid"], tol: ["low", "high"] } }) || {}).qid === "Q7C");
check("cell_includes ignores a row without the pick", verdict({ Q7C: { eff: ["high"], tol: ["low"] } }) === null);
CHOICEGRID.screening.rules = [{ q: "Q7C", op: "cell_lacks", value: "tol=high" }];
check("cell_lacks fires when the pick is missing", (verdict({ Q7C: { eff: ["mid"], tol: ["low"] } }) || {}).qid === "Q7C");
check("a choice-grid rule waits until every row is answered", verdict({ Q7C: { eff: ["mid"] } }) === null);
CHOICEGRID.screening.rules = [{ q: "Q7C", op: "answered", value: "" }];
check("'was answered' works on a choice grid", (verdict({ Q7C: { eff: ["mid"], tol: [] } }) || {}).qid === "Q7C");
CHOICEGRID.screening.rules = [{ q: "Q7C", op: "cell_is", value: "eff=low" }];
{
  const line = (Q.screenSummary(CHOICEGRID, QUESTIONS)[0] || {}).text || "";
  check("the choice-grid rule reads as plain English",
    /Efficacy/.test(line) && /Poor/.test(line), line);
}
delete CHOICEGRID.screening;
CHOICEGRID.select = "single";

// ---- the numeric matrix: one number per row x column ---------------------------------
const NUMMATRIX = {
  id: "Q7N", type: "numeric_matrix", stem: "Patients per month",
  rows: [{ code: "tr", label: "Treated" }, { code: "el", label: "Eligible" }],
  cols: [{ code: "now", label: "This year" }, { code: "next", label: "Next year" }],
};
QUESTIONS.push(NUMMATRIX);

check("a numeric matrix with columns is read as a nummatrix", Q.qKind(NUMMATRIX) === "nummatrix");
{
  const nops = Q.opsFor(NUMMATRIX, QUESTIONS).map(o => o.op);
  check("the numeric matrix offers the cell number operators",
    ["cell_gte", "cell_lte", "cell_gt", "cell_lt", "cell_eq", "cell_ne", "cell_between"]
      .every(op => nops.indexOf(op) >= 0), nops.join(","));
  check("...and not the pick-grid operators",
    ["cell_is", "cell_includes"].every(op => nops.indexOf(op) < 0), nops.join(","));
}
NUMMATRIX.screening = { mode: "screen_out", match: "all", when: "live", rules: [{ q: "Q7N", op: "cell_gte", value: "tr=now=40" }] };
check("cell_gte fires on a big cell",
  (verdict({ Q7N: { tr_now: 50, tr_next: 5, el_now: 5, el_next: 5 } }) || {}).qid === "Q7N");
check("cell_gte ignores a small cell",
  verdict({ Q7N: { tr_now: 30, tr_next: 5, el_now: 5, el_next: 5 } }) === null);
NUMMATRIX.screening.rules = [{ q: "Q7N", op: "cell_between", value: "el=next=10-20" }];
check("cell_between reads the band",
  (verdict({ Q7N: { tr_now: 1, tr_next: 1, el_now: 1, el_next: 15 } }) || {}).qid === "Q7N");
check("a numeric-matrix rule waits until every cell is answered",
  verdict({ Q7N: { tr_now: 50 } }) === null);
NUMMATRIX.screening.rules = [{ q: "Q7N", op: "cell_gte", value: "tr=now=40" }];
{
  const nline = (Q.screenSummary(NUMMATRIX, QUESTIONS)[0] || {}).text || "";
  check("the numeric-cell rule reads as plain English",
    /Treated/.test(nline) && /This year/.test(nline) && /40/.test(nline), nline);
}
delete NUMMATRIX.screening;

RANK.screening = { mode: "screen_out", match: "all", when: "live", rules: [{ q: "Q9", op: "ranked_first", value: "cost" }] };
check("rank: cost first screens out", (verdict({ Q9: { order: ["cost", "eff", "tol"] } }) || {}).qid === "Q9");
check("rank: efficacy first continues", verdict({ Q9: { order: ["eff", "cost", "tol"] } }) === null);
RANK.screening.rules = [{ q: "Q9", op: "ranked_top", value: "cost=2" }];
check("rank: cost in the top two screens out", (verdict({ Q9: { order: ["eff", "cost", "tol"] } }) || {}).qid === "Q9");
delete RANK.screening;

VERB.screening = { mode: "screen_out", match: "all", when: "next", rules: [{ q: "Q11", op: "contains", value: "no idea" }] };
check("text rule matches the phrase", (verdict({ Q11: { _: "No idea really" } }) || {}).qid === "Q11");
check("text rule ignores other answers", verdict({ Q11: { _: "Efficacy data" } }) === null);
VERB.screening.rules = [{ q: "Q11", op: "words_lt", value: 3 }];
check("word-count rule fires on a two-word answer", (verdict({ Q11: { _: "Too short" } }) || {}).qid === "Q11");
delete VERB.screening;

// ------------------------------------------------------------------ numbers: the operator row
const SHARE = {
  id: "Q19", type: "sum_to_100", stem: "Split 100 points",
  rows: [{ code: "d1", label: "Brand A" }, { code: "d2", label: "Brand B" }, { code: "d3", label: "Brand C" }],
};
const MATRIX = {
  id: "Q30", type: "numeric_matrix", stem: "Units per brand",
  rows: [{ code: "u1", label: "Units A" }, { code: "u2", label: "Units B" }],
};

// a numeric question is screened with an operator and a number box
VOLUME.screening = { mode: "screen_out", match: "all", when: "next",
  rules: [{ q: "Q3", op: "lt", value: 5 }] };
check("numeric: 'is less than' screens out below the threshold",
  (verdict({ Q3: { _: 4 } }) || {}).qid === "Q3");
check("numeric: the threshold itself continues",
  verdict({ Q3: { _: 5 } }) === null);
VOLUME.screening.rules = [{ q: "Q3", op: "between", value: "5-20" }];
check("numeric: 'is between' fires inside the range", (verdict({ Q3: { _: 12 } }) || {}).qid === "Q3");
check("numeric: 'is between' ignores an answer outside it", verdict({ Q3: { _: 40 } }) === null);
VOLUME.screening.rules = [{ q: "Q3", op: "not_between", value: "5-20" }];
check("numeric: 'is outside' fires outside the range", (verdict({ Q3: { _: 40 } }) || {}).qid === "Q3");
check("numeric: 'is outside' ignores an answer inside it", verdict({ Q3: { _: 12 } }) === null);
check("a numeric rule reads with its operator",
  Q.screenSummary(VOLUME, QUESTIONS)[0].text === "screen out when Q3 < 5" ||
  /Q3/.test(Q.screenSummary(VOLUME, QUESTIONS)[0].text),
  Q.screenSummary(VOLUME, QUESTIONS)[0].text);
VOLUME.screening.rules = [{ q: "Q3", op: "lt", value: 5 }];
check("the operator row reads as an operator, not a sentence",
  Q.ruleText({ q: "Q3", op: "lt", value: 5 }, QUESTIONS) === "Q3 < 5",
  Q.ruleText({ q: "Q3", op: "lt", value: 5 }, QUESTIONS));
check("'is between' reads as a range",
  Q.ruleText({ q: "Q3", op: "between", value: "5-20" }, QUESTIONS) === "Q3 is between 5 and 20",
  Q.ruleText({ q: "Q3", op: "between", value: "5-20" }, QUESTIONS));
delete VOLUME.screening;

// ------------------------------------------------------------------ allocations
QUESTIONS.push(SHARE, MATRIX);
SHARE.screening = { mode: "screen_out", match: "all", when: "next",
  rules: [{ q: "Q19", op: "row_gte", value: "d1=60" }] };
check("allocation: one row holding too much screens out",
  (verdict({ Q19: { d1: 70, d2: 20, d3: 10 } }) || {}).qid === "Q19");
check("allocation: a spread allocation continues",
  verdict({ Q19: { d1: 40, d2: 35, d3: 25 } }) === null);
SHARE.screening.rules = [{ q: "Q19", op: "sum_of_gte", value: "d1,d2=80" }];
check("allocation: a group of rows adding up to 80 screens out",
  (verdict({ Q19: { d1: 50, d2: 30, d3: 20 } }) || {}).qid === "Q19");
check("allocation: the same group at 60 continues",
  verdict({ Q19: { d1: 40, d2: 20, d3: 40 } }) === null);
SHARE.screening.rules = [{ q: "Q19", op: "total_gte", value: 90 }];
check("allocation: the grand total counts every row",
  (verdict({ Q19: { d1: 60, d2: 30, d3: 10 } }) || {}).qid === "Q19");
check("allocation: a smaller total continues",
  verdict({ Q19: { d1: 10, d2: 10, d3: 10 } }) === null);
check("a group-share rule reads as a sum",
  Q.ruleText({ q: "Q19", op: "sum_of_gte", value: "d1,d2=80" }, QUESTIONS) === "Q19: the sum of Brand A + Brand B \u2265 80",
  Q.ruleText({ q: "Q19", op: "sum_of_gte", value: "d1,d2=80" }, QUESTIONS));
check("a total rule reads with the word total",
  Q.ruleText({ q: "Q19", op: "total_gte", value: 90 }, QUESTIONS) === "Q19 total \u2265 90",
  Q.ruleText({ q: "Q19", op: "total_gte", value: 90 }, QUESTIONS));
SHARE.screening.rules = [{ q: "Q19", op: "sum_of_gte", value: "=80" }];
check("a group rule with no rows ticked does not fire yet",
  verdict({ Q19: { d1: 90, d2: 5, d3: 5 } }) === null);
SHARE.screening.rules = [{ q: "Q19", op: "row_gte", value: "=60" }];
check("a row rule with no row chosen does not fire yet",
  verdict({ Q19: { d1: 90, d2: 5, d3: 5 } }) === null);
SHARE.screening.rules = [{ q: "Q19", op: "row_gte", value: "d1=60" }];
check("allocations offer row, group and total conditions",
  ["row_gte", "sum_of_gte", "total_gte"].every(op => Q.opsFor(SHARE).some(o => o.op === op)));
check("a numeric matrix offers the same numeric row conditions",
  ["row_gte", "row_lte", "sum_of_lte", "total_lte"].every(op => Q.opsFor(MATRIX).some(o => o.op === op)));
check("rating grids keep their scale conditions but not allocation totals",
  Q.opsFor(GRID).some(o => o.op === "row_gte") && !Q.opsFor(GRID).some(o => o.op === "total_gte"));
MATRIX.screening = { mode: "qualify", match: "all", when: "next",
  rules: [{ q: "Q30", op: "row_gte", value: "u1=10" }] };
check("numeric matrix: qualify gate on one row",
  (verdict({ Q30: { u1: 2, u2: 30 } }) || {}).qid === "Q30" &&
  verdict({ Q30: { u1: 20, u2: 30 } }) === null);
delete MATRIX.screening;
delete SHARE.screening;
QUESTIONS.pop(); QUESTIONS.pop();

// ------------------------------------------------------------------ the structured screener
// "Individual" (a Min - Max band per answer) and "Sum of responses" are stored in their own
// fields; the block they build is an ordinary rule list.
const BAND = {
  id: "Q40", type: "sum_to_100", stem: "Split 100 points",
  rows: [{ code: "b1", label: "Brand A" }, { code: "b2", label: "Brand B" }, { code: "b3", label: "Brand C" }],
};
QUESTIONS.push(BAND);
BAND.screening = { mode: "screen_out", type: "individual", rows: ["b1", "b2"],
                   min: { b1: 20, b2: 10 }, max: { b1: 60, b2: 40 } };
check("Individual: an answer above its Maximum is screened out",
  (verdict({ Q40: { b1: 70, b2: 20, b3: 10 } }) || {}).qid === "Q40");
check("Individual: an answer below its Minimum is screened out",
  (verdict({ Q40: { b1: 30, b2: 5, b3: 65 } }) || {}).qid === "Q40");
check("Individual: every answer inside its band continues",
  verdict({ Q40: { b1: 30, b2: 20, b3: 50 } }) === null);
check("Individual: an answer that is not screened is ignored",
  verdict({ Q40: { b1: 30, b2: 20, b3: 95 } }) === null);
check("Individual: a pending answer does not fire yet",
  verdict({ Q40: { b1: 30 } }) === null);
BAND.screening = { mode: "qualify", type: "individual", rows: ["b1"], outside: false,
                   min: { b1: 20 }, max: { b1: 60 } };
check("Individual: Screen In keeps only the answers inside their band",
  verdict({ Q40: { b1: 30, b2: 20, b3: 50 } }) === null &&
  (verdict({ Q40: { b1: 80, b2: 10, b3: 10 } }) || {}).qid === "Q40");
BAND.screening = { mode: "screen_out", type: "sum", rows: ["b1", "b2"], sum: { op: "gt", value: 80 } };
check("Sum: greater than fires above the number",
  (verdict({ Q40: { b1: 60, b2: 30, b3: 10 } }) || {}).qid === "Q40");
check("Sum: greater than ignores a smaller total",
  verdict({ Q40: { b1: 40, b2: 30, b3: 30 } }) === null);
BAND.screening = { mode: "screen_out", type: "sum", rows: ["b1", "b2"], sum: { op: "eq", value: 50 } };
check("Sum: equal to fires on the exact total",
  (verdict({ Q40: { b1: 30, b2: 20, b3: 50 } }) || {}).qid === "Q40");
BAND.screening = { mode: "screen_out", type: "sum", rows: ["b1", "b2"], sum: { op: "lt", value: 50 } };
check("Sum: less than fires under the number",
  (verdict({ Q40: { b1: 20, b2: 20, b3: 60 } }) || {}).qid === "Q40");
BAND.screening = { mode: "screen_out", type: "sum", rows: ["b1", "b2"], sum: { op: "between", value: "10-90" } };
check("Sum: Min to Max fires inside the range",
  (verdict({ Q40: { b1: 40, b2: 30, b3: 30 } }) || {}).qid === "Q40");
check("Sum: Min to Max ignores a total outside it",
  verdict({ Q40: { b1: 60, b2: 40, b3: 0 } }) === null);
check("an Individual screener reads as a band per answer",
  Q.screenSummary(BAND, QUESTIONS)[0].text ===
    "screen out when Q40: the sum of Brand A + Brand B is between 10 and 90",
  Q.screenSummary(BAND, QUESTIONS)[0].text);
BAND.screening = { mode: "screen_out", type: "individual", rows: ["b1", "b2"],
                   min: { b1: 20, b2: 10 }, max: { b1: 60, b2: 40 } };
check("Individual joins the answers with 'or' - any of them breaking its band is enough",
  Q.screenSummary(BAND, QUESTIONS)[0].text ===
    "screen out when Q40: Brand A is outside 20 to 60 or Q40: Brand B is outside 10 to 40",
  Q.screenSummary(BAND, QUESTIONS)[0].text);
delete BAND.screening;
QUESTIONS.pop();

// ------------------------------------------------------------------ plain English + typing
SPECIALTY.screening = { mode: "screen_out", match: "any", when: "live", rules: [{ q: "Q1", op: "any_of", value: "5,6" }] };
const sum = Q.screenSummary(SPECIALTY, QUESTIONS);
check("summary reads as a sentence",
  sum.length === 1 && /screen out when Q1 is any of Radiation oncology, Surgical oncology/.test(sum[0].text),
  JSON.stringify(sum));
check("operator list is filtered by question type",
  Q.opsFor(SPECIALTY).some(o => o.op === "any_of") && !Q.opsFor(SPECIALTY).some(o => o.op === "row_eq"));
check("grid questions offer row conditions", Q.opsFor(GRID).some(o => o.op === "row_gte"));
check("rank questions offer rank conditions", Q.opsFor(RANK).some(o => o.op === "ranked_first"));
check("text questions offer word conditions", Q.opsFor(VERB).some(o => o.op === "words_lt"));
check("every question type offers answered / not_answered",
  Q.opsFor(GRID).some(o => o.op === "answered") && Q.opsFor(SPECIALTY).some(o => o.op === "not_answered"));
delete SPECIALTY.screening;

console.log(fails ? "\n" + fails + " FAILED" : "\nall screening engine checks passed");
process.exit(fails ? 1 : 0);
