// The shell of every page (A-03 T007; A-13 T015; plan § "Atlas element map" → Shell).
// Atlas § 7: top app bar (64 px, `surface`, title-large, elevation 2 on scroll) whose only
// control is the title, a link to the Hub (`/`); bottom navigation below 600 px and navigation
// rail from 600 px, each with the same pill indicator and the destinations Explore, Runs,
// Coverage and Data, plus More. More opens a sheet (bottom sheet at 390, side sheet from 600)
// listing the other pages and every Coming soon item (content/coming-soon.ts) with the
// "Coming soon" label. Escape or choosing a link closes it and focus returns to More.
// Layout and colours come only from tokens.css through AppShell.module.css.
// DOM order is banner, navigation, main (ERR-13: Tab reaches the rail before the page content);
// the grid areas place the bottom navigation below main on compact widths, so nothing moves.
import { ROUTES, comingSoonPath } from "@countylens/shared/routes";
import { PAGE_TEXTS } from "@countylens/shared/texts";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type UIEvent,
} from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { COMING_SOON_ITEMS } from "../content/coming-soon";

import {
  AdminAccessProvider,
  AdminChip,
  AdminMoreLink,
  AdminNavItem,
  hasStoredSession,
} from "./AdminNav";
import { CountySelect } from "./CountySelect";
import { AppRows, AppsMenu, HelpMenu } from "./HelpMenu";
import { SyncBadge } from "./SyncBadge";
import { useMinWidth } from "../data/use-min-width";
import { Icon } from "./Icon";
import styles from "./AppShell.module.css";

export const APP_TITLE = "CountyLens";
export const MORE_LABEL = "More";
/** PO 2026-10-26: from 600 px the rail's last item opens only the planned items. */
export const SOON_LABEL = "Coming soon";
/** The sheet button's glyph per width (named as `icon:` so the font-subset check sees them). */
const SHEET_ICONS = {
  wide: { icon: "schedule" },
  compact: { icon: "more_horiz" },
} as const;
/** Shell1440 board: the app bar's "Ask" entry opens Explore's AI tab. */
export const ASK_LABEL = "Ask";
export const ASK_PATH = `${ROUTES.explore}?mode=ai`;
/** A13-7: the accessible name of the focusable scroll container `<main>`. */
export const MAIN_LABEL = "Page content";

export interface Destination {
  readonly to: string;
  readonly label: string;
  /** Material Symbols Rounded glyph name (Atlas § 6). */
  readonly icon: string;
  /** Shell390More board: false = not in the bottom navigation below 600 px (listed in More). */
  readonly compact?: false;
}

export const DESTINATIONS: readonly Destination[] = [
  { to: ROUTES.explore, label: "Explore", icon: "map" },
  { to: ROUTES.runs, label: "Runs", icon: "history" },
  { to: ROUTES.coverage, label: "Coverage", icon: "donut_small", compact: false },
  { to: ROUTES.dataManifest, label: "Data", icon: "dataset" },
  // PO 2026-10-26: MCP is a rail destination (below 600 px it is a More row).
  { to: ROUTES.helpMcp, label: "MCP", icon: "integration_instructions", compact: false },
];

/** More sheet rows shown only below 600 px (Shell390More board: Coverage; the SQL row was removed
 *  with the Explore SQL tab by PO decision, A-16). */
const COMPACT_MORE: readonly {
  readonly to: string;
  readonly label: string;
  readonly icon: string;
}[] = [
  { to: ROUTES.coverage, label: "Coverage", icon: "donut_small" },
  { to: ROUTES.helpMcp, label: "MCP", icon: "integration_instructions" },
];

/** Shell1440 board (Task B's rail pattern): Explore's modes nested under Explore in the rail while
 *  Explore is the current page (from 600 px). Builder (Coming soon) stays in the More sheet only. */
const EXPLORE_CHILDREN: readonly {
  readonly to: string;
  readonly label: string;
  readonly icon: string;
  readonly mode?: "filters" | "ai";
}[] = [
  { to: ROUTES.explore, label: "Filters", icon: "tune", mode: "filters" },
  { to: ASK_PATH, label: "AI", icon: "auto_awesome", mode: "ai" },
];

/** PO 2026-10-26: the legal pages sit in the footer of every page. */
const LEGAL_LINKS: readonly { readonly to: string; readonly label: string }[] = [
  { to: ROUTES.legalTerms, label: "Terms" },
  { to: ROUTES.legalPrivacy, label: "Privacy" },
  { to: ROUTES.legalData, label: "Data licences" },
];

function Glyph({ name }: { readonly name: string }): ReactElement {
  return (
    <span className={`material-symbols-rounded ${styles.glyph}`} aria-hidden="true">
      {name}
    </span>
  );
}

