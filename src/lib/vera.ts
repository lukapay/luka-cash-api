import { primerNombre } from "./niveles";
export const preguntasVera = [
  {
    p: "¿Cómo me afilio a Luka Cash?",
    r: "Desde el portal de tu proveedor, donde verás el sello Negocio Precalificado. Aceptas los términos y confirmas con un código de 5 dígitos.",
  },
  {
    p: "¿Precalificado es lo mismo que aprobado?",
    r: "No. Cada solicitud de financiamiento está sujeta a aprobación.",
  },
  {
    p: "¿Cómo funcionan las cuotas?",
    r: "Pagas la Cuota 1 hoy y el resto cada 30 días. Las cuotas suman el monto de la factura.",
  },
  {
    p: "¿Qué es Paga después?",
    r: "Pagas la factura completa en un solo pago a 30, 45 o 60 días.",
  },
  {
    p: "¿Qué es el cargo financiero?",
    r: "Es lo que cuesta financiar tu factura. Se paga aparte, el día del financiamiento, y lo ves antes de confirmar.",
  },
  {
    p: "¿Cómo subo de nivel?",
    r: "Completando los documentos de tu empresa y pagando tus cuotas a tiempo.",
  },
] as const;
export const sugerenciasVera = [
  "¿Cómo funcionan las cuotas?",
  "¿Qué es Paga después?",
  "¿Cómo subo de nivel?",
  "¿Qué es el cargo financiero?",
  "Tengo un problema con un pago",
];
export const soporteVera =
  "Para eso te conecto con una persona del equipo de soporte. Escríbenos a support@lukapay.io y te respondemos.";
export function respuestaVera(texto: string): string {
  const t = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/paga\s+despues/.test(t)) return preguntasVera[3].r;
  if (/\bcargo\b/.test(t)) return preguntasVera[4].r;
  if (/\bcuotas?\b/.test(t)) return preguntasVera[2].r;
  if (/\bnivel(?:es)?\b/.test(t)) return preguntasVera[5].r;
  if (/\bafili\w*/.test(t)) return preguntasVera[0].r;
  if (/precalific|aprobad/.test(t)) return preguntasVera[1].r;
  if (/\bpago(?:s)?\b|\bpagar\b/.test(t))
    return "Puedes revisar tus cuotas en Pagos y pagar una factura desde Inicio. Si tienes un problema con un pago, escríbenos a support@lukapay.io para que el equipo lo revise.";
  if (/\bfacturas?\b/.test(t))
    return "Desde Inicio, selecciona Pagar una factura y elige tu proveedor. Las cuotas suman el monto de la factura; el cargo financiero se paga aparte y lo ves antes de confirmar.";
  if (/\bpedido(?:s)?\b/.test(t))
    return "Desde Inicio, selecciona Hacer un pedido y elige tu proveedor. En Pedidos puedes revisar tus pedidos en curso y anteriores.";
  return soporteVera;
}
export function saludoVera(nombre?: string | null) {
  const n = primerNombre(nombre);
  return `Hola${n ? `, ${n}` : ""}. Soy Vera, de Luka Cash. ¿En qué te ayudo hoy?`;
}
export interface MensajeVera {
  id: string;
  role: "user" | "assistant";
  parts: { type: "text"; text: string }[];
  fecha: string;
}
const prefijo = "luka-cash-vera:";
export const claveVera = (cuenta: string) => prefijo + cuenta;
export function nuevoMensajeVera(role: MensajeVera["role"], text: string): MensajeVera {
  return {
    id: crypto.randomUUID(),
    role,
    parts: [{ type: "text", text }],
    fecha: new Date().toISOString(),
  };
}
export function guardarVera(storage: Storage, cuenta: string, mensajes: MensajeVera[]) {
  storage.setItem(claveVera(cuenta), JSON.stringify(mensajes));
}
export function recuperarVera(storage: Storage, cuenta: string): MensajeVera[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(claveVera(cuenta)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (m): m is MensajeVera =>
        m &&
        typeof m.id === "string" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.fecha === "string" &&
        Number.isFinite(Date.parse(m.fecha)) &&
        Array.isArray(m.parts) &&
        m.parts.length > 0 &&
        m.parts.every(
          (p: { type?: unknown; text?: unknown }) =>
            p?.type === "text" && typeof p.text === "string",
        ),
    );
  } catch {
    return [];
  }
}
export function limpiarVera(storage: Storage) {
  const claves = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const c of claves) if (c?.startsWith(prefijo)) storage.removeItem(c);
}
export const avisoFaqVera = "Ahora respondo con las preguntas frecuentes.";
/** cid aleatorio de la conversación, guardado junto a ella. */
export function cidVera(storage: Storage, cuenta: string): string {
  const k = claveVera(cuenta) + ":cid";
  const prev = storage.getItem(k);
  if (prev && /^[A-Za-z0-9_-]{8,64}$/.test(prev)) return prev;
  const cid = crypto.randomUUID().replace(/-/g, "");
  storage.setItem(k, cid);
  return cid;
}
/** Historial para el servicio, sin el saludo inicial. */
export function historialVera(mensajes: MensajeVera[]) {
  const sinSaludo = mensajes[0]?.role === "assistant" ? mensajes.slice(1) : mensajes;
  return sinSaludo.map((m) => ({ role: m.role, content: m.parts.map((p) => p.text).join("") }));
}
/**
 * Respuesta de Vera: remota si responde bien; si no, preguntas frecuentes,
 * anteponiendo el aviso una sola vez por conversación.
 */
export async function responderVera(
  texto: string,
  remoto: () => Promise<{ reply: string; degradado: boolean } | null>,
  yaAvisado: boolean,
): Promise<{ texto: string; avisado: boolean }> {
  let r: { reply: string; degradado: boolean } | null = null;
  try {
    r = await remoto();
  } catch {
    r = null;
  }
  if (r && !r.degradado && r.reply.trim()) return { texto: r.reply, avisado: yaAvisado };
  const local = respuestaVera(texto);
  return yaAvisado ? { texto: local, avisado: true } : { texto: `${avisoFaqVera}\n\n${local}`, avisado: true };
}
