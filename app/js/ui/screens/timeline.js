// Linha do tempo: gráfico SVG próprio do saldo projetado + lista de eventos.

import { h, svg } from '../dom.js';
import { formatBRL, formatSigned } from '../../core/money.js';
import { formatShort, formatLong, formatDayMonth, relative, addDays } from '../../core/dates.js';
import { projectBalance } from '../../core/projection.js';
import { spendingAccountIds } from '../../core/budget.js';
import { flowInto } from '../../core/schedule.js';
import * as store from '../../data/store.js';
import { eventSheet, editIncome, addButton } from '../editors.js';

const W = 360;
const H = 252;
// t: espaço do rótulo do salário · r: calha dos valores · b: faixa de eventos + datas
const PAD = { l: 6, r: 48, t: 26, b: 62 };
const RAIL_GAP = 24; // distância entre o fundo do gráfico e a faixa de eventos

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  return ticks;
}

function compactBRL(cents) {
  const v = cents / 100 + 0; // + 0 transforma -0 em 0
  const txt = Math.abs(v) >= 1000
    ? `${(Math.abs(v) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
    : Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  return v < 0 ? `−${txt}` : txt;
}

const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`;

// rótulos em HTML por cima do SVG: ficam em 12 px de verdade, seja qual for a largura da tela
function label(cls, text, { x, y } = {}) {
  const vars = [x != null && `--x:${pct(x, W)}`, y != null && `--y:${pct(y, H)}`].filter(Boolean).join(';');
  return h('span', { class: `chart-label ${cls}`, style: vars || null, 'aria-hidden': 'true' }, text);
}

function chart(ctx, proj) {
  const pts = proj.points;
  const ids = spendingAccountIds(ctx.state);
  const values = pts.flatMap((p) => [p.events, p.spending]);
  let min = Math.min(0, ...values);
  let max = Math.max(...values);
  const padY = (max - min) * 0.08 || 1000;
  min -= min < 0 ? padY : 0;
  max += padY;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const bottom = PAD.t + ih;
  const railY = bottom + RAIL_GAP;
  const x = (i) => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v) => PAD.t + ih - ((v - min) / (max - min)) * ih;
  const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const zeroY = y(0);
  const overlay = [];

  // o gráfico é um seletor de dia: toque, arraste ou setas do teclado
  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'slider', tabindex: '0',
    'aria-label': 'Saldo projetado. Use as setas para mudar o dia.',
    'aria-valuemin': 0, 'aria-valuemax': pts.length - 1,
  });

  // degradê sob a linha principal e recortes acima/abaixo do zero
  root.append(svg('defs', {},
    svg('linearGradient', { id: 'tl-fill', x1: 0, y1: 0, x2: 0, y2: 1 },
      svg('stop', { offset: 0, class: 'fill-top' }),
      svg('stop', { offset: 1, class: 'fill-end' })),
    svg('clipPath', { id: 'tl-above' }, svg('rect', { x: 0, y: 0, width: W, height: zeroY })),
    svg('clipPath', { id: 'tl-below' }, svg('rect', { x: 0, y: zeroY, width: W, height: H - zeroY }))));

  // abaixo de zero: faixa levemente tingida
  if (min < 0) root.append(svg('rect', { x: PAD.l, y: zeroY, width: iw, height: bottom - zeroY, class: 'below-zero' }));

  // grade recessiva; valores na calha da direita, longe das linhas
  for (const t of niceTicks(min, max)) {
    root.append(svg('line', { x1: PAD.l, x2: W - PAD.r + 4, y1: y(t), y2: y(t), class: t === 0 ? 'zero' : 'grid' }));
    overlay.push(label('chart-y', compactBRL(t), { y: y(t) }));
  }

  // marcador do próximo salário
  const salIdx = ctx.budget.nextSalary ? pts.findIndex((p) => p.date === ctx.budget.nextSalary.date) : -1;
  if (salIdx >= 0) {
    root.append(svg('line', { x1: x(salIdx), x2: x(salIdx), y1: PAD.t - 4, y2: railY, class: 'salary-line' }));
    const edge = x(salIdx) < W * 0.15 ? ' start' : x(salIdx) > W * 0.8 ? ' end' : '';
    overlay.push(label(`chart-tag${edge}`, ctx.budget.nextSalary.name, { x: x(salIdx) }));
  }

  // séries: área até o zero + linha cheia (sem gastar); tracejada (gastando o limite), vermelha abaixo de zero
  root.append(svg('path', { d: `${path('events')}L${x(pts.length - 1).toFixed(1)},${zeroY.toFixed(1)}L${x(0).toFixed(1)},${zeroY.toFixed(1)}Z`, class: 'area' }));
  root.append(svg('path', { d: path('spending'), class: 'line s2', 'clip-path': 'url(#tl-above)' }));
  if (min < 0) root.append(svg('path', { d: path('spending'), class: 'line s2 under', 'clip-path': 'url(#tl-below)' }));
  root.append(svg('path', { d: path('events'), class: 'line s1' }));

  // faixa de eventos: recebimento sobe, pagamento desce; altura pelo valor
  root.append(svg('line', { x1: PAD.l, x2: W - PAD.r + 4, y1: railY, y2: railY, class: 'rail' }));
  const flows = pts.map((p) => {
    const f = p.dayEvents.map((e) => flowInto(e, ids));
    return { in: f.filter((v) => v > 0).reduce((a, b) => a + b, 0), out: -f.filter((v) => v < 0).reduce((a, b) => a + b, 0) };
  });
  const biggest = Math.max(1, ...flows.flatMap((f) => [f.in, f.out]));
  const tick = (v) => 4 + 5 * Math.sqrt(v / biggest);
  flows.forEach((f, i) => {
    const cx = x(i).toFixed(1);
    if (f.in) root.append(svg('line', { x1: cx, x2: cx, y1: railY - 3, y2: railY - 3 - tick(f.in), class: 'ev-tick in' }));
    if (f.out) root.append(svg('line', { x1: cx, x2: cx, y1: railY + 3, y2: railY + 3 + tick(f.out), class: 'ev-tick out' }));
  });

  // eixo x: hoje, salário e fim
  overlay.push(label('chart-x start', 'hoje', { x: x(0) }));
  if (salIdx >= 6 && salIdx < pts.length - 6) overlay.push(label('chart-x', formatShort(pts[salIdx].date), { x: x(salIdx) }));
  overlay.push(label('chart-x end', formatShort(pts[pts.length - 1].date), { x: x(pts.length - 1) }));

  // seleção: linha vertical + pontos; os valores aparecem no painel acima
  const cross = svg('line', { y1: PAD.t - 4, y2: railY, class: 'cross' });
  const dot1 = svg('circle', { r: 5, class: 'dot s1' });
  const dot2 = svg('circle', { r: 5, class: 'dot s2' });
  root.append(cross, dot2, dot1);

  const rDate = h('p', { class: 'readout-date' });
  const rRel = h('span', { class: 'readout-rel' });
  const rV1 = h('span', { class: 'v' });
  const rV2 = h('span', { class: 'v' });
  const rEvents = h('p', { class: 'readout-events' });
  const readout = h('div', { class: 'readout', 'aria-live': 'polite' },
    h('div', { class: 'readout-head' }, rDate, rRel),
    h('div', { class: 'readout-stats' },
      h('div', { class: 'stat' }, h('span', { class: 'k' }, h('i', { class: 'sw s1' }), 'Sem gastar nada'), rV1),
      h('div', { class: 'stat' }, h('span', { class: 'k' }, h('i', { class: 'sw s2' }), 'Gastando o limite'), rV2)),
    rEvents);

  let current = 0;
  const select = (i) => {
    current = i;
    const p = pts[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    dot1.setAttribute('cx', x(i)); dot1.setAttribute('cy', y(p.events));
    dot2.setAttribute('cx', x(i)); dot2.setAttribute('cy', y(p.spending));
    dot2.classList.toggle('under', p.spending < 0);
    rDate.textContent = formatLong(p.date);
    rRel.textContent = relative(ctx.today, p.date);
    rV1.textContent = formatBRL(p.events);
    rV2.textContent = formatBRL(p.spending);
    rV2.classList.toggle('neg', p.spending < 0);
    rEvents.replaceChildren(...(p.dayEvents.length ? [] : [h('span', { class: 'muted' }, 'Nenhum evento neste dia')]), ...p.dayEvents.map((e) => {
      const sign = e.kind === 'income' ? 1 : -1;
      return h('span', { class: 'ev-item' }, h('span', { class: 'li-sub' }, e.name),
        h('span', { class: `ev-amt ${sign > 0 ? 'pos' : ''}` }, formatSigned(e.amount, sign, { short: true })));
    }));
    root.setAttribute('aria-valuenow', i);
    root.setAttribute('aria-valuetext', `${formatLong(p.date)}: ${formatBRL(p.events)} se não gastar nada, ${formatBRL(p.spending)} se gastar o limite`);
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

  return { readout, chart: h('div', { class: 'chart-wrap' }, root, overlay) };
}

// mesmos traços da faixa de eventos do gráfico
const marker = (dir) => svg('svg', { width: 12, height: 16, viewBox: '0 0 12 16', 'aria-hidden': 'true' },
  svg('line', { x1: 1, x2: 11, y1: 8, y2: 8, class: 'rail' }),
  svg('line', { x1: 6, x2: 6, y1: dir === 'in' ? 5.5 : 10.5, y2: dir === 'in' ? 1.5 : 14.5, class: `ev-tick ${dir}` }));

function legend() {
  return h('div', { class: 'legend' },
    h('span', {}, marker('in'), 'Recebimento'),
    h('span', {}, marker('out'), 'Pagamento'));
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
      legend()),
    h('h2', { class: 'section-label' }, 'Próximos eventos'),
    h('section', { class: 'card flush' }, eventList(ctx, proj),
      addButton('Agendar receita', () => editIncome(null, { draft: { rule: { type: 'once', date: addDays(ctx.today, 1) } } }))));
}
