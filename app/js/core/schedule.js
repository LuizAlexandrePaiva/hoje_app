// Expande receitas recorrentes, despesas fixas e aportes planejados em
// ocorrências datadas. Cada ocorrência tem uma chave estável usada para
// marcá-la como liquidada (recebida / paga / aportada) em state.settled.

import { iso, parts, addDays, daysInMonth, addMonths, monthKey } from './dates.js';
import { nthBusinessDay } from './businessDays.js';
import { invoiceSummary } from './invoice.js';

/** Data prevista de uma receita/despesa num mês, ou null. */
export function ruleDate(rule, y, m) {
  if (!rule || rule.type === 'once') return null;
  if (rule.type === 'businessDay') {
    return nthBusinessDay(y, m, rule.n, { countSaturday: !!rule.countSaturday });
  }
  // 'fixedDay': dias além do fim do mês caem no último dia
  return iso(y, m, Math.min(rule.day, daysInMonth(y, m)));
}

function amountFor(item, mk) {
  const ex = item.exceptions && item.exceptions[mk];
  return ex != null ? ex : item.amount;
}

/** Quanto uma ocorrência pode ser adiada ou antecipada (dias). */
export const MAX_MOVE_DAYS = 45;

function monthly(item, kind, from, to, moved, invoices = {}) {
  const out = [];
  const a = parts(from);
  const b = parts(to);
  // dois meses de folga em cada ponta: datas mudadas (até 45 dias) e a
  // regra de sábado podem trazer uma ocorrência de outro mês para o período
  for (let { y, m } = addMonths(a.y, a.m, -2); y * 12 + m <= b.y * 12 + b.m + 2; ({ y, m } = addMonths(y, m, 1))) {
    const rule = kind === 'expense' ? { type: 'fixedDay', day: item.day } : item.rule;
    const original = ruleDate(rule, y, m);
    if (!original || (item.since && original < item.since)) continue;
    const mk = iso(y, m, 1).slice(0, 7);
    const key = `${kind}:${item.id}:${mk}`;
    const date = moved[key] || original;
    if (date < from || date > to) continue;
    const occ = {
      key,
      kind,
      sourceId: item.id,
      name: item.name,
      date,
      originalDate: original,
      amount: amountFor(item, mk),
      accountId: item.accountId,
      isSalary: kind === 'income' && !!item.isSalary,
    };
    if (kind === 'expense' && item.isCard) {
      // cartão: a fatura do mês (se houver) decide o valor previsto
      occ.isCard = true;
      occ.invoice = invoiceSummary(occ.amount, invoices[key]);
      occ.amount = occ.invoice.total;
    }
    out.push(occ);
  }
  return out;
}

/** Receita agendada uma única vez (rule.type === 'once'). */
function once(item, from, to, moved) {
  const key = `income:${item.id}:unica`;
  const original = item.rule.date;
  const date = moved[key] || original;
  if (!original || date < from || date > to) return [];
  return [{
    key,
    kind: 'income',
    sourceId: item.id,
    name: item.name,
    date,
    originalDate: original,
    amount: item.amount,
    accountId: item.accountId,
    isSalary: !!item.isSalary,
    once: true,
  }];
}

/**
 * Todas as ocorrências (liquidadas ou não) com data em [from, to].
 * kind: 'income' (crédito em accountId), 'expense' (débito de accountId),
 * 'contribution' (sai de accountId e vai para toAccountId).
 */
export function expandOccurrences(state, from, to) {
  const out = [];
  const moved = state.moved || {};
  for (const inc of state.incomes || []) {
    if (inc.active === false) continue;
    out.push(...(inc.rule?.type === 'once' ? once(inc, from, to, moved) : monthly(inc, 'income', from, to, moved)));
  }
  for (const exp of state.expenses || []) {
    if (exp.active === false) continue;
    out.push(...monthly(exp, 'expense', from, to, moved, state.invoices || {}));
  }
  const goals = new Map((state.goals || []).map((g) => [g.id, g]));
  for (const c of state.contributions || []) {
    if (c.date < from || c.date > to) continue;
    const goal = goals.get(c.goalId);
    if (!goal) continue;
    out.push({
      key: `contribution:${c.id}`,
      kind: 'contribution',
      sourceId: c.id,
      name: `Aporte: ${goal.name}`,
      date: c.date,
      originalDate: c.date,
      amount: c.amount,
      accountId: c.fromAccountId,
      toAccountId: goal.accountId,
      goalId: goal.id,
    });
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/**
 * A ocorrência mensal de uma chave ('expense:id:AAAA-MM' ou 'income:id:AAAA-MM'),
 * paga ou não, em qualquer data. null se a regra não gera esse mês.
 */
export function occurrenceByKey(state, key) {
  const m = /^(income|expense):(.+):(\d{4})-(\d{2})$/.exec(key || '');
  if (!m) return null;
  const kind = m[1];
  const item = ((kind === 'expense' ? state.expenses : state.incomes) || []).find((x) => x.id === m[2]);
  if (!item || item.active === false || (kind === 'income' && item.rule?.type === 'once')) return null;
  const rule = kind === 'expense' ? { type: 'fixedDay', day: item.day } : item.rule;
  const original = ruleDate(rule, Number(m[3]), Number(m[4]));
  if (!original) return null;
  const moved = state.moved || {};
  const date = moved[key] || original;
  return monthly(item, kind, date, date, moved, state.invoices || {}).find((e) => e.key === key) || null;
}

/** Quantos dias para trás procuramos pendências não confirmadas. */
export const PENDING_LOOKBACK_DAYS = 62;

/**
 * Ocorrências ainda não liquidadas até `to`. As vencidas (antes de hoje)
 * continuam previstas e passam a contar como "hoje" (effectiveDate).
 */
export function openEvents(state, today, to) {
  const settled = state.settled || {};
  const from = addDays(today, -PENDING_LOOKBACK_DAYS);
  return expandOccurrences(state, from, to)
    .filter((e) => !settled[e.key])
    .map((e) => ({ ...e, effectiveDate: e.date < today ? today : e.date, overdue: e.date < today }))
    .sort((x, y) => (x.effectiveDate < y.effectiveDate ? -1 : x.effectiveDate > y.effectiveDate ? 1 : 0));
}

/** Até onde procuramos a próxima fatura não paga de um cartão. */
const CARD_SEARCH_DAYS = 400;

/**
 * Fatura atual de cada cartão: a ocorrência não paga mais antiga de cada
 * despesa marcada como cartão, na ordem das despesas.
 */
export function currentInvoices(state, today) {
  const first = new Map();
  for (const e of openEvents(state, today, addDays(today, CARD_SEARCH_DAYS))) {
    if (e.isCard && (!first.has(e.sourceId) || e.date < first.get(e.sourceId).date)) first.set(e.sourceId, e);
  }
  return (state.expenses || []).map((x) => first.get(x.id)).filter(Boolean);
}

/** Pendências que pedem confirmação hoje (vencidas ou de hoje). */
export function pendingConfirmations(state, today) {
  return openEvents(state, today, today);
}

/**
 * Efeito de um evento sobre um conjunto de contas (ex.: contas de gasto).
 * Positivo = entra dinheiro no conjunto.
 */
export function flowInto(event, accountIds) {
  const has = (id) => accountIds.has(id);
  if (event.kind === 'income') return has(event.accountId) ? event.amount : 0;
  if (event.kind === 'expense') return has(event.accountId) ? -event.amount : 0;
  if (event.kind === 'contribution') {
    return (has(event.toAccountId) ? event.amount : 0) - (has(event.accountId) ? event.amount : 0);
  }
  return 0;
}

export { monthKey };
