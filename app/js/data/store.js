// Estado do app salvo no aparelho (localStorage) + ações que o modificam.
// Nenhum dado pessoal vive no código: tudo vem do assistente de configuração.

import { applyTransaction, revertTransaction } from './ledger.js';
import { todayISO, isValidISO } from '../core/dates.js';
import { DEFAULT_REFILL } from '../core/refill.js';

const KEY = 'hoje:v1';
export const SCHEMA_VERSION = 1;

export function emptyState(today = todayISO()) {
  return {
    version: SCHEMA_VERSION,
    setupDone: false,
    setupStep: 0,
    createdAt: today,
    accounts: [],
    settings: {
      defaultAccountId: null,
      reserveAccountId: null,
      refill: { ...DEFAULT_REFILL },
      surplusEnabled: true,
    },
    incomes: [],
    expenses: [],
    goals: [],
    contributions: [],
    settled: {},
    moved: {}, // datas mudadas de ocorrências: { chave: 'AAAA-MM-DD' }
    transactions: [],
  };
}

export function newId(prefix = 'x') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

let state = null;
const listeners = new Set();

export function getState() {
  return state;
}

export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    state = raw ? normalize(JSON.parse(raw)) : emptyState();
  } catch {
    // Nunca sobrescreve dados que não conseguiu ler: guarda uma cópia antes
    try { if (raw) localStorage.setItem(`${KEY}:ilegivel:${Date.now()}`, raw); } catch { /* sem espaço */ }
    state = emptyState();
  }
  return state;
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Executa uma mutação, salva e avisa a interface. */
export function commit(mutator) {
  const result = mutator(state);
  save();
  listeners.forEach((fn) => fn(state));
  return result;
}

// ---------- validação / backup ----------

function normalize(data) {
  if (!data || typeof data !== 'object') throw new Error('Arquivo inválido');
  const base = emptyState(data.createdAt);
  const s = { ...base, ...data };
  s.settings = { ...base.settings, ...(data.settings || {}) };
  s.settings.refill = { ...DEFAULT_REFILL, ...(s.settings.refill || {}) };
  for (const k of ['accounts', 'incomes', 'expenses', 'goals', 'contributions', 'transactions']) {
    if (!Array.isArray(s[k])) s[k] = [];
  }
  if (!s.settled || typeof s.settled !== 'object') s.settled = {};
  if (!s.moved || typeof s.moved !== 'object') s.moved = {};
  for (const a of s.accounts) {
    if (typeof a.id !== 'string' || !Number.isInteger(a.balance)) throw new Error('Conta inválida no backup');
  }
  return s;
}

