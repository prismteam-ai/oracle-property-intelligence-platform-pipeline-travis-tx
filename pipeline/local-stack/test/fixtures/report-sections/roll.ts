// SYNTHETIC TEST FIXTURE: a report section; counts only.
import type { ReportSection } from "../../../services/report.js";
export const section: ReportSection = {
  key: "roll",
  build: async (_sql, jobId) => ({ n: 3, loaded: 3, source_job: jobId }),
};
