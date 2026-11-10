// Linha do tempo: uma linha com o saldo previsto e a lista do que está por vir.

import { h, svg, amountParts } from '../dom.js';
import { icon } from '../icons.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { formatShort, formatLong, relative, addDays } from '../../core/dates.js';
import { projectBalance } from '../../core/projection.js';
import { spendingAccountIds } from '../../core/budget.js';
import { flowInto } from '../../core/schedule.js';
import * as store from '../../data/store.js';
import { eventSheet, editIncome, addButton } from '../editors.js';

const W = 360;
const H = 176;
const PAD = { l: 8, r: 8, t: 14, b: 24 };

/** Curva suave que nunca passa dos pontos (interpolação cúbica monótona). */
function smoothPath(p) {
  const n = p.length;
  if (n < 3) return p.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
  const slope = (i) => {
    const h0 = p[i][0] - p[i - 1][0];
    const h1 = p[i + 1][0] - p[i][0];
    const s0 = (p[i][1] - p[i - 1][1]) / h0;
    const s1 = (p[i + 1][1] - p[i][1]) / h1;
    const mid = (s0 * h1 + s1 * h0) / (h0 + h1);
    return (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(mid)) || 0;
  };
  const t = new Array(n);
  for (let i = 1; i < n - 1; i++) t[i] = slope(i);
  const edge = (a, b, tb) => (3 * (p[b][1] - p[a][1]) / (p[b][0] - p[a][0]) - tb) / 2;
  t[0] = edge(0, 1, t[1]);
  t[n - 1] = edge(n - 2, n - 1, t[n - 2]);
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 1; i < n; i++) {
    const dx = (p[i][0] - p[i - 1][0]) / 3;
    d += `C${(p[i - 1][0] + dx).toFixed(1)},${(p[i - 1][1] + dx * t[i - 1]).toFixed(1)} ${(p[i][0] - dx).toFixed(1)},${(p[i][1] - dx * t[i]).toFixed(1)} ${p[i][0].toFixed(1)},${p[i][1].toFixed(1)}`;
  }
  return d;
}

const short = (s, max = 16) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function chart(ctx, proj) {
  const ids = spendingAccountIds(ctx.state);
  // o primeiro ponto é o saldo de agora; os demais, o saldo ao fim de cada dia
  const pts = [{ date: ctx.today, value: proj.start, now: true, events: [] },
    ...proj.points.map((p) => ({ date: p.date, value: p.balance, events: p.dayEvents }))];
  const values = pts.map((p) => p.value);
  let lo = Math.min(0, ...values);
  let hi = Math.max(...values, lo + 100);
  const span = hi - lo;
  hi += span * 0.06;
  if (lo < 0) lo -= span * 0.06;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (i / (pts.length - 1)) * iw;
  const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  const y0 = y(0);
  const zero = Math.min(1, Math.max(0, y0 / H));
  const line = smoothPath(pts.map((p, i) => [x(i), y(p.value)]));
  const stop = (offset, color, opacity = 1) => svg('stop', { offset, style: `stop-color:var(${color});stop-opacity:${opacity}` });
  const gradient = (id, top, base) => svg('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 0, y2: H },
    stop(0, '--pos', top), stop(zero, '--pos', base), stop(zero, '--neg', base), stop(1, '--neg', top));

  const lowest = pts.reduce((a, b) => (b.value < a.value ? b : a));
  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', tabindex: 0,
    'aria-label': `Saldo previsto das contas de gasto: ${formatBRL(proj.start)} agora, ${formatBRL(pts[pts.length - 1].value)} em ${formatShort(proj.end)}. Menor saldo: ${formatBRL(lowest.value)} em ${formatShort(lowest.date)}.`,
  });
  root.append(svg('defs', {}, gradient('tl-line', 1, 1), gradient('tl-area', 0.3, 0)));
  // verde acima de zero, vermelho abaixo: a cor da linha é o estado do saldo
  root.append(svg('path', { d: `${line}L${x(pts.length - 1).toFixed(1)},${y0.toFixed(1)}L${x(0).toFixed(1)},${y0.toFixed(1)}Z`, class: 'area', fill: 'url(#tl-area)' }));
  root.append(svg('line', { x1: PAD.l, x2: W - PAD.r, y1: y0, y2: y0, class: 'base' }));
  root.append(svg('path', { d: line, class: 'line', stroke: 'url(#tl-line)' }));

  // um ponto em cada dia com receita (verde) ou pagamento (cinza)
  pts.forEach((p, i) => {
    const net = p.events.reduce((s, e) => s + flowInto(e, ids), 0);
    if (net) root.append(svg('circle', { cx: x(i), cy: y(p.value), r: 3.5, class: `mk ${net > 0 ? 'in' : 'out'}` }));
  });

  // âncoras de tempo: hoje, o próximo salário e o fim
  const last = pts.length - 1;
  root.append(svg('text', { x: x(0), y: H - 4, class: 'axis', 'text-anchor': 'start' }, 'Hoje'));
  root.append(svg('text', { x: x(last), y: H - 4, class: 'axis', 'text-anchor': 'end' }, formatShort(pts[last].date)));
  const sal = ctx.budget.nextSalary;
  const salIdx = sal ? pts.findIndex((p) => !p.now && p.date === sal.date) : -1;
  if (salIdx > 0 && x(salIdx) > 70 && x(salIdx) < W - 80) {
    root.append(svg('text', { x: x(salIdx), y: H - 4, class: 'axis', 'text-anchor': 'middle' }, short(sal.name)));
  }

  // seleção: o dedo escolhe o dia; o valor aparece grande, acima do gráfico
  const cross = svg('line', { y1: PAD.t - 6, y2: y0, class: 'cross' });
  const dot = svg('circle', { r: 5.5, class: 'dot' });
  root.append(cross, dot);

  const rDate = h('span', { class: 'readout-date' });
  const rRel = h('span', {});
  const rValue = h('p', { class: 'amount lg', 'data-fit': true });
  const rEvents = h('p', { class: 'readout-events' });
  const readout = h('div', { class: 'readout', 'aria-live': 'polite' },
    h('p', { class: 'readout-top' }, rDate, rRel), rValue, rEvents);

  let current = 0;
  let touched = false;
  const select = (i) => {
    current = Math.max(0, Math.min(last, i));
    const p = pts[current];
    cross.setAttribute('x1', x(current)); cross.setAttribute('x2', x(current));
    dot.setAttribute('cx', x(current)); dot.setAttribute('cy', y(p.value));
    dot.classList.toggle('neg', p.value < 0);
    rDate.textContent = p.now ? 'Agora' : current === 1 ? 'Hoje, fim do dia' : formatLong(p.date);
    rRel.textContent = current > 1 ? relative(ctx.today, p.date) : '';
    rValue.replaceChildren(...amountParts(formatBRL(p.value)));
    rValue.classList.toggle('neg', p.value < 0);
    rEvents.textContent = p.events.length
      ? p.events.map((e) => `${flowInto(e, ids) >= 0 && e.kind === 'income' ? '+' : '−'}${formatBRLShort(e.amount)} ${e.name}`).join('   ')
      : touched ? '' : 'Toque no gráfico para ver cada dia';
  };
  const pick = (clientX) => {
    const r = root.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    touched = true;
    select(Math.round(((sx - PAD.l) / iw) * last));
  };
  // preventDefault: o toque escolhe o dia sem levar o foco (o anel de foco fica para o teclado)
  root.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(e.clientX); });
  root.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons || e.pressure > 0) pick(e.clientX); });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    touched = true;
    select(current + (e.key === 'ArrowRight' ? 1 : -1));
  });
  select(0);

  return { readout, chart: h('div', { class: 'chart-wrap' }, root) };
}

