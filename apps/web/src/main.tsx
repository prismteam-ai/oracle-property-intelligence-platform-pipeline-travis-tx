// Browser entry of the hosted UI (A-03 T007). Atlas tokens are the only stylesheet besides the
// CSS Modules of the components; the light theme is fixed in index.html (`data-theme="light"`).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./styles/tokens.css";
import { App } from "./App";
import { reloadForNewBuild } from "./components/RouteError";

// A page file that a newer deploy replaced fails to preload: reload once to get the new build
// (Vite's documented recovery), instead of an error in a tab opened before the release.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForNewBuild()) event.preventDefault();
});

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
