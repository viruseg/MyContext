# Нативный жизненный цикл подменю, потеря фокуса и колесо над зоной — план реализации

**Цель:** подменю управляется активным пунктом родительского уровня, меню закрывается при потере фокуса страницы и переключении вкладки, колесо над зоной прокрутки гасится.

**Архитектура:** три независимые правки в трёх модулях. `hoverIntent.js` теряет половину контракта и остаётся владельцем отложенного открытия; `MyContext.js` выводит открытое подменю уровня из `#chain` и ловит переход на соседний пункт `pointerenter` на каждом доступном пункте показанного уровня; `scrollZones.js` гасит `wheel` на обеих зонах.

**Стек:** ES2026, чистый браузерный код без runtime-зависимостей. Popover API, `tsc --noEmit` поверх JSDoc, Playwright для e2e, три движка (chromium, firefox, webkit).

**Спека:** `docs/superpowers/specs/2026-09-29-native-submenu-lifecycle-design.md`

## Глобальные ограничения

- Проектные коммиты идут в текущую ветку; веток и worktree не создаём.
- Полный прогон всех тестов выполняется один раз, в самом конце. В ходе работы — только точечные прогоны по затронутым файлам и проектам.
- `npm run typecheck` обязателен после каждой задачи, меняющей `src/`.
- Комментарии и JSDoc — на русском, в стиле файлов: объясняют «почему», а не «что».
- Никаких новых зависимостей, никаких `any`/`object` в публичных сигнатурах.
- `PAGE_HTML`, часы `page.clock.install`/`pauseAt` и `emulateMedia({ reducedMotion: 'reduce' })` в e2e-файлах не трогаем: они разобраны существующими кейсами и ломают их вместе с собой.
- Порядок в `page.evaluate`-пробах (`__mc`) не меняем: он сериализуется в браузер как есть.
- `SUBMENU_OFFSET` остаётся в `src/constants.js` — его читает `positioner.js`.

## Фокус ревью

Пять входов, которые спека подразумевает, но ни один тест не проверяет. Для каждого указано, где берётся тест.

1. **Курсор ушёл с пункта-владельца в подменю и вернулся на этот же пункт.** `pointerenter` на владельце не сработает (курсор не покидал его), значит подменю не переоткроется само, если оно было закрыто `Escape` или кликом. Ожидание: подменю остаётся закрытым до явного ухода и возврата. Тест — Task 3, шаг 1 (`возврат курсора на владельца, чьё подменю закрыто Escape`).
2. **Вложенность глубины 3: переход на пункт корневого уровня при открытых трёх подменю.** `#hideSubmenuFor` обязан унести всю ветку целиком, а не только последний уровень. Тест — Task 2, шаг 2, вторая половина кейса `переход на соседнего владельца`: подменю «PNG» глубины два уходит вместе с подменю «Экспорта» глубины один.
3. **`blur` при непривязанном экземпляре.** Глобальные слушатели заводятся в `attach`, поэтому без привязки `blur` закрывать нечего — и не должен. Тест — Task 4, шаг 5.
4. **Колесо над зоной при `prefers-reduced-motion`.** Гашение не зависит от режима анимации, но живой кейс зон работает именно под `reduce`; проверка обязана идти тем же путём, что и остальные живые кейсы зон, иначе она прошла бы на коде, который в жизни не работает. Тест — Task 5, шаг 1.
5. **Отключённый пункт между двумя владельцами как сосед.** `pointerenter` на отключённый пункт не подписан (подписка только на доступные), поэтому наведение на него подменю **не** закрывает. Это расходится с сегодняшним кейсом, который требовал закрытия, и осознанно: в Windows отключённый пункт подсветку не получает и подменю не меняет. Тест — Task 3, шаг 1 (`наведение на отключённого соседа не закрывает подменю`).

---

### Task 1: `hoverIntent` остаётся владельцем только открытия

**Файлы:**
- Изменить: `src/hoverIntent.js`
- Изменить: `src/constants.js`
- Тест: `tests/unit/hoverIntent.spec.js`

