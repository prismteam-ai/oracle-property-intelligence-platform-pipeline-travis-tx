import postgres from "postgres";

// OR-m4: the third destination identity is read through the connection the A-04 loader
// will use, the configured DATABASE_URL (loaded from .env by dotenv in the host process).
// Only the system identifier is returned; the URL, host and password are never printed or
// returned, and a connection error is reduced to its error code.
const SYSTEM_ID_SQL =
  "SELECT system_identifier::text AS id FROM pg_control_system()";

export async function configuredSystemIdentifier(): Promise<string> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === "")
    throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 1,
    onnotice: () => {},
  });
  try {
    const rows = await sql.unsafe<Array<{ id: string }>>(SYSTEM_ID_SQL);
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no system identifier returned");
    return id;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new Error(
      `configured connection failed (${typeof code === "string" ? code : "no code"})`,
    );
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}
