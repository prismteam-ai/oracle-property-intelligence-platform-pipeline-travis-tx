export enum RoofWork {
  Replacement = "replacement",
  Repair = "repair",
  Accessory = "accessory",
  NewConstruction = "new_construction",
  NeedsReview = "needs_review",
  Unrelated = "unrelated",
}

export const ROOFING_WORK: readonly RoofWork[] = [
  RoofWork.Replacement,
  RoofWork.Repair,
  RoofWork.Accessory,
  RoofWork.NeedsReview,
];

export const ROOF_AGE_EVIDENCE: readonly RoofWork[] = [
  RoofWork.Replacement,
  RoofWork.NewConstruction,
];

export interface PermitFacts {
  permitType: string | undefined;
  workClass: string | undefined;
  permitClass: string | undefined;
  description: string | undefined;
}

export interface RoofWorkClassification {
  work: RoofWork;
  basis: string;
}

const BUILDING_PERMIT = "BP";
const NEW_WORK_CLASS = "new";
const PERMIT_CLASS_CODE = /^[A-Z]-\s*(\d{3})/i;
const NON_PRIMARY_BUILDING_CODES = new Set(["329", "330", "438"]);

const ACCESSORY_STRUCTURES = "PATIO|PORCH|CARPORT|PERGOLA|AWNING|GAZEBO|DECK";
const EXISTING = "(?:EXISTING |EXIST |EXT )?";

const REPLACEMENT = new RegExp(
  [
    String.raw`\bRE[- ]?ROOF(?:ING|ED)?\b`,
    String.raw`\bROOF(?:ING)? (?:REPLACE(?:MENT|D)?|RENOVATION)\b`,
    String.raw`\bREPLAC(?:E|ED|ING|EMENT) (?:OF )?(?:THE )?${EXISTING}(?:(?!(?:${ACCESSORY_STRUCTURES})\b)[A-Z]+ )?ROOF(?:ING)?\b(?! ?TOP)`,
    String.raw`\b(?:REPLAC(?:E|ED|ING)|REMOV(?:E|ED|ING)) (?:THE )?${EXISTING}(?:ROOF )?SHINGLES?\b`,
    String.raw`\bRE[- ]?SHINGL(?:E|ED|ING)\b`,
    String.raw`\bTEAR[- ]?OFF\b`,
    String.raw`\bFLAT ROOF TO PITCH`,
    String.raw`\bRE-?PITCH`,
    String.raw`\bRAISE (?:THE )?${EXISTING}ROOF\b`,
    String.raw`\bSOLAR ?(?:GLASS|SHINGLES?|ROOF(?:ING)?\b(?![- ]?(?:MOUNT|TOP)))`,
  ].join("|"),
  "i",
);
const ACCESSORY = new RegExp(
  [
    String.raw`\bPATIO COVER`,
    String.raw`\bPERGOLA`,
    String.raw`\bCARPORT`,
    String.raw`\bAWNING`,
    String.raw`\bGAZEBO`,
    String.raw`\b(?:${ACCESSORY_STRUCTURES}) ROOF`,
    String.raw`\bROOF (?:OVER|ON) (?:THE )?(?:REAR |FRONT |BACK )?(?:PORCH|PATIO|DECK)\b`,
    String.raw`\bROOF ?(?:TOP )?DECK(?!ING)\b`,
  ].join("|"),
  "i",
);
const REPAIR =
  /\bROOF(?:ING)? REPAIRS?\b|\bREPAIRS? (?:TO |OF )?(?:THE )?(?:EXISTING )?ROOF(?:ING)?\b/i;
const NOT_ROOFING = /\bSOLAR\b|\bPHOTOVOLTAIC\b|\bPV\b|\bROOF ?TOP UNITS?\b|\bRTU\b/i;
const NEW_ROOF = /\bNEW ROOF(?:ING)?\b/i;
const ROOF_MENTION = /ROOF/i;

const TRADE_PERMIT_BASIS = "trade permit";
const ROOF_MENTION_BASIS = "mentions a roof";
const NO_ROOF_BASIS = "no roof work";

export function classifyRoofWork(permit: PermitFacts): RoofWorkClassification {
  if (permit.permitType?.toUpperCase() !== BUILDING_PERMIT) {
    return {
      work: RoofWork.Unrelated,
      basis: `${TRADE_PERMIT_BASIS} ${permit.permitType ?? ""}`.trim(),
    };
  }
  if (isNewPrimaryBuilding(permit)) {
    return { work: RoofWork.NewConstruction, basis: permit.permitClass ?? NEW_WORK_CLASS };
  }

  const description = permit.description ?? "";
  const ordered: readonly (readonly [RegExp, RoofWork])[] = [
    [REPLACEMENT, RoofWork.Replacement],
    [ACCESSORY, RoofWork.Accessory],
    [REPAIR, RoofWork.Repair],
    [NOT_ROOFING, RoofWork.Unrelated],
    [NEW_ROOF, RoofWork.Replacement],
  ];
  for (const [pattern, work] of ordered) {
    const match = pattern.exec(description);
    if (match) return { work, basis: match[0].toUpperCase() };
  }

  return ROOF_MENTION.test(description)
    ? { work: RoofWork.NeedsReview, basis: ROOF_MENTION_BASIS }
    : { work: RoofWork.Unrelated, basis: NO_ROOF_BASIS };
}

function isNewPrimaryBuilding({ workClass, permitClass }: PermitFacts): boolean {
  if (workClass?.trim().toLowerCase() !== NEW_WORK_CLASS) return false;
  const code = PERMIT_CLASS_CODE.exec(permitClass ?? "")?.[1];
  return code !== undefined && !NON_PRIMARY_BUILDING_CODES.has(code);
}
