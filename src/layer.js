import { DEFAULT_ANIMATION_DURATION, SAFETY_PADDING } from './constants.js';
import { calculateMenuPosition, calculateSubmenuPosition } from './positioner.js';
import { renderLevel } from './renderer.js';
import { applyAnimationDuration, applyTheme } from './theme.js';

/**
 * Управление Top Layer: создание уровней, показ, скрытие, замер вслепую и
 * отложенное закрытие. Модуль ничего не знает про события страницы, клавиатуру и
 * hover intent — он держит DOM, геометрию и порядок отрисовки, а решение о том,
 * когда показывать и когда скрывать, принимает вызывающий код.
 *
 * Пять ловушек платформы, из-за которых модуль устроен так, как устроен. Все пять
 * проверены кейсами в `tests/e2e/layer.spec.js`, и три из них пришлось учесть
 * сверх того, что описано в спеке.
 *
 * **Элемент с атрибутом `popover` не показан до `showPopover()`.** UA-стиль прячет
 * его, поэтому наивный замер до показа даёт `0×0`, а с нулевыми габаритами
 * позиционер выбирает не тот кандидат и кладёт меню не туда. Замер идёт вслепую:
 * инлайново `display: flex; position: fixed; left: -9999px; top: 0;
 * visibility: hidden`, затем `getBoundingClientRect()`, затем настоящие координаты
 * и `showPopover()`. Мерцания нет: на момент замера элемент невидим, а вход через
 * `@starting-style` начинается с `opacity: 0`.
 *
 * **Замер требует, чтобы элемент уже был в документе.** Отцепленный узел не имеет
 * раскладки вообще: `getBoundingClientRect()` у него даёт нули, а `left: -9999px`
 * без раскладки бессмысленно. Поэтому подключение к `<body>` стоит перед замером,
 * а не после него. Побочный эффект ровно тот, что нужен: перенос узла в конец
 * `<body>` поднимает его в порядке отрисовки Top Layer, который совпадает с
 * порядком в DOM. Глубоко вложенное подменю иначе оказалось бы под ранее созданным
 * соседним.
 *
 * **В маску замера входит `transform: none`, и это не украшение.** Пока элемент не
 * `:popover-open`, на него действует базовое правило `.vc-menu { transform:
 * scale(0.96) }`, а `getBoundingClientRect` возвращает рамку именно после
 * преобразования. Замер без `transform: none` даёт 96% настоящих габаритов, и
 * позиционер раскладывает меню по заниженному размеру: у кандидата «влева от
 * курсора» меняется правый край, и меню выходит за `SAFETY_PADDING`. Под
 * `prefers-reduced-motion: reduce` расхождения не видно — там `transform` обнулён, —
 * и ошибка проявилась бы только у пользователей с обычным движением.
 *
 * **Временный порядок внутри показа жёсткий.** Раскладка → расчёт → снятие маски →
 * запись координат → `showPopover()`. Маску снимают раньше записи координат, а не
 * после: `left` и `top` принадлежат и маске, и результату, поэтому обратный порядок
 * стёр бы написанное. Запись координат до показа обязательна: показ до расчёта
 * означал бы, что позиция выведена из габаритов `0×0`.
 *
 * **`hidePopover()` убирает элемент из Top Layer мгновенно**, и выходной анимации
 * не было бы. Закрытие отложено ровно на `animationDuration`, и закрывает его
 * таймер — единственный источник закрытия.
 *
 * Гаснет уровень не потерей `:popover-open`: пока элемент открыт, он остаётся
 * `:popover-open`, стиль не меняется и переход не идёт, то есть меню всё
 * `animationDuration` стояло бы непрозрачным. Поэтому на отложенный период слой
 * ставит уровню `data-vc-closing`, и `opacity`, `transform` и `pointer-events`
 * меняются по правилу `.vc-menu[data-vc-closing]` из `styles/mycontext.css`.
 * Порядок такой:
 *
 * 1. `hide()` ставит `data-vc-closing`, и уровень гаснет **на своём месте, в Top
 *    Layer**, снимая с себя события;
 * 2. через `animationDuration` таймер зовёт `hidePopover()`, и уровень покидает
 *    Top Layer — к этому моменту он уже прозрачен и событий не принимает;
 * 3. `display` доходит до `none` ещё через `animationDuration`, и на этом хвосте
 *    элемент отрисован уже **вне** Top Layer, что и делает `pointer-events: none`
 *    обязательным: без него гаснущий уровень перехватывал бы клики по странице
 *    там, где он уже не над ней.
 *
 * Показ снимает `data-vc-closing` последним шагом, перед `showPopover()`: пока
 * атрибут стоит, `opacity` уже ноль и вход не отыграл бы. Обе операции происходят
 * в одной задаче, до отрисовки, поэтому кадра с прозрачным меню не бывает.
 *
 * `transitionend` в этом деле не участвует вовсе, и слушать его бессмысленно по
 * устройству платформы: выходной переход *вызывается* `hidePopover()`, то есть
 * единственным его источником был бы тот же таймер, а настоящее `transitionend`
 * приходит на одну длительность позже — уже никому.
 *
 * Отложенное закрытие отменяется показом того же уровня, иначе только что открытое
 * меню исчезло бы, — отменяет его поколение: каждое действие с уровнем увеличивает
 * счётчик, а задача закрытия смотрит на тот, который запомнила.
 *
 * **`prefers-reduced-motion: reduce` пропускает отложенность целиком, а не
 * сокращает её.** Медиазапрос читается в момент закрытия, а не при создании слоя.
 * Причина не в перехвате кликов: под `reduce` в CSS стоит `transition: none`, и
 * `display` меняется мгновенно, так что отложенный `hidePopover` ничего бы не
 * анимировал, — а `data-vc-closing` при `transition: none` погасил бы уровень
 * мгновенно, то есть состояние, ради которого отложенность и существует, стало бы
 * недостижимым.
 */

