-- =====================================================================
-- BARATOPRIMO — corrección: la vista mi_comercio no veía las columnas
-- nuevas
-- ---------------------------------------------------------------------
-- PostgreSQL congela la lista de columnas de una vista en el momento de
-- crearla: el "select *" se expande entonces y no vuelve a mirar. Por
-- eso, al añadir 'moneda_precios' y 'tasa_automatica' a la tabla
-- comercios, la vista mi_comercio —que es de donde lee la aplicación—
-- siguió devolviendo las columnas viejas.
--
-- Síntoma: eliges Dólares como moneda del catálogo, se guarda de verdad
-- en la tabla, pero la aplicación sigue pidiendo los precios en
-- bolívares porque nunca llega a enterarse.
--
-- Un 'create or replace' no basta para esto: hay que rehacer la vista.
-- Se puede ejecutar varias veces sin problema.
-- =====================================================================

drop view if exists mi_comercio;

create view mi_comercio as
select * from comercios where id = comercio_actual();

-- Permisos y modo de ejecución, que se pierden al rehacerla
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on mi_comercio to authenticated;
  end if;

  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view mi_comercio set (security_invoker = true)';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- Comprobación: deben aparecer las dos columnas
-- ---------------------------------------------------------------------

select 'vista mi_comercio' as pieza,
       case when (select count(*) from information_schema.columns
                   where table_name = 'mi_comercio'
                     and column_name in ('moneda_precios', 'tasa_automatica')) = 2
            then 'listo' else 'FALTA' end as estado;
