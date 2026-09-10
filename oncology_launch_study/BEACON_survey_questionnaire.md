# PROJECT BEACON
## US Oncologist Brand Demand Study — Quantitative Survey Instrument

| | |
|---|---|
| **Study** | PROJECT BEACON — pre-launch demand assessment for a new oncology brand |
| **Geography** | United States (50 states + DC) |
| **Respondents** | n = 100 oncologists actively treating the target indication |
| **Method** | Online survey, 20 minutes estimated length of interview (LOI) |
| **Instrument** | 20 questions: 4 screeners, 15 main questions, 1 discrete choice experiment (9 choice tasks) |
| **Target indication** | Advanced/metastatic NSCLC progressing on prior IO-based therapy — *placeholder; swap in your asset's indication and the wording remains valid* |
| **Version** | 1.0 — fielding draft |

---

## 1. Research objectives

This study answers four commercial questions that a US oncology launch team must resolve before setting launch sequence, field-force size, access strategy and price:

1. **Where does the product fit?** Establish the line of therapy and patient segments oncologists would place it in, relative to the current standard of care.
2. **How much of the eligible pool converts?** Size adoption intent at 3, 6 and 12 months post-launch, and identify what must be true for intent to become script.
3. **What do oncologists trade off?** Quantify the relative importance of efficacy, tolerability, route, diagnostic turnaround, cost and payer access, and convert those trade-offs into willingness-to-pay and share-of-choice estimates.
4. **What blocks adoption?** Rank the access, evidence and operational barriers, and identify the minimum viable support package the manufacturer must fund.

## 2. Sample specification and quotas

Sampling frame: verified US medical oncologists / hematologist-oncologists confirmed via NPI registry cross-check, panel provider verification, and specialty attestation at Q1.

| Quota dimension | Requirement | n |
|---|---|---|
| **Geography** | Census-divided: Northeast / Midwest / South / West, proportional to US oncologist distribution | 22 / 21 / 36 / 21 |
| **Practice setting** | Community/private or group practice ≥ 60%; academic or NCI-designated centre ≤ 40% | ≥ 60 / ≤ 40 |
| **Patient volume** | ≥ 10 eligible patients seen per month (enforced at Q3) | 100 |
| **Payer mix exposure** | At least 30 respondents with ≥ 40% Medicare/Medicaid book | ≥ 30 |
| **Prior research** | No participation in oncology MR in the last 6 months (Q4) | 100 |

**Quality controls embedded in the instrument**

- Speeder flag: completion under 8 minutes is excluded from analysis.
- Straight-lining detection on the Q7 rating grid.
- One attention check (Q13) placed mid-instrument; failure is flagged, not auto-terminated.
- Conjoint rationality check: respondents selecting the same alternative in all 9 tasks are flagged for review (see `output/design_checks.txt`).
- Open-end verbatims under 3 words are recoded and the respondent flagged.

---

## 3. The instrument

### SECTION A — SCREENERS

---

#### Q1. Which of the following best describes your medical specialty and current practice?

*Single select. Screener.*

| Code | Response | Logic |
|---|---|---|
| 1 | Medical oncology | Continue |
| 2 | Hematology / medical oncology (combined) | Continue |
| 3 | Thoracic oncology (sub-specialised) | Continue |
| 4 | Hematology only | Continue only if Q3 ≥ 10 eligible patients; else terminate |
| 5 | Radiation oncology | **Terminate** |
| 6 | Surgical oncology | **Terminate** |
| 7 | Primary care / internal medicine | **Terminate** |
| 8 | Other (specify) | **Terminate** |

**Why we ask:** systemically treating oncologists are the prescriber of record for the target product. Radiation and surgical oncologists do not initiate systemic therapy in this setting and would contaminate the demand estimate.

---

#### Q2. In which setting do you primarily practise, and in which US state is that practice located?

*Two parts. Screener + quota allocation.*

**Q2a — Practice setting (single select)**

| Code | Response |
|---|---|
| 1 | Community/private practice — single site |
| 2 | Community/private practice — multi-site group |
| 3 | Community hospital-affiliated practice |
| 4 | Academic medical centre / university hospital |
| 5 | NCI-designated comprehensive cancer centre |
| 6 | Integrated delivery network (IDN) employed |
| 7 | VA / government / military facility |
| 8 | Other (specify) |

