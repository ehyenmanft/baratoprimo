/* =====================================================================
   Ficha de producto
   Todo lo que se sabe de un artículo en una sola pantalla, con los
   enlaces a su kardex, a sus movimientos y a las acciones que lo tocan.
   ===================================================================== */
(function () {
  const { $, $$, esc, numero, cantidad, fecha, cargando, vacio, avisar, miniatura } = INV.ui;
  const G = INV.graficas;
  const P = INV.periodos;

  let actual = null;   // fila de stock_actual
  let cruda  = null;   // registro de productos, para el editor

  const estado = f => {
    const s = Number(f.stock), m = Number(f.stock_minimo);
    if (s <= 0)  return { texto: 'Sin existencias', color: '#FFD9E3' };
    if (s <= m)  return { texto: 'Bajo el mínimo',  color: '#FFE6BF' };
    return { texto: 'Disponible', color: '#C8F5E5' };
  };

  INV.vistas = INV.vistas || {};
  INV.vistas.producto = {
    railComo: 'productos',
    titulo:  () => actual ? actual.nombre : 'Producto',
    eyebrow: () => 'Ficha de producto',

    acciones: () => [
      { texto: 'Volver', estilo: 'btn--secundario', alPulsar: () => { location.hash = '#/productos'; } },
    ],

    render: async (contenedor, param) => {
      contenedor.innerHTML = cargando();
      const id = Number(param);

      const [existencias, catalogo] = await Promise.all([
        INV.db.stock.actual(),
        INV.db.productos.listar({ soloActivos: false }),
      ]);

      actual = existencias.find(f => f.producto_id === id);
      cruda  = catalogo.find(p => p.id === id);

      if (!cruda) {
        contenedor.innerHTML = vacio('Producto no encontrado',
          'Puede que se haya eliminado o que el enlace esté mal.',
          '<a class="btn btn--primario" href="#/productos">Ver productos</a>');
        return;
      }

      // Un producto desactivado no aparece en stock_actual; se muestra igual.
      if (!actual) {
        actual = {
          producto_id: cruda.id, sku: cruda.sku, nombre: cruda.nombre, unidad: cruda.unidad,
          categoria: cruda.categorias && cruda.categorias.nombre, stock: 0,
          stock_minimo: cruda.stock_minimo, costo: cruda.costo,
          precio_venta: cruda.precio_venta, valor_inventario: 0,
        };
      }

      $('#vista-titulo').textContent = actual.nombre;

      const movs = await INV.db.movimientos.listar({ productoId: id, limite: 500 });
      const est = estado(actual);
      const margen = Number(actual.precio_venta) > 0
        ? ((actual.precio_venta - actual.costo) / actual.precio_venta) * 100 : 0;

      // Consumo de los últimos 30 días para estimar cobertura.
      const hace30 = P.sumarDias(new Date(), -29);
      const salidas30 = movs.filter(m => m.cantidad < 0 && new Date(m.fecha) >= hace30)
        .reduce((s, m) => s - Number(m.cantidad), 0);
      const porDia = salidas30 / 30;
      const cobertura = porDia > 0 ? Math.floor(Number(actual.stock) / porDia) : null;

      const cronologia = [...movs].reverse();
      const puntos = cronologia.map(m => ({
        etiqueta: new Date(m.fecha).toLocaleDateString('es', { day: '2-digit', month: 'short' }),
        etiquetaLarga: fecha(m.fecha),
        valor: Number(m.saldo),
      }));

      contenedor.innerHTML = `
        <div class="ficha anim" style="--i:0; margin-bottom:14px">
          <div class="detalle__encabezado">
            <div class="detalle__cara">
              ${miniatura(cruda.imagen_path, actual.nombre, 'detalle__foto')}
              <div>
                <h2 class="detalle__titulo">${esc(actual.nombre)}</h2>
                <div class="detalle__meta">
                  <span>${esc(actual.sku)}</span>
                  <span>${esc(actual.categoria ?? 'sin categoría')}</span>
                  <span>por ${esc(actual.unidad)}</span>
                </div>
              </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:12px; align-items:flex-end">
              <span class="detalle__estado" style="color:${est.color}">${esc(est.texto)}</span>
              <div class="enlaces">
                <button class="btn btn--secundario btn--chico" id="fi-editar">Editar</button>
                <button class="btn btn--fantasma btn--chico" id="fi-entrada">Entrada</button>
                <button class="btn btn--fantasma btn--chico" id="fi-salida">Salida</button>
                <button class="btn btn--fantasma btn--chico" id="fi-ajuste">Ajuste</button>
              </div>
            </div>
          </div>

          <div class="datos">
            <div class="datos__celda">
              <div class="datos__etiqueta">Stock actual</div>
              <div class="datos__valor">${cantidad(actual.stock)} <small>${esc(actual.unidad)}</small></div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Stock mínimo</div>
              <div class="datos__valor">${cantidad(actual.stock_minimo)}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Costo ${INV.tasas.simbolo()}</div>
              <div class="datos__valor">${numero(actual.costo)}</div>
              <div class="equivalente">${esc(INV.tasas.equivalente(actual.costo))}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Precio de venta ${INV.tasas.simbolo()}</div>
              <div class="datos__valor">${numero(actual.precio_venta)}</div>
              <div class="equivalente">${esc(INV.tasas.equivalente(actual.precio_venta))}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Margen</div>
              <div class="datos__valor ${margen >= 0 ? 'pos' : 'neg'}">${margen.toFixed(1)}<small>%</small></div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Valor en almacén ${INV.tasas.simbolo()}</div>
              <div class="datos__valor">${numero(actual.valor_inventario)}</div>
              <div class="equivalente">${esc(INV.tasas.equivalente(actual.valor_inventario))}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Salidas 30 días</div>
              <div class="datos__valor">${cantidad(salidas30)}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Cobertura</div>
              <div class="datos__valor">${cobertura === null ? '—' : cobertura + ' <small>días</small>'}</div>
            </div>
          </div>
        </div>

        <div class="mosaico mosaico--2" style="margin-bottom:14px">
          <div class="ficha ficha--alza anim" style="--i:1">
            <div class="ficha__cabecera">
              <div>
                <h3 class="ficha__titulo">Evolución del saldo</h3>
                <p class="ficha__nota">${movs.length} movimientos registrados</p>
              </div>
              <a class="btn btn--secundario btn--chico" href="#/kardex/${actual.producto_id}">Kardex completo</a>
            </div>
            <div class="ficha__cuerpo">${G.linea(puntos, { alto: 190 })}</div>
          </div>

          <div class="ficha anim" style="--i:2">
            <div class="ficha__cabecera">
              <h3 class="ficha__titulo">Nivel contra el mínimo</h3>
            </div>
            <div class="ficha__cuerpo">
              ${INV.ui.medidor(actual.stock, actual.stock_minimo, 0)}
              <p style="margin:16px 0 0; font-size:13.5px; color:var(--tinta-2)">
                ${Number(actual.stock) <= 0
                  ? 'Sin existencias. Registra una entrada para poder despachar.'
                  : Number(actual.stock) <= Number(actual.stock_minimo)
                    ? `Faltan <b>${cantidad(Number(actual.stock_minimo) - Number(actual.stock))} ${esc(actual.unidad)}</b> para volver al mínimo.`
                    : `Hay <b>${cantidad(Number(actual.stock) - Number(actual.stock_minimo))} ${esc(actual.unidad)}</b> por encima del mínimo.`}
                ${cobertura !== null ? ` Al ritmo del último mes, cubre unos <b>${cobertura} días</b>.` : ''}
              </p>
            </div>
          </div>
        </div>

        <div class="ficha anim" style="--i:3">
          <div class="ficha__cabecera">
            <h3 class="ficha__titulo">Últimos movimientos</h3>
            <a class="btn btn--secundario btn--chico" href="#/movimientos/${actual.producto_id}">Ver todos</a>
          </div>
          ${movs.length ? `
            <div class="lista lista--mov">
              ${movs.slice(0, 10).map((m, i) => `
                <div class="lista__item" style="--i:${i}">
                  <span class="pastilla pastilla--${esc(m.tipo)}">${esc(m.tipo)}</span>
                  <span class="lista__nombre">${esc(m.motivo ?? 'Sin motivo')}
                    <span class="lista__sub">${fecha(m.fecha)}${m.referencia ? ' · ' + esc(m.referencia) : ''}</span></span>
                  <span class="lista__dato"><b class="${m.cantidad < 0 ? 'neg' : 'pos'}">${m.cantidad > 0 ? '+' : ''}${cantidad(m.cantidad)}</b><small>cantidad</small></span>
                  <span class="lista__dato"><b>${cantidad(m.saldo)}</b><small>saldo</small></span>
                </div>`).join('')}
            </div>`
          : '<div class="vacio"><h4>Sin movimientos</h4><p>Este producto nunca se ha movido.</p></div>'}
        </div>`;

      $('#fi-editar').addEventListener('click', () => INV.vistas.productos.abrirFormulario(cruda));
      $('#fi-entrada').addEventListener('click', () => INV.vistas.movimientos.abrirFormulario('entrada', id));
      $('#fi-salida').addEventListener('click', () => INV.vistas.movimientos.abrirFormulario('salida', id));
      $('#fi-ajuste').addEventListener('click', () => INV.vistas.movimientos.abrirFormulario('ajuste', id));
    },
  };
})();
