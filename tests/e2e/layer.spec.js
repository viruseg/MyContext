import { expect, test } from '@playwright/test';
import { DEFAULT_ANIMATION_DURATION, SAFETY_PADDING } from '../../src/constants.js';

// Модуль подгружается динамическим импортом прямо в странице, и спецификатор
// `../../src/layer.js` обслуживает обе среды: в браузере от
// `http://127.0.0.1:4173/` он схлопывается до `/src/layer.js` — корень сервера,
// — а TypeScript разрешает его от файла теста. Поэтому типы импорта берутся из
// исходника, без приведений.

/**
 * @typedef {import('../../src/renderer.js').MenuItem} MenuItem
 * @typedef {import('../../src/renderer.js').SeparatorItem} SeparatorItem
 * @typedef {import('../../src/layer.js').LevelEntry} LevelEntry
 * @typedef {import('../../src/layer.js').MenuLayer} MenuLayer
 * @typedef {import('../../src/layer.js').MenuLayerOptions} MenuLayerOptions
 */

/**
 * Задача, поставленная слоем через внедрённый `schedule`. Жест задачи — сам
 * объект: так его возвращает заглушка, и так же вернул бы настоящий `setTimeout`.
 *
 * @typedef {object} ScheduledTask
 * @property {() => void} fn работа задачи.
 * @property {number} ms задержка, с которой её поставили.
 */

/**
 * Состояние элемента в момент вызова `showPopover()`. Снимок снимается обёрткой
 * вокруг метода прототипа: порядок «замерить → показать» иначе нечем проверить,
 * наружу он не выходит ни одним значением.
 *
 * @typedef {object} ShowCall
 * @property {string} id идентификатор уровня в момент показа.
 * @property {boolean} connected подключён ли элемент к документу.
 * @property {boolean} lastInBody является ли элемент последним потомком `<body>`.
 * @property {boolean} openBefore был ли элемент открыт до вызова.
 * @property {string} left инлайновое `left` в момент показа.
 * @property {string} top инлайновое `top` в момент показа.
 * @property {string} display инлайновый `display` в момент показа.
 * @property {string} position инлайновый `position` в момент показа.
 * @property {string} visibility инлайновый `visibility` в момент показа.
 * @property {string} transform инлайновый `transform` в момент показа.
 * @property {boolean} closing стоит ли на уровне `data-vc-closing` в момент
 *   показа. Пока атрибут стоит, `opacity` уже ноль и вход не отыграл бы.
 */

/**
 * Проба страницы: один слой на кейс, одна карта `actions`, один список задач и
 * один инструмент наблюдения за `showPopover`/`hidePopover` на всех уровнях.
 *
 * Ставится в `beforeEach`: почти каждый кейс создаёт слой, задачи и наблюдателя
 * одинаково, а двадцать копий обвязки — это двадцать мест, где таймеры и
 * наблюдатель однажды разъедутся.
 *
 * @typedef {object} LayerProbe
 * @property {(overrides?: Partial<MenuLayerOptions>) => MenuLayer} create новый
 *   слой с настройками пробы. Карта `actions`, `schedule` и `cancel` — те же.
 * @property {(overrides?: Partial<MenuLayerOptions>) => MenuLayer} keep слой,
 *   создаваемый при первом обращении с указанными настройками и переиспользуемый
 *   дальше: кейсу нужно пережить две оценки страницы, между которыми меняется
 *   состояние. Настройки учитываются только при создании.
 * @property {() => MenuLayer} bare слой без `animationDuration` — значение по
 *   умолчанию достаёт себе слой, из константы.
 * @property {() => MenuLayer} real слой на настоящих таймерах страницы вместо
 *   заглушек. Задача, поставленная заглушкой, исполнилась бы по первому же
 *   чтению списка, и срок закрытия по часам не был бы проверен.
 * @property {Map<string, MenuItem | SeparatorItem>} actions общая карта активов.
 * @property {ShowCall[]} shows вызовы `showPopover` в порядке вызовов.
 * @property {string[]} hides идентификаторы уровней в порядке вызовов
 *   `hidePopover`.
 * @property {number[]} hiddenAt `performance.now()` в момент каждого вызова
 *   `hidePopover`. Читается обёрткой, и момент выхода из Top Layer измеряется
 *   теми же часами, которыми идёт отсчёт в кейсе.
 * @property {ScheduledTask[]} tasks висящие задачи в порядке постановки.
 * @property {unknown[]} cancelled жесты задач в порядке снятия.
 * @property {() => number} runTasks выполняет все висящие задачи по порядку и
 *   возвращает их количество.
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
  <body style="background: rgb(255, 255, 255)"></body>
</html>`;

/**
 * Вьюпорт фиксирован: координаты кейсов про позиционирование выводятся из
 * `innerWidth` и `innerHeight`, и плавающий размер сделал бы ожидаемые значения
 * нечитаемыми.
 */
const VIEWPORT = { width: 1000, height: 700 };

/**
 * Длительность пробная и намеренно не круглая: равенство со значением из
 * `DEFAULT_ANIMATION_DURATION` прошло бы и при жёстко зашитой константе, а
 * равенство со своим — нет.
 */
const TEST_ANIMATION_DURATION = 137;

/**
 * Пауза перед `hide` внутри идущего перехода входа. Нужна, чтобы отличить таймер от
 * слушателя `transitionend`: слушатель поймал бы конец перехода, начавшегося при
 * показе, и закрыл бы уровень раньше срока. Взята заметно меньше длительности, иначе
 * переход входа успел бы завершиться и разница со сроком таймера исчезла бы.
 */
const ENTRY_TRANSITION_WAIT_MS = 40;

const ANCHOR_LEFT = 8;
const ANCHOR_RIGHT_EDGE = 10;

/**
 * Корневой уровень: два владельца подменю, обычный пункт между ними и
 * разделитель. Владельцы стоят через строку, и их подменю перекрываются — на
 * этом стоит кейс про порядок отрисовки в Top Layer.
 *
 * @type {Array<MenuItem | SeparatorItem>}
 */
const ROOT_ITEMS = [
  { label: 'Экспорт', submenu: [{ label: 'PDF' }] },
  { label: 'Обычный пункт' },
  { label: 'Печать', submenu: [{ label: 'Принтер' }] },
  { type: 'separator' },
  { label: 'Выход' },
];

/**
 * Подменю. Три строки, чтобы высота подменю перекрывала расстояние между двумя
 * владельцами в корневом уровне.
 *
 * @type {Array<MenuItem | SeparatorItem>}
 */
const SUB_ITEMS = [
  { label: 'Принтер' },
  { label: 'PDF' },
  { label: 'Просмотр' },
];

/**
 * Подменю подменю. Отдельная фикстура нужна потому, что уровень третьей глубины
 * создаётся от пункта-владельца, а владельцем подменю становится только пункт с
 * непустым `submenu` — и слой это проверяет, отказываясь вешать `aria-owns` на
 * заведомо неподменю.
 *
 * @type {Array<MenuItem | SeparatorItem>}
 */
const NESTED_ITEMS = [
  { label: 'Глубже', submenu: [{ label: 'Самый нижний' }] },
  { label: 'Обычный пункт подменю' },
];

/**
 * Фикстура для кейса про позиционирование: подписи заведомо шире 100px. Меню
 * уже 100px — это ровно та ширина, при которой ошибка замера в 4% ещё не выносит
 * правый край за `padding`, и кейс прошёл бы с неверным замером.
 *
 * @type {Array<MenuItem | SeparatorItem>}
 */
const WIDE_ITEMS = [
  { label: 'Достаточно длинная подпись пункта' },
  { label: 'Вторая длинная подпись пункта' },
  { label: 'Третья длинная подпись пункта меню' },
];

/**
 * Проба ставится в `beforeEach` на глобальный объект страницы и достаётся
 * приведением прямо внутри каждого `page.evaluate`: колбэк сериализуется и
 * выполняется в браузере, где функций файла теста нет, — по той же причине, по
 * которой константы фикстур передаются аргументом, а не читаются из модуля.
 * Спецификатор импорта записан относительным по третьей причине: в браузере он
 * схлопывается до `/src/layer.js` — корень сервера, — а TypeScript разрешает его
 * от файла теста, и типы берутся из исходника без приведений.
 */

