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
  // Направление цикла: `1` вниз, `-1` вверх, `0` — цикла нет.
  let direction = 0;
  // Отметка времени предыдущего кадра; `null` значит «время ещё не замерено».
  // Именно `null`, а не `0`: ноль — законное значение отметки кадра, и при
  // совпадении второй кадр принимался бы за первый, а список не сдвинулся бы
  // ни разу за весь цикл.
  /** @type {number | null} */
  let previous = null;

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
   * Заблокирована ли зона, в которую идёт цикл.
   *
   * Аргумент всегда `±1`: `0` означает, что цикла нет, и шага с ним не бывает.
   *
   * @param {number} sign направление цикла.
   * @returns {boolean}
   */
  function blocked(sign) {
    return sign < 0 ? up.hasAttribute('data-vc-blocked') : down.hasAttribute('data-vc-blocked');
  }

  /**
   * @param {number} time
   * @returns {void}
   */
  function step(time) {
    frame = 0;
    // Первый кадр задаёт точку отсчёта: время между постановкой цикла и первым
    // кадром не имеет отношения к шагу и уводил бы список на пол-экрана.
    if (previous === null) {
      previous = time;
      frame = requestFrame(step);
      return;
    }
    const distance = Math.round(speed * (time - previous) / 1000);
    previous = time;
    // Шаг округляется до целых пикселей, и кадр короче одного пикселя сдвига
    // даёт ноль. Проверки упора стоят именно здесь: у такого кадра двигать
    // нечем, и остановить его — значило бы убить цикл на середине пути.
    if (distance > 0) {
      const before = list.scrollTop;
      list.scrollTop += direction * distance;
      sync();
      // Упоров два, и оба нужны. Зона могла заблокироваться при том, что запись
      // список всё же сдвинула — остаток до низа меньше шага, — и тогда второй
      // признак молчал бы, а цикл пошёл бы дальше по мёртвой зоне.
      if (blocked(direction) || list.scrollTop === before) {
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
    if (blocked(next)) {
      return;
    }
    stop();
    direction = next;
    previous = null;
    frame = requestFrame(step);
  }

  /**
   * Пересчёт признака и состояния зон на каждый показ: содержимое уровня между
   * показами меняется, и решение, принятое в прошлый раз, могло устареть.
   * `sync` зовётся и на уровне без перебора, иначе у зон остался бы признак
   * упора от прошлого показа.
   *
   * Без перебора цикл останавливается: прокручивать больше нечего, и оставшийся
   * кадр крутил бы список впустую. На прокручиваемом уровне пересчёт цикл не
   * трогает — иначе он гасил бы прокрутку на каждом показе.
   *
   * @returns {void}
   */
  function refresh() {
    level.removeAttribute('data-vc-scrollable');
    if (list.scrollHeight > list.clientHeight) {
      level.setAttribute('data-vc-scrollable', '');
    } else {
      stop();
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
    // `removeEventListener` смотрит только на `capture`, поэтому опция `passive`
    // при снятии не повторяется и подписку не оставляет.
    up.removeEventListener('wheel', onZoneWheel);
    down.removeEventListener('wheel', onZoneWheel);
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

  /**
   * Колесо над зоной не достаётся ни до чего.
   *
   * У зоны нет `overflow`, поэтому без `preventDefault` колесо уходит странице,
   * страница скроллится, и глобальный обработчик закрывает меню. Зона — часть
   * меню, и колесо над ней относится к меню так же, как колесо над самим списком.
   *
   * Заблокированная зона не исключение: там некуда идти прокрутке, но колесо всё
   * так же не её. Различать состояния зон незачем — колесо гасится и на верхней,
   * и на нижней, и решение о том, есть ли куда идти, принимает цикл по кадрам, а
   * не это тело.
   *
   * Подписка обязана быть `passive: false`: браузер отменяет прокрутку по
   * умолчанию у пассивного слушателя, и `preventDefault` в нём молчал бы, оставив
   * ровно то поведение, которое здесь убирается.
   *
   * @param {WheelEvent} event
   * @returns {void}
   */
  function onZoneWheel(event) {
    event.preventDefault();
  }

  // Подписка одна на контроллер, а не на `refresh`: пересчитывать признак можно
  // сколько угодно раз, слушателей столько не бывает. `scroll` слушается прямо
  // на списке — он не всплывает, и делегат на уровне его не увидит.
  up.addEventListener('pointerenter', onUpEnter);
  up.addEventListener('pointerleave', onZoneLeave);
  down.addEventListener('pointerenter', onDownEnter);
  down.addEventListener('pointerleave', onZoneLeave);
  up.addEventListener('wheel', onZoneWheel, { passive: false });
  down.addEventListener('wheel', onZoneWheel, { passive: false });
  list.addEventListener('scroll', onListScroll, { passive: true });

  return { refresh, stop, destroy };
}
