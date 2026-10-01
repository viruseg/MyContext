import { expect, test } from '@playwright/test';

/**
 * `open({ x, y }, { dismissible })` — показ, за который отвечает чужой код.
 *
 * Правила закрытия живут на глобальных слушателях, а их заводит `attach()`. Меню,
 * открытое не от нажатия по привязанному контейнеру, остаётся без них: клик мимо,
 * прокрутка и `resize` его не гасят, и оно висит до `close()`, `Escape`, `Tab` или
 * клика по пункту. `dismissible` поднимает правила на время показа.
 *
 * Кейсы ниже проверяют контракт `dismissible` и границы его действия: работа
 * самих правил закрытия покрыта `pressAndHold.spec.js` и `globals.spec.js`.
 *
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 */

const STYLESHEET_PATH = '/styles/mycontext.css';

const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <body style="background: rgb(255, 255, 255)">
    <div id="surface" tabindex="-1"
         style="position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: rgb(240, 240, 240)">
    </div>
    <div style="height: 2000px"></div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };

/** Точка в пустоте страницы: меню от неё развернётся вправо. */
const SHOW_POINT = { x: 260, y: 120 };

/** Точка в пустоте страницы вне меню и вне привязанного контейнера. */
const OUTSIDE_POINT = { x: 900, y: 600 };

test.beforeEach(async ({ page }) => {
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
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { MyContext } = await import('../../src/index.js');

    /** @type {string[]} */
    const errors = [];
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });

    /**
     * @param {string} label
     * @returns {MenuItem}
     */
    function item(label) {
      return { labelAction: () => label, action: () => {} };
    }

    /** @type {InstanceType<typeof MyContext>[]} */
    const made = [];

    /**
     * @returns {InstanceType<typeof MyContext>}
     * @throws {Error} если меню не создано.
     */
    function current() {
      const menu = made[0];
      if (menu === undefined) {
        throw new Error('меню не создано');
      }
      return menu;
    }

    /**
     * @returns {HTMLElement}
     * @throws {Error} если подложки на странице нет.
     */
    function surface() {
      const node = document.getElementById('surface');
      if (!(node instanceof HTMLElement)) {
        throw new Error('подложки нет');
      }
      return node;
    }

    const scope = /** @type {{ __dismissible?: DismissibleProbe }} */
      (/** @type {unknown} */ (globalThis));
    scope.__dismissible = {
      /** @param {DismissibleInput} input */
      make(input) {
        for (const previous of made) {
          previous.destroy();
        }
        made.length = 0;
        errors.length = 0;
        made.push(new MyContext(
          [item('Первый'), { labelAction: () => 'Ветка', submenuAction: () => [item('Лист')] }],
          { label: 'Меню', autoHideDistance: input.autoHideDistance ?? 0 },
        ));
        if (input.attach === true) {
          current().attach(surface());
        }
      },
      /**
       * @param {{ x: number, y: number }} point
       * @param {boolean} dismissible
       */
      open(point, dismissible) {
        current().open({ x: point.x, y: point.y }, { dismissible });
      },
      close() {
        current().close();
      },
      /**
       * Привязка после показа: подписка уже поднята показом, и `attach()` обязан её
       * перенять, а не задублировать.
       */
      attach() {
        current().attach(surface());
      },
      /**
       * Сколько обработчиков осталось на документе и окне после всех показов:
       * правила, поднятые ради показа, обязаны уйти вместе с закрытием.
       *
       * @returns {number}
       */
      subscriptionCount() {
        return subscriptions;
      },
      read() {
        return {
          openCount: document.querySelectorAll('.vc-menu:popover-open').length,
          errors: errors.slice(),
        };
      },
    };

    // Считаются живые подписки, а не вызовы `addEventListener`: снятие вызывает
    // `removeEventListener`, и счётчик добавлений после закрытия показывал бы
    // столько же, сколько до показа, — то есть ничего.
    let subscriptions = 0;

    const addOnDocument = document.addEventListener.bind(document);
    const removeOnDocument = document.removeEventListener.bind(document);
    const addOnWindow = window.addEventListener.bind(window);
    const removeOnWindow = window.removeEventListener.bind(window);

    /**
     * Считаются все вызовы без исключения: счётчик, молча пропускающий часть вызовов,
     * соврал бы втихую, а молчаливый счётчик в проверке утечки ничего не проверяет.
     *
     * @param {number} delta
     * @param {boolean | AddEventListenerOptions | EventListenerOptions} [options]
     * @returns {void}
     */
    const count = (delta, options) => {
      subscriptions += delta;
      void options;
    };

    /**
     * @param {string} type
     * @param {EventListenerOrEventListenerObject} callback
     * @param {boolean | AddEventListenerOptions} [options]
     * @returns {void}
     */
    function onDocumentAdd(type, callback, options) {
      count(1, options);
      addOnDocument(type, callback, options);
    }

    /**
     * @param {string} type
     * @param {EventListenerOrEventListenerObject} callback
     * @param {boolean | EventListenerOptions} [options]
     * @returns {void}
     */
    function onDocumentRemove(type, callback, options) {
      count(-1, options);
      removeOnDocument(type, callback, options);
    }

    /**
     * @param {string} type
     * @param {EventListenerOrEventListenerObject} callback
     * @param {boolean | AddEventListenerOptions} [options]
     * @returns {void}
     */
    function onWindowAdd(type, callback, options) {
      count(1, options);
      addOnWindow(type, callback, options);
    }

    /**
     * @param {string} type
     * @param {EventListenerOrEventListenerObject} callback
     * @param {boolean | EventListenerOptions} [options]
     * @returns {void}
     */
    function onWindowRemove(type, callback, options) {
      count(-1, options);
      removeOnWindow(type, callback, options);
    }

    document.addEventListener = onDocumentAdd;
    document.removeEventListener = onDocumentRemove;
    window.addEventListener = onWindowAdd;
    window.removeEventListener = onWindowRemove;
  });
});

