// Formulários (em folha modal) e listas editáveis de contas, receitas,
// despesas fixas, metas e aportes. Usados no assistente inicial e em Ajustes.

import { h, sheet, toast, confirmDialog } from './dom.js';
import * as store from '../data/store.js';
import { formatBRL, formatBRLShort, parseBRL, toInput } from '../core/money.js';
import { todayISO, formatFull, isValidISO } from '../core/dates.js';

// ---------- campos ----------

export function field(label, input, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    input,
    hint && h('span', { class: 'field-hint' }, hint));
}

export function moneyInput(cents, attrs = {}) {
  return h('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00',
    value: cents == null ? '' : toInput(cents), ...attrs,
  });
}

function textInput(value, attrs = {}) {
  return h('input', { type: 'text', value: value ?? '', autocomplete: 'off', ...attrs });
}

function numberInput(value, attrs = {}) {
  return h('input', { type: 'number', inputmode: 'numeric', value: value ?? '', ...attrs });
}

function dateInput(value, attrs = {}) {
  return h('input', { type: 'date', value: value ?? '', ...attrs });
}

function select(options, value) {
  return h('select', {}, options.map(([v, label]) => h('option', { value: v, selected: v === value || undefined }, label)));
}

function checkbox(label, checked) {
  const input = h('input', { type: 'checkbox', checked });
  return { input, el: h('label', { class: 'check' }, input, h('span', {}, label)) };
}

function errorBox() {
  return h('p', { class: 'form-error', role: 'alert' });
}

function fail(box, msg) {
  box.textContent = msg;
  return false;
}

function actions(onDelete) {
  return h('div', { class: 'row gap form-actions' },
    onDelete && h('button', { type: 'button', class: 'btn ghost danger-text', onclick: onDelete }, 'Excluir'),
    h('button', { type: 'submit', class: 'btn primary grow' }, 'Salvar'));
}

function form(onSubmit, ...children) {
  return h('form', {
    class: 'form',
    onsubmit: (e) => { e.preventDefault(); onSubmit(); },
  }, ...children);
}

const accountOptions = (state, kind) =>
  state.accounts.filter((a) => !kind || a.kind === kind).map((a) => [a.id, a.name]);

// ---------- contas ----------

export function editAccount(account) {
  const isNew = !account;
  const a = account || { name: '', kind: 'spending', balance: 0 };
  const name = textInput(a.name, { placeholder: 'Ex.: Conta corrente' });
  const kind = select([['spending', 'Conta de gasto (entra no orçamento)'], ['goal', 'Conta de meta / investimento (fora do orçamento)']], a.kind);
  const balance = moneyInput(isNew ? null : a.balance);
  const err = errorBox();
  sheet(isNew ? 'Nova conta' : 'Editar conta', (close) => form(() => {
    if (!name.value.trim()) return fail(err, 'Dê um nome à conta.');
    const item = { ...a, name: name.value.trim(), kind: kind.value };
    if (isNew) {
      const v = balance.value.trim() === '' ? 0 : parseBRL(balance.value);
      if (Number.isNaN(v)) return fail(err, 'Saldo inválido.');
      item.balance = v;
    }
    store.upsert('accounts', item);
    close();
  },
  field('Nome', name),
  field('Tipo', kind),
  isNew ? field('Saldo atual', balance, 'Pode ser negativo (ex.: -50).')
    : h('p', { class: 'muted small' }, `Saldo: ${formatBRL(a.balance)} — para mudar, use “Ajustar saldo” em Contas.`),
  err,
  actions(!isNew && (async () => {
    const uses = store.accountUsage(a.id);
    if (uses.length) return fail(err, `Esta conta é usada por: ${uses.join(', ')}. Altere-os antes.`);
    if (await confirmDialog('Excluir conta?', `“${a.name}” será removida. As movimentações antigas continuam no histórico.`, 'Excluir', true)) {
      store.remove('accounts', a.id);
    }
  }))));
}

// ---------- exceções de valor por mês ----------