**Q2b — State of primary practice (single select, full 50-state + DC list)**

*Logic:* Codes 3, 4, 5, 6 roll up to "Academic/institutional"; 1, 2 roll up to "Community". Enforce the ≥ 60 / ≤ 40 community-to-academic quota. State rolls up to Census division for the geographic quota.

**Why we ask:** buy-and-bill economics, 340B eligibility, pathway governance and formulary control differ sharply between community and academic settings, so setting must be a controlled variable rather than a post-hoc cut.

---

#### Q3. Approximately how many patients with [TARGET INDICATION] do you personally initiate or manage on systemic therapy each month?

*Numeric entry, 0–500. Screener + quota.*

| Response | Logic |
|---|---|
| < 5 | **Terminate** |
| 5–9 | Soft quota — hold, release only if the target is not met by day 7 of fielding |
| 10+ | Continue |

**Q3b — Of those, roughly what share are covered by Medicare or Medicaid? (0–100%, slider)**

*Logic:* feeds the payer-mix quota (≥ 30 respondents at ≥ 40%).

**Why we ask:** volume establishes genuine decision-making exposure. Payer mix determines whether a respondent's access expectations reflect commercial or government coverage, which drives very different launch tactics.

---

#### Q4. Have you or any member of your immediate family participated in market research on oncology therapies in the past 6 months?

*Single select. Screener — industry conflict.*

| Code | Response | Logic |
|---|---|---|
| 1 | No | Continue |
| 2 | Yes, but not on oncology | Continue |
| 3 | Yes, on oncology therapies | **Terminate** |
| 4 | I work for, or am closely affiliated with, a pharmaceutical, biotech, CRO or market research company | **Terminate** |
| 5 | Prefer not to say | **Terminate** |

**Why we ask:** recent oncology research participation primes respondents to a competitor's messaging and produces artificially coherent, non-representative trade-off behaviour in the conjoint.

---

### SECTION B — CURRENT PRACTICE AND UNMET NEED

---

#### Q5. In your practice, who has the greatest influence over which systemic therapy a patient with [TARGET INDICATION] actually receives?

*Rate each on a 1–5 scale: 1 = no influence, 5 = decisive influence.*

| # | Influencer |
|---|---|
| a | You, as the treating oncologist |
| b | Other oncologists in your practice (peer consensus) |
| c | Multidisciplinary tumour board |
| d | Institutional clinical pathway / order set |
| e | Pharmacy & Therapeutics (P&T) committee |
| f | Health system formulary or value-analysis committee |
| g | Payer prior-authorisation requirements |
| h | The patient's own preference |
| i | Industry / manufacturer representative |
| j | Published guidelines (NCCN, ASCO) |

**Analysis:** sum-to-100 normalisation, then cluster respondents into *clinician-autonomous* vs *pathway-governed* segments. This segmentation is the single strongest predictor of how a launch must be sequenced, so it is measured rather than assumed from practice setting.

---

#### Q6. Thinking about the last 3 months, what approximate share of your eligible [TARGET INDICATION] patients received each of the following in this line of therapy?

*Numeric entry per row; rows must sum to 100%. Validation prompt if sum ≠ 100.*

| Regimen (populate with the actual competitive set) | % of patients |
|---|---|
| Regimen A — [competitor 1] | ___ |
| Regimen B — [competitor 2] | ___ |
| Regimen C — [competitor 3] | ___ |
| Chemotherapy doublet (platinum-based) | ___ |
| Single-agent chemotherapy / docetaxel | ___ |
| Best supportive care only | ___ |
| Clinical trial | ___ |
| Other (specify) | ___ |

**Analysis:** weighted mean share-of-treatment by segment gives the *actual* baseline the new brand must displace. Stated intent without this baseline systematically overstates launch uptake, because respondents anchor to an idealised rather than a real prescribing pattern.

---

#### Q7. When choosing among available options for these patients, how important is each of the following to you personally?

*Rate each 1–7: 1 = not at all important, 7 = critically important.*

