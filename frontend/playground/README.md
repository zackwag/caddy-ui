# Localization playground

From `frontend/`, run `npm ci` followed by `npm run i18n:preview`.
Open http://127.0.0.1:5174. No backend, Docker container, account, or API mocks are required.
`npm run i18n:preview:build` produces a separate `dist-playground/` build; the production entry and build are unchanged.

Search canonical English keys or saved values, choose an installed locale, and select a key.
Registered component states appear above the English reference and saved locale value.
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
- `captures/dashboard.json`: generated running, empty-server, and stopped-Caddy responses.
- `workbench.css`: contributor layout.
- `vite.config.js`: separate entry, dev server, and output directory.

To add coverage, reuse a production component in `fixtures.jsx` and register a unique ID,
title, renderer kind, and its keys in `registry.jsx`. For API-driven components, add a real
capture scenario and refresh its records. Do not manually write a second response contract.
One state may cover several keys, and shared keys can occur in several states.

Current states cover the Dashboard with running/stopped Caddy and no HTTP servers, its loading
view, label-edit dialog, and successful label save; route/certificate confirmations and a
notification toast remain available. Unregistered keys explicitly show that no fixture exists.
The label dialog is opened through the production edit action, and the saved-label state runs
the actual Save handler against its recorded response. Navigation stays inside the selected
component preview; this tool is not a replacement for testing the complete application.

## Real capture and lightweight replay

Capture requires a working Docker CLI/Engine, a Unix Docker socket accessible to the backend,
and `npm ci --prefix backend` from the repository root. Capture runs in a fresh Docker namespace
using the existing disposable harness. It starts the real backend on a private Unix socket,
enables metrics through the real API, removes HTTP servers through Caddy's admin API, and stops
its own Caddy instance to obtain failure responses. Cleanup runs on success, failure, and
SIGINT/SIGTERM. A failed capture keeps the previous JSON file. No existing development instances
or production configurations are modified. Use Linux CI, a Dev Container, or WSL for capture;
the ordinary playground preview requires neither Docker nor a backend.

From `frontend/`:

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
Numeric measurements remain as observed and are frozen during replay. Regeneration is not
expected to be byte-identical across machines. Do not hand-edit generated responses.

The **Localization preview data** workflow publishes an artifact on relevant `main` changes
or manual dispatch once the workflow is on the default branch. It runs real capture assertions,
not the playground or its browser check. Download the artifact, review the diff, and replace
`captures/dashboard.json` in a normal commit. It does not push commits or open PRs.

The preview warns if the capture fingerprint differs from its current backend/Dashboard/API
sources or backend dependencies. Source changes restart the dev server to recompute the
fingerprint; this reload discards drafts. The production application build is unchanged.
Unrecorded requests, query variants, write bodies, and unsupported transports fail visibly;
there is no forwarding to a live backend. Loading is an explicit UI state, not an invented
server response. Backend-provided strings stay as returned and may have no translation key.

## DOM context and browser agents

The frame observes the keys, resolved values, and interpolation parameters used by production
components. It highlights matching text or `placeholder`, `title`, and `aria-label` attributes.
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
npm test
npm run lint -- --max-warnings=0
npm run i18n:preview:build
# Install a Playwright browser once, or use an already installed Chromium:
npm exec -- playwright install chromium
npm run i18n:preview:check-browser
# Alternative for a system browser:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run i18n:preview:check-browser
```

The browser check starts and stops its own Vite server on an OS-assigned port. It needs no
backend or Docker and is not invoked by CI. An API connection-error log during its deliberately
unrecorded-write probe is expected. Existing frontend unit/lint checks still cover the tool.

Confirmation actions remain inert. Their normal keyboard listeners are confined to their frame.
The light toggle applies an actual production palette to the preview. Prepared action-generated
messages are rebuilt on draft/locale changes so cached messages update without changing app code.

Tool relocation belongs to a separate maintenance change; the current entry remains in `frontend/playground/`.
