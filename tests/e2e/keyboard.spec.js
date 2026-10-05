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
 * цель внутри меню, но не под пунктом, и уровень обязан разобрать такую клавишу так
 * же, как пришедшую на пункт. `show-submenu` — то, что делает вызывающий код по
 * наведению: открывает подменю пункта и отдаёт его движку, как обязан после каждого
 * показа. Отметок в показанном подменю при этом не появляется, и состояние «уровень
 * движку известен, активного пункта нет» получается самим собой.
 *
 * `hover` и `leave-tree` — мышиная сторона контракта, и оба не отправляют событий:
 * движок мышь не слушает, решение о выделении принимает вызывающий код, и проба
 * повторяет именно это решение. `hover` — курсор встал на доступный пункт, то есть
 * `activateFromPointer`; `leave-tree` — курсор ушёл с дерева меню, то есть полный
 * сброс отметок. Ход событий страницы эти шаги не моделируют намеренно: он
 * проверяется там, где события настоящие, — в `submenu.spec.js`.
 *
 * @typedef {object} Step
 * @property {'press' | 'press-outside' | 'press-list' | 'show-submenu' | 'hover' | 'leave-tree' | 'read' | 'reset'} command
 * @property {string} [key]
 * @property {ItemAt} [at]
 */

/**
 * Снимок состояния пункта уровня.
 *
 * `tabindex`, `active` и `focused` — три независимые вещи, и равенство первых
 * двух при равенстве третьему и есть контракт роуминга. `haspopup`, `expanded`
 * и `owns` сняты потому, что именно они отличают владельца подменю от пункта с
 * `submenuAction`: у владельца есть все три, у пункта без него — ни одного.
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
 * @property {boolean} inView помещается ли пункт в видимую часть прокручиваемого
 *   списка. `focus` с `preventScroll` этого не делает: без отдельной прокрутки
 *   активный пункт уходит под край списка вместе с фокусом.
 */

