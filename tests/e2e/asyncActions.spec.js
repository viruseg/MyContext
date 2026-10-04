import { expect, test } from '@playwright/test';

/**
 * Асинхронные пользовательские действия.
 *
 * Автор отдаёт библиотеке функции, и любая из них может оказаться `async`: подпись
 * пункта ждёт сеть, действие пишет в файл, отдача управления зовёт чужое меню.
 * Библиотека обязана это разбирать — ждать действия там, где её решение зависит от
 * его результата, и не терять отказ там, где ждать некому.
 *
 * Набор разбит по месту поломки, а не по виду действия: одно и то же асинхронное
 * `action` ломается по-разному на клике (неверно считается закрытие) и на отпускании
 * (теряется жест), и проверять его двумя кейсами дешевле, чем искать поломку по
 * симптому.
 *
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').ErrorEventDetail} ErrorEventDetail
 * @typedef {import('../../src/icons.js').IconConfig} IconConfig
 */

/**
 * Что делает действие пункта. Синхронный `ok` нужен отдельным кейсом не для
 * проверки, а как точка отсчёта: после правки оба режима обязаны вести себя
 * одинаково, и без этого кейса равенство нечем подтвердить.
 *
 * @typedef {'ok' | 'async-ok' | 'async-throw'} ActionMode
 */

/**
 * Описание строящегося пункта — целиком из значений: `page.evaluate` не везёт
 * функции в аргумент, поэтому «медленное» действие задаётся именем поля в
 * `slow`, а саму функцию собирает уже страница.
 *
 * @typedef {object} ItemSpec
 * @property {string} [id] авторский идентификатор: попадает в `data-id` и в
 *   отпечаток состава, и потому годен для перестройки уровня без смены подписи.
 * @property {string} [label] подпись пункта.
 * @property {IconConfig} [icon] описание иконки.
 * @property {Array<ItemSpec>} [submenu] состав подменю.
 * @property {boolean} [enabled] ответ предиката доступности.
 * @property {number} [version] метка состава, заставляющая перестроить уровень.
 * @property {'slow-open' | 'throw' | 'count'} [handoff] вид отдачи пункта:
 *   открыть чужое меню после ожидания, бросить или просто считать вызовы.
 * @property {Array<'label' | 'icon' | 'submenu' | 'enabled'>} [slow] поля,
 *   которые страница обернёт в `async` с настоящей задержкой.
 * @property {boolean} [fail] ронять ли `labelAction` этого пункта. Отказ нельзя
 *   задать значением поля, потому что значение едет в аргумент
 *   `page.evaluate`, а функции там не перевозятся.
 */

/**
 * @typedef {object} ActionInput
 * @property {ActionMode} [mode] что делает действие пункта.
 * @property {boolean} [watch] подписан ли кто-нибудь на `error`.
 * @property {boolean} [preventDefault] вызывает ли подписчик `error` `preventDefault()`.
 * @property {boolean} [reopen] звать ли `open()` из действия изнутри.
 * @property {ItemSpec[]} [items] пункты меню; без них заводится один пункт с
 *   действием по `mode`.
 * @property {'slow-open' | 'throw' | 'count'} [handoff] вид отдачи пункта по
 *   умолчанию: открыть чужое меню после ожидания, бросить или просто считать вызовы.
 * @property {boolean} [attached] привязать ли меню к контейнеру.
 * @property {import('../../src/constants.js').PressAndHoldMode} [pressAndHold]
 */

/**
 * @typedef {object} ActionLog
 * @property {number} openCount событий `open`.
 * @property {number} closeCount событий `close`.
 * @property {boolean} visible показан ли хоть один уровень.
 * @property {string[]} labels подписи пунктов показанного корня, по порядку.
 * @property {string[]} errorSources `source` из событий `error`, по порядку.
 * @property {string[]} errorMessages сообщения отказов из событий `error`.
 * @property {number} errorPrevented сколько раз подписчик отменил отказ.
 * @property {string[]} escapedBy каналы, по которым отказ ушёл на страницу:
 *   `error:…` — непойманная ошибка, `unhandledrejection:…` — отказ промиса.
 * @property {string[]} marks идентификаторы званных действий, по порядку.
 * @property {number} handoffCalls сколько раз звалась отдача.
 * @property {boolean} childVisible показан ли уровень чужого меню.
 * @property {string | null} childConfig значение `pressAndHold` чужого меню.
 */

