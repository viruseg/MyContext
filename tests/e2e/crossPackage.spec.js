import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Сквозной сценарий контракта между двумя пакетами.
 *
 * Всё остальное проверяет каждый пакет в одиночку — фиктивным приёмником в
 * unit-тестах, настоящим Pielet в его собственном e2e. Здесь оба настоящие,
 * загруженные в одну страницу, и проверяется ровно то, чего не видит ни одна
 * сторона по отдельности: что `Pielet` в режиме удержания передаёт MyContext
 * зажатую кнопку, что MyContext в режиме удержания передаёт Pielet свою, и что
 * в обоих случаях остаётся одно меню и один живой жест.
 *
 * `Pielet` — независимый пакет, а не зависимость, поэтому в `package.json` его
 * нет. Тест грузит соседний чекаут через вторую ветку раздачи `scripts/serve.js`
 * и честно пропускается, если рядом чекаута нет: в CI с одним репозиторием
 * такой сценарий не собирается, и притворяться, что он проверился, нельзя.
 *
 * **Кнопки в сценариях подобраны так, чтобы кейс ломался без передачи `handoff`.**
 * Иначе проверка ничего не проверяла бы: меню, открытое без handoff, вооружается
 * по своему пресету, и если пресет случайно совпадает с зажатой кнопкой, жест
 * дойдёт до конца и без контракта. Поэтому либо ребёнок уже не на своей кнопке,
 * либо держится кнопка, которой у него в конфигурации нет.
 */

const SIBLING_ENTRY = resolve(import.meta.dirname, '..', '..', '..', 'Pielet', 'src', 'index.js');
const SIBLING_READY = existsSync(SIBLING_ENTRY);

const VIEWPORT = { width: 1000, height: 700 };

/** Точка в пустоте страницы: кольцо и меню откроются от неё. */
const PRESS_POINT = { x: 500, y: 350 };

/**
 * Кнопка, которую отслеживает кольцо.
 *
 * Должна совпадать с той, которой реально держат: hold-меню закрывается на первом
 * движении указателя, если его кнопка не зажата, и кольцо, открытое по кнопке,
 * которой никто не держит, закроется раньше, чем передаст хоть что-нибудь.
 * Предмет проверки в том, что **ребёнок** принимает кнопку, которой его открыли.
 */
const RING_BUTTON = 'right';

/** Кнопка, которой держится жест в сценарии Pielet → MyContext. */
const HELD = 'right';

/** Кнопка, которой держится жест в сценариях MyContext → Pielet. */
const HELD_LEFT = 'left';

const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/styles/mycontext.css" />
    <link rel="stylesheet" href="/pielet/src/styles/pielet.css" />
  </head>
  <body style="background: rgb(250, 250, 250)">
    <div id="surface" tabindex="-1"
         style="position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: rgb(240, 240, 240)">
    </div>
  </body>
