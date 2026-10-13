# Documentation

The mdBook site is authored as individual Markdown pages in `docs/src/`.
`SUMMARY.md` defines their sidebar order and nesting. New contributors should
start with [documentation onboarding](src/contributing-documentation.md).

The root README remains canonical for environment variables, API endpoints, the
Compose example, and all content selected for Docker Hub. Book reference pages
use mdBook's built-in `{{#include}}` syntax with named `ANCHOR` / `ANCHOR_END`
regions in `README.md`. Edit the shared source there; write detailed explanations
and contribution guides in the book. The project-tree preprocessor generates the
repository overview during each build; no separate preparation command is needed.

## Build and preview

Install the prebuilt [mdBook 0.5.4 binary](https://github.com/rust-lang/mdBook/releases/tag/v0.5.4)
for your environment and put it on your `PATH`. Install Node.js 22.12 or newer, then
install the pinned Mermaid dependency once (repeat after lockfile changes):

```sh
npm ci --prefix docs --ignore-scripts
```

No Rust toolchain or extra mdBook plugin binary is needed. Mermaid's standalone
browser bundle is copied into the book, so published diagrams work offline.

From the repository root:

```sh
mdbook build docs
mdbook serve docs --hostname 127.0.0.1 --port 3000
```

Open `http://localhost:3000`. For a devcontainer, use `--hostname 0.0.0.0` and
forward port 3000 in VS Code. Changes to the book and its included README sections
are rebuilt automatically by the running server.

Check changed pages, navigation, links, code examples, and light/dark themes.
If you edited Docker Hub source blocks, also run
`node .github/scripts/dockerhub-docs.mjs --dry-run` with Node.js from the repository root.

## Styling and assets

Screenshots live in `docs/src/screenshots/`; the root README also references them.
The localization coverage SVG lives in `docs/src/assets/` so mdBook copies it
into the site. Regenerate it with `npm run i18n:coverage --prefix frontend`.
The book's favicon is copied from the frontend logo. `docs/theme/palettes.css`
contains the frontend's default VT2026 and CoarseEverywhere color tokens copied
at migration time. Keep those tokens in sync when changing the frontend defaults.
`docs/theme/caddy-ui.css` maps those tokens to mdBook controls and layout rules.
Fonts use the frontend families with local system fallbacks.

Source pages and assets are checked in; rendered `docs/book/` output and installed
`node_modules/` are ignored by Git. Mermaid code fences render as diagrams and
follow the light/dark theme. Invalid diagrams fall back to readable source and
report the error in the browser console.

## Generated project structure

`docs/src/project-structure.md` contains a `{{#project-structure}}` placeholder.
`docs/scripts/project-structure.mjs` expands it during `mdbook build` and `serve`,
using tracked and new non-ignored repository files. Deleted files disappear;
dependencies, generated output, and ignored files are excluded.

Add annotations in `docs/project-structure-notes.json`, using repository-relative
paths as keys and a trailing slash for directories. Existing annotations survive
every build because the preprocessor never rewrites that file. Notes for absent
paths remain stored but are not displayed; update their keys when renaming files.
Explanations outside the placeholder in the Markdown page are also preserved.
Source directories are watched during `mdbook serve`; run a build after changing
files outside those watched directories.

```sh
npm test --prefix docs
```

## GitHub Pages

The Documentation workflow builds and uploads a preview artifact on PRs. Pushes
to `main` build and publish the book. Select **GitHub Actions** under the repository's
**Settings → Pages → Build and deployment → Source** before deploying.

The workflow derives the site path from the repository name for project Pages
sites, including renamed forks. A user/organization Pages repository uses `/`.
For a custom domain, set `site-url` in `book.toml` to its serving path and remove
the workflow's `MDBOOK_OUTPUT__HTML__SITE_URL` override.

Pages deployment does not run from PRs. Repository Pages access and any configured
`github-pages` environment approval are required for deployment.
