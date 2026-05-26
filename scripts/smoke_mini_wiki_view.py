"""Headless smoke test for the mini-wiki's new view-style features:
    1. View toggle renders (Domain map / Table model).
    2. Wheel zoom updates the readout + viewport transform.
    3. Fit button resets to 100% / no transform.
    4. Switching to Table model reveals the grid and hides the SVG.
    5. Search → activating a table result adds .search-hit to its satellite
       and .search-dim to siblings (Domain map mode).
    6. Search in Table model mode adds .flash to the matching card.
"""
from playwright.sync_api import sync_playwright
import re, sys

BASE = "http://127.0.0.1:8767"

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()
        errs = []
        page.on("console", lambda m: m.type == "error" and errs.append(m.text))
        page.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))

        page.goto(BASE + "/semantic/08_Semantic_Model.html", wait_until="networkidle")
        page.evaluate("() => localStorage.removeItem('vn-aiwiki-domain-nudges-v1')")

        # 1) toggle + toolbar rendered
        assert page.locator("#vt-domain").count() == 1
        assert page.locator("#vt-table").count() == 1
        assert page.locator("#zoom-toolbar").count() == 1
        print("1. toggle + zoom toolbar render OK")

        # 2) wheel zoom
        bbox = page.locator("#svg").bounding_box()
        page.mouse.move(bbox["x"] + bbox["width"]/2, bbox["y"] + bbox["height"]/2)
        page.mouse.wheel(0, -300)
        page.wait_for_timeout(250)
        readout = page.locator("#zoom-readout").inner_text()
        vp = page.locator("#viewport").get_attribute("transform") or ""
        print(f"2. after wheel up: readout={readout!r}  viewport={vp[:60]!r}")
        assert readout != "100%", f"expected zoom change, got {readout}"
        assert "scale(" in vp, f"expected scale() in transform, got {vp}"

        # 3) Fit button
        page.locator("#zoom-fit").click()
        page.wait_for_timeout(200)
        assert page.locator("#zoom-readout").inner_text() == "100%"
        vp = page.locator("#viewport").get_attribute("transform") or ""
        assert "translate(0,0) scale(1)" in vp, f"fit should reset, got {vp}"
        print("3. fit resets to 100% OK")

        # 4) Switch to Table model
        page.locator("#vt-table").click()
        page.wait_for_timeout(200)
        assert page.locator("body.view-table").count() == 1
        assert page.locator("#tm-inner .table-card").count() > 0, "expected table-cards in TM"
        svg_visible = page.locator("#svg").is_visible()
        assert not svg_visible, "SVG should be hidden in Table model"
        print(f"4. table model rendered, cards={page.locator('#tm-inner .table-card').count()}, svg hidden OK")

        # 5) Search in Table model → flash card
        page.locator("#vt-domain").click()  # back to domain map first to test search hit
        page.wait_for_timeout(150)

        # Pick the first available table from the data via JS
        first_table_fqn = page.evaluate("""() => {
            const b = document.querySelector('.table-bubble[data-fqn]');
            return b ? b.getAttribute('data-fqn') : null;
        }""")
        assert first_table_fqn, "no table bubble found"
        # Search for its short name
        short = first_table_fqn.split('.')[-1]
        page.locator("#search").fill(short)
        page.wait_for_timeout(250)
        # Click first table-kind result
        row = page.locator("#search-results .sr-row").first
        assert row.count() == 1, "expected a search result"
        row.click()
        page.wait_for_timeout(400)
        hit = page.locator(".table-bubble.search-hit").count()
        dim = page.locator(".table-bubble.search-dim").count()
        print(f"5. search hit: .search-hit={hit}  .search-dim={dim}")
        assert hit >= 1, f"expected at least 1 .search-hit, got {hit}"
        assert dim >= 1, f"expected siblings dimmed, got {dim}"

        # 6) Search in Table model — drive activate() directly to avoid
        # focus/typing races with the just-switched view.
        page.locator("#vt-table").click()
        page.wait_for_timeout(300)
        ok = page.evaluate("""(fqn) => {
            // Find the table entry in the embedded data and activate it.
            const it = (window.__SEARCH_ITEMS__ || []).find(x => x.fqn === fqn && x.kind === 'table');
            return { hasItems: !!window.__SEARCH_ITEMS__, found: !!it };
        }""", first_table_fqn)
        # Fall back: invoke via search UI if exposed; otherwise click the card directly
        # to simulate the post-search highlight path.
        page.evaluate("""(fqn) => {
            const c = document.querySelector(`#tm-inner [data-tm-fqn="${CSS.escape(fqn)}"]`);
            if (c) { c.classList.add('flash'); c.scrollIntoView({block:'center'}); }
        }""", first_table_fqn)
        page.wait_for_timeout(200)
        flash_direct = page.locator("#tm-inner .table-card.flash").count()
        print(f"6a. direct flash injection works = {flash_direct >= 1}")
        # Now exercise the real search flow via keyboard.
        page.evaluate("() => document.querySelector('#tm-inner .table-card.flash')?.classList.remove('flash')")
        page.locator("#search").click()
        page.keyboard.press("Control+A")
        page.keyboard.press("Delete")
        page.keyboard.type(short, delay=15)
        page.wait_for_timeout(400)
        opened = page.locator("#search-results.open").count()
        print(f"6b. dropdown opened in TM mode = {opened}")
        if opened:
            page.keyboard.press("Enter")
            page.wait_for_timeout(500)
        flash = page.locator("#tm-inner .table-card.flash").count()
        print(f"6c. table model flash card count = {flash}")
        assert flash >= 1, f"expected card flash in TM, got {flash}"

        if errs:
            print("\nCONSOLE ERRORS:")
            for e in errs: print("  -", e)
            sys.exit(2)
        print("\n✅ ALL CHECKS PASSED")
        browser.close()

if __name__ == "__main__":
    main()
