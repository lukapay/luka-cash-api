// Datos de ejemplo en CALIDAD para que la app se vea como la demo (pedido del owner, 09-nov).
// Todo lo que crea queda marcado: afiliaciones con id_cliente "ejemplo-*", facturas y planes con id_link "EJEMPLO-*".
//   cargar:  node dist/ejemplo-calidad.js cargar  [correo]   (por defecto ruben@somosluka.com, RIF J-12345678-0)
//   borrar:  node dist/ejemplo-calidad.js borrar  [correo]
// Solo corre con AMBIENTE=calidad. Fechas relativas a hoy (Caracas), para que siempre haya una vencida y una por vencer.
import { closeDb, sql } from "../src/db";

const [cmd, emailArg] = process.argv.slice(2);
const EMAIL = (emailArg ?? "ruben@somosluka.com").toLowerCase();
const RIF = "J-12345678-0";
const RAZON = "Tu Bodega C.A.";
const LOGO = (f: string) => `https://api.luka.cash/brand/proveedores/${f}`;

const PROVEEDORES = [
  { slug: "coca-cola-femsa", nombre: "Coca-Cola FEMSA", logo: "coca-cola-femsa.png", existente: true },
  { slug: "alimentos-polar", nombre: "Alimentos Polar", logo: "alimentos-polar-blanco.jpg" },
  { slug: "cargill", nombre: "Cargill", logo: "cargill.png" },
  { slug: "mimesa", nombre: "Mimesa", logo: "mimesa.jpg" },
  { slug: "diablitos-underwood", nombre: "Diablitos Underwood", logo: "diablitos.jpg" },
  { slug: "heinz", nombre: "Heinz", logo: "heinz.jpg" },
];

const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(new Date());
const dia = (n: number) => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

if ((process.env["AMBIENTE"] ?? "") !== "calidad") { console.error("Solo en AMBIENTE=calidad."); process.exit(1); }

async function afiliacion(p: (typeof PROVEEDORES)[number], userId: string): Promise<string> {
  // Coca-Cola ya existe (la creó el portal): se reutiliza y se completa. El resto se crea marcado como ejemplo.
  const [prev] = await sql()`select id from luka_cash.luka_cash_affiliations where email = ${EMAIL} and rif = ${RIF} and proveedor = ${p.slug} order by created_at limit 1`;
  let id: string;
  if (prev) {
    id = prev.id;
    await sql()`update luka_cash.luka_cash_affiliations set proveedor_nombre = ${p.nombre}, proveedor_logo_url = ${LOGO(p.logo)}, razon_social = ${RAZON} where id = ${id}`;
  } else {
    const [a] = await sql()`insert into luka_cash.luka_cash_affiliations (proveedor, proveedor_nombre, proveedor_logo_url, id_cliente, rif, razon_social, email,
      acepta_nombre, estado, nivel, terminos_version, aceptado_at, origen_aceptacion)
      values (${p.slug}, ${p.nombre}, ${LOGO(p.logo)}, ${"ejemplo-" + p.slug}, ${RIF}, ${RAZON}, ${EMAIL}, 'Ruben Marina', 'activa', 3, 'v0.1', now(), 'portal')
      on conflict (proveedor, id_cliente) do update set estado = 'activa' returning id`;
    id = a!.id;
  }
  await sql()`insert into luka_cash.luka_cash_members (user_id, affiliation_id, rol) values (${userId}, ${id}, 'owner') on conflict do nothing`;
  for (const t of ["empresa", "representante", "constitutivo", "poder", "cuenta_bancaria", "estados_financieros"]) {
    const estado = t === "empresa" || t === "representante" ? "aprobado" : "vacio";
    await sql()`insert into luka_cash.luka_cash_requirements (affiliation_id, tipo, estado) values (${id}, ${t}, ${estado}) on conflict do nothing`;
  }
  return id;
}

