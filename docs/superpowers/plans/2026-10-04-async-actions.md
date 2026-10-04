# Асинхронные пользовательские действия — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Любое действие, которое передаёт автор, может быть `async`, и библиотека это корректно разбирает: данные уровня собираются параллельно до отрисовки, висящий показ отменяется, отказ не теряется.

**Architecture:** Рендерер переходит на два прохода — `Promise.all` собирает `ResolvedItem` для всех пунктов уровня, затем один синхронный проход строит DOM. Отсюда каскад `renderLevel` → `createEntry`/`reconcile`/`ensureLevel` → `#showAt`/`#leadAhead`/`#openSubmenu`, и публичные `open`/`openSubmenu`/`openAsSubmenu` начинают возвращать `Promise<void>`. Показ, ждущий данных, отменяется по счётчику поколений, который теперь растёт и на закрытии. Отказы пользовательских действий идут в новое событие `error`, и перебрасываются как непойманная ошибка страницы, если подписчик не вызвал `preventDefault()`.

**Tech Stack:** чистый ES2026, без runtime-зависимостей и без сборки; JSDoc + `tsc --noEmit`; Playwright (`unit` + `chromium`).

**Spec:** `docs/superpowers/specs/2026-10-04-async-actions-design.md`

## Global Constraints

- Тесты гоняются только на Chromium и `unit`: `npx playwright test --project=unit --project=chromium --workers=2`. Firefox и WebKit не запускаются без прямой просьбы.
- `npm run typecheck` обязан проходить после каждой задачи: `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit`.
- В `package.json` нет поля `dependencies` и не появится; модуль импортируется прямо из `src/`.
- Комментарии и сообщения об ошибках — по-русски, и объясняют «почему», а не «что»; новых комментариев, пересказывающих код, не писать.
- Никаких `any` и нетипизированных структур в публичных сигнатурах; каждый новый промис получает `@returns {Promise<…>}`.
- Ветка `main`, коммит на каждый шаг с пометкой; сообщения коммитов в стиле репозитория (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`).
- Новый файл тестов: `tests/e2e/asyncActions.spec.js`. Вспомогательные фикстуры для `page.evaluate` — по образцу `tests/e2e/contracts.spec.js` (строка `PAGE_HTML` плюс `window.__mc`).
- Никаких заглушек для пунктов меню, никаких отложенных показов «как раньше» и никаких двух путей вызова действий.
- `src/hoverIntent.js`, `src/positioner.js`, `src/geometry.js`, `src/theme.js`, `src/icons.js`, `src/scrollZones.js` не меняются.

## File Structure

| Файл | Ответственность после правок |
|---|---|
| `src/renderer.js` | `resolveItem` читает четыре действия параллельно; `renderLevel`/`renderItem`/`refreshItems` возвращают промисы; `submenuHashOf` без изменений |
| `src/layer.js` | `createEntry`, `reconcile`, `ensureLevel` становятся асинхронными; перестраивание отменённого уровня не применяется |
| `src/keyboard.js` | `handleKeydown` асинхронен; `ArrowRight` и `Enter` гасят событие до `await` |
| `src/MyContext.js` | новые `#reportFailure`, `#fireAndForget`, `#showCancelled`; отмена висящего показа; асинхронные `#invokeItemAction`, `#handOverTo`, `#isArmable`; обёртка подписчика |
| `tests/e2e/asyncActions.spec.js` | новые проверки асинхронных действий, отмены и отказов |
| `tests/e2e/renderer.spec.js` | `await` на всех вызовах `renderLevel`/`renderItem` |
| `README.md` | новые сигнатуры, снятие обещания синхронного показа, раздел про отказы |

`src/MyContext.js` уже 3457 строк и станет примерно на 200 длиннее. Дробление файла в этот план не входит: `#`-поля связаны между собой, а разбор не входит в предмет спеки (`§10`).

---

### Task 1: Разбор отказов и событие `error`

Фундамент для задач 3–7: они зовут `#reportFailure` оттуда.

**Files:**
- Modify: `src/MyContext.js` — рядом с `#assertAlive` (строка 3287) добавить три приватных метода; рядом с typedef `OpenEventDetail` (строка 152) добавить typedef
- Test: `tests/e2e/asyncActions.spec.js`

**Interfaces:**
- Consumes: ничего
- Produces:
  ```js
  /** @typedef {{ reason: unknown, source: string }} ErrorEventDetail */
  #reportFailure(reason: unknown, source: string): void
  #fireAndForget(result: unknown, source: string): void
  ```
  `#fireAndForget` не возвращает промис — он привязывает отказ и забывает.

- [ ] **Step 1: Write the failing tests**

В `tests/e2e/asyncActions.spec.js` создай фикстуру `window.__mc` по образцу `tests/e2e/contracts.spec.js` со следующими возможностями (все через `page.evaluate`):

```js
/**
 * @typedef {object} AsyncProbe
 * @property {(options: Record<string, unknown>) => void} make
 *   завести меню с пунктом, чей `action` — заданная функция
 * @property {(kind: 'action' | 'listener') => Promise<boolean>} readHandled
 *   `true`, если подписчик `error` получил событие
 * @property {() => Promise<boolean>} readPrevented
 *   `true`, если подписчик вызвал `preventDefault()`
 * @property {(kind: 'action' | 'listener') => Promise<void>} activate
 *   активировать пункт по клику / вызвать подписчика `open`
 * @property {() => Promise<number>} readOpenCount
 * @property {() => Promise<boolean>} readVisible
 */
```

Тесты:

```js
test('отказ действия доходит до подписчика error с отказом в detail', async ({ page }) => { /* activate('action'); readHandled('action') === true; readPrevented() === false */ });

test('отказ действия с preventDefault в подписчике не доходит до страницы', async ({ page }) => { /* подписчик вызывает preventDefault(); pageerror не ловится */ });

test('отказ действия без подписчика error виден как непойманная ошибка страницы', async ({ page }) => { /* page.on('pageerror') ловит отказ */ });

test('отказ подписчика open доходит до error, не зацикливаясь', async ({ page }) => { /* подписчик open сам возвращает отклонённый промис; событий error ровно одно */ });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — `readHandled` всегда `false`, потому что события `error` не существует.

- [ ] **Step 3: Implement `#reportFailure` in `src/MyContext.js`**

```js
#reportFailure(reason, source) {
  const detail = { reason, source };
  this.dispatchEvent(new CustomEvent('error', { detail, cancelable: true }));
  if (...) { return; }
  queueMicrotask(() => { throw reason; });
}
```

Условие отказа от дальнейшего броска — `event.defaultPrevented` у собственного события `error`. Рассылка события идёт **до** проверки, иначе `preventDefault` подписчика не на что было бы влиять.

**Против бесконечного цикла.** Подписчик `error`, который сам возвращает отклонённый промис, будет ловить собственный отказ обратно в `#reportFailure` — бесконечная петля. Поэтому `#reportFailure` берёт `#reportingFailure` — приватный булев признак, который ставится на время рассылки и снимается в `finally`:

```js
#reportingFailure = false;
```

В начале тела: `if (this.#reportingFailure) { queueMicrotask(() => { throw reason; }); return; }`. Внутренний отказ, пришедший из подписчика `error`, уходит в бросок, а не в новое событие `error`.

- [ ] **Step 4: Implement `#fireAndForget`**

```js
#fireAndForget(result, source) {
  Promise.resolve(result).catch((reason) => { this.#reportFailure(reason, source); });
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2 && npm run typecheck`
Expected: все четыре теста PASS, typecheck чист.

- [ ] **Step 6: Commit**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js
git commit -m "feat: событие error и разбор отказов пользовательских действий"
```

---

### Task 2: Ожидание программных показов в существующих тестах

Подготовка, отдельная от поведения: `await` над значением `undefined` безвреден, поэтому задача проходит на текущем коде и снимает блокировку для задачи 3.

**Files:**
- Modify: `tests/e2e/contracts.spec.js` (`openAt` строка 132, `scope.__mc.open` строка 415)
- Modify: `tests/e2e/autoHide.spec.js` (`openAt` строка 138, `menu.open` строка 225)
- Modify: `tests/e2e/renderer.spec.js` — только если в нём есть вызов `renderLevel` без `await` (проверь; правки в основном придутся в задачу 3)

**Interfaces:**
- Consumes: ничего
- Produces: ничего; все `page.evaluate`, вызывающие `open()`/`openSubmenu()`/`openAsSubmenu()`, теперь возвращают промис наружу и ждут его.

- [ ] **Step 1: Write the failing tests**

Тестов нет. Задача проверяется тем, что прогон остаётся зелёным: заранее зафиксируй результат командой из Step 3 и сравнивай с ним.

- [ ] **Step 2: Skip — шага нет**

Правка механическая, отдельного падающего теста у неё нет.

- [ ] **Step 3: Add `await` to the two `openAt` helpers and the bare `open()` calls**

В `contracts.spec.js:132` тело `page.evaluate` должно вернуть промис:

```js
function openAt(page, point) {
  return page.evaluate(async (payload) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    await scope.__mc.open(payload.x, payload.y);
  }, point);
}
```

То же в `autoHide.spec.js:138` и в одиночных `menu.open(...)` внутри `page.evaluate` в обоих файлах.

- [ ] **Step 4: Run the affected tests**

Run: `npx playwright test --project=unit --project=chromium tests/e2e/contracts.spec.js tests/e2e/autoHide.spec.js --workers=2`
Expected: PASS, число тестов не изменилось.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/contracts.spec.js tests/e2e/autoHide.spec.js
git commit -m "test: программные показы в тестах ждут завершения"
```

