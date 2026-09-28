# Зоны прокрутки вместо системной полосы — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать узкий системный скроллбар у длинного списка меню и заменить его двумя закреплёнными зонами — верхней и нижней, — которые при наведении непрерывно прокручивают список к своему краю и гаснут, когда упор достигнут.

**Architecture:** Четыре независимых механизма меняются по отдельности и потому вынесены в отдельные задачи. Первый — разметка: `renderLevel` строит обе зоны как соседей `.vc-list` и отдаёт их слою вместе с элементом и пунктами. Второй — оформление: токен высоты, правила показа по атрибуту уровня, глиф на рамках, скрытие системной полосы. Третий — новый модуль `src/scrollZones.js`: единственный владелец признака прокручиваемости и направления прокрутки, с шагом по `requestAnimationFrame` и тремя причинами остановиться. Четвёртый — слой и оркестратор: слой решает, прокручиваем ли уровень, до единственного замера геометрии, а оркестратор снимает выделение пункта, когда курсор ушёл в зону.

**Tech Stack:** Чистые ES-модули, ES2026, Popover API и Top Layer, `@starting-style`, `transition-behavior: allow-discrete`, `color-mix()`, `scrollbar-width`, `requestAnimationFrame`, `toggleAttribute`. Без рантайм-зависимостей. Тесты — только Playwright: `npm test`, `npm run test:unit`, `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-09-28-menu-scroll-zones-design.md`. План не спорит со спекой, но один её пункт исполняется не буквально: §6.3 говорит, что контроллер хранится «в `createLayer` рядом с `levels` и `pendingHides`», а достучаться до него из `present`, `hide` и `destroy` удобнее одним локальным хелпером `zonesOf(entry)` с проверкой на `undefined`. Смысл хранения в `createLayer`, а не в `LevelEntry`, спека не меняет.

## Global Constraints

- Ответы пользователю, комментарии и JSDoc — на русском. Имена идентификаторов, сигнатуры и значения — как есть, латиницей.
- Никаких новых рантайм-зависимостей. `package.json` остаётся с пустым отсутствующим полем `dependencies`.
- Порядок разделов `styles/mycontext.css` обязателен: 1) токены, 2) темы, 3) каркас, 4) пункты, 5) анимации. Зоны — часть каркаса, поэтому их правила идут в разделе 3 сразу после `.vc-list`, а `--vc-scroll-zone-height` — в разделе 1 после `--vc-item-height`. Строка «Геометрические токены обязаны совпадать с константами `src/constants.js`» в шапке файла дополняется парой `--vc-scroll-zone-height` ↔ `SCROLL_ZONE_HEIGHT`.
- `--vc-scroll-zone-height: 16px` ↔ `SCROLL_ZONE_HEIGHT = 16`. Расхождение видно глазом, поэтому совпадение проверяется e2e-тестом, как и остальные токены.
- `--vc-scrollbar-thumb` удаляется из всех трёх палитр вместе со своим объяснением; `scrollbar-color` и `scrollbar-width: thin` уходят из `.vc-list`; `::-webkit-scrollbar` не добавляется.
- `.vc-list` получает `scrollbar-width: none` и **не** получает `overflow: hidden`: touch-скролл на телефоне обязан остаться в своём родном виде, и гасить его нельзя.
- Типы строгие. Два новых контракта, пересекающих границу модуля, объявляются `@typedef` в `src/renderer.js` и `src/scrollZones.js` и импортируются по `import('./…js').Имя`, а не через `any`.
- `npm run typecheck` обязан проходить после каждой задачи, меняющей `src/` или `Demo/`.
- `data-vc-scrollable` решается ровно один раз на показ, в `present`, и нигде больше не вычисляется. `refresh()` снимает атрибут, читает переполнение без зон и возвращает признак обратно, поэтому между двумя показами одного уровня настройки вьюпорта накопленного состояния не оставляют.
- Слушатель `scroll` вешается прямо на `.vc-list`, а не делегируется уровню: `scroll` не всплывает, делегат на уровне его не увидит.
- `sync()` — единственный писатель `data-vc-blocked`. Никто больше этот атрибут не ставит и не снимает.
- Три причины остановиться реализуются буквально: упор (`scrollTop` не изменился за кадр), уход курсора (`pointerleave`), внешняя команда (`stop` из `hide`, `destroy` при уничтожении слоя).
- Публичной опции скорости и опции отключения зон нет: `speed` — поле контракта для стенда, `prefers-reduced-motion` автоскролл не гасит.
- `tests/e2e/renderer.spec.js:1113` утверждает `children: 1` с комментарием «внутри уровня — только список». После Task 1 там `children: 3`, и комментарий переписывается: ломающее утверждение должно быть названо в плане, а не найдено прогоном.
- Все новые e2e-кейсы работают под `prefers-reduced-motion: reduce` (как `mountLiveMenu` в `theme.spec.js`) либо с ручными часами rAF, подставленными в `createScrollZones`, — иначе хелпер «снимок в том же `evaluate`, что и вызов» перестанет работать.

## Review Focus

Пять входов, которые спека подразумевает, но ни одна задача не проверяет своими тестами. Каждому соответствует шаг в задаче, которой он принадлежит.

1. **Устаревший `data-vc-scrollable` между двумя показами одного уровня.** Меню показали длинным, вьюпорт вырос, меню закрылось, его открыли снова — зон быть уже не должно, а атрибут без `refresh()` остался бы. `resize` закрывает меню, но открыть его после resize можно, и именно этот путь проверяется. Проверяется в Task 4.
2. **`End` на последнем пункте должен гасить нижнюю зону.** Клавиатурная долистка идёт через `scrollIntoView`, то есть через тот же `scroll`, на который подписан `sync`, — но если подписка когда-нибудь потеряется, зоны уедут в состояние, которого у списка уже нет. Проверяется в Task 5.
3. **`Escape` посреди автоскролла.** Меню закрывается, `hideAll` зовёт `stop`, и цикл обязан встать, а не продолжить крутить `scrollTop` у скрытого уровня. Проверяется в Task 5.
4. **Два длинных меню на одной странице.** У каждого уровня своя пара зон и свой контроллер, но атрибут `data-vc-scrollable` общий для всех `.vc-menu`, а курсор один; наведение на зону одного меню не должно двигать список другого. Проверяется в Task 5.
5. **Колесо над самой зоной.** Зона не прокручивается, поэтому колесо над ней обязано вести себя как колесо над фоном: прокрутить страницу и закрыть меню. Если когда-нибудь сделать зону прокручиваемой ради удобства, меню перестанет закрываться, и это должен поймать тест, а не пользователь. Проверяется в Task 5.

