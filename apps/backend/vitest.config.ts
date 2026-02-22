import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/server.ts',
        'src/models/**',
        'src/**/*.d.ts',
        // Infrastructure/singleton files — mocked in all tests, not unit-testable
        'src/utils/redis.ts',
        'src/utils/logger.ts',
        'src/utils/instrumentedRedis.ts',
        'src/websocket/server.ts',
        'src/websocket/wsMetrics.ts',
        // AI schema definitions and LangSmith tracing wrapper — not logic
        'src/ai/tools.ts',
        'src/ai/systemPrompt.ts',
        'src/ai/tracing.ts',
        // HTTP metrics middleware — thin instrumentation wrapper
        'src/middleware/httpMetrics.ts',
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
