# Architecture

<div class="docs-architecture">

{{#include ../../README.md:architecture}}

## Request flow

```mermaid
flowchart LR
    accTitle: Request flow
    accDescr: The frontend proxies API requests to the backend. The backend communicates with Caddy's admin API.
    FE["caddy/ui frontend<br/>React + nginx<br/>:9877"]
    BE["caddy/ui backend<br/>Node.js + Express<br/>:9876"]
    CA["Caddy<br/>:2019 Admin API<br/>:80 / :443"]

    FE -->|"/api/*"| BE
    BE -->|"Admin API"| CA
    BE -->|"upstream TCP checks + passive health pool"| CA
    BE -->|"Prometheus metrics"| CA
    BE -->|"/adapt validation"| CA
    BE -->|"/pki/ca/local"| CA
```

The frontend serves the interface and proxies API requests. The backend handles
Caddy operations, application settings, and instance data.

## Files and persistent data

```mermaid
flowchart TB
    accTitle: Files and persistent data
    accDescr: In Docker mode the backend accesses Caddy container files through the Docker Engine. In local mode it accesses mounted files directly. Application data is stored separately.
    BE["caddy/ui backend"]
    DOCKER["Docker Engine"]
    LOCAL["Mounted Caddy files<br/>Local mode"]
    DATA[("caddy/ui data<br/>/etc/caddy-ui")]
    FILES["Caddy container files<br/>Caddyfile, logs, certificates"]

    BE -->|"Docker socket"| DOCKER
    DOCKER -->|"exec / stream"| FILES
    BE -->|"Direct access"| LOCAL
    BE -->|"Read / write"| DATA
```

Docker mode uses container discovery and commands inside the selected Caddy
container. Local mode reads and writes paths mounted into the backend and uses
its bundled Caddy binary. Both modes communicate with the instance's admin API.
See the [instance guide](instances.md) for setup and file permissions.

## Responsibilities

<div class="docs-architecture-reference">

| Connection or storage | Purpose |
| --- | --- |
| Frontend → backend | Forward `/api/*` requests from the browser. |
| Backend → Caddy admin API | Read configuration, validate through `/adapt`, reload through `/load`, inspect the upstream health pool, and download the root CA through `/pki/ca/local`. |
| Backend → metrics and upstreams | Read Prometheus metrics; run TCP health checks and optional HTTP route checks. |
| Backend → Docker Engine | Discover Caddy containers and access their Caddyfiles, logs, and certificates through the Docker socket. |
| Backend → mounted Caddy files | Access files directly in local mode. |
| Backend → `/etc/caddy-ui` | Persist instance registrations, configuration history, route notes, settings, and application configuration. |

</div>

See the [API reference](api.md), [configuration](configuration.md), and
[integrations](integrations.md) for individual endpoints and settings.

</div>
