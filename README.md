<!--
README.md is the canonical source for Docker Hub descriptions and shared book references.

Docker Hub routing — only blocks marked dockerhub:both, dockerhub:backend or
dockerhub:frontend are selected. Use matching start/end markers on separate lines;
do not nest or overlap them. Include headings inside a block if they should appear in
the generated page. Blocks may repeat and are collected in README order. Keep
start/end markers outside fenced code blocks. Close a block before detailed content
that should stay on GitHub (for example, the Mermaid diagram). Image-specific
introductions and companion-image notices are marked frontend or backend near the
document title. The generator supplies the image title and generated notice; the
introductory prose comes from this README. These markers select content; they do not
generate or publish files themselves.

ANCHOR / ANCHOR_END comments let mdBook include shared sections directly.
Keep environment variables, API reference and the Compose example here. Detailed
explanations and onboarding live in docs/src/. Do not edit generated DOCKERHUB.md files.
-->

# caddy/ui

A modern, self-hosted web interface for managing your [Caddy](https://caddyserver.com) server. Built from scratch in a single conversation with Claude.

![Status](https://img.shields.io/badge/status-active-00e5a0?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Frontend](https://img.shields.io/badge/frontend-React-61dafb?style=flat-square)
![Backend](https://img.shields.io/badge/backend-Node.js-339933?style=flat-square)

<details>
<summary>Docker image roles</summary>

<!-- dockerhub:frontend:start -->
The React frontend for caddy/ui, served by Nginx.

> This is the **frontend** image. You will also need the [backend image](https://hub.docker.com/r/zackwag/caddy-ui-backend).
<!-- dockerhub:frontend:end -->

<!-- dockerhub:backend:start -->
The Node.js/Express API backend for caddy/ui.

> This is the **backend** image. You will also need the [frontend image](https://hub.docker.com/r/zackwag/caddy-ui-frontend).
<!-- dockerhub:backend:end -->
</details>

<!-- ANCHOR: overview -->
<!-- dockerhub:both:start -->
## Overview

caddy/ui manages one or more [Caddy](https://caddyserver.com) servers through their admin APIs. It runs as two Docker containers alongside Caddy. Your Caddyfile remains the source of truth: you can edit it directly or through the UI.

<!-- dockerhub:both:end -->
<!-- ANCHOR_END: overview -->

Use caddy/ui to inspect server health, edit Caddyfiles, manage routes and TLS certificates,
follow logs and metrics, and configure notifications from one place. It supports multiple
instances, administrator login, and responsive dark/light themes.

![Dashboard](https://zackwag.github.io/caddy-ui/screenshots/dashboard.png)

**[Read the documentation](https://zackwag.github.io/caddy-ui/)** ·
[Browse the Markdown sources](docs/src/SUMMARY.md) ·
[Contribute](CONTRIBUTING.md)

<details>
<summary>Features</summary>

<!-- ANCHOR: features -->
<!-- dockerhub:both:start -->
## Features
<!-- dockerhub:both:end -->

### Frontend

<!-- ANCHOR: frontend-features -->
<!-- dockerhub:frontend:start -->
- **Dashboard** — Server and TLS status, HTTP server labels/listeners/route counts, upstream health, and Caddy version, uptime, memory and reload information
- **Caddyfile Editor** — [Caddyfile grammar highlighting](https://zackwag.github.io/caddy-ui/caddyfile.html#caddyfile-syntax-highlighting), live validation, `caddy fmt`, site sorting, import/export, and version history with previews and rollback
- **Route Manager** — Routes across HTTP servers, health and uptime, search, sortable/configurable columns, domain/upstream links, inline editing and notes
- **TLS Certificates** — Certificate status and expiry, orphan cleanup, and root CA download with OS installation instructions
- **Logs** — Live SSE streaming, keyword/severity filters, export, and access-log configuration
- **Metrics** — Request counts, RPS, response times, status codes and p50/p95/p99 latency from Caddy's Prometheus endpoint
- **Uptime** — Upstream state, uptime and history sampled every 30 seconds. Optional route checks request sites through Caddy every 5 minutes (`caddy-ui-route-check`), detecting 5xx responses, timeouts and invalid TLS certificates; Caddy's local CA is trusted automatically. Failures show their cause, and individual routes can be skipped. Route checks default to off because they add access-log entries and request metrics.
- **Notifications** — ntfy, Discord, Slack, Pushover or custom webhooks for upstream/route state changes and expiring certificates or API tokens, with trigger controls and debounce. Route alerts require route checks. LAN/Docker destinations work; loopback and link-local addresses are blocked, and redirects are not followed.
- **Themes** — 13 dark and 13 light palettes, independent dark/light selections, a first-run picker, and [custom themes](https://zackwag.github.io/caddy-ui/themes.html#custom-themes) in `THEMES_PATH`. Preferences persist in `settings.json`.
- **Navigation** — Browser history, bookmarks and filtered deep links (e.g. `/routes?filter=srv0`)
- **Authentication** — Persistent administrator credentials, cookie sessions, CSRF protection and recovery keys
- **Multi-Instance** — Discover Caddy containers, add/edit/remove instances, and switch servers from the sidebar
- **Mobile Friendly** — Responsive layout with collapsible sidebar
<!-- dockerhub:frontend:end -->
<!-- ANCHOR_END: frontend-features -->

### Backend

<!-- ANCHOR: backend-features -->
<!-- dockerhub:backend:start -->
- Caddy admin API access (`/config`, `/id`, `/load`) and Caddyfile validation via `/adapt`
- Caddyfile reads/writes, site sorting (public → internal → http), and route block updates
- Formatting and version detection through `docker exec` in Docker mode (requires the socket mount)
- Route discovery across HTTP servers, including nested upstreams
- Upstream pool health checks with TCP fallback, plus persisted upstream/route history (7-day default retention)
- Notification providers and trigger controls with configurable debounce
- Certificate expiry checks, orphan/superseded/expired certificate cleanup, and root CA download
- Caddyfile snapshots on save, live SSE logs, and access-log configuration
- Persistent server labels, route notes and UI settings
- Administrator cookie sessions, CSRF protection and scoped read-only integration tokens
- Caddy process/HTTP metrics, metrics configuration, and optional public Prometheus scraping
- Structured JSON logs (`LOG_LEVEL`) and status/uptime data for Homepage widgets
<!-- dockerhub:backend:end -->
<!-- ANCHOR_END: backend-features -->
<!-- ANCHOR_END: features -->

</details>

## Get started

You need Docker Compose and a Caddy container with its admin API enabled inside your Docker network.
Follow the [quickstart guide](https://zackwag.github.io/caddy-ui/setup.html) to configure Caddy,
create the required directories, and deploy both caddy/ui containers. Then open
`http://your-server:9877` and add or discover your instance.

<details>
<summary>Quick Start and Compose example</summary>

<!-- ANCHOR: quick-start -->
<!-- dockerhub:both:start -->
## Quick Start

### Prerequisites

<!-- ANCHOR: quick-start-prerequisites -->
- Docker and Docker Compose
- An existing Caddy container with the admin API enabled on `0.0.0.0:2019`
<!-- ANCHOR_END: quick-start-prerequisites -->

### 1. Enable Caddy's admin API

<!-- ANCHOR: quick-start-admin-api -->
Add the following to your Caddyfile global block:

```caddyfile
{
    admin 0.0.0.0:2019
    email {$EMAIL}
}
```

> Note: the `CADDY_ADMIN` environment variable does not configure this — it must be set in the Caddyfile.
<!-- ANCHOR_END: quick-start-admin-api -->

### 2. Create required directories

<!-- ANCHOR: quick-start-directories -->
```bash
mkdir -p /docker/caddy/logs
mkdir -p /docker/caddy-ui
```
<!-- ANCHOR_END: quick-start-directories -->

### 3. Plan administrator setup

<!-- ANCHOR: quick-start-auth -->
No authentication environment variables are needed for a new installation. Open the UI after deployment, create the administrator and save the one-time recovery key. Until setup finishes, management endpoints remain locked. The first visitor can establish credentials, so keep an uninitialized installation reachable only by its intended administrator.

Keep `/etc/caddy-ui` mounted persistently: it contains the credential hashes alongside the existing settings and metadata.
<!-- ANCHOR_END: quick-start-auth -->

### 4. Update your compose file

<!-- ANCHOR: quick-start-compose -->
```yaml
services:
  caddy:
    image: caddy:latest
    container_name: caddy
    restart: unless-stopped
    ports:
      - 80:80
      - 443:443
    environment:
      - CADDY_LOG_PATH=/var/log/caddy/access.log
      - DOMAIN=example.com
      - EMAIL=you@example.com
      - TZ=America/New_York
    volumes:
      - /docker/caddy/Caddyfile:/etc/caddy/Caddyfile
      - /docker/caddy/data:/data
      - /docker/caddy/config:/config
      - /docker/caddy/logs:/var/log/caddy
    networks:
      - caddy-ui

  caddy-ui-backend:
    image: zackwag/caddy-ui-backend:latest
    container_name: caddy-ui-backend
    restart: unless-stopped
    ports:
      - 9876:3001
    environment:
      - TZ=America/New_York
      # Optional -- opt into installed preview UI languages (reviewed languages are enabled by default)
      - CADDY_UI_ADDITIONAL_LANGUAGES=es-es
      # Browser-facing URL: replace your-server with the host you open in your browser.
      # Required for browser writes over plain HTTP; behind HTTPS use the external HTTPS URL.
      - CADDY_UI_EXTERNAL_URL=http://your-server:9877
      # Authentication is required; create credentials in the UI.
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /docker/caddy-ui:/etc/caddy-ui
    networks:
      - caddy-ui
    depends_on:
      - caddy

  caddy-ui-frontend:
    image: zackwag/caddy-ui-frontend:latest
    container_name: caddy-ui-frontend
    restart: unless-stopped
    ports:
      - 9877:80
    networks:
      - caddy-ui
    depends_on:
      - caddy-ui-backend

networks:
  caddy-ui:
    driver: bridge
```

The backend needs only the **Docker socket** for discovery and file operations in Caddy containers, plus its persistent **config directory** for credentials, instances, history and settings. It does not need Caddy's volumes mounted directly.
<!-- ANCHOR_END: quick-start-compose -->

### 5. Deploy

<!-- ANCHOR: quick-start-deploy -->
```bash
docker compose up -d
```

Open `http://your-server:9877` in your browser.
<!-- ANCHOR_END: quick-start-deploy -->

<!-- dockerhub:both:end -->
<!-- ANCHOR_END: quick-start -->

</details>

<!-- dockerhub:both:start -->
## Architecture
<!-- ANCHOR: architecture -->
The Nginx frontend proxies API requests to the Node.js/Express backend, which talks to Caddy's admin API.

Docker mode uses the socket for container discovery and file operations. Local mode supports Caddy outside Docker. The backend's persistent config directory holds credentials, settings and instance data.

<!-- dockerhub:both:end -->
<!-- ANCHOR_END: architecture -->

See the [architecture guide](https://zackwag.github.io/caddy-ui/architecture.html)
for the service connections, and [instances](https://zackwag.github.io/caddy-ui/instances.html)
for Docker and local-mode deployments.

## Configuration and integrations

The [configuration reference](https://zackwag.github.io/caddy-ui/configuration.html),
[API reference](https://zackwag.github.io/caddy-ui/api.html), and
[integration guides](https://zackwag.github.io/caddy-ui/integrations.html) organize the
shared reference below, with additional guidance for [themes](https://zackwag.github.io/caddy-ui/themes.html)
and [Caddyfile behavior](https://zackwag.github.io/caddy-ui/caddyfile.html).

<details>
<summary>Environment variables, API and integration examples</summary>

<!-- ANCHOR: environment-variables -->
<!-- dockerhub:backend:start -->
## Environment Variables

Most backend variables have sensible defaults. Set `CADDY_UI_EXTERNAL_URL` for browser writes over plain HTTP; otherwise only set what you need to override.

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_VERSION` | `dev` | caddy-ui's own version, exposed at `GET /api/version` and shown in the sidebar. Baked in automatically by the release build (`docker build --build-arg APP_VERSION=...`) — no need to set by hand unless building from source and want the UI to report a specific version. |
| `CADDY_ADMIN_URL` | — | URL of Caddy's admin API. If set, a default instance is auto-created on first startup. If unset, caddy/ui starts with no instances and guides you through discovery. |
| `CADDYFILE_TITLES` | auto | Store route titles as `#` comments in the Caddyfile (see [Caddyfile Titles](https://zackwag.github.io/caddy-ui/caddyfile.html#caddyfile-titles)) |
| `CADDY_CONFIG_PATH` | `/etc/caddy/Caddyfile` | Path to the Caddyfile inside the Caddy container (only used with `CADDY_ADMIN_URL`) |
| `CADDY_CONTAINER_NAME` | `caddy` | Name of the Caddy Docker container (only used with `CADDY_ADMIN_URL`) |
| `CADDY_DATA_PATH` | `/data/caddy` | Path to Caddy's data directory inside the container (only used with `CADDY_ADMIN_URL`) |
| `CADDY_LOG_PATH` | `/var/log/caddy/access.log` | Path to Caddy's access log inside the container (only used with `CADDY_ADMIN_URL`) |
| `CADDY_SERVER_NAME` | `srv0` | Server ID of the Caddy HTTP server new routes are added to, usually `srv0` (only used with `CADDY_ADMIN_URL`). Server IDs come from Caddy; set your own with the `name` option of the Caddyfile's global `servers` block |
| `CADDY_UI_ADDITIONAL_LANGUAGES` | — | Comma-separated preview UI language codes to opt into (for example `es-es` for the partial Spanish (Spain) catalog). Reviewed languages (currently English, Arabic and German) are enabled by default. Only installed frontend catalogs are shown; this setting controls availability, not build contents. Missing translations fall back to English. Bundled fonts (e.g. Noto Sans Arabic) load automatically when their language is selected. |
| `CADDY_UI_EXTERNAL_URL` | — | Browser-facing UI URL, including scheme and external port (e.g. `http://caddy-ui.lan:9877`). Its origin validates browser writes when Fetch Metadata is absent, as on plain HTTP. Required for those writes; never inferred from proxy headers. |
| `CADDY_UI_TRUSTED_PROXIES` | bundled frontend | Backend: unset discovers only `caddy-ui-frontend` by DNS; blank disables trust. An explicit comma-separated IP/CIDR list overrides discovery. See [client addresses and rate limits](#client-addresses-and-rate-limits). |
| `CADDY_UI_TRUSTED_UPSTREAMS` | — | Frontend nginx: comma-separated upstream proxy IPs/CIDRs allowed to supply client addresses, such as the Caddy serving the UI. Unset trusts none. |
| `CADDY_UI_PASSWORD` | — | Legacy password, used only to authenticate credential enrollment before `auth.json` exists |
| `CADDY_UI_PUBLIC_METRICS` | `false` | Expose `/api/metrics/raw` without auth |
| `CADDY_UI_UPDATE_CHECK` | `true` | Check hourly for newer caddy-ui images and show an "Update available" badge in the sidebar (plus a notification for new releases, if notifications are on). Reads a small `versions.json` from GitHub (`raw.githubusercontent.com`); set to `false` to disable |
| `CADDY_UI_UPDATE_CHECK_URL` | `https://raw.githubusercontent.com/zackwag/caddy-ui/versions/versions.json` | Where the update check reads published image versions from |
| `CADDY_UI_USER` | — | Legacy username for credential enrollment; ignored after stored credentials are initialized |
| `AUTH_PATH` | `/etc/caddy-ui/auth.json` | Persistent administrator credential/recovery hashes. Keep on a writable persistent volume, separate from UI settings. |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Path to the Docker socket for container discovery and `docker exec` operations |
| `HISTORY_PATH` | `/etc/caddy-ui/history` | Path to the Caddyfile snapshot directory |
| `INSTANCES_PATH` | `/etc/caddy-ui/instances.json` | Path to the multi-instance configuration file (see [Multi-Instance](https://zackwag.github.io/caddy-ui/instances.html#multi-instance)) |
| `JWT_SECRET` | — | Legacy configuration marker required alongside the legacy username/password before enrollment. No new JWTs are issued. |
| `LOG_LEVEL` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `MAINTENANCE_PATH` | `/etc/caddy-ui/maintenance.json` | Path to the maintenance mode state file |
| `NOTIFICATIONS_CONFIG_PATH` | `/etc/caddy-ui/notifications.json` | Path to the notification settings file |
| `PORT` | `3001` | Port the backend listens on |
| `ROUTE_NOTES_PATH` | `/etc/caddy-ui/route-notes.json` | Path to the route notes file |
| `SERVER_NAMES_PATH` | `/etc/caddy-ui/server-names.json` | Path to the per-instance server labels file |
| `SETTINGS_PATH` | `/etc/caddy-ui/settings.json` | Path to the UI settings file (theme preferences, column visibility) |
| `THEMES_PATH` | `/etc/caddy-ui/themes` | Path to the custom themes directory (see [Custom Themes](https://zackwag.github.io/caddy-ui/themes.html#custom-themes)) |
| `UPTIME_HISTORY_PATH` | `/etc/caddy-ui/uptime-history.json` | Path to the persisted upstream and route uptime history file |
| `UPTIME_HISTORY_RETENTION_DAYS` | `7` | How many days of upstream and route health checks to retain |
| `WWW_PATH` | `/etc/caddy-ui/www` | Directory for the maintenance page HTML file (created on first use) |
| `NODE_EXTRA_CA_CERTS` | — | Path to a PEM bundle of extra CAs for route checks and notification webhooks to trust, for sites with certificates from a private CA other than Caddy's local one (standard Node.js variable) |

<!-- dockerhub:backend:end -->
<!-- ANCHOR_END: environment-variables -->


<!-- ANCHOR: auth-migration -->
## Authentication migration — breaking change

> [!WARNING]
> **Existing automation must be reviewed before upgrading.** Authentication is mandatory; unauthenticated management access is no longer supported. Legacy JWT authentication is removed: Bearer JWTs and `?token=` authentication are no longer accepted. POST, PUT, PATCH and DELETE requests require a management session and its `X-CSRF-Token` (or a pre-login context for authentication endpoints); origin checks also remain active.
>
> Integrations must replace legacy JWTs with scoped, read-only API tokens created in the UI. These allow status/metrics reads for selected Caddy instances only; write-capable automation still requires a browser-style session and CSRF context. Coordinate the upgrade with existing scripts and integrations.
>
> **Restrict access until administrator enrollment is complete.** When neither stored nor legacy credentials exist, the first person reaching setup can claim administrator access. This also applies to upgrades from previously unauthenticated installations, even when settings and labels already exist. The backend emits a startup warning in this state.
<!-- ANCHOR_END: auth-migration -->

<!-- ANCHOR: authentication -->
<!-- dockerhub:backend:start -->
## Authentication

Authentication is required. With no stored credentials or legacy environment credentials, the UI offers administrator setup while management endpoints remain locked. The first visitor can create the administrator; restrict access until setup is complete.

### Existing installations

Settings, labels, instances, snapshots and the Caddyfile remain in their current stores. They are installation-wide and are not reassigned or rewritten when the administrator username changes during setup.

If `CADDY_UI_USER`, `CADDY_UI_PASSWORD` and `JWT_SECRET` are configured, sign in with the existing username/password to authorize enrollment. This produces a limited session that can complete setup but cannot manage Caddy. All three legacy variables must be non-empty before enrollment; partial or blank configuration still fails startup, reporting variable names only. Once new credentials are saved successfully, stored credentials take precedence and the old environment variables can be removed, including `JWT_SECRET`.

An existing installation that had authentication disabled receives the same setup form as a new installation, preserving its data. Initialization never depends on theme preferences, labels or the age of the installation. Unreadable, corrupt or unsupported credential storage fails startup rather than reopening setup. Inspect failures with `docker compose logs --tail=100 caddy-ui-backend` (using your service name).

### Sessions and recovery

Passwords and recovery keys are stored as salted scrypt hashes in `AUTH_PATH`, with owner-only file permissions. Passwords require at least 12 characters and at most 1024 bytes. Credential writes are atomic, and concurrent setup requests cannot overwrite an initialized administrator.

The browser receives a host-only, HttpOnly, SameSite=Strict cookie scoped to `/api`. It does not store authentication tokens in localStorage or URLs. Management sessions expire after 24 hours; enrollment and pre-login contexts expire after 10 minutes. Sessions are process-local: restarting the backend signs everyone out. Logout revokes the session on the server, including its live log streams.

Open **Security → User** to change the administrator username or password. The current password is required; leave the new password blank to change only the username. Successful changes renew this browser's session and revoke every old session and live log stream. API tokens and the recovery key remain valid. Failed saves leave the existing credentials and sessions unchanged. **Auth** is a disabled preview for future TOTP/passkey support.

Save the recovery key shown after setup. The recovery form accepts that key and a new password, rotates the recovery key, and revokes every session. Save the replacement key, then sign in normally. Recovery does not grant an unrestricted bypass session. Key responses are marked `Cache-Control: no-store` and keys are never deliberately logged.

If both password and recovery key are lost, stop the backend and restrict network access before removing only `AUTH_PATH` to repeat credential setup. Remove obsolete legacy auth variables as well, or those credentials will be required for enrollment. Do not remove the settings directory or Caddyfile. Restore normal access only after setup is complete.

### Public endpoints

`GET /api/auth/status`, `GET /api/auth/csrf`, `GET /api/version` and `GET /api/languages` are public. With `CADDY_UI_PUBLIC_METRICS=true`, the parsed and raw metrics GET endpoints are also public. Management endpoints require a session; scoped API tokens permit selected status/metrics reads only.

### API compatibility

Legacy JWTs and `?token=` authentication are removed. Create scoped status/metrics tokens in **Security → API tokens** in the sidebar. Secrets are shown once and stored hashed in `AUTH_PATH`; recovery revokes all. See the [token guide](https://zackwag.github.io/caddy-ui/api-tokens.html) for expiry, revocation and response details.

Send `Authorization: Bearer <token>` and `X-Instance-Id: <id>`. Without the header, a token permitting one instance reads that instance; a token permitting several reads `default`, which must be allowed. Tokens permit reads only. Token management requires a session and CSRF; bearer reads need no CSRF. CORS remains disabled.

For a cookie-aware client, first fetch `/api/auth/csrf`, preserve its cookie and send the returned token as `X-CSRF-Token` on every write, including login, setup, recovery and logout. After a session change, fetch a fresh token. A rejected write is never automatically replayed by the UI.

### Browser request origins

Set `CADDY_UI_EXTERNAL_URL` to the browser-facing URL, including scheme and external port, such as `http://caddy-ui.lan:9877` or `https://caddy-ui.example.com`. Its origin validates browser writes; any path is ignored. Invalid URLs, non-HTTP(S) schemes and embedded credentials fail startup. Restart after changing it.

Ordinary HTTP browser writes require this setting because Fetch Metadata may be absent. Trustworthy localhost requests with same-origin Fetch Metadata work without it. For HTTPS, configure the external HTTPS URL so cookies are marked Secure, even when the reverse proxy reaches nginx/backend over HTTP. Origin is never inferred from `Host`, `Forwarded` or `X-Forwarded-*`. Alternate hostnames, schemes and ports are different origins. This setting does not enable TLS. HTTP is supported with a non-Secure HttpOnly cookie, but network interception can expose passwords and sessions.

Startup warns if Secure cookies are not enabled. This is informational; it does not infer the public scheme behind a proxy or prevent HTTP/local deployments.

Cross-site and same-site Fetch Metadata reject writes. Otherwise, a supplied Origin must match exactly; `Origin: null` is rejected. Without Origin, a supplied Referer must match. GET, HEAD and OPTIONS are unchanged; CORS remains disabled.

Every write also requires `X-CSRF-Token` bound to the current cookie context, including login, setup, recovery and logout. Headerless scripts have no exemption. Tokens rotate with sessions. These controls do not replace network access restrictions or prevent DNS rebinding.

### Client addresses and rate limits

Rate limits use 15 authentication writes and 200 API requests per client per minute. Request logs use the same verified client address.

With `CADDY_UI_TRUSTED_PROXIES` unset, the backend resolves only the bundled `caddy-ui-frontend` service and trusts that address as its immediate proxy. Addresses refresh every 30 seconds; lookup failures disable trust until discovery recovers. Direct connections from other peers ignore forwarding headers. The bundled nginx replaces incoming `X-Forwarded-For` with its verified client address, so direct frontend clients retain separate budgets without trusting arbitrary Docker peers.

Set `CADDY_UI_TRUSTED_PROXIES` to an empty value to disable proxy trust, or to explicit comma-separated IPv4/IPv6 addresses or CIDRs to override discovery. Boolean values, hop counts, hostnames, zero-length prefixes and IPv4-mapped IPv6 prefixes below /96 fail startup. Custom frontend names or non-Docker deployments need explicit proxy addresses. Restart after changing the setting. Keep the backend private where possible; avoid trusting client networks or shared NAT gateways.

When Caddy or another reverse proxy serves the UI through nginx, set `CADDY_UI_TRUSTED_UPSTREAMS` **on the frontend container** to that proxy's actual source IP or a narrow, controlled CIDR. For example:

```yaml
# caddy-ui-frontend service
    environment:
      - CADDY_UI_TRUSTED_UPSTREAMS=172.30.0.2
```

nginx accepts `X-Forwarded-For` only from configured upstreams, resolves the last untrusted address in the chain, and sends the backend a single verified address. Untrusted direct clients cannot supply their own identity. Use stable upstream addresses; restart nginx after changing the setting. Custom nginx configurations must retain equivalent real-IP and header-sanitization rules.

Without upstream trust, clients behind Caddy share Caddy's budget and its address appears in logs. If frontend discovery is unavailable, clients behind nginx share nginx's budget. No broader trust is inferred to avoid this limitation. Every trusted upstream must sanitize forwarding headers; an overly broad trust range can reintroduce spoofing.

<!-- dockerhub:backend:end -->
<!-- ANCHOR_END: authentication -->


<!-- ANCHOR: prometheus-metrics -->
<!-- dockerhub:backend:start -->
## Prometheus Metrics

Enable Caddy metrics in the Metrics tab or Caddyfile. Use a `metrics:read` token for selected instances. `CADDY_UI_PUBLIC_METRICS=true` instead exposes metrics without authentication.

```yaml
scrape_configs:
  - job_name: caddy
    static_configs:
      - targets: ['caddy-ui-backend:3001']
    metrics_path: /api/metrics/raw
    authorization:
      type: Bearer
      credentials_file: /run/secrets/caddy_ui_metrics_token
    http_headers:
      X-Instance-Id:
        values: ['default']
```

The endpoint includes upstream uptime history (`instance_id`, `instance_name`, `upstream` labels) and enabled route history (`instance_id`, `instance_name`, `route`), even with Caddy metrics disabled. Tokens include only permitted instances; administrator sessions and public scrapes include all:

| Metric | Description |
|---|---|
| `caddy_ui_upstream_up` | Result of the most recent check (1 = online, 0 = offline) |
| `caddy_ui_upstream_uptime_ratio` | Fraction of retained checks that were online (see `UPTIME_HISTORY_RETENTION_DAYS`) |
| `caddy_ui_upstream_state_duration_seconds` | Time the upstream has been in its current state |
| `caddy_ui_route_up` | Result of the most recent route check (1 = online, 0 = offline) |
| `caddy_ui_route_uptime_ratio` | Fraction of retained route checks that were online |
| `caddy_ui_route_state_duration_seconds` | Time the route has been in its current state |
| `caddy_ui_caddy_metrics_up` | Whether Caddy's `/metrics` could be scraped for the requested instance |

Upstreams that haven't been checked in 5 minutes, and routes that haven't been checked in 12.5 minutes (2.5 route check intervals), are omitted: they've been removed from the config, skipped, or their instance is unreachable.
<!-- dockerhub:backend:end -->
<!-- ANCHOR_END: prometheus-metrics -->


<!-- ANCHOR: homepage-widget -->
<!-- dockerhub:backend:start -->
## Homepage Widget

The status endpoint returns enriched data for [Homepage](https://gethomepage.dev). Create a `status:read` token and supply it through Homepage's environment substitution:

```yaml
- Caddy:
    href: https://caddy.home
    icon: caddy.png
    widget:
        type: customapi
        url: http://caddy-ui-backend:3001/api/status
        headers:
            Authorization: Bearer {{HOMEPAGE_VAR_CADDY_UI_TOKEN}}
            X-Instance-Id: default
        mappings:
            - field: online
              label: Status
              format: text
              remap:
                  - value: true
                    to: Online
                  - value: false
                    to: Offline
            - field: routeCount
              label: Routes
              format: number
            - field: upstreamsOnline
              label: Upstreams
              format: number
            - field: uptime
              label: Uptime
              format: text
```
<!-- dockerhub:backend:end -->
<!-- ANCHOR_END: homepage-widget -->


<!-- dockerhub:backend:start -->
## API Endpoints

See the [API reference](https://zackwag.github.io/caddy-ui/api.html) for endpoints and authentication requirements.
<!-- dockerhub:backend:end -->
<!-- ANCHOR: api-endpoints -->

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/sessions` | Authenticate and set a session cookie (CSRF required) |
| `DELETE` | `/api/auth/sessions/current` | Revoke the current session (CSRF required) |
| `GET` | `/api/auth/csrf` | Obtain the CSRF token for the current or a new pre-login context |
| `POST` | `/api/auth/setup` | Initialize stored credentials once and return a recovery key (CSRF required) |
| `GET` | `/api/auth/credentials` | Read the administrator username (management session required) |
| `PATCH` | `/api/auth/credentials` | Update `username` and/or `password`, requiring `currentPassword`, a management session and CSRF; renews this session and revokes old sessions, preserving API tokens and recovery |
| `POST` | `/api/auth/recovery` | Reset password using a recovery key and rotate that key (CSRF required) |
| `GET` | `/api/auth/tokens` | List token metadata (management session only) |
| `POST` | `/api/auth/tokens` | Create a read-only integration token (session + CSRF) |
| `DELETE` | `/api/auth/tokens/:id` | Revoke an integration token (session + CSRF) |
| `GET` | `/api/auth/status` | Read authentication, enrollment and session state without credentials |
| `GET` | `/api/metrics` | Parsed HTTP metrics for the Metrics tab |
| `GET` | `/api/metrics/config` | Check if Caddy metrics directive is enabled |
| `PUT` | `/api/metrics/config` | Enable or disable Caddy metrics directive |
| `GET` | `/api/metrics/raw` | Raw Prometheus metrics (public if `CADDY_UI_PUBLIC_METRICS=true`) |
| `GET` | `/api/status` | Server status, route count, upstream health, and uptime |
| `GET` | `/api/status/caddy-config` | Full raw Caddy JSON config |
| `GET` | `/api/status/process` | Caddy process info including version |
| `GET` | `/api/caddyfile` | Read Caddyfile from disk |
| `GET` | `/api/caddyfile?download=true` | Download Caddyfile as a timestamped attachment |
| `PUT` | `/api/caddyfile` | Save, validate, format, and reload |
| `POST` | `/api/caddyfile/validations` | Validate (and optionally format) without saving |
| `POST` | `/api/caddyfile/reloads` | Reload Caddy from disk |
| `GET` | `/api/caddyfile/history` | List all Caddyfile snapshots |
| `GET` | `/api/caddyfile/history/:filename` | Read a specific snapshot |
| `DELETE` | `/api/caddyfile/history/:filename` | Delete a snapshot |
| `GET` | `/api/routes` | List all routes across all HTTP servers |
| `POST` | `/api/routes` | Add a reverse proxy route |
| `PATCH` | `/api/routes/:id` | Update a UI-managed route by ID |
| `DELETE` | `/api/routes/:id` | Remove a route and its Caddyfile block |
| `GET` | `/api/route-notes` | Read all route notes |
| `PUT` | `/api/route-notes/:domain` | Set or clear a route note |
| `GET` | `/api/health` | Live upstream check via Caddy pool API with TCP fallback (not recorded in uptime history) |
| `GET` | `/api/health/uptime` | Uptime stats per upstream from persisted history, sampled every 30 seconds by the backend |
| `GET` | `/api/health/history` | Raw timestamped checks for one upstream, for the route status history view |
| `GET` | `/api/tls` | List all certificates with expiry and status |
| `DELETE` | `/api/tls/:domain` | Delete an orphaned, superseded, or expired internal cert |
| `GET` | `/api/tls/ca` | Download Caddy's root CA certificate |
| `GET` | `/api/logs` | Last 200 lines of the access log |
| `GET` | `/api/logs/stream` | SSE stream of live log output |
| `GET` | `/api/logs/config` | Read log configuration |
| `PUT` | `/api/logs/config` | Update log configuration |
| `GET` | `/api/server-names` | Read server labels for the selected instance |
| `GET` | `/api/server-names/all` | Read server labels for every instance |
| `PUT` | `/api/server-names/:id` | Set a server label |
| `DELETE` | `/api/server-names/:id` | Remove a server label |
| `GET` | `/api/notifications/config` | Read notification settings |
| `PUT` | `/api/notifications/config` | Update notification settings |
| `POST` | `/api/notifications/test` | Send a test notification |
<!-- ANCHOR_END: api-endpoints -->


<!-- ANCHOR: custom-nginx -->
<!-- dockerhub:frontend:start -->
## Custom Nginx Config

The frontend proxies API requests to `caddy-ui-backend:3001` by default. To preserve client addresses behind Caddy or another reverse proxy, set `CADDY_UI_TRUSTED_UPSTREAMS` on the frontend container to that proxy's specific IP/CIDR (comma-separated for multiple proxies). Unset trusts no upstream forwarding headers. See [client addresses and rate limits](#client-addresses-and-rate-limits).

These settings also apply to prebuilt images. If your backend has a different hostname or port, mount a custom Nginx config:

```yaml
volumes:
  - ./nginx.conf:/etc/nginx/conf.d/default.conf
```

<!-- dockerhub:frontend:end -->
<!-- ANCHOR_END: custom-nginx -->

</details>

## Docker images

| Service | Image |
|---------|-------|
| Frontend | [zackwag/caddy-ui-frontend](https://hub.docker.com/r/zackwag/caddy-ui-frontend) |
| Backend | [zackwag/caddy-ui-backend](https://hub.docker.com/r/zackwag/caddy-ui-backend) |

Both images are required. The frontend serves the UI and proxies requests to the backend.

<!-- ANCHOR: image-tags -->
<!-- dockerhub:both:start -->
## Image Tags

| Tag | Description |
|-----|-------------|
| `latest` | Most recent stable release |
| `beta` | Pre-release build of a specific branch or pull request, published manually for testing |
| `edge` | Most recent build of any kind: every push to `main` and every `beta` build. May contain unreleased or unmerged changes |

See [GitHub releases](https://github.com/zackwag/caddy-ui/releases)
for versioned image tags and release notes.

<!-- dockerhub:both:end -->
<!-- ANCHOR_END: image-tags -->

## Localization

![Localization coverage](https://zackwag.github.io/caddy-ui/assets/localization-coverage.svg)

English (`src/frontend/src/i18n/locales/en.js`) is the canonical localization schema and fallback language. Additional locale catalogs may translate any subset of the English keys; missing keys fall back to English. Locale catalogs may not introduce keys or key-tree shapes that do not exist in `en.js`.

Every locale must define `test.languageLoaded`, which is used by the frontend language API integration test to verify that an advertised locale can actually be loaded.

Translations are human-authored. Machine-generated, agentic, or bulk machine translations are not accepted.

## Contributing

You can contribute code, improve the documentation, or help with localization. Start with [CONTRIBUTING.md](CONTRIBUTING.md) to choose a path.

## Releases and license

See [GitHub releases](https://github.com/zackwag/caddy-ui/releases), [CHANGELOG.md](CHANGELOG.md),
and the [earlier release history](https://zackwag.github.io/caddy-ui/releases.html#changelog).

MIT — see [LICENSE](LICENSE).
