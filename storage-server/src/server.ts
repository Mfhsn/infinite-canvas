import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { handleDreamProxy } from './dream-proxy.js';
import { sendError } from './http.js';
import { HttpIntegrationClient } from './integration-client.js';
import { handleIntegrationRoutes, type IntegrationRuntime } from './integration-routes.js';
import { IntegrationSessionService, MemoryIntegrationSessionRepository } from './integration-session.js';
import { createMemoryRepositories } from './memory-repository.js';
import { createMysqlPool, createMysqlRepositories, MysqlIntegrationSessionRepository } from './mysql-repository.js';
import { handleApi, type RouteContext } from './routes.js';
import { serveStatic } from './static.js';
import { assertNamespace } from './validation.js';
import { HttpError } from './types.js';

export async function createStorageServer(ctx?: Partial<RouteContext>, options: { deferMysql?: boolean } = {}): Promise<http.Server> {
  const config = ctx?.config ?? loadConfig();
  assertNamespace(config.namespace);
  let repos = ctx?.repos;
  let integration = ctx?.integration;
  // Integration must initialize sessions and migrations before the port opens;
  // otherwise a permanent config/migration failure is hidden behind endless 503s.
  const deferMysql = Boolean(options.deferMysql && !config.integration.enabled);
  if (!repos && config.driver === 'mysql' && !deferMysql) {
    const pool = await createMysqlPool(config);
    const nextRepos = createMysqlRepositories(pool);
    const nextIntegration = config.integration?.enabled && !integration
      ? createIntegrationRuntime(config, new MysqlIntegrationSessionRepository(pool))
      : integration;
    repos = nextRepos;
    integration = nextIntegration;
  }
  if (!repos && config.driver === 'browser') repos = undefined;
  if (config.integration?.enabled && config.driver === 'browser' && !integration) {
    integration = createIntegrationRuntime(config, new MemoryIntegrationSessionRepository());
  }

  const routeContext: RouteContext = { config, repos, integration };
  const server = http.createServer(async (req, res) => {
    const originalUrl = req.url;
    try {
      // Reverse proxies may preserve the deployment prefix (for example
      // /canvas/api/...). API handlers are intentionally mounted at /api,
      // so normalize only the configured application prefix before routing.
      req.url = stripAppBasePath(req.url, config.appBasePath);
      if (await handleIntegrationRoutes(req, res, routeContext.integration, Boolean(config.integration?.enabled), config.maxDocumentBytes)) return;
      if (await handleDreamProxy(req, res, config.dreamProxy, Boolean(config.integration?.enabled), routeContext.integration?.sessions)) return;
      if (await handleApi(req, res, routeContext)) return;
      req.url = originalUrl;
      await serveStatic(req, res, config.staticDir, config.appBasePath);
    } catch (error) {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path.startsWith('/api/platform/') || path.startsWith('/api/storage/')) {
        console.error('[canvas-api] request failed', {
          method: req.method,
          path,
          status: error instanceof HttpError ? error.status : 500,
          code: error instanceof HttpError ? error.code : 'internal_error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      sendError(res, error);
    } finally {
      req.url = originalUrl;
    }
  });
  if (config.driver === 'mysql' && deferMysql && !repos) void initializeMysqlInBackground(config, routeContext);
  return server;
}

function stripAppBasePath(requestUrl: string | undefined, appBasePath: string): string | undefined {
  if (!requestUrl || !appBasePath || appBasePath === '/') return requestUrl;
  const base = appBasePath.endsWith('/') ? appBasePath.slice(0, -1) : appBasePath;
  const url = new URL(requestUrl, 'http://localhost');
  if (url.pathname === base) url.pathname = '/';
  else if (url.pathname.startsWith(`${base}/`)) url.pathname = url.pathname.slice(base.length) || '/';
  else return requestUrl;
  return `${url.pathname}${url.search}`;
}

export async function start(): Promise<void> {
  const config = loadConfig();
  // Non-Integration mode may listen before remote MySQL is ready. Integration
  // mode is fail-fast so session/migration failures never expose a half-ready app.
  const server = await createStorageServer({ config }, { deferMysql: true });
  server.listen(config.port, () => {
    console.log(`Storage server listening on http://0.0.0.0:${config.port} (${config.driver})`);
  });
}

async function initializeMysqlInBackground(config: ReturnType<typeof loadConfig>, context: RouteContext): Promise<void> {
  while (!context.repos) {
    let pool: Awaited<ReturnType<typeof createMysqlPool>> | undefined;
    try {
      pool = await createMysqlPool(config);
      const repos = createMysqlRepositories(pool);
      const integration = config.integration.enabled
        ? createIntegrationRuntime(config, new MysqlIntegrationSessionRepository(pool))
        : context.integration;
      Object.assign(context, { repos, integration });
      console.log(`MySQL storage ready at ${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`);
    } catch (error) {
      if (pool) await pool.end().catch(() => undefined);
      console.error('MySQL storage initialization failed; retrying', error);
      await new Promise((resolve) => setTimeout(resolve, config.mysql.connectRetryMs));
    }
  }
}

function createIntegrationRuntime(
  config: ReturnType<typeof loadConfig>,
  repository: ConstructorParameters<typeof IntegrationSessionService>[1],
): IntegrationRuntime {
  if (!config.integration.baseUrl) throw new Error('INTEGRATION_BASE_URL is required when Integration is enabled');
  const sessions = new IntegrationSessionService(config.integration, repository);
  return { config: config.integration, sessions, client: new HttpIntegrationClient(config.integration) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { createMemoryRepositories } from './memory-repository.js';
export { MemoryIntegrationSessionRepository, IntegrationSessionService } from './integration-session.js';
export { loadConfig } from './config.js';
