import { expect, test } from '@playwright/test';
import { CURSOR_OFFSET, DEFAULT_ANIMATION_DURATION, SAFETY_PADDING } from '../../src/constants.js';

/**
 * Кейсы жизненного цикла `MyContext` против настоящей страницы: клики и клавиши
 * приходят из Playwright, модуль грузится динамическим импортом прямо в браузере.
 *
 * Проба ставится в `beforeEach` на глобальный объект страницы и достаётся
 * приведением прямо внутри каждого `page.evaluate`: коллбэк сериализуется и
 * выполняется в браузере, где функций файла теста нет, — по той же причине, по
 * которой наборы пунктов объявлены внутри пробы, а не приходят аргументом.
 * Спецификатор импорта записан относительным по третьей причине: в браузере он
 * схлопывается до `/src/index.js` — корень сервера, — а TypeScript разрешает его
 * от файла теста, и типы берутся из исходника без приведений.
 */

/**
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 * @typedef {import('../../src/layer.js').Point} Point
 */

/**
 * @typedef {object} ItemView
 * @property {string} label подпись пункта; `''` у разделителя.
 * @property {string} role
 * @property {string} tabindex атрибут как есть: `'-1'`, `'0'` или `''`.
 * @property {boolean} active несёт `data-active`.
 * @property {boolean} focused стоит ли фокус на узле.
 * @property {boolean} disabled
 * @property {string | null} haspopup `aria-haspopup`.
 * @property {string | null} expanded `aria-expanded`.
 * @property {string | null} owns `aria-owns` — зарезервированный адрес подменю.
 * @property {boolean} ownsTarget существует ли в документе элемент с этим `id`.
 *   Разведены с `owns` намеренно: владелец, чей уровень так и не заведён, —
 *   это ровно тот случай, который иначе не отличить от работающего владельца.
 * @property {string | null} chevron `data-chevron`.
 */

/**
 * @typedef {object} LevelView
 * @property {string} id
 * @property {boolean} popoverOpen `:popover-open` — уровень в Top Layer.
 * @property {boolean} marked метка `data-probe`, оставленная пробой на узле.
 *   Переживает переоткрытие, если уровень переиспользован, и не переживает
 *   пересоздания — единственный способ отличить одно от другого снаружи.
 * @property {boolean} closing несёт `data-vc-closing`: уровень гаснет на месте, в
 *   Top Layer, и ещё не покинул его. Состояния «показан» и «гаснет» в одном
 *   снимке неразличимы — оба уровня в Top Layer.
 * @property {MenuRect} rect рамка уровня во вьюпорте.
 * @property {ItemView[]} items
 */

/**
 * @typedef {object} MenuRect
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} Snapshot
 * @property {LevelView[]} levels уровни в порядке документа.
 * @property {number} openCount сколько из них в Top Layer.
 * @property {number} hideCount сколько раз вызван `hidePopover`. Различает «меню
 *   закрылось и открылось заново» и «меню перенеслось»: состояние у них одинаковое,
 *   и в одном снимке не различить их нечем.
 * @property {string | null} focusOwnerId `id` элемента с фокусом либо имя тега.
 * @property {string | null} focusLabel подпись пункта с фокусом.
 * @property {boolean} focusInMenu стоит ли фокус в дереве уровней меню. Не то же
 *   самое, что фокус на пункте: у открытого меню он стоит на элементе уровня.
 * @property {string[]} log метки сработавших действий, по порядку.
 * @property {string[]} errors сообщения необработанных ошибок страницы.
 * @property {ProbeContextMenu[]} contextmenu события `contextmenu`, дойденные до
 *   документа: видно, куда пришёл клик и подавила ли его привязка.
 * @property {ProbeRemoved[]} removed снятия слушателей: после `destroy()` живой
 *   обработчик `contextmenu` неотличим от снятого по поведению, он молчит на флаге
 *   уничтожения.
 * @property {number} actionsSize размер карты действий экземпляра; `-1`, если
 *   проба её не увидела.
 */

/**
 * @typedef {object} ProbeContextMenu
 * @property {string | null} container `id` контейнера под целью.
 * @property {boolean} prevented `defaultPrevented` к моменту всплытия на
 *   документ.
 */

/**
 * @typedef {object} ProbeRemoved
 * @property {string} type имя снятого события.
 * @property {string} target `id` узла, с которого слушатель снят.
 */

/**
 * @typedef {object} McProbe
 * @property {(set: string, containerId: string | null, reopenPoint?: Point | null) => void} make
 * @property {(containerId: string) => void} attach
 * @property {() => void} detach
 * @property {(x: number, y: number) => void} open
 * @property {(x: number, y: number) => void} openAsSubmenu
 * @property {() => void} close
 * @property {() => void} destroy
 * @property {() => void} markRoot
 * @property {() => Snapshot} read
 * @property {() => number} actionsSize
 * @property {(index: number, enabled: boolean) => void} setAvailability правка
 *   `isEnabledAction` у пункта набора последнего `make`: автор меняет смысл
 *   действия между показами, и решение должно дойти до уже построенного уровня.
 */

const STYLESHEET_PATH = '/styles/mycontext.css';

const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <!-- Фон страницы задан явно: по умолчанию он прозрачен, и композит поверх
       прозрачного чёрного занижал бы измерения полупрозрачной подложки. -->
  <body style="background: rgb(255, 255, 255)">
    <!-- Оба контейнера получают tabindex="-1": возвращать фокус на div без
         него нельзя, и проверка возврата проходила бы на нерабочей двери. -->
    <div id="workspace" data-container="workspace" tabindex="-1"
         style="position: fixed; left: 0; top: 0; width: 600px; height: 400px; background: rgb(238, 238, 238)"></div>
    <div id="second" data-container="second" tabindex="-1"
         style="position: fixed; left: 0; top: 420px; width: 600px; height: 100px; background: rgb(221, 221, 221)"></div>
    <div id="outside" tabindex="-1"
         style="position: fixed; left: 0; top: 540px; width: 600px; height: 60px; background: rgb(204, 204, 204)"></div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };

// Точки правого клика: обе внутри своего контейнера, обе далеко от его краёв и
// от соседа, поэтому промах по контейнеру исключён.
const WORKSPACE_POINT = { x: 300, y: 200 };
const SECOND_POINT = { x: 300, y: 470 };

// Точка, в которой действие пункта набора `reopening` открывает меню заново. Идёт
// аргументом `make` в пробу, а не объявляется там второй раз: колбэк
// `page.evaluate` сериализует аргументы, и число, объявленное в двух местах файла,
// разъехалось бы молча.
const REOPEN_POINT = { x: 520, y: 460 };

/**
 * Мгновение, на котором замирают часы кейсов с анимацией. Фиксированное, а не
 * системное «сейчас»: одинаковое во всех прогонах, и рядом с ним виден каждый прыжок
 * времени.
 */
const CLOCK_FROZEN_AT = new Date('2024-12-10T09:00:00Z');
/**
 * Точка запуска часов, на час раньше точки замирания. Разрыв нужен потому, что
 * `install` не только ставит время, но и сразу пускает часы, и к моменту `pauseAt`
 * фальшивое время уже ушло вперёд на всё, что заняло обращение к странице.
 */
const CLOCK_START_AT = new Date(CLOCK_FROZEN_AT.getTime() - 3_600_000);

/**
 * Способы закрыть меню, пока отложенный показ ещё не сработал. Пять, а не один:
 * все они зовут `#closeMenu`, но приходят из пяти разных обработчиков, и отмена
 * отложенного показа обязана быть частью закрытия, а не одного из путей. Имя
 * способа попадает в название кейса, чтобы падение показывало, какой именно путь
 * перестал отменять показ.
 *
 * Перечень закрывается по числу строк таблицы глобальных слушателей в
 * `src/MyContext.js`, а не по памяти: забытый здесь способ — это висящий показ,
 * воскресающий после ухода вкладки в фон.
 *
 * **`blur` окна в таблице нет, и это limitation среды, а не недосмотр.** Обработчик
 * закрывает по нему только при `document.hasFocus() === false`, и это свойство
 * переопределить нельзя, а настоящий уход в другое приложение под управлением
 * браузера не воспроизводится: фоновая страница остаётся и видимой, и в фокусе. Строка
 * с подменой состояния прошла бы здесь вхолостую — закрытия в ней не было бы вовсе, и
 * кейс снял бы охрану, придумав её затем заново. Полярность охраны закреплена
 * отдельно, в кейсе `blur окна при уже возвращённом фокусе меню не закрывает`.
 *
 * @type {{ title: string, apply: (page: import('@playwright/test').Page) => Promise<void> }[]}
 */
const CLOSINGS = [
  {
    title: 'Escape с фокусом на гаснущем уровне',
    apply: async (page) => {
      // Фокус на уровне — так и оставлен: после первого `open()` он стоит на
      // элементе корневого уровня, и второй вызов фокус не трогает. В окне закрытия
      // реестр движка пуст, разбирать клавишу на уровне некому, и `Escape` обязан
      // дойти до глобального обработчика с этой целью — иначе висящий показ
      // воскресит меню, и кейс проверял бы не отмену, а её отсутствие.
      await page.keyboard.press('Escape');
      // Фокус возвращается на контейнер, из которого открывали: в этом окне он наш,
      // он стоит на гаснущем уровне, и оставить его там нельзя — через анимацию
      // `hidePopover()` роняет его на `<body>`. Проверка живёт здесь, а не в общем
      // теле цикла: у скролла, `resize` и клика фокус не наш, и возвращать его там
      // нечего.
      const after = await readMenu(page);
      expect(after.focusOwnerId, 'фокус вернулся на контейнер').toBe('workspace');
    },
  },
  {
    title: 'скролл страницы',
    apply: async (page) => {
      await page.evaluate(() => {
        // Полоса прокрутки нужна самой странице: все её блоки — `position: fixed`,
        // документ не выше вьюпорта, и `scrollTo` не дал бы события вовсе. Без неё
        // кейс проверял бы не закрытие скроллом, а его отсутствие.
        const spacer = document.createElement('div');
        spacer.style.height = '2000px';
        document.body.append(spacer);
        window.scrollTo(0, 1);
      });
    },
  },
  {
    title: 'resize',
    apply: async (page) => {
      await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height + 1 });
    },
  },
  {
    title: 'левая кнопка вне меню',
    apply: async (page) => {
      // Точка в стороне от меню и от контейнера: под гаснущим уровнем кликать
      // нечего, и проверяется именно клик по странице.
      await page.mouse.click(800, 620);
    },
  },
  {
    title: 'уход вкладки в фон',
    apply: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    },
  },
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} set имя набора пунктов пробы.
 * @param {string | null} containerId контейнер привязки; `null` — без привязки.
 * @param {Point | null} [reopenPoint] точка, в которую действия набора `reopening` зовут
 *   `open()`; без неё такие действия падают с ошибкой, и это проверяется само по себе.
 * @returns {Promise<Snapshot>}
 */
