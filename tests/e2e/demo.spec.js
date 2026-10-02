import { expect, test } from '@playwright/test';
import { OPEN_GRACE_MS, SAFETY_PADDING } from '../../src/constants.js';

/**
 * Кейсы демонстрационной страницы. В отличие от файлов Tasks 4–11 здесь ничего не
 * строится через `page.evaluate`: страница и её `Demo/demo.js` — предмет проверки,
 * и подмена её разметки проверяла бы не демо, а подмену.
 *
 * Три решения, на которых держится весь файл.
 *
 * **Время страницы — настоящее, и пауз в нём нет.** Открытие подменю идёт через
 * `OPEN_GRACE_MS`, поэтому состояние читается ожиданием ровно того, что
 * утверждается: `page.waitForFunction` на появление подменю вместо паузы в 400 мс.
 * Пауза прошла бы на быстрой машине и упала бы на медленной, потому что
 * `OPEN_GRACE_MS` — нижняя граница, а не срок. Единственное отрицательное
 * утверждение — «отключённый пункт ничего не открывает» — и по nature своему
 * требует паузы, и пауза там стоит с тройным запасом.
 *
 * **Прокрутка дожидается собственного события.** Глобальный слушатель
 * `scroll` закрывает открытое меню, а событие прокрутки приходит позже, чем
 * `scrollTo` возвращается. Правый клик без ожидания успевал открыть меню и тут же
 * получить закрытие от собственного прокручивания — «меню не открылось» на пустом
 * месте, и кейс падал бы через раз. Ожидание ставится в capture-фазе на `window`
 * и в том же `evaluate`, что и сама прокрутка: между двумя оборотами IPC браузер
 * не обязан разослать событие, и слушатель библиотеки на нём не сработал бы.
 *
 * **Каждый пункт ищется по подписи внутри своего уровня, а не по документу.**
 * Сценарии разделяют подписи («Открыть» есть и в `basic`, и в `mixed`), а
 * закрытые уровни остаются в DOM после следующего правого клика. Поиск по
 * документу нашёл бы уровень чужого сценария и нашёл бы его раньше нужного.
 *
 * **Состояние читается целиком, а не по одному атрибуту.** «Уровней открыто
 * столько-то» проходит на странице, где открыт не тот уровень, поэтому снимок
 * читает `id`, `:popover-open`, родителя, подписи и габариты разом, а кейс про
 * независимость экземпляров сверяет `id` всех сценариев.
 */

/**
 * @typedef {import('@playwright/test').Page} Page
 */

/**
 * Снимок перехода между меню разных экземпляров, снятый слушателем на документе
 * в фазе всплытия. `null` означает, что слушатель не сработал: правый клик до
 * документа не дошёл, и читать дальше нечего.
 *
 * @typedef {object} HandoverLevel
 * @property {string} id
 * @property {boolean} open `:popover-open` — уровень в Top Layer.
 * @property {boolean} closing несёт `data-vc-closing`.
 *
 * @typedef {object} DemoScope
 * @property {HandoverLevel[] | null} __handover
 */

/**
 * Накопленные сообщения страницы.
 *
 * @typedef {object} PageLog
 * @property {string[]} messages сообщения консоли, тип — в начале строки.
 * @property {string[]} errors необработанные ошибки страницы.
 */

/**
 * Уровень меню целиком, а не пара признаков: состояние открытости, подписи и
 * габариты читаются одним заходом, поэтому они заведомо из одного снимка.
 *
 * @typedef {object} LevelView
 * @property {string} id
 * @property {boolean} open `:popover-open` — уровень в Top Layer.
 * @property {boolean} parentIsBody
 * @property {string} text вычисленный `--vc-text` уровня.
 * @property {string} vcTheme `data-vc-theme` — им библиотека помечает тему меню.
 * @property {string[]} labels подписи пунктов уровня по порядку, без разделителей.
 * @property {{ top: number; left: number; width: number; height: number }} rect
 * @property {number} scrollHeight `scrollHeight` у `.vc-list` уровня.
 * @property {number} clientHeight `clientHeight` у `.vc-list` уровня.
 */

/**
 * @typedef {object} MenuSnapshot
 * @property {LevelView[]} levels уровни в порядке документа, включая закрытые.
 * @property {number} openCount сколько из них в Top Layer.
 */

/**
 * Пункт уровня: всё, что о нём можно узнать из разметки, включая пустой слот
 * иконки. `svgNodes` — узел, в котором санитайзер мог бы что-то вырезать, и он же
 * предмет проверки на пустой консоли.
 *
 * @typedef {object} ItemView
 * @property {string} label
 * @property {boolean} disabled `aria-disabled`.
 * @property {string | null} haspopup `aria-haspopup`.
 * @property {string | null} expanded `aria-expanded`.
 * @property {string | null} owns `aria-owns`.
 * @property {string | null} ariaLevel `aria-level`.
 * @property {number} chevrons сколько узлов `.vc-chevron` на пункте.
 * @property {string | null} iconTag имя тега узла в слоте иконки; `null` — слот пуст.
 * @property {string | null} iconClass
 * @property {string | null} iconAriaHidden
 * @property {string} iconText
 * @property {string | null} iconSrc `src`, если узел — `img`.
 * @property {string | null} iconAlt `alt`, если узел — `img`.
 * @property {string[]} svgAttributes имена атрибутов svg-узла.
 * @property {number} svgPaths сколько `path` внутри svg-узла.
 * @property {string[]} svgPathAttributes имена атрибутов первого `path` внутри
 *   svg-узла: презентация живёт на нём, а не на svg, и потеря обводки или
 *   заливки ни консоли, ни счёта `path` не показывает.
 * @property {number} labelLeft левый край лейбла, округлённый до целого.
 */

/**
 * Форма сценария: первая и последняя подписи и число пунктов. Полные списки
 * продублированы бы во всех местах ради одной и той же проверки, а эти три
 * величины отличаются у всех сценариев и расходятся, если блоки и
 * `Demo/scenarios.js` перестали совпадать.
 *
 * @typedef {object} ScenarioShape
 * @property {string} first
 * @property {string} last
 * @property {number} count
 */

const VIEWPORT = { width: 1280, height: 800 };

const SCENARIO_IDS = [
  'basic',
  'nested',
  'disabled',
  'icons',
  'long',
  'autohide',
  'press',
  'press-left',
  'dismissible',
  'mixed',
];

/** @type {Record<string, string>} */
const SCENARIO_TITLES = {
  basic: 'Базовое меню',
  nested: 'Вложенность',
  disabled: 'Отключённые пункты',
  icons: 'Иконки',
  long: 'Длинный список',
  autohide: 'Автоскрытие',
  press: 'Удержание кнопки',
  'press-left': 'Удержание левой кнопки',
  dismissible: 'Показ из чужого кода',
  mixed: 'Всё вместе',
};

/** @type {Record<string, ScenarioShape>} */
const SCENARIO_SHAPE = {
  basic: { first: 'Открыть', last: 'Удалить', count: 9 },
  nested: { first: 'Обновить', last: 'Свойства', count: 3 },
  disabled: { first: 'Доступно', last: 'Доступный владелец', count: 4 },
  icons: { first: 'Эмодзи', last: 'Ещё растр', count: 6 },
  long: { first: 'Пункт 1', last: 'Пункт 40', count: 40 },
  autohide: { first: 'Открыть', last: 'Удалить', count: 4 },
  press: { first: 'Новый', last: 'Отключённый пункт', count: 4 },
  'press-left': { first: 'Новый', last: 'Отключённый пункт', count: 4 },
  dismissible: { first: 'Первый', last: 'Последний', count: 3 },
  mixed: { first: 'Новый', last: 'Последний', count: 7 },
};

/**
 * Блоки, открываемые удержанием, и кнопка, которой они открываются. Прочие
 * сценарии открываются правым кликом, и список этот — единственное место, где
 * известно, чем именно открывается каждый блок.
 *
 * @type {Record<string, 'left' | 'right'>}
 */
const HELD_SCENARIOS = {
  press: 'right',
  'press-left': 'left',
};

/**
 * Блоки, которые открывает кнопка в самом блоке: правый клик по ним не открывает
 * ничего, и причина в этом не в блоке, а в его экземпляре — он не привязан.
 * Отдельный список рядом с `HELD_SCENARIOS`, потому что открытие здесь делает
 * страница, а не жест удержания.
 */
const BUTTON_SCENARIOS = ['dismissible'];

/** Порядок подключения таблиц стилей, который требует бриф. */
const STYLESHEET_ORDER = ['./styles/mycontext.css', './Demo/demo.css'];

/**
 * Токены меню, которые демо перекрывает. `LIBRARY_TEXT` — значение из
 * `styles/mycontext.css`, `DEMO_LIGHT_TEXT` и `DEMO_DARK_TEXT` — из
 * `Demo/demo.css`. Все три присутствуют в кейсах по одной причине: без них
 * утверждение «меню перекрашено страницей» прошло бы и на библиотечной палитре,
 * и на странице без единого правила для `.vc-menu`. Различаются обе темы, а не
 * только тёмная: у `--vc-bg-solid` значения демо и библиотеки в светлой теме
 * совпадают, и на нём различие не читалось бы вовсе.
 */
const LIBRARY_TEXT = '#1f2023';
const DEMO_LIGHT_TEXT = '#241f2e';
const DEMO_DARK_TEXT = '#eceaf5';

