// Explore · Filters controls (A-13 T025/T031; AC-4, AC-5, AC-8, FR-004, FR-004a, FR-008,
// FR-018; A-16 T050 per the Explore1440/768/390 boards). Every control reads and writes the URL
// (the caller's `onPatch`). Board order: "Filters · query" header, Place (gazetteer combobox),
// Radius (number + slider), "Roof age at least, in years" preset chips 10/13/15/20/25 with an
// "Other" box (accessible name "Roof age"), Roofing permit segmented Any / Open or stalled /
// Stalled (radios), Open ≥, Owner chips "Tenure > 10 yrs" and "Out-of-area" (accessible name
// "Out-of-area owner") with the Tenure box, the one-line definitions, Suggestions (the
// `ooa78753` preset and two board presets), Sort, then "{n} properties match" with Clear. Below 840 px
// the controls collapse behind a "Filters" button (aria-expanded); from 840 px they sit beside
// the results. Atlas fields and chips, 48 px targets. Render-only.
import { EXPLORE_BOUNDS } from "@countylens/query-core/explore";
import type { ResolvedPlace } from "@countylens/query-core/places";
import { useEffect, useId, useState, type KeyboardEvent, type ReactElement } from "react";
import { Icon } from "./Icon";
import styles from "./FilterSheet.module.css";

/** One-line filter definitions (FR-008, TC-036). */
export const FILTER_DEFINITIONS = Object.freeze({
  tenure:
    "Tenure: years since the latest dated sale on record; properties without one are left out and counted.",
  ooa: "Out-of-area owner: the owner's mailing ZIP is outside the Travis County area.",
});

export const SORT_OPTIONS = Object.freeze([
  { value: "nearest", label: "Nearest" },
  { value: "open_desc", label: "Open longest" },
  { value: "roof_desc", label: "Oldest roof" },
] as const);

/** The `ooa78753` preset of AC-8: ZCTA 78753, tenure > 10 years, out-of-area owners. */
export const OOA_PRESET = Object.freeze({ id: "ooa78753", place: "78753", tenure: 10, ooa: true });

/** Explore1440 board: roof-age preset chips, in years. */
export const ROOF_PRESETS: readonly number[] = Object.freeze([10, 13, 15, 20, 25]);
/** Explore1440 board: the owner chip "Tenure > 10 yrs". */
export const TENURE_CHIP_YEARS = 10;

/** Roofing permit segments (board): URL value → label. "Any" clears the filter. */
export const PERMIT_SEGMENTS = Object.freeze([
  { value: "any", label: "Any" },
  { value: "open_stalled", label: "Open or stalled" },
  { value: "stalled", label: "Stalled" },
] as const);
export type PermitSegment = (typeof PERMIT_SEGMENTS)[number]["value"];

/** Explore1440 board "Suggestions" (the presets the board lists, plus AC-8's ooa78753). */
const SUGGESTIONS: readonly { readonly text: string; readonly patch: FilterPatch }[] = [
  { text: "Out-of-area owners, roof ≥ 20", patch: { ooa: true, roof: "20" } },
  { text: "Owners for 10+ years, roof ≥ 15", patch: { tenure: "10", roof: "15" } },
];

export type FilterKey = "place" | "r" | "roof" | "permit" | "openYrs" | "tenure" | "ooa" | "sort";
export type FilterPatch = Partial<
  Record<FilterKey | "at" | "sel" | "page", string | boolean | null>
>;

/** One numeric control: its explore.search bounds, whether it takes whole numbers only, and whether an empty box means "no filter". */
interface NumberSpec {
  readonly bounds: readonly [number, number];
  readonly integer: boolean;
  readonly optional: boolean;
}
const NUMBER_SPECS: Readonly<Record<"r" | "roof" | "openYrs" | "tenure", NumberSpec>> = {
  r: { bounds: EXPLORE_BOUNDS.radiusMi, integer: false, optional: false },
  roof: { bounds: EXPLORE_BOUNDS.roof, integer: true, optional: true },
  openYrs: { bounds: EXPLORE_BOUNDS.openYrs, integer: false, optional: true },
  tenure: { bounds: EXPLORE_BOUNDS.tenure, integer: true, optional: true },
};

