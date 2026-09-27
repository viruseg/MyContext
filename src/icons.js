/**
 * Рендерер иконок меню: превращает описание иконки в готовый DOM-элемент для
 * слота `.vc-icon-slot`.
 *
 * Модуль — граница безопасности библиотеки. Разметка типа `svg` приходит от
 * автора меню, поэтому чистится по белым спискам — элементов и атрибутов, — а не
 * по набору запретов. Запрет отдельного имени или вида атрибута находит следующий
 * вектор уже после того, как его кто-то выдумал, и три раза за правки этого
 * модуля список запретов оказывался короче реальности: `script` и `on*` ушли
 * первыми, потом `style`, потом `url(` в presentation-атрибутах, потом `class`,
 * `data-*`, `overflow`, `pointer-events`, `tabindex` и `xl:href`. Белый список от
 * такого не ломается: `class` и `data-*` были прямым мостом из недоверенной
 * разметки в стили и поведение страницы, а объявленный `xmlns:xl` давал внешнюю
 * ссылку под именем, не совпадающим ни с одним правилом.
 *
 * Удаление элемента уносит его поддерево — так отсекается `foreignObject`,
 * внутри которого разметка была бы уже в другом пространстве имён. Из прочих
 * узлов остаются только текст и CDATA.
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
 * Союз, а не `HTMLElement`: `SVGSVGElement` — потомок `SVGElement`, а не
 * `HTMLElement`, и сужение до `HTMLElement` потребовало бы `any` или двойного
 * приведения. Вставка в слот идёт через `appendChild`, который принимает `Node`,
 * поэтому союз вызывающему коду не мешает.
 *
 * SVG-узел намеренно не получает класс `vc-icon`: оформление задаёт CSS селектором
 * по слоту, а не по классу на самом узле.
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

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

/**
 * Белый список атрибутов: геометрия и представление, плюс `id` для внутренних
 * ссылок. `href` добавлен к списку плана — без него `use` и градиенты не
 * ссылались бы сами на себя.
 *
 * Всё, чего в списке нет, удаляется безусловно, без отдельных правил: `class` и
 * `data-*` были мостом из недоверенной разметки в стили и поведение страницы,
 * `style` — тем же плюс оверлеем, `on*` — исполнением, `tabindex` — безымянной
 * точкой фокуса в `aria-hidden` поддереве, `overflow` и `pointer-events` —
 * unclips вьюпорта и перехватом клика, `aria-*` и `role` — выдуманной семантикой.
 * Перечислить их запретом значило бы искать следующий вектор по памяти.
 */
const ALLOWED_ATTRIBUTES = new Set([
  // Геометрия.
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'points', 'pathLength',
  // Трансформации и единицы градиентов, масок и маркеров.
  'transform', 'gradientTransform', 'gradientUnits', 'patternUnits', 'patternContentUnits',
  'clipPathUnits', 'maskUnits', 'maskContentUnits', 'markerWidth', 'markerHeight', 'markerUnits',
  'refX', 'refY', 'orient', 'offset', 'viewBox', 'preserveAspectRatio',
  // Представление.
  'fill', 'fill-rule', 'fill-opacity',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity',
  'color', 'stop-color', 'stop-opacity',
  'font-family', 'font-size', 'font-weight',
  'text-anchor', 'dominant-baseline', 'letter-spacing', 'word-spacing',
  'clip-path', 'clip-rule', 'mask', 'filter',
  'marker-start', 'marker-mid', 'marker-end',
  // Отрисовка и текст.
  'display', 'visibility', 'vector-effect', 'shape-rendering', 'paint-order',
  'color-interpolation', 'color-interpolation-filters',
  // Собственные ссылки разметки.
  'id', 'href',
]);

const RASTER_PROTOCOLS = new Set(['http:', 'https:']);

// Носитель data-URI лежит в начале пути: у `data:image/png;base64,…` протокол
// всегда `data:`, а `pathname` — `image/png;base64,…`.
const DATA_IMAGE = /^image\/[a-z0-9.+-]+[;,]/i;

/**
 * @param {string} value значение атрибута ссылки.
 * @returns {boolean} `true`, если значение указывает на фрагмент текущего документа.
 */
function isFragmentHref(value) {
  // Пробелы по краям браузер отбрасывает при разборе URL, поэтому ` " #id"`
  // ссылается на тот же фрагмент, что и `#id`. Всё, что не фрагмент, убирается:
  // относительный `href` у `use` — уже внешняя ссылка, как только документ
  // окажется на любом другом origin.
  return value.trim().startsWith('#');
}

