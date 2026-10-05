import { expect, test } from '@playwright/test';

/**
 * События фокуса пункта: `focusAction` и `blurAction`.
 *
 * Набор проверяет три вещи, и каждая отвечает на отдельное решение спеки
 * `2026-10-05-item-focus-actions-design.md`. **Момент** — состояние снимается в том же
 * стеке, что и вызов действия, поэтому по журналу видно и порядок `blur` → `focus`, и
 * что в `focusAction` пункт уже отмечен и уже в фокусе. **Парность** — длинный сценарий
 * проверяется целиком: каждому `focus` обязан соответствовать ровно один `blur` той же
 * метки, и закрытие меню обязано закрывать последнюю пару. **Отсутствие лишнего** —
 * возврат фокуса на уже отмеченный пункт, шаг по кругу на единственном пункте и уход
 * курсора при подменю, открытом мышью, не порождают ничего.
 *
 * Отдельно проверяется оговорка «подсветка не равна фокусу»: на пункте-владельце после
 * `ArrowRight` его `data-active` стоит, а фокус ушёл в подменю, и `blurAction` владельца
 * приходит именно поэтому.
 *
 * @typedef {import('../../src/renderer.js').MenuItem} MenuItem
 * @typedef {import('../../src/renderer.js').SeparatorItem} SeparatorItem
 * @typedef {import('../../src/MyContext.js').ErrorEventDetail} ErrorEventDetail
 */

/**
 * Снимок, снятый изнутри действия пункта: состояние видно в тот же стек, в который
 * звано действие, и потому «отметка ещё не стоит» или «фокус ещё не передан» поймалось
 * бы здесь, а не в следующем кадре.
 *
 * @typedef {object} Snap
 * @property {string} entry запись журнала, `focus:Метка` либо `blur:Метка`.
 * @property {boolean | null} active стоял ли `data-active` на пункте; `null`, если узел
 *   уже снят с документа и читать нечего.
 * @property {boolean | null} focused стоял ли DOM-фокус на пункте.
 * @property {string | null} level доступное имя уровня, в фокусе которого оказалось
 *   действие. Разные уровни, но одна метка — так читается уход фокуса в подменю.
 * @property {number} args сколько аргументов получило действие.
 */

/**
 * @typedef {object} Probe
 * @property {(input: MakeInput) => void} make
 * @property {(point: { x: number, y: number }) => Promise<void>} open
 * @property {(label: string) => ({ left: number, top: number, width: number, height: number } | null)} rectOf
 *   рамка пункта по подписи либо `null`, если пункта в разметке нет. Наведения идёт
 *   по рамке, а не по `locator`-у: у отключённого пункта Playwright считает узел
 *   непригодным, а наводиться и кликать по нему приходится.
 * @property {(kind: 'focus' | 'blur') => void} armNext заставить следующее событие
 *   фокуса бросить исключение автора.
 * @property {(key: string) => Promise<void>} press
 * @property {(point: { x: number, y: number }) => Promise<void>} moveTo
 * @property {(selector: string) => ({ left: number, top: number, width: number, height: number } | null)} rectOfNode
 *   рамка любого узла по селектору — разделителя по подписи не найти, у него её нет.
 * @property {() => void} watchAfterKeydown подписаться на `keydown` документа так,
 *   чтобы поймать его после обработчика уровня.
 * @property {() => boolean} focusCalledNow звалось ли синхронное `focusAction`.
 * @property {() => boolean} sawFocusAction видел ли слушатель документа вызов
 *   `focusAction` к своему моменту.
 * @property {() => void} bumpSubmenuVersion сменить метку состава подменя, чтобы
 *   следующий показ перестроил уровень целиком.
 * @property {() => Promise<void>} openSecond показать второй экземпляр.
 * @property {() => boolean} alive жив ли экземпляр: закрытие идемпотентно у живого и бросает у
 *   разобранного.
 * @property {(label: string) => void} clickItem
 * @property {() => void} close
 * @property {() => void} destroy
 * @property {() => void} reopen
 * @property {() => void} disableFirst
 * @property {() => void} secondMenu
 * @property {(swallow: boolean) => void} onError подписка на `error`; `swallow` зовёт
 *   `preventDefault()`.
 * @property {() => Snapshot} read
 */

/**
 * @typedef {object} MakeInput
 * @property {boolean} [destroyOnClose]
 * @property {boolean} [asyncActions]
 * @property {boolean} [reopenOnFocus]
 * @property {boolean} [destroyOnFocus] `focusAction` первого пункта разбирает
 *   экземпляр изнутри действия.
 * @property {boolean} [noErrorListener] не подписываться на `error`: отказ должен
 *   уйти на страницу, а не быть разобранным подписчиком.
 */

