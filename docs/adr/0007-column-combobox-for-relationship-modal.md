# Column combobox for the relationship modal

**Status:** Accepted

The "New relationship" modal in `semantic_editor.html` used to render two giant
`<select>` controls (one over all tables for **From** and again for **To**)
followed by two free-text inputs for **From column** / **To column**. As the
model grows past ~30 tables and a few hundred columns, the select dropdowns
require scrolling and the column fields offer no auto-complete — typos result
in silent dangling references that `build_semantic.py` only catches at next
build.

We replaced that with a column-first **type-ahead combobox**, one per side,
mounted in both the new-relationship modal (`openRelModal`) and the Inspector
relationship edit form (`renderRelForm`). Domain-link relationships keep the
plain `<select>` over the small `domains[]` list because the corpus is tiny.

## Considered options

- **A — Modal only, free-text columns.** Quick win: just sort the table
  `<select>` and warn on submit if the typed column isn't in `STATE.data`.
  Rejected: doesn't address the actual ergonomic complaint (find me a column
  by its name regardless of table), and editing an existing relationship in
  the Inspector still suffers the same pain.
- **B — Two coupled fields per side (Table picker, then Column picker that
  filters to that table).** Closer to the original pattern but with
  auto-complete. Rejected: users described the workflow as "I know the column
  name, I don't remember which table" — coupling forces them to remember the
  table first.
- **C — Single combobox per side, results keyed `column · table`, with
  cross-side boost when one side is filled (chosen).** Type-ahead matches
  any of column / short-name / FQN substring (token-AND, case-insensitive).
  Exact column-name matches pin to the top. Once one side is selected, the
  other side ranks matching candidates by `scoreFkLink()`: same column name >
  same type > cross-domain > shared suffix family (`*_no`, `*_id`, `*_code`,
  `*_key`, `*_num`, `*_pk`). Boost is additive and shown as badges; it
  never hides rows.

## Trade-off considered for the empty result state

When the user types `orders.created_at` and that column hasn't been declared
on the table, we considered:

- Silently auto-creating a `columns[]` row with `type='STRING'`. Rejected:
  schema would gradually drift into stubs that nobody backfills.
- Accepting free-form text and writing it through to `from_column`. Rejected:
  defeats the purpose of `semantic.json` being a validated SoT.
- **Show a "→ Add column to `<table>`" CTA (chosen).** Closes the modal,
  jumps the user to the Inspector with the column name pre-filled in the
  +Add row, and re-opens the modal with the original endpoints once the
  column lands. Two clicks instead of one, but the resulting model stays
  clean.

## Consequences

- New helpers in `assets/semantic_editor.js`:
  - `scoreFkLink(a, b)` — shared scorer used by the combobox boost and by
    `computeSuggestions()` (the Suggestions panel keeps its existing output
    but the scoring rules now live in one place).
  - `mountColumnCombobox(host, opts)` — reusable widget.
- New section in `assets/semantic_editor.css` (`.combobox`, `.cb-*`).
- `#rel-modal` panel widened to `max-width:680px` to fit the two stacked
  comboboxes comfortably.
- `STATE._pendingRelPrefill` / `STATE._pendingAddColumn` carry the
  in-progress modal values across the "add the column first" detour.
- Smoke test `scripts/smoke_semantic_editor.py` step 8 verifies the modal
  combobox: token match returns >0 rows, selecting one populates the chip,
  and the opposite side shows `cb-b-name` boost badges on same-name matches.

## Why this ADR

Hard to reverse (UX pattern shift; mutes muscle memory built on the old
selects), surprising without context (why is "column · table" the primary
result format and not the other way round?), and a real trade-off (we
explicitly rejected auto-creating columns to keep the model clean — that
decision will look harsh in isolation).
