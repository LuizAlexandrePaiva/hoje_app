// Estado do app salvo no aparelho (localStorage) + ações que o modificam.
// Nenhum dado pessoal vive no código: tudo vem do assistente de configuração.

import { applyTransaction, revertTransaction } from './ledger.js';
import { todayISO, isValidISO } from '../core/dates.js';
import { DEFAULT_REFILL } from '../core/refill.js';
import { parseInvoiceKey, sanitizeInvoices } from '../core/invoice.js';

const KEY = 'hoje:v1';
export const SCHEMA_VERSION = 1;
/** Tamanho máximo de um nome (lançamento ou gasto de fatura). */
export const NAME_MAX = 60;

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
      cushion: 0, // margem de segurança: centavos que o limite nunca usa
      savingsEnabled: true, // sugerir quanto guardar de cada receita
      savingsAccountId: null, // última conta de meta usada como destino
    },
    incomes: [],
    expenses: [],
    goals: [],
    contributions: [],
    settled: {},
    moved: {}, // datas mudadas de ocorrências: { chave: 'AAAA-MM-DD' }
    invoices: {}, // faturas de cartão: { chave da ocorrência: { items: [{ id, name, amount }], closed? } }
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
  s.invoices = sanitizeInvoices(s.invoices, s.expenses, NAME_MAX);
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

/** Receita avulsa que já caiu: entra no saldo agora. */
export function addIncome(amount, desc = '', accountId = state.settings.defaultAccountId) {
  return commit((s) => applyTransaction(s, tx({ type: 'income', amount, to: accountId, desc })));
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

/** Guarda parte de uma receita: transferência da conta dela para uma conta de meta. */
export function saveFromIncome(incomeId, amount, toAccountId) {
  return commit((s) => {
    const inc = s.transactions.find((t) => t.id === incomeId && t.type === 'income');
    if (!inc) return null;
    delete inc.savingSkipped;
    s.settings.savingsAccountId = toAccountId;
    return applyTransaction(s, tx({
      type: 'transfer', amount, from: inc.to, to: toAccountId,
      desc: inc.desc ? `Poupança: ${inc.desc}`.slice(0, NAME_MAX) : 'Poupança', savingOf: inc.id,
    }));
  });
}

/** "Desta vez não": dispensa (ou reabre) a sugestão de poupança de uma receita. */
export function skipSaving(incomeId, skipped = true) {
  commit((s) => {
    const inc = s.transactions.find((t) => t.id === incomeId);
    if (!inc) return;
    if (skipped) inc.savingSkipped = true; else delete inc.savingSkipped;
  });
}

/** Dá ou troca o nome de um lançamento (vazio remove o nome). */
export function renameTransaction(id, name) {
  commit((s) => {
    const t = s.transactions.find((x) => x.id === id);
    if (t) t.desc = String(name || '').trim().slice(0, NAME_MAX);
  });
}

/** Nomes mais recentes de um tipo de lançamento, sem repetir, para sugerir ao digitar. */
export function recentNames(type = 'spend', limit = 20) {
  const seen = new Set();
  const out = [];
  for (let i = state.transactions.length - 1; i >= 0 && out.length < limit; i--) {
    const t = state.transactions[i];
    const name = t.type === type && t.desc?.trim();
    if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name); }
  }
  return out;
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
    if (collection === 'expenses') {
      // as faturas do cartão saem junto com a despesa
      for (const key of Object.keys(s.invoices)) if (parseInvoiceKey(key)?.expenseId === id) delete s.invoices[key];
    }
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
/**
 * Garante uma conta de gastos do dia válida e uma reserva coerente.
 * Ao cadastrar contas (autoReserve) a reserva é escolhida sozinha; quando a
 * pessoa muda os papéis, "sem reserva" é respeitado.
 */
function fixAccountRoles(s, { autoReserve = true } = {}) {
  const spending = s.accounts.filter((a) => a.kind === 'spending');
  const ok = (id) => spending.some((a) => a.id === id);
  if (!ok(s.settings.defaultAccountId)) s.settings.defaultAccountId = spending[0]?.id || null;
  const reserve = s.settings.reserveAccountId;
  const invalid = !ok(reserve) || reserve === s.settings.defaultAccountId;
  if (invalid && (autoReserve || reserve)) {
    s.settings.reserveAccountId = autoReserve ? spending.find((a) => a.id !== s.settings.defaultAccountId)?.id || null : null;
  }
}

