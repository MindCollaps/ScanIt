import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [vue()],
  root: resolve(rootDir, 'src/client'),
  build: {
    outDir: resolve(rootDir, 'dist/client'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8863',
      '/healthz': 'http://localhost:8863',
      '/readyz': 'http://localhost:8863',
    },
  },
});