---

### Task 1: Разметка — `renderLevel` строит обе зоны

Зоны создаются всегда, в том числе у короткого списка, где их не видно: показывать их должен слой, и место для этого решения — один атрибут, а не разная разметка. Обе зоны получают `aria-hidden="true"` и не имеют `tabindex`: курсор через них проходит, а фокус и чтение с экрана — нет.

**Files:**
- Modify: `src/renderer.js` (`renderLevel`, `@typedef RenderedLevel`)
- Test: `tests/e2e/renderer.spec.js` (исправить `children: 1` в кейсе `меню получает role=menu и aria-label из контекста`, добавить кейс про зоны)

**Interfaces:**
- Consumes: ничего, задача самодостаточна.
- Produces: экспортируемый `@typedef {object} ScrollZoneNodes` в `src/renderer.js` с полями `list: HTMLElement` («прокручиваемый список уровня»), `up: HTMLElement` («верхняя зона») и `down: HTMLElement` («нижняя зона»). У `RenderedLevel` появляется поле `scroll: ScrollZoneNodes` — «узлы прокрутки уровня; слой создаёт по ним контроллер, поэтому разметка отдаётся явно, а не ищется селектором». `renderLevel` начинает возвращать `{ element, items: rendered, scroll: { list, up, down } }`.

- [ ] **Step 1: Починить сломанное утверждение и написать падающий кейс про зоны**

В `tests/e2e/renderer.spec.js` в кейсе `меню получает role=menu и aria-label из контекста` (строка 1069) ожидание `children: 1` заменить на `children: 3`, а комментарий `// Внутри уровня — только список: всё остальное строится при открытии.` — на `// Внутри уровня — зоны и список. Зоны строятся всегда, в том числе у короткого` / `// списка: показывает их слой, и место для этого решения — один атрибут,` / `// а не разная разметка.`

В тот же `describe` добавить кейс `зоны прокрутки: обе зоны — соседи списка и недоступны с клавиатуры`:

```js
const result = await page.evaluate(async (levelItems) => {
  const { renderLevel } = await import('../../src/renderer.js');
  const level = renderLevel(levelItems, {
    levelIndex: 0,
    menuId: 'vc-level-0',
    actions: new Map(),
  });
  const read = (selector) => {
    const zone = level.element.querySelector(selector);
    if (zone === null) {
      throw new Error(`у уровня нет узла ${selector}`);
    }
    return {
      className: zone.className,
      ariaHidden: zone.getAttribute('aria-hidden'),
      tabIndex: zone.getAttribute('tabindex'),
      // Порядок детей — это контракт: зоны обязаны стоять по краям списка, и
      // слой их потом кликает, полагаясь ровно на это расположение.
      position: Array.from(level.element.children).indexOf(zone),
    };
  };
  const list = /** @type {HTMLElement} */ (level.element.querySelector('.vc-list'));
  return {
    up: read('.vc-scroll-zone-up'),
    down: read('.vc-scroll-zone-down'),
    listPosition: Array.from(level.element.children).indexOf(list),
    // Зоны не скроллятся и не перехватывают фокус: у них нет ни своей роли,
    // ни вкладки, а курсор по ним всё равно проходит.
    listTabIndex: list.getAttribute('tabindex'),
  };
}, FIXTURE_ITEMS);
```

Ожидание:

```js
expect(result).toEqual({
  up: { className: 'vc-scroll-zone vc-scroll-zone-up', ariaHidden: 'true', tabIndex: null, position: 0 },
  down: { className: 'vc-scroll-zone vc-scroll-zone-down', ariaHidden: 'true', tabIndex: null, position: 2 },
  listPosition: 1,
  listTabIndex: null,
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium renderer.spec.js -g "role=menu|зоны прокрутки"`
Expected: FAIL — `level.element.querySelector('.vc-scroll-zone-up')` бросает `у уровня нет узла .vc-scroll-zone-up`, а `children` равно 1, а не 3.

- [ ] **Step 3: Построить зоны в `src/renderer.js`**

В `@typedef`-блок файла рядом с `RenderedLevel` добавить экспортируемый `ScrollZoneNodes` с JSDoc из блока **Interfaces** и по одному абзацу на поле.

Над `renderLevel` добавить фабрику:

```js
/**
 * Зона прокрутки. `aria-hidden` и отсутствие `tabindex` — контракт доступности:
 * курсор через зону проходит, а фокус и чтение с экрана — нет, иначе ровно на
 * прокручиваемом уровне в кольцо роуминга попал бы элемент без содержимого.
 *
 * @param {'up' | 'down'} edge сторона списка, у которой зона стоит.
 * @returns {HTMLElement}
 */
function renderScrollZone(edge) {
  const zone = document.createElement('div');
  zone.className = `vc-scroll-zone vc-scroll-zone-${edge}`;
  zone.setAttribute('aria-hidden', 'true');
  return zone;
}
```

В `renderLevel` перед созданием `.vc-list` вставить `const up = renderScrollZone('up'); element.appendChild(up);`, а после `element.appendChild(list)` — `const down = renderScrollZone('down'); element.appendChild(down);`. `return` заменить на:

```js
return { element, items: rendered, scroll: { list, up, down } };
```

- [ ] **Step 4: Прогнать рендерер целиком**

Run: `npx playwright test --project=chromium renderer.spec.js`
Expected: PASS.

- [ ] **Step 5: Типы и коммит**

Run: `npm run typecheck` — Expected: без ошибок.

```bash
git add src/renderer.js tests/e2e/renderer.spec.js
git commit -m "feat: уровень строится с двумя зонами прокрутки по краям списка"
```

---

### Task 2: Оформление — токен, правила зон, скрытие системной полосы

