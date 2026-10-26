// Route table and router of the hosted UI (A-03 T007; A-13 T015). The routes are built from
// routes/route-list.ts (data, also read by the hosted scan): every page is a lazy child of the
// shell, so no page's code (and never DuckDB-WASM) loads until it is visited. `/` renders the Hub
// (no redirect). `routes` is exported for the unit tests (memory router); `App` mounts the
// browser router. The shared tRPC client (packages/api-client, the only one) and its React Query
// client are provided once, above the shell.
import { ApiProvider } from "@countylens/api-client/react";
import { ROUTES } from "@countylens/shared/routes";
import { useMemo, type ReactElement } from "react";
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router";
import { AppShell } from "./components/AppShell";
import { RouteError } from "./components/RouteError";
import { ROUTE_LIST } from "./routes/route-list";

function Root(): ReactElement {
  return (
    <ApiProvider>
      <AppShell />
    </ApiProvider>
  );
}

// A bare `/data/verify` (typed or shared) opens Verify too, which sends it on to the latest
// manifest's CID (A-16 hosted review B-6) instead of the router's developer 404.
const pathOf = (path: string): string =>
  path === ROUTES.dataVerify ? `${path.slice(1)}?` : path.slice(1);

const children: RouteObject[] = ROUTE_LIST.map((entry) =>
  entry.path === "/"
    ? { index: true, lazy: entry.load }
    : { path: pathOf(entry.path), lazy: entry.load },
);

// Any other address renders ComingSoon's "Page not found" inside the shell, never the router's
// developer 404 page.
const notFound: RouteObject = { path: "*", lazy: () => import("./routes/ComingSoon") };

// Any error in a page (or a page file a newer deploy replaced) shows RouteError, never the router's
// developer screen.
export const routes: RouteObject[] = [
  { path: "/", Component: Root, ErrorBoundary: RouteError, children: [...children, notFound] },
];

export function App(): ReactElement {
  const router = useMemo(() => createBrowserRouter(routes), []);
  return <RouterProvider router={router} />;
}
