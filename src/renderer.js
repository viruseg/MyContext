import { renderIcon } from './icons.js';

/**
 * Рендерер уровней меню: строит DOM одного уровня — сам элемент уровня,
 * прокручиваемый список внутри него, зоны прокрутки по краям списка и пункты.
 *
 * Модуль ничего не знает про открытие, позиционирование, клавиатуру и закрытие.
 * Он отдаёт разметку и контракты, на которые опираются остальные: внутренний
 * ключ пункта, список доступных фокусу пунктов, зарезервированные идентификаторы
 * подменю для `aria-owns` и узлы прокрутки уровня.
 *
 * Он же держит контракт пункта: проверку его формы, проверку результатов его
 * действий и отпечаток его состава. Проверка описания иконки живёт здесь, а не в
 * `icons.js`, потому что это проверка поля пункта наравне с подписью и подменю, а
 * `icons.js` отвечает ровно за одну вещь: превратить уже годное описание в узел.
 *
 * Пять решений, которые нельзя вывести из разметки, зафиксированы здесь.
 *
 * **Ключ пункта — `${menuId}:${itemIndex}`, а не авторский `id`.** Идентификатор
 * у пункта опционален и может повторяться, а ключ обязан быть уникальным в
 * пределах общей карты активов. Ключ по `id` схлопнул бы два пункта с
 * одинаковым `id` в один, и `action` второго вызвался бы вместо первого.
 * Ключ по `levelIndex` схлопнул бы ещё хуже: два корневых меню на странице оба
 * живут на `levelIndex: 0`, и второй `renderLevel` молча перезаписал бы записи
 * первого — а восстановить их на момент клика нельзя, потому что ключ не
 * перевыводится из DOM. Авторский `id` копируется в `data-id` — для потребителей
 * и только.
 *
 * **`aria-setsize` и `aria-posinset` считают только пункты.** Разделитель не
 * голосующий, и вместе с ним скринридер объявил бы «3 из 5» для меню из трёх
 * пунктов. Число не-разделителей известно только уровню, поэтому `aria-posinset`
 * проставляет `renderLevel`, а `renderItem` — `aria-level` и `aria-setsize`.
 *
 * **Обе боковые колонки зарезервированы всегда.** Слот иконки создаётся даже там,
 * где иконки нет, а колонку шеврона держит дорожка сетки из
 * `styles/mycontext.css`. Собственно элемент `.vc-chevron` создаётся у каждого
 * пункта, но в разметку попадает только у владельцев. Из этого следует и то, что
 * открытие подменю не сдвигает ни одного лейбла.
 *
 * **Владелец — это одно условие: непустое подменю И доступный пункт.**
 * Отключённый пункт с непустым подменю владельцем не является: раскрыть его
 * нечем — ни мышью, ни с клавиатуры, ни кликом, — а шеврон, `aria-haspopup` и
 * `aria-owns` обещали бы раскрытие, которого не будет. В родных меню у
 * отключённого пункта признака подменю тоже нет. Отсюда и то, что решение
 * принимается по одному ответу `isEnabledOf`, а не по двум независимым полям:
 * `focusable` и `hasSubmenu` читают одно и то же, поэтому пункт не может
 * оказаться недоступным для роуминга и при этом обещать подменю.
 *
 * **Четыре действия пункта перечитываются на каждом показе, а состав уровня
 * перестраивается по отпечатку.** Уровень живёт дольше одного показа, и решение
 * принимается при его сборке, — без `refreshItems` действие, изменившее смысл
 * после первого показа, не действовало бы никогда. Перечитываются все четыре:
 * доступность, подпись, иконка и подменю. Состав при этом не перечитывается, а
 * сверяется: `submenuHashOf` кодирует значения полей по позициям, и разошёлся
 * отпечаток — уровень перестраивается целиком, со сбросом всех состояний;
 * совпал — перестраивать нечего, потому что различаться больше нечему.
 *
 * **Каждый владелец подменю резервирует `id` подменю в `aria-owns`.** Подменю
 * лежат в `<body>` рядом с корневым меню, а не внутри пункта (спека 8.3):
 * `backdrop-filter` и анимация `scale` на родителе создают containing block и
 * ломают позиционирование относительно вьюпорта, а вложенный `position:
 * absolute` цепляется за прокручиваемый контейнер. Плата — у `role="menuitem"`
 * нет контейнера-`menu`, и `aria-owns` указывает на ещё не созданный узел.
 * Создатель подменю обязан взять идентификатор из
 * `owner.getAttribute('aria-owns')`: другой id сделал бы ссылку висячей.
 * Адрес выводится из `menuId` и позиции пункта, а не запоминается навсегда:
 * пункт, не бывший владельцем при сборке, может стать им позже, и его адрес
 * тогда ещё не существует.
 */