/**
 * @typedef {object} Snapshot
 * @property {string[]} log записи действий, по порядку.
 * @property {Snap[]} snaps снимки, снятые изнутри действий.
 * @property {string[]} errors `source` из событий `error`, по порядку.
 * @property {string[]} pageErrors сообщения `window.onerror`.
 * @property {number} shown сколько уровней сейчас `:popover-open`.
 * @property {string | null} focusLabel подпись пункта в фокусе.
 * @property {string[]} activeLabels подписи отмеченных пунктов по всем уровням: отметка
 *   и фокус — разные вещи, и равенство первых второму проверяется по ним.
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
         style="position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: rgb(240, 240, 240)"></div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 800 };
/** Точка внутри привязанного контейнера: правый клик здесь открывает меню. */
const OPEN_POINT = { x: 200, y: 200 };
/** Пустое место страницы вдали от меню: курсор и клик сюда закрывают. */
const FAR_POINT = { x: 950, y: 750 };

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
  // `reduce` пропускает отложенное скрытие целиком, и состояние после закрытия не
  // зависит от таймера и от анимации.
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { MyContext } = await import('../../src/index.js');

    /** @type {string[]} */
    const log = [];
    /** @type {Snap[]} */
    const snaps = [];
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const pageErrors = [];
    /** @type {InstanceType<typeof MyContext> | null} */
    let menu = null;
    /** @type {InstanceType<typeof MyContext> | null} */
    let second = null;
    /** @type {'focus' | 'blur' | null} */
    let armed = null;
    /** @type {boolean} */
    let enabled = true;
    /**
     * Метка состава подменю. Меняется между показами по команде кейса, и это единственный
     * способ добиться перестроения уровня: `submenuAction` отдаёт новые объекты на каждом
     * показе, но отпечаток кодирует значения полей, а не ссылки.
     *
     * @type {number}
     */
    let submenuVersion = 0;
    /** Признак, что синхронное `focusAction` уже отработало. @type {boolean} */
    let focusCalled = false;
    const scope2 = /** @type {{ __sawFocusAction?: boolean }} */ (
      /** @type {unknown} */ (globalThis)
    );
    /** @type {boolean} */
    let asyncActions = false;
    /** @type {boolean} */
    let reopenOnFocus = false;
    /** @type {boolean} */
    let destroyOnFocus = false;
    /** @type {boolean} */
    let swallow = false;

    globalThis.addEventListener('error', (event) => {
      pageErrors.push(String(event.message));
    });

    /**
     * Пункт по подписи или `null`. Подписи в наборе не повторяются между уровнями, и
     * искать уровень не нужно: у снятого с документа пункта не находится ничего, и это
     * тоже ответ — терять узел приходится при сносе уровня.
     *
     * @param {string} label
     * @returns {HTMLElement | null}
     */
    function itemOf(label) {
      for (const element of document.querySelectorAll('.vc-item')) {
        if (element.querySelector('.vc-label')?.textContent === label) {
          return /** @type {HTMLElement} */ (element);
        }
      }
      return null;
    }

    /**
     * Запись и снимок изнутри действия пункта.
     *
     * @param {'focus' | 'blur'} kind
     * @param {string} label
     * @param {number} args
     * @returns {void}
     */
    function note(kind, label, args) {
      log.push(`${kind}:${label}`);
      const item = itemOf(label);
      const active = document.activeElement;
      const level = active === null ? null : active.closest('.vc-menu');
      snaps.push({
        entry: `${kind}:${label}`,
        active: item === null ? null : item.hasAttribute('data-active'),
        focused: item === null ? null : active === item,
        level: level === null ? null : level.getAttribute('aria-label'),
        args,
      });
    }

    /**
     * @param {'focus' | 'blur'} kind
     * @param {string} label
     * @returns {() => void}
     */
    function watch(kind, label) {
      return function watchAction(...rest) {
        note(kind, label, rest.length);
        if (armed === kind) {
          armed = null;
          throw new Error(`событие ${kind} автора упало`);
        }
        if (kind === 'focus' && reopenOnFocus && enabled) {
          openAt(OPEN_POINT_FALLBACK);
        }
      };
    }

    const OPEN_POINT_FALLBACK = { x: 200, y: 200 };

    /**
     * @param {{ x: number, y: number }} point
     * @returns {Promise<void>}
     */
    function openAt(point) {
      return menu === null ? Promise.resolve() : menu.open(point);
    }

    /**
     * @returns {Array<MenuItem | SeparatorItem>}
     */
    function items() {
      /** @type {MenuItem} */
      const first = {
        labelAction: () => 'Первый',
        action: () => {},
      };
      if (asyncActions) {
        first.focusAction = async () => {
          await Promise.resolve();
          note('focus', 'Первый', 0);
        };
        first.blurAction = async () => {
          await Promise.resolve();
          note('blur', 'Первый', 0);
        };
      } else {
        first.focusAction = () => {
          focusCalled = true;
          note('focus', 'Первый', 0);
          if (armed === 'focus') {
            armed = null;
            throw new Error('событие focus автора упало');
          }
          if (destroyOnFocus && menu !== null) {
            // Разбор изнутри действия: экземпляр не переживает его, и обработчик,
            // в котором шёл вызов, обязан устоять.
            const doomed = menu;
            menu = null;
            doomed.destroy();
          }
          if (reopenOnFocus && enabled) {
            openAt(OPEN_POINT_FALLBACK);
          }
        };
        first.blurAction = watch('blur', 'Первый');
      }
      first.isEnabledAction = () => enabled;
      return [
        first,
        {
          labelAction: () => 'Второй',
          action: () => {},
          focusAction: watch('focus', 'Второй'),
          blurAction: watch('blur', 'Второй'),
        },
        {
          labelAction: () => 'Глухо',
          isEnabledAction: () => false,
          focusAction: watch('focus', 'Глухо'),
          blurAction: watch('blur', 'Глухо'),
        },
        { type: 'separator' },
        {
          labelAction: () => 'Ветка',
          submenuAction: () => [
            {
              version: submenuVersion,
              labelAction: () => 'Лист',
              action: () => {},
              focusAction: watch('focus', 'Лист'),
              blurAction: watch('blur', 'Лист'),
            },
            {
              labelAction: () => 'Галочка',
              isEnabledAction: () => false,
              focusAction: watch('focus', 'Галочка'),
              blurAction: watch('blur', 'Галочка'),
            },
          ],
          focusAction: watch('focus', 'Ветка'),
          blurAction: watch('blur', 'Ветка'),
        },
      ];
    }

    const scope = /** @type {{ __focus?: Probe }} */ (/** @type {unknown} */ (globalThis));
    scope.__focus = {
      make(input) {
        if (menu !== null) {
          menu.destroy();
        }
        if (second !== null) {
          second.destroy();
          second = null;
        }
        log.length = 0;
        snaps.length = 0;
        errors.length = 0;
        pageErrors.length = 0;
        armed = null;
        enabled = true;
        submenuVersion = 0;
        focusCalled = false;
        asyncActions = input.asyncActions === true;
        reopenOnFocus = input.reopenOnFocus === true;
        destroyOnFocus = input.destroyOnFocus === true;
        swallow = false;
        const surface = document.getElementById('surface');
        if (!(surface instanceof HTMLElement)) {
          throw new Error('страница без контейнера');
        }
        /** @type {ConstructorParameters<typeof MyContext>[1]} */
        const options = { label: 'меню' };
        if (input.destroyOnClose === true) {
          options.destroyOnClose = true;
        }
        menu = new MyContext(items(), options);
        menu.attach(surface);
        if (input.noErrorListener !== true) {
          // У события `error` нет перегрузки по имени события — она есть только у
          // `open` и `close`, — и `detail` приходится доставать приведением, как и в
          // остальных наборах.
          menu.addEventListener('error', (event) => {
            const custom = /** @type {CustomEvent<ErrorEventDetail>} */ (
              /** @type {unknown} */ (event)
            );
            errors.push(String(custom.detail.source));
            if (swallow) {
              event.preventDefault();
            }
          });
        }
      },
      async open(point) {
        await openAt(point);
      },
      rectOf(label) {
        const item = itemOf(label);
        if (item === null) {
          return null;
        }
        const rect = item.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      },
      armNext(kind) {
        armed = kind;
      },
      async press(key) {
        const target = document.activeElement;
        if (target === null) {
          throw new Error('фокуса нет');
        }
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      },
      async moveTo(point) {
        const element = document.elementFromPoint(point.x, point.y);
        if (element === null) {
          throw new Error('под точкой ничего нет');
        }
        element.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          clientX: point.x,
          clientY: point.y,
        }));
      },
      rectOfNode(selector) {
        const element = document.querySelector(selector);
        if (element === null) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      },
      watchAfterKeydown() {
        // Слушатель `keydown` на документе ловит событие после обработчика уровня, а
        // событий на одну клавишу ровно одно: мышиный путь не годится, браузер шлёт
        // за одну подвижку курсора несколько `pointermove`, и второй пришёл бы уже
        // после микрозадачи.
        scope2.__sawFocusAction = false;
        document.addEventListener('keydown', () => {
          scope2.__sawFocusAction = focusCalled;
        }, { capture: false });
      },
      sawFocusAction() {
        return scope2.__sawFocusAction === true;
      },
      focusCalledNow() {
        const value = focusCalled;
        focusCalled = false;
        return value;
      },
      bumpSubmenuVersion() {
        submenuVersion += 1;
      },
      disableFirst() {
        enabled = false;
      },
      clickItem(label) {
        const item = itemOf(label);
        if (item === null) {
          throw new Error(`пункта «${label}» нет`);
        }
        item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      },
      close() {
        if (menu !== null) {
          menu.close();
        }
      },
      destroy() {
        if (menu !== null) {
          menu.destroy();
        }
      },
      alive() {
        if (menu === null) {
          return false;
        }
        try {
          menu.close();
          return true;
        } catch {
          return false;
        }
      },
      async reopen() {
        await openAt(OPEN_POINT_FALLBACK);
      },
      secondMenu() {
        second = new MyContext([{ labelAction: () => 'Чужой', action: () => {} }], {
          label: 'чужое меню',
        });
      },
      async openSecond() {
        if (second === null) {
          throw new Error('второго меню нет');
        }
        await second.open({ x: 700, y: 600 });
      },
      onError(value) {
        swallow = value;
      },
      read() {
        return {
          log: log.slice(),
          snaps: snaps.map((snap) => ({ ...snap })),
          errors: errors.slice(),
          pageErrors: pageErrors.slice(),
          shown: document.querySelectorAll('.vc-menu:popover-open').length,
          focusLabel: document.activeElement?.querySelector('.vc-label')?.textContent ?? null,
          activeLabels: Array.from(document.querySelectorAll('.vc-item[data-active]'))
            .map((element) => element.querySelector('.vc-label')?.textContent ?? ''),
        };
      },
    };
  });
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {MakeInput} [input]
 * @returns {Promise<void>}
 */
