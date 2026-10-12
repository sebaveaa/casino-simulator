import { Link, NavLink, Outlet } from "react-router";
import { CoinIcon, DieIcon } from "./icons";
import { useBalance } from "./useBalance";

function BalanceChip() {
  const balance = useBalance();
  return (
    <span className="balance-chip">
      <CoinIcon />
      <strong className="amount">{balance}</strong>
      <span className="balance-label">credits</span>
    </span>
  );
}

/** Layout shared by every page: header, navigation, balance and footer. */
export function Shell() {
  return (
    <div className="shell">
      <header className="site-header">
        <Link to="/" className="brand">
          <DieIcon />
          casino cloud
        </Link>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Lobby
          </NavLink>
          <NavLink to="/wallet">Wallet</NavLink>
        </nav>
        <div className="header-end">
          <BalanceChip />
          <Link to="/login" className="button">
            Log in
          </Link>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        <DieIcon size={28} />
        <p>Fictitious credits only. No real money is involved.</p>
      </footer>
    </div>
  );
}