function exceptionsEditor(exceptions = {}) {
  const rows = h('div', { class: 'stack-sm' });
  const addRow = (month = '', cents = null) => {
    const m = h('input', { type: 'month', value: month });
    const v = moneyInput(cents);
    const row = h('div', { class: 'row gap exc-row' }, m, v,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remover', onclick: () => row.remove() }, '✕'));
    row._read = () => ({ month: m.value, cents: parseBRL(v.value) });
    rows.append(row);
  };
  Object.entries(exceptions).sort().forEach(([mk, c]) => addRow(mk, c));
  const el = h('div', { class: 'field' },
    h('span', { class: 'field-label' }, 'Valor diferente em um mês específico'),
    rows,
    h('button', { type: 'button', class: 'btn small ghost', onclick: () => addRow() }, '+ Adicionar exceção'));
  const read = () => {
    const out = {};
    for (const row of rows.children) {
      const { month, cents } = row._read();
      if (!month) continue;
      if (Number.isNaN(cents)) throw new Error(`Valor inválido na exceção de ${month}.`);
      out[month] = cents;
    }
    return out;
  };
  return { el, read };
}

// ---------- receitas ----------

export function describeRule(rule) {
  if (!rule) return '';
  if (rule.type === 'businessDay') return `${rule.n}º dia útil${rule.countSaturday ? ' (sábado conta)' : ''}`;
  return `todo dia ${rule.day}`;
}

export function editIncome(income) {
  const state = store.getState();
  if (!state.accounts.length) return toast('Cadastre uma conta primeiro.');
  const isNew = !income;
  const i = income || {
    name: '', amount: null, accountId: state.settings.defaultAccountId || state.accounts[0].id,
    isSalary: false, rule: { type: 'businessDay', n: 5, countSaturday: false }, exceptions: {}, since: todayISO(),
  };
  const name = textInput(i.name, { placeholder: 'Ex.: Salário' });
  const amount = moneyInput(i.amount);
  const account = select(accountOptions(state), i.accountId);
  const salary = checkbox('É o meu salário (o orçamento vai até a véspera dele)', i.isSalary);
  const ruleType = select([['businessDay', 'Nº dia útil do mês'], ['fixedDay', 'Dia fixo do mês']], i.rule.type);
  const n = numberInput(i.rule.type === 'businessDay' ? i.rule.n : 5, { min: 1, max: 23 });
  const day = numberInput(i.rule.type === 'fixedDay' ? i.rule.day : 10, { min: 1, max: 31 });
  const sat = checkbox('Contar sábado como dia útil (se cair no sábado, paga na sexta)', i.rule.countSaturday);
  const since = dateInput(i.since || todayISO());
  const exc = exceptionsEditor(i.exceptions);
  const nField = field('Qual dia útil', n);
  const dayField = field('Dia do mês', day, 'Em meses mais curtos, cai no último dia.');
  const sync = () => {
    const bd = ruleType.value === 'businessDay';
    nField.hidden = !bd; sat.el.hidden = !bd; dayField.hidden = bd;
  };
  ruleType.addEventListener('change', sync);
  sync();
  const err = errorBox();
  sheet(isNew ? 'Nova receita' : 'Editar receita', (close) => form(() => {
    if (!name.value.trim()) return fail(err, 'Dê um nome à receita.');
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v < 0) return fail(err, 'Informe o valor.');
    const rule = ruleType.value === 'businessDay'
      ? { type: 'businessDay', n: Number(n.value), countSaturday: sat.input.checked }
      : { type: 'fixedDay', day: Number(day.value) };
    if (rule.type === 'businessDay' && !(rule.n >= 1 && rule.n <= 23)) return fail(err, 'Dia útil deve ser de 1 a 23.');
    if (rule.type === 'fixedDay' && !(rule.day >= 1 && rule.day <= 31)) return fail(err, 'Dia deve ser de 1 a 31.');
    if (!isValidISO(since.value)) return fail(err, 'Data inicial inválida.');
    let exceptions;
    try { exceptions = exc.read(); } catch (e) { return fail(err, e.message); }
    store.upsert('incomes', {
      ...i, name: name.value.trim(), amount: v, accountId: account.value,
      isSalary: salary.input.checked, rule, exceptions, since: since.value,
    });
    close();
  },
  field('Nome', name),
  field('Valor padrão', amount),
  field('Cai na conta', account),
  salary.el,
  field('Quando cai', ruleType),
  nField, sat.el, dayField,
  exc.el,
  field('Considerar a partir de', since, 'Ocorrências antes desta data são ignoradas (já recebidas).'),
  err,
  actions(!isNew && (async () => {
    if (await confirmDialog('Excluir receita?', `“${i.name}” deixará de ser prevista.`, 'Excluir', true)) store.remove('incomes', i.id);
  }))));
}

