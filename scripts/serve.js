import { createReadStream, existsSync, statSync } from 'node:fs';
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
 * Соседний чекаут `Pielet` — второй корень раздачи под префиксом `/pielet/`.
 *
 * Нужен сквозным тестам контракта: единственная проверка «Pielet в режиме
 * удержания открывает MyContext в режиме удержания» требует оба пакета в одном
 * браузере, а зависимостью `Pielet` быть не может — пакеты независимы, и
 * добавление одной в `dependencies` второго связало бы их навсегда.
 *
 * Ветка включается **только если рядом есть чекаут**. Без него `/pielet/...`
 * отдаёт 404, а сквозной тест честно пропускается, так что в CI с одним
 * репозиторием ничего не ломается.
 */
const SIBLING = resolve(ROOT, '..', 'Pielet');
const SIBLING_PREFIX = '/pielet/';
const SIBLING_MOUNTED = existsSync(resolve(SIBLING, 'src', 'index.js'));

/**
 * Преобразует URL запроса в путь внутри репозитория.
 * Возвращает `null`, если путь выходит за пределы корня или URL не разбирается.
 *
 * @param {string | undefined} url
 * @returns {string | null}
 */
function resolveFilePath(url) {
  if (url === undefined) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, `http://${HOST}`).pathname);
  } catch {
    return null;
  }
  if (SIBLING_MOUNTED && pathname.startsWith(SIBLING_PREFIX)) {
    return resolveSibling(pathname.slice(SIBLING_PREFIX.length));
  }
  const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const filePath = resolve(join(ROOT, relative));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) return null;
  return filePath;
}

/**
 * Путь внутри соседнего чекаута либо `null`, если он оттуда вышел.
 *
 * Проверка та же, что у своего корня: второй корень не должен стать путём на
 * весь диск.
 *
 * @param {string} pathname путь после префикса `/pielet/`.
 * @returns {string | null}
 */
function resolveSibling(pathname) {
  const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const filePath = resolve(join(SIBLING, relative));
  if (filePath !== SIBLING && !filePath.startsWith(SIBLING + sep)) return null;
  return filePath;
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
 * Отвечает `403` за пределами корня, `404` для неизвестного пути, иначе отдаёт файл.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {void}
 */
function handleRequest(req, res) {
  const filePath = resolveFilePath(req.url);
  if (filePath === null) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
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
