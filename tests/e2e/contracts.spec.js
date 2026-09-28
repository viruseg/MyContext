import { expect, test } from '@playwright/test';

/**
 * Кейсы на два дефекта, найденных финальным ревью по всему проекту. Оба живут на
 * стыке модулей, и оба прошли 13 задачных ревью, потому что ни одно не видело
 * обеих сторон стыка целиком: `keyboard.js` о жизненном цикле не знает, а README
 * обещал проверку опций, которой не было.
 *
 * Первый — поломка контракта: действие пункта вправе уничтожить экземпляр («снять
 * с экрана по выбору» обычная форма), и после этого движок звал `host.closeAll()`,
 * а тот бросал `Error` наружу из обработчика клавиш. Путь мыши был защищён
 * проверкой в `#onLevelClick`, путь клавиатуры — нет.
 *
 * Второй — необещанная проверка: `options` не валидировались вовсе при том, что
 * README писал «Конфигурация проверяется сразу». Каждая поломка была бесшумной и
 * необратимой: неизвестная тема попадала в `data-vc-theme` дословно, `NaN` в
 * длительности давал недействительный токен и молча пропадавшую анимацию, пустой
 * `label` — `aria-label=""`.
 *
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 */

/**
 * @typedef {object} ProbeView
 * @property {number} menuCount узлов `.vc-menu` в документе.
 * @property {number} openCount показанных уровней.
 * @property {string | null} theme `data-vc-theme` показанного уровня.
 * @property {string[]} log метки сработавших действий, по порядку.
 */

/**
 * @typedef {object} McProbe
 * @property {(set: 'selfDestroy' | 'plain') => void} make
 * @property {() => void} makeBadTheme
 * @property {() => void} makeNaNDuration
 * @property {() => void} makeEmptyLabel
 * @property {(x: number, y: number) => void} open
 * @property {(label: string) => void} activateWithKeyboard
 * @property {() => string[]} readErrors
 * @property {() => ProbeView} read
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
         style="position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: rgb(240, 240, 240)"></div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 800 };

/** Точка вызова: подальше от краёв, чтобы позиционирование не путать с закрытием. */
const OPEN_POINT = { x: 200, y: 200 };

/**
 * @param {import('@playwright/test').Page} page
 * @param {'selfDestroy' | 'plain'} set
 * @returns {Promise<void>}
 */
function makeMenu(page, set) {
  return page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(name);
  }, set);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'makeBadTheme' | 'makeNaNDuration' | 'makeEmptyLabel'} factory
 * @returns {Promise<string | null>} сообщение об ошибке либо `null`, если её не было.
 */
function makeWithBadOption(page, factory) {
  return page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    try {
      // Набор сужает параметр до трёх известных фабрик, и TypeScript здесь их
      // видит: индекс не нужен, а `@ts-expect-error` был бы директивой без
      // подавляемой ошибки.
      if (name === 'makeBadTheme') {
        scope.__mc.makeBadTheme();
      } else if (name === 'makeNaNDuration') {
        scope.__mc.makeNaNDuration();
      } else {
        scope.__mc.makeEmptyLabel();
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, factory);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function openAt(page, point) {
  return page.evaluate((payload) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.open(payload.x, payload.y);
  }, point);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<ProbeView>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
function readErrors(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.readErrors();
  });
}

