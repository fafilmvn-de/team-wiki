/* auth.js — passcode gate for admin.html / semantic_editor.html.
 *
 * Loaded BEFORE the page's own scripts so it can:
 *   1. Hide the page body until a valid session token is verified.
 *   2. Monkey-patch window.fetch so every same-origin request gets an
 *      `Authorization: Bearer <token>` header automatically (the existing
 *      admin.js / semantic_editor.js code does not need to be changed).
 *   3. Expose `window.HandoverAuth.openChangePasscodeModal()` so admin.html
 *      can wire up its "Change passcode" button.
 *
 * The token lives in localStorage under `handovers-token`. It is rotated
 * server-side whenever the passcode changes.
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'handovers-token';
  var origFetch = window.fetch.bind(window);

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } }
  function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (_) {} }
  function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (_) {} }

  /* fetch wrapper — adds bearer header on same-origin requests. Bails out
     if the request is itself an auth call (we set the header manually
     where needed) or if there's no token yet. */
  window.fetch = function (input, init) {
    init = init || {};
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var sameOrigin = !/^https?:/i.test(url) || url.indexOf(location.origin) === 0;
    var tok = getToken();
    if (sameOrigin && tok) {
      var hdrs = new Headers(init.headers || (typeof input !== 'string' ? input.headers : null) || {});
      if (!hdrs.has('Authorization')) hdrs.set('Authorization', 'Bearer ' + tok);
      init.headers = hdrs;
    }
    return origFetch(input, init).then(function (res) {
      // If the server rotated the passcode under us, force re-login.
      if (res.status === 401 && url.indexOf('/api/auth/') < 0) {
        clearToken();
        showGate('Session expired — please re-enter the passcode.');
      }
      return res;
    });
  };

  /* ── DOM helpers ──────────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('auth-gate-styles')) return;
    var css = `
      body.auth-locked > *:not(#auth-gate) { visibility: hidden !important; }
      #auth-gate { position: fixed; inset: 0; z-index: 100000;
        background: rgba(20,20,19,.72); display: flex; align-items: center;
        justify-content: center; font-family: system-ui, -apple-system,
        "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
      #auth-gate .panel { background: #FFFFFF; border-radius: 14px;
        box-shadow: 0 20px 50px rgba(20,20,19,.35); padding: 28px 30px;
        width: 360px; max-width: 92vw; }
      #auth-gate h2 { margin: 0 0 6px; font-size: 18px; color: #141413; }
      #auth-gate p { margin: 0 0 18px; font-size: 13px; color: #6F6E68;
        line-height: 1.5; }
      #auth-gate input { width: 100%; padding: 12px 14px; font-size: 22px;
        font-family: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
        letter-spacing: 0.4em; text-align: center;
        border: 1.5px solid #D1CFC5; border-radius: 10px; background: #FAF9F5;
        color: #141413; outline: none;
        transition: border-color .15s ease, box-shadow .15s ease; }
      #auth-gate input:focus { border-color: #D97757;
        box-shadow: 0 0 0 3px rgba(217,119,87,.18); background: #FFFFFF; }
      #auth-gate .row { display: flex; gap: 10px; margin-top: 14px; }
      #auth-gate button { flex: 1; padding: 10px 14px; font-size: 14px;
        border-radius: 8px; border: 1.5px solid #D1CFC5; background: #FFFFFF;
        color: #141413; cursor: pointer; font-weight: 600;
        transition: background .15s ease, border-color .15s ease; }
      #auth-gate button.primary { background: #D97757; border-color: #B85C3E;
        color: #FFFFFF; }
      #auth-gate button.primary:hover { background: #B85C3E; }
      #auth-gate button:hover:not(.primary) { background: #F0EEE6; }
      #auth-gate .err { margin-top: 10px; font-size: 12px; color: #A8453A;
        font-family: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace; min-height: 14px; }
      #auth-gate .hint { margin-top: 12px; font-size: 11px; color: #6F6E68;
        font-family: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace; }
      #auth-change { width: 420px; }
      #auth-change input { font-size: 18px; }
      #auth-change label { display: block; font-size: 11px;
        font-family: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
        color: #6F6E68; margin: 12px 0 4px; }
    `;
    var st = document.createElement('style');
    st.id = 'auth-gate-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function showGate(msg) {
    injectStyles();
    document.body.classList.add('auth-locked');
    var existing = document.getElementById('auth-gate');
    if (existing) existing.remove();
    var html =
      '<div class="panel">' +
        '<h2>Enter passcode</h2>' +
        '<p>This page needs a 6-digit passcode to load. Default is <code>111111</code>; you can change it from the admin page.</p>' +
        '<input id="auth-input" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="off" autofocus>' +
        '<div class="err" id="auth-err">' + (msg ? escapeHtml(msg) : '') + '</div>' +
        '<div class="row">' +
          '<button class="primary" id="auth-submit" type="button">Unlock</button>' +
        '</div>' +
      '</div>';
    var gate = document.createElement('div');
    gate.id = 'auth-gate';
    gate.innerHTML = html;
    document.body.appendChild(gate);
    var inp = gate.querySelector('#auth-input');
    var err = gate.querySelector('#auth-err');
    var btn = gate.querySelector('#auth-submit');
    function submit() {
      var pin = (inp.value || '').trim();
      err.textContent = '';
      if (!/^\d{6}$/.test(pin)) { err.textContent = 'Passcode must be 6 digits.'; return; }
      btn.disabled = true;
      origFetch('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({passcode: pin})
      }).then(function (r) { return r.json().then(function (j) { return {status: r.status, body: j}; }); })
        .then(function (out) {
          btn.disabled = false;
          if (out.status === 200 && out.body && out.body.token) {
            setToken(out.body.token);
            hideGate();
          } else {
            err.textContent = (out.body && out.body.error) || ('login failed (' + out.status + ')');
            inp.select();
          }
        })
        .catch(function (e) { btn.disabled = false; err.textContent = String(e); });
    }
    btn.addEventListener('click', submit);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    // Strip non-digits on input
    inp.addEventListener('input', function () { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); });
  }

  function hideGate() {
    document.body.classList.remove('auth-locked');
    var g = document.getElementById('auth-gate');
    if (g) g.remove();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function verify() {
    var tok = getToken();
    if (!tok) { showGate(''); return; }
    origFetch('/api/auth/whoami', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + tok}
    }).then(function (r) {
      if (r.status === 200) { hideGate(); }
      else { clearToken(); showGate('Session expired — please re-enter the passcode.'); }
    }).catch(function () { showGate('Could not reach server.'); });
  }

  /* ── Change-passcode modal (used by admin.html "Change passcode" button) ── */
  function openChangePasscodeModal() {
    injectStyles();
    var existing = document.getElementById('auth-change');
    if (existing) existing.remove();
    var wrap = document.createElement('div');
    wrap.id = 'auth-gate';
    wrap.innerHTML =
      '<div class="panel" id="auth-change">' +
        '<h2>Change passcode</h2>' +
        '<p>Enter your current 6-digit passcode and choose a new one. The new passcode applies to every browser/device using this server.</p>' +
        '<label>Current passcode</label>' +
        '<input id="auth-cur" type="password" inputmode="numeric" maxlength="6" autocomplete="off" autofocus>' +
        '<label>New passcode</label>' +
        '<input id="auth-new" type="password" inputmode="numeric" maxlength="6" autocomplete="off">' +
        '<label>Confirm new passcode</label>' +
        '<input id="auth-new2" type="password" inputmode="numeric" maxlength="6" autocomplete="off">' +
        '<div class="err" id="auth-err"></div>' +
        '<div class="row">' +
          '<button id="auth-cancel" type="button">Cancel</button>' +
          '<button class="primary" id="auth-submit" type="button">Update</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    var cur = wrap.querySelector('#auth-cur');
    var nw  = wrap.querySelector('#auth-new');
    var nw2 = wrap.querySelector('#auth-new2');
    var err = wrap.querySelector('#auth-err');
    [cur, nw, nw2].forEach(function (i) {
      i.addEventListener('input', function () { i.value = i.value.replace(/\D/g, '').slice(0, 6); });
    });
    wrap.querySelector('#auth-cancel').addEventListener('click', function () { wrap.remove(); });
    wrap.querySelector('#auth-submit').addEventListener('click', function () {
      err.textContent = '';
      if (!/^\d{6}$/.test(cur.value)) { err.textContent = 'Current passcode must be 6 digits.'; return; }
      if (!/^\d{6}$/.test(nw.value))  { err.textContent = 'New passcode must be 6 digits.'; return; }
      if (nw.value !== nw2.value)     { err.textContent = 'New passcodes do not match.'; return; }
      if (nw.value === cur.value)     { err.textContent = 'New passcode must differ from current.'; return; }
      origFetch('/api/auth/change', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken()},
        body: JSON.stringify({current: cur.value, new: nw.value})
      }).then(function (r) { return r.json().then(function (j) { return {status: r.status, body: j}; }); })
        .then(function (out) {
          if (out.status === 200 && out.body && out.body.token) {
            setToken(out.body.token);
            wrap.remove();
            toast('Passcode updated.');
          } else {
            err.textContent = (out.body && out.body.error) || ('failed (' + out.status + ')');
          }
        })
        .catch(function (e) { err.textContent = String(e); });
    });
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2200); return; }
    alert(msg);
  }

  window.HandoverAuth = {
    openChangePasscodeModal: openChangePasscodeModal,
    clear: clearToken,
  };

  // Lock immediately so page contents never flash before verification.
  injectStyles();
  document.body && document.body.classList.add('auth-locked');
  // If <body> isn't parsed yet, defer the lock until DOMContentLoaded.
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.classList.add('auth-locked');
      verify();
    });
  } else {
    verify();
  }
})();
