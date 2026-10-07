/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_API_URL?: string;
  readonly VITE_AGENT_B_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
