import { expect, test } from '@playwright/test';
import { OPEN_GRACE_MS } from '../../src/constants.js';

/**
 * `open({ x, y }, { armed })` — открытие меню внутри уже начатого чужого жеста, и
 * `openAsSubmenu(x, y)` — пресет того же для чужого меню.
 *
 * Меню на удержании вооружается нажатием по собственному якорю: без этого
 * отпускание кнопки его не закрывает, потому что разбирать отпускание нечем —
 * жеста не было. Сценарий, ради которого существует `armed`, обратный: кнопку
 * держат, нажатия по якорю не было, а закрыть меню должен тот же жест.
 *
 * Кейсы ниже проверяют именно контракт `armed` и его пресета, а не работу
 * удержания вообще: она покрыта `pressAndHold.spec.js`, и дублировать её здесь
 * незачем. Порядок разбора внутри жеста на `destroyOnClose` проверяет
 * `destroyOnClose.spec.js` — там разбор стирает карту действий, а здесь не стирает.
 *
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/constants.js').PressAndHoldMode} PressAndHoldMode
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

/** Точка в пустоте страницы: подменю от неё развернётся вправо. */
const PRESS_POINT = { x: 260, y: 120 };

/** Кнопка, которой вооружают жест в кейсах без явного `pressAndHold`. */
const HELD_BUTTON = 'left';

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
    const calls = [];
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
      return { labelAction: () => label, action: () => calls.push(label) };
    }

    /** @type {InstanceType<typeof MyContext> | null} */
    let menu = null;

    const scope = /** @type {{ __armed?: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__armed = {
      /** @param {ArmedInput} input */
      make(input) {
        if (menu !== null) {
          menu.destroy();
        }
        calls.length = 0;
        errors.length = 0;
        menu = new MyContext(
          [
            item('Первый'),
            {
              labelAction: () => 'Ветка',
              submenuAction: () => [item('Лист')],
            },
          ],
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
      /**
       * @param {{ x: number, y: number }} point
       */
      openAsSubmenu(point) {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.openAsSubmenu(point.x, point.y);
      },
      read() {
        return {
          openCount: document.querySelectorAll('.vc-menu:popover-open').length,
          calls: calls.slice(),
          errors: errors.slice(),
        };
      },
    };
  });
});

/**
 * @typedef {object} ArmedInput
 * @property {string} pressAndHold
 * @property {boolean} attach
 */

/**
 * @typedef {object} ArmedProbe
 * @property {(input: ArmedInput) => void} make
 * @property {(point: { x: number, y: number }, armed?: boolean) => void} open
 * @property {(point: { x: number, y: number }) => void} openAsSubmenu
 * @property {() => ArmedSnapshot} read
 */

/**
 * @typedef {object} ArmedSnapshot
 * @property {number} openCount
 * @property {string[]} calls
 * @property {string[]} errors
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {ArmedInput} input
 * @returns {Promise<void>}
 */
