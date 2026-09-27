# MyContext Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Клиентская библиотека контекстных меню на чистом ES2026: неограниченная вложенность подменю, позиционирование с flip/clamp, hover intent, полная клавиатурная навигация с ARIA, нативный визуал через Top Layer.

**Architecture:** Один публичный класс `MyContext` поверх девяти внутренних модулей. Геометрия (`positioner.js`) и траектория курсора (`hoverIntent.js`) — чистые функции без DOM, поэтому тестируются без браузера. Каждый уровень меню — отдельный элемент `popover="manual"` в Top Layer, позиционируемый абсолютными координатами вьюпорта; подменю лежат в `<body>` соседями с пунктом-владельцем, а не его потомками, потому что `backdrop-filter` и анимация `scale` родителя создают containing block.

**Tech Stack:** Чистый ES2026 (ES-модули, приватные поля `#`), нативный Popover API и Top Layer, `DOMParser` для SVG, constructable-стили не используются — CSS поставляется отдельным файлом. Тесты: `@playwright/test` (проекты `unit`, `chromium`, `firefox`, `webkit`). Типы: JSDoc + `tsc --checkJs --noEmit`. Рантайм-зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-09-27-mycontext-design.md`

## Global Constraints

- Рантайм-зависимостей нет: в `package.json` отсутствует поле `dependencies` вообще. `devDependencies` ограничены инструментами тестирования и типизации: `@playwright/test`, `typescript`, `@types/node`. Последний нужен потому, что `scripts/serve.js` использует `node:http` и `node:fs`.
- Типовое окружение разделено на две программы, и это обязательно, а не деталь оформления. `tsconfig.json` покрывает `src/**` и `Demo/**` с `"types": []` — браузерный код не видит Node-глобалов и падает на `process`, `Buffer` и на Node-перегрузке `setTimeout`, возвращающей `NodeJS.Timeout`. `tsconfig.node.json` покрывает `scripts/**` и `tests/**` с `"types": ["node"]` и расширяет базовый. `npm run typecheck` запускает браузерную программу **первой** под `&&`, поэтому Node-глобал в `src/**` ломает проверку независимо от того, что node-программа подтвердила бы его при изолированном запуске. Никакой строки `/// <reference types="node" />` в `src/**` или `Demo/**` быть не должно.
- `tsconfig.json` использует `"target": "ESNext"`, `"lib": ["ESNext", "DOM", "DOM.Iterable"]` — не `ES2026`, потому что TypeScript может не знать эту строку в `lib`.
- `strict: true` и `checkJs: true` не ослабляются. Если проверка падает, добавляется явная JSDoc-аннотация, а не `any`.
- Всё, что попадает в `src/`, обязано иметь JSDoc-типы. Комментарии не пересказывают код.
- Имя продукта — MyContext. Слово `velvet` из исходного ТЗ не используется нигде.
- Публичные возвращаемые значения и параметры, представляющие структурированные данные, обязаны использовать именованный тип через `@typedef`, а не анонимный inline-объект. Это прямое правило проекта, и оно сильнее любых формулировок брифа. Имена типов из Interfaces-блока задачи обязательны: от них зависят последующие задачи.
- CSS-переменная `--vc-padding` (8px) обязана совпадать с константой `SAFETY_PADDING` (8). Совпадение фиксируется тестом в Task 5.
- Подменю — соседние элементы в `<body>`, а не потомки пункта. Перед каждым `showPopover()` элемент переносится в конец `<body>`.
- Отложенный `hidePopover()` отменяется при повторном открытии того же элемента.
- `prefers-reduced-motion: reduce` отменяет и CSS-переход, и JS-задержку закрытия.
- Правый клик вне дерева меню закрывает наше меню, но системное контекстное меню вне привязанного контейнера не подавляется.
- Коммит после каждой задачи, без `--amend`, без force-push.
- До Task 12 `index.html` содержит только заглушку демо из Task 1. Тесты e2e в Tasks 4–11 строят собственный DOM через `page.evaluate` и не зависят от демо-сценариев. Для страниц, которым нужен корректный базовый URL, порядок обязателен: сначала `page.goto('/')`, потом `page.setContent(...)` — иначе относительные ссылки не разрешатся.

## Review Focus

Пять классов ввода, которые спека подразумевает, но не описывает, и которые с наибойшей вероятностью сломают библиотеку. Тест на каждый из них добавлен в задачу, владеющую кодом.

1. **Пункт с `disabled: true` и непустым `submenu`.** Разумное ожидание: подменю не открывается ни мышью, ни `ArrowRight`, ни кликом, и пункт пропускается при навигации. → Task 10, `tests/e2e/lifecycle.spec.js`.
2. **Пункты без `id` и с повторяющимся `id`.** Разумное ожидание: `action` вызывается у того пункта, который его содержал. Внутренний ключ вычисляется как `${levelIndex}:${itemIndex}` и не зависит от пользовательского `id`; `id` копируется в `data-id` только для потребителей. → Task 6, `tests/e2e/renderer.spec.js` и Task 9, `tests/e2e/lifecycle.spec.js`.
3. **`action` бросает исключение.** Разумное ожидание: меню всё равно закрывается, исключение не проглатывается и всплывает до вызывающего кода. `close()` обязан выполняться в `finally`. → Task 9, `tests/e2e/lifecycle.spec.js`.
4. **Два экземпляра `MyContext` на одной странице.** Разумное ожидание: не мешают друг другу — id уникальны, `destroy()` одного не ломает другой, правый клик по меню одного не трогает меню другого. → Task 11, `tests/e2e/globals.spec.js`.
5. **Длинный лейбл.** Разумное ожидание: текст обрезается многоточием, ширина меню не растёт, колонки иконки и шеврона остаются на своих местах. → Task 6, `tests/e2e/renderer.spec.js`.

---

## Структура файлов

| Файл | Ответственность | Задача |
|---|---|---|
| `package.json` | Только devDeps и скрипты. Поля `dependencies` нет | 1 |
| `tsconfig.json` | `checkJs` для `src/`, `Demo/`, `scripts/` | 1 |
| `playwright.config.js` | Проекты `unit`, `chromium`, `firefox`, `webkit` + `webServer` | 1 |
| `scripts/serve.js` | Статический сервер на `node:http`, ноль зависимостей | 1 |
| `.gitignore` | `node_modules`, `test-results`, `playwright-report` | 1 |
| `index.html` | Демо-точка входа в корне (требование ТЗ) | 1, 12 |
| `Demo/demo.css`, `Demo/demo.js`, `Demo/scenarios.js` | Демо-страница и наборы меню | 1, 12 |
| `src/constants.js` | Числовые константы и дефолты опций | 2 |
| `src/positioner.js` | `calculateMenuPosition`, `calculateSubmenuPosition` | 2 |
| `src/hoverIntent.js` | Safe-triangle и таймеры | 3 |
| `src/icons.js` | `renderIcon`, `sanitizeSvg` | 4 |
| `src/theme.js` | `applyTheme`, `applyAnimationDuration` | 5 |
| `styles/mycontext.css` | Единственный источник правды по визуалу | 5 |
| `src/renderer.js` | `renderLevel`, `renderItem` | 6 |
| `src/layer.js` | Top Layer, замер вслепую, отложенный hide | 7 |
| `src/keyboard.js` | Роуминг-фокус и клавиши | 8 |
| `src/MyContext.js` | Оркестратор и валидация конфигурации | 9 |
| `src/index.js` | Публичная точка входа | 9 |
| `tests/unit/*.spec.js` | Чистые функции и валидация | 2, 3, 9 |
| `tests/e2e/*.spec.js` | Браузерные проверки | 1, 4–13 |
| `README.md` | Установка, API, пример | 13 |

---

### Task 1: Инфраструктура репозитория

**Files:**
- Create: `package.json`, `tsconfig.json`, `playwright.config.js`, `scripts/serve.js`, `.gitignore`, `index.html`, `Demo/demo.css`, `Demo/demo.js`
- Test: `tests/e2e/smoke.spec.js`

**Interfaces:**
- Consumes: ничего
- Produces: скрипты `npm run test`, `npm run test:unit`, `npm run test:e2e`, `npm run typecheck`, `npm run serve`; сервер на `http://127.0.0.1:4173`; проект Playwright `unit` без браузера и проекты `chromium` / `firefox` / `webkit` с `baseURL`

- [ ] **Step 1: Написать падающий smoke-тест**

`tests/e2e/smoke.spec.js`:
```js
import { expect, test } from '@playwright/test';

test('демо-страница отдаётся сервером', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(await page.title()).toContain('MyContext');
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx playwright test --project=chromium tests/e2e/smoke.spec.js`
Expected: FAIL — конфигурация Playwright отсутствует.

- [ ] **Step 3: Создать `package.json`**

`"type": "module"`, `"private": true`, поле `dependencies` отсутствует. Скрипты: `test` → `playwright test`, `test:unit` → `playwright test --project=unit`, `test:e2e` → `playwright test --project=chromium --project=firefox --project=webkit`, `typecheck` → `tsc --noEmit`, `serve` → `node scripts/serve.js`.

- [ ] **Step 4: Установить dev-зависимости**

Run: `npm install -D @playwright/test typescript && npx playwright install chromium firefox webkit`
Expected: `package.json` получает только `devDependencies`; поля `dependencies` не появляется.

- [ ] **Step 5: Создать `tsconfig.json`**

`allowJs`, `checkJs`, `noEmit`, `strict` — все `true`. `target: "ESNext"`, `lib: ["ESNext", "DOM", "DOM.Iterable"]`, `module: "ESNext"`, `moduleResolution: "bundler"`. `include`: `["src/**/*.js", "Demo/**/*.js", "scripts/**/*.js"]`.

