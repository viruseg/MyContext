# События фокуса пункта меню: `focusAction` и `blurAction` — план реализации

> **Для агентских исполнителей:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> (или superpowers:subagent-driven-development) to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автор может объявить у пункта меню `focusAction` и `blurAction` и узнавать о
передаче фокуса этому пункту и о её отмене — мышью и клавиатурой, на обычном пункте и на
пункте-владельце, причём действие вправе быть асинхронным.

**Architecture:** Движок клавиатуры (`src/keyboard.js`) владеет отметкой `data-active` и
DOM-фокусом пунктов, поэтому именно он сообщает хосту о каждой передаче фокуса одним
колбэком `itemFocusChanged(next)`. Экземпляр (`src/MyContext.js`) хранит поле
`#focusedItem` — «кому последний раз сообщили, что он в фокусе», — и на каждый вызов
либо молчит (повтор), либо зовёт `blurAction` прежнего и затем `focusAction` нового.
Парность и отсутствие дублей получаются из одного идемпотентного поля, а не из
сопоставления состояний.

**Tech Stack:** чистый ES-модуль без рантайм-зависимостей, JSDoc-типы, `tsc --noEmit`
как проверка типов, Playwright (`unit` и `chromium`), Chromium по умолчанию.

**Spec:** `docs/superpowers/specs/2026-10-05-item-focus-actions-design.md`

## Global Constraints

- Рантайм-зависимостей нет: в `package.json` нет поля `dependencies`, в `src/` не
  появляется ни одного нового импорта.
- Тесты гоняются только на Chromium и в `unit`, если в задаче не сказано иное:
  `npx playwright test --project=chromium <file>`; полный прогон —
  `npm run test` (`unit` + `chromium`, `--workers=2` из `playwright.config.js`).
  Firefox и WebKit не запускаются без прямой просьбы человека.
- Комментарии в `src/` объясняют «почему», а не «что»; JSDoc обязателен на всех
  публичных элементах, на внутренних — когда контракт неочевиден. Стиль — как в
  соседнем коде: длинные абзацы в шапках модулей и короткие пояснения у решений.
- Типы в JSDoc пишутся явно, `any`/`object` не используются; объединение
  `(() => void) | (() => Promise<void>)` вместо `() => void | Promise<void>` — по
  причине, записанной в `src/renderer.js:109`.
- Коммит на каждую задачу; сообщение в прошедшем времени, по-русски, в стиле
  `git log` (`feat:`, `fix:`, `docs:`, `test:`).
- Порядок в браузере и порядок вызовов, зафиксированные в спеке, не «уточняются» при
  реализации: `blur` прежнего всегда **до** `focus` нового.

## Review Focus

Пять входов и состояний, которые спека называет, но ни один её пункт не покрывает
собой, и которые правдоподобно укусят человека, пользующегося библиотекой. Для каждого
тест добавлен в задачу, владеющую кодом.

1. **Одностраничное меню из одного пункта, `ArrowDown` по кругу.** `moveTo` выбирает
   единственный доступный пункт, который уже в фокусе: автор не должен получить
   `focusAction` в ответ на нажатие, ничего не изменившее. → задача 2, кейс `moveTo` по
   кругу на единственном пункте.
2. **Авторский `focusAction` открывает или закрывает меню.** Слот записывается **до**
   вызова действия, поэтому действие, открывшее меню заново, не наследует фокус от
   прежнего и не «съедает» чужой. → задача 3, кейс действия, открывающего меню.
3. **Авторский `blurAction` бросает синхронно.** Исключение из обработчика DOM не должно
   прервать ни цепочку `blur` → `focus`, ни само закрытие меню, которое идёт следом.
   → задача 3, кейс отказа `blurAction` рядом с закрытием.
4. **Два экземпляра меню на странице, фокус в первом.** Слот принадлежит экземпляру, и
   чужой экземпляр не должен ни отнимать фокус, ни порождать `blurAction` у первого.
   → задача 3, кейс двух экземпляров.
5. **`focusAction` у пункта, который стал отключённым между показами.** Отметка и слот
   принадлежат показу; перечитывание доступности не должно звать `blurAction` у пункта,
   который не был в фокусе. → задача 3, кейс смены доступности при повторном показе.

---

### Task 1: Контракт пункта: два новых поля

**Files:**
- Modify: `src/renderer.js:97-119` (typedef `MenuItem`), `src/renderer.js:297-302`
  (`assertItem`)
