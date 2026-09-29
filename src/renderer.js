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
 * Четыре решения, которые нельзя вывести из разметки, зафиксированы здесь.
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
 * `styles/mycontext.css`. Собственно элемент `.vc-chevron` создаётся только у
 * владельцев подменю. Из этого следует и то, что открытие подменю не сдвигает
 * ни одного лейбла.
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
 * **Перечитывается `isEnabledAction`, и только он.** Уровень переиспользуется между
 * показами, а решение о доступности принимается при его сборке, — без
 * `refreshItems` предикат, изменивший смысл действия после первого показа, не
 * действовал бы никогда. Непустота подменю при этом не перечитывается: состав
 * уровня, подписи и иконки задаются первой сборкой, и меняются они новым
 * экземпляром. Владельцем пункт остаётся по факту непустого подменю, снятому при
 * сборке, — поэтому признак владельца выводится из `submenuId`, а не из текущего
 * `item.submenu`.
 *
 * **Каждый владелец подменю резервирует `id` подменю в `aria-owns`.** Подменю
 * лежат в `<body>` рядом с корневым меню, а не внутри пункта (спека 8.3):
 * `backdrop-filter` и анимация `scale` на родителе создают containing block и
 * ломают позиционирование относительно вьюпорта, а вложенный `position:
 * absolute` цепляется за прокручиваемый контейнер. Плата — у `role="menuitem"`
 * нет контейнера-`menu`, и `aria-owns` указывает на ещё не созданный узел.
 * Создатель подменю обязан взять идентификатор из
 * `owner.getAttribute('aria-owns')`: другой id сделал бы ссылку висячей.
 * Зарезервированный id хранится у пункта в `submenuId` — оттуда его и
 * возвращает `refreshItems`, потому что второй идентификатор на то же подменю
 * сделал бы ссылку висячей с другой стороны.
 */

/**
 * @typedef {object} MenuItem
 * @property {string} [id] авторский идентификатор. Копируется в `data-id` и в
 *   ключ пункта не входит: он опционален и может повторяться.
 * @property {string} label текст пункта.
 * @property {import('./icons.js').IconConfig} [icon] иконка. Без неё слот
 *   остаётся пустым, но занимает место.
 * @property {() => boolean} [isEnabledAction] предикат доступности, зовёмся при
 *   каждом показе. Вернул не `true` — пункт отключён: он не входит в цикл
 *   роуминга и не бывает владельцем подменю даже при непустом `submenu`. Без поля
 *   пункт доступен. Исключение уходит из `open()` вызывающему, как из `action`.
 * @property {(event: MouseEvent | KeyboardEvent) => void} [action] вызывается по
 *   внутреннему ключу пункта, а не хранится на узле.
 * @property {MenuItem[]} [submenu] непустой массив — и только тогда, вместе с
 *   доступностью по `isEnabledAction`, пункт считается владельцем подменю.
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
 *   `false` у разделителей, у пунктов с пустым `submenu` и у отключённых:
 *   признак один, и он означает «подменю можно раскрыть», а не «подменю есть».
 * @property {string | null} key внутренний ключ пункта; у разделителя `null`.
 * @property {string | null} submenuId `id`, зарезервированный под подменю этого
 *   пункта при сборке уровня; у не-владельцев и у разделителя `null`. Непустой
 *   ровно у тех пунктов, у которых `hasSubmenu` может стать истинным в принципе,
 *   и `refreshItems` берёт признак владельца отсюда, а не из текущего
 *   `item.submenu`.
 * @property {HTMLElement | null} chevron узел `.vc-chevron`; у не-владельцев при
 *   сборке `null`. `refreshItems` убирает его с пункта, потерявшего владение, и
 *   возвращает по адресу, а не ищет заново: шеврон в разметке ровно у владельцев,
 *   и искать его селектором значило бы допустить второе его место.
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

/**
 * Разделитель отличается от пункта единственным полем, поэтому проверка идёт по
 * нему же. Объявление предикатом нужно сужению типа: обычная функция с
 * `boolean` на выходе тип не сужает, и в `MenuItem` пришлось бы приводить
 * приведением.
 *
 * @param {MenuItem | SeparatorItem} item
 * @returns {item is SeparatorItem} `true`, если это разделитель.
 */
function isSeparator(item) {
  return 'type' in item && item.type === SEPARATOR_TYPE;
}

/**
 * @param {MenuItem} item
 * @returns {boolean} `true`, если у пункта есть непустое подменю.
 */
