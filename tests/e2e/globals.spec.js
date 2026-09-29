import { expect, test } from '@playwright/test';
import { OPEN_GRACE_MS } from '../../src/constants.js';

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
 * @property {string[]} activeLabels подписи пунктов с `data-active` по всем уровням.
 *   Сама подсветка на странице не проверяется, а отметка на узле: окрашивает её
 *   таблица стилей, и интересен факт отметки, а не её цвет.
 * @property {string | null} focusOwnerId `id` элемента с фокусом либо имя тега.
 * @property {string[]} log метки сработавших действий, по порядку.
 * @property {string[]} errors сообщения необработанных ошибок страницы.
 * @property {boolean[]} contextmenuPrevented по порядку событий `contextmenu`,
 *   дошедших до документа: видно, подавила ли привязка системное меню.
 * @property {string[]} focusLog `id` узлов, получивших фокус, по порядку. Нужен
 *   помимо `focusOwnerId`: браузер переносит фокус на нажатый элемент уже после
 *   нашего `pointerdown`, и конечное состояние одинаково — вернёт меню фокус на
 *   контейнер или нет. Различие видно только по тому, получил ли контейнер фокус
 *   хоть на мгновение.
 * @property {number} hideCount сколько раз вызван `hidePopover`. Различает
 *   «переоткрылось» и «закрылось и тут же открылось заново»: конечное состояние
 *   у обоих одинаково, а второе означает мигание выхода и лишний цикл работы
 *   на каждый правый клик по контейнеру.
 * @property {string[]} removed снятия слушателей в виде «событие@узел».
 */

/**
 * @typedef {object} McProbe
 * @property {(slot: 'first' | 'second', set: string, containerId: string | null) => void} make
 * @property {(slot: 'first' | 'second', x: number, y: number) => void} open
 * @property {(slot: 'first' | 'second') => void} destroy
 * @property {(slot: 'first' | 'second') => void} detach
 * @property {() => Snapshot} read
 * @property {(name: string) => MenuRect | null} rectOf
 * @property {(name: string) => string | null} submenuIdOf
 */

/**
 * @typedef {object} DownEventRecord
 * @property {string} type имя события: `pointerdown` либо совместимый `mousedown`.
 * @property {number} button номер кнопки из `MouseEvent.button`.
 * @property {boolean} prevented `defaultPrevented` к моменту всплытия на документ.
 * @property {boolean} cancelable `cancelable` события. На неснимаемом событии
 *   `preventDefault()` не делает ничего, и без этого поля `false` в `prevented` не
 *   отличался бы от «гашения не было».
 * @property {string} level `id` ближайшего уровня меню, в чьём дереве оказалась
 *   цель, `''` вне дерева. Разделяет нажатия по уровням: гасится всё дерево, и
 *   запись без уровня не сказала бы, в каком именно уровне пришло нажатие.
 */

/**
 * @typedef {object} DownEventProbe
 * @property {DownEventRecord[]} __downEvents записи пробы на `globalThis`.
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
    <!-- Прокручиваемая обёртка — типовой каркас приложения. Скролл приходит с
         целью в этом div, и это не прокрутка меню, поэтому закрыть его обязан. -->
    <div id="shell" style="position: fixed; left: 20px; top: 320px; width: 320px; height: 200px; overflow: auto; background: rgb(244, 244, 244)">
      <div style="height: 1200px"></div>
    </div>
    <div id="backdrop" tabindex="0"
         style="height: 2400px; background: linear-gradient(rgb(250, 250, 250), rgb(200, 200, 255))"></div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };

/** Точка правого клика: внутри `#surface`, далеко от его краёв. */
const SURFACE_POINT = { x: 150, y: 150 };

/** Пустота страницы: далеко от меню, контейнера и обоих краёв вьюпорта. */
const VOID_POINT = { x: 940, y: 640 };

/**
 * Точка второй постановки меню: далеко от первой и в стороне от пустоты, по которой
 * ушёл курсор.
 */
const REOPEN_POINT = { x: 300, y: 380 };

/** Точка внутри прокручиваемой обёртки: меню открыто там, где им и открывают. */
const SHELL_POINT = { x: 180, y: 400 };

/** Второй контейнер — тоже в стороне от первого и от меню. */
const FAR_POINT = { x: 700, y: 520 };

/**
 * Номера кнопок из `MouseEvent.button`: те же значения, что у `PointerEvent.button`,
 * потому что `PointerEvent` продолжает `MouseEvent`.
 */
const PRIMARY_BUTTON = 0;
const MIDDLE_BUTTON = 1;
const RIGHT_BUTTON = 2;

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
 * @param {'first' | 'second'} slot
 * @returns {Promise<void>}
 */
