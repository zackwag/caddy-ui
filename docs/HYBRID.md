# Docker-label hybrid deployment

This opt-in fork keeps caddy-docker-proxy as the **only configuration writer**.
The existing UI's monitoring remains available. Use **Hybrid Sites** to create,
update or remove manual reverse proxies and import PEM certificates. Existing
Routes/Caddyfile/logging/metrics configuration write APIs return 409 in hybrid
mode, including maintenance mode and certificate deletion. Those pages remain
useful for inspection, but their legacy edit controls are not supported.

## Ownership

The UI atomically writes `/hybrid/Caddyfile`, carrying its source state in a
comment. Docker-proxy reads this base file every five seconds and merges the
labels. No UI request calls `/load` in hybrid mode. Manual sites use hostname +
container-name:port; containers must share a reachable network with Caddy.
Advanced path routing stays in Docker labels for this first version.

Label-owned names (including stopped containers) are reserved. Creating a
manual duplicate is rejected. If a label claims a manual hostname later, the
reconciler suppresses the manual definition and shows `label-conflict`.
There can be a poll interval before reconciliation: never intentionally assign
the same hostname to both sources. Only the default `caddy` label prefix and
Docker containers are supported, **not Swarm, custom prefixes or replicas of
the UI backend**. Errors reading inventory block writes, rather than assuming
there are no labels. Wildcard labels reserve matching first-level names.

Saved is not the same as applied: the page shows pending until a revision marker
is seen in live Caddy configuration. If it stays pending, inspect Caddy logs.
Adaptation is validated before saving; it is not a promise that the merged
runtime can start (for example, an inaccessible upstream or invalid labels).

## Certificates and monitoring

PEM import checks dates and public/private key match, never returns the private
key, and writes new versioned files with owner-only permissions. Private keys
are not encrypted at rest; protect and back up the Docker volume. Importing
does not assign the certificate. Manual sites select it from the dropdown.
For label-owned sites, copy the displayed `caddy.tls` paths to their stack.
The dropdown also discovers certificates referenced by Caddy's `load_files`
configuration (including mounted Cloudflare Origin certificates). Mount their
**public certificate only** into the backend at the same absolute path used by
Caddy, read-only. Caddy still reads the private key from its own mount; no
backend key mount or re-upload is needed. Existing certificate/key references
are resolved server-side and saved with the manual site, so they survive a
restart or removal of the original label site. Keep those gateway mounts.

Certificates found under `CADDY_DATA_PATH/certificates` appear in separate
Caddy-managed and internal-CA groups. Selecting one preserves automatic
management rather than loading or copying storage files as static certificates.
It does **not pin a particular certificate, issuer or fingerprint**: Caddy
selects a matching certificate or obtains one as needed. Internal-CA selections
use `tls internal` and require clients to trust that CA. Automatic HTTPS can
reuse a matching manually loaded certificate; it does not force new issuance.

Expired, not-yet-valid, unreadable or hostname-mismatched certificates cannot
be selected. Dates and X.509 hostname coverage are rechecked server-side on
save, independently of the UI. Unreadable configured public files remain
visible with a mount hint. This catalog covers PEM imports, `load_files` and
the mounted filesystem storage, not arbitrary remote/custom certificate
storage or in-memory PEM loaders. Cloudflare Origin certificates are trusted
by Cloudflare, not directly by ordinary browsers: use them behind its proxy.

The TLS page and notification monitor inspect loaded certificate files on the
origin, including Cloudflare Origin CA, not Cloudflare's public edge certificate.
Configure a notification destination and enable expiry alerts in Notifications.
All upstream health checks are reachability checks, not proof that an entire
application works. Access logs require `caddy.log: ''` on label-owned sites;
manual sites enable logs. Caddy's runtime errors are in `/logs/caddy.log`.

## Deployment and security

`compose.hybrid.yaml` is the complete Dockhand example for the existing gateway.
Keep the existing stack/project name so `caddy_data` and `caddy_config` retain
their identity. Back up those volumes and the old stack before changing it.
Set `CADDY_UI_PASSWORD`, `JWT_SECRET` and optionally `CADDY_UI_DOMAIN` (default
`caddy-ui.i3u.us`). Origin certificate files must already exist on the host.
Use Cloudflare proxy + Full (strict), and protect the UI hostname with Access.
The backend enforces authentication in hybrid mode. No admin API or Docker
reader ports are published to the host. The Caddy admin API is nevertheless
reachable from containers sharing its networks: only put trusted applications
on `proxy`. The UI gets filtered GET-only Docker access, not the Docker socket.

Back up `caddy_hybrid` (includes private keys), `caddy_ui_data`, and the gateway
volumes. A one-level manual-file backup is kept as `Caddyfile.previous`.
For rollback, restore the original gateway stack and remove only the hybrid
services from the stack. Do not delete any volumes. Manual-only sites will no
longer exist after rollback; original label sites remain under Docker-proxy.

This fork is not an official upstream release. Test it before production use.

## Verification

Run backend/frontend tests and lint, then:

```sh
docker compose -p caddy-hybrid-test -f backend/test/compose.hybrid-integration.yaml up -d --build
node scripts/test-hybrid.mjs
node scripts/test-hybrid-certificates.mjs
```

The isolated test binds only localhost ports 18980–18984 and does not replace
an existing gateway. The script checks authentication, forbidden legacy writes,
label ownership, invalid PEM rejection, import, live certificate inspection,
manual/label HTTP traffic, gateway restart persistence, conflict reconciliation,
and deletion without losing label routes. The certificate-selection script
additionally verifies a configured wildcard with its private key absent from
the backend, the actual served fingerprint, hostname mismatch rejection, and
selection persistence after gateway/backend restart and label-site removal.
Its credentials are test-only.
UI browser interaction must be checked separately; an API integration test is
not a substitute for visual QA. Stop the test stack without deleting volumes:

```sh
docker compose -p caddy-hybrid-test -f backend/test/compose.hybrid-integration.yaml down
```
