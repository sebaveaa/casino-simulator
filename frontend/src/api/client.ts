import type {
  AuthResponse,
  BalanceResponse,
  BlackjackActionRequest,
  BlackjackActionResponse,
  BlackjackCurrentResponse,
  BlackjackHistoryResponse,
  BlackjackStartRequest,
  BlackjackStartResponse,
  ChickenRoadCashoutRequest,
  ChickenRoadCashoutResponse,
  ChickenRoadCurrentResponse,
  ChickenRoadHistoryResponse,
  ChickenRoadStartRequest,
  ChickenRoadStartResponse,
  ChickenRoadStepRequest,
  ChickenRoadStepResponse,
  CurrentRaceResponse,
  DepositRequest,
  DepositResponse,
  ErrorCode,
  LoginRequest,
  RaceBetRequest,
  RaceBetResponse,
  RaceEvent,
  RegisterRequest,
  RouletteBetRequest,
  RouletteBetResponse,
  SeedPairResponse,
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
  getCurrentRace(): Promise<CurrentRaceResponse>;
  placeRaceBet(body: RaceBetRequest, idempotencyKey: string): Promise<RaceBetResponse>;
  /**
   * Subscribes to the live race events. `onStatus("connected")` fires on every (re)connection, and
   * the caller should re-fetch `getCurrentRace()` on each one after the first. Returns the function
   * that closes the stream; it is safe to call more than once.
   */
  watchRaces(
    onEvent: (event: RaceEvent) => void,
    onStatus?: (status: "connected" | "reconnecting") => void,
  ): () => void;
  /** The active seed pair: its hash is the one the next game will carry. */
  getSeedPair(): Promise<SeedPairResponse>;
  startChickenRoadGame(
    body: ChickenRoadStartRequest,
    idempotencyKey: string,
  ): Promise<ChickenRoadStartResponse>;
  stepChickenRoadGame(body: ChickenRoadStepRequest): Promise<ChickenRoadStepResponse>;
  cashOutChickenRoadGame(body: ChickenRoadCashoutRequest): Promise<ChickenRoadCashoutResponse>;
  getCurrentChickenRoadGame(): Promise<ChickenRoadCurrentResponse>;
  /** Latest finished games, newest first; the server defaults `limit` to 5 (max 20). */
  listChickenRoadHistory(query?: { limit?: number }): Promise<ChickenRoadHistoryResponse>;
  /** Starts a hand; a natural on either side answers it already settled. */
  startBlackjackHand(
    body: BlackjackStartRequest,
    idempotencyKey: string,
  ): Promise<BlackjackStartResponse>;
  /** Plays one action at its `index`; repeating an index replays it. */
  playBlackjackAction(body: BlackjackActionRequest): Promise<BlackjackActionResponse>;
  getCurrentBlackjackHand(): Promise<BlackjackCurrentResponse>;
  /** Latest settled hands, newest first; the server defaults `limit` to 5 (max 20). */
  listBlackjackHistory(query?: { limit?: number }): Promise<BlackjackHistoryResponse>;
}
