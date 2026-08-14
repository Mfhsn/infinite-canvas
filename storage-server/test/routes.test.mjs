import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMemoryRepositories, createStorageServer, loadConfig } from '../dist/server.js';
import { dreamMediaRequestHeaders } from '../dist/dream-proxy.js';
import { HttpIntegrationClient, parsePlatformContext } from '../dist/integration-client.js';
import { deriveStorageNamespace, IntegrationSessionService, MemoryIntegrationSessionRepository } from '../dist/integration-session.js';
import { HttpError } from '../dist/types.js';

async function withServer(config, repos, fn, integration) {
  const server = await createStorageServer({ config, repos, integration });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function baseConfig(overrides = {}) {
  return {
    driver: 'mysql',
    namespace: 'test_ns',
    port: 0,
    staticDir: process.cwd(),
    appBasePath: '/',
    maxFileBytes: 8,
    maxDocumentBytes: 1024 * 1024,
    mysql: { host: '127.0.0.1', port: 3306, database: 'x', user: 'x', password: '', connectionLimit: 1, connectAttempts: 1, connectRetryMs: 100, ssl: false },
    ...overrides,
  };
}

function integrationConfig(overrides = {}) {
  return {
    enabled: true,
    baseUrl: 'http://127.0.0.1',
    tlsServerName: '',
    disableSni: false,
    externalProjectId: '',
    sourceSystem: 'test-platform',
    sessionSecret: 'test-secret-that-is-long-enough-for-tests',
    cookieName: 'canvas_session',
    cookieSecure: false,
    sessionTtlSeconds: 3600,
    connectTimeoutMs: 1000,
    requestTimeoutMs: 5000,
    ...overrides,
  };
}

function platformContext(uid, projectId, overrides = {}) {
  return {
    authenticated: true,
    uid,
    username: `user-${uid}`,
    nickname: `User ${uid}`,
    permissionIds: [1, 7],
    currentPoints: 12.5,
    localProjectId: projectId,
    externalProjectId: `external-${projectId}`,
    sourceSystem: 'test-platform',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] || '';
}

function bindingFrom(response) {
  return response.headers.get('x-canvas-session-binding') || '';
}

async function createTestSession(sessions, context, tokens) {
  let cookie = '';
  const session = await sessions.create({
    setHeader(name, value) {
      if (name === 'set-cookie') cookie = value.split(';', 1)[0];
    },
  }, context, tokens);
  return { cookie, binding: session.binding, session };
}

test('configuration rejects unknown drivers instead of silently changing storage', () => {
  assert.throws(() => loadConfig({ DATA_STORAGE_DRIVER: 'typo' }), /browser or mysql/);
  assert.equal(loadConfig({}).maxFileBytes, 128 * 1024 * 1024);
  assert.equal(loadConfig({}).maxDocumentBytes, 16 * 1024 * 1024);
  assert.equal(loadConfig({}).integration.sourceSystem, 'multi_user_platform');
  assert.equal(loadConfig({ INTEGRATION_EXTERNAL_PROJECT_ID: ' project-42 ' }).integration.externalProjectId, 'project-42');
  assert.equal(loadConfig({ VITE_APP_BASE_PATH: ' /infinite-canvas ' }).appBasePath, '/infinite-canvas/');
  assert.throws(() => loadConfig({ VITE_APP_BASE_PATH: 'https://example.com/canvas' }), /absolute URL path/);
  assert.throws(() => loadConfig({ VITE_APP_BASE_PATH: '/../canvas' }), /relative path segments/);
});

test('Dream media CDN requests never receive a platform or browser credential', () => {
  const headers = dreamMediaRequestHeaders();
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.cookie, undefined);
});

test('nested platform responses never confuse project ids with user ids', () => {
  const config = integrationConfig();
  const nested = (uid) => parsePlatformContext({
    profile: { id: uid, username: `name-${uid}`, nickname: uid },
    project: { id: 9, external_project_id: 'shared-project', source_system: 'nested-platform' },
    permission_ids: [1],
    current_points: 10,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }, config);
  const first = nested('user-42');
  const second = nested('user-84');
  assert.equal(first.uid, 'user-42');
  assert.equal(first.externalProjectId, 'shared-project');
  assert.notEqual(deriveStorageNamespace(first), deriveStorageNamespace(second));
});

test('projectless platform contexts remain authenticated and use user-scoped namespaces', () => {
  const config = integrationConfig();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const first = parsePlatformContext({
    uid: 'user-42',
    username: 'alice',
    current_points: 10,
    source_system: 'projectless-platform',
    expires_at: expiresAt,
  }, config);
  const sameIdentity = { ...first };
  const otherUser = { ...first, uid: 'user-84' };
  const projectScoped = { ...first, localProjectId: 9, externalProjectId: 'project-9' };

  assert.equal(first.localProjectId, null);
  assert.equal(first.externalProjectId, null);
  assert.equal(deriveStorageNamespace(first), deriveStorageNamespace(sameIdentity));
  assert.notEqual(deriveStorageNamespace(first), deriveStorageNamespace(otherUser));
  assert.notEqual(deriveStorageNamespace(first), deriveStorageNamespace(projectScoped));
  assert.throws(() => parsePlatformContext({
    uid: 'user-42',
    username: 'alice',
    local_project_id: 'invalid',
    source_system: 'projectless-platform',
    expires_at: expiresAt,
  }, config), /local project context/);
});

test('Integration client resolves and sends the first accessible project id when none is supplied', async () => {
  const captured = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    captured.push({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString('utf8') });
    const payload = request.url === '/api/integration/external/projects'
      ? { data: [{ project_id: 'project-1', name: 'Project One' }] }
      : request.url === '/api/integration/session/exchange'
      ? { data: {
        local_token: 'local-token', uid: 'project-user', username: 'alice', nickname: 'Alice',
        local_project_id: 101, external_project_id: 'project-1',
        source_system: 'project-platform', expires_at: new Date(Date.now() + 60_000).toISOString(),
      } }
      : request.url === '/api/integration/external/profile'
        ? { data: { id: 'project-user', username: 'alice', points: 25 } }
        : null;
    if (payload === null) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const port = upstream.address().port;
  const client = new HttpIntegrationClient(integrationConfig({ baseUrl: `http://127.0.0.1:${port}` }));
  try {
    const result = await client.exchange('external-token');
    assert.equal(result.context.localProjectId, 101);
    assert.equal(result.context.externalProjectId, 'project-1');
    assert.equal(result.context.currentPoints, 25);
    assert.equal(result.localToken, 'local-token');
  } finally {
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }

  assert.deepEqual(captured.map(({ method, url }) => ({ method, url })), [
    { method: 'GET', url: '/api/integration/external/projects' },
    { method: 'POST', url: '/api/integration/session/exchange' },
    { method: 'GET', url: '/api/integration/external/profile' },
  ]);
  assert.deepEqual(JSON.parse(captured[1].body), {
    external_token: 'external-token', external_project_id: 'project-1',
  });
});

