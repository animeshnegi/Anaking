# Anaking — PROJECT BEACON research platform

Pharma market-research stack built in this workspace. Two parts:

## `oncology_launch_study/`
The original deliverable: a 24-question conjoint survey for a fictional oncology
brand launch (Project BEACON, US oncologists).

- `BEACON_survey_questionnaire.md` / `.docx` — field-ready questionnaire
- `conjoint_design.py` — generates the randomized CBC design
  (`output/design.json`, `output/respondent_task_map.csv`)
- `BEACON_sample_export.xlsx` — sample data export

## `oncology_launch_study/webapp/`
The live platform — a multi-survey system:

- **Survey platform** (`app.py`, `survey.js`, `explainer.js`, `survey.css`)
  — audio narration, animated TPP walkthrough, 24 questions incl. gamified
  NPS / MaxDiff / heatmap / emoji grid, real-time data-quality flags
  (gibberish, straight-lining, speed, straight answers), voice responses,
  pause/resume, reusable respondent links (`/?code=...`).
- **Studio builder** (`studio.html`, `studio.js`, `studio.css`) — draft as
  many surveys as you like: create / duplicate / rename / delete, add /
  edit / remove / reorder questions (custom counts and new question types),
  paste TPP text and it is segmented into animated scenes, generate a
  balanced conjoint design, go live on a public URL (`/s/<slug>`), and see
  per-survey responses, flags, charts and Excel exports — every survey
  stores and exports its own data separately.
- **Admin dashboard** (`admin.html`, `admin.js`, `admin.css`) — live data,
  quality flags, CSV/JSON/XLSX export, test-data reset.

### Run locally
```bash
cd oncology_launch_study/webapp
python3 app.py --port 8000 --admin-token <token>
# respondent link : http://localhost:8000/
# studio builder  : http://localhost:8000/studio?token=<token>
# admin dashboard : http://localhost:8000/admin?token=<token>
```
Requires Python 3.11+ (stdlib only; `openpyxl` for Excel exports).

### Tests
```bash
cd oncology_launch_study/webapp
python3 test_e2e.py     # 45-question full flow, quality flags, reuse
python3 test_reuse.py   # respondent-link reuse / resume
```

## `uploads/`
Reference material (screenshots) used during development.

---
Runtime data (`survey.db`, respondent voice recordings) is deliberately
excluded from the repository via `.gitignore`.
