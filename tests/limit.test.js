import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDailyBudget, computeTomorrowBudget } from '../app/js/core/budget.js';
import { projectBalance } from '../app/js/core/projection.js';
import { applyTransaction } from '../app/js/data/ledger.js';
import { addDays } from '../app/js/core/dates.js';
import { TODAY, scenario } from './fixtures.js';

const empty = () => { const s = scenario(); s.accounts[0].balance = 0; s.accounts[1].balance = 0; return s; };
const confirm = (s, key, amount, date, to = 'cc') => applyTransaction(s, { id: key, type: 'income', date, amount, to, ref: key });
const spend = (s, amount, date) => applyTransaction(s, { id: `g${Math.random()}`, type: 'spend', date, amount, from: 'cc' });

test('janela de 12 meses: horizonEnd e days continuam sendo o ciclo atual', () => {
  const b = computeDailyBudget(scenario(), TODAY);
  assert.equal(b.lookDays, 365);
  assert.equal(b.lookEnd, '2027-10-25');
  assert.equal(b.horizonEnd, '2026-11-08');
  assert.equal(b.limitingDay, '2026-11-08');
  assert.deepEqual([b.heldToday, b.safeBudget, b.waiting.length, b.cushion], [0, 16993, 0, 0]);
});

test('W1: receita de hoje ou atrasada, não confirmada, não libera gasto', () => {
  // contas zeradas na véspera; salário de 9/11 ainda não confirmado
  const dia9 = computeDailyBudget(empty(), '2026-11-09');
  assert.deepEqual([dia9.dailyBudget, dia9.remainingToday, dia9.heldToday, dia9.safeBudget], [17750, 0, 17750, 0]);
  assert.deepEqual(dia9.waiting.map((e) => e.key), ['income:sal:2026-11']);
  const dia10 = computeDailyBudget(empty(), '2026-11-10');
  assert.deepEqual([dia10.dailyBudget, dia10.remainingToday, dia10.heldToday], [18407, 0, 18407]);
  const dia11 = computeDailyBudget(empty(), '2026-11-11');
  assert.deepEqual(dia11.waiting.map((e) => e.key), ['income:sal:2026-11', 'income:alugA:2026-11']);
  assert.equal(dia11.remainingToday, 0);
});

test('confirmar no valor previsto, no dia ou atrasado, não muda o limite: só libera o resto', () => {
  const noDia = empty();
  confirm(noDia, 'income:sal:2026-11', 250000, '2026-11-09');
  const a = computeDailyBudget(noDia, '2026-11-09');
  assert.deepEqual([a.dailyBudget, a.remainingToday, a.heldToday], [17750, 17750, 0]);
  const atrasado = empty();
  confirm(atrasado, 'income:sal:2026-11', 250000, '2026-11-10');
  const b = computeDailyBudget(atrasado, '2026-11-10');
  assert.deepEqual([b.dailyBudget, b.remainingToday, b.heldToday], [18407, 18407, 0]);
});

test('com dinheiro em conta, fica liberado o que caberia sem a receita a confirmar', () => {
  const s = empty();
  s.accounts[0].balance = 50000;
  const b = computeDailyBudget(s, '2026-11-10');
  assert.equal(b.dailyBudget, 20259);
  assert.equal(b.safeBudget, 11000); // (500 + 1.350 + 2.900 − 1.600 − 180) ÷ 27, até 6/12
  assert.deepEqual([b.remainingToday, b.heldToday], [11000, 9259]);
  spend(s, 3000, '2026-11-10');
  assert.deepEqual([computeDailyBudget(s, '2026-11-10').remainingToday, computeDailyBudget(s, '2026-11-10').heldToday], [8000, 9259]);
  spend(s, 9000, '2026-11-10'); // passou do liberado, não do limite: resta 0, nunca negativo
  assert.deepEqual([computeDailyBudget(s, '2026-11-10').remainingToday, computeDailyBudget(s, '2026-11-10').heldToday], [0, 8259]);
  spend(s, 9000, '2026-11-10'); // agora passou do limite
  const over = computeDailyBudget(s, '2026-11-10');
  assert.deepEqual([over.remainingToday, over.heldToday, over.waiting.length], [-741, 0, 0]);
});

test('conta de amanhã não é gasta hoje à espera de salário não confirmado', () => {
  const s = empty();
  s.accounts[0].balance = 12934;
  s.expenses.push({ id: 'cond', name: 'Condomínio', amount: 60000, accountId: 'cc', day: 10, exceptions: {}, since: TODAY });
  const b = computeDailyBudget(s, '2026-11-09');
  assert.equal(b.dailyBudget, 16069);
  assert.ok(b.safeBudget < 0);
  assert.deepEqual([b.remainingToday, b.heldToday], [0, 16069]);
});

test('amanhã = a mesma conta um dia à frente, com ou sem confirmação', () => {
  assert.equal(computeTomorrowBudget(empty(), '2026-11-08').dailyBudget, 17750);
  assert.equal(computeTomorrowBudget(empty(), '2026-11-09').dailyBudget, 18407);
  assert.equal(computeTomorrowBudget(empty(), '2026-11-09').dailyBudget, computeDailyBudget(empty(), '2026-11-10').dailyBudget);
});

