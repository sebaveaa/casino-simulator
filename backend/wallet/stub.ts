import { NotImplementedError } from "@casino/shared";
import type { WalletService } from "./wallet-service";

const notImplemented = (method: string) => () =>
  Promise.reject(new NotImplementedError(method, "#10"));

/** Placeholder until #10 implements the wallet. */
export const stubWalletService: WalletService = {
  createPlayerWallet: notImplemented("createPlayerWallet"),
  getBalance: notImplemented("getBalance"),
  lockBalance: notImplemented("lockBalance"),
  transfer: notImplemented("transfer"),
  findTransaction: notImplemented("findTransaction"),
  listTransactions: notImplemented("listTransactions"),
};
