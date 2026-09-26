import { defineConfig } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

export default defineConfig({
  fullyParallel: true,
  retries: process.env.CI ? 0 : 1,
  use: {
    headless: true,
  },
  webServer: {
    // Глобальная настройка: сервер поднимается и для `npm run test:unit`,
    // хотя юнит-тесты HTTP-запросов не делают.
    command: 'node scripts/serve.js',
    url: BASE_URL,
    reuseExistingServer: true,
  },
  projects: [
    {
      // Браузерные фикстуры Playwright создаются лениво, поэтому процесс браузера
      // не стартует, пока тест их не запросит. Деструктуризация `{ page }` в тесте
      // из tests/unit это свойство сломает.
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
