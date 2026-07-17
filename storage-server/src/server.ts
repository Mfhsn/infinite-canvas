import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { handleDreamProxy } from './dream-proxy.js';
import { sendError } from './http.js';
import { createMemoryRepositories } from './memory-repository.js';
import { createMysqlPool, createMysqlRepositories } from './mysql-repository.js';
import { handleApi, type RouteContext } from './routes.js';
import { serveStatic } from './static.js';
import { assertNamespace } from './validation.js';

export async function createStorageServer(ctx?: Partial<RouteContext>): Promise<http.Server> {
  const config = ctx?.config ?? loadConfig();
  assertNamespace(config.namespace);
  let repos = ctx?.repos;
  if (!repos && config.driver === 'mysql') {
    const pool = await createMysqlPool(config);
    repos = createMysqlRepositories(pool);
  }
  if (!repos && config.driver === 'browser') repos = undefined;

  const routeContext: RouteContext = { config, repos };
  return http.createServer(async (req, res) => {
    try {
      if (await handleDreamProxy(req, res, config.dreamProxy)) return;
      if (await handleApi(req, res, routeContext)) return;
      await serveStatic(req, res, config.staticDir);
    } catch (error) {
      sendError(res, error);
    }
  });
}

export async function start(): Promise<void> {
  const config = loadConfig();
  const server = await createStorageServer({ config });
  server.listen(config.port, () => {
    console.log(`Storage server listening on http://0.0.0.0:${config.port} (${config.driver})`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { createMemoryRepositories } from './memory-repository.js';
export { loadConfig } from './config.js';
