import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// VITE_API_URL is the HTTP API's $default execute-api URL (decisions 21); the Parquet mirror is same-origin under /tables/*.
// Dev and `vite preview` forward /v1 and /tables so the browser stays same-origin:
//   PROXY_API_URL    target for /v1     (default: VITE_API_URL)
//   PROXY_TABLES_URL target for /tables (the CloudFront origin that serves the mirror)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const api = env.PROXY_API_URL || env.VITE_API_URL;
  const tables = env.PROXY_TABLES_URL;
  const proxy: Record<string, { target: string; changeOrigin: boolean }> = {};
  if (api) proxy['/v1'] = { target: api, changeOrigin: true };
  if (tables) proxy['/tables'] = { target: tables, changeOrigin: true };
  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
    build: { chunkSizeWarningLimit: 1500 },
    // The DuckDB-WASM ESM build is loaded lazily and must not be pre-bundled into the main chunk.
    optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  };
});
