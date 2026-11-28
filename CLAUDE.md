# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The imported AGENTS.md covers commands, pre-finish checks, editing constraints, style, and PR conventions. This file adds what you need to understand the architecture.

## Running a single backend test

```bash
cd src/backend && npx vitest run test/routes.test.js      # one file
cd src/backend && npx vitest run -t "parses a single site block"   # by test name
```

Backend package tests cover helpers and HTTP contracts using isolated servers or mocks. Route modules only translate HTTP; the logic they call lives in its own module and is tested there. HTTP tests mount routers with `test/fixtures/server.mjs` `serve()`, which adds the app's body parsing, diagnostics and error handler. Real-Caddy scenarios live under `dev/integration/`; browser scenarios live under `dev/e2e/`. Keep UI actions and assertions in scenarios rather than shared fixtures.

## Backend architecture

### Request pipeline (`src/backend/src/index.js`)

Order matters. Rate limit on `/api`, then these stages:
1. `/api/auth/*` and `GET /api/version`: public.
2. `/api/instances`, `/api/settings`, `/api/custom-themes`, `/api/logs/app`: auth only. **No instance middleware**, because these must work when zero instances exist.
3. `instanceMiddleware` on everything else. It resolves `X-Instance-Id`, or `?instance=` for requests a browser makes without headers (event streams, downloads), (defaulting to `'default'`, then falling back to the first instance) into `req.instance`, an `instances.js` instance: `{ id, name, adminUrl, configPath, logPath, dataPath, containerName, serverName }`, validated and normalized when instances are loaded or saved, so requests and background work see the same form. It throws `NO_INSTANCES` (503) when none are configured, and the frontend uses that to redirect to the Instances page.
4. `GET /api/metrics` and `/api/metrics/raw`: auth is skipped when `CADDY_UI_PUBLIC_METRICS=true`. That policy lives only in `index.js`.
5. `authMiddleware`, then the feature routers. It attaches `req.actor`, which history and the audit log record.

Routes throw rather than respond to failures: `errorReporting.js` `errorHandler` turns an `AppError` into its registered status and public fields, and anything else into a 500. A response is a failure when it carries an `AppError` (`sendAppError`, or `sendFailure` for the few endpoints that report one in a 200), so diagnostics log it with its causes. Administrative actions that don't change the Caddyfile go through `auditLog.js` `audited(req, event, operation)`.

Route handlers should always use `req.instance.*`, not the `CADDY_*` env vars. The env vars only seed the bootstrap `default` instance in `instances.js`, and only when no `instances.json` exists.

### Docker mode vs local mode

Each instance is either Docker mode (`containerName` set: file operations and `caddy` commands run through `docker exec` against that container) or local mode (`containerName` empty: direct filesystem access plus the bundled `caddy` binary). This split is centralized:
- `containerFs.js`: `readContainerFile` / `writeContainerFile` / `listContainerDir` / `removeContainerPath` / `containerPathExists`
- `docker.js`: `execInInstance` (collect output), `spawnInInstance` (streaming, e.g. `tail -f` for SSE logs), `getCaddyEnv` (cached `env` of the container)

New code that touches Caddy's files or runs `caddy` should go through these helpers and pass `req.instance.containerName`. Don't call `fs` or `spawn` directly. Everything uses `spawn` with array args and `shell: false`, and `docker.js` asserts on command names and path args (no `..`, NUL, or newlines). Keep it that way. Don't build shell strings: the `adaptViaCaddyBinary` comment explains why.

### Talking to Caddy

`caddy.js` makes every admin API request: `caddyGet/Put/Post/Patch/Delete`, `caddyLoad` → `POST /load` with `text/caddyfile`, and reads such as `caddyMetrics`, `caddyLocalRootCertificate`, `caddyUpstreamPool` and `isCaddyOnline`. It applies a deadline, resends a read once when Caddy closes an idle connection, and always sends `Origin: http://0.0.0.0:2019`, which Caddy's admin origin check requires. Don't `fetch` the admin API elsewhere. `prometheus.js` parses and writes metrics text; `caddyMetrics.js` summarizes Caddy's.

### Caddyfile write flow

Every change to an instance's Caddyfile goes through `caddyfileChange.js` (`saveCaddyfileChange`, or `queueCaddyfileChange` when the change depends on state read inside the instance's queue). `caddyfileRuntime.js` asks Caddy to validate, format, load and adapt, through the admin API first and then the instance's `caddy` binary. The editor's save (`routes/caddyfile.js` `PUT /`) runs these steps in order:
1. Validate. Tries `POST /adapt` on the admin API first, then falls back to `caddy adapt` on a temp file written *next to* the real Caddyfile so relative `import`s resolve. It rethrows the admin error when the binary can't run at all.
2. Snapshot the current file into `HISTORY_PATH` (per-instance subdirectory for non-default instances, 20 kept).
3. `caddy fmt` (optional). Its failure is non-fatal inside `fmtCaddyfile`.
4. `caddyfileSort.js` `sortCaddyfile` (optional).
5. Write the file.
6. Reload via `caddyLoad`, falling back to `caddy reload`, then read both the file and the running config back (`configVerification.js`).
7. **Roll back the file if the reload fails**, unless it was a force save (`?validate=false`).

Route edits work differently. They splice individual site blocks (`caddyfileSites.js` `extractSiteBlock` / `replaceSiteBlock` / `removeSiteBlock`, matched by `caddyfileBlocks.js` `siteDomain` against env-resolved `{$VAR}` site addresses) and save the result. UI-managed routes also change the running config through the admin API, passing that `live` change in place of the reload. `reverseProxyRoute.js` builds both forms of such a route. Global options are edited with `caddyfileGlobals.js` `setGlobalOption`, in the file's own style (`caddyfileLogging.js`, `caddyfileMetrics.js`). This is the path where preserving the user's surrounding Caddyfile content matters most.

