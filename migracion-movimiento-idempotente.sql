-- =====================================================================
-- BARATOPRIMO — migración: registro de movimientos idempotente
-- ---------------------------------------------------------------------
-- Crea la función que la aplicación usa para registrar entradas, salidas
-- y ajustes. Acepta una clave de idempotencia: si el mismo movimiento se
-- manda dos veces —porque se cortó la conexión justo después de
-- guardarlo y el navegador reintentó—, la segunda vez no vuelve a
-- descontar ni a sumar, devuelve el que ya existía.
--
-- Se puede ejecutar varias veces sin romper nada.
-- =====================================================================

alter table movimientos
  add column if not exists clave_idem text;

-- Una clave no puede repetirse dentro del mismo comercio
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'movimientos'::regclass
       and conname = 'movimientos_comercio_id_clave_idem_key'
  ) then
    alter table movimientos
      add constraint movimientos_comercio_id_clave_idem_key
      unique (comercio_id, clave_idem);
  end if;
end $$;


create or replace function registrar_movimiento(p jsonb)
returns bigint language plpgsql security invoker as $BLOQUE$
declare
  v_id    bigint;
  v_clave text;
begin
  v_clave := nullif(p->>'clave_idem', '');

  -- Reenvío: se devuelve el que ya entró, sin tocar el inventario
  if v_clave is not null then
    select id into v_id from movimientos
     where comercio_id = comercio_actual() and clave_idem = v_clave;
    if v_id is not null then return v_id; end if;
  end if;

  insert into movimientos (producto_id, tipo, cantidad, costo_unitario,
                           motivo, referencia, nota, es_negativo, fecha, clave_idem)
  values (
    (p->>'producto_id')::bigint,
    (p->>'tipo')::tipo_movimiento,
    (p->>'cantidad')::numeric,
    nullif(p->>'costo_unitario', '')::numeric,
    nullif(p->>'motivo', ''),
    nullif(p->>'referencia', ''),
    nullif(p->>'nota', ''),
    coalesce((p->>'es_negativo')::boolean, false),
    coalesce((p->>'fecha')::timestamptz, now()),
    v_clave
  )
  returning id into v_id;

  return v_id;
end;
$BLOQUE$;


do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function registrar_movimiento(jsonb) to authenticated;
  end if;
end $$;


select 'función registrar_movimiento' as pieza,
       case when exists (select 1 from pg_proc where proname = 'registrar_movimiento')
            then 'listo' else 'FALTA' end as estado
union all
select 'columna clave_idem',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'movimientos' and column_name = 'clave_idem')
            then 'listo' else 'FALTA' end;