/**
 * @typedef {object} AsyncProbe
 * @property {(input: ActionInput) => void} make
 * @property {(specs: ItemSpec[]) => void} setItems
 * @property {(x: number, y: number) => Promise<void>} open
 * @property {(x: number, y: number) => Promise<void>} openNow
 * @property {() => void} activate
 * @property {() => void} closeMenu
 * @property {(index: number) => void} hoverItem
 * @property {(index: number) => void} showSubmenuAt
 * @property {() => void} closeSubmenu
 * @property {() => void} destroyMenu
 * @property {() => ActionLog} read
 * @property {() => boolean} readArmed
 * @property {() => Promise<boolean>} readLabelMatchesAction
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

const VIEWPORT = { width: 1000, height: 700 };
const OPEN_POINT = { x: 400, y: 300 };
const FAILURE_TEXT = 'сломалось';
/** Задержка действия внутри страницы, мс. */
const DELAY = 20;

/**
 * @param {import('@playwright/test').Page} page
 * @param {ActionInput} [input]
 * @returns {Promise<void>}
 */
async function setup(page, input = {}) {
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
  // Под `reduce` показ переоткрытия проходит за один такт, иначе кейсы на
  // переоткрытие мерили бы задержку анимации вместо порядка событий.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async (config) => {
    const { MyContext } = await import('../../src/index.js');
    const scope = /** @type {{ __mc?: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));

    /** @type {string[]} */
    const errorSources = [];
    /** @type {string[]} */
    const errorMessages = [];
    /** @type {string[]} */
    const escapedBy = [];
    /** @type {string[]} */
    const marks = [];
    let errorPrevented = 0;
    let openCount = 0;
    let closeCount = 0;

    // Настоящая задача, а не микротаска: микротаска не отдаёт управление наружу,
    // и тест на `await` не отличил бы ожидание от его отсутствия.
    const delay = 20;
    const failure = 'сломалось';

    // Канал ухода отказа различается намеренно: отказ промиса, который никто не
    // держит, попадает в `unhandledrejection`, а непойманная ошибка — в `error`.
    // Синхронный бросок из обработчика сегодня уходит вторым, и отказ действия
    // должен уходить так же, а не первым.
    globalThis.addEventListener('error', (event) => {
      escapedBy.push(`error:${String(event.message)}`);
    });
    globalThis.addEventListener('unhandledrejection', (event) => {
      const reason = /** @type {{ message?: unknown }} */ (/** @type {unknown} */ (event.reason));
      escapedBy.push(`unhandledrejection:${String(reason.message)}`);
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
     * Описание пункта превращается в пункт контракта. Каждое поле-функция
     * получает задержку: без неё тест не отличил бы ожидание от его отсутствия.
     * Действие пункта отмечает себя `id` — по нему видно, чей это пункт, и так
     * ловится подмена записи карты действий на пункт другого уровня.
     *
     * @param {ItemSpec} spec
     * @returns {MenuItem}
     */
    function build(spec) {
      /** @type {Record<string, unknown>} */
      const item = {};
      const text = String(spec.id ?? spec.label ?? 'Пункт');
      // Отдача по умолчанию выключена: пункт без `handoff` обязан остаться
      // обычным и вызывать своё `action` по клику. Вид отдачи берётся из поля
      // `handoff` только когда его назвали явно.
      const handoffKind = spec.handoff ?? 'none';
      const slow = spec.slow ?? [];
      /**
       * @param {'label' | 'icon' | 'submenu' | 'enabled'} field
       * @returns {boolean}
       */
      const isSlow = (field) => slow.includes(field);
      if (spec.fail === true) {
        item.labelAction = async () => {
          await wait(delay);
          throw new Error(failure);
        };
      } else if (isSlow('label')) {
        item.labelAction = async () => {
          await wait(delay);
          return spec.label ?? text;
        };
      } else {
        item.labelAction = () => spec.label ?? text;
      }
      if (spec.icon !== undefined) {
        const icon = spec.icon;
        item.iconAction = isSlow('icon')
          ? async () => { await wait(delay); return icon; }
          : () => icon;
      }
      if (spec.submenu !== undefined) {
        const submenu = spec.submenu;
        item.submenuAction = isSlow('submenu')
          ? async () => { await wait(delay); return submenu.map((child) => build(child)); }
          : () => submenu.map((child) => build(child));
      }
      if (spec.enabled !== undefined) {
        const enabled = spec.enabled;
        item.isEnabledAction = isSlow('enabled')
          ? async () => { await wait(delay); return enabled; }
          : () => enabled;
      }
      if (spec.id !== undefined) {
        item.id = spec.id;
      }
      if (spec.version !== undefined) {
        item.version = spec.version;
      }
      item.action = () => {
        marks.push(text);
      };
      if (handoffKind === 'slow-open') {
        item.handoffAction = async (
          /** @type {Event} */ _event,
          /** @type {import('../../src/MyContext.js').SubmenuHandoff} */ handoff,
        ) => {
          handoffCalls += 1;
          await wait(delay);
          // Ребёнок заводится здесь же и сразу же вооружается на переданную
          // кнопку: его `pressAndHold` назван явно, чтобы вооружение не зависело
          // от пресета ребёнка.
          const button = handoff.button ?? 'right';
          const child = new MyContext([{ labelAction: () => 'Ребёнок' }], {
            pressAndHold: /** @type {import('../../src/constants.js').PressAndHoldMode} */ (button),
          });
          childConfig = String(handoff.button);
          childOpen = child;
          await child.openSubmenu(220, 170, handoff);
        };
      } else if (handoffKind === 'throw') {
        item.handoffAction = async () => {
          handoffCalls += 1;
          await wait(delay);
          throw new Error(failure);
        };
      } else if (handoffKind === 'count') {
        item.handoffAction = () => {
          handoffCalls += 1;
        };
      }
      return /** @type {MenuItem} */ (item);
    }

    let handoffCalls = 0;
    /** @type {string | null} */
    let childConfig = null;
    /** @type {InstanceType<typeof MyContext> | null} */
    let childOpen = null;
    /** @type {MenuItem[]} */
    let items = [];
    /** @type {InstanceType<typeof MyContext> | null} */
    let menu = null;
    /** Вооружение приватно, и снаружи его не прочитать: признак держит проба. */
    let armed = false;
    globalThis.addEventListener('pointerup', () => {
      armed = false;
    });
    globalThis.addEventListener('pointerdown', () => {
      armed = true;
    });

    scope.__mc = {
      make(setup0) {
        handoffCalls = 0;
        childConfig = null;
        if (childOpen !== null) {
          childOpen.destroy();
          childOpen = null;
        }
        errorSources.length = 0;
        errorMessages.length = 0;
        errorPrevented = 0;
        openCount = 0;
        closeCount = 0;
        marks.length = 0;
        escapedBy.length = 0;
        if (menu !== null) {
          menu.destroy();
        }
        const mode = setup0.mode ?? 'ok';
        if (setup0.items !== undefined) {
          items = setup0.items.map((spec) => build(spec));
        } else {
          // Пункт идёт через `build`, чтобы получил отдачу по `setup0.handoff`,
          // а действие подменяется ниже: `mode` — про действие, а не про пункт.
          const base = build({ id: 'Пункт', label: 'Пункт', handoff: setup0.handoff });
          items = [
            /** @type {MenuItem} */ ({
              ...base,
              action: mode === 'ok'
                ? () => {
                  if (setup0.reopen === true) {
                    menu?.open({ x: 200, y: 200 });
                  }
                }
                : async () => {
                  await wait(delay);
                  if (mode === 'async-throw') {
                    throw new Error(failure);
                  }
                  if (setup0.reopen === true) {
                    await menu?.open({ x: 200, y: 200 });
                  }
                },
            }),
          ];
        }
        menu = new MyContext(items);
        if (setup0.attached === true) {
          const surface = document.getElementById('surface');
          if (surface instanceof HTMLElement) {
            menu.attach(surface);
          }
        }
        if (setup0.pressAndHold !== undefined) {
          // Опция читается только в конструкторе, поэтому пресет задаётся новым
          // экземпляром: смена после создания была бы молчаливым игнором.
          menu.destroy();
          menu = new MyContext(items, { pressAndHold: setup0.pressAndHold });
          if (setup0.attached === true) {
            const surface = document.getElementById('surface');
            if (surface instanceof HTMLElement) {
              menu.attach(surface);
            }
          }
        }
        menu.addEventListener('open', () => {
          openCount += 1;
        });
        menu.addEventListener('close', () => {
          closeCount += 1;
        });
        if (setup0.watch === true) {
          menu.addEventListener('error', (event) => {
            const custom = /** @type {CustomEvent<ErrorEventDetail>} */ (
              /** @type {unknown} */ (event)
            );
            errorSources.push(custom.detail.source);
            errorMessages.push(
              custom.detail.reason instanceof Error
                ? custom.detail.reason.message
                : String(custom.detail.reason),
            );
            if (setup0.preventDefault === true) {
              event.preventDefault();
              errorPrevented += 1;
            }
          });
        }
      },
      setItems(specs) {
        // Состав хранится по ссылке, поэтому замена содержимого массива видна
        // следующему показу — как это делают остальные пробы проекта.
        items.splice(0, items.length, ...specs.map((spec) => build(spec)));
      },
      async open(x, y) {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        await menu.open({ x, y });
      },
      async openNow(x, y) {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        await menu.open({ x, y });
      },
      activate() {
        const item = document.querySelector('.vc-item');
        if (!(item instanceof HTMLElement)) {
          throw new Error('пункт не показан');
        }
        item.click();
      },
      closeMenu() {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.close();
      },
      hoverItem(index) {
        const item = document.querySelectorAll('.vc-item')[index];
        if (!(item instanceof HTMLElement)) {
          throw new Error('пункт не показан');
        }
        item.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
      },
      showSubmenuAt(index) {
        const item = document.querySelectorAll('.vc-item')[index];
        if (!(item instanceof HTMLElement)) {
          throw new Error('пункт не показан');
        }
        item.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
      },
      closeSubmenu() {
        const owner = document.querySelector('.vc-item[aria-expanded="true"]');
        const level = owner === null ? null : owner.closest('.vc-menu');
        void level;
        if (owner instanceof HTMLElement) {
          const next = owner.nextElementSibling;
          if (next instanceof HTMLElement) {
            next.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
          }
        }
      },
      destroyMenu() {
        menu?.destroy();
        childOpen?.destroy();
      },
      read() {
        return {
          openCount,
          closeCount,
          visible: document.querySelectorAll('.vc-menu:popover-open').length > 0,
          labels: Array.from(document.querySelectorAll('.vc-menu:popover-open .vc-label'))
            .map((node) => String(node.textContent)),
          errorSources: errorSources.slice(),
          errorMessages: errorMessages.slice(),
          errorPrevented,
          escapedBy: escapedBy.slice(),
          marks: marks.slice(),
          handoffCalls,
          // Видимость ребёнка читается по его подписи: у него нет ни класса, ни
          // адреса, доступных снаружи, а подпись у него своя.
          // Видимость ребёнка читается по его подписи **в показанных** уровнях:
          // закрытый уровень остаётся в DOM до конца выхода, и подпись в нём есть
          // даже когда меню давно ушло с экрана.
          childVisible: Array.from(
            document.querySelectorAll('.vc-menu:popover-open .vc-item .vc-label'),
          ).some((node) => String(node.textContent) === 'Ребёнок'),
          childConfig: childOpen === null ? null : childConfig,
        };
      },
      readArmed() {
        return armed;
      },
      async readLabelMatchesAction() {
        const label = document.querySelector('.vc-menu:popover-open .vc-label');
        if (!(label instanceof HTMLElement)) {
          return false;
        }
        marks.length = 0;
        const item = label.closest('.vc-item');
        if (item instanceof HTMLElement) {
          item.click();
        }
        await wait(delay);
        return marks.length === 1 && marks[0] === String(label.textContent);
      },
    };
  }, input);
  await page.evaluate((config) => {
    const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(config);
  }, input);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<ActionLog>}
 */
