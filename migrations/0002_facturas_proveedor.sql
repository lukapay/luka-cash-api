-- Facturas del proveedor que el portal de pagos sincroniza para cada afiliación (las mismas que el comercio ve en el portal).
-- La API no tiene credenciales de Payco por comercio: el portal, con la sesión del comercio, envía la foto de sus facturas.
begin;
set local search_path = luka_cash;

create table if not exists luka_cash_invoices (
  id uuid primary key default gen_random_uuid(),
  affiliation_id uuid not null references luka_cash_affiliations(id) on delete cascade,
  id_link text not null,                 -- IdLink del Botón/Link de Pago (identificador estable)
  numero text not null,                  -- referencia principal visible (número de factura)
  orden text,                            -- NumeroOrden del API de Payco
  monto numeric(18,2) not null,
  moneda text not null default 'VES',
  estado text not null,                  -- EstatusLink.Descripcion tal cual (pendiente, pagada, vencida, etc.)
  vence date,                            -- FechaExpiracion
  url_adjunto text,                      -- PDF de la factura si el portal lo expone (solo https)
  sincronizada_at timestamptz not null default now(),
  unique (affiliation_id, id_link)
);
create index if not exists luka_cash_invoices_aff_idx on luka_cash_invoices (affiliation_id, sincronizada_at desc);

insert into luka_cash_migrations (version) values ('0002_facturas_proveedor') on conflict do nothing;
commit;