---

### Task 3: Читающие действия становятся асинхронными

`labelAction`, `iconAction`, `submenuAction`, `isEnabledAction` начинают ждаться. Каскад сигнатур неделится: правка рендерера без слоя, слоя без `MyContext` и `MyContext` без движка не компилируется.

**Files:**
- Modify: `src/renderer.js` — `isEnabledOf` 408, `labelOf` 420, `iconOf` 436, `submenuOf` 451, `resolveItem` 519, `renderMenuItem` 680, `renderItem` 743, `renderLevel` 777, `refreshItems` 855
- Modify: `src/layer.js` — `createEntry` 444, `reconcile` 491, `ensureLevel` 564, typedef `MenuLayer.ensureLevel` 225
- Modify: `src/MyContext.js` — `#ensureLevel` 2998, `#ensureSubmenuLevel` 3155, `#leadAhead` 3073, `#showAt` 2297, `#openSubmenu` 2678, `#openSubmenuFromKeyboard` 2709, `#showWhatItemLeadsTo` 2744, `#showAsSubmenu` 2394, `openSubmenu` 2376, `openAsSubmenu` 2427, `open` 2045, `#onLevelClick` 915, `#onContextMenu` 1303, `#keyboardHost` 2617
- Modify: `src/keyboard.js` — typedef `KeyboardHost.openSubmenu` 143, `handleKeydown` 543
- Test: `tests/e2e/asyncActions.spec.js`, `tests/e2e/renderer.spec.js`

