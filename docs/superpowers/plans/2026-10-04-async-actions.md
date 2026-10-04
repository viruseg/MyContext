# Асинхронные пользовательские действие — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Любое действие, которое передаёт автор, может быть `async`, и библиотека это корректно разбирает: данные уровня собираются параллельно до отрисовки, висящий показ отменяется, отказ не теряется.

**Architecture:** Рендерер переходит на два прохода — `Promise.all` собирает `ResolvedItem` для всех пунктов уровня, затем один синхронный проход строит DOM. Отсюда каскад `renderLevel` → `createEntry`/`reconcile`/`ensureLevel` → `#showAt`/`#leadAhead`/`#openSubmenu`, и публичные `open`/`openSubmenu`/`openAsSubmenu` начинают возвращать `Promise<void>`. Показ, ждущий данных, отменяется по счётчику поколений, который теперь растёт и на закрытии. Отказы пользовательских действий идут в новое событие `error` и перебрасываются как непойманная ошибка страницы, если подписчик не вызвал `preventDefault()`.

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
- Задержка в тестах — настоящая задача (`setTimeout`), а не `Promise.resolve()`: микротаска не уступает управление задаче, и тест не отличил бы `await` от его отсутствия.

## File Structure

| Файл | Ответственность после правок |
|---|---|
| `src/MyContext.js` | новые `#reportFailure`, `#fireAndForget`, `#showCancelled`; отмена висящего показа; асинхронные `#invokeItemAction`, `#handOverTo`, `#isArmable`; обёртка подписчика |
| `src/renderer.js` | `resolveItem` читает четыре действия параллельно; `renderLevel`/`renderItem`/`refreshItems` возвращают промисы; `submenuHashOf` без изменений |
| `src/layer.js` | `createEntry`, `reconcile`, `ensureLevel` становятся асинхронными; перестраивание отменённого уровня не применяется |
| `src/keyboard.js` | `handleKeydown` асинхронен; `ArrowRight` и `Enter` гасят событие до `await` |
| `tests/e2e/asyncActions.spec.js` | новые проверки асинхронных действий, отмены и отказов |
| `tests/e2e/renderer.spec.js` | `await` на всех вызовах `renderLevel`/`renderItem` |
| `README.md` | новые сигнатуры, снятие обещания синхронного показа, раздел про отказы |

`src/MyContext.js` уже 3457 строк и станет примерно на 200 длиннее. Дробление файла в этот план не входит: `#`-поля связаны между собой, а разбор не входит в предмет спеки (`§10`).

---

### Task 1: Асинхронное `action` и разбор отказов

Первый цельный срез: `action` ждётся, его отказ разбирается, а охрана закрытия переезжает после `await`. Ни от одной другой задачи не зависит — показ остаётся синхронным.

**Files:**
- Modify: `src/MyContext.js` — `#invokeItemAction` 1021, `#runItemAction` 967, `#onLevelClick` 915, `#onGlobalPointerRelease` 1549, рядом с `#assertAlive` 3287 добавить методы, рядом с typedef `OpenEventDetail` 152 добавить typedef
- Test: `tests/e2e/asyncActions.spec.js`

**Interfaces:**
- Consumes: ничего
- Produces:
  ```js
  /** @typedef {{ reason: unknown, source: string }} ErrorEventDetail */
  #reportFailure(reason: unknown, source: string): void
  #fireAndForget(result: unknown, source: string): void
  #showCancelled(serial: number): boolean
  #invokeItemAction(item: MenuItem, event: MouseEvent | KeyboardEvent, source: string): Promise<void>
  #runItemAction(rendered: RenderedItem, event: MouseEvent | PointerEvent, source: string): Promise<void>
  ```
  `#fireAndForget` промис не возвращает — он привязывает отказ и забывает.
  `#showCancelled` читает `#destroyed` и `#openSerial` и ничего не меняет.

- [ ] **Step 1: Write the failing tests**

Создай `tests/e2e/asyncActions.spec.js` с фикстурой `window.__mc` по образцу `tests/e2e/handoff.spec.js` (строка 34 `PAGE_HTML`, строка 65 `page.evaluate` с импортом `/src/index.js`). Проба:

