# Правки взаимодействия MyContext — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть девять дефектов библиотеки, найденных разбором демо, и один пробел демо — журнал кликов.

**Architecture:** Три независимых механизма меняются по отдельности и потому вынесены в
отдельные задачи. Первый — геометрия hover intent: safe-triangle из трёх позиций курсора
меняется на прямоугольник, вычисляемый из геометрии пары «пункт-владелец + подменю».
Второй — модель активного пункта: `data-active` становится единственным носителем
подсветки, его пишут и клавиатура, и мышь, а при отсутствии активного пункта уровень
держит фокус на собственном элементе. Третий — семантика закрытия: клик по любому
доступному пункту закрывает меню по умолчанию, клик внутри привязанного контейнера
закрывает, уход курсора не закрывает ничего, а повторный `open()` на открытом меню
проходит полный цикл.

**Tech Stack:** Чистые ES-модули, ES2026, Popover API и Top Layer, `@starting-style`,
`transition-behavior: allow-discrete`, `color-mix()`, `scrollbar-width`. Без рантайм-зависимостей. Тесты — только Playwright: `npm test`, `npm run test:unit`, `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-09-28-mycontext-interaction-fixes-design.md`.
План спорит со спекой, поэтому спека едет вместе с ним: исполнитель читает оба.

## Global Constraints

- Ответы пользователю, комментарии и JSDoc — на русском. Имена идентификаторов, сигнатуры и значения — как есть, латиницей.
- Никаких новых рантайм-зависимостей. `package.json` остаётся с пустым отсутствующим полем `dependencies`.
- `--vc-padding` (8px) ↔ `SAFETY_PADDING`, `--vc-item-height` ↔ `DEFAULT_ITEM_HEIGHT`, `--vc-icon-size` ↔ `DEFAULT_ICON_SIZE`, `--vc-chevron-size` ↔ `DEFAULT_CHEVRON_SIZE`, `--vc-radius` ↔ `DEFAULT_RADIUS`, `--vc-animation-duration` ↔ `DEFAULT_ANIMATION_DURATION`. Совпадение проверяется e2e-тестом, расхождение ломает clamp позиционирования.
- Все три уровня анимации (вход, выход, отложенное закрытие) делят одну величину `animationDuration`.
- Комментарии объясняют «почему», а не «что». Публичный API документируется, приватные члены — только там, где инвариант неочевиден.
- Типы строгие. Новый именованный контракт, пересекающий границу модуля, объявляется `@typedef`, а не анонимным объектом.
- `npm run typecheck` обязан проходить после каждой задачи, меняющей `src/` или `Demo/`.
- Порядок фаз внутри `layer.present` обязателен: раскладка → замер → снятие маски → запись координат → `showPopover()`.
- Существующие `data-vc-closing`, `aria-owns`, `aria-haspopup`, `aria-expanded`, `aria-level`, `aria-setsize`, `aria-posinset`, `data-chevron` не переименовываются и не теряются.
- Все e2e-спеки, кроме `demo.spec.js` и `layer.spec.js`, работают под `prefers-reduced-motion: reduce` и/или с замороженными часами `page.clock`. Любая новая отложенность обязана сниматься под `reduce`, иначе хелпер «снимок в том же `evaluate`, что вызов» перестанет работать.

## Review Focus

Пять входов, которые спека подразумевает, но ни одна задача не проверяет своими тестами. Каждому соответствует шаг в задаче, которой он принадлежит.

1. **Отложенный показ переоткрытия после того, как меню уже закрыли иначе.** Скролл страницы, `resize`, клик вне меню или `Escape` в окне между `data-vc-closing` и показом обязаны отменить отложенный показ, иначе меню воскреснет через 140 мс после того, как его закрыли. Проверяется в Task 6.
2. **`destroy()` при висящем отложенном показе.** Таймер переоткрытия не должен сработать на уничтоженном экземпляре и не должен бросить наружу. Проверяется в Task 6.
3. **Подменю, прижатое к `padding`, — не поместилось ни справа, ни слева.** Зазор до пункта-владельца там больше `SUBMENU_OFFSET`, расширение безопасной области его не покрывает, и переход держится исключительно на `CLOSE_GRACE_MS`. Проверяется в Task 1.
4. **`ArrowLeft` из подменю возвращает отметку пункту-владельцу.** Уровень не должен остаться без активного пункта, иначе следующая стрелка начнёт цикл с края вместо продолжения от владельца. Проверяется в Task 2.
5. **Второй правый клик по контейнеру, пока первое переоткрытие ещё не показалось.** Цикл должен начаться заново, а не показать меню мгновенно на середине. Проверяется в Task 6.

---

### Task 1: Hover intent — безопасная область вместо вырождающегося клина

Дефект 5. Клин строился из трёх позиций курсора, база его равна зазору `SUBMENU_OFFSET = 4 px`, движение к пункту подменю прямой по построению, площадь на прямой нулевая при `DEGENERATE_AREA = 25` — то есть каждое движение планировало закрытие.

**Files:**
- Modify: `src/constants.js` (удалить `DEGENERATE_AREA`, добавить `SAFE_AREA_BUFFER`)
- Modify: `src/hoverIntent.js` (переписать геометрию и контракт)
- Modify: `src/MyContext.js` (считать безопасную область, передавать её в `hoverIntent`)
- Test: `tests/unit/hoverIntent.spec.js` (переписать), `tests/e2e/submenu.spec.js` (2 теста), `tests/e2e/acceptance.spec.js` (критерий 3)

**Interfaces:**
- Consumes: `SUBMENU_OFFSET` из `src/constants.js` (уже экспортируется, значение 4).
- Produces: `export const SAFE_AREA_BUFFER = 30` в `src/constants.js`. `HoverIntentController.pointerMove(point: Point, safeArea: SafeArea | null): void`, где `SafeArea` — новый экспортируемый `@typedef {object} {left: number, top: number, right: number, bottom: number}` из `src/hoverIntent.js`. `itemLeave(): void` и `submenuEnter(): void` больше не принимают аргументов.

- [ ] **Step 1: Переписать юнит-тесты под прямоугольник**

В `tests/unit/hoverIntent.spec.js` удалить константы `EXIT_POINT`, `ENTRY_POINT`, `FIRST_POINT`, `INSIDE_POINT`, `OUTSIDE_POINT`, хелпер `enterSubmenuFrom(hover, exitPoint, entryPoint)` и импорт `DEGENERATE_AREA` из `src/constants.js`.

Удалить тесты `'курсор внутри треугольника не планирует закрытие'`, `'курсор снаружи треугольника планирует закрытие через closeDelayMs'`, `'после точки вне треугольника следующая проверяется против сузившегося клина'`, `'точки почти на одной прямой не защищают подменю'`, `'площадь ровно DEGENERATE_AREA считается невырожденной'`, `'принимается и становится вершиной, но не запускает закрытие'`, `'вырожденный клин после промаха становится невырожденным и начинает защищать'`.

В остальных вызовах `pointerMove` дописать второй аргумент: `pointerMove(INSIDE_POINT, AREA)`, где

```js
const AREA = { left: 100, top: 100, right: 300, bottom: 400 };
const OUTSIDE_AREA = { left: 100, top: 100, right: 300, bottom: 200 };
const INSIDE_POINT = { x: 200, y: 300 };
const OUTSIDE_POINT = { x: 200, y: 350 };
const EDGE_POINT = { x: 100, y: 250 };
```

Добавить в `describe('безопасная область')` тесты:

