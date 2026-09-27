import { expect, test } from '@playwright/test';
import { CLOSE_GRACE_MS, DEGENERATE_AREA, OPEN_GRACE_MS } from '../../src/constants.js';
import { createHoverIntent } from '../../src/hoverIntent.js';

/**
 * @typedef {import('../../src/hoverIntent.js').Point} Point
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
 */

/**
 * @returns {HoverSetup} контроллер на ручных часах. Задержки не передаются:
 *   кейсы проверяют дефолты — 250 мс на открытие и 200 мс на закрытие.
 */
function setup() {
  const clock = createManualClock();
  const hover = createHoverIntent({
    schedule: clock.schedule,
    cancel: clock.cancel,
    now: clock.now,
  });
  return { clock, hover };
}

/**
 * Прогоняет курсор от пункта-владельца в подменю: позиция на пункте, уход с
 * него, вход в подменю. После вызова заданы оба якоря safe-triangle.
 *
 * @param {HoverIntentController} hover контроллер hover intent.
 * @param {Point} exitPoint точка, где курсор покидает пункт-владелец.
 * @param {Point} entryPoint точка входа в подменю.
 * @returns {void}
 */
function enterSubmenuFrom(hover, exitPoint, entryPoint) {
  hover.pointerMove(exitPoint);
  hover.itemLeave();
  hover.submenuEnter(entryPoint);
}

// Якоря safe-triangle из брифа. Выходной якорь модуль запоминает сам: в момент
// itemLeave он берёт последнюю известную позицию курсора, поэтому отдельно он
// не передаётся.
const EXIT_POINT = { x: 100, y: 50 };
const ENTRY_POINT = { x: 160, y: 60 };
// Первая позиция после входа принимается без проверки и становится вершиной
// треугольника из трёх уже принятых точек: |(60, 10) × (30, 30)| / 2 = 750 px²,
// то есть заведомо выше порога DEGENERATE_AREA.
const FIRST_POINT = { x: 130, y: 80 };
// Внутри треугольника EXIT_POINT, ENTRY_POINT, FIRST_POINT: кросс-продукты
// 850, 200 и 450 одного знака, сумма подтреугольников 425 + 100 + 225 = 750 px².
const INSIDE_POINT = { x: 135, y: 70 };
// Кросс-продукты 23000, -20000 и -1500: знаки разные, точка снаружи.
const OUTSIDE_POINT = { x: 500, y: 500 };

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

  test('itemPress открывает немедленно, без задачи в планировщике', () => {
    const { clock, hover } = setup();

    hover.itemEnter();
    hover.itemPress();

    // Контракт не отдаёт колбэка открытия, поэтому «открылось немедленно»
    // наблюдается как «задачи открытия больше нет».
    expect(hover.isOpenPending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);
  });
});

test.describe('закрытие', () => {
  test('курсор внутри треугольника не планирует закрытие', () => {
    const { clock, hover } = setup();
    enterSubmenuFrom(hover, EXIT_POINT, ENTRY_POINT);
    hover.pointerMove(FIRST_POINT);

    hover.pointerMove(INSIDE_POINT);

    expect(hover.isClosePending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);
  });

  test('курсор снаружи треугольника планирует закрытие через closeDelayMs', () => {
    const { clock, hover } = setup();
    enterSubmenuFrom(hover, EXIT_POINT, ENTRY_POINT);
    hover.pointerMove(FIRST_POINT);

    hover.pointerMove(OUTSIDE_POINT);

    expect(hover.isClosePending()).toBe(true);
    expect(clock.tasks).toHaveLength(1);
    expect(clock.tasks[0].time).toBe(clock.now() + CLOSE_GRACE_MS);
  });

  test('возврат курсора внутрь отменяет запланированное закрытие', () => {
    const { clock, hover } = setup();
    enterSubmenuFrom(hover, EXIT_POINT, ENTRY_POINT);
    hover.pointerMove(FIRST_POINT);

    hover.pointerMove(OUTSIDE_POINT);
    expect(hover.isClosePending()).toBe(true);

    hover.pointerMove(INSIDE_POINT);

    expect(hover.isClosePending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);
  });
});

test.describe('промах сбрасывает опорные точки', () => {
  test('после точки вне треугольника следующая проверяется против сузившегося клина', () => {
    const { hover } = setup();
    enterSubmenuFrom(hover, EXIT_POINT, ENTRY_POINT);
    hover.pointerMove(FIRST_POINT);
    hover.pointerMove(OUTSIDE_POINT);
    expect(hover.isClosePending()).toBe(true);

    // Промах обнуляет вершину, поэтому точка проверяется против клина
    // (100, 50), (160, 60), (500, 500), где её кросс-продукты 900, 5100 и
    // 17000 одного знака. Против исходного треугольника она снаружи: знаки
    // 900, -450 и 1050 разные, и закрытие осталось бы запланированным.
    hover.pointerMove({ x: 160, y: 75 });

    expect(hover.isClosePending()).toBe(false);
  });
});