**Interfaces:**
- Consumes: `#fireAndForget`, `#reportFailure` из задачи 1
- Produces:
  ```js
  // src/renderer.js
  export function resolveItem(item: MenuItem, path: string): Promise<ResolvedItem>
  export function renderItem(item: MenuItem | SeparatorItem, context: RenderContext, itemIndex: number, setSize: number): Promise<RenderedItem>
  export function renderLevel(items: Array<MenuItem | SeparatorItem>, context: RenderContext): Promise<RenderedLevel>
  export function refreshItems(items: Array<MenuItem | SeparatorItem>, renderedItems: RenderedItem[], menuId: string, actions: Map<string, MenuItem>): Promise<void>
  // src/layer.js
  ensureLevel(items, parent: LevelEntry | null, levelIndex: number, ownerItem: RenderedItem | null): Promise<LevelEntry>
  // src/keyboard.js
  KeyboardHost.openSubmenu: (entry: LevelEntry) => Promise<LevelEntry>
  handleKeydown(event: KeyboardEvent): Promise<void>
  // src/MyContext.js
  open(params: Point, options?: OpenOptions): Promise<void>
  openSubmenu(x: number, y: number, handoff?: SubmenuHandoff): Promise<void>
  openAsSubmenu(x: number, y: number): Promise<void>
  ```

- [ ] **Step 1: Write the failing tests**

В `tests/e2e/asyncActions.spec.js`:

```js
test('асинхронный labelAction рисует подпись, а меню появляется после сбора данных', async ({ page }) => {
  await page.evaluate(() => import('/src/index.js'));
  await openMenu(page, { items: [{ labelAction: async () => { await delay(20); return 'Экспорт'; } }] });
  expect(await readLabels(page)).toEqual(['Экспорт']);
});

test('асинхронный iconAction рисует иконку', async ({ page }) => { /* iconAction: async () => ({ type: 'emoji', value: '★' }) */ });

test('асинхронный submenuAction раскрывает подменю с шевроном и aria-owns', async ({ page }) => { /* проверить .vc-chevron у владельца и подменю по ArrowRight */ });

test('асинхронный isEnabledAction гасит пункт в кольцо роуминга', async ({ page }) => { /* aria-disabled="true" и пункт не выделяется стрелками */ });

test('отказ читающего действия отклоняет промис open и не показывает меню', async ({ page }) => {
  await expect(openMenu(page, { items: [{ labelAction: async () => { throw new Error('нет данных'); } }] })).rejects.toThrow('нет данных');
  expect(await readVisible(page)).toBe(false);
});

test('отказ читающего действия через contextmenu приходит в error', async ({ page }) => { /* правый клик по контейнеру, затем readHandled */ });

test('уровень, снесённый во время перечитывания, не принимает ответы и не перебивает запись карты', async ({ page }) => {
  // Два показа одного уровня: первый ждёт данных, второй успевает сменить состав
  // через `version` и перестроить уровень. После сбора первого подпись на экране
  // принадлежит новому уровню, а `action` по клику — новому пункту.
  expect(await readLabelAndActionAreFromSameItem(page)).toBe(true);
});

test('отказ читающего действия при перечитывании оставляет показанное меню с прежними данными', async ({ page }) => {
  // Второй показ, где `labelAction` бросает: меню остаётся на экране, подпись прежняя
  await expect(reopen(page)).rejects.toThrow();
  expect(await readVisible(page)).toBe(true);
  expect(await readLabels(page)).toEqual(['Первый']);
});
```

**Замечания по реализации тестов.** Задержка нужна настоящая, а не `Promise.resolve()`: иначе тест не отличит awaits от его отсутствия. Внутри `page.evaluate` используй `new Promise((r) => setTimeout(r, 20))` — это задача, а не микротаска, и она действительно уступает управление.

Последние два теста бьют по `refreshItems`, а не по `renderLevel`, и требуют пробы `readLabelAndActionAreFromSameItem`: она кликает по показанному пункту и сверяет подпись элемента с той, что отметил зовённый `action`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — подпись пустая (`TypeError` от `labelOf` на промисе), `open` возвращает `undefined`, поэтому `rejects` не срабатывает.

