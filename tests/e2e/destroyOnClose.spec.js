import { expect, test } from '@playwright/test';

/**
 * `options.destroyOnClose` — меню, заведённое ради одного показа.
 *
 * Экземпляр, который автор создаёт на каждый показ, никто не разбирает: ссылки на
 * него нет ни у кого, кроме автора обработчика, а он к следующему показу её уже
 * не имеет. Между показами такой экземпляр остаётся жив и держит на странице всё,
 * из чего он собран: слушатель `contextmenu` на контейнере, глобальные правила
 * закрытия, уровни в DOM и запись в реестре живых. По одному разу на каждый показ.
 *
 * Опция снимает эту работу на закрытии: закрытие не только гасит уровни, но и
 * разбирает экземпляр целиком. Показ при этом доживает своей анимации выхода —
 * снятие узлов отложено до её конца, — иначе меню, рассчитанное на один показ,
 * ещё и пропадало бы без фейда.
 *
 * Разбор наступает на **любом** закрытии, потому что закрытие у экземпляра одно:
 * клик по пункту, `Escape`, клик вне, прокрутка, `resize`, уход вкладки в фон,
 * потеря фокуса окна, автоскрытие, `close()` и `MyContext.closeAll()`. Проверяются
 * все пути, кроме автоскрытия и удержания: их правила закрытия покрыты
 * `autoHide.spec.js` и `pressAndHold.spec.js`, а предмет здесь — разбор после них.
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

/** Точка в подложке: правый клик по ней открывает привязанное меню. */
const SHOW_POINT = { x: 260, y: 120 };

/** Точка в подложке вне меню. */
const OUTSIDE_POINT = { x: 900, y: 600 };

/** Сообщение, которым отвечает метод уничтоженного экземпляра. */
const DESTROYED_MESSAGE = 'MyContext: экземпляр уничтожен';

/**
 * Длительность для кейсов про выход. Дефолтные 140 мс — окно, в которое трудно
 * попасть чтением снимка под нагрузкой, а проверять тут нужно именно попадание в
 * него: узел, снятый сразу, означал бы, что отложенного разбора нет.
 */