export function updateSettings(patch) {
  commit((s) => {
    Object.assign(s.settings, patch);
    if (patch.refill) s.settings.refill = { ...s.settings.refill, ...patch.refill };
    fixAccountRoles(s, { autoReserve: false });
  });
}

/**
 * Papel de uma conta de gasto: 'spend' (gastos do dia), 'reserve' (de onde
 * vêm os resgates) ou 'none'. Trocar a de gastos com a reserva inverte as duas.
 * Devolve a conta que assumiu os gastos do dia, se mudou por consequência.
 */
export function setAccountRole(id, role) {
  return commit((s) => {
    const st = s.settings;
    const others = s.accounts.filter((a) => a.kind === 'spending' && a.id !== id);
    if (role === 'spend') {
      if (st.reserveAccountId === id) st.reserveAccountId = st.defaultAccountId !== id ? st.defaultAccountId : null;
      st.defaultAccountId = id;
      return null;
    }
    let moved = null;
    if (st.defaultAccountId === id) {
      if (!others.length) return null; // sempre existe uma conta para os gastos do dia
      st.defaultAccountId = others[0].id;
      moved = others[0];
    }
    if (role === 'reserve') st.reserveAccountId = id;
    else if (st.reserveAccountId === id) st.reserveAccountId = null;
    fixAccountRoles(s, { autoReserve: false });
    return moved;
  });
}

export function setSetupStep(step) {
  commit((s) => { s.setupStep = step; });
}

export function finishSetup() {
  commit((s) => { s.setupDone = true; delete s.setupStep; });
}

// ---------- faturas de cartão ----------

/** A fatura da chave (ou null). Lança se a despesa não existe mais ou deixou de ser cartão. */
function invoiceOf(s, key) {
  const p = parseInvoiceKey(key);
  const exp = p && s.expenses.find((e) => e.id === p.expenseId);
  if (!exp || !exp.isCard) throw new Error('Esta fatura não existe mais.');
  return s.invoices[key] || null;
}

function cleanItem({ name, amount } = {}) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Informe o valor.');
  return { name: String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX), amount };
}

/** Lança um gasto na fatura (o primeiro cria a fatura). `at` é a posição, para desfazer uma remoção. */
export function addInvoiceItem(key, input, at = null) {
  const clean = cleanItem(input);
  return commit((s) => {
    const inv = invoiceOf(s, key) || { items: [] };
    const item = { id: newId('it'), ...clean };
    const i = Number.isInteger(at) && at >= 0 && at <= inv.items.length ? at : inv.items.length;
    inv.items.splice(i, 0, item);
    s.invoices[key] = inv;
    return item;
  });
}

/** Troca nome e valor de um gasto. Devolve o gasto, ou null se ele não existe mais. */
export function updateInvoiceItem(key, itemId, input) {
  const clean = cleanItem(input);
  return commit((s) => {
    const item = invoiceOf(s, key)?.items.find((x) => x.id === itemId);
    return item ? Object.assign(item, clean) : null;
  });
}

/**
 * Remove um gasto; sem gastos, a fatura deixa de existir.
 * Devolve { item, index, closed } (o que "Desfazer" precisa) ou null.
 */
export function removeInvoiceItem(key, itemId) {
  return commit((s) => {
    const inv = invoiceOf(s, key);
    const index = inv ? inv.items.findIndex((x) => x.id === itemId) : -1;
    if (index < 0) return null;
    const closed = inv.closed === true;
    const [item] = inv.items.splice(index, 1);
    if (!inv.items.length) delete s.invoices[key];
    return { item, index, closed };
  });
}

/** Fecha a fatura (o mês passa a valer a soma dos gastos) ou reabre. Devolve se mudou. */
export function setInvoiceClosed(key, closed) {
  return commit((s) => {
    const inv = invoiceOf(s, key);
    if (!inv || (inv.closed === true) === !!closed) return false;
    if (closed) inv.closed = true; else delete inv.closed;
    return true;
  });
}

/** Nomes já usados nas faturas de um cartão, dos mais recentes aos mais antigos, sem repetir. */
export function invoiceNames(expenseId, limit = 20) {
  const seen = new Set();
  const out = [];
  const keys = Object.keys(state.invoices).filter((k) => parseInvoiceKey(k)?.expenseId === expenseId).sort().reverse();
  for (const k of keys) {
    const items = state.invoices[k].items;
    for (let i = items.length - 1; i >= 0 && out.length < limit; i--) {
      const name = items[i].name;
      if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name); }
    }
  }
  return out;
}
