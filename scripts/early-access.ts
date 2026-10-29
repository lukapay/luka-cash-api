// Administra la lista de Luka Cash Early Access.
//   agregar:  early-access add correo@dominio.com "Nombre" [origen]
//   quitar:   early-access remove correo@dominio.com      (revoca: el invitado pierde la sesión al instante)
//   lista:    early-access list
// En la Mac (calidad):  ./scripts/con-dev.sh npx tsx scripts/early-access.ts add ...
// En el droplet:        sudo -u lukacash bash -c 'set -a; . /etc/luka-cash/env; set +a; cd /opt/luka-cash/api/current && node dist/early-access.js add ...'
import { closeDb, sql } from "../src/db";

const [cmd, emailRaw, nombre, origen] = process.argv.slice(2);
const email = (emailRaw ?? "").trim().toLowerCase();
try {
  if (cmd === "add" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    await sql()`insert into luka_cash.luka_cash_early_access (email, nombre, origen) values (${email}, ${nombre ?? null}, ${origen ?? "manual"})
      on conflict (email) do update set nombre = coalesce(excluded.nombre, luka_cash_early_access.nombre), revoked_at = null`;
    console.log("invitado:", email);
  } else if (cmd === "remove" && email) {
    const r = await sql()`update luka_cash.luka_cash_early_access set revoked_at = now() where email = ${email} and revoked_at is null`;
    console.log(r.count ? `revocado: ${email}` : "no estaba activo");
  } else if (cmd === "list") {
    const rows = await sql()`select email, nombre, origen, invited_at::date invitado, validated_at is not null validado, revoked_at is not null revocado
      from luka_cash.luka_cash_early_access order by invited_at`;
    console.table(rows);
  } else {
    console.log('uso: early-access add <correo> "<nombre>" [origen] | remove <correo> | list');
    process.exitCode = 1;
  }
} finally {
  await closeDb();
}
