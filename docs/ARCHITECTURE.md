# Architecture Decisions for ScanIt

## Purpose

This document explains the architectural choices for ScanIt, how configuration drives runtime behavior, and where to extend the system safely.

## 1) Core Architectural Style

ScanIt uses a **modular monolith** architecture:
- Single deployable Node.js service for operational simplicity.
- Internally separated modules with explicit interfaces.
- Strongly typed contracts shared across frontend and backend.

Why this choice:
- Easier deployment for home/self-hosted environments.
- Lower operational overhead than microservices.
- Maintains strong boundaries for future extraction if scale demands it.

## 2) Configuration-Driven Runtime

### Principle
Configuration files are the single source of truth for behavior.

### What is in config
- Scanner definitions and defaults.
- Scanners, presets, and workflows.
- Workflow actions, destinations, naming templates.
- Integration endpoints and feature toggles.
- Retry/timeout and processing policies.
- PDF generation and optimization behavior (`processing.pdf.engine`, `processing.pdf.optimize`).

### What is NOT in config
- Runtime job state.
- Historical scans and transient events.
- Generated files/artifact metadata.

### Runtime model
1. Loader reads YAML config.
2. Validator enforces schema + semantic checks.
3. Runtime keeps immutable snapshot with version/hash.
4. Watcher reloads on safe change detection.
5. Failed reload retains last-known-good snapshot.

This yields idempotent startup and deterministic behavior from config.

## 3) Technology Choices and Rationale

### Vue 3 + Composition API + TypeScript
- Composables map cleanly to domain concerns (jobs, events, config diagnostics).
- Fine-grained reactivity for scan progress updates.
- Type-safe view models shared via `src/shared` contracts.

### Node.js + Express + TypeScript
- Mature ecosystem for process orchestration and CLI integration.
- Express keeps API composition straightforward and explicit.
- Easy SSE implementation for one-way real-time updates.

### SQLite for operational state only
- Excellent fit for local/self-hosted deployment.
- Reliable and minimal ops burden.
- Schema used only for jobs/history/queue events.

### SSE for live updates
- Simplifies real-time status delivery versus full WebSocket complexity.
- Ideal for server → client event streams (job progress, queue state, config reload alerts).
- Easy fallback/reconnect behavior.

### SANE integration through process wrappers
- Real-world compatibility with existing scanner tooling.
- Isolates finicky command behavior in adapter module.
- Keeps the rest of codebase scanner-provider-agnostic.

## 4) Module Boundaries

### `config` module
- Owns config parsing, validation, normalization, and hot-reload.
- Exposes read-only runtime snapshot API.
- No dependency on scanner/pipeline internals.

### `scanner` module
- Owns scanner discovery, capabilities, and capture execution.
- Exposes provider interface:
  - discover devices
  - fetch capabilities
  - execute scan/preview
- Hides SANE command details and parsing logic.

### `pipeline` module
- Owns file transformations and output generation.
- Stateless per operation where possible.
- Receives typed options from config snapshot and job request.

Current implementation note:
- Shared PDF assembly/optimization is centralized in the backend service layer (`JobService.ensurePdfFromPages`) as the single source of truth for all callers.

### `integrations` module
- Owns outbound delivery adapters (Paperless etc.).
- Depends only on generic artifact/job contracts.
- No direct coupling to scanner internals.

### `store` module
- Owns database schema migrations + repository interfaces.
- No business logic beyond persistence concerns.

### `server` module
- Owns API transport concerns (HTTP, SSE, middleware).
- Coordinates application services.
- Avoids domain logic in route handlers.
- Provides integration-facing artifact utilities via `IntegrationHost` so adapters can trigger shared pipeline behavior without duplicating implementation.

### Shared PDF Artifact Path (Current Decision)
- PDF creation is centralized in one function: `JobService.ensurePdfFromPages`.
- All current callers use this path (API download endpoint and Paperless delivery flow).
- Creation strategy: `img2pdf` first, ImageMagick `convert` fallback.
- Optional post-build optimization is controlled by config (`processing.pdf.optimize`).
- Optimization strategy: `qpdf` first, Ghostscript fallback.
- Optimization is non-destructive: the optimized artifact replaces the original only if file size is reduced.
- Existing cached `output.pdf` is reused to avoid duplicate processing.

### `client` module
- Owns rendering, interaction, and API client state.
- No hidden config state; source of behavior is backend-config snapshot.

## 5) Application State Separation

ScanIt explicitly separates three state classes:

1. **Configuration state** (declarative, versioned by file hash)
   - Source: YAML config file + env interpolation.
   - Lifetime: persistent by file.

2. **Ephemeral execution state** (in-memory)
   - Source: active queue workers and in-flight scan events.
   - Lifetime: process-lifetime, reconstructable.

3. **Operational persistent state** (SQLite)
   - Source: completed/failed jobs, artifacts, upload attempts.
   - Lifetime: durable history and observability.

This separation prevents configuration drift and simplifies debugging.

## 6) Error Strategy

### Error categories
- `ConfigError` (syntax/validation/semantic mismatch)
- `ScannerError` (SANE CLI failures, timeouts, no-device)
- `PipelineError` (PDF/image processing issues)
- `IntegrationError` (destination/API upload issues)
- `SystemError` (filesystem, DB, unexpected)

### Handling principles
- Map internal errors to stable public error codes.
- Include user-safe message and optional remediation hint.
- Log detailed diagnostics with redacted secrets.
- Never crash on recoverable errors.

## 7) Extensibility Points

### Scanner providers
- `ScannerProvider` interface allows adding non-SANE backends.
- Future: TWAIN, WIA bridge, cloud scanner APIs.

### Integration adapters
- `DestinationAdapter` interface for Paperless and future systems.
- Future adapters: S3, Nextcloud, email gateway, custom webhooks.
- Adapters should consume host-provided artifact utilities (for example PDF assembly) instead of implementing their own conversion logic.

### OCR engines
- `OcrEngine` contract in pipeline.
- No-op engine enabled by default; optional plugin activation by config.

### Naming templates
- Template resolver with controlled variables.
- Extend via pure functions without touching scanner layer.

## 8) Config Hot-Reload Boundaries

Reloadable without restart:
- Presets, workflows, naming templates.
- Destination routing and non-critical processing defaults.
- UI hints and preset defaults.

Restart recommended/required:
- Low-level scanner backend binary paths.
- DB connection path changes.
- Fundamental server bind settings.

On unsupported live change, API reports `requires_restart` in config diagnostics.

## 9) Security and Secrets

- Secrets are referenced through env placeholders in config.
- Effective runtime config redacts secrets in API responses/logs.
- Output and config directories run as least privilege in container.
- Health checks avoid leaking internals.

## 10) Observability

- Structured logs to stdout for container-native collection.
- Job event timeline persisted for auditability.
- Health/readiness endpoints with dependency summaries.
- Config validation diagnostics endpoint for immediate troubleshooting.

## 11) Future Evolution

Planned evolution paths that preserve current architecture:
- Split queue worker into separate process if throughput increases.
- Replace SQLite with Postgres if multi-instance deployment emerges.
- Promote adapters into plugin packages while keeping same interfaces.
- Add auth middleware while maintaining scan workflows.

The architecture is intentionally conservative for reliability and maintainability while keeping clear seams for growth.
