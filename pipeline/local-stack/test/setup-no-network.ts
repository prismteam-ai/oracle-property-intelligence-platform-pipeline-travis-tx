// A real fetch in a unit test is a bug: replace it with one that always rejects.
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`network disabled in unit tests: ${String(input)}`);
}) as typeof fetch;
