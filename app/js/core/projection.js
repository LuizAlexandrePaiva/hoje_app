// Saldo previsto das contas de gasto, dia a dia, para a linha do tempo.

import { addDays, diffDays } from './dates.js';
import { openEvents, flowInto } from './schedule.js';
import { spendingAccountIds, computeDailyBudget, FALLBACK_HORIZON_DAYS } from './budget.js';

export const EXTRA_DAYS = 30;
// Quanto além do fim do gráfico olhamos para achar o salário que fecha o último ciclo.
const LOOKAHEAD_DAYS = 62;

/**
 * Do dia de hoje até a véspera do próximo salário + 30 dias: o saldo ao fim de
 * cada dia, com as receitas, despesas e aportes previstos e gastando o limite
 * de cada dia.
 *
 * - Hoje conta só o que ainda resta; se o limite de hoje já estourou, os
 *   próximos dias seguem o limite de amanhã, que é menor.
 * - A cada salário o limite é refeito, como o app fará no dia: o mesmo cálculo
 *   do orçamento, com o saldo previsto e os eventos até a véspera do salário seguinte.
 *
 * `start` é o saldo de agora; `points[k].balance`, o do fim do dia k.
 */
export function projectBalance(state, today, budget, tomorrow = computeDailyBudget(state, addDays(today, 1))) {
  const ids = spendingAccountIds(state);
  const end = addDays(budget.horizonEnd, EXTRA_DAYS);
  const all = openEvents(state, today, addDays(end, LOOKAHEAD_DAYS));
  const byDay = new Map();
  for (const e of all) {
    if (!byDay.has(e.effectiveDate)) byDay.set(e.effectiveDate, []);
    byDay.get(e.effectiveDate).push(e);
  }
  const flow = (day) => (byDay.get(day) || []).reduce((s, e) => s + flowInto(e, ids), 0);
  // mesma regra do orçamento: o próximo salário ou, sem salário marcado, a próxima receita
  const nextPayday = (after) => {
    const incomes = all.filter((e) => e.kind === 'income' && e.date > after);
    return (incomes.find((e) => e.isSalary) || incomes[0])?.date ?? null;
  };

  const points = [];
  let balance = budget.spendableNow;
  const push = (day, spend) => {
    balance += flow(day) - spend;
    const k = points.length;
    // o limite é arredondado ao centavo; esse resto não é saldo negativo de verdade
    const rounding = balance < 0 && balance > -(k + 1);
    points.push({ date: day, balance: rounding ? 0 : balance, dayEvents: byDay.get(day) || [] });
  };

  // ciclo atual: até a véspera do próximo salário
  const restToday = Math.max(budget.remainingToday, 0);
  const daily = Math.max(budget.remainingToday >= 0 ? budget.dailyBudget : tomorrow.dailyBudget, 0);
  for (let day = today; day <= budget.horizonEnd; day = addDays(day, 1)) push(day, day === today ? restToday : daily);

  // ciclos seguintes: limite refeito no dia do salário
  let cursor = addDays(budget.horizonEnd, 1);
  while (cursor <= end) {
    const payday = nextPayday(cursor);
    const cycleEnd = payday ? addDays(payday, -1) : addDays(cursor, FALLBACK_HORIZON_DAYS - 1);
    let cumulative = 0;
    let best = Infinity;
    for (let day = cursor, n = 1; day <= cycleEnd; day = addDays(day, 1), n++) {
      cumulative += flow(day);
      best = Math.min(best, (balance + cumulative) / n);
    }
    const limit = Math.max(Math.round(best), 0);
    for (let day = cursor; day <= cycleEnd && day <= end; day = addDays(day, 1)) push(day, limit);
    cursor = addDays(cycleEnd, 1);
  }

  return { start: budget.spendableNow, points, events: all.filter((e) => e.effectiveDate <= end), end, days: diffDays(today, end) + 1 };
}
