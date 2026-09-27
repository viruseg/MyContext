/**
 * Рендерер иконок меню: превращает описание иконки в готовый DOM-элемент для
 * слота `.vc-icon-slot`.
 *
 * Модуль — граница безопасности библиотеки. Разметка типа `svg` приходит от
 * автора меню, поэтому чистится по белому списку элементов, а не по запрету
 * отдельных имён: запрет `script` и `on*` перестаёт работать в тот момент,
 * когда придумают следующий вектор, а белый список от такого не ломается.
 * Удаление элемента уносит его поддерево — так отсекается `foreignObject`,
 * внутри которого разметка была бы уже в другом пространстве имён.
 *
 * Контракты двух экспортов различаются намеренно. `sanitizeSvg` бросает `Error`
 * на неразобранном входе: у него один вызывающий, `renderIcon`, и тот обязан
 * знать о сбое. `renderIcon` не бросает никогда: иконка не должна уронить меню,
 * поэтому на битой разметке остаётся пустой слот и одно предупреждение.
 */

/**
 * @typedef {object} EmojiIconConfig
 * @property {'emoji'} type
 * @property {string} value символ эмодзи, например `📄`.
 */

/**
 * @typedef {object} SvgIconConfig
 * @property {'svg'} type
 * @property {string} value разметка SVG. Требуется `xmlns="http://www.w3.org/2000/svg"`:
 *   без него корневой узел не попадает в SVG-пространство имён, в HTML-документе
 *   не отрисовался бы и `sanitizeSvg` отверг бы его как не-SVG корень.
 */

/**
 * @typedef {object} RasterIconConfig
 * @property {'raster'} type
 * @property {string} value адрес изображения. Принимается только `http:`, `https:`
 *   и `data:image/…`; остальные схемы отбрасываются, и элемент остаётся без `src`.
 * @property {string} alt текстовое описание. По контракту обязателен: пустой или
 *   отсутствующий `alt` превращает картинку в недоступную метку, поэтому
 *   валидатор конфигурации его проверяет. Рендерер защитничает и подставляет
 *   пустую строку.
 */

/**
 * @typedef {EmojiIconConfig | SvgIconConfig | RasterIconConfig} IconConfig
 */

/**
 * Результат рендерера: либо HTML-обёртка, либо очищенный корневой узел SVG.
 *
 * Союз, а не `HTMLElement`: узел `svg` — потомок `SVGElement`, а не `HTMLElement`,
 * и объявление `HTMLElement` было бы ложью, заставляющей приводить тип там, где
 * элемент кладут в слот.
 *
 * @typedef {HTMLElement | SVGSVGElement} IconElement
 */

/**
 * Белый список элементов SVG. Имена в том же регистре, в каком их пишет автор:
 * `localName` разобранного XML сохраняет регистр, и `clippath` — уже не то же
 * самое, что `clipPath`.
 */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'g',
  'defs',
  'use',
  'clipPath',
  'mask',
  'title',
  'linearGradient',
  'radialGradient',
  'stop',
]);

const HREF_ATTRIBUTES = ['href', 'xlink:href'];

const RASTER_PROTOCOLS = new Set(['http:', 'https:']);

// Носитель data-URI лежит в начале пути: у `data:image/png;base64,…` протокол
// всегда `data:`, а `pathname` — `image/png;base64,…`.
const DATA_IMAGE = /^image\/[a-z0-9.+-]+[;,]/i;

/**
 * @param {string} value значение атрибута ссылки.
 * @returns {boolean} `true`, если схема `javascript:`.
 */
function isJavascriptScheme(value) {
  // Браузер игнорирует пробельные символы внутри URL, поэтому
  // `java&#9;script:alert(1)` исполняется так же, как `javascript:alert(1)`.
  return value.replace(/\s/g, '').toLowerCase().startsWith('javascript:');
}

/**
 * @param {Element} element элемент, очищаемый от обработчиков и ссылок.
 * @returns {void}
 */
function scrubElement(element) {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name;
    if (name.toLowerCase().startsWith('on')) {
      element.removeAttribute(name);
      continue;
    }
    if (HREF_ATTRIBUTES.includes(name) && isJavascriptScheme(attribute.value)) {
      element.removeAttribute(name);
    }
  }
}

