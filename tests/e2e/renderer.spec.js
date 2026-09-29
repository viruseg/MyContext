import { expect, test } from '@playwright/test';
import {
  DEFAULT_CHEVRON_SIZE,
  DEFAULT_ICON_SIZE,
  DEFAULT_ITEM_HEIGHT,
  SAFETY_PADDING,
} from '../../src/constants.js';
import { resolveColor } from '../helpers/resolveColor.js';

// Модуль подгружается динамическим импортом прямо в странице, и спецификатор
// `../../src/renderer.js` обслуживает обе среды: в браузере от
// `http://127.0.0.1:4173/` он схлопывается до `/src/renderer.js` — корень сервера,
// — а TypeScript разрешает его от файла теста. Поэтому типы импорта берутся из
// исходника, без приведений.

/**
 * @typedef {import('../../src/renderer.js').MenuItem} MenuItem
 * @typedef {import('../../src/renderer.js').SeparatorItem} SeparatorItem
 * @typedef {import('../../src/icons.js').IconConfig} IconConfig
 */

const STYLESHEET_PATH = '/styles/mycontext.css';
const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <!-- Фон страницы задан явно: по умолчанию он прозрачный, и композит поверх
       прозрачного чёрного занижал бы измерения полупрозрачной подложки. -->
  <body style="background: rgb(255, 255, 255)">
    <div id="host"></div>
    <div id="host-2"></div>
  </body>
