// Formulários (em folha modal) e listas editáveis de contas, receitas,
// despesas fixas, metas e aportes. Usados no assistente inicial e em Ajustes.

import { h, sheet, closeSheet, toast, confirmDialog, afterSheetClosed, joinList, amount as moneyText } from './dom.js';
import { icon } from './icons.js';
import * as store from '../data/store.js';
import { formatBRL, formatBRLShort, formatSigned, formatPercent, parseBRL, toInput } from '../core/money.js';
import { todayISO, formatDayMonth, formatMonth, shiftMonth, monthKey, relative, isValidISO, addDays, TIME_ZONE } from '../core/dates.js';
import { MAX_MOVE_DAYS, occurrenceByKey, currentInvoices } from '../core/schedule.js';
import { invoiceKey, parseInvoiceKey } from '../core/invoice.js';
import { computeDailyBudget, withDelta } from '../core/budget.js';
import { suggestRefill } from '../core/refill.js';
import { SAVINGS, openSavings, suggestSaving } from '../core/savings.js';

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

/**
 * Campo numérico curto alinhado à direita do rótulo. `unit` aparece dentro do
 * campo, depois do número ("dias") ou antes, com `prefix` ("R$").
 */
export function inlineField(title, input, sub, { unit, prefix = false } = {}) {
  const control = unit ? h('span', { class: `unit ${prefix ? 'prefix' : ''}`, 'data-unit': unit }, input) : input;
  return h('label', { class: 'inline-field' },
    h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, title), sub && h('span', { class: 'li-sub' }, sub)),
    control);
}

function more(label, ...children) {
  return h('details', { class: 'more' }, h('summary', {}, label), h('div', {}, ...children));
}

export function errorBox() {
  return h('p', { class: 'form-error', role: 'alert' });
}

/**
 * Mostra o erro. Com `input`, a mensagem vai para logo abaixo do campo, o campo
 * fica marcado como inválido e recebe o foco; sem `input`, fica no fim do formulário.
 */