/**
 * @typedef {import('./renderer.js').MenuItem} MenuItem
 * @typedef {import('./renderer.js').SeparatorItem} SeparatorItem
 * @typedef {import('./renderer.js').RenderContext} RenderContext
 * @typedef {import('./renderer.js').RenderedItem} RenderedItem
 * @typedef {import('./renderer.js').RenderedLevel} RenderedLevel
 */

/**
 * Точка вызова корневого меню в координатах вьюпорта, px.
 *
 * @typedef {object} Point
 * @property {number} x
 * @property {number} y
 */

/**
 * Фактические габариты уровня, снятые замером вслепую, px.
 *
 * @typedef {object} MenuSize
 * @property {number} width
 * @property {number} height
 */

/**
 * Положение уровня в координатах вьюпорта. Повторяет `SubmenuPosition`, а для
 * корневого меню `flippedX` всегда `false`: флипа по X у него не бывает.
 *
 * @typedef {object} Placement
 * @property {number} left
 * @property {number} top
 * @property {boolean} flippedX `true`, если уровень открылся слева от своего
 *   пункта-владельца.
 */

/**
 * Уровень меню вместе со всем состоянием, которое о нём знает слой.
 *
 * @typedef {object} LevelEntry
 * @property {HTMLElement} element узел уровня.
 * @property {RenderedItem[]} items узлы пункктов и разделителей по порядку.
 * @property {LevelEntry|null} parent уровень, из которого этот открыт.
 * @property {RenderedItem|null} ownerItem пункт, открывший этот уровень; `null` у
 *   корня. Через `.element` доступны `aria-owns`, `aria-expanded` и
 *   `data-chevron`.
 * @property {LevelEntry[]} children уровни, открытые из пунктов этого уровня.
 * @property {boolean} open открыт ли уровень. `false` с момента вызова `hide`,
 *   хотя до истечения отложенного закрытия узел ещё видим и лежит в Top Layer.
 * @property {number} generation счётчик поколений. Растёт на каждом показе и на
 *   каждом закрытии; отложенное закрытие действует только при совпадении.
 * @property {number} activeIndex индекс пункта, которому движок роуминга передал
 *   фокус в уровне, или `-1`, если такого пункта нет. Слой инициализирует его и
 *   больше не трогает: `tabindex` и фокус принадлежат движку роуминга, и второй
 *   их владелец развёл бы состояние по двум писателям.
 */

