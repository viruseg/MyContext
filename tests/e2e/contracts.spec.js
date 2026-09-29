import { expect, test } from '@playwright/test';

/**
 * Кейсы на два дефекта, найденных финальным ревью по всему проекту. Оба живут на
 * стыке модулей, и оба прошли 13 задачных ревью, потому что ни одно не видело
 * обеих сторон стыка целиком: `keyboard.js` о жизненном цикле не знает, а README
 * обещал проверку опций, которой не было.
 *
 * Первый — поломка контракта: действие пункта вправе уничтожить экземпляр («снять
 * с экрана по выбору» обычная форма), и после этого движок звал `host.closeAll()`,
 * а тот бросал `Error` наружу из обработчика клавиш. Путь мыши был защищён
 * проверкой в `#onLevelClick`, путь клавиатуры — нет.
 *
 * Второй — необещанная проверка: `options` не валидировались вовсе при том, что
 * README писал «Конфигурация проверяется сразу». Каждая поломка была бесшумной и
 * необратимой: неизвестная тема попадала в `data-vc-theme` дословно, `NaN` в
 * длительности давал недействительный токен и молча пропадавшую анимацию, пустой
 * `label` — `aria-label=""`.
 *
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/icons.js').IconConfig} IconConfig
 */

/**
 * @typedef {object} ProbeView
 * @property {number} menuCount узлов `.vc-menu` в документе.
 * @property {number} openCount показанных уровней.
 * @property {string | null} theme `data-vc-theme` показанного уровня.
 * @property {string[]} log метки сработавших действий, по порядку.
 * @property {string[]} labels подписи пунктов показанного корня, по порядку.
 * @property {string | null} id `id` показанного корневого уровня.
 */

/**
 * Вид поломки результата действия: что именно действие вернёт не тем.
 *
 * @typedef {'label' | 'icon' | 'submenu'} BrokenKind
 */

/**
 * @typedef {object} McProbe
 * @property {(set: McSet) => void} make
 * @property {() => void} makeBadTheme
 * @property {() => void} makeNaNDuration
 * @property {() => void} makeEmptyLabel
 * @property {(x: number, y: number) => void} open
 * @property {(label: string) => void} activateWithKeyboard
 * @property {(kind: BrokenKind) => void} installBroken подмена одного действия
 *   пункта на действие, возвращающее негодное значение.
 * @property {(kind: 'label' | 'submenu', value: unknown) => void} openBrokenSubmenu
 *   постройка и показ меню, где действие возвращает заданное значение.
 * @property {() => void} openThrowing постройка и показ меню, где действие бросает.
 * @property {() => string[]} readCalls имена действий, званных на показах.
 * @property {() => void} clearCalls очистка журнала вызовов.
 * @property {() => number} pinLevel пометить текущий элемент корневого уровня.
 * @property {() => boolean} levelPinned помечен ли текущий элемент уровня.
 * @property {() => void} grow добавление пункта в состав корня.
 * @property {() => void} replaceItems замена пунктов на новые объекты тех же значений.
 * @property {() => void} bumpVersion подъём `version` у пункта.
 * @property {() => void} closeMenu закрытие меню.
 * @property {() => string[]} readErrors
 * @property {() => ProbeView} read
 */

/**
 * Набор, который заводит `make`.
 *
 * @typedef {'selfDestroy' | 'plain' | 'counting' | 'mutable' | 'versioned'} McSet
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

/** Точка вызова: подальше от краёв, чтобы позиционирование не путать с закрытием. */
const OPEN_POINT = { x: 200, y: 200 };

/**
 * @param {import('@playwright/test').Page} page
 * @param {McSet} set
 * @returns {Promise<void>}
 */
function makeMenu(page, set) {
  return page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(name);
  }, set);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'makeBadTheme' | 'makeNaNDuration' | 'makeEmptyLabel'} factory
 * @returns {Promise<string | null>} сообщение об ошибке либо `null`, если её не было.
 */
