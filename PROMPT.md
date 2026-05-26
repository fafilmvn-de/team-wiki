# PROMPT.md — Bootstrap the wiki from scratch with Claude

> **Status:** Canonical. This file is the bootstrap contract for the `team-wiki`
> template repository. If the codebase is ever lost or you want to re-create the
> entire scaffold in a new environment, hand this file (plus the rest of the
> repo's `*.md` docs) to Claude and follow the phased build below.

---

## 0. What this file is

This is a **multi-phase prompt for Claude AI** that produces the same artefact
shape as the rest of this repository: a self-contained, zero-dependency static
wiki + a browser-based admin editor + a semantic-model editor with two canvas
modes + smoke tests + ADRs. The output is **functionally equivalent**, not
byte-identical — Claude is rebuilding the engine from a spec, not transcribing
source code.

**Architecture decision.** This prompt is deliberately thin. The *real spec* is
the other Markdown files in this repository:

| Doc | Role | Read it for |
|---|---|---|
| `README.md` | Audience-facing intro + quickstart | Why this exists, the high-level UX promise |
| `CONTEXT.md` | Glossary | The vocabulary the codebase commits to (Bucket, Manual, Status, Deep pack, …) |
| `MAINTENANCE.md` | Operations | Day-to-day editor workflow, recovery procedures |
| `docs/adr/0001`–`0011-*.md` | Decision records | The *why* behind every non-obvious design choice |

Treating the existing docs as the spec means PROMPT.md never drifts away from
them — if any doc is updated, the bootstrap stays correct automatically. Do
not duplicate the spec here.

---

## 1. How to run this prompt

Pick whichever fits your environment:

### a) Agentic CLI (Claude Code, GitHub Copilot CLI, Cursor, …)

Hand Claude this file plus the rest of the repository's docs and instruct it
to "execute PROMPT.md end-to-end". Claude will read each phase, generate the
files into the working directory, and run the acceptance smoke at the end of
each phase. Smokes that fail block the next phase.

### b) Plain Claude.ai chat (no tools)

Paste the whole of PROMPT.md plus the spec docs into one conversation. For
each phase, ask Claude to emit the files in code blocks; copy each into the
right path yourself; run the phase's acceptance command locally; report the
result back into the chat before moving to the next phase.

### c) Mixed (manual orchestration)

Run any phase by itself by quoting just that phase's section to Claude. This
is useful for repairing one stage (e.g. you want the semantic editor
rebuilt but the rest of the repo is fine).

---

## 2. Prerequisites

- Python **3.10+** (the rebuild relies only on the standard library)
- A modern browser
- Optional: `pip install openpyxl` for `inventory.xlsx` round-trip and the
  semantic editor's xlsx Import/Export endpoints
- Optional: `pip install playwright && playwright install chromium` for the
  admin UAT
- `curl` + `sha256sum` (or PowerShell `Get-FileHash`) for fetching the
  vendored Cytoscape library in Phase 4

No node, no bundler, no package.json.

---

## 3. The five phases

Each phase has a fixed shape:

- **Goal** — one sentence
- **Spec inputs** — which existing docs Claude must read first
- **Files to produce** — exact paths + one-liner of what each does
- **Build command** — what the human (or Claude in agentic mode) runs
- **Acceptance smoke** — how to know the phase succeeded

> **Sentinel rule.** When regenerating files in a partially-built repo
> (re-running a phase), Claude must preserve any hand-edits outside the
> regions it owns. Where ambiguity exists, prefer leaving existing content
> intact and emitting a comment marker; never blindly overwrite.

---

### Phase 1 — Scaffold and seed data

**Goal.** Lay down the directory tree, hand-authored markdown, ADRs,
template skeletons, and the seed `inventory.json` + `semantic.json` so a
fresh `git clone` already has a *demoable* wiki before any code runs.

**Spec inputs.** `README.md`, `CONTEXT.md`, `MAINTENANCE.md`, every file under
`docs/adr/`.

**Files to produce.**

```
LICENSE                                       MIT, copyright (c) 2026 John Nguyen
.gitignore                                    Python + editor + .passcode + .session + *.bak + semantic/backup/
NOTICE.md                                     Third-party (Cytoscape)
README.md                                     Audience-facing intro (already in spec inputs — verbatim if porting)
CONTEXT.md                                    Glossary (already in spec inputs — verbatim if porting)
MAINTENANCE.md                                Ops manual (already in spec inputs — verbatim if porting)
CHANGELOG.md                                  Seed entry only
PROMPT.md                                     This file
docs/adr/0001…0011-*.md                       The 11 ADRs (verbatim from spec inputs)
docs/audit-trail.md                           Seed entry only
templates/Post_Mortem.md                      Markdown templates — see "Templates" below
templates/Adhoc_Request_Intake.md
templates/Model_Documentation.md
templates/Sizing_Spec.md
templates/Campaign_Status_OnePager.md
templates/Audit_Trail_Entry.md
inventory.json                                Acme Retail seed — see §3.1
semantic/semantic.json                        Acme Retail semantic seed — see §3.2
```

**Acme Retail seed shape (§3.1, §3.2).**

- `inventory.json` has **at least one bucket of every status** so every render
  branch exercises:
  - 1 Active P0 Project (with a `mini_wikis` entry + narratives)
  - 1 Active P1 Campaign
  - 1 Active P0 Model
  - 1 Active P0 BAU
  - 1 Active P0 Strategy
  - 1 Adhoc folder
  - 1 Superseded Strategy (lineage points at the Active one)
  - 1 Completed past Project
  - 1 Retired Campaign (so the Archive section in §07 renders)
  - 1 entry in `manuals` (so §09 renders)
  - 2 entries in `open_items`

- `semantic/semantic.json` is a clean Acme Retail Analytics seed with:
  - 4 domains: `CUSTOMER`, `PRODUCT`, `ORDER`, `MARKETING` (each with hand-positioned `x`, `y`, `radius`, `color`, `icon`)
  - 7 tables: `customers`, `customer_360` (curated), `customer_churn_score` (curated), `products`, `orders`, `order_items`, `campaign_sends`
  - ~33 columns total
  - 3 `domain_link` relationships (Order↔Customer, Order↔Product, Marketing↔Customer)
  - 6 column-level `fk` / `derived_from` relationships (the obvious joins)
  - 9 `bucket_table_xref` rows — every bucket-table edge in the seed, both `R` and `W`. Per **ADR 0004** the W rows make `customer_360` and `customer_churn_score` curated.
  - `_meta.schema_version = 2`
  - `meta` array seeded with `suggestion_suppressions=[]` and `solo_offsets={}`

> The existing `semantic/semantic.json` in this repo is exactly this seed.
> Treat it as the canonical reference.

**Templates.** Six Markdown templates under `templates/`. Each is one A4-ish
page of section headings + placeholder bullet points. Audience: someone
filling in a one-pager for a new bucket. Names match `MAN-…`-style usage.

**Build command.** None for this phase — the files are static.

**Acceptance smoke.**
1. `python -c "import json; json.load(open('inventory.json'))"` parses.
2. `python -c "import json; json.load(open('semantic/semantic.json'))"` parses.
3. All 11 ADRs exist under `docs/adr/`.

---

### Phase 2 — Python build scripts

**Goal.** Produce the two regenerators that turn JSON into HTML.

**Spec inputs.** ADRs **0001, 0003, 0004, 0005**, plus `MAINTENANCE.md` for
the operational contract.

**Files to produce.**

```
scripts/rebuild_wiki.py                       Orchestrator — runs step6 + step11, optionally invokes build_semantic.py if semantic.json mtime > 08_Semantic_Model.html mtime
scripts/step6_build_inventory.py              JSON → inventory.xlsx (round-trip safe; openpyxl optional — skip with a warning if missing)
scripts/step11_build_wiki.py                  JSON → index.html. Renders sections 01–09 (Projects, Campaigns, Models, BAU, Strategy, Adhoc, Archive, Repo↔bucket xref, Manuals). Implements ADR 0001 (Retired → Archive as collapsible tables). Self-contained — embeds all CSS/JS inline OR links assets/wiki.css + assets/wiki.js (the convention here is *external* assets, but the rendered HTML is portable because assets are vendored next to it).
scripts/build_semantic.py                     semantic.json → semantic/08_Semantic_Model.html. Implements ADR 0003 (hand-positioned domains, ring-laid satellites), ADR 0004 (curated = W in xref), ADR 0008 (no Cytoscape on the published page — pure SVG), ADR 0010 (Solo mode in mini-wiki).
```

**Hard constraints.**

- `rebuild_wiki.py` must succeed even if `openpyxl` is missing — it should
  warn and skip `inventory.xlsx` regeneration.
- `step11_build_wiki.py` must respect the `narratives` block on each bucket
  (collapsible panel on the hero card).
- `step11_build_wiki.py` must surface a `Retired` filter chip; Retired
  buckets render in the Archive section as collapsible tables, never as
  cards (ADR 0001 update note).
- `build_semantic.py` reads JSON, **never** XLSX in the normal build (ADR 0005).
  Behind explicit `--import-xlsx` / `--export-xlsx` flags it may round-trip
  XLSX.
- `build_semantic.py` is regenerable and idempotent — running it twice
  produces byte-identical output.
- All scripts use `pathlib.Path`, never string concatenation for paths.
- Scripts use ONLY Python stdlib (plus optional openpyxl) — no requests, no
  jinja2, no markdown lib. Inline string templates are fine.

**Build command.**

```bash
python scripts/rebuild_wiki.py
python scripts/build_semantic.py
```

**Acceptance smoke.**
1. `index.html` exists, is non-empty, parses as well-formed HTML (you can
   stub a check with `python -c "from html.parser import HTMLParser; HTMLParser().feed(open('index.html').read())"`).
2. `index.html` contains the string `Archive` (the §07 heading) and at
   least one bucket from each non-Retired category.
3. `semantic/08_Semantic_Model.html` exists, non-empty, contains every
   domain name from `semantic.json`.
4. `inventory.xlsx` exists OR a "skipped — install openpyxl" warning was
   printed.

---

### Phase 3 — Admin server + assets

**Goal.** Make `inventory.json` editable from a browser without installing
anything beyond Python stdlib.

**Spec inputs.** ADRs **0005, 0011**, plus `MAINTENANCE.md`.

**Files to produce.**

```
serve_admin.py                                Custom HTTPServer. Routes:
                                              · GET  /                                → 302 to /admin.html
                                              · GET  /<path>                          → static file
                                              · PUT  /inventory.json                  → write to disk (bearer-gated, ADR 0011); rotate .bak; trigger inline rebuild_wiki
                                              · PUT  /semantic/semantic.json          → write to disk (bearer-gated); trigger inline build_semantic
                                              · POST /api/auth/login                  → exchange PIN for bearer
                                              · POST /api/auth/whoami                 → validate bearer
                                              · POST /api/auth/change                 → rotate PIN
                                              · POST /upload-inventory                → xlsx import (bearer-gated)
                                              · POST /upload-semantic                 → xlsx import (bearer-gated)
                                              · POST /export-semantic-xlsx            → JSON → xlsx (bearer-gated)
                                              Bind 0.0.0.0:8765 by default; opt out via --bind 127.0.0.1.
                                              Print every LAN URL on startup.
admin.html                                    Loads auth.js → admin.css → admin.js. Toolbar + tabbed grid (Projects/Campaigns/Models/BAU/Strategy/Adhoc/Repo map/Manuals/Open items). Save button → PUT /inventory.json. 🔑 Passcode button → POST /api/auth/change modal. "show retired" toggle defaults to false.
assets/auth.js                                Fetch monkey-patch attaches Authorization: Bearer <token> to every same-origin request. On 401, prompts for PIN, calls /api/auth/login, retries.
assets/admin.js                               Grid state machine + row CRUD + dirty-tracking + Ctrl-S handler + xlsx upload modal + Narrative editor modal.
assets/admin.css                              Light styling consistent with wiki.css palette.
assets/manuals.css                            Optional shared styling for Manuals card grid (used by index.html and mini-wikis).
assets/wiki.css                               The *rendered* wiki's stylesheet (loaded by index.html).
assets/wiki.js                                The *rendered* wiki's runtime (sidebar peek, search, filter chips).
```

**Hard constraints.**

- All `PUT` and xlsx-mutation `POST` endpoints return 401 if the bearer is
  missing or invalid. All GETs and the three `/api/auth/*` endpoints are
  always open (ADR 0011 step 5).
- `.passcode` and `.session` are created on first run (default PIN `111111`,
  per ADR 0011). Both are gitignored.
- `serve_admin.py` performs an **in-process rebuild** on successful PUT —
  it imports `scripts.step11_build_wiki` / `scripts.build_semantic` and
  calls them directly. After any edit to those modules, the daemon must
  `importlib.reload(...)` them (this is a known gotcha — long-running daemon
  + edited modules).
- The first PUT after `serve_admin.py` boot must also rotate `inventory.json
  → inventory.json.bak`.

**Build command.**

```bash
python serve_admin.py --bind 127.0.0.1
```

**Acceptance smoke.**
1. `GET http://localhost:8765/admin.html` returns 200.
2. `PUT http://localhost:8765/inventory.json` with no Authorization header
   returns **401**.
3. `POST /api/auth/login` with `{"pin":"111111"}` returns a bearer token.
4. `PUT /inventory.json` with that bearer + a no-op body returns 204 AND a
   `.bak` rotation has occurred AND a header `X-Build-Status: ok` is
   present on the response.
5. `python scripts/uat_admin.py` (Playwright) passes its 14 checks
   end-to-end. (Phase 5 also covers this — running it here is optional.)

---

### Phase 4 — Semantic editor

**Goal.** A live in-browser editor for `semantic.json` with two canvas
modes (Domain map + Power BI-style Table model).

**Spec inputs.** ADRs **0003, 0005, 0006, 0007, 0009-solo-mode-for-domain-map**,
plus `CONTEXT.md` for the Semantic Editor / Domain map view / Table model
view / Solo mode / Suggestion suppression terms.

**Files to produce.**

```
semantic_editor.html                          Loads auth.js → semantic_editor.css → vendor/cytoscape.min.js → semantic_editor.js. Header has view-toggle, search omnibox, save button, "🔑" passcode button. Body is one fullscreen canvas + collapsible Inspector + Suggestions panel.
assets/semantic_editor.css                    All styling for the editor (~1k LOC) — Domain map, Table model, Inspector, Suggestions, Combobox (ADR 0007), Solo mode.
assets/semantic_editor.js                     Cytoscape-based runtime. Implements ADR 0006 (vendored), ADR 0007 (column combobox + scoreFkLink), ADR 0009-solo-mode (Solo focus + ghost pucks + Tidy + meta.solo_offsets persistence).
assets/vendor/cytoscape.min.js                Vendored — DO NOT regenerate. Download via the procedure in assets/vendor/NOTICE.md.
assets/vendor/NOTICE.md                       Refresh instructions (curl + sha256 check).
00_WALKTHROUGH.html                           Illustrated tour of the main wiki — hand-authored, doesn't regenerate. May reference real screenshots if the adopter has any; otherwise stub paragraphs.
00_SEMANTIC_WALKTHROUGH.html                  Illustrated tour of the semantic mini-wiki + editor.
00_PRJ-2026-01_Example.html                   One example deep-pack ("mini-wiki") page referenced from inventory.json:mini_wikis.
```

**Vendoring procedure (Cytoscape, per ADR 0006).**

```bash
mkdir -p assets/vendor
curl -L https://unpkg.com/cytoscape@3.30.4/dist/cytoscape.min.js \
     -o assets/vendor/cytoscape.min.js
# Verify (Cytoscape 3.30.4 published sha256):
sha256sum assets/vendor/cytoscape.min.js
```

Pin the version in `assets/vendor/NOTICE.md` together with the SHA, the
licence (`MIT`), and the upstream URL.

**Hard constraints.**

- The editor and the published mini-wiki are **different code paths**.
  The published `semantic/08_Semantic_Model.html` is pure SVG, no
  Cytoscape (ADR 0008). The editor uses Cytoscape. Do not mix them.
- The editor's `STATE` object holds the full `semantic.json` in memory.
  Save = PUT the whole document. Concurrent edits: last writer wins,
  with optional `If-Match` ETag.
- Domain map view: nodes are domains (radius-controlled bubbles) + table
  satellites arranged in a ring (ADR 0003). Drag a domain = move the
  bubble + auto-translate satellites; persist `x, y, radius` back to
  `domains[]`.
- Table model view: each table is a Power BI-style card with column rows.
  Shift-drag from column to column = create a new `fk` relationship.
- New-relationship modal uses the column combobox (ADR 0007).
- Suggestions panel: `computeSuggestions()` proposes likely FKs; the user
  can accept, reject, or suppress; suppressions persist into
  `meta.suggestion_suppressions` (ADR 0007 / CONTEXT.md).
- Solo mode entry/exit, ghost pucks, Tidy chip, per-table offset
  persistence — all per ADR 0009-solo-mode.

**Build command.**

```bash
python serve_admin.py
# browse http://localhost:8765/semantic_editor.html
```

**Acceptance smoke.**
1. `GET /semantic_editor.html` returns 200.
2. The page renders both view modes without console errors.
3. Saving (PUT /semantic/semantic.json) triggers an inline rebuild of
   `semantic/08_Semantic_Model.html` AND returns `X-Build-Status: ok`.
4. Phase 5's `smoke_semantic_editor.py` (≥ 12 steps) passes end-to-end.

---

### Phase 5 — Smoke tests + final verification

**Goal.** A test harness that proves every interactive surface still works.

**Spec inputs.** No ADRs — these are mechanical tests against the surfaces
built in phases 2–4.

**Files to produce.**

```
scripts/smoke_mini_wiki_view.py               Headless checks against semantic/08_Semantic_Model.html — both view modes render, domain & table counts match the JSON, edges resolve.
scripts/smoke_mini_wiki_drag.py               (Playwright) Drag a domain bubble; verify satellites translate; reset works.
scripts/smoke_mini_wiki_solo.py               (Playwright) Enter Solo on each domain in turn; verify ghost pucks; exit via empty-canvas click, Esc, breadcrumb.
scripts/smoke_semantic_editor.py              (Playwright) 12-step end-to-end: open, switch views, search hit, new relationship via combobox, Solo, save (PUT), confirm in-process rebuild.
scripts/uat_admin.py                          (Playwright) 14-check admin.html UAT — add row, edit row, retire row, narrative modal, save, undo, xlsx upload.
```

**Hard constraints.**

- Smoke scripts use `playwright` (sync API). They must boot
  `serve_admin.py` themselves if needed, or assume an already-running
  server — make the choice explicit at the top of each script.
- Each script is independently runnable: `python scripts/smoke_X.py` from
  the repo root succeeds or exits non-zero.
- Each step prints a one-line `[ok] step N: <description>` on success.

**Build command.**

```bash
# In one terminal:
python serve_admin.py

# In another:
python scripts/smoke_mini_wiki_view.py
python scripts/smoke_mini_wiki_drag.py
python scripts/smoke_mini_wiki_solo.py
python scripts/smoke_semantic_editor.py
python scripts/uat_admin.py
```

**Acceptance smoke.** All five exit 0 and print their full step-by-step log.

---

## 4. Pitfalls (the ones Claude actually trips over)

1. **The published mini-wiki is SVG, not Cytoscape.** ADR 0008. Do not let
   Claude unify the editor and the published page just because they look
   similar — they are intentionally different code paths.
2. **`serve_admin.py` is a long-running daemon.** When Claude edits
   `step11_build_wiki.py` or `build_semantic.py`, the daemon won't pick up
   the change until it `importlib.reload(...)`s the module. The fix
   belongs in `_rebuild_wiki` / `_rebuild_semantic`.
3. **Do not auto-format `semantic.json`.** It is hand-readable; preserve
   field order (domains first, tables next, columns, relationships,
   bucket_table_xref, meta).
4. **Do not refactor `assets/vendor/cytoscape.min.js`.** It is vendored
   verbatim from upstream (ADR 0006). Touching it breaks the licence
   chain.
5. **Real client / employer names must not appear in this repo.** If
   Claude pastes any organisation-specific table names, catalog names,
   or product codes (it sometimes infers them from training data),
   reject the file. Use the Acme Retail seed only.
6. **Use the Acme seed's column vocabulary.** `customer_id`, `order_id`,
   `score_date`, etc. — not legacy column names from other domains.
7. **The two ADR 0009 files coexist.** `0009-solo-mode-for-domain-map.md`
   is the editor decision; the LAN-passcode decision lives at
   `0011-passcode-gate-for-lan-access.md` (renumbered to keep both).
   Do not collapse them.
8. **`Adhoc` is a category in `inventory.json` but renders in its own
   section,** not next to Project/Campaign/Model/BAU/Strategy.
9. **`Retired` is a status, "Archive" is the section** — ADR 0001 + the
   Flagged Ambiguities block in CONTEXT.md.
10. **`closed_bank → Agency` and similar campaign-engine rules are NOT in
    this repo.** They belong to a downstream campaign-orchestrator. Do
    not bleed those concerns into the wiki.

---

## 5. Bootstrapping the fresh repo

Once all five phases pass, the working directory is a complete `team-wiki`
repo. Initial commit + push:

```bash
git init -b main
git add .
git commit -m "feat: initial team-wiki scaffold from PROMPT.md bootstrap"

# Replace with your remote
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

After cloning into a new environment, the only one-time setup is:

```bash
python -m pip install --user openpyxl playwright    # optional
playwright install chromium                          # optional
```

---

## 6. Maintenance contract

When this template evolves:

- Update the relevant ADR (or write a new one) **before** changing the code.
- Update `CHANGELOG.md` with a one-liner pointing at the ADR.
- For non-trivial changes, add an entry under `docs/audit-trail.md` with
  scope · findings · changes · verified-via.
- Do **not** restate the changed spec inside PROMPT.md — PROMPT.md points
  at the spec docs precisely so it doesn't drift.

If a future change makes one of the phases above structurally wrong (e.g.
you replace the JSON SoT with a SQLite SoT), update Phase X's "Spec inputs"
to point at the new ADR — but keep the phase shape (Goal · Inputs · Files
· Build · Smoke) constant.

---

*Originally written 2026-05-26. Maintained by the wiki's current author.*
