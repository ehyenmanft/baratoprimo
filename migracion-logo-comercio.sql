-- =====================================================================
-- BARATOPRIMO — migración: Logo del comercio en factura y ticket
-- ---------------------------------------------------------------------
-- Añade la columna logo_url a la tabla comercios y recrea la vista
-- mi_comercio para que exponga el logo a la aplicación.
--
-- Se puede ejecutar varias veces sin problema.
-- =====================================================================

-- 1. Añadir columna logo_url si no existe
alter table public.comercios add column if not exists logo_url text default null;

-- 2. Recrear la vista mi_comercio para incluir las nuevas columnas
drop view if exists public.mi_comercio;

create view public.mi_comercio as
select * from public.comercios where id = public.comercio_actual();

-- 3. Conceder permisos sobre la vista
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.mi_comercio to authenticated;
  end if;

  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view public.mi_comercio set (security_invoker = true)';
  end if;
end $$;

select 'migración logo_url y vista mi_comercio' as pieza, 'completada con éxito' as estado;