/**
 * @typedef {object} MenuItem
 * @property {() => string} labelAction подпись пункта. Зовётся при каждом показе;
 *   вернул не строку или пустую — `TypeError` с путём до поля, исключение уходит
 *   наружу. Единственное обязательное поле: пункт без подписи не читается и не
 *   проходит аудит, поэтому подставлять её по умолчанию нечем.
 * @property {string} [id] авторский идентификатор. Копируется в `data-id` и в
 *   отпечаток состава уровня входит, а в ключ пункта — нет: он опционален и может
 *   повторяться.
 * @property {() => import('./icons.js').IconConfig} [iconAction] иконка. Зовётся
 *   при каждом показе; вернула не описание иконки — `TypeError`. Без неё слот
 *   остаётся пустым, но занимает место.
 * @property {() => Array<MenuItem | SeparatorItem>} [submenuAction] непустой
 *   массив — и только тогда, вместе с доступностью по `isEnabledAction`, пункт
 *   считается владельцем подменю. Разделитель внутри подменю разрешён: подменю
 *   отличается от корня только тем, откуда оно пришло. Зовётся при каждом показе
 *   владельца; вернула не массив или пустой — `TypeError`, и подменю, нечем
 *   раскрывать, не существует.
 * @property {() => boolean} [isEnabledAction] предикат доступности, зовёмся при
 *   каждом показе. Вернул не `true` — пункт отключён: он не входит в цикл
 *   роуминга и не бывает владельцем подменю даже при непустом `submenuAction`.
 *   Без поля пункт доступен. Исключение уходит наружу, как из `action`.
 * @property {(event: Event, handoff: import('./MyContext.js').SubmenuHandoff) => void} [handoffAction] отдача управления другому
 *   меню. Зовётся по наведению с задержкой, по нажатию — без неё — и по `Enter`
 *   или `Space`, а затем меню уходит с экрана. Событие активации достаётся как
 *   есть: по наведению это `pointerenter`, по нажатию `pointerdown`, с клавиатуры
 *   `keydown`, — и что с ним делать, решает автор. Вторым аргументом приходит
 *   описание живого жеста: `held` значит, что кнопка зажата прямо сейчас, `button`
 *   называет её, а `button: null` значит «кнопка не названа». Это ровно то, что
 *   ждёт третьим аргументом `openSubmenu(x, y, handoff)` чужое меню, поэтому
 *   передача выглядит как `owner.openSubmenu(event.clientX, event.clientY, handoff)`.
 *   Действие, объявленное с одним параметром, продолжает работать. Владельцем
 *   подменю пункт при этом не становится: подменю у него нет, и раскрывать нечего.
 * @property {(event: MouseEvent | KeyboardEvent) => void} [action] вызывается по
 *   внутреннему ключу пункта, а не хранится на узле.
 * @property {number} [version] метка состава, `0` по умолчанию. Входит в отпечаток
 *   уровня и позволяет автору потребовать перестройку при неизменившейся
 *   структуре — например, после замены `submenuAction` на новую функцию.
 */

/**
 * @typedef {object} SeparatorItem
 * @property {'separator'} type
 */

/**
 * @typedef {object} RenderContext
 * @property {number} levelIndex индекс уровня, начиная с 0. Идёт в `aria-level`
 *   и в ключ пункта не входит: у двух экземпляров меню на странице корневые
 *   уровни имеют один и тот же индекс.
 * @property {string} menuId идентификатор элемента уровня. Обязан быть уникальным
 *   для каждого уровня каждого экземпляра, делящего одну карту `actions`:
 *   именно он входит в ключ пункта, и коллизия в нём означает, что чужое
 *   действие вызовется вместо нужного. Один и тот же `menuId` у двух уровней
 *   недопустим даже внутри одного экземпляра. Обязан начинаться с `vc-`:
 *   идентификаторы библиотеки не должны совпадать с идентификаторами
 *   хост-страницы, потому что сохранённый `id` внутри очищенной svg-иконки
 *   позволяет `use href="#id"` сослаться на чужой элемент. Производные
 *   идентификаторы подменю наследуют этот префикс.
 * @property {Map<string, MenuItem>} actions общая для всех уровней одного
 *   экземпляра и передаваемая по ссылке. Рендерер кладёт сюда каждый пункт под
 *   его внутренним ключом; вызывающий читает `action` у найденного пункта.
 *   Записи этого уровня — те, чей ключ начинается с его `menuId`. Карта
 *   принадлежит экземпляру, а не уровню, и очищается целиком в
 *   `MyContext.destroy()`, а не по частям: рендерер не знает, когда уровень
 *   перестал существовать. Карта пополняется только: ключи
 *   исчезнувших при перестроении пунктов остаются, потому что набор пунктов
 *   меняется лениво и по веткам, а очистка всех уровней разом обнулила бы записи
 *   ещё открытых подменю.
 * @property {string} [label] доступное имя уровня. Поле опционально по
 *   контракту опций, и без него атрибут не выставляется вовсе.
 */

