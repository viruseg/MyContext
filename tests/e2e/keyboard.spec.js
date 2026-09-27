import { expect, test } from '@playwright/test';

// Модуль подгружается динамическим импортом прямо в странице, и спецификатор
// `../../src/keyboard.js` обслуживает обе среды: в браузере от
// `http://127.0.0.1:4173/` он схлопывается до `/src/keyboard.js` — корень
// сервера, — а TypeScript разрешает его от файла теста. Поэтому типы импорта
// берутся из исходника, без приведений.

/**
 * @typedef {import('../../src/renderer.js').MenuItem} MenuItem
 * @typedef {import('../../src/renderer.js').SeparatorItem} SeparatorItem
 * @typedef {import('../../src/renderer.js').RenderedItem} RenderedItem
 * @typedef {import('../../src/layer.js').LevelEntry} LevelEntry
 * @typedef {import('../../src/layer.js').MenuLayer} MenuLayer
 * @typedef {import('../../src/keyboard.js').KeyboardHost} KeyboardHost
 */

/**
 * Адрес пункта в дереве меню: путь уровней и индекс пункта в уровне. Пустой
 * путь — корень, то есть уровень, созданный `ensureLevel(items, null, 0, null)`.
 *
 * @typedef {object} ItemAt
 * @property {number[]} path
 * @property {number} index
 */

/**
 * Шаг сценария.
 *
 * `press` отправляет клавишу в указанный пункт, а без указания — в тот, у
 * которого сейчас фокус: ровно это делает настоящий пользователь, и только
 * такой маршрут проверяет `event.target`. `press-outside` — клавиша вне дерева
 * меню: сначала фокус уходит на элемент-владелец, потом событие отправляется
 * в элемент рядом с ним. `read` ничего не делает и снимает состояние на
 * середине сценария, когда сравнивать «до» и «после» нужно не на краях.
 * `reset` зовёт `reset()` движка — вызывающий код делает это при закрытии меню.
 * `press-list` отправляет клавишу в прокручиваемый список уровня, а не в пункт:
 * цель внутри меню, но не под пунктом, и роуминг на такой цели не должен идти.
 * `clear` снимает отметки с корневого уровня руками, не забывая его: так ведёт
 * себя перерисовка уровня, и состояние без активного пункта обязано быть
 * определённым.
 *
 * @typedef {object} Step
 * @property {'press' | 'press-outside' | 'press-list' | 'read' | 'reset' | 'clear'} command
 * @property {string} [key]
 * @property {ItemAt} [at]
 */

/**
 * Снимок состояния пункта уровня.
 *
 * `tabindex`, `active` и `focused` — три независимые вещи, и равенство первых
 * двух при равенстве третьему и есть контракт роуминга. `haspopup`, `expanded`
 * и `owns` сняты потому, что именно они отличают владельца подменю от пункта с
 * `submenu: []`: у владельца есть все три, у не-владельца — ни одного.
 *
 * @typedef {object} ItemState
 * @property {string | null} label подпись пункта; `null` у разделителя.
 * @property {string | null} role
 * @property {string | null} tabindex `null` у разделителя: атрибута нет вовсе.
 * @property {boolean} active
 * @property {boolean} focused
 * @property {boolean} focusable входит ли пункт в цикл роуминга.
 * @property {boolean} hasSubmenu
 * @property {string | null} haspopup `aria-haspopup`.
 * @property {string | null} expanded `aria-expanded`.
 * @property {string | null} owns `aria-owns` — зарезервированный адрес подменю.
 */

/**
 * Снимок состояния уровня.
 *
 * @typedef {object} LevelState
 * @property {string} id
 * @property {boolean} open `entry.open`: слой уже счёл уровень закрытым.
 * @property {boolean} popoverOpen `:popover-open` — уровень в Top Layer.
 * @property {number} children сколько подменю заведено в дереве уровня.
 * @property {number} activeIndex индекс пункта, которому движок передал фокус.
 * @property {number} tabStops сколько пунктов несут `tabindex="0"`.
 * @property {number} activeMarks сколько пунктов несут `data-active`.
 * @property {string | null} focusLabel подпись пункта с фокусом в этом уровне.
 * @property {ItemState[]} items
 */

/**
 * Журнал вызовов хоста: частота, порядок и адреса открытых подменю. Порядок
 * нужен отдельно от счётчиков — «сначала закрыть уровень, потом вернуть фокус»
 * и наоборот дают один и тот же набор счётчиков.
 *
 * @typedef {object} HostCalls
 * @property {number} closeAll
 * @property {number} closeCurrentLevel
 * @property {number} openSubmenu
 * @property {string[]} openSubmenuIds
 * @property {number} focusOwner
 * @property {string[]} order
 */

/**
 * @typedef {object} FocusState
 * @property {string | null} label подпись пункта, у которого фокус.
 * @property {boolean} inMenu
 * @property {boolean} onInvoker
 */

/**
 * @typedef {object} FocusCall
 * @property {boolean} inMenu
 * @property {boolean | null} preventScroll `null`, если аргумент не задан.
 */

/**
 * @typedef {object} ProbeSnapshot
 * @property {Record<string, LevelState>} levels
 * @property {HostCalls} calls
 * @property {string[]} actions подписи пунктов, чей `action` отработал.
 * @property {string[]} clicks подписи пунктов, получивших синтетический клик.
 * @property {FocusState} focus
 * @property {FocusCall[]} focusCalls все вызовы `focus()` за время сценария.
 */

/**
 * @typedef {object} StepResult
 * @property {string} command
 * @property {string | null} key
 * @property {boolean} prevented
 * @property {string | null} target подпись пункта или `id` элемента вне меню.
 * @property {FocusState} focus
 * @property {Record<string, LevelState>} levels снимок после шага. Снимается на
 *   каждом шаге, а не только на `read`: состояние середины сценария нужно не
 *   реже, чем состояние конца, и `null` здесь означал бы проверку на
 *   разыменование в каждом кейсе вместо проверки на разыменование в одном.
 */

/**
 * @typedef {object} Scenario
 * @property {string} set имя набора пунктов, объявленного в пробе.
 * @property {boolean} [buildSubmenus] `false` — дерево уровней не заводится, то
 *   есть подменю не существует, хотя пункты-владельцы в меню есть. Так выглядит
 *   дерево, до которого вызывающий код не дошёл.
 * @property {Record<string, number[]>} paths
 * @property {Step[]} steps
 */

/**
 * @typedef {object} ScenarioResult
 * @property {ProbeSnapshot} before
 * @property {StepResult[]} steps
 * @property {ProbeSnapshot} after
 */

/**
 * @typedef {object} KeyboardProbe
 * @property {(set: string, buildSubmenus?: boolean) => void} open
 * @property {(paths: Record<string, number[]>) => ProbeSnapshot} read
 * @property {(steps: Step[], paths: Record<string, number[]>) => StepResult[]} run
 */

