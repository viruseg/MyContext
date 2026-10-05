import { MyContext } from '../src/index.js';
import {
  DEFAULT_AUTO_HIDE_DISTANCE,
  DEFAULT_PRESS_AND_HOLD,
  DEFAULT_SCALE,
} from '../src/constants.js';
import { scenarios } from './scenarios.js';

/**
 * @typedef {import('./scenarios.js').Scenario} Scenario
 * @typedef {import('./scenarios.js').DemoItem} DemoItem
 * @typedef {import('../src/renderer.js').MenuItem} MenuItem
 * @typedef {import('../src/renderer.js').SeparatorItem} SeparatorItem
 */

/** Селектор кнопки переключателя темы. */
const TOGGLE_SELECTOR = '[data-theme-toggle]';

/** Селектор блока сценария. */
const BLOCK_SELECTOR = '[data-scenario]';
/** Атрибут, которым тема помечена на корневом элементе документа. */
const THEME_ATTRIBUTE = 'data-demo-theme';

/** Темы страницы. */
const THEMES = /** @type {const} */ (['light', 'dark']);

/** Поле, которым разделитель отличается от пункта. */
const SEPARATOR_TYPE = 'separator';

/**
 * Подсказка блока, которому нечего сказать своего: он открывается так же, как
 * остальные, и различается только составом меню.
 */
const DEFAULT_HINT = 'Правый клик по блоку открывает его меню.';

/**
 * Границы ползунка множителя размеров в блоке `scale`.
 *
 * Нижняя граница меньше единицы намеренно: уменьшить меню автору нужно не реже,
 * чем увеличить, и ползунок, начинающийся с единицы, половину своего диапазона
 * не давал бы. Верхняя граница — `2`, а не «сколько влезет»: за ней начинается
 * длинный список, и ползунок, уводящий меню за пределы экрана, показывал бы не
 * размер, а прокрутку.
 */
const SCALE_RANGE = { min: 0.5, max: 2, step: 0.1 };

/**
 * Тема страницы, записанная в разметку. Значение по умолчанию продублировано в
 * `index.html` намеренно: без атрибута на `<html>` правила меню для тёмной темы
 * не применились бы, и первый кадр страницы был бы светлым независимо от
 * переключателя.
 */
const DEFAULT_THEME = 'light';

/**
 * @param {unknown} value
 * @returns {value is (typeof THEMES)[number]} `true`, если значение — тема страницы.
 */
function isTheme(value) {
  return typeof value === 'string' && THEMES.some((theme) => {
    return theme === value;
  });
}

/**
 * Блок сценария по его `data-scenario`.
 *
 * @param {string} id идентификатор сценария.
 * @returns {HTMLElement}
 * @throws {Error} если блока нет: страница обязана падать, а не молча пропускать
 *   сценарий, иначе проверка «список сценариев отрисован» прошла бы на неполной
 *   странице.
 */
function scenarioBlock(id) {
  const block = document.querySelector(`[data-scenario="${id}"]`);
  if (!(block instanceof HTMLElement)) {
    throw new Error(`демо: в разметке нет блока сценария «${id}»`);
  }
  return block;
}

/**
 * Печатает элемент с текстом.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tagName имя тега.
 * @param {string} className класс.
 * @param {string} text содержимое.
 * @returns {HTMLElementTagNameMap[K]}
 */
function textElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * Пустой журнал кликов блока сценария.
 *
 * `ol` с `li` внутри, а не `div` с текстом: журнал — упорядоченный список
 * кликов, и скринридер объявляет его списком с местом каждой строки в нём.
 * Видимых номеров нет, и это `Demo/demo.css` (`list-style: none`): порядок виден
 * сверху вниз и без них. `aria-live="polite"` — потому что дописывает строку
 * читатель, и прерывать ей то, что скринридер читает сейчас, незачем.
 *
 * Регион фокусируем: `Demo/demo.css` ограничивает журнал по высоте и
 * прокручивает его, а `overflow-y: auto` без `tabindex` с клавиатуры не
 * прокрутить (WCAG 2.1.1). `aria-live` объявляет новую строку, но дочитать
 * предыдущие не помогает, и для этого на журнал встают стрелками.
 *
 * @returns {HTMLOListElement}
 */