- `'курсор внутри безопасной области не планирует закрытие'` — `pointerMove(INSIDE_POINT, AREA)`, затем `clock.advance(closeDelayMs * 3)`, `expect(calls.close).toBe(0)`.
- `'курсор на границе безопасной области не планирует закрытие'` — то же с `EDGE_POINT`.
- `'курсор снаружи безопасной области планирует закрытие через closeDelayMs'` — `pointerMove(OUTSIDE_POINT, OUTSIDE_AREA)`, `expect(hover.isClosePending()).toBe(true)`, после `advance(closeDelayMs)` `calls.close` равен 1.
- `'возврат курсора внутрь отменяет запланированное закрытие'` — `pointerMove(OUTSIDE_POINT, OUTSIDE_AREA)`, затем `pointerMove(INSIDE_POINT, AREA)`, `advance(closeDelayMs * 2)`, `calls.close` равен 0.
- `'без открытого подменю любое движение планирует закрытие'` — `pointerMove(INSIDE_POINT, null)`, `expect(hover.isClosePending()).toBe(true)`.
- `'прямое движение к дальнему углу подменю не планирует закрытие'` — регрессия на исходный дефект: `pointerMove` вдоль отрезка от `{x: 96, y: 104}` (точка пункта-владельца) до `{x: 296, y: 396}` (дальний угол подменю) по 20 шагам, `safeArea = AREA` на каждом шаге, и после каждого шага `expect(hover.isClosePending()).toBe(false)`.
- `'выход за верхний край области планирует закрытие'` и `'выход за нижний край области планирует закрытие'` — точки `{x: 200, y: 99}` и `{x: 200, y: 401}` при `AREA`.

- [ ] **Step 2: Прогнать юнит-тесты и убедиться, что они падают**

Run: `npm run test:unit -- hoverIntent`
Expected: FAIL — `'pointerMove' принимает два аргумента, а 'itemLeave' не принимает ни одного`.

- [ ] **Step 3: Переписать `src/hoverIntent.js`**

Удалить из модуля: `cross`, `triangleArea`, `containsPoint` со старой сигнатурой, `copyPoint`, поля `exitPoint`, `entryPoint`, `wedgeTip`, `lastPointerPoint`, импорт `DEGENERATE_AREA`.

Добавить `@typedef` `SafeArea` (экспортируемый — им пользуется `src/MyContext.js`) с JSDoc: прямоугольник в координатах вьюпорта, px; точка на границе считается принадлежащей.

Новая предикатная функция с именем `containsArea(area, point)` — граница включительна: `point.x >= area.left && point.x <= area.right && point.y >= area.top && point.y <= area.bottom`.

Новое тело `pointerMove(point, safeArea)`:

```js
function pointerMove(point, safeArea) {
  if (safeArea === null || !containsArea(safeArea, point)) {
    planClose();
  } else {
    clearClose();
  }
}
```

`itemLeave()` — только `clearOpen()`. `submenuEnter()` — только `clearClose()`. Оба без параметров.

Переписать JSDoc модуля: вместо описания трёх опорных точек и вырожденного треугольника — описание безопасной области, её геометрии и того, почему она выводится вызывающим кодом из прямоугольников пары «владелец + подменю», а не из истории движения.

- [ ] **Step 4: Проверить юнит-тесты**

Run: `npm run test:unit -- hoverIntent`
Expected: PASS.

- [ ] **Step 5: Добавить `SAFE_AREA_BUFFER` и убрать `DEGENERATE_AREA` в `src/constants.js`**

`export const DEGENERATE_AREA = 25;` удалить. Добавить рядом с `SUBMENU_OFFSET`:

```js
/**
 * Насколько безопасная область подменю шире самого подменя, px. По трём сторонам,
 * отличным от стороны пункта-владельца.
 */
export const SAFE_AREA_BUFFER = 30;
```

- [ ] **Step 6: Написать падающий e2e-тест на исходный дефект**

В `tests/e2e/submenu.spec.js` переписать тест `'диагональное движение к подменю не закрывает его'` так, чтобы он гонял курсор по прямой от пункта-владельца к нижнему крайнему пункту подменю и утверждал, что подменю осталось открыто. Переписать `'курсор, ушедший в сторону, закрывает подменю после closeDelayMs'` на новую геометрию: курсор уходит на соседний пункт того же уровня, и закрытие происходит по `CLOSE_GRACE_MS`.

Добавить тест `'подменю, прижатое к краю вьюпорта, переживает переход через зазор'` (Review Focus 3): сценарий с владельцем у самого правого края так, чтобы подменю не поместилось ни справа, ни слева и было прижато к `padding`; курсор идёт к его дальнему пункту по прямой через зазор больше `SUBMENU_OFFSET`; `submenuIdOf` владельца остаётся в списке открытых уровней после `fastForward(CLOSE_GRACE_MS * 3)`.

- [ ] **Step 7: Прогнать тест и убедиться, что он падает**

Run: `npx playwright test --project=chromium submenu.spec.js -g "диагональное|ушедший в сторону|прижатое к краю"`
Expected: FAIL на геометрии — текущий клин вырождается на прямой и планирует закрытие.

- [ ] **Step 8: Посчитать безопасную область в `src/MyContext.js`**

Импорт расширить до `import { DEFAULT_ANIMATION_DURATION, DEFAULT_MENU_LABEL, SAFE_AREA_BUFFER, SUBMENU_OFFSET } from './constants.js';`, в `@typedef`-блок добавить `import('./hoverIntent.js').SafeArea`.

Добавить приватный метод:

```js
/**
 * Прямоугольник, внутри которого курсор считается идущим к подменю, либо `null`,
 * когда подменю не открыто и любое движение планирует закрытие.
 *
 * @returns {SafeArea | null}
 */
#safeArea() {
  const deepest = this.#deepestChainEntry();
  if (deepest === null || deepest.ownerItem === null) {
    return null;
  }
  const rect = deepest.element.getBoundingClientRect();
  const side = deepest.ownerItem.element.dataset.chevron === 'left';
  const pad = SAFE_AREA_BUFFER;
  const gap = SUBMENU_OFFSET;
  // Расширение в сторону владельца ровно на зазор: расширение на `pad` накрыло бы
  // правый край любого пункта родительского уровня, и уход на соседний пункт перестал
  // бы закрывать подменю.
  return side
    ? { left: rect.left - pad, top: rect.top - pad, right: rect.right + gap, bottom: rect.bottom + pad }
    : { left: rect.left - gap, top: rect.top - pad, right: rect.right + pad, bottom: rect.bottom + pad };
}
```

`#onItemLeave` перестаёт звать `this.#hover.pointerMove(...)` и работает только через `this.#hover.itemLeave()`. `#onLevelPointerMove` и `#onGlobalPointerMove` передают вторым аргументом `this.#safeArea()`.

- [ ] **Step 9: Прогнать затронутые e2e**

Run: `npx playwright test --project=chromium submenu.spec.js acceptance.spec.js`
Expected: PASS.

- [ ] **Step 10: Типы и коммит**

Run: `npm run typecheck` — Expected: без ошибок.

```bash
git add src/constants.js src/hoverIntent.js src/MyContext.js tests/unit/hoverIntent.spec.js tests/e2e/submenu.spec.js tests/e2e/acceptance.spec.js
git commit -m "fix: подменю закрывалось при наведении — клин вырождался на движении к пункту"
```

---

### Task 2: Открытое меню ничего не выделяет, а уровень держит клавиши

Часть претензии 8: при открытии не должно быть выделения, пока пользователь не нажмёт стрелку. Ключи должны работать и без выделения — иначе стрелка не сможет его создать.

**Files:**
- Modify: `src/renderer.js` (`tabindex="-1"` на элементе уровня)
- Modify: `src/keyboard.js` (`registerLevel` вместо `focusFirst`, ослабленный guard в `handleKeydown`, `moveTo` после `openSubmenu`)
- Modify: `src/MyContext.js` (`open()` и `#openSubmenu` зовут `registerLevel`)
- Test: `tests/e2e/keyboard.spec.js` (27 тестов), `tests/e2e/lifecycle.spec.js`, `tests/e2e/acceptance.spec.js` (критерий 5), `tests/e2e/contracts.spec.js`, `tests/e2e/renderer.spec.js`

**Interfaces:**
- Consumes: без новых импортов.
- Produces: `KeyboardController.registerLevel(entry: LevelEntry, options: { focus: boolean }): void` — регистрирует уровень, снимает с его пунктов протухшие отметки, ставит `activeIndex = -1` и при `options.focus === true` фокусирует `entry.element`. `focusFirst` удалён. Имя `data-active` и `tabindex` остаются единственными носителями.

- [ ] **Step 1: Падающий тест: после открытия нет отметок, а клавиша работает**

В `tests/e2e/keyboard.spec.js` в той же пробе страницы `globalThis.__vcKb` заменить два вызова `keyboard.focusFirst(...)`: в `host.openSubmenu` (строка 483) на `keyboard.registerLevel(entry, { focus: false })`, в `probe.open` (строка 846) на `keyboard.registerLevel(root, { focus: true })`.

Добавить в существующий `describe` тест `'после открытия отметок нет, а первая стрелка даёт крайний пункт'`: `await runScenario(page, ...)` со сценарием из шага `{ command: 'read' }` — `marksOf(levels.root)` пуст и `activeIndex` равен `-1`; затем сценарий из `{ command: 'press', key: 'ArrowDown' }` — активен первый доступный пункт; отдельным сценарием `ArrowUp` — активен последний.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium keyboard.spec.js -g "после открытия отметок нет"`
Expected: FAIL — `focusFirst` не существует, либо отметки есть сразу после открытия.

- [ ] **Step 3: `registerLevel` в `src/keyboard.js`**

Переименовать `focusFirst` в `registerLevel(entry, options)`. Тело: снять `data-active` и вернуть `tabindex` в `-1` со всех пунктов уровня, `entry.activeIndex = NO_ACTIVE_ITEM`, `known.set(entry.element, entry)`, и при `options.focus === true` — `entry.element.focus({ preventScroll: true })`.

В `handleKeydown` удалить проверку `if (target.closest(ITEM_SELECTOR) === null) { return; }` целиком: целью может быть сам элемент уровня. Оставить проверку `target.closest(MENU_SELECTOR) === null` и поиск в `known`.

В ветках `ArrowRight` и `Enter` после `host.openSubmenu(submenu)` добавить `moveTo(submenu, 0);` — фокус переносит тот же движок, иначе у клавиатуры было бы два места переноса фокуса.

Обновить JSDoc модуля и `@typedef` `KeyboardController`: описать `registerLevel`, его контракт с `options.focus` и то, что уровень с `tabindex="-1"` получает клавиши при отсутствии активного пункта.

- [ ] **Step 4: `tabindex="-1"` на элементе уровня в `src/renderer.js`**

В `renderLevel` после `element.id = context.menuId;` добавить `element.tabIndex = -1;` с одной строкой комментария: без неё состояние «уровень отвечает на клавиши, но активного пункта нет» недостижимо, потому что фокусировать элемент без `tabindex` нельзя.

- [ ] **Step 5: `open()` и `#openSubmenu` в `src/MyContext.js`**

В `open()` заменить `this.#keyboard.focusFirst(root);` на `this.#keyboard.registerLevel(root, { focus: true });`. В `#openSubmenu` заменить `this.#keyboard.focusFirst(entry);` на `this.#keyboard.registerLevel(entry, { focus: false });` — фокус остаётся в родительском уровне, как требует спека 6.2. Комментарий в `#openSubmenu` про «регистрация уровня и фокус — один вызов» переписать.

- [ ] **Step 6: Починить цель нажатия в пробе `keyboard.spec.js`**

`press(key, at)` (строка 669) без `at` бьёт по `document.activeElement`, а после Task 2 это элемент уровня, и `describeTarget` вернёт его `id` вместо подписи пункта. В тестах `'ArrowRight на пункте без подменю ничего не делает'`, `'Enter вызывает action активного пункта и закрывает меню'`, `'Space вызывает action'`, `'клавиши без ветви не гасятся и состояние не трогают'` добавить `at` с подписью пункта, чтобы они проверяли то, что заявляли.

- [ ] **Step 7: Починить тесты, чьи ожидания — про начальное состояние**

- `'ArrowDown переключает активный пункт циклически, минуя disabled и разделители'` — в `focusTrail` первым значением теперь `null`, а не подпись первого пункта.
- `'ArrowUp идёт в обратном направлении циклически'` и `'Home и End переходят к первому и последнему доступному пункту'` — последовательности сдвинуты на один шаг, потому что начинают с пустого состояния.
- `'data-active совпадает с элементом, имеющим фокус, а tabindex равен 0 только у него'` — проверять на состоянии после `ArrowDown`, а не сразу после открытия.
- `'длинный уровень: активный пункт долистывается в видимую часть списка'` — `focusLabel` после открытия `null`.
- `'уровень без доступных пунктов остаётся нетронутым'` — `focus.inMenu` теперь `true`, фокус на элементе уровня.
- `'слой не заводит уровень под отключённого владельца подменю'` — `rovingOf` после `ArrowDown`.
- `'клавиши вне контейнера не обрабатываются'` — `activeIndex` и `tabStops` после открытия пусты.
- `'фокус всегда с preventScroll'` — `expect(inMenu.length).toBe(4)` становится 5: добавился вызов `focus()` на элементе уровня.

- [ ] **Step 8: Починить тесты, чей вход — активация и цепочка уровней**

- `'ArrowRight открывает подменю и переносит фокус в его первый пункт'` — в `focusTrail` оба значения равны подписи владельца; `rovingOf` подменю проверять после `ArrowDown` внутри подменю.
- `'ArrowLeft закрывает подменю и возвращает фокус на пункт-владелец'` и `'ArrowLeft на корневом уровне вызывает closeAll'` — вход в подменю теперь `ArrowRight` на владельце, которому предшествует `ArrowDown`.
- `'уровень берётся из цели события, а не от последнего тронутого уровня'` — сценарий перестраивается: активный пункт задаётся в родителе, подменю открывается, `ArrowDown` в подменю даёт первый пункт подменю.
- `'уровень без активного пункта начинает цикл с края'` — шаг `clear` заменяется на шаг с `{ command: 'show-submenu' }`; ожидания пересобираются.
- `'незаведённый уровень подменю: пункт-владелец молчит, а не активируется'` — `focus.label` после открытия `null`, `ArrowDown` даёт `'Экспорт'`.
- `'reset снимает отметки роуминга и забывает уровень'` — сценарий переписывается на `registerLevel`, а не на `focusFirst`.
- `'Enter вызывает action активного пункта и закрывает меню'`, `'Space вызывает action'`, `'подменю: [] не делает пункт владельцем: Enter активирует его'` — перед `Enter`/`Space` добавить `ArrowDown`, потому что без активного пункта клавиша активации не делает ничего (спека 3.3).
- `'Enter на пункте-владельце открывает подменю и не вызывает action'`, `'Space на пункте-владельце открывает подменю и не вызывает action'` — `focusTrail` и `rovingOf` подменю после переноса фокуса.
- `'Escape закрывает самое глубокое подменю, не трогая корень'`, `'Escape на корневом уровне вызывает closeAll'`, `'Tab закрывает всё меню и вызывает focusOwner'` и `'вложенность 4 уровней закрывается по цепочке клавишей Escape'` в `tests/e2e/submenu.spec.js` — вход в цепочку требует `ArrowRight` на каждом уровне, а каждый уровень перед этим помечается `ArrowDown`.
- `'клавиша в прокручиваемый список, а не в пункт, роуминг не двигает'` — требование «цель — пункт» снято намеренно, поэтому тест переписывается в `'клавиша в прокручиваемый список обрабатывается уровнем'`: `prevented` равен `true`, активным становится первый доступный пункт. Комментарий в тесте объясняет, что уровень принадлежит меню целиком и список не исключение.

Добавить тест `'ArrowLeft из подменю возвращает отметку пункту-владельцу'` (Review Focus 4): `ArrowRight`, затем `ArrowLeft`, затем `ArrowDown` — активен пункт после владельца, а не первый уровня; и `ArrowUp` — предыдущий, а не последний.

- [ ] **Step 9: Починить остальные файлы**

`tests/e2e/lifecycle.spec.js`: `expect(before.focusLabel, ...).toBe('Пустой')` в `'attach: пункт с disabled и подменю не открывает подменю по ArrowRight'`, `'Первый'` в `'open() без attach открывает меню в заданных координатах'`, `'Первый'` в `'close() скрывает меню и возвращает фокус на элемент-владелец'`, `'Первый'` в `'detach() не уничтожает экземпляр'`, `'Первый'` в `'повторный open() снова регистрирует уровень в движке клавиатуры'` — все становятся `null`, и перед каждым утверждением о фокусе на пункте добавляется `ArrowDown`.

