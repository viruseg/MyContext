import { expect, test } from '@playwright/test';
import {
  DEFAULT_ANIMATION_DURATION,
  DEFAULT_CHEVRON_SIZE,
  DEFAULT_ICON_SIZE,
  DEFAULT_ITEM_HEIGHT,
  DEFAULT_RADIUS,
  SAFETY_PADDING,
} from '../../src/constants.js';

// Модули подгружаются динамическим импортом прямо в странице, и спецификатор
// `../../src/theme.js` обслуживает обе среды: в браузере от
// `http://127.0.0.1:4173/` он схлопывается до `/src/theme.js` — корень сервера, —
// а TypeScript разрешает его от файла теста. Поэтому типы импорта берутся из
// исходника, без приведений.

const STYLESHEET_PATH = '/styles/mycontext.css';
const MENU_SELECTOR = '#m';
const ACTIVE_ITEM = 'label-active';
const PLAIN_ITEM = 'label-plain';
const SETTLE_MS = DEFAULT_ANIMATION_DURATION * 3;

/**
 * Три палитры файла: базовая светлая, тёмная под `auto` и тёмная явная.
 */
const THEME_SELECTORS = [
  '.vc-menu',
  '.vc-menu[data-vc-theme="auto"]',
  '.vc-menu[data-vc-theme="dark"]',
];

/**
 * Все сочетания темы и системной схемы, которые имеет смысл мерить. Явная тема
 * проверяется с обеими схемами: она обязана побеждать системную, и это отдельное
 * утверждение — здесь важно лишь, что палитра достаётся и не теряет контраст.
 *
 * @type {[theme: 'auto'|'light'|'dark', scheme: 'light'|'dark'][]}
 */
const THEME_CASES = [
  ['light', 'light'],
  ['light', 'dark'],
  ['auto', 'light'],
  ['auto', 'dark'],
  ['dark', 'light'],
  ['dark', 'dark'],
];

/**
 * Снимок вычисленных стилей открытого меню. Всё, что кейс проверяет, снимается
 * одним заходом в страницу: `getComputedStyle` дорог, а половина кейсов нуждается
 * сразу и в палитре, и в переходах. Цвета возвращаются строками: математику по ним
 * делает сам тест, чтобы правила WCAG жили в одном месте.
 *
 * @typedef {object} ThemeSnapshot
 * @property {string} backgroundColor вычисленный цвет фона меню.
 * @property {string} solidBackground цвет из токена `--vc-bg-solid`: то, что
 *   подставляет запасной вариант без `backdrop-filter`.
 * @property {string} accent цвет из токена `--vc-accent`.
 * @property {string} accentText цвет из токена `--vc-accent-text`.
 * @property {string} text цвет из токена `--vc-text`.
 * @property {string} paddingToken значение `--vc-padding`.
 * @property {string} itemHeightToken значение `--vc-item-height`.
 * @property {string} iconSizeToken значение `--vc-icon-size`.
 * @property {string} chevronSizeToken значение `--vc-chevron-size`.
 * @property {string} radiusToken значение `--vc-radius`.
 * @property {string} durationToken значение `--vc-animation-duration`.
 * @property {string} maxHeight вычисленный `max-height` меню.
 * @property {string} maxWidth вычисленный `max-width` меню.
 * @property {string} listMaxHeight вычисленный `max-height` списка.
 * @property {string} opacity вычисленная непрозрачность меню.
 * @property {string} transform вычисленный `transform` меню.
 * @property {string} transitionBehavior вычисленный `transition-behavior` меню.
 * @property {string} transitionProperty вычисленный `transition-property` меню.
 * @property {string} transitionDuration вычисленный `transition-duration` меню.
 * @property {string} gridTemplateColumns вычисленные колонки сетки пункта.
 */

/**
 * Наблюдение за появлением меню.
 *
 * @typedef {object} EntrySnapshot
 * @property {string} immediate `opacity` в том же кадре, в котором меню стало
 *   видимым: стартовое значение из `@starting-style`.
 * @property {string} settled `opacity` после окончания перехода.
 * @property {(string | null)[]} running свойства переходов, которые пошли прямо
 *   после показа. Пустой список означал бы, что до-изменяемого состояния у
 *   элемента не было и появление произошло мгновенно.
 */

/**
 * Размеры `document.getElementById` в странице.
 *
 * @typedef {object} MenuBoxes
 * @property {number} slot ширина слота иконки, px.
 * @property {number} chevron ширина шеврона, px.
 * @property {number} itemHeight высота пункта, px.
 */

const MENU_CONTENT_HTML = `<div class="vc-list" role="group">
        <div class="vc-item" role="menuitem" tabindex="0" data-active aria-haspopup="menu">
          <span class="vc-icon-slot" id="slot"></span>
          <span class="vc-label" id="${ACTIVE_ITEM}">Открыть</span>
          <span class="vc-chevron" id="chevron-right"></span>
        </div>
        <div class="vc-item" role="menuitem" tabindex="-1">
          <span class="vc-icon-slot" id="slot-plain"></span>
          <span class="vc-label" id="${PLAIN_ITEM}">Без иконки</span>
          <span class="vc-chevron" id="chevron-plain"></span>
        </div>
        <div class="vc-separator" role="separator" aria-orientation="horizontal"></div>
        <div class="vc-item" role="menuitem" tabindex="-1" data-chevron="left" id="item-left">
          <span class="vc-icon-slot" id="slot-long"></span>
          <span class="vc-label" id="label-long">Очень длинный лейбл, который обязан превратиться в многоточие, а не растянуть меню за правый край вьюпорта</span>
          <span class="vc-chevron" id="chevron-left"></span>
        </div>
      </div>`;

const MENU_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <body>
    <div id="m" class="vc-menu" popover="manual">${MENU_CONTENT_HTML}</div>
  </body>
