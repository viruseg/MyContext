import { expect, test } from '@playwright/test';
import { CLOSE_GRACE_MS, OPEN_GRACE_MS, SAFETY_PADDING, SUBMENU_OFFSET } from '../../src/constants.js';

/**
 * Кейсы показа подменю против настоящей страницы: курсор водит настоящий ввод
 * Playwright, модуль грузится динамическим импортом прямо в браузере.
 *
 * Три решения, на которых держится весь файл.
 *
 * **Время принадлежит `page.clock`, и оно заморожено.** `install()` подменяет
 * таймеры страницы, `pauseAt()` останавливает ход времени, и только `fastForward`
 * двигает его вперёд. Без заморозки утверждение «сразу после `pointerenter`
 * подменю нет» было бы гонкой: между отправкой события и чтением снимка
 * проходит реальное время, и достаточно было бы медленного прогона. Заморозка
 * делает «сразу» и «через 250 мс» двумя разными состояниями, а не двумя
 * вероятностями. Публичный API `MyContext` при этом не получает ни одного
 * параметра для подмены таймеров.
 *
 * **Курсор водится координатами, а не `locator.hover()`.** Все точки берутся из
 * настоящих `getBoundingClientRect()` в снимке, поэтому «уйти в сторону» и
 * «войти в подменю» — это конкретные пиксели, а не `hover()` по тексту. Заодно
 * снимается ловушка Playwright: элемент с `aria-disabled` она считает
 * непригодным и на него не кликает, а отключённый пункт-владелец здесь и есть
 * предмет половины кейсов. Наконец, `locator`-ожидания внутри замороженных часов
 * опираются на кадры браузера, которых при остановленном времени не бывает.
 *
 * **`reducedMotion: 'reduce'` убирает отложенное закрытие.** Слой под `reduce`
 * вызывает `hidePopover()` сразу, а не через `animationDuration`, поэтому
 * «подменю закрылось» читается в том же снимке, в котором оно закрылось, и ни
 * один кейс не ждёт анимацию. Задержка закрытия подменю при этом остаётся
 * настоящей — она у `hoverIntent`, а не у слоя, и её кейсы гоняют часами.
 */

/**
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 */

/**
 * @typedef {object} ItemView
 * @property {string} label подпись пункта; `''` у разделителя.
 * @property {string | null} haspopup `aria-haspopup`.
 * @property {string | null} expanded `aria-expanded`. Слой снимает отметку при
 *   закрытии, а не пишет `"false"`, поэтому `null` — это и есть «не развёрнуто».
 * @property {string | null} owns зарезервированный адрес подменю.
 * @property {string | null} chevron `data-chevron`.
 * @property {number} chevrons сколько узлов `.vc-chevron` на пункте.
 * @property {MenuRect} rect рамка пункта во вьюпорте.
 */

/**
 * @typedef {object} MenuRect
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 * @property {number} right
 * @property {number} bottom
 */

/**
 * @typedef {object} LevelView
 * @property {string} id
 * @property {boolean} popoverOpen `:popover-open` — уровень в Top Layer.
 * @property {MenuRect} rect
 * @property {ItemView[]} items
 */

/**
 * @typedef {object} Snapshot
 * @property {LevelView[]} levels уровни в порядке документа, включая закрытые:
 *   заведённый, но не показанный уровень остаётся отцепленным узлом и в разметке
 *   не виден, а `id` у него уже есть.
 * @property {number} openCount сколько уровней в Top Layer.
 * @property {string | null} focusLabel подпись пункта с фокусом.
 * @property {string[]} log метки сработавших действий, по порядку.
 * @property {string[]} errors сообщения необработанных ошибок страницы.
 */

/**
 * @typedef {object} McProbe
 * @property {(set: string, containerId: string | null) => void} make
 * @property {(x: number, y: number) => void} open
 * @property {() => void} close
 * @property {() => Snapshot} read
 * @property {(label: string) => MenuRect | null} rectOf
 * @property {(ownerLabel: string) => string | null} submenuIdOf
 * @property {(disabled: boolean) => OwnerProbe} ownersOf
 */

/**
 * Признаки владельца, снятые рендером напрямую: у живого меню доступно только
 * то, что дошло до DOM, а поле `hasSubmenu` живёт в `RenderedItem` и наружу не
 * отдаётся. Рендер вызывается на тех же данных, что и меню, и ответ читается
 * из его результата.
 *
 * @typedef {object} OwnerProbe
 * @property {boolean} hasSubmenu
 * @property {boolean} focusable
 * @property {string | null} owns
 * @property {string | null} haspopup
 * @property {string | null} chevron
 * @property {number} chevrons
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
    <!-- Контейнер на всю страницу и с tabindex="-1": правый клик открывает меню
         в любой точке, а close() возвращает фокус на элемент-владелец. -->
    <div id="surface" tabindex="-1"
         style="position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: rgb(240, 240, 240)"></div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };

/**
 * Точки правого клика. Левая нужна, чтобы подменю помещалось справа, правая —
 * чтобы не помещалось и раскрылось влево: обе у краёв, обе внутри контейнера.
 */
