import { expect, test } from '@playwright/test';
import { OPEN_GRACE_MS } from '../../src/constants.js';

/**
 * Кейсы автоскрытия против настоящей страницы: курсор водится настоящим вводом
 * Playwright, модуль грузится динамическим импортом прямо в браузере.
 *
 * Три решения, на которых держится весь файл.
 *
 * **Время принадлежит `page.clock`, и оно заморожено.** Подменю открывается через
 * `OPEN_GRACE_MS`, и без заморозки утверждение «подменю открыто» было бы гонкой.
 * Отдельно заморозка нужна вот зачем: кейсы про автоскрытие проверяют «меню живо
 * после движения», и без остановленного времени движение и следующая за ним
 * анимация гашения слились бы в один результат — закрылось оно или просто ещё
 * не доехало.
 *
 * **`reducedMotion: 'reduce'` убирает отложенное закрытие.** Слой под `reduce`
 * зовёт `hidePopover()` сразу, поэтому «меню закрылось» читается в том же
 * снимке, в котором закрылось. Задержка открытия подменю при этом остаётся
 * настоящей — она у `hoverIntent`, и её гоняют часами.
 *
 * **Точки ухода считаются от настоящих рамок, а не заданы числами.** Кейс про
 * подменю обязан увести курсор далеко от корня и близко к подменю; при
 * захардкоженных координатах такое утверждение развалилось бы вместе с
 * вёрсткой, и молча проверило бы совсем другое. Зазор `SUBMENU_OFFSET` и высоты
 * уровней в снимке не заданы, поэтому расстояние считается здесь же, из рамок.
 */

/**
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
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
 * @property {string | null} focusOwnerId `id` элемента с фокусом либо имя тега.
 * @property {boolean} focusInMenu стоит ли фокус в дереве уровней меню.
 * @property {string[]} errors сообщения необработанных ошибок страницы.
 */

/**
 * @typedef {object} McProbe
 * @property {(autoHideDistance: number, containerId: string | null) => void} make
 * @property {(x: number, y: number) => void} open
 * @property {() => Snapshot} read
 */

/**
 * Расстояние от точки до рамки, px. Переписано здесь, а не импортировано из
 * `src/geometry.js`: кейс проверяет правило целиком, и если бы он считал тем же
 * кодом, который проверяет, то ошибка в геометрии прошла бы в обоих направлениях
 * сразу. Ответ нужен кейсу для выбора точки ухода, а не для проверки.
 *
 * @param {{ x: number, y: number }} point
 * @param {MenuRect} rect
 * @returns {number}
 */
function distanceFromPoint(point, rect) {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
  return Math.hypot(dx, dy);
}

const STYLESHEET_PATH = '/styles/mycontext.css';

const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <body style="background: rgb(255, 255, 255)">
    <div id="surface" tabindex="-1"
         style="position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: rgb(240, 240, 240)"></div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };

/**
 * Точка правого клика. Левая от края, чтобы подменю поместилось справа, и
 * середина по вертикали, чтобы каскад из трёх уровней укладывался и по высоте.
 */
const OPEN_POINT = { x: 260, y: 120 };

/**
 * Порог автоскрытия в кейсах, где он задан явно. Заведомо больше `SUBMENU_OFFSET`
 * и больше высоты пункта: иначе уход по диагонали к подменю и движение между
 * пунктами одного уровня попадали бы в зону закрытия, и кейс проверял бы не
 * автоскрытие, а негодный порог.
 */
const DISTANCE = 120;

const CLOCK_FROZEN_AT = new Date('2024-12-10T09:00:00Z');
const CLOCK_START_AT = new Date(CLOCK_FROZEN_AT.getTime() - 3_600_000);

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} autoHideDistance
 * @param {string | null} containerId
 * @returns {Promise<void>}
 */
function makeMenu(page, autoHideDistance, containerId) {
  return page.evaluate((input) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(input.autoHideDistance, input.container);
  }, { autoHideDistance, container: containerId });
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
 * Точка на расстоянии `offset` от уровня в указанную сторону.
 *
 * Сторона задаётся смещением от середины рамки, а не координатой: уход должен
 * отстоять от уровня на заданное число пикселей по обеим осям сразу, иначе
 * «далеко» оказывалось бы «далеко по горизонтали, но внутри по вертикали».
 *
 * @param {MenuRect} rect рамка уровня.
 * @param {{ x: number, y: number }} offset смещение от середины рамки.
 * @returns {{ x: number, y: number }}
 */
