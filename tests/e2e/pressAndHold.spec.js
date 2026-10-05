import { expect, test } from '@playwright/test';
import { OPEN_GRACE_MS } from '../../src/constants.js';

/**
 * Кейсы удержания кнопки против настоящей страницы: курсор водится настоящим
 * вводом Playwright, модуль грузится динамическим импортом прямо в браузере.
 *
 * Три решения, на которых держится весь файл.
 *
 * **Время принадлежит `page.clock`, и оно заморожено.** Подменю открывается через
 * `OPEN_GRACE_MS`, и без хода часов утверждение «подменю открыто» было бы гонкой.
 * Заморозка нужна и для отпускания: между нажатием и отпусканием кнопки не должно
 * проходить времени, иначе кейс проверял бы не жест, а терпение автора.
 *
 * **`reducedMotion: 'reduce'` убирает отложенный показ и отложенное закрытие.**
 * Меню появляется и исчезает за один такт, поэтому «меню открыто» и «меню закрыто»
 * читаются в том же снимке, в котором и случились.
 *
 * **Точки берутся у настоящих рамок, а не заданы числами.** Меню раскладывается по
 * содержимому, и при захардкоженных координатах кейс молча проверял бы точку,
 * которая к моменту проверки оказалась пустотой страницы.
 */

/**
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 * @typedef {import('../../src/MyContext.js').MyContextOptions} MyContextOptions
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
 * @typedef {object} Snapshot
 * @property {number} openCount сколько уровней в Top Layer.
 * @property {MenuRect[]} rects рамки показанных уровней, по порядку цепочки.
 * @property {string} focusOwnerId `id` элемента с фокусом либо имя тега.
 * @property {boolean} focusInMenu стоит ли фокус в дереве уровней меню.
 * @property {string[]} calls подписи пунктов, чьи действия отработали.
 * @property {string[]} errors сообщения необработанных ошибок страницы.
 * @property {ArmCall[]} armCalls что предикат `isArmableAction` видел при каждом вызове.
 * @property {string[]} labels подписи показанных пунктов корня, по порядку.
 */

/**
 * @typedef {object} ArmCall
 * @property {number} x `clientX` нажатия, как их увидел предикат.
 * @property {number} y `clientY` нажатия, как их увидел предикат.
 * @property {number} button кнопка нажатия, как её увидел предикат.
 * @property {string | null} targetId `data-id` цели нажатия либо `null`.
 * @property {number} levelsOpen сколько уровней было показано в момент вызова.
 * @property {string[]} labelsThen подписи корня, прочитанные к этому моменту.
 */

/**
 * @typedef {object} MakeInput
 * @property {string} pressAndHold режим удержания.
 * @property {number} autoHideDistance
 * @property {string | null} containerId
 * @property {boolean} longRoot составить ли корень из шестидесяти пунктов.
 * @property {'allow' | 'deny' | 'throw' | null} [isArmable] ответ предиката
 *   `isArmableAction`; `null` и отсутствие поля — опция не задана вовсе.
 * @property {string} [targetId] `data-id` элемента, на котором проходит нажатие.
 */

/**
 * @typedef {object} McProbe
 * @property {(input: MakeInput) => void} make
 * @property {(x: number, y: number) => void} open
 * @property {() => Snapshot} read
 */
/**
 * @typedef {object} Point
 * @property {number} x
 * @property {number} y
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
      <div id="target" data-id="photo-1"
           style="position: absolute; left: 600px; top: 60px; width: 200px; height: 120px; background: rgb(200, 200, 200)"></div>
    </div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };

/**
 * Точка нажатия. Левая от края, чтобы подменю поместилось справа, и середина по
 * вертикали, чтобы каскад из трёх уровней укладывался и по высоте.
 */
const PRESS_POINT = { x: 260, y: 120 };

/** Точка пустоты страницы далеко от меню. */
const EMPTY_POINT = { x: 880, y: 620 };

/**
 * Точка на элементе `#target` — единственном, у кого есть `data-id`. Нажатие по
 * пустоте страницы годилось бы проверить предикат, но не проверило бы, что цель
 * нажатия до него доходит.
 *
 * Элемент стоит в стороне от `PRESS_POINT`: накрытая им точка нажатия меняла бы
 * цель прежних кейсов, а фикстура не должна влиять на то, что проверяют не она.
 */