test('Integration client preserves safe upstream permission and validation statuses', async () => {
  const upstream = http.createServer((request, response) => {
    if (request.url === '/api/integration/external/projects') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ project_id: 'project-1' }]));
      return;
    }
    const token = request.headers['x-external-token'];
    const status = token === 'forbidden' ? 403 : 422;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(token === 'forbidden'
      ? { detail: 'sensitive upstream detail' }
      : { detail: [{ loc: ['body', 'external_project_id'], msg: 'Field required', type: 'missing' }] }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const port = upstream.address().port;
  const client = new HttpIntegrationClient(integrationConfig({ baseUrl: `http://127.0.0.1:${port}` }));
  try {
    await assert.rejects(client.exchange('forbidden'), (error) => error.status === 403 && error.code === 'platform_forbidden' && !error.message.includes('sensitive'));
    await assert.rejects(client.exchange('invalid'), (error) => error.status === 422
      && error.code === 'platform_validation_failed'
      && error.message.includes('body.external_project_id: Field required')
      && !error.message.includes('sensitive'));
  } finally {
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }
});

test('Integration client exposes only the upstream status for unexpected failures', async () => {
  const upstream = http.createServer((_request, response) => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ detail: 'database rejected external-secret', request_token: 'secret' }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const port = upstream.address().port;
  const client = new HttpIntegrationClient(integrationConfig({ baseUrl: `http://127.0.0.1:${port}` }));
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    await assert.rejects(client.exchange('external-secret', 'project-1'), (error) => error.status === 502
      && error.code === 'integration_error'
      && error.message === 'Platform request failed (upstream 500)'
      && !error.message.includes('secret'));
  } finally {
    console.error = originalConsoleError;
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }
  const rejectedLog = logged.find(([message]) => message === '[integration] upstream response rejected');
  assert.equal(rejectedLog?.[1]?.detail, 'database rejected [redacted]');
  assert.equal(JSON.stringify(logged).includes('external-secret'), false);
});

test('document API supports CRUD and optimistic locking', async () => {
  await withServer(baseConfig(), createMemoryRepositories(), async (base) => {
    let response = await fetch(`${base}/api/storage/documents/canvas/card-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { title: 'A' } }),
    });
    assert.equal(response.status, 200);
    let body = await response.json();
    assert.equal(body.document.revision, 1);

    response = await fetch(`${base}/api/storage/documents/canvas/card-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { title: 'B' }, revision: 99 }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: { code: 'revision_conflict', message: 'Document revision conflict' } });

    response = await fetch(`${base}/api/storage/documents/canvas/card-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { title: 'B' }, revision: 1 }),
    });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.document.revision, 2);

    response = await fetch(`${base}/api/storage/documents/canvas`);
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.documents.length, 1);

    response = await fetch(`${base}/api/storage/documents/canvas/card-1`, { method: 'DELETE', headers: { 'if-match': '1' } });
    assert.equal(response.status, 409);

    response = await fetch(`${base}/api/storage/documents/canvas/card-1`, { method: 'DELETE', headers: { 'if-match': '2' } });
    assert.equal(response.status, 200);

    response = await fetch(`${base}/api/storage/documents/not_allowed/key`);
    assert.equal(response.status, 400);
  });
});

test('document batch API rolls back every mutation on a revision conflict', async () => {
  await withServer(baseConfig(), createMemoryRepositories(), async (base) => {
    let response = await fetch(`${base}/api/storage/documents/assets/asset-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { id: 'asset-1', title: 'One' } }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${base}/api/storage/documents/assets/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        puts: [
          { key: 'asset-1', payload: { id: 'asset-1', title: 'Updated' }, revision: 1 },
          { key: '__collection_order__', payload: ['asset-1'], revision: null },
        ],
        deletes: [],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).documents.length, 2);

    response = await fetch(`${base}/api/storage/documents/assets/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        puts: [
          { key: 'asset-2', payload: { id: 'asset-2', title: 'Must roll back' }, revision: null },
          { key: 'asset-1', payload: { id: 'asset-1', title: 'Stale' }, revision: 1 },
        ],
        deletes: [],
      }),
    });
    assert.equal(response.status, 409);
    response = await fetch(`${base}/api/storage/documents/assets/asset-2`);
    assert.equal(response.status, 404);
  });
});

test('canvas_folders is an independent document domain', async () => {
  await withServer(baseConfig(), createMemoryRepositories(), async (base) => {
    let response = await fetch(`${base}/api/storage/documents/canvas_folders/folder-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { id: 'folder-1', name: 'Folder', parentId: null } }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${base}/api/storage/documents/canvas_folders`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.documents.map((document) => document.key), ['folder-1']);
  });
});

test('blob API supports raw upload, HEAD, range, list and size limit', async () => {
  const repos = createMemoryRepositories();
  const contentReads = [];
  const getContent = repos.blobs.getContent.bind(repos.blobs);
  repos.blobs.getContent = async (...args) => {
    contentReads.push(args.slice(2));
    return getContent(...args);
  };
  await withServer(baseConfig({ maxFileBytes: 4 }), repos, async (base) => {
    let response = await fetch(`${base}/api/storage/blobs/img-1`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    });
    assert.equal(response.status, 413);

    response = await fetch(`${base}/api/storage/blobs/img-1`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: 'hey',
    });
    assert.equal(response.status, 200);
    let body = await response.json();
    assert.equal(body.blob.byteSize, 3);

    response = await fetch(`${base}/api/storage/blobs/img-1`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-length'), '3');
    assert.equal(contentReads.length, 0);

    const logged = [];
    const originalConsoleError = console.error;
    console.error = (...args) => logged.push(args);
    try {
      response = await fetch(`${base}/api/storage/blobs/missing-cover`, { method: 'HEAD' });
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(response.status, 404);
    assert.equal(logged.length, 0);

    response = await fetch(`${base}/api/storage/blobs/img-1`, { headers: { range: 'bytes=1-2' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 1-2/3');
    assert.equal(await response.text(), 'ey');
    assert.deepEqual(contentReads, [[1, 2]]);

    response = await fetch(`${base}/api/storage/blobs`);
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.blobs[0].key, 'img-1');
    assert.equal(body.blobs[0].content, undefined);
  });
});

test('browser mode exposes config/health and serves SPA without API fallback', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'storage-static-'));
  await writeFile(path.join(dir, 'index.html'), '<main>spa</main>');
  await writeFile(path.join(dir, 'app.js'), 'console.log("ok")');

  await withServer(baseConfig({ driver: 'browser', staticDir: dir }), undefined, async (base) => {
    let response = await fetch(`${base}/api/storage/config`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { driver: 'browser', namespace: 'test_ns' });

    response = await fetch(`${base}/missing/client/route`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<main>spa</main>');

    response = await fetch(`${base}/api/nope`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'not_found');
  });
});

test('static app serves a configured base path for direct-port and same-origin proxy access', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'storage-base-path-'));
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'index.html'), '<main>base-spa</main>');
  await writeFile(path.join(dir, 'assets', 'app.js'), 'console.log("base")');

  await withServer(baseConfig({ driver: 'browser', staticDir: dir, appBasePath: '/infinite-canvas/' }), undefined, async (base) => {
    let response = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), '/infinite-canvas/');

    response = await fetch(`${base}/infinite-canvas`, { redirect: 'manual' });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), '/infinite-canvas/');

    response = await fetch(`${base}/infinite-canvas/`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<main>base-spa</main>');

    response = await fetch(`${base}/infinite-canvas/assets/app.js`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'console.log("base")');

    response = await fetch(`${base}/infinite-canvas/api/platform/config`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled: false });

    response = await fetch(`${base}/infinite-canvas/api/storage/config`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { driver: 'browser', namespace: 'test_ns' });

    response = await fetch(`${base}/outside-base`, { redirect: 'manual' });
    assert.equal(response.status, 404);
  });
});

test('production server proxies Dream API requests through the same origin', async () => {
  let captured;
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    captured = {
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body: Buffer.concat(chunks).toString('utf8'),
    };
    const body = JSON.stringify({ code: 0, data: { task_id: 'task-1' } });
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) });
    response.end(body);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const { port } = upstream.address();

  try {
    await withServer(
      baseConfig({
        dreamProxy: {
          baseUrl: `http://127.0.0.1:${port}`,
          tlsServerName: '',
          disableSni: false,
          timeoutMs: 5000,
        },
      }),
      createMemoryRepositories(),
      async (base) => {
        const response = await fetch(`${base}/__dream_api_proxy/api/v1/dream/dream_image`, {
          method: 'POST',
          headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
          body: JSON.stringify({ script_text: 'test' }),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { code: 0, data: { task_id: 'task-1' } });
      },
    );
  } finally {
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }

  assert.deepEqual(captured, {
    method: 'POST',
    url: '/api/v1/dream/dream_image',
    authorization: 'Bearer test-token',
    body: JSON.stringify({ script_text: 'test' }),
  });
});

