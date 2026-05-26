"""
step11_build_wiki.py
====================

Builds a single-file portable HTML wiki — "Team Wiki".

Output: handovers/index.html  (named `index.html` so GitHub Pages serves it
        as the default landing page for the `handovers/` folder).

Design system (modelled on thariqs.github.io/html-effectiveness):
    - Ivory #FAF9F5 background, slate #141413 text, clay #D97757 accent
    - Serif headings (ui-serif / Georgia) with italic <em> in clay
    - System sans for body, mono for IDs / file paths
    - Centered single-column wrap (max 1120px), NO sidebar
    - TOC as pills under masthead
    - Numbered sections (01, 02, …) with mono index in clay
    - Card grid with hover-lift, 1.5px borders, 14px radius
    - Inline SVG thumbnails for visual rhythm

Link policy (NO BROKEN LINKS):
    - GitHub root: <repo_root>/tree/<branch>/<repo-path>   (configurable via
      inventory.json settings.repo_root + settings.repo_branch; defaults below)
    - SharePoint root: configurable via inventory.json settings.sp_root
    - Every GH path is validated against the local working tree before being linked.
    - Uncertain SharePoint sub-paths fall back to year-root (always present).

Data source (since May-2026):
    handovers/inventory.json   — single source of truth; edited via admin.html
    handovers/inventory.xlsx           is a generated artifact (step6), kept
    for backward compatibility but no longer read by this script.
"""

from __future__ import annotations
import json
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]   # handovers/
REPO_ROOT = ROOT.parent                       # parent repo
INV_JSON = ROOT / "inventory.json"
OUT = ROOT / "index.html"

# GitHub repo — defaults overridden at load time by inventory.json:
#   settings.repo_root   = base URL, e.g. https://github.com/<org>/<repo>
#   settings.repo_branch = branch name (default 'main')
# All three derived forms (tree/<branch>/, blob/<branch>/, bare repo) are
# computed by _set_repo_urls() so the call sites stay in sync.
REPO_ROOT_URL_DEFAULT = ""  # set this to your repo URL, or override via settings.repo_root_url in inventory.json
REPO_BRANCH_DEFAULT   = "main"
REPO_ROOT_URL = REPO_ROOT_URL_DEFAULT
REPO_BRANCH   = REPO_BRANCH_DEFAULT
GH_TREE = f"{REPO_ROOT_URL}/tree/{REPO_BRANCH}/"   # browse a folder
GH_BLOB = f"{REPO_ROOT_URL}/blob/{REPO_BRANCH}/"   # view a file
GH_REPO = REPO_ROOT_URL                             # bare repo home

# SharePoint root — default, overridden at load time by inventory.json settings.sp_root.
# Accepts any of: SharePoint URL, OneDrive path-URL, local Windows/Unix path, UNC.
SP_ROOT_DEFAULT = ""  # set via inventory.json settings.sp_root
SP_ROOT = SP_ROOT_DEFAULT

# Populated by load_inventory(). Module-level so render_* helpers can read
# without an explicit pass-through.
SP_BUCKET: dict = {}
MINI_WIKIS: dict = {}
NARRATIVES: dict = {}


def _set_repo_urls(repo_root: str, repo_branch: str) -> None:
    """Update the three GitHub URL forms from settings. Strips trailing
    slashes and a pasted '/tree/<branch>/...' or '/blob/<branch>/...' suffix
    so the base stays canonical regardless of what the user pasted into the
    admin Settings panel."""
    global REPO_ROOT_URL, REPO_BRANCH, GH_TREE, GH_BLOB, GH_REPO
    import re as _re
    rr = (repo_root or REPO_ROOT_URL_DEFAULT).strip().rstrip("/")
    rr = _re.sub(r"/(?:tree|blob)/[^/]+/?.*$", "", rr) or REPO_ROOT_URL_DEFAULT
    br = (repo_branch or REPO_BRANCH_DEFAULT).strip().strip("/") or REPO_BRANCH_DEFAULT
    REPO_ROOT_URL = rr
    REPO_BRANCH   = br
    GH_TREE = f"{rr}/tree/{br}/"
    GH_BLOB = f"{rr}/blob/{br}/"
    GH_REPO = rr


def _sp_root_is_url(root: str) -> bool:
    """True if SP_ROOT is a clickable web URL (http/https). False for local /
    UNC paths — browsers block file:// links from http(s) pages, so the SP
    chip becomes a copy-only label instead."""
    return bool(root) and root.strip().lower().startswith(("http://", "https://"))


def _join_sp(root: str, sub: str) -> str:
    """Append `sub` to `root` sensibly. URLs use forward-slash + %20 for spaces;
    local paths use the OS separator and don't encode spaces."""
    if not sub:
        return root
    if _sp_root_is_url(root):
        sep = "" if root.endswith("/") else "/"
        return root + sep + sub.replace(" ", "%20")
    # local / UNC — use backslash on Windows-style roots, forward-slash otherwise
    win = "\\" in root
    sep_char = "\\" if win else "/"
    end = root.rstrip("/\\")
    return end + sep_char + sub.replace("/", sep_char)


def _repo_path_exists(p: str) -> bool:
    """Validate that a repo path exists on disk (proxy for GitHub link validity)."""
    if not p:
        return False
    return (REPO_ROOT / p.strip().rstrip("/")).exists()

# ---------------------------------------------------------------------------
# Constants populated at runtime from inventory.json by load_inventory().
#   SP_BUCKET   — bucket_id → confirmed SharePoint sub-path
#   MINI_WIKIS  — bucket_id → (mini-wiki HTML filename OR http(s) URL, CTA label)
# These were previously hardcoded; they now live in inventory.json so a new
# bucket only needs editing in one place (via admin.html).
# ---------------------------------------------------------------------------
SP_BUCKET: dict[str, str] = {}
MINI_WIKIS: dict[str, tuple[str, str]] = {}

# Header keys the render_* functions expect (kept identical to the original
# xlsx column headers, so render code is unchanged).
_BUCKET_FIELDS = [
    ("bucket_id",   "Bucket ID"),
    ("name",        "Name"),
    ("category",    "Category"),
    ("status",      "Status"),
    ("tier",        "Tier"),
    ("year",        "Year"),
    ("source_plan", "Source plan"),
    ("repo_link",   "Repo link"),
    ("lineage",     "Lineage"),
    ("purpose",     "Purpose"),
]
_ADHOC_FIELDS = [
    ("id",            "ID"),
    ("last_touch",    "Last-Touch"),
    ("domain",        "Domain"),
    ("title",         "Title"),
    ("source_folder", "Source folder"),
    ("type",          "Type"),
    ("status",        "Status"),
    ("notes",         "Notes"),
]
_OPEN_FIELDS = [
    ("severity",     "Severity"),
    ("bucket",       "Bucket"),
    ("item",         "Open item"),
    ("first_action", "First action"),
]


def _to_legacy(rows: list[dict], fields: list[tuple[str, str]],
               keep_retired: bool = False) -> list[dict]:
    """Map JSON rows (snake_case) → legacy header-cased dicts the renderers expect.

    By default, soft-deleted rows (status starts with 'Retired') are filtered
    out — preserves the original "live wiki only" behaviour for the standard
    bucket / adhoc / open_items streams.

    Pass `keep_retired=True` to receive every row regardless of status; used by
    the dedicated Archive stream (see load_inventory's `07_Archive`)."""
    out = []
    for r in rows:
        if not keep_retired and str(r.get("status", "")).startswith("Retired"):
            continue
        out.append({legacy: r.get(key, "") for key, legacy in fields})
    return out


def _only_retired(rows: list[dict], fields: list[tuple[str, str]]) -> list[dict]:
    """Inverse of the default _to_legacy filter — emit ONLY retired buckets.
    Used to populate the Archive section."""
    out = []
    for r in rows:
        if not str(r.get("status", "")).startswith("Retired"):
            continue
        out.append({legacy: r.get(key, "") for key, legacy in fields})
    return out


