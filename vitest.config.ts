import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // e2e/ laeuft unter @playwright/test in einem echten Browser und wuerde
    // hier nur beim Import scheitern.
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
  },
});