test.describe('вырожденный треугольник', () => {
  test('точки почти на одной прямой не защищают подменю', () => {
    const { clock, hover } = setup();
    // Якоря отличаются на 0.4 px по вертикали: площадь треугольника
    // |(0, 0.4) × (0, 150)| / 2 = 0 px², то есть меньше DEGENERATE_AREA.
    enterSubmenuFrom(hover, { x: 100, y: 50 }, { x: 100, y: 50.4 });
    hover.pointerMove({ x: 100, y: 200 });

    // Первая позиция после входа принимается без проверки, дальше вырожденный
    // клин не защищает: каждая точка планирует закрытие.
    hover.pointerMove({ x: 100, y: 300 });
    expect(hover.isClosePending()).toBe(true);
    expect(clock.tasks).toHaveLength(1);
    expect(clock.tasks[0].time).toBe(clock.now() + CLOSE_GRACE_MS);

    // Повторная проверка не плодит задачи: закрытие уже запланировано.
    hover.pointerMove({ x: 300, y: 100 });
    expect(hover.isClosePending()).toBe(true);
    expect(clock.tasks).toHaveLength(1);
  });
});

test.describe('граница', () => {
  test('площадь ровно DEGENERATE_AREA считается невырожденной', () => {
    const { clock, hover } = setup();
    // |(10, 0) × (0, 5)| / 2 = 25 px² — ровно порог, не меньше, поэтому клин
    // невырожден и решение принимает принадлежность.
    enterSubmenuFrom(hover, { x: 0, y: 0 }, { x: 10, y: 0 });
    hover.pointerMove({ x: 0, y: 5 });

    // Внутри: кросс-продукты 10, 30 и 10 одного знака.
    hover.pointerMove({ x: 2, y: 1 });
    expect(hover.isClosePending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);

    // Снаружи: кросс-продукты 200 и -250 разного знака.
    hover.pointerMove({ x: 20, y: 20 });
    expect(hover.isClosePending()).toBe(true);
    expect(DEGENERATE_AREA).toBe(25);
  });
});

test.describe('отмена', () => {
  test('cancelAll снимает и открытие, и закрытие', () => {
    const { clock, hover } = setup();
    hover.itemEnter();
    hover.pointerMove(OUTSIDE_POINT);
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

test.describe('сброс', () => {
  test('новый itemEnter сбрасывает якоря предыдущего подменю', () => {
    const { hover } = setup();
    enterSubmenuFrom(hover, EXIT_POINT, ENTRY_POINT);

    hover.itemEnter();
    hover.pointerMove(FIRST_POINT);

    // Без сброса эта точка стала бы вершиной старого треугольника и не
    // планировала бы закрытие: якоря нового пункта-владельца ещё нет.
    expect(hover.isClosePending()).toBe(true);
  });
});

test.describe('первая позиция после входа', () => {
  test('принимается и становится вершиной, но не запускает закрытие', () => {
    const { clock, hover } = setup();
    // Свои якоря, чтобы кейс не повторял проверку сужения клина.
    enterSubmenuFrom(hover, { x: 200, y: 100 }, { x: 260, y: 110 });

    hover.pointerMove({ x: 300, y: 200 });

    expect(hover.isClosePending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);

    // Точка принята вершиной: следующая проверяется против треугольника
    // (200, 100), (260, 110), (300, 200) площадью 2500 px², и (500, 500) вне
    // него — кросс-продукты 21000, -6000 и -10000 разного знака.
    hover.pointerMove(OUTSIDE_POINT);

    expect(hover.isClosePending()).toBe(true);
    expect(clock.tasks).toHaveLength(1);
  });
});

test.describe('вырожденный клин не защищает', () => {
  test('промах и следующая за ним точка обе планируют закрытие', () => {
    const { clock, hover } = setup();
    enterSubmenuFrom(hover, { x: 100, y: 50 }, { x: 100, y: 50.4 });
    hover.pointerMove({ x: 100, y: 200 });

    hover.pointerMove({ x: 400, y: 10 });
    expect(hover.isClosePending()).toBe(true);
    expect(clock.tasks).toHaveLength(1);
    expect(clock.tasks[0].time).toBe(clock.now() + CLOSE_GRACE_MS);

    // Страховка срабатывает, и вторая точка планирует закрытие заново: против
    // сузившегося клина (100, 50), (100, 50.4), (400, 10) площадью 60 px² у
    // (380, 20) кросс-продукты -112, 2192 и -2200 разного знака.
    clock.advance(CLOSE_GRACE_MS);
    expect(hover.isClosePending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);

    hover.pointerMove({ x: 380, y: 20 });

    expect(hover.isClosePending()).toBe(true);
    expect(clock.tasks).toHaveLength(1);
    expect(clock.tasks[0].time).toBe(clock.now() + CLOSE_GRACE_MS);
  });
});

test.describe('часы по умолчанию', () => {
  test('без инъекций контроллер работает на глобальных таймерах', () => {
    // Единственный кейс без ручного планировщика, и ждать он не должен: проверяется
    // только то, что дефолты не падают и что задача снимается настоящим
    // `clearTimeout`. Время вперёд не двигается, поэтому кейс не зависит от
    // скорости машины.
    const hover = createHoverIntent();

    hover.itemEnter();
    expect(hover.isOpenPending()).toBe(true);

    hover.cancelAll();
    expect(hover.isOpenPending()).toBe(false);
    expect(hover.isClosePending()).toBe(false);
  });
});