const TARGET_POINT = { x: 700, y: 120 };

const CLOCK_FROZEN_AT = new Date('2024-12-10T09:00:00Z');
const CLOCK_START_AT = new Date(CLOCK_FROZEN_AT.getTime() - 3_600_000);

/**
 * Порог автоскрытия в кейсах, где он задан явно. Заведомо больше `SUBMENU_OFFSET`
 * и больше высоты пункта: иначе движение к подменю попадало бы в зону закрытия, и
 * кейс проверял бы не автоскрытие, а негодный порог.
 */
const DISTANCE = 120;

/**
 * Указатель второй кнопки. Настоящий ввод Playwright приходит с `pointerId` 1,
 * и совпадение сделало бы вторую прессу неотличимой от первой.
 */
const SECOND_POINTER_ID = 7;

/**
 * @param {import('@playwright/test').Page} page
 * @param {MakeInput} input
 * @returns {Promise<void>}
 */
function makeMenu(page, input) {
  return page.evaluate((config) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(config);
  }, input);
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
 * @returns {Promise<MenuRect[]>} рамки всех уровней в порядке цепочки.
 */
async function rectsOfAllLevels(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('.vc-menu')).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
  });
}

/**
 * Центр пункта с такой подписью на любом уровне, первое совпадение сверху.
 *
 * Подпись ищется текстом, а не по `data-id`: идентификатор живёт в пробе и не
 * известен странице, а подпись — это то, чем пункт опознаётся снаружи.
 *
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
 * Центр разделителя: он не `.vc-item`, поэтому ищется по своей разметке.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Point>}
 */
