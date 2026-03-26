# caddy/ui — Backend

The API backend for caddy/ui. A lightweight Node.js/Express server that proxies Caddy's admin API, manages the Caddyfile on disk, and streams access logs.

## Stack

- **Runtime**: Node.js 20
- **Framework**: Express
- **Caddy binary**: Installed in the container for `caddy validate` and `caddy fmt`

## Development

### Prerequisites

- Node.js 20+
- A running Caddy instance with admin API enabled on port 2019

### Install dependencies

```bash
npm install
```

### Environment variables

| Variable            | Default                           | Description                       |
|---------------------|-----------------------------------|-----------------------------------|
| `PORT`              | `3001`                            | Port the backend listens on       |
| `CADDY_ADMIN_URL`   | `http://caddy:2019`               | URL of Caddy's admin API          |
| `CADDYFILE_PATH`    | `/etc/caddy/Caddyfile`            | Path to the Caddyfile             |
| `CADDY_LOG_PATH`    | `/var/log/caddy/access.log`       | Path to Caddy's access log        |
| `SERVER_NAMES_PATH` | `/etc/caddy-ui/server-names.json` | Path to server display names file |

### Run locally

```bash
CADDY_ADMIN_URL=http://localhost:2019 \
CADDYFILE_PATH=/etc/caddy/Caddyfile \
npm start
```

### Run with watch mode

```bash
npm run dev
```

## Building

```bash
docker build -t caddy-ui-backend .
```

## API Reference

### Status

| Method | Endpoint             | Description                                    |
|--------|----------------------|------------------------------------------------|
| `GET`  | `/api/status`        | Server status, server block summary, TLS state |
| `GET`  | `/api/status/config` | Full raw Caddy JSON config                     |

### Caddyfile

| Method | Endpoint                            | Description                                                           |
|--------|-------------------------------------|-----------------------------------------------------------------------|
| `GET`  | `/api/caddyfile`                    | Read Caddyfile from disk                                              |
| `PUT`  | `/api/caddyfile?fmt=true&sort=true` | Save content, validate, optionally format and sort, then reload Caddy |
| `POST` | `/api/caddyfile/validate`           | Validate content without saving                                       |
| `POST` | `/api/caddyfile/reload`             | Reload Caddy from the current file on disk                            |

**Query parameters for `PUT /api/caddyfile`:**

| Parameter | Default | Description                                              |
|-----------|---------|----------------------------------------------------------|
| `fmt`     | `true`  | Run `caddy fmt --overwrite` after saving                 |
| `sort`    | `true`  | Sort site blocks (public → internal → http) after saving |

### Routes

| Method   | Endpoint          | Description                                                                       |
|----------|-------------------|-----------------------------------------------------------------------------------|
| `GET`    | `/api/routes`     | List all routes across all server blocks                                          |
| `POST`   | `/api/routes`     | Add a new reverse proxy route to the primary server block and append to Caddyfile |
| `PATCH`  | `/api/routes/:id` | Update a route by `@id`                                                           |
| `DELETE` | `/api/routes/:id` | Delete a route by `@id` and remove its site block from the Caddyfile              |

**POST body:**

```json
{
  "domain": "app.example.com",
  "upstream": "192.168.1.100:8080",
  "stripPrefix": "/api"
}
```

### Logs

| Method | Endpoint           | Description                                      |
|--------|--------------------|--------------------------------------------------|
| `GET`  | `/api/logs`        | Last 200 lines of the access log                 |
| `GET`  | `/api/logs/stream` | SSE stream of new log lines                      |
| `GET`  | `/api/logs/config` | Read log configuration parsed from the Caddyfile |
| `PUT`  | `/api/logs/config` | Update log configuration and reload Caddy        |

**PUT `/api/logs/config` body:**

```json
{
  "enabled": true,
  "path": "/var/log/caddy/access.log",
  "rollSize": "50mb",
  "rollKeep": 5,
  "format": "json",
  "level": "INFO"
}
```

### Server Names

| Method   | Endpoint                | Description                           |
|----------|-------------------------|---------------------------------------|
| `GET`    | `/api/server-names`     | Read all server block display names   |
| `PUT`    | `/api/server-names/:id` | Set a display name for a server block |
| `DELETE` | `/api/server-names/:id` | Clear a display name                  |

**PUT body:**

```json
{
  "name": "Main Sites"
}
```

## Source Layout

```text
src/
├── index.js           # Express app setup and route registration
├── caddy.js           # Caddy admin API client (GET, POST, PUT, PATCH, DELETE, load)
└── routes/
    ├── caddyfile.js   # Caddyfile management, validation, formatting, sorting
    ├── routes.js      # Route CRUD with Caddyfile sync
    ├── status.js      # Status and raw config endpoints
    ├── logs.js        # Log tailing, SSE streaming, config parsing
    └── servernames.js # Persistent server block display names
```
