import { expect, test } from '@playwright/test';
import { CLOSE_GRACE_MS, OPEN_GRACE_MS } from '../../src/constants.js';

/**
 * Кейсы глобальных слушателей: клики, клавиши, скролл, `resize` и движение курсора
 * в пустоте страницы. Модуль грузится динамическим импортом прямо в браузере,
 * наборы пунктов объявлены внутри пробы — у пунктов есть `action`-функции, а
 * `page.evaluate` сериализует аргументы как JSON.
 *
 * Отличие от `lifecycle.spec.js` в предмете: там проверяется, что меню живёт, а
 * здесь — что оно **слышит страницу**. Почти каждый кейс проверяет, что событие
 * *не* было обработано там, где обрабатывать его нельзя: скролл внутри списка,
 * правый клик по контейнеру, курсор над кнопкой. Меню, которое роняет всё подряд,
 * прошло бы половину этих проверок, поэтому отрицательные утверждения здесь
 * не weaker, а главные.
 *
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 */

/**
 * @typedef {object} MenuRect
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} LevelView
 * @property {string} id
 * @property {boolean} popoverOpen `:popover-open` — уровень в Top Layer.
 * @property {number} left
 * @property {number} top
 * @property {string[]} labels подписи показанных пунктов уровня.
 */

/**
 * @typedef {object} Snapshot
 * @property {LevelView[]} levels уровни в порядке документа.
 * @property {number} openCount сколько из них в Top Layer.
 * @property {string | null} focusOwnerId `id` элемента с фокусом либо имя тега.
 * @property {string[]} log метки сработавших действий, по порядку.
 * @property {string[]} errors сообщения необработанных ошибок страницы.
 * @property {boolean[]} contextmenuPrevented по порядку событий `contextmenu`,
 *   дошедших до документа: видно, подавила ли привязка системное меню.
 * @property {string[]} removed снятия слушателей в виде «событие@узел».
 */

/**
 * @typedef {object} McProbe
 * @property {(slot: 'first' | 'second', set: string, containerId: string | null) => void} make
 * @property {(slot: 'first' | 'second', x: number, y: number) => void} open
 * @property {(slot: 'first' | 'second') => void} destroy
 * @property {() => Snapshot} read
 * @property {(name: string) => MenuRect | null} rectOf
 * @property {(name: string) => string | null} submenuIdOf
 */

const STYLESHEET_PATH = '/styles/mycontext.css';

const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <body style="background: rgb(255, 255, 255); margin: 0">
    <!-- Высота тела больше вьюпорта, иначе страница не прокрутилась бы и кейс
         про скролл проверял бы отсутствие события вместо его обработки. -->
    <div id="surface" tabindex="0"
         style="position: fixed; left: 20px; top: 60px; width: 320px; height: 200px; background: rgb(238, 238, 238)"></div>
    <div id="far" tabindex="0"
         style="position: fixed; left: 620px; top: 480px; width: 200px; height: 120px; background: rgb(204, 204, 204)"></div>
    <div id="backdrop" tabindex="0"
         style="height: 2400px; background: linear-gradient(rgb(250, 250, 250), rgb(200, 200, 255))"></div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };

/** Точка правого клика: внутри `#surface`, далеко от его краёв. */
const SURFACE_POINT = { x: 150, y: 150 };

/** Пустота страницы: далеко от меню, контейнера и обоих краёв вьюпорта. */
const VOID_POINT = { x: 940, y: 640 };

/** Второй контейнер — тоже в стороне от первого и от меню. */
const FAR_POINT = { x: 700, y: 520 };

// Момент заморозки часов. Фиксированная дата вместо `Date.now()`: от неё не
// зависит ни порядок событий, ни результат, и прогон воспроизводим.
const CLOCK_FROZEN_AT = new Date('2024-12-10T09:00:00Z');
const CLOCK_START_AT = new Date(CLOCK_FROZEN_AT.getTime() - 3_600_000);

/**
 * @param {import('@playwright/test').Page} page
 * @param {'first' | 'second'} slot какой экземпляр заводить.
 * @param {string} set имя набора пунктов.
 * @param {string | null} containerId контейнер привязки; `null` — без привязки.
 * @returns {Promise<void>}
 */
