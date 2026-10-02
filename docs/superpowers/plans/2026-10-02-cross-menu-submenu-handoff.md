# Межпроектная передача управления по контракту `openSubmenu(x, y, handoff)` — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Научить `MyContext` и `Pielet` открывать друг друга как сабменю в режиме удержания кнопки, передавая живой жест через один общий контракт `openSubmenu(x, y, handoff)`.

**Architecture:** Одно имя метода и одна форма третьего аргумента в обоих пакетах. `handoff` описывает жест (`{ button, held }`), а не факт показа: `held` решает, вооружать ли жест удержания, `button` сужает, чьё отпускание его закончит. Каждая сторона и передаёт жест (родитель строит `handoff` из состояния своего runtime), и принимает его (ребёнок вооружается на переданной кнопке вместо своей конфигурации). Политика ребёнка — `interactionMode` / `pressAndHold` — не меняется.

**Tech Stack:** JavaScript (ESM) с JSDoc-типизацией, `tsc --noEmit` как проверка типов; vitest + jsdom (`Pielet`), Playwright + Chromium (`MyContext`).

**Spec:** `docs/superpowers/specs/2026-10-02-cross-menu-submenu-handoff-design.md`

Два репозитория, общих коммитов нет. Все файлы в блоке «Файлы» — относительно корня своего репозитория.

---

## Global Constraints

- Правила репозиториев: правки идут **напрямую в текущую ветку**, без worktree и без pull request'ов.
- Тесты: **только Chromium**, `--workers=2`. Firefox и WebKit не запускаются без отдельной прямой просьбы. Прогон запускается **только по явному согласию человека**; каждый шаг «Run test» ниже — это команда, которую нужно показать и согласовать, а не запустить молча.
- Комментарии и документация — по правилам репозитория: JSDoc на всём публичном API, инлайн-комментарии только там, где объясняют **почему** (неочевидный подход, инвариант, обход платформенной особенности). Комментарий, который устареет при правке кода, не пишется.
- Ошибки: **`Pielet` бросает `Error` с префиксом `Pielet:`**, **`MyContext` бросает `TypeError` с путём до поля**. Каждая проверка негодного значения обязана иметь сообщение; молчаливое игнорирование запрещено.
- Стиль сообщений о коммитах: **`Pielet` — по-английски**, **`MyContext` — по-русски**. Это уже так в истории обоих репозиториев.
- Никаких новых зависимостей. `MyContext` не получает `Pielet` в `package.json`, и наоборот.
- Коммит на каждую задачу.

---

## Review Focus

Пять классов ввода и отказов, которые спека подразумевает, но чьи тесты ни одна задача не покрывает. Для каждой строки тест добавлен в задачу, которой принадлежит код.

1. **Отпускание кнопки, которую handoff не называл.** Родитель передал `button: 'right'`; отпускание `left` не должно закрывать ребёнка — иначе меню закрылось бы чужим жестом, которого не было. → задачи 3 (Pielet) и 7 (MyContext).
2. **Повторный показ поверх перекрытия.** `openSubmenu(x, y, handoff)` на уже открытом `Pielet` снимает снапшот заново; следующий `open()` обязан вернуть `config.button`, а перекрытый — уйти. Иначе меню навсегда осталось бы с чужой кнопкой. → задача 3.
3. **`handoff: null` против `handoff: undefined`.** `undefined` — «не задан», `null` — «не объект». Различие обязано быть явным, иначе один из вызовов станет ошибкой формы, а другой — тихим показом без жеста. → задачи 3 и 7.
4. **`destroyOnClose` у `MyContext`, полученного по контракту.** Разбор отпускания стирает карту действий, поэтому `action` получает уже разобранный экземпляр. Задокументировано для `openAsSubmenu`, по новому пути не проверено. → задача 7.
5. **Двойная передача: Pielet → MyContext → Pielet.** Родительский `Pielet` уже ушёл, `MyContext` уходит сразу после показа, второй `Pielet` встаёт в реестр активных меню. На экране должно остаться ровно одно меню, а жест — дойти до конца. → задача 11.

---

## File Structure

**`Pielet`**

| Файл | Ответственность после правок |
|---|---|
| `src/interaction/InteractionController.js` | Разбор указателя. Новое: `button: MouseButtonName \| null` (`null` — любая кнопка) и наблюдаемое состояние «отслеживаемая кнопка зажата» |
| `src/pielet.js` | Публичный API показа. Новое: `#openMenu(x, y, buttonOverride)`, приём контракта в `openSubmenu`, `#runtimeButton`, сборка `handoff` в `#showSubmenu` |
| `src/config/buttons.js` | Таблицы имён кнопок. Без правок: `BUTTON_NAMES` уже есть и годится для проверки формы |
| `src/types.js` | Публичные JSDoc-типы. Новое: `SubmenuHandoff`, переписанный `SubmenuTarget` |
| `src/config/validateConfig.js` | **Без правок.** Форма `handoff` проверяется на приёме, в момент показа; конфиг к ней отношения не имеет |
| `tests/unit/interaction/InteractionController.test.js` | Юнит-тесты контроллера |
| `tests/integration/Pielet.test.js` | Приём и передача контракта целиком |
| `e2e/pielet.e2e.spec.js` | Сквозной приём контракта в реальном браузере |
| `demo/main.js` | Демо приёмника-контракта |
| `README.md`, `docs/api.md`, `docs/changelog.md` | Документация |

**`MyContext`**

| Файл | Ответственность после правок |
|---|---|
| `src/MyContext.js` | Всё состояние меню. Новое: таблица кодов кнопок, `#armExternalPress(button)`, `openSubmenu(x, y, handoff)`, `openAsSubmenu` через него, разбор `handoff` для `handoffAction` |
| `src/renderer.js` | **Без правок.** Внешний вид отдающего уже совпадает с владельцем подменю |
| `tests/e2e/armedOpen.spec.js` | Вооружение на названную кнопку, режим «любая кнопка» |
| `tests/e2e/handoff.spec.js` | Второй аргумент `handoffAction` |
| `Demo/scenarios.js`, `Demo/demo.js` | Демо приёмника-контракта |
| `README.md` | Документация, включая исправление нерабочего примера |
| `scripts/serve.js` | Опциональная раздача соседнего репозитория — ради сквозного теста задачи 11 |

Порядок работ: сначала `Pielet` (задачи 1–6), затем `MyContext` (7–10), затем сквозное (11). Задачи 1–10 независимы между собой внутри своего проекта; задача 11 depends on all of them.

---

### Task 1: `Pielet` — «любая кнопка» в `InteractionController`

**Files:**
- Modify: `Pielet/src/interaction/InteractionController.js:79` (`this.#button = BUTTON_CODES[button]`), `:82` (`#buttonBits`), `:134-136` (`#onMove`), `:173-176` (`#onUp`)
- Test: `Pielet/tests/unit/interaction/InteractionController.test.js`

**Interfaces:**
- Consumes: `BUTTON_CODES`, `BUTTON_BITS` из `Pielet/src/config/buttons.js` (без правок).
- Produces: конструктор `InteractionController` принимает `button: import('../types.js').MouseButtonName | null`, где `null` означает «любая кнопка». Поле `#button` становится `MouseButtonName | null`, поле `#buttonBits` — `number | null`. Наружу это пока ничего не выдаёт; чтение состояния — задача 4.

