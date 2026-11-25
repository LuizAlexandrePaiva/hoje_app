import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { scenario, TODAY } from './fixtures.js';
import { invoiceKey, parseInvoiceKey, invoiceSummary, sanitizeInvoices, invoiceDatesOf, validItemDate, sortInvoiceItems } from '../app/js/core/invoice.js';
import { expandOccurrences, openEvents, occurrenceByKey, currentInvoices } from '../app/js/core/schedule.js';
import { computeDailyBudget } from '../app/js/core/budget.js';
import { suggestRefill } from '../app/js/core/refill.js';
import { projectBalance } from '../app/js/core/projection.js';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const store = await import('../app/js/data/store.js');

const K = 'expense:fatura:2026-10';
const K11 = 'expense:fatura:2026-11';
const items = (...amounts) => amounts.map((amount, i) => ({ id: `i${i}`, name: `Item ${i}`, amount }));
/** Fixture com a fatura vencendo em 30/10 (dentro do horizonte) e marcada como cartão. */
function base(invoice) {
  const s = scenario();
  Object.assign(s.expenses[0], { day: 30, isCard: true });
  s.invoices = invoice ? { [K]: invoice } : {};
  return s;
}
const limit = (s, day = TODAY) => computeDailyBudget(s, day).dailyBudget;

test('chave da fatura é a chave da ocorrência', () => {
  assert.equal(invoiceKey('fatura', '2026-11'), K11);
  assert.deepEqual(parseInvoiceKey(K11), { expenseId: 'fatura', month: '2026-11' });
  assert.deepEqual(parseInvoiceKey('expense:a:b:2026-01'), { expenseId: 'a:b', month: '2026-01' });
  for (const bad of ['income:sal:2026-11', 'expense:fatura:2026-13', 'expense:fatura:2026-1', 'expense::2026-11', 'contribution:ap1', '', null, 42]) {
    assert.equal(parseInvoiceKey(bad), null);
  }
  const occ = expandOccurrences(base(), '2026-10-26', '2026-10-31').find((e) => e.kind === 'expense');
  assert.equal(occ.key, K);
});

test('resumo: sem gastos vale o previsto; aberta, o maior; fechada, a soma', () => {
  const sum = (est, inv) => invoiceSummary(est, inv);
  assert.deepEqual(sum(18000, null), { estimate: 18000, sum: 0, count: 0, closed: false, total: 18000, rest: 0 });
  assert.deepEqual(sum(18000, { items: [] }), { estimate: 18000, sum: 0, count: 0, closed: false, total: 18000, rest: 0 });
  assert.deepEqual(sum(18000, { items: [], closed: true }), { estimate: 18000, sum: 0, count: 0, closed: false, total: 18000, rest: 0 });
  assert.deepEqual(sum(18000, { items: items(4500) }), { estimate: 18000, sum: 4500, count: 1, closed: false, total: 18000, rest: 13500 });
  assert.deepEqual(sum(18000, { items: items(4500, 13500) }), { estimate: 18000, sum: 18000, count: 2, closed: false, total: 18000, rest: 0 });
  assert.deepEqual(sum(18000, { items: items(4500, 13500, 7000) }), { estimate: 18000, sum: 25000, count: 3, closed: false, total: 25000, rest: 0 });
  assert.deepEqual(sum(18000, { items: items(4500, 7500), closed: true }), { estimate: 18000, sum: 12000, count: 2, closed: true, total: 12000, rest: 0 });
  assert.deepEqual(sum(18000, { items: items(20000, 5000), closed: true }), { estimate: 18000, sum: 25000, count: 2, closed: true, total: 25000, rest: 0 });
  assert.deepEqual(sum(0, { items: items(1) }), { estimate: 0, sum: 1, count: 1, closed: false, total: 1, rest: 0 });
  assert.equal(sum(undefined, { items: items(500) }).total, 500);
  assert.equal(sum(NaN, null).total, 0);
  // itens inválidos não contam e nunca dão NaN
  const dirty = { items: [{ amount: 100 }, { amount: '200' }, { amount: 1.5 }, { amount: -3 }, null, { amount: NaN }, { amount: 0 }] };
  assert.deepEqual(sum(50, dirty), { estimate: 50, sum: 100, count: 1, closed: false, total: 100, rest: 0 });
  assert.equal(sum(18000, { items: 'x' }).total, 18000);
});