Задача держится на разметке Task 1 и проверяет только CSS: она сама ставит `data-vc-scrollable` руками, потому что решать его — работа слоя, а не стилей. Скорость зоны при этом не подставляется: `.vc-scroll-zone` тянет высоту из `flex: none` и `height`, потому что в flex-колонке уровня иначе растянулась бы.

**Files:**
- Modify: `src/constants.js` (добавить `SCROLL_ZONE_HEIGHT`)
- Modify: `styles/mycontext.css` (раздел 1, раздел 2 в трёх палитрах, раздел 3)
- Test: `tests/e2e/theme.spec.js` (переписать кейс `у прокручиваемого списка узкий скролбар` на два новых)

**Interfaces:**
- Consumes: `ScrollZoneNodes` и классы `vc-scroll-zone`, `vc-scroll-zone-up`, `vc-scroll-zone-down` из Task 1.
- Produces: `export const SCROLL_ZONE_HEIGHT = 16;` в `src/constants.js` с JSDoc «высота зоны прокрутки, px. Зеркалит `--vc-scroll-zone-height` в `styles/mycontext.css`; расхождение видно глазом, поэтому совпадение проверяется e2e-тестом».

- [ ] **Step 1: Написать два падающих кейса вместо кейса про узкий скроллбар**

В `tests/e2e/theme.spec.js` удалить константу `SCROLLBAR_THUMB` (строки 51–53) вместе с её JSDoc. На её место поставить:

```js
/**
 * Цвет заблокированной зоны, ровно как он записан в каркасе.
 *
 * Отдельный `color-mix`, а не `--vc-muted` целиком: зона, до которой не до
 * доскроллить, обязана читаться как недоступная, а не как доступная и не
 * наведённая.
 */
const BLOCKED_ZONE_COLOR = 'color-mix(in srgb, var(--vc-muted) 40%, transparent)';
```

Заменить кейс `у прокручиваемого списка узкий скролбар` (строка 954) на `у прокручиваемого списка системной полосы нет`. Он читает `STYLESHEET_PATH` и живое меню из `mountLiveMenu`/`openLiveMenu` (40 пунктов, как сейчас):

- по тексту таблицы стилей: `expect(css).not.toContain('--vc-scrollbar-thumb')`, `expect(css).not.toContain('scrollbar-color')`, `expect(css).not.toContain('::-webkit-scrollbar')`;
- по блоку `.vc-list` (`readBlock(css, '.vc-list')`): содержит `scrollbar-width: none` и **не** содержит `overflow: hidden`;
- по живому уровню: `level.getAttribute('data-vc-scrollable')` равен `null` до решения слоя, а `getComputedStyle(list).scrollbarWidth` равен `'none'`.

Второй кейс `зоны прокрутки: атрибут включает обе зоны, высота равна токену, глиф нарисован рамками` проверяет:

- по таблице стилей, в цикле `THEME_SELECTORS`: блок `.vc-scroll-zone` содержит `flex: none`, `height: var(--vc-scroll-zone-height)` и `display: none`; правило `.vc-menu[data-vc-scrollable] .vc-scroll-zone` содержит `display: flex`; `.vc-scroll-zone[data-vc-blocked]` содержит `BLOCKED_ZONE_COLOR`; `.vc-scroll-zone:not([data-vc-blocked]):hover` содержит `background: var(--vc-hover-bg)` и `color: var(--vc-text)`; токен `--vc-scroll-zone-height: 16px` есть в разделе 1; в правилах `.vc-scroll-zone-up::before` и `.vc-scroll-zone-down::before` есть `border-right: 1.5px solid currentColor` и `border-bottom: 1.5px solid currentColor`, а повороты равны `rotate(-90deg)` и `rotate(45deg)` соответственно;
- по живому меню из `mountLiveMenu`/`openLiveMenu` с 40 пунктами: снятие `data-vc-scrollable` даёт `display: none` и нулевую высоту у обеих зон, а его установка — `display: flex` и высоту ровно `SCROLL_ZONE_HEIGHT` у обеих. Перед замером кейс сам ставит атрибут на уровень, потому что решает его слой, а не стили.

Импортировать `SCROLL_ZONE_HEIGHT` в начало списка импортов файла.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium theme.spec.js -g "системной полосы нет|зоны прокрутки"`
Expected: FAIL — в таблице стилей ещё есть `--vc-scrollbar-thumb` и `scrollbar-color`, а `.vc-list` всё ещё объявляет `scrollbar-width: thin`.

- [ ] **Step 3: Добавить `SCROLL_ZONE_HEIGHT` в `src/constants.js`**

Рядом с `DEFAULT_ITEM_HEIGHT` добавить константу из блока **Interfaces**. В JSDoc над блоком констант, если он перечисляет величины, дописать её в перечень.

- [ ] **Step 4: Переписать раздел 3 таблицы стилей**

В `.vc-list` удалить `scrollbar-width: thin` и `scrollbar-color: var(--vc-scrollbar-thumb) transparent`, добавить `scrollbar-width: none` и переписать комментарий над ними. Прежний комментарий оправдывал узкую полосу и рассказывал про бегунок; новый обязан сказать, зачем полосы нет: полоса отнимала у колонки лейбла каждый свой пиксель, а зоны Task 1–4 дали то же самое видимыми средствами. `overflow-y: auto` и `overflow-x: hidden` остаются как есть — touch-скролл живёт именно в них.

Сразу после блока `.vc-list` вставить блок зон:

```css
/* Зоны прокрутки. Обе создаются всегда, в том числе у короткого списка, и
 * показывает их `data-vc-scrollable` на уровне: показывать по одной разметке
 * в двух случаях значило бы завести в слое второе условие показа, а состояние
 * у зон одно — показывать или нет.
 *
 * `flex: none` обязателен: в flex-колонке уровня зона иначе растянулась бы на
 * остаток высоты, и упор «конец списка» перестал бы означать конец. */
.vc-scroll-zone {
  display: none;
  flex: none;
  align-items: center;
  justify-content: center;
  height: var(--vc-scroll-zone-height);
  color: var(--vc-muted);
}

