// Administra los RIF precalificados para Luka Cash (un correo puede tener varios RIF).
//   agregar:    precalificados add correo@dominio.com J-12345678-9 ["Razón social"]
//   desactivar: precalificados remove correo@dominio.com J-12345678-9
//   lista:      precalificados list [correo]
// En la Mac (calidad): ./scripts/con-dev.sh npx tsx scripts/precalificados.ts list
import { closeDb, sql } from "../src/db";
import { normalizarRif } from "../src/handlers";

const [cmd, emailRaw, rifRaw, razon] = process.argv.slice(2);
const email = (emailRaw ?? "").trim().toLowerCase();
const rif = normalizarRif(rifRaw);
try {
  if (cmd === "add" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && rif) {
    await sql()`insert into luka_cash.luka_cash_precalificados (email, rif, razon_social) values (${email}, ${rif}, ${razon ?? null})
      on conflict (email, rif) do update set activo = true, razon_social = coalesce(excluded.razon_social, luka_cash_precalificados.razon_social), updated_at = now()`;
    console.log(`precalificado: ${email} ${rif}`);
  } else if (cmd === "remove" && email && rif) {
    const r = await sql()`update luka_cash.luka_cash_precalificados set activo = false, updated_at = now() where email = ${email} and rif = ${rif} and activo`;
    console.log(r.count ? `desactivado: ${email} ${rif}` : "no estaba activo");
  } else if (cmd === "list") {
    const rows = await sql()`select email, rif, razon_social, activo, created_at::date desde from luka_cash.luka_cash_precalificados
      ${email ? sql()`where email = ${email}` : sql()``} order by email, rif`;
    console.table(rows);
  } else {
    console.log('uso: precalificados add <correo> <rif> ["razón social"] | remove <correo> <rif> | list [correo]');
    process.exitCode = 1;
  }
} finally {
  await closeDb();
}