</html>`;

/**
 * Разворачивает пробелы и выбрасывает комментарии: проверки ниже смотрят на
 * правила, а не на прозу вокруг них, иначе любой комментарий с упоминанием
 * селектора ронял бы несвязанный кейс.
 *
 * @param {string} css исходный текст таблицы стилей.
 * @returns {string} текст без комментариев с одними пробелами между токенами.
 */
function flattenStylesheet(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ');
}

/**
 * Индекс закрывающей скобки блока, открывшегося в `openIndex`.
 *
 * Нужен, чтобы доказать, что правило стоит после блока, а не внутри него:
 * специфичность селектора атрибута и правила в медиазапросе одинакова, и
 * разводит их только порядок в файле.
 *
 * @param {string} css сплющенный текст таблицы стилей.
 * @param {number} openIndex индекс открывающей скобки.
 * @returns {number} индекс закрывающей скобки или `-1`, если блок не закрыт.
 */
function blockEnd(css, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < css.length; index += 1) {
    if (css[index] === '{') {
      depth += 1;
    } else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @returns {Promise<string>} сплющенный текст `styles/mycontext.css`.
 */
async function readStylesheet(request) {
  const response = await request.get(STYLESHEET_PATH);
  expect(response.status()).toBe(200);
  return flattenStylesheet(await response.text());
}

/**
 * Текст блока, начинающегося с `marker`.
 *
 * @param {string} css сплющенный текст таблицы стилей.
 * @param {string} marker начало блока.
 * @returns {string} содержимое блока вместе с фигурными скобками.
 */
function readBlock(css, marker) {
  const at = css.indexOf(marker);
  expect(at, `блок ${marker}`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  const end = blockEnd(css, open);
  expect(end).toBeGreaterThan(open);
  return css.slice(open, end);
}

/**
 * Листовые правила файла: селектор и его тело. Вложенные правила читаются как
 * самостоятельные, прелюдии `@media`/`@supports` пропускаются — для проверок
 * селекторов и объявлений это безобидно.
 *
 * @param {string} css сплющенный текст таблицы стилей.
 * @returns {{ selector: string, declarations: string }[]}
 */
function readRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    return { selector: match[1].trim(), declarations: match[2].trim() };
  }).filter((rule) => rule.selector !== '');
}

/**
 * Тела всех правил с ровно таким селектором, склеенные в один текст.
 *
 * Нужно, чтобы утверждение про объявление говорило о конкретном селекторе:
 * `toContain` по всему файлу нашло бы то же объявление в соседнем правиле и
 * пропустило бы пропажу из нужного.
 *
 * @param {string} css сплющенный текст таблицы стилей.
 * @param {string} selector искомый селектор, ровно как он написан в файле.
 * @returns {string} объявления всех правил с этим селектором.
 */
function readRule(css, selector) {
  const found = readRules(css).filter((rule) => rule.selector === selector);
  expect(found.map((rule) => rule.selector), `правило ${selector}`).not.toHaveLength(0);
  return found.map((rule) => rule.declarations).join('; ');
}

/**
 * Все селекторы файла.
 *
 * @param {string} css сплющенный текст таблицы стилей.
 * @returns {string[]} уникальные селекторы.
 */
function readSelectors(css) {
  return [...new Set(readRules(css).map((rule) => rule.selector))];
}

/**
 * Каналы и прозрачность вычисленного цвета.
 *
 * @typedef {object} Color
 * @property {number} r красный канал, 0..255.
 * @property {number} g зелёный канал, 0..255.
 * @property {number} b синий канал, 0..255.
 * @property {number} a альфа-канал, 0..1.
 */

/**
 * Разбирает вычисленный цвет. Нотаций две: `rgba(r, g, b, a)` и
 * `color(srgb r g b / a)` — вторая появляется у новых сборок, и без неё
 * проверка зависела бы от версии движка.
 *
 * @param {string} color вычисленный цвет.
 * @returns {Color}
 */
function parseColor(color) {
  const rgba = /rgba?\(([^)]*)\)/.exec(color);
  if (rgba !== null) {
    const parts = rgba[1].split(/[,\s/]+/).filter((part) => part !== '').map(Number);
    return {
      r: parts[0] ?? 0,
      g: parts[1] ?? 0,
      b: parts[2] ?? 0,
      a: parts.length >= 4 ? (parts[3] ?? 1) : 1,
    };
  }
  const modern = /color\(\s*srgb\s+([^)]*)\)/.exec(color);
  if (modern !== null) {
    const parts = modern[1].split('/').map((part) => part.trim());
    const channels = (parts[0] ?? '').split(/[\s,]+/).filter((part) => part !== '').map(Number);
    const alpha = parts[1] === undefined ? 1 : Number(parts[1]);
    return {
      // `color(srgb …)` задаёт каналы в 0..1, а `getComputedStyle` отдаёт и
      // проценты, и доли; приведение к 0..255 одно на оба случая.
      r: Math.round((channels[0] ?? 0) * 255),
      g: Math.round((channels[1] ?? 0) * 255),
      b: Math.round((channels[2] ?? 0) * 255),
      a: alpha,
    };
  }
  throw new Error(`Не разобран цвет: ${color}`);
}

/**
 * Альфа-канал вычисленного цвета, 1 для непрозрачного.
 *
 * @param {string} color вычисленный цвет.
 * @returns {number}
 */
function alphaOf(color) {
  return parseColor(color).a;
}

/**
 * Наложение `top` на `bottom` с учётом прозрачности, то есть тот композит,
 * который в итоге видит глаз. Для непрозрачного `top` результат равен `top`.
 *
 * @param {Color} top верхний слой.
 * @param {Color} bottom нижний слой.
 * @returns {Color} результат без прозрачности.
 */
function composite(top, bottom) {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  };
}

/**
 * Относительная яркость по WCAG.
 *
 * @param {Color} color сплошной цвет.
 * @returns {number} яркость, 0..1.
 */
function relativeLuminance(color) {
  /**
   * @param {number} value канал 0..255.
   * @returns {number} линеаризованный канал.
   */
  const linear = (value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/**
 * Контраст двух сплошных цветов по WCAG.
 *
 * @param {Color} foreground цвет текста.
 * @param {Color} background цвет подложки.
 * @returns {number} отношение, 1..21.
 */
function contrast(foreground, background) {
  const light = relativeLuminance(foreground);
  const dark = relativeLuminance(background);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<ThemeSnapshot>} снимок стилей открытого меню.
 */
async function readSnapshot(page) {
  return page.evaluate(() => {
    const menu = /** @type {HTMLElement} */ (document.getElementById('m'));
    const list = /** @type {HTMLElement} */ (document.querySelector('.vc-list'));
    const item = /** @type {HTMLElement} */ (document.querySelector('.vc-item'));
    const style = getComputedStyle(menu);

    /**
     * Токен приводится к `rgb()` тем же путём, каким браузер приводит цвет:
     * подстановкой в `color` пустого элемента. Само значение `#1f2023` сравнивать
     * не с чем.
     *
     * @param {string} value значение токена.
     * @returns {string} разрешённый цвет.
     */
    function resolve(value) {
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    }

    return {
      backgroundColor: style.backgroundColor,
      solidBackground: resolve(style.getPropertyValue('--vc-bg-solid')),
      accent: resolve(style.getPropertyValue('--vc-accent')),
      accentText: resolve(style.getPropertyValue('--vc-accent-text')),
      text: resolve(style.getPropertyValue('--vc-text')),
      paddingToken: style.getPropertyValue('--vc-padding'),
      itemHeightToken: style.getPropertyValue('--vc-item-height'),
      iconSizeToken: style.getPropertyValue('--vc-icon-size'),
      chevronSizeToken: style.getPropertyValue('--vc-chevron-size'),
      radiusToken: style.getPropertyValue('--vc-radius'),
      durationToken: style.getPropertyValue('--vc-animation-duration'),
      maxHeight: style.maxHeight,
      maxWidth: style.maxWidth,
      listMaxHeight: getComputedStyle(list).maxHeight,
      opacity: style.opacity,
      transform: style.transform,
      transitionBehavior: style.transitionBehavior,
      transitionProperty: style.transitionProperty,
      transitionDuration: style.transitionDuration,
      gridTemplateColumns: getComputedStyle(item).gridTemplateColumns,
    };
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'auto'|'light'|'dark'} theme
 * @returns {Promise<void>}
 */
