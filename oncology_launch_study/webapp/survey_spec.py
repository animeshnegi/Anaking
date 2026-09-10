#!/usr/bin/env python3
"""
PROJECT BEACON - machine-readable survey specification.

Single source of truth for the online instrument. The web app renders entirely from this
file, so editing a question here changes what respondents see. Mirrors
BEACON_survey_questionnaire.md exactly: 4 screeners, 15 main questions, 1 conjoint.

Question types the renderer understands:
    single_select, multi_select, rating_grid, semantic_diff, sum_to_100,
    numeric, slider, open_text, rank, choice_task
"""

TARGET_INDICATION = "advanced/metastatic NSCLC progressing on prior IO-based therapy"

SECTIONS = [
    {"id": "A", "title": "Screeners", "blurb": None},
    {"id": "B", "title": "Current practice and unmet need", "blurb": None},
    {"id": "C", "title": "Concept and demand",
     "blurb": "The following questions follow exposure to the target product profile. A blinded "
              "target product profile card is shown throughout this section - mechanism, pivotal "
              "trial design, headline efficacy, safety summary, administration and companion "
              "diagnostic requirement. No brand name and no sponsor identification."},
    {"id": "D", "title": "Treatment choice tasks",
     "blurb": "The next set of questions asks you to make treatment choices as you would in "
              "clinic. In each question you will see three treatment options for the same "
              "patient, each described by the same seven characteristics, plus the option to "
              "continue with current standard of care. There are no right or wrong answers. "
              "Choose the option you would actually prescribe, weighing all seven "
              "characteristics at once."},
    {"id": "E", "title": "Access, price and competition", "blurb": None},
    {"id": "F", "title": "Classification", "blurb": None},
]

VIGNETTE = ("A 64-year-old with " + TARGET_INDICATION + ", ECOG 1, who has progressed on prior "
            "IO-based therapy. No CNS metastases. Adequate organ function. Commercial insurance.")

# Narration clips, served from /audio/. Durations measured with soundfile.
NARRATION = {
    "welcome":          {"file": "welcome.mp3",          "seconds": 20.9},
    "tpp_part1":        {"file": "tpp_part1.mp3",        "seconds": 25.0},
    "tpp_part2":        {"file": "tpp_part2.mp3",        "seconds": 27.2},
    "conjoint_intro":   {"file": "conjoint_intro.mp3",   "seconds": 29.4},
    "section_practice": {"file": "section_practice.mp3", "seconds": 15.0},
    "section_access":   {"file": "section_access.mp3",   "seconds": 11.7},
    "complete":         {"file": "complete.mp3",         "seconds": 9.8},
}

# Minimum seconds a respondent must spend on each conjoint task before Next unlocks.
# This is the anti-satisficing gate: it cannot be satisfied by clicking through.
CONJOINT_MIN_DWELL = 12

# Animated explainer scenes. `at` is the second within the clip at which the scene appears.
EXPLAINER_SCENES = [
    {"id": "patient",   "clip": "tpp_part1", "at": 0,
     "title": "The patient in front of you",
     "caption": "Advanced NSCLC, progressed on prior immunotherapy"},
    {"id": "trial",     "clip": "tpp_part1", "at": 9.5,
     "title": "How it was studied",
     "caption": "Randomised, controlled Phase III versus current standard of care"},
    {"id": "mechanism", "clip": "tpp_part1", "at": 18,
     "title": "A new mechanism",
     "caption": "Blinded for this study"},
    {"id": "efficacy",  "clip": "tpp_part2", "at": 0,
     "title": "Efficacy",
     "caption": "PFS significantly improved. Overall survival data not yet mature."},
    {"id": "safety",    "clip": "tpp_part2", "at": 8.5,
     "title": "Safety",
     "caption": "Grade 3+ treatment-related adverse events in ~30% of patients"},
    {"id": "cdx",       "clip": "tpp_part2", "at": 18,
     "title": "Selecting patients",
     "caption": "Broad next-generation sequencing panel required"},
]

CONJOINT_SCENE = {"id": "attributes", "clip": "conjoint_intro", "at": 0,
                  "title": "How the choice tasks work",
                  "caption": "Seven characteristics, three options, plus your current standard of care"}

