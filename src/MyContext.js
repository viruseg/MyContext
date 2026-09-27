import { DEFAULT_ANIMATION_DURATION, DEFAULT_MENU_LABEL } from './constants.js';
import { createHoverIntent } from './hoverIntent.js';
import { createKeyboard } from './keyboard.js';
import { createLayer } from './layer.js';

/**
 * @typedef {import('./icons.js').EmojiIconConfig} EmojiIconConfig
 * @typedef {import('./icons.js').SvgIconConfig} SvgIconConfig
 * @typedef {import('./icons.js').RasterIconConfig} RasterIconConfig
 * @typedef {import('./icons.js').IconConfig} IconConfig
 * @typedef {import('./renderer.js').MenuItem} MenuItem
 * @typedef {import('./renderer.js').SeparatorItem} SeparatorItem
 * @typedef {import('./renderer.js').RenderedItem} RenderedItem
 * @typedef {import('./layer.js').LevelEntry} LevelEntry
 * @typedef {import('./layer.js').MenuLayer} MenuLayer
 * @typedef {import('./layer.js').Point} Point
 * @typedef {import('./keyboard.js').KeyboardController} KeyboardController
 * @typedef {import('./keyboard.js').KeyboardHost} KeyboardHost
 * @typedef {import('./hoverIntent.js').HoverIntentController} HoverIntentController
 */

/**
 * @typedef {object} MyContextOptions
 * @property {'auto' | 'light' | 'dark'} [theme] тема оформления всех уровней,
 *   `'auto'` по умолчанию.
 * @property {number} [animationDuration] длительность входа, выхода и отложенного
 *   закрытия, мс, `DEFAULT_ANIMATION_DURATION` по умолчанию. Величина одна и та же
 *   у всех трёх, иначе выход не совпадёт с задержкой снятия.
 * @property {string} [label] доступное имя меню, `DEFAULT_MENU_LABEL` по умолчанию:
 *   имя у уровня обязательно (`createLayer` требует строку), а пустое имя не читается
 *   и не проходит аудит.
 */

const ITEM_SELECTOR = '.vc-item';
const MENU_SELECTOR = '.vc-menu';
const SEPARATOR_TYPE = 'separator';
const RASTER_TYPE = 'raster';
const ICON_TYPES = new Set([RASTER_TYPE, 'emoji', 'svg']);
const ITEMS_PATH = 'items';
const CHAIN_ROOT_INDEX = 0;
const PRIMARY_MOUSE_BUTTON = 0;
const DESTROYED_MESSAGE = 'MyContext: экземпляр уничтожен';
const POPOVER_REQUIREMENT =
  'MyContext: браузер не поддерживает Popover API — нет HTMLElement.prototype.showPopover';

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
 * Иконка допустима при совпадении `type` одному из трёх видов, и у каждого вида
 * своё обязательное поле: у `emoji` и `svg` — непустой `value`, у `raster` —
 * непустой `alt`. Проверка `alt` единственная: рендерер подставит защитничную
 * пустую строку, и дефект уехал бы в скринридер. `value` обязателен у всех трёх
 * видов: без него `isSafeRasterUrl` разбирает `undefined` как адрес текущей
 * страницы, проходит проверку схемы и отдаёт `<img>` запрос за `undefined`.
 *
 * @param {unknown} icon описание иконки.
 * @param {string} path путь до описания.
 * @returns {void}
 * @throws {TypeError} на первом негодном поле.
 */