The Routes view lists routes from the **live admin API config** (`/config/apps/http/servers`), not from parsing the Caddyfile. Caddyfile parsing supplies the extras: titles, site-block edits, and delete.

### Persistent state

State lives in JSON files under `/etc/caddy-ui/`, each with its own env var: instances, settings, route notes, server names, notifications, uptime history, and Caddyfile history. Stores are built on `jsonFile.js`: `createJsonStore` keeps the in-memory copy, serializes `update`s through a queue, writes atomically (temp file + rename), publishes the new state only after the write succeeds, and sets aside an unparseable file instead of overwriting it with defaults. Use it for new stores rather than hand-rolling `fs` writes.

### Background work started at boot

- `monitoring.js` `startMonitoring()`: the only recorder of uptime history. Each probe in `PROBES` runs on its own interval across **all** instances: upstreams every 30s (pool API with TCP fallback, in `upstreamChecks.js`), and routes every 5 min while route checks are enabled (`routeChecks.js`, which sends real requests through Caddy). Results go into `uptimeHistory.js` (flushed every 60s; supplies the Routes uptime % and per-route status history), so history doesn't depend on a browser polling `GET /api/health`. Listeners registered with `onCheckResults` get each round.
- `notifications.js` `initNotifications()`: subscribes to monitor rounds (`notifyCheckResults`) and authentication events (`authEvents.js` `onAuthenticationEvent`), so it never probes anything itself. Transitions are tracked while notifications are off, so enabling them doesn't replay an old change. Reminders (certificate expiry via `certificates.js`, update availability, API token expiry) run every 5 min only while notifications are enabled. Producers send an event id and its variables; `notificationEvents.js` owns each event's trigger, variables and default wording, and renders it. Configuration lives in `notificationConfig.js`, and provider requests in `notificationDelivery.js`. Webhook URLs are checked against private/unsafe IPs before sending.
- Instance removal: `instances.js` `onInstanceRemoved` listeners, wired in `index.js`, release that instance's notifications, checks, drift state, server names, maintenance and route notes.
- `customThemes.js` `loadCustomThemes()`: scans `THEMES_PATH/{dark,light}/*.json` once at startup, validates each file against `REQUIRED_VARS`, and serves the results at `/api/custom-themes`.
- `caddyfileTitles.js` `initCaddyfileTitles()`: decides once at startup whether route titles live as the first `#` comment in a site block or in `route-notes.json` (`CADDYFILE_TITLES`, auto-detected from whether notes exist). Then `cleanupOrphanedNotes()` runs.

## Frontend architecture

- **API client (`utils/api.js`)**: all calls go through `apiFetch`. It prefixes `/api`, sends the session cookie, a CSRF token on writes, `X-Instance-Id` (the selected instance, in `localStorage`) and a `json` option's body, tells `onUnauthorized` listeners about a 401, and surfaces codes such as `NO_INSTANCES` as `err.code`. Requests the browser makes itself (event streams, downloads) use `instanceUrl(path)`. New backend calls should use it rather than raw `fetch`.
- **Feedback (`components/Toasts.jsx`, `utils/toast.js`)**: `toast.error(error)` localizes the error itself, `toast.saved(result, message)` reports a saved change's warning, and `toast.track(scope, request, { signal })` reports a view that can't load once per instance until it recovers; once `signal` aborts (the view closed, or a newer load replaced it) it reports nothing. `usePoll` and `useLoad` own that signal for polled and one-shot loads. `toast` keeps its identity, so effects can depend on it. Inline errors render with `ErrorNote`.
- **Shared UI**: `Modal`, `Select`, `ThemeSelect`, `CaddyfileEditor`, `SearchInput`, `ConfigCard`, `LoginCard`, `NewPassword`, and the `useFetch` and `useSort` hooks. Route status, wherever it's shown, comes from `utils/routes.js` `getRouteStatus`.
- **Proxying**: `/api` is proxied to `caddy-ui-backend:3001` by `nginx.conf` in production and to `localhost:3001` by `vite.config.js` in dev, so run the backend alongside `npm run dev`.
- **App shell (`App.jsx`)**: owns auth state, the instance selection, and server-side settings (`settings` plus `updateSettings(patch)`), and passes them down as props. Pages are listed once in `views.js`, which the router, titles, sidebar and no-instance redirect read. It uses React Router for URL-based navigation. Views read query params for deep links (e.g. `/routes?filter=srv0`). Switching instances bumps a key that remounts the views so they refetch.
- **Styling (`styles.js`)**: one CSS-in-JS string plus `THEME_LIST`. Every color is a CSS variable defined per palette. `App.jsx` merges `THEME_LIST` with the custom themes from the backend. Add a built-in theme by adding a `THEME_LIST` entry, and never hardcode colors in components; the CodeMirror editors read the same variables. If you add a new CSS variable, add it to every built-in theme *and* to `REQUIRED_VARS` in `src/backend/src/customThemes.js`. Check both a dark and a light palette when you change styling.
- **Caddyfile editor**: CodeMirror 6 with the generated `lib/caddyfileMode.js` (see AGENTS.md: fetched from upstream `main` at dev/build time and gitignored). `src/frontend/caddyfile-mode.sha` is only a tracked marker of the last upstream blob SHA. `sync-caddyfile-vocab.yml` bumps it so that vocabulary changes trigger a release. It is not a pin.

## Releases

Releases are cut by release-please (`release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md`) from Conventional Commit titles on `main`. `release.yml`, `beta.yml`, and `edge.yml` build and push the two Docker Hub images, and `APP_VERSION` is baked in at build time.

---

_Created using Anthropic Claude._
