// Telas do backup na nuvem: ativar, ver o código, restaurar e resolver conflito.

import { h, sheet, toast, confirmDialog } from './dom.js';
import { icon } from './icons.js';
import * as sync from '../data/sync.js';
import { formatCode } from '../core/vault.js';
import { TIME_ZONE, formatShort } from '../core/dates.js';

const BANNER_KEY = 'hoje:aviso-backup';
const BANNER_SNOOZE_DAYS = 7;
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return 'agora';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(d);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
  return day === today ? `às ${timeFmt.format(d)}` : `em ${formatShort(day)}`;
}

export function statusText(st = sync.getStatus()) {
  switch (st.status) {
    case 'off': return 'Desativado';
    case 'syncing': return 'Salvando';
    case 'pending': return 'Alterações a enviar';
    case 'offline': return 'Sem internet, envia quando voltar';
    case 'conflict': return 'Dados diferentes na nuvem';
    case 'error': return 'Não deu para salvar, tentando de novo';
    default: return `Salvo ${when(st.lastSyncAt)}`;
  }
}

export function codeBox(code) {
  const pretty = formatCode(code);
  const copy = async () => {
    try { await navigator.clipboard.writeText(pretty); toast('Código copiado'); } catch { toast('Selecione e copie o código'); }
  };
  const share = async () => {
    try { await navigator.share({ title: 'Código do Hoje', text: `Código de recuperação do Hoje: ${pretty}` }); } catch { /* cancelado */ }
  };
  return [
    h('p', { class: 'code-box', 'aria-label': `Código de recuperação: ${pretty}` }, pretty.split(' ').map((g) => h('span', {}, g))),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn grow', onclick: copy }, 'Copiar'),
      typeof navigator.share === 'function' && h('button', { class: 'btn grow', onclick: share }, 'Compartilhar')),
  ];
}

export function codeSheet(code = sync.getStatus().code) {
  if (!code) return;
  sheet('Código de recuperação', (close) => [
    h('p', { class: 'sheet-lead' }, 'Guarde em lugar seguro, como o app de notas ou um gerenciador de senhas. Só ele abre o seu backup.'),
    codeBox(code),
    h('button', { class: 'btn primary block', onclick: close }, 'Já guardei'),
  ]);
}

export function enableSheet() {
  sheet('Backup na nuvem', () => [
    h('ul', { class: 'features' },
      feature('check', 'Automático', 'Cada mudança é salva sozinha.'),
      feature('wallet', 'Criptografado', 'Só o seu código abre. Nem o servidor lê.'),
      feature('transfer', 'Em qualquer lugar', 'Safari, app instalado ou celular novo.')),
    h('button', { class: 'btn primary block', onclick: () => codeSheet(sync.enable()) }, 'Ativar e ver meu código'),
  ]);
}

function feature(ico, title, sub) {
  return h('li', {}, icon(ico, { size: 20 }),
    h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, title), h('span', { class: 'li-sub' }, sub)));
}

export function restoreSheet({ replacing = false, fileButton } = {}) {
  const input = h('input', {
    type: 'text', class: 'code-input', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
    placeholder: 'XXXX XXXX XXXX XXXX XXXX XXXX', 'aria-label': 'Código de recuperação',
  });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn primary block' }, 'Restaurar');
  sheet('Restaurar dados', (close) => h('form', {
    class: 'form', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (replacing && !(await confirmDialog('Trocar os dados?', 'Os dados deste aparelho serão substituídos pelos do backup.', 'Trocar', true))) return;
      submit.disabled = true;
      submit.textContent = 'Restaurando';
      try {
        await sync.restore(input.value);
        close();
        toast('Dados restaurados');
      } catch (x) {
        err.textContent = x.message;
        submit.disabled = false;
        submit.textContent = 'Restaurar';
      }
    },
  },
  h('p', { class: 'sheet-lead' }, 'Digite o código de recuperação que você guardou.'),
  input,
  err,
  submit,
  fileButton));
}