test('Dream proxy rejects requests when no upstream is configured', async () => {
  await withServer(baseConfig(), createMemoryRepositories(), async (base) => {
    const response = await fetch(`${base}/__dream_api_proxy/api/v1/dream/dream_image`, { method: 'POST' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { detail: 'Dream API proxy is not configured' });
  });
});

test('platform login, exchange, context and logout keep all upstream tokens server-side', async () => {
  const captured = [];
  let profilePoints = 88;
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    captured.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      externalToken: request.headers['x-external-token'],
      body: Buffer.concat(chunks).toString('utf8'),
    });
    let payload;
    if (request.url === '/api/integration/external/auth/login') {
      payload = { data: { external_token: 'external-secret', refresh_token: 'refresh-secret' } };
    } else if (request.url === '/api/integration/external/projects') {
      payload = { data: [{ project_id: 'project-x', name: 'Project X' }] };
    } else if (request.url === '/api/integration/session/exchange') {
      payload = { data: {
        local_token: 'local-secret', uid: '42', username: 'alice', nickname: 'Alice',
        permission_ids: [2, 9], current_points: 0, local_project_id: 101,
        external_project_id: 'project-x', source_system: 'apifox',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      } };
    } else if (request.url === '/api/integration/external/profile') {
      payload = { data: { id: '42', username: 'alice', nickname: 'Alice', points: profilePoints } };
    } else if (request.url === '/api/integration/context/current') {
      payload = { data: {
        uid: '42', username: 'alice', nickname: 'Alice Updated', permission_ids: [2, 9],
        current_points: 0, local_project_id: 101, external_project_id: 'project-x',
        source_system: 'apifox', expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      } };
    } else if (request.url === '/api/integration/external/auth/logout') {
      payload = null;
    } else {
      response.writeHead(404).end();
      return;
    }
    const encoded = Buffer.from(JSON.stringify(payload));
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(encoded.byteLength) });
    response.end(encoded);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  const config = integrationConfig({ baseUrl: `http://127.0.0.1:${upstreamPort}` });
  const records = new Map();
  const repository = {
    get: async (key) => records.get(key) || null,
    save: async (record) => records.set(record.sessionIdHash, structuredClone(record)),
    updateExisting: async (record) => {
      if (!records.has(record.sessionIdHash)) return false;
      records.set(record.sessionIdHash, structuredClone(record));
      return true;
    },
    delete: async (key) => records.delete(key),
  };
  const integration = {
    config,
    client: new HttpIntegrationClient(config),
    sessions: new IntegrationSessionService(config, repository),
  };

  try {
    await withServer(baseConfig({ integration: config }), createMemoryRepositories(), async (base) => {
      let response = await fetch(`${base}/api/platform/config`);
      assert.deepEqual(await response.json(), { enabled: true });

      response = await fetch(`${base}/api/platform/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'password-secret' }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const setCookie = response.headers.get('set-cookie');
      assert.match(setCookie, /^canvas_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600/);
      assert.doesNotMatch(setCookie, /Secure/);
      const cookie = cookieFrom(response);
      const binding = bindingFrom(response);
      assert.match(binding, /^[A-Za-z0-9_-]{43}$/);
      const context = await response.json();
      assert.equal(context.uid, '42');
      assert.equal(context.currentPoints, 88);
      assert.equal(context.localToken, undefined);
      assert.equal(JSON.stringify(context).includes('secret'), false);

      assert.equal(records.size, 1);
      const persisted = [...records.values()][0];
      assert.match(persisted.sessionIdHash, /^[a-f0-9]{64}$/);
      assert.notEqual(persisted.sessionIdHash, cookie.split('=')[1]);
      const persistedJson = JSON.stringify(persisted);
      for (const token of ['external-secret', 'refresh-secret', 'local-secret']) assert.equal(persistedJson.includes(token), false);

      profilePoints = 77;
      response = await fetch(`${base}/api/platform/context`, { headers: { cookie, 'x-canvas-session-binding': binding } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(bindingFrom(response), binding);
      assert.equal((await response.json()).currentPoints, 77);

      response = await fetch(`${base}/api/platform/auth/logout`, {
        method: 'POST', headers: { cookie, 'x-canvas-session-binding': binding },
      });
      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
      assert.equal(records.size, 0);

      response = await fetch(`${base}/api/platform/context`, { headers: { cookie } });
      assert.equal(response.status, 401);
    }, integration);
  } finally {
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }

  assert.deepEqual(captured.map(({ method, url }) => ({ method, url })), [
    { method: 'POST', url: '/api/integration/external/auth/login' },
    { method: 'GET', url: '/api/integration/external/projects' },
    { method: 'POST', url: '/api/integration/session/exchange' },
    { method: 'GET', url: '/api/integration/external/profile' },
    { method: 'GET', url: '/api/integration/context/current' },
    { method: 'GET', url: '/api/integration/external/profile' },
    { method: 'POST', url: '/api/integration/external/auth/logout' },
  ]);
  assert.equal(captured[1].externalToken, 'external-secret');
  assert.equal(captured[1].authorization, undefined);
  assert.equal(captured[2].externalToken, 'external-secret');
  assert.equal(captured[2].authorization, 'Bearer external-secret');
  assert.deepEqual(JSON.parse(captured[2].body), {
    external_token: 'external-secret', external_project_id: 'project-x',
  });
  assert.equal(captured[3].externalToken, 'external-secret');
  assert.equal(captured[3].authorization, undefined);
  assert.equal(captured[4].authorization, 'Bearer local-secret');
  assert.equal(captured[5].externalToken, 'external-secret');
  assert.equal(captured[5].authorization, undefined);
  assert.equal(captured[6].externalToken, 'external-secret');
});

test('registration and platform project routes enforce binding, keep tokens server-side and rotate selection atomically', async () => {
  const captured = [];
  let rejectProjectRequests = false;
  const projects = [
    { project_id: 'project-1', name: 'One', points: 10.5, permission: [{ id: 2 }, { permission_id: 4 }, 'invalid'] },
    { project_id: 2, name: 'Two', points: null, permission_ids: [7] },
    { project_id: 'project-3', name: 'Three', points: 0, permission_ids: [] },
  ];
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    captured.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      externalToken: request.headers['x-external-token'],
      body,
    });
    const send = (status, payload) => {
      const encoded = Buffer.from(JSON.stringify(payload));
      response.writeHead(status, { 'content-type': 'application/json', 'content-length': String(encoded.byteLength) });
      response.end(encoded);
    };

    if (request.url === '/api/integration/external/auth/register') return send(200, null);
    if (request.url === '/api/integration/external/auth/login') {
      return send(200, { data: { external_token: 'server-external-secret', refresh_token: 'server-refresh-secret' } });
    }
    if (request.url === '/api/integration/external/projects') {
      if (rejectProjectRequests) return send(401, { detail: 'expired external token' });
      return send(200, { data: projects });
    }
    if (request.url === '/api/integration/external/projects/create') return send(200, { data: null });
    if (request.url === '/api/integration/external/profile') {
      return send(200, { data: { id: 'project-user', username: 'project-user', nickname: 'Project User', points: 500 } });
    }
    if (request.url === '/api/integration/session/exchange') {
      if (body.external_project_id === 'project-3') return send(422, { detail: 'selection rejected' });
      const selected = String(body.external_project_id);
      return send(200, { data: {
        local_token: `local-${selected}`,
        uid: 'project-user', username: 'project-user', nickname: 'Project User',
        permission_ids: selected === '2' ? [7] : [2, 4], current_points: selected === '2' ? null : 10.5,
        local_project_id: selected === '2' ? 202 : 101,
        external_project_id: selected, source_system: 'test-platform',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      } });
    }
    if (request.url === '/api/integration/context/current') {
      const selected = request.headers.authorization === 'Bearer local-2' ? '2' : 'project-1';
      return send(200, { data: {
        uid: 'project-user', username: 'project-user', nickname: 'Project User',
        permission_ids: selected === '2' ? [7] : [2, 4], current_points: selected === '2' ? null : 10.5,
        local_project_id: selected === '2' ? 202 : 101,
        external_project_id: selected, source_system: 'test-platform',
        expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      } });
    }
    return send(404, {});
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const { port } = upstream.address();
  const config = integrationConfig({ baseUrl: `http://127.0.0.1:${port}` });
  const integration = {
    config,
    client: new HttpIntegrationClient(config),
    sessions: new IntegrationSessionService(config, new MemoryIntegrationSessionRepository()),
  };

  try {
    await withServer(baseConfig({ integration: config }), createMemoryRepositories(), async (base) => {
      let response = await fetch(`${base}/api/platform/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site' },
        body: JSON.stringify({ username: 'new-user', password: 'secret' }),
      });
      assert.equal(response.status, 403);
      assert.equal(captured.length, 0);

      response = await fetch(`${base}/api/platform/auth/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'new-user' }),
      });
      assert.equal(response.status, 400);
      assert.equal(captured.length, 0);

      response = await fetch(`${base}/api/platform/auth/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'new-user', password: 'secret', owner: 'browser-owner-must-be-ignored' }),
      });
      assert.deepEqual(await response.json(), { ok: true });
      assert.deepEqual(captured[0].body, { username: 'new-user', password: 'secret' });

      response = await fetch(`${base}/api/platform/projects`, {
        headers: { 'x-canvas-session-binding': 'browser-supplied-binding' },
      });
      assert.equal(response.status, 401);

      response = await fetch(`${base}/api/platform/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'project-user', password: 'password' }),
      });
      assert.equal(response.status, 200);
      let cookie = cookieFrom(response);
      let binding = bindingFrom(response);

      response = await fetch(`${base}/api/platform/projects`, { headers: { cookie } });
      assert.equal(response.status, 403);

      response = await fetch(`${base}/api/platform/projects`, {
        headers: {
          cookie,
          'x-canvas-session-binding': binding,
          'x-external-token': 'browser-token-must-be-ignored',
          authorization: 'Bearer browser-token-must-be-ignored',
        },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { projects: [
        { projectId: 'project-1', name: 'One', points: 10.5, permissionIds: [2, 4] },
        { projectId: '2', name: 'Two', points: null, permissionIds: [7] },
        { projectId: 'project-3', name: 'Three', points: 0, permissionIds: [] },
      ] });

      response = await fetch(`${base}/api/platform/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, 'x-canvas-session-binding': binding },
        body: JSON.stringify({ name: 'Invalid', tag: 'demo', skill: ['0'] }),
      });
      assert.equal(response.status, 400);

      response = await fetch(`${base}/api/platform/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, 'x-canvas-session-binding': binding },
        body: JSON.stringify({
          name: 'Created', content: null, tag: 'demo', skill: [0], skillModel: ['model-a'],
          points: 999, externalToken: 'browser-token-must-be-ignored',
        }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).projects.length, 3);
      const createRequest = captured.find((item) => item.url === '/api/integration/external/projects/create');
      assert.equal(createRequest.externalToken, 'server-external-secret');
      assert.equal(createRequest.authorization, undefined);
      assert.deepEqual(createRequest.body, {
        name: 'Created', content: null, tag: 'demo', skill: [0], skill_model: ['model-a'], points: 0,
      });
      const createIndex = captured.indexOf(createRequest);
      assert.equal(captured[createIndex + 1].url, '/api/integration/external/projects');

      response = await fetch(`${base}/api/platform/projects/project-3/select`, {
        method: 'POST', headers: { cookie, 'x-canvas-session-binding': binding },
      });
      assert.equal(response.status, 422);
      response = await fetch(`${base}/api/platform/context`, {
        headers: { cookie, 'x-canvas-session-binding': binding },
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).externalProjectId, 'project-1');

      response = await fetch(`${base}/api/platform/projects/not-accessible/select`, {
        method: 'POST', headers: { cookie, 'x-canvas-session-binding': binding },
      });
      assert.equal(response.status, 404);
      response = await fetch(`${base}/api/platform/context`, {
        headers: { cookie, 'x-canvas-session-binding': binding },
      });
      assert.equal(response.status, 200);

      response = await fetch(`${base}/api/platform/projects/2/select`, {
        method: 'POST', headers: { cookie, 'x-canvas-session-binding': binding },
      });
      assert.equal(response.status, 200);
      const selected = await response.json();
      assert.equal(selected.externalProjectId, '2');
      const newCookie = cookieFrom(response);
      const newBinding = bindingFrom(response);
      assert.notEqual(newCookie, cookie);
      assert.notEqual(newBinding, binding);

      response = await fetch(`${base}/api/platform/context`, {
        headers: { cookie, 'x-canvas-session-binding': binding },
      });
      assert.equal(response.status, 401);
      cookie = newCookie;
      binding = newBinding;

      const selectedExchange = captured.filter((item) => item.url === '/api/integration/session/exchange').at(-1);
      assert.equal(selectedExchange.externalToken, 'server-external-secret');
      assert.equal(selectedExchange.authorization, 'Bearer server-external-secret');
      assert.deepEqual(selectedExchange.body, {
        external_token: 'server-external-secret', external_project_id: '2',
      });

      rejectProjectRequests = true;
      response = await fetch(`${base}/api/platform/projects`, {
        headers: { cookie, 'x-canvas-session-binding': binding },
      });
      assert.equal(response.status, 401);
      assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
      response = await fetch(`${base}/api/platform/context`, {
        headers: { cookie, 'x-canvas-session-binding': binding },
      });
      assert.equal(response.status, 401);
    }, integration);
  } finally {
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }

  for (const request of captured.filter((item) => item.url === '/api/integration/external/projects')) {
    assert.equal(request.externalToken, 'server-external-secret');
    assert.equal(request.authorization, undefined);
  }
});