</html>`;

test.skip(!SIBLING_READY, 'рядом нет чекаута Pielet — сквозной сценарий не собирается');

/**
 * @param {import('@playwright/test').Page} page
 * @param {'left' | 'middle' | 'right' | 'any'} innerPressAndHold пресет
 *   `pressAndHold` у MyContext — тот самый параметр, из-за которого передача
 *   `handoff` обязательна.
 * @returns {Promise<void>}
 */
async function boot(page, innerPressAndHold) {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/');
  await page.setContent(PAGE_HTML);
  await page.evaluate(async (preset) => {
    // Спецификаторы заданы переменными, а не литералами: литерал `/src/index.js`
    // `tsc` попытался бы разрешить как модуль репозитория и упал бы на
    // несуществующем пути. В браузере переменная работает как обычный импорт по URL.
    //
    // Pielet экспортируется по умолчанию (`src/index.js` → `export default Pielet`),
    // MyContext — именованным. Импорт с фиктивным именем был бы верен для одного
    // пакета и тихо дал бы `undefined` для второго.
    const myUrl = '/src/index.js';
    const pieletUrl = '/pielet/src/index.js';
    const { MyContext } = /** @type {{ MyContext: MyContextCtor }} */ (await import(myUrl));
    const { default: Pielet } = /** @type {{ default: PieletCtor }} */ (await import(pieletUrl));

    /** @type {string[]} */
    const log = [];
    /** @type {string[]} */
    const errors = [];
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });

    /** @type {PieletInstance | null} */
    let ring = null;

    /**
     * Отдача управления кольцу. Описание жеста приходит вторым аргументом и уходит
     * третьим без перевода: с `ring.open(x, y)` кольцо вооружилось бы по своей
     * конфигурации и закрылось бы на первом же движении, потому что держат левую,
     * а у него в конфигурации правая.
     *
     * @param {Event} event
     * @param {{ button: string | null, held: boolean }} handoff
     * @returns {void}
     */
    function toRing(event, handoff) {
      if (ring === null || !('clientX' in event)) {
        return;
      }
      const pointer = /** @type {PointerEvent} */ (event);
      ring.openSubmenu(pointer.clientX, pointer.clientY, handoff);
    }

    const inner = new MyContext(
      [
        { labelAction: () => 'Отдать', handoffAction: toRing },
        { labelAction: () => 'Обычный', action: () => log.push('Обычный') },
      ],
      { pressAndHold: preset },
    );

    ring = new Pielet({
      interactionMode: 'hold',
      button: 'right',
      submenuDelay: 60,
      items: [{ typeContent: 'text', content: 'Внутрь', isSubMenu: true, menu: inner }],
    });

    const scope = /** @type {{ __cross?: CrossProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__cross = {
      /** @param {{ x: number, y: number }} point */
      openRing(point) {
        if (ring === null) {
          throw new Error('кольцо не создано');
        }
        ring.open(point.x, point.y);
      },
      /** @param {{ x: number, y: number }} point */
      openInner(point) {
        // `armed` — кнопку держит страница, а не нажатие по контейнеру: показ
        // идёт в разборе цепочки, и прессы по меню там нет.
        inner.open({ x: point.x, y: point.y }, { armed: true, dismissible: true });
      },
      read() {
        return {
          rings: document.querySelectorAll('.pielet').length,
          levels: document.querySelectorAll('.vc-menu:popover-open').length,
          log: log.slice(),
          errors: errors.slice(),
        };
      },
    };
  }, innerPressAndHold);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {(point: { x: number, y: number }) => Promise<void>} open
 * @param {'left' | 'middle' | 'right'} button кнопка, которой держится жест.
 * @returns {Promise<void>}
 */
async function pressThenShow(page, open, button) {
  // Порядок обязателен в обе стороны. Вооружённый жест MyContext гасится любой
  // прессой, а hold-кольцо закрывается первым движением при незажатой своей
  // кнопке — то есть без прессы до показа передавать было бы нечего.
  await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
  await page.mouse.down({ button });
  await open(PRESS_POINT);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'openRing' | 'openInner'} method
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function call(page, method, point) {
  return page.evaluate(
    /** @param {['openRing' | 'openInner', { x: number, y: number }]} args */
    ([name, value]) => {
      const scope = /** @type {{ __cross: CrossProbe }} */ (/** @type {unknown} */ (globalThis));
      if (name === 'openRing') {
        scope.__cross.openRing(value);
        return;
      }
      scope.__cross.openInner(value);
    },
    /** @type {['openRing' | 'openInner', { x: number, y: number }]} */ ([method, point]),
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<CrossSnapshot>}
 */
function read(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __cross: CrossProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__cross.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<{ x: number, y: number }>}
 */
async function centreOf(page, label) {
  const point = await page.evaluate((text) => {
    for (const node of document.querySelectorAll('.vc-item')) {
      const textNode = node.querySelector('.vc-label');
      if (textNode !== null && String(textNode.textContent) === text) {
        const rect = node.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  }, label);
  expect(point, `пункт «${label}» есть в разметке`).not.toBeNull();
  return /** @type {{ x: number, y: number }} */ (point);
}

/**
 * Наводит указатель на единственный сектор кольца.
 *
 * Точка считается от прямоугольника кольца, а не берётся из элемента сектора:
 * у сектора прямоугольник равен всему кольцу, и `boundingBox` дал бы центр, где
 * секторов нет вовсе.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function hoverSector(page) {
  const box = await page.locator('.pielet').boundingBox();
  expect(box, 'кольцо на экране').not.toBeNull();
  const rect = /** @type {{ x: number, y: number, width: number, height: number }} */ (box);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 - rect.height * 0.29);
}

/**
 * @typedef {new (items: CrossItem[], options?: { pressAndHold?: 'left' | 'middle' | 'right' | 'any' }) => MyContextInstance} MyContextCtor
 */

/**
 * @typedef {object} MyContextInstance
 * @property {(params: { x: number, y: number }, options?: { armed?: boolean, dismissible?: boolean }) => void} open
 * @property {() => void} destroy
 */

/**
 * @typedef {new (config: { interactionMode: string, button: string, submenuDelay: number, items: object[] }) => PieletInstance} PieletCtor
 */

/**
 * @typedef {object} PieletInstance
 * @property {(x: number, y: number, handoff?: object) => void} openSubmenu
 * @property {(x: number, y: number) => void} open
 * @property {() => void} close
 */

/**
 * @typedef {object} CrossItem
 * @property {() => string} labelAction
 * @property {(event: Event, handoff: { button: string | null, held: boolean }) => void} [handoffAction]
 * @property {() => void} [action]
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} innerPressAndHold
 * @returns {Promise<void>}
 */

/**
 * @typedef {object} CrossProbe
 * @property {(point: { x: number, y: number }) => void} openRing
 * @property {(point: { x: number, y: number }) => void} openInner
 * @property {() => CrossSnapshot} read
 */

/**
 * @typedef {object} CrossSnapshot
 * @property {number} rings сколько колец на экране.
 * @property {number} levels сколько уровней MyContext на экране.
 * @property {string[]} log действия, исполнившиеся в MyContext.
 * @property {string[]} errors ошибки страницы.
 */

test('Pielet (hold) открывает MyContext (hold) и передаёт зажатую кнопку', async ({ page }) => {
  // Пресет MyContext — `left`, а кольцо передаёт `right`. Без передачи ребёнок
  // вооружился бы на своей кнопке, отпускание правой ничего бы не сделало, и
  // кейс рухнул бы на последнем утверждении.
  await boot(page, 'left');
  await pressThenShow(page, (point) => call(page, 'openRing', point), HELD);
  expect((await read(page)).rings, 'кольцо показано').toBe(1);

  await hoverSector(page);

  // Меню пришло по контракту, кольцо ушло вместе с ним.
  await expect(page.locator('.vc-menu:popover-open')).toHaveCount(1);
  await expect(page.locator('.pielet')).toHaveCount(0);

  const target = await centreOf(page, 'Обычный');
  await page.mouse.move(target.x, target.y);
  // Чужое отпускание отправляется без своей прессы: вторая пресса во время
  // удержания гасит жест сама по себе, и такой кейс проверял бы это правило
  // вместо контракта.
  await page.mouse.up({ button: 'left' });
  expect((await read(page)).levels, 'отпускание чужой кнопки не закрыло').toBe(1);

  await page.mouse.up({ button: HELD });
  await expect(page.locator('.vc-menu:popover-open')).toHaveCount(0);

  const after = await read(page);
  expect(after.log, 'действие пункта исполнилось').toEqual(['Обычный']);
  expect(after.errors, 'ошибок страницы нет').toEqual([]);
});

test('MyContext (hold) открывает Pielet (hold) и передаёт безымянный жест', async ({ page }) => {
  // Пресет MyContext — `any`, и внешнее вооружение при нём приходит безымянным:
  // handoff уходит с `button: null`. Держится левая, а у кольца в конфигурации
  // правая, поэтому без передачи кольцо закрылось бы на первом же движении.
  await boot(page, 'any');
  await pressThenShow(page, (point) => call(page, 'openInner', point), HELD_LEFT);

  const target = await centreOf(page, 'Отдать');
  await page.mouse.move(target.x, target.y);

  await expect(page.locator('.pielet')).toHaveCount(1);
  await expect(page.locator('.vc-menu:popover-open'), 'меню ушло вместе с кольцом').toHaveCount(0);

  // Проверка именно выживания, а не «кольца в итоге нет»: без передачи кольцо
  // тоже закрылось бы — на этом движении, по правилу «кнопка не удержана». Отличие
  // в том, дождался ли пользователь подсветки пункта и выбора по отпусканию.
  await hoverSector(page);
  await expect(page.locator('.pielet'), 'кольцо пережило движение с чужой кнопкой').toHaveCount(1);
  await expect(page.locator('.pielet__item--hover'), 'пункт кольца подсвечен').toHaveCount(1);

  await page.mouse.up({ button: HELD_LEFT });
  await expect(page.locator('.pielet')).toHaveCount(0);

  const after = await read(page);
  expect(after.errors, 'ошибок страницы нет').toEqual([]);
});

test('двойная передача оставляет одно меню и доводит жест до конца', async ({ page }) => {
  // MyContext отдаёт кольцу, кольцо отдаёт тому же MyContext. Ломается на этом
  // ровно одно: два меню на экране там, где пользователь ждёт одно, и жест,
  // потерянный на первом звене.
  await boot(page, 'any');
  await pressThenShow(page, (point) => call(page, 'openInner', point), HELD_LEFT);

  const give = await centreOf(page, 'Отдать');
  await page.mouse.move(give.x, give.y);

  await expect(page.locator('.pielet')).toHaveCount(1);
  await hoverSector(page);
  await expect(page.locator('.pielet'), 'кольцо пережило движение с чужой кнопкой').toHaveCount(1);

  // Кольцо отдало обратно: на экране снова меню MyContext, и кольца нет.
  await expect(page.locator('.vc-menu:popover-open')).toHaveCount(1);
  await expect(page.locator('.pielet')).toHaveCount(0);

  const midway = await read(page);
  expect(midway.rings, 'на экране одно меню').toBe(0);
  expect(midway.levels, 'на экране ровно один уровень').toBe(1);

  const ordinary = await centreOf(page, 'Обычный');
  await page.mouse.move(ordinary.x, ordinary.y);
  await page.mouse.up({ button: HELD_LEFT });

  // Ожидание условия, а не снимка: уровень гаснет в Top Layer и покидает его через
  // `animationDuration`, и синхронный замер после отпускания видел бы его ещё на
  // экране — то есть проверял бы анимацию выхода, а не конец жеста.
  await expect(page.locator('.vc-menu:popover-open')).toHaveCount(0);

  const after = await read(page);
  expect(after.log, 'действие исполнилось').toEqual(['Обычный']);
  expect(after.errors, 'ошибок страницы нет').toEqual([]);
});