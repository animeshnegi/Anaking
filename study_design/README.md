# PROJECT BEACON — US Oncology Brand Demand Study

Pre-launch demand study for a new oncology brand in the US market.
n = 100 US oncologists. 20-question quantitative instrument with an embedded discrete choice
experiment (conjoint).

## Online survey

The instrument is fieldable as a web app, and built to be re-run as many times as you like
for testing.

```bash
# from the repository root
pip install -r requirements.txt
python3 app.py --port 8000 --admin-token beacon-admin
```

| URL | What it is |
|---|---|
| `/` | Respondent link — the live survey |
| `/test` | Same survey, but the response is stored as **test data** (code T001, T002…) and excluded from real-data exports |
| `/?new=1` | Forces a fresh response in a browser that already completed one |
| `/admin?token=beacon-admin` | **Dashboard** — live counts, quota fill, demand headlines, QC flags, respondent list, downloads, reset buttons |
| `/admin/export.xlsx?token=...&scope=all\|real\|test` | Excel workbook |
| `/admin/export.csv?token=...&scope=...` | Flat CSV |
| `/admin/export.json?token=...&scope=...` | Nested JSON |
| `POST /admin/reset?token=...&scope=test\|real\|all` | Clear stored responses |

A Flask application (`app.py`, `routes.py`, `models.py`, `core/` at the repo root) on SQLite. The Excel
export uses openpyxl when present and falls back to a standard-library OOXML writer
otherwise — either way you get a real `.xlsx`, never a renamed CSV. Responses live in
`data/survey.db`.

### Reusing the link for repeated testing

Three things make the same link safe to test against over and over:

1. **Separate test sequence.** `/test` creates T-prefixed respondents in their own storage
   namespace in the browser, so a test run cannot overwrite or be confused with real data.
2. **Scoped exports.** Every download takes `scope=all|real|test`, so test runs never leak
   into the dataset you analyse.
3. **Reset without collisions.** Respondent codes are assigned `MAX+1` rather than `COUNT+1`,
   so clearing records cannot produce a duplicate code. After "Clear test data" the next
   respondent is T001 again.

The dashboard's *Clear test data* button is the normal loop: test, download, clear, test again.

### Excel workbook contents

| Sheet | Contents |
|---|---|
| **Field summary** | Counts, completion rate, mean interview length, QC-flag count, quota fill by Census division and practice setting, demand headlines |
| **Responses** | One row per respondent, ~143 columns, every question flattened with answer text alongside codes |
| **Conjoint long** | One row per respondent × task × alternative with a `chosen` flag and all 7 attributes coded 1–3 — the analysis-ready layout for a conditional or mixed logit |
| **Screen-outs** | Who was terminated, at which question, and why |
| **QC flags** | Speeders, attention-check failures, straight-liners, uniform conjoint choosers |
| **Data dictionary** | Every question, item, code and scale, with terminating options marked |

`BEACON_sample_export.xlsx` in this folder is a real workbook generated from 7 seeded demo
respondents, so you can inspect the format before fielding. Regenerate it with
`python3 scripts/seed_demo.py`.

### Verification

An in-process pytest suite plus two scripts that run against a live server:

- `tests/` — `python3 -m pytest` — pages, auth, respondent flow, Studio lifecycle,
  conjoint generator, exports and reset, all through Flask's test client on a temp DB.
- `scripts/e2e_live_server.py` — 35 checks: submit, screen-out logic, QC flagging,
  CSV/JSON export, access control. Resets first, so it is deterministic.
- `scripts/e2e_reuse_live_server.py` — 45 checks: test-mode sequences, scope filtering,
  xlsx structure and sheet contents, the standard-library xlsx fallback, reset behaviour.

All currently pass in full.

### What it implements

- **All 20 questions render from `core/survey_spec.py`**, a machine-readable spec that
  mirrors the questionnaire. Edit the spec, and the survey changes — no HTML editing.
- **Screener logic**: radiation/surgical/primary-care and industry-conflict respondents are
  terminated with the reason recorded; hematology-only respondents are held to the
  10-patient threshold; under-5-patient respondents are screened out.
- **Conjoint rendering** pulls the 9 tasks from `data/design/design.json` and applies the
  per-respondent task order and alternative-position randomisation from
  `data/design/respondent_task_map.csv`. Codes outside R001–R100 get a randomisation seeded from
  the code itself, so it is reproducible rather than changing on each restart.
- **Validation**: required fields, numeric ranges, sum-to-100 grids, minimum verbatim length.
- **Progress persistence**: answers autosave server-side and to localStorage, so a refresh or
  dropped connection resumes rather than restarts.
- **Quality control flags** computed at submit: speeder (<8 min), attention-check failure,
  Q7 straight-lining, uniform conjoint choice, thin verbatims. Screened-out respondents are
  never flagged, since they never reached the questions being checked.
- **Quota fields** derived automatically: practice setting group, state, Census division.

## Engagement and attention layer

Oncologists satisfice — they click through. This layer attacks that directly, in three ways,
only one of which is decoration.

