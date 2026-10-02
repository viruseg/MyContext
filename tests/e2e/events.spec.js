import { expect, test } from '@playwright/test';
import { DEFAULT_ANIMATION_DURATION } from '../../src/constants.js';

/**
 * Публичные события показа и закрытия.
 *
 * Кейсы проверяют три вещи, и каждая отвечает на отдельное решение: **момент** события
 * относительно состояния меню (показ объявлен после `showPopover`, закрытие — после
 * снятия уровней), **условие** события (закрытие положено только на реально показанное
 * меню, а `destroy()` молчит) и **порядок** в пути отдачи управления, где наше закрытие
 * обязано обогнать показ чужого меню.
 *
 * Состояние на момент события читается изнутри обработчика, а не после: журнал
 * накапливает снимок в ту же секунду, в которую событие пришло, и потому «событие
 * пришло, а меню ещё не показано» поймалось бы здесь, а не в следующем кадре.
 *
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 * @typedef {import('../../src/MyContext.js').MyContextOptions} MyContextOptions
 * @typedef {import('../../src/MyContext.js').OpenEventDetail} OpenEventDetail
 * @typedef {import('../../src/MyContext.js').SubmenuHandoff} SubmenuHandoff
 * @typedef {import('../../src/layer.js').Point} Point
 * @typedef {InstanceType<typeof import('../../src/index.js').MyContext>} MyContextInstance
 */