- [ ] **Step 6: Создать `scripts/serve.js`**

Статический сервер на `node:http` и `node:fs`: отдаёт файлы из корня репозитория, MIME-типы для `.html`, `.css`, `.js`, `.svg`, `.png`, порт из `process.env.PORT ?? 4173`, `127.0.0.1`. Останавливается по SIGINT.

- [ ] **Step 7: Создать `playwright.config.js`**

Проект `unit`: `testDir: 'tests/unit'`, браузер не используется. Проекты `chromium`, `firefox`, `webkit`: `testDir: 'tests/e2e'`, `use: { baseURL: 'http://127.0.0.1:4173' }`. `webServer: { command: 'node scripts/serve.js', url: 'http://127.0.0.1:4173', reuseExistingServer: true }`. `use: { headless: true }`, `fullyParallel: true`, ретраи: 1 локально, 0 в CI.

- [ ] **Step 8: Создать `index.html`, `Demo/demo.css`, `Demo/demo.js`, `.gitignore`**

`index.html`: `<!doctype html>`, `lang="ru"`, `<title>MyContext — демо</title>`, `<link rel="stylesheet" href="./Demo/demo.css">`, `<script type="module" src="./Demo/demo.js">`. На этом этапе `Demo/demo.js` — пустой экспорт-заглушка, чтобы `tsc` имел входные файлы. `.gitignore`: `node_modules/`, `test-results/`, `playwright-report/`, `.DS_Store`.

- [ ] **Step 9: Запустить smoke-тест**

Run: `npx playwright test --project=chromium tests/e2e/smoke.spec.js`
Expected: PASS.

- [ ] **Step 10: Проверить типы**

Run: `npm run typecheck`
Expected: PASS без ошибок.

- [ ] **Step 11: Закоммитить**

```bash
git add package.json package-lock.json tsconfig.json playwright.config.js scripts/ .gitignore index.html Demo/ tests/
git commit -m "chore: инфраструктура репозитория, конфигурация тестов и тип��в"
```

---

### Task 2: Константы и движок позиционирования

**Files:**
- Create: `src/constants.js`, `src/positioner.js`
- Test: `tests/unit/positioner.spec.js`

**Interfaces:**
- Consumes: ничего
- Produces:
  - `src/constants.js`: именованные экспорты `SAFETY_PADDING = 8`, `CURSOR_OFFSET = 2`, `SUBMENU_OFFSET = 4`, `OPEN_GRACE_MS = 250`, `CLOSE_GRACE_MS = 200`, `DEGENERATE_AREA = 25`, `DEFAULT_ANIMATION_DURATION = 140`, `DEFAULT_ITEM_HEIGHT = 28`, `DEFAULT_ICON_SIZE = 16`, `DEFAULT_CHEVRON_SIZE = 12`, `DEFAULT_RADIUS = 8`
  - `src/positioner.js`:
    ```js
    /**
     * @typedef {object} MenuPosition
     * @property {number} left
     * @property {number} top
     */

    /**
     * @typedef {object} SubmenuPosition
     * @property {number} left
     * @property {number} top
     * @property {boolean} flippedX
     */

    /**
     * @param {RootPositionParams} params
     * @returns {MenuPosition}
     */
    export function calculateMenuPosition(params)

    /**
     * @param {SubmenuPositionParams} params
     * @returns {SubmenuPosition}
     */
    export function calculateSubmenuPosition(params)
    ```
    Имена типов обязательны: анонимный inline-объект в возвращаемом типе запрещён
    правилами проекта для публичного API, а `SubmenuPosition` — это то место, где
    живёт контракт `flippedX`, на который подписан Task 7.
    `RootPositionParams`: `cursorX, cursorY, menuWidth, menuHeight, viewportWidth, viewportHeight` (все `number`, обязательные), `offset` (default `CURSOR_OFFSET`), `padding` (default `SAFETY_PADDING`).
    `SubmenuPositionParams`: `anchorRect` (`{left, top, right, bottom}`), `menuWidth, menuHeight, viewportWidth, viewportHeight`, `offset` (default `SUBMENU_OFFSET`), `padding` (default `SAFETY_PADDING`).

- [ ] **Step 1: Написать падающие тесты геометрии**

`tests/unit/positioner.spec.js` содержит `describe` по двум функциям со следующими тестами и утверждениями:

Корень, вьюпорт 1000×800, меню 200×300, padding 8, offset 2 (значения по умолчанию):
- `правый нижний угол: cursor (990, 790) → left 788, top 488` — `990 - 200 - 2`, `790 - 300 - 2`
- `левый верхний угол: cursor (10, 10) → left 12, top 12`
- `не хватает места только справа: cursor (850, 10) → left 648` при `menuWidth = 200`, так как `850 + 2 + 200 + 8 > 1000`, а `850 - 200 - 2 = 648 >= 8`
- `offset влияет на оба края: при offset 0 тот же угол даёт left 790, top 490`
- `меню шире вьюпорта: menuWidth 1200, cursor (500, 10) → left 8` — ни один кандидат не помещается, работает clamp
- `меню выше вьюпорта: menuHeight 900, cursor (10, 400) → top 8`
- `курсор у самого края: cursor (0, 0) → left 8, top 8` — кандидат со смещением нарушает нижнюю границу `padding`, срабатывает clamp
- `инвариант: меню целиком внутри вьюпорта минус padding` — перебор детерминированной сетки `cursorX` из `[0, 1, 8, 9, 400, 500, 991, 999, 1000]`, `cursorY` из `[0, 1, 8, 9, 300, 500, 799, 800]`, размеры меню из `[[200,300],[50,50],[999,1000],[1,1]]`; для каждой комбинации `left >= padding && left + menuWidth <= viewportWidth - padding` и то же для `top`

Подменю, вьюпорт 1000×800, меню 200×300, offset 4, padding 8:
- `справа есть место: anchorRect {left 100, top 100, right 300, bottom 128} → left 304, top 100, flippedX false`
- `справа нет места: anchorRect {left 700, top 100, right 900, bottom 128} → left 496, flippedX true` (`700 - 200 - 4 = 496`)
- `по вертикали флипа нет: anchorRect {left 100, top 600, right 300, bottom 628}, menuHeight 300 → top 492` (`600 + 300 = 900 > 792`, значит `top = 792 - 300`)
- `не помещается ни сверху, ни снизу: menuHeight 900 → top 8`
- `справа и слева нет места: menuWidth 990, anchorRect {left 500, top 100, right 700, bottom 128} → left 8, flippedX true`
- `инвариант: подменю целиком внутри вьюпорта минус padding` — та же сетка, anchorRect выводится из координат сетки

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `npm run test:unit -- tests/unit/positioner.spec.js`
Expected: FAIL — модуль `src/positioner.js` не найден.

- [ ] **Step 3: Реализовать `src/constants.js`**

Одиннадцать именованных экспортов с точными значениями из блока «Interfaces». JSDoc-тип для каждого: числа не требуют аннотации, но блок экспорта сопровождается комментарием, перечисляющим, что значения обязаны совпадать с CSS-переменными из `styles/mycontext.css`.

- [ ] **Step 4: Реализовать `calculateMenuPosition` в `src/positioner.js`**

Предикат вписывания одинаков для обеих осей: `p >= padding && p + size + padding <= viewport`. Кандидаты по каждой оси строятся массивом и фильтруются этим предикатом. X: `[cursorX + offset, cursorX - menuWidth - offset, padding]`. Y: `[cursorY + offset, cursorY - menuHeight - offset, padding]`. Берётся первый прошедший, иначе последний. `offset` применяется симметрично: при флипе он отодвигает меню от курсора с противоположной стороны на ту же величину.

- [ ] **Step 5: Реализовать `calculateSubmenuPosition` в `src/positioner.js`**

Тот же предикат с осью Y и `viewportHeight`. X: пробуется `anchorRect.right + offset`; если он не проходит предикат, пробуется `anchorRect.left - menuWidth - offset` и `flippedX` становится `true`; если и он не проходит — `padding`. Y: `top = anchorRect.top`, затем поднимается до `viewportHeight - padding - menuHeight`; если результат меньше `padding` — `padding`. Флипа по Y нет: значение `offset` по вертикали не применяется.

- [ ] **Step 6: Запустить тесты и убедиться, что проходят**

Run: `npm run test:unit -- tests/unit/positioner.spec.js`
Expected: PASS, все тесты, включая оба инварианта.

- [ ] **Step 7: Проверить типы**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Закоммитить**

```bash
git add src/constants.js src/positioner.js tests/unit/positioner.spec.js
git commit -m "feat: движок позиционирования с flip и clamp"
```

---

### Task 3: Hover intent

**Files:**
- Create: `src/hoverIntent.js`
- Test: `tests/unit/hoverIntent.spec.js`