// ---------- despesas fixas ----------

export function editExpense(expense) {
  const state = store.getState();
  const spending = accountOptions(state, 'spending');
  if (!spending.length) return toast('Cadastre uma conta de gasto primeiro.');
  const isNew = !expense;
  const e = expense || { name: '', amount: null, accountId: state.settings.defaultAccountId, day: 10, exceptions: {}, since: todayISO() };
  const name = textInput(e.name, { placeholder: 'Ex.: Fatura do cartão' });
  const amount = moneyInput(e.amount);
  const account = select(spending, e.accountId);
  const day = numberInput(e.day, { min: 1, max: 31 });
  const since = dateInput(e.since || todayISO());
  const exc = exceptionsEditor(e.exceptions);
  const err = errorBox();
  sheet(isNew ? 'Nova despesa fixa' : 'Editar despesa fixa', (close) => form(() => {
    if (!name.value.trim()) return fail(err, 'Dê um nome à despesa.');
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v < 0) return fail(err, 'Informe o valor.');
    const d = Number(day.value);
    if (!(d >= 1 && d <= 31)) return fail(err, 'Dia deve ser de 1 a 31.');
    if (!isValidISO(since.value)) return fail(err, 'Data inicial inválida.');
    let exceptions;
    try { exceptions = exc.read(); } catch (x) { return fail(err, x.message); }
    store.upsert('expenses', { ...e, name: name.value.trim(), amount: v, accountId: account.value, day: d, exceptions, since: since.value });
    close();
  },
  field('Nome', name),
  field('Valor', amount),
  field('Debitada da conta', account),
  field('Dia do vencimento', day),
  exc.el,
  field('Considerar a partir de', since, 'Use uma data depois do vencimento se a deste mês já foi paga.'),
  err,
  actions(!isNew && (async () => {
    if (await confirmDialog('Excluir despesa?', `“${e.name}” deixará de ser prevista.`, 'Excluir', true)) store.remove('expenses', e.id);
  }))));
}

// ---------- metas ----------

export function editGoal(goal) {
  const state = store.getState();
  const goalAccounts = accountOptions(state, 'goal');
  if (!goalAccounts.length) return toast('Cadastre antes uma conta do tipo “meta / investimento”.');
  const isNew = !goal;
  const g = goal || { name: '', target: null, deadline: '', accountId: goalAccounts[0][0] };
  const name = textInput(g.name, { placeholder: 'Ex.: Viagem' });
  const target = moneyInput(g.target);
  const deadline = dateInput(g.deadline);
  const account = select(goalAccounts, g.accountId);
  const err = errorBox();
  sheet(isNew ? 'Nova meta' : 'Editar meta', (close) => form(() => {
    if (!name.value.trim()) return fail(err, 'Dê um nome à meta.');
    const v = parseBRL(target.value);
    if (Number.isNaN(v) || v <= 0) return fail(err, 'Informe o valor alvo.');
    if (!isValidISO(deadline.value)) return fail(err, 'Informe a data alvo.');
    store.upsert('goals', { ...g, name: name.value.trim(), target: v, deadline: deadline.value, accountId: account.value });
    close();
  },
  field('Nome', name),
  field('Valor alvo', target),
  field('Até', deadline),
  field('Conta da meta', account, 'O progresso é o saldo desta conta.'),
  err,
  actions(!isNew && (async () => {
    if (await confirmDialog('Excluir meta?', `“${g.name}” e seus aportes planejados serão removidos.`, 'Excluir', true)) store.remove('goals', g.id);
  }))));
}

