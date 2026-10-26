import { h } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { formatHeader, formatShort, relative, addDays, TIME_ZONE } from '../../core/dates.js';
import { openEvents, pendingConfirmations } from '../../core/schedule.js';
import { confirmOccurrenceSheet, transferSheet, eventSheet, transactionSheet } from '../editors.js';
import { backupBanner } from '../backup.js';

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
    h('ul', { class: 'list' }, pend.map((e) => h('li', { class: 'row-item' },
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title' }, `${e.name} ${formatBRLShort(e.amount)}`),
        h('span', { class: 'li-sub' }, e.overdue ? `Previsto para ${formatShort(e.date)}` : 'Previsto para hoje')),
      h('button', { class: 'btn small primary', onclick: () => confirmOccurrenceSheet(e) }, ASK[e.kind])))));
}

function hero(ctx) {
  const { dailyBudget, remainingToday, spentToday, horizonEnd, limitingDay } = ctx.budget;
  const pct = dailyBudget > 0 ? Math.min(100, Math.max(0, (spentToday / dailyBudget) * 100)) : 100;
  const noRoom = dailyBudget < 0; // as contas já passam do dinheiro disponível
  const over = !noRoom && remainingToday < 0;
  const label = noRoom ? 'Sem folga hoje' : over ? 'Passou do limite hoje' : 'Resta para hoje';
  const value = over ? -remainingToday : remainingToday;
  return h('section', { class: 'hero', 'aria-label': 'Quanto resta para hoje' },
    h('p', { class: 'hero-label' }, label),
    h('p', { class: `hero-value ${noRoom || over ? 'neg' : ''}`, 'data-fit': true }, formatBRL(value)),
    h('p', { class: 'hero-meta' }, noRoom
      ? `As contas até ${formatShort(limitingDay)} passam do que você tem.`
      : `Limite de ${formatBRL(dailyBudget)} por dia, até ${formatShort(horizonEnd)}`),
    spentToday > 0 && h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Quanto do limite já foi gasto', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('span', { style: `width:${pct}%`, class: over || noRoom ? 'over' : '' })),
    spentToday > 0 && h('p', { class: 'hero-meta', style: 'margin-top:8px' }, `${formatBRL(spentToday)} gastos hoje`));
}

function coverageCard(ctx) {
  const { refill, surplus, state } = ctx;
  const acc = store.getAccount(state.settings.defaultAccountId);
  if (!acc) return null;
  const cov = refill.coverage;
  const reserve = store.getAccount(refill.fromAccountId);
  const low = refill.show;
  const covText = cov == null ? null : cov >= 365 ? 'Cobre mais de um ano' : `Cobre ${cov} ${cov === 1 ? 'dia' : 'dias'}`;
  const span = refill.cutByIncome ? `até ${refill.cutByIncome.name} cair` : `${refill.periodDays} dias`;
  return h('section', { class: `card ${low ? 'attention' : 'flush'}` },
    h('div', { class: low ? 'row between' : 'row-item' },
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title' }, acc.name),
        covText && h('span', { class: `li-sub ${low ? 'warn-text' : ''}` }, covText)),
      h('span', { class: `li-value ${acc.balance < 0 ? 'neg' : ''}` }, formatBRL(acc.balance))),
    low && h('button', { class: 'btn warn block', onclick: () => refillSheet(ctx) }, icon('transfer', { size: 20 }), `Resgatar ${formatBRLShort(refill.amount)}`),
    low && h('p', { class: 'caption center' }, `De ${reserve?.name}, para cobrir ${span}`),
    !low && surplus && h('div', { class: 'row-item', style: 'border-top:1px solid var(--divider)' },
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title pos' }, 'Dinheiro sobrando'),
        h('span', { class: 'li-sub' }, `Dá para aplicar ${formatBRLShort(surplus.amount)} em ${reserve?.name}`)),
      h('button', {
        class: 'btn small',
        onclick: () => transferSheet({ from: surplus.fromAccountId, to: surplus.toAccountId, amount: surplus.amount, title: 'Aplicar excedente', desc: 'Aplicação do excedente' }),
      }, 'Aplicar')));
}

function nextIncome(ctx) {
  const next = openEvents(ctx.state, ctx.today, addDays(ctx.today, 120))
    .find((e) => e.kind === 'income' && e.date > ctx.today);
  if (!next) return null;
  return h('section', { class: 'card flush' },
    h('button', { class: 'list-item', onclick: () => eventSheet(next) },
      h('span', { class: 'li-main' },
        h('span', { class: 'caption' }, 'Próximo recebimento'),
        h('span', { class: 'li-title' }, next.name),
        h('span', { class: 'li-sub' }, relative(ctx.today, next.date))),
      h('span', { class: 'li-end' },
        h('span', { class: 'li-value pos' }, `+${formatBRLShort(next.amount)}`),
        icon('chevron', { size: 18, cls: 'chev' }))));
}

function todaySpends(ctx) {
  const list = ctx.state.transactions.filter((t) => t.type === 'spend' && t.date === ctx.today).reverse();
  if (!list.length) return null;
  const def = ctx.state.settings.defaultAccountId;
  return [
    h('h2', { class: 'section-label' }, 'Gastos de hoje'),
    h('section', { class: 'card flush' },
      h('ul', { class: 'list' }, list.map((t) => h('li', {},
        h('button', { class: 'list-item', onclick: () => transactionSheet(t) },
          h('span', { class: 'li-main' },
            h('span', { class: `li-title ${t.desc ? '' : 'muted'}` }, t.desc || 'Sem nome'),
            h('span', { class: 'li-sub' }, [t.createdAt && timeFmt.format(new Date(t.createdAt)), t.from !== def && store.getAccount(t.from)?.name].filter(Boolean).join(', '))),
          h('span', { class: 'li-value' }, formatBRL(t.amount))))))),
  ];
}

export function renderToday(ctx) {
  return h('div', { class: 'screen today' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Hoje'), h('p', { class: 'sub' }, formatHeader(ctx.today))),
    pendingCard(ctx),
    hero(ctx),
    h('button', { class: 'btn primary xl block', onclick: () => ctx.navigate('#/gasto') }, icon('plus', { size: 22 }), 'Lançar gasto'),
    coverageCard(ctx),
    nextIncome(ctx),
    backupBanner(ctx),
    todaySpends(ctx));
}