CONJOINT_INTRO = ("Assume all three options are otherwise clinically appropriate for this patient. "
                  "If none of the three is preferable to what you would do today, choose to "
                  "continue with current standard of care.")

Q = []

# ======================================================================================
# SECTION A - SCREENERS
# ======================================================================================
Q.append({
    "id": "Q1", "section": "A", "type": "single_select", "required": True,
    "stem": "Which of the following best describes your medical specialty and current practice?",
    "options": [
        {"code": 1, "label": "Medical oncology"},
        {"code": 2, "label": "Hematology / medical oncology (combined)"},
        {"code": 3, "label": "Thoracic oncology (sub-specialised)"},
        {"code": 4, "label": "Hematology only"},
        {"code": 5, "label": "Radiation oncology", "terminate": True},
        {"code": 6, "label": "Surgical oncology", "terminate": True},
        {"code": 7, "label": "Primary care / internal medicine", "terminate": True},
        {"code": 8, "label": "Other", "terminate": True, "other": True},
    ],
    "note": "Systemically treating oncologists are the prescriber of record. Radiation and "
            "surgical oncologists do not initiate systemic therapy in this setting.",
})

Q.append({
    "id": "Q2a", "section": "A", "type": "single_select", "required": True,
    "stem": "In which setting do you primarily practise?",
    "options": [
        {"code": 1, "label": "Community/private practice - single site", "quota": "community"},
        {"code": 2, "label": "Community/private practice - multi-site group", "quota": "community"},
        {"code": 3, "label": "Community hospital-affiliated practice", "quota": "academic"},
        {"code": 4, "label": "Academic medical centre / university hospital", "quota": "academic"},
        {"code": 5, "label": "NCI-designated comprehensive cancer centre", "quota": "academic"},
        {"code": 6, "label": "Integrated delivery network (IDN) employed", "quota": "academic"},
        {"code": 7, "label": "VA / government / military facility", "quota": "academic"},
        {"code": 8, "label": "Other", "quota": "academic", "other": True},
    ],
})

STATES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
          "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois",
          "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
          "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana",
          "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York",
          "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
          "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah",
          "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"]

# Census divisions, used for the geographic quota
CENSUS_DIVISION = {
    "Connecticut": "Northeast", "Maine": "Northeast", "Massachusetts": "Northeast",
    "New Hampshire": "Northeast", "Rhode Island": "Northeast", "Vermont": "Northeast",
    "New Jersey": "Northeast", "New York": "Northeast", "Pennsylvania": "Northeast",
    "Illinois": "Midwest", "Indiana": "Midwest", "Michigan": "Midwest", "Ohio": "Midwest",
    "Wisconsin": "Midwest", "Iowa": "Midwest", "Kansas": "Midwest", "Minnesota": "Midwest",
    "Missouri": "Midwest", "Nebraska": "Midwest", "North Dakota": "Midwest",
    "South Dakota": "Midwest",
    "Delaware": "South", "District of Columbia": "South", "Florida": "South", "Georgia": "South",
    "Maryland": "South", "North Carolina": "South", "South Carolina": "South", "Virginia": "South",
    "West Virginia": "South", "Alabama": "South", "Kentucky": "South", "Mississippi": "South",
    "Tennessee": "South", "Arkansas": "South", "Louisiana": "South", "Oklahoma": "South",
    "Texas": "South",
    "Arizona": "West", "Colorado": "West", "Idaho": "West", "Montana": "West", "Nevada": "West",
    "New Mexico": "West", "Utah": "Wyoming-West", "Wyoming": "West", "Alaska": "West",
    "California": "West", "Hawaii": "West", "Oregon": "West", "Washington": "West",
}
CENSUS_DIVISION["Utah"] = "West"

Q.append({
    "id": "Q2b", "section": "A", "type": "single_select", "required": True,
    "stem": "In which US state is that practice located?",
    "options": [{"code": i + 1, "label": s} for i, s in enumerate(STATES)],
})

Q.append({
    "id": "Q3", "section": "A", "type": "numeric", "required": True,
    "stem": "Approximately how many patients with " + TARGET_INDICATION + " do you personally "
            "initiate or manage on systemic therapy each month?",
    "min": 0, "max": 500, "suffix": "patients per month",
    "terminate_if_lt": 5,
    "terminate_message": "Thank you for your time. This study requires physicians who personally "
                         "manage at least 5 eligible patients per month.",
    "note": "Volume establishes genuine decision-making exposure.",
})