test('aceitação não muda com o cartão sem fatura; fatura maior depois do salário já pesa hoje', () => {
  const s = scenario();
  s.expenses[0].isCard = true;
  let b = computeDailyBudget(s, TODAY);
  assert.equal(b.dailyBudget, 16993);
  assert.equal(suggestRefill(s, TODAY, b).amount, 115000);
  // fatura de 25/11 com R$ 900 (previsto R$ 180): o limite olha 12 meses e o dia apertado vira 6/12
  s.invoices = { [K11]: { items: items(90000) } };
  b = computeDailyBudget(s, TODAY);
  assert.equal(b.limitingDay, '2026-12-06');
  assert.equal(b.dailyBudget, Math.round((237900 + 675000 - 160000 - 90000) / 42)); // 15783
  assert.equal(suggestRefill(s, TODAY, b).amount, 105000); // 157,83 × 7 − 64 → múltiplo de R$ 50
});

test('limite: detalhar dentro do previsto não mexe; passar do previsto baixa; fechar usa a soma', () => {
  assert.equal(limit(base()), 15707);
  assert.equal(limit(base({ items: items(4000, 6000) })), 15707);
  assert.equal(limit(base({ items: items(20000, 5000) })), 15207);
  assert.equal(limit(base({ items: items(4000, 6000), closed: true })), 16279);
  assert.equal(limit(base({ items: items(20000, 5000), closed: true })), 15207);
});

test('ocorrência do cartão leva o resumo da fatura; as outras ficam como eram', () => {
  const s = base({ items: items(20000, 5000) });
  s.expenses.push({ id: 'luz', name: 'Luz', amount: 9000, accountId: 'cc', day: 28, exceptions: {}, since: TODAY });
  const occ = expandOccurrences(s, '2026-10-26', '2026-11-30').filter((e) => e.kind === 'expense');
  const oct = occ.find((e) => e.key === K);
  assert.equal(oct.amount, 25000);
  assert.equal(oct.isCard, true);
  assert.deepEqual(oct.invoice, { estimate: 18000, sum: 25000, count: 2, closed: false, total: 25000, rest: 0 });
  const nov = occ.find((e) => e.key === K11);
  assert.equal(nov.amount, 18000);
  assert.deepEqual(nov.invoice, { estimate: 18000, sum: 0, count: 0, closed: false, total: 18000, rest: 0 });
  const luz = occ.find((e) => e.sourceId === 'luz');
  assert.equal('isCard' in luz, false);
  assert.equal('invoice' in luz, false);
});

test('exceção do mês é o previsto do mês; fatura fechada ganha dela', () => {
  const s = base({ items: items(20000, 5000) });
  s.expenses[0].exceptions = { '2026-10': 30000 };
  assert.equal(limit(s), 14850);
  s.invoices[K].closed = true;
  assert.equal(limit(s), 15207);
  delete s.invoices[K].closed;
  s.expenses[0].exceptions = { '2026-10': 0 };
  assert.equal(limit(s), 15207);
});

test('data mudada: a fatura acompanha a ocorrência, a chave não muda', () => {
  const s = base({ items: items(20000, 5000) });
  s.moved = { [K]: '2026-11-03' };
  const occ = expandOccurrences(s, '2026-10-26', '2026-11-30').filter((e) => e.kind === 'expense');
  assert.deepEqual(occ.map((e) => [e.key, e.date, e.amount]), [[K, '2026-11-03', 25000], [K11, '2026-11-30', 18000]]);
  assert.equal(limit(s), 15207);
  s.moved = { [K]: '2026-11-12' }; // depois do salário de 9/11: pesa no ciclo seguinte (até 6/12)
  assert.equal(limit(s), Math.round((237900 + 675000 - 160000 - 25000 - 18000) / 42)); // 16902
  const o = occurrenceByKey(s, K);
  assert.deepEqual([o.date, o.originalDate, o.amount], ['2026-11-12', '2026-10-30', 25000]);
});