/** Подпись, которой страница сообщает, что блок открывает меню правым кликом. */
const HINT = 'Правый клик по блоку открывает его меню.';

/**
 * Подсказка блока, у которого она своя: сценарий `autohide` ведёт себя иначе, и
 * подпись общей подсказкой сказала бы читателю демо обратное. Своя подсказка
 * сверяется дословно — она и есть предмет проверки, что блок объясняет себя сам.
 */
const AUTO_HIDE_HINT =
  'Правый клик открывает меню, уход курсора за пределы порога его прячет. '
  + 'Подменю длиннее корня: уход в сторону подменю — не уход из меню.';

const PRESS_HOLD_HINT =
  'Зажмите любую кнопку — меню откроется под курсором и закроется на отпускании. '
  + 'Отпустите над пунктом — сработает его действие, над разделителем, отключённым '
  + 'пунктом или просто мимо меню — просто закроется.';

const PRESS_LEFT_HINT =
  'То же меню, но открывает только левая кнопка: правый клик не открывает ничего, '
  + 'и системное меню браузера остаётся его делом.';

const DISMISSIBLE_HINT =
  'Меню открывает кнопка в блоке, а не правый клик по нему: блок не привязан, и закрывают '
  + 'меню обычные правила — клик мимо, прокрутка, resize. Без `dismissible` оно висело бы '
  + 'до Escape.';

/**
 * Ожидаемая подсказка каждого блока. Таблица, а не условие по `id` в кейсе: подсказка
 * объявлена в описании сценария, и сверять её надо со всем списком, иначе
 * расхождение на одном блоке прошло бы незамеченным.
 *
 * @type {Record<string, string>}
 */
const SCENARIO_HINTS = {
  basic: HINT,
  nested: HINT,
  disabled: HINT,
  icons: HINT,
  long: HINT,
  autohide: AUTO_HIDE_HINT,
  press: PRESS_HOLD_HINT,
  'press-left': PRESS_LEFT_HINT,
  dismissible: DISMISSIBLE_HINT,
  mixed: HINT,
};

/**
 * Атрибуты, которых у очищенного svg-узла быть не может: каждый из них был бы
 * мостом из недоверенной разметки в стили, поведение или семантику страницы.
 * `xmlns`, `viewBox`, `width`, `height`, `aria-hidden`, `focusable` и `overflow`
 * наоборот обязательны — их ставит сам санитайзер, и они в список не входят.
 * `id` в список тоже не входит: белый список `src/icons.js` держит его сознательно,
 * ради внутренних ссылок `use href="#id"`, и называть его запрещённым здесь значило
 * бы отрицать решение библиотеки.
 */
const FORBIDDEN_SVG_ATTRIBUTES = ['class', 'style', 'tabindex', 'role'];

/**
 * Коллекторы сообщений — по одному на страницу, а не на файл. Модульная
 * переменная обслужила бы прогоны по одному воркеру, а конфигурация на этой
 * машине — как раз один воркер, и значение её в любой момент могут поднять:
 * `fullyParallel` разрешает кейсам одного файла идти вразнобой, и коллектор,
 * общий на файл, попал бы в чужой прогон.
 *
 * @type {WeakMap<Page, PageLog>}
 */
const pageLogs = new WeakMap();

test.beforeEach(async ({ page }) => {
  /** @type {string[]} */
  const messages = [];
  /** @type {string[]} */
  const errors = [];
  // Слушатели ставятся до `goto`: сообщение о загрузке модуля приходит раньше,
  // чем начнёт выполняться первый кейс, и слушатель, поставленный после
  // загрузки, его бы не увидел.
  page.on('console', (message) => {
    messages.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    errors.push(String(error));
  });
  pageLogs.set(page, { messages, errors });

  await page.setViewportSize(VIEWPORT);
  // Под `reduce` слой закрывает уровень сразу, а не через `animationDuration`, и
  // «меню закрыто» читается в том же снимке, в котором оно закрылось. Без этого
  // кейс про независимость экземпляров видел бы наложение: закрывающееся меню
  // предыдущего сценария ещё лежит в Top Layer все `140` мс.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
});

/**
 * Накопленные сообщения страницы на момент вызова.
 *
 * @param {Page} page
 * @returns {PageLog}
 */
function pageLog(page) {
  const log = pageLogs.get(page);
  if (log === undefined) {
    throw new Error('коллектор сообщений страницы не установлен');
  }
  return { messages: log.messages.slice(), errors: log.errors.slice() };
}

/**
 * Прокручивает страницу к началу блока сценария и отдаёт точку правого клика
 * внутри него.
 *
 * Точка берётся у левого верхнего угла блока, а не в его центре: от неё четыре
 * уровня подменю уходят вправо и укладываются во вьюпорт, тогда как от центра
 * правый край уже близок и каскад разворачивался бы влево.
 *
 * @param {Page} page
 * @param {string} id идентификатор сценария.
 * @returns {Promise<{ x: number; y: number }>}
 */
function rightClickPointIn(page, id) {
  return page.evaluate(async (scenarioId) => {
    const block = document.querySelector(`[data-scenario="${scenarioId}"]`);
    if (!(block instanceof HTMLElement)) {
      throw new Error(`на странице нет блока сценария «${scenarioId}»`);
    }
    const rect = block.getBoundingClientRect();
    const reachable = document.documentElement.scrollHeight - globalThis.innerHeight;
    const target = Math.min(Math.max(globalThis.scrollY + rect.top - 12, 0), reachable);
    // Граница сравнивается с достижимой, а не с запрошенной: у последнего блока
    // страницы запрошенная позиция недостижима, и сравнение с ней заставило бы
    // ждать события, которого не будет, — прокрутка упёрлась бы в край и не
    // сдвинулась.
    if (Math.abs(target - globalThis.scrollY) >= 1) {
      // Ожидание самого события `scroll`, а не пауза после него: событие
      // прокрутки приходит позже, чем `scrollTo` возвращается, и правый клик без
      // этого ожидания открывал меню и тут же получал от своего же прокручивания
      // закрытие.
      const flushed = new Promise((resolve) => {
        globalThis.addEventListener('scroll', () => {
          resolve(undefined);
        }, { once: true, capture: true });
      });
      globalThis.scrollTo({ left: 0, top: target });
      await flushed;
    }
    const placed = block.getBoundingClientRect();
    return {
      x: Math.round(placed.left + 40),
      y: Math.round(placed.top + 40),
    };
  }, id);
}

/**
 * Ждёт, пока подменю пункта-владельца окажется в Top Layer.
 *
 * Ожидание состояния, а не пауза: `OPEN_GRACE_MS` — нижняя граница, и таймер на
 * занятой машине срабатывает позже неё. Пауза в 400 мс прошла бы на быстрой
 * машине и упала бы на медленной, то есть проверяла бы скорость прогона, а не
 * показ подменю.
 *
 * @param {Page} page
 * @param {string} levelId уровень, из которого открывается подменю.
 * @param {string} label подпись пункта-владельца.
 * @returns {Promise<void>}
 */
function waitForSubmenu(page, levelId, label) {
  return page
    .waitForFunction((input) => {
      const level = document.getElementById(input.level);
      if (level === null) {
        return false;
      }
      for (const item of level.querySelectorAll('.vc-item')) {
        const text = item.querySelector('.vc-label');
        if (text === null || text.textContent !== input.label) {
          continue;
        }
        const owns = item.getAttribute('aria-owns');
        if (item.getAttribute('aria-expanded') !== 'true' || owns === null) {
          return false;
        }
        const submenu = document.getElementById(owns);
        return submenu !== null && submenu.matches(':popover-open');
      }
      return false;
    }, { level: levelId, label })
    .then(() => {
      return undefined;
    });
}

/**
 * Правый клик по блоку сценария и `id` единственного открывшегося уровня.
 *
 * Ошибка при числе открытых уровней, отличном от одного, — не проверка, а
 * предварительное условие: «меню открылось» нельзя читать по снимку, где
 * одновременно открыто несколько меню.
 *
 * @param {Page} page
 * @param {string} id идентификатор сценария.
 * @returns {Promise<string>}
 */
async function openScenario(page, id) {
  const point = await rightClickPointIn(page, id);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  return openedRootId(page);
}

/**
 * Сценарий на удержании: кнопка остаётся нажатой, а меню — показанным.
 *
 * Отдельный открыватель, а не флаг у `openScenario`, потому что там кнопка
 * отпускается сразу же, а меню на удержании живёт ровно до отпускания: клик
 * правой кнопкой открыл бы его и тут же закрыл, и кейс получил бы ноль открытых
 * уровней. Возврат тот же — `id` единственного открытого уровня.
 *
 * @param {Page} page
 * @param {string} id идентификатор сценария.
 * @param {'left' | 'right'} button кнопка, которой блок открывается.
 * @returns {Promise<string>}
 */
async function holdScenario(page, id, button) {
  const point = await rightClickPointIn(page, id);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button });
  return openedRootId(page);
}

/**
 * Отпускание нажатой кнопки в стороне от меню: удержание закрывает его само, и
 * кнопка с этого момента свободна для следующего блока.
 *
 * @param {Page} page
 * @param {'left' | 'right'} button
 * @returns {Promise<void>}
 */
async function releaseHeld(page, button) {
  await page.mouse.move(VIEWPORT.width - 8, VIEWPORT.height - 8);
  await page.mouse.up({ button });
}