- [ ] **Step 3: Make the renderer await the four reader actions**

`isEnabledOf`, `labelOf`, `iconOf`, `submenuOf` становятся `async` и `await`-ят вызов действия. `resolveItem` — `async`, читает четыре действия параллельно:

```js
async function resolveItem(item, path) {
  const [enabled, label, icon, submenuItems] = await Promise.all([
    isEnabledOf(item),
    labelOf(item, path),
    iconOf(item, path),
    submenuOf(item, path),
  ]);
  const handoff = item.handoffAction === undefined ? null : item.handoffAction;
  return { enabled, label, icon, submenuItems, hasSubmenu: isSubmenuOwner(enabled, submenuItems), handsOff: handsOffOwner(enabled, handoff), handoff };
}
```

`assertItem` и `assertItems` остаются синхронными: они проверяют форму и ни одного пользовательского действия не зовут.

- [ ] **Step 4: Split `renderMenuItem` into resolve and build, and make `renderLevel` two-pass**

`renderMenuItem` переименовывается в `buildMenuItem` и теряет вызов `resolveItem`:

```js
function buildMenuItem(resolved, item, context, itemIndex, setSize) { /* тело нынешнего renderMenuItem без resolveItem и assertItem */ }
```

`renderItem` сохраняет арность и экспорт, становится асинхронным и остаётся единственным путём «один пункт»:

```js
export async function renderItem(item, context, itemIndex, setSize) {
  if (isSeparator(item)) { return renderSeparator(); }
  const path = `${context.menuId}:${itemIndex}`;
  assertItem(item, path);
  return buildMenuItem(await resolveItem(item, path), item, context, itemIndex, setSize);
}
```

`renderLevel` делает два прохода, как требует спека §4.2 — сначала все `ResolvedItem` параллельно, потом один синхронный проход по DOM:

```js
export async function renderLevel(items, context) {
  const resolved = await Promise.all(items.map((item, itemIndex) => {
    if (isSeparator(item)) { return null; }
    const path = `${context.menuId}:${itemIndex}`;
    assertItem(item, path);
    return resolveItem(item, path);
  }));
  /* далее нынешнее построение уровня синхронно, а каждый пункт строится
     вызовом buildMenuItem(resolved[itemIndex], …) либо renderSeparator() */
}
```

Порядок `Promise.all` совпадает с порядком пунктов, так что позиция в `list` и `aria-posinset` не меняются.

- [ ] **Step 5: Make `refreshItems` collect-then-apply**

Сначала `Promise.all` по всем пунктам, затем применение в нынешнем порядке. Обрати внимание: текущий код делает `actions.set(renderedItem.key, item)` **до** вызова действий, и это оставить — при отказе читающего действия запись должна остаться, чтобы отменённая правка не оставила карту без пункта.

- [ ] **Step 6: Make the layer async and re-drive a level discarded mid-flight**

```js
async function createEntry(items, parent, levelIndex, ownerItem, menuId) { /* await renderLevel */ }
async function reconcile(entry, items, levelIndex) {
  const hash = submenuHashOf(items);
  if (entry.itemsHash === hash) {
    await refreshItems(items, entry.items, entry.element.id, actions);
    // Уровень могли снести, пока ждали данные: применять ответы в отцепленные
    // узлы нельзя, а `actions.set` переписал бы запись свежего пункта старым
    // объектом по тому же ключу `menuId:index`. Мёртвый уровень заводим заново.
    if (!levels.includes(entry)) {
      return ensureLevel(items, entry.parent, levelIndex, entry.ownerItem);
    }
    return entry;
  }
  /* перестроение без изменений */
}
async function ensureLevel(items, parent, levelIndex, ownerItem) { /* await createEntry / reconcile */ }
```

Тип в typedef `MenuLayer.ensureLevel` становится `(…) => Promise<LevelEntry>`.

- [ ] **Step 7: Make the show pipeline async in `src/MyContext.js`**

Асинхронными становятся `#ensureLevel`, `#ensureSubmenuLevel`, `#leadAhead`, `#showAt`, `#openSubmenu`, `#openSubmenuFromKeyboard`, `#showWhatItemLeadsTo`, `#showAsSubmenu`, `openSubmenu`, `openAsSubmenu`, `open`. В `open()` всё, что стоит **до** первого `await` — подъём `#openSerial`, `#focusOwner`, `#cancelReopen`, `#armExternalPress`, `#bindGlobalHandlers` — остаётся на месте, иначе вооружение потеряется. Три публичных метода отдают промис; `#showAt` возвращает его дальше без `await`, потому что вызывающий ждёт.

`#showWhatItemLeadsTo` обязан прочитать `#hoverOwner` и `#hoverEvent` до первого `await` — этот читатель ждёт синхронно (`spec §3.3`).

Обработчики DOM остаются обычными функциями и отдают промис в `#fireAndForget`:

```js
#onContextMenu = (event) => {
  /* …прежнее… */
  this.#fireAndForget(this.open({ x: event.clientX, y: event.clientY }), 'contextmenu');
};
```

