// Linha do tempo: gráfico SVG próprio do saldo projetado + lista de eventos.

import { h, svg } from '../dom.js';
import { formatBRL, formatSigned } from '../../core/money.js';
import { formatShort, formatLong, formatDayMonth, relative, addDays } from '../../core/dates.js';
import { projectBalance } from '../../core/projection.js';
import * as store from '../../data/store.js';
import { eventSheet, editIncome, addButton } from '../editors.js';

const W = 360;
const H = 212;
// r: calha do rótulo "R$ 0" · b: datas do eixo
const PAD = { l: 6, r: 34, t: 10, b: 26 };

const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`;

// rótulos em HTML por cima do SVG: ficam em 12 px de verdade, seja qual for a largura da tela
function label(cls, text, { x, y } = {}) {
  const vars = [x != null && `--x:${pct(x, W)}`, y != null && `--y:${pct(y, H)}`].filter(Boolean).join(';');
  return h('span', { class: `chart-label ${cls}`, style: vars || null, 'aria-hidden': 'true' }, text);
}

function chart(ctx, proj) {
  const pts = proj.points;
  const values = pts.map((p) => p.spending);
  let min = Math.min(0, ...values);
  let max = Math.max(...values);
  const padY = (max - min) * 0.08 || 1000;
  min -= min < 0 ? padY : padY * 0.4; // folga abaixo do zero para o ponto não encostar nas datas
  max += padY;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const bottom = PAD.t + ih;
  const x = (i) => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v) => PAD.t + ih - ((v - min) / (max - min)) * ih;
  const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const zeroY = y(0);
  const negative = values.some((v) => v < 0);
  const overlay = [];

  // o gráfico é um seletor de dia: toque, arraste ou setas do teclado
  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'slider', tabindex: '0',
    'aria-label': 'Saldo projetado. Use as setas para mudar o dia.',
    'aria-valuemin': 0, 'aria-valuemax': pts.length - 1,
  });

  // recortes acima/abaixo do zero: o que fica abaixo de R$ 0 aparece em vermelho
  root.append(svg('defs', {},
    svg('clipPath', { id: 'tl-above' }, svg('rect', { x: 0, y: 0, width: W, height: zeroY })),
    svg('clipPath', { id: 'tl-below' }, svg('rect', { x: 0, y: zeroY, width: W, height: H - zeroY }))));

  // área leve entre a linha e o zero: azul acima, vermelha abaixo
  const last = x(pts.length - 1).toFixed(1);
  const area = `${path('spending')}L${last},${zeroY.toFixed(1)}L${x(0).toFixed(1)},${zeroY.toFixed(1)}Z`;
  root.append(svg('path', { d: area, class: 'area', 'clip-path': 'url(#tl-above)' }));
  if (negative) root.append(svg('path', { d: area, class: 'area under', 'clip-path': 'url(#tl-below)' }));

  // única referência do eixo y: o zero
  root.append(svg('line', { x1: PAD.l, x2: W - PAD.r + 4, y1: zeroY, y2: zeroY, class: 'zero' }));
  overlay.push(label('chart-y', 'R$ 0', { y: zeroY }));

  // a linha: saldo se gastar o limite todo dia
  root.append(svg('path', { d: path('spending'), class: 'line', 'clip-path': 'url(#tl-above)' }));
  if (negative) root.append(svg('path', { d: path('spending'), class: 'line under', 'clip-path': 'url(#tl-below)' }));

  // eixo x: hoje, próximo salário (marquinha no pé) e fim
  const salIdx = ctx.budget.nextSalary ? pts.findIndex((p) => p.date === ctx.budget.nextSalary.date) : -1;
  overlay.push(label('chart-x start', 'hoje', { x: x(0) }));
  if (salIdx >= 8 && salIdx < pts.length - 8) {
    root.append(svg('line', { x1: x(salIdx), x2: x(salIdx), y1: bottom - 3, y2: bottom + 4, class: 'salary-tick' }));
    overlay.push(label('chart-x strong', `salário ${formatShort(pts[salIdx].date)}`, { x: x(salIdx) }));
  }
  overlay.push(label('chart-x end', formatShort(pts[pts.length - 1].date), { x: x(pts.length - 1) }));

  // seleção: linha vertical + ponto; o valor aparece no painel acima
  const cross = svg('line', { y1: PAD.t, y2: bottom, class: 'cross' });
  const dot = svg('circle', { r: 5, class: 'dot' });
  root.append(cross, dot);

  const note = negative ? h('p', { class: 'chart-note' }, 'Abaixo de R$ 0, em vermelho, faltaria dinheiro.') : null;

  const rDate = h('p', { class: 'readout-date' });
  const rRel = h('span', { class: 'readout-rel' });
  const rValue = h('span', { class: 'readout-value' });
  const rEvents = h('p', { class: 'readout-events' });
  const readout = h('div', { class: 'readout', 'aria-live': 'polite' },
    h('div', { class: 'readout-head' }, rDate, rRel),
    h('div', { class: 'readout-main' }, rValue, h('span', { class: 'readout-caption' }, 'de saldo, se gastar o limite todo dia')),
    rEvents);

  let current = 0;
  const select = (i) => {
    current = i;
    const p = pts[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.spending));
    dot.classList.toggle('under', p.spending < 0);
    rDate.textContent = formatLong(p.date);
    rRel.textContent = relative(ctx.today, p.date);
    rValue.textContent = formatBRL(p.spending);
    rValue.classList.toggle('neg', p.spending < 0);
    rEvents.replaceChildren(...(p.dayEvents.length ? [] : [h('span', { class: 'muted' }, 'Nenhum evento neste dia')]), ...p.dayEvents.map((e) => {
      const sign = e.kind === 'income' ? 1 : -1;
      return h('span', { class: 'ev-item' }, h('span', { class: 'li-sub' }, e.name),
        h('span', { class: `ev-amt ${sign > 0 ? 'pos' : ''}` }, formatSigned(e.amount, sign, { short: true })));
    }));
    root.setAttribute('aria-valuenow', i);
    root.setAttribute('aria-valuetext', `${formatLong(p.date)}: ${formatBRL(p.spending)} de saldo, se gastar o limite todo dia`);
  };
  const pick = (clientX) => {
    const r = root.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    select(Math.max(0, Math.min(pts.length - 1, Math.round(((sx - PAD.l) / iw) * (pts.length - 1)))));
  };
  root.addEventListener('pointermove', (e) => pick(e.clientX));
  root.addEventListener('pointerdown', (e) => pick(e.clientX));
  // toque e clique escolhem o dia sem levar o foco (o anel fica só para o teclado)
  root.addEventListener('mousedown', (e) => e.preventDefault());
  root.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 7, PageDown: -7 }[e.key];
    if (e.key === 'Home') select(0);
    else if (e.key === 'End') select(pts.length - 1);
    else if (step) select(Math.max(0, Math.min(pts.length - 1, current + step)));
    else return;
    e.preventDefault();
  });
  // começa mostrando a véspera do salário (o ponto mais apertado do período)
  select(Math.max(0, pts.findIndex((p) => p.date === ctx.budget.horizonEnd)));

  return { readout, note, chart: h('div', { class: 'chart-wrap' }, root, overlay) };
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
  // conta só aparece quando não é a padrão; atraso sempre aparece
  const sub = (e) => {
    if (e.overdue) return `Atrasado, previsto para ${formatDayMonth(e.date, Number(ctx.today.slice(0, 4)))}`;
    if (e.originalDate && e.date !== e.originalDate) return `Data mudada, era ${formatDayMonth(e.originalDate, Number(ctx.today.slice(0, 4)))}`;
    if (e.accountId === def) return null;
    return e.kind === 'income' ? `Entra em ${accName(e.accountId)}` : `Sai de ${accName(e.accountId)}`;
  };
  return h('div', {}, [...groups].map(([date, evs]) => h('div', { class: 'day-group' },
    h('div', { class: 'day-head' }, h('strong', {}, formatLong(date)), h('span', { class: 'muted' }, relative(ctx.today, date))),
    evs.map((e) => h('button', { class: 'ev', onclick: () => eventSheet(e) },
      h('span', { class: `ev-dot ${e.kind === 'income' ? 'in' : 'out'}` }),
      h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, e.name), sub(e) && h('span', { class: 'li-sub' }, sub(e))),
      h('span', { class: `li-value ${e.kind === 'income' ? 'pos' : ''}` },
        formatSigned(e.amount, e.kind === 'income' ? 1 : -1, { short: true })))))));
}

export function renderTimeline(ctx) {
  const proj = projectBalance(ctx.state, ctx.today, ctx.budget);
  const c = chart(ctx, proj);
  return h('div', { class: 'screen timeline' },
    h('header', { class: 'screen-head' },
      h('h1', {}, 'Linha do tempo'),
      h('p', { class: 'sub' }, 'Toque ou arraste no gráfico para ver cada dia')),
    h('section', { class: 'card' },
      c.readout,
      c.chart,
      c.note),
    h('h2', { class: 'section-label' }, 'Próximos eventos'),
    h('section', { class: 'card flush' }, eventList(ctx, proj),
      addButton('Agendar receita', () => editIncome(null, { draft: { rule: { type: 'once', date: addDays(ctx.today, 1) } } }))));
}
