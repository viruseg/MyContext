import { OPEN_GRACE_MS } from './constants.js';

/**
 * Hover intent: решает, когда показать подменю по наведению.
 *
 * Наведение на пункт-владелец планирует показ через `openDelayMs`, уход с
 * пункта до истечения срока отменяет его, а нажатие показывает немедленно.
 *
 * **Закрытия здесь нет, и это не пропуск.** Уже открытое подменю принадлежит
 * активному пункту родительского уровня, и закрывает его переход на соседний
 * пункт — как в системных меню, где подменю живёт ровно пока живёт его владелец.
 * Модуль, который закрывает по уходу курсора, закрывал бы подменю при движении
 * по диагонали мимо пункта и при выходе в нейтральную зону страницы, то есть
 * везде, где пользователь ничего не делал, — и убрать его было бы нечем.
 *
 * Домен не трогается: модуль не знает ни про пункты, ни про уровни, ни про
 * координаты курсора. Показывать — тело вызывающего кода, а предмет показа он
 * передаёт ему сам через `onOpen`.
 */

/**
 * Настройки контроллера. `schedule` и `cancel` обязательны по контракту: тесты
 * обязаны управлять временем руками, без реальных таймеров.
 *
 * @typedef {object} HoverIntentOptions
 * @property {number} [openDelayMs] задержка открытия, мс, `OPEN_GRACE_MS` по умолчанию.
 * @property {(fn: () => void, ms: number) => unknown} [schedule] постановка задачи.
 *   По умолчанию глобальный `setTimeout`, вызванный как метод `globalThis`:
 *   отвязанная ссылка на `setTimeout` в некоторых браузерах бросает
 *   `Illegal invocation`. Возвращаемый жест задачи не интерпретируется.
 * @property {(handle: unknown) => void} [cancel] снятие задачи по жесту, который
 *   вернул `schedule`. По умолчанию глобальный `clearTimeout`.
 * @property {() => void} [onOpen] вызывается, когда сработала задержка открытия.
 */

/**
 * Контроллер отложенного открытия.
 *
 * @typedef {object} HoverIntentController
 * @property {() => void} itemEnter курсор на пункте-владельце: планирует показ
 *   через `openDelayMs`. Повторный вход на тот же пункт отсчёт не перезапускает:
 *   задержка идёт от первого наведения.
 * @property {() => void} itemLeave курсор покинул пункт-владелец: отменяет
 *   ещё не состоявшееся открытие. Уже показанное подменю не трогает — закрывать
 *   его нечем, и решение о закрытии принимает активный пункт уровня. Позиция
 *   курсора не передаётся и не хранится: она ничего не решает.
 * @property {() => boolean} isOpenPending `true`, пока задача открытия ждёт своего
 *   времени. Сбросить раньше времени могут `itemLeave`, `itemPress` и `cancelAll`.
 * @property {() => void} itemPress пункт нажат: планировавшееся открытие происходит
 *   немедленно — задача снимается, `onOpen` вызывается синхронно, и
 *   `isOpenPending()` после этого `false`. Если задачи открытия нет, нажатие ничего
 *   не делает: модуль судит по висящей задаче, а она снята и `itemLeave`, и
 *   `cancelAll` тоже, поэтому «уже показанное подменю» от «сорванного открытия»
 *   здесь неразличимо.
 * @property {() => void} cancelAll снимает задачу открытия и сбрасывает флаг.
 */

/**
 * @param {() => void} fn работа задачи.
 * @param {number} ms задержка, мс.
 * @returns {unknown} жест задачи, который отменяется через `cancel`.
 */
function defaultSchedule(fn, ms) {
  return globalThis.setTimeout(fn, ms);
}

/**
 * Отмена по жесту от `defaultSchedule`. Глобальный `clearTimeout` зовётся так же
 * как метод `globalThis` — по той же причине, что и `setTimeout` выше.
 *
 * Жест приходит из `schedule` и по контракту опции — `unknown`, потому что
 * подставленный планировщик может отдавать что угодно. Глобальный `clearTimeout`
 * ждёт число, и приведение здесь единственное: ослаблять его до `any` нельзя, а
 * проверять жест нечем — он уже отработал.
 *
 * @param {unknown} handle жест задачи.
 * @returns {void}
 */
function defaultCancel(handle) {
  globalThis.clearTimeout(/** @type {number} */ (handle));
}

/**
 * @param {HoverIntentOptions} options
 * @returns {HoverIntentController} контроллер отложенного открытия.
 */
export function createHoverIntent(options = {}) {
  const {
    openDelayMs = OPEN_GRACE_MS,
    schedule = defaultSchedule,
    cancel = defaultCancel,
    onOpen = () => {},
  } = options;

  /** @type {unknown} */
  let openHandle = null;
  let openPending = false;

  function clearOpen() {
    if (!openPending) {
      return;
    }
    cancel(openHandle);
    openHandle = null;
    openPending = false;
  }

  // Флаг снимается до вызова колбэка: тот, кто открывает подменю из `onOpen`,
  // должен увидеть уже согласованное состояние.
  function fireOpen() {
    openHandle = null;
    openPending = false;
    onOpen();
  }

  function itemEnter() {
    if (openPending) {
      return;
    }
    openPending = true;
    openHandle = schedule(fireOpen, openDelayMs);
  }

  function itemLeave() {
    clearOpen();
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
  }

  return {
    itemEnter,
    itemLeave,
    isOpenPending: () => openPending,
    itemPress,
    cancelAll,
  };
}