**Интерфейсы:**
- Потребляет: `OPEN_GRACE_MS` из `src/constants.js`.
- Производит: `createHoverIntent(options): HoverIntentController`, где `HoverIntentController` = `{ itemEnter(): void, itemLeave(): void, isOpenPending(): boolean, itemPress(): void, cancelAll(): void }`. Опции: `{ openDelayMs?, schedule?, cancel?, onOpen? }`. `closeDelayMs`, `onClose`, `pointerMove`, `submenuEnter`, `isClosePending` **больше не существуют** — на них опирается Task 2.

- [ ] **Шаг 1: удалить кейсы закрытия из юнит-теста**

В `tests/unit/hoverIntent.spec.js` удалить 12 тестов: `курсор внутри безопасной области не планирует закрытие`, `курсор на границе безопасной области не планирует закрытие`, `курсор снаружи безопасной области планирует закрытие через closeDelayMs`, `возврат курсора внутрь отменяет запланированное закрытие`, `без открытого подменю любое движение планирует закрытие`, `вход в подменю снимает запланированное закрытие`, `зазор перед границей области планирует закрытие, а сама граница — нет`, `прямое движение к дальнему углу подменю не планирует закрытие`, `выход за верхний край области планирует закрытие`, `выход за нижний край области планирует закрытие`, `onClose срабатывает ровно один раз по истечении задержки`, `внутри колбэков флаги ожидания уже сняты`.

Переписать на одну задачу открытия два теста, проверявших обе задачи сразу: `cancelAll снимает и открытие, и закрытие` → `cancelAll снимает отложенное открытие` (задача открытия поставлена, `isOpenPending()` истинно, `cancelAll()`, `isOpenPending()` ложно, `onOpen` не зван) и `отменённые задачи не вызывают обратной связи` → `отменённая задача открытия не зовёт onOpen` (`itemEnter`, `cancelAll`, `advance(OPEN_GRACE_MS * 3)`, `onOpen` не зван).

Удалить из `@typedef {object} HoverIntentOptions` поля `closeDelayMs` и `onClose`; из `@typedef {object} HoverIntentController` — `submenuEnter`, `pointerMove`, `isClosePending`. Удалить `@typedef SafeArea`, `@typedef Point` и функцию `containsArea`. Импорт `{ CLOSE_GRACE_MS, OPEN_GRACE_MS }` заменить на `{ OPEN_GRACE_MS }`. Доктрину в шапке файла переписать: вместо «решает, летит ли курсор к подменю» — «решает, когда показать подменю по наведению»; всё про безопасную область и геометрию убрать.

- [ ] **Шаг 2: прогнать юнит-тесты и убедиться, что они падают на отсутствующем API**

Run: `npx playwright test --project=unit tests/unit/hoverIntent.spec.js`
Expected: FAIL — тесты `itemEnter планирует открытие` и прочие проходят, а падает любой оставшийся поход в удалённый API. Если падают и открывающие кейсы — в тесте осталась ссылка на `closeDelayMs` или `onClose`, её надо убрать в этом же шаге.

- [ ] **Шаг 3: вырезать закрытие из `src/hoverIntent.js`**

Удалить: `closeHandle`, `closePending`, `clearClose`, `planClose`, `fireClose`, `containsArea`, тело `pointerMove`, тело `submenuEnter`, `isClosePending` из возвращаемого объекта, `closeDelayMs` и `onClose` из деструктуризации опций (у `onClose` вместе с `@property` в JSDoc). `itemEnter` теряет вызов `clearClose()`. `itemPress` теряет `clearClose()`. `cancelAll` теряет вызов `clearClose()`. В `@typedef {object} HoverIntentController` убрать doc-блоки `submenuEnter`, `pointerMove`, `isClosePending`; в `@typedef {object} HoverIntentOptions` — `closeDelayMs`, `onClose`. Переписать доктрину модуля в шапке.

- [ ] **Шаг 4: удалить константы закрытия**

В `src/constants.js` удалить экспорты `CLOSE_GRACE_MS` и `SAFE_AREA_BUFFER` вместе с их JSDoc. `SUBMENU_OFFSET`, `OPEN_GRACE_MS`, `DEFAULT_ANIMATION_DURATION` и остальные не трогать.