test('occurrenceByKey: qualquer mês, pago ou não; null fora das datas da despesa', () => {
  const s = base({ items: items(20000, 5000), closed: true });
  assert.equal(occurrenceByKey(s, 'expense:fatura:2027-02').date, '2027-02-28');
  assert.equal(occurrenceByKey(s, 'expense:fatura:2026-09'), null); // antes de "contar a partir de"
  assert.equal(occurrenceByKey(s, 'expense:nao-existe:2026-10'), null);
  assert.equal(occurrenceByKey(s, 'contribution:ap1'), null);
  s.settled[K] = { date: '2026-10-30', amount: 25000, txId: 't1' };
  assert.equal(occurrenceByKey(s, K).amount, 25000);
  s.expenses[0].since = '2026-10-31';
  assert.equal(occurrenceByKey(s, K), null);
  assert.equal(limit(s), 16993);
  assert.equal(s.invoices[K].items.length, 2); // guardada, só não vale
});

test('deixar de ser cartão: fatura guardada e ignorada; voltar a ser cartão restaura', () => {
  const s = base({ items: items(20000, 5000) });
  s.expenses[0].isCard = false;
  assert.equal(limit(s), 15707);
  assert.equal(s.invoices[K].items.length, 2);
  s.expenses[0].isCard = true;
  assert.equal(limit(s), 15207);
});

test('resgate e linha do tempo recebem o valor da fatura', () => {
  let s = base({ items: items(20000, 5000) });
  let b = computeDailyBudget(s, TODAY);
  let r = suggestRefill(s, TODAY, b);
  assert.deepEqual([r.commitments, r.raw, r.amount], [25000, 15207 * 7 + 25000 - 6400, 130000]);
  assert.equal(projectBalance(s, TODAY, b).events.find((e) => e.key === K).amount, 25000);
  s = base({ items: items(4000, 6000), closed: true });
  b = computeDailyBudget(s, TODAY);
  r = suggestRefill(s, TODAY, b);
  assert.deepEqual([b.dailyBudget, r.commitments, r.amount], [16279, 10000, 120000]);
});

test('fatura atual de cada cartão: a não paga mais antiga', () => {
  const s = base();
  s.expenses.push({ id: 'outro', name: 'Outro cartão', amount: 50000, accountId: 'cc', day: 5, exceptions: {}, since: TODAY, isCard: true });
  s.expenses.push({ id: 'luz', name: 'Luz', amount: 9000, accountId: 'cc', day: 28, exceptions: {}, since: TODAY });
  assert.deepEqual(currentInvoices(s, TODAY).map((o) => [o.key, o.date]), [[K, '2026-10-30'], ['expense:outro:2026-11', '2026-11-05']]);
  // vencida e não paga continua sendo a atual; paga, passa para a seguinte
  assert.deepEqual(currentInvoices(s, '2026-11-02').map((o) => [o.key, o.overdue]), [[K, true], ['expense:outro:2026-11', false]]);
  s.settled[K] = { date: '2026-10-30', amount: 18000, txId: 't1' };
  assert.equal(currentInvoices(s, '2026-11-02')[0].key, K11);
  // data mudada para depois da seguinte: a atual é a que vence primeiro
  delete s.settled[K];
  s.moved = { [K]: '2026-12-10' };
  assert.equal(currentInvoices(s, '2026-11-02')[0].key, K11);
  s.expenses[0].isCard = false;
  assert.deepEqual(currentInvoices(s, '2026-11-02').map((o) => o.sourceId), ['outro']);
});

test('dia 31 em mês curto: a chave continua no mês', () => {
  const s = base();
  s.expenses[0].day = 31;
  const occ = expandOccurrences(s, '2026-12-01', '2027-02-28').filter((e) => e.kind === 'expense');
  assert.deepEqual(occ.map((e) => [e.key, e.date]), [
    ['expense:fatura:2026-12', '2026-12-31'], ['expense:fatura:2027-01', '2027-01-31'], ['expense:fatura:2027-02', '2027-02-28']]);
});

