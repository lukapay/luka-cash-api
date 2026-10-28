import { describe, expect, it, vi } from "vitest";
import { checkPortalToken, crearPlanIdempotente, isBlockedPortalOrigin, validarCuotasPlan, validarPlazo, type PlanStore } from "../src/luka/portal";

const c = (numero: number, monto: number, estado: string, fecha: string) => ({ numero, monto, estado, fecha_vencimiento: fecha });
const cuotas = { modalidad: "cuotas", monto_factura: 880115.9 };
const tres = (ultimo = 293371.96) => [
  c(1, 293371.97, "pagada", "2026-10-19"), c(2, 293371.97, "pendiente", "2026-11-03"), c(3, ultimo, "pendiente", "2026-11-18"),
];

describe("validación de cuotas del plan", () => {
  it("Cuotas: suma el monto de la factura sin cargo", () => expect(validarCuotasPlan(tres(), cuotas)).toBeNull());
  it("rechaza si las cuotas incluyen el cargo", () => expect(validarCuotasPlan(tres(293371.96 + 30115.9), cuotas)).toMatch(/suma/));
  it("acepta diferencia de 0,05", () => expect(validarCuotasPlan(tres(293372.01), cuotas)).toBeNull());
  it("rechaza diferencia mayor a 0,05", () => expect(validarCuotasPlan(tres(293372.02), cuotas)).toMatch(/suma/));
  it("rechaza cuotas no consecutivas", () => {
    const x = tres(); x[2]!.numero = 4;
    expect(validarCuotasPlan(x, cuotas)).toMatch(/consecutivas/);
  });
  it("exige la Cuota 1 pagada", () => {
    const x = tres(); x[0]!.estado = "pendiente";
    expect(validarCuotasPlan(x, cuotas)).toMatch(/Cuota 1/);
  });
  it("exige el resto pendiente", () => {
    const x = tres(); x[2]!.estado = "pagada";
    expect(validarCuotasPlan(x, cuotas)).toMatch(/pendiente/);
  });
  it("exige 15 días entre cuotas", () => {
    const x = tres(); x[2]!.fecha_vencimiento = "2026-11-20";
    expect(validarCuotasPlan(x, cuotas)).toMatch(/15 días/);
  });
  it("Cuotas: rechaza 1 o 5 filas", () => {
    expect(validarCuotasPlan([c(1, 880115.9, "pagada", "2026-10-19")], cuotas)).toMatch(/2 a 4/);
    const cinco = [0, 1, 2, 3, 4].map((i) => c(i + 1, 176023.18, i ? "pendiente" : "pagada", new Date(Date.UTC(2026, 9, 19 + 15 * i)).toISOString().slice(0, 10)));
    expect(validarCuotasPlan(cinco, cuotas)).toMatch(/2 a 4/);
  });
  it("Paga después: una fila pendiente de 264.219,59 a 30 días", () => {
    expect(validarCuotasPlan([c(1, 264219.59, "pendiente", "2026-11-18")], { modalidad: "paga_despues", monto_factura: 264219.59 })).toBeNull();
  });
  it("Paga después: no acepta la fila pagada ni más de una", () => {
    const pd = { modalidad: "paga_despues", monto_factura: 264219.59 };
    expect(validarCuotasPlan([c(1, 264219.59, "pagada", "2026-11-18")], pd)).toMatch(/pendiente/);
    expect(validarCuotasPlan([c(1, 132109.8, "pendiente", "2026-11-03"), c(2, 132109.79, "pendiente", "2026-11-18")], pd)).toMatch(/una sola/);
  });
});

describe("plazo por modalidad", () => {
  it("Paga después acepta 30, 45 y 60 días", () => {
    for (const p of [30, 45, 60]) expect(validarPlazo("paga_despues", p)).toBeNull();
  });
  it("Paga después rechaza 15 días", () => expect(validarPlazo("paga_despues", 15)).toMatch(/30, 45 o 60/));
  it("Cuotas acepta 15, 30 y 45 días", () => {
    for (const p of [15, 30, 45]) expect(validarPlazo("cuotas", p)).toBeNull();
  });
  it("Cuotas rechaza 60 días", () => expect(validarPlazo("cuotas", 60)).toMatch(/15, 30 o 45/));
  it("rechaza una modalidad desconocida", () => expect(validarPlazo("otra", 30)).toMatch(/Modalidad/));
});

describe("idempotencia del plan", () => {
  it("dos llamadas con el mismo factura_id_link devuelven el mismo plan sin duplicar", async () => {
    const rows = new Map<string, string>();
    let inserts = 0;
    const store: PlanStore = {
      find: async (a, l) => (rows.has(a + l) ? { id: rows.get(a + l)! } : null),
      insert: async () => { inserts++; rows.set("af1link1", "plan-1"); return { id: "plan-1" }; },
    };
    const a = await crearPlanIdempotente(store, "af1", "link1");
    const b = await crearPlanIdempotente(store, "af1", "link1");
    expect(a.plan_id).toBe("plan-1");
    expect(b).toEqual({ plan_id: "plan-1", existente: true });
    expect(inserts).toBe(1);
  });
  it("si dos llamadas compiten, la perdedora devuelve el plan existente", async () => {
    let first = true;
    const store: PlanStore = {
      find: async () => (first ? ((first = false), null) : { id: "plan-9" }),
      insert: async () => ({ conflict: true }),
    };
    expect(await crearPlanIdempotente(store, "af", "l")).toEqual({ plan_id: "plan-9", existente: true });
  });
});

describe("verificación del portal (Payco simulado)", () => {
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("acepta cuando el correo coincide y llama a /portalpagos/user con Bearer", async () => {
    const f = ok({ data: { Email: "Admin@Acme.com" } });
    const r = await checkPortalToken("tok", "admin@acme.com", "https://payco.test/api/v1/", f);
    expect(r.ok).toBe(true);
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe("https://payco.test/api/v1/portalpagos/user");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });
  it("401 si el correo no coincide", async () => {
    const r = await checkPortalToken("tok", "otro@acme.com", "https://p", ok({ email: "admin@acme.com" }));
    expect(r).toMatchObject({ ok: false, status: 401, error: "correo_no_coincide" });
  });
  it("401 si Payco rechaza el token", async () => {
    expect(await checkPortalToken("tok", "a@b.com", "https://p", ok({}, 401))).toMatchObject({ ok: false, status: 401 });
  });
  it("401 sin cabecera", async () => {
    expect(await checkPortalToken(null, "a@b.com", "https://p", ok({}))).toMatchObject({ ok: false, status: 401 });
  });
});

describe("orígenes del portal productivo", () => {
  it("bloquea lukapay.me y lukapay.io", () => {
    expect(isBlockedPortalOrigin("https://portal.lukapay.me")).toBe(true);
    expect(isBlockedPortalOrigin("https://lukapay.io")).toBe(true);
    expect(isBlockedPortalOrigin("https://id-preview--13ee17a3-1c40-4050-860c-36283a947427.lovable.app")).toBe(false);
  });
});
