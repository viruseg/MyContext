import { expect, test } from '@playwright/test';
import { CLOSE_GRACE_MS, OPEN_GRACE_MS, SAFETY_PADDING, SUBMENU_OFFSET } from '../../src/constants.js';

/**
 * Кейсы показа подменю против настоящей страницы: курсор водит настоящий ввод
 * Playwright, модуль грузится динамическим импортом прямо в браузере.
 *
 * Три решения, на которых держится весь файл.
 *
 * **Время принадлежит `page.clock`, и оно заморожено.** `install()` подменяет
 * таймеры страницы, `pauseAt()` останавливает ход времени, и только `fastForward`
 * двигает его вперёд. Без заморозки утверждение «сразу после `pointerenter`
 * подменю нет» было бы гонкой: между отправкой события и чтением снимка
 * проходит реальное время, и достаточно было бы медленного прогона. Заморозка
 * делает «сразу» и «через 250 мс» двумя разными состояниями, а не двумя
 * вероятностями. Публичный API `MyContext` при этом не получает ни одного
 * параметра для подмены таймеров.
 *
 * **Курсор водится координатами, а не `locator.hover()`.** Все точки берутся из
 * настоящих `getBoundingClientRect()` в снимке, поэтому «уйти в сторону» и
 * «войти в подменю» — это конкретные пиксели, а не `hover()` по тексту. Заодно
 * снимается ловушка Playwright: элемент с `aria-disabled` она считает
 * непригодным и на него не кликает, а отключённый пункт-владелец здесь и есть
 * предмет половины кейсов. Наконец, `locator`-ожидания внутри замороженных часов
 * опираются на кадры браузера, которых при остановленном времени не бывает.
 *
 * **`reducedMotion: 'reduce'` убирает отложенное закрытие.** Слой под `reduce`
 * вызывает `hidePopover()` сразу, а не через `animationDuration`, поэтому
 * «подменю закрылось» читается в том же снимке, в котором оно закрылось, и ни
 * один кейс не ждёт анимацию. Задержка закрытия подменю при этом остаётся
 * настоящей — она у `hoverIntent`, а не у слоя, и её кейсы гоняют часами.
 */

/**
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 */

/**
 * @typedef {object} ItemView
 * @property {string} label подпись пункта; `''` у разделителя.
 * @property {boolean} active несёт ли пункт `data-active` — подсветку роуминга.
 *   Читается прямо с узла: отметку ставит движок, и по DOM её видно ровно там,
 *   где её ждёт `styles/mycontext.css`.
 * @property {string | null} haspopup `aria-haspopup`.
 * @property {string | null} expanded `aria-expanded`. Слой снимает отметку при
 *   закрытии, а не пишет `"false"`, поэтому `null` — это и есть «не развёрнуто».
 * @property {string | null} owns зарезервированный адрес подменю.
 * @property {string | null} chevron `data-chevron`.
 * @property {number} chevrons сколько узлов `.vc-chevron` на пункте.
 * @property {MenuRect} rect рамка пункта во вьюпорте.
 */

/**
 * @typedef {object} MenuRect
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 * @property {number} right
 * @property {number} bottom
 */

/**
 * @typedef {object} LevelView
 * @property {string} id
 * @property {boolean} popoverOpen `:popover-open` — уровень в Top Layer.
 * @property {MenuRect} rect
 * @property {ItemView[]} items
 */

/**
 * @typedef {object} Snapshot
 * @property {LevelView[]} levels уровни в порядке документа, включая закрытые:
 *   заведённый, но не показанный уровень остаётся отцепленным узлом и в разметке
 *   не виден, а `id` у него уже есть.
 * @property {number} openCount сколько уровней в Top Layer.
 * @property {string | null} focusLabel подпись пункта с фокусом.
 * @property {string[]} log метки сработавших действий, по порядку.
 * @property {string[]} errors сообщения необработанных ошибок страницы.
 */

/**
 * @typedef {object} McProbe
 * @property {(set: string, containerId: string | null) => void} make
 * @property {(x: number, y: number) => void} open
 * @property {() => void} close
 * @property {() => Snapshot} read
 * @property {(label: string) => MenuRect | null} rectOf
 * @property {(selector: string) => MenuRect | null} rectOfNode рамка первого узла,
 *   подходящего под селектор. Нужна для строк без подписи: разделителя, у которого
 *   её нет вовсе, и наводить приходится по прямоугольнику, а не по имени.
 * @property {(ownerLabel: string) => string | null} submenuIdOf
 * @property {(index: number, enabled: boolean) => void} setAvailability правка
 *   `isEnabledAction` у пункта набора последнего `make`: автор выключает пункт
 *   между показами, и решение обязано дойти до уже построенного уровня.
 * @property {(enabled: boolean) => OwnerProbe} ownersOf
 */

/**
 * Признаки владельца, снятые рендером напрямую: у живого меню доступно только
 * то, что дошло до DOM, а поле `hasSubmenu` живёт в `RenderedItem` и наружу не
 * отдаётся. Рендер вызывается на тех же данных, что и меню, и ответ читается
 * из его результата.
 *
 * @typedef {object} OwnerProbe
 * @property {boolean} hasSubmenu
 * @property {boolean} focusable
 * @property {string | null} owns
 * @property {string | null} haspopup
 * @property {string | null} chevron
 * @property {number} chevrons
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
    <!-- Контейнер на всю страницу и с tabindex="-1": правый клик открывает меню
         в любой точке, а close() возвращает фокус на элемент-владелец. -->
    <div id="surface" tabindex="-1"
         style="position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: rgb(240, 240, 240)"></div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };
/**
 * Узкий вьюпорт кейса о прижатом к краю подменю: подменю набора `wide` не помещается
 * в него ни справа, ни слева и прижимается к `padding`.
 */
const NARROW_VIEWPORT = { width: 600, height: 700 };
/** Насколько точка у края пункта отстоит от него самого, px. */
const EDGE_INSET = 2;

/**
 * Точки правого клика. Левая нужна, чтобы подменю помещалось справа, правая —
 * чтобы не помещалось и раскрылось влево: обе у краёв, обе внутри контейнера.
 */
const OPEN_LEFT = { x: 20, y: 300 };
const OPEN_RIGHT = { x: 900, y: 300 };
/** Точка в середине вьюпорта: от неё четыре уровня укладываются и по ширине, и по высоте. */
const OPEN_MIDDLE = { x: 260, y: 120 };
/**
 * Точка далеко от первой: повторный показ гасит прежний каскад и открывает меню
 * заново сюда.
 */
const OPEN_FAR = { x: 620, y: 560 };
/**
 * Точка правого клика для набора `wide`: по ней корень встаёт так, что его
 * подменю не помещается ни справа, ни слева. Рассчитана на вьюпорт 600 px, который
 * ставит сам кейс.
 */
const OPEN_WIDE = { x: 300, y: 300 };
/**
 * Мгновение, на котором замирают часы. Фиксированное, а не системное «сейчас»:
 * одинаковое во всех прогонах, и рядом с ним виден каждый прыжок времени.
 */
const CLOCK_FROZEN_AT = new Date('2024-12-10T09:00:00Z');
/**
 * Точка запуска часов, на час раньше точки замирания. Разрыв нужен потому, что
 * `install` не только ставит время, но и сразу пускает часы, и к моменту
 * `pauseAt` фальшивое время уже ушло вперёд на всё, что заняло обращение к
 * странице: `pauseAt` в прошлое двигать отказывается, Firefox отвечает на это
 * ошибкой, и кейс падал бы примерно через раз.
 */
const CLOCK_START_AT = new Date(CLOCK_FROZEN_AT.getTime() - 3_600_000);

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} set
 * @param {string | null} containerId
 * @returns {Promise<void>}
 */