export function fail(box, msg, input) {
  if (box._input) {
    box._input.removeAttribute('aria-invalid');
    box._input.removeAttribute('aria-describedby');
    box._input = null;
  }
  if (!box._home && box.parentNode) box._home = { parent: box.parentNode, next: box.nextSibling };
  if (input) {
    if (!box.id) box.id = `erro-${Math.random().toString(36).slice(2, 8)}`;
    const holder = input.closest('.field, .inline-field');
    if (holder) holder.append(box);
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', box.id);
    box._input = input;
    input.focus();
    input.addEventListener('input', () => {
      if (box._input !== input) return;
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      box._input = null;
      box.textContent = '';
    }, { once: true });
  } else if (box._home && box.parentNode !== box._home.parent) {
    box._home.parent.insertBefore(box, box._home.next);
  }
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

export function editAccount(account, { draft, kind: presetKind, onSaved } = {}) {
  const isNew = !account;
  const a = account || { name: '', kind: presetKind || 'spending', balance: 0, ...draft };
  const name = textInput(a.name, { placeholder: 'Ex.: Conta corrente' });
  const kindHint = h('span', { class: 'field-hint' }, KIND_HINT[a.kind]);
  const kind = segmented([['spending', 'De gasto'], ['goal', 'De meta']], a.kind, (v) => { kindHint.textContent = KIND_HINT[v]; });
  const balance = moneyInput(isNew ? null : a.balance);
  const err = errorBox();
  sheet(isNew ? 'Nova conta' : 'Editar conta', (close) => form(() => {
    if (!name.value.trim()) return fail(err, 'Dê um nome à conta.', name);
    const item = { ...a, name: name.value.trim(), kind: kind.value };
    if (isNew) {
      const v = balance.value.trim() === '' ? 0 : parseBRL(balance.value);
      if (Number.isNaN(v)) return fail(err, 'Use só números, como 1.250,00 ou -80.', balance);
      item.balance = v;
    }
    const saved = store.upsert('accounts', item);
    if (onSaved) afterSheetClosed(() => onSaved(saved)); else close();
  },
  field('Nome', name),
  h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tipo'), kind.el, kindHint),
  isNew
    ? field('Saldo hoje', balance, 'Negativo? Use o sinal de menos.')
    : h('p', { class: 'field-hint' }, `Saldo atual: ${formatBRL(a.balance)}. Para corrigir, use “Ajustar saldo” na ficha da conta.`),
  err,
  actions(!isNew && (() => deleteAccount(a, (msg) => fail(err, msg))))));
}

/** Exclui uma conta, se nada depender dela. `onBlocked` recebe o motivo. */
export async function deleteAccount(a, onBlocked = toast) {
  const uses = store.accountUsage(a.id);
  if (uses.length) return onBlocked(`Esta conta é usada por ${joinList(uses)}. Troque a conta deles para poder excluir.`);
  if (await confirmDialog('Excluir conta?', `“${a.name}” sai da lista. O histórico continua.`, 'Excluir', true)) {
    store.remove('accounts', a.id);
    toast('Conta excluída');
  }
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
      if (Number.isNaN(cents)) throw new Error('Em “Valor diferente em um mês”, use só números, como 2.800,00.');
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
  if (rule.type === 'once') return `Uma vez, ${formatDayMonth(rule.date, yearOf(todayISO()))}`;
  return `Dia ${rule.day}`;
}

/**
 * Formulário de receita. `draft` pré-preenche uma receita nova (por exemplo,
 * agendar uma receita única a partir da tela de lançamento); `onSaved` roda após salvar.
 */
export function editIncome(income, { draft, onSaved } = {}) {
  const state = store.getState();
  if (!state.accounts.length) return toast('Cadastre uma conta antes.');
  const isNew = !income;
  const today = todayISO();
  const i = income || {
    name: '', amount: null, accountId: state.settings.defaultAccountId || state.accounts[0].id,
    isSalary: false, rule: { type: 'businessDay', n: 5, countSaturday: false }, exceptions: {}, since: today,
    ...draft,
  };
  const onceDate = dateInput(i.rule.type === 'once' ? i.rule.date : addDays(today, 1), { min: today, 'data-noautofocus': '1' });
  const onceRow = field('Data', onceDate, 'Entra no limite do dia a partir dessa data.');
  const name = textInput(i.name, { placeholder: 'Ex.: Salário' });
  const amount = moneyInput(i.amount);
  const account = select(accountOptions(state), i.accountId);
  const n = numberInput(i.rule.type === 'businessDay' ? i.rule.n : 5, { maxlength: 2, 'aria-label': 'Qual dia útil' });
  const day = numberInput(i.rule.type === 'fixedDay' ? i.rule.day : 10, { maxlength: 2, 'aria-label': 'Dia do mês' });
  const sat = switchRow('Sábado conta como dia útil', 'Se cair no sábado, recebe na sexta.', i.rule.countSaturday);
  const salary = switchRow('É o salário', 'A linha do tempo vai até um mês depois dele.', i.isSalary);
  const since = dateInput(i.since || todayISO());
  const exc = exceptionsEditor(i.exceptions);
  const nRow = inlineField('Qual dia útil', n, 'Desconta fins de semana e feriados.');
  const dayRow = inlineField('Dia do mês', day, 'Em meses curtos, o último dia.');
  const moreOpts = more('Mais opções', exc.el, field('Contar a partir de', since, 'Datas anteriores são ignoradas.'));
  const recurring = [salary.el, moreOpts];
  const sync = (type) => {
    nRow.hidden = type !== 'businessDay';
    sat.el.hidden = type !== 'businessDay';
    dayRow.hidden = type !== 'fixedDay';
    onceRow.hidden = type !== 'once';
    // salário, exceções e "a partir de" só fazem sentido para receitas que se repetem
    for (const el of recurring) el.hidden = type === 'once';
  };
  const ruleType = segmented([['businessDay', 'Dia útil'], ['fixedDay', 'Dia fixo'], ['once', 'Uma vez']], i.rule.type, sync);
  sync(i.rule.type);
  const err = errorBox();
  sheet(isNew ? (i.rule.type === 'once' ? 'Agendar receita' : 'Nova receita') : 'Editar receita', (close) => form(() => {
    if (!name.value.trim()) return fail(err, 'Dê um nome à receita.', name);
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v < 0) return fail(err, 'Informe o valor.', amount);
    const type = ruleType.value;
    if (type === 'once') {
      const d = onceDate.value;
      const changed = isNew || i.rule.type !== 'once' || d !== i.rule.date;
      if (!isValidISO(d)) return fail(err, 'Escolha a data.', onceDate);
      if (changed && d < today) return fail(err, 'Essa data já passou. Para uma receita que já caiu, use o botão + e escolha Receita.', onceDate);
      const saved = store.upsert('incomes', {
        ...i, name: name.value.trim(), amount: v, accountId: account.value,
        isSalary: false, rule: { type: 'once', date: d }, exceptions: {},
      });
      if (onSaved) afterSheetClosed(() => onSaved(saved)); else close();
      return;
    }
    const rule = type === 'businessDay'
      ? { type: 'businessDay', n: Number(n.value), countSaturday: sat.input.checked }
      : { type: 'fixedDay', day: Number(day.value) };
    if (rule.type === 'businessDay' && !(rule.n >= 1 && rule.n <= 23)) return fail(err, 'Use um dia útil de 1 a 23.', n);
    if (rule.type === 'fixedDay' && !(rule.day >= 1 && rule.day <= 31)) return fail(err, 'Use um dia de 1 a 31.', day);
    if (!isValidISO(since.value)) { moreOpts.open = true; return fail(err, 'Escolha a data de início.', since); }
    let exceptions;
    try { exceptions = exc.read(); } catch (e) { return fail(err, e.message); }
    const saved = store.upsert('incomes', {
      ...i, name: name.value.trim(), amount: v, accountId: account.value,
      isSalary: salary.input.checked, rule, exceptions, since: since.value,
    });
    if (onSaved) afterSheetClosed(() => onSaved(saved)); else close();
  },
  field('Nome', name),
  h('div', { class: 'field-row' }, field('Valor', amount), field('Entra em', account)),
  h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Quando cai'), ruleType.el),
  nRow, dayRow, onceRow, sat.el, salary.el,
  moreOpts,
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
  const card = switchRow('É cartão de crédito', 'Dá para detalhar os gastos de cada fatura.', e.isCard);
  const amountField = field('Valor', amount);
  const syncCard = () => { amountField.querySelector('.field-label').textContent = card.input.checked ? 'Valor previsto' : 'Valor'; };
  card.input.addEventListener('change', syncCard);
  syncCard();
  // fatura que está por pagar (só para cartão já salvo, fora da configuração inicial)
  const current = !isNew && e.isCard && state.setupDone ? currentInvoices(state, todayISO()).find((o) => o.sourceId === e.id) : null;
  const moreOpts = more('Mais opções', exc.el, field('Contar a partir de', since, 'Já pagou a deste mês? Use uma data após o vencimento.'));
  const hasInvoices = !isNew && Object.keys(state.invoices).some((k) => parseInvoiceKey(k)?.expenseId === e.id);
  const err = errorBox();
  sheet(isNew ? 'Nova despesa fixa' : 'Editar despesa fixa', (close) => form(() => {
    if (!name.value.trim()) return fail(err, 'Dê um nome à despesa.', name);
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v < 0) return fail(err, 'Informe o valor.', amount);
    const d = Number(day.value);
    if (!(d >= 1 && d <= 31)) return fail(err, 'Use um dia de 1 a 31.', day);
    if (!isValidISO(since.value)) { moreOpts.open = true; return fail(err, 'Escolha a data de início.', since); }
    let exceptions;
    try { exceptions = exc.read(); } catch (x) { return fail(err, x.message); }
    const saved = store.upsert('expenses', { ...e, name: name.value.trim(), amount: v, accountId: account.value, day: d, exceptions, since: since.value, isCard: card.input.checked });
    close();
    if (card.input.checked && !e.isCard && store.getState().setupDone) {
      const first = currentInvoices(store.getState(), todayISO()).find((o) => o.sourceId === saved.id);
      if (first) toast('A fatura fica em Contas', { label: 'Abrir', run: () => invoiceSheet(first.key) });
    }
  },
  field('Nome', name),
  h('div', { class: 'field-row' }, amountField, field('Sai de', account)),
  inlineField('Dia do vencimento', day),
  card.el,
  current && h('button', { type: 'button', class: 'btn block', onclick: () => invoiceSheet(current.key) }, 'Abrir fatura'),
  moreOpts,
  err,
  actions(!isNew && (async () => {
    const msg = hasInvoices ? `“${e.name}” deixa de ser prevista e as faturas dela são apagadas.` : `“${e.name}” deixa de ser prevista.`;
    if (await confirmDialog('Excluir despesa?', msg, 'Excluir', true)) store.remove('expenses', e.id);
  }))));
}

// ---------- metas ----------

export function editGoal(goal) {
  const state = store.getState();
  const goalAccounts = accountOptions(state, 'goal');
  if (!goalAccounts.length) {
    // sem conta de meta: cria a conta primeiro e segue para a meta
    return editAccount(null, { kind: 'goal', onSaved: () => editGoal() });
  }
  const isNew = !goal;
  const g = goal || { name: '', target: null, deadline: '', accountId: goalAccounts[0][0] };
  const name = textInput(g.name, { placeholder: 'Ex.: Viagem' });
  const target = moneyInput(g.target);
  const deadline = dateInput(g.deadline);
  const account = select(goalAccounts, g.accountId);
  const err = errorBox();
  sheet(isNew ? 'Nova meta' : 'Editar meta', (close) => form(() => {
    if (!name.value.trim()) return fail(err, 'Dê um nome à meta.', name);
    const v = parseBRL(target.value);
    if (Number.isNaN(v) || v <= 0) return fail(err, 'Informe quanto quer juntar.', target);
    if (!isValidISO(deadline.value)) return fail(err, 'Escolha o prazo.', deadline);
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
  const settledC = state.settled[`contribution:${c.id}`];
  const done = settledC && !settledC.skipped;
  sheet(isNew ? 'Novo aporte' : 'Editar aporte', (close) => form(() => {
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v <= 0) return fail(err, 'Informe o valor.', amount);
    if (!isValidISO(date.value)) return fail(err, 'Escolha a data.', date);
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
  sheet(`Ajustar saldo: ${account.name}`, (close) => form(() => {
    const v = parseBRL(balance.value);
    if (Number.isNaN(v)) return fail(err, 'Use só números, como 1.250,00 ou -80.', balance);
    const t = store.adjustBalance(account.id, v);
    close();
    toast(t ? `Saldo ajustado (${t.amount > 0 ? '+' : '−'}${formatBRL(Math.abs(t.amount))})` : 'O saldo já estava certo');
  },
  h('p', { class: 'sheet-lead' }, 'Digite o saldo que o banco mostra agora.'),
  field('Saldo real', balance),
  err,
  actions(null, 'Salvar saldo')));
}

export function transferSheet({ from, to, amount, title = 'Transferir', okLabel = 'Transferir', desc = '', note } = {}) {
  const state = store.getState();
  const opts = accountOptions(state);
  const fromSel = select(opts, from || state.settings.reserveAccountId || opts[0]?.[0]);
  const toSel = select(opts, to || state.settings.defaultAccountId || opts[1]?.[0]);
  const value = moneyInput(amount ?? null, { 'data-noautofocus': '1' });
  const err = errorBox();
  sheet(title, (close) => form(() => {
    const v = parseBRL(value.value);
    if (Number.isNaN(v) || v <= 0) return fail(err, 'Informe o valor.', value);
    if (fromSel.value === toSel.value) return fail(err, 'Escolha contas diferentes em De e Para.', toSel);
    store.transfer(fromSel.value, toSel.value, v, desc);
    close();
    toast(`${formatBRL(v)} transferidos`);
  },
  h('p', { class: 'sheet-lead' }, note || 'Transferências não contam como gasto.'),
  field('Valor', value),
  h('div', { class: 'field-row' }, field('De', fromSel), field('Para', toSel)),
  err,
  actions(null, okLabel)));
}

// "Aporte: Viagem" → "Viagem", para perguntas como "Fez o aporte para Viagem?"
const plainName = (event) => (event.kind === 'contribution' ? event.name.replace(/^Aporte:\s*/, '') : event.name);
const ASK_TITLE = {
  income: (e) => `Recebeu ${plainName(e)}?`,
  expense: (e) => `Pagou ${plainName(e)}?`,
  contribution: (e) => `Fez o aporte para ${plainName(e)}?`,
};

const CONFIRM = {
  income: { title: 'Recebeu?', ok: 'Confirmar recebimento', skip: 'Não veio este mês', where: 'Entra em', early: 'Já recebi' },
  expense: { title: 'Pagou?', ok: 'Confirmar pagamento', skip: 'Pular este mês', where: 'Sai de', early: 'Já paguei' },
  contribution: { title: 'Fez o aporte?', ok: 'Confirmar aporte', skip: 'Pular este aporte', where: 'Sai de', early: 'Já aportei' },
};

const yearOf = (d) => Number(d.slice(0, 4));

/** Detalhes de um evento previsto: confirmar agora ou mudar a data. */
export function eventSheet(event) {
  if (event.isCard) return invoiceSheet(event.key); // cartão: a fatura mostra tudo isso e os gastos
  const cfg = CONFIRM[event.kind];
  const ref = yearOf(todayISO());
  const moved = event.originalDate && event.date !== event.originalDate;
  sheet(event.name, () => [
    h('div', { class: 'stat' },
      h('span', { class: 'stat-label' }, `Previsto para ${formatDayMonth(event.date, ref)}${moved ? `, era ${formatDayMonth(event.originalDate, ref)}` : ''}`),
      moneyText(formatBRL(event.amount), `lg ${event.kind === 'income' ? 'pos' : ''}`, { 'data-fit': true })),
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
    if (!isValidISO(d) || d < earliest) return fail(err, `Escolha de hoje em diante. Se já aconteceu, use “${cfg.early}”.`, date);
    if (latest && d > latest) return fail(err, `Escolha até ${formatDayMonth(latest, ref)}. Se não for acontecer, use “${cfg.skip}”.`, date);
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
  const ref = yearOf(today);
  sheet(ASK_TITLE[event.kind](event), (close) => form(() => {
    const v = parseBRL(amount.value);
    if (Number.isNaN(v) || v < 0) return fail(err, 'Use só números, como 2.500,00.', amount);
    if (!isValidISO(date.value) || date.value > today) return fail(err, 'Escolha hoje ou uma data passada. Se ainda vai acontecer, use “Vai ser em outro dia”.', date);
    const t = store.confirmOccurrence(event, { amount: v, date: date.value });
    close();
    const tip = event.kind === 'income' ? savingTip(t) : {};
    toast(`${event.name}: ${formatBRL(v)} registrado${tip.note || ''}`, tip.action);
  },
  h('p', { class: 'sheet-lead' }, `Previsto para ${formatDayMonth(event.date, ref)}. ${cfg.where} ${acc?.name ?? 'conta excluída'}.`),
  h('div', { class: 'field-row' }, field('Valor', amount), field('Data', date)),
  err,
  h('div', { class: 'form-actions' },
    h('button', {
      type: 'button', class: 'btn',
      onclick: () => {
        store.skipOccurrence(event);
        close();
        toast(`${plainName(event)}: marcado como não ocorrido`, { label: 'Desfazer', run: () => { store.unskipOccurrence(event); toast(`${plainName(event)} voltou a ser previsto`); } });
      },
    }, cfg.skip),
    h('button', { type: 'submit', class: 'btn primary' }, cfg.ok)),
  h('button', { type: 'button', class: 'btn quiet block', onclick: () => moveSheet(event) }, 'Vai ser em outro dia')));
}

// ---------- poupança: guardar parte de uma receita ----------

/** Depois de confirmar uma receita: ação "Guardar R$ X" no aviso, ou a frase de mês apertado. */
function savingTip(tx) {
  const state = store.getState();
  if (state.settings.savingsEnabled === false) return {};
  const today = todayISO();
  const s = openSavings(state, today).find((o) => o.tx.id === tx.id);
  // com aviso de resgate na tela, a poupança espera: um pedido por vez
  if (s && suggestRefill(state, today, computeDailyBudget(state, today)).show) return {};
  if (s) return { action: { label: `Guardar ${formatBRLShort(s.amount)}`, run: () => savingSheet(tx.id) } };
  const why = suggestSaving(state, today, tx).reason;
  return why === 'tight' || why === 'no-room' ? { note: '. Mês apertado, nada a guardar desta vez.' } : {};
}

/** Folha da sugestão: valor editável (até 10%), para onde vai e a conta por trás do número. */
export function savingSheet(txId) {
  const state = store.getState();
  const today = todayISO();
  const s = openSavings(state, today).find((o) => o.tx.id === txId);
  if (!s) return toast('Esta sugestão não está mais disponível.');
  const { tx } = s;
  const name = tx.desc || 'Receita';
  const from = store.getAccount(tx.to);
  const goals = accountOptions(state, 'goal');
  const toSel = goals.length > 1 ? select(goals, s.to) : null;
  const value = moneyInput(s.amount, { 'data-noautofocus': '1' });
  const hint = h('span', { class: 'field-hint' });
  const submit = h('button', { type: 'submit', class: 'btn primary' });
  const err = errorBox();
  const read = () => parseBRL(value.value);
  // o limite real de agora: s.limit de uma linha posterior já conta com as anteriores guardadas
  const now = computeDailyBudget(state, today).dailyBudget;
  const sync = () => {
    const v = read();
    const ok = v > 0;
    const after = ok ? computeDailyBudget(withDelta(state, tx.to, -v), today).dailyBudget : now;
    const below = ok && after < s.floor;
    hint.classList.toggle('neg', below);
    hint.textContent = below
      ? `Limite do dia cai para ${formatBRL(after)}, abaixo do mínimo da regra (${formatBRL(s.floor)}).`
      : `Limite do dia: de ${formatBRL(now)} para ${formatBRL(after)}.${s.typical != null && after < s.typical ? ` Você costuma gastar ${formatBRL(s.typical)}.` : ''}`;
    if (goals.length) submit.textContent = ok ? `Guardar ${formatBRLShort(v)}` : 'Guardar';
  };
  value.addEventListener('input', sync);
  const lead = s.limitedBy === 'cap' ? `Dá para guardar ${formatPercent(SAVINGS.capBps)}, o teto da regra.`
    : s.limitedBy === 'floor' ? `Dá para guardar ${formatPercent(s.bps)} sem apertar seus dias.`
      : `Dá para guardar o que há em ${from.name}.`;
  const row = (k, v, cls = '') => [h('span', { class: `k ${cls}` }, k), h('span', { class: `v ${cls}` }, v)];
  const days = Math.min(s.days || 0, SAVINGS.windowDays);
  const createAccount = () => editAccount(null, { draft: { name: 'Poupança', kind: 'goal' }, onSaved: () => savingSheet(txId) });
  if (!goals.length) submit.textContent = 'Criar conta de meta';
  sync();
  sheet('Guardar parte?', (close) => form(() => {
    if (!goals.length) return createAccount();
    const v = read();
    if (Number.isNaN(v) || v <= 0) return fail(err, 'Informe o valor.', value);
    if (v > s.cap) return fail(err, `No máximo ${formatBRL(s.cap)}, ${formatPercent(SAVINGS.capBps)} do que entrou.`, value);
    if (v > from.balance) return fail(err, `${from.name} tem só ${formatBRL(from.balance)}.`, value);
    const to = store.getAccount(toSel ? toSel.value : s.to);
    const t = to && store.saveFromIncome(tx.id, v, to.id);
    if (!t) { close(); return toast('Esta sugestão não está mais disponível.'); }
    close();
    toast(`${formatBRL(v)} guardados em ${to.name}`, { label: 'Desfazer', run: () => { store.deleteTransaction(t.id); toast('Poupança desfeita'); } });
  },
  h('p', { class: 'sheet-lead' }, `${name}: entraram ${formatBRL(tx.amount)}. ${lead}`),
  h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Valor'), h('span', { class: 'money' }, value), hint),
  !goals.length && h('p', { class: 'field-hint' }, 'Falta uma conta de meta para receber o valor. Ela fica fora do limite do dia.'),
  toSel && field('Para', toSel, `Sai de ${from.name}. Faça a transferência no banco e registre aqui.`),
  goals.length === 1 && h('p', { class: 'field-hint' }, `Sai de ${from.name} e vai para ${goals[0][1]}, fora do limite do dia. Faça a transferência no banco e registre aqui.`),
  more('De onde vem o valor',
    h('div', { class: 'calc' },
      row('Entrou', formatBRL(tx.amount)),
      row(`Teto de ${formatPercent(SAVINGS.capBps)}`, formatBRL(s.cap)),
      s.limitedBy === 'balance' && row(`Saldo de ${from.name}`, formatBRL(from.balance)),
      row('Limite do dia hoje', formatBRL(now)),
      s.typical != null && row('Você costuma gastar por dia', formatBRL(s.typical)),
      row('Mínimo depois de guardar', formatBRL(s.floor)),
      h('span', { class: 'rule' }),
      row('Sugestão', formatBRL(s.amount), 'total')),
    h('p', { class: 'field-hint' }, s.basis === 'history'
      ? `O mínimo é 90% do que você gastou por dia nos últimos ${days} dias. A sugestão é o maior valor, em reais inteiros, que respeita o teto e o mínimo.`
      : 'Ainda sem 7 dias de gastos lançados. Por enquanto, o mínimo é 90% do limite antes de guardar.')),
  err,
  h('div', { class: 'form-actions' },
    h('button', {
      type: 'button', class: 'btn',
      onclick: () => {
        store.skipSaving(tx.id);
        close();
        toast('Sugestão dispensada', { label: 'Desfazer', run: () => store.skipSaving(tx.id, false) });
      },
    }, 'Desta vez não'),
    submit)));
}

// ---------- listas editáveis ----------

export function addButton(label, onclick) {
  return h('button', { class: 'btn-add', onclick }, icon('plus', { size: 18 }), label);
}

function listCard(title, items, emptyText, onAdd, addLabel) {
  return h('section', { class: 'card flush' },
    title && h('div', { class: 'card-head list-head' }, h('h2', { class: 'card-title' }, title)),
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
  const role = (a) => (a.id === state.settings.defaultAccountId ? 'Gastos do dia'
    : a.id === state.settings.reserveAccountId ? 'Reserva' : a.kind === 'goal' ? 'De meta' : 'De gasto');
  return listCard(title,
    state.accounts.map((a) => listItem(a.name, role(a), formatBRL(a.balance), () => editAccount(a))),
    'Nenhuma conta ainda.', () => editAccount(), 'Nova conta');
}

export function incomesList(state, title = 'Receitas') {
  // receita única já recebida sai da lista; o registro fica nas movimentações
  const visible = state.incomes.filter((i) => !(i.rule?.type === 'once' && state.settled[`income:${i.id}:unica`]));
  return listCard(title,
    visible.map((i) => listItem(i.name, withAccount(state, describeRule(i.rule), i.accountId),
      formatBRLShort(i.amount), () => editIncome(i), i.isSalary && h('span', { class: 'badge' }, 'Salário'))),
    'Nenhuma receita ainda.', () => editIncome(), 'Nova receita');
}

export function expensesList(state, title = 'Despesas fixas') {
  return listCard(title,
    state.expenses.map((e) => listItem(e.name, withAccount(state, `Dia ${e.day}`, e.accountId), formatBRLShort(e.amount), () => editExpense(e), e.isCard && h('span', { class: 'badge' }, 'Cartão'))),
    'Nenhuma despesa fixa.', () => editExpense(), 'Nova despesa');
}

export function goalsList(state, title = 'Metas') {
  const year = Number(todayISO().slice(0, 4));
  return listCard(title,
    state.goals.map((g) => listItem(g.name, `Até ${formatDayMonth(g.deadline, year)}`, formatBRLShort(g.target), () => editGoal(g))),
    'Nenhuma meta.', () => editGoal(), 'Nova meta');
}

export function contributionsList(state, title = 'Aportes planejados') {
  const goals = new Map(state.goals.map((g) => [g.id, g]));
  const year = Number(todayISO().slice(0, 4));
  const sorted = [...state.contributions].sort((a, b) => (a.date < b.date ? -1 : 1));
  return listCard(title,
    sorted.map((c) => listItem(goals.get(c.goalId)?.name ?? 'Meta excluída', formatDayMonth(c.date, year), formatBRLShort(c.amount), () => editContribution(c))),
    state.goals.length ? 'Nenhum aporte planejado.' : 'Crie uma meta para planejar aportes.',
    () => (state.goals.length ? pickGoalThenContribution(state) : toast('Crie uma meta antes.')), 'Novo aporte');
}

function pickGoalThenContribution(state) {
  if (state.goals.length === 1) return editContribution(null, state.goals[0].id);
  sheet('Para qual meta?', () => h('ul', { class: 'list' },
    state.goals.map((g) => listItem(g.name, `Até ${formatDayMonth(g.deadline, Number(todayISO().slice(0, 4)))}`, null, () => editContribution(null, g.id)))));
}

// ---------- lançamentos: nome, renomear e excluir ----------

export const TX_LABEL = {
  spend: 'Gasto', transfer: 'Transferência', adjust: 'Ajuste de saldo', income: 'Receita', expense: 'Despesa fixa', contribution: 'Aporte',
};
const txTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });

/** <datalist> com os nomes já usados em gastos ou receitas (sugestões ao digitar). */
export function nameList(id, type = 'spend') {
  return h('datalist', { id }, store.recentNames(type).map((n) => h('option', { value: n })));
}

/** Ficha de um lançamento: mostra valor e origem, permite renomear e excluir. */
export function transactionSheet(t) {
  const label = TX_LABEL[t.type] || 'Lançamento';
  const isSpend = t.type === 'spend';
  const suggest = isSpend || t.type === 'income';
  const listId = 'nomes-ficha';
  const name = textInput(t.desc || '', {
    placeholder: isSpend ? 'Ex.: Mercado, Almoço' : t.type === 'income' ? 'Ex.: Freela, Venda' : label, maxlength: store.NAME_MAX,
    list: suggest ? listId : null, enterkeyhint: 'done', 'data-noautofocus': '1',
  });
  const acc = (id) => store.getAccount(id)?.name ?? 'conta excluída';
  const isMove = t.type === 'transfer' || t.type === 'contribution';
  const where = isMove ? `de ${acc(t.from)} para ${acc(t.to)}` : t.from ? `de ${acc(t.from)}` : `em ${acc(t.to)}`;
  const when = `${formatDayMonth(t.date, yearOf(todayISO()))}${t.createdAt && (isSpend || t.type === 'income') ? `, ${txTime.format(new Date(t.createdAt))}` : ''}`;
  const savedOf = t.type === 'income' ? store.getState().transactions.filter((x) => x.savingOf === t.id).reduce((sum, x) => sum + x.amount, 0) : 0;
  sheet(t.desc || label, (close) => form(() => {
    const next = name.value.trim();
    if (next !== (t.desc || '')) {
      store.renameTransaction(t.id, next);
      toast(next ? 'Nome salvo' : 'Nome removido');
    }
    close();
  },
  h('div', { class: 'stat' },
    h('span', { class: 'stat-label' }, `${when}, ${where}`),
    moneyText(formatBRL(Math.abs(t.amount)), `lg ${t.type === 'income' ? 'pos' : ''}`, { 'data-fit': true })),
  field('Nome', name),
  suggest && nameList(listId, t.type),
  savedOf > 0 && h('p', { class: 'field-hint' }, `Poupança desta receita: ${formatBRL(savedOf)}.`),
  actions(async () => {
    const title = isSpend ? 'Excluir gasto?' : 'Excluir movimentação?';
    const msg = isSpend ? 'O valor volta para o saldo da conta.'
      : `Os saldos voltam ao que eram antes dela.${savedOf > 0 ? ` A poupança de ${formatBRL(savedOf)} continua registrada.` : ''}`;
    if (await confirmDialog(title, msg, 'Excluir', true)) {
      store.deleteTransaction(t.id);
      toast(isSpend ? 'Gasto excluído' : 'Movimentação excluída');
    }
  })));
}

// ---------- fatura de cartão ----------

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
/** Até quantos meses à frente dá para abrir uma fatura. */
const INVOICE_MONTHS_AHEAD = 12;

/** A fatura mudou por baixo (outro aparelho, despesa excluída): fecha e avisa. */
function invoiceGone(e) {
  closeSheet();
  toast(e.message);
}

/** Fatura de um cartão em um mês: valor previsto, estado, gastos e pagamento. */
export function invoiceSheet(key, { scroll, focus } = {}) {
  const state = store.getState();
  const today = todayISO();
  const ref = yearOf(today);
  const p = parseInvoiceKey(key);
  const occ = occurrenceByKey(state, key);
  if (!p || !occ?.isCard) return closeSheet();
  const exp = state.expenses.find((e) => e.id === p.expenseId);
  const paid = state.settled[key] || null;
  const inv = occ.invoice;
  const items = state.invoices[key]?.items || [];

  // meses vizinhos: só os que têm ocorrência, até 12 meses à frente
  const floor = monthKey(exp.since || state.createdAt || today);
  const ceil = shiftMonth(monthKey(today), INVOICE_MONTHS_AHEAD);
  const neighbor = (n) => {
    const mk = shiftMonth(p.month, n);
    const k = invoiceKey(p.expenseId, mk);
    return mk >= floor && mk <= ceil && occurrenceByKey(state, k) ? k : null;
  };
  const prev = neighbor(-1);
  const next = neighbor(1);

  let badge = ['', inv.closed ? 'Fechada' : 'Aberta'];
  let line;
  let tone = '';
  let value = occ.amount;
  let note = null;
  if (paid?.skipped) {
    badge = ['', 'Pulada'];
    line = 'Não foi paga neste mês';
    value = 0;
    note = 'Nada saiu do saldo.';
  } else if (paid) {
    badge = ['pos', 'Paga'];
    line = `Paga em ${formatDayMonth(paid.date, ref)}`;
    value = paid.amount;
    note = inv.count && inv.sum !== paid.amount ? `Os gastos somam ${formatBRL(inv.sum)}.` : null;
  } else {
    const due = formatDayMonth(occ.date, ref);
    const movedDate = occ.date !== occ.originalDate;
    line = occ.date < today ? `Venceu ${due}, ${relative(today, occ.date)}`
      : occ.date === today ? `Vence hoje, ${due}`
        : `Vence ${due}, ${movedDate ? `era ${formatDayMonth(occ.originalDate, ref)}` : relative(today, occ.date)}`;
    tone = occ.date <= today ? 'warn-text' : '';
    const diff = inv.total - inv.estimate;
    note = inv.count && diff ? `${formatBRL(Math.abs(diff))} ${diff > 0 ? 'acima' : 'abaixo'} do previsto.` : null;
  }

  // ocorrência lida na hora do toque: o valor pode ter mudado desde que a folha abriu
  const fresh = () => occurrenceByKey(store.getState(), key);
  const canMove = addDays(occ.originalDate, MAX_MOVE_DAYS) >= today;
  const closed = switchRow('Fatura fechada', 'Vale a soma dos gastos, não o previsto.', inv.closed);
  closed.input.addEventListener('change', () => {
    try { store.setInvoiceClosed(key, closed.input.checked); } catch (e) { return invoiceGone(e); }
    invoiceSheet(key, { scroll: document.querySelector('.sheet')?.scrollTop, focus: '.switch input' });
  });

  const row = (it) => h('li', {}, h('button', { class: 'list-item', onclick: () => invoiceItemSheet(key, it) },
    h('span', { class: 'li-main' }, h('span', { class: `li-title ${it.name ? '' : 'muted'}` }, it.name || 'Gasto')),
    h('span', { class: 'li-end' }, h('span', { class: 'li-value' }, formatBRL(it.amount)), icon('chevron', { size: 18, cls: 'chev' }))));
  const rest = !paid && inv.rest > 0 && h('li', {}, h('div', { class: 'row-item' },
    h('span', { class: 'li-main' }, h('span', { class: 'li-title muted' }, 'Resto do previsto')),
    h('span', { class: 'li-value muted' }, formatBRL(inv.rest))));
  const empty = paid ? 'Nenhum gasto detalhado nesta fatura.'
    : `O app conta com o previsto de ${formatBRLShort(inv.estimate)}. Gastos lançados aqui não saem do saldo: só o pagamento da fatura sai.`;

  sheet(occ.name, () => [
    h('div', { class: 'month-nav' },
      prev ? h('button', { class: 'icon-btn', 'aria-label': 'Mês anterior', onclick: () => invoiceSheet(prev, { focus: '[aria-label="Mês anterior"]' }) }, icon('back')) : h('span'),
      h('span', { class: 'li-title center', tabindex: -1 }, cap(formatMonth(p.month))),
      next ? h('button', { class: 'icon-btn', 'aria-label': 'Próximo mês', onclick: () => invoiceSheet(next, { focus: '[aria-label="Próximo mês"]' }) }, icon('chevron')) : h('span')),
    h('div', { class: 'stat' },
      h('div', { class: 'row between gap' },
        h('span', { class: 'stat-label' }, h('span', { class: tone }, line)),
        h('span', { class: `badge ${badge[0]}` }, badge[1])),
      moneyText(formatBRL(value), 'lg', { 'data-fit': true }),
      note && h('span', { class: 'field-hint' }, note)),
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Gastos da fatura'),
      h('div', { class: 'card inset invoice-items' },
        items.length ? h('ul', { class: 'list' }, items.map(row), rest) : h('p', { class: 'empty' }, empty),
        h('button', { type: 'button', class: 'btn-add', 'data-add': '1', onclick: () => invoiceItemSheet(key) }, icon('plus', { size: 18 }), 'Adicionar gasto'))),
    !paid && items.length > 0 && closed.el,
    !paid && h('div', { class: 'form-actions' },
      canMove && h('button', { class: 'btn', onclick: () => { const o = fresh(); if (o) moveSheet(o); else closeSheet(); } }, 'Mudar a data'),
      h('button', { class: 'btn primary', onclick: () => { const o = fresh(); if (o) confirmOccurrenceSheet(o); else closeSheet(); } }, 'Já paguei')),
    paid && !paid.skipped && h('p', { class: 'field-hint' }, 'Para desfazer o pagamento, exclua a movimentação em Contas.'),
  ]);
  const panel = document.querySelector('.sheet');
  if (scroll === 'add') panel.querySelector('[data-add]')?.scrollIntoView({ block: 'center' });
  else if (scroll != null) panel.scrollTop = scroll;
  // a folha é refeita a cada troca: devolve o foco ao controle usado (ou ao mês, se ele sumiu)
  if (focus) (panel.querySelector(focus) || panel.querySelector('.month-nav .li-title'))?.focus({ preventScroll: true });
}

/** Um gasto da fatura: nome e valor. Em gasto novo dá para salvar e já lançar o próximo. */
function invoiceItemSheet(key, item) {
  const state = store.getState();
  const p = parseInvoiceKey(key);
  const exp = state.expenses.find((e) => e.id === p.expenseId);
  const isNew = !item;
  let added = 0;
  const listId = 'nomes-fatura';
  const value = moneyInput(item?.amount ?? null);
  const name = textInput(item?.name, {
    placeholder: 'Ex.: Mercado, Assinatura', maxlength: store.NAME_MAX, list: listId, enterkeyhint: 'next',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); value.focus(); } },
  });
  const lead = h('p', { class: 'sheet-lead', 'aria-live': 'polite' }, `${exp?.name ?? 'Cartão'}, ${formatMonth(p.month)}.`);
  const err = errorBox();
  const back = (scroll) => invoiceSheet(key, { scroll });
  /** Salva o que está no formulário; devolve o gasto, false (valor inválido) ou null (fatura sumiu). */
  const save = () => {
    const v = parseBRL(value.value);
    if (!Number.isSafeInteger(v) || v <= 0) return fail(err, 'Informe o valor.', value);
    try {
      const input = { name: name.value, amount: v };
      const saved = isNew ? store.addInvoiceItem(key, input) : store.updateInvoiceItem(key, item.id, input);
      if (!saved) throw new Error('Este gasto não existe mais.');
      return saved;
    } catch (e) { invoiceGone(e); return null; }
  };
  const isEmpty = () => !name.value.trim() && !value.value.trim();
  const again = () => {
    if (added && isEmpty()) return name.focus(); // toque repetido: nada a salvar
    const saved = save();
    if (!saved) return;
    added++;
    const sum = occurrenceByKey(store.getState(), key)?.invoice.sum ?? 0;
    lead.textContent = `${saved.name ? `${saved.name}: gasto lançado` : 'Gasto lançado'}. Os gastos somam ${formatBRL(sum)}.`;
    err.textContent = '';
    name.value = '';
    value.value = '';
    name.focus();
  };
  sheet(isNew ? 'Novo gasto' : 'Editar gasto', () => form(() => {
    // depois de "Salvar e novo", salvar com o formulário vazio só volta para a fatura
    if (added && isEmpty()) return back('add');
    if (save()) back(isNew ? 'add' : undefined);
  },
  lead,
  field('Nome', name),
  field('Valor', value),
  h('datalist', { id: listId }, store.invoiceNames(p.expenseId).map((n) => h('option', { value: n }))),
  err,
  h('div', { class: 'form-actions' },
    isNew
      ? h('button', { type: 'button', class: 'btn', onclick: again }, 'Salvar e novo')
      : h('button', {
        type: 'button', class: 'btn danger-text',
        onclick: () => {
          let gone;
          try { gone = store.removeInvoiceItem(key, item.id); } catch (e) { return invoiceGone(e); }
          back();
          if (!gone) return;
          toast('Gasto removido', {
            label: 'Desfazer',
            run: () => {
              try {
                store.addInvoiceItem(key, gone.item, gone.index);
                if (gone.closed) store.setInvoiceClosed(key, true);
              } catch (e) { return invoiceGone(e); }
              back();
            },
          });
        },
      }, icon('trash', { size: 20 }), 'Excluir'),
    h('button', { type: 'submit', class: 'btn primary' }, 'Salvar'))));
}
