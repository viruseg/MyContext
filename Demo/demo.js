import { MyContext } from '../src/index.js';
import { scenarios } from './scenarios.js';

/**
 * @typedef {import('./scenarios.js').Scenario} Scenario
 */

/** Селектор кнопки переключателя темы. */
const TOGGLE_SELECTOR = '[data-theme-toggle]';

/** Селектор блока сценария. */
const BLOCK_SELECTOR = '[data-scenario]';
/** Атрибут, которым тема помечена на корневом элементе документа. */
const THEME_ATTRIBUTE = 'data-demo-theme';

/** Темы страницы. */
const THEMES = /** @type {const} */ (['light', 'dark']);

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
  block.replaceChildren(
    textElement('h2', 'demo-scenario__title', scenario.title),
    textElement('p', 'demo-scenario__hint', 'Правый клик по блоку открывает его меню.'),
  );
  // `animationDuration` оставлен по умолчанию: он совпадает с
  // `--vc-animation-duration` из `styles/mycontext.css`, и подставлять рядом
  // второе значение того же самого числа незачем.
  const menu = new MyContext(scenario.items, { theme: 'auto', label: scenario.title });
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