/**
 * Клик по кнопке показа в блоке: блок не привязан, и меню открывает страница.
 *
 * Отдельный открыватель по той же причине, что и `holdScenario`: правый клик по
 * такому блоку не открывает ничего, и кейс получил бы ноль открытых уровней.
 *
 * Перед кликом чужое открытое меню снимается явно: `locator.click()` сначала
 * проверяет, что элемент не перекрыт, и до нажатия не доходит, а перекрывать
 * может уровень, у которого ещё идёт выход, — нажать и закрыть его нечем.
 *
 * @param {Page} page
 * @param {string} id идентификатор сценария.
 * @returns {Promise<string>}
 */
async function clickScenarioButton(page, id) {
  await page.keyboard.press('Escape');
  await page.locator(`[data-scenario="${id}"] .demo-scenario__opener`).click();
  return openedRootId(page);
}

/**
 * @param {Page} page
 * @returns {Promise<string>}
 */
function openedRootId(page) {
  return page.evaluate(() => {
    const open = Array.from(document.querySelectorAll('.vc-menu')).filter((level) => {
      return level.matches(':popover-open');
    });
    const root = open[0];
    if (open.length !== 1 || !(root instanceof HTMLElement)) {
      throw new Error(`после открытия открыто уровней: ${open.length}, ожидался один`);
    }
    return root.id;
  });
}

/**
 * @param {Page} page
 * @returns {Promise<MenuSnapshot>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const levels = Array.from(document.querySelectorAll('.vc-menu')).map((element) => {
      const rect = element.getBoundingClientRect();
      const list = element.querySelector('.vc-list');
      const style = globalThis.getComputedStyle(element);
      return {
        id: element.id,
        open: element.matches(':popover-open'),
        parentIsBody: element.parentElement === document.body,
        text: style.getPropertyValue('--vc-text').trim(),
        vcTheme: element.getAttribute('data-vc-theme') ?? '',
        labels: Array.from(element.querySelectorAll('.vc-item')).map((item) => {
          const label = item.querySelector('.vc-label');
          return label === null ? '' : String(label.textContent);
        }),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        scrollHeight: list === null ? 0 : list.scrollHeight,
        clientHeight: list === null ? 0 : list.clientHeight,
      };
    });
    return {
      levels,
      openCount: levels.filter((level) => {
        return level.open;
      }).length,
    };
  });
}

/**
 * @param {MenuSnapshot} snapshot
 * @param {string} levelId
 * @returns {LevelView}
 * @throws {Error} если уровня нет в снимке.
 */
function levelOf(snapshot, levelId) {
  const found = snapshot.levels.find((level) => {
    return level.id === levelId;
  });
  if (found === undefined) {
    throw new Error(`в снимке нет уровня «${levelId}»`);
  }
  return found;
}

/**
 * Пункт по подписи внутри своего уровня.
 *
 * @param {Page} page
 * @param {string} levelId
 * @param {string} label
 * @returns {Promise<ItemView | null>}
 */
function readItem(page, levelId, label) {
  return page.evaluate((input) => {
    const level = document.getElementById(input.level);
    if (level === null) {
      throw new Error(`в документе нет уровня «${input.level}»`);
    }
    for (const item of level.querySelectorAll('.vc-item')) {
      const text = item.querySelector('.vc-label');
      if (text === null || text.textContent !== input.label) {
        continue;
      }
      const slot = item.querySelector('.vc-icon-slot');
      const icon = slot === null ? null : slot.firstElementChild;
      const image = icon instanceof HTMLImageElement ? icon : null;
      const svg = icon instanceof SVGSVGElement ? icon : null;
      const textNode = item.querySelector('.vc-label');
      return {
        label: String(text === null ? '' : text.textContent),
        disabled: item.getAttribute('aria-disabled') === 'true',
        haspopup: item.getAttribute('aria-haspopup'),
        expanded: item.getAttribute('aria-expanded'),
        owns: item.getAttribute('aria-owns'),
        ariaLevel: item.getAttribute('aria-level'),
        chevrons: item.querySelectorAll('.vc-chevron').length,
        iconTag: icon === null ? null : icon.tagName.toLowerCase(),
        iconClass: icon === null ? null : icon.getAttribute('class'),
        iconAriaHidden: icon === null ? null : icon.getAttribute('aria-hidden'),
        iconText: icon === null ? '' : String(icon.textContent ?? ''),
        iconSrc: image === null ? null : image.getAttribute('src'),
        iconAlt: image === null ? null : image.getAttribute('alt'),
        svgAttributes: svg === null ? [] : Array.from(svg.attributes).map((attribute) => {
          return attribute.name;
        }),
        svgPaths: svg === null ? 0 : svg.querySelectorAll('path').length,
        svgPathAttributes: svg === null ? [] : Array.from(
          svg.querySelector('path')?.attributes ?? [],
        ).map((attribute) => {
          return attribute.name;
        }),
        labelLeft: textNode === null ? 0 : Math.round(textNode.getBoundingClientRect().left),
      };
    }
    return null;
  }, { level: levelId, label });
}

/**
 * @param {Page} page
 * @param {string} levelId
 * @param {string} label
 * @returns {Promise<ItemView>}
 * @throws {Error} если пункта нет в уровне.
 */
async function itemOf(page, levelId, label) {
  const item = await readItem(page, levelId, label);
  if (item === null) {
    throw new Error(`в уровне «${levelId}» нет пункта «${label}»`);
  }
  return item;
}

/**
 * Центр рамки пункта.
 *
 * @param {Page} page
 * @param {string} levelId
 * @param {string} label
 * @returns {Promise<{ x: number; y: number }>}
 */
async function centreOf(page, levelId, label) {
  return page.evaluate((input) => {
    const level = document.getElementById(input.level);
    if (level === null) {
      throw new Error(`в документе нет уровня «${input.level}»`);
    }
    for (const item of level.querySelectorAll('.vc-item')) {
      const text = item.querySelector('.vc-label');
      if (text !== null && text.textContent === input.label) {
        const rect = item.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    throw new Error(`в уровне «${input.level}» нет пункта «${input.label}»`);
  }, { level: levelId, label });
}

/**
 * Наводит курсор на пункт. Через координаты, а не `locator.hover()`: пункт может
 * оказаться под `pointer-events` гаснущего уровня, а Playwright на такой узел
 * не наведётся.
 *
 * @param {Page} page
 * @param {string} levelId
 * @param {string} label
 * @returns {Promise<void>}
 */
async function hoverItem(page, levelId, label) {
  const point = await centreOf(page, levelId, label);
  await page.mouse.move(point.x, point.y);
}

/**
 * Кликает по пункту левой кнопкой.
 *
 * @param {Page} page
 * @param {string} levelId
 * @param {string} label
 * @returns {Promise<void>}
 */
async function clickItem(page, levelId, label) {
  const point = await centreOf(page, levelId, label);
  await page.mouse.click(point.x, point.y);
}

/**
 * Кликает по разделителю уровня.
 *
 * Через координаты, как `clickItem`, и по той же причине: у разделителя нет ни
 * подписи, ни ключа пункта, и найти его можно только по классу.
 *
 * @param {Page} page
 * @param {string} levelId
 * @returns {Promise<void>}
 */
function clickSeparator(page, levelId) {
  return page
    .evaluate((id) => {
      const level = document.getElementById(id);
      if (level === null) {
        throw new Error(`в документе нет уровня «${id}»`);
      }
      const separator = level.querySelector('.vc-separator');
      if (separator === null) {
        throw new Error(`в уровне «${id}» нет разделителя`);
      }
      const rect = separator.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, levelId)
    .then((point) => {
      return page.mouse.click(point.x, point.y);
    });
}

/**
 * Строки журнала кликов блока сценария, по порядку.
 *
 * Отсутствие журнала — ошибка, а не пустой список: без журнала и с журналом,
 * в который ничего не писалось, чтение выглядит одинаково, и кейс про клик
 * прошёл бы на странице, где журнала нет вовсе.
 *
 * @param {Page} page
 * @param {string} id идентификатор сценария.
 * @returns {Promise<string[]>}
 */
function logLines(page, id) {
  return page.evaluate((scenarioId) => {
    const block = document.querySelector(`[data-scenario="${scenarioId}"]`);
    const log = block === null ? null : block.querySelector('.demo-log');
    if (log === null) {
      throw new Error(`у блока «${scenarioId}» нет журнала кликов`);
    }
    return Array.from(log.querySelectorAll('li')).map((line) => {
      return String(line.textContent);
    });
  }, id);
}

/**
 * Владелец подменю после раскрытия: адрес подменю, отметка развёрнутости и
 * глубина. Снимок целиком, потому что «подменю открылось» читается по связке из
 * трёх признаков, а по одному из них утверждение проходило бы на нераскрытом
 * владельце.
 *
 * @param {Page} page
 * @param {string} levelId
 * @param {string} label
 * @returns {Promise<ItemView>}
 */
async function expandedOwner(page, levelId, label) {
  const item = await itemOf(page, levelId, label);
  expect(item.expanded, `владелец «${label}» отмечен развёрнутым`).toBe('true');
  expect(item.owns, `у владельца «${label}» назван адрес подменю`).not.toBeNull();
  expect(item.chevrons, `у владельца «${label}» есть шеврон`).toBe(1);
  return item;
}

test('демо: страница грузится без ошибок консоли', async ({ page }) => {
  const log = pageLog(page);
  expect(log.errors, 'необработанных ошибок страницы').toEqual([]);
  expect(log.messages, 'сообщений консоли').toEqual([]);
  // Пустая консоль у страницы, которая ничего не нарисовала, ничего не значит:
  // модуль мог не загрузиться вовсе, и ошибка уехала бы в `404` stylesheet.
  expect(
    await page.evaluate(() => {
      return document.querySelectorAll('[data-scenario]').length;
    }),
    'блоки сценариев на странице есть',
  ).toBe(SCENARIO_IDS.length);
});

test('демо: список сценариев отрисован', async ({ page }) => {
  const rendered = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-scenario]')).map((block) => {
      const title = block.querySelector('.demo-scenario__title');
      const hint = block.querySelector('.demo-scenario__hint');
      return {
        id: block.getAttribute('data-scenario') ?? '',
        title: title === null ? '' : String(title.textContent),
        hint: hint === null ? '' : String(hint.textContent),
        width: block.getBoundingClientRect().width,
        height: block.getBoundingClientRect().height,
      };
    });
  });

  expect(rendered.map((block) => {
    return block.id;
  })).toEqual(SCENARIO_IDS);
  expect(rendered.map((block) => {
    return block.title;
  })).toEqual(SCENARIO_IDS.map((id) => {
    return SCENARIO_TITLES[id];
  }));
  for (const block of rendered) {
    expect(block.hint, `подпись блока «${block.id}»`).toBe(SCENARIO_HINTS[block.id]);
    // Блок нулевой ширины не стал бы целью правого клика, и кейс про открытие
    // прошёл бы на странице, где блоков не видно.
    expect(block.width, `ширина блока «${block.id}»`).toBeGreaterThan(200);
    expect(block.height, `высота блока «${block.id}»`).toBeGreaterThan(100);
  }
});