/**
 * Запись журнала — снимок, сделанный в обработчике события.
 *
 * @typedef {object} LogEntry
 * @property {'open' | 'close'} type имя события.
 * @property {string} menu имя экземпляра: `'A'` или `'B'`.
 * @property {{ x: number, y: number } | null} point `detail` события `open`; у `close`
 *   `detail` пуст, и поле остаётся пустым — заодно проверяется, что закрытие
 *   действительно ничего не несёт.
 * @property {number} shown сколько уровней сейчас `:popover-open`.
 * @property {boolean} rootShown показан ли корневой уровень. Корневой адрес кончается
 *   на `-0`, и по нему уровень отличается от подменю: у событий они неразличимы, и без
 *   этого признака «показан уровень» ничего бы не значило.
 * @property {string | null} focusLabel доступное имя меню, в котором лежит фокус.
 * @property {boolean | null} alive жил ли экземпляр в момент события; `null` у `open`,
 *   где вопрос не задаётся. Читается попыткой закрыть ещё раз: у живого экземпляра
 *   закрытие идемпотентно, у разобранного — `Error`.
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
         style="position: fixed; left: 0; top: 0; width: 420px; height: 100%; background: rgb(240, 240, 240)">
    </div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };
/** Точка внутри привязанного контейнера: правый клик здесь открывает меню. */
const INSIDE_POINT = { x: 200, y: 150 };
/** Точка вне контейнера: правый клик здесь доходит до глобального обработчика. */
const OUTSIDE_POINT = { x: 760, y: 400 };
/** Пустое место страницы вдали от меню: клик здесь закрывает. */
const FAR_POINT = { x: 940, y: 640 };

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

    /** @type {LogEntry[]} */
    const log = [];
    /** @type {string[]} */
    const errors = [];
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });

    /** @type {MyContextInstance | null} */
    let menuA = null;
    /** @type {MyContextInstance | null} */
    let menuB = null;
    /** @type {(() => void) | null} */
    let offOpen = null;
    /** @type {(() => void) | null} */
    let offClose = null;
    let pairMode = false;
    let handoffThrows = false;

    /**
     * @returns {number}
     */
    function shownCount() {
      return document.querySelectorAll('.vc-menu:popover-open').length;
    }

    /**
     * @returns {boolean}
     */
    function rootShown() {
      return Array.from(document.querySelectorAll('.vc-menu:popover-open')).some((element) => {
        return element.id.endsWith('-0');
      });
    }

    /**
     * @returns {string | null}
     */
    function focusLabel() {
      const active = document.activeElement;
      if (active === null) {
        return null;
      }
      const level = active.closest('.vc-menu');
      return level === null ? null : level.getAttribute('aria-label');
    }

    /**
     * @param {MyContextInstance} menu
     * @returns {boolean}
     */
    function aliveNow(menu) {
      try {
        menu.close();
        return true;
      } catch {
        return false;
      }
    }

    /**
     * @param {'open' | 'close'} type
     * @param {string} name
     * @param {{ x: number, y: number } | null} point
     * @returns {LogEntry}
     */
    function entryOf(type, name, point) {
      return {
        type,
        menu: name,
        point,
        shown: shownCount(),
        rootShown: rootShown(),
        focusLabel: focusLabel(),
        alive: null,
      };
    }

    /**
     * @param {MyContextInstance} menu
     * @param {string} name
     * @returns {void}
     */
    function watch(menu, name) {
      const onOpen = (/** @type {CustomEvent<OpenEventDetail>} */ event) => {
        // Обработчик написан без приведений: тип `detail` приходит из самой подписки.
        // Если перегрузка `addEventListener` потеряет связь с именем события, кейс
        // перестанет собираться — контракт типов проверяется тем же набором, что и всё
        // остальное поведение.
        log.push(entryOf('open', name, { x: event.detail.x, y: event.detail.y }));
      };
      const onClose = () => {
        const entry = entryOf('close', name, null);
        entry.alive = aliveNow(menu);
        log.push(entry);
      };
      offOpen = () => menu.removeEventListener('open', onOpen);
      offClose = () => menu.removeEventListener('close', onClose);
      menu.addEventListener('open', onOpen);
      menu.addEventListener('close', onClose);
    }

    /**
     * Ось, на которой меню уходит с экрана: кнопки мыши на этой точке не нажимают, и
     * браузерного `mousedown` тут не бывает — потому на ней и виден порядок фокуса внутри
     * библиотеки. Значение совпадает с `INSIDE_POINT` у модуля.
     */
    const ANCHOR = { x: 200, y: 150 };

    /**
     * @param {PointerEvent | MouseEvent | KeyboardEvent} event
     * @param {SubmenuHandoff} handoff
     * @returns {void}
     */
    function handOver(event, handoff) {
      if (handoffThrows) {
        throw new Error('хендофф автора упал');
      }
      const child = menuB;
      if (!pairMode || child === null) {
        return;
      }
      // На активации с клавиатуре координат у события нет, и место чужого меню выбирает
      // автор, а не библиотека: подставлять тут нечего. Здесь берётся та же точка, что и
      // при мыши, — проверяется фокус, а не положение.
      const pointer = 'clientX' in event ? event : null;
      child.openSubmenu(
        pointer === null ? ANCHOR.x : pointer.clientX,
        pointer === null ? ANCHOR.y : pointer.clientY,
        handoff,
      );
    }

    /**
     * @returns {Array<MenuItem | SeparatorItem>}
     */
    function items() {
      return [
        /** @type {MenuItem} */ ({ labelAction: () => 'Первый', action: () => {} }),
        /** @type {MenuItem} */ ({ labelAction: () => 'Отдать', handoffAction: handOver }),
        /** @type {MenuItem} */ ({
          labelAction: () => 'Ветка',
          action: () => {},
          submenuAction: () => [/** @type {MenuItem} */ ({ labelAction: () => 'Лист' })],
        }),
      ];
    }

    /**
     * @param {string} label
     * @param {boolean} attach
     * @returns {MyContextInstance}
     */
    function makeOwner(label, attach) {
      const menu = new MyContext(items(), { label });
      if (attach) {
        const surface = document.getElementById('surface');
        if (surface instanceof HTMLElement) {
          menu.attach(surface);
        }
      }
      return menu;
    }

    const scope = /** @type {{ __events?: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__events = {
      /**
       * @param {MakeInput} input
       */
      make(input) {
        if (menuA !== null) {
          menuA.destroy();
        }
        if (menuB !== null) {
          menuB.destroy();
          menuB = null;
        }
        log.length = 0;
        errors.length = 0;
        offOpen = null;
        offClose = null;
        pairMode = false;
        handoffThrows = false;
        /** @type {MyContextOptions} */
        const options = { label: input.label ?? 'меню A' };
        if (input.destroyOnClose === true) {
          options.destroyOnClose = true;
        }
        menuA = new MyContext(items(), options);
        if (input.attach === true) {
          const surface = document.getElementById('surface');
          if (surface instanceof HTMLElement) {
            menuA.attach(surface);
          }
        }
        watch(menuA, 'A');
      },
      makePair() {
        if (menuA !== null) {
          menuA.destroy();
        }
        if (menuB !== null) {
          menuB.destroy();
          menuB = null;
        }
        log.length = 0;
        errors.length = 0;
        offOpen = null;
        offClose = null;
        pairMode = true;
        handoffThrows = false;
        menuA = makeOwner('меню A', true);
        watch(menuA, 'A');
        menuB = new MyContext(
          [/** @type {MenuItem} */ ({ labelAction: () => 'Лист' })],
          { label: 'меню B' },
        );
        watch(menuB, 'B');
      },
      /**
       * @param {Point} point
       */
      open(point) {
        if (menuA === null) {
          throw new Error('меню не создано');
        }
        menuA.open({ x: point.x, y: point.y });
      },
      close() {
        if (menuA === null) {
          throw new Error('меню не создано');
        }
        menuA.close();
      },
      closeAll() {
        MyContext.closeAll();
      },
      destroy() {
        if (menuA === null) {
          throw new Error('меню не создано');
        }
        menuA.destroy();
      },
      /** Признак жизни экземпляра: закрытие идемпотентно у живого и бросает у разобранного. */
      alive() {
        return menuA !== null && aliveNow(menuA);
      },
      /** Снять обе подписки — после этого событий быть не должно вовсе. */
      unsubscribe() {
        if (offOpen === null || offClose === null) {
          throw new Error('подписки не сняты');
        }
        offOpen();
        offClose();
        offOpen = null;
        offClose = null;
      },
      /** Заставить ближайший `handoffAction` бросить исключение автора. */
      throwOnHandoff() {
        handoffThrows = true;
      },
      read() {
        return {
          log: log.slice(),
          errors: errors.slice(),
          shown: shownCount(),
          openLabels: Array.from(document.querySelectorAll('.vc-menu:popover-open'))
            .map((element) => String(element.getAttribute('aria-label'))),
          focusLabel: focusLabel(),
        };
      },
    };
  });
});

