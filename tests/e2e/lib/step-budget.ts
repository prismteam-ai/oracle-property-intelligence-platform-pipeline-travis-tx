// A time budget for one scan step (A-13 TC-073): a step that overruns fails with its own name and the
// last sub-step it reached, instead of silently using up the whole test timeout. Pure; no browser.

/**
 * Runs `step` and rejects with `"{label}: no result within {ms} ms; last step: {note}"` when it has not
 * settled in `ms`. `step` calls `note(text)` before each sub-step so the failure says where it stuck.
 * The step itself is not cancelled (the caller closes its browser context, which aborts pending actions).
 */
export async function runBudgeted<T>(
  label: string,
  ms: number,
  step: (note: (text: string) => void) => Promise<T>,
): Promise<T> {
  let last = "(none reached)";
  let timer: NodeJS.Timeout | undefined;
  const overrun = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: no result within ${ms} ms; last step: ${last}`)),
      ms,
    );
  });
  try {
    return await Promise.race([
      step((text) => {
        last = text;
      }),
      overrun,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
