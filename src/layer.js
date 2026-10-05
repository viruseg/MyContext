import { DEFAULT_ANIMATION_DURATION, SAFETY_PADDING } from './constants.js';
import { calculateMenuPosition, calculateSubmenuPosition } from './positioner.js';
import { collectAnswers, refreshItems, renderLevel, submenuHashOf } from './renderer.js';
import { createScrollZones } from './scrollZones.js';
import { applyAnimationDuration, applyScale, applyTheme } from './theme.js';

/**
 * Управление Top Layer: создание уровней, показ, скрытие, замер вслепую и
 * отложенное закрытие. Модуль ничего не знает про события страницы, клавиатуру и
 * hover intent — он держит DOM, геометрию и порядок отрисовки, а решение о том,
 * когда показывать и когда скрывать, принимает вызывающий код.
 *
 * Семь ловушек платформы, из-за которых модуль устроен так, как устроен. Три из них
 * пришлось учесть сверх того, что описано в спеке. Шесть ловушек проверены кейсами в
 * `tests/e2e/layer.spec.js` целиком; у пятой, «Временный порядок внутри показа», кейсами
 * покрыты шаги с маской и координатами, а место решения о прокрутке между ними
 * обосновано доводом, а не измерением, — пока уровень ограничен `max-height`, замер до
 * решения и после него неразличим, и §6.1 спеки это признаёт.
 *
 * **Элемент с атрибутом `popover` не показан до `showPopover()`.** UA-стиль прячет
 * его, поэтому наивный замер до показа даёт `0×0`, а с нулевыми габаритами
 * позиционер выбирает не тот кандидат и кладёт меню не туда. Замер идёт вслепую:
 * инлайново `display: flex; position: fixed; left: -9999px; top: 0;
 * visibility: hidden`, затем вычисленные `width` и `height`, затем настоящие
 * координаты и `showPopover()`. Мерцания нет: на момент замера элемент невидим, а
 * вход через `@starting-style` начинается с `opacity: 0`.
 *
 * **Замер требует, чтобы элемент уже был в документе.** Отцепленный узел не имеет
 * раскладки вообще: вычисленные `width` и `height` у него пустые, а `left: -9999px`
 * без раскладки бессмысленно. Поэтому подключение к `<body>` стоит перед замером,
 * а не после него. Побочный эффект ровно тот, что нужен: перенос узла в конец
 * `<body>` поднимает его в порядке отрисовки Top Layer, который совпадает с
 * порядком в DOM. Глубоко вложенное подменю иначе оказалось бы под ранее созданным
 * соседним.
 *
 * **Габариты берутся из вычисленного стиля, а не из `getBoundingClientRect`.**
 * Пока элемент не `:popover-open`, на него действует базовое правило `.vc-menu {
 * transform: scale(0.96) }`, а `getBoundingClientRect` возвращает рамку именно
 * после преобразования — 96% настоящих габаритов. Позиционер разложил бы меню по
 * заниженному размеру: у кандидата «влева от курсора» меняется правый край, и
 * меню вышло бы за `SAFETY_PADDING`. Вычисленные `width` и `height` — Used-величины
 * раскладки, преобразование на них не смотрит. Под `prefers-reduced-motion: reduce`
 * расхождения не видно — там `transform` обнулён, — и ошибка проявилась бы только у
 * пользователей с обычным движением.
 *
 * **Маска замера не трогает `transform`, и это не случайность.** Обнуление
 * преобразования в маске выглядит тем же решением, что и замер по
 * `getComputedStyle`, но даёт обратный эффект: пока элемент замаскирован, он
 * отрисован, и `transform: none` становится его последним вычисленным стилем.
 * Браузер берёт именно это начальное значение перехода при `showPopover`, а
 * `@starting-style` не срабатывает — элемент к тому моменту «новым» не вовсе. Вход
 * `transform` пошёл бы из `none` в `scale(1)`, а это одна матрица: переход есть,
 * движения нет, и меню проявляется голым. `opacity` при этом выживает случайно —
 * базовое правило и `@starting-style` оба дают ноль, поэтому начальное значение
 * совпадает с нужным.
 *
 * **Временный порядок внутри показа жёсткий.** Раскладка → решение о прокрутке →
 * расчёт → снятие маски → запись координат → `showPopover()`. Решение о прокрутке —
 * подготовка состояния, и стоит она до замера: положение считается по тому, что
 * пользователь увидит, а не по переходному. Отличает ли эти состояния высота, сейчас
 * не видно: уровень ограничен `max-height`, разницу забирает сжимаемый список, и обе
 * высоты совпадают. Но правило «спросить про переполнение при скрытых зонах» держится
 * на этом ограничении, и порядок — единственное, что его защитит, если у уровня
 * появится иная верхняя граница роста. Маску снимают раньше записи координат, а не
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
 * анимировал.
 *
 * Отметка закрытия под `reduce` ставится, хотя анимировать ей нечего: снимает она
 * события с уровня, а не только гасит его, и это нужно при любом закрытии. Без неё
 * закрытый уровень остался бы отрисованным и принимающим события — невидимое меню,
 * глотающее клики там, где его уже нет.
 */

