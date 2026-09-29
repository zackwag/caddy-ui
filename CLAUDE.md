# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The imported AGENTS.md covers commands, pre-finish checks, editing constraints, style, and PR conventions. This file adds what you need to understand the architecture.

## Running a single backend test

```bash
cd backend && npx vitest run test/routes.test.js      # one file
cd backend && npx vitest run -t "parses a single site block"   # by test name
```

Tests cover pure logic only. Route modules export their helpers next to the default router (e.g. `export { parseSiteBlocks, sortCaddyfile }` in `routes/caddyfile.js`), and tests import those directly. Nothing spins up Express or talks to Caddy/Docker. To make new logic testable, follow the same pattern: write a pure function and add it to the module's named exports.

## Backend architecture

### Request pipeline (`backend/src/index.js`)

Order matters. Rate limit on `/api`, then these stages:
1. `/api/auth/*` and `GET /api/version`: public.
2. `/api/instances`, `/api/settings`, `/api/custom-themes`: auth only. **No instance middleware**, because these must work when zero instances exist.
3. `instanceMiddleware` on everything else. It resolves `X-Instance-Id` (defaulting to `'default'`, then falling back to the first instance) into a validated `req.instance` = `{ id, name, adminUrl, configPath, logPath, dataPath, containerName, serverName }`. It returns `503 { code: 'NO_INSTANCES' }` when none are configured, and the frontend uses that to redirect to the Instances page.
4. `/api/metrics/raw`: auth is skipped when `CADDY_UI_PUBLIC_METRICS=true`.
5. `authMiddleware`, then the feature routers.

Route handlers should always use `req.instance.*`, not the `CADDY_*` env vars. The env vars only seed the bootstrap `default` instance in `instances.js`, and only when no `instances.json` exists.

### Docker mode vs local mode

Each instance is either Docker mode (`containerName` set: file operations and `caddy` commands run through `docker exec` against that container) or local mode (`containerName` empty: direct filesystem access plus the bundled `caddy` binary). This split is centralized:
- `containerFs.js`: `readContainerFile` / `writeContainerFile` / `listContainerDir` / `removeContainerPath` / `containerPathExists`
- `docker.js`: `execInInstance` (collect output), `spawnInInstance` (streaming, e.g. `tail -f` for SSE logs), `getCaddyEnv` (cached `env` of the container)

New code that touches Caddy's files or runs `caddy` should go through these helpers and pass `req.instance.containerName`. Don't call `fs` or `spawn` directly. Everything uses `spawn` with array args and `shell: false`, and `docker.js` asserts on command names and path args (no `..`, NUL, or newlines). Keep it that way. Don't build shell strings: the `adaptViaCaddyBinary` comment explains why.

### Talking to Caddy

`caddy.js` wraps the admin API (`caddyGet/Put/Post/Patch/Delete`, `caddyLoad` → `POST /load` with `text/caddyfile`). It uses a 10s timeout and always sends `Origin: http://0.0.0.0:2019`, which Caddy's admin origin check requires.

### Caddyfile write flow (`routes/caddyfile.js` `PUT /`)

The save runs these steps in order:
1. Validate. Tries `POST /adapt` on the admin API first, then falls back to `caddy adapt` on a temp file written *next to* the real Caddyfile so relative `import`s resolve. It rethrows the admin error if Docker is unreachable (`isDockerUnavailable`).
2. Snapshot the current file into `HISTORY_PATH` (per-instance subdirectory for non-default instances, 20 kept).
3. `caddy fmt` (optional). Its failure is non-fatal inside `fmtCaddyfile`.
4. `sortCaddyfile` (optional).
5. Write the file.
6. Reload via `caddyLoad`, falling back to `caddy reload`.
7. **Roll back the file if the reload fails**, unless it was a force save (`?validate=false`).

