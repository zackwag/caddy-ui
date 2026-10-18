# API reference

Enable [authentication](configuration.md#authentication) to protect API endpoints. For multi-instance behavior, see [instances](instances.md).

{{#include ../../README.md:api-endpoints}}

## Empty and unavailable results

An empty result means the resource is empty, not that it couldn't be read:

- `GET /api/routes` returns `[]` only when Caddy has no HTTP routes. If Caddy's config can't be read, it returns `503` with `{ "code": "CADDY_CONFIG_UNAVAILABLE" }`.
- `GET /api/tls` returns `[]` when Caddy hasn't stored any certificates yet. Caddy only creates its data directory when it first stores something, so a missing data path also returns `[]`; in local mode the backend log notes when that path may be a missing volume mount. If certificate storage exists but can't be read (permissions, or the container can't be reached), it returns `500` with `{ "code": "CERTIFICATE_READ_FAILED" }`. Check the backend log for the reason and path.
- When certificate storage is readable but Caddy's config isn't, `GET /api/tls` still lists the certificates with `isManaged: null`. Without Caddy's config, caddy/ui can't tell whether a certificate is still in use, so none are marked `orphaned`.
- `GET /api/route-notes` returns `{}` when no notes file exists yet. If the notes file can't be read or isn't a valid JSON object, it returns `500` with `{ "code": "ROUTE_NOTES_READ_FAILED" }`. `PUT /api/route-notes/:domain` fails the same way and leaves the file unchanged.
- `GET /api/caddyfile/history` returns `[]` when there are no snapshots. If the history directory can't be read, it returns `500` with `{ "code": "CADDYFILE_HISTORY_READ_FAILED" }`.
