// Legal · Terms (`/legal/terms`; A-13 T038, AC-11; A-16 T050 per the LegalTerms1440/768 boards):
// "On this page" contents and the board's sections (What CountyLens is, Using the data, Fair use,
// The AI helper, Availability), static text, no data request, not legal advice. The board's
// Contact section is left out: the project publishes no contact address. A lazy route module.
import type { ReactElement } from "react";
import { Link } from "react-router";
import { ROUTES } from "@countylens/shared/routes";
import { LegalLayout } from "../components/LegalLayout";
import styles from "./LegalData.module.css";

export function Component(): ReactElement {
  return (
    <section aria-label="Legal · Terms" data-route="legal-terms" className={styles.page}>
      <LegalLayout
        title="Terms"
        current={ROUTES.legalTerms}
        banner="These terms describe how CountyLens may be used. They are not legal advice."
        sections={[
          {
            id: "what",
            title: "What CountyLens is",
            body: (
              <p className={styles.body}>
                A free tool for exploring public property, permit and contractor records for Travis
                County, TX. It is not legal, financial or construction advice.
              </p>
            ),
          },
          {
            id: "data",
            title: "Using the data",
            body: (
              <>
                <p className={styles.body}>
                  The records are shown as published, with the source, collection time and run
                  behind each one. A missing value says why it is missing. Derived values, such as
                  roof age, state their basis next to the value. Each source publisher sets its own
                  terms for its data; they apply to your use of the records.
                </p>
                <Link className={styles.link} to={ROUTES.legalData}>
                  Data sources
                </Link>
              </>
            ),
          },
          {
            id: "fair-use",
            title: "Fair use",
            body: (
              <p className={styles.body}>
                Rate limits apply to search, the AI helper and the MCP tools. Do not use owner
                information to harass anyone, or in ways the source terms forbid.
              </p>
            ),
          },
          {
            id: "ai",
            title: "The AI helper",
            body: (
              <p className={styles.body}>
                Answers come only from published data, cite their records and state their
                assumptions. They can still be incomplete; open the cited records to check.
              </p>
            ),
          },
          {
            id: "availability",
            title: "Availability and warranty",
            body: (
              <p className={styles.body}>
                CountyLens is provided as is, without warranty. Counties marked Coming soon have no
                data. Features may change; published content IDs stay retrievable from public
                gateways. Check a record against its source before relying on it.
              </p>
            ),
          },
        ]}
      />
    </section>
  );
}
