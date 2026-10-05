import { expect, test } from '@playwright/test';
import {
  DEFAULT_CHEVRON_SIZE,
  DEFAULT_ICON_SIZE,
  DEFAULT_ITEM_HEIGHT,
  SAFETY_PADDING,
} from '../../src/constants.js';

/**
 * `options.scale` против настоящей страницы: множитель задан конструктором,
 * модуль грузится динамическим импортом прямо в браузере.
 *
 * **Замер идёт по раскладке, а не по рамке.** Множитель меняет токены, то есть
 * раскладку, поэтому вычисленные `width` и `height` — те самые величины, которые
 * `src/layer.js` отдаёт позиционеру. Равенство `scale`-кратному значению и есть
 * доказательство, что позиционирование увидит увеличенное меню; рамка после
 * входного `transform: scale(0.96)` для этого не годится.
 *
 * **Подменю открывается клавишей, а не наведением.** Уровень-подменю строится
 * лениво, при первом показе, и наведения в кейсе нет: `ArrowRight` на пункте-владельце
 * открывает его по документации, без гонки с таймером `hoverIntent`.
 *
 * **Каждый уровень проверяется своим множителем, а не «меню вообще увеличено».**
 * Один корень ничего не говорит о подменю: `--vc-scale` пишется на уровень при его
 * создании, и подменю, созданное позже, — второй независимый повод.
 *
 * **Токены остаются базовыми величинами.** Их значения — зеркала констант
 * `src/constants.js`, и множитель живёт отдельно, в `--vc-scale`: вписанный в них
 * множитель сделал бы доктрину «токен равен константе» непроверяемой — сравнивали
 * бы токен с самим собой.
 */

const STYLESHEET_PATH = '/styles/mycontext.css';
const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <body>
    <div id="host"></div>
  </body>
