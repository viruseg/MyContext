# Закрытие меню до действия пункта — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** меню закрывается синхронно при активации пункта (клик, `Enter`/`Space`, отпускание под `pressAndHold`), а `action` вызывается уже после закрытия.

**Architecture:** закрытие переезжает из `finally` в `#invokeItemAction` в начало активации: `#runItemAction` закрывает меню публичным `close()` до вызова действия, путь отпускания возвращает фокус в момент закрытия. `#invokeItemAction` сокращается до вызова действия и разбора отказа; серийная проверка `#openSerial` и `finally` уходят.

**Tech Stack:** чистый ES2026, JSDoc + `tsc --noEmit`, Playwright (Chromium).

**Spec:** `docs/superpowers/specs/2026-10-29-close-before-action-design.md`

## Global Constraints

- Без новых рантайм-зависимостей: `dependencies` в `package.json` не существует.
- Поведение описывается в `README.md`, причина поведения — в `docs/ARCHITECTURE.md`; меняется поведение — правятся оба.
- Тесты: только Chromium, `--workers=2`. Firefox и WebKit не запускать без прямой просьбы человека.
- Тесты не запускать без показа команды и её цели (правило `AGENTS.md`). Полный прогон `npm run test:e2e` согласован утверждением этого плана.
- `npm run typecheck` прогоняет обе программы в порядке `tsconfig.json`, затем `tsconfig.node.json`.
- JSDoc и комментарии объясняют причину, а не пересказывают код; правка поведения обновляет их в том же коммите.
- Инвариант после изменения: `#invokeItemAction` меню **не закрывает**; любой вызывающий закрывает его сам до вызова.

## Review Focus

1. `destroyOnClose` + действие: экземпляр разобран до `action`; `open()`/`close()` из действия бросают `Error`, отказ приходит событием `error` с `source: 'action'`, а не теряется.
2. Долгое действие, завершившееся отказом: `close` приходит раньше `error`, неотменённый отказ по-прежнему уходит на страницу.
3. Переоткрытие из действия: `close`, затем `open`; новый показ не глушится устаревшей проверкой поколения, меню остаётся на экране.
4. Отпускание под `pressAndHold` над пунктом возвращает фокус контейнеру в момент закрытия (действие ещё идёт); отпускание мимо пунктов фокус не возвращает.
5. `Enter`/`Space`: активация идёт синтетическим кликом тем же путём; меню закрыто до действия, `blurAction` раньше `action`.

---

### Task 1: Закрытие до действия на всех путях активации

**Files:**
- Modify: `src/MyContext.js:1039-1055` (`#runItemAction`)
- Modify: `src/MyContext.js:1144-1186` (`#invokeItemAction`)
- Modify: `src/MyContext.js:1723-1770` (`#onGlobalPointerRelease`)
- Test: `tests/e2e/asyncActions.spec.js`
- Test: `tests/e2e/lifecycle.spec.js:1462-1521`

**Interfaces:**
- Consumes: `#actionFor(rendered): MenuItem | null`, `close(): void`, `#closeMenu({ returnFocus: boolean }): void`, `#itemUnderPointer(event): MenuItem | null`, `#reportFailure(reason, 'action')`.
- Produces: `#invokeItemAction(item: MenuItem, event: MouseEvent | KeyboardEvent): Promise<void>` — только вызов действия и разбор отказа, меню закрыто до входа. `#runItemAction(rendered, event): Promise<void>` — закрывает меню через `this.close()` после поиска пункта и до вызова. `#onGlobalPointerRelease` закрывает с `returnFocus: item !== null`.

- [ ] **Step 1: Расширить харнесс `asyncActions`**

В `tests/e2e/asyncActions.spec.js`:

1. В typedef `ActionInput` (строки 55-71) добавить поле:

```js
 * @property {boolean} [destroyOnClose] разбирать ли экземпляр на закрытии.
```

2. В typedef `ActionLog` (строки 73-89) добавить:

```js
 * @property {string[]} timeline события `open`, `close`, `error` по порядку.
```

3. Рядом с `closeCount` (строка 166) завести `const timeline = [];`.

4. В подписках (строки 394-416) наполнять ленту:

```js
        live.addEventListener('open', () => {
          openCount += 1;
          timeline.push('open');
        });
        live.addEventListener('close', () => {
          closeCount += 1;
          timeline.push('close');
        });
```

   и внутри подписки `error` (после `errorSources.push(...)`) — `timeline.push('error');`.

5. В `make` рядом с `closeCount = 0;` (строка 326) добавить `timeline.length = 0;`.