test('project onboarding lists and creates projects before a canvas session exists', async () => {
  const config = integrationConfig();
  const calls = [];
  let rejectProjects = false;
  let projects = [
    { projectId: 'existing-project', name: 'Existing', points: 10, permissionIds: [1] },
  ];
  const client = {
    listProjects: async (externalToken) => {
      calls.push({ operation: 'list', externalToken });
      if (rejectProjects) throw new HttpError(401, 'invalid_credentials', 'Platform authentication failed');
      return structuredClone(projects);
    },
    createProject: async (externalToken, input) => {
      calls.push({ operation: 'create', externalToken, input: structuredClone(input) });
      projects = [...projects, { projectId: 'created-project', name: input.name, points: 0, permissionIds: [] }];
      return null;
    },
  };
  const integration = {
    config,
    client,
    sessions: new IntegrationSessionService(config, new MemoryIntegrationSessionRepository()),
  };

  await withServer(baseConfig({ integration: config }), createMemoryRepositories(), async (base) => {
    let response = await fetch(`${base}/api/platform/onboarding/projects/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ externalToken: 'external-secret' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { projects: [
      { projectId: 'existing-project', name: 'Existing', points: 10, permissionIds: [1] },
    ] });

    response = await fetch(`${base}/api/platform/onboarding/projects/list`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.invalid',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify({ externalToken: 'external-secret' }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${base}/api/platform/onboarding/projects/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        externalToken: 'external-secret',
        name: 'Canvas project',
        content: null,
        tag: 'canvas',
        skill: [],
        skill_model: [],
      }),
    });
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.deepEqual(created.project, { projectId: 'created-project', name: 'Canvas project', points: 0, permissionIds: [] });
    assert.equal(created.projects.length, 2);
    assert.doesNotMatch(JSON.stringify(created), /external-secret/);

    const createCall = calls.find((call) => call.operation === 'create');
    assert.deepEqual(createCall, {
      operation: 'create',
      externalToken: 'external-secret',
      input: { name: 'Canvas project', content: null, tag: 'canvas', skill: [], skillModel: [] },
    });

    rejectProjects = true;
    response = await fetch(`${base}/api/platform/onboarding/projects/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ externalToken: 'expired-secret' }),
    });
    assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), /expired-secret/);
  }, integration);
});

