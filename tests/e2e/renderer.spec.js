import { expect, test } from '@playwright/test';
import {
  DEFAULT_CHEVRON_SIZE,
  DEFAULT_ICON_SIZE,
  DEFAULT_ITEM_HEIGHT,
  SAFETY_PADDING,
} from '../../src/constants.js';

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
 * отключённый пункт и владелец подменю. Все четыре состояния, которыми
 * различаются пункты, в одном списке — иначе каждый кейс рисовал бы свой.
 *
 * @type {Array<MenuItem | SeparatorItem>}
 */
const FIXTURE_ITEMS = [
  { label: 'Открыть', id: 'open', icon: EMOJI },
  { label: 'Открыть в новом окне' },
  { type: 'separator' },
  { label: 'Копировать', id: 'copy', disabled: true },
  { label: 'Экспорт', id: 'export', submenu: [{ label: 'PDF' }, { label: 'PNG' }] },
];

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
});

test.describe('пункт', () => {
  test('role=menuitem, tabindex=-1, data-active отсутствует', async ({ page }) => {
    const result = await page.evaluate(async (levelItems) => {
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
    }, FIXTURE_ITEMS);

    // Сравнение по всему набору, а не по отдельным полям: пропуск любого
    // атрибута или класса здесь роняет кейс, а не остаётся незамеченным.
    expect(result).toEqual({
      role: 'menuitem',
      className: 'vc-item',
      tabindex: '-1',
      active: false,
      key: '0:0',
      focusable: true,
      hasSubmenu: false,
      label: 'Открыть',
      children: ['vc-icon-slot', 'vc-label'],
    });
  });

  test('disabled: aria-disabled=true, tabindex=-1, в items помечен focusable=false', async ({ page }) => {
    const result = await page.evaluate(async (levelItems) => {
      const { renderLevel } = await import('../../src/renderer.js');
      const level = renderLevel(levelItems, {
        levelIndex: 0,
        menuId: 'vc-level-0',
        label: 'Меню файла',
        actions: new Map(),
      });
      // Индекс 3 — отключённый пункт фикстуры, после разделителя.
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
    }, FIXTURE_ITEMS);

    expect(result).toEqual({
      role: 'menuitem',
      ariaDisabled: 'true',
      disabledAttribute: false,
      tabindex: '-1',
      focusable: false,
      inFocusableList: false,
    });
  });

  test('с подменю: aria-haspopup=menu, aria-expanded=false, data-chevron=right', async ({ page }) => {
    const result = await page.evaluate(async (levelItems) => {
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
        // от `disabled`.
        focusable: item.focusable,
        key: item.key,
        chevrons: item.element.querySelectorAll('.vc-chevron').length,
        children: Array.from(item.element.children, (child) => {
          return child.className;
        }),
        owns: item.element.getAttribute('aria-owns'),
      };
    }, FIXTURE_ITEMS);

    expect(result).toEqual({
      role: 'menuitem',
      // `true` — синоним по ARIA 1.2, но `menu` точнее, и axe различает эти
      // значения.
      haspopup: 'menu',
      expanded: 'false',
      chevron: 'right',
      hasSubmenu: true,
      focusable: true,
      key: '0:4',
      chevrons: 1,
      children: ['vc-icon-slot', 'vc-label', 'vc-chevron'],
      owns: 'vc-level-0-sub-4',
    });
  });

  test('разделитель: role=separator и aria-orientation=horizontal, в focusable-список не попадает', async ({ page }) => {
    const result = await page.evaluate(async (levelItems) => {
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
        separatorKeyed: actions.has('0:2'),
      };
    }, FIXTURE_ITEMS);

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
    const result = await page.evaluate(async (levelItems) => {
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
    }, FIXTURE_ITEMS);

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
        // Ключ внутренний — по позиции в исходном массиве, а не в
        // не-разделительном ряду: сдвиг разделителя не обязан двигать ключ
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
      keys: ['0:0', '0:1', null, '0:3'],
    });
  });

  test('renderItem вне уровня: aria-setsize из аргумента, ключ из контекста, aria-posinset достаёт уровень', async ({ page }) => {
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
    expect(result).toEqual({
      role: 'menuitem',
      ariaLevel: '3',
      ariaSetSize: '5',
      ariaPosInSet: false,
      key: '2:7',
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
    const result = await page.evaluate(async (levelItems) => {
      const { renderLevel } = await import('../../src/renderer.js');
      const level = renderLevel(levelItems, {
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
       * @returns {number}
       */
      const labelX = (index) => {
        const label = /** @type {HTMLElement} */ (
          level.items[index].element.querySelector('.vc-label')
        );
        return label.getBoundingClientRect().x;
      };
      return {
        // Индексы 0 и 1 фикстуры: с иконкой и без.
        withIcon: labelX(0),
        withoutIcon: labelX(1),
      };
    }, FIXTURE_ITEMS);

    expect(result.withIcon).toBe(result.withoutIcon);
  });

  test('длинный лейбл уходит в многоточие, а ширина меню не растёт', async ({ page }) => {
    // Вьюпорт сужается намеренно: `width: max-content` без `max-width` дал бы
    // меню шириной во всю длину лейбла, и сравнивать его с эталоном из коротких
    // подписей было бы бессмысленно — эталон просто оказался бы уже. Обе фикстуры
    // обязаны упереться в одно и то же ограничение, и тогда равенство ширин
    // говорит именно то, что проверяется: длина подписи на ширину не влияет.
    await page.setViewportSize({ width: 360, height: 640 });
    const result = await page.evaluate(async ({ long, short }) => {
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
      // Оба меню остаются в документе до конца замера: узел, не вставленный в
      // документ, не имеет габаритов, и `scrollWidth` у его лейбла совпал бы с
      // `clientWidth` — многоточие выглядело бы сработавшим, не сработав.
      const longLevel = open('host', [{ label: long }]);
      const shortLevel = open('host-2', [{ label: short }]);
      const label = /** @type {HTMLElement} */ (
        longLevel.items[0].element.querySelector('.vc-label')
      );
      return {
        longWidth: longLevel.element.getBoundingClientRect().width,
        shortWidth: shortLevel.element.getBoundingClientRect().width,
        limit: window.innerWidth - 2 * 8,
        // Многоточие обязано именно сработать: подрезанный по дорожке лейбл —
        // это и есть признак, что `min-width: 0` на месте.
        clipped: label.scrollWidth > label.clientWidth,
        ellipsis: getComputedStyle(label).textOverflow,
        whiteSpace: getComputedStyle(label).whiteSpace,
        itemHeight: longLevel.items[0].element.getBoundingClientRect().height,
      };
    }, { long: LABEL_400, short: LABEL_200 });

    expect(result.clipped).toBe(true);
    expect(result.ellipsis).toBe('ellipsis');
    expect(result.whiteSpace).toBe('nowrap');
    // Строка не выросла: `height`, а не `min-height`, держит пункт.
    expect(result.itemHeight).toBe(DEFAULT_ITEM_HEIGHT);
    // Оба меню упёрлись в `max-width`, и длина подписи на это не повлияла.
    expect(result.limit).toBe(360 - 2 * SAFETY_PADDING);
    expect(result.longWidth).toBe(result.limit);
    expect(result.shortWidth).toBe(result.limit);
  });

  test('колонки не сдвигаются: ширина меню одинакова для пунктов с иконкой и без', async ({ page }) => {
    const result = await page.evaluate(async (square) => {
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
      return { withIcon, withoutIcon };
    }, SQUARE_SVG);

    // Меню жмётся по содержимому, поэтому убрать иконку без последствий нельзя:
    // слот зарезервирован, и ширина не меняется.
    expect(result.withIcon).toBe(result.withoutIcon);
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
      keys: ['0:0', '0:1', '0:2'],
      dataIds: ['x', 'x', null],
      actionKeys: ['0:0', '0:1', '0:2'],
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
      const first = actions.get('0:0');
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
        separatorKeyed: actions.has('0:2'),
        handlerAttributes,
        calls: [...calls],
      };
    });

    // Коллбэк доступен по внутреннему ключу и не сработал сам при рендере.
    expect(result.size).toBe(3);
    expect(result.keys).toEqual(['0:0', '0:1', '0:3']);
    expect(result.separatorKeyed).toBe(false);
    expect(result.calls).toEqual(['первое']);
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
        // Ключ уровня входит в ключ пункта, поэтому пункты разных уровней не
        // затёрли друг друга.
        distinct: root.items[0].key !== child.items[0].key,
      };
    });

    expect(result.keys).toEqual(['0:0', '1:0']);
    expect(result.rootKey).toBe('0:0');
    expect(result.childKey).toBe('1:0');
    expect(result.distinct).toBe(true);
  });
});

test.describe('каркас уровня', () => {
  test('меню получает role=menu и aria-label из контекста', async ({ page }) => {
    const result = await page.evaluate(async (levelItems) => {
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
        listRole: list.getAttribute('role'),
        listClass: list.className,
        // Внутри уровня — только список: всё остальное строится при открытии.
        children: level.element.children.length,
        // Имя опционально, и без него атрибута нет, а не пустая строка.
        withoutLabel: withoutLabel.element.getAttribute('aria-label'),
      };
    }, FIXTURE_ITEMS);

    expect(result).toEqual({
      role: 'menu',
      // `manual` — единственное значение, при котором подменю не закрывают
      // друг друга и меню не закрывается по клику мимо.
      popover: 'manual',
      className: 'vc-menu',
      ariaLabel: 'Меню файла',
      listRole: 'group',
      listClass: 'vc-list',
      children: 1,
      withoutLabel: null,
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
