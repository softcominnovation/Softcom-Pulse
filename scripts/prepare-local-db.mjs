import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "invalid:");
if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/pulse") {
  throw new Error("This command only prepares the local pulse database.");
}
url.pathname = "/postgres";
const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 3000 });
try {
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", ["pulse"]);
  if (!exists.rowCount) await client.query('CREATE DATABASE "pulse"');
  console.log(exists.rowCount ? "Local pulse database already exists; preserved." : "Local pulse database created.");
} catch {
  console.error("Could not prepare the local database. Check the local credentials and PostgreSQL service.");
  process.exitCode = 1;
} finally { await client.end(); }
