/* =====================================================================
   Capa de datos con Respaldo y Modo Sin Conexión Automático.
   INV.db expone siempre la misma API; por debajo gestiona Supabase, Demo
   o Drive con sincronización transparente y caché local.
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

  /* ---------- Adaptador Supabase con Tolerancia Offline ---------- */
  const sb = (window.supabase && typeof window.supabase.createClient === 'function')
    ? window.supabase.createClient(INV.config.SUPABASE_URL, INV.config.SUPABASE_ANON)
    : {
        auth: {
          getSession: async () => ({ data: { session: null } }),
          signInWithPassword: async () => { throw new Error('Supabase no disponible'); },
          signOut: async () => {},
          onAuthStateChange: () => {},
        },
        from: () => ({
          select: () => ({
            eq: () => ({ order: () => Promise.reject(new Error('offline')) }),
            order: () => Promise.reject(new Error('offline')),
            maybeSingle: () => Promise.reject(new Error('offline')),
            single: () => Promise.reject(new Error('offline')),
            limit: () => Promise.reject(new Error('offline')),
          }),
          insert: () => ({ select: () => ({ single: () => Promise.reject(new Error('offline')) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.reject(new Error('offline')) }) }) }),
          delete: () => ({ eq: () => Promise.reject(new Error('offline')) }),
        }),
        rpc: async () => ({ data: null, error: new Error('offline') }),
      };

  function ok({ data, error }) {
    if (error) throw new Error(error.message);
    return data;
  }

  function esErrorDeRed(err) {
    if (!err) return false;
    const msg = (err.message || err.toString() || '').toLowerCase();
    const esRed = msg.includes('failed to fetch') ||
                  msg.includes('network') ||
                  msg.includes('offline') ||
                  msg.includes('timeout') ||
                  msg.includes('abort') ||
                  msg.includes('connection refused') ||
                  msg.includes('load failed') ||
                  msg.includes('err_connection') ||
                  msg.includes('err_internet_disconnected') ||
                  msg.includes('fetch failed') ||
                  (window.INV && INV.sync && INV.sync.esOffline());
    if (esRed && window.INV && INV.sync && INV.sync.fijarOffline) {
      try { INV.sync.fijarOffline(); } catch (e) {}
    }
    return esRed;
  }

  function esIdTemporal(id) {
    if (id === null || id === undefined) return false;
    const str = String(id);
    return str.startsWith('_temp_') || str.startsWith('_offline_') || str.startsWith('F-OFF-') || isNaN(Number(id));
  }

  /* Llama a la función de administración con la sesión del administrador */
  async function llamarFuncion(accion, cuerpo) {
    const { data: sesion } = await sb.auth.getSession();
    const token = sesion && sesion.session ? sesion.session.access_token : null;
    if (!token) throw new Error('No hay sesión iniciada');

    const respuesta = await fetch(INV.config.FUNCION_CUENTAS.trim(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'apikey': INV.config.SUPABASE_ANON,
      },
      body: JSON.stringify({ accion, ...cuerpo }),
    });

    const resultado = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(resultado.error || 'La función respondió ' + respuesta.status);
    return resultado;
  }

  function traducirAlta(mensaje) {
    const m = (mensaje || '').toLowerCase();
    if (m.includes('already registered') || m.includes('already been registered'))
      return 'Ese correo ya tiene cuenta de acceso. Para cambiarle la contraseña ' +
             'hay que desplegar la función de administración (FUNCION-CUENTAS.md) ' +
             'o hacerlo desde Supabase → Authentication → Users.';
    if (m.includes('password') && m.includes('least'))
      return 'La contraseña es demasiado corta para lo que exige el proyecto.';
    if (m.includes('signups not allowed') || m.includes('disabled'))
      return 'El proyecto tiene desactivada el alta de usuarios. Actívala en Authentication → Providers, o despliega la función de administración.';
    if (m.includes('rate limit'))
      return 'Demasiadas altas seguidas. Espera un momento y vuelve a intentarlo.';
    return mensaje;
  }

  /* Campos calculados para clientes */
  const derivados = c => c && ({
    ...c,
    cliente: ((c.nombres || '') + ' ' + (c.apellidos || '')).trim(),
    documento_completo: (c.tipo_documento ? c.tipo_documento + '-' : '') + (c.documento || ''),
    es_agente_retencion: !!c.es_agente_retencion,
    retencion_iva_porcentaje: Number(c.retencion_iva_porcentaje || 75),
    retencion_islr_porcentaje: Number(c.retencion_islr_porcentaje || 0),
  });

  INV.db = {
    etiqueta: 'supabase',

    sesion: {
      actual:  () => sb.auth.getSession().then(r => r.data.session).catch(() => null),
      entrar:  (email, password) => sb.auth.signInWithPassword({ email, password }).then(ok),
      salir:   () => sb.auth.signOut(),
      alCambiar: cb => sb.auth.onAuthStateChange((event, session) => cb(event, session)),
      recuperarClave: async email => {
        const redirect = window.location.origin + window.location.pathname;
        const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: redirect });
        if (error) throw new Error(error.message);
        return true;
      },
      actualizarClave: async nuevaClave => {
        const { data, error } = await sb.auth.updateUser({ password: nuevaClave });
        if (error) throw new Error(error.message);
        return data;
      },
    },

    categorias: {
      listar: async () => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const data = await sb.from('categorias').select('*').order('nombre').then(ok);
            if (INV.sync) await INV.sync.guardarCache('categorias', data);
            return data;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }
        return (INV.sync ? await INV.sync.obtenerCache('categorias', []) : []);
      },

      crear: async nombre => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const res = await sb.from('categorias').insert({ nombre }).select().single().then(ok);
            if (INV.sync) {
              const cats = await INV.sync.obtenerCache('categorias', []);
              cats.push(res);
              await INV.sync.guardarCache('categorias', cats);
            }
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        const tempId = '_temp_cat_' + Date.now();
        const categoriaOffline = { id: tempId, nombre, activo: true, _offline: true };
        if (INV.sync) {
          const cats = await INV.sync.obtenerCache('categorias', []);
          cats.push(categoriaOffline);
          await INV.sync.guardarCache('categorias', cats);
          INV.sync.encolarMutacion({
            tipo: 'categorias.crear',
            datos: { nombre },
            temporalId: tempId,
            descripcion: `Crear categoría "${nombre}"`
          });
        }
        return categoriaOffline;
      },

      actualizar: async (id, datos) => {
        if (!esIdTemporal(id) && (!INV.sync || !INV.sync.esOffline())) {
          try {
            const res = await sb.from('categorias').update(datos).eq('id', id).select().single().then(ok);
            if (INV.sync) {
              const cats = await INV.sync.obtenerCache('categorias', []);
              const idx = cats.findIndex(c => String(c.id) === String(id));
              if (idx !== -1) cats[idx] = { ...cats[idx], ...res };
              await INV.sync.guardarCache('categorias', cats);
            }
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        if (INV.sync) {
          const cats = await INV.sync.obtenerCache('categorias', []);
          const idx = cats.findIndex(c => String(c.id) === String(id));
          if (idx !== -1) {
            cats[idx] = { ...cats[idx], ...datos, _offline: true };
            await INV.sync.guardarCache('categorias', cats);
          }
          INV.sync.encolarMutacion({
            tipo: 'categorias.actualizar',
            datos: { id, ...datos },
            descripcion: `Actualizar categoría "${datos.nombre || id}"`
          });
        }
        return { id, ...datos };
      },

      eliminar: async id => {
        if (!esIdTemporal(id) && (!INV.sync || !INV.sync.esOffline())) {
          try {
            const res = await sb.from('categorias').delete().eq('id', id).then(ok);
            if (INV.sync) {
              const cats = await INV.sync.obtenerCache('categorias', []);
              const filtradas = cats.filter(c => String(c.id) !== String(id));
              await INV.sync.guardarCache('categorias', filtradas);
            }
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        if (INV.sync) {
          const cats = await INV.sync.obtenerCache('categorias', []);
          const filtradas = cats.filter(c => String(c.id) !== String(id));
          await INV.sync.guardarCache('categorias', filtradas);
          INV.sync.encolarMutacion({
            tipo: 'categorias.eliminar',
            datos: { id },
            descripcion: `Eliminar categoría #${id}`
          });
        }
        return { id, eliminado: true };
      },
    },

    productos: {
      listar: async ({ busqueda = '', soloActivos = true } = {}) => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            let q = sb.from('productos').select('*, categorias(nombre)').order('nombre');
            if (soloActivos) q = q.eq('activo', true);
            if (busqueda) q = q.or(`nombre.ilike.%${busqueda}%,sku.ilike.%${busqueda}%`);
            const data = await q.then(ok);
            if (INV.sync && !busqueda) {
              await INV.sync.guardarCache('productos', data);
            }
            return data;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline: filtrar desde caché local
        let prods = INV.sync ? await INV.sync.obtenerCache('productos', []) : [];
        if (soloActivos) prods = prods.filter(p => p.activo !== false);
        if (busqueda) {
          const b = busqueda.toLowerCase();
          prods = prods.filter(p =>
            (p.nombre && p.nombre.toLowerCase().includes(b)) ||
            (p.sku && p.sku.toLowerCase().includes(b))
          );
        }
        return prods;
      },

      crear: async datos => {
        const tieneTemp = esIdTemporal(datos.categoria_id);
        if (!tieneTemp && (!INV.sync || !INV.sync.esOffline())) {
          try {
            const res = await sb.from('productos').insert(datos).select().single().then(ok);
            if (INV.sync) {
              const prods = await INV.sync.obtenerCache('productos', []);
              prods.push(res);
              await INV.sync.guardarCache('productos', prods);
            }
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        const tempId = '_temp_prod_' + Date.now();
        const prodOffline = { ...datos, id: tempId, activo: true, _offline: true };
        if (INV.sync) {
          const prods = await INV.sync.obtenerCache('productos', []);
          prods.push(prodOffline);
          await INV.sync.guardarCache('productos', prods);

          const stocks = await INV.sync.obtenerCache('stock_actual', []);
          stocks.push({
            id: tempId,
            producto_id: tempId,
            sku: datos.sku,
            nombre: datos.nombre,
            unidad: datos.unidad || 'unidad',
            stock: 0,
            stock_minimo: datos.stock_minimo || 0,
            precio_venta: datos.precio_venta || 0,
            costo: datos.costo || 0,
            activo: true,
          });
          await INV.sync.guardarCache('stock_actual', stocks);

          INV.sync.encolarMutacion({
            tipo: 'productos.crear',
            datos,
            temporalId: tempId,
            descripcion: `Crear producto "${datos.nombre}" (${datos.sku})`
          });
        }
        return prodOffline;
      },

      actualizar: async (id, datos) => {
        const tieneTemp = esIdTemporal(id) || esIdTemporal(datos.categoria_id);
        if (!tieneTemp && (!INV.sync || !INV.sync.esOffline())) {
          try {
            const res = await sb.from('productos').update(datos).eq('id', id).select().single().then(ok);
            if (INV.sync) {
              const prods = await INV.sync.obtenerCache('productos', []);
              const idx = prods.findIndex(p => String(p.id) === String(id));
              if (idx !== -1) prods[idx] = { ...prods[idx], ...res };
              await INV.sync.guardarCache('productos', prods);
            }
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        const prodActualizado = { id, ...datos, _offline: true };
        if (INV.sync) {
          const prods = await INV.sync.obtenerCache('productos', []);
          const idx = prods.findIndex(p => String(p.id) === String(id));
          if (idx !== -1) {
            prods[idx] = { ...prods[idx], ...prodActualizado };
            await INV.sync.guardarCache('productos', prods);
          }

          const stocks = await INV.sync.obtenerCache('stock_actual', []);
          const sIdx = stocks.findIndex(s => String(s.producto_id || s.id) === String(id));
          if (sIdx !== -1) {
            stocks[sIdx] = { ...stocks[sIdx], ...datos };
            await INV.sync.guardarCache('stock_actual', stocks);
          }

          INV.sync.encolarMutacion({
            tipo: 'productos.actualizar',
            datos: { id, ...datos },
            descripcion: `Actualizar producto "${datos.nombre || id}"`
          });
        }
        return prodActualizado;
      },

      desactivar: async id => {
        if (!esIdTemporal(id) && (!INV.sync || !INV.sync.esOffline())) {
          try {
            const res = await sb.from('productos').update({ activo: false }).eq('id', id).then(ok);
            if (INV.sync) {
              const prods = await INV.sync.obtenerCache('productos', []);
              const idx = prods.findIndex(p => String(p.id) === String(id));
              if (idx !== -1) prods[idx].activo = false;
              await INV.sync.guardarCache('productos', prods);
            }
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        if (INV.sync) {
          const prods = await INV.sync.obtenerCache('productos', []);
          const idx = prods.findIndex(p => String(p.id) === String(id));
          if (idx !== -1) {
            prods[idx].activo = false;
            await INV.sync.guardarCache('productos', prods);
          }
          INV.sync.encolarMutacion({
            tipo: 'productos.desactivar',
            datos: { id },
            descripcion: `Desactivar producto #${id}`
          });
        }
        return { id, activo: false };
      },
    },

    stock: {
      actual: async () => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const data = await sb.from('stock_actual').select('*').order('nombre').then(ok);
            if (INV.sync) await INV.sync.guardarCache('stock_actual', data);
            return data;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }
        return (INV.sync ? await INV.sync.obtenerCache('stock_actual', []) : []);
      },

      alertas: async () => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const data = await sb.from('alertas_stock').select('*').order('stock').then(ok);
            if (INV.sync) await INV.sync.guardarCache('alertas_stock', data);
            return data;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }
        const stocks = INV.sync ? await INV.sync.obtenerCache('stock_actual', []) : [];
        return stocks.filter(s => Number(s.stock || 0) <= Number(s.stock_minimo || 0));
      },
    },

    movimientos: {
      listar: async ({ productoId = null, desde = null, hasta = null, limite = 200 } = {}) => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            let q = sb.from('kardex').select('*').order('fecha', { ascending: false }).limit(limite);
            if (productoId) q = q.eq('producto_id', productoId);
            if (desde) q = q.gte('fecha', desde);
            if (hasta) q = q.lte('fecha', hasta);
            const data = await q.then(ok);
            if (INV.sync && !productoId) await INV.sync.guardarCache('movimientos', data);
            return data;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        let movs = INV.sync ? await INV.sync.obtenerCache('movimientos', []) : [];
        if (productoId) movs = movs.filter(m => String(m.producto_id) === String(productoId));
        if (desde) movs = movs.filter(m => m.fecha >= desde);
        if (hasta) movs = movs.filter(m => m.fecha <= hasta);
        return movs.slice(0, limite);
      },

      registrar: async datos => {
        const claveIdem = datos.clave_idem || (INV.sync ? INV.sync.uuid('mov') : null);

        if (!esIdTemporal(datos.producto_id) && (!INV.sync || !INV.sync.esOffline())) {
          try {
            const { data, error } = await sb.rpc('registrar_movimiento', { p: { ...datos, clave_idem: claveIdem } });

            if (!error) return { id: data, ...datos };

            const sinFuncion = /could not find the function|does not exist|schema cache/i.test(error.message || '');
            if (!sinFuncion) throw new Error(error.message);

            const { clave_idem, ...limpio } = datos;
            return await sb.from('movimientos').insert(limpio).select().single().then(ok);
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        const tempId = '_temp_mov_' + Date.now();
        const movOffline = {
          id: tempId,
          ...datos,
          clave_idem: claveIdem,
          fecha: new Date().toISOString(),
          _offline: true
        };

        if (INV.sync) {
          // Actualizar stock localmente
          const stocks = await INV.sync.obtenerCache('stock_actual', []);
          const prodIdx = stocks.findIndex(s => String(s.producto_id || s.id) === String(datos.producto_id));
          if (prodIdx !== -1) {
            const cant = Number(datos.cantidad || 0);
            if (datos.tipo === 'entrada') stocks[prodIdx].stock = Number(stocks[prodIdx].stock || 0) + cant;
            else if (datos.tipo === 'salida') stocks[prodIdx].stock = Number(stocks[prodIdx].stock || 0) - cant;
            else if (datos.tipo === 'ajuste') stocks[prodIdx].stock = cant;
            await INV.sync.guardarCache('stock_actual', stocks);
          }

          const movs = await INV.sync.obtenerCache('movimientos', []);
          movs.unshift(movOffline);
          await INV.sync.guardarCache('movimientos', movs);

          INV.sync.encolarMutacion({
            tipo: 'movimientos.registrar',
            datos: { ...datos, clave_idem: claveIdem },
            temporalId: tempId,
            clave_idem: claveIdem,
            descripcion: `Movimiento de ${datos.tipo}: ${datos.cantidad} uds (Prod #${datos.producto_id})`
          });
        }

        return movOffline;
      },
    },

    clientes: {
      listar: async ({ busqueda = '' } = {}) => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            let q = sb.from('clientes').select('*').eq('activo', true).order('apellidos');
            if (busqueda) q = q.or(`nombres.ilike.%${busqueda}%,apellidos.ilike.%${busqueda}%,documento.ilike.%${busqueda}%`);
            const data = await q.then(ok).then(filas => filas.map(derivados));
            if (INV.sync && !busqueda) await INV.sync.guardarCache('clientes', data);
            return data;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        let clis = INV.sync ? await INV.sync.obtenerCache('clientes', []) : [];
        clis = clis.filter(c => c.activo !== false);
        if (busqueda) {
          const b = busqueda.toLowerCase();
          clis = clis.filter(c =>
            (c.nombres && c.nombres.toLowerCase().includes(b)) ||
            (c.apellidos && c.apellidos.toLowerCase().includes(b)) ||
            (c.documento && c.documento.toLowerCase().includes(b))
          );
        }
        return clis.map(derivados);
      },

      obtener: async id => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            return await sb.from('clientes').select('*').eq('id', id).maybeSingle().then(ok).then(derivados);
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }
        const clis = INV.sync ? await INV.sync.obtenerCache('clientes', []) : [];
        const encontrado = clis.find(c => String(c.id) === String(id));
        return encontrado ? derivados(encontrado) : null;
      },

      crear: async datos => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            let res;
            try {
              res = await sb.from('clientes').insert(datos).select().single().then(ok).then(derivados);
            } catch (err) {
              if (/column.*does not exist/i.test(err.message || '')) {
                const { es_agente_retencion, retencion_iva_porcentaje, retencion_islr_porcentaje, ...datosBase } = datos;
                res = await sb.from('clientes').insert(datosBase).select().single().then(ok).then(derivados);
              } else {
                throw err;
              }
            }
            if (INV.sync) {
              const clis = await INV.sync.obtenerCache('clientes', []);
              clis.push(res);
              await INV.sync.guardarCache('clientes', clis);
            }
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        const tempId = '_temp_cli_' + Date.now();
        const cliOffline = derivados({ ...datos, id: tempId, activo: true, _offline: true });
        if (INV.sync) {
          const clis = await INV.sync.obtenerCache('clientes', []);
          clis.push(cliOffline);
          await INV.sync.guardarCache('clientes', clis);

          INV.sync.encolarMutacion({
            tipo: 'clientes.crear',
            datos,
            temporalId: tempId,
            descripcion: `Crear cliente ${cliOffline.cliente} (${cliOffline.documento_completo})`
          });
        }
        return cliOffline;
      },

      actualizar: async (id, datos) => {
        if (!esIdTemporal(id) && (!INV.sync || !INV.sync.esOffline())) {
          try {
            let res;
            try {
              res = await sb.from('clientes').update(datos).eq('id', id).select().single().then(ok).then(derivados);
            } catch (err) {
              if (/column.*does not exist/i.test(err.message || '')) {
                const { es_agente_retencion, retencion_iva_porcentaje, retencion_islr_porcentaje, ...datosBase } = datos;
                res = await sb.from('clientes').update(datosBase).eq('id', id).select().single().then(ok).then(derivados);
              } else {
                throw err;
              }
            }
            if (INV.sync) {
              const clis = await INV.sync.obtenerCache('clientes', []);
              const idx = clis.findIndex(c => String(c.id) === String(id));
              if (idx !== -1) clis[idx] = { ...clis[idx], ...res };
              await INV.sync.guardarCache('clientes', clis);
            }
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        const cliActualizado = derivados({ id, ...datos, _offline: true });
        if (INV.sync) {
          const clis = await INV.sync.obtenerCache('clientes', []);
          const idx = clis.findIndex(c => String(c.id) === String(id));
          if (idx !== -1) {
            clis[idx] = { ...clis[idx], ...cliActualizado };
            await INV.sync.guardarCache('clientes', clis);
          }
          INV.sync.encolarMutacion({
            tipo: 'clientes.actualizar',
            datos: { id, ...datos },
            descripcion: `Actualizar cliente #${id}`
          });
        }
        return cliActualizado;
      },

      desactivar: async id => {
        if (!esIdTemporal(id) && (!INV.sync || !INV.sync.esOffline())) {
          try {
            const res = await sb.from('clientes').update({ activo: false }).eq('id', id).then(ok);
            if (INV.sync) {
              const clis = await INV.sync.obtenerCache('clientes', []);
              const idx = clis.findIndex(c => String(c.id) === String(id));
              if (idx !== -1) clis[idx].activo = false;
              await INV.sync.guardarCache('clientes', clis);
            }
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        if (INV.sync) {
          const clis = await INV.sync.obtenerCache('clientes', []);
          const idx = clis.findIndex(c => String(c.id) === String(id));
          if (idx !== -1) {
            clis[idx].activo = false;
            await INV.sync.guardarCache('clientes', clis);
          }
          INV.sync.encolarMutacion({
            tipo: 'clientes.desactivar',
            datos: { id },
            descripcion: `Desactivar cliente #${id}`
          });
        }
        return { id, activo: false };
      },
    },

    ventas: {
      listar: async ({ clienteId = null, desde = null, hasta = null, limite = 200 } = {}) => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            let q = sb.from('ventas_detalle').select('*').order('fecha', { ascending: false }).limit(limite);
            if (clienteId) q = q.eq('cliente_id', clienteId);
            if (desde) q = q.gte('fecha', desde);
            if (hasta) q = q.lte('fecha', hasta);
            const data = await q.then(ok);
            if (INV.sync && !clienteId) await INV.sync.guardarCache('ventas', data);
            return data;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        let vts = INV.sync ? await INV.sync.obtenerCache('ventas', []) : [];
        if (clienteId) vts = vts.filter(v => String(v.cliente_id) === String(clienteId));
        if (desde) vts = vts.filter(v => v.fecha >= desde);
        if (hasta) vts = vts.filter(v => v.fecha <= hasta);
        return vts.slice(0, limite);
      },

      obtener: async id => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const [venta, items, pagos, cuotas] = await Promise.all([
              sb.from('ventas_detalle').select('*').eq('id', id).maybeSingle().then(ok),
              sb.from('venta_items').select('*').eq('venta_id', id).order('id').then(ok),
              sb.from('venta_pagos').select('*').eq('venta_id', id).order('id').then(ok),
              sb.from('cuotas').select('*').eq('venta_id', id).order('numero').then(ok),
            ]);
            const res = venta ? { ...venta, items, pagos, cuotas } : null;
            if (res && INV.sync) await INV.sync.guardarCache('venta_' + id, res);
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline: buscar en caché individual o listado
        if (INV.sync) {
          const guardada = await INV.sync.obtenerCache('venta_' + id);
          if (guardada) return guardada;
          const ventas = await INV.sync.obtenerCache('ventas', []);
          const encontrada = ventas.find(v => String(v.id) === String(id));
          if (encontrada) return encontrada;
        }
        return null;
      },

      anular: async (id, motivo, detalle) => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const { error } = await sb.rpc('anular_venta', {
              p_venta_id: Number(id),
              p_motivo: motivo,
              p_detalle: detalle || null
            });
            if (error) throw new Error(error.message);
            return await INV.db.ventas.obtener(id);
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        if (INV.sync) {
          const ventas = await INV.sync.obtenerCache('ventas', []);
          const idx = ventas.findIndex(v => String(v.id) === String(id));
          if (idx !== -1) {
            ventas[idx].anulada = true;
            ventas[idx].motivo_anulacion = motivo;
            await INV.sync.guardarCache('ventas', ventas);
          }

          INV.sync.encolarMutacion({
            tipo: 'ventas.anular',
            datos: { id, motivo, detalle },
            descripcion: `Anular venta #${id}`
          });
        }
        return await INV.db.ventas.obtener(id);
      },

      crear: async datos => {
        const claveIdem = INV.sync ? INV.sync.uuid('vta') : null;
        const tieneIdTemporal = esIdTemporal(datos.cliente_id) || (datos.items || []).some(it => esIdTemporal(it.producto_id));

        if (!tieneIdTemporal && (!INV.sync || !INV.sync.esOffline())) {
          try {
            const { data, error } = await sb.rpc('registrar_venta', { p: { ...datos, clave_idem: claveIdem } });
            if (error) throw new Error(error.message);
            const ventaCompleta = await INV.db.ventas.obtener(data);

            // Refrescar caché de stock y ventas
            if (INV.sync) {
              const ventas = await INV.sync.obtenerCache('ventas', []);
              ventas.unshift(ventaCompleta);
              await INV.sync.guardarCache('ventas', ventas);
            }
            return ventaCompleta;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // ================= Registro de Venta Modo Offline =================
        const tempId = '_temp_vta_' + Date.now();
        const randCorrelativo = Math.floor(1000 + Math.random() * 9000);
        const numeroProvisional = `F-OFF-${randCorrelativo}`;
        const fechaIso = new Date().toISOString();

        // Armar el objeto de venta completo para tickets y visualización inmediata
        const ventaOffline = {
          id: tempId,
          numero: numeroProvisional,
          fecha: fechaIso,
          cliente_id: datos.cliente_id || null,
          subtotal: Number(datos.subtotal || 0),
          iva_tasa: Number(datos.iva_tasa || 16),
          iva_incluido: !!datos.iva_incluido,
          iva_monto: Number(datos.iva_monto || 0),
          total: Number(datos.total || 0),
          total_usd: Number(datos.total_usd || 0),
          tasa_referencia: Number(datos.tasa_referencia || 1),
          a_credito: !!datos.a_credito,
          recargo_credito: Number(datos.recargo_credito || 0),
          nota: datos.nota || null,
          anulada: false,
          _offline: true,
          clave_idem: claveIdem,
          items: (datos.items || []).map((it, idx) => ({
            id: '_item_' + tempId + '_' + idx,
            venta_id: tempId,
            producto_id: it.producto_id,
            descripcion: it.descripcion,
            cantidad: Number(it.cantidad || 1),
            precio_unitario: Number(it.precio_unitario || 0),
            base: Number(it.base || 0),
            iva_monto: Number(it.iva_monto || 0),
            total: Number(it.total || 0),
          })),
          pagos: (datos.pagos || []).map((p, idx) => ({
            id: '_pago_' + tempId + '_' + idx,
            venta_id: tempId,
            metodo: p.metodo,
            referencia: p.referencia || null,
            detalle: p.detalle || null,
            moneda: p.moneda || 'VES',
            monto: Number(p.monto || 0),
            tasa: Number(p.tasa || 1),
            monto_local: Number(p.monto_local || 0),
          })),
          cuotas: (datos.cuotas || []).map((q, idx) => ({
            id: '_cuota_' + tempId + '_' + idx,
            venta_id: tempId,
            numero: q.numero || idx + 1,
            monto: Number(q.monto || 0),
            vence_en: q.vence_en || fechaIso,
            pagada: false,
          })),
        };

        if (INV.sync) {
          // 1. Descontar stock localmente para prevenir sobreventas offline
          const stocks = await INV.sync.obtenerCache('stock_actual', []);
          (datos.items || []).forEach(it => {
            const prodIdx = stocks.findIndex(s => String(s.id) === String(it.producto_id));
            if (prodIdx !== -1) {
              stocks[prodIdx].stock = Math.max(0, Number(stocks[prodIdx].stock || 0) - Number(it.cantidad || 0));
            }
          });
          await INV.sync.guardarCache('stock_actual', stocks);

          // 2. Guardar venta en listado y caché individual
          const ventas = await INV.sync.obtenerCache('ventas', []);
          ventas.unshift(ventaOffline);
          await INV.sync.guardarCache('ventas', ventas);
          await INV.sync.guardarCache('venta_' + tempId, ventaOffline);

          // 3. Si tiene cuotas a crédito, agregar a cuotas pendientes
          if (datos.cuotas && datos.cuotas.length > 0) {
            const cuotasPend = await INV.sync.obtenerCache('cuotas_pendientes', []);
            datos.cuotas.forEach((q, idx) => {
              cuotasPend.push({
                id: '_cuota_' + tempId + '_' + idx,
                venta_id: tempId,
                numero: q.numero || idx + 1,
                monto: Number(q.monto || 0),
                vence_en: q.vence_en || fechaIso,
                cliente: 'Cliente offline',
                numero_venta: numeroProvisional,
              });
            });
            await INV.sync.guardarCache('cuotas_pendientes', cuotasPend);
          }

          // 4. Encolar la mutación de venta para sincronización
          INV.sync.encolarMutacion({
            tipo: 'ventas.crear',
            datos,
            temporalId: tempId,
            clave_idem: claveIdem,
            descripcion: `Emitir venta ${numeroProvisional} (${datos.items ? datos.items.length : 0} items - Total: ${datos.total})`
          });
        }

        return ventaOffline;
      },
    },

    cuotas: {
      pendientes: async () => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const data = await sb.from('cuotas_pendientes').select('*').order('vence_en').then(ok);
            if (INV.sync) await INV.sync.guardarCache('cuotas_pendientes', data);
            return data;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }
        return (INV.sync ? await INV.sync.obtenerCache('cuotas_pendientes', []) : []);
      },

      pagar: async (id, metodo, monto, tasa = 1, referencia = null) => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const { error } = await sb.rpc('pagar_cuota', {
              p_cuota_id: Number(id),
              p_metodo: metodo,
              p_monto: Number(monto),
              p_tasa: Number(tasa || 1),
              p_referencia: referencia || null,
            });
            if (error) throw new Error(error.message);
            return true;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        if (INV.sync) {
          const cuotas = await INV.sync.obtenerCache('cuotas_pendientes', []);
          const filtradas = cuotas.filter(c => String(c.id) !== String(id));
          await INV.sync.guardarCache('cuotas_pendientes', filtradas);

          INV.sync.encolarMutacion({
            tipo: 'cuotas.pagar',
            datos: { id, metodo, monto, tasa, referencia },
            descripcion: `Pagar cuota #${id} (${monto})`
          });
        }
        return true;
      },
    },

    comercio: {
      obtener: async () => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const data = await sb.from('mi_comercio').select('*').maybeSingle().then(ok);
            if (data && INV.sync) await INV.sync.guardarCache('comercio', data);
            return data;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }
        return (INV.sync ? await INV.sync.obtenerCache('comercio', null) : null);
      },

      guardar: async datos => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const actual = await sb.from('mi_comercio').select('id').maybeSingle().then(ok);
            if (!actual) throw new Error('Tu operador no tiene un comercio asignado');
            const res = await sb.from('comercios')
              .update({ ...datos, actualizado_en: new Date().toISOString() })
              .eq('id', actual.id).select().single().then(ok);
            if (INV.sync) await INV.sync.guardarCache('comercio', res);
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }

        // Modo Offline
        if (INV.sync) {
          const actual = await INV.sync.obtenerCache('comercio', {});
          const guardado = { ...actual, ...datos, actualizado_en: new Date().toISOString() };
          await INV.sync.guardarCache('comercio', guardado);
          if (actual && actual.id) {
            INV.sync.encolarMutacion({
              tipo: 'comercio.guardar',
              datos: { id: actual.id, ...datos },
              descripcion: 'Actualizar configuración del comercio'
            });
          }
          return guardado;
        }
        return datos;
      },
    },

    comercios: {
      listar: () => sb.from('comercios').select('*').order('nombre').then(ok).catch(() => []),
      crear:  datos => sb.rpc('crear_comercio', { p: datos })
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return sb.from('comercios').select('*').eq('id', data).single().then(ok);
        }),
      actualizar: (id, datos) => sb.from('comercios')
        .update({ ...datos, actualizado_en: new Date().toISOString() })
        .eq('id', id).select().single().then(ok),
      eliminar: id => sb.from('comercios').delete().eq('id', id).then(ok),
      crearMio: datos => sb.rpc('crear_mi_comercio', { p: datos })
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return sb.from('comercios').select('*').eq('id', data).single().then(ok);
        }),
      cambiar: async id => {
        const { data: sesion } = await sb.auth.getSession();
        const correo = sesion && sesion.session ? sesion.session.user.email : '';
        const destino = (id === null || id === '' || id === undefined) ? null : Number(id);
        return sb.from('operadores').update({ comercio_id: destino })
          .ilike('correo', correo).select().maybeSingle().then(ok);
      },
    },

    operadores: {
      listar: () => sb.from('operadores')
        .select('*, comercios(nombre)').order('nombre')
        .then(ok).then(filas => filas.map(o => ({
          ...o, comercio: o.comercios ? o.comercios.nombre : null,
        }))).catch(() => []),
      crear:  datos => sb.from('operadores').insert(datos).select().single().then(ok),
      actualizar: (id, datos) => sb.from('operadores').update(datos).eq('id', id)
        .select().single().then(ok),
      eliminar: id => sb.from('operadores').delete().eq('id', id).then(ok),
      solicitarRegistro: async datos => {
        let usuarioId = null;
        const correoLimpio = datos.correo.trim().toLowerCase();
        const nombreLimpio = datos.nombre.trim();
        const rolSolicitado = datos.rol || 'operador_facturador';

        // 1. Crear el usuario en Supabase Auth con cliente independiente (sin requerir sesión previa)
        if (datos.clave) {
          try {
            const aparte = window.supabase.createClient(
              INV.config.SUPABASE_URL,
              INV.config.SUPABASE_ANON,
              { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
            );
            const { data: authData, error: authErr } = await aparte.auth.signUp({
              email: correoLimpio,
              password: datos.clave,
              options: {
                data: {
                  nombre: nombreLimpio,
                  rol_solicitado: rolSolicitado,
                }
              }
            });

            if (authErr) {
              const msg = (authErr.message || '').toLowerCase();
              if (!msg.includes('already registered') && !msg.includes('already been registered')) {
                throw new Error(traducirAlta(authErr.message));
              }
            }
            if (authData && authData.user) {
              usuarioId = authData.user.id;
            }
          } catch (errAuth) {
            if (!/already registered|already been registered/i.test(errAuth.message || '')) {
              throw errAuth;
            }
          }
        }

        // 2. Registrar la solicitud en la tabla operadores (activo = false, comercio_id = null)
        const payload = {
          nombre: nombreLimpio,
          correo: correoLimpio,
          rol: rolSolicitado,
          usuario_id: usuarioId,
        };

        try {
          const { data, error } = await sb.rpc('solicitar_registro', { p: payload });
          if (!error && data) return { id: data, ...payload, activo: false };
        } catch (e) { /* fallback a inserción directa */ }

        // Fallback a inserción directa
        const op = {
          nombre: nombreLimpio,
          correo: correoLimpio,
          rol: rolSolicitado,
          activo: false,
          comercio_id: null,
          usuario_id: usuarioId,
        };
        return sb.from('operadores').insert(op).select().single().then(ok).catch(() => op);
      },
      aprobar: async (id, { rol, comercio_id }) => {
        return sb.from('operadores').update({
          rol,
          comercio_id: Number(comercio_id),
          activo: true
        }).eq('id', id).select().single().then(ok);
      },
      rolDe: async correo => {
        try {
          const { data, error } = await sb.from('operadores')
            .select('rol').eq('activo', true).ilike('correo', correo).limit(1);
          if (error || !data || !data.length) return null;
          if (INV.sync) await INV.sync.guardarCache('rol_' + correo, data[0].rol);
          return data[0].rol;
        } catch (e) {
          if (INV.sync) return await INV.sync.obtenerCache('rol_' + correo, null);
          return null;
        }
      },
      datoDe: async correo => {
        try {
          const { data, error } = await sb.from('operadores')
            .select('nombre, rol, ultimo_acceso')
            .eq('activo', true).ilike('correo', correo).limit(1);
          if (error || !data || !data.length) return null;
          if (INV.sync) await INV.sync.guardarCache('dato_' + correo, data[0]);
          return data[0];
        } catch (e) {
          if (INV.sync) return await INV.sync.obtenerCache('dato_' + correo, null);
          return null;
        }
      },
      registrarAcceso: async correo => {
        try {
          await sb.from('operadores')
            .update({ ultimo_acceso: new Date().toISOString() })
            .ilike('correo', correo);
        } catch (e) { /* columna puede no existir aún o estar offline */ }
      },
    },

    padron: {
      buscar: async rifLimpio => {
        try {
          const { data, error } = await sb.from('padron_contribuyentes')
            .select('*')
            .ilike('rif', rifLimpio)
            .limit(1);
          if (error || !data || !data.length) return null;
          return data[0];
        } catch (e) { return null; }
      },
      guardar: async datos => {
        try {
          return await sb.from('padron_contribuyentes')
            .upsert(datos, { onConflict: 'rif' })
            .select().single().then(ok);
        } catch (e) { return null; }
      },
    },

    tasas: {
      vigente: async (moneda = 'USD') => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const data = await sb.from('tasa_vigente').select('*')
              .eq('moneda', moneda).maybeSingle().then(ok);
            if (data && INV.sync) await INV.sync.guardarCache('tasa_' + moneda, data);
            return data;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }
        return (INV.sync ? await INV.sync.obtenerCache('tasa_' + moneda, null) : null);
      },
      historico: (moneda = 'USD', limite = 30) => sb.from('tasas_cambio').select('*')
        .eq('moneda', moneda).order('fecha', { ascending: false }).limit(limite).then(ok).catch(() => []),
      fijar: (fecha, tasa, moneda = 'USD') => sb.from('tasas_cambio').upsert({
        moneda, fecha, tasa, fuente: 'manual', obtenida_en: new Date().toISOString(),
      }, { onConflict: 'moneda,fecha' }).select().single().then(ok),
    },

    cajas: {
      listar: async () => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const data = await sb.from('cajas').select('*').eq('activa', true).order('bloque').then(ok);
            if (INV.sync) await INV.sync.guardarCache('cajas', data);
            return data;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }
        return (INV.sync ? await INV.sync.obtenerCache('cajas', [{ id: 1, nombre: 'Caja 1', bloque: 1, activa: true }]) : []);
      },
      crear: async datos => {
        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const res = await sb.from('cajas').insert(datos).select().single().then(ok);
            if (INV.sync) {
              const cajas = await INV.sync.obtenerCache('cajas', []);
              cajas.push(res);
              await INV.sync.guardarCache('cajas', cajas);
            }
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }
        const tempId = '_temp_caja_' + Date.now();
        const cajaOffline = { id: tempId, ...datos, activa: true, _offline: true };
        if (INV.sync) {
          const cajas = await INV.sync.obtenerCache('cajas', []);
          cajas.push(cajaOffline);
          await INV.sync.guardarCache('cajas', cajas);
          INV.sync.encolarMutacion({
            tipo: 'cajas.crear',
            datos,
            temporalId: tempId,
            descripcion: `Crear caja "${datos.nombre}"`
          });
        }
        return cajaOffline;
      },
      actualizar: async (id, datos) => {
        if (!esIdTemporal(id) && (!INV.sync || !INV.sync.esOffline())) {
          try {
            const res = await sb.from('cajas').update(datos).eq('id', id).select().single().then(ok);
            if (INV.sync) {
              const cajas = await INV.sync.obtenerCache('cajas', []);
              const idx = cajas.findIndex(c => String(c.id) === String(id));
              if (idx !== -1) cajas[idx] = { ...cajas[idx], ...res };
              await INV.sync.guardarCache('cajas', cajas);
            }
            return res;
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }
        if (INV.sync) {
          const cajas = await INV.sync.obtenerCache('cajas', []);
          const idx = cajas.findIndex(c => String(c.id) === String(id));
          if (idx !== -1) {
            cajas[idx] = { ...cajas[idx], ...datos };
            await INV.sync.guardarCache('cajas', cajas);
          }
          INV.sync.encolarMutacion({
            tipo: 'cajas.actualizar',
            datos: { id, ...datos },
            descripcion: `Actualizar caja #${id}`
          });
        }
        return { id, ...datos };
      },
    },

    conflictos: {
      listar: () => sb.from('conflictos_sync').select('*')
        .eq('resuelto', false).order('creado_en').then(ok).catch(() => []),
      registrar: datos => sb.rpc('registrar_conflicto', { p: datos })
        .then(({ data, error }) => { if (error) throw new Error(error.message); return data; }),
      resolver: (id, nota) => sb.from('conflictos_sync').update({
        resuelto: true, resuelto_en: new Date().toISOString(), nota_resolucion: nota || null,
      }).eq('id', id).then(ok),
    },

    cuentas: {
      conFuncion: () => !!(INV.config.FUNCION_CUENTAS || '').trim(),
      capacidad: () => INV.db.cuentas.conFuncion()
        ? { crear: true, cambiar: true }
        : { crear: true, cambiar: false },
      asignar: async (correo, clave) => {
        if (INV.db.cuentas.conFuncion()) return llamarFuncion('crear', { correo, clave });
        const aparte = window.supabase.createClient(INV.config.SUPABASE_URL, INV.config.SUPABASE_ANON, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const { data, error } = await aparte.auth.signUp({ email: correo, password: clave });
        if (error) throw new Error(traducirAlta(error.message));
        return {
          creada: true,
          requiereConfirmacion: !data.session,
          usuario_id: data.user ? data.user.id : null,
        };
      },
      crear: async (correo, clave) => {
        if (INV.db.cuentas.conFuncion()) return llamarFuncion('crear', { correo, clave });
        const aparte = window.supabase.createClient(INV.config.SUPABASE_URL, INV.config.SUPABASE_ANON, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const { data, error } = await aparte.auth.signUp({ email: correo, password: clave });
        if (error) throw new Error(traducirAlta(error.message));
        return {
          creada: true,
          requiereConfirmacion: !data.session,
          usuario_id: data.user ? data.user.id : null,
        };
      },
      cambiar: async (correo, clave) => {
        if (!INV.db.cuentas.conFuncion())
          throw new Error('Para cambiar contraseñas hace falta la función de administración.');
        return llamarFuncion('cambiar', { correo, clave });
      },
    },

    archivos: {
      subir: async (dataUrl, sku) => {
        if (!dataUrl) return null;
        if (dataUrl.startsWith('http') || !dataUrl.startsWith('data:')) return dataUrl;

        if (!INV.sync || !INV.sync.esOffline()) {
          try {
            const respuesta = await fetch(dataUrl);
            const blob = await respuesta.blob();
            const ruta = `productos/${sku}-${Date.now()}.jpg`;
            const { error } = await sb.storage.from('inventario')
              .upload(ruta, blob, { upsert: true, contentType: 'image/jpeg' });
            if (!error) return ruta;
            if (!esErrorDeRed(error)) throw new Error(error.message);
          } catch (e) {
            if (!esErrorDeRed(e)) throw e;
          }
        }
        // Modo offline: devolver el dataUrl para que la vista y la caché lo usen de inmediato
        return dataUrl;
      },
      url: ruta => {
        if (!ruta) return null;
        if (ruta.startsWith('data:') || ruta.startsWith('http')) return ruta;
        try {
          return sb.storage.from('inventario').getPublicUrl(ruta).data.publicUrl;
        } catch (e) {
          return null;
        }
      },
    },
  };
})();