export function editContribution(contribution, goalId) {
  const state = store.getState();
  const isNew = !contribution;
  const c = contribution || { goalId, amount: null, date: todayISO(), fromAccountId: state.settings.defaultAccountId };
  const goal = state.goals.find((x) => x.id === c.goalId);
  const amount = moneyInput(c.amount);
  const date = dateInput(c.date);
  const from = select(accountOptions(state, 'spending'), c.fromAccountId);
  const err = errorBox();
  const settled = state.settled[`contribution:${c.id}`];
  sheet(isNew ? `Aporte em ${goal?.name ?? 'meta'}` : 'Editar aporte', (close) => form(() => {
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v <= 0) return fail(err, 'Informe o valor.');
    if (!isValidISO(date.value)) return fail(err, 'Informe a data.');
    store.upsert('contributions', { ...c, amount: v, date: date.value, fromAccountId: from.value });
    close();
  },
  settled && h('p', { class: 'muted small' }, 'Este aporte já foi feito. Para desfazer, exclua a movimentação em Contas.'),
  field('Valor', amount),
  field('Data', date),
  field('Sai da conta', from),
  err,
  actions(!isNew && (async () => {
    if (await confirmDialog('Excluir aporte planejado?', 'O aporte deixa de ser previsto.', 'Excluir', true)) store.remove('contributions', c.id);
  }))));
}

// ---------- operações ----------

export function adjustSheet(account) {
  const balance = moneyInput(account.balance);
  const err = errorBox();
  sheet(`Ajustar ${account.name}`, (close) => form(() => {
    const v = parseBRL(balance.value);
    if (Number.isNaN(v)) return fail(err, 'Valor inválido.');
    const t = store.adjustBalance(account.id, v);
    close();
    if (t) toast(`Saldo ajustado (${t.amount > 0 ? '+' : ''}${formatBRL(t.amount)})`);
  },
  h('p', { class: 'muted small' }, 'Informe o saldo que aparece no banco agora. A diferença fica registrada como ajuste.'),
  field('Saldo real', balance),
  err,
  h('button', { type: 'submit', class: 'btn primary block' }, 'Salvar saldo')));
}

export function transferSheet({ from, to, amount, title = 'Transferir', desc = '', note } = {}) {
  const state = store.getState();
  const opts = accountOptions(state);
  const fromSel = select(opts, from || state.settings.reserveAccountId || opts[0]?.[0]);
  const toSel = select(opts, to || state.settings.defaultAccountId || opts[1]?.[0]);
  const value = moneyInput(amount ?? null, { 'data-noautofocus': '1' });
  const err = errorBox();
  sheet(title, (close) => form(() => {
    const v = parseBRL(value.value);
    if (Number.isNaN(v) || v <= 0) return fail(err, 'Informe o valor.');
    if (fromSel.value === toSel.value) return fail(err, 'Escolha contas diferentes.');
    store.transfer(fromSel.value, toSel.value, v, desc);
    close();
    toast(`${formatBRL(v)} transferidos`);
  },
  note && h('p', { class: 'muted small' }, note),
  field('Valor', value),
  field('De', fromSel),
  field('Para', toSel),
  h('p', { class: 'muted small' }, 'Transferência entre contas não é gasto.'),
  err,
  h('button', { type: 'submit', class: 'btn primary block' }, 'Confirmar transferência')));
}

const CONFIRM_TITLES = { income: 'Recebeu?', expense: 'Pagou?', contribution: 'Fez o aporte?' };