/* Атрибут ставит слой в `present`, один раз на показ, и только там. */
.vc-menu[data-vc-scrollable] .vc-scroll-zone {
  display: flex;
}

/* Дошли до края: зона остаётся на месте и гаснет, а не исчезает, — исчезновение
 * сдвинуло бы список под курсором ровно в тот момент, когда он перестаёт им
 * двигаться. */
.vc-scroll-zone[data-vc-blocked] {
  color: color-mix(in srgb, var(--vc-muted) 40%, transparent);
}

/* Подсветка только у зоны, до которой есть куда идти: иначе наведение на упор
 * выглядело бы обещанием, которое меню не сдержит. */
.vc-scroll-zone:not([data-vc-blocked]):hover {
  background: var(--vc-hover-bg);
  color: var(--vc-text);
}

/* Глиф — тот же срезанный угол, что у шеврона, и по той же причине: две
 * соседние стороны рамки вместо готовой картинки, чтобы зона переезжала вместе
 * с цветом текста. Поворот на 45° даёт угол, смотрящий вниз, на −90° — вверх. */
.vc-scroll-zone::before {
  content: '';
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
}

.vc-scroll-zone-up::before {
  transform: rotate(-90deg);
}

.vc-scroll-zone-down::before {
  transform: rotate(45deg);
}
```

- [ ] **Step 5: Убрать `--vc-scrollbar-thumb` из токенов и обновить шапку файла**

Удалить объявление из трёх палитр (строки 51, 80, 93) вместе с пояснением к нему. В строке 16–19, где перечислены пары «токен ↔ константа», дописать `` `--vc-scroll-zone-height` ↔ `SCROLL_ZONE_HEIGHT` ``. В блоке `.vc-menu` раздела 1 дописать `--vc-scroll-zone-height: 16px;` сразу после `--vc-item-height: 28px;`.

- [ ] **Step 6: Прогнать темы и демо**

Run: `npx playwright test --project=chromium theme.spec.js demo.spec.js`
Expected: PASS.

- [ ] **Step 7: Типы и коммит**

Run: `npm run typecheck` — Expected: без ошибок.

```bash
git add src/constants.js styles/mycontext.css tests/e2e/theme.spec.js
git commit -m "style: у длинного списка две зоны прокрутки вместо системной полосы"
```

---

### Task 3: Модуль `src/scrollZones.js` на собственном стенде

Модуль принимает узлы аргументами, а не находит их сам, поэтому проверяется без слоя, без оркестратора и без живого меню: стенд строит свою разметку в странице и подставляет ручной планировщик кадров с задачным `time`. Это единственный способ проверить шаг по времени детерминированно — живые часы в Playwright одинаковы в трёх движках лишь приблизительно.

**Files:**
- Create: `src/scrollZones.js`
- Test: `Create: tests/e2e/scrollZones.spec.js`

**Interfaces:**
- Consumes: `SCROLL_SPEED_PX_PER_SEC` (новая константа, добавляется в этом же шаге в `src/constants.js`).
- Produces: `createScrollZones(options): ScrollZones` — экспортируемая функция и экспортируемый `@typedef {object} ScrollZones` с полями `refresh(): void`, `stop(): void`, `destroy(): void`. Поля опций: `list: HTMLElement`, `level: HTMLElement`, `up: HTMLElement`, `down: HTMLElement`, `speed?: number` (по умолчанию `SCROLL_SPEED_PX_PER_SEC`), `requestFrame?: (callback: (time: number) => void) => number` (по умолчанию глобальный `requestAnimationFrame`), `cancelFrame?: (handle: number) => void` (по умолчанию глобальный `cancelAnimationFrame`).

- [ ] **Step 1: Добавить `SCROLL_SPEED_PX_PER_SEC` в `src/constants.js`**

```js
/**
 * Скорость автопрокрутки под наведением на зону, px в секунду.
 *
 * Публичной опции нет: скорость обязана быть одинаковой у всех меню библиотеки,
 * иначе два рядом стоящих меню прокручивались бы разными темпами.
 */
export const SCROLL_SPEED_PX_PER_SEC = 240;
```

- [ ] **Step 2: Написать падающие стендовые кейсы**

Создать `tests/e2e/scrollZones.spec.js`. Импортировать в него только `expect` и `test` из `@playwright/test`: числа проверяются в браузере, в Node они не нужны.

Стенд строится одним хелпером, который кладёт в `globalThis` подставленные `requestFrame` и `cancelFrame`:

```js
/**
 * Ставит стенд: настоящие узлы с настоящей геометрией и ручной планировщик
 * кадров. Скролл здесь не подменён: `refresh` и `sync` читают настоящие
 * `scrollTop`, `clientHeight` и `scrollHeight`, а вот время шага задаётся руками —
 * иначе одинаковый сдвиг пришлось бы угадывать в трёх движках сразу.
 *
 * Скорость стенда 100 px в секунду, то есть 5 px за кадр при `dt` 50 мс: круглое
 * число, вокруг которого расхождение видно сразу.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ viewportHeight: number, contentHeight: number }} config
 * @returns {Promise<void>}
 */