test('демо: токены меню перекрываются стилями демо, а не библиотеки', async ({ page }) => {
  const order = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((link) => {
      return link.getAttribute('href') ?? '';
    });
  });
  // Порядок подключения — отдельное требование брифа, и держит его именно это
  // утверждение: переставленные ссылки оставили бы два следующих зелёными, потому
  // что палитру перевешивает вес селектора (0,3,0 у демо против (0,2,0) у
  // библиотеки), а не старшинство файла. Само перекрытие проверяют следующие
  // утверждения — они и не проходят на странице без единого правила для `.vc-menu`.
  expect(order).toEqual(STYLESHEET_ORDER);

  const rootId = await openScenario(page, 'basic');
  const level = levelOf(await readMenu(page), rootId);
  expect(level.text.toLowerCase(), 'меню покрашено токеном демо').toBe(DEMO_LIGHT_TEXT);
  expect(level.text.toLowerCase(), 'это не токен библиотеки').not.toBe(LIBRARY_TEXT);
  // Тема принадлежит библиотеке: демо её не переписывает, а подменяет палитру.
  expect(level.vcTheme, 'data-vc-theme остался за экземпляром').toBe('auto');
});

test('демо: правый клик по рабочей области открывает меню', async ({ page }) => {
  const rootId = await openScenario(page, 'basic');

  const snapshot = await readMenu(page);
  expect(snapshot.openCount, 'открыт ровно один уровень').toBe(1);
  const level = levelOf(snapshot, rootId);
  expect(level.open, 'корневой уровень в Top Layer').toBe(true);
  expect(level.labels).toEqual([
    'Открыть',
    'Переименовать',
    'Свойства',
    'Печать',
    'Предпросмотр',
    'Закладка',
    'Сжать',
    'В очередь',
    'Удалить',
  ]);

  // Уровень — сосед блока в `<body>`, а не его потомок. Без этой проверки кейс
  // прошёл бы на вложенном меню, а именно вложенность сломала бы позиционирование
  // и `backdrop-filter` родителя.
  const insideBlock = await page.evaluate((levelId) => {
    const level = document.getElementById(levelId);
    const block = document.querySelector('[data-scenario="basic"]');
    return level !== null && block !== null && block.contains(level);
  }, rootId);
  expect(insideBlock, 'меню не вложено в блок сценария').toBe(false);
  expect(level.parentIsBody, 'уровень подключён прямо в body').toBe(true);

  // Меню целиком внутри гарантированных границ вьюпорта: блок у левого верхнего
  // угла, и без clamp меню ушло бы вверх за край.
  expect(level.rect.left, 'левый край').toBeGreaterThanOrEqual(SAFETY_PADDING);
  expect(level.rect.top, 'верхний край').toBeGreaterThanOrEqual(SAFETY_PADDING);
  expect(
    level.rect.left + level.rect.width,
    'правый край',
  ).toBeLessThanOrEqual(VIEWPORT.width - SAFETY_PADDING);
  expect(
    level.rect.top + level.rect.height,
    'нижний край',
  ).toBeLessThanOrEqual(VIEWPORT.height - SAFETY_PADDING);
});

test('демо: клик по пункту пишет его подпись в лог своего блока и закрывает меню', async ({ page }) => {
  const rootId = await openScenario(page, 'basic');

  expect(await logLines(page, 'basic'), 'до клика журнал блока пуст').toEqual([]);
  expect(
    await page.evaluate(() => {
      const block = document.querySelector('[data-scenario="basic"]');
      const hint = block === null ? null : block.querySelector('.demo-scenario__hint');
      return hint === null ? '' : String(hint.textContent);
    }),
    'подсказка блока штатная',
  ).toBe(HINT);

  await clickItem(page, rootId, 'Открыть');

  // Обе половины читаются одним снимком: действие пишет строку журнала, а закрытие
  // происходит в `finally` после него, то есть это один и тот же факт. Без второй
  // половины кейс прошёл бы на действии, которое записало строку и оставило меню
  // висеть, — а закрытие здесь половина контракта, а не деталь.
  const after = await page.evaluate((levelId) => {
    const block = document.querySelector('[data-scenario="basic"]');
    const log = block === null ? null : block.querySelector('.demo-log');
    const hint = block === null ? null : block.querySelector('.demo-scenario__hint');
    const level = document.getElementById(levelId);
    return {
      lines: log === null ? null : Array.from(log.querySelectorAll('li')).map((line) => {
        return String(line.textContent);
      }),
      hint: hint === null ? '' : String(hint.textContent),
      open: level !== null && level.matches(':popover-open'),
    };
  }, rootId);
  expect(after.lines, 'в журнале ровно одна строка, и это подпись пункта').toEqual(['Открыть']);
  // Подсказка больше не переписывается: журнал накапливает клики, а подсказка
  // объясняет, как открыть меню, и должна такой остаться.
  expect(after.hint, 'подсказка блока не переписана выбором').toBe(HINT);
  expect(after.open, 'меню закрылось').toBe(false);
  expect((await readMenu(page)).openCount, 'открытых уровней не осталось').toBe(0);

  // Каждый клик обязан оставаться виден: второй дописывает строку, а не заменяет
  // журнал. Одно место для кликов не годится — по нему не видно, что было раньше.
  const again = await openScenario(page, 'basic');
  await clickItem(page, again, 'Свойства');
  expect(await logLines(page, 'basic'), 'журнал накапливает клики по порядку').toEqual([
    'Открыть',
    'Свойства',
  ]);

  // Второй блок: клик попадает в свой журнал, а журнал первого не растёт. Общий
  // экземпляр на все блоки или журнал на страницу проявились бы именно здесь.
  const iconsId = await openScenario(page, 'icons');
  await clickItem(page, iconsId, 'Эмодзи');

  expect(await logLines(page, 'icons'), 'клик записан в журнал своего блока').toEqual(['Эмодзи']);
  expect(await logLines(page, 'basic'), 'журнал первого блока не изменился').toEqual([
    'Открыть',
    'Свойства',
  ]);
});

test('демо: клик по пункту подменю пишет его подпись в лог своего блока', async ({ page }) => {
  const rootId = await openScenario(page, 'nested');

  // Наведение раскрывает подменю — тем же путём, каким до него доходит читатель
  // страницы, и с тем же осмысленным ожиданием, что и в кейсе о раскрытии цепочки.
  await hoverItem(page, rootId, 'Ветка');
  await waitForSubmenu(page, rootId, 'Ветка');

  // Клик по владельцу добавлен к наведению намеренно: правило «клик по владельцу
  // подменю открывает подменю и своего действия не зовёт» относится именно к клику,
  // и без этого шага утверждение ниже доказывало бы только то, что наведение
  // журнала не пишет.
  await clickItem(page, rootId, 'Ветка');
  const owner = await expandedOwner(page, rootId, 'Ветка');
  const childId = /** @type {string} */ (owner.owns);

  // Клик по владельцу подменю открывает подменю и своего действия не зовёт, поэтому
  // строки в журнале от него нет. Утверждение держит на этом и проверку клика по
  // листу подменю: без него «одна строка» прошла бы и там, где подменю не
  // пройдено, а запись есть только на верхнем уровне.
  expect(await logLines(page, 'nested'), 'ни наведение, ни клик по владельцу лога не дали').toEqual([]);

  await clickItem(page, childId, 'Простой пункт');

  expect(await logLines(page, 'nested'), 'клик по пункту подменю записан').toEqual(['Простой пункт']);
  expect((await readMenu(page)).openCount, 'меню закрылось').toBe(0);
});