| # | Factor |
|---|---|
| a | Overall survival benefit demonstrated in the pivotal trial |
| b | Progression-free survival / durability of response |
| c | Objective response rate |
| d | Rate of Grade 3+ treatment-related adverse events |
| e | Presence of specific, manageable toxicities (e.g. ILD, neuropathy, colitis) |
| f | Route and frequency of administration |
| g | Speed and accessibility of the required companion diagnostic |
| h | Quality-of-life and patient-reported outcome data |
| i | Strength of the subgroup data relevant to my patients |
| j | Real-world evidence available post-approval |
| k | Net cost to the practice under buy-and-bill |
| l | Likelihood of payer coverage without prior authorisation |
| m | Availability of patient support and reimbursement assistance |
| n | Familiarity of the mechanism with my practice |

**Quality control:** straight-line detection — identical responses across all 14 rows flags the respondent.

**Analysis:** this is the *stated* importance ranking. It is deliberately collected alongside the conjoint, which measures *revealed* importance under trade-off. The gap between the two is itself a finding: attributes that rank high when rated in isolation but carry little weight in the choice tasks are attributes oncologists will not actually pay for.

---

#### Q8. How well do currently available therapies meet the needs of each of the following patient groups?

*Rate each 1–5: 1 = very poorly met, 5 = very well met.*

| # | Patient group |
|---|---|
| a | Patients with good performance status (ECOG 0–1) progressing rapidly |
| b | Patients with ECOG 2 or borderline performance status |
| c | Patients with CNS / brain metastases |
| d | Patients with a targetable driver mutation after TKI failure |
| e | Patients with high comorbidity burden or organ dysfunction |
| f | Patients for whom no biomarker is identified |
| g | Elderly patients (≥ 75 years) |

**Q8b — For the group you rated lowest, in 1–2 sentences, what is missing?** *Open end.*

**Analysis:** the lowest-rated cells define the priority launch segment. This is where a new brand can establish a foothold before competing head-to-head for the broad population, and it is the input that shapes the initial targeting strategy.

---

#### Q9. In patients you are considering for biomarker-directed therapy, which best describes your current testing workflow?

*Single select, then follow-up.*

| Code | Response |
|---|---|
| 1 | Broad NGS panel sent on all eligible patients; results typically back within 3–5 business days |
| 2 | Broad NGS panel sent on all eligible patients; results typically back in 7–14 business days |
| 3 | Targeted single-gene or small-panel testing only |
| 4 | Testing depends on the payer or the specific product's CDx |
| 5 | Testing is ordered but treatment often starts before results return |
| 6 | We rarely test in this line |
| 7 | Other (specify) |

**Q9b — If a therapy required a companion diagnostic with a 10-business-day turnaround, how would that affect your use of it?** *Single select: would not affect / would delay but not prevent / would limit to a subset of patients / would prevent me from using it.*

**Why we ask:** the conjoint varies diagnostic turnaround as an attribute. This question establishes whether that attribute reflects a real operational constraint in the respondent's own workflow, which is what makes the conjoint estimate credible rather than hypothetical.

---

### SECTION C — CONCEPT AND DEMAND

*The following questions are asked after exposure to the target product profile. Present a blinded TPP card — mechanism, pivotal trial design, headline efficacy, safety summary, administration, and CDx requirement — with no brand name and no sponsor identification. Hold the card on screen; allow it to be re-opened throughout Sections C and D.*

---

#### Q10. Having reviewed the product profile, please indicate your agreement with each statement.

*Rate each 1–7: 1 = strongly disagree, 7 = strongly agree.*

| # | Statement |
|---|---|
| a | I understand clearly how this product works |
| b | The efficacy results reported are believable given the mechanism |
| c | The safety profile is acceptable for the severity of this disease |
| d | The pivotal trial population resembles the patients I actually treat |
| e | This product would fill a gap that currently exists in my practice |
| f | I would feel confident explaining the benefit-risk profile to a patient |

**Analysis:** (a) and (b) are the comprehension and believability gates. If believability scores low, the concept itself must be repositioned before launch messaging is built — no amount of field force fixes a profile oncologists do not credit. Statements (d) and (e) separate "interesting science" from "relevant to my book," which is the distinction that predicts actual uptake.

---

#### Q11. Compared with the current standard of care in this setting, how would you rate this product on each dimension?

*Semantic differential, 1–7 per row.*

| Dimension | 1 | 7 |
|---|---|---|
| Efficacy | Much worse | Much better |
| Speed of onset | Much slower | Much faster |
| Durability of benefit | Much shorter | Much longer |
| Tolerability | Much worse | Much better |
| Convenience for the patient | Much worse | Much better |
| Operational burden on my practice | Much higher | Much lower |
| Overall clinical value | Much lower | Much higher |