async function mountStand(page, config) {
  await page.evaluate(async (options) => {
    const { createScrollZones } = await import('../../src/scrollZones.js');
    const host = document.createElement('div');
    host.style.cssText = 'position: absolute; top: 0; left: 0; width: 120px;';
    const up = document.createElement('div');
    up.className = 'vc-scroll-zone vc-scroll-zone-up';
    const down = document.createElement('div');
    down.className = 'vc-scroll-zone vc-scroll-zone-down';
    const list = document.createElement('div');
    list.style.cssText = `height: ${options.viewportHeight}px; overflow-y: auto;`;
    const filler = document.createElement('div');
    filler.style.cssText = `height: ${options.contentHeight}px;`;
    list.appendChild(filler);
    const level = document.createElement('div');
    level.className = 'vc-menu';
    level.append(up, list, down);
    host.appendChild(level);
    document.body.appendChild(host);

    // Ровно один кадр в очереди: `requestFrame` зовётся только когда очередь пуста,
    // а `flush` забирает кадр до вызова, иначе кадр, поставленный самим `step`,
    // попал бы в тот же прогон и `flush` крутил бы цикл вечно.
    /** @type {((time: number) => void) | null} */
    let queued = null;
    const stand = {
      level,
      up,
      down,
      list,
      zones: createScrollZones({
        list,
        level,
        up,
        down,
        speed: 100,
        requestFrame: (callback) => {
          queued = callback;
          return 1;
        },
        cancelFrame: () => {
          queued = null;
        },
      }),
      /** Прогоняет ровно один кадр, отдавая ему заданное время. */
      flush(time) {
        if (queued === null) {
          return;
        }
        const callback = queued;
        queued = null;
        callback(time);
      },
      /** Сколько кадров ждёт своего `flush`. */
      pending: () => queued !== null,
    };
    const scope = /** @type {{ __stand?: typeof stand }} */ (/** @type {unknown} */ (globalThis));
    scope.__stand = stand;
  }, config);
}
```

Добавить кейсы. Стойка по умолчанию — `viewportHeight: 100`, `contentHeight: 1000`, то есть прокручивать есть куда; в кейсах, где нужен другой перебор, `mountStand` зовётся с другой `config`.

- `refresh снимает и возвращает признак прокручиваемости` — на стенде с `contentHeight: 1000` признак появляется после `refresh()`, на стенде с `contentHeight: 100` (высоты ровно в обрез) не появляется.
- `refresh гасит устаревший признак, оставшийся от прошлого показа` — `refresh()` при переполнении, затем `list.style.height` меняется на высоту контента, `refresh()` снова, и атрибут снят. Это прямая проверка гистерезиса из §6.2 спеки на единицах, где он в принципе возможен.
- `верхняя зона заблокирована в начале, нижняя свободна` и `нижняя зона заблокирована в конце, верхняя свободна` — после `refresh()` читаются `data-vc-blocked`; в конце `scrollTop` выставлен в `scrollHeight - clientHeight`.
- `переполнение меньше пикселя гасит обе зоны` — стенд с `viewportHeight: 100`, `contentHeight: 100.5`: обе зоны получают `data-vc-blocked`, потому что допуск в 1 px на конце срабатывает и сверху, и снизу. Зоны при этом не видимы — признак ставится, но разницы на глаз нет, и в этом весь смысл допуска.
- `наведение на свободную зону запускает цикл, на заблокированную — нет` — `up.dispatchEvent(new PointerEvent('pointerenter'))` на стенде в начале не ставит кадров, после прокрутки в конец ставит один.
- `кадр сдвигает список на speed умноженное на dt` — на `down` при `scrollTop = 0` первый `flush(0)` не сдвигает список (кадр только запоминает время), `flush(50)` даёт ровно 5 px при `speed: 100` и `dt: 50` ms, а третий `flush(100)` — ещё 5. На `up` с середины списка те же два кадра дают минус 5 px.
- `цикл встаёт у упора` — на `down` после серии `flush` прокрутка доходит ровно до `scrollHeight - clientHeight`, `pending()` равен `false`, а нижняя зона заблокирована.
- `цикл встаёт, когда список не двигается` — на стенде без перебора (`contentHeight: 100`) `pointerenter` на `down` не ставит кадров вовсе, а цикл, дошедший до упора, не ставит следующего.
- `уход курсора останавливает цикл` — `pointerenter` на `up`, потом `pointerleave` на `up`, `pending()` равен `false` и `scrollTop` больше не меняется.
- `stop останавливает цикл, destroy снимает слушатели` — после `pointerenter` `stop()` обнуляет очередь; после `destroy()` повторный `pointerenter` не ставит кадров, а `refresh()` всё ещё пересчитывает признак.

- [ ] **Step 3: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium scrollZones.spec.js`
Expected: FAIL — `import '../../src/scrollZones.js'` не разрешается, модуля нет.

- [ ] **Step 4: Написать `src/scrollZones.js`**

```js
import { SCROLL_SPEED_PX_PER_SEC } from './constants.js';

/**
 * @typedef {object} ScrollZoneOptions
 * @property {HTMLElement} list прокручиваемый список уровня.
 * @property {HTMLElement} level элемент уровня: он же носитель
 * `data-vc-scrollable`.
 * @property {HTMLElement} up верхняя зона.
 * @property {HTMLElement} down нижняя зона.
 * @property {number} [speed] скорость прокрутки, px в секунду. По умолчанию
 * `SCROLL_SPEED_PX_PER_SEC`; поле есть ради стенда, который гоняет шаг по
 * задачному времени.
 * @property {(callback: (time: number) => void) => number} [requestFrame]
 * @property {(handle: number) => void} [cancelFrame]
 */

/**
 * Управляет прокруткой одного уровня: решает, прокручиваем ли он, и гоняет список
 * по кадрам, пока курсор держит зону.
 *
 * @typedef {object} ScrollZones
 * @property {() => void} refresh пересчитывает признак прокручиваемости уровня и
 * состояние зон. Зовётся из `present` и только оттуда.
 * @property {() => void} stop останавливает текущую прокрутку, не снимая
 * слушателей. Зовётся из `hide` и перед перезапуском цикла.
 * @property {() => void} destroy останавливает прокрутку и снимает слушателей.
 * Зовётся при уничтожении слоя.
 */
```

Далее — фабрика `createScrollZones(options)` с телом по шагам ниже.

Дефолтные функции вынести наверх, как `defaultSchedule` и `defaultCancel` в `src/layer.js`, а не писать `globalThis.requestAnimationFrame` в значении по умолчанию прямо в деструктуризации:

```js
/**
 * @param {(time: number) => void} callback
 * @returns {number}
 */
function defaultRequestFrame(callback) {
  return globalThis.requestAnimationFrame(callback);
}

/**
 * @param {number} handle
 * @returns {void}
 */
function defaultCancelFrame(handle) {
  globalThis.cancelAnimationFrame(handle);
}
```

Внутри `createScrollZones` — четыре узла и скорость из деструктуризации, затем состояние `let frame = 0`, `let direction = 0`, `let previous = 0`, и четыре функции:

```js
/**
 * Единственный писатель `data-vc-blocked`. Порог снизу с допуском в 1 px:
 * `scrollHeight` и `clientHeight` дробные там, где высоты кратны `dvh`, и без
 * допуска зона гасла бы за пиксель до настоящего низа.
 *
 * @returns {void}
 */
function sync() {
  const atTop = list.scrollTop <= 0;
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
  up.toggleAttribute('data-vc-blocked', atTop);
  down.toggleAttribute('data-vc-blocked', atBottom);
}
```

```js
/**
 * @returns {void}
 */
function step(time) {
  frame = 0;
  // Первый кадр задаёт точку отсчёта: время между постановкой цикла и первым
  // кадром не имеет отношения к шагу и уводил бы список на пол-экрана.
  if (previous === 0) {
    previous = time;
    frame = requestFrame(step);
    return;
  }
  const distance = Math.round(speed * (time - previous) / 1000);
  previous = time;
  if (distance > 0) {
    const before = list.scrollTop;
    list.scrollTop += direction * distance;
    sync();
    if (list.scrollTop === before) {
      stop();
      return;
    }
  }
  frame = requestFrame(step);
}
```

```js
/**
 * @returns {void}
 */
function stop() {
  if (frame !== 0) {
    cancelFrame(frame);
    frame = 0;
  }
  direction = 0;
}
```

```js
/**
 * @param {-1 | 1} next направление прокрутки: вверх или вниз.
 * @returns {void}
 */
function begin(next) {
  // Зона, до которой не доскролтить, цикл не запускает: пустой кадр всё равно
  // должен был бы сразу же встать, но без этой проверки он ещё и мигает.
  if (next < 0 ? up.hasAttribute('data-vc-blocked') : down.hasAttribute('data-vc-blocked')) {
    return;
  }
  stop();
  direction = next;
  previous = 0;
  frame = requestFrame(step);
}
```

Публичные функции — по контракту из **Interfaces**. `refresh` снимает атрибут, читает переполнение и возвращает признак, после чего зовёт `sync` в любом случае, чтобы у зон не осталось состояния от прошлого показа:

```js
function refresh() {
  level.removeAttribute('data-vc-scrollable');
  if (list.scrollHeight > list.clientHeight) {
    level.setAttribute('data-vc-scrollable', '');
  }
  sync();
}
```

`destroy` зовёт `stop`, затем снимает четыре слушателя. Слушатели ставятся в теле `createScrollZones`, а не в `refresh`: пересчитывать признак можно сколько угодно раз, а подписка должна быть одна на контроллер. `scroll` вешается прямо на `list` — он не всплывает, и делегат на уровне его не увидит.

- [ ] **Step 5: Прогнать стенд**

Run: `npx playwright test --project=chromium scrollZones.spec.js`
Expected: PASS.

- [ ] **Step 6: Типы и коммит**

Run: `npm run typecheck` — Expected: без ошибок.

```bash
git add src/scrollZones.js src/constants.js tests/e2e/scrollZones.spec.js
git commit -m "feat: контроллер зон прокрутки с шагом по кадрам и тремя причинами встать"
```

---

### Task 4: Слой — решение о прокрутке до единственного замера

Порядок в `present` меняется в одном месте и по одной причине: замер должен идти по состоянию, которое пользователь увидит, а `refresh()` — это подготовка этого состояния. Ранняя редакция задачи обосновывала порядок ошибкой в 32 px (меню якобы ниже, потому что зоны его удлиняют); замер показал, что при `max-height` на уровне зоны отнимают место у списка, а не добавляют уровню, и ошибки нет ни на одном вьюпорте. Обоснование и попытка проверить его геометрией — в решениях 15a–15c журнала `.superpowers/sdd/2026-09-28-menu-scroll-zones/progress.md`. Порядок остаётся: он ничего не стоит под маской замера и защищает правило «спросить переполнение без зон», если у уровня появится иная граница роста.

**Files:**
- Modify: `src/layer.js` (`createEntry`, локальное хранилище контроллеров, `present`, `hide`, `destroy`)
- Test: `tests/e2e/layer.spec.js` (кейс на нижний край, кейс на признак, Review Focus 1)

**Interfaces:**
- Consumes: `createScrollZones` и `ScrollZones` из Task 3, `RenderedLevel.scroll` из Task 1.
- Produces: ничего наружу; контроллер — внутреннее дело слоя.

- [ ] **Step 1: Написать падающие кейсы**

В `tests/e2e/layer.spec.js` в `describe('показ')` добавить фикстуру из 40 пунктов: `ROOT_ITEMS` и `WIDE_ITEMS` во вьюпорт не влезают, а кейсу про clamp нужен именно переполненный уровень, открытый у нижнего края.

- `признак прокручиваемости ставится на показ и снимается на коротком` — на длинном уровне `data-vc-scrollable` есть после `showRoot`, у обеих зон `display: flex` и высота `SCROLL_ZONE_HEIGHT`; на коротком (`WIDE_ITEMS`, три пункта) признака нет и зоны `display: none`. Этот кейс падает сам по себе, и ради него затевается задача.
- `нижний край прижатого к низу длинного меню доходит до padding, а не перешагивает его` — длинный уровень открывается в точке у нижнего края вьюпорта через `probe.real()`, и `rect.bottom <= innerHeight - SAFETY_PADDING`. Кейс становится осмысленным только после предыдущего: пока признак не ставится, зоны скрыты, меню короче на 32 px и в `padding` укладывается само собой. Его предмет — порядок в `present`: если `refresh()` уедет за замер, движок посчитает уровень на 32 px ниже, clamp сдвинет его вверх, и после показа зон нижний край вылезет за `padding` ровно на две зоны.
- `после смены вьюпорта признак пересчитывается, а не наследуется` (Review Focus 1) — `page.setViewportSize({ width: 1280, height: 1400 })`, при котором 40 пунктов по 28 px перестают быть переполнением. Меню при смене вьюпорта закрывается само, поэтому кейс открывает уровень заново через `showRoot` и требует отсутствия `data-vc-scrollable`. Без `refresh` в `present` атрибут от прошлого показа остался бы, и зоны заняли бы 32 px у меню, которому они не нужны.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium layer.spec.js -g "padding|признак прокручиваемости|вьюпорта"`
Expected: FAIL — `data-vc-scrollable` не появляется никогда, контроллера в слое нет.

- [ ] **Step 3: Завести хранилище контроллеров в `createLayer`**

Рядом с `levels` и `pendingHides` в теле `createLayer`:

```js
  /**
   * Контроллер прокрутки на каждый уровень. Живёт здесь, а не в `LevelEntry`,
   * потому что `LevelEntry` описывает уровень как уровень, и прокрутка сделала
   * бы его контрактом сразу о двух вещах.
   *
   * @type {Map<LevelEntry, ScrollZones>}
   */
  const zones = new Map();
