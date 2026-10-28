-- Luka Cash: esquema inicial para PostgreSQL gestionado de DigitalOcean (dev y prod).
-- Equivale a las migraciones 0000 a 0005 de Lovable (drizzle/migrations), sin lo propio de Supabase:
--   sin RLS, sin políticas, sin auth.uid(), sin roles authenticated/service_role.
--   La autorización la hace la API (activeMember en handlers.server.ts), que es la única que entra a la base.
-- Agrega: luka_cash_users (reemplaza auth.users de Supabase) y luka_cash_sessions (sesiones propias, revocables).
-- Idempotente: se puede correr dos veces sin error. Lo registra luka_cash_migrations.
-- Todo vive en el esquema luka_cash (dueño luka_cash_app). En PostgreSQL 15+ el usuario de la app no puede crear en public.
-- Paso único previo, como doadmin: create schema luka_cash authorization luka_cash_app;
--                                 alter role luka_cash_app in database luka_cash set search_path = luka_cash;
-- Con el pool en modo Transaction, la API debe nombrar el esquema (drizzle: pgSchema('luka_cash')) o fijar search_path por transacción.

begin;
set local search_path = luka_cash;

create table if not exists luka_cash_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- Personas que entran a la app (antes: auth.users de Supabase).
create table if not exists luka_cash_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

-- Sesiones propias: el cliente guarda un token aleatorio; aquí solo su hash.
create table if not exists luka_cash_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references luka_cash_users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip text,
  user_agent text
);
create index if not exists luka_cash_sessions_user_idx on luka_cash_sessions (user_id);

-- Afiliación de una empresa (RIF) con un proveedor.
create table if not exists luka_cash_affiliations (
  id uuid primary key default gen_random_uuid(),
  proveedor text not null,
  proveedor_nombre text,
  proveedor_logo_url text,
  id_cliente text not null,
  rif text not null,
  razon_social text not null,
  email text not null,
  acepta_nombre text,
  estado text not null default 'precalificado' check (estado in ('precalificado','activa')),
  nivel int check (nivel between 1 and 6),
  terminos_version text,
  aceptado_at timestamptz,
  aceptado_ip text,
  aceptado_user_agent text,
  origen_aceptacion text check (origen_aceptacion in ('portal','app')),
  created_at timestamptz not null default now(),
  unique (proveedor, id_cliente)
);
create index if not exists luka_cash_affiliations_email_idx on luka_cash_affiliations (email);
create index if not exists luka_cash_affiliations_rif_idx on luka_cash_affiliations (rif);

-- Quién puede entrar a cada afiliación.
create table if not exists luka_cash_members (
  user_id uuid not null references luka_cash_users(id) on delete cascade,
  affiliation_id uuid not null references luka_cash_affiliations(id) on delete cascade,
  rol text not null default 'owner' check (rol in ('owner','admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, affiliation_id)
);

-- Factura financiada.
create table if not exists luka_cash_plans (
  id uuid primary key default gen_random_uuid(),
  affiliation_id uuid not null references luka_cash_affiliations(id) on delete cascade,
  factura_numero text not null,
  factura_id_link text,
  modalidad text not null check (modalidad in ('cuotas','paga_despues')),
  plazo_dias int not null check (plazo_dias in (15,30,45,60)),
  moneda text not null default 'VES' check (moneda in ('VES','USD')),
  monto_factura numeric(18,2) not null,
  cargo_pct numeric(8,4) not null default 0,
  cargo_monto numeric(18,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists luka_cash_plans_aff_idx on luka_cash_plans (affiliation_id);
create unique index if not exists luka_cash_plans_aff_link_uniq on luka_cash_plans (affiliation_id, factura_id_link) where factura_id_link is not null;

-- Cuotas de cada factura.
create table if not exists luka_cash_installments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references luka_cash_plans(id) on delete cascade,
  numero int not null,
  fecha_vencimiento date not null,
  monto numeric(18,2) not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','pagada')),
  pagada_at timestamptz,
  pago_referencia text,
  pago_id_link text,
  unique (plan_id, numero)
);

-- Pagos hechos por el Botón de Pago.
create table if not exists luka_cash_payments (
  id uuid primary key default gen_random_uuid(),
  affiliation_id uuid not null references luka_cash_affiliations(id) on delete cascade,
  plan_id uuid not null references luka_cash_plans(id) on delete cascade,
  installment_ids uuid[] not null,
  monto numeric(18,2) not null,
  moneda text not null default 'VES',
  referencia text not null,
  id_link text,
  nro_orden text,
  estado text not null default 'creado' check (estado in ('creado','aprobado','pendiente','fallido')),
  confirmado_por text check (confirmado_por in ('cliente','servidor')),
  resultado jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists luka_cash_payments_aff_idx on luka_cash_payments (affiliation_id);
create index if not exists luka_cash_payments_plan_link_idx on luka_cash_payments (plan_id, id_link);

-- Requisitos del nivel.
create table if not exists luka_cash_requirements (
  affiliation_id uuid not null references luka_cash_affiliations(id) on delete cascade,
  tipo text not null check (tipo in ('empresa','representante','constitutivo','poder','cuenta_bancaria','estados_financieros')),
  estado text not null default 'vacio' check (estado in ('vacio','en_revision','aprobado')),
  updated_at timestamptz not null default now(),
  primary key (affiliation_id, tipo)
);

-- Documentos subidos (el archivo vive en Spaces, aquí la ruta).
create table if not exists luka_cash_documents (
  id uuid primary key default gen_random_uuid(),
  affiliation_id uuid not null references luka_cash_affiliations(id) on delete cascade,
  tipo text not null check (tipo in ('empresa','representante','constitutivo','poder','cuenta_bancaria','estados_financieros')),
  ruta text not null unique,
  nombre text not null,
  mime text not null,
  tamano bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists luka_cash_documents_aff_idx on luka_cash_documents (affiliation_id);

-- Enlaces de un solo uso del QR del portal (se guarda el hash, nunca el código).
create table if not exists luka_cash_handoffs (
  codigo text primary key,
  affiliation_id uuid not null references luka_cash_affiliations(id) on delete cascade,
  expira_at timestamptz not null,
  usado_at timestamptz,
  ticket_hash text unique,
  ticket_expira_at timestamptz,
  created_at timestamptz not null default now()
);

-- Códigos de 5 dígitos (se guarda el hash).
create table if not exists luka_cash_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  codigo_hash text not null,
  expira_at timestamptz not null,
  intentos int not null default 0,
  usado_at timestamptz,
  proposito text not null check (proposito in ('activar','entrar')),
  created_at timestamptz not null default now()
);
create index if not exists luka_cash_codes_email_idx on luka_cash_codes (email, created_at desc);

-- Bitácora. Nunca códigos ni tokens en detalle.
create table if not exists luka_cash_events (
  id uuid primary key default gen_random_uuid(),
  affiliation_id uuid references luka_cash_affiliations(id) on delete set null,
  tipo text not null,
  detalle jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists luka_cash_events_tipo_idx on luka_cash_events (tipo, created_at desc);
create index if not exists luka_cash_events_ip_idx on luka_cash_events (ip, tipo, created_at desc);
create index if not exists luka_cash_events_aff_idx on luka_cash_events (affiliation_id, created_at desc);

insert into luka_cash_migrations (version) values ('0001_esquema_inicial') on conflict do nothing;

commit;
