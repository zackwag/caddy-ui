# AGENTS.md

Instructions for AI coding agents working in this repository. See [README.md](README.md) for product/architecture context and [CONTRIBUTING.md](CONTRIBUTING.md) for the human contributor workflow — this file adds agent-specific operating notes.

## Project shape

Two independently deployed services, each with its own `package.json`:

- `src/backend/` — Node.js (ES modules) + Express API on port 3001. Talks to Caddy's admin API, reads/writes the Caddyfile, tails logs, etc. Source in `src/backend/src/`, routes in `src/backend/src/routes/`, tests in `src/backend/test/`.
- `src/frontend/` — React 19 + Vite SPA on port 80 (nginx in prod, Vite dev server locally). Source in `src/frontend/src/`, components in `src/frontend/src/components/`.
- `dev/` — shared development package. `dev/dev-caddy/` owns disposable Caddy commands; `dev/integration/` owns real-service fixtures and Node scenarios; `dev/e2e/` adds Playwright/Vite browser scenarios; `dev/playground/` owns the localization preview and capture tools.
- `docs/` — mdBook content, theme and documentation-owned tooling.

The root `package.json` is the dependency-free command entry point. `src/backend`, `src/frontend`, `dev` and `docs` have separate manifests and lockfiles; there are no npm workspaces. Playwright belongs to `dev`; Vite is declared independently by its consumers. Dev lint borrows backend ESLint and frontend rule configuration, so it requires both application packages. Frontend playground tests currently also require the dev package; moving those tests is a separate follow-up.

## Commands

```bash
# From the repository root: install application and shared tooling dependencies.
npm ci --prefix src/backend
npm ci --prefix src/frontend
npm ci --prefix dev

# Backend
npm run dev --prefix src/backend   # node --watch src/index.js
npm test --prefix src/backend
npm run lint --prefix src/backend

# Frontend (run alongside the backend, in another terminal)
npm run dev --prefix src/frontend
npm run build --prefix src/frontend
npm test --prefix src/frontend    # Vitest + localization contract
npm run lint --prefix src/frontend -- --max-warnings=0

# Shared development tooling
npm run lint:dev-caddy
npm run test:dev-caddy              # harness/lifecycle/readiness tests, no Docker
npm run test:dev-caddy:integration  # real Caddy, backend API and startup scenarios
npm exec --prefix dev -- playwright install chromium
npm run test:dev-caddy:e2e          # isolated browser scenarios
npm run i18n:preview               # lightweight localization preview
```

Application lint stays with `src/backend/` and `src/frontend/`; `dev/eslint.config.js` applies shared rules to the relocated development tools, including browser code. Root commands delegate to their owning package. Lint also guards frontend user-facing literals; it doesn't enforce formatting, so match existing style by hand.

Integration infrastructure is limited to three support modules: `dev/integration/lifecycle.mjs` owns acquisition/cleanup, `dev/integration/stack.mjs` assembles Caddy and the backend, and `dev/e2e/fixture.mjs` adds Vite/Chromium. Keep UI actions and assertions in scenarios, and do not share mutable fixtures between browser tests. Run the affected root suite and `npm run lint:dev-caddy` when changing this infrastructure; browser files are covered by dev lint with Node and browser globals.

## Before finishing a task

- If you changed `src/backend/src/**`, run `cd src/backend && npm test && npm run lint` and make sure both are green.
- If you changed `src/frontend/src/**`, run `cd src/frontend && npm test && npm run lint`, and run the dev server to exercise the affected view in a browser. Don't claim a UI fix works without having rendered it — Vitest does not cover the full UI.
- Don't hand-edit `CHANGELOG.md` or bump versions — release-please generates both from Conventional Commit PR titles on `main`, so pick the prefix (`feat:` vs `fix:`, `!` for breaking) that matches the user-visible impact. The Changelog table in `docs/src/releases.md` is frozen history for pre-`v1.18` releases.

## Things to know before editing

