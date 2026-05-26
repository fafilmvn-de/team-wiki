# ADR 0008 — No Cytoscape in the read-only mini-wiki

**Status:** Accepted · 2026-05-21
**Context window:** `handovers/`
**Related:** [ADR 0006 — Cytoscape vendored for semantic editor](./0006-cytoscape-vendored-for-semantic-editor.md)

## Context

`handovers/semantic/08_Semantic_Model.html` is the read-only mini-wiki — a fully
self-contained HTML file with the entire semantic model inlined as data. It is
opened directly from the file system or served over plain HTTP with no
companion daemon, and has no offline-failure surface area. The authoring
editor (`semantic_editor.html`) by contrast already vendors Cytoscape 3.30.4
(~365 KB) to render its two views (Domain map, Table model).

In 2026-05-21 we replicated the two-view UX in the mini-wiki: a view-toggle
pill, pan + wheel-zoom on the SVG canvas, and a Table-model grid of every
table-card. We had to choose how the mini-wiki's Table model would be
implemented.

## Decision

The mini-wiki does **not** import Cytoscape. Domain map stays as plain SVG
wrapped in a `<g id="viewport">` with a matrix transform; Table model is a
CSS-grid of HTML `.table-card` elements (the same markup the side panel uses)
laid out per domain, with a `transform: scale()` zoom on the inner container.

## Alternatives considered

1. **Vendor `cytoscape.min.js` and render both views with the same engine.**
   Visual parity with the editor for free; FK edges in Table model would route
   themselves. **Rejected** because it ~doubles the mini-wiki download (~365
   KB on top of the existing inlined data) for a read-only artefact whose
   selling point is "open the file, see the model" — and we'd own a parallel
   read-only path through the same engine, which is more code, not less.
2. **Embed the editor read-only via `<iframe src="../semantic_editor.html">`.**
   Defeats the purpose — the editor requires `serve_admin.py` to be running
   to save, and the mini-wiki is meant to be openable from anywhere
   (including from the Confluence-attached zip).
3. **Hand-roll an SVG Power-BI–style canvas in the mini-wiki.** Closest to the
   editor visually, but means re-implementing column-level FK routing from
   scratch; high complexity for a view that is "browse the dictionary" 95% of
   the time.

## Consequences

- ✅ Mini-wiki stays at its current size envelope.
- ✅ No second copy of the Cytoscape graph-building code to keep in sync with
  the editor.
- ❌ Table model in the mini-wiki does **not** show column-to-column FK edges
  the way the editor does — it's a card grid with the dictionary inline.
  Readers who need to see column-level FK lines go to the editor (`serve_admin.py`).
- 🔁 Reversible at moderate cost: if the column-level edges become a hard
  requirement, the path forward is to import Cytoscape into the mini-wiki
  and port the editor's `setView('table')` builder. The data shape is already
  identical (both read `semantic.json`).
