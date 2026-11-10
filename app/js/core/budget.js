// Limite diário: função pura, sem DOM e sem armazenamento.
//
// 1. Só conta o dinheiro das contas de gasto, menos a margem de segurança.
// 2. O limite é o maior valor que dá para gastar todo dia sem faltar dinheiro
//    em nenhum dia dos próximos 12 meses.
// 3. Receita, despesa e aporte previstos contam a partir da data; vencidos e
//    não confirmados contam como de hoje.
// 4. Receita que ainda não foi confirmada entra no limite, mas não libera
//    gasto: até a confirmação, "resta para gastar" é o que caberia sem ela.

import { addDays, diffDays } from './dates.js';
import { openEvents, flowInto } from './schedule.js';

/** Até onde o limite olha. */
export const LOOKAHEAD_DAYS = 365;
/** Sem receita prevista, o dinheiro precisa durar isto. */
export const FALLBACK_HORIZON_DAYS = 30;
/** Até onde lemos as ocorrências (cobre a janela de 12 meses e salários irregulares). */
export const SCAN_DAYS = 400;

export function spendingAccountIds(state) {
  return new Set((state.accounts || []).filter((a) => a.kind === 'spending').map((a) => a.id));
}

/** Soma dos gastos lançados hoje que saíram de contas de gasto. */
export function spentOn(state, day, ids = spendingAccountIds(state)) {
  return (state.transactions || [])
    .filter((t) => t.type === 'spend' && t.date === day && ids.has(t.from))
    .reduce((s, t) => s + t.amount, 0);
}

/** Margem de segurança (Ajustes): valor que o limite nunca usa. Estados antigos não têm o campo: 0. */
export function cushionOf(state) {
  const c = state.settings?.cushion;
  return Number.isInteger(c) && c > 0 ? c : 0;
}

/**
 * Próximo salário ainda não recebido com data depois de hoje. Se hoje é dia
 * de salário, o de hoje fica de fora. Sem receita marcada como salário, usa a
 * próxima receita qualquer.
 */
export function nextSalary(state, today) {
  const future = openEvents(state, today, addDays(today, SCAN_DAYS))
    .filter((e) => e.kind === 'income' && e.date > today);
  return future.find((e) => e.isSalary) || future[0] || null;
}

/** Ocorrências em aberto de `day` até `to`, cada uma com o efeito nas contas de gasto (`flow`). */
export function plannedFlows(state, day, to, ids = spendingAccountIds(state)) {
  return openEvents(state, day, to).map((e) => ({ ...e, flow: flowInto(e, ids) }));
}

/** Fluxo líquido e entradas por dia: índice 0 = `day`, até `n` dias. */
export function flowSeries(events, day, n) {
  const net = new Array(n).fill(0);
  const inc = new Array(n).fill(0);
  for (const e of events) {
    if (!e.flow) continue;
    const k = diffDays(day, e.effectiveDate);
    if (k < 0 || k >= n) continue;
    net[k] += e.flow;
    if (e.flow > 0) inc[k] += e.flow;
  }
  return { net, inc };
}

/**
 * Maior gasto diário constante que mantém o saldo ≥ 0 nos `n` dias a partir
 * do índice `from`: min sobre k de (base + fluxos até k) ÷ (k + 1).
 */
export function sustainableRate(base, series, from, n) {
  let cumulative = 0;
  let incomes = 0;
  let best = Infinity;
  let at = { k: 0, incomes: 0, outflows: 0 };
  const last = Math.min(n, series.net.length - from);
  for (let k = 0; k < last; k++) {
    cumulative += series.net[from + k];
    incomes += series.inc[from + k];
    const perDay = (base + cumulative) / (k + 1);
    if (perDay < best) {
      best = perDay;
      at = { k, incomes, outflows: incomes - cumulative };
    }
  }
  return { rate: Math.round(best), ...at };
}

/**
 * Quantos dias o limite cobre a partir de `day`: 12 meses; sem receita
 * recorrente, até 30 dias depois da última receita prevista (sem nenhuma, 30
 * dias); nunca menos que até a véspera do próximo salário.
 */
