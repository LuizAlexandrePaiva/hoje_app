// Formulários (em folha modal) e listas editáveis de contas, receitas,
// despesas fixas, metas e aportes. Usados no assistente inicial e em Ajustes.

import { h, sheet, toast, confirmDialog } from './dom.js';
import { icon } from './icons.js';
import * as store from '../data/store.js';
import { formatBRL, formatBRLShort, parseBRL, toInput } from '../core/money.js';
import { todayISO, formatFull, formatShort, formatDayMonth, isValidISO, addDays } from '../core/dates.js';
import { MAX_MOVE_DAYS } from '../core/schedule.js';

// ---------- campos ----------

export function field(label, input, hint) {
  const control = input.dataset?.money ? h('span', { class: 'money' }, input) : input;
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint && h('span', { class: 'field-hint' }, hint));
}

export function moneyInput(cents, attrs = {}) {
  return h('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', 'data-money': '1',
    value: cents == null ? '' : toInput(cents), ...attrs,
  });
}

function textInput(value, attrs = {}) {
  return h('input', { type: 'text', value: value ?? '', autocomplete: 'off', autocapitalize: 'sentences', ...attrs });
}

function numberInput(value, attrs = {}) {
  return h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: value ?? '', ...attrs });
}

function dateInput(value, attrs = {}) {
  return h('input', { type: 'date', value: value ?? '', ...attrs });
}

function select(options, value) {
  return h('select', {}, options.map(([v, label]) => h('option', { value: v, selected: v === value || undefined }, label)));
}

/** Linha com chave liga/desliga: título + explicação curta. */
export function switchRow(title, sub, checked) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked });
  const el = h('label', { class: 'switch-row' },
    h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, title), sub && h('span', { class: 'li-sub' }, sub)),
    h('span', { class: 'switch' }, input, h('span')));
  return { el, input };
}

/** Controle segmentado (2 ou 3 opções). */
function segmented(options, value, onChange) {
  let current = value;
  const buttons = options.map(([v, label]) => h('button', {
    type: 'button', 'aria-pressed': String(v === value),
    onclick: () => {
      current = v;
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === v)));
      onChange?.(v);
    },
  }, label));
  return { el: h('div', { class: 'segmented', role: 'group' }, buttons), get value() { return current; } };
}

/** Campo numérico curto alinhado à direita do rótulo. */
export function inlineField(title, input, sub) {
  return h('label', { class: 'inline-field' },
    h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, title), sub && h('span', { class: 'li-sub' }, sub)),
    input);
}

function more(label, ...children) {
  return h('details', { class: 'more' }, h('summary', {}, label), h('div', {}, ...children));
}

function errorBox() {
  return h('p', { class: 'form-error', role: 'alert' });
}

function fail(box, msg) {
  box.textContent = msg;
  return false;
}

function actions(onDelete, saveLabel = 'Salvar') {
  return h('div', { class: 'form-actions' },
    onDelete && h('button', { type: 'button', class: 'btn danger-text', onclick: onDelete }, icon('trash', { size: 20 }), 'Excluir'),
    h('button', { type: 'submit', class: 'btn primary' }, saveLabel));
}

function form(onSubmit, ...children) {
  return h('form', {
    class: 'form', novalidate: true,
    onsubmit: (e) => { e.preventDefault(); onSubmit(); },
  }, ...children);
}

const accountOptions = (state, kind) =>
  state.accounts.filter((a) => !kind || a.kind === kind).map((a) => [a.id, a.name]);

// ---------- contas ----------

const KIND_HINT = {
  spending: 'Entra no orçamento do dia.',
  goal: 'Fica fora do orçamento (metas e investimentos).',
};

