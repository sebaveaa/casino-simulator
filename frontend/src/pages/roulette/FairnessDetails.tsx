import type { RouletteBetResponse } from "@casino/shared";

/** The data needed to verify the spin afterwards (README §5). */
export function FairnessDetails({ fairness }: { fairness: RouletteBetResponse["fairness"] }) {
  return (
    <details className="roulette-fairness">
      <summary>Datos de equidad</summary>
      <dl>
        <dt>Hash del server seed</dt>
        <dd className="amount">{fairness.serverSeedHash}</dd>
        <dt>Client seed</dt>
        <dd className="amount">{fairness.clientSeed}</dd>
        <dt>Nonce</dt>
        <dd className="amount">{fairness.nonce}</dd>
      </dl>
    </details>
  );
}