/**
 * Сверяет координату с результатом позиционера числом, а не строкой и не ровно.
 *
 * Строка не годится по двум причинам. CSSOM сериализует длину инлайнового стиля с
 * ограниченной точностью (`827.171875px` читается обратно как `827.172px`), а
 * `getBoundingClientRect` в firefox возвращает координаты, привязанные к
 * `LayoutUnit` в 1/60 px. Обе расхождения — округление представления, а не
 * расхождение координат, и посимвольное или точное сравнение ловило бы именно
 * их. Допуск в сотые доли пикселя на порядок меньше ошибки замера, которая
 * двигает меню на единицы пикселей, и на порядок больше округления, которое
 * пришлось учесть.
 *
 * @param {number} actual прочитанная координата, px.
 * @param {number} expected результат позиционера, px.
 * @param {string} name имя координаты в сообщении об ошибке.
 * @returns {void}
 */
function expectPx(actual, expected, name) {
  expect(actual, name).toBeCloseTo(expected, 2);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  // `goto` обязателен перед `setContent`: без него у документа нет адреса, и ни
  // ссылка на таблицу стилей, ни динамический импорт не разрешились бы.
  await page.goto('/');
  await page.setContent(PAGE_HTML);
  // Живая таблица стилей ещё могла не примениться, и `getComputedStyle` вернул бы
  // пустые значения — кейс упал бы не по существу.
  await page.waitForFunction(
    (path) => {
      return Array.from(document.styleSheets).some((sheet) => {
        return sheet.href !== null && sheet.href.endsWith(path) && sheet.cssRules.length > 0;
      });
    },
    STYLESHEET_PATH,
    { timeout: 5000 },
  );
  // `reduce` обнуляет `transform` у меню, и `scale(0.96)` не искажал бы ни один
  // геометрический замер. Кейсы, которым нужно настоящее движение, переключают
  // эмуляцию на `no-preference` явно; кейсы про отложенное закрытие — тем более,
  // потому что слой читает настоящий медиазапрос, а не заглушку.
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async (config) => {
    const { createLayer } = await import('../../src/layer.js');

    /** @type {ScheduledTask[]} */
    const tasks = [];
    /** @type {unknown[]} */
    const cancelled = [];
    /** @type {ShowCall[]} */
    const shows = [];
    /** @type {string[]} */
    const hides = [];
    const actions = new Map();

    // Обёртка фиксирует порядок вызовов и состояние элемента на входе в
    // `showPopover`.
    const nativeShow = globalThis.HTMLElement.prototype.showPopover;
    globalThis.HTMLElement.prototype.showPopover = function () {
      shows.push({
        id: this.id,
        connected: this.isConnected,
        lastInBody: document.body.lastElementChild === this,
        openBefore: this.matches(':popover-open'),
        left: this.style.left,
        top: this.style.top,
        display: this.style.display,
        position: this.style.position,
        visibility: this.style.visibility,
        transform: this.style.transform,
        closing: this.hasAttribute('data-vc-closing'),
      });
      nativeShow.call(this);
    };
    /** @type {number[]} */
    const hiddenAt = [];
    const nativeHide = globalThis.HTMLElement.prototype.hidePopover;
    globalThis.HTMLElement.prototype.hidePopover = function () {
      hides.push(this.id);
      hiddenAt.push(globalThis.performance.now());
      nativeHide.call(this);
    };

    /**
     * Настоящий планировщик снятую задачу до исполнения не допускает, поэтому
     * заглушка делает то же: иначе «отменённая» задача продолжала бы числиться
     * висящей, и кейс про отмену проверял бы не отмену, а список.
     *
     * @param {() => void} fn
     * @param {number} ms
     * @returns {unknown}
     */
    const schedule = (fn, ms) => {
      const task = { fn, ms };
      tasks.push(task);
      return task;
    };

    /**
     * @param {unknown} handle
     * @returns {void}
     */
    const cancel = (handle) => {
      cancelled.push(handle);
      const index = tasks.indexOf(/** @type {ScheduledTask} */ (handle));
      if (index > -1) {
        tasks.splice(index, 1);
      }
    };

    /**
     * @returns {number}
     */
    const runTasks = () => {
      const pending = tasks.splice(0, tasks.length);
      for (const task of pending) {
        task.fn();
      }
      return pending.length;
    };

    // Длительность в `base` не входит: слой без неё берёт значение из константы,
    // и это отдельный слой пробы — `bare()`.
    /** @type {MenuLayerOptions} */
    const base = {
      label: 'Меню файла',
      theme: 'light',
      actions,
      schedule,
      cancel,
    };

    /** @type {MenuLayer | null} */
    let kept = null;
    const probe = /** @type {LayerProbe} */ ({
      actions,
      shows,
      hides,
      hiddenAt,
      tasks,
      cancelled,
      runTasks,
      create(overrides) {
        return createLayer({
          ...base,
          animationDuration: config.animationDuration,
          ...overrides,
        });
      },
      keep(overrides) {
        if (kept === null) {
          kept = createLayer({
            ...base,
            animationDuration: config.animationDuration,
            ...overrides,
          });
        }
        return kept;
      },
      bare() {
        return createLayer(base);
      },
      real() {
        const { schedule, cancel, ...rest } = base;
        return createLayer({ ...rest, animationDuration: config.animationDuration });
      },
    });

    const host = /** @type {{ __vcProbe?: LayerProbe }} */ (
      /** @type {unknown} */ (globalThis)
    );
    host.__vcProbe = probe;
  }, { animationDuration: TEST_ANIMATION_DURATION });
});