export function lookDaysFor(day, cycleEnd, lastIncomeDate) {
  const known = addDays(lastIncomeDate && lastIncomeDate > day ? lastIncomeDate : day, FALLBACK_HORIZON_DAYS - 1);
  const year = addDays(day, LOOKAHEAD_DAYS - 1);
  let end = known < year ? known : year;
  if (end < cycleEnd) end = cycleEnd;
  return diffDays(day, end) + 1;
}

export function computeDailyBudget(state, today) {
  const ids = spendingAccountIds(state);
  const spendableNow = (state.accounts || [])
    .filter((a) => ids.has(a.id))
    .reduce((s, a) => s + a.balance, 0);
  const spentToday = spentOn(state, today, ids);
  const spendableStart = spendableNow + spentToday;
  const cushion = cushionOf(state);
  const base = spendableStart - cushion;

  const events = plannedFlows(state, today, addDays(today, SCAN_DAYS), ids);
  const future = events.filter((e) => e.kind === 'income' && e.date > today);
  const salary = future.find((e) => e.isSalary) || future[0] || null;
  const horizonEnd = salary ? addDays(salary.date, -1) : addDays(today, FALLBACK_HORIZON_DAYS - 1);
  const days = diffDays(today, horizonEnd) + 1;
  const lastIncome = events.reduce((m, e) => (e.flow > 0 && e.date > m ? e.date : m), '');
  const lookDays = lookDaysFor(today, horizonEnd, lastIncome);

  const series = flowSeries(events, today, lookDays);
  const r = sustainableRate(base, series, 0, lookDays);
  const dailyBudget = r.rate;
  const available = base + r.incomes - r.outflows; // dinheiro no dia mais apertado
  // quando as contas previstas passam do dinheiro: quanto falta, no total, até o dia mais apertado
  const shortfall = available < 0 ? -available : 0;

  // Entradas de hoje ou atrasadas, ainda não confirmadas: o limite conta com
  // elas, mas até a confirmação só fica liberado o que caberia sem elas.
  const pendingIn = series.inc[0];
  const full = dailyBudget - spentToday;
  let remainingToday = full;
  let safeBudget = dailyBudget;
  let waiting = [];
  if (pendingIn > 0) {
    safeBudget = sustainableRate(base - pendingIn, series, 0, lookDays).rate;
    if (full > 0) remainingToday = Math.min(full, Math.max(safeBudget - spentToday, 0));
    if (remainingToday < full) waiting = events.filter((e) => e.effectiveDate === today && e.flow > 0);
  }

  return {
    today,
    dailyBudget,
    spentToday,
    remainingToday,
    heldToday: full - remainingToday, // parte do limite de hoje que espera confirmação de receita
    safeBudget, // o limite se as receitas a confirmar não viessem
    waiting, // as receitas que seguram heldToday
    spendableNow,
    spendableStart,
    cushion,
    horizonEnd,
    days,
    lookEnd: addDays(today, lookDays - 1),
    lookDays,
    limitingDay: addDays(today, r.k),
    // a conta que define o limite: (saldo − margem + entradas − saídas) ÷ dias, até o dia mais apertado
    untilLimit: { days: r.k + 1, incomes: r.incomes, outflows: r.outflows, available },
    shortfall,
    nextSalary: salary,
  };
}

/**
 * Limite de amanhã se nada mais for gasto hoje: a mesma conta, um dia à
 * frente, com o saldo de agora. Sobe quando sobra limite hoje e cai quando
 * o gasto de hoje passa do limite.
 */
export function computeTomorrowBudget(state, today) {
  return computeDailyBudget(state, addDays(today, 1));
}

/** O estado se `cents` entrassem agora na conta (negativo: saíssem). Não muta. */
export function withDelta(state, accountId, cents) {
  return { ...state, accounts: state.accounts.map((a) => (a.id === accountId ? { ...a, balance: a.balance + cents } : a)) };
}