type Cuota = [numero: number, venceDias: number, monto: number, pagada: boolean];
async function plan(affId: string, factura: string, modalidad: "cuotas" | "paga_despues", plazo: number, monto: number, cargoPct: number, cuotas: Cuota[]) {
  const link = `EJEMPLO-${factura}`;
  const [p] = await sql()`insert into luka_cash.luka_cash_plans (affiliation_id, factura_numero, factura_id_link, modalidad, plazo_dias, moneda, monto_factura, cargo_pct, cargo_monto)
    values (${affId}, ${factura}, ${link}, ${modalidad}, ${plazo}, 'USD', ${monto}, ${cargoPct}, ${Math.round(monto * cargoPct) / 100})
    on conflict (affiliation_id, factura_id_link) where factura_id_link is not null do update set monto_factura = excluded.monto_factura returning id`;
  for (const [n, d, m, pagada] of cuotas) {
    await sql()`insert into luka_cash.luka_cash_installments (plan_id, numero, fecha_vencimiento, monto, estado, pagada_at, pago_referencia)
      values (${p!.id}, ${n}, ${dia(d)}, ${m}, ${pagada ? "pagada" : "pendiente"}, ${pagada ? new Date(`${dia(d)}T15:00:00Z`) : null}, ${pagada ? `Cuota ${n} · Factura ${factura}` : null})
      on conflict (plan_id, numero) do nothing`;
  }
}

async function factura(affId: string, numero: string, monto: number, estado: string, venceDias: number) {
  await sql()`insert into luka_cash.luka_cash_invoices (affiliation_id, id_link, numero, monto, moneda, estado, vence)
    values (${affId}, ${"EJEMPLO-" + numero}, ${numero}, ${monto}, 'USD', ${estado}, ${dia(venceDias)})
    on conflict (affiliation_id, id_link) do update set monto = excluded.monto, estado = excluded.estado, vence = excluded.vence, sincronizada_at = now()`;
}

// Catálogo de pedidos de Coca-Cola FEMSA (owner 10-nov). Fotos: claves de las que trae la app.
const CATALOGO_COCA: [sku: string, nombre: string, presentacion: string, categoria: string, precio: number, foto: string][] = [
  ["CC-355-24", "Coca-Cola 355 ml", "Caja de 24", "Refrescos", 18.72, "bebidas_1"],
  ["CC-2L-6", "Coca-Cola 2 L", "Paca de 6", "Refrescos", 15.87, "bebidas_7"],
  ["CCSA-355-24", "Coca-Cola Sin Azúcar 355 ml", "Caja de 24", "Refrescos", 18.72, "bebidas_6"],
  ["FRE-1.5-6", "Frescolita 1,5 L", "Paca de 6", "Refrescos", 12.64, "bebidas_4"],
  ["CHI-1.5-6", "Chinotto 1,5 L", "Paca de 6", "Refrescos", 12.64, "bebidas_8"],
  ["NEV-600-12", "Agua Nevada 600 ml", "Paca de 12", "Aguas", 6.48, "bebidas_2"],
  ["DV-1L-12", "Del Valle naranja 1 L", "Caja de 12", "Jugos", 24.36, "bebidas_3"],
  ["PWR-500-12", "Powerade 500 ml", "Caja de 12", "Hidratantes", 14.85, "bebidas_5"],
];

async function catalogoCoca() {
  await sql()`insert into luka_cash.luka_cash_proveedores (proveedor, nota_entrega, pedido_minimo, moneda)
    values ('coca-cola-femsa', 'Entrega martes y viernes', 150, 'USD')
    on conflict (proveedor) do update set nota_entrega = excluded.nota_entrega, pedido_minimo = excluded.pedido_minimo, updated_at = now()`;
  let orden = 0;
  for (const [sku, nombre, presentacion, categoria, precio, foto] of CATALOGO_COCA) {
    await sql()`insert into luka_cash.luka_cash_productos (proveedor, sku, nombre, presentacion, categoria, precio, foto, orden)
      values ('coca-cola-femsa', ${sku}, ${nombre}, ${presentacion}, ${categoria}, ${precio}, ${foto}, ${orden++})
      on conflict (proveedor, sku) do update set nombre = excluded.nombre, presentacion = excluded.presentacion, categoria = excluded.categoria,
        precio = excluded.precio, foto = excluded.foto, orden = excluded.orden, activo = true, updated_at = now()`;
  }
}

