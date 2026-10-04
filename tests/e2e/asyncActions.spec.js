import { expect, test } from '@playwright/test';

/**
 * Асинхронные пользовательские действия.
 *
 * Автор отдаёт библиотеке функции, и любая из них может оказаться `async`:
 * подпись пункта ждёт сеть, действие пишет в файл, отдача управления зовёт чужое
 * меню. Библиотека обязана это разбирать — ждать действия там, где её решение
 * зависит от его результата, и не терять отказ там, где ждать некому.
 *
 * Набор разбит по месту поломки, а не по виду действия: одно и то же асинхронное
 * `action` ломается по-разному на клике (неверно считается закрытие) и на
 * отпускании (теряется жест), и проверять его двумя кейсами дешевле, чем искать
 * поломку по симптому.
 *
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').ErrorEventDetail} ErrorEventDetail
 */

/**
 * Что делает действие пункта. Синхронный `ok` нужен отдельным кейсом не для
 * проверки, а как точка отсчёта: после правки оба режима обязаны вести себя
 * одинаково, и без этого кейса равенство нечем подтвердить.
 *
 * @typedef {'ok' | 'async-ok' | 'async-throw'} ActionMode
 */

/**
 * @typedef {object} ActionInput
 * @property {ActionMode} [mode] что делает действие пункта.
 * @property {boolean} [watch] подписан ли кто-нибудь на `error`.
 * @property {boolean} [preventDefault] вызывает ли подписчик `error` `preventDefault()`.
 * @property {boolean} [reopen] звать ли `open()` из действия изнутри.
 */

/**
 * @typedef {object} ActionLog
 * @property {number} openCount событий `open`.
 * @property {number} closeCount событий `close`.
 * @property {boolean} visible показан ли хоть один уровень.
* @property {string[]} errorSources `source` из событий `error`, по порядку.
 * @property {string[]} errorMessages сообщения отказов из событий `error`.
 * @property {number} errorPrevented сколько раз подписчик отменил отказ.
 * @property {string[]} escapedBy каналы, по которым отказ ушёл на страницу:
 *   `error:…` — непойманная ошибка, `unhandledrejection:…` — отказ промиса.
 */

/**
 * @typedef {object} AsyncProbe
 * @property {(input: ActionInput) => void} make
 * @property {(x: number, y: number) => Promise<void>} open
 * @property {() => void} activate
 * @property {() => void} closeMenu
 * @property {() => ActionLog} read
 */

const STYLESHEET_PATH = '/styles/mycontext.css';

const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <body style="background: rgb(255, 255, 255); margin: 0">
    <div id="surface" tabindex="-1"
         style="position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: rgb(240, 240, 240)">
    </div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };
const OPEN_POINT = { x: 400, y: 300 };
const FAILURE_TEXT = 'сломалось';
/** Задержка действия внутри страницы, мс. */
const ACTION_DELAY = 20;

/**
 * @param {import('@playwright/test').Page} page
 * @param {ActionInput} [input]
 * @returns {Promise<void>}
 */
async function setup(page, input = {}) {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/');
  await page.setContent(PAGE_HTML);
  await page.waitForFunction(
    (path) => {
      return Array.from(document.styleSheets).some((sheet) => {
        return sheet.href !== null && sheet.href.endsWith(path) && sheet.cssRules.length > 0;
      });
    },
    STYLESHEET_PATH,
    { timeout: 5000 },
  );
  // Под `reduce` показ переоткрытия проходит за один такт, иначе кейс на
  // переоткрытие измерял бы задержку анимации вместо порядка событий.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(
    async (payload) => {
      const { MyContext } = await import('../../src/index.js');
      const scope = /** @type {{ __mc?: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));

      /** @type {string[]} */
      const errorSources = [];
      /** @type {string[]} */
      const errorMessages = [];
      /** @type {string[]} */
      const escapedBy = [];
      let errorPrevented = 0;
      let openCount = 0;
      let closeCount = 0;

      // Настоящая задача, а не микротаска: микротаска не отдаёт управление
      // наружу, и тест на `await` не отличил бы ожидание от его отсутствия.
      const delay = 20;
      const failure = 'сломалось';

      // Канал ухода отказа различается намеренно: отказ промиса, который никто не
      // держит, попадает в `unhandledrejection`, а непойманная ошибка — в `error`.
      // Синхронный бросок из обработчика сегодня уходит вторым, и отказ действия
      // должен уходить так же, а не первым.
      globalThis.addEventListener('error', (event) => {
        escapedBy.push(`error:${String(event.message)}`);
      });
      globalThis.addEventListener('unhandledrejection', (event) => {
        const reason = /** @type {{ message?: unknown }} */ (/** @type {unknown} */ (event.reason));
        escapedBy.push(`unhandledrejection:${String(reason.message)}`);
      });

      /** @type {InstanceType<typeof MyContext> | null} */
      let menu = null;

      scope.__mc = {
        make(config) {
          errorSources.length = 0;
          errorMessages.length = 0;
          errorPrevented = 0;
          openCount = 0;
          closeCount = 0;
          if (menu !== null) {
            menu.destroy();
          }
          const mode = config.mode ?? 'ok';
          const instance = new MyContext([
            {
              labelAction: () => 'Пункт',
              action: mode === 'ok' ? () => {
                if (config.reopen === true) {
                  instance.open({ x: 200, y: 200 });
                }
              } : async () => {
                await new Promise((resolve) => {
                  setTimeout(resolve, delay);
                });
                if (mode === 'async-throw') {
                  throw new Error(failure);
                }
                if (config.reopen === true) {
                  await instance.open({ x: 200, y: 200 });
                }
              },
            },
          ]);
          instance.addEventListener('open', () => {
            openCount += 1;
          });
          instance.addEventListener('close', () => {
            closeCount += 1;
          });
          if (config.watch === true) {
            instance.addEventListener('error', (event) => {
              const custom = /** @type {CustomEvent<ErrorEventDetail>} */ (
                /** @type {unknown} */ (event)
              );
              errorSources.push(custom.detail.source);
              errorMessages.push(
                custom.detail.reason instanceof Error
                  ? custom.detail.reason.message
                  : String(custom.detail.reason),
              );
              if (config.preventDefault === true) {
                event.preventDefault();
                errorPrevented += 1;
              }
            });
          }
          menu = instance;
        },
        async open(x, y) {
          if (menu === null) {
            throw new Error('меню не создано');
          }
          await menu.open({ x, y });
        },
        activate() {
          const item = document.querySelector('.vc-item');
          if (!(item instanceof HTMLElement)) {
            throw new Error('пункт не показан');
          }
          item.click();
        },
        closeMenu() {
          if (menu === null) {
            throw new Error('меню не создано');
          }
          menu.close();
        },
        read() {
          return {
            openCount,
            closeCount,
            visible: document.querySelectorAll('.vc-menu:popover-open').length > 0,
            errorSources: errorSources.slice(),
            errorMessages: errorMessages.slice(),
            errorPrevented,
            escapedBy: escapedBy.slice(),
          };
        },
      };
    },
    input,
  );
  await page.evaluate((config) => {
    const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(config);
  }, input);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<ActionLog>}
 */
