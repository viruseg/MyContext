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
    enterSubmenuFrom(hover, EXIT_POINT, ENTRY_POINT);
    hover.pointerMove(FIRST_POINT);
    hover.pointerMove(OUTSIDE_POINT);
    expect(calls).toEqual([]);

    clock.advance(CLOSE_GRACE_MS);
    expect(calls).toEqual(['close']);

    clock.advance(CLOSE_GRACE_MS * 5);
    expect(calls).toEqual(['close']);
  });

  test('отменённые задачи не вызывают обратную связь', () => {
    const { clock, hover, calls } = setup();

    // Открытие снято уходом с пункта, закрытие — возвратом курсора внутрь клина.
    hover.itemEnter();
    hover.itemLeave();
    enterSubmenuFrom(hover, EXIT_POINT, ENTRY_POINT);
    hover.pointerMove(FIRST_POINT);
    hover.pointerMove(OUTSIDE_POINT);
    hover.pointerMove(INSIDE_POINT);
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
    enterSubmenuFrom(hover, EXIT_POINT, ENTRY_POINT);
    hover.pointerMove(FIRST_POINT);
    hover.pointerMove(OUTSIDE_POINT);
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

    enterSubmenuFrom(hover, EXIT_POINT, ENTRY_POINT);
    hover.pointerMove(FIRST_POINT);
    hover.pointerMove(OUTSIDE_POINT);
    clock.advance(CLOSE_GRACE_MS);
    expect(hover.isClosePending()).toBe(false);
    expect(clock.tasks).toHaveLength(0);
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

test('вырожденный клин после промаха становится невырожденным и начинает защищать', () => {
  const { clock, hover } = setup();
  enterSubmenuFrom(hover, { x: 100, y: 50 }, { x: 100, y: 50.4 });
  hover.pointerMove({ x: 100, y: 200 });

  hover.pointerMove({ x: 400, y: 10 });
  expect(hover.isClosePending()).toBe(true);
  expect(clock.tasks).toHaveLength(1);
  expect(clock.tasks[0].time).toBe(clock.now() + CLOSE_GRACE_MS);

  // Промах стал вершиной, и клин (100, 50), (100, 50.4), (400, 10) площадью
  // 60 px² стал невырожденным: точка (150, 43.5) внутри него — кросс-продукты
  // -20, -50 и -50 одного знака, поэтому закрытие снимается. Против прежнего
  // вырожденного клина с вершиной (100, 200) она снаружи: знаки -20, -7480 и
  // 7500 разные, и закрытие осталось бы запланированным. Именно это и отличает
  // кейс от проверки одной лишь вырожденности.
  hover.pointerMove({ x: 150, y: 43.5 });

  expect(hover.isClosePending()).toBe(false);
  expect(clock.tasks).toHaveLength(0);
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
