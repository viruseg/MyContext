import { expect, test } from '@playwright/test';

test('демо-страница отдаётся сервером', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(await page.title()).toContain('MyContext');
});
