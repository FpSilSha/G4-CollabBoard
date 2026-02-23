import { defineConfig } from '@playwright/test';
import path from 'path';

const backendDir = path.resolve(__dirname, '../apps/backend');
const frontendDir = path.resolve(__dirname, '../apps/frontend');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Single worker: all tests share one test user + one DB, so parallel
  // execution causes slot conflicts and race conditions. Serial is reliable.
  workers: 1,
  reporter: 'html',
  timeout: 60000,

  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],

  webServer: [
    {
      command: 'npm run dev',
      cwd: backendDir,
      port: 3001,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'development',
        E2E_TEST_AUTH: 'true',
        DATABASE_URL: 'postgresql://collabboard:collabboard_dev@localhost:5432/collabboard_test',
        REDIS_URL: 'redis://localhost:6379',
        PORT: '3001',
        FRONTEND_URL: 'http://localhost:5173',
        AI_ENABLED: 'false',
        LOG_LEVEL: 'warn',
      },
      timeout: 30000,
    },
    {
      command: 'npm run dev',
      cwd: frontendDir,
      port: 5173,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_TEST_MODE: 'true',
        VITE_API_URL: 'http://localhost:3001',
        VITE_WS_URL: 'http://localhost:3001',
      },
      timeout: 30000,
    },
  ],
});