test.describe('контракты на стыке модулей', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    // `goto` обязателен перед `setContent`: без него у документа нет адреса, и ни
    // ссылка на таблицу стилей, ни динамический импорт не разрешились бы.
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
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.evaluate(async () => {
      const { MyContext } = await import('../../src/index.js');

      /** @type {string[]} */
      const log = [];
      /** @type {string[]} */
      const errors = [];
      /** @type {InstanceType<typeof MyContext> | null} */
      let menu = null;

      globalThis.addEventListener('error', (event) => {
        errors.push(String(event.message));
      });
      // `unhandledrejection` ловит отклонённое обещание без обработчика. Ошибка из
      // обработчика клавиш синхронна и приходит в `error`, но действие вправе
      // вернуть отклонённое обещание, и тогда единственным сигналом будет он.
      globalThis.addEventListener('unhandledrejection', (event) => {
        errors.push(`отклонённое обещание: ${String(event.reason)}`);
      });

      const container = document.getElementById('surface');
      if (!(container instanceof HTMLElement)) {
        throw new Error('нет контейнера surface');
      }

      /**
       * @param {Array<MenuItem>} items
       * @param {Record<string, unknown>} [options]
       * @returns {void}
       */
      function build(items, options) {
        if (menu !== null) {
          menu.destroy();
        }
        log.length = 0;
        errors.length = 0;
        menu = new MyContext(items, options === undefined ? { label: 'Меню' } : options);
        const anchor = container;
        if (anchor === null) {
          throw new Error('нет контейнера surface');
        }
        menu.attach(anchor);
      }

      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc = {
        make(set) {
          if (set === 'selfDestroy') {
            build([
              {
                label: 'Закрыть навсегда',
                action: () => {
                  log.push('уничтожить');
                  // Обычная форма «снять с экрана по выбору»: пункт сносит то
                  // меню, в котором находится. Действие выполняется первым, а
                  // закрытие зовёт уже движок клавиатуры — и до `destroy()` оно
                  // было живо.
                  if (menu !== null) {
                    menu.destroy();
                  }
                },
              },
              { label: 'Просто пункт' },
            ]);
            return;
          }
          build([{ label: 'Просто пункт' }]);
        },
        makeBadTheme() {
          build([{ label: 'Пункт' }], { theme: 'нет-темы' });
        },
        makeNaNDuration() {
          build([{ label: 'Пункт' }], { animationDuration: Number.NaN });
        },
        makeEmptyLabel() {
          build([{ label: 'Пункт' }], { label: '' });
        },
        open(x, y) {
          if (menu === null) {
            throw new Error('меню не создано');
          }
          menu.open({ x, y });
        },
        activateWithKeyboard(name) {
          if (menu === null) {
            throw new Error('меню не создано');
          }
          for (const level of Array.from(document.querySelectorAll('.vc-menu'))) {
            for (const label of Array.from(level.querySelectorAll('.vc-label'))) {
              if (String(label.textContent) !== name) {
                continue;
              }
              const item = label.closest('.vc-item');
              if (item instanceof HTMLElement) {
                item.focus();
                // Клавиша активации работает по активному пункту, а не по
                // сфокусированному узлу: без отметки `Enter` не делает ничего, и
                // проба проверяла бы не путь активации, а произвольный фокус.
                item.setAttribute('data-active', '');
                item.dispatchEvent(
                  new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
                );
                return;
              }
            }
          }
          throw new Error(`пункт «${name}» не найден`);
        },
        readErrors() {
          return errors;
        },
        read() {
          const levels = Array.from(document.querySelectorAll('.vc-menu'));
          const shown = levels.filter((level) => level.matches(':popover-open'));
          return {
            menuCount: levels.length,
            openCount: shown.length,
            theme: shown.length === 0 ? null : shown[0].getAttribute('data-vc-theme'),
            log,
          };
        },
      };
    });
  });

  test('действие, уничтожившее экземпляр, не роняет обработчик клавиш', async ({ page }) => {
    await makeMenu(page, 'selfDestroy');
    await openAt(page, OPEN_POINT);
    const opened = await readMenu(page);
    expect(opened.openCount, 'меню открыто').toBe(1);

    // Клавиатура, а не мышь: именно этот путь звал `host.closeAll()` без проверки
    // и бросал `MyContext: экземпляр уничтожен` наружу из обработчика клавиш.
    // Проверяется именно то, что `closeAll` после `destroy()` не бросает, — сама
    // активация подтверждается журналом.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.activateWithKeyboard('Закрыть навсегда');
    });

    const after = await readMenu(page);
    expect(after.log, 'действие выполнилось').toEqual(['уничтожить']);
    expect(after.menuCount, 'уровней не осталось').toBe(0);
    // Ошибок не просто нет — их не могло быть и от промиса: обработчик обеих
    // необработанных ошибок стоит в `beforeEach` до создания меню.
    expect(await readErrors(page), 'страница без ошибок').toEqual([]);
  });

  test('негодная тема отклоняется, а не попадает в разметку', async ({ page }) => {
    // Контроль живости: тот же вызов без поломки не бросает ничего.
    await makeMenu(page, 'plain');
    expect(await makeWithBadOption(page, 'makeEmptyLabel'), 'контроль: имя обязательно').toContain(
      'options.label',
    );
    expect(
      await makeWithBadOption(page, 'makeBadTheme'),
      'тема названа в сообщении с путём до поля',
    ).toContain('options.theme');
    expect(await readErrors(page), 'страница без ошибок').toEqual([]);
  });

  test('негодная длительность отклоняется, а не даёт NaNms', async ({ page }) => {
    // `NaN` в длительности даёт недействительный токен, и переход схлопывается в
    // ноль: анимация пропадает молча, без ошибки и без следа. Раньше так и было.
    expect(
      await makeWithBadOption(page, 'makeNaNDuration'),
      'длительность названа с путём до поля',
    ).toContain('options.animationDuration');
  });

  test('негодные опции не оставляют после себя экземпляр', async ({ page }) => {
    // Конструктор бросает до `attach`, поэтому в документе не остаётся ни одного
    // уровня. Без проверки кейс прошёл бы и при экземпляре, который всё-таки
    // создался и просто не привязался.
    await makeWithBadOption(page, 'makeBadTheme');
    await makeWithBadOption(page, 'makeNaNDuration');
    await makeWithBadOption(page, 'makeEmptyLabel');

    const after = await readMenu(page);
    expect(after.menuCount, 'ни одного уровня в документе').toBe(0);
    expect(after.theme, 'показанного уровня нет').toBeNull();
  });
});
