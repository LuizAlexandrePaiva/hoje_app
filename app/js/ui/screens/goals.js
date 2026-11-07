import { h } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { formatDayMonth, diffDays, relative } from '../../core/dates.js';
import { editGoal, editContribution, editAccount, confirmOccurrenceSheet, addButton } from '../editors.js';
import { pendingConfirmations } from '../../core/schedule.js';

function deadlineBadge(missing, days) {
  if (missing === 0) return h('span', { class: 'badge pos' }, 'Atingida');
  if (days < 0) return h('span', { class: 'badge neg' }, 'Prazo vencido');
  if (days === 0) return h('span', { class: 'badge warn' }, 'Prazo hoje');
  return h('span', { class: 'badge' }, `Prazo em ${days} ${days === 1 ? 'dia' : 'dias'}`);
}

function goalCard(ctx, g) {
  const { state, today } = ctx;
  const year = Number(today.slice(0, 4));
  const acc = store.getAccount(g.accountId);
  const saved = acc?.balance ?? 0;
  const missing = Math.max(0, g.target - saved);
  const pct = g.target > 0 ? Math.min(100, (saved / g.target) * 100) : 0;
  const days = diffDays(today, g.deadline);
  const contribs = state.contributions.filter((c) => c.goalId === g.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const planned = contribs.filter((c) => !state.settled[`contribution:${c.id}`]).reduce((s, c) => s + c.amount, 0);
  const gapAfter = missing - planned;
  const shared = state.goals.filter((x) => x.accountId === g.accountId).length > 1;
  const pending = new Map(pendingConfirmations(state, today).map((e) => [e.key, e]));

  const plan = missing === 0 ? null
    : planned > 0
      ? (gapAfter > 0 ? `Com os aportes planejados, ainda faltam ${formatBRL(gapAfter)}.` : null)
      : days > 0 ? `Seriam ${formatBRL(Math.ceil(missing / Math.max(1, Math.ceil(days / 30))))} por mês até lá.` : null;

  const contributionRow = (c) => {
    const settled = state.settled[`contribution:${c.id}`];
    const done = settled && !settled.skipped;
    const due = pending.get(`contribution:${c.id}`);
    const sub = settled?.skipped
      ? h('span', { class: 'li-sub' }, 'Pulado')
      : done
      ? h('span', { class: 'li-sub pos' }, `Feito, saiu de ${store.getAccount(c.fromAccountId)?.name ?? 'conta excluída'}`)
      : due
        ? h('span', { class: 'li-sub warn-text' }, h('span', { class: 'status' }, icon('alert', { size: 15 }), 'A confirmar'))
        : h('span', { class: 'li-sub' }, relative(today, c.date));
    // aporte que já chegou na data abre a confirmação, como na tela Hoje
    const open = due ? () => confirmOccurrenceSheet(due) : () => editContribution(c);
    return h('li', {}, h('button', { class: 'list-item', onclick: open },
      h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, `Aporte em ${formatDayMonth(c.date, year)}`), sub),
      h('span', { class: 'li-end' }, h('span', { class: 'li-value' }, formatBRLShort(c.amount)), icon('chevron', { size: 18, cls: 'chev' }))));
  };

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'li-main' },
        h('h2', { class: 'card-title' }, g.name),
        h('span', { class: 'li-sub' }, `Até ${formatDayMonth(g.deadline, year)}`)),
      h('button', { class: 'icon-btn', 'aria-label': `Editar meta ${g.name}`, onclick: () => editGoal(g) }, icon('edit', { size: 20 }))),
    h('div', { class: 'row between baseline gap' },
      h('span', { class: 'stat-value', 'data-fit': true }, formatBRL(saved)),
      h('span', { class: 'muted small' }, `de ${formatBRLShort(g.target)}`)),
    h('div', { class: 'meter lg', role: 'progressbar', 'aria-label': 'Progresso da meta', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('span', { style: `width:${pct}%` })),
    h('div', { class: 'row between gap' },
      h('span', { class: 'small' }, missing > 0 ? `Faltam ${formatBRL(missing)}` : 'Meta atingida'),
      deadlineBadge(missing, days)),
    plan && h('p', { class: 'small muted' }, plan),
    shared && h('p', { class: 'caption' }, `${acc?.name} é usada por mais de uma meta; o progresso mostra o saldo total.`),
    h('div', { class: 'divided' },
      contribs.length > 0 && h('ul', { class: 'list' }, contribs.map(contributionRow)),
      addButton('Novo aporte', () => editContribution(null, g.id))));
}

function emptyState(ctx) {
  const hasGoalAccount = ctx.state.accounts.some((a) => a.kind === 'goal');
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Nenhuma meta ainda'),
    h('p', { class: 'small muted' }, 'Uma meta acompanha o saldo de uma conta de meta. Os aportes saem de uma conta de gasto e já descontam do orçamento.'),
    hasGoalAccount
      ? addButton('Nova meta', () => editGoal())
      : addButton('Criar conta de meta', () => editAccount(null, { kind: 'goal', onSaved: () => editGoal() })));
}

export function renderGoals(ctx) {
  const goals = [...ctx.state.goals].sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
  return h('div', { class: 'screen goals' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Metas')),
    goals.length ? goals.map((g) => goalCard(ctx, g)) : emptyState(ctx),
    goals.length > 0 && h('section', { class: 'card flush' }, addButton('Nova meta', () => editGoal())));
}
