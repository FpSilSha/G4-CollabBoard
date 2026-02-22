import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/main.tsx',
        'src/App.tsx',
        'src/**/*.module.css',
        'src/**/*.d.ts',
        'src/components/**',
        // Canvas hooks — require real Fabric.js canvas, covered by Playwright (future)
        'src/hooks/**',
        // Fabric.js object factories — canvas-dependent, not unit-testable
        'src/utils/fabricHelpers.ts',
        'src/utils/connectorAttachment.ts',
        // Thin store refs and singletons — not logic
        'src/stores/flagStore.ts',
        'src/stores/socketRef.ts',
        'src/stores/editSessionRef.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      'shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