- [ ] **Шаг 5: прогнать юнит-тесты**

Run: `npx playwright test --project=unit`
Expected: PASS, 11 кейсов.

- [ ] **Шаг 6: проверить типы**

Run: `npm run typecheck`
Expected: ошибок нет. Ошибки ожидаемы в `src/MyContext.js` — он ещё зовёт удалённый API; их устраняет Task 2, и здесь достаточно убедиться, что новых ошибок нет ни в одном другом файле.

- [ ] **Шаг 7: закоммитить**

```bash
git add src/hoverIntent.js src/constants.js tests/unit/hoverIntent.spec.js
git commit -m "refactor: hoverIntent остаётся владельцем только отложенного открытия"
```

---

### Task 2: состояние подменю выводится из цепочки, сосед закрывает

**Файлы:**
- Изменить: `src/MyContext.js`
- Тест: `tests/e2e/submenu.spec.js`

**Интерфейсы:**
- Потребляет: `HoverIntentController` из Task 1.
- Производит: приватное тело `#openSubmenuOf(entry: LevelEntry): RenderedItem | null` — владелец открытого подменю уровня `entry` либо `null`. Приватные поля `#showTargets: Map<Element, RenderedItem>` (только владельцы) и `#hoverTargets: Map<Element, RenderedItem>` (все доступные пункты показанного уровня).

- [ ] **Шаг 1: удалить кейсы, описывающие снятое поведение**

В `tests/e2e/submenu.spec.js` удалить тесты: `показ в новой точке снимает отложенное закрытие`, `уход курсора закрывает подменю, оставшееся после Escape`, `курсор на владельце, отключённом между показами, планирует закрытие как на любой строке`, `курсор, ушедший в сторону, закрывает подменю после closeDelayMs`, `край соседнего пункта родительского уровня не защищает подменю`, `край соседнего пункта-владельца, не раскрытого, не защищает подменю`, `подменю, прижатое к краю вьюпорта, переживает переход через зазор`. Импорт заменить на `{ OPEN_GRACE_MS, SAFETY_PADDING, SUBMENU_OFFSET }`. Доктрину в шапке файла поправить: предложение про «задержку закрытия подменю при этом остаётся настоящей» заменить на «закрытия подменю по уходу курсора не существует вовсе». В `acceptance.spec.js` и `globals.spec.js` удалить кейсы Task 2 удалит их поимённо — список в спецификации 9.3.

- [ ] **Шаг 2: добавить кейсы нового поведения (сосед)**

В `tests/e2e/submenu.spec.js`, в `describe('показ подменю')`:

`переход на соседнего пункта без подменю закрывает подменю` — набор `tree`, `openAt(OPEN_MIDDLE)`, `hoverItem('Экспорт')`, `fastForward(OPEN_GRACE_MS)`, взять `submenuIdOf('Экспорт')` и убедиться, что подменю открыто. `hoverItem('Новый')`. Без `fastForward` (закрытие мгновенное). Утвердить `isOpen(snapshot, submenuId) === false`, `openCount === 1`, `expandedLabels(after)` пуст, `activeLabels(after)` содержит `'Новый'`.

`переход на соседнего владельца закрывает прежнее сразу и открывает новое по OPEN_GRACE_MS` — набор `tree`, открыть подменю «Экспорт», затем `hoverItem('Скачать')` **внутри подменю «Экспорта»**. Сразу после наведения: `isOpen(exportSubmenuId) === true` (родительский уровень не трогаем), `isOpen(pngId) === false` (глубокое ушло). После `fastForward(OPEN_GRACE_MS)`: `isOpen(downloadId) === true`, `openCount === 3`. Это уже есть в существующем кейсе `переход на другой пункт усекает цепочку` — новый кейс отличается тем, что переход идёт на пункт **без** подменю; если существующий кейс покрывает шаг, новый не добавлять и вместо него усилить его комментарий.

- [ ] **Шаг 3: прогнать и убедиться, что новые кейсы падают**

