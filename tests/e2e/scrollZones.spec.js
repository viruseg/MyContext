import { expect, test } from '@playwright/test';
import { SCROLL_SPEED_PX_PER_SEC } from '../../src/constants.js';

// Модуль подгружается динамическим импортом прямо в странице, и спецификатор
// `../../src/scrollZones.js` обслуживает обе среды: в браузере от
// `http://127.0.0.1:4173/` он схлопывается до `/src/scrollZones.js` — корень
// сервера, — а TypeScript разрешает его от файла теста. Поэтому типы импорта
// берутся из исходника, без приведений.

/**
 * @typedef {import('../../src/scrollZones.js').ScrollZones} ScrollZones
 */

/**
 * @typedef {import('../../src/scrollZones.js').ScrollZoneOptions} ScrollZoneOptions
 */

/**
 * Форма стенда: настоящие узлы с настоящей геометрией и ручной планировщик
 * кадров. Тип назван явно потому, что читают его кейсы из `page.evaluate`, где
 * выражения `typeof stand` из `mountStand` уже не видно: колбэк сериализуется
 * и выполняется в браузере, где выражений файла теста нет.
 *
 * @typedef {object} ScrollStand
 * @property {HTMLElement} host обёртка стенда: снимается целиком перед следующим.
 * @property {HTMLElement} level
 * @property {HTMLElement} up
 * @property {HTMLElement} down
 * @property {HTMLElement} list
 * @property {ScrollZones} zones
 * @property {(time: number) => void} flush прогоняет ровно один кадр, отдавая
 *   ему заданное время.
 * @property {() => boolean} pending есть ли кадр, ждущий своего `flush`.
 * @property {() => number} scheduled сколько кадров поставлено и ещё не
 *   отменено. Настоящий `requestAnimationFrame` держит в очереди столько
 *   callback'ов, сколько их поставили, и одна ячейка на стенде этого бы скрыла.
 */

/**
 * @typedef {object} StandConfig
 * @property {number} viewportHeight высота рамки списка, px.
 * @property {number} contentHeight высота наполнителя, px. Задаётся при сборке,
 *   поэтому каждый перебор требует своего стенда. Дробная высота даёт перебор
 *   в половину пикселя по раскладке, который `scrollHeight` округляет до целого:
 *   метрики раскладки всегда целые, и дробной геометрии стенд не даёт.
 * @property {number} [speed] скорость контроллера, px в секунду. Без неё модуль
 *   берёт `SCROLL_SPEED_PX_PER_SEC`, и это отдельная проверяемая ветка.
 * @property {boolean} [liveFrames] не подменять планировщик: цикл пойдёт на
 *   настоящем `requestAnimationFrame`, и `flush` станет нечем гонять.
 * @property {boolean} [scaled] поставить на уровень `transform: scale(0.96)`,
 *   как у живого меню. Геометрию списка трансформ не меняет, поэтому держится
 *   он ради одной проверки: пороги контроллера должны пережить именно тот
 *   трансформ, который ставит `.vc-menu`.
 */

/**
 * Скорость стенда, px в секунду. Задаётся стенду через `config` и оттуда же
 * считается ожидаемый сдвиг, поэтому значение живёт в файле в одном экземпляре,
 * а ожидаемое число выводится из него, а не выписывается на глаз.
 */
const STAND_SPEED_PX_PER_SEC = 100;

/**
 * Стойка по умолчанию: список втрое выше своей рамки, прокручивать есть куда.
 */