/**
 * @typedef {object} MakeInput
 * @property {boolean} [attach]
 * @property {boolean} [destroyOnClose]
 * @property {string} [label]
 */

/**
 * @typedef {object} Snapshot
 * @property {LogEntry[]} log
 * @property {string[]} errors
 * @property {number} shown
 * @property {string[]} openLabels доступные имена показанных уровней. Именно показанных,
 *   а не всех: закрытый уровень остаётся в DOM и будет показан снова, и читать состав по
 *   `querySelectorAll('.vc-menu')` значило бы утверждать о меню то, чего на экране нет.
 * @property {string | null} focusLabel
 */

/**
 * @typedef {object} EventsProbe
 * @property {(input: MakeInput) => void} make
 * @property {() => void} makePair
 * @property {(point: Point) => void} open
 * @property {() => void} close
 * @property {() => void} closeAll
 * @property {() => void} destroy
 * @property {() => boolean} alive
 * @property {() => void} unsubscribe
 * @property {() => void} throwOnHandoff
 * @property {() => Snapshot} read
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {MakeInput} input
 * @returns {Promise<void>}
 */
function makeMenu(page, input) {
  return page.evaluate((config) => {
    const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__events.make(config);
  }, input);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Snapshot>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__events.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
function readAlive(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__events.alive();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<Point>}
 */
async function centerOfItem(page, label) {
  const point = await page.evaluate((text) => {
    for (const element of document.querySelectorAll('.vc-item')) {
      const node = element.querySelector('.vc-label');
      if (node !== null && String(node.textContent) === text) {
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  }, label);
  expect(point, `пункт «${label}» есть в разметке`).not.toBeNull();
  return /** @type {Point} */ (point);
}

/**
 * Имена событий журнала одной строкой: порядок между двумя экземплярами иначе пришлось
 * бы читать по двум полям сразу, и чередование «чьё событие» стало бы главным, а не
 * вторым делом.
 *
 * @param {Snapshot} snapshot
 * @returns {string[]}
 */
function timeline(snapshot) {
  return snapshot.log.map((entry) => `${entry.menu}:${entry.type}`);
}

test.describe('событие open', () => {
  test('приходит по правому клику и несёт точку вызова', async ({ page }) => {
    await makeMenu(page, { attach: true });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });

    const after = await readMenu(page);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
    expect(timeline(after), 'одно открытие нашего меню').toEqual(['A:open']);
    expect(after.log[0].point, 'точка вызова').toEqual(INSIDE_POINT);
  });

  test('приходит после показа: в обработчике уровень уже в Top Layer', async ({ page }) => {
    // Момент рассылки — часть контракта: подписчик вправе мерить меню прямо в
    // обработчике, и «событие пришло, а показать ещё нечего» сломало бы это молча.
    await makeMenu(page, { attach: true });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });

    const entry = (await readMenu(page)).log[0];
    expect(entry.rootShown, 'корневой уровень показан').toBe(true);
    expect(entry.shown, 'показан один уровень').toBe(1);
  });
});

