// Coming soon (`/soon/:item`, and `/tx/:county/*`; A-13 T042, US10, AC-13, FR-013): the item's
// "Coming soon" label, title, one sentence and a static skeleton (content/coming-soon.ts). An
// unknown or unlinked item (AI-user sign-in) has no page. Another county's URL
// (`/tx/{other}/…`) shows "CountyLens has data for Travis County, TX only" with a link to
// Explore and no data; an unknown page under Travis says so. A react-router lazy route module.
import { ROUTES } from "@countylens/shared/routes";
import { PAGE_TEXTS } from "@countylens/shared/texts";
import type { ReactElement } from "react";
import { Link, useParams } from "react-router";
import { ComingSoonSkeleton } from "../components/ComingSoonSkeleton";
import { Icon } from "../components/Icon";
import { comingSoonItem } from "../content/coming-soon";
import styles from "./ComingSoon.module.css";

/** "williamson" → "Williamson"; anything that is not a plain county slug gives null. */
function countyName(slug: string): string | null {
  if (!/^[a-z]+(-[a-z]+)*$/.test(slug)) return null;
  return slug
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function Component(): ReactElement {
  const { item: itemId, county } = useParams();

  if (county !== undefined && county !== "travis") {
    const name = countyName(county);
    return (
      // Shell390ComingSoon board: a dialog-style card centred in the page with the clock icon,
      // "{County}, TX is coming soon", the Travis-only sentence, why there is nothing to show, and
      // a filled "Stay on Travis County" button at its end. The county name comes from the URL.
      <section aria-label="Other county" data-route="other-county" className={styles.countyPage}>
        <div className={styles.countyCard}>
          <span className={styles.clock}>
            <Icon name="schedule" />
          </span>
          <h2 className={styles.title}>
            {name === null ? "Other counties" : `${name} County, TX is coming soon`}
          </h2>
          <div className={styles.body}>
            <p className={styles.sentence} data-county-message="">
              {PAGE_TEXTS.travisOnly}
            </p>
            <p className={styles.sentence}>
              {name === null
                ? "No pipeline run covers this county yet, so there is nothing to show."
                : `No pipeline run covers ${name} County yet, so there is nothing to show.`}
            </p>
          </div>
          <Link to={ROUTES.explore} className={styles.filled}>
            Stay on Travis County
          </Link>
        </div>
      </section>
    );
  }

  const item = itemId === undefined ? undefined : comingSoonItem(itemId);
  if (item === undefined || !item.linked) {
    return (
      <section
        aria-label="Coming soon"
        data-route="coming-soon"
        data-state="not-found"
        className={styles.page}
      >
        <h2 className={styles.title}>Page not found</h2>
        <p className={styles.sentence}>There is no page at this address.</p>
        <Link to={ROUTES.hub} className={styles.link}>
          Back to the Hub
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-label="Coming soon"
      data-route="coming-soon"
      data-state="ready"
      className={styles.page}
    >
      <div data-coming-soon-item={item.id} className={styles.page}>
        <span className={styles.label}>{PAGE_TEXTS.comingSoon}</span>
        <h2 className={styles.title}>{item.title}</h2>
        <p className={styles.sentence} data-coming-soon-sentence="">
          {item.sentence}
        </p>
        <ComingSoonSkeleton layout={item.skeleton} />
      </div>
    </section>
  );
}