test('демо: клик по разделителю и отключённому пункту лога не даёт', async ({ page }) => {
  const rootId = await openScenario(page, 'disabled');

  await clickSeparator(page, rootId);
  expect(await logLines(page, 'disabled'), 'клик по разделителю лога не дал').toEqual([]);
  // Разделитель не действие, и закрывать им меню нечем: «лог пуст» на закрытом
  // меню прошло бы и на странице, где журнал не пишется вовсе.
  expect((await readMenu(page)).openCount, 'меню после клика по разделителю осталось открытым').toBe(1);

  await clickItem(page, rootId, 'Отключённый пункт');
  expect(await logLines(page, 'disabled'), 'клик по отключённому пункту лога не дал').toEqual([]);
  expect(
    (await readMenu(page)).openCount,
    'меню после клика по отключённому пункту осталось открытым',
  ).toBe(1);

  // Контрольная строка в том же открытом меню: после двух кликов, не давших
  // ничего, клик по доступному пункту пишет в тот же журнал ровно одну строку.
  await clickItem(page, rootId, 'Доступно');
  expect(await logLines(page, 'disabled'), 'доступный пункт записался').toEqual(['Доступно']);
});

test('демо: у каждого блока свой лог', async ({ page }) => {
  const logs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-scenario]')).map((block) => {
      const log = block.querySelector('.demo-log');
      return {
        id: block.getAttribute('data-scenario') ?? '',
        tagName: log === null ? '' : log.tagName.toLowerCase(),
        live: log === null ? '' : log.getAttribute('aria-live') ?? '',
        tabIndex: log === null ? '' : log.getAttribute('tabindex') ?? '',
        lines: log === null ? -1 : log.querySelectorAll('li').length,
      };
    });
  });

  expect(logs.map((entry) => {
    return entry.id;
  })).toEqual(SCENARIO_IDS);
  for (const entry of logs) {
    // Контракт разметки журнала; обоснование каждого решения — в `Demo/demo.js`.
    // Наполнение проверяется кейсом про клик, а до первого клика строк быть не
    // должно, потому список и пуст.
    expect(entry.tagName, `журнал блока «${entry.id}» — это ol`).toBe('ol');
    expect(entry.live, `журнал блока «${entry.id}» объявлен для скринридера`).toBe('polite');
    expect(
      entry.tabIndex,
      `журнал блока «${entry.id}» фокусируем: иначе прокрутить его с клавиатуры нечем`,
    ).toBe('0');
    expect(entry.lines, `журнал блока «${entry.id}» пуст при загрузке страницы`).toBe(0);
  }
});

test('демо: сценарий с 4 уровнями вложенности раскрывается целиком', async ({ page }) => {
  const rootId = await openScenario(page, 'nested');

  // Путь раскрытия — наведение, как им пользуется страница. Клавиатура проверяется
  // отдельным кейсом набора, а клик по владельцу вёл бы себя тем же
  // `#showSubmenuFor` и заменил бы здесь проверку наведения второй копией себя.
  const chain = [
    { owner: 'Ветка', child: 'Второй уровень' },
    { owner: 'Второй уровень', child: 'Третий уровень' },
    { owner: 'Третий уровень', child: 'Четвёртый уровень' },
  ];

  // Глубина растёт на каждом шаге. Проверяется именно рост: четыре уровня с
  // одинаковым `aria-level` прошли бы по счётчику открытых, и кейс узнал бы
  // только об этом. Четвёртая величина снимается с пункта уже показанного
  // четвёртого уровня: три владельца стоят на глубинах 1, 2 и 3, и «4» появилась бы
  // только при чтении из глубины.
  const depths = [];
  /** @type {string[]} */
  const chainIds = [];
  let levelId = rootId;
  for (const step of chain) {
    await hoverItem(page, levelId, step.owner);
    await waitForSubmenu(page, levelId, step.owner);
    const owner = await expandedOwner(page, levelId, step.owner);
    depths.push(/** @type {string} */ (owner.ariaLevel));
    const childId = /** @type {string} */ (owner.owns);
    const child = levelOf(await readMenu(page), childId);
    expect(child.open, `подменю «${step.owner}» показано`).toBe(true);
    expect(
      await readItem(page, childId, step.child),
      `в подменю «${step.owner}» есть пункт «${step.child}»`,
    ).not.toBeNull();
    chainIds.push(childId);
    levelId = childId;
  }
  depths.push(String((await itemOf(page, levelId, 'Лист')).ariaLevel));
  expect(depths, 'aria-level растёт от уровня к уровню').toEqual(['1', '2', '3', '4']);

  const deep = levelOf(await readMenu(page), levelId);
  const snapshot = await readMenu(page);
  expect(snapshot.openCount, 'открыты корень и три подменю').toBe(4);
  // Порядок открытых уровней в документе совпадает с порядком постановки: уровни
  // лежат в `<body>` в порядке показа, и подменю, показанное позже, оказалось бы
  // раньше. Числа «четыре» без порядка такой поломки не видят.
  expect(
    snapshot.levels.filter((level) => {
      return level.open;
    }).map((level) => {
      return level.id;
    }),
    'открыты уровни по порядку постановки',
  ).toEqual([rootId, ...chainIds]);

  // На глубине 4 у пункта собственное подменю: без этой проверки кейс прошёл бы на
  // цепи, у которой последний показанный уровень — лист, то есть на четырёх
  // уровнях вовсе без владельца на глубине.
  const fourth = await itemOf(page, levelId, 'Четвёртый уровень');
  expect(fourth.ariaLevel, 'пункт на глубине 4').toBe('4');
  expect(fourth.owns, 'у пункта на глубине 4 назван адрес подменю').not.toBeNull();
  expect(fourth.chevrons, 'у пункта на глубине 4 есть шеврон').toBe(1);
  // Резервированного подменю среди показанных нет: заведение уровня идёт на шаг
  // вперёд, но не глубже, и уровень подключается к документу только показом.
  expect(
    snapshot.levels.filter((level) => {
      return level.id === fourth.owns;
    }),
    'зарезервированное подменю среди показанных уровней не числится',
  ).toEqual([]);
  expect(deep.labels, 'в показанном уровне 4 есть и лист, и владелец').toEqual([
    'Лист',
    'Четвёртый уровень',
  ]);

  // Зарезервированный адрес — не висячая строка: клик по владельцу на глубине 4
  // открывает пятый уровень, и `aria-level` у его пунктов действительно 5. Без
  // этого шага «у пункта на глубине 4 назван адрес подменю» прошло бы и на пункте,
  // чьё подменю завести не удалось.
  await clickItem(page, levelId, 'Четвёртый уровень');
  await waitForSubmenu(page, levelId, 'Четвёртый уровень');
  const fifthId = /** @type {string} */ (fourth.owns);
  const fifth = levelOf(await readMenu(page), fifthId);
  expect(fifth.open, 'подменю глубины 5 показано').toBe(true);
  expect(fifth.labels, 'в пятом уровне два пункта').toEqual(['Замыкающий пункт', 'Соседний лист']);
  expect((await readMenu(page)).openCount, 'открыты пять уровней').toBe(5);
  expect(
    String((await itemOf(page, fifthId, 'Замыкающий пункт')).ariaLevel),
    'пункт на глубине 5',
  ).toBe('5');
});

