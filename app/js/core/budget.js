// Orçamento diário dinâmico: função pura, sem DOM e sem armazenamento.

import { addDays, diffDays } from './dates.js';
import { openEvents, flowInto } from './schedule.js';

export const FALLBACK_HORIZON_DAYS = 30;
// Até onde procuramos o próximo salário (cobre salários trimestrais/irregulares).
const SALARY_SEARCH_DAYS = 400;

export function spendingAccountIds(state) {
  return new Set((state.accounts || []).filter((a) => a.kind === 'spending').map((a) => a.id));
}

/** Soma dos gastos lançados hoje que saíram de contas de gasto. */
export function spentOn(state, day, ids = spendingAccountIds(state)) {
  return (state.transactions || [])
    .filter((t) => t.type === 'spend' && t.date === day && ids.has(t.from))
    .reduce((s, t) => s + t.amount, 0);
}

/**
 * Próximo salário ainda não recebido com data depois de hoje. Se hoje é dia
 * de salário, o de hoje fica de fora e o horizonte vai até o do mês seguinte.
 * Sem receita marcada como salário, usa a próxima receita qualquer.
 */
export function nextSalary(state, today) {
  const future = openEvents(state, today, addDays(today, SALARY_SEARCH_DAYS))
    .filter((e) => e.kind === 'income' && e.date > today);
  return future.find((e) => e.isSalary) || future[0] || null;
}

/**
 * Calcula quanto pode ser gasto hoje.
 *
 * 1. Dinheiro gastável = soma dos saldos das contas de gasto, no início do dia
 *    (os gastos de hoje são somados de volta).
 * 2. Horizonte = hoje … véspera do próximo salário.
 * 3. Para cada dia k: disponível_k = gastável + receitas previstas até k −
 *    despesas e aportes previstos até k. Orçamento = min(disponível_k ÷ dias até k).
 *
 * Transferências entre contas de gasto não mudam a soma, logo não mudam o orçamento.
 */
export function computeDailyBudget(state, today) {
  const ids = spendingAccountIds(state);
  const spendableNow = (state.accounts || [])
    .filter((a) => ids.has(a.id))
    .reduce((s, a) => s + a.balance, 0);
  const spentToday = spentOn(state, today, ids);
  const spendableStart = spendableNow + spentToday;

  const salary = nextSalary(state, today);
  const horizonEnd = salary
    ? addDays(salary.date, -1)
    : addDays(today, FALLBACK_HORIZON_DAYS - 1);
  const days = diffDays(today, horizonEnd) + 1;

  const events = openEvents(state, today, horizonEnd);
  let cumulative = 0;
  let i = 0;
  let best = Infinity;
  let limitingDay = today;
  for (let k = 0; k < days; k++) {
    const day = addDays(today, k);
    while (i < events.length && events[i].effectiveDate <= day) {
      cumulative += flowInto(events[i], ids);
      i++;
    }
    const perDay = (spendableStart + cumulative) / (k + 1);
    if (perDay < best) {
      best = perDay;
      limitingDay = day;
    }
  }

  const dailyBudget = Math.round(best);
  return {
    today,
    dailyBudget,
    spentToday,
    remainingToday: dailyBudget - spentToday,
    spendableNow,
    spendableStart,
    horizonEnd,
    days,
    limitingDay,
    nextSalary: salary,
  };
}