test('sanitizeInvoices: backup sujo vira mapa íntegro', () => {
  const exps = [{ id: 'fatura' }];
  for (const bad of [undefined, null, [], 'x', 5]) assert.deepEqual(sanitizeInvoices(bad, exps), {});
  const out = sanitizeInvoices({
    [K]: { items: [{ id: 'a', name: ' Mercado ', amount: 100 }, { id: 'a', name: 7, amount: 200 }, { name: 'ruim', amount: 1.5 }, { amount: 300 }, null], closed: 'sim', total: 999 },
    [K11]: { items: items(25000), closed: true },
    'expense:fatura:2026-12': { items: [] },
    'expense:fatura:2027-01': { items: 'nada' },
    'expense:fantasma:2026-10': { items: items(100) },
    'income:sal:2026-11': { items: items(100) },
    'expense:fatura:2026-99': { items: items(100) },
    lixo: 3,
  }, exps);
  assert.deepEqual(Object.keys(out), [K, K11]);
  assert.deepEqual(out[K].items.map((i) => [i.name, i.amount]), [['Mercado', 100], ['7', 200], ['', 300]]);
  assert.equal(new Set(out[K].items.map((i) => i.id)).size, 3);
  assert.deepEqual(Object.keys(out[K]), ['items']); // closed inválido e campos calculados saem
  assert.equal(out[K11].closed, true);
  assert.deepEqual(sanitizeInvoices(out, exps), out); // idempotente
  assert.equal(sanitizeInvoices({ [K]: { items: [{ id: 'x', name: 'n'.repeat(100), amount: 1 }] } }, exps)[K].items[0].name.length, 60);
});

test('dia da compra: opcional, mas quando vem é uma data de verdade', () => {
  for (const ok of ['2026-10-08', '2024-02-29', '2000-01-01', '2099-12-31']) assert.equal(validItemDate(ok), true, ok);
  for (const bad of ['', null, undefined, 20261008, '08/10/2026', '2026-10-8', '2026-02-30', '2025-02-29', '2026-13-01', '0202-10-08', '1999-12-31', '2100-01-01', '2026-10-08T12:00']) {
    assert.equal(validItemDate(bad), false, String(bad));
  }
});

test('ordem dos gastos na fatura: sem data primeiro, depois do dia mais antigo ao mais recente', () => {
  const list = [
    { id: 'a', name: 'Posto', amount: 1, date: '2026-10-12' },
    { id: 'b', name: 'Sem data 1', amount: 1 },
    { id: 'c', name: 'Mercado', amount: 1, date: '2026-09-30' },
    { id: 'd', name: 'Padaria', amount: 1, date: '2026-10-12' },
    { id: 'e', name: 'Sem data 2', amount: 1, date: 'ontem' }, // data inválida conta como sem data
    { id: 'f', name: 'Farmácia', amount: 1, date: '2026-10-01' },
  ];
  const before = structuredClone(list);
  assert.deepEqual(sortInvoiceItems(list).map((i) => i.id), ['b', 'e', 'c', 'f', 'a', 'd']);
  assert.deepEqual(list, before); // não mexe na lista guardada
  assert.deepEqual(sortInvoiceItems(items(1, 2, 3)).map((i) => i.id), ['i0', 'i1', 'i2']); // sem datas, a ordem de lançamento
  for (const bad of [undefined, null, 'x', 5]) assert.deepEqual(sortInvoiceItems(bad), []);
});

test('sanitizeInvoices: guarda o dia da compra válido e descarta só a data ruim', () => {
  const exps = [{ id: 'fatura' }];
  const out = sanitizeInvoices({
    [K]: { items: [
      { id: 'a', name: 'Mercado', amount: 100, date: '2026-10-08' },
      { id: 'b', name: 'Posto', amount: 200, date: '08/10/2026' },
      { id: 'c', name: 'Padaria', amount: 300, date: '2026-02-30' },
      { id: 'd', name: 'Farmácia', amount: 400, date: null },
      { id: 'e', name: 'Livraria', amount: 500, date: 20261008 },
    ] },
  }, exps);
  assert.deepEqual(out[K].items, [
    { id: 'a', name: 'Mercado', amount: 100, date: '2026-10-08' },
    { id: 'b', name: 'Posto', amount: 200 },
    { id: 'c', name: 'Padaria', amount: 300 },
    { id: 'd', name: 'Farmácia', amount: 400 },
    { id: 'e', name: 'Livraria', amount: 500 },
  ]);
  assert.deepEqual(sanitizeInvoices(out, exps), out); // idempotente
  assert.equal(invoiceSummary(100000, out[K]).sum, 1500); // a data não entra na conta
});

