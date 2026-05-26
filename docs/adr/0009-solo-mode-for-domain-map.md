# ADR 0009 — Solo mode for the Domain map

**Status:** Accepted · 2026-05-22
**Context window:** `handovers/`
**Related:** [ADR 0003 — Hand-positioned domain layout](./0003-hand-positioned-domain-layout.md), [ADR 0006 — Cytoscape vendored for semantic editor](./0006-cytoscape-vendored-for-semantic-editor.md)

## Context

The Semantic Editor's Domain-map view renders each domain as a hand-positioned
bubble with its tables auto-laid out as labeled "satellites" on a ring 32 px
outside the bubble. The layout was acceptable while the largest domain held
~10 tables. As of 2026-05-22 the Dashboard domain owns 29 tables (and growing);
all 29 labels collide and overlap inside a single fixed-radius ring, producing
visual noise rather than information. The same problem will hit any other
domain that crosses ~12 tables.

We considered four alternative layouts and rejected each (see *Alternatives*),
then arrived at a different framing: **at default zoom, 29 named tables is
*list* data, not *spatial* data.** Trying to make a circle do a list's job is
the root cause. The right fix is *progressive disclosure* — show density at
the macro level, give each domain its own full-canvas detail view on demand.

## Decision

The Domain-map view has two states:

1. **Overview (default)** — domains render as labeled pucks at their
   hand-positions; their tables render as tiny unlabeled dots (~6 px) on a
   tight ring around the puck. Dots reveal labels only when `cy.zoom() >= 1.5`.
   Edges drawn at this level are exclusively *inter-domain*: declared
   `domain_link` edges plus aggregated puck-to-puck rollups of FK and
   `derived_from` relationships (weight ∝ log(count)). Intra-domain edges are
   hidden.

2. **Solo** — entered by clicking a domain puck, picking a domain or table in
   the omnibox, clicking a row in the right-panel Data tab, or clicking a
   ghost puck. Effects:
     - The focused domain's satellites become labeled rings (full table FQN).
     - Every *other* domain collapses into a small "ghost puck" pinned to the
       canvas perimeter, in the direction of its un-soloed position (preserves
       the user's spatial memory). Clicking a ghost re-solos that domain.
     - Intra-domain edges and cross-domain stubs from the focused domain
       become visible; cross-domain stubs terminate at the relevant ghost.
     - A breadcrumb chip `← All domains` + a `⌬ Tidy` chip appear at the
       canvas top-left.
     - Exits: click empty canvas, press `Esc`, click the breadcrumb,
       re-click the soloed puck, or switch to Table-model view.

Satellite positions in Solo are stored per-domain in
`meta.solo_offsets` (JSON map keyed on `domain_id\u0001table_fqn`). On entry
the editor uses stored offsets when present, falling back to an evenly
distributed ring otherwise. Dragging a satellite while soloed writes back to
the map. `Tidy` recomputes positions: ring radius `r = max(110, baseR +
sqrt(count) · 26)` for ≤15 tables, spilling onto a second ring (`r + 56`) for
counts beyond that. `Tidy` writes back to `meta.solo_offsets` and marks the
document dirty so the user can `Save` or `Reload` to discard.

Solo is a transient interaction state. It is *not* persisted across reload
and lives only inside Domain-map view; switching to Table-model exits it.

## Alternatives considered

1. **Multi-ring spiral / adaptive ring radius without Solo.** Both buy 2–3×
   capacity but don't actually solve "what if Dashboard had 60 tables next
   year." Adaptive radius also makes a single domain *eat half the canvas*,
   occluding neighbours.
2. **Side-panel list of tables when a domain is focused.** Cleanest from a
   collision standpoint — admits the truth that 29 names is list data — but
   creates two surfaces (canvas + list), splits navigation, and reads less as
   a *map*. Solo achieves the same readability while keeping the user on the
   canvas, consistent with the rest of the editor's spatial model.
3. **Radial fan (90°–180° arc) per focused domain.** Visually exciting, scales
   well — but destroys the hand-positioned layout enshrined in ADR 0003,
   because satellites are reordered onto an arbitrary arc.
4. **Hover-to-reveal instead of click-to-solo.** Hover flickers on a dense
   canvas as the mouse crosses dots accidentally; reveals an ephemeral panel
   on a non-deliberate signal. Clicks are barely more effort and produce a
   stable, debuggable state.

## Consequences

**Positive**
- Default canvas legibility no longer degrades with table count per domain;
  dots scale to any N.
- Solo gives each domain a full-canvas detail view without sacrificing
  hand-positioning (ADR 0003 still holds; positions are preserved across
  state transitions).
- Omnibox + canvas + inspector list all converge on the same Solo target,
  removing dead-ends in the navigation surface.
- Cross-domain coupling is now visible *at the macro level* via aggregated
  puck-to-puck edges (previously only `domain_link` edges were drawn).

**Negative**
- A first-time viewer of the Domain map sees dots, not table names; they
  must click a domain (or hit `/` for the omnibox) to read tables. This is
  signposted by including the table count in every domain puck's label
  (e.g. `Dashboard · 29 tables`) and via the search/breadcrumb hints.
- Solo introduces a new schema field (`meta.solo_offsets`) and a per-domain
  drag-to-persist behaviour — a small extension of the editor's mental
  model. Documented inline in the JS source and in this ADR.
- Cytoscape selectors gained two new viewModes (`dot`, ghost-kind nodes)
  plus an aggregated edge kind. The style table is correspondingly longer.

## Verification

`handovers/scripts/smoke_semantic_editor.py` step 12 exercises:
- `enterSolo(id)` flips `STATE.soloDomainId`, opens the `.solo-controls` chip
  group, and renders one ghost puck for every other domain.
- The breadcrumb chip exits Solo.
- `Esc` (when no input is focused) exits Solo.
- `Tidy` moves satellite positions and persists offsets into
  `meta.solo_offsets`.
