import { z } from 'zod';
import type { AppConfig } from '../shared/types/config.js';
import { ConfigValidationError } from './errors.js';

const scannerIdSchema = z.string().regex(/^[a-z0-9_-]+$/);
const sharedIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9_-]+$/);

const scannerSchema = z.object({
  id: scannerIdSchema,
  label: z.string().min(1),
  enabled: z.boolean(),
  backend: z.literal('sane'),
  connection: z.object({
    mode: z.enum(['network', 'local', 'manual']),
    device: z.string().min(1).optional(),
    discover: z.boolean(),
  }),
  capabilities: z.object({
    adf: z.boolean(),
    flatbed: z.boolean(),
    duplex: z.boolean(),
  }),
  defaults: z.object({
    source: z.string().min(1),
    mode: z.string().min(1),
    resolutionDpi: z.number().int().min(75).max(1200),
    format: z.enum(['png', 'jpeg', 'tiff']),
  }),
});

const presetSchema = z.object({
  id: sharedIdSchema,
  label: z.string().min(1),
  scan: z.object({
    source: z.string().min(1),
    mode: z.string().min(1),
    resolutionDpi: z.number().int().min(75).max(1200),
    brightness: z.number().int().min(-100).max(100),
    contrast: z.number().int().min(-100).max(100),
    pageSize: z.string().min(1),
  }),
  output: z.object({
    format: z.enum(['pdf', 'images']),
    imageFormat: z.enum(['jpeg', 'png', 'tiff']),
    jpegQuality: z.number().int().min(1).max(100),
    combinePages: z.boolean(),
    consumers: z.array(z.string().min(1)).optional(),
  }),
});

const workflowSchema = z.object({
  id: sharedIdSchema,
  label: z.string().min(1),
  scannerId: sharedIdSchema,
  presetId: sharedIdSchema,
  destinationIds: z.array(sharedIdSchema).min(1),
  askForCustomName: z.boolean(),
  previewBeforeScan: z.boolean(),
});

const destinationSchema = z
  .object({
    id: sharedIdSchema,
    type: z.enum(['filesystem', 'integration']),
    enabled: z.boolean(),
    path: z.string().min(1).optional(),
    namingTemplate: z.string().min(1).optional(),
    adapter: z.literal('paperless').optional(),
  })
  .superRefine((value, context) => {
    if (value.type === 'filesystem' && !value.path) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['path'],
        message: 'Filesystem destination requires path',
      });
    }
    if (value.type === 'integration' && !value.adapter) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['adapter'],
        message: 'Integration destination requires adapter',
      });
    }
  });

