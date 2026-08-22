/* =====================================================================
   Gráficas — la pantalla completa de análisis.
   Inicio solo lleva la gráfica esencial; todo lo demás vive aquí.
   ===================================================================== */
(function () {
  const { $, $$, esc, numero, cantidad, cargando, vacio } = INV.ui;
  const G = INV.graficas;
  const P = INV.periodos;

  let rango = 90;
  let granularidad = null;   // null = automática según el rango

  const automatica = dias =>
    dias <= 15 ? 'dia' : dias <= 45 ? 'interdiario' : dias <= 120 ? 'semana' : 'mes';

  INV.vistas = INV.vistas || {};
  INV.vistas.graficas = {
    titulo: 'Gráficas',
    eyebrow: 'Análisis del almacén',

    acciones: () => [
      { texto: 'Imprimir', estilo: 'btn--secundario', alPulsar: () => window.print() },
    ],

    render: async contenedor => {
      contenedor.innerHTML = cargando();

      const hasta = new Date();
      const desde = P.sumarDias(hasta, -(rango - 1));
      const g = granularidad || automatica(rango);

      const [existencias, movs] = await Promise.all([
        INV.db.stock.actual(),
        INV.db.movimientos.listar({ desde: desde.toISOString(), limite: 8000 }),
      ]);

      if (!existencias.length) {
        contenedor.innerHTML = vacio('Nada que graficar todavía',
          'Carga productos y registra movimientos para ver el análisis.',
          '<a class="btn btn--primario" href="#/productos">Ir a productos</a>');
        return;
      }

      const cubos = P.agrupar(movs, desde, hasta, g);

      const precioPor = {}, costoPor = {};
      existencias.forEach(e => { precioPor[e.producto_id] = Number(e.precio_venta); costoPor[e.producto_id] = Number(e.costo); });

      const ventasPorCubo = cubos.map(c => {
        const dentro = movs.filter(m => m.tipo === 'salida' &&
          new Date(m.fecha) >= c.inicio && new Date(m.fecha) <= c.fin);
        return {
          etiqueta: c.etiqueta, etiquetaLarga: c.etiquetaLarga,
          valor: Number(dentro.reduce((s, m) => s + -Number(m.cantidad) * (precioPor[m.producto_id] || 0), 0).toFixed(2)),
        };
      });

      const comprasPorCubo = cubos.map(c => ({
        etiqueta: c.etiqueta, etiquetaLarga: c.etiquetaLarga,
        valor: Number(c.valorEntradas.toFixed(2)),
      }));

      const rotacion = Object.values(movs.filter(m => m.cantidad < 0).reduce((acc, m) => {
        acc[m.producto_id] = acc[m.producto_id] || { nombre: m.nombre, sku: m.sku, valor: 0 };
        acc[m.producto_id].valor += -Number(m.cantidad);
        return acc;
      }, {})).sort((a, b) => b.valor - a.valor).slice(0, 8);

      const ingresoPorProducto = Object.values(movs.filter(m => m.tipo === 'salida').reduce((acc, m) => {
        acc[m.producto_id] = acc[m.producto_id] || { nombre: m.nombre, sku: m.sku, valor: 0 };
        acc[m.producto_id].valor += -Number(m.cantidad) * (precioPor[m.producto_id] || 0);
        return acc;
      }, {})).sort((a, b) => b.valor - a.valor).slice(0, 8);

      const porCategoria = Object.values(existencias.reduce((acc, e) => {
        const k = e.categoria || 'Sin categoría';
        acc[k] = acc[k] || { nombre: k, valor: 0 };
        acc[k].valor += Number(e.valor_inventario);
        return acc;
      }, {})).sort((a, b) => b.valor - a.valor);

      const quietos = existencias
        .filter(e => !movs.some(m => m.producto_id === e.producto_id && m.cantidad < 0))
        .map(e => ({ nombre: e.nombre, sku: e.sku, valor: Number(e.valor_inventario) }))
        .sort((a, b) => b.valor - a.valor).slice(0, 8);

      const ventaTotal = ventasPorCubo.reduce((s, p) => s + p.valor, 0);
      const compraTotal = comprasPorCubo.reduce((s, p) => s + p.valor, 0);
      const nombreG = (P.GRANULARIDADES.find(x => x.id === g) || {}).etiqueta.toLowerCase();

      contenedor.innerHTML = `
        <div class="ficha anim" style="--i:0; margin-bottom:14px">
          <div class="ficha__cabecera">
            <div>
              <h3 class="ficha__titulo">Periodo analizado</h3>
              <p class="ficha__nota">${desde.toLocaleDateString('es')} — ${hasta.toLocaleDateString('es')} · ${cubos.length} periodos · ${esc(nombreG)}</p>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap">
              <div class="chips" id="gr-rango">
                ${P.RANGOS.map(r => `<button data-dias="${r.dias}" class="${r.dias === rango ? 'activo' : ''}">${r.etiqueta}</button>`).join('')}
              </div>
              <div class="chips" id="gr-gran">
                ${P.GRANULARIDADES.map(x => `<button data-g="${x.id}" class="${x.id === g ? 'activo' : ''}">${x.etiqueta}</button>`).join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="mosaico mosaico--auto" style="margin-bottom:14px">
          <div class="metrica metrica--esmeralda metrica--teal anim" style="--i:1">
            <div class="metrica__etiqueta">Compras</div>
            <div class="metrica__valor">${numero(compraTotal)}</div>
            <div class="metrica__pie">valor de lo recibido</div>
          </div>
          <div class="metrica metrica--frambuesa anim" style="--i:2">
            <div class="metrica__etiqueta">Venta estimada</div>
            <div class="metrica__valor">${numero(ventaTotal)}</div>
            <div class="metrica__pie">a precio de lista</div>
          </div>
          <div class="metrica metrica--cian anim" style="--i:3">
            <div class="metrica__etiqueta">Movimientos</div>
            <div class="metrica__valor">${movs.length}</div>
            <div class="metrica__pie">en el periodo</div>
          </div>
          <div class="metrica metrica--ambar anim" style="--i:4">
            <div class="metrica__etiqueta">Sin rotación</div>
            <div class="metrica__valor">${quietos.length}</div>
            <div class="metrica__pie">productos sin salidas</div>
          </div>
        </div>

        <div class="ficha anim" style="--i:5; margin-bottom:14px">
          <div class="ficha__cabecera">
            <div>
              <h3 class="ficha__titulo">Flujo del almacén</h3>
              <p class="ficha__nota">entradas arriba · salidas abajo</p>
            </div>
          </div>
          <div class="ficha__cuerpo">
            ${G.flujo(cubos, { alto: 260 })}
            <div class="leyenda-grafica" style="margin-top:14px">
              <span><i style="background:var(--esmeralda)"></i> Entradas</span>
              <span><i style="background:var(--rosa)"></i> Salidas</span>
            </div>
          </div>
        </div>

        <div class="mosaico mosaico--2" style="margin-bottom:14px">
          <div class="ficha ficha--alza anim" style="--i:6">
            <div class="ficha__cabecera">
              <h3 class="ficha__titulo">Venta estimada por periodo</h3>
            </div>
            <div class="ficha__cuerpo">${G.linea(ventasPorCubo, { alto: 200 })}</div>
          </div>
          <div class="ficha ficha--alza anim" style="--i:7">
            <div class="ficha__cabecera">
              <h3 class="ficha__titulo">Compras por periodo</h3>
            </div>
            <div class="ficha__cuerpo">${G.linea(comprasPorCubo, { alto: 200 })}</div>
          </div>
        </div>

        <div class="mosaico mosaico--2" style="margin-bottom:14px">
          <div class="ficha anim" style="--i:8">
            <div class="ficha__cabecera">
              <h3 class="ficha__titulo">Más despachado</h3>
              <p class="ficha__nota">unidades</p>
            </div>
            ${G.ranking(rotacion)}
          </div>
          <div class="ficha anim" style="--i:9">
            <div class="ficha__cabecera">
              <h3 class="ficha__titulo">Mayor ingreso</h3>
              <p class="ficha__nota">a precio de lista</p>
            </div>
            ${G.ranking(ingresoPorProducto, { formato: v => numero(v, 0) })}
          </div>
        </div>

        <div class="mosaico mosaico--2">
          <div class="ficha ficha--alza anim" style="--i:10">
            <div class="ficha__cabecera">
              <h3 class="ficha__titulo">Valor por categoría</h3>
            </div>
            <div class="ficha__cuerpo">${G.composicion(porCategoria)}</div>
          </div>
          <div class="ficha anim" style="--i:11">
            <div class="ficha__cabecera">
              <h3 class="ficha__titulo">Capital detenido</h3>
              <p class="ficha__nota">sin salidas en el periodo</p>
            </div>
            ${quietos.length ? G.ranking(quietos, { formato: v => numero(v, 0) })
              : '<div class="vacio"><h4>Todo rota</h4><p>Cada producto tuvo al menos una salida.</p></div>'}
          </div>
        </div>`;

      $$('#gr-rango button').forEach(b => b.addEventListener('click', () => {
        rango = Number(b.dataset.dias);
        granularidad = null;
        INV.vistas.graficas.render(contenedor);
      }));
      $$('#gr-gran button').forEach(b => b.addEventListener('click', () => {
        granularidad = b.dataset.g;
        INV.vistas.graficas.render(contenedor);
      }));
    },
  };
})();
