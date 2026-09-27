import { expect, test } from '@playwright/test';

// Модуль подгружается динамическим импортом прямо в странице, и спецификатор
// `../../src/icons.js` обслуживает обе среды: в браузере от
// `http://127.0.0.1:4173/index.html` он схлопывается до `/src/icons.js` — корень
// сервера, — а TypeScript разрешает его от файла теста. Поэтому типы импорта
// берутся из исходника, без приведений.

/**
 * @typedef {import('../../src/icons.js').IconConfig} IconConfig
 */

// Белый список `src/icons.js` без корневого `svg`, разбитый на две части: первые
// шесть имён проверяет кейс из брифа, остальные десять — следующий.
const REST_OF_ALLOWLIST = [
  'clipPath',
  'ellipse',
  'line',
  'mask',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'stop',
  'title',
];

// Кадр 1×1 в data-URI: белый список протоколов включает `data:image/…`, поэтому
// такой адрес проверяется без сетевого запроса.
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

// Три адреса из белого списка протоколов растра. Два сетевых отдаются заглушкой
// ниже: кейс проверяет установку `src`, а не загрузку картинки.
const RASTER_ROUTE = '**/icon.png';
const ALLOWED_SOURCES = ['https://cdn.example.com/icon.png', '/icon.png', PIXEL];

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

test.describe('эмодзи', () => {
  test('span с текстом-символом, классом vc-icon и aria-hidden', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      const el = renderIcon({ type: 'emoji', value: '📄' });
      return {
        tag: el.tagName,
        className: el.getAttribute('class'),
        ariaHidden: el.getAttribute('aria-hidden'),
        text: el.textContent,
      };
    });

    expect(result).toEqual({
      tag: 'SPAN',
      className: 'vc-icon',
      ariaHidden: 'true',
      text: '📄',
    });
  });

  test('aria-hidden присутствует, чтобы не дублировать озвучку лейбла', async ({ page }) => {
    const ariaHidden = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      return renderIcon({ type: 'emoji', value: '📁' }).getAttribute('aria-hidden');
    });

    // Озвучка пункта идёт по его лейблу, поэтому иконка не должна попадать в
    // дерево доступности повторно.
    expect(ariaHidden).toBe('true');
  });
});