**Interfaces:**
- Consumes: `OPEN_GRACE_MS`, `CLOSE_GRACE_MS`, `DEGENERATE_AREA` из `src/constants.js` (Task 2)
- Produces:
  ```js
  /**
   * @param {HoverIntentOptions} [options]
   * @returns {HoverIntentController}
   */
  export function createHoverIntent(options)

  /**
   * @typedef {object} Point
   * @property {number} x
   * @property {number} y
   */

  /**
   * @typedef {object} HoverIntentOptions
   * @property {number} [openDelayMs]    default OPEN_GRACE_MS
   * @property {number} [closeDelayMs]   default CLOSE_GRACE_MS
   * @property {number} [degenerateArea] default DEGENERATE_AREA
   * @property {(fn: () => void, ms: number) => unknown} [schedule]
   * @property {(handle: unknown) => void} [cancel]
   * @property {() => void} [onOpen]  вызывается, когда сработала задержка открытия
   * @property {() => void} [onClose] вызывается, когда сработала задержка закрытия
   */

  /**
   * @typedef {object} HoverIntentController
   * @property {() => void} itemEnter
   * @property {() => void} itemLeave
   * @property {(point: Point) => void} submenuEnter
   * @property {(point: Point) => void} pointerMove
   * @property {() => boolean} isOpenPending
   * @property {() => boolean} isClosePending
   * @property {() => void} itemPress
   * @property {() => void} cancelAll
   */
  ```
  Время в модуле задаётся исключительно через `schedule`. Отдельной опции для
  чтения текущего времени не существует и не должно появляться: опция, которая
  принята в контракте, но не читается, — это обещание, которое модуль не держит.

  `onOpen` и `onClose` обязательны для оркестратора: без них единственный способ
  узнать, что сработала задержка, — опрос `isOpenPending()` в цикле, что неверно,
  либо обёртка `schedule`, которая после вызова колбэка читает внутренние флаги, то
  есть зависит от недокументированной детали реализации. Оба вызываются изнутри
  задачи планировщика после обновления внутреннего состояния.

- [ ] **Step 1: Написать падающие тесты**

`tests/unit/hoverIntent.spec.js`, во всех тестах используется ручной планировщик: `schedule` складывает `{fn, time}` в массив, `now` возвращает текущее время из переменной, тест двигает время вызовом `advance(ms)`.

- `открытие: itemEnter планирует открытие через openDelayMs` — после `itemEnter()` в планировщике одна задача с `time === now + 250`
- `открытие: isOpenPending истинен до срабатывания и ложен после`
- `открытие: itemLeave до истечения задержки отменяет открытие`
- `открытие: itemPress открывает немедленно, вызывая onOpen без задачи в планировщике` — после `itemPress()` колбэк `open` вызван один раз, задач в планировщике нет, `isOpenPending()` ложно
- `открытие: itemPress при уже висящей задаче не создаёт второй вызов onOpen` — `itemEnter()`, затем `itemPress()`, затем `advance(1000)`: `open` вызван ровно один раз
- `открытие: itemPress при отсутствии висящей задачи ничего не делает` — `itemEnter()`, `advance(OPEN_GRACE_MS)`, затем `itemPress()`: `open` вызван ровно один раз, второй вызов не появился
- `повторный itemEnter не перезапускает задержку: срок остаётся от первого наведения`
- `закрытие: курсор внутри треугольника не планирует закрытие` — якоря: выход `(100, 50)`, вход в подменю `(160, 60)`; затем первая позиция после входа принимается как вершина, `pointerMove({x: 130, y: 80})`; затем `pointerMove({x: 135, y: 70})` проверяется относительно треугольника из трёх уже принятых точек и лежит внутри. Контрольные числа: площадь треугольника 750, сумма подтреугольников 750, знаки кросс-продуктов `850, 200, 450` — все одного знака
- `закрытие: курсор снаружи треугольника планирует закрытие через closeDelayMs` — те же якоря, принятая вершина `(130, 80)`, затем `pointerMove({x: 500, y: 500})`
- `закрытие: возврат курсора внутрь отменяет запланированное закрытие` — якоря, вершина `(130, 80)`, затем `pointerMove({x: 500, y: 500})` планирует закрытие, затем `pointerMove({x: 135, y: 70})` его отменяет
- `промах сбрасывает опорные точки: после точки вне треугольника следующая проверяется против сузившегося клина` — якоря, вершина `(130, 80)`, промах `pointerMove({x: 500, y: 500})`, затем `pointerMove({x: 160, y: 75})` проверяется против `[(100, 50), (160, 60), (500, 500)]`, лежит внутри и отменяет закрытие. Без сброса клин остался бы исходным, и этот случай не отличался бы от предыдущего
- `вырожденный треугольник: точки почти на одной прямой не защищают подменю` — якоря `(100, 50)` и `(100, 50.4)`, принятая вершина `(100, 200)`; площадь меньше `DEGENERATE_AREA`, поэтому каждая последующая точка планирует закрытие
- `граница: площадь ровно DEGENERATE_AREA считается невырожденной` — вырожденность определяется условием `area < DEGENERATE_AREA`, strict
- `отмена: cancelAll снимает и открытие, и закрытие`
- `сброс: новый itemEnter сбрасывает якоря предыдущего подменю` — после нового `itemEnter` старый треугольник больше не защищает
- `вырожденный клин после промаха становится невырожденным и начинает защищать` — якоря `(100, 50)` и `(100, 50.4)`, вершина `(100, 200)` даёт вырожденный клин площадью 0; промах `pointerMove({x: 400, y: 10})` сужает клин до площади 60; затем `pointerMove({x: 150, y: 43.5})` лежит внутри суженного клина, поэтому закрытие не планируется. Контроль: против суженного клина знаки `-20, -50, -50` одного знака, против замороженного `-20, -7480, 7500` смешанные. Без сброса вершины клин остался бы вырожденным и закрытие было бы запланировано, то есть кейс дискриминирует сброс

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm run test:unit -- tests/unit/hoverIntent.spec.js`
Expected: FAIL — модуль `src/hoverIntent.js` не найден.

- [ ] **Step 3: Реализовать `createHoverIntent` в `src/hoverIntent.js`**

Состояние контроллера: `exitPoint`, `entryPoint`, `wedgeTip`, таймер открытия, таймер закрытия, флаги `openPending` и `closePending`. `submenuEnter` записывает `entryPoint`, обнуляет `wedgeTip` и снимает таймер закрытия. `pointerMove` проверяет новую точку **относительно треугольника из уже принятых точек** — `[exitPoint, entryPoint, wedgeTip]` — и никогда не добавляет проверяемую точку в этот треугольник.

Ключевое требование, отсутствие которого делает проверку тождественной: проверяемая точка не должна быть вершиной проверяемого многоугольника. Первая позиция после входа принимается без проверки и становится `wedgeTip`; каждая следующая проверяется против треугольника из трёх уже принятых точек. Попадание внутрь вершину **не** меняет — иначе клин раздувался бы от каждого шага длинного диагонального движения. Точка вне треугольника планирует закрытие и **сбрасывает `wedgeTip` на себя**, то есть следующая проверка идёт против сузившегося клина `[exitPoint, entryPoint, промахнувшаяся точка]`. Сброс обязателен: без него клин рос бы от каждой принятой точки, и подменю осталось бы открытым внутри всё большего треугольника. Имя `wedgeTip` отражает именно эту роль: вершина — это первая позиция после входа либо последний промах, а не «последняя принятая точка».

Треугольник вырожден, если его площадь по формуле кросс-продукта строго меньше `degenerateArea` — граница невырождена, условие strict. Вырожденный треугольник не защищает: точка планирует закрытие, и `wedgeTip` обновляется на неё, чтобы клин стал невырожденным и смог защищать, когда курсор вернётся ближе. `itemPress` открывает немедленно: снимает отложенную задачу и **вызывает `onOpen` сам**, иначе нажатие мышью открывало бы подменю молча — без задачи и без коллэка, то есть оркестратор, открывающий по `onOpen`, на нажатие не отреагировал бы. Если задача не висела, `itemPress` не делает ничего: повторное нажатие по уже открытому подменю не должно переоткрывать его. `cancelAll` снимает обе задачи и сбрасывает флаги и опорные точки.

`itemEnter` при уже висящем открытии задержку не перезапускает: отсчёт идёт от первого наведения.

- [ ] **Step 4: Запустить тесты и убедиться, что проходят**

Run: `npm run test:unit -- tests/unit/hoverIntent.spec.js`
Expected: PASS.

- [ ] **Step 5: Проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/hoverIntent.js tests/unit/hoverIntent.spec.js
git commit -m "feat: hover intent на safe-triangle с таймерами-страховками"
```

---

### Task 4: Рендерер иконок

**Files:**
- Create: `src/icons.js`
- Test: `tests/e2e/icons.spec.js`

**Interfaces:**
- Consumes: ничего
- Produces:
  ```js
  /**
   * @typedef {HTMLElement | SVGSVGElement} IconElement
   */

  /**
   * @param {IconConfig} icon
   * @returns {IconElement} элемент для вставки в .vc-icon-slot
   */
  export function renderIcon(icon)

  /**
   * @param {string} svgText
   * @returns {SVGSVGElement} очищенный корневой узел
   * @throws {Error} если разбор не дал корневой элемент svg
   */
  export function sanitizeSvg(svgText)
  ```
  `IconElement` — союз, а не `HTMLElement`: `SVGSVGElement` не подтип
  `HTMLElement`, поэтому сужение до него потребовало бы `any` или двойного
  приведения. Вставка в слот идёт через `appendChild`, который принимает `Node`.
  SVG-узел намеренно не получает класс `vc-icon`: оформление задаёт CSS Task 5
  селектором по слоту, а не по классу на самом узле.
  Тест подгружает модуль через `page.evaluate` с `import('/src/icons.js')` — сервер на Task 1 уже отдаёт `/src/`.