def load_inventory():
    """Read inventory.json, populate SP_BUCKET / MINI_WIKIS / NARRATIVES,
    and return a dict shaped like the legacy `{sheet_name: {headers, rows}}`
    so the render_* functions are unchanged."""
    global SP_BUCKET, MINI_WIKIS, SP_ROOT, NARRATIVES
    if not INV_JSON.exists():
        raise FileNotFoundError(
            f"{INV_JSON} not found. Run handovers/scripts/migrate_to_json.py once."
        )
    data = json.loads(INV_JSON.read_text(encoding="utf-8"))

    # Global settings (sp_root / repo_root override hardcoded defaults;
    # fork-once-and-forget).
    settings = data.get("settings") or {}
    SP_ROOT = (settings.get("sp_root") or SP_ROOT_DEFAULT).strip()
    _set_repo_urls(settings.get("repo_root", ""), settings.get("repo_branch", ""))

    SP_BUCKET = dict(data.get("sp_overrides", {}))
    MINI_WIKIS = {
        k: (v["file"], v["label"])
        for k, v in data.get("mini_wikis", {}).items()
    }
    # Per-bucket free-text "Decisions baked in" / "Open questions".
    # Source of truth lives inside inventory.json; the legacy sidecar
    # handovers/prj_narrative.json is honoured as a soft fallback for one
    # rebuild cycle to ease the migration.
    NARRATIVES = dict(data.get("narratives") or {})
    if not NARRATIVES:
        legacy = ROOT / "prj_narrative.json"
        if legacy.exists():
            try:
                obj = json.loads(legacy.read_text(encoding="utf-8"))
                NARRATIVES = {k: v for k, v in obj.items() if not k.startswith("_")}
                print("  note: read narratives from legacy prj_narrative.json — "
                      "run scripts/migrate_narrative.py to move them into inventory.json")
            except Exception as e:
                print(f"  warn: couldn't parse prj_narrative.json ({e})")

    buckets = _to_legacy(data.get("buckets", []), _BUCKET_FIELDS)
    archive = _only_retired(data.get("buckets", []), _BUCKET_FIELDS)
    # repo_role lives on each bucket; merge it back onto the legacy dict so the
    # repo-map renderer can show "BUCKET-ID (role)" without a second lookup.
    role_by_id = {b["bucket_id"]: (b.get("repo_role") or "") for b in data.get("buckets", [])}
    for b in buckets:
        b["Repo role"] = role_by_id.get(b.get("Bucket ID"), "")
    for b in archive:
        b["Repo role"] = role_by_id.get(b.get("Bucket ID"), "")
    adhoc   = _to_legacy(data.get("adhoc", []),   _ADHOC_FIELDS)
    openit  = _to_legacy(data.get("open_items", []), _OPEN_FIELDS)
    # Manuals carry a 2-value status (Active/Retired). Retired is treated as a
    # soft-delete: hidden from the public wiki, no separate Archive section
    # (unlike buckets). Missing/blank status counts as Active.
    manuals = [m for m in data.get("manuals", [])
               if not str(m.get("status", "")).startswith("Retired")]

    def _filter_cat(rows, cat):
        return [r for r in rows if r.get("Category") == cat]

    bucket_hdrs = [legacy for _, legacy in _BUCKET_FIELDS]
    cat_hdrs    = ["Bucket ID", "Name", "Status", "Tier", "Year", "Repo link", "Purpose"]
    adhoc_hdrs  = [legacy for _, legacy in _ADHOC_FIELDS]
    open_hdrs   = [legacy for _, legacy in _OPEN_FIELDS]

    return {
        "01_Buckets":           {"headers": bucket_hdrs, "rows": buckets},
        "02_Projects":          {"headers": cat_hdrs, "rows": _filter_cat(buckets, "Project")},
        "03_Campaigns":         {"headers": cat_hdrs, "rows": _filter_cat(buckets, "Campaign")},
        "04_Adhoc_Log":         {"headers": adhoc_hdrs, "rows": adhoc},
        "04b_Adhoc_Buckets":    {"headers": cat_hdrs, "rows": _filter_cat(buckets, "Adhoc")},
        "05_Models":            {"headers": cat_hdrs, "rows": _filter_cat(buckets, "Model")},
        "06_BAU":               {"headers": cat_hdrs, "rows": _filter_cat(buckets, "BAU")},
        "07_Strategy":          {"headers": cat_hdrs, "rows": _filter_cat(buckets, "Strategy")},
        "07b_Archive":          {"headers": cat_hdrs, "rows": archive},
        "08_Open_Items_Risks":  {"headers": open_hdrs, "rows": openit},
        "09_Manuals":           {"rows": manuals},
    }


def gh_link(repo_path: str) -> str:
    if not repo_path:
        return ""
    p = repo_path.strip().rstrip("/")
    if not p:
        return ""
    # Per-bucket full-URL override (e.g. shared infra repo in a different org).
    if p.lower().startswith(("http://", "https://")):
        return p + "/"
    if not _repo_path_exists(p):
        return ""   # path doesn't exist → no link
    return GH_TREE + p + "/"


def gh_links_from_field(field: str) -> list[tuple[str, str]]:
    """Split a comma/semicolon-separated repo-link field into (path, url) pairs.
    Only emits pairs where the path exists in the repo (no broken links)."""
    if not field or str(field).strip().lower() in ("none", ""):
        return []
    parts = [p.strip().rstrip("/") for p in str(field).replace(";", ",").split(",") if p.strip()]
    out = []
    for p in parts:
        url = gh_link(p)
        if url:
            out.append((p + "/", url))
    return out


def sp_link_for_bucket(bucket_id: str, year) -> tuple[str, str]:
    """Return (label, url). url='' means no SP link emitted.

    Per-bucket override (`sp_overrides[bucket_id]`) accepts any of:
      * full URL (`https://…`)         → used as-is
      * absolute local/UNC path        → used as-is (renderer will make it copy-only)
      * sub-path (`2026/Foo/`)         → appended to SP_ROOT
      * empty string                   → SP link suppressed for this bucket
    Missing override falls back to the year root under SP_ROOT.
    """
    sub = SP_BUCKET.get(bucket_id)
    if sub is not None and sub != "":
        s = str(sub).strip()
        # Full URL or absolute path override — use verbatim, no joining.
        if s.lower().startswith(("http://", "https://")) or s.startswith(("/", "\\\\")) or (len(s) > 2 and s[1] == ":"):
            return (s, s)
        return (s, _join_sp(SP_ROOT, s))
    if sub == "":
        return ("", "")
    # fallback to year root
    if year and str(year).isdigit() and 2018 <= int(year) <= 2026:
        sub = f"{year}/"
        return (sub, _join_sp(SP_ROOT, sub))
    return ("", "")


def sp_link_from_source_folder(src: str) -> tuple[str, str]:
    """For 04_Adhoc_Log entries — Source folder column is canonical."""
    if not src:
        return ("", "")
    s = str(src).strip().rstrip("/")
    if not s:
        return ("", "")
    sub = s + "/"
    return (sub, _join_sp(SP_ROOT, sub))


# ---------------------------------------------------------------------------
# Page rendering
# ---------------------------------------------------------------------------
HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VN · AI Wiki</title>
<link rel="stylesheet" href="assets/wiki.css">
</head>
<body>
<aside class="sidebar">
  <div class="brand">VN · AI Wiki</div>
  <div class="sb-peek empty" id="sb-peek">
    <span class="pk-id">hover a bucket</span>one-line purpose appears here
  </div>
  __SIDEBAR__
  <div class="sb-foot">
    Built __TODAY__ ·
    <a href="__GH_ROOT_REPO__" target="_blank" rel="noopener">repo</a> ·
    <a href="__SP_ROOT__" target="_blank" rel="noopener">SP</a>
  </div>
</aside>
<div class="wrap">

<header class="masthead">
  <div class="hero-grid">
    <div>
      <div class="eyebrow">Knowledge-transfer · Single-page wiki</div>
      <h1>Team <em>Wiki</em></h1>
      <p class="intro">
        A curated index of every project, campaign, model, BAU procedure and adhoc deliverable
        the VN AA team has produced over the past 24 months — each one linked directly to its
        source on <a href="__GH_ROOT_REPO__" target="_blank" rel="noopener">GitHub</a> and its
        working folder on <a href="__SP_ROOT__" target="_blank" rel="noopener">SharePoint</a>.
        Maintained monthly — see <a href="#maintenance">§11</a> for the update workflow.
      </p>
      <nav class="toc">
        <a href="#projects">Projects <span class="n">__N_PROJECTS__</span></a>
        <a href="#campaigns">Campaigns <span class="n">__N_CAMPAIGNS__</span></a>
        <a href="#models">Models <span class="n">__N_MODELS__</span></a>
        <a href="#bau">BAU <span class="n">__N_BAU__</span></a>
        <a href="#strategy">Strategy <span class="n">__N_STRATEGY__</span></a>
        <a href="#adhoc">Adhoc <span class="n">__N_ADHOC__</span></a>
        <a href="#crossrefs">Repo map <span class="n">__N_XREF__</span></a>
        <a href="#manuals">Manuals <span class="n">7</span></a>
        <a href="#maintenance">Maintenance <span class="n">§11</span></a>
      </nav>
    </div>
    <div class="hero-fig" aria-hidden="true">
      <div class="pane md">
        <span class="tag">.xlsx</span>
        <span class="l w90"></span><span class="l w75"></span><span class="l w82"></span>
        <span class="l w60"></span><span class="l w90"></span><span class="l w70"></span>
        <span class="l w82"></span><span class="l w50"></span><span class="l w75"></span>
        <span class="l w90"></span><span class="l w60"></span>
      </div>
      <div class="pane html">
        <span class="tag">.html</span>
        <span class="l w60"></span>
        <span class="blk"></span>
        <span class="row"><span class="bar b1"></span><span class="bar b2"></span><span class="bar b3"></span><span class="bar b4"></span></span>
        <span class="l w75"></span><span class="l w50"></span>
      </div>
    </div>
  </div>
</header>

<div class="tools">
  <input id="search" type="search" placeholder="Search ID, name, keyword…" autocomplete="off">
  <div class="chip-row" data-group="tier">
    <span class="lbl">Tier</span>
    <span class="chip t-P0" data-v="P0">P0</span>
    <span class="chip" data-v="P1">P1</span>
    <span class="chip" data-v="P2">P2</span>
  </div>
  <div class="chip-row" data-group="status">
    <span class="lbl">Status</span>
    <span class="chip" data-v="Active">Active</span>
    <span class="chip" data-v="Completed">Completed</span>
    <span class="chip" data-v="Superseded">Superseded</span>
    <span class="chip" data-v="Retired">Retired</span>
  </div>
  <div class="chip-row" data-group="year">
    <span class="lbl">Year</span>
    __YEAR_CHIPS__
  </div>
  <span id="filter-banner">
    <span>filtering by <b id="filter-summary"></b></span>
    <span id="filter-clear">clear ✕</span>
  </span>
  <div class="tools-note">
    Tier &middot; Status &middot; Year filter the cards below — they don't edit anything.
    See <a href="#maintenance">§11 Maintenance</a> to update the source.
  </div>
</div>

__SECTIONS__

<footer>
  <div><span class="k">Built</span> by Claude · __TODAY__</div>
  <div>Team Wiki · <a href="__GH_ROOT_REPO__" target="_blank" rel="noopener">repo</a> · <a href="__SP_ROOT__" target="_blank" rel="noopener">materials</a></div>
</footer>

</div>

<script src="assets/wiki.js" defer></script>

