// Lógica de la API de Luka Cash sobre PostgreSQL (DigitalOcean).
// Port de src/lib/luka/handlers.server.ts de la app (Lovable 1.11.1): mismas reglas, mismas respuestas,
// salvo que la sesión es propia (luka_cash_sessions) en lugar de Supabase Auth: code-verify devuelve session_token.
import { jsonResponse } from "./cors";
import { sql } from "./db";
import { AMBIENTE, APP_PUBLIC_URL, DOMINIOS_PRODUCCION, LUKA_AUTH_URL, PAYCO_API_BASE, SESSION_DAYS, TERMINOS_VERSION, VERA_API_URL } from "./config";
import { avisarPreonboarding, enviarCodigo, mailConfigurado } from "./mail";
import { borrarObjeto, infoObjeto, urlSubida } from "./storage";
import { estadoCuota } from "./lib/installments";
import { hoyCaracas, maskEmail } from "./lib/format";
import { isDemoAllowed } from "./lib/demo-gate";
import { checkPortalToken, crearPlanIdempotente, validarCuotasPlan, validarPlazo, type CuotaPortal } from "./luka/portal";
import {
  armarReferencia, cuerpoLink, leerResultado, limpiarResultado, MIME_EXT, siguienteEstado, sumarMontos,
  TIPOS_REQUISITO, validarArchivo, validarOrdenPago, type EstadoPago,
} from "./luka/payments";
import { cuerpoVera, limpiarEntradaVera, nombreVera } from "./luka/vera-remota";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const TEN_MIN = 10 * 60 * 1000;
const TICKET_MS = 15 * 60 * 1000;
const REQUISITOS = ["empresa", "representante", "constitutivo", "poder", "cuenta_bancaria", "estados_financieros"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC_OK = { enviado: true, mensaje: "Si el correo tiene Luka Cash, te enviamos un código." };
const SIN_INVITACION = { enviado: false, sin_invitacion: true, mensaje: "Por ahora el acceso es por invitación." };
const LIMITE_CONSULTAS_IP = 10;

/* ---------- utilidades ---------- */
export async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function opaqueToken(bytes = 24): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}
function fiveDigits(): string {
  return ((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 100000).toString().padStart(5, "0");
}
const normalizeEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
/** Detrás de nginx: la IP real llega en X-Real-IP / X-Forwarded-For (nginx los pone; el cliente no). */
/**
 * IP del visitante. Detrás de nginx llega en X-Real-IP. Si la llamada viene de un servidor propio que hace de intermediario
 * (p. ej. el de luka.cash, que llama desde la IP del droplet), ese servidor manda la IP real del visitante en
 * X-Luka-Visitor-IP junto con X-Luka-Proxy-Key; solo se cree si la llave coincide con EDGE_PROXY_KEY.
 */
export const clientIp = (r: Request) => {
  const key = process.env["EDGE_PROXY_KEY"];
  const visitor = r.headers.get("x-luka-visitor-ip")?.trim();
  if (key && key.length >= 32 && visitor && r.headers.get("x-luka-proxy-key") === key && /^[0-9a-f:.]{3,45}$/i.test(visitor)) return visitor;
  return r.headers.get("x-real-ip") ?? r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
};
const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

async function readJson(r: Request): Promise<Row> {
  try {
    const b = await r.json();
    return b && typeof b === "object" ? (b as Row) : {};
  } catch {
    return {};
  }
}
const bad = (r: Request, error: string, mensaje: string, status = 400) => jsonResponse(r, { error, mensaje }, status);

/** Traza. Nunca incluir códigos ni tokens en `detalle`. */
async function logEvent(r: Request, tipo: string, affiliation_id: string | null, detalle: Row = {}) {
  await sql()`insert into luka_cash.luka_cash_events (tipo, affiliation_id, detalle, ip)
    values (${tipo}, ${affiliation_id}, ${sql().json(detalle)}, ${clientIp(r)})`;
}

async function contarEventos(tipo: string, campo: "ip" | "affiliation_id", valores: string[], desdeMs: number): Promise<number> {
  if (!valores.length) return 0;
  const desde = new Date(Date.now() - desdeMs);
  const [row] = campo === "ip"
    ? await sql()`select count(*)::int n from luka_cash.luka_cash_events where tipo = ${tipo} and ip = ${valores[0]!} and created_at >= ${desde}`
    : await sql()`select count(*)::int n from luka_cash.luka_cash_events where tipo = ${tipo} and affiliation_id = any(${valores}::uuid[]) and created_at >= ${desde}`;
  return row?.n ?? 0;
}

async function resolveTicket(ticket: unknown): Promise<Row | null> {
  if (typeof ticket !== "string" || ticket.length < 10) return null;
  const [h] = await sql()`select affiliation_id, ticket_expira_at from luka_cash.luka_cash_handoffs where ticket_hash = ${await sha256(ticket)}`;
  if (!h?.ticket_expira_at || new Date(h.ticket_expira_at).getTime() < Date.now()) return null;
  const [af] = await sql()`select * from luka_cash.luka_cash_affiliations where id = ${h.affiliation_id}`;
  return af ?? null;
}

/* ---------- sesiones propias ---------- */
type Alcance = "app" | "early_access";

async function crearSesion(r: Request, email: string, alcance: Alcance = "app"): Promise<{ token: string; userId: string; expira: Date }> {
  const [u] = await sql()`insert into luka_cash.luka_cash_users (email) values (${email})
    on conflict (email) do update set email = excluded.email returning id`;
  const token = opaqueToken(32);
  const expira = new Date(Date.now() + SESSION_DAYS * 86400000);
  await sql()`insert into luka_cash.luka_cash_sessions (user_id, token_hash, expires_at, ip, user_agent, alcance)
    values (${u!.id}, ${await sha256(token)}, ${expira}, ${clientIp(r)}, ${r.headers.get("user-agent")?.slice(0, 400) ?? null}, ${alcance})`;
  return { token, userId: u!.id, expira };
}

/**
 * Usuario de la sesión del header Authorization, o null. Renueva last_used_at y extiende el vencimiento.
 * Por defecto solo vale una sesión de alcance "app": una sesión de Early Access nunca abre rutas de la app.
 */
async function usuarioDeSesion(r: Request, alcance: Alcance | "cualquiera" = "app"): Promise<{ id: string; email: string; alcance: Alcance; expira: Date } | null> {
  const auth = r.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (token.length < 20 || token.length > 200) return null;
  const [s] = await sql()`select s.id, s.alcance, u.id user_id, u.email from luka_cash.luka_cash_sessions s
    join luka_cash.luka_cash_users u on u.id = s.user_id
    where s.token_hash = ${await sha256(token)} and s.revoked_at is null and s.expires_at > now()`;
  if (!s) return null;
  if (alcance !== "cualquiera" && s.alcance !== alcance) return null;
  if (s.alcance === "early_access") {
    // Un invitado revocado pierde la sesión al instante.
    const [ea] = await sql()`select 1 from luka_cash.luka_cash_early_access where email = ${s.email} and revoked_at is null`;
    if (!ea) return null;
  }
  const [upd] = await sql()`update luka_cash.luka_cash_sessions set last_used_at = now(),
    expires_at = greatest(expires_at, now() + make_interval(days => ${SESSION_DAYS})) where id = ${s.id} returning expires_at`;
  return { id: s.user_id, email: s.email, alcance: s.alcance as Alcance, expira: new Date(upd!.expires_at) };
}

async function activeMember(r: Request): Promise<{ userId: string; affIds: string[] } | Response> {
  const u = await usuarioDeSesion(r);
  if (!u) return bad(r, "sin_sesion", "Tu sesión terminó.", 401);
  const afs = await sql()`select a.id from luka_cash.luka_cash_members m
    join luka_cash.luka_cash_affiliations a on a.id = m.affiliation_id
    where m.user_id = ${u.id} and a.estado = 'activa' order by a.created_at`;
  if (!afs.length) return bad(r, "sin_afiliacion", "Tu cuenta Luka Cash no está activa.", 403);
  return { userId: u.id, affIds: afs.map((a) => a.id as string) };
}

/* ---------- portal ---------- */
function fieldNames(obj: unknown, prefix = "", depth = 0): string[] {
  if (!obj || typeof obj !== "object" || depth > 3) return [];
  return Object.entries(obj as Row).flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v) ? [p, ...fieldNames(v, p, depth + 1)] : [p];
  });
}

