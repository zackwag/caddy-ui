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

Use Node.js 26 and npm. The tested Node major is recorded in `.node-version` and
matches the backend runtime and frontend build stage in the production
Dockerfiles. CI reads this file for application, integration, browser and
documentation checks; other Node majors have no required compatibility coverage.
From the repository root:

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
npm run test:workflows
```

Backend tests use Vitest for helpers and HTTP contracts. Frontend tests cover
component contracts, API/error behavior, localization and playground logic. The
playground tests currently remain under `src/frontend/test/` and require the dev
package; moving them to their owning module is a separate follow-up.

Shared dev lint borrows backend ESLint and frontend rule configuration, so both
application packages must be installed. It covers harness, integration, browser
and playground code. Lifecycle/readiness unit tests need no Docker Engine.

Publication-channel tests parse the release/edge/beta workflows and exercise version
recording with temporary files. They need only the dev dependencies and do not
build or publish images. Run `npm run test:workflows` when changing those workflows.

Publication caches use `<channel>-<image>` scopes: `stable-backend`,
`stable-frontend`, `edge-backend`, `edge-frontend`, `beta-backend` and
`beta-frontend`. `release.yml` uses `stable`; each build imports and exports only
its own scope. Keep `mode=max` on exports to cache intermediate stages and
`pull: true` to refresh base images. Renaming a scope starts a cold cache.

Real-Caddy integration and Chromium checks use the same root commands locally and
in CI. Follow the [integration testing guide](development-caddy.md#automated-integration-and-browser-checks)
for browser installation, fixture ownership and cleanup. The required `Test` check
includes both application tests and the real-service/browser integration job.

When upgrading the production Node major, update `.node-version`, the Node
stages in both Dockerfiles and `.devcontainer/devcontainer.example.json` together,
run the checks on that runtime, and update the setup instructions.
`test:workflows` rejects mismatched Docker and Dev Container Node stages,
workflow setup that overrides the shared version, and package `engines.node`
fields that don't require that major. Package manifests don't need an `engines`
field; `.node-version` is the source of truth. GitHub Actions' own internal
JavaScript runtimes are managed by the actions and are separate from this policy.

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

## Releases

Stable releases are cut by release-please. Every push to `main` updates one open
release PR (`chore(main): release X.Y.Z`) with the changelog and version so far.
Merging that PR tags the release, and the Release workflow publishes both images
with that version.

Merging a feature or fix doesn't mean releasing it right away. Changes reach the
`edge` images as soon as they land on `main` and accumulate in the release PR
until it's worth shipping:

- **Cadence:** leave the release PR open until it has enough changes to justify a
  release. Both maintainers approve it before it's merged. This is a convention,
  not a branch protection rule.
- **Before approving:** CI is green on `main` and the changes have been running
  on `edge`.
- **Urgent fixes:** `main` is always releasable. If a fix for a security
  vulnerability, configuration loss or a major regression can't wait, merge the
  release PR early. It ships everything already on `main`; there are no
  maintenance branches or backports, so only merge changes that are ready to
  ship.
- **What triggers a release:** `feat:`, `fix:`, `perf:`, `refactor:`, `revert:`
  and `chore:` commits, and any breaking change marked with `!`. `docs:`,
  `build:`, `ci:`, `test:` and `style:` don't, so use them for changes that
  don't affect a published image.
- **Versions:** release-please picks the major, minor or patch bump from the
  commit types. Every release tags the backend and frontend images with the same
  version; see [published release images](building.md#published-release-images).

## Browser-origin security checks

The focused Chromium suite needs backend and dev dependencies plus a Playwright
browser; it does not need Docker or a Caddy instance:

```bash
npm exec --prefix dev -- playwright install chromium
npm run test:cross-site:browser
```

The same cases run through `npm run test:dev-caddy:e2e` in CI. They use the real
backend middleware and local HTTP servers, with no request interception or
injected browser headers. An IPv4-mapped loopback URL reproduces Chromium's
untrustworthy HTTP destination behavior without an external LAN. Assertions check
that Fetch Metadata is actually absent, forged fetches/forms never reach the
write handler, and configured same-origin HTTP writes still work. Each case owns
its browser and servers and closes them on completion or failure. Backend policy
and route assertions also run with `npm test --prefix src/backend`.

## Browser checks for untrusted content

Run the focused XSS rendering checks with the usual backend, frontend and dev dependencies, Docker, the development Caddy image and Playwright Chromium:

```bash
node --test dev/e2e/xss.mjs
```

These cases also run in `npm run test:dev-caddy:e2e`. They check Caddy log snapshots and live streams, application diagnostics, persisted route/server/instance/token names, and the Caddyfile editor, history diff, raw preview and actor labels. Each case owns its browser, backend, Caddy container and temporary state.

The real API and storage are used for logs and saved content. Application-log responses and legacy/imported actor metadata are controlled at the browser's network boundary to reach their renderers without weakening input validation. Assertions require the payload text to appear, reject injected DOM nodes and resource requests, and check that no handler ran. A positive control first proves that handlers can execute in the test browser. These Vite-based tests deliberately run without CSP so a production policy cannot hide unsafe rendering. They cover these paths rather than establishing that every possible XSS path is safe.

## Configuration reads during writes

`src/backend/src/observations.js` shares short-lived reads of each instance's
HTTP server configuration (`/config/apps/http/servers`) and the upstream checks
built from it, so route handlers and monitors don't each call the admin API. A
settled result is reused for up to `OBSERVATION_MAX_AGE_MS` (5 seconds).

Writes through caddy-ui invalidate those results. `caddy.js` bumps a
per-instance generation (`markConfigChanged`) when a non-GET admin request or
`caddyLoad` settles, and `routes/caddyfile.js` does the same after its
`caddy reload` fallback. The bump happens whether the write succeeds or fails,
because a failed write may have applied partially.

The contract for reads that overlap a write, agreed in
[#347](https://github.com/zackwag/caddy-ui/issues/347):

- **Overlapping read:** a read that started before the write settled may return
  the configuration from before the write. Callers get that snapshot as is; it
  isn't revalidated or retried.
- **Read after invalidation:** a read that starts after the write settled always
  collects fresh configuration, even while an older read is still in flight.
- **No regression:** an older read never replaces or evicts the newer cached
  result, whether it succeeds or fails. Upstream checks never outlive the
  configuration they were collected from.
- **External changes:** writes made outside caddy-ui, such as another admin API
  client, aren't tracked. They show up once the cached result is older than
  `OBSERVATION_MAX_AGE_MS`.

Stronger ordering, such as revalidating every in-flight read after a write, is
intentionally out of scope. Late completion of a write that timed out is tracked
in [#348](https://github.com/zackwag/caddy-ui/issues/348).

These tests in `src/backend/test/observations.test.js` protect the contract:

| Guarantee | Test |
| --- | --- |
| Fresh read after a successful write | `reads again after a configuration write, however recent the last read` |
| Fresh read after a failed write | `reads again after a failed configuration write, which may have applied partially` |
| Overlapping reads return their snapshot without displacing newer results | `keeps the newer config cached when an older pre-write read succeeds` and `... fails` |
| Upstream checks expire with their source configuration | `refreshes upstream checks when their older source config expires` |
| Failed reads aren't reused | `does not reuse a failed read, so recovery shows on the next request` |

Update this section and those tests together if the contract changes.