async function setTheme(page, theme) {
  await page.evaluate(async (mode) => {
    const { applyTheme } = await import('../../src/theme.js');
    applyTheme(/** @type {HTMLElement} */ (document.getElementById('m')), mode);
  }, theme);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
async function setAnimationDuration(page, durationMs) {
  await page.evaluate(async (duration) => {
    const { applyAnimationDuration } = await import('../../src/theme.js');
    applyAnimationDuration(
      /** @type {HTMLElement} */ (document.getElementById('m')),
      duration,
    );
  }, durationMs);
}

/**
 * Создаёт новое меню и показывает его, попутно снимая стартовое значение из
 * `@starting-style` и список переходов, которые пошли на показ.
 *
 * Меню создаётся заново, а не открывается повторно: `allow-discrete` удерживает
 * скрытое меню в Top Layer до конца исчезновения, поэтому у повторного показа
 * до-изменяемого состояния нет вовсе и `@starting-style` не срабатывает. Настоящее
 * первое открытие — это вставка готового меню в документ.
 *
 * `inlineDurationMs` повторяет столкновение, о котором идёт речь в кейсе про
 * `reduce`: инлайновая длительность пишется публичным API уже на новое меню.
 * Без неё наблюдение шло бы мимо дела — инлайновый стиль исходного `#m` на
 * свежий узел не переносится, и проверка проходила бы при сломанном CSS.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number | null} inlineDurationMs длительность через публичный API или `null`.
 * @returns {Promise<EntrySnapshot>}
 */
async function readEntry(page, inlineDurationMs = null) {
  return page.evaluate(async ({ content, settleMs, durationMs }) => {
    // Второе меню собирается из тех же кусков, что и первое, но без идентификаторов:
    // дубликаты `id` в документе невалидны, а измерять тут больше нечего.
    const host = document.createElement('div');
    host.innerHTML = `<div class="vc-menu" popover="manual">${content.replaceAll(/\s+id="[^"]*"/g, '')}</div>`;
    const menu = /** @type {HTMLElement} */ (host.firstElementChild);
    document.body.appendChild(menu);
    if (durationMs !== null) {
      const { applyAnimationDuration } = await import('../../src/theme.js');
      applyAnimationDuration(menu, durationMs);
    }
    menu.showPopover();
    // Чтение стилей вынуждает пересчёт, поэтому возвращается стартовое
    // значение, а не значение кадра, следующего за переходом.
    const immediate = getComputedStyle(menu).opacity;
    const running = menu.getAnimations().map((animation) => {
      return animation instanceof CSSTransition ? animation.transitionProperty : null;
    });
    await new Promise((resolve) => {
      setTimeout(resolve, settleMs);
    });
    const settled = getComputedStyle(menu).opacity;
    menu.remove();
    return { immediate, settled, running };
  }, { content: MENU_CONTENT_HTML, settleMs: SETTLE_MS, durationMs: inlineDurationMs });
}

/**
 * Ждёт окончания перехода появления. Без этого кейсы меряют меню, которое ещё
 * увеличивается из `scale(0.96)`, и получают доли пикселя вместо значений
 * токенов.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function settleMenu(page) {
  await page.evaluate((selector) => {
    const menu = /** @type {HTMLElement} */ (document.querySelector(selector));
    return new Promise((resolve) => {
      /**
       * @param {TransitionEvent} event
       * @returns {void}
       */
      const onEnd = (event) => {
        if (event.target === menu && event.propertyName === 'transform') {
          stop();
        }
      };
      const stop = () => {
        menu.removeEventListener('transitionend', onEnd);
        resolve(undefined);
      };
      menu.addEventListener('transitionend', onEnd);
      // Страховка: переход может не прийти вовсе, и кейс обязан падать на своём
      // утверждении, а не висеть до таймаута теста.
      setTimeout(stop, 1000);
    });
  }, MENU_SELECTOR);
}

/**
 * Измерение активной строки в выбранной системной теме.
 *
 * @typedef {object} ActiveRow
 * @property {string} label цвет текста строки.
 * @property {string} activeBg разрешённый `--vc-active-bg`.
 * @property {string} accent разрешённый `--vc-accent`.
 * @property {number} ratio контраст текста к композиту подложки, 1..21.
 * @property {boolean} opaque непрозрачна ли заливка строки.
 * @property {boolean} chevronMatches совпадает ли цвет шеврона с цветом строки.
 */

