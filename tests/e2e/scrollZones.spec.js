import { expect, test } from '@playwright/test';

// Модуль подгружается динамическим импортом прямо в странице, и спецификатор
// `../../src/scrollZones.js` обслуживает обе среды: в браузере от
// `http://127.0.0.1:4173/` он схлопывается до `/src/scrollZones.js` — корень
// сервера, — а TypeScript разрешает его от файла теста. Поэтому типы импорта
// берутся из исходника, без приведений.

/**
 * @typedef {import('../../src/scrollZones.js').ScrollZones} ScrollZones
 */

/**
 * Форма стенда: настоящие узлы с настоящей геометрией и ручной планировщик
 * кадров. Тип назван явно потому, что читают его кейсы из `page.evaluate`, где
 * выражения `typeof stand` из `mountStand` уже не видно: колбэк сериализуется
 * и выполняется в браузере, где выражений файла теста нет.
 *
 * @typedef {object} ScrollStand
 * @property {HTMLElement} level
 * @property {HTMLElement} up
 * @property {HTMLElement} down
 * @property {HTMLElement} list
 * @property {ScrollZones} zones
 * @property {(time: number) => void} flush прогоняет ровно один кадр, отдавая
 *   ему заданное время.
 * @property {() => boolean} pending есть ли кадр, ждущий своего `flush`.
 */

/**
 * Стойка по умолчанию: список втрое выше своей рамки, прокручивать есть куда.
 */
const STAND = { viewportHeight: 100, contentHeight: 1000 };

/**
 * Скорость стенда, px в секунду. Второй экземпляр значения из `mountStand`:
 * числа проверяются в браузере и вернуться в Node не могут, а ожидаемый сдвиг
 * должен считаться, а не выводиться на глаз.
 */
const STAND_SPEED_PX_PER_SEC = 100;

/**
 * Отметка времени первого кадра, мс. Не ноль: модуль держит `previous === 0`
 * признаком «время ещё не замерено», и кадр с нулевой отметкой от него не
 * отличился бы — следующий кадр решил бы, что время не замерено, и сдвиг
 * потерялся бы. Настоящий `requestAnimationFrame` отдаёт время от
 * `performance.now()` страницы, то есть тоже не ноль.
 */
const FIRST_FRAME_MS = 100;

/**
 * Шаг времени между кадрами стенда, мс.
 */
const FRAME_STEP_MS = 50;

/**
 * Сдвиг списка у настоящего `scrollTop`, px. Вспомогательное слагаемое, а не
 * результат кейса.
 */
const FRAME_STEP_PX = STAND_SPEED_PX_PER_SEC * FRAME_STEP_MS / 1000;

/**
 * Сверяет прочитанный `scrollTop` числом с допуском, а не ровно и не строкой.
 *
 * Значение приходит из движка, и то, как именно он представляет результат
 * целочисленной записи, — его дело, а не поведение контроллера: тот же стенд под
 * `.vc-menu` в firefox отдавал `5.2166…` вместо `5` из-за `scale(0.96)`. Допуск в
 * сотые доли пикселя на порядок меньше шага стенда в 5 px, поэтому ошибку шага он
 * по-прежнему видит, а округление представления перестаёт быть его ошибкой.
 *
 * @param {number} actual прочитанный `scrollTop`, px.
 * @param {number} expected ожидаемый сдвиг, px.
 * @param {string} name имя величины в сообщении об ошибке.
 * @returns {void}
 */
function expectPx(actual, expected, name) {
  expect(actual, name).toBeCloseTo(expected, 2);
}

/**
 * Ставит стенд: настоящие узлы с настоящей геометрией и ручной планировщик
 * кадров. Скролл здесь не подменён: `refresh` и `sync` читают настоящие
 * `scrollTop`, `clientHeight` и `scrollHeight`, а вот время шага задаётся руками —
 * иначе одинаковый сдвиг пришлось бы угадывать в трёх движках сразу.
 *
 * Скорость стенда 100 px в секунду, то есть 5 px за кадр при `dt` 50 мс: круглое
 * число, вокруг которого расхождение видно сразу.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ viewportHeight: number, contentHeight: number }} config
 * @returns {Promise<void>}
 */