test('integration sessions isolate storage and Dream requests by binding', async () => {
  const dreamRequests = [];
  const dreamUpstream = http.createServer((request, response) => {
    dreamRequests.push({
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    });
    const body = Buffer.from('{}');
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(body.byteLength) });
    response.end(body);
  });
  await new Promise((resolve) => dreamUpstream.listen(0, '127.0.0.1', resolve));
  const dreamPort = dreamUpstream.address().port;
  const config = integrationConfig();
  const contexts = new Map([
    ['ticket-a', platformContext('a', 1)],
    ['ticket-b', platformContext('b', 1)],
  ]);
  const client = {
    login: async () => { throw new Error('not used'); },
    exchange: async (token) => ({ context: contexts.get(token), localToken: `local-${token}` }),
    current: async (token) => contexts.get(token.replace('local-', '')),
    logout: async () => {},
  };
  const sessions = new IntegrationSessionService(config, new MemoryIntegrationSessionRepository());
  const credentials = {};
  for (const ticket of ['ticket-a', 'ticket-b']) {
    credentials[ticket] = await createTestSession(sessions, contexts.get(ticket), {
      externalToken: ticket,
      localToken: `local-${ticket}`,
    });
  }
  const integration = {
    config,
    client,
    sessions,
  };
  const serverConfig = baseConfig({
    integration: config,
    dreamProxy: { baseUrl: `http://127.0.0.1:${dreamPort}`, tlsServerName: '', disableSni: false, timeoutMs: 5000 },
  });

  try {
    await withServer(serverConfig, createMemoryRepositories(), async (base) => {
      let response = await fetch(`${base}/api/storage/config`);
      assert.deepEqual(await response.json(), { driver: 'mysql', authRequired: true, authenticated: false });

      response = await fetch(`${base}/api/storage/documents/canvas/shared`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: { owner: 'none' } }),
      });
      assert.equal(response.status, 401);

      response = await fetch(`${base}/__dream_api_proxy/api/v1/dream/dream_image`, {
        method: 'POST',
        headers: { authorization: 'Bearer browser-must-not-win' },
        body: '{}',
      });
      assert.equal(response.status, 401);
      assert.equal(dreamRequests.length, 0);
      response = await fetch(`${base}/__dream_media_proxy?url=${encodeURIComponent('https://example.volces.com/media.png')}`);
      assert.equal(response.status, 401);

      const cookies = {};
      const bindings = {};
      for (const ticket of ['ticket-a', 'ticket-b']) {
        cookies[ticket] = credentials[ticket].cookie;
        bindings[ticket] = credentials[ticket].binding;
      }

      response = await fetch(`${base}/api/storage/config`, { headers: { cookie: cookies['ticket-a'] } });
      assert.deepEqual(await response.json(), { driver: 'mysql', authRequired: true, authenticated: true });

      response = await fetch(`${base}/api/storage/documents/canvas/shared`, {
        method: 'PUT', headers: { 'content-type': 'application/json', cookie: cookies['ticket-a'] }, body: JSON.stringify({ payload: true }),
      });
      assert.equal(response.status, 403);

      response = await fetch(`${base}/api/storage/documents/canvas/shared`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: cookies['ticket-a'], 'x-canvas-session-binding': bindings['ticket-b'] },
        body: JSON.stringify({ payload: true }),
      });
      assert.equal(response.status, 403);

      for (const ticket of ['ticket-a', 'ticket-b']) {
        response = await fetch(`${base}/api/storage/documents/canvas/shared`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: cookies[ticket], 'x-canvas-session-binding': bindings[ticket] },
          body: JSON.stringify({ payload: { owner: ticket } }),
        });
        assert.equal(response.status, 200);
      }
      for (const ticket of ['ticket-a', 'ticket-b']) {
        response = await fetch(`${base}/api/storage/documents/canvas/shared`, {
          headers: { cookie: cookies[ticket], 'x-canvas-session-binding': bindings[ticket] },
        });
        assert.equal((await response.json()).document.payload.owner, ticket);
      }

      response = await fetch(`${base}/api/storage/blobs/direct`, {
        method: 'PUT',
        headers: { cookie: cookies['ticket-a'], 'x-canvas-session-binding': bindings['ticket-a'], 'content-type': 'text/plain' },
        body: 'blob',
      });
      assert.equal(response.status, 200);
      response = await fetch(`${base}/api/storage/blobs/direct?session_binding=${encodeURIComponent(bindings['ticket-a'])}`, {
        headers: { cookie: cookies['ticket-a'] },
      });
      assert.equal(await response.text(), 'blob');
      response = await fetch(`${base}/api/storage/blobs/direct`, {
        method: 'HEAD', headers: { cookie: cookies['ticket-a'] },
      });
      assert.equal(response.status, 403);

      response = await fetch(`${base}/__dream_api_proxy/api/v1/dream/dream_image`, {
        method: 'POST', headers: { cookie: cookies['ticket-a'] }, body: '{}',
      });
      assert.equal(response.status, 403);
      response = await fetch(`${base}/__dream_api_proxy/api/v1/dream/dream_image`, {
        method: 'POST',
        headers: { cookie: cookies['ticket-a'], 'x-canvas-session-binding': bindings['ticket-b'] },
        body: '{}',
      });
      assert.equal(response.status, 403);
      response = await fetch(`${base}/__dream_media_proxy?url=${encodeURIComponent('https://example.volces.com/media.png')}`, {
        headers: { cookie: cookies['ticket-a'], 'x-canvas-session-binding': bindings['ticket-b'] },
      });
      assert.equal(response.status, 403);
      assert.equal(dreamRequests.length, 0);

      response = await fetch(`${base}/__dream_api_proxy/api/v1/dream/dream_image`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer browser-must-not-win',
          cookie: cookies['ticket-a'],
          'x-canvas-session-binding': bindings['ticket-a'],
        },
        body: '{}',
      });
      assert.equal(response.status, 200);
      assert.deepEqual(dreamRequests, [{ authorization: 'Bearer ticket-a', cookie: undefined }]);
    }, integration);
  } finally {
    await new Promise((resolve, reject) => dreamUpstream.close((error) => error ? reject(error) : resolve()));
  }
});

