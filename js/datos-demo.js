/* =====================================================================
   Adaptador de datos en memoria.
   Replica en JavaScript exactamente lo que hacen las vistas y el trigger
   del esquema SQL, de modo que la interfaz se comporta igual con o sin
   Supabase detrás. Persiste en localStorage cuando el navegador lo permite.
   ===================================================================== */
(function () {
  const CLAVE = 'inventario-demo-v1';

  const semilla = () => {
    const ahora = Date.now();
    const dias = n => new Date(ahora - n * 86400000).toISOString();
    return {
      categorias: [
        { id: 1, comercio_id: 1, nombre: 'Bebidas' },
        { id: 2, comercio_id: 1, nombre: 'Limpieza' },
        { id: 3, comercio_id: 1, nombre: 'Empaques' },
      ],
      productos: [
        { id:1, comercio_id:1, sku:'BEB-001', nombre:'Agua mineral 600 ml', categoria_id:1, unidad:'caja',   costo:8.50,  precio_venta:14.00, stock_minimo:100, activo:true },
        { id:2, comercio_id:1, sku:'BEB-002', nombre:'Refresco cola 2 L',   categoria_id:1, unidad:'caja',   costo:12.00, precio_venta:19.50, stock_minimo:65,  activo:true },
        { id:3, comercio_id:1, sku:'LIM-001', nombre:'Detergente 5 kg',     categoria_id:2, unidad:'unidad', costo:22.00, precio_venta:34.00, stock_minimo:21,  activo:true },
        { id:4, comercio_id:1, sku:'LIM-002', nombre:'Cloro 1 L',           categoria_id:2, unidad:'unidad', costo:3.20,  precio_venta:6.00,  stock_minimo:155, activo:true },
        { id:5, comercio_id:1, sku:'EMP-001', nombre:'Caja corrugada 40x30', categoria_id:3, unidad:'unidad', costo:1.10,  precio_venta:2.50,  stock_minimo:665, activo:true },
        { id:6, comercio_id:1, sku:'EMP-002', nombre:'Cinta de embalaje',   categoria_id:3, unidad:'rollo',  costo:2.40,  precio_venta:4.50,  stock_minimo:78, activo:true },
      ],
      movimientos: generarMovimientos(ahora),
      clientes: [
        { id:1, comercio_id:1, nombres:'María Fernanda', apellidos:'Rodríguez Salas', tipo_documento:'V', documento:'18456321', telefono:'0414-5567890', direccion:'Av. Bolívar, Res. El Parque, Torre A, Apt 5-B, Caracas', activo:true },
        { id:2, comercio_id:1, nombres:'Distribuidora Andina', apellidos:'C.A.', tipo_documento:'J', documento:'403118225', telefono:'0212-7789012', direccion:'Zona Industrial La Yaguara, Galpón 14, Caracas', activo:true },
        { id:3, comercio_id:1, nombres:'Carlos Eduardo', apellidos:'Mendoza Pérez', tipo_documento:'V', documento:'12987654', telefono:'0424-3312098', direccion:'Calle Sucre, Casa 22, Los Teques', activo:true },
        { id:4, comercio_id:1, nombres:'Giuseppe', apellidos:'Rinaldi', tipo_documento:'E', documento:'82345671', telefono:'0416-8890123', direccion:'Urb. La Trinidad, Qta. Milano, Caracas', activo:true },
      ],
      ventas: [],
      venta_items: [],
      venta_pagos: [],
      cuotas: [],
      anulaciones: [],
      cajas: [{ id: 1, comercio_id: 1, nombre: 'Caja 1', bloque: 1, activa: true }],
      conflictos: [],
      tasas: [{
        id: 1, moneda: 'USD',
        fecha: new Date(ahora - 4 * 3600 * 1000).toISOString().slice(0, 10),
        tasa: 236.7568, fuente: 'bcv', obtenida_en: new Date(ahora).toISOString(),
      }],
      comercios: [
        { id: 1, nombre: 'Bodega La Esquina, C.A.', rif: 'J-40987654-3',
          direccion: 'Calle 5 con Av. Lara, Barquisimeto', telefono: '0251-2223344',
          correo: '', mensaje: '¡Gracias por su compra!',
          iva_tasa: 16, moneda: 'Bs', tasa_usd: 0, tasa_eur: 0, ticket_ancho: '80',
          tasa_automatica: true, moneda_precios: 'VES', activo: true },
        { id: 2, nombre: 'Depósito El Trébol, C.A.', rif: 'J-41122334-0',
          direccion: 'Zona Industrial II, Galpón 7, Valencia', telefono: '0241-5566778',
          correo: '', mensaje: '¡Gracias por su compra!',
          iva_tasa: 16, moneda: 'Bs', tasa_usd: 0, tasa_eur: 0, ticket_ancho: '80', activo: true },
      ],
      operadores: [
        { id: 1, correo: 'demo@local', nombre: 'Super administrador', rol: 'super_admin',
          comercio_id: 1, activo: true },
      ],
    };
  };


  /* Genera ~4 meses de actividad para que las gráficas tengan qué mostrar.
     Determinista: la misma semilla produce siempre el mismo historial. */
  function generarMovimientos(ahora) {
    let sem = 20260814;
    const azar = () => { sem = (sem * 1103515245 + 12345) % 2147483648; return sem / 2147483648; };

    const perfiles = [
      // La compra cubre el consumo esperado del ciclo con un margen corto,
      // para que algunos productos caigan bajo el mínimo y las alertas tengan
      // algo real que mostrar.
      { id:1, salidaMedia:14, compra:210,  cadaCompra:21, unidadesIniciales:160 },
      { id:2, salidaMedia:9,  compra:142,  cadaCompra:24, unidadesIniciales:110 },
      { id:3, salidaMedia:3,  compra:62,   cadaCompra:30, unidadesIniciales:45  },
      { id:4, salidaMedia:22, compra:270,  cadaCompra:18, unidadesIniciales:210 },
      { id:5, salidaMedia:95, compra:1300, cadaCompra:20, unidadesIniciales:900 },
      { id:6, salidaMedia:11, compra:181,  cadaCompra:26, unidadesIniciales:120 },
    ];
    const costos = { 1:8.50, 2:12.00, 3:22.00, 4:3.20, 5:1.10, 6:2.40 };
    const DIAS = 120;
    /* Sitúa el movimiento en la hora h del día d, sin pasarse nunca del
       momento actual: un movimiento con fecha futura desordena el kardex. */
    const fechaDe = (d, h) => {
      const base = new Date(ahora - d * 86400000);
      base.setHours(h, Math.floor(azar() * 60), 0, 0);
      return new Date(Math.min(base.getTime(), ahora - 60000)).toISOString();
    };

    const movs = [];
    let id = 1;
    const saldo = {};

    // Carga inicial
    perfiles.forEach(p => {
      saldo[p.id] = p.unidadesIniciales;
      movs.push({ id: id++, comercio_id: 1, producto_id: p.id, tipo: 'entrada', cantidad: p.unidadesIniciales,
        costo_unitario: costos[p.id], motivo: 'Existencia inicial', referencia: 'INV-000',
        es_negativo: false, fecha: fechaDe(DIAS, 8) });
    });

    for (let d = DIAS - 1; d >= 0; d--) {
      const diaSemana = new Date(ahora - d * 86400000).getDay();
      const factor = diaSemana === 0 ? 0.15 : diaSemana === 6 ? 0.6 : 1;

      perfiles.forEach(p => {
        // Reposición periódica
        if (d % p.cadaCompra === 0 && d !== 0) {
          saldo[p.id] += p.compra;
          movs.push({ id: id++, comercio_id: 1, producto_id: p.id, tipo: 'entrada', cantidad: p.compra,
            costo_unitario: Number((costos[p.id] * (0.95 + azar() * 0.12)).toFixed(2)),
            motivo: 'Compra', referencia: 'F-' + (1000 + d), es_negativo: false,
            fecha: fechaDe(d, 9) });
        }

        // Despachos del día
        if (azar() < 0.72 * factor) {
          const q = Math.max(1, Math.round(p.salidaMedia * factor * (0.5 + azar())));
          if (saldo[p.id] - q >= 0) {
            saldo[p.id] -= q;
            movs.push({ id: id++, comercio_id: 1, producto_id: p.id, tipo: 'salida', cantidad: q,
              costo_unitario: null, motivo: 'Venta', referencia: 'P-' + (2000 + d * 3 + p.id),
              es_negativo: false, fecha: fechaDe(d, 11 + Math.floor(azar() * 7)) });
          }
        }

        // Ajuste ocasional por conteo o merma
        if (azar() < 0.012) {
          const q = Math.max(1, Math.round(p.salidaMedia * 0.3));
          if (saldo[p.id] - q >= 0) {
            saldo[p.id] -= q;
            movs.push({ id: id++, comercio_id: 1, producto_id: p.id, tipo: 'ajuste', cantidad: q,
              costo_unitario: null, motivo: azar() < 0.5 ? 'Conteo físico' : 'Merma',
              referencia: null, es_negativo: true, fecha: fechaDe(d, 17) });
          }
        }
      });
    }
    return movs;
  }

  let bd = cargar();

  function cargar() {
    try {
      const guardado = localStorage.getItem(CLAVE);
      if (!guardado) return semilla();

      const datos = JSON.parse(guardado);
      const base = semilla();

      /* Migración: un navegador que guardó datos con una versión anterior no
         tiene las colecciones añadidas después. Se completan sin tocar lo que
         el usuario ya había registrado. */
      Object.keys(base).forEach(clave => {
        if (!Array.isArray(datos[clave])) datos[clave] = base[clave];
      });

      /* Antes no había varios comercios: lo que estuviera guardado pasa a
         pertenecer al primero. */
      const primero = datos.comercios[0] ? datos.comercios[0].id : 1;
      ['categorias','productos','movimientos','clientes','ventas'].forEach(t => {
        datos[t].forEach(f => { if (f.comercio_id === undefined) f.comercio_id = primero; });
      });
      datos.operadores.forEach(o => { if (!o.comercio_id) o.comercio_id = primero; });

      return datos;
    } catch (e) {
      // file:// puede bloquear localStorage, o el contenido puede estar corrupto
      return semilla();
    }
  }

  let avisadoCupo = false;
  /* Cuando otro adaptador (Drive) toma prestada esta lógica, el guardado
     se delega en él y localStorage deja de intervenir. */
  let guardarExterno = null;

  function persistir() {
    if (guardarExterno) return guardarExterno();
    try {
      localStorage.setItem(CLAVE, JSON.stringify(bd));
    } catch (e) {
      /* Cupo lleno (las imágenes ocupan) o localStorage bloqueado bajo file://.
         La sesión sigue funcionando en memoria; se avisa una sola vez. */
      if (!avisadoCupo && INV.ui) {
        avisadoCupo = true;
        INV.ui.avisar('El navegador no pudo guardar más datos de ejemplo; la sesión sigue en memoria', 'error');
      }
    }
  }

  const redondearDemo = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

  /* Comercio en el que trabaja el operador de la sesión. Es el espejo de
     comercio_actual() del esquema: todo lo que se lee y escribe cuelga de
     aquí, y por eso los datos de dos comercios no se cruzan. */
  let operadorActivo = null;

  const operador = () => operadorActivo ||
    bd.operadores.find(o => o.activo) || null;

  const cId = () => { const o = operador(); return o ? o.comercio_id : null; };

  const delComercio = fila => fila.comercio_id === cId();

  const dormir = ms => new Promise(r => setTimeout(r, ms));
  const siguienteId = lista => lista.reduce((m, x) => Math.max(m, x.id), 0) + 1;

  /* Equivale a la función cantidad_signada() del esquema. */
  const signada = m =>
    m.tipo === 'entrada' ? Number(m.cantidad)
    : m.tipo === 'salida' ? -Number(m.cantidad)
    : m.es_negativo ? -Number(m.cantidad) : Number(m.cantidad);

  const saldoDe = productoId => bd.movimientos
    .filter(m => m.producto_id === productoId)
    .reduce((s, m) => s + signada(m), 0);

  /* Equivale a la vista stock_actual. */
  function filaStock(p) {
    const stock = saldoDe(p.id);
    const cat = bd.categorias.find(c => c.id === p.categoria_id);
    const movs = bd.movimientos.filter(m => m.producto_id === p.id);
    return {
      producto_id: p.id, sku: p.sku, nombre: p.nombre, unidad: p.unidad,
      categoria_id: p.categoria_id, categoria: cat ? cat.nombre : null,
      stock_minimo: p.stock_minimo, costo: p.costo, precio_venta: p.precio_venta,
      imagen_path: p.imagen_path || null,
      stock, valor_inventario: stock * p.costo,
      ultimo_movimiento: movs.length ? movs.map(m => m.fecha).sort().at(-1) : null,
    };
  }

  /* Equivale a la vista kardex, con saldo corriente por producto. */
  function filasKardex() {
    const porProducto = {};
    return bd.movimientos.filter(m => {
        const p = bd.productos.find(x => x.id === m.producto_id);
        return p && p.comercio_id === cId();
      })
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || a.id - b.id)
      .map(m => {
        const p = bd.productos.find(x => x.id === m.producto_id);
        porProducto[m.producto_id] = (porProducto[m.producto_id] || 0) + signada(m);
        return {
          id: m.id, producto_id: m.producto_id, sku: p.sku, nombre: p.nombre,
          fecha: m.fecha, tipo: m.tipo, motivo: m.motivo, referencia: m.referencia,
          cantidad: signada(m), saldo: porProducto[m.producto_id],
          costo_unitario: m.costo_unitario, nota: m.nota ?? null,
        };
      });
  }

  /* Equivale a las columnas calculadas de la vista ventas_detalle. */
  function conCalculados(c) {
    return {
      ...c,
      cliente: (c.nombres + ' ' + c.apellidos).trim(),
      documento_completo: c.tipo_documento + '-' + c.documento,
    };
  }

  /* Campos que la vista ventas_detalle saca del join con anulaciones. */
  function anulacionDe(ventaId) {
    const a = bd.anulaciones.find(x => x.venta_id === ventaId);
    return {
      anulada: !!a,
      motivo_anulacion: a ? a.motivo : null,
      detalle_anulacion: a ? a.detalle : null,
      anulada_en: a ? a.anulada_en : null,
      anulada_por_correo: a ? a.correo : null,
    };
  }

  function ventaCompleta(v) {
    const c = v.cliente_id ? bd.clientes.find(x => x.id === v.cliente_id) : null;
    return {
      ...v,
      cliente: c ? (c.nombres + ' ' + c.apellidos).trim() : 'Consumidor final',
      documento_completo: c ? c.tipo_documento + '-' + c.documento : null,
      telefono: c ? c.telefono : null,
      direccion: c ? c.direccion : null,
      renglones: bd.venta_items.filter(i => i.venta_id === v.id).length,
      ...anulacionDe(v.id),
      pagado: bd.venta_pagos.filter(i => i.venta_id === v.id)
        .reduce((s, p) => s + Number(p.monto_local), 0),
      saldo_pendiente: Number(v.total) - bd.venta_pagos.filter(i => i.venta_id === v.id)
        .reduce((s, p) => s + Number(p.monto_local), 0),
    };
  }

  /* Base recién creada: sin catálogo ni movimientos, pero con la fila del
     comercio y un administrador, que son imprescindibles para operar. */
  function estructuraVacia() {
    return {
      categorias: [], productos: [], movimientos: [],
      clientes: [], ventas: [], venta_items: [], venta_pagos: [], cuotas: [], anulaciones: [],
      cajas: [], conflictos: [], tasas: [],
      comercios: [{
        id: 1, nombre: 'Mi Comercio', rif: '', direccion: '', telefono: '',
        correo: '', mensaje: '¡Gracias por su compra!',
        iva_tasa: 16, moneda: 'Bs', tasa_usd: 0, tasa_eur: 0, ticket_ancho: '80', activo: true,
      }],
      operadores: [{ id: 1, correo: 'admin', nombre: 'Super administrador',
                     rol: 'super_admin', comercio_id: 1, activo: true }],
    };
  }

  INV.adaptadorDemo = {
    etiqueta: 'demo',

    sesion: {
      actual: async () => {
        try { return localStorage.getItem(CLAVE + '-sesion')
          ? { user: { email: 'demo@local' } } : null; } catch (e) { return null; }
      },
      entrar: async () => {
        await dormir(200);
        try { localStorage.setItem(CLAVE + '-sesion', '1'); } catch (e) {}
        return { session: { user: { email: 'demo@local' } } };
      },
      salir: async () => { try { localStorage.removeItem(CLAVE + '-sesion'); } catch (e) {} },
      alCambiar: () => {},
    },

    categorias: {
      listar: async () => bd.categorias.filter(delComercio)
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
      crear: async nombre => {
        const c = { id: siguienteId(bd.categorias), comercio_id: cId(), nombre };
        bd.categorias.push(c); persistir(); return c;
      },
    },

    productos: {
      listar: async ({ busqueda = '', soloActivos = true } = {}) => {
        let filas = bd.productos.filter(delComercio).map(p => ({
          ...p, categorias: p.categoria_id
            ? { nombre: (bd.categorias.find(c => c.id === p.categoria_id) || {}).nombre } : null,
        }));
        if (soloActivos) filas = filas.filter(p => p.activo);
        if (busqueda) {
          const t = busqueda.toLowerCase();
          filas = filas.filter(p => p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t));
        }
        return filas.sort((a, b) => a.nombre.localeCompare(b.nombre));
      },
      crear: async datos => {
        // El SKU es único dentro del comercio, no en toda la base
        if (bd.productos.some(p => p.comercio_id === cId() && p.sku === datos.sku))
          throw new Error('duplicate key: ya existe un producto con ese SKU');
        const p = { id: siguienteId(bd.productos), comercio_id: cId(), activo: true, ...datos };
        bd.productos.push(p); persistir(); return p;
      },
      actualizar: async (id, datos) => {
        const p = bd.productos.find(x => x.id === id);
        Object.assign(p, datos); persistir(); return p;
      },
      desactivar: async id => {
        // Espejo del trigger validar_baja_producto() del esquema.
        if (INV.permisos && !INV.permisos.puede('productos.eliminar'))
          throw new Error('Tu rol no permite dar de baja productos');
        bd.productos.find(x => x.id === id).activo = false; persistir();
      },
    },

    stock: {
      actual: async () => bd.productos.filter(p => p.activo && delComercio(p)).map(filaStock)
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
      alertas: async () => bd.productos.filter(p => p.activo && delComercio(p)).map(filaStock)
        .filter(f => f.stock <= f.stock_minimo)
        .sort((a, b) => a.stock - b.stock),
    },

    movimientos: {
      listar: async ({ productoId = null, desde = null, hasta = null, limite = 200 } = {}) => {
        let filas = filasKardex();
        if (productoId) filas = filas.filter(f => f.producto_id === productoId);
        if (desde) filas = filas.filter(f => f.fecha >= desde);
        if (hasta) filas = filas.filter(f => f.fecha <= hasta);
        return filas.reverse().slice(0, limite);
      },
      registrar: async datos => {
        // Replica el trigger validar_stock() del esquema.
        const resta = datos.tipo === 'salida' || (datos.tipo === 'ajuste' && datos.es_negativo);
        if (resta) {
          const saldo = saldoDe(datos.producto_id);
          if (saldo - Number(datos.cantidad) < 0)
            throw new Error(`Stock insuficiente: disponible ${saldo}, solicitado ${datos.cantidad}`);
        }
        const m = { id: siguienteId(bd.movimientos), comercio_id: cId(),
                    fecha: new Date().toISOString(), ...datos };
        bd.movimientos.push(m); persistir(); return m;
      },
    },

    clientes: {
      listar: async ({ busqueda = '' } = {}) => {
        let filas = bd.clientes.filter(c => c.activo && delComercio(c));
        if (busqueda) {
          const t = busqueda.toLowerCase();
          filas = filas.filter(c =>
            (c.nombres + ' ' + c.apellidos).toLowerCase().includes(t) ||
            c.documento.includes(t));
        }
        return filas.map(conCalculados)
          .sort((a, b) => a.cliente.localeCompare(b.cliente));
      },
      obtener: async id => {
        const c = bd.clientes.find(x => x.id === Number(id) && delComercio(x));
        return c ? conCalculados(c) : null;
      },
      crear: async datos => {
        if (bd.clientes.some(c => c.comercio_id === cId()
              && c.tipo_documento === datos.tipo_documento && c.documento === datos.documento))
          throw new Error('duplicate key: ya existe un cliente con ese documento');
        const c = { id: siguienteId(bd.clientes), comercio_id: cId(), activo: true, ...datos };
        bd.clientes.push(c); persistir(); return conCalculados(c);
      },
      actualizar: async (id, datos) => {
        const c = bd.clientes.find(x => x.id === Number(id));
        Object.assign(c, datos); persistir(); return conCalculados(c);
      },
      desactivar: async id => {
        bd.clientes.find(x => x.id === Number(id)).activo = false; persistir();
      },
    },

    ventas: {
      listar: async ({ clienteId = null, desde = null, hasta = null, limite = 200 } = {}) => {
        let filas = bd.ventas.filter(delComercio).map(ventaCompleta);
        if (clienteId) filas = filas.filter(v => v.cliente_id === Number(clienteId));
        if (desde) filas = filas.filter(v => v.fecha >= desde);
        if (hasta) filas = filas.filter(v => v.fecha <= hasta);
        return filas.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, limite);
      },
      obtener: async id => {
        const v = bd.ventas.find(x => x.id === Number(id) && delComercio(x));
        if (!v) return null;
        return {
          ...ventaCompleta(v),
          items: bd.venta_items.filter(i => i.venta_id === v.id),
          pagos: bd.venta_pagos.filter(i => i.venta_id === v.id),
          cuotas: bd.cuotas.filter(i => i.venta_id === v.id).sort((a, b) => a.numero - b.numero),
        };
      },
      /* Réplica de anular_venta(): comprueba el rol, marca el comprobante
         y devuelve la mercancía al almacén con entradas en el kardex. */
      anular: async (id, motivo, detalle, correo) => {
        if (INV.permisos && !INV.permisos.puede('ventas.anular'))
          throw new Error('Solo un administrador puede anular ventas');

        const venta = bd.ventas.find(v => v.id === Number(id) && delComercio(v));
        if (!venta) throw new Error('La venta no existe');
        if (bd.anulaciones.some(a => a.venta_id === venta.id))
          throw new Error('El comprobante ' + venta.numero + ' ya está anulado');
        if (motivo === 'otro' && !String(detalle || '').trim())
          throw new Error('Indica el motivo de la anulación');

        bd.anulaciones.push({
          id: siguienteId(bd.anulaciones), venta_id: venta.id, motivo,
          detalle: (detalle || '').trim() || null,
          anulada_en: new Date().toISOString(), correo: correo || null,
        });

        bd.venta_items.filter(i => i.venta_id === venta.id).forEach(i => {
          bd.movimientos.push({
            id: siguienteId(bd.movimientos), producto_id: Number(i.producto_id),
            comercio_id: cId(), tipo: 'entrada', cantidad: Number(i.cantidad), costo_unitario: null,
            motivo: 'Anulación de venta', referencia: venta.numero,
            es_negativo: false, fecha: new Date().toISOString(),
          });
        });

        persistir();
        return { ...ventaCompleta(venta) };
      },

      /* Réplica de la función registrar_venta() del esquema: primero valida
         todo el stock, después escribe; así no queda una venta a medias. */
      crear: async datos => {
        for (const it of datos.items) {
          const saldo = saldoDe(Number(it.producto_id));
          if (saldo - Number(it.cantidad) < 0) {
            const p = bd.productos.find(x => x.id === Number(it.producto_id));
            throw new Error(`Stock insuficiente de ${p ? p.nombre : 'producto'}: disponible ${saldo}, solicitado ${it.cantidad}`);
          }
        }

        // Correlativo propio de cada comercio
        const correlativo = bd.ventas.filter(delComercio).reduce((m, v) =>
          Math.max(m, Number(String(v.numero).replace('F-', '')) || 0), 0) + 1;
        const numero = 'F-' + String(correlativo).padStart(6, '0');

        const venta = {
          id: siguienteId(bd.ventas), comercio_id: cId(), numero,
          recargo_credito: Number(datos.recargo_credito || 0),
          cliente_id: datos.cliente_id ? Number(datos.cliente_id) : null,
          fecha: new Date().toISOString(),
          iva_tasa: Number(datos.iva_tasa), iva_incluido: !!datos.iva_incluido,
          tasa_referencia: Number(datos.tasa_referencia || 0),
          total_usd: Number(datos.total_usd || 0),
          a_credito: !!datos.a_credito,
          subtotal: Number(datos.subtotal), iva_monto: Number(datos.iva_monto),
          total: Number(datos.total), nota: datos.nota || null,
        };
        bd.ventas.push(venta);

        datos.items.forEach(it => {
          bd.venta_items.push({ id: siguienteId(bd.venta_items), venta_id: venta.id, ...it });
          bd.movimientos.push({
            id: siguienteId(bd.movimientos), producto_id: Number(it.producto_id),
            comercio_id: cId(), tipo: 'salida', cantidad: Number(it.cantidad), costo_unitario: null,
            motivo: 'Venta', referencia: numero, es_negativo: false,
            fecha: venta.fecha,
          });
        });

        (datos.pagos || []).forEach(pg => {
          bd.venta_pagos.push({ id: siguienteId(bd.venta_pagos), venta_id: venta.id, ...pg });
        });

        (datos.cuotas || []).forEach(q => {
          bd.cuotas.push({
            id: siguienteId(bd.cuotas), venta_id: venta.id,
            numero: Number(q.numero), monto_usd: Number(q.monto_usd),
            tasa_referencia: Number(q.tasa_referencia), vence_en: q.vence_en,
            pagada: false, pagada_en: null, monto_pagado: null, tasa_pago: null,
          });
        });

        persistir();
        return {
          ...ventaCompleta(venta),
          items: bd.venta_items.filter(i => i.venta_id === venta.id),
          pagos: bd.venta_pagos.filter(i => i.venta_id === venta.id),
          cuotas: bd.cuotas.filter(i => i.venta_id === venta.id),
        };
      },
    },

    cuotas: {
      /* Réplica de la vista cuotas_pendientes: lo que falta por cobrar,
         con el cliente y el comprobante resueltos. */
      pendientes: async () => {
        const anuladas = new Set(bd.anulaciones.map(a => a.venta_id));
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

        const misVentas = new Set(bd.ventas.filter(delComercio).map(v => v.id));
        return bd.cuotas
          .filter(q => !q.pagada && !anuladas.has(q.venta_id) && misVentas.has(q.venta_id))
          .map(q => {
            const v = bd.ventas.find(x => x.id === q.venta_id) || {};
            const c = v.cliente_id ? bd.clientes.find(x => x.id === v.cliente_id) : null;
            const delaVenta = bd.cuotas.filter(x => x.venta_id === q.venta_id);
            return {
              ...q,
              comprobante: v.numero, fecha_venta: v.fecha, total_venta_usd: v.total_usd,
              cliente_id: c ? c.id : null,
              cliente: c ? (c.nombres + ' ' + c.apellidos).trim() : 'Consumidor final',
              documento: c ? c.tipo_documento + '-' + c.documento : null,
              telefono: c ? c.telefono : null,
              direccion: c ? c.direccion : null,
              dias_vencida: Math.round((hoy - new Date(q.vence_en + 'T00:00:00')) / 86400000),
              cuotas_pendientes: delaVenta.filter(x => !x.pagada).length,
              cuotas_totales: delaVenta.length,
            };
          })
          .sort((a, b) => a.vence_en.localeCompare(b.vence_en));
      },

      /* Réplica de pagar_cuota(): el monto de la cuota es el mínimo del
         vencimiento. Se admite abonar de más y el excedente adelanta las
         cuotas siguientes, cancelando las que queden cubiertas. */
      pagar: async (id, metodo, monto, tasa = 1, referencia = null) => {
        if (INV.permisos && !INV.permisos.puede('ventas.emitir'))
          throw new Error('Tu rol no permite registrar cobros');

        const q = bd.cuotas.find(x => x.id === Number(id));
        if (!q) throw new Error('La cuota no existe');
        if (q.pagada) throw new Error('Esa cuota ya está pagada');

        const t = Number(tasa || 1);
        const abonoUsd = Number(monto) / t;
        if (abonoUsd + 0.005 < Number(q.monto_usd))
          throw new Error(`El mínimo de esta cuota es ${Number(q.monto_usd).toFixed(2)} USD`);

        const ahora = new Date().toISOString();
        q.pagada = true;
        q.pagada_en = ahora;
        q.monto_pagado = redondearDemo(Number(q.monto_usd) * t);
        q.tasa_pago = t;

        // El excedente adelanta las cuotas siguientes, en orden
        let sobra = redondearDemo(abonoUsd - Number(q.monto_usd));
        const siguientes = bd.cuotas
          .filter(x => x.venta_id === q.venta_id && !x.pagada)
          .sort((a, b) => a.numero - b.numero);

        const adelantadas = [];
        for (const s of siguientes) {
          if (sobra <= 0.005) break;
          if (sobra + 0.005 >= Number(s.monto_usd)) {
            sobra = redondearDemo(sobra - Number(s.monto_usd));
            s.pagada = true;
            s.pagada_en = ahora;
            s.monto_pagado = redondearDemo(Number(s.monto_usd) * t);
            s.tasa_pago = t;
            s.adelantada = true;
            adelantadas.push(s.numero);
          } else {
            // Abono parcial: rebaja el mínimo que queda de esa cuota
            s.monto_usd = redondearDemo(Number(s.monto_usd) - sobra);
            sobra = 0;
          }
        }

        bd.venta_pagos.push({
          id: siguienteId(bd.venta_pagos), venta_id: q.venta_id, metodo,
          referencia: referencia || null,
          detalle: 'Cuota ' + q.numero + (adelantadas.length ? ' y ' + adelantadas.join(', ') : ''),
          moneda: 'VES', monto: Number(monto), tasa: t, monto_local: Number(monto),
        });

        persistir();
        return { ...q, adelantadas };
      },
    },

    comercio: {
      /* El comercio en el que se está trabajando: espejo de la vista
         mi_comercio del esquema. */
      obtener: async () => {
        const c = bd.comercios.find(x => x.id === cId());
        return c ? { ...c } : null;
      },
      guardar: async datos => {
        const c = bd.comercios.find(x => x.id === cId());
        Object.assign(c, datos);
        persistir();
        return { ...c };
      },
    },

    comercios: {
      listar: async () => {
        const rol = INV.permisos ? INV.permisos.rol() : 'super_admin';
        const todos = rol === 'super_admin'
          ? bd.comercios
          : bd.comercios.filter(c => c.id === cId());
        return todos.map(c => ({
          ...c,
          operadores: bd.operadores.filter(o => o.comercio_id === c.id).length,
          productos: bd.productos.filter(p => p.comercio_id === c.id && p.activo).length,
          ventas: bd.ventas.filter(v => v.comercio_id === c.id).length,
        })).sort((a, b) => a.nombre.localeCompare(b.nombre));
      },

      crear: async datos => {
        if (INV.permisos && !INV.permisos.puede('comercios.gestionar'))
          throw new Error('Solo el super administrador puede crear comercios');
        const c = {
          id: siguienteId(bd.comercios), activo: true,
          nombre: 'Comercio sin nombre', rif: '', direccion: '', telefono: '', correo: '',
          mensaje: '¡Gracias por su compra!', iva_tasa: 16, moneda: 'Bs',
          tasa_usd: 0, tasa_eur: 0, ticket_ancho: '80', ...datos,
        };
        bd.comercios.push(c); persistir(); return c;
      },

      actualizar: async (id, datos) => {
        const c = bd.comercios.find(x => x.id === Number(id));
        Object.assign(c, datos); persistir(); return c;
      },

      eliminar: async id => {
        if (INV.permisos && !INV.permisos.puede('comercios.gestionar'))
          throw new Error('Solo el super administrador puede eliminar comercios');
        const n = Number(id);
        if (bd.comercios.length <= 1)
          throw new Error('Es el único comercio: no se puede eliminar');
        if (bd.operadores.some(o => o.comercio_id === n))
          throw new Error('Todavía hay operadores asignados a ese comercio');

        // Se lleva consigo todos sus datos, igual que el on delete cascade
        [['ventas','comercio_id'],['clientes','comercio_id'],
         ['movimientos','comercio_id'],['productos','comercio_id'],
         ['categorias','comercio_id']].forEach(([tabla]) => {
          bd[tabla] = bd[tabla].filter(f => f.comercio_id !== n);
        });
        const ventasFuera = new Set(bd.ventas.map(v => v.id));
        ['venta_items','venta_pagos','cuotas','anulaciones'].forEach(t => {
          bd[t] = bd[t].filter(f => ventasFuera.has(f.venta_id));
        });
        bd.comercios = bd.comercios.filter(c => c.id !== n);
        persistir();
      },

      /* El super administrador cambia el comercio sobre el que trabaja. */
      /* Réplica de crear_mi_comercio(): crea el comercio y se lo asigna
         a quien lo pide, para que un administrador recién dado de alta
         pueda empezar sin depender de nadie. */
      crearMio: async datos => {
        const o = operador();
        if (!o) throw new Error('Tu cuenta no está registrada como operador');
        if (!['super_admin', 'administrador'].includes(o.rol))
          throw new Error('Tu rol no permite crear comercios');
        if (o.rol === 'administrador' && o.comercio_id)
          throw new Error('Ya tienes un comercio asignado');

        const c = {
          id: siguienteId(bd.comercios), activo: true,
          nombre: 'Mi Comercio', rif: '', direccion: '', telefono: '', correo: '',
          mensaje: '¡Gracias por su compra!', iva_tasa: 16, moneda: 'Bs',
          tasa_usd: 0, tasa_eur: 0, ticket_ancho: '80', ...datos,
        };
        bd.comercios.push(c);
        o.comercio_id = c.id;
        persistir();
        return c;
      },

      /* null significa salir de todos: el super administrador supervisa
         sin estar dentro de ninguno. */
      cambiar: async id => {
        if (INV.permisos && !INV.permisos.puede('comercios.gestionar'))
          throw new Error('Solo el super administrador puede cambiar de comercio');
        const o = operador();
        o.comercio_id = (id === null || id === '' || id === undefined) ? null : Number(id);
        persistir();
        return o;
      },
    },

    operadores: {
      listar: async () => {
        const rol = INV.permisos ? INV.permisos.rol() : 'super_admin';
        const filas = rol === 'super_admin'
          ? bd.operadores
          : bd.operadores.filter(o => o.comercio_id === cId());
        return filas.map(o => ({
          ...o,
          comercio: (bd.comercios.find(c => c.id === o.comercio_id) || {}).nombre || null,
        })).sort((a, b) => a.nombre.localeCompare(b.nombre));
      },

      crear: async datos => {
        const rol = INV.permisos ? INV.permisos.rol() : 'super_admin';
        if (datos.rol === 'super_admin' && rol !== 'super_admin')
          throw new Error('Solo un super administrador puede nombrar otro');
        if (bd.operadores.some(o => o.correo.toLowerCase() === String(datos.correo).toLowerCase()))
          throw new Error('duplicate key: ya hay un operador con ese correo');
        const o = {
          id: siguienteId(bd.operadores), activo: true,
          comercio_id: cId(), ...datos,
        };
        // El super administrador puede quedarse sin comercio: supervisa todos
        if (!o.comercio_id && o.rol !== 'super_admin')
          throw new Error('Asigna un comercio al operador');
        bd.operadores.push(o); persistir(); return o;
      },

      actualizar: async (id, datos) => {
        const rol = INV.permisos ? INV.permisos.rol() : 'super_admin';
        const o = bd.operadores.find(x => x.id === Number(id));
        if (!o) throw new Error('El operador no existe');
        // Un super administrador solo lo toca otro super administrador
        if ((o.rol === 'super_admin' || datos.rol === 'super_admin') && rol !== 'super_admin')
          throw new Error('No puedes modificar a un super administrador');
        Object.assign(o, datos); persistir(); return o;
      },

      eliminar: async id => {
        const rol = INV.permisos ? INV.permisos.rol() : 'super_admin';
        const o = bd.operadores.find(x => x.id === Number(id));
        if (!o) return;
        if (o.rol === 'super_admin' && rol !== 'super_admin')
          throw new Error('No puedes eliminar a un super administrador');
        bd.operadores = bd.operadores.filter(x => x.id !== Number(id));
        persistir();
      },

      /* Al entrar: qué operador es y en qué comercio trabaja. */
      rolDe: async correo => {
        const o = bd.operadores.find(x =>
          x.activo && x.correo.toLowerCase() === String(correo).toLowerCase());
        operadorActivo = o || null;
        return o ? o.rol : null;
      },
    },

    tasas: {
      vigente: async (moneda = 'USD') => {
        const filas = bd.tasas.filter(t => t.moneda === moneda)
          .sort((a, b) => b.fecha.localeCompare(a.fecha));
        return filas[0] || null;
      },
      historico: async (moneda = 'USD', limite = 30) => bd.tasas
        .filter(t => t.moneda === moneda)
        .sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, limite),
      fijar: async (fecha, tasa, moneda = 'USD') => {
        const existente = bd.tasas.find(t => t.moneda === moneda && t.fecha === fecha);
        if (existente) {
          Object.assign(existente, { tasa: Number(tasa), fuente: 'manual',
                                     obtenida_en: new Date().toISOString() });
          persistir(); return existente;
        }
        const t = {
          id: siguienteId(bd.tasas), moneda, fecha, tasa: Number(tasa),
          fuente: 'manual', obtenida_en: new Date().toISOString(),
        };
        bd.tasas.push(t); persistir(); return t;
      },
    },

    cajas: {
      listar: async () => bd.cajas.filter(c => delComercio(c) && c.activa)
        .sort((a, b) => a.bloque - b.bloque),
      crear: async datos => {
        if (bd.cajas.some(c => c.comercio_id === cId() && c.bloque === Number(datos.bloque)))
          throw new Error('Ya hay una caja con ese bloque');
        const c = { id: siguienteId(bd.cajas), comercio_id: cId(), activa: true, ...datos };
        bd.cajas.push(c); persistir(); return c;
      },
      actualizar: async (id, datos) => {
        const c = bd.cajas.find(x => x.id === Number(id));
        Object.assign(c, datos); persistir(); return c;
      },
    },

    conflictos: {
      listar: async () => bd.conflictos
        .filter(c => c.comercio_id === cId() && !c.resuelto)
        .sort((a, b) => a.creado_en.localeCompare(b.creado_en)),
      registrar: async datos => {
        const existente = bd.conflictos.find(c =>
          c.comercio_id === cId() && c.clave_idem === datos.clave_idem);
        if (existente) { existente.motivo = datos.motivo; persistir(); return existente.id; }
        const c = {
          id: siguienteId(bd.conflictos), comercio_id: cId(), resuelto: false,
          creado_en: new Date().toISOString(), ...datos,
        };
        bd.conflictos.push(c); persistir(); return c.id;
      },
      resolver: async (id, nota) => {
        const c = bd.conflictos.find(x => x.id === Number(id));
        if (c) {
          c.resuelto = true;
          c.resuelto_en = new Date().toISOString();
          c.nota_resolucion = nota || null;
          persistir();
        }
      },
    },

    /* En modo demo no hay servidor de autenticación: se registra que el
       operador tiene clave asignada, pero la clave no se guarda. Guardar
       contraseñas en el navegador sería una mala costumbre aunque esto
       sea un banco de pruebas. */
    cuentas: {
      conFuncion: () => false,
      capacidad: () => ({ crear: true, cambiar: true }),
      asignar: async correo => {
        const o = bd.operadores.find(x => x.correo.toLowerCase() === String(correo).toLowerCase());
        if (o) { o.tiene_clave = true; persistir(); }
        return { creada: true, requiereConfirmacion: false, simulado: true };
      },
      crear: async correo => {
        const o = bd.operadores.find(x => x.correo.toLowerCase() === String(correo).toLowerCase());
        if (o) { o.tiene_clave = true; persistir(); }
        return { creada: true, requiereConfirmacion: false, simulado: true };
      },
      cambiar: async correo => {
        const o = bd.operadores.find(x => x.correo.toLowerCase() === String(correo).toLowerCase());
        if (o) { o.tiene_clave = true; persistir(); }
        return { cambiada: true, simulado: true };
      },
    },

    archivos: {
      // En demo la miniatura ya viene como data URL desde el formulario.
      subir: async dataUrl => dataUrl,
      url: ruta => ruta || null,
    },

    reiniciar: () => {
      bd = semilla();
      persistir();
    },

    estructuraVacia,

    /* Presta toda esta lógica a otro almacenamiento: el estado pasa a ser
       el objeto que se entregue y el guardado, la función indicada. */
    usarEstado: (nuevo, guardar) => {
      bd = nuevo;
      guardarExterno = guardar || null;
    },
  };
})();
