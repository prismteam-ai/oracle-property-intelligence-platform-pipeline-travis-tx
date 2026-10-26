// The SQL query-core binds: views.sql (T060) and the profile-generated status map (T022), as the
// string constants scripts/gen-sql.ts writes to sql.generated.ts (A-03 T012). No file is read at
// load, so the same module bundles for the browser (A-13) and runs in the Lambda.
export { STATUS_MAP_SQL, VIEWS_SQL } from "./sql.generated.js";
