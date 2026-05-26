# Model Documentation — V2026

> Markdown-equivalent of the V2026 ML Model Document Template (`AI ML Model Document Template - ML V2026.docx` under BAU-2019-04).
> For GenAI use-cases, swap §6 for the GenAI-specific evaluation section.
> Save under `<model-repo>/docs/model-doc.md` and reference from the model bucket YAML.

## Metadata

| Field | Value |
|-------|-------|
| Model name |  |
| Bucket ID | MOD-YYYY-NN |
| Version |  |
| Author |  |
| Reviewer (Regional AA) |  |
| Sign-off date |  |
| Status | Draft / In review / Approved / Retired |
| Replaces |  |

## 1. Business problem

- Decision the model supports:
- Cost of false-positive vs false-negative:
- Stakeholders:

## 2. Target definition

- Outcome label (definition):
- Time horizon:
- Inclusion / exclusion:

## 3. Population

| Slice | Definition | Train | Validation | OOT |
|-------|-----------|-------|------------|-----|
|       |           |       |            |     |

Standard CPM exclusions:
- Agent-is-PO / insured / beneficiary
- Blacklisted customers
- On-going-campaign overlap
- Joint Agency / Banca / DMTM customers
- (Add model-specific:)

## 4. Features

- Feature store / sources:
- Number of features:
- Top features (by importance):
- Engineered features (decision logs):
- Data leakage checks performed:

## 5. Modelling

| Item | Value |
|------|-------|
| Algorithm |  |
| Hyperparameters |  |
| Train framework | DataRobot / Databricks ML / sklearn / XGBoost |
| Project / Run-ID |  |
| Deployment-ID (if any) |  |
| Reproducibility seed |  |

## 6. Performance

| Metric | Train | Validation | OOT |
|--------|-------|------------|-----|
| AUC |  |  |  |
| KS |  |  |  |
| Lift @ top-decile |  |  |  |
| Calibration |  |  |  |
| Conversion rate (top vs bottom decile) |  |  |  |

Plots / decile tables → linked workbook:

## 7. Fairness / bias check

- Slices tested (gender, age band, region, agent tier):
- Disparate-impact ratio:
- Mitigation applied:

## 8. Production deployment

- Scoring schedule (cron / Databricks workflow ID):
- Output table(s) (`<your_write_catalog>.*`):
- Downstream consumers:
- Monitoring (drift / performance):
- Re-train cadence:

## 9. VEA expectation

- Use-case mapped to: (cite STR-2026-01 use-case)
- Pilot VEA target:
- Control group method (cite BAU-2019-04):

## 10. Audit trail

| Date | Change | Author |
|------|--------|--------|
|      |        |        |

## 11. References

- Bucket YAML:
- Repo path:
- Related models:
- Regional AA approval e-mail / minutes:
