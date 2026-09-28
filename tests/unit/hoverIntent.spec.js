import { expect, test } from '@playwright/test';
import { CLOSE_GRACE_MS, OPEN_GRACE_MS } from '../../src/constants.js';
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
 * @property {HoverIntentController} hover контроллер hover intent.
 * @property {string[]} calls имена сработавших обратных связей в порядке вызова.
 */

/**
 * @returns {HoverSetup} контроллер на ручных часах. Задержки не передаются:
 *   кейсы проверяют дефолты — 250 мс на открытие и 200 мс на закрытие. `onOpen` и
 *   `onClose` только записывают факт срабатывания, поэтому время двигает
 *   планировщик, а не колбэки.
 */
function setup() {
  const clock = createManualClock();
  /** @type {string[]} */
  const calls = [];
  const hover = createHoverIntent({
    schedule: clock.schedule,
    cancel: clock.cancel,
    onOpen: () => calls.push('open'),
    onClose: () => calls.push('close'),
  });
  return { clock, hover, calls };
}

// Прямоугольник подменю и точка внутри него. У `OUTSIDE_AREA` отличается только
// нижняя граница, и `OUTSIDE_POINT` проваливается ровно за неё: «снаружи» проверяется
// одной величиной, а не двумя независимыми расхождениями, любое из которых сломало бы
// кейс по другой причине.
const AREA = { left: 100, top: 100, right: 300, bottom: 400 };
const OUTSIDE_AREA = { left: 100, top: 100, right: 300, bottom: 200 };
const INSIDE_POINT = { x: 200, y: 300 };
const OUTSIDE_POINT = { x: 200, y: 350 };
// На левой границе области: принадлежность границе обязана быть включительной, иначе
// переход к подменю планировал бы закрытие ровно на собственной кромке.
const EDGE_POINT = { x: 100, y: 250 };

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

    // Ни открытие, ни закрытие не планировалось, поэтому нажатию выполнять
    // нечего. Вызов `onOpen` здесь означал бы, что нажатие открывает подменю мимо
    // задержки по событию, которого не было, — а guard стоит именно на этом.
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

test.describe('безопасная область', () => {
  test('курсор внутри безопасной области не планирует закрытие', () => {
    const { clock, hover, calls } = setup();

    hover.pointerMove(INSIDE_POINT, AREA);
    clock.advance(CLOSE_GRACE_MS * 3);

    // Ждём срок целиком, а не половину: внутри области закрытие не планировалось
    // вовсе, и ждать было нечего.
    expect(hover.isClosePending()).toBe(false);
    expect(calls).toEqual([]);
  });

  test('курсор на границе безопасной области не планирует закрытие', () => {
    const { clock, hover, calls } = setup();

    hover.pointerMove(EDGE_POINT, AREA);
    clock.advance(CLOSE_GRACE_MS * 3);

    expect(hover.isClosePending()).toBe(false);
    expect(calls).toEqual([]);
  });

  test('курсор снаружи безопасной области планирует закрытие через closeDelayMs', () => {
    const { clock, hover, calls } = setup();

    hover.pointerMove(OUTSIDE_POINT, OUTSIDE_AREA);

    expect(hover.isClosePending()).toBe(true);
    expect(clock.tasks).toHaveLength(1);
    expect(clock.tasks[0].time).toBe(clock.now() + CLOSE_GRACE_MS);

    clock.advance(CLOSE_GRACE_MS);
    expect(calls).toEqual(['close']);
  });

  test('возврат курсора внутрь отменяет запланированное закрытие', () => {
    const { clock, hover, calls } = setup();

    hover.pointerMove(OUTSIDE_POINT, OUTSIDE_AREA);
    expect(hover.isClosePending()).toBe(true);

    hover.pointerMove(INSIDE_POINT, AREA);
    clock.advance(CLOSE_GRACE_MS * 2);

    expect(hover.isClosePending()).toBe(false);
    expect(calls).toEqual([]);
  });

  test('без открытого подменю любое движение планирует закрытие', () => {
    const { clock, hover } = setup();

    // Области нет, а не «область пустая»: подменю не открыто, и координаты курсора
    // сами по себе ничего не значат.
    hover.pointerMove(INSIDE_POINT, null);

    expect(hover.isClosePending()).toBe(true);
    expect(clock.tasks).toHaveLength(1);
  });

  test('вход в подменю снимает запланированное закрытие', () => {
    const { clock, hover, calls } = setup();

    hover.pointerMove(OUTSIDE_POINT, OUTSIDE_AREA);
    expect(hover.isClosePending()).toBe(true);

    // Вход в подменю не берёт точку: он и есть решение, и полагаться на то, что
    // `pointermove` внутри подменю успеет снять закрытие, значило бы завязать
    // корректность на порядок событий.
    hover.submenuEnter();
    clock.advance(CLOSE_GRACE_MS * 2);

    expect(hover.isClosePending()).toBe(false);
    expect(calls).toEqual([]);
  });

  test('прямое движение к дальнему углу подменю не планирует закрытие', () => {
    const { hover } = setup();
    // Прямая от пункта-владельца к дальнему углу подменю: исходный дефект был ровно
    // на этом пути. Первая точка вне пункта уже заходит в расширенную область, а
    // дальше весь отрезок лежит в ней по построению.
    const from = { x: 96, y: 104 };
    const to = { x: 296, y: 396 };
    const steps = 20;

    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      hover.pointerMove(
        { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
        AREA,
      );

      expect(hover.isClosePending(), `шаг ${step} из ${steps} не планирует закрытие`).toBe(false);
    }
  });

  test('выход за верхний край области планирует закрытие', () => {
    const { hover } = setup();

    hover.pointerMove({ x: 200, y: 99 }, AREA);

    expect(hover.isClosePending()).toBe(true);
  });

  test('выход за нижний край области планирует закрытие', () => {
    const { hover } = setup();

    hover.pointerMove({ x: 200, y: 401 }, AREA);

    expect(hover.isClosePending()).toBe(true);
  });
});

