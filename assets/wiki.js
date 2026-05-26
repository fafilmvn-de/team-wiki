// sidebar expand/collapse
// sidebar expand/collapse (with a11y: ARIA + keyboard)
document.querySelectorAll('aside.sidebar .sb-head').forEach(h => {
  if (!h.hasAttribute('role')) h.setAttribute('role', 'button');
  if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '0');
  const syncAria = () => {
    const open = h.parentElement.classList.contains('open');
    h.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  syncAria();
  const toggle = (e) => {
    // let inner anchor clicks fall through (don't double-fire on hash links)
    if (e && e.target && e.target.closest && e.target.closest('a[href]')) return;
    const sec = h.parentElement;
    sec.classList.toggle('open');
    const tog = h.querySelector('.sb-tog');
    if (tog) tog.textContent = sec.classList.contains('open') ? '−' : '+';
    syncAria();
  };
  h.addEventListener('click', toggle);
  h.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
  });
});

// adhoc year-block expand/collapse
document.querySelectorAll('.yr-block .yr-head').forEach(h => {
  h.addEventListener('click', () => {
    const blk = h.parentElement;
    blk.classList.toggle('open');
    const tog = h.querySelector('.yr-tog');
    if (tog) tog.textContent = blk.classList.contains('open') ? '−' : '+';
  });
});
// auto-open the section matching current hash
function openByHash() {
  const h = (location.hash || '').replace('#', '');
  if (!h) return;
  document.querySelectorAll('aside.sidebar .sb-section').forEach(s => {
    if (s.dataset.anchor === h || s.querySelector(`a[href="#${h}"]`)) {
      s.classList.add('open');
      const tog = s.querySelector('.sb-tog');
      if (tog) tog.textContent = '−';
      const head = s.querySelector('.sb-head');
      if (head) head.setAttribute('aria-expanded', 'true');
    }
  });
}
window.addEventListener('hashchange', openByHash);
openByHash();

// chip filters
const activeFilters = { tier: new Set(), status: new Set(), year: new Set() };
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const g = chip.parentElement.dataset.group;
    const v = chip.dataset.v;
    if (chip.classList.toggle('active')) activeFilters[g].add(v);
    else activeFilters[g].delete(v);
    applyFilters();
  });
});
const search = document.getElementById('search');
search.addEventListener('input', applyFilters);

window.applyFilters = applyFilters;

function applyFilters() {
  const q = search.value.trim().toLowerCase();
  const t = activeFilters.tier, s = activeFilters.status, y = activeFilters.year;
  const summary = [];
  if (t.size) summary.push('tier=' + [...t].join('/'));
  if (s.size) summary.push('status=' + [...s].join('/'));
  if (y.size) summary.push('year=' + [...y].join('/'));
  if (q) summary.push('"' + q + '"');
  const banner = document.getElementById('filter-banner');
  if (summary.length) {
    banner.classList.add('active');
    document.getElementById('filter-summary').textContent = summary.join(' · ');
  } else banner.classList.remove('active');

  document.querySelectorAll('[data-row]').forEach(el => {
    const dt = (el.dataset.tier || '').trim();
    const ds = (el.dataset.status || '').trim();
    const dy = (el.dataset.year || '').trim();
    const txt = (el.dataset.search || '').toLowerCase();
    let show = true;
    if (t.size && !t.has(dt)) show = false;
    if (s.size && !s.has(ds)) show = false;
    if (y.size && !y.has(dy)) show = false;
    if (q && !txt.includes(q)) show = false;
    el.classList.toggle('hidden', !show);
  });

  document.querySelectorAll('section').forEach(sec => {
    const visible = sec.querySelectorAll('[data-row]:not(.hidden)').length;
    const total = sec.querySelectorAll('[data-row]').length;
    if (!total) return;
    const c = sec.querySelector('.sec-head .count');
    if (c) c.textContent = (visible === total) ? `${total}` : `${visible} / ${total}`;
  });

  // auto-expand year blocks while filtering so visible rows are reachable
  const filtering = !!(t.size || s.size || y.size || q);
  document.querySelectorAll('.yr-block').forEach(blk => {
    const visible = blk.querySelectorAll('[data-row]:not(.hidden)').length;
    if (filtering && visible > 0) {
      blk.classList.add('open');
      const tog = blk.querySelector('.yr-tog');
      if (tog) tog.textContent = '−';
    }
  });
}
document.getElementById('filter-clear').addEventListener('click', () => {
  document.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
  Object.values(activeFilters).forEach(s => s.clear());
  search.value = '';
  applyFilters();
});

