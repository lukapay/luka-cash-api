// Rutas HTTP. Mismo prefijo que la app en Lovable (/api/public/luka/<nombre>) para que los clientes
// solo cambien la base: https://api.luka.cash
import { Hono } from "hono";
import { corsHeaders, isAllowedOrigin, jsonResponse } from "./cors";
import { HANDLERS } from "./handlers";
import { isBlockedPortalOrigin } from "./luka/portal";

export const app = new Hono();

app.get("/health", (c) => HANDLERS["health"]!(c.req.raw));

app.options("/api/public/luka/:name", (c) => {
  const r = c.req.raw;
  return new Response(null, { status: isAllowedOrigin(r.headers.get("origin")) ? 204 : 403, headers: corsHeaders(r) });
});

app.on(["GET", "POST"], "/api/public/luka/:name", async (c) => {
  const r = c.req.raw;
  const name = c.req.param("name");
  const handler = HANDLERS[name];
  if (!handler) return jsonResponse(r, { error: "no_existe", mensaje: "Ruta no encontrada." }, 404);
  const origin = r.headers.get("origin");
  if (isBlockedPortalOrigin(origin)) return jsonResponse(r, { error: "origen_no_permitido", mensaje: "El portal productivo todavía no usa Luka Cash." }, 403);
  if (origin && !isAllowedOrigin(origin)) return jsonResponse(r, { error: "origen_no_permitido", mensaje: "Origen no permitido." }, 403);
  try {
    return await handler(r);
  } catch (e) {
    console.error(`[luka:${name}]`, e instanceof Error ? e.message : "error");
    return jsonResponse(r, { error: "error", mensaje: "Algo salió mal. Intenta de nuevo." }, 500);
  }
});

app.notFound((c) => c.json({ error: "no_existe" }, 404));
