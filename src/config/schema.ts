import { z } from 'zod';
import type { AppConfig } from '../shared/types/config.js';

const scannerIdSchema = z.string().regex(/^[a-z0-9_-]+$/);
const sharedIdSchema = z.string().min(1).regex(/^[a-z0-9_-]+$/);

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

const profileSchema = z.object({
  id: sharedIdSchema,
  label: z.string().min(1),
  enabled: z.boolean(),
  defaultScannerId: sharedIdSchema.optional(),
  defaultPresetId: sharedIdSchema,
  naming: z.object({
    template: z.string().min(1),
    sanitize: z.boolean(),
  }),
  integrations: z
    .object({
      paperless: z
        .object({
          enabled: z.boolean(),
          tokenEnv: z.string().min(1),
          defaultTags: z.array(z.string()),
          correspondent: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),
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
  }),
});

const workflowSchema = z.object({
  id: sharedIdSchema,
  label: z.string().min(1),
  profileId: sharedIdSchema,
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
    profileScoped: z.boolean().optional(),
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
  profiles: z.array(profileSchema).min(1),
  presets: z.array(presetSchema).min(1),
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
      .object({
        baseUrl: z.url(),
        timeoutMs: z.number().int().positive(),
        verifyTls: z.boolean(),
        defaultDocumentType: z.string().min(1),
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

  const scannerIds = new Set(config.scanners.map((item) => item.id));
  const presetIds = new Set(config.presets.map((item) => item.id));
  const profileIds = new Set(config.profiles.map((item) => item.id));
  const destinationIds = new Set(config.destinations.map((item) => item.id));

  for (const profile of config.profiles) {
    if (profile.defaultScannerId && !scannerIds.has(profile.defaultScannerId)) {
      errors.push(`Profile '${profile.id}' references unknown scanner '${profile.defaultScannerId}'`);
    }
    if (!presetIds.has(profile.defaultPresetId)) {
      errors.push(`Profile '${profile.id}' references unknown preset '${profile.defaultPresetId}'`);
    }
  }

  for (const workflow of config.workflows) {
    if (!profileIds.has(workflow.profileId)) {
      errors.push(`Workflow '${workflow.id}' references unknown profile '${workflow.profileId}'`);
    }
    if (!scannerIds.has(workflow.scannerId)) {
      errors.push(`Workflow '${workflow.id}' references unknown scanner '${workflow.scannerId}'`);
    }
    if (!presetIds.has(workflow.presetId)) {
      errors.push(`Workflow '${workflow.id}' references unknown preset '${workflow.presetId}'`);
    }

    for (const destinationId of workflow.destinationIds) {
      if (!destinationIds.has(destinationId)) {
        errors.push(`Workflow '${workflow.id}' references unknown destination '${destinationId}'`);
      }
    }
  }

  if (!config.profiles.some((item) => item.enabled)) {
    errors.push('At least one profile must be enabled');
  }

  for (const destination of config.destinations) {
    if (destination.type === 'integration' && destination.adapter === 'paperless') {
      if (!config.integrations.paperless) {
        errors.push(`Destination '${destination.id}' requires integrations.paperless`);
      }
    }
  }

  if (config.paths.outputDir === config.paths.tempDir) {
    errors.push('paths.outputDir must not equal paths.tempDir');
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
    throw new Error(issues.join('; '));
  }

  const semanticErrors = semanticValidation(parsed.data);
  if (semanticErrors.length > 0) {
    throw new Error(semanticErrors.join('; '));
  }

  return parsed.data;
};
