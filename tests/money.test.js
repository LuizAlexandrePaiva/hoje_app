import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBRL, toInput, formatBRL, ceilTo } from '../app/js/core/money.js';

test('parseBRL entende o formato brasileiro', () => {
  assert.equal(parseBRL('79'), 7900);
  assert.equal(parseBRL('2.315'), 231500);
  assert.equal(parseBRL('1.200.000'), 120000000);
  assert.equal(parseBRL('1.234,56'), 123456);
  assert.equal(parseBRL('R$ 169,93'), 16993);
  assert.equal(parseBRL('12.5'), 1250);
  assert.equal(parseBRL('0,1'), 10);
  assert.equal(parseBRL('-50'), -5000);
  assert.ok(Number.isNaN(parseBRL('abc')));
});

test('toInput e formatBRL', () => {
  assert.equal(toInput(123456), '1234,56');
  assert.equal(toInput(120000), '1200');
  assert.equal(toInput(-5050), '-50,50');
  assert.equal(formatBRL(16993).replace(/\s/g, ' '), 'R$ 169,93');
  assert.equal(ceilTo(111051, 5000), 115000);
});

test('negativos usam o sinal de menos tipográfico e formatSigned mostra o sinal', async () => {
  const { formatBRLShort, formatSigned } = await import('../app/js/core/money.js');
  const norm = (t) => t.replace(/\s/g, ' ');
  assert.equal(norm(formatBRL(-18600)), '−R$ 186,00');
  assert.equal(norm(formatBRLShort(-50000)), '−R$ 500');
  assert.equal(norm(formatSigned(4590, -1)), '−R$ 45,90');
  assert.equal(norm(formatSigned(250000, 1, { short: true })), '+R$ 2.500');
  assert.ok(!formatBRL(-100).includes('-'));
});