Run: `npx playwright test --project=chromium tests/e2e/submenu.spec.js -g "сосед"`
Expected: FAIL — подменю не закрывается, потому что закрытия по соседу ещё нет.

- [ ] **Шаг 4: добавить `#openSubmenuOf` и `#hoverTargets` в `src/MyContext.js`**

Добавить поле `#hoverTargets = new Map()`. Добавить тело:

```js
  /**
   * Владелец подменю, открытого из уровня `entry`, либо `null`.
   *
   * Отдельного поля состояния у меню нет: открытое подменю уровня — это
   * последний элемент `#chain`, у которого `parent === entry`. Обход с конца
   * обязателен: уровень глубже своего родителя всегда стоит в цепочке позже,
   * и обход с начала вернул бы подменю самого верхнего владельца вместо
   * последнего. У корня владельца нет, и для него ответ `null` — закрывать
   * ему нечего.
   *
   * @param {LevelEntry} entry уровень, чьё открытое подменю ищется.
   * @returns {RenderedItem | null}
   */
  #openSubmenuOf(entry) {
    for (let position = this.#chain.length - 1; position >= CHAIN_ROOT_INDEX; position -= 1) {
      const candidate = this.#chain[position];
      if (candidate.parent === entry) {
        return candidate.ownerItem;
      }
    }
    return null;
  }
```

- [ ] **Шаг 5: переписать обработчик входа в пункт**

Заменить `#onItemEnter` на обработчик, работающий по `#hoverTargets` для всех доступных пунктов. Сигнатура: `#onItemEnter = (event: PointerEvent) => void`. Логика по шагам:

1. `if (this.#destroyed) return;`
2. `const target = event.target; if (!(target instanceof Element)) return;`
3. `const rendered = this.#hoverTargets.get(target); if (rendered === undefined) return;`
4. Найти уровень пункта: `const level = target.closest(MENU_SELECTOR); if (level === null) return;` затем `const entry = this.#levels.get(/** @type {HTMLElement} */ (level)); if (entry === undefined) return;`
5. **Сначала закрытие:** `const open = this.#openSubmenuOf(entry); if (open !== null && open !== rendered) { this.#hideSubmenuFor(open); }`
6. **Потом открытие:** `if (!rendered.hasSubmenu) return; this.#hoverOwner = rendered; this.#hover.itemEnter();`

Порядок шагов 5 и 6 обязателен и требует комментария: наоборот `#openSubmenu` обрезает цепочку до родителя, и следующий `pointerenter` не найдёт, что закрывать.

- [ ] **Шаг 6: наполнять и чистить `#hoverTargets` в `#leadAhead` и `#unsubscribeShowTarget`**

В `#leadAhead(entry)`: для **каждого** `rendered` с `rendered.focusable === true` — `this.#hoverTargets.set(rendered.element, rendered)` и `rendered.element.addEventListener('pointerenter', this.#onItemEnter)`. Для владельцев дополнительно остаётся нынешний блок: запись в `#showTargets` плюс `pointerleave` и `pointerdown`. То есть тело цикла получает вид: сначала проверка владельца (`hasSubmenu && focusable && submenuItems !== null`), и в обоих ветвях — общая строка подписки `pointerenter` для доступного пункта.

В `#unsubscribeShowTarget(rendered)`: снять `pointerenter` из обеих карт (`#hoverTargets.delete` для всех доступных, `#showTargets.delete` для владельцев), `pointerleave` и `pointerdown` — только для владельцев. Переименовать тело не нужно, но его JSDoc требуется переписать: теперь оно снимает подписку и с доступного пункта, а не только с владельца.

В `#forgetLevels(entries)`: в цикле по снятым уровням удалять из `#hoverTargets` записи по `element.contains(itemElement)` — тем же проходом, что уже есть для `#showTargets`. В `destroy()` — `this.#hoverTargets.clear()` рядом с `this.#showTargets.clear()`.

- [ ] **Шаг 7: вычистить закрытие по геометрии**

