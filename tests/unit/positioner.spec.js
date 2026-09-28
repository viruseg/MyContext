import { expect, test } from '@playwright/test';
import { calculateMenuPosition, calculateSubmenuPosition } from '../../src/positioner.js';

const VIEWPORT_WIDTH = 1000;
const VIEWPORT_HEIGHT = 800;
const MENU_WIDTH = 200;
const MENU_HEIGHT = 300;
// Отступы и зазоры нигде не передаются явно: кейсы проверяют поведение
// дефолтов — padding 8, offset 2 для корня и 4 для подменю.
const PADDING = 8;
const SUBMENU_OFFSET = 4;

const GRID_X = [0, 1, 8, 9, 400, 500, 991, 999, 1000];
const GRID_Y = [0, 1, 8, 9, 300, 500, 799, 800];
const MENU_SIZES = [
  [200, 300],
  [50, 50],
  [999, 1000],
  [1, 1],
];

// Размеры пункта-владельца из примеров брифа: 200×28. Прямоугольник якоря
// выводится из координат сетки без клампинга во вьюпорт, поэтому в обход
// попадают и владельцы, выходящие за правый и нижний края.
const ANCHOR_WIDTH = 200;
const ANCHOR_HEIGHT = 28;

/**
 * Проверяет контейнерную гарантию по одной оси.
 *
 * Гарантия «меню целиком внутри вьюпорта минус padding» достижима только
 * для меню, которое физически помещается: `size + 2 * padding <= viewport`.
 * Крупнее — и ни один кандидат не пройдёт предикат: любой `position >= padding`
 * по нему же требует `position <= viewport - size - padding < padding`, то есть
 * условия противоречат друг другу. Движок в этом случае сознательно
 * возвращает `padding` как точку отсчёта заведомо переполненного меню, и такая
 * комбинация проверяется как clamp, а не как вписывание.
 *
 * @param {number} position начало координаты меню на оси.
 * @param {number} size размер меню на оси.
 * @param {number} viewport размер вьюпорта на оси.
 * @param {string} label описание комбинации для сообщения об ошибке.
 */
function expectContainedAxis(position, size, viewport, label) {
  if (size + 2 * PADDING > viewport) {
    expect(position, `${label}: меню не помещается, ожидается clamp к ${PADDING}`).toBe(PADDING);
    return;
  }
  expect(position, `${label}: начало ближе отступа к краю вьюпорта`).toBeGreaterThanOrEqual(PADDING);
  expect(position + size, `${label}: конец выходит за вьюпорт`).toBeLessThanOrEqual(viewport - PADDING);
}

test.describe('calculateMenuPosition', () => {
  test('правый нижний угол: cursor (990, 790) → left 788, top 488', () => {
    expect(
      calculateMenuPosition({
        cursorX: 990,
        cursorY: 790,
        menuWidth: MENU_WIDTH,
        menuHeight: MENU_HEIGHT,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      }),
    ).toEqual({ left: 788, top: 488 });
  });

  test('левый верхний угол: cursor (10, 10) → left 12, top 12', () => {
    expect(
      calculateMenuPosition({
        cursorX: 10,
        cursorY: 10,
        menuWidth: MENU_WIDTH,
        menuHeight: MENU_HEIGHT,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      }),
    ).toEqual({ left: 12, top: 12 });
  });

  test('не хватает места только справа: cursor (850, 10) → left 648', () => {
    expect(
      calculateMenuPosition({
        cursorX: 850,
        cursorY: 10,
        menuWidth: MENU_WIDTH,
        menuHeight: MENU_HEIGHT,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      }),
    ).toEqual({ left: 648, top: 12 });
  });

  test('offset влияет на оба края: при offset 0 тот же угол даёт left 790, top 490', () => {
    expect(
      calculateMenuPosition({
        cursorX: 990,
        cursorY: 790,
        menuWidth: MENU_WIDTH,
        menuHeight: MENU_HEIGHT,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
        offset: 0,
      }),
    ).toEqual({ left: 790, top: 490 });
  });

  test('меню шире вьюпорта: menuWidth 1200, cursor (500, 10) → left 8', () => {
    expect(
      calculateMenuPosition({
        cursorX: 500,
        cursorY: 10,
        menuWidth: 1200,
        menuHeight: MENU_HEIGHT,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      }),
    ).toEqual({ left: 8, top: 12 });
  });

  test('меню выше вьюпорта: menuHeight 900, cursor (10, 400) → top 8', () => {
    expect(
      calculateMenuPosition({
        cursorX: 10,
        cursorY: 400,
        menuWidth: MENU_WIDTH,
        menuHeight: 900,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      }),
    ).toEqual({ left: 12, top: 8 });
  });

  test('курсор у самого края: cursor (0, 0) → left 8, top 8', () => {
    expect(
      calculateMenuPosition({
        cursorX: 0,
        cursorY: 0,
        menuWidth: MENU_WIDTH,
        menuHeight: MENU_HEIGHT,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      }),
    ).toEqual({ left: 8, top: 8 });
  });

  test('инвариант: меню целиком внутри вьюпорта минус padding', () => {
    for (const [menuWidth, menuHeight] of MENU_SIZES) {
      for (const cursorX of GRID_X) {
        for (const cursorY of GRID_Y) {
          const label = `меню ${menuWidth}x${menuHeight}, курсор (${cursorX}, ${cursorY})`;
          const { left, top } = calculateMenuPosition({
            cursorX,
            cursorY,
            menuWidth,
            menuHeight,
            viewportWidth: VIEWPORT_WIDTH,
            viewportHeight: VIEWPORT_HEIGHT,
          });
          expectContainedAxis(left, menuWidth, VIEWPORT_WIDTH, label);
          expectContainedAxis(top, menuHeight, VIEWPORT_HEIGHT, label);
        }
      }
    }
  });
});

