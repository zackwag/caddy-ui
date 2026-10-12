# Custom Themes

## Custom Themes

Drop your own palette in `THEMES_PATH` (`/etc/caddy-ui/themes` by default) — no rebuild or in-app editor needed. On startup, caddy/ui creates `themes/dark/` and `themes/light/` (with a template `README.md` in each) and scans both for `.json` files.

The folder a file lives in determines whether it shows up under "Dark theme" or "Light theme" in the picker; the filename becomes its id. Each file needs a `label` and a `vars` object defining all 18 required CSS variables (colors for background, surface, borders, text, accents, and the Caddyfile editor) — see the generated `README.md` for the full schema and an example. Invalid or incomplete files are skipped and logged, not fatal to startup.