```js
/**
 * @typedef {object} AsyncProbe
 * @property {(input: ActionInput) => void} make
 * @property {(x: number, y: number) => Promise<void>} open
 * @property {() => void} activate
 * @property {() => void} closeMenu
 * @property {() => ErrorLog} read
 */
/**
 * @typedef {object} ActionInput
 * @property {'ok' | 'async-ok' | 'throw' | 'async-throw'} mode
 * @property {boolean} [preventDefault] вызывает ли подписчик `error` `preventDefault()`
 * @property {boolean} [watch] подписан ли кто-нибудь на `error`
 * @property {boolean} [reopen] звать ли `open()` из действия
 */
/**
 * @typedef {object} ErrorLog
 * @property {number} openCount
 * @property {number} closeCount
 * @property {boolean} visible
 * @property {string[]} errorSources
 * @property {string[]} errorMessages
 * @property {number} errorPrevented
 */
```

Тесты:

```js
test('отказ асинхронного действия доходит до подписчика error с отказом в detail', async ({ page }) => {
  await setup(page, { mode: 'async-throw', watch: true });
  await page.evaluate(() => window.__mc.activate());
  const log = await read(page);
  expect(log.errorMessages).toEqual(['сломалось']);
  expect(log.errorSources).toHaveLength(1);
  expect(log.visible, 'меню закрыто, несмотря на отказ').toBe(false);
});

test('отказ действия с preventDefault в подписчике error не доходит до страницы', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page, { mode: 'async-throw', watch: true, preventDefault: true });
  await page.evaluate(() => window.__mc.activate());
  await page.waitForTimeout(50);
  expect(errors).toEqual([]);
});

test('отказ действия без подписчика error виден как непойманная ошибка страницы', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page, { mode: 'async-throw' });
  await page.evaluate(() => window.__mc.activate());
  await page.waitForTimeout(50);
  expect(errors).toEqual(['сломалось']);
});

test('асинхронное действие переоткрывает меню из себя, и закрытие не сбивает поколение', async ({ page }) => {
  await setup(page, { mode: 'async-ok', reopen: true });
  await page.evaluate(() => window.__mc.activate());
  await page.waitForTimeout(80);
  const log = await read(page);
  expect(log.openCount, 'меню переоткрылось').toBe(2);
  expect(log.closeCount, 'закрытие отменено переоткрытием').toBe(1);
  expect(log.visible).toBe(true);
});

test('синхронное действие, зовущее open, ведёт себя как раньше', async ({ page }) => {
  await setup(page, { mode: 'ok', reopen: true });
  await page.evaluate(() => window.__mc.activate());
  await page.waitForTimeout(80);
  const log = await read(page);
  expect(log.openCount).toBe(2);
  expect(log.closeCount).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — `errorMessages` пуст (события `error` не существует), а в тесте на переоткрытие `closeCount` равен 2 вместо 1, потому что `finally` успевает раньше `await`.

- [ ] **Step 3: Add `#reportFailure`, `#fireAndForget` and `#showCancelled`**

```js
#reportFailure(reason, source) {
  /** @type {ErrorEventDetail} */
  const detail = { reason, source };
  const event = new CustomEvent('error', { detail, cancelable: true });
  this.dispatchEvent(event);
  if (event.defaultPrevented) {
    return;
  }
  // Необработанный отказ уходит наружу тем же путём, каким уходит синхронный бросок
  // из обработчика DOM: браузер показывает его как непойманную ошибку страницы, и
  // страница может поймать его `window.onerror`. Своё хранилище ошибок завело бы
  // второй, невидимый для страницы канал утечки.
  queueMicrotask(() => {
    throw reason;
  });
}

#fireAndForget(result, source) {
  Promise.resolve(result).catch((reason) => {
    this.#reportFailure(reason, source);
  });
}

#showCancelled(serial) {
  return this.#destroyed || this.#openSerial !== serial;
}
```

- [ ] **Step 4: Make `#invokeItemAction` await the action**

```js
async #invokeItemAction(item, event, source) {
  // Поколение читается до действия: действие вправе открыть меню в другом месте,
  // и тогда закрытие, начатое по этому же клику, убило бы то, что только что
  // открыто. Проверка уезжает после `await` — иначе асинхронное действие
  // переоткрывало бы меню уже после того, как `finally` его закрыл.
  const serial = this.#openSerial;
  try {
    await item.action?.(event);
  } catch (reason) {
    this.#reportFailure(reason, source);
  } finally {
    if (!this.#showCancelled(serial)) {
      this.close();
    }
  }
}
```

Отказ больше не уходит из тела наружу: его разбирает `#reportFailure`, но `finally` от него не зависит — пропуск закрытия не имеет права глушить ошибку. `return` из `finally` по-прежнему запрещён.

- [ ] **Step 5: Thread `source` through the two call sites**

