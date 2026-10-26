// County selector (A-13 T042, US10, AC-13, FR-013; TC-061, TC-071): the shell's location slot
// under `/tx/…`. Travis County, TX is the active county and the only one with data; choosing any
// other county shows "CountyLens has data for Travis County, TX only", changes nothing and leaves
// the URL alone. The counties listed besides Travis are plain names, no data.
// Shell boards (A-16): an outlined chip (pin, county, drop-down caret; Task B's county chip) from
// 600 px; below 600 px the pin alone, a 48 px icon control with the same select laid over it
// (Welcome390 board), so the bar keeps one row. As on the boards, the bar has no "Other counties
// and states" link: that Coming soon item is listed in the More sheet. Render-only apart from the
// message state.
import { PAGE_TEXTS } from "@countylens/shared/texts";
import { useState, type ChangeEvent, type ReactElement } from "react";
import { Icon } from "./Icon";
import styles from "./CountySelect.module.css";

const COUNTIES = Object.freeze([
  { value: "travis", label: "Travis County, TX" },
  { value: "harris", label: "Harris County, TX" },
  { value: "dallas", label: "Dallas County, TX" },
  { value: "bexar", label: "Bexar County, TX" },
  { value: "williamson", label: "Williamson County, TX" },
]);

export function CountySelect(): ReactElement {
  const [other, setOther] = useState(false);
  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setOther(event.currentTarget.value !== "travis");
  };
  return (
    <div className={styles.location}>
      <label className={styles.hidden} htmlFor="county-select">
        County
      </label>
      <span className={styles.chip}>
        <Icon name="location_on" size="medium" />
        <select
          id="county-select"
          className={styles.select}
          value="travis"
          onChange={onChange}
          data-county-picker=""
          data-main-control=""
        >
          {COUNTIES.map((county) => (
            <option key={county.value} value={county.value}>
              {county.label}
            </option>
          ))}
        </select>
        <span className={styles.caret}>
          <Icon name="arrow_drop_down" size="medium" />
        </span>
      </span>
      {other ? (
        <p className={styles.message} role="status" data-county-message="">
          {PAGE_TEXTS.travisOnly}
        </p>
      ) : null}
    </div>
  );
}
