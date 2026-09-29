import { expect, test } from '@playwright/test';
import {
  DEFAULT_ANIMATION_DURATION,
  DEFAULT_CHEVRON_SIZE,
  DEFAULT_ICON_SIZE,
  DEFAULT_ITEM_HEIGHT,
  DEFAULT_RADIUS,
  SAFETY_PADDING,
  SCROLL_ZONE_HEIGHT,
} from '../../src/constants.js';
import { resolveColor } from '../helpers/resolveColor.js';

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
 * Тёмные палитры файла. Отдельно от `THEME_SELECTORS` — потому что у них своя
 * плотность наведения, и это отдельное дизайнерское решение, а не перенос
 * светлого значения.
 */
const DARK_SELECTORS = THEME_SELECTORS.slice(1);

/** Плотность наведения в тёмных палитрах, ровно как она записана в файле. */
const DARK_HOVER_BG = 'color-mix(in srgb, var(--vc-text) 10%, transparent)';

/**
 * Цвет заблокированной зоны, ровно как он записан в каркасе.
 *
 * Отдельный `color-mix`, а не `--vc-muted` целиком: зона, до которой не до
 * доскроллить, обязана читаться как недоступная, а не как доступная и не
 * наведённая.
 */
const BLOCKED_ZONE_COLOR = 'color-mix(in srgb, var(--vc-muted) 40%, transparent)';

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
 * Снимок вычисленных стилей открытого меню. Снимок снимается тремя заходами в
 * страницу: `getComputedStyle` дорог, а половина кейсов нуждается сразу и в палитре,
 * и в переходах, — но токены приходится приводить `resolveColor`, а приведённая
 * запись токена не годится в сравнении с `rgb()` движка, поэтому один заход в
 * страницу снимок не покрывает. Цвета возвращаются строками: математику по ним
 * делает сам тест, чтобы правила WCAG жили в одном месте.
 *
 * @typedef {object} ThemeSnapshot
 * @property {string} backgroundColor вычисленный цвет фона меню.
 * @property {string} solidBackground цвет из токена `--vc-bg-solid`: то, что
 *   подставляет запасной вариант без `backdrop-filter`.
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
 * @property {string} flexShrink вычисленный `flex-shrink` пункта. Сорванное
 *   переполнение: при `1` уровень длиннее `max-height` сожмётся вместо того, чтобы
 *   переполниться, и `.vc-list` перестанет прокручиваться.
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
        <div class="vc-item" role="menuitem" tabindex="-1" aria-disabled="true" id="item-disabled">
          <span class="vc-icon-slot"></span>
          <span class="vc-label">Отключено</span>
          <span class="vc-chevron"></span>
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
  <!-- Фон страницы задан явно: по умолчанию фон body прозрачный, и композит
       поверх прозрачного чёрного занижал бы результат для полупрозрачной
       подложки. Дальше он входит ровно в одно измерение, ratio из
       readActiveRow, — потому что заливка активного пункта полупрозрачна и
       страница под стеклом её дочитывает. Остальные отношения контраста
       считаются поверх стекла меню: под меню глаз видит меню, а страницу под
       ним — сквозь два слоя прозрачности. -->
  <body style="background: rgb(255, 255, 255)">
    <!-- tabindex="-1" и role="menu" — то, что ставит renderLevel: фокус на
         элементе уровня держит состояние «выделения нет, а уровень отвечает на
         клавиши», и без него кейсы про фокус мерили бы разметку, которой
         рендерер не производит. -->
    <div id="m" class="vc-menu" popover="manual" role="menu" tabindex="-1">${MENU_CONTENT_HTML}</div>
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
 * Тело блока без фигурных скобок, чтобы его можно было разобрать как правила.
 *
 * @param {string} css сплющенный текст таблицы стилей.
 * @param {string} marker начало блока.
 * @returns {string} содержимое блока.
 */
function readBlockBody(css, marker) {
  return readBlock(css, marker).slice(1, -1);
}

/**
 * Вес селектора по числу классов, атрибутов и псевдоклассов.
 *
 * Считается по одной части списка селекторов, и это единственный способ получить
 * осмысленный ответ. Подсчёт по всему списку даёт одинаковое число и при
 * удвоении, и без него: в `.vc-menu, .vc-menu:popover-open, .vc-menu *` вхождений
 * `.vc-menu` четыре в обоих случаях, и проверка «не меньше двух» проходила бы
 * всегда.
 *
 * Псевдоэлементы не учитываются: `::before` веса не добавляет, и его нельзя
 * считать. Отсюда `(?<!:)` в шаблоне — без него вторая двоеточие из `::` проходит
 * проверку `(?!:)` и псевдоэлемент засчитывается как псевдокласс, а это ровно
 * тот случай, в котором проверка молча проходит на сломанном CSS. Идентификаторы
 * не учитываются по той же причине: в этом файле их нет.
 *
 * @param {string} component одна часть списка селекторов.
 * @returns {number} число классов, атрибутов и псевдоклассов.
 */
