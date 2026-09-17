# AGENTS.md

Instructions for AI coding agents working in this repository. See [README.md](README.md) for product/architecture context and [CONTRIBUTING.md](CONTRIBUTING.md) for the human contributor workflow — this file adds agent-specific operating notes.

## Project shape

Two independently deployed services, each with its own `package.json`:

- `backend/` — Node.js (ES modules) + Express API on port 3001. Talks to Caddy's admin API, reads/writes the Caddyfile, tails logs, etc. Source in `backend/src/`, routes in `backend/src/routes/`, tests in `backend/test/`.
- `frontend/` — React 19 + Vite SPA on port 80 (nginx in prod, Vite dev server locally). Source in `frontend/src/`, components in `frontend/src/components/`.

There is no shared root `package.json` — always `cd backend` or `cd frontend` before running npm commands.

## Commands

```bash
# Backend
cd backend && npm install
cd backend && npm run dev     # node --watch src/index.js
cd backend && npm test        # vitest run — the only automated test suite in this repo

# Frontend
cd frontend && npm install
cd frontend && npm run dev    # vite dev server (predev fetches caddyfileMode.js)
cd frontend && npm run build  # vite build (prebuild fetches caddyfileMode.js)
```

There is no frontend test suite and no repo-wide lint/format command. Don't invent one — match existing style by hand.

## Before finishing a task

- If you changed `backend/src/**`, run `cd backend && npm test` and make sure it's green.
- If you changed `frontend/src/**`, run the dev server and exercise the affected view in a browser. Don't claim a UI fix works without having rendered it — vitest doesn't cover the frontend.
- If you touched code that changes user-visible behavior, consider whether the [README Changelog table](README.md#changelog) needs a new row (this repo bumps a version string per notable change).

## Things to know before editing

- **`frontend/src/lib/caddyfileMode.js` is generated and gitignored.** It's fetched at dev/build time from the external [zackwag/caddyfile-codemirror](https://github.com/zackwag/caddyfile-codemirror) repo by `frontend/scripts/fetch-caddyfile-mode.mjs`. Never hand-edit it or assume it's present without running `npm run dev`/`npm run build` first (needs network access on first run).
- **The Caddyfile is the source of truth**, not a UI-owned config. Backend code that writes to it (`backend/src/caddy.js`, `backend/src/routes/caddyfile.js`) should preserve user content/formatting wherever the existing code already does — this is a deliberate design constraint of the product, not incidental behavior.
- **Auth is optional and env-driven.** `CADDY_UI_USER`/`CADDY_UI_PASSWORD`/`JWT_SECRET` unset means auth is disabled entirely (see `backend/src/middleware/auth.js`). Don't add code paths that assume auth is always on.
- **The backend Dockerfile pins a Caddy binary** (`COPY --from=caddy:vX.Y.Z ...`) used for `caddy fmt` and version detection — it's expected to degrade gracefully if that binary is missing or mismatched, don't make it a hard dependency.
- Environment variables are documented in the [README's table](README.md#environment-variables) — keep it in sync if you add, rename, or remove one.

## Style

ES modules throughout (`type: "module"` in both `package.json`s), 4-space indentation, single quotes, semicolons. Follow the conventions of the file you're editing rather than introducing a new style locally.

## Commit / PR conventions

PR titles use Conventional Commit prefixes (`feat:`, `fix:`, `build:`, `test:`, …) — see `git log` for examples. CI (`.github/workflows/test.yml`) runs `npm test` in `backend/` on every PR to `main`; nothing currently gates on the frontend.
