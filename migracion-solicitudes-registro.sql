-- =====================================================================
-- BARATOPRIMO — migración: Solicitudes de Registro y Auto-Alta de Operadores
-- ---------------------------------------------------------------------
-- Permite que los usuarios creen cuenta desde la pantalla de acceso
-- eligiendo su rol solicitado (excepto super_admin).
-- La cuenta queda registrada en Supabase Auth y en la tabla operadores
-- con estado pendiente (activo = false) hasta que un super administrador
-- la apruebe y le asigne un comercio.
--
-- Se puede ejecutar varias veces sin romper nada.
-- =====================================================================

-- 1. Política RLS para permitir inserción de solicitudes pendientes
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where tablename = 'operadores' and policyname = 'solicitar operador publico'
  ) then
    create policy "solicitar operador publico" on operadores
      for insert to anon, authenticated
      with check (activo = false and comercio_id is null and rol <> 'super_admin');
  end if;
end $$;

-- 2. Función con seguridad definer para registrar solicitudes
create or replace function solicitar_registro(p jsonb)
returns bigint language plpgsql security definer as $BLOQUE$
declare
  v_id         bigint;
  v_nombre     text;
  v_correo     text;
  v_rol        rol_usuario;
  v_usuario_id uuid;
begin
  v_nombre := trim(coalesce(p->>'nombre', ''));
  v_correo := lower(trim(coalesce(p->>'correo', '')));
  
  if v_nombre = '' then
    raise exception 'El nombre es obligatorio';
  end if;
  
  if v_correo = '' or v_correo not like '%@%' then
    raise exception 'Debe proporcionar un correo electrónico válido';
  end if;

  -- Impedir solicitar super_admin desde la interfaz pública
  if (p->>'rol') = 'super_admin' or p->>'rol' is null then
    v_rol := 'operador_facturador'::rol_usuario;
  else
    v_rol := (p->>'rol')::rol_usuario;
  end if;

  if (p->>'usuario_id') is not null and (p->>'usuario_id') <> '' then
    v_usuario_id := (p->>'usuario_id')::uuid;
  else
    v_usuario_id := null;
  end if;

  -- Si ya existe un operador con ese correo
  select id into v_id from operadores where lower(correo) = v_correo;
  if v_id is not null then
    -- Si ya existe y está inactivo, actualizamos los datos de la solicitud
    update operadores
       set nombre = v_nombre,
           rol = v_rol,
           usuario_id = coalesce(v_usuario_id, usuario_id)
     where id = v_id and activo = false;
    return v_id;
  end if;

  -- Inserción como operador pendiente (activo = false, sin comercio)
  insert into operadores (nombre, correo, rol, activo, comercio_id, usuario_id)
  values (v_nombre, v_correo, v_rol, false, null, v_usuario_id)
  returning id into v_id;

  return v_id;
end;
$BLOQUE$;

-- 3. Conceder permisos de ejecución
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function solicitar_registro(jsonb) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function solicitar_registro(jsonb) to authenticated;
  end if;
end $$;

-- 4. Trigger opcional para auto-sincronizar usuarios de auth.users si se registran directamente
create or replace function public.manejar_nuevo_usuario_auth()
returns trigger language plpgsql security definer as $BLOQUE$
declare
  v_nombre text;
  v_rol_solicitado text;
  v_rol rol_usuario;
begin
  v_nombre := coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1));
  v_rol_solicitado := coalesce(new.raw_user_meta_data->>'rol_solicitado', 'operador_facturador');
  
  if v_rol_solicitado = 'super_admin' then
    v_rol := 'operador_facturador'::rol_usuario;
  else
    v_rol := v_rol_solicitado::rol_usuario;
  end if;

  if not exists (select 1 from public.operadores where lower(correo) = lower(new.email)) then
    insert into public.operadores (nombre, correo, rol, activo, comercio_id, usuario_id)
    values (v_nombre, lower(new.email), v_rol, false, null, new.id);
  else
    update public.operadores
       set usuario_id = new.id
     where lower(correo) = lower(new.email) and usuario_id is null;
  end if;

  return new;
end;
$BLOQUE$;

drop trigger if exists tr_nuevo_usuario_auth on auth.users;
create trigger tr_nuevo_usuario_auth
  after insert on auth.users
  for each row execute function public.manejar_nuevo_usuario_auth();

select 'migración de solicitudes de registro' as pieza, 'completada con éxito' as estado;
