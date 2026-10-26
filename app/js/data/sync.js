// Backup na nuvem com criptografia no aparelho.
// Cada mudança é cifrada e enviada (com um pequeno atraso); ao abrir o app,
// a versão da nuvem é buscada. Se os dois lados mudaram, ninguém sobrescreve
// ninguém sem perguntar: onConflict decide.

import { generateCode, normalizeCode, deriveKeys, encrypt, decrypt } from '../core/vault.js';
import * as store from './store.js';

const CFG_KEY = 'hoje:sync';
const API = '/api/sync';
const PUSH_DELAY = 1500;
const RETRY_DELAY = 30000;

let cfg = loadCfg();
let keys = null;
let status = cfg.enabled ? (cfg.dirty ? 'pending' : 'synced') : 'off';
let errorMsg = null;
let timer = null;
let busy = false;
let applying = false;
let handlers = {};
const listeners = new Set();

function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY));
    if (c && c.enabled && normalizeCode(c.code)) return c;
  } catch { /* sem configuração */ }
  return { enabled: false };
}

function saveCfg() {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

function setStatus(s, msg = null) {
  status = s;
  errorMsg = msg;
  listeners.forEach((fn) => fn(getStatus()));
}

export function getStatus() {
  return { status, error: errorMsg, enabled: !!cfg.enabled, lastSyncAt: cfg.lastSyncAt || null, code: cfg.enabled ? cfg.code : null };
}

export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function getKeys() {
  if (!keys) keys = await deriveKeys(cfg.code);
  return keys;
}

async function api(method, id, { body, query = '' } = {}) {
  const res = await fetch(API + query, {
    method,
    cache: 'no-store',
    headers: { 'x-hoje-id': id, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* corpo vazio */ }
  return { status: res.status, data };
}

function failed(e) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  setStatus(offline ? 'offline' : 'error', offline ? null : String(e?.message || e));
  clearTimeout(timer);
  timer = setTimeout(syncNow, RETRY_DELAY);
}

function apply(remote, rev) {
  applying = true;
  try { store.replaceState(remote); } finally { applying = false; }
  cfg.rev = rev;
  cfg.dirty = false;
  cfg.lastSyncAt = new Date().toISOString();
  saveCfg();
}

/** Liga o backup ao app. Chame uma vez, depois de store.load(). */
export function init(h = {}) {
  handlers = h;
  store.subscribe(() => {
    if (applying || !cfg.enabled) return;
    cfg.dirty = true;
    saveCfg();
    setStatus('pending');
    clearTimeout(timer);
    timer = setTimeout(push, PUSH_DELAY);
  });
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  syncNow();
}

export async function syncNow() {
  if (!cfg.enabled) return;
  if (cfg.dirty) await push();
  else await pull();
}

async function push() {
  if (!cfg.enabled) return;
  if (busy) { clearTimeout(timer); timer = setTimeout(push, PUSH_DELAY); return; }
  busy = true;
  setStatus('syncing');
  try {
    const { id, key } = await getKeys();
    for (let attempt = 0; attempt < 2; attempt++) {
      const data = await encrypt(store.getState(), key);
      const r = await api('PUT', id, { body: { data, baseRev: cfg.rev || 0 } });
      if (r.status === 200) {
        cfg.rev = r.data.rev;
        cfg.dirty = false;
        cfg.lastSyncAt = new Date().toISOString();
        saveCfg();
        setStatus('synced');
        return;
      }
      if (r.status === 409 && !r.data?.rev) { cfg.rev = 0; continue; } // apagado na nuvem: recria
      if (r.status === 409) {
        setStatus('conflict');
        handlers.onConflict?.({ updatedAt: r.data.updatedAt });
        return;
      }
      throw new Error(`Servidor respondeu ${r.status}`);
    }
  } catch (e) {
    failed(e);
  } finally {
    busy = false;
  }
}

async function pull() {
  if (!cfg.enabled || busy) return;
  busy = true;
  try {
    const { id, key } = await getKeys();
    const meta = await api('GET', id, { query: '?meta=1' });
    if (meta.status === 404) { // nada na nuvem ainda: envia
      cfg.dirty = true;
      saveCfg();
      busy = false;
      await push();
      return;
    }
    if (meta.status !== 200) throw new Error(`Servidor respondeu ${meta.status}`);
    if (meta.data.rev === cfg.rev) {
      cfg.lastSyncAt = new Date().toISOString();
      saveCfg();
      setStatus('synced');
      return;
    }
    if (cfg.dirty) {
      setStatus('conflict');
      handlers.onConflict?.({ updatedAt: meta.data.updatedAt });
      return;
    }
    const full = await api('GET', id);
    if (full.status !== 200) throw new Error(`Servidor respondeu ${full.status}`);
    apply(await decrypt(full.data.data, key), full.data.rev);
    setStatus('synced');
    handlers.onRemoteApplied?.();
  } catch (e) {
    failed(e);
  } finally {
    busy = false;
  }
}

/** Ativa o backup com um código novo. Devolve o código para a pessoa guardar. */
export function enable() {
  const code = generateCode();
  cfg = { enabled: true, code, rev: 0, dirty: true, lastSyncAt: null };
  keys = null;
  saveCfg();
  setStatus('pending');
  push();
  return code;
}

/** Busca o backup do código e substitui os dados deste aparelho. */
export async function restore(input) {
  const code = normalizeCode(input);
  if (!code) throw new Error('Código inválido. Confira as 24 letras e números.');
  const k = await deriveKeys(code);
  let r;
  try { r = await api('GET', k.id); } catch { throw new Error('Sem conexão. Tente de novo com internet.'); }
  if (r.status === 404) throw new Error('Nenhum backup encontrado com esse código.');
  if (r.status !== 200) throw new Error('Não foi possível falar com o servidor.');
  let remote;
  try { remote = await decrypt(r.data.data, k.key); } catch { throw new Error('Não foi possível abrir o backup com esse código.'); }
  cfg = { enabled: true, code, rev: 0, dirty: false, lastSyncAt: null };
  keys = k;
  apply(remote, r.data.rev);
  setStatus('synced');
}

/** Conflito: fica com a versão da nuvem. */
export async function useRemote() {
  const { id, key } = await getKeys();
  const r = await api('GET', id);
  if (r.status !== 200) throw new Error('Não foi possível baixar da nuvem.');
  apply(await decrypt(r.data.data, key), r.data.rev);
  setStatus('synced');
}

/** Conflito: fica com a versão deste aparelho e sobrescreve a da nuvem. */
export async function keepLocal() {
  const { id } = await getKeys();
  const meta = await api('GET', id, { query: '?meta=1' });
  cfg.rev = meta.status === 200 ? meta.data.rev : 0;
  cfg.dirty = true;
  saveCfg();
  await push();
}

/** Desliga o backup; opcionalmente apaga a cópia da nuvem. */
export async function disable({ deleteRemote = false } = {}) {
  if (deleteRemote && cfg.enabled) {
    const { id } = await getKeys();
    await api('DELETE', id);
  }
  cfg = { enabled: false };
  keys = null;
  clearTimeout(timer);
  saveCfg();
  setStatus('off');
}