async function verifyPortal(r: Request, email: string): Promise<unknown | Response> {
  const v = await checkPortalToken(r.headers.get("x-portal-token"), email, PAYCO_API_BASE);
  if (!v.ok) {
    await logEvent(r, "portal_rechazado", null, { motivo: v.error, http: v.httpPayco ?? null });
    return bad(r, v.error, v.mensaje, v.status);
  }
  const [c] = await sql()`select count(*)::int n from luka_cash.luka_cash_events where tipo = 'payco_campos'`;
  if (!c?.n) await logEvent(r, "payco_campos", null, { campos: fieldNames(v.user) });
  return v.user;
}

/* ---------- handoff ---------- */
/* ---------- precalificación por RIF ---------- */
/** RIF activos precalificados para un correo. */
export async function rifsPrecalificados(email: string): Promise<{ rif: string; razon_social: string | null }[]> {
  const rows = await sql()`select rif, razon_social from luka_cash.luka_cash_precalificados where email = ${email} and activo order by rif`;
  return rows.map((x) => ({ rif: x.rif as string, razon_social: (x.razon_social as string | null) ?? null }));
}

/** POST portal-eligibility (X-Portal-Token): qué RIF puede afiliar este correo y si el comercio ya está afiliado. */
async function portalEligibility(r: Request) {
  const b = await readJson(r);
  const proveedor = str(b.proveedor, 80), id_cliente = str(b.id_cliente, 120), email = normalizeEmail(b.email);
  if (!proveedor || !id_cliente || !EMAIL_RE.test(email)) return bad(r, "datos_invalidos", "Faltan datos o el correo no es válido.");
  const v = await verifyPortal(r, email);
  if (v instanceof Response) return v;
  const [af] = await sql()`select rif, estado from luka_cash.luka_cash_affiliations where proveedor = ${proveedor} and id_cliente = ${id_cliente}`;
  const rifs = await rifsPrecalificados(email);
  return jsonResponse(r, { rifs, afiliado: af?.estado === "activa", rif: af?.estado === "activa" ? af.rif : null });
}

async function handoffCreate(r: Request) {
  if (r.method !== "POST") return bad(r, "metodo", "Método no permitido.", 405);
  const b = await readJson(r);
  const proveedor = str(b.proveedor, 80), id_cliente = str(b.id_cliente, 120);
  const rif = normalizarRif(b.rif) ?? str(b.rif, 20).toUpperCase();
  let razon_social = str(b.razon_social, 200);
  const email = normalizeEmail(b.email), acepta_nombre = str(b.acepta_nombre, 120) || null;
  const proveedor_nombre = str(b.proveedor_nombre, 120) || null;
  const logo = str(b.proveedor_logo_url, 500);
  const proveedor_logo_url = /^https:\/\//.test(logo) ? logo : null;
  if (!proveedor || !id_cliente || !rif || !razon_social || !EMAIL_RE.test(email)) return bad(r, "datos_invalidos", "Faltan datos o el correo no es válido.");
  const v = await verifyPortal(r, email);
  if (v instanceof Response) return v;

  const [existing] = await sql()`select id, estado from luka_cash.luka_cash_affiliations where proveedor = ${proveedor} and id_cliente = ${id_cliente}`;
  // Precalificación (owner, 29-oct): una afiliación nueva o no activa solo se crea con un RIF precalificado para ese correo.
  // La razón social sale de la tabla de precalificados cuando la tiene. Las afiliaciones ya activas no cambian.
  if (existing?.estado !== "activa") {
    const pre = (await rifsPrecalificados(email)).find((x) => x.rif === rif);
    if (!pre) {
      await logEvent(r, "handoff_rif_no_precalificado", existing?.id ?? null, { proveedor });
      return bad(r, "rif_no_precalificado", "Este RIF no está precalificado para Luka Cash.", 403);
    }
    if (pre.razon_social) razon_social = pre.razon_social;
  }
  let affiliationId: string;
  if (existing) {
    affiliationId = existing.id;
    if (existing.estado !== "activa") {
      await sql()`update luka_cash.luka_cash_affiliations set rif = ${rif}, razon_social = ${razon_social}, email = ${email}, acepta_nombre = ${acepta_nombre} where id = ${existing.id}`;
    }
    await sql()`update luka_cash.luka_cash_affiliations set proveedor_nombre = coalesce(${proveedor_nombre}, proveedor_nombre),
      proveedor_logo_url = coalesce(${proveedor_logo_url}, proveedor_logo_url) where id = ${existing.id}`;
  } else {
    const [ins] = await sql()`insert into luka_cash.luka_cash_affiliations (proveedor, id_cliente, rif, razon_social, email, acepta_nombre, estado, proveedor_nombre, proveedor_logo_url)
      values (${proveedor}, ${id_cliente}, ${rif}, ${razon_social}, ${email}, ${acepta_nombre}, 'precalificado', ${proveedor_nombre}, ${proveedor_logo_url}) returning id`;
    affiliationId = ins!.id;
  }
  const h = opaqueToken();
  await sql()`insert into luka_cash.luka_cash_handoffs (codigo, affiliation_id, expira_at) values (${await sha256(h)}, ${affiliationId}, ${new Date(Date.now() + TEN_MIN)})`;
  await logEvent(r, "handoff_creado", affiliationId, { proveedor, nueva: !existing });
  return jsonResponse(r, { url: `${APP_PUBLIC_URL}/activar?h=${encodeURIComponent(h)}` });
}

async function handoffRedeem(r: Request) {
  const { h } = await readJson(r);
  const invalid = () => bad(r, "enlace_invalido", "Este enlace ya no sirve.", 410);
  if (typeof h !== "string" || h.length < 10 || h.length > 200) return invalid();
  const [row] = await sql()`select codigo, affiliation_id, expira_at, usado_at from luka_cash.luka_cash_handoffs where codigo = ${await sha256(h)}`;
  if (!row || row.usado_at || new Date(row.expira_at).getTime() < Date.now()) {
    await logEvent(r, "handoff_rechazado", row?.affiliation_id ?? null, { motivo: !row ? "no_existe" : row.usado_at ? "usado" : "vencido" });
    return invalid();
  }
  const [af] = await sql()`select razon_social, rif, proveedor, email, estado, acepta_nombre from luka_cash.luka_cash_affiliations where id = ${row.affiliation_id}`;
  if (!af) return invalid();
  const ticket = opaqueToken();
  await sql()`update luka_cash.luka_cash_handoffs set usado_at = now(), ticket_hash = ${await sha256(ticket)},
    ticket_expira_at = ${new Date(Date.now() + TICKET_MS)} where codigo = ${row.codigo}`;
  await logEvent(r, "handoff_canjeado", row.affiliation_id, { estado: af.estado });
  return jsonResponse(r, {
    razon_social: af.razon_social, rif: af.rif, proveedor: af.proveedor, email_enmascarado: maskEmail(af.email),
    estado: af.estado, acepta_nombre: af.acepta_nombre, handoff_ticket: ticket,
  });
}