function logElement() {
  const log = document.createElement('ol');
  log.className = 'demo-log';
  log.setAttribute('aria-live', 'polite');
  log.tabIndex = 0;
  return log;
}

/**
 * Отличается ли пункт от разделителя. Объявлено предикатом по той же причине,
 * что и в `src/renderer.js`: сужение через `boolean` на выходе не работает, и в
 * ветке «не разделитель» остался бы весь союз.
 *
 * @param {MenuItem | SeparatorItem} item
 * @returns {item is SeparatorItem} `true`, если это разделитель.
 */
function isSeparator(item) {
  return 'type' in item && item.type === SEPARATOR_TYPE;
}

/**
 * Действие пункта: дописывает его подпись в журнал кликов своего блока.
 *
 * Журнал, а не перезапись подсказки: кликов за сеанс сколько угодно, и одна
 * перезаписываемая строка показала бы только последний. Подпись пункта идёт
 * как есть — без «Выбрано:» и точки, потому что журнал и так стоит в блоке
 * сценария, и префикс повторял бы то, что видно и без него.
 *
 * Подпись берётся в момент клика, а не при сборке действия: подпись пункта —
 * действие, и она меняется от показа к показу. Захваченная при сборке надпись
 * писала бы в журнал то, что было на странице при загрузке, а не то, что автор
 * видел в строке.
 *
 * Блок и журнал ищутся в момент клика, а не захватываются при сборке: клик,
 * которому некуда писать, обязан сказать об этом голосом, а не исчезнуть за
 * работающим меню.
 *
 * @param {string} scenarioId значение `data-scenario` у блока.
 * @param {() => string | Promise<string>} readLabel чтение подписи пункта в момент клика.
 * @returns {NonNullable<MenuItem['action']>}
 * @throws {Error} если блока или его журнала нет на странице.
 */
function logIn(scenarioId, readLabel) {
  return async () => {
    const block = document.querySelector(`[data-scenario="${scenarioId}"]`);
    const log = block === null ? null : block.querySelector('.demo-log');
    if (!(log instanceof HTMLElement)) {
      throw new Error(`демо: у блока «${scenarioId}» нет журнала кликов`);
    }
    log.appendChild(textElement('li', 'demo-log__item', await readLabel()));
  };
}

/**
 * Действие на каждом пункте всех уровней, добавленное поверх описания сценария.
 *
 * Отдельный проход, а не `action` в описаниях сценариев: описания остаются
 * чистыми, и новый пункт в них сразу получает рабочий клик — расставить
 * действия по всем сценариям вручку значило бы, что следующий пункт про них
 * забудет. Владелец непустого подменю — единственное исключение, и исключение
 * это пометка `ownAction` в описании: без неё журнал на владельца не
 * навешивается, и клик по нему раскрывает подменю, как раскрывал. С пометкой
 * владелец кликабелен, и журнал пишет его подпись как подпись любого пункта.
 *
 * Глубина не разворачивается заранее: `submenuAction` предъявляет состав при
 * показе, и обёртка навешивает действия на пункты тогда, когда их действительно
 * построят. Заранее развёрнутое дерево было бы второй копией состава, которая
 * разошлась бы с той, что вернул `submenuAction`.
 *
 * @param {string} scenarioId значение `data-scenario` у блока.
 * @param {Array<DemoItem | SeparatorItem> | Promise<Array<DemoItem | SeparatorItem>>} items
 *   пункты одного уровня; `submenuAction` вправе отдать промис.
 * @returns {Promise<Array<MenuItem | SeparatorItem>>} копия уровня с действиями.
 */
async function withItemActions(scenarioId, items) {
  const level = await items;
  return level.map((item) => {
    if (isSeparator(item)) {
      return item;
    }
    const { labelAction, submenuAction, ownAction, ...rest } = item;
    // `action: undefined` — не то же, что отсутствие поля, но для контракта разницы
    // нет: предикат доступности владельца всё равно решает по `submenuAction`, а
    // журнал на пункт без действия не навешивается.
    const clickable = submenuAction === undefined || ownAction === true;
    return {
      ...rest,
      labelAction,
      action: clickable ? logIn(scenarioId, labelAction) : undefined,
      submenuAction: submenuAction === undefined
        ? undefined
        : async () => {
          return withItemActions(scenarioId, await submenuAction());
        },
    };
  });
}

