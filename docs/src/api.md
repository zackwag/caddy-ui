# API reference

Enable [authentication](configuration.md#authentication) to protect API endpoints. For multi-instance behavior, see [instances](instances.md).

{{#include ../../README.md:api-endpoints}}

## Empty and unavailable results

An empty list means the resource is empty, not that it couldn't be read:

- `GET /api/routes` returns `[]` only when Caddy has no HTTP routes. If Caddy's config can't be read, it returns `503` with `{ "code": "CADDY_CONFIG_UNAVAILABLE" }`.
- `GET /api/tls` returns `[]` when Caddy hasn't stored any certificates yet. If the certificates directory or the instance's data path can't be read, it returns `500` with `{ "code": "CERTIFICATE_READ_FAILED" }`. Check the backend log for the reason and path.
- When certificate storage is readable but Caddy's config isn't, `GET /api/tls` still lists the certificates with `isManaged: null`. Without Caddy's config, caddy/ui can't tell whether a certificate is still in use, so none are marked `orphaned`.