function classWeight(component) {
  return (component.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) ?? []).length;
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
  const measured = await page.evaluate(() => {
    const menu = /** @type {HTMLElement} */ (document.getElementById('m'));
    const list = /** @type {HTMLElement} */ (document.querySelector('.vc-list'));
    const item = /** @type {HTMLElement} */ (document.querySelector('.vc-item'));
    const style = getComputedStyle(menu);

    return {
      backgroundColor: style.backgroundColor,
      // Токены едут отдельными значениями: приводит их к вычисленным цветам
      // `resolveColor`, и второй заход в страницу для них — плата за то, что
      // трюк один на проект, а не за то, что он дорог.
      solidToken: style.getPropertyValue('--vc-bg-solid'),
      textToken: style.getPropertyValue('--vc-text'),
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
      flexShrink: getComputedStyle(item).flexShrink,
    };
  });
  const [solidBackground, text] = await Promise.all([
    resolveColor(page, measured.solidToken),
    resolveColor(page, measured.textToken),
  ]);
  return {
    backgroundColor: measured.backgroundColor,
    solidBackground,
    text,
    paddingToken: measured.paddingToken,
    itemHeightToken: measured.itemHeightToken,
    iconSizeToken: measured.iconSizeToken,
    chevronSizeToken: measured.chevronSizeToken,
    radiusToken: measured.radiusToken,
    durationToken: measured.durationToken,
    maxHeight: measured.maxHeight,
    maxWidth: measured.maxWidth,
    listMaxHeight: measured.listMaxHeight,
    opacity: measured.opacity,
    transform: measured.transform,
    transitionBehavior: measured.transitionBehavior,
    transitionProperty: measured.transitionProperty,
    transitionDuration: measured.transitionDuration,
    gridTemplateColumns: measured.gridTemplateColumns,
    flexShrink: measured.flexShrink,
  };
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
 * `tonedRatio` и `disabledRatio` считают композит только двух слоёв — заливки
 * строки и стекла меню, — и страница в них не участвует. Это не огрубление, а
 * предмет контракта: заливка активного пункта полупрозрачна by design, и глаз
 * читает строку поверх стекла; страница под стеклом — третий слой, и в тёмной
 * палитре поверх белой страницы фикстуры она занизила бы отношение до значения,
 * которого под настоящим меню не бывает. `ratio` страницу учитывает: там
 * измеряется весь столб подложки, и пропускать его нельзя.
 *
 * @typedef {object} ActiveRow
 * @property {string} label цвет текста активной строки.
 * @property {string} rowBg вычисленный фон активной строки.
 * @property {string} activeBg разрешённый `--vc-active-bg`.
 * @property {string} hoverBg разрешённый `--vc-hover-bg`.
 * @property {string} muted разрешённый `--vc-muted`.
 * @property {string} disabledLabel цвет текста отключённого пункта.
 * @property {string} disabledBg вычисленный фон отключённого пункта. Заливки у
 *   него не бывает: в цикл роуминга он не входит и отметку получить не может.
 * @property {number} ratio контраст `label` к композиту `rowBg` → `menuBg` →
 *   страница, 1..21.
 * @property {number} tonedRatio контраст `label` к композиту `hoverBg` → `menuBg`.
 * @property {number} disabledRatio контраст `disabledLabel` к композиту
 *   `disabledBg` → `menuBg`: то же отношение, что и `tonedRatio`, для строки,
 *   которой заливка не полагается.
 */

/**
 * Ставит системную схему и меряет активную строку.
 *
 * Отдельная функция, а не тело кейса: контраст считают три кейса, и три копии
 * расчёта разъехались бы при первой же правке палитры.
 *
 * Тема ставится явно, а не остаётся `auto` из `beforeEach`: палитра
 * `[data-vc-theme="dark"]` иначе не достаётся вовсе, и кейс молча проверял бы
 * только медиазапрос.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'auto'|'light'|'dark'} theme тема оформления.
 * @param {'light' | 'dark'} scheme системная схема.
 * @param {boolean} [disabled] поставить ли `aria-disabled` на активную строку —
 *   состояние, которого движок роуминга не производит.
 * @returns {Promise<ActiveRow>}
 */
async function readActiveRow(page, theme, scheme, disabled = false) {
  await page.emulateMedia({ colorScheme: scheme });
  await setTheme(page, theme);
  const measured = await page.evaluate((isDisabled) => {
    const menu = /** @type {HTMLElement} */ (document.getElementById('m'));
    const active = /** @type {HTMLElement} */ (
      document.querySelector('.vc-item[data-active]')
    );
    if (isDisabled) {
      active.setAttribute('aria-disabled', 'true');
    }
    // Отключённый пункт фикстуры — отдельная строка, а не та же самая: её заливка
    // обязана отсутствовать там, где у отмеченной строки заливка есть. Ищется по
    // `id`, а не составным селектором: сообщение об отсутствии узла должно
    // указывать на узел, а составной селектор повторял бы `:not([data-active])`,
    // который задача сняла с таблицы стилей.
    const disabledRow = document.getElementById('item-disabled');
    if (!(disabledRow instanceof HTMLElement)) {
      throw new Error('в фикстуре нет узла item-disabled');
    }
    const menuStyle = getComputedStyle(menu);

    return {
      // Цвета строки: её собственный фон, её текст и фон подложки, на которую
      // этот фон ложится.
      row: getComputedStyle(active).backgroundColor,
      label: getComputedStyle(active).color,
      menu: menuStyle.backgroundColor,
      // Под меню лежит страница: её фон участвует в композите, потому что
      // фон меню сам по себе полупрозрачный. В фикстуре он непрозрачный, иначе
      // модель считала бы композит поверх прозрачного чёрного.
      page: getComputedStyle(document.body).backgroundColor,
      activeToken: menuStyle.getPropertyValue('--vc-active-bg'),
      hoverToken: menuStyle.getPropertyValue('--vc-hover-bg'),
      mutedToken: menuStyle.getPropertyValue('--vc-muted'),
      disabledLabel: getComputedStyle(disabledRow).color,
      disabledBg: getComputedStyle(disabledRow).backgroundColor,
    };
  }, disabled);
  const [activeBg, hoverBg, muted] = await Promise.all([
    resolveColor(page, measured.activeToken),
    resolveColor(page, measured.hoverToken),
    resolveColor(page, measured.mutedToken),
  ]);
  // Стекло меню, дочитанное страницей под ним, — подложка для полного столба.
  const glass = composite(parseColor(measured.menu), parseColor(measured.page));
  return {
    label: measured.label,
    rowBg: measured.row,
    activeBg,
    hoverBg,
    muted,
    disabledLabel: measured.disabledLabel,
    disabledBg: measured.disabledBg,
    ratio: contrast(parseColor(measured.label), composite(parseColor(measured.row), glass)),
    tonedRatio: contrast(
      parseColor(measured.label),
      composite(parseColor(hoverBg), parseColor(measured.menu)),
    ),
    // Прозрачная заливка отключённого пункта в композит не вносит ничего, и
    // `composite` отдаёт под ним стекло меню — ровно то, на чём строка стоит.
    disabledRatio: contrast(
      parseColor(measured.disabledLabel),
      composite(parseColor(measured.disabledBg), parseColor(measured.menu)),
    ),
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

/**
 * Живой экземпляр меню, поставленный в страницу кейса.
 *
 * @typedef {object} LiveMenu
 * @property {import('../../src/MyContext.js').MyContext} menu
 * @property {HTMLElement} trigger кнопка, привязанная к меню: по ней открывают
 *   его с клавиатуры.
 */

/**
 * Ставит в страницу живой экземпляр `MyContext`, оставляя ручку в `globalThis`.
 *
 * Фикстура `MENU_HTML` показывает оформление, но роуминга в ней нет: отметку
 * `data-active` ставит движок, а писатель у него один — `src/keyboard.js`.
 * Кейсы про наведение и про клавиатуру меряли бы на фикстуре разметку, которую
 * никто не пишет, то есть проверяли бы сами себя.
 *
 * Экземпляр намеренно не открывается: один кейс открывает его программно, другой
 * — с клавиатуры, и для второго модальность ввода должна задать настоящее
 * нажатие до фокуса, иначе `:focus-visible` не сработает.
 *
 * Фикстура `#m` прячется, а не удаляется: её оформление проверяют остальные кейсы
 * файла, и живое меню в том же Top Layer перекрыло бы её собой.
 *
 * Пункты и предикат доступности в страницу не передаются: `page.evaluate` не
 * сериализует функции в аргумент, поэтому едет форма — число пунктов и индексы
 * недоступных, — а подписи и `isEnabledAction` заводятся уже на месте.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ count: number, dead?: number[] }} form форма набора: сколько пунктов и
 *   какие из них недоступны.
 * @returns {Promise<void>}
 */
async function mountLiveMenu(page, form) {
  // `reduce` убирает и входной переход `scale`, и отложенное закрытие: под ним
  // показ синхронен, то есть рамки пунктов, снятые сразу после `open()`, суть
  // рамки показанного меню.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async ({ count, dead }) => {
    const { MyContext } = await import('../../src/MyContext.js');
    const fixture = document.getElementById('m');
    if (fixture instanceof HTMLElement) {
      fixture.hidePopover();
    }
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = 'live-trigger';
    document.body.appendChild(trigger);
    const entries = Array.from({ length: count }, (unused, index) => {
      return {
        labelAction: () => `Пункт ${index + 1}`,
        isEnabledAction: () => {
          return !dead.includes(index);
        },
      };
    });
    const menu = new MyContext(entries, { label: 'Меню пробы' });
    menu.attach(trigger);
    trigger.focus();
    const scope = /** @type {{ __live?: LiveMenu }} */ (/** @type {unknown} */ (globalThis));
    scope.__live = { menu, trigger };
  }, { count: form.count, dead: form.dead ?? [] });
}