</html>`;

/** Вьюпорт кейсов: достаточно велик, чтобы увеличенное меню нигде не упёрлось в предел. */
const VIEWPORT = { width: 1280, height: 900 };

/** Множитель, на котором проверяется увеличение. */
const SCALE_UP = 1.5;
/** Множитель, на котором проверяется уменьшение. */
const SCALE_DOWN = 0.5;

/**
 * Множители, на которых проверяется, что подпись нигде не обрезается.
 *
 * Не одна-две величины, а весь диапазон ползунка демо с шагом `SCALE_STEP`:
 * обрезка видна глазом на меньшинстве множителей (на 0.5…2.0 при кегле 13 px
 * под `system-ui` её не видно примерно на трёх из шестнадцати), потому что
 * `overflow: hidden` срезает по краю бокса, округлённому до целых пикселей, и
 * круглая величина вылета то переживает округление, то нет. Один «злой» множитель
 * в проверке означал бы, что остальные тринадцать непроверенными остаются.
 */
const LABEL_FIT_SCALES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2];

/**
 * Шаг ползунка множителя в демо: `SCALE_RANGE.step` оттуда и взят, и кейс повторяет
 * его намеренно — проверяются те величины, которые человек вообще может выставить.
 */
const SCALE_STEP = 0.1;

/**
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 */

/**
 * Геометрия одного уровня, снятая по раскладке.
 *
 * @typedef {object} LevelGeometry
 * @property {number} width ширина уровня по `getComputedStyle`, px.
 * @property {number} height высота уровня по `getComputedStyle`, px.
 * @property {number} left `left` уровня по `getComputedStyle`, px: координата,
 *   которую записал позиционер, без входного `transform`.
 * @property {number} top `top` уровня по `getComputedStyle`, px.
 * @property {number} itemHeight высота первого пункта.
 * @property {number} slot сторона слота иконки.
 * @property {number | null} chevron сторона колонки шеврона; `null` у уровня без
 *   пунктов-владельцев, потому что узел `.vc-chevron` в разметке есть только у них.
 * @property {number} fontSize кегль уровня.
 * @property {string} scaleToken значение `--vc-scale` на уровне.
 * @property {string} itemHeightToken значение `--vc-item-height` на уровне.
 */

/**
 * Снимок обоих уровней меню, показанного в углу вьюпорта.
 *
 * @typedef {object} ScaleSnapshot
 * @property {LevelGeometry} root
 * @property {LevelGeometry} submenu
 * @property {number} viewportWidth
 * @property {number} viewportHeight
 */

/**
 * Показывает меню с заданным множителем и меряет корень и подменю.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number | null} scale множитель либо `null`, чтобы не задавать опцию вовсе.
 * @param {'center' | 'corner'} anchor точка вызова: по центру либо у правого нижнего
 *   края, где позиционер выбирает последнего кандидата — прижать к `padding`.
 * @returns {Promise<ScaleSnapshot>}
 */
async function measureScale(page, scale, anchor) {
  const point = await page.evaluate((where) => {
    return where === 'corner'
      ? { x: window.innerWidth - 1, y: window.innerHeight - 1 }
      : { x: 40, y: 40 };
  }, anchor);
  await page.evaluate(async ({ scale: factor, x, y }) => {
    const { MyContext } = await import('../../src/index.js');

    /** @type {Array<MenuItem | SeparatorItem>} */
    const submenuItems = [
      { labelAction: () => 'Лист', iconAction: () => ({ type: 'emoji', value: '📄' }) },
    ];
    /** @type {Array<MenuItem | SeparatorItem>} */
    const items = [
      { labelAction: () => 'Открыть', iconAction: () => ({ type: 'emoji', value: '📂' }) },
      { labelAction: () => 'Экспорт', submenuAction: () => submenuItems },
    ];

    const menu = new MyContext(items, factor === null ? {} : { scale: factor });
    menu.open({ x, y });
    // Экземпляр держится на `window`, а не в замыкании `evaluate`: возвращается
    // только значение, а закрывать и разбирать его надо после замера, иначе к
    // следующему кейсу остался бы висеть слушатель на документе. Приведение идёт
    // от `unknown` — единственного типа, в который влезает произвольное свойство,
    // — и поэтому не скрывает ничего: свойство получает и записывает страница.
    /** @type {{ __scaleMenu?: import('../../src/MyContext.js').MyContext }} */
    const holder = /** @type {{ __scaleMenu?: import('../../src/MyContext.js').MyContext }} */ (
      /** @type {unknown} */ (globalThis)
    );
    holder.__scaleMenu = menu;
  }, { scale, x: point.x, y: point.y });

  // Клавиатурой, а не наведением: подменю строится при первом показе, и
  // `ArrowRight` на пункте-владельце открывает его без таймера `hoverIntent`.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.vc-menu:popover-open')).toHaveCount(2);

  const snapshot = await page.evaluate(() => {
    /**
     * @param {string} label подпись пункта.
     * @returns {HTMLElement}
     */
    const itemByLabel = (label) => {
      const item = Array.from(document.querySelectorAll('.vc-item')).find((node) => {
        return node.querySelector('.vc-label')?.textContent === label;
      });
      if (!(item instanceof HTMLElement)) {
        throw new Error(`на странице нет пункта «${label}»`);
      }
      return item;
    };

    /**
     * Слот иконки меряется на пункте с иконкой, а шеврон — на владельце: узел
     * `.vc-chevron` в разметке есть только у пунктов-владельцев, и искать его на
     * пункте без подменю бессмысленно.
     *
     * @param {string} anchorLabel подпись пункта, по которому опознаётся уровень.
     * @param {string} iconLabel подпись пункта с иконкой на этом уровне.
     * @param {string} [ownerLabel] подпись пункта-владельца на этом уровне.
     *   `undefined` — уровень без владельцев, и ширина шеврона тогда неизвестна.
     * @returns {LevelGeometry}
     */
    const geometryOf = (anchorLabel, iconLabel, ownerLabel) => {
      const level = /** @type {HTMLElement} */ (itemByLabel(anchorLabel).closest('.vc-menu'));
      const style = getComputedStyle(level);
      const slot = /** @type {HTMLElement} */ (
        itemByLabel(iconLabel).querySelector('.vc-icon-slot')
      );
      const chevron = ownerLabel === undefined
        ? null
        : /** @type {HTMLElement} */ (itemByLabel(ownerLabel).querySelector('.vc-chevron'));
      return {
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
        left: Number.parseFloat(style.left),
        top: Number.parseFloat(style.top),
        itemHeight: itemByLabel(anchorLabel).getBoundingClientRect().height,
        slot: slot.getBoundingClientRect().width,
        chevron: chevron === null ? null : chevron.getBoundingClientRect().width,
        fontSize: Number.parseFloat(style.fontSize),
        scaleToken: style.getPropertyValue('--vc-scale').trim(),
        itemHeightToken: style.getPropertyValue('--vc-item-height').trim(),
      };
    };

    const snapshot = {
      root: geometryOf('Открыть', 'Открыть', 'Экспорт'),
      submenu: geometryOf('Лист', 'Лист'),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
    const holder = /** @type {{ __scaleMenu?: import('../../src/MyContext.js').MyContext }} */ (
      /** @type {unknown} */ (globalThis)
    );
    const menu = holder.__scaleMenu;
    if (menu === undefined) {
      throw new Error('на странице нет созданного экземпляра меню');
    }
    // Разбор после замера: экземпляр переживает собственный снимок, а следующий
    // кейс получает страницу заново и ни одного слушателя на документе.
    menu.close();
    menu.destroy();
    delete holder.__scaleMenu;
    return snapshot;
  });
  return snapshot;
}

/**
 * Высота бокса подписи против шрифтового бокса на одном множителе.
 *
 * @typedef {object} LabelFit
 * @property {number} labelHeight высота бокса `.vc-label`, px.
 * @property {number} fontBox высота шрифтового бокса подписи, px: `ascent` плюс
 *   `descent` того шрифта, которым подпись на самом деле нарисована.
 * @property {number} itemHeight высота пункта, px.
 * @property {number} tolerance допуск сравнения, px: доли пикселя от
 *   округления `getComputedStyle` и `getBoundingClientRect` по разные стороны.
 */

/**
 * Показывает меню с подписью, у которой есть вылеты, и меряет, помещаются ли они в
 * бокс подписи.
 *
 * **Шрифтовой бокс меряется по фактически применённому `font`, а не константой.**
 * Подпись рисуется тем шрифтом и тем кеглем, что вычислились у уровня, и только
 * этот шрифт задаёт, сколько места занимает строка. Константа `1.33em` в кейсе
 * означала бы проверку гипотезы «сколько занимает system-ui», а не проверку меню;
 * смени автор темы `--vc-font` или кегль, и кейс продолжил бы утверждать верное
 * о числе, относящееся к шрифту, которого на странице уже нет.
 *
 * **`canvas` вместо `TextMetrics` со скрытого узла:** холст рисует тем же шрифтом,
 * что и страница, и отдаёт метрики без того, чтобы подпись пришлось бы временно
 * переписывать.
 *
 * **Подпись с вылетами, а не произвольная.** Проверяется не «влезает ли текст»,
 * а «влезает ли строка шрифта», и интересуют именно нижние вылеты `g`, `у`, `y`:
 * верхние всегда помещаются в бокс строки, а нижние — ровно те, что уходят под
 * `overflow: hidden`. Кириллическая `Экспорт` годится: `р` уходит за базовую
 * линию так же, как `g`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} scale множитель размеров.
 * @returns {Promise<LabelFit>}
 */
async function measureLabelFit(page, scale) {
  await page.evaluate(async (factor) => {
    const holder = /** @type {{ __scaleMenu?: import('../../src/MyContext.js').MyContext }} */ (
      /** @type {unknown} */ (globalThis)
    );
    if (holder.__scaleMenu !== undefined) {
      holder.__scaleMenu.close();
      holder.__scaleMenu.destroy();
      delete holder.__scaleMenu;
    }
    const { MyContext } = await import('../../src/index.js');
    /** @type {Array<MenuItem | SeparatorItem>} */
    const items = [{ labelAction: () => 'Экспорт' }];
    const menu = new MyContext(items, { scale: factor });
    menu.open({ x: 40, y: 40 });
    holder.__scaleMenu = menu;
  }, scale);

  // Показ анимируется даже под `reduce`, пока не пришёл кадр перехода: узлы
  // уровня появляются синхронно, но ждать их появления дешевле и надёжнее, чем
  // мерять снимок, в котором их может ещё не быть.
  await expect(page.locator('.vc-menu:popover-open .vc-label')).toHaveText('Экспорт');

  const fit = await page.evaluate(() => {
    const label = /** @type {HTMLElement} */ (
      document.querySelector('.vc-menu:popover-open .vc-label')
    );
    const item = /** @type {HTMLElement} */ (
      document.querySelector('.vc-menu:popover-open .vc-item')
    );
    if (label === null || item === null) {
      throw new Error('на странице нет показанного пункта меню');
    }
    const level = /** @type {HTMLElement} */ (label.closest('.vc-menu'));
    if (level === null) {
      throw new Error('на странице нет уровня меню');
    }
    const style = getComputedStyle(label);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('страница не даёт 2d-контекст для замера шрифта');
    }
    // Шрифт подписи собирается целиком, а `font` уровня отдал бы кегль уровня:
    // он у подписи свой, и кегль подписи — единственный верный.
    context.font = style.font;
    const metrics = context.measureText(label.textContent ?? '');
    return {
      labelHeight: label.getBoundingClientRect().height,
      fontBox: metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent,
      itemHeight: item.getBoundingClientRect().height,
      tolerance: 0.5,
    };
  });

  return fit;
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
  // Под `reduce` показ и закрытие не ждут анимации: каждый кейс меряет снимок
  // сразу, иначе assertions гонялись бы с переходом.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.describe('множитель масштаба', () => {
  test('без опции ничего не меняется: геометрия равна константам', async ({ page }) => {
    const { root, submenu } = await measureScale(page, null, 'center');

    // Отсутствие опции и явная единица обязаны давать одно и то же, иначе «не
    // задал» и «задал единицу» разошлись бы, а величина у них одна.
    expect(root.itemHeight).toBe(DEFAULT_ITEM_HEIGHT);
    expect(root.slot).toBe(DEFAULT_ICON_SIZE);
    expect(root.chevron).toBe(DEFAULT_CHEVRON_SIZE);
    expect(root.scaleToken).toBe('1');
    expect(submenu.itemHeight).toBe(DEFAULT_ITEM_HEIGHT);
  });

  test('scale 1.5 умножает геометрию корня и подменю', async ({ page }) => {
    const { root, submenu } = await measureScale(page, SCALE_UP, 'center');

    // Четыре величины из четырёх разных правил: высота пункта, слот иконки,
    // колонка шеврона и кегль. Одна проверяемая величина прошла бы и при
    // масштабировании единственного правила.
    expect(root.itemHeight).toBe(DEFAULT_ITEM_HEIGHT * SCALE_UP);
    expect(root.slot).toBe(DEFAULT_ICON_SIZE * SCALE_UP);
    expect(root.chevron).toBe(DEFAULT_CHEVRON_SIZE * SCALE_UP);
    expect(root.fontSize).toBeCloseTo(13 * SCALE_UP, 5);
    // Подменю — уровень, созданный позже корня, со своей записью `--vc-scale`.
    // Без неё он остался бы в базовом размере, и кейс на одном корне прошёл бы.
    expect(submenu.itemHeight).toBe(DEFAULT_ITEM_HEIGHT * SCALE_UP);
    expect(submenu.slot).toBe(DEFAULT_ICON_SIZE * SCALE_UP);
  });

  test('scale 0.5 уменьшает так же, как 1.5 увеличивает', async ({ page }) => {
    const { root, submenu } = await measureScale(page, SCALE_DOWN, 'center');

    // Меньше единицы — заявленный случай, а не вырожденный: проверка на одном
    // знаке прошла бы и при реализации, умеющей только увеличивать.
    expect(root.itemHeight).toBe(DEFAULT_ITEM_HEIGHT * SCALE_DOWN);
    expect(root.slot).toBe(DEFAULT_ICON_SIZE * SCALE_DOWN);
    expect(submenu.itemHeight).toBe(DEFAULT_ITEM_HEIGHT * SCALE_DOWN);
  });

  test('токен множителя записан на уровень, базовые токены не тронуты', async ({ page }) => {
    const { root, submenu } = await measureScale(page, SCALE_UP, 'center');

    expect(root.scaleToken).toBe(String(SCALE_UP));
    expect(submenu.scaleToken).toBe(String(SCALE_UP));
    // Базовые токены обязаны остаться базовыми: их читает доктрина «токен равен
    // константе `src/constants.js`» и по ней же проверяются e2e-кейсы `theme`.
    expect(root.itemHeightToken).toBe(`${DEFAULT_ITEM_HEIGHT}px`);
    expect(submenu.itemHeightToken).toBe(`${DEFAULT_ITEM_HEIGHT}px`);
  });

  test('увеличенное меню остаётся в отступе от краёв вьюпорта', async ({ page }) => {
    // Правый нижний угол: позиционер перебирает кандидатов и приходит к прижатию
    // к `padding`. Меню, не поместившееся ни с одной стороны, обязано лечь в
    // гарантированный отступ — иначе класс меню врёт.
    const { root, submenu, viewportWidth, viewportHeight } = await measureScale(
      page,
      SCALE_UP,
      'corner',
    );

    /** @type {Array<[string, LevelGeometry]>} */
    const shown = [['корень', root], ['подменю', submenu]];
    for (const [name, level] of shown) {
      expect(level.left, `левый край ${name}`).toBeGreaterThanOrEqual(SAFETY_PADDING);
      expect(level.top, `верхний край ${name}`).toBeGreaterThanOrEqual(SAFETY_PADDING);
      expect(
        level.left + level.width,
        `правый край ${name} не вышел за вьюпорт`,
      ).toBeLessThanOrEqual(viewportWidth - SAFETY_PADDING);
      expect(
        level.top + level.height,
        `нижний край ${name} не вышел за вьюпорт`,
      ).toBeLessThanOrEqual(viewportHeight - SAFETY_PADDING);
    }
  });

  test('подпись не обрезает вылеты ни на одном множителе', async ({ page }) => {
    // Подпись с вылетами обязана стоять на каждом множителе, а не на одном
    // удачном: с половиной величин, где округление съедает вылет, кейс прошёл бы
    // и с багом на месте.
    for (const scale of LABEL_FIT_SCALES) {
      const fit = await measureLabelFit(page, scale);

      // Инвариант, а не «выглядит нормально»: бокс подписи обязан покрывать
      // шрифтовой бокс целиком, иначе нижние вылеты уходят под `overflow: hidden`,
      // который подпись несёт ради многоточия.
      expect(fit.labelHeight, `подпись обрезана на множителе ${scale}`)
        .toBeGreaterThanOrEqual(fit.fontBox - fit.tolerance);
      // Вторая половина того же требования: выросшая подпись обязана помещаться в
      // пункт. Иначе фикс обменял бы обрезанные глифы на вылезающий текст.
      expect(fit.labelHeight, `подпись выше пункта на множителе ${scale}`)
        .toBeLessThanOrEqual(fit.itemHeight + fit.tolerance);
    }
  });

  test('множители кейса идут с шагом ползунка демо', () => {
    // Кейс обещает проверить весь диапазон демо, а список задан руками. Шаг
    // ползунка — часть обещания: пропущенная ступень осталась бы непроверенной
    // молча, и список разъехался бы с `Demo/demo.js` без единого падения.
    for (let index = 1; index < LABEL_FIT_SCALES.length; index += 1) {
      const previous = /** @type {number} */ (LABEL_FIT_SCALES[index - 1]);
      expect(LABEL_FIT_SCALES[index] - previous).toBeCloseTo(SCALE_STEP, 10);
    }
    expect(LABEL_FIT_SCALES[0]).toBeGreaterThanOrEqual(SCALE_DOWN);
  });
});
