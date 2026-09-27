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
 * **Показанный уровень всегда отдаётся движку через `focusFirst`, а не только
 * корневой.** Движок берёт уровень из своего реестра, а не из DOM, поэтому уровень,
 * которому не звали `focusFirst`, не получает клавиш вовсе, и `close()` сбрасывает
 * реестр — значит повторный `open()` обязан отдать уровень заново. Отсюда же и
 * перенос фокуса в подменю, открытое мышью: регистрация уровня и фокус — один вызов,
 * а регистрации без фокуса у движка нет.
 *
 * **Уровень подменю заводится на шаг вперёд, но не глубже, и только для доступных
 * владельцев.** Движок ищет подменю по паре «родитель, владелец» и уровни не создаёт,
 * поэтому незаведённый уровень не открылся бы ни по `ArrowRight`, ни по клику — молча.
 * Отключённый владелец в цикл роуминга не входит и кликом не активируется, поэтому
 * уровень ему не заводится, и `aria-owns`, который рендерер на него резервирует,
 * остаётся висячим: отбирать чужой атрибут здесь нельзя, это был бы второй владелец.
 * Висячая ссылка уходит сама, когда Task 10 перестанет считать отключённого пункта
 * владельцем. Глубже шага заведение не идёт: следующий уровень появится, когда
 * покажется этот, — иначе ленивая постройка веток стала бы постройкой всего дерева
 * при первом открытии.
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

  /** @type {LevelEntry | null} */
  #root = null;

  /** @type {HTMLElement | null} */
  #attachedTo = null;

  /** @type {HTMLElement | null} */
  #focusOwner = null;

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
    // разделителя и у отключённого пункта. Отключённый пункт полноценный владелец
    // подменю по разметке, но ни активироваться, ни открывать подменю не может: обе
    // двери ведут через этот один фильтр.
    if (rendered === undefined || rendered.key === null || !rendered.focusable) {
      return;
    }
    const item = this.#actions.get(rendered.key);
    if (item === undefined) {
      return;
    }
    // Владелец непустого подменю по клику открывает подменю, а своё действие не
    // зовёт — так же, как это делает `Enter`, и так же, как в родных меню. Решение
    // ревью Task 9, а не вывод из разметки: `hasSubmenu` у рендерера означает «есть
    // подменю», и наличие собственного действия этому не противоречит.
    if (rendered.hasSubmenu) {
      if (item.submenu === undefined) {
        return;
      }
      // Показанный уровень обязан достаться движку, иначе он не получит клавиш вовсе;
      // `focusFirst` — единственная регистрация, и она же переносит фокус.
      const submenu = this.#ensureLevel(
        item.submenu,
        entry,
        this.#levelIndexOf(entry) + 1,
        rendered,
      );
      this.#openSubmenu(submenu);
      this.#keyboard.focusFirst(submenu);
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
    this.#layer = createLayer({
      label: this.#options.label,
      theme: this.#options.theme,
      animationDuration: this.#options.animationDuration,
      actions: this.#actions,
    });
    this.#hover = createHoverIntent();
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
    const root = this.#ensureLevel(this.#items, null, 0, null);
    this.#root = root;
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
    this.#hover.cancelAll();
    this.#layer.hideAll();
    this.#keyboard.reset();
    this.#returnFocus();
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
   * Показывает заранее заведённый уровень-подменю и заводит шаг вперёд из него.
   *
   * @param {LevelEntry} entry уровень-подменю.
   * @returns {void}
   */
  #openSubmenu(entry) {
    if (this.#destroyed) {
      return;
    }
    this.#layer.showSubmenu(entry);
    this.#leadAhead(entry);
  }

  /**
   * Закрывает тот уровень, где стоит фокус. Уровень берётся из цели события, а не
   * из переменки «текущий»: подменю может быть открыто, а фокус стоять в родителе.
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
    if (entry !== undefined) {
      this.#layer.hide(entry);
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
    return entry;
  }

  /**
   * Заводит уровни подменю на шаг вперёд — ровно для тех пунктов уровня, которые
   * рендерер назвал владельцами и которые роуминг может сделать активными.
   *
   * Пункты берутся из карты действий по внутреннему ключу, а не из массива
   * конфигурации: у уровня есть только `RenderedItem`, и подменя у него нет.
   *
   * @param {LevelEntry} entry показываемый уровень.
   * @returns {void}
   */
  #leadAhead(entry) {
    const childIndex = this.#levelIndexOf(entry) + 1;
    for (const rendered of entry.items) {
      if (!rendered.hasSubmenu || !rendered.focusable || rendered.key === null) {
        continue;
      }
      const item = this.#actions.get(rendered.key);
      // `hasSubmenu` рендерер ставит только непустому подменю, а `submenu` у пункта
      // обязано быть массивом — валидация прошла в конструкторе. Проверка оставлена
      // потому, что карта действий принадлежит экземпляру, а лишнее условие стоит
      // одного сравнения с `undefined` на каждом владельце.
      if (item === undefined || item.submenu === undefined) {
        continue;
      }
      this.#ensureLevel(item.submenu, entry, childIndex, rendered);
    }
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
    const target = this.#attachedTo;
    if (target === null) {
      return;
    }
    target.removeEventListener('contextmenu', this.#onContextMenu);
    this.#attachedTo = null;
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
