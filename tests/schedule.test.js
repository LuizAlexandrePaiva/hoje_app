import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandOccurrences, openEvents, pendingConfirmations } from '../app/js/core/schedule.js';
import { TODAY, scenario } from './fixtures.js';

test('fatura anterior ao cadastro é ignorada; a de novembro aparece', () => {
  const ev = expandOccurrences(scenario(), '2026-10-01', '2026-11-30').filter((e) => e.kind === 'expense');
  assert.deepEqual(ev.map((e) => e.date), ['2026-11-25']);
});

test('ocorrências de novembro em ordem', () => {
  const ev = expandOccurrences(scenario(), TODAY, '2026-11-30');
  assert.deepEqual(ev.map((e) => `${e.date} ${e.kind}`), [
    '2026-11-09 income',
    '2026-11-11 income',
    '2026-11-20 income',
    '2026-11-20 contribution',
    '2026-11-25 expense',
  ]);
});

test('dia 31 em mês curto cai no último dia', () => {
  const s = scenario();
  s.expenses[0].day = 31;
  const ev = expandOccurrences(s, TODAY, '2027-02-28').filter((e) => e.kind === 'expense');
  assert.deepEqual(ev.map((e) => e.date), ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
});

test('pendências: vencidas aparecem até serem confirmadas', () => {
  const s = scenario();
  const p = pendingConfirmations(s, '2026-11-12');
  assert.deepEqual(p.map((e) => e.key), ['income:sal:2026-11', 'income:alugA:2026-11']);
  assert.ok(p.every((e) => e.effectiveDate === '2026-11-12'));
  s.settled['income:sal:2026-11'] = { date: '2026-11-09', amount: 250000 };
  assert.deepEqual(pendingConfirmations(s, '2026-11-12').map((e) => e.key), ['income:alugA:2026-11']);
});

test('aporte vira débito da conta de origem e crédito da meta', () => {
  const ev = openEvents(scenario(), TODAY, '2026-11-30').find((e) => e.kind === 'contribution');
  assert.equal(ev.accountId, 'cc');
  assert.equal(ev.toAccountId, 'fundo');
  assert.equal(ev.amount, 160000);
});
