import { describe, expect, it } from "vitest";
import {
  armarReferencia, cuerpoLink, leerResultado, limpiarResultado, siguienteEstado, validarArchivo, validarOrdenPago,
} from "../src/luka/payments";

const plan = [
  { id: "c1", numero: 1, estado: "pagada", monto: 293371.97 },
  { id: "c2", numero: 2, estado: "pendiente", monto: 293371.97 },
  { id: "c3", numero: 3, estado: "pendiente", monto: 293371.96 },
];

describe("orden de cuotas a pagar", () => {
  it("la próxima pendiente es válida", () => expect(validarOrdenPago(plan, ["c2"])).toBeNull());
  it("dos en orden es válido", () => expect(validarOrdenPago(plan, ["c2", "c3"])).toBeNull());
  it("saltar la cuota 2 no se permite", () => expect(validarOrdenPago(plan, ["c3"])).toMatch(/en orden/));
  it("una cuota pagada no se cobra", () => expect(validarOrdenPago(plan, ["c1"])).toMatch(/ya no está pendiente/));
  it("una cuota de otra factura no se cobra", () => expect(validarOrdenPago(plan, ["x"])).toMatch(/no pertenece/));
  it("vacío no se permite", () => expect(validarOrdenPago(plan, [])).not.toBeNull());
});

describe("referencia", () => {
  it("una cuota", () => expect(armarReferencia("cuotas", [2], 3, "324235")).toBe("Cuota 2 de 3 · Factura 324235"));
  it("dos cuotas", () => expect(armarReferencia("cuotas", [3, 2], 3, "324235")).toBe("Cuota 2 de 3, Cuota 3 de 3 · Factura 324235"));
  it("paga después", () => expect(armarReferencia("paga_despues", [1], 1, "324236")).toBe("Pago · Factura 324236"));
});

describe("cuerpo del link por moneda", () => {
  const base = { monto: 293371.97, referencia: "r", idTraza: "cli-1", email: "a@b.com" };
  it("VES", () => expect(cuerpoLink({ ...base, moneda: "VES" })).toEqual({
    MonedaCodigo: "VES", Monto: 293371.97,
    MetodosPago: ["tdc_mc", "tdd_mc", "c2p", "bdv", "pm_bamiga", "banesco_inmediata", "pago_movil", "transferencia"],
    Referencia: "r", IdTraza: "cli-1", Email: "a@b.com",
  }));
  it("USD", () => expect(cuerpoLink({ ...base, moneda: "USD" }).MetodosPago).toEqual(["tdc_bs", "paypal", "zelle", "bls_apple_pay", "bls_google_pay"]));
});

describe("resultado de la librería", () => {
  it("exitoso es aprobado", () => expect(leerResultado({ exitoso: true, isPending: false })).toBe("aprobado"));
  it("Exitoso con mayúscula es aprobado", () => expect(leerResultado({ Exitoso: true })).toBe("aprobado"));
  it("isPending es pendiente", () => expect(leerResultado({ exitoso: true, isPending: true })).toBe("pendiente"));
  it("estatus pending es pendiente", () => expect(leerResultado({ exitoso: true, infoProceso: { estatusProcesamiento: "pending" } })).toBe("pendiente"));
  it("estatus error es fallido", () => expect(leerResultado({ exitoso: true, infoProceso: { estatusProcesamiento: "error" } })).toBe("fallido"));
  it("sin éxito es fallido", () => expect(leerResultado({ exitoso: false })).toBe("fallido"));
  it("nulo es fallido", () => expect(leerResultado(null)).toBe("fallido"));
});

describe("confirmación idempotente", () => {
  it("creado pasa a aprobado", () => expect(siguienteEstado("creado", "aprobado")).toBe("aprobado"));
  it("pendiente pasa a aprobado", () => expect(siguienteEstado("pendiente", "aprobado")).toBe("aprobado"));
  it("un segundo aviso aprobado no cambia nada", () => expect(siguienteEstado("aprobado", "aprobado")).toBeNull());
  it("un aviso fallido tras aprobado no cambia nada", () => expect(siguienteEstado("aprobado", "fallido")).toBeNull());
  it("fallido es final", () => expect(siguienteEstado("fallido", "aprobado")).toBeNull());
  it("quita tokens y tarjeta", () => expect(limpiarResultado({ exitoso: true, token: "x", tarjeta: { numero: "4" }, ok: "si" })).toEqual({ exitoso: true, ok: "si" }));
});

describe("validación de archivo", () => {
  it("PDF de 1 MB sí", () => expect(validarArchivo("application/pdf", 1024 * 1024)).toBeNull());
  it("PNG de 10 MB exactos sí", () => expect(validarArchivo("image/png", 10 * 1024 * 1024)).toBeNull());
  it("más de 10 MB no", () => expect(validarArchivo("image/jpeg", 10 * 1024 * 1024 + 1)).toMatch(/10 MB/));
  it("Word no", () => expect(validarArchivo("application/msword", 1000)).toMatch(/PDF, JPG o PNG/));
  it("vacío no", () => expect(validarArchivo("image/png", 0)).not.toBeNull());
});
