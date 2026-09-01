-- =====================================================================
-- BARATOPRIMO — Migración: Solicitudes de Registro y Logo de Comercio
-- ---------------------------------------------------------------------
-- Ejecuta este script completo en el SQL Editor de Supabase.
-- Corrige el error "Database error saving new user" eliminando triggers
-- conflictivos sobre auth.users y habilitando la función RPC y políticas RLS.
-- =====================================================================

-- 1. ELIMINAR CUALQUIER TRIGGER CONFLICTIVO SOBRE auth.users
-- (Esto resuelve inmediatamente el error "Database error saving new user")
drop trigger if exists tr_nuevo_usuario_auth on auth.users;
drop function if exists public.manejar_nuevo_usuario_auth();

-- 2. ASEGURAR COLUMNAS EN TABLA COMERCIOS Y OPERADORES
alter table public.comercios add column if not exists logo_url text default null;
alter table public.operadores add column if not exists comercio_solicitado text default null;

-- 3. RECREAR LA VISTA mi_comercio
drop view if exists public.mi_comercio;
create view public.mi_comercio as
select * from public.comercios where id = public.comercio_actual();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.mi_comercio to authenticated;
  end if;
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view public.mi_comercio set (security_invoker = true)';
  end if;
end $$;

-- 4. POLÍTICA RLS PARA PERMITIR INSERCIÓN DE SOLICITUDES PENDIENTES
do $$
begin
  -- Eliminar versiones anteriores si existían
  drop policy if exists "solicitar operador publico" on public.operadores;
  
  create policy "solicitar operador publico" on public.operadores
    for insert to anon, authenticated
    with check (activo = false and comercio_id is null and rol <> 'super_admin'::public.rol_operador);
end $$;

-- 5. FUNCIÓN RPC SEGURA PARA REGISTRAR SOLICITUDES (SECURITY DEFINER)
create or replace function public.solicitar_registro(p jsonb)
returns bigint language plpgsql security definer
set search_path = public, pg_temp as $BLOQUE$
declare
  v_id                  bigint;
  v_nombre              text;
  v_correo              text;
  v_comercio_solicitado text;
  v_rol                 public.rol_operador;
  v_usuario_id          uuid;
begin
  v_nombre := trim(coalesce(p->>'nombre', ''));
  v_correo := lower(trim(coalesce(p->>'correo', '')));
  v_comercio_solicitado := nullif(trim(coalesce(p->>'comercio_solicitado', '')), '');
  
  if v_nombre = '' then
    raise exception 'El nombre es obligatorio';
  end if;
  
  if v_correo = '' or v_correo not like '%@%' then
    raise exception 'Debe proporcionar un correo electrónico válido';
  end if;

  -- Impedir solicitar super_admin desde la interfaz pública
  if (p->>'rol') = 'super_admin' or p->>'rol' is null then
    v_rol := 'operador_facturador'::public.rol_operador;
  else
    begin
      v_rol := (p->>'rol')::public.rol_operador;
    exception when others then
      v_rol := 'operador_facturador'::public.rol_operador;
    end;
  end if;

  if (p->>'usuario_id') is not null and (p->>'usuario_id') <> '' then
    begin
      v_usuario_id := (p->>'usuario_id')::uuid;
    exception when others then
      v_usuario_id := null;
    end;
  else
    v_usuario_id := null;
  end if;

  -- Si ya existe un operador con ese correo
  select id into v_id from public.operadores where lower(correo) = v_correo;
  if v_id is not null then
    update public.operadores
       set nombre = v_nombre,
           rol = v_rol,
           comercio_solicitado = coalesce(v_comercio_solicitado, comercio_solicitado),
           usuario_id = coalesce(v_usuario_id, usuario_id)
     where id = v_id and activo = false;
    return v_id;
  end if;

  -- Inserción como operador pendiente (activo = false, sin comercio)
  insert into public.operadores (nombre, correo, rol, activo, comercio_id, comercio_solicitado, usuario_id)
  values (v_nombre, v_correo, v_rol, false, null, v_comercio_solicitado, v_usuario_id)
  returning id into v_id;

  return v_id;
end;
$BLOQUE$;

-- 6. CONCEDER PERMISOS DE EJECUCIÓN A LA FUNCIÓN RPC
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.solicitar_registro(jsonb) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.solicitar_registro(jsonb) to authenticated;
  end if;
end $$;

select 'configuración de supabase' as pieza, 'completada con éxito' as estado;
