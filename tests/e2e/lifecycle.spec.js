import { expect, test } from '@playwright/test';
import { CURSOR_OFFSET, SAFETY_PADDING } from '../../src/constants.js';

/**
 * Кейсы жизненного цикла `MyContext` против настоящей страницы: клики и клавиши
 * приходят из Playwright, модуль грузится динамическим импортом прямо в браузере.
 *
 * Проба ставится в `beforeEach` на глобальный объект страницы и достаётся
 * приведением прямо внутри каждого `page.evaluate`: коллбэк сериализуется и
 * выполняется в браузере, где функций файла теста нет, — по той же причине, по
 * которой наборы пунктов объявлены внутри пробы, а не приходят аргументом.
 * Спецификатор импорта записан относительным по третьей причине: в браузере он
 * схлопывается до `/src/index.js` — корень сервера, — а TypeScript разрешает его
 * от файла теста, и типы берутся из исходника без приведений.
 */

/**
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 */

/**
 * @typedef {object} ItemView
 * @property {string} label подпись пункта; `''` у разделителя.
 * @property {string} role
 * @property {string} tabindex атрибут как есть: `'-1'`, `'0'` или `''`.
 * @property {boolean} active несёт `data-active`.
 * @property {boolean} focused стоит ли фокус на узле.
 * @property {boolean} disabled
 * @property {string | null} haspopup `aria-haspopup`.
 * @property {string | null} expanded `aria-expanded`.
 * @property {string | null} owns `aria-owns` — зарезервированный адрес подменю.
 * @property {boolean} ownsTarget существует ли в документе элемент с этим `id`.
 *   Разведены с `owns` намеренно: владелец, чей уровень так и не заведён, —
 *   это ровно тот случай, который иначе не отличить от работающего владельца.
 * @property {string | null} chevron `data-chevron`.
 */

/**
 * @typedef {object} LevelView
 * @property {string} id
 * @property {boolean} popoverOpen `:popover-open` — уровень в Top Layer.
 * @property {boolean} marked метка `data-probe`, оставленная пробой на узле.
 *   Переживает переоткрытие, если уровень переиспользован, и не переживает
 *   пересоздания — единственный способ отличить одно от другого снаружи.
 * @property {MenuRect} rect рамка уровня во вьюпорте.
 * @property {ItemView[]} items
 */

/**
 * @typedef {object} MenuRect
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} Snapshot
 * @property {LevelView[]} levels уровни в порядке документа.
 * @property {number} openCount сколько из них в Top Layer.
 * @property {string | null} focusOwnerId `id` элемента с фокусом либо имя тега.
 * @property {string | null} focusLabel подпись пункта с фокусом.
 * @property {boolean} focusInMenu стоит ли фокус в дереве уровней меню. Не то же
 *   самое, что фокус на пункте: у открытого меню он стоит на элементе уровня.
 * @property {string[]} log метки сработавших действий, по порядку.
 * @property {string[]} errors сообщения необработанных ошибок страницы.
 * @property {ProbeContextMenu[]} contextmenu события `contextmenu`, дойденные до
 *   документа: видно, куда пришёл клик и подавила ли его привязка.
 * @property {ProbeRemoved[]} removed снятия слушателей: после `destroy()` живой
 *   обработчик `contextmenu` неотличим от снятого по поведению, он молчит на флаге
 *   уничтожения.
 * @property {number} actionsSize размер карты действий экземпляра; `-1`, если
 *   проба её не увидела.
 */

/**
 * @typedef {object} ProbeContextMenu
 * @property {string | null} container `id` контейнера под целью.
 * @property {boolean} prevented `defaultPrevented` к моменту всплытия на
 *   документ.
 */

/**
 * @typedef {object} ProbeRemoved
 * @property {string} type имя снятого события.
 * @property {string} target `id` узла, с которого слушатель снят.
 */

/**
 * @typedef {object} McProbe
 * @property {(set: string, containerId: string | null) => void} make
 * @property {(containerId: string) => void} attach
 * @property {() => void} detach
 * @property {(x: number, y: number) => void} open
 * @property {() => void} close
 * @property {() => void} destroy
 * @property {() => void} markRoot
 * @property {() => Snapshot} read
 * @property {() => number} actionsSize
 */

const STYLESHEET_PATH = '/styles/mycontext.css';

const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <!-- Фон страницы задан явно: по умолчанию он прозрачен, и композит поверх
       прозрачного чёрного занижал бы измерения полупрозрачной подложки. -->
  <body style="background: rgb(255, 255, 255)">
    <!-- Оба контейнера получают tabindex="-1": возвращать фокус на div без
         него нельзя, и проверка возврата проходила бы на нерабочей двери. -->
    <div id="workspace" data-container="workspace" tabindex="-1"
         style="position: fixed; left: 0; top: 0; width: 600px; height: 400px; background: rgb(238, 238, 238)"></div>
    <div id="second" data-container="second" tabindex="-1"
         style="position: fixed; left: 0; top: 420px; width: 600px; height: 100px; background: rgb(221, 221, 221)"></div>
    <div id="outside" tabindex="-1"
         style="position: fixed; left: 0; top: 540px; width: 600px; height: 60px; background: rgb(204, 204, 204)"></div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };

// Точки правого клика: обе внутри своего контейнера, обе далеко от его краёв и
// от соседа, поэтому промах по контейнеру исключён.
const WORKSPACE_POINT = { x: 300, y: 200 };
const SECOND_POINT = { x: 300, y: 470 };

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} set имя набора пунктов пробы.
 * @param {string | null} containerId контейнер привязки; `null` — без привязки.
 * @returns {Promise<Snapshot>}
 */
function makeMenu(page, set, containerId) {
  return page.evaluate((input) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(input.set, input.container);
    return scope.__mc.read();
  }, { set, container: containerId });
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
 * @param {string} containerId
 * @returns {Promise<Snapshot>}
 */
function attachMenu(page, containerId) {
  return page.evaluate((id) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.attach(id);
    return scope.__mc.read();
  }, containerId);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Snapshot>}
 */
function detachMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.detach();
    return scope.__mc.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} x
 * @param {number} y
 * @returns {Promise<Snapshot>}
 */
function openMenu(page, x, y) {
  return page.evaluate((point) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.open(point.x, point.y);
    return scope.__mc.read();
  }, { x, y });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Snapshot>}
 */
function closeMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.close();
    return scope.__mc.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Snapshot>}
 */
function destroyMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.destroy();
    return scope.__mc.read();
  });
}

/**
 * Оставляет метку на корневом уровне: переживает переоткрытие при переиспользовании
 * DOM и не переживает пересоздания.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function markRoot(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.markRoot();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function rightClick(page, point) {
  return page.mouse.click(point.x, point.y, { button: 'right' });
}

/**
 * Правый клик и снимок после него: короткая запись для кейсов, где важно только
 * «меню открылось».
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} [point]
 * @returns {Promise<Snapshot>}
 */
function rightClickAndRead(page, point = WORKSPACE_POINT) {
  return page.mouse.click(point.x, point.y, { button: 'right' }).then(() => {
    return readMenu(page);
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {import('@playwright/test').Locator}
 */
function itemByLabel(page, label) {
  return page.locator('.vc-item').filter({ hasText: label });
}

/**
 * Подписи активных пунктов по показанным уровням: пара «уровень, подпись» нужна,
 * чтобы утверждение о том, что активен не тот пункт, не проходило на пустом уровне.
 *
 * Закрытые уровни пропускаются намеренно: закрытие подменю клавишей `Escape`
 * оставляет на его пункте `data-active` — движок переносит активность на
 * пункт-владелец, но не снимает отметку с ребёнка, — и такая отметка в скрытом
 * уровне ничего не значит для пользователя.
 *
 * @param {Snapshot} snapshot
 * @returns {Array<string>}
 */
function activeLabels(snapshot) {
  /** @type {Array<string>} */
  const labels = [];
  for (const level of snapshot.levels) {
    if (!level.popoverOpen) {
      continue;
    }
    for (const item of level.items) {
      if (item.active) {
        labels.push(`${level.id}:${item.label}`);
      }
    }
  }
  return labels;
}

/**
 * Открытые уровни: `id` тех, кто в Top Layer.
 *
 * @param {Snapshot} snapshot
 * @returns {Array<string>}
 */
function openIds(snapshot) {
  return snapshot.levels.filter((level) => {
    return level.popoverOpen;
  }).map((level) => {
    return level.id;
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  // `goto` обязателен перед `setContent`: без него у документа нет адреса, и ни
  // ссылка на таблицу стилей, ни динамический импорт не разрешились бы.
  await page.goto('/');
  await page.setContent(PAGE_HTML);
  // Живая таблица стилей ещё могла не примениться, и замер меню вернул бы нули:
  // кейсы про точку клика проверяли бы тогда не позиционирование, а отсутствие
  // стилей.
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
  // сразу: состояние меню после действия не зависит ни от таймера, ни от анимации.
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { MyContext } = await import('../../src/index.js');

    /**
     * Шпион на карте действий. Карта принадлежит приватному полю экземпляра и
     * наружу не отдаётся, а обязание «`destroy()` очищает её целиком» иначе нечем
     * подтвердить: наружу смотрит только пустая разметка. Подмена одного метода
     * `Map` — приём того же рода, что и обёртки `showPopover` в
     * `tests/e2e/layer.spec.js`: платформенный метод, через который проходит всё
     * состояние, и наблюдение за ним не меняет поведения.
     *
     * Ключ карты действий — `menuId` уровня и позиция пункта в нём, и по нему
     * карта узнаётся среди всех прочих: строковые ключи такого вида есть только у
     * неё. Регулярное выражение объявлено здесь, а не взято из модуля файла:
     * коллбэк `page.evaluate` сериализуется и в браузере видит только своё.
     *
     * @type {Map<string, unknown>[]}
     */
    const actionMaps = [];
    const nativeSet = Map.prototype.set;
    const actionsKey = /^vc-[\d-]*(?:sub-[\d-]+)?:\d+$/;

    /**
     * Шпион на снятии слушателя. Поведение после `destroy()` доказать нечем: живой
     * обработчик `contextmenu` после `destroy()` всё равно ничего не делает — он
     * первым делом смотрит на флаг уничтожения, — и «меню не открылось» прошло бы
     * и при слушателе на месте. Разница видна только на самом снятии, поэтому
     * наблюдение ведётся за ним.
     *
     * @type {ProbeRemoved[]}
     */
    const removed = [];
    const nativeRemove = EventTarget.prototype.removeEventListener;

    /**
     * @this {EventTarget}
     * @param {string} type
     * @param {EventListenerOrEventListenerObject | null} listener
     * @param {boolean | AddEventListenerOptions | undefined} options
     * @returns {void}
     */
    function removeSpy(type, listener, options) {
      removed.push({
        type,
        target: this instanceof HTMLElement ? this.id : 'без id',
      });
      nativeRemove.call(this, type, listener, options);
    }

    EventTarget.prototype.removeEventListener = /** @type {typeof EventTarget.prototype.removeEventListener} */ (
      /** @type {unknown} */ (removeSpy)
    );

    /**
     * @this {Map<string, unknown>}
     * @param {unknown} key
     * @param {unknown} value
     * @returns {Map<string, unknown>}
     */
    function setSpy(key, value) {
      if (typeof key === 'string' && actionsKey.test(key)) {
        actionMaps.push(this);
      }
      return nativeSet.call(this, key, value);
    }

    Map.prototype.set = /** @type {typeof Map.prototype.set} */ (
      /** @type {unknown} */ (setSpy)
    );

    /** @type {string[]} метки сработавших действий. */
    const log = [];
    /** @type {string[]} сообщения необработанных ошибок страницы. */
    const errors = [];
    /** @type {ProbeContextMenu[]} */
    const contextmenu = [];
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });
    // Слушатель на документе, а не на контейнере: у документа событие окажется
    // после контейнерного, поэтому `defaultPrevented` к этому моменту уже
    // выставлен привязкой. Слушатель на самом контейнере видел бы событие раньше
    // него и всегда считал бы его неподвленным.
    document.addEventListener('contextmenu', (event) => {
      const target = event.target;
      const container = target instanceof Element ? target.closest('[data-container]') : null;
      contextmenu.push({
        container: container === null ? null : container.getAttribute('data-container'),
        prevented: event.defaultPrevented,
      });
    });

    /**
     * Наборы пунктов объявлены здесь, а не приходят аргументом: у пунктов есть
     * `action`-функции, а `page.evaluate` сериализует аргументы как JSON и функции
     * бы выбросил. Поэтому кейс зовёт `make('имя')`.
     */
    /** @type {Record<string, Array<MenuItem | SeparatorItem>>} */
    const sets = {
      // Разделитель между пунктами: у уровня без него `ArrowDown` и `ArrowUp` дали
      // бы одинаковый снимок, и «пропускает ли цикл отключённые» было бы нечем
      // отличать.
      flat: [{ label: 'Первый' }, { type: 'separator' }, { label: 'Второй' }, { label: 'Третий' }],
      nested: [{ label: 'Ветка', submenu: [{ label: 'Лист' }] }],
      // Четыре пункта из Review Focus 2: без `id`, два с одинаковым и один с
      // третьим. Каждый пишет в общий журнал свою метку, и порядок журнала —
      // единственное, что отличает «свой `action`» от «чужого `action` по `id`».
      ids: [
        { label: 'Без id', action: () => log.push('без id') },
        { id: 'x', label: 'Первый x', action: () => log.push('первый x') },
        { id: 'x', label: 'Второй x', action: () => log.push('второй x') },
        { id: 'y', label: 'Y', action: () => log.push('y') },
      ],
      // Отключённый владелец стоит первым: будь он доступен, фокус встал бы на
      // него, и весь кейс проходил бы на пустом механизме. Владелец с пустым
      // подменю — контроль на «владелец ли он по разметке».
      disabled: [
        {
          label: 'Глухой',
          disabled: true,
          submenu: [{ label: 'Под глухим' }],
          action: () => log.push('глухой'),
        },
        { label: 'Пустой', submenu: [], action: () => log.push('пустой') },
        { label: 'Живой', submenu: [{ label: 'Под живым' }], action: () => log.push('живой') },
      ],
      // Пункт-владелец с собственным действием и лист в одном уровне: клик по
      // владельцу открывает подменю и не зовёт его действие, клик по листу зовёт.
      // Оба пункта в одном уровне — иначе «клик по владельцу ничего не зовёт» можно
      // было бы объяснить тем, что обработчика активации нет вовсе.
      mixed: [
        {
          label: 'Владелец',
          submenu: [{ label: 'Под владельцем' }],
          action: () => log.push('владелец'),
        },
        { label: 'Лист', action: () => log.push('лист') },
      ],
      // Первый пункт тихий, второй ломается: нажатие на обоих подряд отделяет
      // «исключение пробрасывается» от «меню закрывается».
      throwing: [
        { label: 'Тихий', action: () => log.push('тихий') },
        {
          label: 'Ломает',
          action: () => {
            throw new Error('действие сломано');
          },
        },
      ],
    };

    /** @type {InstanceType<typeof MyContext> | null} */
    let menu = null;

    /**
     * @param {string} setName
     * @returns {Array<MenuItem | SeparatorItem>}
     */
    function itemsOf(setName) {
      const items = sets[setName];
      if (items === undefined) {
        throw new Error(`в пробе нет набора ${setName}`);
      }
      return items;
    }

    /**
     * @param {string | null} id
     * @returns {HTMLElement | null}
     */
    function containerOf(id) {
      if (id === null) {
        return null;
      }
      const element = document.getElementById(id);
      return element instanceof HTMLElement ? element : null;
    }

    /**
     * @param {Element} item узел пункта или разделителя.
     * @returns {ItemView}
     */
    function readItem(item) {
      const label = item.querySelector('.vc-label');
      const owns = item.getAttribute('aria-owns');
      return {
        label: label === null ? '' : String(label.textContent),
        role: item.getAttribute('role') ?? '',
        tabindex: item.getAttribute('tabindex') ?? '',
        active: item.hasAttribute('data-active'),
        focused: item === document.activeElement,
        disabled: item.getAttribute('aria-disabled') === 'true',
        haspopup: item.getAttribute('aria-haspopup'),
        expanded: item.getAttribute('aria-expanded'),
        owns,
        ownsTarget: owns !== null && document.getElementById(owns) !== null,
        chevron: item.getAttribute('data-chevron'),
      };
    }

    /**
     * @returns {Snapshot}
     */
    function read() {
      const levels = Array.from(document.querySelectorAll('.vc-menu')).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.id,
          popoverOpen: element.matches(':popover-open'),
          marked: element.hasAttribute('data-probe'),
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          items: Array.from(element.querySelectorAll('.vc-item, .vc-separator')).map((node) => {
            return readItem(node);
          }),
        };
      });
      const active = document.activeElement;
      const focused = active instanceof Element ? active.closest('.vc-item') : null;
      const focusedLabel = focused === null ? null : focused.querySelector('.vc-label');
      // Внутри меню — значит в дереве уровней, а не «на пункте»: фокус открытого
      // меню стоит на самом элементе уровня, и уровень без единого доступного пункта
      // держит фокус так же.
      return {
        levels,
        openCount: levels.filter((level) => {
          return level.popoverOpen;
        }).length,
        focusOwnerId: active === null
          ? null
          : active.id === '' ? String(active.tagName).toLowerCase() : active.id,
        focusLabel: focusedLabel === null ? null : String(focusedLabel.textContent),
        focusInMenu: active instanceof Element && active.closest('.vc-menu') !== null,
        log: log.slice(),
        errors: errors.slice(),
        contextmenu: contextmenu.slice(),
        removed: removed.slice(),
        actionsSize: actionMaps.length === 0 ? -1 : actionMaps[actionMaps.length - 1].size,
      };
    }

    const probe = /** @type {McProbe} */ ({
      make(setName, containerId) {
        if (menu !== null) {
          menu.destroy();
        }
        log.length = 0;
        errors.length = 0;
        contextmenu.length = 0;
        removed.length = 0;
        menu = new MyContext(itemsOf(setName), { label: 'Меню файла' });
        const container = containerOf(containerId);
        if (container !== null) {
          menu.attach(container);
        }
      },
      attach(containerId) {
        const container = containerOf(containerId);
        if (container === null || menu === null) {
          throw new Error(`нет контейнера ${containerId}`);
        }
        menu.attach(container);
      },
      detach() {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.detach();
      },
      open(x, y) {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.open({ x, y });
      },
      close() {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.close();
      },
      destroy() {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.destroy();
      },
      markRoot() {
        const root = document.querySelector('.vc-menu');
        if (root === null) {
          throw new Error('меню не показано');
        }
        root.setAttribute('data-probe', '');
      },
      read,
      actionsSize() {
        if (actionMaps.length === 0) {
          throw new Error('карта действий не найдена');
        }
        return actionMaps[actionMaps.length - 1].size;
      },
    });

    const scope = /** @type {{ __mc?: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc = probe;
  });
});

test.describe('жизненный цикл MyContext', () => {
  test('attach: contextmenu на контейнере открывает меню в точке клика и предотвращает системное', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    const after = await readMenu(page);
    expect(after.openCount, 'меню открыто').toBe(1);
    expect(after.levels).toHaveLength(1);
    // Точка клика и координаты меню связаны через позиционер: зазор от курсора до
    // края меню — константа, а не округление.
    expect(after.levels[0].rect.left, 'левый край меню').toBeCloseTo(
      WORKSPACE_POINT.x + CURSOR_OFFSET,
      2,
    );
    expect(after.levels[0].rect.top, 'верхний край меню').toBeCloseTo(
      WORKSPACE_POINT.y + CURSOR_OFFSET,
      2,
    );
    // Событие дошло до контейнера и было подавлено привязкой: системное меню не
    // показывается, а меню наше — открыто.
    expect(after.contextmenu).toEqual([{ container: 'workspace', prevented: true }]);
  });

  test('attach: пункт с disabled и подменю не открывает подменю мышью', async ({ page }) => {
    await makeMenu(page, 'disabled', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    await itemByLabel(page, 'Глухой').hover();
    // Показ по наведению есть с Task 10, но отключённый владелец им не открывается:
    // подписки на показ у него нет вовсе, потому что рендерер владельцем его не
    // считает. Видно и то, что уровень под ним не заведён: единственный след
    // заведённого, но не показанного уровня — ключ, который рендерер оставил в карте
    // действий, и набор ключей после показа от этого не растёт.
    const afterHover = await readMenu(page);
    expect(afterHover.openCount, 'открыт только корень').toBe(1);
    expect(afterHover.actionsSize, 'уровень подменю отключённого не заведён').toBe(4);
    // `aria-owns` у отключённого владельца нет вовсе, а не «есть, но узла за ним
    // нет»: висячая ссылка ушла вместе с признаком подменю.
    expect(afterHover.levels[0].items[0].owns, 'адрес подменю не зарезервирован').toBeNull();
    expect(afterHover.levels[0].items[0].ownsTarget, 'уровня под `aria-owns` нет и вовсе')
      .toBe(false);

    // `force` обязателен: проверка пригодности Playwright считает элемент с
    // `aria-disabled` непригодным и отказывается на него кликать, а настоящий
    // пользователь кликает по `div` без всяких проверок. Клик всё равно идёт
    // через настоящий ввод, а не через `dispatchEvent`.
    await itemByLabel(page, 'Глухой').click({ force: true });
    const afterClick = await readMenu(page);
    // Клик по отключённому пункту не выполняет его действие и не открывает подменю,
    // а меню остаётся открытым: закрывать было бы нечего.
    expect(afterClick.log, 'действие отключённого пункта не выполнено').toEqual([]);
    expect(afterClick.openCount, 'подменю не открыто').toBe(1);
    expect(afterClick.actionsSize, 'уровень так и не появился').toBe(4);

    // Клик по владельцу с непустым подменю открывает подменю, а его действие не
    // зовёт: пустой журнал здесь — не «обработчика нет», а правило владельца.
    await itemByLabel(page, 'Живой').click();
    const afterOwner = await readMenu(page);
    expect(afterOwner.log, 'действие владельца не вызвано').toEqual([]);
    expect(afterOwner.openCount, 'подменю владельца открыто').toBe(2);

    // Контроль живости: клик по пункту без подменю выполняет его действие и закрывает
    // меню. Раньше контролем был клик по владельцу, и он доказывал не то.
    //
    // Клавиши между шагами нет, и это не потеря шага, а его отсутствие по существу:
    // фокус после клика по владельцу стоит на владельце в корневом уровне, поэтому и
    // `Escape`, и `ArrowLeft` разбирались бы в корне и закрывали всё меню, а не
    // подменю. Клик после такого ушёл бы в закрытый уровень — он остаётся в разметке
    // и кликабелен, — и кейс прошёл бы, доказав обратное своему комментарию.
    expect((await readMenu(page)).openCount, 'меню живо, подменю открыто').toBe(2);

    await itemByLabel(page, 'Пустой').click();
    const afterLeaf = await readMenu(page);
    expect(afterLeaf.log).toEqual(['пустой']);
    expect(afterLeaf.openCount, 'меню закрылось после действия').toBe(0);
  });

  test('attach: пункт с disabled и подменю не открывает подменю по ArrowRight', async ({ page }) => {
    await makeMenu(page, 'disabled', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    // Показ меню выделения не оставляет: фокус стоит на элементе уровня, и отметок
    // нет ни на ком пункте. Раньше показ сразу отмечал первый доступный, и состояние
    // «ещё не тронуто» было недостижимо.
    const before = await readMenu(page);
    expect(before.focusLabel, 'выделения после показа нет').toBe(null);
    expect(activeLabels(before), 'отметок роуминга нет').toEqual([]);

    // Цикл роуминга пропускает отключённого владельца: первый шаг вниз встаёт на
    // второй пункт, а не на первый. Пока фокус не может встать на отключённого,
    // `ArrowRight` и не сможет открыть его подменю.
    await page.keyboard.press('ArrowDown');
    const atEmpty = await readMenu(page);
    expect(atEmpty.focusLabel, 'фокус прошёл мимо отключённого').toBe('Пустой');
    expect(activeLabels(atEmpty)).toEqual([`${atEmpty.levels[0].id}:Пустой`]);

    // Доступный владелец с непустым подменю — последний в наборе, и до него доходят
    // клавишей: `End` доводит активный пункт до последнего доступного.
    await page.keyboard.press('End');
    const atLive = await readMenu(page);
    expect(atLive.focusLabel, 'фокус на доступном владельце').toBe('Живой');

    await page.keyboard.press('ArrowRight');
    const afterRight = await readMenu(page);
    // Контроль: у доступного владельца подменю открывается, значит механизм
    // исправен и «не открылось» у отключённого — не пустое совпадение.
    expect(afterRight.openCount, 'подменю живого владельца открыто').toBe(2);
    // Фокус перенёс движок, а не показ: показ подменю фокус не трогает, и перенос
    // делает `moveTo` сразу после `openSubmenu`.
    expect(afterRight.focusLabel, 'фокус перешёл в подменю').toBe('Под живым');
    expect(afterRight.levels, 'заведены корень и одно подменю').toHaveLength(2);
    expect(openIds(afterRight), 'открыто подменю доступного владельца').toEqual([
      afterRight.levels[0].id,
      /** @type {string} */ (afterRight.levels[0].items[2].owns),
    ]);

    // Полный обход уровня: отключённый владелец не становится активным ни при
    // каком движении, а `ArrowRight` после обхода открывает то же подменю.
    await page.keyboard.press('Escape');
    /** @type {string[]} */
    const walked = [];
    for (const key of ['End', 'ArrowDown', 'Home', 'ArrowUp', 'End', 'Home']) {
      await page.keyboard.press(key);
      walked.push(...activeLabels(await readMenu(page)));
    }
    const levelId = before.levels[0].id;
    expect([...new Set(walked)].sort(), 'активными становились только доступные')
      .toEqual([`${levelId}:Живой`, `${levelId}:Пустой`].sort());
    expect((await readMenu(page)).openCount, 'обход не открыл подменю отключённого').toBe(1);
  });

  test('пункты без id и с повторяющимся id вызывают свой action', async ({ page }) => {
    await makeMenu(page, 'ids', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    // Меню закрывается после каждой активации, поэтому между нажатиями его надо
    // открыть заново — иначе второй клик ушёл бы в закрытое меню, и порядок
    // журнала ничего не значил бы.
    for (const [position, label] of ['Без id', 'Первый x', 'Второй x', 'Y'].entries()) {
      if (position > 0) {
        await rightClick(page, WORKSPACE_POINT);
      }
      const before = await readMenu(page);
      expect(before.openCount, `меню открыто перед нажатием «${label}»`).toBe(1);
      await itemByLabel(page, label).click();
    }

    const after = await readMenu(page);
    // Поиск действия по авторскому `id` схлопнул бы два пункта с `id: 'x'` в один,
    // и второй из них вызвал бы первое действие либо не вызвал ничего.
    expect(after.log).toEqual(['без id', 'первый x', 'второй x', 'y']);
    expect(after.openCount, 'меню закрыто после последнего нажатия').toBe(0);
  });

  test('action бросает исключение — меню всё равно закрывается', async ({ page }) => {
    await makeMenu(page, 'throwing', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    await itemByLabel(page, 'Ломает').click();

    const after = await readMenu(page);
    // Клик мышью — единственный путь, на котором закрывает сам обработчик: движок
    // клавиатуры после активации закрывает меню отдельным вызовом, и на этом пути
    // его нет. Закрытие в `finally` обязано быть, иначе сломанный обработчик
    // оставил бы меню висеть.
    expect(after.openCount, 'меню закрыто').toBe(0);
    expect(after.errors, 'исключение дошло до страницы').toHaveLength(1);
    expect(after.errors[0]).toContain('действие сломано');
  });

  test('action бросает исключение — исключение не проглатывается, а close() отрабатывает в finally', async ({ page }) => {
    await makeMenu(page, 'throwing', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    // Контроль живости клавиатурного пути: тихое действие выполняется, ошибок нет.
    // Открытое меню выделения не имеет, и `Enter` без активного пункта молчит, — до
    // «Тихий» доходится шагом вниз.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const afterQuiet = await readMenu(page);
    expect(afterQuiet.log, 'тихое действие выполнено').toEqual(['тихий']);
    expect(afterQuiet.errors, 'тихое действие не сообщило об ошибке').toEqual([]);

    await rightClick(page, WORKSPACE_POINT);
    // Два шага вниз, а не один: показ не отмечает пунктов, и до «Ломает» от свежего
    // открытия нужно дойти через «Тихий».
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    const afterThrow = await readMenu(page);
    // Исключение обработчика не глотается: его получает вызывающий, а не библиотека.
    // Тихий прогон выше — контроль: пустой список ошибок у настоящей ошибки означал
    // бы, что страна их просто не собирает.
    expect(afterThrow.errors, 'ошибка не проглочена').toHaveLength(1);
    expect(afterThrow.errors[0]).toContain('действие сломано');
    expect(afterThrow.openCount, 'меню закрыто').toBe(0);
    expect(afterThrow.log, 'упавшее действие в журнал не попало').toEqual(['тихий']);
  });

  test('open() без attach открывает меню в заданных координатах', async ({ page }) => {
    await makeMenu(page, 'flat', null);
    const after = await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);

    expect(after.openCount, 'меню открыто').toBe(1);
    expect(after.levels[0].rect.left).toBeCloseTo(WORKSPACE_POINT.x + CURSOR_OFFSET, 2);
    expect(after.levels[0].rect.top).toBeCloseTo(WORKSPACE_POINT.y + CURSOR_OFFSET, 2);
    // Меню обязано помещаться во вьюпорт с отступом, иначе оно уехало бы под край
    // вместе с частью своих пунктов.
    expect(after.levels[0].rect.left).toBeGreaterThanOrEqual(SAFETY_PADDING);
    expect(after.levels[0].rect.top).toBeGreaterThanOrEqual(SAFETY_PADDING);
    expect(after.levels[0].rect.left + after.levels[0].rect.width)
      .toBeLessThanOrEqual(VIEWPORT.width - SAFETY_PADDING);
    expect(after.levels[0].rect.top + after.levels[0].rect.height)
      .toBeLessThanOrEqual(VIEWPORT.height - SAFETY_PADDING);
    // Программное открытие не привязано ни к чему, но фокус всё равно уходит в меню:
    // иначе `ArrowDown` не работал бы на показанном меню. Стоит он на элементе
    // уровня, а не на пункте: выделения у только что открытого меню нет.
    expect(after.focusInMenu, 'фокус в меню').toBe(true);
    expect(after.focusLabel, 'выделения после открытия нет').toBe(null);
    await page.keyboard.press('ArrowDown');
    const withActive = await readMenu(page);
    expect(withActive.focusLabel, 'первая стрелка даёт первый пункт').toBe('Первый');
  });

  test('open() идемпотентен: повторный вызов не создаёт второе меню в DOM', async ({ page }) => {
    await makeMenu(page, 'flat', null);
    const first = await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);
    await markRoot(page);

    const second = await openMenu(page, 500, 400);

    expect(first.levels).toHaveLength(1);
    expect(second.levels, 'уровень один').toHaveLength(1);
    // Метка на узле пережила второй `open()`: уровень переиспользован, а не
    // пересоздан. Идентификатор уровня при пересоздании был бы тем же, и по нему
    // сравнить нельзя — сравнивается узел.
    expect(second.levels[0].id).toBe(first.levels[0].id);
    expect(second.levels[0].marked, 'тот же узел').toBe(true);
    expect(second.openCount, 'открыт один уровень').toBe(1);
    // Перепозиционирование состоялось: меню уехало в новую точку, а не осталось
    // там, где было.
    expect(second.levels[0].rect.left).toBeCloseTo(500 + CURSOR_OFFSET, 2);
    expect(second.levels[0].rect.top).toBeCloseTo(400 + CURSOR_OFFSET, 2);
  });

  test('close() скрывает меню и возвращает фокус на элемент-владелец', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    // Фокус после показа в меню, но не на пункте: выделения у свежего меню нет, и
    // стоит он на элементе уровня, пока не нажата первая клавиша навигации.
    const shown = await readMenu(page);
    expect(shown.focusInMenu, 'фокус в меню после показа').toBe(true);
    expect(shown.focusLabel, 'выделения после показа нет').toBe(null);
    await page.keyboard.press('ArrowDown');
    const atFirst = await readMenu(page);
    expect(atFirst.focusLabel, 'фокус на первом пункте').toBe('Первый');

    const after = await closeMenu(page);

    expect(after.openCount, 'меню скрыто').toBe(0);
    // Закрытие отложено на анимацию, поэтому оставленный в гаснущем уровне фокус
    // ушёл бы в никуда: возвращать его — часть закрытия, а не украшение.
    expect(after.focusOwnerId, 'фокус на контейнере').toBe('workspace');
    expect(after.focusInMenu, 'фокус вне меню').toBe(false);
  });

  test('close() без attach не бросает и просто скрывает', async ({ page }) => {
    await makeMenu(page, 'flat', null);
    await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);

    // Вызов возвращается снимком: бросок из `page.evaluate` уронил бы кейс сам.
    const after = await closeMenu(page);

    expect(after.openCount, 'меню скрыто').toBe(0);
    // Закрытие не разрушает: уровень остаётся в DOM и переиспользуется следующим
    // `open()`. `destroy()` убрал бы его — и проверка на «просто скрывает» стала бы
    // проверкой на разрушение.
    expect(after.levels, 'уровень остался в документе').toHaveLength(1);
    // Куда упал фокус без привязки — вопрос платформы, а не контракта: возвращать
    // некуда, и библиотека не имеет права ни уводить фокус куда-то, ни требовать
    // привязки для закрытия. Поэтому утверждается одно: `close()` вернулся, а
    // браузер оставил активным элемент, на котором фокус и был.
    const afterSecond = await closeMenu(page);
    expect(afterSecond.levels, 'повторное закрытие тоже не разрушает').toHaveLength(1);
    expect(afterSecond.openCount).toBe(0);
  });

  test('destroy() удаляет все элементы меню из DOM', async ({ page }) => {
    await makeMenu(page, 'nested', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    // Показ не отмечает пункты, и `ArrowRight` без активного пункта молчит: до
    // владельца «Ветка» доходится шагом вниз.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');

    // Два уровня: снос только корневого оставил бы подменю висеть, и кейс на
    // единственном уровне прошёл бы.
    const before = await readMenu(page);
    expect(before.levels).toHaveLength(2);
    expect(before.openCount, 'открыты оба уровня').toBe(2);

    const after = await destroyMenu(page);

    expect(after.levels, 'в документе не осталось уровней').toHaveLength(0);
    expect(after.openCount).toBe(0);
    expect(after.focusInMenu, 'фокус не остался в удалённом меню').toBe(false);
  });

  test('destroy() идемпотентен: повторный вызов не бросает', async ({ page }) => {
    await makeMenu(page, 'nested', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    const first = await destroyMenu(page);
    expect(first.levels).toHaveLength(0);

    // Второй вызов упал бы внутрь `page.evaluate` и уронил кейс: размонтирование
    // вызывает `destroy()` не один раз, и ошибка в нём была бы ошибкой вызывающего
    // кода.
    const second = await destroyMenu(page);
    expect(second.levels).toHaveLength(0);
  });

  test('клик по пункту-владельцу открывает подменю и не вызывает его action, а лист вызывает свой', async ({ page }) => {
    await makeMenu(page, 'mixed', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    await itemByLabel(page, 'Владелец').click();
    const afterOwner = await readMenu(page);
    // Открылось подменю, а не «ничего»: уровень владельца заведён на шаг вперёд
    // при показе корня, и клик по владельцу его показывает.
    expect(afterOwner.openCount, 'подменю открыто').toBe(2);
    expect(openIds(afterOwner), 'открыто подменю владельца').toEqual([
      afterOwner.levels[0].id,
      /** @type {string} */ (afterOwner.levels[0].items[0].owns),
    ]);
    // Правило владельца: его собственное действие не вызывается. Журнал пуст не
    // потому, что обработчика нет, — вторая половина кейса это доказывает.
    expect(afterOwner.log, 'action владельца не вызван').toEqual([]);
    // Фокус остался в родительском уровне, на самом владельце: показ подменю мышью
    // фокус не переносит (спека 6.2), и переносом занимается только движок.
    expect(afterOwner.focusLabel, 'фокус на владельце в родительском уровне').toBe('Владелец');
    expect(afterOwner.focusInMenu, 'фокус не покинул меню').toBe(true);

    // `Escape` между шагами больше не нужен и был бы неверным: фокус в корневом
    // уровне, и `Escape` закрыл бы всё меню, а не подменю.
    await itemByLabel(page, 'Лист').click();
    const afterLeaf = await readMenu(page);
    // Пункт без подменю активируется как прежде и закрывает меню.
    expect(afterLeaf.log, 'action листа вызван').toEqual(['лист']);
    expect(afterLeaf.openCount, 'меню закрыто').toBe(0);
  });

  test('attach() бросает Error с названием требования, если браузер не умеет Popover API', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');

    const result = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      const proto = /** @type {{ showPopover?: unknown }} */ (
        /** @type {unknown} */ (globalThis.HTMLElement.prototype)
      );
      const native = proto.showPopover;
      delete proto.showPopover;
      /** @type {string | null} */
      let message = null;
      try {
        scope.__mc.attach('workspace');
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      // Возврат настоящего метода в том же кадре и повторная привязка: без них кейс
      // прошёл бы и на «attach бросает всегда», и не доказывал бы, что дело в
      // проверке поддержки.
      if (native !== undefined) {
        proto.showPopover = native;
      }
      scope.__mc.attach('workspace');
      return message;
    });

    expect(result, 'attach бросил').not.toBeNull();
    expect(/** @type {string} */ (result)).toContain('showPopover');
    expect(/** @type {string} */ (result)).toContain('Popover API');

    // Возврат методов после кейса обязателен: следующие кейсы живут в той же
    // странице, и без восстановления `attach` падал бы у всех.
    const after = await rightClickAndRead(page);
    expect(after.openCount, 'меню открылось после восстановления').toBe(1);
  });

  test('attach, open, close и detach после destroy() бросают Error', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await destroyMenu(page);

    const messages = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      const probe = scope.__mc;
      /** @type {Array<string | null>} */
      const results = [];
      for (const call of [
        () => {
          probe.attach('workspace');
        },
        () => {
          probe.open(300, 200);
        },
        () => {
          probe.close();
        },
        () => {
          probe.detach();
        },
      ]) {
        try {
          call();
          results.push(null);
        } catch (error) {
          results.push(error instanceof Error ? error.message : String(error));
        }
      }
      return results;
    });

    // `destroy()` после `destroy()` не бросает — это отдельный кейс: размонтирование
    // обязано иметь право позвать его ещё раз.
    expect(messages).toEqual([
      'MyContext: экземпляр уничтожен',
      'MyContext: экземпляр уничтожен',
      'MyContext: экземпляр уничтожен',
      'MyContext: экземпляр уничтожен',
    ]);
  });

  test('destroy() снимает слушатель contextmenu с контейнера', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    const removed = (await destroyMenu(page)).removed;
    // Снятие с самого контейнера, а не с документа и не с меню: иначе привязка
    // пережила бы экземпляр и держала бы его замыканием. Сравнение по присутствию, а
    // не по точному составу массива: снимать слушатели будут и Tasks 10–11, и
    // требование «лишних снятий нет» к ним не относится.
    expect(removed).toContainEqual({ type: 'contextmenu', target: 'workspace' });

    await rightClick(page, WORKSPACE_POINT);

    const after = await readMenu(page);
    // Клик дошёл до контейнера — иначе «меню не открылось» ничего бы не значило, —
    // но никто его не подавил и ни одного уровня не появилось.
    expect(after.contextmenu).toEqual([{ container: 'workspace', prevented: false }]);
    expect(after.levels, 'меню не построено').toHaveLength(0);
    expect(after.openCount).toBe(0);
  });

  test('detach() снимает привязку: правый клик по контейнеру больше не открывает меню', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    const detached = await detachMenu(page);
    expect(detached.removed, 'слушатель снят с контейнера').toContainEqual({
      type: 'contextmenu',
      target: 'workspace',
    });

    await rightClick(page, WORKSPACE_POINT);

    const after = await readMenu(page);
    expect(after.contextmenu).toEqual([{ container: 'workspace', prevented: false }]);
    expect(after.levels, 'меню не построено').toHaveLength(0);
    expect(after.openCount).toBe(0);
  });

  test('detach() не уничтожает экземпляр: open() после detach() всё ещё работает', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await detachMenu(page);

    const after = await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);

    expect(after.openCount, 'меню открыто').toBe(1);
    // Фокус в меню, но на элементе уровня: выделения у только что открытого меню нет.
    expect(after.focusInMenu, 'фокус в меню').toBe(true);
    expect(after.focusLabel, 'выделения после открытия нет').toBe(null);
  });

  test('attach: повторный attach переносит привязку на новый контейнер', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await attachMenu(page, 'second');

    await rightClick(page, WORKSPACE_POINT);
    const afterFirst = await readMenu(page);
    // Старый контейнер молча освобождён: без этого у экземпляра было бы два
    // контейнера, и меню открывалось бы с двух сторон.
    expect(afterFirst.contextmenu).toEqual([{ container: 'workspace', prevented: false }]);
    expect(afterFirst.levels, 'старый контейнер меню не открывает').toHaveLength(0);

    await rightClick(page, SECOND_POINT);
    const afterSecond = await readMenu(page);
    expect(afterSecond.contextmenu).toHaveLength(2);
    expect(afterSecond.contextmenu[1]).toEqual({ container: 'second', prevented: true });
    expect(afterSecond.openCount, 'новый контейнер открывает').toBe(1);
  });

  test('destroy() очищает карту actions целиком', async ({ page }) => {
    const sizes = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      const probe = scope.__mc;
      probe.make('nested', 'workspace');
      probe.open(300, 200);
      // Два уровня — два ключа: карта принадлежит экземпляру целиком, а не уровню.
      const before = probe.actionsSize();
      probe.destroy();
      return { before, after: probe.actionsSize() };
    });

    // Точное число, а не «больше нуля»: так проверка убеждается и в том, что поймала
    // именно карту действий, а не какую-нибудь другую карту страницы.
    expect(sizes.before, 'ключ корня и ключ подменю').toBe(2);
    expect(sizes.after, 'карта пуста').toBe(0);
  });

  test('возврат фокуса идемпотентен: close() дважды подряд оставляет фокус на элементе привязки', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    // `Escape` на корневом уровне — двойной возврат: движок зовёт `closeAll()`, а тот
    // возвращает фокус сам, и следом движок зовёт `focusOwner()` ещё раз.
    await page.keyboard.press('Escape');
    const afterEscape = await readMenu(page);
    expect(afterEscape.openCount, 'меню закрыто').toBe(0);
    expect(afterEscape.focusOwnerId, 'фокус на контейнере').toBe('workspace');

    // Фокус уводят в сторону: если бы `close()` обнулял владельца при возврате,
    // второй вызов уже ничего бы не вернул — и это отличалось бы от поведения
    // живого экземпляра только в этом сценарии.
    await page.evaluate(() => {
      const outside = document.getElementById('outside');
      if (outside !== null) {
        outside.focus();
      }
    });
    const moved = await readMenu(page);
    expect(moved.focusOwnerId, 'фокус уведён в сторону').toBe('outside');

    const afterSecond = await closeMenu(page);
    expect(afterSecond.focusOwnerId, 'повторный close() вернул фокус').toBe('workspace');
  });

  test('повторный open() снова регистрирует уровень в движке клавиатуры', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    await closeMenu(page);

    await rightClick(page, WORKSPACE_POINT);
    const reopened = await readMenu(page);
    // `close()` сбросил реестр движка, и второй `open()` обязан отдать уровень
    // заново: без `registerLevel` меню было бы открытым, но мёртвым для клавиатуры.
    // Фокус после показа стоит на элементе уровня, а не на пункте: выделения у
    // только что открытого меню нет.
    expect(reopened.openCount, 'меню снова открыто').toBe(1);
    expect(reopened.focusInMenu, 'фокус снова в меню').toBe(true);
    expect(reopened.focusLabel, 'выделения после открытия нет').toBe(null);

    await page.keyboard.press('ArrowDown');
    const afterDown = await readMenu(page);
    expect(afterDown.focusLabel, 'стрелка даёт первый пункт').toBe('Первый');
    expect(activeLabels(afterDown)).toEqual([`${afterDown.levels[0].id}:Первый`]);
    await page.keyboard.press('ArrowDown');
    const afterSecond = await readMenu(page);
    expect(afterSecond.focusLabel, 'стрелка двигает активный пункт').toBe('Второй');
    expect(activeLabels(afterSecond)).toEqual([`${afterSecond.levels[0].id}:Второй`]);
  });

  test('attach: пункт с submenu: [] не владелец: ни шеврона, ни aria-owns, Enter активирует его', async ({ page }) => {
    await makeMenu(page, 'disabled', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    const before = await readMenu(page);
    const empty = before.levels[0].items[1];
    expect(empty.label).toBe('Пустой');
    expect(empty.owns, 'у пустого подменю нет `aria-owns`').toBeNull();
    expect(empty.chevron, 'у пустого подменю нет шеврона').toBeNull();
    expect(empty.haspopup, 'у пустого подменю нет `aria-haspopup`').toBeNull();
    // Контроль живости: сосед с непустым подменю — владелец по разметке, и разница
    // между ними читается в одном снимке.
    expect(before.levels[0].items[2].owns, 'у непустого подменю `aria-owns` есть').not.toBeNull();
    // Фокус стоит на «Пустом»: цикл прошёл через него, значит уровень зарегистрирован
    // в движке, и `Enter` дойдёт до обработчика.
    await page.keyboard.press('Home');
    const atEmpty = await readMenu(page);
    expect(atEmpty.focusLabel, 'фокус на владельце пустого подменю').toBe('Пустой');

    await page.keyboard.press('Enter');
    const after = await readMenu(page);
    // `Enter` активирует пункт, а не открывает пустое подменю, и закрывает меню.
    expect(after.log, 'пункт активирован').toEqual(['пустой']);
    // Заведённого, но не показанного уровня в разметке нет вовсе — он отцепленный
    // узел, — поэтому «уровень не заведён» проверяется по карте действий: три ключа
    // корня и один ключ подменю доступного владельца, ни одного от пустого.
    expect(after.actionsSize, 'уровень пустого подменю не заведён').toBe(4);
    expect(after.openCount, 'подменю не появилось').toBe(0);
  });

  test('attach: отключённый пункт с непустым подменю не владелец: ни шеврона, ни aria-owns, его уровень не заводится', async ({ page }) => {
    await makeMenu(page, 'disabled', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    // Подменю доступного владельца открывается, и только теперь его уровень
    // попадает в документ: заведённый, но не показанный уровень живёт
    // отцепленным узлом, и в разметке его следов нет — ни одного `id` в документе
    // до показа. Различать «уровень заведён» и «не заведён» приходится по тому,
    // что попало в карту действий.
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');

    const after = await readMenu(page);
    const deaf = after.levels[0].items[0];
    const live = after.levels[0].items[2];
    // Владелец — это одно условие: непустое подменю И не отключённый пункт.
    // Отключённый пункт с непустым подменю владельцем не является, и все признаки
    // подменю у него отсутствуют: обещать раскрытие, которого не будет, не должен
    // ни один слой. До Task 10 разметку ставил рендерер по непустоте подменю
    // независимо от `disabled`, и кейс закреплял обратное утверждение.
    expect(deaf.label).toBe('Глухой');
    expect(deaf.disabled).toBe(true);
    expect(deaf.chevron, 'у отключённого пункта шеврона нет').toBeNull();
    expect(deaf.owns, 'адрес подменю не зарезервирован').toBeNull();
    expect(deaf.haspopup, 'нет `aria-haspopup`').toBeNull();
    // Контроль в том же снимке: сосед с непустым подменю и без `disabled` сохраняет
    // все признаки, и разница между ними читается рядом.
    expect(live.label).toBe('Живой');
    expect(live.chevron, 'у доступного владельца шеврон есть').toBe('right');
    expect(live.owns, 'у доступного владельца адрес зарезервирован').not.toBeNull();
    // А уровня под отключённым нет: он в цикл роуминга не входит и активным не
    // станет, поэтому заводить ему уровень незачем. Три ключа корня плюс один
    // ключ подменю живого владельца — ровно четыре; снятие фильтра по
    // доступности дало бы пять.
    expect(after.levels, 'заведены корень и одно подменю').toHaveLength(2);
    expect(after.actionsSize, 'уровень отключённого владельца не заведён').toBe(4);
    expect(live.ownsTarget, 'уровень доступного владельца показан').toBe(true);
    expect(deaf.ownsTarget, 'у отключённого пункта нет и адреса, и уровня').toBe(false);
    expect(openIds(after), 'открыто подменю доступного владельца').toEqual([
      after.levels[0].id,
      /** @type {string} */ (live.owns),
    ]);
  });
});