/* ---------- código de acceso ---------- */
async function codeSend(r: Request) {
  const b = await readJson(r);
  let email: string, affiliationId: string | null, proposito: "activar" | "entrar", nombre: string | null = null;
  if (b.handoff_ticket) {
    const af = await resolveTicket(b.handoff_ticket);
    if (!af) return bad(r, "ticket_invalido", "Este enlace ya no sirve.", 410);
    email = af.email; affiliationId = af.id; nombre = af.acepta_nombre;
    proposito = af.estado === "activa" ? "entrar" : "activar";
  } else {
    email = normalizeEmail(b.email);
    proposito = "entrar";
    if (!EMAIL_RE.test(email) || email.length > 254) return bad(r, "correo_invalido", "Escribe un correo válido.");
    const ip = clientIp(r);
    if (ip && (await contarEventos("codigo_sin_afiliacion", "ip", [ip], 3600_000)) >= LIMITE_CONSULTAS_IP) {
      return bad(r, "limite_consultas", "Hiciste muchas consultas. Intenta de nuevo en una hora.", 429);
    }
    const [af] = await sql()`select id, acepta_nombre from luka_cash.luka_cash_affiliations where email = ${email} and estado = 'activa' order by created_at limit 1`;
    if (af) {
      affiliationId = af.id; nombre = af.acepta_nombre;
    } else {
      const ea = await invitadoEarlyAccess(email);
      if (!ea) {
        await logEvent(r, "codigo_sin_afiliacion", null, {});
        return jsonResponse(r, SIN_INVITACION);
      }
      affiliationId = null; nombre = ea.nombre;
    }
  }

  const recent = await sql()`select created_at from luka_cash.luka_cash_codes where email = ${email} and created_at >= ${new Date(Date.now() - 3600_000)} order by created_at desc`;
  if (recent.length >= 5) return bad(r, "limite_hora", "Pediste muchos códigos. Intenta de nuevo en una hora.", 429);
  if (recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < 60_000) return bad(r, "limite_minuto", "Espera un minuto antes de pedir otro código.", 429);

  if (!mailConfigurado()) {
    await logEvent(r, "codigo_envio_fallido", affiliationId, { motivo: "correo_no_configurado" });
    return bad(r, "correo_no_configurado", "El envío de códigos no está configurado.", 503);
  }
  const code = fiveDigits();
  await sql()`update luka_cash.luka_cash_codes set usado_at = now() where email = ${email} and usado_at is null`;
  await sql()`insert into luka_cash.luka_cash_codes (email, codigo_hash, expira_at, proposito)
    values (${email}, ${await sha256(`${email}:${code}`)}, ${new Date(Date.now() + TEN_MIN)}, ${proposito})`;
  let messageId: string | null = null;
  try {
    messageId = await enviarCodigo(email, code, nombre);
  } catch (e) {
    console.error("[code-send] SES:", (e as Error).name, (e as Error).message);
    await logEvent(r, "codigo_envio_fallido", affiliationId, { motivo: "envio_fallido" });
    return bad(r, "envio_fallido", "No pudimos enviar el correo. Intenta de nuevo en unos minutos.", 503);
  }
  await logEvent(r, "codigo_enviado", affiliationId, { proposito, ses_message_id: messageId });
  console.log(`[code-send] SES aceptó ${messageId ?? "(sin id)"}`);
  return jsonResponse(r, GENERIC_OK);
}

async function codeVerify(r: Request) {
  const b = await readJson(r);
  const codigo = String(b.codigo ?? "");
  const proposito = b.proposito === "activar" ? "activar" : "entrar";
  if (!/^\d{5}$/.test(codigo)) return bad(r, "incorrecto", "El código tiene 5 dígitos.");

  let email: string, af: Row | undefined;
  if (b.handoff_ticket) {
    af = (await resolveTicket(b.handoff_ticket)) ?? undefined;
    if (!af) return bad(r, "ticket_invalido", "Este enlace ya no sirve.", 410);
    email = af.email;
  } else {
    email = normalizeEmail(b.email);
    [af] = await sql()`select * from luka_cash.luka_cash_affiliations where email = ${email} and estado = 'activa' order by created_at limit 1`;
    if (!af) {
      if (await invitadoEarlyAccess(email)) return verificarEarlyAccess(r, email, codigo);
      await logEvent(r, "verificacion_sin_afiliacion", null, {});
      return jsonResponse(r, { sin_sesion: true });
    }
  }

  const [row] = await sql()`select * from luka_cash.luka_cash_codes where email = ${email} order by created_at desc limit 1`;
  const sinIntentos = () => bad(r, "sin_intentos", "Agotaste los 3 intentos. Pide un código nuevo.");
  if (!row) return bad(r, "vencido", "El código venció. Pide uno nuevo.");
  if (row.intentos >= 3) return sinIntentos();
  if (row.usado_at) return bad(r, "usado", "Este código ya se usó. Pide uno nuevo.");
  if (new Date(row.expira_at).getTime() < Date.now()) return bad(r, "vencido", "El código venció. Pide uno nuevo.");
  if ((await sha256(`${email}:${codigo}`)) !== row.codigo_hash) {
    const intentos = row.intentos + 1;
    await sql()`update luka_cash.luka_cash_codes set intentos = ${intentos} where id = ${row.id}`;
    await logEvent(r, "codigo_incorrecto", af.id, { intentos });
    if (intentos >= 3) return sinIntentos();
    const q = 3 - intentos;
    return bad(r, "incorrecto", `Código incorrecto. Te ${q === 1 ? "queda 1 intento" : `quedan ${q} intentos`}.`);
  }

  if (proposito === "activar" && af.estado !== "activa") {
    const a = b.aceptacion as { terminos_version?: string; acepta?: boolean } | undefined;
    if (!a || a.acepta !== true || a.terminos_version !== TERMINOS_VERSION) return bad(r, "sin_aceptacion", "Debes aceptar los términos y condiciones.");
    await sql()`update luka_cash.luka_cash_affiliations set estado = 'activa', nivel = 1, origen_aceptacion = 'app',
      terminos_version = ${a.terminos_version}, aceptado_at = now(), aceptado_ip = ${clientIp(r)},
      aceptado_user_agent = ${r.headers.get("user-agent")?.slice(0, 400) ?? null} where id = ${af.id}`;
    await crearRequisitos(af.id);
    await logEvent(r, "afiliacion_activada", af.id, { terminos_version: a.terminos_version });
  }

  await sql()`update luka_cash.luka_cash_codes set usado_at = now() where id = ${row.id}`;
  if (b.handoff_ticket) {
    await sql()`update luka_cash.luka_cash_handoffs set ticket_expira_at = now() where ticket_hash = ${await sha256(String(b.handoff_ticket))}`;
  }
  const s = await crearSesion(r, email);
  await sql()`insert into luka_cash.luka_cash_members (user_id, affiliation_id) values (${s.userId}, ${af.id}) on conflict do nothing`;
  await logEvent(r, "entrada", af.id, { proposito });
  return jsonResponse(r, { session_token: s.token, expira_at: s.expira.toISOString(), alcance: "app" });
}

/* ---------- pre-onboarding de interesados (proveedores y comercios; el registro completo es en Luka) ---------- */
const LIMITE_PREONBOARDING_IP = 10;

/** WhatsApp en E.164. Venezuela (+58): móvil 4xx de 10 dígitos. Resto: de 8 a 15 dígitos. */
export function whatsappValido(w: string): boolean {
  if (!/^\+\d{8,15}$/.test(w)) return false;
  if (w.startsWith("+58")) return /^\+584\d{9}$/.test(w);
  return true;
}

