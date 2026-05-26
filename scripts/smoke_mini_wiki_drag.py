"""Headless smoke test for handovers/semantic/08_Semantic_Model.html drag.

Verifies:
  1. Page loads, no JS console errors, domain bubbles render.
  2. Drag a domain bubble → translates the bubble (CSS var --ndx/--ndy set),
     translates the matching satellites-wrap (transform attr), and updates
     all incident edges (x1/y1 or x2/y2).
  3. localStorage entry persists under 'vn-aiwiki-domain-nudges-v1'.
  4. Reload reapplies the nudge (Reset layout button visible).
  5. Reset layout clears nudges + localStorage.
"""
from playwright.sync_api import sync_playwright
import sys

BASE = "http://127.0.0.1:8765"

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()
        errs = []
        page.on("console", lambda m: m.type == "error" and errs.append(m.text))
        page.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))

        # Start clean.
        page.goto(BASE + "/semantic/08_Semantic_Model.html", wait_until="networkidle")
        page.evaluate("() => localStorage.removeItem('vn-aiwiki-domain-nudges-v1')")
        page.reload(wait_until="networkidle")

        # 1) bubbles render
        n = page.locator(".domain-bubble").count()
        print(f"1. domain bubbles rendered: {n}")
        assert n > 0, "no domain bubbles rendered"

        # 2) drag the first bubble
        target = page.locator(".domain-bubble").first
        bbox = target.bounding_box()
        cx = bbox["x"] + bbox["width"] / 2
        cy = bbox["y"] + bbox["height"] / 2
        domain_id = target.get_attribute("data-id")
        print(f"2a. dragging domain {domain_id} from ({cx:.0f}, {cy:.0f})")

        # snapshot of an incident edge BEFORE the drag
        edge_before = page.evaluate(
            "(id) => { const e = document.querySelector(`.edge[data-from-domain='${id}'], .edge[data-to-domain='${id}']`); return e ? { x1: +e.getAttribute('x1'), y1: +e.getAttribute('y1'), x2: +e.getAttribute('x2'), y2: +e.getAttribute('y2') } : null; }",
            domain_id,
        )

        page.mouse.move(cx, cy)
        page.mouse.down()
        steps = 12
        dx, dy = 150, 80
        for i in range(1, steps + 1):
            page.mouse.move(cx + dx * i / steps, cy + dy * i / steps, steps=1)
            page.wait_for_timeout(15)
        page.mouse.up()
        page.wait_for_timeout(200)

        # CSS var on the bubble
        css_dx = page.evaluate(
            "(id) => document.querySelector(`.domain-bubble[data-id='${id}']`).style.getPropertyValue('--ndx')",
            domain_id,
        )
        css_dy = page.evaluate(
            "(id) => document.querySelector(`.domain-bubble[data-id='${id}']`).style.getPropertyValue('--ndy')",
            domain_id,
        )
        print(f"2b. --ndx={css_dx!r}  --ndy={css_dy!r}")
        assert css_dx and css_dy and css_dx != "0px", "expected --ndx set after drag"

        # satellite wrap transform
        sat_xf = page.evaluate(
            "(id) => { const g = document.querySelector(`.satellites-wrap[data-domain='${id}']`); return g ? g.getAttribute('transform') : null; }",
            domain_id,
        )
        print(f"2c. satellites-wrap transform: {sat_xf!r}")
        assert sat_xf and sat_xf.startswith("translate("), "expected satellites translate"

        # edge updated
        edge_after = page.evaluate(
            "(id) => { const e = document.querySelector(`.edge[data-from-domain='${id}'], .edge[data-to-domain='${id}']`); return e ? { x1: +e.getAttribute('x1'), y1: +e.getAttribute('y1'), x2: +e.getAttribute('x2'), y2: +e.getAttribute('y2') } : null; }",
            domain_id,
        )
        if edge_before and edge_after:
            moved = (edge_before["x1"] != edge_after["x1"] or edge_before["y1"] != edge_after["y1"]
                     or edge_before["x2"] != edge_after["x2"] or edge_before["y2"] != edge_after["y2"])
            print(f"2d. edge endpoint moved: {moved}")
            assert moved, "expected incident edge endpoint to follow the drag"
        else:
            print("2d. (no incident edge found — skipping)")

        # 3) localStorage persisted
        stored = page.evaluate("() => localStorage.getItem('vn-aiwiki-domain-nudges-v1')")
        print(f"3. localStorage: {stored!r}")
        assert stored and domain_id in stored, "expected localStorage to contain nudge for dragged domain"

        # 4) Reset visible
        reset_visible = page.evaluate("() => document.querySelector('#reset-layout').style.display !== 'none'")
        print(f"4. reset button visible: {reset_visible}")
        assert reset_visible, "expected reset button visible after drag"

        # 5) reload reapplies
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(200)
        css_dx2 = page.evaluate(
            "(id) => document.querySelector(`.domain-bubble[data-id='${id}']`).style.getPropertyValue('--ndx')",
            domain_id,
        )
        print(f"5. after reload --ndx={css_dx2!r}")
        assert css_dx2 and css_dx2 != "0px", "expected nudge reapplied after reload"

        # 6) Reset clears
        page.locator("#reset-layout").click()
        page.wait_for_timeout(100)
        cleared = page.evaluate("() => localStorage.getItem('vn-aiwiki-domain-nudges-v1')")
        print(f"6. after reset localStorage: {cleared!r}")
        assert not cleared, "expected localStorage cleared after Reset"
        css_dx3 = page.evaluate(
            "(id) => document.querySelector(`.domain-bubble[data-id='${id}']`).style.getPropertyValue('--ndx')",
            domain_id,
        )
        assert css_dx3 in ("", "0px", None), f"expected --ndx unset after reset, got {css_dx3!r}"

        if errs:
            print("\nFAIL: console errors:")
            for e in errs:
                print("  ", e)
            raise SystemExit("smoke FAILED on console errors")

        print("\n✓ ALL CHECKS PASSED")
        browser.close()


if __name__ == "__main__":
    main()
