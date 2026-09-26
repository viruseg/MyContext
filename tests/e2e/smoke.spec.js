import { expect, test } from '@playwright/test';

test('демо-страница отдаётся сервером', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(await page.title()).toContain('MyContext');
});

test('обход каталога не раскрывает файлы вне корня', async ({ request }) => {
  const single = await request.get('/%2e%2e%2fpackage.json');
  expect(single.status()).toBe(403);
  const double = await request.get('/%2e%2e%2f%2e%2e%2fpackage.json');
  expect(double.status()).toBe(403);
});

test('несуществующая страница отдаёт 404', async ({ request }) => {
  const response = await request.get('/missing.html');
  expect(response.status()).toBe(404);
});
