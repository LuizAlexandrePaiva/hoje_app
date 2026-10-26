// Expande receitas recorrentes, despesas fixas e aportes planejados em
// ocorrências datadas. Cada ocorrência tem uma chave estável usada para
// marcá-la como liquidada (recebida / paga / aportada) em state.settled.

import { iso, parts, addDays, daysInMonth, addMonths, monthKey } from './dates.js';
import { nthBusinessDay } from './businessDays.js';

/** Data prevista de uma receita/despesa num mês, ou null. */
export function ruleDate(rule, y, m) {
  if (!rule) return null;
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

function monthly(item, kind, from, to) {
  const out = [];
  const start = item.since && item.since > from ? item.since : from;
  const a = parts(start);
  const b = parts(to);
  // começa um mês antes: a regra de sábado pode antecipar para o mês anterior
  for (let { y, m } = addMonths(a.y, a.m, -1); y * 12 + m <= b.y * 12 + b.m; ({ y, m } = addMonths(y, m, 1))) {
    const rule = kind === 'expense' ? { type: 'fixedDay', day: item.day } : item.rule;
    const date = ruleDate(rule, y, m);
    if (!date || date < start || date > to) continue;
    const mk = iso(y, m, 1).slice(0, 7);
    out.push({
      key: `${kind}:${item.id}:${mk}`,
      kind,
      sourceId: item.id,
      name: item.name,
      date,
      amount: amountFor(item, mk),
      accountId: item.accountId,
      isSalary: kind === 'income' && !!item.isSalary,
    });
  }
  return out;
}

/**
 * Todas as ocorrências (liquidadas ou não) com data em [from, to].
 * kind: 'income' (crédito em accountId), 'expense' (débito de accountId),
 * 'contribution' (sai de accountId e vai para toAccountId).
 */
export function expandOccurrences(state, from, to) {
  const out = [];
  for (const inc of state.incomes || []) {
    if (inc.active === false) continue;
    out.push(...monthly(inc, 'income', from, to));
  }
  for (const exp of state.expenses || []) {
    if (exp.active === false) continue;
    out.push(...monthly(exp, 'expense', from, to));
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
      amount: c.amount,
      accountId: c.fromAccountId,
      toAccountId: goal.accountId,
      goalId: goal.id,
    });
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
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
