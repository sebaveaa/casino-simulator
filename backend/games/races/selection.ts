import { z } from "zod";

/** What `bets.selection` holds for a race bet. */
export const raceSelectionSchema = z.object({ animal: z.number().int() });
