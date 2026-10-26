import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSync, MAX_BYTES } from '../netlify/lib/sync-core.mjs';

// Armazenamento em memória com a mesma semântica de gravação condicional do Netlify Blobs.
// withEtags=false imita o emulador local, que não devolve ETag nas leituras.
function memoryStore({ withEtags = true } = {}) {
  const map = new Map();
  let n = 0;
  const tag = (e) => (withEtags ? e.etag : undefined);
  return {
    async getMetadata(key) { const e = map.get(key); return e ? { etag: tag(e), metadata: e.metadata } : null; },
    async getWithMetadata(key) { const e = map.get(key); return e ? { etag: tag(e), metadata: e.metadata, data: structuredClone(e.data) } : null; },
    async setJSON(key, data, { metadata, onlyIfNew, onlyIfMatch } = {}) {
      const cur = map.get(key);
      if (onlyIfNew && cur) return { modified: false };
      if (onlyIfMatch && (!cur || cur.etag !== onlyIfMatch)) return { modified: false };
      const etag = `"e${++n}"`;
      map.set(key, { data: structuredClone(data), metadata, etag });
      return { modified: true, etag };
    },
    async delete(key) { map.delete(key); },
  };
}

const ID = 'a'.repeat(64);
const env = (tag = 'x') => ({ v: 1, z: 1, iv: 'AAAAAAAAAAAAAAAA', ct: `${tag}AAAA`, updatedAt: '2026-10-26T15:00:00.000Z' });
const req = (method, { id = ID, body, query = '' } = {}) => new Request(`https://hoje.test/api/sync${query}`, {
  method, headers: { 'x-hoje-id': id, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});
const call = async (store, method, opts) => {
  const res = await handleSync(req(method, opts), store);
  return { status: res.status, body: await res.json() };
};

for (const withEtags of [true, false]) {
  const label = withEtags ? 'com ETag' : 'sem ETag nas leituras';

  test(`fluxo (${label}): cria, lê, atualiza pela revisão e apaga`, async () => {
    const store = memoryStore({ withEtags });
    assert.equal((await call(store, 'GET')).status, 404);
    const created = await call(store, 'PUT', { body: { data: env('A'), baseRev: 0 } });
    assert.deepEqual(created, { status: 200, body: { rev: 1 } });
    const got = await call(store, 'GET');
    assert.deepEqual(got.body, { rev: 1, data: env('A') });
    const meta = await call(store, 'GET', { query: '?meta=1' });
    assert.deepEqual(meta.body, { rev: 1, updatedAt: env().updatedAt });
    const updated = await call(store, 'PUT', { body: { data: env('B'), baseRev: 1 } });
    assert.deepEqual(updated.body, { rev: 2 });
    assert.equal((await call(store, 'DELETE')).status, 200);
    assert.equal((await call(store, 'GET')).status, 404);
  });

  test(`conflito (${label}): revisão antiga devolve 409 e não sobrescreve`, async () => {
    const store = memoryStore({ withEtags });
    await call(store, 'PUT', { body: { data: env('A'), baseRev: 0 } });
    await call(store, 'PUT', { body: { data: env('B'), baseRev: 1 } }); // outro aparelho
    const stale = await call(store, 'PUT', { body: { data: env('C'), baseRev: 1 } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.rev, 2);
    assert.equal((await call(store, 'GET')).body.data.ct, 'BAAAA');
    // criar de novo um backup que já existe também é conflito
    assert.equal((await call(store, 'PUT', { body: { data: env('D'), baseRev: 0 } })).status, 409);
  });
}

test('corrida: se o armazenamento recusa a gravação condicional, responde 409', async () => {
  const store = memoryStore();
  await call(store, 'PUT', { body: { data: env('A'), baseRev: 0 } });
  const realSet = store.setJSON;
  store.setJSON = async (key, data, opts) => { // outro aparelho grava entre a leitura e a escrita
    await realSet(key, env('Z'), { metadata: { rev: 2, updatedAt: 'x' } });
    return realSet(key, data, opts);
  };
  const r = await call(store, 'PUT', { body: { data: env('B'), baseRev: 1 } });
  assert.equal(r.status, 409);
  assert.equal(r.body.rev, 2);
});

test('valida id, envelope e tamanho', async () => {
  const store = memoryStore();
  assert.equal((await call(store, 'GET', { id: 'curto' })).status, 400);
  assert.equal((await call(store, 'PUT', { body: { data: { v: 1, iv: 'x', ct: '<script>' } } })).status, 400);
  assert.equal((await call(store, 'PUT', { body: { data: { ...env(), v: 2 } } })).status, 400);
  const big = { data: { ...env(), ct: 'A'.repeat(MAX_BYTES) } };
  assert.equal((await call(store, 'PUT', { body: big })).status, 413);
  assert.equal((await call(store, 'POST', { body: {} })).status, 405);
});
