/* =====================================================================
   VN Inventory Admin — vanilla JS, no framework, no build step.
   Loads handovers/inventory.json over HTTP, edits in-memory, saves via
   HTTP PUT to /inventory.json (the serve_admin.py endpoint handles .bak).
   ===================================================================== */

const STATE = {
  data: null,           // full inventory.json payload
  tab: "Project",
  q: "",
  showRetired: false,
  dirty: false,
  etag: null,           // ETag of last loaded inventory.json (optimistic-concurrency)
};

const CAT_PREFIX = {Project:"PRJ", Campaign:"CMP", Model:"MOD", BAU:"BAU", Strategy:"STR", Adhoc:"ADH"};
const PREFIX_CAT = Object.fromEntries(Object.entries(CAT_PREFIX).map(([k,v])=>[v,k]));
const STATUSES = ["Active","Completed","Superseded","Retired"];
// Manuals carry a trimmed 2-value status (see CONTEXT.md). Missing/blank in
// inventory.json is treated as Active everywhere — no JSON migration needed.
const MANUAL_STATUSES = ["Active","Retired"];
const TIERS = ["P0","P1","P2"];

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/* ─── load / save ─────────────────────────────────────────── */
async function loadData(){
  setStatus("loading", "loading…");
  try {
    const r = await fetch("inventory.json", {cache:"no-store"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    STATE.etag = r.headers.get("ETag");
    STATE.data = await r.json();
    STATE.dirty = false;
    setStatus("saved", "loaded · " + new Date().toLocaleTimeString());
    $("#btn-save").disabled = true;
    render();
  } catch (e) {
    setStatus("error", "couldn't load inventory.json — " + e.message);
    toast("Load failed — is serve_admin.py running?", "error");
  }
}

async function saveData(){
  if (!STATE.data) return;
  STATE.data._meta = STATE.data._meta || {};
  STATE.data._meta.generated = new Date().toISOString().slice(0,19);
  STATE.data._meta.edited_via = "admin.html";
  const body = JSON.stringify(STATE.data, null, 2) + "\n";
  setStatus("loading", "saving…");
  try {
    const headers = {"Content-Type":"application/json"};
    if (STATE.etag) headers["If-Match"] = STATE.etag;
    const r = await fetch("inventory.json", {method:"PUT", body, headers});
    if (r.status === 412) {
      setStatus("error", "conflict — file changed on disk");
      toast("Save aborted: inventory.json changed since you loaded it. Reload to merge.", "error");
      return;
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    // The server returns the new ETag on 204 — capture it so the next save also works.
    const nextEtag = r.headers.get("ETag");
    if (nextEtag) STATE.etag = nextEtag;
    STATE.dirty = false;
    $("#btn-save").disabled = true;
    setStatus("saved", "saved · " + new Date().toLocaleTimeString());
    toast("Saved. Run rebuild_wiki.py to refresh the wiki.", "success");
  } catch (e) {
    setStatus("error", "save failed — " + e.message);
    toast("Save failed: " + e.message, "error");
  }
}

function markDirty(){
  STATE.dirty = true;
  $("#btn-save").disabled = false;
  setStatus("dirty", "unsaved changes");
}

function setStatus(cls, txt){
  const el = $("#status");
  el.className = "status " + cls;
  $("#status-text").textContent = txt;
}

function toast(msg, kind){
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast show " + (kind || "");
  setTimeout(()=>el.className = "toast " + (kind || ""), 2800);
}

/* ─── render ──────────────────────────────────────────────── */
function refreshCounts(){
  if (!STATE.data) return;
  for (const cat of Object.keys(CAT_PREFIX)){
    const rows = rowsFor(cat);
    const visible = rows.filter(r => STATE.showRetired || !isRetired(r)).length;
    $(`[data-count="${cat}"]`).textContent = visible;
  }
  // Manuals — visible count (post-filter) so the badge moves with the
  // "show retired" toggle. Missing status counts as Active (Q2 resolution).
  const allMan = STATE.data.manuals || [];
  const mcEl = document.querySelector('[data-count="Manual"]');
  if (mcEl) mcEl.textContent = allMan.filter(r => STATE.showRetired || !isRetired(r)).length;
  // Hidden-retired count for the current tab (helps users discover the toggle).
  const rcEl = $("#retired-count");
  if (rcEl){
    const noStatus = (STATE.tab === "Settings");
    if (noStatus || STATE.showRetired){
      rcEl.textContent = "";
    } else {
      const hidden = rowsFor(STATE.tab).filter(isRetired).length;
      rcEl.textContent = hidden ? `(${hidden} hidden)` : "";
    }
  }
}

function rowsFor(cat){
  if (cat === "Manual")   return STATE.data.manuals || [];
  if (cat === "Settings") return [];   // settings is a single record, not a table
  return (STATE.data.buckets || []).filter(b => b.category === cat);
}

function isRetired(r){ return String(r.status || "").startsWith("Retired"); }

function filteredRows(){
  const all = rowsFor(STATE.tab);
  const q = STATE.q.toLowerCase().trim();
  const noStatus = (STATE.tab === "Settings");
  return all.filter(r => {
    if (!noStatus && !STATE.showRetired && isRetired(r)) return false;
    if (!q) return true;
    return Object.values(r).some(v => String(v||"").toLowerCase().includes(q));
  });
}

function render(){
  if (!STATE.data) return;
  refreshCounts();
  // +Add row is meaningless on the Settings tab
  const addBtn = $("#btn-add");
  if (addBtn) addBtn.style.display = (STATE.tab === "Settings") ? "none" : "";
  if (STATE.tab === "Settings"){
    $("#row-count").textContent = "";
    $("#tbl-host").innerHTML = renderSettings();
    wireSettings();
    return;
  }
  const rows = filteredRows();
  $("#row-count").textContent = rows.length + " row" + (rows.length === 1 ? "" : "s");
  const host = $("#tbl-host");
  if (!rows.length){
    host.innerHTML = '<div class="empty-state">No rows in this tab. Click <b>+ Add row</b> above to create one.</div>';
    return;
  }
  if (STATE.tab === "Manual") host.innerHTML = renderManuals(rows);
  else                        host.innerHTML = renderBuckets(rows);
  wireRowInputs();
}

function renderBuckets(rows){
  const SP_OV = STATE.data.sp_overrides || {};
  const MW = STATE.data.mini_wikis || {};
  const trs = rows.map(r => {
    const sp = SP_OV[r.bucket_id] || "";
    const mw = (MW[r.bucket_id]||{}).file || "";
    return `<tr data-id="${esc(r.bucket_id)}" class="${isRetired(r)?'retired':''}">
      <td><input class="mono fld" data-k="bucket_id" value="${esc(r.bucket_id)}"></td>
      <td><input class="fld" data-k="name" value="${esc(r.name)}"></td>
      <td>${sel('status', r.status, STATUSES)}</td>
      <td>${sel('tier', r.tier, TIERS)}</td>
      <td><input class="mono fld" data-k="year" value="${esc(r.year)}" style="width:60px"></td>
      <td><input class="fld" data-k="source_plan" value="${esc(r.source_plan||'')}" placeholder="scan-…md"></td>
      <td><input class="mono fld sp-fld" data-k="_sp_override" value="${esc(sp)}" placeholder="2026/Foo/ or https://…"></td>
      <td><input class="mono fld" data-k="repo_link" value="${esc(r.repo_link||'')}" placeholder="folder/path/"></td>
      <td><input class="fld" data-k="repo_role" value="${esc(r.repo_role||'')}" placeholder="e.g. analytical baseline" title="Optional short label shown in parens next to the bucket ID on the Repo map (e.g. 'AWO Phase-1', 'operational'). Leave blank if obvious."></td>
      <td><textarea class="fld" data-k="purpose">${esc(r.purpose||'')}</textarea></td>
      <td><input class="fld" data-k="lineage" value="${esc(r.lineage||'')}" placeholder="supersedes …"></td>
      <td>
        <input class="mono fld" data-k="_mini_wiki" value="${esc(mw)}" placeholder="00_*.html or https://…" title="Local mini-wiki file (e.g. 00_FOO.html, sibling of index.html) OR full URL (https://…). Either makes the hero card show a 'Deep pack ↓' CTA." style="width:220px">
      </td>
      <td class="actions">
        <button data-act="narrative" title="Edit Decisions baked in / Open questions">📝</button>
        <button class="del" data-act="delete" title="Hard-delete this row from inventory.json (asks to confirm)">Delete</button>
      </td>
    </tr>`;
  }).join("");
  return `<table class="tbl">
    <colgroup>
      <col style="width:110px"><col style="width:200px"><col style="width:120px"><col style="width:70px">
      <col style="width:70px"><col style="width:140px"><col style="width:180px"><col style="width:180px">
      <col style="width:150px"><col style="width:240px"><col style="width:180px"><col style="width:200px"><col style="width:130px">
    </colgroup>
    <thead><tr>
      <th>Bucket ID</th><th>Name</th><th>Status</th><th>Tier</th>
      <th>Year</th><th>Source plan</th><th>SharePoint</th><th>Repo link</th>
      <th>Repo role</th><th>Purpose</th><th>Lineage</th><th>Pack / mini-wiki</th><th></th>
    </tr></thead>
    <tbody>${trs}</tbody>
  </table>`;
}

function renderSettings(){
  const s = STATE.data.settings || {};
  const root = s.sp_root || "";
  return `<div style="padding:24px 28px;max-width:880px">
    <h2 style="font-family:var(--serif);font-weight:500;font-size:22px;margin:0 0 6px">Settings</h2>
    <p style="color:var(--g500);font-size:13px;margin:0 0 22px">Global values applied by the wiki renderer. Edit, then click <b>Save</b> in the header.</p>

    <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--g700);margin-bottom:8px">
      <span style="font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--g500);display:inline-flex;align-items:center;gap:6px">
        SharePoint root
        <span class="info" title="The default parent URL or folder that every bucket's SharePoint sub-path is appended to. Override per bucket by typing a full URL in the SharePoint field." aria-label="info">i</span>
      </span>
      <input id="set-sp-root" class="mono" type="text" value="${esc(root)}"
        style="font:inherit;font-size:13px;padding:9px 12px;border:1.5px solid var(--g300);border-radius:6px;background:var(--paper)"
        placeholder="https://your-tenant.sharepoint.com/sites/your-site/folder/">
    </label>
    <div id="set-sp-detect" style="font-family:var(--mono);font-size:11px;color:var(--g500);padding:8px 0 4px"></div>
    <button id="set-sp-convert" class="btn" style="display:none;margin-top:6px">➜ Convert to path-style URL</button>

    <div style="height:1px;background:var(--g200);margin:26px 0 22px"></div>

    <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--g700);margin-bottom:8px">
      <span style="font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--g500);display:inline-flex;align-items:center;gap:6px">
        Repo root
        <span class="info" title="Base URL of the code repo (e.g. https://github.com/<org>/<repo>). The wiki appends /tree/<branch>/ for folders and /blob/<branch>/ for files. Leave blank to use the built-in default. Applies on next rebuild_wiki.py run." aria-label="info">i</span>
      </span>
      <input id="set-repo-root" class="mono" type="text" value="${esc(s.repo_root||'')}"
        style="font:inherit;font-size:13px;padding:9px 12px;border:1.5px solid var(--g300);border-radius:6px;background:var(--paper)"
        placeholder="https://github.com/your-org/your-repo">
    </label>
    <div id="set-repo-detect" style="font-family:var(--mono);font-size:11px;color:var(--g500);padding:8px 0 4px"></div>
    <button id="set-repo-strip" class="btn" style="display:none;margin-top:6px">➜ Strip /tree/&lt;branch&gt;/ suffix</button>

    <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--g700);margin:14px 0 8px">
      <span style="font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--g500);display:inline-flex;align-items:center;gap:6px">
        Repo branch
        <span class="info" title="Branch name used in /tree/<branch>/ and /blob/<branch>/ links. Defaults to 'main' if blank." aria-label="info">i</span>
      </span>
      <input id="set-repo-branch" class="mono" type="text" value="${esc(s.repo_branch||'')}"
        style="font:inherit;font-size:13px;padding:9px 12px;border:1.5px solid var(--g300);border-radius:6px;background:var(--paper);max-width:240px"
        placeholder="main">
    </label>

    <div style="font-family:var(--mono);font-size:11px;color:var(--g500);padding:4px 0 0">
      Note: repo settings apply on the next <code>rebuild_wiki.py</code> run. Empty values fall back to the built-in defaults.
    </div>

    <div style="margin-top:32px;padding:14px 16px;background:var(--g100);border-radius:8px;font-size:12.5px;line-height:1.55;color:var(--g700)">
      <b>Accepted formats:</b>
      <ul style="margin:8px 0 0 18px;padding:0">
        <li><b>SharePoint URL</b> &mdash; e.g. <code>https://tenant.sharepoint.com/sites/your-site/folder/</code> &rarr; sub-paths are clickable</li>
        <li><b>OneDrive path-URL</b> &mdash; e.g. <code>https://tenant-my.sharepoint.com/personal/you/Documents/Folder/</code> &rarr; clickable</li>
        <li><b>OneDrive query-URL</b> &mdash; e.g. <code>…/my?id=%2Fpersonal%2F…</code> &rarr; <i>cannot</i> have sub-paths appended; use the converter button above</li>
        <li><b>Local path</b> &mdash; e.g. <code>C:\Users\you\Folder\</code> &rarr; rendered as copy-only text (browsers block <code>file://</code> links)</li>
        <li><b>UNC share</b> &mdash; e.g. <code>\\server\share\</code> &rarr; same as local: copy-only</li>
      </ul>
    </div>
  </div>`;
}

function _detectSpRootKind(v){
  v = String(v||"").trim();
  if (!v) return {kind:"empty", msg:"⚠ No root set — SharePoint chips will be hidden.", color:"var(--warning)"};
  if (/^https?:\/\/[^/]+\/(?:my|personal\/[^/]+)\?.*[?&]id=/i.test(v))
    return {kind:"od-query", msg:"✖ OneDrive query-style URL detected. Sub-paths cannot be appended — click Convert.", color:"var(--danger)"};
  if (/^https?:\/\//i.test(v))
    return {kind:"url", msg:"✔ Web URL detected — sub-paths will be clickable links.", color:"var(--success)"};
  if (/^[A-Za-z]:[\\/]/.test(v) || v.startsWith("\\\\") || v.startsWith("/"))
    return {kind:"local", msg:"ℹ Local / UNC path detected — sub-paths will be copy-only (browsers block file:// links).", color:"var(--mauve)"};
  return {kind:"unknown", msg:"? Unrecognised root format. Will be used verbatim.", color:"var(--g500)"};
}

function _convertOneDriveQueryUrl(v){
  const m = String(v||"").match(/^(https:\/\/[^/]+)\/(?:my|personal\/[^/]+)\?(?:.*?&)?id=([^&]+)/i);
  if (!m) return v;
  return m[1] + decodeURIComponent(m[2]).replace(/\/$/, "") + "/";
}

function _detectRepoRootKind(v){
  v = String(v||"").trim();
  if (!v) return {kind:"empty", msg:"ℹ Empty — built-in default repo root will be used.", color:"var(--g500)", showStrip:false};
  if (/\/(tree|blob)\/[^/]+\/?/i.test(v))
    return {kind:"has-tree", msg:"✖ This is a /tree/ or /blob/ URL — click below to strip it. Branch goes in the field below.", color:"var(--danger)", showStrip:true};
  if (/^https?:\/\/(?:github\.com|gitlab\.com|bitbucket\.org|dev\.azure\.com)\/[^/]+\/[^/?#]+\/?$/i.test(v))
    return {kind:"known", msg:"✔ Recognised repo host — tree/<branch>/ and blob/<branch>/ links will be generated.", color:"var(--success)", showStrip:false};
  if (/^https?:\/\//i.test(v))
    return {kind:"other-url", msg:"ℹ Non-standard host — used verbatim. Confirm /tree/<branch>/<path> URLs work for this host.", color:"var(--warning)", showStrip:false};
  return {kind:"unknown", msg:"? Not an http(s) URL — repo links will likely be broken.", color:"var(--danger)", showStrip:false};
}

function _stripRepoTreeBlob(v){
  return String(v||"").replace(/\/(?:tree|blob)\/[^/]+\/?.*$/i, "").replace(/\/+$/, "");
}

function wireSettings(){
  const inp = $("#set-sp-root");
  const det = $("#set-sp-detect");
  const cnv = $("#set-sp-convert");
  const refresh = () => {
    const d = _detectSpRootKind(inp.value);
    det.textContent = d.msg;
    det.style.color = d.color;
    cnv.style.display = (d.kind === "od-query") ? "inline-flex" : "none";
  };
  inp.addEventListener("input", () => {
    STATE.data.settings = STATE.data.settings || {};
    STATE.data.settings.sp_root = inp.value;
    markDirty();
    refresh();
  });
  cnv.addEventListener("click", () => {
    const next = _convertOneDriveQueryUrl(inp.value);
    if (next !== inp.value){
      inp.value = next;
      STATE.data.settings = STATE.data.settings || {};
      STATE.data.settings.sp_root = next;
      markDirty();
      refresh();
      toast("Converted to path-style URL.", "success");
    }
  });
  refresh();

  // Repo root + branch
  const rrInp = $("#set-repo-root");
  const rbInp = $("#set-repo-branch");
  const rrDet = $("#set-repo-detect");
  const rrStr = $("#set-repo-strip");
  const refreshRepo = () => {
    const d = _detectRepoRootKind(rrInp.value);
    rrDet.textContent = d.msg;
    rrDet.style.color = d.color;
    rrStr.style.display = d.showStrip ? "inline-flex" : "none";
  };
  rrInp.addEventListener("input", () => {
    STATE.data.settings = STATE.data.settings || {};
    STATE.data.settings.repo_root = rrInp.value;
    markDirty();
    refreshRepo();
  });
  rbInp.addEventListener("input", () => {
    STATE.data.settings = STATE.data.settings || {};
    STATE.data.settings.repo_branch = rbInp.value;
    markDirty();
  });
  rrStr.addEventListener("click", () => {
    const next = _stripRepoTreeBlob(rrInp.value);
    if (next !== rrInp.value){
      rrInp.value = next;
      STATE.data.settings = STATE.data.settings || {};
      STATE.data.settings.repo_root = next;
      markDirty();
      refreshRepo();
      toast("Stripped /tree/<branch>/ suffix.", "success");
    }
  });
  refreshRepo();
}

function renderManuals(rows){
  const KIND_OPTS = ["", "doc", "pdf", "xlsx", "pptx", "video", "html"];
  const kindSel = (v) => `<select class="fld mono" data-k="kind">${
    KIND_OPTS.map(o => `<option value="${o}"${v===o?' selected':''}>${o||'(auto)'}</option>`).join("")
  }</select>`;
  // Status select: missing/blank renders as Active (display only — JSON stays untouched
  // until the user explicitly picks a value).
  const statusSel = (v) => {
    const cur = v || "Active";
    return `<select class="fld mono" data-k="status">${
      MANUAL_STATUSES.map(o => `<option value="${o}"${cur===o?' selected':''}>${o}</option>`).join("")
    }</select>`;
  };
  const trs = rows.map((r, i) => `<tr data-id="man-${i}" data-kind="manual" class="${isRetired(r)?'retired':''}">
    <td><input class="mono fld" data-k="id" value="${esc(r.id||'')}" placeholder="MAN-2026-01"></td>
    <td><input class="fld" data-k="title" value="${esc(r.title||'')}" placeholder="Onboarding Guide"></td>
    <td>${statusSel(r.status)}</td>
    <td><textarea class="fld" data-k="desc" placeholder="One-liner description">${esc(r.desc||'')}</textarea></td>
    <td><input class="mono fld" data-k="file" value="${esc(r.file||'')}" placeholder="01_Guide.html (resolves to wiki root)"></td>
    <td><input class="mono fld" data-k="url" value="${esc(r.url||'')}" placeholder="https://… (optional; wins over file)"></td>
    <td>${kindSel(r.kind||'')}</td>
    <td class="actions">
      <button class="del" data-act="delete" title="Hard-delete this manual (asks to confirm)">Delete</button>
    </td>
  </tr>`).join("");
  return `<table class="tbl">
    <colgroup>
      <col style="width:120px"><col style="width:200px"><col style="width:110px"><col style="width:auto"><col style="width:220px"><col style="width:240px"><col style="width:90px"><col style="width:90px">
    </colgroup>
    <thead><tr>
      <th title="Pattern: MAN-YYYY-NN">ID</th>
      <th>Title</th>
      <th title="Active = listed on the public wiki. Retired = soft-deleted; hidden from the wiki and survives an xlsx re-import.">Status</th>
      <th>Description</th>
      <th title="Bare filename resolves to the wiki root (sibling of index.html). A path containing / is used as-is.">File</th>
      <th title="Optional. Takes precedence over File. Supports http(s) and SharePoint.">URL</th>
      <th title="Document kind. Leave blank to auto-detect from extension (mp4/webm/mov → video; html/htm → html; pdf/doc/xlsx/pptx → matching icon).">Kind</th>
      <th></th>
    </tr></thead>
    <tbody>${trs}</tbody>
  </table>`;
}

function tabKind(){
  if (STATE.tab === "Manual")   return "manual";
  if (STATE.tab === "Settings") return "settings";
  return "bucket";
}

function sel(k, v, opts){
  return `<select class="fld" data-k="${k}">${opts.map(o => `<option ${String(v)===o?'selected':''}>${o}</option>`).join("")}</select>`;
}

function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ─── inline edit wiring ──────────────────────────────────── */
function wireRowInputs(){
  const kind = tabKind();
  $$("#tbl-host tr[data-id]").forEach(tr => {
    const id = tr.dataset.id;
    const row = findRow(kind, id);
    if (!row) return;
    tr.querySelectorAll(".fld").forEach(el => {
      el.addEventListener("input", () => {
        const k = el.dataset.k;
        const v = (el.type === "checkbox") ? el.checked : el.value;
        applyEdit(row, k, v, tr);
        markDirty();
        if (kind === "adhoc" && k !== "last_touch"){
          // auto-stamp last_touch when any other field changes
          row.last_touch = todayISO();
          const lt = tr.querySelector('input[data-k="last_touch"]');
          if (lt) lt.value = row.last_touch;
        }
        validateRow(row, tr);
        if (k === "bucket_id"){ refreshCounts(); }
        if (k === "status" && isRetired(row) && !STATE.showRetired){
          // Soft-delete UX: warn the user the row is about to be filtered out,
          // then re-render so the row count and visibility match the new state.
          // Works for both Buckets (bucket_id) and Manuals (id).
          toast(`Row ${row.bucket_id || row.id || ""} marked Retired — tick "show retired" to keep it visible.`, "info");
          render();
        } else if (k === "status"){
          refreshCounts();
        }
      });
    });
    tr.querySelectorAll("button[data-act]").forEach(btn => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "delete"){
          deleteRow(kind, row, id);
        } else if (act === "narrative"){
          openNarrative(row.bucket_id);
        }
      });
    });
    validateRow(row, tr);
  });
}

function applyEdit(row, k, v, tr){
  if (k === "_sp_override"){
    if (v) (STATE.data.sp_overrides = STATE.data.sp_overrides || {})[row.bucket_id] = v;
    else if (STATE.data.sp_overrides) delete STATE.data.sp_overrides[row.bucket_id];
    return;
  }
  if (k === "_mini_wiki"){
    STATE.data.mini_wikis = STATE.data.mini_wikis || {};
    const key = row.bucket_id || row.id;
    if (v){
      const isUrl = /^https?:\/\//i.test(v);
      STATE.data.mini_wikis[key] = {
        file: v,
        label: isUrl ? "Open the deep pack →" : "Open the mini-wiki →"
      };
    } else {
      delete STATE.data.mini_wikis[key];
    }
    return;
  }
  if (k === "year"){
    const n = parseInt(v, 10);
    row.year = Number.isFinite(n) ? n : v;
    return;
  }
  row[k] = v;
}

function findRow(kind, id){
  if (kind === "manual"){
    const idx = parseInt(String(id).replace(/^man-/,""), 10);
    return (STATE.data.manuals || [])[idx];
  }
  return (STATE.data.buckets || []).find(r => r.bucket_id === id);
}

function deleteRow(kind, row, rowDomId){
  if (kind === "manual"){
    const idx = parseInt(String(rowDomId||"").replace(/^man-/,""), 10);
    const label = (row.id || row.title || `index ${idx}`);
    const ok = confirm(
      `Permanently delete this manual from inventory.json?\n\n  ${label}\n  ${row.title||""}\n` +
      "\n\nA .bak is rotated on Save, so you can recover by restoring inventory.json.bak before saving again."
    );
    if (!ok) return;
    (STATE.data.manuals || []).splice(idx, 1);
    markDirty(); render();
    toast(`Deleted manual ${label}. Click Save to commit.`, "success");
    return;
  }
  const id = row.bucket_id;
  const label = row.name || row.bucket_id;
  const extras = [];
  if ((STATE.data.mini_wikis||{})[id])         extras.push("• mini_wikis entry (HTML/URL link)");
  if ((STATE.data.sp_overrides||{})[id])       extras.push("• sp_overrides entry");
  if ((STATE.data.narratives||{})[id])         extras.push("• narrative (Decisions / Open questions)");
  const extraTxt = extras.length
    ? "\n\nThis will also remove:\n" + extras.join("\n")
      + "\n\nNote: any sibling 00_*.html mini-wiki file on disk is NOT deleted — remove it manually if you want."
    : "";
  const ok = confirm(
    `Permanently delete this row from inventory.json?\n\n  ${id}\n  ${label}\n` +
    extraTxt +
    "\n\nA .bak is rotated on Save, so you can recover by restoring inventory.json.bak before saving again."
  );
  if (!ok) return;
  STATE.data.buckets = (STATE.data.buckets||[]).filter(r => r.bucket_id !== id);
  if (STATE.data.mini_wikis)  delete STATE.data.mini_wikis[id];
  if (STATE.data.sp_overrides) delete STATE.data.sp_overrides[id];
  if (STATE.data.narratives)   delete STATE.data.narratives[id];
  markDirty(); render();
  toast(`Deleted ${id}. Click Save to commit.`, "success");
}

function validateRow(row, tr){
  const errs = [];
  if (STATE.tab === "Manual"){
    if (!/^MAN-\d{4}-\d{2,3}$/.test(String(row.id||""))) errs.push("ID must be MAN-YYYY-NN");
    if (!String(row.title||"").trim()) errs.push("title required");
    if (!String(row.desc||"").trim())  errs.push("description required");
    if (!String(row.file||"").trim() && !String(row.url||"").trim()) errs.push("file or URL required");
    if (row.url && !/^https?:\/\//i.test(row.url)) errs.push("URL must start with http(s)://");
    tr.classList.toggle("invalid", errs.length > 0);
    tr.title = errs.join(" · ");
    return;
  }
  // bucket (all 6 categories, including Adhoc)
  const prefix = String(row.bucket_id||"").split("-")[0];
  if (prefix && PREFIX_CAT[prefix] !== row.category){
    errs.push("ID prefix " + prefix + " ≠ category " + row.category);
  }
  if (!/^\d{4}$/.test(String(row.year))) errs.push("year must be 4 digits");
  tr.classList.toggle("invalid", errs.length > 0);
  tr.title = errs.join(" · ");
}

function todayISO(){ return new Date().toISOString().slice(0,10); }

/* ─── add-row modal ───────────────────────────────────────── */
// Tuple shape: [name, label, type, required, default, options?, tip?]
const BUCKET_FORM_FIELDS = [
  ["bucket_id",   "Bucket ID (auto)",  "text",     true,  "", null,
    "Auto-generated from Category + Year + next available number. Read-only — change Category or Year to regenerate."],
  ["name",        "Name",           "text",     true,  "", null,
    "Short, human-friendly name shown on the hero card. Example: 'Customer Attrition Analysis'."],
  ["category",    "Category",       "select",   true,  null, Object.keys(CAT_PREFIX),
    "Which section this bucket appears in on the wiki. Pre-filled from the current tab."],
  ["status",      "Status",         "select",   true,  "Active", STATUSES.filter(s=>s!=="Retired"),
    "Active = currently running · Completed = shipped, kept for reference · Superseded = replaced by a newer bucket."],
  ["tier",        "Tier",           "select",   true,  "P1", TIERS,
    "P0 = strategic / board-visible · P1 = important · P2 = nice-to-have / exploratory."],
  ["year",        "Year",           "number",   true,  String(new Date().getFullYear()), null,
    "Year the work started. Used in the Bucket ID and the year-filter chips."],
  ["source_plan", "Source plan",    "text",     false, "", null,
    "Optional reference to an upstream planning doc (e.g. scan-usecases-2026.md). Leave blank if none."],
  ["_sp_override","SharePoint path","text", false, "", null,
    "Where this bucket's files live. Accepts: (a) sub-path under the global SP root (e.g. '2026/CX/Foo/'), (b) full URL ('https://…') to override the root for this one bucket, or (c) local/UNC path (rendered as copy-only). Leave blank to fall back to '<sp_root>/<year>/'."],
  ["repo_link",   "Repo link",      "text",     false, "", null,
    "Optional folder path inside your code repo (e.g. src/your-folder/). Comma-separate if multiple. Becomes one row per path on the Repo map."],
  ["repo_role",   "Repo role",      "text",     false, "", null,
    "Optional short label shown next to the bucket ID on the Repo map (e.g. 'analytical baseline', 'AWO Phase-1'). Leave blank if obvious."],
  ["purpose",     "Purpose (one line)", "textarea", false, "", null,
    "One-line elevator pitch shown on the hero card. Keep it short — full context belongs in the mini-wiki."],
  ["_dp",         "Deep pack (mini-wiki)?", "checkbox", false, "", null,
    "Tick if this bucket has a deep-pack mini-wiki page. Enables the Mini-wiki field below."],
  ["_mini_wiki",  "Mini-wiki HTML file or URL", "text", false, "", null,
    "Sibling HTML file (e.g. 00_PRJ-2026-01_Foo.html) OR full URL. Becomes a 'Deep pack ↓' CTA on the hero card."],
];
const MAN_FORM_FIELDS = [
  ["id",    "Manual ID (auto)",      "text",     true,  "", null,
    "Auto-generated as MAN-<YEAR>-<NN>. Read-only — change Year to regenerate."],
  ["year",  "Year",                  "number",   true,  String(new Date().getFullYear()), null,
    "Year tag for this manual. Used only inside the ID — doesn't affect rendering."],
  ["title", "Title",                 "text",     true,  "", null,
    "Short title shown on the manual card. Example: 'Onboarding Guide'."],
  ["desc",  "Description (one line)","textarea", true,  "", null,
    "One-line description shown under the title. Example: 'First-30 / first-90 reading order'."],
  ["file",  "File (bare → wiki root)", "text",     false, "", null,
    "Local document. Bare filename (e.g. 01_Guide.html) resolves to the wiki root (sibling of index.html). A path containing / is used as-is — use docs/X.docx to point inside the docs/ subfolder."],
  ["url",   "URL (optional)",        "text",     false, "", null,
    "Optional full URL (https://…). If set, this wins over the file field. Use for SharePoint / OneDrive / web links."],
];

function computeNextManualId(year){
  if (!/^\d{4}$/.test(String(year))) return "";
  const stem = `MAN-${year}-`;
  let max = 0;
  (STATE.data.manuals||[]).forEach(m => {
    const id = String(m.id||"");
    if (!id.startsWith(stem)) return;
    const mm = id.slice(stem.length).match(/^(\d+)$/);
    if (mm) max = Math.max(max, parseInt(mm[1],10));
  });
  return `${stem}${String(max+1).padStart(2,"0")}`;
}

function computeNextBucketId(category, year){
  const prefix = CAT_PREFIX[category];
  if (!prefix || !/^\d{4}$/.test(String(year))) return "";
  const stem = `${prefix}-${year}-`;
  let max = 0;
  (STATE.data.buckets||[]).forEach(b => {
    const id = String(b.bucket_id||"");
    if (!id.startsWith(stem)) return;
    const m = id.slice(stem.length).match(/^(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1],10));
  });
  return `${stem}${String(max+1).padStart(2,"0")}`;
}

function openModal(){
  const kind = tabKind();
  const isManual = (kind === "manual");
  const isBucket = (kind === "bucket");
  const fields = isManual ? MAN_FORM_FIELDS : BUCKET_FORM_FIELDS;
  $("#m-title").textContent = isManual ? "Add new manual" : "Add new bucket";
  const form = $("#form");
  form.innerHTML = fields.map(([k,lab,typ,req,def,opts,tip]) => {
    const cls = (typ === "textarea" || k === "name" || k === "title" || k === "_mini_wiki") ? "full" : "";
    let ctl;
    if (typ === "select"){
      ctl = `<select name="${k}" ${req?"required":""}>${opts.map(o => `<option ${o===def?'selected':''}>${o}</option>`).join("")}</select>`;
    } else if (typ === "textarea"){
      ctl = `<textarea name="${k}" rows="2">${esc(def||"")}</textarea>`;
    } else if (typ === "checkbox"){
      ctl = `<input name="${k}" type="checkbox" style="width:auto;margin-top:4px;align-self:flex-start">`;
    } else {
      ctl = `<input name="${k}" type="${typ}" value="${esc(def||"")}" ${req?"required":""}>`;
    }
    let reqSpan = req ? '<span class="req">*</span>' : '';
    if (k === "_mini_wiki") reqSpan = '<span class="req req-dyn" style="display:none">*</span>';
    const info = tip ? `<span class="info" title="${esc(tip)}" aria-label="${esc(tip)}">i</span>` : '';
    return `<label class="${cls}"><span class="lbl">${esc(lab)}${reqSpan}${info}</span>${ctl}</label>`;
  }).join("");
  // pre-set fields based on tab
  if (isManual){
    const idInp = form.querySelector('[name="id"]');
    const yrInp = form.querySelector('[name="year"]');
    const recomputeId = () => { idInp.value = computeNextManualId(yrInp.value); };
    recomputeId();
    yrInp.addEventListener("input", recomputeId);
    idInp.readOnly = true;
    idInp.style.background = "var(--g100)";
    idInp.style.color = "var(--g500)";
    idInp.title = "Auto-generated from Year. Change Year to update.";
  } else {  // bucket (any of the 6 categories including Adhoc)
    const catSel = form.querySelector('[name="category"]');
    const yrInp  = form.querySelector('[name="year"]');
    const idInp  = form.querySelector('[name="bucket_id"]');
    const dpChk  = form.querySelector('[name="_dp"]');
    const mwInp  = form.querySelector('[name="_mini_wiki"]');
    if (catSel) catSel.value = STATE.tab;
    // auto-populate Bucket ID from category + year + next counter; keep read-only
    const recomputeId = () => { idInp.value = computeNextBucketId(catSel.value, yrInp.value); };
    recomputeId();
    catSel.addEventListener("change", recomputeId);
    yrInp.addEventListener("input",  recomputeId);
    idInp.readOnly = true;
    idInp.style.background = "var(--g100)";
    idInp.style.color = "var(--g500)";
    idInp.title = "Auto-generated from Category + Year. Change those to update.";
    // dp checkbox ⇄ mini_wiki field (disabled+greyed by default; required when ticked)
    const syncDp = () => {
      const on = !!dpChk.checked;
      mwInp.disabled = !on;
      mwInp.required = on;
      mwInp.style.opacity    = on ? "1" : "0.55";
      mwInp.style.background = on ? "var(--paper)" : "var(--g100)";
      if (!on) mwInp.value = "";
      const reqEl = mwInp.closest("label").querySelector(".req-dyn");
      if (reqEl) reqEl.style.display = on ? "inline" : "none";
      mwInp.placeholder = on ? "00_BUCKET-ID.html  or  https://…" : "";
    };
    syncDp();
    dpChk.addEventListener("change", syncDp);
  }
  $("#m-err").textContent = "";
  $("#modal").classList.add("open");
  form.querySelector("input,select,textarea").focus();
}

function closeModal(){ $("#modal").classList.remove("open"); }

function submitModal(){
  const kind = tabKind();
  const isManual = (kind === "manual");
  const form = $("#form");
  const data = {};
  Array.from(form.elements).forEach(el => {
    if (!el.name) return;
    if (el.type === "checkbox")    data[el.name] = el.checked;
    else if (el.type === "number") data[el.name] = parseInt(el.value,10);
    else                            data[el.name] = (el.value || "").trim();
  });
  // validation
  const errs = [];
  if (isManual){
    if (!/^MAN-\d{4}-\d{2,3}$/.test(data.id)) errs.push("ID must look like MAN-YYYY-NN");
    if ((STATE.data.manuals||[]).some(m => m.id === data.id)) errs.push("Manual ID already exists");
    if (!data.title) errs.push("Title is required");
    if (!data.desc)  errs.push("Description is required");
    if (!data.file && !data.url) errs.push("Provide either a file or a URL");
    if (data.url && !/^https?:\/\//i.test(data.url)) errs.push("URL must start with http:// or https://");
  } else {
    const prefix = String(data.bucket_id||"").split("-")[0];
    if (PREFIX_CAT[prefix] !== data.category) errs.push(`ID prefix ${prefix} ≠ category ${data.category}`);
    if (!/^[A-Z]{3}-\d{4}-\d{2,3}$/.test(data.bucket_id)) errs.push("ID must look like PRJ-YYYY-NN");
    if ((STATE.data.buckets||[]).some(b => b.bucket_id === data.bucket_id)) errs.push("Bucket ID already exists");
    if (!data.name) errs.push("Name is required");
    if (data._dp && !data._mini_wiki) errs.push("Mini-wiki HTML/URL is required when Deep pack is ticked");
  }
  if (errs.length){ $("#m-err").textContent = errs.join(" · "); return; }

  if (isManual){
    (STATE.data.manuals = STATE.data.manuals || []).push({
      id: data.id, title: data.title, desc: data.desc,
      file: data.file || "", url: data.url || "",
      status: "Active",   // New manuals are always Active (modal exposes no status field).
    });
    markDirty(); closeModal(); render();
    toast(`Manual ${data.id} added — remember to Save.`, "success");
    return;
  }

  {
    const sp = data._sp_override; delete data._sp_override;
    const dp = data._dp;          delete data._dp;
    const mw = data._mini_wiki;   delete data._mini_wiki;
    (STATE.data.buckets = STATE.data.buckets || []).unshift({
      bucket_id: data.bucket_id, name: data.name, category: data.category,
      status: data.status, tier: data.tier, year: parseInt(data.year,10) || data.year,
      source_plan: data.source_plan || "", repo_link: data.repo_link || "",
      repo_role: data.repo_role || "",
      lineage: "", purpose: data.purpose || "",
    });
    if (sp){
      (STATE.data.sp_overrides = STATE.data.sp_overrides || {})[data.bucket_id] = sp;
    }
    if (dp && mw){
      (STATE.data.mini_wikis = STATE.data.mini_wikis || {})[data.bucket_id] = { file: mw, label: "" };
    }
  }
  markDirty();
  closeModal();
  render();
  toast("Row added — remember to Save.", "success");
}

/* ─── glue: tabs, search, buttons ─────────────────────────── */
$("#tabs").addEventListener("click", e => {
  const a = e.target.closest("a[data-tab]");
  if (!a) return;
  e.preventDefault();
  $$("#tabs a").forEach(x => x.classList.toggle("active", x === a));
  STATE.tab = a.dataset.tab;
  STATE.q = "";
  $("#search").value = "";
  render();
});
$("#search").addEventListener("input", e => { STATE.q = e.target.value; render(); });
$("#show-retired").addEventListener("change", e => { STATE.showRetired = e.target.checked; render(); });
$("#btn-add").addEventListener("click", openModal);
$("#btn-reload").addEventListener("click", () => {
  if (STATE.dirty && !confirm("Discard unsaved changes and reload from disk?")) return;
  loadData();
});
$("#btn-save").addEventListener("click", saveData);
$("#m-cancel").addEventListener("click", closeModal);
$("#m-submit").addEventListener("click", submitModal);
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
  if ((e.ctrlKey || e.metaKey) && e.key === "s"){ e.preventDefault(); if (!$("#btn-save").disabled) saveData(); }
});
window.addEventListener("beforeunload", e => {
  if (STATE.dirty){ e.preventDefault(); e.returnValue = ""; }
});

/* ─── Import xlsx · per-row diff modal ───────────────────── */
const IMP = { diff: null };

$("#btn-import")?.addEventListener("click", () => $("#file-import").click());
$("#file-import")?.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    toast("Need an .xlsx file.", "error"); return;
  }
  setStatus("loading", "parsing " + file.name + "…");
  try {
    const r = await fetch("/upload-inventory", { method: "POST", body: file });
    const payload = await r.json();
    if (!r.ok) throw new Error(payload.error || ("HTTP " + r.status));
    IMP.diff = payload;
    openImportModal(file.name);
    setStatus(STATE.dirty ? "dirty" : "saved", STATE.dirty ? "unsaved changes" : "loaded");
  } catch (err) {
    setStatus("error", "import failed — " + err.message);
    toast("Import failed: " + err.message, "error");
  }
});