const STAND = { viewportHeight: 100, contentHeight: 1000, speed: STAND_SPEED_PX_PER_SEC };

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
 * Сверяет прочитанный `scrollTop` числом с допуском, а не ровно.
 *
 * Значение приходит из движка, и то, как именно он представляет результат
 * записи, — его дело, а не поведение контроллера: под `scale(0.96)` firefox
 * округляет `scrollTop` до своей сетки и отдаёт `5.2166…` вместо `5` (замерено
 * пробой). Допуск виден только тем величинам, которые на порядок больше него,
 * поэтому ошибку расчёта он по-прежнему ловит, а округление представления
 * перестаёт быть ошибкой расчёта. Собой стенда без трансформа читается целым
 * числом во всех трёх движках, так что на практике допуск ничего не ослабляет.
 *
 * @param {number} actual прочитанная величина, px.
 * @param {number} expected ожидаемая величина, px.
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
 * число, вокруг которого расхождение видно сразу. Задаётся она через `config`,
 * иначе скорость стенда жила бы в двух экземплярах — в браузере и в ожидаемом
 * числе.
 *
 * Стенд намеренно собран без класса `.vc-menu`, а значит без `transform:
 * scale(0.96)`, который задаёт живое меню. Отсюда следствие, нужное кейсам:
 * `scrollTop` стенда — целое число, поэтому большинство проверок смотрит на него
 * точно. Масштаб надевается отдельно, флагом `scaled`, и держится только там, где
 * важно убедиться, что пороги контроллера стоят под тем самым трансформом.
 *
 * Дробной геометрии стенд не даёт и обещать не может: `clientHeight` и
 * `scrollHeight` — целые метрики раскладки, `transform` на них не влияет. Окно в
 * 1 px у низа добывается поэтому не геометрией, а записью `scrollTop` в доли
 * пикселя.
 *
 * Прежний стенд снимается целиком: иначе его разметка и пять его слушателей
 * дожили бы до конца кейса, а второй вызов в том же кейсе только стёр бы ссылку
 * на него.
 *
 * @param {import('@playwright/test').Page} page
 * @param {StandConfig} config
 * @returns {Promise<void>}
 */