const LONG_DURATION = 600;

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
  // По умолчанию движение есть: под `reduce` разбор мгновенен, и кейсы про
  // отложенный снос узлов нечего было бы проверять. Отдельный кейс включает
  // `reduce` сам.
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.evaluate(async () => {
    const { MyContext } = await import('../../src/index.js');

    /** @type {string[]} */
    const errors = [];
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });

    /** Подписи сработавших действий: разбор не должен мешать им дойти до конца. */
    /** @type {string[]} */
    const calls = [];

    /**
     * @param {string} label
     * @returns {MenuItem}
     */
    function item(label) {
      return { labelAction: () => label, action: () => { calls.push(label); } };
    }

    /**
     * @returns {Array<MenuItem>}
     */
    function items() {
      return [item('Первый'), { labelAction: () => 'Ветка', submenuAction: () => [item('Лист')] }];
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

    const scope = /** @type {{ __oneShot?: OneShotProbe }} */
      (/** @type {unknown} */ (globalThis));
    scope.__oneShot = {
      /** @param {OneShotInput} input */
      make(input) {
        // Прежний экземпляр мог быть уже разобран закрытием, а `destroy()`
        // идемпотентен, поэтому чистка перед новым не знает, что именно перед ней.
        for (const previous of made) {
          previous.destroy();
        }
        made.length = 0;
        errors.length = 0;
        calls.length = 0;
        made.push(new MyContext(items(), {
          label: 'Меню',
          animationDuration: input.animationDuration,
          autoHideDistance: input.autoHideDistance ?? 0,
          pressAndHold: input.pressAndHold,
          destroyOnClose: input.destroyOnClose === true,
        }));
        if (input.attach === true) {
          current().attach(surface());
        }
      },
      /**
       * @param {{ x: number, y: number }} point
       * @param {boolean} [dismissible]
       */
      open(point, dismissible = false) {
        current().open({ x: point.x, y: point.y }, { dismissible });
      },
      /**
       * Показ как сабменю чужого меню: контракт `open(x, y)`, который зовёт
       * владелец кольца. Контракт метода проверяет `armedOpen.spec.js`, здесь он
       * нужен как посылка: разбор приходит раньше действия.
       *
       * @param {{ x: number, y: number }} point
       * @returns {void}
       */
      openAsSubmenu(point) {
        current().openAsSubmenu(point.x, point.y);
      },
      close() {
        current().close();
      },
      closeAll() {
        MyContext.closeAll();
      },
      /**
       * Показ уничтоженного экземпляра: контракт после разбора один на все
       * методы, и сообщение — тоже одно, поэтому проверяется оно дословно.
       *
       * @returns {Threw}
       */
      tryOpen() {
        try {
          current().open({ x: 260, y: 120 }, { dismissible: true });
          return { threw: false, message: '' };
        } catch (error) {
          return {
            threw: true,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      },
      /**
       * @returns {number}
       */
      subscriptionCount() {
        return subscriptions;
      },
      read() {
        const levels = document.querySelectorAll('.vc-menu');
        return {
          menuCount: levels.length,
          openCount: document.querySelectorAll('.vc-menu:popover-open').length,
          closingCount: document.querySelectorAll('.vc-menu[data-vc-closing]').length,
          calls: calls.slice(),
          errors: errors.slice(),
        };
      },
    };

    // Считаются живые подписки, а не вызовы `addEventListener`: снятие зовёт
    // `removeEventListener`, и счётчик добавлений после закрытия показал бы
    // столько же, сколько до показа, — то есть ничего.
    let subscriptions = 0;

    const addOnDocument = document.addEventListener.bind(document);
    const removeOnDocument = document.removeEventListener.bind(document);
    const addOnWindow = window.addEventListener.bind(window);
    const removeOnWindow = window.removeEventListener.bind(window);

    /**
     * @param {number} delta
     * @returns {void}
     */
    const count = (delta) => {
      subscriptions += delta;
    };

    /**
     * @param {string} type
     * @param {EventListenerOrEventListenerObject} callback
     * @param {boolean | AddEventListenerOptions | EventListenerOptions} [options]
     * @returns {void}
     */
    function onDocumentAdd(type, callback, options) {
      count(1);
      addOnDocument(type, callback, options);
    }

    /**
     * @param {string} type
     * @param {EventListenerOrEventListenerObject} callback
     * @param {boolean | EventListenerOptions} [options]
     * @returns {void}
     */
    function onDocumentRemove(type, callback, options) {
      count(-1);
      removeOnDocument(type, callback, options);
    }

    /**
     * @param {string} type
     * @param {EventListenerOrEventListenerObject} callback
     * @param {boolean | AddEventListenerOptions | EventListenerOptions} [options]
     * @returns {void}
     */
    function onWindowAdd(type, callback, options) {
      count(1);
      addOnWindow(type, callback, options);
    }

    /**
     * @param {string} type
     * @param {EventListenerOrEventListenerObject} callback
     * @param {boolean | EventListenerOptions} [options]
     * @returns {void}
     */
    function onWindowRemove(type, callback, options) {
      count(-1);
      removeOnWindow(type, callback, options);
    }

    document.addEventListener = onDocumentAdd;
    document.removeEventListener = onDocumentRemove;
    window.addEventListener = onWindowAdd;
    window.removeEventListener = onWindowRemove;
  });
});

/**
 * @typedef {object} OneShotInput
 * @property {boolean} [attach] привязать ли контейнер сразу при создании.
 * @property {boolean} [destroyOnClose] разбирать ли экземпляр при закрытии.
 * @property {number} [animationDuration] длительность входа и выхода, мс.
 * @property {number} [autoHideDistance] порог автоскрытия, `0` — выключено.
 * @property {import('../../src/constants.js').PressAndHoldMode} [pressAndHold] чем
 *   открывается и когда закрывается меню; по умолчанию `'none'`.
 */