То же в `#onLevelClick` для `#showWhatItemLeadsTo` и для `#runItemAction` — второй станет асинхронным в задаче 5, а сейчас он ещё синхронный, и `#fireAndForget` на синхронном значении безвреден.

- [ ] **Step 8: Make `handleKeydown` async without losing `preventDefault`**

Это вторая после `isArmableAction` точка, где `await` ломает отмену по умолчанию. `event.preventDefault()` стоит после `switch` (строка 655), поэтому в двух ветках, которым нужен `await`, отмена переносится внутрь ветки, а `return` не даёт дойти до хвоста:

```js
case 'ArrowRight': {
  if (active === null || !active.hasSubmenu) { break; }
  const submenu = submenuOf(entry, active);
  if (submenu === null) { break; }
  event.preventDefault();   // до await: после него отмена уже не действует
  moveTo(await host.openSubmenu(submenu), 0);
  return;
}
```

То же в ветке `Enter`/`' '` для `active.hasSubmenu`. `host.handOver` **не** awaited — сама функция разбирает свой отказ.

`#onLevelKeydown` в `src/MyContext.js` оборачивает вызов движка: `this.#fireAndForget(this.#keyboard.handleKeydown(event), 'keydown')`.

- [ ] **Step 9: Add `await` to the renderer unit-level tests**

В `tests/e2e/renderer.spec.js` все вызовы `renderLevel(...)` и `renderItem(...)` (около тридцати мест, строки 115, 163, 200, 237, 265, 289, 339, 401, 432, 475, 519, 579, 629, 699, 792, 873, 942, 986, 1028, 1092, 1131, 1200, 1255, 1316, 1371, 1425) становятся `await renderLevel(…)`, а обращение к `level.element` идёт после. Вызов на строке 1206 (`const withoutLabel = renderLevel(levelItems, …)`) — обернуть так же.

- [ ] **Step 10: Run the full suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2`
Expected: PASS, 413 существующих тестов плюс шесть новых.

- [ ] **Step 11: Commit**

```bash
git add src/renderer.js src/layer.js src/MyContext.js src/keyboard.js tests/e2e/asyncActions.spec.js tests/e2e/renderer.spec.js
git commit -m "feat: читающие действия пункта собираются параллельно до отрисовки"
```

---

### Task 4: Отмена висящего показа

**Files:**
- Modify: `src/MyContext.js` — `#closeMenu` 2476, `#showAt` 2297, `#ensureLevel` 2998, `#leadAhead` 3073, `#openSubmenu` 2678, `#showWhatItemLeadsTo` 2744
- Test: `tests/e2e/asyncActions.spec.js`

**Interfaces:**
- Consumes: `#fireAndForget`, `#reportFailure` из задачи 1; асинхронные `#showAt`/`#ensureLevel`/`#leadAhead`/`#openSubmenu` из задачи 3
- Produces: `#showCancelled(serial): boolean` — читает `#destroyed` и `#openSerial`, ничего не меняет; `#closeMenu` поднимает `#openSerial`; переходы показа гасят серию через `#showCancelled`

- [ ] **Step 1: Write the failing tests**

```js
test('закрытие во время сбора данных отменяет показ', async ({ page }) => {
  const opening = openMenu(page, { items: [{ labelAction: async () => { await delay(30); return 'Пункт'; } }] });
  await page.evaluate(() => window.__mc.closeMenu());
  await opening;
  expect(await readVisible(page)).toBe(false);
  expect(await readOpenCount(page)).toBe(0);
});

test('два показа подряд показывают только последний', async ({ page }) => { /* два open() с задержкой, читаем одну подпись */ });

test('destroy во время сбора данных не оставляет уровней в документе', async ({ page }) => {
  const opening = openMenu(page, { items: [{ labelAction: async () => { await delay(30); return 'Пункт'; } }] });
  await page.evaluate(() => window.__mc.destroyMenu());
  await opening;
  expect(await page.locator('.vc-menu').count()).toBe(0);
});

test('отпускание до готовности данных не показывает вооружённое меню', async ({ page }) => {
  // pressAndHold: 'left', медленный labelAction; нажать и отпустить, не дожидаясь
  expect(await readVisible(page)).toBe(false);
  expect(await readArmed(page)).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — закрытие не трогает `#openSerial`, и висящий показ дорисовывается после закрытия.

- [ ] **Step 3: Add `#showCancelled` and raise the generation counter in `#closeMenu`**

```js
#showCancelled(serial) {
  return this.#destroyed || this.#openSerial !== serial;
}
```

`this.#openSerial += 1;` в `#closeMenu` ставится рядом с `#cancelReopen`, до `#forgetPlacement` и до `dispatchEvent('close')`. Комментарий должен объяснять, что счётчик стал общим признаком отмены показа, а не только таймера переоткрытия.

- [ ] **Step 4: Guard every await in the show pipeline**

