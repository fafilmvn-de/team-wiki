# Campaign Sizing Spec

> Use to scope the eligible-base, control-group, and expected-VEA before kick-off.
> Mirrors the 2023 CPM sizing template (STR-2019-03) and the LEGO sizing decks (PRJ-2024-01).
> Save under `<repo>/docs/sizing/YYYY-MM-DD_<name>.md`.

## Metadata

| Field | Value |
|-------|-------|
| Campaign name |  |
| Bucket ID | CMP-YYYY-NN |
| Trigger type | Onboarding / Service-to-Sales / Claims-to-Sales / Maturity / Anniversary / Birthday / Product-launch / Family-Day / Custom |
| Owner |  |
| Sponsor |  |
| Planned launch |  |
| Tracking window | 6m / 1y / 3m / Custom |

## 1. Eligible-base definition

- Universe (catalog.table):
- Inclusion rules:
- Exclusion rules (CPM-standard listed below; tick all that apply):
  - [ ] Agent-is-PO / insured / beneficiary (relative-of-customer)
  - [ ] Blacklisted customers
  - [ ] Joint customers across Agency / Banca / DMTM
  - [ ] On-going-campaign overlap
  - [ ] Tenure / vintage rule (specify):
  - [ ] Other:

## 2. Sizing numbers

| Step | Count | Notes |
|------|-------|-------|
| Universe |  |  |
| Apply inclusions |  |  |
| Apply exclusions |  |  |
| **Eligible base** |  |  |
| High-propensity (top decile) |  |  |
| Low-propensity (control candidates) |  |  |
| Final test |  |  |
| Final control |  |  |

## 3. Control-group method (cite STR-2019-01)

- [ ] Random x% holdout from eligible base — preferred
- [ ] Annual hold-out group
- [ ] Rule-based: customers not meeting rule
- [ ] Online-acquisition (digital leads only)
- [ ] Lower-decile leads — discouraged; if used, mix in 5–10% random sample of test
- [ ] Non-contactable customers — discouraged; document why

% holdout:        Approver (Regional AA):

## 4. Targeting / channel

| Channel | Volume | Rationale |
|---------|--------|-----------|
| Agency (servicing agent) |  |  |
| Banca |  |  |
| ZNS |  |  |
| Email |  |  |
| SMS |  |  |
| Other |  |  |

## 5. Expected VEA

| Lever | Assumption | Outcome |
|-------|-----------|---------|
| Conversion rate uplift |  |  |
| Average APE |  |  |
| Persistency factor |  |  |
| NBV margin (cite BAU-2019-01) |  |  |
| **Expected VEA ($M)** |  |  |

## 6. Tracking spec

- Source for actual-sales: `<your_published_catalog>.*`
- Tracking dashboards: 
- Refresh cadence:
- Cut-off rules:

## 7. PII / compliance

- [ ] List file produced has only allowed PII fields (cite policy)
- [ ] DPO sign-off (if outside customary)
- [ ] Cross-border share?

## 8. Approvals

| Approver | Date | Notes |
|----------|------|-------|
| Sponsor |  |  |
| CMO |  |  |
| Regional AA |  |  |
| DPO (if needed) |  |  |

## 9. Sign-off & lock

- [ ] Eligible-base SQL committed to repo
- [ ] Control-group method documented
- [ ] Sizing workbook saved (xlsx)
- [ ] Cross-referenced from bucket YAML in `scan-usecases-YYYY.md`
