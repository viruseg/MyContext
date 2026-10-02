import { expect, test } from '@playwright/test';
import { OPEN_GRACE_MS } from '../../src/constants.js';

/**
 * `handoffAction` — пункт, отдающий управление другому меню.
 *
 * Обычный владелец подменю раскрывает уровень, нарисованный этим же меню. Хендофф
 * передаёт управление наружу: автор решает, что и где показать, — а меню обязано
 * только отпустить уровень и убрать себя с экрана, потому что оставшееся меню в
 * половине случаев перекрыло бы то, что открылось вместо него.
 *
 * Кейсы проверяют контракт хендоффа, а не чужую библиотеку: на месте «другого
 * меню» стоит счётчик и снимок состояния, и всё, что проверяется здесь, —
 * когда зовётся действие, с чем оно получает и что происходит с этим меню.
 *
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 * @typedef {import('../../src/constants.js').PressAndHoldMode} PressAndHoldMode
 */

/**
 * @typedef {object} HandoffCall
 * @property {'hover' | 'press' | 'release'} how каким событием пункт отдал управление.
 * @property {{ x: number, y: number } | null} point координаты курсора в этот момент,
 *   `null` если событие координат не несло.
 * @property {number} button кнопка события, `0` у наведения.
 * @property {boolean} menuOpen был ли этот экземпляр открыт на момент вызова.
 * @property {GestureView | null} gesture описание живого жеста вторым аргументом;
 *   `null`, если действие объявлено с одним параметром и второго не читает.
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
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };
const PRESS_POINT = { x: 260, y: 120 };

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

    /** @type {HandoffCall[]} */
    const handoffs = [];
    /** @type {string[]} */
    const errors = [];
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });

    /** @type {InstanceType<typeof MyContext> | null} */
    let menu = null;
    /** @type {boolean} */
    let handoffThrows = false;

    /**
     * Хендофф пишет снимок своего состояния и больше ничего не делает. Так и
     * надлежит: чужое меню открывает вызывающий код, и всё, что библиотека может
     * проверить о нём, — что действие позвали вовремя и что это меню ушло.
     *
     * @param {'hover' | 'press' | 'release'} how
     * @param {PointerEvent | MouseEvent | KeyboardEvent | null} event
     * @param {GestureView | undefined} gesture
     * @returns {void}
     */
    function handoff(how, event, gesture) {
      // Событие активации может не нести ни координат, ни кнопки — на наведении их
      // нет, — и тогда оба поля становятся пустыми, а не выдуманными.
      const pointer = event !== null && 'clientX' in event ? event : null;
      handoffs.push({
        how,
        point: pointer === null ? null : { x: pointer.clientX, y: pointer.clientY },
        button: event !== null && 'button' in event ? event.button : 0,
        menuOpen: document.querySelectorAll('.vc-menu:popover-open').length > 0,
        gesture: gesture === undefined ? null : { button: gesture.button, held: gesture.held },
      });
      if (handoffThrows) {
        throw new Error('хендофф автора упал');
      }
    }

    /**
     * @param {string} label
     * @param {boolean} [givesAway] собрать ли пункт, отдающий управление.
     * @param {boolean} [enabled]
     * @returns {MenuItem}
     */
    function item(label, givesAway = false, enabled = true) {
      /** @type {Record<string, unknown>} */
      const built = { labelAction: () => label };
      if (givesAway) {
        built.handoffAction = (
          /** @type {PointerEvent} */ event,
          /** @type {GestureView} */ gesture,
        ) => handoff('hover', event, gesture);
      } else {
        built.action = () => handoffs.push({ how: 'release', point: null, button: 0, menuOpen: false, gesture: null });
      }
      if (!enabled) {
        built.isEnabledAction = () => false;
      }
      return /** @type {MenuItem} */ (built);
    }

    const scope = /** @type {{ __handoff?: HandoffProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__handoff = {
      /**
       * @param {HandoffInput} input
       */
      make(input) {
        if (menu !== null) {
          menu.destroy();
        }
        handoffs.length = 0;
        errors.length = 0;
        handoffThrows = false;
        menu = new MyContext(
          /** @type {Array<MenuItem | SeparatorItem>} */ ([
            item('Первый'),
            item('Отдать', true, input.enabled !== false),
            item('Отключённый отдающий', true, false),
            {
              labelAction: () => 'Ветка',
              action: () => handoffs.push({ how: 'release', point: null, button: 0, menuOpen: false, gesture: null }),
              submenuAction: () => [item('Лист')],
            },
          ]),
          { pressAndHold: /** @type {PressAndHoldMode} */ (input.pressAndHold) },
        );
        if (input.attach) {
          const surface = document.getElementById('surface');
          if (surface instanceof HTMLElement) {
            menu.attach(surface);
          }
        }
      },
      /**
       * @param {{ x: number, y: number }} point
       * @param {boolean} [armed]
       */
      open(point, armed = false) {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.open({ x: point.x, y: point.y }, { armed });
      },
      /** Заставить следующий хендофф бросить исключение автора. */
      throwOnHandoff() {
        handoffThrows = true;
      },
      read() {
        return {
          openCount: document.querySelectorAll('.vc-menu:popover-open').length,
          handoffs: handoffs.slice(),
          errors: errors.slice(),
          labels: Array.from(document.querySelectorAll('.vc-menu .vc-item .vc-label'))
            .map((node) => String(node.textContent)),
          chevrons: Array.from(document.querySelectorAll('.vc-item'))
            .map((node) => node.getAttribute('data-chevron')),
          disabled: Array.from(document.querySelectorAll('.vc-item'))
            .map((node) => node.getAttribute('aria-disabled')),
        };
      },
    };
  });
});

