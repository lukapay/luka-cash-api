-- Precalificación de Luka Cash por RIF (owner, 29-oct): solo ciertos RIF, asociados a un correo, pueden afiliarse.
begin;
set local search_path = luka_cash;
create table if not exists luka_cash_precalificados (
  email text not null check (email = lower(email)),
  rif text not null check (rif ~ '^[JVEGPC]-\d{8}-\d$'),
  razon_social text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (email, rif)
);
insert into luka_cash_precalificados (email, rif) values ('ruben@somosluka.com', 'J-12345678-0') on conflict do nothing;
insert into luka_cash_migrations (version) values ('0007_precalificados') on conflict do nothing;
commit;
