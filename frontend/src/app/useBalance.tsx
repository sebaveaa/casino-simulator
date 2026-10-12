import { formatCredits, parseAmount } from "@casino/shared";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { useApi } from "../api";

const BalanceContext = createContext<string | null>(null);

/**
 * Fetches the balance once and shares it with every screen below, so the header chip and the
 * pages always show the same value. Text is already formatted; the client never computes it.
 * Shows "…" while loading and "--" when the request fails.
 */
export function BalanceProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [text, setText] = useState("…");

  useEffect(() => {
    let active = true;
    api
      .getBalance()
      .then((res) => {
        if (active) setText(formatCredits(parseAmount(res.balance)));
      })
      .catch(() => {
        if (active) setText("--");
      });
    return () => {
      active = false;
    };
  }, [api]);

  return <BalanceContext.Provider value={text}>{children}</BalanceContext.Provider>;
}

/** Returns the formatted balance. Throws outside a `BalanceProvider`. */
export function useBalance(): string {
  const text = useContext(BalanceContext);
  if (text === null) throw new Error("useBalance must be used inside a <BalanceProvider>");
  return text;
}