Q.append({
    "id": "Q3b", "section": "A", "type": "slider", "required": True,
    "stem": "Of those patients, roughly what share are covered by Medicare or Medicaid?",
    "min": 0, "max": 100, "step": 5, "suffix": "%",
})

Q.append({
    "id": "Q4", "section": "A", "type": "single_select", "required": True,
    "stem": "Have you or any member of your immediate family participated in market research on "
            "oncology therapies in the past 6 months?",
    "options": [
        {"code": 1, "label": "No"},
        {"code": 2, "label": "Yes, but not on oncology"},
        {"code": 3, "label": "Yes, on oncology therapies", "terminate": True},
        {"code": 4, "label": "I work for, or am closely affiliated with, a pharmaceutical, "
                             "biotech, CRO or market research company", "terminate": True},
        {"code": 5, "label": "Prefer not to say", "terminate": True},
    ],
})

# ======================================================================================
# SECTION B - CURRENT PRACTICE AND UNMET NEED
# ======================================================================================
Q.append({
    "id": "Q5", "section": "B", "type": "rating_grid", "required": True,
    "stem": "In your practice, who has the greatest influence over which systemic therapy a "
            "patient with this indication actually receives?",
    "scale": {"min": 1, "max": 5, "min_label": "No influence", "max_label": "Decisive influence"},
    "rows": [
        {"code": "a", "label": "You, as the treating oncologist"},
        {"code": "b", "label": "Other oncologists in your practice (peer consensus)"},
        {"code": "c", "label": "Multidisciplinary tumour board"},
        {"code": "d", "label": "Institutional clinical pathway / order set"},
        {"code": "e", "label": "Pharmacy & Therapeutics (P&T) committee"},
        {"code": "f", "label": "Health system formulary or value-analysis committee"},
        {"code": "g", "label": "Payer prior-authorisation requirements"},
        {"code": "h", "label": "The patient's own preference"},
        {"code": "i", "label": "Industry / manufacturer representative"},
        {"code": "j", "label": "Published guidelines (NCCN, ASCO)"},
    ],
})

COMPETITORS = [
    "Regimen A - [competitor 1]",
    "Regimen B - [competitor 2]",
    "Regimen C - [competitor 3]",
    "Chemotherapy doublet (platinum-based)",
    "Single-agent chemotherapy / docetaxel",
    "Best supportive care only",
    "Clinical trial",
    "Other",
]

Q.append({
    "id": "Q6", "section": "B", "type": "sum_to_100", "required": True,
    "stem": "Thinking about the last 3 months, what approximate share of your eligible patients "
            "received each of the following in this line of therapy?",
    "help": "Enter whole percentages. All rows must total 100%.",
    "rows": [{"code": f"r{i+1}", "label": c} for i, c in enumerate(COMPETITORS)],
})

Q.append({
    "id": "Q7", "section": "B", "type": "rating_grid", "required": True,
    "stem": "When choosing among available options for these patients, how important is each of "
            "the following to you personally?",
    "scale": {"min": 1, "max": 7, "min_label": "Not at all important",
              "max_label": "Critically important"},
    "qc_straightline": True,
    "rows": [
        {"code": "a", "label": "Overall survival benefit demonstrated in the pivotal trial"},
        {"code": "b", "label": "Progression-free survival / durability of response"},
        {"code": "c", "label": "Objective response rate"},
        {"code": "d", "label": "Rate of Grade 3+ treatment-related adverse events"},
        {"code": "e", "label": "Presence of specific, manageable toxicities (e.g. ILD, neuropathy, colitis)"},
        {"code": "f", "label": "Route and frequency of administration"},
        {"code": "g", "label": "Speed and accessibility of the required companion diagnostic"},
        {"code": "h", "label": "Quality-of-life and patient-reported outcome data"},
        {"code": "i", "label": "Strength of the subgroup data relevant to my patients"},
        {"code": "j", "label": "Real-world evidence available post-approval"},
        {"code": "k", "label": "Net cost to the practice under buy-and-bill"},
        {"code": "l", "label": "Likelihood of payer coverage without prior authorisation"},
        {"code": "m", "label": "Availability of patient support and reimbursement assistance"},
        {"code": "n", "label": "Familiarity of the mechanism with my practice"},
    ],
})

