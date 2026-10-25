/**
 * The single place endpoint paths are defined. The backend routes and the
 * frontend client both import them.
 */
export const apiPaths = {
  register: "/auth/register",
  login: "/auth/login",
  balance: "/wallet/balance",
  deposits: "/wallet/deposits",
  transactions: "/wallet/transactions",
  seedPair: "/rng/seed-pair",
  seedPairClientSeed: "/rng/seed-pair/client-seed",
  seedPairRotate: "/rng/seed-pair/rotate",
  rouletteBets: "/games/roulette/bets",
  raceBets: "/games/races/bets",
  raceCurrent: "/races/current",
  raceRound: "/races/rounds/:roundId",
  raceStream: "/races/stream",
  /** POST starts a game; GET lists the latest finished ones (`?limit=`). */
  chickenRoadGames: "/games/chicken-road/games",
  chickenRoadCurrent: "/games/chicken-road/games/current",
  chickenRoadSteps: "/games/chicken-road/games/current/steps",
  chickenRoadCashout: "/games/chicken-road/games/current/cashout",
} as const;

export type ApiPath = (typeof apiPaths)[keyof typeof apiPaths];
