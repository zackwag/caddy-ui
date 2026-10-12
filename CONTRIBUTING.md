# Contributing to caddy/ui

You can improve caddy/ui through code, documentation, and language support.
Small, focused contributions are welcome, including clearer setup instructions
and tested examples from your own deployment.

| I want to… | Start here |
|------------|------------|
| Fix a bug, improve a view, or add a feature | [Codebase onboarding](https://zackwag.github.io/caddy-ui/contributing-codebase.html) · [Markdown](docs/src/contributing-codebase.md) |
| Improve a guide, example, or screenshot | [Documentation onboarding](https://zackwag.github.io/caddy-ui/contributing-documentation.html) · [Markdown](docs/src/contributing-documentation.md) |
| Help translate the UI after the localization foundation is merged | [Localization onboarding](https://zackwag.github.io/caddy-ui/contributing-localization.html) · [Markdown](docs/src/contributing-localization.md) |

Documentation fixes can start in GitHub's browser editor. The documentation guide
explains where to edit, how to preview a page, and how to submit your first PR.
Code contributions use a local checkout and the relevant service's tests and lint.
Localization onboarding is prepared for after [#202](https://github.com/zackwag/caddy-ui/pull/202)
merges; use it only with a checkout containing that implementation.

## Before opening a PR

Keep the change focused and explain the problem and resulting behavior. Use a
Conventional Commit title (`docs:`, `fix:`, `feat:`, etc.) and run the checks in
your contribution guide. Open the PR against `zackwag/caddy-ui`'s `main` branch.
Do not edit `CHANGELOG.md` or bump versions by hand; release-please manages them.

The README remains canonical for environment variables, API endpoints, the
Compose example, and content selected for Docker Hub. Shared book references
include those sections directly. Edit explanations and onboarding in `docs/src/`;
never hand-edit the generated `backend/DOCKERHUB.md` or `frontend/DOCKERHUB.md`.

## Reporting a problem

Open a [GitHub issue](https://github.com/zackwag/caddy-ui/issues) with the steps to
reproduce it, your caddy/ui version, what you expected, and what happened.
For larger changes, describe your proposal in an issue before doing substantial work.

See the [contribution hub](https://zackwag.github.io/caddy-ui/contributing.html)
for the full onboarding paths, or [browse it as Markdown](docs/src/contributing.md).
