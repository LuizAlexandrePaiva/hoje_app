// Saldo previsto das contas de gasto, dia a dia, para a linha do tempo.

import { addDays, diffDays } from './dates.js';
import {
  spendingAccountIds, plannedFlows, flowSeries, sustainableRate, lookDaysFor,
  FALLBACK_HORIZON_DAYS, SCAN_DAYS,
} from './budget.js';

export const EXTRA_DAYS = 30;

/**
 * De hoje até a véspera do próximo salário + 30 dias: o saldo ao fim de cada
 * dia, com o que está previsto acontecendo na data (o que está vencido, hoje)
 * e gastando o limite de cada dia. O limite de cada dia é refeito com o saldo
 * previsto, pela mesma conta que o app fará no dia.
 *
 * `start` é o saldo de agora; `points[k].balance`, o do fim do dia k.
 */
export function projectBalance(state, today, budget) {
  const ids = spendingAccountIds(state);
  const end = addDays(budget.horizonEnd, EXTRA_DAYS);
  const days = diffDays(today, end) + 1;
  const total = days + SCAN_DAYS; // cada dia do gráfico enxerga tanto quanto o app enxergará nele
  const all = plannedFlows(state, today, addDays(today, total - 1), ids);
  const series = flowSeries(all, today, total);
  const byDay = new Map();
  for (const e of all) {
    if (!byDay.has(e.effectiveDate)) byDay.set(e.effectiveDate, []);
    byDay.get(e.effectiveDate).push(e);
  }
  const paydays = all.filter((e) => e.kind === 'income');
  // cada dia só enxerga o que o app lerá nele: ocorrências até `to` = dia + SCAN_DAYS
  const lastIncome = (to) => all.reduce((m, e) => (e.flow > 0 && e.date <= to && e.date > m ? e.date : m), '');
  const cycleEnd = (day, to) => {
    const next = paydays.filter((e) => e.date > day && e.date <= to);
    const sal = next.find((e) => e.isSalary) || next[0];
    return sal ? addDays(sal.date, -1) : addDays(day, FALLBACK_HORIZON_DAYS - 1);
  };
  const lookDays = (day) => {
    const to = addDays(day, SCAN_DAYS);
    return lookDaysFor(day, cycleEnd(day, to), lastIncome(to));
  };

  const cushion = budget.cushion || 0;
  const points = [];
  let balance = budget.spendableNow;
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const limit = i === 0
      ? Math.max(budget.dailyBudget - budget.spentToday, 0)
      : Math.max(sustainableRate(balance - cushion, series, i, lookDays(day)).rate, 0);
    balance += series.net[i] - limit;
    points.push({ date: day, balance, limit, dayEvents: byDay.get(day) || [] });
  }
  return { start: budget.spendableNow, points, events: all.filter((e) => e.effectiveDate <= end), end, days };
}