/**
 * @typedef {object} RenderedItem
 * @property {HTMLElement} element узел пункта или разделителя.
 * @property {boolean} focusable входит ли пункт в цикл роуминга. `false` у
 *   разделителей и отключённых пунктов.
 * @property {boolean} hasSubmenu владелец ли пункт непустого подменю.
 *   `false` у разделителей, у пунктов с пустым `submenuAction` и у отключённых:
 *   признак один, и он означает «подменю можно раскрыть», а не «подменю есть».
 * @property {boolean} handsOff отдаёт ли пункт управление другому меню по
 *   `handoffAction`. Владельцем при этом он не является: подменю у него нет, и
 *   `aria-owns` ему некуда указывать. Признак нужен отдельно от `hasSubmenu`
 *   именно поэтому — владелец раскрывает уровень сам, а отдающий уходит наружу.
 * @property {((event: Event, handoff: import('./MyContext.js').SubmenuHandoff) => void) | null} handoff действие отдачи, взятое на
 *   этом показе; `null` у всех, кто не отдаёт.
 * @property {string | null} key внутренний ключ пункта; у разделителя `null`.
 * @property {string | null} submenuId `id`, зарезервированный под подменю этого
 *   пункта; у не-владельцев и у разделителя `null`. Считается из `menuId` и
 *   позиции на каждом показе, а не запоминается навсегда, — пункт может стать
 *   владельцем позже, и тогда адрес надо назвать впервые.
 * @property {HTMLSpanElement} iconSlot узел `.vc-icon-slot`. Держится ссылкой,
 *   а не ищется селектором на показе: второй способ найти слот дал бы две
 *   разные вещи, когда в нём лежит иконка.
 * @property {HTMLSpanElement} labelNode узел `.vc-label`.
 * @property {Array<MenuItem | SeparatorItem> | null} submenuItems развёрнутое
 *   `submenuAction` этого показа у владельца и `null` у всех остальных.
 *   Оркестратор берёт подменю отсюда, а не зовёт действие второй раз: два вызова
 *   были бы двумя мнениями об одном и том же составе.
 * @property {HTMLElement} chevron узел `.vc-chevron`; в разметке стоит только у
 *   владельцев. `refreshItems` убирает его с пункта, потерявшего владение, и
 *   возвращает по адресу, а не ищет заново.
 */

/**
 * @typedef {object} ScrollZoneNodes
 * @property {HTMLElement} list прокручиваемый список уровня.
 * @property {HTMLElement} up верхняя зона.
 * @property {HTMLElement} down нижняя зона.
 */

/**
 * @typedef {object} RenderedLevel
 * @property {HTMLElement} element узел уровня. Не вставлен в документ: это дело
 *   вызывающего, потому что перед показом его надо измерить.
 * @property {RenderedItem[]} items все узлы уровня по порядку, включая
 *   разделители. Доступные фокусу пункты — те, у кого `focusable`.
 * @property {ScrollZoneNodes} scroll узлы прокрутки уровня; слой создаёт по ним
 *   контроллер, поэтому разметка отдаётся явно, а не ищется селектором.
 */

const SEPARATOR_TYPE = 'separator';
const RASTER_TYPE = 'raster';
const ICON_TYPES = new Set([RASTER_TYPE, 'emoji', 'svg']);
const DEFAULT_VERSION = 0;

/**
 * Поля, ушедшие из контракта, и чем их заменить. Отклоняются, а не
 * игнорируются: оставленное автором `label` иначе молча убрало бы подпись, а
 * `submenu` — подменю, и ошибка вылезла бы там, где её не ждут. Довод тот же,
 * что и у `type` у разделителя.
 */
const REMOVED_FIELDS = [
  ['label', 'labelAction: () => string'],
  ['icon', 'iconAction: () => IconConfig'],
  ['submenu', 'submenuAction: () => MenuItem[]'],
  ['disabled', 'isEnabledAction: () => boolean'],
];

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} item
 * @param {string} name имя поля-действия.
 * @param {string} path путь до проверяемого поля.
 * @param {boolean} required обязательность поля.
 * @returns {void}
 * @throws {TypeError} если поле объявлено не функцией или отсутствует там, где
 *   обязательно.
 */
function assertActionField(item, name, path, required) {
  const action = item[name];
  if (action === undefined) {
    if (required) {
      throw new TypeError(`${path}.${name}: пункт обязан объявить это действие`);
    }
    return;
  }
  if (typeof action !== 'function') {
    throw new TypeError(`${path}.${name}: действие пункта должно быть функцией`);
  }
}

/**
 * Форма пункта: какие поля есть, какие из них — функции. Результат действий она не
 * проверяет: действие зовётся на показе, и проверять его вывод — работа того, кто
 * вывод получил.
 *
 * Одна функция на оба места, где форма проверяется: конструктор экземпляра, до
 * появления объекта, и рендерер, когда строит уровень из уже предъявленного
 * состава. Две проверки означали бы два ответа на один вопрос и разошлись бы на
 * первом же поле.
 *
 * @param {unknown} item проверяемый пункт или разделитель.
 * @param {string} path путь до пункта.
 * @returns {void}
 * @throws {TypeError} на первом негодном поле; путь до поля — в сообщении.
 */
export function assertItem(item, path) {
  if (!isRecord(item)) {
    throw new TypeError(`${path}: пункт должен быть объектом`);
  }
  // Разделитель отличается от пункта единственным полем, поэтому проверка идёт по
  // нему же. Объявленное `type` обязано быть ровно `separator`: иначе опечатка
  // автора тихо стала бы пунктом, и меню показало бы строку там, где разделитель.
  if (item.type !== undefined) {
    if (item.type !== SEPARATOR_TYPE) {
      throw new TypeError(
        `${path}.type: разделитель помечается значением "${SEPARATOR_TYPE}", получено ${String(item.type)}`,
      );
    }
    return;
  }
  assertActionField(item, 'labelAction', path, true);
  assertActionField(item, 'iconAction', path, false);
  assertActionField(item, 'submenuAction', path, false);
  assertActionField(item, 'handoffAction', path, false);
  assertActionField(item, 'isEnabledAction', path, false);
  assertActionField(item, 'action', path, false);
  if (item.version !== undefined
    && (typeof item.version !== 'number' || !Number.isFinite(item.version))) {
    throw new TypeError(`${path}.version: метка состава должна быть конечным числом`);
  }
  for (const [field, replacement] of REMOVED_FIELDS) {
    if (item[field] !== undefined) {
      throw new TypeError(`${path}.${field}: поле убрано, используйте ${replacement}`);
    }
  }
}

