/* =====================================================================
   Comercio — los datos del emisor.
   Es lo que encabeza facturas y tickets, así que se edita aquí y no en
   un archivo de configuración.
   ===================================================================== */
(function () {
  const { $, esc, numero, avisar, cargando } = INV.ui;

  INV.vistas = INV.vistas || {};
  INV.vistas.comercio = {
    titulo: 'Mi comercio',
    eyebrow: 'Datos del emisor',

    acciones: () => [
      { texto: 'Guardar cambios', estilo: 'btn--primario', permiso: 'ajustes.comercio',
        alPulsar: btn => guardar(btn) },
    ],

    render: async contenedor => {
      contenedor.innerHTML = cargando();
      const c = await INV.db.comercio.obtener();
      const puede = INV.permisos.puede('ajustes.comercio');

      contenedor.innerHTML = `
        <div class="mosaico mosaico--2">
          <div>
            <div class="ficha anim" style="--i:0; margin-bottom:14px">
              <div class="ficha__cabecera">
                <div>
                  <h3 class="ficha__titulo">Identificación fiscal</h3>
                  <p class="ficha__nota">encabeza cada factura y cada ticket</p>
                </div>
              </div>
              <div class="ficha__cuerpo">
                <div class="campo">
                  <label for="co-nombre">Razón social</label>
                  <input id="co-nombre" type="text" value="${esc(c.nombre ?? '')}" placeholder="Mi Comercio, C.A.">
                </div>
                <div class="campos-fila">
                  <div class="campo">
                    <label for="co-rif">RIF</label>
                    <input id="co-rif" type="text" value="${esc(c.rif ?? '')}" placeholder="J-00000000-0">
                  </div>
                  <div class="campo">
                    <label for="co-telefono">Teléfono</label>
                    <input id="co-telefono" type="tel" value="${esc(c.telefono ?? '')}" placeholder="0212-0000000">
                  </div>
                </div>
                <div class="campo">
                  <label for="co-direccion">Dirección fiscal</label>
                  <textarea id="co-direccion" rows="2" placeholder="Av. Principal, Local 1, Caracas">${esc(c.direccion ?? '')}</textarea>
                </div>
                <div class="campo">
                  <label for="co-correo">Correo</label>
                  <input id="co-correo" type="email" value="${esc(c.correo ?? '')}" placeholder="contacto@micomercio.com">
                </div>
                <div class="campo" style="margin:0">
                  <label for="co-mensaje">Mensaje de cierre del ticket</label>
                  <input id="co-mensaje" type="text" value="${esc(c.mensaje ?? '')}" placeholder="¡Gracias por su compra!">
                </div>
              </div>
            </div>

            <div class="ficha anim" style="--i:1">
              <div class="ficha__cabecera">
                <div>
                  <h3 class="ficha__titulo">Valores por defecto</h3>
                  <p class="ficha__nota">se proponen al abrir una venta nueva</p>
                </div>
              </div>
              <div class="ficha__cuerpo">
                <div class="campos-fila">
                  <div class="campo">
                    <label for="co-iva">IVA (%)</label>
                    <input id="co-iva" type="number" min="0" max="100" step="0.01" value="${c.iva_tasa ?? 16}">
                  </div>
                  <div class="campo">
                    <label for="co-moneda">Símbolo de la moneda</label>
                    <input id="co-moneda" type="text" value="${esc(c.moneda ?? 'Bs')}" placeholder="Bs">
                  </div>
                </div>
                <div class="campos-fila">
                  <div class="campo">
                    <label for="co-usd">Tasa USD</label>
                    <input id="co-usd" type="number" min="0" step="0.0001" value="${c.tasa_usd ?? 0}">
                  </div>
                  <div class="campo">
                    <label for="co-eur">Tasa EUR</label>
                    <input id="co-eur" type="number" min="0" step="0.0001" value="${c.tasa_eur ?? 0}">
                  </div>
                </div>
                <div class="campo" style="margin:0">
                  <label for="co-ticket">Formato de impresión</label>
                  <select id="co-ticket">
                    <option value="58" ${c.ticket_ancho === '58' ? 'selected' : ''}>Rollo de 58 mm</option>
                    <option value="80" ${c.ticket_ancho === '80' ? 'selected' : ''}>Rollo de 80 mm</option>
                    <option value="a4" ${c.ticket_ancho === 'a4' ? 'selected' : ''}>Página completa</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div class="ficha anim" style="--i:2">
            <div class="ficha__cabecera">
              <div>
                <h3 class="ficha__titulo">Vista previa</h3>
                <p class="ficha__nota">encabezado del ticket</p>
              </div>
            </div>
            <div class="ficha__cuerpo">
              <div class="previa" id="co-previa"></div>
              <p class="subida__nota" style="margin-top:14px">
                Estos datos viajan a cada comprobante que emitas desde ahora.
                Los ya emitidos conservan el encabezado con el que se imprimieron.
                Si administras varios comercios, aquí solo se edita aquel en el
                que estás trabajando.
              </p>
            </div>
          </div>
        </div>`;

      if (!puede) {
        contenedor.querySelectorAll('input, textarea, select').forEach(e => { e.disabled = true; });
        avisar('Tu rol permite ver los datos del comercio, pero no cambiarlos');
      }

      ['co-nombre','co-rif','co-direccion','co-telefono','co-mensaje']
        .forEach(id => $('#' + id).addEventListener('input', previa));
      previa();
    },
  };

  function previa() {
    $('#co-previa').innerHTML = `
      <div class="previa__papel">
        <p class="previa__nombre">${esc($('#co-nombre').value || 'Mi Comercio')}</p>
        ${$('#co-rif').value ? `<p>RIF ${esc($('#co-rif').value)}</p>` : ''}
        ${$('#co-direccion').value ? `<p>${esc($('#co-direccion').value)}</p>` : ''}
        ${$('#co-telefono').value ? `<p>Telf. ${esc($('#co-telefono').value)}</p>` : ''}
        <hr>
        <p>COMPROBANTE DE VENTA</p>
        <p class="previa__numero">F-000001</p>
        <hr>
        <p style="margin-top:10px">${esc($('#co-mensaje').value || '')}</p>
      </div>`;
  }

  async function guardar(btn) {
    if (!INV.permisos.puede('ajustes.comercio'))
      return avisar('Tu rol no permite cambiar los datos del comercio', 'error');

    btn.disabled = true;
    try {
      await INV.db.comercio.guardar({
        nombre:       $('#co-nombre').value.trim() || 'Mi Comercio',
        rif:          $('#co-rif').value.trim(),
        direccion:    $('#co-direccion').value.trim(),
        telefono:     $('#co-telefono').value.trim(),
        correo:       $('#co-correo').value.trim(),
        mensaje:      $('#co-mensaje').value.trim(),
        iva_tasa:     Number($('#co-iva').value || 16),
        moneda:       $('#co-moneda').value.trim() || 'Bs',
        tasa_usd:     Number($('#co-usd').value || 0),
        tasa_eur:     Number($('#co-eur').value || 0),
        ticket_ancho: $('#co-ticket').value,
      });
      await INV.comercio.recargar();
      avisar('Datos del comercio actualizados');
    } catch (e) {
      avisar(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  /* Copia en memoria para que ticket y comprobante no consulten la base
     en cada impresión. */
  INV.comercio = {
    datos: null,
    recargar: async () => {
      try { INV.comercio.datos = await INV.db.comercio.obtener(); }
      catch (e) { INV.comercio.datos = null; }
      return INV.comercio.datos;
    },
    actual: () => INV.comercio.datos || INV.config.NEGOCIO || {},
  };
})();