`tests/e2e/acceptance.spec.js`, критерий 5 `'меню полностью управляется с клавиатуры, а открывается программно'`: `expect(root.focusLabel, 'фокус на первом пункте')` заменяется на проверку отсутствия `data-active` сразу после `open()`, и дальше каждый `ArrowRight` начинается с `ArrowDown` на своём уровне.

`tests/e2e/contracts.spec.js`, тест `'действие, уничтожившее экземпляр, не роняет обработчик клавиш'`: в пробе `activateWithKeyboard(name)` после `item.focus()` добавить `item.setAttribute('data-active', '')` — активация идёт по активному пункту, и без отметки клавиша не делает ничего (спека 3.3). Комментарий в тесте обновляется: проверяется, что `closeAll` после `destroy()` не бросает, а не то, что действие вызывается при произвольном фокусе.

`tests/e2e/renderer.spec.js`: в фикстуре `MENU_HTML` добавить `tabindex="-1"` элементу уровня; в тесте `'меню получает role=menu и aria-label из контекста'` добавить утверждение `tabindex === '-1'` у элемента уровня.

- [ ] **Step 10: Типы и коммит**

Run: `npm run typecheck && npx playwright test --project=chromium`
Expected: PASS.

```bash
git add src/renderer.js src/keyboard.js src/MyContext.js tests/e2e/keyboard.spec.js tests/e2e/lifecycle.spec.js tests/e2e/acceptance.spec.js tests/e2e/contracts.spec.js tests/e2e/renderer.spec.js
git commit -m "fix: при открытии выделялся первый пункт, а меню без выделения не отвечало на клавиши"
```

---

### Task 3: Мышь выделяет пункт и перебивает клавиатуру, уход курсора сбрасывает выделение

Остаток претензии 8: «последнее взаимодействие выигрывает».

**Files:**
- Modify: `src/keyboard.js` (`activateFromPointer`, `clearActive`, `#onGlobalPointerMove` не трогаем)
- Modify: `src/MyContext.js` (`#onLevelPointerMove`, `#onGlobalPointerMove`)
- Test: `tests/e2e/submenu.spec.js`, `tests/e2e/globals.spec.js`, `tests/e2e/demo.spec.js`, `tests/e2e/keyboard.spec.js`

**Interfaces:**
- Consumes: `registerLevel` из Task 2.
- Produces: `KeyboardController.activateFromPointer(entry: LevelEntry, item: RenderedItem): void` и `KeyboardController.clearActive(root: LevelEntry): void`.

- [ ] **Step 1: Падающие тесты**

В `tests/e2e/keyboard.spec.js` добавить четыре теста, все через существующую пробу `globalThis.__vcKb`:

- `'наведение мыши выделяет пункт и перебивает клавиатуру'` — `open`, `ArrowDown` (активен первый), затем `press` с целью на втором пункте через существующий шаг `press` с `at`; `marksOf` показывает второй.
- `'стрелка считает следующий пункт от того, что под курсором'` — `open`, `press` с `at` на третьем пункте, `ArrowDown`; активен четвёртый.
- `'уход курсора сбрасывает выделение, и стрелка снова даёт крайний пункт'` — `open`, `press` с `at` на третьем пункте, шаг `press-outside`, `ArrowDown`; активен первый.
- `'клавиатура перебивает мышь'` — `open`, `press` с `at` на третьем пункте, `ArrowDown` (активен четвёртый), затем `press` с `at` на втором; активен второй.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium keyboard.spec.js -g "выделяет пункт и перебивает|от того, что под курсором|уход курсора сбрасывает|клавиатура перебивает мышь"`
Expected: FAIL — `data-active` за наведением мыши не следует.

- [ ] **Step 3: `activateFromPointer` и `clearActive` в `src/keyboard.js`**

`activateFromPointer(entry, item)` — общий `activate` без `scrollIntoView`: пункт под курсором и так виден, а долистывание дёргало бы список на каждом движении. Выход немедленный, если `item` уже несёт `data-active`: иначе каждый `pointermove` писал бы атрибут.

`clearActive(root)` — снять `data-active` и вернуть `tabindex` в `-1` со всех пунктов всех уровней из `known`, `activeIndex` каждого вернуть в `-1`, `root.element.focus({ preventScroll: true })`.

В JSDoc `KeyboardController` описать обе функции: `activateFromPointer` — единственный путь выделения мышью и причина того, что мышь перебивает клавиатуру; `clearActive` — единственный путь полного сброса.

- [ ] **Step 4: Проводка в `src/MyContext.js`**

`#onLevelPointerMove` переписать по порядку из спеки 3.5: найти `closest('.vc-item')` и уровень через `closest('.vc-menu')` в `#levels`; при найденном доступном пункте звать `this.#keyboard.activateFromPointer(entry, rendered)`; если пункт есть в `#showTargets` — выход; иначе `this.#hover.pointerMove({ x: event.clientX, y: event.clientY }, this.#safeArea())`.

`#onGlobalPointerMove` в ветке «цель вне дерева меню» первым делом звать `this.#keyboard.clearActive(this.#root)` — если корень уже показан, — и только потом `hover.pointerMove`. В JSDoc обработчика заменить описание `#pointerOutsideTree` (пока жив) на описание сброса выделения.

- [ ] **Step 5: Починить остальные спеки, задетые наведением**

`tests/e2e/submenu.spec.js`: `'наведение на пункт с подменю открывает его через openDelayMs'` больше не ждёт `'PDF'` в `focusLabel` — фокус на владельце; `'стрелка вправо открывает подменю и отдаёт его движку'` и `'вложенность 4 уровней открывается целиком и все меню в пределах вьюпорта'` перестраиваются на `ArrowDown` перед `ArrowRight`; `'отключённый пункт-владелец не открывает подменю ни одним способом'` начинает обход уровня с `ArrowDown`.

`tests/e2e/globals.spec.js`: `'уход курсора на контейнер закрывает подменю, но не каскад'` покачивается — курсор уходит за пределы дерева, но клика там нет, поэтому меню остаётся открытым; добавить отдельный тест `'клик по контейнеру закрывает и подменю, и корень'` для поведения Task 5.

`tests/e2e/demo.spec.js`: `'демо: сценарий с отключёнными пунктами не открывает их подменю'` — `expect(focusBefore, 'фокус на первом доступном пункте').toBe('Доступно')` становится проверкой отсутствия выделения с последующим `ArrowDown`.

- [ ] **Step 6: Типы и коммит**

Run: `npm run typecheck && npx playwright test --project=chromium`
Expected: PASS.

```bash
git add src/keyboard.js src/MyContext.js tests/e2e/keyboard.spec.js tests/e2e/submenu.spec.js tests/e2e/globals.spec.js tests/e2e/demo.spec.js
git commit -m "fix: наведение мыши не выделяло пункт, и уход курсора не сбрасывал выделение"
```

---

### Task 4: Одна заливка — мышиная; кольцо и `:hover` уходят

Вторая половина претензии 8 плюс претензия 6.

**Files:**
- Modify: `styles/mycontext.css`
- Modify: `Demo/demo.css`
- Test: `tests/e2e/theme.spec.js`, `tests/e2e/renderer.spec.js`

**Interfaces:**
- Consumes: `--vc-hover-bg` (существует), `--vc-separator`, `--vc-muted`.
- Produces: удалённые токены `--vc-accent`, `--vc-accent-text`; правила `.vc-item:hover`, `.vc-item:focus-visible`, `.vc-item[data-active] .vc-chevron` удалены; `.vc-item[aria-disabled="true"]:not([data-active])` → `.vc-item[aria-disabled="true"]`. `--vc-active-bg` во всех трёх палитрах равен `var(--vc-hover-bg)`.

- [ ] **Step 1: Переписать тест про кольцо фокуса**

В `tests/e2e/theme.spec.js` тест `'видимость фокуса не запрещена'` переписать в `'признак фокуса — заливка активного пункта, а не кольцо'`: регексп `expect(css, 'голый селектор :focus').not.toMatch(/(?<!-):focus(?!-)/)` остаётся; `expect(readRules(css).filter((rule) => rule.selector.includes(':focus-visible'))).toHaveLength(0)` — колец нет; `expect(readRule(css, '.vc-menu')).not.toContain('outline')` и то же для `.vc-list` остаются; живая часть вместо проверки `outlineWidth`/`outlineStyle` проверяет, что после `Tab` и `ArrowDown` сфокусированный элемент несёт `data-active` и его `backgroundColor` непустая.

