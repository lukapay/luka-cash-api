const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

/** 293371.97 -> "Bs. 293.371,97" */
export function formatBs(n: number): string {
  const neg = n < 0;
  const [ent, dec] = Math.abs(n).toFixed(2).split(".");
  const miles = (ent ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}Bs. ${miles},${dec}`;
}

function parts(iso: string): [number, number, number] {
  const [y = 0, m = 1, d = 1] = iso.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

/** "2026-11-04" -> "4 noviembre 2026" */
export function fechaLarga(iso: string): string {
  const [y, m, d] = parts(iso);
  return `${d} ${MESES[m - 1] ?? ""} ${y}`;
}

/** "2026-11-15" -> "15 NOV" */
export function fechaCorta(iso: string): string {
  const [, m, d] = parts(iso);
  return `${String(d).padStart(2, "0")} ${MESES_CORTOS[m - 1] ?? ""}`;
}

/** "2026-11-18" -> "18 nov" */
export function fechaDiaMes(iso: string): string {
  const [, m, d] = parts(iso);
  return `${d} ${(MESES[m - 1] ?? "").slice(0, 3)}`;
}

/** "administracion@tubodega.example" -> "a***n@tubodega.example" */
export function maskEmail(email: string): string {
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (!domain || !local) return "***";
  const tail = local.length > 2 ? local.slice(-1) : "";
  return `${local.charAt(0)}***${tail}@${domain}`;
}

/** Fecha de hoy en Caracas, YYYY-MM-DD. */
export function hoyCaracas(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(now);
}

/** Monto según moneda: VES con formato venezolano, USD con punto decimal. */
export function formatMonto(n: number, moneda = "VES"): string {
  if (moneda !== "USD") return formatBs(n);
  return formatUSD(n);
}

/** Dólares con separadores venezolanos. */
export function formatUSD(n: number): string {
  return formatBs(n).replace("Bs. ", "$");
}
