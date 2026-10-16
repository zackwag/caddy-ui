<!-- AUTO-GENERATED using .github/scripts/dockerhub-docs.mjs from README.md for release 2.26.0. Do not edit directly. -->

# caddy/ui — Frontend

The web frontend for [caddy/ui](https://hub.docker.com/r/zackwag/caddy-ui-backend), a web interface for managing your [Caddy](https://caddyserver.com) server. Built with React and served via Nginx.

> This is the **frontend** image. You will also need the [backend image](https://hub.docker.com/r/zackwag/caddy-ui-backend).

## Overview

caddy/ui is a self-hosted management interface for Caddy. It runs as two Docker containers alongside your Caddy instance(s) and communicates with Caddy's built-in admin API. Your Caddyfile remains the source of truth — the UI reads from it, writes to it, and never takes ownership away from you. Manage one Caddy server or many from a single interface.

## Features

- **Dashboard** — Live server status, TLS state, an HTTP servers table (label, Server ID, listen address, route count) with optional labels, upstream health overview, and Caddy process info (version, uptime, memory, last reload)
- **Caddyfile Editor** — Edit your Caddyfile with [real Caddyfile-grammar syntax highlighting](https://zackwag.github.io/caddy-ui/caddyfile.html#caddyfile-syntax-highlighting) (directives, matchers, placeholders, env vars — not a generic nginx approximation), live validation, `caddy fmt` formatting, automatic site block sorting, export/import, and full version history with inline preview and one-click rollback
- **Route Manager** — View all reverse proxy routes across all HTTP servers, with a live health-status column (hover for uptime %), search/filter by domain, upstream, note, or server, sortable columns, a column picker to show/hide Title/Upstream/Server/ID, clickable domain and upstream links, edit routes in-place, and per-route notes
- **TLS Certificates** — View cert status, expiry dates, and sortable columns for all managed domains. Detect and delete orphaned certs. Download Caddy's root CA cert with per-OS install instructions
- **Access Logs** — Tail live log output with SSE streaming, real-time keyword search, ERROR/WARN/INFO level filters, and log export
- **Log Configuration** — Enable, disable, and configure Caddy access logging directly from the UI
- **Metrics** — Request count, RPS, avg response time, status code breakdown, and p50/p95/p99 percentiles powered by Caddy's built-in Prometheus endpoint
- **Uptime** — On the Metrics tab, uptime %, current state, and a status history timeline for every route's upstream, recorded every 30s in the background. Optional **route checks** also request each site through Caddy every 5 minutes (User-Agent `caddy-ui-route-check`), so a route counts as down when its upstream accepts connections but the site returns 5xx, times out, or serves a certificate a browser would reject (expired, wrong name, or not issued by a trusted CA — Caddy's own local CA is trusted automatically). An offline route shows why its last check failed, and routes that can't be checked meaningfully can be skipped individually. Route checks are off by default because those requests appear in Caddy's access logs and request metrics.
- **Notifications** — Push alerts via ntfy, Discord, Slack, Pushover, or custom webhook when upstreams go offline/online, routes go down/recover (with route checks on), or TLS certs are expiring. Configurable debounce and per-trigger opt-in
- **26 Themes + Custom Themes** — Choose from 13 dark and 13 light palettes (VT2026, Dracula, Nord, Catppuccin, Tokyo Night, Gruvbox, One Dark Pro, Solarized, Material, GitHub, Ayu, Night Owl, Metro, and more), or drop your own into [`THEMES_PATH`](https://zackwag.github.io/caddy-ui/themes.html#custom-themes) for a fully custom palette. Pick one palette for dark mode and one for light mode, then toggle between them with one click. First-run welcome modal helps new users choose. Preferences stored server-side in `settings.json`
- **URL-Based Navigation** — Full browser history support, bookmarkable URLs, and deep links (e.g. `/routes?filter=srv0`)
- **Authentication** — Optional JWT-based login screen protecting the UI and authenticated API routes
- **Multi-Instance** — Manage multiple Caddy instances from a single UI. Auto-discover Caddy containers on your Docker network, add/edit/remove instances from the Instances page, and switch between them with the sidebar instance switcher
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

### 3. Generate a JWT secret (if using auth)

<!-- ANCHOR: quick-start-auth -->
```bash
openssl rand -base64 32
```
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
      - CADDY_UI_ADDITIONAL_LANGUAGES=de
      # Optional -- leave unset to disable auth
      - CADDY_UI_USER=admin
      - CADDY_UI_PASSWORD=yourpassword
      - JWT_SECRET=your-long-random-secret
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

The backend only needs two volumes: the **Docker socket** (to interact with Caddy containers via `docker exec` and discover new instances) and its own **config directory** (for instance registry, history, and settings). No Caddy volume mounts required — all Caddyfile, log, and certificate operations go through the Docker socket.
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
caddy/ui runs as two services: a React frontend served by Nginx and a Node.js/Express backend. The frontend proxies API requests to the backend, which communicates with Caddy's admin API.

In Docker mode, the backend uses the Docker socket for container discovery and file operations inside Caddy containers. Its persistent configuration directory stores application settings and instance data. Local mode supports Caddy installations outside Docker. The Caddyfile remains the source of truth.

## Custom Nginx Config

The frontend proxies API requests to `caddy-ui-backend:3001` by default. This configuration also applies to prebuilt images. If your backend has a different hostname or port, mount a custom Nginx config:

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
