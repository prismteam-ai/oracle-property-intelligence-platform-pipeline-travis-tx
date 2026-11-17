import { SourceId } from "./source-id.js";

export interface SourceDescription {
  id: SourceId;
  name: string;
  publisher: string;
  url: string;
  provides: string[];
  refresh: string;
  limitations: string[];
}

export const SOURCE_CATALOG: readonly SourceDescription[] = [
  {
    id: SourceId.AustinPermits,
    name: "Issued Construction Permits",
    publisher: "City of Austin Development Services, Austin Open Data (Socrata)",
    url: "https://data.austintexas.gov/d/3syk-w9eu",
    provides: [
      "permits with type, work class and description",
      "permit status with applied, issued, expiry and completion dates",
      "contractor company name and phone",
      "TCAD parcel id and permit coordinates",
    ],
    refresh:
      "Daily. Re-reads rows whose status, issue or applied date falls on or after the watermark minus a 7-day lookback, keyset-paged by permit number in pages of 50,000.",
    limitations: [
      "Covers permits issued by the City of Austin only; other cities in Travis County and unincorporated areas are not in this dataset.",
      "The city republishes the whole dataset daily (about 14:40–15:05 UTC), so changes are found through business dates rather than a modification timestamp.",
      "Some 50,000-row pages exceed 70 MB of JSON, which needs a 128 MiB parser buffer.",
      "Contractors are free-text company names without license numbers; identities are reconciled by normalized name and phone.",
      "Some permits have no parcel id or a parcel id that is not in the appraisal roll.",
    ],
  },
  {
    id: SourceId.TcadAppraisalExport,
    name: "Appraisal roll export",
    publisher: "Travis Central Appraisal District (TCAD)",
    url: "https://traviscad.org/publicinformation",
    provides: [
      "every appraised property with situs address",
      "owner names and mailing addresses",
      "deed date (ownership duration)",
      "improvements with year built and roof covering",
    ],
    refresh:
      "Checks the export catalog on every run and downloads only a new year or supplement (about 500 MB zip of fixed-width files).",
    limitations: [
      "Published as periodic supplements, not daily.",
      "TCAD web pages refuse some automated clients and regions, while the bulk export files download normally.",
      "Roof age has no direct field: it is taken from completed reroof permits, new-construction permits or the improvement's year built, with a confidence level for each.",
      "Roof covering is coded on the main improvement and missing for part of the roll.",
    ],
  },
  {
    id: SourceId.TcadParcels,
    name: "TCAD Parcels feature layer",
    publisher:
      "Travis Central Appraisal District parcels, hosted by the City of Austin on ArcGIS Online",
    url: "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/EXTERNAL_tcad_parcel/FeatureServer/0",
    provides: ["parcel centroid coordinates by TCAD property id and geo id"],
    refresh:
      "Downloads a new snapshot only when the layer's last edit date changes, 2,000 features per page.",
    limitations: [
      "Condominium units and mobile homes share one parcel, so they are located through the shared parcel, county address points or permit coordinates.",
      "A centroid marks the parcel, not the roof itself.",
    ],
  },
  {
    id: SourceId.TravisAddressPoints,
    name: "Address Points feature layer",
    publisher: "City of Austin Communications and Technology Management, 9-1-1 Addressing",
    url: "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/LOCATION_address_points/FeatureServer/0",
    provides: ["address point coordinates used for properties without their own parcel"],
    refresh:
      "Downloads a new snapshot only when the layer's last edit date changes, 2,000 features per page.",
    limitations: [
      "Addresses are matched by normalized street address; an address is used only when its points agree within about 400 m.",
    ],
  },
  {
    id: SourceId.BbbArchive,
    name: "Archived BBB business profiles",
    publisher: "Internet Archive Wayback Machine captures of bbb.org",
    url: "https://web.archive.org/web/*/bbb.org/us/tx/*",
    provides: [
      "BBB letter grade and accreditation of Austin-area contractors",
      "business name, alternate names and phone used for matching",
      "snapshot date and archive URL of every grade",
    ],
    refresh:
      "Lists captures from the Wayback CDX index and fetches only captures not archived yet, within a time budget per run, profiles of known contractors first.",
    limitations: [
      "bbb.org refuses automated clients and has no public API, so grades come only from archived snapshots and are shown as of the snapshot date.",
      "Only profiles the Internet Archive captured are available.",
      "The CDX index and snapshots are slow, so each run fetches a bounded number of profiles at one request per second.",
      "Contractor matching by name and phone is heuristic and carries a match confidence.",
    ],
  },
  {
    id: SourceId.TxSalesTaxPermits,
    name: "Active Sales Tax Permit Holders (Travis County outlets)",
    publisher: "Texas Comptroller of Public Accounts, Texas Open Data Portal (Socrata jrea-zgmq)",
    url: "https://data.texas.gov/d/jrea-zgmq",
    provides: [
      "every business location in Travis County holding an active sales tax permit",
      "business and taxpayer names, NAICS industry code, outlet address and permit dates",
      "taxpayer numbers used to resolve contractors to registered businesses",
    ],
    refresh:
      "Downloads a new snapshot of the Travis County outlets only when the dataset's rows were updated, 50,000 rows a page.",
    limitations: [
      "Only businesses that sell or rent taxable items hold a sales tax permit; many service businesses do not appear.",
      "Outlets are linked to properties by normalized street address and ZIP code; suites and free-form addresses can stay unlinked.",
      "Contractors known on permits only by a person's name are matched to taxpayers by phone only, never by the name alone.",
    ],
  },
  {
    id: SourceId.TxFranchiseTaxpayers,
    name: "Active Franchise Taxpayers",
    publisher: "Texas Comptroller of Public Accounts, Texas Open Data Portal (Socrata 9cir-efmm)",
    url: "https://data.texas.gov/d/9cir-efmm",
    provides: [
      "every active Texas franchise taxpayer: corporations, LLCs and partnerships",
      "Secretary of State file number, charter date and right to transact business",
    ],
    refresh:
      "Downloads a new statewide snapshot of the identity columns only when the dataset's rows were updated, 50,000 rows a page.",
    limitations: [
      "Statewide and large (about 3.5 million rows), so only the identity columns are kept.",
      "Sole proprietors are not franchise taxpayers; contractors are resolved by normalized name, and only unambiguous matches are kept.",
    ],
  },
  {
    id: SourceId.TdlrLicenses,
    name: "TDLR All Licenses (Travis County)",
    publisher:
      "Texas Department of Licensing and Regulation, Texas Open Data Portal (Socrata 7358-krk7)",
    url: "https://data.texas.gov/d/7358-krk7",
    provides: [
      "state licenses of businesses and people in Travis County (electrical, air conditioning, and more)",
      "license number, type, expiration, business name and phones used to match contractors",
    ],
    refresh:
      "Downloads a new snapshot of the Travis County licenses only when the dataset's rows were updated, 50,000 rows a page.",
    limitations: [
      "Texas does not license roofing contractors, so a TDLR match identifies a contractor's other licensed trades, not a roofing license.",
      "Only contractor licenses are kept (electrical, air conditioning, appliance, sign and elevator contractors); a business's licenses are matched together by phone and normalized name.",
    ],
  },
  {
    id: SourceId.NoaaStormEvents,
    name: "Storm Events Database: hail reports around Travis County",
    publisher: "NOAA National Centers for Environmental Information (NCEI)",
    url: "https://www.ncei.noaa.gov/stormevents/",
    provides: [
      "every hail report in and around Travis County since 2000: date, hail size in inches, location and who reported it",
      "the hail signal for leads: a damaging hail report near a property after its roof was last put on",
    ],
    refresh:
      "Lists NCEI's yearly event files and downloads them again only when NCEI republishes one, keeping only the hail reports in the Travis County area.",
    limitations: [
      "Reports come from spotters, the public and officials; hail nobody reported is missing, so no report does not mean no hail.",
      "A report marks where hail was observed, rounded to about a kilometer, not the full footprint of the storm.",
      "NCEI publishes each month's reports about three months after the month ends, so the latest months are not in the data yet.",
    ],
  },
];