/**
 * Иконка допустима при совпадении `type` одному из трёх видов, и у каждого вида
 * своё обязательное поле: у `emoji` и `svg` — непустой `value`, у `raster` —
 * непустой `alt`. Проверка `alt` единственная: рендерер подставит защитничную
 * пустую строку, и дефект уехал бы в скринридер. `value` обязателен у всех трёх
 * видов: без него `isSafeRasterUrl` разбирает `undefined` как адрес текущей
 * страницы, проходит проверку схемы и отдаёт `<img>` запрос за `undefined`.
 *
 * @param {unknown} icon описание иконки.
 * @param {string} path путь до описания.
 * @returns {import('./icons.js').IconConfig} то же описание, сужённое до контракта.
 * @throws {TypeError} на первом негодном поле.
 */
export function assertIcon(icon, path) {
  if (!isRecord(icon)) {
    throw new TypeError(`${path}: описание иконки должно быть объектом`);
  }
  const type = icon.type;
  if (typeof type !== 'string' || !ICON_TYPES.has(type)) {
    throw new TypeError(`${path}.type: неизвестный тип иконки, ожидается emoji, svg или raster`);
  }
  if (!isNonEmptyString(icon.value)) {
    throw new TypeError(`${path}.value: у иконки ${type} обязателен непустой value`);
  }
  if (type === RASTER_TYPE && !isNonEmptyString(icon.alt)) {
    throw new TypeError(`${path}.alt: у растровой иконки обязателен непустой alt`);
  }
  return /** @type {import('./icons.js').IconConfig} */ (icon);
}

/**
 * @param {unknown} items проверяемый набор пунктов.
 * @param {string} path путь до набора.
 * @returns {Array<MenuItem | SeparatorItem>} тот же набор, проверенный по форме.
 * @throws {TypeError} если набор не массив, пуст или содержит негодный пункт.
 */
export function assertItems(items, path) {
  if (!Array.isArray(items)) {
    throw new TypeError(`${path}: пункты меню должны быть массивом`);
  }
  // Пустой набор — ошибка и у корня, и у подменю, и по одному правилу: нечего ни
  // рисовать, ни раскрывать. Пустое подменю прежней конфигурации ошибкой не было
  // — владельцем его делала непустота, — но теперь состав предъявляет автор, и
  // пустой ответ на «что в этом подменю» не ответ.
  if (items.length === 0) {
    throw new TypeError(`${path}: меню без пунктов не рисуется`);
  }
  items.forEach((item, index) => {
    assertItem(item, `${path}[${index}]`);
  });
  return /** @type {Array<MenuItem | SeparatorItem>} */ (items);
}

/**
 * Отпечаток состава уровня по значениям полей пунктов, а не по ссылкам на них:
 * автор вправе отдать новый массив новых объектов на каждом показе, и различие
 * ссылок ничего не значило бы — изменилось бы ровно то, что кодирует отпечаток.
 *
 * В отпечаток входят длина и порядок, разделитель это или пункт, `id` и `version`.
 * Действия в него не входят: у функции нет значения, а её результат и так
 * перечитывается на каждом показе, поэтому новая функция с тем же смыслом не
 * меняет в уровне ничего. `version` входит — это и есть способ автора сказать
 * «перестрой, я заменил действие».
 *
 * Значения кодируются с длиной, а не разделителем: `id` автора может содержать
 * что угодно, и без длины «a|b» и «a», «b» дали бы один отпечаток на два разных
 * состава. Совпасть отпечатки могут только у структурно одинаковых наборов, а у
 * них перестраивать нечего, — потому решение по отпечатку точное.
 *
 * @param {Array<MenuItem | SeparatorItem>} items
 * @returns {string} отпечаток состава.
 */
export function submenuHashOf(items) {
  const parts = [];
  for (const item of items) {
    if (isSeparator(item)) {
      parts.push('s');
      continue;
    }
    parts.push(`m${item.id === undefined ? '' : `${item.id.length}:${item.id}`}`);
    parts.push(`v${item.version === undefined ? DEFAULT_VERSION : item.version}`);
  }
  return `${parts.length}|${parts.join('|')}`;
}

/**
 * @param {MenuItem | SeparatorItem} item
 * @returns {item is SeparatorItem} `true`, если это разделитель. Объявление
 * предикатом нужно сужению типа: обычная функция с `boolean` на выходе тип не
 * сужает, и в `MenuItem` пришлось бы приводить приведением.
 */
function isSeparator(item) {
  return 'type' in item && item.type === SEPARATOR_TYPE;
}

