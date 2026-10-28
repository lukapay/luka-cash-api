/** Condiciones ilustrativas del prototipo del owner, no reglas de aprobación. */
export const LEVELS = [
{name:'Ávila',amount:300,term:30,parts:2,headline:'El primer paso de un gran camino.',alt:'Aquí empieza tu historia',path:'M7 73 35 39 46 50 62 19 94 73H54L39 53 23 73Z',perk:'Tu primera oportunidad',desc:'Una línea para comenzar a surtir tu negocio.'},
{name:'Naiguatá',amount:600,term:30,parts:2,headline:'Tu constancia te lleva más alto.',alt:'Un paso más allá',path:'M5 73 31 44 47 52 60 73ZM35 36 55 9 70 33 78 35 95 73H68L51 44Z',perk:'Más posibilidades para surtir',desc:'Más capacidad para tus compras habituales.'},
{name:'Roraima',amount:1200,term:60,parts:3,headline:'Tu negocio gana altura.',alt:'Una nueva perspectiva',path:'M6 73 17 48 25 44 29 21H57L60 46 72 73ZM64 22 75 29H86L90 54 97 73H81L70 46Z',perk:'Oportunidades para crecer',desc:'Descubre beneficios en proveedores aliados.'},
{name:'Espejo',amount:2500,term:60,parts:3,headline:'Tu esfuerzo abre nuevas posibilidades.',alt:'Cada vez más alto',path:'M4 75 27 44 51 12 72 46 80 40 97 75ZM51 23 37 66 60 48 51 41Z',evenodd:true,perk:'Beneficios que acompañan tu avance',desc:'Propuesta de ofertas especiales con aliados.'},
{name:'Humboldt',amount:5000,term:60,parts:3,headline:'Una trayectoria que se hace grande.',alt:'Muy cerca de la cima',path:'M3 75 43 12 53 43 68 75ZM49 18 63 37 57 44ZM63 47 74 28 98 75H78Z',perk:'Acompañamiento para tu negocio',desc:'Propuesta de atención personalizada para crecer.'},
{name:'Bolívar',amount:10000,term:60,parts:3,headline:'Llegaste a lo más alto.',alt:'Tu cima. Nuestro orgullo.',path:'M4 75 25 49 44 35 62 54 74 39 96 75ZM40 28 55 8 72 32 65 43 47 28Z',perk:'Una relación a tu altura',desc:'Propuesta de acompañamiento y beneficios preferentes.'}
] as const;
export const PEAK_SHAPES = [
 [[[7,73],[35,39],[46,50],[62,19],[94,73],[54,73],[39,53],[23,73]]],
 [[[5,73],[31,44],[47,52],[60,73]],[[35,36],[55,9],[70,33],[78,35],[95,73],[68,73],[51,44]]],
 [[[6,73],[17,48],[25,44],[29,21],[57,21],[60,46],[72,73]],[[64,22],[75,29],[86,29],[90,54],[97,73],[81,73],[70,46]]],
 [[[4,75],[27,44],[51,12],[72,46],[80,40],[97,75]],[[51,23],[37,66],[60,48],[51,41]]],
 [[[3,75],[43,12],[53,43],[68,75]],[[49,18],[63,37],[57,44]],[[63,47],[74,28],[98,75],[78,75]]],
 [[[4,75],[25,49],[44,35],[62,54],[74,39],[96,75]],[[40,28],[55,8],[72,32],[65,43],[47,28]]]
] as const;
/** Colores de montaña por cima: leen los tokens de styles.css. */
export const PEAK_COLORS = [1, 2, 3, 4, 5, 6].map((n) => ({ peak: `var(--peak-${n})`, light: `var(--peak-light-${n})` }));
export const nombreNivel = (nivel: number) => LEVELS[Math.max(0, Math.min(5, nivel - 1))]?.name ?? "Ávila";
export function roundedPeak(points: readonly (readonly number[])[], r = 3.4): string {
  return points.map((p, i) => {
    const a = points[(i + points.length - 1) % points.length]; const b = points[(i + 1) % points.length];
    if (!a || !b) return "";
    const x = p[0] ?? 0, y = p[1] ?? 0;
    const ax = a[0] ?? 0, ay = a[1] ?? 0, bx = b[0] ?? 0, by = b[1] ?? 0;
    const la = Math.hypot(ax-x,ay-y), lb = Math.hypot(bx-x,by-y), d = Math.min(r,la*.22,lb*.22);
    return `${i ? "L" : "M"}${x+(ax-x)*d/la} ${y+(ay-y)*d/la}Q${x} ${y} ${x+(bx-x)*d/lb} ${y+(by-y)*d/lb}`;
  }).join(" ") + "Z";
}

export const etiquetaNivel = (nivel: number) => `Nivel ${nivel} · ${nombreNivel(nivel)}`;
export const primerNombre = (nombre?: string | null) => nombre?.trim().split(/\s+/)[0] || null;

/** Regla del 22-oct: niveles 1 y 2 (Ávila, Naiguatá) pagan en 2 cuotas; niveles 3 a 6 en 3. Cuota 1 hoy, las demás cada 30 días. */
export const cuotasPorNivel = (nivel: number) => (nivel <= 2 ? 2 : 3);
/** Texto de "Pago en partes" en Niveles. */
export const textoPartes = (nivel: number) =>
  cuotasPorNivel(nivel) === 2 ? "2 cuotas · hoy y día 30" : "3 cuotas · hoy, día 30 y día 60";