function read(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function openMenu(page) {
  return page.evaluate((point) => {
    const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.open(point.x, point.y);
  }, OPEN_POINT);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function activateItem(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.activate();
  });
}

test.describe('отказы действий', () => {
  test('отказ асинхронного действия доходит до подписчика error с отказом в detail', async ({ page }) => {
    await setup(page, { mode: 'async-throw', watch: true });
    await openMenu(page);
    await activateItem(page);
    await expect.poll(async () => {
      return (await read(page)).errorMessages;
    }, { message: 'отказ дошёл до подписчика' }).toEqual([FAILURE_TEXT])
    const log = await read(page);
    expect(log.errorSources, 'отказ назван своим действием').toHaveLength(1);
    expect(log.visible, 'меню закрыто, несмотря на отказ').toBe(false);
  });

  test('отказ действия с preventDefault в подписчике error не доходит до страницы', async ({ page }) => {
    await setup(page, { mode: 'async-throw', watch: true, preventDefault: true });
    await openMenu(page);
    await activateItem(page);
    await expect.poll(async () => {
      return (await read(page)).errorPrevented;
    }, { message: 'подписчик отменил отказ' }).toBe(1)
    const log = await read(page);
    expect(log.escapedBy, 'наружу ничего не ушло').toEqual([]);
  });

  test('отказ действия без подписчика error уходит на страницу как непойманная ошибка', async ({ page }) => {
    await setup(page, { mode: 'async-throw' });
    await openMenu(page);
    await activateItem(page);
    await page.waitForTimeout(120);
    const log = await read(page);
    // Не `unhandledrejection`: отказ действия обязано вести себя как синхронный
    // бросок, а не как потерянный промис. Формат сообщения при этом не сверяется:
    // `onerror` возвращает его так, как это делает браузер, а не библиотека.
    expect(log.escapedBy).toHaveLength(1);
    expect(log.escapedBy[0]).toMatch(new RegExp(`^error:.*${FAILURE_TEXT}$`));
  });
});

