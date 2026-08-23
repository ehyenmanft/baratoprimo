-- =====================================================================
-- BARATOPRIMO — migración: cuadre de caja
-- ---------------------------------------------------------------------
-- Para cuadrar caja hace falta saber QUIÉN emitió cada venta, y hasta
-- ahora solo se guardaba el identificador de la cuenta de acceso, que no
-- sirve para agrupar ni para imprimir un reporte.
--
-- Se añade el correo del operador que factura, con valor por defecto, y
-- se rehace ventas_detalle para exponerlo junto al nombre.
--
-- Las ventas ya emitidas quedan sin vendedor: no hay forma honesta de
-- adivinarlo hacia atrás, y ponerle un nombre inventado a una factura
-- vieja sería peor que dejarlo en blanco.
--
-- Se puede ejecutar varias veces sin romper nada.
-- =====================================================================

alter table ventas
  add column if not exists vendedor_correo text;

-- Que se rellene solo en las ventas nuevas
alter table ventas
  alter column vendedor_correo set default correo_operador();


-- ---------------------------------------------------------------------
-- La vista tiene que rehacerse: PostgreSQL congela sus columnas al
-- crearla, así que un "select v.*" viejo nunca vería la columna nueva.
-- ---------------------------------------------------------------------

drop view if exists ventas_detalle;

create view ventas_detalle as
select
  v.*,
  c.nombres, c.apellidos, c.tipo_documento, c.documento, c.telefono, c.direccion,
  trim(c.nombres || ' ' || c.apellidos) as cliente,
  c.tipo_documento || '-' || c.documento as documento_completo,
  -- Quién la emitió, para el cuadre de caja
  o.nombre as vendedor,
  (select count(*) from venta_items i where i.venta_id = v.id) as renglones,
  coalesce((select sum(p.monto_local) from venta_pagos p where p.venta_id = v.id), 0) as pagado,
  v.total - coalesce((select sum(p.monto_local) from venta_pagos p where p.venta_id = v.id), 0) as saldo_pendiente,
  (a.id is not null) as anulada,
  a.motivo  as motivo_anulacion,
  a.detalle as detalle_anulacion,
  a.anulada_en,
  a.correo  as anulada_por_correo,
  (select count(*) from cuotas q where q.venta_id = v.id and not q.pagada) as cuotas_por_cobrar
from ventas v
left join clientes c on c.id = v.cliente_id
left join anulaciones a on a.venta_id = v.id
left join operadores o on lower(o.correo) = lower(v.vendedor_correo);


-- ---------------------------------------------------------------------
-- Las formas de pago de cada venta, aplanadas para el reporte.
-- Sin esto habría que pedir los pagos venta por venta, que con un mes
-- de facturación son cientos de consultas.
-- ---------------------------------------------------------------------

drop view if exists pagos_detalle;

create view pagos_detalle as
select
  p.id, p.venta_id, p.metodo, p.referencia, p.detalle,
  p.moneda, p.monto, p.tasa, p.monto_local,
  v.comercio_id, v.numero, v.fecha, v.vendedor_correo,
  v.a_credito,
  (a.id is not null) as anulada,
  trim(c.nombres || ' ' || c.apellidos) as cliente
from venta_pagos p
join ventas v on v.id = p.venta_id
left join clientes c on c.id = v.cliente_id
left join anulaciones a on a.venta_id = v.id;


-- Permisos y modo de ejecución, que se pierden al rehacer las vistas
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on ventas_detalle, pagos_detalle to authenticated;
  end if;

  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view ventas_detalle set (security_invoker = true)';
    execute 'alter view pagos_detalle  set (security_invoker = true)';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- registrar_venta debe guardar el vendedor
-- ---------------------------------------------------------------------

create or replace function registrar_venta(p jsonb)
returns bigint language plpgsql security invoker as $BLOQUE$
declare
  v_id       bigint;
  v_numero   text;
  v_comercio bigint;
  renglon    jsonb;
begin
  v_comercio := comercio_actual();
  if v_comercio is null then
    raise exception 'Tu operador no tiene un comercio asignado';
  end if;

  perform pg_advisory_xact_lock(hashtext('ventas_correlativo_' || v_comercio));

  select 'F-' || lpad((coalesce(max(substring(numero from 3)::bigint), 0) + 1)::text, 6, '0')
    into v_numero
    from ventas
   where comercio_id = v_comercio and numero ~ '^F-[0-9]+$';

  insert into ventas (comercio_id, numero, cliente_id, iva_tasa, iva_incluido,
                      subtotal, iva_monto, total, nota,
                      tasa_referencia, total_usd, a_credito, recargo_credito,
                      vendedor_correo)
  values (
    v_comercio, v_numero,
    (p->>'cliente_id')::bigint,
    (p->>'iva_tasa')::numeric,
    coalesce((p->>'iva_incluido')::boolean, false),
    (p->>'subtotal')::numeric,
    (p->>'iva_monto')::numeric,
    (p->>'total')::numeric,
    p->>'nota',
    coalesce((p->>'tasa_referencia')::numeric, 0),
    coalesce((p->>'total_usd')::numeric, 0),
    coalesce((p->>'a_credito')::boolean, false),
    coalesce((p->>'recargo_credito')::numeric, 0),
    correo_operador()
  )
  returning id into v_id;

  for renglon in select * from jsonb_array_elements(p->'items') loop
    insert into venta_items (venta_id, producto_id, descripcion, cantidad,
                             precio_unitario, base, iva_monto, total)
    values (
      v_id,
      (renglon->>'producto_id')::bigint,
      renglon->>'descripcion',
      (renglon->>'cantidad')::numeric,
      (renglon->>'precio_unitario')::numeric,
      (renglon->>'base')::numeric,
      (renglon->>'iva_monto')::numeric,
      (renglon->>'total')::numeric
    );

    insert into movimientos (comercio_id, producto_id, tipo, cantidad, motivo, referencia)
    values (v_comercio, (renglon->>'producto_id')::bigint, 'salida',
            (renglon->>'cantidad')::numeric, 'Venta', v_numero);
  end loop;

  for renglon in select * from jsonb_array_elements(coalesce(p->'pagos', '[]'::jsonb)) loop
    insert into venta_pagos (venta_id, metodo, referencia, detalle, moneda, monto, tasa, monto_local)
    values (
      v_id,
      (renglon->>'metodo')::metodo_pago,
      nullif(renglon->>'referencia', ''),
      nullif(renglon->>'detalle', ''),
      coalesce(renglon->>'moneda', 'VES'),
      (renglon->>'monto')::numeric,
      coalesce((renglon->>'tasa')::numeric, 1),
      (renglon->>'monto_local')::numeric
    );
  end loop;

  perform registrar_cuotas(v_id, p->'cuotas');

  return v_id;
end;
$BLOQUE$;


-- ---------------------------------------------------------------------
-- Comprobación
-- ---------------------------------------------------------------------

select 'columna vendedor_correo' as pieza,
       case when exists (select 1 from information_schema.columns
                          where table_name = 'ventas' and column_name = 'vendedor_correo')
            then 'listo' else 'FALTA' end as estado
union all
select 'ventas_detalle con vendedor',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'ventas_detalle' and column_name = 'vendedor')
            then 'listo' else 'FALTA' end
union all
select 'vista pagos_detalle',
       case when to_regclass('pagos_detalle') is not null then 'listo' else 'FALTA' end;
