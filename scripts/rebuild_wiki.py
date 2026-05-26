"""
rebuild_wiki.py
===============

One-command rebuild of the handover wiki after editing `_inventory_data.py`
(or any other inventory source). Runs:

    1. step6_build_inventory.py  → inventory.xlsx
    2. step11_build_wiki.py      → index.html
    3. build_semantic.py         → semantic/08_Semantic_Model.html
                                   (mtime-gated: skipped if semantic.xlsx is
                                   not newer than the current HTML output)

Usage (from repo root, with venv active):
    python handovers/scripts/rebuild_wiki.py

Does NOT rebuild the Word manuals (step7), per-project packs (step8) or the
walkthrough deck (step10) — those are produced less frequently and can be
re-run manually when needed.

See `handovers/MAINTENANCE.md` for the full update workflow.
"""
from __future__ import annotations
import sys
from pathlib import Path

# Force UTF-8 stdout so box-drawing chars (─ … → ✓) don't crash on Windows cp1252.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def main() -> None:
    import step6_build_inventory
    import step11_build_wiki
    import build_semantic

    print("─" * 60)
    print("[1/3] step6_build_inventory — refreshing xlsx …")
    print("─" * 60)
    step6_build_inventory.main()

    print()
    print("─" * 60)
    print("[2/3] step11_build_wiki — rendering index.html …")
    print("─" * 60)
    step11_build_wiki.main()

    print()
    print("─" * 60)
    print("[3/3] build_semantic — semantic mini-wiki …")
    print("─" * 60)
    if not build_semantic.JSON_PATH.exists():
        print(f"  skipped: {build_semantic.JSON_PATH.name} not found (run "
              "`python handovers/scripts/build_semantic.py --seed` to create it, "
              "or `--import-xlsx` to bootstrap from semantic.xlsx).")
    elif build_semantic._is_stale():
        build_semantic.main([])
    else:
        print(f"  up-to-date: {build_semantic.OUT_HTML.name} is newer than "
              f"{build_semantic.JSON_PATH.name} (skipped).")

    print()
    print("✓ Done. Open handovers/index.html in a browser to verify.")
    print("  Don't forget to append a one-line entry to handovers/CHANGELOG.md.")


if __name__ == "__main__":
    main()
