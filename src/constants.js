/**
 * Числовые константы и значения опций по умолчанию.
 *
 * Часть констант обязана совпадать с CSS-переменными из `styles/mycontext.css`:
 * `SAFETY_PADDING` ↔ `--vc-padding`, `DEFAULT_ITEM_HEIGHT` ↔ `--vc-item-height`,
 * `DEFAULT_ICON_SIZE` ↔ `--vc-icon-size`, `DEFAULT_CHEVRON_SIZE` ↔
 * `--vc-chevron-size`, `DEFAULT_RADIUS` ↔ `--vc-radius`,
 * `DEFAULT_ANIMATION_DURATION` ↔ `--vc-animation-duration`.
 *
 * Расхождение с `--vc-padding` сдвигает расчёт: движок позиционирования измеряет
 * элемент, уже ограниченный CSS, и считает отступ до края равным
 * `SAFETY_PADDING`. Само по себе смещение рамки вьюпорт не покинет — предельные
 * `max-width` и `max-height` выведены из `--vc-padding` же, — но решение о том,
 * в какую сторону развернуть меню, примет неверный. Остальные пять констант
 * читаются только тестами, как зеркала токенов, и на поведение не влияют.
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
 * Насколько безопасная область подменю шире самого подменя, px. По трём сторонам,
 * отличным от стороны пункта-владельца.
 */
export const SAFE_AREA_BUFFER = 30;

/**
 * Задержка перед открытием подменю, мс: время, в течение которого наведение
 * на соседний пункт не считается уходом с пункта-владельца.
 */
export const OPEN_GRACE_MS = 250;

/**
 * Задержка перед закрытием подменю, мс: страховочный таймер, когда курсор
 * планирует закрытие, но ещё может вернуться.
 */
export const CLOSE_GRACE_MS = 200;

/**
 * `options.animationDuration` по умолчанию, мс. Дублирует CSS-переменную
 * `--vc-animation-duration` (`140ms`) из `styles/mycontext.css`.
 */
export const DEFAULT_ANIMATION_DURATION = 140;

/**
 * `options.label` по умолчанию: доступное имя меню. Лежит здесь, а не в
 * `src/MyContext.js`, по той же причине, что и остальные дефолты опций, — видно
 * всем, кто их читает, включая тесты.
 *
 * Подставляется вместо пустой строки потому, что имя у уровня обязательно
 * (`createLayer` требует строку), а `aria-label=""` не читается и не проходит
 * аудит доступности. Автор может переопределить его своим.
 */
export const DEFAULT_MENU_LABEL = 'Меню';

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