- [ ] **Step 2: Переписать тест про `--vc-active-bg`**

В `tests/e2e/theme.spec.js` тест `'токен --vc-active-bg существует и по умолчанию равен акценту'` переименовать в `'токен --vc-active-bg существует и по умолчанию равен заливке наведения'`; во всех селекторах из `THEME_SELECTORS` ждать строку `--vc-active-bg: var(--vc-hover-bg)`.

В `readActiveRow` удалить поле `accent` из результата и из JSDoc `ActiveRow`, удалить `chevronMatches` из результата и из его комментария, и добавить `hoverBg: resolve('--vc-hover-bg')` рядом с `activeBg`. В `readSnapshot` удалить поля `accent` и `accentText` из результата и из JSDoc `ThemeSnapshot` — они не читаются ни одним утверждением.

В тестах `'контраст активного пункта не ниже 4.5:1 в обеих темах'` и `'контраст активного пункта не ниже 4.5:1 в обеих темах, включая disabled на активной строке'`: убрать утверждение `expect(result.chevronMatches, ...)`, а проверку `opaque` заменить на composited-контраст текста — `contrast(parseColor(result.rowColor), composite(parseColor(result.hoverBg), parseColor(result.menuBg)))` не ниже 4.5. Непрозрачность заливки больше не является контрактом: `--vc-active-bg` полупрозрачен by design.

- [ ] **Step 3: Добавить тест «отключённый пункт не подсвечивается»**

Добавить в `tests/e2e/theme.spec.js` тест `'отключённый пункт не получает заливки при наведении'`: открыть сценарий с отключёнными пунктами, навести на отключённый пункт, сравнить его `backgroundColor` с `backgroundColor` соседнего доступного пункта без наведения, затем навести на доступный и сравнить с отключённым — обе разности равны `0s 0px 0px 0px` (полностью прозрачный фон). Дополнительно убедиться, что отключённый пункт не несёт `data-active`.

- [ ] **Step 4: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium theme.spec.js`
Expected: FAIL — токены ещё равны акценту, `:focus-visible` ещё есть, отключённый пункт ещё подсвечивается.

- [ ] **Step 5: Правки `styles/mycontext.css`**

В блоке токенов `.vc-menu` удалить `--vc-accent` и `--vc-accent-text`; `--vc-active-bg: var(--vc-accent);` заменить на `--vc-active-bg: var(--vc-hover-bg);`, с комментарием о том, что активный пункт и пункт под курсором обязаны выглядеть одинаково. Удалить те же два токена из блока `@media (prefers-color-scheme: dark)` и из `.vc-menu[data-vc-theme="dark"]`.

Удалить правило `.vc-item:hover` целиком вместе с его комментарием. Удалить `.vc-item:focus-visible`. Удалить `.vc-item[data-active] .vc-chevron`. В `.vc-item[data-active]` убрать `color: var(--vc-accent-text);`, оставив только `background`. В `.vc-item[aria-disabled="true"]:not([data-active])` убрать `:not([data-active])` и переписать комментарий: состояние «отключённый и активный» недостижимо, потому что отключённый пункт не входит в цикл роуминга и не может получить `data-active`.

- [ ] **Step 6: Убрать переопределения из `Demo/demo.css`**

В обоих блоках `:root[data-demo-theme="…"] .vc-menu` удалить строки `--vc-accent`, `--vc-accent-text`, `--vc-active-bg`.

- [ ] **Step 7: Починить `tests/e2e/renderer.spec.js`**

В тесте `'шеврон что-то рисует: у ::before есть ненулевая толщина рамки'` удалить `chevronColor` из результата и из JSDoc, удалить утверждения `expect(result.color).toBe(result.chevronColor)` и `expect(result.chevronColor).toBe(result.rowColor)`, оставив `expect(result.color).toBe(result.muted)`.

- [ ] **Step 8: Прогнать и закоммитить**

Run: `npm run typecheck && npx playwright test --project=chromium`
Expected: PASS.

```bash
git add styles/mycontext.css Demo/demo.css tests/e2e/theme.spec.js tests/e2e/renderer.spec.js
git commit -m "style: выделение с клавиатуры сливается с мышиным, кольцо и :hover уходят"
```

---

### Task 5: Клик по пункту закрывает меню по умолчанию; клик по контейнеру закрывает; уход курсора не закрывает

Претензии 2, 3 и 4.

**Files:**
- Modify: `src/MyContext.js` (`#onLevelClick`, `#onGlobalPointerDown`, колбэк `onClose`, удаление `#pointerOutsideTree`, поле `#openSerial`)
- Modify: `src/keyboard.js` (убрать `host.closeAll()` из `Enter`/`Space`)
- Test: `tests/e2e/lifecycle.spec.js`, `tests/e2e/globals.spec.js`, `tests/e2e/demo.spec.js`, `tests/e2e/submenu.spec.js`

**Interfaces:**
- Consumes: без новых импортов.
- Produces: приватное поле `#openSerial: number`, увеличиваемое каждым вызовом `open()`. `#onLevelClick` читает его до вызова `item.action` и пропускает отложенное закрытие, если значение изменилось.

- [ ] **Step 1: Падающие тесты в `tests/e2e/globals.spec.js`**

Переписать `'уход курсора на контейнер закрывает подменю, но не каскад'`: курсор уходит с дерева меню на контейнер, ничего не кликая; через `fastForward(CLOSE_GRACE_MS * 3)` закрывается только самое глубокое подменю, корневой уровень остаётся `:popover-open`. Добавить `'клик по контейнеру закрывает меню целиком'`: левый клик внутри контейнера вне меню даёт `openCount === 0`.

Переписать `'уход курсора в пустоту страницы закрывает каскад целиком'` в `'уход курсора в пустоту страницы закрывает только подменю'`: после `fastForward` остаётся ровно один открытый уровень — корень. Переписать комментарий в `'возврат курсора в дерево закрывает один уровень, а не каскад'`: семантика флага `#pointerOutsideTree` удалена, закрывает самый глубокий уровень.

- [ ] **Step 2: Падающий тест в `tests/e2e/lifecycle.spec.js`

Добавить `'клик по пункту без action закрывает меню'`: открыть сценарий `flat`, кликнуть по пункту без `action`, `openCount === 0`. Добавить `'клик по разделителю, отключённому пункту и владельцу подменю не закрывает меню'`: три клика подряд, после каждого `openCount === 1`; между кликами по разделителю и отключённому снимать подсветку движением мыши в сторону, иначе второй клик попадёт по владельцу. Добавить `'action, вызвавший open(), не отменяется отложенным закрытием'`: пункт зовёт `open()` в другом месте страницы; после клика и `fastForward(animationDuration * 2)` меню открыто в новой точке, `openCount === 1`.

- [ ] **Step 3: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium globals.spec.js lifecycle.spec.js -g "уход курсора|клик по контейнеру|без action|не закрывает меню|вызвавший open"`
Expected: FAIL по старому поведению.

- [ ] **Step 4: Правки `src/MyContext.js`

Добавить поле `/** @type {number} */ #openSerial = 0;` и увеличивать его первым делом в `open()`.

В `#onLevelClick` заменить `if (item.action === undefined) { return; }` на безусловный запуск `item.action?.(event)` с той же конструкцией `try`/`finally`. В `finally` перед `this.close()` добавить проверку `if (this.#openSerial !== serial) { return; }`, где `const serial = this.#openSerial;` взят до вызова действия. Разделитель, отключённый пункт и владелец подменю уходят на свои ветки раньше и остаются не закрывающими.

В `#onGlobalPointerDown` убрать вызов `#isInsideTreeOrAnchor` и проверять только `#isInsideMenu(event.target)`; комментарий переписать — контейнер исключался ради правого клика, а правый клик идёт через `#onGlobalContextMenu`.

