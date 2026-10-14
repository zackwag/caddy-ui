# Disposable Caddy integration environment

Use this environment to test frontend changes, backend behavior, error handling,
and logging against real Caddy instances. It keeps development configuration and
data separate from production. The root npm package contains development scripts;
backend and frontend dependencies remain separate.

## Prerequisites and startup

Use Node.js 22.16+ (or 24), npm, and a running Docker Engine or Docker Desktop.
The Docker CLI must be on PATH and `docker info` must succeed for your user.
The harness and backend Docker exec use the same Docker CLI context. Discovery
separately uses `DOCKER_SOCKET` (default `/var/run/docker.sock`); it does not
support remote/TLS Docker contexts. The harness targets local Docker Engines.

From the repository root:

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm run dev:with-caddy
```

Open <http://localhost:5173>. The Vite proxy reaches the backend on port 3001.
Both ports must be free; the runner rejects occupied ports. The frontend's normal
Caddyfile syntax-mode fetch runs before Vite starts and needs network access on
first use. The default image is pinned to `caddy:2.10.2-alpine`.

Startup creates/restarts `default`, waits for its admin API and the backend,
then starts Vite. Its printed HTTP URL has `/health` (200), `/error` (503), and a
catch-all response identifying the instance. Requests generate JSON access logs.
The Caddyfile disables automatic HTTPS so no public DNS, certificates, or ports
80/443 on the host are needed. Caddy admin listens on port 2019 inside its container;
published HTTP/admin ports are dynamically allocated and bound to host loopback.
Do not expose these admin ports externally: they have no authentication.

All UI state is redirected to `.dev-caddy/backend/`, including instance
registrations, settings, notifications, history, themes and uptime. Inherited UI
auth environment variables still apply; unset them for an unauthenticated local
session. The harness disables update checks. It seeds a default registration only
when the isolated instances file does not exist, and refreshes that registration's
address on startup while preserving other UI edits. It never rewrites the registry
while the backend is running.

Ctrl-C stops frontend/backend processes. Caddy containers and persistent data
remain for inspection and later startup. Use the explicit lifecycle commands to
stop or remove them. A startup failure also leaves Caddy available for diagnosis.

## Instance management

```sh
npm run dev:instances -- create alpha
npm run dev:instances -- create beta
npm run dev:instances -- list
npm run dev:instances -- stop alpha
npm run dev:instances -- create alpha     # restarts it, preserving edits
npm run dev:instances -- remove alpha     # removes container, retains volume
npm run dev:instances -- remove alpha --purge  # confirms before deleting its data
npm run dev:instances -- remove-all       # confirms; retains all volumes
npm run dev:instances -- remove-all --purge --yes  # explicit destructive consent
```

Names are lowercase letters, digits and hyphens, starting with a letter, at most
32 characters. Multiple instances use separate volumes and random published
ports. Create is repeatable. List reports stopped containers and retained volumes.

**Docker lifecycle and UI registration are separate.** Create prints the exact
fields for the UI's instance form. Add extra instances in the Instances screen
using that `adminUrl`, container name and paths. You can also use the existing
`POST /api/instances` endpoint with the printed `instance` JSON for future E2E
setup (authenticate when enabled). Removing/stopping a container leaves its UI
registration visible for offline/error testing. Delete the registration in the UI
when desired. Recreating a removed container may change its published ports/IP;
update its registration with the newly printed address. Discovery is a convenience,
not lifecycle management: it scans all Caddy images, assumes admin port 2019, and
suggests container IPs that may be unreachable from a host on Docker Desktop.
Use the printed address rather than relying on discovery there.

## Editable files and deterministic failures

Each instance has one persistent, labeled Docker volume mounted at `/data/dev-caddy`:

| Path | Purpose |
| --- | --- |
| `/data/dev-caddy/Caddyfile` | Editable source configuration |
| `/data/dev-caddy/logs/access.log` | HTTP access logs |
| `/data/dev-caddy/data/caddy` | Caddy data |
| `/data/dev-caddy/config/caddy` | Caddy autosave state |

The default Caddyfile is written only if missing. Container restart/recreation
loads this file and preserves all data. UI edit, validation, reload and log viewing
use the existing backend Docker exec implementation and the real Caddy binary.
No host Caddy binary is necessary. For local editor access, copy the file out and
back (replace the name with the printed containerName):

```sh
docker cp <containerName>:/data/dev-caddy/Caddyfile ./work/Caddyfile
docker cp ./work/Caddyfile <containerName>:/data/dev-caddy/Caddyfile
```

Create `work/` first if needed. Reload through the UI after copying back. Do not
use production files as fixtures. A host file is a working copy, not a live bind
mount; GUI edits are persisted directly in the volume.

For deterministic tests, request `/error` to exercise an HTTP 503 and logging;
stop an instance to exercise connection errors and offline status; submit an
invalid Caddyfile through the UI to exercise validation/reload failures. Invalid
content saved directly to disk can prevent a restart; restore the file before
restarting. For future browser E2E tests use a fresh checkout/namespace, the
printed URLs, existing registration API, and confirmed cleanup in a finally block.
Lifecycle functions accept an injected Docker command runner for automated tests.

## Networking

Run the harness against a local Docker Engine or Docker Desktop. It uses
loopback-published ports for the frontend/backend to reach Caddy. Remote Docker
Engines are unsupported because published loopback ports belong to the remote host.
Use the printed HTTP URL to test a route and the printed admin URL when registering
an instance; container IPs suggested by discovery may be unreachable from the host.

## Troubleshooting and cleanup safety

- Docker unavailable: install/start Docker and verify that `docker info` succeeds
  for your user. Check socket group permissions or select the appropriate rootless
  Docker CLI context; set `DOCKER_SOCKET` separately if discovery is needed.
- Readiness failure: use list, `docker logs <containerName>`, and inspect the
  Caddyfile. Check that the printed admin address is reachable.
- Ports occupied: stop other UI development processes and rerun startup.
- Failed editor-mode download: check network access to the source GitHub repo;
  the frontend fetch script supports its normal local cache.
- After an interrupted lifecycle command, `.dev-caddy/lifecycle.lock` may remain.
  After a crashed runner, `.dev-caddy/runner.lock` may remain. Remove only the
  relevant lock directory after verifying its process is no longer running.

The checkout stores a random namespace in `.dev-caddy/namespace`. Container and
volume names include it; all resources also carry `io.caddy-ui.dev=true`, project
and instance labels. Every mutation verifies labels and the exact expected name.
Bulk cleanup filters by both management and project labels, validates ownership,
and requires a typed confirmation or `--yes`. It never runs Docker prune or
removes networks. Different checkouts have independent namespaces. Avoid copying
`.dev-caddy` to another checkout, which would share ownership.

**Do not delete `.dev-caddy/namespace` before Docker cleanup:** doing so loses
this checkout's ownership key and leaves orphan resources. For a complete reset,
stop the UI runner, run `remove-all --purge --yes`, then delete `.dev-caddy/`.
Reinstalling or rerunning startup is otherwise safe and repeatable. Registry
cleanup is deliberately separate; deleting `.dev-caddy/backend/` while stopped
resets UI state without touching any Caddy volumes.

Run harness lint with `npm run lint:dev-caddy` (requires backend dependencies)
and lifecycle safety tests with `npm run test:dev-caddy`. They need no Docker
Engine. `npm run test:dev-caddy:integration` runs real-container checks. They
use fresh namespaces and purge only their own resources,
covering `/health`, `/error`, reload, logging, restart/recreation persistence and
independent simultaneous instances. It requires Docker and may pull the pinned image.

## Automated integration and browser checks

Install the backend and frontend dependencies, then run:

```sh
npm run test:dev-caddy
npm run test:dev-caddy:integration
npm exec --prefix frontend -- playwright install chromium
npm run test:dev-caddy:e2e
```

Integration checks also exercise the real backend's registration API: creating or
removing a Docker container does not create or remove its UI registration. The
tests cover reload, retained configuration, instance isolation and cleanup after
failed startup. Diagnostic regressions check complete route paths, semantic error
codes, sanitized read failures, warning severity and request-ID correlation.
Browser checks cover localized errors, links to correlated logs,
live log streams, incident recovery, network loss and the empty-instance state.

The Test workflow runs lifecycle and browser checks against Docker and Chromium.
Its required Test check includes the integration job, so container or browser
failures cannot be hidden by passing unit tests.

Each fixture uses a fresh labeled Docker namespace, temporary backend state and
dynamic service ports. It does not read or change `.dev-caddy`. Readiness waits
are bounded, and teardown stops its backend and browser before purging its own
containers and volumes, including when a test fails. Tests do not use production
configuration or require a running development stack.

Fixture cleanup is registered before startup and follows the test's cancellation
signal. It waits for in-flight resource creation before stopping services and
purging resources, so an acquisition that finishes after a timeout is still
cleaned up. Every cleanup layer is attempted even when another layer fails.

Before inspecting or creating Caddy resources, a fixture atomically claims its
namespace with a stopped Docker container named `caddy-ui-test-<namespace>-lease`.
The lease uses separate test-fixture labels and is removed after all other
cleanup layers. Concurrent clients cannot acquire the same namespace. If a
process is killed without cleanup, inspect its lease and verify the owner has
stopped before manually removing that specific lease container.

The backend lets the OS allocate its port (`PORT=0`) and reports the bound port
through Node's IPC channel before HTTP readiness checks. It keeps ownership of
that port throughout startup, allowing concurrent fixtures without reserving and
releasing candidate ports.

The browser suite uses Playwright's Chromium by default. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium executable when
using a managed environment that provides its own browser.

### Code boundaries and review order

Read the support code in this order:

| File | Responsibility |
| --- | --- |
| `scripts/dev-caddy/harness.mjs` | Existing Docker operations, ownership checks and environment paths; shared by development commands and tests. |
| `test/integration/lifecycle.mjs` | Resource acquisition, cancellation and reverse-order cleanup. It has no Docker, backend or browser dependencies. |
| `test/integration/stack.mjs` | Claim namespace, create Caddy, seed temporary state, start backend, discover its bound port, and wait for HTTP readiness. |
| `frontend/e2e/fixture.mjs` | Add Vite, Chromium, a browser context and bounded diagnostics to the same resource owner. |

`FixtureScope.run` tracks a step that must finish before cleanup.
`acquire` also registers disposal of the returned resource, including a resource
that arrives after cancellation. `defer` registers cleanup for partial resources
such as a container creation that fails after creating its volume. `close` is
idempotent, waits for pending steps, and attempts every disposer in reverse order.
The scope's bookkeeping is private; callers use these methods and its signal.

`useTestStack` registers the owner with a Node test before acquiring resources.
The browser fixture passes its own owner to `createTestStack`, so the browser,
frontend, backend and Caddy resources follow one cleanup order.

Scenario files contain the actions and expected behavior:

- `test/integration/caddy.mjs`: Caddy lifecycle and persistent data without the UI backend.
- `test/integration/api.mjs`: registration versus container lifecycle and instance isolation.
- `test/integration/startup.mjs`: failed startup, cancellation, port ownership and namespace exclusivity.
- `test/integration/diagnostics.mjs`: public error contracts and correlated backend logs.
- `frontend/e2e/error-logging.mjs`: browser feedback, live logs, recovery, network loss and locale fallback.

`*.test.mjs` files in the integration package exercise lifecycle and readiness
without Docker. The root npm commands select unit, container and browser suites
explicitly; CI invokes those same commands. A bounded browser-suite hook prepares
editor mode once, rather than downloading it during each fixture acquisition.

Each browser scenario gets its own entire stack, including its registry, page,
locale and viewport. This costs more startup time than one shared stack, but
scenarios can be selected or reordered without inheriting another test's state.
Uncaught JavaScript errors are checked during each scenario's teardown, rather
than attributed to a separate test at the end of the file.
