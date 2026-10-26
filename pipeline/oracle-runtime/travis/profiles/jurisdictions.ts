// T031: the curated Travis County permit-jurisdiction profile (research R4, AD-26 style).
//
// One entry per incorporated place (Census CLASSFP C*) listed for Travis County in the 2020
// Census place-by-county file, plus Travis County unincorporated. Each entry records the
// class from spec clarification Q1 (FR-004b), the case that maps it to the kit validator
// status (research R3, status-map.ts), the portal, the official evidence page, and a
// complete records request: the lawful route if the portal has no history or the evidence
// page is blocked at the live run.
//
// Research basis: official city, county and Census pages read on 2026-10-19 with single,
// identified requests (no traviscad.org, no bbb.org, no challenge bypass). Anything that
// could not be confirmed on an official page carries a `notes` entry starting
// "unverified:" for the live run (T048) or the operator to resolve. The workflow probes
// every evidence_url again and stamps evidence_captured_at; it never trusts this file's
// research date as a capture time.
//
// Rules applied:
// - An account-based application portal (MyGovernmentOnline/MGO, GovWell, GovBuilt, Civic
//   Self Service, Development Hub, Permit Portal) is intake, not public history:
//   `records request` + `intake-or-no-history` (manual-only), portal_kind
//   `application-intake`, unless a public history search was confirmed.
// - Paper/office-only permit offices are `records request` + `custodian-only`.
// - Austin-issued records located in a city stay under Austin (FR-004c); the workflow adds
//   them to the city row as an informational count that never changes its class.
import type { CensusPlace } from "../discovery/probes/census.js";
import { RecordsRequestSchema, type RecordsRequest } from "../discovery/catalog.schema.js";
import {
  CENTRAL_PORTAL_KINDS,
  STATUS_MAP,
  type JurisdictionCase,
  type SpecClass,
} from "../discovery/status-map.js";

export interface JurisdictionProfileEntry {
  key: string;
  /** Short name; a city row's name must match Austin's `jurisdiction` values (FR-004c). */
  jurisdiction: string;
  /** Census PLACEFP; null only for the unincorporated county row. */
  census_placefp: string | null;
  spec_class: SpecClass;
  case: JurisdictionCase;
  portal_kind?: string;
  portal?: string;
  vendor?: string;
  evidence_url: string;
  earliest_record_date?: string;
  records_request?: RecordsRequest;
  issued_by?: string;
  notes?: string;
}

const MGO = "MyGovernmentOnline (MGO)";
const INTAKE = "application-intake";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function scope(system: string): string {
  return `${system}; all building permit records held, earliest available to present`;
}

