import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDailyBudget } from '../app/js/core/budget.js';
import { suggestRefill } from '../app/js/core/refill.js';
import { addDays } from '../app/js/core/dates.js';
import { applyTransaction, revertTransaction } from '../app/js/data/ledger.js';
import { SAVINGS, typicalSpend, savingFloor, savingsDestination, suggestSaving, openSavings } from '../app/js/core/savings.js';
import { TODAY, scenario } from './fixtures.js';

let n = 0;
/** Um gasto por dia em [from, to]. */
const H = (s, from, to, cents, acc = 'cdb') => {
  for (let d = from; d <= to; d = addDays(d, 1)) applyTransaction(s, { id: `g${++n}`, type: 'spend', date: d, amount: cents, from: acc });
  return s;
};
const income = (s, date, amount, to = 'cc', extra = {}) => applyTransaction(s, { id: `i${++n}`, type: 'income', date, amount, to, ...extra });
const save = (s, tx, amount, date) => applyTransaction(s, { id: `p${++n}`, type: 'transfer', date, amount, from: tx.to, to: 'fundo', savingOf: tx.id });
const limit = (s, d) => computeDailyBudget(s, d).dailyBudget;
const D = '2026-11-09';
/** 14 dias gastando R$ 169,93 e o salário de 9/11 confirmado. */
const payday = () => {
  const s = H(scenario(), '2026-10-26', '2026-11-08', 16993);
  const tx = income(s, D, 250000, 'cc', { ref: 'income:sal:2026-11', desc: 'Salário' });
  return { s, tx };
};
const seguro = (s, amount) => s.expenses.push({ id: 'seg', name: 'Seguro', amount, accountId: 'cc', day: 30, exceptions: {}, since: '2026-11-01' });

test('aceitação intacta: a regra ligada não muda limite nem resgate', () => {
  const s = scenario();
  s.settings.savingsEnabled = true;
  const b = computeDailyBudget(s, TODAY);
  assert.equal(b.dailyBudget, 16993);
  assert.equal(suggestRefill(s, TODAY, b).amount, 115000);
  assert.deepEqual(openSavings(s, TODAY), []);
});

test('dia do salário: 10% cabe e o limite fica acima do piso', () => {
  const { s, tx } = payday();
  assert.deepEqual(typicalSpend(s, D), { total: 237902, days: 14, activeDays: 14, known: true, perDay: 16993 });
  assert.deepEqual(savingFloor(s, D), { floor: 15294, basis: 'history', typical: 16993, days: 14 });
  const r = suggestSaving(s, D, tx);
  assert.deepEqual(r, { amount: 25000, bps: 1000, reason: 'ok', limitedBy: 'cap', received: 250000, cap: 25000, from: 'cc', limit: 17750, limitAfter: 16857, floor: 15294, basis: 'history', typical: 16993, days: 14 });
  save(s, tx, r.amount, D);
  assert.equal(limit(s, D), 16857);
  assert.deepEqual(openSavings(s, D), []);
});

test('ciclo com três receitas: 250, 135 e 215 (a última presa ao piso)', () => {
  const { s, tx } = payday();
  save(s, tx, 25000, D);
  H(s, '2026-11-09', '2026-11-10', 16857, 'cc');
  const t2 = income(s, '2026-11-11', 135000, 'cc', { ref: 'income:alugA:2026-11', desc: 'Aluguel Sala' });
  const r2 = suggestSaving(s, '2026-11-11', t2);
  assert.deepEqual([r2.amount, r2.limitedBy, r2.floor, r2.limit, r2.limitAfter], [13500, 'cap', 15279, 16857, 16338]);
  save(s, t2, 13500, '2026-11-11');
  H(s, '2026-11-11', '2026-11-19', 16338, 'cc');
  const t3 = income(s, '2026-11-20', 290000, 'cc', { ref: 'income:alugB:2026-11', desc: 'Aluguéis Diversos' });
  const r3 = suggestSaving(s, '2026-11-20', t3);
  assert.deepEqual([r3.amount, r3.bps, r3.limitedBy, r3.cap, r3.floor, r3.limit, r3.limitAfter], [21500, 741, 'floor', 29000, 15072, 16338, 15073]);
  save(s, t3, 21500, '2026-11-20');
  assert.equal(limit(s, '2026-11-20'), 15073);
  // R$ 1 a mais furaria o piso
  applyTransaction(s, { id: 'mais', type: 'transfer', date: '2026-11-20', amount: 100, from: 'cc', to: 'fundo' });
  assert.ok(limit(s, '2026-11-20') < 15072);
});