function makeMenu(page, input) {
  return page.evaluate((config) => {
    const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__armed.make(config);
  }, input);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<ArmedSnapshot>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__armed.read();
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
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function openAsSubmenu(page, point) {
  return page.evaluate((anchor) => {
    const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__armed.openAsSubmenu(anchor);
  }, point);
}

test.describe('openAsSubmenu', () => {
  // Метод — пресет для чужого меню: `armed` плюс `dismissible`, и обе опции должны
  // быть проверены здесь, а не выведены из того, что `armed` уже покрыт выше.
  test('вооружает жест: отпускание кнопки закрывает показанное', async ({ page }) => {
    // Порядок обязателен: кнопку держит вызывающий код, и меню приходит в уже
    // начавшемся жесте. Без вооружения отпускание было бы некому разбирать.
    await makeMenu(page, { pressAndHold: HELD_BUTTON, attach: false });
    await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
    await page.mouse.down({ button: HELD_BUTTON });
    await openAsSubmenu(page, PRESS_POINT);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.up({ button: HELD_BUTTON });
    const after = await readMenu(page);
    expect(after.openCount, 'отпускание закрыло меню').toBe(0);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('поднимает правила закрытия на время показа', async ({ page }) => {
    // Вторая половина пресета, и она проверяется поведением, а не счётчиком
    // подписок: у непривязанного экземпляра правил закрытия нет вовсе, и без
    // `dismissible` прокрутка оставила бы показанное висеть поверх кольца, которое
    // ею же и закрывается. Проверяется на фоне `armed` — иначе кейс сходился бы и
    // по другой причине.
    await makeMenu(page, { pressAndHold: HELD_BUTTON, attach: false });
    await openAsSubmenu(page, PRESS_POINT);
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    // Настоящий `resize`, а не синтетическое событие: проверяется подписка, а не тело
    // обработчика, и подписку поднимает именно показ с `dismissible`.
    //
    // Ожидание условия, а не снимок сразу после `setViewportSize`: браузер отвечает на
    // смену вьюпорта раньше, чем приходит само событие, и утверждение без ожидания
    // мигает между прогонами.
    await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height + 1 });
    await page.waitForFunction(() => {
      return document.querySelectorAll('.vc-menu:popover-open').length === 0;
    });
    expect((await readMenu(page)).openCount, 'resize закрыл показанное').toBe(0);
  });
  test('отпускание над пунктом исполняет его действие', async ({ page }) => {
    // Жест, вооружённый снаружи, разбирает отпускание целиком, а не только
    // закрывает: под курсором может оказаться пункт, и его действие — часть
    // контракта. Нажатия по пункту не было, `click` не возникнет, и единственный
    // путь к действию — разбор отпускания.
    await makeMenu(page, { pressAndHold: HELD_BUTTON, attach: false });
    await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
    await page.mouse.down({ button: HELD_BUTTON });
    await openAsSubmenu(page, PRESS_POINT);

    const target = await centerOfItem(page, 'Первый');
    await page.mouse.move(target.x, target.y);
    await page.mouse.up({ button: HELD_BUTTON });

    const after = await readMenu(page);
    expect(after.calls, 'действие пункта исполнилось').toEqual(['Первый']);
    expect(after.openCount, 'меню закрыто').toBe(0);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('без удержания отклоняется', async ({ page }) => {
    // `armed` при `pressAndHold: 'none'` не имеет прочтения: закрывать меню будет
    // нечем, а молча не вооружённый жест оставил бы его висеть.
    await makeMenu(page, { pressAndHold: 'none', attach: false });
    const outcome = await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      try {
        scope.__armed.openAsSubmenu({ x: 260, y: 120 });
        return { threw: false, message: '' };
      } catch (error) {
        return { threw: true, message: error instanceof Error ? error.message : String(error) };
      }
    });
    expect(outcome.threw, 'openAsSubmenu бросил ошибку').toBe(true);
    expect(outcome.message).toContain('armed');
  });
});

test.describe('open с armed', () => {
  test('отпускание кнопки закрывает меню, открытое с armed', async ({ page }) => {
    // Смысл опции: меню открыто посреди чужого жеста, и отпускание той же кнопки
    // обязано его закрыть. Без armed меню осталось бы висеть до следующего события.
    await makeMenu(page, { pressAndHold: 'left', attach: false });

    // Порядок обязателен: кнопка нажимается ДО показа меню. Иначе нажатие пришлось
    // бы по самому меню, а его отпускание породило бы `click`, который меню
    // разбирает обычным путём — и кейс проверял бы клик, а не armed.
    await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
    await page.mouse.down({ button: HELD_BUTTON });
    await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__armed.open({ x: 260, y: 120 }, true);
    });
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.up({ button: HELD_BUTTON });
    expect((await readMenu(page)).openCount, 'отпускание закрыло меню').toBe(0);
    expect((await readMenu(page)).errors, 'ошибок страницы нет').toEqual([]);
  });

  test('armed без удержания отклоняется', async ({ page }) => {
    // `armed` при `pressAndHold: 'none'` не имеет прочтения: закрывать меню будет
    // нечем, а молчаливое игнорирование выдало бы опцию за сработавшую.
    await makeMenu(page, { pressAndHold: 'none', attach: false });
    const outcome = await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      try {
        scope.__armed.open({ x: 260, y: 120 }, true);
        return { threw: false, message: '' };
      } catch (error) {
        return { threw: true, message: error instanceof Error ? error.message : String(error) };
      }
    });
    expect(outcome.threw, 'open бросил ошибку').toBe(true);
    expect(outcome.message).toContain('armed');
  });

  test('armed: не-логическое значение отклоняется', async ({ page }) => {
    // Негодное значение молча превратилось бы в «жест вооружён» либо в «не
    // вооружён», и оба ответа выдавали бы себя за заданное автором.
    await makeMenu(page, { pressAndHold: 'left', attach: false });
    const outcome = await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      const menu = /** @type {{ open: (p: { x: number, y: number }, o: unknown) => void }} */
        (/** @type {unknown} */ (scope.__armed));
      try {
        menu.open({ x: 260, y: 120 }, { armed: 'yes' });
        return { threw: false, message: '' };
      } catch (error) {
        return { threw: true, message: error instanceof Error ? error.message : String(error) };
      }
    });
    expect(outcome.threw, 'open бросил ошибку').toBe(true);
    expect(outcome.message).toContain('armed');
  });

  test('armed: не ложь и не истина', async ({ page }) => {
    // Без armed поведение прежнее, и без явного armed — тоже: опция обязана
    // отличаться от «не задана вовсе», иначе второе значение молча выключало бы
    // удержание целиком.
    await makeMenu(page, { pressAndHold: 'left', attach: false });

    // Порядок обязателен и здесь: кнопка нажимается ДО показа меню, иначе нажатие
    // пришлось бы по самому меню и породило бы `click` на его пункте.
    await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
    await page.mouse.down({ button: HELD_BUTTON });
    await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__armed.open({ x: 260, y: 120 });
    });
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.up({ button: HELD_BUTTON });
    expect((await readMenu(page)).openCount, 'отпуск��ние без armed меню не закрывает').toBe(1);
  });

  test('armed с привязанным контейнером: отпускание закрывает', async ({ page }) => {
    // Привязка не отменяет вооружения: у экземпляра, который и сам умеет
    // вооружаться нажатием по якорю, открытие с armed обязано вести себя так же.
    await makeMenu(page, { pressAndHold: 'left', attach: true });
    await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
    await page.mouse.down({ button: HELD_BUTTON });
    await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__armed.open({ x: 260, y: 120 }, true);
    });
    expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

    await page.mouse.up({ button: HELD_BUTTON });
    expect((await readMenu(page)).openCount, 'отпускание закрыло меню').toBe(0);
  });

  test('armed: отпускание над пунктом исполняет его действие', async ({ page }) => {
    // Вооружённый жест обязан разбирать отпускание целиком, а не только закрывать
    // меню: под курсором может оказаться пункт, и его действие — обычная часть
    // контракта удержания.
    await makeMenu(page, { pressAndHold: 'left', attach: false });
    await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
    await page.mouse.down({ button: HELD_BUTTON });
    await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__armed.open({ x: 260, y: 120 }, true);
    });

    const target = await centerOfItem(page, 'Первый');
    await page.mouse.move(target.x, target.y);
    await page.mouse.up({ button: HELD_BUTTON });

    const after = await readMenu(page);
    expect(after.openCount, 'меню закрыто').toBe(0);
    expect(after.calls, 'действие пункта исполнилось').toEqual(['Первый']);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });

  test('armed: чужая кнопка не закрывает', async ({ page }) => {
    // Жест вооружён левой кнопкой, и отпускание правой — не его конец. Правило
    // «кнопка совпала» принадлежит удержанию, а не только что-то одно про
    // вооружение.
    await makeMenu(page, { pressAndHold: 'left', attach: false });
    await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
    await page.mouse.down({ button: HELD_BUTTON });
    await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__armed.open({ x: 260, y: 120 }, true);
    });

    // Правая нажимается и отпускается поверх зажатой левой: настоящим вводом
    // Playwright это воспроизводится, и закрытия быть не должно.
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    expect((await readMenu(page)).openCount, 'правая кнопка не закрыла').toBe(1);
  });

  test('armed: close() снимает жест, и следующее открытие снова под отпускание', async ({ page }) => {
    // Жест переживать открытие не должен: закрытое меню обязано забыть о нём,
    // иначе первый же отпусканный чужой указатель закрыл бы новое меню.
    await makeMenu(page, { pressAndHold: 'left', attach: false });
    await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__armed.open({ x: 260, y: 120 }, true);
    });
    await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__armed.read();
    });
    await page.keyboard.press('Escape');
    expect((await readMenu(page)).openCount, 'Escape закрыл меню').toBe(0);

    await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__armed.open({ x: 260, y: 120 }, true);
    });
    expect((await readMenu(page)).openCount, 'меню показано снова').toBe(1);
    await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
    await page.mouse.down({ button: HELD_BUTTON });
    await page.mouse.up({ button: HELD_BUTTON });
    expect((await readMenu(page)).openCount, 'отпускание закрыло новое меню').toBe(0);
  });

  test('armed и наведение на владельца подменю работают вместе', async ({ page }) => {
    // Меню, открытое с armed, — полноценное меню на удержании: его собственные
    // подменю раскрываются по наведению, как и у открытого по нажатию.
    await makeMenu(page, { pressAndHold: 'left', attach: false });
    await page.evaluate(() => {
      const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__armed.open({ x: 260, y: 120 }, true);
    });

    const owner = await centerOfItem(page, 'Ветка');
    await page.mouse.move(owner.x, owner.y);
    await page.waitForTimeout(OPEN_GRACE_MS + 100);
    expect((await readMenu(page)).openCount, 'подменю раскрылось').toBe(2);
  });
});