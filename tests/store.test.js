import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './fixtures.js';

// localStorage mínimo para a store rodar no Node
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const store = await import('../app/js/data/store.js');

beforeEach(() => {
  mem.clear();
  mem.set('hoje:v1', JSON.stringify(scenario()));
  store.load();
});

test('gasto pode ser lançado com nome e renomeado depois', () => {
  const t = store.addSpend(4590, 'Mercadu');
  store.renameTransaction(t.id, '  Mercado  ');
  assert.equal(store.getState().transactions.find((x) => x.id === t.id).desc, 'Mercado');
  // salvo no aparelho
  assert.equal(JSON.parse(mem.get('hoje:v1')).transactions[0].desc, 'Mercado');
});

test('nome vazio remove o nome; nome longo é cortado', () => {
  const t = store.addSpend(1000, 'Café');
  store.renameTransaction(t.id, '   ');
  assert.equal(store.getState().transactions[0].desc, '');
  store.renameTransaction(t.id, 'x'.repeat(100));
  assert.equal(store.getState().transactions[0].desc.length, store.NAME_MAX);
});

test('renomear não mexe em valores nem saldos', () => {
  const before = store.getState().accounts.map((a) => a.balance);
  const t = store.addSpend(2500, '');
  const after = store.getState().accounts.map((a) => a.balance);
  store.renameTransaction(t.id, 'Padaria');
  assert.deepEqual(store.getState().accounts.map((a) => a.balance), after);
  assert.notDeepEqual(after, before);
  assert.equal(store.getState().transactions[0].amount, 2500);
});

test('sugestões: nomes de gastos recentes, sem repetir e sem outros lançamentos', () => {
  store.addSpend(100, 'Café');
  store.addSpend(200, 'Mercado');
  store.addSpend(300, 'café');
  store.addSpend(400, '');
  store.transfer('cdb', 'cc', 5000, 'Resgate');
  assert.deepEqual(store.recentNames('spend'), ['café', 'Mercado']);
});

test('receita avulsa entra no saldo na hora, não conta como gasto e tem sugestões próprias', async () => {
  const { computeDailyBudget } = await import('../app/js/core/budget.js');
  const before = computeDailyBudget(store.getState(), '2026-10-26');
  store.addIncome(42000, 'Freela', 'cc');
  const s = store.getState();
  assert.equal(s.accounts.find((a) => a.id === 'cc').balance, 6400 + 42000);
  const after = computeDailyBudget(s, '2026-10-26');
  assert.equal(after.spentToday, 0);
  assert.equal(after.dailyBudget, Math.round((237900 + 42000) / 14));
  assert.ok(after.dailyBudget > before.dailyBudget);
  store.addSpend(1000, 'Café');
  assert.deepEqual(store.recentNames('income'), ['Freela']);
  assert.deepEqual(store.recentNames('spend'), ['Café']);
});

test('papéis das contas: trocar gastos do dia e reserva, sem reserva, nunca sem conta de gastos', () => {
  const st = () => store.getState().settings;
  assert.equal(st().defaultAccountId, 'cc');
  assert.equal(st().reserveAccountId, 'cdb');
  // CDB vira a conta dos gastos: a corrente vira reserva (troca)
  store.setAccountRole('cdb', 'spend');
  assert.deepEqual([st().defaultAccountId, st().reserveAccountId], ['cdb', 'cc']);
  // a reserva pode ficar sem conta, e isso é respeitado
  store.setAccountRole('cc', 'none');
  assert.deepEqual([st().defaultAccountId, st().reserveAccountId], ['cdb', null]);
  store.updateSettings({ surplusEnabled: false });
  assert.equal(st().reserveAccountId, null);
  // tirar o papel da conta dos gastos passa a função para outra conta
  const moved = store.setAccountRole('cdb', 'reserve');
  assert.equal(moved.id, 'cc');
  assert.deepEqual([st().defaultAccountId, st().reserveAccountId], ['cc', 'cdb']);
  // conta de meta nunca vira conta de gastos
  store.setAccountRole('cc', 'none');
  assert.equal(st().defaultAccountId, 'cdb');
});