test('cópia dos dias de compra: devolve a data ao gasto que chegou sem ela', () => {
  const exps = [{ id: 'fatura' }];
  const full = { [K]: { items: [{ id: 'a', name: 'Mercado', amount: 100, date: '2026-10-08' }, { id: 'b', name: 'Posto', amount: 200 }] }, [K11]: { items: [{ id: 'a', name: 'Padaria', amount: 300, date: '2026-11-02' }] } };
  const dates = invoiceDatesOf(full);
  assert.deepEqual(dates, { [K]: { a: '2026-10-08' }, [K11]: { a: '2026-11-02' } }); // por fatura: ids podem se repetir entre elas
  // como a 2.0.0 regrava os gastos: só id, nome e valor
  const stripped = structuredClone(full);
  for (const inv of Object.values(stripped)) for (const it of inv.items) delete it.date;
  assert.deepEqual(sanitizeInvoices(stripped, exps, 60, dates), full);
  // a data do próprio gasto vale mais que a da cópia; cópia estragada não atrapalha
  const moved = structuredClone(full);
  moved[K].items[0].date = '2026-10-09';
  assert.equal(sanitizeInvoices(moved, exps, 60, dates)[K].items[0].date, '2026-10-09');
  for (const bad of [null, 5, 'x', [], { [K]: 7 }, { [K]: { a: '08/10/2026' } }, { [K]: { a: 20261008 } }]) {
    assert.deepEqual(sanitizeInvoices(stripped, exps, 60, bad), stripped, JSON.stringify(bad));
  }
  assert.deepEqual(invoiceDatesOf({}), {});
  assert.deepEqual(invoiceDatesOf(undefined), {});
});

// ---------- store ----------

function boot(invoice) {
  mem.clear();
  mem.set('hoje:v1', JSON.stringify(base(invoice)));
  store.load();
}
beforeEach(() => boot());

test('store: backup antigo (sem invoices) carrega como antes', () => {
  mem.set('hoje:v1', JSON.stringify(scenario()));
  store.load();
  assert.deepEqual(store.getState().invoices, {});
  assert.equal(limit(store.getState()), 16993);
  for (const bad of [null, 5, 'x', []]) {
    mem.set('hoje:v1', JSON.stringify({ ...base(), invoices: bad }));
    store.load();
    assert.deepEqual(store.getState().invoices, {});
    assert.equal(limit(store.getState()), 15707);
  }
});

test('store: lançar, editar e remover gastos', () => {
  const a = store.addInvoiceItem(K, { name: '  Mercado \n do  bairro ', amount: 12050 });
  const b = store.addInvoiceItem(K, { name: '', amount: 990 });
  assert.match(a.id, /^it_/);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(store.getState().invoices[K].items.map((i) => [i.name, i.amount]), [['Mercado do bairro', 12050], ['', 990]]);
  assert.deepEqual(JSON.parse(mem.get('hoje:v1')).invoices[K].items.length, 2); // salvo no aparelho
  assert.deepEqual(store.updateInvoiceItem(K, b.id, { name: 'Streaming', amount: 2990 }), { id: b.id, name: 'Streaming', amount: 2990 });
  assert.equal(store.updateInvoiceItem(K, 'nao-existe', { name: 'x', amount: 1 }), null);
  for (const bad of [0, -100, 10.5, NaN, '100', null, undefined]) {
    assert.throws(() => store.updateInvoiceItem(K, b.id, { name: 'x', amount: bad }), /Informe o valor/);
    assert.throws(() => store.addInvoiceItem(K, { name: 'x', amount: bad }), /Informe o valor/);
  }
  assert.equal(store.getState().invoices[K].items[1].amount, 2990);
  assert.equal(store.addInvoiceItem(K, { name: 'n'.repeat(100), amount: 1 }).name.length, store.NAME_MAX);
  store.removeInvoiceItem(K, store.getState().invoices[K].items[2].id);
  // remover devolve o necessário para desfazer; a ordem volta
  const gone = store.removeInvoiceItem(K, a.id);
  assert.deepEqual([gone.item.name, gone.index, gone.closed], ['Mercado do bairro', 0, false]);
  store.addInvoiceItem(K, gone.item, gone.index);
  assert.deepEqual(store.getState().invoices[K].items.map((i) => i.name), ['Mercado do bairro', 'Streaming']);
  assert.equal(store.removeInvoiceItem(K, 'nao-existe'), null);
});

