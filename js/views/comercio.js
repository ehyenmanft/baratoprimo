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

      /* Si la base es de una versión anterior, la vista mi_comercio puede
         no traer estas columnas: se avisa en lugar de dejar que el ajuste
         parezca no guardarse. */
      const faltanColumnas = c.moneda_precios === undefined || c.tasa_automatica === undefined;

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
                  <label>Logo del comercio (aparecerá en la factura y ticket)</label>
                  <div class="logo-subida" style="display:flex; align-items:center; gap:14px; margin-top:6px;">
                    <div id="co-logo-vista" style="width:72px; height:72px; border:1px dashed var(--linea); border-radius:var(--r-s); display:grid; place-items:center; background:var(--superficie-2); overflow:hidden; flex-shrink:0;">
                      ${c.logo_url ? `<img src="${esc(c.logo_url)}" alt="Logo" style="max-width:100%; max-height:100%; object-fit:contain;">` : '<span style="font-size:11px; color:var(--tinta-3); text-align:center;">Sin logo</span>'}
                    </div>
                    <div style="flex:1;">
                      <input type="file" id="co-logo-file" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none;">
                      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <button type="button" class="btn btn--secundario btn--chico" id="co-logo-btn">Subir logo</button>
                        <button type="button" class="btn btn--fantasma btn--chico" id="co-logo-quitar" style="color:var(--rosa);" ${c.logo_url ? '' : 'hidden'}>Quitar</button>
                      </div>
                      <span class="subida__nota" style="display:block; margin-top:6px; font-size:11.5px;">
                        Aparecerá en la parte superior antes del texto SENIAT e identificación fiscal.
                      </span>
                    </div>
                  </div>
                </div>
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
                ${faltanColumnas ? `
                  <div class="campo">
                    <p class="error" style="margin:0">
                      Tu base de datos no expone <b>moneda_precios</b>. Lo que cambies aquí
                      se guardará pero la aplicación no lo verá. Ejecuta
                      <b>migracion-vista-comercio.sql</b> en el editor SQL de Supabase.
                    </p>
                  </div>` : ''}

                <div class="campo">
                  <label for="co-moneda-precios">Moneda de los precios del catálogo</label>
                  <select id="co-moneda-precios">
                    <option value="USD" ${c.moneda_precios === 'USD' ? 'selected' : ''}>Dólares — se cobra en bolívares al cambio del día</option>
                    <option value="VES" ${c.moneda_precios !== 'USD' ? 'selected' : ''}>Bolívares</option>
                  </select>
                  <span class="subida__nota" style="margin-top:6px; display:block">
                    Cambiarlo no convierte los precios ya cargados: solo cambia en qué
                    moneda se interpretan. Si lo cambias, revisa el catálogo.
                  </span>
                </div>

                <div class="campo">
                  <label class="rol-opcion" style="cursor:pointer">
                    <input type="checkbox" id="co-tasa-auto" ${c.tasa_automatica !== false ? 'checked' : ''}>
                    <span><b>Seguir la tasa oficial del BCV</b>
                      <span class="lista__sub" id="co-tasa-estado"></span></span>
                  </label>
                </div>

                <div class="campos-fila">
                  <div class="campo">
                    <label for="co-usd">Tasa USD manual</label>
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
        contenedor.querySelectorAll('input, textarea, select, button').forEach(e => {
          if (e.id !== 'mc-ir-comercios') e.disabled = true;
        });
        avisar('Tu rol permite ver los datos del comercio, pero no cambiarlos');
      }

      let logoActual = c.logo_url || null;

      const logoFile = $('#co-logo-file');
      const logoBtn = $('#co-logo-btn');
      const logoQuitar = $('#co-logo-quitar');
      const logoVista = $('#co-logo-vista');

      if (logoBtn && logoFile && puede) {
        logoBtn.addEventListener('click', () => logoFile.click());
        logoFile.addEventListener('change', e => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) {
            return avisar('La imagen no debe superar 2 MB', 'error');
          }
          const reader = new FileReader();
          reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const maxW = 400, maxH = 200;
              let w = img.width, h = img.height;
              if (w > maxW || h > maxH) {
                const ratio = Math.min(maxW / w, maxH / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
              }
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              logoActual = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
              if (logoVista) {
                logoVista.innerHTML = `<img src="${esc(logoActual)}" alt="Logo" style="max-width:100%; max-height:100%; object-fit:contain;">`;
              }
              if (logoQuitar) logoQuitar.hidden = false;
              previa();
            };
            img.src = ev.target.result;
          };
          reader.readAsDataURL(file);
        });
      }

      if (logoQuitar && puede) {
        logoQuitar.addEventListener('click', () => {
          logoActual = null;
          if (logoFile) logoFile.value = '';
          if (logoVista) {
            logoVista.innerHTML = '<span style="font-size:11px; color:var(--tinta-3); text-align:center;">Sin logo</span>';
          }
          logoQuitar.hidden = true;
          previa();
        });
      }

      function previa() {
        $('#co-previa').innerHTML = `
          <div class="previa__papel">
            ${logoActual ? `<div class="previa__logo-caja"><img src="${esc(logoActual)}" class="previa__logo" alt="Logo"></div>` : ''}
            <p class="previa__seniat">SENIAT</p>
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

      ['co-nombre','co-rif','co-direccion','co-telefono','co-mensaje']
        .forEach(id => $('#' + id).addEventListener('input', previa));
      previa();

      // Guardar referencia en el scope del formulario
      INV.vistas.comercio._obtenerLogoActual = () => logoActual;

      /* Estado de la tasa: de dónde sale y qué antigüedad tiene. Con la
         automática encendida, la casilla manual queda inerte para que no
         se escriba algo que no se va a usar. */
      function pintarEstadoTasa() {
        const caja = $('#co-tasa-estado');
        if (!caja || !INV.tasas) return;
        const t = INV.tasas.actual();
        const auto = $('#co-tasa-auto').checked;
        $('#co-usd').disabled = auto;

        if (!auto) {
          caja.textContent = 'Manda la tasa manual de abajo.';
          caja.style.color = '';
          return;
        }
        if (t.origen !== 'oficial') {
          caja.textContent = 'Todavía no hay tasa del BCV guardada: mientras tanto se usa la manual.';
          caja.style.color = 'var(--naranja)';
          return;
        }
        const dias = t.dias || 0;
        caja.textContent = dias === 0
          ? `Tasa de hoy: ${numero(t.tasa, 2)} Bs/$ · fuente ${t.fuente}`
          : `Última tasa: ${numero(t.tasa, 2)} Bs/$ de hace ${dias} día${dias > 1 ? 's' : ''} · fuente ${t.fuente}`;
        caja.style.color = dias === 0 ? 'var(--esmeralda)' : 'var(--naranja)';
      }

      $('#co-tasa-auto').addEventListener('change', pintarEstadoTasa);
      pintarEstadoTasa();
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

  async function guardar(btn) {
    if (!INV.permisos.puede('ajustes.comercio'))
      return avisar('Tu rol no permite cambiar los datos del comercio', 'error');

    btn.disabled = true;
    try {
      const logo = INV.vistas.comercio._obtenerLogoActual
        ? INV.vistas.comercio._obtenerLogoActual()
        : null;

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
        tasa_automatica: $('#co-tasa-auto').checked,
        moneda_precios:  $('#co-moneda-precios').value,
        tasa_eur:     Number($('#co-eur').value || 0),
        ticket_ancho: $('#co-ticket').value,
        logo_url:     logo,
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