async function makeMenu(page, input = {}) {
  await page.evaluate((config) => {
    const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
    scope.__focus.make(config);
  }, input);
  await openMenu(page);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function openMenu(page) {
  await page.mouse.click(OPEN_POINT.x, OPEN_POINT.y, { button: 'right' });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Snapshot>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__focus.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<{ x: number, y: number }>}
 */
async function centreOf(page, label) {
  const rect = await page.evaluate((name) => {
    const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__focus.rectOf(name);
  }, label);
  expect(rect, `пункт «${label}» есть в разметке`).not.toBeNull();
  const found = /** @type {{ left: number, top: number, width: number, height: number }} */ (
    /** @type {unknown} */ (rect)
  );
  return { x: found.left + found.width / 2, y: found.top + found.height / 2 };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<void>}
 */
async function hoverItem(page, label) {
  const point = await centreOf(page, label);
  await page.mouse.move(point.x, point.y);
}

/**
 * Наводит курсор на узел по селектору: разделителя по подписи не найти, а у
 * отключённого пункта подпись есть, но селектор надёжнее одинаковой подписи у всех
 * уровней.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<void>}
 */
async function hoverNode(page, selector) {
  const rect = await page.evaluate((selectorText) => {
    const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__focus.rectOfNode(selectorText);
  }, selector);
  expect(rect, `узел ${selector} есть в разметке`).not.toBeNull();
  const found = /** @type {{ left: number, top: number, width: number, height: number }} */ (
    /** @type {unknown} */ (rect)
  );
  await page.mouse.move(found.left + found.width / 2, found.top + found.height / 2);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function hoverSeparator(page) {
  await hoverNode(page, '.vc-separator');
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} key
 * @returns {Promise<void>}
 */
async function press(page, key) {
  await page.evaluate((name) => {
    const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__focus.press(name);
  }, key);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'focus' | 'blur'} kind
 * @returns {Promise<void>}
 */
async function armNext(page, kind) {
  await page.evaluate((which) => {
    const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
    scope.__focus.armNext(which);
  }, kind);
}

/**
 * Баланс `focus` и `blur` по каждой метке: `0` — пара сошлась, `1` — фокус держится
 * прямо сейчас, и это законное состояние, а не расхождение. Отрицательный баланс и
 * баланс больше единицы — расхождение: `blur` без `focus` либо два `focus` без `blur`
 * между ними.
 *
 * @param {string[]} log
 * @returns {string[]} подписи с невозможным балансом
 */
function unpaired(log) {
  return balanceOf(log)
    .filter((row) => {
      return row[1] < 0 || row[1] > 1;
    })
    .map((row) => `${row[0]}:${row[1]}`);
}

/**
 * Подписи, фокус которых держится на конец журнала. После закрытия меню их быть не
 * должно: закрытие закрывает последнюю пару, иначе автор остался бы с состоянием, о
 * котором никто ему не сообщал.
 *
 * @param {string[]} log
 * @returns {string[]}
 */
function stillHeld(log) {
  return balanceOf(log)
    .filter((row) => {
      return row[1] !== 0;
    })
    .map((row) => row[0]);
}

/**
 * @param {string[]} log
 * @returns {Array<[string, number]>}
 */
function balanceOf(log) {
  /** @type {Map<string, number>} */
  const balance = new Map();
  for (const entry of log) {
    const [kind, label] = entry.split(':');
    balance.set(label, (balance.get(label) ?? 0) + (kind === 'focus' ? 1 : -1));
  }
  return Array.from(balance.entries());
}

test.describe('focus и blur по наведению и с клавиатуры', () => {
  test('наведение зовёт focus один раз, уход с меню — blur один раз', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Первый');
    const focused = await readMenu(page);
    expect(focused.log).toEqual(['focus:Первый']);
    // В `focusAction` пункт уже отмечен и уже в фокусе: снимок снят изнутри действия,
    // и оба признака обязаны быть истинными уже там.
    expect(focused.snaps[0]).toEqual({
      entry: 'focus:Первый',
      active: true,
      focused: true,
      level: 'меню',
      args: 0,
    });

    // Повторное наведение на тот же пункт не порождает ничего: фокус и отметка на месте.
    await hoverItem(page, 'Первый');
    expect((await readMenu(page)).log).toEqual(['focus:Первый']);

    await page.mouse.move(FAR_POINT.x, FAR_POINT.y);
    const left = await readMenu(page);
    expect(left.log).toEqual(['focus:Первый', 'blur:Первый']);
    expect(left.snaps[1].focused).toBe(false);
  });

  test('переход между пунктами даёт blur прежнего до focus следующего', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Первый');
    await hoverItem(page, 'Второй');
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый', 'focus:Второй']);
    // Отметка и фокус переехали вместе: у второго оба признака истинны.
    expect(after.activeLabels).toEqual(['Второй']);
    expect(after.focusLabel).toBe('Второй');
  });

  test('стрелка зовёт те же события, что и наведение', async ({ page }) => {
    await makeMenu(page);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowDown');
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый', 'focus:Второй']);
    expect(after.activeLabels).toEqual(['Второй']);
  });

  test('пункт-владелец получает события так же, как обычный пункт', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Ветка');
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Ветка']);
    expect(after.snaps[0].level).toBe('меню');
  });

  test('отключённый пункт и разделитель не получают событий вовсе', async ({ page }) => {
    await makeMenu(page);
    // Наведение на отключённый пункт подменю снимает выделение уровня, но его
    // собственные события звать нечем: отметку он не получал.
    await hoverItem(page, 'Ветка');
    await page.waitForFunction(() => {
      return document.querySelectorAll('.vc-menu:popover-open').length === 2;
    });
    await hoverItem(page, 'Галочка');
    await hoverItem(page, 'Первый');
    const after = await readMenu(page);
    expect(after.log).not.toContain('focus:Галочка');
    expect(after.log).not.toContain('blur:Галочка');
  });
});

