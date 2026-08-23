-- =====================================================================
-- BARATOPRIMO — migración: productos exentos de IVA
-- ---------------------------------------------------------------------
-- Marca los productos que no causan impuesto. La factura los separa como
-- base exenta, que es como los exige el SENIAT.
--
-- Rehace también la vista stock_actual, porque PostgreSQL congela la
-- lista de columnas de una vista al crearla y sin esto la aplicación no
-- vería la columna nueva.
--
-- Se puede ejecutar varias veces sin romper nada.
-- =====================================================================

alter table productos
  add column if not exists exento_iva boolean not null default false;


-- La vista tiene que rehacerse para incluir la columna. Se recrean
-- también las que dependen de ella.
drop view if exists alertas_stock;
drop view if exists stock_actual;

create view stock_actual as
select
  p.id            as producto_id,
  p.comercio_id,
  p.sku, p.nombre, p.unidad, p.categoria_id,
  c.nombre        as categoria,
  p.stock_minimo, p.costo, p.precio_venta, p.exento_iva, p.imagen_path,
  coalesce(sum(cantidad_signada(m.tipo, m.cantidad, m.es_negativo)), 0) as stock,
  coalesce(sum(cantidad_signada(m.tipo, m.cantidad, m.es_negativo)), 0) * p.costo as valor_inventario,
  max(m.fecha)    as ultimo_movimiento
from productos p
left join movimientos m on m.producto_id = p.id
left join categorias  c on c.id = p.categoria_id
where p.activo
group by p.id, c.nombre;

create view alertas_stock as
select *, case when stock <= 0 then 'sin_stock' else 'bajo_minimo' end as nivel
from stock_actual
where stock <= stock_minimo;


-- Permisos y modo de ejecución, que se pierden al rehacerlas
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on stock_actual, alertas_stock to authenticated;
  end if;

  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view stock_actual  set (security_invoker = true)';
    execute 'alter view alertas_stock set (security_invoker = true)';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- Comprobación
-- ---------------------------------------------------------------------

select 'columna exento_iva' as pieza,
       case when exists (select 1 from information_schema.columns
                          where table_name = 'productos' and column_name = 'exento_iva')
            then 'listo' else 'FALTA' end as estado
union all
select 'vista stock_actual',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'stock_actual' and column_name = 'exento_iva')
            then 'listo' else 'FALTA' end;
