import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PORT = 4319;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * @typedef {object} Probe
 * @property {(path: string, init?: RequestInit) => Promise<{ status: number, allow: string | null, body: string }>}
 *   ask ответ сервера одним запросом.
 * @property {() => Promise<void>} stop остановить сервер.
 */

/**
 * Поднимает `scripts/serve.js` на отдельном порту и ждёт готовности.
 *
 * Отдельный порт — обязателен: конфигурация Playwright поднимает свой сервер, и
 * кейс, ударивший в тот же, проверял бы чужой процесс вместо проверяемого.
 *
 * @returns {Promise<Probe>}
 */
async function startServer() {
  const child = spawn(process.execPath, ['scripts/serve.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ready = false;
  child.stdout.on('data', (chunk) => {
    if (String(chunk).includes('demo:')) {
      ready = true;
    }
  });

  const deadline = Date.now() + 10000;
  while (!ready && Date.now() < deadline) {
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  if (!ready) {
    child.kill();
    throw new Error('сервер не поднялся за 10 с');
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
    async stop() {
      child.kill();
      // `SIGTERM` на Windows доставляется как принудительное завершение, и
      // ждать выхода не нужно: процесс уже не держит порт.
    },
  };
}

test.describe('раздача скриптом scripts/serve.js', () => {
  /** @type {Probe} */
  let server;

  test.beforeEach(async () => {
    server = await startServer();
  });

  test.afterEach(async () => {
    await server.stop();
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