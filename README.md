# ScanIt

Config-driven web scanning platform. Wraps SANE scanners behind a modern Vue 3 UI with real-time job tracking, multi-user profiles, and pluggable integrations (Paperless-ngx and more).

## Quick Install

Prerequisites: **Git** and **Docker** (with Docker Compose v2).

```sh
curl -fsSL https://raw.githubusercontent.com/MindCollaps/ScanIt/main/scripts/install.sh | sh
```

This clones the repo to `~/scanit`, builds the Docker image, and starts the container. Once complete:

- **Open** http://localhost:8080
- **Configure** your scanner in `~/scanit/config/scanit.yaml`

> Set a custom install directory with `SCANIT_DIR=/opt/scanit curl -fsSL ... | sh`

## Features

- **SANE scanner integration** — network and local scanners via `scanimage`
- **Config-driven** — YAML config directory with deep-merge, env interpolation, and hot-reload
- **Multi-user profiles** — separate naming templates, presets, and integration tokens per user
- **Workflows** — one-click scan-to-destination pipelines
- **Real-time updates** — SSE-powered live job progress with live page thumbnails in the browser
- **User presets** — save and manage custom scan presets per scanner
- **Page management** — reorder, interleave (duplex), append pages; lightbox zoom preview
- **Theming** — centralised CSS custom-property colour system for easy re-theming
- **Paperless-ngx integration** — profile-scoped upload with per-user tokens
- **Docker-native** — single container, `network_mode: host` for mDNS scanner discovery

## Architecture

```
Browser (Vue 3)  ←──  SSE events
       ↕ REST
Express backend  →  SANE adapter  →  scanimage / scanadf
       ↕                ↓
    SQLite         PDF pipeline → Destinations (filesystem, Paperless, …)
```

Single deployable service. Config files are the source of truth for behavior; SQLite stores operational data only.

## Configuration

ScanIt uses a config directory (`/config` inside Docker, `./config` on disk). Files are loaded alphabetically and deep-merged:

| File | Purpose |
|---|---|
| `00-system.yaml` | System defaults (shipped with ScanIt, do not edit) |
| `scanit.yaml` | Your configuration — scanners, profiles, workflows |

The app boots with zero scanners configured and shows a setup prompt in the UI. Add your scanner to `scanit.yaml`:

```yaml
version: 1

scanners:
  - id: "my_scanner"
    label: "My Scanner"
    enabled: true
    backend: "sane"
    connection:
      mode: "network"
      device: "escl:http://scanner.local"
      discover: true
    capabilities:
      adf: true
      flatbed: true
      duplex: true
    defaults:
      source: "ADF Duplex"
      mode: "Color"
      resolutionDpi: 300
      format: "png"

profiles:
  - id: "default"
    defaultScannerId: "my_scanner"
```

Changes are hot-reloaded automatically. See [examples/](examples/) for multi-user and Paperless setups.

Full schema reference: [docs/CONFIG_SCHEMA.md](docs/CONFIG_SCHEMA.md)

## Docker Compose

The default `docker-compose.yml` runs in production mode:

```yaml
services:
  scanit:
    build:
      context: .
      dockerfile: docker/Dockerfile
    restart: unless-stopped
    network_mode: host
    environment:
      SCANIT_CONFIG_DIR: /config
    volumes:
      - ./config:/config
      - ./data/output:/data/output
      - ./data/db:/data/db
```

`network_mode: host` is required for SANE to discover network scanners via mDNS/broadcast.

### Commands

```sh
# Start
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down

# Rebuild after update
git pull && docker compose up --build -d
```

## Development

```sh
# Start dev container (hot-reload for both server and client)
bun dev

# Or without Docker
bun install
bun run dev:server   # Express on :8080
bun run dev:client   # Vite on :5173
```

The dev setup uses `docker-compose.dev.yml` which bind-mounts the source tree and runs `bun --watch` for the server plus Vite HMR for the frontend.

### Useful scripts

| Script | Description |
|---|---|
| `bun run build` | Build server + client for production |
| `bun run typecheck` | Run TypeScript checks (server + client) |
| `bun run lint` | ESLint + Stylelint |
| `bun run lint:fix` | Auto-fix lint issues |
| `bun run format` | Prettier (write) |
| `bun run format:check` | Prettier (check only) |
| `bun run ci` | typecheck + lint + format:check |

## Volumes

| Mount | Purpose |
|---|---|
| `/config` | YAML config files |
| `/data/output` | Scanned documents and PDFs |
| `/data/db` | SQLite operational database |

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /healthz` | Liveness check |
| `GET /readyz` | Readiness check (config loaded) |
| `GET /api/config/status` | Config diagnostics (hash, load time, errors) |
| `GET /api/config/runtime` | Full runtime config |
| `GET /api/scanners` | Configured and discovered scanners |
| `POST /api/scanners/discover` | Trigger scanner discovery |
| `GET /api/scanners/discovered` | List previously discovered scanners |
| `GET /api/scanners/discovered/:id/capabilities` | Get capabilities for a discovered scanner |
| `GET /api/scanners/diagnostics` | SANE diagnostics report |
| `GET /api/presets` | All presets (config + user) |
| `GET /api/presets/user` | User-created presets |
| `POST /api/presets` | Create a user preset |
| `PUT /api/presets/:id` | Update a user preset |
| `DELETE /api/presets/:id` | Delete a user preset |
| `POST /api/jobs` | Start a scan job |
| `GET /api/jobs/:id` | Job details |
| `GET /api/jobs/:id/pages` | List scanned page images |
| `GET /api/jobs/:id/pages/:index` | Serve a page image by index |
| `GET /api/jobs/:id/pages/by-name/:filename` | Serve a page image by filename |
| `GET /api/jobs/:id/pdf` | Download job as PDF |
| `PUT /api/jobs/:id/filename` | Update custom output filename |
| `POST /api/jobs/:id/append` | Append more pages (re-scan) |
| `PUT /api/jobs/:id/pages/reorder` | Reorder pages |
| `POST /api/jobs/:id/pages/interleave` | Interleave pages (duplex) |
| `DELETE /api/jobs/:id` | Delete a job and its files |
| `POST /api/jobs/batch-delete` | Batch delete by IDs or state |
| `GET /api/history` | Job history list |
| `GET /api/events` | SSE event stream |

## Docs

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — design rationale and module boundaries
- [CONFIG_SCHEMA.md](docs/CONFIG_SCHEMA.md) — full configuration reference
- [PROJECT_PLAN.md](docs/PROJECT_PLAN.md) — module breakdown and data flow
- [AI_GUIDE.md](docs/AI_GUIDE.md) — contributor guide for AI assistants

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Backend**: Express 5, TypeScript, Zod v4, pino
- **Frontend**: Vue 3 (Composition API), Vite 7, vue-router
- **Database**: bun:sqlite (built-in)
- **Scanner**: SANE (`scanimage` / `scanadf`)
- **Container**: Docker (oven/bun:1 base image)

## License

ISC