Q.append({
    "id": "Q8", "section": "B", "type": "rating_grid", "required": True,
    "stem": "How well do currently available therapies meet the needs of each of the following "
            "patient groups?",
    "scale": {"min": 1, "max": 5, "min_label": "Very poorly met", "max_label": "Very well met"},
    "rows": [
        {"code": "a", "label": "Patients with good performance status (ECOG 0-1) progressing rapidly"},
        {"code": "b", "label": "Patients with ECOG 2 or borderline performance status"},
        {"code": "c", "label": "Patients with CNS / brain metastases"},
        {"code": "d", "label": "Patients with a targetable driver mutation after TKI failure"},
        {"code": "e", "label": "Patients with high comorbidity burden or organ dysfunction"},
        {"code": "f", "label": "Patients for whom no biomarker is identified"},
        {"code": "g", "label": "Elderly patients (75 years or older)"},
    ],
})

Q.append({
    "id": "Q8b", "section": "B", "type": "open_text", "required": False,
    "stem": "For the group you rated lowest, in one or two sentences, what is missing?",
    "placeholder": "Type your answer here...", "min_words": 3, "multiline": True,
})

Q.append({
    "id": "Q9", "section": "B", "type": "single_select", "required": True,
    "stem": "In patients you are considering for biomarker-directed therapy, which best "
            "describes your current testing workflow?",
    "options": [
        {"code": 1, "label": "Broad NGS panel on all eligible patients; results back within 3-5 business days"},
        {"code": 2, "label": "Broad NGS panel on all eligible patients; results back in 7-14 business days"},
        {"code": 3, "label": "Targeted single-gene or small-panel testing only"},
        {"code": 4, "label": "Testing depends on the payer or the specific product's companion diagnostic"},
        {"code": 5, "label": "Testing is ordered but treatment often starts before results return"},
        {"code": 6, "label": "We rarely test in this line"},
        {"code": 7, "label": "Other", "other": True},
    ],
})

Q.append({
    "id": "Q9b", "section": "B", "type": "single_select", "required": True,
    "stem": "If a therapy required a companion diagnostic with a 10-business-day turnaround, how "
            "would that affect your use of it?",
    "options": [
        {"code": 1, "label": "Would not affect my use"},
        {"code": 2, "label": "Would delay but not prevent my use"},
        {"code": 3, "label": "Would limit me to a subset of patients"},
        {"code": 4, "label": "Would prevent me from using it"},
    ],
})

# ======================================================================================
# SECTION C - CONCEPT AND DEMAND
# ======================================================================================
# Comprehension checks. These are not scored against the respondent and never terminate;
# they exist to confirm the blinded profile was actually understood before opinion is
# collected, and to trigger a replay of the explainer when it was not.
Q.append({
    "id": "CC1", "section": "C", "type": "single_select", "required": True,
    "stem": "Quick check before we continue. Based on the profile you just saw, has an overall "
            "survival benefit been demonstrated for this product?",
    "comprehension": {"correct": 2, "replay": ["tpp_part1", "tpp_part2"]},
    "options": [
        {"code": 1, "label": "Yes, overall survival was significantly improved"},
        {"code": 2, "label": "No, overall survival data are not yet mature"},
        {"code": 3, "label": "I am not sure"},
    ],
    "note": "Comprehension check. A wrong answer replays the product explainer; it does not "
            "screen the respondent out.",
})

Q.append({
    "id": "CC2", "section": "C", "type": "single_select", "required": True,
    "stem": "And roughly what proportion of patients experienced Grade 3 or higher "
            "treatment-related adverse events?",
    "comprehension": {"correct": 2, "replay": ["tpp_part1", "tpp_part2"]},
    "options": [
        {"code": 1, "label": "About 5%"},
        {"code": 2, "label": "About 30%"},
        {"code": 3, "label": "About 70%"},
        {"code": 4, "label": "I am not sure"},
    ],
})

