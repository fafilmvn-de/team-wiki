"""
uat_admin.py
============

End-to-end UAT for the inventory admin tool using Playwright.
Boots serve_admin.py in a background thread, then drives admin.html
through every interactive surface. Restores inventory.json from .bak
at the end so the test is non-destructive.

Run from the wiki folder:
    python scripts/uat_admin.py

Exits 0 on full pass, 1 on any failure. Verbose by default.
"""
from __future__ import annotations
import json
import shutil
import subprocess
import sys
import time
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright, expect, TimeoutError as PWTimeout

HERE = Path(__file__).resolve().parent
WIKI_ROOT = HERE.parent                          # the wiki folder (where serve_admin.py + inventory.json live)
INV = WIKI_ROOT / "inventory.json"
BAK_SAFE = WIKI_ROOT / "inventory.json.uat_safe"
URL = "http://localhost:8765/admin.html"

PASS, FAIL = [], []


def step(name, fn):
    print(f"  ▸ {name} … ", end="", flush=True)
    t0 = time.time()
    try:
        fn()
        dt = (time.time() - t0) * 1000
        print(f"OK ({dt:.0f} ms)")
        PASS.append(name)
    except Exception as e:
        print(f"FAIL — {e}")
        FAIL.append((name, str(e)))


def main() -> int:
    # ── safety backup ────────────────────────────────────────────
    shutil.copy2(INV, BAK_SAFE)
    print(f"Backed up inventory.json → {BAK_SAFE.name}")
    baseline = json.loads(INV.read_text(encoding="utf-8"))
    baseline_buckets = len(baseline["buckets"])
    baseline_adhoc = len(baseline["adhoc"])
    print(f"Baseline: {baseline_buckets} buckets, {baseline_adhoc} adhoc")

    # ── boot serve_admin.py in subprocess ───────────────────────
    proc = subprocess.Popen(
        [sys.executable, str(WIKI_ROOT / "serve_admin.py")],
        cwd=str(WIKI_ROOT),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8", "SERVE_ADMIN_NO_BROWSER": "1"},
    )
    # Drain stdout in a thread so the pipe never blocks.
    def _drain():
        for line in iter(proc.stdout.readline, b""):
            pass
    threading.Thread(target=_drain, daemon=True).start()
    # Poll until the server actually accepts a connection (up to 8s).
    import socket as _s
    for _ in range(40):
        try:
            with _s.create_connection(("127.0.0.1", 8765), timeout=0.2):
                break
        except OSError:
            time.sleep(0.2)
    else:
        print("Server did not bind on port 8765 within 8s — aborting.")
        proc.kill()
        return 1

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context()
            page = ctx.new_page()
            page.on("pageerror", lambda exc: FAIL.append(("pageerror", str(exc))))

            # ── 1. page loads + initial state ────────────────────
            def t_load():
                page.goto(URL, wait_until="domcontentloaded")
                expect(page.locator("#status")).to_have_class("status saved", timeout=5000)
                expect(page.locator("h1")).to_contain_text("Wikipedia")
            step("page loads & inventory.json fetched", t_load)

            # ── 2. all 6 tabs render with non-zero counts ────────
            def t_tabs():
                tabs = ["Project", "Campaign", "Model", "BAU", "Strategy", "Adhoc"]
                for t in tabs:
                    n = page.locator(f'[data-count="{t}"]').inner_text()
                    assert int(n) >= 0, f"{t} count not numeric"
                # at least one of the bucket tabs has rows
                projects_count = int(page.locator('[data-count="Project"]').inner_text())
                assert projects_count > 0, "Project count is zero"
                adhoc_count = int(page.locator('[data-count="Adhoc"]').inner_text())
                assert adhoc_count > 0, "Adhoc count is zero"
            step("all 6 tab badges populated", t_tabs)

            # ── 3. tab switching ─────────────────────────────────
            def t_switch():
                page.locator('a[data-tab="Adhoc"]').click()
                expect(page.locator('a[data-tab="Adhoc"]')).to_have_class("active")
                # table renders with adhoc columns
                expect(page.locator(".tbl thead")).to_contain_text("Last touch")
                page.locator('a[data-tab="Project"]').click()
                expect(page.locator(".tbl thead")).to_contain_text("Bucket ID")
            step("tab switching swaps schema", t_switch)

            # ── 4. search filter ─────────────────────────────────
            def t_search():
                page.locator("#search").fill("zzznosuchterm")
                expect(page.locator(".empty-state")).to_be_visible()
                page.locator("#search").fill("")
            step("search filter shows empty-state for no-match", t_search)

            # ── 5. inline edit marks dirty + Save button enables ─
            def t_dirty():
                first = page.locator('tr[data-id] input[data-k="name"]').first
                original = first.input_value()
                first.fill(original + " ✎UAT")
                expect(page.locator("#status")).to_have_class("status dirty")
                expect(page.locator("#btn-save")).to_be_enabled()
                # revert
                first.fill(original)
            step("inline edit toggles dirty state", t_dirty)

            # ── 6. show-retired toggle ───────────────────────────
            def t_retired():
                page.locator("#show-retired").check()
                page.locator("#show-retired").uncheck()
            step("show-retired toggle works", t_retired)

            # ── 7. validation flag on bad year ───────────────────
            def t_validation():
                page.locator("#search").fill("")
                year_in = page.locator('tr[data-id] input[data-k="year"]').first
                original = year_in.input_value()
                year_in.fill("abcd")
                row = page.locator('tr[data-id]').first
                expect(row).to_have_class("invalid", timeout=2000)
                year_in.fill(original)
            step("validation marks invalid row", t_validation)

            # ── 8. open add-row modal + auto-suggest ID ──────────
            def t_modal_open():
                page.locator("#btn-add").click()
                expect(page.locator("#modal")).to_have_class("modal open")
                suggested = page.locator('input[name="bucket_id"]').input_value()
                assert suggested.startswith("PRJ-"), f"unexpected suggestion: {suggested}"
            step("add-row modal auto-suggests ID", t_modal_open)

            # ── 9. modal validation: bad prefix ──────────────────
            def t_modal_validation():
                page.locator('input[name="bucket_id"]').fill("XYZ-2099-99")
                page.locator("#m-submit").click()
                expect(page.locator("#m-err")).to_contain_text("prefix")
                page.locator("#m-cancel").click()
                expect(page.locator("#modal")).not_to_have_class("modal open")
            step("modal validates ID prefix mismatch", t_modal_validation)

            # ── 10. successful add of UAT bucket ─────────────────
            UAT_ID = "PRJ-2099-99"
            def t_add():
                page.locator("#btn-add").click()
                page.locator('input[name="bucket_id"]').fill(UAT_ID)
                page.locator('input[name="name"]').fill("UAT smoke test bucket")
                page.locator('input[name="year"]').fill("2099")
                page.locator("#m-submit").click()
                expect(page.locator("#modal")).not_to_have_class("modal open")
                # row visible
                page.locator("#search").fill(UAT_ID)
                expect(page.locator(f'tr[data-id="{UAT_ID}"]')).to_be_visible()
                page.locator("#search").fill("")
            step("add new bucket appears in table", t_add)

            # ── 11. retire the UAT bucket ────────────────────────
            def t_retire():
                page.locator("#search").fill(UAT_ID)
                page.locator(f'tr[data-id="{UAT_ID}"] button[data-act="retire"]').click()
                # after retire, row disappears (showRetired off)
                expect(page.locator(f'tr[data-id="{UAT_ID}"]')).to_have_count(0)
                page.locator("#show-retired").check()
                expect(page.locator(f'tr[data-id="{UAT_ID}"]')).to_be_visible()
                expect(page.locator(f'tr[data-id="{UAT_ID}"]')).to_have_class("retired")
                page.locator("#show-retired").uncheck()
                page.locator("#search").fill("")
            step("retire soft-deletes & is filtered", t_retire)

            # ── 12. save via PUT → verify on disk ────────────────
            def t_save():
                page.locator("#btn-save").click()
                expect(page.locator("#status")).to_have_class("status saved", timeout=5000)
                # disk reflects the new bucket
                disk = json.loads(INV.read_text(encoding="utf-8"))
                ids = [b["bucket_id"] for b in disk["buckets"]]
                assert UAT_ID in ids, "UAT bucket missing from saved JSON"
                row = next(b for b in disk["buckets"] if b["bucket_id"] == UAT_ID)
                assert row["status"] == "Retired", f"status not Retired: {row['status']}"
                # .bak exists
                assert (WIKI_ROOT / "inventory.json.bak").exists(), ".bak not rotated"
            step("Save → PUT writes JSON + rotates .bak", t_save)

            # ── 13. adhoc auto-last-touch stamp ──────────────────
            def t_adhoc_stamp():
                page.locator('a[data-tab="Adhoc"]').click()
                lt_in = page.locator('tr[data-id] input[data-k="last_touch"]').first
                title_in = page.locator('tr[data-id] input[data-k="title"]').first
                original_title = title_in.input_value()
                title_in.fill(original_title + " ✎")
                today = time.strftime("%Y-%m-%d")
                assert lt_in.input_value() == today, f"last_touch not stamped: {lt_in.input_value()}"
                title_in.fill(original_title)
            step("adhoc edit auto-stamps last_touch", t_adhoc_stamp)

            # ── 14. file:// boot guard ───────────────────────────
            def t_file_guard():
                # Visit admin.html via file:// — should show the help panel.
                file_url = (WIKI_ROOT / "admin.html").as_uri()
                p2 = ctx.new_page()
                p2.goto(file_url, wait_until="domcontentloaded")
                expect(p2.locator("body")).to_contain_text("Run the local server first")
                p2.close()
            step("file:// boot guard renders help panel", t_file_guard)

            browser.close()

    finally:
        # ── cleanup ──────────────────────────────────────────────
        proc.terminate()
        try: proc.wait(timeout=3)
        except subprocess.TimeoutExpired: proc.kill()
        # restore inventory.json from our pristine copy
        shutil.copy2(BAK_SAFE, INV)
        BAK_SAFE.unlink(missing_ok=True)
        # remove the .bak the test caused
        bak = WIKI_ROOT / "inventory.json.bak"
        if bak.exists():
            bak.unlink()
        # sanity check
        restored = json.loads(INV.read_text(encoding="utf-8"))
        assert len(restored["buckets"]) == baseline_buckets, "restore failed!"
        print(f"Restored inventory.json ({baseline_buckets} buckets, {baseline_adhoc} adhoc)")

    # ── report ───────────────────────────────────────────────────
    print()
    print("─" * 60)
    print(f"PASSED: {len(PASS)}    FAILED: {len(FAIL)}")
    if FAIL:
        print()
        for name, err in FAIL:
            print(f"  ✗ {name}")
            print(f"      {err}")
        return 1
    print("All UAT checks green.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