- [ ] **Step 1: Написать падающие тесты**

`tests/e2e/icons.spec.js`, все кейсы — `test` c переходом на `index.html` и вызовом `page.evaluate` с динамическим `import`:

- `эмодзи: span с текстом-символом, классом vc-icon и aria-hidden`
- `эмодзи: aria-hidden присутствует, чтобы не дублировать озвучку лейбла`
- `svg: разбирается в inline-узел с одним path и шириной 100%`
- `svg: получает aria-hidden=true и focusable=false`
- `svg: санитизация вырезает script целиком`
- `svg: санитизация вырезает foreignObject и iframe`
- `svg: санитизация вырезает обработчики on* со всех элементов`
- `svg: санитизация вырезает href со схемой javascript:`
- `svg: санитизация вырезает style целиком` — `style="position: fixed; inset: 0; z-index: 99999"` на элементе не оставляет атрибута; презентация задаётся `fill` и `stroke`, а не style
- `svg: санитизация вырезает style с background-image` — внешний запрос через `url(...)` не переживает санитизацию
- `svg: санитизация оставляет только фрагментные ссылки` — `use href="#id"` сохраняется, `use href="https://…#y"` удаляется, чтобы открытие меню не стало сетевым запросом
- `svg: санитизация удаляет узлы комментариев` — разметка с `<!-- … -->` не содержит комментариев в результате
- `svg: атрибут fill и stroke переживают санитизацию` — презентация остаётся возможной без style
- `svg: санитизация сохраняет элементы из белого списка (path, circle, g, defs, use, linearGradient)`
- `svg: нераспознанная строка бросает Error из sanitizeSvg`
- `растр: img с src, обязательным alt и draggable=false`
- `растр: без alt использует пустую строку, а не падает`
- `растр: src со схемой javascript: отбрасывается, элемент создаётся без src`
- `renderIcon: нераспознанный тип иконки не бросает, а отдаёт пустой span.vc-icon-slot`

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx playwright test --project=chromium tests/e2e/icons.spec.js`
Expected: FAIL — модуль `src/icons.js` не найден.

- [ ] **Step 3: Реализовать `sanitizeSvg` в `src/icons.js`**

`DOMParser` с `image/svg+xml`, `parsererror` в корне — `Error`. Обход дерева: элемент не входит в белый список `svg, path, circle, ellipse, rect, line, polyline, polygon, g, defs, use, clipPath, mask, title, linearGradient, radialGradient, stop` — удаляется вместе со всем поддеревом, иначе `foreignObject` унёс бы разметку, которую обход иначе обязан был бы разбирать; узлы комментариев удаляются. Поскольку белый список задан по элементам, политика по атрибутам выражена явно: `on*` вырезаются со всех уцелевших элементов, `style` вырезается полностью, а `href` и `xlink:href` остаются только тогда, когда значение начинается с `#`. Корневому `svg` выставляются `width="100%"`, `height="100%"`, `aria-hidden="true"`, `focusable="false"`.

- [ ] **Step 4: Реализовать `renderIcon` в `src/icons.js`**

Три ветки по `icon.type`. `emoji` → `<span class="vc-icon" aria-hidden="true">` с текстом `icon.value`. `svg` → `sanitizeSvg(icon.value)`, при `Error` — пустой `<span class="vc-icon">` и единственный `console.warn`. `raster` → `<img class="vc-icon" draggable="false" decoding="async" alt="…">`; `src` устанавливается, только если `new URL(icon.value, location.href)` даёт протокол из белого списка `http:, https:, data:image/`. Неизвестный `type` — пустой `<span class="vc-icon-slot">`.

- [ ] **Step 5: Запустить тесты и убедиться, что проходят**

Run: `npx playwright test --project=chromium tests/e2e/icons.spec.js`
Expected: PASS.

- [ ] **Step 6: Проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/icons.js tests/e2e/icons.spec.js
git commit -m "feat: рендерер иконок трёх типов с санитизацией SVG"
```

---

### Task 5: Стили и темы

**Files:**
- Create: `styles/mycontext.css`, `src/theme.js`
- Test: `tests/e2e/theme.spec.js`

**Interfaces:**
- Consumes: `DEFAULT_ITEM_HEIGHT`, `DEFAULT_ICON_SIZE`, `DEFAULT_CHEVRON_SIZE`, `DEFAULT_RADIUS`, `DEFAULT_ANIMATION_DURATION` из `src/constants.js` (Task 2)
- Produces:
  ```js
  /**
   * @param {HTMLElement} element
   * @param {'auto'|'light'|'dark'} theme
   */
  export function applyTheme(element, theme)

  /**
   * @param {HTMLElement} element
   * @param {number} durationMs
   */
  export function applyAnimationDuration(element, durationMs)
  ```
  `styles/mycontext.css` определяет токены из спеки, классы `.vc-menu`, `.vc-list`, `.vc-item`, `.vc-icon-slot`, `.vc-label`, `.vc-chevron`, `.vc-separator`, `.vc-icon`, состояния `[data-active]`, `[data-chevron="left"]`, `[data-vc-theme]`, `:popover-open`, `@starting-style`, `@supports`, два медиазапроса.

- [ ] **Step 1: Написать падающие тесты**

`tests/e2e/theme.spec.js`. Подготовка в `beforeEach`: `page.setContent` с `<link rel="stylesheet" href="/styles/mycontext.css">` и `<div id="m" class="vc-menu" popover="manual"></div>`, затем `page.evaluate` вызывает `applyTheme` / `applyAnimationDuration` на `#m` и `showPopover()`.

