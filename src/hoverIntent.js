import { CLOSE_GRACE_MS, DEGENERATE_AREA, OPEN_GRACE_MS } from './constants.js';

/**
 * Hover intent: решает, летит ли курсор к подменю. Пока курсор внутри
 * «безопасного треугольника» из трёх уже принятых точек, закрытие откладывается,
 * иначе решение принимает страховочный таймер.
 *
 * Проверяемая точка в проверяемый многоугольник не входит: вершина треугольника
 * лежит в нём по определению, и такая проверка была бы тождественной. Поэтому
 * первая позиция после входа в подменю принимается без проверки.
 *
 * Домен не трогается: точки `{x, y}` в координатах вьюпорта передаёт вызывающий код.
 */

/**
 * Точка в координатах вьюпорта, px.
 *
 * @typedef {object} Point
 * @property {number} x
 * @property {number} y
 */

/**
 * Настройки контроллера. `schedule` и `cancel` обязательны по контракту: тесты
 * обязаны управлять временем руками, без реальных таймеров.
 *
 * @typedef {object} HoverIntentOptions
 * @property {number} [openDelayMs] задержка открытия, мс, `OPEN_GRACE_MS` по умолчанию.
 * @property {number} [closeDelayMs] задержка закрытия, мс, `CLOSE_GRACE_MS` по умолчанию.
 * @property {number} [degenerateArea] порог площади клина, px², `DEGENERATE_AREA` по
 *   умолчанию. Клин вырожден, если его площадь строго меньше порога, поэтому
 *   площадь ровно `degenerateArea` невырождена и решает принадлежность точки.
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
 *   запланированное закрытие прошлого подменю, сбрасывает его опорные точки и
 *   планирует открытие через `openDelayMs`. Повторный вход на тот же пункт отсчёт
 *   не перезапускает: задержка идёт от первого наведения.
 * @property {() => void} itemLeave курсор покинул пункт-владелец: запоминает
 *   последнюю позицию `pointerMove` якорем выхода и отменяет открытие.
 * @property {(point: Point) => void} submenuEnter курсор вошёл в подменю: точка
 *   становится якорем входа, вершина клина сбрасывается, запланированное закрытие
 *   снимается.
 * @property {(point: Point) => void} pointerMove позиция курсора. Первая позиция
 *   после входа принимается без проверки и становится вершиной клина; каждая
 *   следующая проверяется против клина из трёх уже принятых точек. Попадание внутрь
 *   оставляет вершину прежней, промах планирует закрытие и сам становится новой
 *   вершиной, то есть сужает клин.
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
 * @property {() => void} cancelAll снимает обе задачи, сбрасывает флаги и все
 *   опорные точки, включая источник якоря выхода.
 */

/**
 * Векторное произведение векторов `AB` и `AC`: удвоенная знаковая площадь
 * треугольника `ABC`.
 *
 * @param {Point} a первая вершина.
 * @param {Point} b вторая вершина.
 * @param {Point} c третья вершина.
 * @returns {number} удвоенная знаковая площадь, px². Ноль у вырожденного треугольника.
 */
function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * @param {Point[]} triangle вершины треугольника в любом порядке.
 * @returns {number} площадь треугольника, px²: ориентация вершин не важна, у
 *   треугольника на одной прямой площадь нулевая.
 */
function triangleArea(triangle) {
  return Math.abs(cross(triangle[0], triangle[1], triangle[2])) / 2;
}

/**
 * Единственное место, где решается принадлежность точки треугольнику. Вырожденный
 * треугольник **не** считается содержащим любую точку: у трех коллинеарных точек
 * кросс-продукты выходят разных знаков, и предикат вернёт `false`. Безопасность
 * держит вызывающий код, проверяющий площадь через `degenerateArea`; при
 * `degenerateArea: 0` проверка на границе, и клин нулевой площади закрыл бы
 * подменю на каждом движении.
 *
 * Точка на стороне считается принадлежащей: все кросс-продукты нулевые или одного
 * знака.
 *
 * @param {Point[]} triangle невырожденный треугольник.
 * @param {Point} point проверяемая точка, не вершина `triangle`.
 * @returns {boolean} `true`, если точка внутри или на границе.
 */
function containsPoint(triangle, point) {
  const [a, b, c] = triangle;
  const ab = cross(a, b, point);
  const bc = cross(b, c, point);
  const ca = cross(c, a, point);
  return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
}

/**
 * Опорные точки копируются: якоря живут дольше вызова, а вызывающий код
 * свободен мутировать переданный объект.
 *
 * @param {Point} point точка вызывающего кода.
 * @returns {Point} независимая копия точки.
 */
function copyPoint(point) {
  return { x: point.x, y: point.y };
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
    degenerateArea = DEGENERATE_AREA,
    schedule = defaultSchedule,
    cancel = defaultCancel,
    onOpen = () => {},
    onClose = () => {},
  } = options;

  /** @type {Point | null} */
  let exitPoint = null;
  /** @type {Point | null} */
  let entryPoint = null;
  /** @type {Point | null} первая позиция после входа или последний промах. */
  let wedgeTip = null;
  /** @type {Point | null} последняя позиция `pointerMove`, источник якоря выхода. */
  let lastPointerPoint = null;
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
    exitPoint = null;
    entryPoint = null;
    wedgeTip = null;
    if (openPending) {
      return;
    }
    openPending = true;
    openHandle = schedule(fireOpen, openDelayMs);
  }

  function itemLeave() {
    if (lastPointerPoint !== null) {
      exitPoint = lastPointerPoint;
    }
    clearOpen();
  }

  /**
   * @param {Point} point точка входа в подменю.
   * @returns {void}
   */
  function submenuEnter(point) {
    entryPoint = copyPoint(point);
    wedgeTip = null;
    clearClose();
  }

  /**
   * @param {Point} point текущая позиция курсора.
   * @returns {void}
   */
  function pointerMove(point) {
    lastPointerPoint = copyPoint(point);

    if (entryPoint === null || exitPoint === null) {
      planClose();
      return;
    }
    if (wedgeTip === null) {
      wedgeTip = lastPointerPoint;
      return;
    }

    const triangle = [exitPoint, entryPoint, wedgeTip];
    // Клин площадью ровно `degenerateArea` невырожден: порог строгий, иначе
    // граница вела бы себя как вырожденная.
    if (triangleArea(triangle) >= degenerateArea && containsPoint(triangle, point)) {
      clearClose();
      return;
    }

    // Промах обязан стать вершиной: иначе клин не сузился бы, и подменю осталось
    // бы открытым внутри треугольника, растущего от каждой принятой точки. В
    // вырожденной ветке это же позволяет курсору вернуться ближе и сделать клин
    // невырожденным.
    wedgeTip = lastPointerPoint;
    planClose();
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
    exitPoint = null;
    entryPoint = null;
    wedgeTip = null;
    lastPointerPoint = null;
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
