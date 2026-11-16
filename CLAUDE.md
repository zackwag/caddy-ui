# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The imported AGENTS.md covers commands, pre-finish checks, editing constraints, style, and PR conventions. This file adds what you need to understand the architecture.

## Running a single backend test

```bash
cd src/backend && npx vitest run test/routes.test.js      # one file
cd src/backend && npx vitest run -t "parses a single site block"   # by test name
```

Backend package tests cover helpers and HTTP contracts using isolated servers or mocks. Route modules export helpers next to their default router so pure logic can be tested directly. Real-Caddy scenarios live under `dev/integration/`; browser scenarios live under `dev/e2e/`. Keep UI actions and assertions in scenarios rather than shared fixtures.

## Backend architecture

### Request pipeline (`src/backend/src/index.js`)

Order matters. Rate limit on `/api`, then these stages:
1. `/api/auth/*` and `GET /api/version`: public.
2. `/api/instances`, `/api/settings`, `/api/custom-themes`, `/api/logs/app`: auth only. **No instance middleware**, because these must work when zero instances exist.
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

State lives in JSON files under `/etc/caddy-ui/`, each with its own env var: instances, settings, route notes, server names, notifications, uptime history, and Caddyfile history. Stores are built on `jsonFile.js`: `createJsonStore` keeps the in-memory copy, serializes `update`s through a queue, writes atomically (temp file + rename), publishes the new state only after the write succeeds, and sets aside an unparseable file instead of overwriting it with defaults. Use it for new stores rather than hand-rolling `fs` writes.

### Background work started at boot

- `monitoring.js` `startMonitoring()`: the only recorder of uptime history. Each probe in `PROBES` runs on its own interval across **all** instances: upstreams every 30s (pool API with TCP fallback, in `upstreamChecks.js`), and routes every 5 min while route checks are enabled (`routeChecks.js`, which sends real requests through Caddy). Results go into `uptimeHistory.js` (flushed every 60s; supplies the Routes uptime % and per-route status history), so history doesn't depend on a browser polling `GET /api/health`. Listeners registered with `onCheckResults` get each round.
- `notifications.js` `initNotifications()`: subscribes to monitor rounds (`notifyCheckResults`) and authentication events (`authEvents.js` `onAuthenticationEvent`), so it never probes anything itself. Transitions are tracked while notifications are off, so enabling them doesn't replay an old change. Reminders (certificate expiry via `certificates.js`, update availability, API token expiry) run every 5 min only while notifications are enabled. Configuration lives in `notificationConfig.js`, and provider requests in `notificationDelivery.js`. Webhook URLs are checked against private/unsafe IPs before sending.
- Instance removal: `instances.js` `onInstanceRemoved` listeners, wired in `index.js`, release that instance's notifications, checks, drift state, server names, maintenance and route notes.
- `customThemes.js` `loadCustomThemes()`: scans `THEMES_PATH/{dark,light}/*.json` once at startup, validates each file against `REQUIRED_VARS`, and serves the results at `/api/custom-themes`.
- `caddyfileTitles.js` `initCaddyfileTitles()`: decides once at startup whether route titles live as the first `#` comment in a site block or in `route-notes.json` (`CADDYFILE_TITLES`, auto-detected from whether notes exist). Then `cleanupOrphanedNotes()` runs.

## Frontend architecture

- **API client (`utils/api.js`)**: all calls go through `apiFetch`. It prefixes `/api`, attaches the JWT from `localStorage` and `X-Instance-Id` (the selected instance, also in `localStorage`), clears the token and calls `onUnauth` on 401, and surfaces `NO_INSTANCES` as `err.code`. New backend calls should use it rather than raw `fetch`.
- **Proxying**: `/api` is proxied to `caddy-ui-backend:3001` by `nginx.conf` in production and to `localhost:3001` by `vite.config.js` in dev, so run the backend alongside `npm run dev`.
- **App shell (`App.jsx`)**: owns auth state, the instance selection, and server-side settings (theme palettes, route column visibility), and passes them down as props. It uses React Router for URL-based navigation. Views read query params for deep links (e.g. `/routes?filter=srv0`). Switching instances bumps a key that remounts the views so they refetch.
- **Styling (`styles.js`)**: one CSS-in-JS string plus `THEME_LIST`. Every color is a CSS variable defined per palette. `App.jsx` merges `THEME_LIST` with the custom themes from the backend. Add a built-in theme by adding a `THEME_LIST` entry, and never hardcode colors in components; the CodeMirror editors read the same variables. If you add a new CSS variable, add it to every built-in theme *and* to `REQUIRED_VARS` in `src/backend/src/customThemes.js`. Check both a dark and a light palette when you change styling.
- **Caddyfile editor**: CodeMirror 6 with the generated `lib/caddyfileMode.js` (see AGENTS.md: fetched from upstream `main` at dev/build time and gitignored). `src/frontend/caddyfile-mode.sha` is only a tracked marker of the last upstream blob SHA. `sync-caddyfile-vocab.yml` bumps it so that vocabulary changes trigger a release. It is not a pin.

## Releases

Releases are cut by release-please (`release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md`) from Conventional Commit titles on `main`. `release.yml`, `beta.yml`, and `edge.yml` build and push the two Docker Hub images, and `APP_VERSION` is baked in at build time.

---

_Created using Anthropic Claude._
