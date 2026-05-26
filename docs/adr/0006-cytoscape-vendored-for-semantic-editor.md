# Cytoscape.js vendored for the semantic editor

**Status:** Accepted

The semantic editor renders two graph views (Domain map + Power BI–style Table
model) with drag-to-reposition, drag-to-connect, and selection-driven
inspection. We vendor `cytoscape@3.30.4` (MIT) as a single minified file
at `assets/vendor/cytoscape.min.js` rather than loading from a CDN or pulling
it via a build step.

> The published mini-wiki (`semantic/08_Semantic_Model.html`) does **not**
> use Cytoscape — see ADR 0008. Vendoring applies only to the editor.

## Considered options

- **Hand-rolled SVG** (the `08_Semantic_Model.html` published wiki uses this).
  Sufficient for static rendering but the editor needs drag, hit-testing on
  arbitrarily-shaped nodes, pan/zoom, and live edge re-layout. Re-implementing
  these for two view modes is multi-week work and locks every future view-mode
  request behind significant graph-engine effort. Rejected for the editor.
- **CDN-loaded Cytoscape (`<script src="https://unpkg.com/...">`).** Avoids
  vendoring but breaks the editor for offline / air-gapped users — which
  includes most internal data analysts. Also breaks deterministic builds: an
  unpkg outage would silently degrade the page. Rejected.
- **Build-pipeline (npm + bundler).** Inconsistent with the rest of the repo,
  which is intentionally a no-build, "open the html and it works" Python
  stdlib server + static assets. Adding a build step adds a maintenance class
  the project does not otherwise have. Rejected.
- **Vendored single-file Cytoscape (chosen).** Loads with no network, no build
  step, no dependency manager. Version is pinned in one place
  (`assets/vendor/NOTICE.md`). Refresh procedure is documented and takes one
  `curl` invocation.

## Consequences

- The editor is fully offline-capable; the entire stack is `python serve_admin.py`
  + static files. Matches the existing `admin.html` model exactly.
- The repo carries a ~365 KB binary asset under version control. Acceptable: the
  asset changes only on a Cytoscape upgrade (rarely), and the repo already
  carries comparably-sized derived artefacts.
- Upgrades require manual action — running the documented `curl` step in
  `assets/vendor/NOTICE.md` and committing the result. This is the explicit
  trade-off: no dependency manager means no automatic upgrade path. The
  refresh procedure is short enough to do quarterly.
- Other editor pages added later can reuse the same vendored copy. We will not
  add a second graph engine; future view modes (e.g. an ER-diagram mode) should
  also be Cytoscape-based.
- We do **not** vendor Cytoscape extensions (`cytoscape-edgehandles`,
  `cytoscape-popper`, etc.). Drag-to-connect is implemented with a minimal
  shift+drag handler in `semantic_editor.js` to keep the asset count to one.
