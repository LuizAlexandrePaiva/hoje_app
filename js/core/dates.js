// Datas como strings 'AAAA-MM-DD' (dia civil, sem hora).
// Toda a aritmética usa Date.UTC sobre os componentes, então nunca há
// deslocamento de fuso ao comparar ou somar dias.

export const TIME_ZONE = 'America/Sao_Paulo';
const DAY_MS = 86400000;

const pad = (n) => String(n).padStart(2, '0');

export function iso(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parts(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function toUTC(s) {
  const { y, m, d } = parts(s);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  const dt = new Date(ms);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Dia de hoje no fuso de São Paulo, independente do fuso do aparelho. */
export function todayISO(now = new Date()) {
  // en-CA formata como AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function addDays(s, n) {
  return fromUTC(toUTC(s) + n * DAY_MS);
}

/** Número de dias de a até b (b − a). */
export function diffDays(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

/** 0 = domingo … 6 = sábado */
export function weekday(s) {
  return new Date(toUTC(s)).getUTCDay();
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthKey(s) {
  return s.slice(0, 7);
}

export function addMonths(y, m, n) {
  const idx = y * 12 + (m - 1) + n;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

export function isValidISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parts(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

const fmtShort = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const fmtLong = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
const fmtFull = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

export function formatShort(s) { return fmtShort.format(new Date(toUTC(s))); }
export function formatLong(s) { return fmtLong.format(new Date(toUTC(s))); }
export function formatFull(s) { return fmtFull.format(new Date(toUTC(s))); }

/** "hoje", "amanhã", "em 3 dias", "há 2 dias" */
export function relative(today, s) {
  const n = diffDays(today, s);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}