function makeMenu(page, set, containerId, reopenPoint = null) {
  return page.evaluate((input) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(input.set, input.container, input.reopenPoint);
    return scope.__mc.read();
  }, { set, container: containerId, reopenPoint });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Snapshot>}
 */
function readMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.read();
  });
}

/**
 * Досматривает входные переходы меню до конца.
 *
 * Нужен кейсам со снятым `reduce` и остановленными часами: показ меню проходит
 * настоящим CSS-переходом, а он живёт реальным временем, которого у кейса нет.
 * `waitForFunction` не годится — остановленные часы останавливают и кадры, а по
 * ним ходит ожидание; `fastForward` двигает только фальшивые таймеры и на
 * переходы не смотрит.
 *
 * `finish()` прыгает к концу синхронно, поэтому рамка читается уже покойной.
 * Без этого `getBoundingClientRect` отдаёт прямоугольник, сдвинутый на
 * `0.02 × ширина`: вход начинается с `scale(0.96)`, и меню ещё не в полном
 * размере. Прыгать нужно именно до конца, а не до середины, — иначе смещение
 * просто станет другим.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function settleEntryAnimations(page) {
  return page.evaluate(() => {
    for (const level of document.querySelectorAll('.vc-menu')) {
      for (const animation of level.getAnimations()) {
        animation.finish();
      }
    }
  }).then(() => {
    return undefined;
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} containerId
 * @returns {Promise<Snapshot>}
 */
function attachMenu(page, containerId) {
  return page.evaluate((id) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.attach(id);
    return scope.__mc.read();
  }, containerId);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Snapshot>}
 */
function detachMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.detach();
    return scope.__mc.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} x
 * @param {number} y
 * @returns {Promise<Snapshot>}
 */
function openMenu(page, x, y) {
  return page.evaluate(async (point) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    await scope.__mc.open(point.x, point.y);
    return scope.__mc.read();
  }, { x, y });
}

/**
 * Показ, обещанный, но не дожданный: снимок снимается в окне между сокрытием
 * прежнего уровня и показом нового.
 *
 * Ждать промис `open()` здесь нельзя — к моменту его разрешения меню уже стоит в
 * новой точке, и окна, ради которого кейс написан, уже нет. Отказ не ловится:
 * действия в этих кейсах синхронны, и `open()` не может отклониться.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} x
 * @param {number} y
 * @returns {Promise<void>}
 */
function startShow(page, x, y) {
  return page.evaluate((point) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    void scope.__mc.open(point.x, point.y);
  }, { x, y });
}

/**
 * Повторный `open()` на уже открытом меню и снимок после полного цикла.
 *
 * Отдельный хелпер, а не `openMenu`, потому что показ отложен на `animationDuration`
 * и снимок, взятый в том же `evaluate`, видел бы меню на середине цикла. Часы
 * замораживает вызывающий: `fastForward` без `page.clock.install()` бросает.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} x
 * @param {number} y
 * @returns {Promise<Snapshot>}
 */
function reopenMenu(page, x, y) {
  return page.evaluate(async (point) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    await scope.__mc.open(point.x, point.y);
  }, { x, y }).then(() => {
    return page.clock.fastForward(DEFAULT_ANIMATION_DURATION * 2).then(() => {
      return readMenu(page);
    });
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Snapshot>}
 */
function closeMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.close();
    return scope.__mc.read();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Snapshot>}
 */
function destroyMenu(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.destroy();
    return scope.__mc.read();
  });
}

/**
 * Оставляет метку на корневом уровне: переживает переоткрытие при переиспользовании
 * DOM и не переживает пересоздания.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function markRoot(page) {
  return page.evaluate(() => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.markRoot();
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function rightClick(page, point) {
  return page.mouse.click(point.x, point.y, { button: 'right' });
}

/**
 * Правый клик и снимок после него: короткая запись для кейсов, где важно только
 * «меню открылось».
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} [point]
 * @returns {Promise<Snapshot>}
 */
