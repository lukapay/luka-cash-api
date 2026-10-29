-- Luka Cash Early Access (pedido del owner, 29-oct, "A: api.luka.cash"): lista de invitados de pre-lanzamiento
-- que entran con el mismo código de 5 dígitos. Su sesión tiene alcance 'early_access' y NO da permisos de la app.
begin;
set local search_path = luka_cash;

create table if not exists luka_cash_early_access (
  email text primary key check (email = lower(email)),
  nombre text,
  origen text not null default 'manual',
  invited_at timestamptz not null default now(),
  validated_at timestamptz,
  revoked_at timestamptz
);

alter table luka_cash_sessions add column if not exists alcance text not null default 'app';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'luka_cash_sessions_alcance_check') then
    alter table luka_cash_sessions add constraint luka_cash_sessions_alcance_check check (alcance in ('app','early_access'));
  end if;
end $$;

insert into luka_cash_early_access (email, nombre, origen) values
  ('ruben@somosluka.com', 'Ruben', 'owner'),
  ('manuel@somosluka.com', 'Manuel', 'owner')
on conflict (email) do nothing;

insert into luka_cash_migrations (version) values ('0003_early_access') on conflict do nothing;
commit;