В `#showAt` серия читается до первого `await` и проверяется перед `chain.push`, перед `showRoot` и перед рассылкой `open`. В `#ensureLevel` — перед тем, как вешать обработчики уровня и класть его в `#levels`; уровень, собранный после отмены, сносится через `#layer`'s `discardLevels`. В `#leadAhead` — перед подписками на пункты. В `#openSubmenu` — перед `#layer.showSubmenu`. В `#showWhatItemLeadsTo` — перед `#openSubmenu`, плюс проверка, что уровень-владелец всё ещё в `#chain`.

- [ ] **Step 5: Run the tests and the full suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js
git commit -m "fix: показ, ждущий данных, отменяется закрытием и разбором"
```

---

### Task 5: Асинхронное `action`

**Files:**
- Modify: `src/MyContext.js` — `#invokeItemAction` 1021, `#runItemAction` 967, `#onGlobalPointerRelease` 1549
- Test: `tests/e2e/asyncActions.spec.js`

**Interfaces:**
- Consumes: `#fireAndForget`, `#reportFailure`, `#showCancelled` из задачи 1; поколение из задачи 4
- Produces: `#invokeItemAction(item, event): Promise<void>`, `#runItemAction(rendered, event): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```js
test('асинхронное действие переоткрывает меню из себя', async ({ page }) => {
  // action: async () => { await delay(20); window.__menu.open({ x: 400, y: 400 }); }
  expect(await readOpenCount(page)).toBe(2);
  expect(await readCloseCount(page)).toBe(1);
  expect(await readVisible(page)).toBe(true);
});

test('отказ асинхронного действия не оставляет меню висеть', async ({ page }) => {
  // action: async () => { await delay(10); throw new Error('сломалось'); }
  expect(await readVisible(page)).toBe(false);
});