test('mês apertado: a sugestão encolhe e some', () => {
  const run = (extra) => { const { s, tx } = payday(); seguro(s, extra); const r = suggestSaving(s, D, tx); return [r.amount, r.reason, r.limitedBy, r.limit, r.limitAfter]; };
  assert.deepEqual(run(40000), [25000, 'ok', 'cap', 16321, 15429]);
  assert.deepEqual(run(50000), [18700, 'ok', 'floor', 15964, 15296]);
  assert.deepEqual(run(66000), [2700, 'ok', 'floor', 15393, 15296]);
  assert.deepEqual(run(67000), [0, 'tight', 'floor', 15357, 15357]); // caberiam R$ 17, menos de 1% do salário
  assert.deepEqual(run(80000), [0, 'tight', 'floor', 14893, 14893]); // o limite já está abaixo do piso
});

test('sem histórico: o piso é 90% do limite de hoje', () => {
  const s = scenario();
  const tx = income(s, TODAY, 42000, 'cc', { desc: 'Freela' });
  const r = suggestSaving(s, TODAY, tx);
  assert.deepEqual([r.amount, r.limitedBy, r.basis, r.typical, r.floor, r.limit, r.limitAfter], [4200, 'cap', 'limit', null, 16649, 18498, 18398]); // limite com a receita: 776.900 ÷ 42 dias (até 6/12)
});

test('histórico vale a partir de 7 dias com gasto lançado', () => {
  const a = H(scenario(), '2026-10-26', '2026-10-31', 15000);
  const ra = suggestSaving(a, '2026-11-01', income(a, '2026-11-01', 80000));
  assert.deepEqual([ra.basis, ra.floor, ra.amount, ra.limit, ra.limitAfter], ['limit', 18123, 8000, 20136, 19914]);
  const b = H(scenario(), '2026-10-26', '2026-11-01', 15000);
  const rb = suggestSaving(b, '2026-11-02', income(b, '2026-11-02', 80000));
  assert.deepEqual([rb.basis, rb.typical, rb.floor, rb.amount, rb.limit, rb.limitAfter], ['history', 15000, 13500, 8000, 20283, 20054]);
});

test('sem sugestão: conta de meta, receita pequena, lançamento que não é receita, limite negativo', () => {
  const { s } = payday();
  assert.equal(suggestSaving(s, D, income(s, D, 50000, 'fundo')).reason, 'outside');
  assert.deepEqual([suggestSaving(s, D, income(s, D, 9990)).reason, suggestSaving(s, D, income(s, D, 10000)).amount], ['small', 1000]);
  assert.equal(suggestSaving(s, D, s.transactions[0]).reason, 'none');
  assert.equal(suggestSaving(s, D, null).reason, 'none');
  const cdb = suggestSaving(s, D, income(s, D, 80000, 'cdb'));
  assert.deepEqual([cdb.amount, cdb.from], [8000, 'cdb']);
  const neg = scenario();
  neg.expenses.push({ id: 'x', name: 'X', amount: 400000, accountId: 'cc', day: 5, exceptions: {}, since: TODAY });
  const r = suggestSaving(neg, TODAY, income(neg, TODAY, 100000));
  assert.deepEqual([r.amount, r.reason, r.limit], [0, 'no-room', -5645]);
});

