/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL; when unset the app uses the in-memory mock API. */
  readonly VITE_API_URL?: string;
  /**
   * Mock only: cards already dealt from the first Blackjack shoe (for example 230), so the cut
   * card and the shuffle show after a hand or two instead of forty.
   */
  readonly VITE_MOCK_BLACKJACK_SHOE_DEALT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