/**
 * Обход в глубину: разрешённый элемент чистится и обходится дальше, запрещённый
 * удаляется целиком, поэтому его потомки до обхода не доходят.
 *
 * @param {Element} element корень обхода.
 * @returns {void}
 */
function sanitizeTree(element) {
  for (const child of Array.from(element.children)) {
    if (!ALLOWED_ELEMENTS.has(child.localName)) {
      child.remove();
      continue;
    }
    scrubElement(child);
    sanitizeTree(child);
  }
}

/**
 * @param {SVGSVGElement} root корень очищенного документа.
 * @returns {void}
 */
function applyRootAttributes(root) {
  root.setAttribute('width', '100%');
  root.setAttribute('height', '100%');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('focusable', 'false');
}

/**
 * @param {string} className класс пустого элемента слота.
 * @returns {HTMLSpanElement} пустой `span` для вставки вместо иконки.
 */
function createEmptySpan(className) {
  const span = document.createElement('span');
  span.className = className;
  return span;
}

/**
 * Разбирает разметку SVG и оставляет в ней только белый список элементов без
 * обработчиков и ссылок со схемой `javascript:`.
 *
 * Элементы вне белого списка удаляются вместе с поддеревом, обработчики `on*` и
 * ссылки со схемой `javascript:` вырезаются у каждого уцелевшего элемента,
 * корневому `svg` принудительно выставляются размеры и признаки декоративности.
 *
 * @param {string} svgText разбираемая разметка.
 * @returns {SVGSVGElement} очищенный корневой узел.
 * @throws {Error} если разбор не дал корневой элемент svg.
 */
export function sanitizeSvg(svgText) {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = parsed.documentElement;
  // Проверка экземпляра закрывает обе причины отказа разом: элемент `parsererror`
  // и корень не из svg — не `SVGSVGElement`, и разметка без `xmlns` отбрасывается
  // вместе с ними.
  if (!(root instanceof SVGSVGElement)) {
    throw new Error('MyContext: иконка не разобрана — нет корневого элемента svg');
  }

  scrubElement(root);
  sanitizeTree(root);
  applyRootAttributes(root);
  return root;
}

/**
 * @param {string} value адрес из конфигурации.
 * @returns {boolean} `true`, если адрес можно отдать в `src`.
 */
function isSafeRasterUrl(value) {
  let url;
  try {
    url = new URL(value, globalThis.location.href);
  } catch {
    return false;
  }
  if (url.protocol === 'data:') {
    return DATA_IMAGE.test(url.pathname);
  }
  return RASTER_PROTOCOLS.has(url.protocol);
}

/**
 * Строит элемент иконки для вставки в слот `.vc-icon-slot`.
 *
 * Ни одна ветка не бросает: неизвестный тип и битая разметка дают пустой слот,
 * поэтому сбой иконки не уносит с собой меню.
 *
 * @param {IconConfig} icon описание иконки.
 * @returns {IconElement} элемент для вставки в `.vc-icon-slot`.
 */
export function renderIcon(icon) {
  if (icon.type === 'emoji') {
    const span = document.createElement('span');
    span.className = 'vc-icon';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = icon.value;
    return span;
  }

  if (icon.type === 'svg') {
    try {
      return sanitizeSvg(icon.value);
    } catch (error) {
      // Тип иконки известен, сломан только её вид, поэтому место под иконку
      // остаётся: пустой элемент получает класс иконки, а не пустого слота.
      console.warn('MyContext: иконка не отрисована, слот оставлен пустым', error);
      return createEmptySpan('vc-icon');
    }
  }

  if (icon.type === 'raster') {
    const img = document.createElement('img');
    img.className = 'vc-icon';
    img.draggable = false;
    img.decoding = 'async';
    img.alt = icon.alt ?? '';
    if (isSafeRasterUrl(icon.value)) {
      img.src = icon.value;
    }
    return img;
  }

  // Тип вне контракта: о иконке неизвестно ничего, кроме того что она не строка
  // и не разметка, поэтому остаётся пустой слот без класса иконки.
  return createEmptySpan('vc-icon-slot');
}
