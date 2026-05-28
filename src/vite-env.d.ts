/// <reference types="vite/client" />

// Explicit declaration to help VS Code when multiple tsconfigs are present
// (common when backend resolver + Vite frontend are in the same workspace)
interface ImportMetaEnv {
  readonly VITE_HGRAPH_API_KEY: string;
  // Add other VITE_ environment variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