/**
 * Единственный ответ на вопрос «доступен ли пункт». Здесь, а не в `renderMenuItem`
 * и не в `refreshItems` по отдельности: у них разный повод спросить, а вопрос один,
 * и два ответа на него разошлись бы при первом же возврате не из `true`.
 *
 * Поля нет — пункт доступен: предикат опционален, и его отсутствие не повод гасить
 * строку. Сравнение строгое: не-булево — это не «достаточно истинно», а предикат,
 * не ответивший на заданный вопрос. Забытый `return` у автора гасит пункт, и автор
 * видит причину, а не молча работающее меню.
 *
 * Исключение из действия наружу не гасится: вызывающий получает его из `open()`,
 * как и исключение из `action`. Считать пункт доступным или отключённым наугад
 * значило бы превратить поломку автора в тихое изменение поведения.
 *
 * @param {MenuItem} item
 * @returns {boolean} `true`, если пункт доступен.
 */
function isEnabledOf(item) {
  return item.isEnabledAction === undefined || item.isEnabledAction() === true;
}

/**
 * Подпись пункта на этом показе.
 *
 * @param {MenuItem} item
 * @param {string} path путь до пункта.
 * @returns {string} непустая подпись.
 * @throws {TypeError} если действие вернуло не строку или пустую.
 */
function labelOf(item, path) {
  const label = item.labelAction();
  if (!isNonEmptyString(label)) {
    throw new TypeError(`${path}.labelAction: действие обязано вернуть непустую подпись`);
  }
  return label;
}

/**
 * Иконка пункта на этом показе либо `null`, если у пункта её нет.
 *
 * @param {MenuItem} item
 * @param {string} path путь до пункта.
 * @returns {import('./icons.js').IconConfig | null}
 * @throws {TypeError} если действие вернуло не описание иконки.
 */
function iconOf(item, path) {
  if (item.iconAction === undefined) {
    return null;
  }
  return assertIcon(item.iconAction(), `${path}.iconAction`);
}

/**
 * Пункты подменю на этом показе либо `null`, если у пункта их нет.
 *
 * @param {MenuItem} item
 * @param {string} path путь до пункта.
 * @returns {Array<MenuItem | SeparatorItem> | null}
 * @throws {TypeError} если действие вернуло не массив или пустой.
 */
function submenuOf(item, path) {
  if (item.submenuAction === undefined) {
    return null;
  }
  return assertItems(item.submenuAction(), `${path}.submenuAction`);
}

/**
 * Владелец подменю: непустой состав И доступный пункт. Ответ `isEnabledOf`
 * передаётся, а не спрашивается здесь снова: предикат на показе зовётся один раз на
 * пункт, и второй вызов был бы вторым мнением об одном и том же решении.
 *
 * @param {boolean} enabled ответ `isEnabledOf` этому же пункту.
 * @param {Array<MenuItem | SeparatorItem> | null} submenuItems развёрнутое
 *   `submenuAction` пункта.
 * @returns {boolean}
 */
function isSubmenuOwner(enabled, submenuItems) {
  return enabled && submenuItems !== null;
}

/**
 * Отдающий управление: действие есть И пункт доступен.
 *
 * Правило то же, что у владельца подменю, и по той же причине — отключённый пункт
 * не отвечает ни за что. Совпадение двух правил не в костыль: отдача и подменю
 * отвечают на один вопрос «есть ли у пункта продолжение», и различать их приходится
 * не здесь, а в органе показа, где у каждого своё тело.
 *
 * @param {boolean} enabled ответ `isEnabledOf` этому же пункту.
 * @param {((event: Event, handoff: import('./MyContext.js').SubmenuHandoff) => void) | null} handoff действие отдачи пункта.
 * @returns {boolean}
 */
function handsOffOwner(enabled, handoff) {
  return enabled && handoff !== null;
}

/**
 * Ответы пункта на этот показ: всё, что о нём знать, собирается здесь и в одном
 * порядке — доступность, подпись, иконка, подменю. Один порядок на сборку уровня и
 * на каждый его показ: автор с побочным эффектом в действии увидел бы разный
 * порядок вызовов в зависимости от того, первый это показ или нет, а порядок
 * вызовов — часть контракта, а не деталь реализации.
 *
 * @typedef {object} ResolvedItem
 * @property {boolean} enabled ответ `isEnabledOf` этому же пункту.
 * @property {string} label непустая подпись.
 * @property {import('./icons.js').IconConfig | null} icon описание иконки либо
 *   `null`, если у пункта её нет.
 * @property {Array<MenuItem | SeparatorItem> | null} submenuItems пункты подменю
 *   либо `null`, если у пункта их нет.
 * @property {boolean} hasSubmenu владелец ли пункт подменю. **Решение** принимает
 *   `isSubmenuOwner`, и `hasSubmenu` у `RenderedItem` — это и есть его ответ:
 *   оркестратор переспрашивает признак, а не решает заново, потому что разошлись
 *   бы ответы — у отключённого пункта остался бы признак раскрытия, которого не
 *   будет.
 * @property {boolean} handsOff отдаёт ли пункт управление наружу. **Решение**
 *   принимает `handsOffOwner` по той же причине, что `hasSubmenu` — про отключённый
 *   пункт должно быть известно и здесь, а разошлись бы ответы так же.
 * @property {((event: Event, handoff: import('./MyContext.js').SubmenuHandoff) => void) | null} handoff действие отдачи этого показа.
 */

/**
 * @param {MenuItem} item
 * @param {string} path путь до пункта.
 * @returns {ResolvedItem}
 * @throws {TypeError} если хоть одно из действий вернуло не то, что обещало.
 */