6. В объект `read()` (строки 498-521) добавить `timeline: timeline.slice(),`.

7. В `build0` (строки 379-392) добавить в `options`:

```js
        if (setup0.destroyOnClose !== undefined) {
          options.destroyOnClose = setup0.destroyOnClose;
        }
```

8. Рядом с `FAILURE_TEXT` (строка 125) добавить локальную константу:

```js
const DESTROYED_MESSAGE = 'MyContext: экземпляр уничтожен';
```

- [ ] **Step 2: Написать падающие тесты в `asyncActions.spec.js`**

В конце файла, рядом с существующим `test.describe('переоткрытие из действия', ...)`, добавить:

```js
test.describe('закрытие до действия', () => {
  test('долгое действие не удерживает меню на экране', async ({ page }) => {
    await setup(page, { items: [{ id: 'Медленный', slowAction: true }] });
    await openMenu(page);
    await activateItem(page);
    expect((await read(page)).visible, 'меню закрыто сразу после клика').toBe(false);
    await expect.poll(async () => {
      return (await read(page)).marks;
    }, { message: 'действие доиграло до конца' }).toEqual(['Медленный']);
  });

  test('destroyOnClose: экземпляр разобран до действия, действие доигрывает', async ({ page }) => {
    await setup(page, {
      items: [{ id: 'Медленный', slowAction: true }],
      destroyOnClose: true,
    });
    await openMenu(page);
    await activateItem(page);
    expect((await read(page)).visible, 'меню закрыто сразу').toBe(false);
    await expect.poll(async () => {
      return (await read(page)).marks;
    }, { message: 'действие доиграло на разобранном экземпляре' }).toEqual(['Медленный']);
    expect((await read(page)).closeCount, 'закрытие было одно').toBe(1);
  });

  test('destroyOnClose: open() из действия бросает и это видно как error', async ({ page }) => {
    await setup(page, {
      mode: 'ok',
      reopen: true,
      destroyOnClose: true,
      watch: true,
      preventDefault: true,
    });
    await openMenu(page);
    await activateItem(page);
    await expect.poll(async () => {
      return (await read(page)).errorSources;
    }, { message: 'отказ действия дошёл до подписчика' }).toEqual(['action']);
    const log = await read(page);
    expect(log.errorMessages[0], 'open() на разобранном экземпляре').toContain(DESTROYED_MESSAGE);
    expect(log.errorPrevented, 'подписчик отменил отказ').toBe(1);
    expect(log.visible, 'меню осталось закрытым').toBe(false);
    expect(log.closeCount, 'закрытие было одно').toBe(1);
    expect(log.escapedBy, 'наружу ничего не ушло').toEqual([]);
  });

  test('отпускание над пунктом возвращает фокус до конца действия', async ({ page }) => {
    await setup(page, {
      attached: true,
      pressAndHold: 'right',
      items: [{ id: 'Первый', slowAction: true }],
    });
    await page.mouse.move(OPEN_POINT.x, OPEN_POINT.y);
    await page.mouse.down({ button: 'right' });
    await expect.poll(async () => {
      return (await read(page)).visible;
    }, { message: 'нажатие показало меню' }).toBe(true);
    const point = await page.evaluate(() => {
      const item = document.querySelector('.vc-item');
      if (!(item instanceof HTMLElement)) {
        throw new Error('пункта нет');
      }
      const rect = item.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.up({ button: 'right' });
    // Снимок одним запросом: фокус и «действие ещё не отметилось» обязаны читаться
    // в один момент, иначе проверка ловила бы фокус уже после возврата закрытием.
    const moment = await page.evaluate(() => {
      const scope = /** @type {{ __mc: AsyncProbe }} */ (/** @type {unknown} */ (globalThis));
      return { focus: document.activeElement?.id ?? null, marks: scope.__mc.read().marks };
    });
    expect(moment.focus, 'фокус вернулся контейнеру в момент закрытия').toBe('surface');
    expect(moment.marks, 'действие ещё не закончилось').toEqual([]);
    await expect.poll(async () => {
      return (await read(page)).marks;
    }, { message: 'действие доиграло' }).toEqual(['Первый']);
  });

  test('close приходит раньше error отказавшего действия', async ({ page }) => {
    await setup(page, { mode: 'async-throw', watch: true });
    await openMenu(page);
    await activateItem(page);
    await expect.poll(async () => {
      return (await read(page)).errorMessages;
    }, { message: 'отказ дошёл до подписчика' }).toEqual([FAILURE_TEXT]);
    expect((await read(page)).timeline, 'закрытие раньше отказа').toEqual([
      'open',
      'close',
      'error',
    ]);
  });
});
```

