# Localization playground

From the repository root:

```sh
npm ci --prefix src/frontend
npm ci --prefix dev
npm run i18n:preview
```

The frontend owns the real application components and catalogs; `dev/package.json`
owns the preview's browser/build dependencies. Existing frontend preview commands
remain forwarding aliases, while the root commands are the shared entry points.
Open http://127.0.0.1:5174. No backend, Docker container, account, or API mocks are required.
`npm run i18n:preview:build` produces a separate `src/frontend/dist-playground/` build; the production entry and build are unchanged.
Preview, build and browser-check commands prepare the generated Caddyfile editor mode through
the existing fetch script. A clean checkout needs network access for that first fetch; later
fetch failures can use the existing local copy.

Search canonical English keys or saved values, choose an installed locale, and select a key.
Registered component states appear above the English reference and saved locale value.
Keys with a registered live preview have a small accent dot beside their name in the key list;
the legend and tooltip explain it. The marker is independent of the saved translation's status.
Choose a state in **Component state**. Each preview mounts actual production components
and styles in its own frame, with its own translation instance and in-memory storage.
Typing in **Try translation** updates every matching preview. Drafts are kept separately per
language for the current session only. **Copy value** or **Copy key** transfers plain text to
your clipboard; paste it into the appropriate locale file yourself. Reset restores the saved
value (or English fallback). **Copy preview link** shares the selected key, locale, and state;
draft text is never included in the URL. Reloading discards every draft. Clipboard access requires localhost
or a secure context; if unavailable, select the text and copy manually.

Missing translations remain missing; the editor initially shows the English fallback without
adding it to the saved locale. Interpolation placeholder differences produce a warning.
The contributor tool's own labels are English and are outside the production locale schema.
Non-English translations must still be human-authored or human-reviewed under CONTRIBUTING.md.

## Structure

- `main.jsx`: import installed catalogs, apply existing production styles, initialize an isolated i18next instance.
- `model.js`: canonical key indexing, saved-value lookup, placeholder inspection, isolated resources.
- `Workbench.jsx`: searchable key list, gallery, per-language drafts, reference/editor panes, clipboard.
- `registry.jsx`: component states and their registered translation keys.
- `fixtures.jsx`: wrappers around real production components, including Dashboard.
- `frame.jsx`: isolated rendering, production locale formatting, replay, and state preparation.
- `dom-context.js`: matching observed translations to actual text nodes and attributes.
- `PreviewFrame.jsx`: frame communication, DOM references, and visible replay failures.
- `capture.mjs` / `capture-source.mjs`: real Caddy capture and source provenance.
- `capture-format.js`: capture validation and strict request/response replay.
- `captures/dashboard.json`: generated Dashboard, default notification, Metrics and access-log responses.
- `workbench.css`: contributor layout.
- `vite.config.js`: separate entry, dev server, and output directory.

To add coverage, reuse a production component in `fixtures.jsx` and register a unique ID,
title, renderer kind, and its keys in `registry.jsx`. For API-driven components, add a real
capture scenario and refresh its records. Do not manually write a second response contract.
One state may cover several keys, and shared keys can occur in several states.

Current states cover the Dashboard with running/stopped Caddy and no HTTP servers, its loading
view, label-edit dialog, and successful label save; route/certificate confirmations and a
notification toast remain available. Unregistered keys explicitly show that no fixture exists.
Registered states cover 285 distinct keys. The onboarding and appearance states add 27:

| Production component | Prepared states | New keys |
| --- | --- | ---: |
| `Login` | Normal form and expired session | 5 |
| `ThemeWelcome` | Dark and light palette selection | 14 |
| `ThemePicker` and `LanguagePicker` | Open theme menu in dark and light mode | 8 |

These use the actual components, built-in `THEME_LIST`, and installed locale list. They
need no server responses or new captures. Theme choices and mode toggles stay in frame-local
state. The workbench's light/dark button still controls the surrounding preview palette.
Language selectors and the welcome dialog's Apply action do not persist settings; choose the
preview language in the workbench. The theme export button can download the real built-in
theme JSON, using the production exporter. Custom-theme branches and native optgroup labels
are not counted as visible registered keys in this batch.