- [ ] **Step 1: Написать падающие тесты**

В `tests/unit/interaction/InteractionController.test.js` добавить `describe('InteractionController — любая кнопка')`, переиспользуя уже имеющиеся helpers `makeGeometry`, `CENTER`, `pointAt`, `fire`:

```js
describe('InteractionController — любая кнопка (button: null)', () => {
  function makeController(overrides = {}) {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const controller = new InteractionController({
      interactionMode: 'hold',
      button: null,
      geometry: makeGeometry(),
      ...CENTER,
      onHover: vi.fn(),
      onClose,
      onSelect,
      ...overrides
    });
    controller.attach();
    return { controller, onClose, onSelect };
  }

  it('hold: отпускание любой кнопки выбирает сектор', () => {
    const { onClose, onSelect } = makeController();
    fire(window, 'pointermove', { ...pointAt(0.3), buttons: 1 });
    fire(window, 'pointerup', { ...pointAt(0.3), button: 2 });
    expect(onSelect).toHaveBeenCalledWith(0, expect.anything());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hold: отпускание правой кнопки не закрывает постороннюю кнопку', () => {
    // Пункт вне сектора закрывает меню молча — но только если кнопка отслеживается.
    // Здесь отслеживается любая, и «посторонней» кнопки быть не может.
    const { onSelect, onClose } = makeController();
    fire(window, 'pointermove', { ...pointAt(0, 5), buttons: 1 });
    fire(window, 'pointerup', { ...pointAt(0, 5), button: 2 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hold: движение с любой зажатой кнопкой не закрывает меню', () => {
    const { onClose } = makeController();
    fire(window, 'pointermove', { ...pointAt(0.3), buttons: 2 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hold: движение без зажатых кнопок закрывает меню', () => {
    const { onClose } = makeController();
    fire(window, 'pointermove', { ...pointAt(0.3), buttons: 0 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd Pielet && npx vitest run tests/unit/interaction/InteractionController.test.js`

Expected: FAIL — `BUTTON_CODES[null]` даёт `undefined`, `#onUp` отбрасывает событие по `event.button !== undefined` и `onSelect`/`onClose` не зовутся.

- [ ] **Step 3: Реализовать в `src/interaction/InteractionController.js`**

1. JSDoc поля `#button` становится `@type {import('../types.js').MouseButtonName | null}` с пояснением, что `null` — «любая кнопка» по контракту `openSubmenu`. `#buttonBits` — `@type {number | null}`.
2. В конструкторе: `this.#button = button;` и `this.#buttonBits = button === null ? null : BUTTON_BITS[button];` — таблица `BUTTON_CODES` больше не нужна, убери её из импорта, если других читателей нет.
3. В `#onMove` первая строка расчёта `held` становится тернарной: `this.#button === null ? event.buttons !== 0 : (event.buttons & this.#buttonBits) !== 0`.
4. В `#onUp` проверка кнопки становится `if (this.#button !== null && event.button !== this.#button) return;`.
5. Обе ветки в JSDoc `@param` конструктора.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd Pielet && npx vitest run tests/unit/interaction/InteractionController.test.js`

Expected: PASS, включая все существующие тесты файла — ветка с именем кнопки осталась буквально прежней.

- [ ] **Step 5: Коммит**

```bash
cd Pielet && git add src/interaction/InteractionController.js tests/unit/interaction/InteractionController.test.js
git commit -m "Track any button when the contract hands over an unnamed gesture"
```

---

### Task 2: `Pielet` — приём контракта в `openSubmenu`

**Files:**
- Modify: `Pielet/src/pielet.js:54-140` (`open`), `:152-154` (`openSubmenu`), добавить поле `#runtimeButton`
- Test: `Pielet/tests/integration/Pielet.test.js`

**Interfaces:**
- Consumes: результат задачи 1 — `InteractionController` принимает `button: null`.
- Produces: `Pielet#openMenu(x: number, y: number, buttonOverride: MouseButtonName | null): void` (приватный); поле `#runtimeButton: MouseButtonName | null` — кнопка, которую отслеживает текущий показ (читает задача 4); `@typedef SubmenuHandoff` в `src/types.js`, на который ссылаются JSDoc и задача 6.

- [ ] **Step 1: Написать падающие тесты**

В `tests/integration/Pielet.test.js` добавить `describe('Pielet.openSubmenu — приём контракта')`. Опора на уже имеющиеся `makeMenu`, `sleep`, `afterEach`:

```js
describe('Pielet.openSubmenu — приём контракта', () => {
  it('held: false — ведёт себя как open(x, y)', () => {
    menu = makeMenu();
    menu.openSubmenu(300, 300, { button: 'right', held: false });
    expect(document.body.querySelectorAll('.pielet')).toHaveLength(1);
  });

  it('без handoff — ведёт себя как open(x, y)', () => {
    menu = makeMenu();
    menu.openSubmenu(300, 300);
    expect(document.body.querySelectorAll('.pielet')).toHaveLength(1);
  });

  it('handoff: null — ошибка формы', () => {
    menu = makeMenu();
    expect(() => menu.openSubmenu(300, 300, null)).toThrow(/handoff/);
  });

  it('handoff без held — ошибка формы', () => {
    menu = makeMenu();
    expect(() => menu.openSubmenu(300, 300, { button: 'left' })).toThrow(/held/);
  });

  it('handoff.held не логическое — ошибка формы', () => {
    menu = makeMenu();
    expect(() => menu.openSubmenu(300, 300, { button: 'left', held: 'yes' })).toThrow(/held/);
  });

  it('неизвестное имя кнопки — ошибка формы', () => {
    menu = makeMenu();
    expect(() => menu.openSubmenu(300, 300, { button: 'extra', held: true })).toThrow(/button/);
  });

  it('held: true с именем — перекрывает кнопку показа, config не трогает', () => {
    // Перекрытие обязано жить ровно один показ: иначе меню навсегда осталось бы с
    // чужой кнопкой, а config — единственное место, где автор её объявляет.
    menu = makeMenu({ button: 'left', interactionMode: 'hold' });
    menu.openSubmenu(300, 300, { button: 'right', held: true });
    expect(menu.config.button, 'config не изменён').toBe('left');

    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 301, clientY: 380 }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 301, clientY: 380 }));
    expect(document.body.querySelectorAll('.pielet'), 'отпускание чужой кнопки не закрыло').toHaveLength(1);

    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 2, clientX: 301, clientY: 380 }));
    expect(document.body.querySelectorAll('.pielet'), 'отпускание переданной кнопки закрыло').toHaveLength(0);
  });

  it('held: true с button: null — отслеживается любая кнопка', () => {
    menu = makeMenu({ button: 'left', interactionMode: 'hold' });
    menu.openSubmenu(300, 300, { button: null, held: true });
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 2, clientX: 301, clientY: 380 }));
    expect(document.body.querySelectorAll('.pielet')).toHaveLength(0);
  });

  it('повторный openSubmenu без handoff возвращает кнопку конфигурации', () => {
    // Регрессия из Review Focus: перекрытие не должно пережить следующий показ.
    menu = makeMenu({ button: 'left', interactionMode: 'hold' });
    menu.openSubmenu(300, 300, { button: 'right', held: true });
    menu.open(300, 300);
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 301, clientY: 380 }));
    expect(document.body.querySelectorAll('.pielet')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd Pielet && npx vitest run tests/integration/Pielet.test.js -t "приём контракта"`

