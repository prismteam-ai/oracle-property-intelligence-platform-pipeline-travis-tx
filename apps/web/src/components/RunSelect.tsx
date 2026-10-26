// The one run picker (PO 2026-10-26 06:05: "whenever we show a run list, show it as a dropdown if
// there is no other info than the run and its date — consistent across pages"). A native
// `<select>` (keyboard and screen-reader behaviour for free) styled as an Atlas outlined field,
// 48 px, with a decorative chevron instead of the browser's. Runs are listed newest first as
// "Run N · Mon D, YYYY" or "Pilot slice · Mon D, YYYY" (runOptionLabel, runNumbers), the latest marked
// "· latest". The page owns the value (the URL): `onChange` gets the chosen run ID, or `null` for
// the optional "all runs" choice. Render-only.
import { useId, type ReactElement } from "react";
import { byFinish, numberRuns } from "../data/run-numbers";
import { runOptionLabel, type RunsIndexEntry } from "../data/runs-index";
import { Icon } from "./Icon";
import styles from "./RunSelect.module.css";

/** The `<option>` value of the "all runs" choice (a run ID is never empty). */
const ALL = "";

export interface RunSelectProps {
  /** The index's runs (ID and finish time), in any order; numbering follows the finish time. */
  readonly runs: readonly Pick<RunsIndexEntry, "runId" | "finishedAt">[];
  /** The chosen run ID; `null` selects the "all runs" choice (or the latest when there is none). */
  readonly value: string | null;
  readonly onChange: (runId: string | null) => void;
  /** The field's name, e.g. "Run" or "Previous run"; visible unless `hideLabel`. */
  readonly label: string;
  readonly hideLabel?: boolean;
  /** Adds a first choice for every run (e.g. "All runs"), reported as `null`. */
  readonly allLabel?: string;
}

export function RunSelect({
  runs,
  value,
  onChange,
  label,
  hideLabel = false,
  allLabel,
}: RunSelectProps): ReactElement {
  const id = useId();
  // Oldest first by finish time; numbers from the one rule (runNumbers: the pilot is unnumbered).
  const numbers = numberRuns(runs);
  const numbered = byFinish(runs).map((entry) => ({
    entry,
    number: numbers.get(entry.runId) ?? null,
  }));
  const latestId = numbered[numbered.length - 1]?.entry.runId;
  const known = value !== null && numbered.some(({ entry }) => entry.runId === value);
  const selected = known ? value : allLabel === undefined ? (latestId ?? ALL) : ALL;
  return (
    <span className={styles.field} data-run-select="">
      <label className={hideLabel ? styles.hidden : styles.label} htmlFor={id}>
        {label}
      </label>
      <span className={styles.box}>
        <select
          id={id}
          className={styles.select}
          value={selected}
          onChange={(e) => onChange(e.currentTarget.value === ALL ? null : e.currentTarget.value)}
        >
          {allLabel === undefined ? null : <option value={ALL}>{allLabel}</option>}
          {[...numbered].reverse().map(({ entry, number }) => (
            <option key={entry.runId} value={entry.runId} data-run-id={entry.runId}>
              {runOptionLabel(number, entry.finishedAt)}
              {entry.runId === latestId ? " · latest" : ""}
            </option>
          ))}
        </select>
        <Icon name="arrow_drop_down" size="medium" />
      </span>
    </span>
  );
}
