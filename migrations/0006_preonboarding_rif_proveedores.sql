-- Pre-onboarding (owner, 29-oct): el comercio indica su RIF y a qué proveedores les paga.
begin;
set local search_path = luka_cash;
alter table luka_cash_preonboarding add column if not exists rif text;
alter table luka_cash_preonboarding add column if not exists proveedores text[] not null default '{}';
insert into luka_cash_migrations (version) values ('0006_preonboarding_rif_proveedores') on conflict do nothing;
commit;