/** RIF venezolano a J-12345678-9 (letras J, V, E, G, P, C; 8 + 1 dígitos), o null si no es válido. */
export function normalizarRif(v: unknown): string | null {
  const t = String(v ?? "").toUpperCase().replace(/[\s.\-]/g, "");
  const m = /^([JVEGPC])(\d{8})(\d)$/.exec(t);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 0 a 20 nombres, de 2 a 120 caracteres, recortados y sin duplicados (sin distinguir mayúsculas). */
export function limpiarProveedores(v: unknown): string[] | null {
  if (v == null) return [];
  if (!Array.isArray(v)) return null;
  const vistos = new Set<string>(), out: string[] = [];
  for (const x of v) {
    const n = String(x ?? "").trim().replace(/\s+/g, " ");
    if (n.length < 2 || n.length > 120) return null;
    const k = n.toLowerCase();
    if (!vistos.has(k)) { vistos.add(k); out.push(n); }
  }
  return out.length <= 20 ? out : null;
}

export function validarPreonboarding(b: Row): { error: string; campo?: string } | {
  tipo: "proveedor" | "comercio"; empresa: string; nombre: string; whatsapp: string; email: string; origen: "landing" | "early_access";
  rif: string | null; proveedores: string[];
} {
  const tipo = b.tipo === "proveedor" || b.tipo === "comercio" ? b.tipo : null;
  const empresa = str(b.empresa, 160), nombre = str(b.nombre, 120);
  const whatsapp = String(b.whatsapp ?? "").replace(/[\s()-]/g, "");
  const email = normalizeEmail(b.email);
  const origen = b.origen === "early_access" ? "early_access" : b.origen === "landing" || b.origen == null ? "landing" : null;
  if (!tipo) return { error: "datos_invalidos", campo: "tipo" };
  if (empresa.length < 2) return { error: "datos_invalidos", campo: "empresa" };
  if (nombre.length < 2) return { error: "datos_invalidos", campo: "nombre" };
  if (!whatsappValido(whatsapp)) return { error: "datos_invalidos", campo: "whatsapp" };
  if (!EMAIL_RE.test(email) || email.length > 254) return { error: "datos_invalidos", campo: "email" };
  if (!origen) return { error: "datos_invalidos", campo: "origen" };
  let rif: string | null = null;
  if (b.rif != null && String(b.rif).trim() !== "") {
    rif = normalizarRif(b.rif);
    if (!rif) return { error: "datos_invalidos", campo: "rif" };
  }
  const proveedores = limpiarProveedores(b.proveedores);
  if (!proveedores) return { error: "datos_invalidos", campo: "proveedores" };
  if (b.acepta_privacidad !== true) return { error: "sin_aceptacion" };
  return { tipo, empresa, nombre, whatsapp, email, origen, rif, proveedores };
}

const MENSAJE_CAMPO: Record<string, string> = {
  tipo: "Elige si eres proveedor o comercio.", empresa: "Escribe el nombre de la empresa.", nombre: "Escribe tu nombre.",
  whatsapp: "Escribe un WhatsApp válido con código de país.", email: "Escribe un correo válido.", origen: "Origen no válido.",
  rif: "Escribe un RIF válido, por ejemplo J-12345678-9.", proveedores: "Revisa la lista de proveedores (hasta 20).",
};

/** No crea empresas, afiliaciones ni usuarios: solo guarda el interés. */
async function preonboarding(r: Request) {
  const ip = clientIp(r);
  if (ip && (await contarEventos("preonboarding", "ip", [ip], 3600_000)) >= LIMITE_PREONBOARDING_IP) {
    return bad(r, "limite", "Hiciste muchos envíos. Intenta de nuevo en una hora.", 429);
  }
  const v = validarPreonboarding(await readJson(r));
  if ("error" in v) {
    if (v.error === "sin_aceptacion") return bad(r, "sin_aceptacion", "Debes aceptar la política de privacidad.");
    return jsonResponse(r, { error: "datos_invalidos", campo: v.campo, mensaje: MENSAJE_CAMPO[v.campo ?? ""] ?? "Revisa los datos." }, 400);
  }
  const [row] = await sql()`insert into luka_cash.luka_cash_preonboarding (tipo, empresa, nombre, whatsapp, email, acepta_privacidad_at, origen, ip, rif, proveedores)
    values (${v.tipo}, ${v.empresa}, ${v.nombre}, ${v.whatsapp}, ${v.email}, now(), ${v.origen}, ${ip}, ${v.rif}, ${v.proveedores}::text[])
    on conflict (tipo, lower(email)) do update set empresa = excluded.empresa, nombre = excluded.nombre, whatsapp = excluded.whatsapp,
      rif = excluded.rif, proveedores = excluded.proveedores,
      acepta_privacidad_at = excluded.acepta_privacidad_at, origen = excluded.origen, updated_at = now()
    returning (xmax = 0) nuevo`;
  await logEvent(r, "preonboarding", null, { tipo: v.tipo, origen: v.origen, nuevo: row?.nuevo ?? false });
  if (row?.nuevo) void avisarPreonboarding(v).catch((e) => console.error("[preonboarding] aviso a ventas:", (e as Error).name));
  return jsonResponse(r, { recibido: true, mensaje: "Recibimos tus datos. Te escribiremos pronto." });
}

/* ---------- Early Access (invitados de pre-lanzamiento) ---------- */
async function invitadoEarlyAccess(email: string): Promise<{ nombre: string | null } | null> {
  const [ea] = await sql()`select nombre from luka_cash.luka_cash_early_access where email = ${email} and revoked_at is null`;
  return ea ? { nombre: (ea.nombre as string | null) ?? null } : null;
}

/** Mismas reglas del código (5 dígitos, 10 min, 3 intentos); la sesión sale con alcance early_access. */
async function verificarEarlyAccess(r: Request, email: string, codigo: string) {
  const [row] = await sql()`select * from luka_cash.luka_cash_codes where email = ${email} order by created_at desc limit 1`;
  const sinIntentos = () => bad(r, "sin_intentos", "Agotaste los 3 intentos. Pide un código nuevo.");
  if (!row) return bad(r, "vencido", "El código venció. Pide uno nuevo.");
  if (row.intentos >= 3) return sinIntentos();
  if (row.usado_at) return bad(r, "usado", "Este código ya se usó. Pide uno nuevo.");
  if (new Date(row.expira_at).getTime() < Date.now()) return bad(r, "vencido", "El código venció. Pide uno nuevo.");
  if ((await sha256(`${email}:${codigo}`)) !== row.codigo_hash) {
    const intentos = row.intentos + 1;
    await sql()`update luka_cash.luka_cash_codes set intentos = ${intentos} where id = ${row.id}`;
    await logEvent(r, "codigo_incorrecto", null, { intentos, early_access: true });
    if (intentos >= 3) return sinIntentos();
    const q = 3 - intentos;
    return bad(r, "incorrecto", `Código incorrecto. Te ${q === 1 ? "queda 1 intento" : `quedan ${q} intentos`}.`);
  }
  await sql()`update luka_cash.luka_cash_codes set usado_at = now() where id = ${row.id}`;
  const s = await crearSesion(r, email, "early_access");
  await logEvent(r, "entrada_early_access", null, {});
  return jsonResponse(r, { session_token: s.token, expira_at: s.expira.toISOString(), alcance: "early_access" });
}

/** GET o POST con Bearer: { email, alcance, expira_at } o 401. Marca validated_at del invitado la primera vez. */
async function session(r: Request) {
  const u = await usuarioDeSesion(r, "cualquiera");
  if (!u) return bad(r, "sin_sesion", "La sesión no es válida.", 401);
  if (u.alcance === "early_access") {
    await sql()`update luka_cash.luka_cash_early_access set validated_at = now() where email = ${u.email} and validated_at is null`;
  }
  return jsonResponse(r, { email: u.email, alcance: u.alcance, expira_at: u.expira.toISOString() });
}

async function crearRequisitos(affiliationId: string) {
  for (const tipo of REQUISITOS) {
    await sql()`insert into luka_cash.luka_cash_requirements (affiliation_id, tipo, estado) values (${affiliationId}, ${tipo}, 'vacio') on conflict do nothing`;
  }
}

/** Cierra la sesión del header (la revoca en el servidor). */
async function sessionClose(r: Request) {
  const auth = r.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    await sql()`update luka_cash.luka_cash_sessions set revoked_at = now() where token_hash = ${await sha256(auth.slice(7).trim())} and revoked_at is null`;
  }
  return jsonResponse(r, { cerrada: true });
}

