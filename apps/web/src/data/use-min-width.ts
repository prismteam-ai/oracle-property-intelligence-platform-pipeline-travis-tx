// Whether the viewport is at least `px` wide, following resizes. False without matchMedia (unit
// tests), so callers render their compact form there.
import { useEffect, useState } from "react";

export function useMinWidth(px: number): boolean {
  const query =
    typeof window.matchMedia === "function" ? window.matchMedia(`(min-width: ${px}px)`) : null;
  const [wide, setWide] = useState(query?.matches ?? false);
  useEffect(() => {
    if (query === null) return;
    const update = (): void => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [query]);
  return wide;
}
