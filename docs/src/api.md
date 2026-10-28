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

## Configuration change verification

After a configuration change, the backend reads the result back and reports
it as `verification: { "file": ..., "live": ... }` in the response. Each value
is one of:

| Value | Meaning |
| --- | --- |
| `verified` | The readback matches what the change should have produced. |
| `mismatch` | The readback differs, for example because another process changed it in between. |
| `unavailable` | The readback couldn't be made or interpreted. Nothing is known either way. |
| `not-applied` | The change deliberately wasn't applied: a force save that Caddy rejected. |
| `unchanged` | The operation didn't touch this representation. |
| `uncertain` | Applying timed out and the readback didn't show the change yet. Caddy may still apply or reject it. |

A `mismatch` or `unavailable` result doesn't fail the request, because the
change was already made. The response keeps its success status and adds
`warningCode: "CONFIG_VERIFICATION_MISMATCH"` or
`"CONFIG_VERIFICATION_UNAVAILABLE"` with a `warning`. A mismatch takes priority
over other warnings. The backend never retries the write or overwrites the
readback, since the difference may be someone else's change. Logs name the
representation and the JSON path of the first difference, never configuration
values.

| Endpoint | How it applies the change | File check | Live check |
| --- | --- | --- | --- |
| `PUT /api/caddyfile`, `PUT /api/metrics/config`, `PUT /api/logs/config`, Caddyfile route edits and maintenance | Writes the Caddyfile and reloads it | Exact text, after any formatting and sorting | Running config (`GET /config/`) equals Caddy's adaptation of the saved file |
| `PUT /api/caddyfile?validate=false` rejected by Caddy | Writes the Caddyfile only | Exact text | `not-applied` |
| `POST /api/routes`, `PATCH /api/routes/:id`, `DELETE /api/routes/:id` | Writes the Caddyfile block and changes the route through the admin API | Exact text, or `unchanged` for a route without a Caddyfile block | The route's `/id/` object equals the sent route, or is gone after a delete |
| `POST /api/caddyfile/reloads` | Reloads the file on disk | `unchanged` | Running config equals Caddy's adaptation of that file |

### Changes that time out

Admin API calls time out after 10 seconds, but a timeout doesn't stop Caddy
from finishing the request. caddy/ui therefore treats a timed-out change as
uncertain rather than rejected:

- This applies only after dispatching a write. Route-creation preflight reads
  finish inside the change queue before the Caddyfile is written; if a read
  fails or times out, no route mutation is sent and the file stays unchanged.
- The new Caddyfile stays on disk instead of being rolled back. If Caddy applies
  the change late, the file and running config agree. If it never does, the
  file is ahead of the running config, as after a force save, and **Reload**
  applies it.
- The request isn't retried, and Docker-mode instances don't fall back to
  `caddy reload`, since either could apply the change twice.
- One readback runs immediately. If it already matches, the result is
  `verified`; otherwise `live` is `uncertain` with
  `warningCode: "CADDY_APPLY_UNCERTAIN"`. The history version records an
  unknown outcome.
- caddy/ui keeps waiting for the timed-out request in the background for up to
  60 seconds. When it settles, successfully or not, cached reads of the
  configuration are invalidated so the UI shows the result. A read made in
  between may show the old configuration; even without that invalidation,
  cached reads expire after 5 seconds.

caddy/ui can't tell whether Caddy completes a request it stopped waiting for.
The application log records when a timed-out write later completes or fails.

Checks run in the same per-instance queue as other changes, so they never
compare against another caddy/ui change in progress. They can't rule out a
change made outside caddy/ui between the write and the readback; that is what
`mismatch` reports. The file and the admin API are updated separately, so a
change is never atomic across both.

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
