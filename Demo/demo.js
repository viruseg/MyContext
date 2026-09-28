import { MyContext } from '../src/index.js';
import { scenarios } from './scenarios.js';

/**
 * @typedef {import('./scenarios.js').Scenario} Scenario
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
 * @param {string} tagName имя тега.
 * @param {string} className класс.
 * @param {string} text содержимое.
 * @returns {HTMLElement}
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
 * перезаписываемая строка показывала бы только последний. Подпись пункта идёт
 * как есть — без «Выбрано:» и точки, потому что журнал и так стоит в блоке
 * сценария, и префикс повторял бы то, что видно и без него.
 *
 * Блок и журнал ищутся в момент клика, а не захватываются при сборке: клик,
 * которому некуда писать, обязан сказать об этом голосом, а не исчезнуть за
 * работающим меню.
 *
 * @param {string} scenarioId значение `data-scenario` у блока.
 * @param {string} label подпись пункта.
 * @returns {NonNullable<MenuItem['action']>}
 * @throws {Error} если блока или его журнала нет на странице.
 */
function logIn(scenarioId, label) {
  return () => {
    const block = document.querySelector(`[data-scenario="${scenarioId}"]`);
    const log = block === null ? null : block.querySelector('.demo-log');
    if (!(log instanceof HTMLElement)) {
      throw new Error(`демо: у блока «${scenarioId}» нет журнала кликов`);
    }
    log.appendChild(textElement('li', 'demo-log__item', label));
  };
}

/**
 * Глубокая копия дерева пунктов с действием на каждом пункте всех уровней.
 *
 * Отдельный проход, а не `action` в описаниях сценариев: описания остаются
 * чистыми, и новый пункт в них сразу получает рабочий клик — расставить
 * действия по шести сценариям вручную значило бы, что следующий пункт про них
 * забудет. Владелец непустого подменю действие тоже получает, но клик по нему
 * его не зовёт: библиотека открывает подменю вместо этого, и обойти это из
 * демо нечем.
 *
 * @param {string} scenarioId значение `data-scenario` у блока.
 * @param {Array<MenuItem | SeparatorItem>} items пункты одного уровня.
 * @returns {Array<MenuItem | SeparatorItem>} копия уровня с действиями.
 */
function withItemActions(scenarioId, items) {
  return items.map((item) => {
    if (isSeparator(item)) {
      return item;
    }
    return {
      ...item,
      action: logIn(scenarioId, item.label),
      // Приведение не выдумано: разделитель попасть в подменю не может, потому
      // что `MenuItem.submenu` объявлен как `MenuItem[]`, и на вход рекурсии
      // приходит ровно то, чем этот тип помечен. На верхнем уровне тип смешанный,
      // и там разделители остаются разделителями.
      submenu: item.submenu === undefined
        ? undefined
        : /** @type {MenuItem[]} */ (withItemActions(scenarioId, item.submenu)),
    };
  });
}

/**
 * Наполняет блок сценария и заводит для него собственный экземпляр меню.
 *
 * Экземпляр на сценарий, а не один на страницу: у каждого блока своя привязка
 * `contextmenu`, свои уровни и своя карта действий. Общий экземпляр на шесть
 * блоков перепривязался бы к последнему, и пять блоков не открывали бы ничего.
 *
 * @param {Scenario} scenario описание сценария.
 * @param {HTMLElement} block блок сценария в разметке.
 * @returns {MyContext} экземпляр меню сценария. Возвращается нарочно: возврат
 *   делает жизненный цикл экземпляра видимым в подписи функции, а хранить его
 *   странице незачем — привязка живёт в слушателях, и `destroy()` демо не зовёт.
 */
function buildScenario(scenario, block) {
  // Ровно три узла, и все напечатаны здесь. Журнал наполняется по клику, но
  // дописывает строки в себя сам и структуру блока не меняет — благодаря этому
  // кейс о списке сценариев, читающий дерево блока, остаётся в силе и после
  // кликов.
  block.replaceChildren(
    textElement('h2', 'demo-scenario__title', scenario.title),
    textElement('p', 'demo-scenario__hint', 'Правый клик по блоку открывает его меню.'),
    logElement(),
  );
  // `animationDuration` оставлен по умолчанию: он совпадает с
  // `--vc-animation-duration` из `styles/mycontext.css`, и подставлять рядом
  // второе значение того же самого числа незачем.
  const menu = new MyContext(withItemActions(scenario.id, scenario.items), {
    theme: 'auto',
    label: scenario.title,
  });
  menu.attach(block);
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
 * @returns {void}
 * @throws {Error} если число блоков на странице не совпадает с числом сценариев:
 *   лишний блок остался бы неоткрывающимся, а пропущенный сценарий выпал бы из
 *   демо вместе со своей проверкой.
 */
function buildScenarios() {
  const blocks = document.querySelectorAll(BLOCK_SELECTOR);
  if (blocks.length !== scenarios.length) {
    throw new Error(
      `демо: блоков ${blocks.length}, сценариев ${scenarios.length}`
      + ' — разметка и Demo/scenarios.js расходятся',
    );
  }
  for (const scenario of scenarios) {
    buildScenario(scenario, scenarioBlock(scenario.id));
  }
}

bindThemeToggle();
buildScenarios();
