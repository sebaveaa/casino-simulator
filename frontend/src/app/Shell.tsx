import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useSession, useSessionStore } from "../session";
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

function SessionControls() {
  const session = useSession();
  const store = useSessionStore();
  const navigate = useNavigate();

  if (!session) {
    return (
      <>
        <Link to="/register" className="button button-secondary">
          Crear cuenta
        </Link>
        <Link to="/login" className="button">
          Iniciar sesión
        </Link>
      </>
    );
  }
  return (
    <>
      <BalanceChip />
      <span className="session-email">{session.user.email}</span>
      <button
        type="button"
        className="button button-secondary"
        onClick={async () => {
          // Leave first: clearing while on a guarded page would redirect to the login screen.
          await navigate("/");
          store.clear();
        }}
      >
        Cerrar sesión
      </button>
    </>
  );
}

/** Layout shared by every page: header, navigation, session controls and footer. */
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
          <SessionControls />
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
