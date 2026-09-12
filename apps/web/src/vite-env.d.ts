/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHELL_MODE?: string;
  readonly VITE_SHELL_ORIGINS?: string;
  readonly VITE_MYBRANDOS_ORIGINS?: string;
  readonly VITE_LIFEOS_ORIGINS?: string;
  readonly VITE_COMPATIBLE_ORIGINS?: string;
  readonly VITE_LIFEOS_ANDROID_PACKAGE?: string;
  readonly VITE_MYBRANDOS_ANDROID_PACKAGE?: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected by Vite `define` — folds localhost defaults out of production. */
declare const __OSSHELL_PRODUCTION__: boolean | undefined;
