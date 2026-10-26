// A-11 (ERR-69): the owner-name reader. Every row is a name as TCAD prints it. A wrong person
// name is worse than an unparsed one, so the table is as much about what must stay unparsed.
import { describe, expect, it } from "vitest";
import { ENTITY_NAME, parseOwner } from "../../travis/transforms/owner-name.js";

const person = (
  first: string,
  last: string,
  middle: string | null = null,
  suffix: string | null = null,
) => ({ first_name: first, last_name: last, middle_name: middle, suffix_name: suffix });

type Case = {
  name: string;
  secondary?: string;
  first?: string | null;
  last?: string | null;
  want:
    { people: ReturnType<typeof person>[]; skipped?: boolean } | { company: string } | "unparsed";
};

const CASES: Case[] = [
  // LAST FIRST [MIDDLE]
  { name: "DOE JANE", want: { people: [person("Jane", "Doe")] } },
  { name: "ROWHANIAN MICHAEL K", want: { people: [person("Michael", "Rowhanian", "K")] } },
  { name: "NORTHCUTT RYAN FRANCIS", want: { people: [person("Ryan", "Northcutt", "Francis")] } },
  { name: "  HOUSTON   JERRY ", want: { people: [person("Jerry", "Houston")] } },
  // suffixes
  { name: "SMITH JOHN JR", want: { people: [person("John", "Smith", null, "Jr.")] } },
  { name: "SMITH JOHN SR.", want: { people: [person("John", "Smith", null, "Sr.")] } },
  {
    name: "UNGER RONALD NEIL II &",
    secondary: "LINDA EISSLER UNGER",
    want: {
      people: [person("Ronald", "Unger", "Neil", "II"), person("Linda", "Unger", "Eissler")],
    },
  },
  { name: "WELCH JOHN BAILEY III", want: { people: [person("John", "Welch", "Bailey", "III")] } },
  // joint names
  {
    name: "MCCORMACK MATT &",
    secondary: "LINDSAY MCCORMACK",
    want: {
      people: [person("Matt", "Mccormack"), person("Lindsay", "Mccormack")],
    },
  },
  {
    name: "VO TAMMY M & HENRY T PAN",
    want: {
      people: [person("Tammy", "Vo", "M"), person("Henry", "Pan", "T")],
    },
  },
  {
    name: "GOODYEAR JASON & MOLLY",
    want: {
      people: [person("Jason", "Goodyear"), person("Molly", "Goodyear")],
    },
  },
  {
    name: "CULMO KATHERYN A & MATTHEW J",
    want: {
      people: [person("Katheryn", "Culmo", "A"), person("Matthew", "Culmo", "J")],
    },
  },
  {
    name: "HERNANDEZ MARCO AND JANIE HERNANDEZ",
    want: {
      people: [person("Marco", "Hernandez"), person("Janie", "Hernandez")],
    },
  },
  {
    name: "WOODSON PATRICK L & MARGARET K HART",
    want: {
      people: [person("Patrick", "Woodson", "L"), person("Margaret", "Hart", "K")],
    },
  },
  {
    name: "DUNLAP JUSTIN E &",
    secondary: "GRETA E GOLDSBY",
    want: {
      people: [person("Justin", "Dunlap", "E"), person("Greta", "Goldsby", "E")],
    },
  },
  {
    name: "RIPP MICHAEL H JR & JEANNINE W",
    want: {
      people: [person("Michael", "Ripp", "H", "Jr."), person("Jeannine", "Ripp", "W")],
    },
  },
  // hyphen and apostrophe
  {
    name: "RAMOS HILARIO J & LACEY K BINGHAM-RAMOS",
    want: {
      people: [person("Hilario", "Ramos", "J"), person("Lacey", "Bingham-Ramos", "K")],
    },
  },
  { name: "O'REILLY AUSTIN DAVID", want: { people: [person("Austin", "O'Reilly", "David")] } },
  // the co-owner cannot be read: the first-named owner is kept and the skip is counted
  {
    name: "BURROWS JOHN W & MARY ANN",
    want: { people: [person("John", "Burrows", "W")], skipped: true },
  },
  {
    name: "FENIMORE CHET A & B VICTORIA REED",
    want: { people: [person("Chet", "Fenimore", "A")], skipped: true },
  },
  {
    name: "JONES TIM & MARIA DE LA CRUZ",
    want: { people: [person("Tim", "Jones")], skipped: true },
  },
  {
    name: "HYNDS BENJAMIN E & GAY LYNN",
    secondary: "GAY LYNN HYNDS",
    want: {
      people: [person("Benjamin", "Hynds", "E"), person("Gay", "Hynds", "Lynn")],
    },
  },
  { name: "SMITH JANE", secondary: "C/O PAT SMITH", want: { people: [person("Jane", "Smith")] } },
  {
    name: "WYNN ANNE ELIZABETH",
    secondary: "STE C-100",
    want: { people: [person("Anne", "Wynn", "Elizabeth")] },
  },
  // trailing "and others" markers are dropped
  { name: "GARZA FRANK J ETAL", want: { people: [person("Frank", "Garza", "J")] } },
  { name: "BOSCO PETER L ET AL", want: { people: [person("Peter", "Bosco", "L")] } },
  { name: "BOSCO PETER L ET UX", want: { people: [person("Peter", "Bosco", "L")] } },
  // explicit TCAD first/last are kept as before
  {
    name: "MARTIN HANNAH & LUKAS DOMMER-KOCH",
    first: "HANNAH",
    last: "MARTIN",
    want: {
      people: [person("Hannah", "Martin")],
    },
  },
  // entities are companies (name as printed), also with a trust tail on the second line
  { name: "SAMPLE OWNER LLC", want: { company: "SAMPLE OWNER LLC" } },
  { name: "WEISZ FAMILY TRUST", want: { company: "WEISZ FAMILY TRUST" } },
  { name: "WEST LAKE BEACH L L C", want: { company: "WEST LAKE BEACH L L C" } },
  {
    name: "KMB MANAGEMENT TRUST",
    first: "KEVIN",
    last: "BLACKBURN",
    want: {
      company: "KMB MANAGEMENT TRUST",
    },
  },
  {
    name: "KRUGER SCOTT & RONNI REVOCABLE",
    secondary: "TRUST",
    want: {
      company: "KRUGER SCOTT & RONNI REVOCABLE TRUST",
    },
  },
  {
    name: "SHIRALAGI PAVAN 2015",
    secondary: "IRREVOCABLE TRUST",
    want: {
      company: "SHIRALAGI PAVAN 2015 IRREVOCABLE TRUST",
    },
  },
  {
    name: "PALISADES ON BARTON CREEK",
    secondary: "HOMEOWNERS ASSOC INC",
    want: {
      company: "PALISADES ON BARTON CREEK HOMEOWNERS ASSOC INC",
    },
  },
  {
    name: "BAILEY SAMANTHA KATE WESTER",
    secondary: "RESIDENTIAL TRUST",
    want: {
      company: "BAILEY SAMANTHA KATE WESTER RESIDENTIAL TRUST",
    },
  },
  // must stay unparsed
  { name: "DOE", want: "unparsed" },
  { name: "", want: "unparsed" },
  { name: "SMITH DEBRA KAY LIFE ESTATE", want: "unparsed" },
  { name: "EST OF SMITH JOHN", want: "unparsed" },
  { name: "SMITH JOHN ESTATE", want: "unparsed" },
  { name: "SMITH JOHN HEIRS", want: "unparsed" },
  { name: "SMITH JOHN C/O JANE DOE", want: "unparsed" },
  { name: "6511 HART LN", want: "unparsed" },
  {
    name: "SERIES 103",
    secondary: "BAREFOOT INVESTMENT PROPERTIES LLC",
    want: { company: "SERIES 103 BAREFOOT INVESTMENT PROPERTIES LLC" },
  },
  { name: "LUNDELIUS ERNEST L JR & JUDITH", secondary: "JUDITH W LIVING TRUST", want: "unparsed" },
  { name: "TOMPKINS H ELIZABETH &", secondary: "FERDINAND A TSCHOEPE III", want: "unparsed" },
  { name: "BENNETT J BRUCE & MARGARET M", want: "unparsed" },
  { name: "SMITH JOHN LE", want: "unparsed" },
  { name: "LE LENA", want: "unparsed" },
  { name: "DE LA CRUZ MARIA", want: "unparsed" },
  { name: "GARCIA DE LEON MARIA", want: "unparsed" },
  { name: "DULANEY RADOMSKI DIANA D", want: "unparsed" },
  { name: "A B & C D & E F", want: "unparsed" },
  { name: "SMITH JOHN & ACME SERVICES", want: "unparsed" },
  { name: "TRAVIS COUNTY", want: "unparsed" },
  {
    name: "AUSTIN DOWNTOWN GIGI'S PEACEFUL",
    secondary: "HOME LLC",
    want: { company: "AUSTIN DOWNTOWN GIGI'S PEACEFUL HOME LLC" },
  },
  { name: "JONES PLUMBING", want: "unparsed" },
  { name: "SMITH J", want: "unparsed" },
  { name: "SMITH JOHN 2ND", want: "unparsed" },
];