test('store: sem gastos a fatura deixa de existir; fechar só com gastos', () => {
  assert.equal(store.setInvoiceClosed(K, true), false);
  assert.deepEqual(store.getState().invoices, {});
  const a = store.addInvoiceItem(K, { name: 'Mercado', amount: 10000 });
  assert.equal(limit(store.getState()), 15707);
  assert.equal(store.setInvoiceClosed(K, true), true);
  assert.equal(limit(store.getState()), 16279);
  assert.equal(store.setInvoiceClosed(K, true), false);
  const gone = store.removeInvoiceItem(K, a.id);
  assert.equal(gone.closed, true);
  assert.equal(K in store.getState().invoices, false);
  assert.equal(limit(store.getState()), 15707);
  // desfazer: o gasto volta e a fatura volta fechada
  store.addInvoiceItem(K, gone.item, gone.index);
  assert.equal(store.getState().invoices[K].closed, undefined);
  store.setInvoiceClosed(K, true);
  assert.equal(limit(store.getState()), 16279);
  assert.equal(store.setInvoiceClosed(K, false), true);
  assert.equal('closed' in store.getState().invoices[K], false);
});

test('store: fatura de despesa que não existe ou não é cartão não aceita gastos', () => {
  assert.throws(() => store.addInvoiceItem('expense:nao-existe:2026-10', { amount: 100 }), /não existe mais/);
  assert.throws(() => store.addInvoiceItem('income:sal:2026-11', { amount: 100 }), /não existe mais/);
  const a = store.addInvoiceItem(K, { name: 'Mercado', amount: 100 });
  const before = mem.get('hoje:v1');
  store.upsert('expenses', { id: 'fatura', isCard: false });
  assert.throws(() => store.addInvoiceItem(K, { amount: 100 }), /não existe mais/);
  assert.throws(() => store.removeInvoiceItem(K, a.id), /não existe mais/);
  assert.equal(store.getState().invoices[K].items.length, 1);
  assert.notEqual(mem.get('hoje:v1'), before); // só o upsert salvou
});

test('store: pagar no vencimento pelo valor previsto não muda o limite; desfazer devolve tudo', () => {
  boot({ items: items(20000, 5000) });
  const day = '2026-10-30';
  const ev = openEvents(store.getState(), day, day).find((e) => e.key === K);
  assert.equal(ev.amount, 25000);
  const before = limit(store.getState(), day);
  assert.equal(before, Math.round((237900 + 675000 - 160000 - 25000 - 18000) / 38)); // 18682, até 6/12
  const snapshot = structuredClone(store.getState().invoices);
  const t = store.confirmOccurrence(ev, { amount: ev.amount, date: day });
  assert.equal(limit(store.getState(), day), before);
  assert.deepEqual(store.getState().invoices, snapshot);
  assert.equal(store.getState().settled[K].amount, 25000);
  // detalhar depois de pagar é só registro
  store.updateInvoiceItem(K, 'i0', { name: 'Item 0', amount: 99900 });
  assert.equal(limit(store.getState(), day), before);
  store.updateInvoiceItem(K, 'i0', { name: 'Item 0', amount: 20000 });
  store.deleteTransaction(t.id);
  assert.equal(store.getState().settled[K], undefined);
  assert.deepEqual(store.getState().invoices, snapshot);
  assert.equal(limit(store.getState(), day), before);
  assert.equal(store.getAccount('cc').balance, 6400);
});

test('store: pagar outro valor, pular e atrasar', () => {
  boot({ items: items(25000) });
  const day = '2026-10-30';
  const ev = openEvents(store.getState(), day, day).find((e) => e.key === K);
  store.confirmOccurrence(ev, { amount: 26000, date: day });
  assert.equal(store.getState().settled[K].amount, 26000);
  assert.equal(occurrenceByKey(store.getState(), K).invoice.sum, 25000); // diferença só é mostrada
  assert.equal(limit(store.getState(), day), Math.round((237900 - 26000 + 675000 - 160000 - 18000) / 38)); // 18655
  boot({ items: items(25000) });
  store.skipOccurrence(openEvents(store.getState(), day, day).find((e) => e.key === K));
  assert.equal(store.getState().settled[K].skipped, true);
  assert.equal(store.getState().invoices[K].items.length, 1);
  assert.equal(limit(store.getState(), day), Math.round((237900 + 675000 - 160000 - 18000) / 38)); // pulada: nada reservado
  boot({ items: items(20000, 5000) });
  // atrasada e não paga: conta como de hoje
  assert.equal(limit(store.getState(), '2026-10-31'), Math.round((237900 + 675000 - 160000 - 25000 - 18000) / 37));
});

