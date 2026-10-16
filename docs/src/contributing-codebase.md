# Contributing to the codebase

This project has two application services: a Node/Express backend and a React/Vite
frontend. The backend manages Caddy through its admin API and Docker or local file
access. See the [architecture guide](architecture.md) for the runtime request flow.

## Repository responsibilities

| Location | Owns |
| --- | --- |
| `src/backend/` | Backend source, unit/API tests, package dependencies and Dockerfile |
| `src/frontend/` | Frontend source, component tests, build scripts and Dockerfile |
| `dev/dev-caddy/` | Disposable Caddy lifecycle commands and ownership checks |
| `dev/integration/` | Real-service fixtures, scenarios and lifecycle/readiness tests |
| `dev/e2e/` | Browser fixtures and scenarios |
| `dev/playground/` | Localization preview, captured responses and capture tools |
| `docs/` | Book content, theme and documentation tooling |

The root `package.json` provides stable development commands. Application packages,
shared development tooling and documentation have separate manifests and lockfiles.
There are no npm workspaces or additional build orchestrators. The generated
[project structure](project-structure.md) shows the current files.

## Getting set up

Use Node.js 22.16+ or 24 and npm. From the repository root:

```sh
npm ci --prefix src/backend
npm ci --prefix src/frontend
npm ci --prefix dev
```

For a ready-to-run environment with real Caddy containers, follow the
[Disposable Caddy integration environment](development-caddy.md) guide. It covers
Docker prerequisites, startup, managing test instances, exercising failures and
cleanup.

You can also develop against an existing Caddy instance. Its admin API must be
reachable through `CADDY_ADMIN_URL` (default `http://caddy:2019`). Run the backend
and frontend in separate terminals:

```sh
npm run dev --prefix src/backend
```

```sh
npm run dev --prefix src/frontend
```

The backend listens on port 3001 by default; the frontend's Vite server proxies
`/api` there. Relevant environment variables are documented in the
[configuration reference](configuration.md#environment-variables).

Frontend `predev` and `prebuild` fetch the generated CodeMirror grammar into
`src/frontend/src/lib/caddyfileMode.js` from
[zackwag/caddyfile-codemirror](https://github.com/zackwag/caddyfile-codemirror).
The file is ignored by Git. Run development or a build with network access before
working offline; later runs can reuse the local copy.

## Tests and lint

From the repository root:

```sh
npm test --prefix src/backend
npm run lint --prefix src/backend
npm test --prefix src/frontend
npm run lint --prefix src/frontend -- --max-warnings=0
npm run lint:dev-caddy
npm run test:dev-caddy
```

Backend tests use Vitest for helpers and HTTP contracts. Frontend tests cover
component contracts, API/error behavior, localization and playground logic. The
playground tests currently remain under `src/frontend/test/` and require the dev
package; moving them to their owning module is a separate follow-up.

Shared dev lint borrows backend ESLint and frontend rule configuration, so both
application packages must be installed. It covers harness, integration, browser
and playground code. Lifecycle/readiness unit tests need no Docker Engine.

Real-Caddy integration and Chromium checks use the same root commands locally and
in CI. Follow the [integration testing guide](development-caddy.md#automated-integration-and-browser-checks)
for browser installation, fixture ownership and cleanup. The required `Test` check
includes both application tests and the real-service/browser integration job.

## Verifying UI changes

Run the app and exercise affected views in a browser before opening a PR. Unit
tests do not establish rendering or interaction correctness. Check both dark and
light themes when changing styling, and include a narrow viewport when changing
layout.

## Code style and boundaries

- Match the existing file style: ES modules, four-space indentation, single quotes
  and semicolons.
- Keep application-specific unit tests and build scripts with their package.
  Shared development tools belong under `dev/`; documentation tooling stays with
  the book; GitHub-specific orchestration stays under `.github/`.
- Before moving files, identify their imports, runtime paths, package commands,
  workflow filters, cache paths, build contexts and documentation consumers.
- Preserve root command names and generated-file boundaries. Update generators
  or their canonical inputs rather than editing generated output.
- Keep changes focused. Dependency upgrades, behavior changes and additional
  architecture changes should have their own justification and review scope.

## Opening a PR

1. Branch off `main` and keep the diff focused on one change.
2. Explain the problem, resulting behavior and affected boundaries.
3. Run the tests and lint for the packages you changed. For shared fixtures or
   tooling, also run the affected root suite and `npm run lint:dev-caddy`.
4. Use a [Conventional Commit](https://www.conventionalcommits.org/) PR title,
   such as `fix:`, `feat:`, `test:`, `build:` or `docs:`.
5. Do not edit `CHANGELOG.md` or bump versions by hand. Release-please manages
   both after squash-merging.
6. Open the PR against `main`; the Test workflow runs automatically.
