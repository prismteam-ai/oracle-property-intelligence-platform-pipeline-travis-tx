/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The HTTP API's $default execute-api URL; empty means same-origin `/v1` (proxy or CloudFront behaviour). */
  readonly VITE_API_URL?: string;
}