async function mountStand(page, config) {
  await page.evaluate(async (options) => {
    const { createScrollZones } = await import('../../src/scrollZones.js');
    const host = document.createElement('div');
    host.style.cssText = 'position: absolute; top: 0; left: 0; width: 120px;';
    const up = document.createElement('div');
    up.className = 'vc-scroll-zone vc-scroll-zone-up';
    const down = document.createElement('div');
    down.className = 'vc-scroll-zone vc-scroll-zone-down';
    const list = document.createElement('div');
    list.style.cssText = `height: ${options.viewportHeight}px; overflow-y: auto;`;
    const filler = document.createElement('div');
    filler.style.cssText = `height: ${options.contentHeight}px;`;
    list.appendChild(filler);
    const level = document.createElement('div');
    // Класс `.vc-menu` стенду не нужен и вреден: он тянет за собой `position:
    // fixed` с шириной по содержимому, под которой прокручиваемый потомок в
    // трёх движках перестаёт быть прокручиваемым (`scrollHeight` сходится с
    // `clientHeight`, `scrollTop` не двигается), и `scale(0.96)`, из-за которого
    // firefox округляет `scrollTop` до своей сетки. Ни то, ни другое ничего не
    // говорит о контроллере; стенду нужна геометрия списка, а не вид меню.
    level.append(up, list, down);
    host.appendChild(level);
    document.body.appendChild(host);

    // Ровно один кадр в очереди: `requestFrame` зовётся только когда очередь пуста,
    // а `flush` забирает кадр до вызова, иначе кадр, поставленный самим `step`,
    // попал бы в тот же прогон и `flush` крутил бы цикл вечно.
    /** @type {((time: number) => void) | null} */
    let queued = null;
    /** @type {ScrollStand} */
    const stand = {
      level,
      up,
      down,
      list,
      zones: createScrollZones({
        list,
        level,
        up,
        down,
        speed: 100,
        /**
         * @param {(time: number) => void} callback
         * @returns {number}
         */
        requestFrame: (callback) => {
          queued = callback;
          return 1;
        },
        /**
         * @returns {void}
         */
        cancelFrame: () => {
          queued = null;
        },
      }),
      /**
       * Прогоняет ровно один кадр, отдавая ему заданное время.
       *
       * @param {number} time
       * @returns {void}
       */
      flush(time) {
        if (queued === null) {
          return;
        }
        const callback = queued;
        queued = null;
        callback(time);
      },
      /**
       * Есть ли кадр, ждущий своего `flush`.
       *
       * @returns {boolean}
       */
      pending: () => queued !== null,
    };
    const scope = /** @type {{ __stand?: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    scope.__stand = stand;
  }, config);
}

test.beforeEach(async ({ page }) => {
  // `goto` обязателен: без адреса у документа динамический импорт не разрешился бы,
  // и каждый кейс падал бы не по существу.
  await page.goto('/');
});

test('refresh снимает и возвращает признак прокручиваемости', async ({ page }) => {
  await mountStand(page, STAND);
  const overflown = await page.evaluate(() => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    const before = stand.level.hasAttribute('data-vc-scrollable');
    stand.zones.refresh();
    return {
      before,
      after: stand.level.hasAttribute('data-vc-scrollable'),
      overflow: stand.list.scrollHeight > stand.list.clientHeight,
    };
  });

  // Контроль: без перебора признак и не появился бы, и кейс прошёл бы вхолостую.
  expect(overflown.overflow).toBe(true);
  // До `refresh` решения нет: показ ставит признак сам и только один раз.
  expect(overflown.before).toBe(false);
  expect(overflown.after).toBe(true);

  await mountStand(page, { viewportHeight: 100, contentHeight: 100 });
  const exact = await page.evaluate(() => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    return {
      overflow: stand.list.scrollHeight > stand.list.clientHeight,
      scrollable: stand.level.hasAttribute('data-vc-scrollable'),
    };
  });

  // Высоты ровно в обрез: прокручивать некуда, и зоны показывать незачем.
  expect(exact.overflow).toBe(false);
  expect(exact.scrollable).toBe(false);
});

test('refresh гасит устаревший признак, оставшийся от прошлого показа', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate(() => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    // Прошлый показ: длинный список, прокрученный до конца, — уровень помечен
    // прокручиваемым, верхняя зона свободна, нижняя заблокирована.
    stand.list.scrollTop = stand.list.scrollHeight;
    stand.zones.refresh();
    const before = {
      scrollable: stand.level.hasAttribute('data-vc-scrollable'),
      up: stand.up.hasAttribute('data-vc-blocked'),
      down: stand.down.hasAttribute('data-vc-blocked'),
    };
    // Пунктов стало меньше, и список в обрез: перебора нет, а браузер зажал
    // `scrollTop` в ноль.
    stand.list.style.height = '1000px';
    stand.zones.refresh();
    return {
      before,
      after: {
        scrollable: stand.level.hasAttribute('data-vc-scrollable'),
        up: stand.up.hasAttribute('data-vc-blocked'),
        down: stand.down.hasAttribute('data-vc-blocked'),
      },
      overflow: stand.list.scrollHeight > stand.list.clientHeight,
    };
  });

  // Контроль: состояние прошлого показа было противоположным во всех трёх
  // признаках, иначе снятие проверялось бы на исходно верном состоянии.
  expect(result.before).toEqual({ scrollable: true, up: false, down: true });
  // Контроль: высота действительно застала перебор, иначе снятие признака было бы
  // следствием не того, что проверяется.
  expect(result.overflow).toBe(false);
  expect(result.after.scrollable).toBe(false);
  // `sync` зовётся и на уровне без перебора: иначе у верхней зоны остался бы
  // признак свободной от прошлого показа.
  expect(result.after.up).toBe(true);
  expect(result.after.down).toBe(true);
});

test('верхняя зона заблокирована в начале, нижняя свободна', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate(() => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    return {
      scrollTop: stand.list.scrollTop,
      up: stand.up.hasAttribute('data-vc-blocked'),
      down: stand.down.hasAttribute('data-vc-blocked'),
    };
  });

  expect(result.scrollTop).toBe(0);
  expect(result.up).toBe(true);
  expect(result.down).toBe(false);
});

test('нижняя зона заблокирована в конце, верхняя свободна', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate(() => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.list.scrollTop = stand.list.scrollHeight - stand.list.clientHeight;
    stand.zones.refresh();
    return {
      atBottom: stand.list.scrollTop === stand.list.scrollHeight - stand.list.clientHeight,
      up: stand.up.hasAttribute('data-vc-blocked'),
      down: stand.down.hasAttribute('data-vc-blocked'),
    };
  });

  // Контроль: список доехал до низа, иначе блокировка нижней зоны ничего не значила бы.
  expect(result.atBottom).toBe(true);
  expect(result.up).toBe(false);
  expect(result.down).toBe(true);
});

test('переполнение меньше пикселя гасит обе зоны', async ({ page }) => {
  await mountStand(page, { viewportHeight: 100, contentHeight: 100.5 });
  const result = await page.evaluate(() => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    return {
      overflowPx: stand.list.scrollHeight - stand.list.clientHeight,
      up: stand.up.hasAttribute('data-vc-blocked'),
      down: stand.down.hasAttribute('data-vc-blocked'),
    };
  });

  // Контроль: перебора меньше пикселя, и оба упора на расстоянии одного
  // неполного пикселя — ровно то, ради чего у порога снизу есть допуск: без него
  // нижняя зона осталась бы незаблокированной, хотя прокручивать больше некуда.
  expect(result.overflowPx).toBeLessThanOrEqual(1);
  expect(result.up).toBe(true);
  expect(result.down).toBe(true);
});

test('наведение на свободную зону запускает цикл, на заблокированную — нет', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate(() => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    stand.up.dispatchEvent(new PointerEvent('pointerenter'));
    const atTop = stand.pending();
    stand.list.scrollTop = stand.list.scrollHeight - stand.list.clientHeight;
    stand.zones.refresh();
    stand.up.dispatchEvent(new PointerEvent('pointerenter'));
    const atBottom = stand.pending();
    return { atTop, atBottom };
  });

  // Начало списка: до верхней зоны доскроллить некуда, и цикл не заводится.
  expect(result.atTop).toBe(false);
  // Середина: та же зона та же, а цикл уже идёт.
  expect(result.atBottom).toBe(true);
});

test('кадр сдвигает список на speed умноженное на dt', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate((frames) => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    /** @type {number[]} */
    const down = [];
    for (let frame = 0; frame < 3; frame += 1) {
      stand.flush(frames.first + frame * frames.step);
      down.push(stand.list.scrollTop);
    }
    // Тот же цикл вверх, с середины списка: сдвиг знаковый, а не только величины.
    stand.list.scrollTop = 450;
    stand.zones.refresh();
    stand.up.dispatchEvent(new PointerEvent('pointerenter'));
    stand.flush(frames.first);
    const upFirst = stand.list.scrollTop;
    stand.flush(frames.first + frames.step);
    return { down, upFirst, upSecond: stand.list.scrollTop };
  }, { first: FIRST_FRAME_MS, step: FRAME_STEP_MS });

  // Первый кадр только запоминает время: между постановкой цикла и первым кадром
  // проходит сколько угодно, и шагом это считать нельзя.
  expect(result.down[0]).toBe(0);
  expectPx(result.down[1], FRAME_STEP_PX, 'сдвиг вниз за кадр');
  expectPx(result.down[2], 2 * FRAME_STEP_PX, 'сдвиг вниз за два кадра');
  expect(result.upFirst).toBe(450);
  expectPx(result.upSecond, 450 - FRAME_STEP_PX, 'сдвиг вверх за кадр');
});

