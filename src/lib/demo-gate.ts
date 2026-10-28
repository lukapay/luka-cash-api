// Regla de disponibilidad de la demo, sin imports de assets: la usan cliente y servidor.
import { DOMINIOS_PRODUCCION } from "../config";

/** Disponible por exclusión, independiente del nombre o del proveedor de la vista previa. */
export function isDemoAllowed(loc: { hostname: string; protocol: string }, native: boolean, dominiosProduccion: readonly string[] = DOMINIOS_PRODUCCION): boolean {
  if (native || loc.protocol === "capacitor:") return false;
  const h = loc.hostname.toLowerCase().replace(/\.$/, "");
  if (h.endsWith("luka.cash")) return false;
  return !dominiosProduccion.some((dominio) => {
    const d = dominio.toLowerCase().replace(/\.$/, "");
    return h === d || h.endsWith(`.${d}`);
  });
}