- [ ] **Step 3: Прогнать `asyncActions` и увидеть падения**

Run: `npx playwright test tests/e2e/asyncActions.spec.js --project=chromium --workers=2`
Expected: новые кейсы падают: «меню закрыто сразу после клика» — `visible` равно `true`; лента — `['open', 'error', 'close']`; отказ `destroyOnClose` не приходит (`errorSources` пуст); при отпускании фокус не `surface`, а `null`/`body`. Остальные кейсы зелёные.

- [ ] **Step 4: Реализовать закрытие до действия в `src/MyContext.js`**

`#runItemAction` — закрыть меню после поиска пункта и до вызова:

```js
  /**
   * Исполняет действие пункта, найденного по `rendered`.
   *
   * Меню закрывается до вызова действия — с возвратом фокуса, как при выборе
   * пункта: долгое действие не имеет права держать меню на экране. Поэтому
   * действие видит закрытое меню, а переоткрытие из него — новый показ.
   *
   * Только клик: отпускание ищет пункт заранее и приходит с готовым `MenuItem`,
   * потому что закрытие стирает карту действий.
   *
   * @param {RenderedItem} rendered доступный пункт без подменю.
   * @param {MouseEvent | PointerEvent} event событие, которым действие вызвано.
   * @returns {Promise<void>}
   */
  async #runItemAction(rendered, event) {
    const item = this.#actionFor(rendered);
    if (item === null) {
      return;
    }
    this.close();
    await this.#invokeItemAction(item, event);
  }
```

`#invokeItemAction` — сократить до вызова и разбора отказа (серийная проверка и `finally` уходят):

```js
  /**
   * Исполняет действие пункта.
   *
   * Меню к этому моменту уже закрыто на всех путях: клик закрывает его в
   * `#runItemAction`, отпускание — в `#onGlobalPointerRelease`. Обратно к
   * экземпляру из `action` нельзя: `open()` откроет меню заново, а с
   * `destroyOnClose` экземпляр к этому моменту разобран, и `open()` или `close()`
   * бросят `Error`.
   *
   * Отказ разбирается здесь, а не уходит из тела: действие зовут из обработчика
   * DOM, и бросок наружу ушёл бы в отчёт браузера мимо библиотеки.
   *
   * @param {MenuItem} item пункт с прочитанным действием.
   * @param {MouseEvent | KeyboardEvent} event отпускание или активация, которой
   *   пункт выбран: `action` контрактом принимает именно их.
   * @returns {Promise<void>}
   */
  async #invokeItemAction(item, event) {
    try {
      await item.action?.(event);
    } catch (reason) {
      this.#reportFailure(reason, 'action');
    }
  }
```

`#onGlobalPointerRelease` — вернуть фокус в момент закрытия и обновить комментарий:

```js
    // Пункт под курсором ищется ДО закрытия: разбор в `#closeMenu` стирает карту
    // действий, и с `destroyOnClose` искать после него нечего. Закрытие возвращает
    // фокус контейнеру, когда действие будет вызвано, — и возвращает его сразу, а не
    // после ответа действия. Действие получает закрытое меню, а с `destroyOnClose` —
    // разобранный экземпляр (см. `#invokeItemAction`).
    const item = this.#itemUnderPointer(event);
    // Снятие здесь, а не в `#closeMenu`: путь «меню уже закрыто» тоже обязан
    // разоружить жест, иначе отпускание без меню вооружило бы следующее нажатие
    // не тем же, а уже не состоявшимся.
    this.#closeMenu({ returnFocus: item !== null });
    if (item === null) {
      return;
    }
    this.#fireAndForget(this.#invokeItemAction(item, event), 'action');
```

- [ ] **Step 5: Обновить существующие кейсы под новый контракт**

В `tests/e2e/asyncActions.spec.js`:

1. Кейс «асинхронное действие переоткрывает меню, и закрытие по клику не сбивает поколение» (строка 619) переименовать в «асинхронное действие переоткрывает меню новым показом» и заменить ожидание закрытия:

```js
    expect(log.closeCount, 'клик закрыл меню, переоткрытие — новый показ').toBe(1);
    expect(log.visible).toBe(true);