/* whole-card navigation for `.card-link` (HTML5 forbids nested <a>,
   so the card itself is a <div> with data-card-href).
   External URLs (http/https) open in a new tab; local hrefs navigate in place. */
function _navCard(href){
  if (!href) return;
  if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener');
  else window.location.href = href;
}
document.addEventListener('click', (e) => {
  if (e.target.closest('a, button, .drag-handle, .reset-order')) return;
  const card = e.target.closest('.card-link');
  if (!card) return;
  _navCard(card.dataset.cardHref);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = document.activeElement;
  if (!el || !el.classList || !el.classList.contains('card-link')) return;
  e.preventDefault();
  _navCard(el.dataset.cardHref);
});

/* ─── Birchline enrichments ──────────────────────── */

/* (1) sidebar mini-status hover/click → peek panel under brand */
(function () {
  const peek = document.getElementById('sb-peek');
  if (!peek) return;
  const dflt = peek.innerHTML;
  document.querySelectorAll('aside.sidebar .sb-children a.has-status').forEach(a => {
    const id = a.dataset.bid || '';
    const purpose = a.dataset.purpose || '';
    const show = () => {
      peek.classList.remove('empty');
      peek.innerHTML = '<span class="pk-id">' + id + '</span>' + purpose;
    };
    a.addEventListener('mouseenter', show);
    a.addEventListener('focus', show);
    a.addEventListener('click', show);
  });
  document.querySelector('aside.sidebar').addEventListener('mouseleave', () => {
    peek.classList.add('empty'); peek.innerHTML = dflt;
  });
})();

