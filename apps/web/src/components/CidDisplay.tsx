// CID display (A-03 T055; plan § "Atlas element map" → Shell → CID display): the mono face,
// middle-truncated text (`bafy…q4xa`: first 4 characters, `…`, last 4), and a copy icon button
// with a 48 × 48 target. The full CID is the element's `data-cid` and `title` and is what the
// button copies; tests read `data-cid` or the clipboard, never the visible text (TC-010).
import { useCallback, type ReactElement } from "react";
import { Icon } from "./Icon";
import styles from "./CidDisplay.module.css";

/** `bafybeig…q4xa` → `bafy…q4xa`; a value too short to truncate is shown whole. */
export function truncateCid(cid: string): string {
  return cid.length <= 9 ? cid : `${cid.slice(0, 4)}…${cid.slice(-4)}`;
}

export interface CidDisplayProps {
  /** The full CIDv1; shown truncated, copied whole. */
  readonly cid: string;
}

export function CidDisplay({ cid }: CidDisplayProps): ReactElement {
  const copy = useCallback(() => {
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) return;
    void clipboard.writeText(cid).catch(() => undefined);
  }, [cid]);
  return (
    <span className={styles.cid} data-cid={cid} title={cid}>
      <code className={styles.text}>{truncateCid(cid)}</code>
      <button type="button" className={styles.copy} onClick={copy} aria-label="Copy CID">
        <Icon name="content_copy" size="medium" />
      </button>
    </span>
  );
}