export function editAccount(account) {
  const isNew = !account;
  const a = account || { name: '', kind: 'spending', balance: 0 };
  const name = textInput(a.name, { placeholder: 'Ex.: Conta corrente' });
  const kindHint = h('span', { class: 'field-hint' }, KIND_HINT[a.kind]);
  const kind = segmented([['spending', 'De gasto'], ['goal', 'De meta']], a.kind, (v) => { kindHint.textContent = KIND_HINT[v]; });
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
  h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tipo'), kind.el, kindHint),
  isNew
    ? field('Saldo hoje', balance, 'Negativo? Use o sinal de menos.')
    : h('p', { class: 'field-hint' }, `Saldo atual: ${formatBRL(a.balance)}. Para corrigir, use “Ajustar” na aba Contas.`),
  err,
  actions(!isNew && (async () => {
    const uses = store.accountUsage(a.id);
    if (uses.length) return fail(err, `Em uso por: ${uses.join(', ')}.`);
    if (await confirmDialog('Excluir conta?', `“${a.name}” sai da lista. O histórico continua.`, 'Excluir', true)) {
      store.remove('accounts', a.id);
    }
  }))));
}

// ---------- exceções de valor por mês ----------

function exceptionsEditor(exceptions = {}) {
  const rows = h('div', { class: 'stack-sm' });
  const addRow = (month = '', cents = null) => {
    const m = h('input', { type: 'month', value: month, 'aria-label': 'Mês' });
    const v = moneyInput(cents, { 'aria-label': 'Valor no mês' });
    const row = h('div', { class: 'exc-row' }, m, h('span', { class: 'money' }, v),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remover exceção', onclick: () => row.remove() }, icon('close', { size: 18 })));
    row._read = () => ({ month: m.value, cents: parseBRL(v.value) });
    rows.append(row);
  };
  Object.entries(exceptions).sort().forEach(([mk, c]) => addRow(mk, c));
  const el = h('div', { class: 'field' },
    h('span', { class: 'field-label' }, 'Valor diferente em um mês'),
    rows,
    h('button', { type: 'button', class: 'btn-add', onclick: () => addRow() }, icon('plus', { size: 18 }), 'Adicionar mês'));
  const read = () => {
    const out = {};
    for (const row of rows.children) {
      const { month, cents } = row._read();
      if (!month) continue;
      if (Number.isNaN(cents)) throw new Error('Confira o valor das exceções.');
      out[month] = cents;
    }
    return out;
  };
  return { el, read };
}

// ---------- receitas ----------

export function describeRule(rule) {
  if (!rule) return '';
  if (rule.type === 'businessDay') return `${rule.n}º dia útil`;
  return `Dia ${rule.day}`;
}

export function editIncome(income) {
  const state = store.getState();
  if (!state.accounts.length) return toast('Cadastre uma conta antes.');
  const isNew = !income;
  const i = income || {
    name: '', amount: null, accountId: state.settings.defaultAccountId || state.accounts[0].id,
    isSalary: false, rule: { type: 'businessDay', n: 5, countSaturday: false }, exceptions: {}, since: todayISO(),
  };
  const name = textInput(i.name, { placeholder: 'Ex.: Salário' });
  const amount = moneyInput(i.amount);
  const account = select(accountOptions(state), i.accountId);
  const n = numberInput(i.rule.type === 'businessDay' ? i.rule.n : 5, { maxlength: 2, 'aria-label': 'Qual dia útil' });
  const day = numberInput(i.rule.type === 'fixedDay' ? i.rule.day : 10, { maxlength: 2, 'aria-label': 'Dia do mês' });
  const sat = switchRow('Sábado conta como dia útil', 'Se cair no sábado, recebe na sexta.', i.rule.countSaturday);
  const salary = switchRow('É o salário', 'O orçamento vai até a véspera dele.', i.isSalary);
  const since = dateInput(i.since || todayISO());
  const exc = exceptionsEditor(i.exceptions);
  const nRow = inlineField('Qual dia útil', n, 'Desconta fins de semana e feriados.');
  const dayRow = inlineField('Dia do mês', day, 'Em meses curtos, o último dia.');
  const sync = (type) => {
    const bd = type === 'businessDay';
    nRow.hidden = !bd; sat.el.hidden = !bd; dayRow.hidden = bd;
  };
  const ruleType = segmented([['businessDay', 'Dia útil'], ['fixedDay', 'Dia fixo']], i.rule.type, sync);
  sync(i.rule.type);
  const err = errorBox();
  sheet(isNew ? 'Nova receita' : 'Editar receita', (close) => form(() => {
    if (!name.value.trim()) return fail(err, 'Dê um nome à receita.');
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v < 0) return fail(err, 'Informe o valor.');
    const rule = ruleType.value === 'businessDay'
      ? { type: 'businessDay', n: Number(n.value), countSaturday: sat.input.checked }
      : { type: 'fixedDay', day: Number(day.value) };
    if (rule.type === 'businessDay' && !(rule.n >= 1 && rule.n <= 23)) return fail(err, 'O dia útil vai de 1 a 23.');
    if (rule.type === 'fixedDay' && !(rule.day >= 1 && rule.day <= 31)) return fail(err, 'O dia vai de 1 a 31.');
    if (!isValidISO(since.value)) return fail(err, 'Confira a data de início.');
    let exceptions;
    try { exceptions = exc.read(); } catch (e) { return fail(err, e.message); }
    store.upsert('incomes', {
      ...i, name: name.value.trim(), amount: v, accountId: account.value,
      isSalary: salary.input.checked, rule, exceptions, since: since.value,
    });
    close();
  },
  field('Nome', name),
  h('div', { class: 'field-row' }, field('Valor', amount), field('Cai em', account)),
  h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Quando cai'), ruleType.el),
  nRow, dayRow, sat.el, salary.el,
  more('Mais opções', exc.el, field('Contar a partir de', since, 'Datas anteriores são ignoradas.')),
  err,
  actions(!isNew && (async () => {
    if (await confirmDialog('Excluir receita?', `“${i.name}” deixa de ser prevista.`, 'Excluir', true)) store.remove('incomes', i.id);
  }))));
}