test.describe('переоткрытие из действия', () => {
  test('асинхронное действие переоткрывает меню, и закрытие по клику не сбивает поколение', async ({ page }) => {
    await setup(page, { mode: 'async-ok', reopen: true });
    await openMenu(page);
    await activateItem(page);
    await expect.poll(async () => {
      return (await read(page)).openCount;
    }, { message: 'меню переоткрылось вторым показом' }).toBe(2)
    const log = await read(page);
    // Переоткрытие намеренно отменяет закрытие — так оно вело себя и для
    // синхронного действия. Значит `close` не рассылается вовсе.
    expect(log.closeCount, 'закрытие отменено переоткрытием').toBe(0);
    expect(log.visible).toBe(true);
  });

  test('синхронное действие, зовущее open, ведёт себя так же', async ({ page }) => {
    await setup(page, { mode: 'ok', reopen: true });
    await openMenu(page);
    await activateItem(page);
    await expect.poll(async () => {
      return (await read(page)).openCount;
    }, { message: 'синхронное действие переоткрыло меню' }).toBe(2)
    const log = await read(page);
    expect(log.closeCount).toBe(0);
    expect(log.visible).toBe(true);
  });
});

test.describe('читающие действия', () => {
  test('асинхронный labelAction рисует подпись после сбора данных', async ({ page }) => {
    await setup(page, {
      items: [{ id: 'Первый', label: 'Первый', slow: ['label'] }],
    });
    await openMenu(page);
    const log = await read(page);
    expect(log.labels).toEqual(['Первый']);
    expect(log.visible).toBe(true);
  });

  test('асинхронный iconAction рисует иконку', async ({ page }) => {
    await setup(page, {
      items: [{ id: 'Первый', icon: { type: 'emoji', value: '★' }, slow: ['icon'] }],
    });
    await openMenu(page);
    await expect(page.locator('.vc-icon')).toHaveCount(1);
  });

  test('асинхронный submenuAction раскрывает подменю с шевроном и aria-owns', async ({ page }) => {
    await setup(page, {
      items: [
        { id: 'Ветка', label: 'Ветка', submenu: [{ id: 'Лист', label: 'Лист' }], slow: ['submenu'] },
      ],
    });
    await openMenu(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.vc-menu:popover-open')).toHaveCount(2);
    await expect(page.locator('.vc-item[aria-expanded="true"]')).toHaveCount(1);
  });

  test('асинхронный isEnabledAction гасит пункт в кольцо роуминга', async ({ page }) => {
    await setup(page, {
      items: [
        { id: 'Первый', label: 'Первый' },
        { id: 'Второй', label: 'Второй', enabled: false, slow: ['enabled'] },
      ],
    });
    await openMenu(page);
    await expect(page.locator('.vc-item[aria-disabled="true"]')).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.vc-item[data-active] .vc-label')).toHaveText('Первый');
  });

  test('отказ читающего действия отклоняет промис open и не показывает меню', async ({ page }) => {
    await setup(page, {
      items: [{ id: 'Первый', label: 'Первый', slow: ['label'], fail: true }],
    });
    await expect(
      page.evaluate(() => {
        const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
        return scope.__mc.open(400, 300);
      }),
    ).rejects.toThrow(FAILURE_TEXT);
    expect((await read(page)).visible, 'меню не показано').toBe(false);
  });

  test('отказ читающего действия через contextmenu приходит в error', async ({ page }) => {
    await setup(page, {
      attached: true,
      watch: true,
      items: [{ id: 'Первый', label: 'Первый', slow: ['label'], fail: true }],
    });
    await page.mouse.click(200, 200, { button: 'right' });
    await page.waitForTimeout(120);
    const log = await read(page);
    expect(log.errorMessages).toEqual([FAILURE_TEXT]);
  });

  test('уровень, снесённый во время перечитывания, не принимает ответы и не перебивает запись карты', async ({ page }) => {
    await setup(page, { items: [{ id: 'Первый', label: 'Первый' }] });
    await openMenu(page);
    // Тот же отпечаток состава — значит `refreshItems`, а не перестройка. Пока
    // ответы идут, третий показ меняет `version` и сносит уровень начисто.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.setItems([{ id: 'Первый', label: 'Второй', slow: ['label'] }]);
      return scope.__mc.openNow(400, 300);
    });
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.setItems([{ id: 'Первый', label: 'Первый', version: 1 }]);
      return scope.__mc.openNow(400, 300);
    });
    await expect.poll(async () => {
      return (await read(page)).labels.join(',');
    }, { message: 'на экране подпись нового уровня' }).toBe('Первый')
    expect(
      await page.evaluate(() => {
        const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
        return scope.__mc.readLabelMatchesAction();
      }),
      'подпись и действие принадлежат одному пункту',
    ).toBe(true);
  });

  test('отказ читающего действия при перечитывании оставляет показанное меню с прежними данными', async ({ page }) => {
    await setup(page, { items: [{ id: 'Первый', label: 'Первый' }] });
    await openMenu(page);
    const failed = page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.setItems([{ id: 'Первый', label: 'Первый', slow: ['label'], fail: true }]);
      return scope.__mc.openNow(400, 300);
    });
    await expect(failed).rejects.toThrow(FAILURE_TEXT);
    expect((await read(page)).visible, 'меню ушло вместе с переоткрытием').toBe(false);
    // Проверяется не развал, а целостность: следующий успешный показ читает уже
    // новые ответы и зовёт действие своего пункта. Полуразобранный уровень после
    // отказа выдал бы здесь чужую подпись или чужое действие.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.setItems([{ id: 'Второй', label: 'Второй' }]);
      return scope.__mc.openNow(400, 300);
    });
    await expect.poll(async () => {
      return (await read(page)).labels.join(',');
    }, { message: 'следующий показ прошёл целиком' }).toBe('Второй')
    expect(
      await page.evaluate(() => {
        const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
        return scope.__mc.readLabelMatchesAction();
      }),
      'подпись и действие принадлежат одному пункту',
    ).toBe(true);
  });
});
test.describe('показ подменю', () => {
  test('переход на соседний пункт отменяет ещё не состоявшийся показ подменю', async ({ page }) => {
    await setup(page, {
      items: [
        { id: 'Ветка', label: 'Ветка', submenu: [{ id: 'Лист', label: 'Лист' }], slow: ['submenu'] },
        { id: 'Соседний', label: 'Соседний' },
      ],
    });
    await openMenu(page);
    // Наведение на владельца планирует показ по `OPEN_GRACE_MS`, и таймер уводится
    // вперёд вручную: пока идут данные подменю, курсор успевает уйти на соседа.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.showSubmenuAt(0);
    });
    await page.clock.install();
    await page.clock.runFor(400);
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.closeSubmenu();
    });
    await page.waitForTimeout(120);
    expect(await page.locator('.vc-menu:popover-open').count(), 'подменю не показалось').toBe(1);
  });
});

