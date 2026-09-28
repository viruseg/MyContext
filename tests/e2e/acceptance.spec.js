import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { CURSOR_OFFSET, CLOSE_GRACE_MS, OPEN_GRACE_MS, SAFETY_PADDING } from '../../src/constants.js';

/**
 * Приёмка по критериям готовности: семь кейсов, по одному на критерий.
 *
 * Этот файл не переигрывает остальные наборы, а проверяет итог целиком, поэтому
 * проба здесь своя, наборы пунктов свои, а утверждения — самые широкие из
 * возможных. Позиция каждого кейса объяснена в комментарии к нему: у кейса без
 * такой записки непонятно, что именно он ломает.
 *
 * Три решения, общих для всего файла.
 *
 * **Время заморожено там, где есть задержки, и только там.** Задержки открытия и
 * закрытия подменю принадлежат `hoverIntent`, а «сразу» и «через 250 мс» —
 * разные состояния, а не разные вероятности. В остальных кейсах часы не
 * трогаются, иначе утверждения о геометрии и о computed-style зависели бы от
 * замороженного времени совершенно по другому поводу.
 *
 * **`reduce` эмулируется везде, кроме явного контроля в критерии 6.** Под `reduce`
 * слой вызывает `hidePopover()` немедленно, а не через `animationDuration`, то
 * есть «меню закрыто» читается в том же снимке, в котором оно закрылось. Без
 * этого каждый кейс про счётчик открытых уровней ждал бы анимацию или зависал на
 * замороженных часах.
 *
 * **Мышь водится только там, где мышь и есть предмет.** Критерий 5 — клавиатурный
 * по существу, и в нём ни одного `page.mouse`: иначе «меню полностью управляется
 * с клавиатуры» проверялось бы на сценарии, который до половины пройден мышью.
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
 * @typedef {object} ItemView
 * @property {string} label подпись пункта; `''` у разделителя.
 * @property {boolean} separator разделитель ли это.
 * @property {string} iconTag имя тега узла в слоте иконки либо `''`, если слот пуст.
 * @property {number} iconChildren сколько узлов в слоте: ноль, один или два
 *   (битая разметка оставляет `span` вместо узла иконки — счёт это видит).
 * @property {string} iconText текст узла иконки, если он текстовый.
 * @property {string | null} iconHidden `aria-hidden` узла иконки.
 * @property {number} labelLeft левая граница лейбла — по ней судится соосность.
 * @property {number} iconWidth ширина узла иконки.
 * @property {boolean} active несёт `data-active`.
 * @property {boolean} disabled `aria-disabled="true"`.
 * @property {string | null} expanded `aria-expanded`.
 * @property {MenuRect} rect
 */

/**
 * @typedef {object} LevelView
 * @property {string} id
 * @property {boolean} popoverOpen `:popover-open` — уровень в Top Layer.
 * @property {MenuRect} rect
 * @property {ItemView[]} items
 */

/**
 * @typedef {object} Snapshot
 * @property {LevelView[]} levels уровни в порядке документа, включая закрытые.
 * @property {number} openCount сколько уровней в Top Layer.
 * @property {number} menuCount сколько узлов `.vc-menu` в документе вообще.
 * @property {string | null} focusId `id` элемента с фокусом либо имя его тега.
 * @property {string | null} focusLabel подпись пункта с фокусом.
 * @property {string[]} log метки сработавших действий, по порядку.
 * @property {ProbeContextMenu[]} contextmenu события `contextmenu`, дойденные до
 *   документа: видно, что событие было и был ли оно подавлено.
 * @property {string[]} errors сообщения необработанных ошибок страницы.
 */

/**
 * @typedef {object} ProbeContextMenu
 * @property {string | null} container `id` контейнера под целью.
 * @property {boolean} prevented `defaultPrevented` к моменту всплытия на документ.
 */

/**
 * Вычисленные стили открытого уровня — предмет критерия 6.
 *
 * @typedef {object} StyleView
 * @property {string} opacity
 * @property {string} transform
 * @property {string} transitionProperty
 * @property {string} transitionDuration
 * @property {string} durationToken инлайновый `--vc-animation-duration`.
 * @property {string[]} running свойства идущих CSS-переходов.
 */

/**
 * Проба на глобальном объекте страницы. Объявлена здесь, а не приходит аргументом:
 * у пунктов есть `action`-функции, а `page.evaluate` селиализует аргументы как
 * JSON и функции бы выбросил.
 *
 * @typedef {object} McProbe
 * @property {(setName: string) => void} make
 * @property {(x: number, y: number) => void} open
 * @property {() => void} close
 * @property {() => void} destroy
 * @property {() => Snapshot} read
 * @property {() => StyleView} styles
 * @property {(label: string) => MenuRect | null} rectOf
 */

const STYLESHEET_PATH = '/styles/mycontext.css';

/**
 * Вьюпорт критерия 2 совпадает с вьюпортом `tests/unit/positioner.spec.js`:
 * сетка точек оттуда и имеет смысл только вместе с ним, а пересчёт под другой
 * размер сделал бы сетку чужой.
 */
const VIEWPORT = { width: 1000, height: 800 };