`#runItemAction` и `#onGlobalPointerRelease` знают ключ пункта, и имя автора в сообщении должно называть конкретный пункт. Оба принимают `source` и передают его в `#invokeItemAction`; `#onLevelClick` и `#onGlobalPointerRelease` оборачивают вызов в `#fireAndForget`:

```js
this.#fireAndForget(this.#invokeItemAction(item, event, source), source);
```

- [ ] **Step 6: Run the new tests, the affected specs and typecheck**

Run: `npx playwright test --project=unit --project=chromium tests/e2e/asyncActions.spec.js tests/e2e/contracts.spec.js tests/e2e/pressAndHold.spec.js --workers=2 && npm run typecheck`
Expected: PASS, typecheck чист.

- [ ] **Step 7: Run the whole suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2`
Expected: PASS, 545 существующих плюс 5 новых.

- [ ] **Step 8: Commit**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js
git commit -m "fix: асинхронное action переоткрывает меню и разбирает свой отказ"
```

---

### Task 2: Ожидание программных показов в существующих тестах

Подготовка, отдельная от поведения: `await` над значением `undefined` безвреден, поэтому задача проходит на текущем коде и снимает блокировку для задачи 3.

**Files:**
- Modify: `tests/e2e/contracts.spec.js` (`openAt` строка 132, `scope.__mc.open` строка 415)
- Modify: `tests/e2e/autoHide.spec.js` (`openAt` строка 138, `menu.open` строка 225)

**Interfaces:**
- Consumes: ничего
- Produces: ничего; все `page.evaluate`, вызывающие `open()`/`openSubmenu()`/`openAsSubmenu()`, возвращают промис наружу и ждут его

- [ ] **Step 1: Skip — падающего теста у механической правки нет**

- [ ] **Step 2: Add `await` to the two `openAt` helpers and the bare `open()` calls**

В `contracts.spec.js:132`:

```js
function openAt(page, point) {
  return page.evaluate(async (payload) => {
    const scope = /** @type {{ __mc: McProbe }} */ (/** @type {unknown} */ (globalThis));
    await scope.__mc.open(payload.x, payload.y);
  }, point);
}
```

То же в `autoHide.spec.js:138` и в одиночных `menu.open(...)` внутри `page.evaluate` в обоих файлах.

- [ ] **Step 3: Run the affected tests**

Run: `npx playwright test --project=unit --project=chromium tests/e2e/contracts.spec.js tests/e2e/autoHide.spec.js --workers=2`
Expected: PASS, число тестов не изменилось.

- [ ] **Step 4: Commit**

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
  resolveItem(item: MenuItem, path: string): Promise<ResolvedItem>
  renderItem(item: MenuItem | SeparatorItem, context: RenderContext, itemIndex: number, setSize: number): Promise<RenderedItem>
  renderLevel(items: Array<MenuItem | SeparatorItem>, context: RenderContext): Promise<RenderedLevel>
  refreshItems(items: Array<MenuItem | SeparatorItem>, renderedItems: RenderedItem[], menuId: string, actions: Map<string, MenuItem>): Promise<void>
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

Расширь `tests/e2e/asyncActions.spec.js`: `ActionInput` получает поля `items` (массив описаний пунктов, каждое — `{ label, icon, submenu, enabled }`, где значение может быть функцией, возвращающей промис) и `pressAndHold`. Добавь `readLabelAndActionAreFromSameItem()` и `readArmed()`.