The sign-in form has no recorded authentication endpoint. Submitting it deliberately fails
through the existing strict replay guard and shows an unrecorded-request warning; it cannot
contact a backend or create a session. Authentication loading/failure states need real
capture support before they can be registered. Session-expired wording is rebuilt on locale
and draft changes, including translations that the production component caches at mount.

Six notification settings states add another 30 keys: disabled ntfy, Discord, Slack, Pushover,
custom webhook, and locally enabled ntfy. Each mounts production `Notifications` using the
same captured `GET /notifications/config` response from a fresh backend's private state.
The provider selector and enable button prepare their states through the real form handlers;
these changes stay inside the frame. Triggers, cooldown hints, provider instructions, and
Pushover placeholders are registered alongside their actual controls. Native option-only
labels and transient saving/sending messages are not counted as visible coverage.

All captured provider destinations and credentials are empty. The capture neither enables
notifications nor contacts a notification service. No notification PUT/POST responses are
recorded, so Save and Test notification fail visibly through the replay guard; they cannot
persist configuration or send notifications. Returning to another prepared state resets
local form values from the captured defaults. Translation edits within a state preserve form
values. The standalone preview still needs no running backend or Docker.

Five observability states add 43 distinct keys: 15 Metrics labels/hints, 12 access-log labels,
search/plural messages, six uptime controls/empty states, and ten shared controls. They mount
production `Metrics` (including `UpstreamUptime`) and `Logs`. The existing real-Caddy capture
now records the Metrics/auth/configuration/route reads and access-log/default configuration
reads from its isolated instance. It sends one real health request and one deliberate 503
request to seed access logs and metrics. Client addresses in the saved log lines are normalized
to documentation-only addresses. No response contract is written by hand.

The Metrics configuration opens through its production header; route checks toggle only local
fixture props and replay existing reads. They do not persist settings or probe external sites.
The Logs preview opens its production form and can enable its controls locally. The captured
log-settings API defaults remain disabled even though the harness Caddyfile writes access logs;
this distinction is preserved. The filtered state uses the production search URL parameter,
and the disabled state shows the untouched API defaults. Form edits survive translation edits
within a state; changing the prepared state restores the captured defaults.

Refresh and log export use the recorded reads/local production exporter. No Metrics or Logs
configuration writes or live SSE streams are recorded. Save, the Caddy Metrics toggle, switching
to unrecorded application logs, and live streaming remain behind the existing strict replay
guard. They cannot contact a backend. Transient saving/refreshing text and the Live button's
unrecorded Stop state are not counted as registered coverage. The Live and Save labels share
a single text node with their leading symbols; the exact DOM matcher cannot identify them
separately, so they are not registered in these states. Use `metrics-overview`,
`metrics-route-checks`, `logs-configured`, `logs-filtered`, and `logs-disabled` in preview links.

Seven TLS and sidebar states add 33 distinct keys: 17 certificate controls, installation
instructions and empty messages, plus 16 navigation, connection and version labels.
`tls-empty`, `tls-valid`, `tls-expiring` and `tls-expired` mount production `TLS` against a
real captured empty certificate store. Filter cards use their real click handlers; Refresh
replays the same read. The rich-text root CA hint is matched across its production spans.
Certificate rows, certificate actions, loading/success messages and filter suffixes that
share a text node with a leading dash are not counted in this batch. No root CA download is
recorded; clicking Download Root CA reports an unrecorded window request without opening
a connection.

`sidebar-online`, `sidebar-stopped` and `sidebar-checking` mount production `Sidebar` with
captured version, instance-list and instance-status reads. Connected/unreachable status comes
from real running/stopped Caddy responses; checking deliberately leaves the status pending.
The preview pins the frontend version to `dev` to match the captured version query. Navigation
stays in the frame's memory router; status-refresh and sign-out callbacks are inert. The
sidebar uses a finite-height production shell to keep frame sizing stable. Update notices
and the multiple-instance switcher need their own capture scenarios and are not counted.

