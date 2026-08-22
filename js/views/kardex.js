/* =====================================================================
   Kardex — historial de un solo producto, con su curva de saldo.
   ===================================================================== */
(function () {
  const { $, esc, cantidad, fecha, cargando, vacio, descargarCSV, avisar } = INV.ui;
  const G = INV.graficas;

  let ultimasFilas = [];

  async function cargar() {
    const caja = $('#kx-cuerpo');
    caja.innerHTML = cargando();

    const desde = $('#kx-desde').value ? new Date($('#kx-desde').value).toISOString() : null;
    const hasta = $('#kx-hasta').value ? new Date($('#kx-hasta').value + 'T23:59:59').toISOString() : null;

    ultimasFilas = await INV.db.movimientos.listar({
      productoId: Number($('#kx-producto').value), desde, hasta, limite: 500,
    });

    if (!ultimasFilas.length) {
      caja.innerHTML = vacio('Sin movimientos', 'Este producto no tiene movimientos en el rango elegido.');
      return;
    }

    // La consulta llega descendente; el kardex se lee de arriba abajo.
    const filas = [...ultimasFilas].reverse();
    const entradas = filas.filter(f => f.cantidad > 0).reduce((s, f) => s + Number(f.cantidad), 0);
    const salidas  = filas.filter(f => f.cantidad < 0).reduce((s, f) => s - Number(f.cantidad), 0);
    const saldoFinal = filas[filas.length - 1].saldo;

    const puntos = filas.map(f => ({
      etiqueta: new Date(f.fecha).toLocaleDateString('es', { day: '2-digit', month: 'short' }),
      etiquetaLarga: fecha(f.fecha),
      valor: Number(f.saldo),
    }));

    caja.innerHTML = `
      <div class="ficha__cuerpo">${G.linea(puntos, { alto: 200 })}</div>

      <div class="mosaico mosaico--auto" style="padding:0 18px 16px">
        <div class="metrica metrica--teal">
          <div class="metrica__etiqueta">Entradas</div>
          <div class="metrica__valor">${cantidad(entradas)}</div>
        </div>
        <div class="metrica metrica--frambuesa">
          <div class="metrica__etiqueta">Salidas</div>
          <div class="metrica__valor">${cantidad(salidas)}</div>
        </div>
        <div class="metrica">
          <div class="metrica__etiqueta">Saldo final</div>
          <div class="metrica__valor">${cantidad(saldoFinal)}</div>
        </div>
        <div class="metrica">
          <div class="metrica__etiqueta">Movimientos</div>
          <div class="metrica__valor">${filas.length}</div>
        </div>
      </div>

      <div class="lista lista--kx">
        ${filas.map((f, i) => `
          <div class="lista__item" style="--i:${Math.min(i, 24)}">
            <span class="lista__nombre" style="font-weight:500; font-size:13px">${fecha(f.fecha)}</span>
            <span><span class="pastilla pastilla--${esc(f.tipo)}">${esc(f.tipo)}</span></span>
            <span class="lista__nombre" style="font-weight:400; font-size:13px">${esc(f.motivo ?? '—')}
              <span class="lista__sub">${esc(f.referencia ?? 'sin referencia')}</span></span>
            <span class="lista__dato"><b class="${f.cantidad < 0 ? 'neg' : 'pos'}">${f.cantidad > 0 ? '+' : ''}${cantidad(f.cantidad)}</b><small>cantidad</small></span>
            <span class="lista__dato"><b>${cantidad(f.saldo)}</b><small>saldo</small></span>
          </div>`).join('')}
      </div>`;
  }

  INV.vistas = INV.vistas || {};
  INV.vistas.kardex = {
    titulo: 'Kardex',
    eyebrow: 'Historial por producto',

    acciones: () => [{
      texto: 'Exportar', estilo: 'btn--secundario',
      alPulsar: () => {
        if (!ultimasFilas.length) return avisar('No hay movimientos que exportar', 'error');
        descargarCSV(`kardex-${new Date().toISOString().slice(0,10)}.csv`, [
          { titulo: 'Fecha',      valor: f => fecha(f.fecha) },
          { titulo: 'SKU',        valor: f => f.sku },
          { titulo: 'Producto',   valor: f => f.nombre },
          { titulo: 'Tipo',       valor: f => f.tipo },
          { titulo: 'Cantidad',   valor: f => f.cantidad },
          { titulo: 'Saldo',      valor: f => f.saldo },
          { titulo: 'Motivo',     valor: f => f.motivo ?? '' },
          { titulo: 'Referencia', valor: f => f.referencia ?? '' },
        ], ultimasFilas);
      },
    }],

    render: async (contenedor, param) => {
      contenedor.innerHTML = cargando();
      const productos = await INV.db.stock.actual();

      if (!productos.length) {
        contenedor.innerHTML = vacio('Sin productos', 'Carga un producto para poder consultar su kardex.');
        return;
      }

      contenedor.innerHTML = `
        <div class="ficha anim">
          <div class="ficha__cabecera">
            <select id="kx-producto" style="max-width:320px">
              ${productos.map(p => `<option value="${p.producto_id}" ${String(p.producto_id) === String(param) ? 'selected' : ''}>${esc(p.sku)} — ${esc(p.nombre)}</option>`).join('')}
            </select>
            <div class="filtros">
              <label class="filtro"><span>Desde</span><input type="date" id="kx-desde"></label>
              <label class="filtro"><span>Hasta</span><input type="date" id="kx-hasta"></label>
              <button id="kx-filtrar" class="btn btn--secundario btn--chico">Filtrar</button>
            </div>
          </div>
          <div id="kx-cuerpo"></div>
        </div>`;

      $('#kx-producto').addEventListener('change', cargar);
      $('#kx-filtrar').addEventListener('click', cargar);
      cargar();
    },
  };
})();
