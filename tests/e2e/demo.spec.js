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
 * независимость экземпляров сверяет `id` всех шести.
 */

/**
 * @typedef {import('@playwright/test').Page} Page
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
 * @property {string} accent вычисленный `--vc-accent` уровня.
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
 * продублированы бы в шести местах ради одной и той же проверки, а эти три
 * величины отличаются у всех шести сценариев и расходятся, если блоки и
 * `Demo/scenarios.js` перестали совпадать.
 *
 * @typedef {object} ScenarioShape
 * @property {string} first
 * @property {string} last
 * @property {number} count
 */

const VIEWPORT = { width: 1280, height: 800 };

const SCENARIO_IDS = ['basic', 'nested', 'disabled', 'icons', 'long', 'mixed'];

/** @type {Record<string, string>} */
const SCENARIO_TITLES = {
  basic: 'Базовое меню',
  nested: 'Вложенность',
  disabled: 'Отключённые пункты',
  icons: 'Иконки',
  long: 'Длинный список',
  mixed: 'Всё вместе',
};

/** @type {Record<string, ScenarioShape>} */
const SCENARIO_SHAPE = {
  basic: { first: 'Открыть', last: 'Удалить', count: 9 },
  nested: { first: 'Обновить', last: 'Свойства', count: 3 },
  disabled: { first: 'Доступно', last: 'Пустое подменю', count: 5 },
  icons: { first: 'Эмодзи', last: 'Ещё растр', count: 6 },
  long: { first: 'Пункт 1', last: 'Пункт 40', count: 40 },
  mixed: { first: 'Новый', last: 'Последний', count: 8 },
};

/** Порядок подключения таблиц стилей, который требует бриф. */
const STYLESHEET_ORDER = ['./styles/mycontext.css', './Demo/demo.css'];

/**
 * Токены меню, которые демо перекрывает. `LIBRARY_ACCENT` — значение из
 * `styles/mycontext.css`, `DEMO_LIGHT_ACCENT` и `DEMO_DARK_ACCENT` — из
 * `Demo/demo.css`. Все три присутствуют в кейсах по одной причине: без них
 * утверждение «меню перекрашено страницей» прошло бы и на библиотечной палитре,
 * и на странице без единого правила для `.vc-menu`.
 */
const LIBRARY_ACCENT = '#2563eb';
const DEMO_LIGHT_ACCENT = '#7c3aed';
const DEMO_DARK_ACCENT = '#c4b5fd';

/** Подпись, которой страница сообщает, что блок открывает меню правым кликом. */
const HINT = 'Правый клик по блоку открывает его меню.';

