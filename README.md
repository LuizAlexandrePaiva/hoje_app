# Hoje

PWA de finanças pessoais focado em uma pergunta: **quanto posso gastar hoje sem faltar dinheiro até o próximo salário?**

HTML, CSS e JavaScript puros, sem framework e sem build. Funciona 100% offline depois da primeira visita. Os dados ficam só no aparelho (localStorage), com backup em JSON.

Nenhum dado pessoal está no código. No primeiro acesso, um assistente pede contas, receitas, despesas fixas, metas e parâmetros de resgate.

## Rodar localmente

```bash
python3 -m http.server 8080      # ou: npx serve .
```

Abra http://localhost:8080. O service worker funciona em `localhost` sem HTTPS.

Para simular outro dia, use as DevTools do Chrome → *Sensors* → *Location/Timezone*. Ou altere a data do computador.

## Testes

```bash
npm test          # = node --test (Node 18+, sem dependências)
```

| Arquivo | O que cobre |
|---|---|
| `tests/businessDays.test.js` | Páscoa, feriados nacionais, Nº dia útil, regra do sábado, datas sem bug de fuso |
| `tests/budget.test.js` | orçamento diário (aceitação), gastos de hoje, recálculo no dia seguinte, resgate neutro, salário |
| `tests/refill.test.js` | cobertura da conta padrão, sugestão de resgate (aceitação), corte por receita, limite da reserva, excedente |
| `tests/schedule.test.js` | expansão de receitas, despesas e aportes; pendências "Recebeu?" |
| `tests/money.test.js` | leitura de valores em pt-BR ("2.315", "1.234,56") |

Os testes usam um cenário **fictício** (`tests/fixtures.js`), equivalente ao da especificação: as contas de gasto somam R$ 2.379. Com isso eles verificam exatamente o seguinte:

- 5º dia útil de nov/2026 = 9/11
- orçamento = R$ 169,93
- cobertura = 0 dias e resgate sugerido = R$ 1.150
- registrar o resgate não altera o orçamento

## Como o cálculo funciona

- `js/core/budget.js` → `computeDailyBudget(state, hoje)` é uma função pura. Dinheiro gastável no início do dia = saldos das contas de gasto + gastos de hoje. Para cada dia k até a véspera do próximo salário: `(gastável + receitas − despesas − aportes previstos até k) ÷ (k+1)`. O orçamento é o menor desses valores.
- `js/core/refill.js` cuida da cobertura da conta padrão e da sugestão de resgate. A sugestão é `orçamento × dias + compromissos − saldo`, arredondada para cima em múltiplos de R$ 50 e limitada à reserva. O período termina antes se uma receita cair na conta padrão.
- Receitas, despesas e aportes só mexem no saldo quando você confirma ("Recebeu?" / "Pagou?" / "Fez o aporte?"). Até lá, contam como previstos. Se atrasarem, contam como previstos para hoje.
- Datas são strings `AAAA-MM-DD`, e "hoje" é calculado no fuso `America/Sao_Paulo`. Valores são guardados em centavos inteiros.

## Publicar no Netlify

O site é estático e não tem build. O `netlify.toml` já configura tudo: publica a pasta raiz e envia o `sw.js` sem cache, para as atualizações chegarem.

### Opção 1 — ligado ao GitHub (recomendada: cada push publica sozinho)

1. Entre em https://app.netlify.com (dá para criar a conta com o GitHub).
2. **Add new site** → **Import an existing project** → **GitHub**.
3. Autorize o Netlify e escolha o repositório **hoje_app**.
4. Confira as configurações (o `netlify.toml` já preenche):
   - **Branch to deploy:** `main`
   - **Build command:** deixe vazio
   - **Publish directory:** `.`
5. Clique em **Deploy**. Em menos de 1 minuto o site fica no ar em `https://nome-aleatorio.netlify.app`.
6. Para escolher o nome: **Site configuration** → **Change site name** (ex.: `hoje-financas` → `https://hoje-financas.netlify.app`).

Funciona com repositório **privado** no plano gratuito. A partir daí, todo `git push` na `main` publica uma nova versão.

### Opção 2 — arrastar e soltar (sem GitHub)

1. Baixe o repositório como ZIP e descompacte.
2. Entre em https://app.netlify.com/drop, faça login e arraste a pasta.
3. Para atualizar, arraste a pasta de novo em **Deploys** do site.

### Publicar uma nova versão

Ao mudar qualquer arquivo, aumente `CACHE_VERSION` em `sw.js` (e `APP_VERSION` em `js/version.js`). Assim o celular baixa os arquivos novos. A atualização aparece na segunda vez que o app é aberto depois do deploy.

## Instalar no celular

**Android (Chrome):** abra o endereço do Netlify → menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").

**iPhone (Safari):** abra o endereço no **Safari** → botão Compartilhar → **Adicionar à Tela de Início**.

Depois de instalado, abra o app uma vez com internet. A partir daí ele funciona offline.

## Backup

**Ajustes → Backup → Exportar JSON** baixa um arquivo com todos os dados. Para restaurar, use "Importar JSON" no mesmo lugar ou na tela inicial do primeiro acesso. Faça backup antes de trocar de celular ou limpar os dados do navegador.

## Estrutura

```
index.html  manifest.webmanifest  sw.js  netlify.toml  css/app.css  icons/
js/app.js                 roteador, renderização, virada de dia
js/core/                  lógica pura (testada no Node)
js/data/                  estado salvo e lançamentos
js/ui/                    componentes, formulários e telas
tests/                    testes (node --test)
tools/gen-icons.py        gera os ícones PNG (moeda com R$; Pillow + fonte Inter)
```
