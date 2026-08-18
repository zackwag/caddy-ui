# caddy/ui — Frontend

The web frontend for [caddy/ui](https://hub.docker.com/r/zackwag/caddy-ui-backend), a web interface for managing your [Caddy](https://caddyserver.com) server. Built with React and served via Nginx.

> This is the **frontend** image. You will also need the [backend image](https://hub.docker.com/r/zackwag/caddy-ui-backend).

## Features

- Dashboard with server status, route count, upstream health, and process info
- Caddyfile editor with syntax highlighting, format-on-save, validation, and version history
- Route manager — add, edit, and remove reverse proxy routes across all server blocks
- TLS certificate overview with expiry tracking, status badges, and orphaned cert cleanup
- Root CA certificate download
- Live access log streaming with filtering and search
- HTTP metrics dashboard with response code breakdown, latency percentiles, and per-route stats
- Push notification settings — configure ntfy, Discord, Slack, Pushover, or custom webhook alerts
- Dark and light theme with system-aware toggle
- Responsive mobile layout with collapsible sidebar
- Optional JWT authentication with session expiry handling

## Quick Start

```yaml
services:
  caddy-ui-frontend:
    image: zackwag/caddy-ui-frontend:latest
    container_name: caddy-ui-frontend
    restart: unless-stopped
    ports:
      - 8080:80
    networks:
      - caddy-ui
    depends_on:
      - caddy-ui-backend
```

The frontend proxies API requests to the backend via Nginx. The default Nginx config expects the backend at `caddy-ui-backend:3001`.

## Custom Nginx Config

If your backend has a different hostname or port, mount a custom Nginx config:

```yaml
volumes:
  - ./nginx.conf:/etc/nginx/conf.d/default.conf
```

## Tags

| Tag | Description |
|-----|-------------|
| `latest` | Most recent stable build |
| `v1.12` | Notifications settings panel |
| `v1.11` | Caddy version display restored, superseded cert detection |
| `v1.10.1` | Validate checkbox for `caddy fmt` |
| `v1.10` | React Router navigation, RESTful UI patterns |
| `v1.9` | Dark/light theme, log export |
| `v1.8` | Metrics tab with latency percentiles |
| `v1.7` | Login screen, auth support |
| `v1.6` | Route editing, route notes |
| `v1.5` | Caddyfile history viewer |
| `v1.4` | Dashboard health summary |
| `v1.3` | Health status dots, domain links |
| `v1.2` | TLS tab, certificate management |
| `v1.1` | Initial release |

## Source

[github.com/zackwag/caddy-ui](https://github.com/zackwag/caddy-ui)