/* (2) per-section sparkline computed from data-year on cards */
(function () {
  const W = 92, H = 22, P = 2;
  document.querySelectorAll('section[id]').forEach(sec => {
    const head = sec.querySelector('.sec-head');
    if (!head || head.querySelector('.spark')) return;
    const cards = sec.querySelectorAll('[data-row="bucket"], [data-row="adhoc"]');
    if (cards.length < 2) return;
    const counts = {};
    cards.forEach(c => { const y = (c.dataset.year || '').trim();
      if (!y) return; counts[y] = (counts[y] || 0) + 1; });
    const yrs = Object.keys(counts).sort();
    if (yrs.length < 2) return;
    const max = Math.max(...yrs.map(y => counts[y]));
    const stepX = (W - 2*P) / (yrs.length - 1);
    const pts = yrs.map((y, i) => {
      const x = P + i*stepX;
      const h = max > 0 ? (counts[y] / max) * (H - 2*P) : 0;
      return [x, H - P - h];
    });
    const d = pts.map((p,i) => (i?'L':'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const dots = pts.map(p =>
      '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="1.6" fill="#D97757"/>').join('');
    const span = document.createElement('span');
    span.className = 'spark';
    span.title = yrs.map(y => y+': '+counts[y]).join(' · ');
    span.innerHTML = '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'
      + '<path d="'+d+'" fill="none" stroke="#141413" stroke-width="1.2" '
      + 'stroke-linecap="round" stroke-linejoin="round"/>' + dots + '</svg>';
    head.appendChild(span);
  });
})();

/* (3) PRJ narrative injector — inline JSON now, sidecar override later */
(function () {
  let data = {};
  const inline = document.getElementById('prj-narrative');
  if (inline) { try { data = JSON.parse(inline.textContent || '{}'); } catch (e) {} }
  const inject = (d) => {
    Object.keys(d).forEach(pid => {
      const card = document.getElementById('b-' + pid);
      if (!card) return;
      const body = card.querySelector('.body');
      if (!body || card.querySelector('.narrative')) return;
      const dec = (d[pid].decisions || []), oq = (d[pid].open_questions || []);
      if (!dec.length && !oq.length) return;
      const wrap = document.createElement('div');
      wrap.className = 'narrative';
      const appendGroup = (label, items) => {
        if (!items.length) return;
        const h = document.createElement('h5');
        h.textContent = label;
        wrap.appendChild(h);
        const ul = document.createElement('ul');
        items.forEach(x => {
          const li = document.createElement('li');
          li.textContent = String(x == null ? '' : x);
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
      };
      appendGroup('Decisions baked in', dec);
      appendGroup('Open questions', oq);
      const tog = document.createElement('div');
      tog.className = 'toggle'; tog.textContent = '+ decisions & open questions';
      tog.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = wrap.classList.toggle('show');
        tog.textContent = (open ? '−' : '+') + ' decisions & open questions';
      });
      const links = body.querySelector('.links');
      if (links) body.insertBefore(tog, links); else body.appendChild(tog);
      if (links) body.insertBefore(wrap, links); else body.appendChild(wrap);
    });
  };
  inject(data);
  /* Sidecar override: on http(s), refetch the live inventory.json and inject
     any narratives changes saved via admin.html — no rebuild required for
     edits to show up on reload. Silently ignored on file://. Falls back to
     the legacy standalone prj_narrative.json for one rebuild cycle. */
  if (location.protocol.startsWith('http')) {
    fetch('inventory.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.narratives) inject(d.narratives); })
      .catch(() => {});
    fetch('prj_narrative.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) inject(d); }).catch(() => {});
  }
})();

/* (4) anatomy diagram draw-on when scrolled into view */
(function () {
  const el = document.querySelector('.anatomy');
  if (!el || !('IntersectionObserver' in window)) {
    if (el) el.classList.add('in-view'); return;
  }
  new IntersectionObserver((entries, ob) => {
    entries.forEach(e => { if (e.isIntersecting) { el.classList.add('in-view'); ob.disconnect(); } });
  }, { threshold: 0.3 }).observe(el);
})();

/* (5) scroll-spy underline on sidebar children — single active item */
(function () {
  const links = document.querySelectorAll('aside.sidebar .sb-children a[href^="#b-"]');
  if (!links.length) return;
  const map = new Map();
  links.forEach(a => { const id = a.getAttribute('href').slice(1); map.set(id, a); });
  const visible = new Set();
  function refresh() {
    let topId = null, topY = Infinity;
    visible.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const y = el.getBoundingClientRect().top;
      if (y < topY) { topY = y; topId = id; }
    });
    links.forEach(a => a.classList.remove('is-active'));
    if (topId && map.get(topId)) map.get(topId).classList.add('is-active');
  }
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) visible.add(e.target.id);
      else visible.delete(e.target.id);
    });
    refresh();
  }, { rootMargin: '-30% 0px -55% 0px' });
  document.querySelectorAll('[id^="b-"]').forEach(c => obs.observe(c));
})();

/* (6) pulse newly-matched cards once when filters change */
(function () {
  const _orig = window.applyFilters;
  if (typeof _orig !== 'function') return;
  window.applyFilters = function () {
    _orig.apply(this, arguments);
    document.querySelectorAll('[data-row="bucket"]:not(.hidden)').forEach(c => {
      c.classList.remove('matched');
      void c.offsetWidth;
      c.classList.add('matched');
    });
  };
})();

/* ─── (7) UI-state persistence + card reorder (localStorage, view-only) ───
   Stores accordion/filter/search/order state under key "vn-wiki-ui".
   Never mutates inventory.json. Per-section reset button clears that
   section's order overrides. HTML5 drag-and-drop is desktop-only;
   drag handles auto-hide on touch (CSS @media (hover: none)).
   Keyboard: focus a card, then Alt+↑/↓ to swap, Alt+Home/End to jump,
   Esc to drop focus. */
