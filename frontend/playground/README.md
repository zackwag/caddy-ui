# Localization playground

From `frontend/`, run `npm ci` followed by `npm run i18n:preview`.
Open http://127.0.0.1:5174. No backend, Docker container, account, or API mocks are required.
`npm run i18n:preview:build` produces a separate `dist-playground/` build; the production entry and build are unchanged.

Search canonical English keys or saved values, choose an installed locale, and select a key.
Registered component contexts appear above the English reference and saved locale value.
Typing in **Try translation** updates every matching preview. Drafts are kept separately per
language for the current session only. **Copy value** or **Copy key** transfers plain text to
your clipboard; paste it into the appropriate locale file yourself. Reset restores the saved
value (or English fallback). Reloading discards every draft. Clipboard access requires localhost
or a secure context; if unavailable, select the text and copy manually.

Missing translations remain missing; the editor initially shows the English fallback without
adding it to the saved locale. Interpolation placeholder differences produce a warning.
The contributor tool's own labels are English and are outside the production locale schema.
Non-English translations must still be human-authored or human-reviewed under CONTRIBUTING.md.

## Structure

- `main.jsx`: import installed catalogs, apply existing production styles, initialize an isolated i18next instance.
- `model.js`: canonical key indexing, saved-value lookup, placeholder inspection, isolated resources.
- `Workbench.jsx`: searchable key list, gallery, per-language drafts, reference/editor panes, clipboard.
- `registry.jsx`: component states and the translation keys each state renders.
- `fixtures.jsx`: small wrappers around real production components with deterministic data.
- `workbench.css`: contributor layout and scoped containment of production overlays.
- `vite.config.js`: separate entry, dev server, and output directory.

To add coverage, export a fixture from `fixtures.jsx` and register a unique ID, title, Component,
and every rendered key in `registry.jsx`. One state may cover several keys, and shared keys can
surface several states. Prefer actual production components accepting props; do not recreate
screens and present them as exact production previews. The initial states cover route deletion,
certificate deletion with interpolation, and a notification success toast (five distinct keys).
Unregistered keys explicitly show that no component fixture exists. No API requests are made.

Dialog actions are inert in fixtures. Their normal keyboard listeners remain active, and their
fixed overlays are contained by scoped gallery styles. State-dependent text should be translated
inside the fixture's render so live edits update it. The light toggle changes preview colors only.

Run `npm test`, `npm run lint -- --max-warnings=0`, and `npm run i18n:preview:build` before contributing.
