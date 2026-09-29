import { expect, test } from '@playwright/test';
import {
  DEFAULT_ANIMATION_DURATION,
  SCROLL_SPEED_PX_PER_SEC,
  SCROLL_ZONE_HEIGHT,
} from '../../src/constants.js';

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
 * Допуск терпит ошибку чтения и ничего кроме неё: `toBeCloseTo(expected, 2)`
 * прощает 0.005 px, круглые числа стенда он не трогает, а ошибку расчёта шага
 * по-прежнему ловит. Масштаб сюда не входит: под `scale(0.96)` firefox округляет
 * `scrollTop` до своей сетки и отдаёт `5.2166…` вместо `5` (замерено пробой), и
 * такой величине 0.005 недоступны. Поэтому масштабированный стенд меряется целыми
 * метриками раскладки и признаками, а сдвиг под ним `expectPx` не сверяет вовсе.
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

test('цикл не заводится, когда списку некуда двигаться', async ({ page }) => {
  await mountStand(page, { viewportHeight: 100, contentHeight: 100, speed: STAND_SPEED_PX_PER_SEC });
  const result = await page.evaluate(() => {
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
  expect(result.overflow).toBe(false);
  // Список некуда вести, поэтому цикл не заводится вовсе, а не встаёт на первом же
  // кадре: пустой цикл ещё и мигал бы зоной.
  expect(result.pending).toBe(false);
  expect(result.scrollTop).toBe(0);
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

/* ── Живое меню ──────────────────────────────────────────────────────────────
 *
 * Кейсы ниже водят настоящий `MyContext` настоящей мышью: курсор двигают
 * `locator.hover` и `page.mouse.wheel`, а список крутит `requestAnimationFrame`
 * страницы. Стенд выше для этого не годится и не переиспользуется: подмена
 * планировщика кадров и подмена геометрии нужны там, где проверяется решение
 * контроллера, а здесь проверяется меню целиком — с настоящей раскладкой,
 * настоящими отметками роуминга и настоящей подпиской слоя.
 */

/**
 * Вьюпорт живых кейсов. Задан фикстурой `describe`, а не вызовом в `beforeEach`, и
 * почему — там же.
 */
const LIVE_VIEWPORT = { width: 1000, height: 700 };

/**
 * Имена слотов живых экземпляров: их два, и второй нужен ровно одному кейсу.
 *
 * @typedef {'first' | 'second'} LiveSlot
 */

/**
 * Живой экземпляр меню, поставленный в страницу кейса.
 *
 * @typedef {object} LiveMenu
 * @property {import('../../src/MyContext.js').MyContext} menu
 * @property {HTMLElement} trigger кнопка, привязанная к меню.
 */

/**
 * @typedef {object} LiveMenus
 * @property {LiveMenu} [first]
 * @property {LiveMenu} [second]
 */

/**
 * Доступные имена живых уровней. Имя задаёт конструктор, и по нему же уровень
 * узнаётся на странице: `data-vc-scrollable` общий для всех `.vc-menu` и берётся
 * селектором, поэтому «у первого уровня признак есть» говорит о конкретном
 * поповере, а не о первом найденном меню.
 *
 * @type {Record<LiveSlot, string>}
 */
const LIVE_LABELS = {
  first: 'Меню пробы: первое',
  second: 'Меню пробы: второе',
};

/**
 * Площадки слотов на странице: своя у каждого, в стороне от второго.
 *
 * Фиксированные и у самой кромки — по двум причинам. Первая: два экземпляра на
 * одной кнопке не отличились бы друг от друга ни при показе, ни при наведении.
 * Вторая: `focus()` на кнопке вне кадра прокрутил бы страницу, а прокрутка
 * страницы закрывает открытое меню, и кейс про зоны падал бы не по существу.
 *
 * @type {Record<LiveSlot, string>}
 */
const LIVE_HOSTS = {
  first: 'position: fixed; left: 16px; top: 8px;',
  second: 'position: fixed; left: 560px; top: 8px;',
};

/**
 * Точки вызова живых меню: у каждого слота своя, в стороне от второго, — иначе
 * верхнее меню в Top Layer перехватывало бы наведение нижнего.
 *
 * @type {Record<LiveSlot, import('../../src/layer.js').Point>}
 */
const LIVE_POINTS = {
  first: { x: 120, y: 200 },
  second: { x: 700, y: 200 },
};

const LIST = '.vc-list';
const ZONE_UP = '.vc-scroll-zone-up';
const ZONE_DOWN = '.vc-scroll-zone-down';
const ITEM = '.vc-item';

/**
 * Пауза, которой ждут, когда проверяют не движение, а его отсутствие. Тройная
 * длительность анимации — срок, за который меню успело бы сменить состояние и
 * вернуть его обратно: короче пауза прошла бы на быстрой машине и упала на
 * медленной.
 */
const SETTLE_MS = DEFAULT_ANIMATION_DURATION * 3;

/**
 * Предел ожидания живой прокрутки, мс. Скорость 240 px в секунду, длина прокрутки
 * у сорока пунктов около 480 px, то есть путь занимает две секунды; десять секунд
 * — запас на подтормаживание машины, после которого кейс честно падает, а не
 * молча висит.
 */
const SCROLL_WAIT_MS = 10000;

/**
 * Описание набора пунктов, а не сам набор.
 *
 * Пункты заводятся в странице: подпись пункта — функция, а `page.evaluate` не
 * везёт функции в аргумент. Вместо набора едет его форма, а страница собирает
 * пункты сама.
 *
 * @typedef {object} ItemShape
 * @property {'long' | 'short'} kind длина набора.
 * @property {string} prefix начало подписи пункта. Различает экземпляры: им
 *   помечены подписи, а имя уровня берётся из конструктора, так что страница
 *   различает меню самостоятельно.
 */

/**
 * Ставит в страницу живой экземпляр `MyContext` под указанным слотом, оставляя
 * ручку в `globalThis`.
 *
 * `reduce` убирает и входной переход `scale`, и отложенное закрытие: под ним
 * показ синхронен, то есть рамки зон, снятые сразу после `open()`, суть рамки
 * показанного меню. Тем же режимом снимается `transform: scale(0.96)` у самого
 * меню, и геометрия зон остаётся неискажённой масштабом.
 *
 * Экземпляр намеренно не открывается: показом занимается кейс, и каждый открывает
 * его в своей точке сам, а второй слот и вовсе остаётся закрытым до своего кейса.
 *
 * @param {import('@playwright/test').Page} page
 * @param {LiveSlot} slot
 * @param {ItemShape} shape форма набора.
 * @returns {Promise<void>}
 */
async function mountLiveMenu(page, slot, shape) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async (input) => {
    const { MyContext } = await import('../../src/MyContext.js');
    /** @type {import('../../src/renderer.js').MenuItem[]} */
    const items = input.shape.kind === 'short'
      ? ['Раз', 'Два', 'Три'].map((text) => {
        return { labelAction: () => text };
      })
      : Array.from({ length: 40 }, (unused, index) => {
        return { labelAction: () => `${input.shape.prefix} ${index + 1}` };
      });
    const host = document.createElement('div');
    host.id = `live-host-${input.slot}`;
    host.style.cssText = input.host;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = `live-trigger-${input.slot}`;
    host.appendChild(trigger);
    document.body.appendChild(host);
    const menu = new MyContext(items, { label: input.label });
    menu.attach(trigger);
    trigger.focus();
    const scope = /** @type {{ __live?: LiveMenus }} */ (/** @type {unknown} */ (globalThis));
    const menus = scope.__live ?? {};
    menus[input.slot] = { menu, trigger };
    scope.__live = menus;
  }, { slot, shape, host: LIVE_HOSTS[slot], label: LIVE_LABELS[slot] });
}

/**
 * Открывает поставленное живое меню в точке вызова.
 *
 * @param {import('@playwright/test').Page} page
 * @param {LiveSlot} slot
 * @param {import('../../src/layer.js').Point} point
 * @returns {Promise<void>}
 */
async function openLiveMenu(page, slot, point) {
  await page.evaluate((input) => {
    const scope = /** @type {{ __live?: LiveMenus }} */ (/** @type {unknown} */ (globalThis));
    const live = scope.__live?.[input.slot];
    if (live === undefined) {
      throw new Error(`живое меню слота «${input.slot}» не поставлено`);
    }
    live.menu.open(input.point);
  }, { slot, point });
}

/**
 * Идентификатор показанного уровня слота.
 *
 * По доступному имени, а не по порядку показа в документе: уровень переносится в
 * конец `<body>` на каждом показе, и порядок DOM у двух открытых меню говорил бы
 * о последнем показе, а не о слоте.
 *
 * @param {import('@playwright/test').Page} page
 * @param {LiveSlot} slot
 * @returns {Promise<string>}
 */
function liveLevelIdOf(page, slot) {
  return page.evaluate((name) => {
    // По поповеру, а не по `document.querySelector('.vc-menu')`: закрытый уровень
    // остаётся в документе, и селектор без `:popover-open` взял бы его наравле с
    // показанным.
    for (const candidate of document.querySelectorAll('.vc-menu:popover-open')) {
      if (candidate.getAttribute('aria-label') === name) {
        return candidate.id;
      }
    }
    throw new Error(`на странице нет показанного уровня «${name}»`);
  }, LIVE_LABELS[slot]);
}

/**
 * Снимок уровня: всё, о чём судит живой кейс, одним проходом по странице.
 *
 * `scrollTop` читается, но не сверяется с ожидаемой величиной: список поедет на
 * столько, сколько успеет за время наведения, и под `scale(0.96)` firefox
 * округляет запись в `scrollTop` примерно на 4 % быстрее скорости контроллера —
 * точное число мерило бы округление движка, а не поведение. Поэтому «поехал» и
 * «доехал» читаются как знак и как положение упора, а не как пиксели.
 *
 * @typedef {object} LiveSnapshot
 * @property {boolean} open показан ли уровень сейчас.
 * @property {string} opacity вычисленная прозрачность уровня: у закрытого меню она
 *   ноль, и это единственное, чем закрытое меню спрятано — авторское
 *   `display: flex` перебивает UA-правило `[popover]:not(:popover-open)`, и рамка у
 *   закрытого уровня остаётся.
 * @property {string | null} scrollable значение `data-vc-scrollable` на уровне:
 *   пустая строка у прокручиваемого уровня, `null` у короткого.
 * @property {boolean} overflow переполняется ли список. Контрольное поле: у
 *   списка, который не прокручивается, и зоны, и прокрутка молчат.
 * @property {number} scrollTop сдвиг списка, px.
 * @property {number} travel сколько список способен прокрутиться, px.
 * @property {boolean} atBottom доехал ли список до низа по порогу самого
 *   контроллера: `scrollTop + clientHeight` не меньше `scrollHeight` минус его
 *   допуск в 1 px.
 * @property {{ up: string, down: string }} displays вычисленный `display` зон.
 * @property {{ up: number, down: number }} zoneHeights высота зон по рамке, px: у
 *   скрытой зоны ноль, потому что в `display: none` она не занимает места.
 * @property {{ up: boolean, down: boolean }} blocked признак `data-vc-blocked` на
 *   зонах. Единственный его писатель — `sync()` внутри `src/scrollZones.js`.
 * @property {string[]} activeLabels подписи пунктов, помеченных `data-active`, по
 *   всему документу, а не по уровню: сброс выделения обещает снять отметки со всех
 *   уровней, и уцелевшая отметка в соседнем меню была бы тем же дефектом.
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} levelId
 * @returns {Promise<LiveSnapshot>}
 */
function readLive(page, levelId) {
  return page.evaluate((id) => {
    const level = document.getElementById(id);
    if (level === null) {
      throw new Error(`на странице нет уровня ${id}`);
    }
    const list = level.querySelector('.vc-list');
    if (list === null) {
      throw new Error(`у уровня ${id} нет списка`);
    }
    /**
     * @param {string} selector класс зоны.
     * @returns {{ display: string, height: number, blocked: boolean }}
     */
    const zone = (selector) => {
      const element = level.querySelector(selector);
      if (element === null) {
        throw new Error(`у уровня ${id} нет зоны ${selector}`);
      }
      return {
        display: getComputedStyle(element).display,
        height: element.getBoundingClientRect().height,
        blocked: element.hasAttribute('data-vc-blocked'),
      };
    };
    const up = zone('.vc-scroll-zone-up');
    const down = zone('.vc-scroll-zone-down');
    return {
      open: level.matches(':popover-open'),
      opacity: getComputedStyle(level).opacity,
      scrollable: level.getAttribute('data-vc-scrollable'),
      overflow: list.scrollHeight > list.clientHeight,
      scrollTop: list.scrollTop,
      travel: list.scrollHeight - list.clientHeight,
      atBottom: list.scrollTop + list.clientHeight >= list.scrollHeight - 1,
      displays: { up: up.display, down: down.display },
      zoneHeights: { up: up.height, down: down.height },
      blocked: { up: up.blocked, down: down.blocked },
      activeLabels: Array.from(document.querySelectorAll('.vc-item[data-active]'), (item) => {
        const label = item.querySelector('.vc-label');
        return label === null ? '' : label.textContent ?? '';
      }),
    };
  }, levelId);
}

/**
 * Ставит список живого уровня в указанное место и дожидается его `scroll`.
 *
 * Слушатель кейса ставится после записи и потому приходит после слушателя
 * модуля: ответ «зоны пересчитались» относится к состоянию после события. Если
 * список уже в нужном месте, `scroll` не придёт вовсе, и ждать его нельзя.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} levelId
 * @param {'start' | 'middle' | 'end'} where
 * @returns {Promise<void>}
 */
async function placeLiveList(page, levelId, where) {
  await page.evaluate((input) => {
    const level = document.getElementById(input.levelId);
    const list = level === null ? null : level.querySelector('.vc-list');
    if (list === null) {
      throw new Error(`у уровня ${input.levelId} нет списка`);
    }
    const travel = list.scrollHeight - list.clientHeight;
    const target = input.where === 'start' ? 0 : input.where === 'end' ? travel : Math.floor(travel / 2);
    if (list.scrollTop === target) {
      return;
    }
    const settled = new Promise((resolve) => {
      list.addEventListener('scroll', () => {
        resolve(undefined);
      }, { once: true });
    });
    list.scrollTop = target;
    return settled;
  }, { levelId, where });
}

/**
 * Ждёт состояния списка живого уровня.
 *
 * Ожидание состояния, а не пауза: прокрутка идёт по кадрам страницы, и пауза
 * после входа в зону проверяла бы скорость прогона, а не то, доехал ли список.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} levelId
 * @param {'moved' | 'start' | 'end'} what
 * @returns {Promise<void>}
 */
async function waitForLiveList(page, levelId, what) {
  await page.waitForFunction((input) => {
    const level = document.getElementById(input.levelId);
    const list = level === null ? null : level.querySelector('.vc-list');
    if (list === null) {
      return false;
    }
    if (input.what === 'start') {
      return list.scrollTop <= 0;
    }
    if (input.what === 'end') {
      return list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
    }
    return list.scrollTop > 0;
  }, { levelId, what }, { timeout: SCROLL_WAIT_MS });
}

test.describe('живое меню', () => {
  // Вьюпорт задан фикстурой, а не `setViewportSize` в `beforeEach`: высота вьюпорта
  // — это высота рамки списка, а по ней длина прокрутки, и плавающий размер сделал
  // бы ожидания нечитаемыми. Смена размера после создания контекста не годится:
  // `setViewportSize` возвращается, когда размер применён, а событие `resize`
  // приходит позже — на несколько миллисекунд, но уже после `open()`, и
  // `#onGlobalResize` закрывает показанное меню. Замер на живой странице: с
  // `setViewportSize` восемь открытий из двенадцати оставались закрытыми.
  // Вьюпорт ниже окна демо, и страница остаётся прокручиваемой — этого требует
  // кейс про колесо над зоной.
  test.use({ viewport: LIVE_VIEWPORT });

  test('у длинного уровня обе зоны на месте, у короткого скрыты', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const longId = await liveLevelIdOf(page, 'first');
    const long = await readLive(page, longId);

    // Короткий уровень ставится вторым слотом, а не переустановкой первого:
    // закрытый уровень остаётся в документе, и после переустановки в тот же слот
    // поповеров нашлось бы два, а разбирать, чей это уровень, пришлось бы по
    // порядку показа. Заодно видно, что решение о прокрутке — per уровень, а не
    // per меню.
    await mountLiveMenu(page, 'second', { kind: 'short', prefix: 'Пункт' });
    await openLiveMenu(page, 'second', LIVE_POINTS.second);
    const shortId = await liveLevelIdOf(page, 'second');
    const short = await readLive(page, shortId);

    // Контроль переполнения обязателен у обоих уровней: у списка в обрез зоны не
    // показываются вовсе, и показ проверялся бы на уровне, которому он не нужен.
    expect(long.overflow, 'список длинного уровня переполняется').toBe(true);
    expect(long.scrollable, 'у длинного уровня признак есть').toBe('');
    // Обе зоны разом, а не одна: показывает их один атрибут на уровне, и
    // per-зонального решения у слоя нет.
    expect(long.displays).toEqual({ up: 'flex', down: 'flex' });
    // Высота по рамке, а не вычисленная: токен мог бы разрешиться, а места в
    // колонке уровня зона при этом не заняла бы.
    expect(long.zoneHeights).toEqual({ up: SCROLL_ZONE_HEIGHT, down: SCROLL_ZONE_HEIGHT });

    expect(short.overflow, 'список короткого уровня не переполняется').toBe(false);
    expect(short.scrollable, 'у короткого уровня признака нет').toBe(null);
    expect(short.displays).toEqual({ up: 'none', down: 'none' });
    // Нулевая зона — это ещё и «меню не выросло»: скрытая зона места не занимает.
    expect(short.zoneHeights).toEqual({ up: 0, down: 0 });
  });

  test('зоны гаснут по мере прокрутки в обоих направлениях', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const levelId = await liveLevelIdOf(page, 'first');

    const atStart = await readLive(page, levelId);
    // Контроль переполнения: у списка, который не прокручивается, состояния зон
    // не менялось бы вовсе, и весь кейс прошёл бы вхолостую.
    expect(atStart.overflow, 'список переполняется').toBe(true);
    expect(atStart.scrollTop).toBe(0);
    expect(atStart.blocked, 'в начале гаснет только верхняя зона').toEqual({ up: true, down: false });

    await placeLiveList(page, levelId, 'middle');
    const atMiddle = await readLive(page, levelId);
    // Середина — единственное состояние, где свободны обе зоны, и ради него
    // кейс и затевался: на краях свободна ровно одна.
    expect(atMiddle.blocked, 'в середине свободны обе зоны').toEqual({ up: false, down: false });

    await placeLiveList(page, levelId, 'end');
    const atEnd = await readLive(page, levelId);
    expect(atEnd.scrollTop, 'список встал в конец').toBeGreaterThan(0);
    expect(atEnd.blocked, 'в конце гаснет только нижняя зона').toEqual({ up: false, down: true });
  });

  test('наведение на нижнюю зону прокручивает список вниз до упора', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const levelId = await liveLevelIdOf(page, 'first');
    const before = await readLive(page, levelId);
    // Контроль: прокручивать есть куда, и до низа далеко — иначе «до упора» было бы
    // «на пиксель».
    expect(before.travel, 'список прокручиваем').toBeGreaterThan(1);
    expect(before.blocked.down, 'нижняя зона свободна').toBe(false);

    await page.locator(`#${levelId} ${ZONE_DOWN}`).hover();
    await waitForLiveList(page, levelId, 'end');
    const after = await readLive(page, levelId);

    // Список поехал вниз — направление, а не величина: сколько именно он успел
    // пройти, решает время наведения.
    expect(after.scrollTop, 'список поехал вниз').toBeGreaterThan(0);
    expect(after.atBottom, 'список доехал до упора').toBe(true);
    // Упор дошёл до зон: цикл встал по заблокированной зоне, и обе зоны встали по
    // своим краям.
    expect(after.blocked).toEqual({ up: false, down: true });
    // Меню всё ещё показано: прокрутка его собственного списка закрывать его не
    // должна, иначе автоскролл невозможен в принципе.
    expect(after.open, 'меню не закрылось').toBe(true);
  });

  test('наведение на верхнюю зону прокручивает список вверх до упора', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const levelId = await liveLevelIdOf(page, 'first');
    await placeLiveList(page, levelId, 'end');
    const before = await readLive(page, levelId);
    // Контроль исходного места: в начале списка верхняя зона заблокирована и
    // цикл вниз не завёлся бы — кейс проверял бы отказ запуска.
    expect(before.atBottom, 'список стоит в конце').toBe(true);
    expect(before.blocked.up, 'верхняя зона свободна').toBe(false);

    await page.locator(`#${levelId} ${ZONE_UP}`).hover();
    await waitForLiveList(page, levelId, 'start');
    const after = await readLive(page, levelId);

    // Ноль — единственное точное число здесь: ниже начала список не уезжает, и
    // округлять тут нечего.
    expect(after.scrollTop, 'список доехал до начала').toBe(0);
    expect(after.blocked).toEqual({ up: true, down: false });
    expect(after.open, 'меню не закрылось').toBe(true);
  });

  test('наведение на заблокированную зону список не двигает', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const levelId = await liveLevelIdOf(page, 'first');
    const before = await readLive(page, levelId);
    // Контроль исходного места обязателен: у списка в обрез и у списка, у которого
    // некуда идти вверх, цикл не завёлся бы по одной и той же причине, и кейс
    // проверял бы не блокировку зоны.
    expect(before.overflow, 'список прокручиваем').toBe(true);
    expect(before.travel, 'список прокручиваем и вверх').toBeGreaterThan(1);
    expect(before.blocked, 'в начале гаснет только верхняя зона').toEqual({ up: true, down: false });

    await page.locator(`#${levelId} ${ZONE_UP}`).hover();
    await page.waitForTimeout(SETTLE_MS);
    const after = await readLive(page, levelId);

    // Ноль здесь точное число, и пауза после наведения длиннее трёх анимаций:
    // за это время цикл, каким бы он ни был, сдвинул бы список на пиксели.
    expect(after.scrollTop, 'список остался в начале').toBe(0);
    // Зона не исчезла и не переехала: упор гасит её, а не убирает, иначе список
    // уехал бы из-под курсора ровно тогда, когда зона перестала им его вести.
    expect(after.displays, 'зоны остались на месте').toEqual({ up: 'flex', down: 'flex' });
  });

  test('колесо над списком прокручивает список и переносит состояние зон', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const levelId = await liveLevelIdOf(page, 'first');

    await page.locator(`#${levelId} ${LIST}`).hover();
    await page.mouse.wheel(0, 120);
    await waitForLiveList(page, levelId, 'moved');
    const after = await readLive(page, levelId);

    // Прокрутился именно список, а не страница: колесо над списком — это колесо
    // над прокручиваемым потомком, и ушло оно ему, а не документу.
    expect(after.scrollTop, 'список поехал вниз').toBeGreaterThan(0);
    // Контроль: до низа далеко, и «обе зоны свободны» — не следствие упора.
    expect(after.scrollTop, 'список не доехал до низа').toBeLessThan(after.travel);
    // Состояние зон перенёс `scroll` на самом списке: вверх список уехал от
    // начала, и верхняя зона освободилась.
    expect(after.blocked, 'обе зоны свободны').toEqual({ up: false, down: false });
    // Меню не закрылось: `#onGlobalScroll` пропускает прокрутку внутри дерева
    // меню, иначе длинный список был бы нелистаем вовсе.
    expect(after.open, 'меню не закрылось').toBe(true);
  });

  test('колесо над зоной не прокручивает страницу и не закрывает меню', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const levelId = await liveLevelIdOf(page, 'first');
    const before = await readLive(page, levelId);
    // Контроль исходного места обязателен: у страницы, которая не прокручивается,
    // колесо не дало бы события `scroll`, и проверялось бы отсутствие события вместо
    // его обработки.
    expect(await page.evaluate(() => globalThis.scrollY), 'страница в начале').toBe(0);
    expect(before.blocked, 'в начале гаснет только верхняя зона').toEqual({ up: true, down: false });

    await page.locator(`#${levelId} ${ZONE_DOWN}`).hover();
    await page.mouse.wheel(0, 120);
    // Пауза втрое больше срока закрытия меню скроллом: без неё кейс прошёл бы на
    // закрытии, которое просто ещё не успело произойти.
    await page.waitForTimeout(SETTLE_MS);

    // Зона — часть меню, и колесо над ней относится к меню так же, как колесо над
    // самим списком. Раньше у зоны не было `overflow`, колесо уходило странице, а
    // прокрутка страницы закрывала меню: одно движение колеса над зоной убирало
    // меню с экрана, хотя прокручивать там было нечего.
    const scrolled = await page.evaluate(() => globalThis.scrollY);
    expect(scrolled, 'страница не прокрутилась').toBe(0);

    const after = await readLive(page, levelId);
    // Закрыт уровень, а не «не виден»: `isVisible()` у закрытого меню врёт во всех
    // трёх движках (замерено), потому что авторское `display: flex` у `.vc-menu`
    // перебивает UA-правило `[popover]:not(:popover-open)`. Гасит закрытый уровень
    // `opacity: 0`, а её видимость Playwright не смотрит.
    expect(after.open, 'меню осталось в Top Layer').toBe(true);
    expect(after.opacity, 'меню нарисовано').toBe('1');
    // Список уехал вниз — но от автоскролла по наведению, а не от колеса: цикл по
    // кадрам живёт на `pointerenter` и от `wheel` не зависит. Гашение колеса не
    // должно было остановить и его.
    expect(after.scrollTop, 'автоскролл по наведению отработал').toBeGreaterThan(before.scrollTop);
    expect(after.scrollTop, 'список не доехал до низа').toBeLessThan(after.travel);
  });

  test('колесо над блокированной зоной тоже гасится', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const levelId = await liveLevelIdOf(page, 'first');

    // Доводим список до низа прокруткой над ним: колесом над списком, а не над
    // зоной — иначе блокировку зоны создавал бы сам предмет проверки.
    await page.locator(`#${levelId} ${LIST}`).hover();
    await page.evaluate((id) => {
      const list = document.querySelector(`#${id} .vc-list`);
      if (list === null) {
        throw new Error('у уровня нет списка');
      }
      list.scrollTop = list.scrollHeight;
    }, levelId);
    // Признак упора ставит обработчик `scroll` на самом списке, а событие приходит
    // после кадра: без ожидания снимок увидел бы прежнее состояние зон.
    await page.waitForFunction(
      (id) => {
        const zone = document.querySelector(`#${id} .vc-scroll-zone-down`);
        return zone !== null && zone.hasAttribute('data-vc-blocked');
      },
      levelId,
    );
    const atBottom = await readLive(page, levelId);
    expect(atBottom.blocked.down, 'нижняя зона заблокирована').toBe(true);
    expect(await page.evaluate(() => globalThis.scrollY), 'страница в начале').toBe(0);

    // Блокировка — свойство прокрутки, а не «зоны нет». Зона остаётся на месте и
    // остаётся частью меню, поэтому колесо над ней гасится так же.
    await page.locator(`#${levelId} ${ZONE_DOWN}`).hover();
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(SETTLE_MS);

    expect(await page.evaluate(() => globalThis.scrollY), 'страница не прокрутилась').toBe(0);
    const after = await readLive(page, levelId);
    expect(after.open, 'меню осталось в Top Layer').toBe(true);
    expect(after.displays, 'зона осталась на месте').toEqual({ up: 'flex', down: 'flex' });
  });

  test('вход в зону снимает выделение пункта', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const levelId = await liveLevelIdOf(page, 'first');

    await page.locator(`#${levelId} ${ITEM}`).first().hover();
    const onItem = await readLive(page, levelId);
    // Контроль: пункт под курсором отмечен, иначе «в зоне выделения нет» прошло бы
    // на меню, в котором его и не было.
    expect(onItem.activeLabels, 'пункт под курсором отмечен').toEqual(['Пункт 1']);

    await page.locator(`#${levelId} ${ZONE_DOWN}`).hover();
    const inZone = await readLive(page, levelId);

    // Пока на пункте держится `data-active`, зона выглядит как выбор пункта,
    // который список сейчас крутит: подсвечен тот, кого никто не выбирал.
    expect(inZone.activeLabels, 'в зоне выделения нет').toEqual([]);
  });

  test('стрелка вниз из зоны выбирает первый пункт, стрелка вверх — последний', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const levelId = await liveLevelIdOf(page, 'first');
    // Верхняя зона у начала списка: она заблокирована, и наведение на неё не
    // запускает цикл — иначе список полз бы под стрелками и `scrollTop` в
    // ожидании «равен нулю» был бы недетерминированным.
    await page.locator(`#${levelId} ${ZONE_UP}`).hover();
    const inZone = await readLive(page, levelId);
    // Контроль исходного места: у уровня без отметки первая стрелка обязана дать
    // крайний пункт, а не следующий за отмеченным.
    expect(inZone.activeLabels, 'в зоне выделения нет').toEqual([]);
    expect(inZone.blocked.up, 'верхняя зона заблокирована, цикл не шёл').toBe(true);

    await page.keyboard.press('ArrowDown');
    const down = await readLive(page, levelId);
    expect(down.activeLabels, 'стрелка вниз выбрала первый пункт').toEqual(['Пункт 1']);
    // Первый пункт виден и без долистывания, и список от этого не трогается.
    expect(down.scrollTop, 'список остался в начале').toBe(0);

    await page.keyboard.press('ArrowUp');
    // Долистывание клавиатурой приходит тем же `scroll` на списке, что и автоскролл
    // зоны, и он асинхронен: снимок без ожидания снял бы состояние зон от упора
    // списка, а не от их собственного пересчёта.
    await waitForLiveList(page, levelId, 'end');
    const up = await readLive(page, levelId);
    expect(up.activeLabels, 'стрелка вверх выбрала последний пункт').toEqual(['Пункт 40']);
    // Последний пункт за нижним краем, и долистывание уводит список в упор.
    expect(up.atBottom, 'список долистался до низа').toBe(true);
    expect(up.blocked.down, 'нижняя зона погасла').toBe(true);
  });

  test('End долистывает список и гасит нижнюю зону', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const levelId = await liveLevelIdOf(page, 'first');
    const before = await readLive(page, levelId);
    // Контроль исходного места: у списка в начале гаснет верхняя зона, а
    // «нижняя погасла» прошло бы на упоре, который и так был бы достигнут.
    expect(before.travel, 'список прокручиваем').toBeGreaterThan(1);
    expect(before.activeLabels, 'выделения до End нет').toEqual([]);
    expect(before.blocked.down, 'нижняя зона свободна').toBe(false);

    await page.keyboard.press('End');
    await waitForLiveList(page, levelId, 'end');
    const after = await readLive(page, levelId);

    expect(after.activeLabels, 'End выбрал последний пункт').toEqual(['Пункт 40']);
    // Долистывание клавиатурой пришло тем же `scroll` на самом списке, что и
    // автоскролл зоны: подписка зон висит на списке, а не на колесе.
    expect(after.blocked).toEqual({ up: false, down: true });
    expect(after.open, 'меню не закрылось').toBe(true);
  });

  test('Escape посреди автоскролла останавливает цикл', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    const levelId = await liveLevelIdOf(page, 'first');

    await page.locator(`#${levelId} ${ZONE_DOWN}`).hover();
    await waitForLiveList(page, levelId, 'moved');
    const running = await readLive(page, levelId);
    // Контроль: цикл действительно шёл, иначе «остановить» было бы нечего.
    expect(running.scrollTop, 'список поехал вниз').toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(SETTLE_MS);
    const closed = await readLive(page, levelId);
    expect(closed.open, 'меню закрылось').toBe(false);
    // Список уехал и после закрытия, то есть сравнивать есть что: у неотрисованного
    // уровня `scrollTop` зажат в ноль, и равенство ниже прошло бы на `0 === 0`,
    // не замечая ни остановленного цикла, ни остановившегося по счастливой причине.
    expect(closed.scrollTop, 'список уехал до закрытия').toBeGreaterThan(0);

    // Два замера списка после закрытия: цикл мог бы гонять список и на
    // скрытом уровне, и заметен это был бы только между ними.
    await page.waitForTimeout(SETTLE_MS * 2);
    const later = await readLive(page, levelId);
    expect(later.scrollTop, 'список после закрытия не движется').toBe(closed.scrollTop);
  });

  test('наведение на зону одного меню не двигает список другого', async ({ page }) => {
    await mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' });
    await openLiveMenu(page, 'first', LIVE_POINTS.first);
    await mountLiveMenu(page, 'second', { kind: 'long', prefix: 'Второй' });
    await openLiveMenu(page, 'second', LIVE_POINTS.second);
    const firstId = await liveLevelIdOf(page, 'first');
    const secondId = await liveLevelIdOf(page, 'second');

    const before = {
      first: await readLive(page, firstId),
      second: await readLive(page, secondId),
    };
    // Контроль: оба уровня прокручиваемы и оба стоят в начале. Признак берётся
    // селектором и общий для всех `.vc-menu`, поэтому «у первого уровня признак
    // есть» читается по его поповеру.
    expect(before.first.scrollable, 'у первого уровня признак есть').toBe('');
    expect(before.second.scrollable, 'у второго уровня признак есть').toBe('');
    expect(before.first.scrollTop, 'первый список в начале').toBe(0);
    expect(before.second.scrollTop, 'второй список в начале').toBe(0);

    await page.locator(`#${firstId} ${ZONE_DOWN}`).hover();
    await waitForLiveList(page, firstId, 'end');
    const after = {
      first: await readLive(page, firstId),
      second: await readLive(page, secondId),
    };

    // Контроллер зон на каждый уровень, и наведение на зону одного меню ничего не
    // говорит контроллеру другого: без этой проверки кейс прошёл бы на одном
    // экземпляре, у которого и список не с чем сравнивать.
    expect(after.first.atBottom, 'первый список доехал до упора').toBe(true);
    expect(after.second.scrollTop, 'второй список не двинулся').toBe(0);
    // Второе меню всё ещё показано: наведение на зону одного меню не закрывает
    // соседа. Проверка не перестраховка, а условие живости сравнения — закрытое
    // меню даёт тот же ноль `scrollTop`, и без неё кейс проходил бы на меню,
    // которое нечего было бы двигать. Держит её `#onGlobalScroll`: прокрутка списка
    // соседа не должна выглядеть для этого экземпляра прокруткой страницы.
    expect(after.second.open, 'второе меню не закрылось').toBe(true);
  });
});
