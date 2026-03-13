# ScanIt Configuration Schema

This document defines the declarative configuration contract for ScanIt. Configuration is authoritative for runtime behavior. SQLite is not used for configuration.

## 1) Format and Loading

- Config directory: `config/` (set via `SCANIT_CONFIG_DIR` env var)
- Files are loaded alphabetically: `00-system.yaml` provides defaults, user files overlay on top.
- Deep-merge by `id` for array sections (scanners, presets, workflows, destinations).
- Environment interpolation supported: `${ENV_VAR}` and `${ENV_VAR:-default}`
- Unknown fields are rejected.
- Validation has two layers:
  1. Structural schema validation
  2. Semantic cross-reference validation

On validation failure at startup: app does not become ready.
On validation failure during hot-reload: last-known-good config remains active.

## 2) Top-Level Schema

```yaml
version: 1
app: {}
paths: {}
logging: {}
realtime: {}
resilience: {}
scanners: []
presets: []
workflows: []
processing: {}
destinations: []
integrations: {}
features: {}
```

## 3) Detailed Sections

## `version`
- Type: integer
- Required: yes
- Allowed: `1`

## `app`

```yaml
app:
  name: "ScanIt"
  host: "0.0.0.0"
  port: 8863
  baseUrl: "http://localhost:8863"
  timezone: "UTC"
  health:
    exposeDetails: false
```

Constraints:
- `port`: 1..65535
- `host`: non-empty string
- `baseUrl`: valid URL

## `paths`

```yaml
paths:
  configDir: "/config"
  outputDir: "/data/output"
  tempDir: "/tmp/scanit"
  dbFile: "/data/db/scanit.sqlite"
```

Constraints:
- Paths must be absolute in containerized mode.
- `outputDir` and db parent directory must be writable.

## `logging`

```yaml
logging:
  level: "info"       # trace|debug|info|warn|error
  format: "json"      # json|pretty
  redactKeys:
    - "token"
    - "authorization"
```

## `realtime`

```yaml
realtime:
  transport: "sse"
  heartbeatSeconds: 15
  replayBufferSize: 200
```

Constraints:
- `transport`: currently only `sse`.
- `heartbeatSeconds`: 5..60
- `replayBufferSize`: 0..5000

## `resilience`

```yaml
resilience:
  scanner:
    timeoutMs: 120000
    retries: 2
    backoffMs: 1000
  integration:
    timeoutMs: 30000
    retries: 3
    backoffMs: 2000
```

Constraints:
- All timeouts > 0
- retries: 0..10

## `scanners`

```yaml
scanners:
  - id: "office_adf"
    label: "Office ADF"
    enabled: true
    backend: "sane"
    connection:
      mode: "network"     # network|local|manual
      device: "escl:http://192.168.1.50"
      discover: true
    capabilities:
      adf: true
      flatbed: true
      duplex: true
    defaults:
      source: "ADF Duplex" # scanner-specific option text
      mode: "Color"        # Color|Gray|Lineart or backend value
      resolutionDpi: 300
      format: "png"        # png|jpeg|tiff
```

Constraints:
- `id` unique, slug format `[a-z0-9_\-]+`
- `backend`: currently `sane`
- `connection.mode=manual` requires explicit `device`

## `presets`

```yaml
presets:
  - id: "doc_300_color"
    label: "Document 300dpi Color"
    scan:
      source: "ADF Duplex"
      mode: "Color"
      resolutionDpi: 300
      brightness: 0
      contrast: 0
      pageSize: "A4"
    output:
      format: "pdf"       # pdf|images
      imageFormat: "jpeg" # jpeg|png|tiff
      jpegQuality: 88
      combinePages: true
```

Constraints:
- `id` unique
- `resolutionDpi`: 75..1200
- If `format=pdf`, `combinePages=true` implied unless explicitly false for special cases.

## `workflows`

```yaml
workflows:
  - id: "quick_scan"
    label: "Quick Scan"
    scannerId: "office_adf"
    presetId: "doc_300_color"
    destinationIds: ["local_archive"]
    askForCustomName: true
    previewBeforeScan: false
```

Constraints:
- IDs unique
- `scannerId`, `presetId`, `destinationIds[*]` must exist.

## `processing`