Expected: FAIL — нынешний `openSubmenu` игнорирует третий аргумент, и все кейсы с `held: true` проверяют не то поведение.

- [ ] **Step 3: Объявить `SubmenuHandoff` в `src/types.js`**

`@typedef SubmenuHandoff` — `{ button: MouseButtonName | null; held: boolean }`, с пояснением: `held` решает, есть ли жест; `button` сужает, чьё отпускание его закончит, `null` означает «любая кнопка»; при `held: false` поле справочное. Отдельный тип `ButtonName` **не заводить** — в `src/types.js` уже есть `MouseButtonName` с ровно этими пятью именами, и второй typedef с тем же содержимым разошёлся бы с ним.

- [ ] **Step 4: Реализовать в `src/pielet.js`**

1. Модульный хелпер разбора `handoff` — рядом с прочими, до класса:

```js
/**
 * @param {unknown} handoff третий аргумент `openSubmenu`, как его передал вызывающий.
 * @returns {import('../types.js').MouseButtonName | null} кнопка показа либо `null`,
 *   когда показа без жеста или жест держит не названная кнопка.
 * @throws {Error} на негодном значении.
 */
function buttonOfHandoff(handoff) { /* тело — по таблице проверок спеки §3.2 */ }
```

Сообщения закреплены дословно, тесты на них опираются:
- `'Pielet: openSubmenu(x, y, handoff) requires handoff to be undefined or an object'`
- `'Pielet: openSubmenu(x, y, handoff) requires handoff.held to be a boolean'`
- `'Pielet: openSubmenu(x, y, handoff) requires handoff.button to be null or one of left, middle, right, back, forward'`

2. `open(x, y)` становится однострочным телом `this.#openMenu(x, y, null)`, а тело нынешнего `open` переезжает в `#openMenu(x, y, buttonOverride)` без иных правок. Проверку координат и `normalizeConfig` оставить в `#openMenu` — она нужна обеим точкам входа.
3. В `#openMenu` перед созданием `InteractionController`: `const button = buttonOverride ?? config.button;` — именно `??`, чтобы `null` от `buttonOfHandoff` («любая кнопка» из handoff) не подменялся на `config.button`; перекрытие задаётся отдельным аргументом. `button` уходит в `InteractionController` и в новое поле `#runtimeButton`, которое ставится рядом с `this.#runtime = …`.
4. `openSubmenu(x, y, handoff)` — `this.#openMenu(x, y, buttonOfHandoff(handoff))`.
5. JSDoc обоих публичных методов: у `openSubmenu` — полный контракт со ссылкой на `SubmenuTarget` и `SubmenuHandoff`; у `open` — что это показ без перекрытия.

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `cd Pielet && npx vitest run tests/integration/Pielet.test.js`

Expected: PASS, включая существующий кейс `Pielet.openSubmenu открывает меню в точке`.

- [ ] **Step 6: Коммит**

```bash
cd Pielet && git add src/types.js src/pielet.js tests/integration/Pielet.test.js
git commit -m "Accept the submenu handoff contract in openSubmenu"
```

---

### Task 3: `Pielet` — сквозной приём в браузере

**Files:**
- Modify: `Pielet/e2e/pielet.e2e.spec.js`
- Test: `Pielet/e2e/pielet.e2e.spec.js`

**Interfaces:**
- Consumes: `Pielet#openSubmenu(x, y, handoff)` из задачи 2.
- Produces: ничего; тестовая привязка `window.__menu` из `demo/main.js` уже есть.

- [ ] **Step 1: Написать тест**

Тест открывает демо-меню в hold-режиме по контракту с чужой кнопкой и проверяет, что отпускание чужой кнопки не закрывает, а переданной — закрывает. Демо-меню открывается кнопкой `left` (`demo/main.js` задаёт `button` из конфига), поэтому передаётся `right`. Точка берётся из существующего хелпера `openMenu(page, x, y)` предварительно закрыв меню через `window.__menu.close()`.

```js
test('openSubmenu hands the ring over to the tracked button for this show only', async ({ page }) => {
  await openMenu(page, 400, 400);
  await page.evaluate(() => window.__menu.close());
  await page.waitForSelector('.pielet', { state: 'detached' });

  await page.evaluate(() => {
    window.__menu.openSubmenu(400, 400, { button: 'right', held: true });
  });
  await page.waitForSelector('.pielet', { state: 'attached' });
  expect(await page.evaluate(() => window.__menu.config.button)).toBe('left');

  await page.mouse.up({ button: 'left' });
  await expect(page.locator('.pielet')).toHaveCount(1);

  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.pielet')).toHaveCount(0);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd Pielet && npx playwright test -g "hands the ring over"`

Expected: FAIL — до задачи 2 третий аргумент игнорируется, и первое отпускание закрывает кольцо. Если тест проходит на шаге 2 — значит он ничего не проверяет, и это тоже повод остановиться.

- [ ] **Step 3: Довести тест до прохождения**

Ничего в коде: тест обязан пройти на реализации из задачи 2. Если падает — правь задачу 2, а не тест.

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `cd Pielet && npx playwright test -g "hands the ring over"`

Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
cd Pielet && git add e2e/pielet.e2e.spec.js
git commit -m "Cover the handoff contract on the ring in a real browser"
```

---

### Task 4: `Pielet` — передача `handoff` родителем

**Files:**
- Modify: `Pielet/src/interaction/InteractionController.js` (добавить `#buttonHeld` и геттер), `Pielet/src/pielet.js:299-317` (`#showSubmenu`)
- Test: `Pielet/tests/unit/interaction/InteractionController.test.js`, `Pielet/tests/integration/Pielet.test.js`

**Interfaces:**
- Consumes: `InteractionController#buttonHeld` (новый геттер), `Pielet#runtimeButton` из задачи 2.
- Produces: `InteractionController#get buttonHeld(): boolean` — зажата ли отслеживаемая кнопка прямо сейчас.

- [ ] **Step 1: Написать падающие тесты**

В `tests/unit/interaction/InteractionController.test.js`:

```js
describe('InteractionController — buttonHeld', () => {
  function makeTracked(mode) {
    const controller = new InteractionController({
      interactionMode: mode,
      button: 'left',
      geometry: makeGeometry(),
      ...CENTER,
      onHover: vi.fn(), onClose: vi.fn(), onSelect: vi.fn()
    });
    controller.attach();
    return controller;
  }

  it('hold: зажата с момента показа', () => {
    expect(makeTracked('hold').buttonHeld).toBe(true);
  });

  it('click: не зажата с момента показа', () => {
    expect(makeTracked('click').buttonHeld).toBe(false);
  });

  it('следует за event.buttons при движении', () => {
    const controller = makeTracked('click');
    fire(window, 'pointermove', { ...pointAt(0.3), buttons: 1 });
    expect(controller.buttonHeld).toBe(true);
    fire(window, 'pointermove', { ...pointAt(0.3), buttons: 0 });
    expect(controller.buttonHeld).toBe(false);
  });

  it('гаснет на разборе отпускания отслеживаемой кнопки', () => {
    const controller = makeTracked('click');
    fire(window, 'pointermove', { ...pointAt(0.3), buttons: 1 });
    fire(window, 'pointerup', { ...pointAt(0.3), button: 0 });
    expect(controller.buttonHeld).toBe(false);
  });

  it('чужое отпускание не гасит', () => {
    const controller = makeTracked('click');
    fire(window, 'pointermove', { ...pointAt(0.3), buttons: 1 });
    fire(window, 'pointerup', { ...pointAt(0.3), button: 2 });
    expect(controller.buttonHeld).toBe(true);
  });
});
```