/**
 * Ставит системную схему и меряет активную строку.
 *
 * Отдельная функция, а не тело кейса: контраст считают два кейса, и две копии
 * расчёта разъехались бы при первой же правке палитры.
 *
 * Тема ставится явно, а не остаётся `auto` из `beforeEach`: палитра
 * `[data-vc-theme="dark"]` иначе не достаётся вовсе, и кейс молча проверял бы
 * только медиазапрос.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'auto'|'light'|'dark'} theme тема оформления.
 * @param {'light' | 'dark'} scheme системная схема.
 * @returns {Promise<ActiveRow>}
 */
async function readActiveRow(page, theme, scheme) {
  await page.emulateMedia({ colorScheme: scheme });
  await setTheme(page, theme);
  const measured = await page.evaluate(() => {
    const menu = /** @type {HTMLElement} */ (document.getElementById('m'));
    const active = /** @type {HTMLElement} */ (
      document.querySelector('.vc-item[data-active]')
    );
    const chevron = /** @type {HTMLElement} */ (active.querySelector('.vc-chevron'));
    const menuStyle = getComputedStyle(menu);

    /**
     * Токен приводится к `rgb()` подстановкой в `color` пустого элемента: само
     * значение `var(--vc-accent)` сравнивать не с чем.
     *
     * @param {string} name имя токена.
     * @returns {string} разрешённый цвет.
     */
    const resolve = (name) => {
      const probe = document.createElement('span');
      probe.style.color = menuStyle.getPropertyValue(name);
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    };

    return {
      // Цвета строки: её собственный фон, её текст и фон подложки, на которую
      // этот фон ложится.
      row: getComputedStyle(active).backgroundColor,
      label: getComputedStyle(active).color,
      menu: menuStyle.backgroundColor,
      // Под меню лежит страница: её фон участвует в композите, потому что
      // фон меню сам по себе полупрозрачный.
      page: getComputedStyle(document.body).backgroundColor,
      chevron: getComputedStyle(chevron).color,
      activeBg: resolve('--vc-active-bg'),
      accent: resolve('--vc-accent'),
    };
  });
  // Композит, а не сырой токен: меню стеклянное, и глаз видит подложку.
  const background = composite(
    composite(parseColor(measured.row), parseColor(measured.menu)),
    parseColor(measured.page),
  );
  return {
    label: measured.label,
    activeBg: measured.activeBg,
    accent: measured.accent,
    ratio: contrast(parseColor(measured.label), background),
    // Непрозрачная заливка означает, что стекло под строкой на число не влияет.
    // Утверждается явно, иначе непрозрачность выводилась бы из совпадения с
    // результатом, а не проверялась.
    opaque: alphaOf(measured.row) === 1,
    // Шеврон на заливке акцентом обязан читаться, иначе он молча пропадает.
    chevronMatches: measured.chevron === measured.label,
  };
}

/**
 * Ширины колонок, которые пункт обязан занимать независимо от содержимого.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<MenuBoxes>}
 */
async function readItemBoxes(page) {
  return page.evaluate(() => {
    /**
     * @param {string} selector
     * @returns {HTMLElement}
     */
    const element = (selector) => {
      return /** @type {HTMLElement} */ (document.querySelector(selector));
    };
    return {
      slot: element('.vc-icon-slot').getBoundingClientRect().width,
      chevron: element('.vc-chevron').getBoundingClientRect().width,
      itemHeight: element('.vc-item').getBoundingClientRect().height,
    };
  });
}

test.beforeEach(async ({ page }) => {
  // `goto` обязателен перед `setContent`: без него у документа нет адреса, и
  // ссылка на таблицу стилей не разрешилась бы.
  await page.goto('/');
  await page.setContent(MENU_HTML);
  // Живая таблица стилей ещё могла не примениться, и `getComputedStyle` вернул бы
  // пустые токены — кейс упал бы не по существу.
  await page.waitForFunction(
    (selector) => {
      const menu = document.querySelector(selector);
      return menu !== null && getComputedStyle(menu).getPropertyValue('--vc-padding').trim() !== '';
    },
    MENU_SELECTOR,
    { timeout: 5000 },
  );
  await setTheme(page, 'auto');
  await page.evaluate((selector) => {
    /** @type {HTMLElement} */ (document.querySelector(selector)).showPopover();
  }, MENU_SELECTOR);
  await settleMenu(page);
});

test.describe('токены геометрии', () => {
  test('padding совпадает с константой: --vc-padding вычисляется в 8px, SAFETY_PADDING равен 8', async ({ page }) => {
    const snapshot = await readSnapshot(page);

    // Константа закреплена числом, иначе кейс прошёл бы, если бы токен и
    // константа одинаково съехали в сторону.
    expect(SAFETY_PADDING).toBe(8);
    expect(snapshot.paddingToken.trim()).toBe(`${SAFETY_PADDING}px`);
  });

  test('item-height по умолчанию равен 28px', async ({ page }) => {
    const snapshot = await readSnapshot(page);
    expect(DEFAULT_ITEM_HEIGHT).toBe(28);
    expect(snapshot.itemHeightToken.trim()).toBe(`${DEFAULT_ITEM_HEIGHT}px`);

    // Одного токена недостаточно: высоту пункта мог бы перебить контент, а
    // геометрия меню считает строки по фактической высоте.
    const boxes = await readItemBoxes(page);
    expect(boxes.itemHeight).toBe(DEFAULT_ITEM_HEIGHT);
  });

  test('icon-size и chevron-size по умолчанию равны 16px и 12px', async ({ page }) => {
    const snapshot = await readSnapshot(page);
    expect(DEFAULT_ICON_SIZE).toBe(16);
    expect(DEFAULT_CHEVRON_SIZE).toBe(12);
    expect(snapshot.iconSizeToken.trim()).toBe(`${DEFAULT_ICON_SIZE}px`);
    expect(snapshot.chevronSizeToken.trim()).toBe(`${DEFAULT_CHEVRON_SIZE}px`);

    // Оба размера должны быть не только объявлены, но и заняты на экране: иначе
    // колонка сетки схлопнулась бы и лейблы разъехались бы по пунктам.
    const boxes = await readItemBoxes(page);
    expect(boxes.slot).toBe(DEFAULT_ICON_SIZE);
    expect(boxes.chevron).toBe(DEFAULT_CHEVRON_SIZE);
  });

  test('radius по умолчанию равен DEFAULT_RADIUS', async ({ page }) => {
    const snapshot = await readSnapshot(page);
    // Пятая пара «токен ↔ константа» из доктрины `src/constants.js`. Раньше она
    // была единственной незакреплённой: токен объявлялся, но ни с чем не
    // сверялся, и разъехаться с константой мог без единого красного теста.
    expect(DEFAULT_RADIUS).toBe(8);
    expect(snapshot.radiusToken.trim()).toBe(`${DEFAULT_RADIUS}px`);
  });
});