- Test: `tests/unit/config.spec.js`

**Interfaces:**
- Consumes: `assertActionField(item, name, path, required)` из `src/renderer.js:254`.
- Produces: публичные поля `MenuItem.focusAction` и `MenuItem.blurAction` сигнатуры
  `(() => void) | (() => Promise<void>)`. Других задач это не меняет: поля опциональны и
  ни на что, кроме формы пункта, не влияют.

- [ ] **Step 1: Написать падающие тесты формы поля**

В `tests/unit/config.spec.js`, в `test.describe('валидация корневого состава', …)`,
рядом с кейсом про убранные поля добавь два кейса:

```js
  test('негодная форма focusAction отклоняется с путём до поля', () => {
    expect(() => menuOf([{ labelAction: () => 'Пункт', focusAction: 'звонить' }]))
      .toThrow('items[0].focusAction');
    expect(() => menuOf([{ labelAction: () => 'Пункт', blurAction: 42 }]))
      .toThrow('items[0].blurAction');
  });

  test('обе формы события фокуса принимаются', () => {
    // Объединение двух форм, а не `void | Promise<void>`: у `void` на выходе есть
    // правило совместимости, у объединения его нет, и действие, возвращающее
    // значение ради побочного эффекта, перестало бы подходить.
    expect(() => menuOf([
      {
        labelAction: () => 'Пункт',
        focusAction: () => log.push('фокус'),
        blurAction: async () => {
          await Promise.resolve();
        },
      },
    ])).not.toThrow();
  });
```

Переменной `log` в этом файле нет — объяви её в кейсе: `const log = [];`.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx playwright test --project=unit tests/unit/config.spec.js`
Expected: FAIL — первый кейс на `toThrow('items[0].focusAction')` падает без сообщения
(сейчас неизвестное поле молча игнорируется), второй проходит.

- [ ] **Step 3: Дописать typedef `MenuItem`**

В `src/renderer.js`, после блока `@property … [action]` (конец на строке 116) добавь
два `@property`. Текст JSDoc — по одному абзацу на поле, без пересказа кода:

```js
 * @property {(() => void) | (() => Promise<void>)} [focusAction] зовётся, когда
 *   пункт получает фокус: курсор встал на него, клавиша сдвинула выделение на него или
 *   подменю открылось с клавиатуры и фокус ушёл в его первый пункт. Одинаково для
 *   обычного пункта и для пункта-владельца, одинаково для мыши и для клавиатуры.
 *
 *   **Подсветка и фокус — разные вещи, и здесь второй раз.** Обычно пункт, получивший
 *   фокус, ещё и выделен, но не всегда: на пункте-владельце после `ArrowRight` отметка
 *   остаётся, а фокус уходит в подменю, и тогда `blurAction` владельца приходит при
 *   пункте, который всё ещё подсвечен. Читать его надо как «фокус ушёл с меня», а не
 *   как «меня сняли с выделения».
 *
 *   Промис, который вернул `await` этого вызова, ни на что не влияет и не ждётся:
 *   библиотеке ждать нечего, а порядок завершения таких действий не гарантирован —
 *   быстрые переходы дают пересекающиеся `focusAction` и `blurAction`. Всё, что нужно
 *   автору сделать по наведению, делается в его действии, а не в библиотеке.
 * @property {(() => void) | (() => Promise<void>)} [blurAction] зовётся, когда пункт
 *   теряет фокус: выделение ушло на соседа, курсор покинул дерево меню, подменю
 *   закрылось и фокус вернулся владельцу, меню закрылось или пункт исчез вместе со
 *   своим уровнем. Без `focusAction` действие не зовётся никогда, и наоборот: пара
 *   всегда полная, а повторная передача фокуса тому же пункту не порождает ничего.
```

- [ ] **Step 4: Научить `assertItem` проверять оба поля**

В `src/renderer.js:297-302`, после строки с `action`:

```js
  assertActionField(item, 'focusAction', path, false);
  assertActionField(item, 'blurAction', path, false);