/**
 * Настройки слоя.
 *
 * @typedef {object} MenuLayerOptions
 * @property {string} label доступное имя меню. Ставится каждому уровню, включая
 *   подменю: `role="menu"` без имени не пройдёт аудит доступности, а подменю
 *   остаётся частью того же меню.
 * @property {'auto'|'light'|'dark'} theme тема оформления всех уровней слоя.
 * @property {number} [animationDuration] длительность анимаций, мс, `140` по
 *   умолчанию. Поле объявлено опциональным, хотя бриф задачи перечисляет его
 *   обязательным: слой документирует значение по умолчанию и пользуется им, а
 *   объявление обязательным заставило бы вызывающий код — у которого
 *   `animationDuration` опционален ещё и в публичных опциях меню — подставлять
 *   лишнюю величину или приводить тип. Уходит в `--vc-animation-duration`
 *   элементов и в задержку отложенного закрытия, и потому обязана быть одной
 *   величиной.
 * @property {Map<string, MenuItem>} actions общий для всех уровней и всех
 *   экземпляров, передаваемый по ссылке. Картой владеет экземпляр меню: слой отдаёт
 *   её рендереру и не копирует, а очищает её целиком `MyContext.destroy()` — в том
 *   числе ключи уровней, снесённых перестроением, и уровней, никогда не
 *   показанных. Пока экземпляр жив, карта пополняется только.
 * @property {(fn: () => void, ms: number) => unknown} [schedule] постановка задачи.
 *   По умолчанию глобальный `setTimeout`, вызванный как метод `globalThis`:
 *   отвязанная ссылка на `setTimeout` в некоторых браузерах бросает
 *   `Illegal invocation`. Возвращённый жест задачи не интерпретируется.
 * @property {(handle: unknown) => void} [cancel] снятие задачи по жесту, который
 *   вернул `schedule`. По умолчанию глобальный `clearTimeout`.
 * @property {MediaQueryList} [reducedMotionQuery] запрос
 *   `prefers-reduced-motion: reduce`. Значение `.matches` читается в момент
 *   закрытия, поэтому смена настройки движка влияет на уже созданный слой. По
 *   умолчанию — `matchMedia('(prefers-reduced-motion: reduce)')`.
 */