Six route-management and history states add another 31 distinct keys. `routes-overview`
mounts production `Routes` with captured Caddy routes, labels, notes, maintenance, TLS and
health reads. `routes-columns` opens its actual column menu and hides ID through the real
checkbox handler; these preferences stay inside the frame. `routes-add` opens the production
new-route form. `routes-filtered` uses the production filter URL parameter, while
`routes-empty` replays a real Caddy configuration with no HTTP servers. Form fields, filters
and column choices survive draft edits within a state. No route writes are recorded:
submitting Add Route fails visibly through strict replay and cannot change a backend.

`route-history-empty` mounts production `RouteHistoryModal` against actual empty history
reads for an unmonitored documentation hostname. Reading its history does not enable checks
or probe that hostname. All four range queries are captured. The profile stores its observed
epoch clock; only this frame's `Date.now()` is frozen to that value so the component's exact
`since` query parameters replay without loosening request matching. Range buttons and the
auto-refresh checkbox remain usable; other states use the normal clock. The Close callback is
inert in this standalone dialog. Populated history, relative-time messages, transient loading
states and visually hidden status text are not counted as covered by this batch.

Thirteen Caddyfile and route-edit states add 32 distinct keys. The Caddyfile states mount
production `CaddyFile`, CodeMirror, `PaneDivider`, confirmation dialogs and toasts. Capture
reads the initial empty history, then saves a comment-only revision twice through the real
API in its private instance. This creates distinct older/latest snapshots for the actual
diff, raw, identical-file and version-list views. The only replayed editor action response is
a successful validation of the exact captured buffer. Saves, reloads, snapshot deletion,
restore and import writes have no recorded response and fail visibly through strict replay.
Export also reports an unrecorded window request. No preview can change a backend.

Use `caddyfile-editor`, `caddyfile-empty`, `caddyfile-empty-list`, `caddyfile-diff`,
`caddyfile-raw`, `caddyfile-no-differences`, `caddyfile-list`, `caddyfile-valid`, and the
`caddyfile-force-confirm`, `caddyfile-restore-confirm`, `caddyfile-delete-confirm` and
`caddyfile-import-confirm` states. The force-save state prepares an unsaved comment through
CodeMirror's transaction listener. Import uses a frame-local file to open the real confirmation.
Cached confirmations and validation feedback are rebuilt when their translations change.
The editor shell has a finite height, and context refreshes retain the last iframe height to
keep responsive controls stable. The pane divider's translated accessible value is inspected
through `aria-valuetext`; its label and hint are visible on desktop layouts.

`route-edit-unavailable` opens the actual route editor for a captured route whose Caddyfile
block lookup fails. The failed read is recorded alongside its supporting reads. The title
placeholder, clear-title hint and rich-text load failure are registered inside the dialog.
Native option-only strings, transient progress messages, symbol-prefixed status text and
unrecorded save results are not counted as new coverage in this batch.

Eleven instance, certificate and populated-uptime states add 50 keys: 30 instance-management
keys, 10 certificate-row labels and 10 uptime summary/table labels. `instances-local`,
`instances-add`, `instances-edit`, `instances-invalid`, `instances-remove`,
`instances-discovery-empty`, `instances-empty` and `instances-missing-server` mount production
`Instances`. Capture starts a second real backend with separate state and a deliberately
unavailable Docker socket. It creates a local-mode instance through the API, captures its
reads while Caddy has servers and after those servers are removed, then deletes only that
private instance to capture the empty registry. Discovery's empty result is the backend's
real Docker-unavailable fallback; capture never discovers unrelated host containers. The
recorded empty-registry server-label read retains its actual HTTP 503 response.