Route edits in `routes/routes.js` work differently. They splice individual site blocks (`extractSiteBlock` / `replaceSiteBlock` / `removeSiteBlock`, matched against env-resolved `{$VAR}` site addresses), write, and `caddyLoad`. This is the path where preserving the user's surrounding Caddyfile content matters most.

The Routes view lists routes from the **live admin API config** (`/config/apps/http/servers`), not from parsing the Caddyfile. Caddyfile parsing supplies the extras: titles, site-block edits, and delete.

### Persistent state

State lives in JSON files under `/etc/caddy-ui/`, each with its own env var: instances, settings, route notes, server names, notifications, uptime history, and Caddyfile history. Every module keeps an in-memory copy and serializes writes through a `_writeLock` promise chain. Match this pattern for new stores.

### Background work started at boot

- `upstreamMonitor.js` `startUpstreamMonitor()`: every 30s it checks upstreams across **all** instances and records the results into `uptimeHistory.js`, so history doesn't depend on a browser polling `GET /api/health`. `uptimeHistory.js` flushes to disk every 60s and supplies the Routes uptime % and the per-route status history. The check logic itself (pool API with TCP fallback) is in `upstreamChecks.js`, shared with `routes/health.js` and the notifier.
- `notifications.js` `initMonitor()`: a separate loop that runs only while notifications are enabled, and starts or stops when that setting changes. It checks upstreams and TLS expiry per instance and sends ntfy/Discord/Slack/Pushover/webhook alerts with debounce. Webhook URLs are checked against private/unsafe IPs before sending.
- `customThemes.js` `loadCustomThemes()`: scans `THEMES_PATH/{dark,light}/*.json` once at startup, validates each file against `REQUIRED_VARS`, and serves the results at `/api/custom-themes`.
- `caddyfileTitles.js` `initCaddyfileTitles()`: decides once at startup whether route titles live as the first `#` comment in a site block or in `route-notes.json` (`CADDYFILE_TITLES`, auto-detected from whether notes exist). Then `cleanupOrphanedNotes()` runs.

## Frontend architecture

- **API client (`utils/api.js`)**: all calls go through `apiFetch`. It prefixes `/api`, attaches the JWT from `localStorage` and `X-Instance-Id` (the selected instance, also in `localStorage`), clears the token and calls `onUnauth` on 401, and surfaces `NO_INSTANCES` as `err.code`. New backend calls should use it rather than raw `fetch`.
- **Proxying**: `/api` is proxied to `caddy-ui-backend:3001` by `nginx.conf` in production and to `localhost:3001` by `vite.config.js` in dev, so run the backend alongside `npm run dev`.
- **App shell (`App.jsx`)**: owns auth state, the instance selection, and server-side settings (theme palettes, route column visibility), and passes them down as props. It uses React Router for URL-based navigation. Views read query params for deep links (e.g. `/routes?filter=srv0`). Switching instances bumps a key that remounts the views so they refetch.
- **Styling (`styles.js`)**: one CSS-in-JS string plus `THEME_LIST`. Every color is a CSS variable defined per palette. `App.jsx` merges `THEME_LIST` with the custom themes from the backend. Add a built-in theme by adding a `THEME_LIST` entry, and never hardcode colors in components; the CodeMirror editors read the same variables. If you add a new CSS variable, add it to every built-in theme *and* to `REQUIRED_VARS` in `backend/src/customThemes.js`. Check both a dark and a light palette when you change styling.
- **Caddyfile editor**: CodeMirror 6 with the generated `lib/caddyfileMode.js` (see AGENTS.md: fetched from upstream `main` at dev/build time and gitignored). `frontend/caddyfile-mode.sha` is only a tracked marker of the last upstream blob SHA. `sync-caddyfile-vocab.yml` bumps it so that vocabulary changes trigger a release. It is not a pin.

## Releases

Releases are cut by release-please (`release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md`) from Conventional Commit titles on `main`. `release.yml`, `beta.yml`, and `edge.yml` build and push the two Docker Hub images, and `APP_VERSION` is baked in at build time.

---

_Created using Anthropic Claude._
