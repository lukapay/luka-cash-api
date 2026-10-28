// Reglas puras de la integración con el portal de pagos (compartidas por servidor y pruebas).

/** El portal productivo (lukapay.me / lukapay.io) no usa este demo hasta el OK del owner. */
export function isBlockedPortalOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const h = new URL(origin).hostname.toLowerCase();
    return /(^|\.)lukapay\.(me|io)$/.test(h);
  } catch {
    return false;
  }
}

export function findEmail(obj: unknown, depth = 0): string | null {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "string" && /^e-?mail$|correo/i.test(k) && v.includes("@")) return v;
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const f = findEmail(v, depth + 1);
    if (f) return f;
  }
  return null;
}

export type PortalCheck =
  | { ok: true; user: unknown }
  | { ok: false; status: 401 | 502; error: string; mensaje: string; httpPayco?: number };

/** Verifica X-Portal-Token contra GET {base}/portalpagos/user y exige que el correo coincida. */
export async function checkPortalToken(
  token: string | null, email: string, base: string, fetcher: typeof fetch = fetch,
): Promise<PortalCheck> {
  if (!token) return { ok: false, status: 401, error: "sin_portal", mensaje: "Falta la sesión del portal." };
  let user: unknown;
  try {
    const res = await fetcher(`${base.replace(/\/$/, "")}/portalpagos/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, status: 401, error: "portal_invalido", mensaje: "La sesión del portal no es válida.", httpPayco: res.status };
    user = await res.json();
  } catch {
    return { ok: false, status: 502, error: "portal_error", mensaje: "No pudimos verificar la sesión del portal." };
  }
  const found = String(findEmail(user) ?? "").trim().toLowerCase();
  if (!found || found !== email.trim().toLowerCase()) {
    return { ok: false, status: 401, error: "correo_no_coincide", mensaje: "El correo no coincide con la sesión del portal." };
  }
  return { ok: true, user };
}

export interface CuotaPortal { numero: number; fecha_vencimiento: string; monto: number; estado: string; pagada_at?: string | null; pago_id_link?: string | null }

const DAY = 86400000;
const dia = (f: string) => Date.parse(`${f.slice(0, 10)}T00:00:00Z`);

/**
 * Las cuotas suman el monto de la factura (tolerancia 0,05). El cargo financiero se paga aparte hoy
 * y vive en cargo_pct / cargo_monto del plan; nunca es una cuota.
 * cuotas: 2 a 4 filas consecutivas desde 1, Cuota 1 pagada, el resto pendiente, cada 15 días.
 * paga_despues: una sola fila pendiente por el monto completo.
 */
export function validarCuotasPlan(cuotas: CuotaPortal[], plan: { modalidad: string; monto_factura: number }): string | null {
  if (!Array.isArray(cuotas) || !cuotas.length) return "El plan no tiene cuotas.";
  const orden = [...cuotas].sort((a, b) => a.numero - b.numero);
  for (let i = 0; i < orden.length; i++) {
    const c = orden[i]!;
    if (c.numero !== i + 1) return "Las cuotas deben ser consecutivas desde 1.";
    if (!(Number.isFinite(c.monto) && c.monto > 0)) return `El monto de la cuota ${c.numero} no es válido.`;
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(c.fecha_vencimiento)) || Number.isNaN(dia(c.fecha_vencimiento))) return `La fecha de la cuota ${c.numero} no es válida.`;
  }
  if (plan.modalidad === "cuotas") {
    if (orden.length < 2 || orden.length > 4) return "En Cuotas el plan lleva de 2 a 4 cuotas.";
    if (orden[0]!.estado !== "pagada") return "La Cuota 1 debe venir pagada.";
    for (let i = 1; i < orden.length; i++) {
      if (orden[i]!.estado !== "pendiente") return `La cuota ${i + 1} debe venir pendiente.`;
      if (dia(orden[i]!.fecha_vencimiento) - dia(orden[i - 1]!.fecha_vencimiento) !== 15 * DAY) return "Las cuotas van cada 15 días.";
    }
  } else if (plan.modalidad === "paga_despues") {
    if (orden.length !== 1) return "En Paga después el plan lleva una sola cuota.";
    if (orden[0]!.estado !== "pendiente") return "En Paga después la cuota debe venir pendiente.";
  } else {
    return "Modalidad no válida.";
  }
  const suma = orden.reduce((s, c) => s + Math.round(c.monto * 100), 0) / 100;
  if (Math.abs(suma - plan.monto_factura) > 0.05) return "La suma de las cuotas no coincide con el monto de la factura.";
  return null;
}

/** Plazos válidos por modalidad: Cuotas 15/30/45 (cuotas cada 15 días); Paga después 30/45/60 (pago único). */
export function validarPlazo(modalidad: string, plazoDias: number): string | null {
  if (modalidad === "cuotas") return [15, 30, 45].includes(plazoDias) ? null : "En Cuotas el plazo es de 15, 30 o 45 días.";
  if (modalidad === "paga_despues") return [30, 45, 60].includes(plazoDias) ? null : "En Paga después el plazo es de 30, 45 o 60 días.";
  return "Modalidad no válida.";
}

export interface PlanStore {
  find(affiliationId: string, facturaIdLink: string): Promise<{ id: string } | null>;
  insert(): Promise<{ id: string } | { conflict: true }>;
}

/** Idempotente por (affiliation_id, factura_id_link): si ya existe devuelve el mismo plan. */
export async function crearPlanIdempotente(store: PlanStore, affiliationId: string, facturaIdLink: string) {
  const prev = await store.find(affiliationId, facturaIdLink);
  if (prev) return { plan_id: prev.id, existente: true };
  const ins = await store.insert();
  if ("conflict" in ins) {
    const again = await store.find(affiliationId, facturaIdLink);
    if (again) return { plan_id: again.id, existente: true };
    throw new Error("conflicto");
  }
  return { plan_id: ins.id, existente: false };
}