test.describe('показ', () => {
  test('showRoot: элемент получает :popover-open и ненулевые габариты после показа', async ({ page }) => {
    const result = await page.evaluate((rootItems) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      const entry = layer.ensureLevel(rootItems, null, 0, null);

      // Контроль состояния «до показа»: элемент ещё не подключён, значит
      // ненулевые габариты после показа не могут объясняться тем, что он давно
      // висит в документе.
      const before = {
        open: entry.element.matches(':popover-open'),
        connected: entry.element.isConnected,
      };

      layer.showRoot(entry, { x: 40, y: 40 });
      const rect = entry.element.getBoundingClientRect();

      return {
        before,
        open: entry.element.matches(':popover-open'),
        popover: entry.element.getAttribute('popover'),
        width: rect.width,
        height: rect.height,
        entryOpen: entry.open,
        // Уровень — корень цепочки: у него нет ни родителя, ни владельца.
        parent: entry.parent,
        ownerItem: entry.ownerItem,
        // Пункты уровня обязаны быть его потомками, иначе движок роуминга и
        // повторный `ensureLevel` работали бы с отцепленными узлами.
        itemsInDom: entry.items.every((item) => {
          return item.element.parentElement === entry.element.querySelector('.vc-list');
        }),
        shown: probe.shows.length,
      };
    }, ROOT_ITEMS);

    expect(result.before).toEqual({ open: false, connected: false });
    expect(result.open).toBe(true);
    // `manual` — единственное значение, при котором меню не закрывается по клику
    // мимо и подменю не закрывают друг друга.
    expect(result.popover).toBe('manual');
    // Габариты ненулевые: иначе все координаты после показа были бы пустыми.
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.entryOpen).toBe(true);
    expect(result.parent).toBe(null);
    expect(result.ownerItem).toBe(null);
    expect(result.itemsInDom).toBe(true);
    expect(result.shown).toBe(1);
  });

  test('замер вслепую: до showPopover габариты нулевые, а координаты после показа соответствуют результату positioner', async ({ page }) => {
    const result = await page.evaluate(async ({ rootItems, padding, edge }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const { calculateMenuPosition } = await import('../../src/positioner.js');
      const layer = probe.create();
      const entry = layer.ensureLevel(rootItems, null, 0, null);

      // До показа уровень не подключён, поэтому габариты нулевые, а не малые.
      const before = entry.element.getBoundingClientRect();
      const beforeRects = entry.element.getClientRects().length;

      // Точка у правого края: при ней позиционер выбирает кандидата «влево от
      // курсора», координата которого зависит от ширины меню. С нулевой шириной
      // кандидат был бы другим, и равенство ниже ничего бы не доказывало.
      const anchor = { x: window.innerWidth - edge, y: 200 };
      layer.showRoot(entry, anchor);
      const after = entry.element.getBoundingClientRect();

      const common = {
        cursorX: anchor.x,
        cursorY: anchor.y,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        padding,
      };
      const expected = calculateMenuPosition({
        ...common,
        menuWidth: after.width,
        menuHeight: after.height,
      });
      const withZeroSize = calculateMenuPosition({ ...common, menuWidth: 0, menuHeight: 0 });

      return {
        before: { width: before.width, height: before.height, rects: beforeRects },
        styleLeft: entry.element.style.left,
        styleTop: entry.element.style.top,
        rect: { left: after.left, top: after.top },
        expected,
        zeroLeft: withZeroSize.left,
      };
    }, { rootItems: ROOT_ITEMS, padding: SAFETY_PADDING, edge: ANCHOR_RIGHT_EDGE });

    // До показа у уровня нет ни габаритов, ни клиентских прямоугольников.
    expect(result.before).toEqual({ width: 0, height: 0, rects: 0 });
    // Замер прошёл вслепую, то есть по ненулевой ширине: координата совпала с
    // результатом позиционера, посчитанным от фактических габаритов. Равенство
    // `expected.left` и `zeroLeft` было бы тождеством.
    expect(result.expected.left).not.toBe(result.zeroLeft);
    expectPx(Number.parseFloat(result.styleLeft), result.expected.left, 'styleLeft');
    expectPx(Number.parseFloat(result.styleTop), result.expected.top, 'styleTop');
    // Под `reduce` `transform` обнулён, поэтому видимый прямоугольник совпадает с
    // записанными координатами.
    expectPx(result.rect.left, result.expected.left, 'левый край видимого прямоугольника');
    expectPx(result.rect.top, result.expected.top, 'верхний край видимого прямоугольника');
  });

  test('позиционирование: меню целиком внутри вьюпорта при точке в правом нижнем углу', async ({ page }) => {
    // Здесь движение нужно настоящее: под `reduce` `transform` обнулён, ошибка
    // замера появилась бы и там, и кейс перестал бы отличать верный замер от
    // неверного. Сама ошибка в видимом прямоугольнике не видна — её съедает
    // `scale(0.96)`, — поэтому измеряется раскладка: `offset*` трансформацию не
    // знает.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const result = await page.evaluate(({ wideItems, padding, edge }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      const entry = layer.ensureLevel(wideItems, null, 0, null);
      const anchor = { x: window.innerWidth - edge, y: window.innerHeight - 10 };
      layer.showRoot(entry, anchor);
      const element = entry.element;
      return {
        left: element.offsetLeft,
        top: element.offsetTop,
        width: element.offsetWidth,
        height: element.offsetHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        anchorX: anchor.x,
        styleLeft: Number.parseFloat(element.style.left),
        padding,
      };
    }, { wideItems: WIDE_ITEMS, padding: SAFETY_PADDING, edge: ANCHOR_RIGHT_EDGE });

    // Контроль: кейс обязан исполнить флип, а не упасть в clamp. Иначе ошибка
    // замера сдвинула бы меню, clamp её бы спрятал, и кейс прошёл бы.
    expect(result.styleLeft).toBeLessThan(result.anchorX);
    expect(result.styleLeft).toBeGreaterThan(result.padding);
    // Гарантия спеки: меню целиком внутри вьюпорта минус `padding` с обеих сторон.
    expect(result.left).toBeGreaterThanOrEqual(result.padding);
    expect(result.top).toBeGreaterThanOrEqual(result.padding);
    expect(result.left + result.width).toBeLessThanOrEqual(
      result.viewportWidth - result.padding,
    );
    expect(result.top + result.height).toBeLessThanOrEqual(
      result.viewportHeight - result.padding,
    );
  });

  test('порядок показа: маска снята, координаты записаны, а элемент уже последний в body', async ({ page }) => {
    const result = await page.evaluate(async ({ rootItems, padding, edge }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const { calculateMenuPosition } = await import('../../src/positioner.js');
      const layer = probe.create();
      const entry = layer.ensureLevel(rootItems, null, 0, null);
      const anchor = { x: 120, y: 90 };
      layer.showRoot(entry, anchor);

      const size = entry.element.getBoundingClientRect();
      const expected = calculateMenuPosition({
        cursorX: anchor.x,
        cursorY: anchor.y,
        menuWidth: size.width,
        menuHeight: size.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        padding,
      });
      return { call: probe.shows[0], expected, count: probe.shows.length };
    }, { rootItems: ROOT_ITEMS, padding: SAFETY_PADDING, edge: ANCHOR_RIGHT_EDGE });

    expect(result.count).toBe(1);
    const call = result.call;
    // Элемент подключён к документу к моменту показа: нечего измерять и нечего
    // показывать.
    expect(call.connected).toBe(true);
    // И он последний в `<body>` — это подъём в конец DOM, обязательный до
    // `showPopover` ради порядка отрисовки в Top Layer. Порядок отрисовки
    // доказывает кейс «top layer» ниже; здесь — только место в DOM.
    expect(call.lastInBody).toBe(true);
    // Показ ещё не вступил в силу.
    expect(call.openBefore).toBe(false);
    // Маска снята целиком. Любое оставшееся значение означало бы, что меню
    // показано невидимым или невидимо уехавшим.
    expect(call.display).toBe('');
    expect(call.position).toBe('');
    expect(call.visibility).toBe('');
    expect(call.transform).toBe('');
    // Отметки закрытия нет: пока она стоит, `opacity` уже ноль, и вход не отыграл бы.
    expect(call.closing).toBe(false);
    // Замер и запись координат уже состоялись. Показ до замера дал бы здесь
    // пустые `left` и `top` — координаты, посчитанные по габаритам `0×0`.
    expectPx(Number.parseFloat(call.left), result.expected.left, 'left на входе в showPopover');
    expectPx(Number.parseFloat(call.top), result.expected.top, 'top на входе в showPopover');
  });

  test('top layer: показанное подменю отрисовывается поверх ранее созданного соседнего', async ({ page }) => {
    const result = await page.evaluate(({ rootItems, subItems, left }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      // Меню у левого края: оба подменя помещаются справа от своих владельцев и
      // потому перекрываются — точка пересечения существует.
      layer.showRoot(root, { x: left, y: 60 });

      const first = layer.ensureLevel(subItems, root, 1, root.items[0]);
      const second = layer.ensureLevel(subItems, root, 1, root.items[2]);

      layer.showSubmenu(first);
      const firstRect = first.element.getBoundingClientRect();
      // Точка берётся у нижнего края первого подменю: второе начинается ниже
      // первого, и общая с ним полоса — именно там.
      const point = { x: firstRect.left + 6, y: firstRect.bottom - 6 };
      const beforeId = document.elementFromPoint(point.x, point.y)
        ?.closest('.vc-menu')?.id ?? null;

      layer.showSubmenu(second);
      const secondRect = second.element.getBoundingClientRect();
      /**
       * @param {DOMRect} rect
       * @returns {boolean}
       */
      const inside = (rect) => {
        return point.x >= rect.left && point.x <= rect.right
          && point.y >= rect.top && point.y <= rect.bottom;
      };
      const afterSecond = document.elementFromPoint(point.x, point.y)
        ?.closest('.vc-menu')?.id ?? null;

      // Перепоказ уже подключённого подменю. Без переноса в конец `<body>` его
      // узел остался бы на прежнем месте, то есть под соседним: порядок
      // отрисовки Top Layer следует за порядком в DOM, а не за порядком показа.
      layer.hide(first);
      layer.showSubmenu(first);
      const afterReshow = document.elementFromPoint(point.x, point.y)
        ?.closest('.vc-menu')?.id ?? null;

      return {
        ids: {
          root: root.element.id,
          first: first.element.id,
          second: second.element.id,
        },
        point,
        insideFirst: inside(firstRect),
        insideSecond: inside(secondRect),
        beforeId,
        afterSecond,
        afterReshow,
        // Порядок в DOM: перепоказанное подменю в конце.
        order: Array.from(document.body.children, (node) => {
          return node.id;
        }),
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS, left: ANCHOR_LEFT });

    // Оба подменю лежат в этой точке, иначе утверждение ниже проверяло бы
    // пустоту: `elementFromPoint` вернул бы элемент под первым попавшим.
    expect(result.insideFirst).toBe(true);
    expect(result.insideSecond).toBe(true);
    // Перепоказанное подменю в конце `<body>` — порядок Top Layer идёт от него.
    expect(result.order).toEqual([
      result.ids.root,
      result.ids.second,
      result.ids.first,
    ]);
    // До показа второго в точке был первый: точка выбрана не случайно, и порядок
    // действительно меняет верхний слой.
    expect(result.beforeId).toBe(result.ids.first);
    expect(result.afterSecond).toBe(result.ids.second);
    // Перепоказ первого поднял его снова: без переноса в конец `<body>` он
    // остался бы под соседним, и верхним осталось бы то, что показано раньше.
    expect(result.afterReshow).toBe(result.ids.first);
  });
});