```

Проверки результата, `Promise.all` в `resolveItem` и `RenderedItem`/`ResolvedItem` не
трогать: новые поля не влияют на подпись, доступность и подменю, а лишний элемент в
сборе уровня растянул бы показ.

- [ ] **Step 5: Прогнать тест и типы**

Run: `npx playwright test --project=unit tests/unit/config.spec.js && npm run typecheck`
Expected: PASS, `tsc` без ошибок.

- [ ] **Step 6: Закоммитить**

```bash
git add src/renderer.js tests/unit/config.spec.js
git commit -m "feat: контракт событий фокуса пункта"
```

---

### Task 2: Движок сообщает о передаче фокуса

**Files:**
- Modify: `src/keyboard.js:135-179` (typedef `KeyboardHost`), `:395-403`
  (`activate`), `:414-428` (`activateFromPointer`), `:441-447` (`clearActive`),
  `:674-679` (`reset`), `:685-689` (`forgetLevels`), шапка `:4` и описания
  `:249-254`
- Modify: `src/MyContext.js:2867-2906` (`#keyboardHost`) — добавить колбэк-заглушку
- Test: `tests/e2e/keyboard.spec.js`

**Interfaces:**
- Consumes: `RenderedItem` (`src/keyboard.js:128`), `activeItemOf(entry)`
  (`src/keyboard.js:304`), `entry.element`.
- Produces: `KeyboardHost.itemFocusChanged: (next: RenderedItem | null) => void`.
  Задача 3 реализует тело этого колбэка в `MyContext`; здесь оно молчит, чтобы поведение
  экземпляра не менялось раньше времени.

- [ ] **Step 1: Написать падающие тесты на синтетическом хосте**

В `tests/e2e/keyboard.spec.js` фикстура уже строит настоящий слой и настоящий движок, а
хост в ней синтетический, и журнал его вызовов уже отдаётся снимком
(`read()` → `ProbeSnapshot.calls`, `:807`). Поэтому расширяется существующий журнал, а
не заводится новый.

Три правки фикстуры:

1. В typedef `HostCalls` (`:118-121`) добавь поле
   `@property {string[]} focusChanges подписи пунктов, которым сообщили о фокусе, и
   строка `'нет'` на каждый вызов с `null`.`
2. В объект `calls` (`:489-496`) добавь `focusChanges: [],`
3. В хост (`:533`, рядом с `focusOwner`) добавь колбэк:

```js
      itemFocusChanged(next) {
        calls.focusChanges.push(next === null ? 'нет' : labelIn(next.element));
      },
```

`labelIn` уже объявлен в фикстуре (`:665`). Через `{ ...calls }` в `read()` новое поле
доедет до снимка само.

Набор `solo` для кейса про круг — в `sets` (`:399`) добавь
`const solo = [{ labelAction: () => 'Один' }];` и ключ `solo` в `sets`.

Кейсы в конец файла:

```js
test.describe('передача фокуса', () => {
  test('стрелка вниз даёт focus по одному разу на пункт', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'tail',
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
      ],
    });
    expect(result.after.calls.focusChanges).toEqual(['Первый', 'Второй']);
  });

  test('moveTo по кругу на единственном пункте молчит', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'solo',
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowDown' },
        { command: 'press', key: 'ArrowUp' },
      ],
    });
    expect(result.after.calls.focusChanges).toEqual(['Один']);
  });

  test('возврат на уже отмеченный пункт молчит', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'cycle',
      paths: { root: [] },
      steps: [
        { command: 'hover', at: { path: [], index: 0 } },
        { command: 'hover', at: { path: [], index: 0 } },
      ],
    });
    expect(result.after.calls.focusChanges).toEqual(['Первый']);
  });

  test('leave-tree снимает фокус один раз', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'cycle',
      paths: { root: [] },
      steps: [
        { command: 'hover', at: { path: [], index: 0 } },
        { command: 'leave-tree' },
        { command: 'leave-tree' },
      ],
    });
    expect(result.after.calls.focusChanges).toEqual(['Первый', 'нет']);
  });

  test('reset снимает фокус', async ({ page }) => {
    const result = await runScenario(page, {
      set: 'cycle',
      paths: { root: [] },
      steps: [
        { command: 'press', key: 'ArrowDown' },
        { command: 'reset' },
      ],
    });
    expect(result.after.calls.focusChanges).toEqual(['Первый', 'нет']);
  });

  test('уход с уровня без фокуса на нём молчит', async ({ page }) => {
    // Фокус стоит на владельце в корне, а сбрасывается подменю: сообщать нечего, и
    // ложный `null` отдал бы чужой пункт в небыль.
    const result = await runScenario(page, {
      set: 'offLimits',
      paths: { root: [], sub: [2] },
      steps: [
        { command: 'hover', at: { path: [], index: 2 } },
        { command: 'show-submenu', at: { path: [], index: 2 } },
        { command: 'leave-tree', at: { path: [2] } },
      ],
    });
    expect(result.after.calls.focusChanges).toEqual(['Живой владелец']);
  });
});
```


- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx playwright test --project=chromium tests/e2e/keyboard.spec.js`
Expected: FAIL — `focusChanges` пуст, все четыре кейса расходятся.

- [ ] **Step 3: Добавить колбэк в `KeyboardHost`**

В `src/keyboard.js`, в typedef `KeyboardHost` после `property {(item: RenderedItem,
event: KeyboardEvent) => void} handOver`:

```js
 * @property {(next: RenderedItem | null) => void} itemFocusChanged сообщает, кому
 *   теперь принадлежит фокус пунктов меню, либо `null`, если фокус ушёл с них на
 *   элемент уровня или с дерева вовсе. Зовётся после того, как состояние применено:
 *   отметка стоит, фокус передан, и вызывающий код видит то же, что видит браузер.
 *
 *   **Повтор с тем же `next` молчит, а отсутствие вызова — законный ответ.** Вызов с
 *   `next`, совпадающим с тем, о ком сообщали в прошлый раз, не порождает ничего:
 *   движок не различает «фокус перешёл» и «фокус остался там же». И наоборот —
 *   `clearActive` не зовёт колбэк, если фокус стоял не на сбрасываемом уровне, потому
 *   что фокус тогда никуда не ушёл.
```

- [ ] **Step 4: Разослать вызовы из пяти мест**

`activate` (`src/keyboard.js:395`), после строки с `scrollIntoView`:

```js
    host.itemFocusChanged(item);
```

`activateFromPointer` (`src/keyboard.js:414`): вызов ставится **в обеих ветках** —
в раннем выходе, где пункт уже отмечен, и после `markActive`:

```js
    if (item.element.hasAttribute(ACTIVE_ATTRIBUTE)) {
      if (document.activeElement !== item.element) {
        item.element.focus({ preventScroll: true });
      }
      host.itemFocusChanged(item);
      return;
    }
    markActive(entry, item);
    item.element.focus({ preventScroll: true });
    host.itemFocusChanged(item);
```

`clearActive` (`src/keyboard.js:441`) — с условием, что фокус был внутри уровня:

```js
  function clearActive(entry) {
    clearMarksOf(entry);
    const active = document.activeElement;
    if (active !== null && entry.element.contains(active)) {
      entry.element.focus({ preventScroll: true });
      host.itemFocusChanged(null);
    }
  }
```

`reset` (`src/keyboard.js:674`) — безусловно, дерево уходит целиком:

```js
  function reset() {
    for (const entry of known.values()) {
      clearMarksOf(entry);
    }
    host.itemFocusChanged(null);
    known.clear();
  }
```

`forgetLevels` (`src/keyboard.js:685`) — только когда у снесённого уровня была отметка:

```js
  function forgetLevels(entries) {
    for (const entry of entries) {
      if (activeItemOf(entry) !== null) {
        host.itemFocusChanged(null);
      }
      known.delete(entry.element);
    }
  }
```

- [ ] **Step 5: Добавить заглушку в `#keyboardHost()`**

В `src/MyContext.js:2905`, после `focusOwner`, добавь:

```js
      // Движок сообщает о передаче фокуса, экземпляр на этом шаге молчит: тело
      // приходит следующей задачей вместе с разбором отказов.
      itemFocusChanged() {},
```

- [ ] **Step 6: Обновить шапку `keyboard.js` и два описания**

- В шапке (после абзаца про `data-active` и `:focus`) добавь абзац о новой обязанности
  модуля: он сообщает о передаче фокуса и не знает, что с ней делать, — как не знает
  про карту активов.
- В описании `forgetLevels` (`src/keyboard.js:249-254`) убери «Отметки роуминга с них
  не снимаются» как reasons и добавь: снять нечего, узла нет, но вызывающий код узнаёт
  о потере фокуса.
- В описании `clearActive` добавь, что вызов `itemFocusChanged(null)` происходит только
  когда фокус был внутри сбрасываемого уровня.

- [ ] **Step 7: Прогнать тест и типы**

