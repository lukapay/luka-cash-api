import { ALLOWED_ORIGINS, ALLOWED_ORIGIN_PATTERNS } from "./config";

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGIN_PATTERNS.some((r) => r.test(origin));
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, x-portal-token",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && isAllowedOrigin(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
