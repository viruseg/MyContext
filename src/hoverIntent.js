import { CLOSE_GRACE_MS, OPEN_GRACE_MS } from './constants.js';

/**
 * Hover intent: решает, летит ли курсор к подменю. Пока курсор внутри
 * безопасной области, закрытие откладывается, иначе решение принимает
 * страховочный таймер.
 *
 * Область выводит вызывающий код из геометрии пары «владелец + подменю», а не из
 * истории движения, и это принципиально. Движение к пункту подменю идёт почти по
 * прямой, и площадь, построенная по опорным точкам траектории, на прямой равна
 * нулю, то есть защищала ровно тот случай, который случается всегда. Прямоугольник
 * на прямой не вырождается никогда, а отрезок от пункта-владельца к любому пункту
 * подменю лежит в нём по построению: зазор между уровнями равен ровно
 * `SUBMENU_OFFSET`, и он покрыт расширением в сторону владельца.
 *
 * Домен не трогается: точки `{x, y}` и область в координатах вьюпорта передаёт
 * вызывающий код.
 */

/**
 * Точка в координатах вьюпорта, px.
 *
 * @typedef {object} Point
 * @property {number} x
 * @property {number} y
 */

/**
 * Прямоугольник безопасной области в координатах вьюпорта, px. Точка на границе
 * считается принадлежащей области: переход к подменю проходит по её собственной
 * кромке, и исключительная граница планировала бы закрытие ровно на пути к пункту.
 *
 * @typedef {object} SafeArea
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 */

/**
 * Настройки контроллера. `schedule` и `cancel` обязательны по контракту: тесты
 * обязаны управлять временем руками, без реальных таймеров.
 *
 * @typedef {object} HoverIntentOptions
 * @property {number} [openDelayMs] задержка открытия, мс, `OPEN_GRACE_MS` по умолчанию.
 * @property {number} [closeDelayMs] задержка закрытия, мс, `CLOSE_GRACE_MS` по умолчанию.
 * @property {(fn: () => void, ms: number) => unknown} [schedule] постановка задачи.
 *   По умолчанию глобальный `setTimeout`, вызванный как метод `globalThis`:
 *   отвязанная ссылка на `setTimeout` в некоторых браузерах бросает
 *   `Illegal invocation`. Возвращаемый жест задачи не интерпретируется.
 * @property {(handle: unknown) => void} [cancel] снятие задачи по жесту, который
 *   вернул `schedule`. По умолчанию глобальный `clearTimeout`.
 * @property {() => void} [onOpen] вызывается, когда сработала задержка открытия.
 * @property {() => void} [onClose] вызывается, когда сработала задержка закрытия.
 */

/**
 * Контроллер hover intent.
 *
 * @typedef {object} HoverIntentController
 * @property {() => void} itemEnter курсор на пункте-владельце: снимает
 *   запланированное закрытие прошлого подменю и планирует открытие через
 *   `openDelayMs`. Повторный вход на тот же пункт отсчёт не перезапускает: задержка
 *   идёт от первого наведения.
 * @property {() => void} itemLeave курсор покинул пункт-владелец: отменяет
 *   открытие. Позиция курсора не передаётся и не хранится — она ничего не решает,
 *   потому что безопасная область приходит из геометрии подменю, а не из
 *   траектории.
 * @property {() => void} submenuEnter курсор вошёл в подменю: запланированное
 *   закрытие снимается. Точка не передаётся: вход в подменю и есть решение, а
 *   ждать сопровождающего его `pointermove` значило бы завязать корректность на
 *   порядок событий. Этот шаг держит подменю открытым и там, куда безопасная
 *   область не достаёт, — например при переходе через зазор больше `SUBMENU_OFFSET`
 *   у подменю, прижатого к краю вьюпорта.
 * @property {(point: Point, safeArea: SafeArea | null) => void} pointerMove позиция
 *   курсора и безопасная область показанного подменю. Закрытие планируется тогда и
 *   только тогда, когда области нет — то есть подменю не открыто — или точка вне
   *   прямоугольника; попадание внутрь или на границу снимает запланированное
   *   закрытие. Область обязана приходить свежей на каждый вызов: показ подменю
   *   меняет геометрию, и область прежнего показа обслуживала бы уже другой
   *   прямоугольник.

 * @property {() => boolean} isOpenPending `true`, пока задача открытия ждёт своего
 *   времени. Сбросить раньше времени могут `itemLeave`, `itemPress` и `cancelAll`.
 * @property {() => boolean} isClosePending `true`, пока задача закрытия ждёт своего
 *   времени.
 * @property {() => void} itemPress пункт нажат: планировавшееся открытие происходит
 *   немедленно — задача снимается, `onOpen` вызывается синхронно, и
 *   `isOpenPending()` после этого `false`. Если задачи открытия нет, нажатие ничего
 *   не делает: модуль судит по висящей задаче, а она снята и `itemLeave`, и
 *   `cancelAll` тоже, поэтому «уже открытое подменю» от «сорванного открытия» здесь
 *   неразличимо.
 * @property {() => void} cancelAll снимает обе задачи и сбрасывает флаги.
 */

