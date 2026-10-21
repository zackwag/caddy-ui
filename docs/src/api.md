# API reference

Management endpoints use [cookie-session authentication and CSRF protection](configuration.md#authentication). For multi-instance behavior, see [instances](instances.md).

{{#include ../../README.md:api-endpoints}}

## Empty and unavailable results

An empty result means the resource is empty, not that it couldn't be read:

- `GET /api/routes` returns `[]` only when Caddy has no HTTP routes. If Caddy's config can't be read, it returns `503` with `{ "code": "CADDY_CONFIG_UNAVAILABLE" }`.
- `GET /api/tls` returns `[]` when Caddy hasn't stored any certificates yet. Caddy only creates its data directory when it first stores something, so a missing data path also returns `[]`; in local mode the backend log notes when that path may be a missing volume mount. If certificate storage exists but can't be read (permissions, or the container can't be reached), it returns `500` with `{ "code": "CERTIFICATE_READ_FAILED" }`. Check the backend log for the reason and path.
- When certificate storage is readable but Caddy's config isn't, `GET /api/tls` still lists the certificates with `isManaged: null`. Without Caddy's config, caddy/ui can't tell whether a certificate is still in use, so none are marked `orphaned`.
- `GET /api/route-notes` returns `{}` when no notes file exists yet. If the notes file can't be read or isn't a valid JSON object, it returns `500` with `{ "code": "ROUTE_NOTES_READ_FAILED" }`. `PUT /api/route-notes/:domain` fails the same way and leaves the file unchanged.
- `GET /api/caddyfile/history` returns `[]` when there are no snapshots. If the history directory can't be read, it returns `500` with `{ "code": "CADDYFILE_HISTORY_READ_FAILED" }`.
- `GET /api/logs` returns `200` with `{ "lines": [], "path": "..." }` for an empty readable file. A missing file returns `404` with `LOG_FILE_MISSING`, and a Docker-mode container that can't be reached returns `503` with `LOG_SOURCE_UNAVAILABLE`. Permissions, command or other read failures return `500` with `LOG_READ_FAILED`. Failure responses include a request ID; the application logs retain the underlying reason and instance path.
- `GET /api/logs/stream` reports failures as SSE events on the established HTTP stream. Events include `code`, `error` and `requestId`, using `LOG_FILE_MISSING` for a missing file, `LOG_SOURCE_UNAVAILABLE` for an unreachable container and `LOG_STREAM_ERROR` for other failures. The UI stops failed live mode; start it again after correcting the problem.

The Caddy log source reads the selected instance's configured log file, rather than Docker's captured stdout/stderr. A writable directory mount alone does not enable file logging: Caddy must be configured to write to the selected path. The UI displays unavailable reads separately from an empty file. Refresh retries the read and clears the error after success.

## Logging configuration

`GET /api/logs/config` returns defaults when the Caddyfile has no default logger.
A Caddyfile read failure returns `500` with `CADDYFILE_READ_FAILED`; a configuration
the structural scanner cannot interpret returns `500` with
`LOG_CONFIG_PARSE_FAILED`. Both include a request ID and retain the cause in the
application logs. Parsing failures never masquerade as disabled logging. The
configuration panel shows a localized error instead of loading indefinitely.

`PUT /api/logs/config` requires a boolean `enabled`. When enabling logging, provide
a nonempty string `path` without control characters, a single size token such as
`50mb` or `1.5GiB` for `rollSize`, a non-negative safe integer for `rollKeep`,
`json` or `console` for `format`, and `DEBUG`, `INFO`, `WARN` or `ERROR` for `level`.
Paths containing spaces are supported. Invalid request values return `400` with
`VALIDATION_FAILED` before a write is prepared. Disabling requires only
`{ "enabled": false }`; unused option values are not serialized.

Caddy still validates the edited configuration before it is written and applied.
A semantic rejection returns `422` with `CADDYFILE_VALIDATION_FAILED`, leaving the
file and live configuration unchanged. Logging edits replace the existing default
logger, including a bare `log` or `log default`, and preserve named loggers and
unrelated source bytes. New logger text follows the local indentation and line
endings; the whole file is not formatted.