/**
 * @typedef {object} Threw
 * @property {boolean} threw
 * @property {string} message
 */

/**
 * @typedef {object} OneShotSnapshot
 * @property {number} menuCount узлов `.vc-menu` в документе, включая гаснущие.
 * @property {number} openCount показанных уровней.
 * @property {number} closingCount уровней с меткой `data-vc-closing`.
 * @property {string[]} calls подписи сработавших действий, по порядку.
 * @property {string[]} errors сообщения необработанных ошибок страницы.
 */

/**
 * @typedef {object} OneShotProbe
 * @property {(input: OneShotInput) => void} make
 * @property {(point: { x: number, y: number }, dismissible?: boolean) => void} open
 * @property {(point: { x: number, y: number }) => void} openAsSubmenu
 * @property {() => void} close
 * @property {() => void} closeAll
 * @property {() => Threw} tryOpen
 * @property {() => number} subscriptionCount
 * @property {() => OneShotSnapshot} read
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {OneShotInput} input
 * @returns {Promise<void>}
 */
function makeMenu(page, input) {
  return page.evaluate((config) => {
    const scope = /** @type {{ __oneShot: OneShotProbe }} */
      (/** @type {unknown} */ (globalThis));
    scope.__oneShot.make(config);
  }, input);
}

/**
 * Показ как сабменю чужого меню: контракт `open(x, y)`, который зовёт владелец
 * кольца, удерживающий кнопку.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function openAsSubmenu(page, point) {
  return page.evaluate((anchor) => {
    const scope = /** @type {{ __oneShot: OneShotProbe }} */
      (/** @type {unknown} */ (globalThis));
    scope.__oneShot.openAsSubmenu(anchor);
  }, point);
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
      const scope = /** @type {{ __oneShot: OneShotProbe }} */
        (/** @type {unknown} */ (globalThis));
      scope.__oneShot.open(config.point, config.dismissible);
    },
    { point, dismissible },
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function closeMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __oneShot: OneShotProbe }} */
      (/** @type {unknown} */ (globalThis));
    scope.__oneShot.close();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function closeAllMenus(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __oneShot: OneShotProbe }} */
      (/** @type {unknown} */ (globalThis));
    scope.__oneShot.closeAll();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Threw>}
 */
function tryOpenMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __oneShot: OneShotProbe }} */
      (/** @type {unknown} */ (globalThis));
    return scope.__oneShot.tryOpen();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<OneShotSnapshot>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __oneShot: OneShotProbe }} */
      (/** @type {unknown} */ (globalThis));
    return scope.__oneShot.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
function subscriptionCount(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __oneShot: OneShotProbe }} */
      (/** @type {unknown} */ (globalThis));
    return scope.__oneShot.subscriptionCount();
  });
}

/**
 * Центр рамки пункта с указанной подписью в любом уровне на странице.
 *
 * Через координаты, а не `locator.click()`: во время выхода уровень ещё в Top
 * Layer, и Playwright на гаснущий узел не кликнет — а кейсу про отложенный разбор
 * такой узел и нужен.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<{ x: number, y: number }>}
 */
