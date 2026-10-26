# Hoje

PWA de finanças pessoais focado em uma pergunta: **quanto posso gastar hoje sem faltar dinheiro até o próximo salário?**

HTML, CSS e JavaScript puros, sem framework e sem build. Funciona 100% offline depois da primeira visita. Os dados ficam no aparelho (localStorage), com backup opcional na nuvem, criptografado no próprio celular, e backup em arquivo JSON.

Nenhum dado pessoal está no código. No primeiro acesso, um assistente pede contas, receitas, despesas fixas, metas, parâmetros de resgate e oferece o backup.

## Rodar localmente

```bash
npm start            # serve a pasta app/ em http://localhost:8080
```

O service worker funciona em `localhost` sem HTTPS. Para testar também o backup na nuvem localmente, use `npx netlify dev`, que roda a função `/api/sync` com um Blobs local.

Para simular outro dia, use as DevTools do Chrome (*Sensors*) ou altere a data do computador.

## Testes

```bash
npm install          # só a dependência da função do servidor
npm test             # = node --test
```

| Arquivo | O que cobre |
|---|---|
| `tests/businessDays.test.js` | Páscoa, feriados nacionais, Nº dia útil, regra do sábado, datas sem bug de fuso |
| `tests/budget.test.js` | orçamento diário (aceitação), gastos de hoje, recálculo no dia seguinte, resgate neutro, salário |
| `tests/refill.test.js` | cobertura da conta padrão, sugestão de resgate (aceitação), corte por receita, limite da reserva, excedente |
| `tests/schedule.test.js` | expansão de receitas, despesas e aportes; pendências "Recebeu?" |
| `tests/money.test.js` | leitura de valores em pt-BR ("2.315", "1.234,56") |
| `tests/vault.test.js` | código de recuperação, derivação de chaves, criptografia e adulteração |
| `tests/sync-core.test.js` | API do backup: revisões, conflitos, corrida entre aparelhos, validação |

Os testes usam um cenário **fictício** (`tests/fixtures.js`), equivalente ao da especificação: as contas de gasto somam R$ 2.379. Com isso eles verificam exatamente o seguinte:

- 5º dia útil de nov/2026 = 9/11
- orçamento = R$ 169,93
- cobertura = 0 dias e resgate sugerido = R$ 1.150
- registrar o resgate não altera o orçamento

## Como o cálculo funciona

- `app/js/core/budget.js`: `computeDailyBudget(state, hoje)` é uma função pura. Dinheiro gastável no início do dia = saldos das contas de gasto + gastos de hoje. Para cada dia k até a véspera do próximo salário: `(gastável + receitas − despesas − aportes previstos até k) ÷ (k+1)`. O orçamento é o menor desses valores.
- `app/js/core/refill.js` cuida da cobertura da conta padrão e da sugestão de resgate: `orçamento × dias + compromissos − saldo`, arredondada para cima em múltiplos de R$ 50 e limitada à reserva. O período termina antes se uma receita cair na conta padrão.
- Receitas, despesas e aportes só mexem no saldo quando você confirma ("Recebeu?", "Pagou?", "Aportou?"). Até lá, contam como previstos. Se atrasarem, contam como previstos para hoje.
- Datas são strings `AAAA-MM-DD`, e "hoje" é calculado no fuso `America/Sao_Paulo`. Valores são guardados em centavos inteiros.

## Backup na nuvem

No iPhone, o Safari e o app instalado na tela inicial guardam dados **separados**, e remover o ícone apaga os dados do app. O backup na nuvem resolve isso:

1. Em um deles: **Ajustes → Backup na nuvem → Ativar backup**. Guarde o código de recuperação de 24 caracteres.
2. No outro (ou num celular novo): na tela inicial, **Já tenho um backup**, ou **Ajustes → Restaurar com código**.

A partir daí, cada mudança é enviada sozinha e, ao abrir o app, a versão mais nova é baixada. Se os dois lados mudaram ao mesmo tempo, o app pergunta qual versão fica. Nada é sobrescrito sem aviso.

**Privacidade:** os dados são comprimidos e criptografados (AES-256-GCM) no aparelho antes de sair. A chave é derivada do código de recuperação (HKDF-SHA-256) e nunca é enviada; o servidor guarda só o texto cifrado no Netlify Blobs, identificado por um hash do código. Sem o código, ninguém abre o backup, nem você. Por isso, guarde-o bem.

Arquivos: `app/js/core/vault.js` (criptografia), `app/js/data/sync.js` (sincronização), `netlify/lib/sync-core.mjs` (API) e `netlify/functions/sync.mjs` (função do Netlify).

## Publicar no Netlify

O `netlify.toml` já configura tudo: publica a pasta `app/`, cria a função `/api/sync` e envia o `sw.js` sem cache. O Netlify Blobs é ativado sozinho para a função, sem nenhuma configuração extra.

1. Entre em https://app.netlify.com e escolha **Add new site → Import an existing project → GitHub**.
2. Escolha o repositório **hoje_app** e a branch `main`. Deixe *Build command* vazio; o *Publish directory* vem do `netlify.toml` (`app`).
3. Clique em **Deploy**. Para escolher o endereço: **Site configuration → Change site name**.

Funciona com repositório privado no plano gratuito. Todo `git push` na `main` publica uma nova versão.

### Publicar uma nova versão

Ao mudar qualquer arquivo do app, aumente `CACHE_VERSION` em `app/sw.js` (e `APP_VERSION` em `app/js/version.js`). Assim o celular baixa os arquivos novos. A atualização aparece na segunda vez que o app é aberto depois do deploy.

## Instalar no celular

**Android (Chrome):** abra o endereço do Netlify, menu ⋮, **Instalar app**.

**iPhone (Safari):** abra o endereço no **Safari**, botão Compartilhar, **Adicionar à Tela de Início**.

Depois de instalado, abra o app uma vez com internet. A partir daí ele funciona offline.

## Estrutura

```
app/                      o site publicado (estático)
  index.html  manifest.webmanifest  sw.js  css/  icons/
  js/app.js               roteador, renderização, virada de dia
  js/core/                lógica pura (testada no Node)
  js/data/                estado salvo, lançamentos e backup na nuvem
  js/ui/                  componentes, formulários e telas
netlify/                  função /api/sync do backup
tests/                    testes (node --test)
tools/gen-icons.py        gera os ícones PNG (Pillow + fonte Inter)
netlify.toml              configuração do Netlify
```
