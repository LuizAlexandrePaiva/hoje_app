# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Uma pessoa só: o próprio dono do app. É uma ferramenta pessoal, não um produto para terceiros. Recebe em datas diferentes ao longo do mês, gasta todos os dias e quer uma resposta rápida, no celular e com uma mão, para "quanto posso gastar hoje?". Decisões podem partir do jeito real dele de receber, gastar e guardar dinheiro, em vez de cobrir perfis genéricos.

## Product Purpose

Calcular, a cada dia, quanto pode ser gasto hoje sem faltar dinheiro até a véspera do próximo salário, considerando o saldo real das contas de gasto, receitas e despesas previstas e aportes em metas. Sobras e excessos se redistribuem no dia seguinte.

Sucesso é abrir o app, ver o número do dia, lançar um gasto em segundos e confiar que o valor está certo, sem precisar refazer contas em outro lugar.

## Positioning

Uma pergunta, respondida com um cálculo que não conta com dinheiro que ainda não chegou: o limite é o menor valor de "disponível até o dia k ÷ dias até k" ao longo de todo o horizonte, então nenhum compromisso no meio do período fica descoberto. Junto disso, sugere quanto resgatar da reserva (ou aplicar do excedente) para a conta de gastos cobrir os próximos dias. Tudo offline, no aparelho, com backup que o servidor não consegue ler.

## Operating Context

- Uso diário no celular, com uma mão, como PWA instalado (Android e iPhone), em português e com valores em R$ e datas no fuso `America/Sao_Paulo`.
- Rotinas: conferir o limite do dia, lançar gastos e receitas, confirmar receitas, contas e aportes quando acontecem, ajustar saldos para bater com o banco, fazer resgates de uma reserva de liquidez diária (por exemplo, um CDB).
- Primeiro acesso passa por um assistente de configuração (contas, receitas, despesas, metas, parâmetros de resgate).
- Telas atuais: Hoje, Linha do tempo, Contas, Metas, Ajustes, Configuração, Novo gasto.

## Capabilities and Constraints

- Limite diário dinâmico, lançamento rápido por teclado numérico, resgates planejados, receitas recorrentes (dia fixo ou Nº dia útil com feriados nacionais) e únicas, confirmação de ocorrências (antecipar, mudar data, marcar que não aconteceu), linha do tempo com saldo projetado em SVG próprio, contas e transferências, metas com aportes, exportação e importação em JSON.
- Stack existente: HTML, CSS e JavaScript puros, sem framework e sem etapa de build. Lógica de cálculo pura e testada em `app/js/core/`. Publicado como site estático no Netlify, com uma função `/api/sync`.
- Funciona 100% offline (service worker cache-first). Nova versão exige subir `CACHE_VERSION` em `app/sw.js` e `APP_VERSION` em `app/js/version.js`.
- Dinheiro em centavos inteiros; datas como `AAAA-MM-DD`.
- Limitações conhecidas: só feriados nacionais; uma moeda e um usuário por backup; recorrências apenas mensais; Safari e app instalado no iPhone não compartilham dados sem o backup.
- Terminologia do produto: "Hoje", "limite diário", "quanto resta", "resgate", "reserva", "excedente", "aporte", "meta", "Linha do tempo", "Ajustes", "código de recuperação".

## Brand Commitments

- Nome: **Hoje**. Frase do produto: "Quanto você pode gastar hoje sem faltar dinheiro até o próximo salário."
- Ícones existentes em `app/icons/`, gerados por `tools/gen-icons.py`.
- Idioma pt-BR em toda a interface.

## Evidence on Hand

- Capturas de tela com dados fictícios em `docs/screenshots/` (`hoje.png`, `novo-gasto.png`, `linha-do-tempo.png`, `metas.png`).
- Cenário fictício de referência em `tests/fixtures.js` (limite de R$ 169,93, resgate sugerido de R$ 1.150).
- Não há depoimentos, usuários externos, métricas de uso nem imprensa. Não inventar nenhum desses.
- Dados pessoais reais nunca entram no código, nos testes nem em materiais visuais; usar valores fictícios.

## Product Principles

1. **Confiança no cálculo vence quando há conflito.** O número do dia precisa ser verificável: quando simplicidade e transparência disputarem espaço, mostrar de onde o valor vem (horizonte, eventos previstos, confirmações, resgates) ganha.
2. **Um número em destaque, um gesto para lançar.** A tela Hoje responde à pergunta principal antes de qualquer outra coisa, e lançar um gasto leva segundos.
3. **Nada mexe no saldo sem confirmação.** Receitas, contas e aportes previstos só viram realidade quando o dono confirma; o app não conta com dinheiro que não chegou.
4. **Os dados são do aparelho.** Offline por padrão; a nuvem só guarda texto cifrado que nem o servidor nem quem perde o código consegue ler.
5. **Cada informação mora em um lugar só.** Receitas, despesas fixas e parâmetros têm um único lugar de edição.
