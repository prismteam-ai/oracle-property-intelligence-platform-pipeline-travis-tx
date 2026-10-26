// Legal · Data sources content (A-13 T038, AC-11, FR-011, D-8): facts with links, no legal advice.
// Facts come from docs/sources.md and docs/decisions/DEC-A-01-source-access.md (A-01). Each
// source links to its official terms, disclaimer or licence page; `checkedStatus` and `checkedOn`
// record the HTTP status of that page when it was requested (curl -I, browser User-Agent) from
// the build machine. Never add a link that was not requested; a page that answered with a
// challenge keeps that status here instead of a 200 (BBB: 403, not bypassed).

export interface LegalSource {
  readonly id: string;
  readonly name: string;
  /** What CountyLens reads from the source and how, in plain words (no counts). */
  readonly fact: string;
  readonly termsLabel: string;
  /** An https page of the publisher. */
  readonly termsUrl: string;
  /** HTTP status the page answered with on `checkedOn`. */
  readonly checkedStatus: number;
  /** UTC date of the check, YYYY-MM-DD. */
  readonly checkedOn: string;
}

export const LEGAL_SOURCES: readonly LegalSource[] = Object.freeze([
  {
    id: "tcad",
    name: "Travis Central Appraisal District (TCAD)",
    fact: "The parcel roll comes from TCAD's 2026 certified export, a file TCAD lists for download on its public information page. TCAD's site states that its information is in the public domain, distributed without warranty, and that the site is meant for taxpayers rather than bulk transfer of data.",
    termsLabel: "TCAD property search disclaimer",
    termsUrl: "https://traviscad.org/propertysearch",
    checkedStatus: 200,
    checkedOn: "2026-10-22",
  },
  {
    id: "travis-county-gis",
    name: "Travis County GIS",
    fact: "Parcel coordinates and the count of parcel features come from the county's public ArcGIS service, read in pages. The county GIS host did not answer from the build machine, so the link is the county website's disclaimer page.",
    termsLabel: "Travis County website disclaimers",
    termsUrl: "https://www.traviscountytx.gov/disclaimer",
    checkedStatus: 200,
    checkedOn: "2026-10-22",
  },
  {
    id: "city-of-austin",
    name: "City of Austin open data (dataset 3syk-w9eu)",
    fact: "Issued construction permits come from the City of Austin open data portal, dataset 3syk-w9eu, read through its public API without an app token. The portal lists its own terms of use.",
    termsLabel: "City of Austin Open Data Terms of Use",
    termsUrl: "https://data.austintexas.gov/stories/s/ranj-cccq",
    checkedStatus: 200,
    checkedOn: "2026-10-22",
  },
  {
    id: "austin-address-points",
    name: "City of Austin address points (ArcGIS layer LOCATION_address_points)",
    fact: "A property with no county GIS point takes a City of Austin 9-1-1 address point, only on a unique exact address match. The points are read from the City's public ArcGIS layer; its catalogue entry gives the City of Austin GIS disclaimer as the licence: for geographic reference only, no warranty of accuracy or completeness.",
    termsLabel: "City of Austin GIS disclaimer (the layer's ArcGIS catalogue entry)",
    termsUrl: "https://www.arcgis.com/home/item.html?id=dfa40c66bb4c4f228f717a79bd735f0f",
    checkedStatus: 200,
    checkedOn: "2026-10-26",
  },
  {
    id: "tx-comptroller",
    name: "Texas Comptroller open data (dataset 9cir-efmm)",
    fact: "Contractor identity is looked up in the Comptroller's franchise-tax holder list, dataset 9cir-efmm on data.texas.gov, read through its public API. The portal's footer points to the platform terms linked here; the dataset page shows its own licence field.",
    termsLabel: "Socrata terms of service (linked from the data.texas.gov footer)",
    termsUrl: "https://www.socrata.com/terms-of-service",
    checkedStatus: 200,
    checkedOn: "2026-10-22",
  },
  {
    id: "bbb",
    name: "Better Business Bureau (BBB)",
    fact: "BBB's roofing-contractor listing answered with an HTTP 403 challenge. CountyLens stops on a 403, never solves a challenge, and does not harvest around it. The terms page also answered 403 from the build machine, so its status is recorded as 403 rather than 200; open it in a browser to read it.",
    termsLabel: "BBB terms of use",
    termsUrl: "https://www.bbb.org/terms-of-use",
    checkedStatus: 403,
    checkedOn: "2026-10-22",
  },
  {
    id: "overture",
    name: "Overture Maps",
    fact: "Overture Maps places are an optional source distributed as bulk files. Any use follows the attribution and licence terms on the linked page.",
    termsLabel: "Overture Maps attribution and licence",
    termsUrl: "https://docs.overturemaps.org/attribution/",
    checkedStatus: 200,
    checkedOn: "2026-10-22",
  },
  {
    id: "census-gazetteer",
    name: "US Census Gazetteer",
    fact: "Place names and their coordinates for the place search come from the US Census Bureau's Gazetteer files, published by the Bureau as reference files.",
    termsLabel: "US Census Bureau Gazetteer files",
    termsUrl:
      "https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html",
    checkedStatus: 200,
    checkedOn: "2026-10-22",
  },
]);

export const ACCESS_RULES_HEADING = "Access rules";

export const ACCESS_RULES: readonly string[] = Object.freeze([
  "Public sources only: CountyLens reads pages and files that anyone can open without signing in.",
  "Stop on 403: when a source answers with an HTTP 403, collection from it stops.",
  "No CAPTCHA bypass: a challenge or CAPTCHA is never solved or worked around.",
  "The Query DB is never exposed: the internal matching store is not published or served; only elephant-cli output is published.",
]);

export const LEGAL_NOT_ADVICE =
  "This page states facts and links to each publisher's own terms. It is not legal advice.";
