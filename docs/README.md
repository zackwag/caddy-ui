# Documentation

The mdBook site renders the existing `README.md` and `CONTRIBUTING.md`. Those
files remain the canonical sources during this first migration step. Edit them
at the repository root; do not edit generated files in `docs/src/`.

The Docker Hub generator and routing markers are unchanged. Moving detailed
content into authored book chapters and reducing the root README to essential
project and setup information is a separate follow-up, together with adapting
the Docker Hub generator to those sources.

## Build and preview

Install [mdBook 0.5.4](https://github.com/rust-lang/mdBook/releases/tag/v0.5.4)
using the prebuilt binary for your platform. Node.js 22 or later is already
used by the project; no npm packages or Rust toolchain are needed for the book.

From the repository root:

```sh
node .github/scripts/prepare-book.mjs
mdbook build docs
mdbook serve docs --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000`. Rerun the preparation command after changing the
root Markdown files, screenshots, frontend logo, or frontend palettes.

The preparation script stages the two Markdown pages, screenshots, favicons,
and palette tokens. The book keeps mdBook's navigation, search, code copying,
print view, and theme controls. Its colors come directly from the frontend's
VT2026 (dark) and CoarseEverywhere (light) palettes. It uses the frontend's font
families with local system fallbacks and makes no font CDN requests.

Generated staging files and `docs/book/` are ignored by Git.

## GitHub Pages

The Documentation workflow builds and uploads a preview artifact on pull
requests. After merge, pushes to `main` build the book and publish it to
GitHub Pages. Select **GitHub Actions** under the repository's
**Settings → Pages → Build and deployment → Source** before deploying.

The workflow derives the site path from the repository name for project Pages
sites, including renamed forks. A user/organization Pages repository uses `/`.
For a custom domain, set `site-url` in `book.toml` to its serving path and remove
the workflow's `MDBOOK_OUTPUT__HTML__SITE_URL` override.

No deployment occurs from pull requests. Pages deployment requires repository
Pages access and the normal `github-pages` environment approval, if configured.