/**
 * @typedef {object} DismissibleInput
 * @property {boolean} [attach] привязать ли контейнер сразу при создании.
 * @property {number} [autoHideDistance] порог автоскрытия, `0` — выключено.
 */

/**
 * @typedef {object} DismissibleProbe
 * @property {(input: DismissibleInput) => void} make
 * @property {(point: { x: number, y: number }, dismissible: boolean) => void} open
 * @property {() => void} close
 * @property {() => void} attach
 * @property {() => number} subscriptionCount
 * @property {() => DismissibleSnapshot} read
 */

/**
 * @typedef {object} DismissibleSnapshot
 * @property {number} openCount
 * @property {string[]} errors
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {DismissibleInput} input
 * @returns {Promise<void>}
 */
function makeMenu(page, input) {
  return page.evaluate((config) => {
    const scope = /** @type {{ __dismissible: DismissibleProbe }} */
      (/** @type {unknown} */ (globalThis));
    scope.__dismissible.make(config);
  }, input);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point
 * @param {boolean} [dismissible]
 * @returns {Promise<void>}
 */
function openMenu(page, point, dismissible = false) {
  return page.evaluate(
    (config) => {
      const scope = /** @type {{ __dismissible: DismissibleProbe }} */
        (/** @type {unknown} */ (globalThis));
      scope.__dismissible.open(config.point, config.dismissible);
    },
    { point, dismissible },
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<DismissibleSnapshot>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __dismissible: DismissibleProbe }} */
      (/** @type {unknown} */ (globalThis));
    return scope.__dismissible.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
function subscriptionCount(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __dismissible: DismissibleProbe }} */
      (/** @type {unknown} */ (globalThis));
    return scope.__dismissible.subscriptionCount();
  });
}

/**
 * Привязка поверх уже показанного меню: `attach()` перенимает подписку показа и
 * возвращает её себе, а не оставляет флаг показа в силе — иначе закрытие снесло бы
 * подписку привязки, и привязанный экземпляр перестал бы закрываться кликом мимо.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function attachAfterOpen(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __dismissible: DismissibleProbe }} */
      (/** @type {unknown} */ (globalThis));
    scope.__dismissible.attach();
  });
}

