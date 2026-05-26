# Curated layer is derived from `bucket_table_xref`, not declared

**Status:** Accepted

Most data catalogs require each table to carry an explicit `layer`
(raw / silver / gold) or `is_curated` flag. We do not. Instead, raw-vs-curated
is inferred at build time from the `bucket_table_xref` array: a `table_fqn`
that appears with `access=W` for any bucket is treated as curated; everything
else is raw. The producing bucket *is* the W-row, which means table-lineage
falls out of the xref for free
(e.g. `orders (R) → PRJ-2025-01 (W) → customer_churn_score (R) → CMP-2026-01`)
without a separate lineage tab.

## Considered options

- **Explicit `layer` column on `tables[]`.** Conventional. Doubles the
  edit cost (every new curated table needs both an `xref` row and a `tables`
  row classification) and creates a consistency-bug class: `layer='raw'` rows
  that have a W-xref, or vice versa.
- **Derive from the catalog name** (`raw_catalog.*` → raw,
  `curated_catalog.*` → curated). Works the day a team adopts a clean
  two-catalog naming convention but couples the semantic wiki to that
  convention; breaks the day a team mirrors a curated table back to the
  raw catalog or stands up a third catalog.
- **Derive from xref (chosen).** Single source of truth, zero bug surface,
  automatic lineage as a bonus.

## Consequences

- Curated tables are *promoted* into the graph via the owner-opt-in `share=true`
  flag on `tables[]`. Curated tables with `share=false` exist only in the
  producing bucket's deep pack, not on the semantic map (intentional clutter
  control).
- If a curated table is consumed by another bucket but the producing bucket
  forgot to add its own W-row, the validator emits a warning: *"table_fqn X is
  read by 2 buckets but has no producer; classified as raw by default"*. The
  owner can fix it by adding the missing W-row.
- Reversing this decision means adding a `layer` field to `tables[]` and writing
  a migration that fills it from the xref state at migration time. Cost is
  moderate; the bigger cost is the bug class re-emerging.
- The `access` enum is therefore load-bearing for the rendering — it must stay
  `R`/`W`/`RW`. Adding finer access types (e.g. `APPEND_ONLY`) requires updating
  the layer-inference rule and is an ADR-level change.
