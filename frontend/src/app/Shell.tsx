import { Link, NavLink, Outlet } from "react-router";
import { CoinIcon, DieIcon } from "./icons";
import { BALANCE_LOADING, useBalance } from "./useBalance";

function BalanceChip() {
  const balance = useBalance();
  return (
    <span className="balance-chip">
      <CoinIcon />
      <strong className="amount" data-loading={balance === BALANCE_LOADING || undefined}>
        {balance}
      </strong>
      <span className="balance-label">créditos</span>
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
        <nav aria-label="Principal">
          <NavLink to="/" end>
            Inicio
          </NavLink>
          <NavLink to="/wallet">Billetera</NavLink>
        </nav>
        <div className="header-end">
          <BalanceChip />
          <Link to="/login" className="button">
            Iniciar sesión
          </Link>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        <DieIcon size={28} />
        <p>Solo créditos ficticios. No hay dinero real en juego.</p>
      </footer>
    </div>
  );
}
