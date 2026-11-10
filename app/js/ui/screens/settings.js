import { h, toast, confirmDialog, closeSheet } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import * as sync from '../../data/sync.js';
import { todayISO } from '../../core/dates.js';
import { incomesList, expensesList, field, inlineField, switchRow, moneyInput } from '../editors.js';
import { parseBRL } from '../../core/money.js';
import { APP_VERSION } from '../../version.js';
import { formatBRL } from '../../core/money.js';
import { savingFloor } from '../../core/savings.js';
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
    const patch = { surplusEnabled: surplus.input.checked, refill: { thresholdDays: t, targetDays: d, step: st } };
    if (withAccounts) {
      if (def.value && def.value === res.value) return toast('A reserva precisa ser outra conta.');
      Object.assign(patch, { defaultAccountId: def.value || null, reserveAccountId: res.value || null });
    }
    store.updateSettings(patch);
    toast('Salvo');
  };
  for (const el of [def, res, surplus.input]) el?.addEventListener('change', save);
  // campos de digitar: o toque que tirou o foco ainda está em curso, e redesenhar agora engoliria o clique
  for (const el of [threshold, target, step]) el.addEventListener('change', () => setTimeout(save, 250));

  return h('section', { class: 'card' },
    withAccounts && field('Gastos do dia', def, 'Conta de onde saem os gastos lançados.'),
    withAccounts && field('Reserva', res, 'Conta de onde vem o dinheiro dos resgates.'),
    h('div', {},
      inlineField('Avisar com menos de', threshold, 'dias de cobertura'),
      inlineField('Cada resgate cobre', target, 'dias'),
      inlineField('Arredondar para', step, 'múltiplos de R$')),
    surplus.el);
}

/** Margem de segurança: valor nas contas de gasto que o limite nunca usa. */
function limitSettings(state) {
  const input = moneyInput(state.settings.cushion || null, { placeholder: '0', 'aria-label': 'Margem de segurança em reais', maxlength: 12 });
  input.addEventListener('change', () => {
    const v = input.value.trim() === '' ? 0 : parseBRL(input.value);
    if (!Number.isInteger(v) || v < 0) return toast('Valor inválido.');
    if (v === (state.settings.cushion || 0)) return;
    setTimeout(() => { store.updateSettings({ cushion: v }); toast('Salvo'); }, 250); // idem: não engole o toque em curso
  });
  return h('section', { class: 'card' },
    field('Margem de segurança', input, 'O limite nunca usa esse valor. Fica nas contas de gasto para imprevistos.'));
}

/** Regra de poupança: uma chave e uma linha que mostra os números que a regra está usando. */
function savingsSettings(ctx) {
  const on = ctx.state.settings.savingsEnabled !== false;
  const sw = switchRow('Sugerir poupança', 'A cada receita, quanto dá para guardar. Nunca mais de 10%.', on);
  sw.input.addEventListener('change', () => { store.updateSettings({ savingsEnabled: sw.input.checked }); toast('Salvo'); });
  const limit = ctx.budget.dailyBudget;
  const f = on ? savingFloor(ctx.state, ctx.today, limit) : null;
  const status = !f ? null
    : limit <= 0 ? 'Sem folga hoje. As sugestões voltam quando o limite ficar positivo.'
      : f.basis === 'limit' ? 'Ainda sem 7 dias de gastos lançados. Por enquanto, guardar não baixa o limite em mais de 10%.'
        : limit < f.floor ? `Mês apertado. O limite de hoje, ${formatBRL(limit)}, está abaixo de 90% do que você costuma gastar (${formatBRL(f.typical)} por dia).`
          : `Você costuma gastar ${formatBRL(f.typical)} por dia. Depois de guardar, o limite não fica abaixo de ${formatBRL(f.floor)}.`;
  return h('section', { class: 'card' }, sw.el, status && h('p', { class: 'caption' }, status));
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
      toast(`Não deu para importar: ${e.message}`);
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
    h('header', { class: 'screen-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Voltar para Hoje', onclick: () => ctx.navigate('#/hoje') }, icon('back', { size: 24 })),
      h('div', { class: 'titles' }, h('h1', {}, 'Ajustes'))),
    h('h2', { class: 'section-label' }, 'Receitas'),
    incomesList(state, null),
    h('h2', { class: 'section-label' }, 'Despesas fixas'),
    expensesList(state, null),
    h('h2', { class: 'section-label' }, 'Limite do dia'),
    limitSettings(state),
    h('h2', { class: 'section-label' }, 'Resgates'),
    refillSettings(state),
    h('h2', { class: 'section-label' }, 'Poupança'),
    savingsSettings(ctx),
    h('h2', { class: 'section-label' }, 'Dados'),
    dataCard(),
    h('p', { class: 'caption center', style: 'padding-top:8px' }, `Hoje ${APP_VERSION}`));
}