/** Сетка точек вызова из `tests/unit/positioner.spec.js`, без изменений. */
const GRID_X = [0, 1, 8, 9, 400, 500, 991, 999, 1000];
const GRID_Y = [0, 1, 8, 9, 300, 500, 799, 800];

/** Отдельный вьюпорт для остальных кейсов: четыри уровня влезают только в него. */
const WIDE_VIEWPORT = { width: 1200, height: 800 };

/** Точка вызова для клавиатурного кейса: четыре уровня уходят вправо и вниз. */
const KEYBOARD_POINT = { x: 40, y: 120 };

/** Точка вызова для кейса с иконками. */
const ICON_POINT = { x: 60, y: 60 };

/** Точка вызова для кейса с диагональным движением. */
const DIAGONAL_POINT = { x: 60, y: 200 };

/** Точка правого клика по контейнеру в критерии 7. */
const ANCHOR_POINT = { x: 300, y: 200 };

const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <!-- Фон страницы задан явно: по умолчанию он прозрачен, и композит поверх
       прозрачного чёрного занижал бы измерения полупрозрачной подложки. -->
  <body style="background: rgb(255, 255, 255)">
    <!-- Контейнер на всю страницу и с tabindex="-1": правый клик открывает меню
         в любой точке, а close() возвращает фокус на элемент-владелец. -->
    <div id="surface" tabindex="-1" data-container="surface"
         style="position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: rgb(240, 240, 240)"></div>
  </body>