test('кадр без сдвига не останавливает цикл', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate((frames) => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    stand.flush(frames.first);
    // Кадр короче, чем один пиксель сдвига: округление даёт ноль, и двигать
    // список нечем. Вставать тут нечему — список стоит на месте по-настоящему,
    // а не потому, что шаг округлился в ноль.
    stand.flush(frames.first + frames.zero);
    const scrollTop = stand.list.scrollTop;
    const pending = stand.pending();
    // Контроль: цикл не просто держит кадр, а продолжает прокручивать.
    stand.flush(frames.first + frames.zero + frames.step);
    return {
      scrollTop,
      pending,
      pendingAfterStep: stand.pending(),
      scrollTopAfterStep: stand.list.scrollTop,
    };
  }, { first: FIRST_FRAME_MS, zero: 1, step: FRAME_STEP_MS });

  expect(result.scrollTop).toBe(0);
  expect(result.pending).toBe(true);
  expect(result.pendingAfterStep).toBe(true);
  expectPx(result.scrollTopAfterStep, FRAME_STEP_PX, 'сдвиг после кадра без сдвига');
});

test('цикл встаёт у упора', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate((frames) => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    let time = frames.first;
    let played = 0;
    while (stand.pending() && played < frames.limit) {
      time += frames.step;
      stand.flush(time);
      played += 1;
    }
    return {
      played,
      limit: frames.limit,
      pending: stand.pending(),
      atBottom: stand.list.scrollTop === stand.list.scrollHeight - stand.list.clientHeight,
      down: stand.down.hasAttribute('data-vc-blocked'),
    };
  }, { first: FIRST_FRAME_MS, step: 500, limit: 40 });

  // Контроль: цикл встал сам, а не упёрся в предел прогона.
  expect(result.played).toBeLessThan(result.limit);
  expect(result.atBottom).toBe(true);
  // Упор — вторая причина встать: список больше не движется, и кадров не осталось.
  expect(result.pending).toBe(false);
  expect(result.down).toBe(true);
});

