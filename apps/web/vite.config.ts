// Vite build of the hosted UI (A-03 T007; A-13 T015). Env: VITE_CID_COPY_HOST,
// VITE_FILEBASE_GATEWAY_HOST, VITE_PINATA_GATEWAY_HOST and VITE_ORBITOR_GATEWAY_HOST come from the Amplify app environment
// (infra web-stack); nothing is read here. DuckDB-WASM is a dynamic import (only the Permits page)
// so it stays outside the 300 KB gzipped JS budget; its chunk file name keeps "duckdb" (the
// adapter module is engine/duckdb-wasm.ts) so scripts/bundle-size.ts can exclude it.
// `build.manifest` writes dist/.vite/manifest.json, which scripts/bundle-size.ts reads to
// measure the Hub's initial graph (key `src/routes/Hub.tsx`).
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** ERR-44: index.html preconnects to %VITE_CID_COPY_HOST%; with no value that tag must vanish. */
function cidCopyPreconnect(host: string | undefined): Plugin {
  return {
    name: "countylens-cid-copy-preconnect",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        host !== undefined && /^[A-Za-z0-9.-]+$/.test(host)
          ? html
          : html.replace(
              /[ \t]*<link rel="preconnect" href="https:\/\/%VITE_CID_COPY_HOST%"[^>]*>\n?/,
              "",
            ),
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    cidCopyPreconnect(
      process.env["VITE_CID_COPY_HOST"] ||
        loadEnv(mode, process.cwd(), "VITE_")["VITE_CID_COPY_HOST"] ||
        undefined,
    ),
  ],
  // amazon-cognito-identity-js (src/auth/signIn.ts, copied from Task B) expects Node's `global`,
  // which the browser lacks; without this the admin sign-in and Activity routes crash (ERR-77).
  define: {
    global: "globalThis",
  },
  build: {
    sourcemap: false,
    manifest: true,
  },
}));