const OPEN_LEFT = { x: 20, y: 300 };
const OPEN_RIGHT = { x: 900, y: 300 };
/** Точка в середине вьюпорта: от неё четыре уровня укладываются и по ширине, и по высоте. */
const OPEN_MIDDLE = { x: 260, y: 120 };

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} set
 * @param {string | null} containerId
 * @returns {Promise<void>}
 */
function makeMenu(page, set, containerId) {
  return page.evaluate((input) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc.make(input.set, input.container);
  }, { set, container: containerId });
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
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function openAt(page, point) {
  return page.mouse.click(point.x, point.y, { button: 'right' });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} point
 * @returns {Promise<void>}
 */
function moveTo(page, point) {
  return page.mouse.move(point.x, point.y);
}

/**
 * Центр рамки пункта по подписи. Подписи в наборе не повторяются между уровнями,
 * поэтому одной подписи достаточно, а уровень искать не нужно.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<{ x: number, y: number }>}
 */
async function centreOf(page, label) {
  const rect = await page.evaluate((name) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    return scope.__mc.rectOf(name);
  }, label);
  expect(rect, `пункт «${label}» есть в разметке`).not.toBeNull();
  const found = /** @type {MenuRect} */ (rect);
  return { x: found.left + found.width / 2, y: found.top + found.height / 2 };
}

/**
 * Наводит курсор на пункт по подписи.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<void>}
 */
async function hoverItem(page, label) {
  await moveTo(page, await centreOf(page, label));
}

/**
 * Подписи владельцев, у которых `aria-expanded` стоит в `"true"`. Снимок, а не
 * одиночный пункт: утверждение «после закрытия не развёрнуто» проходит на
 * пустом дереве, если не видно, что до закрытия развёрнуто было хоть что-то.
 *
 * Список отсортирован: уровни лежат в документе в порядке показа, и порядок
 * подписей говорил бы о нём, а не о том, что утверждается.
 *
 * @param {Snapshot} snapshot
 * @returns {string[]}
 */
function expandedLabels(snapshot) {
  /** @type {string[]} */
  const labels = [];
  for (const level of snapshot.levels) {
    for (const item of level.items) {
      if (item.expanded === 'true') {
        labels.push(item.label);
      }
    }
  }
  return labels.sort();
}

/**
 * Пункт по подписи из любого уровня.
 *
 * @param {Snapshot} snapshot
 * @param {string} label
 * @returns {ItemView}
 */
function itemOf(snapshot, label) {
  for (const level of snapshot.levels) {
    for (const item of level.items) {
      if (item.label === label) {
        return item;
      }
    }
  }
  throw new Error(`в снимке нет пункта «${label}»`);
}

/**
 * Показан ли уровень с таким `id`.
 *
 * @param {Snapshot} snapshot
 * @param {string | null} id
 * @returns {boolean}
 */