function validateIcon(icon, path) {
  if (icon === undefined) {
    return;
  }
  if (!isRecord(icon)) {
    throw new TypeError(`${path}: описание иконки должно быть объекром`);
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
}

/**
 * Расширение типа слушателя для таблицы глобальных обработчиков.
 *
 * `addEventListener` отдаёт обработчику `Event`, а наши обработчики объявлены с
 * узкими типами — `PointerEvent`, `KeyboardEvent` — ради проверок внутри тела.
 * Приводить приходится, и делается это здесь, ровно один раз на обработчик, а не в
 * каждом месте установки: внутри тела тип остаётся узким, и ошибка в разборе
 * события по-прежнему ловится компилятором. `never` в параметре делает приведение
 * безопасным по направлению: принять такой обработчик может только функция, способная
 * обработать любое событие, то есть ровно наш случай.
 *
 * @param {(event: never) => void} handler обработчик с узким типом события.
 * @returns {EventListener} тот же обработчик с типом `EventListener`.
 */
function asListener(handler) {
  return /** @type {EventListener} */ (/** @type {unknown} */ (handler));
}

/**
 * Требование платформы проверяется в `attach`, а не в конструкторе: без привязки
 * экземпляр пригоден для `open()` там, где автор и так работает со своим
 * поповером, и падать рано было бы невежливо.
 *
 * @returns {void}
 * @throws {Error} если браузер не умеет показывать поповеры.
 */
function assertPopoverSupport() {
  if (typeof HTMLElement === 'undefined' || typeof HTMLElement.prototype.showPopover !== 'function') {
    throw new Error(POPOVER_REQUIREMENT);
  }
}

/**
 * Оркестратор меню: конфигурация, приватное состояние экземпляра и жизненный цикл.
 * Первый модуль, где встречаются рендерер, слой, движок клавиатуры и hover intent,
 * поэтому половина его работы — не нарисовать, а не разорвать контракты соседей.
 *
 * **Активация: обработчик один, делегированный; владелец подменю по клику открывает
 * подменю, а не зовёт своё действие.** Синтетический `click` движка всплывает, поэтому
 * слушатель один на элемент уровня, ключ берётся у узла (авторский `id` необязателен
 * и повторяем), и второго пути активации у пункта нет. Клик по владельцу непустого
 * подменю открывает подменю — как в родных меню и как делает `Enter`, который до
 * `host.openSubmenu` доходит напрямую, без синтетического клика, так что пути мыши и
 * клавиатуры не смешиваются. Правило зафиксировано решением ревью Task 9, а не выведено
 * из разметки: `hasSubmenu` у рендерера означает «есть подменю», а не «есть действие».
 *
 * **Показ подменю по мыши — четыре разных события на четырёх разных узлах.**
 * `pointerenter` и `pointerdown` на пункте-владельце, `pointermove` на элементе
 * уровня и `pointerenter` на самом подменю. `pointerenter` и `pointerleave` не
 * всплывают, поэтому пункт подписывается лично — и подписывается ровно тогда,
 * когда рендерер назвал его владельцем, то есть отключённые пункты-владельцы не
 * подписаны ни на что и не открываются ни одной дверью. Решение о том, когда
 * показывать и когда скрывать, принимает `hoverIntent` и сообщает его колбэками
 * `onOpen` и `onClose`; оркестратор не опрашивает `isOpenPending` никогда — опрос
 * был бы вторым источником тиков и сдвинул бы показ относительно решения.
 * `pointermove` передаётся в hover intent не по всему дереву, а мимо
 * пунктов-владельцев: на владельце решать нечего, и там каждое движение курсора
 * планировало бы закрытие подменю, которое только что открылось.
 *
 * **Показанный уровень всегда отдаётся движку через `focusFirst`, а не только
 * корневой.** Движок берёт уровень из своего реестра, а не из DOM, поэтому уровень,
 * которому не звали `focusFirst`, не получает клавиш вовсе, и `close()` сбрасывает
 * реестр — значит повторный `open()` обязан отдать уровень заново. Отсюда же и
 * перенос фокуса в подменю, открытое мышью: регистрация уровня и фокус — один вызов,
 * а регистрации без фокуса у движка нет. Место у `#openSubmenu` одно, поэтому пути
 * показа — наведение, нажатие, клик и клавиатура — не могут разойтись. Клавиатурный
 * путь потому и не переносит фокус сам: `ArrowRight` и `Enter` зовут
 * `host.openSubmenu` и всё, а перенос делает тот же `#openSubmenu`.
 *

 * **Уровень подменю заводится на шаг вперёд, но не глубже, и только для доступных
 * владельцев.** Движок ищет подменю по паре «родитель, владелец» и уровни не создаёт,
 * поэтому незаведённый уровень не открылся бы ни по `ArrowRight`, ни по клику — молча.
 * Отключённый владелец в цикл роуминга не входит, кликом не активируется и владельцем
 * не считается: рендерер ставит `hasSubmenu` по непустому подменю **и** доступности,
 * поэтому у него нет ни шеврона, ни `aria-owns`, ни заводимого уровня — обещать
 * раскрытие, которого не будет, не должен ни один слой. Глубже шага заведение не
 * идёт: следующий уровень появится, когда покажется этот, — иначе ленивая постройка
 * веток стала бы постройкой всего дерева при первом открытии.
 *
 * **Цепочка открытых уровней — единственный источник правды о том, что показано.**
 * Слой знает состояние каждого уровня, но не знает, какой из них глубже текущего.
 * Открытие подменю обрезает цепочку до его родителя, то есть уносит всё глубже
 * открытое, — а не закрывает меню целиком: переход на соседний пункт должен оставить
 * открытым уровень, из которого этот пункт и открыт.
 *
 * **Слушатель `keydown` висит на уровне, а не на документе.** Глобальные слушатели —
 * отдельная задача, и до их появления клавиши адресуются пункту, а не документу.
 * Слушатель уровня пропускает событие, уже погашенное (`event.defaultPrevented`):
 * общий слушатель разберёт клавишу в capture-фазе раньше, и второй разбор не
 * случится, — поэтому переносить его на уровень не придётся.
 */
export class MyContext {
  /** @type {Array<MenuItem | SeparatorItem>} */
  #items;

  /** @type {Required<MyContextOptions>} опции с подставленными дефолтами. */
  #options;

  /** @type {MenuLayer} */
  #layer;

  /** @type {KeyboardController} */
  #keyboard;

  /** @type {HoverIntentController} */
  #hover;

  /**
   * Карта действий всех уровней экземпляра: кладёт рендерер, читает обработчик
   * активации, целиком чистит `destroy()`.
   *
   * @type {Map<string, MenuItem>}
   */
  #actions;

  /**
   * Уровни, заведённые слоем, по элементу уровня. Нужен и для поиска уровня по цели
   * события, и для того, чтобы обработчики уровня навешивались ровно один раз.
   *
   * @type {Map<HTMLElement, LevelEntry>}
   */
  #levels;

  /**
   * Пункты, на которые подписан показ подменю, по узлу пункта. Это ровно те
   * владельцы, которые роуминг может сделать активными: отключённые владельцы сюда
   * не попадают, и наведение, нажатие и движение курсора по ним никуда не идут.
   * Нужен и обработчикам показа, и проверке «курсор на пункте-владельце» в
   * `pointermove` уровня.
   *
   * @type {Map<Element, RenderedItem>}
   */
  #showTargets;

  /**
   * Открытые уровни от корня к текущему. Единственный источник правды о том, что
   * показано: `#layer` знает состояние каждого уровня, но не знает, какой из них
   * глубже текущего, и без этой строки усечение цепочки было бы негде искать.
   * Первый элемент — всегда корень.
   *
   * @type {LevelEntry[]}
   */
  #chain;

  /**
   * Владелец, под подменю которого зреет отложенное открытие. Заполняется
   * наведением, читается колбэком `onOpen`: решение о показе принимает
   * `hoverIntent` по своим таймерам, а предмет показа — оркестратор, и он не
   * выводится из DOM заново.
   *
   * @type {RenderedItem | null}
   */
  #hoverOwner;

  /** @type {LevelEntry | null} */
  #root = null;

  /** @type {HTMLElement | null} */
  #attachedTo = null;

  /** @type {HTMLElement | null} */
  #focusOwner = null;

  /**
   * Правда ли, что последнее движение курсора было в пустоте страницы — то есть
   * вне дерева меню и вне привязанного контейнера. Это различает два исхода одного
   * и того же сигнала `hoverIntent`: курсор ушёл с подменю, но ещё ходит по меню —
   * тогда закрывается один уровень; курсор ушёл с дерева целиком — тогда цепочка.
   * Сама геометрия различия не даёт: обе точки вне клина, и `hoverIntent` планирует
   * закрытие одинаково, поэтому область закрытия решает оркестратор, читая цель
   * события. Сбрасывается в `open()` вместе с отложенными задачами: после переноса
   * меню прежняя точка ничего не значит.
   *
   * @type {boolean}
   */
  #pointerOutsideTree = false;

  /**
   * Глобальные слушатели: узел, имя события и сама функция. Снимаются все разом по
   * списку, поэтому `detach()` и `destroy()` не могут оставить ни одного, а
   * добавить обработчик, забыв его снять, structurally невозможно.
   *
   * @type {Array<{ target: EventTarget, type: string, handler: EventListener }>}
   */
  #globalHandlers = [];

  /** @type {boolean} */
  #destroyed = false;

  /**
   * Единственный обработчик активации: один на элемент уровня, ни одного на
   * пункте. Ссылка на стрелку неизменна, поэтому `removeEventListener` снимает
   * именно тот обработчик, который был навешан.
   *
   * @type {(event: MouseEvent) => void}
   */
  #onLevelClick = (event) => {
    if (this.#destroyed) {
      return;
    }
    // `currentTarget`, а не цель: слушатель навешен на элемент уровня, и уровень
    // известен без обхода дерева — у события, всплывшего с пункта, цель другая.
    const level = event.currentTarget;
    if (!(level instanceof HTMLElement)) {
      return;
    }
    const entry = this.#levels.get(level);
    if (entry === undefined) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const element = target.closest(ITEM_SELECTOR);
    if (element === null) {
      return;
    }
    const rendered = entry.items.find((item) => {
      return item.element === element;
    });
    // Ключ есть у пункта и отсутствует у разделителя, а `focusable: false` — у
    // разделителя и у отключённого пункта. Фильтр доступности стоит раньше
    // проверки подменю: отключённый пункт владельцем не является вовсе, но и
    // активироваться он не может, и обе двери ведут через этот один фильтр.
    if (rendered === undefined || rendered.key === null || !rendered.focusable) {
      return;
    }
    // Владелец непустого подменю по клику открывает подменю, а своё действие не
    // зовёт — так же, как это делает `Enter`, и так же, как в родных меню. Решение
    // ревью Task 9, а не вывод из разметки: `hasSubmenu` у рендерера означает «есть
    // подменю», и наличие собственного действия этому не противоречит.
    if (rendered.hasSubmenu) {
      // Открытие подменю — тот же путь, что и по наведению: одно тело, один
      // `ensureLevel` и одно место, где показанный уровень отдаётся движку.
      this.#showSubmenuFor(rendered);
      return;
    }
    const item = this.#actions.get(rendered.key);
    if (item === undefined) {
      return;
    }
    if (item.action === undefined) {
      return;
    }
    try {
      item.action(event);
    } finally {
      // Закрытие обязано быть в `finally`, а не после вызова: обработчик, бросивший
      // исключение, иначе оставил бы меню висеть. Само исключение наружу не уходит
      // пойманным — его получает вызывающий, как и любую другую ошибку его
      // обработчика. Действие, уничтожившее экземпляр, уже снесло меню, и `close()`
      // после `destroy()` бросил бы ошибку поверх результата действия.
      if (!this.#destroyed) {
        this.close();
      }
    }
  };

  /**
   * @type {(event: KeyboardEvent) => void}
   */
  #onLevelKeydown = (event) => {
    if (this.#destroyed || event.defaultPrevented) {
      return;
    }
    this.#keyboard.handleKeydown(event);
  };

  /**
   * Движение курсора по дереву меню — только не по пункту-владельцу. По
   * пункту-владельцу движение ничего не решает: там `entryPoint` ещё пуст, и
   * `hoverIntent` запланировал бы закрытие подменю, которое вот-вот откроется или
   * уже открыто, — мигание на месте. Позиция курсора при этом нужна: её читает
   * `itemLeave` и делает якорем выхода для safe-triangle.
   *
   * @type {(event: PointerEvent) => void}
   */
  #onLevelPointerMove = (event) => {
    if (this.#destroyed) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const item = target.closest(ITEM_SELECTOR);
    if (item !== null && this.#showTargets.has(item)) {
      return;
    }
    this.#hover.pointerMove({ x: event.clientX, y: event.clientY });
  };

  /**
   * Вход в показанное подменю: точка становится якорем входа, а запланированное
   * закрытие снимается. Именно этот шаг держит подменю открытым на диагональном
   * движении к нему.
   *
   * @type {(event: PointerEvent) => void}
   */
  #onSubmenuEnter = (event) => {
    if (this.#destroyed) {
      return;
    }
    this.#hover.submenuEnter({ x: event.clientX, y: event.clientY });
  };

  /**
   * @type {(event: PointerEvent) => void}
   */
  #onItemEnter = (event) => {
    if (this.#destroyed) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const rendered = this.#showTargets.get(target);
    if (rendered === undefined) {
      return;
    }
    this.#hoverOwner = rendered;
    this.#hover.itemEnter();
  };

  /**
   * @type {(event: PointerEvent) => void}
   */
  #onItemLeave = (event) => {
    if (this.#destroyed) {
      return;
    }
    // Позиция курсора на пункте передаётся `hoverIntent` перед самым уходом: она
    // становится якорем выхода, и без неё клин строился бы от точки предыдущего
    // пункта.
    this.#hover.pointerMove({ x: event.clientX, y: event.clientY });
    this.#hover.itemLeave();
  };

  /**
   * @type {(event: PointerEvent) => void}
   */
  #onItemDown = (event) => {
    if (this.#destroyed) {
      return;
    }
    // Только основная кнопка. Правый клик подтверждается `contextmenu`, который
    // зовёт `open()` и переносит меню: подменю, открытое нажатием, мигнуло бы
    // ровно на один такт — а против чего safe-triangle и строится. Средняя кнопка
    // не открывает ничего и по существу.
    if (event.button !== PRIMARY_MOUSE_BUTTON) {
      return;
    }
    // Удержание кнопки открывает подменю немедленно, минуя `openDelayMs`. Само
    // событие не разбирается: `itemPress` молчит, если открытие не планировалось,
    // и уже открытое подменю повторно не открывает.
    this.#hover.itemPress();
  };

  /**
   * @type {(event: MouseEvent) => void}
   */
  #onContextMenu = (event) => {
    if (this.#destroyed) {
      return;
    }
    event.preventDefault();
    this.open({ x: event.clientX, y: event.clientY });
  };

  /**
   * Движение курсора в пустоте страницы. Внутри дерева движение разбирает
   * `#onLevelPointerMove` — и намеренно не там, где стоит пункт-владелец, потому
   * что по владельцу решать нечего. Этот обработчик берёт только то, чего уровни
   * не видят: точку вне меню. Без него подменю переживало бы уход курсора на пустое
   * место страницы, потому что планировать закрытие больше было некому.
   *
   * Над привязанным контейнером обработчик молчит по той же причине, по какой
   * контейнер не входит в дерево: он и есть опора меню, и сносить каскад за то,
   * что курсор вернулся на кнопку, от которой он и вырос, — неверно. Подменю при
   * этом закроется как обычно: точка мимо клина, а `onClose` закроет один уровень.
   *
   * @type {(event: PointerEvent) => void}
   */
  #onGlobalPointerMove = (event) => {
    if (this.#destroyed) {
      return;
    }
    const target = event.target;
    if (this.#isInsideTreeOrAnchor(target)) {
      return;
    }
    this.#pointerOutsideTree = true;
    this.#hover.pointerMove({ x: event.clientX, y: event.clientY });
  };

  /**
   * Клик вне дерева. Контейнер исключён: правый клик по нему должен переоткрыть
   * меню в новой точке, а не сперва снести его.
   *
   * @type {(event: PointerEvent) => void}
   */
  #onGlobalPointerDown = (event) => {
    if (this.#destroyed || event.button !== PRIMARY_MOUSE_BUTTON) {
      return;
    }
    if (this.#isInsideTreeOrAnchor(event.target)) {
      return;
    }
    this.#closeMenu({ returnFocus: false });
  };

  /**
   * Правый клик. Внутри меню системное меню подавляется, вне — нет: библиотека не
   * перехватывает правый клик на чужой странице, и системное меню здесь правильный
   * ответ. Порядок браузер отдаёт `pointerdown` раньше `contextmenu`, так что
   * правый клик снаружи закрывает меню уже первым событием, а второе лишь
   * подтверждает, что подавлять нечего.
   *
   * @type {(event: MouseEvent) => void}
   */
  #onGlobalContextMenu = (event) => {
    if (this.#destroyed) {
      return;
    }
    const target = event.target;
    if (this.#isInsideMenu(target)) {
      event.preventDefault();
      return;
    }
    if (this.#isInsideAnchor(target)) {
      return;
    }
    this.#closeMenu({ returnFocus: false });
  };

  /**
   * `Escape` вне дерева. Внутри дерева клавишу разбирает движок на самом уровне,
   * и второй разбор означал бы двойное закрытие: `#closeCurrentLevel` закрывает
   * один уровень, а здесь закрылась бы цепочка — мимо `Escape` внутри меню, где
   * пользователь имеет право закрыть один уровень и остаться в остальных.
   *
   * @type {(event: KeyboardEvent) => void}
   */
  #onGlobalKeydown = (event) => {
    if (this.#destroyed || event.key !== 'Escape' || event.defaultPrevented) {
      return;
    }
    if (this.#isInsideTreeOrAnchor(event.target)) {
      return;
    }
    this.#closeMenu({ returnFocus: false });
  };

  /**
   * Скролл и `resize` закрывают меню: показано оно было для старой геометрии.
   *
   * `scroll` ловится на `window` в capture-фазе, потому что `scroll` не всплывает
   * и на элементе сбрасывает событие до цели, — а нужно узнать, что оно пришло из
   *нутри меню: прокрутка длинного списка не должна его сносить. Признак внутренней
   * прокрутки — цель не `document` и не `body`.
   *
   * @type {(event: Event) => void}
   */
  #onGlobalScroll = (event) => {
    if (this.#destroyed) {
      return;
    }
    const target = event.target;
    if (target !== document && target !== document.body) {
      return;
    }
    this.#closeMenu({ returnFocus: false });
  };

  /**
   * @type {() => void}
   */
  #onGlobalResize = () => {
    if (this.#destroyed) {
      return;
    }
    this.#closeMenu({ returnFocus: false });
  };

  /**
   * @param {EventTarget | null} target
   * @returns {boolean} цель внутри элемента любого уровня меню.
   */
  #isInsideMenu(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    const level = target.closest(MENU_SELECTOR);
    return level instanceof HTMLElement && this.#levels.has(level);
  }

  /**
   * @param {EventTarget | null} target
   * @returns {boolean} цель внутри привязанного контейнера.
   */
  #isInsideAnchor(target) {
    const anchor = this.#attachedTo;
    return anchor !== null && target instanceof Node && anchor.contains(target);
  }

  /**
   * @param {EventTarget | null} target
   * @returns {boolean} цель в дереве меню либо на его опоре.
   */
  #isInsideTreeOrAnchor(target) {
    return this.#isInsideMenu(target) || this.#isInsideAnchor(target);
  }

  /**
   * Создаёт меню. Слушателей на страницу не вешает: `attach` делает это отдельно,
   * и до него экземпляр пригоден для программного `open()`.
   *
   * Дерево пунктов читается лениво, при первом показе уровня, и хранится по
   * ссылке: копия конфигурации обошлась бы в обход объектов-действий, а автор,
   * сменивший набор пунктов до первого открытия, получит именно его.
   *
   * @param {Array<MenuItem | SeparatorItem>} items пункты меню. Пустой массив и
   *   негодный пункт отклоняются здесь же, до появления экземпляра.
   * @param {MyContextOptions} [options] тема, анимация и доступное имя.
   * @throws {TypeError} если конфигурация негодна; путь до поля — в сообщении.
   */
  constructor(items, options = {}) {
    this.#validate(items);
    this.#items = items;
    this.#options = {
      theme: options.theme ?? 'auto',
      animationDuration: options.animationDuration ?? DEFAULT_ANIMATION_DURATION,
      label: options.label ?? DEFAULT_MENU_LABEL,
    };
    this.#actions = new Map();
    this.#levels = new Map();
    this.#showTargets = new Map();
    this.#chain = [];
    this.#hoverOwner = null;
    this.#layer = createLayer({
      label: this.#options.label,
      theme: this.#options.theme,
      animationDuration: this.#options.animationDuration,
      actions: this.#actions,
    });
    // `hoverIntent` решает, когда показывать и когда скрывать, и решает это
    // колбэками, а не опросом `isOpenPending`: опрос превратил бы модуль в
    // источник тиков, и решение о показе принималось бы в другое мгновение, чем
    // его вынес `hoverIntent`. Предмет показа — уже наш, `#hoverOwner` кладёт его
    // наведение, а показывать и скрывать — тела ниже.
    this.#hover = createHoverIntent({
      onOpen: () => {
        const owner = this.#hoverOwner;
        if (owner !== null) {
          this.#showSubmenuFor(owner);
        }
      },
      onClose: () => {
        // Область закрытия решает оркестратор, а не `hoverIntent`: геометрия клина
        // одинаково говорит «курсор ушёл» и в том случае, когда ушло лишь подменю,
        // и в том, когда ушло дерево целиком. Различие — в цели последнего
        // `pointermove`, и её читает `#pointerOutsideTree`.
        if (this.#pointerOutsideTree) {
          this.#closeMenu({ returnFocus: false });
          return;
        }
        const deepest = this.#deepestChainEntry();
        if (deepest !== null && deepest.ownerItem !== null) {
          this.#hideSubmenuFor(deepest.ownerItem);
        }
      },
    });
    this.#keyboard = createKeyboard(this.#keyboardHost());
  }

  /**
   * Навешивает слушатель `contextmenu` на контейнер.
   *
   * Повторный вызов переносит привязку: предыдущий контейнер молча освобождается,
   * иначе у экземпляра было бы два контейнера, а меню открывалось бы с двух сторон.
   *
   * @param {HTMLElement} element контейнер.
   * @returns {void}
   * @throws {Error} если экземпляр уничтожен или браузер не умеет Popover API.
   */
  attach(element) {
    this.#assertAlive();
    assertPopoverSupport();
    this.#unbind();
    this.#attachedTo = element;
    element.addEventListener('contextmenu', this.#onContextMenu);
    this.#bindGlobalHandlers();
  }

  /**
   * Снимает слушатель `contextmenu`, ничего не разрушая: экземпляр остаётся
   * пригодным для `open()`. Вызов без привязки — не операция.
   *
   * @returns {void}
   * @throws {Error} если экземпляр уничтожен.
   */
  detach() {
    this.#assertAlive();
    this.#unbind();
  }

  /**
   * Открывает корневой уровень в точке вызова. Идемпотентен: повторный вызов на
   * открытом меню переносит его в новую точку, не пересоздавая ни уровень, ни его
   * пункты.
   *
   * @param {Point} params точка вызова в координатах вьюпорта, px.
   * @returns {void}
   * @throws {Error} если экземпляр уничтожен.
   */
  open(params) {
    this.#assertAlive();
    // Владельцем фокуса становится контейнер, а не вызвавший код: без привязки
    // возвращать фокус некуда, и `close()` обязан пережить это молча.
    this.#focusOwner = this.#attachedTo;
    // Подменю прежней постановки привязаны к прямоугольникам своих
    // пунктов-владельцев, а меню уезжает в новую точку, поэтому они скрываются —
    // от глубоких к корню. Корень по индексу `0` остаётся: его переносит
    // `showRoot`, и он же встаёт в новую цепочку.
    for (let position = this.#chain.length - 1; position > CHAIN_ROOT_INDEX; position -= 1) {
      this.#layer.hide(this.#chain[position]);
    }
    this.#chain.length = 0;
    // Отложенные задачи и якоря относятся к прежней постановке меню: точки
    // safe-triangle — это точки страницы, которых на новом месте нет. `close()`
    // снимает их по той же причине, и `open()` не должен быть мягче: ушедшее
    // закрытие снесло бы подменю, открытое уже на новом месте, а ушедшее
    // открытие сорвало бы отсчёт задержки, начатый до переноса.
    this.#hover.cancelAll();
    this.#hoverOwner = null;
    this.#pointerOutsideTree = false;
    const root = this.#ensureLevel(this.#items, null, 0, null);
    this.#root = root;
    this.#chain.push(root);
    this.#leadAhead(root);
    this.#layer.showRoot(root, params);
    // На каждый показ, а не на первый: после `close()` реестр движка пуст, и без
    // этого вызова меню было бы открытым и мёртвым для клавиатуры.
    this.#keyboard.focusFirst(root);
  }

  /**
   * Закрывает всю цепочку уровней от глубоких к корню, снимает отметки роуминга и
   * отменяет отложенные открытия, после чего возвращает фокус элементу-владельцу.
   *
   * Повторяем: `#focusOwner` при возврате не сбрасывается, а движок на корневом
   * уровне зовёт `focusOwner` сам, сразу после `closeAll()`.
   *
   * @returns {void}
   * @throws {Error} если экземпляр уничтожен.
   */
  close() {
    this.#assertAlive();
    this.#closeMenu({ returnFocus: true });
  }

  /**
   * Закрытие без возврата фокуса — путь внешних событий: клик по странице, скролл,
   * `resize`, уход курсора в пустоту. Фокус здесь не наш: он либо остался там, где
   * пользователь его оставил, либо уйдёт по своему пути в браузере, и наш возврат
   * был бы невежливостью — он перехватывал бы фокус при каждом клике по странице.
   * Публичный `close()` и есть этот же путь с `returnFocus: true`, так что
   * контракт Task 9 не меняется, а появляется ровно один новый внутренний.
   *
   * @param {{ returnFocus: boolean }} options вернуть ли фокус привязанному контейнеру.
   * @returns {void}
   */
  #closeMenu({ returnFocus }) {
    this.#hover.cancelAll();
    this.#layer.hideAll();
    this.#chain.length = 0;
    this.#hoverOwner = null;
    this.#pointerOutsideTree = false;
    this.#keyboard.reset();
    if (returnFocus) {
      this.#returnFocus();
    }
  }

  /**
   * Снимает слушатель с контейнера, снимает висящие задачи, удаляет все уровни из
   * DOM, очищает карту действий и приватные ссылки. Идемпотентен, в отличие от
   * остальных методов: повторный вызов при размонтировании — обычное дело, и ошибка
   * в нём была бы ошибкой вызывающего кода.
   *
   * @returns {void}
   */
  destroy() {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#unbind();
    this.#hover.cancelAll();
    this.#keyboard.reset();
    this.#layer.destroy();
    // Карта целиком: она принадлежит экземпляру, а не уровню, и рендерер не знает,
    // когда уровень перестал существовать. Частичная очистка оставила бы записи
    // уровней, снесённых перестроением, и уровней, никогда не показанных.
    this.#actions.clear();
    this.#levels.clear();
    this.#showTargets.clear();
    this.#chain.length = 0;
    this.#hoverOwner = null;
    this.#root = null;
    this.#focusOwner = null;
  }

  /**
   * Хост движка клавиатуры: четыре действия, которые движок умеет просить, и ни
   * одного, чего он не умеет. Замыкания на приватные методы, а не ссылка на сам
   * экземпляр: движок получает ровно четыре функции и не может обойти жизненный цикл.
   *
   * @returns {KeyboardHost}
   */
  #keyboardHost() {
    return {
      closeAll: () => {
        this.close();
      },
      openSubmenu: (entry) => {
        this.#openSubmenu(entry);
      },
      closeCurrentLevel: () => {
        this.#closeCurrentLevel();
      },
      focusOwner: () => {
        this.#returnFocus();
      },
    };
  }

  /**
   * Показывает уровень-подменю и заводит шаг вперёд из него.
   *
   * Здесь, а не в вызывающем коде, решаются три вещи сразу, и все три обязательны
   * для любого пути показа — наведение, нажатие, клик и клавиатура:
   *
   * 1. **Усечение цепочки.** Подменю открывается на месте того, ради чего
   *    нажали, а всё, что открыто глубже, уходит: иначе «Экспорт → PDF» осталось
   *    бы висеть поверх подменю «Скачать». Порядок — от глубоких к корню.
   * 2. **Завод уровня движку.** `focusFirst` — единственная регистрация уровня в
   *    движке, и она же переносит фокус в показанный подменю. Движок берёт уровни
   *    из своего реестра, а не из DOM, поэтому показанный уровень, которому не
   *    звали `focusFirst`, не отвечает на клавиши вовсе: подменю, открытое мышью,
   *    было бы видимо и мёртво. Это же снимает вопрос, переносить ли фокус при
   *    показе мышью: не переносить — значит показать уровень вне реестра.
   * 3. **Запись в цепочку.** Идентичность уровня задаёт пара «родитель,
   *    владелец», поэтому повторный показ того же подменю после усечения
   *    переиспользует и уровень, и его `id`.
   *
   * @param {LevelEntry} entry уровень-подменю.
   * @returns {void}
   */
  #openSubmenu(entry) {
    if (this.#destroyed) {
      return;
    }
    const parent = entry.parent;
    if (parent !== null) {
      this.#truncateChain(parent);
    }
    this.#layer.showSubmenu(entry);
    this.#leadAhead(entry);
    this.#chain.push(entry);
    this.#keyboard.focusFirst(entry);
  }

  /**
   * Показывает подменю пункта-владельца: находит уровень, из которого владелец
   * открыт, и передаёт показ `#openSubmenu`.
   *
   * Уровень ищется по узлу владельца, а не берётся из аргумента: единственный
   * вызов этого тела — колбэк `onOpen` плюс обработчик активации, и у первого
   * под рукой нет ничего, кроме самого пункта.
   *
   * @param {RenderedItem} rendered пункт-владелец, каким его назвал рендерер.
   * @returns {void}
   */
  #showSubmenuFor(rendered) {
    if (this.#destroyed) {
      return;
    }
    // Правило владельца повторяется здесь намеренно. Вызывающие фильтруют
    // доступность по своей нужде — подпиской на показ и активацией пункта, — но
    // путь показа, оставленный без собственной проверки, откроет подменю
    // отключённого пункта, как только у него появится хоть один новый вызывающий.
    if (!rendered.hasSubmenu || !rendered.focusable) {
      return;
    }
    const level = rendered.element.closest(MENU_SELECTOR);
    if (level === null) {
      return;
    }
    const parent = this.#levels.get(/** @type {HTMLElement} */ (level));
    if (parent === undefined || rendered.key === null) {
      return;
    }
    const item = this.#actions.get(rendered.key);
    if (item === undefined || item.submenu === undefined) {
      return;
    }
    this.#openSubmenu(this.#ensureSubmenuLevel(item.submenu, parent, rendered));
  }

  /**
   * Скрывает подменю пункта-владельца и всё, что открыто из него глубже.
   *
   * Порядок — от глубоких к самому уровню: потомок уходит раньше предка всегда,
   * иначе закрывающийся уровень оставил бы глубокий висеть поверх пустоты.
   * Сама цепочка укорачивается, и следующее усечение отсчитается уже от неё.
   *
   * @param {RenderedItem} rendered пункт-владелец скрываемого подменю.
   * @returns {void}
   */
  #hideSubmenuFor(rendered) {
    const index = this.#chain.findIndex((entry) => {
      return entry.ownerItem === rendered;
    });
    if (index < CHAIN_ROOT_INDEX) {
      return;
    }
    for (let position = this.#chain.length - 1; position >= index; position -= 1) {
      this.#layer.hide(this.#chain[position]);
    }
    this.#chain.length = index;
  }

  /**
   * Обрезает цепочку до указанного уровня включительно: всё глубже него
   * скрывается и исчезает из цепочки. Сам уровень остаётся открытым, и именно
   * поэтому открытие его подменю не уносит родителя.
   *
   * @param {LevelEntry} levelEntry уровень, глубже которого обрезать.
   * @returns {void}
   */
  #truncateChain(levelEntry) {
    const index = this.#chain.indexOf(levelEntry);
    if (index < CHAIN_ROOT_INDEX) {
      return;
    }
    for (let position = this.#chain.length - 1; position > index; position -= 1) {
      this.#layer.hide(this.#chain[position]);
    }
    this.#chain.length = index + 1;
  }

  /**
   * Самый глубокий открытый уровень цепочки либо `null`, когда цепочка пуста.
   *
   * @returns {LevelEntry | null}
   */
  #deepestChainEntry() {
    if (this.#chain.length === 0) {
      return null;
    }
    return this.#chain[this.#chain.length - 1];
  }

  /**
   * Закрывает тот уровень, где стоит фокус. Уровень берётся из цели события, а не
   * из переменки «текущий»: подменю может быть открыто, а фокус стоять в родителе.
   *
   * Закрытый уровень уходит и из цепочки: она — источник правды о том, что
   * показано, а `Escape` и `ArrowLeft` закрывают уровень в обход `#hideSubmenuFor`.
   * Оставшаяся запись сорвала бы следующую операцию по цепочке: усечение и уход
   * курсора спрятали бы уже скрытый уровень вместо показанного, то есть унесли бы
   * не то. Уровня вне цепочки скрывать нечем, и укорачивать там нечего.
   *
   * Усечение при этом отбрасывает и всё более глубокое, хотя скрывается только
   * сам уровень. Держатся два свойства: скрываемый уровень всегда глубже
   * закрываемого, и фокус никогда не стоит в уровне выше показанного глубже него.
   * Сегодня оба выполняются на каждом пути показа и закрытия, поэтому зависимость
   * латентна — но именно она делает отбрасывание безопасным, и её нужно знать,
   * прежде чем добавлять новый путь закрытия.
   *
   * @returns {void}
   */
  #closeCurrentLevel() {
    const active = document.activeElement;
    if (active === null) {
      return;
    }
    const level = active.closest(MENU_SELECTOR);
    if (level === null) {
      return;
    }
    const entry = this.#levels.get(/** @type {HTMLElement} */ (level));
    if (entry === undefined) {
      return;
    }
    this.#layer.hide(entry);
    const index = this.#chain.indexOf(entry);
    if (index >= CHAIN_ROOT_INDEX) {
      this.#chain.length = index;
    }
  }

  /**
   * Возвращает фокус элементу, вызвавшему меню. Без привязки или после `destroy()`
   * возвращать некуда, и оба случая молчат: фокус остаётся там, где он уже есть.
   *
   * @returns {void}
   */
  #returnFocus() {
    const owner = this.#focusOwner;
    if (owner === null) {
      return;
    }
    // `preventScroll` по той же причине, что и у движка: меню `position: fixed`, и
    // возврат фокуса с прокруткой дёрнул бы страницу в тот момент, когда
    // пользователь её уже отпустил.
    owner.focus({ preventScroll: true });
  }

  /**
   * Заводит уровень в слое и навешивает на его элемент обработчики уровня. Повторный
   * вызов с той же парой «родитель, владелец» возвращает тот же уровень и не
   * добавляет второй обработчик.
   *
   * @param {Array<MenuItem | SeparatorItem>} items пункты уровня.
   * @param {LevelEntry | null} parent уровень, из которого открывается этот; `null`
   *   у корня.
   * @param {number} levelIndex глубина уровня, начиная с 0; идёт в `aria-level`.
   * @param {RenderedItem | null} ownerItem пункт-владелец; `null` у корня.
   * @returns {LevelEntry}
   */
  #ensureLevel(items, parent, levelIndex, ownerItem) {
    const entry = this.#layer.ensureLevel(items, parent, levelIndex, ownerItem);
    if (this.#levels.has(entry.element)) {
      return entry;
    }
    this.#levels.set(entry.element, entry);
    entry.element.addEventListener('click', this.#onLevelClick);
    entry.element.addEventListener('keydown', this.#onLevelKeydown);
    entry.element.addEventListener('pointermove', this.#onLevelPointerMove);
    // Якорь входа safe-triangle ставит только вход в подменю: у корня нет
    // владельца, и вход в него не означает, что курсор идёт к подменю.
    if (parent !== null) {
      entry.element.addEventListener('pointerenter', this.#onSubmenuEnter);
    }
    return entry;
  }

  /**
   * Заводит уровни подменю на шаг вперёд — ровно для тех пунктов уровня, которые
   * рендерер назвал владельцами и которые роуминг может сделать активными. На тех
   * же пунктах вешается показ по наведению и по нажатию: подписка на показ и
   * заведение уровня решаются одним проходом по одному условию, иначе они
   * разошлись бы — либо у пункта появился бы шеврон, а подменю не открылось бы
   * никогда, либо наоборот.
   *
   * Пункты берутся из карты действий по внутреннему ключу, а не из массива
   * конфигурации: у уровня есть только `RenderedItem`, и подменя у него нет.
   *
   * @param {LevelEntry} entry показываемый уровень.
   * @returns {void}
   */
  #leadAhead(entry) {
    for (const rendered of entry.items) {
      if (!rendered.hasSubmenu || !rendered.focusable || rendered.key === null) {
        continue;
      }
      const item = this.#actions.get(rendered.key);
      // `hasSubmenu` рендерер ставит только непустому подменю доступного пункта, а
      // `submenu` у пункта обязано быть массивом — валидация прошла в
      // конструкторе. Проверка оставлена потому, что карта действий принадлежит
      // экземпляру, а лишнее условие стоит одного сравнения с `undefined` на
      // каждом владельце.
      if (item === undefined || item.submenu === undefined) {
        continue;
      }
      // `addEventListener` не дублирует слушатель с той же ссылкой на том же
      // узле, а показ уровня зовёт этот проход на каждом показе, — повторных
      // подписок не будет.
      this.#showTargets.set(rendered.element, rendered);
      rendered.element.addEventListener('pointerenter', this.#onItemEnter);
      rendered.element.addEventListener('pointerleave', this.#onItemLeave);
      rendered.element.addEventListener('pointerdown', this.#onItemDown);
      this.#ensureSubmenuLevel(item.submenu, entry, rendered);
    }
  }

  /**
   * Заводит уровень-подменю пункта-владельца.
   *
   * Кортеж «пункты, родитель, глубина, владелец» собирается здесь, а не в двух
   * местах: им задаётся идентичность уровня, и ошибка в глубине в одном из них
   * не была бы видна нигде — уровень завелся бы, `aria-level` в нём оказался бы
   * не тем, и разошлись бы только `aria-level` и цепочка.
   *
   * @param {Array<MenuItem | SeparatorItem>} items пункты подменю; непустота и
   *   доступность владельца проверены вызывающим.
   * @param {LevelEntry} parent уровень, из которого подменю открывается.
   * @param {RenderedItem} ownerItem пункт-владелец подменю.
   * @returns {LevelEntry} уровень подменю; тот же самый при повторном заведении.
   */
  #ensureSubmenuLevel(items, parent, ownerItem) {
    return this.#ensureLevel(items, parent, this.#levelIndexOf(parent) + 1, ownerItem);
  }

  /**
   * Глубина уровня. Слой держит её только в `aria-level` уже отрендеренного уровня и
   * наружу не отдаёт, а `levelIndex` нужен и при заведении подменю — считать его
   * приходится здесь.
   *
   * @param {LevelEntry} entry уровень любой глубины.
   * @returns {number} `0` у корня.
   */
  #levelIndexOf(entry) {
    let levelIndex = 0;
    /** @type {LevelEntry | null} */
    let current = entry.parent;
    while (current !== null) {
      levelIndex += 1;
      current = current.parent;
    }
    return levelIndex;
  }

  /**
   * Снимает слушатель `contextmenu` с текущего контейнера. Зовется из `detach`,
   * повторного `attach` и `destroy` — во всех трёх случаях привязка должна исчезнуть
   * ровно один раз и без следа.
   *
   * @returns {void}
   */
  #unbind() {
    this.#unbindGlobalHandlers();
    const target = this.#attachedTo;
    if (target === null) {
      return;
    }
    target.removeEventListener('contextmenu', this.#onContextMenu);
    this.#attachedTo = null;
  }

  /**
   * Навешивает глобальные слушатели. Capture-фаза у документа и окна выбрана одна:
   * событие разбирается раньше любого обработчика страницы, поэтому меню успевает
   * среагировать до того, как авторский код что-то предотвратит. Для `keydown`
   * это ещё и единственный способ закрыть меню, когда фокус ушёл из дерева.
   *
   * Слушатели заводятся на `attach`, а не в конструкторе: до привязки экземпляр
   * пригоден для программного `open()` и страницу трогать не должен.
   *
   * @returns {void}
   */
  #bindGlobalHandlers() {
    /** @type {Array<{ target: EventTarget, type: string, handler: EventListener }>} */
    const handlers = [
      { target: document, type: 'pointermove', handler: asListener(this.#onGlobalPointerMove) },
      { target: document, type: 'pointerdown', handler: asListener(this.#onGlobalPointerDown) },
      { target: document, type: 'contextmenu', handler: asListener(this.#onGlobalContextMenu) },
      { target: document, type: 'keydown', handler: asListener(this.#onGlobalKeydown) },
      { target: window, type: 'scroll', handler: asListener(this.#onGlobalScroll) },
      { target: window, type: 'resize', handler: asListener(this.#onGlobalResize) },
    ];
    for (const entry of handlers) {
      entry.target.addEventListener(entry.type, entry.handler, true);
    }
    this.#globalHandlers = handlers;
  }

  /**
   * Снимает глобальные слушатели по тому же списку, по которому их вешали: иначе
   * снятие разошлось бы с установкой поимённо, и `destroy()` оставил бы на
   * документе живые обработчики закрытого экземпляра.
   *
   * @returns {void}
   */
  #unbindGlobalHandlers() {
    for (const entry of this.#globalHandlers) {
      entry.target.removeEventListener(entry.type, entry.handler, true);
    }
    this.#globalHandlers = [];
  }

  /**
   * @returns {void}
   * @throws {Error} если экземпляр уничтожен.
   */
  #assertAlive() {
    if (this.#destroyed) {
      throw new Error(DESTROYED_MESSAGE);
    }
  }

  /**
   * Рекурсивная проверка конфигурации.
   *
   * Первым же оператором конструктора: экземпляр с негодной конфигурацией появляться
   * не должен, и сообщение обязано называть путь до поля — вложенность конфигурации
   * с одного взгляда не читается.
   *
   * @param {unknown} items пункты уровня; у корня это `items`, у подменю —
   *   `items[n].submenu`.
   * @param {string} [path] путь до проверяемого набора.
   * @returns {void}
   * @throws {TypeError} на первом негодном поле.
   */
  #validate(items, path = ITEMS_PATH) {
    if (!Array.isArray(items)) {
      throw new TypeError(`${path}: пункты меню должны быть массивом`);
    }
    // Пустой корень — ошибка: меню без пунктов не рисуется, и автор узнал бы об
    // этом только кликом. Пустое подменю — не ошибка, см. `#validateItem`.
    if (items.length === 0) {
      throw new TypeError(`${path}: меню без пунктов не рисуется`);
    }
    items.forEach((item, index) => {
      this.#validateItem(item, `${path}[${index}]`);
    });
  }

  /**
   * @param {unknown} item проверяемый пункт или разделитель.
   * @param {string} path путь до пункта.
   * @returns {void}
   * @throws {TypeError} на первом негодном поле.
   */
  #validateItem(item, path) {
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
    if (typeof item.label !== 'string' || item.label.trim() === '') {
      throw new TypeError(`${path}.label: пункт обязан иметь непустую подпись`);
    }
    validateIcon(item.icon, `${path}.icon`);
    if (item.action !== undefined && typeof item.action !== 'function') {
      throw new TypeError(`${path}.action: обработчик пункта должен быть функцией`);
    }
    const submenu = item.submenu;
    if (submenu === undefined) {
      return;
    }
    if (!Array.isArray(submenu)) {
      throw new TypeError(`${path}.submenu: подменю должно быть массивом`);
    }
    // Пустое подменю — не подменю, но и не ошибка конфигурации: владельцем его
    // делает рендерер по непустоте массива, и обходить нечего. Проверка непустоты
    // здесь была бы вторым мнением об одном и том же решении.
    if (submenu.length > 0) {
      this.#validate(submenu, `${path}.submenu`);
    }
  }
}
