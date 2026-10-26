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

## Publicar no GitHub Pages

1. Envie os arquivos para a branch `main` do repositório (já feito neste repositório).
2. No GitHub, abra o repositório → **Settings** → **Pages**.
3. Em **Build and deployment** → **Source**, escolha **Deploy from a branch**.
4. Em **Branch**, escolha `main` e a pasta `/ (root)`. Clique em **Save**.
5. Espere 1–2 minutos. O endereço aparece no topo da página de Pages, algo como `https://SEU-USUARIO.github.io/hoje_app/`.

> O GitHub Pages gratuito exige repositório **público**. Isso publica só o código; seus dados continuam só no celular. Com repositório privado, o Pages precisa do GitHub Pro.

### Publicar uma nova versão

Ao mudar qualquer arquivo, aumente `CACHE_VERSION` em `sw.js` (e `APP_VERSION` em `js/version.js`). Assim o celular baixa os arquivos novos. A atualização aparece na segunda vez que o app é aberto depois do deploy.

## Instalar no celular

**Android (Chrome):** abra o endereço do Pages → menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").

**iPhone (Safari):** abra o endereço no **Safari** → botão Compartilhar → **Adicionar à Tela de Início**.

Depois de instalado, abra o app uma vez com internet. A partir daí ele funciona offline.

## Backup

**Ajustes → Backup → Exportar JSON** baixa um arquivo com todos os dados. Para restaurar, use "Importar JSON" no mesmo lugar ou na tela inicial do primeiro acesso. Faça backup antes de trocar de celular ou limpar os dados do navegador.

## Estrutura

```
index.html  manifest.webmanifest  sw.js  css/app.css  icons/
js/app.js                 roteador, renderização, virada de dia
js/core/                  lógica pura (testada no Node)
js/data/                  estado salvo e lançamentos
js/ui/                    componentes, formulários e telas
tests/                    testes (node --test)
tools/gen-icons.py        gera os ícones PNG (Pillow)
```