(function () {
  const KEY = 'vn-wiki-ui';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };
  const UI = {
    get(k, d){ const v = load()[k]; return v === undefined ? d : v; },
    set(k, v){ const s = load(); s[k] = v; save(s); },
    del(k){ const s = load(); delete s[k]; save(s); },
  };

  /* ── reorder ──────────────────────────────── */
  function sectionGrids(){
    return document.querySelectorAll('.grid[data-section]');
  }
  function cardKey(card){
    return card.dataset.bucketId || '';
  }
  function applyOrder(grid){
    const sec = grid.dataset.section;
    const map = UI.get('order:' + sec, null);
    if (!map || typeof map !== 'object') return;
    const cards = Array.from(grid.querySelectorAll(':scope > .card'));
    if (!cards.length) return;
    cards.sort((a, b) => {
      const ka = cardKey(a), kb = cardKey(b);
      const pa = (ka in map) ? map[ka] : Infinity;
      const pb = (kb in map) ? map[kb] : Infinity;
      if (pa === pb) return 0;
      return pa - pb;
    });
    cards.forEach(c => grid.appendChild(c));
  }
  function persistOrder(grid){
    const sec = grid.dataset.section;
    const cards = Array.from(grid.querySelectorAll(':scope > .card'));
    const map = {};
    cards.forEach((c, i) => { const k = cardKey(c); if (k) map[k] = i; });
    UI.set('order:' + sec, map);
  }

  let dragSrc = null;
  function clearDropMarks(grid){
    grid.querySelectorAll(':scope > .card.drop-before, :scope > .card.drop-after')
      .forEach(c => c.classList.remove('drop-before','drop-after'));
  }
  function wireGrid(grid){
    grid.addEventListener('dragstart', (e) => {
      const h = e.target.closest('.drag-handle');
      if (!h) { e.preventDefault(); return; }
      const card = h.closest('.card');
      if (!card || card.parentElement !== grid) { e.preventDefault(); return; }
      dragSrc = card;
      card.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', cardKey(card)); } catch (err) {}
      try { e.dataTransfer.setDragImage(card, 20, 20); } catch (err) {}
    });
    grid.addEventListener('dragover', (e) => {
      if (!dragSrc || dragSrc.parentElement !== grid) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
      const target = e.target.closest('.card');
      clearDropMarks(grid);
      if (!target || target === dragSrc) return;
      const rect = target.getBoundingClientRect();
      const after = (e.clientX - rect.left) > rect.width / 2;
      target.classList.add(after ? 'drop-after' : 'drop-before');
    });
    grid.addEventListener('dragleave', (e) => {
      if (!grid.contains(e.relatedTarget)) clearDropMarks(grid);
    });
    grid.addEventListener('drop', (e) => {
      if (!dragSrc || dragSrc.parentElement !== grid) return;
      e.preventDefault();
      const target = e.target.closest('.card');
      clearDropMarks(grid);
      if (target && target !== dragSrc) {
        const rect = target.getBoundingClientRect();
        const after = (e.clientX - rect.left) > rect.width / 2;
        if (after) target.after(dragSrc); else target.before(dragSrc);
      }
      persistOrder(grid);
    });
    grid.addEventListener('dragend', () => {
      if (dragSrc) dragSrc.classList.remove('dragging');
      clearDropMarks(grid);
      dragSrc = null;
    });
  }

  /* keyboard reorder: focused card + Alt+↑/↓/Home/End */
  document.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    const card = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest('.card[data-bucket-id]') : null;
    if (!card) return;
    const grid = card.parentElement;
    if (!grid || !grid.matches('.grid[data-section]')) return;
    const sibs = Array.from(grid.querySelectorAll(':scope > .card'));
    const i = sibs.indexOf(card);
    if (i < 0) return;
    let moved = false;
    if (e.key === 'ArrowUp' && i > 0)            { grid.insertBefore(card, sibs[i-1]); moved = true; }
    else if (e.key === 'ArrowDown' && i < sibs.length-1) { grid.insertBefore(card, sibs[i+1].nextSibling); moved = true; }
    else if (e.key === 'Home' && i > 0)          { grid.insertBefore(card, sibs[0]); moved = true; }
    else if (e.key === 'End'  && i < sibs.length-1) { grid.appendChild(card); moved = true; }
    if (moved) {
      e.preventDefault();
      card.classList.add('kbd-grabbed');
      setTimeout(() => card.classList.remove('kbd-grabbed'), 600);
      card.focus();
      persistOrder(grid);
    }
  });

  /* per-section reset button */
  document.querySelectorAll('.sec-head .reset-order').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sec = btn.dataset.section;
      UI.del('order:' + sec);
      const grid = document.querySelector('.grid[data-section="' + sec + '"]');
      if (!grid) return;
      /* re-sort to default = original DOM order (which Python rendered
         in inventory order). Since we may have already mutated the DOM,
         the only safe restore is reload — but reload would lose other
         transient UI state. So we sort by the data-bucket-id’s position
         in a snapshot we took on load. */
      const baseline = grid._baselineOrder;
      if (baseline) {
        baseline.forEach(k => {
          const c = grid.querySelector(':scope > .card[data-bucket-id="' + CSS.escape(k) + '"]');
          if (c) grid.appendChild(c);
        });
      }
    });
  });

  /* snapshot baseline order BEFORE applying saved order */
  sectionGrids().forEach(grid => {
    grid._baselineOrder = Array.from(grid.querySelectorAll(':scope > .card'))
      .map(c => c.dataset.bucketId).filter(Boolean);
    applyOrder(grid);
    wireGrid(grid);
  });

  /* ── accordion + filter + search persistence ── */
  /* accordions: persist .open after the existing handlers toggle the class */
  function persistOpen(scopeSel, keyFn){
    document.querySelectorAll(scopeSel).forEach(el => {
      const k = keyFn(el);
      if (!k) return;
      const saved = UI.get(k, null);
      if (saved === true)  el.classList.add('open');
      if (saved === false) el.classList.remove('open');
      /* sync the +/− toggle character */
      const tog = el.querySelector('.sb-tog, .yr-tog');
      if (tog) tog.textContent = el.classList.contains('open') ? '−' : '+';
    });
    /* observe class changes via click on header */
    document.querySelectorAll(scopeSel).forEach(el => {
      const head = el.querySelector('.sb-head, .yr-head');
      if (!head) return;
      head.addEventListener('click', () => {
        /* defer: existing handler also toggles synchronously, this fires after */
        const k = keyFn(el);
        if (k) UI.set(k, el.classList.contains('open'));
      });
    });
  }
  persistOpen('aside.sidebar .sb-section', el => 'sb:' + (el.dataset.anchor || el.querySelector('.sb-head')?.textContent?.trim() || ''));
  persistOpen('.yr-block', el => {
    const head = el.querySelector('.yr-head');
    return 'yr:' + ((head?.textContent || '').trim().replace(/\s+/g, '_'));
  });

  /* filter chips */
  (function restoreFilters(){
    const af = window.activeFilters;
    if (!af) return;
    const saved = UI.get('filters', null);
    if (saved && typeof saved === 'object') {
      ['tier','status','year'].forEach(g => {
        const arr = Array.isArray(saved[g]) ? saved[g] : [];
        arr.forEach(v => {
          const chip = document.querySelector('.chip-row[data-group="' + g + '"] .chip[data-v="' + CSS.escape(v) + '"]');
          if (chip) { chip.classList.add('active'); af[g].add(v); }
        });
      });
    }
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        UI.set('filters', { tier:[...af.tier], status:[...af.status], year:[...af.year] });
      });
    });
    const clr = document.getElementById('filter-clear');
    if (clr) clr.addEventListener('click', () => UI.del('filters'));
  })();

  /* search box */
  (function restoreSearch(){
    const s = document.getElementById('search');
    if (!s) return;
    const v = UI.get('search', '');
    if (v) { s.value = v; }
    let t = null;
    s.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (s.value) UI.set('search', s.value); else UI.del('search');
      }, 250);
    });
  })();

  /* apply restored filters/search exactly once */
  if (typeof window.applyFilters === 'function') window.applyFilters();
})();