function beyondRect(rect, offset) {
  return { x: rect.left + rect.width / 2 + offset.x, y: rect.top + rect.height / 2 + offset.y };
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

    /**
     * Набор объявлен здесь, а не приходит аргументом: у пунктов есть
     * `submenuAction`-функции, а `page.evaluate` сериализует аргументы как JSON.
     *
     * Подменю заведомо длиннее корня, и это условие самого кейса, а не украшение:
     * подменю выравнивается по верхней границе пункта-владельца, поэтому короткое
     * подменю кончается не ниже корня, и под его нижним краем не существует точки,
     * которая была бы далеко от корня и близко к подменю. Восемь строк против трёх
     * дают около 140 лишних пикселей снизу — с запасом больше порога.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const items = [
      { labelAction: () => 'Новый' },
      {
        labelAction: () => 'Экспорт',
        submenuAction: () => Array.from({ length: 8 }, (_unused, index) => {
          return { labelAction: () => `Формат ${index + 1}` };
        }),
      },
      { labelAction: () => 'Заметки' },
    ];

    /** @type {string[]} */
    const errors = [];
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });

    /** @type {InstanceType<typeof MyContext> | null} */
    let menu = null;

    const probe = /** @type {McProbe} */ ({
      make(autoHideDistance, containerId) {
        if (menu !== null) {
          menu.destroy();
        }
        errors.length = 0;
        menu = new MyContext(items, { label: 'Меню пробы', autoHideDistance });
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
      read() {
        const rects = Array.from(document.querySelectorAll('.vc-menu')).map((element) => {
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
          focusInMenu:
            active !== null && active.closest('.vc-menu') !== null,
          errors: errors.slice(),
        };
      },
    });

    const scope = /** @type {{ __mc?: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc = probe;
  });
});

test.describe('опция выключена по умолчанию', () => {
  test('курсор уходит за пределы любого порога, меню живёт', async ({ page }) => {
    await makeMenu(page, 0, 'surface');
    await openAt(page, OPEN_POINT);
    const before = await readMenu(page);
    expect(before.openCount, 'меню показано').toBe(1);

    const away = beyondRect(before.rects[0], { x: 400, y: 300 });
    await page.mouse.move(away.x, away.y);
    const after = await readMenu(page);
    expect(after.openCount, 'меню не закрылось').toBe(1);
    expect(after.errors).toEqual([]);
  });

  test('дефолт равен нулю: без опции ведёт себя так же, как с нулём', async ({ page }) => {
    // Отдельный экземпляр без поля вовсе: иначе кейс проверял бы только то, что
    // ноль и отсутствие поля кодируются одинаково, но не то, что отсутствие поля
    // вообще не включает проверку. Расстояние здесь заведомо заведомое.
    //
    // Экземпляр нигде не сохраняется и это не утечка: `attach` вешает на
    // контейнер слушатели, ссылающиеся на него, и до снятия тех слушателей он
    // жив сам по себе. Проба `__mc` в этом кейсе не нужна вовсе.
    await page.evaluate(async () => {
      const { MyContext } = await import('../../src/index.js');
      const container = document.getElementById('surface');
      const bare = new MyContext([{ labelAction: () => 'Пункт' }], { label: 'Меню пробы' });
      if (container instanceof HTMLElement) {
        bare.attach(container);
      }
    });
    await openAt(page, OPEN_POINT);
    const away = beyondRect((await readMenu(page)).rects[0], { x: 400, y: 300 });
    await page.mouse.move(away.x, away.y);
    const openCount = await page.evaluate(() => {
      return document.querySelectorAll('.vc-menu:not(:popover-open)').length;
    });
    expect(openCount, 'все уровни в Top Layer').toBe(0);
  });
});

test.describe('автоскрытие включено', () => {
  test('уход дальше порога закрывает меню', async ({ page }) => {
    await makeMenu(page, DISTANCE, 'surface');
    await openAt(page, OPEN_POINT);
    const before = await readMenu(page);
    expect(before.openCount, 'меню показано').toBe(1);

    const away = beyondRect(before.rects[0], { x: DISTANCE + 80, y: DISTANCE + 80 });
    expect(distanceFromPoint(away, before.rects[0]), 'точка за порогом')
      .toBeGreaterThan(DISTANCE);
    await page.mouse.move(away.x, away.y);

    const after = await readMenu(page);
    expect(after.openCount, 'меню закрылось').toBe(0);
    expect(after.errors).toEqual([]);
  });

  test('фокус возвращается на контейнер', async ({ page }) => {
    // Возврат, а не молчание: курсор своим уходом фокус никуда не уводит, а
    // закрывающийся уровень фокус держит, и без возврата он упал бы на `<body>`.
    await makeMenu(page, DISTANCE, 'surface');
    await openAt(page, OPEN_POINT);
    const before = await readMenu(page);
    expect(before.focusInMenu, 'фокус на уровне').toBe(true);

    const away = beyondRect(before.rects[0], { x: DISTANCE + 80, y: DISTANCE + 80 });
    await page.mouse.move(away.x, away.y);

    const after = await readMenu(page);
    expect(after.focusOwnerId, 'фокус на контейнере').toBe('surface');
  });

  test('уход в пределах порога меню не трогает', async ({ page }) => {
    await makeMenu(page, DISTANCE, 'surface');
    await openAt(page, OPEN_POINT);
    const before = await readMenu(page);

    const near = beyondRect(before.rects[0], { x: DISTANCE - 30, y: DISTANCE - 30 });
    expect(distanceFromPoint(near, before.rects[0]), 'точка в пределах порога')
      .toBeLessThanOrEqual(DISTANCE);
    await page.mouse.move(near.x, near.y);

    const after = await readMenu(page);
    expect(after.openCount, 'меню живо').toBe(1);
    expect(after.errors).toEqual([]);
  });

  test('движение внутри меню не закрывает', async ({ page }) => {
    // Наименьшее расстояние, какое только возможно, — ноль: правило обязано
    // молчать не «почти», а вовсе.
    await makeMenu(page, DISTANCE, 'surface');
    await openAt(page, OPEN_POINT);
    const before = await readMenu(page);
    const inside = {
      x: before.rects[0].left + before.rects[0].width / 2,
      y: before.rects[0].top + before.rects[0].height / 2,
    };
    expect(distanceFromPoint(inside, before.rects[0]), 'точка внутри').toBe(0);
    await page.mouse.move(inside.x, inside.y);

    const after = await readMenu(page);
    expect(after.openCount, 'меню живо').toBe(1);
  });
});

test.describe('автоскрытие с открытым подменю', () => {
  /**
   * Открывает подменю пункта «Экспорт» и возвращает рамки показанных уровней.
   *
   * @param {import('@playwright/test').Page} page
   * @returns {Promise<MenuRect[]>}
   */
  async function openWithSubmenu(page) {
    await openAt(page, OPEN_POINT);
    const owner = await page.evaluate(() => {
      for (const element of document.querySelectorAll('.vc-item')) {
        const label = element.querySelector('.vc-label');
        if (label !== null && String(label.textContent) === 'Экспорт') {
          const rect = element.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      }
      return null;
    });
    expect(owner, 'пункт «Экспорт» есть в разметке').not.toBeNull();
    const point = /** @type {{ x: number, y: number }} */ (owner);
    await page.mouse.move(point.x, point.y);
    // Наведение планирует показ, а не делает его: без хода часов подменю не будет,
    // и кейс проверял бы уход от одного уровня вместо ухода от цепочки.
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(opened.openCount, 'подменю открыто').toBe(2);
    return opened.rects;
  }

  test('курсор далеко от корня, но близко к подменю, — меню живо', async ({ page }) => {
    // Ключевой кейс: уход в сторону открытого подменю — это не уход из меню.
    // Проверяется обеими сторонами сразу: точка далеко от корня (иначе закрытие
    // объяснялось бы расстоянием до него) и близко к подменю (иначе кейс
    // проходил бы на любом пороге).
    await makeMenu(page, DISTANCE, 'surface');
    const rects = await openWithSubmenu(page);
    const root = rects[0];
    const submenu = rects[1];

    // Точка под нижним краем подменю и одновременно далеко вниз от корня: подменю
    // ниже корня тем, что в нём на пункт больше строк, и этот зазор — ровно
    // расстояние, на котором уход в сторону ещё не считается уходом из меню.
    const point = {
      x: submenu.left + submenu.width / 2,
      y: submenu.bottom + 20,
    };
    expect(distanceFromPoint(point, submenu), 'близко к подменю').toBeLessThanOrEqual(DISTANCE);
    expect(distanceFromPoint(point, root), 'далеко от корня').toBeGreaterThan(DISTANCE);

    await page.mouse.move(point.x, point.y);
    const after = await readMenu(page);
    expect(after.openCount, 'меню живо').toBe(2);
    expect(after.errors).toEqual([]);
  });

  test('уход далеко от всех уровней закрывает всю цепочку', async ({ page }) => {
    await makeMenu(page, DISTANCE, 'surface');
    const rects = await openWithSubmenu(page);
    const root = rects[0];
    const submenu = rects[1];

    const point = beyondRect(submenu, { x: DISTANCE + 80, y: DISTANCE + 80 });
    expect(distanceFromPoint(point, submenu), 'далеко от подменю').toBeGreaterThan(DISTANCE);
    expect(distanceFromPoint(point, root), 'далеко от корня').toBeGreaterThan(DISTANCE);

    await page.mouse.move(point.x, point.y);
    const after = await readMenu(page);
    // Вся цепочка, а не один уровень: правило отвечает на вопрос «показано ли
    // ещё что-нибудь», и закрытие последнего уровня оставило бы висящий корень.
    expect(after.openCount, 'оба уровня закрыты').toBe(0);
  });

  test('зазор между уровнями меряется от обеих рамок', async ({ page }) => {
    // Зазор между корнем и подменю пуст, и закрывать в нём нельзя: это ровно
    // путь, которым курсор идёт от пункта к его подменю. Здесь точка стоит в
    // зазоре и в пределах порога от обеих рамок — то есть ни одна из них не
    // может объяснить закрытие расстоянием.
    await makeMenu(page, DISTANCE, 'surface');
    const rects = await openWithSubmenu(page);
    const root = rects[0];
    const submenu = rects[1];

    const point = {
      x: (root.right + submenu.left) / 2,
      y: (root.top + root.bottom) / 2,
    };
    expect(distanceFromPoint(point, root), 'в зазоре от корня').toBeLessThanOrEqual(DISTANCE);
    expect(distanceFromPoint(point, submenu), 'в зазоре от подменю')
      .toBeLessThanOrEqual(DISTANCE);

    await page.mouse.move(point.x, point.y);
    const after = await readMenu(page);
    expect(after.openCount, 'меню живо').toBe(2);
  });
});

test.describe('границы правила', () => {
  test('меню, открытое программно мимо курсора, скрывается по первому движению', async ({ page }) => {
    // У правила нет предыстории: «был ли курсор в меню» не спрашивается, потому
    // что вопрос этот и породил прежнюю безопасную область. Меню открыто в точке
    // вдали от курсора, и первое же движение мыши его убирает.
    //
    // Привязка есть, и это не украшение: без неё глобальных слушателей на
    // странице нет вовсе, и не сработало бы ни это правило, ни скролл, ни клик, —
    // экземпляр без `attach` по договорённости пригоден лишь для `open()`.
    await makeMenu(page, DISTANCE, 'surface');
    const idle = { x: 900, y: 600 };
    await page.mouse.move(idle.x, idle.y);
    await page.evaluate((point) => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.open(point.x, point.y);
    }, { x: 100, y: 100 });
    const before = await readMenu(page);
    expect(before.openCount, 'меню показано').toBe(1);

    // Движение на два пикселя: правило не спрашивает «много ли пройдено»,
    // спрашивает «далеко ли сейчас», и двух пикселей достаточно.
    await page.mouse.move(idle.x + 2, idle.y);
    const after = await readMenu(page);
    expect(after.openCount, 'меню закрылось').toBe(0);
  });

  test('закрытое меню движением не трогается', async ({ page }) => {
    // Обработчик работает на каждом движении, а меню может быть не показано вовсе:
    // пустая цепочка обязана быть пропущена, иначе правило сработало бы и на
    // висящем отложенном показе, отменив его вместо того, чтобы закрыть меню.
    await makeMenu(page, DISTANCE, 'surface');
    await openAt(page, OPEN_POINT);
    const before = await readMenu(page);
    const away = beyondRect(before.rects[0], { x: DISTANCE + 80, y: DISTANCE + 80 });
    await page.mouse.move(away.x, away.y);
    expect((await readMenu(page)).openCount, 'меню закрылось').toBe(0);

    await page.mouse.move(away.x + 100, away.y + 100);
    const after = await readMenu(page);
    expect(after.openCount, 'по-прежнему закрыто').toBe(0);
    expect(after.errors).toEqual([]);
  });

  test('выход за порог отменяет отложенное открытие подменю', async ({ page }) => {
    // Показ подменю отложен на `OPEN_GRACE_MS`, и уход курсора в этот промежуток
    // закрывает всё меню вместе с висящим показом: подменю, которое показалось бы
    // после закрытия, было бы мигающим призраком без своего меню.
    await makeMenu(page, DISTANCE, 'surface');
    await openAt(page, OPEN_POINT);
    const before = await readMenu(page);
    const owner = await page.evaluate(() => {
      for (const element of document.querySelectorAll('.vc-item')) {
        const label = element.querySelector('.vc-label');
        if (label !== null && String(label.textContent) === 'Экспорт') {
          const rect = element.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      }
      return null;
    });
    const point = /** @type {{ x: number, y: number }} */ (owner);
    await page.mouse.move(point.x, point.y);

    const away = beyondRect(before.rects[0], { x: DISTANCE + 80, y: DISTANCE + 80 });
    await page.mouse.move(away.x, away.y);
    expect((await readMenu(page)).openCount, 'меню закрылось до истечения срока').toBe(0);

    await page.clock.fastForward(OPEN_GRACE_MS * 2);
    const after = await readMenu(page);
    expect(after.openCount, 'подменю не показалось').toBe(0);
    expect(after.errors).toEqual([]);
  });
});
