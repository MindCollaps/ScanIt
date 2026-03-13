import { readFile } from 'node:fs/promises';
import type {
  DestinationAdapter,
  DeliveryContext,
  DeliveryResult,
  AdapterFactory,
  IntegrationHost,
  IntegrationLogger,
} from '../../integration-core/adapter.js';
import type { AppConfig, PaperlessInstance } from '../../shared/types/config.js';

/**
 * Paperless-ngx consumer adapter.
 *
 * Each instance is registered as consumer type `paperless:{id}` and uploads
 * the full scan as one PDF document to its Paperless-ngx server via the REST API.
 */
export class PaperlessAdapter implements DestinationAdapter {
  public readonly type: string;

  public constructor(
    private readonly instance: PaperlessInstance,
    private readonly logger: IntegrationLogger,
    private readonly ensurePdfFromPages: IntegrationHost['artifacts']['ensurePdfFromPages'],
  ) {
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
    try {
      const pdfPath = await this.ensurePdfFromPages(context.pages, {
        optimize: context.config.processing.pdf.optimize,
      });
      const fileBuffer = await readFile(pdfPath);
      const baseName = (context.job.outputFilename?.trim() || `scan_${context.job.id.slice(0, 8)}`)
        .replace(/[^a-zA-Z0-9_\-. ]/g, '_');
      const pdfFilename = /\.pdf$/i.test(baseName) ? baseName : `${baseName}.pdf`;

      const form = new FormData();
      form.append('document', new Blob([fileBuffer], { type: 'application/pdf' }), pdfFilename);
      if (instance.defaultDocumentType) {
        form.append('document_type', instance.defaultDocumentType);
      }

      if (context.job.outputFilename) {
        form.append('title', context.job.outputFilename.replace(/\.pdf$/i, ''));
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
        const msg = `Paperless upload failed for ${pdfFilename}: ${response.status} ${body}`;
        this.logger.error(msg, {
          instance: instance.id,
          status: response.status,
          filename: pdfFilename,
        });
        return { success: false, error: msg };
      }

      this.logger.info('Uploaded PDF to Paperless-ngx', {
        instance: instance.id,
        filename: pdfFilename,
        status: response.status,
        pages: context.pages.length,
      });

      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Upload failed';
      // Normalize DOMException (e.g. TimeoutError from AbortSignal.timeout) so we only log
      // the relevant name/message instead of the entire error-code constants table.
      const errInfo =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) };
      this.logger.error('Paperless upload error', { instance: instance.id, err: errInfo });
      return { success: false, error: msg };
    }
  }
}

/**
 * Factory that creates one PaperlessAdapter per configured Paperless-ngx instance.
 */
export const adapterFactory: AdapterFactory = {
  name: 'paperless',
  create(config: AppConfig, host: IntegrationHost): DestinationAdapter[] {
    return (config.integrations.paperless ?? []).map(
      (instance) => new PaperlessAdapter(instance, host.logger, host.artifacts.ensurePdfFromPages),
    );
  },
};