const BUCKET_FIELDS_FOR_DIFF = ["name","category","status","tier","year",
  "source_plan","repo_link","repo_role","lineage","purpose"];
const MANUAL_FIELDS_FOR_DIFF = ["title","desc","file","url","kind"];

function openImportModal(filename){
  const d = IMP.diff || {};
  const bk = d.buckets || { additions:[], conflicts:[], unchanged:[], errors:[] };
  const mn = d.manuals || { additions:[], conflicts:[], unchanged:[], errors:[] };
  $("#imp-title").textContent = "Import preview — " + filename;
  $("#imp-summary").innerHTML = [summaryChip("Buckets", bk), summaryChip("Manuals", mn)].join("");
  $("#imp-body").innerHTML =
    renderImpSection("buckets", "Buckets", bk, BUCKET_FIELDS_FOR_DIFF) +
    renderImpSection("manuals", "Manuals", mn, MANUAL_FIELDS_FOR_DIFF);
  $("#imp-err").textContent = "";
  refreshImpCounter();
  $("#imp-modal").classList.add("open");
}

function summaryChip(label, b){
  const adds = (b.additions||[]).length;
  const cnf  = (b.conflicts||[]).length;
  const unc  = (b.unchanged||[]).length;
  const err  = (b.errors||[]).length;
  return `<span><b>${label}:</b> `
       + `<span style="background:#E6F2D6;color:#4A6A2A;padding:1px 6px;border-radius:999px">+${adds} new</span> `
       + `<span style="background:#FCE6D6;color:#B5471A;padding:1px 6px;border-radius:999px">${cnf} changed</span> `
       + `<span style="color:var(--g500)">${unc} unchanged</span>`
       + (err ? ` <span style="background:#FDD;color:var(--danger);padding:1px 6px;border-radius:999px">${err} errors</span>` : "")
       + `</span>`;
}

