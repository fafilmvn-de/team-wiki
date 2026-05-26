# XLSX as source of truth for the semantic mini-wiki

**Status:** Superseded by [ADR 0005 — JSON as source of truth for the semantic model](./0005-json-as-sot-for-semantic-model.md).

> Retained for historical context. Read ADR 0005 for the current decision.

The main wiki follows a strict "JSON is source of truth, everything else regenerates"
rule because `admin.html` PUTs structured JSON back to disk — the JSON SoT exists
to serve that editor loop. The semantic mini-wiki had no equivalent editor: it was
a one-author/one-team artefact, heavily tabular (domain × table × column × xref),
and the realistic authoring workflow was Excel paste-from-upstream-dictionaries
rather than form-driven entry. We therefore made `semantic/semantic.xlsx`
the source of truth for this page only, and `scripts/build_semantic.py` emitted
`semantic/08_Semantic_Model.html` directly from it. No JSON intermediate, no
admin.html integration.

This decision was reversed by ADR 0005 once `semantic_editor.html` introduced
a JSON-backed editor — the premise "there is no JSON consumer" no longer held.

## Considered options at the time

- **Hybrid (XLSX authoring → JSON runtime, JSON re-emitted on build).** Honours the
  repo-wide JSON-SoT principle but duplicates the data on disk and makes git
  reviewers verify two files agree. Rejected: ceremony with no offsetting benefit
  since there is no JSON consumer (no admin.html editor for the semantic model).
- **JSON SoT with admin.html-style editor.** Would have required either bolting
  semantic editing into the existing `admin.html` (cross-concern bloat) or
  building a second editor. Rejected at the time: data dictionaries are inherently
  spreadsheet-shaped; Excel is already the universal editor SMEs know.
- **XLSX SoT (chosen at the time).** Simplest path: Excel in, HTML out. Matched
  how the Manuals (`01_Onboarding_Guide.html` … `07_Open_Items_and_Risks.html`)
  are authored as standalone artefacts outside the JSON pipeline.

## Consequences (at the time it was active)

- One documented exception to "JSON is SoT".
- Git diffs of `semantic.xlsx` opaque (zip of XML). Mitigation: the build
  emitted a stable, line-oriented `08_Semantic_Model.html`; reviewers diffed the HTML.
- Merge conflicts in `semantic.xlsx` unrecoverable. Mitigation: single
  owner per repo (forking was the cross-team variation mechanism).
- `openpyxl` became a hard dependency for `build_semantic.py`.

See ADR 0005 for why this was reversed.
