// API do backup na nuvem, independente do Netlify (o armazenamento é injetado).
// Guarda apenas envelopes já cifrados no aparelho; o servidor não tem a chave.
//
//   GET    /api/sync         → { rev, data }   (404 se não existe)
//   GET    /api/sync?meta=1  → { rev, updatedAt }
//   PUT    /api/sync         { data, baseRev } → { rev }  (409 se outro aparelho gravou antes)
//   DELETE /api/sync
//
// O identificador vai no cabeçalho x-hoje-id (derivado do código de recuperação).
// rev é um contador guardado nos metadados: o aparelho informa a revisão que
// conhece e só grava se ela ainda for a atual. Quando o armazenamento informa
// o ETag, a gravação também é atômica (onlyIfMatch / onlyIfNew).

export const MAX_BYTES = 5 * 1024 * 1024;
const ID_RE = /^[0-9a-f]{64}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function validEnvelope(d) {
  return d && d.v === 1 && (d.z === 0 || d.z === 1)
    && typeof d.iv === 'string' && B64_RE.test(d.iv)
    && typeof d.ct === 'string' && B64_RE.test(d.ct)
    && typeof d.updatedAt === 'string' && d.updatedAt.length <= 40;
}

const revOf = (m) => Number(m?.metadata?.rev) || 0;

async function conflict(store, key) {
  const m = await store.getMetadata(key, { consistency: 'strong' });
  return json(409, { error: 'conflict', rev: revOf(m), updatedAt: m?.metadata?.updatedAt ?? null });
}

export async function handleSync(req, store) {
  const id = req.headers.get('x-hoje-id') || '';
  if (!ID_RE.test(id)) return json(400, { error: 'invalid_id' });
  const key = `v1/${id}`;

  if (req.method === 'GET') {
    if (new URL(req.url).searchParams.get('meta') === '1') {
      const m = await store.getMetadata(key, { consistency: 'strong' });
      if (!m) return json(404, { error: 'not_found' });
      return json(200, { rev: revOf(m), updatedAt: m.metadata?.updatedAt ?? null });
    }
    const r = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (!r) return json(404, { error: 'not_found' });
    return json(200, { rev: revOf(r), data: r.data });
  }

  if (req.method === 'PUT') {
    if (Number(req.headers.get('content-length') || 0) > MAX_BYTES) return json(413, { error: 'too_large' });
    const text = await req.text();
    if (text.length > MAX_BYTES) return json(413, { error: 'too_large' });
    let body;
    try { body = JSON.parse(text); } catch { return json(400, { error: 'invalid_json' }); }
    if (!validEnvelope(body?.data)) return json(400, { error: 'invalid_envelope' });
    const baseRev = Number(body.baseRev) || 0;
    const current = await store.getMetadata(key, { consistency: 'strong' });
    if (current && revOf(current) !== baseRev) return conflict(store, key);
    const rev = revOf(current) + 1;
    const opts = { metadata: { rev, updatedAt: body.data.updatedAt } };
    if (!current) opts.onlyIfNew = true;
    else if (current.etag) opts.onlyIfMatch = current.etag;
    const res = await store.setJSON(key, body.data, opts);
    if (!res.modified) return conflict(store, key);
    return json(200, { rev });
  }

  if (req.method === 'DELETE') {
    await store.delete(key);
    return json(200, { ok: true });
  }

  return json(405, { error: 'method_not_allowed' });
}
