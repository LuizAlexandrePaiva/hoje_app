import { iso, addDays, weekday, daysInMonth } from './dates.js';

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

const FIXED_HOLIDAYS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

const holidayCache = new Map();

/** Feriados nacionais do ano (fixos + Sexta-feira Santa). */
export function nationalHolidays(year) {
  if (!holidayCache.has(year)) {
    const set = new Set(FIXED_HOLIDAYS.map((md) => `${year}-${md}`));
    set.add(addDays(easter(year), -2));
    holidayCache.set(year, set);
  }
  return holidayCache.get(year);
}

export function isHoliday(s) {
  return nationalHolidays(Number(s.slice(0, 4))).has(s);
}

export function isBusinessDay(s, { countSaturday = false } = {}) {
  const wd = weekday(s);
  if (wd === 0) return false;
  if (wd === 6 && !countSaturday) return false;
  return !isHoliday(s);
}

/**
 * N-ésimo dia útil do mês (m = 1..12).
 * Com countSaturday, sábados contam na contagem, mas se o dia resultante cair
 * num sábado o pagamento é antecipado para o dia útil (seg–sex) anterior.
 */
export function nthBusinessDay(y, m, n, { countSaturday = false } = {}) {
  const last = daysInMonth(y, m);
  let count = 0;
  let found = null;
  for (let d = 1; d <= last; d++) {
    const s = iso(y, m, d);
    if (isBusinessDay(s, { countSaturday })) {
      count++;
      if (count === n) { found = s; break; }
    }
  }
  if (!found) return null;
  if (weekday(found) === 6) {
    let s = addDays(found, -1);
    while (!isBusinessDay(s)) s = addDays(s, -1);
    return s;
  }
  return found;
}
