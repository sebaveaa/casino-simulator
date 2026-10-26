import { useState } from "react";
import { isSoundOn, setSoundOn } from "./cardSound";

/** Turns the card sound on or off; the choice is kept in this browser. */
export function SoundToggle() {
  const [on, setOn] = useState(isSoundOn);
  return (
    <button
      type="button"
      className="cr-pill bj-sound"
      aria-pressed={on}
      onClick={() => {
        setSoundOn(!on);
        setOn(!on);
      }}
    >
      <span aria-hidden="true">{on ? "🔊" : "🔇"}</span> Sonido
    </button>
  );
}