```js
test('асинхронный labelAction рисует подпись после сбора данных', async ({ page }) => {
  await setup(page, { items: [{ label: async () => { await delay(20); return 'Экспорт'; } }] });
  await page.evaluate(() => window.__mc.open(400, 300));
  expect(await read(page)).toMatchObject({ labels: ['Экспорт'], visible: true });
});

test('асинхронный iconAction рисует иконку', async ({ page }) => {
  await setup(page, { items: [{ label: '★ Пункт', icon: async () => { await delay(20); return { type: 'emoji', value: '★' }; } }] });
  await page.evaluate(() => window.__mc.open(400, 300));
  expect(await page.locator('.vc-icon').count()).toBe(1);
});

test('асинхронный submenuAction раскрывает подменю с шевроном и aria-owns', async ({ page }) => {
  await setup(page, { items: [{ label: 'Ветка', submenu: async () => { await delay(20); return [{ label: 'Лист' }]; } }] });
  await page.evaluate(() => window.__mc.open(400, 300));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  expect(await page.locator('.vc-menu:popover-open').count()).toBe(2);
});

test('асинхронный isEnabledAction гасит пункт в кольцо роуминга', async ({ page }) => {
  await setup(page, { items: [{ label: 'Первый' }, { label: 'Второй', enabled: async () => { await delay(20); return false; } }] });
  await page.evaluate(() => window.__mc.open(400, 300));
  expect(await page.locator('.vc-item[aria-disabled="true"]').count()).toBe(1);
});

test('отказ читающего действия отклоняет промис open и не показывает меню', async ({ page }) => {
  await setup(page, { items: [{ label: async () => { await delay(20); throw new Error('нет данных'); } }] });
  await expect(page.evaluate(() => window.__mc.open(400, 300))).rejects.toThrow('нет данных');
  expect((await read(page)).visible).toBe(false);
});

test('отказ читающего действия через contextmenu приходит в error', async ({ page }) => {
  await setup(page, { attached: true, items: [{ label: async () => { await delay(20); throw new Error('нет данных'); } }], watch: true });
  await page.mouse.click(200, 200, { button: 'right' });
  await page.waitForTimeout(80);
  expect((await read(page)).errorMessages).toEqual(['нет данных']);
});

test('уровень, снесённый во время перечитывания, не принимает ответы и не перебивает запись карты', async ({ page }) => {
  // Первый показ ждёт данных, второй успевает сменить состав через `version`
  // и перестроить уровень. После сбора первого подпись на экране принадлежит
  // новому уровню, а `action` по клику — новому пункту.
  expect(await readLabelAndActionAreFromSameItem(page)).toBe(true);
});

test('отказ читающего действия при перечитывании оставляет показанное меню с прежними данными', async ({ page }) => {
  await expect(reopen(page)).rejects.toThrow();
  const log = await read(page);
  expect(log.visible).toBe(true);
  expect(log.labels).toEqual(['Первый']);
});
```

Два последних теста бьют по `refreshItems`, а не по `renderLevel`. `readLabelAndActionAreFromSameItem` кликает по показанному пункту и сверяет текст `.vc-label` с тем, что отметил зовённый `action`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — `labelOf` бросает `TypeError` на промисе, `open` возвращает `undefined`, и `rejects` не срабатывает.

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
  return {
    enabled,
    label,
    icon,
    submenuItems,
    hasSubmenu: isSubmenuOwner(enabled, submenuItems),
    handsOff: handsOffOwner(enabled, handoff),
    handoff,
  };
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
  if (isSeparator(item)) {
    return renderSeparator();
  }
  const path = `${context.menuId}:${itemIndex}`;
  assertItem(item, path);
  return buildMenuItem(await resolveItem(item, path), item, context, itemIndex, setSize);
}
```

`renderLevel` делает два прохода, как требует спека §4.2:

```js
export async function renderLevel(items, context) {
  const resolved = await Promise.all(items.map((item, itemIndex) => {
    if (isSeparator(item)) {
      return null;
    }
    const path = `${context.menuId}:${itemIndex}`;
    assertItem(item, path);
    return resolveItem(item, path);
  }));
  /* далее нынешнее построение уровня синхронно, а каждый пункт строится
     вызовом buildMenuItem(resolved[itemIndex], …) либо renderSeparator() */
}
```

Порядок `Promise.all` совпадает с порядком пунктов, поэтому позиция в `list` и `aria-posinset` не меняются.

- [ ] **Step 5: Make `refreshItems` collect-then-apply**

Сначала `Promise.all` по всем пунктам, затем применение в нынешнем порядке. Обрати внимание: текущий код делает `actions.set(renderedItem.key, item)` **до** вызова действий, и это остаётся — при отказе читающего действия запись должна сохраниться, чтобы отменённая правка не оставила карту без пункта.

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

Асинхронными становятся `#ensureLevel`, `#ensureSubmenuLevel`, `#leadAhead`, `#showAt`, `#openSubmenu`, `#openSubmenuFromKeyboard`, `#showWhatItemLeadsTo`, `#showAsSubmenu`, `openSubmenu`, `openAsSubmenu`, `open`. В `open()` всё, что стоит **до** первого `await` — подъём `#openSerial`, `#focusOwner`, `#cancelReopen`, `#armExternalPress`, `#bindGlobalHandlers` — остаётся на месте, иначе вооружение потеряется.

`#showWhatItemLeadsTo` обязан прочитать `#hoverOwner` и `#hoverEvent` до первого `await` — этот читатель ждёт синхронно (`spec §3.3`).

