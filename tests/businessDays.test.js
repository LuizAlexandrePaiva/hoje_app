import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easter, nationalHolidays, isBusinessDay, nthBusinessDay } from '../app/js/core/businessDays.js';
import { addDays, diffDays, weekday, todayISO } from '../app/js/core/dates.js';

test('Páscoa em anos conhecidos', () => {
  assert.equal(easter(2024), '2024-03-31');
  assert.equal(easter(2025), '2025-04-20');
  assert.equal(easter(2026), '2026-04-05');
  assert.equal(easter(2027), '2027-03-28');
  assert.equal(easter(2038), '2038-04-25');
});

test('Sexta-feira Santa entra nos feriados', () => {
  const h = nationalHolidays(2026);
  assert.ok(h.has('2026-04-03'));
  assert.ok(h.has('2026-11-02'));
  assert.ok(h.has('2026-11-20'));
  assert.equal(h.size, 10);
});

test('5º dia útil de novembro/2026 é 9/11 (Finados na segunda, 2/11)', () => {
  assert.equal(nthBusinessDay(2026, 11, 5), '2026-11-09');
});

test('dias úteis comuns', () => {
  assert.equal(nthBusinessDay(2026, 10, 1), '2026-10-01'); // quinta
  assert.equal(nthBusinessDay(2026, 10, 5), '2026-10-07'); // 3 e 4 são fim de semana
  assert.equal(nthBusinessDay(2026, 4, 1), '2026-04-01');
  // abril/2026: 3 (Sexta Santa) e 21 (Tiradentes) não contam
  assert.equal(nthBusinessDay(2026, 4, 3), '2026-04-06');
  // janeiro/2027: 1/1 feriado (sexta)
  assert.equal(nthBusinessDay(2027, 1, 1), '2027-01-04');
});

test('contar sábado: se cair no sábado, paga na sexta anterior', () => {
  // agosto/2026: sáb 1, seg 3, ter 4, qua 5, qui 6 → 5º com sábado = 6/8 (quinta)
  assert.equal(nthBusinessDay(2026, 8, 5, { countSaturday: true }), '2026-08-06');
  assert.equal(nthBusinessDay(2026, 8, 5), '2026-08-07');
  // novembro/2026 com sábado: 3,4,5,6,7(sáb) → cai no sábado 7 → sexta 6
  assert.equal(nthBusinessDay(2026, 11, 5, { countSaturday: true }), '2026-11-06');
  // outubro/2026: 1,2,3(sáb) → 3º dia útil é sábado → sexta 2
  assert.equal(nthBusinessDay(2026, 10, 3, { countSaturday: true }), '2026-10-02');
});

test('sábado antecipado pula feriado na sexta', () => {
  // abril/2026 com sábado: 1,2,4(sáb, pois 3 é feriado) → 3º = sáb 4 → sexta 3 é feriado → qui 2
  assert.equal(nthBusinessDay(2026, 4, 3, { countSaturday: true }), '2026-04-02');
});

test('isBusinessDay', () => {
  assert.equal(isBusinessDay('2026-10-26'), true);
  assert.equal(isBusinessDay('2026-10-31'), false); // sábado
  assert.equal(isBusinessDay('2026-10-31', { countSaturday: true }), true);
  assert.equal(isBusinessDay('2026-10-12'), false); // feriado
});

test('aritmética de datas sem bugs de fuso', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-10-26', '2026-11-08'), 13);
  assert.equal(weekday('2026-10-26'), 1);
  // 23:30 de 26/10 em São Paulo = 02:30 UTC de 27/10
  assert.equal(todayISO(new Date('2026-10-27T02:30:00Z')), '2026-10-26');
  assert.equal(todayISO(new Date('2026-10-27T03:00:00Z')), '2026-10-27');
});

test('formatação de datas em pt-BR', async () => {
  const { formatShort, formatFull, formatLong, formatHeader, formatDayMonth } = await import('../app/js/core/dates.js');
  assert.equal(formatShort('2026-11-09'), '09/11');
  assert.equal(formatFull('2026-11-27'), '27/11/2026');
  assert.equal(formatLong('2026-11-09'), 'seg, 9 de nov');
  assert.equal(formatHeader('2026-10-26'), 'segunda, 26 de outubro');
  assert.equal(formatDayMonth('2026-11-27', 2026), '27 de nov');
  assert.equal(formatDayMonth('2027-02-10', 2026), '10 de fev de 2027');
});
