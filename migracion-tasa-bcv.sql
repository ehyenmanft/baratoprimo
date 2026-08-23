-- =====================================================================
-- BARATOPRIMO — migración: tasa oficial del BCV
-- ---------------------------------------------------------------------
-- Para bases que YA están funcionando y no pueden volver a ejecutar el
-- esquema completo. Añade solo lo que falta:
--
--   · la tabla donde se guarda la tasa diaria del BCV
--   · la vista que devuelve la tasa vigente
--   · dos columnas nuevas en comercios
--   · los permisos de esas piezas
--
-- Se puede ejecutar más de una vez sin romper nada: todo comprueba antes
-- si ya existe. No toca ni un solo dato de los que ya tienes.
--
-- Pégalo entero en el editor SQL de Supabase y ejecútalo.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Dónde se guarda la tasa
-- Una fila por día. Se conserva el histórico porque una factura de hace
-- un mes tiene que poder explicarse con la tasa de aquel día.
-- ---------------------------------------------------------------------

create table if not exists tasas_cambio (
  id          bigint generated always as identity primary key,
  moneda      text not null default 'USD',
  fecha       date not null,
  tasa        numeric(14,4) not null check (tasa > 0),
  fuente      text not null,
  obtenida_en timestamptz not null default now(),
  unique (moneda, fecha)
);

create index if not exists tasas_recientes_idx on tasas_cambio (moneda, fecha desc);


-- ---------------------------------------------------------------------
-- 2. La última tasa conocida de cada moneda
-- ---------------------------------------------------------------------

create or replace view tasa_vigente as
select distinct on (moneda) moneda, fecha, tasa, fuente, obtenida_en
from tasas_cambio
order by moneda, fecha desc;


-- ---------------------------------------------------------------------
-- 3. Dos columnas nuevas en comercios
--   tasa_automatica  true  → manda la tasa del BCV
--                    false → manda la que se escriba a mano
--   moneda_precios   'USD' → el catálogo está en dólares y se cobra en
--                            bolívares al cambio del día
--                    'VES' → el catálogo está en bolívares
-- ---------------------------------------------------------------------

alter table comercios
  add column if not exists tasa_automatica boolean not null default true;

/* Los comercios NUEVOS arrancan en dólares, pero los que ya existen se
   quedan en bolívares: sus precios están escritos así, y marcarlos como
   dólares de golpe multiplicaría el catálogo por la tasa. El cambio a
   dólares se hace después, a conciencia, desde Mi comercio y usando
   Productos → Convertir precios. */
do $$
declare
  ya_estaba boolean;
begin
  ya_estaba := exists (
    select 1 from information_schema.columns
     where table_name = 'comercios' and column_name = 'moneda_precios'
  );

  if not ya_estaba then
    alter table comercios add column moneda_precios text not null default 'USD';
    -- Lo que ya existía conserva el significado que tenía
    update comercios set moneda_precios = 'VES';
    raise notice 'Los comercios existentes quedan en bolívares. Cámbialos a dólares desde Mi comercio cuando conviertas el catálogo.';
  end if;
end $$;

-- La restricción se añade aparte, porque add column no la vuelve a crear
-- si la columna ya estaba.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'comercios'::regclass and conname = 'comercios_moneda_precios_check'
  ) then
    alter table comercios
      add constraint comercios_moneda_precios_check
      check (moneda_precios in ('VES', 'USD'));
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 4. Quién puede leer y escribir la tasa
-- La lee cualquiera con sesión. La escribe la función que consulta al
-- BCV, que corre con la llave de servicio y se salta las políticas, y
-- un administrador cuando necesita corregirla a mano.
-- ---------------------------------------------------------------------

alter table tasas_cambio enable row level security;

drop policy if exists "ver tasas" on tasas_cambio;
create policy "ver tasas" on tasas_cambio
  for select to authenticated using (true);

drop policy if exists "corregir tasas" on tasas_cambio;
create policy "corregir tasas" on tasas_cambio
  for all to authenticated
  using (es_administrador()) with check (es_administrador());


-- ---------------------------------------------------------------------
-- 5. Permisos de tabla
-- RLS decide qué filas ve cada quien, pero antes hace falta el permiso
-- sobre la tabla.
-- ---------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on tasas_cambio to authenticated;
    grant select on tasa_vigente to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
    raise notice 'Permisos concedidos';
  end if;
end $$;

-- La vista se ejecuta con los permisos de quien consulta
do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view tasa_vigente set (security_invoker = true)';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 6. Comprobación
-- Si todo salió bien, esto devuelve tres filas con "listo".
-- ---------------------------------------------------------------------

select 'tabla tasas_cambio' as pieza,
       case when to_regclass('tasas_cambio') is not null then 'listo' else 'FALTA' end as estado
union all
select 'vista tasa_vigente',
       case when to_regclass('tasa_vigente') is not null then 'listo' else 'FALTA' end
union all
select 'columnas en comercios',
       case when (select count(*) from information_schema.columns
                   where table_name = 'comercios'
                     and column_name in ('tasa_automatica', 'moneda_precios')) = 2
            then 'listo' else 'FALTA' end;
