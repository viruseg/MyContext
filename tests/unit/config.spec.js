import { expect, test } from '@playwright/test';
import { MyContext } from '../../src/MyContext.js';

/**
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 */

/**
 * Меню из произвольного значения.
 *
 * Кейсы ниже передают заведомо негодные конфигурации, и подпись параметра у
 * конструктора объявлена `Array<MenuItem | SeparatorItem>`: без приведения
 * TypeScript отверг бы их ещё на этапе проверки, и кейсы проверяли бы не
 * валидацию, а компилятор. Приведение идёт от `unknown` — единственного типа,
 * в который влезает любой аргумент, — и поэтому не скрывает ничего: проверку
 * выполняет конструктор во время выполнения, а не компилятор.
 *
 * @param {unknown} items проверяемая конфигурация.
 * @returns {MyContext}
 */
function menuOf(items) {
  return new MyContext(/** @type {Array<MenuItem | SeparatorItem>} */ (items));
}

/**
 * Заглушка `matchMedia`.
 *
 * Валидация не касается DOM, но конструктор после неё создаёт слой, а слой
 * читает `prefers-reduced-motion` в момент создания. Юнит-проект Playwright
 * выполняется в Node, где `matchMedia` нет, и без заглушки каждый кейс с
 * валидной конфигурацией падал бы на `matchMedia is not a function` — то есть
 * проверял бы не конфигурацию, а наличие глобальной функции. Заглушка отвечает
 * `matches: false`, и значение по контракту слоя всё равно читается в момент
 * закрытия, которого в юнит-кейсах не бывает.
 *
 * @param {string} query текст запроса.
 * @returns {MediaQueryList}
 */
function stubMatchMedia(query) {
  return /** @type {MediaQueryList} */ (/** @type {unknown} */ ({ media: query, matches: false }));
}

test.beforeEach(() => {
  globalThis.matchMedia = stubMatchMedia;
});