/** Подпись, которую получает блок `basic` после выбора пункта с действием. */
const CHOSEN_HINT = 'Выбрано: Открыть.';

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
  return page.evaluate(() => {
    const open = Array.from(document.querySelectorAll('.vc-menu')).filter((level) => {
      return level.matches(':popover-open');
    });
    const root = open[0];
    if (open.length !== 1 || !(root instanceof HTMLElement)) {
      throw new Error(`после правого клика открыто уровней: ${open.length}, ожидался один`);
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
        accent: style.getPropertyValue('--vc-accent').trim(),
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
        label: String(text.textContent),
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
    expect(block.hint, `подпись блока «${block.id}»`).toBe(HINT);
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
  expect(level.accent.toLowerCase(), 'меню покрашено токеном демо').toBe(DEMO_LIGHT_ACCENT);
  expect(level.accent.toLowerCase(), 'это не токен библиотеки').not.toBe(LIBRARY_ACCENT);
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

test('демо: клик по пункту с действием пишет выбор в подсказку и закрывает меню', async ({ page }) => {
  const rootId = await openScenario(page, 'basic');

  const before = await page.evaluate(() => {
    const block = document.querySelector('[data-scenario="basic"]');
    const hint = block === null ? null : block.querySelector('.demo-scenario__hint');
    return hint === null ? '' : String(hint.textContent);
  });
  expect(before, 'до клика подсказка блока штатная').toBe(HINT);

  await clickItem(page, rootId, 'Открыть');

  // Обе половины читаются одним снимком: действие пишет подсказку, а закрытие
  // происходит в `finally` после него, то есть это один и тот же факт. Без
  // второй половины кейс прошёл бы на действии, которое записало подсказку и
  // оставило меню висеть, — а закрытие здесь половина контракта, а не деталь.
  const after = await page.evaluate((levelId) => {
    const block = document.querySelector('[data-scenario="basic"]');
    const hint = block === null ? null : block.querySelector('.demo-scenario__hint');
    const level = document.getElementById(levelId);
    return {
      hint: hint === null ? '' : String(hint.textContent),
      open: level !== null && level.matches(':popover-open'),
    };
  }, rootId);
  expect(after.hint, 'подсказка блока назвала выбранный пункт').toBe(CHOSEN_HINT);
  expect(after.hint, 'подсказка действительно изменилась').not.toBe(HINT);
  expect(after.open, 'меню закрылось').toBe(false);
  expect((await readMenu(page)).openCount, 'открытых уровней не осталось').toBe(0);
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

  // Пустое подменю — не подменю: владельцем не становится, и уровень под него
  // тоже не заводится.
  const empty = await itemOf(page, rootId, 'Пустое подменю');
  expect(empty.owns, 'у пункта с пустым подменю нет адреса подменю').toBeNull();
  expect(empty.chevrons, 'у пункта с пустым подменю нет шеврона').toBe(0);

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
  // уже неверно. Отключённый пункт не входит в цикл роуминга, поэтому фокус на
  // него не попадёт и `ArrowRight` его не разберёт. Список подписей под фокусом —
  // и есть проверка этого, и она же показывает, что роуминг вообще идёт: иначе
  // «отключённых в списке нет» прошло бы на неподвижном фокусе.
  const focusBefore = await page.evaluate(() => {
    const active = document.activeElement;
    const label = active === null ? null : active.querySelector('.vc-label');
    return label === null ? null : String(label.textContent);
  });
  expect(focusBefore, 'фокус на первом доступном пункте').toBe('Доступно');
  /** @type {string[]} */
  const visited = [];
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('ArrowDown');
    visited.push(await page.evaluate(() => {
      const active = document.activeElement;
      const label = active === null ? null : active.querySelector('.vc-label');
      return label === null ? '' : String(label.textContent);
    }));
  }
  expect(visited[0], 'роуминг идёт по доступным пунктам').toBe('Доступный владелец');
  expect(visited[2], 'роуминг обходит отключённые').toBe('Доступно');
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
  // пункту не действие, и закрывать его нечем.
  await clickItem(page, rootId, 'Отключённый владелец');
  const afterClick = await readMenu(page);
  expect(afterClick.openCount, 'клик по отключённому владельцу не открыл подменю').toBe(2);
  expect(afterClick.openCount, 'открытое подменю доступного владельца не снесено').toBe(2);
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
  expect(before.accent.toLowerCase(), 'до переключения тема светлая').toBe(DEMO_LIGHT_ACCENT);

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
  expect(after.accent.toLowerCase(), 'открытое меню перекрашено новой темой').toBe(DEMO_DARK_ACCENT);
  expect(after.accent.toLowerCase(), 'это не токен библиотеки').not.toBe(LIBRARY_ACCENT);
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
    byMouse.accent.toLowerCase(),
    'мышиный путь: тема доехала до меню в обратную сторону',
  ).toBe(DEMO_LIGHT_ACCENT);
});

test('демо: у каждого сценария свой независимый экземпляр MyContext', async ({ page }) => {
  /** @type {string[]} */
  const rootIds = [];

  for (const id of SCENARIO_IDS) {
    const rootId = await openScenario(page, id);
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
  }

  // Шесть разных `id` — шесть разных слоёв, а слой создаётся один на экземпляр.
  // Это и есть прямое доказательство независимости: общий экземпляр дал бы один
  // `id` на все шесть блоков, а перепривязка `attach` — ещё и пустые первые пять.
  expect(new Set(rootIds).size, 'у каждого сценария свой уровень').toBe(SCENARIO_IDS.length);

  // Все шесть меню отрисовались за прогон, и ни одно не пожаловалось: охват всех
  // типов иконок и всех сценариев целиком, а не по одному сценарию за кейс.
  const log = pageLog(page);
  expect(log.messages, 'сообщений консоли за все шесть меню').toEqual([]);
  expect(log.errors, 'ошибок за все шесть меню').toEqual([]);
});
