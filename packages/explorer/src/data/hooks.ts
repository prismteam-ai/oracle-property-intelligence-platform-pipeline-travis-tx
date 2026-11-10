import { useEffect, useState } from "react";
import { type Dataset, loadDataset } from "./dataset.js";
import type { Database } from "./duckdb.js";

export type Loadable<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "failed"; error: string };

function usePromise<T>(start: () => Promise<T>, key: unknown): Loadable<T> {
  const [loadable, setLoadable] = useState<Loadable<T>>({ state: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key identifies the promise
  useEffect(() => {
    let active = true;
    setLoadable({ state: "loading" });
    start().then(
      (value) => active && setLoadable({ state: "ready", value }),
      (error: unknown) =>
        active &&
        setLoadable({
          state: "failed",
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      active = false;
    };
  }, [key]);
  return loadable;
}

let datasetPromise: Promise<Dataset> | undefined;
const databases = new WeakMap<Dataset, Promise<Database>>();

export function useDataset(): Loadable<Dataset> {
  return usePromise(() => {
    datasetPromise ??= loadDataset(fetch, window.location.origin);
    return datasetPromise;
  }, "dataset");
}

export function useDatabase(dataset: Dataset): Loadable<Database> {
  return usePromise(() => {
    let database = databases.get(dataset);
    if (!database) {
      database = import("./duckdb.js").then(({ openDatabase }) => openDatabase(dataset));
      databases.set(dataset, database);
    }
    return database;
  }, dataset);
}

export function useAsync<T>(start: () => Promise<T>, key: unknown): Loadable<T> {
  return usePromise(start, key);
}