Удалить из `src/MyContext.js`: поле `#lastPointerPoint`, тела `#safeArea()`, `#pointerInsideSafeArea()`, `#feedPointerMove()`, обработчик `#onSubmenuEnter` и его `addEventListener` в `#ensureLevel` (уровень с `parent !== null` больше ничего не подписывает), колбэк `onClose` в конструкторе (в `createHoverIntent` остаётся только `onOpen`), импорт `SAFE_AREA_BUFFER` из `constants.js`. В `#onGlobalPointerMove` удалить `#isInsideMenu`-проверку и вызов `#feedPointerMove`, оставив `clearActive` — но `#isInsideMenu` тогда останется вызываться только из `#onGlobalPointerDown` и `#onGlobalContextMenu`, так что проверку в `#onGlobalPointerMove` снимать **нельзя** без перепроверки: оставить её, убрать только последнюю строку с `#feedPointerMove`. В `#onLevelPointerMove` удалить блок `if (item !== null && this.#showTargets.has(item)) return;` и вызов `this.#feedPointerMove(...)`. В `#forgetPlacement` удалить строку `this.#lastPointerPoint = null;`. Доктрину класса в шапке `MyContext` переписать: четыре абзаца про показ подменю по мыши превращаются в один, описывающий новое правило соседа.

- [ ] **Шаг 8: прогнать затронутые e2e**

Run: `npx playwright test --project=chromium tests/e2e/submenu.spec.js`
Expected: PASS.

Run: `npx playwright test --project=chromium tests/e2e/keyboard.spec.js tests/e2e/lifecycle.spec.js`
Expected: PASS. Клавиатурная модель не менялась, но `clearActive` и `#leadAhead` затронуты.

- [ ] **Шаг 9: прогнать типы и закоммитить**

Run: `npm run typecheck`
Expected: ошибок нет.

```bash
git add src/MyContext.js tests/e2e/submenu.spec.js tests/e2e/globals.spec.js tests/e2e/acceptance.spec.js
git commit -m "feat: подменю живёт по активному пункту уровня, а не по положению курсора"
```

---

### Task 3: уход в нейтральную область и возврат на владельца

**Файлы:**
- Тест: `tests/e2e/submenu.spec.js`

**Интерфейсы:**
- Потребляет: `#openSubmenuOf` и `#hoverTargets` из Task 2.
- Производит: ничего; задача закрепляет отрицания.

- [ ] **Шаг 1: написать кейсы отрицаний**

В `tests/e2e/submenu.spec.js`:

`уход курсора в пустоту не закрывает подменю` — открыть подменю «Экспорт», `page.mouse.move(30, 650)` (точка страницы вне меню), затем `fastForward(3000)`. Утвердить `isOpen === true`, `openCount === 2`, `expandedLabels` содержит `'Экспорт'`. Интервал втрое больше прежнего `CLOSE_GRACE_MS` — проверяется, что таймера не осталось, а не что он выбран неверно.

`уход на зону прокрутки и на поля каркаса не закрывает подменю` — набор `wide` из-за прокручиваемости, `hoverItem('Край')`, `fastForward(OPEN_GRACE_MS)`, затем `hoverNode('.vc-scroll-zone-down')` и `fastForward(3000)`. Утвердить подменю открыто. Второй шаг — `page.mouse.move` в точку рамки уровня по его `getBoundingClientRect()` минус `SAFETY_PADDING`; утвердить то же.

`возврат курсора на владельца, чьё подменю закрыто Escape, открывает его заново` — вход в цепочку с клавиатуры (`ArrowDown` ×2, `ArrowRight`, `ArrowDown`, `ArrowRight`), `Escape` (закрывает подменю «PNG»), затем `hoverItem('PNG')` и `fastForward(OPEN_GRACE_MS)`. Утвердить `isOpen(pngId) === true`, `openCount === 3`.

`диагональное движение к подменю не закрывает его` — оставить существующий кейс, переписав только комментарий: безопасной области больше нет, и кейс проверяет, что движение по отрезку не вызывает `pointerenter` ни на чужом пункте.