/** Shell1440 board: the app bar's search box (from 1024 px; A-16 port of Task B's combobox).
 *  The combobox module (gazetteer suggestions) loads on first focus, so the shell stays small;
 *  until then this placeholder field stands in with the same label. */
export const SEARCH_LABEL = "Search CountyLens: town, ZIP, permit or a question";

const SearchBox = lazy(() => import("./SearchBox").then((m) => ({ default: m.SearchBox })));

function HeaderSearch(): ReactElement {
  const [live, setLive] = useState<string | null>(null);
  const field = (
    <div role="search" className={styles.search}>
      <Icon name="location_on" size="medium" />
      <input
        type="text"
        role="combobox"
        aria-expanded={false}
        className={styles.searchInput}
        aria-label={SEARCH_LABEL}
        placeholder={SEARCH_LABEL}
        value={live ?? ""}
        onFocus={() => setLive((t) => t ?? "")}
        onChange={(event) => setLive(event.target.value)}
      />
    </div>
  );
  if (live === null) return field;
  return (
    <Suspense fallback={field}>
      <SearchBox initialText={live} autoFocus className={styles.search} />
    </Suspense>
  );
}

function MoreSheet({
  onClose,
  label,
}: {
  readonly onClose: () => void;
  readonly label: string;
}): ReactElement {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.focus();
  }, []);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      // Focus trap: Tab and Shift+Tab cycle inside the sheet.
      // From 600 px the compact-only rows are display:none and cannot take focus.
      const wide =
        typeof window.matchMedia === "function" && window.matchMedia("(min-width: 600px)").matches;
      const items = Array.from(
        sheet.current?.querySelectorAll<HTMLElement>("a[href]") ?? [],
      ).filter((a) => !(wide && a.closest(`.${styles.compactOnly}`) !== null));
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === sheet.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );
  return (
    <div
      ref={sheet}
      id="more-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className={styles.sheet}
      onKeyDown={onKeyDown}
    >
      <span className={styles.grabber} aria-hidden="true" />
      {/* Shell390More board: the pages as one outlined list; Coverage and Admin sign-in only
          where the bottom navigation has no room for them. */}
      <ul className={`${styles.sheetCard} ${styles.compactOnly}`} aria-label="Pages">
        {COMPACT_MORE.map((page) => (
          <li key={page.to} className={`${styles.sheetRow} ${styles.compactOnly}`}>
            <Icon name={page.icon} />
            <Link to={page.to} className={styles.sheetItem} onClick={onClose}>
              {page.label}
            </Link>
          </li>
        ))}
        <li className={`${styles.sheetRow} ${styles.compactOnly}`}>
          <Icon name="admin_panel_settings" />
          <AdminMoreLink className={styles.sheetItem} onClick={onClose} />
        </li>
      </ul>
      {/* Task B's More sheet: the planned items, each row with its tonal "Coming soon" pill. */}
      <h2 className={styles.sheetTitle}>Planned</h2>
      <ul className={styles.sheetList} aria-label="Planned">
        {COMING_SOON_ITEMS.map((item) => (
          <li key={item.id} className={styles.sheetRow}>
            <Icon name="schedule" />
            {item.linked ? (
              <Link
                to={comingSoonPath(item.id)}
                className={styles.sheetItem}
                onClick={onClose}
                data-coming-soon-entry={item.id}
              >
                <span>{item.title}</span>
                <span className={styles.soon}>{PAGE_TEXTS.comingSoon}</span>
              </Link>
            ) : (
              <span className={styles.sheetItem}>
                <span>{item.title}</span>
                <span className={styles.soon}>{PAGE_TEXTS.comingSoon}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {/* Shell390More "Apps" (Task B's Apps group): the app switcher rows. */}
      <h2 className={styles.sheetTitle}>Apps</h2>
      <ul className={styles.sheetList} aria-label="Apps">
        <AppRows onNavigate={onClose} className={styles.appRow} />
      </ul>
    </div>
  );
}

export function AppShell(): ReactElement {
  // The main region is the scroll container (the bottom navigation stays in view on compact
  // widths without a non-token padding), so the bar's elevation follows its scroll offset.
  const [scrolled, setScrolled] = useState(false);
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    setScrolled(event.currentTarget.scrollTop > 0);
  }, []);
  // The location slot (county selector) sits at the top of the page region under `/tx/…`; the
  // app bar keeps the title as its only control.
  const { pathname, search } = useLocation();
  const inCounty = pathname.startsWith("/tx/");
  const onExplore = pathname === ROUTES.explore;
  const aiMode = new URLSearchParams(search).get("mode") === "ai";
  // Legal and Coming soon pages are static and make no data request (A-13 TC-056), so the sync
  // badge, which reads /runs/index.json, is not rendered there (justified board difference).
  const staticPage = pathname.startsWith("/legal/") || pathname.startsWith("/soon/");
  const [moreOpen, setMoreOpen] = useState(false);
  // From 600 px every page has a rail item, so the sheet holds only the planned items.
  const wide = useMinWidth(600);
  const moreLabel = wide ? SOON_LABEL : MORE_LABEL;
  const moreButton = useRef<HTMLButtonElement>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  // Return focus to More after the background is no longer inert (an inert element cannot take
  // focus), so this runs after the render that closes the sheet.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !moreOpen) moreButton.current?.focus();
    wasOpen.current = moreOpen;
  }, [moreOpen]);

  // Ask admin.me again whenever a session appears or goes (sign-in, sign-out); none = no request.
  const sessionKey = hasStoredSession() ? "session" : "signed-out";

  return (
    <AdminAccessProvider key={sessionKey}>
      <div className={styles.shell}>
        <header
          inert={moreOpen}
          className={scrolled ? `${styles.bar} ${styles.barScrolled}` : styles.bar}
        >
          <h1 className={styles.title}>
            <Link to={ROUTES.hub} className={styles.titleLink}>
              {APP_TITLE}
            </Link>
          </h1>
          {inCounty ? (
            <div className={styles.location}>
              <CountySelect />
            </div>
          ) : null}
          <HeaderSearch />
          <div className={styles.actions}>
            <AdminChip className={styles.adminChip} />
            {staticPage ? null : (
              <span className={styles.sync}>
                <SyncBadge />
              </span>
            )}
            <HelpMenu />
            <Link to={ASK_PATH} className={styles.ask} aria-label={ASK_LABEL}>
              <Icon name="smart_toy" size="medium" />
              <span className={styles.askText} aria-hidden="true">
                {ASK_LABEL}
              </span>
            </Link>
            <span className={styles.apps}>
              <AppsMenu />
            </span>
          </div>
        </header>
        <nav className={styles.nav} aria-label="Primary" inert={moreOpen}>
          {DESTINATIONS.map((destination) => [
            <NavLink
              key={destination.to}
              to={destination.to}
              className={({ isActive }) =>
                [
                  styles.item,
                  isActive ? styles.itemActive : "",
                  destination.compact === false ? styles.compactHidden : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              }
            >
              <span className={styles.pill}>
                <Glyph name={destination.icon} />
              </span>
              <span className={styles.label}>{destination.label}</span>
            </NavLink>,
            destination.to === ROUTES.explore && onExplore
              ? EXPLORE_CHILDREN.map((child) => {
                  const current =
                    child.mode !== undefined && child.mode === (aiMode ? "ai" : "filters");
                  return (
                    <Link
                      key={child.label}
                      to={child.to}
                      aria-current={current ? "page" : undefined}
                      data-nested=""
                      className={`${styles.item} ${styles.itemNested} ${
                        current ? styles.itemActive : ""
                      }`}
                    >
                      <span className={styles.pill}>
                        <Glyph name={child.icon} />
                      </span>
                      <span className={styles.label}>{child.label}</span>
                    </Link>
                  );
                })
              : null,
          ])}
          <AdminNavItem
            classes={{
              item: `${styles.item} ${styles.compactHidden}`,
              itemActive: styles.itemActive,
              pill: styles.pill,
              label: styles.label,
            }}
          />
          <button
            ref={moreButton}
            type="button"
            className={styles.more}
            aria-expanded={moreOpen}
            aria-controls="more-sheet"
            onClick={() => setMoreOpen((open) => !open)}
          >
            <span className={styles.pill}>
              <Glyph name={wide ? SHEET_ICONS.wide.icon : SHEET_ICONS.compact.icon} />
            </span>
            <span className={styles.label}>{moreLabel}</span>
          </button>
        </nav>
        {moreOpen ? (
          <>
            <div
              className={styles.scrim}
              data-more-scrim=""
              onClick={closeMore}
              aria-hidden="true"
            />
            <MoreSheet onClose={closeMore} label={moreLabel} />
          </>
        ) : null}
        <main
          className={styles.main}
          onScroll={onScroll}
          inert={moreOpen}
          tabIndex={0}
          aria-label={MAIN_LABEL}
        >
          {/* At least one screen tall, so the footer starts below the fold and a page that grows
              as its data loads never pushes it across the screen (CLS, A-13 TC-058). */}
          <div className={styles.content}>
            <Outlet />
          </div>
          <footer className={styles.footer}>
            <nav aria-label="Legal" className={styles.footerLinks}>
              {LEGAL_LINKS.map((link) => (
                <Link key={link.to} to={link.to} className={styles.footerLink}>
                  {link.label}
                </Link>
              ))}
            </nav>
          </footer>
        </main>
      </div>
    </AdminAccessProvider>
  );
}
