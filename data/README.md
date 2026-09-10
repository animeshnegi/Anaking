# data/

- `design/` — pre-generated conjoint design for the seeded BEACON study
  (`design.json`, `respondent_task_map.csv`, plus the CSV/long forms and design checks).
  Regenerate with `python3 study_design/conjoint_design.py`.
- `survey.db` — the SQLite database (studies, respondents, answers). Created on first
  run; git-ignored. Override the location with `DB_PATH=/path/to/survey.db`.