/**
 * @typedef {import('./renderer.js').MenuItem} MenuItem
 * @typedef {import('./renderer.js').SeparatorItem} SeparatorItem
 * @typedef {import('./renderer.js').LevelAnswer} LevelAnswer
 * @typedef {import('./renderer.js').RenderContext} RenderContext
 * @typedef {import('./renderer.js').RenderedItem} RenderedItem
 * @typedef {import('./renderer.js').RenderedLevel} RenderedLevel
 * @typedef {import('./scrollZones.js').ScrollZones} ScrollZones
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
 * @property {string} itemsHash отпечаток состава, по которому уровень построен.
 *   Заново предъявленный состав с тем же отпечатком перестраивать не заставляет,
 *   с другим — заставляет: это решение принимает `ensureLevel`, и оно одно на
 *   сборку и на каждый показ.
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
 * @property {number} [scale] множитель размеров всех уровней слоя, `1` по
 *   умолчанию. Уходит в `--vc-scale` каждого уровня при его создании, а не на
 *   корне: уровни лежат в `<body>` соседями, а не внутри друг друга, и множитель
 *   на корне до подменю не дошёл бы. Тот же дефолт, что и у публичной опции
 *   `MyContextOptions.scale`, и он назван числом здесь по той же причине, что и
 *   `animationDuration`: слой документирует величину по умолчанию и подставляет
 *   свою, а не требует от вызывающего кода лишнего значения.
 * @property {Map<string, MenuItem>} actions общая для всех уровней **одного**
 *   экземпляра, передаваемая по ссылке. Картой владеет экземпляр меню: слой отдаёт
 *   её рендереру и не копирует, а очищает её целиком `MyContext.destroy()` — в том
 *   числе ключи уровней, снесённых перестроением, и уровней, никогда не
 *   показанных. Пока экземпляр жив, карта пополняется только.
 * @property {(fn: () => void, ms: number) => unknown} [schedule] постановка задачи.
 *   По умолчанию глобальный `setTimeout`, вызванный как метод `globalThis`:
 *   отвязанная ссылка на `setTimeout` в некоторых браузерах бросает
 *   `Illegal invocation`. Возвращённый жест задачи не интерпретируется.
 * @property {(handle: unknown) => void} [cancel] снятие задачи по жесту, который
 *   вернул `schedule`. По умолчанию глобальный `clearTimeout`.
 * @property {(entries: LevelEntry[]) => void} [onLevelsDiscarded] сноса уровней
 *   целиком, вместе со всем, что слои вокруг них помнят. Слой владеет DOM и
 *   жизненным циклом уровней, а вызывающий — картами пунктов, подписок на показ и
 *   реестром движка клавиатуры; без этого сигнала они бы навсегда сохранили
 *   уровни, которых больше нет. Зовётся один раз на снос, до создания нового
 *   уровня, и передаёт всё поддерево от глубоких уровней к снесённому.
 * @property {MediaQueryList} [reducedMotionQuery] запрос
 *   `prefers-reduced-motion: reduce`. Значение `.matches` читается в момент
 *   закрытия, поэтому смена настройки движка влияет на уже созданный слой. По
 *   умолчанию — `matchMedia('(prefers-reduced-motion: reduce)')`.
 */

