# Contributing to caddy/ui

You can improve caddy/ui through code, documentation, language support, and feedback.
Small, focused contributions are welcome, including clearer setup instructions
and tested examples from your own deployment.

| I want to… | Start here |
|------------|------------|
| Fix a bug, improve a view, or add a feature | [Codebase onboarding](https://zackwag.github.io/caddy-ui/contributing-codebase.html) · [Markdown](docs/src/contributing-codebase.md) |
| Improve a guide, example, or screenshot | [Documentation onboarding](https://zackwag.github.io/caddy-ui/contributing-documentation.html) · [Markdown](docs/src/contributing-documentation.md) |
| Help translate the UI | [Localization onboarding](https://zackwag.github.io/caddy-ui/contributing-localization.html) · [Markdown](docs/src/contributing-localization.md) |
| Report a problem or suggest an improvement | [Feedback guide](https://zackwag.github.io/caddy-ui/contributing-feedback.html) · [Markdown](docs/src/contributing-feedback.md) |

Documentation fixes can start in GitHub's browser editor. The documentation guide
explains where to edit, how to preview a page, and how to submit your first PR.
Code contributions use a local checkout and the relevant service's tests and lint.

## Repository boundaries

| Location | Responsibility |
| --- | --- |
| `src/backend/` | Backend application, unit/API tests and backend build dependencies |
| `src/frontend/` | Frontend application, component tests and frontend build dependencies |
| `dev/` | Disposable Caddy tools, shared integration/browser fixtures and localization playground |
| `docs/` | Documentation content, theme and book tooling |
| Root `package.json` | Stable commands that delegate to the owning package |

Application packages keep their existing internal structure and build independently.
For application and tooling checks, install dependencies from the repository root:

```sh
npm ci --prefix src/backend
npm ci --prefix src/frontend
npm ci --prefix dev
```

Shared dev lint uses both application packages. The frontend playground tests also
currently consume modules from `dev/`; aligning those tests with their owner is a
separate follow-up. See [codebase onboarding](docs/src/contributing-codebase.md)
for the commands relevant to your change.

## Before opening a PR

Keep the change focused and explain the problem and resulting behavior. Use a
Conventional Commit title (`docs:`, `fix:`, `feat:`, etc.) and run the checks in
your contribution guide. Open the PR against `zackwag/caddy-ui`'s `main` branch.
Do not edit `CHANGELOG.md` or bump versions by hand; release-please manages them.

The README remains canonical for environment variables, API endpoints, the
Compose example, and content selected for Docker Hub. Shared book references
include those sections directly. Edit explanations and onboarding in `docs/src/`;
never hand-edit the generated `src/backend/DOCKERHUB.md` or `src/frontend/DOCKERHUB.md`.

See the [contribution hub](https://zackwag.github.io/caddy-ui/contributing.html)
for the full onboarding paths, or [browse it as Markdown](docs/src/contributing.md).

## Testing with real Caddy instances

Run `npm run dev:with-caddy` from the repository root for an isolated integration
environment. See the codebase guide’s
[Disposable Caddy integration environment](docs/src/development-caddy.md) page for
prerequisites, instance commands, troubleshooting, and cleanup.
