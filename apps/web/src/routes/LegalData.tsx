// Legal · Data sources (`/legal/data`; A-13 T038, AC-11, FR-011, D-8; A-16 T050 per the
// LegalData1440/768/390 boards): "On this page" contents, then Sources and licences (each of the
// seven sources as a row: source, what it provides, its official terms or licence link, and the
// date and HTTP status the link was checked), the four access rules, How to cite and Corrections.
// Static text from content/legal.ts: no data request, no legal advice. A react-router lazy route
// module exporting `Component`.
import { ROUTES } from "@countylens/shared/routes";
import type { ReactElement } from "react";
import { Link } from "react-router";
import { LegalLayout } from "../components/LegalLayout";
import {
  ACCESS_RULES,
  ACCESS_RULES_HEADING,
  LEGAL_NOT_ADVICE,
  LEGAL_SOURCES,
} from "../content/legal";
import styles from "./LegalData.module.css";

// The board's "licences checked" line, from the dates the terms pages were requested.
const CHECKED_ON = LEGAL_SOURCES.map((s) => s.checkedOn)
  .sort()
  .at(-1);

export function Component(): ReactElement {
  return (
    <section aria-label="Legal · Data sources" data-route="legal-data" className={styles.page}>
      <LegalLayout
        title="Data use and licences"
        {...(CHECKED_ON === undefined
          ? {}
          : { meta: `Terms and licence pages last checked ${CHECKED_ON}` })}
        measure="wide"
        current={ROUTES.legalData}
        banner={LEGAL_NOT_ADVICE}
        intro={
          <p className={styles.body}>
            CountyLens publishes records collected from the seven public sources below. Each keeps
            its own terms or licence.
          </p>
        }
        sections={[
          {
            id: "sources",
            title: "Sources and licences",
            body: (
              <div className={styles.sourceTable}>
                <div className={styles.sourceHead} aria-hidden="true">
                  <span>Source</span>
                  <span>Provides</span>
                  <span>Licence or terms</span>
                </div>
                <ul className={styles.sourceRows} aria-label="Data sources">
                  {LEGAL_SOURCES.map((source) => (
                    <li key={source.id} className={styles.sourceRow} data-source={source.id}>
                      <span className={styles.sourceName}>{source.name}</span>
                      <p className={styles.cell}>{source.fact}</p>
                      <span className={styles.licence}>
                        <a
                          className={styles.link}
                          href={source.termsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {source.termsLabel}
                        </a>
                        <span className={styles.small}>
                          Page requested {source.checkedOn} · HTTP {source.checkedStatus}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          },
          {
            id: "access",
            title: ACCESS_RULES_HEADING,
            body: (
              <ul className={styles.rules} aria-label={ACCESS_RULES_HEADING}>
                {ACCESS_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            ),
          },
          {
            id: "cite",
            title: "How to cite",
            body: (
              <p className={styles.body}>
                Name the source, the run and the content ID of the file you used, for example:
                “Austin permits, run {"{run ID}"}, table CID {"{CID}"}”. Each record&apos;s
                provenance line in Explore shows all three, and the{" "}
                <Link className={styles.inlineLink} to={ROUTES.dataManifest}>
                  run manifest
                </Link>{" "}
                lists every file with its CID.
              </p>
            ),
          },
          {
            id: "corrections",
            title: "Corrections",
            body: (
              <p className={styles.body}>
                A published file never changes: its content ID is its fingerprint. A correction
                appears in a later run, which links back to the run before it, and Runs · Compare
                shows what changed.
              </p>
            ),
          },
        ]}
      />
    </section>
  );
}
