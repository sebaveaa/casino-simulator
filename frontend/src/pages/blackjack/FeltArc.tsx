import { useId } from "react";

/** Arc paths and box for each place: the whole table, or the bet's felt patch. */
const SHAPES = {
  table: {
    viewBox: "0 0 600 120",
    outer: "M 30 16 Q 300 106 570 16",
    inner: "M 130 74 Q 300 140 470 74",
  },
  spot: {
    viewBox: "0 0 300 110",
    outer: "M 16 18 Q 150 84 284 18",
    inner: "M 56 62 Q 150 108 244 62",
  },
};

/**
 * Text printed on the felt in two arcs, like a casino table: `main` on the outer arc, `sub` on
 * the inner one. The arcs are decorative; `spoken` says the same for screen readers.
 */
export function FeltArc({
  main,
  sub,
  spoken,
  shape = "table",
}: {
  main: string;
  sub: string;
  spoken: string;
  shape?: keyof typeof SHAPES;
}) {
  const outer = useId();
  const inner = useId();
  const { viewBox, outer: outerPath, inner: innerPath } = SHAPES[shape];
  return (
    <div className={`bj-legend is-${shape}`}>
      <svg className="bj-legend-art" viewBox={viewBox} aria-hidden="true" focusable="false">
        <defs>
          <path id={outer} d={outerPath} />
          <path id={inner} d={innerPath} />
        </defs>
        <text className="bj-legend-main">
          <textPath href={`#${outer}`} startOffset="50%" textAnchor="middle">
            {main}
          </textPath>
        </text>
        <text className="bj-legend-sub">
          <textPath href={`#${inner}`} startOffset="50%" textAnchor="middle">
            {sub}
          </textPath>
        </text>
      </svg>
      <p className="roulette-sr-only">{spoken}</p>
    </div>
  );
}
