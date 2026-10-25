/** Provably fair data of the round: the hash before bets, the seed once the result is out. */
export function RaceFairness({
  serverSeedHash,
  serverSeed,
}: {
  serverSeedHash: string;
  serverSeed?: string;
}) {
  return (
    <details className="roulette-fairness races-fairness">
      <summary>Datos de equidad</summary>
      <p className="races-fairness-note">
        El hash del server seed se publica antes de abrir las apuestas. Al terminar la carrera se
        revela el server seed, con el que puede comprobar el resultado.
      </p>
      <dl>
        <dt>Hash del server seed</dt>
        <dd className="amount">{serverSeedHash}</dd>
        {serverSeed && (
          <>
            <dt>Server seed revelado</dt>
            <dd className="amount">{serverSeed}</dd>
          </>
        )}
      </dl>
    </details>
  );
}