function read(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function openMenu(page) {
  return page.evaluate((point) => {
    const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.open(point.x, point.y);
  }, OPEN_POINT);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function activateItem(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.activate();
  });
}

test.describe('отказы действий', () => {
  test('отказ асинхронного действия доходит до подписчика error с отказом в detail', async ({ page }) => {
    await setup(page, { mode: 'async-throw', watch: true });
    await openMenu(page);
    await activateItem(page);
    await page.waitForTimeout(120);
    const log = await read(page);
    expect(log.errorMessages, 'отказ дошёл до подписчика').toEqual([FAILURE_TEXT]);
    expect(log.errorSources, 'отказ назван своим действием').toHaveLength(1);
    expect(log.visible, 'меню закрыто, несмотря на отказ').toBe(false);
  });

  test('отказ действия с preventDefault в подписчике error не доходит до страницы', async ({ page }) => {
    await setup(page, { mode: 'async-throw', watch: true, preventDefault: true });
    await openMenu(page);
    await activateItem(page);
    await page.waitForTimeout(120);
    const log = await read(page);
    expect(log.errorPrevented, 'подписчик отменил отказ').toBe(1);
    expect(log.escapedBy, 'наружу ничего не ушло').toEqual([]);
  });

  test('отказ действия без подписчика error уходит на страницу как непойманная ошибка', async ({ page }) => {
    await setup(page, { mode: 'async-throw' });
    await openMenu(page);
    await activateItem(page);
    await page.waitForTimeout(120);
    const log = await read(page);
    // Не `unhandledrejection`: отказ действия обязано вести себя как синхронный
    // бросок, а не как потерянный промис. Формат сообщения при этом не сверяется:
    // `onerror` возвращает его так, как это делает браузер, а не библиотека.
    expect(log.escapedBy).toHaveLength(1);
    expect(log.escapedBy[0]).toMatch(new RegExp(`^error:.*${FAILURE_TEXT}$`));
  });
});

test.describe('переоткрытие из действия', () => {
  test('асинхронное действие переоткрывает меню, и закрытие по клику не сбивает поколение', async ({ page }) => {
    await setup(page, { mode: 'async-ok', reopen: true });
    await openMenu(page);
    await activateItem(page);
    await page.waitForTimeout(150);
    const log = await read(page);
    expect(log.openCount, 'меню переоткрылось вторым показом').toBe(2);
    // Переоткрытие намеренно отменяет закрытие — так оно вело себя и для
    // синхронного действия. Значит `close` не рассылается вовсе.
    expect(log.closeCount, 'закрытие отменено переоткрытием').toBe(0);
    expect(log.visible).toBe(true);
  });

  test('синхронное действие, зовущее open, ведёт себя так же', async ({ page }) => {
    await setup(page, { mode: 'ok', reopen: true });
    await openMenu(page);
    await activateItem(page);
    await page.waitForTimeout(150);
    const log = await read(page);
    expect(log.openCount).toBe(2);
    expect(log.closeCount).toBe(0);
    expect(log.visible).toBe(true);
  });
});