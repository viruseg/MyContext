/// <reference types="node" />
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT ?? 4173);
const HOST = '127.0.0.1';

/** @type {Record<string, string>} */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

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
  const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const filePath = resolve(join(ROOT, relative));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) return null;
  return filePath;
}

/**
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

server.listen(PORT, HOST, () => {
  process.stdout.write(`MyContext demo: http://${HOST}:${PORT}\n`);
});

process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});
