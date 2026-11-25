<!-- AUTO-GENERATED using .github/scripts/dockerhub-docs.mjs from README.md for release 3.9.1. Do not edit directly. -->

# caddy/ui — Backend

The Node.js/Express API backend for caddy/ui.

> This is the **backend** image. You will also need the [frontend image](https://hub.docker.com/r/zackwag/caddy-ui-frontend).

## Overview

caddy/ui manages one or more [Caddy](https://caddyserver.com) servers through their admin APIs. It runs as two Docker containers alongside Caddy. Your Caddyfile remains the source of truth: you can edit it directly or through the UI.

## Features

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

## Architecture
<!-- ANCHOR: architecture -->
The Nginx frontend proxies API requests to the Node.js/Express backend, which talks to Caddy's admin API.

Docker mode uses the socket for container discovery and file operations. Local mode supports Caddy outside Docker. The backend's persistent config directory holds credentials, settings and instance data.

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
| `CADDY_UI_EXTERNAL_URL` | — | Comma-separated browser-facing UI URLs, including scheme and external port (e.g. `https://caddy.internal,http://192.168.4.87:9877`). Their origins validate browser writes when Fetch Metadata is absent, as on plain HTTP. Required for those writes; never inferred from proxy headers. Passkeys use the first HTTPS non-IP URL. |
| `CADDY_UI_TRUSTED_PROXIES` | bundled frontend | Backend: unset discovers only `caddy-ui-frontend` by DNS; blank disables trust. An explicit comma-separated IP/CIDR list overrides discovery. See [client addresses and rate limits](https://github.com/zackwag/caddy-ui#client-addresses-and-rate-limits). |
| `CADDY_UI_TRUSTED_UPSTREAMS` | — | Frontend nginx: comma-separated upstream proxy IPs/CIDRs allowed to supply client addresses, such as the Caddy serving the UI. Unset trusts none. |
| `CADDY_UI_PASSWORD` | — | Legacy password, used only to authenticate credential enrollment before `auth.json` exists |
| `CADDY_UI_HISTORY_LIVE_JSON` | `false` | Keep full live JSON for external changes in History. By default only fingerprints and changed paths are kept, since live JSON holds resolved secrets |
| `CADDY_UI_PUBLIC_METRICS` | `false` | Expose `/api/metrics/raw` without auth |
| `CADDY_UI_UPDATE_CHECK` | `true` | Check hourly for newer caddy-ui images and show an "Update available" badge in the sidebar (plus a notification for new releases, if notifications are on). Reads a small `versions.json` from GitHub (`raw.githubusercontent.com`); set to `false` to disable |
| `CADDY_UI_UPDATE_CHECK_URL` | `https://raw.githubusercontent.com/zackwag/caddy-ui/versions/versions.json` | Where the update check reads published image versions from |
| `CADDY_UI_USER` | — | Legacy username for credential enrollment; ignored after stored credentials are initialized |
| `AUTH_PATH` | `/etc/caddy-ui/auth.json` | Persistent administrator credential/recovery hashes and passkey records. Keep on a writable persistent volume, separate from UI settings. |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Path to the Docker socket for container discovery and `docker exec` operations |
| `HISTORY_PATH` | `/etc/caddy-ui/history` | Sensitive saved Caddyfiles, external file/JSON observations and actor metadata; see the [history guide](https://zackwag.github.io/caddy-ui/caddyfile.html#saved-versions-and-attribution) |
| `INSTANCES_PATH` | `/etc/caddy-ui/instances.json` | Path to the multi-instance configuration file (see [Multi-Instance](https://zackwag.github.io/caddy-ui/instances.html#multi-instance)) |
| `JWT_SECRET` | — | Legacy configuration marker required alongside the legacy username/password before enrollment. No new JWTs are issued. |
| `LOG_LEVEL` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `MAINTENANCE_PATH` | `/etc/caddy-ui/maintenance.json` | Path to the maintenance mode state file |
| `NOTIFICATIONS_CONFIG_PATH` | `/etc/caddy-ui/notifications.json` | Path to the notification settings file |
| `PORT` | `3001` | Port the backend listens on |
| `ROUTE_NOTES_PATH` | `/etc/caddy-ui/route-notes.json` | Path to the route notes file |
| `SERVER_NAMES_PATH` | `/etc/caddy-ui/server-names.json` | Path to the per-instance server labels file |
| `SETTINGS_PATH` | `/etc/caddy-ui/settings.json` | Path to the UI settings file (theme and editor preferences, column visibility) |
| `THEMES_PATH` | `/etc/caddy-ui/themes` | Path to the custom themes directory (see [Custom Themes](https://zackwag.github.io/caddy-ui/themes.html#custom-themes)) |
| `UPTIME_HISTORY_PATH` | `/etc/caddy-ui/uptime-history.json` | Path to the persisted upstream and route uptime history file |
| `UPTIME_HISTORY_RETENTION_DAYS` | `7` | How many days of upstream and route health checks to retain |
| `CADDY_UI_URL` | — | Override the backend address that Caddy uses to fetch maintenance pages (e.g. `caddy-ui-backend:3001`). Auto-detected from the Docker socket when available |
| `WWW_PATH` | `/etc/caddy-ui/www` | Directory for HTML pages served at `/public/responses/` (maintenance page created on first use, inline fallback if the directory is unwritable) |
| `NODE_EXTRA_CA_CERTS` | — | Path to a PEM bundle of extra CAs for route checks and notification webhooks to trust, for sites with certificates from a private CA other than Caddy's local one (standard Node.js variable) |

## Authentication

Authentication is required. With no stored credentials or legacy environment credentials, the UI offers administrator setup while management endpoints remain locked. The first visitor can create the administrator; restrict access until setup is complete.

See the [authentication guide](https://zackwag.github.io/caddy-ui/configuration.html#authentication) for existing installations, sessions and recovery, request origins, client addresses and rate limits.

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

## API Endpoints

See the [API reference](https://zackwag.github.io/caddy-ui/api.html) for endpoints and authentication requirements.

## Image Tags

| Tag | Description |
|-----|-------------|
| `latest` | Most recent stable release |
| `beta` | Most recent successful manual test build of a selected branch or pull request; may contain unmerged changes |
| `edge` | Most recent successful build from `main`; may contain unreleased changes. Beta builds do not update this tag |

These tags are mutable and advance independently for each image. Stable release
tags and `latest` are published by the release workflow; beta builds publish only
the `beta` image tag and update only beta version records.

See [GitHub releases](https://github.com/zackwag/caddy-ui/releases)
for versioned image tags and release notes.

## Full Documentation

See the [GitHub README](https://github.com/zackwag/caddy-ui#readme) for complete setup, features, configuration, and API documentation.
