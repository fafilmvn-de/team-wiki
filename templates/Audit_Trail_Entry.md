# Audit-Trail Entry

> Append (newest-first) to `docs/audit-trail.md` (root) for any significant change.
> Per the workspace rules: every audit/cross-reference action must record date, scope, reference files, findings, changes.

```yaml
- date: YYYY-MM-DD
  author: <name>
  scope: >
    <one-sentence description of what was changed / audited>
  reference_files:
    - <relative path 1>
    - <relative path 2>
  findings: >
    <key observations or root cause>
  changes:
    - <file 1>: <what changed>
    - <file 2>: <what changed>
  cross_refs:
    - bucket_id: <PRJ/CMP/BAU/MOD/STR/ADH-YYYY-NN>
    - docs_index_section: <section name in docs/INDEX.md>
  closure_note: >
    <if closing a P0/P1 open item from 07_Open_Items_and_Risks>
```

## Example entry

```yaml
- date: 2026-05-06
  author: VN AI / Analytics Team
  scope: >
    Built consolidated KT pack covering May-2024 → May-2026: 5 scan plans, 41 YAML
    extraction blocks, consolidated adhoc log (60 rows), master plan, 11-sheet
    inventory workbook, 7 Word manuals, 6 templates.
  reference_files:
    - handovers/plans/00_master_handover_plan.md
    - handovers/plans/scan-usecases-2024.md
    - handovers/plans/scan-usecases-2025.md
    - handovers/plans/scan-usecases-2026.md
    - handovers/plans/scan-cpm-2019-audit.md
    - handovers/plans/scan-strategies.md
    - handovers/plans/04_adhoc_log.md
    - handovers/handover_inventory.xlsx
    - handovers/docs/01_Onboarding_Guide.docx
    - handovers/docs/07_Open_Items_and_Risks.docx
  findings: >
    No content discontinuity vs Mar-2024 inherited deck; 2025 actual VEA $8.0M /
    99% of plan; 13 open items triaged (4 P0 / 5 P1 / 4 P2).
  changes:
    - handovers/: new directory tree (plans/, _extracts/, scripts/, docs/, templates/)
    - root: README cross-link to `handovers/` (Step 9)
  cross_refs:
    - bucket_id: STR-2024-01 (Mar-2024 seed deck folded into 2024 strategy — superseded by this pack)
    - docs_index_section: <add>
  closure_note: >
    Hand-over pack ready for incoming AA Lead. P0 open items remain open until
    DRI sign-off in first 30 days.
```

## Style rules

- **Newest entries first**.
- **Every change** that touches a `docs/` file or a model artefact should generate an entry.
- **Deletes** must record the file path + reason + replacement (if any).
- **YAML stays valid** — keep keys consistent (`date / author / scope / reference_files / findings / changes / cross_refs / closure_note`).
- **Optional fields** (`cross_refs`, `closure_note`) — omit rather than leave empty.