/**
 * Заводит экземпляр меню сценария.
 *
 * Единственное место страницы, где зовётся `new MyContext`: блок с ползунком
 * размера пересобирает меню, и второй вызов конструктора разошёлся бы с первым
 * по составу опций — читатель увидел бы в одном блоке меню, часть которого
 * простроена иначе.
 *
 * `animationDuration` оставлен по умолчанию: он совпадает с
 * `--vc-animation-duration` из `styles/mycontext.css`, и подставлять рядом
 * второе значение того же самого числа незачем.
 *
 * `autoHideDistance` и `scale` наоборот проставлены всем, включая нулевой и
 * единичный: у всех блоков кроме одного ноль — это «выключено», а у всех кроме
 * одного единица — это «не увеличено», то есть ровно то же поведение, что при
 * отсутствии поля, — но читатель видит, чем блок `autohide` отличается от
 * остальных и чем `scale` — от всех, не разбирая описания сценариев. Вендорить
 * поле ради одного блока значило бы спрятать отличие туда, где его искать не
 * приходит в голову.
 *
 * @param {Scenario} scenario описание сценария.
 * @param {number} scale множитель размеров меню.
 * @returns {Promise<MyContext>} демо собирает пункты до создания меню: `submenuAction`
 *   вправе отдать промис, а разворачивать его надо с ожиданием.
 */
async function createMenu(scenario, scale) {
  return new MyContext(await withItemActions(scenario.id, scenario.items), {
    theme: 'auto',
    label: scenario.title,
    autoHideDistance: scenario.autoHideDistance ?? DEFAULT_AUTO_HIDE_DISTANCE,
    pressAndHold: scenario.pressAndHold ?? DEFAULT_PRESS_AND_HOLD,
    scale,
  });
}

/**
 * Ползунок множителя размеров и его числовой отклик.
 *
 * `output` вместо простого `span` — из-за встроенной живой области: смена
 * величины читатель иначе не узнал бы, а блок показывает ровно эту величину.
 * Подпись оборачивает ползунок, а не соседствует с ним, — имя элемента управления
 * читается и с клавиатуры, и мышью, и не требует `aria-label`.
 *
 * @returns {{ root: HTMLLabelElement, range: HTMLInputElement, readout: HTMLOutputElement }}
 */
function scaleControl() {
  const root = document.createElement('label');
  root.className = 'demo-scale';

  const caption = textElement('span', 'demo-scale__caption', 'Масштаб');
  const range = document.createElement('input');
  range.className = 'demo-scale__range';
  range.type = 'range';
  range.min = String(SCALE_RANGE.min);
  range.max = String(SCALE_RANGE.max);
  range.step = String(SCALE_RANGE.step);
  range.value = String(DEFAULT_SCALE);

  const readout = document.createElement('output');
  readout.className = 'demo-scale__value';
  readout.value = String(DEFAULT_SCALE);

  root.append(caption, range, readout);
  return { root, range, readout };
}

/**
 * Наполняет блок сценария и заводит для него собственный экземпляр меню.
 *
 * Экземпляр на сценарий, а не один на страницу: у каждого блока своя привязка
 * `contextmenu`, свои уровни и своя карта действий. Общий экземпляр на все
 * блоки перепривязался бы к последнему, и остальные не открывали бы ничего.
 *
 * @param {Scenario} scenario описание сценария.
 * @param {HTMLElement} block блок сценария в разметке.
 * @returns {Promise<MyContext>} начальный экземпляр меню сценария. Возвращается нарочно:
 *   возврат делает жизненный цикл экземпляра видимым в подписи функции, а хранить
 *   его странице незачем — привязка живёт в слушателях, и `destroy()` демо не зовёт.
 *   У блока с ползунком возвращённый экземпляр устаревает после первого движения
 *   ползунка: пересборка заводит новый, и держаться за старый было бы держаться
 *   разобранного.
 */
