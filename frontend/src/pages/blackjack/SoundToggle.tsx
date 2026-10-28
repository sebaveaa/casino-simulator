import { useEffect, useState } from "react";
import { isSoundOn, preloadCardSound, setSoundOn } from "./sound";

/** A speaker in the same stroke as the app's other icons; muted, the waves become a cross. */
function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8v4h3l4 3.5v-11L6 8H3z" fill="currentColor" />
      {on ? (
        <>
          <path d="M13 7.5a3.5 3.5 0 0 1 0 5" />
          <path d="M15.5 5a7 7 0 0 1 0 10" />
        </>
      ) : (
        <path d="M13.5 7.5l4 5m0-5l-4 5" />
      )}
    </svg>
  );
}

/**
 * Turns the table's sound on or off: the cards, the chips and the result. The choice is kept in
 * this browser.
 */
export function SoundToggle() {
  const [on, setOn] = useState(isSoundOn);
  // Decoded before the first deal, so the first card already sounds.
  useEffect(() => {
    void preloadCardSound();
  }, []);
  return (
    <button
      type="button"
      className="bj-sound"
      aria-label="Sonido de la mesa"
      aria-pressed={on}
      title={on ? "Silenciar la mesa" : "Activar el sonido de la mesa"}
      onClick={() => {
        setSoundOn(!on);
        setOn(!on);
      }}
    >
      <SpeakerIcon on={on} />
    </button>
  );
}