test('W2: reserva grande não é gasta em um ciclo', () => {
  const s = scenario();
  s.accounts[1].balance = 1200000;
  const b = computeDailyBudget(s, TODAY);
  assert.equal(b.dailyBudget, 23912); // regra antiga: 86171
  assert.equal(b.limitingDay, '2027-10-06');
  assert.equal(Math.round(b.untilLimit.available / b.untilLimit.days), b.dailyBudget);
});

test('W3: compromisso depois do próximo salário já pesa hoje', () => {
  const s = scenario();
  s.expenses.push({ id: 'x', name: 'IPVA', amount: 0, accountId: 'cc', day: 10, exceptions: { '2026-11': 300000 }, since: TODAY });
  const b = computeDailyBudget(s, TODAY);
  assert.equal(b.dailyBudget, Math.round(434900 / 42)); // 10355, até 6/12
  assert.equal(b.limitingDay, '2026-12-06');
});

test('sobra na véspera do salário não vira pico', () => {
  const s = empty();
  s.accounts[0].balance = 50000;
  assert.equal(computeDailyBudget(s, '2026-11-08').dailyBudget, Math.round(547000 / 29)); // 18862; regra antiga: 50000
});

test('margem de segurança: o limite nunca usa esse valor', () => {
  const s = scenario();
  s.settings.cushion = 50000;
  const b = computeDailyBudget(s, TODAY);
  assert.equal(b.dailyBudget, Math.round(187900 / 14)); // 13421
  assert.deepEqual(b.untilLimit, { days: 14, incomes: 0, outflows: 0, available: 187900 });
  const p = projectBalance(s, TODAY, b);
  assert.equal(p.points.find((x) => x.date === '2026-11-08').balance, 50000);
  assert.ok(p.points.every((x) => x.balance >= 50000));
  s.settings.cushion = 300000; // maior que o saldo: sem folga, e o dia apertado é hoje
  const neg = computeDailyBudget(s, TODAY);
  assert.deepEqual([neg.dailyBudget, neg.limitingDay, neg.untilLimit.available], [-62100, TODAY, -62100]);
  for (const c of [undefined, null, -5, 12.5, '1000', NaN]) {
    s.settings.cushion = c;
    assert.equal(computeDailyBudget(s, TODAY).dailyBudget, 16993);
  }
});

test('sem receita recorrente a janela é curta: 30 dias, ou até 30 dias depois da última receita', () => {
  const s = scenario();
  s.incomes = [];
  const none = computeDailyBudget(s, TODAY);
  assert.deepEqual([none.lookDays, none.lookEnd, none.dailyBudget], [30, '2026-11-24', 2597]);
  s.incomes = [{ id: 'u', name: 'Venda', amount: 300000, accountId: 'cc', rule: { type: 'once', date: '2026-11-05' } }];
  const once = computeDailyBudget(s, TODAY);
  assert.deepEqual([once.horizonEnd, once.lookEnd, once.limitingDay, once.dailyBudget], ['2026-11-04', '2026-12-04', '2026-12-04', 8998]);
});

test('projeção: igual a seguir o app dia a dia, sem nunca ficar negativa', () => {
  const s = scenario();
  const p = projectBalance(s, TODAY, computeDailyBudget(s, TODAY));
  const at = (d) => p.points.find((x) => x.date === d);
  assert.deepEqual([p.points.length, p.end], [44, '2026-12-08']);
  assert.deepEqual([at('2026-10-26').balance, at('2026-11-08').balance, at('2026-11-09').balance, at('2026-11-09').limit], [220907, 0, 232250, 17750]);
  assert.deepEqual([at('2026-12-06').balance, at('2026-12-07').balance, at('2026-12-07').limit], [0, 229469, 20531]);
  // simulação: gasta o limite de cada dia e confirma tudo na data
  const sim = scenario();
  for (const pt of p.points) {
    for (const e of pt.dayEvents) {
      const f = e.kind === 'income' ? { type: 'income', to: e.accountId } : e.kind === 'expense' ? { type: 'expense', from: e.accountId } : { type: 'contribution', from: e.accountId, to: e.toAccountId };
      applyTransaction(sim, { id: e.key, date: pt.date, amount: e.amount, ref: e.key, ...f });
    }
    const b = computeDailyBudget(sim, pt.date);
    assert.equal(b.dailyBudget, pt.limit);
    spend(sim, b.remainingToday, pt.date);
    assert.equal(computeDailyBudget(sim, pt.date).spendableNow, pt.balance);
  }
});

test('projeção: cada dia futuro enxerga só o que o app lerá nele (receita única a mais de 400 dias)', () => {
  const s = scenario();
  s.accounts[0].balance = 600000; s.accounts[1].balance = 0;
  s.expenses = []; s.contributions = [];
  s.incomes = [
    { id: 'u1', name: 'Venda', amount: 3000000, accountId: 'cc', isSalary: false, rule: { type: 'once', date: addDays(TODAY, 12) }, exceptions: {} },
    { id: 'u2', name: 'Longe', amount: 500000, accountId: 'cc', isSalary: false, rule: { type: 'once', date: addDays(TODAY, 430) }, exceptions: {} },
  ];
  const b = computeDailyBudget(s, TODAY);
  const p = projectBalance(s, TODAY, b);
  // amanhã, depois de gastar o limite de hoje, o app mostra o mesmo limite que a linha do tempo usou
  applyTransaction(s, { id: 'g', type: 'spend', date: TODAY, amount: b.dailyBudget, from: 'cc' });
  assert.equal(p.points[1].limit, computeDailyBudget(s, addDays(TODAY, 1)).dailyBudget);
});