function renderImpSection(kind, label, d, fields){
  const adds = d.additions || [];
  const cnf  = d.conflicts || [];
  const errs = d.errors || [];
  if (!adds.length && !cnf.length && !errs.length) {
    return `<details><summary>${label} <span class="badge">nothing to do</span></summary>
      <p style="padding:8px;color:var(--g500)">All rows in the file already match what's in inventory.json.</p></details>`;
  }
  let html = `<details open><summary>${label}
    <span class="badge add">+${adds.length} new</span>
    <span class="badge cnf">${cnf.length} changed</span>
    ${errs.length ? `<span class="badge err">${errs.length} errors</span>` : ""}
  </summary>`;

  if (errs.length) {
    html += `<div style="padding:6px 4px 10px"><b style="color:var(--danger)">Validation errors (these rows will NOT be imported):</b>`;
    for (const e of errs) {
      html += `<div class="err-row">Row ${e.row} · ${esc(e.id||'(no id)')} — ${e.problems.map(esc).join("; ")}</div>`;
    }
    html += `</div>`;
  }

  if (adds.length) {
    html += `<table data-kind="${kind}" data-section="add">
      <thead><tr><th style="width:140px">ID (new)</th><th>Preview</th>
        <th style="width:170px">Action</th></tr></thead><tbody>`;
    for (const rec of adds) {
      const rid = String(rec.bucket_id || rec.id || "");
      const preview = fields.filter(k => rec[k] !== "" && rec[k] != null)
        .slice(0, 4).map(k => `<span class="k">${k}:</span> ${esc(String(rec[k]))}`).join(" · ");
      html += `<tr data-rid="${esc(rid)}">
        <td class="col-id">${esc(rid)}</td>
        <td class="col-diff">${preview}</td>
        <td class="res">
          <label><input type="radio" name="add-${kind}-${esc(rid)}" value="take" checked> add</label>
          <label><input type="radio" name="add-${kind}-${esc(rid)}" value="skip"> skip</label>
        </td></tr>`;
    }
    html += `</tbody></table>`;
  }

  if (cnf.length) {
    html += `<table data-kind="${kind}" data-section="cnf" style="margin-top:10px">
      <thead><tr><th style="width:140px">ID (existing)</th><th>Field-level diff</th>
        <th style="width:230px">Resolution</th></tr></thead><tbody>`;
    for (const c of cnf) {
      const rows = c.changed_fields.map(k => {
        const mine   = c.mine   && c.mine[k]   != null ? String(c.mine[k])   : "";
        const theirs = c.theirs && c.theirs[k] != null ? String(c.theirs[k]) : "";
        return `<div class="field-row">
          <span class="k">${esc(k)}</span>
          <span class="old" title="current">${esc(mine)   || "—"}</span>
          <span class="new" title="incoming">${esc(theirs) || "—"}</span>
        </div>`;
      }).join("");
      html += `<tr data-rid="${esc(c.id)}">
        <td class="col-id">${esc(c.id)}</td>
        <td>${rows}</td>
        <td class="res">
          <label><input type="radio" name="cnf-${kind}-${esc(c.id)}" value="take" checked> take theirs</label>
          <label><input type="radio" name="cnf-${kind}-${esc(c.id)}" value="keep"> keep mine</label>
          <label><input type="radio" name="cnf-${kind}-${esc(c.id)}" value="skip"> skip</label>
        </td></tr>`;
    }
    html += `</tbody></table>`;
  }
  html += `</details>`;
  return html;
}

