import { formatCredits, parseAmount } from "@casino/shared";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { useApi } from "../api";

/** Balance as the API reports it; the client never computes it. */
function BalanceChip() {
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

  return (
    <span className="balance-chip">
      <strong>{text}</strong> credits
    </span>
  );
}

/** Layout shared by every page: header, navigation, balance and footer. */
export function Shell() {
  return (
    <div className="shell">
      <header className="site-header">
        <Link to="/" className="brand">
          Casino Cloud
        </Link>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Lobby
          </NavLink>
          <NavLink to="/wallet">Wallet</NavLink>
        </nav>
        <div className="header-end">
          <BalanceChip />
          <Link to="/login" className="login-link">
            Log in
          </Link>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">Fictitious credits only. No real money is involved.</footer>
    </div>
  );
}
