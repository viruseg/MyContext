import { expect, test } from '@playwright/test';
import { OPEN_GRACE_MS, SAFETY_PADDING, SUBMENU_OFFSET } from '../../src/constants.js';

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
 * **`reducedMotion: 'reduce'` убирает отложенное закрытие уровня.** Слой под `reduce`
 * вызывает `hidePopover()` сразу, а не через `animationDuration`, поэтому
 * «подменю закрылось» читается в том же снимке, в котором оно закрылось, и ни
 * один кейс не ждёт анимацию. Задержка открытия подменю при этом остаётся
 * настоящей — она у `hoverIntent`, а не у слоя, и её кейсы гоняют часами.
 *
 * **Закрытия подменю по уходу курсора не существует вовсе.** Состояние подменю
 * принадлежит активному пункту родительского уровня: переход на соседний пункт
 * закрывает прежнее подменю, а уход курсора в нейтральную область — нет. Поэтому
 * часы здесь двигают только вперёд, а «ничего не произошло» проверяется ожиданием
 * втрое больше прежнего срока закрытия: таймера, который мог бы сработать, нет.
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
 * @property {string | null} disabled `aria-disabled`.
 * @property {string | null} tabindex `tabindex` пункта: `"0"` у доступного, `"-1"`
 *   у невыбираемого. Читается с узла, потому что в кольцо роуминга попадает ровно
 *   то, у кого он нулевой.
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
 * @property {boolean} focusInMenu фокус стоит внутри дерева меню. Отдельное поле,
 *   а не вывод из `focusLabel`: подпись есть только у пунктов, и фокус на самом
 *   уровне от неё неотличим от фокуса на `<body>` — а это разные состояния, и
 *   меню на втором не отвечает на клавиши вовсе.
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
 * @property {(index: number, enabled: boolean) => void} setNestedAvailability то же
 *   для пункта внутри подменю набора `nested`: там правка невозможна иначе,
 *   потому что `submenuAction` отдаёт наружу тот же массив.
 * @property {(enabled: boolean) => OwnerProbe} ownersOf
 * @property {() => string[]} toggles переключения Top Layer по уровням в виде
 *   «`id` уровня:`newState`». Снимок `toggle` различает «меню переехало» и «меню
 *   на мгновение исчезло и вернулось»: конечное состояние у обоих одинаково, а
 *   второе и есть мигание, невидимое ни в одном снимке разметки.
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
     * Подменю набора `nested` лежит в отдельном массиве, а не собирается в
     * `submenuAction`: кейсу о перечитывании нужно выключить пункт **внутри** уже
     * построенного подменю между двумя его показами, а свежий массив на каждый
     * вызов дал бы новые пункты, к которым правка и не относилась бы.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const nestedItems = [
      { labelAction: () => 'Лист', action: () => log.push('лист') },
    ];

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
      nested: [
        { labelAction: () => 'Владелец', submenuAction: () => nestedItems },
      ],
      tree: [
        { labelAction: () => 'Новый', action: () => log.push('новый') },
        {
          labelAction: () => 'Экспорт',
          submenuAction: () => [
            { labelAction: () => 'PDF', action: () => log.push('pdf') },
            { labelAction: () => 'PNG', submenuAction: () => [{ labelAction: () => 'Один', submenuAction: () => [{ labelAction: () => 'Глубоко' }] }] },
            {
              labelAction: () => 'Скачать',
              submenuAction: () => [
                { labelAction: () => 'Архив' },
                { labelAction: () => 'Образ' },
              ],
              action: () => log.push('скачать'),
            },
            { labelAction: () => 'Значок Windows' },
          ],
          action: () => log.push('экспорт'),
        },
        {
          labelAction: () => 'Глухой',
          isEnabledAction: () => false,
          submenuAction: () => [{ labelAction: () => 'Под глухим' }],
          action: () => log.push('глухой'),
        },
        { labelAction: () => 'Без подменю', action: () => log.push('без подменю') },
        { labelAction: () => 'Заметки', action: () => log.push('заметки') },
      ],
      // Два владельца на одном уровне и больше ничего. Кейс про отключённого
      // между показами владельца держит подменю второго открытым, пока курсор
      // стоит на первом, — а без второго владельца закрывать было бы нечего и
      // проверять было бы не на что.
      pair: [
        { labelAction: () => 'Первый', submenuAction: () => [{ labelAction: () => 'Под первым' }] },
        { labelAction: () => 'Второй', submenuAction: () => [{ labelAction: () => 'Под вторым' }] },
      ],
      // Обе невыбираемые строки на одном уровне: разделитель и отключённый пункт.
      // В `tree` отключённый пункт есть, а разделителя нет, и наоборот; кейс о
      // невыбираемых строках ловит обе границы разом, поэтому набор свой.
      // Подменю у «Второго» — ради кейса о фокусе: закрываемый по наведению на
      // отключённый пункт уровень уносит фокус с собой, и удержать его может только
      // подменю, открытое с него.
      unselectable: [
        { labelAction: () => 'Живой' },
        { labelAction: () => 'Глухой', isEnabledAction: () => false },
        { type: 'separator' },
        {
          labelAction: () => 'Второй',
          submenuAction: () => [{ labelAction: () => 'Под вторым' }],
        },
      ],
      // Владелец с подменю длиннее списка: только у прокручиваемого уровня видны
      // зоны прокрутки, а кейс о нейтральных областях должен наводить на видимую
      // зону — наведение на скрытый узел не проверяет ничего.
      scrollable: [
        {
          labelAction: () => 'Длинное',
          submenuAction: () => Array.from({ length: 40 }, (_unused, index) => {
            return { labelAction: () => `Пункт ${index + 1}` };
          }),
        },
      ],
    };

    /** @type {string[]} */
    const log = [];
    /** @type {string[]} */
    const errors = [];
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });

    // Журнал входа и выхода уровней из Top Layer. Слушатель в capture на документе,
    // а не всплывающий: `toggle` адресован самому уровню, и журнал должен увидеть
    // его независимо от того, всплывает ли событие.
    /** @type {string[]} */
    const toggles = [];
    document.addEventListener('toggle', (event) => {
      const target = event.target;
      const row = 'newState' in event ? String(/** @type {{ newState: unknown }} */ (event).newState) : '?';
      toggles.push(`${target instanceof Element ? target.id : '?'}:${row}`);
    }, true);

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
        disabled: item.getAttribute('aria-disabled'),
        tabindex: item.getAttribute('tabindex'),
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
        focusInMenu: active !== null && active.closest('.vc-menu') !== null,
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
      setNestedAvailability(index, enabled) {
        const item = nestedItems[index];
        if (item === undefined || 'type' in item) {
          throw new Error('в подменю нет такого пункта');
        }
        // Предикат вешается на живом объекте: правка обязана дойти до уже
        // построенного уровня, минуя перестроение.
        item.isEnabledAction = () => enabled;
      },
      toggles() {
        return toggles.slice();
      },
      ownersOf(enabled) {
        // Рендер вызывается на тех же данных, что и меню: подменю непустое, и
        // единственное различие между двумя пунктами — ответ предиката.
        const items = [{
          labelAction: () => 'Владелец',
          submenuAction: () => [{ labelAction: () => 'Лист' }],
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

test.describe('правило соседа', () => {
  test('переход на соседнего пункта без подменю закрывает подменю', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(exportId, 'адрес подменю «Экспорта» назван').not.toBeNull();
    const submenuId = /** @type {string} */ (exportId);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    // Контроль состояния: «закрылось» ниже имеет смысл, только если до перехода
    // подменю было открыто.
    expect(isOpen(await readMenu(page), submenuId), 'подменю открыто').toBe(true);

    // «Новый» — сосед «Экспорта» в корне, и подменю у него нет. Переход на него и
    // есть то единственное событие, которое уводит подменю: часы стоят, и ни
    // миллиметра времени не прошло, то есть закрытие мгновенное.
    await hoverItem(page, 'Новый');

    const after = await readMenu(page);
    expect(isOpen(after, submenuId), 'подменю закрылось').toBe(false);
    expect(after.openCount, 'остался корень').toBe(1);
    expect(expandedLabels(after), 'отметка развёрнутости снята').toEqual([]);
    // Активным остался ровно сосед: состояние уровня перешло на него целиком, и
    // уехавший владелец подсветки не удерживает.
    expect(activeLabels(after), 'активен сосед, а не прежний владелец').toEqual(['Новый']);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('переход на соседнего владельца закрывает прежнее и открывает новое', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(exportId, 'адрес подменю «Экспорта» назван').not.toBeNull();
    const submenuId = /** @type {string} */ (exportId);

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

    // Цепочка из трёх уровней, чтобы было видно, что уносится вся ветка: переход
    // на соседа внутри подменю «Экспорта» закрывает подменю «PNG» и открывает
    // подменю «Скачать», а уровень «Экспорта» остаётся — он не закрываемый, а
    // родитель перехода.
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    expect((await readMenu(page)).openCount, 'открыты корень и два подменю').toBe(3);

    await hoverItem(page, 'Скачать');
    // Мгновенная часть перехода: прежнее подменю ушло, новое ещё не открыто —
    // до него 250 мс. Оба состояния различимы, потому что часы стоят.
    const midway = await readMenu(page);
    expect(isOpen(midway, /** @type {string} */ (innerIds.png)), 'подменю «PNG» закрыто сразу').toBe(false);
    expect(
      isOpen(midway, /** @type {string} */ (innerIds.download)),
      'подменю «Скачать» ещё не открыто',
    ).toBe(false);
    expect(isOpen(midway, submenuId), 'уровень «Экспорта» остался открытым').toBe(true);

    await page.clock.fastForward(OPEN_GRACE_MS);
    const after = await readMenu(page);
    expect(isOpen(after, /** @type {string} */ (innerIds.download)), 'подменю нового владельца открыто')
      .toBe(true);
    expect(after.openCount, 'открыты корень, «Экспорт» и «Скачать»').toBe(3);
    expect(expandedLabels(after).sort(), 'развёрнуты «Экспорт» и «Скачать»')
      .toEqual(['Скачать', 'Экспорт']);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('переход на соседа в корне уносит всю ветку подменю', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(exportId, 'адрес подменю «Экспорта» назван').not.toBeNull();
    const submenuId = /** @type {string} */ (exportId);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const innerIds = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('PNG');
    });
    expect(innerIds, 'адрес подменю «PNG» назван').not.toBeNull();
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const deep = await readMenu(page);
    expect(deep.openCount, 'открыты корень и два подменю').toBe(3);
    expect(isOpen(deep, /** @type {string} */ (innerIds)), 'подменю «PNG» открыто').toBe(true);

    // Переход на соседа в корне — на два уровня выше «PNG». Закрыться обязана вся
    // ветка: унести только глубочайший уровень значило бы оставить подменю
    // «Экспорта» висеть поверх пункта, который больше не выбран.
    await hoverItem(page, 'Заметки');

    const after = await readMenu(page);
    expect(isOpen(after, /** @type {string} */ (innerIds)), 'глубочайшее подменю ушло').toBe(false);
    expect(isOpen(after, submenuId), 'подменю «Экспорта» ушло вместе с ним').toBe(false);
    expect(after.openCount, 'остался корень').toBe(1);
    expect(expandedLabels(after), 'отметок развёрнутости не осталось').toEqual([]);
  });

  test('наведение на отключённого соседа закрывает подменю и снимает выделение', async ({ page }) => {
    await makeMenu(page, 'pair', 'surface');
    await openAt(page, OPEN_MIDDLE);
    // Владелец за один показ успевает встать в карту подписок уровня. Отключение
    // между показами обязано оттуда выйти: у отключённого пункта нет ни подсветки,
    // ни подписки, и наведение на него решает ровно одно — что выбранного пункта
    // у уровня больше нет. Подменю открытого соседа с этого момента тоже не
    // принадлежит никому: держать его на серой строке значило бы оставить меню в
    // состоянии, которого нет.
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
    const secondId = /** @type {string} */ (second);

    await hoverItem(page, 'Второй');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(isOpen(opened, secondId), 'подменю второго открыто').toBe(true);
    // Контроль премиссы: отключённый владелец не помечается развёрнутым.
    expect(itemOf(opened, 'Первый').expanded, 'отметки развёрнутости нет').toBeNull();
    expect(activeLabels(opened), 'выделен владелец').toEqual(['Второй']);

    // Премисса наведения: `pointermove` по отключённому пункту доходит до уровня и
    // не отмечает его, как и любой другой невыбираемый, — значит точка действительно
    // лежит на пункте, а не пролетела мимо. Без этой проверки кейс прошёл бы и на
    // уровне, где наведение не достаёт до пункта вовсе, и «сбросило» ничего бы не
    // значило.
    const landed = await page.evaluate(() => {
      const item = Array.from(document.querySelectorAll('.vc-item')).find((node) => {
        return node.querySelector('.vc-label')?.textContent === 'Первый';
      });
      if (item === undefined) {
        throw new Error('пункта «Первый» нет в разметке');
      }
      const rect = item.getBoundingClientRect();
      return { active: item.hasAttribute('data-active'), height: rect.height };
    });
    expect(landed.height, 'пункт виден и имеет высоту').toBeGreaterThan(1);
    expect(landed.active, 'отключённый пункт не отмечен роумингом').toBe(false);

    await hoverItem(page, 'Первый');
    // Втрое больше прежнего срока закрытия: таймера нет, и ждать тут нечего.
    await page.clock.fastForward(3000);

    const after = await readMenu(page);
    expect(isOpen(after, secondId), 'подменю второго закрыто').toBe(false);
    expect(after.openCount, 'остался корень').toBe(1);
    // Отметок не осталось ни на ком: у отключённого пункта их быть не может по
    // построению, а отметка соседа значила бы «подменю раскрыто» — а оно только
    // что закрылось.
    expect(activeLabels(after), 'выделение снято').toEqual([]);
    expect(expandedLabels(after), 'отметок развёрнутости не осталось').toEqual([]);
    // Фокус отошёл на сам уровень: активного пункта у уровня больше нет, и клавиши
    // адресуются уровню, а не призрачному выбору.
    expect(after.focusLabel, 'фокус не на пункте').toBe(null);
    expect(after.focusInMenu, 'фокус остался в меню').toBe(true);

    // Контроль живости: после сброса клавиши работают, и первым доступным пунктом
    // становится «Второй» — отключённый «Первый» в кольцо роуминга не входит.
    await page.keyboard.press('ArrowDown');
    const afterKey = await readMenu(page);
    expect(afterKey.focusLabel, 'первым доступным встал «Второй»').toBe('Второй');
    expect(activeLabels(afterKey), 'выделен «Второй»').toEqual(['Второй']);
    expect(afterKey.openCount, 'подменю само не открылось').toBe(1);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('наведение на отключённый пункт уводит фокус с закрываемого подменю', async ({ page }) => {
    await makeMenu(page, 'unselectable', 'surface');
    await openAt(page, OPEN_MIDDLE);

    // Подменю открыто клавиатурой, и фокус уехал в него — единственный способ
    // остаться там, потому что мышиный показ фокус с владельца не снимает.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    const opened = await readMenu(page);
    expect(opened.openCount, 'подменю «Второго» открыто').toBe(2);
    const inner = /** @type {LevelView | undefined} */ (opened.levels[1]);
    expect(inner?.items.map((item) => {
      return item.label;
    }), 'в подменю один пункт').toEqual(['Под вторым']);
    expect(opened.focusLabel, 'фокус в подменю').toBe('Под вторым');

    // Курсор уходит на отключённый пункт того же уровня. Скрываемый уровень уносит
    // фокус с собой: под `reduce` `hidePopover()` мгновенный, и без переноса фокус
    // упал бы на `<body>` — меню осталось бы на экране и перестало отвечать на
    // клавиши. Перенос обязателен до скрытия, а не после: отложенный выход из Top
    // Layer унёс бы фокус уже тогда, когда меню считает, что всё в порядке.
    await hoverItem(page, 'Глухой');
    const after = await readMenu(page);
    expect(after.openCount, 'подменю закрыто').toBe(1);
    expect(after.focusInMenu, 'фокус ушёл на уровень, а не на `<body>`').toBe(true);
    expect(after.focusLabel, 'фокус на уровне, а не на пункте').toBe(null);

    // Контроль живости: клавиша после сброса доходит до глубже несущего уровня, то
    // есть до корня, — и там, где фокус упал бы на `<body>`, дошла бы до страницы.
    await page.keyboard.press('ArrowDown');
    const afterKey = await readMenu(page);
    expect(afterKey.focusLabel, 'клавиша дошла до меню').toBe('Живой');
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('уход в нейтральную область не закрывает подменю', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(exportId, 'адрес подменю «Экспорта» назван').not.toBeNull();
    const submenuId = /** @type {string} */ (exportId);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(isOpen(opened, submenuId), 'подменю открыто').toBe(true);
    expect(opened.openCount, 'открыты корень и подменю').toBe(2);
    expect(activeLabels(opened), 'владелец отмечен').toEqual(['Экспорт']);

    // Три точки по очереди, все — вне меню и все без намерения что-либо
    // выбрать: пустота страницы под меню, пустота страницы над ним и угол вьюпорта
    // в стороне от обоих уровней. Ни одна из них не должна увести подменю:
    // единственное событие, которое его закрывает, — вход в соседний пункт того же
    // уровня. Привязанный контейнер отдельной точкой не проверяется: `#surface`
    // занимает весь вьюпорт, и любая из трёх точек лежит на нём — покрытие есть,
    // просто отдельным наведением оно не отличить от прочих.
    const voidBelow = await page.evaluate((id) => {
      const level = document.getElementById(id);
      if (level === null) {
        throw new Error('подменю показано, но узла нет');
      }
      return { x: level.getBoundingClientRect().left + 4, y: globalThis.innerHeight - 40 };
    }, submenuId);
    const voidAbove = { x: voidBelow.x, y: 6 };
    const farCorner = { x: 960, y: 660 };

    for (const point of [voidBelow, voidAbove, farCorner]) {
      await moveTo(page, point);
      // Втрое больше прежнего срока закрытия подменю: такого таймера не осталось,
      // и ожидание лишь доказывает, что подменю не гаснет само по себе.
      await page.clock.fastForward(3000);
      const snapshot = await readMenu(page);
      expect(isOpen(snapshot, submenuId), `подменю цело в точке ${point.x}:${point.y}`).toBe(true);
      expect(snapshot.openCount, `открыты корень и подменю в точке ${point.x}:${point.y}`).toBe(2);
      expect(snapshot.errors, 'ошибок страницы нет').toEqual([]);
    }
    // Уход курсора снимает отметку последнего открытого уровня, а не всей цепочки.
    // Здесь отмечен только корень, и отметка на владельце переживает уход: она
    // означает «подменю раскрыто», а не «курсор стоит на этом пункте». Подменю от
    // неё не зависит и остаётся на месте.
    expect(activeLabels(await readMenu(page)), 'у владельца отметка раскрытия осталась').toEqual(['Экспорт']);
    expect(expandedLabels(await readMenu(page)), 'владелец всё ещё развёрнут').toEqual(['Экспорт']);
  });

  test('уход на зону прокрутки и на поля каркаса не закрывает подменю', async ({ page }) => {
    // Набор `scrollable` — единственный с подменю длиннее списка, то есть с
    // видимыми зонами. Вьюпорт остаётся общим: подменю здесь и не прижимается, а
    // проверяется не геометрия показа.
    await makeMenu(page, 'scrollable', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Длинное');
    });
    expect(ownerId, 'адрес подменю «Длинного» назван').not.toBeNull();
    const submenuId = /** @type {string} */ (ownerId);

    await hoverItem(page, 'Длинное');
    await page.clock.fastForward(OPEN_GRACE_MS);
    expect(isOpen(await readMenu(page), submenuId), 'подменю открыто').toBe(true);
    // Премисса: зоны показываются только у прокручиваемого уровня, и без неё кейс
    // наводил бы на невидимый узел, а наведение на невидимое ничего не проверяет.
    const zoneVisible = await page.evaluate((id) => {
      const zone = document.querySelector(`#${id} .vc-scroll-zone-down`);
      return zone === null ? null : globalThis.getComputedStyle(zone).display;
    }, submenuId);
    expect(zoneVisible, 'нижняя зона показана').toBe('flex');

    // Зона прокрутки — часть меню, и курсор на ней не выбирает ничего. Сначала
    // на пункте подменю, чтобы сбросу на зоне было что снимать: зона принадлежит
    // своему уровню, и отметка чужого уровня под сброс не попадает.
    await hoverItem(page, 'Пункт 20');
    const onItem = await readMenu(page);
    expect(activeLabels(onItem).sort(), 'отмечены владелец и пункт подменю')
      .toEqual(['Длинное', 'Пункт 20']);
    await hoverNode(page, `#${submenuId} .vc-scroll-zone-down`);
    await page.clock.fastForward(3000);
    const onZone = await readMenu(page);
    expect(isOpen(onZone, submenuId), 'подменю цело на зоне прокрутки').toBe(true);
    // Отметка пункта подменю снята: подсветкой горел бы тот, кого никто не выбирал.
    // Отметка владельца на корне осталась — она означает «подменю раскрыто», и по
    // ней видно, чьё подменю открыто. На подменю это не влияет.
    expect(activeLabels(onZone), 'снята только отметка своего уровня').toEqual(['Длинное']);

    // Поля каркаса между зоной и рамкой: там нет ни пункта, ни зоны.
    const frame = await page.evaluate((id) => {
      const element = document.getElementById(id);
      if (element === null) {
        throw new Error('подменю показано, но узла нет');
      }
      const rect = element.getBoundingClientRect();
      return { x: rect.left + 2, y: rect.top + rect.height - 3 };
    }, submenuId);
    await moveTo(page, frame);
    await page.clock.fastForward(3000);
    const onFrame = await readMenu(page);
    expect(isOpen(onFrame, submenuId), 'подменю цело на полях каркаса').toBe(true);
    expect(onFrame.openCount, 'открыты корень и подменю').toBe(2);
    expect(onFrame.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('возврат курсора на владельца открытого подменю не мигает подменю', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const submenuId = /** @type {string} */ (await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    }));
    expect(submenuId, 'адрес подменю «Экспорта» назван').not.toBeNull();

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'PDF');
    const opened = await readMenu(page);
    expect(isOpen(opened, submenuId), 'подменю открыто').toBe(true);
    expect(activeLabels(opened).sort(), 'отмечены владелец и пункт подменю')
      .toEqual(['PDF', 'Экспорт']);
    // Отметка с момента показа подменю: дальше она обязана не меняться. Журнал
    // Top Layer, а не снимок разметки: мигание — это выход и вход подменю между
    // двумя кадрами, и в снимке после него видно ровно то же самое состояние.
    const before = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.toggles();
    });

    // Возврат на владельца собственного открытого подменю: состояние не меняется,
    // поэтому планировать показ нечего. Без этого входа показ планировался бы
    // заново, и через `OPEN_GRACE_MS` `#openSubmenu` обрезал бы цепочку до корня —
    // то есть спрятал бы подменю, ради которого курсор и вернулся, и показал его
    // снова.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS * 2);
    const after = await readMenu(page);
    const toggles = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.toggles();
    });
    expect(toggles, 'уровень не уходил из Top Layer и не возвращался').toEqual(before);
    expect(isOpen(after, submenuId), 'подменю то же самое и открыто').toBe(true);
    expect(after.openCount, 'открыты корень и подменю').toBe(2);
    // Подсветка внутри подменю переживает возврат на владельца: активным пунктом
    // корня он так и остался, и его подменю — тоже.
    expect(activeLabels(after).sort(), 'отметки не тронуты').toEqual(['PDF', 'Экспорт']);
    // Фокус, наоборот, уходит владельцу: он встаёт на курсор, и без этого клавиши
    // поехали бы по подменю, которое пользователь покинул.
    expect(after.focusLabel, 'фокус на владельце').toBe('Экспорт');
    expect(expandedLabels(after), 'владелец развёрнут').toEqual(['Экспорт']);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('возврат курсора на владельца, чьё подменю закрыто Escape, открывает его заново', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(exportId, 'адрес подменю «Экспорта» назван').not.toBeNull();
    const submenuId = /** @type {string} */ (exportId);

    // Цепочка из трёх уровней с клавиатуры: до «Экспорта» два шага вниз, в его
    // подменю — один, до «PNG».
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    const pngId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('PNG');
    });
    expect(pngId, 'адрес подменю «PNG» назван').not.toBeNull();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    expect((await readMenu(page)).openCount, 'открыты корень и два подменю').toBe(3);

    // `Escape` закрывает уровень, где стоит фокус, — самый глубокий.
    await page.keyboard.press('Escape');
    const closed = await readMenu(page);
    expect(isOpen(closed, /** @type {string} */ (pngId)), 'подменю «PNG» закрыто').toBe(false);
    expect(closed.openCount, 'остались корень и подменю «Экспорта»').toBe(2);

    // Возврат мышью на владельца, чьё подменю только что закрыли: уход курсора с
    // пункта не отменяет закрытие, а новый вход в пункт планирует показ заново.
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const after = await readMenu(page);
    expect(isOpen(after, /** @type {string} */ (pngId)), 'подменю «PNG» открылось заново').toBe(true);
    expect(after.openCount, 'снова открыты корень и два подменю').toBe(3);
    expect(expandedLabels(after), 'развёрнуты «Экспорт» и «PNG»').toEqual(['PNG', 'Экспорт'].sort());
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
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
    await hoverItem(page, 'Без подменю');
    const hovered = await readMenu(page);
    // Отметка ровно одна, и она на том пункте, где курсор: два писателя выделения
    // дали бы подсветку сразу на двух пунктах.
    expect(activeLabels(hovered), 'отмечен только пункт под курсором').toEqual(['Без подменю']);
    expect(itemOf(hovered, 'Без подменю').active).toBe(true);
    // Фокус ушёл за отметкой: клавиши достаются уровню, где стоит фокус, и без
    // этого стрелка считала бы от края уровня, а не от пункта, который
    // пользователь видит отмеченным.
    expect(hovered.focusLabel, 'фокус на пункте под курсором').toBe('Без подменю');
    // Наведение на пункт без submenuAction не открывает ничего: владельцем он не
    // является, и уровня за ним нет.
    expect(hovered.openCount, 'наведение ничего не открыло').toBe(1);

    // Клавиша приходит на пункт под курсором и считает следующий от него, а не от
    // края: после пункта без подменю в наборе идёт «Заметки», а от края стрелка дала бы
    // «Новый».
    await page.keyboard.press('ArrowDown');
    const afterKey = await readMenu(page);
    expect(activeLabels(afterKey), 'стрелка увела выделение с пункта под курсором').toEqual(['Заметки']);
    expect(afterKey.focusLabel).toBe('Заметки');
  });

  test('стрелка после мышиного открытия выделяет пункт подменю, а не родительского уровня', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);

    // Сценарий целиком: подменю открыто мышью, курсор остаётся над пунктом
    // основного меню, который его открыл, и первая же стрелка с клавиатуры.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(opened.openCount, 'подменю открыто').toBe(2);
    // Показ мышью фокус с владельца не увёл: он остался в родительском уровне, и
    // поэтому уровень, из которого придёт клавиша, — не тот, на который она должна
    // подействовать. Без этой проверки тест проходил бы и без нового правила.
    expect(opened.focusLabel, 'фокус на владельце').toBe('Экспорт');
    expect(activeLabels(opened), 'отмечен только владелец').toEqual(['Экспорт']);

    await page.keyboard.press('ArrowDown');
    const afterKey = await readMenu(page);
    // Выделение ушло в подменю — оно открыто последним и потому главнее, — а
    // отметка владельца осталась: она означает «подменю раскрыто», а не «курсор
    // стоит здесь».
    expect(activeLabels(afterKey).sort(), 'выделены владелец и первый пункт подменю')
      .toEqual(['PDF', 'Экспорт']);
    expect(afterKey.focusLabel, 'фокус ушёл в подменю').toBe('PDF');
    // Родительский уровень не тронут: подменю по-прежнему открыто и по-прежнему
    // принадлежит своему владельцу.
    expect(afterKey.openCount, 'оба уровня на месте').toBe(2);
    expect(expandedLabels(afterKey), 'развёрнут «Экспорт»').toEqual(['Экспорт']);
  });

  test('курсор над отключённым пунктом снимает выделение', async ({ page }) => {
    await makeMenu(page, 'unselectable', 'surface');
    await openAt(page, OPEN_MIDDLE);

    // Живой пункт под курсором: выделение есть, и дальше проверяется, что невыбираемая
    // строка его снимает, а не игнорирует.
    await hoverItem(page, 'Второй');
    const marked = await readMenu(page);
    expect(activeLabels(marked), 'отмечен пункт под курсором').toEqual(['Второй']);
    expect(marked.focusLabel, 'фокус на пункте под курсором').toBe('Второй');

    // Отключённый пункт: отметки на нём быть не может по построению, а отметка
    // предыдущего должна уйти. Иначе меню показывает выбор, которого не делали, и
    // пользователь читает серую строку как продолжение выделения — визуальная
    // блокировка, из которой нет выхода.
    await hoverItem(page, 'Глухой');
    const overDisabled = await readMenu(page);
    expect(activeLabels(overDisabled), 'выделение снято').toEqual([]);
    // Фокус встаёт на сам уровень, а не остаётся на снятом пункте: активного пункта
    // у уровня нет, и оставить фокус на неотмеченном значило бы оставить выбор,
    // которого не видно.
    expect(overDisabled.focusLabel, 'фокус не на снятом пункте').toBe(null);
    expect(overDisabled.focusInMenu, 'фокус остался в меню').toBe(true);

    // Контроль: живой пункт после невыбираемой строки выделение всё-таки ставит.
    // Без него тест проходил бы и на уровне, где выделение не двигает ничто.
    await hoverItem(page, 'Живой');
    expect(activeLabels(await readMenu(page)), 'живой пункт выделение поставил').toEqual(['Живой']);
  });

  test('курсор над разделителем выделение не сбрасывает', async ({ page }) => {
    await makeMenu(page, 'unselectable', 'surface');
    await openAt(page, OPEN_MIDDLE);

    // Разделитель высотой в один пиксель, и курсор пересекает его на каждом проходе
    // мимо. Сбросило бы здесь выделение на каждом спуске по меню, то есть мигало бы
    // постоянно, — поэтому разделитель остаётся нейтральной областью, какой и был.
    await hoverItem(page, 'Второй');
    const marked = await readMenu(page);
    expect(activeLabels(marked), 'отмечен пункт под курсором').toEqual(['Второй']);

    await hoverNode(page, '.vc-separator');
    const overSeparator = await readMenu(page);
    expect(activeLabels(overSeparator), 'разделитель выделение не сменил').toEqual(['Второй']);
    expect(overSeparator.focusLabel, 'фокус остался на живом пункте').toBe('Второй');

    // Контроль: соседняя отключённая строка выделение снимает, то есть уровень
    // различает невыбираемые строки, а не отключает сброс на всех сразу.
    await hoverItem(page, 'Глухой');
    expect(activeLabels(await readMenu(page)), 'отключённый пункт выделение снял').toEqual([]);
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

    // Прямая от пункта-владельца к нижнему крайнему пункту подменю — движение
    // через зазор между уровнями, на котором закрытия не происходит вовсе: решения
    // принимает активный пункт уровня, а на пути через зазор ни один соседний
    // пункт не посещается. Прежде здесь стояла безопасная область вокруг подменю,
    // и этот кейс держал её на прямой; теперь область нет, и проверяется другое —
    // что переход через зазор не вызывает `pointerenter` ни на чужом пункте.
    // Обе точки берутся из настоящих рамок, а `steps` действительно гонит курсор
    // по отрезку, а не прыгает в конец.
    //
    // Отправная точка — нижний правый угол владельца, а не его середина, и это
    // обязательное условие самого кейса. Прямая из середины владельца в дальний
    // угол подменю проходит по полосе соседней строки: у «Экспорта» снизу лежит
    // отключённый «Глухой», и курсор цеплял его наискось. Пока невыбираемая строка
    // была инертной, кейс проходил вопреки собственному комментарию, а теперь
    // закрывает подменю — по новому правилу и совершенно правильно. Чтобы проверять
    // зазор, а не правило соседа, отправная точка обязана выходить из владельца
    // вбок, мимо соседних строк. Само выживание подменю и есть премисса пути:
    // задел бы отрезок хоть одну строку уровня, подменю закрылось бы.
    const inset = 4;
    const owner = await page.evaluate((name) => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.rectOf(name);
    }, 'Экспорт');
    expect(owner, 'рамка владельца есть').not.toBeNull();
    const ownerRect = /** @type {MenuRect} */ (owner);
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
      // Отступ от угла обязателен: сам угол скруглённой рамки в зазор не входит,
      // и точка на нём не достала бы до пункта ни в одном движке.
      const rect = last.getBoundingClientRect();
      return { x: rect.right - input.inset, y: rect.bottom - input.inset };
    }, { id: submenuId, inset });
    await page.mouse.move(ownerRect.right - inset, ownerRect.bottom - inset);
    await page.mouse.move(far.x, far.y, { steps: 20 });
    // Втрое больше прежнего срока закрытия подменю: таймера закрытия не осталось,
    // и ждать тут нечего — ожидание лишь доказывает, что подменю не гаснет само.
    await page.clock.fastForward(3000);

    const after = await readMenu(page);
    expect(isOpen(after, submenuId), 'подменю пережило прямое движение к дальнему пункту').toBe(true);
    expect(after.openCount, 'открыты корень и подменю').toBe(2);
    expect(expandedLabels(after), 'владелец всё ещё развёрнут').toEqual(['Экспорт']);
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

  test('Escape при мышиной цепочке закрывает самое глубокое подменю, а не уровень, где фокус', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ids = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown } */ (globalThis));
      return { export: scope.__mc.submenuIdOf('Экспорт') };
    });
    expect(ids.export, 'адрес подменю «Экспорта» назван').not.toBeNull();

    // Цепочка из четырёх уровней, причём фокус ведёт мышь, а не клавиатура: показ
    // подменю мышью фокус из родительского уровня не уводит, и последнее наведение
    // оставляет фокус в самом глубоком показанном уровне.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const inner = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown } */ (globalThis));
      return { png: scope.__mc.submenuIdOf('PNG') };
    });
    expect(inner.png, 'адрес подменю «PNG» назван').not.toBeNull();
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const deep = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown } */ (globalThis));
      return { one: scope.__mc.submenuIdOf('Один') };
    });
    expect(deep.one, 'адрес подменю «Один» назван').not.toBeNull();
    await hoverItem(page, 'Один');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(opened.openCount, 'открыты четыре уровня').toBe(4);
    // Фокус на пункте «Один» — то есть в уровне «PNG», пока его собственное подменю
    // уже показано. Показ мышью фокус глубже не уводит, и это ровно то состояние,
    // в котором «Escape» закрывает не тот уровень, где стоит фокус.
    expect(opened.focusLabel, 'фокус в уровне «PNG» при показанном «Один»').toBe('Один');

    // `Escape` закрывает текущий уровень, а текущий — самый глубокий показанный, то
    // есть «Один». Уровень, где стоит фокус, под ним и остаётся: закрывать его
    // было бы увести пользователя с того, что он видит, на строку под курсором.
    await page.keyboard.press('Escape');
    const after = await readMenu(page);
    expect(isOpen(after, /** @type {string} */ (deep.one)), 'подменю «Один» закрыто').toBe(false);
    expect(isOpen(after, /** @type {string} */ (inner.png)), 'подменю «PNG» осталось').toBe(true);
    expect(isOpen(after, /** @type {string} */ (ids.export)), 'подменю «Экспорта» осталось').toBe(true);
    expect(after.openCount, 'остались корень и два подменю').toBe(3);
    expect(expandedLabels(after), 'развёрнуты «Экспорт» и «PNG»').toEqual(['PNG', 'Экспорт']);
    // Фокус ушёл на владельца закрытого уровня: он и так стоял там, но отметку
    // раскрытия закрытый уровень снял, и вернуться надо на строку, а не на страницу.
    expect(after.focusLabel, 'фокус на «Один»').toBe('Один');
    expect(after.errors, 'ошибок страницы нет').toEqual([]);

    // Второй `Escape` убирает уровень «PNG» вместе со всем, что открыто из него
    // глубже. Раньше этот случай был единственным, где закрытие среднего уровня
    // обязано было унести ветку: фокус стоял на два уровня выше, и убрать
    // подменю «Один» больше было бы некому. Теперь закрытию достаётся текущий
    // уровень, то есть самый глубокий, и висящей ветки не бывает по построению, —
    // но обход уровней на глубину остаётся и здесь проверяется, что он ничего не
    // ломает.
    await page.keyboard.press('Escape');
    const deeper = await readMenu(page);
    expect(isOpen(deeper, /** @type {string} */ (inner.png)), 'подменю «PNG» закрыто').toBe(false);
    expect(isOpen(deeper, /** @type {string} */ (ids.export)), 'подменю «Экспорта» осталось').toBe(true);
    expect(deeper.openCount, 'остались корень и подменю «Экспорта»').toBe(2);
    expect(expandedLabels(deeper), 'развёрнут только «Экспорт»').toEqual(['Экспорт']);
    expect(deeper.errors, 'ошибок страницы нет').toEqual([]);
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

  test('повторный показ подменю с клавиатуры перечитывает действия его пунктов', async ({ page }) => {
    // Кейс-близнец кейса выше, но показ подменю идёт клавишей, а не наведением.
    // Оба обязаны вести себя одинаково: «действия пункта перечитываются на каждом
    // показе» — свойство показа, а не свойство того, кто его вызвал. Клавиатурный
    // путь не ходит через `ensureLevel`, а берёт уже заведённый уровень, так что
    // без явной проверки расхождение осталось бы незамеченным: мышиный путь её
    // закрывает и оттого выглядит работающим.
    await makeMenu(page, 'nested', 'surface');
    await openAt(page, OPEN_MIDDLE);

    // Первый показ подменю мышью: без него нет заведённого уровня, и клавиатурный
    // показ не отличался бы от первого построения.
    await hoverItem(page, 'Владелец');
    await page.clock.fastForward(OPEN_GRACE_MS);
    expect((await readMenu(page)).openCount, 'подменю показано').toBe(2);

    // Пункт внутри подменю выключается, пока подменю закрыто. Правка обязана дойти
    // до уже построенного уровня — иначе на следующем показе он остался бы в кольце
    // роуминга, а его действие исполнилось бы.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown } */ (globalThis));
      scope.__mc.setNestedAvailability(0, false);
    });

    // Уход с показа мышью, чтобы цепочка осталась на корне и фокус встал туда же.
    await hoverItem(page, 'Владелец');
    await page.keyboard.press('ArrowLeft');
    expect((await readMenu(page)).openCount, 'подменю закрыто').toBe(1);

    await page.keyboard.press('ArrowDown');
    expect((await readMenu(page)).focusLabel, 'выделен владелец').toBe('Владелец');
    await page.keyboard.press('ArrowRight');
    const after = await readMenu(page);
    expect(after.openCount, 'подменю открыто с клавиатуры').toBe(2);

    const leaf = itemOf(after, 'Лист');
    // Пункт выключен, поэтому `ArrowDown` не вправе на него встать, а `Enter` на
    // владельце — исполнить его действие. Итоговый журнал и есть предмет кейса.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const final = await readMenu(page);
    expect(final.log, 'действие отключённого пункта не выполнено').toEqual([]);
    expect(leaf.disabled, 'пункт помечен отключённым').toBe('true');
    expect(leaf.tabindex, 'пункт вне кольца роуминга').toBe('-1');
    expect(final.focusLabel, 'фокус не встал на отключённый пункт').not.toBe('Лист');
    expect(final.errors, 'ошибок страницы нет').toEqual([]);
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

    // Переход на соседний пункт того же уровня и обратно. Уровень при этом
    // скрывается, но не пересоздаётся: идентичность уровня задаёт пара
    // «родитель, владелец», и новый уровень получил бы новый `id`. Закрытие
    // мгновенное — переход на соседа и есть решение.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'Заметки');
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
