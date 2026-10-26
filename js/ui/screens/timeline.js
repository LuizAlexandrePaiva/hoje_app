// Linha do tempo: gráfico SVG próprio do saldo projetado + lista de eventos.

import { h, svg } from '../dom.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { formatShort, formatLong, relative } from '../../core/dates.js';
import { projectBalance } from '../../core/projection.js';
import { spendingAccountIds } from '../../core/budget.js';
import { flowInto } from '../../core/schedule.js';
import * as store from '../../data/store.js';

const W = 360;
const H = 220;
const PAD = { l: 8, r: 8, t: 26, b: 28 };

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  return ticks;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function compactBRL(cents) {
  const v = cents / 100 + 0; // + 0 transforma -0 em 0
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
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
  const x = (i) => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v) => PAD.t + ih - ((v - min) / (max - min)) * ih;
  const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Saldo projetado das contas de gasto' });

  // grade recessiva + rótulos do eixo y
  for (const t of niceTicks(min, max)) {
    root.append(svg('line', { x1: PAD.l, x2: W - PAD.r, y1: y(t), y2: y(t), class: t === 0 ? 'zero' : 'grid' }));
    root.append(svg('text', { x: PAD.l + 2, y: y(t) - 3, class: 'axis' }, compactBRL(t)));
  }

  // marcador do próximo salário
  const salIdx = ctx.budget.nextSalary ? pts.findIndex((p) => p.date === ctx.budget.nextSalary.date) : -1;
  if (salIdx >= 0) {
    root.append(svg('line', { x1: x(salIdx), x2: x(salIdx), y1: PAD.t - 6, y2: PAD.t + ih, class: 'salary-line' }));
    root.append(svg('text', { x: x(salIdx), y: PAD.t - 10, class: 'axis strong', 'text-anchor': 'middle' }, ctx.budget.nextSalary.name));
  }

  root.append(svg('path', { d: path('events'), class: 'line s1' }));
  root.append(svg('path', { d: path('spending'), class: 'line s2' }));

  // marcas dos dias de recebimento (▲, em cima da linha) e pagamento (▼)
  pts.forEach((p, i) => {
    const hasIn = p.dayEvents.some((e) => flowInto(e, ids) > 0);
    const hasOut = p.dayEvents.some((e) => flowInto(e, ids) < 0);
    const cx = x(i);
    const cy = y(p.events);
    if (hasIn) root.append(svg('path', { d: `M${cx - 5},${cy - 6}L${cx + 5},${cy - 6}L${cx},${cy - 14}Z`, class: 'mk in' }));
    if (hasOut) root.append(svg('path', { d: `M${cx - 5},${cy + 6}L${cx + 5},${cy + 6}L${cx},${cy + 14}Z`, class: 'mk out' }));
  });

  // eixo x: início, salário e fim
  const labels = new Map([[0, 'hoje'], [pts.length - 1, formatShort(pts[pts.length - 1].date)]]);
  if (salIdx > 0 && salIdx < pts.length - 6) labels.set(salIdx, formatShort(pts[salIdx].date));
  for (const [i, t] of labels) {
    root.append(svg('text', {
      x: x(i), y: H - 8, class: 'axis',
      'text-anchor': i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle',
    }, t));
  }

  // camada de hover: linha vertical + tooltip com as duas séries
  const cross = svg('line', { y1: PAD.t, y2: PAD.t + ih, class: 'cross', visibility: 'hidden' });
  const dot1 = svg('circle', { r: 4, class: 'dot s1', visibility: 'hidden' });
  const dot2 = svg('circle', { r: 4, class: 'dot s2', visibility: 'hidden' });
  root.append(cross, dot1, dot2);
  const tip = h('div', { class: 'tip', hidden: true });
  const wrap = h('div', { class: 'chart-wrap' }, root, tip);

  const show = (clientX) => {
    const r = root.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((sx - PAD.l) / iw) * (pts.length - 1))));
    const p = pts[i];
    for (const el of [cross, dot1, dot2]) el.setAttribute('visibility', 'visible');
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    dot1.setAttribute('cx', x(i)); dot1.setAttribute('cy', y(p.events));
    dot2.setAttribute('cx', x(i)); dot2.setAttribute('cy', y(p.spending));
    tip.replaceChildren(
      h('strong', {}, capitalize(formatLong(p.date))),
      h('div', { class: 'tip-row' }, h('i', { class: 'sw s1' }), 'Só compromissos ', h('b', {}, formatBRL(p.events))),
      h('div', { class: 'tip-row' }, h('i', { class: 'sw s2' }), 'Gastando o orçamento ', h('b', {}, formatBRL(p.spending))),
      ...p.dayEvents.map((e) => h('div', { class: 'tip-ev' }, `${e.kind === 'income' ? '▲' : '▼'} ${e.name} ${formatBRLShort(e.amount)}`)));
    tip.hidden = false;
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 70), r.width - 70)}px`;
  };
  const hide = () => {
    for (const el of [cross, dot1, dot2]) el.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  root.addEventListener('pointermove', (e) => show(e.clientX));
  root.addEventListener('pointerdown', (e) => show(e.clientX));
  root.addEventListener('pointerleave', hide);

  return wrap;
}

function legend() {
  return h('div', { class: 'legend' },
    h('span', {}, h('i', { class: 'sw s1' }), 'Só compromissos'),
    h('span', {}, h('i', { class: 'sw s2 dashed' }), 'Gastando o orçamento diário'),
    h('span', {}, h('i', { class: 'tri in' }, '▲'), 'Recebimento'),
    h('span', {}, h('i', { class: 'tri out' }, '▼'), 'Pagamento'));
}

function eventList(ctx, proj) {
  const groups = new Map();
  for (const e of proj.events) {
    if (!groups.has(e.effectiveDate)) groups.set(e.effectiveDate, []);
    groups.get(e.effectiveDate).push(e);
  }
  const accName = (id) => store.getAccount(id)?.name ?? '—';
  if (!groups.size) return h('p', { class: 'muted' }, 'Nenhum evento previsto.');
  return h('ol', { class: 'events' }, [...groups].map(([date, evs]) => h('li', {},
    h('div', { class: 'ev-date' }, h('strong', {}, capitalize(formatLong(date))), h('span', { class: 'muted small' }, relative(ctx.today, date))),
    h('ul', {}, evs.map((e) => h('li', { class: 'ev row between' },
      h('span', {}, e.name, h('span', { class: 'muted small' },
        e.kind === 'income' ? ` → ${accName(e.accountId)}` : e.kind === 'expense' ? ` · ${accName(e.accountId)}` : ` · de ${accName(e.accountId)}`,
        e.overdue ? ` · atrasado (${formatShort(e.date)})` : '')),
      h('strong', { class: e.kind === 'income' ? 'pos' : e.kind === 'expense' ? 'neg' : '' },
        `${e.kind === 'income' ? '+' : '−'}${formatBRLShort(e.amount)}`)))))));
}

export function renderTimeline(ctx) {
  const proj = projectBalance(ctx.state, ctx.today, ctx.budget);
  const last = proj.points[proj.points.length - 1];
  return h('div', { class: 'screen timeline' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Linha do tempo')),
    h('section', { class: 'card' },
      h('p', { class: 'muted small' }, `Saldo projetado das contas de gasto até ${formatShort(proj.end)}`),
      legend(),
      chart(ctx, proj),
      h('p', { class: 'muted small' }, 'Toque no gráfico para ver cada dia. ',
        `Em ${formatShort(last.date)}: ${formatBRL(last.events)} sem gastos do dia a dia.`)),
    h('section', { class: 'card' }, h('h3', {}, 'Próximos eventos'), eventList(ctx, proj)));
}