function makeMenu(page, set, containerId) {
  return page.evaluate((input) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(input.set, input.container);
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
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function openAt(page, point) {
  return page.mouse.click(point.x, point.y, { button: 'right' });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function moveTo(page, point) {
  return page.mouse.move(point.x, point.y);
}

/**
 * Центр рамки пункта по подписи. Подписи в наборе не повторяются между уровнями,
 * поэтому одной подписи достаточно, а уровень искать не нужно.
 *
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
 * Наводит курсор на пункт по подписи.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<void>}
 */
async function hoverItem(page, label) {
  await moveTo(page, await centreOf(page, label));
}

/**
 * Наводит курсор на узел по селектору, а не по подписи. Для строк, у которых
 * подписи нет: разделителя, например, — и потому, что сам пункт может быть
 * непригоден для `locator`-наведения, как отключённый.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<void>}
 */
async function hoverNode(page, selector) {
  const rect = await page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.rectOfNode(name);
  }, selector);
  expect(rect, `узел ${selector} есть в разметке`).not.toBeNull();
  const found = /** @type {MenuRect} */ (rect);
  // Середина по вертикали у разделителя в один пиксель: промах на полпикселя ушёл бы
  // мимо него на соседний пункт, и кейс проверял бы не то.
  await page.mouse.move(found.left + found.width / 2, found.top + found.height / 2);
}

/**
 * Точка у правого края пункта — того края, который смотрит в сторону подменю. Ровно
 * центр для таких проверок не годится: он отстоит от обращённой границы пункта
 * почти на половину строки, и кейс прошёл бы при расширении безопасной области в
 * сторону владельца хоть на `SAFE_AREA_BUFFER`. Отступ от самого края — потому что
 * край и есть граница попадания.
 *
 * Только для владельца, раскрывшегося вправо: подменю, открытое влево, лежит за левым
 * краем пункта, и точка у правого края проверяла бы совсем другую область. Оба зовущих
 * кейса открывают меню в середине вьюпорта, где подменю помещается справа, — при флипе
 * оба молча перестали бы ловить мутацию.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<{ x: number, y: number }>}
 */
async function facingEdgeOf(page, label) {
  const rect = await page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.rectOf(name);
  }, label);
  expect(rect, `пункт «${label}» есть в разметке`).not.toBeNull();
  const found = /** @type {MenuRect} */ (rect);
  return { x: found.right - EDGE_INSET, y: found.top + found.height / 2 };
}

/**
 * Подписи владельцев, у которых `aria-expanded` стоит в `"true"`. Снимок, а не
 * одиночный пункт: утверждение «после закрытия не развёрнуто» проходит на
 * пустом дереве, если не видно, что до закрытия развёрнуто было хоть что-то.
 *
 * Список отсортирован: уровни лежат в документе в порядке показа, и порядок
 * подписей говорил бы о нём, а не о том, что утверждается.
 *
 * @param {Snapshot} snapshot
 * @returns {string[]}
 */
function expandedLabels(snapshot) {
  /** @type {string[]} */
  const labels = [];
  for (const level of snapshot.levels) {
    for (const item of level.items) {
      if (item.expanded === 'true') {
        labels.push(item.label);
      }
    }
  }
  return labels.sort();
}

/**
 * Подписи пунктов, помеченных `data-active`, по всем уровням. Снимок, а не одиночный
 * пункт: «выделен ровно один» прошло бы на пустом дереве, если не видно, что до
 * этого отмечено было хоть что-то.
 *
 * @param {Snapshot} snapshot
 * @returns {string[]}
 */
function activeLabels(snapshot) {
  /** @type {string[]} */
  const labels = [];
  for (const level of snapshot.levels) {
    for (const item of level.items) {
      if (item.active) {
        labels.push(item.label);
      }
    }
  }
  return labels;
}

/**
 * Пункт по подписи из любого уровня.
 *
 * @param {Snapshot} snapshot
 * @param {string} label
 * @returns {ItemView}
 */
function itemOf(snapshot, label) {
  for (const level of snapshot.levels) {
    for (const item of level.items) {
      if (item.label === label) {
        return item;
      }
    }
  }
  throw new Error(`в снимке нет пункта «${label}»`);
}

/**
 * Показан ли уровень с таким `id`.
 *
 * @param {Snapshot} snapshot
 * @param {string | null} id
 * @returns {boolean}
 */
