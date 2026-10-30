import { describe, expect, it } from "vitest";
import { limpiarFacturas } from "../src/handlers";

describe("limpiarFacturas (envío del portal)", () => {
  it("normaliza moneda, estado, fecha y montos", () => {
    const r = limpiarFacturas([{ id_link: "L1", numero: "324228", monto: "687.456", moneda: "ves", estado: "Pendiente", vence: "2026-11-19T00:00:00", url_adjunto: "https://x/f.pdf" }]);
    expect(r).toEqual([{ id_link: "L1", numero: "324228", orden: null, monto: 687.46, moneda: "VES", estado: "pendiente", vence: "2026-11-19", url_adjunto: "https://x/f.pdf" }]);
  });
  it("descarta adjuntos que no son https", () => {
    const r = limpiarFacturas([{ id_link: "L1", numero: "1", monto: 1, url_adjunto: "javascript:alert(1)" }]) as { url_adjunto: string | null }[];
    expect(r[0]!.url_adjunto).toBeNull();
  });
  it("rechaza facturas sin id_link, número o monto", () => {
    expect(limpiarFacturas([{ numero: "1", monto: 1 }])).toMatch(/id_link/);
    expect(limpiarFacturas([{ id_link: "L", numero: "1", monto: -5 }])).toMatch(/monto/);
    expect(limpiarFacturas("no")).toMatch(/lista/);
  });
});

import { clientIp } from "../src/handlers";
describe("clientIp con intermediario de confianza", () => {
  const llave = "k".repeat(40);
  const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
  it("sin llave configurada usa X-Real-IP", () => {
    delete process.env["EDGE_PROXY_KEY"];
    expect(clientIp(req({ "x-real-ip": "143.198.65.214", "x-luka-visitor-ip": "1.2.3.4", "x-luka-proxy-key": llave }))).toBe("143.198.65.214");
  });
  it("con la llave correcta usa la IP del visitante", () => {
    process.env["EDGE_PROXY_KEY"] = llave;
    expect(clientIp(req({ "x-real-ip": "143.198.65.214", "x-luka-visitor-ip": "1.2.3.4", "x-luka-proxy-key": llave }))).toBe("1.2.3.4");
  });
  it("con llave equivocada la ignora", () => {
    process.env["EDGE_PROXY_KEY"] = llave;
    expect(clientIp(req({ "x-real-ip": "143.198.65.214", "x-luka-visitor-ip": "1.2.3.4", "x-luka-proxy-key": "otra" }))).toBe("143.198.65.214");
    delete process.env["EDGE_PROXY_KEY"];
  });
});

describe("portal de calidad en lukapay.me", () => {
  it("un *.lukapay.me no listado sigue bloqueado", async () => {
    const { app } = await import("../src/app");
    const r = await app.fetch(new Request("http://x/api/public/luka/portal-eligibility", { method: "POST", headers: { origin: "https://portal.lukapay.me", "content-type": "application/json" }, body: "{}" }));
    expect(r.status).toBe(403);
  });
});