function refreshImpCounter(){
  const radios = $$("#imp-body input[type=radio]:checked");
  let take = 0, keep = 0, skip = 0;
  radios.forEach(r => {
    if (r.value === "take") take++;
    else if (r.value === "keep") keep++;
    else if (r.value === "skip") skip++;
  });
  $("#imp-counter").textContent = `${take} take · ${keep} keep · ${skip} skip`;
}

$("#imp-body")?.addEventListener("change", refreshImpCounter);

$$("#imp-bulk button").forEach(b => b.addEventListener("click", () => {
  const action = b.dataset.bulk;
  const radios = $$("#imp-body input[type=radio]");
  radios.forEach(r => {
    const isConflict = r.name.startsWith("cnf-");
    if (action === "take") {
      if (r.value === "take") r.checked = true;
    } else if (action === "keep" && isConflict) {
      if (r.value === "keep") r.checked = true;
    } else if (action === "skip" && isConflict) {
      if (r.value === "skip") r.checked = true;
    }
  });
  refreshImpCounter();
}));

$("#imp-cancel")?.addEventListener("click", () => {
  $("#imp-modal").classList.remove("open");
  IMP.diff = null;
});

function cssEsc(s){ return String(s).replace(/[^a-zA-Z0-9_-]/g, ch => "\\" + ch); }

