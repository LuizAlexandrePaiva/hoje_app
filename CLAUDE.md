# Hoje: memória do projeto

PWA pessoal de finanças (pt-BR, R$, fuso `America/Sao_Paulo`) que responde
"quanto posso gastar hoje sem faltar dinheiro até o próximo salário". Um único
usuário: o dono do repositório. Detalhes de produto em `PRODUCT.md`; uso,
arquitetura e regras de cálculo em `README.md`.

## Regras de trabalho

- Responder ao dono em português.
- HTML, CSS e JavaScript puros, sem framework e sem etapa de build. Não adicionar dependências no cliente.
- Lógica de cálculo vai para `app/js/core/` (pura, sem DOM, sem relógio), sempre com teste em `tests/`. Rodar `npm test` antes de cada commit.
- Dinheiro em centavos inteiros; datas como `AAAA-MM-DD`; "hoje" vem de `todayISO()`.
- Dados pessoais nunca entram no código, nos testes ou em capturas. Usar o cenário fictício de `tests/fixtures.js`.
- Ao mudar qualquer arquivo em `app/`, subir `CACHE_VERSION` em `app/sw.js` e `APP_VERSION` em `app/js/version.js` (mesmo número). Arquivo novo em `app/` entra também em `APP_FILES` do `sw.js`.
- Produção: o Netlify publica a pasta `app/` a cada push na `main`. Trabalhar em branch e levar para a `main` por PR (mesclado com squash, título "Versão X.Y.Z: resumo (#N)"). Publicar só quando o dono pedir.
- Antes de começar, `git fetch origin main` e partir da `main` atual. Em 10/11 uma sessão trabalhou sobre uma `main` velha (1.7.0) enquanto outra tinha publicado a 1.9.3, e foi preciso juntar as duas à mão.
- O ambiente de nuvem não alcança `hoje-app.netlify.app` (rede bloqueada): a publicação se confere no celular, abrindo o app duas vezes.
- Mudança de cálculo vem com análise antes de mexer: o dono costuma pedir para entender a lógica primeiro. Simular cenários com `tests/fixtures.js` e mostrar números.

## Sistema visual (versão 2.0.0)

Superfície de tarefa (modo Operate): precisão e consistência acima de expressão.
O dono pediu explicitamente um design **sem cara e vícios de IA**. Em 10/11 ele
escolheu o visual 2.0 (abaixo) no lugar do 1.9.3; o que a 1.9.3 trouxe de
acessibilidade e textos foi mantido.

- **Tema:** só escuro, neutro. `--bg #0b0c0f`, `--surface #14161a`, `--surface-2 #1c1f24`, `--surface-3 #2a2e35`, fios `--line #ffffff12`. Texto `#f3f4f6`, secundário `#a3a9b5`.
- **Cor só carrega estado:** verde `--pos #3ddc97` para dinheiro que entra ou folga; vermelho `--neg #ff6b6b` para falta ou ação que apaga; âmbar `--warn #ffb547` quando o app precisa do dono (resgatar, confirmar), sempre com ícone. Ações são neutras: a principal de cada tela é o botão claro (`--primary`), as outras cinza. Não usar verde em botão.
- **Fonte:** Figtree variável, servida de `app/fonts/` (licença em `app/fonts/LICENSE-figtree.txt`). Valores em destaque com `amount()` de `dom.js`: "R$" e centavos menores que a parte inteira.
- **Navegação:** abas Hoje, Linha, + (lançar gasto ou receita, sempre ao alcance do polegar), Contas, Metas. Ajustes abre pelo ícone no topo de Hoje.
- **Tokens:** tudo em `:root` de `app/css/app.css`. Sem cor fixa nem `style:` visual em JS.
- **Cascata:** utilidades de tom (`.pos`, `.neg`, `.warn-text`) ficam no fim do CSS. Já houve bug em que `.li-sub` anulava o tom de alerta.
- **Formatos:** negativos sempre com U+2212 (`formatBRL` já faz isso); valores com sinal via `formatSigned(cents, ±1)` (gasto "−", receita "+" em verde, transferência neutra com ícone de troca). Datas por extenso em frases ("8 de nov", `formatDayMonth`); `dd/mm` só no eixo do gráfico.
- **Evitar (vícios de template):** brilho radial atrás do número do dia; rótulos em caixa alta espaçada; emoji ou caracteres Unicode (▲ ▼ →) no lugar de ícones ou palavras; monoespaçada fora do código de recuperação; Inter.
- **Componentes:**
  - **Folhas modais:** `sheet()` em `app/js/ui/dom.js` move o foco, prende o Tab, fecha com Esc, deixa o fundo `inert` e devolve o foco. Se quem abriu já pôs o foco dentro da folha, ela não mexe.
  - **Erros de formulário:** `fail(err, msg, input)` em `editors.js` põe a mensagem embaixo do campo, com `aria-invalid` e foco.
  - **Toasts:** confirmações curtas, com "Desfazer" quando a ação muda o cálculo; explicações longas vão dentro da folha. Com folha aberta, o toast vai para o topo.
  - **Listas:** o detalhe (`.li-sub`) de linhas com botão e de movimentações quebra linha, nunca corta.
  - **Gráfico da Linha do tempo:** uma linha só, o saldo previsto gastando o limite de cada dia (o limite de cada dia futuro é refeito pela mesma conta do app). Curva suave monotônica (`smoothPath`), verde acima de zero e vermelha abaixo, com frase explicando quando fica negativo. Tocar mostra o valor do dia em destaque acima do gráfico. Sem grade nem legenda.

