# Paperless-ngx Integration

Uploads completed scans as PDF documents to one or more [Paperless-ngx](https://docs.paperless-ngx.com) instances. Each configured instance registers as a separate consumer type that can be assigned to destinations or preset consumers.

## Requirements

- A running Paperless-ngx instance reachable from the ScanIt host
- An API token for the target Paperless-ngx user
- `img2pdf` or ImageMagick `convert` available in the ScanIt container (used to build the PDF from scanned images)
- `qpdf` available in the ScanIt container (used for post-build PDF optimization)

See [example config](./scanit.paperless.yaml) for a minimal working configuration.

---

## Configuration

Each entry under `integrations.paperless` is an independent instance:

```yaml
integrations:
  paperless:
    - id: main           # used in consumer type: "paperless:main"
      label: "My Paperless"
      baseUrl: "https://paperless.example.com"
      tokenEnv: "PAPERLESS_TOKEN"   # preferred: read from environment
      # token: "abc123"             # alternative: inline (avoid in production)
      timeoutMs: 120000             # per-request upload timeout in ms
      verifyTls: true               # set false for self-signed certs
      # defaultDocumentType: "Inbox" # optional Paperless document type name
```

### Token options

| Option | Description |
|---|---|
| `tokenEnv` | Name of an environment variable holding the token. Preferred — keeps secrets out of config files. |
| `token` | Inline token value. Convenient for local dev; avoid in production. |

At least one of `token` or `tokenEnv` must be set.

### `timeoutMs`

Per-request HTTP timeout for the upload call. Large multi-page PDFs can take a while to transmit, so be generous — 120 000 ms (2 minutes) is a safe default. If uploads still time out, increase this value; there is no penalty for a higher number.

---

## Consumer Types

Each instance becomes a consumer type of the form `paperless:<id>`. Reference it anywhere a consumer type is accepted:

```yaml
destinations:
  - id: paperless_main
    type: integration
    adapter: paperless

presets:
  - id: doc_color
    output:
      consumers:
        - "paperless:main"
        - "filesystem"
```

Multiple instances can be targeted from the same preset:

```yaml
output:
  consumers:
    - "paperless:home"
    - "paperless:office"
```

---

## Delivery Behaviour

1. After a successful scan, ScanIt uses the shared server PDF builder to create a single PDF from all scanned page images (`img2pdf`, with ImageMagick `convert` fallback) and then applies optional post-build optimization.
2. The PDF is uploaded to `/api/documents/post_document/` using the Paperless-ngx REST API.
3. If `job.outputFilename` is set, it is used as the document title in Paperless.
4. Failed uploads are retried according to `resilience.integration.retries` and `resilience.integration.backoffMs` from the system config (defaults: 3 retries, 2 s backoff with linear back-off scaling).

The generated PDF is cached in the job output directory — repeated deliveries to different Paperless instances within the same job reuse the same file without rebuilding it.

---

## Multiple Instances

You can define as many instances as needed. IDs must be unique. Each instance connects to a different Paperless-ngx server (or different user/token on the same server).

```yaml
integrations:
  paperless:
    - id: alice
      label: "Alice's Archive"
      baseUrl: "https://paperless.home"
      tokenEnv: "PAPERLESS_TOKEN_ALICE"
      timeoutMs: 120000
      verifyTls: false

    - id: bob
      label: "Bob's Archive"
      baseUrl: "https://paperless.home"
      tokenEnv: "PAPERLESS_TOKEN_BOB"
      timeoutMs: 120000
      verifyTls: false
```