test.describe('событие close', () => {
  test('приходит по close()', async ({ page }) => {
    await makeMenu(page, { attach: true });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    await page.evaluate(() => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.close();
    });

    const after = await readMenu(page);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
    expect(timeline(after), 'сначала open, потом close').toEqual(['A:open', 'A:close']);
  });

  test('приходит после скрытия уровней и ничего не несёт', async ({ page }) => {
    // Порядок обратный показу по той же причине: подписчик закрытия вправе знать, что
    // меню уже снято с экрана, и не должен Finds' уровень, которого уже нет.
    await makeMenu(page, { attach: true });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    await page.evaluate(() => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.close();
    });

    const entry = (await readMenu(page)).log[1];
    expect(entry.shown, 'уровней не осталось').toBe(0);
    expect(entry.rootShown, 'корневой уровень скрыт').toBe(false);
    expect(entry.point, 'detail закрытия пуст').toBeNull();
  });

  test('приходит по Escape', async ({ page }) => {
    await makeMenu(page, { attach: true });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    await page.keyboard.press('Escape');

    expect(timeline(await readMenu(page)), 'Escape закрывает').toEqual(['A:open', 'A:close']);
  });

  test('приходит по клику по странице', async ({ page }) => {
    await makeMenu(page, { attach: true });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    await page.mouse.click(FAR_POINT.x, FAR_POINT.y);

    expect(timeline(await readMenu(page)), 'клик по странице закрывает')
      .toEqual(['A:open', 'A:close']);
  });

  test('приходит по closeAll()', async ({ page }) => {
    await makeMenu(page, {});
    await page.evaluate((point) => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.open(point);
    }, INSIDE_POINT);
    await page.evaluate(() => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.closeAll();
    });

    expect(timeline(await readMenu(page)), 'closeAll закрывает').toEqual(['A:open', 'A:close']);
  });

  test('приходит по выбору пункта', async ({ page }) => {
    await makeMenu(page, { attach: true });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    const target = await centerOfItem(page, 'Первый');
    await page.mouse.click(target.x, target.y);

    expect(timeline(await readMenu(page)), 'выбор пункта закрывает')
      .toEqual(['A:open', 'A:close']);
  });

  test('подменю событий не порождают', async ({ page }) => {
    // Наведение на владельца раскрывает подменю, уход курсора его гасит. Оба события
    // принадлежат корню, а меню при этом остаётся открытым: событий здесь не должно
    // быть ни одного, иначе «меню закрыто» означало бы «закрыт один уровень».
    await makeMenu(page, { attach: true });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    const target = await centerOfItem(page, 'Ветка');
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(400);
    const leaf = await centerOfItem(page, 'Лист');
    await page.mouse.move(leaf.x, leaf.y);
    await page.waitForTimeout(200);

    const after = await readMenu(page);
    expect(after.shown, 'уровней два').toBe(2);
    expect(timeline(after), 'события только корневые').toEqual(['A:open']);
  });
});