/**
 * Слой меню: владение DOM уровней, их геометрией и порядком отрисовки.
 *
 * @typedef {object} MenuLayer
 * @property {(items: Array<MenuItem | SeparatorItem>, parent: LevelEntry | null, levelIndex: number, ownerItem: RenderedItem | null) => LevelEntry} ensureLevel
 *   Возвращает уровень для этих пунктов, создавая его при первом обращении.
 *   Идентичность уровня задают родитель и пункт-владелец, а не ссылка на массив
 *   пунктов: повторный вызов с теми же аргументами возвращает тот же
 *   `LevelEntry` и ничего не перестраивает. `parent` и `ownerItem` обязаны быть
 *   одновременно `null` (корень) или одновременно заданы (подменю), а
 *   `ownerItem` обязан быть владельцем непустого подменю — иначе создание
 *   бросает `Error`.
 * @property {(entry: LevelEntry, anchor: Point) => void} showRoot
 *   Показывает корневой уровень в точке `anchor` вьюпорта. Отменяет отложенное
 *   закрытие этого уровня и переносит его в конец `<body>`. Пункты не трогает:
 *   `data-active` и `tabindex` принадлежат движку роуминга, и слой не должен
 *   становиться их вторым владельцем.
 * @property {(entry: LevelEntry) => void} showSubmenu
 *   Показывает уровень-подменю относительно прямоугольника пункта-владельца.
 *   Отменяет отложенное закрытие уровня, ставит владельцу `aria-expanded="true"`,
 *   `aria-owns` с `id` подменю и `data-chevron` по признаку разворота по X.
 * @property {(entry: LevelEntry) => void} hide
 *   Закрывает уровень: снимает `aria-expanded` с его пункта-владельца и, если
 *   движение не подавлено, ставит `data-vc-closing` и откладывает `hidePopover` на
 *   `animationDuration`. Показ снимает отметку закрытия.
 * @property {() => void} hideAll
 *   Закрывает всю цепочку, от глубоких уровней к корню. DOM не трогает: уровни
 *   переиспользуются при следующем открытии.
 * @property {() => void} destroy
 *   Снимает висящие задачи, вызывает `hidePopover` на каждом заведённом уровне,
 *   удаляет их из DOM и чистит состояние. Повторный вызов безопасен, остальные
 *   методы после него — нет-операции, а `ensureLevel` бросает `Error`: значение
 *   уровня он вернуть не может. Карту `actions` `destroy` не трогает.
 */

/**
 * Счётчик экземпляров слоя. Идентификаторы уровней обязаны быть уникальны не
 * только внутри экземпляра, но и между экземплярами, делящими одну карту
 * `actions`: `menuId` входит в ключ пункта, и совпадение означало бы, что
 * активация пункта одного меню вызовет действие другого.
 */
let instanceSerial = 0;

/**
 * @param {() => void} fn
 * @param {number} ms
 * @returns {unknown} жест задачи, который отменяется через `cancel`.
 */
function defaultSchedule(fn, ms) {
  return globalThis.setTimeout(fn, ms);
}

/**
 * Жест задачи у инъекции — `unknown`, поэтому приведение к типу таймера
 * обязательно: слой жесты не различает, они для него просто значения.
 *
 * @param {unknown} handle
 * @returns {void}
 */
function defaultCancel(handle) {
  globalThis.clearTimeout(/** @type {number} */ (handle));
}

/**
 * @returns {MediaQueryList} запрос с живым значением `.matches`.
 */
function defaultReducedMotionQuery() {
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)');
}

/**
 * Инлайновая маска замера. Элемент уводится за левый край вьюпорта и делается
 * невидимым, но остаётся в раскладке — иначе измерять было бы нечего.
 *
 * @param {HTMLElement} element
 * @returns {void}
 */
function applyMeasureMask(element) {
  element.style.display = 'flex';
  element.style.position = 'fixed';
  element.style.left = '-9999px';
  element.style.top = '0';
  element.style.visibility = 'hidden';
  // Обнуление преобразования обязательно: без него замер идёт по рамке,
  // уменьшенной `scale(0.96)` базового правила, и вся геометрия считается по
  // заниженным габаритам.
  element.style.transform = 'none';
}

/**
 * @param {HTMLElement} element
 * @returns {void}
 */
function clearMeasureMask(element) {
  element.style.display = '';
  element.style.position = '';
  element.style.left = '';
  element.style.top = '';
  element.style.visibility = '';
  element.style.transform = '';
}

/**
 * Зарезервированный владельцем адрес подменю. Рендерер называет его заранее, и
 * уровень обязан занять именно этот `id`: иначе `aria-owns` вёл бы в никуда.
 * Адрес существует только у владельца непустого подменю, поэтому проверка
 * одновременно проверяет и то, что владелец подменю — настоящий.
 *
 * @param {RenderedItem} ownerItem
 * @returns {string}
 */
function reservedSubmenuId(ownerItem) {
  const reserved = ownerItem.element.getAttribute('aria-owns');
  if (reserved === null) {
    throw new Error('MyContext: у пункта-владельца нет зарезервированного id подменю');
  }
  return reserved;
}