Run: `npx playwright test --project=chromium tests/e2e/keyboard.spec.js && npm run typecheck`
Expected: PASS, `tsc` без ошибок.

- [ ] **Step 8: Закоммитить**

```bash
git add src/keyboard.js src/MyContext.js tests/e2e/keyboard.spec.js
git commit -m "feat: движок сообщает о передаче фокуса пункту"
```

---

### Task 3: Экземпляр зовёт действия пункта

**Files:**
- Modify: `src/MyContext.js` — поле `#focusedItem` рядом с `#hoverOwner`, тело
  `#itemFocusChanged` рядом с `#actionFor`, `#invokeFocusAction` рядом с
  `#invokeItemAction`, колбэк в `#keyboardHost()`
- Test: `tests/e2e/focusActions.spec.js` (создать)

**Interfaces:**
- Consumes: `KeyboardHost.itemFocusChanged` из задачи 2;
  `#actionFor(rendered): MenuItem | null` (`src/MyContext.js:1062`);
  `#fireAndForget(result, source)` (`:3678`); `#reportFailure(reason, source)` (`:3633`).
- Produces: `MyContextItem.focusAction`/`blurAction` вызываются автору.

- [ ] **Step 1: Написать падающий файл тестов**

Создай `tests/e2e/focusActions.spec.js` по образцу `tests/e2e/events.spec.js`: та же
страница (`#surface` во весь вьюпорт, `emulateMedia({ reducedMotion: 'reduce' })`),
фикстура в `test.beforeEach` ставит `globalThis.mc` через `page.evaluate` и
динамический импорт `../../src/index.js`.

Фикстура собирает меню с журналом и тремя дополнительными средствами:

- `log: string[]` — в него пишут сами `focusAction`/`blurAction` вида
  `focus:Метка` и `blur:Метка`.
- `snap()` — снимок `log` **в момент вызова**: `{ label, active: element.hasAttribute('data-active'), focused: document.activeElement === element, level: aria-label }`. Журнал состояний нужен для порядка и для проверки «отметка стоит, а фокус ушёл».
- `failNext: 'focus' | 'blur' | null` — следующее действие бросает; `pageErrors: string[]` собирает `window.onerror`.

Состав меню:

```js
    [
      { labelAction: () => 'Первый', action: () => {}, focusAction: () => note('focus', 'Первый'), blurAction: () => note('blur', 'Первый') },
      { labelAction: () => 'Второй', action: () => {}, focusAction: () => note('focus', 'Второй'), blurAction: () => note('blur', 'Второй') },
      { type: 'separator' },
      {
        labelAction: () => 'Ветка',
        submenuAction: () => [
          { labelAction: () => 'Лист', action: () => {}, focusAction: () => note('focus', 'Лист'), blurAction: () => note('blur', 'Лист') },
          { labelAction: () => 'Галочка', isEnabledAction: () => false, focusAction: () => note('focus', 'Галочка') },
        ],
        focusAction: () => note('focus', 'Ветка'),
        blurAction: () => note('blur', 'Ветка'),
      },
    ]
```

`note(kind, label)` пишет строку и **снимает снимок** (§выше). Опции: `{ label: 'Меню',
theme: 'light' }`. Точки и константы — как в `events.spec.js` (`INSIDE_POINT`,
`OUTSIDE_POINT`, `FAR_POINT`).

- [ ] **Step 2: Кейсы на передачу и возврат**

```js
test('наведение мышью зовёт focus один раз', async ({ page }) => { /* hover по «Первый», затем ещё раз по тому же */ });
test('стрелка вниз зовёт focus, переход между пунктами — blur до focus', async ({ page }) => { /* ArrowDown, ArrowDown */ });
test('уход курсора с меню зовёт blur один раз', async ({ page }) => { /* hover, увести курсор, увести ещё раз */ });
test('уход курсора при подменю, открытом мышью, не зовёт blur', async ({ page }) => { /* hover «Ветка», дождаться подменю, увести курсор */ });
test('пункт-владелец получает focus так же, как обычный', async ({ page }) => { /* hover «Ветка» */ });
test('ArrowRight зовёт blur владельца при стоящей отметке', async ({ page }) => { /* ArrowDown×2 до «Ветка», ArrowRight, сверить снимок */ });
test('ArrowLeft зовёт blur пункта подменю и focus владельца', async ({ page }) => { /* …, ArrowRight, ArrowLeft */ });
test('focus и blur парны на любом сценарии', async ({ page }) => { /* длинный сценарий: навести, увести, стрелки, ArrowRight, ArrowLeft, закрыть — и сверить, что каждому focus соответствует ровно один blur той же метки */ });
```