async function centerOfSeparator(page) {
  const point = await page.evaluate(() => {
    const element = document.querySelector('.vc-separator');
    if (element === null) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  expect(point, 'разделитель есть в разметке').not.toBeNull();
  return /** @type {Point} */ (point);
}

/**
 * Центр зоны прокрутки у нижнего края списка.
 *
 * Зона видна только у уровня, чей список не помещается, поэтому кейс обязан
 * составлять корень длиннее вьюпорта — иначе точка ушла бы в пустоту страницы и
 * закрытие проверило бы не зону.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Point>}
 */
async function centerOfScrollZone(page) {
  const point = await page.evaluate(() => {
    const element = document.querySelector('.vc-scroll-zone-down');
    if (element === null) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  expect(point, 'зона прокрутки есть в разметке').not.toBeNull();
  return /** @type {Point} */ (point);
}

/**
 * Нажатие кнопкой в точке: курсор переводится и только потом нажимается.
 *
 * Порядок обязателен. `page.mouse.down` бьёт по текущему положению курсора, а до
 * перевода оно осталось бы там, где стоял прошлый кейс, и нажатие открыло бы меню
 * не там.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Point} point
 * @param {'left' | 'right' | 'middle'} button
 * @returns {Promise<void>}
 */
async function pressAt(page, point, button) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Point} point
 * @param {'left' | 'right' | 'middle'} button
 * @returns {Promise<void>}
 */
async function releaseAt(page, point, button) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.up({ button });
}

/**
 * Полный жест: нажать в точке, отпустить в другой.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Point} from
 * @param {Point} to
 * @param {'left' | 'right' | 'middle'} button
 * @returns {Promise<void>}
 */
async function pressAndRelease(page, from, to, button) {
  await pressAt(page, from, button);
  await releaseAt(page, to, button);
}

/**
 * Нажатие второй кнопкой, пока первая зажата.
 *
 * Настоящим вводом это не воспроизводится: Chromium не отдаёт `pointerdown` для
 * второй кнопки, пока нажата первая, — вместо него приходит один `contextmenu`
 * (замерено и для правой, и для средней, с отменой `pointerdown` и без неё).
 * Значит, вторая пресса проверяется настоящим событием DOM, а не подменой ввода:
 * событие создаётся браузером, идёт capture-фазой по документу и попадает ровно
 * в тот обработчик, который и должен его разобрать. Захваченной остаётся только
 * синтез нажатия — та часть, которой у машины нет вовсе.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Point} point
 * @returns {Promise<void>}
 */
function pressSecondButton(page, point) {
  return page.evaluate((input) => {
    const target = document.elementFromPoint(input.point.x, input.point.y);
    if (target === null) {
      throw new Error('под точкой нет элемента');
    }
    target.dispatchEvent(new PointerEvent('pointerdown', {
      button: 2,
      buttons: 3,
      pointerId: input.pointerId,
      bubbles: true,
      cancelable: true,
      composed: true,
    }));
  }, { point, pointerId: SECOND_POINTER_ID });
}

/**
 * Наводит курсор на пункт и дожидается подменю.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<void>}
 */
async function hoverOwner(page, label) {
  const point = await centerOfItem(page, label);
  await page.mouse.move(point.x, point.y);
  // Наведение планирует показ, а не делает его: без хода часов подменю не будет, и
  // кейс проверял бы отпускание над пунктом корня вместо пункта подменю.
  await page.clock.fastForward(OPEN_GRACE_MS);
}

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
  await page.clock.install({ time: CLOCK_START_AT });
  await page.clock.pauseAt(CLOCK_FROZEN_AT);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { MyContext } = await import('../../src/index.js');

    /** @type {string[]} */
    const calls = [];
    /** @type {string[]} */
    const errors = [];
    /** @type {ArmCall[]} */
    const armCalls = [];
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });

    /**
     * Пункт с подписью и действием, пишущим свою подпись в журнал вызовов.
     *
     * @param {string} label
     * @param {string} id
     * @returns {MenuItem}
     */
    function item(label, id) {
      return { id, labelAction: () => label, action: () => calls.push(label) };
    }

    /**
     * Корень кейсов: доступный пункт, владелец подменю со своим действием, владелец
     * без своего действия, разделитель и отключённый пункт — по одному представителю
     * каждого случая, ради которого отпускание разбирается по целям. Владельцев два
     * именно потому, что отпускание над ними разошлось: своё действие есть — зовётся,
     * нет — молчит, и один владелец не отличил бы эти два правила ничем.
     *
     * @returns {Array<MenuItem | SeparatorItem>}
     */
    function standardItems() {
      return [
        item('Новый', 'new'),
        {
          id: 'export',
          labelAction: () => 'Экспорт',
          action: () => calls.push('Экспорт'),
          submenuAction: () => [item('PDF', 'pdf'), item('TXT', 'txt')],
        },
        { type: 'separator' },
        {
          id: 'notes',
          labelAction: () => 'Заметки',
          action: () => calls.push('Заметки'),
          isEnabledAction: () => false,
        },
        {
          id: 'plain-owner',
          labelAction: () => 'Ветка без действия',
          submenuAction: () => [item('Лист', 'leaf')],
        },
      ];
    }

    /**
     * Корень, который не помещается во вьюпорт: без переполнения зон прокрутки
     * нет, и отпускание над зоной было бы отпусканием над пустотой.
     *
     * @returns {MenuItem[]}
     */
    function longItems() {
      return Array.from({ length: 60 }, (_unused, index) => {
        return item(`Пункт ${index + 1}`, `long-${index + 1}`);
      });
    }

    /** @type {InstanceType<typeof MyContext> | null} */
    let menu = null;

    const probe = /** @type {McProbe} */ ({
      make(input) {
        if (menu !== null) {
          menu.destroy();
        }
        calls.length = 0;
        errors.length = 0;
        armCalls.length = 0;
        /** @type {MyContextOptions} */
        const options = {
          label: 'Меню пробы',
          pressAndHold: /** @type {MyContextOptions['pressAndHold']} */ (input.pressAndHold),
          autoHideDistance: input.autoHideDistance,
        };
        // Проверка на строку, а не на `!== null`: у кейсов, опцию не задававших,
        // поле отсутствует, то есть это `undefined`, и проверка на `null` пропустила
        // бы его — предикат встал бы и запрещал все прежние кейсы разом.
        if (typeof input.isArmable === 'string') {
          options.isArmableAction = (event) => {
            const target = event.target;
            const labelsNow = Array.from(document.querySelectorAll('.vc-menu .vc-item .vc-label'))
              .map((node) => String(node.textContent));
            armCalls.push({
              x: event.clientX,
              y: event.clientY,
              button: event.button,
              targetId: target instanceof HTMLElement ? target.dataset.id ?? null : null,
              levelsOpen: document.querySelectorAll('.vc-menu').length,
              labelsThen: labelsNow,
            });
            if (input.isArmable === 'throw') {
              throw new Error('предикат автора упал');
            }
            return input.isArmable === 'allow';
          };
        }
        menu = new MyContext(input.longRoot ? longItems() : standardItems(), options);
        const container = input.containerId === null ? null : document.getElementById(input.containerId);
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
      read() {
        const open = Array.from(document.querySelectorAll('.vc-menu')).filter((element) => {
          return element.matches(':popover-open');
        });
        const active = document.activeElement;
        return {
          openCount: open.length,
          rects: open.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              right: rect.right,
              bottom: rect.bottom,
            };
          }),
          focusOwnerId: active === null ? null : active.id === '' ? active.tagName : active.id,
          focusInMenu: active !== null && active.closest('.vc-menu') !== null,
          calls: calls.slice(),
          errors: errors.slice(),
          armCalls: armCalls.slice(),
          labels: Array.from(document.querySelectorAll('.vc-menu .vc-item .vc-label'))
            .map((node) => String(node.textContent)),
        };
      },
    });

    const scope = /** @type {{ __mc?: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc = probe;
  });
});

test.describe('удержание выключено', () => {
  test('правый клик открывает, клик по пункту исполняет', async ({ page }) => {
    // Смена триггера не должна была тронутое ни одного из прежних путей: клик
    // остаётся кликом, а не превращается в «отпусти над пунктом».
    await makeMenu(page, { pressAndHold: 'none', autoHideDistance: 0, containerId: 'surface', longRoot: false });
    await page.mouse.click(PRESS_POINT.x, PRESS_POINT.y, { button: 'right' });
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    const point = await centerOfItem(page, 'Новый');
    await page.mouse.click(point.x, point.y);
    const after = await readMenu(page);
    expect(after.calls, 'действие отработало').toEqual(['Новый']);
    expect(after.openCount, 'меню закрылось').toBe(0);
  });

  test('левая кнопка вне меню закрывает, а не открывает', async ({ page }) => {
    await makeMenu(page, { pressAndHold: 'none', autoHideDistance: 0, containerId: 'surface', longRoot: false });
    await page.mouse.click(PRESS_POINT.x, PRESS_POINT.y, { button: 'right' });
    await page.mouse.click(EMPTY_POINT.x, EMPTY_POINT.y);
    expect((await readMenu(page)).openCount, 'меню закрылось').toBe(0);
  });
});

test.describe('удержание включено', () => {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {string} pressAndHold
   * @param {number} [autoHideDistance]
   * @param {boolean} [longRoot]
   * @returns {Promise<void>}
   */
  function enable(page, pressAndHold, autoHideDistance = 0, longRoot = false) {
    return makeMenu(page, { pressAndHold, autoHideDistance, containerId: 'surface', longRoot });
  }

  test('нажатие открывает меню', async ({ page }) => {
    await enable(page, 'any');
    await pressAt(page, PRESS_POINT, 'left');
    const shown = await readMenu(page);
    expect(shown.openCount, 'меню показано ещё до отпускания').toBe(1);
    expect(shown.focusInMenu, 'фокус в меню').toBe(true);
    await releaseAt(page, EMPTY_POINT, 'left');
  });

  test('отпускание вне меню закрывает без действия', async ({ page }) => {
    await enable(page, 'any');
    await pressAndRelease(page, PRESS_POINT, EMPTY_POINT, 'left');
    const after = await readMenu(page);
    expect(after.openCount, 'меню закрылось').toBe(0);
    expect(after.calls, 'ничего не исполнилось').toEqual([]);
    expect(after.errors).toEqual([]);
  });

  test('отпускание над доступным пунктом исполняет и закрывает', async ({ page }) => {
    await enable(page, 'any');
    await pressAt(page, PRESS_POINT, 'left');
    const point = await centerOfItem(page, 'Новый');
    await releaseAt(page, point, 'left');
    const after = await readMenu(page);
    expect(after.calls, 'действие отработало').toEqual(['Новый']);
    expect(after.openCount, 'меню закрылось').toBe(0);
  });

  test('отпускание над отключённым пунктом закрывает без действия', async ({ page }) => {
    await enable(page, 'any');
    await pressAt(page, PRESS_POINT, 'left');
    const point = await centerOfItem(page, 'Заметки');
    await releaseAt(page, point, 'left');
    const after = await readMenu(page);
    expect(after.calls, 'отключённый пункт не действие').toEqual([]);
    expect(after.openCount, 'меню закрылось').toBe(0);
  });

  test('отпускание над разделителем закрывает без действия', async ({ page }) => {
    await enable(page, 'any');
    await pressAt(page, PRESS_POINT, 'left');
    const point = await centerOfSeparator(page);
    await releaseAt(page, point, 'left');
    const after = await readMenu(page);
    expect(after.calls, 'разделитель не действие').toEqual([]);
    expect(after.openCount, 'меню закрылось').toBe(0);
  });

  test('отпускание над полем каркаса закрывает без действия', async ({ page }) => {
    // Служебная часть меню — то, что не пункт: внутренний отступ каркаса. Точка
    // берётся из рамки самого уровня, поэтому она внутри меню по построению.
    await enable(page, 'any');
    await pressAt(page, PRESS_POINT, 'left');
    const rect = (await readMenu(page)).rects[0];
    const padding = { x: rect.left + 1, y: rect.top + 1 };
    await releaseAt(page, padding, 'left');
    const after = await readMenu(page);
    expect(after.calls, 'поле каркаса не действие').toEqual([]);
    expect(after.openCount, 'меню закрылось').toBe(0);
  });

  test('отпускание над зоной прокрутки закрывает без действия', async ({ page }) => {
    await enable(page, 'any', 0, true);
    await pressAt(page, PRESS_POINT, 'left');
    const rects = await rectsOfAllLevels(page);
    expect(rects.length, 'уровень один').toBe(1);
    const point = await centerOfScrollZone(page);
    await releaseAt(page, point, 'left');
    const after = await readMenu(page);
    expect(after.calls, 'зона прокрутки не действие').toEqual([]);
    expect(after.openCount, 'меню закрылось').toBe(0);
  });

  test('отпускание над пунктом подменю исполняет и закрывает всю цепочку', async ({ page }) => {
    await enable(page, 'any');
    await pressAt(page, PRESS_POINT, 'left');
    await hoverOwner(page, 'Экспорт');
    expect((await readMenu(page)).openCount, 'подменю открыто наведением').toBe(2);

    const point = await centerOfItem(page, 'PDF');
    await releaseAt(page, point, 'left');
    const after = await readMenu(page);
    expect(after.calls, 'действие пункта подменю отработало').toEqual(['PDF']);
    expect(after.openCount, 'вся цепочка закрыта').toBe(0);
  });

  test('отпускание над владельцем подменю исполняет его действие и закрывает всё', async ({ page }) => {
    await enable(page, 'any');
    await pressAt(page, PRESS_POINT, 'left');
    await hoverOwner(page, 'Экспорт');
    expect((await readMenu(page)).openCount, 'подменю открыто наведением').toBe(2);

    const point = await centerOfItem(page, 'Экспорт');
    await releaseAt(page, point, 'left');
    const after = await readMenu(page);
    // Отпускание разбирает владельца ровно так же, как обычный пункт: своё действие
    // объявлено, значит оно и исполняется, а закрывает его тот же общий путь.
    expect(after.calls, 'действие владельца отработало').toEqual(['Экспорт']);
    expect(after.openCount, 'меню закрылось вместе с подменю').toBe(0);
  });

  test('отпускание над владельцем без своего действия закрывает молча', async ({ page }) => {
    await enable(page, 'any');
    await pressAt(page, PRESS_POINT, 'left');
    await hoverOwner(page, 'Ветка без действия');
    expect((await readMenu(page)).openCount, 'подменю открыто наведением').toBe(2);

    const point = await centerOfItem(page, 'Ветка без действия');
    await releaseAt(page, point, 'left');
    const after = await readMenu(page);
    // Звать нечего, и подменю на отпускании не раскрывается: молчание здесь — от
    // отсутствия действия, а не от того, что пункт чем-то особенный.
    expect(after.calls, 'действие не звалось — звать нечего').toEqual([]);
    expect(after.openCount, 'меню закрылось вместе с подменю').toBe(0);
  });

  test('вторая кнопка во время удержания закрывает откуда угодно', async ({ page }) => {
    // Кнопку второй раз без отпускания нажать нельзя — но можно нажать другую, и
    // она должна закрыть меню независимо от того, где пришлась. Обе точки
    // берутся у настоящих рамок уже показанного меню, иначе «внутри» оказалось бы
    // пустотой страницы и кейс проверил бы одно и то же дважды.
    for (const inside of [false, true]) {
      await enable(page, 'any');
      await pressAt(page, PRESS_POINT, 'left');
      const point = inside ? await centerOfItem(page, 'Новый') : EMPTY_POINT;
      await page.mouse.move(point.x, point.y);
      await pressSecondButton(page, point);
      const after = await readMenu(page);
      const where = inside ? 'внутри меню' : 'вне меню';
      expect(after.openCount, `меню закрыто второй кнопкой, ${where}`).toBe(0);
      expect(after.calls, `ничего не исполнилось, ${where}`).toEqual([]);
      // Кнопку отпускают после каждой итерации: иначе следующая пресса пришлась бы
      // на уже нажатую кнопку, и на WebKit меню не открылось бы вовсе — кейс
      // проверял бы прошлое состояние ввода вместо своего предмета.
      await releaseAt(page, point, 'left');
    }
  });

  test('Escape во время удержания снимает жест', async ({ page }) => {
    await enable(page, 'any');
    await pressAt(page, PRESS_POINT, 'left');
    await page.keyboard.press('Escape');
    expect((await readMenu(page)).openCount, 'Escape закрыл').toBe(0);

    const point = await centerOfItem(page, 'Новый');
    await releaseAt(page, point, 'left');
    const after = await readMenu(page);
    expect(after.calls, 'снятый жест не исполняет').toEqual([]);
    expect(after.openCount, 'меню не вернулось').toBe(0);
  });

  test('кнопка выбирается опцией: левая открывает, правая нет', async ({ page }) => {
    await enable(page, 'left');
    await page.mouse.click(PRESS_POINT.x, PRESS_POINT.y, { button: 'right' });
    expect((await readMenu(page)).openCount, 'правый клик меню не открывает').toBe(0);

    await pressAt(page, PRESS_POINT, 'left');
    expect((await readMenu(page)).openCount, 'левая кнопка открывает').toBe(1);
    await releaseAt(page, EMPTY_POINT, 'left');
  });

  test('кнопка выбирается опцией: правая открывает, левая нет', async ({ page }) => {
    await enable(page, 'right');
    await page.mouse.click(PRESS_POINT.x, PRESS_POINT.y, { button: 'left' });
    expect((await readMenu(page)).openCount, 'левая кнопка меню не открывает').toBe(0);

    await pressAt(page, PRESS_POINT, 'right');
    expect((await readMenu(page)).openCount, 'правая кнопка открывает').toBe(1);
    await releaseAt(page, EMPTY_POINT, 'right');
  });

  test('средняя кнопка открывает по опции middle', async ({ page }) => {
    await enable(page, 'middle');
    await page.mouse.click(PRESS_POINT.x, PRESS_POINT.y, { button: 'left' });
    expect((await readMenu(page)).openCount, 'левая кнопка меню не открывает').toBe(0);

    await pressAt(page, PRESS_POINT, 'middle');
    expect((await readMenu(page)).openCount, 'средняя кнопка открывает').toBe(1);
    await releaseAt(page, EMPTY_POINT, 'middle');
    expect((await readMenu(page)).openCount, 'отпускание закрыло').toBe(0);
  });

  test('any не оставляет системное меню вместо показа', async ({ page }) => {
    // Правая кнопка под `any` достаётся меню, и браузерное контекстное меню при
    // этом вслепую закрывает: без `preventDefault` отпускание правой кнопкой
    // поднимало бы его поверх только что показанного меню.
    await enable(page, 'any');
    await pressAt(page, PRESS_POINT, 'right');
    const point = await centerOfItem(page, 'Новый');
    await releaseAt(page, point, 'right');
    const after = await readMenu(page);
    expect(after.calls, 'действие отработало один раз').toEqual(['Новый']);
    expect(after.openCount, 'меню не переоткрылось контекстным событием').toBe(0);
  });

  test('программный open живёт по прежнему циклу', async ({ page }) => {
    await enable(page, 'any');
    await page.evaluate((point) => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.open(point.x, point.y);
    }, PRESS_POINT);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    // Удержание не вооружено, поэтому отпускание кнопки не имеет к меню
    // отношения и оставляет его жить — как у меню, открытого правым кликом.
    await releaseAt(page, EMPTY_POINT, 'left');
    const held = await readMenu(page);
    expect(held.openCount, 'отпускание не закрывает программно открытое').toBe(1);

    await page.mouse.click(EMPTY_POINT.x, EMPTY_POINT.y);
    expect((await readMenu(page)).openCount, 'клик снаружи закрывает').toBe(0);
  });
});