## Regras de cálculo (versão 2.0.0)

- **Limite:** maior valor diário que não deixa faltar dinheiro em nenhum dia dos próximos 12 meses (sem receita recorrente, 30 dias depois da última receita). Receita de hoje ou atrasada, ainda não confirmada, entra no limite mas não libera gasto. Margem de segurança opcional (`settings.cushion`). Critérios de aceitação: R$ 169,93 e resgate de R$ 1.150 em `tests/fixtures.js`.
- **Fatura de cartão:** despesa fixa com `isCard`; `state.invoices` pela chave da ocorrência. Previsto sem gastos; maior entre previsto e soma com a fatura aberta; soma com a fatura fechada.
- **Poupança sugerida** (`app/js/core/savings.js`): cada receita que entra numa conta de gasto tem o próprio teto, 10% do valor que de fato entrou (R$ 1.000 → até R$ 100; duas receitas, dois tetos). A sugestão é o maior valor em reais inteiros, até o teto e até o saldo da conta da receita, que deixa o limite do dia em pelo menos 90% do gasto típico (gastos dos últimos 30 dias; sem 7 dias de histórico, 90% do limite de hoje). Zero quando o limite já está abaixo disso ("Mês apertado"), quando daria menos de R$ 10 ou de 1% da receita, ou enquanto há receita esperando confirmação. Fica 7 dias em Hoje; uma poupança por receita; na folha dá para digitar até os 10%. Guardar é uma transferência para conta de meta (`savingOf`). Só `type: 'income'` conta: resgate e ajuste de saldo não geram sugestão.
- **Efeito da janela de 12 meses na poupança:** guardar R$ 100 baixa o limite só cerca de R$ 1 por dia, então na prática a sugestão é quase sempre 10% ou nada; o valor parcial aparece numa faixa estreita de aperto (ex.: R$ 74 de R$ 100).

## Em aberto com o dono

- **Poupança:** manter o piso em 90% do gasto típico ou subir para 100% (sugestões menores e irregulares)? Fazer a sugestão encolher aos poucos conforme o mês aperta, em vez de quase sempre 10% ou nada? Ele confirmou que a ideia é "até 10% de cada receita, caso possa" (10/11) e ainda não decidiu esses dois pontos.
- **Dia de receita:** antes de confirmar, Hoje libera só o que caberia sem a receita ("Libera R$ X ao confirmar Salário"). Alternativa oferecida: liberar o limite inteiro quando houver dinheiro em conta e segurar só quando a receita atrasar.
- **Cartão:** sem parcelamento e sem lançar compra no cartão pelo +. Oferecido, não pedido.

