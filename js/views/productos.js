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
        <span class="sku">${esc(f.sku)}</span>
        ${f.exento_iva ? '<span class="pastilla pastilla--exento">exento de IVA</span>' : ''}
        <span class="lista__sub">${esc(f.categoria ?? 'sin categoría')}</span>
        <span class="lista__precio">${INV.tasas.html(f.precio_venta)}</span></span>
      ${medidor(f.stock, f.stock_minimo, Math.min(i, 24))}
      <span class="lista__dato"><b class="${Number(f.stock) <= 0 ? 'neg' : Number(f.stock) <= Number(f.stock_minimo) ? '' : ''}">${cantidad(f.stock)}</b><small>${esc(f.unidad)}</small></span>
    </div>`;

  /* ---------------- Formulario ---------------- */

  /* Renombrar y eliminar categorías. Al eliminar una, sus productos no
     se borran: quedan sin categoría, que es lo que espera cualquiera. */
  async function gestionarCategorias() {
    const [cats, productos] = await Promise.all([
      INV.db.categorias.listar(),
      INV.db.productos.listar(),
    ]);

    const cuantos = id => productos.filter(p => p.categoria_id === id).length;

    abrirModal({
      titulo: 'Categorías',
      cuerpo: `
        <div class="campo">
          <label for="gc-nueva">Crear una categoría</label>
          <div style="display:grid; grid-template-columns:1fr auto; gap:8px">
            <input id="gc-nueva" type="text" placeholder="Bebidas, Limpieza, Repuestos…">
            <button type="button" class="btn btn--primario btn--chico" id="gc-crear">Crear</button>
          </div>
        </div>

        ${cats.length ? `
          <div class="lista" style="margin-top:6px">
            ${cats.map(c => `
              <div class="lista__item" style="grid-template-columns:1fr auto auto; gap:8px">
                <input type="text" value="${esc(c.nombre)}" data-nombre="${c.id}"
                       style="padding:7px 10px; font-size:14px">
                <span class="lista__sub" style="align-self:center">${cuantos(c.id)} prod.</span>
                <button type="button" class="btn btn--fantasma btn--chico" data-borrar="${c.id}"
                        title="Eliminar">&#10005;</button>
              </div>`).join('')}
          </div>
          <p class="subida__nota" style="margin-top:10px">
            Cambia un nombre y pulsa fuera para guardarlo. Al eliminar una categoría
            sus productos quedan sin clasificar, no se borran.
          </p>`
        : '<p class="subida__nota">Todavía no hay categorías.</p>'}
        <p id="gc-error" class="error" hidden></p>`,
      acciones: [{ texto: 'Listo', estilo: 'btn--primario', alPulsar: () => {
        cerrarModal();
        window.dispatchEvent(new Event('recargar-vista'));
      }}],
    });

    const fallar = texto => {
      $('#gc-error').textContent = texto;
      $('#gc-error').hidden = false;
    };

    $('#gc-crear').addEventListener('click', async () => {
      const nombre = $('#gc-nueva').value.trim();
      if (!nombre) return fallar('Escribe el nombre.');
      try {
        await INV.db.categorias.crear(nombre);
        cerrarModal();
        avisar(`Categoría "${nombre}" creada`);
        gestionarCategorias();
      } catch (e) {
        fallar(/duplicate|ya existe/i.test(e.message)
          ? 'Ya existe una categoría con ese nombre.' : e.message);
      }
    });

    $$('[data-nombre]').forEach(input => {
      const original = input.value;
      input.addEventListener('change', async () => {
        const nombre = input.value.trim();
        if (!nombre || nombre === original) { input.value = original; return; }
        try {
          await INV.db.categorias.actualizar(Number(input.dataset.nombre), { nombre });
          avisar('Categoría renombrada');
        } catch (e) {
          input.value = original;
          fallar(/duplicate|ya existe/i.test(e.message)
            ? 'Ya existe una categoría con ese nombre.' : e.message);
        }
      });
    });

    $$('[data-borrar]').forEach(b => b.addEventListener('click', async () => {
      const id = Number(b.dataset.borrar);
      const n = cuantos(id);
      const cat = cats.find(c => c.id === id);
      if (n && !confirm(`"${cat.nombre}" tiene ${n} producto${n > 1 ? 's' : ''}. ` +
                        'Al eliminarla quedarán sin categoría. ¿Continuar?')) return;
      try {
        await INV.db.categorias.eliminar(id);
        cerrarModal();
        avisar('Categoría eliminada');
        gestionarCategorias();
      } catch (e) {
        fallar(e.message);
      }
    }));
  }

  /* Cambiar la moneda del catálogo no convierte nada por sí solo: los
     números guardados siguen siendo los mismos y solo cambia cómo se
     leen. Esto los convierte de verdad, una sola vez y con vista previa,
     porque equivocarse aquí multiplica o divide todo el catálogo. */
  async function convertirCatalogo() {
    const tasa = INV.tasas.usd();
    if (!tasa) return avisar('No hay tasa de cambio: no se puede convertir', 'error');

    const productos = await INV.db.productos.listar();
    if (!productos.length) return avisar('No hay productos que convertir', 'error');

    const enDolares = INV.tasas.catalogoEnDolares();
    const hacia = enDolares ? 'dólares' : 'bolívares';
    const desde = enDolares ? 'bolívares' : 'dólares';
    const convertir = v => enDolares
      ? Math.round((Number(v) / tasa) * 100) / 100
      : Math.round(Number(v) * tasa * 100) / 100;

    const muestra = productos.slice(0, 5);

    abrirModal({
      titulo: 'Convertir el catálogo a ' + hacia,
      cuerpo: `
        <p style="font-size:14px; color:var(--tinta-2); margin:0 0 14px">
          Convierte el costo y el precio de <b>${productos.length} productos</b>
          usando la tasa vigente (${numero(tasa, 2)} Bs/$), pasándolos de ${desde}
          a ${hacia}. Úsalo una sola vez, justo después de cambiar la moneda
          del catálogo en Mi comercio.
        </p>
        <p style="font-size:13px; color:var(--tinta-2); margin:0 0 8px"><b>Así quedarían:</b></p>
        <div class="lista" style="margin-bottom:14px">
          ${muestra.map(p => `
            <div class="lista__item" style="grid-template-columns:1fr auto">
              <span class="lista__nombre">${esc(p.nombre)}
                <span class="lista__sub">${esc(p.sku)}</span></span>
              <span class="lista__dato"><b>${numero(p.precio_venta)} → ${numero(convertir(p.precio_venta))}</b></span>
            </div>`).join('')}
        </div>
        ${productos.length > 5 ? `<p class="ficha__nota">y ${productos.length - 5} más</p>` : ''}
        <div class="campo" style="margin:0">
          <label for="cv-confirmar">Escribe <b>CONVERTIR</b> para confirmar</label>
          <input id="cv-confirmar" type="text" autocomplete="off">
        </div>
        <p id="cv-error" class="error" hidden></p>`,
      acciones: [
        { texto: 'Cancelar', alPulsar: cerrarModal },
        { texto: 'Convertir', estilo: 'btn--primario', alPulsar: async btn => {
          if ($('#cv-confirmar').value.trim().toUpperCase() !== 'CONVERTIR') {
            $('#cv-error').textContent = 'Escribe CONVERTIR para confirmar.';
            $('#cv-error').hidden = false; return;
          }
          btn.disabled = true; btn.textContent = 'Convirtiendo…';
          let hechos = 0;
          try {
            for (const p of productos) {
              await INV.db.productos.actualizar(p.producto_id ?? p.id, {
                costo: convertir(p.costo),
                precio_venta: convertir(p.precio_venta),
              });
              hechos++;
            }
            cerrarModal();
            avisar(`${hechos} productos convertidos a ${hacia}`);
            window.dispatchEvent(new Event('recargar-vista'));
          } catch (e) {
            $('#cv-error').textContent = `Se convirtieron ${hechos} de ${productos.length}: ` + e.message;
            $('#cv-error').hidden = false;
            btn.disabled = false; btn.textContent = 'Convertir';
          }
        }},
      ],
    });
  }

  async function abrirFormulario(p = null) {
    if (!cats.length) cats = await INV.db.categorias.listar();
    imagenPendiente = undefined;

    abrirModal({
      titulo: p ? 'Editar producto' : 'Cargar producto',
      cuerpo: `
        <div class="campos-fila">
          <div class="campo">
            <label for="pr-sku">SKU / Código de barras</label>
            <div style="display:grid; grid-template-columns:1fr auto; gap:6px">
              <input id="pr-sku" type="text" value="${esc(p ? p.sku : '')}" placeholder="SKU-001 o código de barras">
              <button type="button" class="btn btn--secundario btn--chico" id="pr-escanear-sku" title="Escanear código con cámara">📷</button>
            </div>
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
          <div style="display:grid; grid-template-columns:1fr auto; gap:8px">
            <select id="pr-categoria">
              <option value="">Sin categoría</option>
              ${cats.map(c => `<option value="${c.id}" ${p && p.categoria_id === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
            </select>
            <button type="button" class="btn btn--secundario btn--chico" id="pr-nueva-cat"
                    title="Crear una categoría">+ Nueva</button>
          </div>
          <span class="subida__nota" id="pr-cat-nota" style="margin-top:6px; display:block"></span>
        </div>

        <label class="rol-opcion" style="cursor:pointer; margin-bottom:14px">
          <input type="checkbox" id="pr-exento" ${p && p.exento_iva ? 'checked' : ''}>
          <span><b>Exento de IVA</b>
            <span class="lista__sub">No se le aplica impuesto al venderlo. La factura lo
              separa del resto como base exenta.</span></span>
        </label>
        <div class="campos-fila">
          <div class="campo">
            <label for="pr-costo">Costo ${INV.tasas.simbolo()}</label>
            <input id="pr-costo" type="number" step="0.01" min="0" value="${p ? p.costo : 0}">
            <span class="equivalente" id="pr-costo-eq"></span>
          </div>
          <div class="campo">
            <label for="pr-precio">Precio de venta ${INV.tasas.simbolo()}</label>
            <input id="pr-precio" type="number" step="0.01" min="0" value="${p ? p.precio_venta : 0}">
            <span class="equivalente" id="pr-precio-eq"></span>
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

    /* Se escribe en una moneda y se ve en la otra: así nadie se equivoca
       de orden de magnitud al cargar un precio. */
    /* Crear una categoría sin salir del formulario: obligar a ir a otra
       pantalla a media carga de producto se traduce en catálogos sin
       clasificar. */
    $('#pr-nueva-cat').addEventListener('click', async () => {
      const nombre = (prompt('Nombre de la categoría nueva') || '').trim();
      if (!nombre) return;

      const nota = $('#pr-cat-nota');
      try {
        const nueva = await INV.db.categorias.crear(nombre);
        const sel = $('#pr-categoria');
        const op = document.createElement('option');
        op.value = nueva.id;
        op.textContent = nueva.nombre;
        op.selected = true;
        sel.append(op);
        nota.style.color = 'var(--esmeralda)';
        nota.textContent = `"${nueva.nombre}" creada y seleccionada.`;
      } catch (e) {
        nota.style.color = 'var(--rosa)';
        nota.textContent = /duplicate|ya existe/i.test(e.message)
          ? 'Ya existe una categoría con ese nombre.'
          : e.message;
      }
    });

    /* Costo y precio se teclean con el decimal corrido. El equivalente en
       la otra moneda escucha el evento 'monto', que es el que emiten
       estos campos al cambiar. */
    INV.ui.montoAutomatico('#pr-costo');
    INV.ui.montoAutomatico('#pr-precio');
    INV.tasas.enlazarEquivalente('#pr-costo', '#pr-costo-eq');
    INV.tasas.enlazarEquivalente('#pr-precio', '#pr-precio-eq');

    $('#pr-elegir').addEventListener('click', () => $('#pr-archivo').click());
    const btnEscanearSku = $('#pr-escanear-sku');
    if (btnEscanearSku) {
      btnEscanearSku.addEventListener('click', () => {
        if (!INV.escaner) return avisar('Módulo de escáner no disponible', 'error');
        INV.escaner.abrirModalEscaneo({
          titulo: 'Escanear código para el producto',
          descripcion: 'Apunta la cámara al código de barras del producto.',
          modoContinuo: false,
          onScan: (codigo, { cerrar }) => {
            const inp = $('#pr-sku');
            if (inp) inp.value = codigo;
            cerrar();
          }
        });
      });
    }
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
      exento_iva: $('#pr-exento').checked,
      costo:        INV.ui.leerMonto('#pr-costo'),
      precio_venta: INV.ui.leerMonto('#pr-precio'),
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
      { texto: 'Categorías', alPulsar: () => gestionarCategorias() },
      { texto: 'Convertir precios', alPulsar: () => convertirCatalogo() },
      {
        texto: 'Exportar', estilo: 'btn--secundario',
        alPulsar: () => {
          if (!filas.length) return avisar('No hay productos que exportar', 'error');
          descargarCSV(`existencias-${new Date().toISOString().slice(0,10)}.csv`, [
            { titulo: 'SKU',       valor: f => f.sku },
            { titulo: 'Producto',  valor: f => f.nombre },
            { titulo: 'Categoría', valor: f => f.categoria ?? '' },
            { titulo: 'Exento de IVA', valor: f => f.exento_iva ? 'Sí' : 'No' },
            { titulo: 'Unidad',    valor: f => f.unidad },
            { titulo: 'Stock',     valor: f => f.stock },
            { titulo: 'Mínimo',    valor: f => f.stock_minimo },
            { titulo: 'Costo ' + INV.tasas.simbolo(),  valor: f => f.costo },
            { titulo: 'Precio ' + INV.tasas.simbolo(), valor: f => f.precio_venta },
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
              <div style="display:flex; gap:6px; align-items:center">
                <input class="buscador" type="search" id="pr-buscar" placeholder="Buscar por nombre o SKU">
                <button type="button" class="btn btn--secundario btn--chico" id="pr-btn-escanear" title="Escanear código de barras o QR" style="padding:7px 11px">📷</button>
              </div>
              ${inactivos.length ? `<button id="pr-inactivos" class="btn btn--secundario btn--chico">${verInactivos ? 'Ocultar' : 'Ver'} inactivos</button>` : ''}
            </div>
          </div>
          <div class="lista lista--stock" id="pr-lista">${pintar('')}</div>
        </div>`;

      $('#pr-buscar').addEventListener('input', e => {
        $('#pr-lista').innerHTML = pintar(e.target.value.toLowerCase());
        enlazar();
      });

      const btnEscanearList = $('#pr-btn-escanear');
      if (btnEscanearList) {
        btnEscanearList.addEventListener('click', () => {
          if (!INV.escaner) return avisar('Módulo de escáner no disponible', 'error');
          INV.escaner.abrirModalEscaneo({
            titulo: 'Buscar producto por código',
            descripcion: 'Apunta la cámara al código de barras o QR.',
            modoContinuo: false,
            onScan: (codigo, { cerrar }) => {
              const inp = $('#pr-buscar');
              if (inp) {
                inp.value = codigo;
                $('#pr-lista').innerHTML = pintar(codigo.toLowerCase());
                enlazar();
              }
              cerrar();
            }
          });
        });
      }

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