test('só o dinheiro que existe na conta da receita', () => {
  const { s, tx } = payday();
  applyTransaction(s, { id: 'ap', type: 'transfer', date: D, amount: 240000, from: 'cc', to: 'cdb' }); // aplicou quase tudo na reserva
  assert.equal(limit(s, D), 17750); // transferência entre contas de gasto não muda o limite
  const r = suggestSaving(s, D, tx);
  assert.deepEqual([r.amount, r.bps, r.limitedBy, r.limitAfter], [16400, 656, 'balance', 17164]);
  applyTransaction(s, { id: 'ap2', type: 'transfer', date: D, amount: 14500, from: 'cc', to: 'cdb' }); // sobra R$ 19 na conta
  assert.deepEqual([suggestSaving(s, D, tx).amount, suggestSaving(s, D, tx).reason], [0, 'no-balance']);
  // salário de 9/11 atrasado e não confirmado: o limite conta com ele, a regra não
  const w = scenario();
  w.accounts[0].balance = -128000; w.accounts[1].balance = 0;
  const rw = suggestSaving(w, '2026-11-11', income(w, '2026-11-11', 135000, 'cc', { ref: 'income:alugA:2026-11' }));
  assert.deepEqual([rw.amount, rw.limitedBy, rw.cap], [7000, 'balance', 13500]);
});

test('várias abertas: em sequência, a soma cabe e aceitar uma não muda as outras', () => {
  const s = H(scenario(), '2026-10-26', '2026-11-08', 16993);
  seguro(s, 170000);
  const t1 = income(s, D, 250000, 'cc', { ref: 'income:sal:2026-11', desc: 'Salário' });
  const t2 = income(s, D, 135000, 'cc', { desc: 'Extra' });
  assert.deepEqual([suggestSaving(s, D, t1).amount, suggestSaving(s, D, t2).amount], [25000, 13500]); // sozinhas, somariam mais que a folga
  const open = openSavings(s, D);
  assert.deepEqual(open.map((o) => [o.tx.id, o.amount, o.limitedBy, o.to]), [[t1.id, 25000, 'cap', 'fundo'], [t2.id, 6300, 'floor', 'fundo']]);
  save(s, t1, 25000, D);
  assert.deepEqual(openSavings(s, D).map((o) => [o.tx.id, o.amount]), [[t2.id, 6300]]);
  save(s, t2, 6300, D);
  assert.ok(limit(s, D) >= 15294);
  assert.deepEqual(openSavings(s, D), []);
});

test('janela de 7 dias, dispensa, chave desligada e estado antigo', () => {
  const { s, tx } = payday();
  assert.deepEqual(['2026-11-09', '2026-11-15', '2026-11-16'].map((d) => openSavings(s, d).length), [1, 1, 0]);
  tx.savingSkipped = true;
  assert.equal(openSavings(s, D).length, 0);
  delete tx.savingSkipped;
  s.settings.savingsEnabled = false;
  assert.equal(openSavings(s, D).length, 0);
  delete s.settings.savingsEnabled; // estado antigo, sem o campo: regra ligada
  assert.equal(openSavings(s, D).length, 1);
  // confirmada com data antiga: os 7 dias contam do dia do lançamento (22h30 de 9/11 em São Paulo)
  income(s, '2026-11-01', 100000, 'cc', { desc: 'Atrasada', createdAt: '2026-11-10T01:30:00.000Z' });
  assert.deepEqual(['2026-11-09', '2026-11-15', '2026-11-16'].map((d) => openSavings(s, d).map((o) => o.tx.desc)), [['Salário', 'Atrasada'], ['Salário', 'Atrasada'], []]);
});

test('excluir a poupança reabre a sugestão; excluir a receita fecha e mantém a transferência', () => {
  const { s, tx } = payday();
  const p = save(s, tx, 25000, D);
  assert.deepEqual([openSavings(s, D).length, s.accounts[0].balance, s.accounts[2].balance, limit(s, D)], [0, 231400, 415000, 16857]);
  revertTransaction(s, p.id);
  assert.deepEqual([openSavings(s, D).map((o) => o.amount), s.accounts[0].balance, s.accounts[2].balance, limit(s, D)], [[25000], 256400, 390000, 17750]);
  save(s, tx, 25000, D);
  revertTransaction(s, tx.id);
  assert.deepEqual([openSavings(s, D).length, s.accounts[0].balance, s.accounts[2].balance], [0, -18600, 415000]);
  assert.equal(s.transactions.filter((t) => t.savingOf === tx.id).length, 1);
});