test.describe('когда событий нет', () => {
  test('закрытое меню close не шлёт', async ({ page }) => {
    await makeMenu(page, {});
    await page.evaluate(() => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.close();
      scope.__events.closeAll();
    });

    expect((await readMenu(page)).log, 'журнал пуст').toEqual([]);
  });

  test('правый клик по странице вне привязки close не шлёт', async ({ page }) => {
    // Глобальный обработчик зовёт закрытие на любом правом клике вне меню и вне
    // привязанного контейнера — в том числе когда показывать нечего. Охранник на
    // «показывалось ли» стоит именно ради этого пути: без него подписчик получал бы
    // закрытие, которому не предшествовало открытие.
    await makeMenu(page, { attach: true });
    await page.mouse.click(OUTSIDE_POINT.x, OUTSIDE_POINT.y, { button: 'right' });

    const after = await readMenu(page);
    expect(after.shown, 'меню не открылось').toBe(0);
    expect(after.log, 'журнал пуст').toEqual([]);
  });

  test('destroy() открытого меню молчит', async ({ page }) => {
    await makeMenu(page, { attach: true });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    await page.evaluate(() => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.destroy();
    });

    const after = await readMenu(page);
    expect(after.shown, 'меню ушло').toBe(0);
    expect(await readAlive(page), 'экземпляр уничтожен').toBe(false);
    expect(timeline(after), 'только open').toEqual(['A:open']);
  });

  test('снятая подписка событий не получает', async ({ page }) => {
    await makeMenu(page, { attach: true });
    await page.evaluate(() => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.unsubscribe();
    });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });

    const after = await readMenu(page);
    expect(after.shown, 'меню показалось').toBe(1);
    expect(after.log, 'журнал пуст').toEqual([]);
  });
});

test.describe('переоткрытие', () => {
  test('два open подряд, close между ними нет', async ({ page }) => {
    await makeMenu(page, { attach: true });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    const moved = { x: 300, y: 420 };
    await page.evaluate((point) => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.open(point);
    }, moved);

    const after = await readMenu(page);
    // Меню не закрывалось, а переехало: закрытия между показами нет, и подписчик
    // получает второе открытие, чтобы знать о новой точке.
    expect(timeline(after), 'два открытия, ни одного закрытия')
      .toEqual(['A:open', 'A:open']);
    expect(after.log[1].point, 'вторая точка').toEqual(moved);
  });
});

test.describe('отложенное переоткрытие', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  test('open приходит один раз и только после нового показа', async ({ page }) => {
    await makeMenu(page, { attach: true });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    const moved = { x: 300, y: 420 };
    await page.evaluate((point) => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.open(point);
    }, moved);

    // Окно между гашением прежней цепочки и показом в новой точке: меню там ещё
    // показывается, но закрытия произойти не может — закрывать нечего, цепочка жива.
    await page.waitForTimeout(Math.round(DEFAULT_ANIMATION_DURATION / 2));
    expect(timeline(await readMenu(page)), 'гашение молчит').toEqual(['A:open']);

    await page.waitForTimeout(DEFAULT_ANIMATION_DURATION * 2);
    const after = await readMenu(page);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
    expect(timeline(after), 'показ второй, закрытия ни одного').toEqual(['A:open', 'A:open']);
    expect(after.log[1].point, 'вторая точка').toEqual(moved);
  });
});