Q.append({
    "id": "Q10", "section": "C", "type": "rating_grid", "required": True,
    "stem": "Having reviewed the product profile, please indicate your agreement with each "
            "statement.",
    "scale": {"min": 1, "max": 7, "min_label": "Strongly disagree", "max_label": "Strongly agree"},
    "rows": [
        {"code": "a", "label": "I understand clearly how this product works"},
        {"code": "b", "label": "The efficacy results reported are believable given the mechanism"},
        {"code": "c", "label": "The safety profile is acceptable for the severity of this disease"},
        {"code": "d", "label": "The pivotal trial population resembles the patients I actually treat"},
        {"code": "e", "label": "This product would fill a gap that currently exists in my practice"},
        {"code": "f", "label": "I would feel confident explaining the benefit-risk profile to a patient"},
    ],
})

Q.append({
    "id": "Q11", "section": "C", "type": "semantic_diff", "required": True,
    "stem": "Compared with the current standard of care in this setting, how would you rate this "
            "product on each dimension?",
    "scale": {"min": 1, "max": 7},
    "rows": [
        {"code": "a", "label": "Efficacy", "left": "Much worse", "right": "Much better"},
        {"code": "b", "label": "Speed of onset", "left": "Much slower", "right": "Much faster"},
        {"code": "c", "label": "Durability of benefit", "left": "Much shorter", "right": "Much longer"},
        {"code": "d", "label": "Tolerability", "left": "Much worse", "right": "Much better"},
        {"code": "e", "label": "Convenience for the patient", "left": "Much worse", "right": "Much better"},
        {"code": "f", "label": "Operational burden on my practice", "left": "Much higher", "right": "Much lower"},
        {"code": "g", "label": "Overall clinical value", "left": "Much lower", "right": "Much higher"},
    ],
})

Q.append({
    "id": "Q12", "section": "C", "type": "single_select", "required": True,
    "stem": "If this product launched today and were available on formulary, what is the "
            "likelihood you would prescribe it?",
    "options": [
        {"code": 5, "label": "I would definitely prescribe it"},
        {"code": 4, "label": "I would probably prescribe it"},
        {"code": 3, "label": "I am not sure"},
        {"code": 2, "label": "I would probably not prescribe it"},
        {"code": 1, "label": "I would definitely not prescribe it"},
    ],
})

Q.append({
    "id": "Q12b", "section": "C", "type": "numeric", "required": True,
    "stem": "Thinking about your eligible patients over the next 12 months, what percentage would "
            "you expect to receive this product?",
    "min": 0, "max": 100, "suffix": "%",
})

Q.append({
    "id": "Q12c", "section": "C", "type": "single_select", "required": True,
    "stem": "How long after launch would it take you to prescribe it for the first time?",
    "options": [
        {"code": 1, "label": "Within 1 month"},
        {"code": 2, "label": "1-3 months"},
        {"code": 3, "label": "3-6 months"},
        {"code": 4, "label": "6-12 months"},
        {"code": 5, "label": "More than 12 months"},
        {"code": 6, "label": "Never"},
    ],
})

Q.append({
    "id": "Q13", "section": "C", "type": "single_select", "required": True,
    "stem": "Attention check - to confirm you are still with us, please select "
            "\"Somewhat likely\" for this question.",
    "attention_check": {"correct": 2},
    "options": [
        {"code": 1, "label": "Very likely"},
        {"code": 2, "label": "Somewhat likely"},
        {"code": 3, "label": "Neither likely nor unlikely"},
        {"code": 4, "label": "Somewhat unlikely"},
        {"code": 5, "label": "Very unlikely"},
    ],
})

Q.append({
    "id": "Q14", "section": "C", "type": "single_select", "required": True,
    "stem": "In which line of therapy or clinical setting would you most likely position this "
            "product first?",
    "options": [
        {"code": 1, "label": "First line, all-comers"},
        {"code": 2, "label": "First line, biomarker-selected only"},
        {"code": 3, "label": "Second line, post-progression on prior therapy"},
        {"code": 4, "label": "Second line, biomarker-selected only"},
        {"code": 5, "label": "Third line or later"},
        {"code": 6, "label": "Maintenance / continuation setting"},
        {"code": 7, "label": "Only in patients who have exhausted other options"},
    ],
})

