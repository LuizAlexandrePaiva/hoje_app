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
- Produção: o Netlify publica a pasta `app/` a cada push na `main`. Trabalhar em branch e levar para a `main` por PR.

## Sistema visual (versão 1.8.0)

Superfície de tarefa (modo Operate): precisão e consistência acima de expressão.
O dono pediu explicitamente um design **sem cara e vícios de IA**.

- **Tema:** só escuro. Grafite levemente quente: `--bg #121311`, `--surface #1b1c1a`, `--surface-2 #232421`, `--surface-3 #2e2f2b`. Texto `#efeee9`, secundário `#a9aaa1` (5,7:1 ou mais em todos os fundos).
- **Cor:** verde `--pos #62cf8f` só para dinheiro disponível, receitas e ação principal. `--warn #f0b14a` para alerta, `--neg #ff7b6e` para negativo/destrutivo. Alerta sempre com ícone, nunca só cor.
- **Fonte:** Red Hat Text variável (300–700), servida de `app/fonts/` (licença OFL em `app/fonts/OFL.txt`). Escolhida por números tabulares e zero sem corte; a Atkinson Hyperlegible Next foi descartada pelo zero cortado (Ø). Escala: 12 · 14 · 16 · 18 · 22 · 28 · display. Pesos 400/600/700. Nada abaixo de 12 px.
- **Tokens:** tudo em `:root` de `app/css/app.css` (cores, `--fs-*`, `--sp-*` base 4, raios `--r-tag 6`, `--r-control 12`, `--r-card 16`, `--r-sheet 22`). Sem cor fixa nem `style:` visual em JS.
- **Cascata:** utilidades de tom (`.pos`, `.neg`, `.warn-text`) ficam no fim do CSS. Já houve bug em que `.li-sub` anulava o tom de alerta.
- **Formatos:** negativos sempre com U+2212 (`formatBRL` já faz isso); valores com sinal via `formatSigned(cents, ±1)` (gasto "−", receita "+" em verde, transferência neutra com ícone de troca). Datas por extenso em frases ("8 de nov", `formatDayMonth`); `dd/mm` só no eixo do gráfico.
- **Evitar (vícios de template):** brilho radial ou cartão atrás do número do dia; rótulos em caixa alta espaçada acima de títulos; ícones em quadradinho colorido; cartão dentro de cartão; anel/borda colorida em volta de cartões; emoji ou caracteres Unicode (▲ ▼ →) no lugar de ícones; monoespaçada fora do código de recuperação; Inter.
- **Componentes:**
  - **Folhas modais:** `sheet()` em `app/js/ui/dom.js` move o foco, prende o Tab, fecha com Esc, deixa o fundo `inert` e devolve o foco.
  - **Erros de formulário:** `fail(err, msg, input)` em `editors.js` põe a mensagem embaixo do campo, com `aria-invalid` e foco.
  - **Toasts:** só para confirmações curtas, e com "Desfazer" quando a ação muda o cálculo; explicações longas vão dentro da folha.
  - **Listas:** nomes param em até duas linhas, nunca em reticências numa linha só.

## Ferramentas instaladas

- **Impeccable** (skills de design) em `.claude/skills/impeccable/`, versão 4.8.0. O binário do motor fica fora do git e o launcher baixa de novo quando falta. O host `impeccable.style` foi liberado na rede do ambiente "Padrão".
- **Configuração do Impeccable:** `.impeccable/config.json` guarda construção direto no código (`buildPath: code`), o hook ligado e o live mode apontando para `app/index.html`.
- **Hooks:** ficam em `.claude/settings.local.json`, que não vai para o git. Em sessão nova, rodar `/impeccable hooks on` se quiser o hook.
- **Falta o `DESIGN.md`:** ainda não foi gerado. Próximo passo sugerido: `/impeccable document`.

## Histórico

- **2026-11-07, auditoria completa** de design, UX, textos e tipografia: 24 achados (0 P0, 2 P1, 16 P2, 6 P3), nota técnica 14/20. Relatório: https://claude.ai/artifact/JPpZHac8wHhRiK7WcaCQnT
- **2026-11-07, versão 1.8.0:** os 24 achados corrigidos de uma vez, com o refinamento visual acima. Testes: 70 passando. Ficaram sem verificação: aparelho real, ajuste de fonte nativo do iOS/Android e os estados "Salvo" e "Conflito" do backup (dependem do servidor `/api/sync`).