function makeWithBadOption(page, factory) {
  return page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    try {
      // Набор сужает параметр до трёх известных фабрик, и TypeScript здесь их
      // видит: индекс не нужен, а `@ts-expect-error` был бы директивой без
      // подавляемой ошибки.
      if (name === 'makeBadTheme') {
        scope.__mc.makeBadTheme();
      } else if (name === 'makeNaNDuration') {
        scope.__mc.makeNaNDuration();
      } else {
        scope.__mc.makeEmptyLabel();
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, factory);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function openAt(page, point) {
  return page.evaluate((payload) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.open(payload.x, payload.y);
  }, point);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<ProbeView>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
function readErrors(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.readErrors();
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  // `goto` обязателен перед `setContent`: без него у документа нет адреса, и ни
  // ссылка на таблицу стилей, ни динамический импорт не разрешились бы.
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
  const log = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {InstanceType<typeof MyContext> | null} */
  let menu = null;
    /** @type {string[]} имена действий, званных на показах. */
    const calls = [];
    /** Метка закреплённого элемента уровня: пережила бы перестройку в поле. */
    let pinned = new WeakSet();
    let pins = 0;
    /**
   * Состав корня, который кейс меняет между показами. Массив общий: и
   * `build`, и `menu` держат его по ссылке, поэтому `grow` виден следующему
   * показу, а `replaceItems` подменяет содержимое целиком.
   *
   * @type {MenuItem[]}
   */
  const mutableItems = [
    { labelAction: () => 'Первый', action: () => log.push('первый') },
    { labelAction: () => 'Второй', action: () => log.push('второй') },
  ];
  /** Пункт, у которого кейс поднимает `version`, и его текущая подпись. */
  let versionedItem = /** @type {MenuItem | null} */ (null);
  let versionedLabel = 'один';

  /**
   * Действие, возвращающее негодное значение: подмена ровно одного действия
   * пункта, чтобы поломка была единственной причиной ошибки.
   *
   * @param {BrokenKind} kind вид поломки.
   * @returns {() => unknown}
   */
    function brokenAction(kind) {
      if (kind === 'label') {
        return () => 42;
      }
      if (kind === 'icon') {
        return () => '📄';
      }
      return () => 'не массив';
    }

    /**
     * Пункт с одним негодным действием. Остальные действия пункта годные, иначе
     * первая же проверка упала бы не на том поле, которое подменили.
     *
     * @param {BrokenKind} kind вид поломки.
     * @param {() => unknown} broken подменённое действие.
     * @returns {MenuItem}
     */
    function brokenItem(kind, broken) {
      if (kind === 'label') {
        return { labelAction: /** @type {() => string} */ (broken) };
      }
      if (kind === 'icon') {
        return { labelAction: () => 'Пункт', iconAction: /** @type {() => IconConfig} */ (broken) };
      }
      return { labelAction: () => 'Пункт', submenuAction: /** @type {() => MenuItem[]} */ (broken) };
    }

  globalThis.addEventListener('error', (event) => {
    errors.push(String(event.message));
  });
  // `unhandledrejection` ловит отклонённое обещание без обработчика. Ошибка из
  // обработчика клавиш синхронна и приходит в `error`, но действие вправе
  // вернуть отклонённое обещание, и тогда единственным сигналом будет он.
  globalThis.addEventListener('unhandledrejection', (event) => {
    errors.push(`отклонённое обещание: ${String(event.reason)}`);
  });

  const container = document.getElementById('surface');
  if (!(container instanceof HTMLElement)) {
    throw new Error('нет контейнера surface');
  }

  /**
   * @param {Array<MenuItem>} items
   * @param {Record<string, unknown>} [options]
   * @returns {void}
   */
  function build(items, options) {
    if (menu !== null) {
      menu.destroy();
    }
    log.length = 0;
    errors.length = 0;
    menu = new MyContext(items, options === undefined ? { label: 'Меню' } : options);
    const anchor = container;
    if (anchor === null) {
      throw new Error('нет контейнера surface');
    }
    menu.attach(anchor);
  }

  const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
  scope.__mc = {
    make(set) {
      if (set === 'selfDestroy') {
        build([
          {
            labelAction: () => 'Закрыть навсегда',
            action: () => {
              log.push('уничтожить');
              // Обычная форма «снять с экрана по выбору»: пункт сносит то
              // меню, в котором находится. Действие выполняется первым, а
              // закрытие зовёт уже движок клавиатуры — и до `destroy()` оно
              // было живо.
              if (menu !== null) {
                menu.destroy();
              }
            },
          },
          { labelAction: () => 'Просто пункт' },
        ]);
        return;
      }
      if (set === 'counting') {
        // Порядок вызовов и есть предмет кейса: четыре действия зовутся на
        // каждом показе, и зовутся в одном порядке. Счётчик идёт по именам,
        // а не по счётчикам на каждое действие, — иначе порядок не был бы
        // виден вовсе.
        build([
          {
            labelAction: () => {
              calls.push('label');
              return 'Первый';
            },
            iconAction: () => {
              calls.push('icon');
              return { type: 'emoji', value: '📄' };
            },
            submenuAction: () => {
              calls.push('submenu');
              return [{ labelAction: () => 'Лист' }];
            },
            isEnabledAction: () => {
              calls.push('isEnabled');
              return true;
            },
          },
        ]);
        return;
      }
      if (set === 'mutable') {
        build(mutableItems);
        return;
      }
      if (set === 'versioned') {
        // Пункт переиспользуется между показами, и `version` меняется на нём
        // самом: поле скопировано в объект по значению, и подъём переменной
        // снаружи пункта бы не коснулся.
        versionedItem = { labelAction: () => versionedLabel, version: 0 };
        build([versionedItem]);
        return;
      }
      build([{ labelAction: () => 'Просто пункт' }]);
    },
      installBroken(kind) {
        build([brokenItem(kind, brokenAction(kind))]);
      },
      openBrokenSubmenu(kind, value) {
        build([brokenItem(kind, () => value)]);
        menu?.open({ x: 200, y: 200 });
      },
      openThrowing() {
      build([{
        labelAction: () => {
          throw new Error('автор бросил сам');
        },
      }]);
      menu?.open({ x: 200, y: 200 });
    },
      readCalls() {
        return calls;
      },
      clearCalls() {
        calls.length = 0;
      },
      pinLevel() {
        // Метка на самом элементе уровня, а не на его содержимом: перестройка
        // строит новый элемент, и метка на нём была бы уже другой. Метка
        // хранится в счётчике, а не в поле элемента, — иначе она пережила бы
        // перестройку и кейс прошёл бы вхолостую.
        const root = document.querySelector('.vc-menu');
        if (root === null) {
          return 0;
        }
        pins += 1;
        pinned = new WeakSet();
        pinned.add(root);
        return pins;
      },
      levelPinned() {
        const root = document.querySelector('.vc-menu');
        return root !== null && pinned.has(root);
      },
      grow() {
      mutableItems.push({ labelAction: () => 'Третий', action: () => log.push('третий') });
    },
    replaceItems() {
      // Новые объекты с теми же значениями полей: отпечаток не меняется, и
      // уровень перестраиваться не должен. Но по клику обязано зваться
      // действие нового пункта, а не прежнего, оставшегося в карте.
      mutableItems.splice(0, mutableItems.length, {
        labelAction: () => 'Первый',
        action: () => log.push('новый:первый'),
      }, {
        labelAction: () => 'Второй',
        action: () => log.push('новый:второй'),
      });
    },
    bumpVersion() {
      if (versionedItem !== null) {
        versionedItem.version = (versionedItem.version ?? 0) + 1;
      }
      versionedLabel = 'два';
    },
    closeMenu() {
      menu?.close();
    },
    makeBadTheme() {
      build([{ labelAction: () => 'Пункт' }], { theme: 'нет-темы' });
    },
    makeNaNDuration() {
      build([{ labelAction: () => 'Пункт' }], { animationDuration: Number.NaN });
    },
    makeEmptyLabel() {
      build([{ labelAction: () => 'Пункт' }], { label: '' });
    },
    open(x, y) {
      if (menu === null) {
        throw new Error('меню не создано');
      }
      menu.open({ x, y });
    },
    activateWithKeyboard(name) {
      if (menu === null) {
        throw new Error('меню не создано');
      }
      for (const level of Array.from(document.querySelectorAll('.vc-menu'))) {
        for (const label of Array.from(level.querySelectorAll('.vc-label'))) {
          if (String(label.textContent) !== name) {
            continue;
          }
          const item = label.closest('.vc-item');
          if (item instanceof HTMLElement) {
            item.focus();
            // Клавиша активации работает по активному пункту, а не по
            // сфокусированному узлу: без отметки `Enter` не делает ничего, и
            // проба проверяла бы не путь активации, а произвольный фокус.
            item.setAttribute('data-active', '');
            item.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
            );
            return;
          }
        }
      }
      throw new Error(`пункт «${name}» не найден`);
    },
    readErrors() {
      return errors;
    },
    read() {
      const levels = Array.from(document.querySelectorAll('.vc-menu'));
      const shown = levels.filter((level) => level.matches(':popover-open'));
      const root = shown[0];
      return {
        menuCount: levels.length,
        openCount: shown.length,
        theme: shown.length === 0 ? null : shown[0].getAttribute('data-vc-theme'),
        log: [...log],
        labels: root === undefined
          ? []
          : Array.from(root.querySelectorAll('.vc-label'), (node) => {
            return String(node.textContent);
          }),
        id: root === undefined ? null : root.id,
      };
    },
  };
  });
});

