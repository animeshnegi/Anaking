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
│   ├── survey.py       /survey/…    respondent survey + /api/* (incl. /api/check_text)
│   ├── studio.py       /studio/     survey builder      + /api/studio/* (translate, move, outline,
│   │                                                    duplicate, invites, launch, remind, pause)
│   └── admin.py        /admin/      dashboard, exports  + /api/admin/*
├── core/               domain logic (no Flask routes in here)
│   ├── conjoint.py     balanced design generator + per-respondent randomisation
│   ├── mailer.py       SMTP settings + invite/reminder mail bodies for the launch flow
│   ├── qc.py           speeder / attention / straight-line / verbatim-quality flags
│   ├── ai_detect.py    AI-generated & pasted answer detection + proofreading notes
│   ├── i18n.py         language catalogue + extraction/merge of respondent-visible strings
│   ├── translator.py   keyless machine translation (tag-safe), injectable for tests
│   ├── outline.py      "Download Word Outline" - stdlib .docx questionnaire outline
│   ├── reporting.py    flattening, export sheets, quick analysis
│   ├── screening.py    screening (screen in / screen out): config cleanup + plain-English logic
│   ├── seed.py         seeds the BEACON study from survey_spec + data/design
│   ├── survey_spec.py  the BEACON instrument
│   └── xlsx_export.py  openpyxl or stdlib .xlsx writer
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
python3 app.py --port 8000                           # add --debug for auto-reload
```

Three separate apps, each on its own URL (the home page at `/` links to all of them):

| App | URL | What it is |
|---|---|---|
| **Home** | `/` | Landing page: links to the three apps + list of studies on the server |
| **Survey** | `/survey/` | Respondent link — the live BEACON survey. Respondents never see which section a question belongs to (screeners / main are team-only), and while a question is on screen the project details and progress line are hidden; the gamified strip (ring, points, rank, mic, sound) stays on top when *Gamified feel* is on — see below |
| | `/survey/test` | Same survey, stored as **test data** (codes T001, T002 …) |
| | `/survey/<slug>` , `/survey/<slug>/test` | Any study launched from the Studio (test mode also previews drafts) |
| **Studio** | `/studio/` (`/studio/#<slug>` opens a study) | Builder — create / edit / launch studies, design the walkthrough, generate conjoint designs, per-study analysis |
| **Admin** | `/admin/` (`?study=<slug>` picks a study) | Dashboard — live counts, quota fill, QC flags, written-answer AI review, downloads, reset |
| | `/admin/export.xlsx\|csv\|json?study=…&scope=all\|real\|test` | Exports |
| | `/healthz` | Liveness check |

Old respondent links (`/test`, `/s/<slug>`) redirect permanently to the new `/survey/…` paths.

Every page header carries the same **Home · Survey · Studio · Admin** switcher, so the team can hop
between apps without retyping anything. Respondents see none of this — the team strip on the survey
only renders in test mode (`/survey/<slug>/test`), which is also where drafts are previewed; the
respondent link of a draft or closed study shows a "not launched yet" page instead.

**Access.** There is no sign-in, token or password: Studio, Admin, the APIs and the exports are
open to anyone who can reach the server. Restrict access at the network or reverse-proxy layer
(VPN, IP allow-list, HTTP basic auth in nginx/Caddy, …) before exposing the platform publicly.

Configuration (environment variables): `PORT`, `HOST`, `DB_PATH`, `VOICE_DIR`, `NARRATION_DIR`,
`MEDIA_DIR`, `SECRET_KEY`. Defaults put the database in `data/survey.db`, respondent recordings in
`uploads/voice/` and uploaded narration in `uploads/narration/<study>/`.

### Respondent survey: answer by voice & the gamified feel

**Answer by voice.** The welcome page asks *How would you like to answer?* — **Tap my answers** (the
default) or **Answer by voice**. Voice uses the browser's own speech recognition (Web Speech API), so
there is no server key, account or cost. It works in Chrome, Edge and Safari; elsewhere the option stays
visible but disabled, with the reason. Respondents say an option's name or its number — several joined
with *and* — then *next* (also *back* and *clear*). The mic button in the top strip and the **Stop**
button on the voice bar switch voice off and on at any time; tapping always works too.

* Speech is recognised by the browser's speech service (Google's in Chrome), so check that suits your
  respondents before a live field.
* The browser asks for microphone permission the first time voice is turned on. If access is blocked,
  no microphone is found or the speech service cannot be reached, voice stops and the coach says why;
  the survey carries on with taps. Inside an embedded preview the browser may refuse the microphone —
  open the survey in its own tab to use voice.

**Coming back.** If a respondent returns in the same browser before answering anything, the welcome page
(and the choice of how to answer) shows again; the saved session is kept. Once a question has been
answered, reloading resumes at the next question. To start over in a browser, add `?new=1` to the link.

**Gamified feel** (Studio → the study → *Settings & QC* → *Respondent experience*; on by default): the
progress ring, insight points, ranks and confetti; a bull's-eye ripple on every answer; a "+N" that floats
up when a bonus lands; the arrow-in-target finish. While a question is on screen the project details
(brand, study, respondent code, timer) and the progress line are hidden, and a slim strip keeps the ring,
points, rank, mic and sound buttons on top. With the gamified feel off, questions show with nothing on top.

### Studio workspace (Studio → Questions)

The builder is a three-pane workspace - nothing to open or apply, and **every change autosaves**
about a second after you stop typing (toggle in the top bar; `Ctrl/⌘+S` or **Save now** forces it;
the bar always shows *All changes saved · 14:02* / *Unsaved changes* / *Not saved - Retry*).

| Pane | What it does |
|---|---|
| **Outline** (left) | Sections with their questions, as either a compact **List** or a grid of **Thumbnails** (the switch sits in the outline header, and the choice is remembered). Thumbnails show a miniature of the question — title, wording and a schematic of the answer area (option rows, rating scale, text box…). Click a row or card to edit it; hover for move / duplicate / delete (delete offers **Undo**). **+ Add question** opens a picker of plain-English types ("Choose one", "Rating grid", "Open text"…) grouped by kind; the new question lands after the selected one and gets the next free id. Sections are added from **+ Section** — in the header, so it is always reachable — or the button under the last section, and their titles are renamed in place. A new study starts with **one empty section**: section names are never predefined, they come from the author (leave one blank and it reads "Untitled section"). |
| **Editor** (middle) | Three tabs — **Content & Settings**, **Conditional Display** (who gets the question, in sentence form) and **Screening** (who is ended, in sentence form) — with a **PREVIEW** button for the full-size question, over one scrolling form with a jump bar: **Question** (rich text + help), **Answer options / Rows & scale** (one row per entry: position number, drag grip, code, label, ➔ Pipe in answer, image, an always-visible tool strip — move up, move down, delete — and a one-click *None of these* / *Not applicable* / *Other*, *Enter multiple…*; Pin / Exclusive / Other behaviour chips sit on their own line under the label. Sequence changes three ways: **drag the grip**, the **▲ / ▼** buttons, or focus a grip and press **↑ / ↓**), **Display & order** (layout segment, randomise, hide number / codes, font / size / alignment), **Image or video**, **Advanced (JSON)** — while **Conditional Display** holds the *Show only when…* conditions in sentence form (*when Q1 has selected Oncology*, and/or, invert) and marks the tab when rules are on. **ID** with the question **Title** stacked underneath it, type (convertible - compatible answers are kept), section and Required sit in the header. The Title is a short internal label for the sidebar and exports; respondents never see it. |
| **Live preview** (right) | The question rendered by the same code respondents run; updates as you type. Sample answers for piping / logic, reshuffle, desktop / phone width, ▶ **Test** opens it full size. |

Rich text: text size and font, bold / italic / underline / strike / superscript / subscript,
text & highlight colour, alignment, bullet & numbered lists, links, tables, "…" for the rarer
controls, a `</>` source view, full screen, and **+ Add Image & Video Attachments** straight
under the question text. **Piping:** every text field has a **➔ Pipe in answer**
button - click where the answer should appear, press it, pick from a searchable list grouped by
earlier question ("Their answer (as text)", "Answer code", "First / last option they ticked",
"Text typed in Other", a fixed option label, a row's rating, the question wording), each with an
*e.g.* from the sample answers. Tokens show as chips in the editor and are stored as plain text
(`{Q3}`, `{Q3.code}`, `{Q3.opt:2}`, `{Q3.first}`/`{Q3.last}`, `{Q3.other}`, `{Q3.row:a}`,
`{Q3.r:a}`, `{Q3.stem}`); an unanswered reference renders as "…".

### Screening — screen in / screen out (Studio → a question → **Screening**)

Every question can decide who carries on. The rules are **data on the question**, never code in
the app, so the questionnaire always explains itself and the same study can be copied, translated
and re-fielded with its screening intact.

| | |
|---|---|
| **No screening** | Everybody carries on. |
| **Screen out when…** | The matched respondent is ended and reads your closing text. |
| **Only continue when…** (qualify) | Only matched respondents carry on; everybody else is ended here. |

A rule is **all** / **any** of a list of conditions, each built from three controls:
*which question* (this one, any earlier one — later ones are grouped separately because they can
never fire here), *the condition*, and *the value*. The condition list follows the question type:

| Question type | Conditions |
|---|---|
| Choose one / multi-select | is · is not · **is any of** · **is none of** · **includes all of** · is exactly these · **selects at least / at most / exactly** *n* |
| Number, slider, NPS, date | equals · does not equal · is more than · at least · less than · at most · is between |
| Open text / loop | mentions · does not mention · is shorter than *n* words |
| Rating grid, rating scale, semantic, heat map, numeric matrix | row is / is not / is at least / is at most |
| Ranking | ranks … first · ranks … in the top *n* · includes all of · selects at least … |
| Any type | was answered · was skipped |

Groups and counts are the point: *"screen out when Q1 is any of Radiation oncology, Surgical
oncology"*, *"screen out when Q15 selects fewer than 2"*, *"continue only when Q3 is at least 5"*,
or the cross-question *"screen out when Q1 is Haematology only **and** Q3 is less than 10"*.

**Check the rule** decides when it is applied: **⚡ As soon as it matches** ends the survey the
moment the answer is given (the default for choice questions), while **→ When they press Next**
lets the respondent change their mind first (the default wherever a number, a grid or a text box
is still being filled in). Add the **Reason for the data** (the line recorded in the screen-out
report) and, if the standard closing wording is not right, the **Text the respondent reads**.

**Try it** at the bottom of the card: pick an answer by hand and read the verdict — *SCREENED OUT*
with the reason and the exact text the respondent would see, or *CONTINUES*. Earlier questions
use the same sample answers as the live preview.

Two more ways in:
* a **Screen out** switch on every answer option (Content & Settings → Answer options) — the
  quick one-click version, and it is shown on the Screening tab too;
* the **screen** badge in the outline, whose tooltip spells the whole rule out.

The rules also travel into the paperwork: the Word outline prints `Logic: screening: …` under the
question, the Excel data dictionary gets a `(screening)` row per rule, and the screen-out reason
and question id are stored on the respondent and shown in Admin.

**Conjoint experiments** are authored on the question that asks them: add a *Conjoint* question
and its editor shows the experiment name, a rich-text description (the `{amount}` / `{product}`
placeholder sentence), the attributes — each with **Add Range Levels** (from / to / step / suffix
→ *Build levels*), **Add Images** (a picture per level), **Group Inclusion** (ask the attribute in
a rotating subset of the sets) and *Lower is better* — each with its own levels and `+ Add Level`
(never below two), then **Allow "none"** with its own wording and **Configure Sampling**
(*Number of Cards*, *Number of Sets*). **Generate design** stores a balanced, dominance-free
design on the study; the respondent survey renders the authored labels, levels and level images,
skips a group-inclusion attribute in the sets it is not asked in, and the Excel export, conjoint
analysis and QC (uniform choice) all read the same design. The study-level **Conjoint** tab appears
only once the study has a conjoint question (or an existing generated design) and shows what that
study will field.

The dashboard (Studio home) lists studies as cards with completion stats, search and a
draft / live / paused / closed filter; status is switched from the segment in the builder bar
(launching asks for confirmation and flushes any pending save first). Every card also carries the
study's **Actions**: Preview Survey (opens the testing link in a new window), Duplicate Survey
(a full copy as a fresh draft), Launch Survey, Pause Survey / Relaunch Survey and Send Reminder.

### Launching, invites & reminders (Studio home → the study card)

**Launch Survey** asks for the recipient list (paste one person per line as `email` or
`email, name`, or upload a CSV with an `email` column and an optional `name` column), a subject and
an optional message. Launching takes the study live and gives every recipient a personal
`/survey/<slug>?rid=…` link, so responses can be attributed back to the person who was invited.
Mail goes out over SMTP when it is configured (`BEACON_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`,
`_FROM`, `_TLS`, or a `data/mail.json` with the same keys); without it every send is still recorded
in the built-in outbox — open **View invite log** on the card to see each recipient, its status
(sent / queued / failed), its copyable link and a CSV download (`/api/studio/invites.csv`).
**Send Reminder** nudges only the people who have not taken part yet, reuses their personal link and
is capped at two per launch. **Pause Survey** stops *new* starts only: `/api/start` is refused with
`paused: true` and respondents see a paused notice, while anyone already answering can save and
submit normally; **Relaunch Survey** opens the study to new respondents again.

Rich text is whitelisted on save (`core/sanitize.py`) and again in the browser
(`static/js/qlogic.js`), so only formatting survives — no scripts, event handlers or unsafe URLs.
The plain-text `stem` is kept in step with the rich `stem_html` for exports, narration and QC.
`static/css/preview-skin.css` is generated from `survey.css` by
`python3 scripts/build_preview_skin.py` (re-run after changing survey styles).

### Survey options & globalisation (Studio bar → SURVEY OPTIONS)

The builder bar carries the full **SURVEY OPTIONS** menu: **Settings**, **Share survey
preview** (test + respondent links, copy button), **Move survey…** (new slug - uploaded
media and narration travel with it), **Duplicate**, **Download Word Outline** (a real
`.docx` of the questionnaire, in any language, written with the standard library only),
**Start Tracking** (go live), **Duplicate & Translate…** (copy the study and jump straight
into its translation panel), **Globalize Survey…**, **Edit title and language…** and
**Delete survey**.

**Globalisation.** A study is authored in its default language (**English US** unless
changed in *Edit title and language*) and can be translated into any of the ~36 approved
field languages (`core/i18n.py`). Only **respondent-visible** strings are extractable -
question stems and rich text, help text, placeholders, option / row / column labels,
scale labels, section titles, the welcome & thank-you pages, walkthrough scene captions -
so notes and directions aimed at the research team are *never* offered for translation
and always stay in the default language. The **Globalize Survey** panel lists each
language with its coverage bar and offers, per language:

* **manual translation** - a searchable table (context · source · translation, *missing
  only* filter) that saves through `POST /api/studio/translate`;
* **AI-translate missing** - server-side machine translation
  (`core/translator.py`, keyless Google endpoint, tag-safe for rich text) that fills only
  the gaps and never overwrites manual work; when the network is unavailable every string
  is reported as failed and simply stays for manual translation.

Respondents pick their language on the welcome page (native names); the choice re-renders
the survey (`/api/spec/<slug>?lang=es`), RTL languages flip the page direction, missing
strings fall back to the default language, and each respondent's language is stored and
exported as a `language` column.

**Survey flow & objects** (also in the add-item library): Welcome Page / Thank You Page
(copy lives in Settings → *Survey pages & flow*), **Question Page** (new section),
**Question Loop** (ask one text/number question for a list of items), **Page Randomizer**
(middle sections shuffle per respondent, seeded by their session) and **Embedded
Variables** (names captured from the respondent link, e.g. `?panel=A` → exported as
`ev_panel`).

### The add-item library (Studio → + Add question)

Grouped exactly like a commercial builder: **Questions** - Single Select (incl. image
options), Grid, Rating Scale (rows on one scale with low-end, mid and high-end labels),
Rank Order, Scale, Text Entry, Numeric Entry, Net Promoter,
Constant Sum, Numeric Matrix, Date, Delta (before / after / change); **Methodologies** -
Max Diff experiment, Conjoint, Concept Test, Heatmap; **Survey flow** - Welcome Page,
Thank You Page, Question Page, Question Loop, Page Randomizer; **Objects** - Embedded
Variable, Text Block. Every type is fully editable (rows, scales, ranges, labels,
placeholders, rich text, logic, media, styling) and every answer type flows into the
flattened exports and the data dictionary.

### Written-answer quality: AI-generated & pasted text (all open-text questions)

Free text is the part of a study most often faked - paste a chatbot answer into the box and
move on - so **every** free-text answer the study can collect is checked: each `open_text`
question *and* every "please specify" box. The check is plain Python (`core/ai_detect.py`):
no model weights, no network call, no new dependency, and it never deletes or blocks data.

Two families of evidence are combined into one 0-100 score:

| Family | Signals |
|---|---|
| **Linguistic** | AI self-identification and refusal phrasing ("as an AI language model…"), hallmark vocabulary (*delve, moreover, it is important to note, robust, landscape, streamline*…), markdown / smart-quote artefacts and list-shaped answers, a metronome sentence rhythm, essay-shaped paragraphs, an impersonal register with no contractions, *firstly / secondly / finally* scaffolding, no numbers or specifics from real practice |
| **Behavioural** | keystrokes, pasted characters, characters per second of active typing, one-shot paste bursts, long tab-switches while "writing" — collected by `static/js/survey.js` and stored with the answer as `_meta` |

Human evidence subtracts (contractions, first person, informal phrasing, concrete numbers,
mechanical slips), so a rough, first-hand answer cannot be pushed over the line by one stray
"overall,". Typing also pushes the pasted-character count back down, so a respondent who pastes
a draft and then rewrites it by hand is not still carrying that paste on their record.

The same scoring runs three times over the same answer, which is what makes the flag defensible:

1. **While the respondent types** — `POST /api/check_text` scores the text as they go. The box
   shows a chip with the score and the reasons ("AI-typical vocabulary · no contractions"),
   plus proofreading notes (doubled words, placeholder brackets, run-on sentences, stray
   markdown). In **confirm** mode they must either rewrite it or press *"I wrote this myself"*
   before moving on; **warn** mode never holds them up.
2. **On submit** — a final proofreading step lists every written answer that still looks
   AI-generated, pasted or broken, with a rewrite box and a re-check button, before the survey
   is sent. `POST /api/submit` re-scores everything server-side, so a client that skipped the
   live call is still flagged: `ai_generated_<qid>` (likely), `ai_suspect_<qid>` (possible) and
   the respondent-level roll-up `ai_generated_verbatim`.
3. **After the field closes** — Admin → **Written answers** is the review queue: roll-up counts,
   per-question breakdown, and every answer worst-first with its score, evidence, proofreading
   notes, paste / keystroke telemetry and cross-respondent duplicates (one AI answer shared
   round a panel). Filter by question, verdict or text; the same data ships as the
   **Verbatim AI check** sheet of the Excel export, and per-answer columns
   (`<qid>_ai_score`, `<qid>_ai_verdict`, `<qid>_ai_confirmed_own_words`, `<qid>_pasted_chars`,
   `<qid>_keystrokes`) in **Responses**.

Flags raised: `ai_generated_<qid>` (likely) and `ai_suspect_<qid>` (possible), plus a
respondent-level `ai_generated_verbatim`. Nothing is ever deleted or blocked after the fact - a
flagged answer stays in the data, marked, so the team can decide what to do with it.

Settings live in Studio → **Settings & quality control** ("Written-answer AI check": what the
respondent sees, warn-from / flag-from thresholds, and whether every open-text answer or only
the listed verbatim ids are checked) with a per-question override on each open-text question
(`ai_check`, `ai_action`). The check is **on by default** for every study, including ones saved
before it existed.

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
python3 -m pytest tests/test_ai_detect.py       # AI-answer detection, flags, queue, exports
python3 -m pytest tests/test_globalize.py       # languages, translation, outline, new question types
python3 -m pytest tests/test_sections.py        # sections start empty, naming, save validation
python3 -m pytest tests/test_screening.py       # screening config on save, plain-English logic, outline & export

python3 app.py &                                # live-server scripts
python3 scripts/e2e_live_server.py              # full flow, screen-outs, QC flags, exports
python3 scripts/e2e_reuse_live_server.py        # test/real scopes, xlsx, reset & reuse
python3 scripts/seed_demo.py                    # 7 demo respondents + sample workbook
node scripts/dom/studio_workspace_test.js       # Studio workspace: outline/editor/preview, autosave (needs jsdom)
node scripts/dom/studio_reorder_test.js         # option rows: drag / ▲▼ / keyboard reorder, delete button
node scripts/dom/survey_chrome_test.js          # respondent chrome: no section names, project details hidden while answering, gamified strip on top
node scripts/dom/studio_sections_test.js        # outline: blank starter section, + Section, Title field, thumbnails view
node scripts/dom/studio_conjoint_test.js        # Studio conjoint editor + the tab only showing for conjoint studies
node scripts/dom/survey_conjoint_test.js        # respondent conjoint: authored labels/levels/images, group inclusion, none
node scripts/dom/studio_actions_test.js         # dashboard actions: preview / duplicate / launch / pause / relaunch / reminder
node scripts/dom/pipe_picker_test.js            # Studio pipe picker (needs jsdom: npm i jsdom)
node scripts/dom/survey_ai_check_test.js        # respondent AI check: chip, gate, proofreading step
node scripts/dom/ai_check_team_test.js          # Studio AI settings + Admin review queue
node scripts/dom/globalize_test.js              # SURVEY OPTIONS menu, library, Globalize panel, language picker
node scripts/dom/screening_engine_test.js        # screening engine: groups, counts, qualify, live vs Next (no jsdom)
node scripts/dom/voice_commands_test.js          # voice answering: parser, welcome option, mic bar + Stop, blocked / silent mic messages, manual fallback
node scripts/dom/screening_studio_test.js        # Studio screening tab: modes, rule builder, tester, saved config
node scripts/dom/screening_survey_test.js        # respondent screening: ends on the spot, reason recorded
```

## Study design material

`study_design/` holds the field-ready questionnaire (`BEACON_survey_questionnaire.md`
/ `.docx`), `conjoint_design.py` (regenerates `data/design/`), a sample Excel export, and
a detailed README on the instrument, screener logic and export format.