// ---------- despesas fixas ----------

export function editExpense(expense) {
  const state = store.getState();
  const spending = accountOptions(state, 'spending');
  if (!spending.length) return toast('Cadastre uma conta de gasto antes.');
  const isNew = !expense;
  const e = expense || { name: '', amount: null, accountId: state.settings.defaultAccountId, day: 10, exceptions: {}, since: todayISO() };
  const name = textInput(e.name, { placeholder: 'Ex.: Fatura do cartão' });
  const amount = moneyInput(e.amount);
  const account = select(spending, e.accountId);
  const day = numberInput(e.day, { maxlength: 2, 'aria-label': 'Dia do vencimento' });
  const since = dateInput(e.since || todayISO());
  const exc = exceptionsEditor(e.exceptions);
  const err = errorBox();
  sheet(isNew ? 'Nova despesa fixa' : 'Editar despesa fixa', (close) => form(() => {
    if (!name.value.trim()) return fail(err, 'Dê um nome à despesa.');
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v < 0) return fail(err, 'Informe o valor.');
    const d = Number(day.value);
    if (!(d >= 1 && d <= 31)) return fail(err, 'O dia vai de 1 a 31.');
    if (!isValidISO(since.value)) return fail(err, 'Confira a data de início.');
    let exceptions;
    try { exceptions = exc.read(); } catch (x) { return fail(err, x.message); }
    store.upsert('expenses', { ...e, name: name.value.trim(), amount: v, accountId: account.value, day: d, exceptions, since: since.value });
    close();
  },
  field('Nome', name),
  h('div', { class: 'field-row' }, field('Valor', amount), field('Sai de', account)),
  inlineField('Dia do vencimento', day),
  more('Mais opções', exc.el, field('Contar a partir de', since, 'Já pagou a deste mês? Use uma data após o vencimento.')),
  err,
  actions(!isNew && (async () => {
    if (await confirmDialog('Excluir despesa?', `“${e.name}” deixa de ser prevista.`, 'Excluir', true)) store.remove('expenses', e.id);
  }))));
}

