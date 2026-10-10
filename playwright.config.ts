import { defineConfig, devices } from '@playwright/test';

// Synthetic evidence lives exclusively in browser route interceptions under tests/e2e.
// There is no production API fixture flag and these tests make no provider calls.
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, timeout: 45_000,
  expect: { timeout: 10_000 }, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) } }],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100', reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { APP_ORIGIN: 'http://127.0.0.1:3100', SEARCH_ENABLED: 'false' },
  },
});
