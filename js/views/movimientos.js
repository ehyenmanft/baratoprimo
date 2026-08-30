/* =====================================================================
   Movimientos
   Dos capas: el reporte agrupado por periodo (lo que se lleva a una
   reunión) y el detalle uno a uno (lo que se audita).
   ===================================================================== */
(function () {
  const { $, $$, esc, cantidad, fecha, avisar, abrirModal, cerrarModal,
          cargando, descargarCSV } = INV.ui;
  const G = INV.graficas;
  const P = INV.periodos;

  let productos = [];
  let filtro = { dias: 30, granularidad: 'dia', desde: null, hasta: null, tipo: '', productoId: '' };
  let cubosActuales = [];
  let detalleActual = [];

  const rangoEfectivo = () => {
    if (filtro.desde && filtro.hasta)
      return { desde: new Date(filtro.desde + 'T00:00:00'), hasta: new Date(filtro.hasta + 'T23:59:59') };
    const hasta = new Date();
    return { desde: P.sumarDias(hasta, -(filtro.dias - 1)), hasta };
  };

  /* ---------------- Formulario ---------------- */

  /* productoId preselecciona el artículo: se usa desde la ficha de producto. */
  function abrirFormulario(tipo, productoId = null) {
    if (!productos.length) {
      INV.db.stock.actual().then(p => {
        productos = p;
        p.length ? abrirFormulario(tipo, productoId) : avisar('Primero carga al menos un producto', 'error');
      });
      return;
    }
    const esAjuste = tipo === 'ajuste';

    abrirModal({
      titulo: esAjuste ? 'Registrar ajuste' : `Registrar ${tipo}`,
      cuerpo: `
        <div class="campo">
          <label for="mv-producto">Producto</label>
          <div style="display:grid; grid-template-columns:1fr auto; gap:6px">
            <select id="mv-producto">
              ${productos.map(p => `<option value="${p.producto_id}" ${String(p.producto_id) === String(productoId) ? 'selected' : ''}>${esc(p.sku)} — ${esc(p.nombre)} (${cantidad(p.stock)} ${esc(p.unidad)})</option>`).join('')}
            </select>
            <button type="button" class="btn btn--secundario btn--chico" id="mv-escanear-prod" title="Escanear producto con cámara">📷</button>
          </div>
        </div>
        ${esAjuste ? `
        <div class="campo">
          <label for="mv-sentido">Sentido del ajuste</label>
          <select id="mv-sentido">
            <option value="mas">Sumar al stock</option>
            <option value="menos">Restar del stock</option>
          </select>
        </div>` : ''}
        <div class="campos-fila">
          <div class="campo">
            <label for="mv-cantidad">Cantidad</label>
            <input id="mv-cantidad" type="number" min="0.001" step="0.001" placeholder="0">
          </div>
          <div class="campo">
            <label for="mv-costo">Costo unitario ${INV.tasas ? INV.tasas.simbolo() : ''}</label>
            <input id="mv-costo" type="number" min="0" step="0.01" placeholder="Opcional">
            <span class="equivalente" id="mv-costo-eq"></span>
          </div>
        </div>
        <div class="campos-fila">
          <div class="campo">
            <label for="mv-motivo">Motivo</label>
            <input id="mv-motivo" type="text" placeholder="${esAjuste ? 'Conteo físico, merma…' : tipo === 'entrada' ? 'Compra, devolución…' : 'Venta, traslado…'}">
          </div>
          <div class="campo">
            <label for="mv-referencia">Referencia</label>
            <input id="mv-referencia" type="text" placeholder="Factura, guía, orden">
          </div>
        </div>
        <div class="campo">
          <label for="mv-nota">Nota</label>
          <textarea id="mv-nota" rows="2" placeholder="Opcional"></textarea>
        </div>
        <p id="mv-error" class="error" hidden></p>`,
      acciones: [
        { texto: 'Cancelar', alPulsar: cerrarModal },
        { texto: 'Guardar', estilo: 'btn--primario', alPulsar: btn => guardar(tipo, btn) },
      ],
    });

    function esUnidadDecimal(unidad) {
      if (!unidad) return false;
      const u = String(unidad).trim().toLowerCase();
      return /^(kg|kilo|kilos|kilogramo|kilogramos|g|gr|grs|gramo|gramos|mg|miligramo|miligramos|m|mt|mts|metro|metros|cm|centimetro|centimetros|centímetro|centímetros|mm|milimetro|milimetros|l|lt|lts|litro|litros|ml|mililitro|mililitros|cc|decimal|fraccionable|granel)$/i.test(u)
        || /(kg|kilo|gram|metro|centim|milim|litro|granel|peso)/i.test(u);
    }

    function ajustarPasoMv() {
      const selProd = $('#mv-producto');
      const inpCant = $('#mv-cantidad');
      if (!selProd || !inpCant) return;
      const p = productos.find(x => String(x.producto_id) === String(selProd.value));
      const decimal = p && esUnidadDecimal(p.unidad);
      inpCant.step = decimal ? '0.001' : '1';
      inpCant.min = decimal ? '0.001' : '1';
    }

    $('#mv-producto').addEventListener('change', ajustarPasoMv);
    const btnEscanearMv = $('#mv-escanear-prod');
    if (btnEscanearMv) {
      btnEscanearMv.addEventListener('click', () => {
        if (!INV.escaner) return avisar('Módulo de escáner no disponible', 'error');
        INV.escaner.abrirModalEscaneo({
          titulo: 'Escanear producto para movimiento',
          descripcion: 'Apunta la cámara al código de barras o QR del producto.',
          modoContinuo: false,
          onScan: (codigo, { cerrar, mostrarMensaje }) => {
            const t = String(codigo || '').trim().toLowerCase();
            const p = productos.find(x =>
              (x.sku && String(x.sku).toLowerCase() === t) ||
              String(x.producto_id || x.id) === t
            );
            if (!p) {
              mostrarMensaje(`⚠️ No encontrado: "${codigo}"`, true);
              return;
            }
            const sel = $('#mv-producto');
            if (sel) {
              sel.value = String(p.producto_id || p.id);
              ajustarPasoMv();
            }
            cerrar();
          }
        });
      });
    }
    ajustarPasoMv();

    // El costo también se ve en la otra moneda mientras se escribe
    INV.ui.montoAutomatico('#mv-costo');
    if (INV.tasas) INV.tasas.enlazarEquivalente('#mv-costo', '#mv-costo-eq');
  }

  async function guardar(tipo, btn) {
    const err = $('#mv-error');
    const cant = Number($('#mv-cantidad').value);
    if (!cant || cant <= 0) {
      err.textContent = 'Indica una cantidad mayor que cero.';
      err.hidden = false;
      return;
    }
    btn.disabled = true;
    try {
      await INV.db.movimientos.registrar({
        producto_id:    Number($('#mv-producto').value),
        tipo,
        cantidad:       cant,
        es_negativo:    tipo === 'ajuste' && $('#mv-sentido').value === 'menos',
        costo_unitario: INV.ui.leerMonto('#mv-costo') || null,
        motivo:         $('#mv-motivo').value || null,
        referencia:     $('#mv-referencia').value || null,
        nota:           $('#mv-nota').value || null,
      });
      cerrarModal();
      avisar('Movimiento registrado');
      window.dispatchEvent(new Event('recargar-vista'));
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      btn.disabled = false;
    }
  }

  /* ---------------- Exportaciones ---------------- */

  function exportarResumen() {
    if (!cubosActuales.length) return avisar('No hay periodos que exportar', 'error');
    descargarCSV(`reporte-${filtro.granularidad}-${new Date().toISOString().slice(0,10)}.csv`, [
      { titulo: 'Periodo',     valor: c => c.etiquetaLarga },
      { titulo: 'Movimientos', valor: c => c.cantidadMovimientos },
      { titulo: 'Productos',   valor: c => c.productos },
      { titulo: 'Entradas',    valor: c => c.entradas },
      { titulo: 'Salidas',     valor: c => c.salidas },
      { titulo: 'Neto',        valor: c => c.neto },
    ], cubosActuales);
  }

  function exportarDetalle() {
    if (!detalleActual.length) return avisar('No hay movimientos que exportar', 'error');
    descargarCSV(`movimientos-${new Date().toISOString().slice(0,10)}.csv`, [
      { titulo: 'Fecha',      valor: m => fecha(m.fecha) },
      { titulo: 'SKU',        valor: m => m.sku },
      { titulo: 'Producto',   valor: m => m.nombre },
      { titulo: 'Tipo',       valor: m => m.tipo },
      { titulo: 'Cantidad',   valor: m => m.cantidad },
      { titulo: 'Saldo',      valor: m => m.saldo },
      { titulo: 'Motivo',     valor: m => m.motivo ?? '' },
      { titulo: 'Referencia', valor: m => m.referencia ?? '' },
    ], detalleActual);
  }

  /* ---------------- Vista ---------------- */

  INV.vistas = INV.vistas || {};
  INV.vistas.movimientos = {
    titulo: 'Movimientos',
    eyebrow: 'Registro y reportes',
    abrirFormulario,

    acciones: () => [
      { texto: 'Entrada', estilo: 'btn--primario',   alPulsar: () => abrirFormulario('entrada') },
      { texto: 'Salida',  estilo: 'btn--secundario', alPulsar: () => abrirFormulario('salida') },
      { texto: 'Ajuste',  estilo: 'btn--secundario', alPulsar: () => abrirFormulario('ajuste') },
      { texto: 'Imprimir', estilo: 'btn--secundario', alPulsar: () => window.print() },
    ],

    render: async (contenedor, param) => {
      contenedor.innerHTML = cargando();
      productos = await INV.db.stock.actual();
      // #/movimientos/12 abre la vista ya filtrada por ese producto.
      if (param) filtro.productoId = param;
      pintarMarco(contenedor);
      await refrescar();
    },
  };

  function pintarMarco(contenedor) {
    const r = rangoEfectivo();

    contenedor.innerHTML = `
      <div class="ficha anim" style="--i:0; margin-bottom:14px">
        <div class="ficha__cabecera">
          <div>
            <h3 class="ficha__titulo">Reporte por periodo</h3>
            <p class="ficha__nota" id="mv-nota"></p>
          </div>
          <div class="chips" id="mv-granularidad">
            ${P.GRANULARIDADES.map(g => `<button data-g="${g.id}" class="${g.id === filtro.granularidad ? 'activo' : ''}">${g.etiqueta}</button>`).join('')}
          </div>
        </div>

        <div class="ficha__cuerpo" style="padding-bottom:14px">
          <div class="chips" id="mv-rango" style="margin-bottom:14px">
            ${P.RANGOS.map(x => `<button data-dias="${x.dias}" class="${x.dias === filtro.dias && !filtro.desde ? 'activo' : ''}">${x.etiqueta}</button>`).join('')}
          </div>
          <div class="filtros">
            <label class="filtro"><span>Desde</span>
              <input type="date" id="mv-desde" value="${filtro.desde ?? r.desde.toISOString().slice(0,10)}"></label>
            <label class="filtro"><span>Hasta</span>
              <input type="date" id="mv-hasta" value="${filtro.hasta ?? r.hasta.toISOString().slice(0,10)}"></label>
            <label class="filtro"><span>Tipo</span>
              <select id="mv-tipo">
                <option value="">Todos</option>
                <option value="entrada" ${filtro.tipo === 'entrada' ? 'selected' : ''}>Entradas</option>
                <option value="salida"  ${filtro.tipo === 'salida'  ? 'selected' : ''}>Salidas</option>
                <option value="ajuste"  ${filtro.tipo === 'ajuste'  ? 'selected' : ''}>Ajustes</option>
              </select></label>
            <label class="filtro" style="min-width:190px"><span>Producto</span>
              <select id="mv-producto-filtro">
                <option value="">Todos</option>
                ${productos.map(p => `<option value="${p.producto_id}" ${String(p.producto_id) === String(filtro.productoId) ? 'selected' : ''}>${esc(p.sku)} — ${esc(p.nombre)}</option>`).join('')}
              </select></label>
            <button id="mv-aplicar" class="btn btn--primario">Generar</button>
            <button id="mv-exp-resumen" class="btn btn--secundario">Exportar</button>
          </div>
        </div>

        <div id="mv-grafica" class="ficha__cuerpo"></div>
      </div>

      <div class="ficha anim" style="--i:1; margin-bottom:14px">
        <div class="ficha__cabecera">
          <h3 class="ficha__titulo">Totales por periodo</h3>
          <span class="ficha__nota" id="mv-total"></span>
        </div>
        <div id="mv-resumen"></div>
      </div>

      <div class="ficha anim" style="--i:2">
        <div class="ficha__cabecera">
          <h3 class="ficha__titulo" id="mv-detalle-titulo">Detalle</h3>
          <button id="mv-exp-detalle" class="btn btn--secundario btn--chico">Exportar detalle</button>
        </div>
        <div id="mv-detalle"></div>
      </div>`;

    $$('#mv-granularidad button').forEach(b => b.addEventListener('click', () => {
      filtro.granularidad = b.dataset.g;
      $$('#mv-granularidad button').forEach(x => x.classList.toggle('activo', x === b));
      refrescar();
    }));

    $$('#mv-rango button').forEach(b => b.addEventListener('click', () => {
      filtro.dias = Number(b.dataset.dias);
      filtro.desde = filtro.hasta = null;
      $$('#mv-rango button').forEach(x => x.classList.toggle('activo', x === b));
      const nr = rangoEfectivo();
      $('#mv-desde').value = nr.desde.toISOString().slice(0,10);
      $('#mv-hasta').value = nr.hasta.toISOString().slice(0,10);
      refrescar();
    }));

    $('#mv-aplicar').addEventListener('click', () => {
      filtro.desde = $('#mv-desde').value;
      filtro.hasta = $('#mv-hasta').value;
      filtro.tipo = $('#mv-tipo').value;
      filtro.productoId = $('#mv-producto-filtro').value;
      $$('#mv-rango button').forEach(x => x.classList.remove('activo'));
      refrescar();
    });

    $('#mv-exp-resumen').addEventListener('click', exportarResumen);
    $('#mv-exp-detalle').addEventListener('click', exportarDetalle);
  }

  async function refrescar() {
    const { desde, hasta } = rangoEfectivo();
    $('#mv-grafica').innerHTML = cargando();
    $('#mv-detalle').innerHTML = cargando();

    let movs = await INV.db.movimientos.listar({
      desde: desde.toISOString(), hasta: hasta.toISOString(),
      productoId: filtro.productoId ? Number(filtro.productoId) : null,
      limite: 5000,
    });
    if (filtro.tipo) movs = movs.filter(m => m.tipo === filtro.tipo);

    detalleActual = movs;
    cubosActuales = P.agrupar(movs, desde, hasta, filtro.granularidad);

    const g = P.GRANULARIDADES.find(x => x.id === filtro.granularidad);
    $('#mv-nota').textContent =
      `${desde.toLocaleDateString('es')} — ${hasta.toLocaleDateString('es')} · ${cubosActuales.length} periodos · ${g.etiqueta.toLowerCase()}`;

    $('#mv-grafica').innerHTML = `
      ${G.flujo(cubosActuales, { alto: 210 })}
      <div class="leyenda-grafica" style="margin-top:14px">
        <span><i style="background:var(--teal)"></i> Entradas</span>
        <span><i style="background:var(--frambuesa)"></i> Salidas</span>
      </div>`;

    /* --- Totales por periodo --- */
    const tE = cubosActuales.reduce((s, c) => s + c.entradas, 0);
    const tS = cubosActuales.reduce((s, c) => s + c.salidas, 0);
    const tM = cubosActuales.reduce((s, c) => s + c.cantidadMovimientos, 0);
    const neto = tE - tS;

    $('#mv-total').textContent =
      `${tM} movimientos · neto ${neto > 0 ? '+' : ''}${cantidad(neto)}`;

    const conDatos = cubosActuales.filter(c => c.cantidadMovimientos > 0);
    $('#mv-resumen').innerHTML = conDatos.length ? `
      <div class="lista lista--per">
        ${cubosActuales.map((c, i) => `
          <div class="lista__item ${c.cantidadMovimientos ? '' : 'apagado'}" style="--i:${i}">
            <span class="lista__nombre">${esc(c.etiquetaLarga)}
              <span class="lista__sub">${c.cantidadMovimientos} movs · ${c.productos} productos</span></span>
            <span class="lista__dato"><b>${c.cantidadMovimientos}</b><small>movs</small></span>
            <span class="lista__dato"><b class="pos">${c.entradas ? cantidad(c.entradas) : '—'}</b><small>entra</small></span>
            <span class="lista__dato"><b class="neg">${c.salidas ? cantidad(c.salidas) : '—'}</b><small>sale</small></span>
            <span class="lista__dato"><b class="${c.neto > 0 ? 'pos' : c.neto < 0 ? 'neg' : ''}">${c.neto > 0 ? '+' : ''}${cantidad(c.neto)}</b><small>neto</small></span>
          </div>`).join('')}
      </div>
      <div class="ficha__pie">
        <div class="lista--per" style="display:grid; grid-template-columns:minmax(0,1fr) 74px 88px 88px 88px; gap:12px; align-items:center">
          <span class="lista__nombre">Total del rango</span>
          <span class="lista__dato"><b>${tM}</b></span>
          <span class="lista__dato"><b class="pos">${cantidad(tE)}</b></span>
          <span class="lista__dato"><b class="neg">${cantidad(tS)}</b></span>
          <span class="lista__dato"><b class="${neto >= 0 ? 'pos' : 'neg'}">${neto > 0 ? '+' : ''}${cantidad(neto)}</b></span>
        </div>
      </div>`
      : '<div class="vacio"><h4>Sin movimientos en el rango</h4><p>Ajusta las fechas o registra una entrada.</p></div>';

    /* --- Detalle --- */
    $('#mv-detalle-titulo').textContent = `Detalle — ${movs.length} registros`;
    $('#mv-detalle').innerHTML = movs.length ? `
      <div class="lista lista--mov">
        ${movs.slice(0, 200).map((m, i) => `
          <div class="lista__item" style="--i:${Math.min(i, 24)}" data-abrir="${m.producto_id}" role="button" tabindex="0">
            <span class="pastilla pastilla--${esc(m.tipo)}">${esc(m.tipo)}</span>
            <span class="lista__nombre">${esc(m.nombre)}
              <span class="lista__sub">${fecha(m.fecha)} · ${esc(m.motivo ?? 'sin motivo')}${m.referencia ? ' · ' + esc(m.referencia) : ''}</span></span>
            <span class="lista__dato"><b class="${m.cantidad < 0 ? 'neg' : 'pos'}">${m.cantidad > 0 ? '+' : ''}${cantidad(m.cantidad)}</b><small>cantidad</small></span>
            <span class="lista__dato"><b>${cantidad(m.saldo)}</b><small>saldo</small></span>
          </div>`).join('')}
      </div>
      ${movs.length > 200 ? '<div class="ficha__pie" style="text-align:center; font-size:13px; color:var(--tinta-3)">Se muestran los 200 más recientes. Exporta el detalle para verlos todos.</div>' : ''}`
      : '<div class="vacio"><h4>Sin movimientos</h4><p>No hay registros con estos filtros.</p></div>';

    $$('#mv-detalle [data-abrir]').forEach(el => {
      el.addEventListener('click', () => { location.hash = '#/producto/' + el.dataset.abrir; });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = '#/producto/' + el.dataset.abrir; }
      });
    });
  }
})();
