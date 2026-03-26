# caddy/ui — Frontend

The React frontend for caddy/ui. A single-page application built with Vite and served in production via Nginx, which also proxies `/api` requests to the backend.

## Stack

- **Framework**: React 18
- **Build tool**: Vite 5
- **Server**: Nginx (production)
- **Styling**: Inline CSS with CSS variables — no external UI library

## Development

### Prerequisites

- Node.js 20+
- A running caddy-ui-backend instance

### Install dependencies

```bash
npm install
```

### Run locally

The API base URL defaults to `/api` which Nginx proxies in production. For local development, update the `API` constant at the top of `src/App.jsx` to point directly at the backend:

```js
const API = "http://localhost:3001/api";
```

Then run:

```bash
npm run dev
```

Open `http://localhost:5173`.

### Build for production

```bash
npm run build
```

Output goes to `dist/`.

## Building the Docker image

```bash
docker build -t caddy-ui-frontend .
```

The Dockerfile uses a two-stage build:

1. **Build stage** — Node.js 20 Alpine, runs `npm install` and `vite build`
2. **Serve stage** — Nginx Alpine, serves the built `dist/` and proxies `/api` to `caddy-ui-backend:3001`

## Nginx

The included `nginx.conf` handles two concerns:

- **SPA routing** — All non-asset requests fall back to `index.html` so React Router works correctly
- **API proxy** — Requests to `/api/` are forwarded to `caddy-ui-backend:3001/api/` with SSE support enabled (`proxy_buffering off`)

## Application Structure

The entire application lives in a single file: `src/App.jsx`. It is organized into the following components:

| Component         | Description                                                     |
|-------------------|-----------------------------------------------------------------|
| `App`             | Root component, manages tab state, status polling, and sidebar  |
| `Dashboard`       | Server status cards, server block list with custom name editing |
| `CaddyfileEditor` | Textarea editor with validate, format, sort, and save controls  |
| `RoutesManager`   | Sortable routes table with add and delete functionality         |
| `LogsViewer`      | Log config panel, live SSE log stream, and log viewer           |
| `RouteModal`      | Modal form for adding a new reverse proxy route                 |
| `Toasts`          | Fixed toast notification system                                 |

## Tabs

| Tab       | Route       | Description                             |
|-----------|-------------|-----------------------------------------|
| Dashboard | default     | Server status and server block overview |
| Caddyfile | `caddyfile` | Full Caddyfile editor                   |
| Routes    | `routes`    | Reverse proxy route manager             |
| Logs      | `logs`      | Access log viewer and log configuration |

## Updating

Since the image is built locally, updating is always:

```bash
docker build --no-cache -t caddy-ui-frontend .
```

Then redeploy your stack.

## Tags

| Tag      | Description              |
|----------|--------------------------|
| `latest` | Most recent stable build |
| `v1.1`   | Mobile responsive layout |
| `v1.0`   | Initial release          |
