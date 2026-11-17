const LEADING_ARTICLE = "the";
const CONJUNCTION = "and";
const TRAILING_NOISE = new Set([
  "llc",
  "inc",
  "incorporated",
  "co",
  "corp",
  "corporation",
  "company",
  "companies",
  "ltd",
  "lp",
  "llp",
  "pllc",
  "pc",
  "main",
]);
const HOME_STATE_SUFFIXES = new Set(["texas", "tx"]);
const STATE_SUFFIX_PREPOSITION = "of";
const PHONE_DIGITS = 10;
const SUBSCRIBER_DIGITS = 7;
const LINE_NUMBER_DIGITS = 4;
const PLACEHOLDER_LINE_NUMBERS = new Set(["0000"]);
const REPEATED_SUBSCRIBER_DIGITS = /^(\d)\1+$/;
const SEQUENTIAL_PHONE_KEYS = new Set(["1234567890", "0123456789"]);

export function companyKey(name: string | undefined): string | undefined {
  const tokens = (name ?? "")
    .toLowerCase()
    .replaceAll("&", ` ${CONJUNCTION} `)
    .replaceAll(".", "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token !== "" && token !== CONJUNCTION);

  if (tokens[0] === LEADING_ARTICLE) tokens.shift();
  let trimmed = true;
  while (trimmed && tokens.length > 0) {
    trimmed = false;
    const last = tokens.at(-1) ?? "";
    if (TRAILING_NOISE.has(last)) {
      tokens.pop();
      trimmed = true;
    } else if (HOME_STATE_SUFFIXES.has(last) && tokens.at(-2) === STATE_SUFFIX_PREPOSITION) {
      tokens.splice(-2);
      trimmed = true;
    }
  }

  return tokens.length > 0 ? tokens.join(" ") : undefined;
}

export function phoneKey(phone: string | undefined): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < PHONE_DIGITS) return undefined;
  const key = digits.slice(-PHONE_DIGITS);
  return isPlaceholderPhone(key) ? undefined : key;
}

function isPlaceholderPhone(key: string): boolean {
  const line = key.slice(-LINE_NUMBER_DIGITS);
  return (
    PLACEHOLDER_LINE_NUMBERS.has(line) ||
    REPEATED_SUBSCRIBER_DIGITS.test(key.slice(-SUBSCRIBER_DIGITS)) ||
    SEQUENTIAL_PHONE_KEYS.has(key)
  );
}
