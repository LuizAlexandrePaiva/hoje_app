// Assistente do primeiro acesso: cadastra contas, receitas, despesas, metas
// e parâmetros. Cada passo salva no aparelho, então dá para fechar e voltar.

import { h, toast, confirmDialog } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { accountsList, incomesList, expensesList, goalsList, contributionsList } from '../editors.js';
import { refillSettings, importButton } from './settings.js';
import { backupStepCard, restoreSheet } from '../backup.js';

const tip = (text) => h('p', { class: 'tip' }, icon('check', { size: 18 }), h('span', {}, text));

const STEPS = [
  { render: welcome, next: 'Começar' },
  {
    title: 'Suas contas',
    lead: 'Cadastre cada conta com o saldo de hoje.',
    tips: ['De gasto: conta corrente, CDB de liquidez diária…', 'De meta: dinheiro guardado, fora do orçamento.'],
    render: (s) => [accountsList(s, null)],
    valid: (s) => s.accounts.some((a) => a.kind === 'spending') || 'Cadastre pelo menos uma conta de gasto.',
  },
  {
    title: 'O que entra',
    lead: 'Receitas que se repetem todo mês.',
    tips: ['Marque o salário: o orçamento vai até a véspera dele.', 'Nada entra no saldo antes de você confirmar.'],
    render: (s) => [incomesList(s, null)],
  },
  {
    title: 'O que sai',
    lead: 'Contas fixas, como a fatura do cartão.',
    tips: ['Elas são reservadas antes do seu limite diário.'],
    render: (s) => [expensesList(s, null)],
  },
  {
    title: 'Metas',
    lead: 'Opcional. Dá para criar depois.',
    tips: ['Aportes planejados já saem do orçamento na data.'],
    render: (s) => [goalsList(s), contributionsList(s)],
  },
  {
    title: 'Resgates',
    lead: 'De onde saem os gastos e de onde vem o dinheiro quando a conta baixar.',
    render: (s) => [refillSettings(s)],
  },
  {
    title: 'Backup',
    lead: 'Para não perder nada no Safari, no app instalado ou num celular novo.',
    render: () => [backupStepCard()],
    next: 'Concluir',
  },
];

function welcome() {
  const feature = (ico, title, sub) => h('li', {}, icon(ico, { size: 22 }),
    h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, title), h('span', { class: 'li-sub' }, sub)));
  return [
    h('div', { class: 'welcome' },
      h('img', { src: 'icons/icon-192.png', alt: '', width: 88, height: 88 }),
      h('h1', {}, 'Hoje'),
      h('p', { class: 'lead' }, 'Quanto você pode gastar hoje sem faltar dinheiro até o salário.')),
    h('ul', { class: 'features card' },
      feature('sun', 'Limite do dia', 'Recalculado todo dia com o saldo real.'),
      feature('transfer', 'Hora de resgatar', 'Avisa quando a conta precisa de reforço.'),
      feature('wallet', 'Privado', 'Funciona offline. Backup só com criptografia.')),
  ];
}

export function renderSetup(ctx) {
  const { state } = ctx;
  const step = Math.min(state.setupStep || 0, STEPS.length - 1);
  const cur = STEPS[step];
  const last = step === STEPS.length - 1;

  const next = async () => {
    const ok = cur.valid ? cur.valid(state) : true;
    if (ok !== true) return toast(ok);
    if (step === 2 && !state.incomes.some((i) => i.isSalary)
      && !(await confirmDialog('Nenhum salário marcado', 'Sem salário, o orçamento usa a próxima receita (ou 30 dias).', 'Seguir assim'))) return;
    if (last) {
      store.finishSetup();
      ctx.navigate('#/hoje', { replace: true });
    } else {
      store.setSetupStep(step + 1);
      window.scrollTo(0, 0);
    }
  };

  return h('div', { class: 'screen setup' },
    step > 0 && h('div', { class: 'steps', 'aria-hidden': 'true' }, STEPS.slice(1).map((_, i) => h('span', { class: i < step ? 'on' : '' }))),
    step > 0 && h('p', { class: 'step-count' }, `Passo ${step} de ${STEPS.length - 1}`),
    cur.title && h('header', { class: 'screen-head' }, h('h1', {}, cur.title), cur.lead && h('p', { class: 'sub' }, cur.lead)),
    cur.tips && h('div', { class: 'stack-sm' }, cur.tips.map(tip)),
    cur.render(state),
    step === 0
      ? h('div', { class: 'setup-nav column' },
        h('button', { class: 'btn primary xl', onclick: next }, cur.next),
        h('button', { class: 'btn quiet', onclick: () => restoreSheet({ fileButton: importButton('Usar arquivo JSON', 'btn quiet block', false) }) }, 'Já tenho um backup'))
      : h('div', { class: 'setup-nav' },
        h('button', { class: 'btn', onclick: () => store.setSetupStep(step - 1) }, 'Voltar'),
        h('button', { class: 'btn primary', onclick: next }, cur.next || 'Continuar')));
}