**Analysis:** the "operational burden" row is the sleeper variable in oncology launches. It is rarely measured and routinely predicts community adoption better than efficacy does, because community practices are capacity-constrained in ways academic centres are not.

---

#### Q12. If this product launched today and were available on formulary, what is the likelihood you would prescribe it?

*Single select, then quantification.*

| Code | Response |
|---|---|
| 5 | I would definitely prescribe it |
| 4 | I would probably prescribe it |
| 3 | I am not sure |
| 2 | I would probably not prescribe it |
| 1 | I would definitely not prescribe it |

**Q12b — Thinking about your eligible patients over the next 12 months, what percentage would you expect to receive this product?** *Numeric 0–100%.*

**Q12c — How long after launch would it take you to prescribe it for the first time?** *Single select: within 1 month / 1–3 months / 3–6 months / 6–12 months / more than 12 months / never.*

**Analysis:** top-2-box on Q12 is the headline intent metric. Q12b is the volume-forecast input and must be collected as a percentage rather than a category, because categories cluster at the anchors and flatten the forecast. Q12c sizes the ramp and sets the field-force coverage cadence.

---

#### Q13. Attention check — to confirm you are still with us, please select "Somewhat likely" for this question.

| Code | Response |
|---|---|
| 1 | Very likely |
| 2 | Somewhat likely |
| 3 | Neither likely nor unlikely |
| 4 | Somewhat unlikely |
| 5 | Very unlikely |

*Flag only; do not terminate. Failure is a data-quality covariate in the analysis.*

---

#### Q14. In which line of therapy or clinical setting would you most likely position this product first?

*Single select, then rank.*

| Code | Response |
|---|---|
| 1 | First line, all-comers |
| 2 | First line, biomarker-selected only |
| 3 | Second line, post-progression on prior therapy |
| 4 | Second line, biomarker-selected only |
| 5 | Third line or later |
| 6 | Maintenance / continuation setting |
| 7 | Only in patients who have exhausted other options |

**Q14b — Rank the three patient types you would treat first** *(drag-rank from the Q8 patient list).*

**Analysis:** positioning answers the sequencing question. A product positioned second-line by 60% of respondents requires a different launch architecture — access-led, payer-first — than one positioned first-line, where guideline inclusion and trial readout dominate.

---

#### Q15. What would have to be true for you to prescribe this product to a majority of your eligible patients?

*Select up to 3, then rank your top choice.*

| Code | Requirement |
|---|---|
| 1 | Demonstrated overall survival benefit, not just PFS |
| 2 | Head-to-head data versus [current standard of care] |
| 3 | Real-world evidence in patients like mine |
| 4 | Inclusion in NCCN guidelines |
| 5 | A lower rate of Grade 3+ adverse events |
| 6 | A more convenient route or dosing schedule |
| 7 | Faster companion diagnostic turnaround |
| 8 | Broad formulary coverage without prior authorisation |
| 9 | A lower net acquisition cost |
| 10 | Strong patient support and reimbursement assistance |
| 11 | Familiarity built through peer experience and publications |
| 12 | Nothing further — I would prescribe it as described |
| 13 | Other (specify) |

**Analysis:** this is the launch-readiness gap list. Rank-weighted scores define the minimum viable evidence and support package, and directly inform medical affairs planning, HEOR dossier priorities and the reimbursement-support budget.

---

### SECTION D — DISCRETE CHOICE EXPERIMENT (CONJOINT)

---

#### Q16. Choice tasks

**Introduction shown to respondent:**

> The next set of questions asks you to make treatment choices, as you would in clinic. In each question you will see three treatment options for the same patient, each described by the same seven characteristics, plus the option to continue with current standard of care.
>
> There are no right or wrong answers. Please choose the option you would actually prescribe, taking all seven characteristics into account at once. If none of the three is preferable to what you would do today, choose to continue with current standard of care.
>
> Assume all three options are otherwise clinically appropriate for this patient.

**Patient vignette held constant across all tasks:**

> A 64-year-old with [TARGET INDICATION], ECOG 1, who has progressed on prior IO-based therapy. No CNS metastases. Adequate organ function. Commercial insurance.

**The seven attributes and their levels**