Q.append({
    "id": "Q14b", "section": "C", "type": "rank", "required": True, "rank_count": 3,
    "stem": "Rank the three patient types you would treat first.",
    "help": "Use the arrows to reorder. Only your top three are recorded.",
    "rows": [
        {"code": "a", "label": "Good performance status (ECOG 0-1), progressing rapidly"},
        {"code": "b", "label": "ECOG 2 or borderline performance status"},
        {"code": "c", "label": "CNS / brain metastases"},
        {"code": "d", "label": "Targetable driver mutation after TKI failure"},
        {"code": "e", "label": "High comorbidity burden or organ dysfunction"},
        {"code": "f", "label": "No biomarker identified"},
        {"code": "g", "label": "Elderly (75 years or older)"},
    ],
})

Q.append({
    "id": "Q15", "section": "C", "type": "multi_select", "required": True, "max_select": 3,
    "stem": "What would have to be true for you to prescribe this product to a majority of your "
            "eligible patients?",
    "help": "Select up to three.",
    "options": [
        {"code": 1, "label": "Demonstrated overall survival benefit, not just PFS"},
        {"code": 2, "label": "Head-to-head data versus current standard of care"},
        {"code": 3, "label": "Real-world evidence in patients like mine"},
        {"code": 4, "label": "Inclusion in NCCN guidelines"},
        {"code": 5, "label": "A lower rate of Grade 3+ adverse events"},
        {"code": 6, "label": "A more convenient route or dosing schedule"},
        {"code": 7, "label": "Faster companion diagnostic turnaround"},
        {"code": 8, "label": "Broad formulary coverage without prior authorisation"},
        {"code": 9, "label": "A lower net acquisition cost"},
        {"code": 10, "label": "Strong patient support and reimbursement assistance"},
        {"code": 11, "label": "Familiarity built through peer experience and publications"},
        {"code": 12, "label": "Nothing further - I would prescribe it as described"},
        {"code": 13, "label": "Other", "other": True},
    ],
})

# ======================================================================================
# Q22 - MAXDIFF (BEST-WORST) - interactive attribute salience
# ======================================================================================
MAXDIFF_LABEL = {
    "OS": "Overall survival", "PFS12": "12-month PFS", "AE": "Grade 3+ AEs",
    "ROUTE": "Administration", "CDX": "Companion diagnostic", "COST": "Annual cost",
    "ACCESS": "Payer access",
}
Q.append({
    "id": "Q22", "section": "C", "type": "maxdiff", "required": True,
    "stem": "Which characteristics would matter most and least to you? In each round, "
            "star the ONE that matters most and arrow the ONE that matters least.",
    "help": "Four of the seven characteristics appear per round. There are no right answers - "
            "go with your instinct.",
    "rounds": [
        {"items": ["OS", "AE", "ROUTE", "COST"]},
        {"items": ["PFS12", "CDX", "ACCESS", "OS"]},
        {"items": ["AE", "ACCESS", "PFS12", "ROUTE"]},
        {"items": ["COST", "CDX", "OS", "ACCESS"]},
    ],
})

# ======================================================================================
# SECTION D - CONJOINT
# ======================================================================================
Q.append({
    "id": "Q16", "section": "D", "type": "choice_task", "required": True,
    "stem": "Treatment choice tasks",
    "vignette": VIGNETTE,
    "intro": CONJOINT_INTRO,
    "opt_out_label": "Continue current standard of care (none of these)",
    "qc_uniform": True,
    "note": "9 tasks x 3 alternatives plus opt-out. Task order and alternative position are "
            "randomised per respondent. Design: orthogonal main-effects plan, "
            "cross-attribute max|r| = 0.0000, zero dominant alternatives, "
            "D-efficiency 99.2% of the unconstrained benchmark.",
})

