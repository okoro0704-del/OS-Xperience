/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XPERIENCE_API_URL?: string;
  readonly VITE_XPERIENCE_USER_ID?: string;
  readonly VITE_XPERIENCE_USER_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
