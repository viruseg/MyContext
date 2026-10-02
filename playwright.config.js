import { defineConfig } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

export default defineConfig({
  fullyParallel: true,
  // Два воркера — компромисс, а не пессимизм. Firefox при двух и более воркерах
  // теряет кадры перехода, и тайминговые ассерции падают на ровном месте
  // (пример: `midFade.opacity` читается нулём вместо значения между 0 и 1, потому
  // что JS-таймер под нагрузкой срабатывает позже, чем доезжает кадр анимации).
  // Замерено на этой машине (8 CPU): 1 воркер — 10.19 мин, 2 воркера — ожидаемо
  // вдвое меньше, 4 воркера — 5.1 мин и чисто, 6 воркеров — тот же тайминговый
  // флэк в Firefox. Отсюда два: Chromium и WebKit держат два воркера, Firefox
  // запускается отдельно через `npm run test:firefox` с `--workers=1`.
  // Чинить флэк ретраями или ослаблением утверждений нельзя: ретрай маскировал бы
  // реальную регрессию.
  workers: 2,
  retries: 0,
  use: {
    headless: true,
  },
  webServer: {
    // Глобальная настройка: сервер поднимается и для `npm run test:unit`,
    // хотя юнит-тесты HTTP-запросов не делают.
    command: 'node scripts/serve.js',
    url: BASE_URL,
    // В CI переиспользование запрещено: занятый порт означает чужой процесс с
    // чужими файлами, и прогон молча пошёл бы против устаревшей копии. Локально
    // переиспользование удобно, но обходится перезапуском: `SERVED_ENTRIES` и
    // порт вычисляются один раз при старте, и правка сервера без перезапуска не
    // подхватывается.
    reuseExistingServer: !process.env.CI,
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
