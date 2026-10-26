import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDailyBudget } from '../app/js/core/budget.js';
import { coverageDays, suggestRefill, suggestSurplus } from '../app/js/core/refill.js';
import { applyTransaction } from '../app/js/data/ledger.js';
import { TODAY, scenario } from './fixtures.js';

const run = (s, today = TODAY) => {
  const b = computeDailyBudget(s, today);
  return { b, r: suggestRefill(s, today, b) };
};

test('aceitação: conta corrente cobre 0 dias e o resgate sugerido é R$ 1.150', () => {
  const { r } = run(scenario());
  assert.equal(r.coverage, 0);
  assert.equal(r.periodDays, 7);
  assert.equal(r.raw, 16993 * 7 - 6400); // 1.125,51
  assert.equal(r.amount, 115000);
  assert.equal(r.show, true);
  assert.equal(r.fromAccountId, 'cdb');
  assert.equal(r.toAccountId, 'cc');
});

test('após registrar o resgate: orçamento igual, cobertura de 7 dias, sem aviso', () => {
  const s = scenario();
  const { b: before, r } = run(s);
  applyTransaction(s, { id: 'r', type: 'transfer', date: TODAY, amount: r.amount, from: r.fromAccountId, to: r.toAccountId });
  const { b, r: after } = run(s);
  assert.equal(b.dailyBudget, before.dailyBudget);
  assert.equal(after.coverage, 7); // 1214,00 ÷ 169,93 = 7,14
  assert.equal(after.show, false);
});

test('cobertura desconta compromissos debitados da conta padrão', () => {
  const s = scenario();
  s.accounts[0].balance = 120000; // 1.200 + 1.179 = mesmo total de 2.379
  s.accounts[1].balance = 117900;
  const b = computeDailyBudget(s, TODAY);
  assert.equal(coverageDays(s, TODAY, b), 7); // 1.200 ÷ 169,93 = 7,06
  // fatura de 1.000 vencendo em 28/10 (dia 3 da janela)
  s.expenses[0].day = 28;
  s.expenses[0].amount = 100000;
  const b2 = computeDailyBudget(s, TODAY);
  const c = coverageDays(s, TODAY, b2);
  assert.ok(c < 7, `cobertura ${c}`);
});

test('compromissos do período entram no resgate', () => {
  const s = scenario();
  s.expenses[0].day = 30; // fatura de R$ 180 em 30/10, dentro dos 7 dias
  const { b, r } = run(s);
  assert.equal(r.commitments, 18000);
  assert.equal(r.raw, b.dailyBudget * 7 + 18000 - 6400);
  // orçamento cai para (2.379 − 180) ÷ 14 = 157,07 → 1.099,49 + 180 − 64 = 1.215,49
  assert.equal(b.dailyBudget, 15707);
  assert.equal(r.amount, 125000);
});

test('receita na conta padrão antes do fim do período corta o resgate', () => {
  const s = scenario();
  s.incomes.push({ id: 'pix', name: 'Reembolso', amount: 30000, accountId: 'cc',
    rule: { type: 'fixedDay', day: 29 }, exceptions: {}, since: TODAY });
  const { b, r } = run(s);
  assert.equal(r.cutByIncome.date, '2026-10-29');
  assert.equal(r.periodDays, 3); // 26, 27, 28
  assert.equal(r.raw, b.dailyBudget * 3 - 6400);
  assert.equal(r.amount, Math.ceil(r.raw / 5000) * 5000);
});

test('receita na reserva não corta o período', () => {
  const s = scenario();
  s.incomes.push({ id: 'jur', name: 'Juros', amount: 30000, accountId: 'cdb',
    rule: { type: 'fixedDay', day: 29 }, exceptions: {}, since: TODAY });
  assert.equal(run(s).r.periodDays, 7);
});

test('resgate é limitado ao saldo da reserva', () => {
  const s = scenario();
  s.accounts[0].balance = 0;
  s.accounts[1].balance = 20000;
  // receita de R$ 2.000 caindo na reserva em 28/10: orçamento = 200 ÷ 2 = 100/dia
  s.incomes.push({ id: 'res', name: 'Resgate de fundo', amount: 200000, accountId: 'cdb',
    rule: { type: 'fixedDay', day: 28 }, exceptions: {}, since: TODAY });
  const { b, r } = run(s);
  assert.equal(b.dailyBudget, 10000);
  assert.equal(r.raw, 70000); // precisa de 700, mas a reserva só tem 200 hoje
  assert.equal(r.cappedByReserve, true);
  assert.equal(r.amount, 20000);
});

test('gasto de hoje já descontado do saldo não é cobrado duas vezes', () => {
  const s = scenario();
  s.accounts[0].balance = 30000;
  applyTransaction(s, { id: 'g', type: 'spend', date: TODAY, amount: 10000, from: 'cc' });
  const { b, r } = run(s);
  // restante hoje 69,93 + 6 dias × 169,93 − 200,00
  assert.equal(r.raw, b.remainingToday + b.dailyBudget * 6 - 20000);
});

test('gasto que deixa a conta negativa gera aviso de resgate', () => {
  const s = scenario();
  applyTransaction(s, { id: 'g', type: 'spend', date: TODAY, amount: 10000, from: 'cc' });
  assert.equal(s.accounts[0].balance, -3600);
  const { r } = run(s);
  assert.equal(r.show, true);
  assert.ok(r.amount >= 3600);
});

test('excedente: sugere aplicar na reserva quando sobra muito', () => {
  const s = scenario();
  assert.equal(suggestSurplus(s, TODAY, computeDailyBudget(s, TODAY)), null);
  // tudo na conta corrente; período curto → bem mais que o necessário
  s.settings.refill.targetDays = 3;
  applyTransaction(s, { id: 'i', type: 'transfer', date: TODAY, amount: 231500, from: 'cdb', to: 'cc' });
  const b = computeDailyBudget(s, TODAY);
  const sp = suggestSurplus(s, TODAY, b);
  assert.ok(sp);
  assert.equal(sp.keep, 16993 * 3);
  assert.equal(sp.amount, 185000); // 2.379 − 509,79 = 1.869,21 → 1.850
  assert.ok(237900 - sp.amount >= sp.keep);
});
