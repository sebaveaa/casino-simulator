// PROTOTYPE — throwaway, see branch prototype/12-roulette-table
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import "./prototype.css";

const VARIANTS = ["actual", "A", "B", "C"] as const;
const NAMES: Record<(typeof VARIANTS)[number], string> = {
  actual: "Actual",
  A: "A — Mesa clásica",
  B: "B — Boleta y mapa de resultados",
  C: "C — Mesa clásica con bola",
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function PrototypeSwitcher() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("variant");
  const index = Math.max(
    0,
    VARIANTS.indexOf(raw === "A" || raw === "B" || raw === "C" ? raw : "actual"),
  );

  function go(step: number) {
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length] ?? "actual";
    const copy = new URLSearchParams(params);
    if (next === "actual") copy.delete("variant");
    else copy.set("variant", next);
    setParams(copy, { replace: true });
  }

  // Re-bound every render so the handler always sees the current index.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
      if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;

  return (
    <nav className="proto-switcher" aria-label="Variante del prototipo">
      <button type="button" aria-label="Variante anterior" onClick={() => go(-1)}>
        ←
      </button>
      <span aria-live="polite">{NAMES[VARIANTS[index] ?? "actual"]}</span>
      <button type="button" aria-label="Variante siguiente" onClick={() => go(1)}>
        →
      </button>
    </nav>
  );
}
