import { h, toast, confirmDialog } from '../dom.js';
import * as store from '../../data/store.js';
import { todayISO } from '../../core/dates.js';
import { formatBRL } from '../../core/money.js';
import { accountsList, incomesList, expensesList, goalsList, contributionsList, field } from '../editors.js';
import { APP_VERSION } from '../../version.js';

export function refillSettings(state) {
  const s = state.settings;
  const spending = state.accounts.filter((a) => a.kind === 'spending');
  const opts = (value, allowNone) => h('select', {},
    allowNone && h('option', { value: '' }, '— nenhuma —'),
    spending.map((a) => h('option', { value: a.id, selected: a.id === value || undefined }, a.name)));
  const def = opts(s.defaultAccountId);
  const res = opts(s.reserveAccountId, true);
  const num = (v, min, max) => h('input', { type: 'number', inputmode: 'numeric', min, max, value: v });
  const threshold = num(s.refill.thresholdDays, 0, 60);
  const target = num(s.refill.targetDays, 1, 90);
  const step = num(s.refill.step / 100, 1, 10000);
  const surplus = h('input', { type: 'checkbox', checked: s.surplusEnabled !== false });

  const save = () => {
    const t = Number(threshold.value);
    const d = Number(target.value);
    const st = Math.round(Number(step.value) * 100);
    if (!(t >= 0 && d >= 1 && st >= 100)) return toast('Confira os valores de resgate.');
    if (def.value && def.value === res.value) return toast('A reserva deve ser diferente da conta padrão.');
    store.updateSettings({
      defaultAccountId: def.value || null,
      reserveAccountId: res.value || null,
      surplusEnabled: surplus.checked,
      refill: { thresholdDays: t, targetDays: d, step: st },
    });
    toast('Parâmetros salvos');
  };
  for (const el of [def, res, threshold, target, step, surplus]) el.addEventListener('change', save);

  return h('section', { class: 'card' },
    h('h3', {}, 'Gastos e resgates'),
    field('Conta padrão dos gastos', def, 'De onde saem os gastos lançados (Pix/débito).'),
    field('Reserva para resgates', res, 'Conta de gasto de onde vêm os resgates (ex.: CDB de liquidez diária).'),
    field('Avisar quando cobrir menos de (dias)', threshold),
    field('Cada resgate deve cobrir (dias)', target),
    field('Arredondar resgate para múltiplos de (R$)', step),
    h('label', { class: 'check' }, surplus, h('span', {}, 'Sugerir aplicar excedente na reserva')));
}

function backupCard() {
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (!(await confirmDialog('Importar backup?', 'Todos os dados atuais deste aparelho serão substituídos pelos do arquivo.', 'Importar', true))) return;
    try {
      store.importJSON(await file.text());
      toast('Backup importado');
    } catch (e) {
      toast(`Não foi possível importar: ${e.message}`);
    }
  });
  return h('section', { class: 'card' },
    h('h3', {}, 'Backup'),
    h('p', { class: 'muted small' }, 'Os dados ficam só neste aparelho. Exporte um backup de vez em quando (e antes de trocar de celular).'),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn ghost grow', onclick: exportBackup }, 'Exportar JSON'),
      h('button', { class: 'btn ghost grow', onclick: () => fileInput.click() }, 'Importar JSON')),
    fileInput);
}

export function exportBackup() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `hoje-backup-${todayISO()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dangerCard() {
  return h('section', { class: 'card' },
    h('h3', {}, 'Recomeçar'),
    h('p', { class: 'muted small' }, 'Apaga todos os dados deste aparelho e abre a configuração inicial.'),
    h('button', {
      class: 'btn danger block',
      onclick: async () => {
        if (await confirmDialog('Apagar tudo?', 'Esta ação não pode ser desfeita. Exporte um backup antes, se quiser.', 'Apagar tudo', true)) {
          store.resetAll();
        }
      },
    }, 'Apagar todos os dados'));
}

export function renderSettings(ctx) {
  const { state } = ctx;
  const spendingTotal = state.accounts.filter((a) => a.kind === 'spending').reduce((s, a) => s + a.balance, 0);
  return h('div', { class: 'screen settings' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Ajustes')),
    incomesList(state),
    expensesList(state),
    accountsList(state),
    h('p', { class: 'muted small pad-x' }, `Total nas contas de gasto: ${formatBRL(spendingTotal)}`),
    goalsList(state),
    contributionsList(state),
    refillSettings(state),
    backupCard(),
    dangerCard(),
    h('p', { class: 'muted small center' }, `Hoje v${APP_VERSION} · dados salvos só neste aparelho`));
}
