// Reglas puras de la ruta /vera: qué se acepta del cliente y qué se envía al servicio.
import { primerNombre } from "../lib/niveles";
import { conocimientoVera } from "../lib/vera-conocimiento";

export interface MensajeRemoto { role: "user" | "assistant"; content: string }
const CID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function limpiarEntradaVera(b: unknown): { messages: MensajeRemoto[]; cid: string } | null {
  const o = (b && typeof b === "object" ? b : {}) as { cid?: unknown; messages?: unknown };
  const cid = typeof o.cid === "string" && CID_RE.test(o.cid) ? o.cid : null;
  if (!cid || !Array.isArray(o.messages)) return null;
  const messages = o.messages
    .filter((m): m is { role: string; content: string } =>
      !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .slice(-20)
    .map((m) => ({ role: m.role as MensajeRemoto["role"], content: m.content.slice(0, 2000) }));
  if (!messages.length) return null;
  return { messages, cid };
}

export function nombreVera(acepta_nombre: string | null | undefined): string | null {
  return primerNombre(acepta_nombre)?.slice(0, 40) ?? null;
}

export function cuerpoVera(nombre: string | null, cid: string, messages: MensajeRemoto[]) {
  return { producto: "luka-cash", nombre, cid, conocimiento: conocimientoVera(), messages };
}