test.describe('удержание с автоскрытием', () => {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {string} pressAndHold
   * @param {number} autoHideDistance
   * @returns {Promise<void>}
   */
  function enable(page, pressAndHold, autoHideDistance) {
    return makeMenu(page, { pressAndHold, autoHideDistance, containerId: 'surface', longRoot: false });
  }

  test('автоскрытие закрывает меню и снимает жест', async ({ page }) => {
    await enable(page, 'any', DISTANCE);
    await pressAt(page, PRESS_POINT, 'left');
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.move(EMPTY_POINT.x, EMPTY_POINT.y);
    expect((await readMenu(page)).openCount, 'автоскрытие закрыло').toBe(0);

    await releaseAt(page, EMPTY_POINT, 'left');
    const after = await readMenu(page);
    expect(after.calls, 'снятый жест не исполняет').toEqual([]);
    expect(after.openCount, 'меню не вернулось').toBe(0);
  });

  test('после автоскрытия следующее удержание работает', async ({ page }) => {
    await enable(page, 'any', DISTANCE);
    await pressAt(page, PRESS_POINT, 'left');
    await page.mouse.move(EMPTY_POINT.x, EMPTY_POINT.y);
    await releaseAt(page, EMPTY_POINT, 'left');
    expect((await readMenu(page)).openCount, 'первый жест закрыт').toBe(0);

    // Жест вооружается заново, а не остаётся мёртвым после автоскрытия.
    const point = await centerOfItem(page, 'Новый');
    await pressAndRelease(page, PRESS_POINT, point, 'left');
    const after = await readMenu(page);
    expect(after.calls, 'второй жест исполнил действие').toEqual(['Новый']);
    expect(after.openCount, 'меню закрылось').toBe(0);
  });

  test('автоскрытие не мешает жесту дойти до пункта подменю', async ({ page }) => {
    // Ключевой союз двух правил: курсор уходит из-под корня в сторону подменю, и
    // автоскрытие не должно считать это уходом — иначе жест прерывался бы ровно
    // там, где он идёт по делу.
    await enable(page, 'any', DISTANCE);
    await pressAt(page, PRESS_POINT, 'left');
    await hoverOwner(page, 'Экспорт');
    const opened = await readMenu(page);
    expect(opened.openCount, 'подменю открыто наведением').toBe(2);

    const point = await centerOfItem(page, 'PDF');
    await releaseAt(page, point, 'left');
    const after = await readMenu(page);
    expect(after.calls, 'действие пункта подменю отработало').toEqual(['PDF']);
    expect(after.openCount, 'меню закрылось').toBe(0);
  });
});

