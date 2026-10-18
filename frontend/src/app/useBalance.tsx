import { formatCredits, parseAmount } from "@casino/shared";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useApi } from "../api";
import { useSession } from "../session";

/** Balance text while the request is pending. */
export const BALANCE_LOADING = "…";

/** The balance in minor units, or why it is not known. */
type Balance = bigint | "loading" | "unavailable";

interface BalanceState {
  balance: Balance;
  /** Re-fetches the balance; it keeps its last value until the answer arrives. */
  refresh: () => Promise<void>;
}

const BalanceContext = createContext<BalanceState | null>(null);

/**
 * Fetches the balance once and shares it with every screen below, so the header chip and the
 * pages always show the same value. Text is already formatted; the client never computes it.
 * Shows "…" while loading and "--" when the request fails or nobody is logged in. It only
 * fetches while a session exists, and fetches again when another user logs in.
 */
export function BalanceProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const userId = useSession()?.user.id ?? null;
  const [balance, setBalance] = useState<Balance>("loading");

  const refresh = useCallback(async () => {
    try {
      const res = await api.getBalance();
      setBalance(parseAmount(res.balance));
    } catch {
      setBalance("unavailable");
    }
  }, [api]);

  useEffect(() => {
    if (userId === null) {
      setBalance("unavailable");
      return;
    }
    setBalance("loading");
    let active = true;
    api
      .getBalance()
      .then((res) => {
        if (active) setBalance(parseAmount(res.balance));
      })
      .catch(() => {
        if (active) setBalance("unavailable");
      });
    return () => {
      active = false;
    };
  }, [api, userId]);

  const value = useMemo(() => ({ balance, refresh }), [balance, refresh]);
  return <BalanceContext.Provider value={value}>{children}</BalanceContext.Provider>;
}

/** Returns the formatted balance. Throws outside a `BalanceProvider`. */
export function useBalance(): string {
  const { balance } = useBalanceState();
  if (balance === "loading") return BALANCE_LOADING;
  if (balance === "unavailable") return "--";
  return formatCredits(balance);
}

/** The balance in minor units, or `null` while it loads or when it is unavailable. */
export function useBalanceAmount(): bigint | null {
  const { balance } = useBalanceState();
  return typeof balance === "bigint" ? balance : null;
}

/** Returns a function that re-fetches the shared balance. Throws outside a `BalanceProvider`. */
export function useRefreshBalance(): () => Promise<void> {
  return useBalanceState().refresh;
}

function useBalanceState(): BalanceState {
  const state = useContext(BalanceContext);
  if (state === null) throw new Error("useBalance must be used inside a <BalanceProvider>");
  return state;
}
