// Root ESLint flat config (A-03 T004): re-exports the shared workspace config from
// packages/eslint-config, imported by path so the root needs no extra dependency entry.
// `eslint .` from the root lints every workspace member; the rules live in the package.
export { default } from "./packages/eslint-config/index.js";