В `tests/integration/Pielet.test.js`, рядом с существующим `describe('Pielet — submenu (isSubMenu)')`:

```js
it('hold: чужому меню передаётся живой жест', () => {
  const received = [];
  const foreign = { openSubmenu: (x, y, handoff) => received.push({ x, y, handoff }) };
  menu = new Pielet({
    interactionMode: 'hold',
    button: 'left',
    items: [{ typeContent: 'text', content: 'More', isSubMenu: true, menu: foreign }]
  });
  menu.open(300, 300);
  window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 301, clientY: 380 }));
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 301, clientY: 380 }));
  window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 301, clientY: 380 }));
  expect(received).toHaveLength(1);
  expect(received[0].handoff).toEqual({ button: 'left', held: false });
});

it('click: открытие по клику передаёт held: false', () => {
  const received = [];
  const foreign = { openSubmenu: (x, y, handoff) => received.push(handoff) };
  menu = new Pielet({
    interactionMode: 'click',
    button: 'left',
    items: [{ typeContent: 'text', content: 'More', isSubMenu: true, menu: foreign }]
  });
  menu.open(300, 300);
  window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 0, clientX: 301, clientY: 380 }));
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 301, clientY: 380 }));
  expect(received).toEqual([{ button: 'left', held: false }]);
});

it('кнопка перекрытого показа передаётся дальше', () => {
  // Меню, открытое как чужое сабменю, передаёт дальше ту кнопку, которой его открыли,
  // а не ту, что стоит в его собственном config.
  const inner = [];
  const foreign = { openSubmenu: (x, y, handoff) => inner.push(handoff) };
  menu = new Pielet({
    interactionMode: 'hold',
    button: 'left',
    items: [{ typeContent: 'text', content: 'More', isSubMenu: true, menu: foreign }]
  });
  menu.openSubmenu(300, 300, { button: 'right', held: true });
  window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 2, clientX: 301, clientY: 380 }));
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 2, clientX: 301, clientY: 380 }));
  window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 2, clientX: 301, clientY: 380 }));
  expect(inner).toEqual([{ button: 'right', held: false }]);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd Pielet && npx vitest run tests/unit/interaction/InteractionController.test.js tests/integration/Pielet.test.js`

Expected: FAIL — геттера `buttonHeld` нет, а `#showSubmenu` зовёт чужое меню двумя аргументами.

- [ ] **Step 3: Наблюдаемое состояние в контроллере**

В `src/interaction/InteractionController.js`:

1. Поле `#buttonHeld`, начальное значение `interactionMode === INTERACTION_MODES.HOLD`, с JSDoc: в hold-режиме это посылка режима, в click-режиме — что видно из последнего события.
2. Геттер без поля, только чтение:
```js
/** @returns {boolean} */
get buttonHeld() { return this.#buttonHeld; }
```
3. В `#onMove` — сразу после вычисления `held`: `this.#buttonHeld = held;`. Переменная `held` считается до проверок режима, поэтому присваивание стоит сразу за ней.
4. В `#onUp` — сразу после проверки кнопки и до любых разборов: `this.#buttonHeld = false;`. Раньше нельзя: из `onSelect` синхронно вызывается `#showSubmenu`, и он обязан увидеть уже сброшенное значение.

- [ ] **Step 4: Передача в `#showSubmenu`**

В `src/pielet.js`, `#showSubmenu`:

1. Перед `this.#close(true)` собрать `handoff` — `#close` обнуляет `#runtime`, а читать состояние после него нечем:
```js
const runtime = this.#runtime;
const handoff = {
    button: this.#runtimeButton,
    held: runtime !== null && runtime.interaction.buttonHeld
};
```
2. Вызову чужого меню передать третий аргумент: `open.call(menu, point.x, point.y, handoff);`. Откат на `open(x, y)` получает те же три аргумента — метод, написанный до контракта, третий проигнорирует; это и оставляет его рабочим.
3. JSDoc метода: где берётся `held`, почему сборка идёт до закрытия, и что откат на `open` тоже получает три аргумента.

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `cd Pielet && npx vitest run`

Expected: PASS целиком, включая существующий кейс `hold: opening a submenu closes the parent ring first`.

- [ ] **Step 6: Коммит**

```bash
cd Pielet && git add src/pielet.js src/interaction/InteractionController.js tests/unit/interaction/InteractionController.test.js tests/integration/Pielet.test.js
git commit -m "Hand the live gesture to a submenu target"
```

---

### Task 5: `Pielet` — приёмник-контракт в демо

**Files:**
- Modify: `Pielet/demo/main.js` (рядом с существующими `basic` / `pastel` вложенными меню, `demo/main.js:67-68, 101`)
- Test: `Pielet/e2e/pielet.e2e.spec.js`

**Interfaces:**
- Consumes: контракт из задач 2 и 4.
- Produces: в демо — объект с одним `openSubmenu(x, y, handoff)`, показывающий переданный жест в подписи пункта.

- [ ] **Step 1: Написать тест**