function isOpen(snapshot, id) {
  return snapshot.levels.some((level) => {
    return level.id === id && level.popoverOpen;
  });
}

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
  // Часы ставятся после ожидания таблицы стилей: `waitForFunction` доходит до
  // страницы кадрами браузера, а замороженное время кадров не даёт.
  //
  // `install` с временем ставит часы на указанный момент и сразу их пускает,
  // поэтому точка замирания на час позже точки запуска: зазор не перекрывает
  // дрейф между двумя вызовами, а прыжок безопасен — задач на странице ещё нет,
  // их заводит проба ниже.
  await page.clock.install({ time: CLOCK_START_AT });
  await page.clock.pauseAt(CLOCK_FROZEN_AT);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { MyContext } = await import('../../src/index.js');
    const { renderLevel } = await import('../../src/renderer.js');

    /**
     * Наборы объявлены здесь, а не приходят аргументом: у пунктов есть
     * `action`-функции, а `page.evaluate` сериализует аргументы как JSON и функции
     * бы выбросил.
     *
     * Четыре уровня: корень, «Экспорт», «PNG» и «Один» — того достаточно, чтобы
     * цепочка обрезалась на два уровня глубже корня. «Скачать» лежит рядом с «PNG»
     * внутри подменю «Экспорта», а не в корне: усечение проверяется переходом на
     * соседа внутри одного уровня, и только там «глубже» имеет смысл отличать от
     * «в другой ветке». Последний пункт подменю «Экспорта» обычный, без подменю:
     * кейсы о прямом движении останавливают на нём курсор, и владелец на этом месте
     * открыл бы третий уровень поверх проверяемого.
     *
     * @type {Record<string, Array<MenuItem | SeparatorItem>>}
     */
    const sets = {
      tree: [
        { label: 'Новый', action: () => log.push('новый') },
        {
          label: 'Экспорт',
          submenu: [
            { label: 'PDF', action: () => log.push('pdf') },
            { label: 'PNG', submenu: [{ label: 'Один', submenu: [{ label: 'Глубоко' }] }] },
            {
              label: 'Скачать',
              submenu: [
                { label: 'Архив' },
                { label: 'Образ' },
              ],
              action: () => log.push('скачать'),
            },
            { label: 'Значок Windows' },
          ],
          action: () => log.push('экспорт'),
        },
        {
          label: 'Глухой',
          isEnabledAction: () => false,
          submenu: [{ label: 'Под глухим' }],
          action: () => log.push('глухой'),
        },
        { label: 'Пустой', submenu: [], action: () => log.push('пустой') },
        { label: 'Заметки', action: () => log.push('заметки') },
      ],
      // Два владельца на одном уровне и больше ничего. Кейс про отключённого
      // между показами владельца держит подменю второго открытым, пока курсор
      // стоит на первом, — а без второго владельца закрывать было бы нечего и
      // проверять было бы не на что.
      pair: [
        { label: 'Первый', submenu: [{ label: 'Под первым' }] },
        { label: 'Второй', submenu: [{ label: 'Под вторым' }] },
      ],
      // Владелец с подменю, которое не помещается ни справа, ни слева и прижимается
      // к `padding`. Набор отдельный, и длинная подпись в нём нужна ровно для этого:
      // предмет кейса — геометрия показа, а не состав пунктов.
      wide: [
        {
          label: 'Край',
          submenu: [
            { label: 'Первый' },
            { label: 'Второй' },
            { label: 'Третий' },
            { label: 'Дальний пункт подменю, прижатого к краю вьюпорта' },
          ],
        },
      ],
      // Обе невыбираемые строки на одном уровне: разделитель и отключённый пункт.
      // В `tree` отключённый пункт есть, а разделителя нет, и наоборот; кейс о
      // невыбираемых строках ловит обе границы разом, поэтому набор свой.
      unselectable: [
        { label: 'Живой' },
        { label: 'Глухой', isEnabledAction: () => false },
        { type: 'separator' },
        { label: 'Второй' },
      ],
    };

    /** @type {string[]} */
    const log = [];
    /** @type {string[]} */
    const errors = [];
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });

    /** @type {InstanceType<typeof MyContext> | null} */
    let menu = null;

    /** @type {string} имя набора последнего `make`: правке `disabled` подлежит он. */
    let currentSet = '';

    /**
     * @param {Element} item узел пункта или разделителя.
     * @returns {ItemView}
     */
    function readItem(item) {
      const label = item.querySelector('.vc-label');
      const rect = item.getBoundingClientRect();
      return {
        label: label === null ? '' : String(label.textContent),
        active: item.hasAttribute('data-active'),
        haspopup: item.getAttribute('aria-haspopup'),
        expanded: item.getAttribute('aria-expanded'),
        owns: item.getAttribute('aria-owns'),
        chevron: item.getAttribute('data-chevron'),
        chevrons: item.querySelectorAll('.vc-chevron').length,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
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
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom,
          },
          items: Array.from(element.querySelectorAll('.vc-item, .vc-separator')).map((node) => {
            return readItem(node);
          }),
        };
      });
      const active = document.activeElement;
      const focused = active instanceof Element ? active.closest('.vc-item') : null;
      const focusedLabel = focused === null ? null : focused.querySelector('.vc-label');
      return {
        levels,
        openCount: levels.filter((level) => {
          return level.popoverOpen;
        }).length,
        focusLabel: focusedLabel === null ? null : String(focusedLabel.textContent),
        log: log.slice(),
        errors: errors.slice(),
      };
    }

    const probe = /** @type {McProbe} */ ({
      make(setName, containerId) {
        if (menu !== null) {
          menu.destroy();
        }
        currentSet = setName;
        log.length = 0;
        errors.length = 0;
        menu = new MyContext(sets[setName], { label: 'Меню подменю' });
        const container = containerId === null ? null : document.getElementById(containerId);
        if (container instanceof HTMLElement) {
          menu.attach(container);
        }
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
      read,
      rectOf(name) {
        for (const element of document.querySelectorAll('.vc-item')) {
          const label = element.querySelector('.vc-label');
          if (label !== null && String(label.textContent) === name) {
            const rect = element.getBoundingClientRect();
            return {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              right: rect.right,
              bottom: rect.bottom,
            };
          }
        }
        return null;
      },
      rectOfNode(selector) {
        const element = document.querySelector(selector);
        if (element === null) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        };
      },
      submenuIdOf(ownerLabel) {
        for (const element of document.querySelectorAll('.vc-item')) {
          const label = element.querySelector('.vc-label');
          if (label !== null && String(label.textContent) === ownerLabel) {
            return element.getAttribute('aria-owns');
          }
        }
        return null;
      },
      setAvailability(index, enabled) {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        const item = sets[currentSet][index];
        if (item === undefined || 'type' in item) {
          throw new Error('в наборе нет такого пункта');
        }
        // Предикат вешается на живом объекте набора: автор выключает пункт между
        // показами, и решение обязано дойти до уже построенного уровня.
        item.isEnabledAction = () => enabled;
      },
      ownersOf(enabled) {
        // Рендер вызывается на тех же данных, что и меню: подменю непустое, и
        // единственное различие между двумя пунктами — ответ предиката.
        const items = [{
          label: 'Владелец',
          submenu: [{ label: 'Лист' }],
          isEnabledAction: () => enabled,
        }];
        const level = renderLevel(items, {
          levelIndex: 0,
          menuId: 'vc-проба',
          label: 'Меню пробы',
          actions: new Map(),
        });
        const item = level.items[0];
        return {
          hasSubmenu: item.hasSubmenu,
          focusable: item.focusable,
          owns: item.element.getAttribute('aria-owns'),
          haspopup: item.element.getAttribute('aria-haspopup'),
          chevron: item.element.getAttribute('data-chevron'),
          chevrons: item.element.querySelectorAll('.vc-chevron').length,
        };
      },
    });

    const scope = /** @type {{ __mc?: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc = probe;
  });
});

test.describe('показ подменю', () => {
  test('наведение на пункт с подменю не открывает его мгновенно', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(ownerId, 'у владельца есть зарезервированный адрес подменю').not.toBeNull();

    await hoverItem(page, 'Экспорт');

    // Часы стоят: ни миллиметра времени не прошло, и «сразу» здесь — буквально
    // ноль, а не «меньше задержки». Показ без задержки ронял бы это утверждение,
    // и роняет его одна строка — вызов показа прямо из `#onItemEnter`.
    const after = await readMenu(page);
    expect(after.openCount, 'открыт только корень').toBe(1);
    expect(isOpen(after, ownerId), 'подменю не показано').toBe(false);
  });

  test('наведение на пункт с подменю открывает его через openDelayMs', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const after = await readMenu(page);
    expect(isOpen(after, ownerId), 'подменю показано').toBe(true);
    expect(after.openCount, 'открыты корень и подменю').toBe(2);
    expect(expandedLabels(after), 'владелец отмечен развёрнутым').toEqual(['Экспорт']);
    // Показ подменю мышью фокус в подменю не уводит (спека 3.2), и фокус стоит на
    // владельце — том самом пункте, по которому пришёл курсор: наведение выделяет
    // пункт, и отметка с фокусом неразлучны. Реестр движка при этом пополнен, иначе
    // открытое мышью подменю было бы мёртво с клавиатуры — это проверяет кейс про
    // `ArrowRight` ниже.
    expect(after.focusLabel, 'фокус на владельце, а не в подменю').toBe('Экспорт');
  });

  test('наведение мыши выделяет пункт, и стрелка считает следующий от него', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);

    // Настоящее наведение, а не вызов движка из пробы: выделение приходит из
    // `pointermove` по пункту, и кейс держит в проверке именно эту проводку.
    // Пункт взят не первый и не последний: от края уровня стрелка дала бы тот же
    // результат, и «отсчёт от того, что под курсором» было бы нечем доказать.
    await hoverItem(page, 'Пустой');
    const hovered = await readMenu(page);
    // Отметка ровно одна, и она на том пункте, где курсор: два писателя выделения
    // дали бы подсветку сразу на двух пунктах.
    expect(activeLabels(hovered), 'отмечен только пункт под курсором').toEqual(['Пустой']);
    expect(itemOf(hovered, 'Пустой').active).toBe(true);
    // Фокус ушёл за отметкой: клавиши адресуются меню по цели события, и без этого
    // стрелка уехала бы с пункта, который пользователь видит отмеченным.
    expect(hovered.focusLabel, 'фокус на пункте под курсором').toBe('Пустой');
    // Наведение на пункт с пустым подменю не открывает ничего: владельцем он не
    // является, и уровня за ним нет.
    expect(hovered.openCount, 'наведение ничего не открыло').toBe(1);

    // Клавиша приходит на пункт под курсором и считает следующий от него, а не от
    // края: после «Пустого» в наборе идёт «Заметки», а от края стрелка дала бы
    // «Новый».
    await page.keyboard.press('ArrowDown');
    const afterKey = await readMenu(page);
    expect(activeLabels(afterKey), 'стрелка увела выделение с пункта под курсором').toEqual(['Заметки']);
    expect(afterKey.focusLabel).toBe('Заметки');
  });

  test('курсор над невыбираемой строкой выделение не меняет и не сбрасывает', async ({ page }) => {
    await makeMenu(page, 'unselectable', 'surface');
    await openAt(page, OPEN_MIDDLE);

    // Живой пункт под курсором: выделение есть, и дальше проверяется, что две
    // невыбираемые строки его не сдвигают.
    await hoverItem(page, 'Второй');
    const marked = await readMenu(page);
    expect(activeLabels(marked), 'отмечен пункт под курсором').toEqual(['Второй']);
    expect(marked.focusLabel, 'фокус на пункте под курсором').toBe('Второй');

    // Отключённый пункт: вне цикла роуминга, отметки на нём быть не может. Сбрасывать
    // тоже нечего, а выделение по требованию полного сброса снимается уходом курсора
    // с дерева меню, а не наведением внутри него.
    await hoverItem(page, 'Глухой');
    const overDisabled = await readMenu(page);
    expect(activeLabels(overDisabled), 'отключённый пункт выделение не сменил').toEqual(['Второй']);
    expect(overDisabled.focusLabel, 'фокус остался на живом пункте').toBe('Второй');

    // Разделитель: высота в один пиксель, и курсор пересекает его на каждом
    // проходе мимо. Мигание здесь было бы постоянным, поэтому выделение и фокус
    // обязаны остаться там же.
    await hoverNode(page, '.vc-separator');
    const overSeparator = await readMenu(page);
    expect(activeLabels(overSeparator), 'разделитель выделение не сменил').toEqual(['Второй']);
    expect(overSeparator.focusLabel, 'фокус остался на живом пункте').toBe('Второй');
    // Контроль: живой пункт после невыбираемых строк выделение всё-таки сдвигает.
    // Без него тест проходил бы и на уровне, где выделение не двигает ничто.
    await hoverItem(page, 'Живой');
    expect(activeLabels(await readMenu(page)), 'живой пункт выделение сдвинул').toEqual(['Живой']);
  });

  test('уход курсора до истечения задержки не открывает подменю', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS - 50);
    await hoverItem(page, 'Заметки');
    // Срок открытия истёк бы после ухода курсора: без отмены задачи подменю
    // показалось бы здесь, и кейс это поймал бы.
    await page.clock.fastForward(OPEN_GRACE_MS * 2);

    const after = await readMenu(page);
    expect(isOpen(after, ownerId), 'подменю не показано').toBe(false);
    expect(after.openCount, 'открыт только корень').toBe(1);
  });

  test('удержание кнопки мыши открывает подменю немедленно', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    // Никакого `fastForward`: показ обязан произойти на нажатии, минуя
    // `openDelayMs`. Снятие слушателя `pointerdown` с пункта ломает ровно эту
    // строку, и часы скрыть её не могут.
    await page.mouse.down();
    const pressed = await readMenu(page);
    expect(isOpen(pressed, ownerId), 'подменю открыто на нажатии').toBe(true);

    // Отпускание доводит дело до клика, а клик по владельцу открывает подменю, а не
    // зовёт его действие: у «Экспорта` есть `action`, и пустой журнал здесь — не
    // «обработчика нет», а правило владельца.
    await page.mouse.up();
    const after = await readMenu(page);
    expect(after.log, 'действие владельца не вызвано').toEqual([]);
    expect(isOpen(after, ownerId), 'подменю всё ещё открыто').toBe(true);
    expect(after.openCount, 'открыты корень и подменю').toBe(2);
  });

  test('нажатие не основной кнопкой подменю не открывает', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    // Средняя кнопка, а не правая: правое нажатие тут же подтверждается `contextmenu`,
    // который зовёт `open()` и переоткрывает меню, — мигание на один такт между этими
    // событиями не прочитать, потому что браузер отдаёт их одной пачкой и не всегда
    // одинаково. Средняя кнопка ничем не подтверждается, а `pointerdown` у неё тот
    // же, то есть кейс бьёт по той же двери без чужой подсказки.
    await page.mouse.down({ button: 'middle' });
    const pressed = await readMenu(page);
    expect(isOpen(pressed, ownerId), 'средняя кнопка не открывает подменю').toBe(false);
    expect(pressed.openCount, 'открыт только корень').toBe(1);

    // Показ всё равно остаётся замыслом наведения: отказ нажатию — не отказ
    // показать. Снимается задача открытия, а не планирование.
    await page.clock.fastForward(OPEN_GRACE_MS);
    const shown = await readMenu(page);
    expect(isOpen(shown, ownerId), 'подменю открыто по наведению').toBe(true);
    // `auxclick`, а не `click`: у обработчика активации на владельце свой путь,
    // он уходит в показ подменю и до журнала действий не доходит.
    await page.mouse.up({ button: 'middle' });
    const after = await readMenu(page);
    expect(after.log, 'действие владельца не вызвано').toEqual([]);
    expect(isOpen(after, ownerId), 'подменю осталось открытым').toBe(true);
  });

  test('нажатие правой кнопкой подменю не открывает', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    // Синтетическое `pointerdown` с `button: 2`, а не `mouse.down({ button:
    // 'right' })`: браузер отдаёт `pointerdown` и `contextmenu` одной пачкой и не
    // всегда одинаково, — webkit в одном прогоне из трёх присылал `contextmenu`
    // уже после `mouse.down()`, и настоящий правый клик либо проходил, либо нет.
    // `contextmenu` здесь не нужен: подтверждать нечего, кейс бьёт по той же двери
    // `pointerdown` на пункте, а мутация `button === 2` в guard его роняет.
    await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll('.vc-label')).find((node) => {
        return node.textContent === 'Экспорт';
      });
      const item = label === undefined ? null : label.closest('.vc-item');
      if (!(item instanceof HTMLElement)) {
        throw new Error('пункт «Экспорт» не найден');
      }
      item.dispatchEvent(
        new PointerEvent('pointerdown', { button: 2, buttons: 2, bubbles: true, composed: true }),
      );
    });

    const pressed = await readMenu(page);
    expect(isOpen(pressed, ownerId), 'правая кнопка не открывает подменю').toBe(false);
    expect(pressed.openCount, 'открыт только корень').toBe(1);
    // Задача открытия не тронута: подменю появилось бы по наведению, и это
    // доказывает, что кейс проверяет нажатие, а не само наведение.
    await page.clock.fastForward(OPEN_GRACE_MS);
    expect(isOpen(await readMenu(page), ownerId), 'подменю открыто по наведению').toBe(true);
  });

  test('стрелка вправо открывает подменю и отдаёт его движку', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    // Клавиатурный путь показа на настоящем экземпляре: движок зовёт
    // `host.openSubmenu` и больше не показывает, а фокус в подменю переносит сам —
    // иначе у клавиатуры было бы два места переноса, и мышиные пути показа перестали
    // бы быть эталоном. Если бы фокус переносил показ, движок молчал бы на этом
    // месте — и кейс погас бы, оставив мышиные пути единственной проверкой.
    //
    // Два шага вниз, а не один: показ меню выделения не оставляет, а первым
    // доступным в корне стоит «Новый» — у него подменю нет.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');

    const after = await readMenu(page);
    expect(isOpen(after, ownerId), 'подменю показано').toBe(true);
    expect(after.openCount, 'открыты корень и подменю').toBe(2);
    expect(after.focusLabel, 'фокус в показанном подменю').toBe('PDF');
    // Ответ на ключ в показанном подменю, а не в родителе: уровень вне реестра
    // движка на клавиши не отвечает вовсе, и это читалось бы как «открыто и мёртво».
    await page.keyboard.press('ArrowDown');
    expect((await readMenu(page)).focusLabel, 'роуминг идёт внутри подменю').toBe('PNG');
  });

  test('показ в новой точке снимает отложенное закрытие', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    // Курсор уходит с владельца в сторону, в дереве меню: закрытие запланировано,
    // и срок его ещё не истёк. Кейс про диагональное движение держит вторую
    // половину этой же траектории — там закрытие действительно срабатывает.
    await hoverItem(page, 'Новый');
    await page.clock.fastForward(CLOSE_GRACE_MS - 50);
    expect(isOpen(await readMenu(page), exportId), 'подменю на месте').toBe(true);

    // Показ в новой точке начинает полный цикл: уровни гаснут на месте, в Top Layer,
    // и подменю прежней постановки уходит вместе с ними, — но отложенное закрытие
    // относится к той же прежней постановке. Дальше подменю открывает клавиатура:
    // этот путь не трогает hover intent ни на одном шаге, и ушедшая задача снесла бы
    // подменю, открытое уже на новом месте.
    await openAt(page, OPEN_FAR);
    expect(isOpen(await readMenu(page), exportId), 'подменю прежней постановки скрыто').toBe(false);
    // Два шага вниз: показ не отмечает пунктов, а первым доступным в корне стоит
    // «Новый» — у него подменю нет.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.clock.fastForward(CLOSE_GRACE_MS);

    const after = await readMenu(page);
    expect(isOpen(after, exportId), 'подменю, открытое после переноса, не снесено').toBe(true);
    expect(after.openCount, 'открыты корень и подменю').toBe(2);
    expect(after.focusLabel, 'фокус в подменю').toBe('PDF');
  });

  test('уход курсора закрывает подменю, оставшееся после Escape', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    // Вход в цепочку с клавиатуры. Показ подменю мышью фокус из родительского
    // уровня не уводит (спека 6.2), и `Escape` после такого показа закрыл бы всё
    // меню одним нажатием вместо самого глубокого уровня. Показ не отмечает пунктов,
    // поэтому каждому уровню предшествует шаг вниз: в корне их два — до «Экспорта»,
    // в подменю «Экспорта» один — до «PNG».
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    expect((await readMenu(page)).openCount, 'открыты корень и два подменю').toBe(3);

    // Escape закрывает уровень, где стоит фокус, — в обход `#hideSubmenuFor`, и
    // потому в обход укорочения цепочки. Уровень уходит из цепочки здесь же, иначе
    // следующая операция по цепочке — уход курсора — спрятала бы его снова вместо
    // показанного подменю «Экспорта», и оно осталось бы висеть при курсоре,
    // который давно ушёл в сторону.
    await page.keyboard.press('Escape');
    const closed = await readMenu(page);
    expect(closed.openCount, 'подменю «PNG» закрыто').toBe(2);
    expect(isOpen(closed, exportId), 'подменю «Экспорта» осталось открытым').toBe(true);

    await hoverItem(page, 'Заметки');
    await page.clock.fastForward(CLOSE_GRACE_MS);
    const after = await readMenu(page);
    expect(isOpen(after, exportId), 'подменю «Экспорта» закрыто').toBe(false);
    expect(after.openCount, 'остался корень').toBe(1);
    expect(expandedLabels(after), 'отметок развёрнутости не осталось').toEqual([]);
  });

  test('курсор на владельце, отключённом между показами, планирует закрытие как на любой строке', async ({ page }) => {
    await makeMenu(page, 'pair', 'surface');
    await openAt(page, OPEN_MIDDLE);
    // Владелец за один показ успевает встать в карту показа подменю. Отключение
    // между показами обязано оттуда выйти: на отключённом владельце решать нечего,
    // и обработчик движения курсора возвращается до планирования закрытия, как на
    // любой другой строке уровня.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown } */ (globalThis));
      scope.__mc.close();
      scope.__mc.setAvailability(0, false);
    });
    await openAt(page, OPEN_MIDDLE);
    const second = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown } */ (globalThis));
      return scope.__mc.submenuIdOf('Второй');
    });
    expect(second, 'второй владелец на месте').not.toBeNull();

    await hoverItem(page, 'Второй');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(isOpen(opened, /** @type {string} */ (second)), 'подменю второго открыто').toBe(true);
    // Контроль премиссы: отключённый владелец не должен ни открывать подменю сам,
    // ни помечаться развёрнутым.
    const deaf = itemOf(opened, 'Первый');
    expect(deaf.haspopup, 'у отключённого владельца нет `aria-haspopup`').toBeNull();
    expect(deaf.expanded, 'отметки развёрнутости нет').toBeNull();

    await hoverItem(page, 'Первый');
    await page.clock.fastForward(CLOSE_GRACE_MS);

    const after = await readMenu(page);
    expect(isOpen(after, /** @type {string} */ (second)), 'подменю второго закрыто').toBe(false);
    expect(after.openCount, 'остался корень').toBe(1);
    // Наведение на отключённого владельца не открывает его подменю: раскрывать
    // нечего, а открытое подменю было бы меню без пути к закрытию.
    expect(expandedLabels(after), 'отметок развёрнутости не осталось').toEqual([]);
  });

  test('диагональное движение к подменю не закрывает его', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(ownerId, 'адрес подменю «Экспорта» назван').not.toBeNull();
    const submenuId = /** @type {string} */ (ownerId);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(isOpen(opened, submenuId), 'подменю открыто').toBe(true);

    // Прямая от пункта-владельца к нижнему крайнему пункту подменю — то самое
    // движение, ради которого всё и затевалось. Оно идёт по прямой по построению,
    // и прямая — единственное движение, на котором безопасная область обязана
    // покрывать весь путь целиком: зазор между уровнями равен `SUBMENU_OFFSET`, и
    // расширения ровно на него хватает, чтобы отрезок не выходил из области ни в
    // одной своей точке. Обе точки берутся из настоящих рамок, а `steps`
    // действительно гонит курсор по отрезку, а не прыгает в конец.
    const inset = 4;
    const far = await page.evaluate((input) => {
      const level = document.getElementById(input.id);
      if (level === null) {
        throw new Error('подменю показано, но узла нет');
      }
      const items = level.querySelectorAll('.vc-item');
      const last = items[items.length - 1];
      if (last === undefined) {
        throw new Error('в подменю нет пунктов');
      }
      // Нижний крайний пункт, а не первый: расстояние от пункта-владельца
      // максимально, и подменю защищает не близость к началу пути, а весь отрезок
      // целиком. Отступ от угла обязателен: сам угол скруглённой рамки в попадание
      // не входит, и точка на нём не достала бы до пункта ни в одном движке.
      const rect = last.getBoundingClientRect();
      return { x: rect.right - input.inset, y: rect.bottom - input.inset };
    }, { id: submenuId, inset });
    await page.mouse.move(far.x, far.y, { steps: 20 });
    await page.clock.fastForward(CLOSE_GRACE_MS * 3);

    const after = await readMenu(page);
    expect(isOpen(after, submenuId), 'подменю пережило прямое движение к дальнему пункту').toBe(true);
    expect(after.openCount, 'открыты корень и подменю').toBe(2);
    expect(expandedLabels(after), 'владелец всё ещё развёрнут').toEqual(['Экспорт']);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('курсор, ушедший в сторону, закрывает подменю после closeDelayMs', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(ownerId, 'адрес подменю «Экспорта» назван').not.toBeNull();
    const submenuId = /** @type {string} */ (ownerId);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    // Контроль состояния: «не открыто» ниже имеет смысл только если до ухода
    // курсора подменю было открыто.
    expect(isOpen(await readMenu(page), submenuId), 'подменю открыто').toBe(true);

    // Соседний пункт того же уровня: у «Нового» нет подменю, и он лежит в
    // родительском уровне, то есть за расширением безопасной области в сторону
    // владельца. В центре пункта это почти полстроки мимо, и кейс прошёл бы при
    // расширении в ту же сторону хоть на `SAFE_AREA_BUFFER`; край соседа закрепляют
    // два кейса ниже.
    await hoverItem(page, 'Новый');
    // Срок закрытия ещё не истёк: подменю обязано быть на месте.
    await page.clock.fastForward(CLOSE_GRACE_MS - 50);
    const pending = await readMenu(page);
    expect(isOpen(pending, submenuId), 'до истечения срока подменю на месте').toBe(true);

    await page.clock.fastForward(CLOSE_GRACE_MS);
    const after = await readMenu(page);
    expect(isOpen(after, submenuId), 'подменю закрылось').toBe(false);
    expect(after.openCount, 'корень остался открытым').toBe(1);
    expect(expandedLabels(after), 'отметка развёрнутости снята').toEqual([]);
  });

  test('край соседнего пункта родительского уровня не защищает подменю', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(ownerId, 'адрес подменю «Экспорта» назван').not.toBeNull();
    const submenuId = /** @type {string} */ (ownerId);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    expect(isOpen(await readMenu(page), submenuId), 'подменю открыто').toBe(true);

    // Край соседа, а не его центр: центр отстоит от обращённой границы пункта почти на
    // половину строки, и такой кейс прошёл бы при расширении в сторону владельца хоть
    // на `SAFE_AREA_BUFFER`. Именно край и отличает соседа от владельца, поэтому
    // правило «расширять в сторону владельца можно ровно на зазор» закрепляется здесь.
    await moveTo(page, await facingEdgeOf(page, 'Новый'));
    await page.clock.fastForward(CLOSE_GRACE_MS);

    const after = await readMenu(page);
    expect(isOpen(after, submenuId), 'подменю закрылось').toBe(false);
    expect(after.openCount, 'корень остался открытым').toBe(1);
    expect(expandedLabels(after), 'отметка развёрнутости снята').toEqual([]);

    // Контроль живости: точка стояла на соседе, а не в пустоте меню, — назад по
    // наведению подменю открывается тем же уровнем. Без этого шага «закрылось» не
    // отличалось бы от «меню перестало показывать подменю вообще».
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    expect(isOpen(await readMenu(page), submenuId), 'подменю снова открыто').toBe(true);
  });

  test('край соседнего пункта-владельца, не раскрытого, не защищает подменю', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(ownerId, 'адрес подменю «Экспорта» назван').not.toBeNull();
    const submenuId = /** @type {string} */ (ownerId);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    expect(isOpen(await readMenu(page), submenuId), 'подменю открыто').toBe(true);

    // Тот же край, но сосед — отключённый владелец: подменю у него есть и не
    // раскрыто быть не может, то есть по виду он от владельца «Экспорта» не
    // отличается. Проверять надо именно его: показ подменю на соседе снял бы
    // запланированное закрытие и скрыл бы промах, а здесь решения принимает
    // геометрия безопасной области.
    await moveTo(page, await facingEdgeOf(page, 'Глухой'));
    await page.clock.fastForward(CLOSE_GRACE_MS);

    const after = await readMenu(page);
    expect(isOpen(after, submenuId), 'подменю закрылось').toBe(false);
    expect(after.openCount, 'корень остался открытым').toBe(1);
    expect(expandedLabels(after), 'отметка развёрнутости снята').toEqual([]);
  });

  test('подменю, прижатое к краю вьюпорта, переживает переход через зазор', async ({ page }) => {
    // Вьюпорта набора `wide` хватает, чтобы его подменю не поместилось ни справа, ни
    // слева. Общий `beforeEach` ради этого менять нельзя: остальным кейсам файла его
    // вьюпорт нужен для четырёх уровней вложенности.
    await page.setViewportSize(NARROW_VIEWPORT);
    await makeMenu(page, 'wide', 'surface');
    await openAt(page, OPEN_WIDE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Край');
    });
    expect(ownerId, 'адрес подменю назван').not.toBeNull();
    const submenuId = /** @type {string} */ (ownerId);

    await hoverItem(page, 'Край');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(isOpen(opened, submenuId), 'подменю открыто').toBe(true);

    // Предмет кейса — геометрия показа, и без её проверки «прижатое к краю» было бы
    // предположением. Обе неудачные попытки позиционера проверяются явно, а не
    // через `left === SAFETY_PADDING`: прижатым может оказаться и не тот край.
    const owner = itemOf(opened, 'Край');
    const shown = opened.levels.find((level) => {
      return level.id === submenuId;
    });
    expect(shown, 'подменю показано').not.toBeUndefined();
    const submenu = /** @type {LevelView} */ (shown);
    expect(
      owner.rect.right + SUBMENU_OFFSET + submenu.rect.width,
      'справа не помещается',
    ).toBeGreaterThan(NARROW_VIEWPORT.width - SAFETY_PADDING);
    expect(
      owner.rect.left - SUBMENU_OFFSET - submenu.rect.width,
      'слева не помещается',
    ).toBeLessThan(SAFETY_PADDING);
    expect(submenu.rect.left, 'прижато к отступу').toBeCloseTo(SAFETY_PADDING, 1);
    // Расширение в сторону владельца здесь не работает: подменю прижато к краю
    // слева, а владелец стоит правее, и зазор между ними в разы больше
    // `SUBMENU_OFFSET`. Переход держит сам прямоугольник и вход в подменю.
    expect(
      Math.abs(owner.rect.right - submenu.rect.left),
      'зазор больше SUBMENU_OFFSET',
    ).toBeGreaterThan(SUBMENU_OFFSET);

    // Прямая к нижнему крайнему пункту прижатого подменю. Курсор идёт по отрезку
    // `steps` точками, и часы стоят, поэтому переход через зазор не растягивается
    // на `CLOSE_GRACE_MS`: проверяется решение по каждой точке, а не скорость
    // настоящей руки.
    const inset = 4;
    const far = await page.evaluate((input) => {
      const level = document.getElementById(input.id);
      if (level === null) {
        throw new Error('подменю показано, но узла нет');
      }
      const items = level.querySelectorAll('.vc-item');
      const last = items[items.length - 1];
      if (last === undefined) {
        throw new Error('в подменю нет пунктов');
      }
      const rect = last.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.bottom - input.inset };
    }, { id: submenuId, inset });
    await page.mouse.move(far.x, far.y, { steps: 20 });
    await page.clock.fastForward(CLOSE_GRACE_MS * 3);

    const after = await readMenu(page);
    expect(isOpen(after, submenuId), 'подменю пережило переход через зазор').toBe(true);
    expect(expandedLabels(after), 'владелец всё ещё развёрнут').toEqual(['Край']);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('переход на другой пункт усекает цепочку', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(exportId, 'адрес подменю «Экспорта» назван').not.toBeNull();

    // Второй уровень заводится только показом первого: до него в документе нет ни
    // его пункта, ни его `id`, и адреса подменю «PNG» и «Скачать» читаются уже
    // после наведения на «Экспорт».
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const innerIds = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return {
        png: scope.__mc.submenuIdOf('PNG'),
        download: scope.__mc.submenuIdOf('Скачать'),
      };
    });
    expect(innerIds.png, 'адрес подменю «PNG» назван').not.toBeNull();
    expect(innerIds.download, 'адрес подменю «Скачать» назван').not.toBeNull();

    // Цепочка из трёх уровней: корень, «Экспорт», «PNG».
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const deep = await readMenu(page);
    expect(deep.openCount, 'открыты корень и два подменю').toBe(3);
    expect(isOpen(deep, exportId), 'подменю «Экспорта» открыто').toBe(true);
    expect(isOpen(deep, innerIds.png), 'подменю «PNG» открыто').toBe(true);

    // Переход на соседний пункт того же уровня: «Экспорт» остаётся открытым, а всё
    // глубже него уходит. Закрытие целиком прошло бы мимо «PDF» и «PNG» и было бы
    // видно по счётчику открытых уровней; усечение не по глубже, а по всей
    // ветке, закрыло бы и «Экспорт» — и тогда «остался открытым» было бы пустым.
    await hoverItem(page, 'Скачать');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const after = await readMenu(page);
    expect(isOpen(after, innerIds.download), 'подменю нового владельца открыто').toBe(true);
    expect(isOpen(after, exportId), 'уровень прежнего владельца остался открытым').toBe(true);
    expect(isOpen(after, innerIds.png), 'подменю глубже прежнего владельца закрыто').toBe(false);
    expect(after.openCount, 'открыты корень, «Экспорт» и «Скачать»').toBe(3);
    expect(
      expandedLabels(after),
      'развёрнуты «Экспорт» и «Скачать», «PNG» — нет',
    ).toEqual(['Скачать', 'Экспорт'].sort());

    // Второе усечение — отдельный шаг, а не повтор первого. Показ «Скачать» скрыл
    // «PNG» и встал в цепочку, а «Экспорт» обязан остаться в ней: усечение
    // отсчитывается от него, и без него следующая ветка не обрежется вовсе. Шаг
    // смотрит в слой, а цепочка оттуда не видна: «скрыт» и «оставлен в цепочке» —
    // разные вещи, и проверять надо обе. Выкинутый из цепочки «Экспорт» роняет
    // именно этот переход: «Скачать» осталось бы висеть рядом с «PNG».
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const truncated = await readMenu(page);
    expect(isOpen(truncated, innerIds.download), 'подменю «Скачать» унесено усечением').toBe(false);
    expect(isOpen(truncated, innerIds.png), 'подменю «PNG» открыто').toBe(true);
    expect(isOpen(truncated, exportId), 'подменю «Экспорта» осталось открытым').toBe(true);
    expect(truncated.openCount, 'открыты корень, «Экспорт» и «PNG»').toBe(3);
    expect(
      expandedLabels(truncated),
      'развёрнуты «Экспорт» и «PNG», «Скачать» — нет',
    ).toEqual(['PNG', 'Экспорт'].sort());
  });

  test('подменю у правого края раскрывается влево, шеврон развёрнут', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_RIGHT);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const after = await readMenu(page);
    const owner = itemOf(after, 'Экспорт');
    expect(owner.chevron, 'шеврон развёрнут влево').toBe('left');
    const submenu = after.levels.find((level) => {
      return level.id === ownerId;
    });
    expect(submenu, 'подменю показано').not.toBeUndefined();
    const found = /** @type {LevelView} */ (submenu);
    // Не «левее владельца вообще», а ровно на зазор: позиция считается
    // позиционером, и утверждение о развороте без проверки самого зазора
    // проходило бы на подменю, показанном где угодно.
    expect(
      found.rect.right,
      'правый край подменю на зазоре от левого края владельца',
    ).toBeCloseTo(owner.rect.left - SUBMENU_OFFSET, 1);
  });

  test('подменю у левого края раскрывается вправо, шеврон обычный', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_LEFT);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const after = await readMenu(page);
    const owner = itemOf(after, 'Экспорт');
    expect(owner.chevron, 'шеврон обычный').toBe('right');
    const submenu = after.levels.find((level) => {
      return level.id === ownerId;
    });
    expect(submenu, 'подменю показано').not.toBeUndefined();
    const found = /** @type {LevelView} */ (submenu);
    expect(found.rect.left, 'левый край подменю на зазоре от владельца')
      .toBeCloseTo(owner.rect.right + SUBMENU_OFFSET, 1);
  });

  test('вложенность 4 уровней открывается целиком и все меню в пределах вьюпорта', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'Один');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const after = await readMenu(page);
    expect(after.openCount, 'открыты корень и три подменю').toBe(4);
    // Показ по наведению фокус в подменю не переносит ни на один уровень (спека 3.2):
    // фокус стоит на владельце последнего показанного подменю, то есть в самой
    // глубокой точке, до которой дошёл курсор. Подписью пункта под фокусом кейс не
    // обзаведён, а геометрия ниже проверяется по каждому уровню отдельно.
    expect(after.focusLabel, 'фокус на последнем владельце цепочки').toBe('Один');
    // Геометрия каждого уровня по отдельности: «всего четыре открыто» проверяло бы
    // число, а не то, что они помещаются.
    const shown = after.levels.filter((level) => {
      return level.popoverOpen;
    });
    expect(shown).toHaveLength(4);
    for (const level of shown) {
      expect(level.rect.left, `левый край уровня ${level.id}`).toBeGreaterThanOrEqual(
        SAFETY_PADDING,
      );
      expect(level.rect.top, `верхний край уровня ${level.id}`).toBeGreaterThanOrEqual(
        SAFETY_PADDING,
      );
      expect(
        level.rect.left + level.rect.width,
        `правый край уровня ${level.id}`,
      ).toBeLessThanOrEqual(VIEWPORT.width - SAFETY_PADDING);
      expect(
        level.rect.top + level.rect.height,
        `нижний край уровня ${level.id}`,
      ).toBeLessThanOrEqual(VIEWPORT.height - SAFETY_PADDING);
    }
  });

  test('вложенность 4 уровней закрывается по цепочке клавишей Escape', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);

    // Вход в цепочку с клавиатуры: показ подменю мышью фокус из родительского уровня
    // не уводит, и четыре `Escape` после такого показа закрыли бы всё меню первым
    // же нажатием. Каждому уровню предшествует шаг вниз — показ не отмечает
    // пунктов, — а в корне их два: до «Экспорта» от «Нового» ещё один шаг.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    expect((await readMenu(page)).openCount, 'открыты четыре уровня').toBe(4);

    // По одному на уровень, от глубокого к корню. Число нажатий закреплено, а не
    // «пока не закроется»: цикл с условием прошёл бы и на menu, который никогда не
    // закрывается, если бы проверка была на отсутствии изменений.
    const closed = [];
    for (const step of ['четвёртый', 'третий', 'второй', 'первый']) {
      await page.keyboard.press('Escape');
      const after = await readMenu(page);
      closed.push(`${step}:${after.openCount}`);
    }
    expect(closed).toEqual(['четвёртый:3', 'третий:2', 'второй:1', 'первый:0']);
    const after = await readMenu(page);
    expect(after.openCount, 'всё закрыто').toBe(0);
    expect(expandedLabels(after), 'отметок развёрнутости не осталось').toEqual([]);
  });

  test('отключённый пункт-владелец не открывает подменю ни одним способом', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const deafId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Глухой');
    });
    // Адреса подменю у отключённого владельца нет вовсе — признака подменю у него
    // нет, а значит нечего и открывать. Именно это и отличает его от соседа с
    // непустым подменю.
    expect(deafId, 'у отключённого владельца нет `aria-owns`').toBeNull();

    // Наведение: подписки на показ у отключённого пункта нет, и задержка не
    // проходит мимо отсутствия подписки.
    await hoverItem(page, 'Глухой');
    await page.clock.fastForward(OPEN_GRACE_MS * 2);
    expect((await readMenu(page)).openCount, 'наведение не открыло').toBe(1);

    // Нажатие: `pointerdown` у отключённого пункта не подписан, поэтому обхода
    // задержки не происходит.
    await page.mouse.down();
    expect((await readMenu(page)).openCount, 'нажатие не открыло').toBe(1);
    await page.mouse.up();

    // Клик: обработчик активации отсекает пункт по доступности раньше проверки
    // подменю, поэтому ни подменю, ни действие.
    const afterClick = await readMenu(page);
    expect(afterClick.log, 'действие отключённого пункта не выполнено').toEqual([]);
    expect(afterClick.openCount, 'клик не открыл').toBe(1);

    // Клавиатура: полный обход уровня не делает отключённый пункт активным, и
    // `ArrowRight`/`Enter` до него не доходят. Без обхода утверждение было бы
    // нечем отличить «не открылось» от «недостижимо».
    for (const key of ['End', 'ArrowDown', 'Home', 'ArrowUp']) {
      await page.keyboard.press(key);
    }
    const walked = await readMenu(page);
    expect(walked.openCount, 'обход уровня не открыл подменю').toBe(1);
    expect(walked.focusLabel, 'фокус ни разу не встал на отключённого').not.toBe('Глухой');
    await page.keyboard.press('ArrowRight');
    expect((await readMenu(page)).openCount, '`ArrowRight` не открыл').toBe(1);

    // Контроль живости: сосед с непустым подменю в том же уровне наведением
    // открывается. Без него всё вышеперечисленное проходило бы на уровне, где
    // подменю не открывает никто.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    expect((await readMenu(page)).openCount, 'доступный владелец открывается').toBe(2);
  });

  test('отключённый пункт с подменю не выглядит владельцем', async ({ page }) => {
    const owners = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return {
        live: scope.__mc.ownersOf(true),
        deaf: scope.__mc.ownersOf(false),
      };
    });

    // Признаки владельца снимаются одним условием, поэтому у отключённого пункта с
    // непустым подменю их нет все четыре, а `hasSubmenu` равен `false`. Обе
    // половины в одном снимке: разница между ними и есть предмет кейса.
    expect(owners.deaf.hasSubmenu, 'отключённый пункт не владелец').toBe(false);
    expect(owners.deaf.focusable, 'отключённый пункт вне цикла роуминга').toBe(false);
    expect(owners.deaf.owns, 'нет `aria-owns`').toBeNull();
    expect(owners.deaf.haspopup, 'нет `aria-haspopup`').toBeNull();
    expect(owners.deaf.chevron, 'нет `data-chevron`').toBeNull();
    expect(owners.deaf.chevrons, 'нет узла шеврона').toBe(0);

    expect(owners.live.hasSubmenu, 'доступный пункт с подменю — владелец').toBe(true);
    expect(owners.live.focusable).toBe(true);
    expect(owners.live.owns, 'есть `aria-owns`').not.toBeNull();
    expect(owners.live.haspopup, 'есть `aria-haspopup`').toBe('menu');
    expect(owners.live.chevron, 'есть `data-chevron`').toBe('right');
    expect(owners.live.chevrons, 'есть узел шеврона').toBe(1);
  });

  test('отключённый пункт с подменю не похож на владельца и в живом меню', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const after = await readMenu(page);

    // То же в разметке живого меню: набор пунктов здесь другой, чем у рендер-пробы,
    // и «нет признаков» должно читаться с показанного меню, а не с отдельного
    // вызова рендера.
    const deaf = itemOf(after, 'Глухой');
    expect(deaf.owns, 'нет `aria-owns`').toBeNull();
    expect(deaf.haspopup, 'нет `aria-haspopup`').toBeNull();
    expect(deaf.chevron, 'нет `data-chevron`').toBeNull();
    expect(deaf.chevrons, 'нет узла шеврона').toBe(0);

    // Контроль: сосед с непустым подменю и без `disabled` сохраняет все признаки.
    const exportItem = itemOf(after, 'Экспорт');
    expect(exportItem.owns, 'есть `aria-owns`').not.toBeNull();
    expect(exportItem.haspopup, 'есть `aria-haspopup`').toBe('menu');
    expect(exportItem.chevron, 'есть `data-chevron`').toBe('right');
    expect(exportItem.chevrons, 'есть узел шеврона').toBe(1);
  });

  test('подменю не пересоздаётся при повторном наведении на тот же пункт', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(exportId, 'адрес подменю «Экспорта» назван').not.toBeNull();

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const first = await readMenu(page);
    expect(isOpen(first, exportId), 'подменю открыто').toBe(true);
    // Уровень, который не показан, лежит отцепленным узлом и в разметке не виден —
    // поэтому «тот же уровень» читается по `id`, а не по наличию узла в документе.
    expect(first.levels.length, 'заведённые, но не показанные уровни в документе не лежат').toBe(2);

    // Показ поверх открытого подменю: `open()` начинает полный цикл — уровни гаснут
    // на месте, в Top Layer, — и подменю прежней постановки обязано уйти вместе с
    // ними: оно привязано к прямоугольнику пункта, которого на новом месте уже нет.
    // Без обнуления цепочки оно осталось бы висеть, и все дальнейшие утверждения
    // проверяли бы «тот же уровень» на висящем подменю.
    await openAt(page, OPEN_FAR);
    const moved = await readMenu(page);
    expect(isOpen(moved, exportId), 'подменю прежней постановки скрыто').toBe(false);
    expect(moved.openCount, 'открыт только корень').toBe(1);
    expect(expandedLabels(moved), 'отметка развёрнутости снята').toEqual([]);

    // Уход в сторону и обратно. Уровень при этом скрывается, но не пересоздаётся:
    // идентичность уровня задаёт пара «родитель, владелец», и новый уровень получил
    // бы новый `id`.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'Заметки');
    await page.clock.fastForward(CLOSE_GRACE_MS);
    expect(isOpen(await readMenu(page), exportId), 'подменю закрылось').toBe(false);
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const again = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(again, 'id подменю после скрытия прежний').toBe(exportId);
    expect(isOpen(await readMenu(page), exportId), 'подменю снова открыто тем же уровнем').toBe(true);

    // И полный `close()` с последующим показом: закрытие уровни не уничтожает его,
    // поэтому тот же `id` обязан вернуться и здесь.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.close();
    });
    await openAt(page, OPEN_MIDDLE);
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const afterReopen = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(afterReopen, 'id подменю после полного close() прежний').toBe(exportId);
    const final = await readMenu(page);
    expect(isOpen(final, exportId), 'подменю открыто после переоткрытия меню').toBe(true);
    expect(final.openCount, 'открыты корень и одно подменю').toBe(2);
  });

  test('aria-expanded возвращается в false после закрытия подменю', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(exportId, 'адрес подменю «Экспорта» назван').not.toBeNull();

    // Цепочка из трёх уровней: корень, «Экспорт», «PNG». Переход на соседний пункт
    // уровня «Экспорт» закрывает подменю «PNG» — вот чей владелец теряет отметку.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const innerIds = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return {
        png: scope.__mc.submenuIdOf('PNG'),
        download: scope.__mc.submenuIdOf('Скачать'),
      };
    });
    expect(innerIds.png, 'адрес подменю «PNG» назван').not.toBeNull();
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(isOpen(opened, innerIds.png), 'подменю «PNG» открыто').toBe(true);
    expect(expandedLabels(opened), 'оба владельца развёрнуты').toEqual(
      ['PNG', 'Экспорт'].sort(),
    );

    await hoverItem(page, 'Скачать');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const after = await readMenu(page);
    expect(isOpen(after, innerIds.png), 'подменю прежнего владельца скрыто').toBe(false);
    expect(isOpen(after, innerIds.download), 'подменю нового владельца открыто').toBe(true);
    // Слой снимает отметку, а не пишет `"false"`: у закрытого подменю состояния
    // «развёрнуто» нет, и `aria-haspopup` остаётся единственным верным признаком
    // того, что подменю есть.
    expect(itemOf(after, 'PNG').expanded, 'отметка снята с прежнего владельца').toBeNull();
    expect(itemOf(after, 'PNG').haspopup, 'признак наличия подменю остался').toBe('menu');
    // Обрезка не должна уносить предков: «Экспорт» — родитель обоих уровней, и его
    // подменю на месте. Усечение не по глубже, а по всей ветке унесло бы и его.
    expect(isOpen(after, exportId), 'подменю предка осталось открытым').toBe(true);
    expect(itemOf(after, 'Экспорт').expanded, 'предок по-прежнему развёрнут').toBe('true');
    expect(
      expandedLabels(after),
      'развёрнуты «Экспорт» и «Скачать», «PNG» — нет',
    ).toEqual(['Скачать', 'Экспорт'].sort());
  });

  test('aria-expanded у всех владельцев равен false при полном close()', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    // Контроль: до `close()` развёрнуты оба владельца, иначе «после — ни одного» не
    // отличалось бы от «их и не было».
    expect(expandedLabels(await readMenu(page)), 'оба владельца развёрнуты').toEqual(
      ['PNG', 'Экспорт'].sort(),
    );

    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.close();
    });

    const after = await readMenu(page);
    expect(after.openCount, 'меню закрыто целиком').toBe(0);
    expect(expandedLabels(after), 'ни одного развёрнутого владельца').toEqual([]);
    const owners = after.levels.flatMap((level) => {
      return level.items.filter((item) => {
        return item.haspopup === 'menu';
      });
    });
    expect(owners.length, 'владельцы в разметке остались').toBeGreaterThan(0);
    for (const owner of owners) {
      expect(owner.expanded, `у владельца «${owner.label}» отметки нет`).toBeNull();
    }
    expect(after.log, 'ни одно действие не вызвано').toEqual([]);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });
});
