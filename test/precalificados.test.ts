import { afterAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "../src/db";
import { rifsPrecalificados } from "../src/handlers";

const corre = Boolean(process.env["DATABASE_URL"]);
const email = `precal+${Date.now()}@example.com`;

describe.skipIf(!corre)("precalificados", () => {
  afterAll(async () => { await sql()`delete from luka_cash.luka_cash_precalificados where email = ${email}`; await closeDb(); });
  it("lista solo los RIF activos del correo", async () => {
    await sql()`insert into luka_cash.luka_cash_precalificados (email, rif, razon_social, activo) values
      (${email}, 'J-11111111-1', 'Uno C.A.', true), (${email}, 'J-22222222-2', null, true), (${email}, 'J-33333333-3', null, false)`;
    expect(await rifsPrecalificados(email)).toEqual([{ rif: "J-11111111-1", razon_social: "Uno C.A." }, { rif: "J-22222222-2", razon_social: null }]);
    expect(await rifsPrecalificados("nadie@example.com")).toEqual([]);
  });
  it("la semilla del owner existe", async () => {
    expect((await rifsPrecalificados("ruben@somosluka.com")).map((x) => x.rif)).toContain("J-12345678-0");
  });
  it("rechaza RIF mal formados en la tabla", async () => {
    await expect(sql()`insert into luka_cash.luka_cash_precalificados (email, rif) values (${email}, 'J123')`).rejects.toThrow();
  });
});
