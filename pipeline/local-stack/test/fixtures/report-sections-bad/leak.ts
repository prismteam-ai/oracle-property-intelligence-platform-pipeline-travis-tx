// SYNTHETIC TEST FIXTURE: a section that would leak a private field; the report must refuse it.
import type { ReportSection } from "../../../services/report.js";
export const section: ReportSection = {
  key: "confidentiality",
  build: async () => ({ redacted: 1, sample: [{ owner_name: "SYNTHETIC OWNER" }] }),
};