async function mountStand(page, config) {
  await page.evaluate(async (options) => {
    const { createScrollZones } = await import('../../src/scrollZones.js');
    const scope = /** @type {{ __stand?: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    scope.__stand?.host.remove();
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
    // `clientHeight`, `scrollTop` не двигается). Ничего общего с контроллером это
    // не имеет: стенду нужна геометрия списка, а не вид меню.
    if (options.scaled === true) {
      // Масштаб живого меню, а не источник дробной геометрии: `clientHeight` и
      // `scrollHeight` — целые метрики раскладки, и трансформ их не меняет. Нужен
      // он одному кейсу — убедиться, что пороги контроллера переживают тот самый
      // `transform: scale(0.96)`, который ставит `.vc-menu`, вместе с округлением
      // `scrollTop`, которое под ним делает firefox.
      level.style.transform = 'scale(0.96)';
    }
    level.append(up, list, down);
    host.appendChild(level);
    document.body.appendChild(host);

    // Очередь кадров, а не одна ячейка: настоящий `requestAnimationFrame` держит
    // столько callback'ов, сколько ему поставили, и стенд с ячейкой терял бы
    // вторую постановку вместо того, чтобы её показать. `flush` по-прежнему
    // прогоняет ровно один кадр — самый старый.
    /** @type {Map<number, (time: number) => void>} */
    const frames = new Map();
    let lastHandle = 0;
    /** @type {ScrollZoneOptions} */
    const zonesOptions = {
      list,
      level,
      up,
      down,
      /**
       * @param {(time: number) => void} callback
       * @returns {number}
       */
      requestFrame: (callback) => {
        lastHandle += 1;
        frames.set(lastHandle, callback);
        return lastHandle;
      },
      /**
       * @param {number} handle
       * @returns {void}
       */
      cancelFrame: (handle) => {
        frames.delete(handle);
      },
    };
    // Скорость попадает в опции только когда её задали: умолчание модуля — это
    // отдельный путь, и подстановка константы здесь закрыла бы его навсегда.
    if (typeof options.speed === 'number') {
      zonesOptions.speed = options.speed;
    }
    if (options.liveFrames === true) {
      // Живые кадры вместо ручных: подмену снимаем целиком, и модуль берёт свои
      // умолчания — `globalThis.requestAnimationFrame` и `cancelAnimationFrame`.
      delete zonesOptions.requestFrame;
      delete zonesOptions.cancelFrame;
    }
    /** @type {ScrollStand} */
    const stand = {
      host,
      level,
      up,
      down,
      list,
      zones: createScrollZones(zonesOptions),
      /**
       * Прогоняет ровно один кадр, отдавая ему заданное время.
       *
       * @param {number} time
       * @returns {void}
       */
      flush(time) {
        for (const [handle, callback] of frames) {
          frames.delete(handle);
          callback(time);
          return;
        }
      },
      /**
       * Есть ли кадр, ждущий своего `flush`.
       *
       * @returns {boolean}
       */
      pending: () => frames.size > 0,
      /**
       * Сколько кадров поставлено и ещё не отменено.
       *
       * @returns {number}
       */
      scheduled: () => frames.size,
    };
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

  await mountStand(page, { viewportHeight: 100, contentHeight: 100, speed: STAND_SPEED_PX_PER_SEC });
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

test('refresh останавливает цикл, когда перебора нет', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate(() => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    const running = stand.pending();
    // Пунктов стало меньше, и список в обрез: перебора нет, а цикл ещё жив.
    stand.list.style.height = '1000px';
    stand.zones.refresh();
    const afterShrink = {
      pending: stand.pending(),
      scrollable: stand.level.hasAttribute('data-vc-scrollable'),
    };
    // Пункты вернулись, и цикл снова заводится: `refresh` на прокручиваемом
    // уровне трогать его не должен, иначе пересчёт гасил бы прокрутку на каждом
    // показе.
    stand.list.style.height = '100px';
    stand.zones.refresh();
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    const restarted = stand.pending();
    stand.zones.refresh();
    return {
      running,
      afterShrink,
      scrollable: stand.level.hasAttribute('data-vc-scrollable'),
      restarted,
      pendingAfterRefresh: stand.pending(),
    };
  });

  // Контроль: цикл был жив, иначе остановка ничего бы не значила.
  expect(result.running).toBe(true);
  // Перебора нет — и цикл встал, а не остался висеть на несуществующем списке.
  expect(result.afterShrink.scrollable).toBe(false);
  expect(result.afterShrink.pending).toBe(false);
  // Контроль: пересчёт на прокручиваемом уровне цикл не трогает.
  expect(result.scrollable).toBe(true);
  expect(result.restarted).toBe(true);
  expect(result.pendingAfterRefresh).toBe(true);
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
  // Первый стенд: наполнитель 100.5 px при рамке 100 px, то есть перебор в
  // половину пикселя по раскладке. `scrollHeight` округляет его до целого, и по
  // метрикам перебор выглядит полным пикселем — ровно то расстояние, на котором
  // без допуска нижняя зона осталась бы свободной, хотя прокручивать некуда.
  await mountStand(page, { viewportHeight: 100, contentHeight: 100.5, speed: STAND_SPEED_PX_PER_SEC });
  const plain = await page.evaluate(() => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    return {
      overflowPx: stand.list.scrollHeight - stand.list.clientHeight,
      integral: Number.isInteger(stand.list.clientHeight) && Number.isInteger(stand.list.scrollHeight),
      up: stand.up.hasAttribute('data-vc-blocked'),
      down: stand.down.hasAttribute('data-vc-blocked'),
    };
  });

  // Контроль: перебор есть и не больше пикселя, и оба упора на его расстоянии.
  expect(plain.overflowPx).toBeGreaterThan(0);
  expect(plain.overflowPx).toBeLessThanOrEqual(1);
  // Контроль: метрики раскладки целые. Стенд не даёт дробной геометрии, и
  // закреплено это здесь явно, чтобы никто не построил на ней ожиданий.
  expect(plain.integral).toBe(true);
  expect(plain.up).toBe(true);
  expect(plain.down).toBe(true);

  // Второй стенд: тот же перебор под живым `transform: scale(0.96)`. Трансформ не
  // меняет метрики раскладки, поэтому вердикт зон обязан совпасть, а уровень по
  // контракту остаться помеченным прокручиваемым: «видно, но крутить некуда».
  await mountStand(page, {
    viewportHeight: 100,
    contentHeight: 100.5,
    speed: STAND_SPEED_PX_PER_SEC,
    scaled: true,
  });
  const scaled = await page.evaluate(() => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    stand.zones.refresh();
    return {
      overflowPx: stand.list.scrollHeight - stand.list.clientHeight,
      scrollable: stand.level.hasAttribute('data-vc-scrollable'),
      up: stand.up.hasAttribute('data-vc-blocked'),
      down: stand.down.hasAttribute('data-vc-blocked'),
    };
  });

  // Контроль: под трансформом перебор тот же и зоны погашены так же, а уровень
  // помечен прокручиваемым — по строгому порогу `refresh`, в отличие от зон, и
  // это плата за допуск, названная в спецификации.
  expect(scaled.overflowPx).toBeGreaterThan(0);
  expect(scaled.overflowPx).toBeLessThanOrEqual(1);
  expect(scaled.scrollable).toBe(true);
  expect(scaled.up).toBe(true);
  expect(scaled.down).toBe(true);
});

