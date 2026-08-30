/* =====================================================================
   Ventas — listado, elaboración del comprobante y su impresión.
   ---------------------------------------------------------------------
   Sobre el IVA: la tasa se aplica renglón por renglón, no al total, para
   que el desglose cuadre al céntimo con lo que ve el cliente. El
   interruptor decide si el precio de lista ya lo lleva dentro (se
   desglosa hacia atrás) o si se suma encima.
   ===================================================================== */
(function () {
  const { $, $$, esc, numero, cantidad, fecha, avisar, cargando, vacio,
          descargarCSV, abrirModal, cerrarModal } = INV.ui;

  const ivaPorDefecto = () => {
    const c = INV.comercio ? INV.comercio.actual() : {};
    return c.iva_tasa !== undefined && c.iva_tasa !== null ? Number(c.iva_tasa) : 16;
  };

  /* La del dólar sale de INV.tasas, que decide entre la oficial del BCV y
     la que el comercio haya fijado a mano. El euro sigue siendo manual:
     el BCV lo publica, pero aquí solo se automatizó el dólar. */
  const tasasPorDefecto = () => {
    const c = INV.comercio ? INV.comercio.actual() : {};
    return {
      // Oficial del BCV, luego la del comercio, y por último la de config
      USD: (INV.tasas ? INV.tasas.usd() : 0)
           || Number(c.tasa_usd || 0)
           || Number((INV.config.TASAS || {}).USD || 0),
      EUR: (INV.tasas ? INV.tasas.eur() : 0)
           || Number(c.tasa_eur || 0)
           || Number((INV.config.TASAS || {}).EUR || 0),
    };
  };

  /* Formas de pago. 'ref' pide los últimos 6 dígitos de la operación;
     'moneda' distinta de VES obliga a indicar la tasa del día. */
  const METODOS = [
    { id: 'debito',         etiqueta: 'Débito',                moneda: 'VES', ref: true },
    { id: 'efectivo_bs',    etiqueta: 'Efectivo Bs',           moneda: 'VES' },
    { id: 'efectivo_usd',   etiqueta: 'Efectivo USD',          moneda: 'USD' },
    { id: 'efectivo_eur',   etiqueta: 'Efectivo EUR',          moneda: 'EUR' },
    { id: 'pago_movil',     etiqueta: 'Pago móvil',            moneda: 'VES', ref: true },
    { id: 'transferencia',  etiqueta: 'Transferencia',         moneda: 'VES', ref: true },
    { id: 'retencion_iva',  etiqueta: 'Comprobante Ret. IVA',  moneda: 'VES', ref: true, retencion: true },
    { id: 'retencion_islr', etiqueta: 'Comprobante Ret. ISLR', moneda: 'VES', ref: true, retencion: true },
    { id: 'otro',           etiqueta: 'Otro',                  moneda: 'VES', detalle: true },
    { id: 'credito',        etiqueta: 'Crédito',               moneda: 'VES', credito: true },
  ];

  const FRECUENCIAS = [
    { id: '7',  etiqueta: 'Semanal',    dias: 7 },
    { id: '15', etiqueta: 'Quincenal',  dias: 15 },
    { id: '30', etiqueta: 'Mensual',    dias: 30 },
  ];

  /* Plan de cuotas en construcción: vive fuera de `pagos` porque no es
     dinero recibido, sino lo que queda por cobrar. */
  let plan = null;   // { inicial, cuotas: [{numero, monto_usd, vence_en}], tasa }

  const metodo = id => METODOS.find(m => m.id === id) || METODOS[1];

  /* Motivos de anulación. El texto es el que queda archivado, así que
     conviene que se entienda sin contexto meses después. */
  const MOTIVOS = [
    { id: 'error_facturacion', etiqueta: 'Error de facturación',
      ayuda: 'Se cargó mal el producto, la cantidad o el precio.' },
    { id: 'devolucion', etiqueta: 'Devolución del cliente',
      ayuda: 'La mercancía volvió al almacén.' },
    { id: 'pago_rechazado', etiqueta: 'Pago rechazado',
      ayuda: 'El cobro no se concretó.' },
    { id: 'no_entregado', etiqueta: 'No entregada',
      ayuda: 'La venta nunca llegó a despacharse.' },
    { id: 'duplicada', etiqueta: 'Comprobante duplicado',
      ayuda: 'La misma venta se emitió dos veces.' },
    { id: 'otro', etiqueta: 'Otro motivo',
      ayuda: 'Hay que escribir la explicación.' },
  ];

  const nombreMotivo = id => (MOTIVOS.find(m => m.id === id) || {}).etiqueta || id;

  const etiquetaPago = p => {
    const m = metodo(p.metodo);
    if (p.metodo === 'credito') return 'Crédito — inicial';
    if (p.metodo === 'otro' && p.detalle) return 'Otro: ' + p.detalle;
    if (p.metodo === 'retencion_iva') return 'Comprobante Ret. IVA' + (p.referencia ? ' N.° ' + p.referencia : '');
    if (p.metodo === 'retencion_islr') return 'Comprobante Ret. ISLR' + (p.referencia ? ' N.° ' + p.referencia : '');
    return m.etiqueta + (p.referencia ? ' ····' + p.referencia : '');
  };

  /* ---------------- Cálculo ----------------
     Una sola función para toda la aritmética: la usa el formulario
     mientras escribes y también lo que se guarda en la base. */
  function calcular(renglones, tasa, incluido, retIvaPct = 0, retIslrPct = 0) {
    const t = Number(tasa) / 100;

    const items = renglones.map(r => {
      const bruto = Number(r.cantidad) * Number(r.precio_unitario);

      /* Un producto exento no lleva impuesto, y tampoco se le desglosa
         nada cuando el precio "incluye IVA": si está exento, el precio de
         lista ya es la base, porque no hay impuesto dentro que sacar. */
      if (r.exento) {
        return { ...r, base: redondear(bruto), iva_monto: 0, total: redondear(bruto) };
      }

      const base = incluido ? bruto / (1 + t) : bruto;
      const iva  = incluido ? bruto - base : base * t;
      return {
        ...r,
        base:      redondear(base),
        iva_monto: redondear(iva),
        total:     redondear(base + iva),
      };
    });

    const gravados = items.filter(i => !i.exento);
    const exentos  = items.filter(i => i.exento);
    const base_gravada = redondear(gravados.reduce((s, i) => s + i.base, 0));
    const base_exenta  = redondear(exentos.reduce((s, i) => s + i.base, 0));
    const subtotal  = redondear(items.reduce((s, i) => s + i.base, 0));
    const iva_monto = redondear(items.reduce((s, i) => s + i.iva_monto, 0));
    const total     = redondear(items.reduce((s, i) => s + i.total, 0));

    const retencion_iva_monto = retIvaPct > 0 ? redondear(iva_monto * (Number(retIvaPct) / 100)) : 0;
    const retencion_islr_monto = retIslrPct > 0 ? redondear(base_gravada * (Number(retIslrPct) / 100)) : 0;
    const monto_neto_cobrar = redondear(total - retencion_iva_monto - retencion_islr_monto);

    return {
      items,
      // Base sobre la que se calcula el impuesto
      base_gravada,
      // Lo que no paga impuesto: en Venezuela va separado en la factura
      base_exenta,
      hay_exentos:  exentos.length > 0,
      subtotal,
      iva_monto,
      total,
      retencion_iva_porcentaje: Number(retIvaPct || 0),
      retencion_iva_monto,
      retencion_islr_porcentaje: Number(retIslrPct || 0),
      retencion_islr_monto,
      monto_neto_cobrar,
      hay_retencion: (retencion_iva_monto > 0 || retencion_islr_monto > 0),
    };
  }

  const redondear = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

  /* ---------------- Contenido del QR ----------------
     Servido por http apunta al comprobante, para que al escanear se abra
     la venta. Abierto como archivo local no hay URL que compartir, así
     que el QR lleva el resumen legible de la venta. */
  function contenidoQR(v) {
    if (location.protocol !== 'file:') {
      return location.origin + location.pathname + '#/venta/' + v.id;
    }
    return [
      'VENTA ' + v.numero,
      v.cliente,
      v.documento_completo || 's/d',
      new Date(v.fecha).toLocaleDateString('es'),
      'Base ' + numero(v.subtotal),
      'IVA ' + numero(v.iva_monto),
      'TOTAL ' + numero(v.total),
    ].join(' | ');
  }

  /* ================= LISTADO ================= */

  INV.vistas = INV.vistas || {};
  INV.vistas.ventas = {
    titulo: param => param === 'nueva' ? 'Nueva venta' : 'Ventas',
    eyebrow: param => param === 'nueva' ? 'Elaborar comprobante' : 'Facturación',

    acciones: param => param === 'nueva' ? [
      { texto: 'Cancelar', estilo: 'btn--secundario', alPulsar: () => { location.hash = '#/ventas'; } },
    ] : [
      { texto: 'Nueva venta', estilo: 'btn--primario', alPulsar: () => { location.hash = '#/ventas/nueva'; } },
      { texto: 'Exportar', estilo: 'btn--secundario', alPulsar: exportar },
    ],

    render: async (contenedor, param) => {
      if (param === 'nueva') return formularioVenta(contenedor);
      return listado(contenedor);
    },
  };

  let ventasEnPantalla = [];

  /* Exportación completa: todo lo que hace falta para conciliar, declarar
     o reclamar una venta sin tener que abrir la aplicación. Incluye la
     tasa con la que se emitió, porque sin ella los montos en bolívares no
     se pueden explicar meses después. */
  async function exportar() {
    if (!ventasEnPantalla.length) return avisar('No hay ventas que exportar', 'error');

    /* El listado no trae renglones ni cuotas: pedirlos para 300 ventas de
       una vez tumbaría la conexión, así que se piden por tandas. */
    const completas = await conDetalle(ventasEnPantalla);

    const METODOS = {
      debito: 'Débito', efectivo_bs: 'Efectivo Bs', efectivo_usd: 'Efectivo USD',
      efectivo_eur: 'Efectivo EUR', pago_movil: 'Pago móvil',
      transferencia: 'Transferencia', otro: 'Otro', credito: 'Crédito',
    };

    const pagosDe = v => v.pagos || [];
    const hora = f => new Date(f).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    const dosDec = n => Number(n || 0).toFixed(2);

    // Los renglones exentos son los que no llevaron impuesto
    const baseExenta = v => (v.items || [])
      .filter(i => Number(i.iva_monto) === 0)
      .reduce((s, i) => s + Number(i.base), 0);

    descargarCSV(`ventas-${new Date().toISOString().slice(0, 10)}.csv`, [
      { titulo: 'Comprobante', valor: v => v.numero },
      { titulo: 'Fecha',       valor: v => new Date(v.fecha).toLocaleDateString('es') },
      { titulo: 'Hora',        valor: v => hora(v.fecha) },
      { titulo: 'Estado',      valor: v => v.anulada ? 'ANULADA' : 'Vigente' },

      { titulo: 'Cliente',     valor: v => v.cliente || 'Consumidor final' },
      { titulo: 'Documento',   valor: v => v.documento_completo ?? '' },
      { titulo: 'Teléfono',    valor: v => v.telefono ?? '' },
      { titulo: 'Dirección',   valor: v => v.direccion ?? '' },

      { titulo: 'Vendedor',       valor: v => v.vendedor ?? '' },
      { titulo: 'Correo vendedor', valor: v => v.vendedor_correo ?? '' },

      { titulo: 'Renglones',   valor: v => v.renglones ?? '' },
      { titulo: 'Productos',   valor: v => (v.items || [])
          .map(i => `${i.descripcion} x${Number(i.cantidad)}`).join(' | ') },

      { titulo: 'Base imponible', valor: v => dosDec(Number(v.subtotal) - baseExenta(v)) },
      { titulo: 'Base exenta',    valor: v => dosDec(baseExenta(v)) },
      { titulo: 'Subtotal',       valor: v => dosDec(v.subtotal) },
      { titulo: 'IVA %',          valor: v => Number(v.iva_tasa) },
      { titulo: 'IVA',            valor: v => dosDec(v.iva_monto) },
      { titulo: 'IVA incluido en el precio', valor: v => v.iva_incluido ? 'Sí' : 'No' },
      { titulo: 'Total',          valor: v => dosDec(v.total) },
      { titulo: 'Retención IVA %', valor: v => Number(v.retencion_iva_porcentaje || 0) },
      { titulo: 'IVA Retenido',   valor: v => dosDec(v.retencion_iva_monto) },
      { titulo: 'Comp. Retención IVA', valor: v => v.comprobante_retencion_iva || (pagosDe(v).find(p => p.metodo === 'retencion_iva') || {}).referencia || '' },
      { titulo: 'Retención ISLR %', valor: v => Number(v.retencion_islr_porcentaje || 0) },
      { titulo: 'ISLR Retenido',  valor: v => dosDec(v.retencion_islr_monto) },
      { titulo: 'Comp. Retención ISLR', valor: v => v.comprobante_retencion_islr || (pagosDe(v).find(p => p.metodo === 'retencion_islr') || {}).referencia || '' },
      { titulo: 'Neto Cobrado',   valor: v => dosDec(v.monto_neto_cobrar || (Number(v.total) - Number(v.retencion_iva_monto || 0) - Number(v.retencion_islr_monto || 0))) },

      { titulo: 'Tasa Bs/USD',    valor: v => Number(v.tasa_referencia || 0).toFixed(4) },
      { titulo: 'Total USD',      valor: v => dosDec(v.total_usd) },

      { titulo: 'Formas de pago', valor: v => pagosDe(v)
          .map(p => METODOS[p.metodo] || p.metodo).join(' + ') },
      { titulo: 'Referencias',    valor: v => pagosDe(v)
          .filter(p => p.referencia).map(p => p.referencia).join(' ') },
      { titulo: 'Detalle de pagos', valor: v => pagosDe(v).map(p =>
          `${METODOS[p.metodo] || p.metodo}: ${dosDec(p.monto)} ${p.moneda}` +
          (p.moneda !== 'VES' ? ` @${Number(p.tasa).toFixed(2)} = ${dosDec(p.monto_local)}` : '')
        ).join(' | ') },
      { titulo: 'Pagado',         valor: v => dosDec(v.pagado) },
      { titulo: 'Saldo',          valor: v => dosDec(v.saldo_pendiente) },

      { titulo: 'A crédito',      valor: v => v.a_credito ? 'Sí' : 'No' },
      { titulo: 'Recargo crédito %', valor: v => Number(v.recargo_credito || 0) },
      { titulo: 'Cuotas',         valor: v => (v.cuotas || []).length || '' },
      { titulo: 'Cuotas por cobrar', valor: v => v.cuotas_por_cobrar ?? '' },
      { titulo: 'Por cobrar USD', valor: v => (v.cuotas || [])
          .filter(q => !q.pagada).reduce((s, q) => s + Number(q.monto_usd), 0).toFixed(2) },

      { titulo: 'Motivo anulación', valor: v => v.anulada ? nombreMotivo(v.motivo_anulacion) : '' },
      { titulo: 'Detalle anulación', valor: v => v.detalle_anulacion ?? '' },
      { titulo: 'Anulada por',      valor: v => v.anulada_por_correo ?? '' },
      { titulo: 'Anulada el',       valor: v => v.anulada_en
          ? new Date(v.anulada_en).toLocaleString('es') : '' },

      { titulo: 'Nota',           valor: v => v.nota ?? '' },
    ], completas);

    avisar(`${completas.length} ventas exportadas`);
  }

  /* Completa cada venta con sus renglones, pagos y cuotas, en tandas de
     veinte para no abrir trescientas peticiones a la vez. */
  async function conDetalle(ventas) {
    if (ventas.every(v => v.items && v.pagos)) return ventas;

    avisar(`Preparando ${ventas.length} ventas…`);
    const salida = [];
    const TANDA = 20;

    for (let i = 0; i < ventas.length; i += TANDA) {
      const tanda = await Promise.all(ventas.slice(i, i + TANDA).map(async v => {
        if (v.items && v.pagos) return v;
        try {
          const c = await INV.db.ventas.obtener(v.id);
          return c ? { ...v, ...c } : v;
        } catch (e) { return v; }
      }));
      salida.push(...tanda);
    }
    return salida;
  }

  async function listado(contenedor) {
    contenedor.innerHTML = cargando();
    const ventas = await INV.db.ventas.listar({ limite: 300 });
    ventasEnPantalla = ventas;

    if (!ventas.length) {
      contenedor.innerHTML = vacio('Todavía no hay ventas',
        'Elabora el primer comprobante: se descuenta del inventario y queda en el kardex.',
        '<a class="btn btn--primario" href="#/ventas/nueva">Nueva venta</a>');
      return;
    }

    const mes = new Date(); mes.setDate(1); mes.setHours(0,0,0,0);
    // Una venta anulada no cuenta como facturación ni como IVA por declarar.
    const vigentes = ventas.filter(v => !v.anulada);
    const anuladas = ventas.filter(v => v.anulada);
    const delMes = vigentes.filter(v => new Date(v.fecha) >= mes);
    const totalMes = delMes.reduce((s, v) => s + Number(v.total), 0);
    const ivaMes = delMes.reduce((s, v) => s + Number(v.iva_monto), 0);
    const baseMes = delMes.reduce((s, v) => s + Number(v.subtotal), 0);

    contenedor.innerHTML = `
      <div class="mosaico mosaico--auto" style="margin-bottom:14px">
        <div class="metrica metrica--violeta anim" style="--i:0">
          <div class="metrica__etiqueta">Ventas del mes</div>
          <div class="metrica__valor">${delMes.length}</div>
          <div class="metrica__pie">${vigentes.length} vigentes${anuladas.length ? ' · ' + anuladas.length + ' anuladas' : ''}</div>
        </div>
        <div class="metrica metrica--teal anim" style="--i:1">
          <div class="metrica__etiqueta">Base imponible</div>
          <div class="metrica__valor">${numero(baseMes)}</div>
          <div class="metrica__pie">del mes en curso</div>
        </div>
        <div class="metrica metrica--ambar anim" style="--i:2">
          <div class="metrica__etiqueta">IVA del mes</div>
          <div class="metrica__valor">${numero(ivaMes)}</div>
          <div class="metrica__pie">por declarar</div>
        </div>
        <div class="metrica metrica--cian anim" style="--i:3">
          <div class="metrica__etiqueta">Facturado</div>
          <div class="metrica__valor">${numero(totalMes)}</div>
          <div class="metrica__pie">del mes en curso</div>
        </div>
      </div>

      <div class="ficha anim" style="--i:4">
        <div class="ficha__cabecera">
          <div>
            <h3 class="ficha__titulo">Comprobantes emitidos</h3>
            <p class="ficha__nota">pulsa uno para verlo o imprimirlo</p>
          </div>
          <input class="buscador" type="search" id="ve-buscar" placeholder="Buscar por número o cliente">
        </div>
        <div class="lista lista--ven" id="ve-lista">${ventas.map(filaVenta).join('')}</div>
      </div>`;

    $('#ve-buscar').addEventListener('input', e => {
      const t = e.target.value.toLowerCase();
      const f = ventas.filter(v =>
        v.numero.toLowerCase().includes(t) || (v.cliente || '').toLowerCase().includes(t));
      $('#ve-lista').innerHTML = f.length ? f.map(filaVenta).join('')
        : '<div class="vacio"><h4>Sin resultados</h4><p>Ningún comprobante coincide.</p></div>';
      enlazarVentas();
    });

    enlazarVentas();
  }

  const filaVenta = (v, i) => `
    <div class="lista__item ${v.anulada ? 'apagado' : ''}" style="--i:${Math.min(i, 20)}"
         data-venta="${v.id}" role="button" tabindex="0">
      <span class="pastilla pastilla--${v.anulada ? 'salida' : 'entrada'}">${esc(v.numero)}</span>
      <span class="lista__nombre">${esc(v.cliente || 'Consumidor final')}
        ${v.a_credito ? `<span class="pastilla pastilla--credito">${
          Number(v.cuotas_por_cobrar) > 0
            ? `crédito · ${v.cuotas_por_cobrar} por cobrar`
            : 'crédito saldado'}</span>` : ''}
        <span class="lista__sub">${v.anulada ? 'ANULADA · ' : ''}${fecha(v.fecha)} · ${v.renglones} renglones${v.documento_completo ? ' · ' + esc(v.documento_completo) : ''}</span></span>
      <span class="lista__dato"><b>${numero(v.iva_monto)}</b><small>IVA</small></span>
      <span class="lista__dato"><b>${numero(v.total)}</b><small>total</small>
        ${(() => {
          const eq = INV.tasas ? INV.tasas.aDolares(v.total) : null;
          return eq === null ? '' : `<span class="equivalente">${numero(eq)} $</span>`;
        })()}</span>
    </div>`;

  function enlazarVentas() {
    $$('[data-venta]').forEach(el => {
      const ir = () => { location.hash = '#/venta/' + el.dataset.venta; };
      el.addEventListener('click', ir);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } });
    });
  }

  /* ================= ELABORAR VENTA ================= */

  let renglones = [];   // { producto_id, descripcion, cantidad, precio_unitario, stock, unidad }
  let pagos = [];       // { metodo, referencia, detalle, moneda, monto, tasa, monto_local }
  let catalogo = [];
  let clientes = [];

  async function formularioVenta(contenedor) {
    contenedor.innerHTML = cargando();
    renglones = [];
    pagos = [];
    plan = null;
    [catalogo, clientes] = await Promise.all([
      INV.db.stock.actual(),
      INV.db.clientes.listar(),
    ]);

    if (!catalogo.length) {
      contenedor.innerHTML = vacio('No hay productos con existencias',
        'Carga productos y registra entradas antes de vender.',
        '<a class="btn btn--primario" href="#/productos">Ir a productos</a>');
      return;
    }

    contenedor.innerHTML = `
      <div class="ficha anim" style="--i:0; margin-bottom:14px">
        <div class="ficha__cabecera">
          <h3 class="ficha__titulo">Cliente</h3>
          <button class="btn btn--secundario btn--chico" id="vn-nuevo-cliente">Registrar cliente</button>
        </div>
        <div class="ficha__cuerpo">
          <div class="campo" style="margin:0">
            <label for="vn-cliente">Seleccionar de la cartera</label>
            <select id="vn-cliente">
              <option value="">Consumidor final — sin datos fiscales</option>
              ${clientes.map(c => `<option value="${c.id}">${esc(c.cliente)} — ${esc(c.documento_completo)}</option>`).join('')}
            </select>
          </div>
          <div id="vn-datos-cliente" class="datos" style="margin-top:14px" hidden></div>
        </div>
      </div>

      <div class="ficha anim" style="--i:1; margin-bottom:14px">
        <div class="ficha__cabecera">
          <div>
            <h3 class="ficha__titulo">Productos</h3>
            <p class="ficha__nota">el precio se toma del catálogo y puede ajustarse por renglón</p>
          </div>
        </div>
        <div class="ficha__cuerpo" style="padding-bottom:14px">
          <div class="filtros">
            <label class="filtro" style="min-width:150px"><span>Buscar por código o nombre</span>
              <input type="search" id="vn-buscar-prod" placeholder="Escribe el código…"
                     autocomplete="off" style="max-width:200px"></label>
            <label class="filtro" style="flex:2; min-width:220px"><span>Producto</span>
              <select id="vn-producto">
                ${catalogo.map(p => {
                  const stockNum = Number(p.stock || 0);
                  const stockTxt = stockNum > 0 ? `Stock: ${cantidad(stockNum)} ${esc(p.unidad)}` : `⚠️ SIN STOCK (0 ${esc(p.unidad)})`;
                  const precioD = INV.tasas ? INV.tasas.dual(Number(p.precio_venta)).principal : `${numero(p.precio_venta)} Bs`;
                  return `<option value="${p.producto_id || p.id}" data-sku="${esc(p.sku)}">${esc(p.sku)} — ${esc(p.nombre)} · ${stockTxt} · ${precioD}</option>`;
                }).join('')}
              </select>
              <span class="subida__nota" id="vn-encontrados" style="margin-top:4px; display:block"></span></label>
            <label class="filtro"><span>Cantidad</span>
              <input type="number" id="vn-cantidad" min="1" step="1" value="1"></label>
            <button class="btn btn--primario" id="vn-agregar">Agregar</button>
          </div>
        </div>
        <div id="vn-renglones"></div>
      </div>

      <div class="ficha anim" style="--i:2">
        <div class="ficha__cabecera">
          <h3 class="ficha__titulo">Impuesto y totales</h3>
        </div>
        <div class="ficha__cuerpo" style="padding-bottom:14px">
          <div class="filtros">
            <label class="filtro"><span>IVA aplicado (%)</span>
              <input type="number" id="vn-iva" min="0" max="100" step="0.01" value="${ivaPorDefecto()}" style="max-width:120px"></label>
            <label class="filtro" style="justify-content:flex-end">
              <span>Modo del precio</span>
              <select id="vn-incluido">
                <option value="no">El IVA se suma al precio</option>
                <option value="si">El precio ya incluye IVA</option>
              </select></label>
            <label class="filtro" style="flex:1; min-width:200px"><span>Nota</span>
              <input type="text" id="vn-nota" placeholder="Opcional: condición de pago, orden…"></label>
          </div>
        </div>
        <div id="vn-totales"></div>
      </div>

      <div class="ficha anim" style="--i:3">
        <div class="ficha__cabecera">
          <div>
            <h3 class="ficha__titulo">Forma de pago</h3>
            <p class="ficha__nota">se pueden combinar varias en una misma venta</p>
          </div>
        </div>

        <div class="ficha__cuerpo" style="padding-bottom:14px">
          <div class="filtros">
            <label class="filtro" style="min-width:170px"><span>Método</span>
              <select id="pg-metodo">
                ${METODOS.map(m => `<option value="${m.id}">${esc(m.etiqueta)}</option>`).join('')}
              </select></label>
            <label class="filtro" id="pg-caja-ref" hidden><span>Referencia — últimos 6</span>
              <input type="text" id="pg-referencia" inputmode="numeric" maxlength="6"
                     placeholder="000000" style="max-width:120px"></label>
            <label class="filtro" id="pg-caja-detalle" hidden style="min-width:170px"><span>Especifique</span>
              <input type="text" id="pg-detalle" placeholder="Vale, canje, crédito…"></label>
            <label class="filtro" id="pg-caja-tasa" hidden><span>Tasa del día</span>
              <input type="number" id="pg-tasa" min="0" step="0.0001" style="max-width:130px"></label>
            <label class="filtro" id="pg-caja-monto"><span>Monto</span>
              <input type="number" id="pg-monto" min="0.01" step="0.01" placeholder="0,00" style="max-width:140px">
              <span class="equivalente" id="pg-monto-eq"></span></label>
            <button class="btn btn--primario" id="pg-agregar">Agregar pago</button>
          </div>
          <p id="pg-error" class="error" hidden></p>

          <div id="pg-credito" hidden>
            <hr style="border:0; border-top:1px solid var(--linea-2); margin:16px 0">
            <p class="ficha__nota" style="margin:0 0 12px">
              La inicial se cobra hoy; el resto se reparte entre las cuotas y ese
              reparto es el <b>mínimo</b> de cada vencimiento, expresado en dólares
              a la tasa de referencia. Si el cliente abona de más, el excedente
              adelanta las cuotas siguientes.
            </p>
            <div class="filtros">
              <label class="filtro"><span>Inicial</span>
                <input type="number" id="cr-inicial" min="0" step="0.01" value="0" style="max-width:130px">
                <span class="equivalente" id="cr-inicial-eq"></span></label>
              <label class="filtro"><span>Inicial en %</span>
                <input type="number" id="cr-inicial-pct" min="0" max="100" step="1" value="0"
                       style="max-width:100px" placeholder="0"></label>
              <label class="filtro"><span>Tasa de referencia</span>
                <input type="number" id="cr-tasa" min="0" step="0.0001" style="max-width:140px"></label>
              <label class="filtro"><span>N.º de cuotas</span>
                <input type="number" id="cr-cuotas" min="1" max="36" step="1" value="3" style="max-width:110px"></label>
              <label class="filtro"><span>Recargo %</span>
                <input type="number" id="cr-recargo" min="0" max="100" step="0.5" value="0"
                       style="max-width:100px" placeholder="0">
                <span class="equivalente" id="cr-recargo-eq"></span></label>
              <label class="filtro"><span>Frecuencia</span>
                <select id="cr-frecuencia" style="max-width:150px">
                  ${FRECUENCIAS.map(f => `<option value="${f.dias}" ${f.id === '30' ? 'selected' : ''}>${f.etiqueta}</option>`).join('')}
                </select></label>
              <label class="filtro"><span>Primera cuota</span>
                <input type="date" id="cr-primera" style="max-width:160px"></label>
            </div>
            <div id="cr-previa"></div>
          </div>
        </div>

        <div id="vn-pagos"></div>

        <div class="ficha__pie" style="display:flex; justify-content:flex-end; gap:8px">
          <a class="btn btn--secundario" href="#/ventas">Cancelar</a>
          <button class="btn btn--primario" id="vn-emitir">Emitir venta</button>
        </div>
      </div>`;

    $('#vn-cliente').addEventListener('change', pintarCliente);
    /* Buscar por código o por nombre. En un mostrador se teclea el código
       del producto, no se busca en una lista de doscientos: el buscador
       deja el selector con lo que coincide y, si solo queda uno, lo elige
       para poder agregar con Enter sin tocar el ratón. */
    const buscador = $('#vn-buscar-prod');
    const selector = $('#vn-producto');
    const todasLasOpciones = [...selector.options].map(o => ({
      valor: o.value, texto: o.textContent, sku: (o.dataset.sku || '').toLowerCase(),
    }));

    function filtrarProductos() {
      const t = buscador.value.trim().toLowerCase();
      const coinciden = !t ? todasLasOpciones : todasLasOpciones.filter(o =>
        o.sku.includes(t) || o.texto.toLowerCase().includes(t));

      selector.innerHTML = coinciden.map(o =>
        `<option value="${o.valor}">${esc(o.texto)}</option>`).join('');

      const nota = $('#vn-encontrados');
      if (!t) nota.textContent = '';
      else if (!coinciden.length) {
        nota.style.color = 'var(--rosa)';
        nota.textContent = 'Ningún producto con ese código o nombre.';
      } else {
        nota.style.color = '';
        nota.textContent = coinciden.length === 1
          ? 'Uno encontrado: pulsa Enter para agregarlo.'
          : `${coinciden.length} productos coinciden.`;
      }
      // El código exacto manda sobre la coincidencia parcial
      const exacto = coinciden.find(o => o.sku === t);
      if (exacto) selector.value = exacto.valor;
      ajustarPasoCantidad();
    }

    function esUnidadDecimal(unidad) {
      if (!unidad) return false;
      const u = String(unidad).trim().toLowerCase();
      return /^(kg|kilo|kilos|kilogramo|kilogramos|g|gr|grs|gramo|gramos|mg|miligramo|miligramos|m|mt|mts|metro|metros|cm|centimetro|centimetros|centímetro|centímetros|mm|milimetro|milimetros|l|lt|lts|litro|litros|ml|mililitro|mililitros|cc|decimal|fraccionable|granel)$/i.test(u)
        || /(kg|kilo|gram|metro|centim|milim|litro|granel|peso)/i.test(u);
    }

    function ajustarPasoCantidad() {
      const elProd = $('#vn-producto');
      const elCant = $('#vn-cantidad');
      const nota = $('#vn-encontrados');
      if (!elProd || !elCant) return;
      const rawId = elProd.value;
      const p = catalogo.find(x => String(x.producto_id || x.id) === String(rawId));
      const esDecimal = p && esUnidadDecimal(p.unidad);

      if (esDecimal) {
        elCant.step = '0.001';
        elCant.min = '0.001';
      } else {
        elCant.step = '1';
        elCant.min = '1';
        const val = Number(elCant.value);
        if (!Number.isInteger(val) || val < 1) {
          elCant.value = Math.max(1, Math.round(val || 1));
        }
      }

      if (p && nota && !$('#vn-buscar-prod').value.trim()) {
        const s = Number(p.stock || 0);
        if (s <= 0) {
          nota.innerHTML = `<span style="color:var(--naranja)">⚠️ Sin existencias en inventario (Stock: 0 ${esc(p.unidad)}). <a href="#/movimientos" style="color:var(--cian); text-decoration:underline;">Registrar entrada</a></span>`;
        } else {
          nota.innerHTML = `<span style="color:var(--esmeralda)">Disponibles en inventario: <b>${cantidad(s)} ${esc(p.unidad)}</b></span>`;
        }
      }
    }

    buscador.addEventListener('input', filtrarProductos);
    selector.addEventListener('change', ajustarPasoCantidad);

    buscador.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!selector.options.length) return;
      agregarRenglon();
      buscador.value = '';
      filtrarProductos();
      buscador.focus();
    });

    $('#vn-cantidad').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        agregarRenglon();
      }
    });

    $('#vn-agregar').addEventListener('click', agregarRenglon);
    $('#vn-iva').addEventListener('input', pintarRenglones);
    $('#vn-incluido').addEventListener('change', pintarRenglones);
    $('#vn-emitir').addEventListener('click', confirmarEmision);
    $('#vn-nuevo-cliente').addEventListener('click', () => {
      INV.vistas.clientes.abrirFormulario(null, async (nuevo) => {
        const actualizados = await INV.db.clientes.listar();
        clientes = actualizados;
        const sel = $('#vn-cliente');
        if (sel) {
          sel.innerHTML = `
            <option value="">Consumidor final — sin datos fiscales</option>
            ${clientes.map(cl => `<option value="${cl.id}">${esc(cl.cliente)} — ${esc(cl.documento_completo)}</option>`).join('')}
          `;
          if (nuevo && nuevo.id) sel.value = String(nuevo.id);
          else if (nuevo && nuevo.documento) {
            const encontrado = clientes.find(cl => cl.documento === nuevo.documento);
            if (encontrado) sel.value = String(encontrado.id);
          }
          pintarCliente();
        }
      });
    });
    INV.ui.montoAutomatico('#pg-monto');
    INV.ui.montoAutomatico('#cr-inicial');

    $('#pg-metodo').addEventListener('change', ajustarCamposPago);
    $('#pg-monto').addEventListener('monto', equivalenteDelPago);
    $('#cr-inicial').addEventListener('monto', () => {
      const total = totalDeLaVenta();
      const pct = total > 0 ? (INV.ui.leerMonto('#cr-inicial') / total) * 100 : 0;
      $('#cr-inicial-pct').value = Math.round(pct * 10) / 10;
      equivalenteInicial();
      previaCredito();
    });
    $('#pg-monto').addEventListener('input', equivalenteDelPago);
    $('#pg-tasa').addEventListener('input', equivalenteDelPago);
    $('#pg-agregar').addEventListener('click', agregarPago);
    $('#pg-referencia').addEventListener('input', e => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    });
    $('#pg-referencia').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); agregarPago(); }
    });
    $('#pg-monto').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); agregarPago(); }
    });
    ['cr-inicial','cr-tasa','cr-cuotas','cr-frecuencia','cr-primera','cr-recargo']
      .forEach(id => $('#' + id).addEventListener('input', previaCredito));

    $('#cr-inicial').addEventListener('input', () => {
      const total = totalDeLaVenta();
      const pct = total > 0 ? (INV.ui.leerMonto('#cr-inicial') / total) * 100 : 0;
      $('#cr-inicial-pct').value = Math.round(pct * 10) / 10;
      equivalenteInicial();
    });

    $('#cr-recargo').addEventListener('input', () => {
      const salida = $('#cr-recargo-eq');
      const r = calcularPlan();
      salida.textContent = (!r.error && r.recargoUsd > 0) ? '+' + numero(r.recargoUsd) + ' $' : '';
    });

    $('#cr-inicial-pct').addEventListener('input', () => {
      const pct = Math.min(100, Math.max(0, Number($('#cr-inicial-pct').value || 0)));
      INV.ui.fijarMonto('#cr-inicial', redondear(totalDeLaVenta() * pct / 100));
      equivalenteInicial();
      previaCredito();
    });

    pintarCliente();
    ajustarCamposPago();
    ajustarPasoCantidad();
    pintarRenglones();
  }

  function sugerirMontoPago() {
    const elMetodo = $('#pg-metodo');
    const elMonto = $('#pg-monto');
    if (!elMetodo || !elMonto) return;
    const m = metodo(elMetodo.value);
    if (m.credito) return;
    const total = totalDeLaVenta();
    const pagado = redondear(pagos.reduce((s, p) => s + Number(p.monto_local), 0));
    const faltaBs = Math.max(0, redondear(total - pagado));
    if (faltaBs > 0) {
      if (m.moneda === 'VES') {
        INV.ui.fijarMonto('#pg-monto', faltaBs);
      } else {
        const elTasa = $('#pg-tasa');
        const tasa = Number((elTasa ? elTasa.value : 0) || 0) || INV.tasas.usd();
        if (tasa > 0) INV.ui.fijarMonto('#pg-monto', redondear(faltaBs / tasa));
      }
    } else if (pagos.length > 0 && faltaBs === 0) {
      INV.ui.fijarMonto('#pg-monto', 0);
    }
    equivalenteDelPago();
  }

  function pintarCliente() {
    const caja = $('#vn-datos-cliente');
    if (!caja) return;
    const selectCliente = $('#vn-cliente');
    const c = selectCliente ? clientes.find(x => String(x.id) === selectCliente.value) : null;
    if (!c) {
      caja.hidden = true;
      pintarRenglones();
      return;
    }
    caja.hidden = false;
    caja.innerHTML = `
      <div class="datos__celda">
        <div class="datos__etiqueta">Documento fiscal</div>
        <div class="datos__valor">${esc(c.documento_completo || (c.tipo_documento ? c.tipo_documento + '-' + c.documento : c.documento || '—'))}</div>
      </div>
      <div class="datos__celda">
        <div class="datos__etiqueta">Contacto</div>
        <div class="datos__valor" style="font-size:14px">${esc(c.telefono || c.correo || '—')}</div>
      </div>
      <div class="datos__celda" style="grid-column:1 / -1">
        <div class="datos__etiqueta">Condición tributaria</div>
        <div class="datos__valor" style="font-size:13.5px">
          ${c.es_agente_retencion
            ? `<span class="pastilla pastilla--retencion" style="margin-right:6px">Agente de Retención</span> Aplica retención del <b>${c.retencion_iva_porcentaje || 75}% del IVA</b>${c.retencion_islr_porcentaje ? ` y ${c.retencion_islr_porcentaje}% ISLR` : ''}.`
            : 'Contribuyente Ordinario — No aplica retenciones.'}
        </div>
      </div>
      <div class="datos__celda" style="grid-column:1 / -1">
        <div class="datos__etiqueta">Dirección</div>
        <div class="datos__valor" style="font-size:13px; font-weight:400">${esc(c.direccion ?? 'No registrada')}</div>
      </div>`;
    pintarRenglones();
  }

  function agregarRenglon() {
    const elProd = $('#vn-producto');
    const elCant = $('#vn-cantidad');
    if (!elProd || !elCant) {
      console.error('[ventas] agregarRenglon: no se encontró #vn-producto o #vn-cantidad');
      return;
    }

    const rawId = String(elProd.value || '').trim();
    if (!rawId) return avisar('Selecciona un producto del catálogo', 'error');

    const rawCant = elCant.value ? elCant.value.replace(',', '.') : '1';
    const cant = Number(rawCant);

    console.log('[ventas] agregarRenglon rawId=', rawId, 'cant=', cant,
      'catalogo.length=', catalogo.length,
      'primeros ids=', catalogo.slice(0,3).map(x => x.producto_id + '|' + x.id + '|stock=' + x.stock));

    const p = catalogo.find(x => String(x.producto_id || x.id) === rawId);

    if (!p) {
      console.error('[ventas] producto no encontrado en catálogo. rawId=', rawId);
      return avisar('Selecciona un producto válido del catálogo', 'error');
    }

    console.log('[ventas] producto encontrado:', p.nombre, 'stock=', p.stock, 'precio_venta=', p.precio_venta);

    if (!cant || cant <= 0) return avisar('Indica una cantidad mayor que cero', 'error');

    const pid = p.producto_id || p.id;
    const yaPuesto = renglones.filter(r => String(r.producto_id) === String(pid))
      .reduce((s, r) => s + Number(r.cantidad), 0);
    const stockActual = Number(p.stock != null ? p.stock : 0);
    const disponible = stockActual - yaPuesto;

    console.log('[ventas] stockActual=', stockActual, 'yaPuesto=', yaPuesto, 'disponible=', disponible);

    if (stockActual <= 0) {
      return avisar(`⚠️ "${p.nombre}" no tiene existencias en inventario (Stock: 0 ${p.unidad}). Registra una entrada en Movimientos antes de venderlo.`, 'error');
    }
    if (cant > disponible) {
      return avisar(`Solo hay ${cantidad(disponible)} ${p.unidad} disponibles de "${p.nombre}".`, 'error');
    }

    const precioUnitario = INV.tasas && INV.tasas.aFactura
      ? (INV.tasas.aFactura(Number(p.precio_venta)) ?? Number(p.precio_venta))
      : Number(p.precio_venta);

    const existente = renglones.find(r => String(r.producto_id) === String(pid));
    if (existente) {
      existente.cantidad = Number(existente.cantidad) + cant;
    } else {
      renglones.push({
        producto_id: pid, descripcion: p.nombre, sku: p.sku, unidad: p.unidad,
        cantidad: cant,
        precio_catalogo: Number(p.precio_venta),
        precio_unitario: precioUnitario,
        exento: !!p.exento_iva,
        stock: stockActual,
      });
    }

    console.log('[ventas] renglones ahora:', renglones.length, 'items');

    elCant.value = 1;
    ajustarPasoCantidad();
    pintarRenglones();
    sugerirMontoPago();
  }

  /* Muestra solo los campos que el método elegido necesita. */
  /* Moneda del último método elegido, para saber cuándo hay que rehacer
     la tasa del campo. */
  let monedaAnterior = null;

  function ajustarCamposPago() {
    const elMetodo = $('#pg-metodo');
    if (!elMetodo) return;
    const m = metodo(elMetodo.value);
    const cajaRef = $('#pg-caja-ref');
    const cajaDetalle = $('#pg-caja-detalle');
    const cajaTasa = $('#pg-caja-tasa');
    const cajaMonto = $('#pg-caja-monto');
    const cajaCredito = $('#pg-credito');
    const btnAgregar = $('#pg-agregar');

    if (cajaRef) cajaRef.hidden = !m.ref;
    if (cajaDetalle) cajaDetalle.hidden = !m.detalle;
    if (cajaTasa) cajaTasa.hidden = m.moneda === 'VES' || m.credito;
    if (cajaMonto) cajaMonto.hidden = !!m.credito;
    if (cajaCredito) cajaCredito.hidden = !m.credito;
    if (btnAgregar) {
      btnAgregar.textContent = m.credito
        ? (plan ? 'Actualizar el crédito' : 'Establecer crédito')
        : 'Agregar pago';
    }

    if (m.retencion && cajaRef) {
      const spanRef = cajaRef.querySelector('span');
      if (spanRef) spanRef.textContent = 'N.° Comprobante Retención';
      const inpRef = $('#pg-referencia');
      if (inpRef) {
        inpRef.placeholder = 'Comprobante';
        inpRef.maxLength = 20;
      }

      // Autocompletar el monto de retención si el cliente es agente
      const selectCliente = $('#vn-cliente');
      const c = selectCliente ? clientes.find(x => String(x.id) === selectCliente.value) : null;
      const tasaIva = Number(($('#vn-iva') || {}).value || 0);
      const inc = ($('#vn-incluido') || {}).value === 'si';
      const retIvaPct = (c && c.es_agente_retencion) ? Number(c.retencion_iva_porcentaje || 75) : 0;
      const retIslrPct = (c && c.es_agente_retencion) ? Number(c.retencion_islr_porcentaje || 0) : 0;
      const calc = calcular(renglones, tasaIva, inc, retIvaPct, retIslrPct);

      if (m.id === 'retencion_iva' && calc.retencion_iva_monto > 0) {
        INV.ui.fijarMonto('#pg-monto', calc.retencion_iva_monto);
      } else if (m.id === 'retencion_islr' && calc.retencion_islr_monto > 0) {
        INV.ui.fijarMonto('#pg-monto', calc.retencion_islr_monto);
      }
    } else if (m.ref && cajaRef) {
      const spanRef = cajaRef.querySelector('span');
      if (spanRef) spanRef.textContent = 'Referencia — últimos 6';
      const inpRef = $('#pg-referencia');
      if (inpRef) {
        inpRef.placeholder = '000000';
        inpRef.maxLength = 6;
      }
    }

    if (m.credito) {
      const elCrTasa = $('#cr-tasa');
      const elCrPrimera = $('#cr-primera');
      if (elCrTasa && !elCrTasa.value) elCrTasa.value = tasasPorDefecto().USD || '';
      if (elCrPrimera && !elCrPrimera.value) {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        elCrPrimera.value = d.toISOString().slice(0, 10);
      }
      previaCredito();
    }

    if (m.moneda !== 'VES' && cajaTasa) {
      const tasas = tasasPorDefecto();
      const elPgTasa = $('#pg-tasa');
      if (elPgTasa && monedaAnterior !== m.moneda) {
        elPgTasa.value = tasas[m.moneda] || '';
      }
      const spanTasa = cajaTasa.querySelector('span');
      if (spanTasa) spanTasa.textContent = `Tasa ${m.moneda} → Bs`;
      if (elPgTasa) elPgTasa.placeholder = tasas[m.moneda] ? '' : 'Sin tasa configurada';
    }
    monedaAnterior = m.moneda;
    const elPgMonto = $('#pg-monto');
    if (elPgMonto) elPgMonto.placeholder = m.moneda === 'VES' ? '0,00' : '0,00 ' + m.moneda;
    sugerirMontoPago();
    equivalenteDelPago();
  }

  /* El monto del pago se ve en la otra moneda mientras se escribe. */
  function equivalenteDelPago() {
    const salida = $('#pg-monto-eq');
    if (!salida || !INV.tasas) return;

    const elMetodo = $('#pg-metodo');
    if (!elMetodo) return;
    const m = metodo(elMetodo.value);
    const monto = INV.ui.leerMonto('#pg-monto');
    if (!monto) { salida.textContent = ''; return; }

    if (m.moneda === 'VES') {
      const eq = INV.tasas.aDolares(monto);
      salida.textContent = eq === null ? '' : '= ' + numero(eq) + ' $';
      return;
    }

    // El monto está en divisa: se convierte con la tasa del propio pago
    const elTasa = $('#pg-tasa');
    const tasa = Number((elTasa ? elTasa.value : 0) || 0) || INV.tasas.usd();
    salida.textContent = tasa > 0
      ? '= ' + numero(Math.round(monto * tasa * 100) / 100) + ' Bs'
      : '';
  }

  /* Total de la venta, que es la base sobre la que se calcula el
     porcentaje de la inicial. */
  function totalDeLaVenta() {
    const selectCliente = $('#vn-cliente');
    const c = selectCliente ? clientes.find(x => String(x.id) === selectCliente.value) : null;
    const retIvaPct = (c && c.es_agente_retencion) ? Number(c.retencion_iva_porcentaje || 75) : 0;
    const retIslrPct = (c && c.es_agente_retencion) ? Number(c.retencion_islr_porcentaje || 0) : 0;
    const tasa = Number(($('#vn-iva') || {}).value || 0);
    const inc = ($('#vn-incluido') || {}).value === 'si';
    return calcular(renglones, tasa, inc, retIvaPct, retIslrPct).total;
  }

  /* La inicial también se ve en dólares */
  function equivalenteInicial() {
    const salida = $('#cr-inicial-eq');
    if (!salida) return;
    const monto = INV.ui.leerMonto('#cr-inicial');
    const elCrTasa = $('#cr-tasa');
    const tasa = Number((elCrTasa ? elCrTasa.value : 0) || 0) || (INV.tasas ? INV.tasas.usd() : 0);
    salida.textContent = (monto > 0 && tasa > 0)
      ? '= ' + numero(redondear(monto / tasa)) + ' $'
      : '';
  }

  function calcularPlan() {
    const elCrTasa = $('#cr-tasa');
    const elCrCuotas = $('#cr-cuotas');
    const elCrFrecuencia = $('#cr-frecuencia');
    const elCrPrimera = $('#cr-primera');
    const elCrRecargo = $('#cr-recargo');

    const tasa = Number((elCrTasa ? elCrTasa.value : 0) || 0);
    const inicial = INV.ui.leerMonto('#cr-inicial');
    const n = Math.max(1, Math.round(Number((elCrCuotas ? elCrCuotas.value : 1) || 1)));
    const dias = Number((elCrFrecuencia ? elCrFrecuencia.value : 30) || 30);
    const primera = elCrPrimera ? elCrPrimera.value : '';

    const selectCliente = $('#vn-cliente');
    const c = selectCliente ? clientes.find(x => String(x.id) === selectCliente.value) : null;
    const retIvaPct = (c && c.es_agente_retencion) ? Number(c.retencion_iva_porcentaje || 75) : 0;
    const retIslrPct = (c && c.es_agente_retencion) ? Number(c.retencion_islr_porcentaje || 0) : 0;
    const tasaIva = Number(($('#vn-iva') || {}).value || 0);
    const inc = ($('#vn-incluido') || {}).value === 'si';
    const calc = calcular(renglones, tasaIva, inc, retIvaPct, retIslrPct);
    const totalVenta = calc.total;

    const otros = pagos.filter(p => p.metodo !== 'credito')
                       .reduce((s, p) => s + Number(p.monto_local), 0);
    const financiado = redondear(totalVenta - otros - inicial);

    if (!tasa || tasa <= 0) return { error: 'Indica la tasa de referencia en dólares.' };
    if (!primera) return { error: 'Indica la fecha de la primera cuota.' };
    if (financiado <= 0) return { error: 'La inicial ya cubre el total: no hay nada que financiar.' };

    const recargoPct = Math.min(100, Math.max(0, Number((elCrRecargo ? elCrRecargo.value : 0) || 0)));
    const financiadoSinRecargo = redondear(financiado / tasa);
    const recargoUsd = redondear(financiadoSinRecargo * recargoPct / 100);
    const financiadoUsd = redondear(financiadoSinRecargo + recargoUsd);

    const base = Math.floor((financiadoUsd / n) * 100) / 100;
    const cuotas = [];
    for (let i = 1; i <= n; i++) {
      const monto = i < n ? base : redondear(financiadoUsd - base * (n - 1));
      const vence = new Date(primera + 'T00:00:00');
      vence.setDate(vence.getDate() + dias * (i - 1));
      cuotas.push({
        numero: i, monto_usd: monto, minimo_usd: monto, tasa_referencia: tasa,
        vence_en: vence.toISOString().slice(0, 10),
      });
    }
    return {
      inicial, tasa, financiado, financiadoUsd, cuotas, totalVenta,
      minimoUsd: base, periodoDias: dias, n,
      recargoPct, recargoUsd, financiadoSinRecargo,
      aPagarUsd: redondear((inicial / tasa) + financiadoUsd),
    };
  }

  function previaCredito() {
    const r = calcularPlan();
    const caja = $('#cr-previa');
    if (!caja) return;
    if (r.error) {
      caja.innerHTML = `<p class="subida__nota" style="margin-top:12px">${esc(r.error)}</p>`;
      return;
    }
    const pct = r.totalVenta > 0 ? (r.inicial / r.totalVenta) * 100 : 0;
    const inicialUsd = r.tasa > 0 ? redondear(r.inicial / r.tasa) : 0;
    const frecuencia = (FRECUENCIAS.find(f => Number(f.dias) === Number(r.periodoDias)) || {}).etiqueta
                       || `cada ${r.periodoDias} días`;

    caja.innerHTML = `
      <div class="totales" style="border-radius:var(--r-s); margin-top:14px">
        <div class="totales__fila">
          <span>Inicial de hoy${r.inicial > 0 ? ` · ${numero(pct, 1)}% del total` : ' · sin inicial'}</span>
          <b>${numero(r.inicial)}<span class="equivalente equivalente--usd">${numero(inicialUsd)} $</span></b>
        </div>
        <div class="totales__fila">
          <span>Queda financiado</span>
          <b>${numero(r.financiado)}<span class="equivalente equivalente--usd">${numero(r.financiadoSinRecargo)} $</span></b>
        </div>
        ${r.recargoPct > 0 ? `
          <div class="totales__fila" style="color:var(--naranja)">
            <span>Recargo por financiamiento · ${numero(r.recargoPct, 1)}%</span>
            <b>+${numero(r.recargoUsd)} $<span class="equivalente">${numero(redondear(r.recargoUsd * r.tasa))} Bs</span></b>
          </div>
          <div class="totales__fila totales__fila--total">
            <span>Total a cancelar con el crédito</span>
            <b class="monto-usd">${numero(r.aPagarUsd)} $<span class="equivalente">${
              numero(redondear(r.aPagarUsd * r.tasa))} Bs</span></b>
          </div>` : ''}
        <div class="totales__fila" style="color:var(--cian)">
          <span>${r.n} cuota${r.n > 1 ? 's' : ''} ${esc(frecuencia.toLowerCase())} · mínimo por cuota</span>
          <b class="monto-usd">${numero(r.minimoUsd)} $</b>
        </div>
      </div>
      <div class="confirmar-lista" style="margin-top:12px">
        ${r.cuotas.map(q => {
          const f = new Date(q.vence_en + 'T00:00:00');
          const enBs = r.tasa > 0 ? redondear(q.monto_usd * r.tasa) : null;
          return `
          <div class="confirmar-fila">
            <span>Cuota ${q.numero} de ${r.cuotas.length}
              <br><span class="lista__sub">vence el ${f.toLocaleDateString('es', {
                weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span></span>
            <b class="monto-usd">${numero(q.monto_usd)} $${
              enBs === null ? '' : `<span class="equivalente">${numero(enBs)} Bs</span>`}</b>
          </div>`;
        }).join('')}
      </div>`;
  }

  function agregarPago() {
    const err = $('#pg-error');
    if (err) err.hidden = true;

    const elMetodo = $('#pg-metodo');
    if (!elMetodo) return;
    const m = metodo(elMetodo.value);
    const monto = INV.ui.leerMonto('#pg-monto');
    const referencia = ($('#pg-referencia') || {}).value ? $('#pg-referencia').value.trim() : '';
    const detalle = ($('#pg-detalle') || {}).value ? $('#pg-detalle').value.trim() : '';
    const tasa = m.moneda === 'VES' ? 1 : Number(($('#pg-tasa') || {}).value || 0);

    const fallar = texto => {
      if (err) { err.textContent = texto; err.hidden = false; }
      else avisar(texto, 'error');
    };

    if (m.credito) {
      const r = calcularPlan();
      if (r.error) return fallar(r.error);
      pagos = pagos.filter(p => p.metodo !== 'credito');
      plan = r;
      if (r.inicial > 0) {
        pagos.push({
          metodo: 'credito', referencia: null, detalle: 'Inicial',
          moneda: 'VES', monto: r.inicial, tasa: 1, monto_local: r.inicial,
        });
      }
      pintarRenglones();
      return;
    }

    if (!monto || monto <= 0) return fallar('Indica el monto del pago.');
    if (m.retencion && !referencia)
      return fallar('Indica el número de comprobante de retención.');
    if (m.ref && !m.retencion && referencia.length !== 6)
      return fallar('La referencia debe tener los 6 últimos dígitos de la operación.');
    if (m.detalle && !detalle) return fallar('Especifica de qué otra forma se pagó.');
    if (m.moneda !== 'VES' && (!tasa || tasa <= 0))
      return fallar(`Indica la tasa de cambio de ${m.moneda} para convertir a bolívares.`);

    pagos.push({
      metodo: m.id,
      referencia: m.ref ? referencia : null,
      detalle: m.detalle ? detalle : null,
      moneda: m.moneda,
      monto: redondear(monto),
      tasa: tasa,
      monto_local: redondear(monto * tasa),
    });

    INV.ui.fijarMonto('#pg-monto', 0);
    const inpRef = $('#pg-referencia');
    if (inpRef) inpRef.value = '';
    const inpDet = $('#pg-detalle');
    if (inpDet) inpDet.value = '';
    pintarRenglones();
  }

  function pintarPagos(total, r = null) {
    const contPagos = $('#vn-pagos');
    if (!contPagos) return;

    const netoCobrar = (r && r.hay_retencion) ? r.monto_neto_cobrar : total;
    const pagado = redondear(pagos.reduce((s, p) => s + Number(p.monto_local), 0));
    const tieneRetencionRegistrada = pagos.some(p => p.metodo === 'retencion_iva' || p.metodo === 'retencion_islr');
    const baseObjetivo = tieneRetencionRegistrada ? total : netoCobrar;
    const diferencia = redondear(baseObjetivo - pagado);

    contPagos.innerHTML = `
      ${pagos.length ? `
      <div class="lista lista--pago">
        ${pagos.map((p, i) => `
          <div class="lista__item" style="--i:${i}">
            <span class="lista__nombre">${esc(etiquetaPago(p))}
              <span class="lista__sub">${p.moneda === 'VES'
                ? 'en bolívares'
                : `${numero(p.monto)} ${esc(p.moneda)} × ${numero(p.tasa, 2)}`}</span></span>
            <span class="lista__dato"><b>${numero(p.monto_local)}</b><small>Bs</small></span>
            <button class="btn btn--fantasma btn--chico" data-quitar-pago="${i}" aria-label="Quitar">&#10005;</button>
          </div>`).join('')}
      </div>` : ''}

      ${plan ? `
        <div class="ficha__pie">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap">
            <div class="datos__etiqueta" style="margin:0">
              Crédito · ${plan.cuotas.length} cuotas de referencia en dólares
            </div>
            <button class="btn btn--fantasma btn--chico" id="cr-quitar">Quitar el crédito</button>
          </div>
          <div class="confirmar-lista" style="margin-top:10px">
            ${plan.cuotas.map(q => `
              <div class="confirmar-fila">
                <span>Cuota ${q.numero}<span class="lista__sub">vence el ${new Date(q.vence_en + 'T00:00:00').toLocaleDateString('es')}</span></span>
                <b>${numero(q.monto_usd)} USD</b>
              </div>`).join('')}
          </div>
        </div>` : ''}

      <div class="totales">
        <div class="totales__fila"><span>Total de la mercancía</span><b>${numero(total)}</b></div>
        ${(r && r.hay_retencion && !tieneRetencionRegistrada) ? `
          ${r.retencion_iva_monto > 0 ? `
            <div class="totales__fila" style="color:var(--naranja)">
              <span>(-) Retención IVA ${r.retencion_iva_porcentaje}%</span>
              <b>-${numero(r.retencion_iva_monto)}</b>
            </div>` : ''}
          ${r.retencion_islr_monto > 0 ? `
            <div class="totales__fila" style="color:var(--naranja)">
              <span>(-) Retención ISLR ${r.retencion_islr_porcentaje}%</span>
              <b>-${numero(r.retencion_islr_monto)}</b>
            </div>` : ''}
          <div class="totales__fila" style="color:var(--esmeralda)">
            <span>Neto a percibir en dinero</span>
            <b>${numero(r.monto_neto_cobrar)}</b>
          </div>` : ''}
        ${(() => {
          const otra = INV.tasas ? INV.tasas.aDolares(total) : null;
          return otra === null ? '' : `
            <div class="totales__fila" style="color:var(--cian)">
              <span>Equivalente total</span><b>${numero(otra)} $</b></div>`;
        })()}
        ${plan && plan.recargoUsd > 0 ? `
          <div class="totales__fila" style="color:var(--naranja)">
            <span>Recargo por financiamiento · ${numero(plan.recargoPct, 1)}%</span>
            <b>+${numero(redondear(plan.recargoUsd * plan.tasa))}<span class="equivalente">${
              numero(plan.recargoUsd)} $</span></b></div>
          <div class="totales__fila totales__fila--total">
            <span>Total a cancelar con el crédito</span>
            <b>${numero(redondear(total + plan.recargoUsd * plan.tasa))}<span class="equivalente equivalente--usd">${
              numero(plan.aPagarUsd)} $</span></b></div>` : ''}
        <div class="totales__fila"><span>${plan ? 'Pagado hoy · inicial' : 'Pagado / Cubierto'}</span><b>${numero(pagado)}</b></div>
        ${plan ? `
          <div class="totales__fila" style="color:var(--cian)">
            <span>Por cobrar en ${plan.cuotas.length} cuota${plan.cuotas.length > 1 ? 's' : ''} ·
              ${numero(plan.minimoUsd)} $ cada una</span>
            <b class="monto-usd">${numero(plan.financiadoUsd)} $<span class="equivalente">${
              numero(redondear(plan.financiadoUsd * plan.tasa))} Bs</span></b></div>`
        : Math.abs(diferencia) < 0.01 ? `
          <div class="totales__fila" style="color:var(--esmeralda)"><span>Cuenta saldada</span><b>0,00</b></div>`
        : diferencia > 0 ? `
          <div class="totales__fila" style="color:var(--naranja)"><span>Falta por cobrar</span><b>${numero(diferencia)}</b></div>`
        : `
          <div class="totales__fila" style="color:var(--violeta)"><span>Vuelto</span><b>${numero(-diferencia)}</b></div>`}
      </div>`;

    $$('[data-quitar-pago]').forEach(b => b.addEventListener('click', () => {
      const quitado = pagos[Number(b.dataset.quitarPago)];
      if (quitado && quitado.metodo === 'credito') plan = null;
      pagos.splice(Number(b.dataset.quitarPago), 1);
      pintarRenglones();
    }));

    const quitarPlan = $('#cr-quitar');
    if (quitarPlan) quitarPlan.addEventListener('click', () => {
      plan = null;
      pagos = pagos.filter(p => p.metodo !== 'credito');
      pintarRenglones();
    });
  }

  function pintarRenglones() {
    const contRenglones = $('#vn-renglones');
    const contTotales = $('#vn-totales');

    console.log('[ventas] pintarRenglones → renglones=', renglones.length,
      'contRenglones=', !!contRenglones, 'contTotales=', !!contTotales);

    if (!contRenglones || !contTotales) {
      console.warn('[ventas] pintarRenglones: contenedor no encontrado, abortando');
      return;
    }

    const tasa = Number(($('#vn-iva') || {}).value || 0);
    const incluido = ($('#vn-incluido') || {}).value === 'si';
    const selectCliente = $('#vn-cliente');
    const c = selectCliente ? clientes.find(x => String(x.id) === selectCliente.value) : null;
    const retIvaPct = (c && c.es_agente_retencion) ? Number(c.retencion_iva_porcentaje || 75) : 0;
    const retIslrPct = (c && c.es_agente_retencion) ? Number(c.retencion_islr_porcentaje || 0) : 0;
    const r = calcular(renglones, tasa, incluido, retIvaPct, retIslrPct);

    console.log('[ventas] pintarRenglones → tasa=', tasa, 'r.total=', r.total, 'r.items=', r.items.length);

    contRenglones.innerHTML = renglones.length ? `
      <div class="lista lista--ren">
        ${r.items.map((it, i) => `
          <div class="lista__item" style="--i:${i}">
            <span class="lista__nombre">${esc(it.descripcion)}
              ${it.exento ? '<span class="pastilla pastilla--exento">exento</span>' : ''}
              <span class="lista__sub">${esc(it.sku)} · ${cantidad(it.cantidad)} ${esc(it.unidad)} × ${numero(it.precio_unitario)}${
                INV.tasas.catalogoEnDolares() && it.precio_catalogo
                  ? ` <span style="color:var(--cian)">(${numero(it.precio_catalogo)} $)</span>` : ''}</span></span>
            <span class="lista__dato">
              <input type="number" min="0.01" step="0.01" value="${it.precio_unitario}"
                     data-precio="${i}" style="width:104px; text-align:right; padding:6px 8px">
              <small>precio</small></span>
            <span class="lista__dato"><b>${numero(it.base)}</b><small>base</small></span>
            <span class="lista__dato"><b>${numero(it.iva_monto)}</b><small>IVA</small></span>
            <span class="lista__dato"><b>${numero(it.total)}</b><small>total</small>
              ${(() => {
                const eq = INV.tasas ? INV.tasas.aDolares(it.total) : null;
                return eq === null ? '' : `<span class="equivalente">${numero(eq)} $</span>`;
              })()}</span>
            <button class="btn btn--fantasma btn--chico" data-quitar="${i}" aria-label="Quitar">✕</button>
          </div>`).join('')}
      </div>`
      : '<div class="vacio" style="padding:32px"><h4>Sin renglones</h4><p>Agrega productos para armar la venta.</p></div>';

    contTotales.innerHTML = `
      <div class="totales">
        ${r.hay_exentos ? `
          <div class="totales__fila">
            <span>Base imponible</span><b>${numero(r.base_gravada)}</b></div>
          <div class="totales__fila" style="color:var(--esmeralda)">
            <span>Exento de IVA</span><b>${numero(r.base_exenta)}</b></div>` : ''}
        <div class="totales__fila">
          <span>Subtotal de los productos${incluido ? ' (IVA desglosado)' : ''}</span>
          <b>${numero(r.subtotal)}</b>
        </div>
        <div class="totales__fila">
          <span>IVA ${numero(tasa, tasa % 1 ? 2 : 0)}%</span>
          <b>${numero(r.iva_monto)}</b>
        </div>
        <div class="totales__fila totales__fila--total">
          <span>Total factura</span>
          <b>${numero(r.total)}</b>
        </div>
        ${r.hay_retencion ? `
          ${r.retencion_iva_monto > 0 ? `
            <div class="totales__fila" style="color:var(--naranja)">
              <span>(-) Retención IVA ${r.retencion_iva_porcentaje}%</span>
              <b>-${numero(r.retencion_iva_monto)}</b>
            </div>` : ''}
          ${r.retencion_islr_monto > 0 ? `
            <div class="totales__fila" style="color:var(--naranja)">
              <span>(-) Retención ISLR ${r.retencion_islr_porcentaje}%</span>
              <b>-${numero(r.retencion_islr_monto)}</b>
            </div>` : ''}
          <div class="totales__fila totales__fila--total" style="color:var(--esmeralda); border-top:1px dashed var(--linea)">
            <span>Neto a percibir en dinero</span>
            <b>${numero(r.monto_neto_cobrar)}</b>
          </div>` : ''}
        ${(() => {
          if (!INV.tasas) return '';
          const otra = INV.tasas.aDolares(r.total);
          if (otra === null) return '';
          return `<div class="totales__fila" style="color:var(--cian)">
            <span>Equivalente total</span><b>${numero(otra)} $</b></div>`;
        })()}
      </div>`;

    $$('[data-quitar]').forEach(b => b.addEventListener('click', () => {
      renglones.splice(Number(b.dataset.quitar), 1);
      pintarRenglones();
    }));

    $$('[data-precio]').forEach(inp => inp.addEventListener('change', () => {
      const i = Number(inp.dataset.precio);
      const v = Number(inp.value);
      if (v > 0) renglones[i].precio_unitario = v;
      pintarRenglones();
    }));

    pintarPagos(r.total, r);
  }

  /* Antes de escribir nada: se muestra la venta armada y se pide
     confirmación. Emitir descuenta inventario y el comprobante no se puede
     editar después, así que conviene mirarlo dos veces. */
  function confirmarEmision() {
    if (!renglones.length) return avisar('Agrega al menos un producto', 'error');

    if (!plan && metodo($('#pg-metodo').value).credito) {
      const r = calcularPlan();
      if (r.error) {
        return avisar('Falta completar el crédito: ' + r.error, 'error');
      }
      agregarPago();
      if (!plan) return;
      avisar('Se aplicó el plan de crédito antes de emitir');
    }

    const tasa = Number($('#vn-iva').value || 0);
    const incluido = $('#vn-incluido').value === 'si';
    const c = clientes.find(cl => String(cl.id) === $('#vn-cliente').value);
    const retIvaPct = (c && c.es_agente_retencion) ? Number(c.retencion_iva_porcentaje || 75) : 0;
    const retIslrPct = (c && c.es_agente_retencion) ? Number(c.retencion_islr_porcentaje || 0) : 0;
    const r = calcular(renglones, tasa, incluido, retIvaPct, retIslrPct);

    const pagado = redondear(pagos.reduce((s, p) => s + Number(p.monto_local), 0));
    const tieneRet = pagos.some(p => p.metodo === 'retencion_iva' || p.metodo === 'retencion_islr');
    const objetivo = tieneRet ? r.total : (r.hay_retencion ? r.monto_neto_cobrar : r.total);
    const diferencia = redondear(objetivo - pagado);

    abrirModal({
      titulo: plan ? 'Confirmar la venta a crédito' : 'Confirmar la venta',
      cuerpo: `
        <div class="datos" style="border-radius:var(--r-s); overflow:hidden; margin-bottom:16px">
          <div class="datos__celda" style="grid-column:1 / -1">
            <div class="datos__etiqueta">Cliente</div>
            <div class="datos__valor" style="font-size:15px">${esc(c ? c.cliente : 'Consumidor final')}</div>
            ${c ? `<div class="lista__sub">${esc(c.documento_completo)}${
              c.es_agente_retencion ? ` · <span class="pastilla pastilla--retencion">Agente Ret. ${c.retencion_iva_porcentaje}%</span>` : ''
            }</div>` : ''}
          </div>
        </div>

        <div class="datos__etiqueta">${r.items.length} renglones</div>
        <div class="confirmar-lista">
          ${r.items.map(i => `
            <div class="confirmar-fila">
              <span>${esc(i.descripcion)}<br><span class="lista__sub">${cantidad(i.cantidad)} × ${numero(i.precio_unitario)}</span></span>
              <b>${numero(i.total)}</b>
            </div>`).join('')}
        </div>

        <div class="totales" style="border-radius:var(--r-s); margin-top:14px">
          <div class="totales__fila"><span>Subtotal${incluido ? ' (base)' : ''}</span><b>${numero(r.subtotal)}</b></div>
          <div class="totales__fila"><span>IVA ${numero(tasa, tasa % 1 ? 2 : 0)}%</span><b>${numero(r.iva_monto)}</b></div>
          <div class="totales__fila totales__fila--total"><span>Total Factura</span><b>${numero(r.total)}</b></div>
          ${r.hay_retencion ? `
            ${r.retencion_iva_monto > 0 ? `
              <div class="totales__fila" style="color:var(--naranja)">
                <span>(-) Retención IVA ${r.retencion_iva_porcentaje}%</span>
                <b>-${numero(r.retencion_iva_monto)}</b></div>` : ''}
            ${r.retencion_islr_monto > 0 ? `
              <div class="totales__fila" style="color:var(--naranja)">
                <span>(-) Retención ISLR ${r.retencion_islr_porcentaje}%</span>
                <b>-${numero(r.retencion_islr_monto)}</b></div>` : ''}
            <div class="totales__fila totales__fila--total" style="color:var(--esmeralda)">
              <span>Neto a Percibir</span>
              <b>${numero(r.monto_neto_cobrar)}</b></div>` : ''}
        </div>

        <div class="datos__etiqueta" style="margin-top:16px">Forma de pago</div>
        ${pagos.length ? `
          <div class="confirmar-lista">
            ${pagos.map(p => `
              <div class="confirmar-fila">
                <span>${esc(etiquetaPago(p))}${p.moneda !== 'VES'
                  ? `<br><span class="lista__sub">${numero(p.monto)} ${esc(p.moneda)} × ${numero(p.tasa, 2)}</span>` : ''}</span>
                <b>${numero(p.monto_local)}</b>
              </div>`).join('')}
          </div>`
        : '<p class="subida__nota" style="margin-top:6px">Sin formas de pago registradas.</p>'}

        ${plan ? `
          <div class="datos__etiqueta" style="margin-top:16px">
            Venta a crédito${plan.recargoPct > 0 ? ` · recargo ${numero(plan.recargoPct, 1)}%` : ''}</div>
          <div class="confirmar-lista">
            <div class="confirmar-fila">
              <span>Total de la mercancía</span><b>${numero(r.total)}</b></div>
            ${plan.recargoUsd > 0 ? `
              <div class="confirmar-fila" style="color:var(--naranja)">
                <span>Recargo por financiamiento</span>
                <b>+${numero(redondear(plan.recargoUsd * plan.tasa))}</b></div>
              <div class="confirmar-fila" style="font-weight:700">
                <span>Total a cancelar</span>
                <b>${numero(redondear(r.total + plan.recargoUsd * plan.tasa))}
                  <span class="equivalente equivalente--usd">${numero(plan.aPagarUsd)} $</span></b></div>` : ''}
            <div class="confirmar-fila" style="color:var(--esmeralda)">
              <span>Se cobra hoy · inicial${plan.inicial > 0
                ? ` ${numero((plan.inicial / r.total) * 100, 1)}%` : ' · ninguna'}</span>
              <b>${numero(plan.inicial)}</b></div>
            <div class="confirmar-fila" style="color:var(--naranja)">
              <span>Queda por cobrar en ${plan.cuotas.length} cuota${plan.cuotas.length > 1 ? 's' : ''}</span>
              <b class="monto-usd">${numero(plan.financiadoUsd)} $
                <span class="equivalente">${numero(redondear(plan.financiadoUsd * plan.tasa))} Bs</span></b></div>
          </div>
          <div class="confirmar-lista" style="margin-top:8px">
            ${plan.cuotas.map(q => `
              <div class="confirmar-fila">
                <span>Cuota ${q.numero} de ${plan.cuotas.length}<span class="lista__sub">vence el ${
                  new Date(q.vence_en + 'T00:00:00').toLocaleDateString('es', {
                    day: '2-digit', month: 'short', year: 'numeric' })}</span></span>
                <b class="monto-usd">${numero(q.monto_usd)} $<span class="equivalente">${
                  numero(redondear(q.monto_usd * plan.tasa))} Bs</span></b>
              </div>`).join('')}
          </div>` : ''}

        ${plan ? '' : Math.abs(diferencia) < 0.01 ? ''
          : diferencia > 0
            ? `<p class="error" style="margin-top:12px">Quedan ${numero(diferencia)} por cobrar. Puedes emitir igual y registrar el resto después.</p>`
            : `<p style="margin-top:12px; color:var(--violeta); font-size:13px">Vuelto a entregar: <b>${numero(-diferencia)}</b></p>`}

        <p class="subida__nota" style="margin-top:14px">
          Al confirmar se descuenta el inventario y el comprobante ya no podrá editarse.
        </p>`,
      acciones: [
        { texto: 'Revisar', alPulsar: cerrarModal },
        { texto: 'Confirmar y emitir', estilo: 'btn--primario',
          alPulsar: btn => emitir(r, tasa, incluido, btn) },
      ],
    });
  }

  async function emitir(r, tasa, incluido, btnModal) {
    const btn = $('#vn-emitir');

    btnModal.disabled = true;
    btnModal.textContent = 'Emitiendo…';
    btn.disabled = true;
    try {
      const retPagoIva = pagos.find(p => p.metodo === 'retencion_iva');
      const retPagoIslr = pagos.find(p => p.metodo === 'retencion_islr');
      const venta = await INV.db.ventas.crear({
        cliente_id: $('#vn-cliente').value || null,
        iva_tasa: tasa,
        iva_incluido: incluido,
        subtotal: r.subtotal,
        iva_monto: r.iva_monto,
        total: r.total,
        retencion_iva_porcentaje: r.retencion_iva_porcentaje || 0,
        retencion_iva_monto: r.retencion_iva_monto || 0,
        retencion_islr_porcentaje: r.retencion_islr_porcentaje || 0,
        retencion_islr_monto: r.retencion_islr_monto || 0,
        monto_neto_cobrar: r.monto_neto_cobrar || r.total,
        comprobante_retencion_iva: retPagoIva ? retPagoIva.referencia : null,
        comprobante_retencion_islr: retPagoIslr ? retPagoIslr.referencia : null,
        nota: $('#vn-nota').value || null,
        a_credito: !!plan,
        tasa_referencia: plan ? plan.tasa : Number(tasasPorDefecto().USD || 0),
        recargo_credito: plan ? plan.recargoPct : 0,
        total_usd: plan ? redondear(r.total / plan.tasa)
                        : (tasasPorDefecto().USD ? redondear(r.total / tasasPorDefecto().USD) : 0),
        cuotas: plan ? plan.cuotas.map(q => ({ ...q })) : [],
        pagos: pagos.map(p => ({ ...p })),
        items: r.items.map(i => ({
          producto_id: i.producto_id, descripcion: i.descripcion,
          cantidad: i.cantidad, precio_unitario: i.precio_unitario,
          base: i.base, iva_monto: i.iva_monto, total: i.total,
        })),
      });
      cerrarModal();
      avisar('Venta ' + venta.numero + ' emitida');
      location.hash = '#/venta/' + venta.id;
    } catch (e) {
      avisar(e.message, 'error');
      btnModal.disabled = false;
      btnModal.textContent = 'Confirmar y emitir';
      btn.disabled = false;
    }
  }

  /* ================= TICKET IMPRESO =================
     Se arma aparte del comprobante de pantalla: el papel térmico tiene
     una sola columna estrecha, así que la tabla no sirve. */

  const ANCHOS = [
    { id: '58', etiqueta: '58 mm', pagina: '58mm auto',  margen: '4mm' },
    { id: '80', etiqueta: '80 mm', pagina: '80mm auto',  margen: '4mm' },
    { id: 'a4', etiqueta: 'Hoja',  pagina: 'A4 portrait', margen: '14mm' },
  ];
  const CLAVE_ANCHO = 'inventario-ticket-ancho';

  function anchoGuardado() {
    try {
      const a = localStorage.getItem(CLAVE_ANCHO);
      if (a && ANCHOS.some(x => x.id === a)) return a;
    } catch (e) { /* sin almacenamiento */ }
    const c = INV.comercio ? INV.comercio.actual() : {};
    return String(c.ticket_ancho || INV.config.TICKET_ANCHO || '80');
  }

  function fijarAncho(id) {
    const a = ANCHOS.find(x => x.id === id) || ANCHOS[1];
    try { localStorage.setItem(CLAVE_ANCHO, a.id); } catch (e) { /* sin almacenamiento */ }

    const caja = $('#ticket');
    if (caja) caja.dataset.ancho = a.id;

    // El tamaño de página no se puede cambiar con una clase: hay que
    // reescribir la regla @page antes de mandar a imprimir.
    const estilo = $('#estilo-pagina');
    if (estilo) estilo.textContent = `@page { size: ${a.pagina}; margin: ${a.margen}; }`;

    $$('#ancho-ticket button').forEach(b => b.classList.toggle('activo', b.dataset.ancho === a.id));
  }

  const guion = () => '<hr class="tk__regla">';

  function construirTicket(v) {
    const n = INV.comercio ? INV.comercio.actual() : (INV.config.NEGOCIO || {});
    const f = new Date(v.fecha);
    let qr = '';
    try { qr = INV.qr.svg(contenidoQR(v), { tamano: 108 }); } catch (e) { qr = ''; }

    return `
      <div class="tk">
        <div class="tk__centro">
          ${n.logo_url ? `<div class="tk__logo-caja"><img src="${esc(n.logo_url)}" class="tk__logo" alt="Logo"></div>` : ''}
          <p class="tk__seniat">SENIAT</p>
          ${n.nombre ? `<p class="tk__negocio">${esc(n.nombre)}</p>` : ''}
          ${n.rif ? `<p class="tk__sub">RIF ${esc(n.rif)}</p>` : ''}
          ${n.direccion ? `<p class="tk__sub">${esc(n.direccion)}</p>` : ''}
          ${n.telefono ? `<p class="tk__sub">Telf. ${esc(n.telefono)}</p>` : ''}
        </div>

        <hr class="tk__doble">
        <div class="tk__centro">
          ${v.anulada ? '<p class="tk__anulada">*** ANULADO ***</p>' : ''}
          <p class="tk__sub">COMPROBANTE DE VENTA</p>
          <p class="tk__numero">${esc(v.numero)}</p>
          <p class="tk__sub">${f.toLocaleDateString('es')} ${f.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        <hr class="tk__doble">

        <div class="tk__par"><span>Cliente</span><span>${esc(v.cliente || 'Consumidor final')}</span></div>
        ${v.documento_completo ? `<div class="tk__par"><span>Documento</span><span>${esc(v.documento_completo)}</span></div>` : ''}
        ${v.telefono ? `<div class="tk__par"><span>Teléfono</span><span>${esc(v.telefono)}</span></div>` : ''}
        ${v.direccion ? `<div class="tk__par"><span>Dirección</span><span>${esc(v.direccion)}</span></div>` : ''}

        ${guion()}

        ${v.items.map(i => `
          <div class="tk__item">
            <div class="tk__item-nombre">${esc(i.descripcion)}</div>
            <div class="tk__item-calculo">
              <span>${cantidad(i.cantidad)} x ${numero(i.precio_unitario)}</span>
              <span>${numero(i.total)}</span>
            </div>
          </div>`).join('')}

        ${guion()}

        <div class="tk__totales">
          ${(() => {
            const exentos = (v.items || []).filter(i => Number(i.iva_monto) === 0);
            if (!exentos.length || Number(v.iva_tasa) === 0) return '';
            const baseExenta = exentos.reduce((s, i) => s + Number(i.base), 0);
            return `
              <div class="tk__total-fila"><span>BASE IMPONIBLE</span><span>${
                numero(Number(v.subtotal) - baseExenta)}</span></div>
              <div class="tk__total-fila"><span>EXENTO</span><span>${numero(baseExenta)}</span></div>`;
          })()}
          <div class="tk__total-fila">
            <span>Subtotal${v.iva_incluido ? ' (base)' : ''}</span><span>${numero(v.subtotal)}</span>
          </div>
          <div class="tk__total-fila">
            <span>IVA ${numero(v.iva_tasa, Number(v.iva_tasa) % 1 ? 2 : 0)}%</span><span>${numero(v.iva_monto)}</span>
          </div>
          <hr class="tk__regla">
          <div class="tk__total-fila tk__total-fila--grande">
            <span>TOTAL FACTURA</span><span>${numero(v.total)}</span>
          </div>
          ${Number(v.retencion_iva_monto) > 0 ? `
            <div class="tk__total-fila"><span>RETENCION IVA (${numero(v.retencion_iva_porcentaje || 75, 0)}%)</span><span>-${numero(v.retencion_iva_monto)}</span></div>` : ''}
          ${Number(v.retencion_islr_monto) > 0 ? `
            <div class="tk__total-fila"><span>RETENCION ISLR (${numero(v.retencion_islr_porcentaje || 0, 0)}%)</span><span>-${numero(v.retencion_islr_monto)}</span></div>` : ''}
          ${(Number(v.retencion_iva_monto) > 0 || Number(v.retencion_islr_monto) > 0) ? `
            <div class="tk__total-fila tk__total-fila--grande"><span>NETO A COBRAR</span><span>${numero(v.monto_neto_cobrar || (Number(v.total) - Number(v.retencion_iva_monto || 0) - Number(v.retencion_islr_monto || 0)))}</span></div>` : ''}
          ${Number(v.tasa_referencia) > 0 ? `
            <div class="tk__total-fila"><span>TASA DEL DIA</span><span>${numero(v.tasa_referencia, 2)} Bs/$</span></div>
            <div class="tk__total-fila"><span>EQUIVALENTE</span><span>${numero(v.total_usd)} $</span></div>` : ''}
        </div>

        ${(v.pagos && v.pagos.length) ? `
          ${guion()}
          ${v.pagos.map(p => `
            <div class="tk__total-fila">
              <span>${esc(etiquetaPago(p))}</span><span>${numero(p.monto_local)}</span>
            </div>
            ${p.moneda !== 'VES' ? `<div class="tk__pie">  ${numero(p.monto)} ${esc(p.moneda)} x ${numero(p.tasa, 2)}</div>` : ''}
          `).join('')}
          ${(() => {
            const pend = (v.cuotas || []).filter(q => !q.pagada);
            if (v.a_credito || pend.length) {
              const usd = pend.reduce((s, q) => s + Number(q.monto_usd), 0);
              return pend.length
                ? `<div class="tk__total-fila"><span>POR COBRAR</span><span>${numero(usd)} USD</span></div>`
                : '<div class="tk__total-fila"><span>CREDITO CANCELADO</span><span>0,00</span></div>';
            }
            if (Number(v.saldo_pendiente) > 0.009)
              return `<div class="tk__total-fila"><span>PENDIENTE</span><span>${numero(v.saldo_pendiente)}</span></div>`;
            if (Number(v.saldo_pendiente) < -0.009)
              return `<div class="tk__total-fila"><span>VUELTO</span><span>${numero(-v.saldo_pendiente)}</span></div>`;
            return '';
          })()}
        ` : ''}

        ${v.nota ? `${guion()}<p class="tk__pie">${esc(v.nota)}</p>` : ''}

        ${(v.cuotas && v.cuotas.length) ? `
          ${guion()}
          <div class="tk__total-fila"><span>CUOTAS MIN. USD</span><span>ref ${numero(v.tasa_referencia, 2)}</span></div>
          ${v.cuotas.map(q => `
            <div class="tk__total-fila">
              <span>${q.pagada ? 'Pagada' : 'Vence'} ${new Date((q.pagada ? q.pagada_en : q.vence_en + 'T00:00:00')).toLocaleDateString('es')}</span>
              <span>${numero(q.monto_usd)} USD</span>
            </div>`).join('')}
        ` : ''}

        ${v.anulada ? `${guion()}<p class="tk__pie tk__centro">
          ANULADO: ${esc(nombreMotivo(v.motivo_anulacion))}<br>
          ${esc(new Date(v.anulada_en).toLocaleDateString('es'))}
          ${v.detalle_anulacion ? '<br>' + esc(v.detalle_anulacion) : ''}
        </p>` : ''}

        <div class="tk__centro">
          <div class="tk__qr">${qr}</div>
          <p class="tk__pie">${esc(v.numero)}</p>
          ${n.mensaje ? `<p class="tk__pie" style="margin-top:6px">${esc(n.mensaje)}</p>` : ''}
        </div>
      </div>`;
  }

  function imprimir() {
    if (!ventaActual) return;
    const caja = $('#ticket');
    if (!caja) return window.print();

    caja.innerHTML = construirTicket(ventaActual);
    fijarAncho(anchoGuardado());
    // El SVG del QR necesita un instante para quedar en el árbol antes de
    // que el navegador capture la página.
    setTimeout(() => window.print(), 60);
  }

  /* ================= COMPROBANTE ================= */

  let ventaActual = null;

  INV.vistas.venta = {
    railComo: 'ventas',
    titulo: () => ventaActual ? 'Comprobante ' + ventaActual.numero : 'Comprobante',
    eyebrow: () => 'Venta emitida',

    acciones: () => [
      { texto: 'Imprimir', estilo: 'btn--primario', alPulsar: imprimir },
      { texto: 'Compartir', estilo: 'btn--secundario', alPulsar: compartir },
      { texto: 'Ver QR', estilo: 'btn--secundario', alPulsar: mostrarQR },
      { texto: 'Anular', estilo: 'btn--secundario', permiso: 'ventas.anular',
        alPulsar: pedirAnulacion },
      { texto: 'Volver', estilo: 'btn--secundario', alPulsar: () => { location.hash = '#/ventas'; } },
    ],

    render: async (contenedor, param) => {
      contenedor.innerHTML = cargando();
      const v = await INV.db.ventas.obtener(param);

      if (!v) {
        contenedor.innerHTML = vacio('Comprobante no encontrado',
          'Puede que el enlace esté mal o que la venta se haya emitido en otro dispositivo.',
          '<a class="btn btn--primario" href="#/ventas">Ver ventas</a>');
        return;
      }

      ventaActual = v;
      $('#vista-titulo').textContent = 'Comprobante ' + v.numero;

      let qr = '';
      try { qr = INV.qr.svg(contenidoQR(v), { tamano: 132 }); }
      catch (e) { qr = '<p class="subida__nota">No se pudo generar el QR</p>'; }

      contenedor.innerHTML = `
        ${v.anulada ? `
          <div class="anulada-aviso anim">
            <div>
              <b>Comprobante anulado</b>
              <p>${esc(nombreMotivo(v.motivo_anulacion))}${v.detalle_anulacion ? ' — ' + esc(v.detalle_anulacion) : ''}</p>
              <p class="lista__sub">${fecha(v.anulada_en)}${v.anulada_por_correo ? ' · ' + esc(v.anulada_por_correo) : ''}
                · los productos volvieron al inventario</p>
            </div>
          </div>` : ''}

        <div class="ficha anim comprobante ${v.anulada ? 'comprobante--anulada' : ''}" style="--i:0">
          <div class="comprobante__cabecera">
            <div>
              <p class="eyebrow">Comprobante de venta</p>
              <h2 class="comprobante__numero">${esc(v.numero)}</h2>
              <p class="comprobante__fecha">${fecha(v.fecha)}</p>
            </div>
            <div class="comprobante__qr">
              ${qr}
              <span class="subida__nota">Escanea para ver esta venta</span>
            </div>
          </div>

          <div class="datos">
            <div class="datos__celda" style="grid-column:span 2">
              <div class="datos__etiqueta">Cliente</div>
              <div class="datos__valor" style="font-size:15px">${esc(v.cliente || 'Consumidor final')}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Documento fiscal</div>
              <div class="datos__valor">${esc(v.documento_completo ?? '—')}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Contacto</div>
              <div class="datos__valor" style="font-size:14px">${esc(v.telefono ?? '—')}</div>
            </div>
            <div class="datos__celda" style="grid-column:1 / -1">
              <div class="datos__etiqueta">Dirección</div>
              <div class="datos__valor" style="font-size:13px; font-weight:400">${esc(v.direccion ?? 'No registrada')}</div>
            </div>
          </div>

          <table class="renglones">
            <thead><tr>
              <th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio</th>
              <th class="num">Base</th><th class="num">IVA</th><th class="num">Total</th>
            </tr></thead>
            <tbody>${v.items.map(i => `
              <tr>
                <td>${esc(i.descripcion)}${Number(i.iva_monto) === 0 && Number(v.iva_tasa) > 0
                ? ' <span class="pastilla pastilla--exento">exento</span>' : ''}</td>
                <td class="num">${cantidad(i.cantidad)}</td>
                <td class="num">${numero(i.precio_unitario)}</td>
                <td class="num">${numero(i.base)}</td>
                <td class="num">${numero(i.iva_monto)}</td>
                <td class="num">${numero(i.total)}</td>
              </tr>`).join('')}
            </tbody>
          </table>

          <div class="totales">
            ${(() => {
              /* La exención se deduce de los renglones ya emitidos: un
                 renglón sin IVA en una venta con IVA es un exento. */
              const exentos = (v.items || []).filter(i => Number(i.iva_monto) === 0);
              if (!exentos.length || Number(v.iva_tasa) === 0) return '';
              const baseExenta = exentos.reduce((s, i) => s + Number(i.base), 0);
              return `
                <div class="totales__fila">
                  <span>Base imponible</span><b>${numero(Number(v.subtotal) - baseExenta)}</b></div>
                <div class="totales__fila" style="color:var(--esmeralda)">
                  <span>Exento de IVA</span><b>${numero(baseExenta)}</b></div>`;
            })()}
            <div class="totales__fila">
              <span>Subtotal de los productos${v.iva_incluido ? ' (IVA desglosado)' : ''}</span>
              <b>${numero(v.subtotal)}</b>
            </div>
            <div class="totales__fila">
              <span>IVA ${numero(v.iva_tasa, Number(v.iva_tasa) % 1 ? 2 : 0)}%</span>
              <b>${numero(v.iva_monto)}</b>
            </div>
            <div class="totales__fila totales__fila--total">
              <span>Total factura</span>
              <b>${numero(v.total)}</b>
            </div>
            ${Number(v.retencion_iva_monto) > 0 ? `
              <div class="totales__fila" style="color:var(--naranja)">
                <span>(-) Retención IVA ${numero(v.retencion_iva_porcentaje || 75, 0)}%</span>
                <b>-${numero(v.retencion_iva_monto)}</b>
              </div>` : ''}
            ${Number(v.retencion_islr_monto) > 0 ? `
              <div class="totales__fila" style="color:var(--naranja)">
                <span>(-) Retención ISLR ${numero(v.retencion_islr_porcentaje || 0, 0)}%</span>
                <b>-${numero(v.retencion_islr_monto)}</b>
              </div>` : ''}
            ${(Number(v.retencion_iva_monto) > 0 || Number(v.retencion_islr_monto) > 0) ? `
              <div class="totales__fila totales__fila--total" style="color:var(--esmeralda)">
                <span>Neto a percibir en dinero</span>
                <b>${numero(v.monto_neto_cobrar || (Number(v.total) - Number(v.retencion_iva_monto || 0) - Number(v.retencion_islr_monto || 0)))}</b>
              </div>` : ''}
            ${Number(v.tasa_referencia) > 0 ? `
              <div class="totales__fila" style="color:var(--cian)">
                <span>Equivalente · tasa ${numero(v.tasa_referencia, 2)} Bs/$</span>
                <b>${numero(v.total_usd || (v.total / v.tasa_referencia))} $</b>
              </div>` : ''}
            ${Number(v.recargo_credito) > 0 ? `
              <div class="totales__fila" style="color:var(--naranja)">
                <span>Recargo por financiamiento · ${numero(v.recargo_credito, 1)}%</span>
                <b>incluido en las cuotas</b>
              </div>` : ''}
          </div>

          ${(v.pagos && v.pagos.length) ? `
            <div class="ficha__pie">
              <div class="datos__etiqueta" style="margin-bottom:8px">Forma de pago</div>
              ${v.pagos.map(p => `
                <div class="confirmar-fila">
                  <span>${esc(etiquetaPago(p))}${p.moneda !== 'VES'
                    ? `<br><span class="lista__sub">${numero(p.monto)} ${esc(p.moneda)} × ${numero(p.tasa, 2)}</span>` : ''}</span>
                  <b>${numero(p.monto_local)}</b>
                </div>`).join('')}
              ${(() => {
                const pendientes = (v.cuotas || []).filter(q => !q.pagada);
                if (v.a_credito || pendientes.length) {
                  const usd = pendientes.reduce((s, q) => s + Number(q.monto_usd), 0);
                  return pendientes.length ? `
                    <div class="confirmar-fila" style="color:var(--naranja)">
                      <span>Por cobrar en ${pendientes.length} cuota${pendientes.length > 1 ? 's' : ''}</span>
                      <b>${numero(usd)} USD</b></div>`
                    : `<div class="confirmar-fila" style="color:var(--esmeralda)">
                      <span>Crédito cancelado</span><b>0,00 USD</b></div>`;
                }
                if (Number(v.saldo_pendiente) > 0.009) return `
                  <div class="confirmar-fila" style="color:var(--naranja)">
                    <span>Pendiente por cobrar</span><b>${numero(v.saldo_pendiente)}</b></div>`;
                if (Number(v.saldo_pendiente) < -0.009) return `
                  <div class="confirmar-fila" style="color:var(--violeta)">
                    <span>Vuelto entregado</span><b>${numero(-v.saldo_pendiente)}</b></div>`;
                return '';
              })()}
            </div>` : ''}

          ${(v.cuotas && v.cuotas.length) ? `
            <div class="ficha__pie">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:8px">
                <div class="datos__etiqueta" style="margin:0">Plan de cuotas</div>
                <span class="lista__sub">referencia ${numero(v.tasa_referencia, 2)} Bs/USD · total ${numero(v.total_usd)} USD</span>
              </div>
              ${v.cuotas.map(q => `
                <div class="confirmar-fila">
                  <span>Cuota ${q.numero} de ${v.cuotas.length}
                    <span class="lista__sub">${q.pagada
                      ? 'pagada el ' + new Date(q.pagada_en).toLocaleDateString('es')
                      : 'mínimo a abonar · vence el ' + new Date(q.vence_en + 'T00:00:00').toLocaleDateString('es')}</span></span>
                  <b class="${q.pagada ? 'pos' : ''}">${numero(q.monto_usd)} USD</b>
                </div>`).join('')}
            </div>` : ''}

          ${v.nota ? `<div class="ficha__pie"><div class="datos__etiqueta">Nota</div>
            <div style="font-size:14px; margin-top:4px">${esc(v.nota)}</div></div>` : ''}

          <div class="ficha__pie ancho-ticket">
            <span class="datos__etiqueta" style="margin:0">Formato de impresión</span>
            <div class="chips" id="ancho-ticket">
              ${ANCHOS.map(a => `<button data-ancho="${a.id}">${a.etiqueta}</button>`).join('')}
            </div>
            <span class="subida__nota">rollo térmico o página completa</span>
          </div>

          <div class="comprobante__pie">
            Los productos de este comprobante salieron del inventario con la
            referencia ${esc(v.numero)} y quedan registrados en el kardex.
          </div>
        </div>`;

      // El ticket queda armado desde ya: si el usuario imprime con Ctrl+P
      // en vez del botón, sale igual el comprobante y no la pantalla.
      // La barra de acciones se arma antes de saber si esta venta ya estaba
      // anulada, así que aquí se retira el botón que ya no aplica.
      if (v.anulada) {
        const b = $$('#vista-acciones button').find(x => x.textContent === 'Anular');
        if (b) b.remove();
      }

      const caja = $('#ticket');
      if (caja) caja.innerHTML = construirTicket(v);
      fijarAncho(anchoGuardado());

      $$('#ancho-ticket button').forEach(b => b.addEventListener('click', () => fijarAncho(b.dataset.ancho)));
    },
  };

  /* Resumen en texto plano: es lo que viaja por WhatsApp o Telegram, así
     que tiene que entenderse sin abrir ningún enlace. */
  function mensajeVenta(v) {
    const c = INV.comercio ? INV.comercio.actual() : {};
    const lineas = [];
    if (c.nombre) lineas.push('*' + c.nombre + '*');
    if (c.rif) lineas.push('RIF ' + c.rif);
    lineas.push('');
    lineas.push('Comprobante ' + v.numero);
    lineas.push(fecha(v.fecha));
    lineas.push('Cliente: ' + (v.cliente || 'Consumidor final'));
    if (v.documento_completo) lineas.push('Documento: ' + v.documento_completo);
    lineas.push('');
    v.items.forEach(i => lineas.push(
      `${cantidad(i.cantidad)} x ${esc(i.descripcion)} — ${numero(i.total)}`));
    lineas.push('');
    lineas.push('Subtotal: ' + numero(v.subtotal));
    lineas.push(`IVA ${numero(v.iva_tasa, Number(v.iva_tasa) % 1 ? 2 : 0)}%: ` + numero(v.iva_monto));
    lineas.push('TOTAL: ' + numero(v.total));
    if (v.pagos && v.pagos.length) {
      lineas.push('');
      v.pagos.forEach(p => lineas.push(etiquetaPago(p) + ': ' + numero(p.monto_local)));
      if (Number(v.saldo_pendiente) > 0.009)
        lineas.push('Pendiente: ' + numero(v.saldo_pendiente));
    }
    if (v.cuotas && v.cuotas.length) {
      lineas.push('');
      lineas.push('Cuotas pendientes (mínimo por cuota, referencia en USD):');
      v.cuotas.filter(q => !q.pagada).forEach(q => lineas.push(
        `Cuota ${q.numero}: mínimo ${numero(q.monto_usd)} USD — vence ${new Date(q.vence_en + 'T00:00:00').toLocaleDateString('es')}`));
    }
    if (location.protocol !== 'file:') {
      lineas.push('');
      lineas.push(location.origin + location.pathname + '#/venta/' + v.id);
    }
    if (c.mensaje) { lineas.push(''); lineas.push(c.mensaje); }
    // El mensaje va como texto plano: se quitan los escapes de HTML.
    return lineas.join('\n').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
                 .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  /* Solo dígitos, con el prefijo del país: es lo que espera wa.me. */
  function telefonoWhatsApp(bruto) {
    if (!bruto) return '';
    let n = String(bruto).replace(/\D/g, '');
    if (!n) return '';
    if (n.startsWith('58')) return n;
    if (n.startsWith('0')) return '58' + n.slice(1);   // 0414… → 58414…
    if (n.length === 10) return '58' + n;
    return n;
  }

  function compartir() {
    const v = ventaActual;
    if (!v) return;

    const texto = mensajeVenta(v);
    const enlace = location.protocol !== 'file:'
      ? location.origin + location.pathname + '#/venta/' + v.id : '';
    const tel = telefonoWhatsApp(v.telefono);

    const wa = 'https://wa.me/' + (tel ? tel : '') + '?text=' + encodeURIComponent(texto);
    const tg = 'https://t.me/share/url?url=' + encodeURIComponent(enlace || texto) +
               '&text=' + encodeURIComponent(texto);

    abrirModal({
      titulo: 'Compartir ' + v.numero,
      cuerpo: `
        <div class="compartir">
          <a class="compartir__opcion" href="${wa}" target="_blank" rel="noopener">
            <span class="compartir__icono compartir__icono--wa">WA</span>
            <span>
              <b>WhatsApp</b>
              <span class="lista__sub">${tel
                ? 'Se abre el chat con ' + esc(v.telefono)
                : 'Elige el contacto al abrir'}</span>
            </span>
          </a>
          <a class="compartir__opcion" href="${tg}" target="_blank" rel="noopener">
            <span class="compartir__icono compartir__icono--tg">TG</span>
            <span>
              <b>Telegram</b>
              <span class="lista__sub">Elige el chat al abrir</span>
            </span>
          </a>
          <button class="compartir__opcion" id="cp-copiar">
            <span class="compartir__icono compartir__icono--cp">TX</span>
            <span>
              <b>Copiar el texto</b>
              <span class="lista__sub">para pegarlo donde quieras</span>
            </span>
          </button>
        </div>

        <div class="datos__etiqueta" style="margin-top:18px">Lo que se envía</div>
        <pre class="compartir__previa">${esc(texto)}</pre>
        ${enlace ? '' : `<p class="subida__nota" style="margin-top:10px">
          Abierta como archivo local no hay enlace que compartir: va solo el resumen.
          Publicada en el servidor se añade la dirección del comprobante.</p>`}`,
      acciones: [{ texto: 'Cerrar', estilo: 'btn--primario', alPulsar: cerrarModal }],
    });

    $('#cp-copiar').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(texto);
        avisar('Texto copiado');
      } catch (e) {
        avisar('El navegador no permitió copiar; selecciona el texto a mano', 'error');
      }
    });
  }

  function pedirAnulacion() {
    const v = ventaActual;
    if (!v) return;
    if (v.anulada) return avisar('Este comprobante ya está anulado', 'error');

    abrirModal({
      titulo: 'Anular ' + v.numero,
      cuerpo: `
        <p style="margin:0 0 16px; font-size:14px; color:var(--tinta-2)">
          El comprobante no se borra: queda archivado y marcado como anulado.
          Los ${v.items.length} renglones vuelven al inventario como entradas,
          por un total de <b>${numero(v.total)}</b>.
        </p>

        <div class="campo">
          <label>Motivo de la anulación</label>
          <div class="roles">
            ${MOTIVOS.map((m, i) => `
              <label class="rol-opcion">
                <input type="radio" name="an-motivo" value="${m.id}" ${i === 0 ? 'checked' : ''}>
                <span>
                  <b>${esc(m.etiqueta)}</b>
                  <span class="lista__sub">${esc(m.ayuda)}</span>
                </span>
              </label>`).join('')}
          </div>
        </div>

        <div class="campo">
          <label for="an-detalle">Explicación</label>
          <textarea id="an-detalle" rows="3"
            placeholder="Qué pasó exactamente. Queda archivado con la anulación."></textarea>
        </div>

        <div class="campo" style="margin:0">
          <label for="an-confirmar">Escribe <b>${esc(v.numero)}</b> para confirmar</label>
          <input id="an-confirmar" type="text" placeholder="${esc(v.numero)}" autocomplete="off">
        </div>

        <p id="an-error" class="error" hidden></p>`,
      acciones: [
        { texto: 'Cancelar', alPulsar: cerrarModal },
        { texto: 'Anular comprobante', estilo: 'btn--primario', alPulsar: btn => anular(btn) },
      ],
    });
  }

  async function anular(btn) {
    const v = ventaActual;
    const err = $('#an-error');
    const marcado = $$('input[name="an-motivo"]').find(r => r.checked);
    const motivo = marcado ? marcado.value : 'otro';
    const detalle = $('#an-detalle').value.trim();

    const fallar = t => { err.textContent = t; err.hidden = false; };

    if (motivo === 'otro' && !detalle)
      return fallar('Al elegir "Otro motivo" hay que escribir la explicación.');
    // Teclear el número evita anular el comprobante equivocado por inercia.
    if ($('#an-confirmar').value.trim().toUpperCase() !== v.numero.toUpperCase())
      return fallar('Escribe ' + v.numero + ' para confirmar la anulación.');

    btn.disabled = true;
    btn.textContent = 'Anulando…';
    try {
      const correo = ($('#usuario-correo').textContent || '').trim() || null;
      await INV.db.ventas.anular(v.id, motivo, detalle, correo);
      cerrarModal();
      avisar('Comprobante ' + v.numero + ' anulado');
      window.dispatchEvent(new Event('recargar-vista'));
    } catch (e) {
      fallar(e.message);
      btn.disabled = false;
      btn.textContent = 'Anular comprobante';
    }
  }

  function mostrarQR() {
    if (!ventaActual) return;
    const contenido = contenidoQR(ventaActual);
    abrirModal({
      titulo: 'Código QR de ' + ventaActual.numero,
      cuerpo: `
        <div style="display:grid; place-items:center; gap:14px; text-align:center">
          ${INV.qr.svg(contenido, { tamano: 232 })}
          <p class="subida__nota" style="word-break:break-all">${esc(contenido)}</p>
          <p style="font-size:13px; color:var(--tinta-2); margin:0">
            ${location.protocol === 'file:'
              ? 'Abierta como archivo local no hay dirección que compartir, así que el QR lleva el resumen de la venta. Publicada en el servidor, apuntará a este comprobante.'
              : 'Al escanearlo se abre este mismo comprobante.'}
          </p>
        </div>`,
      acciones: [{ texto: 'Cerrar', estilo: 'btn--primario', alPulsar: cerrarModal }],
    });
  }
})();
