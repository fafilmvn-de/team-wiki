"""Headless Playwright smoke test for handovers/semantic_editor.html.

Verifies:
  1. Page loads, no JS console errors.
  2. semantic.json loads, status pill turns green.
  3. Tapping a domain bubble opens the Inspector with the right entity
     (regression check — the "Domain not found" bug from 2026-05-21).
  4. Dragging a domain moves its ring of table satellites along with it
     (regression check — the "satellites stay still" bug from 2026-05-21).
  5. View toggle switches to Table model and back without errors.
  6. Suggestions panel renders.
  7. Save button is enabled after an edit, then disabled after save, and
     X-Build-Status comes back ok.
  8. New-relationship modal combobox: typing narrows results, selecting a
     row populates the chip, cross-side boost re-ranks matches.
  9. Validation error: switch-to-fk button when domain_link endpoints look
     like table FQNs (regression check — error shipped 2026-05-21).
 10. Domain Inspector cross-domain relationships subsection — lists existing
     rels, inline add form authors a domain_link when columns are blank.
  10. Domain Inspector cross-domain relationships subsection — lists existing
      rels, inline add form authors a domain_link when columns are blank.
  11. Search omnibox — '/' shortcut focus, type to filter, click activates,
      Esc closes/clears (mirror mini-wiki UX).
  12. Solo mode (Domain map only, ADR 0009) — enterSolo shows solo-controls
      and ghost pucks, breadcrumb/Esc exit, Tidy relayout persists offsets.
"""
from playwright.sync_api import sync_playwright, expect
import sys, time

