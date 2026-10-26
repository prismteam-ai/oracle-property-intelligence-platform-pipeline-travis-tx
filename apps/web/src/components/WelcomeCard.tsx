// Explore's first-visit "What can I ask?" card (A-16 T050; Welcome1440/768/390 boards): one
// sentence on what CountyLens holds, three sample questions that open the AI tab with the
// question filled in, and "Got it". Shown on a first visit (nothing stored in this browser) or
// when the URL asks for it (`?welcome=1`, the header help menu). It sits in the flow above the
// results, never over them. "Got it" remembers the dismissal in this browser only.
import { ROUTES } from "@countylens/shared/routes";
import { useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router";
import { Icon } from "./Icon";
import styles from "./WelcomeCard.module.css";

export const WELCOME_TITLE = "What can I ask?";
export const WELCOME_TEXT =
  "Public property, permit and owner records for Travis County, TX. Ask in plain English, or use the Filters. Every answer shows its sources.";
/** The board's three sample questions (the first two are the README demo prompts' shape). */
export const WELCOME_QUESTIONS: readonly string[] = Object.freeze([
  "Which properties within five miles of Austin have roofs older than 15 years?",
  "Which properties near Austin have open roofing permits that have been open for many years, and who is the listed contractor?",
  "Out-of-area owners with roofs over 20 years within 5 miles of Austin",
]);
const STORAGE_KEY = "countylens.welcome.dismissed";

function dismissedBefore(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** `?mode=ai&q=…`: the AI tab with the question in the box. */
export const askPath = (question: string): string =>
  `${ROUTES.explore}?mode=ai&q=${encodeURIComponent(question)}`;

export function WelcomeCard(): ReactElement | null {
  const [params, setParams] = useSearchParams();
  const asked = params.get("welcome") === "1";
  const [hidden, setHidden] = useState(dismissedBefore);
  if (hidden && !asked) return null;
  const dismiss = (): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Private mode: the card simply shows again next time.
    }
    setHidden(true);
    if (asked)
      setParams(
        (current) => {
          const p = new URLSearchParams(current);
          p.delete("welcome");
          return p;
        },
        { replace: true },
      );
  };
  return (
    <section className={styles.card} aria-labelledby="welcome-title" data-welcome-card="">
      <header className={styles.head}>
        <Icon name="lightbulb" />
        <h3 id="welcome-title" className={styles.title}>
          {WELCOME_TITLE}
        </h3>
        <button
          type="button"
          className={styles.close}
          aria-label="Close What can I ask?"
          onClick={dismiss}
        >
          <Icon name="close" />
        </button>
      </header>
      <p className={styles.text}>{WELCOME_TEXT}</p>
      <ul className={styles.questions}>
        {WELCOME_QUESTIONS.map((q) => (
          <li key={q}>
            <Link to={askPath(q)} className={styles.question}>
              <Icon name="auto_awesome" size="medium" />
              <span>{q}</span>
              <Icon name="arrow_forward" size="medium" />
            </Link>
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <button type="button" className={styles.gotIt} onClick={dismiss}>
          Got it
        </button>
      </div>
    </section>
  );
}