test.describe('calculateSubmenuPosition', () => {
  test('справа есть место: anchorRect (100, 100, 300, 128) → left 304, top 100, flippedX false', () => {
    expect(
      calculateSubmenuPosition({
        anchorRect: { left: 100, top: 100, right: 300, bottom: 128 },
        menuWidth: MENU_WIDTH,
        menuHeight: MENU_HEIGHT,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      }),
    ).toEqual({ left: 304, top: 100, flippedX: false });
  });

  test('справа нет места: anchorRect (700, 100, 900, 128) → left 496, flippedX true', () => {
    expect(
      calculateSubmenuPosition({
        anchorRect: { left: 700, top: 100, right: 900, bottom: 128 },
        menuWidth: MENU_WIDTH,
        menuHeight: MENU_HEIGHT,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      }),
    ).toEqual({ left: 496, top: 100, flippedX: true });
  });

  test('по вертикали флипа нет: anchorRect (100, 600, 300, 628) → top 492', () => {
    expect(
      calculateSubmenuPosition({
        anchorRect: { left: 100, top: 600, right: 300, bottom: 628 },
        menuWidth: MENU_WIDTH,
        menuHeight: MENU_HEIGHT,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      }),
    ).toEqual({ left: 304, top: 492, flippedX: false });
  });

  test('не помещается ни сверху, ни снизу: menuHeight 900 → top 8', () => {
    expect(
      calculateSubmenuPosition({
        anchorRect: { left: 100, top: 600, right: 300, bottom: 628 },
        menuWidth: MENU_WIDTH,
        menuHeight: 900,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      }),
    ).toEqual({ left: 304, top: 8, flippedX: false });
  });

  test('справа и слева нет места: menuWidth 990 → left 8, flippedX true', () => {
    expect(
      calculateSubmenuPosition({
        anchorRect: { left: 500, top: 100, right: 700, bottom: 128 },
        menuWidth: 990,
        menuHeight: MENU_HEIGHT,
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
      }),
    ).toEqual({ left: 8, top: 100, flippedX: true });
  });

  test('инвариант: подменю целиком внутри вьюпорта минус padding', () => {
    for (const [menuWidth, menuHeight] of MENU_SIZES) {
      for (const anchorX of GRID_X) {
        for (const anchorY of GRID_Y) {
          const label = `меню ${menuWidth}x${menuHeight}, якорь (${anchorX}, ${anchorY})`;
          const anchorRect = {
            left: anchorX,
            top: anchorY,
            right: anchorX + ANCHOR_WIDTH,
            bottom: anchorY + ANCHOR_HEIGHT,
          };
          const { left, top, flippedX } = calculateSubmenuPosition({
            anchorRect,
            menuWidth,
            menuHeight,
            viewportWidth: VIEWPORT_WIDTH,
            viewportHeight: VIEWPORT_HEIGHT,
          });
          expectContainedAxis(left, menuWidth, VIEWPORT_WIDTH, label);
          expectContainedAxis(top, menuHeight, VIEWPORT_HEIGHT, label);
          // Проверка вписывания продублирована намеренно: без неё ожидание,
          // посчитанное тем же предикатом, было бы тождественным.
          const preferred = anchorRect.right + SUBMENU_OFFSET;
          const rightSideFits = preferred >= PADDING && preferred + menuWidth + PADDING <= VIEWPORT_WIDTH;
          expect(flippedX, `${label}: flippedX разошёлся с правым кандидатом`).toBe(!rightSideFits);
        }
      }
    }
  });
});