/**
 * Состояние прокручиваемого списка уровня. Снято потому, что `inView` у всех
 * пунктов короткого меню истинно по построению, и без этих полей утверждение о
 * видимости было бы проверкой пустоты.
 *
 * @typedef {object} ListState
 * @property {number} scrollTop
 * @property {number} scrollHeight
 * @property {number} clientHeight
 * @property {boolean} scrollable `scrollHeight` больше `clientHeight`.
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
 * @property {ListState} list
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
 * @property {string[]} focusChanges подписи пунктов, которым сообщили о фокусе, по
 *   порядку; строка `'нет'` на каждый вызов с `null`. Журнал, а не счётчик: важно
 *   знать, кому и в каком порядке сообщали, а «сколько раз» это и есть длина.
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
 * @property {(index: number, enabled: boolean) => Promise<void>} reshow повторный показ
 *   корневого уровня после правки `isEnabledAction` у пункта набора: тот же путь,
 *   что и `open`, но меню не пересобирается.
 * @property {(index: number) => Promise<string | null>} ensureSubmenu пытается завести
 *   уровень-подменю пункта по индексу и отдаёт сообщение слоя либо `null`, если
 *   уровень заведён.
 * @property {(paths: Record<string, number[]>) => ProbeSnapshot} read
 * @property {(steps: Step[], paths: Record<string, number[]>) => Promise<StepResult[]>} run
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
    /** @type {string} имя набора, открытого последним: правке `isEnabledAction`
     *  подлежит именно он, а набор приходит в пробу по имени. */
    let openedSet = '';
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
      { labelAction: () => 'Первый' },
      { labelAction: () => 'Заблокированный', isEnabledAction: () => false },
      { type: 'separator' },
      { labelAction: () => 'Второй' },
    ];

    /**
     * Отключённый пункт в хвосте и разделитель после него: «последний
     * доступный» и «последний по счёту» здесь разные пункты, и без такого хвоста
     * подмена их не различить — `End` и `ArrowUp` встали бы на отключённый.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const tail = [
      { labelAction: () => 'Первый' },
      { labelAction: () => 'Второй' },
      { labelAction: () => 'Третий' },
      { labelAction: () => 'Хвост', isEnabledAction: () => false },
      { type: 'separator' },
    ];

    /** @type {MenuItem[]} */
    const deepest = [{ labelAction: () => 'Самый нижний' }];

    /**
     * Меню длиннее вьюпорта: `.vc-list` ограничен `max-height: calc(100dvh - 2 *
     * var(--vc-padding))` и прокручивается, поэтому часть пунктов физически не
     * помещается в кадр. Двадцать восемь пикселей на пункт против 674 доступных
     * дают 24 пункта в кадре, а сорок — нет. Из 684 доступных вычитаются
     * `padding: 4px` и `border: 1px` меню с каждой стороны.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const long = Array.from({ length: 40 }, (unused, index) => {
      return { labelAction: () => `Пункт ${index + 1}` };
    });

    /**
     * Уровень без единого доступного пункта: отключённый пункт и разделитель.
     * Регистрировать его всё равно надо, а помечать нечего, поэтому
     * `registerLevel` на таком уровне обязан закончиться регистрацией, а не
     * исключением.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const dead = [
      { labelAction: () => 'Глухой', isEnabledAction: () => false },
      { type: 'separator' },
    ];

    /**
     * Отключённый владелец непустого подменю. `renderer.js` ставит `hasSubmenu`
     * только доступному владельцу непустого подменю, поэтому у такого пункта нет ни
     * шеврона, ни `aria-owns`, и слой не заведёт ему уровень: `ensureLevel`
     * требует зарезервированный адрес и бросит без него. Роуминг к пункту не
     * приходит, и возвращать на него фокус тоже незачем.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const offLimits = [
      { labelAction: () => 'Живой' },
      {
        labelAction: () => 'Мёртвый владелец',
        isEnabledAction: () => false,
        submenuAction: () => [{ labelAction: () => 'Внутрь' }],
      },
      { labelAction: () => 'Живой владелец', submenuAction: () => [{ labelAction: () => 'Тоже внутрь' }] },
    ];
    /**
     * Вложенность: подменю подменю. `MenuItem[]`, а не со смешанным списком: у
     * пункта поле `submenu` объявлено как `MenuItem[]`, и разделитель в
     * подменю — это уже другая фикстура.
     *
     * @type {MenuItem[]}
     */
    const nested = [
      { labelAction: () => 'Глубже', submenuAction: () => deepest },
      { labelAction: () => 'Обычный пункт подменю' },
    ];

    /**
     * Меню со всеми состояниями, которые различают пункты: обычный, владелец
     * подменю, владелец вложенного подменю, пункт с пустым `submenu`,
     * разделитель и последний обычный.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const tree = [
      { labelAction: () => 'Открыть', action: () => { record('Открыть'); } },
      {
        labelAction: () => 'Экспорт',
        submenuAction: () => [
          { labelAction: () => 'PDF', action: () => { record('PDF'); } },
          { labelAction: () => 'PNG' },
        ],
      },
      { labelAction: () => 'Печать', submenuAction: () => nested },
      // У пункта `submenuAction` нет вовсе: такой пункт владельцем не является и
      // активируется как обычный. С коллбэком, чтобы отличить активацию от
      // открытия подменя по одному только счётчику вызовов.
      { labelAction: () => 'Без подменю', action: () => { record('Без подменю'); } },
      { type: 'separator' },
      { labelAction: () => 'Выход', action: () => { record('Выход'); } },
    ];

    /**
     * Владелец подменю со своим действием и владелец без него, рядом и в одном
     * уровне: `Enter` у первого зовёт действие, у второго раскрывает подменю, и
     * различать их можно было бы только тем, что один из них настоящий.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const ownerActs = [
      {
        labelAction: () => 'Владелец с действием',
        submenuAction: () => [{ labelAction: () => 'Под ним' }],
        action: () => { record('Владелец с действием'); },
      },
      {
        labelAction: () => 'Владелец без действия',
        submenuAction: () => [{ labelAction: () => 'Тоже под ним' }],
      },
    ];

    /**
     * Уровень с единственным доступным пунктом: `moveTo` выбирает его при любом
     * шаге, и второй шаг не меняет ничего. Различать «фокус перешёл» и «фокус остался
     * там же» на таком уровне можно только этим — на уровне из нескольких пунктов тот
     * же случай даёт переход, и проверка прошла бы в обоих направлениях.
     *
     * @type {Array<MenuItem | SeparatorItem>}
     */
    const solo = [{ labelAction: () => 'Один' }];

    /**
     * @type {Record<string, Array<MenuItem | SeparatorItem>>}
     */
    const sets = { cycle, tail, tree, long, dead, offLimits, ownerActs, solo };

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
     * @returns {Promise<void>}
     */
    async function buildTree(entry, items, levelIndex) {
      for (const [index, item] of items.entries()) {
        if ('type' in item) {
          continue;
        }
        // Владельца называет рендерер, и спрашивать надо у него, а не выводить
        // владельца из `submenu` своими руками: отключённый пункт с непустым
        // подменю владельцем не является, и `ensureLevel` такому уровень не
        // заведёт. Ровно этот же фильтр держит оркестратор.
        const owner = entry.items[index];
        if (!owner.hasSubmenu) {
          continue;
        }
        const submenu = item.submenuAction === undefined
          ? null
          : await item.submenuAction();
        if (submenu === null) {
          continue;
        }
        const child = await openedLayer().ensureLevel(submenu, entry, levelIndex + 1, owner);
        levels.push(child);
        byElement.set(child.element, child);
        await buildTree(child, submenu, levelIndex + 1);
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
      focusChanges: [],
    };

    /**
     * Открытые уровни от корня к текущему: повторяет `#chain` в `MyContext`.
     * Ответ на «какой уровень текущий» читается из неё, и без неё фикстура
     * отвечала бы на вопрос о подменю, которого никто не открывал.
     *
     * @type {LevelEntry[]}
     */
    const chain = [];

    /**
     * Открытый уровень, заведённый перед своим показом: так цепочка остаётся
     * источником правды о том, что показано, а не о том, что заведено.
     *
     * @param {LevelEntry} entry
     * @returns {void}
     */
    function showInChain(entry) {
      const parent = entry.parent;
      const at = parent === null ? 0 : chain.indexOf(parent) + 1;
      chain.length = at;
      chain.push(entry);
    }

    // Хост — «MyContext-подобная» часть фикстуры: он владеет слоем, картой
    // активов и элементом-владельцем, и только он знает, что значит «закрыть
    // всё» или «вернуть фокус».
    //
    // `closeAll` фокуса не трогает намеренно: возвращать его — дело задачи 9, а
    // если бы возвращал, кейс про `Tab` проходил бы и без `focusOwner`.
    //
    // `openSubmenu` отдаёт уровень движку через `registerLevel` и фокуса не трогает —
    // ровно как это делает `#openSubmenu` в `MyContext`. Проверяется тут и разделение
    // ответственности: хост, который переносил бы фокус в подменю сам, скрыл бы от
    // кейса, кто перенос делает на самом деле, и «фокус ушёл в подменю» проходило бы
    // в обоих случаях.
    /** @type {KeyboardHost} */
    const host = {
      closeAll() {
        calls.order.push('closeAll');
        calls.closeAll += 1;
        openedLayer().hideAll();
        chain.length = 0;
      },
      async openSubmenu(entry) {
        calls.order.push(`openSubmenu:${entry.element.id}`);
        calls.openSubmenu += 1;
        calls.openSubmenuIds.push(entry.element.id);
        openedLayer().showSubmenu(entry);
        showInChain(entry);
        keyboard.registerLevel(entry, { focus: false });
        // Показ не перестраивает уровень: у пробы нет составов пунктов, которые
        // движок мог бы сверить. Показанный уровень по факту равен переданному, и
        // возвращать его — обязательство контракта, а не описание поведения.
        return entry;
      },
      closeCurrentLevel(entry) {
        calls.order.push('closeCurrentLevel');
        calls.closeCurrentLevel += 1;
        openedLayer().hide(entry);
        // Вместе с уровнем уходит вся ветка ниже него: пока подменю открыто из
        // закрытого, следующая открытая цепочка была бы с указанием на скрытое.
        const at = chain.indexOf(entry);
        if (at >= 0) {
          chain.length = at;
        }
      },
      currentLevel(entry) {
        // Последний элемент цепочки — самый глубокий показанный уровень, и он же
        // самый глубокий потомок любого своего предка. Уровня в цепочке нет, когда
        // он гаснет: клавиша в него ещё приходит, а текущим он быть не может.
        const deepest = chain[chain.length - 1];
        return deepest !== undefined && chain.includes(entry) ? deepest : entry;
      },
      focusOwner() {
        calls.order.push('focusOwner');
        calls.focusOwner += 1;
        invoker.focus({ preventScroll: true });
      },
      // Отдача управления на этом хосте не проверяется: у неё нет предмета среди
      // уровней, которые здесь заводятся, и её кейсы лежат в `handoff.spec.js`,
      // где хост настоящий. Здесь её достаточно объявить, чтобы объект отвечал
      // контракту `KeyboardHost`.
      handOver() {
        calls.order.push('handOver');
      },
      // Передача фокуса — единственный предмет этого журнала: кто и в каком порядке
      // узнал, что фокус его. `'нет'` означает вызов с `null`, то есть фокус ушёл с
      // пунктов на элемент уровня или с дерева вовсе.
      itemFocusChanged(next) {
        calls.focusChanges.push(next === null ? 'нет' : (labelIn(next.element) ?? 'без подписи'));
      },
    };

    const keyboard = createKeyboard(host);

    document.addEventListener('keydown', (event) => {
      keyboard.handleKeydown(event);
    });

    // Активация пункта — единственный путь и для мыши, и для клавиатуры: обработчик
    // один, и он достаёт коллбэк по внутреннему ключу пункта из общей карты.
    //
    // Закрытие живёт здесь же, а не в движке: в `MyContext` его делает
    // `#onLevelClick` в своём `finally`, и после активации движок `closeAll` не
    // зовёт — второй вызов был бы двойным закрытием с двойным возвратом фокуса.
    // Фикстура повторяет это разделение: обработчик активации один и закрывает сам.
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
          // Владелец подменю без своего действия кликом не активируется: показ
          // подменю идёт отдельным путём, и звать ему нечего. Владелец со своим
          // действием активируется ровно как обычный пункт, и фикстура обязана
          // повторять именно это — иначе любой будущий кейс, кликнувший по
          // владельцу мышью, закрепил бы обратное библиотеке.
          const definition = actions.get(item.key);
          if (item.hasSubmenu
            && (definition === undefined || definition.action === undefined)) {
            return;
          }
          const label = labelIn(item.element) ?? '';
          clickLabels.push(label);
          // Активация попадает в тот же журнал, что и вызовы хоста: порядок
          // «сначала действие, потом закрытие» виден только здесь.
          calls.order.push(`action:${label}`);
          if (definition !== undefined && definition.action !== undefined) {
            definition.action(event);
          }
          calls.order.push('close:activation');
          openedLayer().hideAll();
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
      const list = entry.element.querySelector('.vc-list');
      if (list === null) {
        throw new Error('у уровня нет списка');
      }
      const listRect = list.getBoundingClientRect();
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
        const rect = item.element.getBoundingClientRect();
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
          // Допуск в полпикселя на каждую границу: `scrollIntoView` совмещает
          // край пункта с краем списка, а координаты во всех трёх движках
          // округляются по-разному (в firefox — до 1/60 px).
          inView: rect.top >= listRect.top - 0.5 && rect.bottom <= listRect.bottom + 0.5,
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
        list: {
          scrollTop: list.scrollTop,
          scrollHeight: list.scrollHeight,
          clientHeight: list.clientHeight,
          scrollable: list.scrollHeight > list.clientHeight,
        },
        items,
      };
    }

    /**
     * @param {string} key
     * @param {ItemAt | undefined} at
     * @returns {Promise<{ prevented: boolean, target: string | null }>}
     */
    async function press(key, at) {
      const target = at === undefined ? document.activeElement : itemAt(at).element;
      if (target === null) {
        return { prevented: false, target: null };
      }
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      await flush();
      return { prevented: event.defaultPrevented, target: describeTarget(target) };
    }

    /**
     * @param {Record<string, number[]>} paths
     * @returns {ProbeSnapshot}
     */
    /**
     * Движок разбирает клавишу асинхронно: показ подменю ждёт ответов действий его
     * пунктов, и дерево уровней дополняется уже после того, как рассылка клавиши
     * вернулась. Проба ждёт одну задачу, чтобы движок доделал своё, — иначе снимок
     * снимался бы на половине показа.
     *
     * @returns {Promise<void>}
     */
    function flush() {
      return new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
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
     * @returns {Promise<StepResult>}
     */
    async function execute(step) {
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
        await flush();
        return {
          command: step.command,
          key: step.key ?? null,
          prevented: event.defaultPrevented,
          target: outside.id,
          focus: focusState(),
          levels: read(pathsOfRun).levels,
        };
      }
      if (step.command === 'show-submenu') {
        // Открытие по наведению: так поступает вызывающий код, и хост сам отдаёт
        // уровень движку, иначе уровень останется для клавиатуры мёртвым.
        const at = step.at ?? { path: [], index: 0 };
        const owner = itemAt(at);
        const entry = levelOf(at.path);
        const child = childOf(entry, owner);
        if (child === null) {
          throw new Error('у пункта нет заведённого подменю');
        }
        await host.openSubmenu(child);
        return {
          command: step.command,
          key: null,
          prevented: false,
          target: labelIn(owner.element),
          focus: focusState(),
          levels: read(pathsOfRun).levels,
        };
      }
      if (step.command === 'hover') {
        // Курсор встал на пункт: ровно то решение, которое оркестратор принимает в
        // `#onLevelPointerMove`. Отключённый пункт и разделитель мимо — они вне
        // цикла роуминга, и выделение на них недостижимо по построению.
        const at = step.at ?? { path: [], index: 0 };
        const item = itemAt(at);
        if (item.focusable) {
          keyboard.activateFromPointer(levelOf(at.path), item);
        }
        return {
          command: step.command,
          key: null,
          prevented: false,
          target: labelIn(item.element),
          focus: focusState(),
          levels: read(pathsOfRun).levels,
        };
      }
      if (step.command === 'leave-tree') {
        // Курсор ушёл с дерева меню: единственное место сброса по уходу. Сбрасывается
        // тот уровень, который стоит последним в цепочке, — уход курсора не трогает
        // отметки владельцев раскрытых подменю над ним, — и фокус после сброса
        // стоит на элементе этого уровня, поэтому следующая клавиша адресуется меню,
        // а не странице.
        const at = step.at ?? { path: [], index: 0 };
        keyboard.clearActive(levelOf(at.path));
        return {
          command: step.command,
          key: null,
          prevented: false,
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
        await flush();
        return {
          command: step.command,
          key: step.key ?? null,
          prevented: event.defaultPrevented,
          target: 'vc-list',
          focus: focusState(),
          levels: read(pathsOfRun).levels,
        };
      }
      const result = await press(step.key ?? '', step.at);
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
     * @returns {Promise<StepResult[]>}
     */
    async function run(steps, paths) {
      pathsOfRun = paths;
      /** @type {StepResult[]} */
      const results = [];
      for (const step of steps) {
        results.push(await execute(step));
      }
      return results;
    }

    const probe = /** @type {KeyboardProbe} */ ({
      async open(set, buildSubmenus) {
        openedSet = set;
        layer = createLayer({ label: 'Меню файла', theme: 'light', actions });
        const items = sets[set];
        root = await layer.ensureLevel(items, null, 0, null);
        levels.push(root);
        byElement.set(root.element, root);
        if (buildSubmenus !== false) {
          await buildTree(root, items, 0);
        }
        openedLayer().showRoot(root, { x: 60, y: 60 });
        showInChain(root);
        keyboard.registerLevel(root, { focus: true });
      },
      async reshow(index, enabled) {
        const items = sets[openedSet];
        const item = items[index];
        if (item === undefined || 'type' in item) {
          throw new Error('в наборе нет такого пункта');
        }
        // Предикат вешается здесь, а не задаётся в наборе заранее: правка между
        // показами — ровно то, что делает автор, — меняет решение о доступности,
        // а не структуру пункта. Повторный показ — ровно то, что делает
        // оркестратор: тот же уровень заново заводится, показывается и отдаётся
        // движку, без пересборки меню.
        item.isEnabledAction = () => enabled;
        const entry = await openedLayer().ensureLevel(items, null, 0, null);
        openedLayer().showRoot(entry, { x: 60, y: 60 });
        showInChain(entry);
        keyboard.registerLevel(entry, { focus: true });
      },
      async ensureSubmenu(index) {
        const entry = openedRoot();
        const owner = entry.items[index];
        /** @type {string | null} */
        let message = null;
        try {
          openedLayer().ensureLevel([{ labelAction: () => 'Лист' }], entry, 1, owner);
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        return message;
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
  return page.evaluate(async (input) => {
    const scope = /** @type {{ __vcKb: KeyboardProbe }} */ (/** @type {unknown} */ (globalThis));
    const probe = scope.__vcKb;
    await probe.open(input.set, input.buildSubmenus);
    const before = probe.read(input.paths);
    const steps = await probe.run(input.steps, input.paths);
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
  test('после открытия отметок нет, а первая стрелка даёт крайний пункт', async ({ page }) => {
    const opened = await runScenario(page, {
      set: 'tail',
      paths: { root: [] },
      steps: [{ command: 'read' }],
    });
    const down = await runScenario(page, {
      set: 'tail',
      paths: { root: [] },
      steps: [{ command: 'press', key: 'ArrowDown' }],
    });
    const up = await runScenario(page, {
      set: 'tail',
      paths: { root: [] },
      steps: [{ command: 'press', key: 'ArrowUp' }],
    });

    // Показ не отмечает ничего: отметка появляется там, где последним дотронулись до
    // пункта, а открытие — это ещё не касание. Снимок `before` снят в том же
    // `evaluate`, что и `open()`, иначе он догнал бы меню после первого шага.
    expect(opened.before.levels.root.activeMarks, 'свежее меню без отметок').toBe(0);
    expect(opened.before.levels.root.tabStops).toBe(0);
    expect(opened.before.levels.root.activeIndex).toBe(-1);
    expect(marksOf(opened.before.levels.root)).toEqual([
      ['Первый', '-1', false],
      ['Второй', '-1', false],
      ['Третий', '-1', false],
      ['Хвост', '-1', false],
      [null, null, false],
    ]);
    // Фокус при этом в меню и на самом уровне: без этого клавиши некуда было бы
    // адресовать, и первая же стрелка не создала бы выделения.
    expect(opened.before.focus.inMenu, 'фокус на элементе уровня').toBe(true);
    expect(opened.before.focus.label, 'фокус не на пункте').toBe(null);
    expect(opened.before.calls.order, 'показ никого не звал').toEqual([]);
    expect(opened.after.levels.root).toEqual(opened.before.levels.root);

    // Первая стрелка создаёт выделение с края: `ArrowDown` даёт первого, `ArrowUp` —
    // последнего. Оба сценария открывают меню заново, иначе второй считал бы не
    // пустое состояние, а состояние после первой стрелки.
    expect(down.after.levels.root.activeMarks).toBe(1);
    expect(down.after.levels.root.focusLabel, 'ArrowDown даёт первый').toBe('Первый');
    expect(down.after.levels.root.activeIndex).toBe(0);
    expect(up.after.levels.root.activeMarks).toBe(1);
    expect(up.after.levels.root.focusLabel, 'ArrowUp даёт последний').toBe('Третий');
    expect(up.after.levels.root.activeIndex).toBe(2);
    // Клавиша пришла на элемент уровня, а не на пункт, и разобрана всё равно:
    // `describeTarget` отдаёт `id` уровня именно потому, что под целью нет пункта.
    expect(down.steps[0].target, 'цель — элемент уровня').toBe(down.after.levels.root.id);
    expect(down.steps[0].prevented, 'стрелка разобрана движком').toBe(true);
    expect(up.steps[0].prevented).toBe(true);
  });

  test('ArrowDown переключает активный пункт циклически, минуя отключённые и разделители', async ({ page }) => {
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

    // Открытие не отметило ничего: фокус стоит на элементе уровня, и подписью пункта
    // он не обзаведён. Стартовать циклу не от чего, и первая стрелка обязана дать
    // крайний пункт.
    expect(result.before.levels.root.focusLabel).toBe(null);
    // Четыре нажатия: первое даёт первого, а дальше цикл идёт по кругу. Порядок
    // зафиксирован целиком: цикл из двух доступных пунктов сошёлся бы и на первой
    // половине, а цикл с прыжком через отключённый пункт дал бы другой порядок.
    expect(focusTrail(result.steps)).toEqual(['Первый', 'Второй', 'Первый', 'Второй']);
    // После первого нажатия отмечен ровно один пункт: у «Первого» есть и
    // `tabindex="0"`, и `data-active`, и фокус. Без этого на уровне стояло бы
    // два `tabindex="0"` сразу либо ни одного.
    expect(rovingOf(result.steps[1].levels.root)).toEqual([
      ['Первый', '0', true, true],
      ['Заблокированный', '-1', false, false],
      [null, null, false, false],
      ['Второй', '-1', false, false],
    ]);
    // Отключённый пункт и разделитель в цикл не попали ни разу: у них нет ни
    // `tabindex`, ни `data-active`, ни фокуса. У разделителя атрибута `tabindex`
    // нет вовсе — `-1` был бы числом в никуда.
    expect(rovingOf(result.after.levels.root)).toEqual([
      ['Первый', '-1', false, false],
      ['Заблокированный', '-1', false, false],
      [null, null, false, false],
      ['Второй', '0', true, true],
    ]);
    // Ровно один пункт уровня держит фокус и ровно один помечен.
    expect(result.after.levels.root.tabStops).toBe(1);
    expect(result.after.levels.root.activeMarks).toBe(1);
    // `activeIndex` — индекс в `entry.items`, а не в списке доступных: между
    // первым и последним доступным стоят отключённый пункт и разделитель.
    expect(result.steps[1].levels.root.activeIndex).toBe(0);
    expect(result.after.levels.root.activeIndex).toBe(3);
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
    expect(level.focusLabel).toBe('Второй');
    // Свежее меню отметок не имеет ни на одном пункте: равенство трёх вещей
    // проверяется не сразу после открытия, а на состоянии с активным пунктом, и
    // состояние без выделения — законная часть контракта, а не его отсутствие.
    expect(rovingOf(result.before.levels.root)).toEqual([
      ['Первый', '-1', false, false],
      ['Второй', '-1', false, false],
      ['Третий', '-1', false, false],
      ['Хвост', '-1', false, false],
      [null, null, false, false],
    ]);
    // Пункт, с которого ушли, отметку потерял: без этого на уровне осталось бы два
    // `tabindex="0"` и два `data-active` сразу.
    expect(rovingOf(level)).toEqual([
      ['Первый', '-1', false, false],
      ['Второй', '0', true, true],
      ['Третий', '-1', false, false],
      ['Хвост', '-1', false, false],
      [null, null, false, false],
    ]);
    // `activeIndex` совпадает с активным пунктом по индексу в `entry.items`.
    expect(level.activeIndex).toBe(1);
  });
  test('длинный уровень: активный пункт долистывается в видимую часть списка', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'long',
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'End' },
        { command: 'press', key: 'ArrowUp' },
      ],
    });

    // Контроль: длинный уровень действительно переполняет `.vc-list` и последний
    // пункт до нажатий за его нижним краем. Оба утверждения — про поставляемую
    // таблицу стилей, а не про условие, построенное фикстурой: пока пункты
    // сжимались, `scrollHeight` равнялся `clientHeight`, `inView` был истинно у всех
    // пунктов по построению, и кейс проверял бы пустоту на мёртвом механизме.
    expect(result.before.levels.root.list.scrollable).toBe(true);
    expect(result.before.levels.root.list.scrollHeight).toBeGreaterThan(
      result.before.levels.root.list.clientHeight,
    );
    expect(result.before.levels.root.items[39].inView).toBe(false);
    // Открытие длинного уровня ничего не отмечает, поэтому за нижним краем списка
    // лежат не «отмеченные, но невидимые» пункты, а просто не тронутые: сравнение
    // вниз ведётся от состояния без выделения.
    expect(result.before.levels.root.focusLabel).toBe(null);
    // `End` уводит роуминг на последний пункт, и список долистывается до него:
    // `focus({ preventScroll: true })` не прокручивает `.vc-list`, поэтому без
    // `scrollIntoView` отметка, `tabindex="0"` и фокус оказались бы на пункте под
    // нижним краем списка, и меню осталось бы заперто в рамке.
    expect(result.steps[0].levels.root.focusLabel).toBe('Пункт 40');
    expect(result.steps[0].levels.root.items[39].inView).toBe(true);
    expect(result.steps[0].levels.root.list.scrollTop).toBeGreaterThan(0);
    // Прокрутка ровно минимальная: список встал в самый низ, а не подогнал пункт под
    // верхний край. `block: 'start'` дал бы 1092 вместо 446, и кейс, который
    // проверяет только «пункт виден и список прокрутился», такого бы не увидел.
    expect(result.steps[0].levels.root.list.scrollTop).toBeCloseTo(
      result.steps[0].levels.root.list.scrollHeight
      - result.steps[0].levels.root.list.clientHeight,
      0,
    );
    expect(result.steps[0].levels.root.tabStops).toBe(1);
    expect(result.steps[0].levels.root.activeMarks).toBe(1);
    // Обратный шаг тоже остаётся в кадре: `block: 'nearest'` долистывает ровно
    // настолько, чтобы пункт стал виден, и не прокручивает список заново.
    expect(result.after.levels.root.focusLabel).toBe('Пункт 39');
    expect(result.after.levels.root.items[38].inView).toBe(true);
    expect(result.after.levels.root.list.scrollable).toBe(true);
  });

  test('уровень без доступных пунктов остаётся нетронутым', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'dead',
      paths: { root: [] },
      steps: [
        // Клавиши адресованы пункту отключённого: он лежит внутри `.vc-item`, и
        // уровень из цели события разрешается, — помечать в нём просто нечего.
        { command: 'press', key: 'ArrowDown', at: { path: [], index: 0 } },
        { command: 'press', key: 'End', at: { path: [], index: 0 } },
      ],
    });

    expect(result.after.levels.root).toEqual(result.before.levels.root);
    expect(result.after.levels.root.tabStops).toBe(0);
    expect(result.after.levels.root.activeMarks).toBe(0);
    expect(result.after.levels.root.activeIndex).toBe(-1);
    // Фокус встал на элемент уровня: доступных пунктов нет, помечать некого, но
    // уровень зарегистрирован и держит фокус — иначе клавиши ему адресовать было бы
    // нечем, а он обязан разбирать их молча.
    expect(result.after.focus.inMenu).toBe(true);
    expect(result.after.focus.label).toBe(null);
    // Ничего не активировано и хост не тронут.
    expect(result.after.calls).toEqual({
      closeAll: 0,
      closeCurrentLevel: 0,
      openSubmenu: 0,
      openSubmenuIds: [],
      focusOwner: 0,
      order: [],
      focusChanges: [],
    });
    expect(result.after.actions).toEqual([]);
  });

  test('пункт, выпавший из кольца между показами, не остаётся помеченным', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const scope = /** @type {{ __vcKb: KeyboardProbe }} */ (
        /** @type {unknown} */ (globalThis)
      );
      const probe = scope.__vcKb;
      await probe.open('offLimits');
      // Владелец сначала доступен, и на нём появляется отметка роуминга: без неё
      // кейс проверял бы сброс на пустом месте, а состояние «выключили активный
      // пункт» было бы не тем, что стоит проверить. Две стрелки — вторая
      // доступная строка набора, отделять которую от первой нечем, и «Мёртвый
      // владелец» пропускается кольцом само собой.
      await probe.run([{ command: 'press', key: 'ArrowDown' }, { command: 'press', key: 'ArrowDown' }], {
        root: [],
      });
      const marked = probe.read({ root: [] });
      // Автор выключает пункт между показами, и меню открывается заново.
      await probe.reshow(2, false);
      return { marked, after: probe.read({ root: [] }) };
    });

    expect(result.marked.levels.root.activeMarks, 'отметка была').toBe(1);
    expect(result.marked.levels.root.focusLabel, 'отмечен владелец').toBe('Живой владелец');
    // Пункт вне кольца не может нести `tabindex="0"`: иначе `Tab` зациклил бы меню
    // на элементе, который нельзя выбрать, а `aria-disabled` приглушал бы строку,
    // помеченную как выбранная.
    expect(result.after.levels.root.tabStops, 'в цикле Tab никого').toBe(0);
    expect(result.after.levels.root.activeMarks, 'отметок нет').toBe(0);
    expect(result.after.levels.root.activeIndex, 'активного пункта нет').toBe(-1);
    expect(result.after.levels.root.items[2]).toMatchObject({
      label: 'Живой владелец',
      tabindex: '-1',
      active: false,
      focusable: false,
      // Признаки раскрытия уходят тем же проходом: раскрыть отключённый пункт
      // нечем, и `aria-owns` уводил бы скринридер в меню, которого не будет.
      hasSubmenu: false,
      haspopup: null,
      expanded: null,
      owns: null,
    });
  });

  test('наведение мыши выделяет пункт и перебивает клавиатуру', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [] },
      steps: [
        // Клавиатура идёт первой: выделение создано ею, и мышь обязана его снять.
        { command: 'press', key: 'ArrowDown' },
        { command: 'hover', at: { path: [], index: 1 } },
      ],
    });

    expect(result.steps[1].levels.root.activeMarks, 'выделено ровно одно').toBe(1);
    expect(result.steps[1].levels.root.tabStops, 'ровно один пункт в цикле Tab').toBe(1);
    // Отметка ушла с пункта, который выбрала клавиатура: два писателя выделения дали
    // бы две подсветки сразу, а «последнее взаимодействие выигрывает» — одну, на том,
    // к чему пользователь пришёл последним.
    expect(marksOf(result.after.levels.root)).toEqual([
      ['Открыть', '-1', false],
      ['Экспорт', '0', true],
      ['Печать', '-1', false],
      ['Без подменю', '-1', false],
      [null, null, false],
      ['Выход', '-1', false],
    ]);
    expect(result.after.levels.root.activeIndex).toBe(1);
    // Фокус ушёл за отметкой, а не остался на прежнем пункте: `handleKeydown` берёт
    // уровень из цели события, и рассинхрон означал бы, что клавиши поедут не туда,
    // где горит подсветка.
    expect(result.after.focus.label).toBe('Экспорт');
  });

  test('стрелка считает следующий пункт от того, что под курсором', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [] },
      steps: [
        { command: 'hover', at: { path: [], index: 2 } },
        { command: 'press', key: 'ArrowDown' },
      ],
    });

    // Отсчёт от пункта под курсором, а не от края уровня: активным перед стрелкой был
    // третий пункт, и шаг дал четвёртого. Отсчёт от пустого состояния дал бы первого,
    // и «мышь перебивает клавиатуру» было бы нечем доказать.
    expect(result.steps[0].levels.root.activeIndex, 'под курсором третий').toBe(2);
    expect(result.steps[1].levels.root.activeIndex, 'стрелка дала четвёртого').toBe(3);
    expect(result.after.levels.root.focusLabel).toBe('Без подменю');
    expect(result.after.levels.root.activeMarks).toBe(1);
    // Отдельного правила «считать от того, что под курсором» в движке нет и не
    // требуется: активным всегда стоит последний, кого тронули, — мышью он или
    // клавиатурой. Утверждение заодно фиксирует, что владелец подменю наведением не
    // открывается: показ решает вызывающий код, а не движок.
    expect(result.after.calls.order, 'подменю мышью не открыто').toEqual([]);
  });

  test('уход курсора сбрасывает выделение, и стрелка снова даёт крайний пункт', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [] },
      steps: [
        { command: 'hover', at: { path: [], index: 2 } },
        { command: 'leave-tree' },
        { command: 'press', key: 'ArrowDown' },
      ],
    });

    // Сброс полный: отметок нет ни на одном пункте, `tabindex` у всех вернулся в
    // `-1`, а `activeIndex` — в `-1`. Частичный сброс оставил бы цикл роуминга
    // продолжаться от пункта, которого пользователь уже не видит.
    expect(result.steps[1].levels.root.activeMarks, 'отметок не осталось').toBe(0);
    expect(result.steps[1].levels.root.tabStops, 'ни одного пункта в цикле Tab').toBe(0);
    expect(result.steps[1].levels.root.activeIndex).toBe(-1);
    // Фокус вернулся на элемент уровня, а не на контейнер: иначе следующая клавиша
    // ушла бы в страницу, и меню перестало бы отвечать на стрелку сразу после того,
    // как пользователь убрал курсор.
    expect(result.steps[1].focus.inMenu, 'фокус в меню').toBe(true);
    expect(result.steps[1].focus.label, 'фокус не на пункте').toBe(null);
    expect(result.after.levels.root.activeIndex, 'стрелка дала первый').toBe(0);
    expect(result.after.levels.root.focusLabel).toBe('Открыть');
  });

  test('сброс выделения касается последнего открытого уровня, а не всей цепочки', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'hover', at: { path: [], index: 1 } },
        { command: 'press', key: 'ArrowRight' },
        // Второй пункт подменю, а не первый: первый помечает `ArrowRight`, и
        // наведение на него вышло бы no-op, а отметку в подменю поставил бы шаг
        // клавиатуры, а не мышь.
        { command: 'hover', at: { path: [1], index: 1 } },
        { command: 'leave-tree', at: { path: [1], index: 0 } },
      ],
    });

    // Показ подменю отметку владельца не снимает, а наведение в подменю ставит свою
    // поверх отметки, оставшейся от `ArrowRight`: перед уходом курсора отмечены оба
    // уровня. Снимок `steps[2]` снят после наведения, то есть до ухода: у шага своя
    // отметка снимается уже после того, как он отработал.
    expect(result.steps[2].levels.root.activeMarks, 'до сброса корень отмечен').toBe(1);
    expect(result.steps[2].levels.root.activeIndex, 'корень отмечен на владельце').toBe(1);
    expect(result.steps[2].levels.sub.activeMarks, 'до сброса подменю отмечено').toBe(1);
    // `focusLabel` у корня тут `null`, и это верно: фокус в подменю, и подписью пункта
    // корень не обзаведён. Отметку корня показывает `activeIndex`.
    expect(result.steps[2].levels.sub.focusLabel, 'подменю отмечено наведением').toBe('PNG');
    // Сброс достаёт последний уровень цепочки: его отметка означала «курсор стоит
    // на этом пункте» и без курсора ничего не значит. Отметка владельца на корне
    // остаётся — она означает «подменю раскрыто», и по ней видно путь.
    expect(result.after.levels.sub.activeMarks, 'подменю без отметки').toBe(0);
    expect(result.after.levels.sub.activeIndex).toBe(-1);
    expect(result.after.levels.sub.tabStops).toBe(0);
    expect(result.after.levels.root.activeMarks, 'корень остался отмечен на владельце').toBe(1);
    expect(result.after.levels.root.activeIndex, 'отметка корня не тронута').toBe(1);
    // Фокус встаёт на элемент сброшенного уровня: меню обязано отвечать на клавиши,
    // а по цели события это уровень, где стоял фокус, — подменю, а не корень.
    expect(result.after.focus.label, 'фокус не на пункте').toBe(null);
    expect(result.after.focus.inMenu).toBe(true);
  });

  test('наведение на уже отмеченного владельца возвращает ему фокус', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'hover', at: { path: [], index: 1 } },
        { command: 'press', key: 'ArrowRight' },
        // Наведение на уже отмеченный пункт подменю: атрибут заново не пишется, но и
        // фокус никуда не уходит — он и так на пункте.
        { command: 'hover', at: { path: [1], index: 0 } },
        // Возврат курсора к владельцу. Отметка владельца всё это время стояла:
        // снимается она только внутри своего уровня, а подменю — другой уровень.
        { command: 'hover', at: { path: [], index: 1 } },
        { command: 'press', key: 'ArrowDown' },
      ],
    });

    // Отметки после возврата на владельца: своя у корня и своя у подменю. Если бы
    // возврат снимал отметку подменю, сбросу было бы нечего проверять.
    expect(result.steps[3].levels.root.activeIndex, 'корень отмечен на владельце').toBe(1);
    expect(result.steps[3].levels.sub.activeIndex, 'отметка подменю не тронута').toBe(0);
    // Фокус ушёл владельцу, а не остался в покинутом подменю. Строка таблицы 3.2
    // «подменю открыто наведением, курсор на владельце — отметка и фокус на владельце»
    // иначе была бы недостижимой: наведение помечает владельца и оставляло бы фокус
    // в подменю.
    expect(result.steps[3].focus.label, 'фокус на владельце').toBe('Экспорт');
    // И клавиша после этого едет в подменю, а не в корневой уровень: фокус стоит
    // на владельце, но смотрит пользователь на подменю, и оно открыто последним.
    expect(result.after.levels.root.activeIndex, 'отметка владельца на месте').toBe(1);
    expect(result.after.levels.sub.activeIndex, 'стрелка увела отметку подменю').toBe(1);
    expect(result.after.focus.label).toBe('PNG');
  });

  test('клавиатура перебивает мышь', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [] },
      steps: [
        { command: 'hover', at: { path: [], index: 2 } },
        { command: 'press', key: 'ArrowDown' },
        { command: 'hover', at: { path: [], index: 1 } },
      ],
    });

    // Обратный порядок: мышь выделила третий, клавиатура увела выделение на
    // четвёртого, и последним касанием снова стала мышь. Выигрывает именно последнее
    // взаимодействие, поэтому итог — не то, что оставила стрелка.
    expect(result.steps[1].levels.root.activeIndex, 'стрелка увела выделение').toBe(3);
    expect(result.after.levels.root.activeIndex, 'мышь вернула своё').toBe(1);
    expect(result.after.levels.root.focusLabel).toBe('Экспорт');
    expect(result.after.levels.root.activeMarks).toBe(1);
    expect(result.after.levels.root.tabStops).toBe(1);
    expect(result.after.focus.label).toBe('Экспорт');
  });
});