const appConfigSchemaInternal = z.object({
  version: z.literal(1),
  app: z.object({
    name: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    baseUrl: z.url(),
    timezone: z.string().min(1),
    health: z.object({
      exposeDetails: z.boolean(),
    }),
  }),
  paths: z.object({
    configDir: z.string().min(1),
    outputDir: z.string().min(1),
    tempDir: z.string().min(1),
    dbFile: z.string().min(1),
  }),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error']),
    format: z.enum(['json', 'pretty']),
    redactKeys: z.array(z.string()),
  }),
  realtime: z.object({
    transport: z.literal('sse'),
    heartbeatSeconds: z.number().int().min(5).max(60),
    replayBufferSize: z.number().int().min(0).max(5000),
  }),
  resilience: z.object({
    scanner: z.object({
      timeoutMs: z.number().int().positive(),
      retries: z.number().int().min(0).max(10),
      backoffMs: z.number().int().positive(),
    }),
    integration: z.object({
      timeoutMs: z.number().int().positive(),
      retries: z.number().int().min(0).max(10),
      backoffMs: z.number().int().positive(),
    }),
  }),
  scanners: z.array(scannerSchema).default([]),
  presets: z.array(presetSchema).default([]),
  workflows: z.array(workflowSchema).default([]),
  processing: z.object({
    pdf: z.object({
      engine: z.enum(['img2pdf', 'qpdf']),
      optimize: z.boolean(),
      metadata: z.object({
        producer: z.string().min(1),
      }),
    }),
    image: z.object({
      autoRotate: z.boolean(),
      deskew: z.boolean(),
      removeBlankPages: z.boolean(),
      blankPageThreshold: z.number().min(0).max(1),
    }),
    thumbnails: z.object({
      enabled: z.boolean(),
      maxWidth: z.number().int().min(16),
      format: z.enum(['jpeg', 'png']),
      quality: z.number().int().min(1).max(100),
    }),
    ocr: z
      .object({
        enabled: z.boolean(),
        provider: z.enum(['none', 'tesseract', 'external']),
        language: z.string().min(1),
      })
      .superRefine((value, context) => {
        if (value.enabled && value.provider === 'none') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['provider'],
            message: 'OCR provider cannot be none when OCR is enabled',
          });
        }
      }),
  }),
  destinations: z.array(destinationSchema).default([]),
  integrations: z.object({
    paperless: z
      .array(
        z.object({
          id: sharedIdSchema,
          label: z.string().min(1),
          baseUrl: z.url(),
          /** Direct API token value (less secure, prefer tokenEnv for production) */
          token: z.string().min(1).optional(),
          /** Name of the environment variable that holds the API token */
          tokenEnv: z.string().min(1).optional(),
          timeoutMs: z.number().int().positive(),
          verifyTls: z.boolean(),
          defaultDocumentType: z.string().min(1).optional(),
        }).refine(
          (data) => data.token !== undefined || data.tokenEnv !== undefined,
          { message: 'Either token or tokenEnv must be provided', path: ['token'] },
        ),
      )
      .default([]),
    homeassistant: z
      .object({
        enabled: z.boolean(),
        mqtt: z.object({
          brokerUrl: z.string().min(1),
          username: z.string().min(1),
          password: z.string().min(1),
          clientId: z.string().min(1).optional(),
          topicPrefix: z.string().min(1).optional(),
        }),
        discovery: z.object({
          prefix: z.string().min(1),
          deviceName: z.string().min(1),
          deviceId: z.string().min(1),
        }),
        buttons: z.array(
          z.object({
            id: z.string().regex(/^[a-z0-9_]+$/),
            label: z.string().min(1),
            presetId: z.string().min(1),
            scannerId: scannerIdSchema.optional(),
            consumerOverride: z.array(z.string().min(1)).optional(),
          }),
        ),
      })
      .optional(),
  }),
  features: z.object({
    preview: z.boolean(),
    historySearch: z.boolean(),
    darkMode: z.boolean(),
    configDiagnosticsUi: z.boolean(),
  }),
});

const semanticValidation = (config: AppConfig): string[] => {
  const errors: string[] = [];

  // Note: scannerIds and presetIds are intentionally not validated against
  // config-only sets — both may reference entries discovered/created at runtime
  // (discovered scanners and user presets stored in the DB).

  const destinationIds = new Set(config.destinations.map((item) => item.id));

  for (const workflow of config.workflows) {
    for (const destinationId of workflow.destinationIds) {
      if (!destinationIds.has(destinationId)) {
        errors.push(`Workflow '${workflow.id}' references unknown destination '${destinationId}'`);
      }
    }
  }

  for (const destination of config.destinations) {
    if (destination.type === 'integration' && destination.adapter === 'paperless') {
      if (!config.integrations.paperless?.length) {
        errors.push(`Destination '${destination.id}' requires at least one integrations.paperless entry`);
      }
    }
  }

  const paperlessIds = new Set<string>();
  for (const pl of config.integrations.paperless ?? []) {
    if (paperlessIds.has(pl.id)) {
      errors.push(`Paperless instance '${pl.id}' is duplicated`);
    }
    paperlessIds.add(pl.id);
  }

  if (config.paths.outputDir === config.paths.tempDir) {
    errors.push('paths.outputDir must not equal paths.tempDir');
  }

  if (config.integrations.homeassistant?.enabled) {
    const ha = config.integrations.homeassistant;
    const buttonIds = new Set<string>();
    for (const button of ha.buttons) {
      if (buttonIds.has(button.id)) {
        errors.push(`Home Assistant button '${button.id}' is duplicated`);
      }
      buttonIds.add(button.id);

      // presetId and scannerId are not validated here — both may reference
      // entries that only exist at runtime (DB presets / discovered scanners)
    }
  }

  return errors;
};

export const appConfigSchema = appConfigSchemaInternal as z.ZodType<AppConfig>;

/**
 * Parses and validates ScanIt config with strict semantic checks.
 */
export const validateConfig = (value: unknown): AppConfig => {
  const parsed = appConfigSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((item) => `${item.path.join('.')}: ${item.message}`);
    throw new ConfigValidationError('Schema validation failed', issues);
  }

  const semanticErrors = semanticValidation(parsed.data);
  if (semanticErrors.length > 0) {
    throw new ConfigValidationError('Semantic validation failed', semanticErrors);
  }

  return parsed.data;
};