</html>`;

/** Разметка векторной иконки для кейса с иконками. */
const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">'
  + '<path d="M2 2h12v12H2z" fill="currentColor"/></svg>';

/**
 * Растровая иконка: `data:image/svg+xml` проходит схему санитизации и при этом
 * декодируется во всех трёх движках, то есть её `naturalWidth` доказывает, что
 * `src` дошёл до браузера, а не был отброшен проверкой адреса.
 */
const ICON_RASTER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' "
  + "width='16' height='16' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' "
  + "fill='%23cc3300'/%3E%3C/svg%3E";

/**
 * Мгновение, на котором замирают часы критерия 3, и точка запуска на час раньше.
 * Разрыв объяснён в `tests/e2e/submenu.spec.js`: `install` не только ставит время,
 * но и сразу пускает часы, а `pauseAt` в прошлое Firefox отказывается принимать.
 */
const CLOCK_FROZEN_AT = new Date('2024-12-10T09:00:00Z');
const CLOCK_START_AT = new Date(CLOCK_FROZEN_AT.getTime() - 3_600_000);

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} setName
 * @returns {Promise<void>}
 */
function makeMenu(page, setName) {
  return page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(name);
  }, setName);
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
  return page.evaluate((value) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.open(value.x, value.y);
  }, point);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<{ x: number, y: number }>}
 */
async function centreOf(page, label) {
  const rect = await page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.rectOf(name);
  }, label);
  expect(rect, `пункт «${label}» есть в разметке`).not.toBeNull();
  const found = /** @type {MenuRect} */ (rect);
  return { x: found.left + found.width / 2, y: found.top + found.height / 2 };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<void>}
 */
function hoverItem(page, label) {
  return centreOf(page, label).then((point) => {
    return page.mouse.move(point.x, point.y);
  });
}

/**
 * Пункт по подписи в любом уровне.
 *
 * @param {Snapshot} snapshot
 * @param {string} label
 * @returns {ItemView}
 */
function itemOf(snapshot, label) {
  for (const level of snapshot.levels) {
    for (const item of level.items) {
      if (item.label === label) {
        return item;
      }
    }
  }
  throw new Error(`в снимке нет пункта «${label}»`);
}

/**
 * Показан ли уровень с таким `id`.
 *
 * @param {Snapshot} snapshot
 * @param {string} id
 * @returns {boolean}
 */
function isOpen(snapshot, id) {
  return snapshot.levels.some((level) => {
    return level.id === id && level.popoverOpen;
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT);
  // `goto` обязателен перед `setContent`: без него у документа нет адреса, и ни
  // ссылка на таблицу стилей, ни динамический импорт не разрешились бы.
  await page.goto('/');
  await page.setContent(PAGE_HTML);
  // Живая таблица стилей ещё могла не примениться, и замер меню вернул бы нули:
  // кейсы про точку вызова проверяли бы тогда не позиционирование, а отсутствие
  // стилей.
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

  await page.evaluate(
    async ({ svgSource, rasterSource }) => {
      // Спецификатор относительный, а не `/src/index.js`: в браузере он
      // схлопывается до корня сервера, а TypeScript разрешает его от файла теста
      // и берёт типы из исходника. Запись с ведущим слэшем нерезолвилась бы и
      // упала бы на типизации.
      const { MyContext } = await import('../../src/index.js');

      /**
       * Наборы пунктов. Первый пункт корня у `grid` и `deep` — владелец
       * подменю: показ подменю нажатием `ArrowRight` идёт с первого пункта, и
       * пустой первый пункт означал бы, что вторая половина критерия 2 молчала
       * бы, а не проверялась.
       *
       * @type {Record<string, Array<MenuItem | SeparatorItem>>}
       */
      const sets = {
        grid: [
          {
            label: 'Ветка',
            submenu: [
              { label: 'Лист' },
              { label: 'Побег' },
            ],
          },
          { label: 'Соседний' },
          { type: 'separator' },
          { label: 'Хвост' },
        ],
        deep: [
          {
            label: 'Открыть',
            submenu: [
              {
                label: 'Недавние',
                submenu: [
                  {
                    label: 'Проект',
                    submenu: [
                      { label: 'Готово' },
                      { label: 'Черновик' },
                    ],
                  },
                  { label: 'Архив' },
                ],
              },
              { label: 'Избранное' },
            ],
          },
          { label: 'Копировать', action: () => log.push('копировать') },
          { type: 'separator' },
          { label: 'Удалить', action: () => log.push('удалить') },
        ],
        // Первый пункт — владелец, второй обычный: диагональ идёт через него, и
        // пока он без подменю, движение не спутает показ нового уровня с
        // сохранением прежнего.
        diagonal: [
          {
            label: 'Ветка',
            submenu: [
              { label: 'Лист' },
              { label: 'Побег' },
            ],
          },
          { label: 'Соседний' },
          { label: 'Соседний два' },
        ],
        icons: [
          { label: 'Эмодзи', icon: { type: 'emoji', value: '📄' } },
          { label: 'Вектор', icon: { type: 'svg', value: svgSource } },
          { label: 'Растр', icon: { type: 'raster', value: rasterSource, alt: 'Образец' } },
          { label: 'Без иконки' },
          { label: 'Отключён', disabled: true },
          { type: 'separator' },
          { label: 'Тоже без иконки' },
        ],
      };

      /** @type {string[]} метки сработавших действий. */
      const log = [];
      /** @type {string[]} сообщения необработанных ошибок страницы. */
      const errors = [];
      /** @type {ProbeContextMenu[]} */
      const contextmenu = [];
      globalThis.addEventListener('error', (event) => {
        errors.push(String(event.message));
      });
      // Слушатель на документе, а не на контейнере: у документа событие окажется
      // после контейнерного, поэтому `defaultPrevented` к этому моменту уже
      // выставлен привязкой.
      document.addEventListener('contextmenu', (event) => {
        const target = event.target;
        const container = target instanceof Element ? target.closest('[data-container]') : null;
        contextmenu.push({
          container: container === null ? null : container.getAttribute('data-container'),
          prevented: event.defaultPrevented,
        });
      });

      /** @type {InstanceType<typeof MyContext> | null} */
      let menu = null;

      /**
       * @param {Element} item узел пункта или разделителя.
       * @returns {ItemView}
       */
      function readItem(item) {
        const label = item.querySelector('.vc-label');
        const slot = item.querySelector('.vc-icon-slot');
        const icon = slot === null ? null : slot.firstElementChild;
        const rect = item.getBoundingClientRect();
        return {
          label: label === null ? '' : String(label.textContent),
          separator: item.classList.contains('vc-separator'),
          iconTag: icon === null ? '' : String(icon.tagName).toLowerCase(),
          iconChildren: slot === null ? 0 : slot.childElementCount,
          iconText: icon === null || icon.children.length > 0 ? '' : String(icon.textContent),
          iconHidden: icon === null ? null : icon.getAttribute('aria-hidden'),
          labelLeft: label === null ? Number.NaN : label.getBoundingClientRect().left,
          iconWidth: icon === null ? 0 : icon.getBoundingClientRect().width,
          active: item.hasAttribute('data-active'),
          disabled: item.getAttribute('aria-disabled') === 'true',
          expanded: item.getAttribute('aria-expanded'),
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom,
          },
        };
      }

      /**
       * @returns {Snapshot}
       */
      function read() {
        const levels = Array.from(document.querySelectorAll('.vc-menu')).map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.id,
            popoverOpen: element.matches(':popover-open'),
            rect: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              right: rect.right,
              bottom: rect.bottom,
            },
            items: Array.from(element.querySelectorAll('.vc-item, .vc-separator')).map((node) => {
              return readItem(node);
            }),
          };
        });
        const active = document.activeElement;
        const focused = active instanceof Element ? active.closest('.vc-item') : null;
        const focusedLabel = focused === null ? null : focused.querySelector('.vc-label');
        return {
          levels,
          openCount: levels.filter((level) => {
            return level.popoverOpen;
          }).length,
          menuCount: document.querySelectorAll('.vc-menu').length,
          focusId: active === null
            ? null
            : active.id === '' ? String(active.tagName).toLowerCase() : active.id,
          focusLabel: focusedLabel === null ? null : String(focusedLabel.textContent),
          log: log.slice(),
          contextmenu: contextmenu.slice(),
          errors: errors.slice(),
        };
      }

      const probe = /** @type {McProbe} */ ({
        make(setName) {
          if (menu !== null) {
            menu.destroy();
          }
          log.length = 0;
          errors.length = 0;
          contextmenu.length = 0;
          const items = sets[setName];
          if (items === undefined) {
            throw new Error(`в пробе нет набора ${setName}`);
          }
          menu = new MyContext(items, { label: 'Меню приёмки' });
          const container = document.getElementById('surface');
          if (!(container instanceof HTMLElement)) {
            throw new Error('нет контейнера surface');
          }
          menu.attach(container);
        },
        open(x, y) {
          if (menu === null) {
            throw new Error('меню не создано');
          }
          menu.open({ x, y });
        },
        close() {
          if (menu === null) {
            throw new Error('меню не создано');
          }
          menu.close();
        },
        destroy() {
          if (menu === null) {
            throw new Error('меню не создано');
          }
          menu.destroy();
        },
        read,
        styles() {
          const element = document.querySelector('.vc-menu:popover-open');
          if (!(element instanceof HTMLElement)) {
            throw new Error('нет показанного уровня');
          }
          const computed = getComputedStyle(element);
          return {
            opacity: computed.opacity,
            transform: computed.transform,
            transitionProperty: computed.transitionProperty,
            transitionDuration: computed.transitionDuration,
            durationToken: element.style.getPropertyValue('--vc-animation-duration'),
            running: element.getAnimations().map((animation) => {
              return animation instanceof CSSTransition ? animation.transitionProperty : null;
            }),
          };
        },
        rectOf(label) {
          for (const element of document.querySelectorAll('.vc-item')) {
            const found = element.querySelector('.vc-label');
            if (found !== null && String(found.textContent) === label) {
              const rect = element.getBoundingClientRect();
              return {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                right: rect.right,
                bottom: rect.bottom,
              };
            }
          }
          return null;
        },
      });

      const scope = /** @type {{ __mc?: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc = probe;
    },
    { svgSource: ICON_SVG, rasterSource: ICON_RASTER },
  );
});

test.describe('приёмка по критериям готовности', () => {
  test('критерий 1: в package.json нет поля dependencies, и модуль грузится и работает без сборки', async ({ page, request }) => {
    // Первая половина критерия — про манифест, а не про страницу, поэтому читается
    // файлом, а не из DOM.
    const raw = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
    const manifest = JSON.parse(raw);

    expect('dependencies' in manifest, 'поля dependencies в манифесте нет').toBe(false);
    expect(
      'peerDependencies' in manifest || 'optionalDependencies' in manifest,
      'соседних полей с зависимостями тоже нет',
    ).toBe(false);
    // Контроль не тождества: `package.json` с одним только именем прошёл бы
    // проверку выше столь же хорошо, как и с настоящими dev-зависимостями.
    expect(
      Object.keys(manifest.devDependencies ?? {}).length,
      'devDependencies перечислены и не пусты',
    ).toBeGreaterThan(0);

    // Вторая половина: браузер грузит модуль прямо из исходника. Сборщика в
    // проекте нет, и если бы модуль требовал её, динамический импорт упал бы с
    // 404 — то есть ошибка была бы видна, а не замаскирована пустым экспортом.
    //
    // Спецификатор `../../src/index.js` в браузере схлопывается до `/src/index.js`
    // — корень статического сервера, — а TypeScript разрешает его от файла теста и
    // берёт типы из исходника. С ведущим слэшем модуль не находился бы вовсе.
    const served = await request.get('/src/index.js');
    expect(served.status(), 'исходник отдаётся сервером как есть').toBe(200);
    expect(served.headers()['content-type']).toContain('javascript');
    // Тело — исходник, а не артефакт сборки: единственная строка с `export` в
    // модуле обязана быть той же, что и в файле на диске.
    expect(await served.text()).toContain("export { MyContext } from './MyContext.js';");

    const used = await page.evaluate(async () => {
      const module = await import('../../src/index.js');
      if (typeof module.MyContext !== 'function') {
        throw new Error('экспорт MyContext не функция');
      }
      // Экземпляр строится и открывается прямо здесь: так проверяется не только
      // то, что файл разобрался, но и что вся цепочка импортов внутри него
      // (иконки, рендерер, слой, клавиатура, hover intent) доступна без сборки.
      const menu = new module.MyContext([{ label: 'Пункт' }], { label: 'Меню без сборки' });
      menu.open({ x: 40, y: 40 });
      const shown = document.querySelectorAll('.vc-menu:popover-open').length;
      const label = document.querySelector('.vc-menu:popover-open .vc-label');
      menu.destroy();
      return { exports: Object.keys(module).sort(), shown, label: label?.textContent ?? null };
    });

    expect(used.exports, 'наружу отдан ровно один экспорт').toEqual(['MyContext']);
    expect(used.shown, 'меню показано без единой строки сборки').toBe(1);
    expect(used.label, 'пункты отрисованы').toBe('Пункт');
  });

  test('критерий 2: меню не выходит за границы вьюпорта ни в одной точке сетки', async ({ page }) => {
    // Размер вьюпорта меняется до создания меню намеренно: `resize` — один из
    // глобальных событий закрытия, и смена размера после `attach` прогнала бы
    // закрытие по ещё не открытому меню.
    await page.setViewportSize(VIEWPORT);
    await makeMenu(page, 'grid');

    // Контроль до обхода: положение меню обязано зависеть от точки вызова. Иначе
    // обход ниже прошёл бы и на позиционере, который всегда ставит меню в один
    // и тот же угол.
    await openAt(page, { x: 0, y: 0 });
    const corner = await readMenu(page);
    expect(corner.levels[0].rect.left, 'у точки (0, 0) меню отжато к отступу')
      .toBe(SAFETY_PADDING);
    await openAt(page, { x: 400, y: 400 });
    const middle = await readMenu(page);
    expect(middle.levels[0].rect.left, 'у точки (400, 400) меню идёт за курсором')
      .toBeCloseTo(400 + CURSOR_OFFSET, 1);

    let points = 0;
    let measured = 0;
    for (const x of GRID_X) {
      for (const y of GRID_Y) {
        await openAt(page, { x, y });
        // Подменю открывается с первого пункта клавишей: у корня в этой точке
        // фокус уже стоит, и мышь в кейсе не нужна. Проверяется не только
        // положение корня — подменю считается по прямоугольнику пункта-владельца
        // и у правого края вьюпорта уезжает влево, то есть это независимая
        // геометрия.
        await page.keyboard.press('ArrowRight');
        const snapshot = await readMenu(page);
        const label = `точка (${x}, ${y})`;
        points += 1;
        expect(snapshot.openCount, `${label}: открыты корень и подменю`).toBe(2);
        expect(snapshot.errors, `${label}: страница без ошибок`).toEqual([]);

        for (const level of snapshot.levels) {
          if (!level.popoverOpen) {
            continue;
          }
          measured += 1;
          const where = `${label}, уровень ${level.id}`;
          expect(level.rect.left, `${where}: левее отступа`).toBeGreaterThanOrEqual(SAFETY_PADDING);
          expect(level.rect.top, `${where}: выше отступа`).toBeGreaterThanOrEqual(SAFETY_PADDING);
          expect(level.rect.right, `${where}: правее отступа`)
            .toBeLessThanOrEqual(VIEWPORT.width - SAFETY_PADDING);
          expect(level.rect.bottom, `${where}: ниже отступа`)
            .toBeLessThanOrEqual(VIEWPORT.height - SAFETY_PADDING);
        }
      }
    }

    // Обход обязан был что-то измерить: пустой счётчик означал бы, что цикл
    // прошёл ни одной точки и все утверждения выше были тождественны.
    expect(points, 'обход прошёл все точки сетки').toBe(GRID_X.length * GRID_Y.length);
    expect(measured, 'измерены оба уровня в каждой точке').toBe(points * 2);
  });

  test('критерий 3: вложенное меню открывается без ложных закрытий при диагональном движении', async ({ page }) => {
    await page.clock.install({ time: CLOCK_START_AT });
    await page.clock.pauseAt(CLOCK_FROZEN_AT);
    await makeMenu(page, 'diagonal');
    await openAt(page, DIAGONAL_POINT);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      const item = document.querySelector('.vc-item[aria-haspopup="menu"]');
      return item === null ? null : item.getAttribute('aria-owns');
    });
    expect(ownerId, 'у владельца зарезервирован адрес подменю').not.toBeNull();
    const submenuId = /** @type {string} */ (ownerId);

    await hoverItem(page, 'Ветка');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(isOpen(opened, submenuId), 'подменю открыто').toBe(true);

    // Первое плечо: курсор уходит с владельца вверх, на соседний пункт, — мимо
    // подменю. Здесь закрытие планируется, и план виден как «подменю ещё на
    // месте» при остановленных часах: срок закрытия ещё не наступил.
    await hoverItem(page, 'Соседний');
    expect(isOpen(await readMenu(page), submenuId), 'после ухода с владельца подменю на месте')
      .toBe(true);

    // Второе плечо — собственно диагональное движение: курсор идёт из пункта под
    // владельцем вверх и вправо, в подменю, то есть пересекает и соседний пункт, и
    // границу между уровнями. Именно на этом пути safe-triangle решает, ложное это
    // закрытие или нет.
    //
    // Один прыжок, без `steps`, и это не оформление: пока курсор вне подменю, каждая
    // точка планирует закрытие, а вход в подменю его снимает. Точек *внутри*
    // подменю у настоящего курсора ровно одна — та, на которой он пересёк границу, —
    // и дальше клин сужается лишь промахами, то есть движениями, уводящими курсор
    // прочь. Дробный путь через несколько точек внутри подменю проверял бы не
    // отсутствие ложных закрытий, а сужение клина, и ронял бы кейс на поведении,
    // которое `hoverIntent` объявляет намеренным.
    await hoverItem(page, 'Лист');
    expect(isOpen(await readMenu(page), submenuId), 'вход в подменю не закрывает его')
      .toBe(true);

    // Срок закрытия целиком проходит после последнего движения: подменю, которое
    // спасено входом, обязано пережить и его. Без этого утверждения кейс прошёл
    // бы на подменю, которое просто ещё не успело закрыться.
    await page.clock.fastForward(CLOSE_GRACE_MS * 2);
    const after = await readMenu(page);
    expect(isOpen(after, submenuId), 'подменю пережило диагональное движение').toBe(true);
    expect(after.openCount, 'открыты корень и подменю').toBe(2);
    expect(itemOf(after, 'Ветка').expanded, 'владелец всё ещё развёрнут').toBe('true');
    expect(after.errors, 'страница без ошибок').toEqual([]);

    // Контроль живости обратной половины: тот же выход в сторону, но без входа в
    // подменю, обязан его закрыть. Без этого шага «не закрылось» означало бы
    // «не закрывается никогда», и кейс проверял бы не движение, а отсутствие
    // механизма закрытия.
    await hoverItem(page, 'Соседний два');
    await page.clock.fastForward(CLOSE_GRACE_MS * 2);
    const closed = await readMenu(page);
    expect(isOpen(closed, submenuId), 'подменю закрыто, когда курсор ушёл в сторону').toBe(false);
    expect(closed.openCount, 'остался корень').toBe(1);
    expect(itemOf(closed, 'Ветка').expanded, 'отметка развёрнутости снята').toBeNull();
  });

  test('критерий 4: все три типа иконок работают, а лейблы соосны независимо от их наличия', async ({ page }) => {
    await makeMenu(page, 'icons');
    await openAt(page, ICON_POINT);

    const snapshot = await readMenu(page);
    expect(snapshot.errors, 'страница без ошибок').toEqual([]);
    expect(snapshot.openCount, 'меню открыто').toBe(1);

    // Каждый вид иконки обязан занять слот ровно одним узлом. Счёт узлов, а не
    // факт наличия узла: нераспознанный тип даёт `span.vc-icon-slot` внутри
    // слота, и «иконка есть» прошло бы на пустом месте.
    const emoji = itemOf(snapshot, 'Эмодзи');
    expect(emoji.iconTag, 'эмодзи — это span с символом').toBe('span');
    expect(emoji.iconChildren, 'в слоте эмодзи один узел').toBe(1);
    expect(emoji.iconText, 'эмодзи отрисован символом').toBe('📄');
    expect(emoji.iconHidden, 'эмодзи помечен декоративным').toBe('true');

    const vector = itemOf(snapshot, 'Вектор');
    expect(vector.iconTag, 'вектор — это узел svg').toBe('svg');
    expect(vector.iconChildren, 'в слоте вектора один узел').toBe(1);
    expect(vector.iconHidden, 'svg помечен декоративным').toBe('true');
    // Санитизация не выбрасывает содержимое: без этого «svg есть» означало бы
    // «вставился пустой прямоугольник».
    const pathCount = await page.evaluate(() => {
      return document.querySelectorAll('.vc-icon-slot > svg > path').length;
    });
    expect(pathCount, 'path внутри разобранной разметки сохранён').toBe(1);
    expect(vector.iconWidth, 'вектор отрисован').toBeGreaterThan(0);

    const raster = itemOf(snapshot, 'Растр');
    expect(raster.iconTag, 'растр — это img').toBe('img');
    expect(raster.iconChildren, 'в слоте растра один узел').toBe(1);
    // `naturalWidth` доказывает, что `src` дошёл до декодера: адрес, отброшенный
    // проверкой схемы, дал бы элемент без `src` и с нулевым `naturalWidth`, и
    // «растр есть» прошло бы на картинке, которой нет.
    const decoded = await page.evaluate(() => {
      const image = document.querySelector('.vc-icon-slot > img');
      if (!(image instanceof HTMLImageElement)) {
        throw new Error('img в слоте нет');
      }
      return { complete: image.complete, naturalWidth: image.naturalWidth, alt: image.alt };
    });
    expect(decoded.complete, 'картинка загружена').toBe(true);
    expect(decoded.naturalWidth, 'картинка декодирована').toBeGreaterThan(0);
    expect(decoded.alt, 'alt подставлен').toBe('Образец');

    // Соосность: колонка слота зарезервирована всегда, поэтому левая граница
    // лейбла у всех пунктов одна и та же — с иконкой любого вида, без иконки и у
    // отключённого пункта. Сравнение с первым пунктом как с эталоном: равенство
    // всех подряд не отличало бы «лейблы соосны» от «все лейблы одинаковы».
    const plain = itemOf(snapshot, 'Без иконки');
    expect(plain.iconChildren, 'у пункта без иконки слот пуст').toBe(0);
    const reference = emoji.labelLeft;
    for (const label of ['Вектор', 'Растр', 'Без иконки', 'Отключён', 'Тоже без иконки']) {
      expect(itemOf(snapshot, label).labelLeft, `лейбл «${label}» на одной колонке`)
        .toBe(reference);
    }
    // Соосность обязана быть видна и в разметке, а не только в расчёте: слот
    // есть у каждого пункта, и его ширина одинакова.
    const slotWidths = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.vc-icon-slot')).map((slot) => {
        return slot.getBoundingClientRect().width;
      });
    });
    expect(new Set(slotWidths).size, 'все слоты одной ширины').toBe(1);
  });

  test('критерий 5: меню полностью управляется с клавиатуры, а открывается программно', async ({ page }) => {
    await makeMenu(page, 'deep');
    await openAt(page, KEYBOARD_POINT);

    // Открытие — единственный шаг сделанный не клавишей, и это не оговорка, а
    // устройство API: `attach` слушает только `contextmenu`, а клавиатурного
    // способа вызвать его у API нет. Мышь ниже не используется ни разу, поэтому
    // весь обход принадлежит движку роуминга.
    const root = await readMenu(page);
    expect(root.openCount, 'меню открыто программно').toBe(1);
    expect(root.focusLabel, 'фокус на первом пункте').toBe('Открыть');

    // Четыре уровня вниз: `ArrowRight` на владельце открывает подменю и
    // переносит туда фокус. Показ одного уровня делал бы счётчик уровней
    // неразличимым, а «открылось подменю» — неотличимым от «открылся уровень».
    for (const expected of ['Недавние', 'Проект', 'Готово']) {
      await page.keyboard.press('ArrowRight');
      const step = await readMenu(page);
      expect(step.focusLabel, `фокус перешёл на «${expected}»`).toBe(expected);
    }
    const deep = await readMenu(page);
    expect(deep.openCount, 'открыты корень и три подменю').toBe(4);
    expect(deep.levels, 'заведены четыре уровня').toHaveLength(4);
    expect(deep.errors, 'страница без ошибок').toEqual([]);

    // `ArrowLeft` закрывает ровно один уровень и возвращает фокус на
    // пункт-владелец. Закрытие всей цепочки прошло бы мимо счётчика, а «фокус
    // где-то в меню» — мимо возврата.
    await page.keyboard.press('ArrowLeft');
    const back = await readMenu(page);
    expect(back.openCount, 'закрылся один уровень').toBe(3);
    expect(back.focusLabel, 'фокус на пункте-владельце').toBe('Проект');

    // И обратно: `ArrowRight` открывает тот же уровень снова, то есть закрытый
    // уровень не выбыл из дерева.
    await page.keyboard.press('ArrowRight');
    const again = await readMenu(page);
    expect(again.openCount, 'уровень открыт снова').toBe(4);
    expect(again.focusLabel, 'фокус снова в подменю').toBe('Готово');

    // Четыре `Escape` — четыре закрытия. Считается по одному нажатию, а не «в
    // конце ноль»: закрытие всей цепочки одним нажатием уменьшило бы счётчик
    // с четырёх сразу, и четыре шага ничего бы не доказывали.
    for (const remaining of [3, 2, 1, 0]) {
      await page.keyboard.press('Escape');
      const step = await readMenu(page);
      expect(step.openCount, `после Escape осталось ${remaining} уровней`).toBe(remaining);
    }
    const closed = await readMenu(page);
    expect(closed.focusId, 'фокус возвращён на контейнер').toBe('surface');
    expect(closed.focusLabel, 'фокус вне меню').toBeNull();

    // Открытие заново и активация: `Enter` на пункте без подменю зовёт его
    // действие и закрывает меню. Владелец подменю `Enter` только раскрывает, и
    // такой пункт активацией здесь и не считался бы.
    await openAt(page, KEYBOARD_POINT);
    await page.keyboard.press('ArrowDown');
    const onLeaf = await readMenu(page);
    expect(onLeaf.focusLabel, 'фокус на пункте без подменю').toBe('Копировать');
    await page.keyboard.press('Enter');
    const activated = await readMenu(page);
    expect(activated.log, 'действие пункта выполнено').toEqual(['копировать']);
    expect(activated.openCount, 'меню закрыто после активации').toBe(0);
    expect(activated.focusId, 'фокус возвращён на контейнер').toBe('surface');
    expect(activated.errors, 'страница без ошибок').toEqual([]);

    // Отдельное утверждение об отсутствии клавиатурного открытия: `attach` не
    // подписывается ни на `keydown`, ни на `keyup`, поэтому на привязанном
    // контейнере `Enter`, `Space` и `F10` не открывают меню. Это ровно то, о чём
    // сказано в README: клавиатурного способа вызвать открытие у API нет, и
    // `open({x, y})` — единственный программный путь.
    //
    // Клавиша контекстного меню и `Shift+F10` в список не входят: там событие
    // `contextmenu` порождает сам браузер по нажатию, и привязка ловит его просто
    // потому, что подписана на это событие. Поведение движковое, а не возможность
    // API, и оно расходится: Chromium синтезирует `contextmenu` и по Menu, и по
    // `Shift+F10`, а Firefox и WebKit не синтезируют ни по тому, ни по другому.
    // Проверять это здесь было бы проверкой движка, а не библиотеки.
    const before = await readMenu(page);
    expect(before.openCount, 'перед проверкой меню закрыто').toBe(0);
    await page.evaluate(() => {
      const container = document.getElementById('surface');
      if (container === null) {
        throw new Error('нет контейнера surface');
      }
      container.focus();
    });
    const focused = await page.evaluate(() => {
      return document.activeElement === null ? null : document.activeElement.id;
    });
    expect(focused, 'фокус стоит на привязанном контейнере').toBe('surface');
    for (const key of ['Enter', 'Space', 'F10']) {
      await page.keyboard.press(key);
    }
    const after = await readMenu(page);
    expect(after.openCount, 'клавиатура контейнер не открывает').toBe(0);
    // Журнал действий не вырос, а не «пуст»: выше тем же `Enter` была активация
    // пункта, и пустой список означал бы, что журнал обнулили, а не то, что
    // клавиши ничего не звали.
    expect(after.log, 'и действий не звали').toEqual(before.log);
  });

  test('критерий 6: при reducedMotion: reduce меню видно сразу и не анимируется', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await makeMenu(page, 'grid');
    await openAt(page, { x: 60, y: 60 });

    // Контроль без `reduce`: переходы у меню есть и идут. Без него проверки ниже
    // были бы тождественны — «анимируется» и «не анимируется» дали бы один и тот
    // же снимок на сломанной анимации и на отсутствующей.
    const animated = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.styles();
    });
    expect(animated.transitionProperty, 'без reduce переходы объявлены').not.toBe('none');
    expect(Number.parseFloat(animated.transitionDuration), 'без reduce длительность ненулевая')
      .toBeGreaterThan(0);
    expect(animated.transform, 'без reduce у меню есть трансформация').not.toBe('none');
    expect(animated.running, 'без reduce переходы идут').not.toEqual([]);
    // Инлайновый токен длительности записан всегда: `applyAnimationDuration`
    // вызывается на каждом уровне, и его наличие — условие того, что ниже
    // проверяет именно `reduce`, а не «длительность никто не задавал».
    expect(animated.durationToken.trim()).not.toBe('');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Закрытие и показ заново обязательны: входная анимация разбирается на показе,
    // и смена медиазапроса на уже показанном уровне не переигрывает её.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.close();
    });
    await openAt(page, { x: 60, y: 60 });

    const reduced = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.styles();
    });
    // «Видно сразу» — непрозрачность читается в том же задании, что и показ, до
    // какого-либо кадра: с `@starting-style` и ненулевой длительностью здесь
    // стоял бы ноль, и меню было бы не видно до конца перехода.
    expect(reduced.opacity, 'меню непрозрачно сразу после показа').toBe('1');
    // «Не анимируется» — переходы выключены классом свойств, а не укорочены, и
    // идущих переходов нет вовсе.
    expect(reduced.transitionProperty, 'переходы выключены').toBe('none');
    expect(reduced.transitionDuration, 'длительность нулевая').toBe('0s');
    expect(reduced.running, 'ни одного перехода не идёт').toEqual([]);
    expect(reduced.transform, 'трансформация снята').toBe('none');
    // Инлайновый токен на месте: обнулил его медиазапрос, а не вызов API.
    expect(reduced.durationToken.trim(), 'инлайновая длительность никуда не делась')
      .toBe(animated.durationToken.trim());

    // Второе утверждение критерия — не только вход, но и выход: под `reduce` слой
    // вызывает `hidePopover()` немедленно, без отложенной задачи. Проверяется
    // в том же снимке, в котором меню закрылось: с отложенностью счётчик
    // открытых уровней остался бы равен единице.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.close();
    });
    const hidden = await readMenu(page);
    expect(hidden.openCount, 'закрытие мгновенное, без ожидания анимации').toBe(0);
  });

  test('критерий 7: после destroy() в DOM не остаётся .vc-menu, и контейнер не реагирует на правый клик', async ({ page }) => {
    await makeMenu(page, 'grid');
    await page.mouse.click(ANCHOR_POINT.x, ANCHOR_POINT.y, { button: 'right' });
    await page.keyboard.press('ArrowRight');

    const before = await readMenu(page);
    expect(before.menuCount, 'до destroy() в документе два уровня').toBe(2);
    expect(before.openCount, 'оба уровня показаны').toBe(2);
    // Контроль живости привязки: правый клик по контейнеру подавляется. Без
    // этого шага «после destroy() не подавлен» означало бы «никогда не подавлен».
    expect(before.contextmenu, 'привязка подавила системное меню').toEqual([
      { container: 'surface', prevented: true },
    ]);

    // Повторный `destroy()` обязан быть безопасным: размонтирование вызывает его
    // не один раз, и ошибка во втором вызове была бы ошибкой вызывающего кода.
    // Ошибка упала бы внутрь `page.evaluate` и свалила бы кейс сам.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.destroy();
      scope.__mc.destroy();
    });

    const after = await readMenu(page);
    expect(after.menuCount, 'в документе не осталось ни одного уровня').toBe(0);
    expect(after.openCount, 'показанных уровней не осталось').toBe(0);
    expect(after.focusLabel, 'фокус не остался в удалённом меню').toBeNull();

    await page.mouse.click(ANCHOR_POINT.x, ANCHOR_POINT.y, { button: 'right' });
    const afterClick = await readMenu(page);
    // Журнал целиком, а не последняя запись: первая строка — контроль живости
    // привязки до `destroy()`, вторая — то же самое событие после. Различать надо
    // именно `prevented`, а не сам факт события: живой обработчик `contextmenu`
    // после `destroy()` тоже ничего не открывает — он смотрит на флаг
    // уничтожения, — и по одному лишь «меню не открылось» отличить снятый
    // слушатель от молчащего нельзя.
    expect(
      afterClick.contextmenu,
      'до destroy() привязка подавляла системное меню, после — нет',
    ).toEqual([
      { container: 'surface', prevented: true },
      { container: 'surface', prevented: false },
    ]);
    expect(afterClick.menuCount, 'контейнер не открыл меню').toBe(0);
    expect(afterClick.log, 'и действий не звал').toEqual([]);
  });
});
