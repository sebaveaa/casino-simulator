export interface Animal {
  /** Lane and animal index, as the server numbers them (0..4). */
  id: number;
  name: string;
  emoji: string;
  /** The emoji glyph looks left (Segoe UI Emoji), so the track mirrors it to face the finish. */
  facesLeft: boolean;
}

/** The five racers. The index in this list is the animal id the server sends. */
export const animals: readonly Animal[] = [
  { id: 0, name: "Tortuga", emoji: "🐢", facesLeft: true },
  { id: 1, name: "Conejo", emoji: "🐇", facesLeft: true },
  { id: 2, name: "Zorro", emoji: "🦊", facesLeft: false },
  { id: 3, name: "Caballo", emoji: "🐎", facesLeft: true },
  { id: 4, name: "Guepardo", emoji: "🐆", facesLeft: true },
];

export function animalName(id: number): string {
  return animals[id]?.name ?? `Animal ${id + 1}`;
}
