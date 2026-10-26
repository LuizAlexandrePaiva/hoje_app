// Assistente do primeiro acesso: cadastra contas, receitas, despesas, metas
// e parâmetros. Cada passo salva no aparelho, então dá para fechar e voltar.

import { h, toast, confirmDialog } from '../dom.js';
import * as store from '../../data/store.js';
import { accountsList, incomesList, expensesList, goalsList, contributionsList } from '../editors.js';
import { refillSettings } from './settings.js';

const STEPS = [
  { title: 'Bem-vindo ao Hoje', render: welcome },
  {
    title: 'Suas contas',
    intro: 'Cadastre as contas com o saldo de hoje. “Contas de gasto” formam o dinheiro do orçamento (ex.: conta corrente e um CDB de liquidez diária). Contas de meta/investimento ficam fora.',
    render: (s) => [accountsList(s)],
    valid: (s) => s.accounts.some((a) => a.kind === 'spending') || 'Cadastre pelo menos uma conta de gasto.',
  },
  {
    title: 'Receitas',
    intro: 'Tudo que entra todo mês: salário, aluguéis… Marque o salário com “É o meu salário” — o orçamento vai até a véspera dele. Cada receita só entra no saldo quando você confirma “Recebeu?”.',
    render: (s) => [incomesList(s)],
  },
  {
    title: 'Despesas fixas',
    intro: 'Compromissos mensais que saem de uma conta de gasto (ex.: fatura do cartão). Eles são reservados antes de calcular o seu orçamento diário.',
    render: (s) => [expensesList(s)],
  },
  {
    title: 'Metas (opcional)',
    intro: 'Uma meta usa uma conta de meta/investimento. Aportes planejados saem de uma conta de gasto na data marcada e já são descontados do orçamento.',
    render: (s) => [goalsList(s), contributionsList(s)],
  },
  {
    title: 'Resgates',
    intro: 'Escolha a conta onde os gastos acontecem e a reserva de onde vêm os resgates. O app avisa quando for hora de resgatar.',
    render: (s) => [refillSettings(s)],
  },
];

function welcome() {
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      store.importJSON(await file.text());
      toast('Backup importado');
    } catch (e) {
      toast(`Não foi possível importar: ${e.message}`);
    }
  });
  return [
    h('div', { class: 'welcome' },
      h('img', { src: 'icons/icon-192.png', alt: '', width: 96, height: 96 }),
      h('p', {}, 'O Hoje diz quanto você pode gastar hoje sem faltar dinheiro até o próximo salário.'),
      h('p', { class: 'muted small' }, 'Seus dados ficam só neste aparelho. Nada é enviado para servidores.')),
    h('button', { class: 'btn ghost block', onclick: () => fileInput.click() }, 'Já tenho um backup (importar JSON)'),
    fileInput,
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
      && !(await confirmDialog('Nenhum salário marcado', 'Sem salário, o orçamento usa a próxima receita (ou 30 dias). Continuar mesmo assim?', 'Continuar'))) return;
    if (last) {
      store.finishSetup();
      ctx.navigate('#/hoje', { replace: true });
    } else {
      store.setSetupStep(step + 1);
      window.scrollTo(0, 0);
    }
  };

  return h('div', { class: 'screen setup' },
    h('div', { class: 'steps', 'aria-label': `Passo ${step + 1} de ${STEPS.length}` },
      STEPS.map((_, i) => h('span', { class: i <= step ? 'on' : '' }))),
    h('header', { class: 'screen-head' }, h('h1', {}, cur.title)),
    cur.intro && h('p', { class: 'muted' }, cur.intro),
    cur.render(state),
    h('div', { class: 'row gap setup-nav' },
      step > 0 && h('button', { class: 'btn ghost grow', onclick: () => store.setSetupStep(step - 1) }, 'Voltar'),
      h('button', { class: 'btn primary grow', onclick: next }, step === 0 ? 'Começar' : last ? 'Concluir' : 'Continuar')));
}
