/* =====================================================================
   Comercios — pantalla del super administrador.
   Cada comercio es una instalación aparte: su catálogo, su inventario,
   sus clientes y sus ventas no se cruzan con los de nadie más. Aquí se
   crean, se configuran, se elige en cuál trabajar y se eliminan.
   ===================================================================== */
(function () {
  const { $, $$, esc, numero, fecha, avisar, abrirModal, cerrarModal,
          cargando, vacio } = INV.ui;

  const iniciales = n => String(n || '?').trim().split(/\s+/).slice(0, 2)
    .map(x => x[0]).join('').toUpperCase();

  INV.vistas = INV.vistas || {};
  INV.vistas.comercios = {
    titulo: 'Comercios',
    eyebrow: 'Instalaciones independientes',

    acciones: () => [
      { texto: 'Nuevo comercio', estilo: 'btn--primario', permiso: 'comercios.gestionar',
        alPulsar: () => formulario() },
    ],

    render: async contenedor => {
      contenedor.innerHTML = cargando();
      const [comercios, actual] = await Promise.all([
        INV.db.comercios.listar(),
        INV.db.comercio.obtener().catch(() => null),
      ]);

      if (!comercios.length) {
        contenedor.innerHTML = vacio('Sin comercios',
          'Crea el primero para empezar a operar.',
          '<button class="btn btn--primario" id="co-primero">Nuevo comercio</button>');
        $('#co-primero').addEventListener('click', () => formulario());
        return;
      }

      const enUso = actual ? actual.id : null;

      contenedor.innerHTML = `
        <div class="ficha anim" style="--i:0; margin-bottom:14px">
          <div class="ficha__cabecera">
            <div>
              <h3 class="ficha__titulo">${comercios.length} comercio${comercios.length > 1 ? 's' : ''}</h3>
              <p class="ficha__nota">los datos de cada uno son independientes</p>
            </div>
          </div>
          <div class="lista lista--com">
            ${comercios.map((c, i) => `
              <div class="lista__item ${c.activo === false ? 'apagado' : ''}" style="--i:${i}">
                <span class="miniatura miniatura--vacia">${esc(iniciales(c.nombre))}</span>
                <span class="lista__nombre">${esc(c.nombre)}
                  ${c.id === enUso ? '<span class="pastilla pastilla--entrada">en uso</span>' : ''}
                  <span class="lista__sub">${esc(c.rif || 'sin RIF')}${c.telefono ? ' · ' + esc(c.telefono) : ''}
                    ${c.productos !== undefined ? ` · ${c.productos} productos · ${c.ventas} ventas · ${c.operadores} operadores` : ''}</span></span>
                <span class="lista__dato"><b>${numero(c.iva_tasa, 0)}%</b><small>IVA</small></span>
                <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end">
                  ${c.id === enUso ? ''
                    : `<button class="btn btn--secundario btn--chico" data-usar="${c.id}">Trabajar aquí</button>`}
                  <button class="btn btn--secundario btn--chico" data-editar="${c.id}">Editar</button>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <div class="ficha anim" style="--i:1">
          <div class="ficha__cabecera">
            <h3 class="ficha__titulo">Cómo funciona la separación</h3>
          </div>
          <div class="ficha__cuerpo">
            <p style="font-size:14px; color:var(--tinta-2); margin:0 0 10px">
              Cada comercio lleva su propio catálogo, kardex, cartera de clientes y
              numeración de comprobantes. Dos comercios pueden usar el mismo código de
              producto o tener al mismo cliente sin estorbarse, y cada uno empieza su
              facturación en F-000001.
            </p>
            <p style="font-size:14px; color:var(--tinta-2); margin:0">
              Los operadores pertenecen a un comercio y solo ven el suyo. Tú, como super
              administrador, cambias de comercio con <b>Trabajar aquí</b>: a partir de ese
              momento todas las pantallas muestran los datos de ese comercio.
            </p>
          </div>
        </div>`;

      $$('[data-usar]').forEach(b => b.addEventListener('click', () => cambiar(b.dataset.usar)));
      $$('[data-editar]').forEach(b => b.addEventListener('click', () =>
        formulario(comercios.find(c => String(c.id) === b.dataset.editar), enUso)));
    },
  };

  async function cambiar(id) {
    try {
      await INV.db.comercios.cambiar(id);
      await INV.comercio.recargar();
      avisar('Ahora trabajas en ' + INV.comercio.actual().nombre);
      window.dispatchEvent(new Event('recargar-vista'));
    } catch (e) {
      avisar(e.message, 'error');
    }
  }

  function formulario(c = null, enUso = null) {
    abrirModal({
      titulo: c ? 'Editar comercio' : 'Nuevo comercio',
      cuerpo: `
        <div class="campo">
          <label for="cm-nombre">Razón social</label>
          <input id="cm-nombre" type="text" value="${esc(c ? c.nombre : '')}" placeholder="Bodega La Esquina, C.A.">
        </div>
        <div class="campos-fila">
          <div class="campo">
            <label for="cm-rif">RIF</label>
            <input id="cm-rif" type="text" value="${esc(c ? c.rif : '')}" placeholder="J-00000000-0">
          </div>
          <div class="campo">
            <label for="cm-telefono">Teléfono</label>
            <input id="cm-telefono" type="tel" value="${esc(c ? (c.telefono ?? '') : '')}" placeholder="0251-0000000">
          </div>
        </div>
        <div class="campo">
          <label for="cm-direccion">Dirección fiscal</label>
          <textarea id="cm-direccion" rows="2">${esc(c ? (c.direccion ?? '') : '')}</textarea>
        </div>
        <div class="campos-fila">
          <div class="campo">
            <label for="cm-iva">IVA (%)</label>
            <input id="cm-iva" type="number" min="0" max="100" step="0.01" value="${c ? c.iva_tasa : 16}">
          </div>
          <div class="campo">
            <label for="cm-usd">Tasa USD</label>
            <input id="cm-usd" type="number" min="0" step="0.0001" value="${c ? c.tasa_usd : 0}">
          </div>
        </div>
        <p class="subida__nota" style="margin:0">
          El resto de los ajustes —mensaje del ticket, formato de impresión— se
          completan desde Comercio una vez estés trabajando en él.
        </p>
        <p id="cm-error" class="error" hidden></p>`,
      acciones: [
        ...(c && c.id !== enUso ? [{ texto: 'Eliminar', alPulsar: () => eliminar(c) }] : []),
        { texto: 'Cancelar', alPulsar: cerrarModal },
        { texto: 'Guardar', estilo: 'btn--primario', alPulsar: btn => guardar(c, btn) },
      ],
    });
  }

  async function guardar(c, btn) {
    const err = $('#cm-error');
    const datos = {
      nombre:    $('#cm-nombre').value.trim(),
      rif:       $('#cm-rif').value.trim(),
      telefono:  $('#cm-telefono').value.trim(),
      direccion: $('#cm-direccion').value.trim(),
      iva_tasa:  Number($('#cm-iva').value || 16),
      tasa_usd:  Number($('#cm-usd').value || 0),
    };
    if (!datos.nombre) {
      err.textContent = 'La razón social es obligatoria.'; err.hidden = false; return;
    }

    btn.disabled = true;
    try {
      if (c) await INV.db.comercios.actualizar(c.id, datos);
      else   await INV.db.comercios.crear(datos);
      cerrarModal();
      avisar(c ? 'Comercio actualizado' : 'Comercio creado');
      await INV.comercio.recargar();
      window.dispatchEvent(new Event('recargar-vista'));
    } catch (e) {
      err.textContent = e.message; err.hidden = false; btn.disabled = false;
    }
  }

  function eliminar(c) {
    // Eliminar un comercio se lleva por delante todo lo suyo: se pide
    // teclear el nombre, igual que al anular una venta.
    abrirModal({
      titulo: 'Eliminar ' + c.nombre,
      cuerpo: `
        <p style="margin:0 0 14px; font-size:14px; color:var(--tinta-2)">
          Se borrará su catálogo, su inventario, sus clientes y todas sus ventas.
          No hay forma de recuperarlo.
        </p>
        ${c.operadores ? `<p class="error" style="margin:0 0 14px">
          Tiene ${c.operadores} operador${c.operadores > 1 ? 'es' : ''} asignado${c.operadores > 1 ? 's' : ''}.
          Reasígnalos o elimínalos antes.</p>` : ''}
        <div class="campo" style="margin:0">
          <label for="cm-confirmar">Escribe <b>${esc(c.nombre)}</b> para confirmar</label>
          <input id="cm-confirmar" type="text" autocomplete="off">
        </div>
        <p id="cm-error2" class="error" hidden></p>`,
      acciones: [
        { texto: 'Cancelar', alPulsar: cerrarModal },
        { texto: 'Eliminar definitivamente', estilo: 'btn--primario', alPulsar: async btn => {
          const err = $('#cm-error2');
          if ($('#cm-confirmar').value.trim() !== c.nombre) {
            err.textContent = 'El nombre no coincide.'; err.hidden = false; return;
          }
          btn.disabled = true;
          try {
            await INV.db.comercios.eliminar(c.id);
            cerrarModal();
            avisar('Comercio eliminado');
            window.dispatchEvent(new Event('recargar-vista'));
          } catch (e) {
            err.textContent = e.message; err.hidden = false; btn.disabled = false;
          }
        }},
      ],
    });
  }
})();