`наведение на отключённого соседа не закрывает подменю` — набор `pair`, `openAt(OPEN_MIDDLE)`, `hoverItem('Второй')`, `fastForward(OPEN_GRACE_MS)`, взять `submenuIdOf('Второй')`. Затем `page.evaluate` со `__mc.setAvailability(0, false)` и повторным `openAt(OPEN_MIDDLE)` — без этого «Первый» останется доступным. `hoverItem('Первый')`, `fastForward(3000)`. Утвердить `isOpen(submenuId) === true` и `expandedLabels(after)` содержит `'Второй'`. Кейс закрепляет осознанное решение: отключённый пункт в цикл роуминга не входит, подписки `pointerenter` не получает, и наведение на него подменю не меняет.

- [ ] **Шаг 2: прогнать**

Run: `npx playwright test --project=chromium tests/e2e/submenu.spec.js`
Expected: PASS. Если `уход курсора в пустоту` падает — в `#onGlobalPointerMove` или `#onLevelPointerMove` остался вызов `#feedPointerMove` либо подписка на закрытие; найти и удалить.

- [ ] **Шаг 3: закоммитить**

```bash
git add tests/e2e/submenu.spec.js
git commit -m "test: уход в нейтральную область подменю не закрывает"
```

---

### Task 4: закрытие при потере фокуса страницы

**Файлы:**
- Изменить: `src/MyContext.js`
- Тест: `tests/e2e/lifecycle.spec.js`

**Интерфейсы:**
- Потребляет: `#closeMenu({ returnFocus })` существующее приватное тело.
- Производит: два глобальных слушателя в таблице `#bindGlobalHandlers` — `{ target: window, type: 'blur', passive: true }` и `{ target: document, type: 'visibilitychange', passive: true }`.

- [ ] **Шаг 1: написать кейсы**

В `tests/e2e/lifecycle.spec.js` добавить два теста. Фокус события вызывается так, потому что `page.evaluate` не умеет ни потерять фокус окна, ни спрятать документ:

`blur окна закрывает меню и не возвращает фокус` — `makeMenu(page, 'chain', 'workspace')`, `rightClick(page, WORKSPACE_POINT)`, `page.keyboard.press('ArrowDown')`, `page.keyboard.press('ArrowRight')` (открыто подменю), затем

```js
await page.evaluate(() => { globalThis.dispatchEvent(new Event('blur')); });
```

Утвердить `openCount === 0`, `focusInMenu === false`, `focusOwnerId !== 'workspace'` (фокус не вернулся на контейнер), `errors` пуст.

`visibilitychange при hidden закрывает меню, при visible — нет` — то же состояние, затем

```js
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
});
```

Утвердить `openCount === 0`. Открыть заново, задать `hidden` в `false`, отправить событие, дождаться `SETTLE`-подобной паузы в 500 мс, утвердить `openCount === 2` (корень и подменю на месте).

- [ ] **Шаг 2: прогнать и убедиться, что кейсы падают**

Run: `npx playwright test --project=chromium tests/e2e/lifecycle.spec.js -g "blur окна|visibilitychange"`
Expected: FAIL — меню остаётся открытым, слушателей нет.

- [ ] **Шаг 3: добавить обработчики и строки таблицы**

В `src/MyContext.js` рядом с `#onGlobalResize` добавить:

```js
  /**
   * Потеря фокуса окном. Фокус ушёл из документа по воле браузера, и отбирать
   * его обратно нельзя: он либо в другом документе, либо на строке браузера.
   * Тот же класс пути, что скролл и `resize`, — оба закрывают без возврата.
   *
   * @type {() => void}
   */
  #onGlobalBlur = () => {
    if (this.#destroyed) {
      return;
    }
    this.#closeMenu({ returnFocus: false });
  };
```

и

```js
  /**
   * Уход вкладки в фон. Событие приходит и при возврате, поэтому состояние
   * читается: `hidden === false` означает, что страница снова видна, и меню
   * трогать нечего.
   *
   * @type {() => void}
   */
  #onVisibilityChange = () => {
    if (this.#destroyed || !document.hidden) {
      return;
    }
    this.#closeMenu({ returnFocus: false });
  };
```

В `#bindGlobalHandlers` добавить две строки в таблицу handlers:

```js
      { target: window, type: 'blur', handler: asListener(this.#onGlobalBlur), passive: true },
      {
        target: document,
        type: 'visibilitychange',
        handler: asListener(this.#onVisibilityChange),
        passive: true,
      },
```

`passive: true` обязателен: обработчики не зовут `preventDefault`, и браузеру незачем их ждать.

- [ ] **Шаг 4: прогнать**

Run: `npx playwright test --project=chromium tests/e2e/lifecycle.spec.js`
Expected: PASS. Существующий кейс `CLOSINGS` не трогается: `blur` там не значится, а добавление строк в таблицу не меняет ни одного из четырёх путей.

- [ ] **Шаг 5: проверить непривязанный экземпляр**

Добавить кейс `blur при непривязанном экземпляре не приводит к ошибке`: `makeMenu(page, 'chain', null)`, `rightClick(page, WORKSPACE_POINT)`, `page.evaluate` с тем же `dispatchEvent(new Event('blur'))`. Утвердить `openCount === 0`, `errors` пуст. Смысл: глобальные слушатели заводятся в `attach`, и без привязки их нет — кейс фиксирует, что добавление строк в таблицу не вынесло подписку куда-то ещё.

- [ ] **Шаг 6: проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: ошибок нет.

```bash
git add src/MyContext.js tests/e2e/lifecycle.spec.js
git commit -m "feat: меню закрывается при потере фокуса окна и уходе вкладки в фон"
```

---

### Task 5: колесо над зоной прокрутки гасится

**Файлы:**
- Изменить: `src/scrollZones.js`
- Тест: `tests/e2e/scrollZones.spec.js`

**Интерфейсы:**
- Потребляет: узлы `up`, `down` контроллера, уже переданные в `createScrollZones`.
- Производит: подписка `wheel` на обеих зонах с `{ passive: false }`, снимаемая в `destroy()`.

- [ ] **Шаг 1: заменить кейс колеса над зоной**

В `tests/e2e/scrollZones.spec.js` удалить `колесо над зоной прокручивает страницу и закрывает меню` и добавить на его месте `колесо над зоной не прокручивает страницу и не закрывает меню`. Опора та же: `mountLiveMenu(page, 'first', { kind: 'long', prefix: 'Пункт' })`, `openLiveMenu`, `readLive` для контроля `scrollY === 0`, `locator.hover()` по `ZONE_DOWN`, `page.mouse.wheel(0, 120)`, пауза `SETTLE_MS`. Утвердить `scrollY === 0`, `openCount`/`open` в снимке `readLive` — `open === true`, `blocked` не изменились.

- [ ] **Шаг 2: прогнать и убедиться, что кейс падает**

Run: `npx playwright test --project=chromium tests/e2e/scrollZones.spec.js -g "колесо над зоной"`
Expected: FAIL — страница прокрутится, `scrollY > 0`, меню закроется.

- [ ] **Шаг 3: добавить гашение в `src/scrollZones.js`**

Добавить тело:

```js
  /**
   * Колесо над зоной не достаётся ни до чего: у зоны нет `overflow`, и без
   * `preventDefault` колесо уходит странице, страница скроллится, и глобальный
   * обработчик закрывает меню. Зона — часть меню, и колесо над ней относится к
   * меню так же, как колесо над самим списком. Блокированная зона не исключение:
   * там некуда идти прокрутке, но колесо всё так же не её.
   *
   * @param {WheelEvent} event
   * @returns {void}
   */
  function onZoneWheel(event) {
    event.preventDefault();
  }
```

Подписать в том же месте, где вешаются `pointerenter`/`pointerleave`:

```js
  up.addEventListener('wheel', onZoneWheel, { passive: false });
  down.addEventListener('wheel', onZoneWheel, { passive: false });
```

и снять в `destroy()`:

```js
    up.removeEventListener('wheel', onZoneWheel);
    down.removeEventListener('wheel', onZoneWheel);
```

`removeEventListener` смотрит только на `capture`, поэтому расхождение по `passive` снятию не мешает — но для симметрии строк списка опция повторяется не везде, и здесь её нет.

- [ ] **Шаг 4: добавить кейс блокированной зоны**

