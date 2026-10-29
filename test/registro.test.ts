import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { closeDb, sql } from "../src/db";
import { validarRegistro, whatsappValido } from "../src/handlers";

describe("whatsapp E.164", () => {
  it.each([["+584141234567", true], ["+584241234567", true], ["+582121234567", false], ["+58414123456", false],
    ["+13055551234", true], ["+5491112345678", true], ["+1234567", false], ["04141234567", false]])("%s → %s", (w, ok) => expect(whatsappValido(w)).toBe(ok));
});

describe("validarRegistro", () => {
  const base = { tipo: "proveedor", empresa: "Distribuidora Prueba", nombre: "Ana", whatsapp: "+58 414 123 4567", email: "ANA@Example.com", acepta_privacidad: true, origen: "landing" };
  it("acepta y normaliza", () => expect(validarRegistro(base)).toMatchObject({ whatsapp: "+584141234567", email: "ana@example.com", tipo: "proveedor" }));
  it("señala el campo inválido", () => {
    expect(validarRegistro({ ...base, tipo: "otro" })).toEqual({ error: "datos_invalidos", campo: "tipo" });
    expect(validarRegistro({ ...base, whatsapp: "+582121234567" })).toEqual({ error: "datos_invalidos", campo: "whatsapp" });
    expect(validarRegistro({ ...base, email: "x" })).toEqual({ error: "datos_invalidos", campo: "email" });
  });
  it("exige aceptar la privacidad", () => expect(validarRegistro({ ...base, acepta_privacidad: false })).toEqual({ error: "sin_aceptacion" }));
});

const corre = Boolean(process.env["DATABASE_URL"]);
const email = `registro+${Date.now()}@example.com`;
const post = (body: unknown) => app.fetch(new Request("http://local/api/public/luka/registro", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://luka.cash", "x-real-ip": `10.9.${Date.now() % 250}.1` }, body: JSON.stringify(body),
}));

describe.skipIf(!corre)("registro contra la base", () => {
  afterAll(async () => {
    await sql()`delete from luka_cash.luka_cash_registros where email = ${email}`;
    await sql()`delete from luka_cash.luka_cash_events where tipo = 'registro' and ip like '10.9.%'`;
    await closeDb();
  });
  it("guarda y, si se repite con el mismo tipo, actualiza sin revelar que existía", async () => {
    const b = { tipo: "comercio", empresa: "Bodega Uno", nombre: "Luis", whatsapp: "+584121234567", email, acepta_privacidad: true, origen: "early_access" };
    const r1 = await post(b);
    expect(await r1.json()).toMatchObject({ recibido: true });
    const r2 = await post({ ...b, empresa: "Bodega Uno C.A." });
    expect(await r2.json()).toMatchObject({ recibido: true });
    const rows = await sql()`select empresa, estado, origen from luka_cash.luka_cash_registros where email = ${email}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ empresa: "Bodega Uno C.A.", estado: "pendiente", origen: "early_access" });
  });
  it("datos inválidos: 400 con el campo", async () => {
    const r = await post({ tipo: "comercio", empresa: "B", nombre: "Luis", whatsapp: "+584121234567", email, acepta_privacidad: true });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "datos_invalidos", campo: "empresa" });
  });
});
