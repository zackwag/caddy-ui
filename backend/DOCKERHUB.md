# caddy/ui — Backend

The API backend for [caddy/ui](https://hub.docker.com/r/zackwag/caddy-ui-frontend), a web interface for managing your [Caddy](https://caddyserver.com) server. Built with Node.js and Express.

> This is the **backend** image. You will also need the [frontend image](https://hub.docker.com/r/zackwag/caddy-ui-frontend).

## Features

- Proxies requests to Caddy's admin API (`/config`, `/id`, `/load`)
- Reads and writes the Caddyfile on disk
- Runs `caddy validate` via Caddy's `/adapt` admin API endpoint
- Runs `caddy fmt` and detects Caddy version via `docker exec` into the running Caddy container (requires Docker socket mount)
- Sorts Caddyfile site blocks on save (public → internal → http)
- Appends, updates, and removes site blocks when routes are managed via the UI
- Fetches routes from all server blocks with recursive upstream extraction for complex route structures
- Health checks use Caddy's reverse proxy upstream pool API as primary source, with TCP fallback for upstreams not yet in the pool
- In-memory rolling uptime tracking per upstream (288-check window, ~2.5 hours)
- Push notifications via ntfy, Discord, Slack, Pushover, or custom webhook — triggered on upstream offline/online and cert expiry
- Configurable notification debounce to suppress repeat alerts
- Reads TLS certificate files from disk and parses expiry dates
- Detects and deletes orphaned, superseded, and expired certificates (resolves issuer directory automatically)
- Root CA cert download via Caddy's `/pki/ca/local` admin API
- Automatic Caddyfile snapshots on every save with configurable retention
- Tails and streams access logs via SSE
- Parses and updates log configuration in the global Caddyfile block
- Persists server block display names and route notes to disk
- Optional JWT authentication protecting all API endpoints
- Caddy process info and HTTP metrics via Prometheus endpoint
- Metrics enable/disable toggle that modifies the Caddyfile global block
- Optional public `/api/metrics/raw` endpoint for Prometheus scraping
- Structured JSON logging with configurable log level via `LOG_LEVEL`
- Enriched status endpoint with route count, upstream health, and uptime for Homepage widget support

## Quick Start

```yaml
services:
  caddy-ui-backend:
    image: zackwag/caddy-ui-backend:latest
    container_name: caddy-ui-backend
    restart: unless-stopped
    ports:
      - 9876:3001
    environment:
      - TZ=America/New_York
      # Optional auth -- leave unset to disable
      - CADDY_UI_USER=admin
      - CADDY_UI_PASSWORD=yourpassword
      - JWT_SECRET=your-long-random-secret
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /docker/caddy/Caddyfile:/etc/caddy/Caddyfile
      - /docker/caddy/logs:/var/log/caddy
      - /docker/caddy-ui:/etc/caddy-ui
      - /docker/caddy/data:/data/caddy
    networks:
      - caddy-ui
    depends_on:
      - caddy
```

> **Note:** The Docker socket mount is required for `caddy fmt` formatting and Caddy version detection. The backend runs `docker exec` into the Caddy container — make sure `CADDY_CONTAINER_NAME` matches your Caddy container name if it differs from `caddy`.

## Environment Variables

All variables have sensible defaults. Only set what you need to override.

| Variable | Default | Description |
|----------|---------|-------------|
| `CADDY_ADMIN_URL` | `http://caddy:2019` | URL of Caddy's admin API |
| `CADDY_CONFIG_PATH` | `/etc/caddy/Caddyfile` | Path to the Caddyfile inside the container |
| `CADDY_CONTAINER_NAME` | `caddy` | Name of the Caddy container (used for `docker exec`) |
| `CADDY_DATA_PATH` | `/data/caddy/caddy` | Path to Caddy's data directory containing certificates |
| `CADDY_LOG_PATH` | `/var/log/caddy/access.log` | Path to Caddy's access log |
| `CADDY_SERVER_NAME` | `srv0` | Primary server block name for new routes |
| `CADDY_UI_PASSWORD` | — | Password for UI authentication |
| `CADDY_UI_PUBLIC_METRICS` | `false` | Expose `/api/metrics/raw` without auth for Prometheus scraping |
| `CADDY_UI_USER` | — | Username for UI authentication (leave unset to disable auth) |
| `HISTORY_PATH` | `/etc/caddy-ui/history` | Path to the Caddyfile snapshot directory |
| `JWT_SECRET` | — | Secret key for signing JWT tokens |
| `LOG_LEVEL` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `NOTIFICATIONS_CONFIG_PATH` | `/etc/caddy-ui/notifications.json` | Path to the notification settings file |
| `PORT` | `3001` | Port the backend listens on |
| `ROUTE_NOTES_PATH` | `/etc/caddy-ui/route-notes.json` | Path to the route notes file |
| `SERVER_NAMES_PATH` | `/etc/caddy-ui/server-names.json` | Path to the server display names file |

## Authentication

Authentication is disabled by default. Set `CADDY_UI_USER`, `CADDY_UI_PASSWORD`, and `JWT_SECRET` to enable it. All `/api/*` endpoints are protected and the login screen appears automatically.

Generate a secure JWT secret:

```bash
openssl rand -base64 32
```

## Prometheus Metrics

If `CADDY_UI_PUBLIC_METRICS=true`, the endpoint `GET /api/metrics/raw` is available without authentication. Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: caddy
    static_configs:
      - targets: ['caddy-ui-backend:3001']
    metrics_path: /api/metrics/raw
```

Caddy's metrics endpoint must be enabled in your Caddyfile global block:

```
{
    email you@example.com
    metrics
}
```

This can be toggled from the caddy/ui Metrics tab without editing the Caddyfile manually.

## Homepage Widget

The status endpoint returns enriched data for use with [Homepage](https://gethomepage.dev):

```yaml
- Caddy:
    href: https://caddy.home
    icon: caddy.png
    widget:
      type: customapi
      url: http://caddy-ui-backend:3001/api/status
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

## Required Volumes

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `/var/run/docker.sock` | `/var/run/docker.sock` | Docker socket for `caddy fmt` and version detection |
| `/docker/caddy/Caddyfile` | `/etc/caddy/Caddyfile` | Shared Caddyfile with the Caddy container |
| `/docker/caddy/logs` | `/var/log/caddy` | Shared log directory with the Caddy container |
| `/docker/caddy-ui` | `/etc/caddy-ui` | Persistent storage for server names, notes, history, and notification config |
| `/docker/caddy/data` | `/data/caddy` | Caddy data directory for TLS certificate access |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/sessions` | Authenticate and receive a JWT token |
| `GET` | `/api/auth/status` | Check if auth is enabled |
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
| `GET` | `/api/routes` | List all routes across all server blocks |
| `POST` | `/api/routes` | Add a reverse proxy route |
| `PATCH` | `/api/routes/:id` | Update a UI-managed route by ID |
| `DELETE` | `/api/routes/:id` | Remove a route and its Caddyfile block |
| `GET` | `/api/route-notes` | Read all route notes |
| `PUT` | `/api/route-notes/:domain` | Set or clear a route note |
| `GET` | `/api/health` | Check upstream health via Caddy pool API with TCP fallback |
| `GET` | `/api/health/uptime` | Uptime stats per upstream from rolling history |
| `GET` | `/api/tls` | List all certificates with expiry and status |
| `DELETE` | `/api/tls/:domain` | Delete an orphaned, superseded, or expired internal cert |
| `GET` | `/api/tls/ca` | Download Caddy's root CA certificate |
| `GET` | `/api/logs` | Last 200 lines of the access log |
| `GET` | `/api/logs/stream` | SSE stream of live log output |
| `GET` | `/api/logs/config` | Read log configuration |
| `PUT` | `/api/logs/config` | Update log configuration |
| `GET` | `/api/server-names` | Read server block display names |
| `PUT` | `/api/server-names/:id` | Set a display name |
| `DELETE` | `/api/server-names/:id` | Clear a display name |
| `GET` | `/api/notifications/config` | Read notification settings |
| `PUT` | `/api/notifications/config` | Update notification settings |
| `POST` | `/api/notifications/test` | Send a test notification |

## Tags

| Tag | Description |
|-----|-------------|
| `latest` | Most recent stable build |
| `v1.12` | Push notifications, release workflow |
| `v1.11` | Caddy binary bundled, upstream pool health checks, PKI API |
| `v1.10.1` | Caddy `/adapt` API validation, Docker socket removal |
| `v1.10` | React Router, RESTful API audit, Homepage widget |
| `v1.9` | Dark/light theme, log export, root CA download |
| `v1.8` | Metrics tab, uptime tracking |
| `v1.7` | JWT auth, Caddy process info, metrics toggle |
| `v1.6` | Edit routes, route notes, Caddyfile sync |
| `v1.5` | Caddyfile version history, automatic snapshots |
| `v1.4` | Caddyfile backup/restore, dashboard health summary |
| `v1.3` | Upstream healthchecks, scheme detection |
| `v1.2` | TLS certificate management, orphaned cert cleanup |
| `v1.1` | Initial release |

## Source

[github.com/zackwag/caddy-ui](https://github.com/zackwag/caddy-ui)