test('store: excluir a despesa apaga as faturas dela, pagas ou não', () => {
  boot({ items: items(20000, 5000) });
  store.addInvoiceItem(K11, { name: 'Parcela', amount: 30000 });
  store.upsert('expenses', { id: 'outro', name: 'Outro', amount: 100, accountId: 'cc', day: 5, exceptions: {}, since: TODAY, isCard: true });
  store.addInvoiceItem('expense:outro:2026-11', { name: 'x', amount: 100 });
  const ev = openEvents(store.getState(), '2026-10-30', '2026-10-30').find((e) => e.key === K);
  store.confirmOccurrence(ev, { amount: 25000, date: '2026-10-30' });
  store.remove('expenses', 'fatura');
  assert.deepEqual(Object.keys(store.getState().invoices), ['expense:outro:2026-11']);
  assert.equal(store.getState().transactions.length, 1); // o pagamento continua no histórico
});

test('store: exportar e importar preserva faturas; importação suja é limpa', () => {
  boot({ items: items(20000, 5000), closed: true });
  const json = store.exportJSON();
  const want = structuredClone(store.getState().invoices);
  mem.clear();
  store.load();
  store.importJSON(json);
  assert.deepEqual(store.getState().invoices, want);
  assert.equal(store.getState().expenses[0].isCard, true);
  assert.equal(limit(store.getState()), 15207);
  const dirty = { ...base(), invoices: { [K]: { items: [{ id: 'a', amount: 'mil' }, { id: 'b', name: 'ok', amount: 25000 }] }, 'expense:fantasma:2026-10': { items: items(1) }, lixo: 3 } };
  store.importJSON(JSON.stringify(dirty));
  assert.deepEqual(Object.keys(store.getState().invoices), [K]);
  assert.equal(limit(store.getState()), 15207);
});

test('store: dia da compra em cada gasto (lançar, trocar, tirar, desfazer)', () => {
  const before = limit(store.getState());
  const a = store.addInvoiceItem(K, { name: 'Mercado', amount: 12050, date: '2026-10-08' });
  assert.deepEqual(a, { id: a.id, name: 'Mercado', amount: 12050, date: '2026-10-08' });
  const b = store.addInvoiceItem(K, { name: 'Posto', amount: 990, date: '' });
  assert.equal('date' in b, false); // sem data, a chave nem existe
  assert.equal('date' in store.addInvoiceItem(K, { name: 'Padaria', amount: 500, date: null }), false);
  assert.equal(JSON.parse(mem.get('hoje:v1')).invoices[K].items[0].date, '2026-10-08'); // salvo no aparelho
  // trocar e tirar a data
  assert.equal(store.updateInvoiceItem(K, a.id, { name: 'Mercado', amount: 12050, date: '2026-10-09' }).date, '2026-10-09');
  assert.equal(store.updateInvoiceItem(K, b.id, { name: 'Posto', amount: 990, date: '2026-09-30' }).date, '2026-09-30');
  const cleared = store.updateInvoiceItem(K, a.id, { name: 'Mercado', amount: 12050, date: '' });
  assert.deepEqual(cleared, { id: a.id, name: 'Mercado', amount: 12050 });
  assert.equal('date' in store.getState().invoices[K].items[0], false);
  // data ruim não salva nada
  const saved = mem.get('hoje:v1');
  for (const bad of ['08/10/2026', '2026-02-30', '0202-10-08', 20261008, 'ontem']) {
    assert.throws(() => store.addInvoiceItem(K, { name: 'x', amount: 100, date: bad }), /data válida/);
    assert.throws(() => store.updateInvoiceItem(K, b.id, { name: 'x', amount: 100, date: bad }), /data válida/);
  }
  assert.equal(mem.get('hoje:v1'), saved);
  // remover e desfazer devolve o gasto com a data
  const gone = store.removeInvoiceItem(K, b.id);
  assert.equal(gone.item.date, '2026-09-30');
  store.addInvoiceItem(K, gone.item, gone.index);
  assert.deepEqual(store.getState().invoices[K].items.map((i) => [i.name, i.date]), [['Mercado', undefined], ['Posto', '2026-09-30'], ['Padaria', undefined]]);
  // a data é só registro: o limite depende dos valores, não dos dias
  assert.equal(limit(store.getState()), before);
  store.updateInvoiceItem(K, a.id, { name: 'Mercado', amount: 12050, date: '2026-10-20' });
  assert.equal(limit(store.getState()), before);
});