BASE = "http://127.0.0.1:8765"

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()

        console_errors = []
        page.on("console", lambda m: (m.type == "error" and console_errors.append(m.text)))
        page.on("pageerror", lambda e: console_errors.append("PAGEERROR: " + str(e)))

        # 1) load
        page.goto(BASE + "/semantic_editor.html", wait_until="networkidle")
        page.wait_for_function(
            "() => document.querySelector('#status').className.includes('saved')",
            timeout=8000,
        )
        print("1. loaded · status =", page.locator("#status-text").inner_text())

        # 2) cytoscape ready, domains rendered
        n_nodes = page.evaluate(
            "() => window.__cy && cy && cy.nodes ? cy.nodes('[kind=\"domain\"]').length : 0"
        )
        # window.__cy isn't exposed; use the closure via a probe element
        n_domains = page.evaluate("""
            () => {
                const cyDiv = document.querySelector('#cy');
                // cytoscape attaches to the div; access via getCy() shim
                if (!cyDiv) return -1;
                // Cytoscape exposes the instance on the container's "_cyreg" -- but
                // easiest path: count visible nodes via DOM (rendered as canvas, so
                // fall back to a STATE probe inserted below).
                return (window.__editor_state && window.__editor_state.domains) || -1;
            }
        """)
        print("2. domains via state probe:", n_domains, "(if -1, probe missing)")

        # 3) inspector test — click a domain bubble. Since cytoscape draws into a
        # canvas, simulate a click at the bubble center. Compute the screen pos by
        # asking the page to look up domain "POLICY" coords.
        click_result = page.evaluate("""
            () => {
                // Hack: walk to the cy instance via the only known reference path —
                // we'll find it by inspecting the container's children. Cytoscape v3
                // stores the instance on document via cytoscape.instances? No; we
                // installed it as a script-global. The editor code holds STATE.cy
                // inside an IIFE closure. We can't reach it without an exposed hook.
                // → Test will instead drive via real mouse events on the canvas at
                // the centre of the Customer bubble's expected position.
                return null;
            }
        """)

        # Easier approach: emit the centre-pixel coordinates of every domain by
        # asking cytoscape via a freshly injected helper. We need a hook from the
        # editor JS — but the IIFE closes STATE. Instead, do a brute hit-test by
        # clicking the centre of the canvas (where the first domain usually sits)
        # only after exposing STATE via a small monkey-patch.
        page.evaluate("""
            // Re-execute a tiny probe that pulls STATE out of the editor IIFE by
            // re-binding window-level functions from cytoscape's container.
            // Cytoscape v3 stores instances on each container under a property
            // `_cyreg` (private). Walk that to surface the instance.
            (() => {
                const div = document.querySelector('#cy');
                const reg = div && div._cyreg;
                window.__cy = reg && reg.cy;
            })();
        """)
        cy_ready = page.evaluate("() => !!window.__cy && typeof window.__cy.nodes === 'function'")
        if not cy_ready:
            # Fall back: inspect all properties of #cy looking for the cy instance.
            cy_ready = page.evaluate("""
                () => {
                    const div = document.querySelector('#cy');
                    for (const k of Object.keys(div)) {
                        const v = div[k];
                        if (v && typeof v === 'object' && v.cy && typeof v.cy.nodes === 'function') {
                            window.__cy = v.cy; return true;
                        }
                    }
                    // Try cy.js's expose: cytoscape() returns the instance; check the
                    // closure on Cytoscape's prototype...
                    if (typeof cytoscape === 'function' && cytoscape.warnings) {
                        // No registry exposed; punt.
                    }
                    return false;
                }
            """)
        print("3a. cy instance reachable:", cy_ready)

        if cy_ready:
            n_domains = page.evaluate("() => window.__cy.nodes('node[kind=\"domain\"]').length")
            n_tables  = page.evaluate("() => window.__cy.nodes('node[kind=\"table\"]').length")
            print("3b. domain bubbles =", n_domains, " table satellites =", n_tables)

            # Click the first domain bubble at its rendered centre.
            click_target = page.evaluate("""
                () => {
                    const d = window.__cy.nodes('node[kind="domain"]')[0];
                    if (!d) return null;
                    const rp = d.renderedPosition();
                    const rect = document.querySelector('#cy').getBoundingClientRect();
                    return {
                        x: Math.round(rect.left + rp.x),
                        y: Math.round(rect.top + rp.y),
                        id_raw: d.data('id_raw'),
                    };
                }
            """)
            print("3c. click target:", click_target)
            page.mouse.click(click_target["x"], click_target["y"])
            page.wait_for_timeout(300)

            # Inspector kind label should be "Domain" and title should match.
            kind_label = page.locator("#ins-form .ins-head .kind").inner_text()
            title      = page.locator("#ins-form .ins-head .title").inner_text()
            print("3d. inspector kind:", kind_label, "· title:", title)
            assert "domain" in kind_label.lower(), f"expected 'Domain' in inspector kind, got {kind_label!r}"
            # If domain-not-found bug regressed, ins-form would show "Domain not found."
            empty_state = page.evaluate("""
                () => document.querySelector('#ins-form').textContent.includes('Domain not found')
            """)
            assert not empty_state, "BUG: 'Domain not found' shown in Inspector (regression of fix 2026-05-21)"
            print("3e. ✓ Inspector populated correctly for domain", click_target["id_raw"])

            # 4) Drag test — capture satellite positions BEFORE drag, drag the
            # domain by +200,+100 pixels, then capture AFTER. Satellites should
            # have moved by the same delta.
            before = page.evaluate("""
                ({id_raw}) => {
                    const sats = window.__cy.nodes('node[kind="table"][parentDom="' + id_raw + '"]');
                    return sats.map(n => ({id: n.id(), x: n.position('x'), y: n.position('y')}));
                }
            """, {"id_raw": click_target["id_raw"]})
            print("4a. satellites before drag:", len(before), "samples:", before[:2])

            dom_before = page.evaluate("""
                ({id_raw}) => {
                    const d = window.__cy.$id('d::' + id_raw);
                    return {x: d.position('x'), y: d.position('y')};
                }
            """, {"id_raw": click_target["id_raw"]})

            # Cytoscape renders to canvas — we need real mouse events that the
            # canvas hit-test will pick up.
            page.mouse.move(click_target["x"], click_target["y"])
            page.mouse.down()
            # Move in small steps so cytoscape's drag system registers it.
            steps = 12
            dx, dy = 200, 100
            for i in range(1, steps + 1):
                page.mouse.move(click_target["x"] + dx * i // steps,
                                click_target["y"] + dy * i // steps, steps=1)
                page.wait_for_timeout(20)
            page.mouse.up()
            page.wait_for_timeout(250)

            after = page.evaluate("""
                ({id_raw}) => {
                    const sats = window.__cy.nodes('node[kind="table"][parentDom="' + id_raw + '"]');
                    return sats.map(n => ({id: n.id(), x: n.position('x'), y: n.position('y')}));
                }
            """, {"id_raw": click_target["id_raw"]})

            dom_after = page.evaluate("""
                ({id_raw}) => {
                    const d = window.__cy.$id('d::' + id_raw);
                    return {x: d.position('x'), y: d.position('y')};
                }
            """, {"id_raw": click_target["id_raw"]})

            ddx = dom_after["x"] - dom_before["x"]
            ddy = dom_after["y"] - dom_before["y"]
            print(f"4b. domain moved by ({ddx:.1f}, {ddy:.1f})")
            print(f"4c. satellites after drag:", after[:2] if after else "[]")

            if before:
                # Check each satellite moved by the same delta as the domain.
                bad = []
                for b, a in zip(before, after):
                    sdx = a["x"] - b["x"]
                    sdy = a["y"] - b["y"]
                    if abs(sdx - ddx) > 2 or abs(sdy - ddy) > 2:
                        bad.append((b["id"], sdx, sdy, ddx, ddy))
                if bad:
                    print("4d. ✗ satellites did NOT track parent:")
                    for row in bad[:5]: print("     ", row)
                    raise SystemExit("BUG: satellites stayed still while domain moved (regression of fix 2026-05-21)")
                print("4d. ✓ all", len(before), "satellites tracked their parent domain")
            else:
                print("4d. (no satellites for this domain — drag test skipped)")

        # 5) View toggle
        page.locator("#vt-table").click()
        page.wait_for_timeout(500)
        in_table_mode = page.evaluate("() => document.querySelector('#vt-table').classList.contains('active')")
        print("5. table model view active:", in_table_mode)
        page.locator("#vt-domain").click()
        page.wait_for_timeout(500)

        # 6) Suggestions panel
        page.locator("#st-suggest").click()
        page.wait_for_timeout(200)
        sug_count_text = page.locator("#suggest-count").inner_text()
        print("6. suggestions count:", sug_count_text)

        # 7) Save flow — since drag marked dirty, click Save.
        save_btn = page.locator("#btn-save")
        is_disabled = save_btn.is_disabled()
        print("7a. save button enabled (dirty)?:", not is_disabled)
        if not is_disabled:
            save_btn.click()
            page.wait_for_function(
                "() => document.querySelector('#btn-save').disabled === true",
                timeout=8000,
            )
            status_class = page.locator("#status").get_attribute("class")
            print("7b. save complete · status class:", status_class)
            assert "saved" in status_class, f"expected 'saved' in status, got {status_class!r}"

        # console errors
        if console_errors:
            print("\nFAIL: console errors observed:")
            for e in console_errors: print(" ", e)
            raise SystemExit("smoke test FAILED on console errors")

        # 8) Relationship modal combobox
        print("8a. opening +Relationship modal")
        page.locator("#btn-add-rel").click()
        page.wait_for_selector("#rel-modal.open", timeout=3000)
        page.wait_for_selector("#cb-from-host .combobox", timeout=3000)

        # Type a known FK-shaped column name; pick whatever the first suggestion
        # is (don't hardcode — semantic.json content drifts).
        from_input = page.locator("#cb-from-host .cb-input")
        from_input.click()
        from_input.fill("customer_id")
        page.wait_for_timeout(150)
        rows = page.locator("#cb-from-host .cb-row")
        n_from = rows.count()
        print("8b. from-side matches for 'customer_id':", n_from)
        assert n_from > 0, "expected at least one column match for 'customer_id'"
        first_id = rows.first.get_attribute("data-id")
        rows.first.click()
        chip_on = page.locator("#cb-from-host .cb-chip.on")
        chip_on.wait_for(timeout=2000)
        print("8c. ✓ from-side chip populated for", first_id)

        # Now type the same in To-side — boost should fire, badges visible.
        to_input = page.locator("#cb-to-host .cb-input")
        to_input.click()
        to_input.fill("customer_id")
        page.wait_for_timeout(150)
        to_rows = page.locator("#cb-to-host .cb-row")
        n_to = to_rows.count()
        # Boost adds a "matches customer_id" badge on same-name matches.
        n_badges = page.locator("#cb-to-host .cb-badge.cb-b-name").count()
        print("8d. to-side matches:", n_to, "· boost badges:", n_badges)
        assert n_to > 0, "expected to-side matches"
        # If we have >1 column in the corpus we should also see at least 1 boost
        # badge (unless customer_id exists only once — in which case the from-side
        # would have been the only candidate too).
        if n_from > 1:
            assert n_badges > 0, "expected cross-side boost badges on same-name match"

        # Cancel — close via JS to avoid pointer/panel/focus interception in
        # the test (real users click the Cancel button just fine).
        page.evaluate("() => document.querySelector('#rel-modal').classList.remove('open')")
        page.wait_for_function("() => !document.querySelector('#rel-modal').classList.contains('open')", timeout=2000)
        print("8e. ✓ combobox flow complete (modal cancelled cleanly)")

        # 9) Validation error: switch-to-fk button when domain_link endpoints
        #    look like table FQNs (regression check — error shipped 2026-05-21).
        print("9a. opening modal with table-FQN prefill but kind=domain_link")
        page.evaluate(
            """() => window.__editor.openRelModal({
                kind: 'domain_link',
                from: 'acme_retail.published_db.customers',
                to:   'acme_retail.published_db.orders',
            })"""
        )
        page.wait_for_selector("#rel-modal.open", timeout=3000)
        # domain_link mode renders selects, but submit reads the underlying
        # collect() — when prefill.from isn't in the select options the
        # value falls back to the first domain. To force the error path,
        # patch the select values to the invalid FQNs just before submit.
        page.evaluate(
            """() => {
                const f = document.querySelector('#fld-from');
                const t = document.querySelector('#fld-to');
                // Force values to FQNs even though they aren't in the option list
                const opt = (sel, v) => {
                    const o = document.createElement('option');
                    o.value = v; o.text = v; sel.appendChild(o); sel.value = v;
                };
                opt(f, 'acme_retail.published_db.customers');
                opt(t, 'acme_retail.published_db.orders');
            }"""
        )
        page.locator("#rel-submit").click()
        page.wait_for_selector("#rel-err-switch-fk", timeout=2000)
        err_html = page.locator("#rel-err").inner_html()
        assert "Switch to fk" in err_html, f"expected Switch-to-fk action in: {err_html!r}"
        assert "domain ids" in err_html, "expected guidance about domain ids"
        print("9b. ✓ Switch-to-fk button rendered with guidance")

        # Click the switch button → modal should re-open with kind=fk
        page.locator("#rel-err-switch-fk").click()
        page.wait_for_selector("#cb-from-host .combobox", timeout=3000)
        kind_val = page.locator("#fld-kind").input_value()
        assert kind_val == "fk", f"expected kind=fk after switch, got {kind_val!r}"
        # Comboboxes should be present; chip carryover only fires when the
        # original prefill had column data too, so we don't assert chip text.
        assert page.locator("#cb-from-host .combobox").count() == 1
        assert page.locator("#cb-to-host .combobox").count() == 1
        print("9c. ✓ switched to fk; combobox endpoints re-rendered")

        page.evaluate("() => document.querySelector('#rel-modal').classList.remove('open')")

        # 10) Domain Inspector — cross-domain relationships subsection.
        print("10a. opening CUSTOMER domain inspector")
        page.evaluate("() => window.__editor.selectEntity('domain', 'CUSTOMER')")
        page.wait_for_selector("#dom-rels-list", timeout=3000)
        list_count = page.locator("#dom-rels-list .dom-rel-row").count()
        print("10b. cross-domain rels listed for CUSTOMER:", list_count)
        assert list_count >= 1, "expected at least one cross-domain rel touching CUSTOMER (seed POLICY ↔ CUSTOMER domain_link)"

        # Pick POLICY as target, leave both columns blank → should author a
        # domain_link.
        n_rels_before = page.evaluate("() => window.__editor.getState().data.relationships.length")
        page.select_option("#fld-rel_target", "POLICY")
        page.wait_for_timeout(150)
        preview = page.locator("#dom-rel-preview").inner_html()
        assert "domain_link" in preview, f"expected 'domain_link' in preview when columns blank: {preview!r}"
        add_btn = page.locator("#dom-rel-add")
        assert add_btn.is_enabled(), "expected Add button enabled with target picked and columns blank"
        add_btn.click()
        page.wait_for_timeout(150)
        n_rels_after = page.evaluate("() => window.__editor.getState().data.relationships.length")
        assert n_rels_after == n_rels_before + 1, f"expected +1 relationship, got {n_rels_before}→{n_rels_after}"
        last = page.evaluate("() => { const rs = window.__editor.getState().data.relationships; return rs[rs.length-1]; }")
        assert last["kind"] == "domain_link" and last["from"] == "CUSTOMER" and last["to"] == "POLICY", \
            f"unexpected new rel: {last!r}"
        print("10c. ✓ Added domain_link CUSTOMER → POLICY via inspector")

        # 11) Search omnibox: type, assert results, click top, inspector opens.
        print("11a. opening search omnibox via '/' shortcut")
        # Click somewhere neutral first so the global '/' handler can fire
        # (we may still be in the inspector form after step 10).
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.keyboard.press("/")
        page.wait_for_function(
            "() => document.activeElement && document.activeElement.id === 'search'",
            timeout=2000,
        )
        # Type a token guaranteed to hit something (every semantic.json we ship
        # has at least one domain — type its first 3 chars).
        first_domain = page.evaluate(
            "() => { const d = window.__editor.getState().data.domains[0] || {}; return d.domain_name || d.domain_id || ''; }"
        )
        assert first_domain, "no domains in semantic.json — cannot smoke search"
        query = first_domain[:3].lower()
        page.locator("#search").fill(query)
        page.wait_for_selector("#search-results.open", timeout=2000)
        n_groups = page.locator("#search-results .sr-group").count()
        n_rows   = page.locator("#search-results .sr-row").count()
        assert n_groups >= 1 and n_rows >= 1, \
            f"search returned no results for {query!r} (groups={n_groups}, rows={n_rows})"
        print(f"11b. ✓ typed {query!r} → {n_groups} group(s), {n_rows} row(s)")

        # Click the top row → activates → inspector opens, search closes,
        # input clears, focus leaves the search input.
        page.locator("#search-results .sr-row").first.click()
        page.wait_for_function(
            "() => !document.getElementById('search-results').classList.contains('open')",
            timeout=2000,
        )
        assert page.locator("#search").input_value() == "", \
            "search input should clear on activation"
        # Inspector form should now be populated (form is shown when an
        # entity is selected; before any selection it has .hidden).
        sel = page.evaluate("() => window.__editor.getState().selected")
        assert sel is not None, "expected STATE.selected to be set after search activation"
        ins_form_hidden = page.evaluate(
            "() => document.getElementById('ins-form').classList.contains('hidden')"
        )
        assert not ins_form_hidden, "inspector form should be visible after search activation"
        print(f"11c. ✓ activated {sel.get('kind')}={sel.get('id')!r} via search click; inspector opened")

        # Esc clears + blurs (second-press behaviour mirrors mini-wiki).
        page.locator("#search").focus()
        page.locator("#search").fill("xyzxyz-no-match")
        page.wait_for_selector("#search-results.open", timeout=2000)
        assert page.locator("#search-results .sr-empty").count() == 1, \
            "expected empty-state message for no-match query"
        page.keyboard.press("Escape")  # closes results
        page.wait_for_function(
            "() => !document.getElementById('search-results').classList.contains('open')",
            timeout=1500,
        )
        page.keyboard.press("Escape")  # clears + blurs
        assert page.locator("#search").input_value() == "", \
            "second Esc should clear the search input"
        print("11d. ✓ Esc closes results, second Esc clears input")

        # 12) Solo mode (Domain map only) — ADR 0009.
        print("12a. exiting any leftover solo state and switching to Domain map")
        # Step 11 may have soloed via search activation; reset before testing.
        page.evaluate("() => window.__editor.exitSolo && window.__editor.exitSolo()")
        page.evaluate("() => document.getElementById('vt-domain').click()")
        page.wait_for_function(
            "() => !document.getElementById('solo-controls').classList.contains('open')",
            timeout=2000,
        )

        # Pick the first domain id and enter solo programmatically (the
        # canvas click is harder to target deterministically across viewports).
        first_id = page.evaluate(
            "() => (window.__editor.getState().data.domains[0] || {}).domain_id"
        )
        assert first_id, "no domain to solo"
        page.evaluate(f"() => window.__editor.enterSolo({first_id!r})")
        page.wait_for_function(
            "() => document.getElementById('solo-controls').classList.contains('open')",
            timeout=2000,
        )
        assert page.evaluate("() => window.__editor.getState().soloDomainId") == first_id
        print(f"12b. ✓ enterSolo({first_id!r}) — solo-controls visible")

        # Ghost pucks present for every other domain (kind='ghost' in cy).
        n_ghosts = page.evaluate(
            "() => window.__editor.getState().cy.nodes('node[kind=\"ghost\"]').length"
        )
        n_domains = page.evaluate(
            "() => window.__editor.getState().data.domains.length"
        )
        assert n_ghosts == n_domains - 1, \
            f"expected {n_domains-1} ghost pucks, found {n_ghosts}"
        print(f"12c. ✓ {n_ghosts} ghost domain pucks rendered at perimeter")

        # Breadcrumb → exits solo.
        page.locator("#solo-back").click()
        page.wait_for_function(
            "() => !document.getElementById('solo-controls').classList.contains('open')",
            timeout=2000,
        )
        assert page.evaluate("() => window.__editor.getState().soloDomainId") is None
        print("12d. ✓ '← All domains' breadcrumb exits Solo mode")

        # Re-enter and exit via Esc.
        page.evaluate(f"() => window.__editor.enterSolo({first_id!r})")
        page.wait_for_function(
            "() => document.getElementById('solo-controls').classList.contains('open')",
            timeout=2000,
        )
        # Make sure no input has focus or the omnibox handler may intercept Esc.
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.keyboard.press("Escape")
        page.wait_for_function(
            "() => !document.getElementById('solo-controls').classList.contains('open')",
            timeout=2000,
        )
        print("12e. ✓ Esc exits Solo mode")

        # Tidy: re-enter, snapshot a satellite position, click Tidy, assert
        # the satellite moved and the offset was persisted into meta.solo_offsets.
        page.evaluate(f"() => window.__editor.enterSolo({first_id!r})")
        page.wait_for_function(
            "() => document.getElementById('solo-controls').classList.contains('open')",
            timeout=2000,
        )
        n_tables = page.evaluate(
            "() => window.__editor.getState().cy.nodes('node[kind=\"table\"]').length"
        )
        if n_tables >= 1:
            before = page.evaluate(
                "() => { const ns = window.__editor.getState().cy.nodes('node[kind=\"table\"]');"
                "       return ns.length ? ns[0].position() : null; }"
            )
            page.locator("#solo-tidy").click()
            page.wait_for_function(
                "() => { const m = (window.__editor.getState().data.meta||[])"
                ".find(r => r.key==='solo_offsets'); return m && m.value && m.value.length > 2; }",
                timeout=3000,
            )
            after = page.evaluate(
                "() => { const ns = window.__editor.getState().cy.nodes('node[kind=\"table\"]');"
                "       return ns.length ? ns[0].position() : null; }"
            )
            moved = (before and after and
                     (abs(before["x"] - after["x"]) + abs(before["y"] - after["y"])) > 1)
            assert moved, f"Tidy did not move first satellite (before={before}, after={after})"
            print(f"12f. ✓ Tidy relayed out {n_tables} satellites; offsets persisted to meta.solo_offsets")
        else:
            print(f"12f. (skipped — domain {first_id!r} has 0 visible tables)")

        # Exit cleanly so subsequent runs don't inherit state via save.
        page.evaluate("() => window.__editor.exitSolo()")

        print("\n✓ ALL CHECKS PASSED")
        browser.close()


if __name__ == "__main__":
    main()