| Attribute | Level 1 (reference) | Level 2 | Level 3 |
|---|---|---|---|
| Median overall survival vs SoC | No proven OS benefit (PFS-only endpoint) | +3 months median OS | +6 months median OS |
| 12-month progression-free survival | 25% | 35% | 45% |
| Grade 3+ treatment-related AE rate | 15% | 30% | 45% |
| Administration | IV infusion every 3 weeks (~30–60 min, infusion centre) | Subcutaneous injection every 4 weeks (~5 min) | Oral, once daily (home) |
| Companion diagnostic | CDx required; result in 3 business days | CDx required; result in 10 business days | No CDx required |
| Net cost of a 12-month course | $75,000 | $110,000 | $150,000 |
| Payer access at month 1 | Formulary-listed, no prior auth (~80% of lives) | Covered with prior auth (~60% of lives) | Limited coverage / step-through (~30% of lives) |

**Task format:** 9 choice tasks, 3 treatment alternatives plus a fixed opt-out ("continue current standard of care"), presented one per screen. Task order and alternative position are randomised per respondent to remove order and position bias.

**Example — Task 1 as designed** *(full 9-task design in `output/dce_design_wide.csv`)*

| Attribute | Treatment A | Treatment B | Treatment C |
|---|---|---|---|
| Median OS vs SoC | +6 months | No proven OS benefit | +3 months |
| 12-month PFS | 45% | 25% | 35% |
| Grade 3+ AE rate | 30% | 15% | 15% |
| Administration | Subcutaneous q4w | IV infusion q3w | Oral, once daily |
| Companion diagnostic | CDx, 3 business days | CDx, 3 business days | CDx, 10 business days |
| Net 12-month cost | $75,000 | $75,000 | $110,000 |
| Payer access | Limited coverage | Formulary, no PA | Limited coverage |
| | **○ Choose A** | **○ Choose B** | **○ Choose C** |
| | **○ Continue current standard of care** | | |

**Design quality** *(verified in `output/design_checks.txt`)*

| Check | Result |
|---|---|
| Profile pool | Orthogonal main-effects plan, 3^(7-4), 27 profiles; each level of each attribute appears exactly 9 times |
| Cross-attribute correlation | max abs r = 0.0000 — attributes are orthogonal, so each utility is estimated independently |
| Dominant alternatives | 0 — no option is better on every ordered attribute, so every task forces a genuine trade-off |
| D-efficiency | 99.2% of the unconstrained D-optimal benchmark for these profiles |
| Choice observations | 900 (100 respondents × 9 tasks) supporting 15 utility parameters |

**Analysis plan:** conditional logit, then mixed (random-parameter) logit with respondent-level heterogeneity; relative attribute importance from utility ranges; willingness-to-pay from cost-attribute ratios; latent class segmentation to identify trade-off archetypes; market simulation across price and access scenarios using the opt-out constant as the status-quo anchor.

**Design validation:** the design was tested by simulating 100 respondents' choices under known utilities and refitting the model. The recovered coefficients correlated 0.987 with the true values, with standard errors of 0.12–0.20 — small enough to resolve the differences between adjacent levels. That test confirms the design is analysable at n=100; it is not a market result, since no oncologists were surveyed.

---

### SECTION E — ACCESS, PRICE AND COMPETITION

---

#### Q17. If this product launched as described, how likely is it that you would encounter each of the following access barriers?

*Rate each 1–5: 1 = very unlikely, 5 = almost certain.*

| # | Barrier |
|---|---|
| a | Prior authorisation required by commercial payers |
| b | Step therapy / fail-first requirements |
| c | Delayed or denied coverage under Medicare Part B |
| d | Buy-and-bill margin insufficient to justify stocking the product |
| e | White-bagging or site-of-care restrictions imposed by the payer |
| f | Companion diagnostic not covered, creating a separate hurdle |
| g | Patient out-of-pocket exposure deterring initiation |
| h | Practice cannot get the product through its primary distributor |

**Q17b — Which single barrier would most delay your ability to prescribe it?** *Single select from a–h.*

**Analysis:** barrier (d) is specific to buy-and-bill oncology and is routinely underestimated in pre-launch research because it is an operational rather than a clinical objection. It is included deliberately: community practices will not stock a product they cannot get paid for, regardless of clinical merit.

---

#### Q18. Price acceptability.

