/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL; when unset the app uses the in-memory mock API. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
