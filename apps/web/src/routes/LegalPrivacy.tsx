// Legal · Privacy (`/legal/privacy`; A-13 T038, AC-11; A-16 T050 per the LegalPrivacy1440/768
// boards): contents and the board's sections (In short, What we record, What stays in your
// browser, Admin accounts, Other services, Your choices). Static text, no data request. Every
// statement describes what this build does: the API's query log holds request metadata only
// (time, route, status, size, latency; infra api-stack access log, kept thirty days), the Lambda
// logs IDs and counts only, the browser keeps the AI question count and the admin session. Not
// legal advice. A lazy route module.
import type { ReactElement } from "react";
import { Link } from "react-router";
import { ROUTES } from "@countylens/shared/routes";
import { LegalLayout } from "../components/LegalLayout";
import styles from "./LegalData.module.css";

export function Component(): ReactElement {
  return (
    <section aria-label="Legal · Privacy" data-route="legal-privacy" className={styles.page}>
      <LegalLayout
        title="Privacy"
        current={ROUTES.legalPrivacy}
        banner="This page describes what CountyLens records and keeps. It is not legal advice."
        sections={[
          {
            id: "short",
            title: "In short",
            body: (
              <p className={styles.body}>
                CountyLens has no visitor accounts and asks for no personal details. Searching needs
                no name, email address or login.
              </p>
            ),
          },
          {
            id: "record",
            title: "What we record",
            body: (
              <p className={styles.body}>
                The API keeps a request log for thirty days: the time, the route, the response
                status, its size and how long it took. It does not record your search terms, your
                questions or the records you open. It also keeps a running daily total of AI
                spending, with no question text. Admins see totals from this log on the Activity
                page.
              </p>
            ),
          },
          {
            id: "browser",
            title: "What stays in your browser",
            body: (
              <p className={styles.body}>
                Your browser keeps how many AI questions you asked in this session, whether you
                closed the What can I ask? card and, for an admin, the sign-in session. Nothing of
                this is sent anywhere else.
              </p>
            ),
          },
          {
            id: "admin",
            title: "Admin accounts",
            body: (
              <p className={styles.body}>
                Only the project's admins have accounts, created by the operator; there is no
                sign-up. Admin sign-in uses Amazon Cognito.
              </p>
            ),
          },
          {
            id: "services",
            title: "Other services",
            body: (
              <>
                <p className={styles.body}>
                  To show published records your browser reads files from this site, from the CID
                  copy of the published data, and from the public IPFS gateways named on the Data
                  pages. Like any web host, those services can see your IP address and the files you
                  request. An AI question is sent to the AI model service that answers it. The
                  records themselves are collected from public sources, each listed with its terms.
                </p>
                <Link className={styles.link} to={ROUTES.legalData}>
                  Data sources
                </Link>
              </>
            ),
          },
          {
            id: "choices",
            title: "Your choices",
            body: (
              <p className={styles.body}>
                Filters work without the AI helper and run entirely in your browser. Clearing this
                site's storage in your browser removes what it kept.
              </p>
            ),
          },
        ]}
      />
    </section>
  );
}