export function conflictSheet(meta = {}) {
  const at = meta.updatedAt ? ` (${when(meta.updatedAt)})` : '';
  sheet('Dados diferentes na nuvem', (close) => [
    h('p', { class: 'sheet-lead' }, `A nuvem tem uma versão mais nova${at}, salva em outro lugar. Este aparelho também mudou. Qual fica?`),
    h('button', {
      class: 'btn primary block',
      onclick: async () => {
        try { await sync.useRemote(); close(); toast('Usando os dados da nuvem'); } catch (e) { toast(e.message); }
      },
    }, 'Usar os da nuvem'),
    h('button', {
      class: 'btn block',
      onclick: async () => {
        if (!(await confirmDialog('Manter os deste aparelho?', 'A versão da nuvem será substituída por esta.', 'Manter', true))) return;
        await sync.keepLocal();
        toast('Nuvem atualizada com este aparelho');
      },
    }, 'Manter os deste aparelho'),
  ]);
}

/** Lembrete discreto em Hoje enquanto o backup estiver desligado. */
export function backupBanner(ctx) {
  if (sync.getStatus().enabled || !ctx.state.setupDone) return null;
  let snoozed = 0;
  try { snoozed = Number(localStorage.getItem(BANNER_KEY)) || 0; } catch { /* sem acesso */ }
  if (Date.now() - snoozed < BANNER_SNOOZE_DAYS * 86400000) return null;
  const card = h('section', { class: 'card flush' },
    h('div', { class: 'row-item' },
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title' }, 'Proteja seus dados'),
        h('span', { class: 'li-sub' }, 'Backup criptografado')),
      h('button', { class: 'btn small primary', onclick: enableSheet }, 'Ativar'),
      h('button', {
        class: 'icon-btn', 'aria-label': 'Lembrar depois',
        onclick: () => { try { localStorage.setItem(BANNER_KEY, String(Date.now())); } catch { /* ok */ } card.remove(); },
      }, icon('close', { size: 18 }))));
  return card;
}

/** Cartão em Ajustes. */
export function cloudCard() {
  const st = sync.getStatus();
  const tone = { synced: 'pos', conflict: 'warn-text', error: 'warn-text' }[st.status] ?? '';
  return h('section', { class: 'card' },
    h('div', { class: 'li-main' },
      h('h3', { class: 'card-title' }, 'Backup na nuvem'),
      h('span', { class: `li-sub ${tone}` }, statusText(st))),
    st.enabled
      ? [
        st.status === 'conflict' && h('button', { class: 'btn warn block', onclick: () => conflictSheet() }, 'Resolver'),
        h('div', { class: 'form-actions' },
          h('button', { class: 'btn grow', onclick: () => codeSheet() }, 'Ver código'),
          h('button', { class: 'btn grow', onclick: () => sync.syncNow() }, 'Salvar agora')),
        h('button', {
          class: 'btn quiet block',
          onclick: async () => {
            if (await confirmDialog('Desativar backup?', 'A cópia na nuvem será apagada. Os dados deste aparelho continuam.', 'Desativar', true)) {
              try { await sync.disable({ deleteRemote: true }); toast('Backup desativado'); } catch { toast('Sem conexão para apagar a cópia'); }
            }
          },
        }, 'Desativar'),
      ]
      : [
        h('p', { class: 'small muted' }, 'Guarda uma cópia criptografada a cada mudança. Use o código para recuperar no Safari, no app instalado ou em outro celular.'),
        h('button', { class: 'btn primary block', onclick: enableSheet }, 'Ativar backup'),
        h('button', { class: 'btn quiet block', onclick: () => restoreSheet({ replacing: true }) }, 'Restaurar com código'),
      ]);
}

/** Passo final da configuração inicial. */
export function backupStepCard() {
  const st = sync.getStatus();
  if (st.enabled) {
    return h('section', { class: 'card' },
      h('p', { class: 'li-title pos' }, 'Backup ativo'),
      h('p', { class: 'small muted' }, 'Guarde este código. Sem ele, ninguém abre o backup, nem você.'),
      codeBox(st.code));
  }
  return h('section', { class: 'card' },
    h('ul', { class: 'features' },
      feature('check', 'Automático', 'Cada mudança é salva sozinha.'),
      feature('wallet', 'Criptografado', 'Só o seu código abre. Nem o servidor lê.'),
      feature('transfer', 'Em qualquer lugar', 'Safari, app instalado ou celular novo.')),
    h('button', { class: 'btn primary block', onclick: () => sync.enable() }, 'Ativar backup'));
}
