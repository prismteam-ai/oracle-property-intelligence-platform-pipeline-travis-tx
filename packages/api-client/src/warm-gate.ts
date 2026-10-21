/**
 * Sends a page's first request alone and holds the others until it has answered or failed (decisions.md section 31).
 * On an idle API the first request opens a cold instance; requests sent alongside it would each open another, since a
 * Lambda instance serves one request at a time. Held behind it, they land on the instance it opened. After the first
 * answer every request goes straight through.
 */
export function firstCallAlone(f: typeof fetch): typeof fetch {
  let first: Promise<unknown> | null = null;
  return ((...args: Parameters<typeof fetch>) => {
    if (first === null) {
      const p = f(...args);
      first = p.then(
        () => undefined,
        () => undefined,
      );
      return p;
    }
    return first.then(() => f(...args));
  }) as typeof fetch;
}
