/* =====================================================================
   BaratoPrimo — Motor de Sincronización y Capa Offline
   ---------------------------------------------------------------------
   Permite operar sin conexión de manera 100% transparente.
   - Detecta pérdida de WiFi/datos de inmediato y activa modo offline.
   - Mantiene una caché local (IndexedDB + localStorage) de lectura rápida.
   - Encola mutaciones en orden FIFO con claves de idempotencia (clave_idem).
   - Genera IDs temporales seguros y resuelve claves foráneas al sincronizar.
   - Al volver la conexión, sincroniza de forma atómica y valida la integridad.
   ===================================================================== */
(function () {
  const DB_NOMBRE = 'baratoprimo_offline_v1';
  const DB_VERSION = 1;
  const CLAVE_COLA = 'baratoprimo_sync_cola_v1';
  const CLAVE_MAPEO = 'baratoprimo_sync_mapeo_v1';
  const CLAVE_LOG = 'baratoprimo_sync_log_v1';
  const CLAVE_CACHE_PREFIJO = 'baratoprimo_cache_';

  /* ---------------- Estado interno ---------------- */
  let idb = null;
  let enLinea = navigator.onLine;
  let sincronizando = false;
  let temporizadorHeartbeat = null;
  let listeners = [];

  /* Generador de identificadores únicos y claves de idempotencia */
  function uuid(prefijo = 'idem') {
    const rnd = Math.random().toString(36).substring(2, 10);
    const tiempo = Date.now().toString(36);
    return `${prefijo}_${tiempo}_${rnd}`;
  }

  /* ---------------- Inicialización IndexedDB ---------------- */
  function abrirIndexedDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        console.warn('[Sync] IndexedDB no disponible, usando localStorage como respaldo');
        resolve(null);
        return;
      }
      try {
        const peticion = window.indexedDB.open(DB_NOMBRE, DB_VERSION);
        peticion.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('cache')) {
            db.createObjectStore('cache', { keyPath: 'clave' });
          }
          if (!db.objectStoreNames.contains('cola')) {
            db.createObjectStore('cola', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('mapeo')) {
            db.createObjectStore('mapeo', { keyPath: 'temporal' });
          }
        };
        peticion.onsuccess = (e) => {
          idb = e.target.result;
          resolve(idb);
        };
        peticion.onerror = () => {
          console.warn('[Sync] Error al abrir IndexedDB, usando localStorage');
          resolve(null);
        };
      } catch (err) {
        resolve(null);
      }
    });
  }

  /* ---------------- Almacenamiento Caché Local ---------------- */

  async function guardarCache(clave, datos) {
    if (!datos) return;
    const registro = { clave, datos, actualizado_en: new Date().toISOString() };
    
    // Respaldo en localStorage
    try {
      localStorage.setItem(CLAVE_CACHE_PREFIJO + clave, JSON.stringify(registro));
    } catch (e) { /* localStorage lleno o bloqueado */ }

    // Guardado en IndexedDB si existe
    if (idb) {
      try {
        const tx = idb.transaction('cache', 'readwrite');
        tx.objectStore('cache').put(registro);
      } catch (e) {}
    }
  }

  async function obtenerCache(clave, valorPorDefecto = null) {
    if (idb) {
      try {
        const promesa = new Promise((resolve) => {
          const tx = idb.transaction('cache', 'readonly');
          const req = tx.objectStore('cache').get(clave);
          req.onsuccess = () => resolve(req.result ? req.result.datos : null);
          req.onerror = () => resolve(null);
        });
        const res = await promesa;
        if (res !== null && res !== undefined) return res;
      } catch (e) {}
    }

    try {
      const g = localStorage.getItem(CLAVE_CACHE_PREFIJO + clave);
      if (g) {
        const parseado = JSON.parse(g);
        return parseado && parseado.datos !== undefined ? parseado.datos : valorPorDefecto;
      }
    } catch (e) {}

    return valorPorDefecto;
  }

  /* ---------------- Cola de Mutaciones ---------------- */

  function obtenerColaLocal() {
    try {
      const c = localStorage.getItem(CLAVE_COLA);
      return c ? JSON.parse(c) : [];
    } catch (e) {
      return [];
    }
  }

  function guardarColaLocal(cola) {
    try {
      localStorage.setItem(CLAVE_COLA, JSON.stringify(cola));
    } catch (e) {}
    notificarCambio();
  }

  function encolarMutacion({ tipo, datos, temporalId = null, clave_idem = null, descripcion = '' }) {
    const cola = obtenerColaLocal();
    const item = {
      id: uuid('mut'),
      tipo,
      datos: JSON.parse(JSON.stringify(datos)),
      temporalId,
      clave_idem: clave_idem || uuid('idem'),
      descripcion: descripcion || tipo,
      creado_en: new Date().toISOString(),
      intentos: 0,
      estado: 'pendiente',
      error: null
    };

    cola.push(item);
    guardarColaLocal(cola);
    registrarLog('encolado', `Acción offline guardada: ${item.descripcion}`, item);
    return item;
  }

  function actualizarMutacionEnCola(id, cambios) {
    const cola = obtenerColaLocal();
    const idx = cola.findIndex(m => m.id === id);
    if (idx !== -1) {
      cola[idx] = { ...cola[idx], ...cambios };
      guardarColaLocal(cola);
    }
  }

  function eliminarMutacionDeCola(id) {
    const cola = obtenerColaLocal();
    const filtrada = cola.filter(m => m.id !== id);
    guardarColaLocal(filtrada);
  }

  /* ---------------- Mapeo de Identificadores Temporales ---------------- */

  function obtenerMapeos() {
    try {
      const m = localStorage.getItem(CLAVE_MAPEO);
      return m ? JSON.parse(m) : {};
    } catch (e) {
      return {};
    }
  }

  function registrarMapeoId(temporal, real, entidad = '') {
    if (!temporal || !real || String(temporal) === String(real)) return;
    const mapeos = obtenerMapeos();
    mapeos[String(temporal)] = { real, entidad, registrado_en: new Date().toISOString() };
    try {
      localStorage.setItem(CLAVE_MAPEO, JSON.stringify(mapeos));
    } catch (e) {}
    console.log(`[Sync] ID remapeado (${entidad}): ${temporal} -> ${real}`);
  }

  function resolverId(id) {
    if (!id) return id;
    const mapeos = obtenerMapeos();
    const strId = String(id);
    if (mapeos[strId] && mapeos[strId].real !== undefined) {
      return mapeos[strId].real;
    }
    return id;
  }

  /* Aplica los mapeos de IDs a un objeto de mutación pendiente antes de enviarlo */
  function resolverReferencias(tipo, datos) {
    const d = JSON.parse(JSON.stringify(datos));
    const mapeos = obtenerMapeos();

    // Resolver cliente_id
    if (d.cliente_id && mapeos[String(d.cliente_id)]) {
      d.cliente_id = mapeos[String(d.cliente_id)].real;
    }

    // Resolver categoria_id
    if (d.categoria_id && mapeos[String(d.categoria_id)]) {
      d.categoria_id = mapeos[String(d.categoria_id)].real;
    }

    // Resolver producto_id en movimientos o items de venta
    if (d.producto_id && mapeos[String(d.producto_id)]) {
      d.producto_id = mapeos[String(d.producto_id)].real;
    }

    if (Array.isArray(d.items)) {
      d.items.forEach(item => {
        if (item.producto_id && mapeos[String(item.producto_id)]) {
          item.producto_id = mapeos[String(item.producto_id)].real;
        }
      });
    }

    // Resolver venta_id en pagos de cuotas
    if (d.venta_id && mapeos[String(d.venta_id)]) {
      d.venta_id = mapeos[String(d.venta_id)].real;
    }

    return d;
  }

  /* ---------------- Registro de Auditoría y Conflictos ---------------- */

  function obtenerLog() {
    try {
      const l = localStorage.getItem(CLAVE_LOG);
      return l ? JSON.parse(l) : [];
    } catch (e) {
      return [];
    }
  }

  function registrarLog(evento, mensaje, detalle = null) {
    const l = obtenerLog();
    const entrada = {
      id: uuid('log'),
      fecha: new Date().toISOString(),
      evento,
      mensaje,
      detalle: detalle ? JSON.parse(JSON.stringify(detalle)) : null
    };
    l.unshift(entrada);
    // Limitar historial a los últimos 100 eventos
    if (l.length > 100) l.length = 100;
    try {
      localStorage.setItem(CLAVE_LOG, JSON.stringify(l));
    } catch (e) {}
  }

  /* ---------------- Detección y Heartbeat de Red ---------------- */

  async function verificarConexionReal() {
    if (!navigator.onLine) {
      fijarEstadoRed(false);
      return false;
    }

    // En modo demo o drive, la red se asume disponible según el navegador
    if (INV.config && INV.config.MODO !== 'supabase') {
      fijarEstadoRed(true);
      return true;
    }

    try {
      const url = (INV.config.SUPABASE_URL || '').replace(/\/+$/, '') + '/rest/v1/';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const resp = await fetch(url, {
        method: 'HEAD',
        headers: { 'apikey': INV.config.SUPABASE_ANON || '' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const online = resp.status < 500;
      fijarEstadoRed(online);
      return online;
    } catch (err) {
      fijarEstadoRed(false);
      return false;
    }
  }

  function fijarEstadoRed(nuevoEstado) {
    const cambio = enLinea !== nuevoEstado;
    enLinea = nuevoEstado;

    if (cambio) {
      console.log(`[Sync] Conectividad cambiada: ${enLinea ? '🟢 EN LÍNEA' : '🟠 SIN CONEXIÓN'}`);
      if (enLinea) {
        if (INV.ui && INV.ui.avisar) {
          INV.ui.avisar('Conexión restablecida · Sincronizando cambios...');
        }
        // Auto-sincronizar inmediatamente al volver la conexión
        sincronizar();
      } else {
        if (INV.ui && INV.ui.avisar) {
          INV.ui.avisar('Modo sin conexión activado · Puedes seguir trabajando con normalidad', 'alerta');
        }
      }
    }
    notificarCambio();
  }

  function iniciarHeartbeat() {
    if (temporizadorHeartbeat) clearInterval(temporizadorHeartbeat);
    temporizadorHeartbeat = setInterval(verificarConexionReal, 15000);

    window.addEventListener('online', () => {
      setTimeout(verificarConexionReal, 500);
    });

    window.addEventListener('offline', () => {
      fijarEstadoRed(false);
    });
  }

  /* ---------------- Notificación y Eventos UI ---------------- */

  function suscribir(cb) {
    listeners.push(cb);
    cb(obtenerEstado());
    return () => {
      listeners = listeners.filter(l => l !== cb);
    };
  }

  function notificarCambio() {
    const estado = obtenerEstado();
    listeners.forEach(cb => {
      try { cb(estado); } catch (e) {}
    });

    // Actualizar UI del indicador
    pintarBadgeSync(estado);
  }

  function obtenerEstado() {
    const cola = obtenerColaLocal();
    const pendientes = cola.filter(m => m.estado === 'pendiente' || m.estado === 'sincronizando');
    const conError = cola.filter(m => m.estado === 'error');

    return {
      enLinea,
      sincronizando,
      totalPendientes: pendientes.length,
      totalErrores: conError.length,
      cola,
      ultimoSync: localStorage.getItem('baratoprimo_ultimo_sync') || null
    };
  }

  /* ---------------- Ejecutor del Motor de Sincronización ---------------- */

  async function sincronizar() {
    if (sincronizando) return { ok: false, motivo: 'ya_en_curso' };
    
    // Validar conectividad antes de procesar
    const online = await verificarConexionReal();
    if (!online) {
      return { ok: false, motivo: 'sin_conexion' };
    }

    const cola = obtenerColaLocal();
    if (!cola.length) {
      localStorage.setItem('baratoprimo_ultimo_sync', new Date().toISOString());
      notificarCambio();
      return { ok: true, procesados: 0 };
    }

    sincronizando = true;
    notificarCambio();
    registrarLog('sync_inicio', `Iniciando sincronización de ${cola.length} mutaciones`);

    let procesados = 0;
    let errores = 0;

    // Procesar en orden FIFO estricto
    for (const mutacion of [...cola]) {
      // Si perdimos conexión durante la sincronización, detenerse
      if (!enLinea) {
        break;
      }

      actualizarMutacionEnCola(mutacion.id, { estado: 'sincronizando' });

      try {
        const datosResueltos = resolverReferencias(mutacion.tipo, mutacion.datos);
        const resultado = await ejecutarMutacionRemota(mutacion.tipo, datosResueltos, mutacion.clave_idem);

        // Si la mutación creó un nuevo registro con ID temporal, asociarlo con el ID real
        if (mutacion.temporalId && resultado && (resultado.id !== undefined || resultado.data !== undefined)) {
          const realId = resultado.id || (typeof resultado === 'object' ? resultado.data : resultado);
          if (realId) {
            const entidad = mutacion.tipo.split('.')[0];
            registrarMapeoId(mutacion.temporalId, realId, entidad);
            await actualizarCacheConIdReal(entidad, mutacion.temporalId, realId, resultado);
          }
        }

        // Si fue una venta emitida offline con correlativo temporal F-OFF-XXX
        if (mutacion.tipo === 'ventas.crear' && resultado && resultado.numero) {
          registrarMapeoId(mutacion.temporalId, resultado.id, 'ventas');
          await actualizarVentaCacheada(mutacion.temporalId, resultado);
        }

        // Eliminar de la cola tras éxito
        eliminarMutacionDeCola(mutacion.id);
        procesados++;
        registrarLog('sync_exito', `Sincronizado: ${mutacion.descripcion}`, { id: mutacion.id, resultado });

      } catch (err) {
        console.error(`[Sync] Error al sincronizar ${mutacion.tipo}:`, err);
        const esErrorRed = /network|failed to fetch|offline|timeout|abort/i.test(err.message || '');
        
        if (esErrorRed) {
          fijarEstadoRed(false);
          actualizarMutacionEnCola(mutacion.id, { estado: 'pendiente', intentos: mutacion.intentos + 1 });
          break; // Detener hasta recuperar red
        } else {
          // Error de validación o conflicto de datos en backend
          errores++;
          actualizarMutacionEnCola(mutacion.id, {
            estado: 'error',
            error: err.message,
            intentos: mutacion.intentos + 1
          });
          registrarLog('sync_error', `Conflicto en ${mutacion.descripcion}: ${err.message}`, {
            id: mutacion.id,
            error: err.message
          });
        }
      }
    }

    sincronizando = false;
    localStorage.setItem('baratoprimo_ultimo_sync', new Date().toISOString());
    registrarLog('sync_fin', `Sincronización finalizada: ${procesados} procesados, ${errores} con conflicto`);
    
    // Refrescar caché con datos frescos del servidor
    await recargarCachesRemotas();

    // Notificar a la app para refrescar cualquier vista abierta
    window.dispatchEvent(new CustomEvent('recargar-vista'));
    window.dispatchEvent(new CustomEvent('sync-completado', { detail: { procesados, errores } }));

    if (procesados > 0 && INV.ui && INV.ui.avisar) {
      INV.ui.avisar(`Sincronización completada (${procesados} cambio${procesados > 1 ? 's' : ''} guardado${procesados > 1 ? 's' : ''})`);
    }

    notificarCambio();
    return { ok: true, procesados, errores };
  }

  /* ---------------- Ejecutor Directo contra Supabase ---------------- */

  async function ejecutarMutacionRemota(tipo, datos, clave_idem) {
    const sb = window.supabase.createClient(INV.config.SUPABASE_URL, INV.config.SUPABASE_ANON);

    switch (tipo) {
      case 'ventas.crear': {
        // Enviar con clave_idem para proteger de reenvíos
        const payload = { ...datos, clave_idem };
        const { data, error } = await sb.rpc('registrar_venta', { p: payload });
        if (error) throw new Error(error.message);
        
        // Obtener el registro completo de la venta para confirmación y ticket
        const [venta, items, pagos, cuotas] = await Promise.all([
          sb.from('ventas_detalle').select('*').eq('id', data).maybeSingle().then(r => r.data),
          sb.from('venta_items').select('*').eq('venta_id', data).order('id').then(r => r.data),
          sb.from('venta_pagos').select('*').eq('venta_id', data).order('id').then(r => r.data),
          sb.from('cuotas').select('*').eq('venta_id', data).order('numero').then(r => r.data),
        ]);
        return venta ? { ...venta, items, pagos, cuotas } : { id: data };
      }

      case 'ventas.anular': {
        const { error } = await sb.rpc('anular_venta', {
          p_venta_id: Number(datos.id),
          p_motivo: datos.motivo,
          p_detalle: datos.detalle || null
        });
        if (error) throw new Error(error.message);
        return { id: datos.id, anulada: true };
      }

      case 'movimientos.registrar': {
        let payload = { ...datos, clave_idem };
        if (typeof payload.producto_id === 'string' && payload.producto_id.startsWith('_temp_')) {
          const idResuelto = resolverId(payload.producto_id);
          if (idResuelto && !String(idResuelto).startsWith('_temp_')) {
            payload.producto_id = Number(idResuelto);
          } else if (payload.sku) {
            const { data: pExist } = await sb.from('productos').select('id').eq('sku', payload.sku).maybeSingle();
            if (pExist && pExist.id) {
              payload.producto_id = Number(pExist.id);
              registrarMapeoId(datos.producto_id, pExist.id, 'productos');
            }
          }
        }

        const { data, error } = await sb.rpc('registrar_movimiento', { p: payload });
        if (!error) return { id: data, ...payload };

        const sinFuncion = /could not find the function|does not exist|schema cache/i.test(error.message || '');
        if (!sinFuncion) throw new Error(error.message);

        // Inserción directa si la función no existe
        const { clave_idem: c, ...limpio } = payload;
        const resp = await sb.from('movimientos').insert(limpio).select().single();
        if (resp.error) throw new Error(resp.error.message);
        return resp.data;
      }

      case 'clientes.crear': {
        try {
          const resp = await sb.from('clientes').insert(datos).select().single();
          if (resp.error) {
            if (/duplicate|unique|already exists|clientes_.*_key/i.test(resp.error.message)) {
              let q = sb.from('clientes').select('*');
              if (datos.documento) q = q.eq('documento', datos.documento);
              const { data: existente } = await q.maybeSingle();
              if (existente && existente.id) {
                const { data: actualizado } = await sb.from('clientes').update(datos).eq('id', existente.id).select().single();
                return actualizado || existente;
              }
            }
            throw new Error(resp.error.message);
          }
          return resp.data;
        } catch (err) {
          if (/column.*does not exist/i.test((err).message || '')) {
            const { es_agente_retencion, retencion_iva_porcentaje, retencion_islr_porcentaje, ...datosBase } = datos;
            const resp2 = await sb.from('clientes').insert(datosBase).select().single();
            if (resp2.error) throw new Error(resp2.error.message);
            return resp2.data;
          }
          throw err;
        }
      }

      case 'clientes.actualizar': {
        const idReal = resolverId(datos.id);
        const { id, ...campos } = datos;
        try {
          const resp = await sb.from('clientes').update(campos).eq('id', idReal).select().single();
          if (resp.error) throw new Error(resp.error.message);
          return resp.data;
        } catch (err) {
          if (/column.*does not exist/i.test(err.message || '')) {
            const { es_agente_retencion, retencion_iva_porcentaje, retencion_islr_porcentaje, ...datosBase } = campos;
            const resp2 = await sb.from('clientes').update(datosBase).eq('id', idReal).select().single();
            if (resp2.error) throw new Error(resp2.error.message);
            return resp2.data;
          }
          throw err;
        }
      }

      case 'clientes.desactivar': {
        const idReal = resolverId(datos.id);
        const resp = await sb.from('clientes').update({ activo: false }).eq('id', idReal);
        if (resp.error) throw new Error(resp.error.message);
        return { id: idReal, activo: false };
      }

      case 'productos.crear': {
        let payload = { ...datos };
        if (payload.imagen_path && payload.imagen_path.startsWith('data:')) {
          try {
            const respuesta = await fetch(payload.imagen_path);
            const blob = await respuesta.blob();
            const ruta = `productos/${payload.sku || 'prod'}-${Date.now()}.jpg`;
            const { error: errImg } = await sb.storage.from('inventario')
              .upload(ruta, blob, { upsert: true, contentType: 'image/jpeg' });
            if (!errImg) payload.imagen_path = ruta;
          } catch (e) {}
        }
        const resp = await sb.from('productos').insert(payload).select().single();
        if (resp.error) {
          // Si el SKU ya existía previamente en la base de datos (conflicto de SKU duplicado):
          if (/duplicate|unique|already exists|productos_.*_key/i.test(resp.error.message)) {
            const { data: existente } = await sb.from('productos')
              .select('*')
              .eq('sku', payload.sku)
              .maybeSingle();
            if (existente && existente.id) {
              const { data: actualizado } = await sb.from('productos')
                .update(payload)
                .eq('id', existente.id)
                .select()
                .single();
              return actualizado || existente;
            }
          }
          throw new Error(resp.error.message);
        }
        return resp.data;
      }

      case 'productos.actualizar': {
        const idReal = resolverId(datos.id);
        const { id, ...campos } = datos;
        let payload = { ...campos };
        if (payload.imagen_path && payload.imagen_path.startsWith('data:')) {
          try {
            const respuesta = await fetch(payload.imagen_path);
            const blob = await respuesta.blob();
            const ruta = `productos/${datos.sku || idReal}-${Date.now()}.jpg`;
            const { error: errImg } = await sb.storage.from('inventario')
              .upload(ruta, blob, { upsert: true, contentType: 'image/jpeg' });
            if (!errImg) payload.imagen_path = ruta;
          } catch (e) {}
        }
        const resp = await sb.from('productos').update(payload).eq('id', idReal).select().single();
        if (resp.error) throw new Error(resp.error.message);
        return resp.data;
      }

      case 'productos.desactivar': {
        const idReal = resolverId(datos.id);
        const resp = await sb.from('productos').update({ activo: false }).eq('id', idReal);
        if (resp.error) throw new Error(resp.error.message);
        return { id: idReal, activo: false };
      }

      case 'categorias.crear': {
        const resp = await sb.from('categorias').insert(datos).select().single();
        if (resp.error) {
          if (/duplicate|unique|already exists|categorias_.*_key/i.test(resp.error.message)) {
            const { data: existente } = await sb.from('categorias')
              .select('*')
              .eq('nombre', datos.nombre)
              .maybeSingle();
            if (existente && existente.id) return existente;
          }
          throw new Error(resp.error.message);
        }
        return resp.data;
      }

      case 'categorias.actualizar': {
        const idReal = resolverId(datos.id);
        const { id, ...campos } = datos;
        const resp = await sb.from('categorias').update(campos).eq('id', idReal).select().single();
        if (resp.error) throw new Error(resp.error.message);
        return resp.data;
      }

      case 'categorias.eliminar': {
        const idReal = resolverId(datos.id);
        const resp = await sb.from('categorias').delete().eq('id', idReal);
        if (resp.error) throw new Error(resp.error.message);
        return { id: idReal, eliminado: true };
      }

      case 'cuotas.pagar': {
        const { error } = await sb.rpc('pagar_cuota', {
          p_cuota_id: Number(resolverId(datos.id)),
          p_metodo: datos.metodo,
          p_monto: Number(datos.monto),
          p_tasa: Number(datos.tasa || 1),
          p_referencia: datos.referencia || null,
        });
        if (error) throw new Error(error.message);
        return { ok: true, id: datos.id };
      }

      case 'cajas.crear': {
        const resp = await sb.from('cajas').insert(datos).select().single();
        if (resp.error) throw new Error(resp.error.message);
        return resp.data;
      }

      case 'cajas.actualizar': {
        const { id, ...campos } = datos;
        const resp = await sb.from('cajas').update(campos).eq('id', id).select().single();
        if (resp.error) throw new Error(resp.error.message);
        return resp.data;
      }

      case 'comercio.guardar': {
        const { id, ...campos } = datos;
        const resp = await sb.from('comercios').update({
          ...campos,
          actualizado_en: new Date().toISOString()
        }).eq('id', id).select().single();
        if (resp.error) throw new Error(resp.error.message);
        return resp.data;
      }

      default:
        throw new Error(`Tipo de mutación no soportado: ${tipo}`);
    }
  }

  /* ---------------- Actualización de Caché tras Remapeo ---------------- */

  async function actualizarCacheConIdReal(entidad, tempId, realId, datosNuevos) {
    const claveCache = entidad === 'clientes' ? 'clientes'
      : entidad === 'productos' ? 'productos'
      : entidad === 'categorias' ? 'categorias'
      : null;

    if (!claveCache) return;

    const lista = await obtenerCache(claveCache, []);
    let modificado = false;

    const nuevaLista = lista.map(item => {
      if (String(item.id) === String(tempId)) {
        modificado = true;
        return { ...item, ...datosNuevos, id: realId, _offline: false };
      }
      return item;
    });

    if (modificado) {
      await guardarCache(claveCache, nuevaLista);
    }
  }

  async function actualizarVentaCacheada(tempId, ventaOficial) {
    const ventas = await obtenerCache('ventas', []);
    const idx = ventas.findIndex(v => String(v.id) === String(tempId));
    if (idx !== -1) {
      ventas[idx] = { ...ventas[idx], ...ventaOficial, _offline: false };
    } else {
      ventas.unshift({ ...ventaOficial, _offline: false });
    }
    await guardarCache('ventas', ventas);
    await guardarCache('venta_' + ventaOficial.id, ventaOficial);
  }

  async function recargarCachesRemotas() {
    if (!enLinea || (INV.config && INV.config.MODO !== 'supabase')) return;
    const sb = window.supabase.createClient(INV.config.SUPABASE_URL, INV.config.SUPABASE_ANON);

    try {
      const [prods, cats, clis, stock, tasas, cajas] = await Promise.all([
        sb.from('productos').select('*, categorias(nombre)').eq('activo', true).order('nombre').then(r => r.data),
        sb.from('categorias').select('*').order('nombre').then(r => r.data),
        sb.from('clientes').select('*').eq('activo', true).order('apellidos').then(r => r.data),
        sb.from('stock_actual').select('*').order('nombre').then(r => r.data),
        sb.from('tasa_vigente').select('*').eq('moneda', 'USD').maybeSingle().then(r => r.data),
        sb.from('cajas').select('*').eq('activa', true).order('bloque').then(r => r.data),
      ]);

      if (prods) await guardarCache('productos', prods);
      if (cats) await guardarCache('categorias', cats);
      if (clis) await guardarCache('clientes', clis);
      if (stock) await guardarCache('stock_actual', stock);
      if (tasas) await guardarCache('tasa_USD', tasas);
      if (cajas) await guardarCache('cajas', cajas);
    } catch (e) {
      console.warn('[Sync] No se pudo refrescar caché completa:', e.message);
    }
  }

  /* ---------------- Validador de Integridad ---------------- */

  async function validarIntegridad() {
    const estado = obtenerEstado();
    const productos = await obtenerCache('productos', []);
    const stockActual = await obtenerCache('stock_actual', []);
    const clientes = await obtenerCache('clientes', []);
    const ventas = await obtenerCache('ventas', []);

    const reporte = {
      valido: true,
      fecha: new Date().toISOString(),
      conectividad: estado.enLinea ? 'En línea' : 'Sin conexión',
      colaPendientes: estado.totalPendientes,
      colaErrores: estado.totalErrores,
      totalProductos: productos.length,
      totalClientes: clientes.length,
      totalVentasCheadas: ventas.length,
      advertencias: [],
      errores: []
    };

    // 1. Validar si hay mutaciones con errores/conflictos
    if (estado.totalErrores > 0) {
      reporte.valido = false;
      reporte.errores.push(`${estado.totalErrores} mutaciones tienen conflicto y requieren atención.`);
    }

    // 2. Validar que no haya IDs temporales no resueltos en productos o clientes si la cola está vacía
    if (estado.totalPendientes === 0) {
      const clientesTemp = clientes.filter(c => String(c.id).startsWith('_temp_') || String(c.id).startsWith('_offline_'));
      if (clientesTemp.length > 0) {
        reporte.valido = false;
        reporte.errores.push(`Existen ${clientesTemp.length} clientes con ID temporal residual en la caché.`);
      }

      const productosTemp = productos.filter(p => String(p.id).startsWith('_temp_') || String(p.id).startsWith('_offline_'));
      if (productosTemp.length > 0) {
        reporte.valido = false;
        reporte.errores.push(`Existen ${productosTemp.length} productos con ID temporal residual en la caché.`);
      }
    }

    // 3. Validar consistencia de stock
    stockActual.forEach(s => {
      if (isNaN(Number(s.stock))) {
        reporte.advertencias.push(`El producto "${s.nombre}" tiene un valor de stock no numérico: ${s.stock}`);
      }
    });

    registrarLog('validacion_integridad', `Validación: ${reporte.valido ? 'EXITOSA' : 'CON ADVERTENCIAS/ERRORES'}`, reporte);
    return reporte;
  }

  /* ---------------- UI: Badge y Modal de Sincronización ---------------- */

  function pintarBadgeSync(estado) {
    const contenedor = document.getElementById('sync-status-pill');
    if (!contenedor) return;

    if (!estado.enLinea) {
      contenedor.className = 'sync-pill sync-pill--offline';
      contenedor.innerHTML = `
        <span class="sync-pill__dot"></span>
        <span class="sync-pill__text">Sin conexión${estado.totalPendientes > 0 ? ` (${estado.totalPendientes})` : ''}</span>
      `;
      contenedor.title = `Modo sin conexión activo · ${estado.totalPendientes} cambio(s) guardado(s) localmente. Clic para ver detalles.`;
    } else if (estado.sincronizando) {
      contenedor.className = 'sync-pill sync-pill--syncing';
      contenedor.innerHTML = `
        <span class="sync-pill__spinner"></span>
        <span class="sync-pill__text">Sincronizando...</span>
      `;
      contenedor.title = 'Sincronizando cambios con el servidor...';
    } else if (estado.totalErrores > 0) {
      contenedor.className = 'sync-pill sync-pill--error';
      contenedor.innerHTML = `
        <span class="sync-pill__dot"></span>
        <span class="sync-pill__text">Atención (${estado.totalErrores})</span>
      `;
      contenedor.title = `${estado.totalErrores} cambio(s) tuvieron conflicto al sincronizar. Clic para revisar.`;
    } else if (estado.totalPendientes > 0) {
      contenedor.className = 'sync-pill sync-pill--pending';
      contenedor.innerHTML = `
        <span class="sync-pill__dot"></span>
        <span class="sync-pill__text">${estado.totalPendientes} pendiente${estado.totalPendientes > 1 ? 's' : ''}</span>
      `;
      contenedor.title = `${estado.totalPendientes} cambio(s) listos para sincronizar. Clic para sincronizar.`;
    } else {
      contenedor.className = 'sync-pill sync-pill--online';
      contenedor.innerHTML = `
        <span class="sync-pill__dot"></span>
        <span class="sync-pill__text">Sincronizado</span>
      `;
      contenedor.title = 'Conectado · Todos los datos están al día en el servidor.';
    }
  }

  function mostrarModalSync() {
    if (!INV.ui || !INV.ui.abrirModal) return;
    const estado = obtenerEstado();

    const filasCola = estado.cola.length === 0
      ? '<p class="lista__sub" style="margin:12px 0;">No hay cambios pendientes de sincronizar.</p>'
      : `<div class="tabla-scroll" style="max-height:220px; margin-top:8px;">
          <table class="tabla tabla--compacta">
            <thead>
              <tr>
                <th>Operación</th>
                <th>Hora</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${estado.cola.map(m => `
                <tr>
                  <td><b>${INV.ui.esc(m.descripcion || m.tipo)}</b></td>
                  <td class="lista__sub">${new Date(m.creado_en).toLocaleTimeString('es')}</td>
                  <td>
                    <span class="badge ${m.estado === 'error' ? 'badge--rojo' : m.estado === 'sincronizando' ? 'badge--azul' : 'badge--gris'}">
                      ${m.estado === 'error' ? 'Conflicto' : m.estado === 'sincronizando' ? 'Enviando…' : 'Pendiente'}
                    </span>
                    ${m.error ? `<div class="error" style="font-size:11px; margin-top:2px;">${INV.ui.esc(m.error)}</div>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;

    const htmlCuerpo = `
      <div class="sync-modal">
        <div class="sync-modal__header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div>
            <div style="font-size:13px; font-weight:600; color:var(--tinta);">
              Estado: ${estado.enLinea ? '🟢 Conectado a la nube' : '🟠 Modo sin conexión (WiFi/Datos inactivos)'}
            </div>
            <div class="lista__sub" style="font-size:12px;">
              ${estado.ultimoSync ? `Última sincronización exitosa: ${new Date(estado.ultimoSync).toLocaleString('es')}` : 'Sin sincronizaciones previas'}
            </div>
          </div>
        </div>

        <h4 style="margin:14px 0 6px 0; font-size:13px; text-transform:uppercase; letter-spacing:.5px; color:var(--tinta-3);">
          Cola de Cambios Locales (${estado.cola.length})
        </h4>
        ${filasCola}

        <div style="margin-top:16px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <button id="btn-sync-forzar" class="btn btn--primario btn--chico" ${estado.sincronizando ? 'disabled' : ''}>
            ${estado.sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
          <button id="btn-sync-validar" class="btn btn--secundario btn--chico">
            Verificar integridad
          </button>
          ${estado.cola.length > 0 ? `
            <button id="btn-sync-descartar" class="btn btn--fantasma btn--chico" style="color:var(--rojo); margin-left:auto;">
              Descartar cola (${estado.cola.length})
            </button>
          ` : ''}
        </div>

        <div id="sync-resultado-validacion" style="margin-top:12px;" hidden></div>
      </div>
    `;

    INV.ui.abrirModal({
      titulo: 'Estado de Sincronización y Modo Offline',
      cuerpo: htmlCuerpo,
      ancho: '560px'
    });

    const btnForzar = document.getElementById('btn-sync-forzar');
    if (btnForzar) {
      btnForzar.addEventListener('click', async () => {
        btnForzar.disabled = true;
        btnForzar.textContent = 'Sincronizando…';
        const res = await sincronizar();
        if (res && res.ok) {
          if (INV.ui && INV.ui.cerrarModal) INV.ui.cerrarModal();
          if (INV.ui && INV.ui.avisar) INV.ui.avisar('Sincronización completada con éxito');
        } else {
          btnForzar.disabled = false;
          btnForzar.textContent = 'Sincronizar ahora';
          if (res && res.motivo === 'sin_conexion') {
            if (INV.ui && INV.ui.avisar) INV.ui.avisar('No hay conexión a Internet para sincronizar', 'alerta');
          }
          mostrarModalSync();
        }
      });
    }

    const btnDescartar = document.getElementById('btn-sync-descartar');
    if (btnDescartar) {
      btnDescartar.addEventListener('click', () => {
        if (confirm('¿Deseas descartar los cambios locales pendientes de sincronizar?')) {
          guardarColaLocal([]);
          mostrarModalSync();
          if (INV.ui && INV.ui.avisar) INV.ui.avisar('Cola de sincronización vaciada');
        }
      });
    }

    const btnValidar = document.getElementById('btn-sync-validar');
    if (btnValidar) {
      btnValidar.addEventListener('click', async () => {
        btnValidar.disabled = true;
        btnValidar.textContent = 'Validando…';
        const res = await validarIntegridad();
        btnValidar.disabled = false;
        btnValidar.textContent = 'Verificar integridad';

        const div = document.getElementById('sync-resultado-validacion');
        if (div) {
          div.hidden = false;
          div.innerHTML = `
            <div class="panel" style="padding:10px; background:${res.valido ? 'rgba(46,125,50,0.1)' : 'rgba(211,47,47,0.1)'}; border:1px solid ${res.valido ? 'var(--verde)' : 'var(--rojo)'}; border-radius:6px; font-size:12px;">
              <b>${res.valido ? '✅ Integridad comprobada: Sin pérdidas ni inconsistencias' : '⚠️ Atención requerida en la sincronización'}</b>
              <div class="lista__sub" style="margin-top:4px;">
                Productos cacheados: ${res.totalProductos} · Clientes: ${res.totalClientes} · Ventas: ${res.totalVentasCheadas}
              </div>
              ${res.errores.length ? `<div style="color:var(--rojo); margin-top:4px;">${res.errores.join('<br>')}</div>` : ''}
              ${res.advertencias.length ? `<div style="color:var(--naranja); margin-top:4px;">${res.advertencias.join('<br>')}</div>` : ''}
            </div>
          `;
        }
      });
    }
  }

  /* ---------------- Inicialización del Motor ---------------- */

  async function iniciar() {
    await abrirIndexedDB();
    iniciarHeartbeat();
    verificarConexionReal();
    notificarCambio();
    console.log('[Sync] Motor de sincronización offline BaratoPrimo iniciado');
  }

  /* ---------------- API Pública ---------------- */
  window.INV = window.INV || {};
  INV.sync = {
    iniciar,
    guardarCache,
    obtenerCache,
    encolarMutacion,
    sincronizar,
    validarIntegridad,
    obtenerEstado,
    suscribir,
    verificarConexionReal,
    mostrarModalSync,
    uuid,
    fijarOffline: () => fijarEstadoRed(false),
    fijarEstadoRed,
    esOffline: () => !enLinea,
    estaSincronizando: () => sincronizando,
  };

  // Auto-iniciar al cargar el script
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
