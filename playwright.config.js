import { defineConfig } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

export default defineConfig({
  fullyParallel: true,
  retries: process.env.CI ? 0 : 1,
  use: {
    headless: true,
  },
  webServer: {
    command: 'node scripts/serve.js',
    url: BASE_URL,
    reuseExistingServer: true,
  },
  projects: [
    {
      // Браузер не задаётся: тесты используют только expect и чистые функции,
      // а фикстуры браузера в Playwright создаются лениво и не запускают его.
      name: 'unit',
      testDir: 'tests/unit',
    },
    {
      name: 'chromium',
      testDir: 'tests/e2e',
      use: { browserName: 'chromium', baseURL: BASE_URL },
    },
    {
      name: 'firefox',
      testDir: 'tests/e2e',
      use: { browserName: 'firefox', baseURL: BASE_URL },
    },
    {
      name: 'webkit',
      testDir: 'tests/e2e',
      use: { browserName: 'webkit', baseURL: BASE_URL },
    },
  ],
});