- `padding совпадает с константой: --vc-padding вычисляется в 8px, SAFETY_PADDING равен 8` — сравнивается `getComputedStyle(el).getPropertyValue('--vc-padding')` с импортированной константой
- `item-height по умолчанию равен 28px`
- `icon-size и chevron-size по умолчанию равны 16px и 12px`
- `уровень ограничен по высоте: max-height равен 100dvh минус два padding` — сравнение с `calc(100dvh - 16px)`
- `уровень ограничен по ширине: max-width равен 100dvw минус два padding` — сравнение с `calc(100dvw - 16px)`. Без этого длинный лейбл даёт меню шире вьюпорта, и гарантия «меню не выходит за границы» перестаёт быть безусловной
- `фон полупрозрачный и присутствует backdrop-filter`
- `поддержка без backdrop-filter: под @supports not есть непрозрачный запасной фон`
- `auto при светлой системной схеме оставляет светлый фон` — `emulateMedia({ colorScheme: 'light' })`
- `auto при тёмной системной схеме меняет фон` — `emulateMedia({ colorScheme: 'dark' })`
- `явный dark побеждает светлую системную настройку` — `applyTheme(el, 'dark')` при `colorScheme: 'light'`
- `явный light побеждает тёмную системную настройку`
- `applyAnimationDuration прописывает --vc-animation-duration равным переданному значению`
- `reduced-motion обнуляет длительность и отключает transform` — `emulateMedia({ reducedMotion: 'reduce' })`
- `появление: используется @starting-style и transition-behavior allow-discrete` — читается `getComputedStyle` открытого меню

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx playwright test --project=chromium tests/e2e/theme.spec.js`
Expected: FAIL — нет ни `styles/mycontext.css`, ни `src/theme.js`.

- [ ] **Step 3: Реализовать `src/theme.js`**

`applyTheme` ставит `data-vc-theme` в `element.dataset.vcTheme`. `applyAnimationDuration` ставит `style.setProperty('--vc-animation-duration', \`\${durationMs}ms\`)`.

- [ ] **Step 4: Реализовать `styles/mycontext.css`**

Порядок правил важен. Базовые значения токенов — светлая тема. Затем `@media (prefers-color-scheme: dark)` переопределяет их только для `[data-vc-theme="auto"]`. Затем `[data-vc-theme="dark"]` переопределяет безусловно — специфичность атрибута выше медиазапроса, поэтому явная тема побеждает системную. Каскад: `padding`, `border-radius`, `box-shadow`, `backdrop-filter: blur(20px) saturate(180%)`, полупрозрачный фон из `color-mix`; `@supports not (backdrop-filter: blur(1px))` подставляет `--vc-bg-solid`. Сетка `.vc-item` — `grid-template-columns: var(--vc-icon-size) 1fr var(--vc-chevron-size)`, обе боковые колонки зарезервированы всегда. `.vc-label` — `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0`. Активный пункт — селектор по `[data-active]`, не `:focus`. Вход через `@starting-style` + `transition-behavior: allow-discrete`; выход — `transition` по `opacity` и `transform`. Медиазапрос `prefers-reduced-motion: reduce` обнуляет `--vc-animation-duration` и отключает `transform`.

Ограничение габаритов двумя слоями — обязательная часть, а не украшение. CSS задаёт каждому уровню `max-height: calc(100dvh - 2 * var(--vc-padding))` и `max-width: calc(100dvw - 2 * var(--vc-padding))`, поэтому элемент физически не может оказаться больше доступного места. Только после этого `positioner.js` получает от caller'а размер, который гарантированно влезает, и его инвариант «меню целиком внутри вьюпорта минус padding» становится безусловным. Без `max-width` длинный лейбл создаёт меню шире вьюпорта, и единственным оставшимся ответом движка будет clamp к `padding` — то есть меню вылезет за правый край, а критерий 2 окажется недостижим. Именно поэтому оба ограничения равны `calc(100d? - 2 * var(--vc-padding))`, а `SAFETY_PADDING` в JS обязан совпадать с `--vc-padding`.

- [ ] **Step 5: Запустить тесты и убедиться, что проходят**

Run: `npx playwright test --project=chromium tests/e2e/theme.spec.js`
Expected: PASS.

- [ ] **Step 6: Запустить на всех движках**

Run: `npx playwright test --project=chromium --project=firefox --project=webkit tests/e2e/theme.spec.js`
Expected: PASS. Расхождения чинятся в CSS, а не ослаблением теста.

- [ ] **Step 7: Проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add styles/mycontext.css src/theme.js tests/e2e/theme.spec.js
git commit -m "feat: стили, темы и анимации с поддержкой prefers-reduced-motion"
```

---

### Task 6: Рендерер уровней и пунктов

**Files:**
- Create: `src/renderer.js`
- Test: `tests/e2e/renderer.spec.js`

**Interfaces:**
- Consumes: `renderIcon` из `src/icons.js` (Task 4)
- Produces:
  ```js
  /**
   * @typedef {object} RenderContext
   * @property {number} levelIndex
   * @property {string} menuId
   * @property {Map<string, MenuItem>} actions  внутренний ключ → пункт
   */

  /**
   * @typedef {object} RenderedItem
   * @property {HTMLElement} element
   * @property {boolean} focusable
   * @property {boolean} hasSubmenu
   * @property {string|null} key
   */

  /**
   * @typedef {object} RenderedLevel
   * @property {HTMLElement} element
   * @property {RenderedItem[]} items
   */

  /**
   * @param {Array<MenuItem | SeparatorItem>} items
   * @param {RenderContext} context
   * @returns {RenderedLevel}
   */
  export function renderLevel(items, context)

  /**
   * @param {MenuItem | SeparatorItem} item
   * @param {RenderContext} context
   * @param {number} itemIndex
   * @param {number} setSize
   * @returns {RenderedItem}
   */
  export function renderItem(item, context, itemIndex, setSize)
  ```
  Внутренний ключ пункта — `` `${context.levelIndex}:${itemIndex}` ``. Пользовательский `id` копируется только в `data-id` и в ключи не входит.

- [ ] **Step 1: Написать падающие тесты**

`tests/e2e/renderer.spec.js`, модуль загружается через `page.evaluate` с `import('/src/renderer.js')`. Каждый тест рендерит уровень в `<div id="host">` и читает результат.

- `пункт: role=menuitem, tabindex=-1, data-active отсутствует`
- `пункт disabled: aria-disabled=true, tabindex=-1, в items помечен focusable=false`
- `пункт с подменю: aria-haspopup=menu, aria-expanded=false, data-chevron=right`
- `разделитель: role=separator и aria-orientation=horizontal, в focusable-список не попадает`
- `aria-level равен levelIndex плюс один`
- `aria-setsize и aria-posinset считаются без разделителей` — уровень из трёх пунктов и разделителя: `aria-setsize="3"`, `aria-posinset` 1, 2, 3
- `иконки: у пункта без иконки слот сохраняет ширину --vc-icon-size` — `getComputedStyle(slot).width` совпадает с шириной слота у пункта с иконкой
- `иконки: у пункта без подменю шеврон сохраняет ширину --vc-chevron-size`
- `иконки: лейблы с иконкой и без совпадают по координате X` — `getBoundingClientRect().x` у обоих лейблов равны
- `длинный лейбл обрезается многоточием, ширина меню не растёт` (Review Focus 5) — лейбл длиной 400 символов: `scrollWidth > clientWidth`, а `getBoundingClientRect().width` меню равна ширине меню с короткими лейблами
- `колонки не сдвигаются: ширина меню одинакова для пунктов с иконкой и без`
- `внутренний ключ не зависит от id: пункт с повторяющимся id получает разные ключи` (Review Focus 2) — два пункта с `id: 'x'` дают ключи `0:0` и `0:1`
- `action-коллбэк попадает в actions, а не в DOM` — `actions.size === 3`, и ни один `onclick` в разметке не установлен
- `меню получает role=menu и aria-label из контекста`
- `у каждого уровня уникальный id для aria-owns`

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx playwright test --project=chromium tests/e2e/renderer.spec.js`
Expected: FAIL — модуль `src/renderer.js` не найден.

- [ ] **Step 3: Реализовать `renderItem` в `src/renderer.js`**

Разделитель → `<div class="vc-separator" role="separator" aria-orientation="horizontal">` с `focusable: false`. Пункт → `<div class="vc-item" role="menuitem" tabindex="-1">` с тремя детьми: `span.vc-icon-slot` (содержимое — результат `renderIcon`, при отсутствии иконки слот пуст), `span.vc-label` с текстом `item.label`, `span.vc-chevron` (только у пунктов с подменю). На владельце подменю: `aria-haspopup="menu"`, `aria-expanded="false"`, `data-chevron="right"`. На отключённом: `aria-disabled="true"`. На каждом пункте: `aria-level`, `aria-setsize`, `aria-posinset`, `data-id` при наличии `id`.

- [ ] **Step 4: Реализовать `renderLevel` в `src/renderer.js`**

Строит `div.vc-menu[popover=manual][role=menu][aria-label]`, внутри `div.vc-list[role=group]`. `menuId` задаёт `id` элементу уровня, чтобы пункты-владельцы могли проставить `aria-owns`. `setSize` считается по числу не-разделителей. Каждому пункту-владельцу подменю выдаётся собственный дочерний `menuId` для `aria-owns`, который подменю использует при создании. Коллбэки `action` кладутся в `context.actions` под внутренним ключом.

- [ ] **Step 5: Запустить тесты и убедиться, что проходят**

Run: `npx playwright test --project=chromium tests/e2e/renderer.spec.js`
Expected: PASS.

- [ ] **Step 6: Проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/renderer.js tests/e2e/renderer.spec.js
git commit -m "feat: рендерер уровней меню с фиксированными колонками и ARIA"
```

---

### Task 7: Управление Top Layer

**Files:**
- Create: `src/layer.js`
- Test: `tests/e2e/layer.spec.js`

**Interfaces:**
- Consumes: `renderLevel` из `src/renderer.js` (Task 6), `calculateMenuPosition` и `calculateSubmenuPosition` из `src/positioner.js` (Task 2), `applyTheme` и `applyAnimationDuration` из `src/theme.js` (Task 5), `SAFETY_PADDING` и `DEFAULT_ANIMATION_DURATION` из `src/constants.js` (Task 2)
- Produces:
  ```js
  /**
   * @typedef {object} LevelEntry
   * @property {HTMLElement} element
   * @property {RenderedItem[]} items
   * @property {LevelEntry|null} parent
   * @property {RenderedItem|null} ownerItem  пункт, открывший этот уровень; null у корня
   * @property {LevelEntry[]} children
   * @property {boolean} open
   * @property {number} generation
   * @property {number} activeIndex
   */

  /**
   * @typedef {object} MenuLayerOptions
   * @property {string} label
   * @property {'auto'|'light'|'dark'} theme
   * @property {number} animationDuration
   * @property {Map<string, MenuItem>} actions  общий для всех уровней, передаётся по ссылке
   * @property {(fn: () => void, ms: number) => unknown} [schedule]
   * @property {(handle: unknown) => void} [cancel]
   * @property {MediaQueryList} [reducedMotionQuery]
   */

  /**
   * @typedef {object} MenuLayer
   * @property {(items, parent, levelIndex, ownerItem) => LevelEntry} ensureLevel
   * @property {(entry: LevelEntry, anchor: {x: number, y: number}) => void} showRoot
   * @property {(entry: LevelEntry) => void} showSubmenu
   * @property {(entry: LevelEntry) => void} hide
   * @property {() => void} hideAll
   * @property {(entry: LevelEntry | null) => void} setFocusOwner
   * @property {() => void} destroy
   */

  /**
   * @param {MenuLayerOptions} options
   * @returns {MenuLayer}
   */
  export function createLayer(options)
  ```
  `ensureLevel` создаёт уровень один раз и возвращает тот же `LevelEntry` при повторном вызове с теми же аргументами. `ownerItem` у корневого уровня — `null`, у подменю — `RenderedItem` пункта-владельца, через `.element` доступны `aria-owns`, `aria-expanded` и `data-chevron`.

- [ ] **Step 1: Написать падающие тесты**

`tests/e2e/layer.spec.js`, модуль загружается через `page.evaluate` с `import('/src/layer.js')`. Для контроля времени `schedule` и `cancel` внедряются из теста.

- `showRoot: элемент получает :popover-open и ненулевые габариты после показа`
- `замер вслепую: до showPopover габариты нулевые, а координаты после показа соответствуют результату positioner` — до `showRoot` `getBoundingClientRect()` пустой, после — совпадает с ожидаемыми `left`/`top`
- `позиционирование: меню целиком внутри вьюпорта при точке в правом нижнем углу`
- `top layer: показанное подменю отрисовывается поверх ранее созданного соседнего` — `document.elementFromPoint` в точке пересечения возвращает элемент позднее показанного подменю
- `закрытие: элемент скрывается после animationDuration` — до истечения `:popover-open` ещё есть, после — нет
- `закрытие: повторное открытие до истечения задержки отменяет hidePopover` — вызов `showSubmenu` в середине ожидания оставляет `:popover-open`
- `поколения: отложенное закрытие старого поколения не трогает новое` — `entry.generation` растёт при каждом `show`
- `reduced-motion: hidePopover вызывается немедленно, без задачи в планировщике`
- `hideAll: скрывает всю цепочку, от глубоких к корню`
- `chevron: showSubmenu у правого края разворачивает шеврон пункта-владельца` — `calculateSubmenuPosition` вернул `flippedX: true`, у пункта-владельца `data-chevron="left"`; у пункта слева остаётся `right`
- `aria-owns: showSubmenu проставляет пункту-владельцу aria-owns со id подменю` — значение равно `id` элемента подменю; у корня `aria-owns` отсутствует
- `aria-expanded: showSubmenu ставит пункту-владельцу aria-expanded=true`
- `destroy: элементы удалены из DOM, document.body чист`

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx playwright test --project=chromium tests/e2e/layer.spec.js`
Expected: FAIL — модуль `src/layer.js` не найден.

- [ ] **Step 3: Реализовать замер вслепую и показ в `src/layer.js`**

Показ: инлайново `display: flex; position: fixed; left: -9999px; top: 0; visibility: hidden` → `getBoundingClientRect()` → `calculateMenuPosition` или `calculateSubmenuPosition` от `anchorRect` пункта-владельца → запись `left`/`top` → снятие маски → `document.body.append(element)` для подъёма в конец DOM → `showPopover()`. `showSubmenu` по возвращённому `flippedX` выставляет пункту-владельцу `data-chevron` в `left` или `right`.

- [ ] **Step 4: Реализовать отложенное закрытие в `src/layer.js`**

`hide(entry)` увеличивает `entry.generation`, запоминает текущое поколение, читает `options.reducedMotionQuery.matches`. Если включён — `hidePopover()` немедленно. Иначе планирует задачу через `options.schedule`, которая вызывает `hidePopover()` только если `entry.generation` совпадает с запомненным. `showSubmenu` и `showRoot` увеличивают поколение, что делает любую висящую задачу недействительной.

- [ ] **Step 5: Реализовать `hideAll`, `setFocusOwner` и `destroy`**

`hideAll` обходит цепочку от глубоких уровней к корню, у каждого скрытого уровня снимает `aria-expanded` с его `ownerItem.element`, если он есть. `destroy` снимает все висящие задачи, вызывает `hidePopover()` на каждом заведённом элементе и удаляет их из DOM.

- [ ] **Step 6: Запустить тесты и убедиться, что проходят**

Run: `npx playwright test --project=chromium tests/e2e/layer.spec.js`
Expected: PASS.

- [ ] **Step 7: Запустить на всех движках**

Run: `npx playwright test --project=chromium --project=firefox --project=webkit tests/e2e/layer.spec.js`
Expected: PASS.

- [ ] **Step 8: Проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/layer.js tests/e2e/layer.spec.js
git commit -m "feat: управление Top Layer с замером вслепую и отложенным закрытием"
```

---

### Task 8: Клавиатурная навигация

**Files:**
- Create: `src/keyboard.js`
- Test: `tests/e2e/keyboard.spec.js`

**Interfaces:**
- Consumes: `LevelEntry` из `src/layer.js` (Task 7)
- Produces:
  ```js
  /**
   * @typedef {object} KeyboardHost
   * @property {() => void} closeAll
   * @property {(entry: LevelEntry) => void} openSubmenu
   * @property {() => void} closeCurrentLevel
   * @property {() => void} focusOwner
   */

  /**
   * @param {KeyboardHost} host
   * @returns {KeyboardController}
   */
  export function createKeyboard(host)

  /**
   * @typedef {object} KeyboardController
   * @property {(event: KeyboardEvent) => void} handleKeydown
   * @property {(entry: LevelEntry) => void} focusFirst
   * @property {() => void} reset
   */
  ```

- [ ] **Step 1: Написать падающие тесты**

`tests/e2e/keyboard.spec.js`. Фикстура собирает `MyContext`-подобную структуру из `createLayer` и `createKeyboard`, в которой клавиши отправляются в элемент активного пункта.

- `ArrowDown переключает активный пункт циклически, минуя disabled и разделители` — уровень из `пункт, disabled, разделитель, пункт`; четыре нажатия `ArrowDown` возвращают к первому
- `ArrowUp идёт в обратном направлении циклически`
- `Home и End переходят к первому и последнему доступному пункту`
- `data-active совпадает с элементом, имеющим фокус, а tabindex равен 0 только у него`
- `ArrowRight открывает подменю и переносит фокус в его первый пункт`
- `ArrowRight на пункте без подменю ничего не делает`
- `ArrowLeft закрывает подменю и возвращает фокус на пункт-владелец`
- `ArrowLeft на корневом уровне вызывает closeAll`
- `Enter вызывает action активного пункта и закрывает меню`
- `Enter на пункте-владельце открывает подменю и не вызывает action` — счётчик вызовов `action` остаётся нулём
- `Space вызывает action`
- `Escape закрывает самое глубокое подменю, не трогая корень`
- `Escape на корневом уровне вызывает closeAll`
- `Tab закрывает всё меню и вызывает focusOwner`
- `клавиши вне контейнера не обрабатываются` — обработчик ничего не делает, если `closest('.vc-item')` не найден

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx playwright test --project=chromium tests/e2e/keyboard.spec.js`
Expected: FAIL — модуль `src/keyboard.js` не найден.

- [ ] **Step 3: Реализовать цикл навигации в `src/keyboard.js`**

Список навигации уровня — `entry.items.filter(item => item.focusable)`. Переход циклический по модулю длины списка, со сбросом `tabindex` у предыдущего и установкой `tabindex="0"` и `data-active` у следующего. `focusFirst` ставит фокус на первый элемент списка. `focus()` вызывается с `preventScroll: true`.

- [ ] **Step 4: Реализовать разбор клавиш в `src/keyboard.js`**

`handleKeydown` определяет уровень по `event.target.closest('.vc-menu')` и активный пункт по `[data-active]`. `ArrowDown` / `ArrowUp` / `Home` / `End` — переход. `ArrowRight` — если у пункта есть подменю, `host.openSubmenu(entry)` и `focusFirst` на дочернем уровне. `ArrowLeft` — если уровень не корневой, `host.closeCurrentLevel()`, иначе `host.closeAll()`. `Enter` и `Space` — если есть подменю, открыть её, иначе выполнить `action` и вызвать `host.closeAll()`. `Escape` — если уровень не корневой, `host.closeCurrentLevel()`, иначе `host.closeAll()`. `Tab` — `host.closeAll()` и `host.focusOwner()`. Ветки без соответствия игнорируются.

- [ ] **Step 5: Запустить тесты и убедиться, что проходят**

Run: `npx playwright test --project=chromium tests/e2e/keyboard.spec.js`
Expected: PASS.

- [ ] **Step 6: Проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/keyboard.js tests/e2e/keyboard.spec.js
git commit -m "feat: клавиатурная навигация с роуминг-фокусом"
```

---

### Task 9: Оркестратор `MyContext`

**Files:**
- Create: `src/MyContext.js`, `src/index.js`
- Test: `tests/unit/config.spec.js`, `tests/e2e/lifecycle.spec.js`

**Interfaces:**
- Consumes: `createLayer` (Task 7), `createKeyboard` (Task 8), `createHoverIntent` (Task 3), `SAFETY_PADDING` и `DEFAULT_ANIMATION_DURATION` (Task 2)
- Produces:
  ```js
  /**
   * @param {Array<MenuItem | SeparatorItem>} items
   * @param {MyContextOptions} [options]
   */
  export class MyContext {
    constructor(items, options = {})
    attach(element)      // HTMLElement
    detach()
    open(params)         // {x: number, y: number}
    close()
    destroy()
  }
  ```
  Приватные поля: `#items`, `#options`, `#layer`, `#keyboard`, `#hover`, `#actions`, `#root`, `#chain`, `#attachedTo`, `#focusOwner`, `#destroyed`, `#openTimers`, `#globalHandlers`.
  `src/index.js` — единственная строка значимой логики: `export { MyContext } from './MyContext.js';`

- [ ] **Step 1: Написать падающие тесты валидации**

`tests/unit/config.spec.js`, без браузера:

- `пустой массив пунктов отклоняется`
- `пункт без строкового label отклоняется`
- `пункт с пустым label отклоняется`
- `неизвестный тип иконки отклоняется с указанием пути items[2].icon.type`
- `action не функция отклоняется`
- `submenu не массив отклоняется`
- `ошибка во вложенном пункте указывает полный путь items[1].submenu[0].label`
- `растр без alt отклоняется`
- `разделитель без type отклоняется`
- `валидная конфигурация принимается`

- [ ] **Step 2: Убедиться, что тесты валидации падают**

Run: `npm run test:unit -- tests/unit/config.spec.js`
Expected: FAIL — модуль `src/MyContext.js` не найден.

- [ ] **Step 3: Реализовать валидацию в `src/MyContext.js`**

Приватный метод `#validate(items)` рекурсивно обходит дерево и бросает `TypeError` с путём вида `items[1].submenu[0].label`. Разделитель допустим только при `type === 'separator'`. Иконка допустима при совпадении `type` одному из `emoji`, `svg`, `raster`; у `raster` обязателен непустой `alt`; у `svg` и `emoji` обязателен непустой `value`. Валидация вызывается первым же оператором конструктора.

- [ ] **Step 4: Запустить тесты валидации и убедиться, что проходят**

Run: `npm run test:unit -- tests/unit/config.spec.js`
Expected: PASS.

- [ ] **Step 5: Написать падающие e2e-тесты жизненного цикла**

`tests/e2e/lifecycle.spec.js` — страница с `<div id="workspace">`, `import('/src/index.js')` из `page.evaluate`.

- `attach: contextmenu на контейнере открывает меню в точке клика и предотвращает системное` — `defaultPrevented === true`
- `attach: пункт с disabled и подменю не открывает подменю мышью` (Review Focus 1)
- `attach: пункт с disabled и подменю не открывает подменю по ArrowRight` (Review Focus 1)
- `пункты без id и с повторяющимся id вызывают свой action` (Review Focus 2) — четыре пункта: без `id`, два с `id: 'x'`, один с `id: 'y'`; каждый пишет в общий счётчик свою метку, нажимаются по очереди, ожидается правильный порядок
- `action бросает исключение — меню всё равно закрывается` (Review Focus 3) — исключение пробрасывается в `page.evaluate` и перехватывается там, `#popover-open` после клика отсутствует
- `open() без attach открывает меню в заданных координатах`
- `open() идемпотентен: повторный вызов не создаёт второе меню в DOM`
- `close() скрывает меню и возвращает фокус на элемент-владелец`
- `close() без attach не бросает и просто скрывает`
- `destroy() удаляет все элементы меню из DOM`
- `destroy() идемпотентен: повторный вызов не бросает`
- `attach, open, close и destroy после destroy() бросают Error`
- `destroy() снимает слушатель contextmenu с контейнера` — правый клик после `destroy()` не открывает меню
- `detach() снимает привязку: правый клик по контейнеру больше не открывает меню`
- `detach() не уничтожает экземпляр: open() после detach() всё ещё работает`
- `attach: повторный attach переносит привязку на новый контейнер` — после повторного `attach` клик по первому контейнеру не открывает меню, клик по второму открывает

- [ ] **Step 6: Убедиться, что e2e-тесты падают**

Run: `npx playwright test --project=chromium tests/e2e/lifecycle.spec.js`
Expected: FAIL — большая часть тестов не проходит, так как `#layer` и глобальные слушатели не реализованы.

- [ ] **Step 7: Реализовать конструктор, `attach`, `detach`, `open`, `close`, `destroy`**

Конструктор валидирует, собирает `options` с дефолтами из `constants.js`, создаёт `Map` действий, `createLayer`, `createKeyboard` c `host`-замыканиями на приватные методы. `attach` проверяет наличие `HTMLElement.prototype.showPopover` и бросает `Error` с названием требования при отсутствии; снимает предыдущую привязку, если она была; добавляет слушатель `contextmenu`. `open` гарантирует существование корневого уровня, вызывает `showRoot`, устанавливает `#focusOwner` и ставит фокус на первый доступный пункт. `close` вызывает `hideAll` и возвращает фокус на `#focusOwner`, если он есть. Каждый публичный метод начинается с проверки `#destroyed` и бросает `Error`. `destroy` идемпотентен.

- [ ] **Step 8: Запустить тесты и убедиться, что проходят**

Run: `npx playwright test --project=chromium tests/e2e/lifecycle.spec.js`
Expected: PASS.

- [ ] **Step 9: Проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/MyContext.js src/index.js tests/unit/config.spec.js tests/e2e/lifecycle.spec.js
git commit -m "feat: класс MyContext с валидацией конфигурации и жизненным циклом"
```

---

### Task 10: Подменю — показ, усечение цепочки, шеврон

**Files:**
- Modify: `src/MyContext.js`
- Test: `tests/e2e/submenu.spec.js`

**Interfaces:**
- Consumes: `createHoverIntent` из `src/hoverIntent.js` (Task 3), `showSubmenu` и `hide` из `src/layer.js` (Task 7)
- Produces: приватные `#showSubmenuFor(item)`, `#hideSubmenuFor(item)`, `#truncateChain(levelEntry)` в `src/MyContext.js`; поле `#chain` хранит открытые уровни от корня к текущему.

- [ ] **Step 1: Написать падающие тесты**

`tests/e2e/submenu.spec.js`, страница с контейнером и меню, вложенным на 4 уровня. Тесты, зависящие от времени, используют `page.clock`: `await page.clock.install()` до открытия меню, затем `page.clock.fastForward(250)` вместо реального ожидания. Публичный API `MyContext` не получает никаких параметров для подмены таймеров.

- `наведение на пункт с подменю не открывает его мгновенно` — сразу после `pointerenter` подменю нет
- `наведение на пункт с подменю открывает его через openDelayMs` — после `fastForward(250)` `:popover-open` появляется
- `уход курсора до истечения задержки не открывает подменю` — `pointerenter`, `fastForward(200)`, `pointerleave`, `fastForward(250)`, подменю нет
- `удержание кнопки мыши открывает подменю немедленно` — `itemPress` обходит задержку
- `диагональное движение к подменю не закрывает его` — курсор уходит из пункта, проходит через соседний пункт, попадает в подменю; `:popover-open` сохраняется всё время (критерий 3)
- `курсор, ушедший в сторону, закрывает подменю после closeDelayMs`
- `переход на другой пункт усекает цепочку` — открыто «Экспорт → PDF», наведение на «Скачать» закрывает «PDF» и оставляет «Экспорт» открытым
- `подменю у правого края раскрывается влево, шеврон развёрнут` — `data-chevron="left"` у пункта-владельца
- `подменю у левого края раскрывается вправо, шеврон обычный`
- `вложенность 4 уровней открывается целиком и все меню в пределах вьюпорта` — для каждого открытого уровня `getBoundingClientRect()` внутри вьюпорта минус 8
- `вложенность 4 уровней закрывается по цепочке клавишей Escape` — четыре нажатия закрывают всё
- `отключённый пункт-владелец не открывает подменю ни одним способом` (Review Focus 1, клавиатурный дубль)
- `подменю не пересоздаётся при повторном наведении на тот же пункт` — id открытого подменю запоминается, меню закрывается и открывается снова, id совпадает; пересоздание выдало бы новый id
- `aria-expanded возвращается в false после закрытия подменю` — открыть, навести соседний пункт, `aria-expanded` у закрытого владельца снова `false`
- `aria-expanded у всех владельцев равен false при полном close()`

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx playwright test --project=chromium tests/e2e/submenu.spec.js`
Expected: FAIL — показ подменю не реализован.

- [ ] **Step 3: Реализовать показ и усечение в `src/MyContext.js`**

На `pointerenter` пункта с подменю запускается `hover.itemEnter`, на `pointerleave` — `hover.itemLeave`, на `pointermove` по дереву меню — `hover.pointerMove`, на `pointerenter` подменю — `hover.submenuEnter`. По срабатыванию открытия вызывается `#showSubmenuFor`: `#truncateChain` скрывает всё глубже текущего уровня, затем `ensureLevel` для подменю, `showSubmenu`, `push` в `#chain`, `aria-expanded="true"`. Отключённые пункты-владельцы не подписываются на показ вовсе. При закрытии подменю `aria-expanded` возвращается в `false`.

- [ ] **Step 4: Запустить тесты и убедиться, что проходят**

Run: `npx playwright test --project=chromium tests/e2e/submenu.spec.js`
Expected: PASS.

- [ ] **Step 5: Запустить на всех движках**

Run: `npx playwright test --project=chromium --project=firefox --project=webkit tests/e2e/submenu.spec.js`
Expected: PASS.

- [ ] **Step 6: Проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/MyContext.js tests/e2e/submenu.spec.js
git commit -m "feat: показ подменю с hover intent и усечением цепочки"
```

---

### Task 11: Глобальные слушатели

**Files:**
- Modify: `src/MyContext.js`
- Test: `tests/e2e/globals.spec.js`

**Interfaces:**
- Consumes: `hideAll` и `setFocusOwner` из `src/layer.js` (Task 7), `handleKeydown` и `reset` из `src/keyboard.js` (Task 8), `cancelAll` из `src/hoverIntent.js` (Task 3)
- Produces: приватный `#bindGlobalHandlers()` в `src/MyContext.js` и симметричный `#unbindGlobalHandlers()`. Все обработчики хранятся в `#globalHandlers` как пары «событие, функция», чтобы сниматься по списку.

- [ ] **Step 1: Написать падающие тесты**

`tests/e2e/globals.spec.js`.

- `клик левой кнопкой вне дерева меню закрывает его`
- `правый клик вне дерева меню закрывает его`
- `правый клик по самому меню не открывает системное меню и не меняет наше` — `contextmenu` на пункте: `defaultPrevented === true`, меню остаётся открытым и в той же позиции
- `правый клик по контейнеру во время открытого меню переоткрывает его в новой точке`
- `правый клик вне контейнера закрывает наше меню, но не подавляет системное` — `defaultPrevented === false` вне привязанного контейнера
- `Escape при фокусе вне меню всё равно закрывает его` — слушатель `keydown` на `document` в capture-фазе
- `скролл страницы закрывает меню`
- `скролл внутреннего списка длинного меню не закрывает его` — цель события `scroll` находится внутри `.vc-list`
- `resize окна закрывает меню`
- `attach к двум контейнерам: id элементов меню не пересекаются` (Review Focus 4)
- `attach к двум контейнерам: меню одного не закрывает меню другого` (Review Focus 4)
- `destroy одного экземпляра не ломает второй` (Review Focus 4)
- `destroy снимает все глобальные слушатели` — после него скролл и resize не вызывают исключений

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx playwright test --project=chromium tests/e2e/globals.spec.js`
Expected: FAIL — глобальные слушатели не реализованы.

- [ ] **Step 3: Реализовать `#bindGlobalHandlers` в `src/MyContext.js`

- `pointerdown` на `document` в capture-фазе: если цель не внутри `.vc-menu` — `close()`
- `contextmenu` на `document` в capture-фазе: `preventDefault()` только если цель внутри `.vc-menu`; иначе `close()` без подавления системного меню
- `keydown` на `document` в capture-фазе: `Escape` вне меню всё равно закрывает; остальные клавиши передаются в `keyboard.handleKeydown`
- `scroll` на `window` в capture-фазе с `passive: true`: если `event.target` — не `document` и не `body`, пропустить; иначе `close()`
- `resize` на `window`: `close()`

- [ ] **Step 4: Реализовать `#unbindGlobalHandlers` и вызовы в `destroy`**

`destroy` вызывает `#unbindGlobalHandlers` до очистки DOM, чтобы обработчики не сработали на разбираемых элементах.

- [ ] **Step 5: Запустить тесты и убедиться, что проходят**

Run: `npx playwright test --project=chromium tests/e2e/globals.spec.js`
Expected: PASS.

- [ ] **Step 6: Запустить на всех движках**

Run: `npx playwright test --project=chromium --project=firefox --project=webkit tests/e2e/globals.spec.js`
Expected: PASS.

- [ ] **Step 7: Проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/MyContext.js tests/e2e/globals.spec.js
git commit -m "feat: глобальные слушатели закрытия и изоляция контекстного меню"
```

---

### Task 12: Демо

**Files:**
- Create: `Demo/scenarios.js`, Modify: `Demo/demo.js`, `Demo/demo.css`, `index.html`
- Test: `tests/e2e/demo.spec.js`

**Interfaces:**
- Consumes: `MyContext` из `src/index.js` (Task 9), `styles/mycontext.css` (Task 5)
- Produces: `Demo/scenarios.js` экспортирует массив объектов `{ id, title, items }` — по одному на каждый проверяемый случай из спеки. `index.html` подключает `styles/mycontext.css` и `Demo/demo.css`.

- [ ] **Step 1: Написать падающие тесты**

`tests/e2e/demo.spec.js`.

- `демо: страница грузится без ошибок консоли` — собирает `page.on('console')` и `page.on('pageerror')`, после загрузки оба массива пусты
- `демо: список сценариев отрисован`
- `демо: правый клик по рабочей области открывает меню`
- `демо: сценарий с 4 уровнями вложенности раскрывается целиком`
- `демо: сценарий со всеми тремя типами иконок отрисован без ошибок`
- `демо: сценарий с отключёнными пунктами не открывает их подменю`
- `демо: сценарий длинного списка прокручивается внутри уровня` — `scrollHeight > clientHeight` у `.vc-list`, и меню остаётся открытым после прокрутки
- `демо: переключение темы страницы не ломает меню`
- `демо: у каждого сценария свой независимый экземпляр MyContext`

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx playwright test --project=chromium tests/e2e/demo.spec.js`
Expected: FAIL — демо не реализовано.

- [ ] **Step 3: Реализовать `Demo/scenarios.js`**

Шесть сценариев: `basic` (иконки трёх типов вперемешку, часть пунктов без иконок — проверка соосности), `nested` (4 уровня, на глубине 3 и 4 у одного пункта свой шеврон), `disabled` (отключённый пункт с подменю, отключённый обычный), `icons` (все три типа рядом, плюс пункт без иконки), `long` (40 пунктов, заведомо выше вьюпорта), `mixed` (всё вместе). Экспортируется массив с `id`, `title`, `items`.

- [ ] **Step 4: Реализовать `Demo/demo.js` и разметку`

`Demo/demo.js` создаёт по одному экземпляру `MyContext` на сценарий, `attach` к своему блоку, вешает подписи и переключатель темы страницы. `index.html` получает контейнер для каждого сценария и `<link rel="stylesheet" href="./styles/mycontext.css">` перед `Demo/demo.css`, чтобы токены меню перекрывались стилями демо.

- [ ] **Step 5: Запустить тесты и убедиться, что проходят**

Run: `npx playwright test --project=chromium tests/e2e/demo.spec.js`
Expected: PASS.

- [ ] **Step 6: Запустить на всех движках**

Run: `npx playwright test --project=chromium --project=firefox --project=webkit tests/e2e/demo.spec.js`
Expected: PASS.

- [ ] **Step 7: Проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add index.html Demo/ tests/e2e/demo.spec.js
git commit -m "feat: демо со всеми сценариями проверки"
```

---

### Task 13: README и приёмка по критериям готовности

**Files:**
- Create: `README.md`
- Modify: `tests/e2e/acceptance.spec.js` (создаётся в этом задании)

**Interfaces:**
- Consumes: всё, что реализовано в Tasks 1–12
- Produces: `tests/e2e/acceptance.spec.js` — по одному тесту на каждый критерий из спеки, раздел 15; `README.md` с инструкцией по установке и использованию.

- [ ] **Step 1: Написать тесты приёмки**

`tests/e2e/acceptance.spec.js`, один тест на критерий:

- `критерий 1: в package.json нет поля dependencies и модуль импортируется без сборки` — первое проверяется через `JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))` из `node:fs/promises` и проверки `'dependencies' in pkg`; второе — `page.evaluate` с `import('/src/index.js')`
- `критерий 2: меню не выходит за границы вьюпорта ни в одной точке сетки` — сетка из `tests/unit/positioner.spec.js`, проверяется `getBoundingClientRect()` каждого открытого уровня
- `критерий 3: вложенное меню открывается без ложных закрытий при диагональном движении`
- `критерий 4: все три типа иконок работают, лейблы соосны независимо от наличия иконок`
- `критерий 5: меню полностью управляется с клавиатуры` — открытие выполняется программным `open({x, y})`, потому что `attach` слушает только `contextmenu` и клавиатурного способа вызвать его у API нет; после открытия сценарий не использует мышь: четыре уровня пройдены `ArrowRight` / `ArrowLeft`, пункт активирован `Enter`, выход четырьмя `Escape`
- `критерий 6: при reducedMotion: reduce меню видно сразу и не анимируется`
- `критерий 7: после destroy() в DOM не остаётся .vc-menu и контейнер не реагирует на правый клик`

- [ ] **Step 2: Запустить и убедиться, что тесты падают или проходят**

Run: `npx playwright test --project=chromium tests/e2e/acceptance.spec.js`
Expected: все PASS — реализация уже покрывает критерии. Любой FAIL означает пропуск в предыдущих задачах: чинится там, а не ослаблением теста.

- [ ] **Step 3: Написать `README.md`

Разделы: назначение; требования (браузеры с Popover API и Top Layer); установка (`npm install`, подключение `styles/mycontext.css`, импорт из `src/index.js`); пример использования с иконками, разделителем, отключённым пунктом и подменю; справочник API (`attach`, `detach`, `open`, `close`, `destroy`) с указанием, что `destroy` идемпотентен, а остальные методы после него бросают `Error`; таблица CSS-переменных; поддержка тем и `prefers-reduced-motion`; запуск тестов и демо.

- [ ] **Step 4: Прогнать полный набор на всех движках**

Run: `npm test`
Expected: PASS по всем проектам. Случайные провалы не допускаются: при нестабильности фиксируется источник и квантируется тест, а не увеличивается число ретраев.

- [ ] **Step 5: Проверить отсутствие рантайм-зависимостей**

Run: `node -e "const p=require('./package.json'); if (p.dependencies) { console.error('dependencies не должны существовать'); process.exit(1); } console.log('ok')"`
Expected: `ok`.

- [ ] **Step 6: Проверить типы и закоммитить**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add README.md tests/e2e/acceptance.spec.js
git commit -m "test: приёмочные тесты по критериям готовности, README"
```

---

## Порядок и зависимости

Задачи выполняются строго по номерам. Критические зависимости:

- Task 2 → Task 3, 5, 7 (константы)
- Task 4 → Task 6 (иконки)
- Task 6 → Task 7 (рендерер)
- Task 5 → Task 7 (темы)
- Task 7 → Task 8, 9, 10, 11 (Top Layer)
- Task 8 → Task 9 (клавиатура)
- Task 3 → Task 10 (hover intent)
- Task 9 → Task 10, 11, 12 (оркестратор)
- Task 1 → всё (инфраструктура)

## Проверка перед завершением

Полная приёмка считается пройденной, когда:

1. `npm test` зелёный на `unit`, `chromium`, `firefox`, `webkit`.
2. `npm run typecheck` зелёный при `strict: true` и `checkJs: true`.
3. `node -e "require('./package.json').dependencies"` даёт `undefined`.
4. Пять Review Focus-проверок присутствуют в тестах и проходят.
5. `git status` чист после последнего коммита.
