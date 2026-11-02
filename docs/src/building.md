# Building and custom Nginx

## Building from Source

```bash
docker build -t caddy-ui-backend ./src/backend
docker build -t caddy-ui-frontend ./src/frontend
```

The backend image copies the Caddy binary from `caddy:latest` at build time for `caddy fmt` formatting and version detection. To pin to a specific Caddy version, change the `COPY --from=caddy:latest` line in `src/backend/Dockerfile` before building:

```dockerfile
COPY --from=caddy:v2.11.2 /usr/bin/caddy /usr/bin/caddy
```

If you run Caddy outside of Docker (e.g. systemd), the backend will still work correctly — `caddy fmt` and version detection will degrade gracefully if the binary version doesn't match or is unavailable.

## Published release images

Every successful stable release builds and tags both the backend and frontend
images with the release version, even when only one component's code changed.
Release notes list both image pull commands. The stable version manifest records
only images whose publication succeeded; a failed build can leave a partial
publication and does not establish a complete image pair.

The Release workflow's manual rebuild also produces both images from the selected
tag, using the workflow on `main`. Rebuilding an older single-image release may
therefore add a component tag that was never previously published. The manual
rebuild does not update `latest` or the stable version manifest/release notes.

## Refreshing published base images

Stable (`release.yml`), edge and beta publication builds use `pull: true` to check
for current versions of every referenced base image. This includes the backend's
Node runtime and copied Caddy image, and the frontend's Node build stage and Nginx
runtime. Dependency and application layers can still use the existing GitHub
Actions build cache when their inputs are unchanged.

Refreshing `node:26-alpine`, for example, picks up updates available under that
tag; it does not upgrade the Dockerfile to another Node major. Runtime upgrades
require a separate change and validation.

The refresh only happens when an image build runs. Stable and beta builds always
build both images, while edge builds only the images whose files changed in the
push to `main`. There is no scheduled rebuild, automatic replacement of
previously published stable tags, or guarantee that refreshed images contain no
vulnerabilities. For a local build, add `--pull` to the commands under
[Building from Source](#building-from-source) to request the same base-image
refresh.

The workflow settings are checked by `npm run test:workflows` after installing
the dev package dependencies.

{{#include ../../README.md:custom-nginx}}
