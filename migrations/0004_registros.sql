-- Registro de proveedores y comercios desde la landing (luka.cash/registro) y desde Early Access (pedido del owner, 29-oct).
begin;
set local search_path = luka_cash;

create table if not exists luka_cash_registros (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('proveedor','comercio')),
  empresa text not null,
  nombre text not null,
  whatsapp text not null,                 -- E.164
  email text not null check (email = lower(email)),
  acepta_privacidad_at timestamptz not null,
  origen text not null check (origen in ('landing','early_access')),
  estado text not null default 'pendiente' check (estado in ('pendiente','invitado','descartado')),
  ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists luka_cash_registros_tipo_email_uniq on luka_cash_registros (tipo, lower(email));
create index if not exists luka_cash_registros_estado_idx on luka_cash_registros (estado, created_at desc);

insert into luka_cash_migrations (version) values ('0004_registros') on conflict do nothing;
commit;