```yaml
processing:
  pdf:
    engine: "img2pdf"        # img2pdf|qpdf (logical mode)
    optimize: true
    metadata:
      producer: "ScanIt"
  image:
    autoRotate: true
    deskew: false
    removeBlankPages: false
    blankPageThreshold: 0.98
  thumbnails:
    enabled: true
    maxWidth: 320
    format: "jpeg"
    quality: 80
  ocr:
    enabled: false
    provider: "none"         # none|tesseract|external
    language: "eng"
```

Constraints:
- If `ocr.enabled=true`, provider cannot be `none`.

Current implementation notes:
- `processing.pdf.optimize=true` enables a post-build PDF optimization step in the shared PDF builder.
- Optimization tries `qpdf` first and falls back to Ghostscript (`gs`) if needed.
- The optimized file replaces the original only when it is smaller.
- Existing cached `output.pdf` files are reused as-is and are not re-optimized unless regenerated.

## `destinations`

```yaml
destinations:
  - id: "local_archive"
    type: "filesystem"
    enabled: true
    path: "/data/output/archive"
    namingTemplate: "{date}/{date}_{time}_{custom_name}.pdf"
  - id: "paperless_upload"
    type: "integration"
    enabled: true
    adapter: "paperless"
```

Constraints:
- `id` unique
- `type=filesystem` requires `path`
- `type=integration` requires valid `adapter`

## `integrations`

```yaml
integrations:
  paperless:
    - id: main
      label: "Paperless"
      baseUrl: "https://paperless.example.com"
      tokenEnv: "PAPERLESS_TOKEN"
      timeoutMs: 30000
      verifyTls: true
      defaultDocumentType: "Inbox"
```

Each paperless instance is registered as consumer type `paperless:{id}`.
Tokens are read from the environment variable specified in `tokenEnv`.

## `features`

```yaml
features:
  preview: true
  historySearch: true
  darkMode: true
  configDiagnosticsUi: true
```

## 4) Template Variables for Naming

Allowed placeholders:
- `{date}` (YYYY-MM-DD)
- `{time}` (HHmmss)
- `{datetime}` (ISO compact)
- `{scanner}` (scanner id)
- `{preset}` (preset id)
- `{custom_name}` (user-entered text)
- `{seq}` (job sequence number)

Rules:
- Unknown placeholders are validation errors.
- Sanitization strips path separators and control chars.

## 5) Semantic Validation Rules

1. All IDs are globally unique within their own section.
2. All references resolve:
   - workflow scanner/preset/destination references
3. Scanners, workflows, and destinations may be empty.
4. If destination references `adapter=paperless`, at least one `integrations.paperless` entry must exist.
5. `tokenEnv` values must be non-empty strings; runtime warns if env var is missing.
6. `paths.outputDir` must differ from temp dir.
7. Duplicate generated file names within same destination are avoided via suffix strategy.

## 6) Hot-Reload Matrix

Reloadable live:
- `presets`, `workflows`, naming templates, feature toggles.
- destination routing and processing defaults.

Requires restart:
- `app.host`, `app.port`, `paths.dbFile`, low-level scanner backend command paths.

If restart-required fields change, config status reports:
```json
{
  "status": "valid_requires_restart",
  "changedPaths": ["app.port"]
}
```

## 7) Example Minimal User Config

With the config-directory system, `00-system.yaml` provides all defaults.
Users only need to add their scanner and wire it up:

```yaml
version: 1

scanners:
  - id: "my_scanner"
    label: "My Scanner"
    enabled: true
    backend: "sane"
    connection: { mode: "network", device: "escl:http://scanner.local", discover: true }
    capabilities: { adf: true, flatbed: true, duplex: true }
    defaults: { source: "ADF Duplex", mode: "Color", resolutionDpi: 300, format: "png" }

workflows:
  - id: "quick"
    label: "Quick Scan"
    scannerId: "my_scanner"
    presetId: "doc_300_color"
    destinationIds: ["archive"]
    askForCustomName: true
    previewBeforeScan: false

destinations:
  - id: "archive"
    type: "filesystem"
    enabled: true
    path: "/data/output/archive"
    namingTemplate: "{date}/{date}_{time}_{custom_name}.pdf"
```

## 8) Versioning and Migration Guidance

- `version` is mandatory and currently locked to `1`.
- Future schema versions should include:
  - migration notes,
  - deprecation warnings,
  - compatibility validator for old keys.

This ensures deterministic and maintainable evolution of config-driven behavior.
