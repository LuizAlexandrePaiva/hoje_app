// Regras de lançamento: toda transação tira `amount` de `from` e põe em `to`.
// Tipos: spend (gasto), transfer, adjust (ajuste manual; amount pode ser
// negativo), income, expense, contribution (aporte em meta).

function findAccount(state, id) {
  return id ? state.accounts.find((a) => a.id === id) : null;
}

function move(state, tx, sign) {
  const from = findAccount(state, tx.from);
  const to = findAccount(state, tx.to);
  if (from) from.balance -= sign * tx.amount;
  if (to) to.balance += sign * tx.amount;
}

/** Aplica a transação (muta o estado) e a registra. */
export function applyTransaction(state, tx) {
  move(state, tx, 1);
  state.transactions = state.transactions || [];
  state.transactions.push(tx);
  if (tx.ref) {
    state.settled = state.settled || {};
    state.settled[tx.ref] = { date: tx.date, amount: tx.amount, txId: tx.id };
  }
  return tx;
}

/** Desfaz a transação, devolvendo os saldos e reabrindo a ocorrência. */
export function revertTransaction(state, txId) {
  const idx = (state.transactions || []).findIndex((t) => t.id === txId);
  if (idx < 0) return null;
  const [tx] = state.transactions.splice(idx, 1);
  move(state, tx, -1);
  if (tx.ref && state.settled?.[tx.ref]?.txId === tx.id) delete state.settled[tx.ref];
  return tx;
}