В колбэке `onClose` убрать ветку с `#pointerOutsideTree` целиком, оставив `#hideSubmenuFor` для самого глубокого уровня.

Удалить поле `#pointerOutsideTree` и все его присваивания: в `#onGlobalPointerMove`, в `open()`, в `#closeMenu()`.

- [ ] **Step 5: Убрать двойное закрытие в `src/keyboard.js`**

В ветке `Enter`/`Space` удалить строку `host.closeAll();` после `dispatchEvent`. Комментарий рядом обновить: закрытие теперь делает обработчик активации, и второй вызов был бы двойным закрытием с двойным возвратом фокуса. Проверить, что `@typedef KeyboardHost.closeAll` всё ещё описывает `Tab` и `Escape`/`ArrowLeft` корневого уровня.

- [ ] **Step 6: Починить остальные спеки**

`tests/e2e/demo.spec.js`: `'демо: сценарий с 4 уровнями вложенности раскрывается целиком'` использует `clickItem(..., 'Четвёртый уровень')`, а это владелец подменю, и клик по нему не закрывает — тест остаётся зелёным без правок. Проверить фактом, а не на глаз: если он упал, перестроить сценарий через `ArrowRight` вместо клика.

- [ ] **Step 7: Типы и коммит**

Run: `npm run typecheck && npx playwright test --project=chromium`
Expected: PASS.

```bash
git add src/MyContext.js src/keyboard.js tests/e2e/lifecycle.spec.js tests/e2e/globals.spec.js tests/e2e/demo.spec.js tests/e2e/submenu.spec.js
git commit -m "fix: клик по пункту без action не закрывал меню, клик по контейнеру не закрывал вовсе, уход курсора сносил всё"
```

---

### Task 6: `open()` на открытом меню проходит полный цикл

Претензия 10. Контракт `open()` меняется, и вместе с ним — `README.md:241`, JSDoc `open()` и спека 2026-09-27 §6.1 (это в Task 10).

**Files:**
- Modify: `src/MyContext.js` (`open`, новые `#showAt`, `#hideChain`, `#cancelReopen`, `#isShowing`, поля `#reopenHandle`, `#reducedMotionQuery`)
- Test: `tests/e2e/lifecycle.spec.js`, `tests/e2e/globals.spec.js`, `tests/e2e/acceptance.spec.js`

**Interfaces:**
- Consumes: `DEFAULT_ANIMATION_DURATION` (уже импортирован).
- Produces: `defaultSchedule(fn, ms)` и `defaultCancel(handle)` на уровне модуля `src/MyContext.js` — те же функции, что в `layer.js` и `hoverIntent.js`, вызываемые как методы `globalThis`. Поле `#reducedMotionQuery: MediaQueryList`, по умолчанию `globalThis.matchMedia('(prefers-reduced-motion: reduce)')`. Поле `#reopenHandle: unknown`. Приватные методы `#hideChain(): void`, `#showAt(params: Point): void`, `#isShowing(): boolean`, `#cancelReopen(): void`.

- [ ] **Step 1: Переписать тест идемпотентности в `tests/e2e/lifecycle.spec.js`**

Скопировать шпион `hidePopover` из пробы `tests/e2e/globals.spec.js:304-308` в пробу страницы `globalThis.__mc` файла `lifecycle.spec.js` и отдать счётчик в `Snapshot` полем `hideCount` — в `lifecycle.spec.js` такого счётчика сейчас нет, а без него «закрылось и открылось заново» неотличимо от «перепозиционировалось».

Тест `'open() идемпотентен: повторный вызов не создаёт второе меню в DOM'` переименовать в `'open() на открытом меню проходит полный цикл: закрытие и показ в новой точке'`. Второй вызов делать новым хелпером `reopenMenu(page, x, y)`: `scope.__mc.open(point.x, point.y)`, затем `page.clock.fastForward(DEFAULT_ANIMATION_DURATION * 2)`, затем `scope.__mc.read()` — хелпер `openMenu` (строка 187) читает снимок в том же `evaluate` и при полном цикле вернул бы закрытое меню.

Под `reduce` цикл проходит за один такт, поэтому утверждения: `second.hideCount === first.hideCount + 1`, `second.openCount === 1`, `second.levels[0].id === first.levels[0].id`, `second.levels[0].marked === true`, `second.levels[0].rect.left` равен `500 + CURSOR_OFFSET`, `second.levels[0].rect.top` равен `400 + CURSOR_OFFSET`.

Добавить тест `'выходная анимация отиграна до показа в новой точке'`: `page.emulateMedia({ reducedMotion: 'no-preference' })`, первый `open`, снимок, `scope.__mc.open(500, 400)` отдельным `page.evaluate`, сразу после него на корневом уровне стоит `data-vc-closing`, через `page.waitForTimeout(DEFAULT_ANIMATION_DURATION * 2)` отметки нет и `rect` соответствует новой точке.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium lifecycle.spec.js -g "полный цикл|выходная анимация отиграна"`
Expected: FAIL — `hideCount` не растёт, `data-vc-closing` не появляется.

- [ ] **Step 3: Реализовать цикл в `src/MyContext.js`**

Добавить на уровне модуля `defaultSchedule`/`defaultCancel` — копии из `layer.js` с теми же JSDoc. В классе добавить поля `#reopenHandle` (`unknown`), `#reducedMotionQuery` (`MediaQueryList`, инициализируется в конструкторе вызовом `globalThis.matchMedia('(prefers-reduced-motion: reduce)')`).

`#hideChain()` — спрятать уровни цепочки от глубоких к корню, обнулить `#chain`, `#hoverOwner`. Вынести текущий цикл из `open()` сюда.

`#showAt(params)` — тело показа: `hover.cancelAll()`, `#hoverOwner = null`, `#ensureLevel` для корня, `#chain.push`, `#leadAhead`, `layer.showRoot`, `keyboard.registerLevel(root, { focus: true })`.

`#isShowing()` — `#chain.length > 0 || this.#reopenHandle !== null`.

`#cancelReopen()` — если `#reopenHandle` не `null`, `defaultCancel` и обнулить. Вызвать из `#closeMenu` (её зовут и `close()`, и глобальные обработчики скролла, `resize` и клика) и из `destroy()`. Это Review Focus 1 и 2.

`open(params)` — новая форма: `assertAlive`, `#focusOwner = #attachedTo`, `#cancelReopen()`, `#openSerial += 1`, и если `#isShowing()` — `#hideChain()`, затем `#closeMenu`-подобный сброс hover, отметок и активного пункта без возврата фокуса, затем отложенный показ; иначе `#showAt(params)`.

Отложенный показ: если `#reducedMotionQuery.matches` — `#showAt(params)` немедленно, иначе `defaultSchedule` с `#options.animationDuration`, с охраной по `#openSerial` и `#destroyed`. Порядок таймеров внутри одного тика детерминирован и полагается на то, что задача сокрытия ставится слоем внутри `hide()` раньше, чем задача показа; это записать комментарием в `#showAt`.

В `#closeMenu` добавить `#cancelReopen()` первым делом. В `destroy()` — тоже.

JSDoc `open()` переписать: не идемпотентен, на открытом меню проходит полный цикл, под `reduce` цикл синхронен.

- [ ] **Step 4: Прогнать lifecycle и починить хелпер**

Run: `npx playwright test --project=chromium lifecycle.spec.js`
Expected: остальные тесты падают на устаревших предположениях об идемпотентности. Починить `'attach: повторный attach переносит привязку на новый контейнер'` (убрать временный `close()` из Task 5) и `'пункты без id и с повторяющимся id вызывают свой action'`.

- [ ] **Step 5: Переписать тест переоткрытия в `tests/e2e/globals.spec.js`**

Тест `'правый клик по контейнеру переоткрывает меню в новой точке'` переименовать в `'правый клик по контейнеру закрывает меню и открывает заново в новой точке'`: `expect(after.hideCount).toBe(before.hideCount + 1)` вместо `toBe(before.hideCount)`, и комментарий 608–610 заменить — закрытие и переоткрытие теперь не «мигание и лишний цикл», а заявленное поведение.

- [ ] **Step 6: Починить критерий 2 в `tests/e2e/acceptance.spec.js`**

