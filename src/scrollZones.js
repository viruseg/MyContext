import { SCROLL_SPEED_PX_PER_SEC } from './constants.js';

/**
 * Узлы уровня и то, чем гоняются кадры. Планировщик в опциях — только ради
 * стенда: он отдаёт кадрам заданное время, и по живому часу одного шага
 * проверить скорость нельзя.
 *
 * @typedef {object} ScrollZoneOptions
 * @property {HTMLElement} list прокручиваемый список уровня.
 * @property {HTMLElement} level элемент уровня: он же носитель
 * `data-vc-scrollable`.
 * @property {HTMLElement} up верхняя зона.
 * @property {HTMLElement} down нижняя зона.
 * @property {number} [speed] скорость прокрутки, px в секунду. По умолчанию
 * `SCROLL_SPEED_PX_PER_SEC`; поле есть ради стенда, который гоняет шаг по
 * задачному времени.
 * @property {(callback: (time: number) => void) => number} [requestFrame]
 * @property {(handle: number) => void} [cancelFrame]
 */

/**
 * Управляет прокруткой одного уровня: решает, прокручиваем ли он, и гоняет список
 * по кадрам, пока курсор держит зону.
 *
 * Встать цикл может по трём причинам, и ни одной четвёртой: список дошёл до
 * упора и больше не сдвигается, курсор ушёл с зоны, снаружи позвали `stop` или
 * `destroy`.
 *
 * @typedef {object} ScrollZones
 * @property {() => void} refresh пересчитывает признак прокручиваемости уровня и
 * состояние зон. Зовётся из `present` и только оттуда.
 * @property {() => void} stop останавливает текущую прокрутку, не снимая
 * слушателей. Зовётся из `hide` и перед перезапуском цикла.
 * @property {() => void} destroy останавливает прокрутку и снимает слушателей.
 * Зовётся при уничтожении слоя.
 */

/**
 * Кадр по умолчанию — живой `requestAnimationFrame` страницы. Вынесено из
 * значения по умолчанию в деструктуризации, как `defaultSchedule` и
 * `defaultCancel` в `src/layer.js`: дефолт обязан быть именованной функцией с
 * типом, а не выражением.
 *
 * @param {(time: number) => void} callback
 * @returns {number} жест кадра, который отменяется через `cancelFrame`.
 */
function defaultRequestFrame(callback) {
  return globalThis.requestAnimationFrame(callback);
}

/**
 * @param {number} handle
 * @returns {void}
 */
function defaultCancelFrame(handle) {
  globalThis.cancelAnimationFrame(handle);
}

/**
 * @param {ScrollZoneOptions} options
 * @returns {ScrollZones}
 */
export function createScrollZones(options) {
  const {
    list,
    level,
    up,
    down,
    speed = SCROLL_SPEED_PX_PER_SEC,
    requestFrame = defaultRequestFrame,
    cancelFrame = defaultCancelFrame,
  } = options;

  // `frame` — жест висящего кадра, `0` значит «кадров нет». Настоящий
  // `requestAnimationFrame` ноль не отдаёт, и заглушка стенда тоже: иначе
  // «кадров нет» нельзя было бы отличить от «кадр один».
  let frame = 0;
  // Направление цикла: `1` вниз, `-1` вверх, `0` — цикла нет. Само тело шага
  // направление не читает, а читатель кода обязан.
  let direction = 0;
  // Отметка времени предыдущего кадра; `0` значит «время ещё не замерено».
  let previous = 0;

  /**
   * Единственный писатель `data-vc-blocked`. Порог снизу с допуском в 1 px:
   * `scrollHeight` и `clientHeight` дробные там, где высоты кратны `dvh`, и без
   * допуска зона гасла бы за пиксель до настоящего низа.
   *
   * @returns {void}
   */
  function sync() {
    const atTop = list.scrollTop <= 0;
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
    up.toggleAttribute('data-vc-blocked', atTop);
    down.toggleAttribute('data-vc-blocked', atBottom);
  }

  /**
   * @param {number} time
   * @returns {void}
   */
  function step(time) {
    frame = 0;
    // Первый кадр задаёт точку отсчёта: время между постановкой цикла и первым
    // кадром не имеет отношения к шагу и уводил бы список на пол-экрана.
    if (previous === 0) {
      previous = time;
      frame = requestFrame(step);
      return;
    }
    const distance = Math.round(speed * (time - previous) / 1000);
    previous = time;
    // Шаг округляется до целых пикселей, и кадр короче одного пикселя сдвига
    // даёт ноль. Проверка упора стоит именно здесь: у такого кадра двигать
    // нечего, и остановить его — значило бы убить цикл на середине пути.
    if (distance > 0) {
      const before = list.scrollTop;
      list.scrollTop += direction * distance;
      sync();
      if (list.scrollTop === before) {
        stop();
        return;
      }
    }
    frame = requestFrame(step);
  }

  /**
   * @returns {void}
   */
  function stop() {
    if (frame !== 0) {
      cancelFrame(frame);
      frame = 0;
    }
    direction = 0;
  }

  /**
   * @param {-1 | 1} next направление прокрутки: вверх или вниз.
   * @returns {void}
   */
  function begin(next) {
    // Зона, до которой не доскроллить, цикл не запускает: пустой кадр всё равно
    // должен был бы сразу же встать, но без этой проверки он ещё и мигает.
    if (next < 0 ? up.hasAttribute('data-vc-blocked') : down.hasAttribute('data-vc-blocked')) {
      return;
    }
    stop();
    direction = next;
    previous = 0;
    frame = requestFrame(step);
  }

  /**
   * Пересчёт признака и состояния зон на каждый показ: содержимое уровня между
   * показами меняется, и решение, принятое в прошлый раз, могло устареть.
   * `sync` зовётся и на уровне без перебора, иначе у зон остался бы признак
   * упора от прошлого показа.
   *
   * @returns {void}
   */
  function refresh() {
    level.removeAttribute('data-vc-scrollable');
    if (list.scrollHeight > list.clientHeight) {
      level.setAttribute('data-vc-scrollable', '');
    }
    sync();
  }

  /**
   * @returns {void}
   */
  function destroy() {
    stop();
    up.removeEventListener('pointerenter', onUpEnter);
    up.removeEventListener('pointerleave', onZoneLeave);
    down.removeEventListener('pointerenter', onDownEnter);
    down.removeEventListener('pointerleave', onZoneLeave);
    list.removeEventListener('scroll', onListScroll);
  }

  /**
   * @returns {void}
   */
  function onUpEnter() {
    begin(-1);
  }

  /**
   * @returns {void}
   */
  function onDownEnter() {
    begin(1);
  }

  /**
   * @returns {void}
   */
  function onZoneLeave() {
    stop();
  }

  /**
   * @returns {void}
   */
  function onListScroll() {
    sync();
  }

  // Подписка одна на контроллер, а не на `refresh`: пересчитывать признак можно
  // сколько угодно раз, слушателей столько не бывает. `scroll` слушается прямо
  // на списке — он не всплывает, и делегат на уровне его не увидит.
  up.addEventListener('pointerenter', onUpEnter);
  up.addEventListener('pointerleave', onZoneLeave);
  down.addEventListener('pointerenter', onDownEnter);
  down.addEventListener('pointerleave', onZoneLeave);
  list.addEventListener('scroll', onListScroll, { passive: true });

  return { refresh, stop, destroy };
}
