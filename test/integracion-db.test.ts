// Recorrido real contra una base de prueba (luka-cash-dev). Solo corre con DATABASE_URL definido.
// Crea una afiliación de prueba con correo @example.com y la borra al final.
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { closeDb, sql } from "../src/db";
import { sha256 } from "../src/handlers";

const corre = Boolean(process.env["DATABASE_URL"]);
const email = `prueba+${Date.now()}@example.com`;
const ORIGIN = "https://app.luka.cash";
const post = (name: string, body: unknown, token?: string) =>
  app.fetch(new Request(`http://local/api/public/luka/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));

describe.skipIf(!corre)("API contra PostgreSQL (dev)", () => {
  let affId = "";
  let token = "";

  afterAll(async () => {
    await sql()`delete from luka_cash.luka_cash_events where affiliation_id = ${affId || null} or (tipo like 'codigo%' and created_at > now() - interval '10 minutes' and affiliation_id is null and ip is null)`;
    await sql()`delete from luka_cash.luka_cash_affiliations where email = ${email}`;
    await sql()`delete from luka_cash.luka_cash_codes where email = ${email}`;
    await sql()`delete from luka_cash.luka_cash_users where email = ${email}`;
    await closeDb();
  });

  it("health responde con la base", async () => {
    const r = await app.fetch(new Request("http://local/health"));
    expect(await r.json()).toEqual({ ok: true, db: true });
  });

  it("correo sin afiliación: aviso de invitación", async () => {
    const r = await post("code-send", { email });
    expect((await r.json()).sin_invitacion).toBe(true);
  });

  it("con afiliación activa y sin SES configurado: 503 correo_no_configurado", async () => {
    const [a] = await sql()`insert into luka_cash.luka_cash_affiliations (proveedor, id_cliente, rif, razon_social, email, acepta_nombre, estado, nivel)
      values ('prueba', ${"c-" + Date.now()}, 'J-00000000-0', 'Empresa de Prueba C.A.', ${email}, 'Ana Prueba', 'activa', 3) returning id`;
    affId = a!.id;
    const prev = process.env["MAIL_ACCESS_KEY_ID"];
    delete process.env["MAIL_ACCESS_KEY_ID"];
    const r = await post("code-send", { email });
    if (prev) process.env["MAIL_ACCESS_KEY_ID"] = prev;
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("correo_no_configurado");
  });

  it("código incorrecto descuenta intentos; el correcto abre sesión", async () => {
    await sql()`insert into luka_cash.luka_cash_codes (email, codigo_hash, expira_at, proposito)
      values (${email}, ${await sha256(`${email}:12345`)}, now() + interval '10 minutes', 'entrar')`;
    const mal = await post("code-verify", { email, codigo: "00000", proposito: "entrar" });
    expect((await mal.json()).mensaje).toMatch(/quedan 2 intentos/);
    const ok = await post("code-verify", { email, codigo: "12345", proposito: "entrar" });
    const j = await ok.json();
    expect(ok.status).toBe(200);
    expect(typeof j.session_token).toBe("string");
    token = j.session_token;
    const usado = await post("code-verify", { email, codigo: "12345", proposito: "entrar" });
    expect((await usado.json()).error).toBe("usado");
  });

  it("balance con la sesión muestra la empresa", async () => {
    const r = await post("balance", {}, token);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.afiliacion.razon_social).toBe("Empresa de Prueba C.A.");
    expect(j.afiliacion.nivel).toBe(3);
    expect(j.usuario.nombre).toBe("Ana Prueba");
    expect(j.requisitos.total).toBe(6);
    expect(j.facturas).toEqual([]);
  });

  it("sin sesión o con sesión cerrada: 401", async () => {
    expect((await post("balance", {})).status).toBe(401);
    expect((await post("session-close", {}, token)).status).toBe(200);
    expect((await post("balance", {}, token)).status).toBe(401);
  });

  it("origen no permitido: 403", async () => {
    const r = await app.fetch(new Request("http://local/api/public/luka/balance", { method: "POST", headers: { origin: "https://malo.example" } }));
    expect(r.status).toBe(403);
  });
});
