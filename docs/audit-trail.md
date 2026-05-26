# Audit trail

Append-only log of significant changes, audits, and cross-references.
Format: `## YYYY-MM-DD — short title` · scope · reference files · findings · changes.

This file is the long-form companion to `CHANGELOG.md`. Use the changelog for
one-line release notes; use this audit trail for anything that needs more
context (decision rationale that didn't earn its own ADR, post-incident
write-ups, cross-cutting refactors, data-quality audits).

---

## 2026-05-26 — Initial public scaffold

**Scope.** Whole repository. Trigger: forking the original internal handovers
template into a clean, public-shareable scaffold (`team-wiki`).

**Findings.**

- The original template carried organisation-specific content in
  `inventory.json`, `semantic/semantic.json`, `CHANGELOG.md` and
  `docs/audit-trail.md` that does not belong in a public template.
- Only 4 of the 11 architectural decision records were already present in the
  scaffold — the other 7 lived only in the parent project.

**Changes.**

- Ported all 11 ADRs into `docs/adr/` (0001–0011). ADR 0002 is retained as
  historical context (superseded by ADR 0005). ADR 0009 splits into two
  files (`0009-solo-mode-for-domain-map.md` on the editor side and
  `0010-solo-mode-in-mini-wiki.md` on the published side); LAN-access
  passcode protection lives at `0011-passcode-gate-for-lan-access.md`.
- Added `LICENSE` (MIT), `.gitignore`, `NOTICE.md`.
- Added `PROMPT.md` — a multi-phase Claude prompt that can rebuild this
  scaffold from scratch.
- `inventory.json` and `semantic/semantic.json` retain their existing seed
  shape; adopters are expected to either replace the seed wholesale or edit
  it row-by-row via `admin.html` / `semantic_editor.html`.

**Verified.** `python scripts/rebuild_wiki.py` regenerates `index.html`
(44.4 KB, 8 buckets + 1 archive + 7 xref rows) and `inventory.xlsx` (3
sheets including `02_Manuals`). `python scripts/build_semantic.py`
regenerates `semantic/08_Semantic_Model.html` (78 KB, 0 errors / 0
warnings) from the Acme Retail Analytics seed in `semantic/semantic.json`
(4 domains, 7 tables, 33 columns, 9 relationships).

**Residual cleanup — completed 2026-05-28.** Earlier draft of this scaffold
carried incidental references to the originating environment in test
fixtures, walkthrough HTML and template stubs. All such references have
been scrubbed; the Acme Retail vocabulary (`customer_id`, `orders`,
`<your_published_catalog>.*`, etc.) is now used uniformly. The semantic
walkthrough HTML was retired in this pass as it duplicated guidance
already covered in `00_WALKTHROUGH.html`.
