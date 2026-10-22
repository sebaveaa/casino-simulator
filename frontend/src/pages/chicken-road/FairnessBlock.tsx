import { ShieldArt } from "./art";

/**
 * "Partida verificable": the server seed hash of this game, or of the active pair before a game
 * starts (it is the one the next game will use). "¿Cómo se verifica?" opens the client seed and
 * the nonce for now; the verifier (#15) will replace it with a link.
 */
export function FairnessBlock({
  fairness,
}: {
  fairness: { serverSeedHash: string; clientSeed: string; nonce: number } | null;
}) {
  return (
    <section className="cr-fair" aria-label="Partida verificable">
      <p className="cr-fair-title">
        <ShieldArt />
        Partida verificable
      </p>
      <p className="cr-fair-label">Hash de la semilla del servidor</p>
      <code className="cr-hash">{fairness?.serverSeedHash ?? "…"}</code>
      <details className="cr-fair-details">
        <summary>¿Cómo se verifica?</summary>
        <dl>
          <dt>Client seed</dt>
          <dd className="amount">{fairness?.clientSeed ?? "…"}</dd>
          <dt>Nonce</dt>
          <dd className="amount" data-testid="cr-nonce">
            {fairness?.nonce ?? "…"}
          </dd>
        </dl>
      </details>
    </section>
  );
}