describe("parseOwner (A-11, ERR-69)", () => {
  it.each(CASES.map((c) => [c.name || "(empty)", c] as const))("%s", (_label, c) => {
    const got = parseOwner({
      name: c.name,
      nameSecondary: c.secondary ?? "",
      firstName: c.first ?? null,
      lastName: c.last ?? null,
    });
    if (c.want === "unparsed") {
      expect(got).toEqual({ kind: "unparsed" });
    } else if ("company" in c.want) {
      expect(got).toEqual({ kind: "company", name: c.want.company });
    } else {
      expect(got).toEqual({
        kind: "people",
        people: c.want.people,
        skippedCoOwner: c.want.skipped ?? false,
      });
    }
  });

  it("every written name satisfies the lexicon person patterns", () => {
    const pattern = /^[A-Z][a-z]*([ \-',.][A-Za-z][a-z]*)*$/;
    for (const c of CASES) {
      const got = parseOwner({ name: c.name, nameSecondary: c.secondary ?? "" });
      if (got.kind !== "people") continue;
      for (const p of got.people) {
        expect(p.first_name).toMatch(pattern);
        expect(p.last_name).toMatch(pattern);
        if (p.middle_name !== null) expect(p.middle_name).toMatch(/^[A-Z][a-zA-Z\s\-',.]*$/);
      }
    }
  });

  it("a second line that is only a unit designator is not a party (condo owners)", () => {
    const joint = parseOwner({ name: "STOTESBERY WILLIAM D & SUSAN R", nameSecondary: "UNIT A" });
    expect(joint.kind).toBe("people");
    if (joint.kind === "people") expect(joint.people).toHaveLength(2);
    const one = parseOwner({ name: "DOE JANE", nameSecondary: "APT 4" });
    expect(one.kind === "people" && one.people.length === 1 && !one.skippedCoOwner).toBe(true);
    expect(parseOwner({ name: "DOE JANE", nameSecondary: "UNIT OWNERS ASSOC" }).kind).toBe(
      "unparsed",
    );
  });

  it("keeps the entity detection of earlier runs", () => {
    for (const n of ["ACME LLC", "ACME INC", "ACME LP", "FIRST BAPTIST CHURCH", "AUSTIN ISD"]) {
      expect(ENTITY_NAME.test(n), n).toBe(true);
    }
    expect(ENTITY_NAME.test("DOE JANE")).toBe(false);
  });
});