$("#imp-apply")?.addEventListener("click", () => {
  if (!IMP.diff || !STATE.data) return;
  const data = STATE.data;
  data.buckets = data.buckets || [];
  data.manuals = data.manuals || [];
  const result = { addedB:0, updatedB:0, addedM:0, updatedM:0, skipped:0 };

  function applyTo(arr, key, diff, kindSlug) {
    if (!diff) return;
    const byId = new Map(arr.map(r => [String(r[key]||""), r]));
    for (const rec of (diff.additions || [])) {
      const rid = String(rec[key] || "");
      const sel = document.querySelector(`input[name="add-${kindSlug}-${cssEsc(rid)}"]:checked`);
      if (!sel || sel.value !== "take") { result.skipped++; continue; }
      arr.push(rec);
      if (kindSlug === "buckets") result.addedB++; else result.addedM++;
    }
    for (const c of (diff.conflicts || [])) {
      const rid = String(c.id || "");
      const sel = document.querySelector(`input[name="cnf-${kindSlug}-${cssEsc(rid)}"]:checked`);
      if (!sel || sel.value === "keep" || sel.value === "skip") {
        if (sel && sel.value === "skip") result.skipped++;
        continue;
      }
      const target = byId.get(rid);
      if (!target) continue;
      Object.assign(target, c.theirs);
      if (kindSlug === "buckets") result.updatedB++; else result.updatedM++;
    }
  }

  applyTo(data.buckets, "bucket_id", IMP.diff.buckets, "buckets");
  applyTo(data.manuals, "id",        IMP.diff.manuals, "manuals");

  $("#imp-modal").classList.remove("open");
  IMP.diff = null;
  const summary = `+${result.addedB}/~${result.updatedB} buckets · +${result.addedM}/~${result.updatedM} manuals`
    + (result.skipped ? ` · ${result.skipped} skipped` : "");
  if (result.addedB || result.updatedB || result.addedM || result.updatedM) {
    markDirty();
    render();
    toast("Imported: " + summary + ". Click Save to persist.", "success");
  } else {
    toast("Nothing applied. " + summary, "");
  }
});