## Verificação

- `npm test`: 132 testes (`tests/`), incluindo `limit.test.js`, `invoice.test.js` e `savings.test.js`.
- Além dos testes, cada versão foi conferida no navegador com scripts Playwright (fluxos completos com relógio fixo, auditoria de transbordo a 320, 360, 390 e 430 px, telas em iPhone SE a Pro Max). Esses scripts ficaram no rascunho da sessão e não estão no repositório; recriar quando precisar, com os dados de `tests/fixtures.js`.
- Ainda sem verificação em aparelho real: a 2.0 inteira, o ajuste de fonte nativo do iOS/Android e os estados "Salvo" e "Conflito" do backup.

## Ferramentas instaladas

- **Impeccable** (skills de design) em `.claude/skills/impeccable/`, versão 4.8.0. O binário do motor fica fora do git e o launcher baixa de novo quando falta. O host `impeccable.style` foi liberado na rede do ambiente "Padrão".
- **Configuração do Impeccable:** `.impeccable/config.json` guarda construção direto no código (`buildPath: code`), o hook ligado e o live mode apontando para `app/index.html`.
- **Hooks:** ficam em `.claude/settings.local.json`, que não vai para o git. Em sessão nova, rodar `/impeccable hooks on` se quiser o hook.
- **Falta o `DESIGN.md`:** ainda não foi gerado. Próximo passo sugerido: `/impeccable document`.

## Histórico

- **2026-11-10, análise da poupança:** o dono pediu para conferir se a regra é "no máximo 10% de cada receita". Confirmado em código e em simulação, sem mudar nada; ficaram os pontos de "Em aberto".
- **2026-11-10, publicação da 2.0.0 (PR #3):** a `main` tinha a 1.9.3, feita em outra sessão. O dono comparou os dois visuais lado a lado e escolheu o 2.0; da 1.9.3 entraram acessibilidade, textos e o desfazer "Não veio". A fonte Red Hat Text saiu.
- **2026-11-10, versão 2.0.0:** redesenho inteiro (visual acima), valor de amanhã em Hoje, gráfico de uma linha refeito, nova lógica do limite (janela de 12 meses, receita a confirmar, margem de segurança), fatura de cartão e poupança sugerida. Projetado e revisado com painéis de agentes (propostas independentes, ataque às propostas, revisão adversarial com céticos); 31 achados corrigidos. Juntado com a 1.9.3 mantendo dela a acessibilidade das folhas, os erros embaixo do campo, o sinal de menos, as mensagens e o desfazer "Não veio". Testes: 132 passando.
- **2026-11-10, análise do limite antigo:** três fraquezas encontradas e resolvidas na 2.0: receita atrasada contava como dinheiro disponível; a reserva inteira era gasta até a véspera do salário, com degrau no dia do salário; contas logo depois do salário não pesavam no limite. O dono perguntou qual seria a melhor lógica; a resposta virou a janela de 12 meses com receita a confirmar.

- **2026-11-07, auditoria completa** de design, UX, textos e tipografia: 24 achados (0 P0, 2 P1, 16 P2, 6 P3), nota técnica 14/20. Relatório: https://claude.ai/artifact/JPpZHac8wHhRiK7WcaCQnT
- **2026-11-07, versões 1.9.0 a 1.9.3:** gráfico da Linha do tempo redesenhado três vezes. A 1.9.0 (eixo à direita, faixa de eventos, legenda) foi achada poluída; a 1.9.1 (faixa entre os dois cenários) foi achada confusa. O dono escolheu, entre quatro opções (extrato do futuro, resumo em frases, uma linha só, calendário), o gráfico de uma linha só: 1.9.2. Na 1.9.3 a linha virou curva suave, mais fina, com degradê, porque a reta estava "grosseira". Testes: 70 passando.
- **2026-11-07, versão 1.8.0:** os 24 achados corrigidos de uma vez, com o refinamento visual acima. Testes: 70 passando. Ficaram sem verificação: aparelho real, ajuste de fonte nativo do iOS/Android e os estados "Salvo" e "Conflito" do backup (dependem do servidor `/api/sync`).
