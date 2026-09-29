import { expect, test } from '@playwright/test';
import { OPEN_GRACE_MS } from '../../src/constants.js';
import { createHoverIntent } from '../../src/hoverIntent.js';

/**
 * @typedef {import('../../src/hoverIntent.js').HoverIntentController} HoverIntentController
 */

/**
 * Задача ручного планировщика.
 *
 * @typedef {object} ManualTask
 * @property {() => void} fn работа, которую запускает `advance`.
 * @property {number} time момент срабатывания на ручных часах, мс.
 */

/**
 * Ручной планировщик и ручные часы: время двигает только тест, поэтому кейсы
 * не ждут реальных таймеров и не зависят от скорости машины.
 *
 * `schedule` возвращает жест задачи, а `cancel` принимает `unknown` — ровно
 * такой контракт объявляет `HoverIntentOptions`.
 *
 * @typedef {object} ManualClock
 * @property {ManualTask[]} tasks живые задачи: отменённые удаляются из массива.
 * @property {() => number} now текущее время ручных часов, мс.
 * @property {(fn: () => void, ms: number) => ManualTask} schedule ставит задачу на `ms` мс вперёд.
 * @property {(handle: unknown) => void} cancel снимает задачу по её жесту.
 * @property {(ms: number) => void} advance двигает время и запускает дозревшие задачи.
 */

/**
 * @returns {ManualClock} планировщик с ручным временем, изначально нулём.
 */
function createManualClock() {
  /** @type {ManualTask[]} */
  const tasks = [];
  let currentTime = 0;

  /**
   * @param {() => void} fn работа задачи.
   * @param {number} ms задержка от текущего времени ручных часов, мс.
   * @returns {ManualTask} жест задачи для отмены.
   */
  function schedule(fn, ms) {
    const task = { fn, time: currentTime + ms };
    tasks.push(task);
    return task;
  }

  /**
   * @param {unknown} handle жест задачи, каким его вернул `schedule`.
   * @returns {void}
   */
  function cancel(handle) {
    const index = tasks.indexOf(/** @type {ManualTask} */ (handle));
    if (index !== -1) {
      tasks.splice(index, 1);
    }
  }

  /**
   * @param {number} ms сколько миллисекунд прибавить к ручному времени.
   * @returns {void}
   */
  function advance(ms) {
    currentTime += ms;
    // Снимок дозревших задач делается до цикла, и это правило часов, а не деталь
    // реализации: задача, запланированная из колбэка с нулевой задержкой, в этом
    // проходе не выполнится и сработает на следующем `advance`.
    const due = tasks.filter((task) => task.time <= currentTime).sort((a, b) => a.time - b.time);
    for (const task of due) {
      cancel(task);
      task.fn();
    }
  }

  return {
    tasks,
    now: () => currentTime,
    schedule,
    cancel,
    advance,
  };
}

/**
 * @typedef {object} HoverSetup
 * @property {ManualClock} clock ручные часы.
 * @property {HoverIntentController} hover контроллер отложенного открытия.
 * @property {string[]} calls имена сработавших обратных связей в порядке вызова.
 */

/**
 * @returns {HoverSetup} контроллер на ручных часах. Задержка не передаётся: кейсы
 *   проверяют дефолт в 250 мс. `onOpen` только записывает факт срабатывания,
 *   поэтому время двигает планировщик, а не колбэк.
 */
function setup() {
  const clock = createManualClock();
  /** @type {string[]} */
  const calls = [];
  const hover = createHoverIntent({
    schedule: clock.schedule,
    cancel: clock.cancel,
    onOpen: () => calls.push('open'),
  });
  return { clock, hover, calls };
}

test.describe('открытие', () => {
  test('itemEnter планирует открытие через openDelayMs', () => {
    const { clock, hover } = setup();

    hover.itemEnter();

    expect(clock.tasks).toHaveLength(1);
    expect(clock.tasks[0].time).toBe(clock.now() + OPEN_GRACE_MS);
  });

  test('isOpenPending истинен до срабатывания и ложен после', () => {
    const { clock, hover } = setup();

    hover.itemEnter();
    expect(hover.isOpenPending()).toBe(true);

    clock.advance(OPEN_GRACE_MS);
    expect(hover.isOpenPending()).toBe(false);
  });

  test('itemLeave до истечения задержки отменяет открытие', () => {
    const { clock, hover } = setup();

    hover.itemEnter();
    hover.itemLeave();

    expect(hover.isOpenPending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);

    clock.advance(OPEN_GRACE_MS);
    expect(hover.isOpenPending()).toBe(false);
  });

  test('itemPress открывает немедленно, вызывая onOpen без задачи в планировщике', () => {
    const { clock, hover, calls } = setup();

    hover.itemEnter();
    hover.itemPress();

    // Открытие происходит на самом нажатии: колбэк вызван синхронно, задачи
    // больше нет, состояние уже согласованное.
    expect(calls).toEqual(['open']);
    expect(hover.isOpenPending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);
  });

  test('itemPress при уже висящей задаче не создаёт второй вызов onOpen', () => {
    const { clock, hover, calls } = setup();

    hover.itemEnter();
    hover.itemPress();
    clock.advance(1000);

    // Нажатие забрало задачу, поэтому по истечении срока открываться нечему.
    expect(calls).toEqual(['open']);
    expect(hover.isOpenPending()).toBe(false);
  });

  test('itemPress без висящей задачи открытия не вызывает onOpen', () => {
    const { clock, hover, calls } = setup();

    hover.itemPress();

    // Открытие не планировалось, поэтому нажатию выполнять нечего. Вызов `onOpen`
    // здесь означал бы, что нажатие открывает подменю мимо задержки по событию,
    // которого не было, — а guard стоит именно на этом.
    expect(calls).toEqual([]);
    expect(hover.isOpenPending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);
  });

  test('повторный itemEnter не перезапускает задержку открытия', () => {
    const { clock, hover, calls } = setup();

    hover.itemEnter();
    clock.advance(100);
    hover.itemEnter();

    // Отсчёт идёт от первого наведения: задача одна, срок прежний, а не now + 250.
    expect(clock.tasks).toHaveLength(1);
    expect(clock.tasks[0].time).toBe(OPEN_GRACE_MS);

    clock.advance(OPEN_GRACE_MS);
    expect(hover.isOpenPending()).toBe(false);
    expect(calls).toEqual(['open']);
  });
});

