# AI Wiki — Maintenance guide

> **Audience:** the person who maintains this AI Wiki template for their team and needs to keep it accurate as project statuses change, adhocs accrete, and open items get closed.
>
> **Cadence:** ~monthly for adhocs; ~quarterly (or when something materially changes) for buckets and open items. Less often is fine — the wiki is reference material, not a live dashboard.

---

## TL;DR

1. Launch the admin tool from the wiki folder:

   ```bash
   python serve_admin.py
   ```

   This starts a loopback-only static server on `http://localhost:8765/` and opens `admin.html` in your default browser.

2. Edit rows on the relevant tab (Project / Campaign / Model / BAU / Strategy / Adhoc / Repo map). Click **+ Add row** to create a new bucket or adhoc. To **soft-delete** a row, change its **Status** dropdown to `Retired` &mdash; the row stays in the file for audit but no longer renders in `index.html`. To **hard-delete** (irreversible &mdash; row removed from `inventory.json` entirely), click the row's **Delete** button. Click **Save** (or press `Ctrl+S`).

3. Rebuild the wiki:

   ```bash
   python scripts/rebuild_wiki.py
   ```

4. Append a one-line entry to `CHANGELOG.md`.

5. (Optional) Commit and push if the wiki is version-controlled.

That's it. The rest of this document expands each step, lists the allowed values, and documents how each piece fits together.

---

## Why "edit a JSON file via admin.html" and not "edit the .xlsx"?

The `inventory.xlsx` workbook is **generated** by `step6_build_inventory.py` from `inventory.json` — it's a read-only artefact for audit reviewers, not an input. If you edit the xlsx directly your changes will be silently overwritten on the next rebuild.