</body>
</html>
"""


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------
def esc(s) -> str:
    if s is None:
        return ""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _thumb_svg(category: str) -> str:
    """Per-category line-art illustration for the card thumb.
    Strokes use currentColor so .thumb-icon hover (g500 → clay) animates them.
    Clay accent dots stay clay regardless of state for visual punch.
    """
    CLAY = "#D97757"
    OLIVE = "#788C5D"
    svgs = {
        # PRJ — stacked analytical document with data dots
        "PRJ": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="30" y="22" width="96" height="64" rx="4"/>
            <rect x="42" y="14" width="96" height="64" rx="4" fill="#FAF9F5"/>
            <line x1="54" y1="30" x2="112" y2="30"/>
            <line x1="54" y1="40" x2="96" y2="40"/>
            <line x1="54" y1="50" x2="108" y2="50"/>
            <line x1="54" y1="60" x2="88" y2="60"/>
            <circle cx="152" cy="38" r="4" fill="{CLAY}" stroke="none"/>
            <circle cx="164" cy="54" r="3" fill="{OLIVE}" stroke="none"/>
            <circle cx="152" cy="68" r="2.5" fill="currentColor" stroke="none"/>
        </svg>''',
        # CMP — audience funnel (campaign targeting narrowing)
        "CMP": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <circle cx="40" cy="22" r="5"/>
            <circle cx="60" cy="22" r="5"/>
            <circle cx="80" cy="22" r="5"/>
            <circle cx="100" cy="22" r="5"/>
            <circle cx="120" cy="22" r="5"/>
            <circle cx="140" cy="22" r="5"/>
            <circle cx="160" cy="22" r="5"/>
            <path d="M30 38 L170 38 L130 64 L130 86 L70 86 L70 64 Z"/>
            <line x1="70" y1="64" x2="130" y2="64"/>
            <circle cx="100" cy="86" r="4" fill="{CLAY}" stroke="none"/>
        </svg>''',
        # MOD — node graph (model architecture)
        "MOD": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="22" y="38" width="36" height="24" rx="3"/>
            <rect x="82" y="18" width="36" height="24" rx="3" fill="{CLAY}" stroke="{CLAY}"/>
            <rect x="82" y="58" width="36" height="24" rx="3"/>
            <rect x="142" y="38" width="36" height="24" rx="3"/>
            <line x1="58" y1="50" x2="82" y2="32"/>
            <line x1="58" y1="50" x2="82" y2="68"/>
            <line x1="118" y1="32" x2="142" y2="50"/>
            <line x1="118" y1="68" x2="142" y2="50"/>
        </svg>''',
        # BAU — recurring loop with checkmark
        "BAU": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M70 50 a30 30 0 1 1 30 30" />
            <path d="M70 50 L60 40 M70 50 L80 40"/>
            <circle cx="100" cy="50" r="18" stroke="{CLAY}"/>
            <path d="M91 50 L98 57 L110 44" stroke="{CLAY}" stroke-width="2"/>
        </svg>''',
        # STR — calendar grid + flag (annual strategy)
        "STR": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="40" y="22" width="86" height="64" rx="4"/>
            <line x1="40" y1="36" x2="126" y2="36"/>
            <line x1="61" y1="36" x2="61" y2="86"/>
            <line x1="82" y1="36" x2="82" y2="86"/>
            <line x1="103" y1="36" x2="103" y2="86"/>
            <line x1="40" y1="56" x2="126" y2="56"/>
            <line x1="40" y1="71" x2="126" y2="71"/>
            <rect x="86" y="60" width="14" height="8" fill="{CLAY}" stroke="none"/>
            <line x1="148" y1="22" x2="148" y2="86"/>
            <path d="M148 22 L172 30 L148 38 Z" fill="{CLAY}" stroke="{CLAY}"/>
        </svg>''',
        # ADH — single sheet with paperclip (one-off ask)
        "ADH": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="56" y="18" width="78" height="66" rx="4"/>
            <line x1="68" y1="32" x2="118" y2="32"/>
            <line x1="68" y1="42" x2="108" y2="42"/>
            <line x1="68" y1="52" x2="114" y2="52"/>
            <line x1="68" y1="62" x2="96" y2="62"/>
            <path d="M138 18 a8 8 0 0 1 8 8 v40 a14 14 0 0 1 -28 0 v-32 a8 8 0 0 1 16 0 v32 a4 4 0 0 1 -8 0 v-30"
                  stroke="{CLAY}" stroke-width="1.8"/>
        </svg>''',
    }
    return svgs.get(category, '<span class="glyph-letter">·</span>')


def _thumb_glyph(category: str) -> str:  # back-compat shim
    return _thumb_svg(category)


def _doc_svg(kind: str) -> str:
    """Per-kind line-art illustration for §08–§11 document cards.
    Uses currentColor for strokes; clay/olive for accents.
    """
    CLAY = "#D97757"
    OLIVE = "#788C5D"
    svgs = {
        # §08 Manuals — stacked book / bound document
        "manual": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="54" y="18" width="92" height="66" rx="3"/>
            <line x1="68" y1="18" x2="68" y2="84"/>
            <line x1="76" y1="30" x2="134" y2="30"/>
            <line x1="76" y1="42" x2="126" y2="42"/>
            <line x1="76" y1="54" x2="130" y2="54"/>
            <line x1="76" y1="66" x2="118" y2="66"/>
            <rect x="60" y="22" width="4" height="58" fill="{CLAY}" stroke="none"/>
        </svg>''',
        # §09 deep packs (non-mini-wiki) — folder with documents
        "pack": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M30 30 L70 30 L80 38 L170 38 L170 82 L30 82 Z"/>
            <rect x="60" y="48" width="36" height="28" rx="2" fill="#FAF9F5"/>
            <rect x="104" y="48" width="36" height="28" rx="2" fill="#FAF9F5"/>
            <line x1="66" y1="56" x2="90" y2="56"/>
            <line x1="66" y1="64" x2="86" y2="64"/>
            <line x1="110" y1="56" x2="134" y2="56"/>
            <line x1="110" y1="64" x2="130" y2="64"/>
            <circle cx="152" cy="60" r="3.5" fill="{CLAY}" stroke="none"/>
        </svg>''',
        # §10 Deck — presentation slides
        "deck": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="38" y="20" width="124" height="56" rx="3"/>
            <line x1="38" y1="32" x2="162" y2="32"/>
            <rect x="50" y="42" width="40" height="24" fill="{CLAY}" stroke="none"/>
            <line x1="100" y1="44" x2="150" y2="44"/>
            <line x1="100" y1="52" x2="148" y2="52"/>
            <line x1="100" y1="60" x2="144" y2="60"/>
            <line x1="100" y1="82" x2="100" y2="88"/>
            <line x1="86" y1="88" x2="114" y2="88"/>
        </svg>''',
        # Workbook — spreadsheet grid
        "workbook": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="40" y="20" width="120" height="60" rx="3"/>
            <line x1="40" y1="34" x2="160" y2="34"/>
            <line x1="70" y1="34" x2="70" y2="80"/>
            <line x1="100" y1="34" x2="100" y2="80"/>
            <line x1="130" y1="34" x2="130" y2="80"/>
            <line x1="40" y1="48" x2="160" y2="48"/>
            <line x1="40" y1="62" x2="160" y2="62"/>
            <rect x="40" y="20" width="30" height="14" fill="{CLAY}" stroke="none"/>
        </svg>''',
        # Plan — checklist
        "plan": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="54" y="18" width="92" height="66" rx="3"/>
            <rect x="64" y="30" width="10" height="10" stroke="{OLIVE}"/>
            <path d="M66 35 L69 38 L73 32" stroke="{OLIVE}" stroke-width="1.8"/>
            <line x1="82" y1="36" x2="134" y2="36"/>
            <rect x="64" y="46" width="10" height="10" stroke="{OLIVE}"/>
            <path d="M66 51 L69 54 L73 48" stroke="{OLIVE}" stroke-width="1.8"/>
            <line x1="82" y1="52" x2="128" y2="52"/>
            <rect x="64" y="62" width="10" height="10"/>
            <line x1="82" y1="68" x2="130" y2="68"/>
        </svg>''',
        # Code — angle brackets
        "code": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M76 32 L52 52 L76 72"/>
            <path d="M124 32 L148 52 L124 72"/>
            <line x1="110" y1="26" x2="90" y2="78" stroke="{CLAY}"/>
        </svg>''',
        # Materials — folder
        "materials": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M40 30 L78 30 L88 38 L160 38 L160 82 L40 82 Z"/>
            <line x1="40" y1="46" x2="160" y2="46"/>
            <circle cx="148" cy="62" r="4" fill="{CLAY}" stroke="none"/>
        </svg>''',
        # §11 task — wrench
        "task": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M62 76 L110 28 a14 14 0 1 1 -8 -8 L52 70 a8 8 0 1 0 10 6 z"/>
            <circle cx="110" cy="30" r="3" fill="{CLAY}" stroke="none"/>
        </svg>''',
        # §11 reference — bookmark
        "reference": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="54" y="18" width="92" height="66" rx="3"/>
            <path d="M118 18 L118 56 L128 48 L138 56 L138 18" fill="{CLAY}" stroke="{CLAY}"/>
            <line x1="66" y1="34" x2="108" y2="34"/>
            <line x1="66" y1="46" x2="100" y2="46"/>
            <line x1="66" y1="58" x2="108" y2="58"/>
            <line x1="66" y1="70" x2="94" y2="70"/>
        </svg>''',
        # §08 video — monitor with play triangle
        "video": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="42" y="18" width="116" height="64" rx="4"/>
            <line x1="82" y1="90" x2="118" y2="90" stroke-linecap="round"/>
            <line x1="100" y1="82" x2="100" y2="90"/>
            <path d="M90 38 L90 62 L116 50 Z" fill="{CLAY}" stroke="{CLAY}" stroke-linejoin="round"/>
        </svg>''',
        # §08 html — mini-wiki page (browser window with content lines)
        "html": f'''<svg viewBox="0 0 200 100" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="38" y="18" width="124" height="64" rx="4"/>
            <line x1="38" y1="32" x2="162" y2="32"/>
            <circle cx="46" cy="25" r="1.8" fill="{CLAY}" stroke="none"/>
            <circle cx="53" cy="25" r="1.8" fill="{OLIVE}" stroke="none"/>
            <circle cx="60" cy="25" r="1.8" stroke="currentColor"/>
            <rect x="68" y="22" width="86" height="6" rx="1.2" stroke="currentColor"/>
            <rect x="48" y="42" width="32" height="32" rx="1.5" fill="{CLAY}" stroke="none" opacity="0.85"/>
            <line x1="88" y1="46" x2="152" y2="46"/>
            <line x1="88" y1="54" x2="146" y2="54"/>
            <line x1="88" y1="62" x2="150" y2="62"/>
            <line x1="88" y1="70" x2="138" y2="70"/>
        </svg>''',
    }
    return svgs.get(kind, '<span class="glyph-letter">¶</span>')


# Buckets with a standalone mini-wiki — any category, file or http(s):// URL.
# Each bucket's hero card becomes a whole-card link to mini_wikis[bid].file.
# Populated at runtime by load_inventory() from inventory.json:mini_wikis.
_LEGACY_MINI_WIKIS_PLACEHOLDER = {
    # left in source as documentation of the expected shape; actual values come
    # from inventory.json. Editing here has no effect.
}


def render_card(b: dict) -> str:
    bid = str(b.get("Bucket ID") or b.get("ID") or "")
    name = str(b.get("Name") or b.get("Title") or "")
    status = str(b.get("Status") or "")
    tier = str(b.get("Tier") or "")
    year = b.get("Year") or ""
    purpose = str(b.get("Purpose") or b.get("Purpose (short)") or b.get("Notes") or "")
    repo_field = str(b.get("Repo link") or b.get("Source folder") or "")

    gh_pairs = gh_links_from_field(repo_field)
    sp_label, sp_url = sp_link_for_bucket(bid, year)

    glyph = _thumb_glyph(bid.split("-")[0])

    # Whole-card jump: any bucket with a mini_wikis[bid] entry opens that
    # target. The target may be a local *.html filename OR a full http(s)://
    # URL — the browser handles both natively; the click handler routes
    # external URLs to a new tab.
    mini_wiki_def = MINI_WIKIS.get(bid)
    pack_href = mini_wiki_def[0] if mini_wiki_def else ""
    is_card_link = bool(mini_wiki_def)

    # External-link affordance: open URL targets in a new tab.
    is_external = bool(pack_href) and (pack_href.startswith("http://") or pack_href.startswith("https://"))
    cta_attrs = ' target="_blank" rel="noopener"' if is_external else ""

    links = []
    if is_card_link:
        # Unified primary CTA — "Deep pack ↓" for every bucket that has a
        # mini-wiki / URL target.
        links.append(
            f'<a class="cta" href="{esc(pack_href)}"{cta_attrs}>Deep pack \u2193</a>'
        )
    if gh_pairs:
        primary = gh_pairs[0]
        links.append(f'<a class="gh" href="{esc(primary[1])}" target="_blank" rel="noopener" title="{esc(primary[0])}">{esc(primary[0])}</a>')
        if len(gh_pairs) > 1:
            links.append(f'<span style="color:var(--g500)">+{len(gh_pairs)-1} more</span>')
    if sp_url:
        links.append(f'<a class="sp" href="{esc(sp_url)}" target="_blank" rel="noopener">{esc(sp_label)}</a>')
    links_html = "".join(links) or '<span style="color:var(--g500)">no external link</span>'

    status_class = "s-" + status.replace(" ", "-")
    tier_class = "t-" + tier
    search_blob = " ".join([bid, name, purpose, status, tier, str(year), repo_field]).lower()

    is_retired = status.startswith("Retired")

    tags = []
    # Retired cards drop the tier tag — once a bucket is archived its P0/P1
    # priority is historical noise, not "needs attention now". The status tag
    # alone carries the meaning.
    if tier and not is_retired:
        tags.append(f'<span class="tag {tier_class}">{esc(tier)}</span>')
    if status:
        tags.append(f'<span class="tag {status_class}">{esc(status)}</span>')

    # Variant selector — only P0+Active gets the accent stripe ("needs attention now").
    # Retired cards never accent, regardless of historical tier.
    variant = "accent" if (tier == "P0" and status == "Active") else "outlined"

    # Caption-style meta row (UPDATED · OWNER · STATUS) — only when we have data.
    owner = str(b.get("Owner") or b.get("Lead") or "").strip()
    updated = str(b.get("Last touch") or b.get("Last-Touch") or b.get("Last update") or "").strip()
    meta_bits = []
    if year:    meta_bits.append(f'<span>{esc(str(year))}</span>')
    if updated: meta_bits.append(f'<span>updated {esc(updated)}</span>')
    if owner:   meta_bits.append(f'<span>{esc(owner)}</span>')
    meta_html = (f'<div class="meta-row">{"".join(meta_bits)}</div>' if meta_bits else "")

    # Buckets with a mini_wikis entry become whole-card links (delegated
    # click handler navigates to data-card-href; inner <a> still works).
    if is_card_link:
        aria = "open deep pack"
        return f'''
    <div class="card card-link" id="b-{esc(bid)}" data-row="bucket" data-variant="{variant}"
         data-bucket-id="{esc(bid)}"
         data-card-href="{esc(pack_href)}" tabindex="0" role="link"
         aria-label="{esc(name)} \u2013 {aria}"
         data-tier="{esc(tier)}" data-status="{esc(status)}" data-year="{esc(str(year))}"
         data-search="{esc(search_blob)}">
      <span class="drag-handle" draggable="true" title="Drag to reorder · Alt+\u2191/\u2193 with focus" aria-hidden="true"><svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><circle cx="3" cy="2" r="1.2"/><circle cx="9" cy="2" r="1.2"/><circle cx="3" cy="6" r="1.2"/><circle cx="9" cy="6" r="1.2"/><circle cx="3" cy="10" r="1.2"/><circle cx="9" cy="10" r="1.2"/></svg></span>
      <div class="thumb">
        <span class="thumb-id">{esc(bid)}</span>
        <span class="thumb-tags">{"".join(tags)}</span>
        <span class="thumb-icon">{glyph}</span>
      </div>
      <div class="body">
        <div class="title">{esc(name)}</div>
        {meta_html}
        <div class="desc">{esc(purpose)}</div>
        <div class="links">{links_html}</div>
      </div>
    </div>'''

    return f'''
    <article class="card" id="b-{esc(bid)}" data-row="bucket" data-variant="{variant}"
             data-bucket-id="{esc(bid)}" tabindex="0"
             data-tier="{esc(tier)}" data-status="{esc(status)}" data-year="{esc(str(year))}"
             data-search="{esc(search_blob)}">
      <span class="drag-handle" draggable="true" title="Drag to reorder · Alt+↑/↓ with focus" aria-hidden="true"><svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><circle cx="3" cy="2" r="1.2"/><circle cx="9" cy="2" r="1.2"/><circle cx="3" cy="6" r="1.2"/><circle cx="9" cy="6" r="1.2"/><circle cx="3" cy="10" r="1.2"/><circle cx="9" cy="10" r="1.2"/></svg></span>
      <div class="thumb">
        <span class="thumb-id">{esc(bid)}</span>
        <span class="thumb-tags">{"".join(tags)}</span>
        <span class="thumb-icon">{glyph}</span>
      </div>
      <div class="body">
        <div class="title">{esc(name)}</div>
        {meta_html}
        <div class="desc">{esc(purpose)}</div>
        <div class="links">{links_html}</div>
      </div>
    </article>'''


def render_section_cards(idx: str, anchor: str, title: str, kicker: str, rows: list[dict]) -> str:
    cards = "\n".join(render_card(r) for r in rows)
    return f'''
<section id="{anchor}">
  <div class="sec-head">
    <span class="idx">{idx}</span>
    <h2>{esc(title)}</h2>
    <span class="count">{len(rows)}</span>
    <button class="reset-order" data-section="{anchor}" title="Reset card order to default (this view only)" aria-label="Reset card order">↻</button>
  </div>
  <p class="sec-intro">{esc(kicker)}</p>
  <div class="grid" data-section="{anchor}">{cards}</div>
</section>'''


# Plural labels for the Archive sub-headers — keyed by the singular `Category`
# value stored on each bucket. New categories that ever land in inventory.json
# will automatically appear as their own sub-group (fallback: f"{cat}s").
_ARCHIVE_CAT_LABEL = {
    "Project":  "Projects",
    "Campaign": "Campaigns",
    "Model":    "Models",
    "BAU":      "BAU procedures",
    "Strategy": "Strategy",
    "Adhoc":    "Adhoc",
}
# Display order — natural reading order, mirrors the live sections above.
_ARCHIVE_CAT_ORDER = ["Project", "Campaign", "Model", "BAU", "Strategy", "Adhoc"]


def render_archive_section(idx: str, rows: list[dict]) -> str:
    """Render the Archive section — retired buckets in collapsible category
    tables, newest year first within each block.

    Mirrors the `.yr-block` + `.tab` pattern from render_adhoc_table /
    render_xref so the wiki has one consistent "look something up" visual
    language. Each `<tr>` carries `id="b-{bid}"` so sidebar deep-links still
    scroll directly to the bucket row.
    """
    if not rows:
        return ""

    from collections import defaultdict
    by_cat = defaultdict(list)
    for r in rows:
        cat = str(r.get("Category") or "").strip() or "Other"
        by_cat[cat].append(r)

    # Stable, predictable order: known categories first in the canonical
    # sequence, then any new/unknown ones alphabetically.
    known = [c for c in _ARCHIVE_CAT_ORDER if c in by_cat]
    extras = sorted(c for c in by_cat if c not in _ARCHIVE_CAT_ORDER)
    cat_order = known + extras

    def _yr(r):
        try:
            return int(r.get("Year") or 0)
        except (TypeError, ValueError):
            return 0

    blocks = []
    for cat in cat_order:
        body_rows = []
        for r in sorted(by_cat[cat], key=_yr, reverse=True):
            bid = str(r.get("Bucket ID") or "")
            name = str(r.get("Name") or "")
            year = str(r.get("Year") or "")
            purpose = str(r.get("Purpose") or "")
            repo_field = str(r.get("Repo link") or "")
            search_blob = " ".join(
                [bid, name, purpose, "Retired", str(year), repo_field]
            ).lower()

            # Inline link cluster — deep-pack (if any) · gh · sp.
            link_bits = []
            mw = MINI_WIKIS.get(bid)
            if mw:
                mw_file, mw_label = mw
                ext = mw_file.lower().startswith(("http://", "https://"))
                tgt = ' target="_blank" rel="noopener"' if ext else ''
                link_bits.append(
                    f'<a class="ar-link ar-pack" href="{esc(mw_file)}"{tgt} '
                    f'title="{esc(mw_label)}">deep pack \u2193</a>'
                )
            gh_pairs = gh_links_from_field(repo_field)
            if gh_pairs:
                _, gh_url = gh_pairs[0]
                extra = (f' <span class="ar-link-more">+{len(gh_pairs)-1}</span>'
                         if len(gh_pairs) > 1 else "")
                link_bits.append(
                    f'<a class="ar-link" href="{esc(gh_url)}" target="_blank" '
                    f'rel="noopener" title="GitHub repo">gh \u2197</a>{extra}'
                )
            try:
                year_int = int(year) if str(year).isdigit() else None
            except ValueError:
                year_int = None
            sp_label, sp_url = sp_link_for_bucket(bid, year_int)
            if sp_url:
                link_bits.append(
                    f'<a class="ar-link" href="{esc(sp_url)}" target="_blank" '
                    f'rel="noopener" title="{esc(sp_label)}">sp \u2197</a>'
                )
            links_html = "".join(link_bits) or '<span class="ar-link-none">—</span>'

            body_rows.append(f'''<tr id="b-{esc(bid)}" data-row="archive"
                data-bucket-id="{esc(bid)}"
                data-tier="" data-status="Retired" data-year="{esc(str(year))}"
                data-search="{esc(search_blob)}">
              <td class="mono">{esc(bid)}</td>
              <td class="mono">{esc(year)}</td>
              <td>{esc(name)}</td>
              <td class="ar-purpose">{esc(purpose)}</td>
              <td class="ar-links">{links_html}</td>
            </tr>''')

        label = _ARCHIVE_CAT_LABEL.get(cat, f"{cat}s")
        blocks.append(f'''
  <div class="yr-block" data-yr="archive-{esc(cat.lower())}">
    <div class="yr-head">
      <span class="yr-tog">+</span>
      <span class="yr-label">{esc(label)}</span>
      <span class="yr-count">{len(by_cat[cat])}</span>
    </div>
    <div class="yr-body"><table class="tab">
      <thead><tr>
        <th>ID</th><th>Year</th><th>Name</th><th>Purpose</th><th>Links</th>
      </tr></thead>
      <tbody>{"".join(body_rows)}</tbody>
    </table></div>
  </div>''')

    return f'''
<section id="archive" class="archive-section">
  <div class="sec-head">
    <span class="idx">{idx}</span>
    <h2>Archive</h2>
    <span class="count">{len(rows)}</span>
  </div>
  <p class="sec-intro">Retired projects and campaigns — kept on the wiki so the
    institutional memory stays searchable. Click each category to expand;
    deep-pack links open the historical handover material.</p>
  <div class="tab-wrap">{"".join(blocks)}</div>
</section>'''


def render_adhoc_table(idx: str, rows: list[dict]) -> str:
    # group rows by year (extracted from ID prefix ADH-YYYY-...)
    from collections import defaultdict
    by_year = defaultdict(list)
    for r in rows:
        rid = str(r.get("ID") or "")
        yr = rid[4:8] if rid.startswith("ADH-") and len(rid) >= 8 else ""
        by_year[yr].append(r)

    blocks = []
    # newest year first
    for yr in sorted(by_year.keys(), reverse=True):
        body_rows = []
        for r in by_year[yr]:
            rid = str(r.get("ID") or "")
            ltouch = str(r.get("Last-Touch") or "")
            domain = str(r.get("Domain") or "")
            title = str(r.get("Title") or "")
            src = str(r.get("Source folder") or "")
            typ = str(r.get("Type") or "")
            status = str(r.get("Status") or "")
            notes = str(r.get("Notes") or "")
            sp_label, sp_url = sp_link_from_source_folder(src)
            sp_cell = (f'<a href="{esc(sp_url)}" target="_blank" rel="noopener">'
                       f'<span class="mono">{esc(sp_label)}</span></a>'
                       if sp_url else f'<span class="mono">{esc(src)}</span>')
            search_blob = " ".join([rid, ltouch, domain, title, src, typ, status, notes]).lower()
            mw = MINI_WIKIS.get(rid)
            if mw:
                _mw_file, _mw_label = mw
                _ext = bool(_mw_file.lower().startswith(("http://", "https://")))
                _target = ' target="_blank" rel="noopener"' if _ext else ''
                mw_link = (f' <a href="{esc(_mw_file)}"{_target} '
                           f'style="font-size:11px;color:var(--accent);text-decoration:none;'
                           f'border:1px solid var(--accent);padding:1px 6px;border-radius:10px;'
                           f'margin-left:6px;white-space:nowrap" '
                           f'title="{esc(_mw_label)}">deep pack \u2193</a>')
            else:
                mw_link = ""
            body_rows.append(f'''<tr data-row="adhoc"
                  data-tier="" data-status="{esc(status)}" data-year="{esc(yr)}"
                  data-search="{esc(search_blob)}">
                <td class="mono">{esc(rid)}</td>
                <td class="mono">{esc(ltouch)}</td>
                <td>{esc(domain)}</td>
                <td>{esc(title)}{mw_link}<div style="font-size:11.5px;color:var(--g500);margin-top:2px">{esc(notes)}</div></td>
                <td>{sp_cell}</td>
                <td><span class="tag s-{esc(status)}">{esc(status)}</span></td>
              </tr>''')
        is_open = (yr == sorted(by_year.keys(), reverse=True)[0])  # newest open by default
        klass = "yr-block open" if is_open else "yr-block"
        tog = "−" if is_open else "+"
        blocks.append(f'''
  <div class="{klass}" data-yr="{esc(yr)}">
    <div class="yr-head">
      <span class="yr-tog">{tog}</span>
      <span class="yr-label">{esc(yr or "(undated)")}</span>
      <span class="yr-count">{len(by_year[yr])}</span>
    </div>
    <div class="yr-body"><table class="tab">
      <thead><tr>
        <th>ID</th><th>Last touch</th><th>Domain</th><th>Title</th>
        <th>SharePoint folder</th><th>Status</th>
      </tr></thead>
      <tbody>{"".join(body_rows)}</tbody>
    </table></div>
  </div>''')

    return f'''
<section id="adhoc">
  <div class="sec-head">
    <span class="idx">{idx}</span>
    <h2>Adhoc log</h2>
    <span class="count">{len(rows)}</span>
  </div>
  <p class="sec-intro">Sixty-odd one-off deliverables, grouped by year. Click each year to expand.
    Source-folder links resolve directly into SharePoint.</p>
  <div class="tab-wrap">{"".join(blocks)}</div>
</section>'''


def render_open_items(idx: str, rows: list[dict]) -> str:
    body = []
    for r in rows:
        sev = str(r.get("Severity") or "")
        bucket = str(r.get("Bucket") or "")
        item = str(r.get("Open item") or "")
        action = str(r.get("First action") or "")
        body.append(f'''<tr data-row="openitem" data-tier="{esc(sev)}" data-status="" data-year=""
            data-search="{esc((sev+' '+bucket+' '+item+' '+action).lower())}">
          <td><span class="sev {esc(sev)}">{esc(sev)}</span></td>
          <td class="mono">{esc(bucket)}</td>
          <td>{esc(item)}</td>
          <td>{esc(action)}</td>
        </tr>''')
    return f'''
<section id="openitems">
  <div class="sec-head">
    <span class="idx">{idx}</span>
    <h2>Open items &amp; risks</h2>
    <span class="count">{len(rows)}</span>
  </div>
  <p class="sec-intro">P0 to be closed in the first 30 days · P1 inside 90 days · P2 housekeeping.</p>
  <div class="tab-wrap"><table class="tab">
    <thead><tr><th>Sev</th><th>Bucket</th><th>Open item</th><th>First action</th></tr></thead>
    <tbody>{''.join(body)}</tbody>
  </table></div>
</section>'''


def render_xref(idx: str, buckets: list[dict]) -> str:
    """Derive the repo-map directly from buckets[].repo_link + buckets[].repo_role.
    No hand-maintained cross_refs table — one source of truth."""
    from collections import defaultdict
    # repo_path -> list of (bucket_id, role)
    repo_to_buckets: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for b in buckets:
        link = (b.get("Repo link") or "").strip()
        if not link:
            continue
        bid = (b.get("Bucket ID") or "").strip()
        role = (b.get("Repo role") or "").strip()
        # Split comma/semicolon-separated paths; each one gets its own row.
        for p in (s.strip().rstrip("/") for s in link.replace(";", ",").split(",")):
            if p:
                repo_to_buckets[p + "/"].append((bid, role))

    # group by top-level repo segment (e.g. "campaigns/...")
    groups: dict[str, list[tuple[str, list[tuple[str, str]]]]] = defaultdict(list)
    for repo, bids in sorted(repo_to_buckets.items()):
        parent = repo.lstrip("/").split("/", 1)[0] or "(other)"
        groups[parent].append((repo, bids))

    total_rows = sum(len(v) for v in groups.values())
    blocks = []
    for parent in sorted(groups.keys()):
        body_rows = []
        for repo, bids in groups[parent]:
            first = repo.rstrip("/")
            url = gh_link(first) if first else ""
            repo_cell = (f'<a class="mono" href="{esc(url)}" target="_blank" rel="noopener">{esc(repo)}</a>'
                         if url else f'<span class="mono" style="color:var(--g500)">{esc(repo)}</span>')
            # Render bucket IDs with optional (role) suffix; multiple buckets joined with "; ".
            bucket_chips = "; ".join(
                (f'{esc(bid)} <span style="color:var(--g500)">({esc(role)})</span>' if role else esc(bid))
                for bid, role in bids
            )
            search_blob = (repo + " " + " ".join(b for b, _ in bids) + " " + " ".join(r for _, r in bids if r)).lower()
            body_rows.append(f'''<tr data-row="xref" data-tier="" data-status="" data-year=""
                data-search="{esc(search_blob)}">
              <td>{repo_cell}</td>
              <td><span class="mono" style="color:var(--g700)">{bucket_chips}</span></td>
            </tr>''')
        parent_url = gh_link(parent)
        parent_label = (f'<a href="{esc(parent_url)}" target="_blank" rel="noopener" '
                        f'style="color:inherit;border:none;text-decoration:none">{esc(parent)}/</a>'
                        if parent_url else esc(parent))
        blocks.append(f'''
  <div class="yr-block" data-yr="">
    <div class="yr-head">
      <span class="yr-tog">+</span>
      <span class="yr-label">{parent_label}</span>
      <span class="yr-count">{len(groups[parent])}</span>
    </div>
    <div class="yr-body"><table class="tab">
      <thead><tr><th>Repo path</th><th>Bucket(s)</th></tr></thead>
      <tbody>{"".join(body_rows)}</tbody>
    </table></div>
  </div>''')

    return f'''
<section id="crossrefs">
  <div class="sec-head">
    <span class="idx">{idx}</span>
    <h2>Repo ↔ bucket map</h2>
    <span class="count">{total_rows}</span>
  </div>
  <p class="sec-intro">Where to look in the codebase for each bucket, grouped by top-level repo folder.
    Click each parent to expand. Sub-folder rows link straight to GitHub.
    <em style="color:var(--g500)">Auto-derived from each bucket’s <code>repo_link</code> — edit there, not here.</em></p>
  <div class="tab-wrap">{"".join(blocks)}</div>
</section>'''


def render_doc_card(label: str, title: str, desc: str, links: list[tuple[str, str]],
                    elem_id: str = "", kind: str = "", drag_id: str = "") -> str:
    link_html = " · ".join(
        f'<a href="{esc(u)}" target="_blank" rel="noopener">{esc(t)}</a>' for t, u in links if u
    )
    id_attr = f' id="{esc(elem_id)}"' if elem_id else ""
    icon = _doc_svg(kind) if kind else '<span class="glyph-letter">¶</span>'
    drag_attrs = f' data-bucket-id="{esc(drag_id)}" tabindex="0"' if drag_id else ""
    drag_handle = ('<span class="drag-handle" draggable="true" '
                   'title="Drag to reorder · Alt+\u2191/\u2193 with focus" aria-hidden="true">'
                   '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">'
                   '<circle cx="3" cy="2" r="1.2"/><circle cx="9" cy="2" r="1.2"/>'
                   '<circle cx="3" cy="6" r="1.2"/><circle cx="9" cy="6" r="1.2"/>'
                   '<circle cx="3" cy="10" r="1.2"/><circle cx="9" cy="10" r="1.2"/>'
                   '</svg></span>'
                   if drag_id else "")
    return f'''
    <article class="card"{id_attr}{drag_attrs}>
      {drag_handle}
      <div class="thumb">
        <span class="thumb-id">{esc(label)}</span>
        <span class="thumb-icon">{icon}</span>
      </div>
      <div class="body">
        <div class="title">{esc(title)}</div>
        <div class="desc">{esc(desc)}</div>
        <div class="links">{link_html}</div>
      </div>
    </article>'''


def render_doc_card_link(label: str, title: str, desc: str,
                         href: str, links: list[tuple[str, str]],
                         badge: str = "", elem_id: str = "", kind: str = "") -> str:
    """Card whose entire surface navigates to `href` (sibling HTML page).

    Implemented as a <div> (NOT <a>) because HTML5 parsers split nested
    <a> elements into siblings — wrapping the card in <a> breaks layout
    when secondary <a> links appear inside. The whole-card click is wired
    via a `data-card-href` attribute and a delegated click handler in the
    page-level script (`document.addEventListener('click', …)`).
    """
    inner = []
    for t, u in links:
        if not u:
            continue
        is_primary = (u == href)
        cls = ' class="cta"' if is_primary else ''
        target = '' if is_primary else ' target="_blank" rel="noopener"'
        inner.append(f'<a href="{esc(u)}"{cls}{target}>{esc(t)}</a>')
    link_html = " · ".join(inner)
    badge_html = (
        f'<span class="card-badge">{esc(badge)}</span>'
        if badge else f'<span class="thumb-icon">{_doc_svg(kind) if kind else chr(0x2192)}</span>'
    )
    id_attr = f' id="{esc(elem_id)}"' if elem_id else ""
    return f'''
    <div class="card card-link"{id_attr} data-card-href="{esc(href)}" tabindex="0"
         role="link" aria-label="{esc(title)}">
      <div class="thumb">
        <span class="thumb-id">{esc(label)}</span>
        {badge_html}
      </div>
      <div class="body">
        <div class="title">{esc(title)}</div>
        <div class="desc">{esc(desc)}</div>
        <div class="links">{link_html}</div>
      </div>
    </div>'''


def _resolve_manual_href(item: dict) -> tuple[str, str]:
    """Return (href, display_label) for a manuals[] entry.

    Resolution order:
      1. `url`   — if it starts with http(s)://, used as-is.
      2. `file`  — if it contains a slash, used as-is (relative or absolute path).
      3. `file`  — otherwise used as-is (sibling of index.html, i.e. repo root).
    Display label is always the basename of the file (or the title if no file).
    """
    url = (item.get("url") or "").strip()
    fil = (item.get("file") or "").strip()
    if url.lower().startswith(("http://", "https://")):
        href = url
    elif fil:
        href = fil
    else:
        href = "#"
    label = fil.rsplit("/", 1)[-1].rsplit("\\", 1)[-1] or (item.get("title") or "")
    return href, label


_VIDEO_EXT = (".mp4", ".webm", ".mov", ".m4v", ".ogv")
_DOC_EXT_MAP = {
    ".pdf":  "pdf",
    ".doc":  "manual", ".docx": "manual",
    ".xls":  "workbook", ".xlsx": "workbook", ".csv": "workbook",
    ".ppt":  "deck", ".pptx": "deck",
    ".html": "html", ".htm": "html",
}

def _detect_kind(item: dict, href: str) -> str:
    """Infer doc kind from explicit `kind`, then URL/file extension.

    Recognises video extensions (mp4/webm/mov/m4v/ogv) and SharePoint Stream
    `/_layouts/15/stream.aspx` URLs as kind='video'. Falls back to 'manual'.
    """
    explicit = str(item.get("kind") or "").strip().lower()
    if explicit:
        return explicit
    h = (href or "").lower()
    if h.endswith(_VIDEO_EXT) or "/stream.aspx" in h or "/_layouts/15/stream.aspx" in h:
        return "video"
    for ext, kind in _DOC_EXT_MAP.items():
        if h.endswith(ext) or h.endswith(ext + "?") or (ext + "?") in h:
            return kind
    fil = (item.get("file") or "").lower()
    if fil.endswith(_VIDEO_EXT):
        return "video"
    for ext, kind in _DOC_EXT_MAP.items():
        if fil.endswith(ext):
            return kind
    return "manual"


def render_manuals(idx: str, manuals: list[dict]) -> str:
    """§ Manuals — team-document reading list. Skipped entirely when empty."""
    if not manuals:
        return ""
    cards = []
    for i, item in enumerate(manuals):
        href, label = _resolve_manual_href(item)
        title = item.get("title") or item.get("id") or label or f"Manual {i+1:02d}"
        desc  = item.get("desc")  or ""
        mid   = item.get("id") or f"manual-{i+1:02d}"
        kind  = _detect_kind(item, href)
        # Display label: pretty for video, basename otherwise.
        link_label = ("▶ Watch video" if kind == "video" else label) or title
        cards.append(
            render_doc_card(
                item.get("id") or f"Manual {i+1:02d}",
                title, desc,
                [(link_label, href)] if href and href != "#" else [],
                kind=kind,
                drag_id=mid,
            )
        )
    return f'''
<section id="manuals">
  <div class="sec-head">
    <span class="idx">{idx}</span>
    <h2>Manuals</h2>
    <span class="count">{len(manuals)}</span>
    <button class="reset-order" data-section="manuals" title="Reset card order to default (this view only)" aria-label="Reset card order">↻</button>
  </div>
  <p class="sec-intro">Team-document reading list — onboarding guides, playbooks, procedures.
    Files resolve to the wiki root (sibling of <code>index.html</code>) by default;
    paths with a slash and full URLs are used as-is.</p>
  <div class="grid" data-section="manuals">{"".join(cards)}</div>
</section>'''


def render_walkthrough_and_refs(idx: str) -> str:
    """§10 — single hero card linking to the 00_WALKTHROUGH.html mini-wiki.

    The walkthrough page is a hand-edited mini-wiki that explains how to
    read, maintain and fork the main wiki, with animated SVG illustrations.
    The original five reference roots (deck / workbook / plan / repo /
    SharePoint) all live inside that page now — no need to duplicate them
    on the main index.
    """
    card = render_doc_card(
        "Walkthrough", "Tour the wiki · learn to maintain · fork for your team",
        "A guided, illustrated mini-wiki — what every section means, how the "
        "filter chips work, how to add a row through the local admin, and how "
        "to stand up an AI Wiki for your own team in five steps. "
        "Reading time ~6 minutes. Animated SVG diagrams throughout.",
        [("Open the walkthrough →", "00_WALKTHROUGH.html"),
         ("MAINTENANCE.md",          "MAINTENANCE.md"),
         ("CHANGELOG.md",            "CHANGELOG.md")],
        kind="deck")
    return f'''
<section id="references">
  <div class="sec-head">
    <span class="idx">{idx}</span>
    <h2>Walkthrough &amp; references</h2>
  </div>
  <p class="sec-intro">First time here? Start with the walkthrough — it explains how to read this page,
    how to maintain it, and how to fork it for your team. All the canonical reference roots
    (deck, workbook, plan, repo, SharePoint) live inside that page.</p>
  <div class="grid single">{card}</div>
</section>'''




def render_maintenance(idx: str) -> str:
    """§11 — short pointer to the admin.html flow + MAINTENANCE.md reference."""
    maint_url = GH_BLOB + "handovers/MAINTENANCE.md"
    chlog_url = GH_BLOB + "handovers/CHANGELOG.md"

    cards = [
        render_doc_card(
            "Task 01", "Edit inventory",
            "Add, retire, or update a bucket / adhoc via the local admin page "
            "(run `python handovers/serve_admin.py`, then open "
            "localhost:8765/admin.html). Six category tabs, soft-delete on "
            "retire, .bak rotation on save.",
            [("Launch admin", "http://localhost:8765/admin.html"),
             ("How-to →", maint_url + "#edit")], kind="task"),
        render_doc_card(
            "Task 02", "Rebuild wiki",
            "Run `python handovers/scripts/rebuild_wiki.py` — reads "
            "inventory.json, regenerates the xlsx artifact, and renders "
            "this page.",
            [("How-to →", maint_url + "#rebuild")], kind="task"),
        render_doc_card(
            "Reference", "MAINTENANCE.md",
            "Full workflow with allowed values, ID conventions, cadence "
            "and a troubleshooting table.",
            [("Open on GitHub", maint_url)], kind="reference"),
        render_doc_card(
            "Reference", "CHANGELOG.md",
            "Append a one-line entry on every rebuild. Newest at the top.",
            [("Open on GitHub", chlog_url)], kind="reference"),
    ]
    return f'''
<section id="maintenance">
  <div class="sec-head">
    <span class="idx">{idx}</span>
    <h2>Maintenance</h2>
    <span class="count">{len(cards)}</span>
  </div>
  <p class="sec-intro">The Tier / Status / Year chips at the top of the page <em>filter</em> the
    cards — they don't edit anything. To actually change a status, add an adhoc or retire a bucket,
    launch the local admin tool. The single source of truth is
    <code>handovers/inventory.json</code>; one command rebuilds the wiki.</p>
  <div class="grid">{''.join(cards)}</div>
</section>'''


# ---------------------------------------------------------------------------
def render_anatomy(idx: str) -> str:
    """§00 wiki anatomy diagram — monoline SVG with stroke-dashoffset draw-on."""
    svg = '''<svg viewBox="0 0 760 220" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="arr" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0 0 L8 4 L0 8 z" fill="#141413"/>
    </marker>
  </defs>
  <g class="draw" stroke="#141413" stroke-width="1.4" fill="none">
    <rect x="20"  y="60" width="130" height="100" rx="10"/>
    <rect x="200" y="60" width="130" height="100" rx="10"/>
    <rect x="380" y="60" width="130" height="100" rx="10"/>
    <rect x="560" y="60" width="180" height="100" rx="10" stroke="#D97757" stroke-width="1.8"/>
    <line x1="150" y1="110" x2="196" y2="110" marker-end="url(#arr)"/>
    <line x1="330" y1="110" x2="376" y2="110" marker-end="url(#arr)"/>
    <line x1="510" y1="110" x2="556" y2="110" marker-end="url(#arr)"/>
  </g>
  <g>
    <text x="35"  y="52">SOURCE</text>
    <text class="t" x="35"  y="100">inventory.json</text>
    <text x="35"  y="120">single source of truth</text>
    <text x="35"  y="138">~40 buckets + 60 adhoc</text>

    <text x="215" y="52">EDIT</text>
    <text class="t" x="215" y="100">admin.html</text>
    <text x="215" y="120">6 tabs · soft-delete</text>
    <text x="215" y="138">writes inventory.json</text>

    <text x="395" y="52">RENDER</text>
    <text class="t" x="395" y="100">step11 → html</text>
    <text x="395" y="120">single-file portable</text>
    <text x="395" y="138">tokens + variants + motion</text>

    <text x="575" y="52" fill="#D97757">PUBLISH</text>
    <text class="t" x="575" y="100">index.html + 7 mini-wikis</text>
    <text x="575" y="120">GitHub Pages · same-origin</text>
    <text x="575" y="138">prj_narrative.json sidecar</text>
  </g>
</svg>'''
    return f'''
<section id="anatomy">
  <div class="sec-head">
    <span class="idx">{idx}</span>
    <h2>Wiki anatomy</h2>
  </div>
  <p class="sec-intro">Source → build → render → publish. The Python script
    you're maintaining only touches the middle two stages; narrative tweaks land
    in the JSON sidecar without a rebuild.</p>
  <div class="anatomy">{svg}</div>
</section>'''


def render_components(idx: str) -> str:
    """Living style-guide — color tokens, type scale, card variants."""
    swatches = []
    for tok, hx, lab in [
        ("--clay", "#D97757", "primary accent"),
        ("--slate", "#141413", "text · strong border"),
        ("--ivory", "#FAF9F5", "page background"),
        ("--oat", "#E3DACC", "secondary surface"),
        ("--olive", "#788C5D", "success / Active"),
        ("--mauve", "#7A6E8A", "diagram zone"),
        ("--warning", "#C78E3F", "warning"),
        ("--danger", "#B04A4A", "danger"),
    ]:
        swatches.append(f'''<div class="cg-swatch"><div class="sw" style="background:{hx}"></div>'''
            f'''<div class="lab"><b>{esc(tok)}</b><span>{esc(hx)} · {esc(lab)}</span></div></div>''')
    swatch_html = "".join(swatches)

    type_specimens = []
    for size, lh, wt, lab in [
        ("32px", "1.2", "500", "H1 · serif"),
        ("24px", "1.3", "500", "H2 · serif"),
        ("16px", "1.55", "430", "Body · sans"),
        ("12px", "1.4", "500", "Caption · mono · uppercase"),
    ]:
        type_specimens.append(
            f'<div class="specimen" style="font-size:{size};line-height:{lh};font-weight:{wt}">'
            f'Team Wiki</div>'
            f'<div class="meta">{esc(lab)} · {esc(size)}</div>')
    type_html = "".join(type_specimens)

    variants = [
        ("outlined", "", "Default", "Most cards. Quiet, scans fast.", "All inventory rows by default."),
        ("accent",   "accent", "Accent stripe", "3px clay left border.", "Auto-applied to Tier=P0 or Status=Active."),
        ("elevated", "elevated", "Elevated", "Soft shadow, no stripe.", "Mini-wiki deep-pack cards."),
        ("inset",    "",        "Document", "¶ glyph in thumb.", "§08 Manuals, §10 Reference roots."),
    ]
    var_html = "".join(
        f'<div class="cg-mini {cls}"><div class="vlab">{esc(lab)}</div>'
        f'<div class="vt">Lapse Model v3</div>'
        f'<div class="vd">{esc(desc)}</div>'
        f'<div class="vbest">best for: {esc(best)}</div></div>'
        for _, cls, lab, desc, best in variants
    )

    return f'''
<section id="components">
  <div class="sec-head">
    <span class="idx">{idx}</span>
    <h2>Components &amp; tokens</h2>
    <span class="count">style-guide</span>
  </div>
  <p class="sec-intro">Living spec for the wiki design system — the palette,
    type scale and card variants used throughout. Edit
    <code>HTML_TEMPLATE</code> in <code>step11_build_wiki.py</code> to evolve.</p>
  <div class="cg-grid">
    <div class="cg-block"><h4>Color tokens</h4><div class="cg-swatches">{swatch_html}</div></div>
    <div class="cg-block"><h4>Type scale</h4><div class="cg-type">{type_html}</div></div>
    <div class="cg-block"><h4>Card variants</h4><div class="cg-variant-row">{var_html}</div></div>
  </div>
</section>'''


# ---------------------------------------------------------------------------
def _sb_section(idx: str, anchor: str, title: str, count: int,
                children: list = None,
                open_default: bool = False,
                extra_class: str = "") -> str:
    """children = list of either:
         (sub_anchor, label_id, label_name)            — plain row, OR
         dict(href, bid, name, status, tier, purpose)  — mini-status row.

    `extra_class` is appended to the section's class list — used by the
    Archive entry to render with a muted visual treatment.
    """
    children = children or []
    parts = []
    for ch in children:
        if isinstance(ch, dict):
            cls_bits = ["has-status"]
            st = (ch.get("status") or "").replace(" ", "-")
            tr = (ch.get("tier") or "")
            if st: cls_bits.append("s-" + st)
            if tr: cls_bits.append("t-" + tr)
            parts.append(
                f'<a href="{esc(ch["href"])}" class="{" ".join(cls_bits)}" '
                f'data-bid="{esc(ch["bid"])}" data-purpose="{esc(ch.get("purpose",""))}">\n'
                f'  <span class="sb-dot"></span>'
                f'<span class="sb-cid">{esc(ch["bid"])}</span>{esc(ch["name"])}</a>'
            )
        else:
            a, cid, name = ch
            parts.append(
                f'<a href="#{esc(a)}"><span class="sb-cid">{esc(cid)}</span>{esc(name)}</a>'
            )
    kids = "".join(parts)
    tog = "−" if open_default else "+"
    base = "sb-section open" if open_default else "sb-section"
    klass = f"{base} {extra_class}".strip()
    return f'''
  <div class="{klass}" data-anchor="{esc(anchor)}">
    <div class="sb-head">
      <span class="sb-tog">{tog}</span>
      <span class="sb-idx">{esc(idx)}</span>
      <span class="sb-title"><a href="#{esc(anchor)}" style="color:inherit;border:none;text-decoration:none">{esc(title)}</a></span>
      <span class="sb-n">{count}</span>
    </div>
    <div class="sb-children">{kids}</div>
  </div>'''


def build_sidebar(projects, campaigns, models, bau, strategy,
                  adhoc, openitems, xref_count: int, manuals=(),
                  archive=()) -> str:
    def kids(rows):
        """Mini-status rows — dot + ID + name; powers the brand-block peek."""
        out = []
        for r in rows:
            bid = str(r.get("Bucket ID") or "")
            name = str(r.get("Name") or "")
            purpose = str(r.get("Purpose") or r.get("Purpose (short)") or r.get("Notes") or "")
            status = str(r.get("Status") or "")
            tier = str(r.get("Tier") or "")
            out.append({
                "href": f"#b-{bid}", "bid": bid, "name": name,
                "status": status, "tier": tier, "purpose": purpose,
            })
        return out

    packs = [
        ("PRJ-2024-01", "Project LEGO / TROP 2.0"),
        ("PRJ-2024-02", "Pre-approved UW 1.0"),
        ("PRJ-2025-01", "Customer Attrition Analysis"),
        ("PRJ-2025-02", "GenAI build-out"),
        ("PRJ-2025-03", "NB UW Existing Repurchase"),
    ]
    rows = [
        _sb_section("01", "projects",   "Projects",       len(projects),  kids(projects), open_default=True),
        _sb_section("02", "campaigns",  "Campaigns",      len(campaigns), kids(campaigns)),
        _sb_section("03", "models",     "Models",         len(models),    kids(models)),
        _sb_section("04", "bau",        "BAU procedures", len(bau),       kids(bau)),
        _sb_section("05", "strategy",   "Strategy",       len(strategy),  kids(strategy)),
        _sb_section("06", "adhoc",      "Adhoc",          len(adhoc),     kids(adhoc)),
    ]
    tail_idx = 7
    if archive:
        rows.append(_sb_section(f"{tail_idx:02d}", "archive", "Archive",
                                len(archive), kids(archive),
                                extra_class="muted"))
        tail_idx += 1
    rows.append(_sb_section(f"{tail_idx:02d}", "crossrefs",
                            "Repo ↔ bucket map", xref_count, []))
    tail_idx += 1
    if manuals:
        man_kids = [("manuals", f"{i+1:02d}", (m.get("title") or m.get("id") or "")) for i, m in enumerate(manuals)]
        rows.append(_sb_section(f"{tail_idx:02d}", "manuals", "Manuals", len(manuals), man_kids))
        tail_idx += 1
    rows.append(_sb_section(f"{tail_idx:02d}", "references", "Walkthrough & refs", 1, []));  tail_idx += 1
    rows.append(_sb_section(f"{tail_idx:02d}", "maintenance", "Maintenance", 6, []))
    return "\n".join(rows)


# ---------------------------------------------------------------------------
def main():
    inv = load_inventory()
    projects   = inv["02_Projects"]["rows"]
    campaigns  = inv["03_Campaigns"]["rows"]
    models     = inv["05_Models"]["rows"]
    bau        = inv["06_BAU"]["rows"]
    strategy   = inv["07_Strategy"]["rows"]
    adhoc      = inv["04_Adhoc_Log"]["rows"]
    openitems  = inv["08_Open_Items_Risks"]["rows"]
    manuals    = inv["09_Manuals"]["rows"]
    adhoc_buckets = inv["04b_Adhoc_Buckets"]["rows"]
    buckets    = inv["01_Buckets"]["rows"]
    archive    = inv["07b_Archive"]["rows"]
    # Repo-map row count: one row per (bucket, repo_path) edge.
    # Includes archive buckets so the xref table stays a complete inventory.
    xref_buckets = buckets + archive
    xref_rows = sum(
        len([p for p in (b.get("Repo link") or "").replace(";", ",").split(",") if p.strip()])
        for b in xref_buckets
    )

    # Dynamic tail-section indices: Archive renders only when there are
    # retired buckets, and Manuals only when non-empty. Walkthrough /
    # Maintenance numbers shift accordingly.
    tail = 7
    parts = [
        render_section_cards("01", "projects",  "Projects",       "Strategic, multi-quarter analytical workstreams.", projects),
        render_section_cards("02", "campaigns", "Campaigns",      "Active and recently-completed customer-facing campaigns.", campaigns),
        render_section_cards("03", "models",    "Models",         "Production scoring models and segmentations.", models),
        render_section_cards("04", "bau",       "BAU procedures", "Recurring tasks owned by the analytics team.", bau),
        render_section_cards("05", "strategy",  "Strategy",       "Annual cycles, audit-reference foundations, and inherited plans.", strategy),
        render_section_cards("06", "adhoc",     "Adhoc",          "Folder-level adhoc work — one-off requests, exploratory analyses, ops support.", adhoc_buckets),
    ]
    if archive:
        parts.append(render_archive_section(f"{tail:02d}", archive)); tail += 1
    parts.append(render_xref(f"{tail:02d}", xref_buckets)); tail += 1
    if manuals:
        parts.append(render_manuals(f"{tail:02d}", manuals)); tail += 1
    parts.append(render_walkthrough_and_refs(f"{tail:02d}")); tail += 1
    parts.append(render_maintenance(f"{tail:02d}"))
    sections = "\n".join(parts)

    sidebar = build_sidebar(projects, campaigns, models, bau, strategy,
                            adhoc_buckets, openitems, xref_rows,
                            manuals=manuals, archive=archive)

    # PRJ narrative (Decisions / Open questions) — embed inline so the wiki
    # works on file://; HTTP fetch in wiki.js then overrides at runtime when
    # served via serve_admin.py or GitHub Pages. NARRATIVES is populated by
    # load_inventory() from inventory.json:narratives (with legacy fallback).
    nar_inline = ""
    if NARRATIVES:
        nar_inline = ('\n<script id="prj-narrative" type="application/json">'
                      + json.dumps(NARRATIVES, ensure_ascii=False).replace("</", "<\\/")
                      + "</script>\n")
        print(f"  narratives: {len(NARRATIVES)} bucket{'s' if len(NARRATIVES)!=1 else ''}")

    # Year chips — auto-derived from buckets (including Archive) + adhoc so a
    # new year appears the moment its first row is added (no template edit
    # required). Archive years are included so users can filter to e.g. "2024"
    # and still see retired entries from that year.
    years = set()
    for r in buckets:
        y = str(r.get("Year") or "").strip()
        if y.isdigit():
            years.add(int(y))
    for r in archive:
        y = str(r.get("Year") or "").strip()
        if y.isdigit():
            years.add(int(y))
    for r in adhoc:
        rid = str(r.get("ID") or "")
        if rid.startswith("ADH-") and len(rid) >= 8 and rid[4:8].isdigit():
            years.add(int(rid[4:8]))
    year_chips = "\n    ".join(
        f'<span class="chip" data-v="{y}">{y}</span>'
        for y in sorted(years, reverse=True)
    ) or '<span class="lbl" style="color:var(--g500)">(no years)</span>'

    html = (HTML_TEMPLATE
            .replace("__TODAY__", datetime.now().strftime("%B %d, %Y"))
            .replace("__N_BUCKETS__", str(len(buckets)))
            .replace("__N_PROJECTS__", str(len(projects)))
            .replace("__N_CAMPAIGNS__", str(len(campaigns)))
            .replace("__N_MODELS__", str(len(models)))
            .replace("__N_BAU__", str(len(bau)))
            .replace("__N_STRATEGY__", str(len(strategy)))
            .replace("__N_ADHOC__", str(len(adhoc)))
            .replace("__N_OPEN__", str(len(openitems)))
            .replace("__N_XREF__", str(xref_rows))
            .replace("__YEAR_CHIPS__", year_chips)
            .replace("__GH_ROOT_REPO__", GH_REPO)
            .replace("__SP_ROOT__", SP_ROOT)
            .replace("__SIDEBAR__", sidebar)
            .replace("__SECTIONS__", sections + nar_inline)
            .replace("__DATA_JSON__", "{}"))   # reserved for future client-side use

    OUT.write_text(html, encoding="utf-8")
    size_kb = OUT.stat().st_size / 1024
    print(f"Wrote {OUT}  ({size_kb:.1f} KB)")
    # Sanity-check external assets exist alongside the rendered HTML.
    missing = [a for a in ("assets/wiki.css", "assets/wiki.js")
               if not (ROOT / a).exists()]
    if missing:
        print(f"  WARNING — missing asset(s): {missing}  (page will render unstyled)")
    print(f"  buckets={len(buckets)} archive={len(archive)} adhoc={len(adhoc)} openitems={len(openitems)} xref={xref_rows}")


if __name__ == "__main__":
    main()