`колесо над блокированной зоной тоже гасится`: `mountLiveMenu` на длинном наборе, `openLiveMenu`, дождаться `blocked.down === true` прокруткой списка колесом до низа (`page.mouse.wheel` над `LIST` до `atBottom`), затем `locator.hover()` по `ZONE_DOWN`, `page.mouse.wheel(0, 120)`, пауза. Утвердить `scrollY === 0` и `open === true`.

- [ ] **Шаг 5: прогнать весь файл зон**

Run: `npx playwright test --project=chromium tests/e2e/scrollZones.spec.js`
Expected: PASS, включая кейс `колесо над списком прокручивает список и переносит состояние зон` — он не должен сломаться, потому что подписка висит на зонах, а не на списке.

- [ ] **Шаг 6: проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: ошибок нет.

```bash
git add src/scrollZones.js tests/e2e/scrollZones.spec.js
git commit -m "feat: колесо над зоной прокрутки гасится и не роняет меню"
```

---

### Task 6: документация

**Файлы:**
- Изменить: `README.md`
- Изменить: `docs/superpowers/specs/2026-09-27-mycontext-design.md`

**Интерфейсы:**
- Потребляет: итоговое поведение Tasks 1–5.
- Производит: ничего.

- [ ] **Шаг 1: править README**

В `README.md`:
- В абзаце «Уход курсора с дерева меню его не закрывает: он закрывает подменю…» заменить описание на новое правило соседа: подменю остаётся открытым при уходе курсора в любую нейтральную область и закрывается только при переходе на соседний пункт того же уровня; у соседа с подменю открывается его подменю, без подменю — остаётся активным только сосед.
- В список глобальных закрывающих событий дописать потерю фокуса окна и уход вкладки в фон.
- В абзац «А колесо над зоной закрывает меню — вернее, закрывает, если страница прокручивается…» заменить на: колесо над зоной не делает ничего — ни страница не прокручивается, ни меню не закрывается; листают зону наведением.
- В таблицу токенов и в раздел опций проверить, нет ли в них `CLOSE_GRACE_MS`/`SAFE_AREA_BUFFER` в виде слов «задержка отложенного закрытия» применительно к подменю: у `animationDuration` остаётся «задержка отложенного закрытия уровня», а не подменю по курсору. Формулировки править точечно.

- [ ] **Шаг 2: пометить переопределённые разделы старой спеки**

В `docs/superpowers/specs/2026-09-27-mycontext-design.md` вверху добавить строку о том, что разделы 9.2 и 9.6 и таблица констант переопределены спекой `2026-09-29-native-submenu-lifecycle-design.md`. Из таблицы констант удалить строки `CLOSE_GRACE_MS` и `SAFE_AREA_BUFFER`.

- [ ] **Шаг 3: закоммитить**

```bash
git add README.md docs/superpowers/specs/2026-09-27-mycontext-design.md
git commit -m "docs: README и спека отражают нативный жизненный цикл подменю"
```

---

### Task 7: полный прогон

**Файлы:**
- Изменить: любой файл, в котором прогон вскрыл несоответствие.

**Интерфейсы:**
- Потребляет: всё, что сделано в Tasks 1–6.
- Производит: подтверждение, что вся библиотека цела.

- [ ] **Шаг 1: полный прогон**

Run: `npm test`
Expected: все проекты (`unit`, `chromium`, `firefox`, `webkit`) зелёные. Прогон занимает около восьми минут и выполняется один раз.

- [ ] **Шаг 2: разобрать падения**

Падения после полного прогона, которых не видели точечные, почти всегда двух видов: кейс в другом файле завязан на снятое закрытие по курсору (`globals.spec.js`, `acceptance.spec.js`, `keyboard.spec.js`) либо опечатка в типах, которую `typecheck` не видит из-за `@typedef`. Каждый такой кейс либо удаляется по списку спеки 9.3, либо переписывается под новое правило соседа.

- [ ] **Шаг 3: финальная проверка типов и коммит**

Run: `npm run typecheck`
Expected: ошибок нет.

```bash
git add -A
git commit -m "test: правки по результатам полного прогона"
```