function rightClickAndRead(page, point = WORKSPACE_POINT) {
  return page.mouse.click(point.x, point.y, { button: 'right' }).then(() => {
    return readMenu(page);
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {import('@playwright/test').Locator}
 */
function itemByLabel(page, label) {
  return page.locator('.vc-item').filter({ hasText: label });
}

/**
 * Разделитель конкретного уровня. Искать его по подписи нечем — у него её нет, —
 * а адрес уровня берётся из снимка, чтобы клик ушёл в показанный уровень, а не в
 * заведённый, но не показанный: у того нет ни ширины, ни высоты, и Playwright
 * отказался бы наводиться.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} levelId
 * @returns {import('@playwright/test').Locator}
 */
function separatorItem(page, levelId) {
  return page.locator(`#${levelId} .vc-separator`);
}

/**
 * Подписи активных пунктов по показанным уровням: пара «уровень, подпись» нужна,
 * чтобы утверждение о том, что активен не тот пункт, не проходило на пустом уровне.
 *
 * Закрытые уровни пропускаются намеренно: закрытие подменю клавишей `Escape`
 * оставляет на его пункте `data-active` — движок переносит активность на
 * пункт-владелец, но не снимает отметку с ребёнка, — и такая отметка в скрытом
 * уровне ничего не значит для пользователя.
 *
 * @param {Snapshot} snapshot
 * @returns {Array<string>}
 */
function activeLabels(snapshot) {
  /** @type {Array<string>} */
  const labels = [];
  for (const level of snapshot.levels) {
    if (!level.popoverOpen) {
      continue;
    }
    for (const item of level.items) {
      if (item.active) {
        labels.push(`${level.id}:${item.label}`);
      }
    }
  }
  return labels;
}

/**
 * Открытые уровни: `id` тех, кто в Top Layer.
 *
 * @param {Snapshot} snapshot
 * @returns {Array<string>}
 */
function openIds(snapshot) {
  return snapshot.levels.filter((level) => {
    return level.popoverOpen;
  }).map((level) => {
    return level.id;
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  // `goto` обязателен перед `setContent`: без него у документа нет адреса, и ни
  // ссылка на таблицу стилей, ни динамический импорт не разрешились бы.
  await page.goto('/');
  await page.setContent(PAGE_HTML);
  // Живая таблица стилей ещё могла не примениться, и замер меню вернул бы нули:
  // кейсы про точку клика проверяли бы тогда не позиционирование, а отсутствие
  // стилей.
  await page.waitForFunction(
    (path) => {
      return Array.from(document.styleSheets).some((sheet) => {
        return sheet.href !== null && sheet.href.endsWith(path) && sheet.cssRules.length > 0;
      });
    },
    STYLESHEET_PATH,
    { timeout: 5000 },
  );
  // `reduce` пропускает отложенное закрытие целиком, и `hidePopover` происходит
  // сразу: состояние меню после действия не зависит ни от таймера, ни от анимации.
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { MyContext } = await import('../../src/index.js');

    /**
     * Шпион на карте действий. Карта принадлежит приватному полю экземпляра и
     * наружу не отдаётся, а обязание «`destroy()` очищает её целиком» иначе нечем
     * подтвердить: наружу смотрит только пустая разметка. Подмена одного метода
     * `Map` — приём того же рода, что и обёртки `showPopover` в
     * `tests/e2e/layer.spec.js`: платформенный метод, через который проходит всё
     * состояние, и наблюдение за ним не меняет поведения.
     *
     * Ключ карты действий — `menuId` уровня и позиция пункта в нём, и по нему
     * карта узнаётся среди всех прочих: строковые ключи такого вида есть только у
     * неё. Регулярное выражение объявлено здесь, а не взято из модуля файла:
     * коллбэк `page.evaluate` сериализуется и в браузере видит только своё.
     *
     * @type {Map<string, unknown>[]}
     */
    const actionMaps = [];
    const nativeSet = Map.prototype.set;
    const actionsKey = /^vc-[\d-]*(?:sub-[\d-]+)?:\d+$/;

    /**
     * Шпион на снятии слушателя. Поведение после `destroy()` доказать нечем: живой
     * обработчик `contextmenu` после `destroy()` всё равно ничего не делает — он
     * первым делом смотрит на флаг уничтожения, — и «меню не открылось» прошло бы
     * и при слушателе на месте. Разница видна только на самом снятии, поэтому
     * наблюдение ведётся за ним.
     *
     * @type {ProbeRemoved[]}
     */
    const removed = [];
    const nativeRemove = EventTarget.prototype.removeEventListener;

    /**
     * @this {EventTarget}
     * @param {string} type
     * @param {EventListenerOrEventListenerObject | null} listener
     * @param {boolean | AddEventListenerOptions | undefined} options
     * @returns {void}
     */
    function removeSpy(type, listener, options) {
      removed.push({
        type,
        target: this instanceof HTMLElement ? this.id : 'без id',
      });
      nativeRemove.call(this, type, listener, options);
    }

    EventTarget.prototype.removeEventListener = /** @type {typeof EventTarget.prototype.removeEventListener} */ (
      /** @type {unknown} */ (removeSpy)
    );

    /**
     * @this {Map<string, unknown>}
     * @param {unknown} key
     * @param {unknown} value
     * @returns {Map<string, unknown>}
     */
    function setSpy(key, value) {
      if (typeof key === 'string' && actionsKey.test(key)) {
        actionMaps.push(this);
      }
      return nativeSet.call(this, key, value);
    }

    Map.prototype.set = /** @type {typeof Map.prototype.set} */ (
      /** @type {unknown} */ (setSpy)
    );

    /** @type {string[]} метки сработавших действий. */
    const log = [];
    /** @type {string[]} сообщения необработанных ошибок страницы. */
    const errors = [];
    /** @type {ProbeContextMenu[]} */
    const contextmenu = [];
    /**
     * Счётчик `hidePopover`: снимок открытого меню одинаков и после полного цикла
     * переоткрытия, и после простого переноса, поэтому различает их только число
     * скрытий. Подмена одного метода `HTMLElement` — приём того же рода, что и
     * обёртки `showPopover` в `tests/e2e/layer.spec.js`: платформенный метод, через
     * который проходит всё состояние уровня, и наблюдение за ним поведения не
     * меняет.
     *
     * @type {number}
     */
    let hideCount = 0;
    const nativeHide = HTMLElement.prototype.hidePopover;
    HTMLElement.prototype.hidePopover = function patchedHide() {
      hideCount += 1;
      return nativeHide.call(this);
    };
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });
    // Слушатель на документе, а не на контейнере: у документа событие окажется
    // после контейнерного, поэтому `defaultPrevented` к этому моменту уже
    // выставлен привязкой. Слушатель на самом контейнере видел бы событие раньше
    // него и всегда считал бы его неподвленным.
    document.addEventListener('contextmenu', (event) => {
      const target = event.target;
      const container = target instanceof Element ? target.closest('[data-container]') : null;
      contextmenu.push({
        container: container === null ? null : container.getAttribute('data-container'),
        prevented: event.defaultPrevented,
      });
    });

    /**
     * Владелец непустого подменю с собственным действием. Объявлен один раз на
     * два набора: `mixed` проверяет, что клик по владельцу открывает подменю и не
     * зовёт действие, `nonclosing` — что он же меню не закрывает. Копии этой строки
     * в двух наборах разъехались бы одинаковым текстом, а расхождение никто бы не
     * увидел.
     * @type {MenuItem}
     */
    const ownerItem = {
      labelAction: () => 'Владелец',
      submenuAction: () => [{ labelAction: () => 'Под владельцем' }],
      action: () => log.push('владелец'),
    };

    /**
     * Наборы пунктов объявлены здесь, а не приходят аргументом: у пунктов есть
     * `action`-функции, а `page.evaluate` сериализует аргументы как JSON и функции
     * бы выбросил. Поэтому кейс зовёт `make('имя')`.
     */
    /** @type {Record<string, Array<MenuItem | SeparatorItem>>} */
    const sets = {
      // Разделитель между пунктами: у уровня без него `ArrowDown` и `ArrowUp` дали
      // бы одинаковый снимок, и «пропускает ли цикл отключённые» было бы нечем
      // отличать.
      flat: [{ labelAction: () => 'Первый' }, { type: 'separator' }, { labelAction: () => 'Второй' }, { labelAction: () => 'Третий' }],
      nested: [{ labelAction: () => 'Ветка', submenuAction: () => [{ labelAction: () => 'Лист' }] }],
      // Четыре пункта из Review Focus 2: без `id`, два с одинаковым и один с
      // третьим. Каждый пишет в общий журнал свою метку, и порядок журнала —
      // единственное, что отличает «свой `action`» от «чужого `action` по `id`».
      ids: [
        { labelAction: () => 'Без id', action: () => log.push('без id') },
        { id: 'x', labelAction: () => 'Первый x', action: () => log.push('первый x') },
        { id: 'x', labelAction: () => 'Второй x', action: () => log.push('второй x') },
        { id: 'y', labelAction: () => 'Y', action: () => log.push('y') },
      ],
      // Отключённый владелец стоит первым: будь он доступен, фокус встал бы на
      // него, и весь кейс проходил бы на пустом механизме. Владелец с пустым
      // подменю — контроль на «владелец ли он по разметке».
      disabled: [
        {
          labelAction: () => 'Глухой',
          isEnabledAction: () => false,
          submenuAction: () => [{ labelAction: () => 'Под глухим' }],
          action: () => log.push('глухой'),
        },
        { labelAction: () => 'Без подменю', action: () => log.push('без подменю') },
        { labelAction: () => 'Живой', submenuAction: () => [{ labelAction: () => 'Под живым' }], action: () => log.push('живой') },
      ],
      // Пункт-владелец с собственным действием и лист в одном уровне: клик по
      // владельцу открывает подменю и не зовёт его действие, клик по листу зовёт.
      // Оба пункта в одном уровне — иначе «клик по владельцу ничего не зовёт» можно
      // было бы объяснить тем, что обработчика активации нет вовсе.
      mixed: [ownerItem, { labelAction: () => 'Лист', action: () => log.push('лист') }],
      // Первый пункт тихий, второй ломается: нажатие на обоих подряд отделяет
      // «исключение пробрасывается» от «меню закрывается».
      throwing: [
        { labelAction: () => 'Тихий', action: () => log.push('тихий') },
        {
          labelAction: () => 'Ломает',
          action: () => {
            throw new Error('действие сломано');
          },
        },
      ],
      // Ровно те строки, клик по которым меню закрывать не должен, и ни одной
      // закрывающей рядом: разделитель, отключённый пункт и владелец непустого
      // подменю. Отдельного пункта с действием здесь нет намеренно — «меню не
      // закрылось» должно означать «закрывать было нечем», иначе кейс прошёл бы на
      // действии, которое закрывает само. Владелец взят из `mixed`: строка одна и та
      // же, и раздельные определения разъехались бы одинаковым текстом в двух
      // местах.
      nonclosing: [
        { type: 'separator' },
        {
          labelAction: () => 'Отключённый',
          isEnabledAction: () => false,
          action: () => log.push('отключённый'),
        },
        ownerItem,
      ],
      // Пункты, чьи действия открывают меню в другом месте страницы: закрытие,
      // начатое обработчиком активации после действия, убило бы то, что только что
      // открыто, и такой обработчик был бы попросту бесполезен. Второй пункт вдобавок
      // бросает — проверяется, что это исключение доходит до страницы, а не тонет
      // вместе с пропущенным закрытием.
      //
      // Точка переоткрытия приходит в `make` аргументом: колбэк `page.evaluate`
      // сериализует аргументы, а объявить её второй раз внутри пробы значило бы
      // держать одно и то же число в двух местах файла.
      reopening: [
        { labelAction: () => 'Тихий', action: () => log.push('тихий') },
        {
          labelAction: () => 'Переоткрыть',
          action: () => {
            log.push('переоткрыть');
            reopenAt();
          },
        },
        {
          labelAction: () => 'Сломать после переоткрытия',
          action: () => {
            log.push('сломать после переоткрытия');
            reopenAt();
            throw new Error('переоткрытие сломано');
          },
        },
      ],
    };

    /** @type {InstanceType<typeof MyContext> | null} */
    let menu = null;

    /** @type {string} имя набора последнего `make`: правке `isEnabledAction` подлежит он. */
    let currentSet = '';

    /**
     * Точка, в которой действия набора `reopening` открывают меню заново. Приходит
     * аргументом `make` вместе с именем набора, потому что объявить её в пробе
     * второй раз значило бы держать одно и то же число в двух местах файла.
     * @type {Point | null}
     */
    let reopenPoint = null;

    /**
     * Открывает меню в точке `reopening` — по тому же пути, что и автор обработчика:
     * напрямую из действия пункта, мимо пробы и мимо браузера.
     * @returns {Promise<void>}
     */
    async function reopenAt() {
      if (menu === null || reopenPoint === null) {
        throw new Error('нечего переоткрывать: точка не передана в make');
      }
      await menu.open({ x: reopenPoint.x, y: reopenPoint.y });
    }

    /**
     * @param {string} setName
     * @returns {Array<MenuItem | SeparatorItem>}
     */
    function itemsOf(setName) {
      const items = sets[setName];
      if (items === undefined) {
        throw new Error(`в пробе нет набора ${setName}`);
      }
      return items;
    }

    /**
     * @param {string | null} id
     * @returns {HTMLElement | null}
     */
    function containerOf(id) {
      if (id === null) {
        return null;
      }
      const element = document.getElementById(id);
      return element instanceof HTMLElement ? element : null;
    }

    /**
     * @param {Element} item узел пункта или разделителя.
     * @returns {ItemView}
     */
    function readItem(item) {
      const label = item.querySelector('.vc-label');
      const owns = item.getAttribute('aria-owns');
      return {
        label: label === null ? '' : String(label.textContent),
        role: item.getAttribute('role') ?? '',
        tabindex: item.getAttribute('tabindex') ?? '',
        active: item.hasAttribute('data-active'),
        focused: item === document.activeElement,
        disabled: item.getAttribute('aria-disabled') === 'true',
        haspopup: item.getAttribute('aria-haspopup'),
        expanded: item.getAttribute('aria-expanded'),
        owns,
        ownsTarget: owns !== null && document.getElementById(owns) !== null,
        chevron: item.getAttribute('data-chevron'),
      };
    }

    /**
     * @returns {Snapshot}
     */
    function read() {
      const levels = Array.from(document.querySelectorAll('.vc-menu')).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.id,
          popoverOpen: element.matches(':popover-open'),
          marked: element.hasAttribute('data-probe'),
          closing: element.hasAttribute('data-vc-closing'),
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          items: Array.from(element.querySelectorAll('.vc-item, .vc-separator')).map((node) => {
            return readItem(node);
          }),
        };
      });
      const active = document.activeElement;
      const focused = active instanceof Element ? active.closest('.vc-item') : null;
      const focusedLabel = focused === null ? null : focused.querySelector('.vc-label');
      // Внутри меню — значит в дереве уровней, а не «на пункте»: фокус открытого
      // меню стоит на самом элементе уровня, и уровень без единого доступного пункта
      // держит фокус так же.
      return {
        levels,
        openCount: levels.filter((level) => {
          return level.popoverOpen;
        }).length,
        hideCount,
        focusOwnerId: active === null
          ? null
          : active.id === '' ? String(active.tagName).toLowerCase() : active.id,
        focusLabel: focusedLabel === null ? null : String(focusedLabel.textContent),
        focusInMenu: active instanceof Element && active.closest('.vc-menu') !== null,
        log: log.slice(),
        errors: errors.slice(),
        contextmenu: contextmenu.slice(),
        removed: removed.slice(),
        actionsSize: actionMaps.length === 0 ? -1 : actionMaps[actionMaps.length - 1].size,
      };
    }

    const probe = /** @type {McProbe} */ ({
      make(setName, containerId, point) {
        if (menu !== null) {
          menu.destroy();
        }
        currentSet = setName;
        log.length = 0;
        errors.length = 0;
        contextmenu.length = 0;
        removed.length = 0;
        // Счётчик обнуляется после сноса прежнего экземпляра: его закрытие — не
        // событие проверяемого кейса, и счётчик за него отвечать не должен.
        hideCount = 0;
        reopenPoint = point ?? null;
        menu = new MyContext(itemsOf(setName), { label: 'Меню файла' });
        const container = containerOf(containerId);
        if (container !== null) {
          menu.attach(container);
        }
      },
      attach(containerId) {
        const container = containerOf(containerId);
        if (container === null || menu === null) {
          throw new Error(`нет контейнера ${containerId}`);
        }
        menu.attach(container);
      },
      detach() {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.detach();
      },
      open(x, y) {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        return menu.open({ x, y });
      },
      openAsSubmenu(x, y) {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        return menu.openAsSubmenu(x, y);
      },
      close() {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.close();
      },
      destroy() {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.destroy();
      },
      markRoot() {
        const root = document.querySelector('.vc-menu');
        if (root === null) {
          throw new Error('меню не показано');
        }
        root.setAttribute('data-probe', '');
      },
      read,
      actionsSize() {
        if (actionMaps.length === 0) {
          throw new Error('карта действий не найдена');
        }
        return actionMaps[actionMaps.length - 1].size;
      },
      setAvailability(index, enabled) {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        const item = itemsOf(currentSet)[index];
        if (item === undefined || 'type' in item) {
          throw new Error('в наборе нет такого пункта');
        }
        // Предикат вешается на живом объекте набора — ровно то, что делает автор
        // между показами, когда смысл действия изменился.
        item.isEnabledAction = () => enabled;
      },
    });

    const scope = /** @type {{ __mc?: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc = probe;
  });
});

test.describe('жизненный цикл MyContext', () => {
  test('attach: contextmenu на контейнере открывает меню в точке клика и предотвращает системное', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    const after = await readMenu(page);
    expect(after.openCount, 'меню открыто').toBe(1);
    expect(after.levels).toHaveLength(1);
    // Точка клика и координаты меню связаны через позиционер: зазор от курсора до
    // края меню — константа, а не округление.
    expect(after.levels[0].rect.left, 'левый край меню').toBeCloseTo(
      WORKSPACE_POINT.x + CURSOR_OFFSET,
      2,
    );
    expect(after.levels[0].rect.top, 'верхний край меню').toBeCloseTo(
      WORKSPACE_POINT.y + CURSOR_OFFSET,
      2,
    );
    // Событие дошло до контейнера и было подавлено привязкой: системное меню не
    // показывается, а меню наше — открыто.
    expect(after.contextmenu).toEqual([{ container: 'workspace', prevented: true }]);
  });

  test('attach: отключённый пункт с подменю не открывает подменю мышью', async ({ page }) => {
    await makeMenu(page, 'disabled', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    await itemByLabel(page, 'Глухой').hover();
    // Показ по наведению есть с Task 10, но отключённый владелец им не открывается:
    // подписки на показ у него нет вовсе, потому что рендерер владельцем его не
    // считает. Видно и то, что уровень под ним не заведён: единственный след
    // заведённого, но не показанного уровня — ключ, который рендерер оставил в карте
    // действий, и набор ключей после показа от этого не растёт.
    const afterHover = await readMenu(page);
    expect(afterHover.openCount, 'открыт только корень').toBe(1);
    expect(afterHover.actionsSize, 'уровень подменю отключённого не заведён').toBe(4);
    // `aria-owns` у отключённого владельца нет вовсе, а не «есть, но узла за ним
    // нет»: висячая ссылка ушла вместе с признаком подменю.
    expect(afterHover.levels[0].items[0].owns, 'адрес подменю не зарезервирован').toBeNull();
    expect(afterHover.levels[0].items[0].ownsTarget, 'уровня под `aria-owns` нет и вовсе')
      .toBe(false);

    // `force` обязателен: проверка пригодности Playwright считает элемент с
    // `aria-disabled` непригодным и отказывается на него кликать, а настоящий
    // пользователь кликает по `div` без всяких проверок. Клик всё равно идёт
    // через настоящий ввод, а не через `dispatchEvent`.
    await itemByLabel(page, 'Глухой').click({ force: true });
    const afterClick = await readMenu(page);
    // Клик по отключённому пункту не выполняет его действие и не открывает подменю,
    // а меню остаётся открытым: закрывать было бы нечего.
    expect(afterClick.log, 'действие отключённого пункта не выполнено').toEqual([]);
    expect(afterClick.openCount, 'подменю не открыто').toBe(1);
    expect(afterClick.actionsSize, 'уровень так и не появился').toBe(4);

    // Клик по владельцу с непустым подменю открывает подменю, а его действие не
    // зовёт: журнал без строк здесь — не «обработчика нет», а правило владельца.
    await itemByLabel(page, 'Живой').click();
    const afterOwner = await readMenu(page);
    expect(afterOwner.log, 'действие владельца не вызвано').toEqual([]);
    expect(afterOwner.openCount, 'подменю владельца открыто').toBe(2);

    // Контроль живости: клик по пункту без подменю выполняет его действие и закрывает
    // меню. Раньше контролем был клик по владельцу, и он доказывал не то.
    //
    // Клавиши между шагами нет, и это не потеря шага, а его отсутствие по существу:
    // фокус после клика по владельцу стоит на владельце в корневом уровне, поэтому и
    // `Escape`, и `ArrowLeft` разбирались бы в корне и закрывали всё меню, а не
    // подменю. Клик после такого ушёл бы в закрытый уровень — он остаётся в разметке
    // и кликабелен, — и кейс прошёл бы, доказав обратное своему комментарию.
    expect((await readMenu(page)).openCount, 'меню живо, подменю открыто').toBe(2);

    await itemByLabel(page, 'Без подменю').click();
    const afterLeaf = await readMenu(page);
    expect(afterLeaf.log).toEqual(['без подменю']);
    expect(afterLeaf.openCount, 'меню закрылось после действия').toBe(0);
  });

  test('attach: отключённый пункт с подменю не открывает подменю по ArrowRight', async ({ page }) => {
    await makeMenu(page, 'disabled', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    // Показ меню выделения не оставляет: фокус стоит на элементе уровня, и отметок
    // нет ни на ком пункте. Раньше показ сразу отмечал первый доступный, и состояние
    // «ещё не тронуто» было недостижимо.
    const before = await readMenu(page);
    expect(before.focusLabel, 'выделения после показа нет').toBe(null);
    expect(activeLabels(before), 'отметок роуминга нет').toEqual([]);

    // Цикл роуминга пропускает отключённого владельца: первый шаг вниз встаёт на
    // второй пункт, а не на первый. Пока фокус не может встать на отключённого,
    // `ArrowRight` и не сможет открыть его подменю.
    await page.keyboard.press('ArrowDown');
    const atEmpty = await readMenu(page);
    expect(atEmpty.focusLabel, 'фокус прошёл мимо отключённого').toBe('Без подменю');
    expect(activeLabels(atEmpty)).toEqual([`${atEmpty.levels[0].id}:Без подменю`]);

    // Доступный владелец с непустым подменю — последний в наборе, и до него доходят
    // клавишей: `End` доводит активный пункт до последнего доступного.
    await page.keyboard.press('End');
    const atLive = await readMenu(page);
    expect(atLive.focusLabel, 'фокус на доступном владельце').toBe('Живой');

    await page.keyboard.press('ArrowRight');
    const afterRight = await readMenu(page);
    // Контроль: у доступного владельца подменю открывается, значит механизм
    // исправен и «не открылось» у отключённого — не пустое совпадение.
    expect(afterRight.openCount, 'подменю живого владельца открыто').toBe(2);
    // Фокус перенёс движок, а не показ: показ подменю фокус не трогает, и перенос
    // делает `moveTo` сразу после `openSubmenu`.
    expect(afterRight.focusLabel, 'фокус перешёл в подменю').toBe('Под живым');
    expect(afterRight.levels, 'заведены корень и одно подменю').toHaveLength(2);
    expect(openIds(afterRight), 'открыто подменю доступного владельца').toEqual([
      afterRight.levels[0].id,
      /** @type {string} */ (afterRight.levels[0].items[2].owns),
    ]);

    // Полный обход уровня: отключённый владелец не становится активным ни при
    // каком движении, а `ArrowRight` после обхода открывает то же подменю.
    await page.keyboard.press('Escape');
    /** @type {string[]} */
    const walked = [];
    for (const key of ['End', 'ArrowDown', 'Home', 'ArrowUp', 'End', 'Home']) {
      await page.keyboard.press(key);
      walked.push(...activeLabels(await readMenu(page)));
    }
    const levelId = before.levels[0].id;
    expect([...new Set(walked)].sort(), 'активными становились только доступные')
      .toEqual([`${levelId}:Живой`, `${levelId}:Без подменю`].sort());
    expect((await readMenu(page)).openCount, 'обход не открыл подменю отключённого').toBe(1);
  });

  test('пункты без id и с повторяющимся id вызывают свой action', async ({ page }) => {
    await makeMenu(page, 'ids', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    // Меню закрывается после каждой активации, поэтому между нажатиями его надо
    // открыть заново — иначе второй клик ушёл бы в закрытое меню, и порядок
    // журнала ничего не значил бы.
    for (const [position, label] of ['Без id', 'Первый x', 'Второй x', 'Y'].entries()) {
      if (position > 0) {
        await rightClick(page, WORKSPACE_POINT);
      }
      const before = await readMenu(page);
      expect(before.openCount, `меню открыто перед нажатием «${label}»`).toBe(1);
      await itemByLabel(page, label).click();
    }

    const after = await readMenu(page);
    // Поиск действия по авторскому `id` схлопнул бы два пункта с `id: 'x'` в один,
    // и второй из них вызвал бы первое действие либо не вызвал ничего.
    expect(after.log).toEqual(['без id', 'первый x', 'второй x', 'y']);
    expect(after.openCount, 'меню закрыто после последнего нажатия').toBe(0);
  });

  test('action бросает исключение — меню всё равно закрывается', async ({ page }) => {
    await makeMenu(page, 'throwing', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    await itemByLabel(page, 'Ломает').click();

    const after = await readMenu(page);
    // Клик мышью — единственный путь, на котором закрывает сам обработчик: движок
    // клавиатуры после активации закрывает меню отдельным вызовом, и на этом пути
    // его нет. Закрытие в `finally` обязано быть, иначе сломанный обработчик
    // оставил бы меню висеть.
    expect(after.openCount, 'меню закрыто').toBe(0);
    expect(after.errors, 'исключение дошло до страницы').toHaveLength(1);
    expect(after.errors[0]).toContain('действие сломано');
  });

  test('action бросает исключение — исключение не проглатывается, а close() отрабатывает в finally', async ({ page }) => {
    await makeMenu(page, 'throwing', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    // Контроль живости клавиатурного пути: тихое действие выполняется, ошибок нет.
    // Открытое меню выделения не имеет, и `Enter` без активного пункта молчит, — до
    // «Тихий» доходится шагом вниз.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const afterQuiet = await readMenu(page);
    expect(afterQuiet.log, 'тихое действие выполнено').toEqual(['тихий']);
    expect(afterQuiet.errors, 'тихое действие не сообщило об ошибке').toEqual([]);

    await rightClick(page, WORKSPACE_POINT);
    // Два шага вниз, а не один: показ не отмечает пунктов, и до «Ломает» от свежего
    // открытия нужно дойти через «Тихий».
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    const afterThrow = await readMenu(page);
    // Исключение обработчика не глотается: его получает вызывающий, а не библиотека.
    // Тихий прогон выше — контроль: пустой список ошибок у настоящей ошибки означал
    // бы, что страна их просто не собирает.
    expect(afterThrow.errors, 'ошибка не проглочена').toHaveLength(1);
    expect(afterThrow.errors[0]).toContain('действие сломано');
    expect(afterThrow.openCount, 'меню закрыто').toBe(0);
    expect(afterThrow.log, 'упавшее действие в журнал не попало').toEqual(['тихий']);
  });

  test('await open() без attach открывает меню в заданных координатах', async ({ page }) => {
    await makeMenu(page, 'flat', null);
    const after = await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);

    expect(after.openCount, 'меню открыто').toBe(1);
    expect(after.levels[0].rect.left).toBeCloseTo(WORKSPACE_POINT.x + CURSOR_OFFSET, 2);
    expect(after.levels[0].rect.top).toBeCloseTo(WORKSPACE_POINT.y + CURSOR_OFFSET, 2);
    // Меню обязано помещаться во вьюпорт с отступом, иначе оно уехало бы под край
    // вместе с частью своих пунктов.
    expect(after.levels[0].rect.left).toBeGreaterThanOrEqual(SAFETY_PADDING);
    expect(after.levels[0].rect.top).toBeGreaterThanOrEqual(SAFETY_PADDING);
    expect(after.levels[0].rect.left + after.levels[0].rect.width)
      .toBeLessThanOrEqual(VIEWPORT.width - SAFETY_PADDING);
    expect(after.levels[0].rect.top + after.levels[0].rect.height)
      .toBeLessThanOrEqual(VIEWPORT.height - SAFETY_PADDING);
    // Программное открытие не привязано ни к чему, но фокус всё равно уходит в меню:
    // иначе `ArrowDown` не работал бы на показанном меню. Стоит он на элементе
    // уровня, а не на пункте: выделения у только что открытого меню нет.
    expect(after.focusInMenu, 'фокус в меню').toBe(true);
    expect(after.focusLabel, 'выделения после открытия нет').toBe(null);
    await page.keyboard.press('ArrowDown');
    const withActive = await readMenu(page);
    expect(withActive.focusLabel, 'первая стрелка даёт первый пункт').toBe('Первый');
  });

  test('await open() на открытом меню проходит полный цикл: закрытие и показ в новой точке', async ({ page }) => {
    // Часы заморожены ради `reopenMenu`, который долистывает отложенный показ через
    // `fastForward`, а тот без установленных часов бросает. Под `reduce` цикл и так
    // проходит за один такт, то есть заморозка ничего не ускоряет и ничего не
    // проверяет — она только делает вызов хелпера допустимым.
    await page.clock.install();
    await makeMenu(page, 'flat', null);
    const first = await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);
    await markRoot(page);

    const second = await reopenMenu(page, 500, 400);

    expect(first.levels).toHaveLength(1);
    expect(second.levels, 'уровень один').toHaveLength(1);
    // Полный цикл, а не перепозиционирование. Без числа скрытий «закрылось и
    // открылось заново» и «перенеслось» дают один и тот же снимок, и кейс прошёл бы
    // на переносе — ровно на том, что перестало быть контрактом.
    expect(second.hideCount, 'меню скрылось и показалось заново').toBe(first.hideCount + 1);
    expect(second.openCount, 'открыт один уровень').toBe(1);
    // Метка на узле пережила цикл: уровень переиспользован, а не пересоздан.
    // Идентификатор уровня при пересоздании был бы тем же, и по нему сравнить
    // нельзя — сравнивается узел.
    expect(second.levels[0].id).toBe(first.levels[0].id);
    expect(second.levels[0].marked, 'тот же узел').toBe(true);
    // Показ состоялся в новой точке: под `reduce` цикл проходит за один такт, и
    // снимок читает результат ровно того `open()`, который его вызвал.
    expect(second.levels[0].rect.left).toBeCloseTo(500 + CURSOR_OFFSET, 2);
    expect(second.levels[0].rect.top).toBeCloseTo(400 + CURSOR_OFFSET, 2);
  });

  test('выходная анимация отиграна до показа в новой точке', async ({ page }) => {
    // `reduce` снят: под ним отложенность пропускается целиком, состояния «меню
    // гаснет в Top Layer» не существует, и кейс прошёл бы на показе без всякого
    // выхода — то есть проверял бы не анимацию, а её отсутствие.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Часы ставятся после ожидания таблицы стилей в `beforeEach`: `waitForFunction`
    // доходит до страницы кадрами браузера, а остановленное время кадров не даёт.
    //
    // Одного `install` мало, и это проверялось пробой: он подменяет таймеры, но не
    // останавливает ход времени, поэтому окно `data-vc-closing` — `animationDuration`
    // фальшивого времени — истекло за два круговых похода CDP между `open()` и
    // снимком, и кейс падал на `closing === true` после настоящего
    // `page.waitForTimeout(300)`. `pauseAt` останавливает время, и окно живёт
    // столько, сколько реального уйдёт на походы.
    await page.clock.install({ time: CLOCK_START_AT });
    await page.clock.pauseAt(CLOCK_FROZEN_AT);
    await makeMenu(page, 'flat', null);
    await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);
    await settleEntryAnimations(page);
    const first = await readMenu(page);
    expect(first.levels[0].closing, 'только что открытое меню не гаснет').toBe(false);
    expect(first.levels[0].rect.left, 'меню стоит в точке первого вызова')
      .toBeCloseTo(WORKSPACE_POINT.x + CURSOR_OFFSET, 2);

    // Отдельным `evaluate`: снимок, взятый в том же вызове, что и второй `open()`,
    // увидел бы уже показанное меню и ничего бы не сказал о промежутке.
    await startShow(page, 500, 400);

    // Выход идёт на месте, в Top Layer: `hidePopover` ещё не зван, но отметка
    // закрытия уже стоит, и `pointer-events` сняты. Показ отложен ровно на
    // `animationDuration` — столько же, сколько идёт выход, поэтому кадра без меню
    // не бывает. Время стоит, так что окно не кончится само между строками кейса:
    // сдвигает его только `fastForward` ниже.
    const fading = await readMenu(page);
    expect(fading.levels[0].closing, 'уровень гаснет на месте').toBe(true);
    expect(fading.openCount, 'уровень ещё в Top Layer').toBe(1);

    await page.clock.fastForward(DEFAULT_ANIMATION_DURATION * 2);
    await settleEntryAnimations(page);

    const after = await readMenu(page);
    // Показ снял отметку закрытия последним шагом, иначе вход не отыграл бы.
    expect(after.levels[0].closing, 'отметка снята показом').toBe(false);
    expect(after.openCount, 'меню показано').toBe(1);
    // Показ в новой точке, а не возврат в прежнюю: обе точки отличаются и по X, и
    // по Y, и точка показа — единственное, что отличает один от другого снаружи.
    expect(after.levels[0].rect.left).toBeCloseTo(500 + CURSOR_OFFSET, 2);
    expect(after.levels[0].rect.top).toBeCloseTo(400 + CURSOR_OFFSET, 2);
  });

  test('close() скрывает меню и возвращает фокус на элемент-владелец', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    // Фокус после показа в меню, но не на пункте: выделения у свежего меню нет, и
    // стоит он на элементе уровня, пока не нажата первая клавиша навигации.
    const shown = await readMenu(page);
    expect(shown.focusInMenu, 'фокус в меню после показа').toBe(true);
    expect(shown.focusLabel, 'выделения после показа нет').toBe(null);
    await page.keyboard.press('ArrowDown');
    const atFirst = await readMenu(page);
    expect(atFirst.focusLabel, 'фокус на первом пункте').toBe('Первый');

    const after = await closeMenu(page);

    expect(after.openCount, 'меню скрыто').toBe(0);
    // Закрытие отложено на анимацию, поэтому оставленный в гаснущем уровне фокус
    // ушёл бы в никуда: возвращать его — часть закрытия, а не украшение.
    expect(after.focusOwnerId, 'фокус на контейнере').toBe('workspace');
    expect(after.focusInMenu, 'фокус вне меню').toBe(false);
  });

  test('close() без attach не бросает и просто скрывает', async ({ page }) => {
    await makeMenu(page, 'flat', null);
    await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);

    // Вызов возвращается снимком: бросок из `page.evaluate` уронил бы кейс сам.
    const after = await closeMenu(page);

    expect(after.openCount, 'меню скрыто').toBe(0);
    // Закрытие не разрушает: уровень остаётся в DOM и переиспользуется следующим
    // `open()`. `destroy()` убрал бы его — и проверка на «просто скрывает» стала бы
    // проверкой на разрушение.
    expect(after.levels, 'уровень остался в документе').toHaveLength(1);
    // Куда упал фокус без привязки — вопрос платформы, а не контракта: возвращать
    // некуда, и библиотека не имеет права ни уводить фокус куда-то, ни требовать
    // привязки для закрытия. Поэтому утверждается одно: `close()` вернулся, а
    // браузер оставил активным элемент, на котором фокус и был.
    const afterSecond = await closeMenu(page);
    expect(afterSecond.levels, 'повторное закрытие тоже не разрушает').toHaveLength(1);
    expect(afterSecond.openCount).toBe(0);
  });

  test('destroy() удаляет все элементы меню из DOM', async ({ page }) => {
    await makeMenu(page, 'nested', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    // Показ не отмечает пункты, и `ArrowRight` без активного пункта молчит: до
    // владельца «Ветка» доходится шагом вниз.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');

    // Два уровня: снос только корневого оставил бы подменю висеть, и кейс на
    // единственном уровне прошёл бы.
    const before = await readMenu(page);
    expect(before.levels).toHaveLength(2);
    expect(before.openCount, 'открыты оба уровня').toBe(2);

    const after = await destroyMenu(page);

    expect(after.levels, 'в документе не осталось уровней').toHaveLength(0);
    expect(after.openCount).toBe(0);
    expect(after.focusInMenu, 'фокус не остался в удалённом меню').toBe(false);
  });

  test('destroy() идемпотентен: повторный вызов не бросает', async ({ page }) => {
    await makeMenu(page, 'nested', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    const first = await destroyMenu(page);
    expect(first.levels).toHaveLength(0);

    // Второй вызов упал бы внутрь `page.evaluate` и уронил кейс: размонтирование
    // вызывает `destroy()` не один раз, и ошибка в нём была бы ошибкой вызывающего
    // кода.
    const second = await destroyMenu(page);
    expect(second.levels).toHaveLength(0);
  });

  test('клик по пункту-владельцу открывает подменю и не вызывает его action, а лист вызывает свой', async ({ page }) => {
    await makeMenu(page, 'mixed', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    await itemByLabel(page, 'Владелец').click();
    const afterOwner = await readMenu(page);
    // Открылось подменю, а не «ничего»: уровень владельца заведён на шаг вперёд
    // при показе корня, и клик по владельцу его показывает.
    expect(afterOwner.openCount, 'подменю открыто').toBe(2);
    expect(openIds(afterOwner), 'открыто подменю владельца').toEqual([
      afterOwner.levels[0].id,
      /** @type {string} */ (afterOwner.levels[0].items[0].owns),
    ]);
    // Правило владельца: его собственное действие не вызывается. Журнал пуст не
    // потому, что обработчика нет, — вторая половина кейса это доказывает.
    expect(afterOwner.log, 'action владельца не вызван').toEqual([]);
    // Фокус остался в родительском уровне, на самом владельце: показ подменю мышью
    // фокус не переносит (спека 6.2), и переносом занимается только движок.
    expect(afterOwner.focusLabel, 'фокус на владельце в родительском уровне').toBe('Владелец');
    expect(afterOwner.focusInMenu, 'фокус не покинул меню').toBe(true);

    // `Escape` между шагами больше не нужен и был бы неверным: фокус в корневом
    // уровне, и `Escape` закрыл бы всё меню, а не подменю.
    await itemByLabel(page, 'Лист').click();
    const afterLeaf = await readMenu(page);
    // Пункт без подменю активируется как прежде и закрывает меню.
    expect(afterLeaf.log, 'action листа вызван').toEqual(['лист']);
    expect(afterLeaf.openCount, 'меню закрыто').toBe(0);
  });

  test('клик по пункту без action закрывает меню', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    expect((await readMenu(page)).openCount, 'меню открыто').toBe(1);

    await itemByLabel(page, 'Первый').click();

    const after = await readMenu(page);
    // Отсутствие обработчика не причина оставить меню висеть. Без этого закрытия
    // «меню не открылось» и «открытое меню пережило клик» различались бы только
    // снимком до клика, а он и проверяет, что меню было открыто.
    expect(after.openCount, 'меню закрылось и без обработчика').toBe(0);
    // Журнал пуст по построению: у набора `flat` действий нет ни у одного пункта, и
    // контроль живости — кейс про `ids`, где действие есть и срабатывает.
    expect(after.log, 'обработчиков не вызывалось').toEqual([]);
    expect(after.errors, 'страница без ошибок').toEqual([]);

    // Тот же пункт с клавиатуры. Закрывает его не движок, а тот же единственный
    // обработчик активации, до которого доходит синтетический `click`, — и без
    // клетки «`Enter`/`Space` по пункту без `action`» этот путь остался бы не
    // покрытым вовсе.
    await rightClick(page, WORKSPACE_POINT);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const afterKey = await readMenu(page);
    expect(afterKey.openCount, 'Enter по пункту без action закрыл меню').toBe(0);
    expect(afterKey.log, 'обработчиков не вызывалось и с клавиатуры').toEqual([]);
    expect(afterKey.errors, 'клавиатурный путь не бросил').toEqual([]);
  });

  test('клик по разделителю, отключённому пункту и владельцу подменю не закрывает меню', async ({ page }) => {
    await makeMenu(page, 'nonclosing', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    const opened = await readMenu(page);
    expect(opened.openCount, 'меню открыто').toBe(1);
    const rootId = opened.levels[0].id;

    // Порядок кликов — часть расчёта, а не оформления: подменю раскрывает только
    // последний клик, и пока оно не раскрыто, ни одна точка уровня не занята
    // вторым поповером. Обратный порядок проверял бы уже другое — клик по
    // родительскому уровню при висящем подменю, — и «меню не закрылось» там
    // означало бы совсем не то.
    await separatorItem(page, rootId).click();
    const afterSeparator = await readMenu(page);
    expect(openIds(afterSeparator), 'разделитель меню не закрыл').toEqual([rootId]);

    // `force` обязателен: проверка пригодности Playwright считает элемент с
    // `aria-disabled` непригодным и отказывается на него кликать, а настоящий
    // пользователь кликает по `div` без всяких проверок.
    await itemByLabel(page, 'Отключённый').click({ force: true });
    const afterDisabled = await readMenu(page);
    expect(openIds(afterDisabled), 'отключённый пункт меню не закрыл').toEqual([rootId]);

    await itemByLabel(page, 'Владелец').click();
    const afterOwner = await readMenu(page);
    // Клик по владельцу не закрывает, а раскрывает его подменю: закрывать нечего,
    // потому что действие владельца не зовётся вовсе. Открытые уровни названы
    // поимённо, а не посчитаны: «открыт и корень» и «открыт один корень» — разные
    // утверждения, и счётчик их не различает.
    const root = /** @type {LevelView} */ (afterOwner.levels.find((level) => level.id === rootId));
    const submenuId = /** @type {string} */ (root.items[2].owns);
    expect(openIds(afterOwner), 'подменю владельца раскрыто, корень на месте').toEqual([rootId, submenuId]);
    // Ни один обработчик не зван: у всех трёх строк клик уходит на ветку, которая
    // закрывать нечем, и журнал это подтверждает.
    expect(afterOwner.log, 'ни одно действие не вызвано').toEqual([]);
    expect(afterOwner.errors, 'страница без ошибок').toEqual([]);
  });

  test('action, вызвавший await open(), не отменяется отложенным закрытием', async ({ page }) => {
    // Часы замораживаются здесь, а не в `beforeEach`: файл держит настоящее время,
    // и заморозка в общей фикстуре остановила бы таймеры hover intent у всех его
    // кейсов. Этому кейцу нужна ровно одна вещь — пережить время, — и пауза после
    // клика поставлена затем, чтобы кейс не прошёл на закрытии, отложенном на
    // `animationDuration`: снимок снял бы ещё живое меню и ничего бы не сказал.
    await page.clock.install();
    await makeMenu(page, 'reopening', 'workspace', REOPEN_POINT);
    const opened = await rightClickAndRead(page);
    expect(opened.openCount, 'меню открыто').toBe(1);
    expect(opened.levels[0].rect.left, 'меню открыто в точке клика').toBeCloseTo(
      WORKSPACE_POINT.x + CURSOR_OFFSET,
      2,
    );

    await itemByLabel(page, 'Переоткрыть').click();
    await page.clock.fastForward(DEFAULT_ANIMATION_DURATION * 2);

    const after = await readMenu(page);
    // Журнал доказывает, что действие сработало: без него «меню открыто в новой
    // точке» прошло бы на клике, который не сделал ничего.
    expect(after.log, 'действие сработало').toEqual(['переоткрыть']);
    // Меню не просто живо, а живо там, куда его переоткрыло действие: закрытие,
    // начатое обработчиком активации после действия, убило бы то, что только что
    // открыто.
    expect(after.openCount, 'меню открыто в новой точке, а не закрыто').toBe(1);
    expect(after.levels[0].rect.left, 'меню уехало по горизонтали').toBeCloseTo(
      REOPEN_POINT.x + CURSOR_OFFSET,
      2,
    );
    expect(after.levels[0].rect.top, 'меню уехало по вертикали').toBeCloseTo(
      REOPEN_POINT.y + CURSOR_OFFSET,
      2,
    );
    expect(after.errors, 'страница без ошибок').toEqual([]);

    // Тот же пункт, но действие после переоткрытия бросает. Пропуск закрытия не
    // имеет права проглотить ошибку: `return` из `finally` заменил бы её своим
    // значением, и страница узнала бы об ошибке обработчика только по тому, что
    // меню куда-то делось. Ошибка обязана дойти до страницы целиком, а меню —
    // остаться там, куда его переоткрыло действие.
    await rightClick(page, WORKSPACE_POINT);
    expect((await readMenu(page)).openCount, 'меню снова открыто').toBe(1);
    await itemByLabel(page, 'Сломать после переоткрытия').click();

    const afterThrow = await readMenu(page);
    // Журнал содержит обе половины кейса: он общий для экземпляра, а `make` сбрасывает
    // его один раз, до первой половины.
    expect(afterThrow.log, 'действие сработало и упало').toEqual([
      'переоткрыть',
      'сломать после переоткрытия',
    ]);
    expect(afterThrow.errors, 'ошибка не проглочена').toHaveLength(1);
    expect(afterThrow.errors[0]).toContain('переоткрытие сломано');
    expect(afterThrow.openCount, 'меню осталось в точке переоткрытия').toBe(1);
    expect(afterThrow.levels[0].rect.left, 'меню уехало по горизонтали').toBeCloseTo(
      REOPEN_POINT.x + CURSOR_OFFSET,
      2,
    );
  });

  test('attach() бросает Error с названием требования, если браузер не умеет Popover API', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');

    const result = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      const proto = /** @type {{ showPopover?: unknown }} */ (
        /** @type {unknown} */ (globalThis.HTMLElement.prototype)
      );
      const native = proto.showPopover;
      delete proto.showPopover;
      /** @type {string | null} */
      let message = null;
      try {
        scope.__mc.attach('workspace');
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      // Возврат настоящего метода в том же кадре и повторная привязка: без них кейс
      // прошёл бы и на «attach бросает всегда», и не доказывал бы, что дело в
      // проверке поддержки.
      if (native !== undefined) {
        proto.showPopover = native;
      }
      scope.__mc.attach('workspace');
      return message;
    });

    expect(result, 'attach бросил').not.toBeNull();
    expect(/** @type {string} */ (result)).toContain('showPopover');
    expect(/** @type {string} */ (result)).toContain('Popover API');

    // Возврат методов после кейса обязателен: следующие кейсы живут в той же
    // странице, и без восстановления `attach` падал бы у всех.
    const after = await rightClickAndRead(page);
    expect(after.openCount, 'меню открылось после восстановления').toBe(1);
  });

  test('attach, open, openAsSubmenu, close и detach после destroy() бросают Error', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await destroyMenu(page);

    const messages = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      const probe = scope.__mc;
      /** @type {Array<string | null>} */
      const results = [];
      for (const call of [
        () => {
          probe.attach('workspace');
        },
        () => {
          probe.open(300, 200);
        },
        () => {
          probe.openAsSubmenu(300, 200);
        },
        () => {
          probe.close();
        },
        () => {
          probe.detach();
        },
      ]) {
        try {
          call();
          results.push(null);
        } catch (error) {
          results.push(error instanceof Error ? error.message : String(error));
        }
      }
      return results;
    });

    // `destroy()` после `destroy()` не бросает — это отдельный кейс: размонтирование
    // обязано иметь право позвать его ещё раз.
    expect(messages).toEqual([
      'MyContext: экземпляр уничтожен',
      'MyContext: экземпляр уничтожен',
      'MyContext: экземпляр уничтожен',
      'MyContext: экземпляр уничтожен',
      'MyContext: экземпляр уничтожен',
    ]);
  });

  test('destroy() снимает слушатель contextmenu с контейнера', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    const removed = (await destroyMenu(page)).removed;
    // Снятие с самого контейнера, а не с документа и не с меню: иначе привязка
    // пережила бы экземпляр и держала бы его замыканием. Сравнение по присутствию, а
    // не по точному составу массива: снимать слушатели будут и Tasks 10–11, и
    // требование «лишних снятий нет» к ним не относится.
    expect(removed).toContainEqual({ type: 'contextmenu', target: 'workspace' });

    await rightClick(page, WORKSPACE_POINT);

    const after = await readMenu(page);
    // Клик дошёл до контейнера — иначе «меню не открылось» ничего бы не значило, —
    // но никто его не подавил и ни одного уровня не появилось.
    expect(after.contextmenu).toEqual([{ container: 'workspace', prevented: false }]);
    expect(after.levels, 'меню не построено').toHaveLength(0);
    expect(after.openCount).toBe(0);
  });

  test('detach() снимает привязку: правый клик по контейнеру больше не открывает меню', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    const detached = await detachMenu(page);
    expect(detached.removed, 'слушатель снят с контейнера').toContainEqual({
      type: 'contextmenu',
      target: 'workspace',
    });

    await rightClick(page, WORKSPACE_POINT);

    const after = await readMenu(page);
    expect(after.contextmenu).toEqual([{ container: 'workspace', prevented: false }]);
    expect(after.levels, 'меню не построено').toHaveLength(0);
    expect(after.openCount).toBe(0);
  });

  test('detach() не уничтожает экземпляр: await open() после detach() всё ещё работает', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await detachMenu(page);

    const after = await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);

    expect(after.openCount, 'меню открыто').toBe(1);
    // Фокус в меню, но на элементе уровня: выделения у только что открытого меню нет.
    expect(after.focusInMenu, 'фокус в меню').toBe(true);
    expect(after.focusLabel, 'выделения после открытия нет').toBe(null);
  });

  test('attach: повторный attach переносит привязку на новый контейнер', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await attachMenu(page, 'second');

    await rightClick(page, WORKSPACE_POINT);
    const afterFirst = await readMenu(page);
    // Старый контейнер молча освобождён: без этого у экземпляра было бы два
    // контейнера, и меню открывалось бы с двух сторон.
    expect(afterFirst.contextmenu).toEqual([{ container: 'workspace', prevented: false }]);
    expect(afterFirst.levels, 'старый контейнер меню не открывает').toHaveLength(0);

    await rightClick(page, SECOND_POINT);
    const afterSecond = await readMenu(page);
    expect(afterSecond.contextmenu).toHaveLength(2);
    expect(afterSecond.contextmenu[1]).toEqual({ container: 'second', prevented: true });
    expect(afterSecond.openCount, 'новый контейнер открывает').toBe(1);
  });

  test('destroy() очищает карту actions целиком', async ({ page }) => {
    const sizes = await page.evaluate(async () => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      const probe = scope.__mc;
      probe.make('nested', 'workspace');
      await probe.open(300, 200);
      // Два уровня — два ключа: карта принадлежит экземпляру целиком, а не уровню.
      const before = probe.actionsSize();
      probe.destroy();
      return { before, after: probe.actionsSize() };
    });

    // Точное число, а не «больше нуля»: так проверка убеждается и в том, что поймала
    // именно карту действий, а не какую-нибудь другую карту страницы.
    expect(sizes.before, 'ключ корня и ключ подменю').toBe(2);
    expect(sizes.after, 'карта пуста').toBe(0);
  });

  test('возврат фокуса идемпотентен: close() дважды подряд оставляет фокус на элементе привязки', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    // `Escape` на корневом уровне — двойной возврат: движок зовёт `closeAll()`, а тот
    // возвращает фокус сам, и следом движок зовёт `focusOwner()` ещё раз.
    await page.keyboard.press('Escape');
    const afterEscape = await readMenu(page);
    expect(afterEscape.openCount, 'меню закрыто').toBe(0);
    expect(afterEscape.focusOwnerId, 'фокус на контейнере').toBe('workspace');

    // Фокус уводят в сторону: если бы `close()` обнулял владельца при возврате,
    // второй вызов уже ничего бы не вернул — и это отличалось бы от поведения
    // живого экземпляра только в этом сценарии.
    await page.evaluate(() => {
      const outside = document.getElementById('outside');
      if (outside !== null) {
        outside.focus();
      }
    });
    const moved = await readMenu(page);
    expect(moved.focusOwnerId, 'фокус уведён в сторону').toBe('outside');

    const afterSecond = await closeMenu(page);
    expect(afterSecond.focusOwnerId, 'повторный close() вернул фокус').toBe('workspace');
  });

  test('повторный await open() снова регистрирует уровень в движке клавиатуры', async ({ page }) => {
    await makeMenu(page, 'flat', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    await closeMenu(page);

    await rightClick(page, WORKSPACE_POINT);
    const reopened = await readMenu(page);
    // `close()` сбросил реестр движка, и второй `open()` обязан отдать уровень
    // заново: без `registerLevel` меню было бы открытым, но мёртвым для клавиатуры.
    // Фокус после показа стоит на элементе уровня, а не на пункте: выделения у
    // только что открытого меню нет.
    expect(reopened.openCount, 'меню снова открыто').toBe(1);
    expect(reopened.focusInMenu, 'фокус снова в меню').toBe(true);
    expect(reopened.focusLabel, 'выделения после открытия нет').toBe(null);

    await page.keyboard.press('ArrowDown');
    const afterDown = await readMenu(page);
    expect(afterDown.focusLabel, 'стрелка даёт первый пункт').toBe('Первый');
    expect(activeLabels(afterDown)).toEqual([`${afterDown.levels[0].id}:Первый`]);
    await page.keyboard.press('ArrowDown');
    const afterSecond = await readMenu(page);
    expect(afterSecond.focusLabel, 'стрелка двигает активный пункт').toBe('Второй');
    expect(activeLabels(afterSecond)).toEqual([`${afterSecond.levels[0].id}:Второй`]);
  });

  test('attach: пункт с submenu: [] не владелец: ни шеврона, ни aria-owns, Enter активирует его', async ({ page }) => {
    await makeMenu(page, 'disabled', 'workspace');
    await rightClick(page, WORKSPACE_POINT);

    const before = await readMenu(page);
    const empty = before.levels[0].items[1];
    expect(empty.label).toBe('Без подменю');
    expect(empty.owns, 'у пустого подменю нет `aria-owns`').toBeNull();
    expect(empty.chevron, 'у пустого подменю нет шеврона').toBeNull();
    expect(empty.haspopup, 'у пустого подменю нет `aria-haspopup`').toBeNull();
    // Контроль живости: сосед с непустым подменю — владелец по разметке, и разница
    // между ними читается в одном снимке.
    expect(before.levels[0].items[2].owns, 'у непустого подменю `aria-owns` есть').not.toBeNull();
    // Фокус стоит на «Пустом»: цикл прошёл через него, значит уровень зарегистрирован
    // в движке, и `Enter` дойдёт до обработчика.
    await page.keyboard.press('Home');
    const atEmpty = await readMenu(page);
    expect(atEmpty.focusLabel, 'фокус на владельце пустого подменю').toBe('Без подменю');

    await page.keyboard.press('Enter');
    const after = await readMenu(page);
    // `Enter` активирует пункт, а не открывает пустое подменю, и закрывает меню.
    expect(after.log, 'пункт активирован').toEqual(['без подменю']);
    // Заведённого, но не показанного уровня в разметке нет вовсе — он отцепленный
    // узел, — поэтому «уровень не заведён» проверяется по карте действий: три ключа
    // корня и один ключ подменю доступного владельца, ни одного от пустого.
    expect(after.actionsSize, 'уровень пустого подменю не заведён').toBe(4);
    expect(after.openCount, 'подменю не появилось').toBe(0);
  });

  test('attach: отключённый пункт с непустым подменю не владелец: ни шеврона, ни aria-owns, его уровень не заводится', async ({ page }) => {
    await makeMenu(page, 'disabled', 'workspace');
    await rightClick(page, WORKSPACE_POINT);
    // Подменю доступного владельца открывается, и только теперь его уровень
    // попадает в документ: заведённый, но не показанный уровень живёт
    // отцепленным узлом, и в разметке его следов нет — ни одного `id` в документе
    // до показа. Различать «уровень заведён» и «не заведён» приходится по тому,
    // что попало в карту действий.
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');

    const after = await readMenu(page);
    const deaf = after.levels[0].items[0];
    const live = after.levels[0].items[2];
    // Владелец — это одно условие: непустое подменю И доступный пункт.
    // Отключённый пункт с непустым подменю владельцем не является, и все признаки
    // подменю у него отсутствуют: обещать раскрытие, которого не будет, не должен
    // ни один слой. До Task 10 разметку ставил рендерер по непустоте подменю
    // независимо от доступности, и кейс закреплял обратное утверждение.
    expect(deaf.label).toBe('Глухой');
    expect(deaf.disabled).toBe(true);
    expect(deaf.chevron, 'у отключённого пункта шеврона нет').toBeNull();
    expect(deaf.owns, 'адрес подменю не зарезервирован').toBeNull();
    expect(deaf.haspopup, 'нет `aria-haspopup`').toBeNull();
    // Контроль в том же снимке: сосед с непустым подменю и доступный сохраняет
    // все признаки, и разница между ними читается рядом.
    expect(live.label).toBe('Живой');
    expect(live.chevron, 'у доступного владельца шеврон есть').toBe('right');
    expect(live.owns, 'у доступного владельца адрес зарезервирован').not.toBeNull();
    // А уровня под отключённым нет: он в цикл роуминга не входит и активным не
    // станет, поэтому заводить ему уровень незачем. Три ключа корня плюс один
    // ключ подменю живого владельца — ровно четыре; снятие фильтра по
    // доступности дало бы пять.
    expect(after.levels, 'заведены корень и одно подменю').toHaveLength(2);
    expect(after.actionsSize, 'уровень отключённого владельца не заведён').toBe(4);
    expect(live.ownsTarget, 'уровень доступного владельца показан').toBe(true);
    expect(deaf.ownsTarget, 'у отключённого пункта нет и адреса, и уровня').toBe(false);
    expect(openIds(after), 'открыто подменю доступного владельца').toEqual([
      after.levels[0].id,
      /** @type {string} */ (live.owns),
    ]);
  });

  test('attach: предикат, ответивший false между показами, действует при следующем показе', async ({ page }) => {
    await makeMenu(page, 'disabled', 'workspace');
    const first = await rightClickAndRead(page);
    // Метка на уровне переживает переиспользование узла и не переживает
    // пересоздания: это и есть «уровень и его пункты не пересоздаются» из
    // README, проверенное снаружи, а не по внутреннему состоянию.
    await markRoot(page);
    const live = first.levels[0].items[2];
    expect(live.label).toBe('Живой');
    expect(live.disabled, 'до правки пункт доступен').toBe(false);
    expect(live.owns, 'у владельца зарезервирован адрес подменю').not.toBeNull();
    expect(live.chevron, 'у владельца есть шеврон').toBe('right');

    await closeMenu(page);
    // Смысл действия изменился, и автор выключает пункт. Меню при этом не
    // пересоздаётся — тот же экземпляр, тот же уровень, — и именно поэтому поле
    // обязано доезжать до показанного уровня, а не остаться в конфигурации.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.setAvailability(2, false);
    });
    const second = await rightClickAndRead(page);

    // Уровень тот же самый: снимок помечен пробой, и метка пережила показ.
    expect(second.levels[0].marked, 'уровень переиспользован, а не пересоздан').toBe(true);
    const after = second.levels[0].items[2];
    expect(after.label, 'пункт на месте').toBe('Живой');
    expect(after.disabled, 'помечен отключённым').toBe(true);
    // Владелец, который раскрыть нечем, не обещает раскрытия: ни шеврона, ни
    // `aria-haspopup`, ни зарезервированного адреса.
    expect(after.chevron, 'шеврон убран').toBeNull();
    expect(after.haspopup, 'нет `aria-haspopup`').toBeNull();
    expect(after.owns, 'адрес подменю отпущен').toBeNull();
    // Сосед не задет: правка одного пункта не имеет права выкинуть другой.
    expect(second.levels[0].items[1].disabled, 'сосед не отключён').toBe(false);
  });

  test('attach: пункт, отключённый между показами, выпадает из кольца и не кликается', async ({ page }) => {
    await makeMenu(page, 'disabled', 'workspace');
    await rightClickAndRead(page);
    await closeMenu(page);
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.setAvailability(2, false);
    });
    const opened = await rightClickAndRead(page);

    // Доступных пунктов осталось два: «Без подменю» и «Глухой» ушли, «Живой» добавлен
    // к отключённым. Кольцо идёт по порядку, и `End` обязан встать на «Без подменю».
    await page.keyboard.press('End');
    const atEnd = await readMenu(page);
    expect(atEnd.focusLabel, 'последний доступный — «Без подменю»').toBe('Без подменю');

    // Клик по отключённому не действие: иначе у автора не было бы способа
    // выключить действие, смысл которого изменился. `force` обязателен: Playwright
    // element с `aria-disabled` считает непригодным и на него не кликает.
    await itemByLabel(page, 'Живой').click({ force: true });
    const afterClick = await readMenu(page);
    expect(afterClick.log, 'действие не вызвано').toEqual([]);
    expect(afterClick.openCount, 'меню не закрыто').toBe(1);
    expect(afterClick.focusInMenu, 'фокус в меню').toBe(true);
    // `ArrowRight` на отключённом владельце не открывает подменю: раскрывать
    // нечего, и открытое подменю было бы меню без пути к закрытию.
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    const afterRight = await readMenu(page);
    expect(openIds(afterRight), 'подменю не открылось').toEqual([afterRight.levels[0].id]);
  });

  for (const closing of CLOSINGS) {
    test(`окно закрытия отменяет отложенный показ: ${closing.title}`, async ({ page }) => {
      // Настоящие часы и снятый `reduce` обязательны: под `reduce` отложенность
      // пропускается целиком, окна между сокрытием и показом не существует, и кейс
      // проверял бы не отмену показа, а её отсутствие.
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await makeMenu(page, 'flat', 'workspace');
      await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);
      await startShow(page, SECOND_POINT.x, SECOND_POINT.y);
      const inWindow = await readMenu(page);
      // Окно существует: уровень гаснет на месте и ещё в Top Layer. Без этого
      // снимка «отложенный показ отменён» ничего бы не говорила — с равным успехом
      // прошла бы и синхронная реализация без всякой отложенности.
      expect(inWindow.levels[0].closing, 'меню гаснет, а не показано').toBe(true);
      expect(inWindow.openCount, 'уровень ещё в Top Layer').toBe(1);

      await closing.apply(page);

      // Трёх анимаций достаточно: и сокрытие, и показ стоят на
      // `animationDuration`, и закрытие снимает обе задачи.
      await page.waitForTimeout(DEFAULT_ANIMATION_DURATION * 3);

      const after = await readMenu(page);
      expect(after.openCount, 'отложенный показ отменён закрытием').toBe(0);
    });
  }

  test('destroy() в окне закрытия не воскрешает меню', async ({ page }) => {
    // Настоящие часы и снятый `reduce` — по той же причине, что и в кейсе про
    // способы закрытия: окно между сокрытием и показом под `reduce` не бывает.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    /** @type {string[]} */
    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(String(error));
    });
    await makeMenu(page, 'flat', 'workspace');
    await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);
    await startShow(page, SECOND_POINT.x, SECOND_POINT.y);
    const inWindow = await readMenu(page);
    expect(inWindow.levels[0].closing, 'меню гаснет, а не показано').toBe(true);

    const after = await destroyMenu(page);
    await page.waitForTimeout(DEFAULT_ANIMATION_DURATION * 3);

    const later = await readMenu(page);
    // Оба снимка обязательны: по первому видно, что `destroy()` снёс уровни, по
    // второму — что отложенный показ не вернул их в документ. Снимок после
    // ожидания показал бы ноль уровней и на воскрешённом меню, если бы воскресшее
    // не показалось сразу.
    expect(after.levels, 'уровни сняты destroy()').toHaveLength(0);
    expect(later.levels, 'отложенный показ не воскресил меню').toHaveLength(0);
    expect(later.openCount).toBe(0);
    // Показ, доигравший после `destroy()`, бросил бы наружу ошибку слоя; страница
    // обязана остаться чистой.
    expect(pageErrors, 'страница без ошибок').toEqual([]);
  });

  test('второй правый клик в окне закрытия начинает цикл заново', async ({ page }) => {
    // Снятый `reduce` обязателен: под ним отложенность пропускается целиком и окна
    // между сокрытием и показом не бывает. Часы, наоборот, остановлены целиком, и
    // это не украшение: кейс держит запас в единицы миллисекунд фальшивого времени,
    // и при живых часах он таял бы на круговых походах CDP, а с ним рушилась бы
    // вся проверка — и «цикл начался заново», и «кадра без меню не было». Часы
    // ставятся после ожидания таблицы стилей в `beforeEach`: `waitForFunction`
    // доходит до страницы кадрами браузера, а остановленное время кадров не даёт.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.clock.install({ time: CLOCK_START_AT });
    await page.clock.pauseAt(CLOCK_FROZEN_AT);
    await makeMenu(page, 'flat', 'workspace');
    await openMenu(page, 200, 150);
    await startShow(page, 400, 300);
    const inWindow = await readMenu(page);
    // «Открытое» меню в окне — это и висящий показ, а не только непустая цепочка:
    // без этого третье нажатие сочло бы меню закрытым и прошло бы мимо цикла.
    expect(inWindow.levels[0].closing, 'второй вызов оставил меню гаснущим').toBe(true);

    // Третий вызов приходит, когда выход от второго ещё не доигран: до сокрытия
    // осталось меньше, чем длительность анимации. Запас в 10 мс фальшивого времени
    // ничем не перекрывается, и именно потому работает: время стоит, сколько бы
    // реального ни ушло на походы до третьего `open()`.
    await page.clock.fastForward(DEFAULT_ANIMATION_DURATION - 10);
    await startShow(page, 600, 450);
    const restarted = await readMenu(page);

    // Третий вызов пустил цикл заново, а не показал меню немедленно поверх
    // гаснущего. Без этой проверки кейс прошёл бы и на том порядке, который спека
    // запрещает: итоговое состояние у обоих вариантов одно и то же — меню в третьей
    // точке, — и отличаются они только тем, было ли меню в промежутке.
    expect(restarted.levels[0].closing, 'третий вызов снова пустил цикл').toBe(true);
    expect(restarted.openCount, 'уровень гаснет, а не показан').toBe(1);

    // Гашение началось заново, то есть оба отложенных действия отсчитывают одно и
    // то же `animationDuration` от третьего вызова. Без перезапуска задача сокрытия
    // осталась бы от второго вызова и ушла раньше задачи показа, а между ними был бы
    // кадр без меню — тот самый, ради которого порядок постановки и выбран.
    await page.clock.fastForward(DEFAULT_ANIMATION_DURATION - 20);
    const during = await readMenu(page);
    expect(during.openCount, 'между гашением и показом меню остаётся в Top Layer').toBe(1);
    expect(during.levels[0].closing, 'меню ещё гаснет').toBe(true);

    await page.clock.fastForward(DEFAULT_ANIMATION_DURATION * 3);
    await settleEntryAnimations(page);

    const after = await readMenu(page);
    // Показан ровно один уровень и стоит он в третьей точке: третий вызов отменил
    // показ второго и поставил свой, а не показал меню немедленно поверх
    // гаснущего и не вернул его во вторую точку.
    expect(after.openCount, 'показан один уровень').toBe(1);
    expect(after.levels[0].rect.left, 'меню в третьей точке по горизонтали')
      .toBeCloseTo(600 + CURSOR_OFFSET, 2);
    expect(after.levels[0].rect.top, 'меню в третьей точке по вертикали')
      .toBeCloseTo(450 + CURSOR_OFFSET, 2);
  });
  test('blur окна при уже возвращённом фокусе меню не закрывает', async ({ page }) => {
    // Окно теряет фокус и возвращает его внутри одного щелчка по самой странице, и
    // браузер под управлением делает это на каждом вводе. Меню обязано отличать такой
    // `blur` от ухода в другое приложение: иначе оно закрывалось бы на каждом щелчке
    // внутри страницы, то есть не открывалось бы вовсе и правый клик по контейнеру
    // не работал бы ни разу. Различает их `document.hasFocus()`: при возвращённом
    // фокусе он истинен, а после ухода к строке браузера или в другое приложение —
    // ложен.
    await makeMenu(page, 'nested', 'workspace');
    await rightClickAndRead(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    expect((await readMenu(page)).openCount, 'открыты корень и подменю').toBe(2);
    // Премисса: документ в фокусе, иначе проверялось бы не различение, а уход.
    expect(await page.evaluate(() => document.hasFocus()), 'документ в фокусе').toBe(true);

    await page.evaluate(() => {
      globalThis.dispatchEvent(new Event('blur'));
    });

    const after = await readMenu(page);
    expect(after.openCount, 'меню осталось открытым').toBe(2);
    expect(after.errors, 'страница без ошибок').toEqual([]);
  });
  test('visibilitychange при уходе вкладки в фон закрывает меню, при возврате — нет', async ({ page }) => {
    await makeMenu(page, 'nested', 'workspace');
    await rightClickAndRead(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    expect((await readMenu(page)).openCount, 'открыты корень и подменю').toBe(2);

    // `hidden` — только для чтения, и подменить его можно `defineProperty`. Событие
    // приходит и при возвращении вкладки, поэтому обработчик обязан читать
    // состояние: закрывать на `visible` было бы закрытием на входе.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const hidden = await readMenu(page);
    expect(hidden.openCount, 'меню закрыто').toBe(0);
    // Фокус не на показанном уровне: скрытый поповер остаётся в разметке, и проверка
    // на «внутри дерева» ничего бы не сказала.
    const levelIds = hidden.levels.map((level) => level.id);
    expect(levelIds, 'фокус не на уровне меню').not.toContain(hidden.focusOwnerId);
    expect(hidden.errors, 'страница без ошибок').toEqual([]);

    // Возврат на ту же вкладку меню не воскрешает: закрытие состоялось, и
    // воскресить его может только явный показ.
    await rightClickAndRead(page);
    expect((await readMenu(page)).openCount, 'меню открыто заново').toBe(1);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // Пауза вместо чтения сразу: закрытие по `hidden` отложенным не бывает, и
    // ожидание лишь доказывает, что обработчик на `visible` молчит.
    await page.waitForTimeout(200);

    const visible = await readMenu(page);
    expect(visible.openCount, 'возврат вкладки меню не тронул').toBe(1);
    expect(visible.errors, 'страница без ошибок').toEqual([]);
  });

  test('blur при непривязанном экземпляре не приводит к ошибке', async ({ page }) => {
    // Глобальные слушатели заводятся в `attach`, и без привязки их нет вовсе.
    // Кейс фиксирует, что добавление `blur` в таблицу слушателей не вынесло
    // подписку куда-то ещё: обработчик закрытия на закрытом экземпляре молчал бы
    // и без `#destroyed`, а вот несуществующий слушатель отвечал бы ошибкой.
    await makeMenu(page, 'nested', null);
    // Без привязки правый клик по контейнеру меню не открывает — слушателя на
    // контейнере нет, — поэтому показ программный.
    await openMenu(page, WORKSPACE_POINT.x, WORKSPACE_POINT.y);
    expect((await readMenu(page)).openCount, 'меню открыто без привязки').toBe(1);

    await page.evaluate(() => {
      globalThis.dispatchEvent(new Event('blur'));
    });

    const after = await readMenu(page);
    expect(after.openCount, 'меню осталось открытым').toBe(1);
    expect(after.errors, 'страница без ошибок').toEqual([]);
  });
});
