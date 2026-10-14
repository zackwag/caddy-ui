# AGENTS.md

Instructions for AI coding agents working in this repository. See [README.md](README.md) for product/architecture context and [CONTRIBUTING.md](CONTRIBUTING.md) for the human contributor workflow — this file adds agent-specific operating notes.

## Project shape

Two independently deployed services, each with its own `package.json`:

- `backend/` — Node.js (ES modules) + Express API on port 3001. Talks to Caddy's admin API, reads/writes the Caddyfile, tails logs, etc. Source in `backend/src/`, routes in `backend/src/routes/`, tests in `backend/test/`.
- `frontend/` — React 19 + Vite SPA on port 80 (nginx in prod, Vite dev server locally). Source in `frontend/src/`, components in `frontend/src/components/`.
- `test/integration/` — disposable Caddy/backend fixtures and Node integration scenarios. `frontend/e2e/` adds Playwright/Vite fixtures and browser scenarios. Development commands stay in `scripts/dev-caddy/`; tests reuse its Docker harness.

The root `package.json` contains dependency-free development harness commands (`dev:with-caddy`, `dev:instances`, `test:dev-caddy`). Application commands still run in `backend` or `frontend`.

## Commands

```bash
# Backend
cd backend && npm install
cd backend && npm run dev     # node --watch src/index.js
cd backend && npm test        # vitest run — backend unit and API contract tests
cd backend && npm run lint    # eslint .

# Frontend
cd frontend && npm install
cd frontend && npm run dev    # vite dev server (predev fetches caddyfileMode.js)
cd frontend && npm run build  # vite build (prebuild fetches caddyfileMode.js)
cd frontend && npm run lint   # eslint .
cd frontend && npm test       # vitest + localization contract

# Disposable integration fixtures (from the repository root)
npm run test:dev-caddy              # harness/lifecycle/readiness tests, no Docker
npm run test:dev-caddy:integration  # real Caddy, backend API and startup scenarios
npm run test:dev-caddy:e2e          # isolated browser scenarios; suite prepares editor mode once
```

There is no repo-wide lint/format command — `backend/` and `frontend/` each have their own ESLint config (`eslint.config.js`), run separately. Lint also guards frontend user-facing literals; it doesn't enforce formatting, so match existing style by hand.

Integration infrastructure is limited to three support modules: `test/integration/lifecycle.mjs` owns acquisition/cleanup, `test/integration/stack.mjs` assembles Caddy and the backend, and `frontend/e2e/fixture.mjs` adds Vite/Chromium. Keep UI actions and assertions in scenarios, and do not share mutable fixtures between browser tests. Run the affected root suite and `npm run lint:dev-caddy` when changing this infrastructure; browser files also use frontend lint.

## Before finishing a task

- If you changed `backend/src/**`, run `cd backend && npm test && npm run lint` and make sure both are green.
- If you changed `frontend/src/**`, run `cd frontend && npm test && npm run lint`, and run the dev server to exercise the affected view in a browser. Don't claim a UI fix works without having rendered it — Vitest does not cover the full UI.
- Don't hand-edit `CHANGELOG.md` or bump versions — release-please generates both from Conventional Commit PR titles on `main`, so pick the prefix (`feat:` vs `fix:`, `!` for breaking) that matches the user-visible impact. The Changelog table in `docs/src/releases.md` is frozen history for pre-`v1.18` releases.

## Things to know before editing

- **`frontend/src/lib/caddyfileMode.js` is generated and gitignored.** It's fetched at dev/build time from the external [zackwag/caddyfile-codemirror](https://github.com/zackwag/caddyfile-codemirror) repo by `frontend/scripts/fetch-caddyfile-mode.mjs`. Never hand-edit it or assume it's present without running `npm run dev`/`npm run build` first (needs network access on first run).
- **The Caddyfile is the source of truth**, not a UI-owned config. Backend code that writes to it (`backend/src/caddy.js`, `backend/src/routes/caddyfile.js`) should preserve user content/formatting wherever the existing code already does — this is a deliberate design constraint of the product, not incidental behavior.
- **Auth is optional and env-driven.** `CADDY_UI_USER`/`CADDY_UI_PASSWORD`/`JWT_SECRET` unset means auth is disabled entirely (see `backend/src/middleware/auth.js`). Don't add code paths that assume auth is always on.
- **The backend Dockerfile bundles a Caddy binary** (`COPY --from=caddy:latest ...`) used by local-mode instances for `caddy fmt`, validation, and version detection (Docker mode runs the Caddy container's own binary) — it's expected to degrade gracefully if that binary is missing or mismatched, don't make it a hard dependency.
- Environment variables are documented in the [README's table](README.md#environment-variables) — keep it in sync if you add, rename, or remove one.

## Localization policy

- `frontend/src/i18n/locales/en.js` is the canonical key tree and fallback catalog. It must always exist.
- Non-English catalogs may be incomplete, but they must be schema subsets of `en.js` and every catalog must contain `test.languageLoaded`.
- **Do not generate, infer, autocomplete, or machine-translate non-English locale values.** This includes LLM/agentic translation, translation APIs, and bulk machine translation tools.
- Agents may edit English source strings and may perform explicitly requested mechanical key moves/renames while preserving existing human translations, but must not author translated text.
- A PR changing non-English locale values represents a human contributor's attestation that the translations are human-supplied or human-reviewed. Do not bypass that policy on a contributor's behalf.
- Run `cd frontend && npm run i18n:check` for catalog schema validation. The coverage graph is generated from the catalogs and is informational; incomplete locales are valid.
- Keep intentional technical string exceptions narrow. Never add a broad exception merely to silence a user-facing ASCII literal.
## Generated Docker Hub documentation

- Detailed documentation is authored in `docs/src/`, with navigation in `docs/src/SUMMARY.md`. Install documentation dependencies once with `npm ci --prefix docs --ignore-scripts`, then build directly with `mdbook build docs`; no preparation script is needed. Node.js runs the project-tree preprocessor. Persistent tree annotations live in `docs/project-structure-notes.json`. Mermaid is served locally from the pinned documentation dependency. Run `npm test --prefix docs` when changing documentation tooling. Environment variables, API endpoints, the Compose example, and Docker Hub source blocks remain canonical in `README.md` and are included by book pages using named anchors.

- **Never manually edit `backend/DOCKERHUB.md` or `frontend/DOCKERHUB.md`.** They are generated from the marked blocks in the canonical `README.md` by `.github/scripts/dockerhub-docs.mjs`; manual changes are overwritten on regeneration.
- Edit the source text and `dockerhub:both`, `dockerhub:backend`, or `dockerhub:frontend` routing markers in `README.md` instead. The leading README comment explains the marker rules. Output framing is maintained in the generator.
- Run `node .github/scripts/dockerhub-docs.mjs --dry-run` to validate, or omit `--dry-run` to regenerate the files locally. The Release Please workflow regenerates and commits them on the release PR branch before tagging.

## Style

ES modules throughout (`type: "module"` in both `package.json`s), 4-space indentation, single quotes, semicolons. Follow the conventions of the file you're editing rather than introducing a new style locally.

## Commit / PR conventions

PR titles use Conventional Commit prefixes (`feat:`, `fix:`, `build:`, `test:`, …) — see `git log` for examples. CI (`.github/workflows/test.yml`) runs `npm test` in `backend/`, plus `npm run lint` in both `backend/` and `frontend/`, on every PR to `main`.
