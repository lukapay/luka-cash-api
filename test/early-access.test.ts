// Early Access contra la base de prueba: el invitado entra con código, su sesión NO abre la app,
// la ruta session la reconoce y revocarlo la invalida al instante.
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { closeDb, sql } from "../src/db";
import { sha256 } from "../src/handlers";

const corre = Boolean(process.env["DATABASE_URL"]);
const email = `invitado+${Date.now()}@example.com`;
const req = (name: string, body?: unknown, token?: string, method = "POST") =>
  app.fetch(new Request(`http://local/api/public/luka/${name}`, {
    method,
    headers: { "content-type": "application/json", origin: "https://app.luka.cash", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  }));

describe.skipIf(!corre)("Early Access", () => {
  let token = "";
  afterAll(async () => {
    await sql()`delete from luka_cash.luka_cash_early_access where email = ${email}`;
    await sql()`delete from luka_cash.luka_cash_codes where email = ${email}`;
    await sql()`delete from luka_cash.luka_cash_users where email = ${email}`;
    await closeDb();
  });

  it("sin invitación: aviso de invitación", async () => {
    const r = await req("code-send", { email });
    expect((await r.json()).sin_invitacion).toBe(true);
  });

  it("invitado con código correcto: sesión de alcance early_access", async () => {
    await sql()`insert into luka_cash.luka_cash_early_access (email, nombre, origen) values (${email}, 'Prueba', 'prueba')`;
    const prev = process.env["MAIL_ACCESS_KEY_ID"]; delete process.env["MAIL_ACCESS_KEY_ID"];
    const send = await req("code-send", { email });
    if (prev) process.env["MAIL_ACCESS_KEY_ID"] = prev;
    expect((await send.json()).error).toBe("correo_no_configurado"); // llega al envío: el invitado fue aceptado
    await sql()`insert into luka_cash.luka_cash_codes (email, codigo_hash, expira_at, proposito)
      values (${email}, ${await sha256(`${email}:24680`)}, now() + interval '10 minutes', 'entrar')`;
    const v = await req("code-verify", { email, codigo: "24680", proposito: "entrar" });
    const j = await v.json();
    expect(v.status).toBe(200);
    expect(j.alcance).toBe("early_access");
    token = j.session_token;
  });

  it("la sesión de Early Access no abre la app", async () => {
    expect((await req("balance", {}, token)).status).toBe(401);
    expect((await req("invoices", {}, token)).status).toBe(401);
  });

  it("session (GET) responde email y alcance y marca validated_at", async () => {
    const r = await req("session", undefined, token, "GET");
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ email, alcance: "early_access" });
    const [ea] = await sql()`select validated_at from luka_cash.luka_cash_early_access where email = ${email}`;
    expect(ea!.validated_at).not.toBeNull();
  });

  it("revocar al invitado invalida su sesión", async () => {
    await sql()`update luka_cash.luka_cash_early_access set revoked_at = now() where email = ${email}`;
    expect((await req("session", undefined, token, "GET")).status).toBe(401);
  });

  it("session sin token: 401", async () => {
    expect((await req("session", undefined, undefined, "GET")).status).toBe(401);
  });
});
