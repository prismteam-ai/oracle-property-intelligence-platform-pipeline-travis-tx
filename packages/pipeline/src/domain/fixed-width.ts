export enum FieldType {
  Text = "text",
  Integer = "integer",
  Decimal = "decimal",
  Date = "date",
  Flag = "flag",
}

export interface FixedWidthField {
  name: string;
  start: number;
  length: number;
  type: FieldType;
  impliedDecimals?: number;
}

export interface FixedWidthTable {
  name: string;
  member: string;
  dateFormat: string;
  fields: readonly FixedWidthField[];
}
