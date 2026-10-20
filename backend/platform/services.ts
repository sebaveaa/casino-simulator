import { stubTokenService } from "../auth/stub";
import type { TokenService } from "../auth/token-service";
import type { PaymentProvider } from "../payments/payment-provider";
import { stubPaymentProvider } from "../payments/stub";
import { createMemoryRaceEventBus, type RaceEventBus } from "../realtime/race-events";
import type { SeedPairService } from "../rng/seed-pair-service";
import { stubSeedPairService } from "../rng/stub";
import { stubWalletService } from "../wallet/stub";
import type { WalletService } from "../wallet/wallet-service";

/** The module services routes depend on. Each module ticket swaps its stub for the real one. */
export type Services = {
  wallet: WalletService;
  payments: PaymentProvider;
  seedPairs: SeedPairService;
  tokens: TokenService;
  raceEvents: RaceEventBus;
};

export const stubServices: Services = {
  wallet: stubWalletService,
  payments: stubPaymentProvider,
  seedPairs: stubSeedPairService,
  tokens: stubTokenService,
  raceEvents: createMemoryRaceEventBus(),
};