test.describe('переходы между уровнями', () => {
  test('ArrowRight открывает подменю и переносит фокус в его первый пункт', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        // Роуминг доходит до владельца раньше, чем в него входят: активным
        // пунктом уровня остаётся носитель `data-active`, а не цель события. Открытое
        // меню выделения не имеет, и до владельца надо дойти двумя шагами.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'press', key: 'ArrowDown' },
      ],
    });

    // Подменю открыто ровно один раз, и открыт тот уровень, чей `id` владелец
    // зарезервировал в `aria-owns` — иначе `aria-owns` вёл бы в никуда.
    expect(result.after.calls.openSubmenu).toBe(1);
    expect(result.after.calls.openSubmenuIds).toEqual([result.after.levels.sub.id]);
    expect(result.after.levels.sub.open).toBe(true);
    expect(result.after.levels.sub.popoverOpen).toBe(true);
    // Фокус ушёл из подменю на его первый доступный пункт, а не остался на владельце:
    // след показывает и то, что `ArrowRight` открывает подменю, и то, что перенос
    // фокуса делает движок, а не показ.
    expect(focusTrail(result.steps)).toEqual(['Открыть', 'Экспорт', 'PDF', 'PNG']);
    expect(result.after.focus.inMenu).toBe(true);
    // Показ подменю отметок в нём не оставил: переносом фокуса занялся `moveTo`, а
    // не `registerLevel`. Проверяется на снимке сразу после `ArrowRight`, иначе
    // следующий шаг скрыл бы, что помечал именно он.
    expect(rovingOf(result.steps[2].levels.sub)).toEqual([
      ['PDF', '0', true, true],
      ['PNG', '-1', false, false],
    ]);
    expect(result.steps[2].levels.sub.activeIndex).toBe(0);
    expect(result.steps[2].levels.sub.tabStops).toBe(1);
    // Роуминг подменю продолжается по списку, а не застрял на первом пункте.
    expect(rovingOf(result.after.levels.sub)).toEqual([
      ['PDF', '-1', false, false],
      ['PNG', '0', true, true],
    ]);
    expect(result.after.levels.sub.activeIndex).toBe(1);
    // Владелец в родительском уровне остался активным: ровно один `tabindex="0"` и
    // одна отметка на уровень, а не по одному на всё меню. По нему же видно, что
    // подменю открылось через слой, а не мимо него.
    expect(rovingOf(result.after.levels.root)[1]).toEqual(['Экспорт', '0', true, false]);
    expect(result.after.levels.root.items[1].expanded).toBe('true');
    expect(result.after.levels.root.tabStops).toBe(1);
    expect(result.after.levels.sub.tabStops).toBe(1);
    expect(result.steps[2].prevented).toBe(true);
  });

  test('ArrowRight на пункте без подменю ничего не делает', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      // Клавиша уходит в активный пункт — «Открыть», у которого подменю нет. Без
      // шага вниз активного пункта не было бы, и «ничего не делает» означало бы
      // «нечего делать», а не «нечего открывать».
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight', at: { path: [], index: 0 } },
      ],
    });

    expect(result.steps[1].focus.label, 'активен пункт без подменю').toBe('Открыть');
    expect(result.steps[1].target, 'цель — тот же пункт').toBe('Открыть');
    // Ни одного вызова хоста: подменю у пункта нет, и открывать нечего.
    expect(result.after.calls).toEqual({
      closeAll: 0,
      closeCurrentLevel: 0,
      openSubmenu: 0,
      openSubmenuIds: [],
      focusOwner: 0,
      order: [],
      focusChanges: ['Открыть'],
    });
    // Уровень не тронут вовсе — ни отметок, ни фокуса. Сравнение снимков до и после
    // самой стрелки вместо сравнения с показом: любое изменение состояния роняет
    // кейс, а «до» здесь — состояние с активным пунктом, а не свежее меню.
    expect(result.after.levels.root).toEqual(result.steps[1].levels.root);
    expect(result.after.focus).toEqual(result.steps[1].focus);
    // Клавишу движок всё же разобрал, поэтому её действие по умолчанию подавлено:
    // иначе стрелка вела бы себя по-разному в зависимости от пункта, и прокрутка
    // страницы зависела бы от того, где стоит фокус.
    expect(result.steps[1].prevented).toBe(true);
  });

  test('ArrowLeft закрывает подменю и возвращает фокус на пункт-владелец', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        // Перед возвратом активный пункт подменя уводится со первого: иначе «фокус
        // вернулся к владельцу» совпало бы с «фокус и не уходил».
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowLeft' },
      ],
    });

    expect(focusTrail(result.steps)).toEqual([
      'Открыть', 'Экспорт', 'PDF', 'PNG', 'Экспорт',
    ]);
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
    // Отметка развёрнутости вернулась в "false", а `aria-owns` остался: подменю
    // у пункта есть и появится снова.
    expect(result.after.levels.root.items[1].expanded).toBe('false');
    expect(result.after.levels.root.items[1].owns).toBe(result.before.levels.sub.id);
  });

  test('ArrowLeft из подменю возвращает отметку пункту-владельцу', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'press', key: 'ArrowLeft' },
        // Роуминг продолжается от владельца, а не от края уровня: без отметки на
        // владельце следующая стрелка встала бы на первый пункт уровня, и
        // возвращение из подменю выглядело бы как потеря места.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowUp' },
      ],
    });

    expect(focusTrail(result.steps)).toEqual([
      'Открыть', 'Экспорт', 'PDF', 'Экспорт', 'Печать', 'Экспорт',
    ]);
    // Отметка вернулась владельцу, а не растворилась: в родительском уровне снова
    // ровно один `tabindex="0"` и одна `data-active`.
    expect(result.steps[3].levels.root.activeIndex).toBe(1);
    expect(result.steps[3].levels.root.tabStops).toBe(1);
    expect(result.steps[3].levels.root.activeMarks).toBe(1);
    // Подменю закрыто, но его собственные отметки не тронуты: возврат фокуса — это
    // дело родительского уровня, и закрытый уровень просто перестал быть видимым.
    expect(result.steps[3].levels.sub.open).toBe(false);
    expect(result.after.levels.root.activeIndex).toBe(1);
    expect(result.after.levels.root.tabStops).toBe(1);
    expect(result.after.calls.closeCurrentLevel).toBe(1);
    expect(result.after.calls.closeAll).toBe(0);
  });

  test('ArrowLeft на корневом уровне вызывает closeAll', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
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
      'focusOwner',
    ]);
    // `closeAll` — цепочка целиком, поэтому закрыты оба уровня.
    expect(result.after.levels.root.open).toBe(false);
    expect(result.after.levels.sub.open).toBe(false);
    expect(result.after.levels.root.popoverOpen).toBe(false);
    // Фокус ушёл элементу-владельцу, а не остался в гаснущем корне: закрытие
    // отложено на `animationDuration`, и оставленный в нём фокус упал бы на
    // `<body>`. Порядок в журнале выше: сначала закрыть, потом вернуть фокус.
    expect(result.after.calls.focusOwner).toBe(1);
    expect(result.after.focus.onInvoker).toBe(true);
    expect(result.after.focus.inMenu).toBe(false);
  });

  test('слой не заводит уровень под отключённого владельца подменю', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const scope = /** @type {{ __vcKb: KeyboardProbe }} */ (/** @type {unknown} */ (globalThis));
      const probe = scope.__vcKb;
      await probe.open('offLimits');
      // Отключённый пункт с непустым подменю — не владелец, поэтому у него нет
      // зарезервированного адреса, а `ensureLevel` без адреса бросит. Состояние
      // «открытое подменю при неактивном владельце», ради которого прежний кейс
      // этого места строил такой уровень руками, теперь недостижимо: сделать его
      // может только слой, а он не согласится.
      //
      // Роуминг приводится в движение шагом вниз: открытое меню выделения не имеет,
      // и без этого шага сравнивать было бы нечего — «у отключённого нет отметки» на
      // пустом уровне не отличало бы его от любого другого пункта.
      await probe.run([{ command: 'press', key: 'ArrowDown' }], { root: [] });
      return {
        deaf: await probe.ensureSubmenu(1),
        live: await probe.ensureSubmenu(2),
        snapshot: probe.read({ root: [] }),
      };
    });

    // Отказ назван прямо: сообщение обязано называть причину, иначе «не завелось»
    // не отличалось бы от «слой молча не нашёл».
    expect(result.deaf, 'слой отказал').not.toBeNull();
    expect(/** @type {string} */ (result.deaf)).toContain('зарезервированного id подменю');
    // Контроль в обе стороны: у доступного пункта с непустым подменю уровень
    // заводится, и отказ выше — про отключённого, а не про механизм слоя вовсе.
    expect(result.live, 'доступный владелец заведён').toBeNull();
    const deaf = result.snapshot.levels.root.items[1];
    expect(deaf.focusable, 'отключённый пункт вне цикла роуминга').toBe(false);
    expect(deaf.hasSubmenu, 'отключённый пункт не владелец').toBe(false);
    expect(deaf.haspopup, 'нет `aria-haspopup`').toBe(null);
    expect(deaf.owns, 'адрес подменю не зарезервирован').toBe(null);
    // Роуминг встал на живой пункт, и у отключённого не появилось ни отметки,
    // ни `tabindex="0"`, ни фокуса: он вне цикла, и отметка роуминга сделала бы
    // его целью табуляции.
    expect(rovingOf(result.snapshot.levels.root)).toEqual([
      ['Живой', '0', true, true],
      ['Мёртвый владелец', '-1', false, false],
      ['Живой владелец', '-1', false, false],
    ]);
    expect(result.snapshot.levels.root.activeIndex).toBe(0);
  });

  test('стрелка после мышиного открытия идёт в подменю, а не в родительский уровень', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        // Курсор встал на владельца, и его подменю открылось по наведению: фокус
        // показ не переносит, поэтому он остался на владельце, то есть в
        // родительском уровне.
        { command: 'hover', at: { path: [], index: 1 } },
        { command: 'show-submenu', at: { path: [], index: 1 } },
        { command: 'read' },
        { command: 'press', key: 'ArrowDown' },
      ],
    });

    // Снимок до нажатия: подменю открыто, фокус в родителе, отметок в подменю нет.
    expect(result.steps[2].levels.sub.open).toBe(true);
    expect(result.steps[2].levels.sub.activeIndex).toBe(-1);
    expect(result.steps[2].levels.root.focusLabel).toBe('Экспорт');
    // Движение произошло в подменю — оно открыто последним и потому главнее, — а не
    // в том уровне, откуда пришла клавиша.
    expect(result.after.levels.sub.activeIndex).toBe(0);
    expect(result.after.levels.sub.focusLabel).toBe('PDF');
    expect(result.after.focus.label).toBe('PDF');
    // Родительский уровень не тронут: у владельца осталась отметка раскрытия, а
    // сравниваются именно отметки, потому что фокус уровня меняется оттого, что его
    // получил сосед.
    expect(marksOf(result.after.levels.root)).toEqual(marksOf(result.steps[2].levels.root));
    expect(result.after.levels.root.activeIndex).toBe(1);
    // Ничего не открывалось заново: подменю уже было показано.
    expect(result.after.calls.openSubmenu).toBe(1);
  });

  test('Escape после мышиного открытия закрывает подменю, а не всё меню', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'hover', at: { path: [], index: 1 } },
        { command: 'show-submenu', at: { path: [], index: 1 } },
        { command: 'read' },
        { command: 'press', key: 'Escape' },
      ],
    });

    // Уход закрывает тот уровень, который пользователь смотрит последним, а не тот,
    // где стоит фокус: иначе открытое подменю осталось бы висеть поверх пункта,
    // который уже не выбран.
    expect(result.after.calls.closeCurrentLevel).toBe(1);
    expect(result.after.calls.closeAll).toBe(0);
    expect(result.after.levels.sub.open).toBe(false);
    expect(result.after.levels.root.open).toBe(true);
    // Возврат фокуса на владельца: он и так был активен, но отметку раскрытия
    // закрытый уровень снял.
    expect(result.after.focus.label).toBe('Экспорт');
    expect(result.after.levels.root.activeIndex).toBe(1);
    expect(result.after.levels.root.items[1].expanded).toBe('false');
  });

  test('ArrowLeft после мышиного открытия закрывает подменю и возвращает фокус владельцу', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'hover', at: { path: [], index: 1 } },
        { command: 'show-submenu', at: { path: [], index: 1 } },
        { command: 'press', key: 'ArrowLeft' },
      ],
    });

    expect(result.after.calls.closeCurrentLevel).toBe(1);
    expect(result.after.calls.closeAll).toBe(0);
    expect(result.after.calls.order).toEqual([
      `openSubmenu:${result.before.levels.sub.id}`,
      'closeCurrentLevel',
    ]);
    expect(result.after.levels.sub.open).toBe(false);
    expect(result.after.levels.root.open).toBe(true);
    // Роуминг продолжается от владельца: отметка на нём не растворилась вместе с
    // подменю.
    expect(result.after.levels.root.activeIndex).toBe(1);
    expect(result.after.levels.root.tabStops).toBe(1);
    expect(result.after.focus.label).toBe('Экспорт');
  });

  test('ArrowRight после мышиного открытия смотрит на активный пункт своего уровня', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'hover', at: { path: [], index: 1 } },
        { command: 'show-submenu', at: { path: [], index: 1 } },
        { command: 'press', key: 'ArrowRight' },
      ],
    });

    // Раскрытие отвечает на вопрос «что выделено», а выделение стоит на владельце
    // родительского уровня: `ArrowRight` переносит фокус в уже открытое подменю.
    expect(result.after.levels.sub.focusLabel).toBe('PDF');
    expect(result.after.levels.sub.activeIndex).toBe(0);
    expect(result.after.focus.label).toBe('PDF');
    // Показ повторный, но это показ того же подменю: `ArrowRight` на владельце
    // открывает его, а не спускается в уже открытое.
    expect(result.after.calls.openSubmenu).toBe(2);
    expect(result.after.calls.order).toEqual([
      `openSubmenu:${result.before.levels.sub.id}`,
      `openSubmenu:${result.before.levels.sub.id}`,
    ]);
  });

  test('Enter после мышиного открытия смотрит на активный пункт своего уровня', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'hover', at: { path: [], index: 1 } },
        { command: 'show-submenu', at: { path: [], index: 1 } },
        { command: 'press', key: 'Enter' },
      ],
    });

    // То же и для активации: она работает по активному пункту уровня, из которого
    // пришла клавиша, а не по текущему уровню подменю без единого пункта.
    expect(result.after.levels.sub.focusLabel).toBe('PDF');
    expect(result.after.focus.label).toBe('PDF');
    expect(result.after.calls.openSubmenu).toBe(2);
    // Активация не наступила: у владельца непустого подменю активация означает
    // открытие, а не вызов действия.
    expect(result.after.actions).toEqual([]);
  });

  test('перемещение уходит в самый глубокий открытый уровень, а не в тот, из которого пришла клавиша', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'read' },
        // Клавиша приходит в пункт корневого уровня — в тот самый, который остался
        // активным после открытия подменю, — а двигаться обязана там, куда
        // пользователь смотрит.
        { command: 'press', key: 'ArrowDown', at: { path: [], index: 1 } },
      ],
    });

    // Движение произошло в подменю: оно открыто последним, и оно главнее.
    expect(result.after.levels.sub.activeIndex).toBe(1);
    expect(result.after.levels.sub.focusLabel).toBe('PNG');
    expect(result.after.focus.label).toBe('PNG');
    // Снимок до движения действительно видел фокус в подменю, иначе сравнение
    // ниже было бы сравнением уровня с самим собой.
    expect(result.steps[3].levels.sub.focusLabel).toBe('PDF');
    // Родительский уровень не тронут: у владельца осталась отметка раскрытия, а
    // фокус ушёл — и сравниваются именно отметки, потому что фокус уровня
    // меняется оттого, что его получил сосед.
    expect(marksOf(result.after.levels.root)).toEqual(marksOf(result.steps[3].levels.root));
    expect(result.after.levels.root.activeIndex).toBe(1);
    // Ничего не открывалось и не закрывалось: уровень сменился сам собой.
    expect(result.after.calls.order).toEqual([`openSubmenu:${result.before.levels.sub.id}`]);
  });

  test('уровень без активного пункта начинает цикл с края', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        // Активный пункт в корне: он нужен владельцу, из которого открывается
        // подменю, и самому себе — фокус после показа остаётся в корне.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        // Показ подменю — так поступает вызывающий код по наведению: уровень
        // зарегистрирован, отметок в нём нет, и фокус в него не перенесён.
        { command: 'show-submenu', at: { path: [], index: 1 } },
        { command: 'press', key: 'ArrowDown', at: { path: [1], index: 0 } },
        // Повторный показ того же подменю возвращает его в то же состояние: показ
        // снимает протухшие отметки, и состояние «уровень известен, активного пункта
        // нет» получается уже не вручную.
        { command: 'show-submenu', at: { path: [], index: 1 } },
        { command: 'press', key: 'ArrowUp', at: { path: [1], index: 0 } },
      ],
    });

    // Отметок нет, а уровень движку известен: циклу не от чего отталкиваться, и он
    // не молчит.
    expect(result.steps[2].levels.sub.activeIndex).toBe(-1);
    expect(result.steps[2].levels.sub.tabStops).toBe(0);
    expect(result.steps[2].levels.sub.activeMarks).toBe(0);
    // `ArrowDown` без активного идёт с первого, `ArrowUp` — с последнего. Отсчёт от
    // `-1` ушёл бы на минус один элемент списка, и `ArrowUp` встал бы на
    // предпоследний вместо последнего.
    expect(result.steps[3].levels.sub.focusLabel).toBe('PDF');
    expect(result.steps[3].levels.sub.activeIndex).toBe(0);
    expect(result.steps[4].levels.sub.activeIndex).toBe(-1);
    expect(result.steps[4].levels.sub.tabStops).toBe(0);
    expect(result.steps[5].levels.sub.focusLabel).toBe('PNG');
    expect(result.after.levels.sub.activeIndex).toBe(1);
    expect(result.after.levels.sub.tabStops).toBe(1);
  });

  test('незаведённый уровень подменю: пункт-владелец молчит, а не активируется', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      // Дерево не заведено: владельцы в меню есть, а уровней за ними нет.
      buildSubmenus: false,
      paths: { root: [] },
      steps: [
        // Открытое меню выделения не имеет, и до владельца доходят двумя шагами.
        { command: 'press', key: 'ArrowDown' },
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
    // Открытое меню выделения не имеет: без шага вниз «не активировалось» было бы
    // свойством пустого состояния, а не отсутствующего уровня.
    expect(result.before.focus.label, 'выделения после открытия нет').toBe(null);
    // Ничего не открыто — показывать нечего, — и ничего не активировано: молчание
    // предпочтительнее активации пункта, чьё подменю так и не появится.
    expect(result.after.calls).toEqual({
      closeAll: 0,
      closeCurrentLevel: 0,
      openSubmenu: 0,
      openSubmenuIds: [],
      focusOwner: 0,
      order: [],
      focusChanges: ['Открыть', 'Экспорт'],
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
    const cleared = result.steps[3].levels.root;
    expect(cleared.tabStops).toBe(0);
    expect(cleared.activeMarks).toBe(0);
    expect(cleared.activeIndex).toBe(-1);
    expect(cleared.items.every((item) => {
      return item.tabindex !== '0' && !item.active;
    })).toBe(true);
    // Подменю сброшено тем же вызовом: снимок не разбирает уровни по одному.
    expect(result.steps[3].levels.sub.tabStops).toBe(0);
    expect(result.steps[3].levels.sub.activeIndex).toBe(-1);
    // Фокус `reset` не забирает: куда его девать, решает вызывающий код.
    expect(result.steps[3].focus.label).toBe('PDF');
    // Забытый уровень ни на что не отвечает: клавиши не разобраны, события не
    // гасятся, хост не тронут. Иначе движок продолжал бы работать с меню, которое
    // вызывающий код уже списал.
    expect(result.steps.slice(4).map((step) => step.prevented)).toEqual([false, false, false]);
    expect(result.after.calls).toEqual({
      closeAll: 0,
      closeCurrentLevel: 0,
      openSubmenu: 1,
      openSubmenuIds: [result.before.levels.sub.id],
      focusOwner: 0,
      order: [`openSubmenu:${result.before.levels.sub.id}`],
      focusChanges: ['Открыть', 'Экспорт', 'PDF', 'нет'],
    });
    // Отметки не вернулись сами собой.
    expect(result.after.levels.root.tabStops).toBe(0);
    expect(result.after.levels.root.activeIndex).toBe(-1);
    expect(result.after.levels.sub.activeIndex).toBe(-1);
  });
});

