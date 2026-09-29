import { expect, test } from '@playwright/test';
import { MyContext } from '../../src/MyContext.js';

/**
 * @typedef {import('../../src/MyContext.js').MenuItem} MenuItem
 * @typedef {import('../../src/MyContext.js').SeparatorItem} SeparatorItem
 * @typedef {import('../../src/MyContext.js').MyContextOptions} MyContextOptions
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
 * Меню с проверяемыми опциями и заведомо годным составом.
 *
 * @param {unknown} options проверяемый блок опций.
 * @returns {MyContext}
 */
function menuWithOptions(options) {
  return new MyContext([{ labelAction: () => 'Пункт' }], /** @type {MyContextOptions} */ (options));
}

/**
 * Заглушка `matchMedia`.
 *
 * Валидация не касается DOM, но конструктор после неё читает
 * `prefers-reduced-motion` сам — ради решения о пропуске отложенности показа — и
 * создаёт слой, который читает его же при закрытии. Юнит-проект Playwright
 * выполняется в Node, где `matchMedia` нет, и без заглушки каждый кейс с
 * валидной конфигурацией падал бы на `matchMedia is not a function` — то есть
 * проверял бы не конфигурацию, а наличие глобальной функции. Заглушка отвечает
 * `matches: false`, и оба читающих по контракту берут значение в момент своего
 * решения — закрытия или переоткрытия, — которых в юнит-кейсах не бывает.
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

test.describe('валидация корневого состава', () => {
  test('пустой массив пунктов отклоняется', () => {
    expect(() => menuOf([])).toThrow(TypeError);
    expect(() => menuOf([])).toThrow('items');
  });

  test('пункты не массив отклоняются', () => {
    expect(() => menuOf('пункты')).toThrow(TypeError);
    expect(() => menuOf(undefined)).toThrow('items');
  });

  test('пункт не объект отклоняется', () => {
    // Строка вместо пункта отклоняется раньше, чем проверка полей, — и это
    // отдельное правило, а не частный случай первого.
    expect(() => menuOf(['разделитель'])).toThrow('items[0]: пункт должен быть объектом');
    expect(() => menuOf([null])).toThrow('items[0]: пункт должен быть объектом');
  });

  test('пункт без labelAction отклоняется', () => {
    expect(() => menuOf([{}])).toThrow('items[0].labelAction');
    expect(() => menuOf([{ labelAction: 'подпись' }])).toThrow('items[0].labelAction');
  });

  test('действия пункта не функция отклоняются', () => {
    // Проверяется форма поля, а не результат: результат предъявляет действие, и
    // проверяется он на показе. Здесь ловится только опечатка автора — поле,
    // которое на месте, но не тем, чем объявлено.
    expect(() => menuOf([{ labelAction: () => 'Первый', iconAction: '📄' }]))
      .toThrow('items[0].iconAction');
    expect(() => menuOf([{ labelAction: () => 'Первый', submenuAction: [] }]))
      .toThrow('items[0].submenuAction');
    expect(() => menuOf([{ labelAction: () => 'Первый', action: 'нажать' }]))
      .toThrow('items[0].action');
    expect(() => menuOf([{ labelAction: () => 'Первый', isEnabledAction: 'да' }]))
      .toThrow('items[0].isEnabledAction');
  });

  test('version не число отклоняется', () => {
    expect(() => menuOf([{ labelAction: () => 'Первый', version: '2' }])).toThrow('items[0].version');
    expect(() => menuOf([{ labelAction: () => 'Первый', version: Number.NaN }]))
      .toThrow('items[0].version');
  });

  test('ушедшие поля отклоняются с указанием замены', () => {
    // Отклоняются, а не игнорируются. Иначе оставленное автором `label` молча
    // убрало бы подпись, `submenu` — подменю, а `disabled: true` сделало бы пункт
    // активным, и каждая из ошибок вылезла бы там, где её не ждут. Тот же довод,
    // что и у `type` у разделителя.
    // Массив намеренно не типизирован как `MenuItem[]`: поля у него ушедшие из
    // контракта, и именно их отсутствие в типе проверяется. Тип `unknown[]`
    // снимает проверку лишних полей на самом литерале, а не отодвигает её.
    /** @type {unknown[]} */
    const withRemovedFields = [
      { label: 'Первый', labelAction: () => 'Первый' },
      { labelAction: () => 'Первый', icon: { type: 'emoji', value: 'x' } },
      { labelAction: () => 'Первый', submenu: [] },
      { labelAction: () => 'Первый', disabled: true },
    ];
    expect(() => menuOf([withRemovedFields[0]])).toThrow('items[0].label');
    expect(() => menuOf([withRemovedFields[1]])).toThrow('items[0].icon');
    expect(() => menuOf([withRemovedFields[2]])).toThrow('items[0].submenu');
    expect(() => menuOf([withRemovedFields[3]])).toThrow('items[0].disabled');
  });

  test('разделитель без type отклоняется', () => {
    // Проверяется не «есть ли `type`», а «если поле объявлено, то это ровно
    // `separator`»: без такой проверки опечатка автора тихо стала бы пунктом без
    // подписи, и меню показало бы пустую строку вместо разделителя.
    expect(() => menuOf([{ type: 'divider', labelAction: () => 'Разделитель' }])).toThrow(TypeError);
    expect(() => menuOf([{ type: 'divider', labelAction: () => 'Разделитель' }]))
      .toThrow('items[0].type');
  });

  test('валидная конфигурация принимается', () => {
    /** @type {Array<MenuItem | SeparatorItem>} */
    const items = [
      {
        id: 'new',
        labelAction: () => 'Создать',
        iconAction: () => ({ type: 'emoji', value: '📄' }),
        action: () => {},
        isEnabledAction: () => false,
        submenuAction: () => [
          { labelAction: () => 'Документ', action: () => {} },
          { labelAction: () => 'Папку', isEnabledAction: () => false },
        ],
        version: 2,
      },
      { type: 'separator' },
      {
        labelAction: () => 'Значок',
        iconAction: () => ({
          type: 'svg',
          value: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>',
        }),
      },
      {
        labelAction: () => 'Картинка',
        iconAction: () => ({ type: 'raster', value: 'https://example.com/a.png', alt: 'Файл' }),
      },
      { labelAction: () => 'Без иконки и действия' },
    ];
    expect(() => new MyContext(items, { theme: 'dark', animationDuration: 120, label: 'Файл' }))
      .not.toThrow();
    expect(() => new MyContext(items)).not.toThrow();
  });

  test('подменю конструктором не проверяется: его предъявляет submenuAction', () => {
    // Проверять нечего: до показа подменю не существует, а на показе его проверяет
    // рендерер, и путь до поля тогда называет уровень и позицию пункта. Здесь
    // важно только, что негодное подменю не роняет конструктор: ошибка придёт
    // из `open()` и укажет, что именно не так.
    expect(() => menuOf([{ labelAction: () => 'Ветка', submenuAction: () => 'не массив' }]))
      .not.toThrow();
    expect(() => menuOf([{ labelAction: () => 'Пункт', submenuAction: () => [] }])).not.toThrow();
  });
});

