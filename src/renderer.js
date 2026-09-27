import { renderIcon } from './icons.js';

/**
 * Рендерер уровней меню: строит DOM одного уровня — сам элемент уровня,
 * прокручиваемый список внутри него и пункты.
 *
 * Модуль ничего не знает про открытие, позиционирование, клавиатуру и закрытие.
 * Он отдаёт разметку и три контракта, на которые опираются остальные: внутренний
 * ключ пункта, список доступных фокусу пунктов и зарезервированные идентификаторы
 * подменю для `aria-owns`.
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
 * **Владелец — это одно условие: непустое подменю И не отключённый пункт.**
 * Отключённый пункт с непустым подменю владельцем не является: раскрыть его
 * нечем — ни мышью, ни с клавиатуры, ни кликом, — а шеврон, `aria-haspopup` и
 * `aria-owns` обещали бы раскрытие, которого не будет. В родных меню у
 * отключённого пункта признака подменю тоже нет. Отсюда и то, что решение
 * принимается один раз, а не по двум независимым полям: `focusable` и
 * `hasSubmenu` читают одну и ту же переменную `disabled`, поэтому пункт не может
 * оказаться недоступным для роуминга и при этом обещать подменю.
 *
 * **Каждый владелец подменю резервирует `id` подменю в `aria-owns`.** Подменю
 * лежат в `<body>` рядом с корневым меню, а не внутри пункта (спека 8.3):
 * `backdrop-filter` и анимация `scale` на родителе создают containing block и
 * ломают позиционирование относительно вьюпорта, а вложенный `position:
 * absolute` цепляется за прокручиваемый контейнер. Плата — у `role="menuitem"`
 * нет контейнера-`menu`, и `aria-owns` указывает на ещё не созданный узел.
 * Создатель подменю обязан взять идентификатор из
 * `owner.getAttribute('aria-owns')`: другой id сделал бы ссылку висячей.
 */

/**
 * @typedef {object} MenuItem
 * @property {string} [id] авторский идентификатор. Копируется в `data-id` и в
 *   ключ пункта не входит: он опционален и может повторяться.
 * @property {string} label текст пункта.
 * @property {import('./icons.js').IconConfig} [icon] иконка. Без неё слот
 *   остаётся пустым, но занимает место.
 * @property {boolean} [disabled] отключённый пункт не входит в цикл роуминга и
 *   не бывает владельцем подменю даже при непустом `submenu`.
 * @property {(event: MouseEvent | KeyboardEvent) => void} [action] вызывается по
 *   внутреннему ключу пункта, а не хранится на узле.
 * @property {MenuItem[]} [submenu] непустой массив — и только тогда, вместе с
 *   отсутствием `disabled`, пункт считается владельцем подменю.
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
 * @property {Map<string, MenuItem>} actions общий для всех уровней и всех
 *   экземпляров и передаваемый по ссылке. Рендерер кладёт сюда каждый пункт под
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
 */

/**
 * @typedef {object} RenderedLevel
 * @property {HTMLElement} element узел уровня. Не вставлен в документ: это дело
 *   вызывающего, потому что перед показом его надо измерить.
 * @property {RenderedItem[]} items все узлы уровня по порядку, включая
 *   разделители. Доступные фокусу пункты — те, у кого `focusable`.
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
 * Владелец подменю. Решение о том, владелец ли пункт, принимается здесь и не
 * перерешается нигде: `hasSubmenu` у `RenderedItem` — это и есть этот ответ, и
 * разошлись бы они с разметкой (`aria-haspopup`, `aria-owns`, шеврон), у
 * отключённого пункта остался бы признак раскрытия, которого не будет.
 *
 * @param {MenuItem} item
 * @returns {boolean} `true`, если у пункта непустое подменю и он не отключён.
 */
function isSubmenuOwner(item) {
  return item.disabled !== true && hasSubmenuOf(item);
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
  return { element, focusable: false, hasSubmenu: false, key: null };
}

/**
 * Строит `menuitem` с тремя колонками сетки: слот иконки, лейбл и шеврон.
 *
 * `tabindex="-1"` у всех пунктов: ровно один элемент уровня получает `0`, и
 * делает это движок роуминга после показа меню. `data-active` не ставится
 * здесь по той же причине — активным становится тот пункт, на который повели
 * мышью или который получил фокус.
 *
 * @param {MenuItem} item
 * @param {RenderContext} context
 * @param {number} itemIndex позиция пункта в исходном массиве уровня.
 * @param {number} setSize число пунктов уровня без разделителей.
 * @returns {RenderedItem}
 */
function renderMenuItem(item, context, itemIndex, setSize) {
  // `disabled` читается один раз, и `hasSubmenu` выходит из `isSubmenuOwner`, а не
  // из второй проверки: расхождение двух независимых ответов и было причиной того,
  // что отключённый пункт обещал подменю, которое нечем было раскрыть.
  const disabled = item.disabled === true;
  const hasSubmenu = isSubmenuOwner(item);
  const element = document.createElement('div');
  element.className = 'vc-item';
  element.setAttribute('role', 'menuitem');
  element.tabIndex = -1;
  element.setAttribute('aria-level', String(context.levelIndex + 1));
  element.setAttribute('aria-setsize', String(setSize));
  if (item.id !== undefined) {
    element.dataset.id = item.id;
  }
  if (disabled) {
    element.setAttribute('aria-disabled', 'true');
  }
  if (hasSubmenu) {
    element.setAttribute('aria-haspopup', 'menu');
    element.setAttribute('aria-expanded', 'false');
    // Направление шеврона по умолчанию; движок позиционирования переставляет его
    // на `left`, когда подменю пришлось открыть слева.
    element.dataset.chevron = 'right';
    element.setAttribute('aria-owns', submenuIdOf(context, itemIndex));
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

  if (hasSubmenu) {
    const chevron = document.createElement('span');
    chevron.className = 'vc-chevron';
    element.appendChild(chevron);
  }

  return {
    element,
    focusable: !disabled,
    hasSubmenu,
    key: keyOf(context, itemIndex),
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
 * Строит уровень меню целиком: `div.vc-menu[popover=manual][role=menu]` с
 * `div.vc-list[role=group]` внутри и разметкой всех пунктов.
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
  if (context.label !== undefined) {
    element.setAttribute('aria-label', context.label);
  }

  const list = document.createElement('div');
  list.className = 'vc-list';
  list.setAttribute('role', 'group');
  element.appendChild(list);

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

  return { element, items: rendered };
}