test.describe('open с dismissible', () => {
  test('клик вне меню закрывает показанное с dismissible', async ({ page }) => {
    // Смысл опции: меню открывает чужой код, и без неё клик мимо его не гасил бы —
    // привязки нет, а значит нет и глобальных слушателей.
    await makeMenu(page, { attach: false });
    await openMenu(page, SHOW_POINT, true);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.click(OUTSIDE_POINT.x, OUTSIDE_POINT.y);
    expect((await readMenu(page)).openCount, 'клик вне закрыл меню').toBe(0);
    expect((await readMenu(page)).errors, 'ошибок страницы нет').toEqual([]);
  });

  test('правый клик вне меню закрывает показанное с dismissible', async ({ page }) => {
    // В приложении, где правый клик — основной жест, именно он открывает чужое
    // меню по другому элементу. Оставленное висеть меню перекрыло бы кольцо.
    await makeMenu(page, { attach: false });
    await openMenu(page, SHOW_POINT, true);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.click(OUTSIDE_POINT.x, OUTSIDE_POINT.y, { button: 'right' });
    expect((await readMenu(page)).openCount, 'правый клик вне закрыл меню').toBe(0);
  });

  test('прокрутка страницы закрывает показанное с dismissible', async ({ page }) => {
    await makeMenu(page, { attach: false });
    await openMenu(page, SHOW_POINT, true);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    // Событие `scroll` доставляется браузером уже после возврата из `scrollTo`, поэтому
    // снимок сразу после вызова читает состояние до обработчика, и кейс мигает между
    // прогонами. Ожидание условия честнее утверждения.
    await page.evaluate(() => {
      window.scrollTo(0, 400);
    });
    await page.waitForFunction(() => {
      const levels = Array.from(document.querySelectorAll('.vc-menu'));
      return levels.length > 0 && levels.every((level) => !level.matches(':popover-open'));
    });
    expect(await page.evaluate(() => window.scrollY), 'страница прокрутилась').toBeGreaterThan(0);
    expect((await readMenu(page)).openCount, 'прокрутка закрыла меню').toBe(0);
  });

  test('без dismissible клик вне меню его не закрывает', async ({ page }) => {
    // Поведение прежнее, и без опции оно прежнее: молча не поднятые правила
    // выдали бы опцию за сработавшую.
    await makeMenu(page, { attach: false });
    await openMenu(page, SHOW_POINT, false);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.click(OUTSIDE_POINT.x, OUTSIDE_POINT.y);
    expect((await readMenu(page)).openCount, 'меню осталось висеть').toBe(1);
  });

  test('правила закрытия снимаются вместе с меню, а не остаются на странице', async ({ page }) => {
    // Экземпляр заводят на каждый показ — так дешевле, чем держать один и пересобирать
    // состав. Подписка, оставшаяся после закрытия, копилась бы на странице.
    await makeMenu(page, { attach: false });
    const before = await subscriptionCount(page);

    await openMenu(page, SHOW_POINT, true);
    const during = await subscriptionCount(page);
    expect(during, 'показ поднял глобальные слушатели').toBeGreaterThan(before);

    await page.mouse.click(OUTSIDE_POINT.x, OUTSIDE_POINT.y);
    expect((await readMenu(page)).openCount, 'меню закрыто').toBe(0);
    expect(await subscriptionCount(page), 'закрытие сняло слушатели').toBe(before);
  });

  test('у привязанного экземпляра dismissible ничего не меняет', async ({ page }) => {
    // Правила уже подняты и держатся между показами, пока жив attach(). Повторный
    // показ не должен ни удвоить подписку, ни снять её закрытием.
    await makeMenu(page, { attach: true });
    const before = await subscriptionCount(page);

    await openMenu(page, SHOW_POINT, true);
    expect(await subscriptionCount(page), 'подписка не удвоилась').toBe(before);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.click(OUTSIDE_POINT.x, OUTSIDE_POINT.y);
    expect((await readMenu(page)).openCount, 'привязанное меню закрылось кликом вне').toBe(0);
    expect(await subscriptionCount(page), 'привязка держит подписку').toBe(before);
  });

  test('подменю и клавиатура работают при dismissible', async ({ page }) => {
    // Опция поднимает правила закрытия и ничего больше: показ, подменю и клавиатура
    // те же. Иначе «одно меню из другого» открывало бы урезанное меню.
    await makeMenu(page, { attach: false });
    await openMenu(page, SHOW_POINT, true);
    // Раскрытие с клавиатуры идёт от отмеченного пункта, а отметку ставит наведение
    // или `ArrowDown`. Отметить надо второй пункт — у первого подменю нет, и
    // `ArrowRight` на нём не сделал бы ничего.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    const open = await readMenu(page);
    expect(open.openCount, 'подменю раскрыто с клавиатуры').toBe(2);
    expect(open.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('привязка поверх dismissible-показа перехватывает подписку', async ({ page }) => {
    // `attach()` после показа обязан забрать подписку себе: показ поднял её и пометил
    // «снимется на закрытии», а привязка держит её между показами. Если пометка
    // пережила бы `attach()`, закрытие снесло бы подписку привязки, и привязанный
    // экземпляр со второго показа перестал бы закрываться кликом мимо.
    await makeMenu(page, { attach: false });
    await openMenu(page, SHOW_POINT, true);
    const before = await subscriptionCount(page);
    expect(before, 'показ поднял подписку').toBeGreaterThan(0);

    await attachAfterOpen(page);
    expect((await readMenu(page)).openCount, 'меню осталось открыто').toBe(1);
    expect(await subscriptionCount(page), 'привязка не удвоила подписку').toBe(before);

    await page.keyboard.press('Escape');
    expect((await readMenu(page)).openCount, 'меню закрыто').toBe(0);
    expect(await subscriptionCount(page), 'закрытие не снесло подписку привязки').toBe(before);

    await openMenu(page, SHOW_POINT, false);
    await page.mouse.click(OUTSIDE_POINT.x, OUTSIDE_POINT.y);
    expect((await readMenu(page)).openCount, 'привязка и дальше закрывает кликом вне').toBe(0);
  });

  test('dismissible поднимает и autoHideDistance', async ({ page }) => {
    // Строка автоскрытия лежит в той же таблице слушателей, что и остальные правила,
    // поэтому непривязанный экземпляр, который прежде автоскрытия не знал, после
    // `dismissible` спрячется по первому движению курсора. Это заявлено в README, и
    // кейс падает, если правило уедет за пределы привязки.
    await makeMenu(page, { attach: false, autoHideDistance: 200 });
    await openMenu(page, SHOW_POINT, true);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.move(OUTSIDE_POINT.x, OUTSIDE_POINT.y);
    expect((await readMenu(page)).openCount, 'уход курсора закрыл меню').toBe(0);
  });

  test('без dismissible автоскрытия у непривязанного экземпляра нет', async ({ page }) => {
    // Контроль к предыдущему кейсу: тот же порог, тот же уход курсора, но без опции.
    // Правило не поднято, и меню остаётся — иначе кейс выше проверял бы не опцию, а
    // само автоскрытие.
    await makeMenu(page, { attach: false, autoHideDistance: 200 });
    await openMenu(page, SHOW_POINT, false);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.move(OUTSIDE_POINT.x, OUTSIDE_POINT.y);
    expect((await readMenu(page)).openCount, 'меню осталось висеть').toBe(1);
  });

  test('dismissible: не-логическое значение отклоняется', async ({ page }) => {
    // Молча не поднятые правила оставили бы меню висеть и выдали бы опцию за
    // сработавшую, поэтому значение проверяется по форме.
    await makeMenu(page, { attach: false });
    const outcome = await page.evaluate(() => {
      const scope = /** @type {{ __dismissible: DismissibleProbe }} */
        (/** @type {unknown} */ (globalThis));
      try {
        scope.__dismissible.open(
          { x: 260, y: 120 },
          /** @type {boolean} */ (/** @type {unknown} */ ('yes')),
        );
        return { threw: false, message: '' };
      } catch (error) {
        return { threw: true, message: error instanceof Error ? error.message : String(error) };
      }
    });
    expect(outcome.threw, 'open бросил ошибку').toBe(true);
    expect(outcome.message).toContain('dismissible');
    expect((await readMenu(page)).openCount, 'меню не показано').toBe(0);
  });
});