test.describe('ограничение габаритов', () => {
  test('уровень ограничен по высоте: max-height равен 100dvh минус два padding', async ({ page }) => {
    const snapshot = await readSnapshot(page);
    const viewportHeight = await page.evaluate(() => {
      return window.innerHeight;
    });

    expect(snapshot.maxHeight).toBe(`${viewportHeight - 2 * SAFETY_PADDING}px`);
    // Список ограничен тем же значением: он не вправе расти выше меню, даже если
    // ограничение на самом уровне почему-то не применилось.
    expect(snapshot.listMaxHeight).toBe(`${viewportHeight - 2 * SAFETY_PADDING}px`);

    // Форма ограничения проверяется по тексту файла: `100dvh` без учёта
    // динамической панели браузера и `padding` вместо `SAFETY_PADDING` дали бы
    // расхождение с движком позиционирования, которого выше не видно. Утверждение
    // ограничено правилом `.vc-menu`: то же объявление есть и у `.vc-list`, и
    // `toContain` по всему файлу нашло бы его там, оставив меню без ограничения.
    const css = await readStylesheet(page.request);
    expect(readRule(css, '.vc-menu')).toContain('max-height: calc(100dvh - 2 * var(--vc-padding))');
  });

  test('уровень ограничен по ширине: max-width равен 100dvw минус два padding', async ({ page }) => {
    // Узкий вьюпорт заставляет длинный лейбл давить на `max-width`, иначе кейс
    // прошёл бы на меню, которое и так помещается.
    await page.setViewportSize({ width: 360, height: 640 });
    const snapshot = await readSnapshot(page);
    const viewportWidth = await page.evaluate(() => {
      return window.innerWidth;
    });

    expect(snapshot.maxWidth).toBe(`${viewportWidth - 2 * SAFETY_PADDING}px`);

    const measured = await page.evaluate(() => {
      const menu = /** @type {HTMLElement} */ (document.getElementById('m'));
      const label = /** @type {HTMLElement} */ (document.getElementById('label-long'));
      const box = menu.getBoundingClientRect();
      return {
        right: box.right,
        width: box.width,
        // Многоточие сработало: содержимое шире видимой части строки.
        clipped: label.scrollWidth > label.clientWidth,
        ellipsis: getComputedStyle(label).textOverflow,
        whiteSpace: getComputedStyle(label).whiteSpace,
        itemHeight: /** @type {HTMLElement} */ (document.getElementById('item-left'))
          .getBoundingClientRect().height,
      };
    });

    // Без `max-width` движок позиционирования смог бы только прижать меню к
    // левому краю, и оно вылезло бы за правый: это и есть проверяемая гарантия.
    expect(measured.width).toBeLessThanOrEqual(viewportWidth - 2 * SAFETY_PADDING);
    expect(Math.round(measured.right)).toBeLessThanOrEqual(viewportWidth - SAFETY_PADDING);
    expect(measured.clipped).toBe(true);
    expect(measured.ellipsis).toBe('ellipsis');
    expect(measured.whiteSpace).toBe('nowrap');
    // Длинный лейбл ушёл в многоточие, а не вырастил строку.
    expect(measured.itemHeight).toBe(DEFAULT_ITEM_HEIGHT);

    const css = await readStylesheet(page.request);
    expect(readRule(css, '.vc-menu')).toContain('max-width: calc(100dvw - 2 * var(--vc-padding))');
  });
});