test('демо: сценарий со всеми тремя типами иконок отрисован без ошибок', async ({ page }) => {
  const rootId = await openScenario(page, 'icons');

  const items = await page.evaluate((levelId) => {
    const level = document.getElementById(levelId);
    if (level === null) {
      throw new Error(`в документе нет уровня «${levelId}»`);
    }
    return Array.from(level.querySelectorAll('.vc-item')).map((item) => {
      const text = item.querySelector('.vc-label');
      const slot = item.querySelector('.vc-icon-slot');
      const icon = slot === null ? null : slot.firstElementChild;
      const image = icon instanceof HTMLImageElement ? icon : null;
      const svg = icon instanceof SVGSVGElement ? icon : null;
      return {
        label: text === null ? '' : String(text.textContent),
        iconTag: icon === null ? null : icon.tagName.toLowerCase(),
        iconClass: icon === null ? null : icon.getAttribute('class'),
        iconAriaHidden: icon === null ? null : icon.getAttribute('aria-hidden'),
        iconText: icon === null ? '' : String(icon.textContent ?? ''),
        iconSrc: image === null ? null : image.getAttribute('src'),
        iconAlt: image === null ? null : image.getAttribute('alt'),
        svgAttributes: svg === null ? [] : Array.from(svg.attributes).map((attribute) => {
          return attribute.name;
        }),
        svgPaths: svg === null ? 0 : svg.querySelectorAll('path').length,
        svgPathAttributes: svg === null ? [] : Array.from(
          svg.querySelector('path')?.attributes ?? [],
        ).map((attribute) => {
          return attribute.name;
        }),
        labelLeft: text === null ? 0 : Math.round(text.getBoundingClientRect().left),
      };
    });
  }, rootId);

  const byLabel = new Map(items.map((item) => {
    return [item.label, item];
  }));
  expect(byLabel.size, 'подписи пунктов не повторяются').toBe(items.length);

  const emoji = byLabel.get('Эмодзи');
  expect(emoji, 'пункт с эмодзи есть').toBeDefined();
  expect(emoji?.iconTag, 'эмодзи — span').toBe('span');
  expect(emoji?.iconClass, 'у эмодзи класс иконки').toBe('vc-icon');
  expect(emoji?.iconAriaHidden, 'эмодзи не дублирует озвучку лейбла').toBe('true');
  expect(emoji?.iconText, 'эмодзи держит символ').toBe('😀');

  const vector = byLabel.get('Вектор');
  expect(vector?.iconTag, 'вектор — svg').toBe('svg');
  // Санитайзер сохранил содержимое: пустой или вырезанный `path` означал бы, что
  // разметка не пережила чистку, и пункт молча остался бы пустым слотом.
  expect(vector?.svgPaths, 'у вектора сохранён path').toBe(1);
  // `overflow` в список запрещённых не входит: его, наоборот, принудительно
  // ставит санитайзер, чтобы авторский unclips-вьюпорт не стал оверлеем.
  expect(
    (vector?.svgAttributes ?? []).filter((attribute) => {
      return FORBIDDEN_SVG_ATTRIBUTES.includes(attribute);
    }),
    'у svg не осталось атрибутов вне белого списка',
  ).toEqual([]);
  expect(
    (vector?.svgAttributes ?? []).filter((attribute) => {
      return attribute.startsWith('on');
    }),
    'у svg нет ни одного `on*`',
  ).toEqual([]);
  expect(vector?.svgAttributes, 'у svg остался `viewBox`').toEqual(
    expect.arrayContaining(['viewBox', 'aria-hidden', 'overflow', 'xmlns']),
  );
  // Презентация живёт на `path`, а не на svg, поэтому и проверяется там. Потеря
  // `fill` и `fill-rule` не видна нигде: `path` на месте, иконка остаётся фигурой,
  // а консоль молчит — `src/icons.js` предупреждает только когда не отрисовано
  // ничего.
  expect(vector?.svgPathAttributes, 'у вектора осталась заливка и правило её заливки').toEqual(
    expect.arrayContaining(['fill', 'fill-rule']),
  );

  // Второй вектор на уровне — другой набор атрибутов представления: обводка
  // вместо заливки. Ровно тот случай, который молча ломается, и ровно тот, что
  // одним счётом `path` не виден.
  const secondVector = byLabel.get('Ещё вектор');
  expect(secondVector?.iconTag, 'ещё вектор — svg').toBe('svg');
  expect(secondVector?.svgPaths, 'у второго вектора сохранён path').toBe(1);
  expect(
    secondVector?.svgPathAttributes,
    'у второго вектора остались обводка, её толщина и её концы',
  ).toEqual(expect.arrayContaining(['stroke', 'stroke-width', 'stroke-linecap']));
  expect(
    (secondVector?.svgAttributes ?? []).filter((attribute) => {
      return FORBIDDEN_SVG_ATTRIBUTES.includes(attribute);
    }),
    'у второго вектора не осталось атрибутов вне белого списка',
  ).toEqual([]);

  const raster = byLabel.get('Растр');
  expect(raster?.iconTag, 'растр — img').toBe('img');
  // Адрес непустой и не равен адресу страницы: негодный адрес `renderIcon`
  // оставляет `src` пустым, и `img` уехал бы за самой страницей.
  expect(raster?.iconSrc?.startsWith('data:image/png;base64,'), 'растр получил свой src').toBe(true);
  expect(raster?.iconAlt, 'у растра непустой alt').toBe('Образец');

  // `decode()` вместо `naturalWidth`: изображение декодируется движком, а не
  // таймером страницы, поэтому не ломается на замороженных часах и не читает
  // `0` на снимке, сделанном раньше, чем картинка готова.
  const decoded = await page.evaluate(async (levelId) => {
    const level = document.getElementById(levelId);
    const image = level === null ? null : level.querySelector('img.vc-icon');
    if (!(image instanceof HTMLImageElement)) {
      return null;
    }
    try {
      await image.decode();
    } catch (error) {
      return { failed: String(error), width: 0 };
    }
    return { failed: '', width: image.naturalWidth };
  }, rootId);
  expect(decoded, 'в меню есть растр, который декодируется').not.toBeNull();
  expect(decoded?.failed, 'растр декодировался').toBe('');
  expect(decoded?.width, 'у растра есть размеры').toBe(1);

  const bare = byLabel.get('Без иконки');
  expect(bare, 'пункт без иконки есть').toBeDefined();
  expect(bare?.iconTag, 'слот без иконки остаётся пустым').toBeNull();

  // Соосность подписей: слот иконки создаётся всегда, поэтому лейблы стоят на
  // одной колонке, и глазом видно, что иконки разного веса их не сдвигают.
  const labelLefts = items.map((item) => {
    return item.labelLeft;
  });
  expect(new Set(labelLefts).size, 'подписи всех пунктов на одной колонке').toBe(1);

  // Момент проверки консоли — после открытия, а не после загрузки: дерево уровня
  // строится лениво, и санитайзер молчит ровно до первого показа меню.
  const log = pageLog(page);
  expect(log.messages, 'ни одного сообщения консоли после отрисовки иконок').toEqual([]);
  expect(log.errors, 'ни одной ошибки после отрисовки иконок').toEqual([]);
});

test('демо: сценарий с отключёнными пунктами не открывает их подменю', async ({ page }) => {
  const rootId = await openScenario(page, 'disabled');

  const plain = await itemOf(page, rootId, 'Отключённый пункт');
  expect(plain.disabled, 'отключённый пункт помечен').toBe(true);
  expect(plain.owns, 'у отключённого пункта нет адреса подменю').toBeNull();
  expect(plain.haspopup, 'у отключённого пункта нет признака подменю').toBeNull();
  expect(plain.chevrons, 'у отключённого пункта нет шеврона').toBe(0);

  // Соблазн у отключённого владельца тот же, и он главный: у него подменю
  // непустое, поэтому всё, что делает владельца владельцем, на нём сработало бы.
  const owner = await itemOf(page, rootId, 'Отключённый владелец');
  expect(owner.disabled, 'отключённый владелец помечен').toBe(true);
  expect(owner.owns, 'у отключённого владельца нет адреса подменю').toBeNull();
  expect(owner.haspopup, 'у отключённого владельца нет признака подменю').toBeNull();
  expect(owner.chevrons, 'у отключённого владельца нет шеврона').toBe(0);

  const enabled = await itemOf(page, rootId, 'Доступный владелец');
  expect(enabled.disabled, 'доступный владелец не отключён').toBe(false);
  expect(enabled.owns, 'у доступного владельца назван адрес подменю').not.toBeNull();
  expect(enabled.chevrons, 'у доступного владельца есть шеврон').toBe(1);

  // В документе ровно один уровень: под отключённого владельца не заведено ни
  // одного, то есть открыть его нечем даже в принципе. Считаются все `.vc-menu`,
  // а не открытые: заведённый, но не показанный уровень — тоже был бы лишним.
  const levelCount = await page.evaluate(() => {
    return document.querySelectorAll('.vc-menu').length;
  });
  expect(levelCount, 'заведен только корневой уровень').toBe(1);

  // Клавиатурная дверь проверяется первой и до всяких кликов мышью: `mousedown`
  // по `div[tabindex="-1"]` переводит на него фокус сам, браузерным правилом, и
  // после клика по отключённому пункту «фокус стоит на первом доступном» было бы
  // уже неверно. Показ сценария выделения не оставляет вовсе: фокус стоит на
  // элементе уровня, и подписи у него нет. Отключённый пункт не входит в цикл
  // роуминга, поэтому фокус на него не попадёт и `ArrowRight` его не разберёт.
  // Список подписей под фокусом — и есть проверка этого, и она же показывает, что
  // роуминг вообще идёт: иначе «отключённых в списке нет» прошло бы на неподвижном
  // фокусе. Подпись берётся у пункта под фокусом, а не у любого потомка: у элемента
  // уровня подписи нет, но `querySelector` нашёл бы в нём первую подпись меню.
  const focusBefore = await page.evaluate(() => {
    const active = document.activeElement;
    const item = active === null ? null : active.closest('.vc-item');
    const label = item === null ? null : item.querySelector('.vc-label');
    return label === null ? null : String(label.textContent);
  });
  expect(focusBefore, 'выделения после открытия нет').toBe(null);
  /** @type {string[]} */
  const visited = [];
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('ArrowDown');
    visited.push(await page.evaluate(() => {
      const active = document.activeElement;
      const item = active === null ? null : active.closest('.vc-item');
      const label = item === null ? null : item.querySelector('.vc-label');
      return label === null ? '' : String(label.textContent);
    }));
  }
  // Первая стрелка даёт первый доступный пункт, а дальше цикл идёт по доступным:
  // из «Доступно» шаг ведёт сразу к владельцу, минуя отключённые, из владельца —
  // обратно в «Доступно», потому что доступных пунктов в блоке всего два и
  // разделитель между ними в кольцо не входит.
  expect(visited[0], 'роуминг начинается с первого доступного').toBe('Доступно');
  expect(visited[1], 'роуминг идёт по доступным пунктам').toBe('Доступный владелец');
  expect(visited[2], 'роуминг обходит отключённые и разделитель').toBe('Доступно');
  expect(
    visited.filter((label) => {
      return label.startsWith('Отключённый');
    }),
    'фокус ни разу не встал на отключённый пункт',
  ).toEqual([]);
  expect((await readMenu(page)).openCount, 'роуминг не открыл подменю').toBe(1);

  // Наведение: вторая дверь, и единственная, у которой нет подписки. Пауза с
  // тройным запасом от `OPEN_GRACE_MS` — отрицательное утверждение по nature своему
  // требует паузы: доказать, что ничего не открылось, можно только переждав срок.
  await hoverItem(page, rootId, 'Отключённый владелец');
  await page.waitForTimeout(OPEN_GRACE_MS * 3);
  expect((await readMenu(page)).openCount, 'наведение не открыло подменю').toBe(1);
  expect(
    await page.evaluate(() => {
      return document.querySelectorAll('.vc-menu').length;
    }),
    'наведение не завело уровень',
  ).toBe(1);

  // Наведение на доступного владельца в том же сценарии обязано сработать: без
  // этого шага «отключённый не открылся» прошло бы и на пункте, который не
  // открывается ни при ком, и кейс проверял бы сам себя.
  await hoverItem(page, rootId, 'Доступный владелец');
  await waitForSubmenu(page, rootId, 'Доступный владелец');
  expect((await readMenu(page)).openCount, 'доступный владелец раскрылся').toBe(2);

  // Клик: третья дверь. Меню обязано остаться открытым — клик по отключённому
  // пункту не действие, и закрывать его нечем. А вот открытое перед этим подменю
  // доступного владельца уходит, и уходит не от клика: клик по отключённому пункту
  // не открывает ничего, но курсор наводит на строку сам собой, а наведение на
  // невыбираемую строку закрывает подменю её уровня. Оба утверждения разведены
  // именно поэтому: смешанные они проверяли бы второе, забыв первое.
  await clickItem(page, rootId, 'Отключённый владелец');
  const afterClick = await readMenu(page);
  expect(afterClick.openCount, 'меню живо, подменю ушло вместе с наведением').toBe(1);
});

