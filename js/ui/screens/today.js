import { h, toast } from '../dom.js';
import * as store from '../../data/store.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { formatLong, formatShort, relative, addDays } from '../../core/dates.js';
import { openEvents, pendingConfirmations } from '../../core/schedule.js';
import { confirmOccurrenceSheet, transferSheet } from '../editors.js';

const ASK = { income: 'Recebeu?', expense: 'Pagou?', contribution: 'Fez o aporte?' };

export function refillSheet(ctx) {
  const { refill } = ctx;
  const to = store.getAccount(refill.toAccountId);
  const until = refill.cutByIncome
    ? `até a chegada de ${refill.cutByIncome.name} (${formatShort(refill.cutByIncome.date)})`
    : `${refill.periodDays} dias`;
  transferSheet({
    from: refill.fromAccountId,
    to: refill.toAccountId,
    amount: refill.amount,
    title: 'Registrar resgate',
    desc: 'Resgate',
    note: `Sugestão para ${to?.name ?? 'a conta'} cobrir ${until}${refill.commitments ? `, incluindo ${formatBRL(refill.commitments)} em compromissos` : ''}.`
      + (refill.cappedByReserve ? ' Limitado ao saldo da reserva.' : ''),
  });
}

function pendingCard(ctx) {
  const pend = pendingConfirmations(ctx.state, ctx.today);
  if (!pend.length) return null;
  return h('section', { class: 'card pending' },
    h('h3', {}, 'Para confirmar'),
    h('ul', { class: 'list' }, pend.map((e) => h('li', { class: 'pending-item' },
      h('div', { class: 'li-main' },
        h('span', { class: 'li-title' }, `${e.name} — ${formatBRLShort(e.amount)}`),
        h('span', { class: 'li-sub' }, e.overdue ? `previsto ${relative(ctx.today, e.date)} (${formatShort(e.date)})` : 'previsto para hoje')),
      h('button', { class: 'btn small primary', onclick: () => confirmOccurrenceSheet(e) }, ASK[e.kind])))));
}

function budgetCard(ctx) {
  const { budget } = ctx;
  const { dailyBudget, remainingToday, spentToday } = budget;
  const pct = dailyBudget > 0 ? Math.min(100, Math.max(0, (spentToday / dailyBudget) * 100)) : 100;
  const until = budget.nextSalary
    ? `até ${formatShort(budget.horizonEnd)}, véspera de ${budget.nextSalary.name} · ${budget.days} ${budget.days === 1 ? 'dia' : 'dias'}`
    : `próximos ${budget.days} dias (nenhuma receita prevista)`;
  return h('section', { class: 'hero' },
    h('p', { class: 'hero-label' }, 'Você pode gastar hoje'),
    h('p', { class: `hero-value ${dailyBudget < 0 ? 'neg' : ''}` }, formatBRL(dailyBudget)),
    h('p', { class: 'hero-sub' }, until),
    h('div', { class: 'meter', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('span', { style: `width:${pct}%`, class: remainingToday < 0 ? 'over' : '' })),
    h('div', { class: 'row between hero-foot' },
      h('span', {}, 'Restante hoje'),
      h('strong', { class: remainingToday < 0 ? 'neg' : 'pos' }, formatBRL(remainingToday))),
    dailyBudget < 0 && h('p', { class: 'alert-text small' },
      `Os compromissos até ${formatShort(budget.limitingDay)} passam do dinheiro disponível. Evite gastos e revise as despesas.`));
}

function coverageCard(ctx) {
  const { refill, surplus, state } = ctx;
  const acc = store.getAccount(state.settings.defaultAccountId);
  if (!acc) return null;
  const cov = refill.coverage;
  const covText = cov == null ? '—' : cov >= 365 ? '365+ dias' : `${cov} ${cov === 1 ? 'dia' : 'dias'}`;
  const low = refill.show;
  return h('section', { class: `card coverage ${low ? 'warn' : ''}` },
    h('div', { class: 'row between' },
      h('div', {},
        h('p', { class: 'muted small' }, `Saldo ${acc.name}`),
        h('p', { class: `big ${acc.balance < 0 ? 'neg' : ''}` }, formatBRL(acc.balance))),
      h('div', { class: 'right' },
        h('p', { class: 'muted small' }, `${acc.name} cobre`),
        h('p', { class: 'big' }, covText))),
    low && h('div', { class: 'callout warn' },
      h('p', { class: 'callout-title' }, acc.balance < 0 ? `${acc.name} está negativo` : 'Hora de resgatar'),
      h('p', { class: 'small' },
        `Sugestão: ${formatBRL(refill.amount)} de ${store.getAccount(refill.fromAccountId)?.name}`,
        refill.cutByIncome ? ` — cobre até ${refill.cutByIncome.name} (${formatShort(refill.cutByIncome.date)}).` : ` — cobre ${refill.periodDays} dias.`),
      h('button', { class: 'btn warn block', onclick: () => refillSheet(ctx) }, 'Registrar resgate')),
    !low && surplus && h('div', { class: 'callout pos' },
      h('p', { class: 'callout-title' }, 'Sobrando na conta'),
      h('p', { class: 'small' }, `${acc.name} tem bem mais do que o necessário para os próximos dias. Aplicar ${formatBRL(surplus.amount)} na reserva?`),
      h('button', {
        class: 'btn ghost block',
        onclick: () => transferSheet({ from: surplus.fromAccountId, to: surplus.toAccountId, amount: surplus.amount, title: 'Aplicar excedente', desc: 'Aplicação do excedente' }),
      }, 'Aplicar excedente')));
}

function nextIncomeCard(ctx) {
  const next = openEvents(ctx.state, ctx.today, addDays(ctx.today, 120))
    .find((e) => e.kind === 'income' && e.date >= ctx.today);
  if (!next) return null;
  return h('section', { class: 'card next' },
    h('p', { class: 'muted small' }, 'Próximo recebimento'),
    h('p', {}, h('strong', {}, next.name), ` ${relative(ctx.today, next.date)} — `, h('span', { class: 'pos' }, formatBRLShort(next.amount))));
}

function todaySpends(ctx) {
  const list = ctx.state.transactions.filter((t) => t.type === 'spend' && t.date === ctx.today).reverse();
  if (!list.length) return null;
  return h('section', { class: 'card' },
    h('h3', {}, 'Gastos de hoje'),
    h('ul', { class: 'list' }, list.map((t) => h('li', { class: 'row between tx' },
      h('span', {}, t.desc || 'Gasto', h('span', { class: 'muted small' }, ` · ${store.getAccount(t.from)?.name ?? ''}`)),
      h('span', { class: 'row gap-sm' },
        h('strong', {}, formatBRL(t.amount)),
        h('button', {
          class: 'icon-btn', 'aria-label': 'Excluir gasto',
          onclick: () => { store.deleteTransaction(t.id); toast('Gasto excluído'); },
        }, '✕'))))));
}

export function renderToday(ctx) {
  return h('div', { class: 'screen today' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Hoje'), h('span', { class: 'muted' }, formatLong(ctx.today))),
    pendingCard(ctx),
    budgetCard(ctx),
    h('button', { class: 'btn primary xl block', onclick: () => ctx.navigate('#/gasto') }, '+ Lançar gasto'),
    coverageCard(ctx),
    nextIncomeCard(ctx),
    todaySpends(ctx));
}