test.describe('стекло и запасной фон', () => {
  test('фон полупрозрачный и присутствует backdrop-filter', async ({ page }) => {
    const snapshot = await readSnapshot(page);

    // Полупрозрачность держится на `color-mix` с `transparent`, а не на
    // восьмизначном `#ffffffcc`: запасной вариант ниже подставляет непрозрачный
    // токен, и он обязан отличаться от того, что видит браузер сейчас.
    expect(alphaOf(snapshot.backgroundColor)).toBeGreaterThan(0);
    expect(alphaOf(snapshot.backgroundColor)).toBeLessThan(1);
    expect(snapshot.backgroundColor).not.toBe(snapshot.solidBackground);

    // Размытие читается и по префиксованному имени: старые WebKit-сборки знают
    // только `-webkit-backdrop-filter`. Вычисленное значение при этом
    // нормализуется (`saturate(180%)` → `saturate(1.8)`), поэтому форма
    // проверяется по файлу, а применение — по движку.
    const applied = await page.evaluate(() => {
      const style = getComputedStyle(/** @type {HTMLElement} */ (document.getElementById('m')));
      return [style.getPropertyValue('backdrop-filter'), style.getPropertyValue('-webkit-backdrop-filter')]
        .find((value) => value.includes('blur('));
    });
    expect(applied).toContain('blur(20px)');
    expect(applied).toMatch(/saturate\(/);

    const css = await readStylesheet(page.request);
    expect(css).toContain('backdrop-filter: blur(20px) saturate(180%)');
  });

  test('поддержка без backdrop-filter: под @supports not есть непрозрачный запасной фон', async ({ page }) => {
    // Чтение идёт через CSSOM, а не по тексту файла: текстовое тело at-rule
    // находит объявление где угодно внутри, и перенос подстановки из `.vc-menu`
    // в `.vc-list` оставил бы кейс зелёным, пока меню осталось бы без
    // запасного фона. Условие применить нельзя — все три движка понимают
    // `backdrop-filter` — поэтому проверяется оно само и его содержимое.
    const rule = await page.evaluate((path) => {
      for (const sheet of document.styleSheets) {
        const href = sheet.href;
        if (href === null || !href.endsWith(path)) {
          continue;
        }
        for (const candidate of sheet.cssRules) {
          if (candidate instanceof CSSSupportsRule) {
            const inner = Array.from(candidate.cssRules);
            const style = inner[0] instanceof CSSStyleRule ? inner[0].style : null;
            /**
             * @param {CSSStyleDeclaration} declaration
             * @returns {string[]} имена объявленных свойств, в порядке объявления.
             */
            const declared = (declaration) => {
              const names = [];
              for (let index = 0; index < declaration.length; index += 1) {
                names.push(declaration.item(index));
              }
              return names;
            };
            return {
              condition: candidate.conditionText,
              selectors: inner.map((entry) => {
                return entry instanceof CSSStyleRule ? entry.selectorText : null;
              }),
              properties: style === null ? [] : declared(style),
              background: style === null ? null : style.getPropertyValue('--vc-bg'),
              filter: style === null ? null : style.getPropertyValue('backdrop-filter'),
            };
          }
        }
      }
      return null;
    }, 'mycontext.css');

    expect(rule, 'CSSSupportsRule в таблице стилей').not.toBe(null);
    // Пробелы в сериализованном условии движок нормализует по-своему, поэтому
    // сравнение по смыслу, а не посимвольно.
    expect(rule?.condition.replace(/\s+/g, ' ')).toMatch(
      /^not \(backdrop-filter: blur\(1px\)\)$/,
    );
    // Селектор проверяется явно: запасной фон обязан достаться меню, а не списку.
    expect(rule?.selectors).toEqual(['.vc-menu']);
    expect(rule?.properties).toContain('--vc-bg');
    expect(rule?.background?.trim()).toBe('var(--vc-bg-solid)');
    expect(rule?.filter?.trim()).toBe('none');

    // Непрозрачность сплошного токена — то, ради чего подстановка и нужна.
    // Прежняя проверка вида `/^rgba?\(/` ничего не говорила о прозрачности:
    // `rgba(255,255,255,0.5)` ей удовлетворяет.
    const snapshot = await readSnapshot(page);
    expect(alphaOf(snapshot.solidBackground)).toBe(1);
    expect(snapshot.solidBackground).not.toBe(snapshot.backgroundColor);
  });
});

test.describe('каскад тем', () => {
  test('порядок каскада: медиазапрос раньше селектора [data-vc-theme="dark"]', async ({ request }) => {
    const css = await readStylesheet(request);
    const mediaAt = css.indexOf('@media (prefers-color-scheme: dark)');
    const autoAt = css.indexOf('.vc-menu[data-vc-theme="auto"]');
    const darkAt = css.indexOf('.vc-menu[data-vc-theme="dark"]');

    expect(mediaAt).toBeGreaterThan(-1);
    expect(autoAt).toBeGreaterThan(mediaAt);
    expect(darkAt).toBeGreaterThan(autoAt);
    // Селектор атрибута и правило в медиазапросе специфичности равны, поэтому
    // решает только порядок: вынеси `dark` внутрь медиазапроса — и он начнёт
    // зависеть от системной схемы, то есть потеряет явный выбор темы.
    expect(darkAt).toBeGreaterThan(blockEnd(css, css.indexOf('{', mediaAt)));
  });

  test('auto при светлой системной схеме оставляет светлый фон', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const snapshot = await readSnapshot(page);

    // Тёмный текст на светлом фоне: без автотемы по умолчанию и не разобраться.
    expect(relativeLuminance(parseColor(snapshot.text))).toBeLessThan(0.2);
  });

  test('auto при тёмной системной схеме меняет фон', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await readSnapshot(page);

    expect(relativeLuminance(parseColor(dark.text))).toBeGreaterThan(0.5);
    // Фон остался стеклом, а не стал непрозрачным: запасной вариант включается
    // по `@supports`, а не по теме.
    expect(alphaOf(dark.backgroundColor)).toBeGreaterThan(0);
    expect(alphaOf(dark.backgroundColor)).toBeLessThan(1);
  });

  test('явный dark побеждает светлую системную настройку', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await setTheme(page, 'dark');

    // Атрибут стоит, иначе кейс проверил бы не ту тему.
    expect(await page.getAttribute(MENU_SELECTOR, 'data-vc-theme')).toBe('dark');
    const dark = await readSnapshot(page);
    expect(relativeLuminance(parseColor(dark.text))).toBeGreaterThan(0.5);
  });

  test('явный light побеждает тёмную системную настройку', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await setTheme(page, 'light');

    expect(await page.getAttribute(MENU_SELECTOR, 'data-vc-theme')).toBe('light');
    const light = await readSnapshot(page);
    expect(relativeLuminance(parseColor(light.text))).toBeLessThan(0.2);
  });
});

