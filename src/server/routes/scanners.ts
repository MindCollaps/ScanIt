import { Router } from 'express';
import type { ConfigRuntime } from '../../config/runtime.js';
import type { ScannerProvider } from '../../scanner/provider.js';

/**
 * Scanner capability and discovery routes.
 */
export const createScannerRouter = (
  runtime: ConfigRuntime,
  scannerProvider: ScannerProvider,
): Router => {
  const router = Router();

  router.get('/api/scanners', async (_request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      const discovered = await scannerProvider.discoverScanners();
      response.json({
        configured: snapshot.config.scanners,
        discovered,
      });
    } catch (error) {
      next(error);
    }
  });

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

  return router;
};
