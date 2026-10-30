-- Precalificados por RIF sin correo (owner, 30-oct): email null = vale para cualquier correo que llegue con ese RIF.
begin;
set local search_path = luka_cash;
alter table luka_cash_precalificados drop constraint if exists luka_cash_precalificados_pkey;
alter table luka_cash_precalificados alter column email drop not null;
alter table luka_cash_precalificados add column if not exists id uuid not null default gen_random_uuid();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'luka_cash_precalificados_id_pkey') then
    alter table luka_cash_precalificados add constraint luka_cash_precalificados_id_pkey primary key (id);
  end if;
end $$;
create unique index if not exists luka_cash_precalificados_email_rif_uniq on luka_cash_precalificados (coalesce(email, ''), rif);
create index if not exists luka_cash_precalificados_rif_idx on luka_cash_precalificados (rif) where email is null;
insert into luka_cash_precalificados (email, rif) values (null, 'J-12345678-1'), (null, 'J-12345678-2')
  on conflict (coalesce(email, ''), rif) do nothing;
insert into luka_cash_migrations (version) values ('0008_precalificados_sin_correo') on conflict do nothing;
commit;
