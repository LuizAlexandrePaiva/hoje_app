import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBRL, toInput, formatBRL, ceilTo } from '../js/core/money.js';

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
