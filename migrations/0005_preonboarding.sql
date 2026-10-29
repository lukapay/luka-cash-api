-- El owner (29-oct): no es un registro ni un alta (el registro completo es en Luka); es el pre-onboarding de interesados
-- (proveedores y comercios que quieren usar Luka Cash). Renombra la tabla de 0004. No crea empresas, afiliaciones ni usuarios.
begin;
set local search_path = luka_cash;
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'luka_cash' and table_name = 'luka_cash_registros') then
    alter table luka_cash_registros rename to luka_cash_preonboarding;
    alter index if exists luka_cash_registros_tipo_email_uniq rename to luka_cash_preonboarding_tipo_email_uniq;
    alter index if exists luka_cash_registros_estado_idx rename to luka_cash_preonboarding_estado_idx;
  end if;
end $$;
update luka_cash_events set tipo = 'preonboarding' where tipo = 'registro';
insert into luka_cash_migrations (version) values ('0005_preonboarding') on conflict do nothing;
commit;
