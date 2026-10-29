// Flujo de activación desde el portal (sin Payco): handoff → redeem → code-verify "activar" con aceptación.
// Debe seguir funcionando igual con Early Access en la API.
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { closeDb, sql } from "../src/db";
import { opaqueToken, sha256 } from "../src/handlers";

const corre = Boolean(process.env["DATABASE_URL"]);
const email = `activacion+${Date.now()}@example.com`;
const post = (name: string, body: unknown, token?: string) =>
  app.fetch(new Request(`http://local/api/public/luka/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.luka.cash", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));

describe.skipIf(!corre)("activación por enlace del portal", () => {
  let affId = "", ticket = "", token = "";
  afterAll(async () => {
    await sql()`delete from luka_cash.luka_cash_affiliations where email = ${email}`;
    await sql()`delete from luka_cash.luka_cash_codes where email = ${email}`;
    await sql()`delete from luka_cash.luka_cash_users where email = ${email}`;
    await closeDb();
  });

  it("handoff-redeem entrega el ticket de una afiliación precalificada", async () => {
    const [a] = await sql()`insert into luka_cash.luka_cash_affiliations (proveedor, id_cliente, rif, razon_social, email, acepta_nombre, estado, proveedor_nombre)
      values ('coca-cola-femsa', ${"act-" + Date.now()}, 'J-11111111-1', 'Bodega Activación C.A.', ${email}, 'Luis Prueba', 'precalificado', 'Coca-Cola FEMSA') returning id`;
    affId = a!.id;
    const h = opaqueToken();
    await sql()`insert into luka_cash.luka_cash_handoffs (codigo, affiliation_id, expira_at) values (${await sha256(h)}, ${affId}, now() + interval '10 minutes')`;
    const r = await post("handoff-redeem", { h });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ razon_social: "Bodega Activación C.A.", estado: "precalificado" });
    ticket = j.handoff_ticket;
    expect((await post("handoff-redeem", { h })).status).toBe(410); // un solo uso
  });

  it("code-send con el ticket llega al envío (precalificado, sin estar en Early Access)", async () => {
    const prev = process.env["MAIL_ACCESS_KEY_ID"]; delete process.env["MAIL_ACCESS_KEY_ID"];
    const r = await post("code-send", { handoff_ticket: ticket });
    if (prev) process.env["MAIL_ACCESS_KEY_ID"] = prev;
    expect((await r.json()).error).toBe("correo_no_configurado");
  });

  it("sin aceptar términos no activa; con aceptación activa en Nivel 1 y abre sesión de app", async () => {
    await sql()`insert into luka_cash.luka_cash_codes (email, codigo_hash, expira_at, proposito)
      values (${email}, ${await sha256(`${email}:13579`)}, now() + interval '10 minutes', 'activar')`;
    const sin = await post("code-verify", { handoff_ticket: ticket, codigo: "13579", proposito: "activar" });
    expect((await sin.json()).error).toBe("sin_aceptacion");
    const ok = await post("code-verify", { handoff_ticket: ticket, codigo: "13579", proposito: "activar", aceptacion: { terminos_version: "v0.1", acepta: true } });
    const j = await ok.json();
    expect(ok.status).toBe(200);
    expect(j.alcance).toBe("app");
    token = j.session_token;
    const [a] = await sql()`select estado, nivel, origen_aceptacion from luka_cash.luka_cash_affiliations where id = ${affId}`;
    expect(a).toMatchObject({ estado: "activa", nivel: 1, origen_aceptacion: "app" });
  });

  it("la sesión de activación abre la app con la empresa y Coca-Cola FEMSA", async () => {
    const r = await post("balance", {}, token);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.afiliacion.razon_social).toBe("Bodega Activación C.A.");
    expect(j.proveedores[0].nombre).toBe("Coca-Cola FEMSA");
    expect(j.requisitos.total).toBe(6);
  });
});
