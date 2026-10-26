// Header menus (A-16 T050; Shell1440 board, Task B's ShellTopBar pattern): two icon buttons that
// open an Atlas § 7 menu each.
// - Help ("?"): What can I ask? (Explore's first-visit card), Field glossary (the Data catalog's
//   field tables), MCP and API docs and Data use and licences. The board's "Keyboard shortcuts"
//   row is left out: the app defines no shortcuts.
// - Apps (the grid icon at the end of the bar; CrmAppsMenu): the app switcher. CountyLens is the
//   current app (checked); Roofing CRM links out only when `crmUrl` in /site-links.json is an https
//   URL, otherwise the row says "Coming soon · Not deployed yet" (the Hub's rule). The links file
//   is read when the menu first opens, so pages that make no data request stay that way.
// Escape, a pick or a click outside closes a menu; focus returns to its button.
import { PAGE_TEXTS } from "@countylens/shared/texts";
import { ROUTES } from "@countylens/shared/routes";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { loadSiteLinks, type SiteLinks } from "../data/site-links";
import { Icon } from "./Icon";
import styles from "./HelpMenu.module.css";

export const HELP_LABEL = "Help";
export const APPS_LABEL = "Apps";

/** `?welcome=1` opens Explore's "What can I ask?" card even after it was dismissed. */
export const WELCOME_PATH = `${ROUTES.explore}?welcome=1`;

export const HELP_ITEMS: readonly {
  readonly label: string;
  readonly icon: string;
  readonly to: string;
}[] = [
  { label: "What can I ask?", icon: "lightbulb", to: WELCOME_PATH },
  { label: "Field glossary", icon: "menu_book", to: ROUTES.dataCatalog },
  { label: "MCP and API docs", icon: "integration_instructions", to: ROUTES.helpMcp },
  { label: "Data use and licences", icon: "license", to: ROUTES.legalData },
];

/** An icon button with a menu under it (shared by Help and Apps). */
function MenuButton({
  label,
  icon,
  children,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly children: (close: () => void) => ReactNode;
}): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("a")?.focus();
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("a") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
  };
  return (
    <div className={styles.wrap}>
      <button
        ref={button}
        type="button"
        className={styles.icon}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open ? (
        <ul
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          className={styles.menu}
          onKeyDown={onKeyDown}
        >
          {children(() => close(false))}
        </ul>
      ) : null}
    </div>
  );
}

export function HelpMenu(): ReactElement {
  return (
    <MenuButton label={HELP_LABEL} icon={<Icon name="help" />}>
      {(close) =>
        HELP_ITEMS.map((item) => (
          <li key={item.label} role="none">
            <Link role="menuitem" to={item.to} className={styles.item} onClick={close}>
              <Icon name={item.icon} />
              <span data-help-label="">{item.label}</span>
            </Link>
          </li>
        ))
      }
    </MenuButton>
  );
}

/** The app-switcher rows (Task B AppLinks): used in the Apps menu and the More sheet. */
export function AppRows({
  itemRole,
  onNavigate,
  className,
}: {
  readonly itemRole?: "menuitem";
  readonly onNavigate?: () => void;
  readonly className?: string | undefined;
}): ReactElement {
  const [links, setLinks] = useState<SiteLinks | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadSiteLinks({ signal: controller.signal }).then((l) => {
      if (!controller.signal.aborted) setLinks(l);
    });
    return () => controller.abort();
  }, []);
  const row = `${styles.item} ${className ?? ""}`;
  const crmUrl = links?.crmUrl;
  return (
    <>
      <li role={itemRole === undefined ? undefined : "none"} data-app="countylens">
        <Link
          role={itemRole}
          to={ROUTES.hub}
          aria-current="page"
          className={row}
          onClick={onNavigate}
        >
          <Icon name="map" />
          <span className={styles.label}>CountyLens</span>
          <span className={styles.check} title="Current app">
            <Icon name="check" />
          </span>
        </Link>
      </li>
      <li role={itemRole === undefined ? undefined : "none"} data-app="crm">
        {crmUrl === undefined ? (
          <span role={itemRole} aria-disabled="true" className={`${row} ${styles.unavailable}`}>
            <Icon name="roofing" />
            <span className={styles.label}>Roofing CRM</span>
            <span className={styles.reason}>
              {links === null ? "Loading" : PAGE_TEXTS.comingSoonNotDeployed}
            </span>
          </span>
        ) : (
          <a role={itemRole} href={crmUrl} className={row} onClick={onNavigate}>
            <Icon name="roofing" />
            <span className={styles.label}>Roofing CRM</span>
          </a>
        )}
      </li>
    </>
  );
}

export function AppsMenu(): ReactElement {
  return (
    // The symbols subset has no `apps` glyph: the 3 × 3 dot grid is drawn in CSS (decorative).
    <MenuButton label={APPS_LABEL} icon={<span className={styles.appsGlyph} aria-hidden="true" />}>
      {(close) => <AppRows itemRole="menuitem" onNavigate={close} />}
    </MenuButton>
  );
}