function isOpen(snapshot, id) {
  return snapshot.levels.some((level) => {
    return level.id === id && level.popoverOpen;
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  // `goto` обязателен перед `setContent`: без него у документа нет адреса, и ни
  // ссылка на таблицу стилей, ни динамический импорт не разрешились бы.
  await page.goto('/');
  await page.setContent(PAGE_HTML);
  await page.waitForFunction(
    (path) => {
      return Array.from(document.styleSheets).some((sheet) => {
        return sheet.href !== null && sheet.href.endsWith(path) && sheet.cssRules.length > 0;
      });
    },
    STYLESHEET_PATH,
    { timeout: 5000 },
  );
  // Часы ставятся после ожидания таблицы стилей: `waitForFunction` доходит до
  // страницы кадрами браузера, а замороженное время кадров не даёт.
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { MyContext } = await import('../../src/index.js');
    const { renderLevel } = await import('../../src/renderer.js');

    /**
     * Наборы объявлены здесь, а не приходят аргументом: у пунктов есть
     * `action`-функции, а `page.evaluate` сериализует аргументы как JSON и функции
     * бы выбросил.
     *
     * Четыре уровня: корень, «Экспорт», «PNG» и «Один» — того достаточно, чтобы
     * цепочка обрезалась на два уровня глубже корня. «Скачать» лежит рядом с «PNG»
     * внутри подменю «Экспорта», а не в корне: усечение проверяется переходом на
     * соседа внутри одного уровня, и только там «глубже» имеет смысл отличать от
     * «в другой ветке». У «Экспорта» четыре пункта: двумя обрезать нечего, и
     * проверка «курсор ушёл в сторону» на последнем пункте попадала бы в его
     * геометрию вместо геометрии клина.
     *
     * @type {Record<string, Array<MenuItem | SeparatorItem>>}
     */
    const sets = {
      tree: [
        { label: 'Новый', action: () => log.push('новый') },
        {
          label: 'Экспорт',
          submenu: [
            { label: 'PDF', action: () => log.push('pdf') },
            { label: 'PNG', submenu: [{ label: 'Один', submenu: [{ label: 'Глубоко' }] }] },
            {
              label: 'Скачать',
              submenu: [
                { label: 'Архив' },
                { label: 'Образ' },
              ],
              action: () => log.push('скачать'),
            },
            { label: 'Значок Windows' },
          ],
          action: () => log.push('экспорт'),
        },
        {
          label: 'Глухой',
          disabled: true,
          submenu: [{ label: 'Под глухим' }],
          action: () => log.push('глухой'),
        },
        { label: 'Пустой', submenu: [], action: () => log.push('пустой') },
        { label: 'Заметки', action: () => log.push('заметки') },
      ],
    };

    /** @type {string[]} */
    const log = [];
    /** @type {string[]} */
    const errors = [];
    globalThis.addEventListener('error', (event) => {
      errors.push(String(event.message));
    });

    /** @type {InstanceType<typeof MyContext> | null} */
    let menu = null;

    /**
     * @param {Element} item узел пункта или разделителя.
     * @returns {ItemView}
     */
    function readItem(item) {
      const label = item.querySelector('.vc-label');
      const rect = item.getBoundingClientRect();
      return {
        label: label === null ? '' : String(label.textContent),
        haspopup: item.getAttribute('aria-haspopup'),
        expanded: item.getAttribute('aria-expanded'),
        owns: item.getAttribute('aria-owns'),
        chevron: item.getAttribute('data-chevron'),
        chevrons: item.querySelectorAll('.vc-chevron').length,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
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
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom,
          },
          items: Array.from(element.querySelectorAll('.vc-item, .vc-separator')).map((node) => {
            return readItem(node);
          }),
        };
      });
      const active = document.activeElement;
      const focused = active instanceof Element ? active.closest('.vc-item') : null;
      const focusedLabel = focused === null ? null : focused.querySelector('.vc-label');
      return {
        levels,
        openCount: levels.filter((level) => {
          return level.popoverOpen;
        }).length,
        focusLabel: focusedLabel === null ? null : String(focusedLabel.textContent),
        log: log.slice(),
        errors: errors.slice(),
      };
    }

    const probe = /** @type {McProbe} */ ({
      make(setName, containerId) {
        if (menu !== null) {
          menu.destroy();
        }
        log.length = 0;
        errors.length = 0;
        menu = new MyContext(sets[setName], { label: 'Меню подменю' });
        const container = containerId === null ? null : document.getElementById(containerId);
        if (container instanceof HTMLElement) {
          menu.attach(container);
        }
      },
      open(x, y) {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.open({ x, y });
      },
      close() {
        if (menu === null) {
          throw new Error('меню не создано');
        }
        menu.close();
      },
      read,
      rectOf(name) {
        for (const element of document.querySelectorAll('.vc-item')) {
          const label = element.querySelector('.vc-label');
          if (label !== null && String(label.textContent) === name) {
            const rect = element.getBoundingClientRect();
            return {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              right: rect.right,
              bottom: rect.bottom,
            };
          }
        }
        return null;
      },
      submenuIdOf(ownerLabel) {
        for (const element of document.querySelectorAll('.vc-item')) {
          const label = element.querySelector('.vc-label');
          if (label !== null && String(label.textContent) === ownerLabel) {
            return element.getAttribute('aria-owns');
          }
        }
        return null;
      },
      ownersOf(disabled) {
        // Рендер вызывается на тех же данных, что и меню: подменю непустое, и
        // единственное различие между двумя пунктами — `disabled`.
        const items = [{ label: 'Владелец', submenu: [{ label: 'Лист' }], disabled }];
        const level = renderLevel(items, {
          levelIndex: 0,
          menuId: 'vc-проба',
          label: 'Меню пробы',
          actions: new Map(),
        });
        const item = level.items[0];
        return {
          hasSubmenu: item.hasSubmenu,
          focusable: item.focusable,
          owns: item.element.getAttribute('aria-owns'),
          haspopup: item.element.getAttribute('aria-haspopup'),
          chevron: item.element.getAttribute('data-chevron'),
          chevrons: item.element.querySelectorAll('.vc-chevron').length,
        };
      },
    });

    const scope = /** @type {{ __mc?: McProbe }} */ (/** @type {unknown} */ (globalThis));
    scope.__mc = probe;
  });
});