// ---------- metas ----------

export function editGoal(goal) {
  const state = store.getState();
  const goalAccounts = accountOptions(state, 'goal');
  if (!goalAccounts.length) return toast('Crie antes uma conta do tipo “de meta”.');
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
    if (Number.isNaN(v) || v <= 0) return fail(err, 'Informe quanto quer juntar.');
    if (!isValidISO(deadline.value)) return fail(err, 'Informe o prazo.');
    store.upsert('goals', { ...g, name: name.value.trim(), target: v, deadline: deadline.value, accountId: account.value });
    close();
  },
  field('Nome', name),
  h('div', { class: 'field-row' }, field('Quanto juntar', target), field('Até', deadline)),
  field('Conta da meta', account, 'O progresso é o saldo desta conta.'),
  err,
  actions(!isNew && (async () => {
    if (await confirmDialog('Excluir meta?', `“${g.name}” e os aportes planejados serão removidos.`, 'Excluir', true)) store.remove('goals', g.id);
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
  const done = state.settled[`contribution:${c.id}`];
  sheet(isNew ? 'Planejar aporte' : 'Editar aporte', (close) => form(() => {
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v <= 0) return fail(err, 'Informe o valor.');
    if (!isValidISO(date.value)) return fail(err, 'Informe a data.');
    store.upsert('contributions', { ...c, amount: v, date: date.value, fromAccountId: from.value });
    close();
  },
  h('p', { class: 'sheet-lead' }, done ? 'Este aporte já foi feito. Para desfazer, exclua a movimentação em Contas.' : `Para ${goal?.name ?? 'a meta'}. Já sai do orçamento na data.`),
  h('div', { class: 'field-row' }, field('Valor', amount), field('Data', date)),
  field('Sai de', from),
  err,
  actions(!isNew && (async () => {
    if (await confirmDialog('Excluir aporte?', 'Ele deixa de ser previsto.', 'Excluir', true)) store.remove('contributions', c.id);
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
    toast(t ? `Saldo ajustado (${t.amount > 0 ? '+' : '−'}${formatBRL(Math.abs(t.amount))})` : 'Saldo já estava certo');
  },
  h('p', { class: 'sheet-lead' }, 'Digite o saldo que o banco mostra agora.'),
  field('Saldo real', balance),
  err,
  actions(null, 'Salvar saldo')));
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
  h('p', { class: 'sheet-lead' }, note || 'Transferências não contam como gasto.'),
  field('Valor', value),
  h('div', { class: 'field-row' }, field('De', fromSel), field('Para', toSel)),
  err,
  actions(null, 'Confirmar')));
}

const CONFIRM = {
  income: { title: 'Recebeu?', ok: 'Confirmar recebimento', skip: 'Não veio', where: 'Entra em', early: 'Já recebi' },
  expense: { title: 'Pagou?', ok: 'Confirmar pagamento', skip: 'Pular este mês', where: 'Sai de', early: 'Já paguei' },
  contribution: { title: 'Fez o aporte?', ok: 'Confirmar aporte', skip: 'Pular', where: 'Sai de', early: 'Já aportei' },
};

const yearOf = (d) => Number(d.slice(0, 4));

/** Detalhes de um evento previsto: confirmar agora ou mudar a data. */
export function eventSheet(event) {
  const cfg = CONFIRM[event.kind];
  const ref = yearOf(todayISO());
  const moved = event.originalDate && event.date !== event.originalDate;
  sheet(event.name, () => [
    h('div', { class: 'stat' },
      h('span', { class: 'stat-label' }, `Previsto para ${formatDayMonth(event.date, ref)}${moved ? `, antes ${formatDayMonth(event.originalDate, ref)}` : ''}`),
      h('span', { class: `stat-value ${event.kind === 'income' ? 'pos' : ''}`, style: 'font-size:1.75rem', 'data-fit': true }, formatBRL(event.amount))),
    h('button', { class: 'btn primary block', onclick: () => confirmOccurrenceSheet(event) }, cfg.early),
    h('button', { class: 'btn block', onclick: () => moveSheet(event) }, 'Mudar a data'),
  ]);
}

/** Receita que vai cair antes ou depois, conta adiada, aporte em outro dia. */
export function moveSheet(event) {
  const today = todayISO();
  const cfg = CONFIRM[event.kind];
  const ref = yearOf(today);
  const base = event.originalDate || event.date;
  const isContribution = event.kind === 'contribution';
  const earliest = isContribution ? today : [today, addDays(base, -MAX_MOVE_DAYS)].sort()[1];
  const latest = isContribution ? null : addDays(base, MAX_MOVE_DAYS);
  const date = dateInput(event.date > today ? event.date : today, { min: earliest, max: latest, 'data-noautofocus': '1' });
  const err = errorBox();
  const moved = !isContribution && event.date !== base;
  sheet('Mudar a data', (close) => form(() => {
    const d = date.value;
    if (!isValidISO(d) || d < earliest) return fail(err, `Escolha de hoje em diante. Se já aconteceu, use “${cfg.early}”.`);
    if (latest && d > latest) return fail(err, `Até ${formatDayMonth(latest, ref)}. Se não vier, use “${cfg.skip}”.`);
    store.moveOccurrence(event, d);
    close();
    toast(`${event.name}: ${formatDayMonth(d, ref)}`);
  },
  h('p', { class: 'sheet-lead' }, `${event.name} estava previsto para ${formatDayMonth(event.date, ref)}. O limite do dia passa a contar com a nova data.`),
  field('Nova data', date),
  moved && h('button', {
    type: 'button', class: 'btn quiet block',
    onclick: () => { store.moveOccurrence(event, base); close(); toast(`${event.name}: ${formatDayMonth(base, ref)}`); },
  }, `Voltar para ${formatDayMonth(base, ref)}`),
  err,
  actions(null, 'Salvar data')));
}

export function confirmOccurrenceSheet(event) {
  const today = todayISO();
  const cfg = CONFIRM[event.kind];
  const amount = moneyInput(event.amount, { 'data-noautofocus': '1' });
  const date = dateInput(event.date <= today ? event.date : today, { max: today });
  const err = errorBox();
  const acc = store.getAccount(event.accountId);
  sheet(`${event.name}: ${cfg.title.toLowerCase()}`, (close) => form(() => {
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v < 0) return fail(err, 'Valor inválido.');
    if (!isValidISO(date.value) || date.value > today) return fail(err, 'A data não pode ser futura.');
    store.confirmOccurrence(event, { amount: v, date: date.value });
    close();
    toast(`${event.name}: ${formatBRL(v)} registrado`);
  },
  h('p', { class: 'sheet-lead' }, `Previsto para ${formatShort(event.date)}. ${cfg.where} ${acc?.name ?? 'conta excluída'}.`),
  h('div', { class: 'field-row' }, field('Valor', amount), field('Data', date)),
  err,
  h('div', { class: 'form-actions' },
    h('button', {
      type: 'button', class: 'btn',
      onclick: () => { store.skipOccurrence(event); close(); toast(`${event.name}: marcado como não ocorrido`); },
    }, cfg.skip),
    h('button', { type: 'submit', class: 'btn primary' }, cfg.ok)),
  h('button', { type: 'button', class: 'btn quiet block', onclick: () => moveSheet(event) }, 'Vai ser em outro dia')));
}

