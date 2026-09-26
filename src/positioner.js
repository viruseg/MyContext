import { CURSOR_OFFSET, SAFETY_PADDING, SUBMENU_OFFSET } from './constants.js';

/**
 * Прямоугольник пункта-владельца подменю в координатах вьюпорта.
 *
 * @typedef {object} AnchorRect
 * @property {number} left левая граница пункта-владельца.
 * @property {number} top верхняя граница пункта-владельца.
 * @property {number} right правая граница пункта-владельца.
 * @property {number} bottom нижняя граница пункта-владельца.
 */

/**
 * Входные данные расчёта позиции корневого меню. Размеры меню и вьюпорта
 * передаёт вызывающий код: движок не обращается к DOM.
 *
 * @typedef {object} RootPositionParams
 * @property {number} cursorX координата точки вызова по горизонтали.
 * @property {number} cursorY координата точки вызова по вертикали.
 * @property {number} menuWidth измеренная ширина меню.
 * @property {number} menuHeight измеренная высота меню.
 * @property {number} viewportWidth ширина вьюпорта.
 * @property {number} viewportHeight высота вьюпорта.
 * @property {number} [offset] зазор между точкой вызова и краем меню, `CURSOR_OFFSET` по умолчанию.
 * @property {number} [padding] минимальный отступ от краёв вьюпорта, `SAFETY_PADDING` по умолчанию.
 */

/**
 * Входные данные расчёта позиции подменю.
 *
 * @typedef {object} SubmenuPositionParams
 * @property {AnchorRect} anchorRect прямоугольник пункта-владельца в координатах вьюпорта.
 * @property {number} menuWidth измеренная ширина подменю.
 * @property {number} menuHeight измеренная высота подменю.
 * @property {number} viewportWidth ширина вьюпорта.
 * @property {number} viewportHeight высота вьюпорта.
 * @property {number} [offset] горизонтальный зазор между пунктом-владельцем и подменю, `SUBMENU_OFFSET` по умолчанию.
 * @property {number} [padding] минимальный отступ от краёв вьюпорта, `SAFETY_PADDING` по умолчанию.
 */

/**
 * Единственный предикат вписывания: одинаков для всех осей и обоих меню.
 *
 * @param {number} position начало координаты меню на оси.
 * @param {number} size размер меню на оси.
 * @param {number} viewport размер вьюпорта на оси.
 * @param {number} padding минимальный отступ от краёв вьюпорта.
 * @returns {boolean} `true`, если меню помещается с отступом `padding` с обеих сторон.
 */
function fitsWithin(position, size, viewport, padding) {
  return position >= padding && position + size + padding <= viewport;
}

/**
 * Выбирает первую подходящую позицию из кандидатов, иначе последнюю.
 * Последний кандидат — всегда `padding`, то есть клампит для меню, которое
 * не помещается ни в одну из сторон.
 *
 * @param {number[]} candidates кандидаты в порядке предпочтения.
 * @param {number} size размер меню на оси.
 * @param {number} viewport размер вьюпорта на оси.
 * @param {number} padding минимальный отступ от краёв вьюпорта.
 * @returns {number} начало координаты меню на оси.
 */
function pickAxisPosition(candidates, size, viewport, padding) {
  const fallback = candidates[candidates.length - 1];
  return candidates.find((position) => fitsWithin(position, size, viewport, padding)) ?? fallback;
}

/**
 * Считает позицию корневого меню: по возможности рядом с точкой вызова, иначе
 * с противоположной стороны от курсора, иначе прижатая к `padding`.
 *
 * `offset` симметричен: при флипе он отодвигает меню от курсора с обратной
 * стороны на ту же величину.
 *
 * @param {RootPositionParams} params входные данные расчёта.
 * @returns {{left: number, top: number}} координаты левого верхнего угла меню в вьюпорте.
 */
export function calculateMenuPosition(params) {
  const {
    cursorX,
    cursorY,
    menuWidth,
    menuHeight,
    viewportWidth,
    viewportHeight,
    offset = CURSOR_OFFSET,
    padding = SAFETY_PADDING,
  } = params;

  return {
    left: pickAxisPosition(
      [cursorX + offset, cursorX - menuWidth - offset, padding],
      menuWidth,
      viewportWidth,
      padding,
    ),
    top: pickAxisPosition(
      [cursorY + offset, cursorY - menuHeight - offset, padding],
      menuHeight,
      viewportHeight,
      padding,
    ),
  };
}

/**
 * Считает позицию подменю относительно пункта-владельца: справа от него, при
 * нехватке места слева, иначе прижатая к `padding`.
 *
 * По вертикали флипа нет: у подменю нет собственной точки вызова, поэтому
 * отодвигать его не от чего — оно только сдвигается вверх, сохраняя верхнюю
 * границу на уровне пункта-владельца, пока хватает места. Поэтому `offset`
 * по вертикали не применяется.
 *
 * @param {SubmenuPositionParams} params входные данные расчёта.
 * @returns {{left: number, top: number, flippedX: boolean}} координаты левого верхнего угла
 *   подменю в вьюпорте и признак разворота шеврона у пункта-владельца.
 *   `flippedX` — `true`, если правый кандидат не подошёл; в том числе когда
 *   не подошёл и левый, и подменю прижато к `padding`.
 */
export function calculateSubmenuPosition(params) {
  const {
    anchorRect,
    menuWidth,
    menuHeight,
    viewportWidth,
    viewportHeight,
    offset = SUBMENU_OFFSET,
    padding = SAFETY_PADDING,
  } = params;

  let left = anchorRect.right + offset;
  let flippedX = false;
  if (!fitsWithin(left, menuWidth, viewportWidth, padding)) {
    flippedX = true;
    left = anchorRect.left - menuWidth - offset;
    if (!fitsWithin(left, menuWidth, viewportWidth, padding)) {
      left = padding;
    }
  }

  return {
    left,
    top: Math.max(padding, Math.min(anchorRect.top, viewportHeight - padding - menuHeight)),
    flippedX,
  };
}
