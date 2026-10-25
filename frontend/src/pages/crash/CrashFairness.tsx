/** "Ronda verificable": the hash before takeoff, and the seed once the round has crashed. */
export function CrashFairness({
  serverSeedHash,
  serverSeed,
}: {
  serverSeedHash: string;
  serverSeed?: string;
}) {
  return (
    <details className="crash-fairness">
      <summary>Ronda verificable</summary>
      <p className="crash-fairness-note">
        El hash de la semilla del servidor se publica antes del despegue. Al llegar el impacto se
        revela la semilla, con la que puede comprobar el resultado.
      </p>
      <dl>
        <dt>Hash de la semilla del servidor</dt>
        <dd className="amount">
          <code>{serverSeedHash}</code>
        </dd>
        {serverSeed && (
          <>
            <dt>Semilla revelada</dt>
            <dd className="amount">
              <code>{serverSeed}</code>
            </dd>
          </>
        )}
      </dl>
      {/* The shared verifier (issue #15) is not built yet; this is a placeholder for its link. */}
      <span className="crash-fairness-link">¿Cómo se verifica? (próximamente)</span>
    </details>
  );
}