# ======================================================================================
# SECTION E - ACCESS, PRICE AND COMPETITION
# ======================================================================================
Q.append({
    "id": "Q17", "section": "E", "type": "rating_grid", "required": True,
    "stem": "If this product launched as described, how likely is it that you would encounter "
            "each of the following access barriers?",
    "scale": {"min": 1, "max": 5, "min_label": "Very unlikely", "max_label": "Almost certain"},
    "rows": [
        {"code": "a", "label": "Prior authorisation required by commercial payers"},
        {"code": "b", "label": "Step therapy / fail-first requirements"},
        {"code": "c", "label": "Delayed or denied coverage under Medicare Part B"},
        {"code": "d", "label": "Buy-and-bill margin insufficient to justify stocking the product"},
        {"code": "e", "label": "White-bagging or site-of-care restrictions imposed by the payer"},
        {"code": "f", "label": "Companion diagnostic not covered, creating a separate hurdle"},
        {"code": "g", "label": "Patient out-of-pocket exposure deterring initiation"},
        {"code": "h", "label": "Practice cannot get the product through its primary distributor"},
    ],
})

Q.append({
    "id": "Q17b", "section": "E", "type": "single_select", "required": True,
    "stem": "Which single barrier would most delay your ability to prescribe it?",
    "options": [
        {"code": "a", "label": "Prior authorisation required by commercial payers"},
        {"code": "b", "label": "Step therapy / fail-first requirements"},
        {"code": "c", "label": "Delayed or denied coverage under Medicare Part B"},
        {"code": "d", "label": "Buy-and-bill margin insufficient to justify stocking"},
        {"code": "e", "label": "White-bagging or site-of-care restrictions"},
        {"code": "f", "label": "Companion diagnostic not covered"},
        {"code": "g", "label": "Patient out-of-pocket exposure"},
        {"code": "h", "label": "Distribution constraints"},
    ],
})

Q.append({
    "id": "Q18a", "section": "E", "type": "numeric", "required": True,
    "stem": "At what net cost for a 12-month course would this product represent good value for "
            "the benefit it delivers?",
    "min": 0, "max": 1000000, "prefix": "$",
})

Q.append({
    "id": "Q18b", "section": "E", "type": "numeric", "required": True,
    "stem": "Above what annual cost would you begin to actively steer eligible patients toward "
            "alternatives?",
    "min": 0, "max": 1000000, "prefix": "$",
})

Q.append({
    "id": "Q18c", "section": "E", "type": "rating_grid", "required": True,
    "stem": "Rate the acceptability of each annual net cost, given the profile you have seen.",
    "scale": {"min": 1, "max": 3,
              "min_label": "Acceptable without reservation",
              "mid_label": "Acceptable, but I would seek alternatives first",
              "max_label": "Unacceptably high"},
    "rows": [{"code": f"p{i+1}", "label": c} for i, c in
             enumerate(["$75,000", "$95,000", "$110,000", "$130,000", "$150,000", "$175,000"])],
})

Q.append({
    "id": "Q19", "section": "E", "type": "sum_to_100", "required": True,
    "stem": "If you began prescribing this product, which of your current therapies would it most "
            "likely displace?",
    "help": "Allocate 100 points across the regimens below, reflecting where patients would come "
            "from. Total must equal 100.",
    "rows": [{"code": f"d{i+1}", "label": c} for i, c in enumerate(COMPETITORS)],
})

Q.append({
    "id": "Q19b", "section": "E", "type": "single_select", "required": True,
    "stem": "Which competitor brand is most threatened by this product's profile?",
    "options": [{"code": i + 1, "label": c} for i, c in enumerate(COMPETITORS[:3])]
              + [{"code": 9, "label": "None - it would add to the treated pool"}],
})

Q.append({
    "id": "Q19c", "section": "E", "type": "open_text", "required": False,
    "stem": "Why is that brand most threatened?",
    "multiline": True, "min_words": 3,
})

Q.append({
    "id": "Q20", "section": "E", "type": "slider", "required": True,
    "stem": "Taking everything into account, how likely are you to recommend this product to an "
            "oncology colleague once it is available?",
    "min": 0, "max": 10, "step": 1,
    "min_label": "Not at all likely", "max_label": "Extremely likely",
})

Q.append({
    "id": "Q20b", "section": "E", "type": "open_text", "required": True,
    "stem": "In two or three sentences, what is the main reason for the score you gave?",
    "multiline": True, "min_words": 5,
})

Q.append({
    "id": "Q20c", "section": "E", "type": "open_text", "required": False,
    "stem": "What single change to the product profile would most increase your score?",
    "multiline": True, "min_words": 3,
})

