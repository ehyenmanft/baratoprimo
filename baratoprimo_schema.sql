-- =====================================================================
-- BARATOPRIMO — esquema completo para Supabase (PostgreSQL)
-- ---------------------------------------------------------------------
-- Multi-comercio: cada comercio tiene su catálogo, su inventario, sus
-- clientes y sus ventas, y no ve los de nadie más. El aislamiento no
-- depende de que la aplicación filtre bien: está en las políticas RLS,
-- que se aplican aunque alguien llame a la API a mano.
--
-- Jerarquía de acceso:
--   super_admin          crea y elimina comercios, asigna operadores a
--                        cualquiera de ellos, y trabaja sobre el comercio
--                        que tenga seleccionado. Nadie más puede tocarlo.
--   administrador        manda dentro de su comercio: operadores, ajustes,
--                        anulaciones e inventario.
--   operador_inventario  almacén de su comercio.
--   operador_facturador  ventas y clientes de su comercio.
--   operador_mixto       ambas, salvo dar de baja productos.
--
-- Ejecutar entero, de una sola vez, en el editor SQL de Supabase.
-- =====================================================================


-- =====================================================================
-- 1. TIPOS
-- =====================================================================

create type tipo_movimiento as enum ('entrada', 'salida', 'ajuste');

-- Prefijos fiscales venezolanos: V/E para personas, J/G/P para jurídicos
create type tipo_documento as enum ('V', 'E', 'J', 'G', 'P');

create type metodo_pago as enum (
  'debito', 'efectivo_bs', 'efectivo_usd', 'efectivo_eur',
  'pago_movil', 'transferencia', 'otro', 'credito'
);

create type motivo_anulacion as enum (
  'error_facturacion', 'devolucion', 'pago_rechazado',
  'no_entregado', 'duplicada', 'otro'
);

create type rol_operador as enum (
  'super_admin',
  'administrador',
  'operador_inventario',
  'operador_facturador',
  'operador_mixto'
);


-- =====================================================================
-- 2. COMERCIOS Y OPERADORES
-- Van primero porque de ellos cuelga todo lo demás.
-- =====================================================================