Add/edit forms, field validation, removal confirmation and discovery use their real handlers.
Cached messages are prepared again after translation changes; ordinary form drafts stay local
and survive translation edits. No instance writes are replayed. Add, Save and confirmed Remove
report unrecorded requests. Changing the admin URL to an unrecorded destination similarly
reports a missing server lookup without contacting that destination. Discovery reads and
background polls replay the same defaults without accessing Docker or a backend.

`tls-internal-valid` and `tls-internal-orphaned` show a real `preview.internal` certificate.
Capture temporarily configures an internal-CA-only TLS listener in its disposable Caddy,
waits for issuance, reads the metadata, then removes the named host and reads its orphaned
status. It never uses ACME, requests an external hostname, or records a private key. The
orphaned state opens the production filter through its counter. Certificate removal remains
inert. Expiring, expired, superseded and external-issuer rows are not claimed in this batch.

`uptime-route-pending` mounts production `UpstreamUptime` using the captured named route and
empty recorded check statistics. Route-check toggles and exclusions change frame-local props;
they do not enable backend checks or probe the hostname. The summary shows actual missing-data
values. History for this new target has no captured requests and fails visibly if opened.
Discovered-container lists, successful instance writes, native option-only labels and visually
hidden uptime status text are not counted as new coverage.

The label dialog is opened through the production edit action, and the saved-label state runs
the actual Save handler against its recorded response. Navigation stays inside the selected
component preview; this tool is not a replacement for testing the complete application.

## Real capture and lightweight replay

Capture requires a working Docker CLI/Engine, a Unix Docker socket accessible to the backend,
and `npm ci --prefix src/backend` from the repository root. Capture runs in a fresh Docker namespace
using the existing disposable harness. It starts the real backend on a private Unix socket,
enables metrics through the real API, removes HTTP servers through Caddy's admin API, and stops
its own Caddy instance to obtain failure responses. Cleanup runs on success, failure, and
SIGINT/SIGTERM. A failed capture keeps the previous JSON file. No existing development instances
or production configurations are modified. Use Linux CI, a Dev Container, or WSL for capture;
the ordinary playground preview requires neither Docker nor a backend.
It also reads untouched notification defaults without writing provider settings or sending
test messages. The artifact retains its existing `dashboard.json` name. Its 21 profiles cover
Dashboard, notifications, metrics, logs, TLS, sidebar, routes, route history, Caddyfile history,
uptime, and instances. The capture seeds access logs and configuration changes only on its own
Caddy instance and never contacts a notification destination or remote upstream.

From the repository root:

```sh
npm run i18n:preview:capture
# Optional alternative output for reviewing a refresh before replacing the bundled data:
npm run i18n:preview:capture -- /tmp/dashboard.json
npm run i18n:preview:check-capture
```

Captures contain request methods, paths, write bodies, response statuses/headers/bodies, the
source commit, source fingerprint, and Caddy image. Normalization preserves structure and
request-ID correlations while replacing private addresses and paths and shifting ISO
timestamps together to preserve their relative spacing.
Numeric measurements remain as observed and are frozen during replay.

The shared CSRF response is captured from the authentication router and its token is replaced
with `offline-preview-context`; cookies and live context secrets are not retained. This lets
recorded successful actions keep working through the production request client. Unrecorded
actions still fail without network fallback. Native form submit handlers are enabled inside
the preview, while its `form-action 'none'` CSP blocks native form navigation.

History profile clocks and numeric epoch query parameters also remain as observed. Snapshot filenames and their
local-time timestamps retain their observed values so history request paths stay aligned. Regeneration is not
expected to be byte-identical across machines. Do not hand-edit generated responses.

The **Localization preview data** workflow publishes an artifact on relevant `main` changes
or manual dispatch once the workflow is on the default branch. It runs real capture assertions,
not the playground or its browser check. Download the artifact, review the diff, and replace
`dev/playground/captures/dashboard.json` in a normal commit. It does not push commits or open PRs.