/** The URL value of typed text: clamped into the bounds (whole numbers rounded); null = not a number. */
export function committedNumber(text: string, spec: NumberSpec): string | null {
  const n = Number(text);
  if (text.trim() === "" || !Number.isFinite(n)) return null;
  const value = Math.min(
    spec.bounds[1],
    Math.max(spec.bounds[0], spec.integer ? Math.round(n) : n),
  );
  return String(value);
}

/** The segment a URL permit value selects ("open" has no segment: none is selected). */
function segmentOf(permit: string | undefined, openOrStalled: boolean): PermitSegment | null {
  if (openOrStalled || permit === "open_stalled" || permit === "open_or_stalled")
    return "open_stalled";
  if (permit === "stalled") return "stalled";
  if (permit === undefined || permit === "" || permit === "any") return "any";
  return null;
}

export interface FilterSheetProps {
  /** The current URL value of a control, or its default. */
  readonly value: (key: FilterKey) => string;
  readonly openOrStalled: boolean;
  readonly ooa: boolean;
  readonly onPatch: (patch: FilterPatch) => void;
  /** Gazetteer suggestions for the typed text (query-core searchPlaces). */
  readonly suggest: (text: string) => readonly ResolvedPlace[];
  /** Shown under the place box when the typed text is not a Travis County place. */
  readonly notFoundText: string;
  /** The answered search's total within the radius ("{n} properties match"); null while none. */
  readonly matchCount?: number | null;
  /** True while the Property drawer is open: the controls fold behind "Filters" at every width. */
  readonly folded?: boolean;
  /** The Explore drawer is collapsed: from 840 px the controls are hidden (kept in the DOM). */
  readonly hiddenWide?: boolean;
}