test.describe('подменю', () => {
  test('chevron: showSubmenu у правого края разворачивает шеврон пункта-владельца', async ({ page }) => {
    const result = await page.evaluate(async ({ rootItems, subItems, padding, edge }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const { calculateSubmenuPosition } = await import('../../src/positioner.js');
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      // Меню у правого края: подменю справа от владельца не помещается.
      layer.showRoot(root, { x: window.innerWidth - edge, y: 200 });

      const owner = root.items[0];
      const ownerRect = owner.element.getBoundingClientRect();
      const sub = layer.ensureLevel(subItems, root, 1, owner);
      layer.showSubmenu(sub);
      const subRect = sub.element.getBoundingClientRect();
      const expected = calculateSubmenuPosition({
        anchorRect: {
          left: ownerRect.left,
          top: ownerRect.top,
          right: ownerRect.right,
          bottom: ownerRect.bottom,
        },
        menuWidth: subRect.width,
        menuHeight: subRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        padding,
      });

      return {
        flippedX: expected.flippedX,
        chevron: owner.element.getAttribute('data-chevron'),
        styleLeft: sub.element.style.left,
        expectedLeft: expected.left,
        // Геометрический контроль: подменю действительно открылось слева, шеврон
        // не переключился вхолостую.
        openedLeft: subRect.left < ownerRect.right,
        // Контроль на подменю: шеврон принадлежит владельцу, на самом подменю его
        // быть не должно.
        submenuChevron: sub.element.getAttribute('data-chevron'),
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS, padding: SAFETY_PADDING, edge: ANCHOR_RIGHT_EDGE });

    // Разворот задан позиционером, и он же сработал: без флипа подменю у правого
    // края просто не поместилось бы.
    expect(result.flippedX).toBe(true);
    expect(result.openedLeft).toBe(true);
    expect(result.chevron).toBe('left');
    expectPx(Number.parseFloat(result.styleLeft), result.expectedLeft, 'styleLeft подменю');
    expect(result.submenuChevron).toBe(null);
  });

  test('chevron: подменю у левого края оставляет шеврон справа', async ({ page }) => {
    const result = await page.evaluate(async ({ rootItems, subItems, padding, left }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const { calculateSubmenuPosition } = await import('../../src/positioner.js');
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      // Меню у левого края: справа от владельца есть место.
      layer.showRoot(root, { x: left, y: 200 });

      const owner = root.items[0];
      const ownerRect = owner.element.getBoundingClientRect();
      const sub = layer.ensureLevel(subItems, root, 1, owner);
      layer.showSubmenu(sub);
      const subRect = sub.element.getBoundingClientRect();
      const expected = calculateSubmenuPosition({
        anchorRect: {
          left: ownerRect.left,
          top: ownerRect.top,
          right: ownerRect.right,
          bottom: ownerRect.bottom,
        },
        menuWidth: subRect.width,
        menuHeight: subRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        padding,
      });

      return {
        flippedX: expected.flippedX,
        chevron: owner.element.getAttribute('data-chevron'),
        // Контроль: подменю открылось справа, то есть кейс исполнил другую ветку
        // решения, а не повторил предыдущий.
        openedRight: subRect.left > ownerRect.right,
        expectedLeft: expected.left,
        styleLeft: sub.element.style.left,
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS, padding: SAFETY_PADDING, left: ANCHOR_LEFT });

    expect(result.flippedX).toBe(false);
    expect(result.openedRight).toBe(true);
    expect(result.chevron).toBe('right');
    expectPx(Number.parseFloat(result.styleLeft), result.expectedLeft, 'styleLeft подменю');
  });

  test('aria-owns: showSubmenu проставляет пункту-владельцу aria-owns со id подменю', async ({ page }) => {
    const result = await page.evaluate(({ rootItems, subItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const owner = root.items[0];
      const reserved = owner.element.getAttribute('aria-owns');
      // До создания подменю зарезервированная цель не существует: рендерер обязан
      // назвать её заранее, и до показа это висячая ссылка.
      const reservedBefore = document.getElementById(reserved ?? '') !== null;

      const sub = layer.ensureLevel(subItems, root, 1, owner);
      const targetBeforeShow = document.getElementById(reserved ?? '') !== null;

      layer.showSubmenu(sub);
      const owns = owner.element.getAttribute('aria-owns');

      return {
        reserved,
        reservedBefore,
        // Показ не переименовывает подменю: id задан при создании, иначе
        // зарезервированная цель указывала бы в никуда.
        subIdBeforeShow: /** @type {LevelEntry} */ (sub).element.id,
        targetBeforeShow,
        subId: sub.element.id,
        owns,
        // Ссылка ведёт в документ, а не в пустоту.
        resolves: document.getElementById(owns ?? '') === sub.element,
        // Подменю — сосед корневого в `<body>`, а не потомок пункта: иначе
        // `backdrop-filter` и анимация `scale` на родителе создали бы containing
        // block и сломали позиционирование.
        insideOwner: owner.element.contains(sub.element),
        // У корневого уровня `aria-owns` нет: связь объявлена на пункте, а у
        // корня нет владельца.
        rootOwns: root.element.getAttribute('aria-owns'),
        submenuOwns: sub.element.getAttribute('aria-owns'),
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS });

    expect(result.reserved).not.toBe(null);
    expect(result.reservedBefore).toBe(false);
    expect(result.targetBeforeShow).toBe(false);
    expect(result.subIdBeforeShow).toBe(result.reserved);
    expect(result.owns).toBe(result.subId);
    expect(result.resolves).toBe(true);
    expect(result.insideOwner).toBe(false);
    expect(result.rootOwns).toBe(null);
    expect(result.submenuOwns).toBe(null);
  });

  test('aria-expanded: showSubmenu ставит пункту-владельцу aria-expanded=true', async ({ page }) => {
    const result = await page.evaluate(({ rootItems, subItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const owner = root.items[0];
      const before = owner.element.getAttribute('aria-expanded');

      const sub = layer.ensureLevel(subItems, root, 1, owner);
      layer.showSubmenu(sub);

      return {
        before,
        expanded: owner.element.getAttribute('aria-expanded'),
        // Соседний владелец, чьё подменю не открывали, остаётся свёрнутым: кейс
        // про состояние прошёл бы и с `true` у всех подряд.
        other: root.items[2].element.getAttribute('aria-expanded'),
        // Обычный пункт `aria-expanded` не имеет вовсе.
        plain: root.items[1].element.getAttribute('aria-expanded'),
        root: root.element.getAttribute('aria-expanded'),
        submenu: sub.element.getAttribute('aria-expanded'),
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS });

    expect(result.before).toBe('false');
    expect(result.expanded).toBe('true');
    expect(result.other).toBe('false');
    expect(result.plain).toBe(null);
    expect(result.root).toBe(null);
    expect(result.submenu).toBe(null);
  });
});

test.describe('закрытие', () => {
  test('закрытие: элемент скрывается после animationDuration', async ({ page }) => {
    // Настоящее движение: под `reduce` слой пропускает отложенное закрытие
    // целиком, и кейс проверял бы не отложенность, а пропуск.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const result = await page.evaluate(({ rootItems, subItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const sub = layer.ensureLevel(subItems, root, 1, root.items[0]);
      layer.showRoot(root, { x: 40, y: 40 });
      layer.showSubmenu(sub);

      layer.hide(sub);
      const closingDelay = probe.tasks[0]?.ms;
      const scheduled = probe.tasks.map((task) => {
        return task.ms;
      });
      // До истечения срока меню ещё в Top Layer: `hidePopover` убрал бы его
      // мгновенно, и выходной анимации не существовало бы.
      const beforeFire = {
        sub: sub.element.matches(':popover-open'),
        root: root.element.matches(':popover-open'),
      };
      const fired = probe.runTasks();
      const afterFire = {
        sub: sub.element.matches(':popover-open'),
        root: root.element.matches(':popover-open'),
      };

      return {
        subId: sub.element.id,
        scheduled,
        closingDelay,
        beforeFire,
        fired,
        afterFire,
        hides: probe.hides,
        entryOpen: sub.open,
        rootOpen: root.open,
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS });

    // Задача поставлена ровно одна и ровно на `options.animationDuration`. Сверка
    // идёт числом, а не «около»: `TEST_ANIMATION_DURATION` и умолчание из константы
    // различаются на 3 мс, и окно ±8 мс у кейса с настоящими часами такой сдвиг не
    // увидело бы.
    expect(result.scheduled).toEqual([TEST_ANIMATION_DURATION]);
    expect(result.closingDelay).toBe(TEST_ANIMATION_DURATION);
    expect(result.fired).toBe(1);
    // До срока подменю ещё открыто, корневое — тем более.
    expect(result.beforeFire).toEqual({ sub: true, root: true });
    expect(result.afterFire).toEqual({ sub: false, root: true });
    // `hidePopover` вызван ровно один раз и только на скрываемом уровне:
    // родитель из-под подменю не убирается.
    expect(result.hides).toEqual([result.subId]);
    expect(result.entryOpen).toBe(false);
    expect(result.rootOpen).toBe(true);
  });

  test('закрытие: повторное открытие до истечения задержки отменяет hidePopover', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const result = await page.evaluate(({ rootItems, subItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const sub = layer.ensureLevel(subItems, root, 1, root.items[0]);
      layer.showRoot(root, { x: 40, y: 40 });
      layer.showSubmenu(sub);

      layer.hide(sub);
      // Жест висящей задачи сохраняется: без него «отмена» проверялась бы
      // отсутствием задачи в списке, а её срабатывание — ничем.
      const stale = probe.tasks[0];
      layer.showSubmenu(sub);

      const afterShow = {
        open: sub.element.matches(':popover-open'),
        pending: probe.tasks.length,
        cancelled: probe.cancelled.length,
      };
      // Висящая задача всё равно выполняется — так это выглядит, если отмены
      // нет: снятый `setTimeout` не отзывается потерянной ссылкой.
      stale?.fn();
      const afterStale = {
        open: sub.element.matches(':popover-open'),
        hides: probe.hides.length,
      };

      return { afterShow, afterStale };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS });

    // Меню, которое открыли заново, не исчезает.
    expect(result.afterShow.open).toBe(true);
    // Задача снята с планировщика, а не просто помечена недействительной:
    // счётчик снятий это и различает.
    expect(result.afterShow.pending).toBe(0);
    expect(result.afterShow.cancelled).toBe(1);
    // Выполнение висящей задачи не закрывает заново открытое меню.
    expect(result.afterStale.open).toBe(true);
    expect(result.afterStale.hides).toBe(0);
  });

  test('поколения: отложенное закрытие старого поколения не трогает новое', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const result = await page.evaluate(({ rootItems, subItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const sub = layer.ensureLevel(subItems, root, 1, root.items[0]);
      // Контроль: `ensureLevel` обязан вернуть тот же уровень, иначе поколения
      // измерялись бы на подменённом объекте.
      const sameRoot = layer.ensureLevel(rootItems, null, 0, null) === root;

      const afterCreate = sub.generation;
      layer.showRoot(root, { x: 40, y: 40 });
      layer.showSubmenu(sub);
      const afterShow = sub.generation;
      layer.hide(sub);
      const afterHide = sub.generation;
      // Жест задачи первого поколения: после показа она снята, но выполниться
      // может — так это выглядит при неработающей отмене.
      const stale = probe.tasks[0];
      layer.showSubmenu(sub);
      const afterReopen = sub.generation;
      layer.hide(sub);
      const fresh = probe.tasks[0];

      stale?.fn();
      const afterStale = {
        open: sub.element.matches(':popover-open'),
        // Свежая задача обязана остаться в списке: задача старого поколения не
        // должна снимать чужую.
        pending: probe.tasks.length,
        hides: probe.hides.length,
      };
      fresh?.fn();
      const afterFresh = {
        open: sub.element.matches(':popover-open'),
        hides: probe.hides.length,
      };

      const generations = { afterCreate, afterShow, afterHide, afterReopen };
      return { generations, sameRoot, afterStale, afterFresh };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS });

    expect(result.sameRoot).toBe(true);
    // Поколение растёт на каждом показе и на каждом закрытии: иначе висящая
    // задача не отличила бы своё поколение от следующего.
    expect(result.generations).toEqual({
      afterCreate: 0,
      afterShow: 1,
      afterHide: 2,
      afterReopen: 3,
    });
    // Задача старого поколения не закрывает меню и не снимает задачу нового.
    expect(result.afterStale).toEqual({ open: true, pending: 1, hides: 0 });
    // Задача текущего поколения закрывает.
    expect(result.afterFresh.open).toBe(false);
    expect(result.afterFresh.hides).toBe(1);
  });

  test('отложенный период совпадает с animationDuration', async ({ page }) => {
    // Настоящее движение и настоящие часы: под `reduce` отложенности нет вовсе, а
    // задача, поставленная заглушкой, исполнилась бы по первому же чтению списка
    // и ничего не сказала бы о сроке.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(async ({ rootItems, subItems, duration, entryWait }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const layer = host.__vcProbe.real();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const sub = layer.ensureLevel(subItems, root, 1, root.items[0]);
      layer.showRoot(root, { x: 40, y: 40 });
      layer.showSubmenu(sub);
      /**
       * @param {number} ms
       * @returns {Promise<void>}
       */
      const wait = (ms) => {
        return new Promise((resolve) => {
          globalThis.setTimeout(resolve, ms);
        });
      };
      // Закрытие назначается, пока переход входа ещё идёт. Именно этим отличается
      // таймер от слушателя `transitionend`: слушатель поймал бы конец чужого,
      // идущего с момента показа, перехода и закрыл бы уровень раньше срока.
      await wait(entryWait);
      const at = globalThis.performance.now();
      // Контрольный таймер той же длительности ставится в ту же миллисекунду.
      // Его срабатывание несёт всю задержку платформы: она одинакова для обоих
      // таймеров, и потому вычитается, а не терпится допуском.
      let control = 0;
      globalThis.setTimeout(() => {
        control = globalThis.performance.now() - at;
      }, duration);
      layer.hide(sub);
      await wait(duration * 4);
      const marks = /** @type {{ __vcMarks: { control: number, hideAt: number } }} */ (
        /** @type {unknown} */ (globalThis)
      );
      marks.__vcMarks = { control, hideAt: at };
    }, {
      rootItems: ROOT_ITEMS,
      subItems: SUB_ITEMS,
      duration: TEST_ANIMATION_DURATION,
      entryWait: ENTRY_TRANSITION_WAIT_MS,
    });
    const marks = await page.evaluate(() => {
      const page_ = /** @type {{ __vcProbe: LayerProbe, __vcMarks: { control: number, hideAt: number } }} */ (
        /** @type {unknown} */ (globalThis)
      );
      return {
        control: page_.__vcMarks.control,
        hideAt: page_.__vcMarks.hideAt,
        hiddenAt: page_.__vcProbe.hiddenAt[page_.__vcProbe.hiddenAt.length - 1],
      };
    });

    // Премиса кейса: пауза обязана быть заметно меньше длительности, иначе
    // переход входа успеет завершиться и разница со сроком таймера исчезла бы —
    // кейс прошёл бы вхолостую, а не упал.
    expect(ENTRY_TRANSITION_WAIT_MS * 3).toBeLessThan(TEST_ANIMATION_DURATION);
    const elapsed = marks.hiddenAt - marks.hideAt;
    // Уровень не ушёл из Top Layer мгновенно: до срока он в нём и остаётся, и
    // переход `opacity` и `transform` всё это время идёт.
    expect(elapsed).toBeGreaterThan(ENTRY_TRANSITION_WAIT_MS + 20);
    // И ушёл не по чужому переходу: срок закрытия совпадает со сроком
    // контрольного таймера той же длительности. Допуск в 8 мс — меньше сдвига в
    // 10 мс, который кейс обязан ловить, и при этом заведомо больше разницы между
    // двумя таймерами, поставленными в одну миллисекунду.
    expect(Math.abs(elapsed - marks.control)).toBeLessThanOrEqual(8);
  });

  test('закрытие гасит уровень до ухода из Top Layer', async ({ page }) => {
    // Настоящее движение: под `reduce` отложенности нет вовсе, и гаснуть нечему —
    // там `transition: none`. Гашение проверяется на живом переходе CSS, поэтому
    // читается оно на середине затухания, настоящим временем.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const marks = await page.evaluate(async ({ rootItems, subItems, duration }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (
        /** @type {unknown} */ (globalThis)
      );
      const layer = host.__vcProbe.real();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const sub = layer.ensureLevel(subItems, root, 1, root.items[0]);
      layer.showRoot(root, { x: 40, y: 40 });
      layer.showSubmenu(sub);

      /**
       * @param {number} ms
       * @returns {Promise<void>}
       */
      const wait = (ms) => {
        return new Promise((resolve) => {
          globalThis.setTimeout(resolve, ms);
        });
      };
      // Переходу входа дано закончиться: иначе чтение «до закрытия» видело бы
      // стартовое значение из `@starting-style`, то есть ноль, и сравнивать было
      // бы не с чем.
      await wait(duration);

      const element = sub.element;
      const style = globalThis.getComputedStyle(element);
      const before = {
        closing: element.hasAttribute('data-vc-closing'),
        open: element.matches(':popover-open'),
        opacity: Number.parseFloat(style.opacity),
        pointerEvents: style.pointerEvents,
      };
      // Точка в геометрии подменю, и до закрытия она достаётся до самого меню:
      // иначе проверка снятия событий смотрела бы в пустоту.
      const rect = element.getBoundingClientRect();
      const point = {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      };
      /**
       * @returns {string | null} идентификатор меню под точкой, если попали.
       */
      const menuAt = () => {
        return document.elementFromPoint(point.x, point.y)?.closest('.vc-menu')?.id ?? null;
      };
      const hitBefore = menuAt();

      layer.hide(sub);
      const atHide = {
        // Уровень ещё в Top Layer: `hidePopover` впереди, по сроку.
        open: element.matches(':popover-open'),
        closing: element.hasAttribute('data-vc-closing'),
        // Прозрачность в эту же миллисекунду ещё прежняя: переход только что
        // начался и идёт от единицы.
        opacity: Number.parseFloat(style.opacity),
        // А события снимаются сразу, не дожидаясь перехода.
        pointerEvents: style.pointerEvents,
        // Проба попадания после `hide`: гаснущий уровень обязан её пропустить.
        hit: menuAt(),
      };

      // Середина затухания: к этому моменту `opacity` обязана быть и ненулевой
      // (гашение ещё идёт), и меньше единицы (оно уже началось).
      await wait(Math.round(duration / 2));
      const midFade = {
        opacity: Number.parseFloat(style.opacity),
        // Отметка пережила половину срока — иначе перезапуск гашения обрезал бы
        // анимацию.
        closing: element.hasAttribute('data-vc-closing'),
        // И всё это время уровень остаётся в Top Layer.
        open: element.matches(':popover-open'),
        pointerEvents: style.pointerEvents,
      };
      return { before, hitBefore, atHide, midFade, subId: sub.element.id };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS, duration: TEST_ANIMATION_DURATION });

    // До закрытия уровень обычный: непрозрачный, принимает события, отметки нет.
    // Прозрачность сравнивается границей, а не ровно единицей: хвост перехода
    // входа под нагрузкой не успевает завершиться, и чтение давало бы 0.999 —
    // измерять тут нечего, важно лишь, что меню непрозрачно.
    expect(marks.before.closing).toBe(false);
    expect(marks.before.open).toBe(true);
    expect(marks.before.opacity).toBeGreaterThan(0.98);
    expect(marks.before.pointerEvents).toBe('auto');
    // Контроль точки: до `hide` она достаётся до самого меню, значит
    // последующая разница — не следствие промаха по геометрии.
    expect(marks.hitBefore).toBe(marks.subId);
    // Отметка поставлена сразу, и уровень при этом ещё в Top Layer: гаснуть
    // должен тот узел, который ещё над страницей, а не тот, что уже вышел.
    expect(marks.atHide.open).toBe(true);
    expect(marks.atHide.closing).toBe(true);
    // Прозрачность в саму миллисекунду `hide` ещё прежняя — переход только
    // что пошёл, — поэтому граница, а не точное число.
    expect(marks.atHide.opacity).toBeGreaterThan(0.98);
    expect(marks.atHide.pointerEvents).toBe('none');
    expect(marks.atHide.hit).toBe(null);
    // Гашение идёт: на середине срока прозрачность между нулём и единицей. Без
    // правила `.vc-menu[data-vc-closing]` она осталась бы единицей — `:popover-open`
    // на месте, и менять нечего, а потеря `:popover-open` случится позже, уже вне
    // Top Layer.
    expect(marks.midFade.opacity).toBeGreaterThan(0.05);
    expect(marks.midFade.opacity).toBeLessThan(0.95);
    expect(marks.midFade.closing).toBe(true);
    expect(marks.midFade.open).toBe(true);
    expect(marks.midFade.pointerEvents).toBe('none');
  });

  test('reduced-motion: hidePopover вызывается немедленно, без задачи в планировщике', async ({ page }) => {
    // Эмуляция `reduce` уже стоит в `beforeEach`.
    const result = await page.evaluate(({ rootItems, subItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const reduced = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const sub = layer.ensureLevel(subItems, root, 1, root.items[0]);
      layer.showRoot(root, { x: 40, y: 40 });
      layer.showSubmenu(sub);

      layer.hide(sub);
      return {
        reduced,
        open: sub.element.matches(':popover-open'),
        // Задачи нет вовсе: пропуск отложенности, а не её сокращение. При
        // сокращённой задержке невидимое меню ещё доживало бы своего
        // `hidePopover` и съедало клики по странице.
        pending: probe.tasks.length,
        hides: probe.hides.length,
        entryOpen: sub.open,
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS });

    // Контроль: кейс обязан исполнить ветку `reduce`, иначе всё остальное
    // проверяло бы обычное отложенное закрытие.
    expect(result.reduced).toBe(true);
    expect(result.open).toBe(false);
    expect(result.pending).toBe(0);
    expect(result.hides).toBe(1);
    expect(result.entryOpen).toBe(false);
  });

  test('reduced-motion: значение медиазапроса читается в момент закрытия, а не при создании', async ({ page }) => {
    // Слой создаётся, когда `reduce` ещё не действует...
    await page.evaluate((rootItems) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      // Значение переключается между двумя оценками страницы, поэтому медиазапрос
      // подставляется заглушкой: у настоящего `matchMedia` под `emulateMedia`
      // закэшированный запрос в firefox остаётся с прежним значением, и кейс
      // зависел бы от того, как движок обновляет живые объекты. Проверяется
      // ровно контракт слоя — `.matches` читается при закрытии, — а не механизм
      // обновления `matchMedia`, за который отвечает платформа.
      const query = { matches: false };
      const page_ = /** @type {{ __vcQuery: { matches: boolean } }} */ (
        /** @type {unknown} */ (globalThis)
      );
      page_.__vcQuery = query;
      const layer = host.__vcProbe.keep({
        reducedMotionQuery: /** @type {MediaQueryList} */ (/** @type {unknown} */ (query)),
      });
      const entry = layer.ensureLevel(rootItems, null, 0, null);
      layer.showRoot(entry, { x: 40, y: 40 });
    }, ROOT_ITEMS);
    // ...а закрывается уже при `reduce`.
    const result = await page.evaluate((rootItems) => {
      const page_ = /** @type {{ __vcProbe: LayerProbe, __vcQuery: { matches: boolean } }} */ (
        /** @type {unknown} */ (globalThis)
      );
      const probe = page_.__vcProbe;
      const layer = probe.keep();
      const entry = layer.ensureLevel(rootItems, null, 0, null);

      // Первое закрытие при `matches: false` — отложенное. Это контроль кейса:
      // без него второе закрытие прошло бы и по значению, сохранённому при
      // создании слоя.
      layer.hide(entry);
      const deferred = {
        open: entry.element.matches(':popover-open'),
        pending: probe.tasks.length,
      };

      layer.showRoot(entry, { x: 40, y: 40 });
      page_.__vcQuery.matches = true;
      layer.hide(entry);
      return {
        deferred,
        immediate: {
          open: entry.element.matches(':popover-open'),
          pending: probe.tasks.length,
        },
      };
    }, ROOT_ITEMS);

    expect(result.deferred).toEqual({ open: true, pending: 1 });
    // Медиазапрос прочитан в момент закрытия: значение из момента создания слоя
    // не сохранилось, и второй вызов `hide` закрыл уровень сразу и без задачи.
    expect(result.immediate).toEqual({ open: false, pending: 0 });
  });

  test('hideAll: скрывает всю цепочку, от глубоких к корню', async ({ page }) => {
    const result = await page.evaluate(({ rootItems, subItems, nestedItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const first = layer.ensureLevel(nestedItems, root, 1, root.items[0]);
      const second = layer.ensureLevel(subItems, root, 1, root.items[2]);
      const deep = layer.ensureLevel(subItems, first, 2, first.items[0]);
      layer.showRoot(root, { x: 40, y: 40 });
      layer.showSubmenu(first);
      layer.showSubmenu(second);
      layer.showSubmenu(deep);

      layer.hideAll();
      return {
        // Порядок вызовов `hidePopover` — это порядок обхода цепочки.
        hides: probe.hides,
        ids: {
          root: root.element.id,
          first: first.element.id,
          second: second.element.id,
          deep: deep.element.id,
        },
        // Под `reduce` отложенности нет, и порядок виден сразу: иначе он
        // проявился бы только после выполнения задач.
        pending: probe.tasks.length,
        open: [root, first, second, deep].map((entry) => {
          return entry.element.matches(':popover-open');
        }),
        entriesOpen: [root, first, second, deep].map((entry) => {
          return entry.open;
        }),
        // У каждого скрытого уровня снята отметка развёрнутости у его владельца,
        // и только у владельцев.
        expanded: [
          root.items[0].element.getAttribute('aria-expanded'),
          root.items[2].element.getAttribute('aria-expanded'),
          first.items[0].element.getAttribute('aria-expanded'),
          root.items[1].element.getAttribute('aria-expanded'),
        ],
        // DOM не уничтожается: меню переиспользуется при следующем открытии.
        connected: [root, first, second, deep].map((entry) => {
          return entry.element.isConnected;
        }),
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS, nestedItems: NESTED_ITEMS });

    // Убывание глубины, и потомок всегда раньше предка: иначе родитель исчез бы
    // из-под подменю, и закрывающееся подменю осталось бы висеть поверх
    // пустоты. Соседние ветки уходят на своей глубине в порядке создания, и
    // `second` (глубина 1) не обгоняет `deep` (глубина 2).
    expect(result.hides).toEqual([
      result.ids.deep,
      result.ids.first,
      result.ids.second,
      result.ids.root,
    ]);
    expect(result.pending).toBe(0);
    expect(result.open).toEqual([false, false, false, false]);
    expect(result.entriesOpen).toEqual([false, false, false, false]);
    // Владельцы всех трёх подменю свёрнуты, обычный пункт отметки не имел.
    expect(result.expanded).toEqual([null, null, null, null]);
    // Уровни остались в DOM: ленивость из спеки держится на переиспользовании.
    expect(result.connected).toEqual([true, true, true, true]);
  });

  test('animationDuration без опции достаётся слою из константы', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const result = await page.evaluate((rootItems) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.bare();
      const entry = layer.ensureLevel(rootItems, null, 0, null);
      layer.showRoot(entry, { x: 40, y: 40 });
      layer.hide(entry);
      return {
        scheduled: probe.tasks.map((task) => {
          return task.ms;
        }),
        // Длительность уходит и в CSS: от неё зависят переходы меню, пункта и
        // шеврона, и отложенное закрытие обязано ждать ровно столько же.
        token: getComputedStyle(entry.element)
          .getPropertyValue('--vc-animation-duration')
          .trim(),
      };
    }, ROOT_ITEMS);

    expect(result.scheduled).toEqual([DEFAULT_ANIMATION_DURATION]);
    expect(result.token).toBe(`${DEFAULT_ANIMATION_DURATION}ms`);
  });
});

test.describe('уровни', () => {
  test('ensureLevel: повторный вызов с теми же аргументами возвращает тот же LevelEntry', async ({ page }) => {
    const result = await page.evaluate(({ rootItems, subItems, nestedItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const rootAgain = layer.ensureLevel(rootItems, null, 0, null);
      const first = layer.ensureLevel(nestedItems, root, 1, root.items[0]);
      const firstAgain = layer.ensureLevel(nestedItems, root, 1, root.items[0]);
      // Другая ветка: тот же уровень, другой пункт-владелец — другой уровень.
      const other = layer.ensureLevel(subItems, root, 1, root.items[2]);
      // Третий уровень под первым подменю.
      const deep = layer.ensureLevel(subItems, first, 2, first.items[0]);
      const deepAgain = layer.ensureLevel(subItems, first, 2, first.items[0]);

      return {
        sameRoot: rootAgain === root,
        sameElement: rootAgain.element === root.element,
        sameItems: rootAgain.items === root.items,
        sameFirst: firstAgain === first,
        sameDeep: deepAgain === deep,
        distinctBranches: other !== first,
        distinctLevels: deep !== first,
        // Повторный вызов не плодит уровни: иначе цепочка разрасталась бы с
        // каждым наведением.
        rootChildren: root.children.length,
        firstChildren: first.children.length,
        // Показов не было: `ensureLevel` строит, но не показывает.
        shown: probe.shows.length,
        // Начальное состояние уровня. Поколение и активный индекс обязаны
        // начинаться с нуля и минус единицы: с любого другого значения первое же
        // отложенное закрытие сочло бы себя устаревшим.
        state: {
          open: first.open,
          generation: first.generation,
          activeIndex: first.activeIndex,
        },
        links: {
          parent: first.parent === root,
          ownerItem: first.ownerItem === root.items[0],
          deepParent: deep.parent === first,
          deepOwner: deep.ownerItem === first.items[0],
          rootParent: root.parent,
          rootOwner: root.ownerItem,
          rootChildrenContain: root.children.includes(first)
            && root.children.includes(other),
        },
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS, nestedItems: NESTED_ITEMS });

    expect(result.sameRoot).toBe(true);
    expect(result.sameElement).toBe(true);
    expect(result.sameItems).toBe(true);
    expect(result.sameFirst).toBe(true);
    expect(result.sameDeep).toBe(true);
    expect(result.distinctBranches).toBe(true);
    expect(result.distinctLevels).toBe(true);
    expect(result.rootChildren).toBe(2);
    expect(result.firstChildren).toBe(1);
    expect(result.shown).toBe(0);
    expect(result.state).toEqual({ open: false, generation: 0, activeIndex: -1 });
    expect(result.links).toEqual({
      parent: true,
      ownerItem: true,
      deepParent: true,
      deepOwner: true,
      rootParent: null,
      rootOwner: null,
      rootChildrenContain: true,
    });
  });

  test('menuId: у каждого уровня свой vc- идентификатор, а у подменю он совпадает с зарезервированным aria-owns', async ({ page }) => {
    const result = await page.evaluate(({ rootItems, subItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const first = probe.create();
      const second = probe.create();
      const root = first.ensureLevel(rootItems, null, 0, null);
      const sub = first.ensureLevel(subItems, root, 1, root.items[0]);
      // Второй экземпляр на той же глубине: различает их только `menuId`, и от
      // него зависит безопасность ключа пункта в общей карте.
      const otherRoot = second.ensureLevel(rootItems, null, 0, null);

      const ids = {
        root: root.element.id,
        sub: sub.element.id,
        otherRoot: otherRoot.element.id,
      };
      const all = [ids.root, ids.sub, ids.otherRoot];
      return {
        ids,
        // Идентификаторы библиотеки не должны совпадать с идентификаторами
        // страницы: сохранённый `id` внутри очищенной svg-иконки позволяет
        // `use href="#id"` сослаться на чужой элемент.
        prefixed: all.every((id) => {
          return id.startsWith('vc-');
        }),
        unique: new Set(all).size === all.length,
        // Подменю обязано занять именно зарезервированный владельцем адрес.
        reserved: root.items[0].element.getAttribute('aria-owns'),
        // Ключи пунктов в общей карте не совпали между экземплярами: при
        // одинаковом `menuId` второй экземпляр перезаписал бы первый, и
        // активация пункта одного вызвала бы действие другого.
        firstItems: [...probe.actions.keys()].filter((key) => {
          return key.startsWith(`${ids.root}:`);
        }),
        otherItems: [...probe.actions.keys()].filter((key) => {
          return key.startsWith(`${ids.otherRoot}:`);
        }),
        // Глубина при этом не сдвинулась: `aria-level` у второго экземпляра тоже
        // первый. Объявлен он на пункте, а не на уровне: `aria-level` описывает
        // положение пункта в дереве меню, и уровень его не имеет.
        rootLevel: root.items[0].element.getAttribute('aria-level'),
        subLevel: sub.items[0].element.getAttribute('aria-level'),
        otherLevel: otherRoot.items[0].element.getAttribute('aria-level'),
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS });

    expect(result.prefixed).toBe(true);
    expect(result.unique).toBe(true);
    expect(result.ids.sub).toBe(result.reserved);
    // Четыре пункта без разделителя у каждого экземпляра, и ключи разные.
    expect(result.firstItems).toEqual([0, 1, 2, 4].map((index) => {
      return `${result.ids.root}:${index}`;
    }));
    expect(result.otherItems).toEqual([0, 1, 2, 4].map((index) => {
      return `${result.ids.otherRoot}:${index}`;
    }));
    expect(result.rootLevel).toBe('1');
    expect(result.subLevel).toBe('2');
    expect(result.otherLevel).toBe('1');
  });

  test('actions: карта общая для всех уровней и пополняется только', async ({ page }) => {
    const result = await page.evaluate(({ rootItems, subItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const rootId = root.element.id;
      const afterRoot = [...probe.actions.keys()];
      const sub = layer.ensureLevel(subItems, root, 1, root.items[0]);
      const subId = sub.element.id;
      const afterSub = [...probe.actions.keys()];
      // Разделитель не получает записи: коллбэка у него нет.
      const separatorKeyed = probe.actions.has(`${rootId}:3`);

      // Уровни другого экземпляра пишут в ту же карту.
      const other = probe.create().ensureLevel(rootItems, null, 0, null);
      const otherRootId = other.element.id;
      const afterOther = [...probe.actions.keys()];
      const sizeBeforeDestroy = probe.actions.size;

      layer.destroy();
      return {
        ids: { root: rootId, sub: subId, otherRoot: otherRootId },
        afterRoot,
        afterSub,
        afterOther,
        afterDestroy: [...probe.actions.keys()],
        sizeBeforeDestroy,
        // Записи уровня — те, чей ключ начинается с его `menuId`.
        rootKeys: afterSub.filter((key) => {
          return key.startsWith(`${rootId}:`);
        }).length,
        subKeys: afterSub.filter((key) => {
          return key.startsWith(`${subId}:`);
        }).length,
        separatorKeyed,
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS });

    // Четыре пункта без разделителя.
    expect(result.afterRoot).toEqual([0, 1, 2, 4].map((index) => {
      return `${result.ids.root}:${index}`;
    }));
    // Карта пополняется, а не заменяется: записи корневого уровня уцелели.
    expect(result.afterSub.slice(0, result.afterRoot.length)).toEqual(result.afterRoot);
    expect(result.rootKeys).toBe(4);
    expect(result.subKeys).toBe(3);
    expect(result.separatorKeyed).toBe(false);
    // Второй экземпляр дописал свои записи в ту же карту.
    expect(result.afterOther.length).toBe(result.afterSub.length + 4);
    expect(new Set(result.afterOther).size).toBe(result.afterOther.length);
    // `destroy` карту не вычищает: карта пополняется только, а её записи
    // недостижимы, потому что обращения идут по узлам.
    expect(result.afterDestroy).toEqual(result.afterOther);
    expect(result.sizeBeforeDestroy).toBe(result.afterDestroy.length);
  });

  test('тема и длительность достаются до каждого уровня', async ({ page }) => {
    const result = await page.evaluate(({ rootItems, subItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create({ theme: 'dark' });
      const root = layer.ensureLevel(rootItems, null, 0, null);
      const sub = layer.ensureLevel(subItems, root, 1, root.items[2]);
      // Уровень обязан быть показан: у отцепленного узла `getComputedStyle` не
      // вычисляет и пользовательские свойства, и проверка была бы пустой.
      layer.showRoot(root, { x: 40, y: 40 });
      layer.showSubmenu(sub);
      /**
       * @param {HTMLElement} element
       * @returns {string}
       */
      const durationOf = (element) => {
        return getComputedStyle(element)
          .getPropertyValue('--vc-animation-duration')
          .trim();
      };
      return {
        themes: [root.element.dataset.vcTheme, sub.element.dataset.vcTheme],
        // Пробная длительность не круглая: значение по умолчанию из таблицы стилей
        // равно `140ms`, и с ним сравнение прошло бы при полном отсутствии
        // `applyAnimationDuration`.
        durations: [durationOf(root.element), durationOf(sub.element)],
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS });

    // Тема достаётся и до подменю: подменю — часть того же меню, и оформлено
    // оно тем же набором токенов.
    expect(result.themes).toEqual(['dark', 'dark']);
    // Длительность одна на все уровни слоя, и она же идёт в задержку закрытия.
    expect(result.durations).toEqual([
      `${TEST_ANIMATION_DURATION}ms`,
      `${TEST_ANIMATION_DURATION}ms`,
    ]);
  });

  test('destroy: элементы удалены из DOM, document.body чист', async ({ page }) => {
    // Настоящее движение: под `reduce` отложенного закрытия не было бы и висящих
    // задач тоже, а снимать было бы нечего.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const result = await page.evaluate(({ rootItems, subItems, nestedItems }) => {
      const host = /** @type { { __vcProbe: LayerProbe } } */ (/** @type { unknown } */ (globalThis));
      const probe = host.__vcProbe;
      const layer = probe.create();
      /**
       * @returns {string[]}
       */
      const bodyIds = () => {
        return Array.from(document.body.children, (node) => {
          return node.id === '' ? node.tagName : node.id;
        });
      };
      const before = bodyIds();

      const root = layer.ensureLevel(rootItems, null, 0, null);
      const sub = layer.ensureLevel(nestedItems, root, 1, root.items[0]);
      const deep = layer.ensureLevel(subItems, sub, 2, sub.items[0]);
      layer.showRoot(root, { x: 40, y: 40 });
      layer.showSubmenu(sub);
      layer.showSubmenu(deep);
      // Никогда не показанный уровень: `destroy` обязан убрать и его, а
      // `ensureLevel` — не оставлять его подключённым к документу.
      const untouched = layer.ensureLevel(subItems, root, 1, root.items[2]);
      layer.hide(deep);

      const whileOpen = {
        body: bodyIds(),
        pending: probe.tasks.length,
        untouchedConnected: untouched.element.isConnected,
      };
      const actionsBeforeDestroy = probe.actions.size;
      layer.destroy();
      const entries = [root, sub, deep, untouched];
      const after = {
        body: bodyIds(),
        pending: probe.tasks.length,
        cancelled: probe.cancelled.length,
        // `hidePopover` на каждом заведённом элементе, включая непоказанный.
        hides: probe.hides.length,
        connected: entries.map((entry) => {
          return entry.element.isConnected;
        }),
        open: entries.map((entry) => {
          return entry.element.matches(':popover-open');
        }),
        entriesOpen: entries.map((entry) => {
          return entry.open;
        }),
        // Идентификаторы больше не разрешаются: `id` не должен утекать в
        // `aria-owns` других уровней.
        resolves: entries.map((entry) => {
          return document.getElementById(entry.element.id);
        }),
      };

      // Повторный `destroy` безопасен, и закрытие после него — тоже: движок
      // вызывает их в порядке уборки.
      let secondDestroyThrew = false;
      try {
        layer.destroy();
        layer.hideAll();
      } catch {
        secondDestroyThrew = true;
      }

      return {
        before,
        whileOpen,
        after,
        secondDestroyThrew,
        // Карта активов пережила `destroy`.
        actionsBeforeDestroy,
        actionsAfterDestroy: probe.actions.size,
      };
    }, { rootItems: ROOT_ITEMS, subItems: SUB_ITEMS, nestedItems: NESTED_ITEMS });

    // До слоя в `<body>` пусто; показаны три уровня, четвёртый не подключён.
    expect(result.before).toEqual([]);
    expect(result.whileOpen.body).toHaveLength(3);
    expect(result.whileOpen.untouchedConnected).toBe(false);
    expect(result.whileOpen.pending).toBe(1);
    // Ни одного своего элемента в документе не осталось.
    expect(result.after.body).toEqual(result.before);
    expect(result.after.connected).toEqual([false, false, false, false]);
    expect(result.after.open).toEqual([false, false, false, false]);
    expect(result.after.entriesOpen).toEqual([false, false, false, false]);
    expect(result.after.resolves).toEqual([null, null, null, null]);
    // Четыре вызова `hidePopover` — по одному на каждый заведённый уровень, —
    // и снята единственная висящая задача.
    expect(result.after.hides).toBe(4);
    expect(result.after.cancelled).toBe(1);
    expect(result.after.pending).toBe(0);
    expect(result.secondDestroyThrew).toBe(false);
    expect(result.actionsAfterDestroy).toBe(result.actionsBeforeDestroy);
  });
});