В `e2e/pielet.e2e.spec.js` — кейс, который в hold-режиме открывает демо-меню, ждёт показа `.pielet`, наводит указатель на центр сектора пункта-приёмника, ждёт `submenuDelay` и проверяет, что `window.__foreign.handoff` заполнен. Точка наведения — середина радиуса кольца под углом `mid` первого сектора: её считает `evaluate` по DOM-геометрии, в файле уже есть обращения к `.pielet__item` через `boundingBox`.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd Pielet && npx playwright test -g "<имя теста>"`

Expected: FAIL — пункта-приёмника на кольце нет, `window.__foreign` не определён.

- [ ] **Step 3: Добавить приёмник в `demo/main.js`**

Приёмник — обычный объект с одним методом `openSubmenu(x, y, handoff)`, который записывает последний переданный жест в `window.__foreign` и выводит его подписью на своём месте. Он же показывает, что контракт не привязан к паре этих проектов: ребёнком может быть что угодно с одним таким методом. В `demo/main.js` он добавляется четвёртым пунктом кольца рядом с существующими `basic` / `pastel`.

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `cd Pielet && npx playwright test`

Expected: PASS целиком.

- [ ] **Step 5: Коммит**

```bash
cd Pielet && git add demo/main.js e2e/pielet.e2e.spec.js
git commit -m "Show a contract receiver in the demo"
```

---

### Task 6: `Pielet` — типы и документация

**Files:**
- Modify: `Pielet/src/types.js:77-91` (`SubmenuTarget`), `Pielet/README.md`, `Pielet/docs/api.md`, `Pielet/docs/changelog.md`
- Verify: `dist/*.d.ts` пересобираются `npm run build` и содержат `SubmenuHandoff`

**Interfaces:**
- Consumes: форма из задач 2 и 4; `@typedef SubmenuHandoff` уже объявлен в `src/types.js` задачей 2.
- Produces: переписанный `@typedef SubmenuTarget`.

- [ ] **Step 1: Обновить `SubmenuTarget` в `src/types.js`**

1. `SubmenuTarget.openSubmenu` — сигнатура `(x: number, y: number, handoff?: SubmenuHandoff) => void`, с описанием порядка (после закрытия кольца) и оговоркой, что у ребёнка может быть своя кнопка.
2. `SubmenuTarget.open` — `(x: number, y: number) => void`, с явной пометкой, что это запасной путь для кода, написанного до контракта.
3. `PieletItem.menu` — в описании сказать, что `isSubMenu: true` передаёт живой жест и потому подходит для `MyContext` так же, как для экземпляра `Pielet`.

- [ ] **Step 2: Проверить сборку `.d.ts`**

Run: `cd Pielet && npm run build`

Expected: ноль ошибок `tsc`; в `dist/*.d.ts` присутствуют `SubmenuHandoff` и новая сигнатура `openSubmenu`. Коммитить `dist/` — только если он и сейчас под git: проверь `git status` перед `git add`, и если `dist` в `.gitignore` — не добавляй его.

- [ ] **Step 3: Обновить `docs/api.md`**

Раздел «Сабменю»: форма `SubmenuHandoff`, таблица приёма (что делает `held: true` с именем, с `null`, и что `held: false` игнорируется), право ребёнка на кнопку, отличную от `config.button`, и оговорка о программном показе hold-меню без зажатой кнопки. Раздел «Ошибки»: три новых сообщения `Pielet:` из задачи 2.

- [ ] **Step 4: Обновить `README.md` и `docs/changelog.md`**

README: таблица публичного API — строка `menu.openSubmenu(x, y, handoff?)` вместо нынешнего описания полного алиаса; раздел про сабменю — что кольцо передаёт живой жест. Changelog: запись о новом третьем аргументе и о режиме «любая кнопка» у ребёнка.

- [ ] **Step 5: Коммит**

```bash
cd Pielet && git add src/types.js README.md docs/api.md docs/changelog.md
git commit -m "Document the submenu handoff contract"
```

---

### Task 7: `MyContext` — вооружение на названную кнопку и режим «любая кнопка»

**Files:**
- Modify: `MyContext/src/MyContext.js:207-230` (`pressButtonOf`), `:750` (поле `#armedPress`), `:1412-1426` (`#onGlobalPointerRelease`), `:1912-1926` (`#armExternalPress`)
- Test: `MyContext/tests/e2e/armedOpen.spec.js`

**Interfaces:**
- Consumes: ничего; правка самодостаточна и чинит поведение, существующее и без контракта.
- Produces: приватный `#armExternalPress(button: number | null): void`, где `button: null` — «любая кнопка». Поле `#armedPress` получает `button: number | null`. Задача 8 зовёт `#armExternalPress` с кодом из `handoff`.

- [ ] **Step 1: Написать падающий тест**

В `tests/e2e/armedOpen.spec.js` добавить в `describe('openAsSubmenu')`:

```js
test('"any": отпускание любой кнопки закрывает показанное', async ({ page }) => {
  // Регрессия: #armExternalPress выходил раньше на pressAndHold: 'any', потому что
  // pressButtonOf отдаёт для него null так же, как для 'none'. Меню открывалось и
  // не закрывалось ничем — комментарий утверждал, что сюда не доходят.
  await makeMenu(page, { pressAndHold: 'any', attach: false });
  await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
  await page.mouse.down({ button: 'right' });
  await openAsSubmenu(page, PRESS_POINT);
  expect((await readMenu(page)).openCount, 'меню показано').toBe(1);

  await page.mouse.up({ button: 'right' });
  expect((await readMenu(page)).openCount, 'отпускание закрыло меню').toBe(0);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd MyContext && npx playwright test --project=chromium tests/e2e/armedOpen.spec.js -g "any"`

Expected: FAIL — `openCount` остаётся `1`.

- [ ] **Step 3: Реализовать**

1. Таблица кодов вместо `switch`. Рядом с `PRIMARY_MOUSE_BUTTON` и соседями:

```js
/**
 * Имя кнопки контракта → числовой код `PointerEvent.button`.
 * @type {Readonly<Record<'left' | 'middle' | 'right' | 'back' | 'forward', number>>}
 */
const HOLD_BUTTON_CODES = Object.freeze({
  left: PRIMARY_MOUSE_BUTTON,
  middle: MIDDLE_MOUSE_BUTTON,
  right: RIGHT_MOUSE_BUTTON,
  back: 3,
  forward: 4,
});
```

2. Обратный проход по той же таблице — единственный источник имени, обратная таблица
   заводилась бы отдельно и разошлась бы с этой:

```js
/**
 * @param {number | null} code числовой код `PointerEvent.button` либо `null`.
 * @returns {'left' | 'middle' | 'right' | 'back' | 'forward' | null} имя кнопки,
 *   либо `null`, если кнопка не названа или код неизвестен.
 */
function buttonNameOf(code) { /* перебор Object.entries(HOLD_BUTTON_CODES) */ }
```

3. `pressButtonOf` переписать через `HOLD_BUTTON_CODES`: `const code = HOLD_BUTTON_CODES[mode]; return code === undefined ? null : code;` — с сохранением нынешнего JSDoc и смысла `null` («кнопку не называет»). Переименование не требуется: имя честное, а при `'any'` по-прежнему `null`.
4. `#armExternalPress(button)`: принимает аргумент, `#armedPress = { button, pointerId: EXTERNAL_POINTER_ID }`, поднимает `#bindHoldHandlers()`. Прежний ранний выход по `button === null` **убрать**: теперь `null` — законное значение со смыслом «любая кнопка».
5. Вызов из `open()` на строке 1837 передаёт `pressButtonOf(this.#options.pressAndHold)`.
6. `#onGlobalPointerRelease`: сверка кнопки становится `if (press.button !== null && press.button !== event.button) return;`.
7. JSDoc `#armExternalPress` переписать: аргумент вместо вывода из опции, `null` — «любая кнопка», и почему вооружение снаружи не сверяет указатель.

**Produces:** `#armExternalPress(button: number | null): void`, где `button: null` — «любая кнопка»; поле `#armedPress` получает `button: number | null`; модульные `HOLD_BUTTON_CODES` и `buttonNameOf(code: number | null)`. Задачи 8 и 9 используют `buttonNameOf`.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd MyContext && npx playwright test --project=chromium tests/e2e/armedOpen.spec.js`

Expected: PASS, включая существующий кейс `без удержания отклоняется`.

- [ ] **Step 5: Коммит**

```bash
cd MyContext && git add src/MyContext.js tests/e2e/armedOpen.spec.js
git commit -m "fix: вооружение удержания при pressAndHold: 'any'"
```

---

### Task 8: `MyContext` — приём контракта в `openSubmenu`

**Files:**
- Modify: `MyContext/src/MyContext.js` — модульный хелпер рядом с `readHandoff`-местом, `:2131-2134` (`openAsSubmenu`), новый публичный `openSubmenu`
- Test: `MyContext/tests/e2e/armedOpen.spec.js`, `MyContext/tests/e2e/contracts.spec.js`

**Interfaces:**
- Consumes: `#armExternalPress(button: number | null)`, `HOLD_BUTTON_CODES` и `buttonNameOf(code: number | null)` из задачи 7.
- Produces: `MyContext#openSubmenu(x: number, y: number, handoff?: SubmenuHandoff): void` — публичный API контракта.

