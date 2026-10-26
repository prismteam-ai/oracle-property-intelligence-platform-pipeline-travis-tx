// The legal pages' layout (A-13 T038, A-16 T050; LegalData/LegalPrivacy/LegalTerms 1440/768/390
// boards): an "On this page" table of contents with a "Related" list of the other legal pages, then
// the page title (the board's short name: "Privacy", "Terms", "Data use and licences"), an optional
// provenance line under it, the info banner and one titled section per entry with an anchor the
// contents link to. From 1024 px the contents are a side column beside the text and the pair is
// centred in the main column (the board's layout); from 600 to 1023 px they are rows of links above
// the title; below 600 px only the Related links show, after the text with a divider above them, as
// the 390 board ends its page. `measure` sets the text column's width: "wide" for the Data page's
// sources table, "prose" for Privacy and Terms. Static text only. Render-only.
import { ROUTES } from "@countylens/shared/routes";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "./Icon";
import styles from "./LegalLayout.module.css";

export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly body: ReactNode;
}

const RELATED = [
  { to: ROUTES.legalTerms, label: "Terms" },
  { to: ROUTES.legalPrivacy, label: "Privacy" },
  { to: ROUTES.legalData, label: "Data use and licences" },
] as const;

export function LegalLayout({
  title,
  current,
  banner,
  meta,
  intro,
  sections,
  measure = "prose",
}: {
  readonly title: string;
  readonly current: string;
  readonly banner: string;
  /** The board's provenance line under the title (body-small), only for a sourced fact. */
  readonly meta?: ReactNode;
  readonly intro?: ReactNode;
  readonly sections: readonly LegalSection[];
  readonly measure?: "wide" | "prose";
}): ReactElement {
  return (
    <div className={`${styles.layout} ${measure === "wide" ? styles.wide : styles.prose}`}>
      <nav className={styles.toc} aria-label="On this page">
        <div className={styles.onPage}>
          <p className={styles.tocTitle}>On this page</p>
          <ul className={styles.tocList}>
            {sections.map((s) => (
              <li key={s.id}>
                <a className={styles.tocLink} href={`#${s.id}`}>
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.related}>
          <p className={styles.tocTitle}>Related</p>
          <ul className={styles.tocList}>
            {RELATED.filter((r) => r.to !== current).map((r) => (
              <li key={r.to}>
                <Link className={styles.tocLink} to={r.to}>
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <div className={styles.text}>
        {/* The board shows the short name; "Legal · " stays in the heading's name for screen
            readers and the tests that read it (legal.test.tsx). */}
        <h2 className={styles.title}>
          <span className={styles.srOnly}>Legal · </span>
          {title}
        </h2>
        {meta === undefined ? null : <p className={styles.meta}>{meta}</p>}
        <p className={styles.banner} data-legal-banner="">
          <Icon name="info" size="medium" />
          <span>{banner}</span>
        </p>
        {intro}
        {sections.map((s) => (
          <section key={s.id} id={s.id} className={styles.section} aria-labelledby={`${s.id}-h`}>
            <h3 id={`${s.id}-h`} className={styles.sectionTitle}>
              {s.title}
            </h3>
            {s.body}
          </section>
        ))}
      </div>
    </div>
  );
}