test.describe('показ подменю', () => {
  test('наведение на пункт с подменю не открывает его мгновенно', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(ownerId, 'у владельца есть зарезервированный адрес подменю').not.toBeNull();

    await hoverItem(page, 'Экспорт');

    // Часы стоят: ни миллиметра времени не прошло, и «сразу» здесь — буквально
    // ноль, а не «меньше задержки». Показ без задержки ронял бы это утверждение,
    // и роняет его одна строка — вызов показа прямо из `#onItemEnter`.
    const after = await readMenu(page);
    expect(after.openCount, 'открыт только корень').toBe(1);
    expect(isOpen(after, ownerId), 'подменю не показано').toBe(false);
  });

  test('наведение на пункт с подменю открывает его через openDelayMs', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const after = await readMenu(page);
    expect(isOpen(after, ownerId), 'подменю показано').toBe(true);
    expect(after.openCount, 'открыты корень и подменю').toBe(2);
    expect(expandedLabels(after), 'владелец отмечен развёрнутым').toEqual(['Экспорт']);
    // Показанный уровень обязан достаться движку: реестр движка наполняет только
    // `focusFirst`, а уровень вне реестра не отвечает на клавиши. Открытое мышью
    // подменю без фокуса было бы видимо и мёртво.
    expect(after.focusLabel, 'фокус в показанном подменю').toBe('PDF');
  });

  test('уход курсора до истечения задержки не открывает подменю', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS - 50);
    await hoverItem(page, 'Заметки');
    // Срок открытия истёк бы после ухода курсора: без отмены задачи подменю
    // показалось бы здесь, и кейс это поймал бы.
    await page.clock.fastForward(OPEN_GRACE_MS * 2);

    const after = await readMenu(page);
    expect(isOpen(after, ownerId), 'подменю не показано').toBe(false);
    expect(after.openCount, 'открыт только корень').toBe(1);
  });

  test('удержание кнопки мыши открывает подменю немедленно', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    // Никакого `fastForward`: показ обязан произойти на нажатии, минуя
    // `openDelayMs`. Снятие слушателя `pointerdown` с пункта ломает ровно эту
    // строку, и часы скрыть её не могут.
    await page.mouse.down();
    const pressed = await readMenu(page);
    expect(isOpen(pressed, ownerId), 'подменю открыто на нажатии').toBe(true);

    // Отпускание доводит дело до клика, а клик по владельцу открывает подменю, а не
    // зовёт его действие: у «Экспорта` есть `action`, и пустой журнал здесь — не
    // «обработчика нет», а правило владельца.
    await page.mouse.up();
    const after = await readMenu(page);
    expect(after.log, 'действие владельца не вызвано').toEqual([]);
    expect(isOpen(after, ownerId), 'подменю всё ещё открыто').toBe(true);
    expect(after.openCount, 'открыты корень и подменю').toBe(2);
  });

  test('диагональное движение к подменю не закрывает его', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(isOpen(opened, ownerId), 'подменю открыто').toBe(true);

    // Первое плечо: курсор уходит с владельца вверх, на соседний пункт, — мимо
    // подменю. Здесь hover intent планирует закрытие, и оно действительно
    // запланировано: обратная половина этого кейса — следующий тест, который
    // ровно эту траекторию доводит до срабатывания.
    await hoverItem(page, 'Новый');
    // Второе плечо: один прыжок в подменю. Без `steps` вход в подменю и первый
    // `pointermove` после него несут одну точку, поэтому закрытие планируется
    // ровно одно — и оно снимается входом в подменю.
    await hoverItem(page, 'PDF');
    await page.clock.fastForward(CLOSE_GRACE_MS * 2);

    const after = await readMenu(page);
    expect(isOpen(after, ownerId), 'подменю пережило диагональное движение').toBe(true);
    expect(expandedLabels(after), 'владелец всё ещё развёрнут').toEqual(['Экспорт']);

    // Вторая половина: внутри подменю курсор всё ещё судим. Точка берётся в последнем
    // пункте подменю — подальше от скруглённых углов, где попадание не гарантировано
    // (в WebKit угловой пиксель вообще не в попадании), — и на таком расстоянии от
    // точки входа клин вырожден, то есть решением будет закрытие. Без этого шага
    // кейс проходил бы и на «`pointermove` по дереву меню не подписан вовсе»:
    // закрытие никто бы не планировал. Саму геометрию клина закрепляют юнит-кейсы
    // `tests/unit/hoverIntent.spec.js`; здесь проверяется только то, что решение
    // доходит до оркестратора.
    const far = await page.evaluate((id) => {
      const level = document.getElementById(id);
      if (level === null) {
        throw new Error('подменю показано, но узла нет');
      }
      const items = level.querySelectorAll('.vc-item');
      const last = items[items.length - 1];
      if (last === undefined) {
        throw new Error('в подменю нет пунктов');
      }
      const rect = last.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, /** @type {string} */ (ownerId));
    await moveTo(page, far);
    await page.clock.fastForward(CLOSE_GRACE_MS * 2);

    const closed = await readMenu(page);
    expect(isOpen(closed, ownerId), 'подменю закрылось').toBe(false);
    expect(closed.openCount, 'корень остался открытым').toBe(1);
    expect(expandedLabels(closed), 'отметка развёрнутости снята').toEqual([]);
  });

  test('курсор, ушедший в сторону, закрывает подменю после closeDelayMs', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    // Контроль состояния: «не открыто» ниже имеет смысл только если до ухода
    // курсора подменю было открыто.
    expect(isOpen(await readMenu(page), ownerId), 'подменю открыто').toBe(true);

    // «Заметки» — обычный пункт без подменю: курсор ушёл в сторону, в дереве меню,
    // и ему некуда идти. Обратная половина этого кейса — предыдущий тест, где
    // та же траектория заканчивается входом в подменю.
    await hoverItem(page, 'Заметки');
    // Срок закрытия ещё не истёк: подменю обязано быть на месте.
    await page.clock.fastForward(CLOSE_GRACE_MS - 50);
    const pending = await readMenu(page);
    expect(isOpen(pending, ownerId), 'до истечения срока подменю на месте').toBe(true);

    await page.clock.fastForward(CLOSE_GRACE_MS);
    const after = await readMenu(page);
    expect(isOpen(after, ownerId), 'подменю закрылось').toBe(false);
    expect(after.openCount, 'корень остался открытым').toBe(1);
    expect(expandedLabels(after), 'отметка развёрнутости снята').toEqual([]);
  });

  test('переход на другой пункт усекает цепочку', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(exportId, 'адрес подменю «Экспорта» назван').not.toBeNull();

    // Второй уровень заводится только показом первого: до него в документе нет ни
    // его пункта, ни его `id`, и адреса подменю «PNG» и «Скачать» читаются уже
    // после наведения на «Экспорт».
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const innerIds = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return {
        png: scope.__mc.submenuIdOf('PNG'),
        download: scope.__mc.submenuIdOf('Скачать'),
      };
    });
    expect(innerIds.png, 'адрес подменю «PNG» назван').not.toBeNull();
    expect(innerIds.download, 'адрес подменю «Скачать» назван').not.toBeNull();

    // Цепочка из трёх уровней: корень, «Экспорт», «PNG».
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const deep = await readMenu(page);
    expect(deep.openCount, 'открыты корень и два подменю').toBe(3);
    expect(isOpen(deep, exportId), 'подменю «Экспорта» открыто').toBe(true);
    expect(isOpen(deep, innerIds.png), 'подменю «PNG» открыто').toBe(true);

    // Переход на соседний пункт того же уровня: «Экспорт» остаётся открытым, а всё
    // глубже него уходит. Закрытие целиком прошло бы мимо «PDF» и «PNG» и было бы
    // видно по счётчику открытых уровней; усечение не по глубже, а по всей
    // ветке, закрыло бы и «Экспорт» — и тогда «остался открытым» было бы пустым.
    await hoverItem(page, 'Скачать');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const after = await readMenu(page);
    expect(isOpen(after, innerIds.download), 'подменю нового владельца открыто').toBe(true);
    expect(isOpen(after, exportId), 'уровень прежнего владельца остался открытым').toBe(true);
    expect(isOpen(after, innerIds.png), 'подменю глубже прежнего владельца закрыто').toBe(false);
    expect(after.openCount, 'открыты корень, «Экспорт» и «Скачать»').toBe(3);
    expect(
      expandedLabels(after),
      'развёрнуты «Экспорт» и «Скачать», «PNG» — нет',
    ).toEqual(['Скачать', 'Экспорт'].sort());
  });

  test('подменю у правого края раскрывается влево, шеврон развёрнут', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_RIGHT);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const after = await readMenu(page);
    const owner = itemOf(after, 'Экспорт');
    expect(owner.chevron, 'шеврон развёрнут влево').toBe('left');
    const submenu = after.levels.find((level) => {
      return level.id === ownerId;
    });
    expect(submenu, 'подменю показано').not.toBeUndefined();
    const found = /** @type {LevelView} */ (submenu);
    // Не «левее владельца вообще», а ровно на зазор: позиция считается
    // позиционером, и утверждение о развороте без проверки самого зазора
    // проходило бы на подменю, показанном где угодно.
    expect(
      found.rect.right,
      'правый край подменю на зазоре от левого края владельца',
    ).toBeCloseTo(owner.rect.left - SUBMENU_OFFSET, 1);
  });

  test('подменю у левого края раскрывается вправо, шеврон обычный', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_LEFT);
    const ownerId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const after = await readMenu(page);
    const owner = itemOf(after, 'Экспорт');
    expect(owner.chevron, 'шеврон обычный').toBe('right');
    const submenu = after.levels.find((level) => {
      return level.id === ownerId;
    });
    expect(submenu, 'подменю показано').not.toBeUndefined();
    const found = /** @type {LevelView} */ (submenu);
    expect(found.rect.left, 'левый край подменю на зазоре от владельца')
      .toBeCloseTo(owner.rect.right + SUBMENU_OFFSET, 1);
  });

  test('вложенность 4 уровней открывается целиком и все меню в пределах вьюпорта', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'Один');
    await page.clock.fastForward(OPEN_GRACE_MS);

    const after = await readMenu(page);
    expect(after.openCount, 'открыты корень и три подменю').toBe(4);
    expect(after.focusLabel, 'фокус дошёл до четвёртого уровня').toBe('Глубоко');
    // Геометрия каждого уровня по отдельности: «всего четыре открыто» проверяло бы
    // число, а не то, что они помещаются.
    const shown = after.levels.filter((level) => {
      return level.popoverOpen;
    });
    expect(shown).toHaveLength(4);
    for (const level of shown) {
      expect(level.rect.left, `левый край уровня ${level.id}`).toBeGreaterThanOrEqual(
        SAFETY_PADDING,
      );
      expect(level.rect.top, `верхний край уровня ${level.id}`).toBeGreaterThanOrEqual(
        SAFETY_PADDING,
      );
      expect(
        level.rect.left + level.rect.width,
        `правый край уровня ${level.id}`,
      ).toBeLessThanOrEqual(VIEWPORT.width - SAFETY_PADDING);
      expect(
        level.rect.top + level.rect.height,
        `нижний край уровня ${level.id}`,
      ).toBeLessThanOrEqual(VIEWPORT.height - SAFETY_PADDING);
    }
  });

  test('вложенность 4 уровней закрывается по цепочке клавишей Escape', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'Один');
    await page.clock.fastForward(OPEN_GRACE_MS);
    expect((await readMenu(page)).openCount, 'открыты четыре уровня').toBe(4);

    // По одному на уровень, от глубокого к корню. Число нажатий закреплено, а не
    // «пока не закроется»: цикл с условием прошёл бы и на menu, который никогда не
    // закрывается, если бы проверка была на отсутствии изменений.
    const closed = [];
    for (const step of ['четвёртый', 'третий', 'второй', 'первый']) {
      await page.keyboard.press('Escape');
      const after = await readMenu(page);
      closed.push(`${step}:${after.openCount}`);
    }
    expect(closed).toEqual(['четвёртый:3', 'третий:2', 'второй:1', 'первый:0']);
    const after = await readMenu(page);
    expect(after.openCount, 'всё закрыто').toBe(0);
    expect(expandedLabels(after), 'отметок развёрнутости не осталось').toEqual([]);
  });

  test('отключённый пункт-владелец не открывает подменю ни одним способом', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const deafId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Глухой');
    });
    // Адреса подменю у отключённого владельца нет вовсе — признака подменю у него
    // нет, а значит нечего и открывать. Именно это и отличает его от соседа с
    // непустым подменю.
    expect(deafId, 'у отключённого владельца нет `aria-owns`').toBeNull();

    // Наведение: подписки на показ у отключённого пункта нет, и задержка не
    // проходит мимо отсутствия подписки.
    await hoverItem(page, 'Глухой');
    await page.clock.fastForward(OPEN_GRACE_MS * 2);
    expect((await readMenu(page)).openCount, 'наведение не открыло').toBe(1);

    // Нажатие: `pointerdown` у отключённого пункта не подписан, поэтому обхода
    // задержки не происходит.
    await page.mouse.down();
    expect((await readMenu(page)).openCount, 'нажатие не открыло').toBe(1);
    await page.mouse.up();

    // Клик: обработчик активации отсекает пункт по доступности раньше проверки
    // подменю, поэтому ни подменю, ни действие.
    const afterClick = await readMenu(page);
    expect(afterClick.log, 'действие отключённого пункта не выполнено').toEqual([]);
    expect(afterClick.openCount, 'клик не открыл').toBe(1);

    // Клавиатура: полный обход уровня не делает отключённый пункт активным, и
    // `ArrowRight`/`Enter` до него не доходят. Без обхода утверждение было бы
    // нечем отличить «не открылось» от «недостижимо».
    for (const key of ['End', 'ArrowDown', 'Home', 'ArrowUp']) {
      await page.keyboard.press(key);
    }
    const walked = await readMenu(page);
    expect(walked.openCount, 'обход уровня не открыл подменю').toBe(1);
    expect(walked.focusLabel, 'фокус ни разу не встал на отключённого').not.toBe('Глухой');
    await page.keyboard.press('ArrowRight');
    expect((await readMenu(page)).openCount, '`ArrowRight` не открыл').toBe(1);

    // Контроль живости: сосед с непустым подменю в том же уровне наведением
    // открывается. Без него всё вышеперечисленное проходило бы на уровне, где
    // подменю не открывает никто.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    expect((await readMenu(page)).openCount, 'доступный владелец открывается').toBe(2);
  });

  test('отключённый пункт с подменю не выглядит владельцем', async ({ page }) => {
    const owners = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return {
        live: scope.__mc.ownersOf(false),
        deaf: scope.__mc.ownersOf(true),
      };
    });

    // Признаки владельца снимаются одним условием, поэтому у отключённого пункта с
    // непустым подменю их нет все четыре, а `hasSubmenu` равен `false`. Обе
    // половины в одном снимке: разница между ними и есть предмет кейса.
    expect(owners.deaf.hasSubmenu, 'отключённый пункт не владелец').toBe(false);
    expect(owners.deaf.focusable, 'отключённый пункт вне цикла роуминга').toBe(false);
    expect(owners.deaf.owns, 'нет `aria-owns`').toBeNull();
    expect(owners.deaf.haspopup, 'нет `aria-haspopup`').toBeNull();
    expect(owners.deaf.chevron, 'нет `data-chevron`').toBeNull();
    expect(owners.deaf.chevrons, 'нет узла шеврона').toBe(0);

    expect(owners.live.hasSubmenu, 'доступный пункт с подменю — владелец').toBe(true);
    expect(owners.live.focusable).toBe(true);
    expect(owners.live.owns, 'есть `aria-owns`').not.toBeNull();
    expect(owners.live.haspopup, 'есть `aria-haspopup`').toBe('menu');
    expect(owners.live.chevron, 'есть `data-chevron`').toBe('right');
    expect(owners.live.chevrons, 'есть узел шеврона').toBe(1);
  });

  test('отключённый пункт с подменю не похож на владельца и в живом меню', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const after = await readMenu(page);

    // То же в разметке живого меню: набор пунктов здесь другой, чем у рендер-пробы,
    // и «нет признаков» должно читаться с показанного меню, а не с отдельного
    // вызова рендера.
    const deaf = itemOf(after, 'Глухой');
    expect(deaf.owns, 'нет `aria-owns`').toBeNull();
    expect(deaf.haspopup, 'нет `aria-haspopup`').toBeNull();
    expect(deaf.chevron, 'нет `data-chevron`').toBeNull();
    expect(deaf.chevrons, 'нет узла шеврона').toBe(0);

    // Контроль: сосед с непустым подменю и без `disabled` сохраняет все признаки.
    const exportItem = itemOf(after, 'Экспорт');
    expect(exportItem.owns, 'есть `aria-owns`').not.toBeNull();
    expect(exportItem.haspopup, 'есть `aria-haspopup`').toBe('menu');
    expect(exportItem.chevron, 'есть `data-chevron`').toBe('right');
    expect(exportItem.chevrons, 'есть узел шеврона').toBe(1);
  });

  test('подменю не пересоздаётся при повторном наведении на тот же пункт', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(exportId, 'адрес подменю «Экспорта» назван').not.toBeNull();

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const first = await readMenu(page);
    expect(isOpen(first, exportId), 'подменю открыто').toBe(true);
    // Уровень, который не показан, лежит отцепленным узлом и в разметке не виден —
    // поэтому «тот же уровень» читается по `id`, а не по наличию узла в документе.
    const firstNodes = first.levels.length;
    expect(firstNodes, 'заведённые, но не показанные уровни в документе не лежат').toBe(2);

    // Уход в сторону и обратно. Уровень при этом скрывается, но не пересоздаётся:
    // идентичность уровня задаёт пара «родитель, владелец», и новый уровень получил
    // бы новый `id`.
    await hoverItem(page, 'Заметки');
    await page.clock.fastForward(CLOSE_GRACE_MS);
    expect(isOpen(await readMenu(page), exportId), 'подменю закрылось').toBe(false);
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const again = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(again, 'id подменю после скрытия прежний').toBe(exportId);
    expect(isOpen(await readMenu(page), exportId), 'подменю снова открыто тем же уровнем').toBe(true);

    // И полный `close()` с последующим показом: закрытие уровни не уничтожает его,
    // поэтому тот же `id` обязан вернуться и здесь.
    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.close();
    });
    await openAt(page, OPEN_MIDDLE);
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const afterReopen = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(afterReopen, 'id подменю после полного close() прежний').toBe(exportId);
    const final = await readMenu(page);
    expect(isOpen(final, exportId), 'подменю открыто после переоткрытия меню').toBe(true);
    expect(final.openCount, 'открыты корень и одно подменю').toBe(2);
  });

  test('aria-expanded возвращается в false после закрытия подменю', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);
    const exportId = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return scope.__mc.submenuIdOf('Экспорт');
    });
    expect(exportId, 'адрес подменю «Экспорта» назван').not.toBeNull();

    // Цепочка из трёх уровней: корень, «Экспорт», «PNG». Переход на соседний пункт
    // уровня «Экспорт» закрывает подменю «PNG» — вот чей владелец теряет отметку.
    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const innerIds = await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      return {
        png: scope.__mc.submenuIdOf('PNG'),
        download: scope.__mc.submenuIdOf('Скачать'),
      };
    });
    expect(innerIds.png, 'адрес подменю «PNG» назван').not.toBeNull();
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const opened = await readMenu(page);
    expect(isOpen(opened, innerIds.png), 'подменю «PNG» открыто').toBe(true);
    expect(expandedLabels(opened), 'оба владельца развёрнуты').toEqual(
      ['PNG', 'Экспорт'].sort(),
    );

    await hoverItem(page, 'Скачать');
    await page.clock.fastForward(OPEN_GRACE_MS);
    const after = await readMenu(page);
    expect(isOpen(after, innerIds.png), 'подменю прежнего владельца скрыто').toBe(false);
    expect(isOpen(after, innerIds.download), 'подменю нового владельца открыто').toBe(true);
    // Слой снимает отметку, а не пишет `"false"`: у закрытого подменю состояния
    // «развёрнуто» нет, и `aria-haspopup` остаётся единственным верным признаком
    // того, что подменю есть.
    expect(itemOf(after, 'PNG').expanded, 'отметка снята с прежнего владельца').toBeNull();
    expect(itemOf(after, 'PNG').haspopup, 'признак наличия подменю остался').toBe('menu');
    // Обрезка не должна уносить предков: «Экспорт» — родитель обоих уровней, и его
    // подменю на месте. Усечение не по глубже, а по всей ветке унесло бы и его.
    expect(isOpen(after, exportId), 'подменю предка осталось открытым').toBe(true);
    expect(itemOf(after, 'Экспорт').expanded, 'предок по-прежнему развёрнут').toBe('true');
    expect(
      expandedLabels(after),
      'развёрнуты «Экспорт» и «Скачать», «PNG» — нет',
    ).toEqual(['Скачать', 'Экспорт'].sort());
  });

  test('aria-expanded у всех владельцев равен false при полном close()', async ({ page }) => {
    await makeMenu(page, 'tree', 'surface');
    await openAt(page, OPEN_MIDDLE);

    await hoverItem(page, 'Экспорт');
    await page.clock.fastForward(OPEN_GRACE_MS);
    await hoverItem(page, 'PNG');
    await page.clock.fastForward(OPEN_GRACE_MS);
    // Контроль: до `close()` развёрнуты оба владельца, иначе «после — ни одного» не
    // отличалось бы от «их и не было».
    expect(expandedLabels(await readMenu(page)), 'оба владельца развёрнуты').toEqual(
      ['PNG', 'Экспорт'].sort(),
    );

    await page.evaluate(() => {
      const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
      scope.__mc.close();
    });

    const after = await readMenu(page);
    expect(after.openCount, 'меню закрыто целиком').toBe(0);
    expect(expandedLabels(after), 'ни одного развёрнутого владельца').toEqual([]);
    const owners = after.levels.flatMap((level) => {
      return level.items.filter((item) => {
        return item.haspopup === 'menu';
      });
    });
    expect(owners.length, 'владельцы в разметке остались').toBeGreaterThan(0);
    for (const owner of owners) {
      expect(owner.expanded, `у владельца «${owner.label}» отметки нет`).toBeNull();
    }
    expect(after.log, 'ни одно действие не вызвано').toEqual([]);
    expect(after.errors, 'ошибок страницы нет').toEqual([]);
  });
});
