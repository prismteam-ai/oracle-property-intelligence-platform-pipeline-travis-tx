// Test helper: narrows an optional value and fails the test loudly when it is missing.
export function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined)
    throw new Error(`test: expected ${what} to be present`);
  return value;
}
