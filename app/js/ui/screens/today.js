// Hoje: quanto ainda dá para gastar, o que o app precisa de você e o que já foi lançado.

import { h, sheet, amount } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { formatHeader, formatShort, relative, addDays, TIME_ZONE } from '../../core/dates.js';
import { openEvents, pendingConfirmations } from '../../core/schedule.js';
import { confirmOccurrenceSheet, transferSheet, eventSheet, transactionSheet, TX_LABEL } from '../editors.js';
import { backupBanner } from '../backup.js';

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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

/** A conta que leva ao limite do dia, passo a passo. */
function explainSheet(ctx) {
  const b = ctx.budget;
  const u = b.untilLimit;
  const tight = b.limitingDay !== b.horizonEnd;
  const row = (k, v, cls = '') => [h('span', { class: `k ${cls}` }, k), h('span', { class: `v ${cls}` }, v)];
  sheet('Como o limite é calculado', (close) => [
    h('p', { class: 'sheet-lead' }, b.nextSalary
      ? `O limite faz o dinheiro durar até ${formatShort(b.horizonEnd)}, véspera de ${b.nextSalary.name}.`
      : `Sem receita prevista, o limite faz o dinheiro durar ${b.days} dias.`),
    tight && h('p', { class: 'sheet-lead' }, `O dia mais apertado é ${formatShort(b.limitingDay)}, então a conta vai até ele.`),
    h('div', { class: 'calc' },
      row(b.spentToday > 0 ? 'Saldo no começo do dia' : 'Saldo nas contas de gasto', formatBRL(b.spendableStart)),
      u.incomes > 0 && row('Receitas previstas', `+${formatBRL(u.incomes)}`),
      u.outflows > 0 && row('Despesas fixas e aportes', `−${formatBRL(u.outflows)}`),
      row(u.days === 1 ? 'Dias' : `Dias até ${formatShort(b.limitingDay)}`, `÷ ${u.days}`),
      h('span', { class: 'rule' }),
      row('Limite por dia', formatBRL(b.dailyBudget), `total ${b.dailyBudget < 0 ? 'neg' : ''}`)),
    h('div', { class: 'calc' },
      row('Amanhã, sem gastar mais nada hoje', formatBRL(ctx.tomorrow.dailyBudget), 'total')),
    h('p', { class: 'field-hint' }, 'A conta é refeita todo dia com o saldo real. O que sobra hoje é repartido pelos próximos dias; o que passa do limite é descontado deles.'),
    h('button', { class: 'btn primary block', onclick: close }, 'Entendi'),
  ]);
}

function hero(ctx) {
  const { dailyBudget, remainingToday, spentToday, limitingDay } = ctx.budget;
  const noRoom = dailyBudget < 0; // as contas já passam do dinheiro disponível
  const over = !noRoom && remainingToday < 0;
  const left = dailyBudget > 0 ? Math.min(100, Math.max(0, (remainingToday / dailyBudget) * 100)) : 0;
  const label = noRoom ? 'Sem folga hoje' : over ? 'Passou do limite' : 'Resta para gastar';
  const tone = noRoom || over ? 'neg' : remainingToday > 0 ? 'pos' : '';
  return h('section', { class: 'hero', 'aria-label': 'Quanto resta para gastar hoje' },
    h('div', { class: 'hero-top' },
      h('p', { class: 'hero-label' }, label),
      h('button', { class: 'icon-btn', 'aria-label': 'Como o limite é calculado', onclick: () => explainSheet(ctx) }, icon('info', { size: 20 }))),
    amount(formatBRL(over ? -remainingToday : remainingToday), `hero-value ${tone}`, { 'data-fit': true }),
    h('div', {
      class: `meter ${over || noRoom ? 'over' : ''}`, role: 'progressbar', 'aria-label': 'Quanto do limite de hoje ainda resta',
      'aria-valuenow': Math.round(left), 'aria-valuemin': 0, 'aria-valuemax': 100,
    }, h('span', { style: `width:${left}%` })),
    noRoom
      ? h('p', { class: 'hero-foot' }, `As contas até ${formatShort(limitingDay)} passam do que você tem.`)
      : h('p', { class: 'hero-foot' },
        h('span', {}, spentToday > 0 ? `Gastou ${formatBRL(spentToday)} de ${formatBRL(dailyBudget)}` : 'Nada gasto hoje'),
        h('span', { class: 'tomorrow' }, 'Amanhã ', h('strong', { class: ctx.tomorrow.dailyBudget < 0 ? 'neg' : '' }, formatBRL(ctx.tomorrow.dailyBudget)))));
}