В последних трёх проверяется содержимое `snap()`: у владельца после `ArrowRight`
`snap.active === true` и `snap.focused === false` — это и есть проверка оговорки
«подсветка не равна фокусу».

- [ ] **Step 3: Кейсы на закрытие и снос**

```js
test('Escape зовёт blur до события close', async ({ page }) => { /* hover, Escape, сверить порядок в журнале: blur, затем close */ });
test('клик вне зовёт blur', async ({ page }) => { /* hover, клик по FAR_POINT */ });
test('выбор пункта зовёт blur', async ({ page }) => { /* hover, клик по пункту */ });
test('Tab зовёт blur', async ({ page }) => { /* hover, Tab */ });
test('перестроение состава зовёт blur снесённого пункта', async ({ page }) => { /* hover, сменить состав на новые объекты через перечитывание, open() заново */ });
test('снос соседнего поддерева не зовёт blur владельца', async ({ page }) => { /* открыть подменю «Ветка», раскрыть «Лист»-подменю, закрыть его */ });
```

- [ ] **Step 4: Кейсы на асинхронность и отказы**

```js
test('асинхронный focusAction зовётся и не мешает меню', async ({ page }) => { /* focusAction: async () => { await delay(10); note(...) } */ });
test('отказ focusAction приходит в error с source focusAction', async ({ page }) => { /* failNext = 'focus'; подписаться на error в фикстуре */ });
test('отказ focusAction не снимает выделение', async ({ page }) => { /* failNext = 'focus'; после error сверить data-active на пункте и то, что меню живо */ });
test('отказ blurAction приходит в error с source blurAction', async ({ page }) => { /* failNext = 'blur' */ });
test('отказ без подписчикаerror даёт pageerror', async ({ page }) => { /* без подписки, читать pageErrors */ });
test('отказ с preventDefault даёт тишину', async ({ page }) => { /* подписчик зовёт preventDefault для своего source */ });
test('действия получают ноль аргументов', async ({ page }) => { /* note пишет arguments.length */ });
```

- [ ] **Step 5: Кейсы Review Focus**

```js
test('отказ blurAction не прерывает закрытие', async ({ page }) => { /* failNext = 'blur'; Escape; ждать закрытия и проверить, что blur следующего пункта и close тоже пришли */ });
test('два экземпляра не отнимают фокус друг у друга', async ({ page }) => { /* открыть A и B, навести в A, в B не наводить; blur в A не приходит */ });
test('пункт, ставший отключённым, не получает blur', async ({ page }) => { /* активный пункт меняет isEnabledAction на false, open() заново: focus не зовётся, отметки нет */ });
test('действие, открывшее меню заново, не наследует фокус', async ({ page }) => { /* focusAction первого пункта зовёт open(); после переоткрытия focus не приходит без нового перехода */ });
```

- [ ] **Step 6: Убедиться, что тесты падают**

Run: `npx playwright test --project=chromium tests/e2e/focusActions.spec.js`
Expected: FAIL — журнал пуст, все кейсы расходятся.

- [ ] **Step 7: Добавить поле и тело в `MyContext`**

Поле рядом с `#hoverOwner`:

```js
  /**
   * Пункт, которому последний раз сообщили, что он получил фокус. Единственный
   * источник правды о том, кому мы обещали фокус: по нему же видно, что обещание
   * снято, и по нему же отличается «фокус перешёл» от «фокус остался там же».
   */
  #focusedItem;
```

Тело рядом с `#actionFor`:

```js
  /**
   * Передача фокуса пункту меню: снимает обещание с прежнего и даёт новому.
   *
   * **Идемпотентно по `next`.** Тот же пункт, что и в `#focusedItem`, молчит: движок
   * не различает «фокус перешёл» и «фокус остался там же», а различать это автору
   * незачем — пару «focus без blur» он бы всё равно не получил.
   *
   * **Поле записывается до вызова любого действия.** Авторское действие вправе
   * открыть или закрыть меню, и записанный слот пережил бы такой поворот, а
   * полузаписанный — отдал бы чужому действию несуществующее состояние.
   *
   * @param {RenderedItem | null} next пункт, получивший фокус, либо `null`, если
   *   фокус отошёл на элемент уровня или с дерева вовсе.
   * @returns {void}
   */
  #itemFocusChanged(next) {
    const previous = this.#focusedItem;
    if (previous === next) {
      return;
    }
    this.#focusedItem = next;
    if (previous !== null) {
      this.#invokeFocusAction(previous, 'blurAction');
    }
    if (next !== null) {
      this.#invokeFocusAction(next, 'focusAction');
    }
  }