Обработчики DOM остаются обычными функциями и отдают промис в `#fireAndForget`:

```js
#onContextMenu = (event) => {
  /* …прежнее… */
  this.#fireAndForget(this.open({ x: event.clientX, y: event.clientY }), 'contextmenu');
};
```

- [ ] **Step 8: Make `handleKeydown` async without losing `preventDefault`**

Это вторая после `isArmableAction` точка, где `await` ломает отмену по умолчанию. `event.preventDefault()` стоит после `switch` (строка 655), поэтому в двух ветках, которым нужен `await`, отмена переносится внутрь ветки, а `return` не даёт дойти до хвоста:

```js
case 'ArrowRight': {
  if (active === null || !active.hasSubmenu) {
    break;
  }
  const submenu = submenuOf(entry, active);
  if (submenu === null) {
    break;
  }
  // Отмена переносится внутрь ветки: после `await` событие уже разобрано, и
  // `preventDefault` в хвосте не действовал бы, а `ArrowRight` прокрутил бы
  // страницу вбок.
  event.preventDefault();
  moveTo(await host.openSubmenu(submenu), 0);
  return;
}
```

То же в ветке `Enter`/`' '` для `active.hasSubmenu`. `host.handOver` **не** awaited — сама функция разбирает свой отказ.

`#onLevelKeydown` в `src/MyContext.js` оборачивает вызов движка: `this.#fireAndForget(this.#keyboard.handleKeydown(event), 'keydown')`.

- [ ] **Step 9: Add `await` to the renderer-level tests**

В `tests/e2e/renderer.spec.js` все вызовы `renderLevel(...)` и `renderItem(...)` (около тридцати мест: строки 115, 163, 200, 237, 265, 289, 339, 401, 432, 475, 519, 579, 629, 699, 792, 873, 942, 986, 1028, 1092, 1131, 1200, 1206, 1255, 1316, 1371, 1425) становятся `await renderLevel(…)`, обращение к `level.element` идёт после.

- [ ] **Step 10: Run the whole suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2 && npm run typecheck`
Expected: PASS, 550 плюс 8 новых, typecheck чист.

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
- Consumes: `#showCancelled` из задачи 1; асинхронные `#showAt`/`#ensureLevel`/`#leadAhead`/`#openSubmenu` из задачи 3
- Produces: `#closeMenu` поднимает `#openSerial`

- [ ] **Step 1: Write the failing tests**

```js
test('закрытие во время сбора данных отменяет показ', async ({ page }) => {
  const opening = startSlowOpen(page);
  await page.evaluate(() => window.__mc.closeMenu());
  await opening;
  const log = await read(page);
  expect(log.visible).toBe(false);
  expect(log.openCount).toBe(0);
});

test('два показа подряд показывают только последний', async ({ page }) => { /* два open() с задержкой, читаем одну подпись */ });

test('destroy во время сбора данных не оставляет уровней в документе', async ({ page }) => {
  const opening = startSlowOpen(page);
  await page.evaluate(() => window.__mc.destroyMenu());
  await opening;
  expect(await page.locator('.vc-menu').count()).toBe(0);
});

test('отпускание до готовности данных не показывает вооружённое меню', async ({ page }) => {
  // pressAndHold: 'left', медленный labelAction; нажать и отпустить, не дожидаясь
  const log = await read(page);
  expect(log.visible).toBe(false);
  expect(await readArmed(page)).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — закрытие не трогает `#openSerial`, и висящий показ дорисовывается после закрытия.

- [ ] **Step 3: Raise the generation counter in `#closeMenu`**

`this.#openSerial += 1;` ставится рядом с `#cancelReopen`, до `#forgetPlacement` и до `dispatchEvent('close')`. Комментарий объясняет, что счётчик стал общим признаком отмены показа, а не только таймера переоткрытия.

- [ ] **Step 4: Guard every await in the show pipeline**

`#showAt` читает серию до первого `await` и проверяет перед `chain.push`, перед `showRoot` и перед рассылкой `open`. `#ensureLevel` — перед тем, как вешать обработчики уровня и класть его в `#levels`; уровень, собранный после отмены, сносится через `discardLevels` слоя. `#leadAhead` — перед подписками на пункты. `#openSubmenu` — перед `#layer.showSubmenu`. `#showWhatItemLeadsTo` — перед `#openSubmenu`, плюс проверка, что уровень-владелец всё ещё в `#chain`.

