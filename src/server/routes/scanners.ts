import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { ConfigRuntime } from '../../config/runtime.js';
import type { ScannerProvider } from '../../scanner/provider.js';
import type { SqliteStore } from '../../store/sqlite/db.js';
import type { SseBroker } from '../sse/broker.js';
import type { UserPreset } from '../../shared/types/domain.js';
import { runDiagnostics } from '../../scanner/sane/diagnostics.js';
import { applyRecommendation } from '../../scanner/sane/backendManager.js';
import { logger as rootLogger } from '../logger.js';

const logger = rootLogger.child({ module: 'routes/scanners' });

/**
 * Scanner discovery, capabilities, and user-preset routes.
 */
export const createScannerRouter = (
  runtime: ConfigRuntime,
  scannerProvider: ScannerProvider,
  store: SqliteStore,
  broker: SseBroker,
): Router => {
  const router = Router();

  // ─── Configured + Discovered scanners ──────────────────────────────

  router.get('/api/scanners', async (_request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      const discovered = store.listDiscoveredScanners();
      logger.debug(
        { configured: snapshot.config.scanners.length, discovered: discovered.length },
        'GET /api/scanners',
      );
      response.json({
        configured: snapshot.config.scanners,
        discovered,
      });
    } catch (error) {
      next(error);
    }
  });

  // ─── Trigger discovery: discover + query caps + persist ────────────

  router.post('/api/scanners/discover', async (_request, response, next) => {
    try {
      logger.info('POST /api/scanners/discover — starting discovery');
      const scanners = await scannerProvider.discoverScanners();
      const now = new Date().toISOString();

      const results = [];

      for (const scanner of scanners) {
        // Persist the discovered scanner
        store.upsertDiscoveredScanner({
          id: scanner.id,
          device: scanner.device,
          label: scanner.label,
          lastSeenAt: now,
        });

        // Query capabilities in parallel-safe sequential loop
        try {
          const capabilities = await scannerProvider.queryCapabilities(scanner.device);
          store.updateScannerCapabilities(scanner.id, capabilities);
          results.push({
            ...scanner,
            lastSeenAt: now,
            capabilities,
          });
        } catch {
          // Capabilities query failed — still return the scanner
          const existing = store.getDiscoveredScanner(scanner.id);
          results.push({
            ...scanner,
            lastSeenAt: now,
            capabilities: existing?.capabilities ?? null,
          });
        }
      }

      broker.emit('scanners_discovered', { count: results.length });
      logger.info({ count: results.length }, 'Discovery complete, returning results');

      response.json({ discovered: results });
    } catch (error) {
      next(error);
    }
  });

  // ─── List persisted discovered scanners ────────────────────────────

  router.get('/api/scanners/discovered', (_request, response, next) => {
    try {
      response.json(store.listDiscoveredScanners());
    } catch (error) {
      next(error);
    }
  });

  // ─── Get capabilities for a discovered scanner ─────────────────────

  router.get(
    '/api/scanners/discovered/:scannerId/capabilities',
    async (request, response, next) => {
      try {
        const record = store.getDiscoveredScanner(request.params.scannerId);
        if (!record) {
          response.status(404).json({
            code: 'SCANNER_NOT_FOUND',
            message: `Discovered scanner '${request.params.scannerId}' not found`,
          });
          return;
        }

        // Re-query if no capabilities cached
        if (!record.capabilities) {
          const capabilities = await scannerProvider.queryCapabilities(record.device);
          store.updateScannerCapabilities(record.id, capabilities);
          response.json(capabilities);
          return;
        }

        response.json(record.capabilities);
      } catch (error) {
        next(error);
      }
    },
  );

  // ─── Get capabilities for a configured scanner (legacy) ────────────

  router.get('/api/scanners/:scannerId/capabilities', async (request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      const scanner = snapshot.config.scanners.find((item) => item.id === request.params.scannerId);

      if (!scanner) {
        response.status(404).json({
          code: 'SCANNER_NOT_FOUND',
          message: `Scanner '${request.params.scannerId}' not found`,
        });
        return;
      }

      const capabilities = await scannerProvider.getCapabilities(scanner);
      response.json(capabilities);
    } catch (error) {
      next(error);
    }
  });

  // ─── Refresh capabilities for a specific discovered scanner ────────

  router.post('/api/scanners/discovered/:scannerId/refresh', async (request, response, next) => {
    try {
      const record = store.getDiscoveredScanner(request.params.scannerId);
      if (!record) {
        response.status(404).json({
          code: 'SCANNER_NOT_FOUND',
          message: `Discovered scanner '${request.params.scannerId}' not found`,
        });
        return;
      }

      const capabilities = await scannerProvider.queryCapabilities(record.device);
      store.updateScannerCapabilities(record.id, capabilities);
      response.json(capabilities);
    } catch (error) {
      next(error);
    }
  });

  // ─── SANE Diagnostics ───────────────────────────────────────────────

  /**
   * Run full SANE diagnostics: checks avahi, mDNS scanners, SANE devices,
   * compares them, and generates recommendations for config fixes.
   */
  router.get('/api/scanners/diagnostics', async (_request, response, next) => {
    try {
      logger.info('GET /api/scanners/diagnostics — running diagnostics');
      const report = await runDiagnostics();
      logger.info(
        {
          mdns: report.mdnsScanners.length,
          sane: report.saneDevices.length,
          unreachable: report.unreachableScanners.length,
          recommendations: report.recommendations.length,
          configWritable: report.configWritable,
        },
        'Diagnostics complete',
      );
      response.json(report);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Apply a recommendation from the diagnostics report.
   * Body: { type, backend, configFile?, configLine? }
   */
  router.post('/api/scanners/diagnostics/apply', async (request, response, next) => {
    try {
      const body = request.body as {
        type: string;
        backend: string;
        configFile?: string;
        configLine?: string;
      };

      logger.info(
        { type: body.type, backend: body.backend, configFile: body.configFile },
        'POST /api/scanners/diagnostics/apply',
      );

      if (!body.type || !body.backend) {
        response.status(400).json({
          code: 'BAD_REQUEST',
          message: 'type and backend are required',
        });
        return;
      }

      const result = await applyRecommendation(body);

      if (!result.success) {
        logger.warn(
          { error: result.error, type: body.type, backend: body.backend },
          'Failed to apply recommendation',
        );
        response.status(500).json({
          code: 'APPLY_FAILED',
          message: result.error ?? 'Failed to apply recommendation',
        });
        return;
      }

      // Re-run diagnostics after applying to show updated state
      logger.info(
        { type: body.type, backend: body.backend },
        'Recommendation applied successfully, re-running diagnostics',
      );
      const updatedReport = await runDiagnostics();
      response.json({
        applied: true,
        diagnostics: updatedReport,
      });
    } catch (error) {
      next(error);
    }
  });

  // ─── User Presets CRUD ─────────────────────────────────────────────

  router.get('/api/presets', (_request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      const configPresets = snapshot.config.presets.map((p) => ({
        ...p,
        origin: 'config' as const,
      }));
      const userPresets = store.listUserPresets().map((p) => ({
        ...p,
        origin: 'user' as const,
      }));
      response.json([...configPresets, ...userPresets]);
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/presets/user', (_request, response, next) => {
    try {
      response.json(store.listUserPresets());
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/presets', (request, response, next) => {
    try {
      const body = request.body as Partial<UserPreset>;
      if (!body.label) {
        response.status(400).json({ code: 'BAD_REQUEST', message: 'label is required' });
        return;
      }

      const now = new Date().toISOString();
      const preset: UserPreset = {
        id: `user_${randomUUID().slice(0, 8)}`,
        label: body.label,
        source: body.source ?? 'Flatbed',
        mode: body.mode ?? 'Color',
        resolutionDpi: body.resolutionDpi ?? 300,
        brightness: body.brightness ?? 0,
        contrast: body.contrast ?? 0,
        pageSize: body.pageSize ?? 'A4',
        outputFormat: body.outputFormat ?? 'pdf',
        imageFormat: body.imageFormat ?? 'jpeg',
        jpegQuality: body.jpegQuality ?? 85,
        combinePages: body.combinePages ?? true,
        createdAt: now,
        updatedAt: now,
      };
      if (body.scannerId) preset.scannerId = body.scannerId;

      store.createUserPreset(preset);
      broker.emit('preset_created', { presetId: preset.id, label: preset.label });
      response.status(201).json(preset);
    } catch (error) {
      next(error);
    }
  });

  router.put('/api/presets/:presetId', (request, response, next) => {
    try {
      const existing = store.getUserPreset(request.params.presetId);
      if (!existing) {
        response.status(404).json({ code: 'PRESET_NOT_FOUND', message: 'User preset not found' });
        return;
      }

      const body = request.body as Partial<UserPreset>;
      const updated: UserPreset = {
        ...existing,
        ...body,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };

      store.updateUserPreset(updated);
      response.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/api/presets/:presetId', (request, response, next) => {
    try {
      const existing = store.getUserPreset(request.params.presetId);
      if (!existing) {
        response.status(404).json({ code: 'PRESET_NOT_FOUND', message: 'User preset not found' });
        return;
      }

      store.deleteUserPreset(request.params.presetId);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
};
