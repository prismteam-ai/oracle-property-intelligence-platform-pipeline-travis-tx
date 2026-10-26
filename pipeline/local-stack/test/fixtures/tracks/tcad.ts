// SYNTHETIC TEST FIXTURE: a Loader track plug-in shaped like services/tracks/<track>.ts.
import { z } from "zod";
import { LoaderInputBase, type LoaderTrack } from "../../../services/loader.js";

const Input = LoaderInputBase.extend({ rows: z.array(z.string()) });

export const track: LoaderTrack<z.infer<typeof Input>> = {
  name: "tcad",
  input: Input,
  async merge(tx, input) {
    for (const row of input.rows) {
      await tx`INSERT INTO fixture_rows (row) VALUES (${row})`;
    }
    if (input.rows.includes("boom")) throw new Error("synthetic merge failure");
    return {
      rowsWritten: input.rows.length,
      watermark: { sourceKey: "tcad_export", value: { mergedCount: input.rows.length } },
      tombstones: 0,
    };
  },
};