test.describe('отмена', () => {
  test('cancelAll снимает отложенное открытие', () => {
    const { clock, hover } = setup();
    hover.itemEnter();
    expect(hover.isOpenPending()).toBe(true);

    hover.cancelAll();

    expect(hover.isOpenPending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);

    clock.advance(OPEN_GRACE_MS);
    expect(hover.isOpenPending()).toBe(false);
  });
});

test.describe('обратная связь', () => {
  test('onOpen срабатывает ровно один раз по истечении задержки', () => {
    const { clock, hover, calls } = setup();

    hover.itemEnter();
    expect(calls).toEqual([]);

    clock.advance(OPEN_GRACE_MS);
    expect(calls).toEqual(['open']);

    clock.advance(OPEN_GRACE_MS * 5);
    expect(calls).toEqual(['open']);
  });

  test('отменённая задача открытия не зовёт onOpen', () => {
    const { clock, hover, calls } = setup();

    // Уход с пункта-владельца снимает показ, не состоявшееся: закрывать тут нечего,
    // а показать там, где курсора уже нет, — значило бы открыть подменю в пустоте.
    hover.itemEnter();
    hover.itemLeave();
    expect(calls).toEqual([]);

    clock.advance(OPEN_GRACE_MS * 5);
    expect(calls).toEqual([]);
  });

  test('внутри колбэка флаг ожидания уже снят', () => {
    const clock = createManualClock();
    /** @type {boolean[]} значения `isOpenPending` на момент вызова `onOpen`. */
    const seen = [];
    const hover = createHoverIntent({
      schedule: clock.schedule,
      cancel: clock.cancel,
      onOpen: () => seen.push(hover.isOpenPending()),
    });

    hover.itemEnter();
    clock.advance(OPEN_GRACE_MS);

    // Порядок «снять флаг, потом звать колбэк» зафиксирован: перестановка дала бы
    // здесь `true`, и тот, кто открывает подменю из колбэка, увидел бы ещё
    // висящую задачу, которую тут же снимет собственным уходом.
    expect(seen).toEqual([false]);
  });

  test('без колбэков задачи срабатывают молча', () => {
    const clock = createManualClock();
    const hover = createHoverIntent({ schedule: clock.schedule, cancel: clock.cancel });

    // Колбэк не передан, значит работает его no-op дефолт: задача обязана
    // сработать, а не упасть на отсутствии обработчика.
    hover.itemEnter();
    clock.advance(OPEN_GRACE_MS);
    expect(hover.isOpenPending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);
  });
});

test.describe('часы по умолчанию', () => {
  test('без инъекций контроллер работает на глобальных таймерах', () => {
    // Единственный кейс без ручного планировщика, и ждать он не должен: время
    // вперёд не двигается, поэтому кейс не зависит от скорости машины. Проверяет
    // ровно одно — ветка дефолтов не падает: опечатка в `globalThis.setTimeout`
    // валит кейс, а содержимое `clearTimeout` кейс не проверяет.
    const hover = createHoverIntent();

    hover.itemEnter();
    expect(hover.isOpenPending()).toBe(true);

    hover.cancelAll();
    expect(hover.isOpenPending()).toBe(false);
  });
});

test.describe('удалённая половина контракта', () => {
  test('контроллер не отдаёт ничего от закрытия по положению курсора', () => {
    // Закрытия по геометрии не существует: его решения принимает активный пункт
    // уровня, а не прямоугольник вокруг подменю. Остатки этого API в контроллере
    // означали бы второе место, где живёт решение о закрытии, — и оно молча
    // разошлось бы с первым при любом изменении модели пунктов.
    const hover = createHoverIntent();

    expect(Object.keys(hover).sort()).toEqual([
      'cancelAll',
      'isOpenPending',
      'itemEnter',
      'itemLeave',
      'itemPress',
    ]);
  });
});
