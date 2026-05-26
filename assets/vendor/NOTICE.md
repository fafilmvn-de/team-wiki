# Vendored third-party assets

## cytoscape.min.js

- **Version:** 3.30.4
- **Source:** https://unpkg.com/cytoscape@3.30.4/dist/cytoscape.min.js
- **License:** MIT (https://github.com/cytoscape/cytoscape.js/blob/master/LICENSE)
- **Used by:** `semantic_editor.html` for the dual-canvas (domain map + table model) editor.
- **Why vendored:** Zero-dependency offline operation; the editor must work when the corporate firewall blocks CDNs.
- **Refresh procedure:** Re-download from the URL above, update the version line, and run a manual smoke-test (`python ./serve_admin.py` then open `/semantic_editor.html`).