Тест `'критерий 2: меню не выходит за границы вьюпорта ни в одной точке сетки'` перебирает 72 точки, каждая из которых зовёт `openAt` на уже открытом меню. Добавить между итерациями `await scope.__mc.close();` перед `openAt`, чтобы каждая точка открывала закрытое меню и цикл не вмешивался; либо, что честнее для проверки границ, закрывать перед каждой итерацией. Пояснить выбор комментарием: критерий проверяет геометрию показа, а не поведение переоткрытия, и смешивать их нельзя.

- [ ] **Step 7: Добавить три теста Review Focus 1, 2 и 5**

В `tests/e2e/lifecycle.spec.js`, все три под `page.emulateMedia({ reducedMotion: 'no-preference' })` и с реальными часами:

- `'окно закрытия отменяет отложенный показ'` — обернуть в цикл по четырём способам закрыть: `Escape`, прокрутка страницы (`window.scrollTo(0, 1)`, чтобы сработал глобальный слушатель на `window`), `resize` (`page.setViewportSize`) и левый клик по контейнеру вне меню. Для каждого: `open` в точке, затем `open` в другой точке, затем закрывающее воздействие, затем `page.waitForTimeout(DEFAULT_ANIMATION_DURATION * 3)`, и `openCount === 0`. Название теста содержит имя способа, чтобы падение показывало, какой именно сломался.
- `'destroy() в окне закрытия не воскрешает меню'` — то же до `waitForTimeout`, но вместо закрывающего воздействия `scope.__mc.destroy()`; `page.on('pageerror')` не собрал ничего, и через `DEFAULT_ANIMATION_DURATION * 3` в DOM нет `.vc-menu`.
- `'второй правый клик в окне закрытия начинает цикл заново'` — `open` в точке A, сразу `open` в точке B, сразу `open` в точке C, `waitForTimeout(DEFAULT_ANIMATION_DURATION * 3)`, `openCount === 1` и `rect` соответствует точке C.

- [ ] **Step 8: Типы и коммит**

Run: `npm run typecheck && npx playwright test --project=chromium`
Expected: PASS.

```bash
git add src/MyContext.js tests/e2e/lifecycle.spec.js tests/e2e/globals.spec.js tests/e2e/acceptance.spec.js
git commit -m "fix: повторный open() переносил меню вместо полного цикла закрытия и показа"
```

---

### Task 7: Средняя кнопка мыши блокируется

Претензия 9.

**Files:**
- Modify: `src/MyContext.js` (новый обработчик + подписка в `#ensureLevel`)
- Test: `tests/e2e/globals.spec.js`

**Interfaces:**
- Consumes: `PRIMARY_MOUSE_BUTTON` (уже есть в модуле).
- Produces: приватное поле `#onLevelPointerDown = (event) => {...}`.

- [ ] **Step 1: Падающий тест**

В `tests/e2e/globals.spec.js` рядом с `'нажатие не основной кнопкой вне меню его не закрывает'` добавить `'средняя кнопка мыши по меню гасится'`: открыть меню, навести на пункт, завести в `page.evaluate` слушатель `pointerdown` в capture-фазе, пишущий `event.defaultPrevented` для `button === 1`; `page.mouse.down({ button: 'middle' })`; `page.mouse.up({ button: 'middle' })`; `expect` записанного значения `true` и `menuStillOpen` (средняя кнопка не закрывает).

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium globals.spec.js -g "средняя кнопка"`
Expected: FAIL — `defaultPrevented` равен `false` (замерено на текущем коде).

- [ ] **Step 3: Реализовать в `src/MyContext.js`

Добавить на уровне модуля константу `MIDDLE_MOUSE_BUTTON = 1` рядом с `PRIMARY_MOUSE_BUTTON`.

Добавить поле:

```js
/**
 * Средняя кнопка мыши не должна ничего делать с меню: она запускает автоскролл и
 * вставку по буферу, а `user-select: none` их не отменяет. Гасится всё дерево
 * меню, поэтому слушатель на уровне, а не на пункте: `#onItemDown` подписан только
 * на владельцев.
 *
 * @type {(event: PointerEvent) => void}
 */
#onLevelPointerDown = (event) => {
  if (this.#destroyed) {
    return;
  }
  if (event.button === MIDDLE_MOUSE_BUTTON) {
    event.preventDefault();
  }
};
```

В `#ensureLevel` добавить `entry.element.addEventListener('pointerdown', this.#onLevelPointerDown);`.

- [ ] **Step 4: Типы и коммит**

Run: `npm run typecheck && npx playwright test --project=chromium`
Expected: PASS.

```bash
git add src/MyContext.js tests/e2e/globals.spec.js
git commit -m "fix: средняя кнопка мыши по меню не гасилась"
```

---

### Task 8: Узкий скролбар у длинного списка

Претензия 7.

**Files:**
- Modify: `src/constants.js` не нужен; `styles/mycontext.css`
- Test: `tests/e2e/theme.spec.js`

**Interfaces:**
- Consumes: `--vc-muted`, `--vc-separator`.
- Produces: токен `--vc-scrollbar-thumb` в палитре `.vc-menu`; в `.vc-list` — `scrollbar-width: thin` и `scrollbar-color: var(--vc-scrollbar-thumb) transparent`.

- [ ] **Step 1: Падающий тест**

В `tests/e2e/theme.spec.js` добавить `'у прокручиваемого списка узкий скролбар'`: в `readBlock` блока `.vc-list` ждать `scrollbar-width: thin` и `scrollbar-color: var(--vc-scrollbar-thumb) transparent`; в палитре каждого селектора из `THEME_SELECTORS` ждать `--vc-scrollbar-thumb`; живой частью открыть сценарий с длинным списком и проверить `getComputedStyle(list).scrollbarWidth === 'thin'` при `scrollHeight > clientHeight`.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium theme.spec.js -g "узкий скролбар"`
Expected: FAIL — `scrollbar-width` равен `auto` (замерено на текущем коде).

- [ ] **Step 3: Правки `styles/mycontext.css`

В палитре `.vc-menu` и в обоих тёмных палитрах добавить `--vc-scrollbar-thumb: color-mix(in srgb, var(--vc-muted) 45%, transparent);` с комментарием: `--vc-separator` (12 % текста) на полосе не виден.

В `.vc-list` заменить комментарий о «системной полосе, которой библиотека не задаёт ширину» на правило `scrollbar-width: thin;` и `scrollbar-color: var(--vc-scrollbar-thumb) transparent;`. Псевдоэлементы `::-webkit-scrollbar` не добавлять и в комментарии объяснить, почему: там, где `scrollbar-width` поддержан, вебкитовские правила игнорируются, а там, где не поддержан, проект и так не работает.

- [ ] **Step 4: Типы и коммит**

Run: `npm run test:unit && npx playwright test --project=chromium`
Expected: PASS.

```bash
git add styles/mycontext.css tests/e2e/theme.spec.js
git commit -m "style: у длинного списка системный скролбар вместо узкого"
```

---

### Task 9: Демо показывает, что происходит по клику

Претензия 1. Единственная не библиотечная.

**Files:**
- Modify: `Demo/scenarios.js` (удалить `chosenIn` и доктрину «действие одно»)
- Modify: `Demo/demo.js` (`logIn`, `withItemActions`, узел лога в `buildScenario`)
- Modify: `Demo/demo.css` (оформление лога)
- Test: `tests/e2e/demo.spec.js`

**Interfaces:**
- Consumes: `Scenario` из `Demo/scenarios.js`; `menu.attach(block)` как сейчас.
- Produces: `withItemActions(scenarioId: string, items: Array<MenuItem | SeparatorItem>): Array<MenuItem | SeparatorItem>` в `Demo/demo.js` — глубокая копия дерева с `action` на каждом пункте. Разметка блока: `h2.demo-scenario__title`, `p.demo-scenario__hint`, `ol.demo-log[aria-live="polite"]` с `li` на каждый клик.

- [ ] **Step 1: Падающие тесты**

В `tests/e2e/demo.spec.js` удалить константу `CHOSEN_HINT` и переписать тест `'демо: клик по пункту с действием пишет выбор в подсказку и закрывает меню'` в `'демо: клик по пункту пишет его подпись в лог своего блока и закрывает меню'`: лог пуст, клик по пункту даёт ровно одну строку `li` с подписью пункта, меню закрыто; клик по пункту второго блока пишет в лог второго блока, а лог первого не меняется.

Добавить `'демо: клик по разделителю и отключённому пункту лога не даёт'`.

Добавить `'демо: у каждого блока свой лог'` — у всех шести блоков есть `ol.demo-log[aria-live="polite"]`, и все они пусты при загрузке страницы.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx playwright test --project=chromium demo.spec.js -g "лог"`
Expected: FAIL — узла `.demo-log` в разметке нет.

