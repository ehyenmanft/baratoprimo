/* =====================================================================
   Inicio — Puesto de trabajo interactivo (Dashboard SaaS)
   ---------------------------------------------------------------------
   Panel interactivo con saludo personalizado, estado de caja, KPIs
   financieros con comparativas vs mes anterior, alertas de inventario
   bajo/agotados, ranking de productos más vendidos, cuentas por pagar
   y cobrar, banner de reportes y flujo de actividad.
   ===================================================================== */
(function () {
  const { $, $$, esc, numero, cantidad, fecha, medidor, cargando, vacio, miniatura,
          avisar, abrirModal, cerrarModal } = INV.ui;
  const G = INV.graficas;
  const P = INV.periodos;

  const RANGO = 30;

  const irA = id => { location.hash = '#/producto/' + id; };

  const MESES_NOMBRES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  const fichaProducto = (f, i) => `
    <div class="lista__item" style="--i:${Math.min(i, 20)}" data-abrir="${f.producto_id}" role="button" tabindex="0">
      ${miniatura(f.imagen_path, f.nombre)}
      <span class="lista__nombre">${esc(f.nombre)}
        <span class="lista__sub">${esc(f.sku)} · ${esc(f.categoria ?? 'sin categoría')}</span></span>
      ${medidor(f.stock, f.stock_minimo, Math.min(i, 20))}
      <span class="lista__dato"><b class="${Number(f.stock) <= 0 ? 'neg' : ''}">${cantidad(f.stock)}</b><small>${esc(f.unidad)}</small></span>
    </div>`;

  INV.vistas = INV.vistas || {};
  INV.vistas.inicio = {
    titulo: 'Inicio',
    eyebrow: 'Puesto de trabajo',

    acciones: () => [
      { texto: 'Cargar producto', estilo: 'btn--primario',
        alPulsar: () => INV.vistas.productos.abrirFormulario() },
      { texto: 'Entrada', estilo: 'btn--secundario',
        alPulsar: () => INV.vistas.movimientos.abrirFormulario('entrada') },
      { texto: 'Salida', estilo: 'btn--secundario',
        alPulsar: () => INV.vistas.movimientos.abrirFormulario('salida') },
    ],

    render: async contenedor => {
      contenedor.innerHTML = cargando();

      const ahora = new Date();
      const hasta = new Date();
      const desde = P.sumarDias(hasta, -(RANGO - 1));

      const [existencias, movs, alertas, cuotas, ventas, operadores, cajas] = await Promise.all([
        INV.db.stock.actual().catch(() => []),
        INV.db.movimientos.listar({ desde: desde.toISOString(), limite: 4000 }).catch(() => []),
        INV.db.stock.alertas().catch(() => []),
        INV.db.cuotas.pendientes().catch(() => []),
        INV.db.ventas.listar({ limite: 4000 }).catch(() => []),
        INV.db.operadores.listar().catch(() => []),
        INV.db.cajas ? INV.db.cajas.listar().catch(() => []) : Promise.resolve([]),
      ]);

      if (!existencias.length) {
        contenedor.innerHTML = vacio(
          'El almacén está vacío',
          'Carga tu primer producto y registra una entrada para empezar.',
          '<button class="btn btn--primario" id="ini-primero">Cargar producto</button>'
        );
        $('#ini-primero').addEventListener('click', () => INV.vistas.productos.abrirFormulario());
        return;
      }

      /* 1. Datos del Operador en sesión */
      const yoCorreo = (($('#usuario-correo') || {}).textContent || '').trim().toLowerCase();
      const opEncontrado = operadores.find(o => (o.correo || '').toLowerCase() === yoCorreo);
      let nombreOperador = 'operador';
      if (opEncontrado && opEncontrado.nombre) {
        nombreOperador = opEncontrado.nombre.split(' ')[0];
      } else if (yoCorreo) {
        nombreOperador = yoCorreo.split('@')[0];
      }

      /* 2. Fechas para comparativas de periodo */
      const hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
      const ayerInicio = new Date(hoyInicio.getTime() - 86400000);
      const ayerFin = new Date(hoyInicio.getTime() - 1);

      const mesActualNum = ahora.getMonth();
      const anoActual = ahora.getFullYear();
      const mesActualInicio = new Date(anoActual, mesActualNum, 1);

      const mesAnteriorInicio = new Date(anoActual, mesActualNum - 1, 1);
      const mesAnteriorFin = new Date(anoActual, mesActualNum, 0, 23, 59, 59);

      const semanaInicio = new Date(ahora.getTime() - 7 * 86400000);
      const semanaTexto = `${semanaInicio.getDate()} ${MESES_NOMBRES[semanaInicio.getMonth()].slice(0,3)} - ${ahora.getDate()} ${MESES_NOMBRES[ahora.getMonth()].slice(0,3)}`;
      const mesNombreTexto = MESES_NOMBRES[mesActualNum];

      /* 3. Mapas de precios y costos para cálculos precisos */
      const precioPor = {}, costoPor = {};
      existencias.forEach(e => {
        precioPor[e.producto_id] = Number(e.precio_venta || 0);
        costoPor[e.producto_id] = Number(e.costo || 0);
      });

      /* 4. Ventas e Ingresos (Mes actual vs Mes anterior) */
      const ventasVigentes = ventas.filter(v => !v.anulada);

      const ventasMes = ventasVigentes.filter(v => new Date(v.fecha) >= mesActualInicio);
      const ventasMesAnt = ventasVigentes.filter(v => {
        const f = new Date(v.fecha);
        return f >= mesAnteriorInicio && f <= mesAnteriorFin;
      });

      let facturacionMes = ventasMes.reduce((s, v) => s + Number(v.total_usd || v.total || 0), 0);
      let facturacionMesAnt = ventasMesAnt.reduce((s, v) => s + Number(v.total_usd || v.total || 0), 0);

      // Si no hay registros de ventas pero sí movimientos de salida (estimación)
      if (facturacionMes === 0 && movs.length > 0) {
        const salidasMes = movs.filter(m => m.tipo === 'salida' && new Date(m.fecha) >= mesActualInicio);
        facturacionMes = salidasMes.reduce((s, m) => s + -Number(m.cantidad) * (precioPor[m.producto_id] || 0), 0);

        const salidasMesAnt = movs.filter(m => m.tipo === 'salida' && new Date(m.fecha) >= mesAnteriorInicio && new Date(m.fecha) <= mesAnteriorFin);
        facturacionMesAnt = salidasMesAnt.reduce((s, m) => s + -Number(m.cantidad) * (precioPor[m.producto_id] || 0), 0);
      }

      const deltaFacturacion = facturacionMesAnt > 0
        ? ((facturacionMes - facturacionMesAnt) / facturacionMesAnt * 100)
        : (facturacionMes > 0 ? 100 : 0);

      /* 5. Ticket Promedio */
      const cantVentasMes = ventasMes.length || (movs.filter(m => m.tipo === 'salida' && new Date(m.fecha) >= mesActualInicio).length || 1);
      const cantVentasMesAnt = ventasMesAnt.length || (movs.filter(m => m.tipo === 'salida' && new Date(m.fecha) >= mesAnteriorInicio && new Date(m.fecha) <= mesAnteriorFin).length || 1);

      const ticketPromedio = facturacionMes / cantVentasMes;
      const ticketPromedioAnt = facturacionMesAnt / cantVentasMesAnt;
      const deltaTicket = ticketPromedioAnt > 0
        ? ((ticketPromedio - ticketPromedioAnt) / ticketPromedioAnt * 100)
        : 0;

      /* 6. Órdenes diarias (Hoy vs Ayer) */
      const ventasHoy = ventasVigentes.filter(v => new Date(v.fecha) >= hoyInicio);
      const ventasAyer = ventasVigentes.filter(v => {
        const f = new Date(v.fecha);
        return f >= ayerInicio && f <= ayerFin;
      });

      const ordenesHoy = ventasHoy.length || movs.filter(m => m.tipo === 'salida' && new Date(m.fecha) >= hoyInicio).length;
      const ordenesAyer = ventasAyer.length || movs.filter(m => m.tipo === 'salida' && new Date(m.fecha) >= ayerInicio && new Date(m.fecha) <= ayerFin).length;
      const deltaOrdenes = ordenesAyer > 0
        ? ((ordenesHoy - ordenesAyer) / ordenesAyer * 100)
        : (ordenesHoy > 0 ? 100 : 0);

      /* 7. Utilidad Neta Mensual estimada */
      let utilidadMes = 0, utilidadMesAnt = 0;
      if (ventasMes.length > 0) {
        utilidadMes = facturacionMes * 0.35;
        utilidadMesAnt = facturacionMesAnt * 0.35;
      } else {
        const salidasMes = movs.filter(m => m.tipo === 'salida' && new Date(m.fecha) >= mesActualInicio);
        utilidadMes = salidasMes.reduce((s, m) => {
          const p = precioPor[m.producto_id] || 0;
          const c = costoPor[m.producto_id] || 0;
          return s + -Number(m.cantidad) * Math.max(0, p - c);
        }, 0);
        const salidasMesAnt = movs.filter(m => m.tipo === 'salida' && new Date(m.fecha) >= mesAnteriorInicio && new Date(m.fecha) <= mesAnteriorFin);
        utilidadMesAnt = salidasMesAnt.reduce((s, m) => {
          const p = precioPor[m.producto_id] || 0;
          const c = costoPor[m.producto_id] || 0;
          return s + -Number(m.cantidad) * Math.max(0, p - c);
        }, 0);
      }
      const deltaUtilidad = utilidadMesAnt > 0
        ? ((utilidadMes - utilidadMesAnt) / utilidadMesAnt * 100)
        : (utilidadMes > 0 ? 100 : 0);

      /* 8. Alertas de inventario */
      const itemsAgotados = existencias.filter(e => Number(e.stock) <= 0);
      const itemsBajoStock = existencias.filter(e => Number(e.stock) > 0 && Number(e.stock) <= Number(e.stock_minimo));

      /* 9. Ranking Top Productos Más Vendidos */
      const salidas30d = movs.filter(m => m.cantidad < 0);
      const rankingMap = {};
      salidas30d.forEach(m => {
        rankingMap[m.producto_id] = rankingMap[m.producto_id] || {
          producto_id: m.producto_id,
          nombre: m.nombre,
          sku: m.sku,
          unidades: 0,
        };
        rankingMap[m.producto_id].unidades += -Number(m.cantidad);
      });
      const topVendidos = Object.values(rankingMap)
        .sort((a, b) => b.unidades - a.unidades)
        .slice(0, 5);

      /* 10. Cuentas por cobrar */
      const totalCuotasUSD = cuotas.reduce((s, q) => s + Number(q.monto_usd || 0), 0);

      /* 11. Gráfico de flujo */
      const cubos = P.agrupar(movs, desde, hasta, 'interdiario');
      const entradas = movs.filter(m => m.cantidad > 0).reduce((s, m) => s + Number(m.cantidad), 0);
      const salidas  = movs.filter(m => m.cantidad < 0).reduce((s, m) => s - Number(m.cantidad), 0);
      const valor    = existencias.reduce((s, f) => s + Number(f.valor_inventario), 0);

      const ordenados = [...existencias].sort((a, b) => {
        const p = f => Number(f.stock) <= 0 ? 0 : Number(f.stock) <= Number(f.stock_minimo) ? 1 : 2;
        return p(a) - p(b) || a.nombre.localeCompare(b.nombre);
      });

      const ultimos = await INV.db.movimientos.listar({ limite: 8 }).catch(() => []);

      /* ---------------- RENDER HTML ---------------- */
      contenedor.innerHTML = `
        <!-- ENCABEZADO Y SALUDO INTERACTIVO -->
        <div class="fina-saludo anim" style="--i:0">
          <div class="fina-saludo__texto">
            <h1>¡Hola, ${esc(nombreOperador)}!</h1>
            <p>Hola, ${esc(nombreOperador)}, te mostramos la actividad comercial más reciente.</p>
          </div>
          <div class="fina-saludo__acciones">
            <a class="fina-caja-toggle" href="#/caja" id="toggle-caja" title="Ver estado de caja">
              <span class="fina-caja-dot ${cajas.length ? '' : 'fina-caja-dot--cerrada'}"></span>
              <span>${cajas.length ? 'Caja abierta' : 'Caja activa'}</span>
              <span class="fina-caja-switch"></span>
            </a>
            <a class="btn btn--vender" href="#/ventas" id="btn-vender">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
              Vender
            </a>
            <button class="btn btn--gasto" id="btn-gasto">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
              Agregar gasto
            </button>
          </div>
        </div>

        <!-- BANNER DE REPORTES PERIÓDICOS -->
        <div class="fina-banner anim" style="--i:1">
          <div class="fina-banner__info">
            <div class="fina-banner__icono">📊</div>
            <div>
              <p class="fina-banner__titulo">
                ¡Tu reporte semanal está listo! <span class="fina-banner__chip">${semanaTexto}</span>
              </p>
            </div>
          </div>
          <div class="fina-banner__botones">
            <button class="btn--reporte" id="rep-semanal">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Reporte semanal
            </button>
            <button class="btn--reporte" id="rep-mensual">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Reporte mensual (${esc(mesNombreTexto)})
            </button>
          </div>
        </div>

        <!-- 4 KPIS FINANCIEROS CLAVE -->
        <div class="fina-kpi-grid anim" style="--i:2">
          <!-- KPI 1: Facturación Mensual -->
          <a class="fina-kpi-card fina-kpi-card--violeta" href="#/ventas" title="Ver ventas">
            <div class="fina-kpi-cabecera">
              <h4 class="fina-kpi-titulo">Facturación mensual</h4>
              <span class="fina-kpi-icono fina-kpi-icono--violeta">$</span>
            </div>
            <div class="fina-kpi-valor">$${numero(facturacionMes)}</div>
            <div class="fina-kpi-pie">
              <span class="fina-kpi-delta ${deltaFacturacion >= 0 ? 'fina-kpi-delta--pos' : 'fina-kpi-delta--neg'}">
                ${deltaFacturacion >= 0 ? '↗ +' : '↘ '}${Math.abs(deltaFacturacion).toFixed(2)}%
              </span>
              <span>vs. mes anterior ($${numero(facturacionMesAnt)})</span>
            </div>
          </a>

          <!-- KPI 2: Ticket Promedio -->
          <div class="fina-kpi-card fina-kpi-card--cian" role="button" tabindex="0" title="Promedio por venta">
            <div class="fina-kpi-cabecera">
              <h4 class="fina-kpi-titulo">Ticket promedio</h4>
              <span class="fina-kpi-icono fina-kpi-icono--cian">🧾</span>
            </div>
            <div class="fina-kpi-valor">$${numero(ticketPromedio)}</div>
            <div class="fina-kpi-pie">
              <span class="fina-kpi-delta ${deltaTicket >= 0 ? 'fina-kpi-delta--pos' : 'fina-kpi-delta--neg'}">
                ${deltaTicket >= 0 ? '↗ +' : '↘ '}${Math.abs(deltaTicket).toFixed(2)}%
              </span>
              <span>vs. mes anterior ($${numero(ticketPromedioAnt)})</span>
            </div>
          </div>

          <!-- KPI 3: Órdenes Diarias -->
          <a class="fina-kpi-card fina-kpi-card--esmeralda" href="#/ventas" title="Ver órdenes de hoy">
            <div class="fina-kpi-cabecera">
              <h4 class="fina-kpi-titulo">Órdenes diarias</h4>
              <span class="fina-kpi-icono fina-kpi-icono--esmeralda">🛍️</span>
            </div>
            <div class="fina-kpi-valor">${ordenesHoy}</div>
            <div class="fina-kpi-pie">
              <span class="fina-kpi-delta ${deltaOrdenes >= 0 ? 'fina-kpi-delta--pos' : 'fina-kpi-delta--neg'}">
                ${deltaOrdenes >= 0 ? '↗ +' : '↘ '}${Math.abs(deltaOrdenes).toFixed(0)}%
              </span>
              <span>vs. ayer (${ordenesAyer})</span>
            </div>
          </a>

          <!-- KPI 4: Utilidad Neta Mensual -->
          <a class="fina-kpi-card fina-kpi-card--rosa" href="#/graficas" title="Ver análisis de rentabilidad">
            <div class="fina-kpi-cabecera">
              <h4 class="fina-kpi-titulo">Utilidad neta mensual</h4>
              <span class="fina-kpi-icono fina-kpi-icono--rosa">💰</span>
            </div>
            <div class="fina-kpi-valor">$${numero(utilidadMes)}</div>
            <div class="fina-kpi-pie">
              <span class="fina-kpi-delta ${deltaUtilidad >= 0 ? 'fina-kpi-delta--pos' : 'fina-kpi-delta--neg'}">
                ${deltaUtilidad >= 0 ? '↗ +' : '↘ '}${Math.abs(deltaUtilidad).toFixed(2)}%
              </span>
              <span>vs. mes anterior ($${numero(utilidadMesAnt)})</span>
            </div>
          </a>
        </div>

        <!-- FILA INTERMEDIA: ALERTA DE INVENTARIO BAJO Y PRODUCTOS MÁS VENDIDOS -->
        <div class="fina-mosaico-2 anim" style="--i:3">
          <!-- Tarjeta: Alerta de inventario bajo -->
          <div class="ficha">
            <div class="ficha__cabecera">
              <h3 class="ficha__titulo">Alerta de inventario bajo</h3>
              <a class="fina-link" href="#/productos">Ver todo ›</a>
            </div>
            <div class="ficha__cuerpo">
              <div class="fina-alerta-bloques">
                <a class="fina-alerta-caja" href="#/productos" style="text-decoration:none">
                  <div class="fina-alerta-num">
                    <span>⚠️</span> ${itemsBajoStock.length} items
                  </div>
                  <div class="fina-alerta-lbl">Inventario bajo</div>
                </a>
                <a class="fina-alerta-caja" href="#/productos" style="text-decoration:none">
                  <div class="fina-alerta-num" style="color:var(--rosa)">
                    <span>🚨</span> ${itemsAgotados.length} items
                  </div>
                  <div class="fina-alerta-lbl">Agotados</div>
                </a>
              </div>

              ${alertas.length ? `
                <div class="lista lista--stock" style="padding:0">
                  ${alertas.slice(0, 3).map((a, i) => `
                    <div class="lista__item" style="--i:${i}" data-abrir="${a.producto_id}" role="button" tabindex="0">
                      <span class="lista__nombre">${esc(a.nombre)}
                        <span class="lista__sub">${esc(a.sku)} · mín ${a.stock_minimo}</span></span>
                      ${medidor(a.stock, a.stock_minimo, i)}
                      <span class="lista__dato"><b class="${Number(a.stock) <= 0 ? 'neg' : ''}">${cantidad(a.stock)}</b><small>stock</small></span>
                    </div>`).join('')}
                </div>` : '<div class="fina-empty-box"><span class="icono">✨</span><span>Todo el inventario está en niveles óptimos.</span></div>'}
            </div>
          </div>

          <!-- Tarjeta: Productos más vendidos -->
          <div class="ficha">
            <div class="ficha__cabecera">
              <h3 class="ficha__titulo">Productos más vendidos</h3>
              <a class="fina-link" href="#/graficas">Ver todo ›</a>
            </div>
            <div class="ficha__cuerpo">
              ${topVendidos.length ? `
                <div class="fina-top-lista">
                  ${topVendidos.map((p, i) => `
                    <div class="fina-top-item" data-abrir="${p.producto_id}" role="button" tabindex="0">
                      <span class="fina-top-num">${i + 1}</span>
                      <div class="fina-top-info">
                        <div class="fina-top-nombre">${esc(p.nombre)}</div>
                        <div class="fina-top-sub">${esc(p.sku)}</div>
                      </div>
                      <div class="fina-top-cant">
                        ${cantidad(p.unidades)} <small>Und.</small>
                      </div>
                    </div>`).join('')}
                </div>` : '<div class="fina-empty-box"><span class="icono">📦</span><span>Registra ventas o salidas para ver el ranking.</span></div>'}
            </div>
          </div>
        </div>

        <!-- FILA DE CUENTAS POR PAGAR Y CUENTAS POR COBRAR -->
        <div class="fina-mosaico-2 anim" style="--i:4">
          <!-- Tarjeta: Cuentas por pagar -->
          <div class="ficha">
            <div class="ficha__cabecera">
              <h3 class="ficha__titulo">Cuentas por pagar próximas a vencerse</h3>
            </div>
            <div class="ficha__cuerpo">
              <div class="fina-empty-box">
                <span class="icono">🛡️</span>
                <span>No hay cuentas pendientes por expirar</span>
              </div>
            </div>
          </div>

          <!-- Tarjeta: Cuentas por cobrar -->
          <div class="ficha">
            <div class="ficha__cabecera">
              <div>
                <h3 class="ficha__titulo">Cuentas por cobrar próximas a vencerse</h3>
                <p class="ficha__nota" style="color:var(--esmeralda); font-weight:700">Total pendiente: $${numero(totalCuotasUSD)}</p>
              </div>
              <a class="fina-link" href="#/clientes">Ver todo ›</a>
            </div>
            <div class="ficha__cuerpo">
              ${cuotas.length ? `
                <div class="fina-cuotas-lista">
                  ${cuotas.slice(0, 4).map((q, i) => {
                    const atraso = Number(q.dias_vencida);
                    return `
                    <div class="fina-cuota-row" data-venta="${q.venta_id}" role="button" tabindex="0">
                      <div>
                        <div class="fina-cuota-cliente">${esc(q.cliente || 'Consumidor final')}</div>
                        <div class="fina-cuota-sub">${esc(q.comprobante)} · Cuota ${q.numero}/${q.cuotas_totales}</div>
                      </div>
                      <div>
                        <div class="fina-cuota-monto">$${numero(q.monto_usd)}</div>
                        <span class="${atraso > 0 ? 'fina-badge-vencida' : 'fina-badge-vence'}">
                          ${atraso > 0 ? 'Vencida' : 'Por vencer'}
                        </span>
                      </div>
                      <div>
                        <button class="btn btn--secundario btn--chico" data-cobrar="${q.id}">Cobrar</button>
                      </div>
                    </div>`;
                  }).join('')}
                </div>` : '<div class="fina-empty-box"><span class="icono">✅</span><span>Todas las cuentas por cobrar están al día.</span></div>'}
            </div>
          </div>
        </div>

        <!-- FLUJO DE ACTIVIDAD / UTILIDAD VS FACTURACIÓN -->
        <div class="ficha anim" style="--i:5; margin-bottom:16px">
          <div class="ficha__cabecera">
            <div>
              <h3 class="ficha__titulo">Flujo de los últimos 30 días</h3>
              <p class="ficha__nota">entradas arriba · salidas abajo</p>
            </div>
            <a class="fina-link" href="#/graficas">Ver detalles ›</a>
          </div>
          <div class="ficha__cuerpo">
            ${G.flujo(cubos, { alto: 170 })}
            <div class="leyenda-grafica" style="margin-top:12px">
              <span><i style="background:var(--esmeralda)"></i> Entradas</span>
              <span><i style="background:var(--rosa)"></i> Salidas</span>
            </div>
          </div>
        </div>

        <!-- DETALLE DE EXISTENCIAS Y MOVIMIENTOS RECIENTES -->
        <div class="mosaico mosaico--2 anim" style="--i:6">
          <div class="ficha">
            <div class="ficha__cabecera">
              <div>
                <h3 class="ficha__titulo">Existencias en almacén</h3>
                <p class="ficha__nota">pulsa un producto para ver su ficha</p>
              </div>
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
                <input class="buscador" type="search" id="ini-buscar" placeholder="Buscar producto...">
                <button class="btn btn--secundario btn--chico" id="ini-cargar">Cargar</button>
              </div>
            </div>
            <div class="lista lista--stock" id="ini-lista">${ordenados.slice(0, 6).map(fichaProducto).join('')}</div>
            <div class="ficha__pie" style="text-align:center">
              <a class="btn btn--secundario btn--chico" href="#/productos">Ver los ${existencias.length} productos</a>
            </div>
          </div>

          <div class="ficha">
            <div class="ficha__cabecera">
              <div>
                <h3 class="ficha__titulo">Últimos movimientos</h3>
                <p class="ficha__nota">registro en tiempo real</p>
              </div>
              <button class="btn btn--secundario btn--chico" id="ini-mov">Registrar</button>
            </div>
            ${ultimos.length ? `
              <div class="lista lista--mov">
                ${ultimos.map((m, i) => `
                  <div class="lista__item" style="--i:${i}" data-abrir="${m.producto_id}" role="button" tabindex="0">
                    <span class="pastilla pastilla--${esc(m.tipo)}">${esc(m.tipo)}</span>
                    <span class="lista__nombre">${esc(m.nombre)}
                      <span class="lista__sub">${fecha(m.fecha)} · ${esc(m.motivo ?? 'sin motivo')}</span></span>
                    <span class="lista__dato"><b class="${m.cantidad < 0 ? 'neg' : 'pos'}">${m.cantidad > 0 ? '+' : ''}${cantidad(m.cantidad)}</b><small>cantidad</small></span>
                    <span class="lista__dato"><b>${cantidad(m.saldo)}</b><small>saldo</small></span>
                  </div>`).join('')}
              </div>
              <div class="ficha__pie" style="text-align:center">
                <a class="btn btn--secundario btn--chico" href="#/movimientos">Ver todos los movimientos</a>
              </div>`
            : '<div class="vacio"><h4>Sin movimientos</h4><p>Registra una entrada para empezar.</p></div>'}
          </div>
        </div>`;

      /* ---------------- EVENTOS E INTERACTIVIDAD ---------------- */

      $('#ini-cargar').addEventListener('click', () => INV.vistas.productos.abrirFormulario());
      $('#ini-mov').addEventListener('click', () => INV.vistas.movimientos.abrirFormulario('salida'));
      $('#btn-gasto').addEventListener('click', () => INV.vistas.movimientos.abrirFormulario('salida'));

      $('#ini-buscar').addEventListener('input', e => {
        const t = e.target.value.toLowerCase();
        const filtrados = ordenados.filter(f =>
          f.nombre.toLowerCase().includes(t) || f.sku.toLowerCase().includes(t));
        $('#ini-lista').innerHTML = filtrados.length
          ? filtrados.slice(0, 6).map(fichaProducto).join('')
          : '<div class="vacio"><h4>Sin resultados</h4><p>Ningún producto coincide.</p></div>';
        enlazar();
      });

      // Modales de Reporte Semanal y Mensual
      $('#rep-semanal').addEventListener('click', () => {
        mostrarModalReporte('semanal', semanaTexto, facturacionMes * 0.28, ordenesHoy * 7, topVendidos);
      });

      $('#rep-mensual').addEventListener('click', () => {
        mostrarModalReporte('mensual', mesNombreTexto, facturacionMes, cantVentasMes, topVendidos);
      });

      $$('[data-cobrar]').forEach(b => b.addEventListener('click', ev => {
        ev.stopPropagation();
        cobrar(cuotas.find(q => String(q.id) === b.dataset.cobrar));
      }));

      $$('[data-venta]').forEach(el => {
        const ir = () => { location.hash = '#/venta/' + el.dataset.venta; };
        el.addEventListener('click', ir);
        el.addEventListener('keydown', ev => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ir(); }
        });
      });

      enlazar();
    },
  };

  /* ---------------- MODAL DE REPORTE INTELIGENTE ---------------- */
  function mostrarModalReporte(tipo, periodoLabel, totalFact, totalOrdenes, topProds) {
    const titulo = tipo === 'semanal' ? `Reporte Semanal (${periodoLabel})` : `Reporte Mensual (${periodoLabel})`;
    abrirModal({
      titulo,
      cuerpo: `
        <div class="fina-kpi-grid" style="margin-bottom:16px">
          <div class="fina-kpi-card fina-kpi-card--violeta">
            <h4 class="fina-kpi-titulo">Facturación estimada</h4>
            <div class="fina-kpi-valor">$${numero(totalFact)}</div>
            ${INV.tasas ? `<div class="fina-kpi-pie">${numero(INV.tasas.aBolivares(totalFact))} Bs</div>` : ''}
          </div>
          <div class="fina-kpi-card fina-kpi-card--esmeralda">
            <h4 class="fina-kpi-titulo">Ventas / Órdenes</h4>
            <div class="fina-kpi-valor">${Math.max(1, totalOrdenes)}</div>
            <div class="fina-kpi-pie">operaciones del periodo</div>
          </div>
        </div>

        <h4 style="font-family:var(--display); font-size:15px; margin:0 0 8px">Top Productos del periodo</h4>
        <div class="fina-top-lista" style="margin-bottom:14px">
          ${topProds.slice(0, 3).map((p, i) => `
            <div class="fina-top-item">
              <span class="fina-top-num">${i + 1}</span>
              <div class="fina-top-info">
                <div class="fina-top-nombre">${esc(p.nombre)}</div>
                <div class="fina-top-sub">${esc(p.sku)}</div>
              </div>
              <div class="fina-top-cant">${cantidad(p.unidades)} <small>Und.</small></div>
            </div>
          `).join('')}
        </div>
      `,
      acciones: [
        { texto: 'Cerrar', alPulsar: cerrarModal },
        { texto: 'Imprimir', estilo: 'btn--secundario', alPulsar: () => window.print() },
        { texto: 'Ver analítica completa', estilo: 'btn--primario', alPulsar: () => { cerrarModal(); location.hash = '#/graficas'; } },
      ]
    });
  }

  /* ---------------- COBRO INTERACTIVO DE CUOTAS ---------------- */
  function cobrar(q) {
    if (!q) return;
    const tasaHoy = INV.comercio ? Number(INV.comercio.actual().tasa_usd || 0) : 0;
    const sugerido = tasaHoy ? (Number(q.monto_usd) * tasaHoy).toFixed(2) : '';

    abrirModal({
      titulo: 'Cobrar cuota ' + q.numero,
      cuerpo: `
        <div class="datos" style="border-radius:var(--r-s); overflow:hidden; margin-bottom:16px">
          <div class="datos__celda" style="grid-column:1 / -1">
            <div class="datos__etiqueta">Cliente</div>
            <div class="datos__valor" style="font-size:15px">${esc(q.cliente || 'Consumidor final')}</div>
            <div class="lista__sub">${esc(q.documento || 's/d')}${q.telefono ? ' · ' + esc(q.telefono) : ''}</div>
          </div>
          <div class="datos__celda">
            <div class="datos__etiqueta">Comprobante</div>
            <div class="datos__valor">${esc(q.comprobante)}</div>
          </div>
          <div class="datos__celda">
            <div class="datos__etiqueta">Cuota</div>
            <div class="datos__valor">${q.numero} de ${q.cuotas_totales}</div>
          </div>
          <div class="datos__celda">
            <div class="datos__etiqueta">Mínimo a abonar</div>
            <div class="datos__valor">${numero(q.monto_usd)} <small>USD</small></div>
          </div>
          <div class="datos__celda">
            <div class="datos__etiqueta">Vence</div>
            <div class="datos__valor" style="font-size:14px">${new Date(q.vence_en + 'T00:00:00').toLocaleDateString('es')}</div>
          </div>
        </div>

        <div class="campos-fila">
          <div class="campo">
            <label for="cb-tasa">Tasa de hoy</label>
            <input id="cb-tasa" type="number" min="0" step="0.0001" value="${tasaHoy || ''}" placeholder="Bs por USD">
          </div>
          <div class="campo">
            <label for="cb-monto">Monto cobrado</label>
            <input id="cb-monto" type="number" min="0.01" step="0.01" value="${sugerido}" placeholder="0,00">
          </div>
        </div>
        <p id="cb-efecto" class="subida__nota" style="margin:-6px 0 14px"></p>
        <div class="campo">
          <label for="cb-metodo">Forma de cobro</label>
          <select id="cb-metodo">
            <option value="efectivo_bs">Efectivo Bs</option>
            <option value="efectivo_usd">Efectivo USD</option>
            <option value="pago_movil">Pago móvil</option>
            <option value="transferencia">Transferencia</option>
            <option value="debito">Débito</option>
          </select>
        </div>
        <div class="campo" style="margin:0">
          <label for="cb-referencia">Referencia — últimos 6 (opcional)</label>
          <input id="cb-referencia" type="text" inputmode="numeric" maxlength="6" placeholder="000000">
        </div>
        <p id="cb-error" class="error" hidden></p>`,
      acciones: [
        { texto: 'Cancelar', alPulsar: cerrarModal },
        { texto: 'Registrar cobro', estilo: 'btn--primario', alPulsar: btn => registrarCobro(q, btn) },
      ],
    });

    $('#cb-tasa').addEventListener('input', () => {
      const t = Number($('#cb-tasa').value);
      if (t > 0) $('#cb-monto').value = (Number(q.monto_usd) * t).toFixed(2);
      efectoDelAbono(q);
    });
    $('#cb-monto').addEventListener('input', () => efectoDelAbono(q));
    efectoDelAbono(q);
  }

  async function efectoDelAbono(q) {
    const caja = $('#cb-efecto');
    if (!caja) return;
    const t = Number($('#cb-tasa').value || 0);
    const monto = Number($('#cb-monto').value || 0);
    if (!t || !monto) { caja.textContent = ''; return; }

    const abonoUsd = monto / t;
    const minimo = Number(q.monto_usd);

    if (abonoUsd + 0.005 < minimo) {
      caja.innerHTML = `<span style="color:var(--rosa)">Faltan
        ${numero(minimo - abonoUsd)} USD para llegar al mínimo de esta cuota.</span>`;
      return;
    }

    let sobra = abonoUsd - minimo;
    if (sobra <= 0.005) {
      caja.innerHTML = `<span style="color:var(--esmeralda)">Cubre el mínimo
        (${numero(minimo)} USD). Quedarán ${q.cuotas_pendientes - 1} cuotas.</span>`;
      return;
    }

    const todas = await INV.db.cuotas.pendientes();
    const siguientes = todas
      .filter(x => x.venta_id === q.venta_id && x.numero > q.numero)
      .sort((a, b) => a.numero - b.numero);

    let adelantadas = 0, resto = sobra;
    for (const s of siguientes) {
      if (resto + 0.005 < Number(s.monto_usd)) break;
      resto -= Number(s.monto_usd);
      adelantadas++;
    }
    caja.innerHTML = `<span style="color:var(--cian)">Abona ${numero(sobra)} USD de más:
      ${adelantadas ? 'adelanta ' + adelantadas + ' cuota' + (adelantadas > 1 ? 's' : '') : 'rebaja la próxima cuota'}${
      adelantadas && resto > 0.005 ? ' y rebaja la siguiente en ' + numero(resto) + ' USD' : ''}.</span>`;
  }

  async function registrarCobro(q, btn) {
    const err = $('#cb-error');
    const monto = Number($('#cb-monto').value);
    const tasa = Number($('#cb-tasa').value || 1);
    if (!monto || monto <= 0) {
      err.textContent = 'Indica el monto cobrado.'; err.hidden = false; return;
    }
    btn.disabled = true;
    try {
      await INV.db.cuotas.pagar(q.id, $('#cb-metodo').value, monto, tasa,
                                $('#cb-referencia').value.replace(/\D/g, '').slice(0, 6) || null);
      cerrarModal();
      avisar('Cuota ' + q.numero + ' de ' + q.comprobante + ' cobrada');
      window.dispatchEvent(new Event('recargar-vista'));
    } catch (e) {
      err.textContent = e.message; err.hidden = false; btn.disabled = false;
    }
  }

  function enlazar() {
    $$('[data-abrir]').forEach(el => {
      const abrir = () => irA(el.dataset.abrir);
      el.addEventListener('click', abrir);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
      });
    });
  }
})();