/**
 * Открывает поставленное живое меню в точке вызова.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point точка вызова в координатах вьюпорта.
 * @returns {Promise<void>}
 */
async function openLiveMenu(page, point) {
  await page.evaluate((anchor) => {
    const scope = /** @type {{ __live?: LiveMenu }} */ (/** @type {unknown} */ (globalThis));
    if (scope.__live === undefined) {
      throw new Error('живое меню не поставлено');
    }
    scope.__live.menu.open(anchor);
  }, point);
}

/**
 * Открывает поставленное живое меню без мыши: нажатием клавиши и `contextmenu`
 * на сфокусированном контейнере.
 *
 * Событие отправляется из страницы, а не клавишей контекстного меню, и это
 * осознанно: `Shift+F10` и `ContextMenu` поднимают `contextmenu` только в
 * Chromium, а Firefox и WebKit молчат, и кейс про кольцо ходил бы по разным
 * дорогам в зависимости от движка. Настоящим остаётся то, что кольцо измеряет:
 * клавиатурная модальность — от живого нажатия, обработчик привязки и фокус
 * элемента уровня — от библиотеки.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function openLiveMenuByKeyboard(page) {
  // Клавиша, ничего не значащая для кнопки, но настоящая: именно её браузер
  // считает вводом с клавиатуры, и по ней решает, видим ли фокус на уровне.
  await page.keyboard.press('ArrowDown');
  await page.evaluate(() => {
    const scope = /** @type {{ __live?: LiveMenu }} */ (/** @type {unknown} */ (globalThis));
    if (scope.__live === undefined) {
      throw new Error('живое меню не поставлено');
    }
    const trigger = scope.__live.trigger;
    const box = trigger.getBoundingClientRect();
    trigger.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 2,
      clientY: box.top + 2,
    }));
  });
}

/**
 * Состояние одной зоны прокрутки.
 *
 * @typedef {object} ScrollZoneState
 * @property {string} display вычисленный `display` зоны.
 * @property {string} height вычисленная высота зоны. У скрытой зоны она остаётся
 *   токеном, поэтому нулевой высоты здесь не бывает.
 * @property {number} box высота зоны по рамке, px: у скрытой зоны `0`.
 */

/**
 * Состояние обеих зон прокрутки показанного уровня.
 *
 * Высота меряется двумя способами, и это не перестраховка: для скрытого элемента
 * `getComputedStyle` отдаёт вычисленное, а не использованное значение, то есть
 * токен высоты, и «нулевая высота» получается только по рамке.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ up: ScrollZoneState, down: ScrollZoneState }>}
 */
async function readScrollZones(page) {
  return page.evaluate(() => {
    const level = document.querySelector('.vc-menu:popover-open');
    if (level === null) {
      throw new Error('живое меню не показано');
    }
    /**
     * @param {string} selector класс зоны.
     * @returns {ScrollZoneState}
     */
    const zone = (selector) => {
      const element = level.querySelector(selector);
      if (element === null) {
        throw new Error(`у живого уровня нет зоны ${selector}`);
      }
      const style = getComputedStyle(element);
      return {
        display: style.display,
        height: style.height,
        box: element.getBoundingClientRect().height,
      };
    };
    return { up: zone('.vc-scroll-zone-up'), down: zone('.vc-scroll-zone-down') };
  });
}

