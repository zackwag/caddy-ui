# caddy/ui

A modern, dark-themed web interface for managing your [Caddy](https://caddyserver.com) server. Built from scratch in a single conversation with Claude.

![Dashboard](https://img.shields.io/badge/status-active-00e5a0?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Frontend](https://img.shields.io/badge/frontend-React-61dafb?style=flat-square)
![Backend](https://img.shields.io/badge/backend-Node.js-339933?style=flat-square)

## Overview

caddy/ui is a self-hosted management interface for Caddy. It runs as two Docker containers alongside your existing Caddy instance and communicates with Caddy's built-in admin API. Your Caddyfile remains the source of truth — the UI reads from it, writes to it, and never takes ownership away from you.

## Features

- **Dashboard** — Live server status, TLS state, server block summary with custom display names, and upstream health overview
- **Caddyfile Editor** — Edit your Caddyfile with syntax highlighting, live validation, `caddy fmt` formatting, automatic site block sorting, backup/restore, and full version history with inline preview and one-click rollback
- **Route Manager** — View all reverse proxy routes across all server blocks, with live upstream healthchecks, search/filter, clickable domain and upstream links, edit routes in-place, and per-route notes
- **TLS Certificates** — View cert status, expiry dates, and days remaining for all managed domains. Detect and delete orphaned certs
- **Access Logs** — Tail live log output with SSE streaming, real-time keyword search, and ERROR/WARN/INFO level filters
- **Log Configuration** — Enable, disable, and configure Caddy access logging directly from the UI
- **Mobile Friendly** — Responsive layout with collapsible sidebar

## Architecture

```mermaid
graph LR
    FE["caddy/ui frontend\nReact + Nginx\n:9877"]
    BE["caddy/ui backend\nNode.js + Express\n:9876"]
    CA["Caddy\n:2019 admin API\n:80 / :443"]
    CF[("Caddyfile\n/etc/caddy/Caddyfile")]
    LG[("Access Logs\n/var/log/caddy")]
    SN[("Server Names\n/etc/caddy-ui")]
    TLS[("Certificates\n/data/caddy/caddy")]
    HX[("History\n/etc/caddy-ui/history")]
    RN[("Route Notes\n/etc/caddy-ui")]

    FE -->|"/api/* proxy"| BE
    BE -->|"admin API"| CA
    BE -->|"TCP healthcheck"| CA
    BE <-->|"read / write / backup"| CF
    BE <-->|"read / stream"| LG
    BE <-->|"read / write"| SN
    BE <-->|"read / delete"| TLS
    BE <-->|"snapshot / restore"| HX
    BE <-->|"read / write"| RN
    CA <-->|"reload from"| CF
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- An existing Caddy container with the admin API enabled

### 1. Enable Caddy's admin API

Add `CADDY_ADMIN=0.0.0.0:2019` to your Caddy container's environment variables. Your Caddyfile global block just needs your email:

```json
{
    email you@example.com
}
```

### 2. Create required directories

```bash
mkdir -p /docker/caddy/logs
mkdir -p /docker/caddy-ui
```

### 3. Update your compose file

```yaml
services:
  caddy:
    image: caddy:latest
    # ... your existing config, plus:
    environment:
      - CADDY_ADMIN=0.0.0.0:2019
    volumes:
      # ... your existing volumes, plus:
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
      - PORT=3001
      - CADDY_ADMIN_URL=http://caddy:2019
      - CADDYFILE_PATH=/etc/caddy/Caddyfile
      - CADDY_LOG_PATH=/var/log/caddy/access.log
      - SERVER_NAMES_PATH=/etc/caddy-ui/server-names.json
      - CADDY_DATA_PATH=/data/caddy/caddy
      - HISTORY_PATH=/etc/caddy-ui/history
      - ROUTE_NOTES_PATH=/etc/caddy-ui/route-notes.json
    volumes:
      - /docker/caddy/Caddyfile:/etc/caddy/Caddyfile
      - /docker/caddy/logs:/var/log/caddy
      - /docker/caddy-ui:/etc/caddy-ui
      - /docker/caddy/data:/data/caddy
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

### 4. Deploy

```bash
docker compose up -d
```

Open `http://your-server:9877` in your browser.

## Building from Source

```bash
# Build backend
cd backend
docker build -t caddy-ui-backend .

# Build frontend
cd frontend
docker build -t caddy-ui-frontend .
```

## Project Structure

```text
caddy-ui/
├── backend/
│   ├── src/
│   │   ├── index.js
│   │   ├── caddy.js
│   │   └── routes/
│   │       ├── caddyfile.js
│   │       ├── routes.js
│   │       ├── status.js
│   │       ├── logs.js
│   │       ├── tls.js
│   │       ├── health.js
│   │       ├── servernames.js
│   │       └── routenotes.js
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   └── App.jsx
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── vite.config.js
│   ├── index.html
│   └── package.json
└── README.md
```

## Docker Hub

| Image | Link |
|-------|------|
| Frontend | [zackwag/caddy-ui-frontend](https://hub.docker.com/r/zackwag/caddy-ui-frontend) |
| Backend | [zackwag/caddy-ui-backend](https://hub.docker.com/r/zackwag/caddy-ui-backend) |

## Changelog

| Version | Description |
|---------|-------------|
| `v1.6` | Edit routes in-place, route notes, Caddyfile syntax highlighting |
| `v1.5` | Caddyfile version history with snapshots, log search and level filters |
| `v1.4` | Dashboard health summary, route search/filter, Caddyfile backup and restore |
| `v1.3` | Upstream healthchecks, clickable domain/upstream links, http/https scheme detection |
| `v1.2` | TLS certificate tab, orphaned cert cleanup, all server routes visible, mobile layout |
| `v1.1` | Mobile responsive layout, hamburger menu |
| `v1.0` | Initial release |

## License

MIT