test('демо: сценарий длинного списка прокручивается внутри уровня', async ({ page }) => {
  const rootId = await openScenario(page, 'long');

  const before = levelOf(await readMenu(page), rootId);
  expect(before.labels).toHaveLength(40);
  expect(before.labels[0], 'первый пункт длинного списка').toBe('Пункт 1');
  expect(before.labels[39], 'последний пункт длинного списка').toBe('Пункт 40');
  // Прокручиваемость проверяется сравнением размеров, а не «меню не выше
  // вьюпорта»: рамка ограничена `max-height` и всегда влезет, а вот содержимое
  // внутри неё — нет.
  expect(before.scrollHeight, 'содержимое выше рамки списка').toBeGreaterThan(before.clientHeight);
  expect(before.clientHeight, 'рамка списка ограничена вьюпортом').toBeLessThanOrEqual(
    VIEWPORT.height - 2 * SAFETY_PADDING,
  );

  // Прокрутка именно `.vc-list`: глобальный слушатель `scroll` различает прокрутку
  // страницы и прокрутку списка, и различение это — предмет кейса.
  //
  // Ожидание события `scroll` стоит в том же `evaluate`, что и сама прокрутка, и
  // слушатель — на `window` в capture-фазе, ровно как в `rightClickPointIn`.
  // Между двумя оборотами IPC браузер не обязан разослать событие, слушатель
  // библиотеки на нём и не сработал бы, а «меню осталось открытым» прошло бы на
  // списке, который вовсе не прокрутили. Порядок срабатывания тот же, что у
  // библиотеки: её слушатель поставлен раньше, на том же узле и в той же фазе,
  // поэтому к моменту разрешения обещания меню уже пережило событие.
  const scrolled = await page.evaluate(async (levelId) => {
    const level = document.getElementById(levelId);
    const list = level === null ? null : level.querySelector('.vc-list');
    if (list === null) {
      throw new Error(`у уровня «${levelId}» нет списка`);
    }
    const lastItem = list.lastElementChild;
    const visibleBefore = lastItem === null
      ? null
      : lastItem.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom;
    const maxScroll = list.scrollHeight - list.clientHeight;
    // Граница берётся достижимая, а не запрошенная: `scrollTop` никогда не
    // больше `scrollHeight - clientHeight`, и у списка, уже прокрученного вниз,
    // события не было бы вовсе — ждать его пришлось бы вечно.
    if (maxScroll >= 1) {
      const flushed = new Promise((resolve) => {
        globalThis.addEventListener('scroll', () => {
          resolve(undefined);
        }, { once: true, capture: true });
      });
      list.scrollTop = maxScroll;
      await flushed;
    }
    const lastRect = lastItem === null ? null : lastItem.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    return {
      scrollTop: list.scrollTop,
      maxScroll,
      visibleBefore,
      visibleAfter: lastRect === null
        ? null
        : lastRect.top >= listRect.top - 1 && lastRect.bottom <= listRect.top + listRect.height + 1,
    };
  }, rootId);
  expect(scrolled.visibleBefore, 'до прокрутки последний пункт за рамкой').toBe(false);
  expect(scrolled.scrollTop, 'список прокрутился вниз').toBeGreaterThan(0);
  expect(scrolled.scrollTop, 'прокрутка дошла до конца списка').toBeCloseTo(scrolled.maxScroll, 0);
  expect(scrolled.visibleAfter, 'после прокрутки последний пункт виден').toBe(true);

  const after = levelOf(await readMenu(page), rootId);
  expect(after.open, 'меню осталось в Top Layer после прокрутки').toBe(true);
  expect(after.id, 'открыт тот же уровень').toBe(rootId);
  expect(after.labels, 'состав пунктов не изменился').toEqual(before.labels);
});

test('демо: переключение темы страницы не ломает меню', async ({ page }) => {
  const rootId = await openScenario(page, 'basic');
  const before = levelOf(await readMenu(page), rootId);
  expect(before.text.toLowerCase(), 'до переключения тема светлая').toBe(DEMO_LIGHT_TEXT);

  // Переключатель активируется с клавиатуры. Клик мышью мимо меню сначала снял бы
  // его глобальным слушателем `pointerdown`, и кейс проверял бы не «тема не ломает
  // меню», а «меню закрывается кликом по странице» — свойство из `globals.spec.js`.
  await page.evaluate(() => {
    const button = document.querySelector('[data-theme-toggle]');
    if (!(button instanceof HTMLElement)) {
      throw new Error('на странице нет переключателя темы');
    }
    // `preventScroll` обязателен: переключатель стоит в шапке, а страница
    // прокручена к блоку сценария, и обычный `focus()` подвёл бы кнопку в кадр —
    // то есть прокрутил страницу и закрыл меню тем же слушателем `scroll`.
    button.focus({ preventScroll: true });
  });
  await page.keyboard.press('Enter');

  const pageTheme = await page.evaluate(() => {
    const button = document.querySelector('[data-theme-toggle]');
    return {
      theme: document.documentElement.getAttribute('data-demo-theme') ?? '',
      pressed: button === null ? null : button.getAttribute('aria-pressed'),
    };
  });
  expect(pageTheme.theme, 'тема страницы переключилась').toBe('dark');
  expect(pageTheme.pressed, 'переключатель отмечен нажатым').toBe('true');

  const after = levelOf(await readMenu(page), rootId);
  expect(after.open, 'меню осталось в Top Layer').toBe(true);
  expect(after.labels, 'состав пунктов не изменился').toEqual(before.labels);
  expect(after.rect, 'положение меню не изменилось').toEqual(before.rect);
  // Ключевое утверждение кейса: палитра у открытого уровня пересчитана каскадом
  // по новой теме страницы. Без него «меню не сломалось» прошло бы и на странице,
  // где правила для `.vc-menu` нет вовсе.
  expect(after.text.toLowerCase(), 'открытое меню перекрашено новой темой').toBe(DEMO_DARK_TEXT);
  expect(after.text.toLowerCase(), 'это не токен библиотеки').not.toBe(LIBRARY_TEXT);
  expect(after.vcTheme, 'data-vc-theme по-прежнему за экземпляром').toBe('auto');

  // Мышиный путь — то, что видит человек с мышью: кнопка в шапке, до неё
  // страницу надо довернуть, и меню по дороге сносит глобальный слушатель
  // `scroll`. Само закрытие здесь не утверждается — это свойство из
  // `globals.spec.js`; утверждается то, ради чего шаг: после клика и повторного
  // правого клика меню снова перекрашено под текущую тему, и в обратную сторону.
  await page.evaluate(async () => {
    const flushed = new Promise((resolve) => {
      globalThis.addEventListener('scroll', () => {
        resolve(undefined);
      }, { once: true, capture: true });
    });
    globalThis.scrollTo({ left: 0, top: 0 });
    await flushed;
  });
  await page.locator('[data-theme-toggle]').click();

  const mouseId = await openScenario(page, 'basic');
  const byMouse = levelOf(await readMenu(page), mouseId);
  expect(byMouse.open, 'после мышиного переключения меню снова открылось').toBe(true);
  expect(
    byMouse.text.toLowerCase(),
    'мышиный путь: тема доехала до меню в обратную сторону',
  ).toBe(DEMO_LIGHT_TEXT);
});

