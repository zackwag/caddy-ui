<!-- AUTO-GENERATED using .github/scripts/dockerhub-docs.mjs from README.md for release 3.5.0. Do not edit directly. -->

# caddy/ui — Frontend

The React frontend for caddy/ui, served by Nginx.

> This is the **frontend** image. You will also need the [backend image](https://hub.docker.com/r/zackwag/caddy-ui-backend).

## Overview

caddy/ui manages one or more [Caddy](https://caddyserver.com) servers through their admin APIs. It runs as two Docker containers alongside Caddy. Your Caddyfile remains the source of truth: you can edit it directly or through the UI.

## Features

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

## Custom Nginx Config

The frontend proxies API requests to `caddy-ui-backend:3001` by default. To preserve client addresses behind Caddy or another reverse proxy, set `CADDY_UI_TRUSTED_UPSTREAMS` on the frontend container to that proxy's specific IP/CIDR (comma-separated for multiple proxies). Unset trusts no upstream forwarding headers. See [client addresses and rate limits](https://github.com/zackwag/caddy-ui#client-addresses-and-rate-limits).

These settings also apply to prebuilt images. If your backend has a different hostname or port, mount a custom Nginx config:

```yaml
volumes:
  - ./nginx.conf:/etc/nginx/conf.d/default.conf
```

## Image Tags

| Tag | Description |
|-----|-------------|
| `latest` | Most recent stable release |
| `beta` | Pre-release build of a specific branch or pull request, published manually for testing |
| `edge` | Most recent build of any kind: every push to `main` and every `beta` build. May contain unreleased or unmerged changes |

See [GitHub releases](https://github.com/zackwag/caddy-ui/releases)
for versioned image tags and release notes.

## Full Documentation

See the [GitHub README](https://github.com/zackwag/caddy-ui#readme) for complete setup, features, configuration, and API documentation.