function resolveItem(item, path) {
  const enabled = isEnabledOf(item);
  const label = labelOf(item, path);
  const icon = iconOf(item, path);
  const submenuItems = submenuOf(item, path);
  // Отдача берётся по форме, а не проверяется на негодность: действие уже проверено
  // `assertItem`, и результат его вызова — не наше дело, потому что звать его будет
  // оркестратор, а не рендерер.
  const handoff = item.handoffAction === undefined ? null : item.handoffAction;
  return {
    enabled,
    label,
    icon,
    submenuItems,
    hasSubmenu: isSubmenuOwner(enabled, submenuItems),
    handsOff: handsOffOwner(enabled, handoff),
    handoff,
  };
}

/**
 * Внутренний ключ пункта: идентификатор уровня плюс позиция в массиве.
 *
 * @param {RenderContext} context
 * @param {number} itemIndex
 * @returns {string}
 */
function keyOf(context, itemIndex) {
  return `${context.menuId}:${itemIndex}`;
}

/**
 * Идентификатор, который владелец резервирует под своё подменю. Подменю ещё не
 * создано, но `aria-owns` обязан быть уже назван, иначе связь «пункт ↔ меню» не
 * появилась бы вовсе. Префикс наследуется от `menuId`.
 *
 * @param {string} menuId идентификатор элемента уровня.
 * @param {number} itemIndex позиция пункта в уровне.
 * @returns {string}
 */
function submenuIdOf(menuId, itemIndex) {
  return `${menuId}-sub-${itemIndex}`;
}

/**
 * Ставит и снимает признаки пункта, уводящего в сторону. Единственное место, где
 * они заводятся, и на сборке уровня, и на каждом показе: расхождение двух путей
 * оставило бы на пункте `aria-owns`, ведущий в меню, раскрыть которое нечем.
 *
 * **Владелец подменю и отдающий управление делят шеврон, но не `aria-owns`.**
 * Шеврон обещает «дальше будет ещё меню», и оба обещания одинаково верны. Связь же
 * `aria-owns` может назвать только та, чьё подменю существует в этом документе, и у
 * отдающего её нет: меню, которое откроется вместо нашего, нам не принадлежит, и
 * адрес его элемента мы не знаем. Зато `aria-haspopup` у обоих уместно — раскрытие
 * последует, и скринридеру полезно знать, что оно будет.
 *
 * @param {RenderedItem} rendered
 * @param {boolean} hasSubmenu владелец ли пункт подменю.
 * @param {boolean} handsOff отдаёт ли пункт управление наружу.
 * @param {string} menuId
 * @param {number} itemIndex
 * @returns {void}
 */
function applyOwner(rendered, hasSubmenu, handsOff, menuId, itemIndex) {
  const element = rendered.element;
  rendered.submenuId = hasSubmenu ? submenuIdOf(menuId, itemIndex) : null;
  if (hasSubmenu || handsOff) {
    element.setAttribute('aria-haspopup', 'menu');
    if (hasSubmenu) {
      // Развёрнутым быть не может: подменю открывается только после показа, а
      // уровень, в котором владелец, сейчас как раз показывается.
      element.setAttribute('aria-expanded', 'false');
      element.setAttribute('aria-owns', /** @type {string} */ (rendered.submenuId));
    } else {
      // У отдающего раскрытия нет: `aria-expanded` обещало бы состояние, которое
      // никто не меняет, — меню уходит вместе с пунктом, а не меняет вид у него.
      element.removeAttribute('aria-expanded');
      element.removeAttribute('aria-owns');
    }
    // Направление шеврона по умолчанию; движок позиционирования переставляет его
    // на `left`, когда подменю пришлось открыть слева.
    element.dataset.chevron = 'right';
    if (rendered.chevron.parentElement !== element) {
      element.appendChild(rendered.chevron);
    }
    return;
  }
  // Пункт, потерявший и подменю, и отдачу, не оставляет за собой их признаков: иначе
  // `aria-owns` уводил бы скринридер в меню, раскрыть которое нечем, а
  // `aria-haspopup` обещал бы раскрытие, которого не будет.
  element.removeAttribute('aria-haspopup');
  element.removeAttribute('aria-expanded');
  element.removeAttribute('data-chevron');
  element.removeAttribute('aria-owns');
  if (rendered.chevron.parentElement === element) {
    element.removeChild(rendered.chevron);
  }
}

/**
 * @param {Array<MenuItem | SeparatorItem>} items
 * @returns {number} число пунктов без разделителей.
 */
function countItems(items) {
  let setSize = 0;
  for (const item of items) {
    if (!isSeparator(item)) {
      setSize += 1;
    }
  }
  return setSize;
}

/**
 * @returns {RenderedItem} разделитель. Без `tabindex`, без позиции в
 *   не-разделительном ряду и без ключа: записи в карте `actions` у него не бывает.
 */
function renderSeparator() {
  const element = document.createElement('div');
  element.className = 'vc-separator';
  element.setAttribute('role', 'separator');
  element.setAttribute('aria-orientation', 'horizontal');
  // Подписи, иконки и шеврона у разделителя нет, но контракт `RenderedItem` один на
  // оба вида узлов, а `refreshItems` по типу узла не фильтрует. Узлы заводятся и
  // остаются отцепленными: разделитель проходит мимо `resolveItem` и `applyOwner`,
  // и подменять их общим узлом уровня значило бы врать о разметке, которая к ним
  // отношения не имеет.
  const iconSlot = document.createElement('span');
  iconSlot.className = 'vc-icon-slot';
  const labelNode = document.createElement('span');
  labelNode.className = 'vc-label';
  const chevron = document.createElement('span');
  chevron.className = 'vc-chevron';
  return {
    element,
    focusable: false,
    hasSubmenu: false,
    handsOff: false,
    handoff: null,
    key: null,
    submenuId: null,
    iconSlot,
    labelNode,
    submenuItems: null,
    chevron,
  };
}