The single source of truth is therefore `inventory.json`. You *can* edit it by hand (it's plain JSON), but `admin.html` does input validation, soft-delete semantics, auto-stamps `last_touch` on adhoc edits, and rotates a `.bak` on every save.

---

<a id="edit"></a>
## 1. Edit via the admin tool (recommended)

1. Run `python serve_admin.py` (loopback-only — no firewall prompt, no LAN exposure).
2. The 7 tabs at the top mirror the sections of the wiki. Live count badges next to each tab reflect non-retired rows.
3. **+ Add row** opens a modal pre-filled with the next free ID for the current tab (e.g. on the Project tab it suggests `PRJ-<YYYY>-<NN>`). Required fields are marked with an orange asterisk. Validation blocks save until the ID prefix matches the category and the year is a 4-digit integer.
4. **Inline edit** any cell. Edits highlight the row in cream until saved. Adhoc rows auto-stamp `last_touch = today` on any change.
5. **Soft-delete (Retire)** &mdash; set the row's **Status** column to `Retired`. The row stays in `inventory.json` for audit but no longer renders in `index.html`, the sidebar count, or the generated xlsx. Toggle *show retired* to reveal these rows; flip Status back to `Active` / `Completed` to restore. **Hard-delete** &mdash; click the row's **Delete** button (asks to confirm). This permanently removes the row from `inventory.json` along with any linked `narratives`, `mini_wikis`, and `sp_overrides` entries; the previous file is kept as `inventory.json.bak`.
6. **Delete** hard-deletes a row (you'll be asked to confirm). The pre-save `.bak` is your safety net if you change your mind.
7. **Save** (button or `Ctrl+S`) writes `inventory.json` via HTTP PUT to the local server, which atomically rotates the previous file to `inventory.json.bak` first.
8. After saving, rebuild the wiki (see §3).

### Allowed values

| Field      | Allowed                                                |
|------------|--------------------------------------------------------|
| Category   | `Project` `Campaign` `Model` `BAU` `Strategy` `Adhoc`  |
| Status     | `Active` `Completed` `Superseded` `Retired`            |
| Tier       | `P0` `P1` `P2`                                         |
| Year       | 4-digit integer                                        |
| Bucket ID  | `<PREFIX>-<YYYY>-<NN>` (prefix must match category)    |
| Adhoc ID   | `ADH-<YYYY>-<NNN>` (3-digit suggested)                 |

Prefix ↔ category map: `PRJ` → Project · `CMP` → Campaign · `MOD` → Model · `BAU` → BAU · `STR` → Strategy · `ADH` → Adhoc.

> The wiki's filter chips match status strings exactly — spelling matters. Use the dropdown in the admin tool to avoid typos.

### Mini-wiki field

Every bucket and adhoc row has a **Mini-wiki / URL** field. Paste either:

- a sibling `00_*.html` filename (e.g. `00_PRJ-2026-01_Example.html`), or
- a full `https://…` URL (opens in a new tab).

When set, the bucket's hero card on `index.html` becomes a one-click jump to that deep pack. This is the single source of truth for deep-pack CTAs.

### Repo map tab

The 7th tab (**Repo map**) edits `inventory.json:cross_refs[]` — a free-form list of `{repo_path, buckets}` pairs. Use it to record "this folder belongs to these buckets" so newcomers can navigate from the repo tree back to the wiki entries.

---

<a id="edit-by-hand"></a>
## 2. Edit `inventory.json` directly (power-user fallback)

If you prefer a text editor, open `inventory.json`. Schema:

```jsonc
{
  "_meta": { "version": 1, "generated": "...", "edit_via": "admin.html" },
  "buckets":    [{ "bucket_id": "PRJ-...", "name": "...", "category": "Project",
                   "status": "Active", "tier": "P0", "year": 2026,
                   "source_plan": "...", "repo_link": "...",
                   "lineage": "...", "purpose": "..." }],
  "adhoc":      [{ "id": "ADH-...", "last_touch": "YYYY-MM-DD",
                   "domain": "...", "title": "...", "source_folder": "...",
                   "type": "...", "status": "Closed", "notes": "..." }],
  "open_items": [{ "severity": "P0|P1|P2", "bucket": "...", "item": "...",
                   "first_action": "..." }],
  "manuals":    [{ "id": "MAN-2026-01", "title": "...", "desc": "...",
                   "file": "01_Guide.docx", "url": "" }],
  "cross_refs": [{ "repo_path": "...", "buckets": "..." }],
  "sp_overrides": { "BUCKET-ID": "YYYY/Sub/Path/" },
  "mini_wikis":  { "BUCKET-ID": { "file": "00_*.html", "label": "..." } }
}
```

Then rebuild (§3).

---

<a id="adhoc"></a>
## 3. Log a new adhoc deliverable

On the **Adhoc** tab click **+ Add row**. The modal pre-fills `id` with the next free `ADH-<YYYY>-<NNN>` for the current year and `last_touch` with today's date. Required: `id`, `last_touch` (`YYYY-MM-DD`), `domain`, `title`, `source_folder`. Optional: `type`, `status`, `notes`.

Editing any field on an existing adhoc row auto-stamps `last_touch` — no more hand-set dates.

---

<a id="open-items"></a>
## 4. Open items

These are **not** yet editable through `admin.html` (v1 limitation — they're touched rarely). Edit `inventory.json:open_items` directly:

```jsonc
{ "severity": "P0", "bucket": "STR-2026-01", "item": "...", "first_action": "..." }
```

Severities: `P0` (close in 30 days), `P1` (in 90 days), `P2` (housekeeping). Then rebuild.

---

## 4b. Edit narrative copy (no rebuild required)

The "Decisions baked in" / "Open questions" lists shown on bucket hero cards live inside `inventory.json` under the top-level `narratives` key. Edit them via **admin.html** &rarr; click the **📝 Narrative** button in any bucket row, fill in the two textareas (one bullet per line), Save. Reloading `index.html` over http(s) picks the change up immediately — no rebuild required.

```jsonc
{
  "PRJ-2026-01": {
    "decisions_baked_in": ["…", "…"],
    "open_questions":     ["…", "…"]
  }
}
```

For `file://` previews, the inline JSON baseline embedded by `step11_build_wiki.py` is used instead — so rebuild only if you want the inline baseline to reflect your latest edits.

---

<a id="rebuild"></a>
## 5. Rebuild the wiki

```bash
python scripts/rebuild_wiki.py
```

This runs `step6_build_inventory.py` (regenerates the xlsx artefact from `inventory.json`) and then `step11_build_wiki.py` (renders `index.html`). Year filter chips at the top of the wiki are auto-derived from the data on every rebuild — no manual list to maintain.

It does **not** rebuild any `00_*.html` mini-wikis — those are hand-edited HTML pages that you author once per deep-dive.

---

<a id="publish"></a>
## 6. (Optional) Commit and publish

If your wiki lives in a Git repo:

```bash
git add inventory.json handover_inventory.xlsx index.html CHANGELOG.md
git commit -m "wiki: <one-line description>"
git push
```

Don't commit `inventory.json.bak` — it's local-only.

Share `index.html` however suits your team — email attachment, SharePoint, GitHub Pages, internal static host, or just open it locally over `file://`. The page is fully self-contained (single HTML + the sibling JSON sidecars).

---

<a id="cadence"></a>
## 7. Recommended cadence

| Cadence    | Task                                                           |
|------------|----------------------------------------------------------------|
| Monthly    | Add new adhocs; close P0 open items; refresh bucket statuses.  |
| Quarterly  | Mark finished workstreams as `Completed` or `Superseded`.      |
| Annually   | Spot-check a handful of folder links (folders get renamed).    |

The wiki is reference material — daily updates are unnecessary and would add noise.

---

<a id="troubleshooting"></a>
## 8. Troubleshooting

| Symptom                                                          | Likely cause / fix                                                                                                  |
|------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| `admin.html` loads but shows "loading…" then errors              | Local server isn't running. In a terminal: `python serve_admin.py`.                                                 |
| Save fails with an HTTP error                                    | Server crashed or port 8765 is busy. Restart `serve_admin.py`. The pre-save `.bak` is safe to roll back.            |
| `admin.html` opened from `file://` shows the help panel          | Expected — saving needs HTTP. Use `serve_admin.py`.                                                                 |
| Port 8765 already in use                                         | On Windows: `netstat -ano \| findstr 8765` to find the PID; kill it or edit `PORT` in `serve_admin.py`.             |
| Want to roll back a bad save                                     | Copy `inventory.json.bak` over `inventory.json`, refresh admin.                                                     |
| New bucket appears with no external link                         | Optional override column blank. Add an explicit override in `sp_overrides` / `repo_link`.                           |
| Year chip for a new year not appearing                           | Rebuild — chips are auto-derived but require a fresh `index.html`.                                                  |
| `rebuild_wiki.py` errors with `FileNotFoundError: inventory.json`| Ensure you're running from the wiki folder (where `inventory.json` sits).                                           |
| Status chip filter excludes a card you expected to see           | Status string doesn't match exactly (`Active` / `Completed` / `Superseded`). Reselect in the admin tool.            |
| Two laptops both edited `inventory.json`                         | Last-write-wins. Pull-rebase before saving, or eyeball the `.bak` for what would be lost.                           |

---

## Architecture in one diagram

```text
inventory.json             ← single source of truth
       ▲
       │ HTTP PUT (rotates inventory.json.bak first)
       │
admin.html (served by serve_admin.py · loopback only)
       │
       │ rebuild_wiki.py  →  step6 + step11
       ▼
step6_build_inventory.py  → handover_inventory.xlsx   (read-only artefact)
step11_build_wiki.py      → index.html                (share via your static host, or just open over file://)
```

Everything else (`00_*.html` mini-wikis, `templates/*.md`) is hand-authored and only touched when you write new content.

---

## Customising for your team

- **Branding** — search `step11_build_wiki.py` for the strings `The Team AI Wikipedia` and `Team · AI Wiki` and replace with your team's name. The page `<title>` is in the same file.
- **External links** — `GH_ROOT`, `GH_REPO` and `SP_ROOT` constants at the top of `step11_build_wiki.py` are empty by default. Fill them in to enable repo / SharePoint links in the rendered cards.
- **Adding a new category** — the six categories (Project / Campaign / Model / BAU / Strategy / Adhoc) and their prefixes are baked into the script. Adding a 7th would require non-trivial edits to `admin.html`, `step11`, and the JSON schema. Most teams find six covers their needs.
