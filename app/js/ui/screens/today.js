import { h } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { formatBRL, formatBRLShort, formatSigned } from '../../core/money.js';
import { formatHeader, formatDayMonth, relative, addDays, TIME_ZONE } from '../../core/dates.js';
import { openEvents, pendingConfirmations } from '../../core/schedule.js';
import { confirmOccurrenceSheet, transferSheet, eventSheet, transactionSheet } from '../editors.js';
import { backupBanner } from '../backup.js';

const ASK = { income: 'Recebeu?', expense: 'Pagou?', contribution: 'Aportou?' };
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
const dayMonth = (d) => formatDayMonth(d, Number(d.slice(0, 4)));

export function refillSheet(ctx) {
  const { refill } = ctx;
  const to = store.getAccount(refill.toAccountId);
  const span = refill.cutByIncome
    ? `até ${refill.cutByIncome.name} cair (${dayMonth(refill.cutByIncome.date)})`
    : `${refill.periodDays} dias de gastos`;
  transferSheet({
    from: refill.fromAccountId,
    to: refill.toAccountId,
    amount: refill.amount,
    title: 'Registrar resgate',
    okLabel: 'Registrar resgate',
    desc: 'Resgate',
    note: `Valor sugerido para ${to?.name ?? 'a conta'} cobrir ${span}`
      + (refill.commitments ? `, já com ${formatBRL(refill.commitments)} de contas a pagar` : '')
      + (refill.cappedByReserve ? '. Limitado ao saldo da reserva.' : '.'),
  });
}

function pendingCard(ctx) {
  const pend = pendingConfirmations(ctx.state, ctx.today);
  if (!pend.length) return null;
  return h('section', { class: 'card flush', 'aria-label': 'A confirmar' },
    h('ul', { class: 'list' }, pend.map((e) => h('li', { class: 'row-item' },
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title' }, `${e.name} ${formatBRLShort(e.amount)}`),
        h('span', { class: 'li-sub' }, e.overdue ? `Previsto para ${dayMonth(e.date)}` : 'Previsto para hoje')),
      h('button', { class: 'btn small primary', onclick: () => confirmOccurrenceSheet(e) }, ASK[e.kind])))));
}

function hero(ctx) {
  const { dailyBudget, remainingToday, spentToday, horizonEnd, limitingDay, shortfall } = ctx.budget;
  const noRoom = dailyBudget < 0; // as contas previstas já passam do dinheiro disponível
  const over = !noRoom && remainingToday < 0;
  const pct = dailyBudget > 0 ? Math.min(100, Math.max(0, (spentToday / dailyBudget) * 100)) : 100;

  if (noRoom) {
    return h('section', { class: 'hero', 'aria-label': 'Quanto resta para hoje' },
      h('p', { class: 'hero-label' }, `Sem folga até ${dayMonth(limitingDay)}`),
      h('p', { class: 'hero-value neg', 'data-fit': true }, formatBRL(0)),
      h('p', { class: 'hero-meta' }, 'Faltam ', h('strong', {}, formatBRL(shortfall)), ` para pagar as contas previstas até ${dayMonth(limitingDay)}.`),
      h('button', { class: 'btn small quiet hero-link', onclick: () => ctx.navigate('#/linha') }, 'Ver contas na Linha do tempo', icon('chevron', { size: 16 })));
  }

  const label = over ? 'Passou do limite hoje' : 'Resta para hoje';
  const value = over ? -remainingToday : remainingToday;
  return h('section', { class: 'hero', 'aria-label': 'Quanto resta para hoje' },
    h('p', { class: 'hero-label' }, label),
    h('p', { class: `hero-value ${over ? 'neg' : ''}`, 'data-fit': true }, formatBRL(value)),
    h('p', { class: 'hero-meta' }, `Limite de ${formatBRL(dailyBudget)} por dia até ${dayMonth(horizonEnd)}`),
    spentToday > 0 && h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Quanto do limite já foi gasto', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('span', { style: `width:${pct}%`, class: over ? 'over' : '' })),
    spentToday > 0 && h('p', { class: 'hero-meta' }, `${formatBRL(spentToday)} gastos hoje`));
}

