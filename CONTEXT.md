# VN AI Wiki — Context

The single-file portable HTML wiki rendered from `inventory.json` into
`index.html`. Acts as the team's internal "Wikipedia" of projects, campaigns,
models, and procedures.

## Language

**Bucket**:
A single inventory row representing one project, campaign, model, BAU
procedure, strategy artefact, or adhoc workstream. Has a stable `bucket_id`
(e.g. `CMP-2026-07`) and a category, status, and tier.
_Avoid_: project, item, entry (when the canonical "bucket" applies).
_Distinct from_: **Manual** — manuals are a separate top-level inventory
key (`inventory.json:manuals`) with their own ID space (`MAN-…`) and
schema; they are not buckets even though both have a `status`.

**Manual**:
A reading-list entry in `inventory.json:manuals`, rendered on the public
wiki as a Manuals card (section index `09`). Has a stable `MAN-<YEAR>-<NN>`
ID, a title, a description, and either a `file` (sibling HTML or doc) or a
`url`. Carries a 2-value `status` (`Active` / `Retired`); `Retired` manuals
are filtered out of the rendered wiki (no separate Archive section — they
disappear from public view and are visible only in admin with the "show
retired" toggle on). Missing/blank `status` is treated as `Active`.
_Avoid_: bucket, document, handover (when the canonical "manual" applies).

**Status**:
For a **Bucket**: one of `Active`, `Completed`, `Superseded`, `Retired`.
Drives both rendering and which section a bucket belongs to. For a
**Manual**: one of `Active`, `Retired` only.

**Retired**:
A bucket whose work is no longer running and has no successor of the same
kind. Until 2026-05, retired buckets were filtered out of the rendered wiki;
they are now surfaced in the **Archive** section so the institutional memory
stays searchable. Distinct from **Superseded** (which has a successor and
renders in its native section, e.g. STR-2022-01 next to STR-2024-01).
_Avoid_: archived (the section is "Archive", but the status is "Retired"),
deprecated, killed, cancelled.

**Superseded**:
A bucket replaced by a newer version of the same artefact. Rendered in its
native category alongside its successor so the lineage stays visible.
_Avoid_: replaced (when "superseded" applies).

**Archive**:
The section (index `07`) that surfaces all `Retired` buckets, sub-grouped by
their original category (Projects, Campaigns, …), newest year first.
_Avoid_: "archived buckets" (use "retired buckets in the Archive section").

**Deep pack**:
The standalone mini-wiki HTML linked from a bucket's hero card via the
"Deep pack ↓" CTA. Sourced from `inventory.json:mini_wikis`.
_Avoid_: handover doc, mini-wiki (in user-facing copy).

**Sidebar peek**:
The hover-preview row in the left sidebar that shows a bucket's one-line
purpose when the user hovers its mini-status entry.

**Semantic mini-wiki**:
A standalone read-only HTML page (sibling to the Manuals, e.g.
`08_Semantic_Model.html`) that renders a clickable bubble graph of data
**domains** and their underlying **tables**, plus a column-level **data
dictionary**. Rendered from the **Semantic Editor**'s `semantic.json` source of
truth.
_Avoid_: data model, ER diagram (it is not strictly relational), schema map.

**Semantic Editor**:
The interactive authoring page `semantic_editor.html`. Lives alongside the
read-only Semantic mini-wiki (the editor authors, the mini-wiki publishes).
Backed by `semantic/semantic.json` with the same `PUT` + ETag + inline-rebuild
pattern as `admin.html` ↔ `inventory.json`. Renders two canvas modes (see
below). Replaces XLSX as the primary authoring surface — `semantic.xlsx`
demotes to a seed / import / export / backup artefact.
_Avoid_: semantic admin, model editor (use the canonical "Semantic Editor").

**semantic.json**:
The source of truth for the semantic model. Six top-level arrays mirror the
six xlsx tabs (`domains`, `tables`, `columns`, `relationships`,
`bucket_table_xref`, `meta`). Schema version 2 added optional `from_column` and
`to_column` to `relationships`. Lives at `handovers/semantic/semantic.json`;
edited live by the Semantic Editor; consumed directly by `build_semantic.py`.
_Avoid_: semantic.xlsx (it is now a backup / export artefact, not SoT — see
ADR 0005).

**Domain map view**:
The default Semantic Editor canvas mode (and the one rendered to the read-only
mini-wiki). Domain bubbles are hand-positioned (their `x`, `y`, `radius` live
on `domains[]`) and tables auto-ring around their parent domain. Edges are
domain↔domain `domain_link` relationships only.
_Avoid_: bubble view (use the canonical "Domain map view").

**Table model view**:
The Semantic Editor's second canvas mode, modelled after Power BI's "Model"
view. Each table is a draggable card showing its columns. Edges are column-level
`fk` or `derived_from` relationships. Shift-drag from one column to another to
create a new FK relationship.
_Avoid_: ER view, schema view (use the canonical "Table model view").

**Suggestion suppression**:
A user's explicit "don't suggest this FK again" choice on the Semantic Editor's
Suggestions panel. Stored as a JSON-encoded list under the `meta` row with key
`suggestion_suppressions`. The suggestion engine filters its candidates against
this list every render.
_Avoid_: rejected suggestion (in the persisted model — the user *rejects* via
the UI; the persisted record is a *suppression*).

**Domain** (semantic):
A business subject area on the semantic mini-wiki (e.g., Policy, Customer,
Agent, Coverage, Campaign). Rendered as a large bubble. Each domain groups
one or more **tables**.

**Table-bucket xref**:
The mapping (`bucket_id ↔ table_fqn ↔ access`) that links the semantic
mini-wiki to the main wiki's buckets. Lives as the `bucket_table_xref` array
in `semantic.json` (and as a sheet in `semantic.xlsx` when exported). Drives
the raw-vs-curated layer split (a table_fqn that any bucket writes is
curated; otherwise raw) and powers bidirectional navigation (table card
→ bucket chips; bucket card → "Touches domains: …").

## Relationships

- A **Bucket** has exactly one **Status**.
- A **Retired Bucket** renders inside the **Archive** section only.
- A **Superseded Bucket** renders inside its native section, never in **Archive**.
- A **Bucket** may have zero or one **Deep pack**.

## Flagged ambiguities

- "archive" was used to mean both the verb (hide / soft-delete) and the new
  section. Resolved: the **status** is "Retired"; the **section** that
  contains retired buckets is "Archive". `_to_legacy(keep_retired=True)` is
  the data-layer flag that opts in to including retired rows.
