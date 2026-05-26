# Hand-positioned domain layout, auto-arranged satellite tables

**Status:** Accepted

Most semantic-graph tools default to a force-directed layout (d3-force, cytoscape).
We deliberately chose a hybrid: the ~6–12 domain bubbles are hand-positioned on a
0–100 percent canvas via `x, y` fields on `domains[]` in `semantic.json`,
and the satellite table bubbles are auto-arranged in a ring around their parent
domain at render time (deterministic `cos/sin` placement, no physics). This
preserves the wiki's zero-dependency / single-file / offline-portable
property in the published mini-wiki (no vendored JS layout library on the public page)
and matches the curated 2D-canvas visual the reference design called for, not a
randomly-laid-out node soup.

## Considered options

- **Static SVG, hand-positioned everything** — every table coordinate also lives
  in the model. Maximum control, minimum scalability (placing 50+ tables by hand
  is hostile to editors).
- **Force-directed via vendored d3-force / cytoscape.js** — auto-layout for any
  size, but layout shifts between loads, ~50–200 KB of inlined JS breaks the
  zero-dep promise for the public mini-wiki, and the result rarely matches the
  curated visual the team wants.
- **Hybrid (chosen)** — curated top tier, computed second tier. Top tier is
  stable, git-diffable, and matches the reference image. Second tier requires
  only `cos/sin` math at render time.

## Consequences

- The `domains[]` array has required `x`, `y` fields (0–100). Adding a domain is a
  ~10-second placement decision, not a UX hazard.
- The `tables[]` array has no positional fields. Tables are arranged in a ring at
  render time, ordered alphabetically by `short_name` within their parent. If a
  domain ends up with > ~16 tables the ring gets crowded — escape hatch is to
  split the domain or accept a second concentric ring (see ADR 0009 / 0010 on
  Solo mode for how dense domains are handled in the editor + mini-wiki).
- Cross-domain `relationships` edges are drawn as straight lines between bubble
  centres. With > ~6 domains this can produce visible edge-crossings; future
  enhancement is a one-off d3-force overlay just for the edge-routing, leaving
  node positions fixed.
- Reversing this decision later means a schema migration: `x`/`y` become dead
  fields (or get repurposed as seed positions for a force layout).
