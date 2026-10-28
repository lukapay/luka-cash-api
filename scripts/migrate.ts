// Aplica en orden las migraciones de ./migrations que no estén en luka_cash.luka_cash_migrations.
// Cada archivo es idempotente y registra su versión. Lo corre el despliegue en el droplet.
import fs from "node:fs";
import path from "node:path";
import { closeDb, sql } from "../src/db";

// Las migraciones abren su propia transacción (begin/commit): postgres.js solo lo permite con una conexión.
process.env["DATABASE_POOL_MAX"] = "1";

const dir = path.resolve(process.env["MIGRATIONS_DIR"] ?? "migrations");
const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
try {
  let aplicadas = new Set<string>();
  try {
    const rows = await sql()`select version from luka_cash.luka_cash_migrations`;
    aplicadas = new Set(rows.map((r) => r.version as string));
  } catch { /* la tabla aún no existe: primera migración */ }
  for (const f of files) {
    const v = f.replace(/\.sql$/, "");
    if (aplicadas.has(v)) continue;
    await sql().unsafe(fs.readFileSync(path.join(dir, f), "utf8"));
    console.log("aplicada", v);
  }
  console.log("migraciones al día:", files.length);
} catch (e) {
  console.error("ERROR", (e as { code?: string }).code ?? "", String((e as Error).message).replace(/:\/\/[^@\s]+@/g, "://***@"));
  process.exitCode = 1;
} finally {
  await closeDb();
}