test.describe('svg', () => {
  test('разбирается в inline-узел с одним path и шириной 100%', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      // Разметка без `xmlns` не попала бы в SVG-пространство имён и в
      // HTML-документе не отрисовалась бы, поэтому все фикстуры объявляют
      // namespace явно.
      const el = renderIcon({
        type: 'svg',
        value: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
          + '<path d="M2 2h12v12H2z" fill="currentColor"/></svg>',
      });
      return {
        tag: el.tagName,
        width: el.getAttribute('width'),
        height: el.getAttribute('height'),
        viewBox: el.getAttribute('viewBox'),
        paths: el.querySelectorAll('path').length,
      };
    });

    expect(result).toEqual({
      tag: 'svg',
      width: '100%',
      height: '100%',
      viewBox: '0 0 16 16',
      paths: 1,
    });
  });

  test('получает aria-hidden=true и focusable=false', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      // Авторские значения противоречат требуемым, поэтому атрибуты выставляются
      // принудительно: кейс проверяет замену, а не отсутствие.
      const el = renderIcon({
        type: 'svg',
        value: '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="false" focusable="true"'
          + ' width="10" height="10"><path d="M0 0h1v1H0z"/></svg>',
      });
      return {
        ariaHidden: el.getAttribute('aria-hidden'),
        focusable: el.getAttribute('focusable'),
      };
    });

    expect(result).toEqual({ ariaHidden: 'true', focusable: 'false' });
  });

  test('санитизация вырезает script целиком', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      const el = renderIcon({
        type: 'svg',
        value: '<svg xmlns="http://www.w3.org/2000/svg">'
          + '<script>document.documentElement.setAttribute("data-vc-icon-script-ran", "true")</script>'
          + '<path d="M0 0h16v16H0z"/></svg>',
      });
      return {
        scripts: el.querySelectorAll('script').length,
        paths: el.querySelectorAll('path').length,
        // Скрипт не исполняется ни при разборе `DOMParser`, ни при вставке
        // разобранного узла, поэтому метка ловит момент, когда модуль начнёт
        // вставлять разметку в живой документ. Проверка на два порядка слабее
        // проверки на отсутствие элемента, но стоит рядом с ней бесплатно.
        ran: document.documentElement.hasAttribute('data-vc-icon-script-ran'),
      };
    });

    // Соседний path пережил: обход чистит дерево, а не вырезает корень целиком.
    expect(result).toEqual({ scripts: 0, paths: 1, ran: false });
  });

  test('санитизация вырезает foreignObject и iframe', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      const el = renderIcon({
        type: 'svg',
        value: '<svg xmlns="http://www.w3.org/2000/svg">'
          + '<foreignObject width="16" height="16">'
          + '<body xmlns="http://www.w3.org/1999/xhtml">'
          // Разрешённый circle внутри вырезанного контейнера: если бы обход
          // удалял элемент без потомков, circle уцелел бы и кейс упал.
          + '<circle cx="1" cy="1" r="1"/>'
          + '<iframe src="about:blank"></iframe>'
          + '<p>текст</p>'
          + '</body></foreignObject>'
          + '<path d="M0 0h16v16H0z"/></svg>',
      });
      return {
        foreignObjects: el.querySelectorAll('foreignObject').length,
        iframes: el.querySelectorAll('iframe').length,
        paragraphs: el.querySelectorAll('p').length,
        circles: el.querySelectorAll('circle').length,
        paths: el.querySelectorAll('path').length,
      };
    });

    expect(result).toEqual({
      foreignObjects: 0,
      iframes: 0,
      paragraphs: 0,
      circles: 0,
      paths: 1,
    });
  });

  test('санитизация вырезает обработчики on* со всех элементов', async ({ page }) => {
    const perElement = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      const el = renderIcon({
        type: 'svg',
        value: '<svg xmlns="http://www.w3.org/2000/svg" onload="globalThis.__vc = 1">'
          + '<g onclick="globalThis.__vc = 2" ONFOCUS="globalThis.__vc = 3" id="layer">'
          + '<path d="M0 0h16v16H0z" fill="currentColor" onmouseover="globalThis.__vc = 4"/>'
          + '</g></svg>',
      });
      // `querySelectorAll('*')` не берёт сам корень, а обработчик висел в том числе
      // на нём, поэтому список начинается с `el`.
      return [el, ...el.querySelectorAll('*')].map((node) => {
        return Array.from(node.attributes, (attribute) => attribute.name);
      });
    });

    const names = perElement.flat();
    // `ONFOCUS` в XML-разборе сохраняет регистр и в HTML-документе обработчиком не
    // стал бы, но вырезается вместе с остальными: цена нулевая.
    expect(names.filter((name) => name.toLowerCase().startsWith('on'))).toEqual([]);
    // Санитизация трогает только обработчики и ссылки: `xmlns`, геометрия, заливка
    // и принудительные атрибуты корня целы, ничего лишнего не добавлено.
    expect(names.sort()).toEqual([
      'aria-hidden',
      'd',
      'fill',
      'focusable',
      'height',
      'id',
      'width',
      'xmlns',
    ]);
  });

  test('санитизация вырезает href со схемой javascript:', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      const el = renderIcon({
        type: 'svg',
        value: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
          + '<use href="javascript:alert(1)"/>'
          + '<use xlink:href="javascript:alert(1)"/>'
          // Браузер вырезает табы из URL, поэтому `java&#9;script:` исполняется так
          // же, как `javascript:`: проверяется нормализация схемы, а не префикс.
          + '<use href="java&#9;script:alert(1)"/>'
          + '<use id="legit" href="#legit"/>'
          + '</svg>',
      });
      const uses = Array.from(el.querySelectorAll('use'));
      return {
        uses: uses.length,
        javascriptLinks: uses.filter((use) => {
          return ['href', 'xlink:href'].some((name) => (use.getAttribute(name) ?? '').includes('script'));
        }).length,
        keptHref: uses[3].getAttribute('href'),
        keptXlink: uses[3].getAttribute('xlink:href'),
      };
    });

    // Сами `use` остаются — элемент разрешён белым списком, — а ссылки вычищаются.
    expect(result).toEqual({
      uses: 4,
      javascriptLinks: 0,
      keptHref: '#legit',
      keptXlink: null,
    });
  });

  test('санитизация сохраняет элементы из белого списка (path, circle, g, defs, use, linearGradient)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      const el = renderIcon({
        type: 'svg',
        value: '<svg xmlns="http://www.w3.org/2000/svg">'
          + '<defs><linearGradient id="grad">'
          + '<stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/>'
          + '</linearGradient></defs>'
          + '<g id="layer"><path d="M0 0h16v16H0z"/><circle cx="8" cy="8" r="4"/></g>'
          + '<use href="#layer"/>'
          + '</svg>',
      });
      return {
        path: el.querySelectorAll('path').length,
        circle: el.querySelectorAll('circle').length,
        g: el.querySelectorAll('g').length,
        defs: el.querySelectorAll('defs').length,
        use: el.querySelectorAll('use').length,
        linearGradient: el.querySelectorAll('linearGradient').length,
        stops: el.querySelectorAll('stop').length,
      };
    });

    expect(result).toEqual({
      path: 1,
      circle: 1,
      g: 1,
      defs: 1,
      use: 1,
      linearGradient: 1,
      stops: 2,
    });
  });

  test('остальные элементы белого списка тоже сохраняются', async ({ page }) => {
    const found = await page.evaluate(async (names) => {
      const { renderIcon } = await import('../../src/icons.js');
      const el = renderIcon({
        type: 'svg',
        value: '<svg xmlns="http://www.w3.org/2000/svg">'
          + '<defs>'
          + '<clipPath id="clip"><rect x="0" y="0" width="8" height="8"/></clipPath>'
          + '<mask id="mask"><circle cx="4" cy="4" r="4"/></mask>'
          + '<radialGradient id="radial"><stop offset="0" stop-color="red"/></radialGradient>'
          + '</defs>'
          + '<title>иконка</title>'
          + '<ellipse cx="4" cy="4" rx="4" ry="2"/>'
          + '<rect x="0" y="0" width="8" height="8"/>'
          + '<line x1="0" y1="0" x2="8" y2="8"/>'
          + '<polyline points="0,0 4,4"/>'
          + '<polygon points="0,0 4,0 4,4"/>'
          + '</svg>',
      });
      return names.filter((name) => el.querySelectorAll(name).length > 0);
    }, REST_OF_ALLOWLIST);

    // Имена написаны так же, как в белом списке модуля: списки совпадают по
    // регистру, и опечатка в любом из них уронила бы кейс.
    expect(found).toEqual(REST_OF_ALLOWLIST);
  });

  test('нераспознанная строка бросает Error из sanitizeSvg', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { sanitizeSvg } = await import('../../src/icons.js');
      try {
        sanitizeSvg('это не разметка');
        return { thrown: false, name: 'нет' };
      } catch (error) {
        return { thrown: true, name: error instanceof Error ? error.name : typeof error };
      }
    });

    expect(result).toEqual({ thrown: true, name: 'Error' });
  });

  test('корень не из svg бросает Error', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { sanitizeSvg } = await import('../../src/icons.js');
      try {
        // Разбирается без единой ошибки, но корнем оказывается не svg: проверка
        // на разбор и проверка на корень — разные ветки.
        sanitizeSvg('<div><path d="M0 0h1v1H0z"/></div>');
        return { thrown: false, name: 'нет' };
      } catch (error) {
        return { thrown: true, name: error instanceof Error ? error.name : typeof error };
      }
    });

    expect(result).toEqual({ thrown: true, name: 'Error' });
  });

  test('разметка без xmlns не считается корневым svg', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { sanitizeSvg } = await import('../../src/icons.js');
      try {
        // Без `xmlns` элемент не попадает в SVG-пространство имён и в
        // HTML-документе не отрисовался бы, поэтому корнем считаться не может.
        sanitizeSvg('<svg viewBox="0 0 16 16"><path d="M0 0h1v1H0z"/></svg>');
        return { thrown: false, name: 'нет' };
      } catch (error) {
        return { thrown: true, name: error instanceof Error ? error.name : typeof error };
      }
    });

    expect(result).toEqual({ thrown: true, name: 'Error' });
  });
});

