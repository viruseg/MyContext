import { expect, test } from '@playwright/test';

/**
 * Предикат видимости пункта: `isVisibleAction`.
 *
 * Отличие от `isEnabledAction` не в формулировке, а в результате: отключённый пункт
 * стоит на месте и не выбирается, а скрытый не попадает в меню вовсе — у него нет узла,
 * нет номера в не-разделительном ряду и нет места в `aria-setsize`. Проверяется
 * поэтому не «пункт гаснет», а согласованность уровня после того, как часть пунктов из
 * него выпала: счётчики `aria`, кольцо роуминга, адрес подменю и то, что действия
 * скрытого пункта всё равно зовутся.
 *
 * Отдельный набор — про повторные показы: уровень живёт дольше одного показа, и ответ
 * предиката, сменившийся между ними, обязан изменить уровень целиком, а не оставить на
 * месте узел, которого быть не должно.
 *
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 */

/**
 * Описание строящегося пункта или разделителя. `page.evaluate` не везёт функции в
 * аргумент, поэтому предикаты и действия задаются ответами: из них страница сама
 * собирает нужную форму.
 *
 * @typedef {object} ItemSpec
 * @property {string} [id] авторский идентификатор: попадает в `data-id` и в отпечаток
 *   состава, по нему же счётчики вызовов собираются в один объект.
 * @property {string} [label] подпись пункта.
 * @property {boolean | string} [visible] ответ `isVisibleAction`. `true` рисует пункт,
 *   всё остальное скрывает: сравнение строгое, как у `isEnabledAction`. Без поля
 *   предиката нет вовсе, и это другой случай, чем `visible: false`.
 * @property {boolean} [slowVisible] обернуть ли `isVisibleAction` в `async` с задержкой.
 * @property {boolean} [throwVisible] ронять ли `isVisibleAction` отказом.
 * @property {boolean} [enabled] ответ `isEnabledAction`.
 * @property {Array<ItemSpec>} [submenu] состав подменю.
 * @property {boolean} [slowSubmenu] обернуть ли `submenuAction` в `async` с задержкой.
 * @property {'separator'} [type] разделитель; остальные поля у него не имеют смысла.
 */

/**
 * @typedef {object} MakeInput
 * @property {Array<ItemSpec>} items состав уровня.
 * @property {boolean} [watch] подписан ли кто-нибудь на `error`.
 */

/**
 * Сколько раз звано каждое действие пункта. Поле `id` обязательно: по нему же пункт
 * узнаётся в разметке, и без него счётчики разных пунктов слились бы в один.
 *
 * @typedef {object} Calls
 * @property {number} label
 * @property {number} visible
 * @property {number} enabled
 * @property {number} submenu
 * @property {number} focus
 * @property {number} blur
 * @property {number} action
 */

/**
 * @typedef {object} VisibilityLog
 * @property {number} shown сколько уровней показано.
 * @property {string | null} levelId адрес показанного уровня: перестройка обязана
 *   оставить прежний, иначе `aria-owns` пункта-владельца повис бы на старом адресе.
 * @property {string[]} labels подписи показанных пунктов, по порядку.
 * @property {number} separators сколько разделителей в показанных уровнях.
 * @property {Array<string | null>} setsize
 * @property {Array<string | null>} posinset
 * @property {Array<string | null>} owns `aria-owns` показанных пунктов.
 * @property {number} haspopup сколько пунктов помечены `aria-haspopup="menu"`.
 * @property {number} chevrons сколько шевронов в разметке показанных уровней.
 * @property {string[]} marks отметки действий: `act:Метка`, `focus:Метка`, `blur:Метка`.
 * @property {Record<string, Calls>} calls счётчики вызовов по `id` пункта.
 * @property {string[]} errors сообщения отказов из событий `error`.
 * @property {string[]} pageErrors сообщения непойманных ошибок страницы.
 * @property {string | null} focusLabel подпись пункта с фокусом.
 * @property {string[]} itemsInOpenLevels подписи всех пунктов показанных уровней,
 *   включая подменю.
 */