test.describe('отдача управления чужому меню', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.makePair();
    });
  });

  test('close отдающего раньше open принимающего', async ({ page }) => {
    // Порядок, ради которого написан пункт с `handoffAction`: наше меню уходит, и только
    // потом показывается чужое. Обратный порядок отдал бы подписчику чужое открытие
    // раньше нашего закрытия, и разбирать пришлось бы в чужом меню.
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    const target = await centerOfItem(page, 'Отдать');
    await page.mouse.click(target.x, target.y);

    const after = await readMenu(page);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
    expect(timeline(after), 'сначала наше закрытие, потом чужое открытие')
      .toEqual(['A:open', 'A:close', 'B:open']);
    expect(after.shown, 'показан чужой уровень').toBe(1);
    expect(after.openLabels, 'на экране чужой уровень').toEqual(['меню B']);
  });

  test('в момент чужого открытия наше меню уже скрыто', async ({ page }) => {
    // Не «после отдачи», а по снимкам изнутри: порядок событий должен совпадать с
    // порядком состояний, иначе подписчик читал бы снимок не того, что видел.
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    const target = await centerOfItem(page, 'Отдать');
    await page.mouse.click(target.x, target.y);

    const after = await readMenu(page);
    expect(after.log[1].menu, 'первым ушло наше').toBe('A');
    expect(after.log[1].shown, 'наше закрытие пришло при пустом экране').toBe(0);
    expect(after.log[2].menu, 'потом пришло чужое').toBe('B');
    expect(after.log[2].shown, 'к этому моменту показано чужое').toBe(1);
  });

  test('фокус после отдачи принадлежит принявшему меню', async ({ page }) => {
    // Возврат фокуса на якорь стоит ДО показа чужого меню, иначе наше закрытие отняло бы
    // фокус у только что показанного сабменю и оставило его без клавиатуры.
    //
    // Проверяется на пути с клавиатуры, и это не выбор удобства. Мышью отдача срабатывает
    // на `pointerdown`, то есть раньше `mousedown`, и браузер после этого своим обычным
    // действием ставит фокус на тот пункт, который лежал под курсором в момент `mousedown`
    // — то есть на пункт уходящего меню. Никакой порядок внутри библиотеки этого не меняет,
    // и утверждать тут надо ровно то, что библиотека обещает: её собственный возврат фокуса
    // не отбирает фокус у показанного ребёнка.
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    const after = await readMenu(page);
    expect(timeline(after), 'отдача состоялась').toEqual(['A:open', 'A:close', 'B:open']);
    expect(after.focusLabel, 'фокус в чужом меню').toBe('меню B');
  });

  test('исключение автора не отменяет close', async ({ page }) => {
    await page.evaluate(() => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.throwOnHandoff();
    });
    await page.mouse.click(INSIDE_POINT.x, INSIDE_POINT.y, { button: 'right' });
    const target = await centerOfItem(page, 'Отдать');
    await page.mouse.click(target.x, target.y);

    const after = await readMenu(page);
    expect(after.shown, 'меню ушло').toBe(0);
    expect(timeline(after), 'close пришёл, чужого нет').toEqual(['A:open', 'A:close']);
  });
});

test.describe('destroyOnClose', () => {
  test('close приходит, а разбор после него', async ({ page }) => {
    await makeMenu(page, { destroyOnClose: true });
    await page.evaluate((point) => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.open(point);
    }, INSIDE_POINT);
    await page.evaluate(() => {
      const scope = /** @type {{ __events: EventsProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__events.close();
    });

    const after = await readMenu(page);
    expect(timeline(after), 'сначала open, потом close').toEqual(['A:open', 'A:close']);
    // `alive` в записи закрытия — признак того, что событие пришло до разбора. Порядок
    // обязателен: иначе подписчик с `destroyOnClose` не прочитал бы закрытие вовсе,
    // потому что к его приходу экземпляр был бы уже мёртв.
    expect(after.log[1].alive, 'в момент close экземпляр ещё жив').toBe(true);
    expect(await readAlive(page), 'после close экземпляр разобран').toBe(false);
    expect(after.shown, 'меню ушло').toBe(0);
  });
});