function makeMenu(page, slot, set, containerId) {
  return page.evaluate((input) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(input.slot, input.set, input.container);
  }, { slot, set, container: containerId });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Snapshot>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'first' | 'second'} slot
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function openAt(page, slot, point) {
  return page.evaluate(
    (input) => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.open(input.slot, input.point.x, input.point.y);
    },
    { slot, point },
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'first' | 'second'} slot
 * @returns {Promise<void>}
 */
function destroyMenu(page, slot) {
  return page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.destroy(name);
  }, slot);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<{ x: number, y: number }>}
 */
async function centreOf(page, label) {
  const rect = await page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.rectOf(name);
  }, label);
  expect(rect, `пункт «${label}» есть в разметке`).not.toBeNull();
  const found = /** @type {MenuRect} */ (rect);
  return { x: found.left + found.width / 2, y: found.top + found.height / 2 };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<void>}
 */
async function hoverItem(page, label) {
  const point = await centreOf(page, label);
  await page.mouse.move(point.x, point.y);
}

/**
 * @param {Snapshot} snapshot
 * @param {string} id
 * @returns {boolean}
 */
function isOpen(snapshot, id) {
  const level = snapshot.levels.find((entry) => entry.id === id);
  return level !== undefined && level.popoverOpen;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<string | null>}
 */
function submenuIdOf(page, label) {
  return page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.submenuIdOf(name);
  }, label);
}

