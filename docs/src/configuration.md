# Configuration

<div class="docs-environment-variables">

{{#include ../../README.md:environment-variables}}

</div>

{{#include ../../README.md:authentication}}

For deployment-specific behavior, see [instances](instances.md), [themes](themes.md), and [Caddyfile behavior](caddyfile.md).

## Browser content security policy

The bundled frontend nginx serves the UI with an enforced Content Security
Policy (CSP). It permits scripts and API connections from the UI's own origin,
blocks inline scripts and JavaScript evaluation, and rejects embedded frames,
plugins and changes to the document's base URL. Other origins cannot frame the
UI; same-origin embedding remains allowed.

React and CodeMirror require inline styles, so those remain allowed. The existing
Google Fonts stylesheet and font hosts are also allowed, along with bundled fonts
and the data images used for authenticator QR codes. Downloads remain supported.

The policy works over HTTP and HTTPS and does not upgrade HTTP requests or
require TLS. It cannot protect an HTTP connection against network interception;
use HTTPS across untrusted networks. A reverse proxy adding its own CSP imposes
an additional policy: both policies must permit a resource for it to load.

This policy covers the production frontend's HTML responses. Vite development
servers and backend-served custom maintenance HTML do not inherit it. Keep custom
maintenance pages trusted. CSP is an extra defense, not a substitute for rendering
untrusted content as text.

The production policy is exercised in Chromium against the real nginx config and
built frontend, both directly over HTTP and behind a local TLS proxy. With the
application/dev dependencies, Docker, `nginx:alpine`, OpenSSL and Playwright
Chromium available, run `node --test dev/e2e/content-security-policy.mjs` from the
repository root. This also runs in the regular browser suite. API responses and
font downloads are controlled by the test; it verifies CSP compatibility, not
backend authentication correctness.
