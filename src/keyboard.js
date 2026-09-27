/**
 * Роуминг-фокус и разбор клавиш меню.
 *
 * Модуль владеет двумя вещами, которых не касается никто другой: `tabindex` и
 * `data-active` у пунктов. Рендерер сеет `tabindex="-1"` всем пунктам и не ставит
 * `data-active` вовсе, слой не трогает оба атрибута, — и это не раздел по случаю:
 * второй владелец развёл бы состояние по двум писателям, и «какой пункт
 * активен» перестало бы быть вопросом с одним ответом.
 *
 * **Подсветку ведёт `data-active`, а не `:focus`.** Открытие подменю мышью не
 * вызывает `:focus-visible`, и подсветка по нему мигала бы; `styles/mycontext.css`
 * красит именно `[data-active]`. Активным пунктом уровня считается поэтому носитель
 * атрибута, а не узел, которому событие случайно досталось.
 *
 * **Уровень берётся из цели события.** `handleKeydown` идёт от
 * `event.target.closest('.vc-menu')`, а не от переменки «текущий уровень»:
 * подменю может быть открыто, а фокус стоять в родительском уровне, и тогда
 * движение обязано произойти там, где стоит фокус, — иначе стрелка вниз уводила
 * бы в подменю, которое пользователь мышью уже закрыл.
 *
 * **Круг доводит до конца.** Уровень известен движку только после `focusFirst`:
 * вызывающий код отдаёт его тем же вызовом, которым передаёт фокус первому
 * пункту после показа. Уровень, который движку не отдали, на клавиши не отвечает
 * вовсе — ни тихо, ни с ошибкой, потому что событие не его.
 *
 * **Подменю находится по паре «родитель, владелец»**, а не через `aria-owns` и не
 * через поиск по документу: это тот же поиск, которым слой находит уже заведённый
 * уровень, и он устойчив к перестроению разметки. Отсюда требование к вызывающему
 * коду: уровень-подменю должен быть заведён заранее, иначе `ArrowRight` не
 * откроет ничего — и сделает это молча, потому что показать нечего.
 *
 * **Владелец подменю — только владелец.** Признак один, и он достаётся из
 * `RenderedItem.hasSubmenu`, то есть из решения рендерера: `submenu: []` не
 * владелец, у него нет ни шеврона, ни `aria-owns`, ни `aria-haspopup`, и
 * `Enter`/`Space` на таком пункте активируют его, а не открывают пустое подменю.
 * Это решение принимается один раз в рендерере и обязательно переносится в задачи
 * 9 и 10, а не перерешается заново на каждом уровне стека.
 *
 * **Две передачи фокуса, и обе нужны.** Первая — `focus({ preventScroll: true })`:
 * меню `position: fixed`, и без флага браузер сдвинул бы страницу в тот самый
 * момент, когда пользователь ушёл стрелкой с последнего пункта. Вторая —
 * `scrollIntoView({ block: 'nearest' })` сразу после неё: `preventScroll` гасит
 * прокрутку всех прокручиваемых предков, `.vc-list` с его
 * `max-height: calc(100dvh - 2 * var(--vc-padding))` и `overflow-y: auto`
 * включён, — и без явной прокрутки `ArrowDown` за нижний край увёл бы
 * `data-active`, `tabindex="0"` и фокус на пункт, которого пользователь не видит:
 * меню оказывается заперто в рамке, из которой нельзя уйти, не увидев, где ты.
 * `block: 'nearest'` прокручивает ровно настолько, чтобы пункт стал виден, и не
 * дёргает список при каждом шаге. Вариант `start` прокрутил бы до упора: `End`
 * перемещает актив на 39 позиций за одно нажатие, и пункт оказывается целиком за
 * нижним краем, так что «сдвинуть на один пункт» тут не работает. `start` дал бы
 * видимость, но не минимальность, поэтому и выбран `nearest`.
 * `scrollIntoView` не идёт через `focus`, поэтому флаг `preventScroll` его не
 * касается.
 *
 * **Активация — это клик по пункту.** У движка нет карты активов: `action` лежит
 * в ней по внутреннему ключу пункта, а картой владеет экземпляр меню, и в контракт
 * `KeyboardHost` она не входит. Поэтому `Enter` и `Space` отправляют пункту
 * синтетический `click`, и активация идёт тем же путём, что и мышиная, одним
 * обработчиком и одним решением о том, что значит «пункт активирован». Коллбэк
 * получает настоящее событие с настоящей целью, а не вызов по ключу из обхода
 * дерева. Владелец подменю кликом не активируется: у него активация означает
 * открытие.
 *
 * **Обработчик активации в вызывающем коде должен быть ровно один.** Событие
 * всплывает, и движок его не гасит: `cancelable` у синтетического клика стоит
 * вовсе не ради этого. Второй обработчик клика по пункту увидит то же событие и
 * вызовет действие второй раз, поэтому делегирование должно быть одно — на
 * документе либо на самом пункте, но не оба сразу.
 *
 * **Разобранная клавиша гасится, неразобранная — нет.** `preventDefault` стоит
 * после `switch`, и ветка `default` выходит раньше: клавиша без своей ветки
 * доходит до браузера нетронутой, и `Tab` вне меню уходит со страницы как обычно.
 * `Tab` внутри меню гасится намеренно: закрытие отложено на `animationDuration`,
 * и без этого браузер повёл бы последовательную навигацию по гаснущему уровню с
 * его `tabindex="0"` вместо элемента-владельца, которому фокус только что
 * передан.
 *
 * **Закрытие возвращает фокус туда, куда можно.** На не-корневом уровне
 * `ArrowLeft` и `Escape` закрывают его и возвращают фокус на пункт-владелец; на
 * корневом обе клавиши закрывают всё меню и зовут `host.focusOwner()`. Разница
 * в цели одна, и обойти её нельзя: закрытие отложено на `animationDuration`,
 * поэтому оставленный в гаснущем уровне фокус падает на `<body>` — меню закрыто,
 * а `data-active` стоит на пункте чужого уровня. На `Tab` добавляется тот же
 * `focusOwner`, и порядок «закрыть, потом вернуть фокус» соблюдён.
 */

