import { formatCredits, parseAmount } from "@casino/shared";
import { useEffect, useState } from "react";
import { useApi } from "../api";

/**
 * Balance as the API reports it, already formatted; the client never computes it.
 * Shows "…" while loading and "--" when the request fails.
 */
export function useBalance(): string {
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

  return text;
}