function coverageCard(ctx) {
  const { refill, surplus, state } = ctx;
  const acc = store.getAccount(state.settings.defaultAccountId);
  if (!acc) return null;
  const cov = refill.coverage;
  const reserve = store.getAccount(refill.fromAccountId);
  const low = refill.show;
  const covText = cov == null ? null
    : cov === 0 ? 'Não cobre o limite de hoje'
      : cov >= 365 ? 'Cobre mais de um ano'
        : `Cobre ${cov} ${cov === 1 ? 'dia' : 'dias'}`;
  const span = refill.cutByIncome ? `até ${refill.cutByIncome.name} cair` : `${refill.periodDays} dias`;
  return h('section', { class: `card ${low ? '' : 'flush'}` },
    h('div', { class: low ? 'row between gap' : 'row-item' },
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title' }, acc.name),
        covText && h('span', { class: `li-sub ${low ? 'warn-text' : ''}` },
          low ? h('span', { class: 'status' }, icon('alert', { size: 15 }), covText) : covText)),
      h('span', { class: `li-value ${acc.balance < 0 ? 'neg' : ''}` }, formatBRL(acc.balance))),
    low && h('button', { class: 'btn warn block', onclick: () => refillSheet(ctx) }, icon('transfer', { size: 20 }), `Resgatar ${formatBRLShort(refill.amount)}`),
    low && h('p', { class: 'caption center' }, `De ${reserve?.name}, para cobrir ${span}`),
    !low && surplus && h('div', { class: 'row-item divided' },
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title pos' }, 'Dinheiro sobrando'),
        h('span', { class: 'li-sub' }, `Dá para aplicar ${formatBRLShort(surplus.amount)} em ${reserve?.name}`)),
      h('button', {
        class: 'btn small',
        onclick: () => transferSheet({ from: surplus.fromAccountId, to: surplus.toAccountId, amount: surplus.amount, title: 'Aplicar excedente', okLabel: 'Aplicar', desc: 'Aplicação do excedente' }),
      }, 'Aplicar')));
}

function nextIncome(ctx) {
  const next = openEvents(ctx.state, ctx.today, addDays(ctx.today, 120))
    .find((e) => e.kind === 'income' && e.date > ctx.today);
  if (!next) return null;
  return h('section', { class: 'card flush' },
    h('button', { class: 'list-item', onclick: () => eventSheet(next) },
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title' }, next.name),
        h('span', { class: 'li-sub' }, `Próximo recebimento, ${relative(ctx.today, next.date)}`)),
      h('span', { class: 'li-end' },
        h('span', { class: 'li-value pos' }, formatSigned(next.amount, 1, { short: true })),
        icon('chevron', { size: 18, cls: 'chev' }))));
}

function todaySpends(ctx) {
  const list = ctx.state.transactions.filter((t) => (t.type === 'spend' || t.type === 'income') && t.date === ctx.today).reverse();
  if (!list.length) return null;
  const def = ctx.state.settings.defaultAccountId;
  return [
    h('h2', { class: 'section-label' }, 'Lançamentos de hoje'),
    h('section', { class: 'card flush' },
      h('ul', { class: 'list' }, list.map((t) => h('li', {},
        h('button', { class: 'list-item', onclick: () => transactionSheet(t) },
          h('span', { class: 'li-main' },
            h('span', { class: `li-title ${t.desc ? '' : 'is-placeholder'}` }, t.desc || (t.type === 'income' ? 'Receita' : 'Gasto')),
            h('span', { class: 'li-sub' }, [t.createdAt && timeFmt.format(new Date(t.createdAt)), (t.from || t.to) !== def && store.getAccount(t.from || t.to)?.name].filter(Boolean).join(', '))),
          t.type === 'income'
            ? h('span', { class: 'li-value pos' }, formatSigned(t.amount, 1))
            : h('span', { class: 'li-value' }, formatSigned(t.amount, -1))))))),
  ];
}

export function renderToday(ctx) {
  return h('div', { class: 'screen today' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Hoje'), h('p', { class: 'sub' }, formatHeader(ctx.today))),
    pendingCard(ctx),
    hero(ctx),
    h('div', { class: 'cta-row' },
      h('button', { class: 'btn primary xl', onclick: () => ctx.navigate('#/gasto') }, icon('plus', { size: 22 }), 'Lançar gasto'),
      h('button', { class: 'btn xl', onclick: () => ctx.navigate('#/receita') }, icon('plus', { size: 20 }), 'Receita')),
    coverageCard(ctx),
    nextIncome(ctx),
    backupBanner(ctx),
    todaySpends(ctx));
}