test.describe('активация', () => {
  test('клавиша активации без активного пункта не делает ничего', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      // Свежее меню — и есть то состояние без активного пункта, о котором контракт:
      // браузерным правилом оно достигается само, стоит только что открытым меню.
      steps: [
        { command: 'press', key: 'Enter' },
        { command: 'press', key: ' ' },
      ],
    });

    // Клавиша разобрана и потому погашена, но работать ей не над чем: она берёт
    // активный пункт, а активного пункта нет. Погашение и пустота — разные вещи, и
    // обе проверяются: неразобранная клавиша дошла бы до браузера и прокрутила бы
    // страницу под меню.
    expect(result.steps.map((step) => step.prevented)).toEqual([true, true]);
    // Ни действия, ни клика: активация по сфокусированному узлу означала бы, что
    // действие доступно там, где выделения нет, — ровно в том состоянии, которое
    // новое открытие и уход курсора создают намеренно.
    expect(result.after.actions).toEqual([]);
    expect(result.after.clicks).toEqual([]);
    // И состояние уровня не изменилось ни на одну долю: не отмечен новый пункт, не
    // появился `tabindex="0"`, не сдвинулся `activeIndex`. Сравнение всего снимка, а
    // не отдельных полей: любое изменение состояния роняет кейс.
    expect(result.after.levels.root.activeIndex).toBe(-1);
    expect(result.after.levels.root.activeMarks).toBe(0);
    expect(result.after.levels.root.tabStops).toBe(0);
    expect(result.after.levels.root).toEqual(result.before.levels.root);
    // Подменю не открыто: у первого пункта корня владельца нет, а активного пункта,
    // чьим подменю можно было бы пойти дальше, нет вовсе.
    expect(result.after.levels.sub.open).toBe(false);
    expect(result.after.calls).toEqual({
      closeAll: 0,
      closeCurrentLevel: 0,
      openSubmenu: 0,
      openSubmenuIds: [],
      focusOwner: 0,
      order: [],
      focusChanges: [],
    });
  });

  test('Enter вызывает action активного пункта и закрывает меню', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      // Открытое меню выделения не имеет, поэтому активации предшествует шаг вниз:
      // без него клавиша не нашла бы активного пункта и молчала бы, а кейс проверял
      // бы не активацию, а отсутствие выделения.
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'Enter', at: { path: [], index: 0 } },
      ],
    });

    expect(result.steps[1].target).toBe('Открыть');
    // `action` отработал ровно один раз, и у того пункта, который активен.
    expect(result.after.actions).toEqual(['Открыть']);
    // Активация идёт кликом по пункту: единственный путь, одинаковый для мыши и
    // для клавиатуры, и поэтому `action` получает настоящее событие с настоящей
    // целью, а не вызов по внутреннему ключу из обхода дерева.
    expect(result.after.clicks).toEqual(['Открыть']);
    // Закрытие после активации — отдельное требование: активация пункта гасит
    // меню. Гасит его обработчик активации, а не движок: `closeAll` здесь ноль, и
    // «действие, потом закрытие» остаётся единственным порядком, который вообще
    // возможен.
    expect(result.after.calls.closeAll).toBe(0);
    expect(result.after.calls.order).toEqual(['action:Открыть', 'close:activation']);
    expect(result.after.levels.root.open).toBe(false);
    expect(result.after.levels.root.popoverOpen).toBe(false);
    expect(result.steps[1].prevented).toBe(true);
  });

  test('Enter на пункте-владельце без своего действия открывает подменю', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        // До владельца — два шага: открытое меню выделения не имеет.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'Enter' },
      ],
    });

    // Счётчик вызовов `action` остаётся нулём, и клика по пункту не было вовсе: у
    // владельца без своего действия активация означает открытие подменю.
    expect(result.after.actions).toEqual([]);
    expect(result.after.clicks).toEqual([]);
    expect(result.after.calls.openSubmenu).toBe(1);
    expect(result.after.calls.openSubmenuIds).toEqual([result.after.levels.sub.id]);
    // Меню не закрылось: подменю открылось, а не активировался пункт.
    expect(result.after.calls.closeAll).toBe(0);
    expect(result.after.levels.sub.open).toBe(true);
    expect(result.after.levels.sub.popoverOpen).toBe(true);
    expect(result.after.levels.root.items[1].expanded).toBe('true');
    // Фокус ушёл в подменю, как при `ArrowRight`: подменю открыто и видимо, а без
    // отметок в нём роуминга нет — стрелки двигали бы родителя при открытом
    // ребёнке, и `Enter` лишь переоткрывал бы его.
    expect(focusTrail(result.steps)).toEqual(['Открыть', 'Экспорт', 'PDF']);
    expect(result.after.levels.root.activeIndex).toBe(1);
    expect(result.after.levels.sub.activeIndex).toBe(0);
    expect(result.after.levels.sub.tabStops).toBe(1);
    expect(result.after.levels.sub.activeMarks).toBe(1);
    expect(rovingOf(result.after.levels.sub)).toEqual([
      ['PDF', '0', true, true],
      ['PNG', '-1', false, false],
    ]);
    // Владелец в своём уровне остался единственным активным: по одному на уровень,
    // а не по одному на всё меню.
    expect(rovingOf(result.after.levels.root)[1]).toEqual(['Экспорт', '0', true, false]);
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
    // `Space` ведёт себя как `Enter` во всём, включая место закрытия: его делает
    // обработчик активации, а не движок, поэтому журнал тот же и `closeAll` ноль.
    expect(result.after.calls.closeAll).toBe(0);
    expect(result.after.calls.order).toEqual(['action:Выход', 'close:activation']);
    expect(result.after.levels.root.open).toBe(false);
    // Пробел гасится: иначе страница прокрутилась бы под меню.
    expect(result.steps[1].prevented).toBe(true);
  });

  test('Space на пункте-владельце без своего действия открывает подменю', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [2] },
      steps: [
        // «Печать» — третий доступный пункт корня, и у него подменю в два уровня.
        { command: 'press', key: 'ArrowDown' },
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
    // Фокус перенесён туда же, куда его уводит `Enter` у владельца: дорога одна, и
    // переносом занимается движок, а не показ.
    expect(focusTrail(result.steps)).toEqual(['Открыть', 'Экспорт', 'Печать', 'Глубже']);
    expect(result.after.focus.label).toBe('Глубже');
    expect(result.after.levels.sub.activeIndex).toBe(0);
    expect(result.after.levels.sub.tabStops).toBe(1);
    expect(result.after.levels.sub.activeMarks).toBe(1);
    expect(rovingOf(result.after.levels.sub)).toEqual([
      ['Глубже', '0', true, true],
      ['Обычный пункт подменю', '-1', false, false],
    ]);
  });

  test('Enter на владельце с действием зовёт его и закрывает меню', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'ownerActs',
      paths: { root: [], sub: [0] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'Enter' },
      ],
    });

    // Владелец подменю активируется ровно как обычный пункт: то же действие, тот же
    // порядок «действие, потом закрытие» и тот же синтетический клик вместо
    // прямого вызова коллбэка — событие в действии остаётся настоящим.
    expect(result.after.actions).toEqual(['Владелец с действием']);
    expect(result.after.clicks).toEqual(['Владелец с действием']);
    expect(result.after.calls.order).toEqual([
      'action:Владелец с действием', 'close:activation',
    ]);
    // Подменю не раскрывалось: раскрытие осталось за `ArrowRight` и наведением.
    expect(result.after.calls.openSubmenu).toBe(0);
    expect(result.after.levels.root.open).toBe(false);
    expect(result.after.focus.label).not.toBe('Под ним');
    // Признаки владельца на месте: подменю у пункта осталось, и раскрыть его можно.
    expect(result.after.levels.root.items[0].hasSubmenu).toBe(true);
    expect(result.steps[1].prevented).toBe(true);
  });

  test('Space на владельце с действием зовёт его и закрывает меню', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'ownerActs',
      paths: { root: [], sub: [0] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: ' ' },
      ],
    });

    // Ничем не отличается от `Enter`: две клавиши делят одну ветку разбора, иначе у
    // владельца одна открывала бы подменю, а вторая звала бы действие.
    expect(result.after.actions).toEqual(['Владелец с действием']);
    expect(result.after.clicks).toEqual(['Владелец с действием']);
    expect(result.after.calls.openSubmenu).toBe(0);
    expect(result.after.levels.root.open).toBe(false);
    expect(result.steps[1].prevented).toBe(true);
  });

  test('ArrowRight на владельце с действием раскрывает подменю', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'ownerActs',
      paths: { root: [], sub: [0] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
      ],
    });

    // Навигация остаётся только на стрелках: раскрытие у такого пункта никуда не
    // делось, и `Enter` его не отнял.
    expect(result.after.actions).toEqual([]);
    expect(result.after.calls.openSubmenu).toBe(1);
    expect(result.after.calls.openSubmenuIds).toEqual([result.after.levels.sub.id]);
    expect(result.after.levels.sub.open).toBe(true);
    expect(focusTrail(result.steps)).toEqual(['Владелец с действием', 'Под ним']);
  });

  test('Enter на владельце без своего действия раскрывает подменю', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'ownerActs',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'Enter' },
      ],
    });

    // Контроль на то, что новое правило не съело прежнее: у пункта своего действия
    // нет, и `Enter` раскрывает подменю, как раскрывал.
    expect(result.after.actions).toEqual([]);
    expect(result.after.clicks).toEqual([]);
    expect(result.after.calls.openSubmenu).toBe(1);
    expect(result.after.levels.sub.open).toBe(true);
    expect(focusTrail(result.steps)).toEqual([
      'Владелец с действием', 'Владелец без действия', 'Тоже под ним',
    ]);
  });

  test('пункт без submenuAction не владелец: Enter активирует его', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        // Четыре шага вниз по доступным пунктам: «Открыть», «Экспорт», «Печать»,
        // «Без подменю». Разделитель между ними и последний «Выход» в счёт не
        // идут, и открытое меню выделения не имеет, поэтому шагов именно четыре.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'press', key: 'Enter' },
      ],
    });

    expect(focusTrail(result.steps)).toEqual([
      'Открыть', 'Экспорт', 'Печать', 'Без подменю', 'Без подменю', 'Без подменю',
    ]);
    // Пункт с пустым `submenu` не владелец: `ArrowRight` не открыл ничего, а
    // `Enter` активировал его.
    expect(result.after.actions).toEqual(['Без подменю']);
    expect(result.after.clicks).toEqual(['Без подменю']);
    expect(result.after.calls.openSubmenu).toBe(0);
    // Пункт без подменю активируется, и закрывает его обработчик активации: журнал
    // тот же, что у `Enter` на обычном пункте, а `closeAll` движка не зовётся.
    expect(result.after.calls.closeAll).toBe(0);
    expect(result.after.calls.order).toEqual(['action:Без подменю', 'close:activation']);
    expect(result.after.levels.root.open).toBe(false);
    // Признаков владельца у пункта нет ни одного: ни `aria-haspopup`, ни
    // `aria-owns`, ни `aria-expanded`, ни `hasSubmenu`. Это решение рендерера, и
    // обязано совпадать с решением слоя и движка.
    expect(result.after.levels.root.items[3]).toEqual({
      label: 'Без подменю',
      role: 'menuitem',
      tabindex: '0',
      active: true,
      focused: true,
      focusable: true,
      hasSubmenu: false,
      haspopup: null,
      expanded: null,
      owns: null,
      inView: true,
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
        // его подменю. Открытое меню выделения не имеет, поэтому до «Печать» три
        // шага, а в подменю фокус переносит движок сразу после `ArrowRight`.
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'press', key: 'ArrowRight' },
        { command: 'press', key: 'Escape' },
      ],
    });

    expect(focusTrail(result.steps)).toEqual([
      'Открыть', 'Экспорт', 'Печать', 'Глубже', 'Самый нижний', 'Глубже',
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
      'focusOwner',
    ]);
    expect(result.after.levels.root.open).toBe(false);
    expect(result.after.levels.sub.open).toBe(false);
    // Как и `ArrowLeft` на корне, `Escape` возвращает фокус элементу-владельцу:
    // на корне нет пункта-владельца, а оставить фокус в гаснущем меню нельзя.
    expect(result.after.calls.focusOwner).toBe(1);
    expect(result.after.focus.onInvoker).toBe(true);
    expect(result.after.focus.inMenu).toBe(false);
  });

  test('Tab закрывает всё меню и вызывает focusOwner', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        // Фокус в подменю: `Tab` обязан закрыть всю цепочку, а не текущий уровень.
        { command: 'press', key: 'ArrowDown' },
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
    expect(result.steps[3].prevented).toBe(true);
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
      focusChanges: [],
    });
    // Роуминг-состояние меню не тронуто. Отметки, а не весь снимок: фокус ушёл на
    // элемент-владельца по условию шага, и его смена — не результат обработки.
    expect(marksOf(result.after.levels.root)).toEqual(marksOf(result.before.levels.root));
    // Свежее меню выделения не имеет, и у него не появилось его от клавиш вне
    // контейнера: пустой уровень остался пустым.
    expect(result.after.levels.root.activeIndex).toBe(-1);
    expect(result.after.levels.root.tabStops).toBe(0);
    // Фокус остался на элементе-владельце и вне меню.
    expect(result.after.focus.onInvoker).toBe(true);
    expect(result.after.focus.inMenu).toBe(false);
    expect(result.after.actions).toEqual([]);
  });

  test('клавиша в прокручиваемый список обрабатывается уровнем', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'ArrowDown', at: { path: [], index: 0 } },
        { command: 'press-list', key: 'ArrowDown' },
        { command: 'press-list', key: 'End' },
        { command: 'press-list', key: 'Escape' },
      ],
    });

    expect(result.steps[0].focus.label).toBe('Открыть');
    // Цель внутри меню, но не под пунктом — прокручиваемый список. Уровень
    // принадлежит меню целиком, и список не исключение: клавиши на нём разбирает тот
    // же движок, что и на пункте, иначе фокус в списке был бы слепым пятном, где
    // стрелки не работают ни при каком состоянии выделения.
    expect(result.steps.map((step) => step.target)).toEqual([
      'Открыть', 'vc-list', 'vc-list', 'vc-list',
    ]);
    // Разбор состоялся, поэтому и `ArrowDown`, и `End` помечают пункты, а `Escape` не
    // гасится: у корня нет пункта-владельца, и уйти с него некуда — вместо этого всё
    // меню закрывается.
    expect(result.steps.map((step) => step.prevented)).toEqual([true, true, true, true]);
    expect(result.steps[1].levels.root.activeIndex, 'ArrowDown даёт второй').toBe(1);
    expect(result.steps[2].levels.root.activeIndex, 'End даёт последний').toBe(5);
    expect(result.after.levels.root.activeIndex).toBe(5);
    // `Escape` на корне уводит фокус элементу-владельцу, поэтому отметка последнего
    // пункта остаётся стоять, а фокуса в меню уже нет.
    expect(result.after.focus.onInvoker).toBe(true);
    expect(result.after.focus.inMenu).toBe(false);
    expect(result.after.calls.order).toEqual(['closeAll', 'focusOwner']);
  });

  test('клавиши без ветви не гасятся и состояние не трогают', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tree',
      paths: { root: [], sub: [1] },
      steps: [
        { command: 'press', key: 'PageDown', at: { path: [], index: 0 } },
        { command: 'press', key: 'F1', at: { path: [], index: 0 } },
        // Буква: typeahead не реализуется по спецификации, и буква обязана остаться
        // буквой, а не превратиться в переход по первому совпавшему пункту.
        { command: 'press', key: 'a', at: { path: [], index: 0 } },
        { command: 'press', key: 'ArrowDown', at: { path: [], index: 0 } },
        { command: 'press', key: 'PageUp', at: { path: [], index: 0 } },
      ],
    });

    expect(result.steps.map((step) => step.prevented)).toEqual([false, false, false, true, false]);
    // Три незнакомые клавиши не сдвинули активный пункт, а `ArrowDown` между ними
    // сдвинул: иначе «не сдвинули» было бы свойством уровня из одного пункта.
    // Сверяется индекс, а не фокус: клавиши адресованы пункту под выделением, а
    // фокус открытого меню стоит на элементе уровня и от прихода события в пункт не
    // меняется.
    expect(result.steps.map((step) => step.levels.root.activeIndex)).toEqual([
      -1, -1, -1, 0, 0,
    ]);
    // Цель у всех шагов одна и та же — первый доступный пункт, — иначе след сравнивал
    // бы неразные цели, а не сами клавиши. Последние два шага отличаются только
    // клавишей, и именно этим объясняется разница индексов.
    expect(result.steps.map((step) => step.target)).toEqual([
      'Открыть', 'Открыть', 'Открыть', 'Открыть', 'Открыть',
    ]);
    expect(result.after.levels.root.activeIndex).toBe(0);
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

