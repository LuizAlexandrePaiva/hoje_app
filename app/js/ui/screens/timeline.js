// Linha do tempo: gráfico SVG próprio do saldo projetado + lista de eventos.

import { h, svg } from '../dom.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { formatShort, formatLong, relative } from '../../core/dates.js';
import { projectBalance } from '../../core/projection.js';
import { spendingAccountIds } from '../../core/budget.js';
import { flowInto } from '../../core/schedule.js';
import * as store from '../../data/store.js';
import { eventSheet } from '../editors.js';

const W = 360;
const H = 200;
const PAD = { l: 8, r: 8, t: 22, b: 24 };

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
    root.append(svg('text', { x: PAD.l + 2, y: y(t) - 4, class: 'axis' }, compactBRL(t)));
  }

  // marcador do próximo salário
  const salIdx = ctx.budget.nextSalary ? pts.findIndex((p) => p.date === ctx.budget.nextSalary.date) : -1;
  if (salIdx >= 0) {
    root.append(svg('line', { x1: x(salIdx), x2: x(salIdx), y1: PAD.t - 4, y2: PAD.t + ih, class: 'salary-line' }));
    root.append(svg('text', { x: x(salIdx), y: PAD.t - 8, class: 'axis strong', 'text-anchor': 'middle' }, ctx.budget.nextSalary.name));
  }

  root.append(svg('path', { d: path('events'), class: 'line s1' }));
  root.append(svg('path', { d: path('spending'), class: 'line s2' }));

  // dias de recebimento (▲ acima da linha) e de pagamento (▼ abaixo)
  pts.forEach((p, i) => {
    const flows = p.dayEvents.map((e) => flowInto(e, ids));
    const cx = x(i);
    const cy = y(p.events);
    if (flows.some((f) => f > 0)) root.append(svg('path', { d: `M${cx - 5},${cy - 6}L${cx + 5},${cy - 6}L${cx},${cy - 14}Z`, class: 'mk in' }));
    if (flows.some((f) => f < 0)) root.append(svg('path', { d: `M${cx - 5},${cy + 6}L${cx + 5},${cy + 6}L${cx},${cy + 14}Z`, class: 'mk out' }));
  });

  // eixo x: hoje, salário e fim
  const labels = new Map([[0, 'hoje'], [pts.length - 1, formatShort(pts[pts.length - 1].date)]]);
  if (salIdx > 0 && salIdx < pts.length - 6) labels.set(salIdx, formatShort(pts[salIdx].date));
  for (const [i, t] of labels) {
    root.append(svg('text', {
      x: x(i), y: H - 6, class: 'axis',
      'text-anchor': i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle',
    }, t));
  }

  // seleção: linha vertical + pontos; os valores aparecem no painel acima
  const cross = svg('line', { y1: PAD.t, y2: PAD.t + ih, class: 'cross' });
  const dot1 = svg('circle', { r: 4.5, class: 'dot s1' });
  const dot2 = svg('circle', { r: 4.5, class: 'dot s2' });
  root.append(cross, dot1, dot2);

  const rDate = h('p', { class: 'readout-date' });
  const rRel = h('span', { class: 'muted small' });
  const rV1 = h('span', { class: 'v' });
  const rV2 = h('span', { class: 'v' });
  const rEvents = h('p', { class: 'readout-events' });
  const readout = h('div', { class: 'readout', 'aria-live': 'polite' },
    h('div', { class: 'row between' }, rDate, rRel),
    h('div', { class: 'readout-rows' },
      h('span', { class: 'k' }, h('i', { class: 'sw s1' }), 'Sem gastos do dia'), rV1,
      h('span', { class: 'k' }, h('i', { class: 'sw s2' }), 'Gastando o limite'), rV2),
    rEvents);

  const select = (i) => {
    const p = pts[i];
    for (const el of [cross]) { el.setAttribute('x1', x(i)); el.setAttribute('x2', x(i)); }
    dot1.setAttribute('cx', x(i)); dot1.setAttribute('cy', y(p.events));
    dot2.setAttribute('cx', x(i)); dot2.setAttribute('cy', y(p.spending));
    rDate.textContent = formatLong(p.date);
    rRel.textContent = relative(ctx.today, p.date);
    rV1.textContent = formatBRL(p.events);
    rV2.textContent = formatBRL(p.spending);
    rV2.classList.toggle('neg', p.spending < 0);
    rEvents.textContent = p.dayEvents.map((e) => `${e.kind === 'income' ? '▲' : '▼'} ${e.name} ${formatBRLShort(e.amount)}`).join('    ');
  };
  const pick = (clientX) => {
    const r = root.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    select(Math.max(0, Math.min(pts.length - 1, Math.round(((sx - PAD.l) / iw) * (pts.length - 1)))));
  };
  root.addEventListener('pointermove', (e) => pick(e.clientX));
  root.addEventListener('pointerdown', (e) => pick(e.clientX));
  // começa mostrando a véspera do salário (o ponto mais apertado do período)
  select(Math.max(0, pts.findIndex((p) => p.date === ctx.budget.horizonEnd)));

  return { readout, chart: h('div', { class: 'chart-wrap' }, root) };
}

function legend() {
  return h('div', { class: 'legend' },
    h('span', {}, h('i', { class: 'tri in' }, '▲'), 'Recebimento'),
    h('span', {}, h('i', { class: 'tri out' }, '▼'), 'Pagamento'));
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
    if (e.overdue) return `Atrasado, previsto para ${formatShort(e.date)}`;
    if (e.originalDate && e.date !== e.originalDate) return `Data mudada, era ${formatShort(e.originalDate)}`;
    if (e.accountId === def) return null;
    return e.kind === 'income' ? `Entra em ${accName(e.accountId)}` : `Sai de ${accName(e.accountId)}`;
  };
  return h('div', {}, [...groups].map(([date, evs]) => h('div', { class: 'day-group' },
    h('div', { class: 'day-head' }, h('strong', {}, formatLong(date)), h('span', { class: 'muted' }, relative(ctx.today, date))),
    evs.map((e) => h('button', { class: 'ev', onclick: () => eventSheet(e) },
      h('span', { class: `ev-dot ${e.kind === 'income' ? 'in' : 'out'}` }),
      h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, e.name), sub(e) && h('span', { class: 'li-sub' }, sub(e))),
      h('span', { class: `li-value ${e.kind === 'income' ? 'pos' : ''}` },
        `${e.kind === 'income' ? '+' : '−'}${formatBRLShort(e.amount)}`))))));
}

export function renderTimeline(ctx) {
  const proj = projectBalance(ctx.state, ctx.today, ctx.budget);
  const c = chart(ctx, proj);
  return h('div', { class: 'screen timeline' },
    h('header', { class: 'screen-head' },
      h('h1', {}, 'Linha do tempo'),
      h('p', { class: 'sub' }, 'Toque no gráfico para ver cada dia')),
    h('section', { class: 'card' },
      c.readout,
      c.chart,
      legend()),
    h('h2', { class: 'section-label' }, 'Próximos eventos'),
    h('section', { class: 'card flush' }, eventList(ctx, proj)));
}