test('цикл встаёт, когда список не двигается', async ({ page }) => {
  await mountStand(page, { viewportHeight: 100, contentHeight: 100 });
  const withoutOverflow = await page.evaluate(() => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    return {
      overflow: stand.list.scrollHeight > stand.list.clientHeight,
      pending: stand.pending(),
      scrollTop: stand.list.scrollTop,
    };
  });

  // Контроль: прокручивать некуда, иначе отсутствие цикла было бы дефектом.
  expect(withoutOverflow.overflow).toBe(false);
  // Список некуда вести, поэтому цикл не заводится вовсе, а не встаёт на первом же
  // кадре: пустой цикл ещё и мигал бы зоной.
  expect(withoutOverflow.pending).toBe(false);
  expect(withoutOverflow.scrollTop).toBe(0);

  // Второй стенд с настоящим перебором: цикл, дошедший до упора, следующего
  // кадра не ставит. Геометрия у стенда одна на страницу, поэтому она своя.
  await mountStand(page, STAND);
  const atStop = await page.evaluate((frames) => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    let time = frames.first;
    let played = 0;
    while (stand.pending() && played < frames.limit) {
      time += frames.step;
      stand.flush(time);
      played += 1;
    }
    return {
      played,
      limit: frames.limit,
      atBottom: stand.list.scrollTop === stand.list.scrollHeight - stand.list.clientHeight,
      pending: stand.pending(),
    };
  }, { first: FIRST_FRAME_MS, step: 500, limit: 40 });

  expect(atStop.played).toBeLessThan(atStop.limit);
  expect(atStop.atBottom).toBe(true);
  expect(atStop.pending).toBe(false);
});