test.describe('валидация конфигурации', () => {
  test('пустой массив пунктов отклоняется', () => {
    expect(() => menuOf([])).toThrow(TypeError);
    expect(() => menuOf([])).toThrow('items');
  });

  test('пункты не массив отклоняются', () => {
    expect(() => menuOf('пункты')).toThrow(TypeError);
    expect(() => menuOf(undefined)).toThrow('items');
  });

  test('пункт без строкового label отклоняется', () => {
    expect(() => menuOf([{}])).toThrow('items[0].label');
    expect(() => menuOf([{ label: 7 }])).toThrow('items[0].label');
  });

  test('пункт не объект отклоняется', () => {
    // Элемент без `type` — пункт, а не разделитель, и подпись обязательна у обоих:
    // пустой уровень или уровень из одного безымянного элемента отрисовался бы, но
    // оказался бы недоступен. Строка вместо пункта отклоняется ещё раньше, чем
    // проверка подписи, — и это отдельное правило, а не частный случай первого.
    expect(() => menuOf(['разделитель'])).toThrow('items[0]: пункт должен быть объектом');
    expect(() => menuOf([null])).toThrow('items[0]: пункт должен быть объектом');
  });

  test('пункт с пустым label отклоняется', () => {
    expect(() => menuOf([{ label: '' }])).toThrow('items[0].label');
    // Подпись из одних пробелов не подпись: она читалась бы вслух как пустая,
    // а `trim` — единственная проверка, которая отличает её от осмысленного
    // текста с краями.
    expect(() => menuOf([{ label: '   ' }])).toThrow('items[0].label');
  });

  test('неизвестный тип иконки отклоняется с указанием пути items[2].icon.type', () => {
    const items = [
      { label: 'Первый' },
      { label: 'Второй' },
      { label: 'Третий', icon: { type: 'значок', value: 'x' } },
    ];
    expect(() => menuOf(items)).toThrow(TypeError);
    expect(() => menuOf(items)).toThrow('items[2].icon.type');
  });

  test('action не функция отклоняется', () => {
    expect(() => menuOf([{ label: 'Первый', action: 'нажать' }])).toThrow('items[0].action');
  });

  test('submenu не массив отклоняется', () => {
    expect(() => menuOf([{ label: 'Первый', submenu: { label: 'Вложенный' } }])).toThrow(
      'items[0].submenu',
    );
  });

  test('ошибка во вложенном пункте указывает полный путь items[1].submenu[0].label', () => {
    const items = [
      { label: 'Первый' },
      { label: 'Ветка', submenu: [{ label: 42 }] },
    ];
    expect(() => menuOf(items)).toThrow(TypeError);
    expect(() => menuOf(items)).toThrow('items[1].submenu[0].label');
  });

  test('ошибка во вложенном подменю указывает путь до самой глубокой ветки', () => {
    const items = [
      {
        label: 'Ветка',
        submenu: [{ label: 'Вторая ветка', submenu: [{ label: 'Лист', icon: { type: 'emoji' } }] }],
      },
    ];
    expect(() => menuOf(items)).toThrow('items[0].submenu[0].submenu[0].icon.value');
  });

  test('растр без alt отклоняется', () => {
    const withoutAlt = { label: 'Картинка', icon: { type: 'raster', value: 'https://example.com/a.png' } };
    expect(() => menuOf([withoutAlt])).toThrow('items[0].icon.alt');
    // Пустой `alt` хуже отсутствующего: он выглядит как решение автора, а
    // скринридер читает его как имя картинки без содержимого.
    expect(() => menuOf([{ label: 'Картинка', icon: { type: 'raster', value: 'a.png', alt: '' } }]))
      .toThrow('items[0].icon.alt');
    expect(() => menuOf([{ label: 'Картинка', icon: { type: 'raster', value: 'a.png', alt: '  ' } }]))
      .toThrow('items[0].icon.alt');
  });

  test('растр без value отклоняется', () => {
    // Расширение сверх брифа, и вот почему. Без `value` рендерер отдаёт
    // `isSafeRasterUrl(undefined)`, тот разбирает `undefined` как адрес текущей
    // страницы, проходит проверку схемы и пишет в `src` строку `undefined`:
    // картинка не рисуется, а запрос уходит за адресом, которого нет.
    expect(() => menuOf([{ label: 'Картинка', icon: { type: 'raster', alt: 'Файл' } }]))
      .toThrow('items[0].icon.value');
  });

  test('иконка emoji и svg без value отклоняются', () => {
    expect(() => menuOf([{ label: 'Первый', icon: { type: 'emoji' } }])).toThrow('items[0].icon.value');
    expect(() => menuOf([{ label: 'Первый', icon: { type: 'svg', value: '' } }]))
      .toThrow('items[0].icon.value');
  });

  test('разделитель без type отклоняется', () => {
    // Кейс про разделитель, чей тип отличается от `separator`. Проверяется не
    // «есть ли `type`», а «если поле объявлено, то это ровно `separator`»:
    // без такой проверки опечатка автора тихо стала бы пунктом без подписи,
    // и меню показало бы пустую строку вместо разделителя. Соблазн считать
    // `type: 'divider'` разделителем отпадает по одной причине: значение
    // пришлось бы угадывать, а лишнее поле в пункте уже означает ошибку.
    expect(() => menuOf([{ type: 'divider', label: 'Разделитель' }])).toThrow(TypeError);
    expect(() => menuOf([{ type: 'divider', label: 'Разделитель' }])).toThrow('items[0].type');
  });

  test('пустое подменю проходит валидацию как массив', () => {
    // Обязательство из ревью: `submenu: []` — не владелец, но ошибка конфигурации
    // это не ошибка. Владельцем его делает рендерер (непустой массив), и
    // проверка непустоты здесь была бы вторым мнением об одном и том же.
    expect(() => menuOf([{ label: 'Пункт', submenu: [] }])).not.toThrow();
  });

  test('валидная конфигурация принимается', () => {
    /** @type {Array<MenuItem | SeparatorItem>} */
    const items = [
      {
        id: 'new',
        label: 'Создать',
        icon: { type: 'emoji', value: '📄' },
        action: () => {},
        submenu: [
          { label: 'Документ', action: () => {} },
          { label: 'Папку', disabled: true },
        ],
      },
      { type: 'separator' },
      {
        label: 'Значок',
        icon: {
          type: 'svg',
          value: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>',
        },
      },
      { label: 'Картинка', icon: { type: 'raster', value: 'https://example.com/a.png', alt: 'Файл' } },
      { label: 'Без иконки и действия' },
    ];
    expect(() => new MyContext(items, { theme: 'dark', animationDuration: 120, label: 'Файл' }))
      .not.toThrow();
    expect(() => new MyContext(items)).not.toThrow();
  });
});
