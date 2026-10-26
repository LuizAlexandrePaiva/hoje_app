import { h, toast } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { formatHeader, formatShort, relative, addDays, TIME_ZONE } from '../../core/dates.js';
import { openEvents, pendingConfirmations } from '../../core/schedule.js';
import { confirmOccurrenceSheet, transferSheet } from '../editors.js';

const ASK = { income: 'Recebeu?', expense: 'Pagou?', contribution: 'Aportou?' };
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });

export function refillSheet(ctx) {
  const { refill } = ctx;
  const to = store.getAccount(refill.toAccountId);
  const span = refill.cutByIncome
    ? `até ${refill.cutByIncome.name} cair (${formatShort(refill.cutByIncome.date)})`
    : `${refill.periodDays} dias de gastos`;
  transferSheet({
    from: refill.fromAccountId,
    to: refill.toAccountId,
    amount: refill.amount,
    title: 'Registrar resgate',
    desc: 'Resgate',
    note: `Valor sugerido para ${to?.name ?? 'a conta'} cobrir ${span}`
      + (refill.commitments ? `, já com ${formatBRL(refill.commitments)} de contas a pagar` : '')
      + (refill.cappedByReserve ? '. Limitado ao saldo da reserva.' : '.'),
  });
}

function pendingCard(ctx) {
  const pend = pendingConfirmations(ctx.state, ctx.today);
  if (!pend.length) return null;
  return h('section', { class: 'card flush confirm' },
    h('div', { class: 'card-head', style: 'padding-top:12px' },
      h('h2', { class: 'card-title' }, 'Confirme'),
      h('span', { class: 'badge pos' }, String(pend.length))),
    h('ul', { class: 'list' }, pend.map((e) => h('li', { class: 'row-item' },
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title' }, e.name),
        h('span', { class: 'li-sub' }, `${formatBRLShort(e.amount)} · ${e.overdue ? `previsto ${relative(ctx.today, e.date)}` : 'previsto hoje'}`)),
      h('button', { class: 'btn small primary', onclick: () => confirmOccurrenceSheet(e) }, ASK[e.kind])))));
}

function hero(ctx) {
  const { dailyBudget, remainingToday, spentToday, days, horizonEnd, limitingDay } = ctx.budget;
  const pct = dailyBudget > 0 ? Math.min(100, Math.max(0, (spentToday / dailyBudget) * 100)) : 100;
  return h('section', { class: 'hero', 'aria-label': 'Orçamento de hoje' },
    h('p', { class: 'hero-label' }, 'Você pode gastar hoje'),
    h('p', { class: `hero-value ${dailyBudget < 0 ? 'neg' : ''}` }, formatBRL(dailyBudget)),
    h('p', { class: 'hero-meta' }, `Por dia, até ${formatShort(horizonEnd)} · ${days} ${days === 1 ? 'dia' : 'dias'}`),
    h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Quanto já gastou hoje', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('span', { style: `width:${pct}%`, class: remainingToday < 0 ? 'over' : '' })),
    h('div', { class: 'hero-foot' },
      h('div', {}, h('p', { class: 'k' }, 'Gasto hoje'), h('p', { class: 'v' }, formatBRL(spentToday))),
      h('div', { style: 'text-align:right' },
        h('p', { class: 'k' }, remainingToday < 0 ? 'Passou' : 'Restante'),
        h('p', { class: `v ${remainingToday < 0 ? 'neg' : 'pos'}` }, formatBRL(Math.abs(remainingToday))))),
    dailyBudget < 0 && h('div', { class: 'callout neg', style: 'margin-top:12px' },
      h('p', { class: 'callout-head' }, icon('alert', { size: 18 }), 'Dinheiro não fecha'),
      h('p', {}, `As contas até ${formatShort(limitingDay)} passam do que você tem. Segure os gastos e revise as despesas.`)));
}