test.describe('валидация опции autoHideDistance', () => {
  test('не число отклоняется', () => {
    // Правило проверки то же, что у `animationDuration`, и по той же причине:
    // `NaN` в сравнении с числом всегда `false`, то есть правило молча
    // превратилось бы в «меню не скрывается никогда», и негодная опция
    // выдавала бы себя за выключенную — худший из ответов, потому что автор
    // задал её вовсе не для того.
    expect(() => menuWithOptions({ autoHideDistance: '100' })).toThrow(TypeError);
    expect(() => menuWithOptions({ autoHideDistance: '100' })).toThrow('options.autoHideDistance');
    expect(() => menuWithOptions({ autoHideDistance: Number.NaN })).toThrow('options.autoHideDistance');
    expect(() => menuWithOptions({ autoHideDistance: Number.POSITIVE_INFINITY }))
      .toThrow('options.autoHideDistance');
  });

  test('отрицательное расстояние отклоняется', () => {
    // Отрицательный порог не имеет прочтения: расстояние до меню неотрицательно,
    // и правило «превысил порог» при таком пороге срабатывало бы в самом меню —
    // то есть закрывало бы его в момент открытия. Отвергнуть значение честнее,
    // чем трактовать его как «выключено».
    expect(() => menuWithOptions({ autoHideDistance: -1 })).toThrow('options.autoHideDistance');
  });

  test('ноль и положительное расстояние принимаются', () => {
    // Ноль — это выключенное автоскрытие, а не его отсутствие: опция объявлена
    // всегда, и автор может задать её нулём явно, не отличая этого от «не задал».
    expect(() => menuWithOptions({ autoHideDistance: 0 })).not.toThrow();
    expect(() => menuWithOptions({ autoHideDistance: 120 })).not.toThrow();
    expect(() => menuWithOptions({ autoHideDistance: 0.5 })).not.toThrow();
  });
});
