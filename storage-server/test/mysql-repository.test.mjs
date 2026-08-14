import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MysqlIntegrationSessionRepository } from '../dist/mysql-repository.js';

function projectlessRecord() {
  const now = new Date().toISOString();
  return {
    sessionIdHash: 'a'.repeat(64),
    context: {
      authenticated: true,
      uid: 'projectless-user',
      username: 'alice',
      nickname: 'Alice',
      permissionIds: [],
      currentPoints: null,
      localProjectId: null,
      externalProjectId: null,
      sourceSystem: 'multi_user_platform',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    externalTokenCiphertext: 'external-ciphertext',
    refreshTokenCiphertext: null,
    localTokenCiphertext: 'local-ciphertext',
    sessionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    createdAt: now,
    updatedAt: now,
  };
}

test('MySQL integration sessions preserve a nullable local project id', async () => {
  const record = projectlessRecord();
  const calls = [];
  const row = {
    session_id_hash: record.sessionIdHash,
    uid: record.context.uid,
    username: record.context.username,
    nickname: record.context.nickname,
    permission_ids: JSON.stringify(record.context.permissionIds),
    current_points: null,
    local_project_id: null,
    external_project_id: null,
    source_system: record.context.sourceSystem,
    external_token_ciphertext: record.externalTokenCiphertext,
    refresh_token_ciphertext: record.refreshTokenCiphertext,
    local_token_ciphertext: record.localTokenCiphertext,
    local_token_expires_at: new Date(record.context.expiresAt),
    session_expires_at: new Date(record.sessionExpiresAt),
    created_at: new Date(record.createdAt),
    updated_at: new Date(record.updatedAt),
  };
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (String(sql).startsWith('SELECT ')) return [[row], []];
      return [{ affectedRows: 1 }, []];
    },
  };
  const repository = new MysqlIntegrationSessionRepository(pool);

  assert.equal((await repository.get(record.sessionIdHash)).context.localProjectId, null);
  await repository.save(record);
  assert.equal(calls.some(({ sql }) => String(sql).startsWith('DELETE ')), false);
  const insert = calls.find(({ sql }) => String(sql).startsWith('INSERT INTO integration_sessions'));
  assert.equal(insert.params[6], null);
});

test('projectless session migration and manual schema both keep local_project_id nullable', async () => {
  const migration = await readFile(new URL('../migrations/004_projectless_integration_sessions.sql', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../../database/infinite_canvas.sql', import.meta.url), 'utf8');
  assert.match(migration, /MODIFY local_project_id BIGINT NULL/i);
  assert.match(schema, /local_project_id BIGINT NULL/i);
  assert.doesNotMatch(schema, /004_projectless_integration_sessions/);
});