test.describe('отмена', () => {
  test('cancelAll снимает и открытие, и закрытие', () => {
    const { clock, hover } = setup();
    hover.itemEnter();
    hover.pointerMove(OUTSIDE_POINT, OUTSIDE_AREA);
    expect(hover.isOpenPending()).toBe(true);
    expect(hover.isClosePending()).toBe(true);

    hover.cancelAll();

    expect(hover.isOpenPending()).toBe(false);
    expect(hover.isClosePending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);

    clock.advance(CLOSE_GRACE_MS);
    expect(hover.isOpenPending()).toBe(false);
    expect(hover.isClosePending()).toBe(false);
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

  test('onClose срабатывает ровно один раз по истечении задержки', () => {
    const { clock, hover, calls } = setup();
    hover.pointerMove(OUTSIDE_POINT, OUTSIDE_AREA);
    expect(calls).toEqual([]);

    clock.advance(CLOSE_GRACE_MS);
    expect(calls).toEqual(['close']);

    clock.advance(CLOSE_GRACE_MS * 5);
    expect(calls).toEqual(['close']);
  });

  test('отменённые задачи не вызывают обратную связь', () => {
    const { clock, hover, calls } = setup();

    // Открытие снято уходом с пункта, закрытие — возвратом курсора внутрь области.
    hover.itemEnter();
    hover.itemLeave();
    hover.pointerMove(OUTSIDE_POINT, OUTSIDE_AREA);
    hover.pointerMove(INSIDE_POINT, AREA);
    expect(calls).toEqual([]);

    clock.advance(CLOSE_GRACE_MS * 5);
    expect(calls).toEqual([]);
  });

  test('внутри колбэков флаги ожидания уже сняты', () => {
    const clock = createManualClock();
    /** @type {boolean[][]} пары [isOpenPending, isClosePending] на момент вызова. */
    const seen = [];
    const hover = createHoverIntent({
      schedule: clock.schedule,
      cancel: clock.cancel,
      onOpen: () => seen.push([hover.isOpenPending(), hover.isClosePending()]),
      onClose: () => seen.push([hover.isOpenPending(), hover.isClosePending()]),
    });

    hover.itemEnter();
    clock.advance(OPEN_GRACE_MS);
    hover.pointerMove(OUTSIDE_POINT, OUTSIDE_AREA);
    clock.advance(CLOSE_GRACE_MS);

    // Порядок «снять флаг, потом звать колбэк» зафиксирован: перестановка дала бы
    // здесь [true, false] для открытия и [false, true] для закрытия.
    expect(seen).toEqual([
      [false, false],
      [false, false],
    ]);
  });

  test('без колбэков задачи срабатывают молча', () => {
    const clock = createManualClock();
    const hover = createHoverIntent({ schedule: clock.schedule, cancel: clock.cancel });

    // Колбэки не переданы, значит работают их no-op дефолты: задача обязана
    // сработать, а не упасть на отсутствии обработчика.
    hover.itemEnter();
    clock.advance(OPEN_GRACE_MS);
    expect(hover.isOpenPending()).toBe(false);

    hover.pointerMove(OUTSIDE_POINT, OUTSIDE_AREA);
    clock.advance(CLOSE_GRACE_MS);
    expect(hover.isClosePending()).toBe(false);
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
    expect(hover.isClosePending()).toBe(false);
  });
});