- **`src/frontend/src/lib/caddyfileMode.js` is generated and gitignored.** It's fetched at dev/build time from the external [zackwag/caddyfile-codemirror](https://github.com/zackwag/caddyfile-codemirror) repo by `src/frontend/scripts/fetch-caddyfile-mode.mjs`. Never hand-edit it or assume it's present without running `npm run dev`/`npm run build` first (needs network access on first run).
- **The Caddyfile is the source of truth**, not a UI-owned config. Backend code that writes to it (`src/backend/src/caddy.js`, `src/backend/src/routes/caddyfile.js`) should preserve user content/formatting wherever the existing code already does — this is a deliberate design constraint of the product, not incidental behavior.
- **Authentication is required.** Persistent credentials live in `AUTH_PATH`; legacy environment credentials authorize enrollment only. Browser sessions use HttpOnly cookies and every write requires a session-bound CSRF token. Automated fixtures enroll isolated administrators; there is no authentication opt-out. Do not infer credential initialization from UI metadata or silently treat storage failures as fresh setup.
- **The backend Dockerfile bundles a Caddy binary** (`COPY --from=caddy:latest ...`) used by local-mode instances for `caddy fmt`, validation, and version detection (Docker mode runs the Caddy container's own binary) — it's expected to degrade gracefully if that binary is missing or mismatched, don't make it a hard dependency.
- Environment variables are documented in the [README's table](README.md#environment-variables) — keep it in sync if you add, rename, or remove one.

## Localization policy

- `src/frontend/src/i18n/locales/en.js` is the canonical key tree and fallback catalog. It must always exist.
- Non-English catalogs may be incomplete, but they must be schema subsets of `en.js` and every catalog must contain `test.languageLoaded`.
- **Do not generate, infer, autocomplete, or machine-translate non-English locale values.** This includes LLM/agentic translation, translation APIs, and bulk machine translation tools.
- Agents may edit English source strings and may perform explicitly requested mechanical key moves/renames while preserving existing human translations, but must not author translated text.
- A PR changing non-English locale values represents a human contributor's attestation that the translations are human-supplied or human-reviewed. Do not bypass that policy on a contributor's behalf.
- Run `cd src/frontend && npm run i18n:check` for catalog schema validation. The coverage graph is generated from the catalogs and is informational; incomplete locales are valid.
- Keep intentional technical string exceptions narrow. Never add a broad exception merely to silence a user-facing ASCII literal.
- The localization coverage graph is generated and ignored. Run `npm run i18n:coverage --prefix src/frontend` before a local book preview; the documentation workflow generates it automatically.
## Generated Docker Hub documentation

- Detailed documentation is authored in `docs/src/`, with navigation in `docs/src/SUMMARY.md`. Install documentation dependencies once with `npm ci --prefix docs --ignore-scripts`, then generate the coverage graph as above and build with `mdbook build docs`. Node.js runs the project-tree preprocessor; no separate project-tree preparation is needed. Persistent tree annotations live in `docs/project-structure-notes.json`. Mermaid is served locally from the pinned documentation dependency. Run `npm test --prefix docs` when changing documentation tooling. Environment variables, API endpoints, the Compose example, and Docker Hub source blocks remain canonical in `README.md` and are included by book pages using named anchors.

- **Never manually edit `src/backend/DOCKERHUB.md` or `src/frontend/DOCKERHUB.md`.** They are generated from the marked blocks in the canonical `README.md` by `.github/scripts/dockerhub-docs.mjs`; manual changes are overwritten on regeneration.
- Edit the source text and `dockerhub:both`, `dockerhub:backend`, or `dockerhub:frontend` routing markers in `README.md` instead. The leading README comment explains the marker rules. Output framing is maintained in the generator.
- Run `node .github/scripts/dockerhub-docs.mjs --dry-run` to validate, or omit `--dry-run` to regenerate the files locally. The Release Please workflow regenerates and commits them on the release PR branch before tagging.

## Style

ES modules throughout (`type: "module"` in package manifests), 4-space indentation, single quotes, semicolons. Follow the conventions of the file you're editing rather than introducing a new style locally.

## Commit / PR conventions

PR titles use Conventional Commit prefixes (`feat:`, `fix:`, `build:`, `test:`, …) — see `git log` for examples. CI (`.github/workflows/test.yml`) tests and lints both application packages and runs shared tooling lint, lifecycle safety, real-Caddy integration and Chromium scenarios through the root commands. Its aggregate `Test` check includes the integration job.
