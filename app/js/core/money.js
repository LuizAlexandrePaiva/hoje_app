// Valores monetários são sempre centavos inteiros.

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlRound = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

const MINUS = '\u2212';

/** Negativos sempre com o sinal de menos tipográfico (−), igual em todo o app. */
function withMinus(text) {
  return text.replace(/^-|-(?=\s?R\$)/, MINUS).replace(/^(R\$\s?)-/, `${MINUS}$1`);
}

export function formatBRL(cents) {
  return withMinus(brl.format((cents || 0) / 100));
}

/** Sem centavos quando o valor é redondo: R$ 1.200 */
export function formatBRLShort(cents) {
  return cents % 100 === 0 ? withMinus(brlRound.format(cents / 100)) : formatBRL(cents);
}

/**
 * Valor com sinal explícito: gasto "−R$ 45,90", receita "+R$ 120,00".
 * `sign` = 1 (entrada) ou −1 (saída); o valor é tratado em módulo.
 */
export function formatSigned(cents, sign, { short = false } = {}) {
  const abs = Math.abs(cents || 0);
  const body = short ? formatBRLShort(abs) : formatBRL(abs);
  return `${sign < 0 ? MINUS : '+'}${body}`;
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

const pct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** Pontos-base em porcentagem, para baixo, com no máximo uma casa: 1000 → "10%", 741 → "7,4%". */
export function formatPercent(bps) {
  return `${pct.format(Math.floor(bps / 10) / 10)}%`;
}

export function ceilTo(cents, step) {
  return Math.ceil(cents / step) * step;
}

export function floorTo(cents, step) {
  return Math.floor(cents / step) * step;
}