/**
 * Слой меню: владение DOM уровней, их геометрией и порядком отрисовки.
 *
 * @typedef {object} MenuLayer
 * @property {(items: Array<MenuItem | SeparatorItem>, parent: LevelEntry | null, levelIndex: number, ownerItem: RenderedItem | null) => Promise<LevelEntry>} ensureLevel
 *   Возвращает уровень для этого состава, создавая его при первом обращении.
 *   Идентичность уровня задают родитель и пункт-владелец, а не ссылка на массив
 *   пунктов. `parent` и `ownerItem` обязаны быть одновременно `null` (корень) или
 *   одновременно заданы (подменю), а `ownerItem` обязан быть владельцем непустого
 *   подменю — иначе создание бросает `Error`.
 *
 *   Промис, а не уровень: ответы действий пункта могут быть асинхронными, и до
 *   их получения уровня не существует. Негодный состав отвергается отказом промиса,
 *   а не броском, — иначе вызывающий, ждущий промис, поймал бы отказ как ошибку
 *   программы, а не как результат своего же `open()`.
 *
 *   Уровень, который уже построен, приводится к предъявленному составу: тот же
 *   отпечаток — обновляются ответы действий его пунктов, другой — уровень
 *   перестраивается целиком вместе со всем, что открыто из него, и создаётся заново
 *   под тем же `id`, потому что `aria-owns` владельца уже назван и другой адрес
 *   сделал бы ссылку висячей.
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
 *   Закрывает всё построенное дерево, от глубоких уровней к корню. DOM не трогает:
 *   уровни переиспользуются при следующем открытии. Обход шире цепочки показанных:
 *   заведённые вперёд уровни не показаны, но их владельцы стоят с `aria-expanded`
 *   и обязаны вернуться в `false`, а снятие отметки с владельца происходит внутри
 *   `hide`. Поэтому стоимость одного закрытия растёт с шириной построенного дерева,
 *   а не с глубиной открытого.
 * @property {() => void} destroy
 *   Снимает висящие задачи, вызывает `hidePopover` на каждом заведённом уровне,
 *   удаляет их из DOM и чистит состояние. Повторный вызов безопасен, остальные
 *   методы после него — нет-операции, а `ensureLevel` бросает `Error`: значение
 *   уровня он вернуть не может. Карту `actions` `destroy` не трогает.
 * @property {() => void} destroyAfterHide
 *   То же, что `destroy`, но в конце выхода: разбор отложен на
 *   `animationDuration`, а под `reduce` — сразу, потому что там `hide` гасит
 *   уровень мгновенно и ждать нечего. Пока уровни в DOM, слой остаётся живым и
 *   повторный вызов `destroyAfterHide` переставит разбор, а не разорвёт его.
 */

/**
 * Счётчик экземпляров слоя. Идентификаторы уровней обязаны быть уникальны не
 * только внутри экземпляра, но и между экземплярами на одной странице: `menuId`
 * входит в ключ пункта и в `id` уровня, а `aria-owns` ссылается на этот `id`.
 * Совпадение означало бы, что один экземпляр ссылается на уровень другого и
 * `aria-level` считается от чужого уровня. Карты `actions` у экземпляров разные,
 * так что коллизии ключей не возникает, — несущественно именно совпадение `id`.
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
 * Преобразование маска не трогает — довод в шапке модуля. Габариты она потому и не
 * искажает: их снимает `measureUntransformed`, а преобразование на вычисленной
 * ширине и высоте не отражается вовсе.
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
}

/**
 * Габариты раскладки без учёта `transform`.
 *
 * Вычисленные `width` и `height` — это использованные значения раскладки, и
 * преобразование на них не смотрит, тогда как `getBoundingClientRect` отдаёт рамку
 * уже после него.
 *
 * Дробная точность здесь обязательна: `offsetWidth` и `offsetHeight` округлены до
 * целых, а позиционер смотрит на разность габаритов, и округление съедало бы до
 * пикселя на каждом кандидате размещения.
 *
 * @param {HTMLElement} element
 * @returns {MenuSize}
 */
