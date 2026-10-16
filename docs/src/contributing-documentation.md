# Contributing to documentation

You can help by explaining a confusing step, correcting a reference, improving a
screenshot, or adding an example from a deployment you have tested. Programming
experience is not required for a documentation contribution.

## Make your first change in the browser

1. Find the page you want to improve in
   [the book's source list](https://github.com/zackwag/caddy-ui/blob/main/docs/src/SUMMARY.md).
2. Open its Markdown file under
   [docs/src on GitHub](https://github.com/zackwag/caddy-ui/tree/main/docs/src).
   For a shared reference, use the source table below to find the right file.
3. Choose GitHub's edit button. GitHub can create a fork for your proposed change
   if you do not have write access to the project.
4. Edit a small section. Use Markdown Preview to check headings, lists, and code
   fences. Give the change a descriptive commit message such as
   `docs: clarify local-mode certificate paths`.
5. Open a pull request against `zackwag/caddy-ui`'s `main` branch. Explain what was
   confusing and how your change helps. The Documentation workflow builds the
   complete book and attaches a preview artifact to the workflow run.

Markdown Preview shows the file you edit. The mdBook build resolves shared
includes and produces the final sidebar and pages.

## Choose the source to edit

| Content | Source |
|---------|--------|
| Explanations, special cases, and contributor onboarding | The relevant page in `docs/src/` |
| Environment-variable and API references, Compose example, or other text shared with Docker Hub | The marked section in the root `README.md` |
| Short project introduction and contribution entry point | `README.md` and `CONTRIBUTING.md` |
| Screenshots | `docs/src/screenshots/` |
| Page order and nesting | `docs/src/SUMMARY.md` |
| Documentation theme | `docs/theme/` |
| Comments beside paths in the generated project tree | `docs/project-structure-notes.json` |

The book uses mdBook's built-in includes for shared references. Those references
are authored once in the README; edit the original section there. Leave the
include directive in the book page intact.

Keep the README's `dockerhub:...` routing comments and `ANCHOR` / `ANCHOR_END`
comments paired. Routing selects text for the Docker Hub generator; anchors
select excerpts for the book. Never edit `src/backend/DOCKERHUB.md` or
`src/frontend/DOCKERHUB.md` by hand.

## Preview locally

Work in a checkout of your fork. Install the prebuilt
[mdBook 0.5.4 binary for your environment](https://github.com/rust-lang/mdBook/releases/tag/v0.5.4)
and put it on your `PATH`. For a Linux devcontainer or WSL, use the Linux binary;
for a native Windows terminal, use the Windows binary. Install Node.js 22.12 or newer
and run `npm ci --prefix docs --ignore-scripts` once before building or serving.

From the repository root:

```sh
npm run i18n:coverage --prefix src/frontend
mdbook serve docs --hostname 127.0.0.1 --port 3000
```

Open `http://localhost:3000`. In a devcontainer, use
`mdbook serve docs --hostname 0.0.0.0 --port 3000` and forward port 3000 in VS Code.
The server watches authored book files and their included sources, then rebuilds
when you save a change. Check both the changed page and any pages that include it.
The coverage command generates an ignored asset from the catalogs; rerun it after
catalog changes. It does not require installing frontend dependencies.

Before submitting, build the book:

```sh
mdbook build docs
```

If you changed a marked README block, also validate the existing Docker Hub
generator from the repository root (this requires Node.js and the documentation
dependencies installed above):

The generator uses parse5's HTML tokenizer to preserve comments, tag attributes
and code elements while rewriting Markdown links. It keeps the original source
text and does not sanitize HTML. Its tests cover browser-recognized comment
endings, quoted and multiline attributes, custom tag names and nested code
elements.

```sh
node --test .github/scripts/dockerhub-docs.test.mjs
node .github/scripts/dockerhub-docs.mjs --dry-run
```

## Make the change easy to review

Use fenced `mermaid` code blocks for diagrams. They render locally in the book
and follow the selected light/dark theme; preview diagrams in the built book.
The project tree is generated automatically. Add file/directory comments in
`docs/project-structure-notes.json`, keyed by repository-relative path (directories
end in `/`). Builds preserve these annotations; update the key after a rename.

- Keep examples runnable and state any deployment assumptions.
- Preserve code indentation, environment-variable names, and paths exactly.
- Use relative links between book pages and include the target heading when useful.
- For a new page, add its Markdown file and an entry in `SUMMARY.md`.
- Give each page one `#` title and use `##` for its main sections. Shared includes
  should contain the section's content without repeating the page title; mdBook
  also adds section headings to the sidebar.
- Remove credentials and private information from examples and screenshots.
- For layout or theme changes, include a screenshot and check desktop/mobile views.

Use a `docs:` PR title. Include the page you changed, why you changed it, and
which examples or previews you checked. Generated `docs/book/` output is not
committed; the workflow builds and publishes it.
