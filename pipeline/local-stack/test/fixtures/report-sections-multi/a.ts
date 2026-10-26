// SYNTHETIC TEST FIXTURE: one file exporting `section`, `sections` (re-listing it) and a *Section.
import type { ReportSection } from "../../../services/report.js";
export const section: ReportSection = { key: "coordinates", build: async () => ({ n: 1 }) };
export const gisSection: ReportSection = { key: "gis", build: async () => ({ n: 2 }) };
export const sections: readonly ReportSection[] = [section, gisSection];
