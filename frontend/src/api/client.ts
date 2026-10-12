import type {
  AuthResponse,
  BalanceResponse,
  DepositRequest,
  DepositResponse,
  ErrorCode,
  LoginRequest,
  RegisterRequest,
  RouletteBetRequest,
  RouletteBetResponse,
  TransactionHistoryQueryInput,
  TransactionHistoryResponse,
} from "@casino/shared";

/** Error raised by every `ApiClient` implementation. `status` is 0 for network failures. */
export class ApiError extends Error {
  readonly code: ErrorCode | "network" | "invalid_response";
  readonly status: number;

  constructor(code: ApiError["code"], message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * The single interface screens use to talk to the backend. Module tickets
 * (#9, #10, #12) only swap the mock for HTTP behavior; the screens' calls
 * never change.
 */
export interface ApiClient {
  register(body: RegisterRequest): Promise<AuthResponse>;
  login(body: LoginRequest): Promise<AuthResponse>;
  getBalance(): Promise<BalanceResponse>;
  deposit(body: DepositRequest, idempotencyKey: string): Promise<DepositResponse>;
  listTransactions(query?: TransactionHistoryQueryInput): Promise<TransactionHistoryResponse>;
  placeRouletteBet(body: RouletteBetRequest, idempotencyKey: string): Promise<RouletteBetResponse>;
}
