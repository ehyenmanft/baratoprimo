/* =====================================================================
   Operadores — quién entra y qué puede hacer.
   La interfaz oculta lo que no corresponde; el cerrojo real son las
   políticas del esquema, que miran el rol en cada consulta.
   ===================================================================== */
(function () {
  const { $, $$, esc, fecha, avisar, abrirModal, cerrarModal, cargando, vacio } = INV.ui;
  const P = INV.permisos;

  const iniciales = n => String(n || '?').trim().split(/\s+/).slice(0, 2)
    .map(x => x[0]).join('').toUpperCase();

  INV.vistas = INV.vistas || {};
  INV.vistas.operadores = {
    titulo: 'Operadores',
    eyebrow: 'Usuarios y permisos',

    acciones: () => [
      { texto: 'Nuevo operador', estilo: 'btn--primario', permiso: 'operadores.gestionar',
        alPulsar: async () => formulario(null, await INV.db.comercios.listar().catch(() => [])) },
    ],

    render: async contenedor => {
      contenedor.innerHTML = cargando();
      const [operadores, comercios] = await Promise.all([
        INV.db.operadores.listar(),
        INV.db.comercios.listar().catch(() => []),
      ]);
      const yo = ($('#usuario-correo').textContent || '').toLowerCase();

      contenedor.innerHTML = `
        <div class="ficha anim" style="--i:0; margin-bottom:14px">
          <div class="ficha__cabecera">
            <div>
              <h3 class="ficha__titulo">Operadores registrados</h3>
              <p class="ficha__nota">${operadores.length} en total · pulsa uno para cambiar su rol</p>
            </div>
          </div>
          ${operadores.length ? `
            <div class="lista lista--ope">
              ${operadores.map((o, i) => {
                const d = P.definicion(o.rol);
                return `
                <div class="lista__item ${o.activo ? '' : 'apagado'}" style="--i:${i}"
                     data-operador="${o.id}" role="button" tabindex="0">
                  <span class="miniatura miniatura--vacia">${esc(iniciales(o.nombre))}</span>
                  <span class="lista__nombre">${esc(o.nombre)}${o.correo.toLowerCase() === yo ? ' <span class="pastilla pastilla--entrada">tú</span>' : ''}
                    <span class="lista__sub">${esc(o.correo)}${o.comercio ? ' · ' + esc(o.comercio) : ''}${o.activo ? '' : ' · inactivo'}</span></span>
                  <span class="rol-marca rol-marca--${esc(o.rol)}">${esc(d.etiqueta)}</span>
                </div>`;
              }).join('')}
            </div>`
          : '<div class="vacio"><h4>Sin operadores</h4><p>Registra el primero para asignar permisos.</p></div>'}
        </div>

        <div class="ficha anim" style="--i:1">
          <div class="ficha__cabecera">
            <div>
              <h3 class="ficha__titulo">Qué puede hacer cada rol</h3>
              <p class="ficha__nota">resumen de permisos</p>
            </div>
          </div>
          <div class="tabla-envoltura">
            <table class="permisos">
              <thead><tr>
                <th>Rol</th><th>Inventario</th><th>Dar de baja</th>
                <th>Facturar</th><th>Anular</th><th>Operadores</th><th>Comercios</th>
              </tr></thead>
              <tbody>
                ${P.ROLES.map(r => {
                  const tiene = p => r.permisos.includes('*') || r.permisos.includes(p);
                  const marca = v => v ? '<span class="si">Sí</span>' : '<span class="no">No</span>';
                  return `
                    <tr>
                      <td><b>${esc(r.etiqueta)}</b><br><span class="lista__sub">${esc(r.descripcion)}</span></td>
                      <td>${marca(tiene('productos.editar'))}</td>
                      <td>${marca(tiene('productos.eliminar'))}</td>
                      <td>${marca(tiene('ventas.emitir'))}</td>
                      <td>${marca(tiene('ventas.anular'))}</td>
                      <td>${marca(tiene('operadores.gestionar'))}</td>
                      <td>${marca(tiene('comercios.gestionar'))}</td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          <div class="ficha__pie">
            <p class="subida__nota" style="margin:0">
              ${INV.db.etiqueta === 'demo'
                ? 'En modo demo puedes entrar como cualquier operador desde la pantalla de acceso para probar sus permisos: no hay contraseñas.'
                : 'El operador entra con el correo registrado aquí. La contraseña se crea desde Supabase → Authentication, o con el enlace de invitación que Supabase le envía.'}
            </p>
          </div>
        </div>`;

      if (P.puede('operadores.gestionar')) {
        $$('[data-operador]').forEach(el => {
          const abrir = () => {
            const o = operadores.find(x => x.id === Number(el.dataset.operador));
            if (!P.puedeGestionarA(o))
              return avisar('Solo un super administrador puede modificar esa ficha', 'error');
            formulario(o, comercios);
          };
          el.addEventListener('click', abrir);
          el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
          });
        });
      }
    },
  };

  function formulario(o = null, comercios = []) {
    const asignables = INV.permisos.rolesAsignables();
    const rolInicial = o ? o.rol : 'operador_facturador';

    abrirModal({
      titulo: o ? 'Editar operador' : 'Nuevo operador',
      cuerpo: `
        <div class="campo">
          <label for="op-nombre">Nombre</label>
          <input id="op-nombre" type="text" value="${esc(o ? o.nombre : '')}" placeholder="Nombre y apellido">
        </div>
        <div class="campo">
          <label for="op-correo">Correo de acceso</label>
          <input id="op-correo" type="email" value="${esc(o ? o.correo : '')}" placeholder="operador@correo.com">
        </div>
        <div class="campo">
          <label>Rol</label>
          <div class="roles">
            ${asignables.map(r => `
              <label class="rol-opcion">
                <input type="radio" name="op-rol" value="${r.id}" ${rolInicial === r.id ? 'checked' : ''}>
                <span>
                  <b>${esc(r.etiqueta)}</b>
                  <span class="lista__sub">${esc(r.descripcion)}</span>
                </span>
              </label>`).join('')}
          </div>
        </div>

        <div class="campo" id="op-caja-comercio">
          <label for="op-comercio">Comercio asignado</label>
          <div style="display:grid; grid-template-columns:1fr auto; gap:8px">
            <select id="op-comercio">
              ${comercios.map(c => `<option value="${c.id}" ${o && o.comercio_id === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
            </select>
            ${INV.permisos.puede('comercios.gestionar')
              ? '<button type="button" class="btn btn--secundario btn--chico" id="op-nuevo-comercio">Crear uno</button>'
              : ''}
          </div>
          <span class="subida__nota" id="op-comercio-nota" style="margin-top:6px; display:block"></span>
        </div>
        ${o ? `
        <div class="campo" style="margin:0">
          <label for="op-activo">Estado</label>
          <select id="op-activo">
            <option value="si" ${o.activo ? 'selected' : ''}>Activo</option>
            <option value="no" ${o.activo ? '' : 'selected'}>Sin acceso</option>
          </select>
        </div>` : ''}
        <p id="op-error" class="error" hidden></p>`,
      acciones: [
        ...(o && INV.permisos.puedeGestionarA(o) ? [{ texto: 'Eliminar', alPulsar: () => eliminar(o) }] : []),
        { texto: 'Cancelar', alPulsar: cerrarModal },
        { texto: 'Guardar', estilo: 'btn--primario', alPulsar: btn => guardar(o, btn) },
      ],
    });

    /* El super administrador trabaja sobre un comercio concreto, así que
       al nombrar uno hay que decir cuál —o crearlo en el momento. */
    const nota = () => {
      const marcado = $$('input[name="op-rol"]').find(r => r.checked);
      const esSuper = marcado && marcado.value === 'super_admin';
      $('#op-comercio-nota').textContent = esSuper
        ? 'Un super administrador arranca en este comercio y luego puede cambiar al que quiera.'
        : 'Solo verá los datos de este comercio.';
    };
    $$('input[name="op-rol"]').forEach(r => r.addEventListener('change', nota));
    nota();

    const btnNuevo = $('#op-nuevo-comercio');
    if (btnNuevo) btnNuevo.addEventListener('click', async () => {
      const nombre = prompt('Nombre del comercio nuevo');
      if (!nombre || !nombre.trim()) return;
      try {
        const c = await INV.db.comercios.crear({ nombre: nombre.trim() });
        const sel = $('#op-comercio');
        const op = document.createElement('option');
        op.value = c.id; op.textContent = c.nombre; op.selected = true;
        sel.append(op);
        avisar('Comercio creado');
      } catch (e) {
        avisar(e.message, 'error');
      }
    });
  }

  async function guardar(o, btn) {
    const err = $('#op-error');
    const marcado = $$('input[name="op-rol"]').find(r => r.checked);
    const datos = {
      nombre: $('#op-nombre').value.trim(),
      correo: $('#op-correo').value.trim().toLowerCase(),
      rol: marcado ? marcado.value : 'operador_facturador',
      comercio_id: $('#op-comercio').value ? Number($('#op-comercio').value) : null,
    };
    if (o) datos.activo = $('#op-activo').value === 'si';

    if (!datos.nombre) { err.textContent = 'El nombre es obligatorio.'; err.hidden = false; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.correo)) {
      err.textContent = 'Escribe un correo válido.'; err.hidden = false; return;
    }
    if (!datos.comercio_id) {
      err.textContent = datos.rol === 'super_admin'
        ? 'Un super administrador necesita un comercio de partida: selecciona uno o créalo.'
        : 'Selecciona el comercio al que pertenece.';
      err.hidden = false; return;
    }

    btn.disabled = true;
    try {
      o ? await INV.db.operadores.actualizar(o.id, datos) : await INV.db.operadores.crear(datos);
      cerrarModal();
      avisar(o ? 'Operador actualizado' : 'Operador registrado');
      window.dispatchEvent(new Event('recargar-vista'));
    } catch (e) {
      err.textContent = e.message.includes('duplicate')
        ? 'Ya hay un operador con ese correo.'
        : e.message;
      err.hidden = false;
      btn.disabled = false;
    }
  }

  async function eliminar(o) {
    const operadores = await INV.db.operadores.listar();
    const fallar = texto => {
      $('#op-error').textContent = texto;
      $('#op-error').hidden = false;
    };

    // Quedarse sin quien administre dejaría la instalación bloqueada.
    if (o.rol === 'super_admin') {
      const supers = operadores.filter(x => x.rol === 'super_admin' && x.activo);
      if (supers.length <= 1)
        return fallar('Es el único super administrador: nombra otro antes de eliminarlo.');
    } else if (o.rol === 'administrador') {
      const admins = operadores.filter(x =>
        x.rol === 'administrador' && x.activo && x.comercio_id === o.comercio_id);
      if (admins.length <= 1)
        return fallar('Es el único administrador de ese comercio: asigna otro antes de eliminarlo.');
    }
    await INV.db.operadores.eliminar(o.id);
    cerrarModal();
    avisar('Operador eliminado');
    window.dispatchEvent(new Event('recargar-vista'));
  }
})();
