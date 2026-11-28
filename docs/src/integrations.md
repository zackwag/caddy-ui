# Integrations

Use [read-only API tokens](api-tokens.md) for authenticated integrations.

## Notification events

Every notification caddy/ui sends is one of these events. Its title and message are built from the event's variables, and its priority is fixed per event. The trigger is the Notifications page setting that turns the event on, alongside the main notification switch.

| Event | Trigger | Priority | Variables |
| --- | --- | --- | --- |
| `upstream.offline` | Upstream goes offline | High | `instance`, `instancePrefix`, `upstream`, `label` |
| `upstream.online` | Upstream comes back online | Normal | `instance`, `instancePrefix`, `upstream`, `label` |
| `route.offline` | Route goes down | High | `instance`, `instancePrefix`, `route`, `failure` |
| `route.online` | Route comes back up | Normal | `instance`, `instancePrefix`, `route` |
| `certificate.expiring` | TLS certificate expiring within 14 days | High | `instance`, `instancePrefix`, `certificate`, `days`, `expiresIn` |
| `apiToken.expiring` | API token expiring within 7 days | High | `token`, `days`, `expiresIn`, `expiresOn` |
| `update.available` | New caddy/ui release available | Normal | `versions`, `releaseNotes` |
| `authentication.succeeded` | Authentication notifications | Normal | `method`, `methodName`, `outcome`, `timestamp`, `sourceIp` |
| `authentication.failed` | Authentication notifications | Normal | `method`, `methodName`, `outcome`, `timestamp`, `sourceIp` |
| `authentication.failedRepeatedly` | Authentication notifications | Normal | `method`, `methodName`, `outcome`, `timestamp`, `sourceIp`, `count` |
| `authentication.passwordFallback` | Authentication notifications | High | `method`, `methodName`, `outcome`, `timestamp`, `sourceIp` |
| `recovery.succeeded` | Authentication notifications | High | `method`, `methodName`, `outcome`, `timestamp`, `sourceIp` |
| `recovery.failed` | Authentication notifications | High | `method`, `methodName`, `outcome`, `timestamp`, `sourceIp` |
| `recovery.failedRepeatedly` | Authentication notifications | High | `method`, `methodName`, `outcome`, `timestamp`, `sourceIp`, `count` |
| `configuration.changed` | Configuration changed outside caddy/ui | High | `instance`, `changed`, `detectedAt`, `historyEntry` |
| `configuration.changedRepeatedly` | Configuration changed outside caddy/ui | High | `instance`, `changed`, `detectedAt`, `historyEntry`, `count` |
| `test` | **Test notification** button | Low | None |

Variables are filled in as text. `instancePrefix`, for example, is empty on a single-instance installation, so messages only name the instance when there's more than one. A line of a message is left out when all of its variables are empty, which is how the history entry line disappears when no history entry was recorded.

| Variable | Contents |
| --- | --- |
| `instance` | Name of the instance the event is about |
| `instancePrefix` | The instance name in brackets, followed by a space, when caddy/ui manages several instances; otherwise empty |
| `upstream` | Address of the upstream, as Caddy dials it (`host:port`) |
| `label` | The upstream with the domains it serves, such as `app.example.com (10.0.0.5:8080)`, or just its address |
| `route` | Host name the route check requested |
| `failure` | Why the route check failed, such as `HTTP 502` or a connection error |
| `certificate` | Name the certificate was issued for, such as `*.example.com` |
| `days` | Whole days until expiry |
| `expiresIn` | `days` with its unit, such as `1 day` or `3 days` |
| `expiresOn` | Expiry date, as `YYYY-MM-DD` |
| `token` | Name of the API token (never its secret) |
| `versions` | Each component with an update, such as `backend v3.10.0 → v3.11.0` |
| `releaseNotes` | Link to the release notes |
| `method` | Sign-in method id: `password`, `password-totp`, `totp`, `passkey` or `recovery` |
| `methodName` | Sign-in method in words, such as `Password sign-in` |
| `outcome` | `success` or `failure` |
| `timestamp` | When it happened, as an ISO 8601 timestamp |
| `sourceIp` | IP address the attempt came from, or `unknown` |
| `count` | How many more happened during the cooldown |
| `changed` | What changed: `Caddyfile`, `live configuration`, or both |
| `detectedAt` | When the change was detected, as an ISO 8601 timestamp |
| `historyEntry` | Caddyfile history entry holding the changed file, or empty |

## Authentication notifications

Enable **Authentication notifications** on the Notifications page to send account
access events through the existing configured provider. Both this trigger and the
main notification switch must be enabled. The trigger defaults to off, including
for existing installations. There are no separate destinations or event switches.

| Event | Application log level | Notification priority |
| --- | --- | --- |
| Successful password sign-in | `info` | Normal |
| Successful password sign-in while passkeys are registered | `warn` | High |
| Successful passkey sign-in | `info` | Normal |
| Rejected password or passkey sign-in | `warn` | Normal |
| Successful account recovery | `warn` | High |
| Rejected recovery key | `warn` | High |

The first failed credential check is notified immediately. Additional failures
are counted separately for password, passkey and recovery attempts, across all
source IPs. At the end of the configured cooldown, one summary per method reports
the additional count and the latest attempt's timestamp and source IP. Successful
events are sent individually. Changing notification settings discards pending
summaries. Failure windows are held in memory and restart with the backend.

Events contain the timestamp, method, outcome and source IP resolved by Express's
configured proxy trust. They omit submitted usernames, passwords, recovery keys,
passkey assertions, tokens and session identifiers. Browser cancellation before
submitting a passkey assertion is not a backend credential check. Setup, legacy
enrollment, API-token requests and password confirmation inside an existing
session are not recorded as successful sign-ins. Requests rejected before
credential verification, such as CSRF or rate-limit failures, keep their existing
request diagnostics rather than generating authentication notifications.

Authentication event logging does not depend on notification switches, but still
respects `LOG_LEVEL`. For example, `LOG_LEVEL=error` filters out these events.
The UI's recent application-log buffer is bounded and is not a persistent audit
archive; configure Docker or host log retention if needed.

Notification delivery is best effort and never waits inside authentication or
recovery. At most eight authentication sends run concurrently; excess sends are
skipped with an application warning. Failed delivery is logged without including
provider response contents and is not automatically retried. Changing settings
does not recall a send already in progress.

## Configuration change notifications

Enable **Configuration changed outside caddy/ui** on the Notifications page to be told when drift detection finds an unexplained change to an instance's Caddyfile, live configuration or both. Both this trigger and the main notification switch must be enabled. The trigger defaults to off.

Each notification has high priority and contains the instance name, which representations changed, the detection time and, when one was recorded, the name of the matching external entry in Caddyfile history. It describes the source as unknown and outside a tracked caddy/ui operation, because detection can't tell legitimate maintenance or automation from unauthorized access. Notifications never include configuration content, diffs or changed JSON paths.

Verified caddy/ui operations don't notify. Repeated observations of the same unexplained state notify once; a distinct later change is eligible again. The first change on an instance is sent immediately, and further changes on that instance during the cooldown are summarized once it ends. Unreadable configuration is logged as unavailable, not reported as a change.

Delivery is best effort, isn't retried, and never delays drift checks, history recording or configuration operations. Failed delivery is logged as an application warning. Changing notification settings or removing the instance discards a pending summary.

{{#include ../../README.md:prometheus-metrics}}

{{#include ../../README.md:homepage-widget}}
