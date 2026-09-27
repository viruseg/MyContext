import { CLOSE_GRACE_MS, DEGENERATE_AREA, OPEN_GRACE_MS } from './constants.js';

/**
 * Модуль решает, летит ли курсор к подменю или уже ушёл от него. Пока курсор
 * внутри треугольника из трёх уже принятых точек — «безопасного треугольника» —
 * закрытие откладывается, иначе работает страховочный таймер.
 *
 * Проверяемая точка никогда не входит в проверяемый многоугольник: если бы она
 * была его вершиной, она лежала бы внутри по определению и проверка стала бы
 * тождественной. Первая позиция после входа в подменю поэтому принимается без
 * проверки, каждая следующая проверяется против `[выход, вход, последняя
 * принятая]`, а промах обнуляет последнюю принятую точку — иначе клин рос бы
 * от каждого движения и подменю не закрывалось бы никогда.
 *
 * Домен не трогается: контроллер работает только с точками `{x, y}` в
 * координатах вьюпорта, которые ему передаёт вызывающий код.
 */

/**
 * Точка в координатах вьюпорта, px.
 *
 * @typedef {object} Point
 * @property {number} x
 * @property {number} y
 */

/**
 * Настройки контроллера. `schedule`, `cancel` и `now` обязательны по контракту:
 * тесты обязаны управлять временем руками, без реальных таймеров.
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
 * @property {(now: () => number) => number} [now] текущее время, мс. Не читается:
 *   время задаёт `schedule`, а решение принимается по его задачам.
 */

/**
 * Контроллер hover intent.
 *
 * @typedef {object} HoverIntentController
 * @property {() => void} itemEnter курсор на пункте-владельце: снимает
 *   запланированное закрытие прошлого подменю, сбрасывает его опорные точки и
 *   планирует открытие через `openDelayMs`.
 * @property {() => void} itemLeave курсор покинул пункт-владелец: запоминает
 *   последнюю позицию `pointerMove` якорем выхода и отменяет открытие.
 * @property {(point: Point) => void} submenuEnter курсор вошёл в подменю: точка
 *   становится якорем входа, ожидающая вершина сбрасывается, запланированное
 *   закрытие снимается.
 * @property {(point: Point) => void} pointerMove позиция курсора: первая после
 *   входа принимается как вершина, каждая следующая проверяется против клина из
 *   трёх уже принятых точек. Точка вне клина планирует закрытие и обнуляет
 *   вершину, сужая клин.
 * @property {() => boolean} isOpenPending `true`, пока задача открытия ждёт своего
 *   времени. Сбросить раньше времени может только `itemLeave` или `itemPress`.
 * @property {() => boolean} isClosePending `true`, пока задача закрытия ждёт
 *   своего времени.
 * @property {() => void} itemPress пункт нажат: открытие происходит немедленно,
 *   задача снимается. Колбэка открытия у контроллера нет, поэтому «немедленно»
 *   наблюдается как снятая задача и сброшенный `isOpenPending`.
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
 * @param {Point[]} triangle вершины треугольника против часовой стрелки или по
 *   прямой, любой ориентации.
 * @returns {number} площадь треугольника, px².
 */
function triangleArea(triangle) {
  return Math.abs(cross(triangle[0], triangle[1], triangle[2])) / 2;
}

/**
 * Единственное место, где решается принадлежность точки треугольнику. Вырожденный
 * треугольник здесь считается содержащим любую точку — вырожденность проверяет
 * вызывающий код, иначе клин нулевой площади защищал бы подменю вечно.
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
  } = options;

  /** @type {Point | null} */
  let exitPoint = null;
  /** @type {Point | null} */
  let entryPoint = null;
  /** @type {Point | null} */
  let lastAcceptedPoint = null;
  /** @type {Point | null} последняя позиция `pointerMove`, источник якоря выхода. */
  let lastPointerPoint = null;
  /** @type {unknown} */
  let openHandle = null;
  /** @type {unknown} */
  let closeHandle = null;
  let openPending = false;
  let closePending = false;

  /**
   * @returns {void}
   */
  function clearOpen() {
    if (!openPending) {
      return;
    }
    cancel(openHandle);
    openHandle = null;
    openPending = false;
  }

  /**
   * @returns {void}
   */
  function clearClose() {
    if (!closePending) {
      return;
    }
    cancel(closeHandle);
    closeHandle = null;
    closePending = false;
  }

  /**
   * @returns {void}
   */
  function planClose() {
    if (closePending) {
      return;
    }
    closePending = true;
    closeHandle = schedule(() => {
      closeHandle = null;
      closePending = false;
    }, closeDelayMs);
  }

  /**
   * @returns {void}
   */
  function itemEnter() {
    clearClose();
    exitPoint = null;
    entryPoint = null;
    lastAcceptedPoint = null;
    if (openPending) {
      return;
    }
    openPending = true;
    openHandle = schedule(() => {
      openHandle = null;
      openPending = false;
    }, openDelayMs);
  }

  /**
   * @returns {void}
   */
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
    lastAcceptedPoint = null;
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
    if (lastAcceptedPoint === null) {
      lastAcceptedPoint = lastPointerPoint;
      return;
    }

    const triangle = [exitPoint, entryPoint, lastAcceptedPoint];
    // Клин площадью ровно `degenerateArea` невырожден: порог строгий, иначе
    // граница вела бы себя как вырожденная.
    if (triangleArea(triangle) >= degenerateArea && containsPoint(triangle, point)) {
      clearClose();
      return;
    }

    // Обнуление вершины обязательно: без него клин рос бы от каждой принятой
    // точки, и подменю осталось бы открытым. В вырожденной ветке оно же
    // позволяет курсору вернуться ближе и сделать клин невырожденным.
    lastAcceptedPoint = lastPointerPoint;
    planClose();
  }

  /**
   * @returns {void}
   */
  function itemPress() {
    clearOpen();
  }

  /**
   * @returns {void}
   */
  function cancelAll() {
    clearOpen();
    clearClose();
    exitPoint = null;
    entryPoint = null;
    lastAcceptedPoint = null;
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