- [ ] **Step 1: Написать падающие тесты**

В `tests/e2e/armedOpen.spec.js` расширить пробу: добавить в `__armed` метод

```js
/**
 * @param {{ x: number, y: number }} point
 * @param {{ button: string | null, held: boolean } | undefined} handoff
 */
openSubmenu(point, handoff) {
  if (menu === null) {
    throw new Error('меню не создано');
  }
  menu.openSubmenu(point.x, point.y, /** @type {never} */ (handoff));
},
```

и хелпер `openSubmenu(page, point, handoff)` рядом с существующим. Затем `describe('openSubmenu')`:

```js
test('held: true вооружает на переданную кнопку, а не на пресет', async ({ page }) => {
  // Пресет называет left, а пришла передача с right: жест обязан принадлежать
  // правой кнопке, иначе отпускание, которым меню открыли, его бы не закрыло.
  await makeMenu(page, { pressAndHold: 'left', attach: false });
  await page.mouse.move(PRESS_POINT.x, PRESS_POINT.y);
  await page.mouse.down({ button: 'right' });
  await openSubmenu(page, PRESS_POINT, { button: 'right', held: true });
  expect((await readMenu(page)).openCount).toBe(1);

  await page.mouse.up({ button: 'left' });
  expect((await readMenu(page)).openCount, 'чужое отпускание не закрыло').toBe(1);

  await page.mouse.up({ button: 'right' });
  const after = await readMenu(page);
  expect(after.openCount, 'переданное отпускание закрыло').toBe(0);
  expect(after.errors).toEqual([]);
});

test('held: true с button: null — вооружает на любую кнопку', async ({ page }) => {
  await makeMenu(page, { pressAndHold: 'left', attach: false });
  await page.mouse.down({ button: 'right' });
  await openSubmenu(page, PRESS_POINT, { button: null, held: true });
  await page.mouse.up({ button: 'right' });
  expect((await readMenu(page)).openCount, 'любая кнопка закрыла').toBe(0);
});

test('кнопка контракта не обязана быть в лексиконе пресета', async ({ page }) => {
  // Пресет называет только left/right/middle, а контракт допускает ещё back/forward.
  await makeMenu(page, { pressAndHold: 'left', attach: false });
  await page.mouse.down({ button: 'back' });
  await openSubmenu(page, PRESS_POINT, { button: 'back', held: true });
  await page.mouse.up({ button: 'back' });
  expect((await readMenu(page)).openCount).toBe(0);
});

test('без handoff — показ без жеста', async ({ page }) => {
  await makeMenu(page, { pressAndHold: 'left', attach: false });
  await openSubmenu(page, PRESS_POINT, undefined);
  expect((await readMenu(page)).openCount).toBe(1);
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  expect((await readMenu(page)).openCount, 'жеста нет — отпускание ничего не делает').toBe(1);
});

test('показ без жеста всё равно поднимает правила закрытия', async ({ page }) => {
  await makeMenu(page, { pressAndHold: 'left', attach: false });
  await openSubmenu(page, PRESS_POINT, { button: 'left', held: false });
  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height + 1 });
  await page.waitForFunction(() => {
    return document.querySelectorAll('.vc-menu:popover-open').length === 0;
  });
});

test('без удержания отклоняется', async ({ page }) => {
  await makeMenu(page, { pressAndHold: 'none', attach: false });
  const outcome = await page.evaluate(() => {
    try {
      /** @type {any} */ (globalThis).__armed.openSubmenu(
        { x: 260, y: 120 },
        { button: 'left', held: true },
      );
      return { threw: false, message: '' };
    } catch (error) {
      return { threw: true, message: error instanceof Error ? error.message : String(error) };
    }
  });
  expect(outcome.threw).toBe(true);
  expect(outcome.message).toContain('pressAndHold');
});

test('форма handoff проверяется', async ({ page }) => {
  await makeMenu(page, { pressAndHold: 'left', attach: false });
  const bad = await page.evaluate(() => {
    const scope = /** @type {{ __armed: ArmedProbe }} */ (/** @type {unknown} */ (globalThis));
    /** @returns {string} */
    function message(fn) {
      try {
        fn();
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
    return [
      message(() => scope.__armed.openSubmenu({ x: 1, y: 1 }, null)),
      message(() => scope.__armed.openSubmenu({ x: 1, y: 1 }, { button: 'left' })),
      message(() => scope.__armed.openSubmenu({ x: 1, y: 1 }, { button: 'left', held: 'yes' })),
      message(() => scope.__armed.openSubmenu({ x: 1, y: 1 }, { button: 'extra', held: true })),
    ];
  });
  expect(bad[0], 'null — не объект').toContain('handoff');
  expect(bad[1], 'нет held').toContain('held');
  expect(bad[2], 'held не логическое').toContain('held');
  expect(bad[3], 'неизвестная кнопка').toContain('button');
});

test('destroyOnClose: разбор отпускания стирает карту действий', async ({ page }) => {
  // Из Review Focus: по новому пути разбор ведёт себя как у destroyOnClose вообще —
  // действие получает уже разобранный экземпляр, и звать его нельзя.
  await makeMenu(page, { pressAndHold: 'left', attach: false, destroyOnClose: true });
  await page.mouse.down({ button: 'left' });
  await openSubmenu(page, PRESS_POINT, { button: 'left', held: true });
  const target = await centerOfItem(page, 'Первый');
  await page.mouse.move(target.x, target.y);
  await page.mouse.up({ button: 'left' });
  const after = await readMenu(page);
  expect(after.calls, 'действие исполнилось до разбора').toEqual(['Первый']);
  expect(after.openCount).toBe(0);
});
```

`makeMenu` в этом файле принимает `{ pressAndHold, attach }` — расширь `ArmedInput` полем `destroyOnClose` и передавай его в конструктор, иначе последний тест проверит не то.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd MyContext && npx playwright test --project=chromium tests/e2e/armedOpen.spec.js`

Expected: FAIL — `openSubmenu` не существует.

- [ ] **Step 3: Реализовать разбор `handoff`**

Модульный хелпер в `src/MyContext.js`, рядом с `pressButtonOf`:

```js
/**
 * @param {unknown} handoff третий аргумент показа как сабменю.
 * @param {string} source имя вызывающего для сообщения об ошибке.
 * @returns {{ armed: boolean, button: number | null }}
 * @throws {TypeError}
 */
function readHandoff(handoff, source) { /* тело — по таблице проверок спеки §3.2 */ }
```

Сообщения закреплены дословно; `source` подставляется в начало каждого:

- `` `${source}: handoff должен быть объектом` ``
- `` `${source}: handoff.held должен быть истиной или ложью` ``
- `` `${source}: handoff.button — неизвестная кнопка «${String(handoff.button)}»` ``

Не-объектом считается всё, что не проходит `isRecord`; `undefined` — законное «не задан».

- [ ] **Step 4: Реализовать `openSubmenu`**

```js
openSubmenu(x, y, handoff) {
  this.#assertAlive();
  const gesture = readHandoff(handoff, 'openSubmenu(x, y, handoff)');
  if (gesture.armed && this.#options.pressAndHold === 'none') {
    throw new TypeError(
      'openSubmenu(x, y, handoff): продолжить жест нечем — options.pressAndHold называет \'none\', а удержания нет',
    );
  }
  if (gesture.armed) {
    this.#armExternalPress(gesture.button);
  }
  this.open({ x, y }, { dismissible: true });
}
```

Вооружение ставится **до** `open()`, а не после: жест обязан начаться не позже показа, иначе отпускание, пришедшее в том же такте, останется неразобранным. `armed` в `open()` не передаётся намеренно — `open()` вооружает на кнопку своего пресета, а перекрытие здесь задаёт `#armExternalPress`; передача `armed` сломала бы проверку `'none'` своим сообщением.