/**
 * @typedef {object} Probe
 * @property {(input: MakeInput) => void} make
 * @property {(specs: Array<ItemSpec>) => void} setItems
 * @property {(point: { x: number, y: number }) => Promise<{ ok: boolean, message: string | null }>} tryOpen
 * @property {(key: string) => Promise<void>} press
 * @property {(label: string) => ({ left: number, top: number, width: number, height: number } | null)} rectOf
 * @property {(label: string) => void} clickItem
 * @property {() => void} closeMenu
 * @property {() => void} resetCalls
 * @property {() => VisibilityLog} read
 */

const STYLESHEET_PATH = '/styles/mycontext.css';

const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <body style="background: rgb(255, 255, 255); margin: 0">
    <div id="surface" tabindex="-1"
         style="position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: rgb(240, 240, 240)">
    </div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 800 };
const OPEN_POINT = { x: 200, y: 200 };
const FAILURE_TEXT = 'сломалось';

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
  // `reduce` пропускает отложенное скрытие целиком: состояние после закрытия не зависит
  // от таймера, и повторный показ начинается с чистого листа.
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { MyContext } = await import('../../src/index.js');
    const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));

    // Настоящая задача, а не микротаска: микротаска не отдаёт управление наружу, и
    // проверка ожидания не отличила бы его от отсутствия.
    const delay = 20;
    const failure = 'сломалось';

    /** @type {string[]} */
    const marks = [];
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const pageErrors = [];
    /** @type {Map<string, Calls>} */
    const calls = new Map();
    /** @type {Array<MenuItem | SeparatorItem>} */
    let items = [];
    /** @type {InstanceType<typeof MyContext> | null} */
    let menu = null;
    /** @type {boolean} */
    let watch = false;

    globalThis.addEventListener('error', (event) => {
      pageErrors.push(String(event.message));
    });

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    function wait(ms) {
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    }

    /**
     * @param {ItemSpec} spec
     * @returns {MenuItem | SeparatorItem}
     */
    function build(spec) {
      const id = spec.id ?? spec.label ?? 'Пункт';
      const counts = { label: 0, visible: 0, enabled: 0, submenu: 0, focus: 0, blur: 0, action: 0 };
      calls.set(id, counts);
      if (spec.type === 'separator') {
        /** @type {SeparatorItem} */
        const separator = { type: 'separator' };
        if (spec.visible !== undefined) {
          // Ответ намеренно может оказаться не `true` и не `boolean` вовсе: строгое
          // сравнение и есть предмет проверки, и подменять его настоящим `boolean`
          // значило бы проверить не то.
          const answer = /** @type {boolean} */ (spec.visible);
          separator.isVisibleAction = spec.slowVisible === true
            ? async () => {
              counts.visible += 1;
              await wait(delay);
              return answer;
            }
            : () => {
              counts.visible += 1;
              return answer;
            };
        }
        return separator;
      }
      /** @type {Record<string, unknown>} */
      const item = {};
      const text = spec.label ?? id;
      item.labelAction = () => {
        counts.label += 1;
        return text;
      };
      if (spec.visible !== undefined) {
        const answer = spec.visible;
        if (spec.throwVisible === true) {
          item.isVisibleAction = async () => {
            counts.visible += 1;
            await wait(delay);
            throw new Error(failure);
          };
        } else if (spec.slowVisible === true) {
          item.isVisibleAction = async () => {
            counts.visible += 1;
            await wait(delay);
            return answer;
          };
        } else {
          item.isVisibleAction = () => {
            counts.visible += 1;
            return answer;
          };
        }
      }
      if (spec.enabled !== undefined) {
        const answer = spec.enabled;
        item.isEnabledAction = () => {
          counts.enabled += 1;
          return answer;
        };
      }
      if (spec.submenu !== undefined) {
        const children = spec.submenu;
        item.submenuAction = spec.slowSubmenu === true
          ? async () => {
            counts.submenu += 1;
            await wait(delay);
            return children.map((child) => /** @type {MenuItem} */ (build(child)));
          }
          : () => {
            counts.submenu += 1;
            return children.map((child) => /** @type {MenuItem} */ (build(child)));
          };
      }
      item.action = () => {
        marks.push(`act:${text}`);
      };
      item.focusAction = () => {
        counts.focus += 1;
        marks.push(`focus:${text}`);
      };
      item.blurAction = () => {
        counts.blur += 1;
        marks.push(`blur:${text}`);
      };
      if (spec.id !== undefined) {
        item.id = spec.id;
      }
      return /** @type {MenuItem} */ (item);
    }

    /**
     * @param {Array<ItemSpec>} specs
     * @returns {Array<MenuItem | SeparatorItem>}
     */
    function buildAll(specs) {
      return specs.map((spec) => build(spec));
    }

    scope.__vis = {
      make(input) {
        watch = input.watch === true;
        marks.length = 0;
        errors.length = 0;
        calls.clear();
        items = buildAll(input.items);
        menu?.destroy();
        const built = new MyContext(items);
        menu = built;
        const surface = document.getElementById('surface');
        if (surface instanceof HTMLElement) {
          built.attach(surface);
        }
        if (watch) {
          built.addEventListener('error', (event) => {
            const custom = /** @type {CustomEvent<{ reason?: unknown }>} */ (
              /** @type {unknown} */ (event)
            );
            errors.push(
              custom.detail.reason instanceof Error
                ? custom.detail.reason.message
                : String(custom.detail.reason),
            );
          });
        }
      },
      setItems(specs) {
        // Состав хранится по ссылке, поэтому замена содержимого массива видна следующему
        // показу: отпечаток при этом не меняется, и уровень идёт по пути повторного
        // показа, а не перестройки.
        items.splice(0, items.length, ...buildAll(specs));
      },
      async tryOpen(point) {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        try {
          await menu.open(point);
          return { ok: true, message: null };
        } catch (reason) {
          return {
            ok: false,
            message: reason instanceof Error ? reason.message : String(reason),
          };
        }
      },
      async press(key) {
        const target = document.activeElement;
        if (target === null) {
          throw new Error('фокуса нет');
        }
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      },
      rectOf(label) {
        for (const element of document.querySelectorAll('.vc-item')) {
          if (element.querySelector('.vc-label')?.textContent === label) {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
          }
        }
        return null;
      },
      clickItem(label) {
        for (const element of document.querySelectorAll('.vc-item')) {
          if (element.querySelector('.vc-label')?.textContent === label) {
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return;
          }
        }
        throw new Error(`пункта «${label}» нет`);
      },
      closeMenu() {
        menu?.close();
      },
      resetCalls() {
        marks.length = 0;
        errors.length = 0;
        calls.clear();
      },
      read() {
        const shown = Array.from(document.querySelectorAll('.vc-menu:popover-open'));
        const itemsOf = shown.flatMap((level) => Array.from(level.querySelectorAll('.vc-item')));
        const readItems = shown.flatMap((level) => Array.from(level.querySelectorAll('.vc-item, .vc-separator')));
        const counts = /** @type {Record<string, Calls>} */ ({});
        for (const [id, value] of calls.entries()) {
          counts[id] = { ...value };
        }
        const level = shown[0];
        return {
          shown: shown.length,
          levelId: level === undefined ? null : level.id,
          labels: itemsOf.map((element) => String(element.querySelector('.vc-label')?.textContent)),
          separators: readItems.filter((element) => element.classList.contains('vc-separator')).length,
          setsize: itemsOf.map((element) => element.getAttribute('aria-setsize')),
          posinset: itemsOf.map((element) => element.getAttribute('aria-posinset')),
          owns: itemsOf.map((element) => element.getAttribute('aria-owns')),
          haspopup: itemsOf.filter((element) => element.getAttribute('aria-haspopup') === 'menu').length,
          chevrons: readItems
            .filter((element) => element.querySelector(':scope > .vc-chevron') !== null).length,
          marks: marks.slice(),
          calls: /** @type {Record<string, Calls>} */ (counts),
          errors: errors.slice(),
          pageErrors: pageErrors.slice(),
          focusLabel: document.activeElement?.closest('.vc-item')?.querySelector('.vc-label')
            ?.textContent ?? null,
          itemsInOpenLevels: itemsOf.map((element) => {
            return String(element.querySelector('.vc-label')?.textContent);
          }),
        };
      },
    };
  });
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {MakeInput} input
 * @returns {Promise<void>}
 */
