import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDailyBudget, nextSalary } from '../app/js/core/budget.js';
import { applyTransaction } from '../app/js/data/ledger.js';
import { TODAY, scenario } from './fixtures.js';

const spend = (s, amount, date = TODAY, from = 'cc') =>
  applyTransaction(s, { id: `g${Math.random()}`, type: 'spend', date, amount, from });

test('aceitação: orçamento de hoje = 2.379 ÷ 14 = R$ 169,93', () => {
  const b = computeDailyBudget(scenario(), TODAY);
  assert.equal(b.nextSalary.date, '2026-11-09');
  assert.equal(b.horizonEnd, '2026-11-08');
  assert.equal(b.days, 14);
  assert.equal(b.spendableStart, 237900);
  assert.equal(b.dailyBudget, 16993);
  assert.equal(b.remainingToday, 16993);
});

test('aceitação: resgate (transferência CDB → corrente) não altera o orçamento', () => {
  const s = scenario();
  const before = computeDailyBudget(s, TODAY).dailyBudget;
  applyTransaction(s, { id: 't1', type: 'transfer', date: TODAY, amount: 115000, from: 'cdb', to: 'cc' });
  assert.equal(s.accounts[0].balance, 121400);
  assert.equal(computeDailyBudget(s, TODAY).dailyBudget, before);
});

test('gastos de hoje não mudam o orçamento, só o restante', () => {
  const s = scenario();
  spend(s, 5000);
  spend(s, 15000);
  const b = computeDailyBudget(s, TODAY);
  assert.equal(b.dailyBudget, 16993);
  assert.equal(b.spentToday, 20000);
  assert.equal(b.remainingToday, -3007); // negativo: passou do limite
});

test('dia seguinte: gastar menos espalha a sobra; gastar mais reduz', () => {
  const tomorrow = '2026-10-27';
  const menos = scenario();
  spend(menos, 6993); // gastou R$ 69,93 (sobra de R$ 100)
  const bm = computeDailyBudget(menos, tomorrow);
  assert.equal(bm.days, 13);
  assert.equal(bm.dailyBudget, Math.round((237900 - 6993) / 13)); // 17762
  assert.ok(bm.dailyBudget > 16993);

  const mais = scenario();
  spend(mais, 40000);
  const bx = computeDailyBudget(mais, tomorrow);
  assert.equal(bx.dailyBudget, Math.round((237900 - 40000) / 13)); // 15223
  assert.ok(bx.dailyBudget < 16993);

  const exato = scenario();
  spend(exato, 16993);
  assert.equal(computeDailyBudget(exato, tomorrow).dailyBudget, 16993);
});

test('no dia do salário o horizonte vai até a véspera do salário seguinte', () => {
  const s = scenario();
  const b = computeDailyBudget(s, '2026-11-09');
  assert.equal(b.nextSalary.date, '2026-12-07'); // 5º dia útil de dez/2026
  assert.equal(b.horizonEnd, '2026-12-06');
  // salário de hoje (pendente) conta como receita do dia 0
  assert.ok(b.dailyBudget > 0);
});

test('salário confirmado antes da data não encolhe o horizonte', () => {
  const s = scenario();
  s.settled['income:sal:2026-11'] = { date: '2026-11-06', amount: 250000 };
  const sal = nextSalary(s, '2026-11-08');
  assert.equal(sal.date, '2026-12-07');
});

test('o mínimo é tomado sobre os dias do horizonte (compromisso no meio)', () => {
  const s = scenario();
  // despesa grande no dia 30/10 (dia k=4 → 5 dias)
  s.expenses.push({ id: 'x', name: 'Seguro', amount: 200000, accountId: 'cc', day: 30, exceptions: {}, since: TODAY });
  const b = computeDailyBudget(s, TODAY);
  // dias 1-4: 2379/k; do dia 5 em diante: 379/k → pior em k = 14: 379/14 = 27,07
  assert.equal(b.dailyBudget, Math.round(37900 / 14));
  assert.equal(b.limitingDay, '2026-11-08');
});

test('receita no meio do horizonte entra a partir do seu dia', () => {
  const s = scenario();
  s.incomes.push({ id: 'y', name: 'Extra', amount: 140000, accountId: 'cc',
    rule: { type: 'fixedDay', day: 3 }, exceptions: {}, since: TODAY });
  const b = computeDailyBudget(s, TODAY);
  // antes de 3/11 (k ≤ 8): 2379/k ≥ 2379/8 = 297,4; até 8/11: 3779/14 = 269,93
  assert.equal(b.dailyBudget, Math.round(377900 / 14));
});

test('receita para a conta da meta não entra no orçamento', () => {
  const s = scenario();
  s.incomes.push({ id: 'z', name: 'Dividendos', amount: 50000, accountId: 'fundo',
    rule: { type: 'fixedDay', day: 1 }, exceptions: {}, since: TODAY });
  assert.equal(computeDailyBudget(s, TODAY).dailyBudget, 16993);
});

test('aporte planejado no horizonte reduz o orçamento', () => {
  const s = scenario();
  s.contributions.push({ id: 'ap2', goalId: 'viagem', amount: 28000, date: '2026-11-02', fromAccountId: 'cdb' });
  assert.equal(computeDailyBudget(s, TODAY).dailyBudget, Math.round((237900 - 28000) / 14));
});

test('exceção de valor só no mês indicado', () => {
  const s = scenario();
  s.incomes[1].exceptions = { '2026-11': 0 };
  s.incomes[1].rule.day = 1; // aluguel em 1/11, dentro do horizonte
  assert.equal(computeDailyBudget(s, TODAY).dailyBudget, 16993);
  s.incomes[1].exceptions = {};
  assert.equal(computeDailyBudget(s, TODAY).dailyBudget, Math.round((237900 + 135000) / 14));
});

test('pendência vencida não confirmada conta como prevista para hoje', () => {
  const s = scenario();
  // dia 11/11: aluguel previsto mas ainda não confirmado
  const b = computeDailyBudget(s, '2026-11-12');
  // saldo 2379 + salário (9/11) + aluguel (11/11), ambos pendentes → entram hoje
  assert.equal(b.spendableStart + 250000 + 135000, 237900 + 385000);
  assert.ok(b.dailyBudget > 0);
});

test('sem salário cadastrado usa a próxima receita; sem receitas, 30 dias', () => {
  const s = scenario();
  s.incomes[0].isSalary = false;
  assert.equal(computeDailyBudget(s, TODAY).nextSalary.date, '2026-11-09');
  s.incomes = [];
  const b = computeDailyBudget(s, TODAY);
  assert.equal(b.nextSalary, null);
  assert.equal(b.days, 30);
});

test('projeção: arredondamento do orçamento não vira saldo negativo', async () => {
  const { projectBalance } = await import('../app/js/core/projection.js');
  const s = scenario();
  const b = computeDailyBudget(s, TODAY);
  const p = projectBalance(s, TODAY, b).points.find((x) => x.date === b.horizonEnd);
  assert.equal(p.spending, 0); // 2.379 − 14 × 169,93 = −0,02 → 0
});