test.describe('подменю', () => {
  test('ArrowRight зовёт blur владельца при стоящей отметке', async ({ page }) => {
    await makeMenu(page);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowDown');
    await press(page, 'End');
    await press(page, 'ArrowRight');
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый', 'focus:Второй', 'blur:Второй', 'focus:Ветка', 'blur:Ветка', 'focus:Лист']);
    // Оговорка «подсветка не равна фокусу»: отметка владельца осталась — она путь
    // раскрытия, — и добавилась отметка первого пункта подменю. `blurAction` владельца
    // пришёл из-за ухода фокуса, а не из-за снятия выделения.
    expect(after.activeLabels).toEqual(['Ветка', 'Лист']);
    expect(after.focusLabel).toBe('Лист');
    const ownerBlur = after.snaps[after.snaps.length - 2];
    expect(ownerBlur.entry).toBe('blur:Ветка');
    expect(ownerBlur.active).toBe(true);
    expect(ownerBlur.focused).toBe(false);
  });

  test('ArrowLeft возвращает фокус владельцу и закрывает его пару', async ({ page }) => {
    await makeMenu(page);
    await press(page, 'End');
    await press(page, 'ArrowRight');
    await press(page, 'ArrowLeft');
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Ветка', 'blur:Ветка', 'focus:Лист', 'blur:Лист', 'focus:Ветка']);
    expect(unpaired(after.log), 'blur без focus не бывает').toEqual([]);
    // Фокус держит владелец, и это состояние законное: баланс 1, а не расхождение.
    expect(stillHeld(after.log)).toEqual(['Ветка']);
    expect(after.focusLabel).toBe('Ветка');
  });

  test('уход курсора с дерева при подменю, открытом мышью, не зовёт blur', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Ветка');
    await page.waitForFunction(() => {
      return document.querySelectorAll('.vc-menu:popover-open').length === 2;
    });
    // Фокус остался на владельце в родительском уровне, и сброс подменю его не отбирает:
    // blur должен прийти только когда фокус уйдёт на сам пункт другого уровня.
    await page.mouse.move(FAR_POINT.x, FAR_POINT.y);
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Ветка']);
  });

  test('наведение на соседа закрывает подменю и меняет фокус', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Ветка');
    await page.waitForFunction(() => {
      return document.querySelectorAll('.vc-menu:popover-open').length === 2;
    });
    await hoverItem(page, 'Лист');
    const inside = await readMenu(page);
    // Фокус ушёл с владельца, и `blurAction` пришёл; отметка владельца при этом осталась.
    expect(inside.log).toEqual(['focus:Ветка', 'blur:Ветка', 'focus:Лист']);
    expect(inside.activeLabels).toEqual(['Ветка', 'Лист']);

    await hoverItem(page, 'Первый');
    const outside = await readMenu(page);
    expect(outside.log).toEqual(['focus:Ветка', 'blur:Ветка', 'focus:Лист', 'blur:Лист', 'focus:Первый']);
  });
});

