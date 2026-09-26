/**
 * Числовые константы и значения опций по умолчанию.
 *
 * Часть констант обязана совпадать с CSS-переменными из `styles/mycontext.css`:
 * `SAFETY_PADDING` ↔ `--vc-padding`, `DEFAULT_ITEM_HEIGHT` ↔ `--vc-item-height`,
 * `DEFAULT_ICON_SIZE` ↔ `--vc-icon-size`, `DEFAULT_CHEVRON_SIZE` ↔
 * `--vc-chevron-size`, `DEFAULT_RADIUS` ↔ `--vc-radius`,
 * `DEFAULT_ANIMATION_DURATION` ↔ `--vc-animation-duration`. Расхождение ломает
 * геометрию: движок позиционирования измеряет элемент, уже ограниченный CSS, и
 * считает, что отступ до края равен `SAFETY_PADDING`.
 */

/**
 * Минимальный отступ от краёв вьюпорта, px. Дублирует CSS-переменную
 * `--vc-padding` (`8px`) из `styles/mycontext.css`.
 */
export const SAFETY_PADDING = 8;

/**
 * Зазор между точкой вызова и краем корневого меню, px.
 */
export const CURSOR_OFFSET = 2;

/**
 * Зазор между пунктом-владельцем и его подменю по горизонтали, px.
 */
export const SUBMENU_OFFSET = 4;

/**
 * Задержка перед открытием подменю, мс: время, в течение которого наведение
 * на соседний пункт не считается уходом с пункта-владельца.
 */
export const OPEN_GRACE_MS = 250;

/**
 * Задержка перед закрытием подменю, мс: страховочный таймер safe-triangle.
 */
export const CLOSE_GRACE_MS = 200;

/**
 * Порог площади треугольника, ниже которого он считается вырожденным, px².
 */
export const DEGENERATE_AREA = 25;

/**
 * `options.animationDuration` по умолчанию, мс. Дублирует CSS-переменную
 * `--vc-animation-duration` (`140ms`) из `styles/mycontext.css`.
 */
export const DEFAULT_ANIMATION_DURATION = 140;

/**
 * Значение CSS-переменной `--vc-item-height` по умолчанию, px.
 */
export const DEFAULT_ITEM_HEIGHT = 28;

/**
 * Значение CSS-переменной `--vc-icon-size` по умолчанию, px.
 */
export const DEFAULT_ICON_SIZE = 16;

/**
 * Значение CSS-переменной `--vc-chevron-size` по умолчанию, px.
 */
export const DEFAULT_CHEVRON_SIZE = 12;

/**
 * Значение CSS-переменной `--vc-radius` по умолчанию, px.
 */
export const DEFAULT_RADIUS = 8;
