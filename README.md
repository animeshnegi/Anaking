# Anaking — PROJECT BEACON research platform

A Flask survey platform for pharma market research: multi-study builder, gamified
respondent survey with audio narration and a conjoint (discrete-choice) experiment,
live admin dashboard, data-quality flags and Excel/CSV/JSON exports.

The original deliverable — a 24-question conjoint survey for a fictional oncology brand
launch (PROJECT BEACON, US oncologists) — ships pre-seeded as study `beacon`.

## Project layout

```
Anaking/
├── app.py              application factory (create_app) + CLI entry point
├── config.py           settings — every value overridable by environment variable
├── models.py           SQLite schema/migrations + Study / Respondent / Answer models
├── routes/             one file per app, each mounted on its own URL
│   ├── home.py         /            landing page + legacy redirects
│   ├── survey.py       /survey/…    respondent survey + /api/*
│   ├── studio.py       /studio/     survey builder      + /api/studio/*
│   └── admin.py        /admin/      dashboard, exports  + /api/admin/*
├── core/               domain logic (no Flask routes in here)
│   ├── conjoint.py     balanced design generator + per-respondent randomisation
│   ├── qc.py           speeder / attention / straight-line / gibberish flags
│   ├── reporting.py    flattening, export sheets, quick analysis
│   ├── seed.py         seeds the BEACON study from survey_spec + data/design
│   ├── survey_spec.py  the 24-question BEACON instrument
│   ├── xlsx_export.py  openpyxl or stdlib .xlsx writer
│   └── auth.py         @admin_required token guard
├── templates/
│   ├── home.html       landing page
│   ├── survey/         survey.html, not_live.html
│   ├── studio/         studio.html
│   └── admin/          dashboard.html
├── static/
│   ├── css/            home.css, survey.css, studio.css, admin.css
│   ├── js/             survey.js, qlogic.js (piping/show-if/sanitiser), explainer.js, admin.js, studio.js
│   ├── images/
│   └── audio/          narration clips (mp3)
├── data/
│   ├── design/         conjoint design inputs (design.json, respondent_task_map.csv, …)
│   └── survey.db       SQLite database — created on first run, git-ignored
├── uploads/
│   ├── voice/          respondent voice recordings — git-ignored
│   ├── narration/      per-study narration clips uploaded in the Studio — git-ignored
│   └── media/          images / video attached to questions — git-ignored
├── tests/              pytest suite (Flask test client, temp DB)
├── scripts/            live-server e2e checks + demo data seeder
├── study_design/       questionnaire (.md/.docx), design generator, sample export
└── requirements.txt
```

## Run

```bash
pip install -r requirements.txt
python3 app.py --port 8000 --admin-token <token>     # add --debug for auto-reload
```

Three separate apps, each on its own URL (the home page at `/` links to all of them):

| App | URL | What it is |
|---|---|---|
| **Home** | `/` | Landing page: links to the three apps + list of studies on the server |
| **Survey** | `/survey/` | Respondent link — the live BEACON survey |
| | `/survey/test` | Same survey, stored as **test data** (codes T001, T002 …) |
| | `/survey/<slug>` , `/survey/<slug>/test` | Any study launched from the Studio (`?preview=<token>` for drafts) |
| **Sign in** | `/login` | Research team enters the admin token **once**; a cookie then unlocks Studio, Admin and draft previews on that browser (`/logout` ends it) |
| **Studio** | `/studio/` (`/studio/#<slug>` opens a study) | Builder — create / edit / launch studies, design the walkthrough, generate conjoint designs, per-study analysis |
| **Admin** | `/admin/` (`?study=<slug>` picks a study) | Dashboard — live counts, quota fill, QC flags, downloads, reset |
| | `/admin/export.xlsx\|csv\|json?token=…&study=…&scope=all\|real\|test` | Exports |
| | `/healthz` | Liveness check |

Old respondent links (`/test`, `/s/<slug>`) redirect permanently to the new `/survey/…` paths.

Every page header carries the same **Home · Survey · Studio · Admin** switcher, so the team can hop
between apps without retyping anything. Respondents see none of this — the team strip on the survey
only renders for a signed-in browser.

**Admin token.** The default is `beacon-admin`; change it with `ADMIN_TOKEN=…` or
`--admin-token …` before going live (the server prints it at start-up). Explicit
`?token=<ADMIN_TOKEN>` (or an `X-Admin-Token` header) still works on every Studio/Admin URL and
API for scripts and bookmarks — opening such a link also signs the browser in.

Configuration (environment variables): `ADMIN_TOKEN`, `PORT`, `HOST`, `DB_PATH`,
`VOICE_DIR`, `NARRATION_DIR`, `SECRET_KEY`. Defaults put the database in `data/survey.db`,
respondent recordings in `uploads/voice/` and uploaded narration in `uploads/narration/<study>/`.