test.describe('анимации', () => {
  test('applyAnimationDuration прописывает --vc-animation-duration равным переданному значению', async ({ page }) => {
    await setAnimationDuration(page, 40);
    const snapshot = await readSnapshot(page);

    expect(snapshot.durationToken.trim()).toBe('40ms');
    // Токен обязан быть не просто записан, а взят переходами: иначе подмена
    // длительности была бы мёртвой.
    expect(Number.parseFloat(snapshot.transitionDuration)).toBeCloseTo(0.04, 5);
  });

  test('длительность по умолчанию равна DEFAULT_ANIMATION_DURATION', async ({ page }) => {
    const snapshot = await readSnapshot(page);
    expect(snapshot.durationToken.trim()).toBe(`${DEFAULT_ANIMATION_DURATION}ms`);
    expect(Number.parseFloat(snapshot.transitionDuration)).toBeCloseTo(
      DEFAULT_ANIMATION_DURATION / 1000,
      5,
    );
  });

  test('reduced-motion обнуляет длительность и отключает transform', async ({ page }) => {
    // Контрольное измерение без `reduce`: transform у открытого меню есть, и
    // сравнение с ним доказывает, что проверка ниже не тождество.
    expect((await readSnapshot(page)).transform).not.toBe('none');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await readSnapshot(page);

    // Обнуление, а не укорочение: при любом положительном значении скрытое меню
    // ещё доживало бы отложенного `hidePopover()` и съедало бы клики по странице.
    expect(reduced.durationToken.trim()).toMatch(/^0m?s$/);
    expect(Number.parseFloat(reduced.transitionDuration)).toBe(0);
    expect(reduced.transform).toBe('none');

    const block = readBlock(
      await readStylesheet(page.request),
      '@media (prefers-reduced-motion: reduce)',
    );
    expect(block).toContain('--vc-animation-duration: 0ms');
    expect(block).toContain('transform: none');

    // Первое открытие при `reduce` обязано быть мгновенным: меню видно сразу, без
    // ожидания, и переходов нет вовсе — иначе стартовое значение из
    // `@starting-style` задержало бы появление на всю ненулевую длительность.
    const entry = await readEntry(page);
    expect(entry.immediate).toBe('1');
    expect(entry.running).toEqual([]);
  });

  test('reduced-motion побеждает инлайновую длительность', async ({ page }) => {
    // Столкновение, которое не видит кейс выше: тот не зовёт публичный API, а
    // `applyAnimationDuration` пишет токен в инлайновый стиль. Инлайновое
    // объявление перебивает любое авторское правило, включая правило внутри
    // `@media`, поэтому обнуление токена в медиазапросе тут бессильно.
    await setAnimationDuration(page, 120);

    // Столкновение действительно воспроизведено: без этой проверки кейс прошёл бы
    // и при провале `setAnimationDuration`, то есть проверял бы не то.
    const inline = await page.evaluate(() => {
      return /** @type {HTMLElement} */ (document.getElementById('m')).style
        .getPropertyValue('--vc-animation-duration');
    });
    expect(inline.trim()).toBe('120ms');
    // До `reduce` инлайновое значение действительно governs: длительность 0.12s.
    expect(Number.parseFloat((await readSnapshot(page)).transitionDuration)).toBeCloseTo(0.12, 5);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await readSnapshot(page);
    // Переходы не просто получили нулевую длительность, а выключены как класс
    // свойств: `transition: none` даёт `transition-property: none`. Инлайновый
    // токен при этом никуда не делся — его перебило правило медиазапроса, и
    // поэтому проверять надо поведение, а не значение токена.
    expect(reduced.transitionProperty).toBe('none');
    expect(reduced.transitionDuration).toBe('0s');
    expect(reduced.transform).toBe('none');
    expect(inline.trim()).toBe('120ms');

    // Наблюдение идёт на меню, которое само несёт инлайновую длительность: у
    // свежего узла инлайновый стиль исходного `#m` не наследуется, и проверка
    // прошла бы мимо столкновения.
    const entry = await readEntry(page, 120);
    expect(entry.immediate).toBe('1');
    // Ни одного перехода: без `transition: none` в медиазапросе длительность
    // осталась бы 0.12s, переходы пошли бы, и кейс упал бы здесь.
    expect(entry.running).toEqual([]);
  });

  test('появление: используется @starting-style и transition-behavior allow-discrete', async ({ page, request }) => {
    // `@starting-style` не виден в вычисленных стилях, поэтому его наличие
    // проверяется по файлу...
    const css = await readStylesheet(request);
    expect(css).toContain('@starting-style');
    // ...а `allow-discrete` виден, и без него элемент исчезает из Top Layer мгновенно.
    expect(css).toContain('transition-behavior: allow-discrete');

    const snapshot = await readSnapshot(page);
    expect(snapshot.transitionBehavior).toBe('allow-discrete');
    // `display` в списке — обязательная часть: ради него и включён `allow-discrete`.
    expect(snapshot.transitionProperty.split(',').map((value) => value.trim())).toEqual([
      'opacity',
      'transform',
      'display',
    ]);
    expect(snapshot.opacity).toBe('1');

    // Появление наблюдается вживую: в кадре показа снимается стартовое значение,
    // а по `getAnimations()` — что переходы действительно идут, то есть
    // до-изменяемое состояние у элемента было.
    const entry = await readEntry(page);
    expect(Number(entry.immediate)).toBeLessThan(1);
    expect(Number(entry.settled)).toBe(1);
    expect(entry.running).toContain('opacity');
    expect(entry.running).toContain('transform');
  });
});