/**
 * @param {DOMRect} rect
 * @returns {import('./positioner.js').AnchorRect} копия прямоугольника владельца.
 */
function anchorRectOf(rect) {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/**
 * @param {MenuLayerOptions} options
 * @returns {MenuLayer}
 */
export function createLayer(options) {
  const {
    label,
    theme,
    animationDuration = DEFAULT_ANIMATION_DURATION,
    actions,
    schedule = defaultSchedule,
    cancel = defaultCancel,
    reducedMotionQuery = defaultReducedMotionQuery(),
  } = options;

  instanceSerial += 1;
  const menuIdPrefix = `vc-${instanceSerial}`;
  /** @type {LevelEntry | null} */
  let root = null;
  /** @type {LevelEntry[]} */
  const levels = [];
  /** @type {Map<LevelEntry, unknown>} */
  const pendingHides = new Map();
  let destroyed = false;

  /**
   * @param {Array<MenuItem | SeparatorItem>} items
   * @param {LevelEntry | null} parent
   * @param {number} levelIndex
   * @param {RenderedItem | null} ownerItem
   * @param {string} menuId
   * @returns {LevelEntry}
   */
  function createEntry(items, parent, levelIndex, ownerItem, menuId) {
    /** @type {RenderContext} */
    const context = { levelIndex, menuId, label, actions };
    const rendered = renderLevel(items, context);
    applyTheme(rendered.element, theme);
    applyAnimationDuration(rendered.element, animationDuration);
    /** @type {LevelEntry} */
    const entry = {
      element: rendered.element,
      items: rendered.items,
      parent,
      ownerItem,
      children: [],
      open: false,
      generation: 0,
      activeIndex: -1,
    };
    levels.push(entry);
    return entry;
  }

  /**
   * @param {Array<MenuItem | SeparatorItem>} items пункты уровня в исходном порядке.
   * @param {LevelEntry | null} parent уровень, из которого открывается этот.
   * @param {number} levelIndex глубина уровня, начиная с 0; идёт в `aria-level`.
   * @param {RenderedItem | null} ownerItem пункт-владелец; `null` у корня.
   * @returns {LevelEntry} тот же уровень при повторном вызове с теми же
   *   аргументами.
   */
  function ensureLevel(items, parent, levelIndex, ownerItem) {
    if (destroyed) {
      throw new Error('MyContext: слой уничтожен');
    }
    if (parent === null) {
      if (ownerItem !== null) {
        throw new Error('MyContext: у корневого уровня нет пункта-владельца');
      }
      if (root === null) {
        root = createEntry(items, null, levelIndex, ownerItem, `${menuIdPrefix}-0`);
      }
      return root;
    }
    // Уровень без пункта-владельца некуда вешать: `aria-owns` и `aria-expanded`
    // живут на пункте, и подменю без пункта осталось бы связанным с миром.
    if (ownerItem === null) {
      throw new Error('MyContext: у уровня-подменя обязан быть пункт-владелец');
    }
    // Идентичность уровня — пара «родитель, владелец». Сравнение по ссылке на
    // `RenderedItem` устойчиво к перестроению разметки: элемент пункта
    // переиспользуется, а значит переиспользуется и уровень.
    const existing = parent.children.find((child) => {
      return child.ownerItem === ownerItem;
    });
    if (existing !== undefined) {
      return existing;
    }
    const entry = createEntry(items, parent, levelIndex, ownerItem, reservedSubmenuId(ownerItem));
    parent.children.push(entry);
    return entry;
  }

  /**
   * Показ уровня целиком: подключение, замер вслепую, расчёт положения, запись
   * координат и только потом `showPopover`. Расчёт отдан на откуп `place`, потому
   * что корень и подменю считаются по-разному, а порядок шагов у них один.
   *
   * @param {LevelEntry} entry
   * @param {(size: MenuSize) => Placement} place
   * @returns {Placement}
   */
  function present(entry, place) {
    entry.generation += 1;
    clearPendingHide(entry);
    const element = entry.element;
    applyMeasureMask(element);
    // Подключение до замера: у отцепленного узла нет раскладки, и замер вернул бы
    // нули. Перенос при этом поднимает уровень в конец `<body>`, а порядок
    // отрисовки в Top Layer следует за порядком в DOM.
    document.body.appendChild(element);
    const rect = element.getBoundingClientRect();
    const placement = place({ width: rect.width, height: rect.height });
    // Маска снимается раньше записи координат: `left` и `top` есть и у маски, и у
    // результата, и обратный порядок стёр бы написанное.
    clearMeasureMask(element);
    element.style.left = `${placement.left}px`;
    element.style.top = `${placement.top}px`;
    // Отметка закрытия снимается последней: пока она стоит, `opacity` уже ноль, и
    // вход не отыграл бы. Снятие и `showPopover` происходят в одной задаче, до
    // отрисовки, поэтому кадра с прозрачным меню не бывает.
    element.removeAttribute('data-vc-closing');
    element.showPopover();
    entry.open = true;
    return placement;
  }

  /**
   * @param {LevelEntry} entry корневой уровень.
   * @param {Point} anchor точка вызова в координатах вьюпорта.
   * @returns {void}
   */
  function showRoot(entry, anchor) {
    if (destroyed) {
      return;
    }
    present(entry, (size) => {
      const position = calculateMenuPosition({
        cursorX: anchor.x,
        cursorY: anchor.y,
        menuWidth: size.width,
        menuHeight: size.height,
        viewportWidth: globalThis.innerWidth,
        viewportHeight: globalThis.innerHeight,
        padding: SAFETY_PADDING,
      });
      return { left: position.left, top: position.top, flippedX: false };
    });
  }

  /**
   * @param {LevelEntry} entry уровень-подменю; у корня вызов бросает `Error`.
   * @returns {void}
   */
  function showSubmenu(entry) {
    if (destroyed) {
      return;
    }
    const owner = entry.ownerItem;
    if (owner === null) {
      throw new Error('MyContext: showSubmenu вызван для уровня без пункта-владельца');
    }
    // Пряугольник владельца снимается до показа подменю: подменю ещё не в
    // Top Layer и на раскладку родителя не влияет.
    const anchorRect = anchorRectOf(owner.element.getBoundingClientRect());
    const placement = present(entry, (size) => {
      return calculateSubmenuPosition({
        anchorRect,
        menuWidth: size.width,
        menuHeight: size.height,
        viewportWidth: globalThis.innerWidth,
        viewportHeight: globalThis.innerHeight,
        padding: SAFETY_PADDING,
      });
    });
    // Связь «пункт ↔ его меню» объявлена на пункте, а не на подменю: подменю живёт
    // в `<body>` рядом с корневым меню, и его собственный узел этой связи не
    // имеет. `aria-owns` обязан совпадать с `id` уровня, иначе ссылка висячая.
    owner.element.dataset.chevron = placement.flippedX ? 'left' : 'right';
    owner.element.setAttribute('aria-owns', entry.element.id);
    owner.element.setAttribute('aria-expanded', 'true');
  }

  /**
   * @param {LevelEntry} entry
   * @returns {void}
   */
  function clearPendingHide(entry) {
    const handle = pendingHides.get(entry);
    if (handle !== undefined) {
      cancel(handle);
      pendingHides.delete(entry);
    }
  }

  /**
   * @param {LevelEntry} entry
   * @returns {void}
   */
  function collapseOwner(entry) {
    const owner = entry.ownerItem;
    if (owner === null) {
      return;
    }
    // Отметка развёрнутости снимается, а не переводится в `false`: у закрытого
    // подменю состояния «развёрнуто» нет, и `aria-haspopup` остаётся единственным
    // верным признаком того, что подменю есть.
    owner.element.removeAttribute('aria-expanded');
  }

  /**
   * @param {LevelEntry} entry закрываемый уровень.
   * @returns {void}
   */
  function hide(entry) {
    if (destroyed) {
      return;
    }
    entry.generation += 1;
    const generation = entry.generation;
    clearPendingHide(entry);
    entry.open = false;
    collapseOwner(entry);
    // Под `reduce` отложенность пропускается целиком. Причина не в кликах по
    // странице: под `reduce` в CSS стоит `transition: none`, и `display` меняется
    // мгновенно, так что отложенный `hidePopover` ничего бы не анимировал, — а
    // `data-vc-closing` при `transition: none` погасил бы уровень мгновенно, то
    // есть состояние, ради которого отложенность и существует, стало бы
    // недостижимым.
    if (reducedMotionQuery.matches) {
      entry.element.hidePopover();
      return;
    }
    const element = entry.element;
    // Отметка закрытия: до неё уровень всё ещё `:popover-open`, стиль не меняется и
    // гаснуть нечему. С неё гаснут `opacity` и `transform` по правилу
    // `.vc-menu[data-vc-closing]`, и события с уровня снимаются — на всё время
    // отложенного периода, пока он в Top Layer.
    element.setAttribute('data-vc-closing', '');
    // Единственный источник закрытия. Проверка поколения стоит ДО уборки: задача,
    // чьё поколение устарело, не должна снять задачу новой, иначе меню осталось
    // бы висеть навсегда — закрывать его больше некому. Отметка закрытия при этом
    // остаётся: после `hidePopover` `display` доходит до `none` ещё через
    // `animationDuration`, и гаснущий элемент не должен принимать событий ни там.
    const handle = schedule(() => {
      if (entry.generation !== generation) {
        return;
      }
      clearPendingHide(entry);
      element.hidePopover();
    }, animationDuration);
    pendingHides.set(entry, handle);
  }

  /**
   * @param {LevelEntry} entry
   * @returns {LevelEntry[]} цепочка от `entry` вниз по детям.
   */
  function chainOf(entry) {
    const chain = [entry];
    for (const child of entry.children) {
      chain.push(...chainOf(child));
    }
    return chain;
  }

  /**
   * @param {LevelEntry} entry
   * @returns {number} глубина уровня в цепочке; `0` у корня.
   */
  function depthOf(entry) {
    let depth = 0;
    /** @type {LevelEntry | null} */
    let current = entry.parent;
    while (current !== null) {
      depth += 1;
      current = current.parent;
    }
    return depth;
  }

  function hideAll() {
    // После `destroy` корень обнулён, и проверка `root === null` заменяет
    // отдельную проверку на `destroyed`: обе означают одно и то же, а дублировать
    // их значило бы держать два признака одного состояния.
    if (root === null) {
      return;
    }
    // Убывание глубины: потомок уходит раньше предка всегда, иначе родитель
    // исчез бы из-под подменю, и то, что ещё закрывается, осталось бы висеть
    // поверх пустоты. Обратный обход дерева этому не удовлетворяет — на
    // соседних ветках он закрывает мелкий уровень раньше глубокого, — поэтому
    // порядок задан явно. Сортировка устойчивая, и при равной глубине уровни
    // уходят в порядке создания.
    const chain = chainOf(root);
    chain.sort((a, b) => {
      return depthOf(b) - depthOf(a);
    });
    for (const entry of chain) {
      hide(entry);
    }
  }

  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    for (const entry of levels) {
      clearPendingHide(entry);
      // `hidePopover` на закрытом и на отцепленном элементе безопасен, поэтому
      // вызов не зависит от того, показывался ли уровень.
      entry.element.hidePopover();
      entry.element.remove();
      entry.open = false;
    }
    levels.length = 0;
    root = null;
  }

  return {
    ensureLevel,
    showRoot,
    showSubmenu,
    hide,
    hideAll,
    destroy,
  };
}