test('допуск у низа в 1 px: зона гаснет за пиксель, и цикл встаёт по ней', async ({ page }) => {
  // Окно в 1 px добывается не геометрией стенда, а записью `scrollTop` в доли
  // пикселя: дробной геометрии стенд не даёт, а под `scale(0.96)` firefox
  // округляет запись вниз на величину до 0.43 px (замерено: 899.4 читается как
  // 898.967), и масштабированный стенд мерил бы округление движка, а не порог
  // контроллера. Без трансформа окно воспроизводится одинаково во всех трёх
  // движках, и в нём допуск виден буквально: строгий порог «до самого низа» на
  // нём не срабатывает.
  await mountStand(page, STAND);
  const result = await page.evaluate((frames) => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    const maxScroll = stand.list.scrollHeight - stand.list.clientHeight;
    // За 0.6 px до низа: строгий порог ещё не выполнен, а прокручивать больше
    // некуда, и наведение на зону упиралось бы в стену.
    stand.list.scrollTop = maxScroll - 0.6;
    stand.zones.refresh();
    const tolerance = {
      travel: maxScroll - stand.list.scrollTop,
      strictBottom: stand.list.scrollTop + stand.list.clientHeight >= stand.list.scrollHeight,
      up: stand.up.hasAttribute('data-vc-blocked'),
      down: stand.down.hasAttribute('data-vc-blocked'),
    };
    // Первая причина встать: цикл, дошедший до низа, встаёт по заблокированной
    // зоне, а не по неподвижному списку. За четыре с половиной пикселя до низа
    // зона ещё свободна, и один кадр в 5 px её дожимает — сдвиг при этом
    // остаётся, и второй признак упора молчит.
    stand.list.scrollTop = maxScroll - 4.6;
    stand.zones.refresh();
    const free = !stand.down.hasAttribute('data-vc-blocked');
    const before = stand.list.scrollTop;
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    const started = stand.pending();
    stand.flush(frames.first);
    stand.flush(frames.first + frames.step);
    return {
      tolerance,
      free,
      started,
      before,
      moved: stand.list.scrollTop,
      landed: maxScroll - stand.list.scrollTop,
      pending: stand.pending(),
      down: stand.down.hasAttribute('data-vc-blocked'),
    };
  }, { first: FIRST_FRAME_MS, step: FRAME_STEP_MS });

  // Контроль: до низа остался неполный пиксель, и низа строго не достигнуто —
  // без допуска зона осталась бы свободной.
  expect(result.tolerance.travel).toBeGreaterThan(0);
  expect(result.tolerance.travel).toBeLessThanOrEqual(1);
  expectPx(result.tolerance.travel, 1, 'остаток пути до низа');
  expect(result.tolerance.strictBottom).toBe(false);
  // Допуск сработал вниз и не перекрыл верх: список в середине, до верха далеко.
  expect(result.tolerance.down).toBe(true);
  expect(result.tolerance.up).toBe(false);
  // Контроль: за четыре с половиной пикселя до низа зона свободна, и цикл
  // завёлся, иначе встать было бы нечему.
  expect(result.free).toBe(true);
  expect(result.started).toBe(true);
  // Сдвиг состоялся — значит, второй признак упора молчал, и встать могла только
  // заблокированная зона.
  expect(result.moved).toBeGreaterThan(result.before);
  expectPx(result.landed, 0, 'остаток пути после зажима');
  expect(result.pending).toBe(false);
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

test('повторный вход в зону не оставляет второго кадра', async ({ page }) => {
  await mountStand(page, STAND);
  const result = await page.evaluate((frames) => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    // Середина списка: обе зоны свободны, иначе переход нечего было бы проверять.
    stand.list.scrollTop = 450;
    stand.zones.refresh();
    const zonesFree = {
      up: !stand.up.hasAttribute('data-vc-blocked'),
      down: !stand.down.hasAttribute('data-vc-blocked'),
    };
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    stand.flush(frames.first);
    const running = stand.pending();
    const whileDown = stand.scheduled();
    // Курсор перешёл на верхнюю зону, а цикл вниз ещё жив. Без отмены висело бы
    // два кадра: настоящий `requestAnimationFrame` поставил бы вторую цепочку, и
    // список поехал бы вдвое быстрее.
    stand.up.dispatchEvent(new PointerEvent('pointerenter'));
    const afterReentry = stand.scheduled();
    // Первый кадр нового цикла только запоминает время, поэтому движение видно
    // только на втором: переход обязан сменить направление, а не замереть.
    stand.flush(frames.first + frames.step);
    const afterFirstFrame = stand.list.scrollTop;
    stand.flush(frames.first + 2 * frames.step);
    return {
      zonesFree,
      running,
      whileDown,
      afterReentry,
      afterFirstFrame,
      afterSecondFrame: stand.list.scrollTop,
    };
  }, { first: FIRST_FRAME_MS, step: FRAME_STEP_MS });

  // Контроль: обе зоны свободны, и цикл вниз был жив с ровно одним кадром.
  expect(result.zonesFree).toEqual({ up: true, down: true });
  expect(result.running).toBe(true);
  expect(result.whileDown).toBe(1);
  // Контроль: после перехода кадр тоже один — второго не появилось.
  expect(result.afterReentry).toBe(1);
  // Переход сменил направление: список поехал вверх, и поехал на один шаг.
  expect(result.afterFirstFrame).toBe(450);
  expect(result.afterSecondFrame).toBe(450 - FRAME_STEP_PX);
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

test('скорость по умолчанию — SCROLL_SPEED_PX_PER_SEC', async ({ page }) => {
  // Константа закреплена числом: она и есть контракт скорости для всех меню
  // библиотеки, и без закрепления она одинаково съехала бы в сторону вместе со
  // всем остальным.
  expect(SCROLL_SPEED_PX_PER_SEC).toBe(240);

  // Скорость не задана: контроллер обязан взять свою, а не стендовую.
  await mountStand(page, { viewportHeight: 100, contentHeight: 1000 });
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
    return { down, travel: stand.list.scrollHeight - stand.list.clientHeight };
  }, { first: FIRST_FRAME_MS, step: FRAME_STEP_MS });

  // Контроль: список прокручиваем, иначе шагу некуда было бы дойти.
  expect(result.travel).toBe(900);
  // Первый кадр не сдвигает, дальше — 240 px в секунду, то есть 12 px за кадр при
  // `dt` 50 мс. Ровно вдвое больше стендовых 5 px: стендовая скорость сюда не
  // подставляется, иначе кейс прошёл бы на подставленном значении.
  expect(result.down[0]).toBe(0);
  expectPx(result.down[1], SCROLL_SPEED_PX_PER_SEC * FRAME_STEP_MS / 1000, 'сдвиг за кадр по умолчанию');
  expectPx(result.down[2], 2 * SCROLL_SPEED_PX_PER_SEC * FRAME_STEP_MS / 1000, 'сдвиг за два кадра по умолчанию');
});