test.describe('отмена висящего показа', () => {
  test('закрытие во время сбора данных отменяет показ', async ({ page }) => {
    await setup(page, { items: [{ id: 'Первый', label: 'Первый', slow: ['label'] }] });
    const opening = page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.openNow(400, 300);
    });
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.closeMenu();
    });
    await opening;
    const log = await read(page);
    expect(log.visible, 'меню не появилось').toBe(false);
    expect(log.openCount, 'событие open не рассылалось').toBe(0);
  });

  test('destroy во время сбора данных не оставляет уровней в документе', async ({ page }) => {
    await setup(page, { items: [{ id: 'Первый', label: 'Первый', slow: ['label'] }] });
    const opening = page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.openNow(400, 300);
    });
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.destroyMenu();
    });
    await opening;
    await expect(page.locator('.vc-menu')).toHaveCount(0);
    expect((await read(page)).openCount, 'событие open не рассылалось').toBe(0);
  });

  test('два показа подряд показывают только последний', async ({ page }) => {
    await setup(page, { items: [{ id: 'Первый', label: 'Первый', slow: ['label'] }] });
    // Оба вызова в одном evaluate: разнесённые по двум заходам они успели бы
    // разойтись по времени, и кейс проверял бы скорость машины, а не отмену.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      void scope.__mc.openNow(400, 300);
      void scope.__mc.openNow(200, 150);
    });
    await page.waitForTimeout(120);
    const log = await read(page);
    expect(log.labels, 'показан последний состав').toEqual(['Первый']);
    expect(log.openCount, 'показ состоялся один раз').toBe(1);
  });

  test('отпускание до готовности данных не показывает вооружённое меню', async ({ page }) => {
    // `pressAndHold: 'left'`, подпись ждёт задачу: палец успевает отпустить
    // раньше, чем меню появится.
    await setup(page, { pressAndHold: 'left', attached: true, items: [{ id: 'Первый', label: 'Первый', slow: ['label'] }] });
    await page.mouse.move(200, 150);
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(5);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(120);
    const log = await read(page);
    expect(log.visible, 'меню не появилось').toBe(false);
    expect(await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.readArmed();
    }), 'жест погашен').toBe(false);
  });
});