test.describe('контракты на стыке модулей', () => {
  test('действие, уничтожившее экземпляр, не роняет обработчик клавиш', async ({ page }) => {
    await makeMenu(page, 'selfDestroy');
    await openAt(page, OPEN_POINT);
  const opened = await readMenu(page);
  expect(opened.openCount, 'меню открыто').toBe(1);

  // Клавиатура, а не мышь: именно этот путь звал `host.closeAll()` без проверки
  // и бросал `MyContext: экземпляр уничтожен` наружу из обработчика клавиш.
  // Проверяется именно то, что `closeAll` после `destroy()` не бросает, — сама
  // активация подтверждается журналом.
  await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.activateWithKeyboard('Закрыть навсегда');
  });

  const after = await readMenu(page);
  expect(after.log, 'действие выполнилось').toEqual(['уничтожить']);
  expect(after.menuCount, 'уровней не осталось').toBe(0);
  // Ошибок не просто нет — их не могло быть и от промиса: обработчик обеих
  // необработанных ошибок стоит в `beforeEach` до создания меню.
  expect(await readErrors(page), 'страница без ошибок').toEqual([]);
});

test('негодная тема отклоняется, а не попадает в разметку', async ({ page }) => {
  // Контроль живости: тот же вызов без поломки не бросает ничего.
  await makeMenu(page, 'plain');
  expect(await makeWithBadOption(page, 'makeEmptyLabel'), 'контроль: имя обязательно').toContain(
    'options.label',
  );
  expect(
    await makeWithBadOption(page, 'makeBadTheme'),
    'тема названа в сообщении с путём до поля',
  ).toContain('options.theme');
  expect(await readErrors(page), 'страница без ошибок').toEqual([]);
});

