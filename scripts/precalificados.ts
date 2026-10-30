// Administra los RIF precalificados para Luka Cash (un correo puede tener varios RIF).
//   agregar:    precalificados add correo@dominio.com J-12345678-9 ["Razón social"]
//   desactivar: precalificados remove correo@dominio.com J-12345678-9
//   sin correo: precalificados add-rif J-12345678-9 ["Razón social"]   (vale para cualquier correo)
//   desactivar: precalificados remove-rif J-12345678-9
//   lista:      precalificados list [correo]
// En la Mac (calidad): ./scripts/con-dev.sh npx tsx scripts/precalificados.ts list
import { closeDb, sql } from "../src/db";
import { normalizarRif } from "../src/handlers";

const [cmd, a1, a2, a3] = process.argv.slice(2);
const sinCorreo = cmd === "add-rif" || cmd === "remove-rif";
const email = sinCorreo ? "" : (a1 ?? "").trim().toLowerCase();
const rif = normalizarRif(sinCorreo ? a1 : a2);
const razon = sinCorreo ? a2 : a3;
try {
  if (cmd === "add-rif" && rif) {
    await sql()`insert into luka_cash.luka_cash_precalificados (email, rif, razon_social) values (null, ${rif}, ${razon ?? null})
      on conflict (coalesce(email, ''), rif) do update set activo = true, razon_social = coalesce(excluded.razon_social, luka_cash_precalificados.razon_social), updated_at = now()`;
    console.log(`precalificado sin correo: ${rif}`);
  } else if (cmd === "remove-rif" && rif) {
    const r = await sql()`update luka_cash.luka_cash_precalificados set activo = false, updated_at = now() where email is null and rif = ${rif} and activo`;
    console.log(r.count ? `desactivado: ${rif}` : "no estaba activo");
  } else if (cmd === "add" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && rif) {
    await sql()`insert into luka_cash.luka_cash_precalificados (email, rif, razon_social) values (${email}, ${rif}, ${razon ?? null})
      on conflict (coalesce(email, ''), rif) do update set activo = true, razon_social = coalesce(excluded.razon_social, luka_cash_precalificados.razon_social), updated_at = now()`;
    console.log(`precalificado: ${email} ${rif}`);
  } else if (cmd === "remove" && email && rif) {
    const r = await sql()`update luka_cash.luka_cash_precalificados set activo = false, updated_at = now() where email = ${email} and rif = ${rif} and activo`;
    console.log(r.count ? `desactivado: ${email} ${rif}` : "no estaba activo");
  } else if (cmd === "list") {
    const rows = await sql()`select coalesce(email, '(cualquier correo)') email, rif, razon_social, activo, created_at::date desde from luka_cash.luka_cash_precalificados
      ${email ? sql()`where email = ${email}` : sql()``} order by email nulls first, rif`;
    console.table(rows);
  } else {
    console.log('uso: precalificados add <correo> <rif> ["razón social"] | add-rif <rif> ["razón social"] | remove <correo> <rif> | remove-rif <rif> | list [correo]');
    process.exitCode = 1;
  }
} finally {
  await closeDb();
}
