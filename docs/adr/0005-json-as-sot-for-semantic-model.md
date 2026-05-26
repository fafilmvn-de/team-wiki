# JSON as source of truth for the semantic model

**Status:** Accepted · **Supersedes:** [ADR 0002 — XLSX as source of truth for the semantic mini-wiki](./0002-xlsx-as-sot-for-semantic-miniwiki.md).

`semantic.xlsx` is no longer the source of truth. `semantic/semantic.json`
is. The xlsx file is now a human-friendly seed / import / export artefact and a
backup snapshot — never read by `build_semantic.py` during a normal build.

This reverses the position taken in ADR 0002. ADR 0002's premise was *"there is
no JSON consumer (no admin.html editor for the semantic model)."* That premise no
longer holds: `semantic_editor.html` is exactly that editor. With a live editor
in place, the JSON-vs-XLSX argument flips — JSON is now the format the editor
PUTs back to disk, and the xlsx is a derivative.

## Considered options

- **Keep xlsx as SoT, write a new editor that imports/exports xlsx on every
  save (ADR 0002 trajectory).** Every save would round-trip through openpyxl,
  triggering opaque zip-of-XML git diffs and making concurrent edits
  unrecoverable. Also forces the editor to model the xlsx tab structure
  (multiple sheets, cell formatting) instead of working against a clean object
  graph. Rejected.
- **JSON SoT, keep xlsx as opt-in seed / import / export / backup (chosen).**
  Mirrors the existing `inventory.json` + `admin.html` pattern exactly. Git
  diffs are line-oriented. `build_semantic.py` reads JSON directly. xlsx is
  refreshed only when a user clicks **Export xlsx** in the editor (and the
  previous xlsx is snapshotted to `semantic/backup/` first).
- **JSON SoT and delete the xlsx entirely.** Rejected: SMEs who don't use the
  editor still want to receive a `.xlsx` they can scan in Excel. Keeping
  Export-xlsx preserves that affordance at zero ongoing cost.

## Consequences

- `build_semantic.py` reads `semantic/semantic.json`; the previous
  `_read_xlsx` path is retained behind `--import-xlsx` for one-shot seeding /
  migration. A new `--export-xlsx` flag writes JSON → xlsx on demand.
- `SCHEMA_VERSION` bumped 1 → 2. The new schema adds optional `from_column`
  and `to_column` to relationship rows so the editor can render Power BI–style
  column-level FK edges. The legacy `via` text remains as a human-readable
  override; if blank, it is derived from the structured fields on write.
- `serve_admin.py` extended: `semantic/semantic.json` is added to the
  writable allow-list, `PUT` on it triggers an in-process rebuild of
  `08_Semantic_Model.html`, and two new endpoints (`POST /upload-semantic`,
  `POST /export-semantic-xlsx`) wrap the xlsx ↔ json conversion.
- The backup target swaps from html to xlsx: `08_Semantic_Model.html` is fully
  regenerable from `semantic.json`, so snapshotting it adds no recoverability.
  The xlsx is the hand-curated artefact worth preserving — and it is now only
  rewritten on explicit Export, so snapshots accurately track human intent.
- ADR 0002's "single owner, no merge support" caveat is relaxed: line-oriented
  JSON diffs are mergeable in standard git tooling. Concurrent editor sessions
  still race (last writer wins, modulo the `If-Match`/ETag check), which is
  the same trade-off `admin.html` makes for `inventory.json`.
- ADR 0003 (hand-positioned domain layout) is preserved — the editor reads
  and writes the same `x/y/radius` fields on `domains[]`.
- ADR 0004 (derive curated layer from xref) is preserved — same code path runs
  off the JSON model now.
