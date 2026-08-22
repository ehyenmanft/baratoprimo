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

      if (!c) {
        if (INV.permisos.puede('comercios.gestionar')) {
          // Supervisa: no le falta nada, solo no ha elegido dónde situarse
          contenedor.innerHTML = sinSeleccion();
          $('#mc-ir-comercios').addEventListener('click', () => { location.hash = '#/comercios'; });
        } else if (INV.permisos.puede('ajustes.comercio')) {
          // Puede resolverlo solo: se le da el formulario, no una consulta SQL
          contenedor.innerHTML = formularioPrimerComercio();
          $('#pc-crear').addEventListener('click', btn => crearPrimero(btn));
          $('#pc-nombre').focus();
        } else {
          contenedor.innerHTML = sinComercio();
        }
        return;
      }

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

  /* El super administrador no pertenece a ningún comercio: supervisa
     todos. Cuando no tiene ninguno en contexto, esto no es un fallo sino
     su estado natural, y basta con decirle dónde elegir. */
  function sinSeleccion() {
    return `
      <div class="ficha anim">
        <div class="ficha__cabecera">
          <h3 class="ficha__titulo">No estás dentro de ningún comercio</h3>
        </div>
        <div class="ficha__cuerpo">
          <p style="font-size:14px; color:var(--tinta-2); margin:0 0 14px">
            Como super administrador no perteneces a un comercio: los supervisas
            todos. Esta pantalla edita los datos del comercio en el que estés
            situado, así que primero elige uno.
          </p>
          <button class="btn btn--primario" id="mc-ir-comercios">Ver los comercios</button>
        </div>
      </div>`;
  }

  /* Un administrador sin comercio puede crearlo él mismo: el formulario
     lo da de alta y se lo asigna en el mismo acto. */
  function formularioPrimerComercio() {
    return `
      <div class="ficha anim" style="max-width:640px">
        <div class="detalle__encabezado">
          <div>
            <h2 class="detalle__titulo">Crea tu comercio</h2>
            <div class="detalle__meta"><span>Primer paso</span></div>
          </div>
        </div>

        <div class="ficha__cuerpo" style="padding-top:18px">
          <p style="font-size:14px; color:var(--tinta-2); margin:0 0 18px">
            Tu cuenta todavía no está ligada a ningún comercio. Complétalo aquí y
            queda asignado a tu nombre: a partir de ese momento el catálogo, el
            inventario y las ventas que registres serán suyos.
          </p>

          <div class="campo">
            <label for="pc-nombre">Razón social</label>
            <input id="pc-nombre" type="text" placeholder="Bodega La Esquina, C.A.">
          </div>
          <div class="campos-fila">
            <div class="campo">
              <label for="pc-rif">RIF</label>
              <input id="pc-rif" type="text" placeholder="J-00000000-0">
            </div>
            <div class="campo">
              <label for="pc-telefono">Teléfono</label>
              <input id="pc-telefono" type="tel" placeholder="0251-0000000">
            </div>
          </div>
          <div class="campo">
            <label for="pc-direccion">Dirección fiscal</label>
            <textarea id="pc-direccion" rows="2" placeholder="Calle, local, ciudad"></textarea>
          </div>
          <div class="campos-fila">
            <div class="campo">
              <label for="pc-iva">IVA (%)</label>
              <input id="pc-iva" type="number" min="0" max="100" step="0.01" value="16">
            </div>
            <div class="campo">
              <label for="pc-usd">Tasa USD — opcional</label>
              <input id="pc-usd" type="number" min="0" step="0.0001" value="0">
            </div>
          </div>

          <p id="pc-error" class="error" hidden></p>
          <button class="btn btn--primario btn--ancho" id="pc-crear">
            Crear el comercio y empezar
          </button>
          <p class="subida__nota" style="margin-top:12px; text-align:center">
            Todo esto se puede cambiar después desde esta misma pantalla.
          </p>
        </div>
      </div>`;
  }

  async function crearPrimero(btn) {
    const err = $('#pc-error');
    err.hidden = true;

    const nombre = $('#pc-nombre').value.trim();
    if (!nombre) {
      err.textContent = 'La razón social es obligatoria.'; err.hidden = false; return;
    }

    btn.disabled = true;
    btn.textContent = 'Creando…';
    try {
      await INV.db.comercios.crearMio({
        nombre,
        rif:       $('#pc-rif').value.trim(),
        telefono:  $('#pc-telefono').value.trim(),
        direccion: $('#pc-direccion').value.trim(),
        iva_tasa:  Number($('#pc-iva').value || 16),
        tasa_usd:  Number($('#pc-usd').value || 0),
      });
      await INV.comercio.recargar();
      avisar(nombre + ' quedó asignado a tu cuenta');
      // La sesión ya tiene comercio: se recarga el menú y se entra a operar
      window.dispatchEvent(new Event('sesion-cambiada'));
      location.hash = '#/inicio';
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Crear el comercio y empezar';
    }
  }

  /* Roles que no pueden crear comercios: solo se les dice qué falta y a
     quién pedírselo. Nada de instrucciones de base de datos. */
  function sinComercio() {
    return `
      <div class="ficha anim">
        <div class="ficha__cabecera">
          <h3 class="ficha__titulo">Tu cuenta no tiene comercio asignado</h3>
        </div>
        <div class="ficha__cuerpo">
          <p style="font-size:14px; color:var(--tinta-2); margin:0">
            Entraste bien, pero tu cuenta todavía no está ligada a ningún
            comercio, así que no hay datos que mostrar. Pide a un administrador
            que te asigne uno desde <b>Operadores</b>.
          </p>
        </div>
      </div>`;
  }

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
    /* Sin comercio no se inventa uno: mostrar el nombre de fábrica de
       config.js haría creer que la instalación está bien cuando no lo
       está. Solo se usa como respaldo donde no hay control de acceso. */
    actual: () => {
      if (INV.comercio.datos) return INV.comercio.datos;
      const conBase = INV.db && INV.db.etiqueta === 'supabase';
      return conBase ? {} : (INV.config.NEGOCIO || {});
    },
    hay: () => !!INV.comercio.datos,
  };
})();
