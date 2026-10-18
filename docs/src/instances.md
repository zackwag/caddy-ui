# Multi-Instance

caddy/ui can manage multiple Caddy instances from a single interface. There are two modes for accessing Caddy's files, and you can mix them per-instance:

| | Docker mode | Local mode |
|---|---|---|
| **How it works** | `docker exec` via the Docker socket | Direct filesystem reads/writes |
| **Volumes needed** | Docker socket only | Caddy's Caddyfile, logs, and data dirs mounted into the backend |
| **Auto-discovery** | Yes | No |
| **Container Name field** | Set to the Caddy container name | Leave empty |

## Docker mode (recommended)

Mount the Docker socket into the backend and let caddy/ui talk to Caddy containers via `docker exec`. No per-instance volume mounts needed.

On first launch with no `CADDY_ADMIN_URL` set and no `instances.json`, caddy/ui starts with zero instances and redirects to the **Instances** page. From there:

1. Click **Discover** — caddy/ui scans the Docker network for running Caddy containers
2. Click **Add** on a discovered container — the form is pre-filled with the container's name, admin URL, and environment variables
3. Review and save

That's it. The instance appears in the sidebar and all pages load its data. Discovery also polls automatically every 30 seconds, so new containers appear on their own.

To add more instances, put them on the same Docker network and they'll show up in discovery:

```yaml
  caddy-staging:
    image: caddy:latest
    container_name: caddy-staging
    # ... ports, volumes, environment for the staging Caddy
    networks:
      - caddy-ui
```

## Local mode (no Docker socket)

If you can't or don't want to mount the Docker socket, leave the **Container Name** field empty when adding an instance. caddy/ui will access Caddyfiles, logs, and certificates directly from the filesystem and use the bundled `caddy` binary for formatting, validation, and version detection. Reloads go through the instance's admin API.

This requires mounting each Caddy instance's files into the backend container:

```yaml
  caddy-ui-backend:
    volumes:
      - /docker/caddy-ui:/etc/caddy-ui
      - /docker/caddy/Caddyfile:/etc/caddy/Caddyfile
      - /docker/caddy/logs:/var/log/caddy
      - /docker/caddy/data:/data
```

Mount each directory at the same path the Caddy container uses. The official Caddy image keeps its data in `/data/caddy` (certificates are in `/data/caddy/certificates`), so mounting the same host directory at `/data` lets the default **Data Path** of `/data/caddy` work unchanged. If you mount it elsewhere, point **Data Path** at the directory that contains `certificates`.

Then add the instance manually on the Instances page with Container Name left empty. The paths in the instance config must match where the files are mounted in the backend container.

> **Permissions:** The backend image runs as root, so it can read Caddy's files with no changes, including the private keys Caddy creates with owner-only permissions. You don't need to change the user Caddy runs as. If you run the backend as a non-root user (a `user:` setting, rootless Docker, or Podman), that user needs read access to Caddy's data directory and logs, and write access to the Caddyfile and the directory containing it (caddy/ui writes a temporary file there to validate edits). If the TLS page is empty, the backend log says whether the certificates path was missing or unreadable.

> **Note:** When managing multiple instances in local mode, the mount paths can't collide. Two Caddy instances both using `/etc/caddy/Caddyfile` inside their own containers would need to be mounted to different paths in the backend (e.g., `/etc/caddy-prod/Caddyfile` and `/etc/caddy-staging/Caddyfile`). The same goes for data directories: only one instance can use `/data`, so mount another at e.g. `/data-staging` and set its **Data Path** to `/data-staging/caddy`.

## Instance switcher

When more than one instance is configured, an instance switcher dropdown appears in the sidebar showing each instance with its online/offline status. Switching instances navigates to the Dashboard and reloads all data from the selected instance.

If the selected instance is removed, from this browser or another, caddy/ui drops the selection and reloads the current page from the fallback instance.

### Selecting an instance in API requests

Instance-scoped endpoints read the instance id from the `X-Instance-Id` header:

- **Header omitted, or set to `default`:** uses the instance with id `default`, or the first configured instance if none has that id.
- **Any other id that doesn't exist:** the request is rejected with `404` and `{ "code": "INSTANCE_SELECTION_INVALID" }` and never reaches another instance.
- **No instances configured:** `503` with `{ "code": "NO_INSTANCES" }`.

### What's per instance and what's shared

**Per instance.** Each instance has its own copy, and it's only shown when that instance is selected:

- Caddyfile and its saved history.
- Routes, TLS certificates, access logs and metrics.
- Uptime history.
- Server labels.
- Maintenance mode.
- Route notes.

Two instances can use the same hostname without sharing any of these.

**Shared by every instance.** These don't need an instance and keep working when none is configured:

- Appearance and language settings.
- Route table columns and route check settings.
- Custom themes.
- Notification settings.
- caddy/ui's own logs.
- Sign-in.

Route notes saved before notes were per instance are copied to every instance that serves the note's domain, so each instance keeps showing what it showed before. After that, each copy is edited separately. Notes for a domain no instance serves are removed by the usual startup cleanup. When an instance is removed, its notes are kept aside rather than handed to a new instance that reuses its id. An instance that serves the same domains can pick them up.

## Manual configuration

Instances can also be configured via the REST API (`POST /api/instances`) or by placing an `instances.json` file at `/etc/caddy-ui/instances.json`:

```json
[
  {
    "id": "production",
    "name": "Production",
    "adminUrl": "http://caddy:2019",
    "configPath": "/etc/caddy/Caddyfile",
    "logPath": "/var/log/caddy/access.log",
    "dataPath": "/data/caddy",
    "containerName": "caddy",
    "serverName": "srv0"
  },
  {
    "id": "local-caddy",
    "name": "Local Caddy",
    "adminUrl": "http://localhost:2019",
    "configPath": "/etc/caddy-local/Caddyfile",
    "logPath": "/var/log/caddy-local/access.log",
    "dataPath": "/data/caddy-local/caddy",
    "containerName": "",
    "serverName": "srv0"
  }
]
```

Set `containerName` to the Docker container name for Docker mode, or `""` for local mode.

## Backward compatibility

Setting `CADDY_ADMIN_URL` still creates a default instance on startup for existing deployments. Remove it to use discovery-based setup instead.