function centreOfItem(page, label) {
  return page.evaluate((text) => {
    for (const level of document.querySelectorAll('.vc-menu')) {
      for (const row of level.querySelectorAll('.vc-item')) {
        const caption = row.querySelector('.vc-label');
        if (caption !== null && caption.textContent === text) {
          const rect = row.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      }
    }
    throw new Error(`на странице нет пункта «${text}»`);
  }, label);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<void>}
 */
async function clickItem(page, label) {
  const point = await centreOfItem(page, label);
  await page.mouse.click(point.x, point.y);
}

/**
 * Показ привязанного меню настоящим правым кликом по подложке.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
async function rightClick(page, point) {
  await page.mouse.click(point.x, point.y, { button: 'right' });
}

/**
 * Ждёт, пока уровень уйдёт из DOM.
 *
 * Ожидание условия, а не утверждение: снос узлов отложен на анимацию выхода, и её
 * длина — величина, которой живёт браузер, а не тест.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function waitLevelsGone(page) {
  return page.waitForFunction(() => {
    return document.querySelectorAll('.vc-menu').length === 0;
  }).then(() => undefined);
}

/**
 * Ждёт, пока меню перестанет быть показанным.
 *
 * Отдельное условие от `waitLevelsGone` не для красоты: закрытое меню без опции
 * остаётся в DOM и переиспользуется следующим показом, поэтому «закрыто» и «узлов
 * нет» — разные вещи, и контрольный кейс без опции ждёт именно эту.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function waitClosed(page) {
  return page.waitForFunction(() => {
    return document.querySelectorAll('.vc-menu:popover-open').length === 0;
  }).then(() => undefined);
}

/**
 * Ждёт, пока показанных уровней станет ровно столько.
 *
 * Отдельное условие от `waitClosed` не для красоты: закрытие уровня отложено на его
 * анимацию выхода, и «подменю закрыто» — это «подменя гаснут», то есть снимок,
 * снятый сразу после `Escape`, ещё показывает его в Top Layer.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} count
 * @returns {Promise<void>}
 */
function waitOpenCount(page, count) {
  return page.waitForFunction((expected) => {
    return document.querySelectorAll('.vc-menu:popover-open').length === expected;
  }, count).then(() => undefined);
}

test.describe('опция destroyOnClose', () => {
  test('закрытие разбирает экземпляр, а узлы уходят в конце выхода', async ({ page }) => {
    // Разбор и снос узлов — два разных момента, и проверяются оба. Снесённый
    // сразу узел означал бы, что меню, рассчитанное на один показ, ещё и пропадает
    // без фейда; узел, оставшийся навсегда, — что уровень утекает.
    await makeMenu(page, { destroyOnClose: true, animationDuration: LONG_DURATION });
    await openMenu(page, SHOW_POINT);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await closeMenu(page);

    const closing = await readMenu(page);
    expect(closing.menuCount, 'уровень ещё в DOM — выход ещё идёт').toBe(1);
    expect(closing.closingCount, 'уровень несёт метку закрытия').toBe(1);
    expect(await tryOpenMenu(page), 'экземпляр мёртв сразу при закрытии').toEqual({
      threw: true,
      message: DESTROYED_MESSAGE,
    });

    await waitLevelsGone(page);
    expect((await readMenu(page)).menuCount, 'после выхода узлов не осталось').toBe(0);
    expect((await readMenu(page)).errors, 'ошибок страницы нет').toEqual([]);
  });

  test('под reduce уровень снимается сразу', async ({ page }) => {
    // Под `reduce` `hide()` гасит уровень мгновенно, и ждать после этого нечего:
    // отложенный разбор оставил бы закрытые уровни в DOM на всю длительность.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await makeMenu(page, { destroyOnClose: true, animationDuration: LONG_DURATION });
    await openMenu(page, SHOW_POINT);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await closeMenu(page);

    expect((await readMenu(page)).menuCount, 'уровень снят сразу').toBe(0);
    expect(await tryOpenMenu(page), 'экземпляр мёртв').toEqual({
      threw: true,
      message: DESTROYED_MESSAGE,
    });
  });

  test('клик по пункту разбирает экземпляр', async ({ page }) => {
    // Путь, ради которого опция и написана: действие пункта закрывает меню, и
    // закрытие уносит с собой всё, что экземпляр держал на странице.
    await makeMenu(page, { destroyOnClose: true, attach: true });
    await rightClick(page, SHOW_POINT);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await clickItem(page, 'Первый');
    await waitLevelsGone(page);

    expect((await readMenu(page)).menuCount, 'уровни убраны').toBe(0);
    expect(await tryOpenMenu(page), 'экземпляр разобран').toEqual({
      threw: true,
      message: DESTROYED_MESSAGE,
    });
    expect((await readMenu(page)).errors, 'ошибок страницы нет').toEqual([]);
  });

  test('закрытый экземпляр перестаёт открывать меню по контейнеру', async ({ page }) => {
    // Главное требование к опции. Прежний экземпляр держал бы слушатель
    // `contextmenu` и открыл меню снова — то есть меню, заведённое ради одного
    // показа, показывалось бы второй раз и правило вводило бы в заблуждение.
    // Проверяется и отсутствие ошибки: мёртвый экземпляр обязан молчать, а не
    // бросать из обработчика, поэтому «меню не открылось» само по себе ничего не
    // доказывает.
    await makeMenu(page, { destroyOnClose: true, attach: true });
    await rightClick(page, SHOW_POINT);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await clickItem(page, 'Первый');
    await waitLevelsGone(page);

    await rightClick(page, SHOW_POINT);
    expect((await readMenu(page)).openCount, 'прежний экземпляр молчит').toBe(0);
    expect((await readMenu(page)).errors, 'и не бросает наружу').toEqual([]);
  });

  test('следующий показ открывает новый экземпляр', async ({ page }) => {
    // Второй пункт предыдущего кейса: показать меню в этом контейнере по-прежнему
    // можно, но только новым экземпляром. Ровно это автор и делает, заводя меню на
    // каждый показ.
    await makeMenu(page, { destroyOnClose: true, attach: true });
    await rightClick(page, SHOW_POINT);
    await clickItem(page, 'Первый');
    await waitLevelsGone(page);

    await makeMenu(page, { destroyOnClose: true, attach: true });
    await rightClick(page, SHOW_POINT);
    expect((await readMenu(page)).openCount, 'новый экземпляр открыл меню').toBe(1);
    expect((await readMenu(page)).errors, 'ошибок страницы нет').toEqual([]);
  });

  test('Escape разбирает экземпляр', async ({ page }) => {
    await makeMenu(page, { destroyOnClose: true, attach: true });
    await rightClick(page, SHOW_POINT);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.keyboard.press('Escape');
    await waitLevelsGone(page);

    expect((await readMenu(page)).menuCount, 'уровни убраны').toBe(0);
    expect(await tryOpenMenu(page), 'экземпляр разобран').toEqual({
      threw: true,
      message: DESTROYED_MESSAGE,
    });
  });

  test('закрытое подменю уходит вместе с корнем', async ({ page }) => {
    // Цепочка уровней — несколько узлов в DOM, и разбор обязан снять их все: один
    // забытый уровень держал бы на странице и свои подписки, и свои зоны
    // прокрутки.
    await makeMenu(page, { destroyOnClose: true, animationDuration: LONG_DURATION });
    await openMenu(page, SHOW_POINT);
    // Отметку ставит `ArrowDown` на первом пункте, а подменю у второго: нужен ещё
    // один шаг, иначе `ArrowRight` сделал бы нечего.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    expect((await readMenu(page)).openCount, 'подменю раскрыто').toBe(2);

    // `Escape` на открытом подменю закрывает только его, и закрытием меню это не
    // считается: разбор на этом шаге убил бы меню посреди показа, а автор вправе
    // уйти в подменю и вернуться к корню. Проверяется не «осталось» — тем, что
    // корневой уровень на месте и ошибок нет: разобранный экземпляр увел бы с собой
    // и его, а следующий `Escape` бросил бы из обработчика.
    await page.keyboard.press('Escape');
    await waitOpenCount(page, 1);
    expect((await readMenu(page)).openCount, 'закрыто только подменю').toBe(1);
    expect((await readMenu(page)).errors, 'и без ошибок').toEqual([]);

    // Второй `Escape` закрывает корень, и с ним разбирается экземпляр. Подменю —
    // тоже узел в DOM, и забытый уровень держал бы на странице свои подписки и
    // свои зоны прокрутки.
    await page.keyboard.press('Escape');
    expect((await readMenu(page)).menuCount, 'оба уровня ещё гаснут').toBe(2);

    await waitLevelsGone(page);
    expect((await readMenu(page)).menuCount, 'уровней не осталось').toBe(0);
    expect(await tryOpenMenu(page), 'экземпляр разобран').toEqual({
      threw: true,
      message: DESTROYED_MESSAGE,
    });
  });

  test('клик вне закрывает и разбирает одноразовое меню', async ({ page }) => {
    // Показ, за который отвечает чужой код: правила закрытия подняла опция
    // `dismissible`, и разбор после них — тот же. Заодно видно, что подписки не
    // остаются на странице, а ради них опция чаще всего и нужна.
    await makeMenu(page, { destroyOnClose: true });
    const before = await subscriptionCount(page);

    await openMenu(page, SHOW_POINT, true);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);
    expect(await subscriptionCount(page), 'показ поднял глобальные слушатели')
      .toBeGreaterThan(before);

    await page.mouse.click(OUTSIDE_POINT.x, OUTSIDE_POINT.y);
    await waitLevelsGone(page);

    expect(await subscriptionCount(page), 'закрытие сняло слушатели').toBe(before);
    expect(await tryOpenMenu(page), 'экземпляр разобран').toEqual({
      threw: true,
      message: DESTROYED_MESSAGE,
    });
    expect((await readMenu(page)).errors, 'ошибок страницы нет').toEqual([]);
  });

  test('closeAll разбирает одноразовый экземпляр', async ({ page }) => {
    // Статический метод закрывает меню всех живых экземпляров, и одноразовый не
    // исключение: смена маршрута должна убирать и его, иначе он пережил бы уход
    // со страницы вместе со своим уровнем.
    await makeMenu(page, { destroyOnClose: true, attach: true });
    await rightClick(page, SHOW_POINT);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await closeAllMenus(page);
    await waitLevelsGone(page);

    expect((await readMenu(page)).menuCount, 'уровни убраны').toBe(0);
    expect(await tryOpenMenu(page), 'экземпляр разобран').toEqual({
      threw: true,
      message: DESTROYED_MESSAGE,
    });
  });

  test('автоскрытие разбирает одноразовый экземпляр', async ({ page }) => {
    // Правило автоскрытия закрывает по движению курсора, и закрытие это то же
    // тело, что у клика вне: разбор наступает и здесь. Проверяется потому, что
    // автоскрытие — единственное правило, которое работает у непривязанного
    // экземпляра лишь с `dismissible`, то есть самый короткий путь до разбора.
    await makeMenu(page, { destroyOnClose: true, autoHideDistance: 200 });
    await openMenu(page, SHOW_POINT, true);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.move(OUTSIDE_POINT.x, OUTSIDE_POINT.y);
    await waitLevelsGone(page);

    expect((await readMenu(page)).menuCount, 'уровни убраны').toBe(0);
    expect(await tryOpenMenu(page), 'экземпляр разобран').toEqual({
      threw: true,
      message: DESTROYED_MESSAGE,
    });
    expect((await readMenu(page)).errors, 'ошибок страницы нет').toEqual([]);
  });

  test('удержание закрывает одноразовый экземпляр', async ({ page }) => {
    // `pressAndHold` отвечает за то, чем закрывается меню, и разбор должен
    // наступать на этом пути тоже: показ и отпускание — два разных события, и
    // второе приходит из глобальной подписки, которую `attach()` держит между
    // показами. Если бы разбор её не снял, отпускание после закрытия легло бы на
    // уничтоженный экземпляр.
    await makeMenu(page, { destroyOnClose: true, attach: true, pressAndHold: 'right' });
    await page.mouse.move(SHOW_POINT.x, SHOW_POINT.y);
    await page.mouse.down({ button: 'right' });
    expect((await readMenu(page)).openCount, 'нажатие показало меню').toBe(1);

    await page.mouse.up({ button: 'right' });
    await waitLevelsGone(page);

    expect((await readMenu(page)).menuCount, 'уровни убраны').toBe(0);
    expect(await tryOpenMenu(page), 'экземпляр разобран').toEqual({
      threw: true,
      message: DESTROYED_MESSAGE,
    });
    expect((await readMenu(page)).errors, 'ошибок страницы нет').toEqual([]);
  });

  test('без опции закрытый экземпляр жив, а его уровень остаётся на странице', async ({ page }) => {
    // Контроль к предыдущим кейсам: тот же показ, тот же клик по пункту, но без
    // опции. Показ после закрытия обязан удаться, иначе кейсы выше проверяли бы не
    // опцию, а сам `destroy()`. Уровень при этом остаётся в DOM и будет переиспользован
    // следующим показом — в этом весь смысл переиспользования, и одного «меню
    // закрыто» здесь недостаточно, чтобы отличить два поведения.
    await makeMenu(page, { attach: true });
    await rightClick(page, SHOW_POINT);
    await clickItem(page, 'Первый');
    await waitClosed(page);

    expect((await readMenu(page)).menuCount, 'уровень остался в DOM').toBe(1);
    expect(await tryOpenMenu(page), 'экземпляр жив').toEqual({ threw: false, message: '' });
    expect((await readMenu(page)).openCount, 'меню снова показано').toBe(1);
    expect((await readMenu(page)).menuCount, 'и это тот же уровень, а не второй').toBe(1);
  });

  test('переоткрытие на месте не разбирает экземпляр', async ({ page }) => {
    // Повторный `open()` по открытому меню — тот же показ, а не закрытие: уровни
    // гаснут на месте, но цепочка тут же доводится новым показом. Разбор ждал бы
    // тут закрытия, которого не было, и меню, которым автор водит по странице,
    // умирало бы от собственного перемещения.
    await makeMenu(page, { destroyOnClose: true, animationDuration: LONG_DURATION });
    await openMenu(page, SHOW_POINT);
    await openMenu(page, { x: 400, y: 300 });

    await page.waitForFunction(() => {
      return document.querySelectorAll('.vc-menu:popover-open').length === 1;
    });
    expect((await readMenu(page)).errors, 'переоткрытие ошибок не дало').toEqual([]);

    await closeMenu(page);
    expect(await tryOpenMenu(page), 'разбор наступил на закрытии').toEqual({
      threw: true,
      message: DESTROYED_MESSAGE,
    });
  });
});