const STYLESHEET_PATH = '/styles/mycontext.css';
const PAGE_HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${STYLESHEET_PATH}" />
  </head>
  <!-- Фон страницы задан явно: по умолчанию он прозрачный, и композит поверх
       прозрачного чёрного занижал бы измерения полупрозрачной подложки. -->
  <body style="background: rgb(255, 255, 255)">
    <button id="invoker" type="button">Владелец меню</button>
    <div id="outside">Элемент вне меню</div>
  </body>
</html>`;

const VIEWPORT = { width: 1000, height: 700 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  // `goto` обязателен перед `setContent`: без него у документа нет адреса, и ни
  // ссылка на таблицу стилей, ни динамический импорт не разрешились бы.
  await page.goto('/');
  await page.setContent(PAGE_HTML);
  // Живая таблица стилей ещё могла не примениться, и `getComputedStyle` вернул бы
  // пустые значения — кейс упал бы не по существу.
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
  // сразу: состояние уровня после нажатия не зависит от таймера и от анимации.
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { createLayer } = await import('../../src/layer.js');
    const { createKeyboard } = await import('../../src/keyboard.js');

    const invoker = /** @type {HTMLElement} */ (document.getElementById('invoker'));
    const outside = /** @type {HTMLElement} */ (document.getElementById('outside'));
    /** @type {Map<string, MenuItem>} */
    const actions = new Map();
    /** @type {string[]} */
    const actionLabels = [];
    /** @type {string[]} */
    const clickLabels = [];
    /** @type {FocusCall[]} */
    const focusCalls = [];
    /** @type {LevelEntry[]} */
    const levels = [];
    /** @type {Map<HTMLElement, LevelEntry>} */
    const byElement = new Map();
    /** @type {MenuLayer | null} */
    let layer = null;
    /** @type {LevelEntry | null} */
    let root = null;
    /** @type {Record<string, number[]>} пути снимка последнего прогона. */
    let pathsOfRun = {};

    /**
     * Наборы пунктов объявлены здесь, а не приходят аргументом: у пунктов есть
     * `action`-функции, а `page.evaluate` сериализует аргументы как JSON и
     * функции бы выбросил. Поэтому кейс зовёт `open('tree')` по имени.
     *
     * @param {string} label
     * @returns {void}
     */
    function record(label) {
      actionLabels.push(label);
    }

    /**
     * Уровень кейса цикла: ровно те четыре состояния и в том порядке, которые
     * перечисляет бриф.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const cycle = [
      { label: 'Первый' },
      { label: 'Заблокированный', disabled: true },
      { type: 'separator' },
      { label: 'Второй' },
    ];

    /**
     * Отключённый пункт в хвосте и разделитель после него: «последний
     * доступный» и «последний по счёту» здесь разные пункты, и без такого хвоста
     * подмена их не различить — `End` и `ArrowUp` встали бы на отключённый.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const tail = [
      { label: 'Первый' },
      { label: 'Второй' },
      { label: 'Третий' },
      { label: 'Хвост', disabled: true },
      { type: 'separator' },
    ];

    /** @type {MenuItem[]} */
    const deepest = [{ label: 'Самый нижний' }];

    /**
     * Вложенность: подменю подменю. `MenuItem[]`, а не со смешанным списком: у
     * пункта поле `submenu` объявлено как `MenuItem[]`, и разделитель в
     * подменю — это уже другая фикстура.
     *
     * @type {MenuItem[]}
     */
    const nested = [
      { label: 'Глубже', submenu: deepest },
      { label: 'Обычный пункт подменю' },
    ];

    /**
     * Меню со всеми состояниями, которые различают пункты: обычный, владелец
     * подменю, владелец вложенного подменю, пункт с пустым `submenu`,
     * разделитель и последний обычный.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const tree = [
      { label: 'Открыть', action: () => { record('Открыть'); } },
      {
        label: 'Экспорт',
        submenu: [
          { label: 'PDF', action: () => { record('PDF'); } },
          { label: 'PNG' },
        ],
      },
      { label: 'Печать', submenu: nested },
      // У пункта есть `submenu`, и он пуст: такой пункт владельцем не является и
      // активируется как обычный. С коллбэком, чтобы отличить активацию от
      // открытия пустого подменя по одному только счётчику вызовов.
      { label: 'Пустое подменю', submenu: [], action: () => { record('Пустое подменю'); } },
      { type: 'separator' },
      { label: 'Выход', action: () => { record('Выход'); } },
    ];

    /** @type {Record<string, Array<MenuItem | SeparatorItem>>} */
    const sets = { cycle, tail, tree };

    /**
     * Проба `focus`: без неё утверждение «фокус всегда с `preventScroll`» было бы
     * недоказуемо. Меню `position: fixed`, поэтому настоящая прокрутка страницы от
     * вызова `focus()` не воспроизводится вовсе, и единственный инструмент —
     * наблюдение за аргументом.
     */
    const nativeFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (options) {
      focusCalls.push({
        inMenu: this.closest('.vc-menu') !== null,
        preventScroll: options?.preventScroll ?? null,
      });
      nativeFocus.call(this, options);
    };

    /**
     * @returns {MenuLayer}
     */
    function openedLayer() {
      if (layer === null) {
        throw new Error('меню не открыто');
      }
      return layer;
    }

    /**
     * @returns {LevelEntry}
     */
    function openedRoot() {
      if (root === null) {
        throw new Error('меню не открыто');
      }
      return root;
    }

    /**
     * Подменю пункта — по паре «родитель, владелец», ровно как их ищет слой.
     *
     * @param {LevelEntry} parent
     * @param {RenderedItem} owner
     * @returns {LevelEntry | null}
     */
    function childOf(parent, owner) {
      for (const child of parent.children) {
        if (child.ownerItem === owner) {
          return child;
        }
      }
      return null;
    }

    /**
     * Дерево уровней строит вызывающий код, а не движок: движок берёт уровень из
     * DOM и подменю находит по паре «родитель, владелец», то есть подменю обязано
     * быть заведено заранее.
     *
     * @param {LevelEntry} entry
     * @param {Array<MenuItem | SeparatorItem>} items
     * @param {number} levelIndex
     * @returns {void}
     */
    function buildTree(entry, items, levelIndex) {
      for (const [index, item] of items.entries()) {
        if ('type' in item) {
          continue;
        }
        const submenu = item.submenu;
        if (submenu === undefined || submenu.length === 0) {
          continue;
        }
        const child = openedLayer().ensureLevel(submenu, entry, levelIndex + 1, entry.items[index]);
        levels.push(child);
        byElement.set(child.element, child);
        buildTree(child, submenu, levelIndex + 1);
      }
    }

    /** @type {HostCalls} */
    const calls = {
      closeAll: 0,
      closeCurrentLevel: 0,
      openSubmenu: 0,
      openSubmenuIds: [],
      focusOwner: 0,
      order: [],
    };

    // Хост — «MyContext-подобная» часть фикстуры: он владеет слоем, картой
    // активов и элементом-владельцем, и только он знает, что значит «закрыть
    // всё» или «вернуть фокус».
    //
    // `closeAll` фокуса не трогает намеренно: возвращать его — дело задачи 9, а
    // если бы возвращал, кейс про `Tab` проходил бы и без `focusOwner`.
    /** @type {KeyboardHost} */
    const host = {
      closeAll() {
        calls.order.push('closeAll');
        calls.closeAll += 1;
        openedLayer().hideAll();
      },
      openSubmenu(entry) {
        calls.order.push(`openSubmenu:${entry.element.id}`);
        calls.openSubmenu += 1;
        calls.openSubmenuIds.push(entry.element.id);
        openedLayer().showSubmenu(entry);
      },
      closeCurrentLevel() {
        calls.order.push('closeCurrentLevel');
        calls.closeCurrentLevel += 1;
        // «Текущий» уровень — тот, где стоит фокус: по нему движок и ходит.
        const active = document.activeElement;
        const menu = active === null ? null : active.closest('.vc-menu');
        if (menu === null) {
          return;
        }
        const entry = byElement.get(/** @type {HTMLElement} */ (menu));
        if (entry === undefined) {
          return;
        }
        openedLayer().hide(entry);
      },
      focusOwner() {
        calls.order.push('focusOwner');
        calls.focusOwner += 1;
        invoker.focus({ preventScroll: true });
      },
    };

    const keyboard = createKeyboard(host);

    document.addEventListener('keydown', (event) => {
      keyboard.handleKeydown(event);
    });

    // Активация пункта — единственный путь и для мыши, и для клавиатуры: обработчик
    // один, и он достаёт коллбэк по внутреннему ключу пункта из общей карты.
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const element = target.closest('.vc-item');
      if (element === null) {
        return;
      }
      for (const entry of levels) {
        for (const item of entry.items) {
          if (item.element !== element || item.key === null) {
            continue;
          }
          const label = labelIn(item.element) ?? '';
          clickLabels.push(label);
          // Активация попадает в тот же журнал, что и вызовы хоста: порядок
          // «сначала действие, потом закрытие» виден только здесь.
          calls.order.push(`action:${label}`);
          const definition = actions.get(item.key);
          if (definition !== undefined && definition.action !== undefined) {
            definition.action(event);
          }
          return;
        }
      }
    });

    /**
     * @param {number[]} path
     * @returns {LevelEntry}
     */
    function levelOf(path) {
      let entry = openedRoot();
      for (const index of path) {
        const child = childOf(entry, entry.items[index]);
        if (child === null) {
          throw new Error(`в дереве нет уровня ${JSON.stringify(path)}`);
        }
        entry = child;
      }
      return entry;
    }

    /**
     * @param {ItemAt} at
     * @returns {RenderedItem}
     */
    function itemAt(at) {
      return levelOf(at.path).items[at.index];
    }

    /**
     * @param {Element} element
     * @returns {string | null}
     */
    function labelIn(element) {
      const label = element.querySelector('.vc-label');
      return label === null ? null : label.textContent;
    }

    /**
     * @param {Element} element
     * @returns {string | null} подпись пункта меню либо `id` элемента снаружи.
     */
    function describeTarget(element) {
      const item = element.closest('.vc-item');
      if (item !== null) {
        return labelIn(item);
      }
      return element.id === '' ? null : element.id;
    }

    /**
     * @returns {FocusState}
     */
    function focusState() {
      const active = document.activeElement;
      const item = active === null ? null : active.closest('.vc-item');
      return {
        label: item === null ? null : labelIn(item),
        inMenu: active !== null && active.closest('.vc-menu') !== null,
        onInvoker: active === invoker,
      };
    }

    /**
     * @param {LevelEntry} entry
     * @returns {LevelState}
     */
    function levelState(entry) {
      const active = document.activeElement;
      /** @type {ItemState[]} */
      const items = [];
      let tabStops = 0;
      let activeMarks = 0;
      for (const item of entry.items) {
        const isActive = item.element.hasAttribute('data-active');
        if (item.element.getAttribute('tabindex') === '0') {
          tabStops += 1;
        }
        if (isActive) {
          activeMarks += 1;
        }
        items.push({
          label: labelIn(item.element),
          role: item.element.getAttribute('role'),
          tabindex: item.element.getAttribute('tabindex'),
          active: isActive,
          focused: active === item.element,
          focusable: item.focusable,
          hasSubmenu: item.hasSubmenu,
          haspopup: item.element.getAttribute('aria-haspopup'),
          expanded: item.element.getAttribute('aria-expanded'),
          owns: item.element.getAttribute('aria-owns'),
        });
      }
      const focused = items.find((item) => {
        return item.focused;
      });
      return {
        id: entry.element.id,
        open: entry.open,
        popoverOpen: entry.element.matches(':popover-open'),
        children: entry.children.length,
        activeIndex: entry.activeIndex,
        tabStops,
        activeMarks,
        focusLabel: focused === undefined ? null : focused.label,
        items,
      };
    }

    /**
     * @param {string} key
     * @param {ItemAt | undefined} at
     * @returns {{ prevented: boolean, target: string | null }}
     */
    function press(key, at) {
      const target = at === undefined ? document.activeElement : itemAt(at).element;
      if (target === null) {
        return { prevented: false, target: null };
      }
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return { prevented: event.defaultPrevented, target: describeTarget(target) };
    }

    /**
     * @param {Record<string, number[]>} paths
     * @returns {ProbeSnapshot}
     */
    function read(paths) {
      /** @type {Record<string, LevelState>} */
      const levelStates = {};
      for (const [name, path] of Object.entries(paths)) {
        levelStates[name] = levelState(levelOf(path));
      }
      return {
        levels: levelStates,
        // Журнал копируется: `before` и `after` обязаны быть разными снимками,
        // иначе они ссылались бы на один живой объект и сравнивались бы сами с
        // собой.
        calls: { ...calls, openSubmenuIds: [...calls.openSubmenuIds], order: [...calls.order] },
        actions: [...actionLabels],
        clicks: [...clickLabels],
        focus: focusState(),
        focusCalls: focusCalls.map((call) => {
          return { ...call };
        }),
      };
    }

    /**
     * @param {Step} step
     * @returns {StepResult}
     */
    function execute(step) {
      if (step.command === 'clear') {
        // Отметки снимает вызывающий код, а уровень движку остаётся известным:
        // `reset` был бы другим состоянием — он и отметки снимает, и уровень
        // забывает.
        const entry = openedRoot();
        for (const item of entry.items) {
          item.element.tabIndex = -1;
          item.element.removeAttribute('data-active');
        }
        entry.activeIndex = -1;
        return {
          command: step.command,
          key: null,
          prevented: false,
          target: null,
          focus: focusState(),
          levels: read(pathsOfRun).levels,
        };
      }
      if (step.command === 'reset') {
        keyboard.reset();
        return {
          command: step.command,
          key: null,
          prevented: false,
          target: null,
          focus: focusState(),
          levels: read(pathsOfRun).levels,
        };
      }
      if (step.command === 'read') {
        return {
          command: step.command,
          key: null,
          prevented: false,
          target: null,
          focus: focusState(),
          levels: read(pathsOfRun).levels,
        };
      }
      if (step.command === 'press-outside') {
        // Фокус на элементе-владельце — состояние, в котором клавиша приходит
        // вне меню по-настоящему.
        invoker.focus({ preventScroll: true });
        const event = new KeyboardEvent('keydown', {
          key: step.key ?? '',
          bubbles: true,
          cancelable: true,
        });
        outside.dispatchEvent(event);
        return {
          command: step.command,
          key: step.key ?? null,
          prevented: event.defaultPrevented,
          target: outside.id,
          focus: focusState(),
          levels: read(pathsOfRun).levels,
        };
      }
      if (step.command === 'press-list') {
        // Цель внутри меню, но не под пунктом: прокручиваемый список.
        const list = openedRoot().element.querySelector('.vc-list');
        if (list === null) {
          throw new Error('у уровня нет списка');
        }
        const event = new KeyboardEvent('keydown', {
          key: step.key ?? '',
          bubbles: true,
          cancelable: true,
        });
        list.dispatchEvent(event);
        return {
          command: step.command,
          key: step.key ?? null,
          prevented: event.defaultPrevented,
          target: 'vc-list',
          focus: focusState(),
          levels: read(pathsOfRun).levels,
        };
      }
      const result = press(step.key ?? '', step.at);
      return {
        command: step.command,
        key: step.key ?? null,
        prevented: result.prevented,
        target: result.target,
        focus: focusState(),
        levels: read(pathsOfRun).levels,
      };
    }

    /**
     * @param {Step[]} steps
     * @param {Record<string, number[]>} paths
     * @returns {StepResult[]}
     */
    function run(steps, paths) {
      pathsOfRun = paths;
      /** @type {StepResult[]} */
      const results = [];
      for (const step of steps) {
        results.push(execute(step));
      }
      return results;
    }

    const probe = /** @type {KeyboardProbe} */ ({
      open(set, buildSubmenus) {
        layer = createLayer({ label: 'Меню файла', theme: 'light', actions });
        const items = sets[set];
        root = layer.ensureLevel(items, null, 0, null);
        levels.push(root);
        byElement.set(root.element, root);
        if (buildSubmenus !== false) {
          buildTree(root, items, 0);
        }
        openedLayer().showRoot(root, { x: 60, y: 60 });
        keyboard.focusFirst(root);
      },
      read,
      run,
    });

    const scope = /** @type {{ __vcKb?: KeyboardProbe }} */ (
      /** @type {unknown} */ (globalThis)
    );
    scope.__vcKb = probe;
  });
});

/**
 * Открывает меню, выполняет сценарий и отдаёт снимки до и после.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Scenario} scenario
 * @returns {Promise<ScenarioResult>}
 */
async function runScenario(page, scenario) {
  return page.evaluate((input) => {
    const scope = /** @type {{ __vcKb: KeyboardProbe }} */ (/** @type {unknown} */ (globalThis));
    const probe = scope.__vcKb;
    probe.open(input.set, input.buildSubmenus);
    const before = probe.read(input.paths);
    const steps = probe.run(input.steps, input.paths);
    return { before, steps, after: probe.read(input.paths) };
  }, scenario);
}
/**
 * Роуминг-состояние уровня по пунктам: подпись, `tabindex`, `data-active`, фокус.
 * Кортежи вместо объектов — сравнение читается построчно, а лишние поля
 * рендерера в нём не мешают.
 *
 * @param {LevelState} level
 * @returns {Array<[string | null, string | null, boolean, boolean]>}
 */
function rovingOf(level) {
  return level.items.map((item) => {
    return [item.label, item.tabindex, item.active, item.focused];
  });
}

/**
 * Отметки роуминга без фокуса: сравнение уровней между собой, где фокус ушёл на
 * другой уровень и сравнивать его не о чем. Фокус уровня меняется оттого, что
 * соседний уровень получил фокус, а отметки — нет.
 *
 * @param {LevelState} level
 * @returns {Array<[string | null, string | null, boolean]>}
 */
function marksOf(level) {
  return level.items.map((item) => {
    return [item.label, item.tabindex, item.active];
  });
}

/**
 * Подписи пунктов, у которых оказался фокус, по нажатиям. Шаги `read` и `reset` не
 * нажатия и в след не входят: иначе след удлинился бы на события, которых
 * пользователь не делал.
 *
 * @param {StepResult[]} steps
 * @returns {Array<string | null>}
 */
function focusTrail(steps) {
  return steps
    .filter((step) => {
      return step.command === 'press';
    })
    .map((step) => {
      return step.focus.label;
    });
}

test.describe('роуминг-фокус', () => {
  test('ArrowDown переключает активный пункт циклически, минуя disabled и разделители', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'cycle',
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'read' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
      ],
    });

    // Открытие отдало фокус первому доступному пункту — иначе «цикл» был бы циклом
    // относительно произвольной точки.
    expect(result.before.levels.root.focusLabel).toBe('Первый');
    // Четыре нажатия возвращают к первому, как велит бриф. Порядок зафиксирован
    // целиком: цикл из двух доступных пунктов сошёлся бы и на первой половине, а
    // цикл с прыжком через отключённый пункт дал бы другой порядок.
    expect(focusTrail(result.steps)).toEqual(['Второй', 'Первый', 'Второй', 'Первый']);
    // После первого нажатия снят прежний активный: у «Первого» не осталось ни
    // `tabindex="0"`, ни `data-active`, ни фокуса. Без этого на уровне стояло бы
    // два `tabindex="0"` сразу.
    expect(rovingOf(result.steps[1].levels.root)).toEqual([
      ['Первый', '-1', false, false],
      ['Заблокированный', '-1', false, false],
      [null, null, false, false],
      ['Второй', '0', true, true],
    ]);
    // Отключённый пункт и разделитель в цикл не попали ни разу: у них нет ни
    // `tabindex`, ни `data-active`, ни фокуса. У разделителя атрибута `tabindex`
    // нет вовсе — `-1` был бы числом в никуда.
    expect(rovingOf(result.after.levels.root)).toEqual([
      ['Первый', '0', true, true],
      ['Заблокированный', '-1', false, false],
      [null, null, false, false],
      ['Второй', '-1', false, false],
    ]);
    // Ровно один пункт уровня держит фокус и ровно один помечен.
    expect(result.after.levels.root.tabStops).toBe(1);
    expect(result.after.levels.root.activeMarks).toBe(1);
    // `activeIndex` — индекс в `entry.items`, а не в списке доступных: между
    // первым и последним доступным стоят отключённый пункт и разделитель.
    expect(result.steps[1].levels.root.activeIndex).toBe(3);
    expect(result.after.levels.root.activeIndex).toBe(0);
    // Стрелки разобраны движком, поэтому действие по умолчанию подавлено.
    expect(result.steps.map((step) => step.prevented)).toEqual([true, false, true, true, true]);
  });

  test('ArrowUp идёт в обратном направлении циклически', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tail',
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'ArrowUp' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowUp' },
        { command: 'press', key: 'ArrowUp' },
      ],
    });

    // Первый `ArrowUp` обязан встать на последний доступный пункт, а не на
    // последний по счёту: в хвосте уровня стоят отключённый пункт и разделитель,
    // и без них эти два пункта неразличимы.
    // Второй `ArrowDown` с последнего замыкает круг на первый — и только после
    // этого два `ArrowUp` идут в обратную сторону от середины, а не от края.
    expect(focusTrail(result.steps)).toEqual(['Третий', 'Первый', 'Третий', 'Второй']);
    // Отключённый хвост не посещён ни на одном шаге.
    expect(rovingOf(result.after.levels.root)).toEqual([
      ['Первый', '-1', false, false],
      ['Второй', '0', true, true],
      ['Третий', '-1', false, false],
      ['Хвост', '-1', false, false],
      [null, null, false, false],
    ]);
    expect(result.after.levels.root.tabStops).toBe(1);
    expect(result.after.levels.root.activeMarks).toBe(1);
    expect(result.after.levels.root.activeIndex).toBe(1);
  });

  test('Home и End переходят к первому и последнему доступному пункту', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tail',
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'End' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'Home' },
        { command: 'press', key: 'End' },
        { command: 'press', key: 'Home' },
      ],
    });

    // `End` встаёт на последний доступный — «Третий», а не отключённый «Хвост»,
    // и `Home` — на первый. Стрелка между ними доказывает, что `Home` и `End`
    // двигают роуминг, а не переставляют отметку на месте.
    expect(focusTrail(result.steps)).toEqual(['Третий', 'Первый', 'Первый', 'Третий', 'Первый']);
    expect(result.after.levels.root.activeIndex).toBe(0);
    expect(result.after.levels.root.tabStops).toBe(1);
    expect(result.after.levels.root.activeMarks).toBe(1);
  });

  test('data-active совпадает с элементом, имеющим фокус, а tabindex равен 0 только у него', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tail',
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
      ],
    });

    const level = result.after.levels.root;
    // Равенство трёх вещей проверяется поимённо: `tabindex="0"` ровно у одного
    // пункта, и это тот же пункт, что помечен `data-active` и держит фокус.
    // Расхождение любой пары означало бы, что подсветка и фокус разошлись, — а
    // `styles/mycontext.css` окрашивает именно `[data-active]`, и при открытии
    // подменю мышью `:focus-visible` не срабатывает вовсе.
    const stops = level.items.filter((item) => {
      return item.tabindex === '0';
    });
    expect(stops).toHaveLength(1);
    expect(stops[0].active).toBe(true);
    expect(stops[0].focused).toBe(true);
    expect(level.focusLabel).toBe('Третий');
    // Пункт, с которого ушли, отметку потерял: без этого на уровне осталось бы два
    // `tabindex="0"` и два `data-active` сразу.
    expect(rovingOf(result.before.levels.root)).toEqual([
      ['Первый', '0', true, true],
      ['Второй', '-1', false, false],
      ['Третий', '-1', false, false],
      ['Хвост', '-1', false, false],
      [null, null, false, false],
    ]);
    expect(rovingOf(level)).toEqual([
      ['Первый', '-1', false, false],
      ['Второй', '-1', false, false],
      ['Третий', '0', true, true],
      ['Хвост', '-1', false, false],
      [null, null, false, false],
    ]);
    // `activeIndex` совпадает с активным пунктом по индексу в `entry.items`.
    expect(level.activeIndex).toBe(2);
  });
});

test.describe('переходы между уровнями', () => {
  test('ArrowRight открывает подменю и переносит фокус в его первый пункт', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        // Роуминг доходит до владельца раньше, чем в него входят: активным
        // пунктом уровня остаётся носитель `data-active`, а не цель события.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
      ],
    });

    // Подменю открыто ровно один раз, и открыт тот уровень, чей `id` владелец
    // зарезервировал в `aria-owns` — иначе `aria-owns` вёл бы в никуда.
    expect(result.after.calls.openSubmenu).toBe(1);
    expect(result.after.calls.openSubmenuIds).toEqual([result.after.levels.sub.id]);
    expect(result.after.levels.sub.open).toBe(true);
    expect(result.after.levels.sub.popoverOpen).toBe(true);
    // Фокус ушёл в первый доступный пункт подменю, а не остался на владельце.
    expect(focusTrail(result.steps)).toEqual(['Экспорт', 'PDF']);
    expect(result.after.focus.inMenu).toBe(true);
    expect(rovingOf(result.after.levels.sub)).toEqual([
      ['PDF', '0', true, true],
      ['PNG', '-1', false, false],
    ]);
    expect(result.after.levels.sub.activeIndex).toBe(0);
    // Владелец в родительском уровне остался активным: ровно один `tabindex="0"` и
    // одна отметка на уровень, а не по одному на всё меню. По нему же видно, что
    // подменю открылось через слой, а не мимо него.
    expect(rovingOf(result.after.levels.root)[1]).toEqual(['Экспорт', '0', true, false]);
    expect(result.after.levels.root.items[1].expanded).toBe('true');
    expect(result.after.levels.root.tabStops).toBe(1);
    expect(result.after.levels.sub.tabStops).toBe(1);
    expect(result.steps[1].prevented).toBe(true);
  });

  test('ArrowRight на пункте без подменю ничего не делает', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      // Клавиша уходит в активный пункт — «Открыть», у которого подменю нет.
      steps: [{ command: 'press', key: 'ArrowRight' }],
    });

    expect(result.steps[0].target).toBe('Открыть');
    // Ни одного вызова хоста: подменю у пункта нет, и открывать нечего.
    expect(result.after.calls).toEqual({
      closeAll: 0,
      closeCurrentLevel: 0,
      openSubmenu: 0,
      openSubmenuIds: [],
      focusOwner: 0,
      order: [],
    });
    // Уровень не тронут вовсе — ни отметок, ни фокуса. Сравнение всего снимка
    // вместо отдельных полей: любое изменение состояния роняет кейс.
    expect(result.after.levels.root).toEqual(result.before.levels.root);
    expect(result.after.focus).toEqual(result.before.focus);
    // Клавишу движок всё же разобрал, поэтому её действие по умолчанию подавлено:
    // иначе стрелка вела бы себя по-разному в зависимости от пункта, и прокрутка
    // страницы зависела бы от того, где стоит фокус.
    expect(result.steps[0].prevented).toBe(true);
  });

  test('ArrowLeft закрывает подменю и возвращает фокус на пункт-владелец', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        // Перед возвратом активный пункт подменя уводится со первого: иначе «фокус
        // вернулся к владельцу» совпало бы с «фокус и не уходил».
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowLeft' },
      ],
    });

    expect(focusTrail(result.steps)).toEqual(['Экспорт', 'PDF', 'PNG', 'Экспорт']);
    // Закрыт текущий уровень, а не всё меню.
    expect(result.after.calls.closeCurrentLevel).toBe(1);
    expect(result.after.calls.closeAll).toBe(0);
    expect(result.after.calls.order).toEqual([
      `openSubmenu:${result.before.levels.sub.id}`,
      'closeCurrentLevel',
    ]);
    expect(result.after.levels.sub.open).toBe(false);
    expect(result.after.levels.sub.popoverOpen).toBe(false);
    expect(result.after.levels.root.open).toBe(true);
    // Фокус вернулся на владельца, и в родительском уровне он снова единственный
    // активный.
    expect(result.after.levels.root.activeIndex).toBe(1);
    expect(result.after.levels.root.tabStops).toBe(1);
    expect(result.after.levels.root.activeMarks).toBe(1);
    // Отметка развёрнутости снята закрытым уровнем, а `aria-owns` остался: подменю
    // у пункта есть и появится снова.
    expect(result.after.levels.root.items[1].expanded).toBe(null);
    expect(result.after.levels.root.items[1].owns).toBe(result.before.levels.sub.id);
  });

  test('ArrowLeft на корневом уровне вызывает closeAll', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        // Возврат в корень: следующая стрелка влево обязана увидеть уровень без
        // родителя, иначе ветка «закрыть всё» не была бы проверена никогда.
        { command: 'press', key: 'ArrowLeft' },
        { command: 'press', key: 'ArrowLeft' },
      ],
    });

    expect(result.after.calls.closeAll).toBe(1);
    expect(result.after.calls.closeCurrentLevel).toBe(1);
    expect(result.after.calls.order).toEqual([
      `openSubmenu:${result.before.levels.sub.id}`,
      'closeCurrentLevel',
      'closeAll',
    ]);
    // `closeAll` — цепочка целиком, поэтому закрыты оба уровня.
    expect(result.after.levels.root.open).toBe(false);
    expect(result.after.levels.sub.open).toBe(false);
    expect(result.after.levels.root.popoverOpen).toBe(false);
    // Возврат фокуса на владельца — работа вызывающего кода, и на корневом уровне
    // движок её не зовёт: `focusOwner` принадлежит только `Tab`.
    expect(result.after.calls.focusOwner).toBe(0);
  });

  test('уровень берётся из цели события, а не из последнего тронутого уровня', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        // Последний тронутый движком уровень — подменю, и фокус в нём.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'read' },
        // Клавиша приходит в пункт корневого уровня — в тот самый, который остался
        // активным после открытия подменю.
        { command: 'press', key: 'ArrowDown', at: { path: [], index: 1 } },
      ],
    });

    // Движение произошло в корневом уровне: активным там стал следующий пункт.
    expect(result.after.levels.root.activeIndex).toBe(2);
    expect(result.after.levels.root.focusLabel).toBe('Печать');
    expect(result.after.focus.label).toBe('Печать');
    // Снимок до движения действительно видел фокус в подменю, иначе сравнение
    // ниже было бы сравнением уровня с самим собой.
    expect(result.steps[2].levels.sub.focusLabel).toBe('PDF');
    // Подменю не тронуто: его отметки те же, а фокус ушёл — и сравниваются именно
    // отметки, потому что фокус уровня меняется оттого, что его получил сосед.
    expect(marksOf(result.after.levels.sub)).toEqual(marksOf(result.steps[2].levels.sub));
    expect(result.after.levels.sub.activeIndex).toBe(0);
    expect(result.after.calls.order).toEqual([`openSubmenu:${result.before.levels.sub.id}`]);
  });

  test('уровень без активного пункта начинает цикл с края', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tail',
      paths: { root: [] },
      steps: [
        { command: 'clear' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'clear' },
        { command: 'press', key: 'ArrowUp' },
      ],
    });

    // Отметки снял вызывающий код, а уровень движку остался известен: активного
    // пункта нет, и циклу не от чего отталкиваться.
    expect(result.steps[0].levels.root.activeIndex).toBe(-1);
    expect(result.steps[0].levels.root.tabStops).toBe(0);
    expect(result.steps[0].levels.root.activeMarks).toBe(0);
    // `ArrowDown` без активного идёт с первого, `ArrowUp` — с последнего. Отсчёт от
    // `-1` ушёл бы на минус один элемент списка, и `ArrowUp` встал бы на
    // предпоследний вместо последнего.
    expect(result.steps[1].levels.root.focusLabel).toBe('Первый');
    expect(result.steps[1].levels.root.activeIndex).toBe(0);
    expect(result.steps[2].levels.root.activeIndex).toBe(-1);
    expect(result.steps[3].levels.root.focusLabel).toBe('Третий');
    expect(result.after.levels.root.activeIndex).toBe(2);
    expect(result.after.levels.root.tabStops).toBe(1);
  });

  test('незаведённый уровень подменю: пункт-владелец молчит, а не активируется', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      // Дерево не заведено: владельцы в меню есть, а уровней за ними нет.
      buildSubmenus: false,
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'press', key: 'Enter' },
      ],
    });

    // Пункт — настоящий владелец: признаки рендерера на месте, а уровня за ним
    // нет. Именно так выглядит дерево, до которого вызывающий код не дошёл, и
    // движок обязан это различать, а не считать пунктом без подменю.
    expect(result.after.levels.root.items[1].hasSubmenu).toBe(true);
    expect(result.after.levels.root.items[1].haspopup).toBe('menu');
    expect(result.after.levels.root.children).toBe(0);
    // Ничего не открыто — показывать нечего, — и ничего не активировано: молчание
    // предпочтительнее активации пункта, чьё подменю так и не появится.
    expect(result.after.calls).toEqual({
      closeAll: 0,
      closeCurrentLevel: 0,
      openSubmenu: 0,
      openSubmenuIds: [],
      focusOwner: 0,
      order: [],
    });
    expect(result.after.actions).toEqual([]);
    expect(result.after.clicks).toEqual([]);
    expect(result.after.levels.root.open).toBe(true);
    expect(result.after.focus.label).toBe('Экспорт');
  });

  test('reset снимает отметки роуминга и забывает уровень', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'reset' },
        // Клавиши в уже списанный уровень обязаны остаться нетронутыми.
        { command: 'press', key: 'ArrowDown', at: { path: [], index: 0 } },
        { command: 'press', key: 'Home', at: { path: [], index: 0 } },
        { command: 'press', key: 'Escape', at: { path: [], index: 0 } },
      ],
    });

    // Снимок после `reset` — отдельный шаг, иначе «до» и «после» совпали бы.
    const cleared = result.steps[2].levels.root;
    expect(cleared.tabStops).toBe(0);
    expect(cleared.activeMarks).toBe(0);
    expect(cleared.activeIndex).toBe(-1);
    expect(cleared.items.every((item) => {
      return item.tabindex !== '0' && !item.active;
    })).toBe(true);
    // Подменю сброшено тем же вызовом: снимок не разбирает уровни по одному.
    expect(result.steps[2].levels.sub.tabStops).toBe(0);
    expect(result.steps[2].levels.sub.activeIndex).toBe(-1);
    // Фокус `reset` не забирает: куда его девать, решает вызывающий код.
    expect(result.steps[2].focus.label).toBe('PDF');
    // Забытый уровень ни на что не отвечает: клавиши не разобраны, события не
    // гасятся, хост не тронут. Иначе движок продолжал бы работать с меню, которое
    // вызывающий код уже списал.
    expect(result.steps.slice(3).map((step) => step.prevented)).toEqual([false, false, false]);
    expect(result.after.calls).toEqual({
      closeAll: 0,
      closeCurrentLevel: 0,
      openSubmenu: 1,
      openSubmenuIds: [result.before.levels.sub.id],
      focusOwner: 0,
      order: [`openSubmenu:${result.before.levels.sub.id}`],
    });
    // Отметки не вернулись сами собой.
    expect(result.after.levels.root.tabStops).toBe(0);
    expect(result.after.levels.root.activeIndex).toBe(-1);
    expect(result.after.levels.sub.activeIndex).toBe(-1);
  });
});

test.describe('активация', () => {
  test('Enter вызывает action активного пункта и закрывает меню', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      // Клавиша уходит в активный пункт, то есть в первый доступный.
      steps: [{ command: 'press', key: 'Enter' }],
    });

    expect(result.steps[0].target).toBe('Открыть');
    // `action` отработал ровно один раз, и у того пункта, который активен.
    expect(result.after.actions).toEqual(['Открыть']);
    // Активация идёт кликом по пункту: единственный путь, одинаковый для мыши и
    // для клавиатуры, и поэтому `action` получает настоящее событие с настоящей
    // целью, а не вызов по внутреннему ключу из обхода дерева.
    expect(result.after.clicks).toEqual(['Открыть']);
    // Закрытие после активации — отдельное требование: активация пункта гасит
    // меню даже там, где его не гасит собственный обработчик.
    expect(result.after.calls.closeAll).toBe(1);
    expect(result.after.calls.order).toEqual(['action:Открыть', 'closeAll']);
    expect(result.after.levels.root.open).toBe(false);
    expect(result.after.levels.root.popoverOpen).toBe(false);
    expect(result.steps[0].prevented).toBe(true);
  });

  test('Enter на пункте-владельце открывает подменю и не вызывает action', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'Enter' },
      ],
    });

    // Счётчик вызовов `action` остаётся нулём, и клика по пункту не было вовсе: у
    // пункта-владельца активация означает открытие подменю.
    expect(result.after.actions).toEqual([]);
    expect(result.after.clicks).toEqual([]);
    expect(result.after.calls.openSubmenu).toBe(1);
    expect(result.after.calls.openSubmenuIds).toEqual([result.after.levels.sub.id]);
    // Меню не закрылось: подменю открылось, а не активировался пункт.
    expect(result.after.calls.closeAll).toBe(0);
    expect(result.after.levels.sub.open).toBe(true);
    expect(result.after.levels.sub.popoverOpen).toBe(true);
    expect(result.after.levels.root.items[1].expanded).toBe('true');
    // Фокус остался на владельце: бриф велит открыть подменю и не вел переносить
    // фокус в него — в отличие от `ArrowRight`. Так `Enter` не выбирает за
    // пользователя уровень, а `ArrowRight` выбирает.
    expect(focusTrail(result.steps)).toEqual(['Экспорт', 'Экспорт']);
    expect(result.after.levels.root.activeIndex).toBe(1);
    expect(result.after.levels.sub.tabStops).toBe(0);
    expect(result.after.levels.sub.activeMarks).toBe(0);
  });

  test('Space вызывает action', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        // Пункт перед `Space` — последний доступный, а не первый: без `End` кейс
        // проверил бы, что активируется «какой-то пункт».
        { command: 'press', key: 'End' },
        { command: 'press', key: ' ' },
      ],
    });

    expect(result.steps[0].focus.label).toBe('Выход');
    expect(result.after.actions).toEqual(['Выход']);
    expect(result.after.clicks).toEqual(['Выход']);
    expect(result.after.calls.closeAll).toBe(1);
    expect(result.after.calls.order).toEqual(['action:Выход', 'closeAll']);
    // Пробел гасится: иначе страница прокрутилась бы под меню.
    expect(result.steps[1].prevented).toBe(true);
  });

  test('Space на пункте-владельце открывает подменю и не вызывает action', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [2] },
      steps: [
        // «Печать» — третий доступный пункт корня, и у него подменю в два уровня.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: ' ' },
      ],
    });

    // `Space` и `Enter` обязаны вести себя одинаково: иначе у владельца подменю одна
    // клавиша открывала бы подменю, а вторая активировала бы пункт.
    expect(result.after.actions).toEqual([]);
    expect(result.after.clicks).toEqual([]);
    expect(result.after.calls.openSubmenuIds).toEqual([result.after.levels.sub.id]);
    expect(result.after.levels.sub.open).toBe(true);
    expect(result.after.calls.closeAll).toBe(0);
  });

  test('подменю: [] не делает пункт владельцем: Enter активирует его', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        // Три шага вниз по доступным пунктам: «Открыть», «Экспорт», «Печать»,
        // «Пустое подменю». Разделитель между ними и последний «Выход» в счёт не
        // идут, поэтому шагов именно три.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'press', key: 'Enter' },
      ],
    });

    expect(focusTrail(result.steps)).toEqual([
      'Экспорт', 'Печать', 'Пустое подменю', 'Пустое подменю', 'Пустое подменю',
    ]);
    // Пункт с пустым `submenu` не владелец: `ArrowRight` не открыл ничего, а
    // `Enter` активировал его.
    expect(result.after.actions).toEqual(['Пустое подменю']);
    expect(result.after.clicks).toEqual(['Пустое подменю']);
    expect(result.after.calls.openSubmenu).toBe(0);
    expect(result.after.calls.closeAll).toBe(1);
    // Признаков владельца у пункта нет ни одного: ни `aria-haspopup`, ни
    // `aria-owns`, ни `aria-expanded`, ни `hasSubmenu`. Это решение рендерера, и
    // обязано совпадать с решением слоя и движка.
    expect(result.after.levels.root.items[3]).toEqual({
      label: 'Пустое подменю',
      role: 'menuitem',
      tabindex: '0',
      active: true,
      focused: true,
      focusable: true,
      hasSubmenu: false,
      haspopup: null,
      expanded: null,
      owns: null,
    });
    // И уровня под ним не заведено: у первых трёх пунктов подменю есть, у него —
    // нет, и `children` их считает.
    expect(result.after.levels.root.children).toBe(2);
  });
});

test.describe('закрытие', () => {
  test('Escape закрывает самое глубокое подменю, не трогая корень', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [2], deep: [2, 0] },
      steps: [
        // «Печать» — третий доступный пункт корня, «Глубже» — первый доступный в
        // его подменю.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'press', key: 'Escape' },
      ],
    });

    expect(focusTrail(result.steps)).toEqual([
      'Экспорт', 'Печать', 'Глубже', 'Самый нижний', 'Глубже',
    ]);
    // Закрыт ровно один уровень — самый глубокий, где стоял фокус.
    expect(result.after.calls.closeCurrentLevel).toBe(1);
    expect(result.after.calls.closeAll).toBe(0);
    expect(result.after.calls.order).toEqual([
      `openSubmenu:${result.before.levels.sub.id}`,
      `openSubmenu:${result.before.levels.deep.id}`,
      'closeCurrentLevel',
    ]);
    expect(result.after.levels.deep.open).toBe(false);
    expect(result.after.levels.deep.popoverOpen).toBe(false);
    // Корень и промежуточное подменю не тронуты.
    expect(result.after.levels.sub.open).toBe(true);
    expect(result.after.levels.root.open).toBe(true);
    // Фокус ушёл на владельца закрытого уровня. Без этого он остался бы в гаснущем
    // подменю и упал бы на `<body>`: меню закрыто, а `data-active` стоял бы на
    // пункте чужого уровня.
    expect(result.after.levels.sub.activeIndex).toBe(0);
    expect(result.after.levels.sub.tabStops).toBe(1);
    expect(result.after.levels.root.tabStops).toBe(1);
  });

  test('Escape на корневом уровне вызывает closeAll', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        // Возврат в корень: `Escape` обязан увидеть уровень без родителя.
        { command: 'press', key: 'ArrowLeft' },
        { command: 'press', key: 'Escape' },
      ],
    });

    expect(result.after.calls.closeAll).toBe(1);
    expect(result.after.calls.closeCurrentLevel).toBe(1);
    expect(result.after.calls.order).toEqual([
      `openSubmenu:${result.before.levels.sub.id}`,
      'closeCurrentLevel',
      'closeAll',
    ]);
    expect(result.after.levels.root.open).toBe(false);
    expect(result.after.levels.sub.open).toBe(false);
    // Как и `ArrowLeft` на корне, `Escape` фокус не возвращает: на корне владельца
    // нет, а `focusOwner` принадлежит только `Tab`.
    expect(result.after.calls.focusOwner).toBe(0);
  });

  test('Tab закрывает всё меню и вызывает focusOwner', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        // Фокус в подменю: `Tab` обязан закрыть всю цепочку, а не текущий уровень.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'press', key: 'Tab' },
      ],
    });

    expect(result.after.calls.closeAll).toBe(1);
    expect(result.after.calls.closeCurrentLevel).toBe(0);
    expect(result.after.calls.focusOwner).toBe(1);
    // Порядок обязателен: фокус возвращается после закрытия, иначе он ушёл бы на
    // элемент, который в этот же момент гасится.
    expect(result.after.calls.order).toEqual([
      `openSubmenu:${result.before.levels.sub.id}`,
      'closeAll',
      'focusOwner',
    ]);
    expect(result.after.levels.root.open).toBe(false);
    expect(result.after.levels.sub.open).toBe(false);
    // Фокус на элементе-владельце и вне меню.
    expect(result.after.focus.onInvoker).toBe(true);
    expect(result.after.focus.inMenu).toBe(false);
    // `Tab` разобран движком, поэтому его собственная семантика подавлена: иначе
    // закрытие отложено на `animationDuration`, узел с `tabindex="0"` ещё лежал бы
    // в документе, и браузер увёл бы фокус в гаснущее меню вместо
    // элемента-владельца.
    expect(result.steps[2].prevented).toBe(true);
  });
});

test.describe('границы разбора', () => {
  test('клавиши вне контейнера не обрабатываются', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press-outside', key: 'Tab' },
        { command: 'press-outside', key: 'ArrowDown' },
        { command: 'press-outside', key: 'Enter' },
        { command: 'press-outside', key: 'Escape' },
      ],
    });

    // События не гасятся: обработчик обязан пропускать клавиши, пришедшие не в
    // меню. Иначе `Tab` на странице перестал бы уходить с элемента-владельца, и
    // меню, закрытое вкладкой, ломало бы навигацию по странице целиком.
    expect(result.steps.map((step) => step.prevented)).toEqual([false, false, false, false]);
    expect(result.steps.map((step) => step.target)).toEqual([
      'outside', 'outside', 'outside', 'outside',
    ]);
    // Ни одного вызова хоста.
    expect(result.after.calls).toEqual({
      closeAll: 0,
      closeCurrentLevel: 0,
      openSubmenu: 0,
      openSubmenuIds: [],
      focusOwner: 0,
      order: [],
    });
    // Роуминг-состояние меню не тронуто. Отметки, а не весь снимок: фокус ушёл на
    // элемент-владельца по условию шага, и его смена — не результат обработки.
    expect(marksOf(result.after.levels.root)).toEqual(marksOf(result.before.levels.root));
    expect(result.after.levels.root.activeIndex).toBe(0);
    expect(result.after.levels.root.tabStops).toBe(1);
    // Фокус остался на элементе-владельце и вне меню.
    expect(result.after.focus.onInvoker).toBe(true);
    expect(result.after.focus.inMenu).toBe(false);
    expect(result.after.actions).toEqual([]);
  });

  test('клавиша в прокручиваемый список, а не в пункт, роуминг не двигает', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press-list', key: 'ArrowDown' },
        { command: 'press-list', key: 'End' },
        { command: 'press-list', key: 'Escape' },
      ],
    });

    expect(result.steps[0].focus.label).toBe('Экспорт');
    // Цель внутри меню, но не под пунктом. Обработчик имеет право искать уровень по
    // `.vc-menu` — но двигать роуминг по цели без пункта под ней нельзя: у прокрутки
    // списка своя логика, и стрелка вверх там значит «прокрутить», а не «встать на
    // предыдущий пункт».
    expect(result.steps.map((step) => step.target)).toEqual([
      'Открыть', 'vc-list', 'vc-list', 'vc-list',
    ]);
    expect(result.steps.map((step) => step.prevented)).toEqual([true, false, false, false]);
    expect(result.after.levels.root.activeIndex).toBe(1);
    expect(result.after.levels.root.focusLabel).toBe('Экспорт');
    expect(result.after.calls.order).toEqual([]);
  });

  test('клавиши без ветви не гасятся и состояние не трогают', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'PageDown' },
        { command: 'press', key: 'F1' },
        // Буква: typeahead не реализуется по спецификации, и буква обязана остаться
        // буквой, а не превратиться в переход по первому совпавшему пункту.
        { command: 'press', key: 'a' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'PageUp' },
      ],
    });

    expect(result.steps.map((step) => step.prevented)).toEqual([false, false, false, true, false]);
    // Три незнакомые клавиши не сдвинули активный пункт, а `ArrowDown` между ними
    // сдвинул: иначе «не сдвинули» было бы свойством уровня из одного пункта.
    expect(focusTrail(result.steps)).toEqual(['Открыть', 'Открыть', 'Открыть', 'Экспорт', 'Экспорт']);
    expect(result.after.levels.root.activeIndex).toBe(1);
    expect(result.after.calls.order).toEqual([]);
  });

  test('фокус всегда с preventScroll', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'End' },
        { command: 'press', key: 'Home' },
        // Возврат фокуса на элемент-владельца — тоже вызов `focus` из модуля.
        { command: 'press', key: 'Tab' },
      ],
    });

    const inMenu = result.after.focusCalls.filter((call) => {
      return call.inMenu;
    });
    // Проба видит вызовы и в меню, и вне его: иначе фильтр был бы пустым по
    // построению, а утверждение ниже — проверкой пустоты.
    expect(result.after.focusCalls.length).toBeGreaterThan(inMenu.length);
    // Четыре передачи фокуса внутри меню: показать уровень, два перехода и
    // `Home`. Каждая — с `preventScroll: true`: меню `position: fixed`, и без
    // флага страница уехала бы от курсора в тот самый момент, когда пользователь
    // ушёл стрелкой с последнего пункта.
    expect(inMenu.length).toBe(4);
    for (const call of inMenu) {
      expect(call.preventScroll).toBe(true);
    }
  });
});
