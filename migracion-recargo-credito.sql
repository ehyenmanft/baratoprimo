-- =====================================================================
-- BARATOPRIMO — migración: recargo por venta a crédito
-- ---------------------------------------------------------------------
-- Añade el porcentaje que se cobra de más por diferir el pago. No altera
-- el precio de la mercancía: el comprobante sigue diciendo lo que costó.
-- Se guarda para poder explicar después por qué la suma de las cuotas
-- supera al total de la venta.
--
-- Se puede ejecutar varias veces sin romper nada.
-- =====================================================================

alter table ventas
  add column if not exists recargo_credito numeric(5,2) not null default 0;

do $BLOQUE$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'ventas'::regclass and conname = 'ventas_recargo_credito_check'
  ) then
    alter table ventas
      add constraint ventas_recargo_credito_check
      check (recargo_credito >= 0 and recargo_credito <= 100);
  end if;
end $BLOQUE$;


-- La función de registro tiene que conocer el campo nuevo. Esta versión
-- parte de la que ya tienes instalada: solo le suma el recargo.

create or replace function registrar_venta(p jsonb)
returns bigint language plpgsql security invoker as $$
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

  -- Correlativo por comercio, sin huecos. El cerrojo evita que dos ventas
  -- simultáneas calculen el mismo número; se libera al cerrar la transacción.
  perform pg_advisory_xact_lock(hashtext('ventas_correlativo_' || v_comercio));

  select 'F-' || lpad((coalesce(max(substring(numero from 3)::bigint), 0) + 1)::text, 6, '0')
    into v_numero
    from ventas
   where comercio_id = v_comercio and numero ~ '^F-[0-9]+$';

  insert into ventas (comercio_id, numero, cliente_id, iva_tasa, iva_incluido,
                      subtotal, iva_monto, total, nota,
                      tasa_referencia, total_usd, a_credito, recargo_credito)
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
    coalesce((p->>'recargo_credito')::numeric, 0)
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

    -- La salida pasa por la tabla de siempre, así que el trigger de stock
    -- insuficiente sigue protegiendo la operación.
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
$$;

select 'columna recargo_credito' as pieza,
       case when exists (select 1 from information_schema.columns
                          where table_name = 'ventas' and column_name = 'recargo_credito')
            then 'listo' else 'FALTA' end as estado
union all
select 'registrar_venta actualizada',
       case when (select prosrc from pg_proc where proname = 'registrar_venta')
                 like '%recargo_credito%'
            then 'listo' else 'FALTA' end;
