// Série diária do saldo projetado das contas de gasto, para a linha do tempo.

import { addDays, diffDays } from './dates.js';
import { openEvents, flowInto } from './schedule.js';
import { spendingAccountIds } from './budget.js';

export const EXTRA_DAYS = 30;

/**
 * Do dia de hoje até a véspera do próximo salário + 30 dias.
 * - `events`: saldo considerando só receitas, despesas e aportes previstos;
 * - `spending`: idem, gastando também o orçamento diário atual todos os dias.
 */
export function projectBalance(state, today, budget) {
  const ids = spendingAccountIds(state);
  const end = addDays(budget.horizonEnd, EXTRA_DAYS);
  const events = openEvents(state, today, end);
  const points = [];
  let cumulative = 0;
  let i = 0;
  const n = diffDays(today, end) + 1;
  for (let k = 0; k < n; k++) {
    const day = addDays(today, k);
    const dayEvents = [];
    while (i < events.length && events[i].effectiveDate <= day) {
      cumulative += flowInto(events[i], ids);
      dayEvents.push(events[i]);
      i++;
    }
    points.push({
      date: day,
      events: budget.spendableNow + cumulative,
      spending: budget.spendableStart + cumulative - budget.dailyBudget * (k + 1),
      dayEvents,
    });
  }
  return { points, events, end };
}