function measureUntransformed(element) {
  const style = globalThis.getComputedStyle(element);
  return {
    width: Number.parseFloat(style.width),
    height: Number.parseFloat(style.height),
  };
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
    scale = 1,
    actions,
    schedule = defaultSchedule,
    cancel = defaultCancel,
    reducedMotionQuery = defaultReducedMotionQuery(),
    onLevelsDiscarded = () => {},
  } = options;

  instanceSerial += 1;
  const menuIdPrefix = `vc-${instanceSerial}`;
  /** @type {LevelEntry | null} */
  let root = null;
  /** @type {LevelEntry[]} */
  const levels = [];
  /** @type {Map<LevelEntry, unknown>} */
  const pendingHides = new Map();
  /**
   * Контроллер прокрутки на каждый уровень. Живёт здесь, а не в `LevelEntry`,
   * потому что `LevelEntry` описывает уровень как уровень, и прокрутка сделала
   * бы его контрактом сразу о двух вещах.
   *
   * @type {Map<LevelEntry, ScrollZones>}
   */
  const zones = new Map();
  let destroyed = false;

  /**
   * Единственный способ получить `LevelEntry` — `createEntry`, а он обязан
   * зарегистрировать контроллер. Проверка не паранойя: она повторяет приём с
   * зарезервированным `aria-owns` и заменяет молчаливую потерю состояния при
   * рассинхроне.
   *
   * @param {LevelEntry} entry
   * @returns {ScrollZones}
   */
  function zonesOf(entry) {
    const controller = zones.get(entry);
    if (controller === undefined) {
      throw new Error('MyContext: у уровня нет контроллера зон прокрутки');
    }
    return controller;
  }

  /**
   * @param {Array<MenuItem | SeparatorItem>} items пункты уровня в исходном порядке.
   * @param {LevelEntry | null} parent уровень, из которого открывается этот.
   * @param {number} levelIndex
   * @param {RenderedItem | null} ownerItem
   * @param {string} menuId
   * @param {Array<LevelAnswer>} answers ответы строк этого показа; заново не собираются,
   *   и пересборка уровня не зовёт действия второй раз.
   * @returns {LevelEntry}
   */
  function createEntry(items, parent, levelIndex, ownerItem, menuId, answers) {
    /** @type {RenderContext} */
    const context = { levelIndex, menuId, label, actions };
    const rendered = renderLevel(items, context, answers);
    applyTheme(rendered.element, theme);
    applyAnimationDuration(rendered.element, animationDuration);
    applyScale(rendered.element, scale);
    /** @type {LevelEntry} */
    const entry = {
      element: rendered.element,
      items: rendered.items,
      parent,
      ownerItem,
      children: [],
      open: false,
      itemsHash: submenuHashOf(items),
      generation: 0,
      activeIndex: -1,
    };
    levels.push(entry);
    zones.set(entry, createScrollZones({
      list: rendered.scroll.list,
      level: entry.element,
      up: rendered.scroll.up,
      down: rendered.scroll.down,
    }));
    return entry;
  }

  /**
   * Приводит построенный уровень к предъявленному составу: тот же отпечаток и та же
   * видимость — обновляются ответы действий, иначе уровень перестраивается.
   *
   * Перестроение сносит поддерево целиком, а не перерисовывает список: состояния
   * уровня живут не только в его DOM. Реестр движка клавиатуры, подписки на показ
   * подменю и записи карты действий принадлежат окружению, и снос узлов их не
   * стирает, — а частичная перерисовка оставила бы в реестре пункты прежнего
   * состава и оставила бы `Tab` зацикленным на одном из них.
   *
   * Состав видимого — часть состава уровня, а не его украшение: строка, скрытая
   * предыдущим показом и видимая этим, обязана появиться, и появиться может только
   * вместе с перестроением — вставкой узла посреди уровня пришлось бы тогда ещё
   * пересчитать `aria-posinset` и `aria-setsize` соседей, список пунктов уровня и
   * его `activeIndex`, и отдельно разобраться с подменю пункта, который стал
   * невидимым владельцем. Пересборка отвечает на всё это разом, и адрес нового
   * уровня остаётся прежним, потому что `createEntry` получает тот же `menuId`.
   *
   * Проверки, жив ли ещё уровень, здесь нет: ответы собраны до того, как уровень
   * найден, и с этого момента до этого прохода нет ничего асинхронного. Проверка
   * живости жила ровно на той асинхронной границе, которой больше нет.
   *
   * @param {LevelEntry} entry уровень, построенный ранее.
   * @param {Array<MenuItem | SeparatorItem>} items новый состав того же уровня.
   * @param {Array<LevelAnswer>} answers ответы строк этого показа.
   * @param {number} levelIndex
   * @returns {LevelEntry} тот же уровень, если состав не изменился, и новый иначе.
   */
  function reconcile(entry, items, answers, levelIndex) {
    const sameShape = entry.itemsHash === submenuHashOf(items);
    const rebuild = !sameShape || refreshItems(items, entry.items, answers, entry.element.id, actions);
    if (!rebuild) {
      return entry;
    }
    const menuId = entry.element.id;
    const parent = entry.parent;
    discardLevels(entry);
    const fresh = createEntry(items, parent, levelIndex, entry.ownerItem, menuId, answers);
    if (parent === null) {
      root = fresh;
    } else {
      parent.children.push(fresh);
    }
    return fresh;
  }

  /**
   * Адрес, под которым уровень заводится заново. У корня он выводится из серийного
   * номера экземпляра и глубины, у подменю — берётся у пункта-владельца, потому что
   * `aria-owns` на пункте уже назван именно им и второй адрес на то же меню сделал
   * бы ссылку висячей.
   *
   * @param {LevelEntry | null} parent
   * @param {number} levelIndex
   * @param {RenderedItem | null} ownerItem
   * @returns {string}
   */
  function menuIdFor(parent, levelIndex, ownerItem) {
    if (parent === null) {
      return `${menuIdPrefix}-${levelIndex}`;
    }
    if (ownerItem === null) {
      throw new Error('MyContext: у уровня-подменя обязан быть пункт-владелец');
    }
    return reservedSubmenuId(ownerItem);
  }

  /**
   * Снос уровня и всего, что из него построено.
   *
   * Порядок обхода — от глубоких к корню, тот же, что у `hideAll`. Здесь он не
   * влияет ни на что: подменю лежат в `<body>` соседями, а не внутри друг друга,
   * и снимаются все разом. Один порядок на оба обхода — чтобы расхождение не
   * появилось там, где его не ждут.
   *
   * @param {LevelEntry} entry сносимый уровень.
   * @returns {void}
   */
  function discardLevels(entry) {
    const chain = chainOf(entry);
    chain.sort((a, b) => {
      return depthOf(b) - depthOf(a);
    });
    for (const level of chain) {
      clearPendingHide(level);
      // `hidePopover` на закрытом и на отцепленном элементе безопасен, поэтому
      // вызов не зависит от того, показывался ли уровень. Без него показанное
      // подменю осталось бы в Top Layer без узла, и закрывать его было бы нечего.
      level.element.hidePopover();
      level.element.remove();
      level.open = false;
      zonesOf(level).destroy();
      const position = levels.indexOf(level);
      if (position >= 0) {
        levels.splice(position, 1);
      }
      zones.delete(level);
    }
    const parent = entry.parent;
    if (parent === null) {
      root = null;
    } else {
      const position = parent.children.indexOf(entry);
      if (position >= 0) {
        parent.children.splice(position, 1);
      }
    }
    onLevelsDiscarded(chain);
  }

  /**
   * Заводит уровень по составу либо приводит уже построенный к нему.
   *
   * Ответы действий собираются здесь, а не внутри сборки уровня: один показ — один
   * сбор, и пересборка уровня, случившаяся из-за смены видимости, пользуется теми же
   * ответами. Второй сбор дал бы автору два состава под одним показом, и `submenuAction`,
   * отдающий непостоянный состав, разошёлся бы с тем, что показано.
   *
   * @param {Array<MenuItem | SeparatorItem>} items пункты уровня в исходном порядке.
   * @param {LevelEntry | null} parent уровень, из которого открывается этот.
   * @param {number} levelIndex глубина уровня, начиная с 0; идёт в `aria-level`.
   * @param {RenderedItem | null} ownerItem пункт-владелец; `null` у корня.
   * @returns {Promise<LevelEntry>}
   */
  function ensureLevel(items, parent, levelIndex, ownerItem) {
    if (destroyed) {
      return Promise.reject(new Error('MyContext: слой уничтожен'));
    }
    // Владелец у уровня один, и оба отказа — про его отсутствие: у корня владельца
    // быть не должно вовсе, а у подменю им нечего вешать. Проверка до сбора
    // ответов: отказ должен прийти раньше, чем автор увидит действия пунктов
    // уровня, которого не будет.
    if (parent === null && ownerItem !== null) {
      return Promise.reject(new Error('MyContext: у корневого уровня нет пункта-владельца'));
    }
    if (parent !== null && ownerItem === null) {
      return Promise.reject(new Error('MyContext: у уровня-подменя обязан быть пункт-владелец'));
    }
    return collectAnswers(items, menuIdFor(parent, levelIndex, ownerItem)).then((answers) => {
      return ensureLevelOf(items, parent, levelIndex, ownerItem, answers);
    });
  }

  /**
   * Заводит уровень по собранным ответам: уже построенный приводится к ним, а
   * отсутствующий строится.
   *
   * Проверки на разобранный слой здесь нет: слой проверяется до сбора ответов, а
   * разобрать его между сбором и этим вызовом можно — и тогда уровень построится
   * зря. Показывать его не станет: показ отменится по своему счёту показов, и
   * уровень уедет вместе с остальными.
   *
   * @param {Array<MenuItem | SeparatorItem>} items пункты уровня в исходном порядке.
   * @param {LevelEntry | null} parent уровень, из которого открывается этот.
   * @param {number} levelIndex глубина уровня, начиная с 0; идёт в `aria-level`.
   * @param {RenderedItem | null} ownerItem пункт-владелец; `null` у корня.
   * @param {Array<LevelAnswer>} answers ответы строк этого показа.
   * @returns {LevelEntry}
   */
  function ensureLevelOf(items, parent, levelIndex, ownerItem, answers) {
    if (parent === null) {
      root = root === null
        ? createEntry(items, null, levelIndex, null, menuIdFor(null, levelIndex, null), answers)
        : reconcile(root, items, answers, levelIndex);
      return root;
    }
    // Идентичность уровня — пара «родитель, владелец». Сравнение по ссылке на
    // `RenderedItem` устойчиво к перестроению разметки: элемент пункта
    // переиспользуется, а значит переиспользуется и уровень.
    const existing = parent.children.find((child) => {
      return child.ownerItem === ownerItem;
    });
    if (existing !== undefined) {
      return reconcile(existing, items, answers, levelIndex);
    }
    const entry = createEntry(
      items,
      parent,
      levelIndex,
      ownerItem,
      menuIdFor(parent, levelIndex, ownerItem),
      answers,
    );
    parent.children.push(entry);
    return entry;
  }

  /**
   * Показ уровня целиком: подключение, решение о прокрутке, замер вслепую, расчёт
   * положения, запись координат и только потом `showPopover`. Расчёт отдан на откуп
   * `place`, потому что корень и подменю считаются по-разному, а порядок шагов у
   * них один.
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
    /** @type {Placement | null} */
    let placement = null;
    try {
      // Подключение до замера: у отцепленного узла нет раскладки, и замер вернул бы
      // нули. Перенос при этом поднимает уровень в конец `<body>`, а порядок
      // отрисовки в Top Layer следует за порядком в DOM.
      document.body.appendChild(element);
      // Решение о прокрутке — подготовка состояния, и идёт оно до замера: считать
      // положение надо по состоянию, которое пользователь увидит, а не по переходному.
      // Порядок не оплачивается ничем — пока уровень ограничен `max-height`, обе высоты
      // совпадают, — но он защищает правило «спросить про переполнение при скрытых
      // зонах», которое держится на этом ограничении. Полная версия — в шапке модуля.
      zonesOf(entry).refresh();
      const size = measureUntransformed(element);
      placement = place(size);
    } finally {
      // Маска снимается в `finally`, а не по пути успеха: оставленный ею элемент
      // навсегда сохраняет `visibility: hidden` и `left: -9999px`, и следующий
      // показ этого уровня уже ничего с ним не сделает.
      clearMeasureMask(element);
      // Координаты пишутся после снятия маски, а не до: `left` и `top` есть и у
      // маски, и у результата, и обратный порядок стёр бы написанное. При броске
      // из `place` результата нет, и писать нечего.
      if (placement !== null) {
        element.style.left = `${placement.left}px`;
        element.style.top = `${placement.top}px`;
      }
    }
    if (placement === null) {
      throw new Error('MyContext: расчёт положения не дал результата');
    }
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
   * Отметка развёрнутости возвращается в `"false"`, а не снимается: у закрытого
   * подменю оно и есть «свёрнуто», и `false` говорит об этом прямо. Отсутствие
   * отметки означало бы «состояние неизвестно» и не отличалось бы от пункта без
   * подменю вовсе — а подменю у пункта есть и появится снова.
   *
   * @param {LevelEntry} entry закрываемый уровень.
   * @returns {void}
   */
  function collapseOwner(entry) {
    const owner = entry.ownerItem;
    if (owner === null) {
      return;
    }
    owner.element.setAttribute('aria-expanded', 'false');
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
    // Прокрутка встаёт вместе с уровнем: под `data-vc-closing` зоны не принимают
    // событий, и оставшийся кадр гонял бы список, к которому никто не прикоснётся.
    zonesOf(entry).stop();
    collapseOwner(entry);
    // Отметка закрытия: до неё уровень всё ещё `:popover-open`, стиль не меняется и
    // гаснуть нечему. С неё гаснут `opacity` и `transform` по правилу
    // `.vc-menu[data-vc-closing]`, и события с уровня снимаются — на всё время
    // отложенного периода, пока он в Top Layer.
    //
    // **Ставится и под `reduce`, где отложенности нет.** Пропуск отложенности
    // пропускать анимацию, а не отметку: авторское `display: flex` у `.vc-menu`
    // перебивает UA-правило `[popover]:not(:popover-open) { display: none }` по
    // происхождению, и без отметки закрытый уровень остался бы отрисованным и
    // принимающим события — невидимое меню, глотающее клики там, где его уже нет.
    // Под `reduce` отметка ничего не анимирует: в CSS для него `transition: none`.
    const element = entry.element;
    element.setAttribute('data-vc-closing', '');
    // Под `reduce` отложенность пропускается целиком: в CSS стоит `transition: none`,
    // и `display` дошёл бы до `none` мгновенно, так что ждать нечего, а ждание
    // заставило бы уровень висеть после закрытия.
    if (reducedMotionQuery.matches) {
      element.hidePopover();
      return;
    }
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
      // Контроллер снимает и живой кадр, и слушателей: кадр на отцеплённом узле
      // гонял бы список, которого больше нет, и держал бы его до конца страницы.
      zonesOf(entry).destroy();
    }
    levels.length = 0;
    zones.clear();
    root = null;
  }

  /**
   * Разбор в конце выхода, а не сразу после закрытия.
   *
   * `hide` оставляет уровень в Top Layer на `animationDuration`: он гаснет на своём
   * месте, и снять его раньше — значит оборвать анимацию на середине. Для обычного
   * закрытия это неважно — уровень переиспользуется следующим показом, — но меню,
   * заведённое ради одного показа, следующего показа не имеет: его узлы должны уйти
   * вместе с анимацией, иначе оно либо моргает, либо остаётся в DOM навсегда.
   *
   * Задача не отменяется, и отменять её нечем: разбор объявляет слой мёртвым сразу,
   * и ни один его метод больше не ставит задач, кроме `destroyAfterHide` — повторный
   * вызов лишь переставляет срок.
   *
   * @returns {void}
   */
  function destroyAfterHide() {
    if (destroyed) {
      return;
    }
    // Под `reduce` закрытие мгновенно: `hide` уже вызвал `hidePopover`, и ждать
    // после этого нечего, — ждание только оставило бы закрытые уровни в DOM на всю
    // длительность.
    if (reducedMotionQuery.matches) {
      destroy();
      return;
    }
    schedule(destroy, animationDuration);
  }

  return {
    ensureLevel,
    showRoot,
    showSubmenu,
    hide,
    hideAll,
    destroy,
    destroyAfterHide,
  };
}
