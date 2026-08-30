-- =====================================================================
-- BARATOPRIMO — migración: Solicitudes de Registro y Auto-Alta de Operadores
-- ---------------------------------------------------------------------
-- Permite que los usuarios soliciten una cuenta desde la pantalla de
-- acceso eligiendo un rol solicitado (excepto super_admin).
-- La cuenta queda inactiva (activo = false) hasta que un super administrador
-- la apruebe, asigne el comercio correspondiente y la habilite.
--
-- Se puede ejecutar varias veces sin romper nada.
-- =====================================================================

-- 1. Función con permisos de seguridad para registrar solicitudes públicas
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
    -- Si ya existe, actualizamos los datos básicos de la solicitud si está inactivo
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

-- Conceder permisos de ejecución a usuarios anónimos y autenticados
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function solicitar_registro(jsonb) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function solicitar_registro(jsonb) to authenticated;
  end if;
end $$;

select 'función solicitar_registro' as pieza,
       case when exists (select 1 from pg_proc where proname = 'solicitar_registro')
            then 'listo' else 'FALTA' end as estado;
