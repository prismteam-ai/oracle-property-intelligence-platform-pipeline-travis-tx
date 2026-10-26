// TEST FIXTURE (test-only). TCAD 2026 certified JSON records in the export's real shape: a
// pretty-printed top-level array with a one-space indent, one object per property, keys as
// printed (pID, propType, geometry, propertyIdentification[].geoID, situses[], owners[],
// sales[], propertyProfile[]). Field shapes copied from the first records of
// Travis-protaxExport-20260719.json; the values below are invented for tests.

export interface FixtureRecordOptions {
  pID: number;
  geoID: string | null;
  propType?: string;
  ownerName?: string;
  firstName?: string | null;
  lastName?: string | null;
  saleDt?: string | null;
  confidentialCode?: string | null;
  yearBuilt?: number | null;
  stateCd?: string;
  geometry?: string | null;
  streetNum?: string;
  streetName?: string;
  streetSuffix?: string;
  city?: string | null;
  zip?: string;
}

export function tcadRecord(o: FixtureRecordOptions): Record<string, unknown> {
  return {
    pID: o.pID,
    pRollCorr: 0,
    pVersion: 0,
    pYear: 2026,
    propType: o.propType ?? "R",
    geometry: o.geometry === undefined ? "[30.2545186553, -97.7620645363]" : o.geometry,
    propertyLegalDescription: [{ legalDescription: `LOT 1 BLK A TEST ADDN ${o.pID}`, pID: o.pID }],
    propertyIdentification: [
      {
        geoID: o.geoID,
        refID1: null,
        refID2: o.geoID ? `${o.geoID}0000` : null,
        mapID: "010208",
        mapsco: null,
        pID: o.pID,
      },
    ],
    propertyProfile: [
      {
        imprvActualYearBuilt: o.yearBuilt === undefined ? 1985 : o.yearBuilt,
        stateCd: o.stateCd ?? "A1",
        pID: o.pID,
      },
    ],
    situses: [
      {
        situsAddressID: 1,
        primarySitus: 1,
        streetNum: o.streetNum ?? "1201",
        streetPrefix: null,
        streetName: o.streetName ?? "TESTING",
        streetSuffix: o.streetSuffix ?? "DR",
        streetSecondary: null,
        city: o.city === undefined ? "AUSTIN" : o.city,
        state: "TX",
        zip: o.zip ?? "78704",
        country: null,
        international: null,
        pID: o.pID,
      },
    ],
    owners: [
      {
        pAccountID: 9000000 + o.pID,
        ownerID: 1,
        ownerPct: 100.0,
        name: o.ownerName ?? "SAMPLE OWNER LLC",
        nameSecondary: "",
        firstName: o.firstName ?? null,
        lastName: o.lastName ?? null,
        addrDeliveryLine: "41 SAMPLE DR",
        addrUnitDesignator: null,
        addrCity: "WOODCREEK",
        addrZip: "78676-2530",
        addrState: "TX",
        addrCountry: null,
        pID: o.pID,
        agents: [],
      },
    ],
    sales: [
      {
        saleID: 1,
        deedID: 1,
        saleDt: o.saleDt === undefined ? "2015-07-07 00:00:00" : o.saleDt,
        saleType: "S",
        salePrice: 250000,
        confidentialSale: 0,
        confidentialCode: o.confidentialCode ?? null,
        buyerLine: o.ownerName ?? "SAMPLE OWNER LLC",
        pID: o.pID,
      },
    ],
    permits: [],
    events: [],
  };
}

/** The export's array text: `JSON.stringify(…, null, 1)` reproduces its one-space layout. */
export function tcadExportText(records: Record<string, unknown>[]): string {
  return JSON.stringify(records, null, 1);
}
