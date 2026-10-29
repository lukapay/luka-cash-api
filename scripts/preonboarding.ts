// Administra el pre-onboarding de interesados (proveedores y comercios) de luka.cash/registro y del acceso anticipado.
// No crea empresas, afiliaciones ni usuarios: el registro completo es en Luka.
//   lista:      preonboarding list [pendiente|invitado|descartado]
//   invitar:    preonboarding invitar correo@dominio.com     (pasa a "invitado" y lo agrega a la lista de acceso anticipado)
//   descartar:  preonboarding descartar correo@dominio.com
// En la Mac (calidad):  ./scripts/con-dev.sh npx tsx scripts/preonboarding.ts list pendiente
// En el droplet:        sudo -u lukacash bash -c 'set -a; . /etc/luka-cash/env; set +a; cd /opt/luka-cash/api/current && node dist/preonboarding.js list'
import { closeDb, sql } from "../src/db";

const [cmd, arg] = process.argv.slice(2);
const email = (arg ?? "").trim().toLowerCase();
try {
  if (cmd === "list") {
    const estado = arg && ["pendiente", "invitado", "descartado"].includes(arg) ? arg : null;
    const rows = await sql()`select tipo, empresa, rif, nombre, whatsapp, email, array_to_string(proveedores, ', ') proveedores, origen, estado, created_at::date fecha
      from luka_cash.luka_cash_preonboarding ${estado ? sql()`where estado = ${estado}` : sql()``} order by created_at desc`;
    console.table(rows);
  } else if (cmd === "invitar" && email) {
    const rows = await sql()`update luka_cash.luka_cash_preonboarding set estado = 'invitado', updated_at = now() where lower(email) = ${email} returning nombre, tipo`;
    if (!rows.length) { console.log("no hay interesado con ese correo"); process.exitCode = 1; }
    else {
      await sql()`insert into luka_cash.luka_cash_early_access (email, nombre, origen) values (${email}, ${rows[0]!.nombre}, ${"preonboarding_" + rows[0]!.tipo})
        on conflict (email) do update set revoked_at = null`;
      console.log(`invitado: ${email} (agregado al acceso anticipado)`);
    }
  } else if (cmd === "descartar" && email) {
    const r = await sql()`update luka_cash.luka_cash_preonboarding set estado = 'descartado', updated_at = now() where lower(email) = ${email}`;
    console.log(r.count ? `descartado: ${email}` : "no hay interesado con ese correo");
  } else {
    console.log("uso: preonboarding list [estado] | invitar <correo> | descartar <correo>");
    process.exitCode = 1;
  }
} finally {
  await closeDb();
}
