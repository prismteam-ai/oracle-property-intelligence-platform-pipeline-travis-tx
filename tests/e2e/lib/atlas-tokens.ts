// The run-time Atlas token check of TC-NF-03 (plan § "Atlas element map" → Token check; Atlas
// § 13 rule 4), used by responsive.spec.ts through `page.evaluate`. Each function below is
// serialised into the page, so it is self-contained: no imports, no closures over module state.
//
// Method: once per width, the allowed value set is built from the `:root` custom properties of
// tokens.css (light theme) plus `0`, `auto`, `inherit`, `transparent` and `currentColor`. Each
// candidate is resolved through a hidden probe element per property, so it compares in the
// browser's computed form (`rgb(…)`, `px`). Then every rendered element's computed colour,
// font family, font size, margin, padding, gap and border radius is read with
// `getComputedStyle`, and every value outside the set is listed with its selector and property.
// Two documented allowances, both Atlas-defined rather than ad-hoc values:
//   - `normal` for `row-gap` / `column-gap` (the CSS initial value: no gap declared);
//   - equal non-token left and right margins on one element (`margin-inline: auto` centring,
//     whose computed form is the used pixel value).
// Border colours are read only for sides with a non-zero width. Glyphs of the Material Symbols
// icon font (`.material-symbols-rounded`, declared in tokens.css) are exempt from the font-family
// and font-size checks; their colour, spacing and radius are still checked.

export interface TokenViolation {
  selector: string;
  property: string;
  value: string;
}

export interface TokenAudit {
  tokens: number;
  checkedElements: number;
  violations: TokenViolation[];
}

export const AUDITED_PROPERTIES = [
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "font-family",
  "font-size",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "row-gap",
  "column-gap",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
] as const;

/** Runs in the page: the audit of every rendered element under `<body>`. */
export function atlasTokenAudit(properties: readonly string[]): TokenAudit {
  const root = document.documentElement;
  const names = new Set<string>();
  const rootStyle = getComputedStyle(root);
  for (let i = 0; i < rootStyle.length; i += 1) {
    const name = rootStyle.item(i);
    if (name.startsWith("--")) names.add(name);
  }
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet (Google Fonts) declares no tokens
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && /(^|,)\s*:root\s*(,|$)/.test(rule.selectorText)) {
        for (let i = 0; i < rule.style.length; i += 1) {
          const name = rule.style.item(i);
          if (name.startsWith("--")) names.add(name);
        }
      }
    }
  }

  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.borderStyle = "solid";
  document.body.appendChild(probe);
  const candidates = [
    ...Array.from(names).map((name) => `var(${name})`),
    "0",
    "auto",
    "inherit",
    "transparent",
    "currentColor",
  ];
  const allowed = new Map<string, Set<string>>();
  for (const property of properties) {
    const values = new Set<string>();
    for (const candidate of candidates) {
      probe.style.setProperty(property, candidate);
      values.add(getComputedStyle(probe).getPropertyValue(property).trim());
      probe.style.removeProperty(property);
    }
    if (property === "row-gap" || property === "column-gap") values.add("normal");
    allowed.set(property, values);
  }
  probe.remove();

  const describe = (el: Element): string => {
    const id = el.id ? `#${el.id}` : "";
    const classes = Array.from(el.classList)
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join("");
    const label = el.getAttribute("aria-label");
    return `${el.tagName.toLowerCase()}${id}${classes}${label ? `[aria-label="${label}"]` : ""}`;
  };

  const skipTags = new Set([
    "SCRIPT",
    "STYLE",
    "LINK",
    "META",
    "TITLE",
    "BR",
    "NOSCRIPT",
    "TEMPLATE",
  ]);
  const violations: TokenViolation[] = [];
  let checkedElements = 0;
  for (const el of Array.from(document.body.querySelectorAll("*")).concat(document.body)) {
    if (skipTags.has(el.tagName) || el instanceof SVGElement) continue;
    if (el.getClientRects().length === 0) continue; // not rendered
    const style = getComputedStyle(el);
    if (style.visibility === "hidden") continue;
    checkedElements += 1;
    const icon = el.closest(".material-symbols-rounded") !== null;
    for (const property of properties) {
      if (icon && (property === "font-family" || property === "font-size")) continue;
      const side = /^border-(top|right|bottom|left)-color$/.exec(property)?.[1];
      if (side && parseFloat(style.getPropertyValue(`border-${side}-width`)) === 0) continue;
      const value = style.getPropertyValue(property).trim();
      if (allowed.get(property)?.has(value)) continue;
      if (
        (property === "margin-left" || property === "margin-right") &&
        style.getPropertyValue("margin-left") === style.getPropertyValue("margin-right")
      ) {
        continue; // margin-inline: auto centring
      }
      violations.push({ selector: describe(el), property, value });
    }
  }
  return { tokens: names.size, checkedElements, violations };
}

/** Runs in the page: interactive elements smaller than `min` px in either dimension. */
export function smallTapTargets(
  min: number,
): { selector: string; width: number; height: number }[] {
  const out: { selector: string; width: number; height: number }[] = [];
  const targets = document.querySelectorAll(
    'a[href], button, [role="button"], [role="link"], [role="tab"], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  for (const el of Array.from(targets)) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue; // not rendered
    // WCAG 2.5.8 inline exception: a link inside a sentence is sized by its line of text.
    if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue;
    // A visually hidden native input (1 x 1, clipped) inside its <label> chip: the label is the
    // tap target, so the label's box is measured instead (A-16 Explore chips, WCAG 2.5.8).
    const chip =
      el.tagName === "INPUT" && rect.width <= 1 && rect.height <= 1 ? el.closest("label") : null;
    const box = chip ? chip.getBoundingClientRect() : rect;
    if (box.width < min || box.height < min) {
      const label = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 40);
      out.push({
        selector: `${el.tagName.toLowerCase()}${label ? ` "${label}"` : ""}`,
        width: Math.round(box.width),
        height: Math.round(box.height),
      });
    }
  }
  return out;
}