test('host-platform bootstrap rotates credentials once and reuses an equivalent server session', async () => {
  const config = integrationConfig();
  const context = platformContext('rotate-user', 44);
  let exchanges = 0;
  let currentReads = 0;
  let refreshedPoints = context.currentPoints;
  const captured = [];
  const client = {
    exchange: async (externalToken, externalProjectId) => {
      exchanges += 1;
      captured.push({ externalToken, externalProjectId });
      return { context, localToken: 'local-rotate' };
    },
    current: async () => {
      currentReads += 1;
      return { ...context, currentPoints: refreshedPoints };
    },
    logout: async () => {},
  };
  const sessions = new IntegrationSessionService(config, new MemoryIntegrationSessionRepository());
  const initial = await createTestSession(sessions, context, {
    externalToken: 'external-initial', localToken: 'local-initial',
  });
  const integration = {
    config,
    client,
    sessions,
  };
  await withServer(baseConfig({ integration: config }), createMemoryRepositories(), async (base) => {
    let response = await fetch(`${base}/api/platform/session/exchange`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ externalToken: 'browser-token' }),
    });
    assert.equal(response.status, 404);
    assert.equal(exchanges, 0);
    const oldCookie = initial.cookie;
    const oldBinding = initial.binding;

    refreshedPoints = 5;
    response = await fetch(`${base}/api/platform/session/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: oldCookie },
      body: JSON.stringify({ externalToken: 'external-rotate', refreshToken: 'refresh-rotate', externalProjectId: 'external-44' }),
    });
    assert.equal(response.status, 200);
    const newCookie = cookieFrom(response);
    const newBinding = bindingFrom(response);
    assert.notEqual(newCookie, oldCookie);
    assert.notEqual(newBinding, oldBinding);
    assert.deepEqual(captured, [{ externalToken: 'external-rotate', externalProjectId: 'external-44' }]);

    response = await fetch(`${base}/api/platform/context`, {
      headers: { cookie: oldCookie, 'x-canvas-session-binding': oldBinding },
    });
    assert.equal(response.status, 401);

    response = await fetch(`${base}/api/platform/auth/logout`, {
      method: 'POST', headers: { cookie: newCookie, 'x-canvas-session-binding': oldBinding },
    });
    assert.equal(response.status, 403);
    response = await fetch(`${base}/api/platform/context`, {
      headers: { cookie: newCookie, 'x-canvas-session-binding': newBinding },
    });
    assert.equal(response.status, 200);

    response = await fetch(`${base}/api/platform/session/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: newCookie },
      body: JSON.stringify({ external_token: 'external-rotate', refresh_token: 'refresh-rotate', external_project_id: 'external-44' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.clone().json()).currentPoints, refreshedPoints);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(bindingFrom(response), newBinding);
    assert.equal(exchanges, 1);
    assert.equal(currentReads, 2);

    response = await fetch(`${base}/api/platform/session/clear`, {
      method: 'POST', headers: { cookie: newCookie },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    response = await fetch(`${base}/api/platform/context`, {
      headers: { cookie: newCookie, 'x-canvas-session-binding': newBinding },
    });
    assert.equal(response.status, 401);
  }, integration);
});