- [ ] **Step 5: Переписать `openAsSubmenu` через контракт**

```js
openAsSubmenu(x, y) {
  this.#assertAlive();
  this.openSubmenu(x, y, {
    button: buttonNameOf(pressButtonOf(this.#options.pressAndHold)),
    held: true,
  });
}
```

Отдельной функции «имя из пресета» не заводим: `pressButtonOf` даёт код, `buttonNameOf` даёт имя, а при `'any'` код равен `null` и имя тоже `null` — то есть кнопка не названа, и это ровно то значение, которое контракт называет «любая». Проверка `'none'` в `openSubmenu` срабатывает раньше, чем `null` становится значимым, так что поведение `openAsSubmenu` на меню без удержания — прежнее отклонение.

- [ ] **Step 6: Обновить существующий тест отклонения**

В существующем кейсе `без удержания отклоняется` (`armedOpen.spec.js`) `expect(outcome.message).toContain('armed')` заменить на `toContain('pressAndHold')`: сообщение теперь называет опцию, которая негодна, а не опцию, которой пользуется метод.

- [ ] **Step 7: Убедиться, что тесты проходят**

Run: `cd MyContext && npx playwright test --project=chromium tests/e2e/armedOpen.spec.js tests/e2e/contracts.spec.js`

Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
cd MyContext && git add src/MyContext.js tests/e2e/armedOpen.spec.js
git commit -m "feat: openSubmenu(x, y, handoff) принимает живой жест"
```

---

### Task 9: `MyContext` — `handoffAction` получает описание жеста

**Files:**
- Modify: `MyContext/src/MyContext.js:2390-2404` (`#showWhatItemLeadsTo`), `:2444-2462` (`#handOverTo`), JSDoc типа `MenuItem` (`handoffAction`)
- Modify: `MyContext/tests/e2e/handoff.spec.js`
- Modify: `MyContext/Demo/scenarios.js` (сценарий `handoff`), `MyContext/Demo/demo.js`

**Interfaces:**
- Consumes: `HOLD_BUTTON_CODES` и `buttonNameOf(code: number | null)` из задачи 7, `#armedPress` с `button: number | null`.
- Produces: `MyContextItem.handoffAction: (event: Event, handoff: SubmenuHandoff) => void`, где `SubmenuHandoff` — `@typedef` в `src/MyContext.js`: `{ button: 'left' | 'middle' | 'right' | 'back' | 'forward' | null; held: boolean }`. Имя кнопки в unions пишется прямо в typedef, отдельного типа для него не заводим — в `MyContext` своего `MouseButtonName` нет, а второй typedef ради одной строки разошёлся бы с таблицей `HOLD_BUTTON_CODES`.

- [ ] **Step 1: Написать падающие тесты**

В `tests/e2e/handoff.spec.js` проба уже пишет `handoffs.push({ how, point, button, menuOpen })`. Дополнить её полем `handoff`:

1. В хелпере `handoff(...)` добавить `handoff: { button: handoffButtonName, held: handoffHeld }`, где оба значения вычисляются в момент вызова.
2. `item(label, givesAway)` уже строит `handoffAction` одним аргументом; заменить на
   `built.handoffAction = (event, handoff) => handoffOf('hover', event, handoff);`
   с `handoffOf` — обёрткой, которая пишет и старое, и новое.
3. Добавить `describe` с кейсами:

```js
test('в hold-режиме получает живой жест', async ({ page }) => {
  // Меню вооружено нажатием по своему якорю, и в момент отдачи жест жив: без этого
  // ребёнок не знал бы, чьё отпускание его закроет.
  // ... подготовка меню с pressAndHold: 'left' и привязкой, открытие нажатием,
  // наведение на «Отдать», ожидание handoffs.length === 1 ...
  expect(handoffs[0].handoff).toEqual({ button: 'left', held: true });
});

test('вне удержания получает held: false', async ({ page }) => {
  // ... та же подготовка без pressAndHold, показ по клику, наведение на «Отдать» ...
  expect(handoffs[0].handoff).toEqual({ button: null, held: false });
});

test('активация с клавиатуры даёт held: false и button: null', async ({ page }) => {
  // У keydown нет ни кнопки, ни координат, и выдумывать их нечем: оба поля null/плохо.
  // ... фокус на меню, стрелка до «Отдать», Enter ...
  expect(handoffs[0].handoff).toEqual({ button: null, held: false });
});
```

Точный способ наведения и ожидания — скопируй из уже существующих кейсов этого файла, они там отлажены.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd MyContext && npx playwright test --project=chromium tests/e2e/handoff.spec.js`

Expected: FAIL — второй аргумент не приходит, `handoff` в снимке `undefined`.

- [ ] **Step 3: Реализовать передачу**

1. `#handoffFor` — приватный метод на классе, с `buttonNameOf` из задачи 7 (отдельной
   функции «имя из события» не заводим — код достаётся на месте):
```js
/**
 * @param {Event} event событие активации.
 * @returns {SubmenuHandoff} описание жеста на момент передачи.
 */
#handoffFor(event) {
  const press = this.#armedPress;
  if (press !== null) {
    return { button: buttonNameOf(press.button), held: true };
  }
  const code = 'button' in event && typeof event.button === 'number' ? event.button : null;
  return { button: buttonNameOf(code), held: false };
}
```
   `held: false` рядом с кодом события — то самое, что нужно для отладки, и это ровно те данные, которые и так есть под рукой.
2. `#handOverTo` собирает один раз и передаёт вторым аргументом:
```js
const gesture = this.#handoffFor(event);
try {
  handoff(event, gesture);
} finally { /* существующий порядок закрытия не трогать */ }
```
3. `@typedef SubmenuHandoff` в `src/MyContext.js` — та же форма, что в `Pielet/src/types.js`: `held` решает, есть ли жест; `button` сужает, чьё отпускание его закончит, `null` — «любая кнопка»; при `held: false` поле справочное.
4. JSDoc `#handOverTo`: откуда берётся описание, почему оно одно на все пути активации, и почему координаты по-прежнему достаёт автор из события.
5. JSDoc `MenuItem.handoffAction` в типах: сигнатура с двумя аргументами, второй — описание жеста; старое действие с одним аргументом продолжает работать.

- [ ] **Step 4: Обновить демо**

В `Demo/scenarios.js`, сценарий `handoff`: `handoffAction` получает второй аргумент и передаёт его в лог вместе с координатами; в `hint` добавить одну фразу про то, что описание жеста приходит вторым аргументом. В `Demo/demo.js` правок не требуется — сценарий уже создаётся общим кодом.

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `cd MyContext && npx playwright test --project=chromium tests/e2e/handoff.spec.js tests/e2e/demo.spec.js`

Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
cd MyContext && git add src/MyContext.js tests/e2e/handoff.spec.js Demo/scenarios.js
git commit -m "feat: handoffAction получает описание жеста вторым аргументом"
```

---

### Task 10: `MyContext` — документация

**Files:**
- Modify: `MyContext/README.md` — раздел «Отдача управления: `handoffAction»» (~348), «`openAsSubmenu(x, y)`» (~812), «Пункты и подменю» (~278), таблица полей пункта (~292)
- Modify: `MyContext/docs/changelog.md`, если такой файл есть; иначе — запись в начало README

