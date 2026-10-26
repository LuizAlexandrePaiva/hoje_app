// Cobertura da conta padrão (onde saem os gastos) e sugestão de resgate da
// conta de reserva (CDB). Funções puras.

import { addDays, diffDays } from './dates.js';
import { openEvents } from './schedule.js';
import { ceilTo, floorTo } from './money.js';

export const DEFAULT_REFILL = {
  thresholdDays: 3, // avisa quando a cobertura fica abaixo disso
  targetDays: 7, // dias que um resgate deve cobrir
  step: 5000, // arredondamento: múltiplos de R$ 50
};

const MAX_COVERAGE_DAYS = 365;

function account(state, id) {
  return (state.accounts || []).find((a) => a.id === id) || null;
}

/** Débitos previstos da conta (despesas fixas e aportes) por dia efetivo. */
function debitsByDay(state, today, to, accountId) {
  const map = new Map();
  for (const e of openEvents(state, today, to)) {
    if ((e.kind === 'expense' || e.kind === 'contribution') && e.accountId === accountId) {
      map.set(e.effectiveDate, (map.get(e.effectiveDate) || 0) + e.amount);
    }
  }
  return map;
}

/**
 * Quantos dias o saldo da conta padrão aguenta gastando o orçamento diário,
 * descontando os compromissos debitados dela. Hoje conta só o restante do dia.
 */
export function coverageDays(state, today, budget) {
  const acc = account(state, state.settings?.defaultAccountId);
  if (!acc) return null;
  const daily = budget.dailyBudget;
  if (daily <= 0) return null;
  const debits = debitsByDay(state, today, addDays(today, MAX_COVERAGE_DAYS), acc.id);
  let bal = acc.balance;
  let days = 0;
  for (let i = 0; i < MAX_COVERAGE_DAYS; i++) {
    const day = addDays(today, i);
    bal -= debits.get(day) || 0;
    const need = i === 0 ? Math.max(budget.remainingToday, 0) : daily;
    if (bal < 0 || bal < need) break;
    bal -= need;
    days++;
  }
  return days;
}

/**
 * Sugestão de resgate reserva → conta padrão.
 * valor = orçamento × dias do período + compromissos da conta padrão no período
 *         − saldo atual da conta padrão,
 * arredondado para cima em múltiplos de `step` e limitado ao saldo da reserva.
 * Se uma receita cair na conta padrão antes do fim do período, o período
 * termina na véspera da chegada dela.
 */
export function suggestRefill(state, today, budget) {
  const cfg = { ...DEFAULT_REFILL, ...(state.settings?.refill || {}) };
  const acc = account(state, state.settings?.defaultAccountId);
  const reserve = account(state, state.settings?.reserveAccountId);
  const coverage = coverageDays(state, today, budget);
  const base = { coverage, show: false, amount: 0, raw: 0, periodDays: 0, cutByIncome: null, commitments: 0, cappedByReserve: false, thresholdDays: cfg.thresholdDays };
  if (!acc || !reserve || reserve.id === acc.id) return base;

  let periodDays = cfg.targetDays;
  const lastDay = addDays(today, periodDays - 1);
  const incoming = openEvents(state, today, lastDay)
    .find((e) => e.kind === 'income' && e.accountId === acc.id && e.date > today);
  if (incoming) periodDays = diffDays(today, incoming.date);
  const periodEnd = addDays(today, periodDays - 1);

  let commitments = 0;
  for (const [day, v] of debitsByDay(state, today, periodEnd, acc.id)) {
    if (day <= periodEnd) commitments += v;
  }

  const daily = Math.max(budget.dailyBudget, 0);
  // hoje conta só o que ainda resta (o saldo já reflete o que foi gasto)
  const need = Math.max(budget.remainingToday, 0) + daily * (periodDays - 1);
  const raw = need + commitments - acc.balance;
  let amount = raw > 0 ? ceilTo(raw, cfg.step) : 0;
  let cappedByReserve = false;
  if (amount > reserve.balance) {
    amount = Math.max(reserve.balance, 0);
    cappedByReserve = true;
  }
  const low = coverage == null ? acc.balance < 0 : coverage < cfg.thresholdDays;
  return {
    ...base,
    show: amount > 0 && (low || acc.balance < 0),
    amount,
    raw,
    periodDays,
    periodEnd,
    cutByIncome: incoming || null,
    commitments,
    cappedByReserve,
    fromAccountId: reserve.id,
    toAccountId: acc.id,
  };
}

/**
 * Sugere aplicar o excedente da conta padrão na reserva quando ela tem bem
 * mais do que precisa para o período (o dobro ou mais).
 */
export function suggestSurplus(state, today, budget) {
  const cfg = { ...DEFAULT_REFILL, ...(state.settings?.refill || {}) };
  const acc = account(state, state.settings?.defaultAccountId);
  const reserve = account(state, state.settings?.reserveAccountId);
  if (!acc || !reserve || reserve.id === acc.id || budget.dailyBudget <= 0) return null;
  if (state.settings?.surplusEnabled === false) return null;
  const periodEnd = addDays(today, cfg.targetDays - 1);
  let commitments = 0;
  for (const [, v] of debitsByDay(state, today, periodEnd, acc.id)) commitments += v;
  const keep = Math.max(budget.remainingToday, 0) + budget.dailyBudget * (cfg.targetDays - 1) + commitments;
  const surplus = acc.balance - keep;
  if (surplus < keep || surplus < cfg.step) return null;
  return { amount: floorTo(surplus, cfg.step), keep, fromAccountId: acc.id, toAccountId: reserve.id };
}