test('негодная длительность отклоняется, а не даёт NaNms', async ({ page }) => {
  // `NaN` в длительности даёт недействительный токен, и переход схлопывается в
  // ноль: анимация пропадает молча, без ошибки и без следа. Раньше так и было.
  expect(
    await makeWithBadOption(page, 'makeNaNDuration'),
    'длительность названа с путём до поля',
  ).toContain('options.animationDuration');
});

test('негодные опции не оставляют после себя экземпляр', async ({ page }) => {
  // Конструктор бросает до `attach`, поэтому в документе не остаётся ни одного
  // уровня. Без проверки кейс прошёл бы и при экземпляре, который всё-таки
  // создался и просто не привязался.
  await makeWithBadOption(page, 'makeBadTheme');
  await makeWithBadOption(page, 'makeNaNDuration');
  await makeWithBadOption(page, 'makeEmptyLabel');

  const after = await readMenu(page);
  expect(after.menuCount, 'ни одного уровня в документе').toBe(0);
  expect(after.theme, 'показанного уровня нет').toBeNull();
});
});

test.describe('проверка результата действий', () => {
test('подпись, иконка и подменю обязаны вернуть своё', async ({ page }) => {
  // Ошибка приходит из `open()`, а не из конструктора: значения действий
  // известны только на показе, и проверяются там же. Кейс ловит именно то
  // исключение, которое увидит автор.
  /** @param {BrokenKind} kind */
    const openWithBroken = async (kind) => {
    await makeMenu(page, 'plain');
    return page.evaluate((broken) => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.installBroken(broken);
      try {
        scope.__mc.open(200, 200);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, kind);
  };

  expect(await openWithBroken('label'), 'подпись названа с путём').toContain('.labelAction');
  expect(await openWithBroken('icon'), 'иконка названа с путём').toContain('.iconAction');
  expect(await openWithBroken('submenu'), 'подменю названо с путём').toContain('.submenuAction');
});

test('пустая подпись и пустое подменю отклоняются так же, как негодный тип', async ({ page }) => {
  // Пустая строка и пустой массив — не «нулевое» значение, а отсутствие
  // ответа: подписи нечего читать, подменю нечего раскрывать.
  /**
   * @param {'label' | 'submenu'} kind вид поломки: подпись принимает строку, а
   *   подменю — массив, и подмена идёт значением.
   * @param {unknown} value значение, которым подменяется результат.
   * @returns {Promise<string | null>}
   */
  const openWith = async (kind, value) => {
      await makeMenu(page, 'plain');
    return page.evaluate((input) => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      try {
        scope.__mc.openBrokenSubmenu(input.kind, input.value);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, { kind, value });
  };

  expect(await openWith('label', '   '), 'пробельная подпись').toContain('.labelAction');
  expect(await openWith('submenu', []), 'пустое подменю').toContain('.submenuAction');
});

test('исключение из действия уходит из open() вызывающему', async ({ page }) => {
  await makeMenu(page, 'plain');
  const message = await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    try {
      scope.__mc.openThrowing();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(message, 'сообщение автора дошло целиком').toBe('автор бросил сам');
});

test('действия зовутся на каждом показе, а не только на первом', async ({ page }) => {
  await makeMenu(page, 'counting');
  await openAt(page, OPEN_POINT);
  // Журнал обнуляется после первого показа: иначе кейс видел бы два круга по
  // четыре вызова и не отличал бы перечитывание от единственного показа.
  await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.clearCalls();
    scope.__mc.closeMenu();
  });
  await openAt(page, OPEN_POINT);

  const calls = await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.readCalls();
  });
  // Четыре действия по одному разу на пункт за показ: без перечитывания
  // подпись и иконка застыли бы на первом показе, а состав подменю не ответил
  // бы на изменившееся состояние.
  expect(calls).toEqual(['isEnabled', 'label', 'icon', 'submenu']);
});
});