test('host-platform bootstrap delegates a missing project id to the integration client resolver', async () => {
  const config = integrationConfig();
  const context = platformContext('resolved-bootstrap', 55, { externalProjectId: 'external-55' });
  const captured = [];
  const client = {
    exchange: async (externalToken, externalProjectId) => {
      captured.push({ externalToken, externalProjectId });
      return { context, localToken: 'local-resolved' };
    },
    current: async () => context,
    logout: async () => {},
  };
  const sessions = new IntegrationSessionService(config, new MemoryIntegrationSessionRepository());
  const integration = { config, client, sessions };

  await withServer(baseConfig({ integration: config }), createMemoryRepositories(), async (base) => {
    let response = await fetch(`${base}/api/platform/session/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ externalToken: 'external-resolved', refreshToken: null, externalProjectId: null }),
    });
    assert.equal(response.status, 200);
    const cookie = cookieFrom(response);
    const binding = bindingFrom(response);
    assert.ok(cookie);
    assert.ok(binding);
    assert.deepEqual(await response.json(), context);

    response = await fetch(`${base}/api/platform/context`, {
      headers: { cookie, 'x-canvas-session-binding': binding },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).externalProjectId, 'external-55');

    response = await fetch(`${base}/api/storage/config`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).authenticated, true);
  }, integration);

  assert.deepEqual(captured, [{ externalToken: 'external-resolved', externalProjectId: undefined }]);
});

test('host-platform bootstrap falls back from a stale host project id', async () => {
  const config = integrationConfig();
  const context = platformContext('fallback-user', 55, { externalProjectId: 'external-55' });
  const captured = [];
  const client = {
    exchange: async (externalToken, externalProjectId) => {
      captured.push({ externalToken, externalProjectId });
      if (externalProjectId === 'stale-project') throw new HttpError(502, 'integration_error', 'Platform request failed (upstream 502)');
      return { context, localToken: 'local-fallback' };
    },
    current: async () => context,
    logout: async () => {},
  };
  const sessions = new IntegrationSessionService(config, new MemoryIntegrationSessionRepository());
  const integration = { config, client, sessions };

  await withServer(baseConfig({ integration: config }), createMemoryRepositories(), async (base) => {
    const response = await fetch(`${base}/api/platform/session/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ externalToken: 'external-fallback', refreshToken: null, externalProjectId: 'stale-project' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).externalProjectId, 'external-55');
  }, integration);

  assert.deepEqual(captured, [
    { externalToken: 'external-fallback', externalProjectId: 'stale-project' },
    { externalToken: 'external-fallback', externalProjectId: undefined },
  ]);
});