// ---------- listas editáveis ----------

export function addButton(label, onclick) {
  return h('button', { class: 'btn-add', onclick }, icon('plus', { size: 18 }), label);
}

function listCard(title, items, emptyText, onAdd, addLabel) {
  return h('section', { class: 'card flush' },
    title && h('div', { class: 'card-head', style: 'padding-top:12px' }, h('h3', { class: 'card-title' }, title)),
    items.length ? h('ul', { class: 'list' }, items) : h('p', { class: 'empty' }, emptyText),
    addButton(addLabel, onAdd));
}

export function listItem(main, sub, value, onclick, badge) {
  return h('li', {},
    h('button', { class: 'list-item', onclick },
      h('span', { class: 'li-main' },
        h('span', { class: 'row gap-sm' }, h('span', { class: 'li-title' }, main), badge),
        sub && h('span', { class: 'li-sub' }, sub)),
      h('span', { class: 'li-end' },
        value != null && h('span', { class: 'li-value' }, value),
        icon('chevron', { size: 18, cls: 'chev' }))));
}

const accName = (state, id) => state.accounts.find((a) => a.id === id)?.name ?? 'conta excluída';
// a conta só é citada quando não é a padrão dos gastos
const withAccount = (state, text, id) => (id === state.settings.defaultAccountId ? text : `${text}, ${accName(state, id)}`);

