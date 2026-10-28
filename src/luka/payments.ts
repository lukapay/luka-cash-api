// Reglas puras de pagos y documentos (compartidas por cliente, servidor y pruebas).

export interface CuotaRef { id: string; numero: number; estado: string; monto: number }

/** Las cuotas a pagar deben ser exactamente las primeras pendientes, en orden. */
export function validarOrdenPago(cuotasDelPlan: CuotaRef[], idsPedidos: string[]): string | null {
  if (!idsPedidos.length) return "Elige al menos una cuota.";
  if (new Set(idsPedidos).size !== idsPedidos.length) return "Hay cuotas repetidas.";
  const delPlan = new Map(cuotasDelPlan.map((c) => [c.id, c]));
  for (const id of idsPedidos) {
    const c = delPlan.get(id);
    if (!c) return "Una de las cuotas no pertenece a esta factura.";
    if (c.estado !== "pendiente") return `La cuota ${c.numero} ya no está pendiente.`;
  }
  const pendientes = cuotasDelPlan.filter((c) => c.estado === "pendiente").sort((a, b) => a.numero - b.numero);
  const esperadas = new Set(pendientes.slice(0, idsPedidos.length).map((c) => c.id));
  if (!idsPedidos.every((id) => esperadas.has(id))) return "Debes pagar las cuotas en orden, sin saltar ninguna.";
  return null;
}

export function sumarMontos(montos: number[]): number {
  return montos.reduce((s, m) => s + Math.round(m * 100), 0) / 100;
}

/** "Cuota 2 de 3, Cuota 3 de 3" o "Pago". */
export function etiquetaCuotas(modalidad: string, numeros: number[], totalCuotas: number): string {
  if (modalidad === "paga_despues") return "Pago";
  return [...numeros].sort((a, b) => a - b).map((n) => `Cuota ${n} de ${totalCuotas}`).join(", ");
}

/** "Cuota 2 de 3 · Factura 324235" */
export function armarReferencia(modalidad: string, numeros: number[], totalCuotas: number, factura: string): string {
  return `${etiquetaCuotas(modalidad, numeros, totalCuotas)} · Factura ${factura}`;
}

export const METODOS: Record<string, string[]> = {
  VES: ["tdc_mc", "tdd_mc", "c2p", "bdv", "pm_bamiga", "banesco_inmediata", "pago_movil", "transferencia"],
  USD: ["tdc_bs", "paypal", "zelle", "bls_apple_pay", "bls_google_pay"],
};

export function cuerpoLink(p: { moneda: string; monto: number; referencia: string; idTraza: string; email: string }) {
  const moneda = p.moneda === "USD" ? "USD" : "VES";
  return {
    MonedaCodigo: moneda,
    Monto: Math.round(p.monto * 100) / 100,
    MetodosPago: METODOS[moneda]!,
    Referencia: p.referencia,
    IdTraza: p.idTraza,
    Email: p.email,
  };
}

export type ResultadoPago = "aprobado" | "pendiente" | "fallido";

/** Lee el objeto que devuelve la librería del Botón de Pago. */
export function leerResultado(r: unknown): ResultadoPago {
  if (!r || typeof r !== "object") return "fallido";
  const o = r as Record<string, any>;
  const exito = o["exitoso"] === true || o["Exitoso"] === true;
  const st = String(o["infoProceso"]?.["estatusProcesamiento"] ?? "").toLowerCase();
  const pendiente = o["isPending"] === true || st === "pending";
  if (pendiente && st !== "error") return "pendiente";
  if (exito && st !== "error") return "aprobado";
  return "fallido";
}

export type EstadoPago = "creado" | "aprobado" | "pendiente" | "fallido";

/** Transición idempotente: aprobado y fallido son finales. Devuelve null si no cambia nada. */
export function siguienteEstado(actual: EstadoPago, resultado: ResultadoPago): EstadoPago | null {
  if (actual === "aprobado" || actual === "fallido") return null;
  if (actual === resultado) return null;
  return resultado;
}

const SENSIBLE = /token|tarjeta|card|cvv|cvc|pan$|^pan|numero_?tarjeta|expir|vencimiento|clave|password|pin|bin$|cedula|documento/i;

/** Copia el resultado sin tokens ni datos de tarjeta (máx. 3 niveles, textos de 200). */
export function limpiarResultado(r: unknown, depth = 0): unknown {
  if (r == null || typeof r === "boolean" || typeof r === "number") return r;
  if (typeof r === "string") return r.slice(0, 200);
  if (depth >= 3) return null;
  if (Array.isArray(r)) return r.slice(0, 10).map((x) => limpiarResultado(x, depth + 1));
  if (typeof r === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
      if (SENSIBLE.test(k)) continue;
      out[k] = limpiarResultado(v, depth + 1);
    }
    return out;
  }
  return null;
}

/* ---------- Documentos ---------- */
export const TIPOS_REQUISITO = ["empresa", "representante", "constitutivo", "poder", "cuenta_bancaria", "estados_financieros"] as const;
export const MIME_EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export function validarArchivo(mime: string, tamano: number): string | null {
  if (!MIME_EXT[mime]) return "Sube un PDF, JPG o PNG.";
  if (!Number.isFinite(tamano) || tamano <= 0) return "El archivo está vacío.";
  if (tamano > MAX_DOC_BYTES) return "El archivo pesa más de 10 MB.";
  return null;
}