async function buildScenario(scenario, block) {
  // Ровно три узла, и все напечатаны здесь. Журнал наполняется по клику, но
  // дописывает строки в себя сам и структуру блока не меняет — благодаря этому
  // кейс о списке сценариев, читающий дерево блока, остаётся в силе и после
  // кликов.
  block.replaceChildren(
    textElement('h2', 'demo-scenario__title', scenario.title),
    textElement('p', 'demo-scenario__hint', scenario.hint ?? DEFAULT_HINT),
    logElement(),
  );
  let menu = await createMenu(scenario, DEFAULT_SCALE);
  if (scenario.openFromButton === true) {
    // Привязки нет намеренно: блок с этим сценарием показывает показ из чужого кода,
    // а правила закрытия поднимает сам показ. Привязанный блок открыл бы меню ещё и
    // правым кликом, и `dismissible` ничего бы не менял.
    const opener = textElement('button', 'demo-scenario__opener', 'Открыть меню');
    opener.type = 'button';
    opener.addEventListener('click', async () => {
      const rect = opener.getBoundingClientRect();
      // Промис ждётся: показ возвращает его, а данные пунктов могут читаться
      // асинхронно, и «открыто» без ожидания значило бы «начали открывать».
      await menu.open({ x: rect.right, y: rect.top }, { dismissible: true });
    });
    block.appendChild(opener);
    return menu;
  }
  menu.attach(block);
  if (scenario.scaleControl === true) {
    const control = scaleControl();
    // Пересборка вместо правки величины на ходу: `scale` задан в конструкторе
    // один раз, и менять его на лету у библиотеки нечем. Прежний экземпляр
    // обязательно разбирается — два слушателя `contextmenu` на одном блоке
    // открыли бы два меню.
    //
    // Блок при этом не перерисовывается: журнал кликов накопленное переживает
    // смену размера, и `logIn` ищет его по блоку в момент клика.
    control.range.addEventListener('input', async () => {
      menu.destroy();
      menu = await createMenu(scenario, Number(control.range.value));
      menu.attach(block);
      control.readout.value = control.range.value;
    });
    block.appendChild(control.root);
  }
  return menu;
}

/**
 * @returns {HTMLButtonElement}
 * @throws {Error} если переключателя нет или он не кнопка.
 */
function themeToggle() {
  const button = document.querySelector(TOGGLE_SELECTOR);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('демо: в разметке нет переключателя темы страницы');
  }
  return button;
}

/**
 * Тема, записанная на корневом элементе, с откатом на разметку.
 *
 * @returns {(typeof THEMES)[number]}
 */
function currentTheme() {
  const written = document.documentElement.getAttribute(THEME_ATTRIBUTE);
  return isTheme(written) ? written : DEFAULT_THEME;
}

/**
 * Записывает тему и приводит переключатель в состояние, ей соответствующее.
 *
 * @param {HTMLButtonElement} button
 * @param {(typeof THEMES)[number]} theme
 * @returns {void}
 */
function applyTheme(button, theme) {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  button.setAttribute('aria-pressed', theme === THEMES[1] ? 'true' : 'false');
}

/**
 * Переключатель темы страницы. Тема меняется на `<html>`, а правила меню в
 * `Demo/demo.css` привязаны к тому же атрибуту, поэтому открытое меню
 * перекрашивается вместе со страницей и продолжает жить: его `data-vc-theme`
 * остаётся `auto`, и решение о палитре принимает каскад, а не скрипт.
 *
 * @returns {void}
 */
function bindThemeToggle() {
  const button = themeToggle();
  let theme = currentTheme();
  applyTheme(button, theme);
  button.addEventListener('click', () => {
    theme = theme === THEMES[0] ? THEMES[1] : THEMES[0];
    applyTheme(button, theme);
  });
}

/**
 * @returns {Promise<void>}
 * @throws {Error} если число блоков на странице не совпадает с числом сценариев:
 *   лишний блок остался бы неоткрывающимся, а пропущенный сценарий выпал бы из
 *   демо вместе со своей проверкой.
 */
async function buildScenarios() {
  const blocks = document.querySelectorAll(BLOCK_SELECTOR);
  if (blocks.length !== scenarios.length) {
    throw new Error(
      `демо: блоков ${blocks.length}, сценариев ${scenarios.length}`
      + ' — разметка и Demo/scenarios.js расходятся',
    );
  }
  for (const scenario of scenarios) {
    await buildScenario(scenario, scenarioBlock(scenario.id));
  }
}

bindThemeToggle();
await buildScenarios();