function detachMenu(page, slot) {
  return page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.detach(name);
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
 * Заводит пробу нажатий на документе: `pointerdown` и совместимый `mousedown`.
 *
 * Оба события в фазе всплытия, а не в `capture`: гасит библиотека подпиской на
 * самом элементе уровня, а capture на документе прошла бы раньше неё и записала
 * бы `false` даже при исправном поведении — то есть проверяла бы не то событие.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function watchDownEvents(page) {
  return page.evaluate(() => {
    const scope = /** @type {DownEventProbe} */ (/** @type {unknown} */ (globalThis));
    scope.__downEvents = [];
    /**
     * @param {MouseEvent} event
     * @returns {void}
     */
    const record = (event) => {
      const menu = event.target instanceof Element ? event.target.closest('.vc-menu') : null;
      scope.__downEvents.push({
        type: event.type,
        button: event.button,
        prevented: event.defaultPrevented,
        cancelable: event.cancelable,
        level: menu === null ? '' : menu.id,
      });
    };
    document.addEventListener('pointerdown', record);
    document.addEventListener('mousedown', record);
  });
}

/**
 * Все записи пробы нажатий, по порядку появления.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<DownEventRecord[]>}
 */
function readDownEvents(page) {
  return page.evaluate(() => {
    const scope = /** @type {DownEventProbe} */ (/** @type {unknown} */ (globalThis));
    return scope.__downEvents;
  });
}

/**
 * Записи пробы одного вида внутри одного уровня.
 *
 * @param {DownEventRecord[]} records все записи пробы.
 * @param {string} type имя события.
 * @param {number} button номер кнопки из `MouseEvent.button`.
 * @param {string} level `id` уровня меню, `''` — событие вне дерева.
 * @returns {DownEventRecord[]}
 */
function downsIn(records, type, button, level) {
  return records.filter((entry) => {
    return entry.type === type && entry.button === button && entry.level === level;
  });
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
          { labelAction: () => 'Новый', action: () => log.push('новый') },
          {
            labelAction: () => 'Экспорт',
            submenuAction: () => [
              { labelAction: () => 'PDF', action: () => log.push('pdf') },
              {
                labelAction: () => 'PNG',
                submenuAction: () => [{ labelAction: () => 'Один', action: () => log.push('один') }],
                action: () => log.push('png'),
              },
            ],
            action: () => log.push('экспорт'),
          },
          { labelAction: () => 'Заметки', action: () => log.push('заметки') },
        ],
        long: Array.from({ length: 40 }, (unused, index) => {
          return { labelAction: () => `Пункт ${index + 1}`, action: () => log.push(`пункт ${index + 1}`) };
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
      /** @type {string[]} */
      const focusLog = [];
      /** @type {number[]} */
      const hideLog = [];

      // Счётчик `hidePopover`: состояние после правого клика по контейнеру
      // одинаково и при «просто переоткрылось», и при «закрылось и открылось
      // заново», поэтому различает их только число скрытий.
      const nativeHide = HTMLElement.prototype.hidePopover;
      HTMLElement.prototype.hidePopover = function patchedHide() {
        hideLog.push(Date.now());
        return nativeHide.call(this);
      };

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
          activeLabels: Array.from(document.querySelectorAll('.vc-item[data-active]')).map((item) => {
            const label = item.querySelector('.vc-label');
            return label === null ? '' : String(label.textContent);
          }),
          focusOwnerId: active === null ? null : active.id !== '' ? active.id : active.tagName.toLowerCase(),
          log,
          errors,
          contextmenuPrevented,
          focusLog,
          hideCount: hideLog.length,
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
            // `focus` без всплытия, поэтому слушатель смотрит на фазу захвата
            // каждого контейнера: иначе всплытие от нажатого элемента записало бы
            // в журнал не то, что его коснулось.
            element.addEventListener(
              'focus',
              () => {
                focusLog.push(element.id);
              },
              true,
            );
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
        /**
         * @param {'first' | 'second'} slot
         * @returns {void}
         */
        detach(slot) {
          const menu = instances.get(slot);
          if (menu === undefined) {
            throw new Error(`нет экземпляра ${slot}`);
          }
          menu.detach();
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

    // Клик по `#far`, а не по контейнеру: точка берётся там, где привязанного
    // контейнера нет вовсе, и различие с кликом по контейнеру теперь не в правиле
    // закрытия — оба закрывают, — а в возврате фокуса, который проверяет второй
    // кейс.
    await page.mouse.click(FAR_POINT.x, FAR_POINT.y);

    const after = await readMenu(page);
    expect(after.openCount, 'меню закрыто').toBe(0);
    // Фокус после клика по `#far` остаётся на самом `#far` — элемент, который
    // пользователь и нажал.
    expect(after.focusOwnerId, 'фокус остался там, где кликнули').toBe('far');
    // И, что важнее, контейнер не получал фокус ни на мгновение. Одного
    // `focusOwnerId` мало: браузер переносит фокус на нажатый узел уже после
    // нашего `pointerdown`, и вариант с возвратом фокуса на контейнер дал бы в
    // итоге тот же `far`. Журнал слушает только контейнеры, и пустой журнал здесь
    // — ровно то утверждение, которое различает два варианта.
    expect(after.focusLog, 'контейнер ни разу не получил фокус').toEqual([]);
    expect(after.errors, 'страница без ошибок').toEqual([]);
  });

  test('уход курсора в пустоту страницы не закрывает подменю', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);

    // Цепочка из трёх уровней через клавиатуру: наведение здесь не годится, его
    // задержка сделала бы кейс зависимым от часов. Показ меню выделения не
    // оставляет, поэтому до первого пункта и до «Экспорта» идут два шага вниз,
    // а внутри подменю — один, до «PNG».
    const exportId = await submenuIdOf(page, 'Экспорт');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    const pngId = await submenuIdOf(page, 'PNG');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');

    const opened = await readMenu(page);
    expect(opened.openCount, 'открыты корень и два подменю').toBe(3);
    expect(isOpen(opened, /** @type {string} */ (exportId)), 'уровень «Экспорт» показан').toBe(true);
    expect(isOpen(opened, /** @type {string} */ (pngId)), 'уровень «PNG» показан').toBe(true);
    // Уровни перечислены в порядке документа, а показан раньше всех корень: его
    // `id` снимается здесь, чтобы состояние проверялось поимённо, а не по счёту.
    const rootId = opened.levels[0].id;

    await page.mouse.move(VOID_POINT.x, VOID_POINT.y);
    // Втрое больше прежнего срока закрытия подменю: такого таймера больше нет, и
    // ожидание здесь доказывает именно это — подменю не гаснет само по себе.
    await page.clock.fastForward(3000);

    const after = await readMenu(page);
    // Ни один уровень не уходит. Закрытия по уходу курсора не существует: подменю
    // принадлежит активному пункту уровня, а он остался прежним, и увести его
    // может только переход на соседний пункт либо клик, `Escape` и уход со
    // страницы — то есть ровно те события, что перечислены отдельно.
    expect(after.openCount, 'каскад подменю цел').toBe(3);
    expect(isOpen(after, /** @type {string} */ (pngId)), 'глубочайший на месте').toBe(true);
    expect(isOpen(after, /** @type {string} */ (exportId)), 'средний на месте').toBe(true);
    expect(isOpen(after, rootId), 'корень на месте').toBe(true);
    expect(after.errors, 'страница без ошибок').toEqual([]);
  });
  test('клик по контейнеру закрывает меню целиком', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    // Каскад из трёх уровней: закрытие «целиком» и закрытие одного уровня
    // расходятся только начиная с глубины два.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    expect((await readMenu(page)).openCount, 'открыты корень и два подменю').toBe(3);

    // Точка та же, что в кейсе про уход курсора: контейнер, а не пустота страницы.
    await page.mouse.click(30, 70);

    const closed = await readMenu(page);
    expect(closed.openCount, 'левым кликом по контейнеру закрыто всё меню').toBe(0);
    // Фокус остался там, куда кликнули: закрытие по внешнему событию фокус не
    // возвращает, иначе каждый клик по странице перехватывал бы его у нажатого.
    expect(closed.focusOwnerId, 'фокус на контейнере, куда кликнули').toBe('surface');

    // Курсор идёт дальше по контейнеру: закрытое меню обязано остаться закрытым и не
    // забрать фокус себе. Возврат фокуса в сбросе выделения срабатывает только когда
    // фокус и был в меню, так что проверяется ровно страховой сценарий: увод курсора
    // не отбирает фокус у элемента, который пользователь нажал сам.
    //
    // Точка взята в стороне от меню, а не поверх него: закрытый уровень не отдаёт
    // своей старой рамки и забирает события под ней — это отдельная правка, в эту
    // задачу не входящая, — и движение поверх него уводит фокус в невидимое меню
    // мимо всех правил этого кейса.
    await page.mouse.move(40, 240);
    const after = await readMenu(page);
    expect(after.openCount, 'меню не воскресло').toBe(0);
    expect(after.focusOwnerId, 'фокус не уехал в скрытый уровень').toBe('surface');
    expect(after.errors, 'страница без ошибок').toEqual([]);
  });

  test('уход курсора не отбирает фокус, оставленный на странице', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    await hoverItem(page, 'Заметки');
    const marked = await readMenu(page);
    expect(marked.activeLabels, 'выделение в меню есть').toEqual(['Заметки']);

    // Фокус уводится на страницу настоящим `focus()`, а не кликом: левый клик
    // внутри привязанного контейнера закрывает меню, и состояния «меню открыто,
    // фокус на странице» кликом больше не достичь. Оно остаётся достижимым — сама
    // страница переносит фокус, пока меню открыто, — и меню обязано это уважать.
    await page.evaluate(() => {
      const surface = document.getElementById('surface');
      if (surface instanceof HTMLElement) {
        surface.focus();
      }
    });
    const onSurface = await readMenu(page);
    expect(onSurface.openCount, 'меню осталось открытым').toBe(1);
    expect(onSurface.focusOwnerId, 'фокус на контейнере').toBe('surface');

    // Курсор двигается по контейнеру, то есть уходит с дерева меню. Выделение
    // сбрасывается — оно принадлежит меню, — а фокус остаётся на контейнере: увод
    // курсора не отменяет того, куда фокус поставил пользователь, и на каждом
    // движении мыши фокус не должен выдёргиваться обратно в меню.
    await page.mouse.move(300, 240);
    const after = await readMenu(page);
    expect(after.activeLabels, 'выделение сброшено').toEqual([]);
    expect(after.focusOwnerId, 'фокус остался на контейнере').toBe('surface');
    expect(after.errors, 'страница без ошибок').toEqual([]);
  });

  test('уход курсора с дерева меню сбрасывает выделение последнего уровня', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);

    // Отмечены оба уровня, и отмечены настоящими наведениями: на корень — на
    // владельце, в подменю — на своём первом пункте. Снимок с обеими отметками
    // обязателен: «выделение снято» прошло бы и на меню, в котором его не было.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'PDF');
    const marked = await readMenu(page);
    expect(marked.openCount, 'открыты корень и подменю').toBe(2);
    expect(marked.activeLabels.sort(), 'отмечены оба уровня').toEqual(['PDF', 'Экспорт']);

    // Курсор уходит на контейнер: это страница, а не меню. Отметка снимается с
    // последнего открытого уровня — с подменю, где курсор и стоял, — а отметка
    // владельца на корне остаётся: она означает «подменю раскрыто», а не «курсор
    // стоит на этом пункте», и по ней видно путь. Уровни при этом остаются на месте
    // — сброс отметок и закрытие подменю решают разные задачи, и сброс не должен
    // влечь за собой второе. Клика тут нет — иначе фокус ушёл бы на контейнер, и
    // сброс отметок нельзя было бы отличить от обычного ухода фокуса.
    await page.mouse.move(30, 70);
    const gone = await readMenu(page);
    expect(gone.activeLabels, 'отметка подменю снята, отметка владельца осталась').toEqual(['Экспорт']);
    expect(gone.openCount, 'оба уровня на месте').toBe(2);
    // Фокус вернулся на элемент сброшенного уровня, а не на контейнер и не на
    // корень: меню обязано снова отвечать на клавиши, а разбирает оно их по цели
    // события, и целью остаётся подменю. Уровни перечислены в порядке документа,
    // и корневой — первый.
    expect(gone.focusOwnerId, 'фокус на элементе подменю').toBe(gone.levels[1].id);
    expect(gone.errors, 'страница без ошибок').toEqual([]);

    // Втрое больше прежнего срока закрытия подменю: таймера закрытия не осталось,
    // и подменю, оставшееся после ухода курсора, обязано пережить ожидание.
    await page.clock.fastForward(3000);
    const after = await readMenu(page);
    expect(after.openCount, 'подменю не закрылось уходом курсора').toBe(2);
    expect(after.activeLabels, 'выделение не вернулось само').toEqual(['Экспорт']);
    // Возврат фокуса в меню после сброса — не пустое утверждение: сначала
    // выделение было, и без сброса фокус остался бы на пункте под курсором.
    // Стрелка едет по подменю, а не по корню: подменю — самый глубокий открытый
    // уровень, и сброс снял выделение с него самого, а не с уровня, где фокус.
    await page.keyboard.press('ArrowDown');
    const keyed = await readMenu(page);
    expect(keyed.activeLabels.sort(), 'стрелка снова даёт крайний пункт подменю')
      .toEqual(['PDF', 'Экспорт']);
  });

  test('уход курсора снимает отметку последнего уровня, а не всего каскада', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);

    // Цепочка из трёх уровней: на двух уровнях «последний» и «остальные» не
    // разошлись бы, и кейс прошёл бы на сбросе по одному уровню вместо каскада.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'Один');
    const marked = await readMenu(page);
    expect(marked.openCount, 'открыты корень и два подменю').toBe(3);
    expect(marked.activeLabels.sort(), 'отмечены все три уровня')
      .toEqual(['PNG', 'Один', 'Экспорт']);

    await page.mouse.move(30, 70);
    const gone = await readMenu(page);
    // Снята только отметка последнего уровня: у него она означала «курсор стоит
    // на этом пункте», и без курсора ничего не значит. Отметки владельцев двух
    // подменю остаются — это путь раскрытия, а не остаток наведения.
    expect(gone.activeLabels.sort(), 'остались только отметки раскрытия')
      .toEqual(['PNG', 'Экспорт']);
    expect(gone.openCount, 'все три уровня на месте').toBe(3);
    // Фокус встал на элемент сброшенного уровня — того, где он и стоял, — чтобы
    // меню продолжало отвечать на клавиши с той же глубины.
    expect(gone.focusOwnerId, 'фокус на элементе последнего подменю')
      .toBe(gone.levels[2].id);
    expect(gone.errors, 'страница без ошибок').toEqual([]);
  });

  test('движение курсора вне меню выделение не сбрасывает', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    await hoverItem(page, 'Новый');

    // Первый уход курсора с дерева — переход, и сброс на нём случается: отметка
    // под курсором без курсора ничего не значит.
    await page.mouse.move(30, 70);
    const left = await readMenu(page);
    expect(left.activeLabels, 'после ухода выделения нет').toEqual([]);
    expect(left.openCount, 'меню осталось открытым').toBe(1);

    // Выделение ставит клавиша при курсоре на странице — и обязано удержаться:
    // уход уже состоялся, а курсор с тех пор не заходил в меню.
    await page.keyboard.press('ArrowDown');
    const keyed = await readMenu(page);
    expect(keyed.activeLabels, 'стрелка выделила пункт').toEqual(['Новый']);

    // Дальнейшие движения остаются за пределами меню. Сброс привязан к уходу, а не
    // к состоянию «курсор снаружи»: иначе каждое движение мыши стирало бы то, что
    // поставила клавиатура.
    await page.mouse.move(30, 240);
    await page.mouse.move(30, 320);
    const moved = await readMenu(page);
    expect(moved.activeLabels, 'выделение устояло').toEqual(['Новый']);
    expect(moved.openCount, 'меню осталось открытым').toBe(1);
    expect(moved.errors, 'страница без ошибок').toEqual([]);

    // Возврат курсора в меню и новый уход — новый переход, и сброс случается
    // снова: правило «уход сбрасывает» остаётся в силе.
    await hoverItem(page, 'Заметки');
    expect((await readMenu(page)).activeLabels, 'наведение сменило выделение').toEqual(['Заметки']);
    await page.mouse.move(30, 70);
    expect((await readMenu(page)).activeLabels, 'новый уход снова сбросил').toEqual([]);
  });

  test('Escape на самом контейнере закрывает меню', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    expect((await readMenu(page)).openCount, 'меню открыто').toBe(1);

    // Фокус переносится на контейнер `focus()`, а не кликом: клик закрыл бы меню,
    // а кейсу нужно открытое меню с фокусом на странице. `Escape` на контейнере —
    // уход из меню, а не шаг внутри, и оставить клавиатурного пользователя с
    // открытым меню без единого выхода нельзя.
    await page.evaluate(() => {
      const surface = document.getElementById('surface');
      if (surface instanceof HTMLElement) {
        surface.focus();
      }
    });
    expect((await readMenu(page)).focusOwnerId, 'фокус на контейнере').toBe('surface');
    expect((await readMenu(page)).openCount, 'меню ещё открыто').toBe(1);

    await page.keyboard.press('Escape');
    expect((await readMenu(page)).openCount, 'Escape на контейнере закрыл меню').toBe(0);
  });

  test('нажатие не основной кнопкой вне меню его не закрывает', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    expect((await readMenu(page)).openCount, 'меню открыто').toBe(1);

    // Средняя кнопка — не отмена меню: правый клик обрабатывается отдельно через
    // `contextmenu`, а нажатие любой не основной кнопки молча закрывать нечего.
    await page.mouse.click(VOID_POINT.x, VOID_POINT.y, { button: 'middle' });

    const after = await readMenu(page);
    expect(after.openCount, 'меню осталось открытым').toBe(1);
  });

  test('средняя кнопка мыши по меню гасится', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    expect((await readMenu(page)).openCount, 'меню открыто').toBe(1);
    // Наведение по-настоящему, а не заданное в разметке: гасится всё дерево, и
    // кейс обязан бить по пункту, а не по пустой рамке уровня.
    await hoverItem(page, 'Новый');
    await watchDownEvents(page);
    // `id` корня снимается до нажатий: после них в журнале уже не отличить корень
    // от подменю, а проверять надо именно там, где пришло нажатие.
    const rootId = (await readMenu(page)).levels[0].id;

    await page.mouse.down({ button: 'middle' });
    await page.mouse.up({ button: 'middle' });

    const rootRecords = await readDownEvents(page);
    const rootPress = downsIn(rootRecords, 'pointerdown', MIDDLE_BUTTON, rootId);
    // Проба обязана увидеть событие: на пустом списке проверка `prevented` была бы
    // пустой, и кейс прошёл бы на пробе, которая ничего не записала.
    expect(rootPress, 'средняя кнопка по корню дошла до пробы').toHaveLength(1);
    expect(rootPress[0].prevented, 'средняя кнопка по корню погашена').toBe(true);
    // Совместимый `mousedown` не досылается вовсе, а не приходит погашенным:
    // замерено на chromium, firefox и webkit, движок ведёт себя одинаково. Проверка
    // на отсутствии, а не на `defaultPrevented`, потому что отменять нечего —
    // события нет. Контроль ниже доказывает, что проба `mousedown` вообще жива,
    // иначе пустой список ничего бы не значил.
    expect(
      downsIn(rootRecords, 'mousedown', MIDDLE_BUTTON, rootId),
      'совместимый mousedown по средней кнопке не досылается',
    ).toEqual([]);

    const after = await readMenu(page);
    expect(after.openCount, 'меню осталось открытым').toBe(1);
    expect(after.log, 'действие пункта не вызвано').toEqual([]);
    expect(after.errors, 'страница без ошибок').toEqual([]);

    // Подменю открыто наведением на владельца с доводом часов до задержки показа:
    // путь нажатия гасится одинаково в любом уровне, и кейс не должен зависеть от
    // того, каким способом уровень открыт.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const submenuId = /** @type {string} */ (await submenuIdOf(page, 'Экспорт'));
    expect(isOpen(await readMenu(page), submenuId), 'подменю «Экспорт» показано').toBe(true);

    await hoverItem(page, 'PDF');
    await page.mouse.down({ button: 'middle' });
    await page.mouse.up({ button: 'middle' });

    // Отдельное нажатие по подменю, а не проверка «всех уровней сразу»: подписка
    // только на корень гасила бы ровно то, что уже проверено выше, и кейс на
    // ней остался бы зелёным.
    const submenuRecords = await readDownEvents(page);
    const submenuPress = downsIn(submenuRecords, 'pointerdown', MIDDLE_BUTTON, submenuId);
    expect(submenuPress, 'средняя кнопка по подменю дошла до пробы').toHaveLength(1);
    expect(submenuPress[0].prevented, 'средняя кнопка по подменю погашена').toBe(true);
    expect(
      downsIn(submenuRecords, 'mousedown', MIDDLE_BUTTON, submenuId),
      'совместимый mousedown по средней кнопке в подменю не досылается',
    ).toEqual([]);

    const withSubmenu = await readMenu(page);
    expect(withSubmenu.openCount, 'подменю осталось открытым').toBe(2);
    expect(withSubmenu.log, 'действие пункта подменю не вызвано').toEqual([]);
    expect(withSubmenu.errors, 'страница без ошибок').toEqual([]);

    // Контроль на соседние кнопки: гасится ровно средняя. Без него кейс прошёл бы и
    // на `preventDefault` безусловном, который заблокировал бы всё дерево, и на
    // «гасим всё, кроме основной», который заблокировал бы правый клик.
    await page.mouse.down();
    await page.mouse.up();
    const controls = await readDownEvents(page);
    const primary = downsIn(controls, 'pointerdown', PRIMARY_BUTTON, submenuId);
    expect(primary, 'основная кнопка по подменю дошла до пробы').toHaveLength(1);
    expect(primary[0].prevented, 'основная кнопка не погашена').toBe(false);
    // Основная кнопка не гасится, и потому совместимое событие приходит обычным
    // порядком. Эта запись доказывает, что проба `mousedown` слушает и пишет: без
    // неё пустой журнал по средней кнопке был бы свойством мёртвого слушателя, а
    // не движка. `cancelable` здесь `true`, то есть `preventDefault()` на таком
    // событии сработало бы, и `false` означает именно «не гасили».
    const primaryCompat = downsIn(controls, 'mousedown', PRIMARY_BUTTON, submenuId);
    expect(primaryCompat, 'совместимый mousedown основной кнопки дошёл').toHaveLength(1);
    expect(primaryCompat[0].cancelable, 'совместимый mousedown снимаем').toBe(true);
    expect(primaryCompat[0].prevented, 'совместимый mousedown не погашен').toBe(false);

    // Правая кнопка — синтетическим `pointerdown`, а не настоящим нажатием: правое
    // нажатие подтверждается `contextmenu`, который зовёт `open()` и переоткрывает
    // меню, то есть кейс мерил бы не блокировку, а порядок событий. Заодно поэтому
    // контроль идёт после основной кнопки: та кликает по пункту и закрывает меню.
    // `cancelable` обязателен: у `PointerEvent` он по умолчанию `false`, и при нём
    // `preventDefault()` не делает ничего, то есть проба записала бы `false` и на
    // заблокированной правой кнопке. Остальные поля не читаются: `buttons` не
    // смотрит никто, а `composed` отвечает за пересечение тени, которой на
    // странице нет, — проба и гасящий обработчик живут на обычном дереве. Номер
    // кнопки приходит аргументом, а не константой модуля: тело `page.evaluate`
    // уезжает в браузер, где константы спецификации не существует.
    await page.evaluate((wanted) => {
      const item = document.querySelector('.vc-item');
      if (!(item instanceof HTMLElement)) {
        throw new Error('пункт меню не найден');
      }
      item.dispatchEvent(
        new PointerEvent('pointerdown', {
          button: wanted,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, RIGHT_BUTTON);
    const right = downsIn(await readDownEvents(page), 'pointerdown', RIGHT_BUTTON, rootId);
    expect(right, 'событие правой кнопки дошло до пробы').toHaveLength(1);
    expect(right[0].prevented, 'правая кнопка не погашена').toBe(false);
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
  test('правый клик по контейнеру закрывает меню и открывает заново в новой точке', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SURFACE_POINT);
    const before = await readMenu(page);
    const rootBefore = /** @type {LevelView} */ (before.levels.find((entry) => entry.popoverOpen));

    // Другая точка того же контейнера, достаточно далеко от первой, чтобы
    // перенос был виден по координатам уровня.
    await page.mouse.click(300, 220, { button: 'right' });

    const after = await readMenu(page);
    expect(after.openCount, 'меню осталось открытым, а не снеслось и не задвоилось').toBe(1);
    // Правый клик по открытому меню проходит полный цикл: уровень гаснет и
    // показывается в новой точке. Раньше это считалось дефектом («мигание и лишний
    // цикл»), а теперь это заявленное поведение, и число скрытий его отличает от
    // простого переноса — состояние у них одинаковое.
    expect(after.hideCount, 'меню скрылось ровно один раз').toBe(before.hideCount + 1);
    const rootAfter = /** @type {LevelView} */ (after.levels.find((entry) => entry.id === rootBefore.id));
    // Перенос виден по рамке: после полного цикла меню показано в новой точке.
    // Прежняя точка и новая отличаются на 150 px по каждой оси.
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

    // Событие `scroll` не всплывает, и доставляется уже после возврата из
    // `evaluate`. Поэтому ожидание не «стало `scrollTop` больше», а «событие
    // доставлено»: слушатель на самом списке стоит в фазе цели, а наш глобальный
    // обработчик — в capture на `window`, то есть к этому моменту отработал уже.
    // Ожидание состояния здесь было бы ожиданием, что меню не закрылось, и
    // прошло бы на мутации, которая закрывает его по любому скроллу.
    const delivered = await page.evaluate(() => {
      return new Promise((resolve) => {
        const list = document.querySelector('.vc-list');
        if (!(list instanceof HTMLElement)) {
          resolve('нет списка');
          return;
        }
        list.addEventListener('scroll', () => resolve('доставлено'), { once: true });
        list.scrollTop = 120;
        // Страховка на случай, когда прокрутка невозможна и событие не придёт
        // вовсе: без неё `evaluate` висел бы до истечения таймаута пробы.
        setTimeout(() => resolve('не пришло'), 1000);
      });
    });
    expect(delivered, 'событие внутреннего скролла доставлено').toBe('доставлено');

    const after = await readMenu(page);
    expect(after.openCount, 'внутренний скролл не закрыл меню').toBe(1);
  });

  test('скролл прокручиваемой обёртки страницы закрывает меню', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await openAt(page, 'first', SHELL_POINT);
    expect((await readMenu(page)).openCount, 'меню открыто').toBe(1);

    // Прокручиваемость обёртки проверяется здесь же и тем же ходом, что сама
    // прокрутка: `scrollTop` на непрокручиваемом узле — тихий no-op, и кейс прошёл
    // бы, ни разу не доставив события. Это предусловие, а не украшение.
    const scrolled = await page.evaluate(() => {
      const shell = document.getElementById('shell');
      if (!(shell instanceof HTMLElement)) {
        return null;
      }
      const scrollable = shell.scrollHeight > shell.clientHeight;
      shell.scrollTop = 120;
      return { scrollable, scrollTop: shell.scrollTop };
    });
    expect(scrolled, 'обёртка на странице есть').not.toBeNull();
    const moved = /** @type {{ scrollable: boolean, scrollTop: number }} */ (scrolled);
    expect(moved.scrollable, 'обёртка прокручивается').toBe(true);
    expect(moved.scrollTop, 'обёртка прокрутилась').toBeGreaterThan(0);

    // Ожидание состояния, а не снимка сразу после `evaluate`: `scroll`
    // доставляется браузером уже после возврата, и чтение на этом шаге читало бы
    // состояние до обработчика. Утверждается «меню закрылось», а не «меню уже
    // закрылось к моменту возврата» — так же, как в кейсе про скролл страницы.
    await page.waitForFunction(() => {
      const levels = Array.from(document.querySelectorAll('.vc-menu'));
      return levels.length > 0 && levels.every((level) => !level.matches(':popover-open'));
    });

    const after = await readMenu(page);
    expect(after.openCount, 'скролл обёртки закрыл меню').toBe(0);
    expect(after.errors, 'страница без ошибок').toEqual([]);
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

  test('клик по контейнеру одного экземпляра закрывает и его меню, и чужое', async ({
    page,
  }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await makeMenu(page, 'second', 'chain', 'far');
    await openAt(page, 'first', SURFACE_POINT);
    await openAt(page, 'second', FAR_POINT);
    const opened = await readMenu(page);
    expect(opened.openCount, 'открыты оба меню').toBe(2);
    const firstId = /** @type {string} */ (opened.levels.filter((l) => l.popoverOpen)[0].id);
    const secondId = /** @type {string} */ (opened.levels.filter((l) => l.popoverOpen)[1].id);

    // Левый клик по контейнеру первого экземпляра. Раньше контейнер исключался из
    // зоны закрытия, и меню, чей контейнер кликнули, уцелело; теперь левый клик
    // идёт мимо `#onGlobalContextMenu` и закрывает оба. Свой опоре импотентности
    // больше нет, и проверка остаётся за тем, чего она всегда проверяла: клик по
    // контейнеру одного экземпляра не оставляет в живых меню чужого.
    await page.mouse.click(40, 80);

    const after = await readMenu(page);
    expect(after.openCount, 'не осталось ни одного меню').toBe(0);
    // Выжившие поимённо больше невозможны, поэтому названы оба: один только счётчик
    // прошёл бы на реализации, которая закрыла не те экземпляры.
    expect(isOpen(after, firstId), 'меню, чей контейнер кликнули, закрылось').toBe(false);
    expect(isOpen(after, secondId), 'меню чужого экземпляра закрылось').toBe(false);
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

  test('detach снимает все глобальные слушатели', async ({ page }) => {
    await makeMenu(page, 'first', 'chain', 'surface');
    await detachMenu(page, 'first');

    const after = await readMenu(page);
    // Тот же список, что и у `destroy`, и тем же способом: шесть снятий поимённо,
    // потому что `detach` зовёт тот же `#unbindGlobalHandlers`. Формулировка «снимает
    // все» прошла бы на забытом обработчике.
    for (const type of ['pointermove', 'pointerdown', 'contextmenu', 'keydown', 'scroll', 'resize']) {
      const node = type === 'scroll' || type === 'resize' ? 'window' : 'document';
      expect(after.removed, `слушатель ${type} снят`).toContain(`${type}@${node}`);
    }
    // С контейнера снят и `contextmenu` — иначе правый клик продолжал бы открывать
    // меню у экземпляра, который автор отвязал.
    expect(after.removed, 'contextmenu снят с контейнера').toContain('contextmenu@элемент');

    // Журнал снятий — это запись вызовов, а не поведение. Меню после `detach`
    // остаётся пригодным для `open()`, и скролл страницы его больше не сносит:
    // снимать слушатели и не слышать страницу — разные утверждения.
    await openAt(page, 'first', SURFACE_POINT);
    expect((await readMenu(page)).openCount, 'экземпляр после detach открывается').toBe(1);
    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });
    await page.waitForFunction(() => window.scrollY > 0);
    const scrolled = await readMenu(page);
    expect(scrolled.openCount, 'скролл страницы после detach меню не закрывает').toBe(1);
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