test.describe('растр', () => {
  test('img с src, обязательным alt и draggable=false', async ({ page }) => {
    await page.route(RASTER_ROUTE, (route) => {
      return route.fulfill({ contentType: 'image/png', body: '' });
    });
    const rendered = await page.evaluate(async (sources) => {
      const { renderIcon } = await import('../../src/icons.js');
      return sources.map((source) => {
        const el = renderIcon({ type: 'raster', value: source, alt: 'Файл' });
        return {
          tag: el.tagName,
          className: el.getAttribute('class'),
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt'),
          draggable: el.getAttribute('draggable'),
          decoding: el.getAttribute('decoding'),
        };
      });
    }, ALLOWED_SOURCES);

    for (const [index, source] of ALLOWED_SOURCES.entries()) {
      expect(rendered[index], `источник ${source}`).toEqual({
        tag: 'IMG',
        className: 'vc-icon',
        src: source,
        alt: 'Файл',
        draggable: 'false',
        decoding: 'async',
      });
    }
  });

  test('без alt использует пустую строку, а не падает', async ({ page }) => {
    const result = await page.evaluate(async (source) => {
      const { renderIcon } = await import('../../src/icons.js');
      // Конфигурация вне контракта: `alt` обязателен по типам, и его отверг бы
      // валидатор. Кейс проверяет защитную ветку рендерера, поэтому тип снимается
      // приведением через `unknown`.
      const config = /** @type {IconConfig} */ (/** @type {unknown} */ ({ type: 'raster', value: source }));
      const el = renderIcon(config);
      return { tag: el.tagName, alt: el.getAttribute('alt'), src: el.getAttribute('src') };
    }, PIXEL);

    expect(result).toEqual({ tag: 'IMG', alt: '', src: PIXEL });
  });

  test('src со схемой javascript: отбрасывается, элемент создаётся без src', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      const el = renderIcon({ type: 'raster', value: 'javascript:alert(1)', alt: 'Взлом' });
      return { tag: el.tagName, src: el.getAttribute('src'), alt: el.getAttribute('alt') };
    });

    // Элемент остаётся картинкой с обязательным alt: теряется только адрес.
    expect(result).toEqual({ tag: 'IMG', src: null, alt: 'Взлом' });
  });

  test('data:text/html отбрасывается так же, как javascript:', async ({ page }) => {
    const src = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      return renderIcon({
        type: 'raster',
        value: 'data:text/html,<b>не картинка</b>',
        alt: 'Взлом',
      }).getAttribute('src');
    });

    // Протокол `data:` разрешён не весь, а только носители `image/…`.
    expect(src).toBe(null);
  });
});