test('concurrent session rotation uses repository CAS and creates exactly one replacement', async () => {
  const config = integrationConfig();
  const repository = new MemoryIntegrationSessionRepository();
  const sessions = new IntegrationSessionService(config, repository);
  const initial = await createTestSession(sessions, platformContext('cas-user', 1), {
    externalToken: 'external-cas', refreshToken: 'refresh-cas', localToken: 'local-cas-1',
  });
  const cookies = ['', ''];
  const responses = cookies.map((_value, index) => ({
    setHeader(name, value) {
      if (name === 'set-cookie') cookies[index] = value.split(';', 1)[0];
    },
  }));

  const results = await Promise.allSettled([
    sessions.rotate(responses[0], initial.session, platformContext('cas-user', 2), {
      externalToken: 'external-cas', refreshToken: 'refresh-cas', localToken: 'local-cas-2',
    }),
    sessions.rotate(responses[1], initial.session, platformContext('cas-user', 3), {
      externalToken: 'external-cas', refreshToken: 'refresh-cas', localToken: 'local-cas-3',
    }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  assert.equal(rejected.reason.code, 'session_rotation_conflict');
  assert.equal(cookies.filter(Boolean).length, 1);
  assert.equal(await sessions.resolve({ headers: { cookie: initial.cookie } }), null);

  const active = await sessions.resolve({ headers: { cookie: cookies.find(Boolean) } });
  assert.ok(active);
  assert.ok(active.context.localProjectId === 2 || active.context.localProjectId === 3);
  assert.equal(repository.records.size, 1);
});

test('concurrent context update cannot recreate a session removed by rotation', async () => {
  const config = integrationConfig();
  const backing = new MemoryIntegrationSessionRepository();
  let signalUpdateReached;
  let releaseUpdate;
  const updateReached = new Promise((resolve) => { signalUpdateReached = resolve; });
  const updateRelease = new Promise((resolve) => { releaseUpdate = resolve; });
  const repository = {
    get: (key) => backing.get(key),
    save: (record) => backing.save(record),
    replace: (key, record) => backing.replace(key, record),
    delete: (key) => backing.delete(key),
    updateExisting: async (record) => {
      signalUpdateReached();
      await updateRelease;
      return backing.updateExisting(record);
    },
  };
  const sessions = new IntegrationSessionService(config, repository);
  const initialContext = platformContext('update-rotate-user', 1);
  const initial = await createTestSession(sessions, initialContext, {
    externalToken: 'external-update-rotate', localToken: 'local-before-rotate',
  });

  const updating = sessions.updateContext(initial.session, { ...initialContext, currentPoints: 99 });
  await updateReached;

  let rotatedCookie = '';
  const rotated = await sessions.rotate({
    setHeader(name, value) {
      if (name === 'set-cookie') rotatedCookie = value.split(';', 1)[0];
    },
  }, initial.session, platformContext('update-rotate-user', 2), {
    externalToken: 'external-update-rotate', localToken: 'local-after-rotate',
  });
  releaseUpdate();

  await assert.rejects(updating, (error) => error.status === 401 && error.code === 'session_rotated');
  assert.equal(await sessions.resolve({ headers: { cookie: initial.cookie } }), null);
  const active = await sessions.resolve({ headers: { cookie: rotatedCookie } });
  assert.equal(active.idHash, rotated.idHash);
  assert.equal(active.context.localProjectId, 2);
  assert.equal(backing.records.size, 1);
});

test('failed upstream logout keeps the local session available for retry', async () => {
  const config = integrationConfig();
  const context = platformContext('logout-retry', 45);
  const client = {
    login: async () => { throw new Error('not used'); },
    exchange: async () => ({ context, localToken: 'local-logout-retry' }),
    current: async () => context,
    logout: async () => { throw new Error('upstream unavailable'); },
  };
  const sessions = new IntegrationSessionService(config, new MemoryIntegrationSessionRepository());
  const credentials = await createTestSession(sessions, context, {
    externalToken: 'retry-token', localToken: 'local-logout-retry',
  });
  const integration = {
    config,
    client,
    sessions,
  };
  await withServer(baseConfig({ integration: config }), createMemoryRepositories(), async (base) => {
    const { cookie, binding } = credentials;

    let response = await fetch(`${base}/api/platform/auth/logout`, {
      method: 'POST', headers: { cookie, 'x-canvas-session-binding': binding },
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'platform_logout_failed');

    response = await fetch(`${base}/api/platform/context`, {
      headers: { cookie, 'x-canvas-session-binding': binding },
    });
    assert.equal(response.status, 200);
  }, integration);
});

test('context identity mutation invalidates the session', async () => {
  const config = integrationConfig();
  const original = platformContext('stable-user', 9);
  const client = {
    login: async () => { throw new Error('not used'); },
    exchange: async () => ({ context: original, localToken: 'local-stable' }),
    current: async () => ({ ...original, localProjectId: 10 }),
    logout: async () => {},
  };
  const sessions = new IntegrationSessionService(config, new MemoryIntegrationSessionRepository());
  const credentials = await createTestSession(sessions, original, {
    externalToken: 'ticket', localToken: 'local-stable',
  });
  const integration = {
    config,
    client,
    sessions,
  };
  await withServer(baseConfig({ integration: config }), createMemoryRepositories(), async (base) => {
    const { cookie, binding } = credentials;
    let response = await fetch(`${base}/api/platform/context`, {
      headers: { cookie, 'x-canvas-session-binding': binding },
    });
    assert.equal(response.status, 401);
    response = await fetch(`${base}/api/platform/context`, {
      headers: { cookie, 'x-canvas-session-binding': binding },
    });
    assert.equal(response.status, 401);
  }, integration);
});

test('identity validation, canonical namespaces and cross-site POST checks fail closed', async () => {
  assert.throws(
    () => new IntegrationSessionService(integrationConfig({ sessionSecret: 'too-short' }), new MemoryIntegrationSessionRepository()),
    /at least 32 UTF-8 bytes/,
  );
  const first = platformContext('a:b', 1, { sourceSystem: 'c' });
  const second = platformContext('b', 1, { sourceSystem: 'c:a' });
  assert.notEqual(deriveStorageNamespace(first), deriveStorageNamespace(second));
  assert.equal(deriveStorageNamespace(first), deriveStorageNamespace({ ...first }));

  const validationSessions = new IntegrationSessionService(integrationConfig(), new MemoryIntegrationSessionRepository());
  const responseStub = { setHeader() {} };
  await assert.doesNotReject(
    validationSessions.create(responseStub, platformContext('projectless', null, { externalProjectId: null }), { localToken: 'token' }),
  );
  await assert.rejects(
    validationSessions.create(responseStub, platformContext('x', 1, { sourceSystem: '' }), { localToken: 'token' }),
    /invalid source system/,
  );
  await assert.rejects(
    validationSessions.create(responseStub, platformContext('x', Number.MAX_SAFE_INTEGER + 1), { localToken: 'token' }),
    /invalid local project context/,
  );

  let logins = 0;
  const config = integrationConfig();
  const client = {
    login: async () => {
      logins += 1;
      return {
        context: platformContext('x', 1), localToken: 'local-x', externalToken: 'external-x', refreshToken: null,
      };
    },
    exchange: async () => { throw new Error('not used'); },
    current: async () => platformContext('x', 1),
    logout: async () => {},
  };
  const integration = {
    config,
    client,
    sessions: new IntegrationSessionService(config, new MemoryIntegrationSessionRepository()),
  };
  await withServer(baseConfig({ integration: config }), createMemoryRepositories(), async (base) => {
    const response = await fetch(`${base}/api/platform/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ username: 'x', password: 'password' }),
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(logins, 0);
  }, integration);
});

test('enabled Integration returns 503 for Dream requests until runtime is ready', async () => {
  const config = integrationConfig();
  await withServer(baseConfig({ integration: config }), createMemoryRepositories(), async (base) => {
    const response = await fetch(`${base}/__dream_api_proxy/test`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).detail, 'Platform integration is not ready');
    const storageResponse = await fetch(`${base}/api/storage/documents/canvas/unready`);
    assert.equal(storageResponse.status, 503);
  });
});

test('session ciphertext is bound to both token kind and session id', async () => {
  const records = new Map();
  const repository = {
    get: async (key) => records.get(key) || null,
    save: async (record) => records.set(record.sessionIdHash, structuredClone(record)),
    updateExisting: async (record) => {
      if (!records.has(record.sessionIdHash)) return false;
      records.set(record.sessionIdHash, structuredClone(record));
      return true;
    },
    delete: async (key) => records.delete(key),
  };
  const sessions = new IntegrationSessionService(integrationConfig(), repository);
  const cookies = [];
  const response = { setHeader: (name, value) => { if (name === 'set-cookie') cookies.push(value.split(';', 1)[0]); } };
  const firstSession = await sessions.create(response, platformContext('cipher-a', 1), {
    externalToken: 'external-a', localToken: 'local-a',
  });
  const secondSession = await sessions.create(response, platformContext('cipher-b', 2), {
    externalToken: 'external-b', localToken: 'local-b',
  });
  const firstRecord = records.get(firstSession.idHash);
  const secondRecord = records.get(secondSession.idHash);

  secondRecord.localTokenCiphertext = firstRecord.externalTokenCiphertext;
  await repository.save(secondRecord);
  assert.equal(await sessions.resolve({ headers: { cookie: cookies[1] } }), null);
  assert.equal(records.has(secondSession.idHash), false);
});

test('disabled integration preserves anonymous storage and browser-provided Dream authorization', async () => {
  let authorization;
  const upstream = http.createServer((request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(200, { 'content-length': '2' });
    response.end('{}');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const { port } = upstream.address();
  try {
    await withServer(baseConfig({
      integration: { ...integrationConfig(), enabled: false },
      dreamProxy: { baseUrl: `http://127.0.0.1:${port}`, tlsServerName: '', disableSni: false, timeoutMs: 5000 },
    }), createMemoryRepositories(), async (base) => {
      let response = await fetch(`${base}/api/platform/config`);
      assert.deepEqual(await response.json(), { enabled: false });
      response = await fetch(`${base}/api/storage/documents/canvas/anonymous`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: true }),
      });
      assert.equal(response.status, 200);
      response = await fetch(`${base}/__dream_api_proxy/test`, { headers: { authorization: 'Bearer fixed-browser-token' } });
      assert.equal(response.status, 200);
      assert.equal(authorization, 'Bearer fixed-browser-token');
    });
  } finally {
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }
});