</html>`;

// Базовая подпись, из которой режутся длинные лейблы. Размеры заданы точно,
// а не «длинной строкой»: иначе длина зависела бы от шрифта и движка.
const LONG_SENTENCE = 'Очень длинный лейбл пункта меню, который обязан превратиться в многоточие';
const LABEL_400 = LONG_SENTENCE.repeat(7).slice(0, 400);
const LABEL_200 = LONG_SENTENCE.repeat(3).slice(0, 200);
const NARROW_LABEL = 'Копировать';

/** @type {IconConfig} */
const EMOJI = { type: 'emoji', value: '📄' };

/** @type {IconConfig} */
const SQUARE_SVG = {
  type: 'svg',
  value: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
    + '<path d="M2 2h12v12H2z" fill="currentColor"/></svg>',
};

/**
 * Фикстура уровня: пункт с иконкой и `id`, пункт без иконки, разделитель,
 * отключённый предикатом пункт и владелец подменю. Все четыре состояния,
 * которыми различаются пункты, в одном списке — иначе каждый кейс рисовал бы свой.
 *
 * Собирается в странице, а не передаётся аргументом `page.evaluate`: сериализация
 * туда не везёт функции, а `isEnabledAction` — функция. Заводится в `beforeEach`
 * на `globalThis.__vcFixture` и достаётся приведением внутри каждого кейса —
 * ровно так же, как проба слоя в `tests/e2e/layer.spec.js`.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function fixtureIn(page) {
  return page.evaluate(({ emoji }) => {
    const host = /** @type {{ __vcFixture?: () => Array<MenuItem | SeparatorItem> }} */ (
      /** @type {unknown} */ (globalThis)
    );
    host.__vcFixture = () => {
      return [
        { label: 'Открыть', id: 'open', icon: emoji },
        { label: 'Открыть в новом окне' },
        { type: 'separator' },
        { label: 'Копировать', id: 'copy', isEnabledAction: () => false },
        { label: 'Экспорт', id: 'export', submenu: [{ label: 'PDF' }, { label: 'PNG' }] },
      ];
    };
  }, { emoji: EMOJI });
}

test.beforeEach(async ({ page }) => {
  // `goto` обязателен перед `setContent`: без него у документа нет адреса, и ни
  // ссылка на таблицу стилей, ни динамический импорт не разрешились бы.
  await page.goto('/');
  await page.setContent(PAGE_HTML);
  // Живая таблица стилей ещё могла не примениться, и `getComputedStyle` вернул бы
  // пустые значения — кейс упал бы не по существу.
  await page.waitForFunction(
    (path) => {
      return Array.from(document.styleSheets).some((sheet) => {
        return sheet.href !== null && sheet.href.endsWith(path) && sheet.cssRules.length > 0;
      });
    },
    STYLESHEET_PATH,
    { timeout: 5000 },
  );
  // `reduce` обнуляет `transform` у меню, а `scale(0.96)` исказил бы любой
  // `getBoundingClientRect`. Без этого кейсы на геометрию меряли бы недовыведенное
  // меню и падали бы по таймауту в зависимости от того, успела ли анимация кончиться.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixtureIn(page);
});

test.describe('пункт', () => {
  test('role=menuitem, tabindex=-1, data-active отсутствует', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const host = /** @type { { __vcFixture: () => Array<MenuItem | SeparatorItem> } } */ (
        /** @type { unknown } */ (globalThis)
      );
      const levelItems = host.__vcFixture();
      const { renderLevel } = await import('../../src/renderer.js');
      const level = renderLevel(levelItems, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      const item = level.items[0];
      return {
        role: item.element.getAttribute('role'),
        className: item.element.className,
        tabindex: item.element.getAttribute('tabindex'),
        // Активность ставит движок роуминга, а не рендерер: на момент сборки
        // активен ни один пункт.
        active: item.element.hasAttribute('data-active'),
        key: item.key,
        focusable: item.focusable,
        hasSubmenu: item.hasSubmenu,
        label: item.element.querySelector('.vc-label')?.textContent,
        // Шеврон есть только у владельцев подменю, поэтому у первого пункта его
        // нет даже при зарезервированной колонке.
        children: Array.from(item.element.children, (child) => {
          return child.className;
        }),
      };
    });

    // Сравнение по всему набору, а не по отдельным полям: пропуск любого
    // атрибута или класса здесь роняет кейс, а не остаётся незамеченным.
    expect(result).toEqual({
      role: 'menuitem',
      className: 'vc-item',
      tabindex: '-1',
      active: false,
      key: 'vc-level-0:0',
      focusable: true,
      hasSubmenu: false,
      label: 'Открыть',
      children: ['vc-icon-slot', 'vc-label'],
    });
  });

  test('isEnabledAction вернул false: aria-disabled=true, tabindex=-1, в items помечен focusable=false', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const host = /** @type { { __vcFixture: () => Array<MenuItem | SeparatorItem> } } */ (
        /** @type { unknown } */ (globalThis)
      );
      const levelItems = host.__vcFixture();
      const { renderLevel } = await import('../../src/renderer.js');
      const level = renderLevel(levelItems, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      // Индекс 3 — отключённый предикатом пункт фикстуры, после разделителя.
      const item = level.items[3];
      return {
        role: item.element.getAttribute('role'),
        ariaDisabled: item.element.getAttribute('aria-disabled'),
        // `disabled` у `div` не имеет смысла и не выключает ничего: это не
        // кнопка, а `role="menuitem"`.
        disabledAttribute: item.element.hasAttribute('disabled'),
        tabindex: item.element.getAttribute('tabindex'),
        focusable: item.focusable,
        // Отключённый пункт обязан выпасть из focusable-списка, иначе роуминг
        // встал бы на него.
        inFocusableList: level.items.filter((entry) => {
          return entry.focusable;
        }).includes(item),
      };
    });

    expect(result).toEqual({
      role: 'menuitem',
      ariaDisabled: 'true',
      disabledAttribute: false,
      tabindex: '-1',
      focusable: false,
      inFocusableList: false,
    });
  });

  test('isEnabledAction без поля и с возвратом true оставляют пункт доступным', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      const level = renderLevel([
        { label: 'Без предиката' },
        { label: 'Вернул true', isEnabledAction: () => true },
      ], {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      return level.items.map((item) => {
        return {
          focusable: item.focusable,
          ariaDisabled: item.element.getAttribute('aria-disabled'),
        };
      });
    });

    // Поле опционально, и его отсутствие — не повод гасить пункт: иначе автор,
    // не задавший предикат вовсе, получил бы меню из мёртвых строк.
    expect(result).toEqual([
      { focusable: true, ariaDisabled: null },
      { focusable: true, ariaDisabled: null },
    ]);
  });

  test('isEnabledAction, вернувший не-булево, отключает пункт', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      // Пункты заходят через `unknown`: предикаты здесь возвращают не `boolean`,
      // и тип их бы отверг — а проверяется ровно то, как рендерер ведёт себя с
      // таким возвратом. Приведение ничего не скрывает: решение принимает
      // рендерер во время выполнения, а не компилятор.
      const items = /** @type {Array<MenuItem>} */ (/** @type {unknown} */ ([
        { label: 'Без возврата', isEnabledAction: () => {} },
        { label: 'Строка', isEnabledAction: () => 'да' },
        { label: 'Единица', isEnabledAction: () => 1 },
      ]));
      const level = renderLevel(items, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      return level.items.map((item) => {
        return {
          focusable: item.focusable,
          ariaDisabled: item.element.getAttribute('aria-disabled'),
        };
      });
    });

    // Сравнение строгое, `=== true`. Не-булево — это не «достаточно истинно»,
    // а предикат, который не ответил на заданный вопрос: забытый `return` у
    // автора гасит пункт, и он видит причину, а не молча работающее меню.
    expect(result).toEqual([
      { focusable: false, ariaDisabled: 'true' },
      { focusable: false, ariaDisabled: 'true' },
      { focusable: false, ariaDisabled: 'true' },
    ]);
  });

  test('isEnabledAction вызван при сборке ровно один раз на пункт', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      const calls = [];
      renderLevel([
        { label: 'Первый', isEnabledAction: () => { calls.push(1); return true; } },
        { label: 'Второй' },
      ], {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      return calls.length;
    });

    // Предикат — решение об одном пункте, и оно принимается один раз на сборку.
    // Показов будет много, вызовов на первой сборке быть не должно два.
    expect(result).toBe(1);
  });

  test('с подменю: aria-haspopup=menu, aria-expanded=false, data-chevron=right', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const host = /** @type { { __vcFixture: () => Array<MenuItem | SeparatorItem> } } */ (
        /** @type { unknown } */ (globalThis)
      );
      const levelItems = host.__vcFixture();
      const { renderLevel } = await import('../../src/renderer.js');
      const level = renderLevel(levelItems, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      // Индекс 4 — владелец подменю, последний пункт фикстуры.
      const item = level.items[4];
      return {
        role: item.element.getAttribute('role'),
        haspopup: item.element.getAttribute('aria-haspopup'),
        expanded: item.element.getAttribute('aria-expanded'),
        chevron: item.element.getAttribute('data-chevron'),
        hasSubmenu: item.hasSubmenu,
        // Владелец подменю — обычный доступный пункт: `focusable` зависит только
        // от `isEnabledAction`.
        focusable: item.focusable,
        key: item.key,
        chevrons: item.element.querySelectorAll('.vc-chevron').length,
        children: Array.from(item.element.children, (child) => {
          return child.className;
        }),
        owns: item.element.getAttribute('aria-owns'),
      };
    });

    expect(result).toEqual({
      role: 'menuitem',
      // `true` — синоним по ARIA 1.2, но `menu` точнее, и axe различает эти
      // значения.
      haspopup: 'menu',
      expanded: 'false',
      chevron: 'right',
      hasSubmenu: true,
      focusable: true,
      key: 'vc-level-0:4',
      chevrons: 1,
      children: ['vc-icon-slot', 'vc-label', 'vc-chevron'],
      owns: 'vc-level-0-sub-4',
    });
  });

  test('разделитель: role=separator и aria-orientation=horizontal, в focusable-список не попадает', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const host = /** @type { { __vcFixture: () => Array<MenuItem | SeparatorItem> } } */ (
        /** @type { unknown } */ (globalThis)
      );
      const levelItems = host.__vcFixture();
      const { renderLevel } = await import('../../src/renderer.js');
      const actions = new Map();
      const level = renderLevel(levelItems, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions,
      });
      // Индекс 2 — разделитель фикстуры.
      const item = level.items[2];
      return {
        role: item.element.getAttribute('role'),
        orientation: item.element.getAttribute('aria-orientation'),
        className: item.element.className,
        // Разделитель не получает `tabindex` вовсе: `-1` был бы числом в
        // никуда, а `0` сделал бы его целью табуляции.
        tabindex: item.element.hasAttribute('tabindex'),
        // Позиция в не-разделительном ряду разделителю не принадлежит.
        ariaLevel: item.element.hasAttribute('aria-level'),
        ariaSetSize: item.element.hasAttribute('aria-setsize'),
        ariaPosInSet: item.element.hasAttribute('aria-posinset'),
        focusable: item.focusable,
        hasSubmenu: item.hasSubmenu,
        key: item.key,
        inFocusableList: level.items.filter((entry) => {
          return entry.focusable;
        }).includes(item),
        children: item.element.children.length,
        // Ключа нет — значит, нет и записи в общей карте активов.
        separatorKeyed: actions.has('vc-level-0:2'),
      };
    });

    expect(result).toEqual({
      role: 'separator',
      orientation: 'horizontal',
      className: 'vc-separator',
      tabindex: false,
      ariaLevel: false,
      ariaSetSize: false,
      ariaPosInSet: false,
      focusable: false,
      hasSubmenu: false,
      key: null,
      inFocusableList: false,
      children: 0,
      separatorKeyed: false,
    });
  });
});

test.describe('нумерация уровня', () => {
  test('aria-level равен levelIndex плюс один', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const host = /** @type { { __vcFixture: () => Array<MenuItem | SeparatorItem> } } */ (
        /** @type { unknown } */ (globalThis)
      );
      const levelItems = host.__vcFixture();
      const { renderLevel } = await import('../../src/renderer.js');
      /**
       * @param {number} levelIndex
       * @returns {string | null}
       */
      const readAriaLevel = (levelIndex) => {
        const level = renderLevel(levelItems, {
          levelIndex,
          menuId: `vc-level-${levelIndex}`,
          label: 'Меню файла',
          actions: new Map(),
        });
        return level.items[0].element.getAttribute('aria-level');
      };
      return {
        root: readAriaLevel(0),
        second: readAriaLevel(1),
        third: readAriaLevel(2),
      };
    });

    // `aria-level` начинается с 1, а `levelIndex` — с 0: корневое меню обязано
    // объявить себя первым уровнем, иначе скринридер считает вложенность не
    // с того места.
    expect(result).toEqual({ root: '1', second: '2', third: '3' });
  });

  test('aria-setsize и aria-posinset считаются без разделителей', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      /** @type {Array<MenuItem | SeparatorItem>} */
      const items = [
        { label: 'Первый' },
        { label: 'Второй' },
        { type: 'separator' },
        { label: 'Третий' },
      ];
      const level = renderLevel(items, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      // Узлы пунктов без разделителя: `level.items` содержит и его, а вопрос
      // именно про то, что попало в счёт.
      const menuItems = level.items
        .filter((entry) => {
          return entry.element.classList.contains('vc-item');
        })
        .map((entry) => {
          return entry.element;
        });
      return {
        setSize: menuItems.map((element) => {
          return element.getAttribute('aria-setsize');
        }),
        posInSet: menuItems.map((element) => {
          return element.getAttribute('aria-posinset');
        }),
        // Ключ внутренний — `menuId` и позиция в исходном массиве, а не позиция
        // в не-разделительном ряду: сдвиг разделителя не обязан двигать ключ
        // соседних пунктов.
        keys: level.items.map((entry) => {
          return entry.key;
        }),
      };
    });

    // С разделителем «3 из 5» скринридер объявил бы позицию, которой в меню
    // нет, поэтому в счёт идут только пункты.
    expect(result).toEqual({
      setSize: ['3', '3', '3'],
      posInSet: ['1', '2', '3'],
      keys: ['vc-level-0:0', 'vc-level-0:1', null, 'vc-level-0:3'],
    });
  });

  test('renderItem вне уровня: aria-setsize из аргумента, ключ из menuId, aria-posinset достаёт уровень', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderItem } = await import('../../src/renderer.js');
      const item = renderItem(
        { label: 'Одинокий' },
        { levelIndex: 2, menuId: 'vc-level-2', actions: new Map() },
        7,
        5,
      );
      return {
        role: item.element.getAttribute('role'),
        ariaLevel: item.element.getAttribute('aria-level'),
        ariaSetSize: item.element.getAttribute('aria-setsize'),
        ariaPosInSet: item.element.hasAttribute('aria-posinset'),
        key: item.key,
        focusable: item.focusable,
      };
    });

    // Позицию в не-разделительном ряду знает только уровень: число разделителей
    // перед пунктом внутри `renderItem` недоступно, поэтому `aria-posinset`
    // проставляет `renderLevel`, а одиночный вызов остаётся без него.
    //
    // Ключ при этом `menuId` содержит, хотя `levelIndex` равно 2: идентификатор
    // уровня, а не его глубина — иначе два экземпляра на странице столкнулись бы
    // на корневых пунктах.
    expect(result).toEqual({
      role: 'menuitem',
      ariaLevel: '3',
      ariaSetSize: '5',
      ariaPosInSet: false,
      key: 'vc-level-2:7',
      focusable: true,
    });
  });
});

test.describe('сетка пункта', () => {
  test('иконки: слот сохраняет ширину --vc-icon-size независимо от вида иконки', async ({ page }) => {
    const result = await page.evaluate(async (square) => {
      const { renderLevel } = await import('../../src/renderer.js');
      /** @type {Array<MenuItem | SeparatorItem>} */
      const items = [
        { label: 'Svg', icon: square },
        { label: 'Эмодзи', icon: { type: 'emoji', value: '📄' } },
        { label: 'Без иконки' },
      ];
      const level = renderLevel(items, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      const host = /** @type {HTMLElement} */ (document.getElementById('host'));
      host.replaceChildren(level.element);
      level.element.showPopover();
      /**
       * @param {number} index
       * @returns {HTMLElement}
       */
      const slotOf = (index) => {
        return /** @type {HTMLElement} */ (
          level.items[index].element.querySelector('.vc-icon-slot')
        );
      };
      /**
       * @param {HTMLElement} slot
       * @returns {number}
       */
      const widthOf = (slot) => {
        return Number.parseFloat(getComputedStyle(slot).width);
      };
      return {
        svg: widthOf(slotOf(0)),
        emoji: widthOf(slotOf(1)),
        empty: widthOf(slotOf(2)),
        // Контроль: без него равенство ширин прошло бы и при пункте, у которого
        // иконка так и не отрисовалась, — то есть проверяло бы пустоту.
        svgChildren: slotOf(0).childElementCount,
        svgClass: slotOf(0).firstElementChild?.getAttribute('class'),
        emojiText: slotOf(1).textContent,
        emptyChildren: slotOf(2).childElementCount,
      };
    }, SQUARE_SVG);

    expect(result.svg).toBe(DEFAULT_ICON_SIZE);
    expect(result.emoji).toBe(DEFAULT_ICON_SIZE);
    // Место под иконку зарезервировано всегда: без этого лейблы пунктов с
    // иконкой и без разъезжались бы по X.
    expect(result.empty).toBe(DEFAULT_ICON_SIZE);
    expect(result.svg).toBe(result.empty);
    expect(result.svgChildren).toBe(1);
    // У svg-узла класса нет — оформляет его слот, — и рендерер класс не
    // дорисовывает.
    expect(result.svgClass).toBe(null);
    expect(result.emojiText).toBe('📄');
    expect(result.emptyChildren).toBe(0);
  });

  test('иконки: у пункта без подменю колонка шеврона сохраняет ширину --vc-chevron-size', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      /** @type {Array<MenuItem | SeparatorItem>} */
      const items = [
        { label: 'Владелец', submenu: [{ label: 'PDF' }] },
        { label: 'Обычный' },
      ];
      const level = renderLevel(items, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      const host = /** @type {HTMLElement} */ (document.getElementById('host'));
      host.replaceChildren(level.element);
      level.element.showPopover();
      /**
       * Третья колонка сетки — зарезервированное место шеврона. У пункта без
       * подменю самого шеврона нет, поэтому резервирование видно только по
       * дорожке: она объявлена на каждом пункте независимо от содержимого.
       *
       * @param {HTMLElement} item
       * @returns {number}
       */
      const chevronColumn = (item) => {
        const columns = getComputedStyle(item).gridTemplateColumns.split(' ');
        return Number.parseFloat(columns[columns.length - 1] ?? '0');
      };
      const owner = level.items[0].element;
      const plain = level.items[1].element;
      const chevron = /** @type {HTMLElement} */ (owner.querySelector('.vc-chevron'));
      return {
        ownerColumn: chevronColumn(owner),
        plainColumn: chevronColumn(plain),
        ownerChevronWidth: Number.parseFloat(getComputedStyle(chevron).width),
        // У пункта без подменю шеврона в разметке нет: колонку держит дорожка
        // сетки, а не пустой элемент.
        plainChevrons: plain.querySelectorAll('.vc-chevron').length,
        ownerChevrons: owner.querySelectorAll('.vc-chevron').length,
      };
    });

    expect(result.ownerColumn).toBe(DEFAULT_CHEVRON_SIZE);
    expect(result.plainColumn).toBe(DEFAULT_CHEVRON_SIZE);
    // Занятое на экране место, а не только объявленное в стилях: иначе
    // дорожка была бы схлопнутой, и открытие подменю сдвинуло бы лейблы.
    expect(result.ownerChevronWidth).toBe(DEFAULT_CHEVRON_SIZE);
    expect(result.plainChevrons).toBe(0);
    expect(result.ownerChevrons).toBe(1);
  });

  test('иконки: лейблы с иконкой и без совпадают по координате X', async ({ page }) => {
    const result = await page.evaluate(async ({ iconSize }) => {
      const fixtures = /** @type { { __vcFixture: () => Array<MenuItem | SeparatorItem> } } */ (
        /** @type { unknown } */ (globalThis)
      );
      const { renderLevel } = await import('../../src/renderer.js');
      const level = renderLevel(fixtures.__vcFixture(), {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      const host = /** @type {HTMLElement} */ (document.getElementById('host'));
      host.replaceChildren(level.element);
      level.element.showPopover();
      /**
       * Координата, выведенная из геометрии сетки, а не из второго пункта:
       * равенство «левая граница лейбла у пункта с иконкой равна такой же у
       * пункта без» прошло бы и при `grid-template-columns` без иконной дорожки,
       * потому что тогда оба лейбла начинались бы в одном месте — просто в
       * другом. Опора на `padding + дорожка иконки + зазор` такой провал
       * ловит.
       *
       * Одной опоры на координату мало: дорожки иконки и шеврона — ровно 16 и
       * 12 px, и лейбл, задвинутый в освободившуюся 12-пиксельную, встал бы в ту
       * же самую координату. Поэтому числом колонок закрепляется и сам порядок:
       * лейбл обязан быть второй дорожкой, а не третьей.
       *
       * @param {number} index
       * @returns {{ labelX: number, expectedX: number, tracks: number[], labelWidth: number }}
       */
      const labelPlace = (index) => {
        const item = level.items[index].element;
        const label = /** @type {HTMLElement} */ (item.querySelector('.vc-label'));
        const style = getComputedStyle(item);
        return {
          labelX: label.getBoundingClientRect().x,
          expectedX: item.getBoundingClientRect().x
            + Number.parseFloat(style.paddingLeft)
            + iconSize
            + Number.parseFloat(style.columnGap),
          tracks: style.gridTemplateColumns.split(' ').map(Number.parseFloat),
          labelWidth: label.getBoundingClientRect().width,
        };
      };
      return {
        // Индексы 0 и 1 фикстуры: с иконкой и без.
        withIcon: labelPlace(0),
        withoutIcon: labelPlace(1),
      };
    }, { iconSize: DEFAULT_ICON_SIZE });

    // Сравнение с допуском в тысячную долю пикселя: дорожка приходит из
    // `grid-template-columns` с округлением до трёх знаков, а габарит лейбла —
    // из `getBoundingClientRect` без него, и посимвольное `toBe` ловило бы
    // движение в 10⁻⁴ px, а не сдвиг колонки.
    expect(result.withIcon.labelX).toBeCloseTo(result.withIcon.expectedX, 3);
    // Слот зарезервирован, поэтому у пункта без иконки координата та же самая, а
    // не «какая получится».
    expect(result.withoutIcon.labelX).toBeCloseTo(result.withoutIcon.expectedX, 3);
    expect(result.withIcon.labelX).toBe(result.withoutIcon.labelX);
    // Три дорожки в фиксированном порядке, и лейбл — средняя, тянущаяся: с двумя
    // дорожками лейбл встал бы в 12-пиксельную колонку шеврона, и координата его
    // левой границы от сдвига не изменилась бы.
    for (const place of [result.withIcon, result.withoutIcon]) {
      expect(place.tracks).toHaveLength(3);
      expect(place.tracks[0]).toBe(DEFAULT_ICON_SIZE);
      expect(place.tracks[2]).toBe(DEFAULT_CHEVRON_SIZE);
      expect(place.labelWidth).toBeCloseTo(place.tracks[1], 3);
      expect(place.labelWidth).toBeGreaterThan(DEFAULT_ICON_SIZE);
    }
  });

  test('шеврон что-то рисует: у ::before есть ненулевая толщина рамки', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      const level = renderLevel([{ label: 'Экспорт', submenu: [{ label: 'PDF' }] }], {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      const host = /** @type {HTMLElement} */ (document.getElementById('host'));
      host.replaceChildren(level.element);
      level.element.showPopover();
      const chevron = /** @type {HTMLElement} */ (
        level.items[0].element.querySelector('.vc-chevron')
      );
      // Активную строку помечает движок роуминга, а не рендерер, поэтому здесь
      // состояние задаётся руками — как в фикстуре `theme.spec.js`.
      const item = level.items[0].element;
      item.dataset.active = '';
      // Псевдоэлемент читается только через `getComputedStyle` со вторым
      // аргументом: в разметке его нет, и `querySelector` его не увидит.
      const glyph = getComputedStyle(chevron, '::before');
      /**
       * Угол поворота из матрицы, знаком. Без знака утверждение было бы
       * неполным: `rotate(45deg)` даёт ту же величину в 45°, и стрелка смотрела
       * бы вниз.
       *
       * @param {string} transform вычисленное значение `transform`.
       * @returns {number} угол в радианах, −π..π.
       */
      const angleOf = (transform) => {
        const parts = /matrix\(([^)]+)\)/.exec(transform);
        if (parts === null) {
          return Number.NaN;
        }
        const numbers = /** @type {string[]} */ (/** @type {unknown} */ (parts))[1]
          .split(',')
          .map((part) => Number(part.trim()));
        return Math.atan2(numbers[1] ?? 0, numbers[0] ?? 1);
      };
      return {
        // Псевдоэлемент обязан быть порождён, иначе все остальные значения были
        // бы начальными, а не вычисленными.
        content: glyph.content,
        widths: [glyph.borderTopWidth, glyph.borderRightWidth,
          glyph.borderBottomWidth, glyph.borderLeftWidth].map(Number.parseFloat),
        styles: [glyph.borderTopStyle, glyph.borderRightStyle,
          glyph.borderBottomStyle, glyph.borderLeftStyle],
        colors: [glyph.borderTopColor, glyph.borderRightColor,
          glyph.borderBottomColor, glyph.borderLeftColor],
        size: [Number.parseFloat(glyph.width), Number.parseFloat(glyph.height)],
        // Угол со знаком: диагональ срезанного угла при `−45°` смотрит вправо,
        // при `+45°` — вниз, при `−90°` — вверх. Одна только величина угла эти
        // три варианта не различила бы.
        angle: angleOf(glyph.transform),
        // Глиф обязан быть цвета шеврона: `currentColor` переносит на него любой
        // цвет, который тема задаст `.vc-chevron`.
        color: glyph.borderRightColor,
        // Токен приглушённого цвета, разрешённый общим для проекта `resolveColor`:
        // сравнивать с записью токена было бы тождеством. Равенство
        // `color === muted` тоже не тождество — без `color: var(--vc-muted)` в
        // `.vc-chevron` стрелка унаследовала бы `--vc-text` пункта.
        mutedToken: getComputedStyle(item).getPropertyValue('--vc-muted'),
      };
    });
    const muted = await resolveColor(page, result.mutedToken);

    expect(result.content, 'порождён ли ::before').not.toBe('none');
    // Рамка непустая, видимая и покрывает ровно две соседние стороны: диагональ
    // срезанного угла и есть глиф. Толщина без `style: solid` нарисовала бы
    // ровно ничего.
    const drawn = result.widths
      .map((width, index) => {
        return width > 0 && result.styles[index] === 'solid' ? index : -1;
      })
      .filter((index) => {
        return index > -1;
      });
    expect(drawn).toEqual([1, 2]);
    for (const color of result.colors) {
      expect(color, `цвет рамки ${color}`).not.toBe('rgba(0, 0, 0, 0)');
    }
    // Квадрат, иначе угол получится не 45°, а что-то другое.
    expect(result.size[0]).toBe(result.size[1]);
    // Знак поворота и есть направление стрелки; величина в 45° получена
    // поворотом срезанного угла квадрата, а не его формой.
    expect(result.angle).toBeCloseTo(-Math.PI / 4, 5);
    // Приглушённый цвет и на активной строке: заливка тонированная, шеврон внутри
    // неё остаётся тем же, что и в любом другом пункте, и контракт строки задаёт
    // её текст, а не стрелка.
    expect(result.color).toBe(muted);
  });

  test('шеврон реально разворачивается: transform в состояниях left и right различаются', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      const level = renderLevel([
        { label: 'Вправо', submenu: [{ label: 'A' }] },
        { label: 'Влево', submenu: [{ label: 'B' }] },
      ], {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      const host = /** @type {HTMLElement} */ (document.getElementById('host'));
      host.replaceChildren(level.element);
      level.element.showPopover();
      /**
       * Угол поворота из вычисленного `transform`. Сравнение строк вида
       * `matrix(1, 0, 0, 1, 0, 0)` против `matrix(-1, 0, 0, -1, 0, 0)` годно и
       * для пустого шеврона, поэтому утверждение делается об угле: развернутый
       * глиф обязан отличаться от базового на 180°, а не «быть не тождественным».
       *
       * Два движка хранят матрицу поворота на 180° точно, третий оставляет
       * остаточные `-1.2e-16` вместо нуля, и угол приходит то `-π`, то `+π`.
       * Знак нормализуется, иначе утверждение зависело бы от версии движка.
       *
       * @param {string} transform вычисленное значение `transform`.
       * @returns {number} угол в радианах, 0..2π.
       */
      const angleOf = (transform) => {
        const parts = /matrix\(([^)]+)\)/.exec(transform);
        // База без объявленного поворота — тождественное преобразование, а не
        // «нет преобразования»: глиф повёрнут внутри себя, на 45° рамками.
        if (parts === null) {
          return 0;
        }
        const numbers = /** @type {string[]} */ (/** @type {unknown} */ (parts))[1]
          .split(',')
          .map((part) => Number(part.trim()));
        const angle = Math.atan2(numbers[1] ?? 0, numbers[0] ?? 1);
        return angle < 0 ? angle + 2 * Math.PI : angle;
      };
      const right = /** @type {HTMLElement} */ (
        level.items[0].element.querySelector('.vc-chevron')
      );
      const left = /** @type {HTMLElement} */ (
        level.items[1].element.querySelector('.vc-chevron')
      );
      // `data-chevron="left"` ставит движок позициониции (задача 8), когда
      // подменю пришлось открыть слева. Здесь состояние задаётся руками: кейс
      // проверяет разворот, а не то, кто его инициировал.
      level.items[1].element.dataset.chevron = 'left';
      return {
        rightAttribute: level.items[0].element.getAttribute('data-chevron'),
        leftAttribute: level.items[1].element.getAttribute('data-chevron'),
        right: angleOf(getComputedStyle(right).transform),
        left: angleOf(getComputedStyle(left).transform),
      };
    });

    // Состояния действительно разные, иначе поворот не о чем было бы читать.
    expect(result.rightAttribute).toBe('right');
    expect(result.leftAttribute).toBe('left');
    // Базовое состояние — стрелка вправо, то есть без поворота: глиф повернут
    // внутри себя, на 45° рамками квадрата.
    expect(result.right).toBeCloseTo(0, 5);
    expect(result.left).toBeCloseTo(Math.PI, 5);
    expect(Math.abs(result.right - result.left)).toBeCloseTo(Math.PI, 5);
  });

  test('длинный лейбл уходит в многоточие, а ширина меню не растёт', async ({ page }) => {
    // Вьюпорт сужается намеренно: при широком вьюпорте меню с длинным лейблом
    // разошлось бы на всю длину подписи, многоточие не сработало бы вовсе, и
    // кейс проверял бы только `max-width`. Обе фикстуры обязаны упереться в одно
    // ограничение, и тогда равенство ширин говорит именно то, что проверяется:
    // длина подписи не выводит меню за предел.
    await page.setViewportSize({ width: 360, height: 640 });
    const result = await page.evaluate(async ({ long, short, narrow, padding }) => {
      const { renderLevel } = await import('../../src/renderer.js');
      /**
       * @param {string} hostId
       * @param {Array<MenuItem | SeparatorItem>} items
       * @returns {import('../../src/renderer.js').RenderedLevel}
       */
      const open = (hostId, items) => {
        const level = renderLevel(items, {
          levelIndex: 0,
          menuId: 'vc-level-0',
          label: 'Меню файла',
          actions: new Map(),
        });
        /** @type {HTMLElement} */ (document.getElementById(hostId))
          .replaceChildren(level.element);
        level.element.showPopover();
        return level;
      };
      // Все меню остаются в документе до конца замера: узел, не вставленный в
      // документ, не имеет габаритов, и `scrollWidth` у его лейбла совпал бы с
      // `clientWidth` — многоточие выглядело бы сработавшим, не сработав.
      const longLevel = open('host', [{ label: long }]);
      // Третье меню — короткая подпись. Оно умещается в предел целиком, и
      // поэтому отвечает на вопрос, на который равенство ниже ответить не может:
      // ширина идёт за содержимым, а предел остаётся пределом.
      const narrowWidth = open('host-2', [{ label: narrow }]).element
        .getBoundingClientRect().width;
      const shortWidth = open('host-2', [{ label: short }]).element
        .getBoundingClientRect().width;
      const label = /** @type {HTMLElement} */ (
        longLevel.items[0].element.querySelector('.vc-label')
      );
      return {
        longWidth: longLevel.element.getBoundingClientRect().width,
        shortWidth,
        narrowWidth,
        // `SAFETY_PADDING` приходит из импорта снаружи, а не переписывается
        // здесь константой: расхождение двух записанных чисел было бы незаметным.
        limit: window.innerWidth - 2 * padding,
        // Многоточие обязано именно сработать: подрезанный по дорожке лейбл —
        // это и есть признак, что `min-width: 0` на месте.
        clipped: label.scrollWidth > label.clientWidth,
        ellipsis: getComputedStyle(label).textOverflow,
        whiteSpace: getComputedStyle(label).whiteSpace,
        itemHeight: longLevel.items[0].element.getBoundingClientRect().height,
      };
    }, { long: LABEL_400, short: LABEL_200, narrow: NARROW_LABEL, padding: SAFETY_PADDING });

    expect(result.clipped).toBe(true);
    expect(result.ellipsis).toBe('ellipsis');
    expect(result.whiteSpace).toBe('nowrap');
    // Строка не выросла: `height`, а не `min-height`, держит пункт.
    expect(result.itemHeight).toBe(DEFAULT_ITEM_HEIGHT);
    expect(result.limit).toBe(360 - 2 * SAFETY_PADDING);
    // Оба меню упёрлись в `max-width`, и длина подписи на это не повлияла.
    expect(result.longWidth).toBe(result.limit);
    expect(result.shortWidth).toBe(result.limit);
    // Равенство ширин выше — слепое: его прошло бы и меню с фиксированной
    // шириной в `100dvw - 2 * padding`. Опора одна — короткая подпись умещается
    // в предел целиком, то есть предел остаётся пределом, а ширина идёт за
    // содержимым. Обратное утверждение (`longWidth` строго уже предела)
    // невозможно вместе с `clipped`: лейбл обрезается ровно тогда, когда меню
    // упёрлось в `max-width`, иначе строка `1fr` дорожки равнялась бы
    // max-content лейбла и обрезать было бы нечего.
    expect(result.narrowWidth).toBeLessThan(result.limit);
    expect(result.longWidth).toBeGreaterThan(result.narrowWidth);
  });

  test('колонки не сдвигаются: ширина меню одинакова для пунктов с иконкой и без', async ({ page }) => {
    const result = await page.evaluate(async ({ square, padding }) => {
      const { renderLevel } = await import('../../src/renderer.js');
      /**
       * @param {Array<MenuItem | SeparatorItem>} items
       * @returns {Promise<number>}
       */
      const measure = async (items) => {
        const level = renderLevel(items, {
          levelIndex: 0,
          menuId: 'vc-level-0',
          label: 'Меню файла',
          actions: new Map(),
        });
        const host = /** @type {HTMLElement} */ (document.getElementById('host'));
        host.replaceChildren(level.element);
        level.element.showPopover();
        return level.element.getBoundingClientRect().width;
      };
      // Ширину меню задаёт самый длинный ряд, поэтому решающий пункт — первый и
      // длиннее прочих: разница в иконке видна на нём одном.
      const withIcon = await measure([
        { label: 'Достаточно длинная подпись пункта', icon: square },
        { label: 'Короткая' },
      ]);
      const withoutIcon = await measure([
        { label: 'Достаточно длинная подпись пункта' },
        { label: 'Короткая' },
      ]);
      return { withIcon, withoutIcon, limit: window.innerWidth - 2 * padding };
    }, { square: SQUARE_SVG, padding: SAFETY_PADDING });

    // Меню жмётся по содержимому, поэтому убрать иконку без последствий нельзя:
    // слот зарезервирован, и ширина не меняется.
    expect(result.withIcon).toBe(result.withoutIcon);
    // Равенство выше слепое: меню с фиксированной шириной дало бы ровно его.
    // Опора — ширина идёт за содержимым, то есть меню не растянуто до предела.
    expect(result.withIcon).toBeLessThan(result.limit);
  });
});

test.describe('ключи и коллбэки', () => {
  test('внутренний ключ не зависит от id: пункт с повторяющимся id получает разные ключи', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      /** @type {Array<MenuItem | SeparatorItem>} */
      const items = [
        { label: 'Первый', id: 'x' },
        { label: 'Второй', id: 'x' },
        { label: 'Третий' },
      ];
      const actions = new Map();
      const level = renderLevel(items, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions,
      });
      return {
        keys: level.items.map((entry) => {
          return entry.key;
        }),
        // Авторский `id` копируется в `data-id` и больше нигде не участвует.
        dataIds: level.items.map((entry) => {
          return entry.element.getAttribute('data-id');
        }),
        // По `id` как по ключу два одинаковых пункта схлопнулись бы в один, и
        // `action` второго вызвался бы вместо первого.
        actionKeys: [...actions.keys()],
        actionCount: actions.size,
      };
    });

    expect(result).toEqual({
      keys: ['vc-level-0:0', 'vc-level-0:1', 'vc-level-0:2'],
      dataIds: ['x', 'x', null],
      actionKeys: ['vc-level-0:0', 'vc-level-0:1', 'vc-level-0:2'],
      actionCount: 3,
    });
  });

  test('action-коллбэк попадает в actions, а не в DOM', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      /** @type {string[]} */
      const calls = [];
      /** @type {Array<MenuItem | SeparatorItem>} */
      const items = [
        { label: 'Первое', action: () => { calls.push('первое'); } },
        { label: 'Второе', action: () => { calls.push('второе'); } },
        { type: 'separator' },
        { label: 'Третье', action: () => { calls.push('третье'); } },
      ];
      const actions = new Map();
      const level = renderLevel(items, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions,
      });
      const host = /** @type {HTMLElement} */ (document.getElementById('host'));
      host.replaceChildren(level.element);
      // Атрибутные обработчики и встроенные в разметку функции — единственный
      // способ утащить коллбэк в DOM, поэтому проверяются оба.
      const nodes = [level.element, ...level.element.querySelectorAll('*')];
      const handlerAttributes = nodes.flatMap((node) => {
        return Array.from(node.attributes, (attribute) => {
          return attribute.name;
        }).filter((name) => {
          return name.startsWith('on');
        });
      });
      const first = actions.get('vc-level-0:0');
      if (first !== undefined && first.action !== undefined) {
        first.action(new MouseEvent('click'));
      }
      return {
        size: actions.size,
        keys: [...actions.keys()],
        // Ключи пунктов и ключи карты обязаны совпадать: карта — это индекс
        // активов по DOM, и расхождение означало бы потерю коллбэка.
        itemKeys: level.items.map((entry) => {
          return entry.key;
        }),
        // Разделитель ключа не получает: коллбэка у него нет и быть не может.
        separatorKeyed: actions.has('vc-level-0:2'),
        handlerAttributes,
        calls: [...calls],
      };
    });

    // Коллбэк доступен по внутреннему ключу и не сработал сам при рендере.
    expect(result.size).toBe(3);
    expect(result.keys).toEqual(['vc-level-0:0', 'vc-level-0:1', 'vc-level-0:3']);
    expect(result.separatorKeyed).toBe(false);
    expect(result.calls).toEqual(['первое']);
    // Ключ на узле и ключ в карте — одна и та же строка, а не две записи одного
    // инварианта: расхождение означало бы, что `level.items[i].key` не найдёт
    // своего пункта в карте `actions`. `null` у разделителя в карте нет, поэтому
    // сравниваются только ключи пунктов.
    expect(result.itemKeys.filter((key) => {
      return key !== null;
    })).toEqual(result.keys);
    // Ни одного обработчика в разметке: элементы меню не несут функций.
    expect(result.handlerAttributes).toEqual([]);
  });

  test('карта actions общая для всех уровней и не смешивает их пункты', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      const actions = new Map();
      /**
       * @param {string} hostId
       * @param {string} menuId
       * @param {number} levelIndex
       * @returns {import('../../src/renderer.js').RenderedLevel}
       */
      const render = (hostId, menuId, levelIndex) => {
        const level = renderLevel([{ label: `Пункт ${levelIndex}` }], {
          levelIndex,
          menuId,
          label: 'Меню файла',
          actions,
        });
        /** @type {HTMLElement} */ (document.getElementById(hostId))
          .replaceChildren(level.element);
        return level;
      };
      const root = render('host', 'vc-level-0', 0);
      const child = render('host-2', 'vc-level-1', 1);
      return {
        keys: [...actions.keys()],
        rootKey: root.items[0].key,
        childKey: child.items[0].key,
        // `menuId` входит в ключ пункта, поэтому пункты разных уровней не
        // затёрли друг друга.
        distinct: root.items[0].key !== child.items[0].key,
      };
    });

    expect(result.keys).toEqual(['vc-level-0:0', 'vc-level-1:0']);
    expect(result.rootKey).toBe('vc-level-0:0');
    expect(result.childKey).toBe('vc-level-1:0');
    expect(result.distinct).toBe(true);
  });

  test('внутренний ключ уникален между экземплярами: два меню с одинаковым levelIndex не сталкиваются в общей карте', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      /** @type {string[]} */
      const calls = [];
      const actions = new Map();
      /**
       * @param {string} tag метка экземпляра: попадает в подпись и в `action`.
       * @returns {import('../../src/renderer.js').RenderedLevel}
       */
      const build = (tag) => {
        return renderLevel([
          { label: `Первый ${tag}`, action: () => { calls.push(`первый:${tag}`); } },
          { label: `Второй ${tag}`, action: () => { calls.push(`второй:${tag}`); } },
        ], {
          // Оба экземпляра — на глубине 0: различает их только `menuId`.
          levelIndex: 0,
          menuId: `vc-${tag}-0`,
          label: 'Меню файла',
          actions,
        });
      };
      const first = build('a');
      const second = build('b');
      // Активация пункта `1` у второго экземпляра обязана вызвать его же
      // обработчик: коллизия ключей необратима, ведь ключ не перевыводится из
      // DOM в момент клика.
      const target = actions.get(second.items[1].key);
      if (target !== undefined && target.action !== undefined) {
        target.action(new MouseEvent('click'));
      }
      /**
       * @param {string | null} key
       * @returns {string | null} подпись найденного пункта.
       */
      const labelOf = (key) => {
        const found = key === null ? undefined : actions.get(key);
        return found === undefined ? null : found.label;
      };
      return {
        firstKeys: first.items.map((entry) => {
          return entry.key;
        }),
        secondKeys: second.items.map((entry) => {
          return entry.key;
        }),
        mapKeys: [...actions.keys()],
        mapSize: actions.size,
        calls: [...calls],
        // Симптом перепутанной проводки, а не его следствие: под старым ключом
        // по `levelIndex` второй экземпляр перезаписывал первый, и поиск по
        // ключу пункта первого отдавал чужой пункт. Проверка на саму активацию
        // этого не поймала бы — активировался пункт второго, он и сработал бы.
        firstLookup: labelOf(first.items[1].key),
        secondLookup: labelOf(second.items[1].key),
      };
    });

    expect(result.firstKeys).toEqual(['vc-a-0:0', 'vc-a-0:1']);
    expect(result.secondKeys).toEqual(['vc-b-0:0', 'vc-b-0:1']);
    // Четыре записи, а не две: с ключом по `levelIndex` второй экземпляр
    // перезаписал бы первый молча, и `0:1` остался бы один — с чужим действием.
    expect(result.mapSize).toBe(4);
    expect(result.mapKeys).toEqual(['vc-a-0:0', 'vc-a-0:1', 'vc-b-0:0', 'vc-b-0:1']);
    expect(new Set(result.mapKeys).size).toBe(4);
    // Ключ пункта первого экземпляра ведёт к пункту первого, а не второго.
    expect(result.firstLookup).toBe('Второй a');
    expect(result.secondLookup).toBe('Второй b');
    expect(result.calls).toEqual(['второй:b']);
  });
});

test.describe('каркас уровня', () => {
  test('меню получает role=menu и aria-label из контекста', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const host = /** @type { { __vcFixture: () => Array<MenuItem | SeparatorItem> } } */ (
        /** @type { unknown } */ (globalThis)
      );
      const levelItems = host.__vcFixture();
      const { renderLevel } = await import('../../src/renderer.js');
      const level = renderLevel(levelItems, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      const withoutLabel = renderLevel(levelItems, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        actions: new Map(),
      });
      const list = /** @type {HTMLElement} */ (level.element.querySelector('.vc-list'));
      return {
        role: level.element.getAttribute('role'),
        popover: level.element.getAttribute('popover'),
        className: level.element.className,
        ariaLabel: level.element.getAttribute('aria-label'),
        // Фокусируем программно, но не с клавиатуры: пока активного пункта нет,
        // уровень держит фокус на себе, и клавиши приходят на него.
        tabIndex: level.element.getAttribute('tabindex'),
        listRole: list.getAttribute('role'),
        listClass: list.className,
        // Внутри уровня — зоны и список. Зоны строятся всегда, в том числе у короткого
        // списка: показывает их слой, и место для этого решения — один атрибут,
        // а не разная разметка.
        children: level.element.children.length,
        // Имя опционально, и без него атрибута нет, а не пустая строка.
        withoutLabel: withoutLabel.element.getAttribute('aria-label'),
      };
    });

    expect(result).toEqual({
      role: 'menu',
      // `manual` — единственное значение, при котором подменю не закрывают
      // друг друга и меню не закрывается по клику мимо.
      popover: 'manual',
      className: 'vc-menu',
      ariaLabel: 'Меню файла',
      // `-1`, а не `0`: вкладка не должна попадать в меню, а сфокусировать уровень
      // программно без `tabindex` нельзя.
      tabIndex: '-1',
      listRole: 'group',
      listClass: 'vc-list',
      children: 3,
      withoutLabel: null,
    });
  });

  test('зоны прокрутки: обе зоны — соседи списка и недоступны с клавиатуры', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const host = /** @type { { __vcFixture: () => Array<MenuItem | SeparatorItem> } } */ (
        /** @type { unknown } */ (globalThis)
      );
      const levelItems = host.__vcFixture();
      const { renderLevel } = await import('../../src/renderer.js');
      const level = renderLevel(levelItems, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        actions: new Map(),
      });
      /**
       * @param {string} selector
       * @returns {{ className: string, ariaHidden: string | null, tabIndex: string | null, position: number }}
       */
      const read = (selector) => {
        const zone = level.element.querySelector(selector);
        if (zone === null) {
          throw new Error(`у уровня нет узла ${selector}`);
        }
        return {
          className: zone.className,
          ariaHidden: zone.getAttribute('aria-hidden'),
          tabIndex: zone.getAttribute('tabindex'),
          // Порядок детей — это контракт: зоны обязаны стоять по краям списка, и
          // слой их потом кликает, полагаясь ровно на это расположение.
          position: Array.from(level.element.children).indexOf(zone),
        };
      };
      const list = /** @type {HTMLElement} */ (level.element.querySelector('.vc-list'));
      return {
        up: read('.vc-scroll-zone-up'),
        down: read('.vc-scroll-zone-down'),
        listPosition: Array.from(level.element.children).indexOf(list),
        // Зоны не скроллятся и не перехватывают фокус: у них нет ни своей роли,
        // ни вкладки, а курсор по ним всё равно проходит.
        listTabIndex: list.getAttribute('tabindex'),
        // `scroll` обязан отдавать те же узлы, что лежат в DOM: слой строит по
        // ним контроллер, и другие узлы оставили бы зоны привязанными к
        // отброшенной разметке — молча, без единой ошибки.
        scrollUpIsZone: level.scroll.up === level.element.querySelector('.vc-scroll-zone-up'),
        scrollDownIsZone: level.scroll.down === level.element.querySelector('.vc-scroll-zone-down'),
        scrollListIsList: level.scroll.list === list,
      };
    });

    expect(result).toEqual({
      up: { className: 'vc-scroll-zone vc-scroll-zone-up', ariaHidden: 'true', tabIndex: null, position: 0 },
      down: { className: 'vc-scroll-zone vc-scroll-zone-down', ariaHidden: 'true', tabIndex: null, position: 2 },
      listPosition: 1,
      listTabIndex: null,
      scrollUpIsZone: true,
      scrollDownIsZone: true,
      scrollListIsList: true,
    });
  });

  test('у каждого уровня уникальный id для aria-owns', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      /**
       * @param {string} hostId
       * @param {string} menuId
       * @param {number} levelIndex
       * @returns {import('../../src/renderer.js').RenderedLevel}
       */
      const render = (hostId, menuId, levelIndex) => {
        const level = renderLevel([
          { label: 'Первый', submenu: [{ label: 'A' }] },
          { label: 'Второй', submenu: [{ label: 'B' }] },
        ], {
          levelIndex,
          menuId,
          label: 'Меню файла',
          actions: new Map(),
        });
        /** @type {HTMLElement} */ (document.getElementById(hostId))
          .replaceChildren(level.element);
        return level;
      };
      const root = render('host', 'vc-level-0', 0);
      const child = render('host-2', 'vc-level-1', 1);
      const owners = [...root.items, ...child.items];
      const owns = owners.map((entry) => {
        return entry.element.getAttribute('aria-owns');
      });
      return {
        levelIds: [root.element.id, child.element.id],
        owns,
        // Подменю на момент рендера не создано: владелец лишь резервирует цель
        // для `aria-owns`, и создатель подменю обязан взять именно этот id.
        reservedExists: owns.map((id) => {
          return document.getElementById(id ?? '') !== null;
        }),
        // Собственные идентификаторы библиотеки обязаны начинаться с `vc-`:
        // сохранённый `id` внутри очищенной svg-иконки позволяет `use href="#id"`
        // сослаться на элемент хост-страницы.
        prefixed: owns.every((id) => {
          return id !== null && id.startsWith('vc-');
        }),
      };
    });

    expect(result.levelIds).toEqual(['vc-level-0', 'vc-level-1']);
    // Четыре владельца — четыре разных адреса: иначе два подменю получили бы
    // один `id`, и `aria-owns` вёл бы не туда.
    expect(new Set(result.owns).size).toBe(4);
    expect(result.owns).not.toContain('vc-level-0');
    expect(result.owns).not.toContain('vc-level-1');
    expect(result.reservedExists).toEqual([false, false, false, false]);
    expect(result.prefixed).toBe(true);
  });

  test('aria-owns уникальны между экземплярами', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      /**
       * @param {string} hostId
       * @param {string} menuId
       * @returns {import('../../src/renderer.js').RenderedLevel}
       */
      const render = (hostId, menuId) => {
        const level = renderLevel([
          { label: 'Первый', submenu: [{ label: 'A' }] },
          { label: 'Второй', submenu: [{ label: 'B' }] },
        ], {
          // Глубина у обоих экземпляров одна и та же, и различает их только
          // `menuId` — из него выводится и адрес зарезервированного подменю.
          levelIndex: 0,
          menuId,
          label: 'Меню файла',
          actions: new Map(),
        });
        /** @type {HTMLElement} */ (document.getElementById(hostId))
          .replaceChildren(level.element);
        return level;
      };
      const first = render('host', 'vc-a-0');
      const second = render('host-2', 'vc-b-0');
      return {
        first: first.items.map((entry) => {
          return entry.element.getAttribute('aria-owns');
        }),
        second: second.items.map((entry) => {
          return entry.element.getAttribute('aria-owns');
        }),
        levelIds: [first.element.id, second.element.id],
        // Ни одна зарезервированная цель не совпадает с id чужого уровня: иначе
        // `aria-owns` вёл бы на элемент другого экземпляра.
        collidesWithLevelId: [
          ...first.items, ...second.items,
        ].some((entry) => {
          const owns = entry.element.getAttribute('aria-owns');
          return owns === first.element.id || owns === second.element.id;
        }),
      };
    });

    expect(result.levelIds).toEqual(['vc-a-0', 'vc-b-0']);
    expect(result.first).toEqual(['vc-a-0-sub-0', 'vc-a-0-sub-1']);
    expect(result.second).toEqual(['vc-b-0-sub-0', 'vc-b-0-sub-1']);
    // Четыре адреса на два экземпляра: с производной только от позиции
    // `vc-a-0-sub-0` повторился бы в обоих, и два подменю получили бы один id.
    const all = [...result.first, ...result.second];
    expect(new Set(all).size).toBe(4);
    expect(result.collidesWithLevelId).toBe(false);
  });

  test('пустое подменю не считается подменю', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderLevel } = await import('../../src/renderer.js');
      /** @type {Array<MenuItem | SeparatorItem>} */
      const items = [
        { label: 'Пустое', submenu: [] },
        { label: 'Непустое', submenu: [{ label: 'A' }] },
      ];
      const level = renderLevel(items, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      /**
       * @param {number} index
       * @returns {{ hasSubmenu: boolean, haspopup: string | null, owns: string | null, chevrons: number }}
       */
      const owner = (index) => {
        const item = level.items[index];
        return {
          hasSubmenu: item.hasSubmenu,
          haspopup: item.element.getAttribute('aria-haspopup'),
          owns: item.element.getAttribute('aria-owns'),
          chevrons: item.element.querySelectorAll('.vc-chevron').length,
        };
      };
      return { empty: owner(0), filled: owner(1) };
    });

    // Открывать нечего: `aria-haspopup` на пункт без подменю вводил бы в
    // заблуждение и озвучивался бы как «есть вложенное меню».
    expect(result.empty).toEqual({
      hasSubmenu: false,
      haspopup: null,
      owns: null,
      chevrons: 0,
    });
    expect(result.filled.hasSubmenu).toBe(true);
    expect(result.filled.haspopup).toBe('menu');
  });
});
