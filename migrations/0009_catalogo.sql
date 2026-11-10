-- Catálogo de pedidos por proveedor (owner 10-nov: banner de Coca-Cola y productos abajo).
-- Es del proveedor (slug de luka_cash_affiliations.proveedor), no de la afiliación: todos sus comercios ven el mismo.
begin;
set local search_path = luka_cash;

create table if not exists luka_cash_proveedores (
  proveedor text primary key,
  portada_url text,                 -- banner; si es null la app arma la portada con fotos de productos
  nota_entrega text,                -- "Entrega martes y viernes"
  pedido_minimo numeric(18,2),
  moneda text not null default 'USD' check (moneda in ('VES','USD')),
  updated_at timestamptz not null default now()
);

create table if not exists luka_cash_productos (
  id uuid primary key default gen_random_uuid(),
  proveedor text not null references luka_cash_proveedores(proveedor) on delete cascade,
  sku text not null,
  nombre text not null,
  presentacion text not null,
  categoria text not null,
  precio numeric(18,2) not null check (precio > 0),
  moneda text not null default 'USD' check (moneda in ('VES','USD')),
  foto text,                        -- clave de foto incluida en la app (p. ej. bebidas_1)
  foto_url text,                    -- o URL https
  orden int not null default 0,
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (proveedor, sku)
);

insert into luka_cash_migrations (version) values ('0009_catalogo') on conflict do nothing;
commit;