create table comercios (
  id             bigint generated always as identity primary key,
  nombre         text not null,
  rif            text not null default '',
  direccion      text default '',
  telefono       text default '',
  correo         text default '',
  mensaje        text default '¡Gracias por su compra!',
  iva_tasa       numeric(5,2) not null default 16,
  moneda         text not null default 'Bs',
  tasa_usd       numeric(14,4) not null default 0,
  tasa_eur       numeric(14,4) not null default 0,
  ticket_ancho   text not null default '80',
  /* true: la tasa del dólar la toma del BCV cada día. false: manda la
     que se escriba a mano en tasa_usd. */
  tasa_automatica boolean not null default true,
  /* Moneda en la que están escritos los precios del catálogo. Con 'USD'
     el precio se guarda en dólares y se cobra en bolívares al cambio del
     día; con 'VES' es al revés. */
  moneda_precios text not null default 'USD' check (moneda_precios in ('VES', 'USD')),
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table operadores (
  id          bigint generated always as identity primary key,
  usuario_id  uuid unique references auth.users(id) on delete cascade,
  correo      text not null unique,
  nombre      text not null,
  rol         rol_operador not null default 'operador_facturador',
  -- Comercio en el que trabaja. Para el super_admin es el que tiene
  -- seleccionado ahora mismo, y puede cambiarlo cuando quiera.
  comercio_id bigint references comercios(id) on delete restrict,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

create index operadores_correo_idx   on operadores (lower(correo));
create index operadores_comercio_idx on operadores (comercio_id);


-- =====================================================================
-- 3. QUIÉN ES QUIEN CONSULTA
-- Todas en security definer: leen la tabla de operadores y el esquema
-- auth, a los que el rol de la aplicación no llega por sí solo. Además
-- evita la recursión: si respetaran RLS, las políticas de operadores se
-- llamarían a sí mismas.
-- =====================================================================

create or replace function operador_actual()
returns operadores
language sql stable security definer
set search_path = public
as $$
  select o.* from operadores o
   where o.activo
     and (o.usuario_id = auth.uid()
          or lower(o.correo) = lower(coalesce(auth.jwt() ->> 'email', '')))
   limit 1;
$$;

create or replace function rol_actual() returns rol_operador
language sql stable as $$ select (operador_actual()).rol $$;

create or replace function comercio_actual() returns bigint
language sql stable as $$ select (operador_actual()).comercio_id $$;

create or replace function correo_operador() returns text
language sql stable as $$ select (operador_actual()).correo $$;

create or replace function es_super_admin() returns boolean
language sql stable as $$ select rol_actual() = 'super_admin' $$;

create or replace function es_administrador() returns boolean
language sql stable as $$ select rol_actual() in ('super_admin', 'administrador') $$;

create or replace function puede_inventario() returns boolean
language sql stable as $$
  select rol_actual() in ('super_admin','administrador','operador_inventario','operador_mixto')
$$;

create or replace function puede_facturar() returns boolean
language sql stable as $$
  select rol_actual() in ('super_admin','administrador','operador_facturador','operador_mixto')
$$;

-- El operador mixto queda fuera a propósito
create or replace function puede_dar_de_baja() returns boolean
language sql stable as $$
  select rol_actual() in ('super_admin','administrador','operador_inventario')
$$;


-- =====================================================================
-- 4. CATÁLOGO
-- =====================================================================

create table categorias (
  id          bigint generated always as identity primary key,
  comercio_id bigint not null references comercios(id) on delete cascade
              default comercio_actual(),
  nombre      text not null,
  creado_en   timestamptz not null default now(),
  unique (comercio_id, nombre)
);

create table productos (
  id             bigint generated always as identity primary key,
  comercio_id    bigint not null references comercios(id) on delete cascade
                 default comercio_actual(),
  sku            text not null,
  nombre         text not null,
  descripcion    text,
  categoria_id   bigint references categorias(id) on delete set null,
  unidad         text not null default 'unidad',
  costo          numeric(14,2) not null default 0,
  precio_venta   numeric(14,2) not null default 0,
  stock_minimo   numeric(14,3) not null default 0,
  imagen_path    text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  -- El código de un comercio no estorba al de otro
  unique (comercio_id, sku)
);

create index productos_comercio_idx  on productos (comercio_id);
create index productos_categoria_idx on productos (categoria_id);
create index productos_activo_idx    on productos (comercio_id, activo);


-- =====================================================================
-- 5. KARDEX — la fuente de verdad del stock
-- =====================================================================

create table movimientos (
  id             bigint generated always as identity primary key,
  comercio_id    bigint references comercios(id) on delete cascade,
  producto_id    bigint not null references productos(id) on delete restrict,
  tipo           tipo_movimiento not null,
  -- Siempre positiva: el signo lo da 'tipo', y 'es_negativo' en los ajustes
  cantidad       numeric(14,3) not null check (cantidad > 0),
  costo_unitario numeric(14,2),
  motivo         text,
  referencia     text,
  nota           text,
  es_negativo    boolean not null default false,
  fecha          timestamptz not null default now(),
  creado_por     uuid references auth.users(id) default auth.uid()
);

create index movimientos_producto_idx on movimientos (producto_id, fecha desc);
create index movimientos_comercio_idx on movimientos (comercio_id, fecha desc);

create or replace function cantidad_signada(
  p_tipo tipo_movimiento, p_cantidad numeric, p_es_negativo boolean
) returns numeric language sql immutable as $$
  select case
    when p_tipo = 'entrada' then p_cantidad
    when p_tipo = 'salida'  then -p_cantidad
    when p_tipo = 'ajuste' and p_es_negativo then -p_cantidad
    else p_cantidad
  end;
$$;

-- Un movimiento no puede pertenecer a un comercio distinto al del producto
create or replace function validar_comercio_movimiento() returns trigger
language plpgsql as $$
declare
  v_comercio bigint;
begin
  select comercio_id into v_comercio from productos where id = new.producto_id;
  if new.comercio_id is null then
    new.comercio_id := v_comercio;
  elsif new.comercio_id <> v_comercio then
    raise exception 'El producto pertenece a otro comercio';
  end if;
  return new;
end;
$$;

create trigger trg_comercio_movimiento
  before insert on movimientos
  for each row execute function validar_comercio_movimiento();

-- No se permite dejar el stock en negativo
create or replace function validar_stock() returns trigger
language plpgsql as $$
declare
  saldo numeric;
begin
  if new.tipo = 'salida' or (new.tipo = 'ajuste' and new.es_negativo) then
    select coalesce(sum(cantidad_signada(tipo, cantidad, es_negativo)), 0)
      into saldo from movimientos where producto_id = new.producto_id;

    if saldo - new.cantidad < 0 then
      raise exception 'Stock insuficiente: disponible %, solicitado %', saldo, new.cantidad;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_validar_stock
  before insert on movimientos
  for each row execute function validar_stock();

create or replace function touch_actualizado_en() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

create trigger trg_productos_touch
  before update on productos
  for each row execute function touch_actualizado_en();

-- El operador mixto no da de baja productos. Va en un trigger porque es
-- un update de la columna 'activo', no un delete.
create or replace function validar_baja_producto() returns trigger
language plpgsql as $$
begin
  if old.activo and not new.activo and not puede_dar_de_baja() then
    raise exception 'Tu rol no permite dar de baja productos';
  end if;
  return new;
end;
$$;

create trigger trg_baja_producto
  before update on productos
  for each row execute function validar_baja_producto();


-- =====================================================================
-- 6. VISTAS DE INVENTARIO
-- No filtran por comercio: de eso se encargan las políticas RLS de las
-- tablas de abajo, con security_invoker activado al final del archivo.
-- =====================================================================

create view stock_actual as
select
  p.id            as producto_id,
  p.comercio_id,
  p.sku, p.nombre, p.unidad, p.categoria_id,
  c.nombre        as categoria,
  p.stock_minimo, p.costo, p.precio_venta, p.imagen_path,
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

create view kardex as
select
  m.id, m.comercio_id, m.producto_id, p.sku, p.nombre,
  m.fecha, m.tipo, m.motivo, m.referencia,
  cantidad_signada(m.tipo, m.cantidad, m.es_negativo) as cantidad,
  sum(cantidad_signada(m.tipo, m.cantidad, m.es_negativo))
    over (partition by m.producto_id order by m.fecha, m.id) as saldo,
  m.costo_unitario, m.nota
from movimientos m
join productos p on p.id = m.producto_id;


-- =====================================================================
-- 7. CLIENTES
-- =====================================================================

create table clientes (
  id             bigint generated always as identity primary key,
  comercio_id    bigint not null references comercios(id) on delete cascade
                 default comercio_actual(),
  nombres        text not null,
  apellidos      text not null default '',
  tipo_documento tipo_documento not null default 'V',
  documento      text not null,
  telefono       text,
  direccion      text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  -- El mismo cliente puede existir en dos comercios distintos
  unique (comercio_id, tipo_documento, documento)
);

create index clientes_comercio_idx on clientes (comercio_id, apellidos, nombres);


-- =====================================================================
-- 8. VENTAS
-- =====================================================================

create table ventas (
  id              bigint generated always as identity primary key,
  comercio_id     bigint not null references comercios(id) on delete cascade
                  default comercio_actual(),
  numero          text not null,
  cliente_id      bigint references clientes(id) on delete restrict,
  fecha           timestamptz not null default now(),
  iva_tasa        numeric(5,2) not null default 16,
  -- true: el precio de lista ya lleva el IVA dentro y se desglosa
  iva_incluido    boolean not null default false,
  subtotal        numeric(14,2) not null,
  iva_monto       numeric(14,2) not null,
  total           numeric(14,2) not null,
  nota            text,
  tasa_referencia numeric(14,4) not null default 0,
  total_usd       numeric(14,2) not null default 0,
  a_credito       boolean not null default false,
  creado_por      uuid references auth.users(id) default auth.uid(),
  -- Cada comercio lleva su propio correlativo
  unique (comercio_id, numero)
);

create index ventas_comercio_idx on ventas (comercio_id, fecha desc);
create index ventas_cliente_idx  on ventas (cliente_id);

create table venta_items (
  id              bigint generated always as identity primary key,
  venta_id        bigint not null references ventas(id) on delete cascade,
  producto_id     bigint not null references productos(id) on delete restrict,
  descripcion     text not null,               -- congelada al momento de vender
  cantidad        numeric(14,3) not null check (cantidad > 0),
  precio_unitario numeric(14,2) not null,
  base            numeric(14,2) not null,
  iva_monto       numeric(14,2) not null,
  total           numeric(14,2) not null
);

create index venta_items_venta_idx on venta_items (venta_id);

-- Una venta puede pagarse con varias formas a la vez
create table venta_pagos (
  id          bigint generated always as identity primary key,
  venta_id    bigint not null references ventas(id) on delete cascade,
  metodo      metodo_pago not null,
  -- Últimos 6 dígitos de la operación (débito, pago móvil, transferencia)
  referencia  text check (referencia is null or referencia ~ '^[0-9]{1,6}$'),
  detalle     text,
  moneda      text not null default 'VES',
  monto       numeric(14,2) not null check (monto > 0),
  tasa        numeric(14,4) not null default 1,
  monto_local numeric(14,2) not null
);

create index venta_pagos_venta_idx on venta_pagos (venta_id);

-- Crédito: lo que queda financiado, en cuotas expresadas en dólares
create table cuotas (
  id              bigint generated always as identity primary key,
  venta_id        bigint not null references ventas(id) on delete cascade,
  numero          int not null,
  -- Mínimo a abonar en ese vencimiento
  monto_usd       numeric(14,2) not null check (monto_usd > 0),
  tasa_referencia numeric(14,4) not null,
  vence_en        date not null,
  pagada          boolean not null default false,
  pagada_en       timestamptz,
  monto_pagado    numeric(14,2),
  tasa_pago       numeric(14,4),
  unique (venta_id, numero)
);

create index cuotas_pendientes_idx on cuotas (pagada, vence_en);
create index cuotas_venta_idx      on cuotas (venta_id);

-- Una venta emitida no se edita ni se borra: se anula
create table anulaciones (
  id          bigint generated always as identity primary key,
  venta_id    bigint not null unique references ventas(id) on delete restrict,
  motivo      motivo_anulacion not null,
  detalle     text,
  anulada_en  timestamptz not null default now(),
  anulada_por uuid references auth.users(id) default auth.uid(),
  correo      text
);


-- ---------------------------------------------------------------------
-- Tasas de cambio oficiales.
-- La tasa del BCV es nacional, no de cada comercio, así que la tabla es
-- común. Se guarda el histórico —una fila por día— porque una factura
-- emitida hace un mes tiene que poder explicarse con la tasa de aquel
-- día, no con la de hoy.
-- ---------------------------------------------------------------------

create table tasas_cambio (
  id          bigint generated always as identity primary key,
  moneda      text not null default 'USD',
  fecha       date not null,
  tasa        numeric(14,4) not null check (tasa > 0),
  fuente      text not null,              -- bcv, bdv, respaldo…
  obtenida_en timestamptz not null default now(),
  unique (moneda, fecha)
);

create index tasas_recientes_idx on tasas_cambio (moneda, fecha desc);

-- La última tasa conocida de cada moneda
create view tasa_vigente as
select distinct on (moneda) moneda, fecha, tasa, fuente, obtenida_en
from tasas_cambio
order by moneda, fecha desc;


-- =====================================================================
-- 9. VISTAS COMERCIALES
-- =====================================================================

create view ventas_detalle as
select
  v.*,
  c.nombres, c.apellidos, c.tipo_documento, c.documento, c.telefono, c.direccion,
  trim(c.nombres || ' ' || c.apellidos) as cliente,
  c.tipo_documento || '-' || c.documento as documento_completo,
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
left join anulaciones a on a.venta_id = v.id;

-- Cobranza: cada cuota pendiente con su cliente y su comprobante
create view cuotas_pendientes as
select
  q.id, q.venta_id, q.numero, q.monto_usd, q.tasa_referencia, q.vence_en,
  v.comercio_id,
  v.numero    as comprobante,
  v.fecha     as fecha_venta,
  v.total_usd as total_venta_usd,
  c.id        as cliente_id,
  trim(c.nombres || ' ' || c.apellidos) as cliente,
  c.tipo_documento || '-' || c.documento as documento,
  c.telefono, c.direccion,
  (current_date - q.vence_en) as dias_vencida,
  (select count(*) from cuotas x where x.venta_id = q.venta_id and not x.pagada) as cuotas_pendientes,
  (select count(*) from cuotas x where x.venta_id = q.venta_id) as cuotas_totales
from cuotas q
join ventas v on v.id = q.venta_id
left join clientes c on c.id = v.cliente_id
where not q.pagada
  and not exists (select 1 from anulaciones a where a.venta_id = q.venta_id)
order by q.vence_en;

-- El comercio en el que trabaja quien consulta
create view mi_comercio as
select * from comercios where id = comercio_actual();


-- =====================================================================
-- 10. OPERACIONES DE NEGOCIO
-- Cada una en una sola transacción: si algo falla, no queda nada a medias.
-- =====================================================================

create or replace function registrar_cuotas(p_venta_id bigint, p_cuotas jsonb)
returns void language plpgsql security invoker as $$
declare c jsonb;
begin
  for c in select * from jsonb_array_elements(coalesce(p_cuotas, '[]'::jsonb)) loop
    insert into cuotas (venta_id, numero, monto_usd, tasa_referencia, vence_en)
    values (p_venta_id, (c->>'numero')::int, (c->>'monto_usd')::numeric,
            (c->>'tasa_referencia')::numeric, (c->>'vence_en')::date);
  end loop;
end;
$$;

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
                      tasa_referencia, total_usd, a_credito)
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
    coalesce((p->>'a_credito')::boolean, false)
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

-- ---------------------------------------------------------------------
-- Anulación: marca el comprobante, devuelve la mercancía y deja rastro
-- ---------------------------------------------------------------------

create or replace function anular_venta(p_venta_id bigint, p_motivo text, p_detalle text default null)
returns bigint language plpgsql security invoker as $$
declare
  v_numero   text;
  v_comercio bigint;
  renglon    record;
begin
  if not es_administrador() then
    raise exception 'Solo un administrador puede anular ventas';
  end if;

  select numero, comercio_id into v_numero, v_comercio
    from ventas where id = p_venta_id;
  if v_numero is null then
    raise exception 'La venta % no existe', p_venta_id;
  end if;
  if v_comercio is distinct from comercio_actual() then
    raise exception 'Esa venta pertenece a otro comercio';
  end if;
  if exists (select 1 from anulaciones where venta_id = p_venta_id) then
    raise exception 'El comprobante % ya está anulado', v_numero;
  end if;
  if p_motivo = 'otro' and coalesce(trim(p_detalle), '') = '' then
    raise exception 'Indica el motivo de la anulación';
  end if;

  insert into anulaciones (venta_id, motivo, detalle, correo)
  values (p_venta_id, p_motivo::motivo_anulacion, nullif(trim(p_detalle), ''),
          correo_operador());

  for renglon in select producto_id, cantidad from venta_items where venta_id = p_venta_id loop
    insert into movimientos (comercio_id, producto_id, tipo, cantidad, motivo, referencia)
    values (v_comercio, renglon.producto_id, 'entrada', renglon.cantidad,
            'Anulación de venta', v_numero);
  end loop;

  return p_venta_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Cobro de una cuota. El monto de la cuota es el mínimo del vencimiento:
-- se admite abonar de más y el excedente adelanta las siguientes.
-- ---------------------------------------------------------------------

create or replace function pagar_cuota(
  p_cuota_id bigint, p_metodo text, p_monto numeric,
  p_tasa numeric default 1, p_referencia text default null)
returns bigint language plpgsql security invoker as $$
declare
  q           record;
  siguiente   record;
  v_tasa      numeric;
  abono_usd   numeric;
  sobra       numeric;
  adelantadas text := '';
begin
  if not puede_facturar() then
    raise exception 'Tu rol no permite registrar cobros';
  end if;

  select c.* into q from cuotas c
    join ventas v on v.id = c.venta_id
   where c.id = p_cuota_id and v.comercio_id = comercio_actual();
  if q is null then raise exception 'La cuota no existe'; end if;
  if q.pagada then raise exception 'Esa cuota ya está pagada'; end if;

  v_tasa := coalesce(nullif(p_tasa, 0), 1);
  abono_usd := round(p_monto / v_tasa, 2);

  if abono_usd + 0.005 < q.monto_usd then
    raise exception 'El mínimo de esta cuota es % USD', round(q.monto_usd, 2);
  end if;

  update cuotas
     set pagada = true, pagada_en = now(),
         monto_pagado = round(q.monto_usd * v_tasa, 2), tasa_pago = v_tasa
   where id = p_cuota_id;

  sobra := round(abono_usd - q.monto_usd, 2);

  for siguiente in
    select * from cuotas
     where venta_id = q.venta_id and not pagada and id <> p_cuota_id
     order by numero
  loop
    exit when sobra <= 0.005;

    if sobra + 0.005 >= siguiente.monto_usd then
      sobra := round(sobra - siguiente.monto_usd, 2);
      update cuotas
         set pagada = true, pagada_en = now(),
             monto_pagado = round(siguiente.monto_usd * v_tasa, 2), tasa_pago = v_tasa
       where id = siguiente.id;
      adelantadas := adelantadas ||
        case when adelantadas = '' then '' else ',' end || ' ' || siguiente.numero;
    else
      -- Abono parcial: rebaja el mínimo que le queda a esa cuota
      update cuotas set monto_usd = round(monto_usd - sobra, 2) where id = siguiente.id;
      sobra := 0;
    end if;
  end loop;

  insert into venta_pagos (venta_id, metodo, referencia, detalle, moneda, monto, tasa, monto_local)
  values (q.venta_id, p_metodo::metodo_pago, nullif(p_referencia, ''),
          'Cuota ' || q.numero || case when adelantadas <> '' then ' y' || adelantadas else '' end,
          'VES', p_monto, v_tasa, p_monto);

  return p_cuota_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Alta de comercio. La usa el super administrador desde su pantalla.
-- ---------------------------------------------------------------------

create or replace function crear_comercio(p jsonb)
returns bigint language plpgsql security invoker as $$
declare v_id bigint;
begin
  if not es_super_admin() then
    raise exception 'Solo el super administrador puede crear comercios';
  end if;

  insert into comercios (nombre, rif, direccion, telefono, correo, mensaje,
                         iva_tasa, moneda, tasa_usd, tasa_eur, ticket_ancho)
  values (
    coalesce(nullif(trim(p->>'nombre'), ''), 'Comercio sin nombre'),
    coalesce(p->>'rif', ''), coalesce(p->>'direccion', ''),
    coalesce(p->>'telefono', ''), coalesce(p->>'correo', ''),
    coalesce(nullif(p->>'mensaje', ''), '¡Gracias por su compra!'),
    coalesce((p->>'iva_tasa')::numeric, 16),
    coalesce(nullif(p->>'moneda', ''), 'Bs'),
    coalesce((p->>'tasa_usd')::numeric, 0),
    coalesce((p->>'tasa_eur')::numeric, 0),
    coalesce(nullif(p->>'ticket_ancho', ''), '80')
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- =====================================================================
-- 11. SEGURIDAD
-- El aislamiento entre comercios vive aquí. Leer, escribir o borrar
-- exige que la fila sea del comercio en el que trabaja quien consulta.
-- =====================================================================

alter table comercios   enable row level security;
alter table operadores  enable row level security;
alter table categorias  enable row level security;
alter table productos   enable row level security;
alter table movimientos enable row level security;
alter table clientes    enable row level security;
alter table ventas      enable row level security;
alter table venta_items enable row level security;
alter table venta_pagos enable row level security;
alter table cuotas      enable row level security;
alter table anulaciones enable row level security;

-- ---------------------------------------------------------------------
-- Comercios: el super admin los ve todos; el resto, solo el suyo.
-- ---------------------------------------------------------------------

create policy "ver comercios" on comercios
  for select to authenticated
  using (es_super_admin() or id = comercio_actual());

create policy "crear comercios" on comercios
  for insert to authenticated with check (es_super_admin());

-- El administrador ajusta los datos de su comercio; crearlos o borrarlos
-- es cosa del super admin.
create policy "editar comercios" on comercios
  for update to authenticated
  using (es_super_admin() or (es_administrador() and id = comercio_actual()))
  with check (es_super_admin() or (es_administrador() and id = comercio_actual()));

create policy "eliminar comercios" on comercios
  for delete to authenticated using (es_super_admin());

-- ---------------------------------------------------------------------
-- Operadores: el super admin es intocable para los demás.
-- ---------------------------------------------------------------------

create policy "ver operadores" on operadores
  for select to authenticated
  using (es_super_admin()
         or comercio_id = comercio_actual()
         or usuario_id = auth.uid()
         or lower(correo) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Crear: el super admin, en cualquier comercio. El administrador, solo en
-- el suyo y sin poder nombrar super administradores.
create policy "crear operadores" on operadores
  for insert to authenticated
  with check (es_super_admin()
              or (es_administrador()
                  and comercio_id = comercio_actual()
                  and rol <> 'super_admin'));

-- USING mira la fila vieja: así ningún administrador toca a un super
-- admin. WITH CHECK mira la nueva: así tampoco puede ascender a nadie.
create policy "editar operadores" on operadores
  for update to authenticated
  using (es_super_admin()
         or (es_administrador() and comercio_id = comercio_actual() and rol <> 'super_admin'))
  with check (es_super_admin()
              or (es_administrador() and comercio_id = comercio_actual() and rol <> 'super_admin'));

create policy "eliminar operadores" on operadores
  for delete to authenticated
  using (es_super_admin()
         or (es_administrador() and comercio_id = comercio_actual() and rol <> 'super_admin'));

-- ---------------------------------------------------------------------
-- Catálogo e inventario: siempre dentro del comercio.
-- ---------------------------------------------------------------------

create policy "ver categorias" on categorias
  for select to authenticated using (comercio_id = comercio_actual());
create policy "escribir categorias" on categorias
  for all to authenticated
  using (comercio_id = comercio_actual() and puede_inventario())
  with check (comercio_id = comercio_actual() and puede_inventario());

create policy "ver productos" on productos
  for select to authenticated using (comercio_id = comercio_actual());
create policy "crear productos" on productos
  for insert to authenticated
  with check (comercio_id = comercio_actual() and puede_inventario());
create policy "editar productos" on productos
  for update to authenticated
  using (comercio_id = comercio_actual() and puede_inventario())
  with check (comercio_id = comercio_actual() and puede_inventario());
create policy "eliminar productos" on productos
  for delete to authenticated
  using (comercio_id = comercio_actual() and es_administrador());

create policy "ver movimientos" on movimientos
  for select to authenticated using (comercio_id = comercio_actual());
-- Las salidas por venta las inserta registrar_venta(), que corre con los
-- permisos de quien factura.
create policy "insertar movimientos" on movimientos
  for insert to authenticated
  with check (comercio_id = comercio_actual()
              and (puede_inventario() or (motivo in ('Venta', 'Anulación de venta')
                                          and puede_facturar())));

-- ---------------------------------------------------------------------
-- Clientes y ventas: facturación, dentro del comercio.
-- ---------------------------------------------------------------------

create policy "ver clientes" on clientes
  for select to authenticated using (comercio_id = comercio_actual());
create policy "escribir clientes" on clientes
  for all to authenticated
  using (comercio_id = comercio_actual() and puede_facturar())
  with check (comercio_id = comercio_actual() and puede_facturar());

create policy "ver ventas" on ventas
  for select to authenticated using (comercio_id = comercio_actual());
create policy "insertar ventas" on ventas
  for insert to authenticated
  with check (comercio_id = comercio_actual() and puede_facturar());

-- Las tablas hijas heredan el comercio de su venta
create policy "ver renglones" on venta_items
  for select to authenticated
  using (exists (select 1 from ventas v
                  where v.id = venta_id and v.comercio_id = comercio_actual()));
create policy "insertar renglones" on venta_items
  for insert to authenticated
  with check (puede_facturar() and exists (select 1 from ventas v
                  where v.id = venta_id and v.comercio_id = comercio_actual()));

create policy "ver pagos" on venta_pagos
  for select to authenticated
  using (exists (select 1 from ventas v
                  where v.id = venta_id and v.comercio_id = comercio_actual()));
create policy "insertar pagos" on venta_pagos
  for insert to authenticated
  with check (puede_facturar() and exists (select 1 from ventas v
                  where v.id = venta_id and v.comercio_id = comercio_actual()));

create policy "ver cuotas" on cuotas
  for select to authenticated
  using (exists (select 1 from ventas v
                  where v.id = venta_id and v.comercio_id = comercio_actual()));
create policy "crear cuotas" on cuotas
  for insert to authenticated
  with check (puede_facturar() and exists (select 1 from ventas v
                  where v.id = venta_id and v.comercio_id = comercio_actual()));
create policy "cobrar cuotas" on cuotas
  for update to authenticated
  using (puede_facturar() and exists (select 1 from ventas v
                  where v.id = venta_id and v.comercio_id = comercio_actual()))
  with check (puede_facturar());

create policy "ver anulaciones" on anulaciones
  for select to authenticated
  using (exists (select 1 from ventas v
                  where v.id = venta_id and v.comercio_id = comercio_actual()));
create policy "anular solo administrador" on anulaciones
  for insert to authenticated
  with check (es_administrador() and exists (select 1 from ventas v
                  where v.id = venta_id and v.comercio_id = comercio_actual()));


-- =====================================================================
-- 12. ALMACENAMIENTO DE IMÁGENES
-- El bloque solo corre si existe el esquema 'storage', de modo que este
-- archivo sigue siendo válido en un PostgreSQL normal.
-- =====================================================================

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then

    insert into storage.buckets (id, name, public)
    values ('inventario', 'inventario', true)
    on conflict (id) do update set public = true;

    drop policy if exists "inventario imagenes visibles" on storage.objects;
    create policy "inventario imagenes visibles" on storage.objects
      for select using (bucket_id = 'inventario');

    drop policy if exists "inventario subir imagenes" on storage.objects;
    create policy "inventario subir imagenes" on storage.objects
      for insert to authenticated with check (bucket_id = 'inventario' and puede_inventario());

    drop policy if exists "inventario reemplazar imagenes" on storage.objects;
    create policy "inventario reemplazar imagenes" on storage.objects
      for update to authenticated
      using (bucket_id = 'inventario' and puede_inventario())
      with check (bucket_id = 'inventario' and puede_inventario());

    raise notice 'Bucket de imágenes listo';
  else
    raise notice 'Sin esquema storage: se omite la creación del bucket';
  end if;
end $$;


-- =====================================================================
-- 13. PERMISOS DE TABLA
-- RLS decide QUÉ filas ve cada quien, pero antes hace falta el permiso
-- de tabla. Al rol anónimo no se le concede nada: todo exige sesión.
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;

    alter default privileges in schema public
      grant select, insert, update, delete on tables to authenticated;
    alter default privileges in schema public
      grant usage, select on sequences to authenticated;
    alter default privileges in schema public
      grant execute on functions to authenticated;

    raise notice 'Permisos concedidos al rol authenticated';
  end if;
end $$;

-- Las vistas se ejecutan con los permisos de quien consulta, para que las
-- políticas RLS de las tablas de abajo sigan aplicando. PostgreSQL 15+.
do $$
declare v text;
begin
  if current_setting('server_version_num')::int >= 150000 then
    foreach v in array array['stock_actual','alertas_stock','kardex',
                             'ventas_detalle','cuotas_pendientes','mi_comercio',
                             'tasa_vigente'] loop
      execute format('alter view %I set (security_invoker = true)', v);
    end loop;
    raise notice 'Vistas con security_invoker activado';
  end if;
end $$;


-- =====================================================================
-- 14. CONSULTA DIARIA DE LA TASA
-- Programa la función tasa-bcv para que corra sola cada día. Ejecuta
-- este bloque APARTE, después de desplegar la función y sustituyendo la
-- llave, porque necesita extensiones que se activan una sola vez.
-- =====================================================================

/*
-- 1. Extensiones necesarias
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Dos consultas al día, a las 8:30 y a las 14:30 de Caracas.
--    El BCV publica por la mañana, pero a veces corrige después; el
--    segundo intento recoge esa corrección. Las horas van en UTC, que
--    lleva cuatro horas de adelanto sobre Venezuela.
select cron.schedule(
  'tasa-bcv-manana',
  '30 12 * * 1-5',        -- 08:30 en Caracas, de lunes a viernes
  $$
  select net.http_post(
    url     := 'https://TU-PROYECTO.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json",
                 "Authorization": "Bearer TU-LLAVE-ANON"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'tasa-bcv-tarde',
  '30 18 * * 1-5',        -- 14:30 en Caracas
  $$
  select net.http_post(
    url     := 'https://TU-PROYECTO.supabase.co/functions/v1/tasa-bcv',
    headers := '{"Content-Type": "application/json",
                 "Authorization": "Bearer TU-LLAVE-ANON"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- Para ver qué hay programado:
--   select jobname, schedule, active from cron.job;
-- Para ver si las últimas corridas funcionaron:
--   select jobid, status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 10;
-- Para quitar una:
--   select cron.unschedule('tasa-bcv-manana');
*/


-- =====================================================================
-- 15. PRIMER ARRANQUE
-- Ejecuta esto UNA VEZ, con el correo con el que vas a entrar. Crea el
-- comercio inicial y te registra como super administrador.
--
--   insert into comercios (nombre, rif) values ('Mi Comercio', 'J-00000000-0');
--
--   insert into operadores (correo, nombre, rol, comercio_id)
--   values ('tu@correo.com', 'Tu nombre', 'super_admin',
--           (select id from comercios order by id limit 1));
--
-- El usuario de Authentication debe existir con ese mismo correo.
-- =====================================================================
