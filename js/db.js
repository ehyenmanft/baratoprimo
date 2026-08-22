/* =====================================================================
   Capa de datos.
   INV.db expone siempre la misma API; por debajo hay dos adaptadores.
   Cambiar de demo a producción es cambiar MODO en config.js.
   ===================================================================== */
(function () {
  if (INV.config.MODO === 'demo') {
    INV.db = INV.adaptadorDemo;
    return;
  }

  if (INV.config.MODO === 'drive') {
    INV.db = INV.adaptadorDrive.construir();
    return;
  }

  /* ---------- Adaptador Supabase (requiere servir por http) ---------- */
  const sb = window.supabase.createClient(INV.config.SUPABASE_URL, INV.config.SUPABASE_ANON);

  function ok({ data, error }) {
    if (error) throw new Error(error.message);
    return data;
  }

  /* Campos que la vista ventas_detalle calcula y aquí replicamos al leer
     la tabla clientes directamente. */
  const derivados = c => c && ({
    ...c,
    cliente: ((c.nombres || '') + ' ' + (c.apellidos || '')).trim(),
    documento_completo: c.tipo_documento + '-' + c.documento,
  });

  INV.db = {
    etiqueta: 'supabase',

    sesion: {
      actual:  () => sb.auth.getSession().then(r => r.data.session),
      entrar:  (email, password) => sb.auth.signInWithPassword({ email, password }).then(ok),
      salir:   () => sb.auth.signOut(),
      alCambiar: cb => sb.auth.onAuthStateChange((_e, s) => cb(s)),
    },

    categorias: {
      listar: () => sb.from('categorias').select('*').order('nombre').then(ok),
      crear:  nombre => sb.from('categorias').insert({ nombre }).select().single().then(ok),
    },

    productos: {
      listar: ({ busqueda = '', soloActivos = true } = {}) => {
        let q = sb.from('productos').select('*, categorias(nombre)').order('nombre');
        if (soloActivos) q = q.eq('activo', true);
        if (busqueda) q = q.or(`nombre.ilike.%${busqueda}%,sku.ilike.%${busqueda}%`);
        return q.then(ok);
      },
      crear:      datos => sb.from('productos').insert(datos).select().single().then(ok),
      actualizar: (id, datos) => sb.from('productos').update(datos).eq('id', id).select().single().then(ok),
      desactivar: id => sb.from('productos').update({ activo: false }).eq('id', id).then(ok),
    },

    stock: {
      actual:  () => sb.from('stock_actual').select('*').order('nombre').then(ok),
      alertas: () => sb.from('alertas_stock').select('*').order('stock').then(ok),
    },

    movimientos: {
      listar: ({ productoId = null, desde = null, hasta = null, limite = 200 } = {}) => {
        let q = sb.from('kardex').select('*').order('fecha', { ascending: false }).limit(limite);
        if (productoId) q = q.eq('producto_id', productoId);
        if (desde) q = q.gte('fecha', desde);
        if (hasta) q = q.lte('fecha', hasta);
        return q.then(ok);
      },
      // El kardex es de solo inserción: un error se corrige con un ajuste inverso.
      registrar: datos => sb.from('movimientos').insert(datos).select().single().then(ok),
    },

    clientes: {
      listar: ({ busqueda = '' } = {}) => {
        let q = sb.from('clientes').select('*').eq('activo', true).order('apellidos');
        if (busqueda) q = q.or(`nombres.ilike.%${busqueda}%,apellidos.ilike.%${busqueda}%,documento.ilike.%${busqueda}%`);
        return q.then(ok).then(filas => filas.map(derivados));
      },
      obtener: id => sb.from('clientes').select('*').eq('id', id).maybeSingle()
        .then(ok).then(derivados),
      crear: datos => sb.from('clientes').insert(datos).select().single().then(ok).then(derivados),
      actualizar: (id, datos) => sb.from('clientes').update(datos).eq('id', id)
        .select().single().then(ok).then(derivados),
      desactivar: id => sb.from('clientes').update({ activo: false }).eq('id', id).then(ok),
    },

    ventas: {
      listar: ({ clienteId = null, desde = null, hasta = null, limite = 200 } = {}) => {
        let q = sb.from('ventas_detalle').select('*').order('fecha', { ascending: false }).limit(limite);
        if (clienteId) q = q.eq('cliente_id', clienteId);
        if (desde) q = q.gte('fecha', desde);
        if (hasta) q = q.lte('fecha', hasta);
        return q.then(ok);
      },
      obtener: async id => {
        const [venta, items, pagos, cuotas] = await Promise.all([
          sb.from('ventas_detalle').select('*').eq('id', id).maybeSingle().then(ok),
          sb.from('venta_items').select('*').eq('venta_id', id).order('id').then(ok),
          sb.from('venta_pagos').select('*').eq('venta_id', id).order('id').then(ok),
          sb.from('cuotas').select('*').eq('venta_id', id).order('numero').then(ok),
        ]);
        return venta ? { ...venta, items, pagos, cuotas } : null;
      },
      /* La función del esquema comprueba el rol, marca la anulación y
         devuelve el inventario en una sola transacción. */
      anular: async (id, motivo, detalle) => {
        const { error } = await sb.rpc('anular_venta',
          { p_venta_id: Number(id), p_motivo: motivo, p_detalle: detalle || null });
        if (error) throw new Error(error.message);
        return INV.db.ventas.obtener(id);
      },

      /* Una sola llamada: la función del esquema inserta venta, renglones y
         salidas de inventario dentro de la misma transacción. */
      crear: async datos => {
        const { data, error } = await sb.rpc('registrar_venta', { p: datos });
        if (error) throw new Error(error.message);
        return INV.db.ventas.obtener(data);
      },
    },

    cuotas: {
      pendientes: () => sb.from('cuotas_pendientes').select('*').order('vence_en').then(ok),
      pagar: async (id, metodo, monto, tasa = 1, referencia = null) => {
        const { error } = await sb.rpc('pagar_cuota', {
          p_cuota_id: Number(id), p_metodo: metodo, p_monto: Number(monto),
          p_tasa: Number(tasa || 1), p_referencia: referencia || null,
        });
        if (error) throw new Error(error.message);
        return true;
      },
    },

    comercio: {
      /* La vista mi_comercio devuelve el del operador en sesión. Si no
         tiene comercio asignado no hay filas, y eso no es un error de la
         consulta sino una instalación a medias: se devuelve null y quien
         llama decide qué decir. */
      obtener: () => sb.from('mi_comercio').select('*').maybeSingle().then(ok),

      guardar: async datos => {
        const actual = await sb.from('mi_comercio').select('id').maybeSingle().then(ok);
        if (!actual) throw new Error('Tu operador no tiene un comercio asignado');
        return sb.from('comercios')
          .update({ ...datos, actualizado_en: new Date().toISOString() })
          .eq('id', actual.id).select().single().then(ok);
      },
    },

    comercios: {
      /* RLS decide el alcance: el super admin los ve todos, el resto solo
         el suyo. Los contadores van aparte porque las tablas de cada
         comercio no son visibles desde otro. */
      listar: () => sb.from('comercios').select('*').order('nombre').then(ok),
      crear:  datos => sb.rpc('crear_comercio', { p: datos })
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return sb.from('comercios').select('*').eq('id', data).single().then(ok);
        }),
      actualizar: (id, datos) => sb.from('comercios')
        .update({ ...datos, actualizado_en: new Date().toISOString() })
        .eq('id', id).select().single().then(ok),
      eliminar: id => sb.from('comercios').delete().eq('id', id).then(ok),

      /* Cambiar de comercio es mover el propio registro de operador: solo
         el super admin tiene permiso para hacerlo. */
      cambiar: async id => {
        const { data: sesion } = await sb.auth.getSession();
        const correo = sesion && sesion.session ? sesion.session.user.email : '';
        return sb.from('operadores').update({ comercio_id: Number(id) })
          .ilike('correo', correo).select().single().then(ok);
      },
    },

    operadores: {
      listar: () => sb.from('operadores')
        .select('*, comercios(nombre)').order('nombre')
        .then(ok).then(filas => filas.map(o => ({
          ...o, comercio: o.comercios ? o.comercios.nombre : null,
        }))),
      crear:  datos => sb.from('operadores').insert(datos).select().single().then(ok),
      actualizar: (id, datos) => sb.from('operadores').update(datos).eq('id', id)
        .select().single().then(ok),
      eliminar: id => sb.from('operadores').delete().eq('id', id).then(ok),
      /* El rol lo resuelve la base con rol_actual(); aquí solo se consulta
         para que la interfaz sepa qué ocultar. */
      rolDe: async correo => {
        const { data, error } = await sb.from('operadores')
          .select('rol').eq('activo', true).ilike('correo', correo).limit(1);
        if (error || !data || !data.length) return null;
        return data[0].rol;
      },
    },

    archivos: {
      /* Recibe el data URL que produce el formulario tras reducir la imagen,
         lo convierte a binario y lo sube al bucket 'inventario'. */
      subir: async (dataUrl, sku) => {
        const respuesta = await fetch(dataUrl);
        const blob = await respuesta.blob();
        const ruta = `productos/${sku}-${Date.now()}.jpg`;
        const { error } = await sb.storage.from('inventario')
          .upload(ruta, blob, { upsert: true, contentType: 'image/jpeg' });
        if (error) throw new Error(error.message);
        return ruta;
      },
      url: ruta => {
        if (!ruta) return null;
        // Una imagen cargada en modo demo ya es una URL completa.
        if (ruta.startsWith('data:') || ruta.startsWith('http')) return ruta;
        return sb.storage.from('inventario').getPublicUrl(ruta).data.publicUrl;
      },
    },
  };
})();
