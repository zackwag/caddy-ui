# Contributing to caddy/ui

Thanks for considering a contribution. This project is a two-service app (Node/Express backend, React/Vite frontend) that manages a Caddy server through its admin API — see the [README](README.md) for the full architecture overview.

## Getting set up

You don't need Docker for day-to-day development, but you do need a Caddy instance with its admin API reachable (`CADDY_ADMIN_URL`, default `http://caddy:2019`) for the backend to talk to.

### Backend

```bash
cd backend
npm install
npm run dev   # node --watch src/index.js, listens on :3001 by default
```

Relevant environment variables are documented in the [README's Environment Variables table](README.md#environment-variables). Most have safe local defaults.

### Frontend

```bash
cd frontend
npm install
npm run dev   # vite dev server
```

The `predev`/`prebuild` scripts fetch `src/lib/caddyfileMode.js` (the generated CodeMirror Caddyfile grammar) from [zackwag/caddyfile-codemirror](https://github.com/zackwag/caddyfile-codemirror) — that file is gitignored, not vendored. Run `npm run dev` or `npm run build` at least once with network access before working offline; after that the fetch script falls back to the local copy.

## Tests

Backend tests use [Vitest](https://vitest.dev/) and cover pure logic (Caddyfile parsing, formatting, validation, etc.):

```bash
cd backend
npm test
```

CI runs this, plus `npm run lint` in both `backend/` and `frontend/`, on every PR against `main` (`.github/workflows/test.yml`). There is currently no frontend test suite — verify UI changes by running the app (see below).

## Verifying UI changes

For anything touching `frontend/`, run the dev server and click through the affected view(s) in a browser before opening a PR — type-checking and the backend test suite don't cover rendering or interaction correctness. Check both the dark and light themes if you touched styling.

## Code style

- Match the existing style in the file you're editing: ES modules, 4-space indentation, single quotes, semicolons.
- Both `backend/` and `frontend/` have an ESLint config (`npm run lint` in each) that CI runs on every PR (`.github/workflows/test.yml`). It only checks for correctness issues (unused vars, React hook rules, etc.) — it doesn't enforce formatting, so consistency with surrounding code is still the bar for style.
- Keep changes scoped — avoid drive-by refactors in unrelated files.

## Commit messages / PR titles

This repo loosely follows [Conventional Commits](https://www.conventionalcommits.org/) prefixes in PR titles (squash-merged), e.g.:

- `feat: ...` — new functionality
- `fix: ...` — bug fixes
- `build: ...` — build/CI/dependency changes
- `test: ...` — test-only changes

Look at `git log` for more examples of the house style.

## Opening a PR

1. Branch off `main`.
2. Keep the diff focused on one change.
3. Make sure `npm test` passes in `backend/` if you touched backend code, and `npm run lint` passes in `backend/`/`frontend/` for whichever side you touched.
4. If your change is user-facing, consider adding a line to the [Changelog table](README.md#changelog) in the same PR (bump the version per the project's existing numbering).
5. Open the PR against `main` — the `Test` workflow will run automatically.

## Reporting issues

Open a GitHub issue with steps to reproduce, your `caddy-ui` version (`GET /api/version` or the sidebar), and relevant logs (`LOG_LEVEL=debug` on the backend gives more detail). Stale issues without activity are auto-closed by `.github/workflows/stale.yml`, so keep threads updated if you're still waiting on something.
