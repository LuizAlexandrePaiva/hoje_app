// Valores monetários são sempre centavos inteiros.

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlRound = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

export function formatBRL(cents) {
  return brl.format((cents || 0) / 100);
}

/** Sem centavos quando o valor é redondo: R$ 1.200 */
export function formatBRLShort(cents) {
  return cents % 100 === 0 ? brlRound.format(cents / 100) : formatBRL(cents);
}

/** Converte texto digitado ("1.234,56", "79", "79,9") em centavos. */
export function parseBRL(text) {
  if (typeof text === 'number') return Math.round(text * 100);
  let s = String(text ?? '').replace(/[^\d,.-]/g, '');
  if (!/\d/.test(s)) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  // sem vírgula, "2.315" e "1.200.000" são milhares (pt-BR); "12.5" é decimal
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
}

/** Valor em centavos para o campo de edição: 123456 → "1234,56" */
export function toInput(cents) {
  if (cents == null || Number.isNaN(cents)) return '';
  const neg = cents < 0;
  const a = Math.abs(cents);
  const s = `${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
  return (neg ? '-' : '') + s.replace(/,00$/, '');
}

export function ceilTo(cents, step) {
  return Math.ceil(cents / step) * step;
}

export function floorTo(cents, step) {
  return Math.floor(cents / step) * step;
}
