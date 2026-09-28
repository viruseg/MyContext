/**
 * Приведение значения токена к вычисленному цвету.
 *
 * Трюк нетривиален и обязан быть один на проект. `getPropertyValue` отдаёт запись
 * токена — `#1f2023` либо `color-mix(in srgb, …)`, — а `getComputedStyle` отдаёт
 * `rgb()` либо `color(srgb …)`. Сравнивать их напрямую бессмысленно: равенство вида
 * «цвет строки равен токену» тогда проходило бы на тождестве и ни разу не показало
 * бы, что правило применилось. Поэтому значение кладётся в `color` пустого элемента
 * и браузер приводит его тем же путём, каким приводит любой цвет страницы.
 *
 * Модуль лежит вне `testDir` всех трёх браузерных проектов и набором тестов не
 * подбирается.
 */

/**
 * @param {import('@playwright/test').Page} page страница с токеном.
 * @param {string} value значение токена или цвета — то, что кладётся в `color`.
 * @returns {Promise<string>} вычисленный цвет в нотации движка.
 * @throws {Error} если значение пустое: неразрешённый токен дал бы цвет, унаследованный
 *   от страницы, и равенство прошло бы мимо своего предмета.
 */
export function resolveColor(page, value) {
  return page.evaluate((declaration) => {
    if (declaration.trim() === '') {
      throw new Error('значение токена пустое: токен не объявлен');
    }
    const probe = document.createElement('span');
    probe.style.color = declaration;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, value);
}
