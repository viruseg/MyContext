import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..', '..');
// Порт по индексу воркера: `beforeAll` выполняется в каждом воркере, и на общий
// порт вторая копия встала бы с `EADDRINUSE` и ждала бы готовности, которой не
// будет, — файл падал бы по таймауту хука, а не по существу кейса.
const PORT = 4319 + Number(process.env.TEST_WORKER_INDEX ?? 0);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * @typedef {object} Probe
 * @property {(path: string, init?: RequestInit) => Promise<{ status: number, allow: string | null, body: string }>}
 *   ask ответ сервера одним запросом.
 * @property {() => void} stop остановить сервер.
 */

/**
 * Поднимает `scripts/serve.js` на отдельном порту и ждёт готовности.
 *
 * Отдельный порт — обязателен: конфигурация Playwright поднимает свой сервер, и
 * кейс, ударивший в тот же, проверял бы чужой процесс вместо проверяемого.
 *
 * Один сервер на весь файл, а не на каждый кейс: подъём `node` под нагрузкой
 * занимает дольше самих запросов, и шесть подъёмов подряд превращали файл в
 * гонку за портом и время старта.
 *
 * @returns {Promise<Probe>}
 */
async function startServer() {
  const child = spawn(process.execPath, ['scripts/serve.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  /** @type {string} */
  let noise = '';
  child.stderr.on('data', (chunk) => {
    noise += String(chunk);
  });
  // `node` печатает стартовую строку до того, как начнёт принимать соединения, поэтому
  // одного признака мало: ждать надо первого успешного запроса.
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const probe = await fetch(`${ORIGIN}/index.html`);
      await probe.text();
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill();
        throw new Error(`сервер на порту ${PORT} не поднялся за 30 с. Его вывод: ${noise}`);
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }

  return {
    async ask(path, init) {
      const response = await fetch(`${ORIGIN}${path}`, init);
      return {
        status: response.status,
        allow: response.headers.get('allow'),
        body: await response.text(),
      };
    },
    stop() {
      child.kill();
      // `SIGTERM` на Windows доставляется как принудительное завершение, и ждать
      // выхода не нужно: процесс уже не держит порт.
    },
  };
}

test.describe('раздача скриптом scripts/serve.js', () => {
  /** @type {Probe} */
  let server;

  test.beforeAll(async () => {
    server = await startServer();
  });

test.afterAll(() => {
  // Сервер мог и не подняться: тогда `beforeAll` упал, и гасить нечего. Падение
  // подъёма сообщает о себе само, а этот крючок не должен перебивать его своим.
  if (server !== undefined) {
    server.stop();
  }
});

  test('отдаёт корень, модуль и стили', async () => {
    for (const path of ['/', '/src/index.js', '/styles/mycontext.css']) {
      const answer = await server.ask(path);
      expect(answer.status, `путь ${path} отдан`).toBe(200);
      expect(answer.body.length, `путь ${path} непуст`).toBeGreaterThan(0);
    }
  });

  test('не отдаёт скрытые файлы даже с раздаваемым расширением', async () => {
    // Проверка на настоящем файле, а не на том, что у `.git/HEAD` нет расширения
    // из таблицы типов: сегодня их отсекает именно это совпадение, и правило
    // держится на составе таблицы, а не на запрете отдавать скрытое.
    //
    // Фикстуры лежат внутри `src/` — то есть внутри раздаваемой части, где до
    // запрета на точечные имена дело доходит только на втором сегменте пути.
    // Контрольный файл отличается от запрещённого лишь точкой в имени и обязан
    // обслуживаться: без него «404» ничего не сказало бы, так отвечает и
    // несуществующий путь.
    const hidden = resolve(ROOT, 'src', '.serve-hidden-fixture.js');
    const visible = resolve(ROOT, 'src', 'serve-visible-fixture.js');
    writeFileSync(hidden, 'export const hidden = 1;\n');
    writeFileSync(visible, 'export const visible = 1;\n');
    try {
      const hiddenAnswer = await server.ask('/src/.serve-hidden-fixture.js');
      expect(hiddenAnswer.status, 'файл под точечным именем не отдан').toBe(404);
      expect(hiddenAnswer.body.includes('hidden = 1'), 'содержимое не утекло').toBe(false);

      expect((await server.ask('/src/serve-visible-fixture.js')).status, 'обычный файл отдан').toBe(200);
    } finally {
      rmSync(hidden, { force: true });
      rmSync(visible, { force: true });
    }
  });

  test('не отдаёт метаданные репозитория', async () => {
    for (const path of ['/.git/HEAD', '/.gitignore', '/package.json', '/playwright.config.js']) {
      const answer = await server.ask(path);
      expect(answer.status, `путь ${path} не отдан`).toBe(404);
    }
  });

  test('отвечает 405 на методы, которых сервер не раздаёт', async () => {
    // Сервер отдаёт только файлы, и запрос, который ничего не читает, обязан быть
    // отвергнут с перечнем допустимого, а не отдан телом страницы.
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const answer = await server.ask('/', { method });
      expect(answer.status, `метод ${method} отвергнут`).toBe(405);
      expect(answer.allow, `в ${answer.allow} назван ${method} или он не назван`).toContain('GET');
      expect(answer.allow, 'HEAD назван').toContain('HEAD');
      expect(answer.body.includes('<!doctype'), `метод ${method} не отдал тело страницы`).toBe(false);
    }
  });

  test('OPTIONS отвечает пустым с перечнем методов', async () => {
    const answer = await server.ask('/', { method: 'OPTIONS' });
    expect(answer.status, 'OPTIONS отвечает 204').toBe(204);
    expect(answer.body, 'тела нет').toBe('');
    expect(answer.allow, 'методы названы').toContain('GET');
  });

  test('не выпускает путь за пределы корня', async () => {
    expect((await server.ask('/..%2f..%2f..%2fWindows%2fwin.ini')).status).toBe(403);
    expect((await server.ask('/%2e%2e/%2e%2e/Windows/win.ini')).status).toBe(404);
  });

  test('неизвестный путь отвечает 404', async () => {
    expect((await server.ask('/nope.js')).status).toBe(404);
  });
});