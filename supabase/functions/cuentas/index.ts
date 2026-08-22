/* =====================================================================
   BaratoPrimo — función de administración de cuentas
   ---------------------------------------------------------------------
   Crea y cambia las contraseñas de los operadores. Existe porque la
   llave pública del navegador no puede hacerlo: eso exige la llave de
   servicio, que salta todas las políticas y por eso jamás debe salir del
   servidor.

   Lo que hace, en orden:
     1. Comprueba quién llama, con el token de su sesión.
     2. Verifica en la base que es administrador y de qué comercio.
     3. Comprueba que el operador destino pertenece a ese comercio, y que
        no es un super administrador salvo que quien pide también lo sea.
     4. Recién entonces crea o cambia la cuenta.

   Desplegar con:
     supabase functions deploy cuentas --no-verify-jwt
   ===================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responder = (cuerpo, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (peticion) => {
  if (peticion.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (peticion.method !== 'POST') return responder({ error: 'Método no permitido' }, 405);

  const URL_PROYECTO = Deno.env.get('SUPABASE_URL');
  const LLAVE_SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const LLAVE_PUBLICA = Deno.env.get('SUPABASE_ANON_KEY');

  try {
    const { accion, correo, clave } = await peticion.json();

    if (!correo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo))
      return responder({ error: 'Correo no válido' }, 400);
    if (!clave || String(clave).length < 8)
      return responder({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);

    // --- 1. Quién llama ---
    const token = (peticion.headers.get('Authorization') || '').replace('Bearer ', '');
    if (!token) return responder({ error: 'Falta la sesión' }, 401);

    const comoUsuario = createClient(URL_PROYECTO, LLAVE_PUBLICA, {
      global: { headers: { Authorization: 'Bearer ' + token } },
    });
    const { data: { user }, error: errUsuario } = await comoUsuario.auth.getUser();
    if (errUsuario || !user) return responder({ error: 'Sesión no válida' }, 401);

    // --- 2. Qué es quien llama ---
    const admin = createClient(URL_PROYECTO, LLAVE_SERVICIO);
    const { data: quienPide } = await admin
      .from('operadores')
      .select('rol, comercio_id, activo')
      .ilike('correo', user.email)
      .maybeSingle();

    if (!quienPide || !quienPide.activo)
      return responder({ error: 'Tu cuenta no está registrada como operador' }, 403);
    if (!['super_admin', 'administrador'].includes(quienPide.rol))
      return responder({ error: 'Tu rol no permite administrar cuentas' }, 403);

    // --- 3. Sobre quién actúa ---
    const { data: destino } = await admin
      .from('operadores')
      .select('rol, comercio_id')
      .ilike('correo', correo)
      .maybeSingle();

    if (!destino)
      return responder({ error: 'Ese correo no está registrado como operador' }, 404);

    // Un administrador solo manda dentro de su comercio
    if (quienPide.rol !== 'super_admin' && destino.comercio_id !== quienPide.comercio_id)
      return responder({ error: 'Ese operador pertenece a otro comercio' }, 403);

    // Y nunca sobre un super administrador
    if (destino.rol === 'super_admin' && quienPide.rol !== 'super_admin')
      return responder({ error: 'No puedes administrar la cuenta de un super administrador' }, 403);

    // --- 4. Crear o cambiar ---
    const { data: existentes } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const cuenta = (existentes?.users || [])
      .find(u => (u.email || '').toLowerCase() === correo.toLowerCase());

    if (accion === 'crear') {
      if (cuenta) {
        // Ya existía: se le cambia la contraseña, que es lo que se quería
        await admin.auth.admin.updateUserById(cuenta.id, { password: clave });
        await admin.from('operadores').update({ usuario_id: cuenta.id }).ilike('correo', correo);
        return responder({ creada: false, cambiada: true, requiereConfirmacion: false });
      }

      const { data: nueva, error } = await admin.auth.admin.createUser({
        email: correo,
        password: clave,
        email_confirm: true,   // sin vuelta por el correo: la crea un administrador
      });
      if (error) return responder({ error: error.message }, 400);

      await admin.from('operadores').update({ usuario_id: nueva.user.id }).ilike('correo', correo);
      return responder({ creada: true, requiereConfirmacion: false });
    }

    if (accion === 'cambiar') {
      if (!cuenta) return responder({ error: 'Ese operador todavía no tiene cuenta de acceso' }, 404);
      const { error } = await admin.auth.admin.updateUserById(cuenta.id, { password: clave });
      if (error) return responder({ error: error.message }, 400);
      return responder({ cambiada: true });
    }

    return responder({ error: 'Acción desconocida' }, 400);

  } catch (e) {
    return responder({ error: e.message }, 500);
  }
});