test.describe('отдача управления', () => {
  test('асинхронная отдача вооружает чужое меню на переданную кнопку', async ({ page }) => {
    await setup(page, { pressAndHold: 'right', attached: true, handoff: 'slow-open' });
    await page.mouse.move(200, 150);
    await page.mouse.down({ button: 'right' });
    // Вход в пункт задаётся пробой, а не движением курсора: кейс проверяет жест
    // отдачи и её вооружение, а попадание курсора в показанный пункт — отдельное
    // дело, зависящее от раскладки и угла появления меню.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.hoverItem(0);
    });
    await page.waitForTimeout(400);
    const log = await read(page);
    expect(log.childConfig, 'ребёнок принял переданную кнопку').toBe('right');
    expect(log.childVisible, 'меню ребёнка показано').toBe(true);
    // Отпускание обязано закрыть ребёнка: вооружение перешло к нему вместе с
    // жестом, и без этого отпускания меню осталось бы висеть.
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(80);
    expect((await read(page)).childVisible, 'отпускание закрыло ребёнка').toBe(false);
  });

  test('отказ асинхронной отдачи доходит до error', async ({ page }) => {
    await setup(page, { watch: true, handoff: 'throw' });
    await openMenu(page);
    await activateItem(page);
    await page.waitForTimeout(80);
    const log = await read(page);
    expect(log.errorMessages).toEqual([FAILURE_TEXT]);
    expect(log.visible, 'родитель ушёл с экрана до действия').toBe(false);
  });

  test('асинхронная отдача не срабатывает дважды на одно наведение', async ({ page }) => {
    await setup(page, { handoff: 'slow-open' });
    await openMenu(page);
    // Наведение планирует отдачу, нажатие показывает её немедленно, а `click`
    // после нажатия приходит третьим. Метка на пункте держит отдачу от повтора.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.hoverItem(0);
    });
    await page.waitForTimeout(400);
    await activateItem(page);
    await page.waitForTimeout(80);
    expect((await read(page)).handoffCalls, 'отдача сработала один раз').toBe(1);
  });
});
