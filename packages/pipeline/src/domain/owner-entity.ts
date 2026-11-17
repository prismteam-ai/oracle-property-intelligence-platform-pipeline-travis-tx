import { companyKey } from "./company-name.js";
import { streetAddressKey } from "./street-address.js";

const KEY_SEPARATOR = "|";
const ZIP_LENGTH = 5;

export interface OwnerIdentity {
  name: string | undefined;
  mailingLine: string | undefined;
  mailingZip: string | undefined;
}

export function ownerKey({ name, mailingLine, mailingZip }: OwnerIdentity): string | undefined {
  const nameKey = companyKey(name);
  if (nameKey === undefined) return undefined;
  const mailing = streetAddressKey(mailingLine) ?? normalized(mailingLine);
  const zip = (mailingZip ?? "").trim().slice(0, ZIP_LENGTH);
  return [nameKey, mailing, zip].join(KEY_SEPARATOR);
}

function normalized(text: string | undefined): string {
  return (text ?? "")
    .toUpperCase()
    .replaceAll(".", "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}
