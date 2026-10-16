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

{{#include ../../README.md:custom-nginx}}