export const TRAVIS_JURISDICTION_PROFILE: readonly JurisdictionProfileEntry[] = [
  {
    key: "travis_unincorporated",
    jurisdiction: "Travis County unincorporated",
    census_placefp: null,
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    portal: "https://mgoconnect.org/cp?JID=125",
    vendor: `${MGO} / MyPermitNow (2014 to present); TNR Public Search Portal (records before January 2014)`,
    evidence_url: "https://www.traviscountytx.gov/tnr/tnr-open-records",
    records_request: {
      recipient_office:
        "Travis County Transportation & Natural Resources (TNR), Records Management (Travis County has no central open-records office)",
      system_scope: scope(
        "TNR development permits in MyGovernmentOnline/MyPermitNow and pre-2014 TNR business records (construction plans, permits, septic)",
      ),
      route: "records-first",
      request_portal_url:
        "https://www.traviscountytx.gov/tnr/tnr-open-records/open-records-request",
    },
    notes:
      "TNR processes permits through an account-based MGO/MyPermitNow application portal; its Public Search Portal exposes some document images created before January 2014. unverified: earliest permit date, and whether the Public Search Portal's terms allow capture (if so, records before 2014 could be reclassified as supported from that date)",
  },
  {
    key: "austin",
    jurisdiction: "Austin",
    census_placefp: "05000",
    spec_class: "supported",
    case: "history-online",
    portal_kind: "open-data-api",
    portal: "https://data.austintexas.gov/resource/3syk-w9eu.json",
    vendor: "Socrata open data (City of Austin, Issued Construction Permits 3syk-w9eu)",
    evidence_url: "https://data.austintexas.gov/d/3syk-w9eu",
    earliest_record_date: "1921-09-20",
    records_request: {
      recipient_office: "City of Austin Public Information Office (Public Records Center)",
      system_scope: scope("issued construction permits behind open dataset 3syk-w9eu"),
      route: "api-first",
      request_portal_url: "https://austintexas.gov/pir",
    },
    notes:
      "earliest_record_date is min(issue_date) of 3syk-w9eu observed 2026-10-19; the Austin source row carries the full measurements and the Austin-issued records located in other jurisdictions",
  },
  {
    key: "bee_cave",
    jurisdiction: "Bee Cave",
    census_placefp: "07156",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    vendor: MGO,
    evidence_url:
      "https://beecavetexas.gov/government/departments/planning_development/building/index.php",
    records_request: {
      recipient_office: "City of Bee Cave City Secretary (public information requests)",
      system_scope: scope("Planning & Development building and MEP permits in MyGovernmentOnline"),
      route: "records-first",
      request_portal_url: "https://cityofbeecavetx.nextrequest.com/",
    },
    notes:
      "permits are filed and tracked by applicants in MyGovernmentOnline (account-based). evidence_url updated 2026-10-20: the earlier MGO application-center page answered HTTP 404 on 2026-10-19; the city's Building Permits & Inspections page says all applications go through MyGovernmentOnline (account-based). unverified: date MGO was adopted and whether any public history search exists",
  },
  {
    key: "briarcliff",
    jurisdiction: "Briarcliff",
    census_placefp: "10197",
    spec_class: "records request",
    case: "custodian-only",
    evidence_url: "https://www.briarclifftx.com/",
    records_request: {
      recipient_office: "Village of Briarcliff, Village Secretary (public information officer)",
      system_scope: scope("Village of Briarcliff building permit files"),
      route: "records-first",
      request_portal_url: "https://www.briarclifftx.com/",
    },
    notes:
      "the village website's menu lists Building Permits; no online permit system found. unverified: permit custodian, request channel (the village homepage is used until a records-request page or email is confirmed), earliest record date",
  },
  {
    key: "cedar_park",
    jurisdiction: "Cedar Park",
    census_placefp: "13552",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    vendor: `${MGO} Connect`,
    evidence_url: "https://www.cedarparktexas.gov/676/Search-for-a-Permit-PDF",
    records_request: {
      recipient_office: "City of Cedar Park City Secretary (public information requests)",
      system_scope: scope("Building Permits & Inspections records in MGO Connect"),
      route: "records-first",
      request_portal_url: "https://www.cedarparktexas.gov/283/Information-Disclosure",
    },
    notes:
      "Travis County part only. The city's guide says permit search runs inside MGO Connect after login and phone verification. unverified: history depth of that search and whether its terms allow capture; the request page URL (cedarparktexas.gov answered HTTP 403 to the project user agent on 2026-10-19, not retried)",
  },
  {
    key: "creedmoor",
    jurisdiction: "Creedmoor",
    census_placefp: "17612",
    spec_class: "records request",
    case: "custodian-only",
    evidence_url:
      "https://cityofcreedmoortx.gov/wp-content/uploads/01-Residential-permit-Packet-5.pdf",
    records_request: {
      recipient_office: "City of Creedmoor City Secretary (public information officer)",
      system_scope: scope("City of Creedmoor building permit files (paper permit packets)"),
      route: "records-first",
      request_portal_url: "https://www.cityofcreedmoortx.gov/",
    },
    notes:
      "permits are applied for with a paper packet; no online permit system found. unverified: request channel (homepage used; it answered HTTP 403 to the project user agent on 2026-10-19, not retried), earliest record date",
  },
  {
    key: "elgin",
    jurisdiction: "Elgin",
    census_placefp: "23044",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    portal: "https://www.mgoconnect.org/auth/login",
    vendor: MGO,
    evidence_url: "https://www.elgintexas.gov/908/Building-Division",
    records_request: {
      recipient_office: "City of Elgin Building Division (permit records custodian)",
      system_scope: scope("Building Division permits in MyGovernmentOnline"),
      route: "records-first",
      request_email: "permits@elgintexas.gov",
    },
    notes:
      "Travis County part only (most of Elgin is in Bastrop County). unverified: the Travis part has land area (the Census file has no land column); the city's public information officer channel (the Building Division permits email is used until confirmed); earliest record date",
  },
  {
    key: "jonestown",
    jurisdiction: "Jonestown",
    census_placefp: "38020",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    vendor: MGO,
    evidence_url: "https://www.jonestowntx.gov/234/Permitting-Inspections",
    records_request: {
      recipient_office: "City of Jonestown City Secretary (public information officer)",
      system_scope: scope("Development Services building permits in MyGovernmentOnline"),
      route: "records-first",
      request_portal_url: "https://www.jonestowntx.gov/",
    },
    notes:
      "the city uses MyGovernmentOnline for all building permits (online application). unverified: request channel (homepage used until a records-request page is confirmed), earliest record date",
  },
  {
    key: "lago_vista",
    jurisdiction: "Lago Vista",
    census_placefp: "40264",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    vendor: `${MGO} Project Permitting Portal`,
    evidence_url: "https://lagovistatexas.gov/101/Services",
    records_request: {
      recipient_office: "City of Lago Vista City Secretary (open records)",
      system_scope: scope("Development Services permits in the MGO Project Permitting Portal"),
      route: "records-first",
      request_portal_url: "https://lagovistatexas.gov/247/Open-Records-Request",
    },
    notes:
      "Development Services also publishes monthly permit reports (PDF), which are summaries, not permit history. unverified: earliest record date",
  },
  {
    key: "lakeway",
    jurisdiction: "Lakeway",
    census_placefp: "40984",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    vendor: "Civic Self Service",
    evidence_url: "https://www.lakeway-tx.gov/1165",
    records_request: {
      recipient_office: "City of Lakeway City Secretary's Office (public information requests)",
      system_scope: scope(
        "Building and Development Services permits (Civic Self Service and the system before it)",
      ),
      route: "records-first",
      request_portal_url: "https://cityoflakewaytx.nextrequest.com/",
    },
    notes:
      "permit applications and inspection requests moved to Civic Self Service (registration required). unverified: portal URL and vendor, whether it offers a public history search, earliest record date",
  },
  {
    key: "leander",
    jurisdiction: "Leander",
    census_placefp: "42016",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    vendor: "Development Hub",
    evidence_url: "https://www.leandertx.gov/permits",
    records_request: {
      recipient_office: "City of Leander City Secretary's Office (open records)",
      system_scope: scope("building permits processed in the Development Hub"),
      route: "records-first",
      request_portal_url: "https://www.leandertx.gov/orr",
    },
    notes:
      "Travis County part only. All building permit applications are processed in the Development Hub, which also shows the status of an existing permit. unverified: whether the Hub has a public history search, earliest record date (leandertx.gov answered a Cloudflare HTTP 403 to the project user agent on 2026-10-19, not retried). The current permits page is https://www.leandertx.gov/760/Permits (found by web search on 2026-10-20, not requested)",
  },
  {
    key: "manor",
    jurisdiction: "Manor",
    census_placefp: "46440",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    portal: "https://app.govwell.com/manor",
    vendor: "GovWell",
    evidence_url: "https://www.manortx.gov/187/Building-Permits",
    records_request: {
      recipient_office: "City of Manor City Secretary (public records)",
      system_scope: scope("Development Services building permits in GovWell and earlier systems"),
      route: "records-first",
      request_portal_url: "https://manortx.justfoia.com/publicportal/home/newrequest",
    },
    notes: "unverified: earliest record date and the system used before GovWell",
  },
  {
    key: "mustang_ridge",
    jurisdiction: "Mustang Ridge",
    census_placefp: "50200",
    spec_class: "records request",
    case: "custodian-only",
    evidence_url: "https://www.mustangridgetx.gov/planning/page/forms",
    records_request: {
      recipient_office: "City of Mustang Ridge Planning & Permitting office / City Secretary",
      system_scope: scope("City of Mustang Ridge building permit files"),
      route: "records-first",
      request_portal_url: "https://www.mustangridgetx.gov/planning",
    },
    notes:
      "permits use downloadable checklists submitted to the Planning & Permitting office; no online permit system found. unverified: request channel (Planning & Permitting page used), earliest record date",
  },
  {
    key: "pflugerville",
    jurisdiction: "Pflugerville",
    census_placefp: "57176",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    portal: "https://ams.pflugervilletx.gov/PublicAccess/template/login.aspx",
    vendor: "PublicAccess permits and licensing portal",
    evidence_url: "https://pflugervilletx.gov/online-services",
    records_request: {
      recipient_office: "City of Pflugerville City Secretary (open records)",
      system_scope: scope(
        "Building Inspection and Permits records in the permits and licensing portal",
      ),
      route: "records-first",
      request_portal_url: "https://pflugervilletx.gov/open-records-request",
    },
    notes:
      "the portal opens on a login page. unverified: vendor, whether it offers a guest permit search with history (if so, reclassify as supported from its earliest date), earliest record date",
  },
  {
    key: "point_venture",
    jurisdiction: "Point Venture",
    census_placefp: "58586",
    spec_class: "records request",
    case: "custodian-only",
    evidence_url: "https://vopv.municipalimpact.com/building-and-permits",
    records_request: {
      recipient_office: "Village of Point Venture, Village Office (public information requests)",
      system_scope: scope("Village building permit applications and project packets"),
      route: "records-first",
      request_portal_url: "https://vopv.municipalimpact.com/public-information-request",
    },
    notes:
      "permit packets are accepted in person at the Village Office. unverified: earliest record date",
  },
  {
    key: "rollingwood",
    jurisdiction: "Rollingwood",
    census_placefp: "63008",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    vendor: MGO,
    evidence_url: "https://rollingwoodtx.gov/node/9124",
    records_request: {
      recipient_office: "City of Rollingwood Development Services (permit records custodian)",
      system_scope: scope("building permits in MyGovernmentOnline"),
      route: "records-first",
      request_email: "developmentservices@rollingwoodtx.gov",
    },
    notes:
      "all permit applications and issuance run through MyGovernmentOnline. evidence_url updated 2026-10-20: the earlier planning-development page answered HTTP 404 on 2026-10-19; the Permitting Process for Residential and Commercial Building page (node 9124) says all applications go through MyGovernmentOnline. The city also posts dated active-permit PDF lists (for example https://www.rollingwoodtx.gov/sites/default/files/fileattachments/building/page/133/active_permits_4.29.2024.pdf); they are snapshots, not a history. unverified: those lists as a source for A-06, the city's public information officer channel (the Development Services email is used until confirmed), earliest record date",
  },
  {
    key: "round_rock",
    jurisdiction: "Round Rock",
    census_placefp: "63500",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    portal: "https://permits.roundrocktexas.gov/",
    vendor: "Round Rock Permit Portal (replaced TRAKiT/eTRAKiT)",
    evidence_url:
      "https://www.roundrocktexas.gov/city-departments/administration/permit-portal-help/",
    records_request: {
      recipient_office: "City of Round Rock City Clerk's Office (Open Records)",
      system_scope: scope("Permit Portal records and records migrated from TRAKiT/eTRAKiT"),
      route: "records-first",
      request_portal_url: "https://roundrocktx.mycusthelp.com/webapp/_rs/supporthome.aspx",
    },
    notes:
      "Travis County part only. The portal requires an account; the old eTRAKiT site now only announces the new system. unverified: whether the Permit Portal's permit search works without an account and how far back it goes (if public, reclassify as supported)",
  },
  {
    key: "san_leanna",
    jurisdiction: "San Leanna",
    census_placefp: "65552",
    spec_class: "records request",
    case: "custodian-only",
    evidence_url: "https://sanleannatx.com/wp-content/uploads/2023/07/Packet-for-July-20-2023.pdf",
    records_request: {
      recipient_office: "Village of San Leanna, Village Administrator",
      system_scope: scope("Village building, driveway and certificate-of-occupancy permit files"),
      route: "records-first",
      request_portal_url: "https://sanleannatx.com/",
    },
    notes:
      "board packets carry monthly zoning reports listing building permits; no online permit system found (the board packets are the only public trace). The HTTP 406 answers of 2026-10-19 and 2026-10-20 say the request was blocked by Mod Security: the site's web application firewall blocks the project user agent, so the site is not requested again (corrected in review on 2026-10-20: it was first read as a content-negotiation refusal). unverified: request channel (homepage used), earliest record date",
  },
  {
    key: "sunset_valley",
    jurisdiction: "Sunset Valley",
    census_placefp: "71324",
    spec_class: "records request",
    case: "intake-or-no-history",
    portal_kind: INTAKE,
    vendor: "GovBuilt (earlier MyGovernmentOnline / MyPermitNow)",
    evidence_url:
      "https://www.sunsetvalley.gov/departments/planning-development/building-and-sign-permits",
    records_request: {
      recipient_office: "City of Sunset Valley Planning & Development (permit records custodian)",
      system_scope: scope(
        "building and sign permits in GovBuilt and the earlier MyGovernmentOnline system",
      ),
      route: "records-first",
      request_email: "permits@sunsetvalley.gov",
    },
    notes:
      "applications are submitted through the GovBuilt portal. unverified: GovBuilt portal URL, the city's public information officer channel (the permits email is used until confirmed), earliest record date (sunsetvalley.gov answered HTTP 403 to the project user agent on 2026-10-19, not retried)",
  },
  {
    key: "the_hills",
    jurisdiction: "The Hills",
    census_placefp: "72578",
    spec_class: "records request",
    case: "custodian-only",
    evidence_url: "https://www.villageofthehills.org/",
    records_request: {
      recipient_office: "Village of The Hills, Village Secretary (public information officer)",
      system_scope: scope("Village of The Hills building permit files"),
      route: "records-first",
      request_portal_url: "https://www.villageofthehills.org/",
    },
    notes:
      "unverified: whether the village issues building permits itself or another body does (if another body, reclassify as no public history / delegated with issued_by), the permit custodian, request channel (homepage used), earliest record date",
  },
  {
    key: "volente",
    jurisdiction: "Volente",
    census_placefp: "75752",
    spec_class: "records request",
    case: "custodian-only",
    evidence_url: "https://www.villageofvolente-tx.gov/planning-permitting",
    records_request: {
      recipient_office: "Village of Volente, Village Office (public information requests)",
      system_scope: scope("Village site development and building permit applications"),
      route: "records-first",
      request_portal_url:
        "https://www.villageofvolente-tx.gov/index.asp?SEC=2B4DB589-502A-49BA-927D-1DF5BE8AE1E3",
    },
    notes:
      "permit applications are paper forms submitted to the village office. unverified: earliest record date",
  },
  {
    key: "webberville",
    jurisdiction: "Webberville",
    census_placefp: "76924",
    spec_class: "records request",
    case: "custodian-only",
    evidence_url:
      "https://www2.census.gov/geo/docs/reference/codes2020/place_by_cou/st48_tx_place_by_county2020.txt",
    records_request: {
      recipient_office: "Village of Webberville, Village Hall (public information officer)",
      system_scope: scope("Village of Webberville building permit files"),
      route: "records-first",
      request_portal_url: "https://www.webberville.org/village_commission/",
      channel_verified: false,
    },
    notes:
      "the village site did not answer on 2026-10-19 (webbervilletx.gov did not resolve and webberville.org did not answer), so the permit system is unknown and the row rests only on the Census place listing, which names the village but is not a permit page. unverified: the permit system, the custodian, whether the village issues permits at all (delegated?) and the request channel (the webberville.org page did not answer)",
  },
  {
    key: "west_lake_hills",
    jurisdiction: "West Lake Hills",
    census_placefp: "77632",
    spec_class: "records request",
    case: "custodian-only",
    evidence_url: "https://www.westlakehills.org/",
    records_request: {
      recipient_office: "City of West Lake Hills (public information requests)",
      system_scope: scope("City of West Lake Hills building permit records"),
      route: "records-first",
      request_portal_url: "https://cityofwestlakehillstx.nextrequest.com/",
    },
    notes:
      "the city homepage links its NextRequest records portal. unverified: the city's permit system and vendor, whether any public permit search exists, earliest record date",
  },
];

