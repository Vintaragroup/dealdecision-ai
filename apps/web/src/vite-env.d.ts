/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;

  readonly VITE_API_BASE_URL?: string;
  readonly VITE_BACKEND_MODE?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;

  // Build-time fingerprint — injected by vite.config.ts via define; never undefined in prod.
  readonly VITE_BUILD_SHA: string;
  readonly VITE_BUILD_TIME: string;
  readonly VITE_APP_ENV: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
