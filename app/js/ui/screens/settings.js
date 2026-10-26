import { h, toast, confirmDialog, closeSheet } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { todayISO } from '../../core/dates.js';
import { accountsList, incomesList, expensesList, goalsList, contributionsList, field, inlineField, switchRow } from '../editors.js';
import { APP_VERSION } from '../../version.js';
import { cloudCard } from '../backup.js';

export function refillSettings(state) {
  const s = state.settings;
  const spending = state.accounts.filter((a) => a.kind === 'spending');
  const opts = (value, allowNone) => h('select', {},
    allowNone && h('option', { value: '' }, 'Nenhuma'),
    spending.map((a) => h('option', { value: a.id, selected: a.id === value || undefined }, a.name)));
  const def = opts(s.defaultAccountId);
  const res = opts(s.reserveAccountId, true);
  const num = (v, label) => h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: v, 'aria-label': label, maxlength: 5 });
  const threshold = num(s.refill.thresholdDays, 'Avisar com menos de quantos dias');
  const target = num(s.refill.targetDays, 'Dias que cada resgate cobre');
  const step = num(s.refill.step / 100, 'Arredondar para múltiplos de quantos reais');
  const surplus = switchRow('Sugerir aplicar sobras', 'Quando a conta tiver bem mais que o necessário.', s.surplusEnabled !== false);

  const save = () => {
    const t = Number(threshold.value);
    const d = Number(target.value);
    const st = Math.round(Number(step.value) * 100);
    if (!(Number.isInteger(t) && t >= 0 && Number.isInteger(d) && d >= 1 && st >= 100)) return toast('Confira os números de resgate.');
    if (def.value && def.value === res.value) return toast('A reserva precisa ser outra conta.');
    store.updateSettings({
      defaultAccountId: def.value || null,
      reserveAccountId: res.value || null,
      surplusEnabled: surplus.input.checked,
      refill: { thresholdDays: t, targetDays: d, step: st },
    });
    toast('Salvo');
  };
  for (const el of [def, res, threshold, target, step, surplus.input]) el.addEventListener('change', save);

  return h('section', { class: 'card' },
    field('Conta dos gastos', def, 'De onde saem os gastos do dia.'),
    field('Reserva', res, 'De onde vem o dinheiro dos resgates.'),
    h('div', {},
      inlineField('Avisar com menos de', threshold, 'dias de cobertura'),
      inlineField('Cada resgate cobre', target, 'dias'),
      inlineField('Arredondar resgate para', step, 'múltiplos de R$')),
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
  toast('Backup exportado');
}

/** Botão + input escondido para importar um backup. */
export function importButton(label, cls = 'btn grow', confirmFirst = true) {
  const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (confirmFirst && !(await confirmDialog('Importar backup?', 'Os dados deste aparelho serão trocados pelos do arquivo.', 'Importar', true))) return;
    try {
      store.importJSON(await file.text());
      closeSheet();
      toast('Backup importado');
    } catch (e) {
      toast(`Não deu para importar: ${e.message}`);
    }
  });
  return [h('button', { type: 'button', class: cls, onclick: () => input.click() }, icon('upload', { size: 18 }), label), input];
}

function fileCard() {
  return h('section', { class: 'card flush' },
    h('button', { class: 'btn-add', onclick: exportBackup }, icon('download', { size: 18 }), 'Exportar arquivo JSON'),
    importButton('Importar arquivo JSON', 'btn-add'));
}

function dangerCard() {
  return h('section', { class: 'card flush' },
    h('button', {
      class: 'btn-add', style: 'color:var(--neg)',
      onclick: async () => {
        if (await confirmDialog('Apagar tudo?', 'Não dá para desfazer. Exporte um backup antes, se quiser.', 'Apagar tudo', true)) store.resetAll();
      },
    }, icon('trash', { size: 18 }), 'Apagar todos os dados'));
}

export function renderSettings(ctx) {
  const { state } = ctx;
  return h('div', { class: 'screen settings' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Ajustes')),
    h('h2', { class: 'section-label' }, 'Todo mês'),
    incomesList(state),
    expensesList(state),
    h('h2', { class: 'section-label' }, 'Contas e metas'),
    accountsList(state),
    goalsList(state),
    contributionsList(state),
    h('h2', { class: 'section-label' }, 'Resgates'),
    refillSettings(state),
    h('h2', { class: 'section-label' }, 'Dados'),
    cloudCard(),
    fileCard(),
    dangerCard(),
    h('p', { class: 'caption center', style: 'padding-top:8px' }, `Hoje ${APP_VERSION}`));
}
