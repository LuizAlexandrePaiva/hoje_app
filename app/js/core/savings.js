// Regra de poupança: quanto guardar de cada receita que entra. Funções puras.
//
// Guardar = o maior valor, em reais inteiros, até 10% do que entrou, que deixa
// o limite do dia em pelo menos 90% do que você costuma gastar por dia.
// A conta usa o próprio limite (computeDailyBudget): o que a regra promete é
// exatamente o que o app mostra depois de guardar.

import { addDays, diffDays, todayISO } from './dates.js';
import { computeDailyBudget, spendingAccountIds, withDelta } from './budget.js';

export const SAVINGS = {
  capBps: 1000, // teto: 10% do que entrou
  keepBps: 9000, // depois de guardar, o limite fica em pelo menos 90% do gasto típico
  windowDays: 30, // gasto típico: últimos 30 dias completos (hoje fica de fora)
  minActiveDays: 7, // dias com gasto lançado para confiar no histórico
  step: 100, // reais inteiros, para baixo
  minAmount: 1000, // sugestão mínima: R$ 10
  minBps: 100, // e pelo menos 1% do que entrou
  openDays: 7, // a sugestão fica na tela Hoje por 7 dias
};

const limitOf = (state, today) => computeDailyBudget(state, today).dailyBudget;

/** Gasto típico por dia: gastos lançados nos últimos 30 dias completos ÷ dias desde o primeiro deles. */
export function typicalSpend(state, today, ids = spendingAccountIds(state)) {
  const from = addDays(today, -SAVINGS.windowDays);
  const active = new Set();
  let total = 0;
  let first = null;
  for (const t of state.transactions || []) {
    if (t.type !== 'spend' || !ids.has(t.from) || !(t.date >= from) || !(t.date < today)) continue;
    total += t.amount;
    active.add(t.date);
    if (!first || t.date < first) first = t.date;
  }
  const days = first ? diffDays(first, today) : 0;
  return { total, days, activeDays: active.size, known: active.size >= SAVINGS.minActiveDays, perDay: days ? Math.round(total / days) : 0 };
}

/**
 * Piso: depois de guardar, o limite do dia não fica abaixo disto.
 * Com histórico, 90% do gasto típico; sem histórico, 90% do limite de hoje.
 */
export function savingFloor(state, today, limit = limitOf(state, today), ids = spendingAccountIds(state)) {
  const t = typicalSpend(state, today, ids);
  if (t.known) {
    return { floor: Math.ceil((t.total * SAVINGS.keepBps) / (10000 * t.days)), basis: 'history', typical: t.perDay, days: t.days };
  }
  return { floor: Math.max(1, Math.ceil((limit * SAVINGS.keepBps) / 10000)), basis: 'limit', typical: null, days: t.days };
}

/** Conta que recebe a poupança: a última usada, se ainda for de meta; senão a primeira conta de meta; ou null. */
export function savingsDestination(state) {
  const goals = (state.accounts || []).filter((a) => a.kind === 'goal');
  return goals.find((a) => a.id === state.settings?.savingsAccountId) || goals[0] || null;
}

/**
 * Quanto guardar de uma receita já lançada (`tx`, com o valor já no saldo).
 * `floorInfo` fixa o piso quando várias sugestões são calculadas em sequência.
 * reason: 'ok' | 'none' | 'outside' | 'small' | 'no-room' | 'tight' | 'no-balance'
 * limitedBy: 'cap' | 'floor' | 'balance' | null
 */
export function suggestSaving(state, today, tx, floorInfo) {
  const ids = spendingAccountIds(state);
  const received = tx && tx.type === 'income' && tx.amount > 0 ? tx.amount : 0;
  const cap = Math.floor((received * SAVINGS.capBps) / 10000);
  const base = { amount: 0, bps: 0, reason: 'none', limitedBy: null, received, cap, from: tx?.to ?? null };
  if (!received) return base;
  if (!ids.has(tx.to)) return { ...base, reason: 'outside' };
  if (cap < SAVINGS.minAmount) return { ...base, reason: 'small' };

  const limit = limitOf(state, today);
  const f = floorInfo || savingFloor(state, today, limit, ids);
  const out = { ...base, limit, limitAfter: limit, floor: f.floor, basis: f.basis, typical: f.typical, days: f.days };
  if (limit <= 0) return { ...out, reason: 'no-room' };
  if (limit < f.floor) return { ...out, reason: 'tight', limitedBy: 'floor' };

  // só o dinheiro que existe: nem mais que o saldo da conta da receita, nem mais que a soma das contas de gasto
  const pooled = state.accounts.filter((a) => ids.has(a.id)).reduce((s, a) => s + a.balance, 0);
  const source = state.accounts.find((a) => a.id === tx.to).balance;
  const liquid = Math.max(0, Math.min(pooled, source));
  const top = Math.floor(Math.min(cap, liquid) / SAVINGS.step);
  const after = (m) => limitOf(withDelta(state, tx.to, -m * SAVINGS.step), today);

  let m = top;
  let limitedBy = cap <= liquid ? 'cap' : 'balance';
  if (top > 0 && after(top) < f.floor) {
    // maior m em [0, top) com limite depois ≥ piso (o limite não cresce quando sai mais dinheiro)
    let lo = 0;
    let hi = top;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (after(mid) >= f.floor) lo = mid; else hi = mid;
    }
    m = lo;
    limitedBy = 'floor';
  }
  const amount = m * SAVINGS.step;
  if (amount < SAVINGS.minAmount || amount * 10000 < received * SAVINGS.minBps) {
    return { ...out, limitedBy, reason: limitedBy === 'balance' ? 'no-balance' : 'tight' };
  }
  return { ...out, amount, bps: Math.floor((amount * 10000) / received), limitedBy, limitAfter: after(m), reason: 'ok' };
}

/** Dia em que a receita foi lançada (fuso do app); sem createdAt, a data dela. */
function registeredOn(tx) {
  return tx.createdAt ? todayISO(new Date(tx.createdAt)) : tx.date;
}

/**
 * Sugestões abertas: receitas em contas de gasto lançadas nos últimos 7 dias,
 * sem poupança registrada e não dispensadas. Da mais antiga para a mais nova;
 * cada uma já conta com as anteriores guardadas, então a soma das linhas cabe
 * e aceitar uma não muda as outras.
 */
export function openSavings(state, today) {
  if (state.settings?.savingsEnabled === false) return [];
  const ids = spendingAccountIds(state);
  const txs = state.transactions || [];
  const saved = new Set(txs.filter((t) => t.savingOf).map((t) => t.savingOf));
  const open = txs.filter((t) => {
    if (t.type !== 'income' || !(t.amount > 0) || !ids.has(t.to) || t.savingSkipped || saved.has(t.id)) return false;
    const age = diffDays(registeredOn(t), today);
    return age >= 0 && age < SAVINGS.openDays;
  });
  if (!open.length) return [];
  const floorInfo = savingFloor(state, today, undefined, ids);
  const to = savingsDestination(state)?.id ?? null;
  let work = state;
  const out = [];
  for (const tx of open) {
    const s = suggestSaving(work, today, tx, floorInfo);
    if (s.amount > 0) {
      out.push({ tx, ...s, to });
      work = withDelta(work, tx.to, -s.amount);
    }
  }
  return out;
}
