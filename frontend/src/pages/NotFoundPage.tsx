import { Link } from "react-router";

/** Fallback for unknown paths. */
export function NotFoundPage() {
  return (
    <section>
      <h1>Page not found</h1>
      <p>
        That page does not exist. <Link to="/">Back to the lobby</Link>
      </p>
    </section>
  );
}