/**
 * @typedef {object} HandoffInput
 * @property {string} pressAndHold
 * @property {boolean} attach
 * @property {boolean} [enabled]
 */

/**
 * @typedef {object} GestureView
 * @property {'left' | 'middle' | 'right' | 'back' | 'forward' | null} button
 * @property {boolean} held
 */

/**
 * @typedef {object} HandoffCallView
 * @property {'hover' | 'press' | 'release'} how
 * @property {{ x: number, y: number } | null} point
 * @property {number} button
 * @property {boolean} menuOpen
 * @property {GestureView | null} gesture
 */

/**
 * @typedef {object} HandoffSnapshot
 * @property {number} openCount
 * @property {HandoffCallView[]} handoffs
 * @property {string[]} errors
 * @property {string[]} labels
 * @property {(string | null)[]} chevrons
 * @property {(string | null)[]} disabled
 */

/**
 * @typedef {object} HandoffProbe
 * @property {(input: HandoffInput) => void} make
 * @property {(point: { x: number, y: number }, armed?: boolean) => void} open
 * @property {() => void} throwOnHandoff
 * @property {() => HandoffSnapshot} read
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {HandoffInput} input
 * @returns {Promise<void>}
 */
function makeMenu(page, input) {
  return page.evaluate((config) => {
    const scope = /** @type {{ __handoff: HandoffProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__handoff.make(config);
  }, input);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<HandoffSnapshot>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __handoff: HandoffProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__handoff.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<{ x: number, y: number }>}
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
  return /** @type {{ x: number, y: number }} */ (point);
}

/**
 * Нажатие, вооружение и открытие — три шага, повторяемые каждым кейсом на
 * удержании. Вынесены, потому что порядок обязателен: кнопка нажимается ДО показа
 * меню, иначе нажатие пришлось бы по самому меню и породило бы `click` на его
 * пункте, а кейс проверял бы клик вместо хендоффа.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function openHeld(page) {
  await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
  await page.mouse.down({ button: 'left' });
  await page.evaluate(() => {
    const scope = /** @type {{ __handoff: HandoffProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__handoff.open({ x: 260, y: 120 }, true);
  });
}

test.describe('пункт с handoffAction', () => {
  test('наведение отдаёт управление и убирает меню', async ({ page }) => {
    // Наведение — первый путь хендоффа: пункт-владелец раскрывает подменю по
    // наведению через `OPEN_GRACE_MS`, и хендофф обязан вести себя тем же порядком.
    // Меню при этом обязано уйти: оставшись, оно перекрыло бы то, что открылось
    // вместо него.
    await makeMenu(page, { pressAndHold: 'left', attach: false });
    await openHeld(page);

    const target = await centerOfItem(page, 'Отдать');
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(OPEN_GRACE_MS + 100);

    const after = await readMenu(page);
    expect(after.handoffs.length, 'хендофф позвали').toBe(1);
    expect(after.handoffs[0].how, 'по наведению').toBe('hover');
    expect(after.openCount, 'меню ушло').toBe(0);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('хендофф получает координаты курсора', async ({ page }) => {
    // Координаты — единственное, что нужно чужому меню, чтобы показаться там же,
    // где стоял курсор, и без них хендофф был бы вызовом без предмета.
    await makeMenu(page, { pressAndHold: 'left', attach: false });
    await openHeld(page);

    const target = await centerOfItem(page, 'Отдать');
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(OPEN_GRACE_MS + 100);

    const call = (await readMenu(page)).handoffs[0];
    const point = /** @type {{ x: number, y: number }} */ (call.point);
    expect(call.point, 'точка передана').not.toBeNull();
    // Допуск в один пиксель: движки округляют координаты события до целых, и то,
    // что приходит в действие, — это округлённая позиция курсора, а не точная
    // геометрия пункта. Требовать тут точности до долей значило бы проверять
    // движок, а не контракт.
    expect(Math.abs(point.x - target.x), 'координата X').toBeLessThanOrEqual(1);
    expect(Math.abs(point.y - target.y), 'координата Y').toBeLessThanOrEqual(1);
  });

  test('нажатие ускоряет отдачу, минуя задержку', async ({ page }) => {
    // Нажатие ускоряет показ подменю, и хендофф ускорен тем же правилом: наведение
    // успело запланировать показ, а ждать его срока незачем — решение уже принято.
    //
    // Проверяется без удержания, и это не случайность: во время удержания нажатие
    // по пункту перехватывает capture-обработчик документа и закрывает меню — так
    // устроено правило «вторая пресса закрывает жест», и нажатие до пункта не доходит.
    // На удержании отдачу несёт наведение, и его проверяет первый кейс.
    await makeMenu(page, { pressAndHold: 'none', attach: true });
    await page.mouse.click(PRESS_POINT.x, PRESS_POINT.y, { button: 'right' });

    const target = await centerOfItem(page, 'Отдать');
    await page.mouse.move(target.x, target.y);
    // Наведение только что спланировало показ; нажатие приходит раньше его срока.
    await page.mouse.down({ button: 'left' });

    const after = await readMenu(page);
    expect(after.handoffs.length, 'хендофф позвали').toBe(1);
    expect(after.openCount, 'меню ушло').toBe(0);
  });

  test('отключённый пункт управление не отдаёт', async ({ page }) => {
    // Отключённость выключает действие пункта, и хендофф не исключение: негодный
    // пункт не отвечает ни за что, за что отвечает годный. Проверяется наведением:
    // наведения достаточно, чтобы отдача состоялась бы, будь пункт доступен.
    await makeMenu(page, { pressAndHold: 'left', attach: false });
    await openHeld(page);

    const target = await centerOfItem(page, 'Отключённый отдающий');
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(OPEN_GRACE_MS + 100);

    const after = await readMenu(page);
    expect(after.handoffs, 'хендоффа не было').toEqual([]);
    expect(after.openCount, 'меню осталось на экране').toBe(1);
  });

  test('пункт-владелец подменю и хендофф различаются', async ({ page }) => {
    // Хендофф не подменю: подменю остаётся в этом же меню, хендофф его покидает.
    // Смешались бы два и только если бы хендофф раскрывал уровень.
    await makeMenu(page, { pressAndHold: 'left', attach: false });
    await openHeld(page);

    const owner = await centerOfItem(page, 'Ветка');
    await page.mouse.move(owner.x, owner.y);
    await page.waitForTimeout(OPEN_GRACE_MS + 100);

    const after = await readMenu(page);
    expect(after.handoffs, 'хендоффа не было').toEqual([]);
    expect(after.openCount, 'подменю раскрылось, корень остался').toBe(2);
  });

  test('пункт, отдающий управление, помечен шевроном', async ({ page }) => {
    // Шеврон у пункта-владельца обещает вложенность, и хендофф её даёт — он уводит
    // туда же, куда вёл бы шеврон. Без него пункт выглядел бы обычной строкой, а
    // вёл себя как уводящий.
    await makeMenu(page, { pressAndHold: 'left', attach: false });
    await page.evaluate(() => {
      const scope = /** @type {{ __handoff: HandoffProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__handoff.open({ x: 260, y: 120 }, true);
    });

    const state = await readMenu(page);
    const givesAway = state.labels.indexOf('Отдать');
    const owner = state.labels.indexOf('Ветка');
    expect(state.chevrons[owner], 'у владельца подменю шеврон есть').not.toBeNull();
    expect(state.chevrons[givesAway], 'у отдающего пункта шеврон есть').not.toBeNull();
    expect(state.chevrons[0], 'у обычного пункта шеврона нет').toBeNull();
  });

  test('отключённый отдающий пункт шеврона не получает', async ({ page }) => {
    // Шеврон обещает вложенность, а отключённый пункт не раскрывает ничего — ни
    // подменю, ни управления. Шеврон у него был бы обещанием вслепую.
    await makeMenu(page, { pressAndHold: 'left', attach: false });
    await page.evaluate(() => {
      const scope = /** @type {{ __handoff: HandoffProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__handoff.open({ x: 260, y: 120 }, true);
    });

    const state = await readMenu(page);
    const off = state.labels.indexOf('Отключённый отдающий');
    expect(state.disabled[off], 'пункт отключён').toBe('true');
    expect(state.chevrons[off], 'шеврон снят вместе с доступностью').toBeNull();
  });

  test('хендофф без удержания: клик по пункту отдаёт управление', async ({ page }) => {
    // Хендофф не часть удержания: на правом клике пункт отдаёт управление так же,
    // иначе поле работало бы только в одном из двух режимов.
    await makeMenu(page, { pressAndHold: 'none', attach: true });
    await page.mouse.click(PRESS_POINT.x, PRESS_POINT.y, { button: 'right' });
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    const target = await centerOfItem(page, 'Отдать');
    await page.mouse.click(target.x, target.y);

    const after = await readMenu(page);
    expect(after.handoffs.length, 'хендофф позвали').toBe(1);
    expect(after.openCount, 'меню ушло').toBe(0);
  });

  test('хендофф по клавиатуре отдаёт управление', async ({ page }) => {
    // Клавиатура — равноправный путь активации, и хендофф на ней обязан сработать:
    // иначе отдающий пункт был бы недоступен с клавиатуры вовсе.
    await makeMenu(page, { pressAndHold: 'none', attach: true });
    await page.mouse.click(PRESS_POINT.x, PRESS_POINT.y, { button: 'right' });

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    const after = await readMenu(page);
    expect(after.handoffs.length, 'хендофф позвали').toBe(1);
    expect(after.openCount, 'меню ушло').toBe(0);
  });

  test.describe('описание жеста вторым аргументом', () => {
    // Второй аргумент `handoffAction` — ровно то, что соседнее меню ждёт третьим
    // аргументом `openSubmenu`. Смысл в том, чтобы автору не пришлось знать, чем
    // именно мы вооружены: он передаёт описание дальше, а ребёнок решает сам.

    test('в удержании приходит живой жест с кнопкой', async ({ page }) => {
      // На удержании жест вооружён, и отдать его некому: без второго аргумента
      // ребёнок не узнал бы, какую кнопку ему передавать, и закрылся бы прессой
      // по своей конфигурации вместо отпускания.
      await makeMenu(page, { pressAndHold: 'left', attach: false });
      await openHeld(page);

      const target = await centerOfItem(page, 'Отдать');
      await page.mouse.move(target.x, target.y);
      await page.waitForTimeout(OPEN_GRACE_MS + 100);

      const during = await readMenu(page);
      expect(during.handoffs.length, 'хендофф позвали').toBe(1);
      expect(during.handoffs[0].gesture, 'жест назван').toEqual({ button: 'left', held: true });
    });

    test('внешнее вооружение при "any" приходит безымянным', async ({ page }) => {
      // Пресета «любая кнопка» имя не называет, и handoff честно сообщает об этом
      // `button: null`: ребёнку этого достаточно, чтобы принять отпускание любой
      // кнопки, и выдумывать имя здесь нечего.
      //
      // Вооружение именно внешнее (`open(..., { armed: true })`), а не нажатием по
      // якорю: при нажатии кнопка известна — та, которой жали, — и безымянным
      // описание было бы только при показе как сабменю чужого меню, то есть при
      // `openAsSubmenu`/`openSubmenu`.
      await makeMenu(page, { pressAndHold: 'any', attach: false });
      await openHeld(page);

      const target = await centerOfItem(page, 'Отдать');
      await page.mouse.move(target.x, target.y);
      await page.waitForTimeout(OPEN_GRACE_MS + 100);

      const during = await readMenu(page);
      expect(during.handoffs.length, 'хендофф позвали').toBe(1);
      expect(during.handoffs[0].gesture, 'кнопка не названа').toEqual({ button: null, held: true });
    });

    test('нажатие по якорю при "any" называет ту кнопку, которой жали', async ({ page }) => {
      // Обратная сторона предыдущего: вооружение изнутри знает кнопку нажатия, и
      // называть её «не названной» значило бы выдумать неопределённость там, где её
      // нет. Ребёнку с именем работать проще, чем с безымянным.
      await makeMenu(page, { pressAndHold: 'any', attach: true });
      await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
      await page.mouse.down({ button: 'right' });
      expect((await readMenu(page)).openCount, 'меню показано нажатием').toBe(1);

      const target = await centerOfItem(page, 'Отдать');
      await page.mouse.move(target.x, target.y);
      await page.waitForTimeout(OPEN_GRACE_MS + 100);

      const during = await readMenu(page);
      expect(during.handoffs.length, 'хендофф позвали').toBe(1);
      expect(during.handoffs[0].gesture, 'кнопка нажатия названа').toEqual({ button: 'right', held: true });
      await page.mouse.up({ button: 'right' });
    });

    test('вне удержания по клику приходит held: false', async ({ page }) => {
      // Меню без пресета удержания живёт по клику, и живого жеста у него нет.
      // Сообщить `held: true` значило бы вооружить ребёнка отпусканием, которого не
      // будет, и оставить его висеть. Кнопка при этом доезжает справочно: на показ
      // ребёнка она не влияет, но автору в логе полезно знать, чем активирован.
      await makeMenu(page, { pressAndHold: 'none', attach: true });
      await page.mouse.click(PRESS_POINT.x, PRESS_POINT.y, { button: 'right' });

      const target = await centerOfItem(page, 'Отдать');
      await page.mouse.click(target.x, target.y);

      const after = await readMenu(page);
      expect(after.handoffs.length, 'хендофф позвали').toBe(1);
      expect(after.handoffs[0].gesture, 'жеста нет, кнопка справочная').toEqual({ button: 'left', held: false });
    });

    test('по клавиатуре приходит held: false и button: null', async ({ page }) => {
      // У `keydown` нет ни кнопки, ни координат. Выдумывать их нечем, и ребёнку
      // по клавиатуре открывать нечего: отсюда и живого жеста, и названной кнопки.
      await makeMenu(page, { pressAndHold: 'none', attach: true });
      await page.mouse.click(PRESS_POINT.x, PRESS_POINT.y, { button: 'right' });

      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');

      const after = await readMenu(page);
      expect(after.handoffs.length, 'хендофф позвали').toBe(1);
      expect(after.handoffs[0].gesture, 'ни кнопки, ни жеста').toEqual({ button: null, held: false });
    });
  });

  test('исключение хендоффа не оставляет меню висеть', async ({ page }) => {
    // Закрытие после хендоффа обязано быть безусловным: исключение автора не должно
    // оставить меню на экране поверх того, что он вместо него открыть не сумел.
    await makeMenu(page, { pressAndHold: 'none', attach: true });
    await page.evaluate(() => {
      const scope = /** @type {{ __handoff: HandoffProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__handoff.throwOnHandoff();
    });
    await page.mouse.click(PRESS_POINT.x, PRESS_POINT.y, { button: 'right' });
    const target = await centerOfItem(page, 'Отдать');
    await page.mouse.click(target.x, target.y);

    const after = await readMenu(page);
    expect(after.handoffs.length, 'хендофф позвали').toBe(1);
    expect(after.openCount, 'меню ушло, несмотря на исключение').toBe(0);
  });
});