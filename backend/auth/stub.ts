import { NotImplementedError } from "@casino/shared";
import type { TokenService } from "./token-service";

/** Placeholder until #9 implements tokens. */
export const stubTokenService: TokenService = {
  sign: () => Promise.reject(new NotImplementedError("sign", "#9")),
  verify: () => Promise.reject(new NotImplementedError("verify", "#9")),
};
