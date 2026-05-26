# ADR 0011 — Passcode gate for LAN-accessible admin & editor

- **Status:** Accepted
- **Supersedes:** none
- **Related:** ADR 0005 (JSON as SoT for semantic model), ADR 0008 (no Cytoscape in mini-wiki)

## Context

`serve_admin.py` originally bound to `127.0.0.1:8765`, on the assumption that
only the author's own browser would touch it. Two authoring surfaces —
`admin.html` (inventory editor) and `semantic_editor.html` (data-model
authoring) — write back to `inventory.json` and `semantic/semantic.json`
via `PUT`, and can also trigger an in-process rebuild of
`08_Semantic_Model.html`.

When the wiki gets demoed and reviewed from other machines on an office LAN,
naïvely binding to `0.0.0.0` would expose those write endpoints to anyone on
the network, which is unacceptable even on a trusted LAN.

## Decision

1. **Bind to `0.0.0.0` by default**, with `--bind 127.0.0.1` available to opt
   back into the old behaviour. On startup the server enumerates non-loopback
   IPv4 addresses and prints the full URL for every page so the user can copy
   the right link.
2. **Protect write endpoints with a 6-digit passcode** rather than per-user
   accounts. Shared-secret semantics are sufficient for a handful of teammates
   on a trusted LAN; rolling out per-user identity (OAuth, AD lookup, …) is
   disproportionate to the threat model.
3. **Hash the passcode server-side** as `SHA-256(salt|pin)` and store it in
   `.passcode` (gitignored). This is *not* a real password hash
   (no bcrypt/argon2) because a 6-digit PIN has only 1M states — brute force
   resistance comes from the LAN boundary and the fact that the file is
   gitignored, not from the hash strength.
4. **Issue a bearer token on successful login** (random 24-byte hex, stored in
   `.session`, also gitignored). A client-side wrapper around `window.fetch`
   attaches the token to every same-origin request. Rotating the passcode
   rotates the token, so a leaked PIN can be revoked from any browser.
5. **Gate at the API layer, not the page layer.** `index.html`,
   `semantic/08_Semantic_Model.html`, walkthroughs and all read-only artefacts
   remain public — they are the value proposition of the LAN exposure. Only
   `PUT` on `inventory.json` / `semantic/semantic.json` and the three
   xlsx-mutation POSTs (`upload-inventory`, `upload-semantic`,
   `export-semantic-xlsx`) require a valid bearer. The pages themselves are
   protected by a client-side `auth.js` shim that hides their body until
   `whoami` succeeds.
6. **Default passcode is `111111`** and is bootstrapped automatically on the
   first run of `serve_admin.py`. **Change it immediately** via the admin
   page's "🔑 Passcode" button, which opens a current/new/confirm modal; the
   new passcode applies immediately to every browser.

## Consequences

- **Pros**
  - Zero infrastructure (no Auth0, no AD integration, no certificate management).
  - Read-only consumption is unchanged for everyone — there is no friction for
    the 95% of visits that don't write.
  - The shared secret is rotatable from the UI; a compromised PIN is recoverable
    in seconds.
  - Multiple instances (e.g. a staging copy and a prod copy) can run side-by-side,
    each with its own `.passcode` / `.session`, without leaking credentials
    across them.
- **Cons / known limits**
  - No per-user audit trail. We cannot tell *who* changed inventory.json, only
    *that* someone with the PIN did.
  - Traffic is plain HTTP. On a trusted LAN this is acceptable; if the threat
    model ever expands to untrusted networks, this ADR must be revisited and an
    HTTPS reverse proxy added in front (Caddy + self-signed cert is the
    obvious next step).
  - 6-digit PIN is brute-forceable in 1M tries. We rely on the absence of an
    open internet exposure to make this a non-issue. There is currently no
    rate-limit on `POST /api/auth/login`.

## Alternatives considered

- **Per-user accounts (OAuth via a corporate IdP)** — overkill for a 3-5
  person team, and depends on every consumer being onboarded.
- **HTTP Basic Auth** — same shared-secret semantics, but the browser caches
  the credential forever and there is no UI for rotating it. The fetch wrapper
  also gives us a clean 401 recovery path that Basic does not.
- **Bind to a specific LAN IP** without a passcode — fails the moment DHCP
  reassigns the IP, and still doesn't stop other machines on the same subnet.

## Implementation notes

- Client wrapper lives in `assets/auth.js`; both `admin.html` and
  `semantic_editor.html` load it *before* their own JS so the fetch monkey-patch
  is in place by the time the page makes its first request.
- `.passcode` JSON format: `{"salt":"<hex>","hash":"<sha256>"}`.
- `.session` is a single-line bearer token. One token at a time —
  logging in elsewhere invalidates the previous browser. Acceptable for the
  team size; revisit if multi-device becomes a complaint.
