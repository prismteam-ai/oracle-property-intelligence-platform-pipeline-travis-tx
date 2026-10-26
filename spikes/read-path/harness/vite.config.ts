import { defineConfig } from "vite";
export default defineConfig({ base: "/harness/", build: { target: "es2022", assetsInlineLimit: 0 } });