function eventList(ctx, proj) {
  const groups = new Map();
  for (const e of proj.events) {
    if (!groups.has(e.effectiveDate)) groups.set(e.effectiveDate, []);
    groups.get(e.effectiveDate).push(e);
  }
  if (!groups.size) return h('p', { class: 'empty' }, 'Nada previsto para o período.');
  const def = ctx.state.settings.defaultAccountId;
  const accName = (id) => store.getAccount(id)?.name ?? 'conta excluída';
  // conta só aparece quando não é a dos gastos do dia; atraso sempre aparece
  const sub = (e) => {
    if (e.overdue) return `Atrasado, previsto para ${formatShort(e.date)}`;
    if (e.originalDate && e.date !== e.originalDate) return `Data mudada, era ${formatShort(e.originalDate)}`;
    if (e.accountId === def) return null;
    return e.kind === 'income' ? `Entra em ${accName(e.accountId)}` : `Sai de ${accName(e.accountId)}`;
  };
  return h('div', {}, [...groups].map(([date, evs]) => h('div', { class: 'day-group' },
    h('div', { class: 'day-head' }, h('strong', {}, formatLong(date)), h('span', {}, relative(ctx.today, date))),
    h('ul', { class: 'list' }, evs.map((e) => h('li', {}, h('button', { class: 'list-item', onclick: () => eventSheet(e) },
      h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, e.name), sub(e) && h('span', { class: `li-sub ${e.overdue ? 'warn-text' : ''}` }, sub(e))),
      h('span', { class: 'li-end' },
        h('span', { class: `li-value ${e.kind === 'income' ? 'pos' : ''}` }, `${e.kind === 'income' ? '+' : '−'}${formatBRLShort(e.amount)}`),
        icon('chevron', { size: 18, cls: 'chev' })))))))));
}

export function renderTimeline(ctx) {
  const proj = projectBalance(ctx.state, ctx.today, ctx.budget);
  const c = chart(ctx, proj);
  return h('div', { class: 'screen timeline' },
    h('header', { class: 'screen-head' },
      h('div', { class: 'titles' },
        h('h1', {}, 'Linha do tempo'),
        h('p', { class: 'sub' }, 'Saldo previsto, gastando o limite de cada dia'))),
    h('section', { class: 'card chart-card' }, c.readout, c.chart),
    h('h2', { class: 'section-label' }, 'Próximos eventos'),
    h('section', { class: 'card flush' }, eventList(ctx, proj),
      addButton('Agendar receita', () => editIncome(null, { draft: { rule: { type: 'once', date: addDays(ctx.today, 1) } } }))));
}