async function makeMenu(page, input) {
  await page.evaluate((config) => {
    const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
    scope.__vis.make(config);
  }, input);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function openMenu(page) {
  await page.mouse.click(OPEN_POINT.x, OPEN_POINT.y, { button: 'right' });
  await page.waitForFunction(() => {
    return document.querySelectorAll('.vc-menu:popover-open').length > 0;
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<VisibilityLog>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__vis.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<void>}
 */
async function hoverItem(page, label) {
  const rect = await page.evaluate((name) => {
    const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__vis.rectOf(name);
  }, label);
  expect(rect, `пункт «${label}» есть в разметке`).not.toBeNull();
  const found = /** @type {{ left: number, top: number, width: number, height: number }} */ (
    /** @type {unknown} */ (rect)
  );
  await page.mouse.move(found.left + found.width / 2, found.top + found.height / 2);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} key
 * @returns {Promise<void>}
 */
async function press(page, key) {
  await page.evaluate((name) => {
    const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__vis.press(name);
  }, key);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<void>}
 */
async function clickItem(page, label) {
  await page.evaluate((name) => {
    const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
    scope.__vis.clickItem(name);
  }, label);
}

test.describe('видимость на первом показе', () => {
  test('скрытый пункт не попадает в меню, а счётчики aria считают видимые', async ({ page }) => {
    await makeMenu(page, {
      items: [
        { id: 'a', label: 'Первый' },
        { id: 'b', label: 'Второй', visible: false },
        { id: 'c', label: 'Третий' },
      ],
    });
    await openMenu(page);
    const log = await readMenu(page);
    expect(log.labels, 'в меню только видимые пункты').toEqual(['Первый', 'Третий']);
    // `aria-setsize` и `aria-posinset` считают ряд, из которого выпавший пункт ушёл
    // вместе со своим местом: у оставшихся пунктов нет и номера, и общего числа.
    expect(log.setsize).toEqual(['2', '2']);
    expect(log.posinset).toEqual(['1', '2']);
  });

  test('ответ не из true скрывает пункт, а отсутствие предиката оставляет на месте', async ({ page }) => {
    await makeMenu(page, {
      items: [
        { id: 'a', label: 'Первый' },
        { id: 'b', label: 'Второй', visible: 'да' },
      ],
    });
    await openMenu(page);
    const log = await readMenu(page);
    expect(log.labels).toEqual(['Первый']);
    expect(log.calls.b.visible, 'предикат зван один раз на показе').toBe(1);
    expect(log.calls.a.visible, 'у пункта без предиката его нет вовсе').toBe(0);
  });

  test('асинхронный предикат скрывает пункт так же, как синхронный', async ({ page }) => {
    await makeMenu(page, {
      items: [
        { id: 'a', label: 'Первый' },
        { id: 'b', label: 'Второй', visible: false, slowVisible: true },
        { id: 'c', label: 'Третий', visible: true, slowVisible: true },
      ],
    });
    await openMenu(page);
    const log = await readMenu(page);
    expect(log.labels).toEqual(['Первый', 'Третий']);
    expect(log.calls.b.visible).toBe(1);
  });

  test('действия скрытого пункта зовутся на показе, а его действие и события фокуса — нет', async ({ page }) => {
    await makeMenu(page, {
      items: [
        { id: 'a', label: 'Первый' },
        {
          id: 'b',
          label: 'Второй',
          visible: false,
          enabled: false,
          slowSubmenu: true,
          submenu: [{ id: 'leaf', label: 'Лист' }],
        },
      ],
    });
    await openMenu(page);
    const log = await readMenu(page);
    // Видимость не отменяет остальных действий: их ответы нужны автору не меньше, а
    // поломка скрытого пункта обязана быть видна так же, как поломка видимого.
    expect(log.calls.b).toEqual({
      label: 1,
      visible: 1,
      enabled: 1,
      submenu: 1,
      focus: 0,
      blur: 0,
      action: 0,
    });
    expect(log.labels, 'подменю скрытого владельца не показано').toEqual(['Первый']);
  });

  test('скрытый пункт не входит в кольцо роуминга', async ({ page }) => {
    await makeMenu(page, {
      items: [
        { id: 'a', label: 'Первый' },
        { id: 'b', label: 'Второй', visible: false },
        { id: 'c', label: 'Третий' },
      ],
    });
    await openMenu(page);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowDown');
    const log = await readMenu(page);
    // Стрелка проходит скрытый пункт насквозь: кольцо роуминга берёт `entry.items`,
    // а скрытого пункта в нём нет вовсе.
    expect(log.focusLabel).toBe('Третий');
    expect(log.marks).toEqual(['focus:Первый', 'blur:Первый', 'focus:Третий']);
    expect(log.calls.b.focus, 'события фокуса скрытому пункту не достаются').toBe(0);
    expect(log.calls.b.blur).toBe(0);
  });

  test('клик по видимому соседу зовёт его действие, а не скрытого пункта', async ({ page }) => {
    await makeMenu(page, {
      items: [
        { id: 'a', label: 'Первый' },
        { id: 'b', label: 'Второй', visible: false },
      ],
    });
    await openMenu(page);
    await clickItem(page, 'Первый');
    const log = await readMenu(page);
    expect(log.marks).toEqual(['act:Первый']);
  });

  test('меню, у которого скрылись все пункты, показывается пустым', async ({ page }) => {
    await makeMenu(page, {
      items: [
        { id: 'a', label: 'Первый', visible: false },
        { id: 'b', label: 'Второй', visible: false },
      ],
    });
    await openMenu(page);
    const log = await readMenu(page);
    expect(log.shown, 'уровень показан').toBe(1);
    expect(log.labels).toEqual([]);
    // Показ не отменяется: предикаты отвечают независимо друг от друга, и «показывать
    // нечего» — не то же самое, что «отмена показа».
    expect(log.errors).toEqual([]);
  });

  test('скрытый пункт-владелец не резервирует адрес подменю и не раскрывает его', async ({ page }) => {
    await makeMenu(page, {
      items: [
        {
          id: 'hidden',
          label: 'Скрытая ветка',
          visible: false,
          slowSubmenu: true,
          submenu: [{ id: 'hidden-leaf', label: 'Скрытый лист' }],
        },
        { id: 'owner', label: 'Видимая ветка', submenu: [{ id: 'leaf', label: 'Лист' }] },
      ],
    });
    await openMenu(page);
    const before = await readMenu(page);
    expect(before.owns).toEqual([before.levelId === null ? null : `${before.levelId}-sub-1`]);
    expect(before.haspopup, 'у скрытого владельца признака раскрытия нет').toBe(1);
    expect(before.chevrons).toBe(1);
    expect(before.shown, 'подменю скрытого владельца не заведено').toBe(1);
    // Контроль на той же странице: видимый владелец на этом же показе раскрывается.
    await hoverItem(page, 'Видимая ветка');
    await page.waitForFunction(() => {
      return document.querySelectorAll('.vc-menu:popover-open').length === 2;
    });
    const after = await readMenu(page);
    expect(after.itemsInOpenLevels, 'подменю скрытого владельца не появилось').toEqual([
      'Видимая ветка',
      'Лист',
    ]);
  });

  test('скрытый разделитель не рисуется, видимый остаётся', async ({ page }) => {
    await makeMenu(page, {
      items: [
        { id: 'a', label: 'Первый' },
        { type: 'separator', visible: false },
        { id: 'b', label: 'Второй' },
        { type: 'separator' },
        { id: 'c', label: 'Третий' },
      ],
    });
    await openMenu(page);
    const log = await readMenu(page);
    expect(log.labels, 'разделитель в подписи не значится').toEqual(['Первый', 'Второй', 'Третий']);
    expect(log.separators, 'остался только видимый разделитель').toBe(1);
    expect(log.setsize, 'разделитель в счётчики не входит').toEqual(['3', '3', '3']);
    expect(log.posinset).toEqual(['1', '2', '3']);
  });
});

test.describe('видимость между показами', () => {
  test('пункт, ставший видимым, появляется, а счётчики aria пересчитываются', async ({ page }) => {
    await makeMenu(page, {
      items: [
        { id: 'a', label: 'Первый' },
        { id: 'b', label: 'Второй', visible: false },
        { id: 'c', label: 'Третий' },
      ],
    });
    await openMenu(page);
    const before = await readMenu(page);
    expect(before.labels).toEqual(['Первый', 'Третий']);

    await page.evaluate(() => {
      const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__vis.closeMenu();
    });
    await page.evaluate(() => {
      const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__vis.setItems([
        { id: 'a', label: 'Первый' },
        { id: 'b', label: 'Второй', visible: true },
        { id: 'c', label: 'Третий' },
      ]);
    });
    await openMenu(page);
    const after = await readMenu(page);
    expect(after.labels).toEqual(['Первый', 'Второй', 'Третий']);
    expect(after.setsize).toEqual(['3', '3', '3']);
    expect(after.posinset).toEqual(['1', '2', '3']);
    // Адрес уровня прежний: `aria-owns` пункта-владельца уже назван по нему, и второй
    // адрес на то же меню сделал бы ссылку висячей.
    expect(after.levelId).toBe(before.levelId);
    expect(after.calls.b.visible, 'предикат перечитан на втором показе').toBe(1);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowDown');
    const roved = await readMenu(page);
    expect(roved.focusLabel, 'вернувшийся пункт снова в кольце роуминга').toBe('Второй');
  });

  test('пункт, ставший скрытым, уходит из меню вместе со своими счётчиками', async ({ page }) => {
    await makeMenu(page, {
      items: [
        { id: 'a', label: 'Первый' },
        { id: 'b', label: 'Второй' },
      ],
    });
    await openMenu(page);
    const before = await readMenu(page);
    expect(before.labels).toEqual(['Первый', 'Второй']);

    await page.evaluate(() => {
      const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__vis.closeMenu();
    });
    await page.evaluate(() => {
      const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__vis.setItems([
        { id: 'a', label: 'Первый' },
        { id: 'b', label: 'Второй', visible: false },
      ]);
    });
    await openMenu(page);
    const after = await readMenu(page);
    expect(after.labels).toEqual(['Первый']);
    expect(after.setsize).toEqual(['1']);
    expect(after.posinset).toEqual(['1']);
    expect(after.levelId).toBe(before.levelId);
  });

  test('пункт, ставший скрытым, не получает второго blur и больше не зовётся', async ({ page }) => {
    await makeMenu(page, {
      items: [
        { id: 'a', label: 'Первый' },
        { id: 'b', label: 'Второй' },
      ],
    });
    await openMenu(page);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowDown');
    const held = await readMenu(page);
    expect(held.focusLabel).toBe('Второй');

    await page.evaluate(() => {
      const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__vis.closeMenu();
    });
    await page.evaluate(() => {
      const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__vis.setItems([
        { id: 'a', label: 'Первый' },
        { id: 'b', label: 'Второй', visible: false },
      ]);
    });
    await openMenu(page);
    const after = await readMenu(page);
    // Пара фокуса закрывается один раз: закрытие меню уже отдало `blur` пункту с
    // фокусом, и перестройка уровня не должна отдавать его второй раз — иначе автор
    // получил бы два `blur` на один `focus`.
    expect(after.marks.filter((entry) => {
      return entry === 'blur:Второй';
    })).toEqual(['blur:Второй']);
    await clickItem(page, 'Первый');
    const clicked = await readMenu(page);
    expect(clicked.marks, 'действие скрытого пункта не зовётся').not.toContain('act:Второй');
  });
});

test('отказ предиката видимости роняет показ целиком', async ({ page }) => {
  await makeMenu(page, {
    watch: true,
    items: [
      { id: 'a', label: 'Первый' },
      { id: 'b', label: 'Второй', visible: false, throwVisible: true },
    ],
  });
  const result = await page.evaluate((point) => {
    const scope = /** @type {{ __vis: Probe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__vis.tryOpen(point);
  }, OPEN_POINT);
  expect(result.ok, 'показ не состоялся').toBe(false);
  expect(result.message).toBe(FAILURE_TEXT);
  const log = await readMenu(page);
  expect(log.shown, 'меню не показано вовсе').toBe(0);
  // Отказ читающего действия — отказ самого `open()`, и подписчик `error` его не
  // видит: событие рассылается только там, где отказ некому ждать, а здесь его ждёт
  // вызывающий.
  expect(log.errors).toEqual([]);
});