```

Над `createEntry` добавить хелпер, и им пользоваться во всех трёх местах:

```js
  /**
   * @param {LevelEntry} entry
   * @returns {ScrollZones}
   */
  function zonesOf(entry) {
    const controller = zones.get(entry);
    if (controller === undefined) {
      throw new Error('MyContext: у уровня нет контроллера зон прокрутки');
    }
    return controller;
  }
```

Проверка не паранойя: единственный способ получить `LevelEntry` — `createEntry`, а он обязан зарегистрировать контроллер. Бросок здесь повторяет приём с зарезервированным `aria-owns` в этом же файле и заменяет молчаливую потерю состояния при рассинхроне.

- [ ] **Step 4: Создавать контроллер в `createEntry` и гасить его в `hide` и `destroy`**

В `createEntry` между `levels.push(entry)` и `return entry` создать контроллер и положить его в карту:

```js
  levels.push(entry);
  zones.set(entry, createScrollZones({
    list: rendered.scroll.list,
    level: entry.element,
    up: rendered.scroll.up,
    down: rendered.scroll.down,
  }));
  return entry;
```

`rendered` уже лежит в области видимости: `createEntry` начинается с `const rendered = renderLevel(items, context);`, а `entry.element` — тот же `rendered.element`, что вернулся из `renderLevel`. Импорт в начале файла дополнить `createScrollZones` и `ScrollZones` из `'./scrollZones.js'`, а в `@typedef`-блок — `import('./scrollZones.js').ScrollZones`.

В `hide` первой строкой после `entry.open = false` добавить `zonesOf(entry).stop();`. В `destroy` — `zonesOf(entry).destroy();` в том же обходе цепочки, где вызывается `entry.element.remove()`, и `zones.clear()` после обхода.

- [ ] **Step 5: Вставить `refresh` в `present` между раскладкой и замером**

В `present` после `mask.remove()` и до единственного `getBoundingClientRect()` вставить `zonesOf(entry).refresh();` с комментарием о причине: зоны занимают 32 px, и замер до их показа посчитал бы уровень ниже, чем он есть. Порядок в JSDoc `present` обновить, чтобы он совпадал с кодом.

- [ ] **Step 6: Прогнать слой целиком**

Run: `npx playwright test --project=chromium layer.spec.js`
Expected: PASS.

- [ ] **Step 7: Типы и коммит**

Run: `npm run typecheck` — Expected: без ошибок.

```bash
git add src/layer.js tests/e2e/layer.spec.js
git commit -m "feat: слой решает, прокручиваем ли уровень, до замера геометрии"
```

---

### Task 5: Оркестратор и живое поведение

Последняя незакрытая половина спеки: пока на пункте держится `data-active`, наведение на зону не должно выглядеть как выбор пункта, который список сейчас крутит. Оркестратор снимает выделение, когда курсор оказался в зоне, а не на пункте, и больше ничего не меняет — `ArrowDown` и `ArrowUp` после этого выбирают первый и последний пункт уже существующим кодом.

**Files:**
- Modify: `src/MyContext.js` (`#onLevelPointerMove`, новая константа селектора)
- Test: `tests/e2e/scrollZones.spec.js` (живая часть файла: оркестратор, колесо, клавиатура, Review Focus 3, 4, 5)

**Interfaces:**
- Consumes: `clearActive(root)` из `src/keyboard.js`; живой фикстур `mountLiveMenu`/`openLiveMenu` в этом файле копируется из `tests/e2e/theme.spec.js`, потому что каждый файл спеки держит свои хелперы сам.
- Produces: ничего наружу.

- [ ] **Step 1: Написать падающие живые кейсы**

В `tests/e2e/scrollZones.spec.js` скопировать хелперы `mountLiveMenu`, `openLiveMenu` и typedef `LiveMenu` из `tests/e2e/theme.spec.js` (вместе с typedef `{ __live?: LiveMenu }` и комментарием про `reducedMotion: 'reduce'`), добавить константу `const ZONE_UP = '.vc-scroll-zone-up';`, `const ZONE_DOWN = '.vc-scroll-zone-down';`, `const ITEM = '.vc-item';` и хелпер на 40 пунктов.

Добавить `describe('живое меню')` с кейсами:

- `у длинного уровня обе зоны на месте, у короткого скрыты` — `mountLiveMenu` с 40 пунктами, `openLiveMenu`; атрибут `data-vc-scrollable` есть, обе зоны `display: flex` и высотой `SCROLL_ZONE_HEIGHT`; у `mountLiveMenu` с тремя пунктами атрибута нет, обе зоны `display: none`.
- `зоны гаснут по мере прокрутки в обоих направлениях` — открыть длинное меню, снимок: верхняя заблокирована, нижняя нет; `list.scrollTop` в середину через `page.evaluate`, тот же снимок: обе свободны; `list.scrollTop` в конец, снимок: верхняя свободна, нижняя заблокирована.
- `наведение на нижнюю зону прокручивает список вниз до упора` — `page.hover` по центру нижней зоны и ожидание `list.scrollTop` упора через `page.waitForFunction`, затем снимок: нижняя заблокирована, верхняя свободна. Симметричный кейс `наведение на верхнюю зону прокручивает список вверх до упора`.
- `наведение на заблокированную зону список не двигает` — открыть длинное меню в начале, `page.hover` по центру верхней зоны, подождать `DEFAULT_ANIMATION_DURATION * 3` и убедиться, что `list.scrollTop` равен 0.
- `колесо над списком прокручивает список и переносит состояние зон` — `page.mouse.wheel` над центром `.vc-list`, дождаться ненулевого `scrollTop`, снимок: обе зоны свободны.
- `колесо над зоной прокручивает страницу и закрывает меню` (Review Focus 5) — `page.mouse.wheel` над центром нижней зоны и `expect(await level.isVisible()).toBe(false)` после `SETTLE_MS`. Зона не скроллится, поэтому колесо над ней — это колесо над фоном.
- `вход в зону снимает выделение пункта` — открыть длинное меню, `page.hover` по центру пункта, у пункта есть `data-active`; `page.hover` по центру нижней зоны, `document.querySelectorAll('.vc-item[data-active]').length` равен 0.
- `стрелка вниз из зоны выбирает первый пункт, стрелка вверх — последний` — открыть длинное меню, встать в зону, `ArrowDown`: активен первый пункт и `list.scrollTop` равен 0; `ArrowUp` из того же места: активен последний, и `list.scrollTop` равен упору.
- `End долистывает список и гасит нижнюю зону` (Review Focus 2) — `End`, затем снимок зон: нижняя заблокирована. Это проверка того, что `sync` слышит клавиатурную долистку через тот же `scroll`.
- `Escape посреди автоскролла останавливает цикл` (Review Focus 3) — встать в нижнюю зону, дождаться ненулевого `scrollTop`, `Escape`, `SETTLE_MS`, снимок `list.scrollTop` до и после `SETTLE_MS * 2`: список не двинулся.
- `наведение на зону одного меню не двигает список другого` (Review Focus 4) — поставить на страницу два экземпляра `MyContext` с 40 пунктами, открыть оба, снимок `scrollTop` обоих списков, `page.hover` по центру нижней зоны первого, дождаться его упора и снимок второго: `scrollTop` равен 0.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium scrollZones.spec.js -g "живое меню"`
Expected: FAIL — выделение пункта через зону не снимается: кейс `вход в зону снимает выделение пункта` видит `data-active` на пункте. Остальные кейсы к этому моменту обязаны проходить — иначе Task 3 или Task 4 недоделан.

- [ ] **Step 3: Снять выделение при входе в зону в `src/MyContext.js`**

Рядом с `ITEM_SELECTOR` и `MENU_SELECTOR` добавить:

```js
const SCROLL_ZONE_SELECTOR = '.vc-scroll-zone';
```

В `#onLevelPointerMove` после ветки пункта и до `#feedPointerMove` вставить:

```js
    // Курсор в зоне, а не на пункте: пока на пункте держится `data-active`, зона
    // выглядит как выбор пункта, который список сейчас крутит. `closest` по
    // пункту уже вернул `null`, поэтому вторым поиском отсекается всё, что не
    // зона, — разделитель, поля каркаса, само подменю мимо.
    if (item === null && target.closest(SCROLL_ZONE_SELECTOR) !== null) {
      const root = this.#root;
      if (root !== null && root.open) {
        this.#keyboard.clearActive(root);
      }
    }
```

- [ ] **Step 4: Прогнать живое поведение**

Run: `npx playwright test --project=chromium scrollZones.spec.js`
Expected: PASS.

- [ ] **Step 5: Прогнать всё, что задевается**

Run: `npm test`
Expected: PASS. Внимание: `tests/e2e/demo.spec.js:1190` берёт `list.lastElementChild` — это по-прежнему последний пункт, зоны его не трогают; `tests/e2e/keyboard.spec.js` оперирует `LevelEntry.children`, а это поле про подменю, а не про DOM.

- [ ] **Step 6: Типы и коммит**

Run: `npm run typecheck` — Expected: без ошибок.

```bash
git add src/MyContext.js tests/e2e/scrollZones.spec.js
git commit -m "fix: наведение на зону оставляло подсвеченным пункт, которого никто не выбирал"
```

---

### Task 6: Документация и демо

**Files:**
- Modify: `README.md` (строки около 169, 325 и 348)
- Modify: `Demo/scenarios.js` (комментарий сценария `long`)

**Interfaces:**
- Consumes: готовые классы и токены из Tasks 1–5.
- Produces: ничего.

- [ ] **Step 1: Поправить три места в `README.md`**

Снять или переписать описание узкого системного скроллбара в разделе про длинные списки: у длинного списка полосы нет, а список крутят зоны по краям, у которых есть высота `--vc-scroll-zone-height`. В таблице токенов рядом с `--vc-item-height` дописать `--vc-scroll-zone-height` и его значение 16 px. В перечне отличий библиотеки заменить строку про скроллбар на строку про зоны: они не входят в кольцо роуминга, скрыты от экрана и гаснут у края.

- [ ] **Step 2: Поправить комментарий сценария `long` в `Demo/scenarios.js`**

Сценарий и его длина не меняются. Комментарий обязан перестать обещать «узкую системную полосу» и сказать, что навести курсор на зону у края.

- [ ] **Step 3: Прогнать демо и коммит**

Run: `npx playwright test --project=chromium demo.spec.js` — Expected: PASS.

```bash
git add README.md Demo/scenarios.js
git commit -m "docs: README и демо описывают зоны прокрутки, а не системную полосу"
```

---

## Порядок и зависимости

```
Task 1 (разметка) ──┬──> Task 2 (оформление) ──┐
                    └──> Task 3 (модуль) ──────┴──> Task 4 (слой) ──> Task 5 (оркестратор) ──> Task 6 (документация)
```

Task 3 ни от чего не зависит: модуль получает узлы аргументами и проверяется на своём стенде. Task 2 проверяет только CSS и ставит `data-vc-scrollable` руками, поэтому его кейсы не зависят от Task 4.

## Что осталось за рамками плана

- Колесо над подменю. Сейчас оно гасит подменю, потому что подменю помещается целиком; зоны дают ему прокрутку, но правило «колесо прокручивает открытое подменю, а не уровень-владелец» в спеку не входило и здесь не выводится.
- `prefers-reduced-motion` для автоскролла. Спека решила, что непрерывная прокрутка под курсором — не анимация, и гасить её нельзя; если решение пересмотрят, местом для него станет `begin` в `src/scrollZones.js`.
- Экспорт скорости. Публичной опции нет, и `speed` остаётся полем контракта для стенда.