- [ ] **Step 3: `Demo/scenarios.js`**

Удалить `chosenIn` и весь комментарийный блок доктрины «Действие одно — на пункте "Открыть"» (строки 11–16 и 87–112), заменив его абзацем о том, что действия вешает страница, а не данные, и что пункт-владелец подменю в лог не пишет, потому что библиотека его действие не зовёт. В `baseItems()` убрать `action: chosenIn('basic', 'Открыть')` из пункта «Открыть» — теперь действия навешивает страница.

- [ ] **Step 4: `Demo/demo.js`**

Добавить `logIn(scenarioId, label)`, возвращающий функцию, которая дописывает `li` с текстом `label` в `ol.demo-log` блока `[data-scenario="scenarioId"]`; блок и журнал ищутся по `querySelector`, отсутствие — `Error`, как у `scenarioBlock`. Добавить `withItemActions(scenarioId, items)`: для каждого элемента, у которого `type === 'separator'`, вернуть его как есть; иначе вернуть `{ ...item, action: logIn(scenarioId, item.label), submenu: item.submenu === undefined ? undefined : withItemActions(scenarioId, item.submenu) }`.

В `buildScenario` передавать `new MyContext(withItemActions(scenario.id, scenario.items), { theme: 'auto', label: scenario.title })` и дописывать в `block.replaceChildren` четвёртым узлом `textElement`-подобный `ol.demo-log` c `aria-live="polite"`. Комментарий `chosenIn` о том, что дерево блока остаётся ровно тем же, что проверяет кейс о списке сценариев, переписать под три узла и журнал.

- [ ] **Step 5: `Demo/demo.css`**

Добавить правила `.demo-log`: `list-style: none; margin: 0.5rem 0 0; padding: 0; max-height: 7rem; overflow-y: auto; font-size: 0.85rem; color: var(--demo-muted);` и `.demo-log__item` с `border-left: 2px solid var(--demo-border)` и `padding-left: 0.5rem`. Строку `li` создавать существующим хелпером `textElement('li', 'demo-log__item', label)` — он уже принимает класс, переименовывать ничего не нужно.

- [ ] **Step 6: Починить остальные демо-тесты**

`'демо: токены меню перекрываются стилями демо, а не библиотеки'` и `'демо: переключение темы страницы не ломает меню'` читают `--vc-accent`, которого больше нет: переключить на `--vc-bg-solid` или `--vc-text` и обновить константы `LIBRARY_ACCENT`, `DEMO_LIGHT_ACCENT`, `DEMO_DARK_ACCENT` на новые значения. `'демо: список сценариев отрисован'` проверяет `height > 100` — с журналом останется в силе, но при добавлении лога проверить вручную.

- [ ] **Step 7: Типы и коммит**

Run: `npm run typecheck && npx playwright test --project=chromium demo.spec.js`
Expected: PASS.

```bash
git add Demo/scenarios.js Demo/demo.js Demo/demo.css tests/e2e/demo.spec.js
git commit -m "feat: журнал кликов в каждом блоке демо вместо одной перезаписываемой подсказки"
```

---

### Task 10: Документация не должна утверждать то, чего код не делает

Ни один тест этого не проверяет, но расхождение документации с кодом — тот же класс дефекта, что и остальные девять: пользователь, читающий README, получает неверный контракт.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-27-mycontext-design.md` (§6.1, §6.3, §9.1, §9.2, §9.6, §11, §13, раздел токенов)
- Modify: `README.md`
- Test: `tests/e2e/theme.spec.js` уже покрывает таблицу токенов из README? Нет — README не тестируется. Проверить вручную.

**Interfaces:**
- Consumes: все решения предыдущих девяти задач.
- Produces: правки текста, без изменений кода.

- [ ] **Step 1: Переписать §6.1 спеки 2026-09-27**

Удалить фразу «`open({x, y})` идемпотентен: повторный вызов на уже открытом меню перепозиционирует его, не пересоздавая». Заменить описанием полного цикла и того, что под `reduce` он синхронен. В пункте 6 «`focus({preventScroll: true})` на первый неотключённый пункт» заменить на фокус на элементе уровня без выделения.

- [ ] **Step 2: Переписать §6.3, §9.1, §9.2, §9.6**

§6.3: закрытие от любого пункта, а не только от активации с действием. §9.1: после открытия выделения нет, клавиши работают на элементе уровня, мышь и клавиатура делят один активный пункт, последнее взаимодействие выигрывает, кольца нет. §9.2: безопасная область вместо клина, с обоснованием, почему треугольник из точек курсора не может работать. §9.6: клик вне дерева, включая привязанный контейнер; уход курсора в список триггеров не входит.

- [ ] **Step 3: Переписать §11 и §13**

§11: заливка активного пункта равна мышиной, `:focus-visible` удалён и кольца нет, токены `--vc-accent` и `--vc-accent-text` удалены, `--vc-active-bg` по умолчанию `var(--vc-hover-bg)`, `--vc-scrollbar-thumb` добавлен, `.vc-list` имеет `scrollbar-width: thin`. Требование контраста 4.5:1 переписано: активный пункт тонированный, текст на нём `--vc-text`, и проверяется composited-контраст текста, а не «непрозрачность заливки». §13: убрать «диагональный ховер не роняет подменю» в старой формулировке, добавить «прямое движение к дальнему пункту подменю не роняет его» и «уход курсора с дерева не закрывает меню».

- [ ] **Step 4: Поправить README**

Строку про идемпотентность `open()` заменить описанием полного цикла. Раздел «Триггеры закрытия» — добавить клик по любому доступному пункту и убрать утверждение, что уход курсора закрывает. Таблицу токенов привести в соответствие с §11. Раздел про стили — убрать кольцо фокуса, если он там описан.

- [ ] **Step 5: Проверить и закоммитить**

Run: `npm run test:unit && npm run typecheck && npx playwright test --project=chromium`
Expected: PASS. Затем вручную `rg -n "идемпотент|vc-accent|focus-visible|safe-triangle|треугольник" README.md docs/superpowers/specs/2026-09-27-mycontext-design.md` и убедиться, что ни одно попадание не описывает удалённое поведение.

```bash
git add README.md docs/superpowers/specs/2026-09-27-mycontext-design.md
git commit -m "docs: спецификация и README перестали описывать идемпотентный open, кольцо и клин"
```

---

## Порядок и зависимости

```
Task 1 (hoverIntent)      ── независим
Task 2 (открытие/уровень) ── независим
Task 3 (мышь)            ── требует Task 2
Task 4 (цвет)            ── независим, но проверяет ту же отметку, что Task 3
Task 5 (закрытие)        ── независим
Task 6 (переоткрытие)    ── требует Task 5 (счётчик #openSerial)
Task 7 (средняя кнопка)  ── независим
Task 8 (скролбар)        ── независим
Task 9 (демо)            ── требует Task 5 (пункт без action обязан закрывать)
Task 10 (документация)    ── последним
```

Задачи 1, 4, 5, 7, 8 независимы и могут идти в любом порядке. Задачи 2 → 3 и 5 → 6 → 9 образуют две цепочки, и обе должны завершиться до 10.

## Проверка перед завершением

Полный прогон перед последним коммитом:

```bash
npm run typecheck
npm test
```

`npm test` гоняет все четыре проекта: `unit`, `chromium`, `firefox`, `webkit`. Успех на всех трёх движках обязателен: `pointermove`-семантика и `scrollbar-width` ведут себя по-разному в WebKit, а `page.clock` в Firefox иначе дрейфует.
