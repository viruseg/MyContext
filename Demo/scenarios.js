/**
 * Наборы меню демонстрационной страницы: по одному на каждый проверяемый случай
 * библиотеки.
 *
 * Данные, а не разметка: пункты не строятся заранее, дерево каждого уровня
 * рендерится лениво при первом показе, поэтому страница держит только описания.
 * Из этого следует и то, что страница не может стать источником тихих поломок
 * отрисовки: единственное, что здесь можно испортить, — сами описания, и их
 * проверяет `tests/e2e/demo.spec.js`.
 *
 * **Действия вешает страница, а не данные.** `Demo/demo.js` обходит дерево
 * (`withItemActions`) и навешивает действие каждому пункту всех уровней, а
 * описания здесь остаются чистыми: новый пункт в описании сразу получает
 * рабочий клик, и журналу кликов не нужно знать, какие пункты есть. Одно
 * исключение вытекает из правила закрытия (спека 5.1, 8): клик по владельцу
 * непустого подменю открывает подменю и своего действия не зовёт, поэтому в
 * журнал такая строка не попадает, и обойти это из демо нечем.
 *
 * **Подменю не содержат разделителей.** Тип `MenuItem.submenu` объявлен как
 * `MenuItem[]`, а не как смешанный массив, и подменю с разделителем потребовало бы
 * либо приведения, либо расширения типа в `src/`, а `src/` — это библиотека и за
 * пределами демо. Разделители стоят в корневых уровнях, где тип списка позволяет
 * их.
 */

/**
 * @typedef {import('../src/renderer.js').MenuItem} MenuItem
 * @typedef {import('../src/renderer.js').SeparatorItem} SeparatorItem
 */

/**
 * Сценарий демонстрационной страницы.
 *
 * @typedef {object} Scenario
 * @property {string} id значение атрибута `data-scenario` у блока сценария.
 *   Один и тот же ключ стоит в `index.html` и здесь, и `Demo/demo.js` отказывается
 *   строить страницу при расхождении.
 * @property {string} title подпись блока и доступное имя меню сценария.
 * @property {Array<MenuItem | SeparatorItem>} items пункты корневого уровня.
 */

/**
 * Разделитель уровня. Функция, а не объявленная константа: разделить два
 * сценария нечем, а переиспользовать один узел между уровнями нельзя, потому что
 * уровни строятся отдельно и каждый получает собственную копию.
 *
 * @returns {SeparatorItem}
 */
function separator() {
  return { type: 'separator' };
}

/**
 * Кадр 1×1 в data-URI: белый список протоколов `src/icons.js` включает
 * `data:image/…`, поэтому такой адрес проверяется без сетевого запроса, а
 * страница не ждёт загрузки. Пиксель сине-серый и непрозрачный на 94 % — иначе
 * иконка в демо выглядела бы пустым слотом, и разница между «иконка есть» и
 * «иконки нет» не читалась бы глазом.
 */
const RASTER_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADklEQVR4nGOwbvr2/h0ACOMDkWRA0jMAAAAASUVORK5CYII=';

/**
 * Метка контраста: рамка с обрезанным углом. Разметка проходит белый список
 * `src/icons.js` целиком — объявленный `xmlns`, разрешённые `path` и `fill`, —
 * поэтому санитайзер не выдаёт предупреждения, а кейс на пустой консоли
 * проверяет именно это.
 */
const CONTRAST_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
  + '<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 2.5V12.5A4.5 4.5 0 0 1 3.5 8 4.5 4.5 0 0 1 8 3.5Z"'
  + ' fill="currentColor" fill-rule="evenodd"/></svg>';

/**
 * Кадр «гаммы»: дуга и точка. Второй вид векторной иконки — один и тот же тип
 * дважды на уровне, иначе проверка «все три типа рядом» не отличила бы его от
 * одиночного вхождения.
 */
const GAMMA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
  + '<path d="M3.5 3v10h9" fill="none" stroke="currentColor" stroke-width="1.5"'
  + ' stroke-linecap="round"/></svg>';

/**
 * Кадр «печати»: рамка с заливкой. Третий — чтобы на уровне `basic` и `mixed`
 * было видно, что иконки разного веса не сдвигают друг друга.
 */
const PRINT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
  + '<path d="M4.5 2.5h7v3h-7zM3 6.5h10a1 1 0 0 1 1 1v5h-3v-2H5v2H2v-5a1 1 0 0 1 1-1Z"'
  + ' fill="currentColor"/></svg>';

/**
 * @returns {Array<MenuItem | SeparatorItem>}
 */
function baseItems() {
  return [
    { label: 'Открыть', icon: { type: 'emoji', value: '📂' } },
    { label: 'Переименовать', icon: { type: 'svg', value: CONTRAST_SVG } },
    { label: 'Свойства' },
    { label: 'Печать', icon: { type: 'svg', value: PRINT_SVG } },
    { label: 'Предпросмотр', icon: { type: 'raster', value: RASTER_PIXEL, alt: 'Кадр' } },
    { label: 'Закладка', icon: { type: 'emoji', value: '🔖' } },
    { label: 'Сжать', icon: { type: 'svg', value: GAMMA_SVG } },
    { label: 'В очередь' },
    separator(),
    { label: 'Удалить' },
  ];
}