**Interfaces:**
- Consumes: всё, что сделано в задачах 7–9.
- Produces: ничего исполняемого.

- [ ] **Step 1: Исправить нерабочий пример**

README:819-841 обещает, что в `PieletItem.menu` кладётся **сам экземпляр** `MyContext` и это работает. Сегодня это неверно: `Pielet` искал `openSubmenu`, а метод назывался `openAsSubmenu`. Привести пример к рабочему виду и убрать оговорку про `openAsSubmenu` как единственный путь.

- [ ] **Step 2: Описать `openSubmenu(x, y, handoff)`**

Новый раздел рядом с `openAsSubmenu`, по его образцу: форма третьего аргумента, таблица приёма, правило отказа при `pressAndHold: 'none'` с его смыслом, что `interactionMode`/`pressAndHold` не переключаются, и оговорка про призрак уходящего меню в Top Layer (`styles/mycontext.css:420`, `pointer-events: none`).

- [ ] **Step 3: Описать второй аргумент `handoffAction`**

В разделе «Отдача управления» добавить абзац про `handoff` и код с полным примером: `handoffAction: (event, handoff) => radial.openSubmenu(event.clientX, event.clientY, handoff)`. Отдельно — что с клавиатуры координат нет, и потому открыть по контракту можно только мышью.

- [ ] **Step 4: Обновить таблицу полей пункта**

Строку `handoffAction` привести к сигнатуре с двумя аргументами. Внешний вид не описан заново: он уже совпадает с владельцем подменю, и это сказано в разделе про владельцев.

- [ ] **Step 5: Сказать, кто закрывает переданное сабменю**

В разделе про `openSubmenu` — что закрывает показанное по контракту меню: его собственный проект. `MyContext.closeAll()` не трогает `Pielet`, а `Pielet.closeAll()` — `MyContext`; у `Pielet` это уже описано, у `MyContext` дублируется. Общий реестр — не в объёме этой работы, и читатель не должен решить, что оба `closeAll()` накрывают оба пакета.

- [ ] **Step 6: Проверить ссылки и коммит**

Прогнать `grep` по README на `openAsSubmenu` и `handoffAction` — все упоминания должны быть согласованы с новым контрактом.

```bash
cd MyContext && git add README.md
git commit -m "docs: контракт openSubmenu и описание жеста в handoffAction"
```

---

### Task 11: сквозной сценарий между пакетами

**Files:**
- Modify: `MyContext/scripts/serve.js` — опциональная раздача соседнего репозитория
- Create: `MyContext/tests/e2e/crossPackage.spec.js`

**Interfaces:**
- Consumes: контракт целиком с обеих сторон.
- Produces: тест, который на машине с двумя репозиториями проверяет обе передачи настоящими пакетами, а в CI без соседа честно пропускается.

- [ ] **Step 1: Сделать раздачу соседа опциональной**

В `scripts/serve.js` рядом с `ROOT` добавить константу `SIBLING` — путь `resolve(ROOT, '..', 'Pielet')` — и в `resolveFilePath` после проверки попадания в `ROOT` добавить вторую ветку: путь, начинающийся с `/pielet/`, обрезает префикс и отдаёт файл из `SIBLING`, **только если** `SIBLING/src` существует. Без соседнего чекаута ветка молча не включается, и тест из шага 3 пропускается. JSDoc — почему это второй корень, а не зависимость.

- [ ] **Step 2: Написать падающий тест**

`tests/e2e/crossPackage.spec.js`. Перед `beforeEach` — проверка доступности соседа:

```js
const SIBLING_READY = existsSync(resolve(import.meta.dirname, '..', '..', '..', 'Pielet', 'src', 'index.js'));
test.skip(!SIBLING_READY, 'рядом нет чекаута Pielet — сквозной сценарий не собирается');
```

Дальше — страница, которая тянет оба пакета: `await import('/src/index.js')` и `await import('/pielet/src/index.js')`, плюс `<link>` на оба файла стилей. Проба в `globalThis` создаёт кольцо `Pielet` в `interactionMode: 'hold'`, `button: 'right'`, с пунктом `{ isSubMenu: true, menu: myContextInstance }`, и `MyContext` с `pressAndHold: 'right'` и пунктом, у которого `handoffAction: (event, handoff) => pielet.openSubmenu(event.clientX, event.clientY, handoff)`.

- [ ] **Step 3: Кейс «Pielet → MyContext»**

Нажать правую кнопку над блоком кольца, дождаться показа `.pielet`, навести на пункт-сабменю, дождаться `submenuDelay` по умолчанию, дождаться `.vc-menu`. Проверить: кольца `.pielet` на странице нет, меню MyContext показано. Потом отпустить правую кнопку над пунктом MyContext — действие исполнилось, меню закрылось.

- [ ] **Step 4: Кейс «MyContext → Pielet»**

Нажать правую кнопку над блоком MyContext, навести на отдающий пункт, дождаться передачи. Проверить: `.vc-menu` нет, `.pielet` есть. Отпустить правую кнопку над сектором — кольцо закрылось.

- [ ] **Step 5: Кейс двойной передачи (Review Focus, строка 5)**

Кольцо `Pielet` → `MyContext` → второе кольцо `Pielet`, где отдающий пункт MyContext зовёт то же кольцо обратно по контракту. Проверить, что на странице ровно один `.pielet` и одно `.vc-menu`, а жест дошёл до конца.

- [ ] **Step 6: Проверить оба направления и чекаут без соседа**

Run: `cd MyContext && npx playwright test --project=chromium tests/e2e/crossPackage.spec.js`

Expected: PASS на машине с обоими репозиториями. Затем `mv ../Pielet ../Pielet-off && npx playwright test --project=chromium tests/e2e/crossPackage.spec.js && mv ../Pielet-off ../Pielet` — Expected: тесты пропущены (`skipped`), а не упали.

- [ ] **Step 7: Коммит**

```bash
cd MyContext && git add scripts/serve.js tests/e2e/crossPackage.spec.js
git commit -m "test: сквозной сценарий удержания между пакетами"
```

---

## Порядок и точки сборки

| После задач | Что должно быть зелёным |
|---|---|
| 1, 2 | `cd Pielet && npx vitest run tests/unit/interaction tests/integration` |
| 3 | `cd Pielet && npx playwright test` |
| 4, 5 | `cd Pielet && npx vitest run && npx playwright test` |
| 6 | `cd Pielet && npm run build` |
| 7 | `cd MyContext && npx playwright test --project=chromium tests/e2e/armedOpen.spec.js` |
| 8 | `cd MyContext && npm run typecheck` |
| 9 | `cd MyContext && npm run typecheck` |
| 10 | `cd MyContext && npm run typecheck` |
| 11 | `cd MyContext && npx playwright test --project=chromium tests/e2e/crossPackage.spec.js` |

Каждую строку этой таблицы — прогонять только по явному согласию человека.