test.describe('закрытие и снос', () => {
  test('Escape зовёт blur до события close', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Первый');
    await page.evaluate(() => {
      const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__focus.close();
    });
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый']);
    expect(stillHeld(after.log), 'закрытие закрывает последнюю пару').toEqual([]);
  });

  test('клик вне меню зовёт blur', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Первый');
    await page.mouse.click(FAR_POINT.x, FAR_POINT.y);
    expect((await readMenu(page)).log).toEqual(['focus:Первый', 'blur:Первый']);
  });

  test('выбор пункта зовёт blur', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Первый');
    await hoverItem(page, 'Второй');
    await page.evaluate(() => {
      const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__focus.clickItem('Второй');
    });
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый', 'focus:Второй', 'blur:Второй']);
    expect(stillHeld(after.log)).toEqual([]);
  });

  test('Tab зовёт blur', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Первый');
    await press(page, 'Tab');
    expect((await readMenu(page)).log).toEqual(['focus:Первый', 'blur:Первый']);
  });

  test('перестроение состава подменю зовёт blur пункта снесённого уровня', async ({ page }) => {
    await makeMenu(page);
    // Фокус стоит на пункте подменю, и автор меняет его состав. Уровень с этим пунктом
    // будет снесён целиком, и `blur` обязан прийти именно от сноса, а не от закрытия:
    // меню всё это время на экране.
    await hoverItem(page, 'Ветка');
    await page.waitForFunction(() => {
      return document.querySelectorAll('.vc-menu:popover-open').length === 2;
    });
    await hoverItem(page, 'Лист');
    await page.evaluate(() => {
      const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__focus.bumpSubmenuVersion();
    });
    // Возврат на владельца переоткрывает подменю, и перестроенный уровень приходит на
    // место снесённого.
    await hoverItem(page, 'Первый');
    await hoverItem(page, 'Ветка');
    const after = await readMenu(page);
    expect(after.log).toContain('blur:Лист');
    expect(stillHeld(after.log)).toEqual(['Ветка']);
  });

  test('снос уровня не отдаёт blur чужому пункту, у которого фокус стоит', async ({ page }) => {
    await makeMenu(page);
    // Фокус возвращается владельцу, а отметка в подменю остаётся: она значит «курсор
    // стоит здесь». Снос этого уровня не имеет права отнять фокус у владельца.
    await press(page, 'End');
    await press(page, 'ArrowRight');
    await press(page, 'ArrowLeft');
    await page.evaluate(() => {
      const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__focus.bumpSubmenuVersion();
    });
    await hoverItem(page, 'Первый');
    await hoverItem(page, 'Ветка');
    const after = await readMenu(page);
    // Ложный отчёт выдаёт себя снимком: `blur` не может прийти на пункт, у которого
    // фокус всё ещё стоит. Подсветка при этом может стоять — отметка это другой
    // вопрос, — и сравнивать журнаки целиком здесь не нужно.
    expect(after.snaps.filter((snap) => {
      return snap.entry.startsWith('blur:') && snap.focused === true;
    }), 'ни один blur не пришёлся на пункт в фокусе').toEqual([]);
    expect(stillHeld(after.log), 'фокус держит владелец').toEqual(['Ветка']);
    expect(after.log[after.log.length - 1], 'последним пришёл focus:Ветка').toBe('focus:Ветка');
  });

  test('невыбираемая строка под фокусом в подменю зовёт blur без задержки', async ({ page }) => {
    await makeMenu(page);
    // Фокус в подменю, курсор — на отключённой строке корня. Меню переносит фокус на
    // элемент уровня и прячет подменю, то есть фокус уходит с пункта подменю прямо
    // здесь, и ждать следующего события автору нельзя.
    await hoverItem(page, 'Ветка');
    await page.waitForFunction(() => {
      return document.querySelectorAll('.vc-menu:popover-open').length === 2;
    });
    await press(page, 'End');
    await press(page, 'ArrowRight');
    // Курсор уходит на невыбираемую строку корня, а фокус стоит в подменю.
    await hoverItem(page, 'Глухо');
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Ветка', 'blur:Ветка', 'focus:Лист', 'blur:Лист']);
    expect(stillHeld(after.log), 'пара пункта подменю закрылась сразу').toEqual([]);
  });

  test('destroyOnClose зовёт blur до разбора', async ({ page }) => {
    await makeMenu(page, { destroyOnClose: true });
    await hoverItem(page, 'Первый');
    await page.mouse.click(FAR_POINT.x, FAR_POINT.y);
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый']);
  });

  test('destroy из focusAction не роняет обработчик и не оставляет пару', async ({ page }) => {
    await makeMenu(page, { destroyOnFocus: true });
    await hoverItem(page, 'Первый');
    const after = await readMenu(page);
    // Разбор зовётся изнутри действия: событие фокуса к этому моменту уже записано, а
    // обработчик, в котором шёл вызов, не должен упасть.
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый']);
    expect(stillHeld(after.log), 'разбор закрывает пару').toEqual([]);
    expect(after.errors).toEqual([]);
    expect(await page.evaluate(() => {
      const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__focus.alive();
    })).toBe(false);
  });
});

