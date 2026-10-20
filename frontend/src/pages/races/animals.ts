export interface Animal {
  /** Lane and animal index, as the server numbers them (0..4). */
  id: number;
  name: string;
  emoji: string;
  /** Accent color of the runner, as a 0xRRGGBB number. */
  color: number;
  /** Short label drawn on the runner. */
  label: string;
}

/** The five racers. The index in this list is the animal id the server sends. */
export const animals: readonly Animal[] = [
  { id: 0, name: "Tortuga", emoji: "🐢", color: 0x1b8a3e, label: "TOR" },
  { id: 1, name: "Conejo", emoji: "🐇", color: 0xff5a36, label: "CON" },
  { id: 2, name: "Zorro", emoji: "🦊", color: 0xf5a524, label: "ZOR" },
  { id: 3, name: "Caballo", emoji: "🐎", color: 0x12a594, label: "CAB" },
  { id: 4, name: "Guepardo", emoji: "🐆", color: 0xff2e63, label: "GUE" },
];

export function animalName(id: number): string {
  return animals[id]?.name ?? `Animal ${id + 1}`;
}