```

2. Кейс «синхронное действие, зовущее open, ведёт себя так же» (строка 633): заменить `expect(log.closeCount).toBe(0);` на `expect(log.closeCount).toBe(1);`.

3. Кейс «меню ждёт асинхронное действие владельца и закрывается после него» (строки 774-798) заменить целиком:

```js
test.describe('действие владельца подменю', () => {
  test('меню закрывается сразу, а не ждёт асинхронное действие владельца', async ({ page }) => {
    await setup(page, {
      items: [{
        id: 'Ветка',
        label: 'Ветка',
        slowAction: true,
        submenu: [{ id: 'Лист', label: 'Лист' }],
      }],
    });
    await openMenu(page);
    await activateItem(page);

    // Владелец с собственным действием активируется как обычный пункт: меню уходит
    // с экрана до вызова действия, и асинхронный ответ не держит его на странице.
    expect((await read(page)).visible, 'меню закрыто до ответа действия').toBe(false);
    await expect.poll(async () => {
      return (await read(page)).marks;
    }, { message: 'действие владельца доиграло' }).toEqual(['Ветка']);
    expect((await read(page)).escapedBy, 'наружу ничего не ушло').toEqual([]);
  });
});
```

В `tests/e2e/lifecycle.spec.js`:

4. Кейс «action, вызвавший await open(), не отменяется отложенным закрытием» (строка 1462) переименовать в «action, вызвавший await open(), показывает меню новым показом». Обновить комментарии, описывающие прежнюю механику: абзац про «закрытие, начатое обработчиком активации после действия» и «пропуск закрытия» заменить формулировкой «клик закрывает меню до действия, а `open()` из действия — новый показ в новой точке». Ассерты оставить прежними (`openCount` здесь — число показанных уровней, а не событий).

- [ ] **Step 6: Прогнать оба файла и убедиться, что зелено**

Run: `npx playwright test tests/e2e/asyncActions.spec.js tests/e2e/lifecycle.spec.js --project=chromium --workers=2`
Expected: PASS. Если lifecycle-кейс упал на позиции или видимости после переоткрытия — проверить, что `open()` из действия вытесняет идущее закрытие слоя (тесты `tests/e2e/layer.spec.js` про снятие отметки закрытия), и скорректировать только ожидание, не ослабляя смысл.

- [ ] **Step 7: Коммит**

```bash
git add src/MyContext.js tests/e2e/asyncActions.spec.js tests/e2e/lifecycle.spec.js
git commit -m "fix: меню закрывается до вызова действия пункта"
```

---

### Task 2: Фокус и порядок `blurAction`/`action` на клике и с клавиатуры

**Files:**
- Test: `tests/e2e/focusActions.spec.js` (проба, `MakeInput`, два кейса)

**Interfaces:**
- Consumes: поведение Task 1 — `#runItemAction` закрывает меню до действия.
- Produces: кейсы, закрепляющие порядок `blurAction` → `action` и возврат фокуса контейнеру.

- [ ] **Step 1: Научить пробу записывать вызов `action`**

В `tests/e2e/focusActions.spec.js`:

1. В typedef `MakeInput` (строки 74-83) добавить:

```js
 * @property {boolean} [actionNotes] писать ли вызов `action` первого пункта в журнал.
```

2. Рядом с `asyncActions`/`reopenOnFocus` (строки 167-171) завести `let actionNotes = false;`.

3. В `make` рядом с `asyncActions = input.asyncActions === true;` (строка 342) добавить `actionNotes = input.actionNotes === true;`.

4. В `items()` (строки 249-284) заменить действие первого пункта:

```js
      /** @type {MenuItem} */
      const first = {
        labelAction: () => 'Первый',
        action: actionNotes ? () => { log.push('action:Первый'); } : () => {},
      };
```

- [ ] **Step 2: Написать кейсы**

В `test.describe('закрытие и снос', ...)` (рядом с «выбор пункта зовёт blur», строка 810) добавить:

```js
  test('клик закрывает меню до действия, и blur приходит раньше action', async ({ page }) => {
    await makeMenu(page, { actionNotes: true });
    await hoverItem(page, 'Первый');
    await page.evaluate(() => {
      const scope = /** @type {{ __focus: Probe }} */ (/** @type {unknown} */ (globalThis));
      scope.__focus.clickItem('Первый');
    });
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый', 'action:Первый']);
    expect(after.shown, 'меню закрыто').toBe(0);
    expect(
      await page.evaluate(() => document.activeElement?.id),
      'фокус вернулся контейнеру',
    ).toBe('surface');
  });

  test('Enter закрывает меню до действия тем же путём', async ({ page }) => {
    await makeMenu(page, { actionNotes: true });
    await hoverItem(page, 'Первый');
    await press(page, 'Enter');
    const after = await readMenu(page);
    expect(after.log).toEqual(['focus:Первый', 'blur:Первый', 'action:Первый']);
    expect(after.shown, 'меню закрыто').toBe(0);
  });
```