test.describe('асинхронные действия и отказы', () => {
  test('асинхронный focusAction зовётся и не мешает меню', async ({ page }) => {
    await makeMenu(page, { asyncActions: true });
    await hoverItem(page, 'Первый');
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Первый']);
    expect(after.errors).toEqual([]);
    expect(after.snaps[0].active).toBe(true);
  });

  test('отказ focusAction приходит в error и не снимает выделение', async ({ page }) => {
    await makeMenu(page);
    await armNext(page, 'focus');
    await hoverItem(page, 'Первый');
    const after = await readMenu(page);
    expect(after.errors).toEqual(['focusAction']);
    // Отказ не отменяет выделение: отметка уже стояла, и «обработанная» ошибка не
    // должна отматывать состояние меню.
    expect(after.activeLabels).toEqual(['Первый']);
    expect(after.shown).toBe(1);
  });

  test('отказ blurAction приходит в error', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Первый');
    await armNext(page, 'blur');
    await hoverItem(page, 'Второй');
    const after = await readMenu(page);
    expect(after.errors).toEqual(['blurAction']);
    // Цепочка событий не прервана: следующий focus состоялся.
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый', 'focus:Второй']);
  });

  test('отказ без подписчика error уходит на страницу', async ({ page }) => {
    await makeMenu(page, { noErrorListener: true });
    await armNext(page, 'focus');
    await hoverItem(page, 'Первый');
    const after = await readMenu(page);
    expect(after.pageErrors.length, 'непойманная ошибка на странице').toBeGreaterThan(0);
  });

  test('отказ с preventDefault даёт тишину', async ({ page }) => {
    await makeMenu(page);
    await page.evaluate(() => {
      const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__focus.onError(true);
    });
    await armNext(page, 'focus');
    await hoverItem(page, 'Первый');
    const after = await readMenu(page);
    expect(after.errors).toEqual(['focusAction']);
    expect(after.pageErrors).toEqual([]);
  });

  test('действия получают ноль аргументов', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Первый');
    await hoverItem(page, 'Второй');
    const after = await readMenu(page);
    for (const snap of after.snaps) {
      expect(snap.args).toBe(0);
    }
  });
});