export function FilterSheet({
  value,
  openOrStalled,
  ooa,
  onPatch,
  suggest,
  notFoundText,
  matchCount = null,
  folded = false,
  hiddenWide = false,
}: FilterSheetProps): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  // null while not editing: the box then shows the URL's place (so a pick from the header search
  // box, which only sets `place=`, fills it too).
  const [text, setText] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  // What the person is typing in a number box, until they leave it (the URL only takes valid numbers).
  const [drafts, setDrafts] = useState<Partial<Record<FilterKey, string>>>({});
  // The person's latest choice on the permit segments, Out-of-area and Sort, shown at once: the URL
  // commits a moment later and React would otherwise put the control back in between (ERR-39).
  // Cleared when the URL-derived value changes, or on blur if the patch never landed.
  const [pending, setPending] = useState<{ permit?: PermitSegment; ooa?: boolean; sort?: string }>(
    {},
  );
  const sortUrl = value("sort");
  const permitUrl = value("permit");
  useEffect(() => setPending({}), [openOrStalled, permitUrl, ooa, sortUrl]);
  const clearPending = (key: "permit" | "ooa" | "sort"): void =>
    setPending((p) => {
      const { [key]: _gone, ...rest } = p;
      return rest;
    });
  const segment = pending.permit ?? segmentOf(permitUrl || undefined, openOrStalled);
  const ooaOn = pending.ooa ?? ooa;
  const roofUrl = value("roof");
  const tenureUrl = value("tenure");
  const typed = (text ?? "").trim();
  const options = typed === "" ? [] : suggest(typed);
  const listId = `${id}-places`;
  const placeUrl = value("place");
  const current = placeUrl === "" ? undefined : suggest(placeUrl)[0];
  const placeName =
    current === undefined ? placeUrl : current.kind === "zcta" ? current.id : current.name;

  const choose = (placeId: string): void => {
    setText(null);
    setActive(-1);
    onPatch({ place: placeId, at: null, sel: null });
  };
  const optionId = (index: number): string => `${id}-option-${index}`;
  const onPlaceKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    const count = options.length;
    if (event.key === "Escape") {
      setText(null);
      setActive(-1);
    } else if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      setActive((active + 1) % count);
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      setActive(active <= 0 ? count - 1 : active - 1);
    } else if (event.key === "Enter") {
      const chosen = options[active] ?? options[0];
      if (chosen !== undefined) {
        event.preventDefault();
        choose(chosen.id);
      }
    }
  };
  const numberInput = (
    key: "r" | "roof" | "openYrs" | "tenure",
    step: string,
    placeholder?: string,
  ): ReactElement => {
    const spec = NUMBER_SPECS[key];
    return (
      <input
        id={`${id}-${key}`}
        className={`${styles.input} ${styles.number}`}
        type="number"
        inputMode="decimal"
        step={step}
        min={spec.bounds[0]}
        max={spec.bounds[1]}
        placeholder={placeholder}
        value={drafts[key] ?? value(key)}
        onChange={(e) => {
          const typed = e.target.value;
          setDrafts((d) => ({ ...d, [key]: typed }));
          if (typed.trim() === "" && spec.optional) onPatch({ [key]: null });
          else {
            const committed = committedNumber(typed, spec);
            if (committed !== null) onPatch({ [key]: committed });
          }
        }}
        onBlur={() =>
          setDrafts((d) => {
            const { [key]: _gone, ...rest } = d;
            return rest;
          })
        }
      />
    );
  };
  const radius = drafts.r ?? value("r");

  return (
    <div
      className={[
        styles.sheet,
        folded ? styles.folded : "",
        hiddenWide ? styles.hiddenWide : "",
      ].join(" ")}
    >
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((o) => !o)}
      >
        Filters
      </button>
      <div id={`${id}-panel`} className={`${styles.panel} ${open ? styles.open : ""}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-place`}>
            Place
          </label>
          <input
            id={`${id}-place`}
            className={styles.input}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={options.length > 0}
            aria-controls={listId}
            {...(active >= 0 && active < options.length
              ? { "aria-activedescendant": optionId(active) }
              : {})}
            autoComplete="off"
            placeholder="Travis County place or ZIP"
            value={text ?? placeName}
            onChange={(e) => {
              setText(e.target.value);
              setActive(-1);
            }}
            onKeyDown={onPlaceKey}
          />
          <ul id={listId} role="listbox" aria-label="Places" className={styles.options}>
            {options.map((o, index) => (
              <li
                key={o.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                className={styles.option}
                onClick={() => choose(o.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") choose(o.id);
                }}
              >
                {o.label}
              </li>
            ))}
          </ul>
          {typed !== "" && options.length === 0 ? (
            <p className={styles.hint}>{notFoundText}</p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-r`}>
            Radius
          </label>
          <span className={styles.inputRow}>
            <input
              className={styles.slider}
              type="range"
              aria-label="Radius slider"
              min={NUMBER_SPECS.r.bounds[0]}
              max={NUMBER_SPECS.r.bounds[1]}
              step="0.25"
              value={Number.isFinite(Number(radius)) ? radius : NUMBER_SPECS.r.bounds[0]}
              onChange={(e) => {
                const committed = committedNumber(e.target.value, NUMBER_SPECS.r);
                if (committed !== null) onPatch({ r: committed });
              }}
            />
            {numberInput("r", "0.25")}
            <span className={styles.unit}>mi</span>
          </span>
        </div>

        <fieldset className={styles.group}>
          <legend className={styles.label}>Roof age at least, in years</legend>
          <div className={styles.chips}>
            {ROOF_PRESETS.map((years) => (
              <button
                key={years}
                type="button"
                className={`${styles.chip} ${roofUrl === String(years) ? styles.chipOn : ""}`}
                aria-pressed={roofUrl === String(years)}
                onClick={() => onPatch({ roof: roofUrl === String(years) ? null : String(years) })}
              >
                {years}
              </button>
            ))}
            <label className={styles.srOnly} htmlFor={`${id}-roof`}>
              Roof age
            </label>
            {numberInput("roof", "1", "Other")}
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.label}>Roofing permit</legend>
          <div className={styles.segmented}>
            {PERMIT_SEGMENTS.map((s) => (
              <label
                key={s.value}
                className={`${styles.segment} ${segment === s.value ? styles.segmentOn : ""}`}
              >
                <input
                  type="radio"
                  name={`${id}-permit`}
                  value={s.value}
                  checked={segment === s.value}
                  onChange={() => {
                    setPending((p) => ({ ...p, permit: s.value }));
                    onPatch({ permit: s.value === "any" ? null : s.value });
                  }}
                  onBlur={() => clearPending("permit")}
                />
                {s.label}
              </label>
            ))}
          </div>
          <div className={`${styles.field} ${styles.inline}`}>
            <label className={styles.label} htmlFor={`${id}-openYrs`}>
              Open ≥
            </label>
            <span className={styles.inputRow}>
              {numberInput("openYrs", "0.5", "any time")}
              <span className={styles.unit}>yrs</span>
            </span>
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.label}>Owner</legend>
          <div className={styles.chips}>
            <button
              type="button"
              className={`${styles.chip} ${tenureUrl === String(TENURE_CHIP_YEARS) ? styles.chipOn : ""}`}
              aria-pressed={tenureUrl === String(TENURE_CHIP_YEARS)}
              onClick={() =>
                onPatch({
                  tenure:
                    tenureUrl === String(TENURE_CHIP_YEARS) ? null : String(TENURE_CHIP_YEARS),
                })
              }
            >
              {tenureUrl === String(TENURE_CHIP_YEARS) ? (
                <Icon name="check" size="small" />
              ) : (
                <Icon name="add" size="small" />
              )}
              Tenure &gt; {TENURE_CHIP_YEARS} yrs
            </button>
            <label className={`${styles.chip} ${ooaOn ? styles.chipOn : ""}`}>
              <input
                type="checkbox"
                aria-label="Out-of-area owner"
                checked={ooaOn}
                onChange={(e) => {
                  setPending((p) => ({ ...p, ooa: e.target.checked }));
                  onPatch({ ooa: e.target.checked });
                }}
                onBlur={() => clearPending("ooa")}
              />
              {ooaOn ? <Icon name="check" size="small" /> : <Icon name="add" size="small" />}
              Out-of-area
            </label>
          </div>
          <div className={`${styles.field} ${styles.inline}`}>
            <label className={styles.label} htmlFor={`${id}-tenure`}>
              Tenure
            </label>
            <span className={styles.inputRow}>
              {numberInput("tenure", "1")}
              <span className={styles.unit}>yrs or more (&gt;)</span>
            </span>
          </div>
          <p className={styles.definition} data-filter-definition="tenure">
            {FILTER_DEFINITIONS.tenure}
          </p>
          <p className={styles.definition} data-filter-definition="ooa">
            {FILTER_DEFINITIONS.ooa}
          </p>
        </fieldset>

        <div className={styles.group}>
          <p className={styles.label}>Suggestions</p>
          <div className={styles.suggestions}>
            <button
              type="button"
              className={styles.suggestion}
              onClick={() =>
                onPatch({
                  place: OOA_PRESET.place,
                  at: null,
                  tenure: String(OOA_PRESET.tenure),
                  ooa: OOA_PRESET.ooa,
                  sel: null,
                })
              }
            >
              <Icon name="lightbulb" size="small" />
              <span>Out-of-area owners in 78753, owned 10+ yrs</span>
              <span className={styles.srOnly}> · preset {OOA_PRESET.id}</span>
            </button>
            {SUGGESTIONS.map((s) => (
              <button
                key={s.text}
                type="button"
                className={styles.suggestion}
                onClick={() => onPatch(s.patch)}
              >
                <Icon name="lightbulb" size="small" />
                <span>{s.text}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 13.png keeps Sort above the results; with no top bar here it closes the pane, after
            the board's own controls. */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-sort`}>
            Sort
          </label>
          <select
            id={`${id}-sort`}
            className={styles.input}
            value={pending.sort ?? sortUrl}
            onChange={(e) => {
              setPending((p) => ({ ...p, sort: e.target.value }));
              onPatch({ sort: e.target.value });
            }}
            onBlur={() => clearPending("sort")}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.footer}>
          <p className={styles.count} data-match-count="">
            {matchCount === null ? null : (
              <>
                <strong>{matchCount.toLocaleString("en-US")}</strong>{" "}
                {matchCount === 1 ? "property matches" : "properties match"}
              </>
            )}
          </p>
          <button
            type="button"
            className={styles.textButton}
            onClick={() =>
              onPatch({ roof: null, permit: null, openYrs: null, tenure: null, ooa: null })
            }
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
