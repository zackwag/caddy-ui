# Read-only API tokens

Create tokens with **API tokens** in the sidebar after signing in. Give each integration its own name, select permissions and specific Caddy instances, and choose an expiry. Copy the token when it is displayed: it cannot be retrieved later. Tokens are not saved in browser storage. If a token is lost, revoke it and create another.

While the one-time token is visible, Close and Escape are disabled. Choose **I have saved the token** to continue, or **Discard and revoke token** to invalidate it before hiding it. Failed revocation keeps the token visible so you can retry. Closing the browser or reloading can still lose an unsaved token; revoke that entry after signing in again.

The UI offers 30, 90 or 365 days; the API accepts 1–365 days. Up to 64 token records, including expired ones, can be stored. Revoke unused or expired tokens before reaching that limit. There is no write scope, wildcard instance scope or automatic access to instances added later.

## Permissions

| Scope | Allowed requests |
| --- | --- |
| `status:read` | `GET` / `HEAD /api/status` |
| `metrics:read` | `GET` / `HEAD /api/metrics`, `/api/metrics/raw` |

Other routes are denied, including status process details, metrics configuration, Caddyfile, logs, settings, discovery and authentication endpoints. Supplying a valid administrator cookie alongside a bearer token does not broaden that token's access. Unknown, expired or revoked tokens are rejected without falling back to cookie authentication or public metrics.

Status tokens receive availability, instance ID/name, aggregate server/route/upstream counts, uptime and the existing TLS flag. They do not receive the Caddy admin URL or server names/listener addresses (`adminUrl` and `servers`). Administrator sessions retain the full status response. Metrics remain more detailed: Caddy metric labels and permitted instances' historical series can contain hostnames and upstream addresses; grant `metrics:read` only to integrations that need them.

Send the token as an explicit header, never a URL parameter:

```sh
# CADDY_UI_API_TOKEN comes from your integration's secret storage.
curl --fail-with-body \
  --header "Authorization: Bearer $CADDY_UI_API_TOKEN" \
  --header 'X-Instance-Id: default' \
  https://caddy-ui.example.com/api/status
```

Use the instance's stable `id`, shown in the token dialog and available from `GET /api/instances` with an administrator session. Without `X-Instance-Id`, a token permitting one instance reads that instance, and a token permitting several reads `default`, which must be explicitly permitted by the token. An unknown or removed instance never falls back to another instance. Renaming an instance does not change its ID. Raw Prometheus responses filter caddy/ui's historical series to the token's permitted instance IDs, in addition to reading Caddy metrics for the requested instance.

The [integration examples](integrations.md) show Homepage and Prometheus configuration. Keep `CADDY_UI_PUBLIC_METRICS=false` when metrics must be protected: the public option deliberately exposes parsed/raw metrics without a token.

## CSRF and session boundaries

Bearer authentication is read-only. No POST, PUT, PATCH or DELETE request can be authorized with these tokens, even with a valid CSRF token or administrator cookie. There is no CSRF exemption for token-backed writes.

Creation and revocation use the existing browser session and require its `X-CSRF-Token`. Listing token metadata also requires the administrator session. The existing Origin/Referer checks remain active; CORS is not enabled. Safe bearer reads do not need a CSRF token because the secret is sent explicitly in the Authorization header rather than automatically attached by the browser.

Other authentication schemes forwarded by a proxy, such as HTTP Basic, do not grant API access. They leave the existing cookie/session checks in place so the UI can work behind a separately authenticated proxy.

| Management request | Body |
| --- | --- |
| `GET /api/auth/tokens` | Returns metadata only; never token secrets or hashes |
| `POST /api/auth/tokens` | `{ "name": "Homepage", "scopes": ["status:read"], "instanceIds": ["default"], "expiresInDays": 90 }` |
| `DELETE /api/auth/tokens/:id` | Revokes immediately for subsequent requests |

Creation returns HTTP 201 and the token once, with `Cache-Control: no-store`. Metadata includes the token ID, name, scopes, instance IDs, creation time and expiry. Password recovery invalidates every integration token, as well as browser sessions, after credentials are saved successfully. Browser logout does not revoke integration tokens.

## Deployment and storage

Tokens use 256 bits of cryptographic randomness. Only their SHA-256 hashes and metadata are persisted alongside password/recovery hashes in `AUTH_PATH`. Random tokens do not require a password KDF. Persistence retains the existing owner-only permissions, serialized writes and atomic replacement; pre-token credential files remain valid. Invalid token records fail startup rather than silently broadening access. The store assumes one backend process, as do browser sessions.

HTTP/local deployments remain supported, but HTTP cannot protect bearer tokens from network interception. Use HTTPS across untrusted networks and your integration's secret storage. Do not place tokens in URLs, source control or screenshots. Creation/revocation logs contain IDs and scope/instance metadata, never the bearer secret. Stopping the backend and removing authentication storage also removes integration tokens; restrict access before any reset.