/**
 * @typedef {import('./layer.js').LevelEntry} LevelEntry
 * @typedef {import('./renderer.js').RenderedItem} RenderedItem
 */

/**
 * Сторона, которой движок делегирует всё, чего не умеет сам: показать и скрыть
 * уровни и вернуть фокус элементу, вызвавшему меню.
 *
 * @typedef {object} KeyboardHost
 * @property {() => void} closeAll закрывает всю цепочку уровней, от глубоких к
 *   корню. Вызывается на `Tab`, на `Escape` и `ArrowLeft` корневого уровня, а
 *   также после активации пункта. Фокус движок не возвращает: на корневом уровне
 *   он зовёт `focusOwner` сам и сразу после `closeAll()`, а после активации пункта
 *   — не зовёт, и вернуть фокус обязан вызывающий код.
 * @property {(entry: LevelEntry) => void} openSubmenu показывает уровень-подменю.
 *   Обязан быть уже заведённым: движок находит его по паре «родитель, владелец» и
 *   создавать уровни не берётся. Заводить его нужно на шаг вперёд — при активации
 *   пункта-владельца, а не в момент открытия.
 * @property {() => void} closeCurrentLevel закрывает тот уровень, где стоит
 *   фокус. Вызывается на `ArrowLeft` и `Escape` не на корне.
 * @property {() => void} focusOwner возвращает фокус элементу, вызвавшему меню.
 *   Вызывается на `Tab` и на `Escape`/`ArrowLeft` корневого уровня, то есть везде,
 *   где закрывается всё меню. Порядок обязателен: сначала `closeAll()`, потом
 *   `focusOwner()`.
 */

/**
 * @typedef {object} KeyboardController
 * @property {(event: KeyboardEvent) => void} handleKeydown разбирает клавишу по
 *   цели события. Событие вне меню и клавиша без своей ветки остаются нетронутыми.
 *   Возвращаемого значения нет и бросать нечего: у обработчика нет причины
 *   прерывать чужой обработчик.
 * @property {(entry: LevelEntry) => void} focusFirst отдаёт уровень движку и
 *   передаёт фокус первому доступному пункту.
 *
 *   **Условие, без которого уровень мёртв для клавиатуры:** вызвать её на каждый
 *   уровень, который может оказаться в фокусе, — то есть после каждого показа.
 *   Движок узнаёт уровень не из разбора каждого нажатия, а из реестра, который
 *   наполняет только этот вызов, и на уровень вне реестра `handleKeydown`
 *   не отвечает вовсе: ни действия, ни ошибки. Подменю, открытое мышью, до
 *   `ArrowRight` по этой причине с клавиатуры недоступно, и открытое меню после
 *   `reset()` — тоже, пока вызывающий код не отдаст уровень заново.
 *
 *   На уровне без доступных пунктов не делает ничего: отмечать нечего, и
 *   вызывающий код узнает об этом по отсутствию отметок, а не по исключению.
 * @property {() => void} reset снимает отметки роуминга со всех известных
 *   уровней, возвращает их `activeIndex` в `-1` и забывает их. Фокус не забирает:
 *   куда его девать, решает вызывающий код. После вызова уровень снова нужно
 *   отдать через `focusFirst`. Повторный вызов безопасен.
 */