/** Receitas, despesas e aportes com data vencida ou de hoje, esperando confirmação. */
function pendingCard(ctx) {
  const pend = pendingConfirmations(ctx.state, ctx.today);
  if (!pend.length) return null;
  return [
    h('h2', { class: 'section-label' }, 'Para confirmar'),
    h('section', { class: 'card flush confirm' },
      pend.map((e) => h('div', { class: 'row-item' },
        h('span', { class: 'dot warn', 'aria-hidden': 'true' }),
        h('span', { class: 'li-main' },
          h('span', { class: 'li-title' }, e.name),
          h('span', { class: 'li-sub' }, `${formatBRLShort(e.amount)}, ${e.overdue ? `previsto para ${formatShort(e.date)}` : 'previsto para hoje'}`)),
        h('button', { class: 'btn small tonal-warn', 'aria-label': `Confirmar ${e.name}`, onclick: () => confirmOccurrenceSheet(e) }, 'Confirmar')))),
  ];
}

function coverageText(cov) {
  if (cov == null) return null;
  if (cov >= 365) return 'Cobre mais de um ano';
  if (cov === 0) return 'Não cobre o dia de hoje';
  if (cov === 1) return 'Cobre só hoje';
  return `Cobre ${cov} dias`;
}

/** Conta dos gastos do dia: aviso de resgate quando está baixa; senão, saldo e cobertura. */
function accountCard(ctx) {
  const { refill, surplus, state } = ctx;
  const acc = store.getAccount(state.settings.defaultAccountId);
  if (!acc) return null;
  const reserve = store.getAccount(refill.fromAccountId);
  const cov = coverageText(refill.coverage);
  if (refill.show) {
    const span = refill.cutByIncome ? `até ${refill.cutByIncome.name} cair` : plural(refill.periodDays, 'dia', 'dias');
    return h('section', { class: 'card alert' },
      h('div', { class: 'alert-head' },
        icon('alert', { size: 22 }),
        h('span', { class: 'li-main' },
          h('span', { class: 'li-title' }, 'Hora de resgatar'),
          h('span', { class: 'li-sub' }, `${acc.name} tem ${formatBRL(acc.balance)}${cov ? `. ${cov}.` : '.'}`))),
      h('button', { class: 'btn warn block', onclick: () => refillSheet(ctx) }, icon('transfer', { size: 20 }), `Resgatar ${formatBRLShort(refill.amount)}`),
      h('p', { class: 'caption center' }, `De ${reserve?.name}, para cobrir ${span}`));
  }
  return h('section', { class: 'card flush' },
    h('div', { class: 'row-item' },
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title' }, acc.name),
        cov && h('span', { class: 'li-sub' }, cov)),
      h('span', { class: `li-value ${acc.balance < 0 ? 'neg' : ''}` }, formatBRL(acc.balance))),
    surplus && h('div', { class: 'row-item' },
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
        h('span', { class: 'li-over' }, 'Próxima receita'),
        h('span', { class: 'li-title' }, next.name),
        h('span', { class: 'li-sub' }, relative(ctx.today, next.date))),
      h('span', { class: 'li-end' },
        h('span', { class: 'li-value pos' }, `+${formatBRLShort(next.amount)}`),
        icon('chevron', { size: 18, cls: 'chev' }))));
}

function todayEntries(ctx) {
  const list = ctx.state.transactions.filter((t) => (t.type === 'spend' || t.type === 'income') && t.date === ctx.today).reverse();
  if (!list.length) return h('p', { class: 'hint' }, 'Nenhum lançamento hoje. Toque em + para lançar um gasto ou uma receita.');
  const def = ctx.state.settings.defaultAccountId;
  const sub = (t) => [t.createdAt && timeFmt.format(new Date(t.createdAt)), (t.from || t.to) !== def && store.getAccount(t.from || t.to)?.name].filter(Boolean).join(', ');
  return [
    h('h2', { class: 'section-label' }, 'Lançamentos de hoje'),
    h('section', { class: 'card flush' },
      h('ul', { class: 'list' }, list.map((t) => h('li', {},
        h('button', { class: 'list-item', onclick: () => transactionSheet(t) },
          h('span', { class: 'li-main' },
            h('span', { class: `li-title ${t.desc ? '' : 'muted'}` }, t.desc || TX_LABEL[t.type]),
            sub(t) && h('span', { class: 'li-sub' }, sub(t))),
          t.type === 'income'
            ? h('span', { class: 'li-value pos' }, `+${formatBRL(t.amount)}`)
            : h('span', { class: 'li-value' }, `−${formatBRL(t.amount)}`)))))),
  ];
}

export function renderToday(ctx) {
  return h('div', { class: 'screen today' },
    h('header', { class: 'screen-head' },
      h('div', { class: 'titles' }, h('h1', {}, 'Hoje'), h('p', { class: 'sub' }, formatHeader(ctx.today))),
      h('button', { class: 'icon-btn', 'aria-label': 'Ajustes', onclick: () => ctx.navigate('#/ajustes') }, icon('sliders', { size: 24 }))),
    hero(ctx),
    accountCard(ctx),
    pendingCard(ctx),
    nextIncome(ctx),
    backupBanner(ctx),
    todayEntries(ctx));
}
