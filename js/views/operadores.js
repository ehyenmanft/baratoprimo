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
      const esSuperAdmin = INV.permisos.rol() === 'super_admin';

      // Separar solicitudes pendientes (inactivos o sin comercio asignado que no son super_admin)
      const solicitudes = operadores.filter(o => !o.activo);
      const activos = operadores.filter(o => o.activo);

      contenedor.innerHTML = `
        ${(esSuperAdmin && solicitudes.length > 0) ? `
          <div class="ficha anim solicitudes-seccion" style="--i:0">
            <div class="ficha__cabecera">
              <div>
                <h3 class="ficha__titulo" style="color:var(--naranja, #f58309); display:flex; align-items:center; gap:8px;">
                  <span>🔔 Solicitudes de Registro Pendientes</span>
                  <span class="badge" style="background:var(--naranja, #f58309); color:#fff; font-size:11px; padding:2px 8px; border-radius:999px;">${solicitudes.length}</span>
                </h3>
                <p class="ficha__nota">Nuevos operadores esperando que un Super Administrador habilite su rol y asigne su comercio.</p>
              </div>
            </div>
            <div class="solicitudes__lista">
              ${solicitudes.map(s => {
                const d = P.definicion(s.rol);
                return `
                  <div class="solicitud-card" data-solicitud="${s.id}">
                    <div style="display:flex; align-items:center; gap:12px;">
                      <span class="miniatura miniatura--vacia" style="background:var(--naranja-piel, #fff0dc); color:var(--naranja, #f58309); font-weight:700;">${esc(iniciales(s.nombre))}</span>
                      <div>
                        <b style="font-size:14.5px;">${esc(s.nombre)}</b>
                        <div class="lista__sub">${esc(s.correo)} · Rol solicitado: <b style="color:var(--tinta);">${esc(d.etiqueta)}</b></div>
                      </div>
                    </div>
                    <div class="solicitud-card__acciones" style="display:flex; gap:8px;">
                      <button type="button" class="btn btn--primario btn--chico btn-aprobar-solicitud" data-id="${s.id}">
                        Habilitar y asignar
                      </button>
                      <button type="button" class="btn btn--fantasma btn--chico btn-rechazar-solicitud" data-id="${s.id}" style="color:var(--rosa);">
                        Rechazar
                      </button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <div class="ficha anim" style="--i:0; margin-bottom:14px">
          <div class="ficha__cabecera">
            <div>
              <h3 class="ficha__titulo">Operadores activos</h3>
              <p class="ficha__nota">${activos.length} habilitados · pulsa uno para cambiar su rol o comercio</p>
            </div>
          </div>
          ${activos.length ? `
            <div class="lista lista--ope">
              ${activos.map((o, i) => {
                const d = P.definicion(o.rol);
                return `
                <div class="lista__item" style="--i:${i}"
                     data-operador="${o.id}" role="button" tabindex="0">
                  <span class="miniatura miniatura--vacia">${esc(iniciales(o.nombre))}</span>
                  <span class="lista__nombre">${esc(o.nombre)}${o.correo.toLowerCase() === yo ? ' <span class="pastilla pastilla--entrada">tú</span>' : ''}
                    <span class="lista__sub">${esc(o.correo)}${o.comercio ? ' · ' + esc(o.comercio)
                      : (o.rol === 'super_admin' ? ' · supervisa todos' : ' · sin comercio')}${(o.tiene_clave || o.usuario_id) ? ' · con acceso' : ''}</span></span>
                  <span class="rol-marca rol-marca--${esc(o.rol)}">${esc(d.etiqueta)}</span>
                </div>`;
              }).join('')}
            </div>`
          : '<div class="vacio"><h4>Sin operadores activos</h4><p>Registra o aprueba el primero para asignar permisos.</p></div>'}
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
                ? 'En modo demo puedes entrar como cualquier operador desde la pantalla de acceso para probar sus permisos: no hay contraseñas reales.'
                : (INV.db.cuentas.conFuncion()
                  ? 'Al dar de alta un operador puedes asignarle su contraseña aquí mismo, y cambiársela después si hace falta.'
                  : 'Al dar de alta un operador puedes asignarle su contraseña aquí mismo. Para <b>cambiar</b> la de una cuenta que ya existe hace falta desplegar la función de administración (ver FUNCION-CUENTAS.md) o hacerlo desde Supabase → Authentication.')}
            </p>
          </div>
        </div>`;

      // Enlazar botones de aprobación y rechazo
      $$('.btn-aprobar-solicitud').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const s = operadores.find(x => x.id === Number(btn.dataset.id));
          if (s) modalAprobarSolicitud(s, comercios);
        });
      });

      $$('.btn-rechazar-solicitud').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const s = operadores.find(x => x.id === Number(btn.dataset.id));
          if (!s) return;
          if (!confirm(`¿Rechazar y eliminar la solicitud de "${s.nombre}" (${s.correo})?`)) return;
          try {
            await INV.db.operadores.eliminar(s.id);
            avisar('Solicitud rechazada');
            window.dispatchEvent(new CustomEvent('recargar-vista'));
          } catch (err) {
            avisar(err.message, 'error');
          }
        });
      });

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

  function modalAprobarSolicitud(s, comercios) {
    const asignables = INV.permisos.rolesAsignables();
    const rolInicial = s.rol || 'operador_facturador';

    abrirModal({
      titulo: 'Habilitar operador y asignar comercio',
      cuerpo: `
        <div style="background:var(--superficie-2); padding:12px 14px; border-radius:var(--r-s); margin-bottom:16px; border:1px solid var(--linea);">
          <b style="font-size:14px; display:block;">${esc(s.nombre)}</b>
          <span class="lista__sub" style="font-size:12.5px;">${esc(s.correo)}</span>
        </div>

        <div class="campo">
          <label>Rol asignado</label>
          <div class="roles">
            ${asignables.map(r => `
              <label class="rol-opcion">
                <input type="radio" name="aprob-rol" value="${r.id}" ${rolInicial === r.id ? 'checked' : ''}>
                <span>
                  <b>${esc(r.etiqueta)}</b>
                  <span class="lista__sub">${esc(r.descripcion)}</span>
                </span>
              </label>`).join('')}
          </div>
        </div>

        <div class="campo">
          <label for="aprob-comercio">Comercio donde operará</label>
          <select id="aprob-comercio">
            <option value="">Selecciona un comercio…</option>
            ${comercios.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}
          </select>
          <span class="subida__nota" style="margin-top:5px; display:block;">Obligatorio: el operador solo podrá acceder a los datos del comercio asignado.</span>
        </div>
        <p id="aprob-error" class="error" hidden></p>
      `,
      acciones: [
        { texto: 'Cancelar', alPulsar: cerrarModal },
        {
          texto: 'Habilitar operador',
          estilo: 'btn--primario',
          alPulsar: async btnModal => {
            const marcado = $$('input[name="aprob-rol"]').find(r => r.checked);
            const rol = marcado ? marcado.value : 'operador_facturador';
            const comercioId = $('#aprob-comercio') ? $('#aprob-comercio').value : '';
            const errModal = $('#aprob-error');

            if (!comercioId && rol !== 'super_admin') {
              if (errModal) { errModal.textContent = 'Debes seleccionar un comercio para este operador.'; errModal.hidden = false; }
              return;
            }

            btnModal.disabled = true;
            btnModal.textContent = 'Habilitando…';
            try {
              await INV.db.operadores.aprobar(s.id, { rol, comercio_id: comercioId });
              cerrarModal();
              avisar(`Operador "${s.nombre}" habilitado con éxito.`);
              window.dispatchEvent(new CustomEvent('recargar-vista'));
            } catch (e) {
              if (errModal) { errModal.textContent = e.message; errModal.hidden = false; }
              btnModal.disabled = false;
              btnModal.textContent = 'Habilitar operador';
            }
          }
        }
      ]
    });
  }

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
              <option value="">Ninguno · solo supervisión</option>
              ${comercios.map(c => `<option value="${c.id}" ${o && o.comercio_id === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
            </select>
            ${INV.permisos.puede('comercios.gestionar')
              ? '<button type="button" class="btn btn--secundario btn--chico" id="op-nuevo-comercio">Crear uno</button>'
              : ''}
          </div>
          <span class="subida__nota" id="op-comercio-nota" style="margin-top:6px; display:block"></span>
        </div>
        <div class="campo" id="op-caja-clave">
          <label>Contraseña de acceso</label>
          <div class="campo campo--clave" style="margin:0 0 10px">
            <input id="op-clave" type="password" autocomplete="new-password"
                   placeholder="${o ? 'Escríbela para asignarla o cambiarla' : 'Mínimo 8 caracteres'}">
            <button type="button" class="ojo" id="op-ver-clave"
                    aria-label="Mostrar la contraseña" aria-pressed="false">
              <svg class="ojo__abierto" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
                      fill="none" stroke="currentColor" stroke-width="1.7"
                      stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/>
              </svg>
              <svg class="ojo__cerrado" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M9.6 5.9A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-3.4 4.1M6.4 7.9A17 17 0 002.5 12S6 18.5 12 18.5c.9 0 1.7-.1 2.5-.4"
                      fill="none" stroke="currentColor" stroke-width="1.7"
                      stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M9.9 9.9a3.2 3.2 0 004.3 4.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
          <input id="op-clave-2" type="password" autocomplete="new-password"
                 placeholder="Repite la contraseña">
          <span class="subida__nota" id="op-clave-nota" style="margin-top:6px; display:block"></span>
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
        ? 'Opcional: el super administrador no pertenece a ningún comercio, los supervisa todos. Elegir uno solo decide dónde entra situado.'
        : 'Obligatorio: solo verá los datos de este comercio.';
    };
    $$('input[name="op-rol"]').forEach(r => r.addEventListener('change', nota));
    nota();

    /* La contraseña se comprueba mientras se escribe: enterarse al
       guardar de que las dos no coinciden es perder el trabajo. */
    const clave = $('#op-clave'), clave2 = $('#op-clave-2');
    const notaClave = $('#op-clave-nota');
    const capacidad = INV.db.cuentas ? INV.db.cuentas.capacidad() : { crear: false, cambiar: false };
    const tieneCuenta = !!(o && (o.tiene_clave || o.usuario_id));

    function revisarClave() {
      const a = clave.value, b = clave2.value;
      if (!a && !b) {
        notaClave.style.color = '';
        if (!o) {
          notaClave.textContent = 'Si la dejas vacía, el operador quedará registrado pero ' +
            'sin poder entrar hasta que alguien le cree la cuenta.';
        } else if (tieneCuenta) {
          notaClave.textContent = capacidad.cambiar
            ? 'Ya tiene acceso. Escribe una contraseña nueva solo si quieres cambiársela.'
            : 'Ya tiene acceso. Para cambiarle la contraseña hace falta la función de ' +
              'administración, o hacerlo desde Supabase → Authentication → Users.';
        } else {
          notaClave.textContent = 'Todavía no tiene acceso: escribe una contraseña para creárselo.';
        }
        return true;
      }
      if (a.length < 8) {
        notaClave.style.color = 'var(--rosa)';
        notaClave.textContent = `Faltan ${8 - a.length} caracteres para llegar al mínimo de 8.`;
        return false;
      }
      if (!b) {
        notaClave.style.color = '';
        notaClave.textContent = 'Repítela abajo para confirmar.';
        return false;
      }
      if (a !== b) {
        notaClave.style.color = 'var(--rosa)';
        notaClave.textContent = 'Las dos contraseñas no coinciden.';
        return false;
      }
      notaClave.style.color = 'var(--esmeralda)';
      notaClave.textContent = tieneCuenta && !capacidad.cambiar
        ? 'Coinciden. Si esa cuenta ya existe, el cambio puede requerir la función de administración.'
        : 'Las contraseñas coinciden.';
      return true;
    }

    clave.addEventListener('input', revisarClave);
    clave2.addEventListener('input', revisarClave);
    revisarClave();

    $('#op-ver-clave').addEventListener('click', () => {
      const boton = $('#op-ver-clave');
      const visible = clave.type === 'text';
      clave.type = clave2.type = visible ? 'password' : 'text';
      boton.setAttribute('aria-pressed', String(!visible));
      boton.setAttribute('aria-label', visible ? 'Mostrar la contraseña' : 'Ocultar la contraseña');
      clave.focus();
    });

    formulario.revisarClave = revisarClave;

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
    // Solo el super administrador puede quedarse sin comercio
    if (!datos.comercio_id && datos.rol !== 'super_admin') {
      err.textContent = 'Selecciona el comercio al que pertenece.';
      err.hidden = false; return;
    }

    // La contraseña se valida antes de tocar nada
    const clave = $('#op-clave').value;
    const clave2 = $('#op-clave-2').value;
    if (clave || clave2) {
      if (clave.length < 8) {
        err.textContent = 'La contraseña debe tener al menos 8 caracteres.';
        err.hidden = false; return;
      }
      if (clave !== clave2) {
        err.textContent = 'Las dos contraseñas no coinciden.';
        err.hidden = false; return;
      }
    }

    btn.disabled = true;
    try {
      /* Primero el operador y después la cuenta: al revés, un fallo al
         registrar el operador dejaría un usuario de acceso huérfano, que
         podría entrar sin permisos y sin figurar en ninguna lista. */

      const guardado = o
        ? await INV.db.operadores.actualizar(o.id, datos)
        : await INV.db.operadores.crear(datos);

      let avisoCuenta = '';
      if (clave) {
        try {
          /* Una sola llamada, exista o no la cuenta: desde el navegador no
             hay forma de saberlo de antemano, y preguntarlo permitiría
             averiguar qué correos están registrados. */
          const r = await INV.db.cuentas.asignar(datos.correo, clave);

          // Se ata el operador a su cuenta, para saber después quién tiene acceso
          if (r && r.usuario_id && guardado && guardado.id) {
            try { await INV.db.operadores.actualizar(guardado.id, { usuario_id: r.usuario_id }); }
            catch (e) { /* el acceso ya funciona; la marca es secundaria */ }
          }

          avisoCuenta = r && r.requiereConfirmacion
            ? ' Debe confirmar el correo antes de entrar.'
            : ' Ya puede entrar con esa contraseña.';
        } catch (errCuenta) {
          /* El operador quedó bien; lo que falló fue la cuenta. Se dice
             exactamente eso, porque el remedio es distinto. */
          cerrarModal();
          avisar('Operador guardado, pero la contraseña no se pudo asignar: ' +
                 errCuenta.message, 'error');
          window.dispatchEvent(new Event('recargar-vista'));
          return;
        }
      }

      cerrarModal();
      avisar((o ? 'Operador actualizado.' : 'Operador registrado.') + avisoCuenta);
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