test.describe('границы', () => {
  test('соседний экземпляр не вмешивается в состояние фокуса', async ({ page }) => {
    await makeMenu(page);
    // Второй экземпляр живёт на той же странице, но его слот и карта действий —
    // свои: чужой показ не имеет права трогать пары первого.
    await page.evaluate(() => {
      const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__focus.secondMenu();
      return scope.__focus.openSecond();
    });
    // Чужое меню забирает DOM-фокус на свой элемент уровня, но не имеет права трогать
    // пары первого экземпляра: слот и карта действий у экземпляров разные, и в чужой
    // показ библиотека не вмешивается. Пара первого экземпляра поэтому остаётся
    // незакрытой — и это предел, а не ошибка парности.
    await hoverItem(page, 'Первый');
    await hoverItem(page, 'Второй');
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый', 'focus:Второй']);
    expect(after.errors).toEqual([]);
    expect(unpaired(after.log)).toEqual([]);
  });

  test('пункт, ставший отключённым, теряет фокус с blur', async ({ page }) => {
    await makeMenu(page);
    // Пункт получает фокус, пока доступен, и становится недоступным к следующему
    // показу. Обещание ему дано, и закрыть его должно закрытие — молча оставлять пару
    // нельзя, а вот нового `focus` у недоступного пункта не бывает.
    await press(page, 'ArrowDown');
    await page.evaluate(() => {
      const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__focus.disableFirst();
      return scope.__focus.reopen();
    });
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый']);
    expect(stillHeld(after.log), 'пара закрыта, а не брошена').toEqual([]);
    expect(after.activeLabels, 'недоступный пункт не отмечается').toEqual([]);
    expect(after.shown).toBe(1);
  });

  test('разделитель не получает событий при наведении', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Первый');
    await hoverSeparator(page);
    const after = await readMenu(page);
    // Разделитель — не пункт: выделение на нём не мигает, и пары он не разрывает.
    // Снятие выделения при уходе курсора сработало бы и на разделителе, и подсветка
    // мигала бы на каждом проходе мимо него.
    expect(after.log).toEqual(['focus:Первый']);
    expect(after.activeLabels, 'выделение осталось на пункте').toEqual(['Первый']);
  });

  test('событие приходит в том же стеке, что и перемена состояния', async ({ page }) => {
    await makeMenu(page);
    await page.evaluate(() => {
      const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__focus.watchAfterKeydown();
    });
    await press(page, 'ArrowDown');
    // Слушатель документа ловит `keydown` после обработчика уровня. Видел ли он вызов
    // действия к своему моменту — и есть ответ на «в том же стеке»: отложенное на
    // микрозадачу действие сюда бы не успело.
    const saw = await page.evaluate(() => {
      const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__focus.sawFocusAction();
    });
    expect(saw).toBe(true);
    expect((await readMenu(page)).log).toEqual(['focus:Первый']);
  });

  test('focus и blur парны на длинном сценарии', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Первый');
    await hoverItem(page, 'Второй');
    await press(page, 'ArrowDown');
    await press(page, 'End');
    await press(page, 'ArrowRight');
    await press(page, 'ArrowDown');
    await press(page, 'ArrowLeft');
    await hoverItem(page, 'Первый');
    await page.mouse.move(FAR_POINT.x, FAR_POINT.y);
    await page.mouse.click(FAR_POINT.x, FAR_POINT.y);
    const after = await readMenu(page);
    expect(unpaired(after.log), `журнал: ${after.log.join(', ')}`).toEqual([]);
    expect(stillHeld(after.log), 'закрытие в конце закрывает последнюю пару').toEqual([]);
    expect(after.log.length).toBeGreaterThan(6);
  });

  test('действие, открывшее меню заново, не наследует фокус', async ({ page }) => {
    await makeMenu(page, { reopenOnFocus: true });
    await hoverItem(page, 'Первый');
    const after = await readMenu(page);
    // Переоткрытие гасит прежнюю постановку и поднимает слот, поэтому новый показ не
    // приносит `focus` без перехода: фокус после переоткрытия не на пункте.
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый']);
    expect(after.shown).toBe(1);
  });

  test('отказ blurAction не прерывает закрытие', async ({ page }) => {
    await makeMenu(page);
    await hoverItem(page, 'Первый');
    await armNext(page, 'blur');
    await page.mouse.click(FAR_POINT.x, FAR_POINT.y);
    const after = await readMenu(page);
    expect(after.errors).toEqual(['blurAction']);
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый']);
    expect(after.shown).toBe(0);
  });
});