/* ---------- balance ---------- */
async function balance(r: Request) {
  const u = await usuarioDeSesion(r);
  if (!u) return bad(r, "sin_sesion", "Tu sesión terminó.", 401);
  const afs = await sql()`select a.id, a.razon_social, a.rif, a.email, a.proveedor, a.proveedor_nombre, a.proveedor_logo_url, a.nivel, a.estado, a.acepta_nombre
    from luka_cash.luka_cash_members m join luka_cash.luka_cash_affiliations a on a.id = m.affiliation_id
    where m.user_id = ${u.id} and a.estado = 'activa' order by a.created_at`;
  const af = afs[0];
  if (!af) return bad(r, "sin_afiliacion", "No encontramos tu cuenta Luka Cash.", 404);
  // La empresa se identifica por su RIF: se muestran todas sus afiliaciones activas donde el usuario es miembro.
  return jsonResponse(r, await balanceBody(afs.filter((x) => x.rif === af.rif)));
}

async function balanceBody(afs: Row[]) {
  const af = afs[0]!;
  const ids = afs.map((x) => x.id as string);
  const [reqs, plans, cuotas] = await Promise.all([
    sql()`select tipo, estado from luka_cash.luka_cash_requirements where affiliation_id = ${af.id}`,
    sql()`select * from luka_cash.luka_cash_plans where affiliation_id = any(${ids}::uuid[]) order by created_at desc`,
    sql()`select i.id, i.plan_id, i.numero, i.fecha_vencimiento::text fecha_vencimiento, i.monto, i.estado, i.pagada_at
      from luka_cash.luka_cash_installments i join luka_cash.luka_cash_plans p on p.id = i.plan_id
      where p.affiliation_id = any(${ids}::uuid[]) order by i.numero`,
  ]);
  const hoy = hoyCaracas();
  const proveedores = afs.map((x) => ({
    id: x.id, nombre: x.proveedor_nombre || x.proveedor, logo_url: x.proveedor_logo_url ?? null, nivel: x.nivel ?? 1, estado: x.estado ?? "activa",
  }));
  const provDe = new Map(proveedores.map((p) => [p.id, { id: p.id, nombre: p.nombre, logo_url: p.logo_url }]));
  return {
    afiliacion: { razon_social: af.razon_social, rif: af.rif, email: af.email, proveedor: af.proveedor, nivel: af.nivel ?? 1 },
    usuario: { nombre: af.acepta_nombre ?? null, rol: "owner" },
    proveedores,
    requisitos: { completos: reqs.filter((x) => x.estado === "aprobado" || x.estado === "en_revision").length, total: 6, items: [...reqs] },
    facturas: plans.map((p) => {
      const proveedor = provDe.get(p.affiliation_id);
      return {
        id: p.id, factura_numero: p.factura_numero, modalidad: p.modalidad, plazo_dias: p.plazo_dias, moneda: p.moneda,
        monto_factura: Number(p.monto_factura), proveedor,
        cuotas: cuotas.filter((c) => c.plan_id === p.id).map((c) => ({
          id: c.id, numero: c.numero, fecha_vencimiento: c.fecha_vencimiento, monto: Number(c.monto), estado: c.estado,
          pagada_at: c.pagada_at, estado_calculado: estadoCuota({ estado: c.estado, fecha_vencimiento: c.fecha_vencimiento }, hoy), proveedor,
        })),
      };
    }),
    hoy,
  };
}

async function planConCuotas(planId: string): Promise<{ plan: Row; cuotas: Row[] } | null> {
  const [plan] = await sql()`select * from luka_cash.luka_cash_plans where id = ${planId}`;
  if (!plan) return null;
  const cuotas = await sql()`select id, numero, fecha_vencimiento::text fecha_vencimiento, monto, estado from luka_cash.luka_cash_installments where plan_id = ${planId} order by numero`;
  return { plan, cuotas: cuotas.map((c) => ({ ...c, monto: Number(c.monto) })) };
}

/* ---------- pagos ---------- */
function providerError(r: Request, paso: string, status: number, mensaje: string) {
  return jsonResponse(r, { error: "proveedor", paso, http: status, mensaje: `${paso}: ${status ? `HTTP ${status}. ` : ""}${mensaje}`.slice(0, 400) }, 502);
}
async function providerMessage(res: Response): Promise<string> {
  const t = await res.text().catch(() => "");
  try {
    const j = JSON.parse(t);
    return String(j.message ?? j.mensaje ?? j.Mensaje ?? j.error ?? t).slice(0, 300);
  } catch {
    return t.slice(0, 300) || res.statusText;
  }
}