The preview warns if the capture fingerprint differs from its current backend, Dashboard,
Notifications, Metrics, Logs, TLS, Sidebar, Routes, route history, Caddyfile, divider, diff, Instances, instance-status, uptime or
API sources or backend dependencies. Source changes restart the dev server to recompute the
fingerprint; this reload discards drafts. The production application build is unchanged.
Unrecorded requests, query variants, write bodies, and unsupported transports fail visibly;
there is no forwarding to a live backend. Loading is an explicit UI state, not an invented
server response. Backend-provided strings stay as returned and may have no translation key.

## DOM context and browser agents

The frame observes the keys, resolved values, and interpolation parameters used by production
components. It highlights matching text or `placeholder`, `title`, `aria-label`, and `aria-valuetext` attributes.
Selectors and parameters appear under **DOM selectors and interpolation values**. Repeated
wording belonging to different observed keys is marked ambiguous with dashed highlights;
these matches provide context, not proof of a unique key-to-node mapping. Empty values and
keys not visible in the selected state have no highlight.

Agents can open a link such as
`http://localhost:5174/?key=dashboard.serverIdHint&locale=en&state=dashboard-online`, choose a
state, inspect the iframe, and use `[data-preview-key="dashboard.serverIdHint"]` or the
reported `data-preview-match` selector. Source markup is never recreated in the workbench.
The translation policy in CONTRIBUTING.md still applies; this tool does not author catalogs.

## Optional checks

```sh
npm ci --prefix src/backend  # supplies ESLint for shared tooling lint
npm test --prefix src/frontend
npm run lint --prefix src/frontend -- --max-warnings=0
npm run lint:dev-caddy
npm run i18n:preview:build
# Install a Playwright browser once, or use an already installed Chromium:
npm exec --prefix dev -- playwright install chromium
npm run i18n:preview:check-browser
# Alternative for a system browser:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run i18n:preview:check-browser
```

The browser check starts and stops its own Vite server on an OS-assigned port. It needs no
backend or Docker and is not invoked by CI. An API connection-error log during its deliberately
unrecorded-write probe is expected. Frontend unit tests still cover playground logic; `npm run lint:dev-caddy` covers
the relocated tool and browser code using the shared application rules.
It walks all 27 new keys in their actual component DOM, edits and resets each one, checks
session-message refresh across locales, verifies theme-export interpolation and download,
and checks that the login card and open theme menu fit their frames without resize feedback.
It also edits and resets every one of the 30 notification settings keys, checks all five
provider states, and proves that attempted notification saves/sends do not reach a server.
It also edits and resets every one of the 43 observability keys, checks interpolation context,
local route-check toggles, log-form state retention and reset, search results, and blocked
Metrics/Logs configuration writes. These browser checks remain optional and are not added to CI.

It also edits and resets all 33 TLS/sidebar keys, checks TLS filter refresh and version
interpolation, and verifies bounded sidebar frames and blocked root CA downloads.
It also edits and resets all 31 route/history keys, checks retained form/column state, blocked
route creation, search interpolation and clearing, all four history ranges, and clock isolation.
It edits and resets all 32 Caddyfile/route-edit keys, checks pane keyboard resizing and local
editor state retention, and exercises blocked force-save, restore, delete, import and export.
It edits and resets all 50 instance/certificate/uptime keys, checks instance form retention,
blocked instance writes, discovery replay, certificate plural interpolation and local uptime
exclusion controls. Capture checks verify cleanup of both backend processes, including a
deliberate failure immediately after the second backend starts.

The standalone route/certificate confirmation fixtures remain inert. Caddyfile confirmations
run their production handlers against strict replay; unrecorded writes are blocked. Keyboard
listeners are confined to their frame.
The light toggle applies an actual production palette to the preview. Prepared action-generated
messages are rebuilt on draft/locale changes so cached messages update without changing app code.

The tool is isolated under `dev/playground/`. Application builds remain under
`src/frontend/`; shared development dependencies are installed from `dev/`.