/** The extras an entry needs for its class and case (research R3); empty when complete. */
export function profileProblems(entry: JurisdictionProfileEntry): string[] {
  const problems: string[] = [];
  const at = entry.key || "(no key)";
  if (!entry.key.trim()) problems.push("missing key");
  if (!entry.jurisdiction.trim()) problems.push(`${at}: missing jurisdiction name`);
  if (!entry.evidence_url.trim()) problems.push(`${at}: missing evidence_url`);
  const row = STATUS_MAP.find((r) => r.spec_class === entry.spec_class && r.case === entry.case);
  if (!row) {
    problems.push(
      `${at}: spec_class "${entry.spec_class}" + case "${entry.case}" is not an R3 row`,
    );
    return problems;
  }
  const kind = (entry.portal_kind ?? "").trim().toLowerCase();
  if (CENTRAL_PORTAL_KINDS.has(kind) && row.historical_records) {
    problems.push(`${at}: portal_kind "${kind}" is intake, never historical records`);
  }
  if (row.status === "supported") {
    if (!(entry.earliest_record_date && DATE_ONLY.test(entry.earliest_record_date))) {
      problems.push(`${at}: supported needs earliest_record_date (YYYY-MM-DD)`);
    }
  }
  if (["custodian-only", "manual-only", "blocked"].includes(row.status)) {
    if (!RecordsRequestSchema.safeParse(entry.records_request).success) {
      problems.push(`${at}: ${row.status} needs a complete records_request`);
    }
  }
  if (row.status === "delegated" && !entry.issued_by?.trim()) {
    problems.push(`${at}: delegated needs issued_by`);
  }
  return problems;
}

export interface ProfileComparison {
  /** Census places with no profile entry. */
  missing: CensusPlace[];
  /** Profile entries whose place code is not in the Census list. */
  extra: JurisdictionProfileEntry[];
  /** Number of unincorporated entries (must be exactly 1). */
  unincorporated: number;
  ok: boolean;
}

/** The profile set must equal the Census set plus one unincorporated row. */
export function compareProfileToCensus(
  profile: readonly JurisdictionProfileEntry[],
  places: readonly CensusPlace[],
): ProfileComparison {
  const codes = new Set(places.map((p) => p.placefp));
  const profiled = new Set(
    profile.map((e) => e.census_placefp).filter((c): c is string => c !== null),
  );
  const missing = places.filter((p) => !profiled.has(p.placefp));
  const extra = profile.filter((e) => e.census_placefp !== null && !codes.has(e.census_placefp));
  const unincorporated = profile.filter((e) => e.census_placefp === null).length;
  return {
    missing,
    extra,
    unincorporated,
    ok: missing.length === 0 && extra.length === 0 && unincorporated === 1,
  };
}
