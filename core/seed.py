"""
Seeds the original PROJECT BEACON oncology study (slug ``beacon``) from ``survey_spec``
and the pre-generated conjoint design in ``data/design/``.
"""

from __future__ import annotations

import csv
import json

from flask import current_app

from models import Study

from . import survey_spec as spec


def load_design() -> dict:
    with open(current_app.config["DESIGN_PATH"]) as f:
        return json.load(f)


def load_task_map() -> dict:
    out = {}
    with open(current_app.config["TASKMAP_PATH"], newline="") as f:
        for row in csv.DictReader(f):
            out[row["respondent_id"]] = {
                "task_order": [int(x) for x in row["task_presentation_order"].split(",")],
                "alt_positions": {
                    k.replace("task", "").replace("_alternative_position_order", ""):
                        [int(v) for v in val.split(",")]
                    for k, val in row.items() if k.endswith("_alternative_position_order")
                },
            }
    return out


def conjoint_payload(design: dict) -> dict:
    attrs, levels = design["attributes"], design["levels"]
    tasks = {}
    for t_i, task in enumerate(design["tasks"], start=1):
        alts = []
        for a_i, profile in enumerate(task, start=1):
            alts.append({"alt_id": a_i, "levels": profile})
        tasks[str(t_i)] = alts
    return {"attributes": [{"id": a, "levels": levels[a]} for a in attrs],
            "tasks": tasks, "n_tasks": len(design["tasks"]),
            "has_opt_out": design.get("has_opt_out", True)}


def beacon_config() -> dict:
    design = load_design()
    narr = {k: {"src": "/audio/" + v["file"], "seconds": v["seconds"]}
            for k, v in spec.NARRATION.items()}
    return {
        "title": "PROJECT BEACON - US Oncologist Brand Demand Study",
        "sections": spec.sections_in_order(),
        "questions": spec.Q,
        "tpp": {
            "patient": "Advanced NSCLC, progressed on prior immunotherapy, ECOG 1",
            "mechanism": "Novel mechanism of action; details blinded for this study",
            "trial": "Randomised, controlled, Phase III versus current standard of care",
            "efficacy": "Significant improvement in progression-free survival; "
                        "overall survival data immature",
            "safety": "Treatment-related Grade 3+ adverse events in approximately "
                      "30% of patients",
            "administration": "As described in the choice tasks",
            "cdx": "Broad NGS panel",
        },
        "narration": narr,
        "explainer_scenes": spec.EXPLAINER_SCENES,
        "conjoint_scene": spec.CONJOINT_SCENE,
        "conjoint": conjoint_payload(design),
        "conjoint_min_dwell": spec.CONJOINT_MIN_DWELL,
        "use_tts": False,
        "metrics": {"intent_q": "Q12", "pct_q": "Q12b", "wtp_q": "Q18a"},
        "quota": {
            "state_q": "Q2b", "setting_q": "Q2a",
            "states": spec.STATES, "divisions": spec.CENSUS_DIVISION,
            "setting_quota": {str(o["code"]): o.get("quota", "")
                              for o in spec.BY_ID["Q2a"]["options"]},
        },
        "qc": {"attention_q": "Q13", "attention_ok": "2", "min_seconds": 480,
               "straightline_q": "Q7", "uniform_q": "Q16",
               "verbatim_qs": ["Q8b", "Q20b", "Q19c", "Q20c"]},
    }



def seed_beacon() -> bool:
    """Insert the BEACON study if missing. Returns True when it was created."""
    if Study.get("beacon"):
        return False
    return Study.seed("beacon", "PROJECT BEACON - US Oncologist Brand Demand Study",
                      beacon_config(), status="live")
