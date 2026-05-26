# AI Wiki — Blank-stage template

A self-contained, zero-dependency static-site generator for capturing a personal/team's
project / campaign / model / BAU / strategy / adhoc inventory in a single
browsable `index.html`, plus a local browser-based admin editor for the
underlying (`inventory`) JSON.

This folder is a **clean starter template**. Copy it anywhere, edit
`inventory.json` (or import from an `inventory.xlsx` via `admin.html`), rebuild, share. No external services, no database, no build pipeline — just Python's standard library and a browser.

---

## Background — why does this exist?

Enterprise tools like **Confluence**, **JIRA**, **Azure DevOps**, **SharePoint wikis**, etc. are excellent at what they were designed for: coordinating large teams, tracking epics & user stories across many squads, and enforcing governance. But for an **individual contributor** or a **small analytics team**, they tend to be:

- **Heavy and click-heavy** — too many layers of spaces / pages / permissions just to jot down "what is this project, where does the data live, who owns it".
- **Hard to navigate for newcomers** — onboarding someone usually means hours of live knowledge-transfer (KT) sessions because the information is scattered across a dozen pages, tickets, chat threads and decks.
- **Tied to a server** — you can't easily hand someone a single self-contained file they can open offline, archive, or email.
- **Opinionated about structure** — you bend your work to fit the tool, not the other way around.

This mini **Wikipedia-style** wiki was built to fill that gap. The idea is dead simple: keep one hand-editable JSON file (`inventory.json`) as the single source of truth for everything a person or pod owns — projects, campaigns, models, BAU procedures, strategy artefacts, ad-hoc deliverables, open risks, cross-references — and regenerate a single browsable `index.html` from it. Anyone joining the team can open that one file and within minutes understand:

- **What** is being worked on (and what's been retired).
- **Where** the code, data and decks live.
- **Who** owns it and **when** it was last touched.
- **Why** certain decisions were made (via the optional narrative sidecar and per-bucket mini-wiki "deep pack" pages).

The goal is to make knowledge-transfer and handovers a **5-minute read**, not a 5-day shadowing exercise — while keeping the whole thing portable, version-controllable, and free of external dependencies.

---

## What's in the box

```text
source/
├── README.md                       ← you are here
├── MAINTENANCE.md                  ← detailed edit / rebuild reference
├── CHANGELOG.md                    ← prepend a one-liner each time you rebuild
├── inventory.json                  ← THE single source of truth (edit this); now also holds the per-bucket "narratives" block
├── admin.html                      ← browser-based JSON editor (no install)
├── serve_admin.py                  ← tiny local server so admin.html can PUT to disk
├── 00_WALKTHROUGH.html             ← illustrated tour of the wiki (open this 2nd)
├── 00_PRJ-2026-01_Example.html     ← example mini-wiki ("deep pack") page
├── templates/                      ← reusable Markdown templates (post-mortem, etc.)
└── scripts/
    ├── rebuild_wiki.py             ← run this after every JSON edit
    ├── step6_build_inventory.py    ← JSON → inventory.xlsx (fail-safe)
    ├── step11_build_wiki.py        ← JSON → index.html (the wiki)
    └── uat_admin.py                ← Playwright smoke-test for admin.html
```

You do **not** need to keep all of these — minimal viable footprint is
`inventory.json` + `scripts/rebuild_wiki.py` (which calls step6 + step11) +
`admin.html` + `serve_admin.py`.

---

## Requirements

- Python **3.10+** (uses only the standard library for rebuild)
- A modern browser (Chrome / Edge / Firefox)
- Optional: `openpyxl` for the xlsx fail-safe export
  (`pip install openpyxl`)
- Optional: `playwright` for the admin UAT
  (`pip install playwright && playwright install chromium`)

No package.json, no node, no bundler.

---

## Quick start — 60 seconds

```bash
# 1) Launch the admin editor (it boots a tiny local server)
python serve_admin.py
# → opens http://localhost:8765/admin.html in your browser

# 2) Edit rows inline. Add via the + button; soft-delete by setting
#    Status = Retired (keeps row in JSON); hard-delete via the Delete
#    button (removes row permanently). Click "Save" — the server writes
#    inventory.json back to disk (and rotates inventory.json.bak).

# 3) Rebuild the wiki
python scripts/rebuild_wiki.py
# → regenerates index.html (and inventory.xlsx as a side benefit)

# 4) Open index.html in any browser. Done.
```

That's it. There is no step 5.

---

## What is `inventory.json`?

A flat, hand-editable JSON file with these top-level keys:

| Key | Type | What it holds |
|---|---|---|
| `buckets` | array | The "real work" units — Projects, Campaigns, Models, BAU procedures, Strategy artefacts. Each row has a stable `bucket_id` like `PRJ-2026-01`. |
| `adhoc` | array | One-off deliverables (decks, ad-hoc xlsx, write-ups). Each row has an `id` like `ADH-2026-001`. |
| `open_items` | array | Risks / open questions surfaced from any bucket. |
| `cross_refs` | array | "Which repo path belongs to which bucket(s)?" — purely informational. |
| `sp_overrides` | object | Per-bucket SharePoint sub-path override. Optional. |
| `mini_wikis` | object | `bucket_id` → `{file, label}`. When set, the bucket's hero card on `index.html` becomes a one-click jump to a sibling `00_*.html` deep-pack page (or any URL). |

The five **bucket categories** are: `Project`, `Campaign`, `Model`, `BAU`,
`Strategy`. They map to the ID prefixes `PRJ`, `CMP`, `MOD`, `BAU`, `STR`
respectively. Adhoc uses the prefix `ADH`.

---

## Customising for your team

1. **Replace the example records** in `inventory.json` (or just edit them via
   `admin.html`). Six buckets + two adhoc + two open items + two cross-refs
   are seeded as visual placeholders.
2. **Add mini-wikis** as you build them: drop a `00_<bucket_id>_<slug>.html`
   file next to `index.html`, then add an entry under `mini_wikis` in the
   JSON (or use the `Mini-wiki / URL` field in `admin.html`). External URLs
   also work — they open in a new tab.
3. **Rebuild** with `python scripts/rebuild_wiki.py`.
4. **Commit & share** — `index.html` is fully self-contained, so you can
   email it, drop it in SharePoint, or publish to GitHub Pages.

---

## Optional bits

- **`templates/`** — six Markdown templates (Post-mortem, Adhoc intake,
  Model documentation, Sizing spec, Campaign one-pager, Audit trail entry).
  Use them as starting points when writing project narratives.
- **`inventory.json &rarr; narratives`** — per-bucket free-text "Decisions
  baked in" and "Open questions" arrays. Rendered as a collapsible panel
  on the bucket's hero card. Edit via the 📝 Narrative button on any
  bucket row inside `admin.html`.
- **`scripts/uat_admin.py`** — 14 Playwright checks that exercise every
  admin.html interaction. Run before / after admin.html edits.
- **`MAINTENANCE.md`** — the full per-task reference (how to retire a bucket,
  how to recover from a bad save, how to add a new category, etc.).

---

## Philosophy

- **JSON is the source of truth.** Everything else regenerates.
- **Static output.** `index.html` is one self-contained file — easy to share,
  archive, version-control.
- **No magic.** Two Python scripts, no frameworks. You can read every line.
- **Local-first.** No cloud, no auth, no telemetry. Runs on a laptop with no
  network.

---

## Bootstrap from scratch with Claude AI

If you ever need to rebuild this entire scaffold from nothing (e.g. you want
to fork the *idea* into a different repo, or you lost the codebase), see
[`PROMPT.md`](./PROMPT.md). It is a multi-phase prompt designed to be pasted
into Claude (chat or any agentic CLI such as Claude Code / GitHub Copilot CLI)
that walks the AI through producing this repo's structure, scripts, admin
server, semantic editor, smoke tests and seed data — using the docs in this
repo (`CONTEXT.md`, `MAINTENANCE.md`, `docs/adr/`) as the spec.

---

## Licence

[MIT](./LICENSE). Adapt freely.