### Studio workspace (Studio → Questions)

The builder is a three-pane workspace - nothing to open or apply, and **every change autosaves**
about a second after you stop typing (toggle in the top bar; `Ctrl/⌘+S` or **Save now** forces it;
the bar always shows *All changes saved · 14:02* / *Unsaved changes* / *Not saved - Retry*).

| Pane | What it does |
|---|---|
| **Outline** (left) | Sections with their questions. Click a row to edit it; hover for move / duplicate / delete (delete offers **Undo**). **+ Add question** opens a picker of plain-English types ("Choose one", "Rating grid", "Open text"…) grouped by kind; the new question lands after the selected one and gets the next free id. Section titles are edited in place. |
| **Editor** (middle) | One scrolling form for the selected question, with a jump bar: **Question** (rich text + help), **Answer options / Rows & scale** (inline list with code, label, ➔ Pipe in answer, Pin / Exclusive / Other chips, image, reorder, one-click *None of these* / *Not applicable* / *Other*, paste a list), **Display & order** (layout segment, randomise, hide number / codes, font / size / alignment), **Show only when…** (conditions in sentence form - *when Q1 has selected Oncology*, and/or, invert), **Image or video**, **Advanced (JSON)**. Id, type (convertible - compatible answers are kept), section and Required sit in the header. |
| **Live preview** (right) | The question rendered by the same code respondents run; updates as you type. Sample answers for piping / logic, reshuffle, desktop / phone width, ▶ **Test** opens it full size. |

Rich text: bold / italic / underline / strike / superscript, text & highlight colour, lists,
bigger / smaller, clear formatting. **Piping:** every text field has a **➔ Pipe in answer**
button - click where the answer should appear, press it, pick from a searchable list grouped by
earlier question ("Their answer (as text)", "Answer code", "First / last option they ticked",
"Text typed in Other", a fixed option label, a row's rating, the question wording), each with an
*e.g.* from the sample answers. Tokens show as chips in the editor and are stored as plain text
(`{Q3}`, `{Q3.code}`, `{Q3.opt:2}`, `{Q3.first}`/`{Q3.last}`, `{Q3.other}`, `{Q3.row:a}`,
`{Q3.r:a}`, `{Q3.stem}`); an unanswered reference renders as "…".

The dashboard (Studio home) lists studies as cards with completion stats, search and a
draft / live / closed filter; status is switched from the segment in the builder bar
(launching asks for confirmation and flushes any pending save first).

Rich text is whitelisted on save (`core/sanitize.py`) and again in the browser
(`static/js/qlogic.js`), so only formatting survives — no scripts, event handlers or unsafe URLs.
The plain-text `stem` is kept in step with the rich `stem_html` for exports, narration and QC.
`static/css/preview-skin.css` is generated from `survey.css` by
`python3 scripts/build_preview_skin.py` (re-run after changing survey styles).

### Product walkthrough (Studio → "Walkthrough" tab)

The animated walkthrough respondents see before the survey is an editable list of **scenes**.
Each scene has a title, caption, an artwork picked from the built-in set (patient, trial,
mechanism, efficacy, safety, biomarker, dosing, access, attributes, generic) and — optionally —
an uploaded narration clip (mp3 / m4a / ogg / wav / webm, ≤ 8 MB). Scenes can be added, removed
and reordered; "Build scenes from text" turns the seven product-profile text fields into a
starting set of scenes. Per scene, narration is resolved as: uploaded clip → browser
text-to-speech (if enabled) → silent timer. **Preview walkthrough** plays the unsaved draft.

Production: `gunicorn -w 2 -b 0.0.0.0:8000 "app:create_app()"`

## Tests

```bash
python3 -m pytest                               # in-process suite, no server needed

python3 app.py &                                # live-server scripts
python3 scripts/e2e_live_server.py              # full flow, screen-outs, QC flags, exports
python3 scripts/e2e_reuse_live_server.py        # test/real scopes, xlsx, reset & reuse
python3 scripts/seed_demo.py                    # 7 demo respondents + sample workbook
node scripts/dom/studio_workspace_test.js       # Studio workspace: outline/editor/preview, autosave (needs jsdom)
node scripts/dom/pipe_picker_test.js            # Studio pipe picker (needs jsdom: npm i jsdom)
```

## Study design material

`study_design/` holds the field-ready questionnaire (`BEACON_survey_questionnaire.md`
/ `.docx`), `conjoint_design.py` (regenerates `data/design/`), a sample Excel export, and
a detailed README on the instrument, screener logic and export format.
