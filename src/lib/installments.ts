export type EstadoCuota = "pagada" | "vencida" | "por_vencer" | "pendiente";

export interface ProveedorRef { id: string; nombre: string; logo_url: string | null }

export interface Cuota {
  id: string;
  numero: number;
  fecha_vencimiento: string; // YYYY-MM-DD
  monto: number;
  estado: "pendiente" | "pagada";
  pagada_at?: string | null;
}

export interface Factura {
  id: string;
  factura_numero: string;
  modalidad: "cuotas" | "paga_despues";
  plazo_dias: number;
  moneda?: string;
  monto_factura: number;
  proveedor?: ProveedorRef;
  cuotas: Cuota[];
}

function dias(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`) - Date.parse(`${desde.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

/** Estado mostrado de una cuota según la fecha de hoy (YYYY-MM-DD). */
export function estadoCuota(c: Pick<Cuota, "estado" | "fecha_vencimiento">, hoy: string): EstadoCuota {
  if (c.estado === "pagada") return "pagada";
  const d = dias(hoy, c.fecha_vencimiento);
  if (d < 0) return "vencida";
  if (d <= 3) return "por_vencer";
  return "pendiente";
}

export const ESTADO_LABEL: Record<EstadoCuota, string> = {
  pagada: "Pagada",
  pendiente: "Pendiente",
  por_vencer: "Por vencer",
  vencida: "Vencida",
};

const URGENCIA: Record<EstadoCuota, number> = { vencida: 3, por_vencer: 2, pendiente: 1, pagada: 0 };

export function estadoMasUrgente(f: Factura, hoy: string): EstadoCuota {
  return f.cuotas.map((c) => estadoCuota(c, hoy)).reduce<EstadoCuota>(
    (a, b) => (URGENCIA[b] > URGENCIA[a] ? b : a), "pagada");
}

export const pendientesOrdenadas = (f: Factura) =>
  f.cuotas.filter((c) => c.estado === "pendiente").sort((a, b) => a.numero - b.numero);

export const estaSaldada = (f: Factura) => f.cuotas.every((c) => c.estado === "pagada");

/**
 * Las cuotas pendientes se eligen en orden: la selección es siempre un prefijo
 * de las pendientes, representado por cuántas están elegidas.
 * Tocar una elegida la desmarca junto con las siguientes; tocar una sin elegir
 * marca todas hasta ella.
 */
export function toggleSeleccion(elegidas: number, indice: number): number {
  return indice < elegidas ? indice : indice + 1;
}

export const seleccionInicial = (f: Factura) => (pendientesOrdenadas(f).length > 0 ? 1 : 0);

export function sumaSeleccion(f: Factura, elegidas: number): number {
  const total = pendientesOrdenadas(f).slice(0, elegidas).reduce((s, c) => s + Math.round(c.monto * 100), 0);
  return total / 100;
}

export function avance(f: Factura): string {
  const pagadas = f.cuotas.filter((c) => c.estado === "pagada").length;
  return `${pagadas} de ${f.cuotas.length} pagadas`;
}