**1. Narrated product walkthrough.** The blinded target product profile is presented as an
animated explainer rather than a table to read. Six SVG scenes — the patient, the trial
design, the blinded mechanism, efficacy, safety, patient selection — advance on the narration
clock, so picture and voice cannot drift apart if the audio stalls. Seven narration clips,
139 seconds total, generated with TTS and served from `/audio/` with HTTP Range support so
the browser can seek. A separate clip explains the choice tasks, and section intros are
narrated too. Sound is toggleable and the choice persists per browser.

This is animation, not video: inline SVG with CSS transitions, so there are no video files,
no codecs and no external requests.

**2. Comprehension checks (CC1, CC2).** Two questions immediately after the walkthrough confirm
the profile was actually understood — has overall survival been proven, and what was the
Grade 3+ AE rate. A wrong answer offers a replay of the walkthrough. It never screens the
respondent out and is recorded in the export, so you can see how much of your sample actually
understood the profile before interpreting their opinions.

**3. Minimum dwell time on the conjoint.** The Next button stays locked for 12 seconds on each
choice task, with a ring showing the wait. This cannot be satisfied by clicking through, which
is the single most effective guard against the satisficing you are worried about.

**Gamification** sits on top: a progress ring, insight points, section milestones with
confetti. Points are awarded for completing sections and passing comprehension checks —
**never for speed**, and there is no timer pressure and no leaderboard. Rewarding speed in a
discrete choice experiment would produce exactly the hurried, heuristic answering that ruins
the utility estimates, so that lever was deliberately not pulled.

The conjoint itself moved from a dense table to cards, one per treatment option, with an icon
per attribute — easier to scan on a phone and harder to answer without reading.

If narration is blocked or unavailable, the explainer falls back to a timed text walkthrough
rather than stalling.

## Files

| File | What it is |
|---|---|
| `BEACON_survey_questionnaire.md` | **The deliverable.** Full 20-question instrument: 4 screeners, 15 main questions, 1 conjoint (9 choice tasks), classification block, quotas, QC rules, analysis plan, fielding notes. |
| `BEACON_survey_questionnaire.docx` | Same instrument, formatted for client circulation. |
| repo root | The online survey: `app.py`, `routes.py`, `models.py`, `core/`, `templates/`, `static/`, tests. |
| `conjoint_design.py` | Generates and validates the conjoint design. Re-run to regenerate everything in `data/design/`. |
| `data/design/dce_design_wide.csv` | The 9 choice tasks — load this into the survey platform. |
| `data/design/dce_design.csv` | Same design in long format (one row per task/alternative). |
| `data/design/respondent_task_map.csv` | Per-respondent task order and alternative position randomisation. |
| `data/design/design_checks.txt` | Design diagnostics: level balance, orthogonality, dominance, D-efficiency, analysis-path check. |
| `data/design/analysis_check.json` | Machine-readable output of the analysis-path check. |
| `data/design/design.json` | The design as structured data for downstream analysis code. |

## The conjoint design

7 attributes × 3 levels, 9 choice tasks per respondent, 3 treatment alternatives plus a
"continue current standard of care" opt-out. Attributes: median overall survival, 12-month
PFS, Grade 3+ AE rate, administration route, companion diagnostic turnaround, net 12-month
cost, payer access status.

Built on an orthogonal main-effects plan — a 3^(7-4) fractional factorial, 27 profiles in
which every level of every attribute appears exactly 9 times — then partitioned into 9
tasks by hill-climbing that forbids dominant alternatives and maximises the conditional
logit information determinant.

Verified checks (see `data/design/design_checks.txt`):

- Every attribute level appears exactly 9 times (33.3% each) — perfectly balanced.
- Cross-attribute correlation: max |r| = 0.0000 — attributes are orthogonal, so each utility
  is estimated independently of the others.
- Dominant or duplicated alternatives: 0 — every task forces a real trade-off.
- D-efficiency: 99.2% of the unconstrained D-optimal benchmark for these profiles.
- 900 choice observations (100 respondents × 9 tasks) supporting 15 utility parameters.

## Analysis-path check — what it is and what it is not

`conjoint_design.py` simulates 100 respondents choosing among the real design profiles under
a known set of utilities, then fits the conditional logit by maximum likelihood and compares.
The recovered coefficients correlated 0.987 with the true values, with standard errors of
0.12–0.20 and McFadden pseudo-R² of 0.198.

**This proves the design is analysable at n=100.** It is a check on the design and the
estimation pipeline, run on synthetic data. It is not a market research result — no
oncologists were surveyed, and none of those numbers say anything about how real US
oncologists will value these attributes.

## Before fielding

1. Replace every `[TARGET INDICATION]` placeholder and populate the Q6 competitor set with
   the actual brands the new product will compete against.
2. Have medical affairs and legal review the blinded TPP card shown at the start of Section C.
3. Confirm the conjoint attribute levels match the real product profile — in particular the
   actual administration route, the real CDx turnaround, and the intended net price range.
   If any level is wrong, change it in `ATTRIBUTES` in `conjoint_design.py` and re-run; do
   not edit the CSVs by hand.
4. Pilot with 5 oncologists and re-check LOI, particularly the conjoint section.

## Regenerating

```bash
python3 conjoint_design.py    # rebuilds the design and all checks (takes ~8 minutes)
python3 build_docx.py         # rebuilds the .docx from the markdown
```

The design is seeded (`RNG = np.random.default_rng(20260909)`), so re-running reproduces the
same design and the same randomisation map.