async function cargar() {
  // La empresa de prueba J-00000000-1 (creada el 28-oct) tapaba a Tu Bodega J-12345678-0: se borra.
  const borradas = await sql()`delete from luka_cash.luka_cash_affiliations where email = ${EMAIL} and rif = 'J-00000000-1' returning id`;
  const [u] = await sql()`insert into luka_cash.luka_cash_users (email) values (${EMAIL}) on conflict (email) do update set email = excluded.email returning id`;
  // Las demás afiliaciones del correo con este RIF (p. ej. ACME del portal) toman la misma razón social.
  await sql()`update luka_cash.luka_cash_affiliations set razon_social = ${RAZON} where email = ${EMAIL} and rif = ${RIF}`;
  const id: Record<string, string> = {};
  for (const p of PROVEEDORES) id[p.slug] = await afiliacion(p, u!.id);

  // Financiamientos (lo que ve Pagos e Inicio): una cuota vencida, una por vencer y pagadas.
  await plan(id["coca-cola-femsa"]!, "324228", "cuotas", 60, 687.45, 5, [[1, -35, 229.15, true], [2, -5, 229.15, false], [3, 25, 229.15, false]]);
  await plan(id["alimentos-polar"]!, "98112", "cuotas", 60, 916.62, 5, [[1, -10, 305.54, true], [2, 20, 305.54, false], [3, 50, 305.54, false]]);
  await plan(id["mimesa"]!, "M-20417", "cuotas", 30, 412.8, 4, [[1, -28, 206.4, true], [2, 2, 206.4, false]]);
  await plan(id["cargill"]!, "CG-7781", "paga_despues", 45, 1180, 6.5, [[1, 12, 1180, false]]);

  // Facturas del portal (lo que ve "Pagar una factura").
  await factura(id["coca-cola-femsa"]!, "324301", 534.69, "pendiente", 9);
  await factura(id["coca-cola-femsa"]!, "324155", 288.1, "vencida", -3);
  await factura(id["coca-cola-femsa"]!, "324402", 1240.1, "pendiente", 21);
  await factura(id["alimentos-polar"]!, "98244", 645.3, "pendiente", 14);
  await factura(id["alimentos-polar"]!, "98190", 210.75, "pagada", -6);
  await factura(id["cargill"]!, "CG-7802", 980.0, "pendiente", 30);
  await factura(id["mimesa"]!, "M-20480", 156.4, "pendiente", 7);
  await factura(id["diablitos-underwood"]!, "DU-1103", 342.9, "pendiente", 11);
  await factura(id["heinz"]!, "HZ-55021", 418.25, "pendiente", 18);
  await factura(id["heinz"]!, "HZ-54980", 97.6, "vencida", -1);

  await catalogoCoca();
  console.log(`datos de ejemplo cargados para ${EMAIL} (${RIF}); empresas de prueba borradas: ${borradas.length}`);
}

async function borrar() {
  const p = await sql()`delete from luka_cash.luka_cash_plans where factura_id_link like 'EJEMPLO-%' and affiliation_id in
    (select id from luka_cash.luka_cash_affiliations where email = ${EMAIL})`;
  const f = await sql()`delete from luka_cash.luka_cash_invoices where id_link like 'EJEMPLO-%' and affiliation_id in
    (select id from luka_cash.luka_cash_affiliations where email = ${EMAIL})`;
  const a = await sql()`delete from luka_cash.luka_cash_affiliations where email = ${EMAIL} and id_cliente like 'ejemplo-%'`;
  console.log(`borrados: ${p.count} financiamientos, ${f.count} facturas, ${a.count} afiliaciones de ejemplo`);
}

try {
  if (cmd === "cargar") await cargar();
  else if (cmd === "borrar") await borrar();
  else { console.log("uso: ejemplo-calidad cargar|borrar [correo]"); process.exitCode = 1; }
} finally {
  await closeDb();
}