test.describe('пункты и состояния', () => {
  test('сетка пункта — три колонки, боковые зарезервированы всегда', async ({ page }) => {
    const snapshot = await readSnapshot(page);
    // Значения колонок приходят вычисленными, в пикселях: и ширина слота, и
    // ширина шеврона обязаны быть заняты независимо от содержимого.
    const columns = snapshot.gridTemplateColumns.split(' ').map((value) => {
      return Number.parseFloat(value);
    });
    expect(columns).toHaveLength(3);
    expect(columns[0]).toBe(DEFAULT_ICON_SIZE);
    expect(columns[2]).toBe(DEFAULT_CHEVRON_SIZE);
    // Средняя колонка тянется, а не замирает на ширине лейбла.
    expect(columns[1]).toBeGreaterThan(DEFAULT_ICON_SIZE);
  });

  test('лейблы пунктов с иконкой и без совпадают по координате', async ({ page }) => {
    const offsets = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      // Иконка кладётся в первый пункт, у второго слот пуст: одинаковая координата
      // лейблов доказывает, что колонка зарезервирована всегда.
      const slot = /** @type {HTMLElement} */ (document.getElementById('slot'));
      const icon = renderIcon({
        type: 'svg',
        value: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
          + '<path d="M2 2h12v12H2z" fill="currentColor"/></svg>',
      });
      slot.appendChild(icon);

      /**
       * @param {string} id
       * @returns {number} левая граница элемента.
       */
      const left = (id) => {
        return /** @type {HTMLElement} */ (document.getElementById(id)).getBoundingClientRect().left;
      };
      return {
        withIcon: left('label-active'),
        withoutIcon: left('label-plain'),
        // У svg-узла класса нет, и оформляет его слот, а не сам узел.
        iconClass: icon.getAttribute('class'),
        iconWidth: icon.getBoundingClientRect().width,
      };
    });

    expect(offsets.withIcon).toBe(offsets.withoutIcon);
    expect(offsets.iconClass).toBe(null);
    expect(offsets.iconWidth).toBe(DEFAULT_ICON_SIZE);
  });

  test('ни одно правило не опирается на класс vc-icon у svg-узла', async ({ request }) => {
    const css = await readStylesheet(request);

    // `renderIcon` не ставит класс svg-узлу намеренно, поэтому класс встречается
    // ровно одним селектором и ни в какой связке: иначе часть правил молча
    // перестала бы применяться к svg-иконкам. Имя слота, `vc-icon-slot`, ловушка
    // по префиксу, поэтому проверка идёт по классу из целого слова.
    const withClass = readSelectors(css).filter((selector) => {
      return /(?<![\w-])\.vc-icon(?![\w-])/.test(selector);
    });
    expect(withClass).toEqual(['.vc-icon']);
  });

  test('активный пункт помечен [data-active], а не фокусом', async ({ page }) => {
    const result = await page.evaluate(() => {
      const active = /** @type {HTMLElement} */ (document.querySelector('.vc-item[data-active]'));
      const plain = /** @type {HTMLElement} */ (
        document.querySelector('.vc-item:not([data-active])')
      );
      // Фокус на пункте без `data-active` обязан оставить вид обычного пункта:
      // при открытии подменю мышью подсветка мигала бы иначе.
      plain.focus();
      return {
        activeBackground: getComputedStyle(active).backgroundColor,
        focusedBackground: getComputedStyle(plain).backgroundColor,
        focusMoved: document.activeElement === plain,
      };
    });

    expect(result.focusMoved).toBe(true);
    expect(result.activeBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(result.activeBackground).not.toBe(result.focusedBackground);
  });

  test('видимость фокуса не запрещена', async ({ page, request }) => {
    const css = await readStylesheet(request);

    // Запрещено ровно одно: подсветка активного пункта не должна ключеваться на
    // голом `:focus`. Проверка по классу из целого слова, потому что предложенный
    // `/[^-]:focus\b/` матчил бы и `:focus-visible` — между `focus` и `-visible`
    // есть граница слова, и кольцо фокуса было бы запрещено вместе с запретом
    // самого фокуса.
    expect(css, 'голый селектор :focus').not.toMatch(/(?<!-):focus(?!-)/);

    // Кольцо обязано быть объявлено, а не только не запрещено: `data-active`
    // совпадает с фокусом при клавиатурной навигации, но не обязан совпадать
    // всегда, и без кольца клавиатурный пользователь теряет признак фокуса.
    const ringRules = readRules(css).filter((rule) => rule.selector.includes(':focus-visible'));
    expect(ringRules.length).toBeGreaterThan(0);
    expect(ringRules.map((rule) => rule.selector)).toContain('.vc-item:focus-visible');
    expect(readRule(css, '.vc-item:focus-visible')).toMatch(/outline:\s*2px solid/);

    // `outline: none` у меню и списка означал бы, что фокус на уровне не виден
    // вовсе: браузерное кольцо погашено, а своего никто не рисует.
    expect(readRule(css, '.vc-menu')).not.toContain('outline');
    expect(readRule(css, '.vc-list')).not.toContain('outline');

    // И вживую: Tab по спецификации 9.1 ставит фокус на активный пункт, и кольцо
    // у него есть.
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const active = /** @type {HTMLElement} */ (document.querySelector('.vc-item[data-active]'));
      return {
        isActive: document.activeElement === active,
        width: getComputedStyle(active).outlineWidth,
        style: getComputedStyle(active).outlineStyle,
      };
    });
    expect(focused.isActive).toBe(true);
    expect(focused.width).toBe('2px');
    expect(focused.style).toBe('solid');
  });

  test('контраст активного пункта не ниже 4.5:1 в обеих темах', async ({ page }) => {
    for (const [theme, scheme] of THEME_CASES) {
      const result = await readActiveRow(page, theme, scheme);
      // 1.29:1 на тонированной заливке — это не «слабо», это нечитаемо, поэтому
      // порог берётся из AA для текста, а не «на глаз».
      expect(result.ratio, `контраст активного пункта, ${theme}/${scheme}`)
        .toBeGreaterThanOrEqual(4.5);
      expect(result.opaque, `непрозрачность заливки, ${theme}/${scheme}`).toBe(true);
      expect(result.chevronMatches, `цвет шеврона, ${theme}/${scheme}`).toBe(true);
    }
  });

  test('токен --vc-active-bg существует и по умолчанию равен акценту', async ({ page, request }) => {
    // Ручка настройки входит в публичную поверхность: спека 11 перечисляет токен,
    // и таблица токенов в README унаследует его. Объявлен он обязан быть во всех
    // трёх палитрах, иначе одна тема осталась бы без ручки, а кейс по умолчанию
    // был бы зелёным.
    const css = await readStylesheet(request);
    for (const selector of THEME_SELECTORS) {
      expect(readRule(css, selector), `токен в палитре ${selector}`)
        .toContain('--vc-active-bg: var(--vc-accent)');
    }

    // И вживую: ручка равна акценту по умолчанию, то есть ни одна тема не теряет
    // контраст. Обход идёт по всем трём палитрам, а не по двум системным схемам:
    // под `auto` тёмную палитру `[data-vc-theme="dark"]` вообще не достать.
    for (const [theme, scheme] of THEME_CASES) {
      const result = await readActiveRow(page, theme, scheme);
      expect(result.activeBg, `--vc-active-bg против --vc-accent, ${theme}/${scheme}`)
        .toBe(result.accent);
      expect(result.ratio, `контраст с ручкой на месте, ${theme}/${scheme}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  test('разделитель — тонкая линия, а шеврон разворачивается по data-chevron', async ({ page }) => {
    const result = await page.evaluate(() => {
      const separator = /** @type {HTMLElement} */ (document.querySelector('.vc-separator'));
      /**
       * @param {string} id
       * @returns {string}
       */
      const transform = (id) => {
        return getComputedStyle(/** @type {HTMLElement} */ (document.getElementById(id))).transform;
      };
      return {
        height: separator.getBoundingClientRect().height,
        background: getComputedStyle(separator).backgroundColor,
        right: transform('chevron-right'),
        left: transform('chevron-left'),
      };
    });

    expect(result.height).toBe(1);
    expect(result.background).not.toBe('rgba(0, 0, 0, 0)');
    // Шеврон, которому нечего разворачивать, повёрнут только вместе с пунктом:
    // в спокойном состоянии `transform` не задан.
    expect(result.right).toBe('none');

    // Разворот — это поворот на 180°, то есть масштаб `(-1, -1)`.
    const found = /matrix\(([^)]+)\)/.exec(result.left);
    expect(found, `transform шеврона: ${result.left}`).not.toBe(null);
    const matrix = /** @type {string[]} */ (/** @type {unknown} */ (found))[1]
      .split(',')
      .map((part) => Number(part.trim()));
    expect(matrix[0]).toBeCloseTo(-1, 5);
    expect(matrix[3]).toBeCloseTo(-1, 5);
  });
});