test.describe('isArmableAction', () => {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {'allow' | 'deny' | 'throw' | null} isArmable
   * @param {string} [pressAndHold]
   * @returns {Promise<void>}
   */
  async function withArmable(page, isArmable, pressAndHold = 'right') {
    await makeMenu(page, { pressAndHold, autoHideDistance: 0, containerId: 'surface', longRoot: false, isArmable });
  }

  test('отказ предиката не показывает меню и не вооружает жест', async ({ page }) => {
    await withArmable(page, 'deny');
    await pressAt(page, TARGET_POINT, 'right');
    const armed = await readMenu(page);
    expect(armed.openCount, 'меню не показано').toBe(0);
    expect(armed.armCalls.length, 'предикат звался').toBe(1);

    // Отказ не должен оставить жест вооруженным: иначе отпускание над пунктом
    // исполнило бы действие меню, которого на экране нет.
    await releaseAt(page, TARGET_POINT, 'right');
    const after = await readMenu(page);
    expect(after.calls, 'действие не исполнилось').toEqual([]);
    expect(after.openCount, 'меню не появилось').toBe(0);
  });

  test('разрешение предиката показывает меню обычным порядком', async ({ page }) => {
    await withArmable(page, 'allow');
    await pressAt(page, TARGET_POINT, 'right');
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);
    await releaseAt(page, TARGET_POINT, 'right');
    expect((await readMenu(page)).openCount, 'меню закрылось').toBe(0);
  });

  test('предикат видит нажатие до того, как меню показано', async ({ page }) => {
    // Ключевой союз опции с показом: предикат решает по нажатию, а подписи пунктов
    // читаются при показе. Если бы предикат звался позже, автор не успевал бы узнать
    // id жатого элемента — и меню нарисовалось бы по предыдущему.
    await withArmable(page, 'allow');
    await pressAt(page, TARGET_POINT, 'right');
    const shown = await readMenu(page);
    const [call] = shown.armCalls;
    expect(call.levelsOpen, 'на момент вызова меню ещё не было').toBe(0);
    expect(call.labelsThen, 'подписи корня ещё не построены').toEqual([]);
    expect(shown.openCount, 'меню показано').toBe(1);
    expect(shown.labels, 'подписи корня есть').toEqual([
      'Новый', 'Экспорт', 'Заметки', 'Ветка без действия',
    ]);
  });

  test('предикат получает живое событие нажатия с целью и точкой', async ({ page }) => {
    await withArmable(page, 'allow');
    await pressAt(page, TARGET_POINT, 'right');
    const [call] = (await readMenu(page)).armCalls;
    expect(call.x, 'clientX нажатия').toBe(TARGET_POINT.x);
    expect(call.y, 'clientY нажатия').toBe(TARGET_POINT.y);
    expect(call.button, 'кнопка нажатия').toBe(2);
    expect(call.targetId, 'цель нажатия доступна предикату').toBe('photo-1');
  });

  test('исключение предиката не гасится и не открывает меню', async ({ page }) => {
    // Как и любое другое действие автора, исключение уходит наружу: молчаливое
    // отсутствие меню выглядело бы как «здесь нечего открывать».
    await withArmable(page, 'throw');
    await pressAt(page, TARGET_POINT, 'right');
    const after = await readMenu(page);
    expect(after.openCount, 'меню не показано').toBe(0);
    expect(after.errors.join(' '), 'ошибка предиката дошла до страницы')
      .toContain('предикат автора упал');
  });

  test('без удержания предикат не зовётся', async ({ page }) => {
    // У `'none'` жеста нажатия нет вовсе, и опция молчала бы: автор задал бы запрет,
    // а меню всё равно открывалось бы правым кликом.
    await withArmable(page, 'deny', 'none');
    await page.mouse.click(TARGET_POINT.x, TARGET_POINT.y, { button: 'right' });
    const after = await readMenu(page);
    expect(after.armCalls.length, 'предикат не звался').toBe(0);
    expect(after.openCount, 'правый клик открыл меню').toBe(1);
  });

  test('опция не проходит проверку не как функция', async ({ page }) => {
    const message = await page.evaluate(async () => {
      const { MyContext } = await import('../../src/index.js');
      // Негодная опция задаётся намеренно, и тип `MyContextOptions` её не описывает,
      // поэтому сборка объекта идёт мимо него — иначе проверялось бы само объявление
      // типа, а не проверка конструктора.
      const options = { pressAndHold: 'right', isArmableAction: true };
      try {
        new MyContext([{ labelAction: () => 'Пункт' }], /** @type {never} */ (options));
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return null;
    });
    expect(message, 'конструктор отверг негодную опцию').toContain('isArmableAction');
  });
});
