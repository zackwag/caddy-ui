# Features

Manage Caddy configuration, monitor your servers, and inspect logs from one
interface. Your Caddyfile remains the source of truth.

<div class="docs-features">
<div class="docs-feature-grid">
<section class="docs-feature-group">

## Configure traffic

- **Caddyfile editor**
  Edit with syntax highlighting, validate and format configurations, and restore
  saved versions.
- **Route manager**
  Find routes across HTTP servers, edit upstreams, and keep notes alongside them.
  Routes without an explicit title display the first hostname's leftmost DNS
  label in italics (for example, `jellyfin.example.de` becomes *jellyfin*).
  Clearing a custom title restores this default. Uptime labels use the same
  fallback; status history headings keep the full domain unless an explicit
  title exists. The fallback is display-only and does not change notes or the
  Caddyfile; wildcard, IP, placeholder and hostless routes stay untitled.
- **Configuration workflow**
  Import or export a Caddyfile and reload Caddy from the UI.

See the [editor](screenshots.md#caddyfile-editor),
[route manager](screenshots.md#route-manager), and
[Caddyfile guide](caddyfile.md).

</section>
<section class="docs-feature-group">

## Monitor health

- **Dashboard**
  Check server status, upstream health, TLS state, and Caddy process information.
- **Metrics and uptime**
  Follow traffic, latency, and upstream history; enable optional route checks.
- **Logs**
  Tail live output, filter by severity or keyword, export logs, and configure
  access logging.
- **Notifications**
  Receive alerts for health changes and expiring certificates through your
  chosen notification service, including self-hosted services on your network.

See [metrics](screenshots.md#metrics), [logs](screenshots.md#access-logs), and
[integrations](integrations.md).

</section>
<section class="docs-feature-group">

## Manage certificates and instances

- **TLS certificates**
  Inspect expiry dates, remove orphaned certificates, and download Caddy's root CA.
- **Multiple instances**
  Discover Docker containers or add local Caddy installations, then switch
  between them from the sidebar.

See [certificates](screenshots.md#tls-certificates) and the
[instance guide](instances.md).

</section>
<section class="docs-feature-group">

## Adjust access and appearance

- **Authentication**
  Protect the UI and API with persistent administrator credentials, cookie sessions and CSRF checks.
- **Themes**
  Choose built-in dark and light palettes or provide a custom theme.
- **Navigation**
  Bookmark pages and filtered views, with a responsive layout for smaller screens.

See [authentication](configuration.md#authentication) and
[custom themes](themes.md).

</section>
</div>

## Detailed capabilities

Expand either list for the complete feature reference, including configuration
options and implementation details.

<details id="frontend" class="docs-feature-reference">
<summary>Full frontend feature list</summary>

{{#include ../../README.md:frontend-features}}

</details>
<details id="backend" class="docs-feature-reference">
<summary>Backend capabilities</summary>

{{#include ../../README.md:backend-features}}

</details>
</div>
