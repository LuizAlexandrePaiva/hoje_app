// Cenário FICTÍCIO, estruturalmente equivalente ao descrito na especificação
// (mesmas datas e regras; nomes e valores inventados). Os saldos das contas de
// gasto somam R$ 2.379, o que reproduz os números do teste de aceitação:
//   orçamento = 2.379 ÷ 14 = R$ 169,93
//   resgate   = 169,93 × 7 − 64 = 1.125,51 → R$ 1.150

export const TODAY = '2026-10-26'; // segunda-feira

export function scenario() {
  return {
    version: 1,
    setupDone: true,
    createdAt: TODAY,
    accounts: [
      { id: 'cc', name: 'Conta Corrente', kind: 'spending', balance: 6400 },
      { id: 'cdb', name: 'CDB Liquidez', kind: 'spending', balance: 231500 },
      { id: 'fundo', name: 'Fundo da Meta', kind: 'goal', balance: 390000 },
    ],
    settings: {
      defaultAccountId: 'cc',
      reserveAccountId: 'cdb',
      refill: { thresholdDays: 3, targetDays: 7, step: 5000 },
      surplusEnabled: true,
    },
    incomes: [
      { id: 'sal', name: 'Salário', amount: 250000, accountId: 'cc', isSalary: true,
        rule: { type: 'businessDay', n: 5, countSaturday: false }, exceptions: {}, since: TODAY },
      { id: 'alugA', name: 'Aluguel Sala', amount: 135000, accountId: 'cc',
        rule: { type: 'fixedDay', day: 11 }, exceptions: {}, since: TODAY },
      { id: 'alugB', name: 'Aluguéis Diversos', amount: 290000, accountId: 'cc',
        rule: { type: 'fixedDay', day: 20 }, exceptions: {}, since: TODAY },
    ],
    expenses: [
      // vencimento dia 25: a de outubro (25/10) é anterior ao cadastro, já paga
      { id: 'fatura', name: 'Fatura do cartão', amount: 18000, accountId: 'cc', day: 25, exceptions: {}, since: TODAY },
    ],
    goals: [
      { id: 'viagem', name: 'Viagem de Férias', target: 550000, deadline: '2026-11-27', accountId: 'fundo' },
    ],
    contributions: [
      { id: 'ap1', goalId: 'viagem', amount: 160000, date: '2026-11-20', fromAccountId: 'cc' },
    ],
    settled: {},
    transactions: [],
  };
}