export function accountsList(state, title = 'Contas') {
  const role = (a) => (a.id === state.settings.defaultAccountId ? 'Padrão dos gastos'
    : a.id === state.settings.reserveAccountId ? 'Reserva' : a.kind === 'goal' ? 'De meta' : 'De gasto');
  return listCard(title,
    state.accounts.map((a) => listItem(a.name, role(a), formatBRL(a.balance), () => editAccount(a))),
    'Nenhuma conta ainda.', () => editAccount(), 'Adicionar conta');
}

export function incomesList(state, title = 'Receitas') {
  return listCard(title,
    state.incomes.map((i) => listItem(i.name, withAccount(state, describeRule(i.rule), i.accountId),
      formatBRLShort(i.amount), () => editIncome(i), i.isSalary && h('span', { class: 'badge pos' }, 'Salário'))),
    'Nenhuma receita ainda.', () => editIncome(), 'Adicionar receita');
}

export function expensesList(state, title = 'Despesas fixas') {
  return listCard(title,
    state.expenses.map((e) => listItem(e.name, withAccount(state, `Dia ${e.day}`, e.accountId), formatBRLShort(e.amount), () => editExpense(e))),
    'Nenhuma despesa fixa.', () => editExpense(), 'Adicionar despesa');
}

export function goalsList(state, title = 'Metas') {
  const year = Number(todayISO().slice(0, 4));
  return listCard(title,
    state.goals.map((g) => listItem(g.name, `Até ${formatDayMonth(g.deadline, year)}`, formatBRLShort(g.target), () => editGoal(g))),
    'Nenhuma meta.', () => editGoal(), 'Adicionar meta');
}

export function contributionsList(state, title = 'Aportes planejados') {
  const goals = new Map(state.goals.map((g) => [g.id, g]));
  const year = Number(todayISO().slice(0, 4));
  const sorted = [...state.contributions].sort((a, b) => (a.date < b.date ? -1 : 1));
  return listCard(title,
    sorted.map((c) => listItem(goals.get(c.goalId)?.name ?? 'Meta excluída', formatDayMonth(c.date, year), formatBRLShort(c.amount), () => editContribution(c))),
    state.goals.length ? 'Nenhum aporte planejado.' : 'Crie uma meta para planejar aportes.',
    () => (state.goals.length ? pickGoalThenContribution(state) : toast('Crie uma meta antes.')), 'Planejar aporte');
}

function pickGoalThenContribution(state) {
  if (state.goals.length === 1) return editContribution(null, state.goals[0].id);
  sheet('Para qual meta?', () => h('ul', { class: 'list' },
    state.goals.map((g) => listItem(g.name, `Até ${formatFull(g.deadline)}`, null, () => editContribution(null, g.id)))));
}
