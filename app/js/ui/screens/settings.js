import { h, toast, confirmDialog, closeSheet } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import * as sync from '../../data/sync.js';
import { todayISO } from '../../core/dates.js';
import { incomesList, expensesList, field, inlineField, switchRow, errorBox, fail } from '../editors.js';
import { APP_VERSION } from '../../version.js';
import { cloudSheet, statusText, statusTone } from '../backup.js';

/**
 * Parâmetros de resgate. Em Ajustes só os números; na configuração inicial
 * (withAccounts) também a escolha das contas, que depois mora na aba Contas.
 */
export function refillSettings(state, { withAccounts = false } = {}) {
  const s = state.settings;
  const spending = state.accounts.filter((a) => a.kind === 'spending');
  const opts = (value, allowNone) => h('select', {},
    allowNone && h('option', { value: '' }, 'Nenhuma'),
    spending.map((a) => h('option', { value: a.id, selected: a.id === value || undefined }, a.name)));
  const def = withAccounts ? opts(s.defaultAccountId) : null;
  const res = withAccounts ? opts(s.reserveAccountId, true) : null;
  const num = (v) => h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: v, maxlength: 5 });
  const threshold = num(s.refill.thresholdDays);
  const target = num(s.refill.targetDays);
  const step = num(s.refill.step / 100);
  const surplus = switchRow('Sugerir aplicar sobras', 'Quando a conta tiver bem mais que o necessário.', s.surplusEnabled !== false);
  const err = errorBox();

  const save = () => {
    const t = Number(threshold.value);
    const d = Number(target.value);
    const st = Math.round(Number(step.value) * 100);
    // erro fica embaixo do campo, que mantém o foco até ser corrigido
    if (!(Number.isInteger(t) && t >= 0)) return fail(err, 'Use um número inteiro de dias, 0 ou mais.', threshold);
    if (!(Number.isInteger(d) && d >= 1)) return fail(err, 'Use um número inteiro de dias, 1 ou mais.', target);
    if (!(Number.isFinite(st) && st >= 100)) return fail(err, 'Use um valor de pelo menos R$ 1.', step);
    const patch = { surplusEnabled: surplus.input.checked, refill: { thresholdDays: t, targetDays: d, step: st } };
    if (withAccounts) {
      if (def.value && def.value === res.value) return fail(err, 'Escolha uma reserva diferente da conta dos gastos do dia.', res);
      Object.assign(patch, { defaultAccountId: def.value || null, reserveAccountId: res.value || null });
    }
    fail(err, '');
    store.updateSettings(patch);
    toast('Salvo');
  };
  for (const el of [def, res, threshold, target, step, surplus.input]) el?.addEventListener('change', save);

  return h('section', { class: 'card' },
    withAccounts && field('Gastos do dia', def, 'Conta de onde saem os gastos lançados.'),
    withAccounts && field('Reserva', res, 'Conta de onde vem o dinheiro dos resgates.'),
    h('div', {},
      inlineField('Avisar quando a conta cobrir menos de', threshold, null, { unit: 'dias' }),
      inlineField('Cada resgate deve cobrir', target, null, { unit: 'dias' }),
      inlineField('Arredondar resgates para múltiplos de', step, null, { unit: 'R$', prefix: true })),
    err,
    surplus.el);
}

export function exportBackup() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `hoje-backup-${todayISO()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Arquivo exportado');
}

/** Input escondido que importa um arquivo de backup; devolve [input, abrir]. */
function fileImporter(confirmFirst = true) {
  const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (confirmFirst && !(await confirmDialog('Importar arquivo?', 'Os dados deste aparelho serão trocados pelos do arquivo.', 'Importar', true))) return;
    try {
      store.importJSON(await file.text());
      closeSheet();
      toast('Arquivo importado');
    } catch (e) {
      const why = e instanceof SyntaxError ? 'O arquivo não é um backup do Hoje.' : e.message;
      toast(`Não deu para importar. ${why}`);
    }
  });
  return [input, () => input.click()];
}

/** Botão + input escondido para importar um backup (usado na configuração inicial). */
export function importButton(label, cls = 'btn grow', confirmFirst = true) {
  const [input, open] = fileImporter(confirmFirst);
  return [h('button', { type: 'button', class: cls, onclick: open }, icon('upload', { size: 18 }), label), input];
}

function row(title, sub, onclick, { tone = '', subTone = '', chevron = true } = {}) {
  return h('li', {}, h('button', { class: 'list-item', onclick },
    h('span', { class: 'li-main' },
      h('span', { class: `li-title ${tone}` }, title),
      sub && h('span', { class: `li-sub ${subTone}` }, sub)),
    chevron && icon('chevron', { size: 18, cls: 'chev' })));
}

function dataCard() {
  const st = sync.getStatus();
  const [input, openFile] = fileImporter();
  return h('section', { class: 'card flush' },
    h('ul', { class: 'list' },
      row('Backup na nuvem', statusText(st), cloudSheet, { subTone: statusTone(st) }),
      row('Exportar arquivo', 'Cópia dos dados em JSON', exportBackup, { chevron: false }),
      row('Importar arquivo', 'Troca os dados deste aparelho', openFile, { chevron: false }),
      row('Apagar todos os dados', null, async () => {
        if (await confirmDialog('Apagar tudo?', 'Não dá para desfazer. Exporte um arquivo antes, se quiser.', 'Apagar tudo', true)) store.resetAll();
      }, { tone: 'neg', chevron: false })),
    input);
}

export function renderSettings(ctx) {
  const { state } = ctx;
  return h('div', { class: 'screen settings' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Ajustes')),
    h('h2', { class: 'section-label' }, 'Receitas'),
    incomesList(state, null),
    h('h2', { class: 'section-label' }, 'Despesas fixas'),
    expensesList(state, null),
    h('h2', { class: 'section-label' }, 'Resgates'),
    refillSettings(state),
    h('h2', { class: 'section-label' }, 'Dados'),
    dataCard(),
    h('p', { class: 'caption center version' }, `Hoje ${APP_VERSION}`));
}