test.describe('renderIcon', () => {
  test('нераспознанный тип иконки не бросает, а отдаёт пустой span.vc-icon-slot', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      // Тип вне контракта: валидатор конфигурации отверг бы его раньше, но меню
      // показывается уже сейчас, поэтому ветка обязана быть защитной.
      const config = /** @type {IconConfig} */ (/** @type {unknown} */ ({ type: 'спрайт', value: 'x' }));
      const el = renderIcon(config);
      return { tag: el.tagName, className: el.getAttribute('class'), html: el.outerHTML };
    });

    // Класс слота, а не `vc-icon`: о типе иконки неизвестно ничего, кроме того
    // что это не строка и не разметка.
    expect(result).toEqual({
      tag: 'SPAN',
      className: 'vc-icon-slot',
      html: '<span class="vc-icon-slot"></span>',
    });
  });

  test('нераспознанный SVG не бросает, а даёт пустой слот и одно предупреждение', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { renderIcon } = await import('../../src/icons.js');
      /** @type {string[]} */
      const warnings = [];
      const original = console.warn;
      console.warn = (message) => {
        warnings.push(String(message));
      };
      try {
        // Слой иконок не имеет права ронять меню из-за битой разметки.
        const el = renderIcon({ type: 'svg', value: 'это не разметка' });
        return {
          tag: el.tagName,
          className: el.getAttribute('class'),
          warnings: warnings.length,
        };
      } finally {
        console.warn = original;
      }
    });

    // Тип иконки известен, сломан только её вид, поэтому место под иконку
    // остаётся: класс `vc-icon`, а не `vc-icon-slot`.
    expect(result).toEqual({ tag: 'SPAN', className: 'vc-icon', warnings: 1 });
  });
});
