import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  DestinationAdapter,
  DeliveryContext,
  DeliveryResult,
  AdapterFactory,
  AdapterDependencies,
} from './adapter.js';
import type { AppConfig, PaperlessInstance } from '../shared/types/config.js';
import { logger } from '../server/logger.js';

/**
 * Paperless-ngx consumer adapter.
 *
 * Each instance is registered as consumer type `paperless:{id}` and uploads
 * scanned pages to its own Paperless-ngx server via the REST API.
 */
export class PaperlessAdapter implements DestinationAdapter {
  public readonly type: string;

  public constructor(private readonly instance: PaperlessInstance) {
    this.type = `paperless:${instance.id}`;
  }

  public async deliver(context: DeliveryContext): Promise<DeliveryResult> {
    const { instance } = this;

    const token = instance.token ?? (instance.tokenEnv ? process.env[instance.tokenEnv] : undefined);
    if (!token) {
      const hint = instance.tokenEnv
        ? `Environment variable '${instance.tokenEnv}' is not set`
        : 'No token configured (set token or tokenEnv)';
      return { success: false, error: hint };
    }

    const uploadUrl = `${instance.baseUrl.replace(/\/+$/, '')}/api/documents/post_document/`;

    for (const page of context.pages) {
      try {
        const fileBuffer = await readFile(page.path);
        const form = new FormData();
        form.append('document', new Blob([fileBuffer]), basename(page.path));
        if (instance.defaultDocumentType) {
          form.append('document_type', instance.defaultDocumentType);
        }

        if (context.job.outputFilename) {
          form.append('title', context.job.outputFilename);
        }

        const fetchOptions: RequestInit & { tls?: { rejectUnauthorized?: boolean } } = {
          method: 'POST',
          headers: {
            Authorization: `Token ${token}`,
          },
          body: form,
          signal: AbortSignal.timeout(instance.timeoutMs),
        };
        if (!instance.verifyTls) {
          fetchOptions.tls = { rejectUnauthorized: false };
        }
        const response = await fetch(uploadUrl, fetchOptions);

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          const msg = `Paperless upload failed for ${page.filename}: ${response.status} ${body}`;
          logger.error({ instance: instance.id, status: response.status, filename: page.filename }, msg);
          return { success: false, error: msg };
        }

        logger.info(
          { instance: instance.id, filename: page.filename, status: response.status },
          'Uploaded to Paperless-ngx',
        );
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Upload failed';
        logger.error({ instance: instance.id, filename: page.filename, err: error }, 'Paperless upload error');
        return { success: false, error: `${page.filename}: ${msg}` };
      }
    }

    return { success: true };
  }
}

/**
 * Factory that creates one PaperlessAdapter per configured Paperless-ngx instance.
 */
export const paperlessAdapterFactory: AdapterFactory = {
  name: 'paperless',
  create(config: AppConfig, _deps: AdapterDependencies): DestinationAdapter[] {
    return (config.integrations.paperless ?? []).map(
      (instance) => new PaperlessAdapter(instance),
    );
  },
};