/**
 * Строит `menuitem` с тремя колонками сетки: слот иконки, лейбл и шеврон.
 *
 * `tabindex="-1"` у всех пунктов: ровно один пункт уровня получает `0`, и делает
 * это движок роуминга, когда активным становится пункт, — то есть после первого
 * касания мышью или клавишей. `data-active` не ставится здесь по той же причине.
 *
 * @param {MenuItem} item
 * @param {RenderContext} context
 * @param {number} itemIndex позиция пункта в исходном массиве уровня.
 * @param {number} setSize число пунктов уровня без разделителей.
 * @returns {RenderedItem}
 */
function renderMenuItem(item, context, itemIndex, setSize) {
  const path = `${context.menuId}:${itemIndex}`;
  assertItem(item, path);
  const resolved = resolveItem(item, path);

  const element = document.createElement('div');
  element.className = 'vc-item';
  element.setAttribute('role', 'menuitem');
  element.tabIndex = -1;
  element.setAttribute('aria-level', String(context.levelIndex + 1));
  element.setAttribute('aria-setsize', String(setSize));
  if (item.id !== undefined) {
    element.dataset.id = item.id;
  }
  if (!resolved.enabled) {
    element.setAttribute('aria-disabled', 'true');
  }

  const iconSlot = document.createElement('span');
  iconSlot.className = 'vc-icon-slot';
  if (resolved.icon !== null) {
    iconSlot.appendChild(renderIcon(resolved.icon));
  }

  const labelNode = document.createElement('span');
  labelNode.className = 'vc-label';
  labelNode.textContent = resolved.label;

  const chevron = document.createElement('span');
  chevron.className = 'vc-chevron';

  element.appendChild(iconSlot);
  element.appendChild(labelNode);

  /** @type {RenderedItem} */
  const rendered = {
    element,
    focusable: resolved.enabled,
    hasSubmenu: resolved.hasSubmenu,
    handsOff: resolved.handsOff,
    handoff: resolved.handsOff ? resolved.handoff : null,
    key: keyOf(context, itemIndex),
    submenuId: null,
    iconSlot,
    labelNode,
    submenuItems: resolved.hasSubmenu ? resolved.submenuItems : null,
    chevron,
  };
  applyOwner(rendered, resolved.hasSubmenu, resolved.handsOff, context.menuId, itemIndex);
  return rendered;
}

/**
 * Строит один узел уровня: пункт с иконкой, подменю или без них, либо разделитель.
 *
 * @param {MenuItem | SeparatorItem} item
 * @param {RenderContext} context
 * @param {number} itemIndex позиция в исходном массиве уровня; входит во
 *   внутренний ключ и в адрес зарезервированного подменю.
 * @param {number} setSize число пунктов уровня без разделителей; у разделителя
 *   не используется.
 * @returns {RenderedItem}
 */
export function renderItem(item, context, itemIndex, setSize) {
  if (isSeparator(item)) {
    return renderSeparator();
  }
  return renderMenuItem(item, context, itemIndex, setSize);
}

/**
 * Зона прокрутки. `aria-hidden` и отсутствие `tabindex` — контракт доступности:
 * курсор через зону проходит, а фокус и чтение с экрана — нет, иначе ровно на
 * прокручиваемом уровне в кольцо роуминга попал бы элемент без содержимого.
 *
 * @param {'up' | 'down'} edge сторона списка, у которой зона стоит.
 * @returns {HTMLElement}
 */
function renderScrollZone(edge) {
  const zone = document.createElement('div');
  zone.className = `vc-scroll-zone vc-scroll-zone-${edge}`;
  zone.setAttribute('aria-hidden', 'true');
  return zone;
}

/**
 * Строит уровень меню целиком: `div.vc-menu[popover=manual][role=menu]` с
 * `div.vc-list[role=group]` внутри, зонами прокрутки по краям списка и разметкой
 * всех пунктов.
 *
 * Уровень остаётся невставленным в документ: перед показом его измеряют вслепую
 * (спека 7.3), и только после этого вставляют в `<body>`.
 *
 * @param {Array<MenuItem | SeparatorItem>} items пункты уровня в исходном порядке.
 * @param {RenderContext} context
 * @returns {RenderedLevel}
 */