/* ─── narrative editor ─────────────────────────────────────── */
let NAR_ID = null;
function _narLines(arr){
  return Array.isArray(arr) ? arr.filter(s => typeof s === "string").join("\n") : "";
}
function _narSplit(txt){
  return String(txt||"").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
function openNarrative(bucketId){
  if (!bucketId){ toast("Save the new bucket first (needs a Bucket ID)", "warn"); return; }
  NAR_ID = bucketId;
  const obj = (STATE.data.narratives || {})[bucketId] || {};
  document.getElementById("nar-title").textContent = "Edit narrative — " + bucketId;
  document.getElementById("nar-decisions").value  = _narLines(obj.decisions);
  document.getElementById("nar-questions").value  = _narLines(obj.open_questions);
  document.getElementById("nar-err").textContent  = "";
  document.getElementById("nar-modal").classList.add("open");
}
document.getElementById("nar-cancel").addEventListener("click", () => {
  document.getElementById("nar-modal").classList.remove("open");
  NAR_ID = null;
});
document.getElementById("nar-save").addEventListener("click", () => {
  if (!NAR_ID) return;
  const dec = _narSplit(document.getElementById("nar-decisions").value);
  const qs  = _narSplit(document.getElementById("nar-questions").value);
  STATE.data.narratives = STATE.data.narratives || {};
  if (!dec.length && !qs.length){
    delete STATE.data.narratives[NAR_ID];
  } else {
    STATE.data.narratives[NAR_ID] = { decisions: dec, open_questions: qs };
  }
  document.getElementById("nar-modal").classList.remove("open");
  markDirty();
  toast(`Narrative for ${NAR_ID} updated. Click Save to commit.`, "success");
  NAR_ID = null;
});

/* ─── boot ────────────────────────────────────────────────── */
if (location.protocol === "file:"){
  document.body.innerHTML = '<div style="max-width:560px;margin:80px auto;padding:32px;border:1.5px solid var(--g300);border-radius:14px;background:var(--paper);font-family:var(--sans);line-height:1.55">'
    + '<h2 style="font-family:var(--serif);margin-top:0">Run the local server first</h2>'
    + '<p>The admin tool needs to read and write <code>inventory.json</code> via HTTP. Open a terminal in the repo root and run:</p>'
    + '<pre style="background:var(--g100);padding:12px 14px;border-radius:8px;font-family:var(--mono);font-size:13px">python handovers/serve_admin.py</pre>'
    + '<p>Then visit <a href="http://localhost:8765/admin.html" style="color:var(--clay)">http://localhost:8765/admin.html</a>.</p>'
    + '</div>';
} else {
  loadData();
}
