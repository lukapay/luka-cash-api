# luka-cash-api

API de Luka Cash (`https://api.luka.cash`). Servicio Node 22 (Hono) sobre PostgreSQL gestionado de DigitalOcean.
La consumen la app web (`app.luka.cash`), las apps de Android e iOS (Capacitor) y el portal de pagos.

Nació el 28-oct-2026 como port de las rutas `/api/public/luka/*` de la app en Lovable (`lukapay/luka-cash-app`, versión 1.11.1):
mismas reglas y respuestas, sin Supabase.

| Pieza | Dónde |
|---|---|
| Base | PostgreSQL 18, DigitalOcean SFO3, esquema `luka_cash` (`luka-cash-dev` y `luka-cash-prod`) |
| Sesión | Propia: `luka_cash_sessions` (token opaco de 32 bytes, se guarda su sha256, 30 días renovables, revocable con `session-close`) |
| Correo del código | Amazon SES us-west-2, `Luka Cash <codigos@luka.cash>`, configuration set `luka-cash` (plantilla aprobada por el owner el 27-oct) |
| Documentos | DigitalOcean Spaces, bucket privado `luka-cash-docs`, URL prefirmadas de 15 min (PUT directo, no multipart) |
| Cobro | `luka-auth` + `POST /link/token` de Payco (QA mientras no haya OK para producción) |
| Despliegue | GitHub Actions → droplet `luka-cash` (`/opt/luka-cash/api`), systemd `luka-cash-api`, nginx `api.luka.cash` |

## Rutas (`POST /api/public/luka/<nombre>`)
`health` (también `GET /health`), `code-send`, `code-verify` (devuelve `session_token`), `session-close`, `balance`,
`handoff-create`, `handoff-redeem`, `installments-pay`, `installments-confirm`, `documents-upload`, `documents-confirm`,
`portal-affiliate`, `portal-plan-create`, `portal-balance`, `portal-installments-paid`, `portal-invoices-sync`, `invoices`, `vera`.

**Facturas del proveedor (28-oct):** la API no tiene credenciales de Payco por comercio. El portal, con la sesión del comercio, envía la foto de sus facturas a `portal-invoices-sync` (`X-Portal-Token`; body `{ proveedor, id_cliente, email, facturas: [{ id_link, numero, orden?, monto, moneda, estado, vence?, url_adjunto? }] }`, reemplaza la foto anterior). La app las lee con `invoices` (sesión). `portal-affiliate` registra también al usuario (correo) como Owner de la empresa.

**Cambios de contrato frente a la app de Lovable** (la app debe adaptarse):
1. `code-verify` devuelve `{ session_token, expira_at }` en lugar de `{ token_hash }`. El cliente guarda el token y lo manda como `Authorization: Bearer`.
2. Nueva `session-close` para cerrar sesión en el servidor.
3. `documents-upload` devuelve `{ upload_url, ruta, metodo: "PUT", content_type }`: se sube el archivo tal cual con `PUT` y ese `Content-Type`.
4. En producción, CORS solo acepta `app.luka.cash`, `luka.cash`, Capacitor y la vista previa del portal.

## Variables (`/etc/luka-cash/env` en el droplet; nunca en el repo)
`DATABASE_URL` (pool), `DATABASE_CA_FILE`, `MAIL_ACCESS_KEY_ID`, `MAIL_SECRET_ACCESS_KEY`, `MAIL_REGION=us-west-2`, `MAIL_FROM=codigos@luka.cash`,
`SPACES_ENDPOINT`, `SPACES_BUCKET`, `SPACES_KEY`, `SPACES_SECRET`, `PAYCO_API_BASE`, `LUKA_AUTH_URL`, `VERA_API_URL`, `VERA_CLIENTE_KEY`, `APP_PUBLIC_URL`.

## Desarrollo
```bash
npm ci
npm run typecheck && npm test          # pruebas de reglas
./scripts/con-dev.sh npm test          # + recorrido real contra luka-cash-dev (lee ~/.luka-cash, no imprime secretos)
./scripts/con-dev.sh npm run migrate:dev
```

## Pendientes conocidos
- Confirmación del pago del lado del servidor (hoy `confirmado_por = cliente`): falta el endpoint de estado de link en Payco.
- Regla de cuotas del 22-oct (2 o 3 cuotas cada 30 días según nivel) junto con el portal; hoy valida la regla vieja (cada 15 días).
- Primer despliegue: crear `lukacash`, `/opt/luka-cash/api`, la unidad `deploy/luka-cash-api.service`, el sitio `deploy/nginx-api.luka.cash.conf`, `deploy/sudoers-lukacash`, y los secretos `DEPLOY_*` del repo.

## Early Access (29-oct, pedido del owner: "A: api.luka.cash")
Invitados de pre-lanzamiento (Lovable 061e101b) que entran con el mismo código de `codigos@luka.cash`.
- Tabla `luka_cash.luka_cash_early_access` (email único en minúsculas, nombre, origen, invited_at, validated_at, revoked_at). Sembrados: ruben@somosluka.com, manuel@somosluka.com.
- `code-send { email }`: si el correo no tiene afiliación activa pero es invitado vigente, envía el código (mismas reglas y límites).
- `code-verify { email, codigo, proposito: "entrar" }`: invitado sin afiliación → `{ session_token, expira_at, alcance: "early_access" }`. Con afiliación activa → igual que siempre, `alcance: "app"`.
- La sesión `early_access` **no abre ninguna ruta de la app** (balance, invoices, pagos, documentos, vera responden 401).
- `GET|POST session` con `Authorization: Bearer` → `{ email, alcance, expira_at }` o 401; marca `validated_at` la primera vez.
- Revocar un invitado invalida su sesión al instante.
- Administrar: `./scripts/con-dev.sh npx tsx scripts/early-access.ts add correo "Nombre" [origen] | remove correo | list` (calidad, desde la Mac). En el droplet: `node dist/early-access.js ...` con el env cargado.
- CORS: `EXTRA_ALLOWED_ORIGINS="https://dominio1,https://dominio2"` en `/etc/luka-cash/env` agrega orígenes sin redesplegar código (reinicio del servicio). En calidad ya pasan `*.lovable.app`.

## Pre-onboarding de interesados (29-oct, owner: "Sí, pídelo"; nombre: "preonboarding, el registro completo es en Luka")
`POST preonboarding` desde luka.cash/registro y desde el acceso anticipado. Tabla `luka_cash_preonboarding` (único por tipo + correo). **No crea empresas, afiliaciones ni usuarios.**
- Cuerpo: `{ tipo: "proveedor"|"comercio", empresa, nombre, whatsapp (E.164; +58 exige móvil 4xx de 10 dígitos; resto 8 a 15 dígitos), email, acepta_privacidad: true, origen: "landing"|"early_access" }`.
- 200 `{ recibido: true, mensaje }`, también si ya existía (actualiza sin revelarlo). 400 `{ error: "datos_invalidos", campo, mensaje }` o `sin_aceptacion`; 429 `limite` (10 por hora por IP).
- Cada interesado nuevo avisa a `ventas@somosluka.com` (`MAIL_AVISOS_TO`) por SES, con Reply-To del interesado. No bloquea la respuesta.
- Admin: `./scripts/con-dev.sh npx tsx scripts/preonboarding.ts list [pendiente|invitado|descartado] | invitar <correo> | descartar <correo>`. `invitar` lo agrega al acceso anticipado.