```

- [ ] **Step 8: Добавить вызов действия**

```js
  /**
   * Зовёт событие фокуса пункта и разбирает его отказ.
   *
   * Ждать нечего: зовётся из обработчика DOM, где промис никто не забирает, а
   * состояние меню к этому моменту уже применено и от действия не зависит. Отказ
   * приходит событием `error` — тем же, что у `action`, — и не отменяет ничего:
   * подсветка уже стоит, показ подменю уже планирован.
   *
   * @param {RenderedItem} rendered пункт, чьё событие зовётся.
   * @param {'focusAction' | 'blurAction'} field имя поля в карте действий.
   * @returns {void}
   */
  #invokeFocusAction(rendered, field) {
    const item = this.#actionFor(rendered);
    if (item === null || item[field] === undefined) {
      return;
    }
    this.#fireAndForget(
      Promise.resolve().then(() => item[field]()),
      field,
    );
  }
```

- [ ] **Step 9: Заменить заглушку в `#keyboardHost()`**

`itemFocusChanged()` → `itemFocusChanged: (next) => { this.#itemFocusChanged(next); }`,
без комментария-заглушки.

- [ ] **Step 10: Прогнать новый набор**

Run: `npx playwright test --project=chromium tests/e2e/focusActions.spec.js`
Expected: PASS.

- [ ] **Step 11: Прогнать весь Chromium и типы**

Run: `npm run test && npm run typecheck`
Expected: PASS, `tsc` без ошибок. Если упало что-то из прежних 413 проверок —
причина в этой задаче, а не в тесте: правился `src/`.

- [ ] **Step 12: Закоммитить**

```bash
git add src/MyContext.js tests/e2e/focusActions.spec.js
git commit -m "feat: события фокуса пункта зовут действия автора"
```

---

### Task 4: README и демо

**Files:**
- Modify: `README.md` — раздел «Пункты и подменю» (после `action`),
  «Использование» (абзац про фокус), «События» (упоминание `source`),
  «Ограничения»
- Modify: `Demo/scenarios.js`

**Interfaces:**
- Consumes: публичный контракт задач 1 и 3.
- Produces: ничего исполняемого; документация и ручной сценарий.

- [ ] **Step 1: Дописать README**

В справочнике полей пункта, после блока `action`, добавь подраздел `#### focusAction и
blurAction` с тремя абзацами и таблицей:

| Пункт | Когда зовётся |
|---|---|
| `focusAction` | курсор встал на пункт, стрелка сдвинула выделение на него, `ArrowRight` увёл фокус в первый пункт подменю |
| `blurAction` | выделение ушло соседу, курсор покинул дерево меню, `ArrowLeft` вернул фокус владельцу, меню закрылось, пункт исчез вместе со своим уровнем |

Третий абзац — про «подсветка не равна фокусу», формулировкой §6 спеки.

В «События» допиши в перечисление `source` два новых имени
(`'focusAction'`, `'blurAction'`).

- [ ] **Step 2: Сценарий демо**

В `Demo/scenarios.js` добавь сценарий с тремя пунктами, у каждого `focusAction`, который
пишет подпись пункта в `#hover-log`, и `blurAction`, который дописывает `убыл`. Сценарий
объявляется в уже существующем массиве сценариев файла — следуй его форме.

- [ ] **Step 3: Прогнать типы и проверить демо вручную**

Run: `npm run typecheck`
Expected: без ошибок. Демо: `npm run serve`, открыть `http://127.0.0.1:4173/`, правый
клик по сценарию, навести пункт стрелкой и курсором, увести курсор, нажать `Escape`.

Ожидаемо: `фокус:Имя` при наведении, `убыл:Имя` при уходе, `убыл` последнего пункта при
`Escape`.

- [ ] **Step 4: Закоммитить**

```bash
git add README.md Demo/scenarios.js
git commit -m "docs: события фокуса пункта в README и демо"
```