/**
 * Снимает `data-vc-scrollable` с показанного уровня руками.
 *
 * Проверяется таблица стилей, а не слой. Признак на показе ставит слой, и наличие
 * его читается без посторонней помощи, а вот состояние без признака иначе не
 * наступило бы: снять его некому, и зоны на коротком списке не показать было бы
 * нечем.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function clearLevelScrollable(page) {
  await page.evaluate(() => {
    const level = document.querySelector('.vc-menu:popover-open');
    if (level === null) {
      throw new Error('живое меню не показано');
    }
    level.removeAttribute('data-vc-scrollable');
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

    // Ограничение списка имеет смысл, только если уровень может переполниться.
    // При `flex-shrink: 1` у пункта длинный уровень сжимается вместо переполнения:
    // `scrollHeight` сравнялся бы с `clientHeight`, `.vc-list` не прокручивался бы,
    // и `overflow-y: auto` вместе с `max-height` были бы мёртвыми объявлениями.
    // Пункт — элемент списка, а не меню, поэтому и свойство другое.
    expect(snapshot.flexShrink).toBe('0');
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

test.describe('прокручиваемый список', () => {
  test('у прокручиваемого списка системной полосы нет', async ({ page, request }) => {
    const css = await readStylesheet(request);

    // Полосы в файле нет вовсе, и все три утверждения отрицательные: токен
    // бегунка, `scrollbar-color`, который покрасил бы дорожку, и вебкитовские
    // псевдоэлементы — в движке без `scrollbar-width` они нарисовали бы полосу
    // вопреки `none`.
    expect(css, 'токен бегунка удалён').not.toContain('--vc-scrollbar-thumb');
    expect(css, 'цвет полосы удалён').not.toContain('scrollbar-color');
    expect(css, 'вебкитовские псевдоэлементы полосы').not.toContain('::-webkit-scrollbar');

    // Полосу скрывает правило самого списка, а не уровня: прокручивается
    // `.vc-list`, и объявление на `.vc-menu` досталось бы контейнеру, который не
    // скроллится. Проверка по блоку, а не по файлу: те же объявления в соседнем
    // правиле прошли бы здесь молча.
    const list = readBlock(css, '.vc-list');
    expect(list, 'полоса скрыта правилом списка').toContain('scrollbar-width: none');
    // `overflow: hidden` не добавлен, и это отдельное утверждение: он погасил бы
    // и touch-скролл, который живёт в `overflow-y: auto`, то есть на телефоне
    // список перестал бы листаться вовсе. `scrollbar-width: none` убирает полосу
    // и ничего больше.
    expect(list, 'скролл списка не погашен').not.toContain('overflow: hidden');

    // Живая часть: показанный уровень длиннее рамки, и полосы у него нет. Фикстура
    // `#m` не годится: в ней переполнения нет вовсе. Сорок пунктов — та же длина,
    // что и в остальных кейсах файла.
    await mountLiveMenu(page, { count: 40 });
    await openLiveMenu(page, { x: 200, y: 200 });

    const measured = await page.evaluate(() => {
      // Показанный уровень, а не документ: спрятанная фикстура `#m` несёт свою
      // разметку и переполнена не была бы так, как переполняется живой уровень.
      const level = document.querySelector('.vc-menu:popover-open');
      if (level === null) {
        throw new Error('живое меню не показано');
      }
      const list = level.querySelector('.vc-list');
      if (list === null) {
        throw new Error('у живого уровня нет списка');
      }
      return {
        scrollable: list.scrollHeight > list.clientHeight,
        scrollbarWidth: getComputedStyle(list).scrollbarWidth,
        // Признак ставит слой на показе, и на живом прокручиваемом меню он есть.
        // Значение — пустая строка, а не `null`: его ставит `setAttribute` без
        // значения, и любое другое значение означало бы другого писателя.
        scrollableAttribute: level.getAttribute('data-vc-scrollable'),
      };
    });

    // Контроль переполнения обязателен: у списка, который не скроллится, полосы
    // нет по определению, и живые утверждения ниже были бы пустыми.
    expect(measured.scrollable, 'список действительно прокручивается').toBe(true);
    expect(measured.scrollableAttribute, 'признак прокручиваемости на уровне есть').toBe('');
    expect(measured.scrollbarWidth, 'полосы нет на живом списке').toBe('none');
  });

  test('зоны прокрутки: атрибут включает обе зоны, высота равна токену, глиф нарисован рамками', async ({ page, request }) => {
    const css = await readStylesheet(request);

    // Приглушённый цвет зоны смешан с `--vc-muted`, а тот свой у каждой палитры.
    // Берётся блок палитры, а не любое правило с селектором: у `.vc-menu` их в
    // файле несколько, и объявление в соседнем прошло бы здесь молча.
    for (const selector of THEME_SELECTORS) {
      expect(readBlock(css, selector), `приглушённый объявлен в палитре ${selector}`)
        .toMatch(/--vc-muted:\s/);
    }

    // `display: none` — состояние по умолчанию, а не украшение: разметку зон
    // создаёт рендерер в каждом уровне безусловно, и показывать их обязан
    // атрибут. Иначе короткий список получил бы две пустые полосы по краям.
    const zone = readRule(css, '.vc-scroll-zone');
    expect(zone, 'зона скрыта по умолчанию').toContain('display: none');
    // `flex: none` — обязательная часть блока, а не аккуратность: в
    // flex-колонке уровня зона иначе растянулась бы на остаток высоты, и упор
    // «конец списка» перестал бы означать конец.
    expect(zone, 'зона не растягивается').toContain('flex: none');
    // Высота зоны берётся из токена, а не пишется числом: иначе тема не смогла
    // бы подобрать зону под своё меню.
    expect(zone, 'высота зоны взята из токена').toContain('height: var(--vc-scroll-zone-height)');

    // Показ — единственное правило с атрибутом уровня: два показа по двум
    // селекторам разошлись бы с правкой одного.
    expect(readRule(css, '.vc-menu[data-vc-scrollable] .vc-scroll-zone'), 'показ зоны')
      .toContain('display: flex');
    // Упор гаснет, а не исчезает: исчезновение сдвинуло бы список под курсором
    // ровно в тот момент, когда он перестаёт им двигаться.
    expect(readRule(css, '.vc-scroll-zone[data-vc-blocked]'), 'упор приглушён')
      .toContain(`color: ${BLOCKED_ZONE_COLOR}`);
    // Подсветка достаётся только зоне, до которой есть куда идти: наведение на
    // упор выглядело бы обещанием, которое меню не сдержит.
    const hover = readRule(css, '.vc-scroll-zone:not([data-vc-blocked]):hover');
    expect(hover, 'наведение красит зону').toContain('background: var(--vc-hover-bg)');
    expect(hover, 'наведение возвращает цвет текста').toContain('color: var(--vc-text)');

    // Токен живёт в разделе 1, а не в палитрах: высота зоны — геометрия, и тема
    // её не перекрашивает. Константа закреплена числом, иначе токен и константа
    // одинаково съехали бы в сторону.
    expect(SCROLL_ZONE_HEIGHT).toBe(16);
    expect(readBlock(css, '.vc-menu'), 'токен высоты зоны')
      .toContain(`--vc-scroll-zone-height: ${SCROLL_ZONE_HEIGHT}px`);

    // Глиф рисуется двумя сторонами рамки, а не картинкой: он обязан переезжать
    // вместе с цветом зоны, который меняет и приглушение упора, и наведение.
    // Сам угол общий у обеих зон, а поворот — единственное, чем они разошлись.
    const glyph = readRule(css, '.vc-scroll-zone::before');
    expect(glyph, 'глиф зоны — срезанный угол').toContain('border-right: 1.5px solid currentColor');
    expect(glyph, 'глиф зоны — срезанный угол').toContain('border-bottom: 1.5px solid currentColor');
    expect(readRule(css, '.vc-scroll-zone-up::before'), 'верхняя зона смотрит вверх')
      .toContain('transform: rotate(225deg)');
    expect(readRule(css, '.vc-scroll-zone-down::before'), 'нижняя зона смотрит вниз')
      .toContain('transform: rotate(45deg)');

    // Живая часть: обе зоны — настоящие флекс-пункты уровня, и атрибут включает
    // их обе разом. Сорок пунктов — то же, что и в кейсе выше: короткий список
    // зон не показывает, и мерять было бы нечего.
    await mountLiveMenu(page, { count: 40 });
    await openLiveMenu(page, { x: 200, y: 200 });

    // Показ — состояние слоя, а не рук кейса: признак поставил слой на живом
    // уровне, и решение о прокручиваемости проверяется в его собственном кейсе.
    const shown = await readScrollZones(page);
    // Обе зоны, а не одна: показ задаёт одно правило, и список с упором только
    // вниз не должен терять верхнюю зону.
    expect(shown.up.display, 'верхняя зона показана по атрибуту').toBe('flex');
    expect(shown.down.display, 'нижняя зона показана по атрибуту').toBe('flex');
    // Рамка меряется отдельно от вычисленной высоты: токен мог бы разрешиться, а
    // места в колонке зона при этом не заняла бы.
    expect(shown.up.height, 'высота верхней зоны равна токену')
      .toBe(`${SCROLL_ZONE_HEIGHT}px`);
    expect(shown.down.height, 'высота нижней зоны равна токену')
      .toBe(`${SCROLL_ZONE_HEIGHT}px`);
    expect(shown.up.box, `верхняя зона занимает ${SCROLL_ZONE_HEIGHT}px`)
      .toBe(SCROLL_ZONE_HEIGHT);
    expect(shown.down.box, `нижняя зона занимает ${SCROLL_ZONE_HEIGHT}px`)
      .toBe(SCROLL_ZONE_HEIGHT);

    // Единственное, что кейс делает руками, — снятие признака: показать его иначе
    // нечего, слой уже показал.
    await clearLevelScrollable(page);
    const hidden = await readScrollZones(page);
    // Нулевая высота — это ещё и «меню не выросло»: зона в `display: none` не
    // занимает места в колонке уровня.
    expect(hidden.up.display, 'верхняя зона скрыта без атрибута').toBe('none');
    expect(hidden.up.box, 'верхняя зона не занимает место').toBe(0);
    expect(hidden.down.display, 'нижняя зона скрыта без атрибута').toBe('none');
    expect(hidden.down.box, 'нижняя зона не занимает место').toBe(0);
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

  test('поддержка без backdrop-filter: под @supports not есть непрозрачный запасной фон', async ({ page, request }) => {
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
              prefixedFilter: style === null
                ? null
                : style.getPropertyValue('-webkit-backdrop-filter'),
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

    // Набор объявлений сравнивается целиком: `toContain` по одному свойству
    // пропустил бы и лишнее объявление, и пропажу `-webkit-backdrop-filter: none`.
    //
    // Нормализация префикса не украшение, а необходимость: Chromium и WebKit
    // считают `-webkit-backdrop-filter` тем же свойством, что и без префикса, и
    // выкидывают из блока первое объявление, а Firefox хранит оба. Набор
    // приводится к одному виду, иначе утверждение зависело бы от движка.
    const normalized = [...new Set((rule?.properties ?? []).map((property) => {
      return property.replace(/^-webkit-/, '');
    }))].sort();
    expect(normalized).toEqual(['--vc-bg', 'backdrop-filter']);
    expect(rule?.background?.trim()).toBe('var(--vc-bg-solid)');
    expect(rule?.filter?.trim()).toBe('none');

    // Префиксанную запись проверяет движок, который её хранит, — старый WebKit
    // знает только `-webkit-backdrop-filter`, и ради него она и написана. Там,
    // где движок выкинул префикс как дубль, хватает проверки выше.
    if ((rule?.prefixedFilter ?? '').trim() !== '') {
      expect(rule?.properties).toContain('-webkit-backdrop-filter');
      expect(rule?.prefixedFilter?.trim()).toBe('none');
    }
    // Наличие обеих записей в файле проверяется отдельно: движок, выкинувший
    // префикс, не отличит удалённую строку от сохранённой.
    const block = readBlock(
      await readStylesheet(request),
      '@supports not (backdrop-filter: blur(1px))',
    );
    expect(block).toContain('-webkit-backdrop-filter: none');

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

  test('reduced-motion гасит переходы потомков, а не только меню', async ({ page, request }) => {
    // Шеврон выбран потому, что у него есть собственный переход: без покрытия
    // потомков кейс на меню остался бы зелёным, а движение на шевроне — нет.
    const readChevronTransition = () => {
      return page.evaluate(() => {
        const style = getComputedStyle(/** @type {HTMLElement} */ (
          document.getElementById('chevron-right')
        ));
        return { property: style.transitionProperty, duration: style.transitionDuration };
      });
    };

    // Контроль без `reduce`: переход у потомка есть, иначе проверка ниже была бы
    // тождественной.
    const before = await readChevronTransition();
    expect(before.property).toBe('transform');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await readChevronTransition();
    expect(reduced.property).toBe('none');
    expect(reduced.duration).toBe('0s');

    // Покрытие потомков держится на удвоенном классе. Каждая часть списка
    // селекторов проверяется отдельно: у `.vc-menu *` вес (0,1,0), и переход
    // (0,2,0) у потомка перебил бы его молча, а счёт по всему списку целиком дал
    // бы четыре вхождения и при удвоении, и без него, то есть не проверял бы
    // ничего.
    //
    // Именно эту половину кейса ломает снятие удвоения, в том числе с одной
    // руки списка. Поведенческая половина при этом остаётся зелёной: блок и так
    // последний в файле, поэтому при равном весе выигрывает он, и шеврон по-прежнему
    // считает переходы погашенными. Поведенческая половина ловит другое — пропажу
    // покрытия целиком, когда не остаётся ни одной руки с `*`.
    const rules = readRules(readBlockBody(
      await readStylesheet(request),
      '@media (prefers-reduced-motion: reduce)',
    ));
    const blanket = rules.filter((rule) => rule.selector.includes('*'));
    expect(blanket.length, 'руки покрытия потомков в блоке reduce').toBeGreaterThan(0);
    for (const rule of blanket) {
      for (const component of rule.selector.split(',')) {
        expect(
          classWeight(component),
          `вес покрытия потомков: ${component.trim()}`,
        ).toBeGreaterThanOrEqual(2);
      }
    }

    // Покрытие обязано быть и поведенческим, а не только структурным: нисходящее
    // `transition: none` не должно ждать, пока появится правило (0,2,0).
    const item = await page.evaluate(() => {
      const style = getComputedStyle(/** @type {HTMLElement} */ (
        document.querySelector('.vc-item[data-active]')
      ));
      return { property: style.transitionProperty };
    });
    expect(item.property).toBe('none');
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

  test('признак фокуса — заливка активного пункта, а не кольцо', async ({ page, request }) => {
    const css = await readStylesheet(request);

    // Запрещено ровно одно: подсветка активного пункта не должна ключеваться на
    // голом `:focus`. Проверка по классу из целого слова, потому что предложенный
    // `/[^-]:focus\b/` матчил бы и `:focus-visible` — между `focus` и `-visible`
    // есть граница слова, и кольцо фокуса было бы запрещено вместе с запретом
    // самого фокуса.
    expect(css, 'голый селектор :focus').not.toMatch(/(?<!-):focus(?!-)/);

    // Решение партнёра (спека 2026-09-28, раздел 2, решение 1): кольца нет ни
    // одного. Проверка по всем правилам файла, а не по одному селектору, —
    // вернуться кольцо может и под другим именем.
    expect(
      readRules(css).filter((rule) => rule.selector.includes(':focus-visible')),
      'правила с :focus-visible',
    ).toHaveLength(0);

    // Второго носителя подсветки в файле нет вовсе: пока `.vc-item:hover` жив,
    // «последнее взаимодействие выигрывает» невыполнимо by construction — при
    // наведении мышью на соседний пункт горели бы оба. Проверка по тексту
    // селектора, а не по фону: фон наведения и заливка активного пункта теперь
    // один и тот же токен, и по цвету их не различить.
    expect(readSelectors(css), 'правила с :hover').not.toContain('.vc-item:hover');

    // `outline: none` у пункта и у уровня — обязательная часть решения, а не
    // украшение: браузер рисует своё кольцо по умолчанию каждому узлу, чей фокус
    // он считает видимым, и удаление авторского правила кольцо не отменяет, а
    // возвращает UA-виду. Заливка активного пункта остаётся признаком фокуса
    // единственной.
    expect(readRule(css, '.vc-item'), 'кольцо снято с пункта').toContain('outline: none');
    expect(readRule(css, '.vc-menu'), 'кольцо снято с уровня').toContain('outline: none');
    // Список фокуса не получает, и кольцо на нём вернулось бы тем же UA-путём,
    // если бы кто-то завёл его правило.
    expect(readRule(css, '.vc-list'), 'кольцо не заведено на список').not.toContain('outline');
    // Счёт по всему файлу, а не по перечисленным селекторам: кольцо, вернувшееся
    // под `:focus-within` или под любым другим именем, предыдущими тремя
    // утверждениями прошло бы — регексп голого `:focus` на `:focus-within` не
    // срабатывает. Отрисованное `box-shadow` или рамкой кольцо эта охрана не видит:
    // ловить его — отдельная задача, и здесь сказано, чего охрана не делает.
    expect(
      [...css.matchAll(/outline:[^;]*/g)].map((match) => match[0]).sort(),
      'все объявления outline в файле: ровно два, и оба — none',
    ).toEqual(['outline: none', 'outline: none']);

    // Вживую: живое меню, клавиша навигации, и отметка обязана быть ровно одна —
    // на сфокусированном пункте, с заливкой мышиной и без кольца.
    await mountLiveMenu(page, { count: 2 });
    await openLiveMenu(page, { x: 200, y: 200 });
    await page.keyboard.press('ArrowDown');
    const focused = await page.evaluate(() => {
      const active = /** @type {HTMLElement | null} */ (document.activeElement);
      if (!(active instanceof HTMLElement)) {
        throw new Error('после нажатия клавиши фокуса нет');
      }
      const menu = /** @type {HTMLElement} */ (active.closest('.vc-menu'));
      const style = getComputedStyle(active);
      return {
        isItem: active.matches('.vc-item'),
        isMarked: active.hasAttribute('data-active'),
        // Отметки считаются в показанном уровне, а не в документе: спрятанная
        // фикстура несёт на первом пункте отметку, написанную разметкой.
        marks: menu.querySelectorAll('.vc-item[data-active]').length,
        fill: style.backgroundColor,
        // Кольцо — это `outline-style`: ширина при `none` остаётся `medium` и
        // ничем не рисуется, то есть судить по ней было бы неверно.
        ringStyle: style.outlineStyle,
        // Заливка, которую получит пункт под курсором: с ней и сравнивается
        // выделение с клавиатуры. Приводится к вычисленному цвету отдельно,
        // общим для проекта `resolveColor`.
        hoverToken: getComputedStyle(menu).getPropertyValue('--vc-hover-bg'),
      };
    });
    // Заливка, которую получит пункт под курсором: с ней и сравнивается выделение
    // с клавиатуры.
    const hoverFill = parseColor(await resolveColor(page, focused.hoverToken));

    // Клавиша навигации дала отметку тому же пункту, которому отдала фокус, и
    // ровно одну: второй писатель подсветки означал бы, что «последнее
    // взаимодействие выигрывает» невыполнимо, и оба пункта горели бы сразу.
    expect(focused.isItem, 'фокус у пункта').toBe(true);
    expect(focused.isMarked, 'фокус и отметка на одном пункте').toBe(true);
    expect(focused.marks, 'отметка ровно одна').toBe(1);

    // Признак фокуса — заливка, и она обязана совпадать с мышиной: требование
    // «цвет выделения с клавиатуры полностью совпадает с цветом выделения мышью».
    expect(focused.fill, 'заливка сфокусированного пункта').not.toBe('rgba(0, 0, 0, 0)');
    expect(
      parseColor(focused.fill),
      'выделение с клавиатуры совпадает с мышиным',
    ).toEqual(hoverFill);

    // Кольца на пункте нет. Контрольной пробы здесь нет намеренно: кольцо на
    // элементе уровня ловит соседний кейс, где проба обязана быть.
    expect(focused.ringStyle, 'кольца на пункте нет').toBe('none');
  });

  test('меню, открытое с клавиатуры, не рисует кольцо UA вокруг уровня', async ({ page, request }) => {
    // Кольцо снимается объявлением, а не надеждой на то, что UA его не рисует:
    // элемент уровня получает фокус программно, и кольцо вокруг всего меню —
    // рамка во всю ширину окна, а не признак фокуса пункта.
    const css = await readStylesheet(request);
    expect(readRule(css, '.vc-menu'), 'кольцо снято с уровня').toContain('outline: none');

    // Открытие без мыши — то, из-за чего кейс и заведён: `contextmenu` на
    // сфокусированном контейнере, `open()` и фокус элемента уровня. UA решает,
    // видим ли этот фокус, по вводу, которым он был вызван, поэтому нажатие клавиши
    // здесь настоящее, а событие отправлено из страницы.
    await mountLiveMenu(page, { count: 1 });
    await openLiveMenuByKeyboard(page);
    await page.waitForSelector('.vc-menu:popover-open');
    const measured = await page.evaluate(() => {
      /**
       * @param {Element} element
       * @returns {string} `outline-style` вычисленного кольца: `none` означает,
       *   что не рисуется ничего, и ширина при этом остаётся `medium`.
       */
      const ringOf = (element) => {
        return getComputedStyle(element).outlineStyle;
      };
      const level = /** @type {HTMLElement} */ (document.querySelector('.vc-menu:popover-open'));
      const onLevel = ringOf(level);
      const focusOnLevel = document.activeElement === level;

      // Контроль: тот же программный фокус на голом узле сразу после нажатия
      // клавиши. Без него утверждение ниже было бы тождественным — «кольца нет»
      // прошло бы и на движке, который не рисует его вовсе.
      const probe = document.createElement('span');
      probe.tabIndex = -1;
      document.body.appendChild(probe);
      probe.focus();
      const onProbe = ringOf(probe);
      probe.remove();
      return { onLevel, onProbe, focusOnLevel };
    });

    // Ход событий воспроизведён: фокус `open()` действительно оставил на
    // элементе уровня, и снятие кольца измеряется там, где оно было бы видно.
    expect(measured.focusOnLevel, 'фокус на элементе уровня').toBe(true);
    expect(measured.onProbe, 'движок рисует кольцо UA на сфокусированном узле')
      .not.toBe('none');
    expect(measured.onLevel, 'кольцо UA вокруг уровня снято').toBe('none');
  });

  test('отключённый пункт не получает заливки при наведении', async ({ page }) => {
    // Живое меню: отметку ставит движок роуминга, и без него наведение на
    // отключённый пункт проверялось бы на разметке, в которой отметок нет.
    await mountLiveMenu(page, { count: 2, dead: [1] });
    await openLiveMenu(page, { x: 200, y: 200 });

    /**
     * Фон и отметки обоих пунктов: подсветка обязана быть делом одного пункта,
     * и отключённый не должен попадать в её число.
     *
     * @returns {Promise<{ available: string, disabled: string, marks: number,
     *   marked: boolean, hoverToken: string }>}
     */
    const readRows = () => {
      return page.evaluate(() => {
        // Показанный уровень, а не документ: спрятанная фикстура `#m` несёт на
        // первом пункте отметку, написанную разметкой, и считать её в отметках
        // живого меню нельзя.
        const level = document.querySelector('.vc-menu:popover-open');
        if (level === null) {
          throw new Error('живое меню не показано');
        }
        const rows = Array.from(level.querySelectorAll('.vc-item'));
        const disabled = rows.find((row) => {
          return row.getAttribute('aria-disabled') === 'true';
        });
        if (disabled === undefined || rows.length < 2) {
          throw new Error('в меню нет отключённого пункта рядом с доступным');
        }
        return {
          available: getComputedStyle(rows[0]).backgroundColor,
          disabled: getComputedStyle(disabled).backgroundColor,
          marks: level.querySelectorAll('.vc-item[data-active]').length,
          marked: disabled.hasAttribute('data-active'),
          hoverToken: getComputedStyle(level).getPropertyValue('--vc-hover-bg'),
        };
      });
    };

    // Курсор водится координатами, а не `locator.hover()`: Playwright считает
    // элемент с `aria-disabled` непригодным и на него не наводит, то есть ровно
    // на предмете кейса остановился бы.
    const centres = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.vc-menu:popover-open .vc-item')).map((row) => {
        const box = row.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });
    });
    expect(centres).toHaveLength(2);

    const idle = await readRows();
    // Подсветки нет ни на ком пункте, пока курсор не на дереве меню.
    expect(idle.marks, 'до наведения отметок нет').toBe(0);
    // Заливка мышиная, а не произвольная тонировка: снимается один раз, тема
    // на протяжении кейса не меняется.
    const hoverFill = parseColor(await resolveColor(page, idle.hoverToken));

    await page.mouse.move(centres[1].x, centres[1].y);
    const onDisabled = await readRows();
    // Курсор на отключённом пункте: заливки нет, и она совпадает с заливкой
    // соседа, под которым курсора нет, — то есть оба пункта в одном состоянии.
    expect(onDisabled.disabled, 'наведение на отключённый не заливает его').toBe(idle.disabled);
    expect(onDisabled.available, 'сосед под курсором не залит').toBe(idle.available);
    expect(alphaOf(onDisabled.disabled), 'фон отключённого прозрачен').toBe(0);
    expect(onDisabled.marked, 'отключённый пункт не отмечен').toBe(false);
    expect(onDisabled.marks, 'наведение на отключённый не ставит отметку').toBe(0);

    await page.mouse.move(centres[0].x, centres[0].y);
    const onAvailable = await readRows();
    // Обратный порядок: подсветка уехала на доступный пункт, и отключённый вернулся
    // в то же прозрачное состояние, в котором был до наведения.
    expect(onAvailable.available, 'доступный пункт залит').not.toBe('rgba(0, 0, 0, 0)');
    expect(parseColor(onAvailable.available), 'заливка равна мышиной')
      .toEqual(hoverFill);
    expect(onAvailable.marks, 'отметка ровно одна').toBe(1);
    expect(onAvailable.disabled, 'отключённый пункт снова прозрачен')
      .toBe(onDisabled.disabled);
    // Заливка не растекается на соседа: у отключённого пункта её нет вовсе, и
    // равенство с ним означало бы, что залиты оба.
    expect(onAvailable.available, 'заливка не ушла на отключённый пункт')
      .not.toBe(onAvailable.disabled);
  });

  test('контраст активного пункта не ниже 4.5:1 в обеих темах', async ({ page }) => {
    for (const [theme, scheme] of THEME_CASES) {
      const result = await readActiveRow(page, theme, scheme);
      // Заливка тонированная, и предмет контракта — композит: строку читают
      // поверх стекла меню, а не поверх заливки в вакууме. На 6 % текста
      // светлой палитры `#1f2023` до 4.5:1 доходит 14.5:1 — запас есть, и порог
      // берётся из AA для текста, а не «на глаз».
      expect(result.tonedRatio, `контраст активного пункта, ${theme}/${scheme}`)
        .toBeGreaterThanOrEqual(4.5);
      // Тот же текст на том же фоне, но со всем столбом подложки, включая
      // страницу под стеклом: расхождение двух чисел и есть вклад страницы.
      expect(result.ratio, `контраст с поправкой на страницу, ${theme}/${scheme}`)
        .toBeGreaterThanOrEqual(4.5);
      // Заливка обязана быть именно мышиной, а не просто непрозрачной: иначе
      // кейс прошёл бы на любой тонировке, читаемой или нет.
      expect(parseColor(result.rowBg), `заливка равна мышиной, ${theme}/${scheme}`)
        .toEqual(parseColor(result.hoverBg));
    }
  });

  test('контраст активного пункта не ниже 4.5:1 в обеих темах, включая disabled на активной строке', async ({ page }) => {
    for (const [theme, scheme] of THEME_CASES) {
      // `aria-disabled` ставится на активный пункт прямо здесь, а не в фикстуре:
      // фикстура продолжает изображать то, что выдаёт рендерер, и состояние
      // «отключённый и одновременно активный» в ней не штатное.
      const result = await readActiveRow(page, theme, scheme, true);
      const where = `${theme}/${scheme}`;

      // Вынужденно отмеченная строка обязана разрешаться так же, как любая
      // активная: та же тонированная заливка и приглушённый текст. Раньше здесь
      // стояло исключение `:not([data-active])`, и состояние уходило от `muted`
      // в `--vc-text` — то есть кейс мерил не состояние, а обход его.
      expect(parseColor(result.label), `цвет текста, ${where}`)
        .toEqual(parseColor(result.muted));
      expect(parseColor(result.rowBg), `заливка не выдаёт отметку, ${where}`)
        .toEqual(parseColor(result.hoverBg));

      // 4.5:1 проверяется там, где оно достижимо: на заливке, которой у
      // отключённого пункта не бывает. По спецификации 9.1 отключённый пункт не
      // входит в цикл роуминга и отметку получить не может, то есть строка
      // стоит на стекле меню, и контраст её текста — этот.
      expect(result.disabledRatio, `контраст disabled на своей подложке, ${where}`)
        .toBeGreaterThanOrEqual(4.5);

      // Недостижимое состояние проверяется на читаемость, а не на AA: приглушённый
      // `#6b7280` на 6 % заливке даёт в светлой палитре около 4.3:1, и ни AA, ни
      // «просто посмотрим» здесь не выполнимы — состояния нет. Пол 4:1 держит
      // ровно одно: палитра не уехала до состояния, в котором строка нечитаема.
      // Основание пола не в тексте, а в геометрии: тот же порог держал шеврон
      // внутри активного пункта, потому что шеврон наследовал цвет строки, а
      // контраст строки проверялся здесь же. Теперь шеврон рисуется рамками, то
      // есть это не текст, и к нему применим порог 3:1 для графики, который
      // 4.31:1 проходит. Читать это утверждение как «4.5:1 на приглушённом
      // неважно» нельзя: приглушённый цвет теперь на заливке каждого активного
      // пункта, и пол держит палитру, а не состояние.
      expect(result.tonedRatio, `читаемость disabled на активной строке, ${where}`)
        .toBeGreaterThanOrEqual(4);
    }
  });

  test('токен --vc-active-bg существует и по умолчанию равен заливке наведения', async ({ page, request }) => {
    // Ручка настройки входит в публичную поверхность: спека 11 перечисляет токен,
    // и таблица токенов в README унаследует его. Объявлен он обязан быть во всех
    // трёх палитрах, иначе одна тема осталась бы без ручки, а кейс по умолчанию
    // был бы зелёным.
    const css = await readStylesheet(request);
    for (const selector of THEME_SELECTORS) {
      expect(readRule(css, selector), `токен в палитре ${selector}`)
        .toContain('--vc-active-bg: var(--vc-hover-bg)');
      // Мышиная заливка, на которую ручка ссылается, обязана быть объявлена в
      // каждой палитре. Пропавшее объявление в тёмных блоках поймали бы только эти
      // утверждения: обе стороны равенства — и `activeBg`, и `hoverBg` —
      // резолвились бы в одно и то же унаследованное `var(--vc-text) 6%`, то
      // есть равенство, контраст и живая проверка заливки остались бы зелёными.
      expect(readRule(css, selector), `наведение объявлено в палитре ${selector}`)
        .toMatch(/--vc-hover-bg:\s/);
    }
    // Плотность наведения в тёмных палитрах выше светлой (10 % против 6 %), и это
    // решение, а не перенос: на тёмной подложке та же доля невидимого текста не дала
    // бы строке признака, а наведение — единственный носитель признака выделения.
    for (const selector of DARK_SELECTORS) {
      expect(readRule(css, selector), `плотность наведения, ${selector}`)
        .toContain(`--vc-hover-bg: ${DARK_HOVER_BG}`);
    }

    // И вживую: ручка по умолчанию равна мышиной заливке, то есть выделение с
    // клавиатуры и с мыши неразличимо. Обход идёт по всем трём палитрам, а не по
    // двум системным схемам: под `auto` тёмную палитру
    // `[data-vc-theme="dark"]` вообще не достать.
    for (const [theme, scheme] of THEME_CASES) {
      const result = await readActiveRow(page, theme, scheme);
      expect(
        parseColor(result.activeBg),
        `--vc-active-bg против --vc-hover-bg, ${theme}/${scheme}`,
      ).toEqual(parseColor(result.hoverBg));
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