export function exportJSON() {
  return JSON.stringify({ app: 'hoje', exportedAt: new Date().toISOString(), ...state }, null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (data.app && data.app !== 'hoje') throw new Error('Este arquivo não é um backup do Hoje');
  replaceState(data);
}

/** Troca todos os dados (backup de arquivo ou da nuvem). */
export function replaceState(data) {
  const copy = { ...data };
  delete copy.app;
  delete copy.exportedAt;
  const next = normalize(copy);
  next.setupDone = next.setupDone || next.accounts.length > 0;
  commit(() => { state = next; });
}

export function resetAll() {
  localStorage.removeItem(KEY);
  state = emptyState();
  listeners.forEach((fn) => fn(state));
}

// ---------- ações ----------

export function getAccount(id) {
  return state.accounts.find((a) => a.id === id) || null;
}

function tx(fields) {
  return { id: newId('t'), createdAt: new Date().toISOString(), date: todayISO(), ...fields };
}

export function addSpend(amount, desc = '', accountId = state.settings.defaultAccountId) {
  return commit((s) => applyTransaction(s, tx({ type: 'spend', amount, from: accountId, desc })));
}

export function transfer(from, to, amount, desc = '') {
  return commit((s) => applyTransaction(s, tx({ type: 'transfer', amount, from, to, desc })));
}

/** Ajuste manual para conferir com o banco: registra a diferença. */
export function adjustBalance(accountId, newBalance) {
  const acc = getAccount(accountId);
  const delta = newBalance - acc.balance;
  if (delta === 0) return null;
  return commit((s) => applyTransaction(s, tx({ type: 'adjust', amount: delta, to: accountId, desc: 'Ajuste de saldo' })));
}

/** Confirma uma ocorrência prevista (Recebeu? / Pagou? / Fez o aporte?). */
export function confirmOccurrence(event, { amount, date }) {
  const base = { amount, date: isValidISO(date) ? date : todayISO(), ref: event.key, desc: event.name };
  const fields =
    event.kind === 'income' ? { type: 'income', to: event.accountId }
      : event.kind === 'expense' ? { type: 'expense', from: event.accountId }
        : { type: 'contribution', from: event.accountId, to: event.toAccountId };
  return commit((s) => applyTransaction(s, tx({ ...base, ...fields })));
}

/** Muda a data prevista de uma ocorrência (receita veio antes/depois, conta adiada). */
export function moveOccurrence(event, date) {
  commit((s) => {
    if (event.kind === 'contribution') {
      const c = s.contributions.find((x) => x.id === event.sourceId);
      if (c) c.date = date;
    } else if (date === event.originalDate) {
      delete s.moved[event.key];
    } else {
      s.moved[event.key] = date;
    }
  });
}

/** "Não veio este mês": fecha a ocorrência sem mexer em saldo. */
export function skipOccurrence(event) {
  commit((s) => { s.settled[event.key] = { date: todayISO(), amount: 0, skipped: true }; });
}

export function deleteTransaction(id) {
  return commit((s) => revertTransaction(s, id));
}

const PREFIX = { accounts: 'a', incomes: 'i', expenses: 'e', goals: 'g', contributions: 'c' };

export function upsert(collection, item) {
  return commit((s) => {
    const list = s[collection];
    if (!item.id) item.id = newId(PREFIX[collection] || 'x');
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...item };
    else list.push(item);
    if (collection === 'accounts') fixAccountRoles(s);
    return item;
  });
}

export function remove(collection, id) {
  commit((s) => {
    s[collection] = s[collection].filter((x) => x.id !== id);
    if (collection === 'goals') s.contributions = s.contributions.filter((c) => c.goalId !== id);
    if (collection === 'accounts') fixAccountRoles(s);
  });
}

/** O que impede apagar uma conta (itens que a usam). */
export function accountUsage(id) {
  const uses = [];
  state.incomes.filter((x) => x.accountId === id).forEach((x) => uses.push(`receita "${x.name}"`));
  state.expenses.filter((x) => x.accountId === id).forEach((x) => uses.push(`despesa "${x.name}"`));
  state.goals.filter((x) => x.accountId === id).forEach((x) => uses.push(`meta "${x.name}"`));
  state.contributions.filter((x) => x.fromAccountId === id).forEach(() => uses.push('aporte planejado'));
  return uses;
}

/** Garante conta padrão e de reserva válidas (contas de gasto). */
function fixAccountRoles(s) {
  const spending = s.accounts.filter((a) => a.kind === 'spending');
  const ok = (id) => spending.some((a) => a.id === id);
  if (!ok(s.settings.defaultAccountId)) s.settings.defaultAccountId = spending[0]?.id || null;
  if (!ok(s.settings.reserveAccountId) || s.settings.reserveAccountId === s.settings.defaultAccountId) {
    s.settings.reserveAccountId = spending.find((a) => a.id !== s.settings.defaultAccountId)?.id || null;
  }
}

export function updateSettings(patch) {
  commit((s) => {
    Object.assign(s.settings, patch);
    if (patch.refill) s.settings.refill = { ...s.settings.refill, ...patch.refill };
    fixAccountRoles(s);
  });
}

export function setSetupStep(step) {
  commit((s) => { s.setupStep = step; });
}

export function finishSetup() {
  commit((s) => { s.setupDone = true; delete s.setupStep; });
}