test('без подмены кадров цикл идёт на настоящем requestAnimationFrame и stop его отменяет', async ({ page }) => {
  // Живые кадры — единственное место в файле, где результат зависит от того, как
  // браузер ведёт себя во времени. Если `requestAnimationFrame` для активной
  // страницы когда-нибудь приостановят, кейс обязан висеть дольше, а не падать
  // без диагностики.
  test.slow();
  // Ни скорости, ни планировщика: оба умолчания модуля должны работать сами.
  await mountStand(page, { viewportHeight: 100, contentHeight: 1000, liveFrames: true });
  const result = await page.evaluate(async () => {
    const scope = /** @type {{ __stand: ScrollStand }} */ (/** @type {unknown} */ (globalThis));
    const stand = scope.__stand;
    // Счётчики на самих глобалах: функции остаются умолчаниями модуля, мы только
    // видим, что зовутся именно они.
    const rawRequest = globalThis.requestAnimationFrame;
    const rawCancel = globalThis.cancelAnimationFrame;
    let requested = 0;
    let cancelled = 0;
    globalThis.requestAnimationFrame = (callback) => {
      requested += 1;
      return rawRequest.call(globalThis, callback);
    };
    globalThis.cancelAnimationFrame = (handle) => {
      cancelled += 1;
      rawCancel.call(globalThis, handle);
    };
    stand.list.scrollTop = 450;
    stand.zones.refresh();
    stand.down.dispatchEvent(new PointerEvent('pointerenter'));
    const scheduled = requested;
    const before = stand.list.scrollTop;
    // Живые часы вместо стендовых: ждём самого движения, но не его величины.
    // Дедлайн в 10 с — около шестисот кадров: хватает и подтормаживания, и
    // совсем остановленных кадров, после которых кейс честно падает на
    // `requestedWhileRunning`, а не молча уезжает в вечное ожидание.
    const deadline = performance.now() + 10000;
    while (stand.list.scrollTop === before && performance.now() < deadline) {
      await new Promise((resolve) => {
        rawRequest.call(globalThis, () => { resolve(undefined); });
      });
    }
    const moved = stand.list.scrollTop;
    const requestedWhileRunning = requested;
    stand.zones.stop();
    const cancelledByStop = cancelled;
    for (let frame = 0; frame < 5; frame += 1) {
      await new Promise((resolve) => {
        rawRequest.call(globalThis, () => { resolve(undefined); });
      });
    }
    const afterStop = stand.list.scrollTop;
    globalThis.requestAnimationFrame = rawRequest;
    globalThis.cancelAnimationFrame = rawCancel;
    return { scheduled, requestedWhileRunning, cancelledByStop, before, moved, afterStop };
  });

  // Контроль: цикл пошёл по живым кадрам и увёл список. Единичного кадра
  // недостаточно — цикл обязан переставлять себя, иначе это не цикл.
  expect(result.scheduled).toBeGreaterThanOrEqual(1);
  expect(result.requestedWhileRunning).toBeGreaterThan(result.scheduled);
  expect(result.moved).toBeGreaterThan(result.before);
  // `stop` отменил живой кадр, который висел на этот момент.
  expect(result.cancelledByStop).toBe(1);
  expect(result.afterStop).toBe(result.moved);
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
  await mountStand(page, { viewportHeight: 100, contentHeight: 100, speed: STAND_SPEED_PX_PER_SEC });
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
  // кадра не ставит. Стенд нужен второй, а не перестроенный: высота
  // наполнителя задаётся при сборке, и на стенде без перебора её не отрастить.
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