- [ ] **Step 3: Прогнать `focusActions`**

Run: `npx playwright test tests/e2e/focusActions.spec.js --project=chromium --workers=2`
Expected: PASS (поведение уже изменено в Task 1; кейсы закрепляют его). Если журнал оказался `['focus:Первый', 'action:Первый', 'blur:Первый']` — Task 1 не применён к пути клика, вернуться к нему.

- [ ] **Step 4: Коммит**

```bash
git add tests/e2e/focusActions.spec.js
git commit -m "test: blur приходит раньше action при активации пункта"
```

---

### Task 3: Документация контракта и итоговая проверка

**Files:**
- Modify: `README.md:199-201`, `README.md:522-524`, `README.md:722-726`
- Modify: `docs/ARCHITECTURE.md` (раздел «Обоснования решений», после «Отдача управления уходит с экрана до ожидания»)

**Interfaces:**
- Consumes: поведение Task 1-2.
- Produces: контракт, записанный в README (поведение) и ARCHITECTURE (причина).

- [ ] **Step 1: Обновить README**

1. Абзац про `action` (строки 199-201) заменить:

```markdown
`action` получает настоящее событие активации с настоящей целью. **Меню закрыто до
вызова действия** на всех путях активации — клик, `Enter`/`Space` и отпускание под
`pressAndHold`: долгое действие не удерживает меню на экране. Отказ разбирается
событием `error`. `open()` изнутри действия — новый показ: подписчик получает `close`,
затем `open`; с `destroyOnClose` экземпляр к этому моменту разобран, и `open()` или
`close()` бросают `Error`.
```

2. Пункт «Действие пункта не должно звать меню обратно» (строки 522-524): убрать
   «Путь клика ограничения не имеет» и закончить правилом:

```markdown
- **Действие пункта не должно звать меню обратно.** Меню закрывается раньше, чем зовётся
  действие, а с `destroyOnClose` — ещё и разбирается экземпляр. `open()` или `close()`
  изнутри `action` бросят `Error`. Правило одно на всех путях активации.
```

3. Абзац `pressAndHold` «Отпускание над доступным пунктом исполняет его действие»
   (строки 722-726): обоснование «чтобы открытое им заново меню не убивалось закрытием»
   заменить на «чтобы долгое действие не удерживало меню на экране»; остальное оставить.

- [ ] **Step 2: Дописать ARCHITECTURE**

В раздел «Обоснования решений», после «Отдача управления уходит с экрана до ожидания»,
добавить:

```markdown
### Активация закрывает меню до действия

Клик по пункту, `Enter`/`Space` и отпускание под `pressAndHold` закрывают меню до вызова
`action`: иначе долгое действие держало бы меню на экране всё время запроса, а пункт
«Сохранить» с сетевым вызовом выглядел бы зависшим. Отдача управления устроена так же, и
раньше: описание жеста уходит наружу синхронно, промис ждётся после.

Цена — контракт переоткрытия. Действие больше не может отменить закрытие: решение о нём
принято до ответа действия. `open()` изнутри `action` — новый показ (`close`, затем
`open`), а с `destroyOnClose` экземпляр к этому моменту разобран, и `open()` бросает
`Error` — то же правило, что уже действовало на пути отпускания.

Вариант «закрывать после синхронной части действия» отвергнут: он сохранил бы отмену
закрытия синхронным `open()`, но ввёл бы правило «переоткрытие работает, пока в действии
нет `await`» — асимметрию синхронного и асинхронного действия, которую прежний код
сознательно убирал.
```

- [ ] **Step 3: Проверить типы**

Run: `npm run typecheck`
Expected: обе команды без вывода и с кодом 0.

- [ ] **Step 4: Прогнать затронутые наборы**

Run: `npx playwright test tests/e2e/asyncActions.spec.js tests/e2e/lifecycle.spec.js tests/e2e/focusActions.spec.js tests/e2e/destroyOnClose.spec.js tests/e2e/armedOpen.spec.js --project=chromium --workers=2`
Expected: PASS.

- [ ] **Step 5: Прогнать полный набор Chromium**

Run: `npm run test:e2e`
Expected: PASS. Изменение центральное — активация задействована в `acceptance`, `events`,
`globals`, `keyboard`, `pressAndHold`, `submenu`, — поэтому прогон полный, а не выборочный.
Запуск согласован утверждением плана; если человек передумал — спросить.

- [ ] **Step 6: Коммит**

```bash
git add README.md docs/ARCHITECTURE.md
git commit -m "docs: закрытие меню до действия и переоткрытие как новый показ"
```