test('демо: у каждого сценария свой независимый экземпляр MyContext', async ({ page }) => {
  /** @type {string[]} */
  const rootIds = [];

  for (const id of SCENARIO_IDS) {
    const held = HELD_SCENARIOS[id];
    const rootId = held !== undefined
      ? await holdScenario(page, id, held)
      : BUTTON_SCENARIOS.includes(id)
        ? await clickScenarioButton(page, id)
        : await openScenario(page, id);
    // `openScenario` уже отказал бы, если бы открытых уровней оказалось не один, но
    // утверждение остаётся: иначе «своё меню у каждого» читалось бы по снимку с
    // наложением.
    const snapshot = await readMenu(page);
    expect(
      snapshot.levels.filter((level) => {
        return level.open;
      }),
      `у сценария «${id}» открыт ровно один уровень`,
    ).toHaveLength(1);

    const level = levelOf(snapshot, rootId);
    const shape = SCENARIO_SHAPE[id];
    expect(level.labels, `подписи сценария «${id}»`).toHaveLength(shape.count);
    expect(level.labels[0], `первый пункт сценария «${id}»`).toBe(shape.first);
    expect(level.labels[shape.count - 1], `последний пункт сценария «${id}»`).toBe(shape.last);
    rootIds.push(rootId);
    if (held !== undefined) {
      await releaseHeld(page, held);
    }
  }

  // Разных `id` ровно столько же, сколько блоков, — столько же разных слоёв, а
  // слой создаётся один на экземпляр. Это и есть прямое доказательство
  // независимости: общий экземпляр дал бы один `id` на все блоки, а перепривязка
  // `attach` — ещё и пустые все, кроме последнего.
  expect(new Set(rootIds).size, 'у каждого сценария свой уровень').toBe(SCENARIO_IDS.length);

  // Все меню отрисовались за прогон, и ни одно не пожаловалось: охват всех
  // типов иконок и всех сценариев целиком, а не по одному сценарию за кейс.
  const log = pageLog(page);
  expect(log.messages, 'сообщений консоли за все меню').toEqual([]);
  expect(log.errors, 'ошибок за все меню').toEqual([]);
});

test('демо: правый клик по другому блоку гасит чужое меню и открывает своё в одном такте', async ({ page }) => {
  // `reduce` снят: под ним закрытие мгновенное, состояния «чужое меню гаснет в Top
  // Layer» не существует, и кейс прошёл бы на показе без всякого выхода — то есть
  // проверял бы не переход между меню, а его отсутствие.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const firstId = await openScenario(page, 'basic');
  // Вход первого меню обязан закончиться. Пока оно доигрывает, «чужое меню» и «только
  // что показанное» — одно и то же состояние, и снимок перехода ничего бы не
  // различал.
  await page.waitForFunction((id) => {
    const level = document.getElementById(id);
    if (level === null) {
      return false;
    }
    return level.matches(':popover-open')
      && !level.hasAttribute('data-vc-closing')
      && globalThis.getComputedStyle(level).opacity === '1';
  }, firstId);

  // Снимок снимается слушателем на `document` в фазе всплытия, то есть после
  // глобальных обработчиков capture-фазы и после `open()` целевого блока. Любая
  // другая точка наблюдения — до или после события — либо увидела бы гаснущее
  // меню уже погасшим, либо не увидела бы показанного: окно между двумя меню
  // длится одну анимацию, и поездка туда-обратно его перекрывает.
  await page.evaluate(() => {
    const scope = /** @type {DemoScope} */ (/** @type {unknown} */ (globalThis));
    scope.__handover = null;
    document.addEventListener('contextmenu', () => {
      scope.__handover = Array.from(document.querySelectorAll('.vc-menu')).map((element) => {
        return {
          id: element.id,
          open: element.matches(':popover-open'),
          closing: element.hasAttribute('data-vc-closing'),
        };
      });
    }, { once: true });
  });

  const point = await rightClickPointIn(page, 'nested');
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const handover = await page.evaluate(() => {
    const scope = /** @type {DemoScope} */ (/** @type {unknown} */ (globalThis));
    return scope.__handover;
  });

  // Ровно два уровня: экземпляры на странице свои, и каждый открыл свой.
  expect(handover, 'снимок перехода снят').not.toBe(null);
  expect(handover ?? [], 'в момент перехода на странице два уровня').toHaveLength(2);
  const fading = (handover ?? []).find((level) => {
    return level.id === firstId;
  });
  const shown = (handover ?? []).find((level) => {
    return level.id !== firstId;
  });
  // Чужое меню ещё в Top Layer и уже гаснет: выход идёт на месте, а `hidePopover`
  // отложен на анимацию.
  expect(fading?.open, 'чужое меню ещё в Top Layer').toBe(true);
  expect(fading?.closing, 'чужое меню гаснет').toBe(true);
  // И своё открыто в этом же такте. Оба перехода идут одновременно, а не
  // последовательно: показ отложен на `animationDuration` только внутри одного
  // экземпляра, и разные экземпляры о нём не знают.
  expect(shown?.open, 'своё меню открыто').toBe(true);
  expect(shown?.closing, 'своё меню не гаснет').toBe(false);

  // И переход завершается без наложения: чужое меню ушло, своё осталось.
  await page.waitForFunction((id) => {
    const open = Array.from(document.querySelectorAll('.vc-menu')).filter((level) => {
      return level.matches(':popover-open');
    });
    return open.length === 1 && open[0].id === id;
  }, /** @type {string} */ (shown?.id));
  const settled = await readMenu(page);
  expect(settled.openCount, 'после перехода открыт один уровень').toBe(1);
  expect(levelOf(settled, /** @type {string} */ (shown?.id)).open, 'осталось меню нового блока').toBe(true);
});

test('демо: блок с автоскрытием прячет меню по уходу курсора, остальные держат', async ({ page }) => {
  // Блок проверяется как блок, а не как правило: кейсы правила живут в
  // `tests/e2e/autoHide.spec.js` и гоняют библиотеку против пустой страницы, а
  // здесь важно, что демо передал опцию тому экземпляру, кому она нужна, и не
  // тому, кому не нужна. Поэтому обе половины в одном кейсе: уход курсора гасит
  // меню с порогом и не гасит меню без него.
  const far = { x: VIEWPORT.width - 30, y: VIEWPORT.height - 30 };

  await openScenario(page, 'autohide');
  expect((await readMenu(page)).openCount, 'меню блока с автоскрытием открыто').toBe(1);
  await page.mouse.move(far.x, far.y);
  expect(
    (await readMenu(page)).openCount,
    'меню блока с автоскрытием спряталось по уходу курсора',
  ).toBe(0);

  await openScenario(page, 'basic');
  expect((await readMenu(page)).openCount, 'меню обычного блока открыто').toBe(1);
  await page.mouse.move(far.x, far.y);
  expect(
    (await readMenu(page)).openCount,
    'меню обычного блока уход курсора не тронул: порога у него нет',
  ).toBe(1);
});

test('демо: блок на удержании пишет в журнал по отпусканию, обычный — по клику', async ({ page }) => {
  // Как и с автоскрытием, проверяется блок, а не правило: кейсы правила живут в
  // `tests/e2e/pressAndHold.spec.js`. Здесь важно, что демо передал опцию тому
  // экземпляру, кому она нужна, и что оба блока ведут журнал одинаково.
  const rootId = await holdScenario(page, 'press', 'right');
  const point = await centreOf(page, rootId, 'Новый');
  await page.mouse.move(point.x, point.y);
  await page.mouse.up({ button: 'right' });

  expect(await logLines(page, 'press'), 'отпускание над пунктом пишет подпись').toEqual(['Новый']);
  expect((await readMenu(page)).openCount, 'меню закрылось отпусканием').toBe(0);

  const ordinaryId = await openScenario(page, 'basic');
  await clickItem(page, ordinaryId, 'Открыть');
  expect(await logLines(page, 'basic'), 'обычный блок пишет по клику').toEqual(['Открыть']);
});

test('демо: блок на левой кнопке не открывается правым кликом', async ({ page }) => {
  // Различие читается только рядом с блоком на любой кнопке: без него кейс
  // доказал бы лишь то, что меню закрыто, а не то, что правая кнопка не
  // открывает ничего вовсе.
  const point = await rightClickPointIn(page, 'press-left');
  await page.mouse.click(point.x, point.y, { button: 'right' });
  expect((await readMenu(page)).openCount, 'правый клик блок не открыл').toBe(0);

  const rootId = await holdScenario(page, 'press-left', 'left');
  expect(rootId, 'левая кнопка блок открыла').not.toBe('');
  await releaseHeld(page, 'left');
});

test('демо: блок, открываемый кнопкой, закрывается кликом мимо', async ({ page }) => {
  // Блок не привязан: правый клик по нему не открывает ничего, а меню показывает
  // кнопка. Правила закрытия подняты показом (`dismissible`) — без них меню висело бы
  // до `Escape`, и блок обещал бы читателю обратное.
  const block = await page.locator('[data-scenario="dismissible"]').boundingBox();
  if (block === null) {
    throw new Error('блок сценария «dismissible» не найден');
  }
  await page.mouse.click(block.x + 20, block.y + 20, { button: 'right' });
  expect((await readMenu(page)).openCount, 'правый клик по блоку ничего не открыл').toBe(0);

  await clickScenarioButton(page, 'dismissible');
  expect((await readMenu(page)).openCount, 'кнопка открыла меню').toBe(1);

  await page.mouse.click(VIEWPORT.width - 12, 12);
  expect((await readMenu(page)).openCount, 'клик мимо закрыл меню').toBe(0);
});

test('демо: пункт меню, открытого кнопкой, исполняется кликом', async ({ page }) => {
  const rootId = await clickScenarioButton(page, 'dismissible');
  const point = await centreOf(page, rootId, 'Первый');
  await page.mouse.click(point.x, point.y, { button: 'left' });

  expect(await logLines(page, 'dismissible'), 'действие исполнилось').toEqual(['Первый']);
  expect((await readMenu(page)).openCount, 'меню закрылось').toBe(0);
});
