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
  rouletteBets: "/games/roulette/bets",
} as const;

export type ApiPath = (typeof apiPaths)[keyof typeof apiPaths];
