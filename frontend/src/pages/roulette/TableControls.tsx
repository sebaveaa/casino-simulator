export interface TableControlsProps {
  canUndo: boolean;
  canClear: boolean;
  canRepeat: boolean;
  canDouble: boolean;
  canSpin: boolean;
  /** Text of the main button: "Girar", "Enviando…" or "Girando…". */
  spinLabel: string;
  onUndo: () => void;
  onClear: () => void;
  onRepeat: () => void;
  onDouble: () => void;
  onSpin: () => void;
}

/** Edit buttons for the chips on the felt and the prominent Girar. */
export function TableControls(props: TableControlsProps) {
  return (
    <div className="roulette-controls">
      <button
        type="button"
        className="button button-secondary"
        disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        Deshacer
      </button>
      <button
        type="button"
        className="button button-secondary"
        disabled={!props.canClear}
        onClick={props.onClear}
      >
        Limpiar
      </button>
      <button
        type="button"
        className="button button-secondary"
        disabled={!props.canRepeat}
        onClick={props.onRepeat}
      >
        Repetir
      </button>
      <button
        type="button"
        className="button button-secondary"
        disabled={!props.canDouble}
        onClick={props.onDouble}
      >
        Doblar
      </button>
      <button
        type="button"
        className="button roulette-spin"
        disabled={!props.canSpin}
        onClick={props.onSpin}
      >
        {props.spinLabel}
      </button>
    </div>
  );
}