/**
 * Единственное место, где решается принадлежность точки области.
 *
 * @param {SafeArea} area прямоугольник безопасной области.
 * @param {Point} point проверяемая точка.
 * @returns {boolean} `true`, если точка внутри прямоугольника или на границе.
 */
function containsArea(area, point) {
  return (
    point.x >= area.left && point.x <= area.right && point.y >= area.top && point.y <= area.bottom
  );
}

/**
 * @param {() => void} fn работа задачи.
 * @param {number} ms задержка, мс.
 * @returns {unknown} жест задачи, который отменяется через `cancel`.
 */
function defaultSchedule(fn, ms) {
  return globalThis.setTimeout(fn, ms);
}

/**
 * Жест задачи у инъекции — `unknown`, поэтому приведение к типу таймера
 * обязательно: контроллер жесты не различает, они для него просто значения.
 *
 * @param {unknown} handle жест задачи.
 * @returns {void}
 */
function defaultCancel(handle) {
  globalThis.clearTimeout(/** @type {number} */ (handle));
}

/**
 * @param {HoverIntentOptions} [options] настройки; без них берутся константы
 *   `src/constants.js` и глобальные таймеры.
 * @returns {HoverIntentController} контроллер состояния hover intent.
 */
export function createHoverIntent(options = {}) {
  const {
    openDelayMs = OPEN_GRACE_MS,
    closeDelayMs = CLOSE_GRACE_MS,
    schedule = defaultSchedule,
    cancel = defaultCancel,
    onOpen = () => {},
    onClose = () => {},
  } = options;

  /** @type {unknown} */
  let openHandle = null;
  /** @type {unknown} */
  let closeHandle = null;
  let openPending = false;
  let closePending = false;

  function clearOpen() {
    if (!openPending) {
      return;
    }
    cancel(openHandle);
    openHandle = null;
    openPending = false;
  }

  function clearClose() {
    if (!closePending) {
      return;
    }
    cancel(closeHandle);
    closeHandle = null;
    closePending = false;
  }

  function planClose() {
    if (closePending) {
      return;
    }
    closePending = true;
    closeHandle = schedule(fireClose, closeDelayMs);
  }

  // Флаги снимаются до вызова колбэка: тот, кто открывает подменю из `onOpen`,
  // должен увидеть уже согласованное состояние.
  function fireOpen() {
    openHandle = null;
    openPending = false;
    onOpen();
  }

  function fireClose() {
    closeHandle = null;
    closePending = false;
    onClose();
  }

  function itemEnter() {
    clearClose();
    if (openPending) {
      return;
    }
    openPending = true;
    openHandle = schedule(fireOpen, openDelayMs);
  }

  function itemLeave() {
    clearOpen();
  }

  function submenuEnter() {
    clearClose();
  }

  /**
   * @param {Point} point текущая позиция курсора.
   * @param {SafeArea | null} safeArea безопасная область показанного подменю либо
   *   `null`, когда подменю не открыто.
   * @returns {void}
   */
  function pointerMove(point, safeArea) {
    if (safeArea === null || !containsArea(safeArea, point)) {
      planClose();
      return;
    }
    clearClose();
  }

  function itemPress() {
    if (!openPending) {
      return;
    }
    clearOpen();
    fireOpen();
  }

  function cancelAll() {
    clearOpen();
    clearClose();
  }

  return {
    itemEnter,
    itemLeave,
    submenuEnter,
    pointerMove,
    isOpenPending: () => openPending,
    isClosePending: () => closePending,
    itemPress,
    cancelAll,
  };
}
