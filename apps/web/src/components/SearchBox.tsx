// The search box (A-16, ported from Task B B-03 SearchBox): a WAI-ARIA 1.2 list-autocomplete
// combobox. Focus stays in the input; options are reached with ArrowUp/ArrowDown through
// aria-activedescendant, Enter picks the active (or first enabled) option, Escape closes the list
// and then clears the text. A place or ZIP sets the Explore area (`place=`, dropping `at`, `sel`
// and the last AI question `q`); a permit number, TCAD parcel id or any other text opens the AI tab with the question
// filled in (nothing is sent until Ask). The list sits above the page and the drawer while the box
// has focus and stays inside the viewport. The shell loads this module on first focus.
import { ROUTES } from "@countylens/shared/routes";
import { useId, useState, type KeyboardEvent, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { Icon } from "./Icon";
import { GAZETTEER_NOTE, SEARCH_SAMPLES, optionsFor, type SearchOption } from "./searchSuggest";
import styles from "./SearchBox.module.css";

export const SEARCH_BOX_LABEL = "Search CountyLens: town, ZIP, permit or a question";

/** The URL a chosen option opens. */
export function targetFor(option: SearchOption, current: URL): string | null {
  if (option.place !== undefined) {
    const p =
      current.pathname === ROUTES.explore
        ? new URLSearchParams(current.search)
        : new URLSearchParams();
    // PO 2026-10-26: a new search starts the AI tab afresh, so the last question (`q`) goes too.
    for (const key of ["at", "sel", "mode", "q"]) p.delete(key);
    p.set("place", option.place);
    return `${ROUTES.explore}?${p.toString()}`;
  }
  if (option.question !== undefined)
    return `${ROUTES.explore}?mode=ai&q=${encodeURIComponent(option.question)}`;
  return null;
}

export function SearchBox({
  initialText = "",
  autoFocus = false,
  className,
}: {
  readonly initialText?: string;
  readonly autoFocus?: boolean;
  readonly className?: string | undefined;
}): ReactElement {
  const navigate = useNavigate();
  const uid = useId();
  const [text, setText] = useState(initialText);
  const [open, setOpen] = useState(autoFocus);
  const [active, setActive] = useState(-1);
  const empty = text.trim() === "";
  const options = empty
    ? SEARCH_SAMPLES.flatMap((s) => optionsFor(s).slice(0, 1))
    : optionsFor(text);
  const expanded = open && options.length > 0;
  const optionId = (i: number): string => `${uid}-${i}`;

  const choose = (option: SearchOption | undefined): void => {
    if (option === undefined || option.disabled === true) return;
    const target = targetFor(option, new URL(window.location.href));
    if (target === null) return;
    setOpen(false);
    setText(option.place === undefined ? "" : option.label);
    // The AI tab reads `q` when it mounts; already on it, a fresh load is the way to refill it.
    const here = new URLSearchParams(window.location.search).get("mode") === "ai";
    if (option.question !== undefined && here) window.location.assign(target);
    else void navigate(target);
  };

  const step = (dir: 1 | -1): void => {
    const enabled = options.flatMap((o, i) => (o.disabled === true ? [] : [i]));
    if (enabled.length === 0) return;
    const at = enabled.indexOf(active);
    const next =
      at === -1
        ? dir === 1
          ? 0
          : enabled.length - 1
        : (at + dir + enabled.length) % enabled.length;
    setActive(enabled[next] ?? -1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      step(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active >= 0 ? options[active] : options.find((o) => o.disabled !== true));
    } else if (event.key === "Escape" && (expanded || text !== "")) {
      event.preventDefault();
      event.stopPropagation();
      if (expanded) setOpen(false);
      else setText("");
      setActive(-1);
    }
  };

  return (
    <div className={`${styles.root} ${className ?? ""}`} role="search">
      <Icon name="location_on" size="medium" />
      <input
        className={styles.input}
        type="text"
        role="combobox"
        aria-label={SEARCH_BOX_LABEL}
        aria-expanded={expanded}
        aria-controls={`${uid}-list`}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        placeholder={SEARCH_BOX_LABEL}
        autoComplete="off"
        spellCheck={false}
        // The shell swaps its placeholder input for this one on focus; keep the caret here.
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.popup} hidden={!expanded}>
        {/* EmptyHints / SearchStates boards: before typing, and a text with no exact match. */}
        {empty ? (
          <p className={styles.note}>
            <strong className={styles.label}>Search the whole county</strong> · try a town, ZIP,
            permit number or a plain question
          </p>
        ) : options.every((o) => o.kind === "ask") ? (
          <p className={styles.note} data-search-empty="">
            <strong className={styles.label}>{`No exact match for “${text.trim()}”`}</strong> ·
            check the spelling, or ask the helper instead
          </p>
        ) : null}
        <ul
          id={`${uid}-list`}
          role="listbox"
          aria-label="Search suggestions"
          className={styles.list}
        >
          {options.map((o, i) => (
            <li
              key={o.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              aria-disabled={o.disabled === true ? true : undefined}
              data-kind={o.kind}
              className={styles.option}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => {
                if (o.disabled !== true) setActive(i);
              }}
              onClick={() => choose(o)}
            >
              <span className={styles.label}>{o.label}</span>
              <span className={styles.detail}>{o.detail}</span>
            </li>
          ))}
        </ul>
        <p className={styles.note}>{GAZETTEER_NOTE}</p>
      </div>
    </div>
  );
}