test.describe('состав уровня', () => {
test('изменившийся состав перестраивает уровень целиком', async ({ page }) => {
  await makeMenu(page, 'mutable');
  await openAt(page, OPEN_POINT);
  const before = await readMenu(page);
  // Пометка элемента: перечитывание действий обновило бы подписи и на прежнем
  // уровне, и по подписям перестройку не отличить — видно её только по узлу.
  await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.pinLevel();
  });

  await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.grow();
  });
  await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.closeMenu();
  });
  await openAt(page, OPEN_POINT);
  const after = await readMenu(page);

  expect(after.labels, 'новый состав виден целиком').toEqual(['Первый', 'Второй', 'Третий']);
  // Один уровень, а не два: перестройка снесла прежний и построила новый под
  // тем же адресом, а не достроила список в прежнем.
  expect(after.menuCount, 'уровень один').toBe(1);
  expect(after.id, 'адрес уровня прежний — aria-owns остался в силе').toBe(before.id);
  expect(
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.levelPinned();
    }),
    'уровень перестроен, а не достроен',
  ).toBe(false);
});

test('тот же состав с новыми объектами не перестраивает уровень', async ({ page }) => {
  await makeMenu(page, 'mutable');
  await openAt(page, OPEN_POINT);
  const before = await readMenu(page);

  // Новые объекты с теми же значениями полей: отпечаток совпадает, и
  // перестраивать нечего. Но запись в карте действий обязана перезаписаться, и
  // по клику зовётся действие нового пункта.
  await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.replaceItems();
  });
  await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.closeMenu();
  });
  await openAt(page, OPEN_POINT);
  const after = await readMenu(page);

  expect(after.id, 'тот же уровень, адрес не сменился').toBe(before.id);
  expect(after.labels, 'подписи те же').toEqual(['Первый', 'Второй']);
  // Уровень прежний, а не новый: отпечаток совпал, и перестраивать было не
  // на что. Без этой проверки кейс прошёл бы и при полной перестройке — тогда
  // подписи были бы теми же, а адрес тем же.
  expect(
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.pinLevel();
      scope.__mc.closeMenu();
      return scope.__mc.levelPinned();
    }),
    'метка легла на прежний уровень',
  ).toBe(true);
  await openAt(page, OPEN_POINT);
  expect(
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.levelPinned();
    }),
    'после показа тот же элемент',
  ).toBe(true);

  await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.activateWithKeyboard('Второй');
  });
  expect(await readMenu(page).then((view) => view.log), 'званьем новый пункт')
    .toEqual(['новый:второй']);
});