test.describe('destroyOnClose и удержание', () => {
  test('разбор на отпускании не мешает действию пункта дойти до конца', async ({ page }) => {
    // Сценарий, ради которого `openAsSubmenu` ищет действие до закрытия: пункт
    // чужого меню открывает одноразовое меню по своему контракту `open(x, y)`,
    // кнопку удержания держит владелец, и отпускание обязано довести действие
    // пункта до конца.
    //
    // Порядок разбора отпускания: сначала закрытие, потом действие. Разбор стирает
    // карту действий, и действие, взятое из карты после закрытия, не нашлось бы
    // вовсе — отпускание сработало бы как «ничего». Поиск пункта поэтому идёт до
    // закрытия, а исполнение — после.
    await makeMenu(page, { destroyOnClose: true, pressAndHold: 'right' });
    await page.mouse.move(SHOW_POINT.x, SHOW_POINT.y);
    await page.mouse.down({ button: 'right' });
    await openAsSubmenu(page, SHOW_POINT);

    const point = await centreOfItem(page, 'Первый');
    await page.mouse.move(point.x, point.y, { steps: 6 });
    await page.mouse.up({ button: 'right' });

    await waitClosed(page);
    const after = await readMenu(page);
    expect(after.calls, 'действие исполнилось').toEqual(['Первый']);
    expect(after.openCount, 'меню закрылось').toBe(0);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
    await waitLevelsGone(page);
    expect(await tryOpenMenu(page), 'экземпляр разобран').toEqual({
      threw: true,
      message: DESTROYED_MESSAGE,
    });
  });
});