const ITEM_SELECTOR = '.vc-item';
const MENU_SELECTOR = '.vc-menu';
const ACTIVE_ATTRIBUTE = 'data-active';
const FOCUSABLE_TAB_INDEX = 0;
const INACTIVE_TAB_INDEX = -1;
const NO_ACTIVE_ITEM = -1;

/**
 * @param {KeyboardHost} host
 * @returns {KeyboardController} движок роуминга и разбора клавиш.
 */
export function createKeyboard(host) {
  /** @type {Map<Element, LevelEntry>} уровни, которые движок знает. */
  const known = new Map();

  /**
   * Список навигации уровня: ровно те пункты, что входят в цикл. Разделитель и
   * отключённый пункт сюда не попадают — так решил рендерер, и второй фильтр
   * здесь был бы вторым мнением об одном и том же.
   *
   * @param {LevelEntry} entry
   * @returns {RenderedItem[]}
   */
  function focusableOf(entry) {
    return entry.items.filter((item) => {
      return item.focusable;
    });
  }

  /**
   * Активный пункт уровня — носитель `data-active`, а не цель события. Уровень
   * может стоять на первом пункте, пока клавиша пришла в другой: двигаться
   * надлежит от активного, иначе наведение мышью, сдвинувшее подсветку, уводило
   * бы роуминг в сторону от того, что видит пользователь.
   *
   * @param {LevelEntry} entry
   * @returns {RenderedItem | null} `null`, если активного пункта нет.
   */
  function activeItemOf(entry) {
    for (const item of entry.items) {
      if (item.element.hasAttribute(ACTIVE_ATTRIBUTE)) {
        return item;
      }
    }
    return null;
  }

  /**
   * Позиция активного пункта в списке навигации.
   *
   * @param {LevelEntry} entry
   * @returns {number} позиция или `-1`, если активного пункта нет либо он в
   *   список не входит.
   */
  function positionOf(entry) {
    const active = activeItemOf(entry);
    if (active === null) {
      return NO_ACTIVE_ITEM;
    }
    return focusableOf(entry).indexOf(active);
  }

  /**
   * Передаёт активность пункту уровня и фокус ему же. Отметка с предыдущего
   * активного снимается здесь же, иначе на уровне осталось бы два `tabindex="0"`
   * и два `data-active` сразу, а `Tab` зациклил бы меню на месте.
   *
   * @param {LevelEntry} entry
   * @param {RenderedItem} item
   * @returns {void}
   */
  function activate(entry, item) {
    const previous = activeItemOf(entry);
    if (previous !== null && previous !== item) {
      previous.element.tabIndex = INACTIVE_TAB_INDEX;
      previous.element.removeAttribute(ACTIVE_ATTRIBUTE);
    }
    item.element.tabIndex = FOCUSABLE_TAB_INDEX;
    item.element.setAttribute(ACTIVE_ATTRIBUTE, '');
    // Индекс в `entry.items`, а не в списке навигации: между доступными пунктами
    // стоят отключённые и разделители, и индексы в разных списках не совпадают.
    entry.activeIndex = entry.items.indexOf(item);
    known.set(entry.element, entry);
    // Передача фокуса и долистывание списка — две разные вещи, и `preventScroll`
    // гасит обе: он запрещает прокрутку, которую браузер сделал бы сам, а не ту,
    // которую просят. Список прокручиваемый, и без второй строки активный пункт
    // ушёл бы за его край вместе с фокусом.
    item.element.focus({ preventScroll: true });
    item.element.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Переход по кругу: позиция берётся по модулю длины списка, поэтому и
   * `End` с длиной минус один, и шаг с первого на последний, и обратный шаг с
   * нулевого работают одним правилом.
   *
   * @param {LevelEntry} entry
   * @param {number} position позиция в списке навигации, любая целая.
   * @returns {void}
   */
  function moveTo(entry, position) {
    const focusable = focusableOf(entry);
    if (focusable.length === 0) {
      return;
    }
    const length = focusable.length;
    activate(entry, focusable[((position % length) + length) % length]);
  }

  /**
   * Подменю пункта — по паре «родитель, владелец», тем же поиском, каким слой
   * находит уже заведённый уровень.
   *
   * @param {LevelEntry} entry
   * @param {RenderedItem} item
   * @returns {LevelEntry | null} `null`, если подменю не заведено.
   */
  function submenuOf(entry, item) {
    for (const child of entry.children) {
      if (child.ownerItem === item) {
        return child;
      }
    }
    return null;
  }

  /**
   * Уход с текущего уровня: закрыть его и вернуть фокус туда, откуда пришли.
   * На не-корневом уровне это пункт-владелец, на корневом — элемент, вызвавший
   * меню: оставить фокус в закрывающем уровне нельзя, закрытие отложено и фокус
   * упал бы на `<body>`.
   *
   * @param {LevelEntry} entry
   * @returns {void}
   */
  function leaveLevel(entry) {
    const parent = entry.parent;
    if (parent === null) {
      host.closeAll();
      host.focusOwner();
      return;
    }
    host.closeCurrentLevel();
    const owner = entry.ownerItem;
    // Владелец у подменю есть по построению слоя, но проверки остаются обе, и
    // вторая не формальная: `renderer.js` выставляет `hasSubmenu` независимо от
    // `disabled`, то есть отключённый пункт с непустым подменю — полноценный
    // владелец с шевроном и `aria-owns`, и слой такой уровень заведёт. Отметка
    // роуминга такому пункту не полагается, иначе `Tab` зациклил бы меню на
    // неактивном элементе.
    if (owner !== null && owner.focusable) {
      activate(parent, owner);
    }
  }

  /**
   * @param {LevelEntry} entry
   * @returns {void}
   */
  function focusFirst(entry) {
    moveTo(entry, 0);
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  function handleKeydown(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    // Пункт под целью — обязательное условие обработки, а не достаточное: клавиша
    // вне меню не должна съедаться никогда, иначе меню, закрытое вкладкой, сломало
    // бы навигацию по странице.
    if (target.closest(ITEM_SELECTOR) === null) {
      return;
    }
    const level = target.closest(MENU_SELECTOR);
    if (level === null) {
      return;
    }
    const entry = known.get(level);
    if (entry === undefined) {
      return;
    }
    const active = activeItemOf(entry);
    switch (event.key) {
      case 'ArrowDown': {
        // Случай «активного пункта нет» разбирать не нужно: у такого уровня
        // позиция равна `-1`, и `-1 + 1` — это ноль, то есть первый доступный
        // пункт. Отдельная ветка здесь была бы вторым ответом на один вопрос.
        moveTo(entry, positionOf(entry) + 1);
        break;
      }
      case 'ArrowUp': {
        const position = positionOf(entry);
        // А вот здесь отдельная ветка нужна: `-1 - 1` — это минус два элемента
        // списка, то есть предпоследний вместо последнего.
        moveTo(entry, position < 0 ? -1 : position - 1);
        break;
      }
      case 'Home': {
        moveTo(entry, 0);
        break;
      }
      case 'End': {
        moveTo(entry, focusableOf(entry).length - 1);
        break;
      }
      case 'ArrowRight': {
        if (active === null || !active.hasSubmenu) {
          break;
        }
        const submenu = submenuOf(entry, active);
        if (submenu === null) {
          break;
        }
        host.openSubmenu(submenu);
        focusFirst(submenu);
        break;
      }
      case 'ArrowLeft': {
        leaveLevel(entry);
        break;
      }
      case 'Enter':
      case ' ': {
        if (active === null) {
          break;
        }
        // Владелец подменю активируется открытием: пустое подменю открывать не
        //чего, а непустое открывается целиком. Фокус переносится туда же, куда его
        // уводит `ArrowRight`: подменю открыто и видимо, а без отметок в нём роуминга
        // нет — стрелки двигали бы родителя при открытом ребёнке, а `Enter` лишь
        // переоткрывал бы его.
        if (active.hasSubmenu) {
          const submenu = submenuOf(entry, active);
          if (submenu !== null) {
            host.openSubmenu(submenu);
            focusFirst(submenu);
          }
          break;
        }
        // Клик, а не прямой вызов коллбэка: карты активов у движка нет, а путь
        // активации должен быть один и тот же для мыши и для клавиатуры.
        active.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        host.closeAll();
        break;
      }
      case 'Escape': {
        leaveLevel(entry);
        break;
      }
      case 'Tab': {
        host.closeAll();
        host.focusOwner();
        break;
      }
      default:
        // Ветки нет — событие не наше: `preventDefault` ниже до него не доходит.
        return;
    }
    event.preventDefault();
  }

  /**
   * @returns {void}
   */
  function reset() {
    for (const entry of known.values()) {
      const active = activeItemOf(entry);
      if (active !== null) {
        active.element.tabIndex = INACTIVE_TAB_INDEX;
        active.element.removeAttribute(ACTIVE_ATTRIBUTE);
      }
      entry.activeIndex = NO_ACTIVE_ITEM;
    }
    known.clear();
  }

  return {
    handleKeydown,
    focusFirst,
    reset,
  };
}