function coverageCard(ctx) {
  const { refill, surplus, state } = ctx;
  const acc = store.getAccount(state.settings.defaultAccountId);
  if (!acc) return null;
  const cov = refill.coverage;
  const covText = cov == null ? '—' : cov >= 365 ? '365+ dias' : `${cov} ${cov === 1 ? 'dia' : 'dias'}`;
  const reserve = store.getAccount(refill.fromAccountId);
  const negative = acc.balance < 0;
  const low = refill.show;
  return h('section', { class: `card ${low ? 'attention' : ''}` },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, acc.name),
      negative ? h('span', { class: 'badge neg' }, 'Negativa') : low && h('span', { class: 'badge warn' }, 'Resgatar')),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Saldo'), h('span', { class: `stat-value ${negative ? 'neg' : ''}` }, formatBRL(acc.balance))),
      h('div', { class: 'stat right' }, h('span', { class: 'stat-label' }, 'Cobre'), h('span', { class: `stat-value ${low ? 'warn-text' : ''}` }, covText))),
    low && h('div', { class: 'callout warn' },
      h('p', { class: 'callout-head' }, icon('alert', { size: 18 }), negative ? 'Conta no negativo' : 'Hora de resgatar'),
      h('p', {}, `Traga ${formatBRL(refill.amount)} de ${reserve?.name} para cobrir `,
        refill.cutByIncome ? `até ${refill.cutByIncome.name} cair (${formatShort(refill.cutByIncome.date)}).` : `${refill.periodDays} dias.`),
      h('button', { class: 'btn warn block', onclick: () => refillSheet(ctx) }, icon('transfer', { size: 20 }), `Resgatar ${formatBRLShort(refill.amount)}`)),
    !low && surplus && h('div', { class: 'callout pos' },
      h('p', { class: 'callout-head' }, icon('check', { size: 18 }), 'Dinheiro sobrando'),
      h('p', {}, `Dá para aplicar ${formatBRL(surplus.amount)} em ${reserve?.name} e ainda cobrir os próximos dias.`),
      h('button', {
        class: 'btn block',
        onclick: () => transferSheet({ from: surplus.fromAccountId, to: surplus.toAccountId, amount: surplus.amount, title: 'Aplicar excedente', desc: 'Aplicação do excedente' }),
      }, `Aplicar ${formatBRLShort(surplus.amount)}`)));
}

function nextIncome(ctx) {
  const next = openEvents(ctx.state, ctx.today, addDays(ctx.today, 120))
    .find((e) => e.kind === 'income' && e.date > ctx.today);
  if (!next) return null;
  return h('section', { class: 'card flush' },
    h('div', { class: 'row-item' },
      h('span', { class: 'li-main' },
        h('span', { class: 'caption' }, 'Próximo recebimento'),
        h('span', { class: 'li-title' }, next.name),
        h('span', { class: 'li-sub' }, `${relative(ctx.today, next.date)} · ${formatShort(next.date)}`)),
      h('span', { class: 'li-value pos' }, `+${formatBRLShort(next.amount)}`)));
}

function todaySpends(ctx) {
  const list = ctx.state.transactions.filter((t) => t.type === 'spend' && t.date === ctx.today).reverse();
  if (!list.length) return null;
  return h('section', { class: 'card flush' },
    h('div', { class: 'card-head', style: 'padding-top:12px' },
      h('h2', { class: 'card-title' }, 'Gastos de hoje'),
      h('span', { class: 'li-value' }, formatBRL(ctx.budget.spentToday))),
    h('ul', { class: 'list' }, list.map((t) => h('li', { class: 'row-item' },
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title' }, t.desc || 'Gasto'),
        h('span', { class: 'li-sub' }, [t.createdAt && timeFmt.format(new Date(t.createdAt)), store.getAccount(t.from)?.name].filter(Boolean).join(' · '))),
      h('span', { class: 'li-end' },
        h('span', { class: 'li-value' }, formatBRL(t.amount)),
        h('button', {
          class: 'icon-btn', 'aria-label': `Excluir gasto de ${formatBRL(t.amount)}`,
          onclick: () => { store.deleteTransaction(t.id); toast('Gasto excluído'); },
        }, icon('trash', { size: 18 })))))));
}

export function renderToday(ctx) {
  return h('div', { class: 'screen today' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Hoje'), h('p', { class: 'sub' }, formatHeader(ctx.today))),
    pendingCard(ctx),
    hero(ctx),
    h('button', { class: 'btn primary xl block', onclick: () => ctx.navigate('#/gasto') }, icon('plus', { size: 22 }), 'Lançar gasto'),
    coverageCard(ctx),
    nextIncome(ctx),
    todaySpends(ctx));
}