/**
 * Шесть сценариев демо. Порядок в массиве — это порядок блоков на странице.
 *
 * @type {Scenario[]}
 */
export const scenarios = [
  {
    id: 'basic',
    title: 'Базовое меню',
    items: baseItems(),
  },
  {
    // Пять уровней в данных, четыре показываются: на глубине 3 и 4 у пункта
    // собственное подменю, цепочка раскрывается целиком, а ветка не кончается
    // листом, поэтому у последнего показанного уровня есть адрес, в который
    // `aria-owns` указывает на ещё не показанный уровень.
    id: 'nested',
    title: 'Вложенность',
    items: [
      { label: 'Обновить', icon: { type: 'emoji', value: '🔄' } },
      {
        label: 'Ветка',
        icon: { type: 'svg', value: CONTRAST_SVG },
        submenu: [
          { label: 'Простой пункт' },
          {
            label: 'Второй уровень',
            icon: { type: 'emoji', value: '2️⃣' },
            submenu: [
              { label: 'Соседняя ветка' },
              {
                label: 'Третий уровень',
                icon: { type: 'svg', value: GAMMA_SVG },
                submenu: [
                  { label: 'Лист' },
                  {
                    label: 'Четвёртый уровень',
                    icon: { type: 'emoji', value: '4️⃣' },
                    submenu: [
                      { label: 'Замыкающий пункт' },
                      { label: 'Соседний лист' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { label: 'Свойства' },
    ],
  },
  {
    // Два отключённых пункта, из них один с непустым подменю. Раскрывать нечего:
    // владельцем подменю пункт не становится, и уровень под него не заводится.
    id: 'disabled',
    title: 'Отключённые пункты',
    items: [
      { label: 'Доступно', icon: { type: 'emoji', value: '✅' } },
      {
        label: 'Отключённый пункт',
        isEnabledAction: () => false,
        icon: { type: 'emoji', value: '🚫' },
      },
      {
        label: 'Отключённый владелец',
        isEnabledAction: () => false,
        submenu: [{ label: 'Под глухим' }, { label: 'Тоже под ним' }],
      },
      separator(),
      {
        label: 'Доступный владелец',
        icon: { type: 'svg', value: CONTRAST_SVG },
        submenu: [{ label: 'Раскрывается' }, { label: 'Тоже раскрывается' }],
      },
      { label: 'Пустое подменю', submenu: [] },
    ],
  },
  {
    // Три типа рядом, и после них пункт без иконки: слот под иконку создаётся
    // всегда, поэтому подпись последнего пункта встаёт на ту же колонку.
    id: 'icons',
    title: 'Иконки',
    items: [
      { label: 'Эмодзи', icon: { type: 'emoji', value: '😀' } },
      { label: 'Вектор', icon: { type: 'svg', value: CONTRAST_SVG } },
      { label: 'Растр', icon: { type: 'raster', value: RASTER_PIXEL, alt: 'Образец' } },
      { label: 'Без иконки' },
      separator(),
      { label: 'Ещё вектор', icon: { type: 'svg', value: GAMMA_SVG } },
      { label: 'Ещё растр', icon: { type: 'raster', value: RASTER_PIXEL, alt: 'Второй образец' } },
    ],
  },
  {
    // 40 пунктов по 28 px (`--vc-item-height`) дают 1120 px содержимого при
    // вьюпорте 1280×800, а рамка `.vc-list` ограничена `max-height` от вьюпорта.
    // Список обязан прокручиваться внутри уровня, а не выталкивать меню за край, и
    // полосы прокрутки у него нет: его листают, наведя курсор на зону у края рамки.
    id: 'long',
    title: 'Длинный список',
    items: Array.from({ length: 40 }, (unused, index) => {
      return { label: `Пункт ${String(index + 1)}` };
    }),
  },
  {
    // Всё вместе: вложенность, отключённый владелец, три типа иконок, разделитель
    // и пустое подменю — то есть всё, что проверяется на других блоках по
    // отдельности, в одном меню.
    id: 'mixed',
    title: 'Всё вместе',
    items: [
      { label: 'Новый', icon: { type: 'emoji', value: '➕' } },
      { label: 'Открыть', icon: { type: 'svg', value: CONTRAST_SVG } },
      { label: 'Без иконки' },
      separator(),
      {
        label: 'Экспорт',
        icon: { type: 'svg', value: PRINT_SVG },
        submenu: [
          { label: 'В PDF', icon: { type: 'raster', value: RASTER_PIXEL, alt: 'Документ' } },
          { label: 'В текст' },
          {
            label: 'В изображение',
            submenu: [{ label: 'PNG' }, { label: 'JPEG' }],
          },
        ],
      },
      {
        label: 'Отключённый владелец',
        isEnabledAction: () => false,
        submenu: [{ label: 'Под глухим' }],
      },
      { label: 'Отключённый пункт', isEnabledAction: () => false },
      separator(),
      {
        label: 'Пустое подменю',
        submenu: [],
      },
      { label: 'Последний' },
    ],
  },
];
