// Configuración del servicio. Todo secreto viene del entorno (/etc/luka-cash/env en el droplet); nada se escribe aquí.

const env = (k: string, d?: string) => process.env[k] ?? d;

export const IS_PROD = env("NODE_ENV") === "production";
/** "calidad" (base luka-cash-dev, sin datos reales) o "produccion". En calidad se aceptan las vistas previas de Lovable. */
export const AMBIENTE = env("AMBIENTE", IS_PROD ? "produccion" : "calidad") as string;
export const PORT = Number(env("PORT", "3001"));

/** Dominio público de la app (enlaces de activación, logo del correo). */
export const APP_PUBLIC_URL = (env("APP_PUBLIC_URL", "https://app.luka.cash") as string).replace(/\/$/, "");

/** Hosts propios publicados, sin protocolo; la demo nunca corre en ellos ni en sus subdominios. */
export const DOMINIOS_PRODUCCION: readonly string[] = ["luka.cash"];

export const TERMINOS_VERSION = "v0.1";

/** Orígenes exactos permitidos por CORS. */
export const ALLOWED_ORIGINS: readonly string[] = [
  "https://app.luka.cash",
  "https://luka.cash",
  "capacitor://localhost", // iOS
  "https://localhost", // Android (androidScheme https)
  // Vista previa del portal de pagos
  "https://id-preview--13ee17a3-1c40-4050-860c-36283a947427.lovable.app",
  // Orígenes extra sin redesplegar código (p. ej. el dominio de producción de Early Access): EXTRA_ALLOWED_ORIGINS="https://a,https://b"
  ...(env("EXTRA_ALLOWED_ORIGINS", "") as string).split(",").map((o) => o.trim().replace(/\/$/, "")).filter((o) => /^https:\/\/[a-z0-9.-]+$/i.test(o)),
];

/** Patrones extra solo fuera de producción (AMBIENTE=calidad): vistas previas de Lovable y desarrollo local. */
export const ALLOWED_ORIGIN_PATTERNS: readonly RegExp[] = AMBIENTE === "produccion"
  ? []
  : [
      /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.lovable\.app$/,
      /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.lovableproject\.com$/,
      /^http:\/\/localhost(:\d+)?$/,
      /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    ];

export const PAYCO_API_BASE = (env("PAYCO_API_BASE", "https://bspaycoapi-qa.payco.net.ve/api/v1") as string).replace(/\/$/, "");
export const LUKA_AUTH_URL = env("LUKA_AUTH_URL", "https://zoiqthqeqtdtmxswqvfb.supabase.co/functions/v1/luka-auth") as string;
export const VERA_API_URL = env("VERA_API_URL", "https://api.somosluka.com/chat-vera-cliente") as string;

/** Sesiones: 30 días, se renuevan con el uso. */
export const SESSION_DAYS = 30;
