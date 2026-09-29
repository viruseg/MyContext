import { expect, test } from '@playwright/test';
import { nearestRectDistance } from '../../src/geometry.js';

/**
 * @typedef {import('../../src/geometry.js').Point} Point
 * @typedef {import('../../src/geometry.js').Rect} Rect
 */

/**
 * Прямоугольник из левого верхнего угла и размеров — форма, в которой приходят
 * `getBoundingClientRect` и результаты проб. `right` и `bottom` в неё не входят:
 * рамка выводится из них, и зашивать бы их отдельно значило бы разрешить
 * противоречивую рамку в контракте.
 *
 * @param {number} left
 * @param {number} top
 * @param {number} width
 * @param {number} height
 * @returns {Rect}
 */
function rectOf(left, top, width, height) {
  return { left, top, width, height };
}

test.describe('расстояние до одного прямоугольника', () => {
  test('точка внутри рамки даёт ноль', () => {
    const rect = rectOf(100, 100, 200, 80);
    expect(nearestRectDistance({ x: 100, y: 100 }, [rect])).toBe(0);
    expect(nearestRectDistance({ x: 300, y: 180 }, [rect])).toBe(0);
    expect(nearestRectDistance({ x: 200, y: 140 }, [rect])).toBe(0);
  });

  test('смещение отсчитывается от края, а не от центра', () => {
    // Рамка 100..300 по X, расстояние считается от 300, а не от 200: точка 340
    // вне её на 40. Отсчёт от центра дал бы 140, и порог в 100 закрыл бы меню
    // там, где по договорённости должен остаться.
    const rect = rectOf(100, 100, 200, 80);
    expect(nearestRectDistance({ x: 340, y: 140 }, [rect])).toBe(40);
    expect(nearestRectDistance({ x: 60, y: 140 }, [rect])).toBe(40);
    expect(nearestRectDistance({ x: 200, y: 100 - 25 }, [rect])).toBe(25);
    expect(nearestRectDistance({ x: 200, y: 180 + 25 }, [rect])).toBe(25);
  });

  test('за углом считается евклидово расстояние до угла', () => {
    // Диагональ — не сумма отступов и не максимум из них: точка 40 направо и 30
    // вниз от угла лежит в 50 от него, потому что 3-4-5.
    const rect = rectOf(100, 100, 200, 80);
    expect(nearestRectDistance({ x: 340, y: 210 }, [rect])).toBe(50);
  });

  test('диагональ без угла равна большему из отступов', () => {
    // Ни по X, ни по Y рамка не проекциями не накрывает точку, но по одной оси
    // точка всё же в её пределах — там расстояние по этой оси нулевое, и остаётся
    // вторая.
    const rect = rectOf(100, 100, 200, 80);
    expect(nearestRectDistance({ x: 340, y: 130 }, [rect])).toBe(40);
    expect(nearestRectDistance({ x: 160, y: 230 }, [rect])).toBe(50);
  });

  test('вырожденная рамка считается отрезком, а не точкой', () => {
    // Уровень нулевой высоты бывает у списка без единой строки, и относиться к
    // нему как к точке нельзя: расстояние до края тогда считалось бы в корне.
    const rect = rectOf(100, 100, 200, 0);
    expect(nearestRectDistance({ x: 300, y: 110 }, [rect])).toBe(10);
  });
});

test.describe('расстояние до цепочки прямоугольников', () => {
  test('берётся ближайший из прямоугольников', () => {
    const root = rectOf(100, 100, 200, 80);
    const submenu = rectOf(320, 100, 160, 200);
    // Подменю кончается по Y на 300, и точка на 100 ниже него; до корня же
    // сверху 220 и справа 80, то есть 234. Решение принимает подменю.
    expect(nearestRectDistance({ x: 380, y: 400 }, [root, submenu])).toBe(100);
  });

  test('зазор между уровнями меряется от обеих рамок', () => {
    // Корень кончается на 300, подменю начинается на 320, то есть между ними
    // двадцать пикселей пустоты. Точка в зазоре — на 10 от корня и на 10 от
    // подменю, и ни одна из рамок её не содержит. Считать расстояние до
    // объединённой рамки нельзя: тогда зазор выглядел бы как часть меню.
    const root = rectOf(100, 100, 200, 80);
    const submenu = rectOf(320, 100, 160, 200);
    expect(nearestRectDistance({ x: 310, y: 140 }, [root, submenu])).toBe(10);
  });

  test('порядок прямоугольников не влияет на ответ', () => {
    const first = rectOf(100, 100, 200, 80);
    const second = rectOf(320, 100, 160, 200);
    expect(nearestRectDistance({ x: 380, y: 400 }, [first, second])).toBe(
      nearestRectDistance({ x: 380, y: 400 }, [second, first]),
    );
  });

  test('пустая цепочка даёт бесконечность', () => {
    // Меню закрыто, а «расстояние до закрытого» — не число, а бесконечность:
    // иначе ноль уровней читался бы как «курсор ровно на месте», и порог
    // сравнивался бы с выдуманным нулём. Вызывающий код пустую цепочку отдельно
    // не проверяет, и бесконечность гасит проверку сама.
    expect(nearestRectDistance({ x: 10, y: 10 }, [])).toBe(Number.POSITIVE_INFINITY);
  });
});