test('store: aparelho ainda na 2.0.0 não apaga as datas dos outros', () => {
  const a = store.addInvoiceItem(K, { name: 'Mercado', amount: 12050, date: '2026-10-08' });
  const b = store.addInvoiceItem(K, { name: 'Posto', amount: 990, date: '2026-10-12' });
  assert.deepEqual(store.getState().invoiceDates, { [K]: { [a.id]: '2026-10-08', [b.id]: '2026-10-12' } });
  // a 2.0.0 recebe o estado, regrava os gastos sem data, muda um nome e devolve; chaves de topo ela mantém
  const old = JSON.parse(mem.get('hoje:v1'));
  old.invoices[K].items = old.invoices[K].items.map(({ id, name, amount }) => ({ id, name, amount }));
  old.invoices[K].items[1].name = 'Posto da esquina';
  store.replaceState(old);
  assert.deepEqual(store.getState().invoices[K].items.map((i) => [i.name, i.date]), [['Mercado', '2026-10-08'], ['Posto da esquina', '2026-10-12']]);
  // tirar a data de propósito continua valendo depois de recarregar
  store.updateInvoiceItem(K, a.id, { name: 'Mercado', amount: 12050, date: '' });
  assert.deepEqual(store.getState().invoiceDates, { [K]: { [b.id]: '2026-10-12' } });
  store.load();
  assert.equal('date' in store.getState().invoices[K].items[0], false);
  // gasto removido sai da cópia; sem gastos com data, a cópia fica vazia
  store.removeInvoiceItem(K, b.id);
  assert.deepEqual(store.getState().invoiceDates, {});
  assert.deepEqual(JSON.parse(mem.get('hoje:v1')).invoiceDates, {});
});

test('store: backup com datas nos gastos vai e volta igual', () => {
  store.addInvoiceItem(K, { name: 'Mercado', amount: 12050, date: '2026-10-08' });
  store.addInvoiceItem(K, { name: 'Posto', amount: 990 });
  const want = structuredClone(store.getState().invoices);
  const json = store.exportJSON();
  boot();
  store.importJSON(json);
  assert.deepEqual(store.getState().invoices, want);
  // data estragada no gasto: vale a da cópia que vai no mesmo arquivo
  const dirty = JSON.parse(json);
  dirty.invoices[K].items[0].date = '2026-10-32';
  store.importJSON(JSON.stringify(dirty));
  assert.deepEqual(store.getState().invoices[K].items.map((i) => [i.name, i.amount, i.date]), [['Mercado', 12050, '2026-10-08'], ['Posto', 990, undefined]]);
  // estragada nos dois lugares (ou arquivo sem a cópia): o gasto entra sem data
  dirty.invoiceDates = { [K]: { [dirty.invoices[K].items[0].id]: '2026-10-32' } };
  store.importJSON(JSON.stringify(dirty));
  assert.deepEqual(store.getState().invoices[K].items.map((i) => [i.name, i.amount, i.date]), [['Mercado', 12050, undefined], ['Posto', 990, undefined]]);
  delete dirty.invoiceDates;
  store.importJSON(JSON.stringify(dirty));
  assert.deepEqual(store.getState().invoices[K].items.map((i) => i.date), [undefined, undefined]);
  assert.deepEqual(store.getState().invoiceDates, {});
});

test('transferência não muda o limite, com fatura aberta ou fechada', () => {
  for (const inv of [{ items: items(20000, 5000) }, { items: items(4000), closed: true }]) {
    boot(inv);
    const before = limit(store.getState());
    store.transfer('cdb', 'cc', 12345, 'Resgate');
    assert.equal(limit(store.getState()), before);
  }
});