// Ссылка во фрагмент того же документа. Кавычки и пробелы внутри скобок
// допустимы в CSS и на фрагмент не влияют, поэтому принимаются; закрывающая
// кавычка обязана совпадать с открывающей, а имя фрагмента не может содержать
// скобок, пробелов и кавычек — под это выражение нельзя спрятать вторую ссылку.
const INTERNAL_URL = /url\(\s*(["']?)#[^()\s'"]+\s*\1\s*\)/gi;

/**
 * @param {string} value значение атрибута.
 * @returns {boolean} `true`, если все `url(...)` в значении ведут во фрагмент
 *   текущего документа.
 */
function hasOnlyInternalUrls(value) {
  // Правило проверяет значение, а не имя атрибута. Список имён presentation-
  // атрибутов, принимающих `url(`, — это `fill`, `stroke`, `filter`, `mask`,
  // `clip-path`, `marker-start`, `marker-mid`, `marker-end` на сегодня, и
  // следующий по счёту атрибут с функциональным значением проскочил бы мимо
  // такого списка. Здесь любое `url(`, кроме ссылки на фрагмент — в любой из
  // форм `url(#имя)`, `url("#имя")`, `url('#имя')`, `url( #имя )`, — убирает
  // атрибут, а одна посторонняя ссылка в значении убирает его целиком, вместе с
  // внутренними ссылками рядом. Регистр учитывается: имя CSS-функции
  // регистронезависимо, поэтому `URL(` распознаётся так же.
  return !value.replace(INTERNAL_URL, '').toLowerCase().includes('url(');
}

/**
 * Проверка идёт по паре `namespaceURI` + `localName`, а не по строке
 * квалифицированного имени. Пространства имён разрешаются по URI, а не по
 * префиксу: объявленный `xmlns:xl` даёт `xl:href` совершенно другое
 * пространство, хотя `localName` у него тот же, что у `href`, и строка
 * `xl:href` не совпала бы ни с одним правилом.
 *
 * @param {Attr} attribute проверяемый атрибут.
 * @returns {boolean} `true`, если атрибут разрешён.
 */
function isAllowedAttribute(attribute) {
  if (attribute.namespaceURI === null) {
    // Разрешённые имена живут в своём пространстве имён: presentation-атрибут
    // SVG не принадлежит никакому. Префикс — уже чужое пространство, то есть
    // другой атрибут, даже когда `localName` совпал.
    return ALLOWED_ATTRIBUTES.has(attribute.localName);
  }
  // `xlink:href` — единственный разрешённый именованный атрибут: SVG 1.1 требует
  // его для ссылок, и без него иконки с `xlink:href` потеряли бы ссылку.
  return attribute.namespaceURI === XLINK_NAMESPACE && attribute.localName === 'href';
}

/**
 * @param {Attr} attribute проверяемый атрибут.
 * @returns {boolean} `true`, если атрибут — ссылка `href` или `xlink:href`.
 */
function isHrefAttribute(attribute) {
  return attribute.localName === 'href'
    && (attribute.namespaceURI === null || attribute.namespaceURI === XLINK_NAMESPACE);
}

/**
 * @param {Element} element элемент, очищаемый от всего, чего нет в белом списке.
 * @returns {void}
 */
function scrubElement(element) {
  for (const attribute of Array.from(element.attributes)) {
    const badHref = isHrefAttribute(attribute) && !isFragmentHref(attribute.value);
    if (!isAllowedAttribute(attribute) || badHref || !hasOnlyInternalUrls(attribute.value)) {
      element.removeAttribute(attribute.name);
    }
  }
}

/**
 * Обход в глубину: разрешённый элемент чистится и обходится дальше, запрещённый
 * удаляется целиком, поэтому его потомки до обхода не доходят. Из прочих узлов
 * остаются только текст и CDATA — так контракт санитизации звучит «только элементы
 * белого списка и текст», а не «всё, кроме перечисленного».
 *
 * @param {Element} element корень обхода.
 * @returns {void}
 */
function sanitizeTree(element) {
  for (const node of Array.from(element.childNodes)) {
    if (node instanceof Element) {
      if (!ALLOWED_ELEMENTS.has(node.localName)) {
        node.remove();
        continue;
      }
      scrubElement(node);
      sanitizeTree(node);
      continue;
    }
    if (!(node instanceof Text || node instanceof CDATASection)) {
      node.remove();
    }
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
  // Авторский `overflow` — presentation-атрибут, то есть источник автора, и он
  // перебивает правило UA-стилей: вьюпорт иконки unclips, а вместе с
  // `pointer-events` это оверлей, перехватывающий клики. Ровно тот же результат,
  // что давал `style`, но без него.
  root.setAttribute('overflow', 'hidden');
  // Каноническое пространство выставляется принудительно: объявления `xmlns*`
  // вырезаются белым списком, и очищенный узел не должен зависеть от того, что
  // написал автор.
  root.setAttribute('xmlns', SVG_NAMESPACE);
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
 * Разбирает разметку SVG и оставляет в ней только белые списки — элементов и
 * атрибутов — плюс текст.
 *
 * Элементы вне списка удаляются вместе с поддеревом, узлы комментариев и инструкций
 * обработки — точками. Атрибут вне списка удаляется у каждого уцелевшего элемента,
 * включая корень, поэтому `class`, `data-*`, `style`, `on*`, `tabindex`, `overflow`,
 * `pointer-events`, `role`, `aria-*` и объявления `xmlns*` исчезают сами собой.
 * Ссылки `href` и `xlink:href`, если уцелели, ведут только во фрагмент текущего
 * документа, а значение с `url(...)` — только вида `url(#имя)`: `fill="url(#grad)"`
 * нужен, чтобы работали градиенты, а `fill="url(https://…)"` открывает внешний
 * запрос. Корневому `svg` принудительно выставляются размеры, признаки
 * декоративности, `overflow` и каноническое пространство имён.
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
