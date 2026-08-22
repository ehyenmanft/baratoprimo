/* =====================================================================
   Productos
   Catálogo y existencias en una sola pantalla: el stock es un atributo
   del producto, no otra vista. Cada producto es una micro tarjeta.
   ===================================================================== */
(function () {
  const { $, $$, esc, numero, cantidad, avisar, abrirModal, cerrarModal,
          cargando, vacio, descargarCSV, imagenReducida, miniatura } = INV.ui;

  let imagenPendiente = undefined;   // undefined = sin cambios; null = quitar

  let cats = [];
  let filas = [];       // stock_actual, con los datos de catálogo mezclados
  let catalogo = [];    // productos crudos, incluye inactivos
  let verInactivos = false;

  const medidor = (stock, minimo, i) => {
    const s = Number(stock), m = Number(minimo);
    const tope = Math.max(m * 2, s, 1);
    const clase = s <= 0 ? 'vacio' : s <= m ? 'bajo' : '';
    return `<span class="medidor lista__medidor">
      <span class="medidor__riel"><span class="medidor__barra ${clase}" style="--i:${i}; width:${Math.min(100, s / tope * 100).toFixed(1)}%"></span></span>
      <span class="medidor__min">mín ${cantidad(m)}</span>
    </span>`;
  };

  const ficha = (f, i) => `
    <div class="lista__item" style="--i:${Math.min(i, 24)}" data-abrir="${f.producto_id}" role="button" tabindex="0">
      ${miniatura(f.imagen_path, f.nombre)}
      <span class="lista__nombre">${esc(f.nombre)}
        <span class="lista__sub">${esc(f.sku)} · ${esc(f.categoria ?? 'sin categoría')} · ${numero(f.precio_venta)}</span></span>
      ${medidor(f.stock, f.stock_minimo, Math.min(i, 24))}
      <span class="lista__dato"><b class="${Number(f.stock) <= 0 ? 'neg' : Number(f.stock) <= Number(f.stock_minimo) ? '' : ''}">${cantidad(f.stock)}</b><small>${esc(f.unidad)}</small></span>
    </div>`;

  /* ---------------- Formulario ---------------- */

  async function abrirFormulario(p = null) {
    if (!cats.length) cats = await INV.db.categorias.listar();
    imagenPendiente = undefined;

    abrirModal({
      titulo: p ? 'Editar producto' : 'Cargar producto',
      cuerpo: `
        <div class="campos-fila">
          <div class="campo">
            <label for="pr-sku">SKU</label>
            <input id="pr-sku" type="text" value="${esc(p ? p.sku : '')}" placeholder="SKU-001">
          </div>
          <div class="campo">
            <label for="pr-unidad">Unidad</label>
            <input id="pr-unidad" type="text" value="${esc(p ? p.unidad : 'unidad')}" placeholder="unidad, kg, caja">
          </div>
        </div>
        <div class="campo">
          <label>Imagen del producto</label>
          <div class="subida">
            <img class="subida__vista" id="pr-vista" alt=""
                 src="${esc((p && INV.db.archivos.url(p.imagen_path)) || 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==')}">
            <div class="subida__acciones">
              <div style="display:flex; gap:6px; flex-wrap:wrap">
                <button type="button" class="btn btn--secundario btn--chico" id="pr-elegir">Elegir imagen</button>
                <button type="button" class="btn btn--fantasma btn--chico" id="pr-quitar">Quitar</button>
              </div>
              <span class="subida__nota" id="pr-img-nota">JPG o PNG · se reduce a 480 px</span>
            </div>
            <input type="file" id="pr-archivo" accept="image/*">
          </div>
        </div>
        <div class="campo">
          <label for="pr-nombre">Nombre</label>
          <input id="pr-nombre" type="text" value="${esc(p ? p.nombre : '')}" placeholder="Nombre del producto">
        </div>
        <div class="campo">
          <label for="pr-categoria">Categoría</label>
          <select id="pr-categoria">
            <option value="">Sin categoría</option>
            ${cats.map(c => `<option value="${c.id}" ${p && p.categoria_id === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="campos-fila">
          <div class="campo">
            <label for="pr-costo">Costo</label>
            <input id="pr-costo" type="number" step="0.01" min="0" value="${p ? p.costo : 0}">
          </div>
          <div class="campo">
            <label for="pr-precio">Precio de venta</label>
            <input id="pr-precio" type="number" step="0.01" min="0" value="${p ? p.precio_venta : 0}">
          </div>
        </div>
        <div class="campo">
          <label for="pr-minimo">Stock mínimo — dispara la alerta</label>
          <input id="pr-minimo" type="number" step="0.001" min="0" value="${p ? p.stock_minimo : 0}">
        </div>
        ${p ? '' : `
        <div class="campo">
          <label for="pr-inicial">Existencia inicial — opcional</label>
          <input id="pr-inicial" type="number" step="0.001" min="0" value="0" placeholder="0">
        </div>`}
        <p id="pr-error" class="error" hidden></p>`,
      acciones: [
        ...(p && p.activo ? [{ texto: 'Desactivar', alPulsar: () => desactivar(p.id) }] : []),
        { texto: 'Cancelar', alPulsar: cerrarModal },
        { texto: 'Guardar', estilo: 'btn--primario', alPulsar: btn => guardar(p, btn) },
      ],
    });

    $('#pr-elegir').addEventListener('click', () => $('#pr-archivo').click());
    $('#pr-quitar').addEventListener('click', () => {
      imagenPendiente = null;
      $('#pr-vista').removeAttribute('src');
      $('#pr-img-nota').textContent = 'Sin imagen';
    });
    $('#pr-archivo').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const nota = $('#pr-img-nota');
      nota.textContent = 'Procesando…';
      try {
        imagenPendiente = await imagenReducida(file);
        $('#pr-vista').src = imagenPendiente;
        nota.textContent = Math.round(imagenPendiente.length / 1400) + ' KB aprox.';
      } catch (err) {
        imagenPendiente = undefined;
        nota.textContent = err.message;
      }
    });
  }

  async function guardar(p, btn) {
    const err = $('#pr-error');
    const datos = {
      sku:          $('#pr-sku').value.trim(),
      nombre:       $('#pr-nombre').value.trim(),
      unidad:       $('#pr-unidad').value.trim() || 'unidad',
      categoria_id: $('#pr-categoria').value ? Number($('#pr-categoria').value) : null,
      costo:        Number($('#pr-costo').value || 0),
      precio_venta: Number($('#pr-precio').value || 0),
      stock_minimo: Number($('#pr-minimo').value || 0),
    };

    if (!datos.sku || !datos.nombre) {
      err.textContent = 'El SKU y el nombre son obligatorios.';
      err.hidden = false;
      return;
    }

    btn.disabled = true;
    try {
      if (imagenPendiente === null) {
        datos.imagen_path = null;
      } else if (imagenPendiente) {
        datos.imagen_path = await INV.db.archivos.subir(imagenPendiente, datos.sku);
      }

      if (p) {
        await INV.db.productos.actualizar(p.id, datos);
      } else {
        const nuevo = await INV.db.productos.crear(datos);
        // La existencia inicial entra como movimiento, nunca como campo suelto.
        const inicial = Number(($('#pr-inicial') || {}).value || 0);
        if (inicial > 0) {
          await INV.db.movimientos.registrar({
            producto_id: nuevo.id, tipo: 'entrada', cantidad: inicial,
            es_negativo: false, costo_unitario: datos.costo,
            motivo: 'Existencia inicial', referencia: null, nota: null,
          });
        }
      }
      cerrarModal();
      avisar(p ? 'Producto actualizado' : 'Producto cargado');
      window.dispatchEvent(new Event('recargar-vista'));
    } catch (e) {
      err.textContent = e.message.includes('duplicate')
        ? 'Ya existe un producto con ese SKU.'
        : e.message;
      err.hidden = false;
      btn.disabled = false;
    }
  }

  async function desactivar(id) {
    // No se borra: los movimientos históricos deben seguir apuntando al producto.
    await INV.db.productos.desactivar(id);
    cerrarModal();
    avisar('Producto desactivado');
    window.dispatchEvent(new Event('recargar-vista'));
  }

  /* ---------------- Vista ---------------- */

  INV.vistas = INV.vistas || {};
  INV.vistas.productos = {
    titulo: 'Productos',
    eyebrow: 'Catálogo y existencias',
    abrirFormulario,

    acciones: () => [
      { texto: 'Cargar producto', estilo: 'btn--primario', alPulsar: () => abrirFormulario() },
      {
        texto: 'Exportar', estilo: 'btn--secundario',
        alPulsar: () => {
          if (!filas.length) return avisar('No hay productos que exportar', 'error');
          descargarCSV(`existencias-${new Date().toISOString().slice(0,10)}.csv`, [
            { titulo: 'SKU',       valor: f => f.sku },
            { titulo: 'Producto',  valor: f => f.nombre },
            { titulo: 'Categoría', valor: f => f.categoria ?? '' },
            { titulo: 'Unidad',    valor: f => f.unidad },
            { titulo: 'Stock',     valor: f => f.stock },
            { titulo: 'Mínimo',    valor: f => f.stock_minimo },
            { titulo: 'Costo',     valor: f => f.costo },
            { titulo: 'Precio',    valor: f => f.precio_venta },
            { titulo: 'Valor',     valor: f => f.valor_inventario },
          ], filas);
        },
      },
    ],

    render: async contenedor => {
      contenedor.innerHTML = cargando();
      [cats, filas, catalogo] = await Promise.all([
        INV.db.categorias.listar(),
        INV.db.stock.actual(),
        INV.db.productos.listar({ soloActivos: false }),
      ]);

      if (!catalogo.length) {
        contenedor.innerHTML = vacio(
          'El catálogo está vacío',
          'Carga el primer producto para empezar a mover existencias.',
          '<button class="btn btn--primario" id="pr-primero">Cargar producto</button>'
        );
        $('#pr-primero').addEventListener('click', () => abrirFormulario());
        return;
      }

      const valor = filas.reduce((s, f) => s + Number(f.valor_inventario), 0);
      const unidades = filas.reduce((s, f) => s + Number(f.stock), 0);
      const bajos = filas.filter(f => Number(f.stock) <= Number(f.stock_minimo)).length;
      const inactivos = catalogo.filter(p => !p.activo);

      contenedor.innerHTML = `
        <div class="mosaico mosaico--auto" style="margin-bottom:14px">
          <div class="metrica anim" style="--i:0">
            <div class="metrica__etiqueta">Productos</div>
            <div class="metrica__valor">${filas.length}</div>
            <div class="metrica__pie">${inactivos.length} inactivos</div>
          </div>
          <div class="metrica metrica--teal anim" style="--i:1">
            <div class="metrica__etiqueta">Unidades</div>
            <div class="metrica__valor">${cantidad(unidades)}</div>
            <div class="metrica__pie">en almacén</div>
          </div>
          <div class="metrica anim" style="--i:2">
            <div class="metrica__etiqueta">Valor</div>
            <div class="metrica__valor">${numero(valor)}</div>
            <div class="metrica__pie">a costo</div>
          </div>
          <div class="metrica metrica--ambar anim" style="--i:3">
            <div class="metrica__etiqueta">Bajo mínimo</div>
            <div class="metrica__valor">${bajos}</div>
            <div class="metrica__pie">requieren reposición</div>
          </div>
        </div>

        <div class="ficha anim" style="--i:4">
          <div class="ficha__cabecera">
            <h3 class="ficha__titulo">Existencias</h3>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
              <input class="buscador" type="search" id="pr-buscar" placeholder="Buscar por nombre o SKU">
              ${inactivos.length ? `<button id="pr-inactivos" class="btn btn--secundario btn--chico">${verInactivos ? 'Ocultar' : 'Ver'} inactivos</button>` : ''}
            </div>
          </div>
          <div class="lista lista--stock" id="pr-lista">${pintar('')}</div>
        </div>`;

      $('#pr-buscar').addEventListener('input', e => {
        $('#pr-lista').innerHTML = pintar(e.target.value.toLowerCase());
        enlazar();
      });

      const btnInact = $('#pr-inactivos');
      if (btnInact) btnInact.addEventListener('click', () => {
        verInactivos = !verInactivos;
        INV.vistas.productos.render(contenedor);
      });

      enlazar();
    },
  };

  function pintar(termino) {
    let lista = filas.filter(f =>
      !termino || f.nombre.toLowerCase().includes(termino) || f.sku.toLowerCase().includes(termino));

    // Lo que exige atención primero: sin stock, luego bajo mínimo, luego el resto.
    lista.sort((a, b) => {
      const p = f => Number(f.stock) <= 0 ? 0 : Number(f.stock) <= Number(f.stock_minimo) ? 1 : 2;
      return p(a) - p(b) || a.nombre.localeCompare(b.nombre);
    });

    let html = lista.map(ficha).join('');

    if (verInactivos) {
      const inactivos = catalogo.filter(p => !p.activo &&
        (!termino || p.nombre.toLowerCase().includes(termino) || p.sku.toLowerCase().includes(termino)));
      html += inactivos.map((p, i) => `
        <div class="lista__item apagado" style="--i:${Math.min(i, 24)}" data-abrir="${p.id}" role="button" tabindex="0">
          <span class="lista__nombre">${esc(p.nombre)}
            <span class="lista__sub">${esc(p.sku)} · inactivo</span></span>
          <span></span>
          <span class="lista__dato"><b>—</b><small>${esc(p.unidad)}</small></span>
        </div>`).join('');
    }

    return html || '<div class="vacio"><h4>Sin resultados</h4><p>Ningún producto coincide con la búsqueda.</p></div>';
  }

  function enlazar() {
    $$('[data-abrir]').forEach(el => {
      const abrir = () => { location.hash = '#/producto/' + el.dataset.abrir; };
      el.addEventListener('click', abrir);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
    });
  }
})();