- [ ] **Step 5: Run the tests and the whole suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js
git commit -m "fix: показ, ждущий данных, отменяется закрытием и разбором"
```

---

### Task 5: Асинхронная отдача управления

**Files:**
- Modify: `src/MyContext.js` — `#handOverTo` 2836, `#keyboardHost` 2617
- Test: `tests/e2e/asyncActions.spec.js`

**Interfaces:**
- Consumes: `#reportFailure`, `#fireAndForget` из задачи 1
- Produces: `#handOverTo(rendered, event): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```js
test('асинхронная отдача вооружает чужое меню на переданную кнопку', async ({ page }) => {
  // handoffAction: async (event, handoff) => { await delay(20); owner.openSubmenu(x, y, handoff); }
  await pressAndHold(page, 'right');
  expect(await readChildConfig(page)).toBe('right');
  await page.mouse.up({ button: 'right' });
  expect(await page.locator('.child-menu').count()).toBe(0);
});

test('отказ асинхронной отдачи доходит до error', async ({ page }) => {
  // handoffAction: async () => { throw new Error('нет'); }
  expect((await read(page)).errorMessages).toEqual(['нет']);
});

test('асинхронная отдача не срабатывает дважды на одно наведение', async ({ page }) => {
  // клик после наведения по пункту-отдающему не должен звать действие вторым разом
  expect(await readHandoffCount(page)).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — чужое меню не вооружается, потому что отпускание прошло мимо.

- [ ] **Step 3: Await the handoff action after closing**

`#handOverTo` становится `async`; `close()` и `#handoffDone = rendered.element` остаются **до** первого `await` — по этой причине охраны поколения здесь не нужно, метка переживает ожидание, и `click`, пришедший следом, вторым вызовом не станет. `gesture` собирается до закрытия, как сейчас. Отказ зовётся через `#reportFailure` с `source` вида `handoffAction`.

`#keyboardHost().handOver` оборачивает вызов в `#fireAndForget`; движок его не ждёт. `#showWhatItemLeadsTo` и `#onLevelClick` тоже оборачивают, иначе отказ повиснет.

- [ ] **Step 4: Run the tests and the whole suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2`
Expected: PASS, включая существующий `handoff.spec.js`.

- [ ] **Step 5: Commit**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js
git commit -m "fix: асинхронная отдача управления ждёт действия и сохраняет жест"
```

---

### Task 6: Асинхронный `isArmableAction` и откат вооружения

**Files:**
- Modify: `src/MyContext.js` — `#onGlobalPointerDown` 1458, `#armsPress` 1500, `#isArmable` 1525, typedef `MyContextOptions.isArmableAction` 122
- Test: `tests/e2e/asyncActions.spec.js`

**Interfaces:**
- Consumes: `#fireAndForget`, `#reportFailure`, `#showCancelled` из задачи 1
- Produces: `#armsPress(event): boolean` остаётся синхронным и отвечает только за пресет и кнопку; новое асинхронное тело `#armPress(event): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```js
test('асинхронный предикат, разрешивший нажатие, показывает меню', async ({ page }) => {
  // pressAndHold: 'right', isArmableAction: async () => { await delay(20); return true; }
  await pressAndHold(page, 'right');
  expect((await read(page)).visible).toBe(true);
});

test('асинхронный предикат, отказавший, не показывает меню и снимает вооружение', async ({ page }) => {
  await pressAndHold(page, 'right');
  const log = await read(page);
  expect(log.visible).toBe(false);
  expect(await readArmed(page)).toBe(false);
});

test('отпускание в промежутке ожидания предиката не открывает меню под отпущенной кнопкой', async ({ page }) => {
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(5);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(60);
  expect((await read(page)).visible).toBe(false);
  expect(await readArmed(page)).toBe(false);
});

test('отказ предиката не открывает меню и доходит до error', async ({ page }) => {
  // isArmableAction: async () => { throw new Error('предикат упал'); }
  expect((await read(page)).errorMessages).toEqual(['предикат упал']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — предикат-строка приходит, `=== true` ложно, меню не открывается; при отказе вооружение остаётся висеть.

- [ ] **Step 3: Split `#armsPress` into a sync gate and an async body**

`#armsPress` теряет условие «внутри привязанного контейнера» и про предикат: остаются пресет и кнопка. `#onGlobalPointerDown` в ветке вооружения делает три вещи **до** `await`:

```js
#onGlobalPointerDown = (event) => {
  if (this.#destroyed) {
    return;
  }
  if (this.#armedPress !== null) {
    this.#closeMenu({ returnFocus: false });
    return;
  }
  if (this.#armsPress(event)) {
    event.preventDefault();
    this.#armedPress = { button: event.button, pointerId: event.pointerId };
    this.#fireAndForget(this.#armPress(event), 'isArmableAction');
    return;
  }
  /* …прежнее… */
};
```

`#armPress` — асинхронное тело: читает серию, ждёт `#isArmable`, и при отказе **снимает только то вооружение, которое поставил этот вызов** (сверяя по `pointerId` и `button`, иначе откат погасил бы чужое), при согласии открывает меню. После `await` действует охрана поколения, отказ попадает в `#reportFailure`.

- [ ] **Step 4: Document the text-selection cost in the JSDoc of `isArmableAction`**

В typedef `MyContextOptions` добавить абзац: при `pressAndHold: 'left'` с асинхронным предикатом выделение текста в контейнере подавляется на каждом нажатии, включая те, где предикат ответит `false`, потому что `preventDefault()` вызывается до ответа.

- [ ] **Step 5: Run the tests and the whole suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2`
Expected: PASS. Существующие `pressAndHold.spec.js` и `armedOpen.spec.js` остаются зелёными без правок — они используют синхронные предикаты.

- [ ] **Step 6: Commit**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js
git commit -m "fix: асинхронный isArmableAction гасит по кнопке и откатывает вооружение"
```

---

### Task 7: Обёртка подписчиков `open` и `close`

**Files:**
- Modify: `src/MyContext.js` — `addEventListener` 1988, `removeEventListener` 2026, рядом с `#assertAlive` добавить поле и метод
- Test: `tests/e2e/asyncActions.spec.js`

**Interfaces:**
- Consumes: `#reportFailure` из задачи 1
- Produces: приватное поле `#listenerWrappers: WeakMap<EventListenerOrEventListenerObject, EventListener>` и приватный признак `#reportingFailure: boolean`

- [ ] **Step 1: Write the failing tests**

```js
test('removeEventListener снимает подписку, обёрнутую изнутри', async ({ page }) => {
  await setup(page, { items: [{ label: 'Пункт' }], listener: 'removed' });
  expect((await read(page)).openCount).toBe(0);
});

test('одна и та же функция, подписанная дважды, не вызывается дважды', async ({ page }) => {
  await setup(page, { items: [{ label: 'Пункт' }], listener: 'twice' });
  expect((await read(page)).openCount).toBe(1);
});

test('отклонённый промис подписчика open доходит до error ровно один раз', async ({ page }) => {
  await setup(page, { items: [{ label: 'Пункт' }], listener: 'rejecting', watch: true });
  await page.evaluate(() => window.__mc.open(400, 300));
  await page.waitForTimeout(80);
  const log = await read(page);
  expect(log.errorMessages).toHaveLength(1);
  expect(log.listenerCalls).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=chromium tests/e2e/asyncActions.spec.js --workers=2`
Expected: FAIL — снятия подписки не происходит, а отказ подписчика не виден вовсе.

- [ ] **Step 3: Add the wrapper cache and the wrapper**

Поле `#listenerWrappers` инициализируется в конструкторе. `addEventListener` берёт обёртку из `WeakMap`, а при отсутствии создаёт, кладёт и подписывает её; `removeEventListener` берёт ту же обёртку. Если исходный аргумент — не функция (`EventListenerObject` или `null`), подписка идёт как есть: оборачивать нечего, и снятие тоже идёт напрямую.

Обёртка зовёт слушателя, и если вернулся промис — ловит отказ в `#reportFailure` с `source` вида `` `${type}:listener` ``.

- [ ] **Step 4: Guard `#reportFailure` against re-entry**

Подписчик `error`, который сам возвращает отклонённый промис, будет ловить собственный отказ обратно в `#reportFailure` — бесконечная петля. Поэтому `#reportFailure` начинает с проверки признака:

```js
#reportFailure(reason, source) {
  if (this.#reportingFailure) {
    // Отказ пришёл из подписчика `error`. Событие снова слать нельзя: его
    // подписчик только что и отказался, и второй вызов повторил бы петлю.
    queueMicrotask(() => {
      throw reason;
    });
    return;
  }
  /* …обычное тело… */
}
```

Признак ставится на время рассылки и снимается в `finally`.

- [ ] **Step 5: Run the tests and the whole suite**

Run: `npx playwright test --project=unit --project=chromium --workers=2`
Expected: PASS, включая существующий `events.spec.js`.

- [ ] **Step 6: Commit**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js
git commit -m "fix: отказ асинхронного подписчика open/close доходит до error"
```

---

### Task 8: Документация

**Files:**
- Modify: `README.md` — таблица опций (`README.md:479`), разделы `open()` (`README.md:774-783`), `openSubmenu`, `openAsSubmenu`, `labelAction`/`iconAction`/`submenuAction`/`isEnabledAction`/`action`/`handoffAction`/`isArmableAction`, события (`README.md:907`)
- Modify: `Demo/demo.js:303`
- Modify: `tests/e2e/contracts.spec.js` — ожидаемые сигнатуры полей

**Interfaces:**
- Consumes: всё из задач 1–7
- Produces: ничего

- [ ] **Step 1: Skip — падающего теста у правки документации нет**

Контрактные проверки в `contracts.spec.js` при этом обновляются: они обязаны проверять новые асинхронные сигнатуры, иначе обещание перестанет быть обещанием.

- [ ] **Step 2: Rewrite the affected README sections**

Снять обещание «показ синхронный» и заменить его формулировкой: синхронные действия дают показ до следующего кадра, асинхронные — когда данные готовы, поэтому `open`, `openSubmenu` и `openAsSubmenu` возвращают промис. Во всех восьми разделах действий привести новые сигнатуры. Добавить раздел про отказы: событие `error`, `detail` из `{ reason, source }`, `preventDefault()` и бросок как непойманная ошибка страницы; отдельно сказать, что отказ читающего действия летит из промиса `open()` и подписчиком `error` не отменяется. В раздел `isArmableAction` внести названную цену из задачи 6 и оговорку про `armed` из спеки §5.4. Отдельно описать, что переход уровня клавишей ждёт данных владельца перед переносом фокуса.

- [ ] **Step 3: Await `open()` in the demo**

В `Demo/demo.js:303` добавить `await` и сделать обработчик `async`, чтобы демо не показывало неверную модель.

- [ ] **Step 4: Update the contract expectations**

В `tests/e2e/contracts.spec.js` заменить ожидаемые сигнатуры полей на `() => string | Promise<string>` и `(event: MouseEvent | KeyboardEvent) => void | Promise<void>`.

- [ ] **Step 5: Run the whole suite and typecheck**

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
| 1 | Подписчик `error`, который сам возвращает отклонённый промис | Ровно одно событие `error`, отказ подписчика уходит в бросок, петли нет | 7 |
| 2 | `refreshItems`, ждущий данные, пока уровень сносят из-за смены состава | Ответы не применяются и запись `actions.set` не перебивает свежий пункт по ключу `menuId:index` | 3 |
| 3 | Одна и та же функция подписана на `open` дважды подряд | Обёртка кэшируется, слышен один вызов, а не два | 7 |
| 4 | Отказ читающего действия на `refreshItems` уже показанного уровня | Меню остаётся с прошлыми данными, промис из `open()` всё равно отклоняется | 3 |
| 5 | `destroy()` во время висящего показа | Ничего не показано, событие `open` не рассылалось, узлов `.vc-menu` в документе нет | 4 |

## Self-Review

- **Покрытие спеки.** §1.1 п.1–2 и §4 → задача 3; §1.1 п.6 и §3.4 → задача 6; §1.1 п.3 → задача 1; §1.1 п.4 и §6 → задачи 1, 5, 7; §1.1 п.5 → задача 5; §2.1–2.2 и §4 → задача 3; §2.3 и §5 → задача 4; §2.4–2.5 → задачи 1, 7; §8 → задачи 6, 8; §9 → по одной проверке на задачу. §3.1–3.3 → задачи 3, 8; §10 не требует работы.
- **Дыра, найденная при планировании, не в спеке.** `src/keyboard.js` в списке файлов спеки не значился, а `handleKeydown` содержит второй после `isArmableAction` случай, где `await` ломает `preventDefault()` (строка 655 стоит после `switch`). Правка описана в шаге 8 задачи 3.
- **Перестановка задач 1 и 5.** Первая задача вводила `#reportFailure` и `#fireAndForget`, но до задачи 5 их никто не звал, и падающего теста не существовало бы. Задача 1 и задача 5 слиты в один вертикальный срез, а защита `#reportingFailure` переехала в задачу 7, где её единственный триггер (подписчик с отклонённым промисом) и появляется.
- **Единство имён.** `#reportFailure`, `#fireAndForget`, `#showCancelled` вводятся в задаче 1 и дальше не переименуются; `#armPress` в задаче 6 отличается от `#armsPress` одной буквой намеренно, и это оговорено комментарием в коде.