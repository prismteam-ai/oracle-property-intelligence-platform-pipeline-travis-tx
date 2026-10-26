// SYNTHETIC TEST FIXTURE: a report section; counts only.
import type { ReportSection } from "../../../services/report.js";
export const section: ReportSection = {
  key: "permits",
  build: async () => ({ linked: 2, throughput: { pages: 1, duration_s: 1, rows_per_s: 2 } }),
};