**Q18a — At what net cost for a 12-month course would this product represent good value for the benefit it delivers?** *Numeric, $ per year.*

**Q18b — Above what annual cost would you begin to actively steer eligible patients toward alternatives?** *Numeric, $ per year.*

**Q18c — Rate the acceptability of each price point given the profile you have seen.** *Single select per row: acceptable without reservation / acceptable but I would seek alternatives first / unacceptably high.*

| Annual net cost |
|---|
| $75,000 |
| $95,000 |
| $110,000 |
| $130,000 |
| $150,000 |
| $175,000 |

**Analysis:** Q18a and Q18b give the stated willingness-to-pay corridor; the conjoint cost attribute gives the *revealed* price sensitivity under trade-off. Where the two diverge, trust the conjoint for forecasting and use the stated corridor for messaging thresholds. Q18c produces the acceptability curve for the pricing and market-access teams.

---

#### Q19. If you began prescribing this product, which of your current therapies would it most likely displace?

*Allocate 100 points across the regimens listed in Q6, reflecting where patients would come from.*

**Q19b — Which competitor brand is most threatened by this product's profile, and why?** *Single select from the Q6 list + open end.*

**Analysis:** displacement mapping shows whether the product grows the treated pool or cannibalises existing share — a distinction that changes the commercial forecast and the competitive response you should plan for.

---

#### Q20. Taking everything into account, how likely are you to recommend this product to an oncology colleague once it is available?

*0–10 scale: 0 = not at all likely, 10 = extremely likely.*

**Q20b — In 2–3 sentences, what is the main reason for the score you gave?** *Open end.*

**Q20c — What single change to the product profile would most increase your score?** *Open end.*

**Analysis:** net promoter score among prescribers is the leading indicator of peer-driven diffusion, which is the dominant adoption mechanism in community oncology. The verbatims are the raw material for message testing in the next wave and are worth more here than the score itself.

---

### SECTION F — CLASSIFICATION *(not counted toward the 20 questions)*

| # | Item |
|---|---|
| C1 | Years in practice since completing fellowship |
| C2 | Number of oncologists in your practice |
| C3 | Approximate total patients on active systemic therapy in your practice |
| C4 | NPI number (verification only; not analysed, not reported) |
| C5 | Primary tumour types treated (multi-select) |
| C6 | Clinical trial participation — do you enrol patients onto trials? |
| C7 | Consent to a 30-minute qualitative follow-up interview |

---

## 4. Analysis and reporting plan

| Analysis | Method | Output |
|---|---|---|
| Demand sizing | Top-2-box intent (Q12) × share of eligible patients (Q12b), weighted to quota | Uptake forecast at 3 / 6 / 12 months |
| Preference structure | Conditional and mixed logit on the 900 choice observations | Utility coefficients, relative attribute importance |
| Trade-off quantification | Willingness-to-pay from the cost attribute | $ value of each clinical improvement |
| Segmentation | Latent class on choice data, cross-validated against Q5 and Q2a | Trade-off archetypes with segment sizes |
| Share simulation | Market simulator using the opt-out constant as the status-quo anchor | Share of choice under price and access scenarios |
| Barrier prioritisation | Rank-weighted scores on Q15 and Q17 | Minimum viable launch-support package |
| Stated vs revealed gap | Correlation of Q7 importance with conjoint importance | Attributes oncologists claim to value but will not trade for |

All conjoint outputs are reported with 95% confidence intervals. Segment cuts below n = 30 are reported directionally only and labelled as such.

## 5. Fielding notes

- **Programming:** load `output/dce_design_wide.csv` for the 9 tasks and `output/respondent_task_map.csv` for per-respondent task order and alternative position. Do not re-randomise in the survey platform — the randomisation is already assigned and must stay consistent with the design checks.
- **TPP card:** must be reviewed and approved by medical affairs and legal before fielding. No brand name, no sponsor identification, no promotional claims.
- **Incentive:** honorarium appropriate to specialty and time, disclosed up front, consistent with fair-market-value guidance.
- **LOI:** 20 minutes estimated, of which the conjoint accounts for roughly 7. Pilot with 5 oncologists before full release and re-check the conjoint section time.

---

*Prepared as a fielding draft. Placeholder fields marked with square brackets must be completed with the client's asset-specific information before the instrument is programmed.*
