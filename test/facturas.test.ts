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
