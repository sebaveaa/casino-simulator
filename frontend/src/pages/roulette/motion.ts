/** Whether the visitor asked the system for less motion. False where `matchMedia` is missing. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}
