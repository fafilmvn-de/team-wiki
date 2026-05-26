/* semantic_editor.js — interactive Figma/Visio-style editor for semantic.json.

   Loads semantic/semantic.json over HTTP, edits in-memory, saves via HTTP PUT
   to /semantic/semantic.json (serve_admin.py handles .bak rotation + inline
   build of 08_Semantic_Model.html). Two canvas modes powered by Cytoscape.js:

     - Domain map  : hand-positioned domain bubbles + auto-ringed tables.
                     Drag a domain to update its x/y/radius. Edges are
                     domain↔domain relationships (kind=domain_link).
     - Table model : Power BI Model–style. Each table is a node with its
                     columns listed inside; drag from one column to another
                     to create an FK relationship (kind=fk). Auto-suggest
                     candidates from column-name matches across tables.

   Side panel: Inspector (selected entity form), Suggestions (candidate FKs
   with accept/reject), Data tables (browse all 6 tabs).

   Persistence convention mirrors admin.html / serve_admin.py exactly. */

(function(){
'use strict';

/* ──────────────────────────────────────────────────────────────────── */
/* helpers                                                             */
/* ──────────────────────────────────────────────────────────────────── */
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, m => (
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
));
const shortName = fqn => String(fqn||'').split('.').pop() || fqn || '';
const cloneDeep = o => JSON.parse(JSON.stringify(o));
const uuid = () => Math.random().toString(36).slice(2, 10);

const REL_KINDS = ['domain_link', 'fk', 'derived_from'];
const REL_CARDINALITIES = ['1:1', '1:n', 'n:1', 'n:n'];
const ACCESS_KINDS = ['R', 'W', 'RW'];

const FK_SUFFIX_RE = /(_no|_id|_code|_key|_num|_pk)$/i;

/* Solo-mode tuning. See docs/adr/0009-solo-mode-for-domain-map.md. */
const ZOOM_LABEL_THRESHOLD = 1.5;   // cy.zoom() above this reveals satellite labels in overview
const TIDY_RING_K          = 26;    // px multiplier on sqrt(count) for adaptive ring radius
const TIDY_RING_MIN        = 110;   // floor for the inner ring radius (px)
const TIDY_RING_GAP        = 56;    // additional gap between rings when spiralling
const TIDY_SPIRAL_AT       = 16;    // spill onto a second ring beyond this count
const GHOST_PUCK_INSET     = 60;    // px margin from canvas edge for ghost domain pucks

/* ──────────────────────────────────────────────────────────────────── */
/* state                                                                */
/* ──────────────────────────────────────────────────────────────────── */
const STATE = {
  data: null,            // full semantic.json payload
  etag: null,
  dirty: false,
  view: 'domain',        // 'domain' | 'table'
  sidePane: 'inspector', // 'inspector' | 'suggest' | 'data'
  dataTab: 'domains',
  selected: null,        // {kind: 'domain'|'table'|'rel'|'column', id: <unique>}
  cy: null,
  suggestionsCache: null,
  /* Solo mode (Domain-map view only). When set, only the focused domain's
     satellites render as labeled rings; all other domains become ghost pucks
     at the canvas perimeter. See enterSolo / exitSolo. */
  soloDomainId: null,
  labelsRevealed: false,   // toggled by cy zoom listener (overview state only)
};

function setStatus(kind, text){
  const s = $('#status'); s.className = 'status ' + kind;
  $('#status-text').textContent = text;
}

function markDirty(){
  STATE.dirty = true;
  STATE.suggestionsCache = null;
  $('#btn-save').disabled = false;
  setStatus('dirty', 'unsaved changes');
}

function toast(msg, kind){
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + (kind || '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(()=>{ t.className = 'toast'; }, 4200);
}

/* ──────────────────────────────────────────────────────────────────── */
/* load / save                                                          */
/* ──────────────────────────────────────────────────────────────────── */
async function loadData(){
  setStatus('', 'loading…');
  try {
    const r = await fetch('semantic/semantic.json', {cache:'no-store'});
    if (r.status === 404){
      // First run — show bootstrap modal.
      setStatus('error', 'semantic.json missing');
      openBootModal();
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    STATE.data = normalizeData(await r.json());
    STATE.etag = r.headers.get('ETag');
    STATE.dirty = false;
    STATE.suggestionsCache = null;
    $('#btn-save').disabled = true;
    setStatus('saved', 'loaded · ' + new Date().toLocaleTimeString());
    rerender();
    updateCounts();
    renderInspector();   // empty state
    renderSuggestions();
    renderDataTab();
  } catch (e){
    setStatus('error', "couldn't load semantic.json — " + e.message);
    toast('Load failed: ' + e.message, 'error');
  }
}

async function saveData(){
  if (!STATE.data) return;
  setStatus('', 'saving…');
  try {
    const body = JSON.stringify(STATE.data, null, 2);
    const headers = {'Content-Type': 'application/json; charset=utf-8'};
    if (STATE.etag) headers['If-Match'] = STATE.etag;
    const r = await fetch('semantic/semantic.json',
      {method:'PUT', body, headers});
    if (r.status === 412){
      toast('Save aborted: semantic.json changed on disk since you loaded it. Reload to merge.', 'error');
      setStatus('error', 'conflict');
      return;
    }
    if (!r.ok && r.status !== 204) throw new Error('HTTP ' + r.status);
    STATE.etag = r.headers.get('ETag');
    STATE.dirty = false;
    $('#btn-save').disabled = true;
    const buildStatus = r.headers.get('X-Build-Status');
    const buildMsg    = r.headers.get('X-Build-Message') || '';
    if (buildStatus === 'ok'){
      setStatus('saved', 'saved · ' + new Date().toLocaleTimeString());
      toast('Saved · ' + buildMsg, 'success');
    } else if (buildStatus === 'error'){
      setStatus('saved', 'saved (build failed)');
      toast('Saved but build failed: ' + buildMsg, 'warning');
    } else {
      setStatus('saved', 'saved · ' + new Date().toLocaleTimeString());
      toast('Saved.', 'success');
    }
  } catch (e){
    setStatus('error', 'save failed — ' + e.message);
    toast('Save failed: ' + e.message, 'error');
  }
}

/* Ensure all six tabs exist + a domain_id index on tables, etc. */
function normalizeData(raw){
  const out = {
    schema_version: raw.schema_version || 2,
    domains:           Array.isArray(raw.domains)           ? raw.domains           : [],
    tables:            Array.isArray(raw.tables)            ? raw.tables            : [],
    columns:           Array.isArray(raw.columns)           ? raw.columns           : [],
    relationships:     Array.isArray(raw.relationships)     ? raw.relationships     : [],
    bucket_table_xref: Array.isArray(raw.bucket_table_xref) ? raw.bucket_table_xref : [],
    meta:              Array.isArray(raw.meta)              ? raw.meta              : [],
  };
  // Coerce numeric fields on domains.
  out.domains.forEach(d => {
    if (d.x != null)      d.x      = Number(d.x);
    if (d.y != null)      d.y      = Number(d.y);
    if (d.radius != null) d.radius = Number(d.radius);
  });
  return out;
}

/* ──────────────────────────────────────────────────────────────────── */
/* bootstrap modal                                                      */
/* ──────────────────────────────────────────────────────────────────── */
function openBootModal(){ $('#boot-modal').classList.add('open'); }
function closeBootModal(){ $('#boot-modal').classList.remove('open'); $('#boot-err').textContent = ''; }

async function importXlsx(file){
  if (!file) return;
  setStatus('', 'importing xlsx…');
  try {
    const r = await fetch('upload-semantic', {method:'POST', body: file});
    const j = await r.json();
    if (!r.ok){
      const errs = (j.errors||[]).join('\n  • ');
      throw new Error(j.error + (errs ? '\n  • ' + errs : ''));
    }
    closeBootModal();
    toast('Imported · ' + (j.build_message || ''), 'success');
    await loadData();
  } catch (e){
    setStatus('error', 'import failed');
    $('#boot-err').textContent = e.message;
    toast('Import failed: ' + e.message, 'error');
  }
}

async function exportXlsx(){
  setStatus('', 'exporting xlsx…');
  try {
    const r = await fetch('export-semantic-xlsx', {method:'POST'});
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    setStatus('saved', 'exported');
    toast('Exported · ' + j.xlsx_path + ' (' + (j.bytes||0).toLocaleString() + ' bytes)', 'success');
  } catch (e){
    setStatus('error', 'export failed');
    toast('Export failed: ' + e.message, 'error');
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/* index helpers                                                        */
/* ──────────────────────────────────────────────────────────────────── */
function tablesByDomain(){
  const out = {};
  for (const t of STATE.data.tables){
    const did = t.domain_id;
    if (!did) continue;
    (out[did] = out[did] || []).push(t);
  }
  return out;
}

function findDomain(id){ return STATE.data.domains.find(d => d.domain_id === id); }
function findTable(fqn){ return STATE.data.tables.find(t => t.table_fqn === fqn); }
function findRelIdx(r){
  // Match by canonical key (from|to|kind|from_col|to_col)
  return STATE.data.relationships.findIndex(x =>
    x.from === r.from && x.to === r.to && x.kind === r.kind
    && (x.from_column||'') === (r.from_column||'')
    && (x.to_column||'')   === (r.to_column||''));
}

function updateCounts(){
  if (!STATE.data) return;
  $('#n-domains').textContent = STATE.data.domains.length;
  $('#n-tables').textContent  = STATE.data.tables.length;
  $('#n-columns').textContent = STATE.data.columns.length;
  $('#n-rels').textContent    = STATE.data.relationships.length;
  $('#n-xref').textContent    = STATE.data.bucket_table_xref.length;
  $('#n-meta').textContent    = STATE.data.meta.length;
  const sc = computeSuggestions().length;
  $('#suggest-count').textContent  = sc;
  $('#suggest-count2').textContent = sc;
}

/* ──────────────────────────────────────────────────────────────────── */
/* cytoscape — common                                                   */
/* ──────────────────────────────────────────────────────────────────── */
function initCy(){
  STATE.cy = cytoscape({
    container: $('#cy'),
    elements: [],
    wheelSensitivity: 0.25,
    boxSelectionEnabled: false,
    style: cyStyle(),
    layout: { name: 'preset' },
  });

  // Selection → inspector. In Domain-map view, clicking a domain puck also
  // toggles Solo mode (per ADR 0009). Ghost pucks re-solo their target domain.
  STATE.cy.on('tap', 'node', e => {
    const n = e.target;
    const d = n.data();
    if (d.kind === 'domain'){
      selectEntity('domain', d.id_raw);
      if (STATE.view === 'domain'){
        if (STATE.soloDomainId === d.id_raw) exitSolo();
        else enterSolo(d.id_raw);
      }
    }
    else if (d.kind === 'ghost'){
      if (STATE.view === 'domain') enterSolo(d.id_raw);
      selectEntity('domain', d.id_raw);
    }
    else if (d.kind === 'table') selectEntity('table', d.fqn);
    else if (d.kind === 'column') selectEntity('column', d.fqn + '.' + d.column);
  });
  STATE.cy.on('tap', 'edge', e => {
    const d = e.target.data();
    if (d.relIdx != null) selectEntity('rel', d.relIdx);
  });
  STATE.cy.on('tap', e => {
    if (e.target === STATE.cy){
      selectEntity(null);
      // Clicking the empty canvas exits Solo mode (one of the four exits).
      if (STATE.view === 'domain' && STATE.soloDomainId) exitSolo();
    }
  });

  // Zoom-threshold label reveal — only meaningful in overview state.
  STATE.cy.on('zoom', () => {
    if (STATE.view !== 'domain') return;
    if (STATE.soloDomainId) return;  // solo state always labels its satellites
    const want = STATE.cy.zoom() >= ZOOM_LABEL_THRESHOLD;
    if (want === STATE.labelsRevealed) return;
    STATE.labelsRevealed = want;
    STATE.cy.nodes('node[kind="table"][viewMode="dot"]').forEach(n => {
      n.data('labels', want ? '1' : '0');
    });
  });

  // Live-drag domain → keep its ring of table satellites attached.
  // Satellites may be in "ring" mode (solo state) or "dot" mode (overview).
  STATE.cy.on('drag', 'node[kind="domain"]', e => {
    if (STATE.view !== 'domain') return;
    const did = e.target.data('id_raw');
    const pos = e.target.position();
    STATE.cy.nodes('node[kind="table"][parentDom="' + cssEsc(did) + '"]')
      .forEach(n => {
        n.position({
          x: pos.x + (n.data('offX') || 0),
          y: pos.y + (n.data('offY') || 0),
        });
      });
  });

  // Drag domain → update x/y (Domain map view only)
  STATE.cy.on('dragfree', 'node', e => {
    const d = e.target.data();
    if (STATE.view === 'domain' && d.kind === 'domain'){
      const pos = e.target.position();
      const dom = findDomain(d.id_raw);
      if (dom){
        // Map cy pixel-position back to the 0–100 normalized coords used by SoT.
        const ext = STATE.cy.extent();
        const W = ext.w, H = ext.h, x0 = ext.x1, y0 = ext.y1;
        const nx = clamp(((pos.x - x0) / W) * 100, 0, 100);
        const ny = clamp(((pos.y - y0) / H) * 100, 0, 100);
        dom.x = Math.round(nx);
        dom.y = Math.round(ny);
        markDirty();
      }
    } else if (STATE.view === 'domain' && d.kind === 'table' && STATE.soloDomainId
               && d.viewMode === 'ring' && d.parentDom === STATE.soloDomainId){
      // Solo mode: dragging a satellite persists its offset relative to the
      // focused domain center, so the layout survives reload.
      const pos = e.target.position();
      const domNode = STATE.cy.$id('d::' + STATE.soloDomainId);
      if (!domNode.empty()){
        const cpos = domNode.position();
        const t = findTable(d.fqn);
        if (t){ writeSoloOffset(t, pos.x - cpos.x, pos.y - cpos.y); markDirty(); }
      }
    } else if (STATE.view === 'table' && d.kind === 'table'){
      // Table-model: persist table positions in meta.table_positions JSON.
      const pos = e.target.position();
      setTablePosition(d.fqn, pos.x, pos.y);
      markDirty();
    }
  });
}

function clamp(v, lo, hi){ return Math.min(hi, Math.max(lo, v)); }
function cssEsc(s){ return String(s).replace(/(["\\])/g, '\\$1'); }

function cyStyle(){
  return [
    // domain bubbles
    { selector: 'node[kind="domain"]', style: {
      'shape':'ellipse',
      'background-color':'data(color)',
      'background-opacity': 0.10,
      'border-color':'data(color)','border-width':2.5,
      'border-opacity':0.55,
      'width':'data(diameter)','height':'data(diameter)',
      'label':'data(label)','color':'data(color)','font-size':14,'font-weight':600,
      'text-valign':'top','text-margin-y':-6,
      'text-background-color':'#FFFFFF','text-background-opacity':0.9,
      'text-background-padding':4,'text-background-shape':'roundrectangle',
    }},
    { selector: 'node[kind="domain"]:selected', style: {
      'border-width':4, 'border-opacity':0.85,
      'background-opacity':0.18,
    }},
    // table satellites in domain view
    { selector: 'node[kind="table"][viewMode="ring"]', style: {
      'shape':'round-rectangle',
      'background-color':'data(layerColor)','border-color':'data(layerColor)',
      'border-width':1.5,
      'width':'label','height':22,'padding':6,
      'label':'data(label)','color':'#FFFFFF','font-size':10.5,'font-weight':600,
      'text-valign':'center','text-halign':'center',
      'font-family':'ui-monospace,Menlo,Consolas,monospace',
    }},
    { selector: 'node[kind="table"][viewMode="ring"]:selected', style: {
      'border-color':'#141413','border-width':2.5,
    }},
    // tiny unlabeled satellite dots — default overview state per ADR 0009.
    { selector: 'node[kind="table"][viewMode="dot"]', style: {
      'shape':'ellipse',
      'background-color':'data(layerColor)','background-opacity':0.85,
      'border-color':'data(layerColor)','border-width':0,
      'width':6,'height':6,
      'label':'','text-opacity':0,
    }},
    { selector: 'node[kind="table"][viewMode="dot"]:selected', style: {
      'border-width':2,'border-color':'#141413','width':9,'height':9,
    }},
    // satellite dots reveal labels above the zoom threshold (overview-only).
    { selector: 'node[kind="table"][viewMode="dot"][labels="1"]', style: {
      'label':'data(label)','text-opacity':1,
      'font-size':10,'font-family':'ui-monospace,Menlo,Consolas,monospace',
      'color':'data(layerColor)','text-valign':'bottom','text-margin-y':4,
      'text-background-color':'#FAF9F5','text-background-opacity':0.85,
      'text-background-padding':2,'text-background-shape':'roundrectangle',
    }},
    // ghost domain pucks — peripheral, dimmed, click to re-solo.
    { selector: 'node[kind="ghost"]', style: {
      'shape':'ellipse',
      'background-color':'data(color)','background-opacity':0.06,
      'border-color':'data(color)','border-width':1.5,
      'border-opacity':0.35,'border-style':'dashed',
      'width':54,'height':54,
      'label':'data(label)','color':'data(color)','font-size':11,'font-weight':600,
      'text-valign':'center','text-halign':'center','text-opacity':0.75,
      'text-background-color':'#FAF9F5','text-background-opacity':0.85,
      'text-background-padding':3,'text-background-shape':'roundrectangle',
    }},
    { selector: 'node[kind="ghost"]:active', style: {
      'background-opacity':0.16,'border-opacity':0.65,
    }},
    // table cards (table-model view)
    { selector: 'node[kind="table"][viewMode="card"]', style: {
      'shape':'round-rectangle','background-color':'#FFFFFF',
      'border-color':'data(layerColor)','border-width':2,
      'width':210,'height':'data(cardHeight)',
      'label':'data(label)','text-opacity':1,
      'text-valign':'center','text-halign':'center','text-margin-y':'data(textMarginY)',
      'text-wrap':'wrap','text-max-width':190,
      'font-size':11,'font-weight':600,'color':'data(layerColor)',
      'line-height':1.25,
    }},
    { selector: 'node[kind="table"][viewMode="card"]:selected', style: {
      'border-width':3.5,'border-color':'#141413',
    }},
    { selector: 'node[kind="column"]', style: {
      'shape':'round-rectangle','background-color':'#FAF9F5',
      'border-color':'#D1CFC5','border-width':1,
      'width':190,'height':18,
      'label':'data(label)','font-size':10.5,'color':'#141413',
      'text-valign':'center','text-halign':'center',
      'font-family':'ui-monospace,Menlo,Consolas,monospace',
    }},
    { selector: 'node[kind="column"][isPk="1"]', style: {
      'background-color':'#FFF6E5','border-color':'#C78E3F','border-width':1.5,
    }},
    { selector: 'node[kind="column"][isPii="1"]', style: {
      'border-color':'#A8453A','border-width':1.5,
    }},
    { selector: 'node[kind="column"]:selected', style: {
      'border-color':'#141413','border-width':2,
    }},
    // edges
    { selector: 'edge', style: {
      'curve-style':'bezier','width':1.5,'line-color':'#9c9b95',
      'target-arrow-color':'#9c9b95','target-arrow-shape':'triangle',
      'label':'data(label)','font-size':9.5,'color':'#6F6E68',
      'font-family':'ui-monospace,Menlo,Consolas,monospace',
      'text-rotation':'autorotate','text-background-color':'#FAF9F5',
      'text-background-opacity':0.85,'text-background-padding':2,
    }},
    { selector: 'edge[kind="domain_link"]', style: {
      'line-color':'#5C7CA3','target-arrow-color':'#5C7CA3','width':2.5,
      'line-style':'solid',
    }},
    // aggregated puck-to-puck FK / derived_from rollup in overview state.
    { selector: 'edge[kind="aggregated"]', style: {
      'curve-style':'bezier','width':'data(weight)','line-color':'#A8997C',
      'target-arrow-shape':'none','line-opacity':0.55,'line-style':'solid',
      'label':'data(label)','font-size':9.5,'color':'#6F6E68',
      'font-family':'ui-monospace,Menlo,Consolas,monospace',
      'text-rotation':'autorotate','text-background-color':'#FAF9F5',
      'text-background-opacity':0.9,'text-background-padding':2,
    }},
    { selector: 'edge[kind="fk"]', style: {
      'line-color':'#D97757','target-arrow-color':'#D97757','width':2,
    }},
    { selector: 'edge[kind="derived_from"]', style: {
      'line-color':'#788C5D','target-arrow-color':'#788C5D','width':2,
      'line-style':'dashed',
    }},
    { selector: 'edge:selected', style: {
      'width':4,'line-color':'#141413','target-arrow-color':'#141413',
    }},
    // edge-handle for drag-to-connect
    { selector: 'node.eh-handle', style: {
      'background-color':'#D97757','width':10,'height':10,
      'border-width':0,
    }},
  ];
}

/* ──────────────────────────────────────────────────────────────────── */
/* domain map view                                                      */
/* ──────────────────────────────────────────────────────────────────── */
function renderDomainMap(){
  const cy = STATE.cy;
  cy.elements().remove();
  // Reset zoom-label state each render — overview only tracks zoom labels.
  STATE.labelsRevealed = false;
  if (STATE.soloDomainId) renderDomainSolo();
  else renderDomainOverview();
  renderLegend();
  updateSoloControls();
}

/* ── overview state (default) ──────────────────────────────────────── */
function renderDomainOverview(){
  const cy = STATE.cy;
  const W = cy.width() || 1000;
  const H = cy.height() || 700;
  const elems = [];

  for (const d of STATE.data.domains){
    const px = (d.x ?? 50) * W / 100;
    const py = (d.y ?? 50) * H / 100;
    const dia = ((d.radius ?? 80) * 2);
    const tcount = (tablesByDomain()[d.domain_id] || []).length;
    elems.push({
      group: 'nodes',
      data: { id: 'd::' + d.domain_id, kind:'domain', id_raw: d.domain_id,
              label: (d.icon||'') + ' ' + (d.domain_name || d.domain_id) +
                     (tcount ? '  ·  ' + tcount + ' table' + (tcount===1?'':'s') : ''),
              color: d.color || '#6366F1', diameter: dia, },
      position: { x: px, y: py },
      grabbable: true,
    });
  }

  // Satellites as tiny dots — cardinality as visual texture, no labels.
  const byDom = tablesByDomain();
  const writtenBy = computeWrittenBy();
  for (const d of STATE.data.domains){
    const dtables = byDom[d.domain_id] || [];
    if (!dtables.length) continue;
    const cx = (d.x ?? 50) * W / 100;
    const cy_ = (d.y ?? 50) * H / 100;
    const r = (d.radius ?? 80) + 22;
    const visibles = dtables.filter(t => {
      const layer = writtenBy[t.table_fqn] ? 'curated' : 'raw';
      return layer === 'raw' || t.share === true;
    });
    const n = visibles.length;
    visibles.forEach((t, i) => {
      const layer = writtenBy[t.table_fqn] ? 'curated' : 'raw';
      const angle = (i / n) * Math.PI * 2 - Math.PI/2;
      const offX = Math.cos(angle) * r;
      const offY = Math.sin(angle) * r;
      elems.push({
        group: 'nodes',
        data: { id: 't::' + t.table_fqn, kind:'table', fqn: t.table_fqn,
                viewMode: 'dot', labels: '0',
                label: t.short_name || shortName(t.table_fqn),
                layerColor: layer === 'curated' ? '#D97757' : '#5C7CA3',
                parentDom: d.domain_id, offX, offY, },
        position: { x: cx + offX, y: cy_ + offY },
        grabbable: false,
      });
    });
  }

  // Edges in overview = domain↔domain (explicit domain_link) +
  // aggregated FK/derived_from rollups between domain pucks.
  STATE.data.relationships.forEach((r, idx) => {
    if (r.kind !== 'domain_link') return;
    if (!findDomain(r.from) || !findDomain(r.to)) return;
    elems.push({
      group: 'edges',
      data: { id: 'e::' + idx, source: 'd::' + r.from, target: 'd::' + r.to,
              kind: r.kind, relIdx: idx, label: r.cardinality || '' },
    });
  });
  for (const agg of computeAggregatedDomainEdges()){
    elems.push({
      group: 'edges',
      data: { id: 'agg::' + agg.from + '::' + agg.to,
              source: 'd::' + agg.from, target: 'd::' + agg.to,
              kind: 'aggregated', weight: Math.min(6, 1.2 + Math.log2(agg.count + 1)),
              label: '× ' + agg.count, aggCount: agg.count, },
    });
  }

  STATE.cy.add(elems);
  STATE.cy.layout({ name:'preset', animate:false }).run();
}

/* ── solo state — focused domain with ghosts on the perimeter ──────── */
function renderDomainSolo(){
  const cy = STATE.cy;
  const W = cy.width() || 1000;
  const H = cy.height() || 700;
  const focus = findDomain(STATE.soloDomainId);
  if (!focus){
    // Stale solo id (e.g. domain deleted) — fall back gracefully.
    STATE.soloDomainId = null;
    return renderDomainOverview();
  }
  const elems = [];

  // Focused domain re-centered on canvas; preserves user x/y in data so that
  // exiting solo restores spatial memory.
  const cx = (focus.x ?? 50) * W / 100;
  const cy_ = (focus.y ?? 50) * H / 100;
  const dia = ((focus.radius ?? 80) * 2);
  elems.push({
    group: 'nodes',
    data: { id: 'd::' + focus.domain_id, kind:'domain', id_raw: focus.domain_id,
            label: (focus.icon||'') + ' ' + (focus.domain_name || focus.domain_id),
            color: focus.color || '#6366F1', diameter: dia, },
    position: { x: cx, y: cy_ },
    grabbable: true,
  });

  // Focused domain's tables — labeled ring at stored hand-positions.
  const writtenBy = computeWrittenBy();
  const dtables = (tablesByDomain()[focus.domain_id] || []).filter(t => {
    const layer = writtenBy[t.table_fqn] ? 'curated' : 'raw';
    return layer === 'raw' || t.share === true;
  });
  const r0 = (focus.radius ?? 80) + 32;
  const n = dtables.length;
  dtables.forEach((t, i) => {
    const stored = readSoloOffset(t);
    let offX, offY;
    if (stored){
      offX = stored.x; offY = stored.y;
    } else {
      const angle = (i / Math.max(n,1)) * Math.PI * 2 - Math.PI/2;
      offX = Math.cos(angle) * r0;
      offY = Math.sin(angle) * r0;
    }
    const layer = writtenBy[t.table_fqn] ? 'curated' : 'raw';
    elems.push({
      group: 'nodes',
      data: { id: 't::' + t.table_fqn, kind:'table', fqn: t.table_fqn,
              viewMode: 'ring', labels: '1',
              label: t.short_name || shortName(t.table_fqn),
              layerColor: layer === 'curated' ? '#D97757' : '#5C7CA3',
              parentDom: focus.domain_id, offX, offY, },
      position: { x: cx + offX, y: cy_ + offY },
      grabbable: true,
    });
  });

  // Ghost pucks for every other domain — placed at the canvas perimeter in
  // the direction of their un-soloed position (preserves spatial memory).
  for (const d of STATE.data.domains){
    if (d.domain_id === focus.domain_id) continue;
    const pos = ghostPuckPosition(focus, d, W, H);
    elems.push({
      group: 'nodes',
      data: { id: 'g::' + d.domain_id, kind:'ghost', id_raw: d.domain_id,
              label: (d.icon || '') + ' ' + (d.domain_name || d.domain_id),
              color: d.color || '#6366F1', },
      position: pos,
      grabbable: false,
    });
  }

  // Intra-domain edges for the focused domain — FK / derived_from / domain_link
  // where both endpoints belong to (or reference) the focused domain.
  STATE.data.relationships.forEach((r, idx) => {
    const ep = relEndpointDomains(r);
    if (!ep) return;
    const fromIn = ep.fromDom === focus.domain_id;
    const toIn   = ep.toDom   === focus.domain_id;
    if (!fromIn && !toIn) return;
    if (r.kind === 'domain_link'){
      // surfaces to ghost puck on the "other" side
      if (fromIn && toIn) return;
      const other = fromIn ? r.to : r.from;
      const otherNode = STATE.cy.$id('g::' + other);
      if (!findDomain(other)) return;
      elems.push({
        group: 'edges',
        data: { id: 'e::' + idx,
                source: fromIn ? 'd::' + focus.domain_id : 'g::' + other,
                target: toIn   ? 'd::' + focus.domain_id : 'g::' + other,
                kind: r.kind, relIdx: idx, label: r.cardinality || '' },
      });
      return;
    }
    // fk / derived_from are table-level — endpoints become satellite ids,
    // with stubs to ghost pucks for cross-domain references.
    const sourceId = ep.fromDom === focus.domain_id ? 't::' + r.from : 'g::' + ep.fromDom;
    const targetId = ep.toDom   === focus.domain_id ? 't::' + r.to   : 'g::' + ep.toDom;
    if (!findDomain(ep.fromDom) || !findDomain(ep.toDom)) return;
    elems.push({
      group: 'edges',
      data: { id: 'e::' + idx, source: sourceId, target: targetId,
              kind: r.kind, relIdx: idx,
              label: (r.from_column && r.to_column)
                       ? r.from_column + ' → ' + r.to_column
                       : (r.cardinality || '') },
    });
  });

  STATE.cy.add(elems);
  STATE.cy.layout({ name:'preset', animate:false }).run();
  // Centre on the focused domain so the user always sees it dead-centre.
  STATE.cy.animate({
    center: { eles: STATE.cy.$id('d::' + focus.domain_id) },
    zoom: Math.max(STATE.cy.zoom(), 1.0),
  }, { duration: 220 });
}

/* ── solo helpers ──────────────────────────────────────────────────── */
function relEndpointDomains(r){
  if (r.kind === 'domain_link'){
    if (!findDomain(r.from) || !findDomain(r.to)) return null;
    return { fromDom: r.from, toDom: r.to };
  }
  const ft = findTable(r.from), tt = findTable(r.to);
  if (!ft || !tt) return null;
  return { fromDom: ft.domain_id, toDom: tt.domain_id };
}

function computeAggregatedDomainEdges(){
  const counts = new Map();   // key "A→B" → count
  for (const r of STATE.data.relationships){
    if (r.kind !== 'fk' && r.kind !== 'derived_from') continue;
    const ep = relEndpointDomains(r);
    if (!ep || !ep.fromDom || !ep.toDom) continue;
    if (ep.fromDom === ep.toDom) continue;        // intra-domain stays inside
    const k = ep.fromDom + '\u0001' + ep.toDom;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([k, v]) => {
    const [from, to] = k.split('\u0001');
    return { from, to, count: v };
  });
}

function ghostPuckPosition(focus, other, W, H){
  // Direction = vector from focused domain's saved position to other's saved
  // position. Project the ray to an inset rectangle centred on the canvas
  // (regardless of where the focused puck sits) so labels stay readable.
  const fx = (focus.x ?? 50), fy = (focus.y ?? 50);
  const ox = (other.x ?? 50), oy = (other.y ?? 50);
  let dx = ox - fx, dy = oy - fy;
  const L = Math.hypot(dx, dy);
  if (L < 0.01){ dx = 1; dy = 0; }
  dx /= (L || 1); dy /= (L || 1);
  const cx = fx * W / 100, cy_ = fy * H / 100;
  const halfW = W/2 - GHOST_PUCK_INSET;
  const halfH = H/2 - GHOST_PUCK_INSET;
  // t such that ray hits the inset rectangle centred at (W/2, H/2).
  const tx = dx !== 0 ? (W/2 + Math.sign(dx) * halfW - cx) / dx : Infinity;
  const ty = dy !== 0 ? (H/2 + Math.sign(dy) * halfH - cy_) / dy : Infinity;
  const t = Math.min(Math.abs(tx), Math.abs(ty));
  return { x: cx + dx * t, y: cy_ + dy * t };
}

function soloOffsetMap(){
  // Persistent per-domain solo-mode offsets, keyed on (domain_id, table_fqn).
  // Stored in meta.solo_offsets as a JSON map so they survive reload.
  let m = (STATE.data.meta || []).find(r => r.key === 'solo_offsets');
  if (!m || !m.value) return {};
  try { return JSON.parse(m.value); } catch { return {}; }
}
function writeSoloOffsetMap(map){
  let m = (STATE.data.meta || []).find(r => r.key === 'solo_offsets');
  if (!m){ m = {key:'solo_offsets', value:''}; STATE.data.meta.push(m); }
  m.value = JSON.stringify(map);
}
function readSoloOffset(t){
  const map = soloOffsetMap();
  const k = t.domain_id + '\u0001' + t.table_fqn;
  return map[k] || null;
}
function writeSoloOffset(t, x, y){
  const map = soloOffsetMap();
  const k = t.domain_id + '\u0001' + t.table_fqn;
  map[k] = {x: Math.round(x), y: Math.round(y)};
  writeSoloOffsetMap(map);
}

function enterSolo(domainId){
  if (!findDomain(domainId)) return;
  if (STATE.soloDomainId === domainId) return;
  STATE.soloDomainId = domainId;
  if (STATE.view !== 'domain') setView('domain');     // setView() triggers rerender
  else rerender();
}
function exitSolo(){
  if (!STATE.soloDomainId) return;
  STATE.soloDomainId = null;
  rerender();
}

function tidySoloLayout(){
  if (!STATE.soloDomainId) return;
  const focus = findDomain(STATE.soloDomainId);
  if (!focus) return;
  const writtenBy = computeWrittenBy();
  const dtables = (tablesByDomain()[focus.domain_id] || []).filter(t => {
    const layer = writtenBy[t.table_fqn] ? 'curated' : 'raw';
    return layer === 'raw' || t.share === true;
  });
  const n = dtables.length;
  if (!n) return;
  // Adaptive radius: sqrt(count)·k, clamped, with extra room beyond the
  // domain's own radius. Spill onto a second ring when count > threshold.
  const baseR = (focus.radius ?? 80);
  const r1 = Math.max(TIDY_RING_MIN, baseR + Math.sqrt(n) * TIDY_RING_K);
  const spiral = n > TIDY_SPIRAL_AT;
  const inner = spiral ? Math.ceil(n * 0.45) : n;
  const outer = n - inner;
  const r2 = r1 + TIDY_RING_GAP;
  dtables.forEach((t, i) => {
    let radius, angle;
    if (!spiral || i < inner){
      const k = spiral ? inner : n;
      radius = r1;
      angle  = (i / k) * Math.PI * 2 - Math.PI/2;
    } else {
      const j = i - inner;
      radius = r2;
      angle  = (j / Math.max(outer,1)) * Math.PI * 2 - Math.PI/2 + Math.PI/Math.max(outer,1);
    }
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    writeSoloOffset(t, x, y);
  });
  markDirty();
  rerender();
  toast('Tidied · ' + n + ' tables relayed out into ' + (spiral ? 'a spiral.' : 'a ring.'), '');
}

function updateSoloControls(){
  const wrap = document.getElementById('solo-controls');
  if (!wrap) return;
  if (STATE.view !== 'domain' || !STATE.soloDomainId){
    wrap.classList.remove('open');
    return;
  }
  const d = findDomain(STATE.soloDomainId);
  const name = d ? (d.domain_name || d.domain_id) : STATE.soloDomainId;
  const label = wrap.querySelector('.solo-label');
  if (label) label.textContent = name;
  wrap.classList.add('open');
}

function computeWrittenBy(){
  const out = {};
  for (const x of STATE.data.bucket_table_xref || []){
    if (!x.table_fqn || !x.bucket_id) continue;
    const a = String(x.access || '').toUpperCase();
    if (a === 'W' || a === 'RW'){
      (out[x.table_fqn] = out[x.table_fqn] || []).push(x.bucket_id);
    }
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────── */
/* table model view                                                     */
/* ──────────────────────────────────────────────────────────────────── */
function getTablePositions(){
  const m = (STATE.data.meta || []).find(r => r.key === 'table_positions');
  if (!m || !m.value) return {};
  try { return JSON.parse(m.value); } catch { return {}; }
}
function setTablePosition(fqn, x, y){
  let m = (STATE.data.meta || []).find(r => r.key === 'table_positions');
  let map = {};
  if (m && m.value){ try { map = JSON.parse(m.value); } catch {} }
  map[fqn] = {x: Math.round(x), y: Math.round(y)};
  if (!m){ m = {key:'table_positions', value:''}; STATE.data.meta.push(m); }
  m.value = JSON.stringify(map);
}

function renderTableModel(){
  const cy = STATE.cy;
  cy.elements().remove();
  const positions = getTablePositions();
  const writtenBy = computeWrittenBy();

  const W = cy.width() || 1200;
  const elems = [];
  const colsByTable = {};
  for (const c of STATE.data.columns){
    if (!c.table_fqn) continue;
    (colsByTable[c.table_fqn] = colsByTable[c.table_fqn] || []).push(c);
  }

  // Auto-layout fallback grid for tables without saved positions.
  const tables = STATE.data.tables.slice();
  const cardW = 220, cardSpacingX = 280, cardSpacingY = 60;
  let auto_i = 0;
  const perRow = Math.max(3, Math.floor(W / cardSpacingX));

  for (const t of tables){
    const cols = colsByTable[t.table_fqn] || [];
    const layer = writtenBy[t.table_fqn] ? 'curated' : 'raw';
    // Header = table short_name + parent domain (2 wrapped lines).
    const dom = findDomain(t.domain_id);
    const domLabel = dom ? ((dom.icon ? dom.icon + ' ' : '') +
                            (dom.domain_name || dom.domain_id))
                         : (t.domain_id || '— no domain —');
    const tblLabel = t.short_name || shortName(t.table_fqn);
    const headerH = 52;  // room for 2 lines of header text
    const cardH = headerH + cols.length * 22 + 8;  // header + rows + padding
    let px, py;
    if (positions[t.table_fqn]){
      px = positions[t.table_fqn].x; py = positions[t.table_fqn].y;
    } else {
      const row = Math.floor(auto_i / perRow), col = auto_i % perRow;
      px = 80 + col * cardSpacingX; py = 80 + row * (cardH + cardSpacingY);
      auto_i++;
    }

    elems.push({
      group: 'nodes',
      data: { id: 't::' + t.table_fqn, kind:'table', fqn: t.table_fqn,
              viewMode:'card',
              label: tblLabel + '\n' + domLabel,
              layerColor: layer === 'curated' ? '#D97757' : '#5C7CA3',
              cardHeight: cardH, headerHeight: headerH,
              // text-valign:center anchors label at node centre; shift it up
              // so the 2-line header sits centred inside the top header band.
              textMarginY: -(cardH/2 - headerH/2), },
      position: {x: px, y: py},
      grabbable: true,
    });

    // Column rows sit below the header band.
    cols.forEach((c, i) => {
      const isPk = /primary key|PK/i.test(c.description || '') || (c.column === 'customer_id' || c.column === 'order_id' || c.column === 'product_id' || c.column === '_id');
      elems.push({
        group: 'nodes',
        data: { id: 'c::' + t.table_fqn + '::' + c.column,
                kind:'column', fqn: t.table_fqn, column: c.column,
                label: c.column + ' : ' + (c.type || '?'),
                isPk: isPk ? '1' : '0',
                isPii: c.pii ? '1' : '0', },
        position: {x: px, y: py - cardH/2 + headerH + 11 + i * 22},
        grabbable: false,
        selectable: true,
      });
    });
  }

  // Edges: FK relationships at column level.
  STATE.data.relationships.forEach((r, idx) => {
    if (r.kind === 'domain_link') return;  // skip domain edges in this view
    const fromTbl = findTable(r.from);
    const toTbl   = findTable(r.to);
    if (!fromTbl || !toTbl) return;
    let source, target;
    if (r.from_column && r.to_column){
      source = 'c::' + r.from + '::' + r.from_column;
      target = 'c::' + r.to   + '::' + r.to_column;
    } else {
      source = 't::' + r.from;
      target = 't::' + r.to;
    }
    // Only add if endpoints exist (column may have been deleted).
    if (cy.$id(source).empty() && source.startsWith('c::')) source = 't::' + r.from;
    if (cy.$id(target).empty() && target.startsWith('c::')) target = 't::' + r.to;
    elems.push({
      group: 'edges',
      data: { id: 'e::' + idx, source, target, kind: r.kind, relIdx: idx,
              label: r.cardinality || '' },
    });
  });

  cy.add(elems);

  // When a table card is dragged, move its column nodes along with it.
  cy.off('drag', 'node.table-card-drag');
  cy.on('drag', 'node[kind="table"][viewMode="card"]', e => {
    const t = e.target;
    const fqn = t.data('fqn');
    const cardH = t.data('cardHeight');
    const headerH = t.data('headerHeight') || 52;
    const pos = t.position();
    const cols = cy.nodes('node[kind="column"][fqn="' + fqn.replace(/"/g, '\\"') + '"]');
    cols.forEach((cn, i) => {
      cn.position({x: pos.x, y: pos.y - cardH/2 + headerH + 11 + i * 22});
    });
  });

  // Drag-to-connect at column level: alt+drag (cytoscape stock doesn't ship
  // edgehandles; implement a minimal handler).
  enableConnectMode();

  renderLegend();
}

/* ──────────────────────────────────────────────────────────────────── */
/* drag-to-connect (minimal — no extension needed)                      */
/* ──────────────────────────────────────────────────────────────────── */
let _conn = null;
function enableConnectMode(){
  const cy = STATE.cy;
  cy.off('mousedown', 'node[kind="column"]');
  cy.off('mousedown', 'node[kind="domain"]');
  cy.off('mousemove');
  cy.off('mouseup');

  cy.on('mousedown', 'node[kind="column"]', e => {
    if (!e.originalEvent.shiftKey) return;  // shift+drag = connect mode
    e.preventDefault();
    _conn = { from: e.target, kind: 'fk', startPos: e.position };
  });
  cy.on('mousedown', 'node[kind="domain"]', e => {
    if (!e.originalEvent.shiftKey) return;
    e.preventDefault();
    _conn = { from: e.target, kind: 'domain_link', startPos: e.position };
  });
  cy.on('mouseup', e => {
    if (!_conn) return;
    const tgt = e.target;
    if (tgt && tgt !== cy && tgt.isNode && tgt.isNode()){
      tryCreateConnection(_conn, tgt);
    }
    _conn = null;
  });
}

function tryCreateConnection(conn, targetNode){
  const a = conn.from.data(), b = targetNode.data();
  if (conn.kind === 'domain_link' && a.kind === 'domain' && b.kind === 'domain' && a.id_raw !== b.id_raw){
    openRelModal({ from: a.id_raw, to: b.id_raw, kind: 'domain_link' });
  } else if (conn.kind === 'fk' && a.kind === 'column' && b.kind === 'column'
             && (a.fqn !== b.fqn || a.column !== b.column)){
    openRelModal({
      from: a.fqn, to: b.fqn, kind: 'fk',
      from_column: a.column, to_column: b.column,
      cardinality: 'n:1',
    });
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/* legend                                                               */
/* ──────────────────────────────────────────────────────────────────── */
function renderLegend(){
  const items = [];
  if (STATE.view === 'domain'){
    items.push(['Raw table', '#5C7CA3']);
    items.push(['Curated table', '#D97757']);
    items.push(['Domain link', '#5C7CA3']);
    items.push(['Shift+drag a bubble to connect domains', null]);
  } else {
    items.push(['FK edge', '#D97757']);
    items.push(['Derived-from', '#788C5D']);
    items.push(['PK column (heuristic)', '#C78E3F']);
    items.push(['Shift+drag a column to create FK', null]);
  }
  $('#legend').innerHTML = items.map(it =>
    it[1]
      ? `<span><span class="swatch" style="background:${it[1]}"></span>${escapeHtml(it[0])}</span>`
      : `<span style="color:var(--g500);font-style:italic">${escapeHtml(it[0])}</span>`
  ).join('');
}

/* ──────────────────────────────────────────────────────────────────── */
/* view switching                                                       */
/* ──────────────────────────────────────────────────────────────────── */
function setView(v){
  if (v === STATE.view) return;
  STATE.view = v;
  // Solo lives only inside Domain map; switching views always exits it.
  if (v !== 'domain') STATE.soloDomainId = null;
  $('#vt-domain').classList.toggle('active', v === 'domain');
  $('#vt-table').classList.toggle('active', v === 'table');
  $('#vt-domain').setAttribute('aria-selected', v === 'domain' ? 'true' : 'false');
  $('#vt-table').setAttribute('aria-selected', v === 'table' ? 'true' : 'false');
  rerender();
  updateSoloControls();
}

function rerender(){
  if (!STATE.data || !STATE.cy) return;
  if (STATE.view === 'domain') renderDomainMap();
  else renderTableModel();
  // Re-select previously focused entity if it still exists.
  reSelectAfterRender();
  updateCounts();
}

function reSelectAfterRender(){
  if (!STATE.selected) return;
  const cy = STATE.cy;
  let id;
  if (STATE.selected.kind === 'domain') id = 'd::' + STATE.selected.id;
  else if (STATE.selected.kind === 'table') id = 't::' + STATE.selected.id;
  else if (STATE.selected.kind === 'column'){
    const [fqn, col] = String(STATE.selected.id).split(/\.(?=[^.]+$)/);
    id = 'c::' + fqn + '::' + col;
  }
  else if (STATE.selected.kind === 'rel') id = 'e::' + STATE.selected.id;
  if (id){
    const el = cy.$id(id);
    if (!el.empty()) el.select();
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/* inspector                                                            */
/* ──────────────────────────────────────────────────────────────────── */
function selectEntity(kind, id){
  if (kind == null){ STATE.selected = null; renderInspector(); return; }
  STATE.selected = {kind, id};
  setSidePane('inspector');
  renderInspector();
}

function setSidePane(name){
  STATE.sidePane = name;
  $$('.st-btn').forEach(b => b.classList.toggle('active', b.dataset.side === name));
  $$('.side-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
  if (name === 'suggest') renderSuggestions();
  if (name === 'data') renderDataTab();
}

function renderInspector(){
  const empty = $('#ins-empty'), form = $('#ins-form');
  if (!STATE.selected){
    empty.style.display = '';
    form.classList.add('hidden');
    return;
  }
  empty.style.display = 'none';
  form.classList.remove('hidden');
  const s = STATE.selected;
  if (s.kind === 'domain') renderDomainForm(findDomain(s.id));
  else if (s.kind === 'table') renderTableForm(findTable(s.id));
  else if (s.kind === 'rel') renderRelForm(STATE.data.relationships[s.id], s.id);
  else if (s.kind === 'column'){
    const lastDot = String(s.id).lastIndexOf('.');
    const fqn = s.id.slice(0, lastDot);
    const colName = s.id.slice(lastDot + 1);
    const c = STATE.data.columns.find(x => x.table_fqn === fqn && x.column === colName);
    renderColumnForm(c, fqn);
  }
}

function fld(label, name, value, opts){
  opts = opts || {};
  const type = opts.type || 'text';
  const cls = opts.fullWidth ? '' : '';
  const inputId = 'fld-' + name;
  if (type === 'textarea'){
    return `<div class="grp"><label for="${inputId}">${escapeHtml(label)}</label>
      <textarea id="${inputId}" name="${name}" rows="${opts.rows||3}">${escapeHtml(value||'')}</textarea></div>`;
  }
  if (type === 'select'){
    const opts2 = (opts.options || []).map(o => {
      const v = typeof o === 'string' ? o : o.value;
      const l = typeof o === 'string' ? o : (o.label || o.value);
      return `<option value="${escapeHtml(v)}"${v === value ? ' selected' : ''}>${escapeHtml(l)}</option>`;
    }).join('');
    return `<div class="grp"><label for="${inputId}">${escapeHtml(label)}</label>
      <select id="${inputId}" name="${name}">${opts2}</select></div>`;
  }
  if (type === 'checkbox'){
    return `<label class="check"><input id="${inputId}" name="${name}" type="checkbox"${value ? ' checked' : ''}> ${escapeHtml(label)}</label>`;
  }
  return `<div class="grp"><label for="${inputId}">${escapeHtml(label)}</label>
    <input id="${inputId}" name="${name}" type="${type}" value="${escapeHtml(value??'')}"${opts.attr||''}></div>`;
}

function renderDomainForm(d){
  if (!d){ $('#ins-form').innerHTML = '<div class="empty">Domain not found.</div>'; return; }
  // Build the cross-domain relationship list (option d from Q6):
  //   - domain_link rows touching this domain (from or to === d.domain_id)
  //   - fk / derived_from rows whose endpoint tables span domains AND this
  //     domain is one of them.
  const tableByFqn = {};
  for (const t of (STATE.data.tables || [])) tableByFqn[t.table_fqn] = t;
  const domainTouchingRels = [];
  (STATE.data.relationships || []).forEach((r, idx) => {
    if (r.kind === 'domain_link'){
      if (r.from === d.domain_id || r.to === d.domain_id){
        domainTouchingRels.push({r, idx, fromDom: r.from, toDom: r.to});
      }
      return;
    }
    // fk / derived_from: resolve domains via the endpoint tables.
    const ft = tableByFqn[r.from], tt = tableByFqn[r.to];
    const fd = ft && ft.domain_id, td = tt && tt.domain_id;
    if (!fd || !td || fd === td) return;            // intra-domain or unresolved → skip
    if (fd !== d.domain_id && td !== d.domain_id) return;
    domainTouchingRels.push({r, idx, fromDom: fd, toDom: td});
  });

  const targetDomOpts = STATE.data.domains
    .filter(x => x.domain_id !== d.domain_id)
    .map(x => ({value: x.domain_id, label: x.domain_id + ' — ' + (x.domain_name || '')}));

  $('#ins-form').innerHTML = `
    <div class="ins-head">
      <span class="kind">Domain</span>
      <h4 class="title">${escapeHtml(d.domain_name || d.domain_id)}</h4>
    </div>
    ${fld('Domain ID', 'domain_id', d.domain_id, {attr:' readonly style="background:var(--g100)"'})}
    ${fld('Name', 'domain_name', d.domain_name)}
    ${fld('Description', 'description', d.description, {type:'textarea', rows:3})}
    <div class="row-3">
      ${fld('X (0-100)', 'x', d.x, {type:'number'})}
      ${fld('Y (0-100)', 'y', d.y, {type:'number'})}
      ${fld('Radius', 'radius', d.radius, {type:'number'})}
    </div>
    <div class="row">
      ${fld('Color', 'color', d.color || '#6366F1', {type:'color'})}
      ${fld('Icon', 'icon', d.icon || '')}
    </div>

    <div class="dom-rels">
      <div class="dom-rels-head">
        <span class="dom-rels-title">Cross-domain relationships</span>
        <span class="dom-rels-count">${domainTouchingRels.length}</span>
      </div>
      <div class="dom-rels-list" id="dom-rels-list">
        ${domainTouchingRels.length ? domainTouchingRels.map(({r, idx, fromDom, toDom}) => {
          const otherDom = (fromDom === d.domain_id) ? toDom : fromDom;
          const dir = (fromDom === d.domain_id) ? '→' : '←';
          const fromLabel = (r.kind === 'domain_link')
            ? escapeHtml(r.from)
            : escapeHtml((tableByFqn[r.from] && tableByFqn[r.from].short_name) || shortName(r.from)) +
              (r.from_column ? '.<b>' + escapeHtml(r.from_column) + '</b>' : '');
          const toLabel = (r.kind === 'domain_link')
            ? escapeHtml(r.to)
            : escapeHtml((tableByFqn[r.to] && tableByFqn[r.to].short_name) || shortName(r.to)) +
              (r.to_column ? '.<b>' + escapeHtml(r.to_column) + '</b>' : '');
          return `
            <div class="dom-rel-row" data-rel-idx="${idx}">
              <span class="dom-rel-kind kind-${escapeHtml(r.kind)}">${escapeHtml(r.kind)}</span>
              <span class="dom-rel-other">${escapeHtml(otherDom)}</span>
              <span class="dom-rel-dir">${dir}</span>
              <span class="dom-rel-endpoints">${fromLabel} <span class="dom-rel-arrow">→</span> ${toLabel}</span>
            </div>`;
        }).join('') : '<div class="empty">No cross-domain relationships yet.</div>'}
      </div>

      <div class="dom-rels-add">
        <div class="dom-rels-add-title">+ Add cross-domain relationship</div>
        <div class="row">
          ${fld('Target domain', 'rel_target', '', {type:'select', options: [{value:'',label:'— pick a target —'}].concat(targetDomOpts)})}
          ${fld('Cardinality',   'rel_card',   'n:1', {type:'select', options: REL_CARDINALITIES})}
        </div>
        <label class="cb-section-label">From column (optional · this domain's tables)</label>
        <div id="dom-cb-from" class="cb-host"></div>
        <label class="cb-section-label">To column (optional · target domain's tables)</label>
        <div id="dom-cb-to" class="cb-host"></div>
        ${fld('Via (optional notes on the join)', 'rel_via', '')}
        ${fld('Notes', 'rel_notes', '', {type:'textarea', rows:2})}
        <div class="dom-rels-add-foot">
          <span class="dom-rel-preview" id="dom-rel-preview">Pick a target domain to begin.</span>
          <button type="button" class="btn primary mini" id="dom-rel-add" disabled>Add</button>
        </div>
        <div class="err" id="dom-rel-err"></div>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="btn danger" id="del-entity">Delete domain</button>
      <span style="flex:1"></span>
      <button type="button" class="btn primary" id="apply-entity">Apply</button>
    </div>`;

  // Wire up the existing rel rows → click jumps to that rel's Inspector.
  $$('#dom-rels-list .dom-rel-row').forEach(row => {
    row.onclick = () => selectEntity('rel', Number(row.dataset.relIdx));
  });

  // Wire up the inline "+ Add" form.
  const tablesInThisDomain = (STATE.data.tables || [])
    .filter(t => t.domain_id === d.domain_id).map(t => t.table_fqn);
  const fromAllowed = new Set(tablesInThisDomain);

  let fromCb = mountColumnCombobox($('#dom-cb-from'), {
    placeholder: `e.g. customer_id · table in ${d.domain_id}`,
    tableFilter: fromAllowed,
    onChange: refreshPreview,
  });
  let toCb = null;

  function buildToCb(){
    const target = $('#fld-rel_target').value;
    if (toCb){ toCb.destroy(); toCb = null; }
    const tablesInTarget = target
      ? (STATE.data.tables || []).filter(t => t.domain_id === target).map(t => t.table_fqn)
      : [];
    const toAllowed = new Set(tablesInTarget);
    toCb = mountColumnCombobox($('#dom-cb-to'), {
      placeholder: target ? `e.g. column · table in ${target}` : 'Pick a target domain first…',
      tableFilter: toAllowed,
      getBoostAgainst: () => fromCb && fromCb.getValue(),
      onChange: refreshPreview,
    });
  }
  buildToCb();

  function refreshPreview(){
    const target = $('#fld-rel_target').value;
    const fc = fromCb && fromCb.getValue();
    const tc = toCb && toCb.getValue();
    const preview = $('#dom-rel-preview');
    const btn = $('#dom-rel-add');
    const err = $('#dom-rel-err');
    err.innerHTML = '';
    if (!target){
      preview.textContent = 'Pick a target domain to begin.';
      btn.disabled = true; return;
    }
    if (fc && !tc){
      preview.innerHTML = 'Pick a <b>to-side column</b> or clear the from-side to author a domain_link.';
      btn.disabled = true; return;
    }
    if (!fc && tc){
      preview.innerHTML = 'Pick a <b>from-side column</b> or clear the to-side to author a domain_link.';
      btn.disabled = true; return;
    }
    if (fc && tc){
      preview.innerHTML = 'Will create: <code>fk</code> &nbsp;' +
        '<span class="muted">' + escapeHtml(fc.table_fqn) + '.' + escapeHtml(fc.column) +
        ' → ' + escapeHtml(tc.table_fqn) + '.' + escapeHtml(tc.column) + '</span>';
    } else {
      preview.innerHTML = 'Will create: <code>domain_link</code> &nbsp;' +
        '<span class="muted">' + escapeHtml(d.domain_id) + ' → ' + escapeHtml(target) + '</span>';
    }
    btn.disabled = false;
  }

  $('#fld-rel_target').onchange = () => { buildToCb(); refreshPreview(); };

  $('#dom-rel-add').onclick = () => {
    const target = $('#fld-rel_target').value;
    const fc = fromCb && fromCb.getValue();
    const tc = toCb && toCb.getValue();
    const card = $('#fld-rel_card').value || 'n:1';
    const via = $('#fld-rel_via').value.trim();
    const notes = $('#fld-rel_notes').value.trim();
    const err = $('#dom-rel-err');
    err.innerHTML = '';
    if (!target){ err.textContent = 'Pick a target domain.'; return; }
    let row;
    if (fc && tc){
      // Sanity: tables really belong to expected domains.
      const ft = findTable(fc.table_fqn), tt = findTable(tc.table_fqn);
      if (!ft || ft.domain_id !== d.domain_id){ err.textContent = 'From column is not in this domain.'; return; }
      if (!tt || tt.domain_id !== target){ err.textContent = 'To column is not in the selected target domain.'; return; }
      row = {
        from: fc.table_fqn, to: tc.table_fqn, kind: 'fk', cardinality: card,
        via: '', notes,
        from_column: fc.column, to_column: tc.column,
      };
    } else {
      row = {
        from: d.domain_id, to: target, kind: 'domain_link', cardinality: card,
        via, notes,
        from_column: '', to_column: '',
      };
    }
    STATE.data.relationships.push(row);
    const newIdx = STATE.data.relationships.length - 1;
    markDirty(); rerender();
    selectEntity('rel', newIdx);
    toast('Relationship added.', 'success');
  };

  $('#apply-entity').onclick = () => {
    const v = readForm();
    d.domain_name = v.domain_name; d.description = v.description;
    d.x = Number(v.x); d.y = Number(v.y); d.radius = Number(v.radius);
    d.color = v.color; d.icon = v.icon;
    markDirty(); rerender(); selectEntity('domain', d.domain_id);
    toast('Domain updated.', 'success');
  };
  $('#del-entity').onclick = () => {
    if (!confirm(`Delete domain "${d.domain_id}"?\nTables in it will lose their domain link.`)) return;
    STATE.data.domains = STATE.data.domains.filter(x => x !== d);
    markDirty(); selectEntity(null); rerender();
  };
}

function renderTableForm(t){
  if (!t){ $('#ins-form').innerHTML = '<div class="empty">Table not found.</div>'; return; }
  const domOpts = STATE.data.domains.map(x => ({value: x.domain_id, label: x.domain_id + ' — ' + x.domain_name}));
  const tableCols = STATE.data.columns.filter(c => c.table_fqn === t.table_fqn);
  $('#ins-form').innerHTML = `
    <div class="ins-head">
      <span class="kind">Table · ${escapeHtml(computeWrittenBy()[t.table_fqn] ? 'curated' : 'raw')}</span>
      <h4 class="title">${escapeHtml(t.short_name || shortName(t.table_fqn))}</h4>
    </div>
    ${fld('Table FQN', 'table_fqn', t.table_fqn, {attr:' readonly style="background:var(--g100);font-family:var(--mono);font-size:11.5px"'})}
    ${fld('Short name', 'short_name', t.short_name)}
    ${fld('Domain', 'domain_id', t.domain_id, {type:'select', options: domOpts})}
    ${fld('Description', 'description', t.description, {type:'textarea', rows:3})}
    ${fld('Grain', 'grain', t.grain)}
    <div class="row">
      ${fld('Partition col', 'partition_col', t.partition_col)}
      ${fld('Source system', 'source_system', t.source_system)}
    </div>
    ${fld('Share downstream (force-render on map)', 'share', !!t.share, {type:'checkbox'})}
    ${fld('Notes', 'notes', t.notes, {type:'textarea', rows:2})}

    <label style="margin-top:12px">Columns (${tableCols.length})</label>
    <div class="col-list" id="col-list">
      ${tableCols.map(c => `
        <div class="col-row editable" data-col="${escapeHtml(c.column)}">
          <span class="name">${escapeHtml(c.column)}${c.pii ? ' <span class="pii">PII</span>':''}</span>
          <span class="type">${escapeHtml(c.type||'')}</span>
          <button type="button" class="del" data-del-col="${escapeHtml(c.column)}" title="Delete column">×</button>
        </div>`).join('')}
    </div>
    <div class="col-add">
      <input id="newcol-name" placeholder="new column name" style="flex:2">
      <input id="newcol-type" placeholder="STRING" style="flex:1">
      <button type="button" class="mini" id="newcol-add">+ Add</button>
    </div>

    <div class="actions">
      <button type="button" class="btn danger" id="del-entity">Delete table</button>
      <span style="flex:1"></span>
      <button type="button" class="btn primary" id="apply-entity">Apply</button>
    </div>`;

  $('#apply-entity').onclick = () => {
    const v = readForm();
    Object.assign(t, {
      short_name: v.short_name, domain_id: v.domain_id, description: v.description,
      grain: v.grain, partition_col: v.partition_col, source_system: v.source_system,
      share: !!v.share, notes: v.notes,
    });
    markDirty(); rerender(); selectEntity('table', t.table_fqn);
    toast('Table updated.', 'success');
  };
  $('#del-entity').onclick = () => {
    if (!confirm(`Delete table "${t.table_fqn}"?\nIts columns, xref entries, and relationships will also be removed.`)) return;
    STATE.data.tables = STATE.data.tables.filter(x => x !== t);
    STATE.data.columns = STATE.data.columns.filter(c => c.table_fqn !== t.table_fqn);
    STATE.data.bucket_table_xref = STATE.data.bucket_table_xref.filter(x => x.table_fqn !== t.table_fqn);
    STATE.data.relationships = STATE.data.relationships.filter(r => r.from !== t.table_fqn && r.to !== t.table_fqn);
    markDirty(); selectEntity(null); rerender();
  };
  $('#newcol-add').onclick = () => {
    const name = ($('#newcol-name').value || '').trim();
    const type = ($('#newcol-type').value || 'STRING').trim() || 'STRING';
    if (!name) { toast('Column name required.', 'error'); return; }
    if (tableCols.find(c => c.column === name)){ toast('Column already exists.', 'error'); return; }
    STATE.data.columns.push({
      table_fqn: t.table_fqn, column: name, type, description: '',
      domain_values: '', nullable: true, pii: false, notes: '',
    });
    markDirty();
    // If we got here via the relationship modal's "Add column" CTA, reopen it.
    const pending = STATE._pendingAddColumn;
    if (pending && pending.table_fqn === t.table_fqn && pending.column.toLowerCase() === name.toLowerCase()){
      STATE._pendingAddColumn = null;
      rerender();
      openRelModal({});  // uses STATE._pendingRelPrefill stashed earlier
      toast('Column added — resume relationship.', 'success');
      return;
    }
    renderTableForm(t);
  };
  $$('#col-list .col-row.editable').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.matches('[data-del-col]')) return;
      const name = row.dataset.col;
      selectEntity('column', t.table_fqn + '.' + name);
    });
  });
  $$('#col-list [data-del-col]').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const name = b.dataset.delCol;
      if (!confirm(`Delete column "${name}" from ${t.table_fqn}?`)) return;
      STATE.data.columns = STATE.data.columns.filter(c => !(c.table_fqn === t.table_fqn && c.column === name));
      // Drop relationships using this column.
      STATE.data.relationships = STATE.data.relationships.filter(r =>
        !((r.from === t.table_fqn && r.from_column === name) || (r.to === t.table_fqn && r.to_column === name)));
      markDirty(); renderTableForm(t); rerender();
    });
  });
}

function renderColumnForm(c, fqn){
  if (!c){ $('#ins-form').innerHTML = '<div class="empty">Column not found.</div>'; return; }
  $('#ins-form').innerHTML = `
    <div class="ins-head">
      <span class="kind">Column · ${escapeHtml(shortName(fqn))}</span>
      <h4 class="title">${escapeHtml(c.column)}</h4>
    </div>
    ${fld('Column', 'column', c.column)}
    ${fld('Type', 'type', c.type)}
    ${fld('Description', 'description', c.description, {type:'textarea', rows:3})}
    ${fld('Domain values', 'domain_values', c.domain_values)}
    <div class="row">
      ${fld('Nullable', 'nullable', c.nullable, {type:'checkbox'})}
      ${fld('PII', 'pii', c.pii, {type:'checkbox'})}
    </div>
    ${fld('Notes', 'notes', c.notes, {type:'textarea', rows:2})}
    <div class="actions">
      <button type="button" class="btn" id="back-to-table">← Back to table</button>
      <span style="flex:1"></span>
      <button type="button" class="btn primary" id="apply-entity">Apply</button>
    </div>`;
  $('#apply-entity').onclick = () => {
    const v = readForm();
    const oldName = c.column;
    c.column = (v.column || '').trim() || oldName;
    c.type = v.type; c.description = v.description;
    c.domain_values = v.domain_values; c.nullable = !!v.nullable; c.pii = !!v.pii;
    c.notes = v.notes;
    // If column was renamed, fix up relationships.
    if (oldName !== c.column){
      for (const r of STATE.data.relationships){
        if (r.from === fqn && r.from_column === oldName) r.from_column = c.column;
        if (r.to   === fqn && r.to_column   === oldName) r.to_column   = c.column;
      }
    }
    markDirty(); rerender(); selectEntity('column', fqn + '.' + c.column);
    toast('Column updated.', 'success');
  };
  $('#back-to-table').onclick = () => selectEntity('table', fqn);
}

function renderRelForm(r, idx){
  if (!r){ $('#ins-form').innerHTML = '<div class="empty">Relationship not found.</div>'; return; }
  const domOpts = STATE.data.domains.map(d => ({value: d.domain_id, label: d.domain_id}));

  const isDomLink = r.kind === 'domain_link';
  $('#ins-form').innerHTML = `
    <div class="ins-head">
      <span class="kind">Relationship</span>
      <h4 class="title">${escapeHtml(shortName(r.from))} → ${escapeHtml(shortName(r.to))}</h4>
    </div>
    ${fld('Kind', 'kind', r.kind, {type:'select', options: REL_KINDS})}
    <div id="rel-edit-endpoints"></div>
    ${fld('Cardinality', 'cardinality', r.cardinality || '', {type:'select', options: [''].concat(REL_CARDINALITIES)})}
    ${fld('Via (derived if blank)', 'via', r.via)}
    ${fld('Notes', 'notes', r.notes, {type:'textarea', rows:2})}
    <div class="actions">
      <button type="button" class="btn danger" id="del-entity">Delete relationship</button>
      <span style="flex:1"></span>
      <button type="button" class="btn primary" id="apply-entity">Apply</button>
    </div>`;

  let fromCb = null, toCb = null;
  function renderEndpoints(kind){
    const host = $('#rel-edit-endpoints');
    if (fromCb){ fromCb.destroy(); fromCb = null; }
    if (toCb){ toCb.destroy(); toCb = null; }
    if (kind === 'domain_link'){
      host.innerHTML = `
        <div class="row">
          ${fld('From domain', 'from', r.from, {type:'select', options: domOpts})}
          ${fld('To domain',   'to',   r.to,   {type:'select', options: domOpts})}
        </div>`;
    } else {
      host.innerHTML = `
        <label class="cb-section-label">From column</label>
        <div id="cb-edit-from-host" class="cb-host"></div>
        <label class="cb-section-label">To column</label>
        <div id="cb-edit-to-host" class="cb-host"></div>`;
      fromCb = mountColumnCombobox(host.querySelector('#cb-edit-from-host'), {
        initial: (r.from && r.from_column) ? {table_fqn: r.from, column: r.from_column} : null,
        placeholder: 'From column',
        getBoostAgainst: () => toCb && toCb.getValue(),
      });
      toCb = mountColumnCombobox(host.querySelector('#cb-edit-to-host'), {
        initial: (r.to && r.to_column) ? {table_fqn: r.to, column: r.to_column} : null,
        placeholder: 'To column',
        getBoostAgainst: () => fromCb && fromCb.getValue(),
      });
    }
  }
  renderEndpoints(r.kind);
  $('#fld-kind').onchange = (e) => renderEndpoints(e.target.value);

  $('#apply-entity').onclick = () => {
    const v = readForm();
    const kind = v.kind;
    let from = '', to = '', fc = '', tc = '';
    if (kind === 'domain_link'){
      from = v.from; to = v.to;
    } else {
      const fv = fromCb && fromCb.getValue();
      const tv = toCb && toCb.getValue();
      if (!fv || !tv){ toast('Both From and To columns are required.', 'error'); return; }
      from = fv.table_fqn; to = tv.table_fqn;
      fc = fv.column; tc = tv.column;
    }
    Object.assign(r, {
      kind, from, to, from_column: fc, to_column: tc,
      cardinality: v.cardinality, via: v.via, notes: v.notes,
    });
    markDirty(); rerender();
    toast('Relationship updated.', 'success');
  };
  $('#del-entity').onclick = () => {
    if (!confirm('Delete this relationship?')) return;
    STATE.data.relationships.splice(idx, 1);
    markDirty(); selectEntity(null); rerender();
  };
}

function readForm(){
  const out = {};
  $$('#ins-form [name]').forEach(el => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value;
  });
  return out;
}

/* ──────────────────────────────────────────────────────────────────── */
/* add via toolbar buttons                                              */
/* ──────────────────────────────────────────────────────────────────── */
function addDomain(){
  const id = prompt('New domain ID (e.g. PRODUCT, AGENT):');
  if (!id) return;
  if (findDomain(id)){ toast('Domain "' + id + '" already exists.', 'error'); return; }
  STATE.data.domains.push({
    domain_id: id, domain_name: id, description: '',
    x: 50, y: 50, radius: 80, color: '#6366F1', icon: '',
  });
  markDirty(); rerender(); selectEntity('domain', id);
}

function addTable(){
  const fqn = prompt('Fully-qualified table name (catalog.schema.table):');
  if (!fqn) return;
  if (findTable(fqn)){ toast('Table already exists.', 'error'); return; }
  if (fqn.split('.').length < 2){ toast('FQN must be catalog.schema.table', 'error'); return; }
  let domainId = STATE.selected && STATE.selected.kind === 'domain' ? STATE.selected.id : null;
  if (!domainId){
    if (!STATE.data.domains.length){ toast('Create a domain first.', 'error'); return; }
    domainId = STATE.data.domains[0].domain_id;
  }
  STATE.data.tables.push({
    table_fqn: fqn, domain_id: domainId, short_name: shortName(fqn), description: '',
    grain: '', partition_col: '', source_system: '', share: false, notes: '',
  });
  markDirty(); rerender(); selectEntity('table', fqn);
}

/* ──────────────────────────────────────────────────────────────────── */
/* column combobox                                                      */
/* ──────────────────────────────────────────────────────────────────── */

/* Shared scoring helper. Given two column rows {table_fqn,column,type,...},
   return {score, badges}. score=-1 means "ineligible" (same table).
   Used by mountColumnCombobox boost ranking AND computeSuggestions confidence
   so the two stay in sync. */
function fkSuffix(s){
  const m = String(s || '').match(FK_SUFFIX_RE);
  return m ? m[1].toLowerCase() : null;
}
function scoreFkLink(a, b){
  if (!a || !b) return {score: 0, badges: []};
  if (a.table_fqn === b.table_fqn) return {score: -1, badges: []};
  let score = 0;
  const badges = [];
  const an = String(a.column || '').toLowerCase();
  const bn = String(b.column || '').toLowerCase();
  const at = String(a.type || '').toLowerCase();
  const bt = String(b.type || '').toLowerCase();
  if (an && an === bn){
    score += 100;
    badges.push({label: 'matches ' + a.column, kind: 'name'});
  }
  if (at && at === bt){
    score += 30;
    badges.push({label: 'same type', kind: 'type'});
  }
  const ad = (findTable(a.table_fqn) || {}).domain_id;
  const bd = (findTable(b.table_fqn) || {}).domain_id;
  if (ad && bd && ad !== bd){
    score += 10;
    badges.push({label: 'cross-domain', kind: 'dom'});
  }
  const sa = fkSuffix(a.column), sb = fkSuffix(b.column);
  if (sa && sa === sb && an !== bn){
    score += 8;
    badges.push({label: 'family ' + sa, kind: 'fam'});
  }
  if (a.nullable === false) score += 4;
  if (b.nullable === false) score += 4;
  return {score, badges};
}

/* Token-AND match score for a single column row against a user query.
   Returns a non-negative number, or -1 if the row doesn't match all tokens.
   Exact column-name matches pin to the top via a large bonus. */
function matchColumnRow(col, table, tokens){
  if (!tokens.length) return 0;
  const haystack = [
    String(col.column || '').toLowerCase(),
    String((table && table.short_name) || shortName(col.table_fqn)).toLowerCase(),
    String(col.table_fqn || '').toLowerCase(),
  ];
  for (const t of tokens){
    if (!haystack.some(h => h.includes(t))) return -1;
  }
  let score = 0;
  const cn = haystack[0];
  // Exact column-name match
  if (tokens.length === 1 && cn === tokens[0]) score += 1000;
  // Column-name prefix on any token
  for (const t of tokens){
    if (cn === t) score += 500;
    else if (cn.startsWith(t)) score += 80;
    else if (cn.includes(t)) score += 20;
  }
  return score;
}

/* mountColumnCombobox(host, opts) → controller
   opts:
     initial:        {table_fqn, column} | null
     placeholder:    string
     getBoostAgainst: () => col | null       // for cross-side ranking
     onChange:       (col | null) => void    // fires on selection / clear
   controller:
     getValue()  → {table_fqn, column} | null
     setValue(col)
     focus()
     destroy()
*/
function mountColumnCombobox(host, opts){
  opts = opts || {};
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'combobox';
  const chip = document.createElement('div');
  chip.className = 'cb-chip';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cb-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = opts.placeholder || 'Type a column or table name…';
  const panel = document.createElement('div');
  panel.className = 'cb-panel';
  panel.setAttribute('role', 'listbox');
  wrap.append(chip, input, panel);
  host.appendChild(wrap);

  let selected = null;
  let results = [];
  let focusIdx = 0;
  let panelOpen = false;

  function renderChip(){
    chip.innerHTML = '';
    if (!selected){ chip.classList.remove('on'); return; }
    chip.classList.add('on');
    const tbl = findTable(selected.table_fqn);
    const sn = (tbl && tbl.short_name) || shortName(selected.table_fqn);
    chip.innerHTML =
      `<span class="cb-chip-table" title="${escapeHtml(selected.table_fqn)}">${escapeHtml(sn)}</span>` +
      `<span class="cb-chip-dot">.</span>` +
      `<span class="cb-chip-col">${escapeHtml(selected.column)}</span>` +
      `<button class="cb-clear" type="button" title="Clear (Backspace)" tabindex="-1">×</button>`;
    chip.querySelector('.cb-clear').onclick = (e) => {
      e.stopPropagation();
      setSelected(null);
      input.focus();
    };
  }

  function setSelected(col){
    selected = col ? {
      table_fqn: col.table_fqn,
      column: col.column,
      type: col.type,
      nullable: col.nullable,
      pii: col.pii,
    } : null;
    renderChip();
    input.value = '';
    input.placeholder = selected ? 'Change…' : (opts.placeholder || 'Type a column or table name…');
    closePanel();
    if (opts.onChange) opts.onChange(selected);
  }

  function compute(query){
    const q = String(query || '').trim().toLowerCase();
    const tokens = q ? q.split(/[\s.]+/).filter(Boolean) : [];
    const boost = opts.getBoostAgainst ? opts.getBoostAgainst() : null;
    const tableByFqn = {};
    for (const t of (STATE.data.tables || [])) tableByFqn[t.table_fqn] = t;

    // Optional restriction to a subset of tables (e.g. tables in one domain).
    // Accepts a predicate (table_fqn => bool), an array of FQNs, or a Set.
    const filter = opts.tableFilter;
    let isAllowed = null;
    if (typeof filter === 'function'){
      isAllowed = (fqn) => !!filter(fqn);
    } else if (filter && typeof filter.has === 'function'){
      isAllowed = (fqn) => filter.has(fqn);
    } else if (Array.isArray(filter)){
      const set = new Set(filter);
      isAllowed = (fqn) => set.has(fqn);
    }

    const rows = [];
    for (const c of (STATE.data.columns || [])){
      if (!c.column) continue;
      if (isAllowed && !isAllowed(c.table_fqn)) continue;
      if (boost && c.table_fqn === boost.table_fqn && c.column === boost.column) continue; // exclude self
      const tbl = tableByFqn[c.table_fqn];
      const s = matchColumnRow(c, tbl, tokens);
      if (s < 0) continue;
      let boostScore = 0;
      let badges = [];
      if (boost){
        const r = scoreFkLink(boost, c);
        if (r.score < 0) continue; // same-table never shown when boost set
        boostScore = r.score;
        badges = r.badges;
      }
      rows.push({col: c, tbl, score: s, boost: boostScore, badges});
    }
    rows.sort((x, y) => {
      // primary: query score, secondary: boost, tertiary: table+column alphabetical
      if (y.score !== x.score) return y.score - x.score;
      if (y.boost !== x.boost) return y.boost - x.boost;
      const xs = (x.tbl && x.tbl.short_name) || shortName(x.col.table_fqn);
      const ys = (y.tbl && y.tbl.short_name) || shortName(y.col.table_fqn);
      if (xs !== ys) return xs.localeCompare(ys);
      return String(x.col.column).localeCompare(String(y.col.column));
    });
    return {rows: rows.slice(0, 80), tokens};
  }

  function renderPanel(){
    const {rows, tokens} = compute(input.value);
    results = rows;
    focusIdx = 0;
    if (!rows.length){
      const ctaTable = detectAddColumnTarget(input.value);
      if (ctaTable){
        panel.innerHTML =
          `<div class="cb-empty">No column matches.</div>` +
          `<div class="cb-cta" role="option" data-act="add-col" data-table="${escapeHtml(ctaTable.table_fqn)}" data-col="${escapeHtml(ctaTable.column)}">` +
          `+ Add column <b>${escapeHtml(ctaTable.column)}</b> to <b>${escapeHtml(ctaTable.short_name)}</b> →` +
          `</div>`;
        panel.querySelector('[data-act="add-col"]').onclick = (e) => {
          const t = e.currentTarget.dataset.table;
          const c = e.currentTarget.dataset.col;
          if (opts.onRequestAddColumn) opts.onRequestAddColumn({table_fqn: t, column: c});
        };
      } else {
        panel.innerHTML = tokens.length
          ? `<div class="cb-empty">No column matches "<code>${escapeHtml(input.value)}</code>".</div>`
          : `<div class="cb-empty">Start typing a column or table name…</div>`;
      }
      openPanel();
      return;
    }
    panel.innerHTML = rows.map((r, i) => {
      const sn = (r.tbl && r.tbl.short_name) || shortName(r.col.table_fqn);
      const dom = (r.tbl && r.tbl.domain_id) || '';
      const badges = (r.badges || []).map(b =>
        `<span class="cb-badge cb-b-${b.kind}">${escapeHtml(b.label)}</span>`
      ).join('');
      return (
        `<div class="cb-row${i === focusIdx ? ' focus' : ''}" role="option" data-i="${i}" data-id="${escapeHtml(r.col.table_fqn + '.' + r.col.column)}">` +
          `<div class="cb-line">` +
            `<span class="cb-col">${escapeHtml(r.col.column)}</span>` +
            `<span class="cb-dot">·</span>` +
            `<span class="cb-tbl" title="${escapeHtml(r.col.table_fqn)}">${escapeHtml(sn)}</span>` +
            (r.col.type ? `<span class="cb-type">${escapeHtml(r.col.type)}</span>` : '') +
            (dom ? `<span class="cb-dom">${escapeHtml(dom)}</span>` : '') +
          `</div>` +
          (badges ? `<div class="cb-badges">${badges}</div>` : '') +
        `</div>`
      );
    }).join('');
    panel.querySelectorAll('.cb-row').forEach(el => {
      el.onmousedown = (e) => {
        e.preventDefault(); // keep focus on input
        const i = Number(el.dataset.i);
        if (results[i]) setSelected(results[i].col);
      };
      el.onmouseenter = () => {
        focusIdx = Number(el.dataset.i);
        updateFocus();
      };
    });
    openPanel();
  }

  function updateFocus(){
    panel.querySelectorAll('.cb-row').forEach((el, i) => {
      el.classList.toggle('focus', i === focusIdx);
    });
    const el = panel.querySelector('.cb-row.focus');
    if (el) el.scrollIntoView({block: 'nearest'});
  }

  function detectAddColumnTarget(raw){
    if (!raw) return null;
    // Pattern: <table-token>.<column-token>  where table-token matches a known
    // table short_name or fqn-suffix and column-token isn't already declared.
    const m = String(raw).trim().match(/^([A-Za-z0-9_.]+?)\.([A-Za-z0-9_]+)$/);
    if (!m) return null;
    const [, tTok, cTok] = m;
    const ttl = tTok.toLowerCase();
    let tbl = null;
    for (const t of (STATE.data.tables || [])){
      if (String(t.short_name || '').toLowerCase() === ttl ||
          String(t.table_fqn || '').toLowerCase() === ttl ||
          String(t.table_fqn || '').toLowerCase().endsWith('.' + ttl)){
        tbl = t; break;
      }
    }
    if (!tbl) return null;
    // Honour the combobox's optional tableFilter — don't offer +Add for a
    // table outside the allowed set (e.g. wrong domain in Domain Inspector).
    const filter = opts.tableFilter;
    let isAllowed = null;
    if (typeof filter === 'function') isAllowed = (fqn) => !!filter(fqn);
    else if (filter && typeof filter.has === 'function') isAllowed = (fqn) => filter.has(fqn);
    else if (Array.isArray(filter)){ const set = new Set(filter); isAllowed = (fqn) => set.has(fqn); }
    if (isAllowed && !isAllowed(tbl.table_fqn)) return null;
    // already exists?
    const exists = (STATE.data.columns || []).some(c =>
      c.table_fqn === tbl.table_fqn && String(c.column).toLowerCase() === cTok.toLowerCase());
    if (exists) return null;
    return {table_fqn: tbl.table_fqn, column: cTok, short_name: tbl.short_name || shortName(tbl.table_fqn)};
  }

  function openPanel(){
    panel.classList.add('open');
    panelOpen = true;
  }
  function closePanel(){
    panel.classList.remove('open');
    panelOpen = false;
  }

  input.addEventListener('input', renderPanel);
  input.addEventListener('focus', renderPanel);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown'){
      e.preventDefault();
      if (!panelOpen){ renderPanel(); return; }
      if (focusIdx < results.length - 1){ focusIdx++; updateFocus(); }
    } else if (e.key === 'ArrowUp'){
      e.preventDefault();
      if (focusIdx > 0){ focusIdx--; updateFocus(); }
    } else if (e.key === 'Enter'){
      if (panelOpen && results[focusIdx]){
        e.preventDefault();
        setSelected(results[focusIdx].col);
      }
    } else if (e.key === 'Escape'){
      if (panelOpen){ e.preventDefault(); closePanel(); }
    } else if (e.key === 'Backspace' && !input.value && selected){
      e.preventDefault();
      setSelected(null);
    } else if (e.key === 'Tab'){
      closePanel();
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => { if (!wrap.contains(document.activeElement)) closePanel(); }, 120);
  });

  // initial value
  if (opts.initial && opts.initial.table_fqn && opts.initial.column){
    const c = (STATE.data.columns || []).find(x =>
      x.table_fqn === opts.initial.table_fqn && x.column === opts.initial.column);
    setSelected(c || opts.initial);
  } else {
    renderChip();
  }

  return {
    getValue: () => selected,
    setValue: setSelected,
    focus: () => input.focus(),
    destroy: () => { host.innerHTML = ''; },
    _input: input,  // for tests
  };
}

/* ──────────────────────────────────────────────────────────────────── */
/* new-relationship modal                                               */
/* ──────────────────────────────────────────────────────────────────── */
function openRelModal(prefill){
  prefill = prefill || {};
  const m = $('#rel-modal');
  const initialKind = prefill.kind || 'fk';
  const domOpts = STATE.data.domains.map(d => ({value: d.domain_id, label: d.domain_id}));

  // Restore-after-add-column flow: if we asked Inspector to add a column and
  // it was applied, the saved partial form values come back via this slot.
  if (STATE._pendingRelPrefill){
    prefill = Object.assign({}, STATE._pendingRelPrefill, prefill || {});
    STATE._pendingRelPrefill = null;
  }

  $('#rel-form').innerHTML = `
    ${fld('Kind', 'kind', initialKind, {type:'select', options: REL_KINDS})}
    <div id="rel-endpoints"></div>
    ${fld('Cardinality', 'cardinality', prefill.cardinality || 'n:1', {type:'select', options: REL_CARDINALITIES})}
    ${fld('Notes', 'notes', prefill.notes || '', {type:'textarea', rows:2})}`;
  $('#rel-err').textContent = '';
  m.classList.add('open');

  // endpoints region — re-rendered when kind changes.
  let fromCb = null, toCb = null;
  let fromDom = null, toDom = null;  // domain_link side: plain selects

  function renderEndpoints(kind){
    const host = $('#rel-endpoints');
    if (fromCb){ fromCb.destroy(); fromCb = null; }
    if (toCb){ toCb.destroy(); toCb = null; }
    if (kind === 'domain_link'){
      host.innerHTML = `
        <div class="row">
          ${fld('From domain', 'from', prefill.from || '', {type:'select', options: domOpts})}
          ${fld('To domain',   'to',   prefill.to   || '', {type:'select', options: domOpts})}
        </div>`;
      fromDom = host.querySelector('#fld-from');
      toDom   = host.querySelector('#fld-to');
    } else {
      host.innerHTML = `
        <label class="cb-section-label">From column</label>
        <div id="cb-from-host" class="cb-host"></div>
        <label class="cb-section-label">To column</label>
        <div id="cb-to-host" class="cb-host"></div>`;
      fromDom = null; toDom = null;
      const fromInitial = (prefill.from && prefill.from_column)
        ? {table_fqn: prefill.from, column: prefill.from_column} : null;
      const toInitial = (prefill.to && prefill.to_column)
        ? {table_fqn: prefill.to, column: prefill.to_column} : null;
      fromCb = mountColumnCombobox(host.querySelector('#cb-from-host'), {
        initial: fromInitial,
        placeholder: 'e.g. customer_id · customers',
        getBoostAgainst: () => toCb && toCb.getValue(),
        onRequestAddColumn: (target) => handleAddColumnRequest('from', target),
      });
      toCb = mountColumnCombobox(host.querySelector('#cb-to-host'), {
        initial: toInitial,
        placeholder: 'e.g. customer_id · orders',
        getBoostAgainst: () => fromCb && fromCb.getValue(),
        onRequestAddColumn: (target) => handleAddColumnRequest('to', target),
      });
    }
  }

  function handleAddColumnRequest(side, target){
    // Stash the in-progress form so the modal can be restored after the
    // user adds the column via the Inspector.
    const cur = collect();
    STATE._pendingRelPrefill = Object.assign({}, cur, {
      [side === 'from' ? 'from' : 'to']: target.table_fqn,
      [side === 'from' ? 'from_column' : 'to_column']: target.column,
    });
    STATE._pendingAddColumn = {table_fqn: target.table_fqn, column: target.column};
    m.classList.remove('open');
    selectEntity('table', target.table_fqn);
    // Focus + prefill the +Add column input after the form renders.
    setTimeout(() => {
      const nm = $('#newcol-name');
      if (nm){
        nm.value = target.column;
        nm.focus();
        nm.select && nm.select();
      }
      toast('Add the column then click "+ Add" — the relationship modal will reopen.', 'success');
    }, 50);
  }

  function collect(){
    const v = {};
    $$('#rel-form [name]').forEach(el => v[el.name] = el.value);
    if (fromCb){
      const c = fromCb.getValue();
      v.from = c ? c.table_fqn : '';
      v.from_column = c ? c.column : '';
    }
    if (toCb){
      const c = toCb.getValue();
      v.to = c ? c.table_fqn : '';
      v.to_column = c ? c.column : '';
    }
    return v;
  }

  renderEndpoints(initialKind);
  $('#fld-kind').onchange = (e) => renderEndpoints(e.target.value);

  function setRelErr(html){ $('#rel-err').innerHTML = html; }
  function clearRelErr(){ $('#rel-err').innerHTML = ''; }
  function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // Switch `kind` in-place, preserving cardinality/notes and carrying over any
  // endpoint info that still makes sense after the switch.
  function switchKind(targetKind, carry){
    const cur = collect();
    prefill = {
      kind: targetKind,
      cardinality: cur.cardinality || prefill.cardinality || 'n:1',
      notes: cur.notes || prefill.notes || '',
      from: (carry && carry.from) || '',
      to: (carry && carry.to) || '',
      from_column: (carry && carry.from_column) || '',
      to_column: (carry && carry.to_column) || '',
    };
    const kindSel = $('#fld-kind');
    if (kindSel) kindSel.value = targetKind;
    // Re-sync the static fields (notes/cardinality) by re-rendering the whole
    // form once via the same code path the modal opens with.
    clearRelErr();
    m.classList.remove('open');
    openRelModal(prefill);
  }

  $('#rel-submit').onclick = () => {
    const v = collect();
    if (!REL_KINDS.includes(v.kind)){ setRelErr('Invalid kind.'); return; }
    if (!v.from || !v.to){ setRelErr('From and To are required.'); return; }
    if (v.from === v.to && v.from_column === v.to_column){ setRelErr('Self-relationship not allowed.'); return; }
    if (v.kind === 'domain_link'){
      if (!findDomain(v.from) || !findDomain(v.to)){
        // Heuristic: if either endpoint looks like a fully-qualified table
        // (contains a dot), the user almost certainly meant `fk` — domain_link
        // endpoints must be domain ids (POLICY, CUSTOMER, …), not table.column
        // refs. Offer a one-click switch that preserves what we can.
        const looksLikeTable = (String(v.from).includes('.') || String(v.to).includes('.'));
        const detail = looksLikeTable
          ? '<code>domain_link</code> endpoints must be <strong>domain ids</strong> (e.g. <code>CUSTOMER</code>, <code>CAMPAIGN</code>), not table or column refs. For column-to-column joins across domains, use <code>fk</code>.'
          : '<code>domain_link</code> endpoints must match existing domain ids (e.g. <code>CUSTOMER</code>, <code>CAMPAIGN</code>). Got <code>' + escapeHtml(v.from) + '</code> → <code>' + escapeHtml(v.to) + '</code>.';
        setRelErr(detail + ' <button type="button" class="err-action" id="rel-err-switch-fk">Switch to fk →</button>');
        const btn = $('#rel-err-switch-fk');
        if (btn) btn.onclick = () => switchKind('fk', looksLikeTable ? {
          from: findTable(v.from) ? v.from : '',
          to:   findTable(v.to)   ? v.to   : '',
          from_column: v.from_column || '',
          to_column:   v.to_column   || '',
        } : null);
        return;
      }
    } else {
      // fk / derived_from: endpoints must be tables. If the user picked
      // values that match domain ids instead, offer to switch to domain_link.
      if (!findTable(v.from) || !findTable(v.to)){
        const looksLikeDomain = (findDomain(v.from) && findDomain(v.to));
        const detail = looksLikeDomain
          ? '<code>' + escapeHtml(v.kind) + '</code> endpoints must be <strong>tables</strong> with a column on each side. You picked two domains — for domain-to-domain abstract links use <code>domain_link</code> instead.'
          : 'Both endpoints must be existing tables. Got <code>' + escapeHtml(v.from) + '</code> → <code>' + escapeHtml(v.to) + '</code>.';
        if (looksLikeDomain){
          setRelErr(detail + ' <button type="button" class="err-action" id="rel-err-switch-dl">Switch to domain_link →</button>');
          const btn = $('#rel-err-switch-dl');
          if (btn) btn.onclick = () => switchKind('domain_link', {from: v.from, to: v.to});
        } else {
          setRelErr(detail);
        }
        return;
      }
      if (!v.from_column || !v.to_column){
        setRelErr('From column and To column are required for <code>' + escapeHtml(v.kind) + '</code>.');
        return;
      }
    }
    STATE.data.relationships.push({
      from: v.from, to: v.to, kind: v.kind, cardinality: v.cardinality,
      via: '', notes: v.notes,
      from_column: v.from_column || '', to_column: v.to_column || '',
    });
    markDirty(); m.classList.remove('open'); rerender();
    selectEntity('rel', STATE.data.relationships.length - 1);
    toast('Relationship added.', 'success');
  };
}

/* ──────────────────────────────────────────────────────────────────── */
/* suggestions                                                          */
/* ──────────────────────────────────────────────────────────────────── */
function getSuppressions(){
  const m = (STATE.data.meta || []).find(r => r.key === 'suggestion_suppressions');
  if (!m || !m.value) return [];
  try {
    const parsed = JSON.parse(m.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function setSuppressions(list){
  let m = (STATE.data.meta || []).find(r => r.key === 'suggestion_suppressions');
  if (!m){ m = {key:'suggestion_suppressions', value:'[]'}; STATE.data.meta.push(m); }
  m.value = JSON.stringify(list);
}

function suppressionKey(s){
  return [s.from_table, s.from_column, s.to_table, s.to_column].join('|');
}
function relKey(r){
  return [r.from || '', r.from_column || '', r.to || '', r.to_column || ''].join('|');
}

const COMMON_FK_PATTERNS = [
  /(_no|_id|_code|_key|_num|_pk)$/i,
];

function computeSuggestions(){
  if (STATE.suggestionsCache) return STATE.suggestionsCache;
  if (!STATE.data){ STATE.suggestionsCache = []; return []; }

  // Index columns by name (case-insensitive) → list of {fqn, col, type, nullable, desc}
  const byName = {};
  for (const c of STATE.data.columns){
    if (!c.column) continue;
    const k = String(c.column).toLowerCase();
    (byName[k] = byName[k] || []).push(c);
  }

  const existingFK = new Set();
  for (const r of STATE.data.relationships){
    if (r.kind !== 'fk' && r.kind !== 'derived_from') continue;
    // store both directions for suppression check
    existingFK.add([r.from, r.from_column||'', r.to, r.to_column||''].join('|'));
    existingFK.add([r.to, r.to_column||'', r.from, r.from_column||''].join('|'));
  }

  const suppressions = new Set(getSuppressions().map(suppressionKey));

  const out = [];
  for (const colName of Object.keys(byName)){
    const occurrences = byName[colName];
    if (occurrences.length < 2) continue;
    // Only suggest if column name looks like an FK candidate.
    const looksLikeFk = COMMON_FK_PATTERNS.some(rx => rx.test(colName)) || colName === '_id';
    if (!looksLikeFk) continue;
    // Heuristic confidence: more occurrences = lower confidence (too generic);
    // type match boosts; non-null on one side boosts (likely PK).
    for (let i = 0; i < occurrences.length; i++){
      for (let j = 0; j < occurrences.length; j++){
        if (i === j) continue;
        const a = occurrences[i], b = occurrences[j];
        if (a.table_fqn === b.table_fqn) continue;
        const k = [a.table_fqn, a.column, b.table_fqn, b.column].join('|');
        if (existingFK.has(k)) continue;
        if (suppressions.has(k)) continue;
        // de-dupe symmetric pair: only emit (a,b) where a<b lexicographically
        if (a.table_fqn > b.table_fqn) continue;
        let conf = 0.5;
        if ((a.type || '').toLowerCase() === (b.type || '').toLowerCase()) conf += 0.2;
        if (a.nullable === false || b.nullable === false) conf += 0.15;
        if (occurrences.length === 2) conf += 0.1;
        const reasons = [];
        reasons.push('column name matches');
        if ((a.type||'').toLowerCase() === (b.type||'').toLowerCase()) reasons.push('same type');
        if (a.nullable === false) reasons.push(shortName(a.table_fqn)+' non-null');
        if (b.nullable === false) reasons.push(shortName(b.table_fqn)+' non-null');
        out.push({
          from_table: a.table_fqn, from_column: a.column,
          to_table:   b.table_fqn, to_column:   b.column,
          type_a: a.type, type_b: b.type,
          confidence: Math.min(0.99, conf),
          reason: reasons.join(' · '),
        });
      }
    }
  }
  out.sort((x, y) => y.confidence - x.confidence);
  STATE.suggestionsCache = out;
  return out;
}

function renderSuggestions(){
  const host = $('#suggest-list');
  const list = computeSuggestions();
  if (!list.length){
    host.innerHTML = '<div class="empty">No new candidate relationships detected. Add or rename columns to surface more.</div>';
    return;
  }
  host.innerHTML = list.map((s, i) => `
    <div class="sug" data-i="${i}">
      <div class="head">
        <span>${escapeHtml(s.reason)}</span>
        <span class="conf">${Math.round(s.confidence * 100)}%</span>
      </div>
      <div class="body">
        ${escapeHtml(shortName(s.from_table))}.<b>${escapeHtml(s.from_column)}</b>
        <span class="arrow">⇄</span>
        ${escapeHtml(shortName(s.to_table))}.<b>${escapeHtml(s.to_column)}</b>
      </div>
      <div class="actions">
        <button class="mini" data-act="reject" title="Hide this suggestion (added to meta.suggestion_suppressions)">Reject</button>
        <button class="mini" data-act="accept" title="Open the New-relationship modal pre-filled with these endpoints">Accept →</button>
      </div>
    </div>`).join('');
  host.querySelectorAll('.sug').forEach(card => {
    const i = Number(card.dataset.i);
    card.querySelector('[data-act="accept"]').onclick = () => acceptSuggestion(list[i]);
    card.querySelector('[data-act="reject"]').onclick = () => rejectSuggestion(list[i]);
  });
}

function acceptSuggestion(s){
  openRelModal({
    from: s.from_table, to: s.to_table, kind: 'fk',
    from_column: s.from_column, to_column: s.to_column,
    cardinality: 'n:1',
  });
}

function rejectSuggestion(s){
  const list = getSuppressions();
  list.push({
    from_table: s.from_table, from_column: s.from_column,
    to_table:   s.to_table,   to_column:   s.to_column,
  });
  setSuppressions(list);
  markDirty();
  STATE.suggestionsCache = null;
  renderSuggestions();
  updateCounts();
  toast('Suggestion dismissed.', 'success');
}

/* ──────────────────────────────────────────────────────────────────── */
/* data tables view (all 6 tabs)                                        */
/* ──────────────────────────────────────────────────────────────────── */
const DATA_COLS = {
  domains:           ['domain_id', 'domain_name', 'x', 'y', 'radius', 'color', 'icon'],
  tables:            ['table_fqn', 'domain_id', 'short_name', 'grain', 'source_system', 'share'],
  columns:           ['table_fqn', 'column', 'type', 'nullable', 'pii'],
  relationships:     ['kind', 'from', 'to', 'from_column', 'to_column', 'cardinality'],
  bucket_table_xref: ['bucket_id', 'table_fqn', 'access', 'notes'],
  meta:              ['key', 'value'],
};

function renderDataTab(){
  const tab = STATE.dataTab;
  $$('.dt-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const cols = DATA_COLS[tab];
  const rows = (STATE.data && STATE.data[tab]) || [];
  const html = `<table>
    <thead><tr>${cols.map(c => `<th title="${escapeHtml(c)}">${escapeHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr data-i="${i}">
      ${cols.map(c => `<td title="${escapeHtml(String(r[c] ?? ''))}">${escapeHtml(String(r[c] ?? ''))}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table>`;
  $('#data-host').innerHTML = html;
  $$('#data-host tbody tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const i = Number(tr.dataset.i);
      const r = rows[i];
      if (tab === 'domains'){
        selectEntity('domain', r.domain_id);
        if (STATE.view === 'domain') enterSolo(r.domain_id);
      }
      else if (tab === 'tables'){
        selectEntity('table', r.table_fqn);
        if (STATE.view === 'domain' && r.domain_id) enterSolo(r.domain_id);
      }
      else if (tab === 'relationships') selectEntity('rel', i);
      else if (tab === 'columns'){
        selectEntity('column', r.table_fqn + '.' + r.column);
        if (STATE.view === 'domain'){
          const tbl = findTable(r.table_fqn);
          if (tbl && tbl.domain_id) enterSolo(tbl.domain_id);
        }
      }
    });
  });
}

/* ──────────────────────────────────────────────────────────────────── */
/* wiring                                                               */
/* ──────────────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────────────── */
/* search omnibox (Spotlight-style — mirrors mini-wiki 08_Semantic_Model) */
/* ──────────────────────────────────────────────────────────────────── */
/* Index built on every keystroke from STATE.data (data is small and
   mutates constantly — domains/tables/columns add+rename via inspector,
   import xlsx, reload). Match: case-insensitive substring. Rank:
   exact > prefix > word-boundary > substring; tiebreak shorter-then-alpha.
   Results grouped by entity type, capped 5 per group.

   Activation:
     - Domain → selectEntity('domain', id) + cy.center on d::<id>.
     - Table  → selectEntity('table',  fqn) + cy.center on t::<fqn>.
     - Column in Table-model view → selectEntity('column', fqn+'.'+col)
       and cy.center on c::<fqn>::<col>.
     - Column in Domain-map view → column nodes don't exist there, so
       select+center the parent table instead.
   No auto-switching between Domain map ↔ Table model. */
const SEARCH_PER_GROUP_CAP = 5;

function buildSearchIndex(){
  const idx = { domain: [], table: [], column: [] };
  if (!STATE.data) return idx;
  for (const d of STATE.data.domains){
    const name = d.domain_name || d.domain_id;
    idx.domain.push({ kind:'domain', label: name, meta: d.description || '', id: d.domain_id });
    // Also let users type the upper-case ID (e.g. "POLICY") to find the
    // same domain — collapsed in rankGroup via dedupBy:'id'.
    if (d.domain_id && d.domain_id !== name){
      idx.domain.push({ kind:'domain', label: d.domain_id, meta: d.description || '', id: d.domain_id, _alias:true });
    }
  }
  // Table is searchable by both short_name and full fqn (two index entries
  // pointing to the same target — collapsed in rankGroup via dedupBy:'fqn').
  for (const t of STATE.data.tables){
    const sn = t.short_name || shortName(t.table_fqn);
    idx.table.push({ kind:'table', label: sn,           meta: t.table_fqn, fqn: t.table_fqn, domainId: t.domain_id });
    idx.table.push({ kind:'table', label: t.table_fqn,  meta: sn,          fqn: t.table_fqn, domainId: t.domain_id, _alias:true });
  }
  for (const c of STATE.data.columns){
    const t = STATE.data.tables.find(x => x.table_fqn === c.table_fqn);
    const sn = t ? (t.short_name || shortName(t.table_fqn)) : shortName(c.table_fqn);
    idx.column.push({ kind:'column', label: c.column, meta: sn, fqn: c.table_fqn, column: c.column, domainId: t ? t.domain_id : null });
  }
  return idx;
}

function searchScore(label, q){
  // Lower is better. Negative = no match.
  const L = String(label).toLowerCase(), Q = q.toLowerCase();
  if (L === Q) return 0;
  if (L.startsWith(Q)) return 1;
  const wb = new RegExp('(^|[^a-z0-9])' + Q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (wb.test(L)) return 2;
  if (L.includes(Q)) return 3;
  return -1;
}

function searchRankGroup(items, q, opts){
  opts = opts || {};
  const scored = [];
  for (const it of items){
    const s = searchScore(it.label, q);
    if (s < 0) continue;
    scored.push({ it, s });
  }
  scored.sort((a, b) => {
    if (a.s !== b.s) return a.s - b.s;
    if (a.it.label.length !== b.it.label.length) return a.it.label.length - b.it.label.length;
    return String(a.it.label).localeCompare(String(b.it.label));
  });
  const out = [], dedup = new Set();
  for (const e of scored){
    const k = opts.dedupBy ? e.it[opts.dedupBy] : null;
    if (k){ if (dedup.has(k)) continue; dedup.add(k); }
    out.push(e.it);
  }
  return out;
}

function searchHighlight(label, q){
  const s = String(label);
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escapeHtml(s);
  return escapeHtml(s.slice(0, i)) + '<b>' + escapeHtml(s.slice(i, i + q.length)) + '</b>' + escapeHtml(s.slice(i + q.length));
}

function mountSearch(){
  const input = $('#search');
  const box   = $('#search-results');
  if (!input || !box) return;

  let flatRows = [], activeIdx = -1, lastQ = '';

  function open(){  box.classList.add('open');    input.setAttribute('aria-expanded', 'true'); }
  function close(){ box.classList.remove('open'); input.setAttribute('aria-expanded', 'false'); activeIdx = -1; flatRows = []; }
  function paintActive(){
    box.querySelectorAll('.sr-row').forEach(r => r.classList.remove('active'));
    if (activeIdx >= 0){
      const r = box.querySelector('.sr-row[data-ridx="' + activeIdx + '"]');
      if (r){ r.classList.add('active'); r.scrollIntoView({block:'nearest'}); }
    }
  }

  function render(q){
    flatRows = []; activeIdx = -1;
    if (!q || !q.trim()){ close(); return; }
    q = q.trim();

    const idx = buildSearchIndex();
    const groups = [
      { key:'domain', head:'Domains', hits: searchRankGroup(idx.domain, q, {dedupBy:'id'}) },
      { key:'table',  head:'Tables',  hits: searchRankGroup(idx.table,  q, {dedupBy:'fqn'}) },
      { key:'column', head:'Columns', hits: searchRankGroup(idx.column, q) },
    ];
    const total = groups.reduce((a, g) => a + g.hits.length, 0);
    if (total === 0){
      box.innerHTML = '<div class="sr-empty">No matches for <code>' + escapeHtml(q) + '</code></div>';
      open(); return;
    }

    let html = '';
    for (const g of groups){
      if (!g.hits.length) continue;
      const shown = g.hits.slice(0, SEARCH_PER_GROUP_CAP);
      const overflow = g.hits.length - shown.length;
      html += '<div class="sr-group"><div class="sr-head">' + g.head + ' · ' + g.hits.length + '</div>';
      for (const it of shown){
        const ridx = flatRows.length;
        flatRows.push(it);
        const meta = it.kind === 'column' ? '→ ' + escapeHtml(it.meta)
                   : it.kind === 'table'  ? escapeHtml(it.meta)
                   : escapeHtml(String(it.meta || '')).slice(0, 60);
        html += '<div class="sr-row" data-ridx="' + ridx + '" role="option">' +
                '<span class="sr-name">' + searchHighlight(it.label, q) + '</span>' +
                '<span class="sr-meta">' + meta + '</span></div>';
      }
      if (overflow > 0){
        html += '<div class="sr-more">…and ' + overflow + ' more — refine your query.</div>';
      }
      html += '</div>';
    }
    box.innerHTML = html;
    open();
    activeIdx = 0;
    paintActive();
  }

  function activate(it){
    close();
    input.value = ''; lastQ = '';
    input.blur();
    const inTableMode = STATE.view === 'table';
    if (it.kind === 'domain'){
      selectEntity('domain', it.id);
      if (!inTableMode) enterSolo(it.id);
      const n = STATE.cy && STATE.cy.$id('d::' + it.id);
      if (n && n.nonempty()) STATE.cy.animate({ center:{eles:n}, zoom: Math.max(STATE.cy.zoom(), 0.9) }, { duration: 280 });
      return;
    }
    if (it.kind === 'table'){
      if (!inTableMode){
        const tbl = findTable(it.fqn);
        if (tbl && tbl.domain_id) enterSolo(tbl.domain_id);
      }
      selectEntity('table', it.fqn);
      const n = STATE.cy && STATE.cy.$id('t::' + it.fqn);
      if (n && n.nonempty()) STATE.cy.animate({ center:{eles:n}, zoom: Math.max(STATE.cy.zoom(), 1.0) }, { duration: 280 });
      return;
    }
    // column
    if (inTableMode){
      selectEntity('column', it.fqn + '.' + it.column);
      const n = STATE.cy && STATE.cy.$id('c::' + it.fqn + '::' + it.column);
      if (n && n.nonempty()) STATE.cy.animate({ center:{eles:n}, zoom: Math.max(STATE.cy.zoom(), 1.1) }, { duration: 280 });
    } else {
      // Domain map: no column nodes — solo the parent domain and centre on
      // the satellite for the parent table.
      const tbl = findTable(it.fqn);
      if (tbl && tbl.domain_id) enterSolo(tbl.domain_id);
      selectEntity('column', it.fqn + '.' + it.column);
      const n = STATE.cy && STATE.cy.$id('t::' + it.fqn);
      if (n && n.nonempty()) STATE.cy.animate({ center:{eles:n}, zoom: Math.max(STATE.cy.zoom(), 0.9) }, { duration: 280 });
    }
  }

  input.addEventListener('input', () => {
    const q = input.value;
    if (q === lastQ) return;
    lastQ = q;
    render(q);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) render(input.value);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown'){
      if (!flatRows.length) return;
      e.preventDefault();
      activeIdx = (activeIdx + 1) % flatRows.length;
      paintActive();
    } else if (e.key === 'ArrowUp'){
      if (!flatRows.length) return;
      e.preventDefault();
      activeIdx = (activeIdx - 1 + flatRows.length) % flatRows.length;
      paintActive();
    } else if (e.key === 'Enter'){
      if (activeIdx >= 0 && flatRows[activeIdx]){
        e.preventDefault();
        activate(flatRows[activeIdx]);
      }
    } else if (e.key === 'Escape'){
      e.preventDefault();
      if (box.classList.contains('open')) close();
      else { input.value = ''; lastQ = ''; input.blur(); }
      e.stopPropagation();
    }
  });
  box.addEventListener('mousedown', e => {
    const row = e.target.closest('.sr-row');
    if (!row) return;
    e.preventDefault();  // keep input focused until activate() blurs it
    const r = flatRows[+row.dataset.ridx];
    if (r) activate(r);
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) close();
  });

  // Global keyboard: '/' and Ctrl/Cmd+K focus the omnibox.
  // Guard: skip when the user is typing in another field.
  document.addEventListener('keydown', e => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')
                 || (document.activeElement && document.activeElement.isContentEditable);
    if (!inField && e.key === '/'){
      e.preventDefault(); input.focus(); input.select();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){
      e.preventDefault(); input.focus(); input.select();
    }
  });
}

function wire(){
  $('#vt-domain').onclick = () => setView('domain');
  $('#vt-table').onclick  = () => setView('table');

  $$('.st-btn').forEach(b => b.onclick = () => setSidePane(b.dataset.side));
  $$('.dt-btn').forEach(b => b.onclick = () => { STATE.dataTab = b.dataset.tab; renderDataTab(); });

  $('#btn-save').onclick   = saveData;
  $('#btn-reload').onclick = () => {
    if (STATE.dirty && !confirm('Discard unsaved changes and reload from disk?')) return;
    loadData();
  };
  $('#btn-fit').onclick      = () => STATE.cy && STATE.cy.fit(undefined, 40);
  $('#btn-recenter').onclick = () => STATE.cy && STATE.cy.zoom(1) && STATE.cy.center();
  $('#btn-toggle-suggest').onclick = () => setSidePane('suggest');

  $('#btn-add-domain').onclick = addDomain;
  $('#btn-add-table').onclick  = addTable;
  $('#btn-add-rel').onclick    = () => openRelModal({});

  $('#btn-import').onclick = () => $('#file-import').click();
  $('#file-import').onchange = e => {
    const f = e.target.files[0];
    if (f) importXlsx(f);
    e.target.value = '';
  };
  $('#btn-export').onclick = exportXlsx;

  $('#rel-cancel').onclick = () => $('#rel-modal').classList.remove('open');
  $('#boot-cancel').onclick = closeBootModal;
  $('#boot-import').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx';
    inp.onchange = e => { const f = e.target.files[0]; if (f) importXlsx(f); };
    inp.click();
  };

  // Ctrl/Cmd+S to save.
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){
      e.preventDefault();
      if (!$('#btn-save').disabled) saveData();
    } else if (e.key === 'Escape'){
      const openModals = $$('.modal.open');
      if (openModals.length){
        openModals.forEach(m => m.classList.remove('open'));
      } else if (STATE.view === 'domain' && STATE.soloDomainId){
        exitSolo();
      }
    }
  });

  // Solo-mode controls (breadcrumb + Tidy chips on canvas top-left).
  const back = $('#solo-back');
  if (back) back.onclick = () => exitSolo();
  const tidy = $('#solo-tidy');
  if (tidy) tidy.onclick = () => tidySoloLayout();

  window.addEventListener('beforeunload', e => {
    if (STATE.dirty){ e.preventDefault(); e.returnValue = ''; }
  });

  window.addEventListener('resize', () => {
    if (STATE.cy) STATE.cy.resize();
  });
}

/* ──────────────────────────────────────────────────────────────────── */
/* main                                                                 */
/* ──────────────────────────────────────────────────────────────────── */
function start(){
  if (typeof cytoscape === 'undefined'){
    setStatus('error', 'cytoscape.js failed to load');
    toast('cytoscape.js missing — check assets/vendor/cytoscape.min.js', 'error');
    return;
  }
  wire();
  initCy();
  mountSearch();
  loadData();
  // Narrow test hook — used by scripts/smoke_semantic_editor.py.
  // Not part of the public API; do not call from anywhere else.
  window.__editor = { openRelModal, selectEntity, getState: () => STATE,
                      enterSolo, exitSolo, tidySoloLayout };
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

})();