async function installmentsPay(r: Request) {
  const m = await activeMember(r);
  if (m instanceof Response) return m;
  const b = await readJson(r);
  const planId = String(b.plan_id ?? "");
  const ids: string[] = Array.isArray(b.installment_ids) ? b.installment_ids.map(String).slice(0, 50) : [];
  if (!UUID_RE.test(planId) || !ids.every((x) => UUID_RE.test(x))) return bad(r, "datos_invalidos", "Datos de pago no válidos.");
  const pc = await planConCuotas(planId);
  if (!pc || !m.affIds.includes(pc.plan.affiliation_id)) return bad(r, "no_encontrado", "No encontramos esta factura.", 404);
  const { plan, cuotas } = pc;
  const err = validarOrdenPago(cuotas as any, ids);
  if (err) return bad(r, "orden_invalido", err);

  const elegidas = cuotas.filter((c) => ids.includes(c.id));
  const monto = sumarMontos(elegidas.map((c) => c.monto));
  const referencia = armarReferencia(plan.modalidad, elegidas.map((c) => c.numero), cuotas.length, plan.factura_numero);
  const [af] = await sql()`select id_cliente, email from luka_cash.luka_cash_affiliations where id = ${plan.affiliation_id}`;
  const moneda = plan.moneda === "USD" ? "USD" : "VES";

  let token: string;
  try {
    const res = await fetch(LUKA_AUTH_URL, { method: "POST", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return providerError(r, "Token del comercio Luka", res.status, await providerMessage(res));
    const j: any = await res.json().catch(() => ({}));
    if (!j?.success || typeof j.token !== "string") return providerError(r, "Token del comercio Luka", res.status, "Respuesta sin token.");
    token = j.token;
  } catch (e) {
    return providerError(r, "Token del comercio Luka", 0, (e as Error).name === "TimeoutError" ? "Tiempo de espera agotado." : "No hubo respuesta.");
  }

  const body = cuerpoLink({ moneda, monto, referencia, idTraza: af!.id_cliente, email: af!.email });
  let idLink: string | null, nroOrden: string | null;
  try {
    const res = await fetch(`${PAYCO_API_BASE}/link/token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status !== 201) return providerError(r, "Creación del link", res.status, await providerMessage(res));
    idLink = res.headers.get("id-link");
    nroOrden = res.headers.get("nro-orden");
    if (!idLink) return providerError(r, "Creación del link", 201, "Falta la cabecera id-link.");
  } catch (e) {
    return providerError(r, "Creación del link", 0, (e as Error).name === "TimeoutError" ? "Tiempo de espera agotado." : "No hubo respuesta.");
  }

  const [pay] = await sql()`insert into luka_cash.luka_cash_payments (affiliation_id, plan_id, installment_ids, monto, moneda, referencia, id_link, nro_orden, estado)
    values (${plan.affiliation_id}, ${plan.id}, ${ids}::uuid[], ${monto}, ${moneda}, ${referencia}, ${idLink}, ${nroOrden}, 'creado') returning id`;
  await logEvent(r, "pago_creado", plan.affiliation_id, { payment_id: pay!.id, monto, cuotas: ids.length });
  return jsonResponse(r, {
    payment_id: pay!.id, token, id_link: idLink, referencia, monto, moneda, email: af!.email, id_traza: af!.id_cliente, metodos: body.MetodosPago,
  });
}

/** Aplica un resultado a un pago: idempotente y en una sola transacción (pago + cuotas). */
async function aplicarResultado(pay: Row, resultadoCrudo: unknown, pagoIdLink: string | null): Promise<string | null> {
  const next = siguienteEstado(pay.estado as EstadoPago, leerResultado(resultadoCrudo));
  if (!next) return null;
  return sql().begin(async (tx) => {
    const upd = await tx`update luka_cash.luka_cash_payments set estado = ${next}, resultado = ${tx.json(limpiarResultado(resultadoCrudo) as any)},
      confirmado_por = 'cliente', updated_at = now() where id = ${pay.id} and estado = ${pay.estado} returning id, referencia, installment_ids, id_link`;
    const u = upd[0];
    if (u && next === "aprobado") {
      await tx`update luka_cash.luka_cash_installments set estado = 'pagada', pagada_at = now(), pago_referencia = ${u.referencia},
        pago_id_link = ${pagoIdLink ?? u.id_link} where id = any(${u.installment_ids}::uuid[]) and estado = 'pendiente'`;
    }
    return u ? next : null;
  });
}

async function installmentsConfirm(r: Request) {
  const m = await activeMember(r);
  if (m instanceof Response) return m;
  const b = await readJson(r);
  const paymentId = String(b.payment_id ?? "");
  if (!UUID_RE.test(paymentId)) return bad(r, "datos_invalidos", "Pago no válido.");
  const [pay] = await sql()`select * from luka_cash.luka_cash_payments where id = ${paymentId}`;
  if (!pay || !m.affIds.includes(pay.affiliation_id)) return bad(r, "no_encontrado", "No encontramos este pago.", 404);
  const next = await aplicarResultado(pay, b.resultado, null);
  if (next) await logEvent(r, `pago_${next}`, pay.affiliation_id, { payment_id: pay.id, nro_orden: pay.nro_orden, id_link: pay.id_link, confirmado_por: "cliente" });
  const [f] = await sql()`select estado, monto, moneda, referencia from luka_cash.luka_cash_payments where id = ${pay.id}`;
  return jsonResponse(r, { estado: f!.estado, monto: Number(f!.monto), moneda: f!.moneda, referencia: f!.referencia });
}

/* ---------- documentos ---------- */
async function documentsUpload(r: Request) {
  const m = await activeMember(r);
  if (m instanceof Response) return m;
  const b = await readJson(r);
  const tipo = String(b.tipo ?? ""), mime = String(b.mime ?? ""), tamano = Number(b.tamano), nombre = str(b.nombre, 200);
  if (!(TIPOS_REQUISITO as readonly string[]).includes(tipo)) return bad(r, "tipo_invalido", "Ese requisito no existe.");
  const err = validarArchivo(mime, tamano);
  if (err) return bad(r, "archivo_invalido", err);
  if (!nombre) return bad(r, "archivo_invalido", "El archivo no tiene nombre.");
  const affId = m.affIds[0]!;
  const ruta = `${affId}/${tipo}/${crypto.randomUUID()}.${MIME_EXT[mime]}`;
  const upload_url = await urlSubida(ruta, mime);
  await logEvent(r, "documento_subida_preparada", affId, { tipo, mime, tamano });
  // El cliente sube con PUT el archivo tal cual (no multipart), con el mismo Content-Type.
  return jsonResponse(r, { upload_url, ruta, metodo: "PUT", content_type: mime });
}

async function documentsConfirm(r: Request) {
  const m = await activeMember(r);
  if (m instanceof Response) return m;
  const b = await readJson(r);
  const ruta = String(b.ruta ?? ""), nombre = str(b.nombre, 200) || "documento";
  const match = /^([0-9a-f-]{36})\/([a-z_]+)\/([0-9a-f-]{36})\.(pdf|jpg|png)$/i.exec(ruta);
  if (!match || !m.affIds.includes(match[1]!) || !(TIPOS_REQUISITO as readonly string[]).includes(match[2]!)) return bad(r, "ruta_invalida", "No reconocemos este archivo.");
  const [, affId, tipo, , ext] = match;
  const obj = await infoObjeto(ruta);
  if (!obj) return bad(r, "no_subido", "El archivo no llegó. Intenta subirlo de nuevo.");
  const mime = obj.mime ?? Object.keys(MIME_EXT).find((k) => MIME_EXT[k] === ext) ?? "";
  const err = validarArchivo(mime, obj.tamano);
  if (err) {
    await borrarObjeto(ruta);
    return bad(r, "archivo_invalido", err);
  }
  await sql()`insert into luka_cash.luka_cash_documents (affiliation_id, tipo, ruta, nombre, mime, tamano)
    values (${affId!}, ${tipo!}, ${ruta}, ${nombre}, ${mime}, ${obj.tamano}) on conflict (ruta) do nothing`;
  await sql()`update luka_cash.luka_cash_requirements set estado = 'en_revision', updated_at = now()
    where affiliation_id = ${affId!} and tipo = ${tipo!} and estado <> 'aprobado'`;
  await logEvent(r, "documento_recibido", affId!, { tipo, mime, tamano: obj.tamano });
  const [req] = await sql()`select estado from luka_cash.luka_cash_requirements where affiliation_id = ${affId!} and tipo = ${tipo!}`;
  return jsonResponse(r, { tipo, estado: req?.estado ?? "en_revision" });
}

/* ---------- integración con el portal ---------- */
async function portalAffiliation(r: Request, b: Row, soloActiva = true): Promise<Row | Response> {
  const proveedor = str(b.proveedor, 80), id_cliente = str(b.id_cliente, 120), email = normalizeEmail(b.email);
  if (!proveedor || !id_cliente || !EMAIL_RE.test(email)) return bad(r, "datos_invalidos", "Faltan datos o el correo no es válido.");
  const v = await verifyPortal(r, email);
  if (v instanceof Response) return v;
  const [af] = await sql()`select * from luka_cash.luka_cash_affiliations where proveedor = ${proveedor} and id_cliente = ${id_cliente}`;
  if (!af || normalizeEmail(af.email) !== email) return bad(r, "no_encontrado", "No encontramos la afiliación.", 404);
  if (soloActiva && af.estado !== "activa") return bad(r, "no_activa", "La afiliación no está activa.", 409);
  return af;
}

async function portalAffiliate(r: Request) {
  const b = await readJson(r);
  const proveedor = str(b.proveedor, 80), id_cliente = str(b.id_cliente, 120);
  const rif = str(b.rif, 20).toUpperCase(), razon_social = str(b.razon_social, 200);
  const email = normalizeEmail(b.email), acepta_nombre = str(b.acepta_nombre, 120) || null;
  const terminos_version = str(b.terminos_version, 20);
  const proveedor_nombre = str(b.proveedor_nombre, 120) || null;
  const logo = str(b.proveedor_logo_url, 500);
  const proveedor_logo_url = /^https:\/\//.test(logo) ? logo : null;
  if (!proveedor || !id_cliente || !rif || !razon_social || !EMAIL_RE.test(email) || !terminos_version) return bad(r, "datos_invalidos", "Faltan datos o el correo no es válido.");
  const v = await verifyPortal(r, email);
  if (v instanceof Response) return v;
  const ip = clientIp(r), ua = r.headers.get("user-agent")?.slice(0, 400) ?? null;
  const [prev] = await sql()`select id, estado, nivel from luka_cash.luka_cash_affiliations where proveedor = ${proveedor} and id_cliente = ${id_cliente}`;
  let af: Row | undefined;
  if (prev) {
    const nivel = prev.estado === "activa" ? Math.max(prev.nivel ?? 1, 1) : 1;
    [af] = await sql()`update luka_cash.luka_cash_affiliations set rif = ${rif}, razon_social = ${razon_social}, email = ${email}, acepta_nombre = ${acepta_nombre},
      estado = 'activa', nivel = ${nivel}, terminos_version = ${terminos_version}, aceptado_at = now(), aceptado_ip = ${ip}, aceptado_user_agent = ${ua},
      origen_aceptacion = 'portal', proveedor_nombre = coalesce(${proveedor_nombre}, proveedor_nombre), proveedor_logo_url = coalesce(${proveedor_logo_url}, proveedor_logo_url)
      where id = ${prev.id} returning id, estado, nivel`;
  } else {
    [af] = await sql()`insert into luka_cash.luka_cash_affiliations (proveedor, id_cliente, rif, razon_social, email, acepta_nombre, estado, nivel,
      terminos_version, aceptado_at, aceptado_ip, aceptado_user_agent, origen_aceptacion, proveedor_nombre, proveedor_logo_url)
      values (${proveedor}, ${id_cliente}, ${rif}, ${razon_social}, ${email}, ${acepta_nombre}, 'activa', 1,
      ${terminos_version}, now(), ${ip}, ${ua}, 'portal', ${proveedor_nombre}, ${proveedor_logo_url}) returning id, estado, nivel`;
  }
  if (!af) return bad(r, "error", "No pudimos guardar la afiliación.", 500);
  await crearRequisitos(af.id);
  // El comercio y su usuario quedan registrados juntos: quien aceptó en el portal ya es miembro (Owner) de la empresa.
  const [u] = await sql()`insert into luka_cash.luka_cash_users (email) values (${email})
    on conflict (email) do update set email = excluded.email returning id`;
  await sql()`insert into luka_cash.luka_cash_members (user_id, affiliation_id, rol) values (${u!.id}, ${af.id}, 'owner') on conflict do nothing`;
  await logEvent(r, "afiliacion_activada_portal", af.id, { terminos_version, proveedor, nueva: !prev });
  return jsonResponse(r, { affiliation_id: af.id, estado: af.estado, nivel: af.nivel });
}

async function portalPlanCreate(r: Request) {
  const b = await readJson(r);
  const af = await portalAffiliation(r, b);
  if (af instanceof Response) return af;
  const factura_numero = str(b.factura_numero, 60), factura_id_link = str(b.factura_id_link, 120);
  const modalidad = b.modalidad === "cuotas" || b.modalidad === "paga_despues" ? (b.modalidad as string) : null;
  const plazo_dias = Number(b.plazo_dias), moneda = b.moneda === "USD" ? "USD" : b.moneda === "VES" ? "VES" : null;
  const monto_factura = Number(b.monto_factura), cargo_pct = Number(b.cargo_pct), cargo_monto = Number(b.cargo_monto);
  if (!factura_numero || !factura_id_link || !modalidad || validarPlazo(modalidad, plazo_dias) !== null || !moneda
    || !(monto_factura > 0) || !(cargo_pct >= 0) || !(cargo_monto >= 0)) return bad(r, "datos_invalidos", "Datos del plan no válidos.");
  const cuotas: CuotaPortal[] = (Array.isArray(b.cuotas) ? b.cuotas : []).map((c: Row) => ({
    numero: Number(c?.numero), fecha_vencimiento: str(c?.fecha_vencimiento, 10), monto: Number(c?.monto), estado: String(c?.estado ?? ""),
    pagada_at: c?.pagada_at ? str(c.pagada_at, 40) : null, pago_id_link: c?.pago_id_link ? str(c.pago_id_link, 120) : null,
  }));
  const err = validarCuotasPlan(cuotas, { modalidad, monto_factura });
  if (err) return bad(r, "cuotas_invalidas", err);

  const res = await crearPlanIdempotente({
    find: async (affId, link) => {
      const [p] = await sql()`select id from luka_cash.luka_cash_plans where affiliation_id = ${affId} and factura_id_link = ${link}`;
      return p ? { id: p.id as string } : null;
    },
    insert: async () => {
      try {
        return await sql().begin(async (tx) => {
          const [p] = await tx`insert into luka_cash.luka_cash_plans (affiliation_id, factura_numero, factura_id_link, modalidad, plazo_dias, moneda, monto_factura, cargo_pct, cargo_monto)
            values (${af.id}, ${factura_numero}, ${factura_id_link}, ${modalidad}, ${plazo_dias}, ${moneda}, ${monto_factura}, ${cargo_pct}, ${cargo_monto}) returning id`;
          for (const c of cuotas) {
            const pagada = c.estado === "pagada";
            await tx`insert into luka_cash.luka_cash_installments (plan_id, numero, fecha_vencimiento, monto, estado, pagada_at, pago_id_link)
              values (${p!.id}, ${c.numero}, ${c.fecha_vencimiento}, ${c.monto}, ${c.estado}, ${pagada ? (c.pagada_at ?? new Date().toISOString()) : null}, ${pagada ? (c.pago_id_link ?? null) : null})`;
          }
          return { id: p!.id as string };
        });
      } catch (e) {
        if ((e as { code?: string }).code === "23505") return { conflict: true as const };
        throw e;
      }
    },
  }, af.id, factura_id_link);
  if (!res.existente) await logEvent(r, "plan_creado_portal", af.id, { plan_id: res.plan_id, factura_numero, cuotas: cuotas.length });
  return jsonResponse(r, { plan_id: res.plan_id });
}

async function portalBalance(r: Request) {
  const b = await readJson(r);
  const af = await portalAffiliation(r, b);
  if (af instanceof Response) return af;
  return jsonResponse(r, await balanceBody([af]));
}

async function portalInstallmentsPaid(r: Request) {
  const b = await readJson(r);
  const af = await portalAffiliation(r, b);
  if (af instanceof Response) return af;
  const planId = String(b.plan_id ?? "");
  const ids: string[] = Array.isArray(b.installment_ids) ? b.installment_ids.map(String).slice(0, 50) : [];
  const pago_id_link = str(b.pago_id_link, 120), nro_orden = str(b.nro_orden, 120) || null;
  if (!UUID_RE.test(planId) || !ids.length || !ids.every((x) => UUID_RE.test(x)) || !pago_id_link) return bad(r, "datos_invalidos", "Datos de pago no válidos.");
  const pc = await planConCuotas(planId);
  if (!pc || pc.plan.affiliation_id !== af.id) return bad(r, "no_encontrado", "No encontramos esta factura.", 404);
  const { plan, cuotas } = pc;

  let [pay] = await sql()`select * from luka_cash.luka_cash_payments where plan_id = ${plan.id} and id_link = ${pago_id_link}`;
  if (!pay) {
    const err = validarOrdenPago(cuotas as any, ids);
    if (err) return bad(r, "orden_invalido", err);
    const elegidas = cuotas.filter((c) => ids.includes(c.id));
    [pay] = await sql()`insert into luka_cash.luka_cash_payments (affiliation_id, plan_id, installment_ids, monto, moneda, referencia, id_link, nro_orden, estado)
      values (${af.id}, ${plan.id}, ${ids}::uuid[], ${sumarMontos(elegidas.map((c) => c.monto))}, ${plan.moneda === "USD" ? "USD" : "VES"},
      ${armarReferencia(plan.modalidad, elegidas.map((c) => c.numero), cuotas.length, plan.factura_numero)}, ${pago_id_link}, ${nro_orden}, 'creado') returning *`;
  }
  const next = await aplicarResultado(pay!, b.resultado, pago_id_link);
  if (next) await logEvent(r, `pago_${next}_portal`, af.id, { payment_id: pay!.id, nro_orden, id_link: pago_id_link, confirmado_por: "cliente" });
  const [f] = await sql()`select id, estado, monto, moneda, referencia from luka_cash.luka_cash_payments where id = ${pay!.id}`;
  return jsonResponse(r, { payment_id: f!.id, estado: f!.estado, monto: Number(f!.monto), moneda: f!.moneda, referencia: f!.referencia });
}

/* ---------- facturas del proveedor ---------- */
const FECHA_RE = /^\d{4}-\d{2}-\d{2}/;
interface FacturaPortal { id_link: string; numero: string; orden: string | null; monto: number; moneda: string; estado: string; vence: string | null; url_adjunto: string | null }

export function limpiarFacturas(lista: unknown): FacturaPortal[] | string {
  if (!Array.isArray(lista)) return "facturas debe ser una lista.";
  if (lista.length > 500) return "Máximo 500 facturas por envío.";
  const out: FacturaPortal[] = [];
  for (const f of lista as Row[]) {
    const id_link = str(f?.id_link, 120), numero = str(f?.numero, 60), monto = Number(f?.monto);
    if (!id_link || !numero || !Number.isFinite(monto) || monto < 0) return "Cada factura necesita id_link, numero y monto.";
    const vence = typeof f?.vence === "string" && FECHA_RE.test(f.vence) ? f.vence.slice(0, 10) : null;
    const url = str(f?.url_adjunto, 500);
    out.push({
      id_link, numero, orden: str(f?.orden, 60) || null, monto: Math.round(monto * 100) / 100,
      moneda: str(f?.moneda, 3).toUpperCase() || "VES", estado: str(f?.estado, 40).toLowerCase() || "pendiente",
      vence, url_adjunto: /^https:\/\//.test(url) ? url : null,
    });
  }
  return out;
}

/** El portal envía la foto completa de las facturas del comercio con ese proveedor. Reemplaza la anterior. */
async function portalInvoicesSync(r: Request) {
  const b = await readJson(r);
  const af = await portalAffiliation(r, b);
  if (af instanceof Response) return af;
  const facturas = limpiarFacturas(b.facturas);
  if (typeof facturas === "string") return bad(r, "datos_invalidos", facturas);
  await sql().begin(async (tx) => {
    for (const f of facturas) {
      await tx`insert into luka_cash.luka_cash_invoices (affiliation_id, id_link, numero, orden, monto, moneda, estado, vence, url_adjunto, sincronizada_at)
        values (${af.id}, ${f.id_link}, ${f.numero}, ${f.orden}, ${f.monto}, ${f.moneda}, ${f.estado}, ${f.vence}, ${f.url_adjunto}, now())
        on conflict (affiliation_id, id_link) do update set numero = excluded.numero, orden = excluded.orden, monto = excluded.monto,
          moneda = excluded.moneda, estado = excluded.estado, vence = excluded.vence, url_adjunto = excluded.url_adjunto, sincronizada_at = now()`;
    }
    const links = facturas.map((f) => f.id_link);
    await tx`delete from luka_cash.luka_cash_invoices where affiliation_id = ${af.id} and not (id_link = any(${links}::text[]))`;
  });
  await logEvent(r, "facturas_sincronizadas", af.id, { cantidad: facturas.length });
  return jsonResponse(r, { sincronizadas: facturas.length });
}

/** Facturas de todos los proveedores de la empresa del usuario, como las ve en el portal. */
async function invoices(r: Request) {
  const m = await activeMember(r);
  if (m instanceof Response) return m;
  const rows = await sql()`select i.id, i.affiliation_id, i.id_link, i.numero, i.orden, i.monto, i.moneda, i.estado, i.vence::text vence,
      i.url_adjunto, i.sincronizada_at, a.proveedor, coalesce(a.proveedor_nombre, a.proveedor) proveedor_nombre, a.proveedor_logo_url
    from luka_cash.luka_cash_invoices i join luka_cash.luka_cash_affiliations a on a.id = i.affiliation_id
    where i.affiliation_id = any(${m.affIds}::uuid[]) order by i.vence nulls last, i.numero`;
  return jsonResponse(r, {
    facturas: rows.map((f) => ({
      id: f.id, id_link: f.id_link, numero: f.numero, orden: f.orden, monto: Number(f.monto), moneda: f.moneda, estado: f.estado,
      vence: f.vence, url_adjunto: f.url_adjunto, sincronizada_at: f.sincronizada_at,
      proveedor: { id: f.affiliation_id, nombre: f.proveedor_nombre, logo_url: f.proveedor_logo_url ?? null },
    })),
  });
}

/* ---------- vera ---------- */
const hostDe = (u: string | null) => { try { return u ? new URL(u).hostname : null; } catch { return null; } };
const demoHostOk = (h: string | null) => !!h && isDemoAllowed({ hostname: h, protocol: "https:" }, false, DOMINIOS_PRODUCCION);

async function pedirVera(key: string, cuerpo: unknown): Promise<{ reply: string; degradado: boolean } | null> {
  try {
    const res = await fetch(VERA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-vera-cliente-key": key },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status !== 200) return null;
    const j = (await res.json()) as { reply?: unknown; degradado?: unknown };
    if (typeof j.reply !== "string") return null;
    return { reply: j.reply.slice(0, 4000), degradado: j.degradado === true };
  } catch {
    return null;
  }
}

async function veraDemo(r: Request, b: Row) {
  const origin = r.headers.get("origin");
  if (!demoHostOk(hostDe(origin)) || origin?.startsWith("capacitor:")) return jsonResponse(r, { error: "demo_no_disponible" }, 403);
  const key = process.env["VERA_CLIENTE_KEY"];
  if (process.env["VERA_REMOTA"] === "off" || !key) return jsonResponse(r, { error: "vera_no_disponible" }, 503);
  const ip = clientIp(r) ?? "";
  if ((await contarEventos("vera_demo", "ip", [ip], 3600_000)) >= 30) return jsonResponse(r, { error: "limite_vera" }, 429);
  const entrada = limpiarEntradaVera(b);
  if (!entrada) return bad(r, "datos_invalidos", "Mensaje inválido.");
  const res = await pedirVera(key, cuerpoVera(null, entrada.cid, entrada.messages));
  if (!res) return jsonResponse(r, { error: "vera_no_disponible" }, 502);
  await logEvent(r, "vera_demo", null, { largo: entrada.messages.at(-1)?.content.length ?? 0 });
  return jsonResponse(r, res);
}

async function vera(r: Request) {
  if (!r.headers.get("authorization")) {
    const b = await readJson(r.clone());
    if (b.demo === true) return veraDemo(r, b);
  }
  const m = await activeMember(r);
  if (m instanceof Response) return m;
  const key = process.env["VERA_CLIENTE_KEY"];
  if (process.env["VERA_REMOTA"] === "off" || !key) return jsonResponse(r, { error: "vera_no_disponible" }, 503);
  if ((await contarEventos("vera_mensaje", "affiliation_id", m.affIds, 3600_000)) >= 30) return jsonResponse(r, { error: "limite_vera" }, 429);
  const entrada = limpiarEntradaVera(await readJson(r));
  if (!entrada) return bad(r, "datos_invalidos", "Mensaje inválido.");
  const affId = m.affIds[0]!;
  const [af] = await sql()`select acepta_nombre from luka_cash.luka_cash_affiliations where id = ${affId}`;
  const res = await pedirVera(key, cuerpoVera(nombreVera(af?.acepta_nombre), entrada.cid, entrada.messages));
  if (!res) return jsonResponse(r, { error: "vera_no_disponible" }, 502);
  await logEvent(r, "vera_mensaje", affId, { largo: entrada.messages.at(-1)?.content.length ?? 0 });
  return jsonResponse(r, res);
}

/* ---------- salud ---------- */
async function health(r: Request) {
  try {
    await sql()`select 1`;
    return jsonResponse(r, { ok: true, db: true, ambiente: AMBIENTE, correo: mailConfigurado() });
  } catch {
    return jsonResponse(r, { ok: false, db: false }, 503);
  }
}

export const HANDLERS: Record<string, (r: Request) => Promise<Response>> = {
  health,
  vera,
  "handoff-create": handoffCreate,
  "portal-eligibility": portalEligibility,
  "handoff-redeem": handoffRedeem,
  "code-send": codeSend,
  "code-verify": codeVerify,
  "session-close": sessionClose,
  preonboarding,
  session,
  balance,
  "installments-pay": installmentsPay,
  "installments-confirm": installmentsConfirm,
  "portal-affiliate": portalAffiliate,
  "portal-plan-create": portalPlanCreate,
  "portal-balance": portalBalance,
  "portal-installments-paid": portalInstallmentsPaid,
  "portal-invoices-sync": portalInvoicesSync,
  invoices,
  "documents-upload": documentsUpload,
  "documents-confirm": documentsConfirm,
};
