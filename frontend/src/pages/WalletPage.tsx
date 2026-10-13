import { formatCredits, parseAmount, type Transaction, type TransactionType } from "@casino/shared";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, useApi } from "../api";
import { BALANCE_LOADING, useBalance, useRefreshBalance } from "../app/useBalance";
import { creditsToAmount } from "./creditsInput";

const TYPE_LABELS: Record<TransactionType, string> = {
  deposit: "Depósito",
  withdrawal: "Retiro",
  bet: "Apuesta",
  payout: "Premio",
};

/** Quick-pick deposits, in credits. */
const QUICK_PICKS = [
  { label: "100", value: "100" },
  { label: "500", value: "500" },
  { label: "1.000", value: "1000" },
];

const PAGE_SIZE = 10;

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "network") return "No hay conexión con el servidor. Intente de nuevo.";
    if (error.code === "unauthorized") return "Inicie sesión para continuar.";
    if (error.code === "invalid_request") return "El monto no es válido.";
  }
  return "Ocurrió un error inesperado. Intente de nuevo.";
}

function signedCredits(amount: string): string {
  const value = parseAmount(amount);
  return `${value > 0n ? "+" : ""}${formatCredits(value)}`;
}

type HistoryState = {
  items: Transaction[];
  nextCursor: string | null;
  status: "loading" | "ready" | "error";
  loadingMore: boolean;
};

/** Wallet: balance, simulated deposit and transaction history. */
export function WalletPage() {
  const api = useApi();
  const balance = useBalance();
  const refreshBalance = useRefreshBalance();

  const [amountText, setAmountText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [history, setHistory] = useState<HistoryState>({
    items: [],
    nextCursor: null,
    status: "loading",
    loadingMore: false,
  });
  const [historyError, setHistoryError] = useState<string | null>(null);

  // One Idempotency-Key per submitted amount: a retry of the same amount reuses it.
  const pendingKey = useRef<{ amount: string; key: string } | null>(null);

  const loadFirstPage = useCallback(async () => {
    try {
      const page = await api.listTransactions({ limit: PAGE_SIZE });
      setHistory({
        items: page.items,
        nextCursor: page.nextCursor,
        status: "ready",
        loadingMore: false,
      });
    } catch {
      setHistory((prev) => ({ ...prev, status: "error", loadingMore: false }));
    }
  }, [api]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    if (!history.nextCursor) return;
    setHistory((prev) => ({ ...prev, loadingMore: true }));
    setHistoryError(null);
    try {
      const page = await api.listTransactions({ limit: PAGE_SIZE, cursor: history.nextCursor });
      setHistory((prev) => ({
        ...prev,
        items: [...prev.items, ...page.items],
        nextCursor: page.nextCursor,
        loadingMore: false,
      }));
    } catch {
      setHistory((prev) => ({ ...prev, loadingMore: false }));
      setHistoryError("No se pudieron cargar más movimientos.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const amount = creditsToAmount(amountText);
    if (amount === null) {
      setFieldError("Ingrese un monto mayor que cero, con hasta dos decimales.");
      setStatus(null);
      return;
    }
    setFieldError(null);
    setStatus(null);

    if (pendingKey.current?.amount !== amount) {
      pendingKey.current = { amount, key: crypto.randomUUID() };
    }
    const { key } = pendingKey.current;

    setPending(true);
    try {
      await api.deposit({ amount }, key);
      pendingKey.current = null;
      setAmountText("");
      setStatus({
        kind: "ok",
        text: `Depósito acreditado: ${formatCredits(BigInt(amount))} créditos.`,
      });
      await Promise.all([refreshBalance(), loadFirstPage()]);
    } catch (error) {
      // Keep the key after a network failure so a retry of the same amount charges once.
      if (!(error instanceof ApiError && error.code === "network")) pendingKey.current = null;
      setStatus({ kind: "error", text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="wallet">
      <h1>Billetera</h1>

      <section className="wallet-card" aria-labelledby="wallet-balance-title">
        <h2 id="wallet-balance-title">Saldo actual</h2>
        <p className="wallet-balance">
          <strong className="amount" data-loading={balance === BALANCE_LOADING || undefined}>
            {balance}
          </strong>{" "}
          créditos
        </p>
      </section>

      <section className="wallet-card" aria-labelledby="wallet-deposit-title">
        <h2 id="wallet-deposit-title">Depositar créditos</h2>
        <form onSubmit={submit} noValidate>
          <label htmlFor="deposit-amount">Monto en créditos</label>
          <div className="wallet-row">
            <input
              id="deposit-amount"
              className="wallet-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "deposit-error" : undefined}
            />
            <button type="submit" className="button" disabled={pending}>
              {pending ? "Depositando…" : "Depositar"}
            </button>
          </div>
          <fieldset className="wallet-row wallet-picks" aria-label="Montos rápidos">
            {QUICK_PICKS.map((pick) => (
              <button
                key={pick.value}
                type="button"
                className="button button-secondary"
                disabled={pending}
                onClick={() => {
                  setAmountText(pick.value);
                  setFieldError(null);
                }}
              >
                {pick.label}
              </button>
            ))}
          </fieldset>
          {fieldError && (
            <p id="deposit-error" className="wallet-error">
              {fieldError}
            </p>
          )}
        </form>
        <div aria-live="polite" role="status" className="wallet-status">
          {status && (
            <p className={status.kind === "ok" ? "wallet-ok" : "wallet-error"}>{status.text}</p>
          )}
        </div>
      </section>

      <section className="wallet-card" aria-labelledby="wallet-history-title">
        <h2 id="wallet-history-title">Movimientos</h2>
        {history.status === "loading" && <p>Cargando movimientos…</p>}
        {history.status === "error" && (
          <p className="wallet-error">No se pudieron cargar los movimientos.</p>
        )}
        {history.status === "ready" && history.items.length === 0 && (
          <p>Todavía no hay movimientos.</p>
        )}
        {history.items.length > 0 && (
          <ul className="wallet-history" aria-label="Historial de movimientos">
            {history.items.map((tx) => (
              <li key={tx.id} className="wallet-tx">
                <span className="wallet-tx-type">{TYPE_LABELS[tx.type]}</span>
                <time dateTime={tx.createdAt}>{new Date(tx.createdAt).toLocaleString("es")}</time>
                <span
                  className={`amount wallet-tx-amount ${parseAmount(tx.amount) < 0n ? "negative" : "positive"}`}
                >
                  {signedCredits(tx.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {historyError && <p className="wallet-error">{historyError}</p>}
        {history.nextCursor && (
          <button
            type="button"
            className="button button-secondary"
            disabled={history.loadingMore}
            onClick={() => void loadMore()}
          >
            {history.loadingMore ? "Cargando…" : "Cargar más"}
          </button>
        )}
      </section>
    </div>
  );
}