function hasSubmenuOf(item) {
  return Array.isArray(item.submenu) && item.submenu.length > 0;
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
 * Исключение из предиката наружу не гасится: вызывающий получает его из `open()`,
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
 * Владелец подменю. **Решение** о том, владелец ли пункт, принимается здесь, и
 * `hasSubmenu` у `RenderedItem` — это и есть этот ответ. Оркестратор
 * переспрашивает `hasSubmenu`, а не решает заново, потому что разошлись бы
 * ответы: у отключённого пункта остался бы признак раскрытия, которого не будет.
 *
 * Ответ `isEnabledOf` передаётся, а не спрашивается здесь снова: предикат на
 * сборке уровня зовётся один раз на пункт, и второй вызов был бы вторым мнением
 * об одном и том же решении.
 *
 * @param {MenuItem} item
 * @param {boolean} enabled ответ `isEnabledOf` этому же пункту.
 * @returns {boolean} `true`, если у пункта непустое подменю и он доступен.
 */
function isSubmenuOwner(item, enabled) {
  return enabled && hasSubmenuOf(item);
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
 * @param {RenderContext} context
 * @param {number} itemIndex
 * @returns {string}
 */
function submenuIdOf(context, itemIndex) {
  return `${context.menuId}-sub-${itemIndex}`;
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
  return {
    element,
    focusable: false,
    hasSubmenu: false,
    key: null,
    submenuId: null,
    chevron: null,
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
  // Предикат спрашивается один раз на пункт, а ответ читают и признак владельца, и
  // `focusable`. Повторный вызов был бы вторым мнением об одном и том же решении, а
  // у автора с побочным эффектом в предикате ещё и разошёлся бы с тем, что он видит.
  const enabled = isEnabledOf(item);
  // Решение о владельце принимается в одном месте — `isSubmenuOwner`, — и
  // `hasSubmenu` выходит именно оттуда, а не из второй проверки: расхождение
  // двух независимых ответов и было причиной того, что отключённый пункт
  // обещал подменю, которое нечем было раскрыть.
  const hasSubmenu = isSubmenuOwner(item, enabled);
  /** @type {string | null} */
  let submenuId = null;
  const element = document.createElement('div');
  element.className = 'vc-item';
  element.setAttribute('role', 'menuitem');
  element.tabIndex = -1;
  element.setAttribute('aria-level', String(context.levelIndex + 1));
  element.setAttribute('aria-setsize', String(setSize));
  if (item.id !== undefined) {
    element.dataset.id = item.id;
  }
  if (!enabled) {
    element.setAttribute('aria-disabled', 'true');
  }
  if (hasSubmenu) {
    submenuId = submenuIdOf(context, itemIndex);
    element.setAttribute('aria-haspopup', 'menu');
    element.setAttribute('aria-expanded', 'false');
    // Направление шеврона по умолчанию; движок позиционирования переставляет его
    // на `left`, когда подменю пришлось открыть слева.
    element.dataset.chevron = 'right';
    element.setAttribute('aria-owns', submenuId);
  }

  const slot = document.createElement('span');
  slot.className = 'vc-icon-slot';
  if (item.icon !== undefined) {
    slot.appendChild(renderIcon(item.icon));
  }

  const label = document.createElement('span');
  label.className = 'vc-label';
  label.textContent = item.label;

  element.appendChild(slot);
  element.appendChild(label);

  /** @type {HTMLElement | null} */
  let chevron = null;
  if (hasSubmenu) {
    chevron = document.createElement('span');
    chevron.className = 'vc-chevron';
    element.appendChild(chevron);
  }

  return {
    element,
    focusable: enabled,
    hasSubmenu,
    key: keyOf(context, itemIndex),
    submenuId,
    chevron,
  };
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
 * Приводит уже построенный уровень к текущему ответу `isEnabledAction` его пунктов.
 *
 * Уровень живёт дольше одного показа, и предикат, изменивший смысл действия между
 * показами, без этого прохода не действовал бы никогда: и разметка, и контракт
 * `RenderedItem` остались бы от решения, принятого при сборке. Перечитывается одно
 * поле, и признак владельца следует из него, а не из состава подменю, — поэтому
 * уровень, однажды построенный, меняет состояние, но не состав.
 *
 * Предикат спрашивается у каждого пункта на каждом показе, включая доступные:
 * ранний выход по совпавшему состоянию спросил бы предикат только у тех, у кого он
 * мог ответить иначе, а автор ждал бы решения на каждом показе.
 *
 * Отметки роуминга с пункта, выпавшего из кольца, снимает движок, а не этот
 * проход: `data-active` — его словарь, и состояние «отключённый и активный»
 * обязано быть недостижимо, а не запрещено здешним присваиванием.
 *
 * @param {Array<MenuItem | SeparatorItem>} items пункты уровня в исходном порядке.
 * @param {RenderedItem[]} renderedItems пункты того же уровня по порядку.
 * @returns {void}
 */
export function refreshItems(items, renderedItems) {
  for (const [itemIndex, renderedItem] of renderedItems.entries()) {
    const item = items[itemIndex];
    if (isSeparator(item) || renderedItem.key === null) {
      continue;
    }
    const focusable = isEnabledOf(item);
    // Владельцем пункт остаётся по факту непустого подменю, снятому при сборке:
    // непустота `submenu` здесь не перечитывается, и `submenuId` — единственное,
    // что её помнит.
    const hasSubmenu = renderedItem.submenuId !== null && focusable;
    if (renderedItem.focusable === focusable && renderedItem.hasSubmenu === hasSubmenu) {
      continue;
    }
    const element = renderedItem.element;
    if (focusable) {
      element.removeAttribute('aria-disabled');
    } else {
      element.setAttribute('aria-disabled', 'true');
    }
    if (hasSubmenu) {
      element.setAttribute('aria-haspopup', 'menu');
      // Развёрнутым быть не может: подменю открывается только после показа, а
      // уровень, в котором владелец, сейчас как раз показывается.
      element.setAttribute('aria-expanded', 'false');
      element.dataset.chevron = 'right';
      element.setAttribute('aria-owns', /** @type {string} */ (renderedItem.submenuId));
      const chevron = renderedItem.chevron;
      if (chevron !== null && chevron.parentElement !== element) {
        element.appendChild(chevron);
      }
    } else {
      // Владелец, потерявший подменю, не оставляет за собой его признаков: иначе
      // `aria-owns` уводил бы скринридер в меню, раскрыть которое нечем, а
      // `aria-haspopup` обещал бы раскрытие, которого не будет.
      element.removeAttribute('aria-haspopup');
      element.removeAttribute('aria-expanded');
      element.removeAttribute('data-chevron');
      element.removeAttribute('aria-owns');
      const chevron = renderedItem.chevron;
      if (chevron !== null && chevron.parentElement === element) {
        element.removeChild(chevron);
      }
    }
    renderedItem.focusable = focusable;
    renderedItem.hasSubmenu = hasSubmenu;
  }
}