# ======================================================================================
# Q23 - HEAT MAP - evidence need intensity
# ======================================================================================
Q.append({
    "id": "Q23", "section": "E", "type": "heatmap", "required": True,
    "stem": "Heat map: tap each cell to show how strongly you would want more evidence "
            "there before prescribing the new therapy.",
    "help": "Each tap cycles a cell: none > some > strong > critical, then clears again.",
    "rows": [{"code": a, "label": l} for a, l in MAXDIFF_LABEL.items()],
    "cols": [
        {"code": "cte", "label": "Clinical trial evidence"},
        {"code": "rwe", "label": "Real-world evidence"},
        {"code": "acc", "label": "Cost & access data"},
    ],
    "heat_max": 3,
})

# ======================================================================================
# Q21 - NET PROMOTER - colleague recommendation
# ======================================================================================
Q.append({
    "id": "Q21", "section": "F", "type": "nps", "required": True,
    "stem": "How likely are you to recommend this new therapy to a colleague for the "
            "patient profile described in this study?",
    "help": "0 = not at all likely, 10 = extremely likely.",
    "scale": {"min": 0, "max": 10},
})

# ======================================================================================
# Q24 - EMOJI REACTION GRID - gut response
# ======================================================================================
Q.append({
    "id": "Q24", "section": "F", "type": "emoji_grid", "required": True,
    "stem": "Your gut reaction: tap the face that matches how this profile makes you "
            "feel on each dimension.",
    "rows": [
        {"code": "trust", "label": "Confidence in the evidence"},
        {"code": "innov", "label": "Sense of innovation"},
        {"code": "conven", "label": "Convenience for your practice"},
        {"code": "safety", "label": "Comfort with the safety profile"},
        {"code": "appeal", "label": "Overall appeal"},
    ],
    "scale": {"min": 1, "max": 5,
              "faces": ["😞", "😕", "😐", "🙂", "😍"],
              "face_labels": ["Very negative", "Negative", "Neutral", "Positive", "Delighted"]},
})

# ======================================================================================
# SECTION F - CLASSIFICATION
# ======================================================================================
Q.append({
    "id": "C1", "section": "F", "type": "single_select", "required": True,
    "stem": "How many years have you been in practice since completing fellowship?",
    "options": [{"code": i + 1, "label": l} for i, l in enumerate(
        ["Less than 2 years", "2-5 years", "6-10 years", "11-15 years",
         "16-20 years", "21-30 years", "More than 30 years"])],
})

Q.append({
    "id": "C2", "section": "F", "type": "single_select", "required": True,
    "stem": "How many oncologists are in your practice?",
    "options": [{"code": i + 1, "label": l} for i, l in enumerate(
        ["Just me", "2-4", "5-9", "10-19", "20-49", "50 or more"])],
})

Q.append({
    "id": "C3", "section": "F", "type": "numeric", "required": True,
    "stem": "Approximately how many patients in total are on active systemic therapy in your "
            "practice?",
    "min": 0, "max": 10000, "suffix": "patients",
})

Q.append({
    "id": "C6", "section": "F", "type": "single_select", "required": True,
    "stem": "Do you enrol patients onto clinical trials?",
    "options": [
        {"code": 1, "label": "Yes, frequently"},
        {"code": 2, "label": "Yes, occasionally"},
        {"code": 3, "label": "No, but my practice does"},
        {"code": 4, "label": "No"},
    ],
})

Q.append({
    "id": "C7", "section": "F", "type": "single_select", "required": True,
    "stem": "Would you be willing to take part in a 30-minute qualitative follow-up interview?",
    "options": [
        {"code": 1, "label": "Yes"},
        {"code": 2, "label": "No"},
    ],
})

# ======================================================================================
# HELPERS
# ======================================================================================
BY_ID = {q["id"]: q for q in Q}
TERMINATE_TEXT = ("Thank you for your time. You do not meet the screening criteria for this "
                  "study, so we will end the survey here.")


def question_ids():
    return [q["id"] for q in Q]


def sections_in_order():
    seen, out = [], []
    for s in SECTIONS:
        qs = [q["id"] for q in Q if q["section"] == s["id"]]
        if qs:
            out.append({**s, "questions": qs})
    return out
