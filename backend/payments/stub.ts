import { NotImplementedError } from "@casino/shared";
import type { PaymentProvider } from "./payment-provider";

/** Placeholder until #10 implements the simulated provider. */
export const stubPaymentProvider: PaymentProvider = {
  name: "stub",
  deposit: () => Promise.reject(new NotImplementedError("deposit", "#10")),
};