test.describe('передача фокуса', () => {
  test('стрелка вниз даёт focus по одному разу на пункт', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tail',
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
      ],
    });
    expect(result.after.calls.focusChanges).toEqual(['Первый', 'Второй']);
  });

  test('moveTo по кругу на единственном пункте молчит', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'solo',
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowUp' },
      ],
    });
    // Второй и третий шаги выбирают тот же пункт: перехода нет, и сообщать не о чем.
    expect(result.after.calls.focusChanges).toEqual(['Один']);
  });

  test('возврат на уже отмеченный пункт молчит', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'cycle',
      paths: { root: [] },
      steps: [
        { command: 'hover', at: { path: [], index: 0 } },
        { command: 'hover', at: { path: [], index: 0 } },
      ],
    });
    // Мышиный путь возвращает фокус уже отмеченному пункту, не меняя отметки, — и
    // обязан молчать: «фокус остался там же» и «фокус перешёл» неразличимы для
    // движка, а различать их автору не нужно.
    expect(result.after.calls.focusChanges).toEqual(['Первый']);
  });

  test('leave-tree снимает фокус один раз', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'cycle',
      paths: { root: [] },
      steps: [
        { command: 'hover', at: { path: [], index: 0 } },
        { command: 'leave-tree' },
        { command: 'leave-tree' },
      ],
    });
    expect(result.after.calls.focusChanges).toEqual(['Первый', 'нет']);
  });

  test('reset снимает фокус', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'cycle',
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'reset' },
      ],
    });
    expect(result.after.calls.focusChanges).toEqual(['Первый', 'нет']);
  });

  test('уход с уровня без фокуса на нём молчит', async ({ page }) => {
    // Фокус стоит на владельце в корне, а сбрасывается подменю: сообщать нечего, и
    // ложный `null` отдал бы чужой пункт в небыль.
    const result = await runScenario(page, {
      set: 'offLimits',
      paths: { root: [], sub: [2] },
      steps: [
        { command: 'hover', at: { path: [], index: 2 } },
        { command: 'show-submenu', at: { path: [], index: 2 } },
        { command: 'leave-tree', at: { path: [2], index: 0 } },
      ],
    });
    expect(result.after.calls.focusChanges).toEqual(['Живой владелец']);
  });
});