test('version заставляет перестроить при неизменившейся структуре', async ({ page }) => {
  // Признак перестройки — сам элемент уровня, а не его содержимое: перечитывание
  // действий обновляет подписи и на неперестроенном уровне, и по подписи
  // перестройку не отличить. Метка живёт в счётчике пробы, а не в поле
  // элемента, — иначе она переехала бы вместе с узлом и всегда оставалась бы.
  const pin = () => {
    return page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.pinLevel();
      return scope.__mc.levelPinned();
    });
  };
  const isPinned = () => {
    return page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.levelPinned();
    });
  };

  await makeMenu(page, 'versioned');
  await openAt(page, OPEN_POINT);
  expect(await pin(), 'метка легла на текущий уровень').toBe(true);

  // Контроль в обе стороны: без подъёма `version` тот же самый показ оставляет
  // уровень прежним. Без этого кейс прошёл бы и при перестройке на каждом
  // показе, то есть проверял бы не `version`, а что угодно.
  await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.closeMenu();
  });
  await openAt(page, OPEN_POINT);
  expect(await isPinned(), 'без подъёма version уровень прежний').toBe(true);

  await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.bumpVersion();
  });
  await page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.closeMenu();
  });
  await openAt(page, OPEN_POINT);

  expect(await isPinned(), 'после подъёма version уровень новый').toBe(false);
  const after = await readMenu(page);
  expect(after.labels, 'подпись перечитана на новом уровне').toEqual(['два']);
});
});