test.describe('глобальные слушатели', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: CLOCK_START_AT });
    await page.setViewportSize(VIEWPORT);
    // `goto` обязателен перед `setContent`: без него у документа нет адреса, и ни
    // ссылка на таблицу стилей, ни динамический импорт не разрешились бы.
    await page.goto('/');
    await page.setContent(PAGE_HTML);
    // Живая таблица стилей ещё могла не примениться, и замер меню вернул бы нули.
    await page.waitForFunction(
      (path) => {
        return Array.from(document.styleSheets).some((sheet) => {
          return sheet.href !== null && sheet.href.endsWith(path) && sheet.cssRules.length > 0;
        });
      },
      STYLESHEET_PATH,
      { timeout: 5000 },
    );
    // `reduce` пропускает отложенное закрытие целиком, и `hidePopover` происходит
    // сразу: состояние после действия не зависит ни от таймера, ни от анимации.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.evaluate(async () => {
      const { MyContext } = await import('../../src/index.js');

      /**
       * Наборы объявлены здесь, а не приходят аргументом: у пунктов есть
       * `action`-функции, а `page.evaluate` сериализует аргументы как JSON.
       *
       * `chain` — три уровня, потому что «закрыть каскад целиком» и «закрыть один
       * уровень» расходятся только начиная с глубины два: на двух уровнях
       * «глубочайший» и «единственный лишний» — это один и тот же уровень, и
       * кейс прошёл бы на неверной реализации.
       *
       * `long` — сорок пунктов: `max-height` у `.vc-list` ограничивает рамку, и
       * список обязан стать прокручиваемым, иначе кейс про внутренний скролл
       * проверял бы прокрутку, которой нет.
       *
       * @type {Record<string, Array<MenuItem | SeparatorItem>>}
       */
      const sets = {
        chain: [
          { label: 'Новый', action: () => log.push('новый') },
          {
            label: 'Экспорт',
            submenu: [
              { label: 'PDF', action: () => log.push('pdf') },
              {
                label: 'PNG',
                submenu: [{ label: 'Один', action: () => log.push('один') }],
                action: () => log.push('png'),
              },
            ],
            action: () => log.push('экспорт'),
          },
          { label: 'Заметки', action: () => log.push('заметки') },
        ],
        long: Array.from({ length: 40 }, (unused, index) => {
          return { label: `Пункт ${index + 1}`, action: () => log.push(`пункт ${index + 1}`) };
        }),
      };

      /** @type {string[]} */
      const log = [];
      /** @type {string[]} */
      const errors = [];
      /** @type {boolean[]} */
      const contextmenuPrevented = [];
      /** @type {string[]} */
      const removed = [];

      globalThis.addEventListener('error', (event) => {
        errors.push(String(event.message));
      });
      // Журнал `contextmenu` на документе в фазе всплытия: наш обработчик висит
      // в capture на документе, то есть отработает раньше, и к моменту всплытия
      // `defaultPrevented` уже показывает, подавили мы системное меню или нет.
      document.addEventListener('contextmenu', (event) => {
        contextmenuPrevented.push(event.defaultPrevented);
      });

      /**
       * @typedef {object} Slot
       * @property {InstanceType<typeof MyContext> | null} menu
       * @property {string} slot
       */
      /** @type {Map<string, InstanceType<typeof MyContext>>} */
      const instances = new Map();

      // Шпион на снятии слушателей. `destroy()` экземпляра снаружи неотличим от
      // снятого: обработчик молчит на флаге уничтожения, и «ничего не сломалось»
      // ничего не говорит о том, снят ли он на самом деле.
      const nativeRemove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.removeEventListener = function patched(type, handler, options) {
        const name = this instanceof Document ? 'document' : this instanceof Window ? 'window' : 'элемент';
        removed.push(`${String(type)}@${name}`);
        return nativeRemove.call(this, type, handler, options);
      };

      /**
       * @returns {Snapshot}
       */
      function read() {
        const levels = Array.from(document.querySelectorAll('.vc-menu')).map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.id,
            popoverOpen: element.matches(':popover-open'),
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            labels: Array.from(element.querySelectorAll('.vc-label')).map((node) => {
              return String(node.textContent);
            }),
          };
        });
        const active = document.activeElement;
        return {
          levels,
          openCount: levels.filter((level) => level.popoverOpen).length,
          focusOwnerId: active === null ? null : active.id !== '' ? active.id : active.tagName.toLowerCase(),
          log,
          errors,
          contextmenuPrevented,
          removed,
        };
      }

      /**
       * @param {Element} item
       * @returns {MenuRect}
       */
      function rectOf(item) {
        const rect = item.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }

      /**
       * @param {string} name
       * @returns {MenuRect | null}
       */
      function rectOfLabel(name) {
        for (const label of Array.from(document.querySelectorAll('.vc-label'))) {
          if (String(label.textContent) !== name) {
            continue;
          }
          const item = label.closest('.vc-item');
          return item === null ? null : rectOf(item);
        }
        return null;
      }

      /**
       * @param {string} name
       * @returns {string | null}
       */
      function submenuIdOf(name) {
        for (const label of Array.from(document.querySelectorAll('.vc-label'))) {
          if (String(label.textContent) !== name) {
            continue;
          }
          const item = label.closest('.vc-item');
          if (item === null) {
            return null;
          }
          const owns = item.getAttribute('aria-owns');
          return owns !== null && owns !== '' ? owns : null;
        }
        return null;
      }

      // Приведение — единственное место, где проба попадает на глобальный объект:
      // `page.evaluate` исполняется в браузере и достаёт её оттуда приведением
      // внутри колбэка, то есть проверяя каждое чтение.
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc = {
        /**
         * @param {'first' | 'second'} slot
         * @param {string} set
         * @param {string | null} containerId
         * @returns {void}
         */
        make(slot, set, containerId) {
          const menu = new MyContext(sets[set]);
          if (containerId !== null) {
            const element = document.getElementById(containerId);
            if (element === null) {
              throw new Error(`нет узла #${containerId}`);
            }
            menu.attach(element);
          }
          instances.set(slot, menu);
        },
        /**
         * @param {'first' | 'second'} slot
         * @param {number} x
         * @param {number} y
         * @returns {void}
         */
        open(slot, x, y) {
          const menu = instances.get(slot);
          if (menu === undefined) {
            throw new Error(`нет экземпляра ${slot}`);
          }
          menu.open({ x, y });
        },
        /**
         * @param {'first' | 'second'} slot
         * @returns {void}
         */
        destroy(slot) {
          const menu = instances.get(slot);
          if (menu === undefined) {
            throw new Error(`нет экземпляра ${slot}`);
          }
          menu.destroy();
        },
        read,
        rectOf: rectOfLabel,
        submenuIdOf,
      };
    });
  });

  test('клик левой кнопкой вне дерева закрывает меню и не уводит фокус на контейнер', async ({
    page,
  }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    expect((await readMenu(page)).openCount, 'меню открыто').toBe(1);

    // Клик по `#far`, а не по контейнеру: контейнер исключён из зоны закрытия
    // намеренно, и клик по нему проверяет совсем другое.
    await page.mouse.click(FAR_POINT.x, FAR_POINT.y);

    const after = await readMenu(page);
    expect(after.openCount, 'меню закрыто').toBe(0);
    // Фокус после клика по `#far` остаётся на самом `#far` — элемент, который
    // пользователь и нажал. Возврат на контейнер здесь означал бы, что каждый
    // клик по странице перехватывает фокус, и Tab после него начинал бы не с
    // того места.
    expect(after.focusOwnerId, 'фокус остался там, где кликнули').toBe('far');
    expect(after.errors, 'страница без ошибок').toEqual([]);
  });

  test('уход курсора в пустоту страницы закрывает каскад целиком', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);

    // Цепочка из трёх уровней через клавиатуру: наведение здесь не годится, его
    // задержка сделала бы кейс зависимым от часов дважды, а здесь проверяется
    // закрытие, а не показ. `focusFirst` ставит фокус на первый пункт, поэтому до
    // «Экспорта» — один шаг вниз.
    const exportId = await submenuIdOf(page, 'Экспорт');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    const pngId = await submenuIdOf(page, 'PNG');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');

    const opened = await readMenu(page);
    expect(opened.openCount, 'открыты корень и два подменю').toBe(3);
    expect(isOpen(opened, /** @type {string} */ (exportId)), 'уровень «Экспорт» показан').toBe(true);
    expect(isOpen(opened, /** @type {string} */ (pngId)), 'уровень «PNG» показан').toBe(true);

    await page.mouse.move(VOID_POINT.x, VOID_POINT.y);
    // До истечения задержки закрытия каскад стоит: без этого утверждения кейс
    // прошёл бы на мгновенном закрытии, а задержка — часть контракта.
    const midway = await readMenu(page);
    expect(midway.openCount, 'до задержки закрытия каскад цел').toBe(3);

    await page.clock.fastForward(CLOSE_GRACE_MS);

    const after = await readMenu(page);
    expect(after.openCount, 'после ухода курсора закрыт весь каскад').toBe(0);
    // Поимённо по среднему уровню: именно он выживает в реализации, которая
    // закрывает один уровень на сигнал. Общее `openCount === 0` поймало бы обе
    // ошибки, но не сказало бы, какая из двух осталась.
    expect(isOpen(after, /** @type {string} */ (pngId)), 'глубочайший закрыт').toBe(false);
    expect(isOpen(after, /** @type {string} */ (exportId)), 'средний закрыт, а не только глубочайший').toBe(
      false,
    );
  });

  test('правый клик вне дерева закрывает меню, но не подавляет системное', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);

    await page.mouse.click(VOID_POINT.x, VOID_POINT.y, { button: 'right' });

    const after = await readMenu(page);
    expect(after.openCount, 'меню закрыто').toBe(0);
    // Подавление системного меню вне нашего меню сделало бы библиотеку глобальным
    // перехватчиком: правый клик по чужой странице перестал бы работать совсем.
    expect(
      after.contextmenuPrevented,
      'системное меню вне нашего меню не подавлено',
    ).toEqual([false]);
  });

  test('правый клик по пункту меню подавляет системное и не двигает наше', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    const before = await readMenu(page);
    const rootLevel = /** @type {LevelView} */ (before.levels.find((entry) => entry.popoverOpen));

    // Правый клик идёт по настоящему пункту меню, а не по произвольной точке
    // рядом: иначе кейс проверял бы подавление системного меню на странице, где
    // нашего меню под курсором нет, и прошёл бы на ветке «всё вне дерева».
    const item = await centreOf(page, 'Заметки');
    await page.mouse.click(item.x, item.y, { button: 'right' });

    const after = await readMenu(page);
    expect(after.openCount, 'меню осталось открытым').toBe(1);
    expect(after.contextmenuPrevented, 'системное меню подавлено').toEqual([true]);
    // Позиция та же: правый клик по пункту — это не перенос меню в новую точку.
    const stillRoot = /** @type {LevelView} */ (after.levels.find((entry) => entry.id === rootLevel.id));
    expect(stillRoot.left, 'уровень не уехал').toBe(rootLevel.left);
    expect(stillRoot.top, 'уровень не уехал').toBe(rootLevel.top);
    expect(after.log, 'чужое действие не вызвано').toEqual([]);
  });
  test('правый клик по контейнеру переоткрывает меню в новой точке', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    const before = await readMenu(page);
    const rootBefore = /** @type {LevelView} */ (before.levels.find((entry) => entry.popoverOpen));

    // Другая точка того же контейнера, достаточно далеко от первой, чтобы
    // перенос был виден по координатам уровня.
    await page.mouse.click(300, 220, { button: 'right' });

    const after = await readMenu(page);
    expect(after.openCount, 'меню осталось открытым, а не снеслось и не задвоилось').toBe(1);
    const rootAfter = /** @type {LevelView} */ (after.levels.find((entry) => entry.id === rootBefore.id));
    // Перенос виден по рамке: `open()` идемпотентен и двигает уже показанный
    // уровень. Прежняя точка и новая отличаются на 150 px по каждой оси.
    expect(Math.abs(rootAfter.left - rootBefore.left), 'меню переехало по горизонтали').toBeGreaterThan(
      50,
    );
    expect(Math.abs(rootAfter.top - rootBefore.top), 'меню переехало по вертикали').toBeGreaterThan(50);
  });

  test('Escape при фокусе вне меню всё равно закрывает его', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    expect((await readMenu(page)).openCount, 'меню открыто').toBe(1);

    // Фокус уводится на `#far` настоящим кликом, а не `focus()`: иначе кейс
    // прошёл бы на элементе, который ни разу не участвовал в мышиных путях, и
    // проверял бы не тот `Escape`, который получит живой пользователь.
    await page.mouse.click(FAR_POINT.x, FAR_POINT.y);
    expect((await readMenu(page)).focusOwnerId, 'фокус вне меню').toBe('far');

    await page.keyboard.press('Escape');

    const after = await readMenu(page);
    expect(after.openCount, 'Escape вне меню закрыл его').toBe(0);
  });

  test('скролл страницы закрывает меню', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    expect((await readMenu(page)).openCount, 'меню открыто').toBe(1);

    await page.evaluate(() => {
      window.scrollTo(0, 400);
    });
    // Событие `scroll` доставляется браузером уже после того, как `scrollTo`
    // вернулся, поэтому снимок сразу после вызова читает состояние до
    // обработчика — и кейс мигает между прогонами. Ожидание условия честнее
    // утверждения: проверяется «меню закрылось», а не «меню уже закрылось к
    // моменту возврата `scrollTo`».
    await page.waitForFunction(() => {
      const levels = Array.from(document.querySelectorAll('.vc-menu'));
      return levels.length > 0 && levels.every((level) => !level.matches(':popover-open'));
    });
    expect(await page.evaluate(() => window.scrollY), 'страница прокрутилась').toBeGreaterThan(0);

    const after = await readMenu(page);
    expect(after.openCount, 'скролл страницы закрыл меню').toBe(0);
    expect(after.errors, 'страница без ошибок').toEqual([]);
  });

  test('скролл внутреннего списка длинного меню его не закрывает', async ({ page }) => {
    await makeMenu(page, 'first', 'long', 'surface');
    await openAt(page, 'first', SURFACE_POINT);

    // Прокручиваемость проверяется до прокрутки: иначе кейс прошёл бы на узле,
    // который и не прокручивается, и утверждал бы «меню не закрылось» вовсе ни
    // о чём.
    const scrollable = await page.evaluate(() => {
      const list = document.querySelector('.vc-list');
      return list instanceof HTMLElement && list.scrollHeight > list.clientHeight;
    });
    expect(scrollable, 'список длинного меню прокручивается').toBe(true);

    await page.evaluate(() => {
      const list = document.querySelector('.vc-list');
      if (list instanceof HTMLElement) {
        list.scrollTop = 120;
      }
    });

    const after = await readMenu(page);
    expect(after.openCount, 'внутренний скролл не закрыл меню').toBe(1);
  });

  test('resize окна закрывает меню', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    expect((await readMenu(page)).openCount, 'меню открыто').toBe(1);

    await page.setViewportSize({ width: 900, height: 640 });
    // `resize` доставляется после возврата из изменения вьюпорта, как и
    // `scroll`, поэтому ждём условие, а не читаем снимок сразу.
    await page.waitForFunction(() => {
      const levels = Array.from(document.querySelectorAll('.vc-menu'));
      return levels.length > 0 && levels.every((level) => !level.matches(':popover-open'));
    });

    const after = await readMenu(page);
    expect(after.openCount, 'resize закрыл меню').toBe(0);
  });

  test('два экземпляра на одной странице не мешают друг другу', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await makeMenu(page, 'second', 'chain', 'far');
    await openAt(page, 'first', SURFACE_POINT);
    await openAt(page, 'second', FAR_POINT);

    const opened = await readMenu(page);
    expect(opened.openCount, 'открыты оба меню').toBe(2);
    // Пересечение `id` у двух экземпляров сделало бы `aria-owns` неоднозначным, и
    // `aria-level` начал бы считаться от чужого уровня.
    const ids = opened.levels.map((level) => level.id);
    expect(new Set(ids).size, 'id уровней не пересекаются').toBe(ids.length);
  });

  test('меню одного экземпляра не закрывает меню другого', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await makeMenu(page, 'second', 'chain', 'far');
    await openAt(page, 'first', SURFACE_POINT);
    await openAt(page, 'second', FAR_POINT);
    expect((await readMenu(page)).openCount, 'открыты оба меню').toBe(2);

    // Клик по контейнеру первого закрывает его меню — и только его. Второе стоит
    // в другом месте страницы и закрываться не должно: глобальный обработчик
    // смотрит на «внутри дерева ли», а дерева у чужого экземпляра своё.
    await page.mouse.click(40, 80);

    const after = await readMenu(page);
    expect(after.openCount, 'осталось одно меню').toBe(1);
  });

  test('destroy одного экземпляра не ломает второй', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await makeMenu(page, 'second', 'chain', 'far');
    await openAt(page, 'first', SURFACE_POINT);
    await openAt(page, 'second', FAR_POINT);

    await destroyMenu(page, 'first');

    const after = await readMenu(page);
    expect(after.openCount, 'меню второго экземпляра уцелело').toBe(1);
    expect(after.errors, 'страница без ошибок').toEqual([]);

    // Второй экземпляр должен остаться рабочим, а не просто не рассыпаться:
    // иначе «уцелел» означало бы «молчал».
    await page.mouse.click(VOID_POINT.x, VOID_POINT.y);
    const closed = await readMenu(page);
    expect(closed.openCount, 'второй экземпляр всё ещё слышит страницу').toBe(0);
  });

  test('destroy снимает все глобальные слушатели', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await destroyMenu(page, 'first');

    const after = await readMenu(page);
    // Шесть глобальных слушателей: `pointermove`, `pointerdown`, `contextmenu`
    // и `keydown` на документе, `scroll` и `resize` на окне. Число названо явно,
    // а не «снимает все», чтобы забытый обработчик не прошёл на формулировке.
    for (const type of ['pointermove', 'pointerdown', 'contextmenu', 'keydown', 'scroll', 'resize']) {
      expect(after.removed, `слушатель ${type} снят`).toContain(`${type}@${type === 'scroll' || type === 'resize' ? 'window' : 'document'}`);
    }

    // Меню уничтожено, и события страницы не должны ни падать, ни воскресить его.
    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });
    await page.setViewportSize({ width: 880, height: 620 });
    await page.mouse.move(VOID_POINT.x, VOID_POINT.y);
    await page.keyboard.press('Escape');

    const final = await readMenu(page);
    expect(final.levels.length, 'уровней не осталось').toBe(0);
    expect(final.errors, 'события страницы после destroy не падают').toEqual([]);
  });
});
