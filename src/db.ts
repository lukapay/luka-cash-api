// Conexión a PostgreSQL gestionado de DigitalOcean.
// TLS siempre verificado con el certificado del clúster (DATABASE_CA_FILE). Nunca rejectUnauthorized:false.
// Las tablas viven en el esquema luka_cash y se nombran completas en cada consulta: con el pool de
// DigitalOcean en modo Transaction no se puede confiar en el search_path de la sesión.
import fs from "node:fs";
import postgres from "postgres";

let _sql: postgres.Sql | null = null;

export function sql(): postgres.Sql {
  if (_sql) return _sql;
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("Falta DATABASE_URL");
  const caFile = process.env["DATABASE_CA_FILE"];
  _sql = postgres(url, {
    // DATABASE_SSL=off solo para el Postgres local del CI (sin TLS). En DigitalOcean siempre TLS verificado.
    ssl: process.env["DATABASE_SSL"] === "off" ? false : caFile ? { ca: fs.readFileSync(caFile, "utf8"), rejectUnauthorized: true } : "require",
    max: Number(process.env["DATABASE_POOL_MAX"] ?? 5),
    prepare: false, // PgBouncer en modo Transaction no admite sentencias preparadas con nombre
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  });
  return _sql;
}

export async function closeDb() {
  if (_sql) await _sql.end({ timeout: 5 });
  _sql = null;
}