test('destino: última conta usada, se ainda for de meta; senão a primeira conta de meta', () => {
  const s = scenario();
  assert.equal(savingsDestination(s).id, 'fundo');
  s.accounts.push({ id: 'pp', name: 'Poupança', kind: 'goal', balance: 0 });
  assert.equal(savingsDestination(s).id, 'fundo');
  s.settings.savingsAccountId = 'pp';
  assert.equal(savingsDestination(s).id, 'pp');
  s.settings.savingsAccountId = 'cdb'; // deixou de ser conta de meta
  assert.equal(savingsDestination(s).id, 'fundo');
  s.accounts = s.accounts.filter((a) => a.kind !== 'goal');
  assert.equal(savingsDestination(s), null);
  const { s: p, tx } = payday();
  p.accounts = p.accounts.filter((a) => a.kind !== 'goal');
  p.goals = []; p.contributions = [];
  assert.deepEqual(openSavings(p, D).map((o) => [o.amount, o.to]), [[25000, null]]); // a linha aparece; a folha oferece criar a conta
});

test('gasto de hoje não muda a sugestão', () => {
  const { s, tx } = payday();
  applyTransaction(s, { id: 'hoje', type: 'spend', date: D, amount: 17000, from: 'cdb' });
  const r = suggestSaving(s, D, tx);
  assert.deepEqual([r.amount, r.limit, r.limitAfter], [25000, 17750, 16857]);
  assert.equal(computeDailyBudget(s, D).remainingToday, 750);
});

test('propriedades em estados aleatórios', () => {
  let seed = 2026;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const bal = (st, id) => st.accounts.find((a) => a.id === id).balance;
  for (let it = 0; it < 400; it++) {
    const s = scenario();
    s.accounts[0].balance = int(-50000, 300000);
    s.accounts[1].balance = int(0, 300000);
    if (rnd() < 0.5) s.expenses.push({ id: 'x', name: 'X', amount: int(1000, 200000), accountId: 'cc', day: int(1, 28), exceptions: {}, since: TODAY });
    const today = addDays(TODAY, int(0, 55));
    const txs = [];
    for (let j = int(1, 3); j > 0; j--) txs.push(income(s, today, int(500, 600000), rnd() < 0.8 ? 'cc' : 'cdb'));
    const L = limit(s, today);
    const pace = Math.max(L, 1000) * (0.6 + rnd() * 0.6);
    for (let d = int(0, 30); d >= 1; d--) s.transactions.push({ id: `g${++n}`, type: 'spend', date: addDays(today, -d), amount: Math.round(pace * (0.5 + rnd())), from: 'cdb' });
    const open = openSavings(s, today);
    const floor = savingFloor(s, today);
    for (const tx of txs) {
      const r = suggestSaving(s, today, tx);
      assert.ok(r.amount >= 0 && r.amount <= Math.floor(tx.amount / 10) && r.amount % 100 === 0);
      if (r.amount > 0) {
        assert.ok(r.amount >= SAVINGS.minAmount && r.amount * 100 >= tx.amount && r.amount <= bal(s, tx.to));
        const t = structuredClone(s);
        save(t, tx, r.amount, today);
        assert.equal(limit(t, today), r.limitAfter);
        assert.ok(r.limitAfter >= r.floor && r.limitAfter > 0);
        if (r.limitedBy === 'floor') { save(t, tx, 100, today); assert.ok(limit(t, today) < r.floor); }
      }
    }
    const v = structuredClone(s);
    const rest = open.map((o) => [o.tx.id, o.amount]);
    for (const o of open) {
      save(v, v.transactions.find((t) => t.id === o.tx.id), o.amount, today);
      rest.shift();
      if (floor.basis === 'history') {
        assert.deepEqual(openSavings(v, today).map((x) => [x.tx.id, x.amount]), rest);
        assert.ok(limit(v, today) >= floor.floor);
      }
    }
  }
});