export function renderLevel(items, context) {
  const element = document.createElement('div');
  element.className = 'vc-menu';
  element.setAttribute('popover', 'manual');
  element.setAttribute('role', 'menu');
  element.id = context.menuId;
  // Элемент уровня держит фокус, когда активного пункта нет, а без `tabindex`
  // сфокусировать его нельзя: без этого состояние «уровень отвечает на клавиши,
  // а выделения нет» было бы недостижимо.
  element.tabIndex = -1;
  if (context.label !== undefined) {
    element.setAttribute('aria-label', context.label);
  }

  // Зоны строятся всегда, в том числе у короткого списка, где их не видно:
  // показывает их слой, и место для этого решения — один атрибут, а не разная
  // разметка. Порядок «зона — список — зона» и есть то, по чему зоны считаются
  // краями списка: меню — колонка, и края у неё заданы порядком детей.
  const up = renderScrollZone('up');
  element.appendChild(up);

  const list = document.createElement('div');
  list.className = 'vc-list';
  list.setAttribute('role', 'group');
  element.appendChild(list);

  const down = renderScrollZone('down');
  element.appendChild(down);

  const setSize = countItems(items);
  /** @type {RenderedItem[]} */
  const rendered = [];
  let position = 0;
  for (const [itemIndex, item] of items.entries()) {
    const entry = renderItem(item, context, itemIndex, setSize);
    // Разделитель не занимает номер в не-разделительном ряду и не получает
    // записи в карту `actions`: коллбэка у него нет. Ключ берётся у уже
    // собранного узла, а не вычисляется заново — две записи одного инварианта
    // разъехались бы, и тогда каждый поиск по карте молча промахивался бы мимо.
    if (!isSeparator(item) && entry.key !== null) {
      position += 1;
      entry.element.setAttribute('aria-posinset', String(position));
      context.actions.set(entry.key, item);
    }
    list.appendChild(entry.element);
    rendered.push(entry);
  }

  return { element, items: rendered, scroll: { list, up, down } };
}

/**
 * Приводит уже построенный уровень к текущим ответам действий его пунктов.
 *
 * Уровень живёт дольше одного показа, и действия, изменившие смысл между
 * показами, без этого прохода не действовали бы никогда: и разметка, и контракт
 * `RenderedItem` остались бы от решений, принятых при сборке. Перечитываются все
 * четыре — доступность, подпись, иконка и подменю, — каждое ровно один раз на
 * пункт, и все четыре зовутся у доступных пунктов тоже: ранний выход по совпавшему
 * состоянию спросил бы действие только у тех, у кого оно могло ответить иначе, а
 * автор ждал бы решения на каждом показе.
 *
 * Запись пункта в карте `actions` перезаписывается здесь же. Без этого структурно
 * тот же состав, предъявленный новыми объектами, оставил бы в карте действия
 * прежних пунктов: отпечаток совпал бы, перестройки не было бы, а по клику звалось
 * бы не то.
 *
 * Отметки роуминга с пункта, выпавшего из кольца, снимает движок, а не этот
 * проход: `data-active` — его словарь, и состояние «отключённый и активный»
 * обязано быть недостижимо, а не запрещено здешним присваиванием.
 *
 * @param {Array<MenuItem | SeparatorItem>} items пункты уровня в исходном порядке.
 * @param {RenderedItem[]} renderedItems пункты того же уровня по порядку.
 * @param {string} menuId идентификатор элемента уровня; входит в пути к полям и в
 *   адрес зарезервированного подменю.
 * @param {Map<string, MenuItem>} actions карта действий экземпляра.
 * @returns {void}
 */
export function refreshItems(items, renderedItems, menuId, actions) {
  for (const [itemIndex, renderedItem] of renderedItems.entries()) {
    const item = items[itemIndex];
    if (isSeparator(item) || renderedItem.key === null) {
      continue;
    }
    actions.set(renderedItem.key, item);
    const resolved = resolveItem(item, `${menuId}:${itemIndex}`);
    renderedItem.labelNode.textContent = resolved.label;
    if (resolved.icon === null) {
      renderedItem.iconSlot.replaceChildren();
    } else {
      renderedItem.iconSlot.replaceChildren(renderIcon(resolved.icon));
    }
    renderedItem.submenuItems = resolved.hasSubmenu ? resolved.submenuItems : null;
    // Действие отдачи перечитывается здесь же, где перечитываются подпись и подменю:
    // оно и есть ответ пункта на этот показ, и забытое прежнее означало бы, что
    // меню уйдёт по адресу, который автор уже сменил.
    renderedItem.handoff = resolved.handsOff ? resolved.handoff : null;
    // Базовое положение шеврона возвращается на каждом показе, а не только когда
    // владелец меняет признаки. `data-chevron` переставляет движок позиционирования,
    // когда подменю пришлось открыть слева, и снимает перестановку только показом
    // подменю: пока подменю закрыто, развёрнутый шеврон остался бы указывать в
    // сторону, в которую подменю не открывается.
    //
    // Ставится здесь, а не только в `applyOwner`, потому что ранний выход ниже
    // `applyOwner` не вызывает, а пропуск вёл бы к показу меню с развёрнутым
    // шевроном у свёрнутого подменю.
    if (resolved.hasSubmenu || resolved.handsOff) {
      renderedItem.element.dataset.chevron = 'right';
    }
    if (renderedItem.focusable === resolved.enabled
      && renderedItem.hasSubmenu === resolved.hasSubmenu
      && renderedItem.handsOff === resolved.handsOff) {
      continue;
    }
    const element = renderedItem.element;
    if (resolved.enabled) {
      element.removeAttribute('aria-disabled');
    } else {
      element.setAttribute('aria-disabled', 'true');
    }
    applyOwner(renderedItem, resolved.hasSubmenu, resolved.handsOff, menuId, itemIndex);
    renderedItem.focusable = resolved.enabled;
    renderedItem.hasSubmenu = resolved.hasSubmenu;
    renderedItem.handsOff = resolved.handsOff;
  }
}
