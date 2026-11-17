import { FieldType, type FixedWidthField, type FixedWidthTable } from "./fixed-width.js";

export const TCAD_EXPORT_LAYOUT_VERSION = "Legacy8.0.33-AppraisalExportLayout_06182026";

export enum TcadTable {
  Properties = "properties",
  Improvements = "improvements",
  ImprovementDetails = "improvement_details",
  ImprovementAttributes = "improvement_attributes",
  LandSegments = "land_segments",
}

export const TCAD_REAL_PROPERTY_TYPES: readonly string[] = ["R", "MH"];
export const TCAD_MAIN_FLOOR_DETAIL = "1st Floor";
export const TCAD_ROOF_COVERING_ATTRIBUTE = "Roof Covering";
export const TCAD_ROOF_STYLE_ATTRIBUTE = "Roof Style";

const TCAD_DATE_FORMAT = "%m-%d-%Y";
const ACRES_IMPLIED_DECIMALS = 4;

const text = (name: string, start: number, length: number): FixedWidthField => ({
  name,
  start,
  length,
  type: FieldType.Text,
});
const integer = (name: string, start: number, length: number): FixedWidthField => ({
  name,
  start,
  length,
  type: FieldType.Integer,
});
const decimal = (
  name: string,
  start: number,
  length: number,
  impliedDecimals?: number,
): FixedWidthField => ({
  name,
  start,
  length,
  type: FieldType.Decimal,
  ...(impliedDecimals !== undefined && { impliedDecimals }),
});
const date = (name: string, start: number, length: number): FixedWidthField => ({
  name,
  start,
  length,
  type: FieldType.Date,
});
const flag = (name: string, start: number, length: number): FixedWidthField => ({
  name,
  start,
  length,
  type: FieldType.Flag,
});

const properties: FixedWidthTable = {
  name: TcadTable.Properties,
  member: "PROP.TXT",
  dateFormat: TCAD_DATE_FORMAT,
  fields: [
    integer("prop_id", 1, 12),
    text("prop_type_cd", 13, 5),
    integer("prop_val_yr", 18, 5),
    integer("sup_num", 23, 12),
    text("geo_id", 547, 50),
    integer("py_owner_id", 597, 12),
    text("py_owner_name", 609, 70),
    flag("partial_owner", 679, 1),
    text("py_addr_line1", 694, 60),
    text("py_addr_line2", 754, 60),
    text("py_addr_line3", 814, 60),
    text("py_addr_city", 874, 50),
    text("py_addr_state", 924, 50),
    text("py_addr_country", 974, 5),
    text("py_addr_zip", 979, 5),
    flag("py_confidential_flag", 990, 1),
    text("situs_street_prefx", 1040, 10),
    text("situs_street", 1050, 50),
    text("situs_street_suffix", 1100, 10),
    text("situs_city", 1110, 30),
    text("situs_zip", 1140, 10),
    text("legal_desc", 1150, 255),
    text("hood_cd", 1686, 10),
    integer("appraised_val", 1916, 15),
    integer("assessed_val", 1946, 15),
    text("deed_book_id", 1994, 20),
    text("deed_book_page", 2014, 20),
    date("deed_dt", 2034, 25),
    flag("hs_exempt", 2609, 1),
    flag("ov65_exempt", 2610, 1),
    text("imprv_state_cd", 2732, 10),
    text("land_state_cd", 2742, 10),
    decimal("land_acres", 2772, 20, ACRES_IMPLIED_DECIMALS),
    integer("market_value", 4214, 14),
    text("situs_num", 4460, 15),
    text("situs_unit", 4475, 5),
  ],
};

const improvements: FixedWidthTable = {
  name: TcadTable.Improvements,
  member: "IMP_INFO.TXT",
  dateFormat: TCAD_DATE_FORMAT,
  fields: [
    integer("prop_id", 1, 12),
    integer("prop_val_yr", 13, 4),
    integer("imprv_id", 17, 12),
    text("imprv_type_cd", 29, 10),
    text("imprv_type_desc", 39, 25),
    text("imprv_state_cd", 64, 5),
    flag("imprv_homesite", 69, 1),
    integer("imprv_val", 70, 14),
  ],
};

const improvementDetails: FixedWidthTable = {
  name: TcadTable.ImprovementDetails,
  member: "IMP_DET.TXT",
  dateFormat: TCAD_DATE_FORMAT,
  fields: [
    integer("prop_id", 1, 12),
    integer("prop_val_yr", 13, 4),
    integer("imprv_id", 17, 12),
    integer("imprv_det_id", 29, 12),
    text("imprv_det_type_cd", 41, 10),
    text("imprv_det_type_desc", 51, 25),
    text("imprv_det_class_cd", 76, 10),
    integer("yr_built", 86, 4),
    integer("depreciation_yr", 90, 4),
    decimal("imprv_det_area", 94, 15),
    decimal("imprv_det_val", 109, 14),
  ],
};

const improvementAttributes: FixedWidthTable = {
  name: TcadTable.ImprovementAttributes,
  member: "IMP_ATR.TXT",
  dateFormat: TCAD_DATE_FORMAT,
  fields: [
    integer("prop_id", 1, 12),
    integer("prop_val_yr", 13, 4),
    integer("imprv_id", 17, 12),
    integer("imprv_det_id", 29, 12),
    integer("imprv_attr_id", 41, 12),
    text("imprv_attr_desc", 53, 25),
    text("imprv_attr_cd", 78, 10),
  ],
};

const landSegments: FixedWidthTable = {
  name: TcadTable.LandSegments,
  member: "LAND_DET.TXT",
  dateFormat: TCAD_DATE_FORMAT,
  fields: [
    integer("prop_id", 1, 12),
    integer("prop_val_yr", 13, 4),
    integer("land_seg_id", 17, 12),
    text("land_type_cd", 29, 10),
    text("land_type_desc", 39, 25),
    text("state_cd", 64, 5),
    flag("land_seg_homesite", 69, 1),
    decimal("size_acres", 70, 14, ACRES_IMPLIED_DECIMALS),
    integer("size_square_feet", 84, 14),
    integer("land_seg_mkt_val", 141, 14),
  ],
};

export const TCAD_EXPORT_TABLES: readonly FixedWidthTable[] = [
  properties,
  improvements,
  improvementDetails,
  improvementAttributes,
  landSegments,
];