export function confirmOccurrenceSheet(event) {
  const today = todayISO();
  const amount = moneyInput(event.amount, { 'data-noautofocus': '1' });
  const date = dateInput(event.date <= today ? event.date : today, { max: today });
  const err = errorBox();
  const acc = store.getAccount(event.accountId);
  const where = event.kind === 'income' ? `Entra em ${acc?.name ?? '—'}`
    : event.kind === 'expense' ? `Sai de ${acc?.name ?? '—'}`
      : `De ${acc?.name ?? '—'} para ${store.getAccount(event.toAccountId)?.name ?? '—'}`;
  sheet(`${event.name} — ${CONFIRM_TITLES[event.kind]}`, (close) => form(() => {
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v < 0) return fail(err, 'Valor inválido.');
    if (!isValidISO(date.value) || date.value > today) return fail(err, 'Data inválida.');
    store.confirmOccurrence(event, { amount: v, date: date.value });
    close();
    toast(`${event.name}: ${formatBRL(v)} registrado`);
  },
  h('p', { class: 'muted small' }, `Previsto para ${formatFull(event.date)}. ${where}.`),
  field('Valor', amount),
  field('Data', date),
  err,
  h('div', { class: 'row gap' },
    h('button', {
      type: 'button', class: 'btn ghost grow',
      onclick: () => { store.skipOccurrence(event); close(); toast('Marcado como “não veio este mês”'); },
    }, event.kind === 'income' ? 'Não veio' : 'Pular este mês'),
    h('button', { type: 'submit', class: 'btn primary grow' }, 'Confirmar'))));
}

// ---------- listas editáveis ----------

function listCard(title, items, emptyText, onAdd, addLabel) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, title)),
    items.length ? h('ul', { class: 'list' }, items) : h('p', { class: 'muted small' }, emptyText),
    h('button', { class: 'btn ghost block', onclick: onAdd }, addLabel));
}

function item(main, sub, value, onclick) {
  return h('li', {},
    h('button', { class: 'list-item', onclick },
      h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, main), sub && h('span', { class: 'li-sub' }, sub)),
      value != null && h('span', { class: 'li-value' }, value),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
}

export function accountsList(state) {
  const roles = (a) => [
    a.kind === 'goal' ? 'meta / investimento' : 'gasto',
    a.id === state.settings.defaultAccountId && 'padrão dos gastos',
    a.id === state.settings.reserveAccountId && 'reserva p/ resgates',
  ].filter(Boolean).join(' · ');
  return listCard('Contas',
    state.accounts.map((a) => item(a.name, roles(a), formatBRL(a.balance), () => editAccount(a))),
    'Nenhuma conta ainda.', () => editAccount(), '+ Adicionar conta');
}

export function incomesList(state) {
  const accName = (id) => state.accounts.find((a) => a.id === id)?.name ?? '—';
  return listCard('Receitas',
    state.incomes.map((i) => item(i.name + (i.isSalary ? ' ★' : ''), `${describeRule(i.rule)} · ${accName(i.accountId)}`,
      formatBRLShort(i.amount), () => editIncome(i))),
    'Nenhuma receita ainda.', () => editIncome(), '+ Adicionar receita');
}

export function expensesList(state) {
  const accName = (id) => state.accounts.find((a) => a.id === id)?.name ?? '—';
  return listCard('Despesas fixas',
    state.expenses.map((e) => item(e.name, `todo dia ${e.day} · ${accName(e.accountId)}`, formatBRLShort(e.amount), () => editExpense(e))),
    'Nenhuma despesa fixa.', () => editExpense(), '+ Adicionar despesa');
}

export function goalsList(state) {
  return listCard('Metas',
    state.goals.map((g) => item(g.name, `até ${formatFull(g.deadline)}`, formatBRLShort(g.target), () => editGoal(g))),
    'Nenhuma meta.', () => editGoal(), '+ Adicionar meta');
}

export function contributionsList(state) {
  const goals = new Map(state.goals.map((g) => [g.id, g]));
  const sorted = [...state.contributions].sort((a, b) => (a.date < b.date ? -1 : 1));
  return listCard('Aportes planejados',
    sorted.map((c) => item(goals.get(c.goalId)?.name ?? '—', formatFull(c.date), formatBRLShort(c.amount), () => editContribution(c))),
    state.goals.length ? 'Nenhum aporte planejado.' : 'Crie uma meta para planejar aportes.',
    () => (state.goals.length ? pickGoalThenContribution(state) : toast('Crie uma meta primeiro.')), '+ Planejar aporte');
}

function pickGoalThenContribution(state) {
  if (state.goals.length === 1) return editContribution(null, state.goals[0].id);
  sheet('Para qual meta?', () => h('ul', { class: 'list' },
    state.goals.map((g) => item(g.name, null, null, () => editContribution(null, g.id)))));
}
