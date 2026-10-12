import { Link } from "react-router";

/** Fallback for unknown paths. */
export function NotFoundPage() {
  return (
    <section>
      <h1>Página no encontrada</h1>
      <p>
        Esa página no existe. <Link to="/">Volver al inicio</Link>
      </p>
    </section>
  );
}
