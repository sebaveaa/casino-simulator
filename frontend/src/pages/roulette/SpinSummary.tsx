import type { ReactNode } from "react";
import { ChipStackIcon, TicketIcon, TrophyIcon, WalletIcon } from "./SummaryIcons";

export interface SpinSummaryProps {
  /** Text already formatted by the page; the summary only lays it out. */
  staked: string;
  maxWin: string;
  betCount: number;
  /** Balance once the spin is paid for. */
  balanceAfter: string;
  insufficient: boolean;
}

function Item(props: {
  icon: ReactNode;
  caption: string;
  name: string;
  value: string | number;
  className?: string;
}) {
  return (
    <li className={props.className} title={props.name}>
      <span className="roulette-sr-only">{props.name}</span>
      {props.icon}
      <span className="roulette-stat">
        <span className="roulette-cap" aria-hidden="true">
          {props.caption}
        </span>
        <span className="amount">{props.value}</span>
      </span>
    </li>
  );
}

/** What the current slip costs and can return, as icon + number items under the wheel. */
export function SpinSummary(props: SpinSummaryProps) {
  return (
    <ul className="roulette-summary" aria-label="Resumen de la apuesta">
      <Item icon={<ChipStackIcon />} caption="Apostado" name="Apuesta total" value={props.staked} />
      <Item
        icon={<TrophyIcon />}
        caption="hasta"
        name="Ganancia máxima si acierta todo lo posible en un giro"
        value={props.maxWin}
        className="is-hot"
      />
      <Item
        icon={<TicketIcon />}
        caption="Apuestas"
        name="Número de apuestas"
        value={props.betCount}
      />
      <Item
        icon={<WalletIcon />}
        caption="Saldo"
        name="Saldo tras apostar"
        value={props.balanceAfter}
        className={props.insufficient ? "is-negative" : undefined}
      />
    </ul>
  );
}
