// Fatura de cartão: os gastos discriminados de UMA ocorrência de despesa fixa
// marcada como cartão. Mora em state.invoices[chave da ocorrência]; guardamos
// só os itens e se a fatura está fechada. Soma, total e resto são calculados.
// Funções puras, sem DOM e sem armazenamento.

const KEY_RE = /^expense:(.+):(\d{4}-(?:0[1-9]|1[0-2]))$/;

/** Chave da fatura = chave da ocorrência da despesa naquele mês. */
export function invoiceKey(expenseId, month) {
  return `expense:${expenseId}:${month}`;
}

export function parseInvoiceKey(key) {
  const m = typeof key === 'string' ? KEY_RE.exec(key) : null;
  return m ? { expenseId: m[1], month: m[2] } : null;
}

const validAmount = (v) => Number.isSafeInteger(v) && v > 0;

/**
 * Resumo da fatura de um mês. `estimate` é o valor previsto da despesa no mês
 * (exceção do mês ou valor fixo).
 *  - sem gastos: vale o previsto;
 *  - aberta: o maior entre previsto e soma (lista incompleta não libera dinheiro);
 *  - fechada: a soma dos gastos.
 * `rest` é o que falta para a soma chegar ao total (só em fatura aberta).
 */
export function invoiceSummary(estimate, invoice) {
  const est = Number.isFinite(estimate) ? estimate : 0;
  let sum = 0;
  let count = 0;
  for (const it of (Array.isArray(invoice?.items) ? invoice.items : [])) {
    if (validAmount(it?.amount)) { sum += it.amount; count++; }
  }
  const closed = count > 0 && invoice.closed === true;
  const total = count === 0 ? est : closed ? sum : Math.max(est, sum);
  return { estimate: est, sum, count, closed, total, rest: count > 0 ? total - sum : 0 };
}

/**
 * Lê state.invoices de qualquer backup e devolve um mapa íntegro: só chaves de
 * despesas que existem, itens com id único e valor inteiro positivo, nenhuma
 * fatura vazia. `nameMax` corta nomes longos.
 */
export function sanitizeInvoices(raw, expenses = [], nameMax = 60) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const known = new Set((expenses || []).map((e) => e.id));
  for (const [key, inv] of Object.entries(raw)) {
    const p = parseInvoiceKey(key);
    if (!p || !known.has(p.expenseId) || !inv || typeof inv !== 'object' || !Array.isArray(inv.items)) continue;
    const seen = new Set();
    const items = [];
    for (const it of inv.items) {
      if (!it || typeof it !== 'object' || !validAmount(it.amount)) continue;
      let id = typeof it.id === 'string' && it.id ? it.id : '';
      for (let n = items.length; !id || seen.has(id); n++) id = `it_${n}`;
      seen.add(id);
      items.push({ id, name: String(it.name ?? '').replace(/\s+/g, ' ').trim().slice(0, nameMax), amount: it.amount });
    }
    if (!items.length) continue;
    out[key] = inv.closed === true ? { items, closed: true } : { items };
  }
  return out;
}
