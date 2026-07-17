import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMemoryRepositories, createStorageServer, loadConfig } from '../dist/server.js';

async function withServer(config, repos, fn) {
  const server = await createStorageServer({ config, repos });
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
    maxFileBytes: 8,
    maxDocumentBytes: 1024 * 1024,
    mysql: { host: '127.0.0.1', port: 3306, database: 'x', user: 'x', password: '', connectionLimit: 1, connectAttempts: 1, connectRetryMs: 100, ssl: false },
    ...overrides,
  };
}

test('configuration rejects unknown drivers instead of silently changing storage', () => {
  assert.throws(() => loadConfig({ DATA_STORAGE_DRIVER: 'typo' }), /browser or mysql/);
  assert.equal(loadConfig({}).maxFileBytes, 128 * 1024 * 1024);
  assert.equal(loadConfig({}).maxDocumentBytes, 16 * 1024 * 1024);
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
