import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { closeDb, sql } from "../src/db";
import { limpiarProveedores, normalizarRif, validarPreonboarding, whatsappValido } from "../src/handlers";

describe("rif y proveedores", () => {
  it.each([["j123456789", "J-12345678-9"], ["V-12.345.678-9", "V-12345678-9"], ["G 20000000 1", "G-20000000-1"], ["X123456789", null], ["J1234567", null]])("rif %s → %s", (v, r) => expect(normalizarRif(v)).toBe(r));
  it("proveedores: recorta, sin duplicados, tope 20", () => {
    expect(limpiarProveedores([" Coca-Cola  FEMSA ", "coca-cola femsa", "Polar"])).toEqual(["Coca-Cola FEMSA", "Polar"]);
    expect(limpiarProveedores(undefined)).toEqual([]);
    expect(limpiarProveedores(["A"])).toBeNull();
    expect(limpiarProveedores(Array.from({ length: 21 }, (_, i) => `Prov ${i}`))).toBeNull();
  });
});

describe("whatsapp E.164", () => {
  it.each([["+584141234567", true], ["+584241234567", true], ["+582121234567", false], ["+58414123456", false],
    ["+13055551234", true], ["+5491112345678", true], ["+1234567", false], ["04141234567", false]])("%s → %s", (w, ok) => expect(whatsappValido(w)).toBe(ok));
});

describe("validarPreonboarding", () => {
  const base = { tipo: "proveedor", empresa: "Distribuidora Prueba", nombre: "Ana", whatsapp: "+58 414 123 4567", email: "ANA@Example.com", acepta_privacidad: true, origen: "landing" };
  it("acepta y normaliza", () => expect(validarPreonboarding(base)).toMatchObject({ whatsapp: "+584141234567", email: "ana@example.com", tipo: "proveedor" }));
  it("señala el campo inválido", () => {
    expect(validarPreonboarding({ ...base, tipo: "otro" })).toEqual({ error: "datos_invalidos", campo: "tipo" });
    expect(validarPreonboarding({ ...base, whatsapp: "+582121234567" })).toEqual({ error: "datos_invalidos", campo: "whatsapp" });
    expect(validarPreonboarding({ ...base, email: "x" })).toEqual({ error: "datos_invalidos", campo: "email" });
  });
  it("exige aceptar la privacidad", () => expect(validarPreonboarding({ ...base, acepta_privacidad: false })).toEqual({ error: "sin_aceptacion" }));
});

const corre = Boolean(process.env["DATABASE_URL"]);
const email = `registro+${Date.now()}@example.com`;
const post = (body: unknown) => app.fetch(new Request("http://local/api/public/luka/preonboarding", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://luka.cash", "x-real-ip": `10.9.${Date.now() % 250}.1` }, body: JSON.stringify(body),
}));

describe.skipIf(!corre)("pre-onboarding contra la base", () => {
  afterAll(async () => {
    await sql()`delete from luka_cash.luka_cash_preonboarding where email = ${email}`;
    await sql()`delete from luka_cash.luka_cash_events where tipo = 'preonboarding' and ip like '10.9.%'`;
    await closeDb();
  });
  it("guarda y, si se repite con el mismo tipo, actualiza sin revelar que existía", async () => {
    const b = { tipo: "comercio", empresa: "Bodega Uno", nombre: "Luis", whatsapp: "+584121234567", email, acepta_privacidad: true, origen: "early_access" };
    const r1 = await post(b);
    expect(await r1.json()).toMatchObject({ recibido: true });
    const r2 = await post({ ...b, empresa: "Bodega Uno C.A." });
    expect(await r2.json()).toMatchObject({ recibido: true });
    const rows = await sql()`select empresa, estado, origen from luka_cash.luka_cash_preonboarding where email = ${email}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ empresa: "Bodega Uno C.A.", estado: "pendiente", origen: "early_access" });
  });
  it("guarda rif y proveedores y los reemplaza al actualizar", async () => {
    const b = { tipo: "comercio", empresa: "Bodega Uno C.A.", nombre: "Luis", whatsapp: "+584121234567", email, acepta_privacidad: true, rif: "j123456789", proveedores: ["Coca-Cola FEMSA", "Polar"] };
    expect((await post(b)).status).toBe(200);
    let [row] = await sql()`select rif, proveedores from luka_cash.luka_cash_preonboarding where email = ${email}`;
    expect(row).toMatchObject({ rif: "J-12345678-9", proveedores: ["Coca-Cola FEMSA", "Polar"] });
    expect((await post({ ...b, proveedores: ["Cargill"] })).status).toBe(200);
    [row] = await sql()`select proveedores from luka_cash.luka_cash_preonboarding where email = ${email}`;
    expect(row!.proveedores).toEqual(["Cargill"]);
    const malo = await post({ ...b, rif: "123" });
    expect(await malo.json()).toMatchObject({ error: "datos_invalidos", campo: "rif" });
  });

  it("datos inválidos: 400 con el campo", async () => {
    const r = await post({ tipo: "comercio", empresa: "B", nombre: "Luis", whatsapp: "+584121234567", email, acepta_privacidad: true });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "datos_invalidos", campo: "empresa" });
  });
});
