import type { Config } from "./config";

export type Stoppable = { stop: () => Promise<void> };

export type Starters = {
  api: (config: Config) => Promise<Stoppable>;
  worker: (config: Config) => Promise<Stoppable>;
};

/** Starts the process selected by `PROCESS_ROLE` and returns its shutdown handle. */
export function run(config: Config, starters: Starters): Promise<Stoppable> {
  return starters[config.processRole](config);
}
