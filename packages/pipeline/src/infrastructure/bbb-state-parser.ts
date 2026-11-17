import type { ProfileParser } from "../application/bbb-ports.js";
import {
  type BbbProfile,
  bbbRatingOf,
  type ProfileCapture,
  snapshotTimeOf,
} from "../domain/bbb-profile.js";
import { isoDateOf } from "../domain/iso-date.js";

const STATE_MARKER = "window.__PRELOADED_STATE__";
const SCRIPT_END = "</script>";
const TRAILING_SEMICOLON = /;\s*$/;
const ZIP_LENGTH = 5;
const WAYBACK_VIEW_URL = "https://web.archive.org/web";

interface PostalAddress {
  city?: string;
  stateCode?: string;
  zipCode?: string;
}

interface BusinessFields {
  namePrimary?: string;
  altBusinessNames?: unknown[];
  phoneNumbers?: { allPhoneNumbers?: { number?: string }[] };
  location?: { postalAddress?: PostalAddress };
  rating?: { bbbRating?: string };
  isAccredited?: boolean;
  dateAccredited?: string;
  isOutOfBusiness?: boolean;
}

interface BusinessProfileState extends BusinessFields {
  businessData?: BusinessFields;
  names?: { primary?: string; altBusinessNames?: unknown[] };
  contactInformation?: { phoneNumber?: string };
  accreditationInformation?: { isAccredited?: boolean };
  dates?: { accredited?: string };
  orgDetails?: { isOutOfBusiness?: boolean };
}

export class BbbStateParser implements ProfileParser {
  parse(html: string, capture: ProfileCapture): BbbProfile | undefined {
    const profile = embeddedState(html)?.businessProfile;
    if (!profile) return undefined;
    const data: BusinessFields = profile.businessData ?? profile;

    const name = profile.names?.primary ?? data.namePrimary;
    if (!name) return undefined;
    const address = (profile.location ?? data.location)?.postalAddress;
    const accreditedOn = profile.dates?.accredited ?? data.dateAccredited;

    return {
      profileId: capture.profileId,
      name,
      alternateNames: strings(profile.names?.altBusinessNames ?? data.altBusinessNames),
      phones: [
        ...new Set(
          [
            profile.contactInformation?.phoneNumber,
            ...(data.phoneNumbers?.allPhoneNumbers ?? []).map((phone) => phone.number),
          ].filter((phone): phone is string => Boolean(phone)),
        ),
      ],
      city: address?.city ?? undefined,
      state: address?.stateCode ?? undefined,
      zip: address?.zipCode?.slice(0, ZIP_LENGTH),
      rating: bbbRatingOf((profile.rating ?? data.rating)?.bbbRating),
      accredited: profile.accreditationInformation?.isAccredited ?? data.isAccredited ?? false,
      accreditedSince: accreditedOn ? isoDateOf(accreditedOn) : undefined,
      outOfBusiness: profile.orgDetails?.isOutOfBusiness ?? data.isOutOfBusiness ?? false,
      profileUrl: capture.originalUrl,
      snapshotUrl: `${WAYBACK_VIEW_URL}/${capture.timestamp}/${capture.originalUrl}`,
      snapshotAt: snapshotTimeOf(capture.timestamp),
    };
  }
}

function embeddedState(html: string): { businessProfile?: BusinessProfileState } | undefined {
  const marker = html.indexOf(STATE_MARKER);
  if (marker < 0) return undefined;
  const start = html.indexOf("=", marker) + 1;
  const end = html.indexOf(SCRIPT_END, start);
  if (start <= 0 || end < 0) return undefined;
  try {
    return JSON.parse(html.slice(start, end).trim().replace(TRAILING_SEMICOLON, ""));
  } catch {
    return undefined;
  }
}

function strings(values: unknown[] | undefined): string[] {
  return (values ?? []).filter((value): value is string => typeof value === "string");
}