test('асинхронное действие на отпускании вооружённого жеста исполняется', async ({ page }) => {
  // pressAndHold: 'left', action: async () => { marks.push('выполнено'); }
  expect(await readMarks(page)).toEqual(['выполнено']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — `readOpenCount` равен 2, но `readCloseCount` тоже 2, потому что закрытие в `finally` успевает раньше `await`.

- [ ] **Step 3: Make `#invokeItemAction` await the action and then evaluate the guard**

```js
async #invokeItemAction(item, event) {
  const serial = this.#openSerial;
  try {
    await item.action?.(event);
  } catch (reason) {
    this.#reportFailure(reason, ...);
  } finally {
    if (!this.#showCancelled(serial)) { this.close(); }
  }
}
```

Охрана переезжает **после** `await` — в этом весь смысл задачи: переоткрытие из асинхронного действия должно отменять закрытие так же, как из синхронного. Отказ больше не уходит из тела наружу, его разбирает `#reportFailure`, но `finally` от него не зависит: пропуск закрытия не имеет права глушить ошибку.

`source` для `#reportFailure` — путь до поля пункта, а не `'action'`: сообщение об ошибке автора должно называть конкретный пункт. Внеси в `#invokeItemAction` параметр `source` от вызывающих: `#runItemAction` и `#onGlobalPointerRelease` знают ключ пункта.

- [ ] **Step 4: Await at the two call sites**

`#onGlobalPointerRelease` и `#onLevelClick` зовут `#fireAndForget` вокруг `#invokeItemAction` с `source`, описывающим путь. Порядок «найти пункт → закрыть → исполнить» на пути отпускания сохраняется: он закреплён спеками на фокус.

- [ ] **Step 5: Run the tests and the full suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js
git commit -m "fix: асинхронное action переоткрывает меню и разбирает свой отказ"
```

---

### Task 6: Асинхронная отдача управления

**Files:**
- Modify: `src/MyContext.js` — `#handOverTo` 2836, `#keyboardHost` 2617
- Test: `tests/e2e/asyncActions.spec.js`

**Interfaces:**
- Consumes: `#reportFailure` и `#showCancelled` из задачи 1
- Produces: `#handOverTo(rendered, event): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```js
test('асинхронная отдача вооружает чужое меню на переданную кнопку', async ({ page }) => {
  // handoffAction: async (event, handoff) => { await delay(20); owner.openSubmenu(x, y, handoff); }
  await pressAndHold(page, 'right');
  expect(await readChildConfig(page)).toBe('right');
  await page.mouse.up({ button: 'right' });
  expect(await page.locator('.pielet').count()).toBe(0);
});

test('отказ асинхронной отдачи доходит до error', async ({ page }) => { /* handoffAction: async () => { throw new Error('нет'); } */ });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — чужое меню не вооружается, потому что отпускание прошло мимо.

- [ ] **Step 3: Await the handoff action after closing**

`#handOverTo` становится `async`; `close()` и `#handoffDone = rendered.element` остаются **до** первого `await` — по этой причине охраны поколения здесь не нужно, метка переживает ожидание, и `click`, пришедший следом, вторым вызовом не станет. `gesture` собирается до закрытия, как сейчас.

`#keyboardHost().handOver` оборачивает вызов в `#fireAndForget`; движок его не ждёт.

- [ ] **Step 4: Run the tests and the full suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js
git commit -m "fix: асинхронная отдача управления ждёт действия и сохраняет жест"
```

---

### Task 7: Асинхронный `isArmableAction` и откат вооружения

**Files:**
- Modify: `src/MyContext.js` — `#onGlobalPointerDown` 1458, `#armsPress` 1500, `#isArmable` 1525, typedef `MyContextOptions.isArmableAction` 122
- Test: `tests/e2e/asyncActions.spec.js`

**Interfaces:**
- Consumes: `#fireAndForget`, `#reportFailure`, `#showCancelled` из задачи 1; поколение из задачи 4
- Produces: `#armsPress(event): boolean` остаётся синхронным и отвечает только за пресет и кнопку; новое асинхронное тело `#armPress(event): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```js
test('асинхронный предикат, разрешивший нажатие, показывает меню', async ({ page }) => {
  // pressAndHold: 'right', isArmableAction: async () => { await delay(20); return true; }
  await pressAndHold(page, 'right');
  expect(await readVisible(page)).toBe(true);
});

test('асинхронный предикат, отказавший, не показывает меню и снимает вооружение', async ({ page }) => {
  await pressAndHold(page, 'right');
  expect(await readVisible(page)).toBe(false);
  expect(await readArmed(page)).toBe(false);
});

test('отпускание в промежутке ожидания предиката не открывает меню под отпущенной кнопкой', async ({ page }) => {
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(5);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(60);
  expect(await readVisible(page)).toBe(false);
  expect(await readArmed(page)).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — предикат-строка приходит, `=== true` ложно, меню не открывается; при отказе вооружение остаётся висеть.

- [ ] **Step 3: Split `#armsPress` into a sync gate and an async body**

`#armsPress` теряет условие «внутри привязанного контейнера» и про предикат: остаются пресет и кнопка. `#onGlobalPointerDown` в ветке вооружения делает три вещи **до** `await`:

```js
#onGlobalPointerDown = (event) => {
  if (this.#destroyed) { return; }
  if (this.#armedPress !== null) { this.#closeMenu({ returnFocus: false }); return; }
  if (this.#armsPress(event)) {
    event.preventDefault();
    this.#armedPress = { button: event.button, pointerId: event.pointerId };
    this.#fireAndForget(this.#armPress(event), 'isArmableAction');
    return;
  }
  /* …прежнее… */
};
```

`#armPress` — асинхронное тело: читает серию, ждёт `#isArmable`, и при отказе **снимает только то вооружение, которое поставил этот вызов** (сверяя по `pointerId` и `button`, иначе откат погасил бы чужое), при согласии открывает меню. После `await` действует охрана поколения, и отказ попадает в `#reportFailure`.

- [ ] **Step 4: Document the text-selection cost in the JSDoc of `isArmableAction`**

В typedef `MyContextOptions` добавить абзац: при `pressAndHold: 'left'` с асинхронным предикатом выделение текста в контейнере подавляется на каждом нажатии, включая те, где предикат ответит `false`, потому что `preventDefault()` вызывается до ответа.

- [ ] **Step 5: Run the tests and the full suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2`
Expected: PASS. Существующие тесты `pressAndHold.spec.js` должны остаться зелёными без правок — они используют синхронные предикаты.

- [ ] **Step 6: Commit**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js
git commit -m "fix: асинхронный isArmableAction гасит по кнопке и откатывает вооружение"
```

---

### Task 8: Обёртка подписчиков `open` и `close`

**Files:**
- Modify: `src/MyContext.js` — `addEventListener` 1988, `removeEventListener` 2026
- Test: `tests/e2e/asyncActions.spec.js`

**Interfaces:**
- Consumes: `#reportFailure` из задачи 1
- Produces: приватное поле `#listenerWrappers: WeakMap<EventListenerOrEventListenerObject, EventListener>`

- [ ] **Step 1: Write the failing tests**

```js
test('removeEventListener снимает подписку, обёрнутую изнутри', async ({ page }) => {
  await openMenu(page, { items: [{ labelAction: () => 'Пункт' }], listener: 'removed' });
  expect(await readListenerCalls(page)).toBe(0);
});

test('одна и та же функция, подписанная дважды, не вызывается дважды', async ({ page }) => {
  // addEventListener('open', sameFn) дважды подряд
  expect(await readOpenCount(page)).toBe(1);
});

test('отклонённый промис подписчика не зацикливает error', async ({ page }) => {
  // подписчик open возвращает отклонённый промис, второй подписчик error считает события
  expect(await readHandled('listener')).toBe(true);
  expect(await readErrorCount()).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL на снятии подписки и на счётчике событий.

- [ ] **Step 3: Add the wrapper cache and the wrapper**

Поле `#listenerWrappers` инициализируется в конструкторе. `addEventListener` берёт обёртку из `WeakMap`, а при отсутствии создаёт, кладёт и подписывает её; `removeEventListener` берёт ту же обёртку. Если исходный аргумент — не функция (`EventListenerObject` или `null`), подписка идёт как есть: оборачивать нечего, и `removeEventListener` тоже идёт напрямую.

Обёртка зовёт слушателя, и если вернулся промис — ловит отказ в `#reportFailure` с `source` вида `` `${type}:listener` ``.

- [ ] **Step 4: Run the tests and the full suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2`
Expected: PASS, включая существующий `events.spec.js`.

- [ ] **Step 5: Commit**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js
git commit -m "fix: отказ асинхронного подписчика open/close доходит до error"
```

---

### Task 9: Документация

**Files:**
- Modify: `README.md` — таблица опций (`README.md:479`), разделы `open()` (`README.md:774-783`), `openSubmenu`, `openAsSubmenu`, `labelAction`/`iconAction`/`submenuAction`/`isEnabledAction`/`action`/`handoffAction`/`isArmableAction`, события (`README.md:907`)
- Modify: `Demo/demo.js:303`
- Modify: `tests/e2e/contracts.spec.js` — ожидаемые сигнатуры полей

**Interfaces:**
- Consumes: всё из задач 1–8
- Produces: ничего

- [ ] **Step 1: Write the failing tests**

Тестов нет: документация проверяется `demo.spec.js`, `contracts.spec.js` и `npm run typecheck`. Ожидаемые сигнатуры в `contracts.spec.js` заменить на `() => string | Promise<string>` и `(event: MouseEvent | KeyboardEvent) => void | Promise<void>` — контрактный тест обязан их проверять, иначе асинхронные сигнатуры перестанут быть обещанием.

- [ ] **Step 2: Skip — шага нет**

- [ ] **Step 3: Rewrite the affected README sections**

Снять обещание «показ синхронный» и заменить его формулировкой: синхронные действия дают показ до следующего кадра, асинхронные — когда данные готовы, поэтому `open`, `openSubmenu` и `openAsSubmenu` возвращают промис. Во всех восьми разделах действий привести новые сигнатуры. Добавить раздел про отказы: событие `error`, `detail` из `{ reason, source }`, `preventDefault()` и бросок как непойманная ошибка страницы; отдельно сказать, что отказ читающего действия летит из промиса `open()` и подписчиком `error` не отменяется. В раздел `isArmableAction` внести названную цену из задачи 7 и оговорку про `armed` из спеки §5.4.

- [ ] **Step 4: Await `open()` in the demo**

В `Demo/demo.js:303` добавить `await` и сделать обработчик `async`, чтобы демо не показывало неверную модель.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx playwright test --project=unit --project=chromium --workers=2 && npm run typecheck`
Expected: PASS, typecheck чист.

- [ ] **Step 6: Commit**

```bash
git add README.md Demo/demo.js tests/e2e/contracts.spec.js
git commit -m "docs: асинхронные сигнатуры действий и разбор отказов"
```

---

## Review Focus

Пять мест, которые спека подразумевает, но ни одна задача не закрывает тестом. Для каждой строки тест добавлен в задачу-владельца.

| # | Вход | Ожидаемое поведение | Задача |
|---|---|---|---|
| 1 | Подписчик `error`, который сам возвращает отклонённый промис | Ровно одно событие `error`, отказ подписчика уходит в бросок, петли нет | 1 |
| 2 | `refreshItems`, ждущий данные, пока уровень сносят из-за смены состава | Ответы не применяются и запись `actions.set` не перебивает свежий пункт по ключу `menuId:index` | 3 |
| 3 | Одна и та же функция подписана на `open` дважды подряд | Обёртка кэшируется, слышен один вызов, а не два | 8 |
| 4 | Отказ читающего действия на `refreshItems` уже показанного уровня | Меню остаётся с прошлыми данными, промис из `open()` всё равно отклоняется | 3 |
| 5 | `destroy()` во время висящего показа | Ничего не показано, событие `open` не рассылалось, узлов `.vc-menu` в документе нет | 4 |

## Self-Review

- **Покрытие спеки.** §1.1 п.1–2 и §4 → задача 3; §1.1 п.6 и §3.4 → задача 7; §1.1 п.3 → задача 5; §1.1 п.4 и §6 → задачи 1, 8; §1.1 п.5 → задача 6; §2.1–2.2, §4 → задача 3; §2.3 и §5 → задача 4; §2.4–2.5 → задачи 1, 8; §8 → задачи 7, 9; §9 → по одной проверке на задачу. §3.1–3.3 → задачи 3, 9; §10 не требует работы.
- **Дыра, найденная при планировании, не в спеке.** `src/keyboard.js` в списке файлов спеки не значился, а `handleKeydown` содержит второй после `isArmableAction` случай, где `await` ломает `preventDefault()` (строка 655 стоит после `switch`). Правка описана в шаге 8 задачи 3 и должна быть отражена в README: переход уровня клавишей ждёт данных владельца перед переносом фокуса.
- **Шаг, который ничего не решает.** Убраны формулировки вида «разобраться с краевыми случаями»; шаги без падающего теста помечены явно, и это две задачи — 2 и 9, — где правка механическая.
- **Единство имён.** `#reportFailure`, `#fireAndForget`, `#showCancelled` вводятся в задаче 1 и дальше не переименуются; `#armPress` в задаче 7 отличается от `#armsPress` одной буквой намеренно, и это оговорено комментарием в коде.