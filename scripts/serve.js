import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_PORT = 4173;
const HOST = '127.0.0.1';

/**
 * Тип с `undefined` в значении, а не просто `Record<string, string>`: без него
 * поиск по таблице типизирован как `string`, и guard ниже читается как проверка
 * невозможного условия — то есть как мёртвый код, который следующий читатель
 * снесёт. `noUncheckedIndexedAccess` дал бы тот же смысл, но это флаг строгости
 * для всей программы, а здесь достаточно одного типа.
 *
 * @type {Record<string, string | undefined>}
 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/**
 * Раздаваемые части репозитория.
 *
 * **Белый список, а не «внутри корня — значит можно».** Демо-сервер поднимают и
 * человек, и e2e, и корень репозитория — это исходники библиотеки вместе со всем
 * прочим: `.git/`, `package.json`, конфигурация Playwright, планы. Ни одному из них
 * на демо-странице не место, и отдавать их по HTTP нельзя.
 *
 * Отдельного правила на точечные имена не нужно: `.git` и `.codegraph` в списке не
 * стоят, и скрытый каталог внутри `src/` или `styles/` тоже не откроется — но
 * скрытый файл внутри раздаваемого каталога откроется, поэтому точки проверяются
 * на каждом сегменте пути, а не только на первом.
 *
 * @type {ReadonlySet<string>}
 */
const SERVED_ENTRIES = new Set(['index.html', 'Demo', 'src', 'styles']);

/**
 * Методы, которыми сервер что-то отдаёт, в виде заголовка `Allow`.
 *
 * Отдельная константа, потому что из неё берётся и заголовок ответа, и проверка
 * метода запроса, а перечислять «GET, HEAD» в двух местах значило бы получить
 * ответ, который обещает одно, а проверяет другое.
 */
const ALLOWED_METHODS = 'GET, HEAD';

/**
 * Ответ «путь ведёт из раздаваемой части».
 *
 * Отдельное значение, а не `null`: снаружи попытка обхода и промах по имени
 * неразличимы, и сводить их к одному ответу значило бы врать — промах должен
 * отвечать `404`, а обход — `403`.
 */
const FORBIDDEN = Symbol('forbidden');

/**
 * Отбивка ответа с перечнем методов.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} body
 * @returns {void}
 */
function refuse(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    allow: ALLOWED_METHODS,
  });
  res.end(body);
}

/**
 * Преобразует URL запроса в путь отдаваемого файла.
 *
 * `null` означает «такого файла у сервера нет», а `FORBIDDEN` — «путь ведёт из
 * раздаваемой части». Ответы разные, и различать их приходится здесь: попытка
 * выйти из корня и запрос несуществующего файла выглядят снаружи одинаково, но
 * первое — попытка, а второе — обычный промах.
 *
 * @param {string | undefined} url
 * @returns {string | null | typeof FORBIDDEN}
 */
function resolveFilePath(url) {
  if (url === undefined) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, `http://${HOST}`).pathname);
  } catch {
    return null;
  }
  const segments = pathname.split('/').filter((segment) => {
    return segment !== '' && segment !== '.';
  });
  // `..` остаётся в разобранном пути только там, где вышел из корня уйти некуда:
  // нормализатор URL выкидывает `..` над корнем, а `%2f` в percent-форме
  // раскрывается уже после нормализации. Такой сегмент — ровно то, чем полезен
  // обход, и ответ на него — запрет, а не «нет такого файла».
  if (segments.some((segment) => {
    return segment === '..';
  })) {
    return FORBIDDEN;
  }
  if (segments.length === 0) {
    return join(ROOT, 'index.html');
  }
  const [head, ...rest] = segments;
  if (head === undefined || !SERVED_ENTRIES.has(head)) return null;
  if (rest.some((segment) => {
    return segment.startsWith('.');
  })) {
    return null;
  }
  const filePath = resolve(join(ROOT, segments.join('/')));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) return FORBIDDEN;
  // Каталог отдаётся своей страницей: `/Demo/` и `/Demo` должны означать одно и
  // то же, иначе ссылка на каталог отвечала бы 404 там, где файл есть.
  return isDirectory(filePath) ? join(filePath, 'index.html') : filePath;
}

/**
 * Разбирает порт из переменной окружения.
 * Завершает процесс с кодом 1, если значение не является портом.
 *
 * @param {string | undefined} value
 * @returns {number}
 */
function resolvePort(value) {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  process.stderr.write(`Некорректное значение PORT: ${value}\n`);
  process.exit(1);
}

const PORT = resolvePort(process.env.PORT);

/**
 * `false`, если путь недоступен или не является обычным файлом.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * `true`, если путь указывает на каталог.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isDirectory(filePath) {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Отвечает `204` на `OPTIONS`, `405` на нераздаваемый метод, `403` за пределами
 * раздаваемого, `404` для неизвестного пути, иначе отдаёт файл.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {void}
 */
function handleRequest(req, res) {
  // Метод разбирается раньше пути: запрос, который ничего не читает, должен быть
  // отвергнут одинаково и на существующем файле, и на несуществующем, а ответ с
  // телом страницы на `POST /` выдавал бы сервер, который вообще ничего не пишет.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { allow: ALLOWED_METHODS });
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    refuse(res, 405, 'Method Not Allowed');
    return;
  }
  const filePath = resolveFilePath(req.url);
  if (filePath === FORBIDDEN) {
    refuse(res, 403, 'Forbidden');
    return;
  }
  if (filePath === null) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const type = MIME_TYPES[extname(filePath).toLowerCase()];
  if (type === undefined || !isFile(filePath)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    res.destroy();
  });
  stream.pipe(res);
}

const server = createServer(handleRequest);

server.on('error', (error) => {
  // `error` приходит и после `listen`: система может отказать в сокете на приёме
  // соединения, и это не сбой запуска — сервер в этот момент работает. Различать
  // надо по состоянию сервера, а не по формулировке: убивать работающий сервер
  // из-за отказа на одном соединении нельзя.
  if (server.listening) {
    process.stderr.write(`Сервер на ${HOST}:${PORT} — ошибка соединения: ${error.message}\n`);
    return;
  }
  process.stderr.write(`Не удалось запустить сервер на ${HOST}:${PORT} — ${error.message}\n`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`MyContext demo: http://${HOST}:${PORT}\n`);
});

process.on('SIGINT', () => {
  // close() не трогает соединения с запросом в полёте — они держат процесс до
  // headersTimeout; closeAllConnections() рвёт их, поэтому Ctrl-C не ждёт.
  server.closeAllConnections();
  server.close(() => {
    process.exit(0);
  });
});
