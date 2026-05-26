# Surface Retired buckets in a dedicated Archive section

**Status:** Accepted

The wiki builder used to filter out every bucket whose status started with
`Retired` (in `scripts/step11_build_wiki.py:_to_legacy`), so retired work was
completely invisible in `index.html`. We reverted that decision: retired
buckets now render in a new "Archive" section (index `07`) and a matching
muted sidebar entry, sub-grouped by their original category and ordered
newest-year-first. The justification is that the wiki's job is institutional
memory — a new joiner who's never heard of last year's flagship project
should still be able to search, find, and read about it, exactly like
Wikipedia preserves articles for historical topics. Hiding them re-creates
the very tribal-knowledge problem the wiki was built to solve.

## Considered options

- **Keep filtering retired buckets out** — clean, but defeats the wiki's
  purpose; relies on tribal knowledge to discover that retired work even
  existed.
- **Render retired buckets inline in their native section** — would mix live
  P0 work next to dead campaigns in the same grid and visually compete for
  attention; rejected.
- **Hide behind a "Show archive" toggle** — re-creates the discoverability
  problem (new users won't know to flip the switch). Rejected.

## Consequences

- `index.html` grows by the size of the retired-bucket cards.
- Global search now returns retired buckets by default — intentional. A new
  `Retired` status filter chip exists to isolate them when desired.
- The `Repo ↔ bucket map` (xref) section now includes archive buckets so the
  cross-reference stays a complete inventory.
- Section indices after Adhoc shifted by one: xref `07 → 08`, manuals `08 → 09`,
  etc. Any deep link of the form `#crossrefs` / `#manuals` still works because
  anchors are name-based, not numeric.
- Retired cards drop the tier tag and always render in `outlined` variant
  (never `accent`), so they never compete visually with live P0 work.

## Update — Archive rendered as tables, not cards

Same architectural decision (surface retired buckets in a dedicated Archive
section); we only changed the *shape* used inside the section. The card-grid
form was hard to scan: a dozen retired items occupied ~3 viewport-heights with
mostly whitespace, and the section's job is reference lookup, not visual
priority scanning. We replaced the cards with collapsible category tables
that reuse the existing `.yr-block` + `.tab` idiom from `render_xref` /
`render_adhoc_table`, so the wiki now has exactly two visual languages:

- **Card grid** → "what's live, what needs attention" (sections 01–06)
- **Collapsible tables** → "look something up by exact identity" (Archive, xref, Adhoc, Open items)

Columns: ID · Year · Name · Purpose · Links. All category blocks collapsed
by default. Each `<tr id="b-{bid}">` preserves the deep-link anchor so the
sidebar peek still scrolls to the correct row.