test('уход курсора останавливает цикл', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate((frames) => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    // Середина списка: в начале верхняя зона заблокирована, цикл бы не завёлся,
    // и кейс проверял бы отказ запуска вместо остановки по уходу курсора.
    stand.list.scrollTop = 450;
    stand.zones.refresh();
    stand.up.dispatchEvent(new PointerEvent('pointerenter'));
    stand.flush(frames.first);
    const running = stand.pending();
    stand.up.dispatchEvent(new PointerEvent('pointerleave'));
    const afterLeave = stand.pending();
    stand.flush(frames.first + frames.step);
    return { running, afterLeave, scrollTop: stand.list.scrollTop };
  }, { first: FIRST_FRAME_MS, step: FRAME_STEP_MS });

  // Контроль: цикл шёл, иначе «остановить» было бы нечего.
  expect(result.running).toBe(true);
  // Курсор ушёл — кадра не осталось, и список больше не ползёт.
  expect(result.afterLeave).toBe(false);
  expectPx(result.scrollTop, 450, 'список на месте после ухода курсора');
});

test('stop останавливает цикл, destroy снимает слушатели', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate(async () => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    const running = stand.pending();
    stand.zones.stop();
    const afterStop = stand.pending();
    stand.zones.destroy();
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    const afterDestroy = stand.pending();
    // Четвёртый слушатель — `scroll` на самом списке: после `destroy` прокрутка
    // больше не обновляет зоны. Событие дожидается собственного прихода, чтобы
    // ответ «зон не изменилось» относился к состоянию после него.
    const settled = new Promise((resolve) => {
      stand.list.addEventListener('scroll', () => {
        resolve(undefined);
      }, { once: true });
    });
    stand.list.scrollTop = stand.list.scrollHeight - stand.list.clientHeight;
    await settled;
    const afterScroll = {
      atBottom: stand.list.scrollTop === stand.list.scrollHeight - stand.list.clientHeight,
      down: stand.down.hasAttribute('data-vc-blocked'),
    };
    stand.zones.refresh();
    return {
      running,
      afterStop,
      afterDestroy,
      afterScroll,
      afterRefresh: stand.level.hasAttribute('data-vc-scrollable'),
    };
  });

  // Контроль: цикл шёл, и `stop` его остановил — иначе дальнейшие `false`
  // ничего бы не доказывали.
  expect(result.running).toBe(true);
  expect(result.afterStop).toBe(false);
  // Слушателей нет: ни наведение, ни прокрутка списка контроллер больше не трогают.
  expect(result.afterDestroy).toBe(false);
  expect(result.afterScroll).toEqual({ atBottom: true, down: false });
  // `refresh` переживает `destroy`: пересчёт признака — работа с узлами, а не с
  // подпиской.
  expect(result.afterRefresh).toBe(true);
});

test('прокрутка списка сама обновляет зоны', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate(async () => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    const before = {
      up: stand.up.hasAttribute('data-vc-blocked'),
      down: stand.down.hasAttribute('data-vc-blocked'),
    };
    // Слушатель стенда ничего не решает: он только дожидается события, придя
    // после слушателя модуля, и тем доказывает, что состояние пересчитано им.
    const settled = new Promise((resolve) => {
      stand.list.addEventListener('scroll', () => {
        resolve(undefined);
      }, { once: true });
    });
    stand.list.scrollTop = stand.list.scrollHeight - stand.list.clientHeight;
    await settled;
    return {
      before,
      after: {
        up: stand.up.hasAttribute('data-vc-blocked'),
        down: stand.down.hasAttribute('data-vc-blocked'),
      },
    };
  });

  // Список прокрутили без `refresh` — так прокручивает touch и клавиатурный
  // роуминг, и зоны обязаны узнать об этом сами.
  expect(result.before).toEqual({ up: true, down: false });
  expect(result.after).toEqual({ up: false, down: true });
});
