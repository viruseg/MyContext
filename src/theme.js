/**
 * Тема оформления меню.
 *
 * Значение `data-vc-theme` читает `styles/mycontext.css`:
 * `auto` остаётся связанным с системной схемой, `light` и `dark` задают тему
 * принудительно. Модуль ничего не знает про медиазапросы и про каскад — он
 * только ставит атрибут, и вся логика выбора палитры остаётся в CSS.
 */

/**
 * Прописывает тему оформления элементу меню.
 *
 * @param {HTMLElement} element корневой элемент уровня меню.
 * @param {'auto'|'light'|'dark'} theme тема оформления. `auto` оставляет выбор за
 *   системной схемой, `light` и `dark` переопределяют её.
 * @returns {void}
 */
export function applyTheme(element, theme) {
  element.dataset.vcTheme = theme;
}

/**
 * Прописывает длительность анимаций элементу меню.
 *
 * Значение уходит в `--vc-animation-duration`, откуда его берут переходы меню,
 * пункта и шеврона, поэтому вызывающий код управляет всей анимацией одним
 * значением, а не обходом правил.
 *
 * @param {HTMLElement} element корневой элемент уровня меню.
 * @param {number} durationMs длительность, мс. Отрицательное значение браузер
 *   трактует как ноль.
 * @returns {void}
 */
export function applyAnimationDuration(element, durationMs) {
  element.style.setProperty('--vc-animation-duration', `${durationMs}ms`);
}
