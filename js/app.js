(function () {
  const { $, $$, avisar } = INV.ui;

  /* La ruta es #/vista o #/vista/parametro — por ejemplo #/producto/3. */
  const rutaActual = () => {
    const partes = location.hash.replace('#/', '').split('/').filter(Boolean);
    return { vista: partes[0] || 'inicio', param: partes[1] || null };
  };

  /* ============ Sesión ============ */

  function mostrarAcceso() {
    $('#pantalla-app').hidden = true;
    $('#pantalla-acceso').hidden = false;
  }

  async function mostrarApp(s) {
    $('#pantalla-acceso').hidden = true;
    $('#pantalla-app').hidden = false;
    const correo = s.user.email;
    $('#usuario-correo').textContent = correo;
    await prepararSesion(correo);
    if (!location.hash) location.hash = '#/inicio';
    enrutar();
    revisarAlertas();

    /* ---- Popup de bienvenida ---- */
    try {
      const dato = await INV.db.operadores.datoDe(correo);
      if (dato && dato.nombre) {
        const nombre = dato.nombre.split(' ')[0]; // primer nombre
        const hora = new Date().getHours();
        const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';

        let ultimaVez = '';
        if (dato.ultimo_acceso) {
          const fecha = new Date(dato.ultimo_acceso);
          ultimaVez = fecha.toLocaleString('es', {
            weekday: 'long', day: '2-digit', month: 'long',
            hour: '2-digit', minute: '2-digit',
          });
        }

        const el = document.createElement('div');
        el.className = 'bienvenida';
        el.innerHTML =
          `<div class="bienvenida__caja">` +
          `<span class="bienvenida__emoji">👋</span>` +
          `<p class="bienvenida__saludo">${saludo},</p>` +
          `<p class="bienvenida__nombre">${INV.ui.esc(nombre)}</p>` +
          (ultimaVez
            ? `<p class="bienvenida__ultimo">Última conexión: ${INV.ui.esc(ultimaVez)}</p>`
            : `<p class="bienvenida__ultimo">¡Es tu primera conexión!</p>`) +
          `</div>`;
        el.addEventListener('click', () => el.remove());
        document.body.append(el);
        setTimeout(() => { if (el.parentNode) el.remove(); }, 4500);

        // Registrar este acceso para la próxima vez
        INV.db.operadores.registrarAcceso(correo).catch(() => {});
      }
    } catch (e) { /* El saludo es decorativo: si falla no pasa nada */ }
  }

  /* Resuelve el rol del operador y ajusta menú y permisos. */
  async function prepararSesion(correo) {
    /* Con base de datos real, quien no figure en la tabla de operadores no
       tiene permisos: la base se los va a negar igual, y la interfaz no
       debe ofrecerle botones que no funcionan. En demo y en Drive no hay
       control de acceso real, así que se asume administrador. */
    sinComercioAsignado = false;
    const conControlDeAcceso = INV.db.etiqueta === 'supabase';
    let rol = conControlDeAcceso ? INV.permisos.SIN_ACCESO.id : 'administrador';

    try {
      const encontrado = await INV.db.operadores.rolDe(correo);
      if (encontrado) rol = encontrado;
      else if (conControlDeAcceso) {
        INV.ui.avisar('Tu cuenta no está registrada como operador. ' +
          'Pide a un administrador que te dé de alta.', 'error');
      }
    } catch (e) {
      // No se pudo consultar la tabla: sin datos, no se conceden permisos
      if (conControlDeAcceso) {
        INV.ui.avisar('No se pudo verificar tu rol: ' + e.message, 'error');
      } else {
        rol = 'administrador';
      }
    }

    INV.permisos.fijarRol(rol);
    await INV.comercio.recargar();
    // La tasa es opcional: sin ella la aplicación funciona, solo que sin
    // equivalentes en la otra moneda.
    if (INV.tasas) await INV.tasas.cargar();

    /* Sin comercio en contexto no hay datos que mostrar. Para el super
       administrador eso es normal —supervisa, no opera—, así que se le
       lleva a elegir uno. Para el resto es una instalación a medias. */
    if (!INV.comercio.hay() && rol !== INV.permisos.SIN_ACCESO.id) {
      const alInicio = !location.hash || location.hash === '#/inicio';

      if (INV.permisos.puede('comercios.gestionar')) {
        // Supervisa: solo tiene que elegir dónde situarse
        if (alInicio) location.hash = '#/comercios';

      } else if (INV.permisos.puede('ajustes.comercio')) {
        // Puede crearlo él mismo: allí está el formulario
        if (alInicio) location.hash = '#/comercio';

      } else if (INV.db.etiqueta === 'supabase') {
        /* No puede crearlo ni entra a esa pantalla: el aviso se da aquí
           mismo, sin mandarlo a una sección que su rol no abre. */
        INV.ui.avisar('Tu cuenta no tiene comercio asignado', 'error');
        sinComercioAsignado = true;
      }
    }

    await pintarComercio(rol);

    const d = INV.permisos.definicion(rol);
    const marca = $('#rol-actual');
    if (marca) {
      marca.textContent = d.etiqueta;
      marca.className = 'rol-marca rol-marca--' + rol;
    }

    // El menú solo muestra lo que el rol puede abrir
    $$('.rail__link').forEach(a =>
      a.hidden = !INV.permisos.puedeVer(a.dataset.vista));

    if (sinComercioAsignado) {
      $('#contenido').innerHTML =
        '<div class="vacio"><h4>Tu cuenta no tiene comercio asignado</h4>' +
        '<p>Entraste bien, pero tu cuenta todavía no está ligada a ningún comercio, ' +
        'así que no hay datos que mostrar. Pide a un administrador que te asigne ' +
        'uno desde Operadores.</p></div>';
    }

    if (rol === INV.permisos.SIN_ACCESO.id) {
      $('#contenido').innerHTML =
        '<div class="vacio"><h4>Tu cuenta todavía no tiene permisos</h4>' +
        '<p>Entraste correctamente, pero nadie te ha dado de alta como operador. ' +
        'Un administrador debe registrarte desde la pantalla de Operadores.</p></div>';
    }
    $$('.rail__grupo').forEach(g => {
      const siguientes = [];
      let n = g.nextElementSibling;
      while (n && n.classList.contains('rail__nav')) { siguientes.push(n); n = n.nextElementSibling; }
      g.hidden = siguientes.every(nav =>
        [...nav.querySelectorAll('.rail__link')].every(a => a.hidden));
    });
  }

  /* Cintillo con la tasa que se está aplicando ahora mismo. Se pinta en
     las pantallas donde se manejan precios: ver el número antes de
     teclear evita cargar un producto con la tasa de la semana pasada. */
  const VISTAS_CON_TASA = ['inicio', 'ventas', 'venta', 'productos', 'producto', 'movimientos'];

  function pintarCintaTasa(vista) {
    const caja = $('#cinta-tasa');
    if (!caja || !INV.tasas) return;

    if (!VISTAS_CON_TASA.includes(vista)) { caja.hidden = true; return; }

    const t = INV.tasas.actual();
    const n = INV.ui.numero;

    if (!t.tasa) {
      caja.className = 'cinta-tasa cinta-tasa--sin';
      caja.innerHTML = '<span class="cinta-tasa__etiqueta">Sin tasa</span>' +
        '<span class="cinta-tasa__valor">—</span>' +
        '<span>No hay tasa de cambio: los equivalentes no se pueden calcular.</span>';
      caja.hidden = false;
      return;
    }

    const dias = t.dias;
    /* Días negativos significan fecha valor futura: el BCV publica por la
       tarde la tasa del siguiente día hábil, y eso no es estar viejo. */
    const vieja = t.origen === 'oficial' && dias > 0;
    const futura = t.origen === 'oficial' && dias < 0;
    caja.className = 'cinta-tasa' + (vieja ? ' cinta-tasa--vieja' : '');

    const cuando = t.origen !== 'oficial' ? 'tasa propia del comercio'
      : futura ? `fecha valor ${new Date(t.fecha + 'T00:00:00')
          .toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'long' })}`
      : dias === 0 ? 'de hoy'
      : dias === 1 ? 'de ayer'
      : `de hace ${dias} días`;

    const eur = INV.tasas.eur();

    caja.innerHTML =
      `<span class="cinta-tasa__etiqueta">Tasa ${t.origen === 'oficial' ? 'BCV' : 'manual'}</span>` +
      `<span class="cinta-tasa__valor">${n(t.tasa, 4)}</span>` +
      `<span>Bs por dólar · ${cuando}</span>` +
      (eur > 0 ? `<span class="cinta-tasa__euro">€ ${n(eur, 4)}</span>` : '') +
      (t.fuente ? `<span class="cinta-tasa__nota">fuente: ${t.fuente}</span>` : '');
    caja.hidden = false;
  }

  /* ---------------- Menú lateral en móvil ----------------
     En pantallas estrechas el menú se retira fuera de la vista y entra al
     pulsar el logo, tanto el de la barra superior como el del propio panel
     (que ahí sirve para cerrarlo). */

  /* Marca de sesión sin comercio para roles que no pueden resolverlo:
     el mensaje sustituye a cualquier vista, porque ninguna tendría datos. */
  let sinComercioAsignado = false;

  const menuAbierto = () => $('#menu-lateral').classList.contains('abierto');

  function abrirMenu() {
    $('#menu-lateral').classList.add('abierto');
    $('#velo-menu').hidden = false;
    $$('[aria-controls="menu-lateral"]').forEach(b => b.setAttribute('aria-expanded', 'true'));
    // El fondo no debe desplazarse mientras el panel está encima
    document.body.style.overflow = 'hidden';
  }

  function cerrarMenu() {
    $('#menu-lateral').classList.remove('abierto');
    $('#velo-menu').hidden = true;
    $$('[aria-controls="menu-lateral"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    document.body.style.overflow = '';
  }

  const alternarMenu = () => menuAbierto() ? cerrarMenu() : abrirMenu();

  /* Nombre del comercio en el menú. El super administrador ve además un
     selector para cambiar de uno a otro sin salir de la pantalla. */
  async function pintarComercio(rol) {
    const caja = $('#rail-comercio');
    if (!caja) return;

    const actual = INV.comercio.actual();
    const supervisa = rol === 'super_admin';
    const etiqueta = caja.querySelector('.rail__comercio-etiqueta');

    if (!supervisa) {
      if (!actual || !actual.nombre) { caja.hidden = true; return; }
      caja.hidden = false;
      if (etiqueta) etiqueta.textContent = 'Comercio';
      $('#comercio-actual').textContent = actual.nombre;
      /* Hay que volver a mostrarlo: la rama del super administrador lo
         oculta para dejar sitio al selector, y si alguien cierra sesión y
         entra otro sin recargar, el nombre se quedaba invisible. */
      $('#comercio-actual').hidden = false;
      $('#selector-comercio').hidden = true;
      return;
    }

    // El super administrador no pertenece a un comercio: lo tiene a la vista
    caja.hidden = false;
    if (etiqueta) etiqueta.textContent = 'Viendo';
    $('#comercio-actual').textContent = actual && actual.nombre ? actual.nombre : 'Ningún comercio';

    const selector = $('#selector-comercio');
    try {
      const comercios = await INV.db.comercios.listar();
      if (!comercios.length) {
        selector.hidden = true;
        $('#comercio-actual').hidden = false;
        return;
      }

      const idActual = actual && actual.id ? actual.id : '';
      selector.innerHTML =
        `<option value="" ${idActual === '' ? 'selected' : ''}>Ninguno · solo supervisión</option>` +
        comercios.map(c =>
          `<option value="${c.id}" ${c.id === idActual ? 'selected' : ''}>${c.nombre}</option>`).join('');
      selector.hidden = false;
      $('#comercio-actual').hidden = true;

      selector.onchange = async () => {
        try {
          await INV.db.comercios.cambiar(selector.value || null);
          await INV.comercio.recargar();
          const c = INV.comercio.actual();
          INV.ui.avisar(c && c.nombre
            ? 'Estás viendo ' + c.nombre
            : 'Fuera de todo comercio: solo supervisión');
          if (!INV.comercio.hay()) location.hash = '#/comercios';
          enrutar();
          revisarAlertas();
        } catch (e) {
          INV.ui.avisar(e.message, 'error');
        }
      };
    } catch (e) {
      // Sin lista de comercios se muestra el nombre, no un selector vacío
      selector.hidden = true;
      $('#comercio-actual').hidden = false;
    }
  }

  async function arrancar() {
    // En modo demo la cabecera lo deja claro y se puede reiniciar el juego de datos.
    if (INV.db.etiqueta === 'demo') {
      $('#cinta-demo').hidden = false;
      $('#acceso-email').value = 'demo@local';
      $('#acceso-clave').value = 'demo';
    }

    // Con Drive no hay correo ni contraseña: el acceso lo da Google.
    if (INV.db.etiqueta === 'drive') {
      $('#acceso-campos').hidden = true;
      $('#btn-entrar').textContent = 'Conectar con Google Drive';
      $('#acceso-nota').textContent =
        'Los datos se guardan en un archivo dentro de tu Google Drive. ' +
        'Al conectar se pedirá permiso solo sobre ese archivo.';
    }
    const s = await INV.db.sesion.actual();
    s ? await mostrarApp(s) : mostrarAcceso();
  }

  /* ============ Enrutador ============ */

  async function enrutar() {
    const { vista: nombre, param } = rutaActual();
    const vista = INV.vistas[nombre];
    if (!vista) { location.hash = '#/inicio'; return; }

    // Sin comercio y sin poder crearlo, ninguna vista tiene datos
    if (sinComercioAsignado) {
      $('#vista-titulo').textContent = 'Sin comercio';
      $('#vista-eyebrow').textContent = 'Configuración pendiente';
      $('#vista-acciones').innerHTML = '';
      $('#contenido').innerHTML =
        '<div class="vacio"><h4>Tu cuenta no tiene comercio asignado</h4>' +
        '<p>Entraste bien, pero tu cuenta todavía no está ligada a ningún comercio, ' +
        'así que no hay datos que mostrar. Pide a un administrador que te asigne ' +
        'uno desde Operadores.</p></div>';
      $$('.rail__link').forEach(a => a.classList.remove('activo'));
      return;
    }

    // Escribir la ruta a mano no salta los permisos
    if (!INV.permisos.puedeVer(nombre)) {
      $('#vista-titulo').textContent = 'Sin permiso';
      $('#vista-eyebrow').textContent = 'Acceso restringido';
      $('#vista-acciones').innerHTML = '';
      $('#contenido').innerHTML =
        '<div class="vacio"><h4>Esta sección no está disponible para tu rol</h4>' +
        '<p>Pide a un administrador que amplíe tus permisos.</p>' +
        '<a class="btn btn--primario" href="#/inicio">Volver al inicio</a></div>';
      $$('.rail__link').forEach(a => a.classList.remove('activo'));
      return;
    }

    $$('.rail__link').forEach(a =>
      a.classList.toggle('activo', a.dataset.vista === (vista.railComo || nombre)));

    const texto = v => typeof v === 'function' ? v(param) : v;
    $('#vista-titulo').textContent = texto(vista.titulo);
    $('#vista-eyebrow').textContent = texto(vista.eyebrow);
    const enMovil = $('#vista-movil');
    if (enMovil) enMovil.textContent = texto(vista.titulo);
    pintarCintaTasa(nombre);

    // El ticket pertenece al comprobante; al cambiar de vista se descarta
    // para que una impresión no saque una venta que ya no está en pantalla.
    const ticket = $('#ticket');
    if (ticket && nombre !== 'venta') ticket.innerHTML = '';

    const barra = $('#vista-acciones');
    barra.innerHTML = '';
    INV.permisos.filtrar(vista.acciones(param)).forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.estilo || 'btn--secundario');
      b.textContent = a.texto;
      // Se le pasa su propio botón, para que la acción pueda deshabilitarlo
      // mientras trabaja, igual que hacen las acciones del modal.
      b.addEventListener('click', () => a.alPulsar(b));
      barra.append(b);
    });

    try {
      await vista.render($('#contenido'), param);
    } catch (e) {
      $('#contenido').innerHTML =
        `<div class="vacio"><h4>No se pudo cargar la vista</h4><p>${e.message}</p></div>`;
    }
  }

  /* ============ Banda de alertas ============ */

  async function revisarAlertas() {
    const banda = $('#banda-alertas');
    try {
      const filas = await INV.db.stock.alertas();
      if (!filas.length) { banda.hidden = true; return; }

      const criticos = filas.filter(f => Number(f.stock) <= 0).length;
      banda.innerHTML = `
        <span><strong>${filas.length}</strong> producto${filas.length === 1 ? '' : 's'}
        en o bajo el stock mínimo${criticos ? `, <strong>${criticos}</strong> sin existencias` : ''}.</span>
        <a class="btn btn--secundario btn--chico" href="#/reportes">Ver reposición</a>`;
      banda.hidden = false;
    } catch (e) {
      banda.hidden = true;
    }
  }

  /* ============ Enlaces ============ */

  let yaIniciado = false;

  function iniciar() {
    if (yaIniciado) return;   // registrar dos veces alternaría cada botón dos veces
    yaIniciado = true;
    /* ============ Tabs de Acceso / Registro ============ */
    const tabEntrar = $('#tab-entrar');
    const tabRegistro = $('#tab-registro');
    const bloqueEntrar = $('#bloque-entrar');
    const bloqueRegistro = $('#bloque-registro');
    const errAcceso = $('#acceso-error');
    const exitoAcceso = $('#acceso-exito');

    function alternarTab(aRegistro) {
      if (tabEntrar) {
        tabEntrar.classList.toggle('acceso__tab--activo', !aRegistro);
        tabEntrar.setAttribute('aria-selected', String(!aRegistro));
      }
      if (tabRegistro) {
        tabRegistro.classList.toggle('acceso__tab--activo', aRegistro);
        tabRegistro.setAttribute('aria-selected', String(aRegistro));
      }
      if (bloqueEntrar) bloqueEntrar.hidden = aRegistro;
      if (bloqueRegistro) bloqueRegistro.hidden = !aRegistro;
      if (errAcceso) errAcceso.hidden = true;
      if (exitoAcceso) exitoAcceso.hidden = true;
    }

    if (tabEntrar) tabEntrar.addEventListener('click', () => alternarTab(false));
    if (tabRegistro) tabRegistro.addEventListener('click', () => alternarTab(true));

    /* ============ Olvido de Contraseña ============ */
    const btnOlvido = $('#btn-olvido-clave');
    if (btnOlvido) {
      btnOlvido.addEventListener('click', () => {
        const correoActual = $('#acceso-email') ? $('#acceso-email').value.trim() : '';
        INV.ui.abrirModal({
          titulo: 'Recuperar contraseña',
          cuerpo: `
            <p style="margin:0 0 14px; font-size:13.5px; color:var(--tinta-2);">
              Escribe tu correo registrado y te enviaremos un enlace seguro para restablecer tu contraseña.
            </p>
            <div class="campo">
              <label for="recup-email">Correo electrónico</label>
              <input id="recup-email" type="email" value="${INV.ui.esc(correoActual)}" placeholder="tu@correo.com">
            </div>
            <p id="recup-error" class="error" hidden></p>
          `,
          acciones: [
            { texto: 'Cancelar', alPulsar: INV.ui.cerrarModal },
            {
              texto: 'Enviar enlace',
              estilo: 'btn--primario',
              alPulsar: async btnModal => {
                const inputCorreo = $('#recup-email');
                const errModal = $('#recup-error');
                const correo = (inputCorreo ? inputCorreo.value : '').trim().toLowerCase();
                if (!correo || !correo.includes('@')) {
                  if (errModal) { errModal.textContent = 'Ingresa un correo electrónico válido.'; errModal.hidden = false; }
                  return;
                }
                btnModal.disabled = true;
                btnModal.textContent = 'Enviando…';
                try {
                  await INV.db.sesion.recuperarClave(correo);
                  INV.ui.cerrarModal();
                  INV.ui.avisar('Enlace de recuperación enviado. Revisa tu bandeja de entrada.');
                  if (exitoAcceso) {
                    exitoAcceso.textContent = 'Enlace de recuperación enviado a ' + correo + '. Sigue las instrucciones recibidas.';
                    exitoAcceso.hidden = false;
                  }
                } catch (e) {
                  if (errModal) { errModal.textContent = e.message; errModal.hidden = false; }
                  btnModal.disabled = false;
                  btnModal.textContent = 'Enviar enlace';
                }
              }
            }
          ]
        });
      });
    }

    /* ============ Registro de Nueva Cuenta ============ */
    const btnReg = $('#btn-registrarse');
    if (btnReg) {
      btnReg.addEventListener('click', async () => {
        if (errAcceso) errAcceso.hidden = true;
        if (exitoAcceso) exitoAcceso.hidden = true;

        const nombre = ($('#reg-nombre') ? $('#reg-nombre').value : '').trim();
        const correo = ($('#reg-email') ? $('#reg-email').value : '').trim().toLowerCase();
        const clave = ($('#reg-clave') ? $('#reg-clave').value : '');
        const rol = $('#reg-rol') ? $('#reg-rol').value : 'operador_facturador';

        if (!nombre) {
          if (errAcceso) { errAcceso.textContent = 'Escribe tu nombre y apellido.'; errAcceso.hidden = false; }
          return;
        }
        if (!correo || !correo.includes('@')) {
          if (errAcceso) { errAcceso.textContent = 'Escribe un correo electrónico válido.'; errAcceso.hidden = false; }
          return;
        }
        if (clave.length < 8) {
          if (errAcceso) { errAcceso.textContent = 'La contraseña debe tener al menos 8 caracteres.'; errAcceso.hidden = false; }
          return;
        }

        btnReg.disabled = true;
        btnReg.textContent = 'Registrando solicitud…';
        try {
          await INV.db.operadores.solicitarRegistro({ nombre, correo, clave, rol });
          
          // Limpiar formulario de registro
          if ($('#reg-nombre')) $('#reg-nombre').value = '';
          if ($('#reg-email')) $('#reg-email').value = '';
          if ($('#reg-clave')) $('#reg-clave').value = '';

          alternarTab(false);
          if ($('#acceso-email')) $('#acceso-email').value = correo;
          if (exitoAcceso) {
            exitoAcceso.innerHTML = '<b>¡Solicitud enviada con éxito!</b><br>' +
              'Tu cuenta ha sido creada en estado pendiente. Un Super Administrador revisará tu solicitud para habilitar tu rol y asignarte un comercio.';
            exitoAcceso.hidden = false;
          }
          INV.ui.avisar('Solicitud de cuenta registrada correctamente.');
        } catch (e) {
          if (errAcceso) {
            errAcceso.textContent = e.message;
            errAcceso.hidden = false;
          }
        } finally {
          btnReg.disabled = false;
          btnReg.textContent = 'Solicitar cuenta';
        }
      });
    }

    /* Ojo de ver contraseña en registro */
    const btnOjoReg = $('#ver-clave-reg');
    if (btnOjoReg) {
      btnOjoReg.addEventListener('click', () => {
        const campo = $('#reg-clave');
        if (!campo) return;
        const visible = campo.type === 'text';
        campo.type = visible ? 'password' : 'text';
        btnOjoReg.setAttribute('aria-pressed', String(!visible));
        btnOjoReg.setAttribute('aria-label', visible ? 'Mostrar la contraseña' : 'Ocultar la contraseña');
        campo.focus();
      });
    }

    $('#btn-entrar').addEventListener('click', async () => {
      const btn = $('#btn-entrar');
      const err = $('#acceso-error');
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Entrando…';
      try {
        const correo = $('#acceso-email').value.trim().toLowerCase();
        $('#acceso-email').value = correo;

        const r = await INV.db.sesion.entrar(correo, $('#acceso-clave').value);
        await mostrarApp(r.session);
      } catch (e) {
        const credenciales = /invalid login|invalid credentials|email not confirmed|user not found|incorrect/i;
        const generico = credenciales.test(e.message);

        console.warn('[BaratoPrimo] No se pudo iniciar sesión con "' +
          $('#acceso-email').value.trim() + '": ' + e.message);

        err.textContent = generico
          ? 'No fue posible iniciar sesión. Comuníquese con el administrador.'
          : e.message;
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    });

    $('#acceso-clave').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('#btn-entrar').click();
    });

    /* Ver la contraseña mientras se escribe. Se devuelve el cursor al
       campo y en la misma posición: alternar no debe costar el sitio. */
    $('#ver-clave').addEventListener('click', () => {
      const campo = $('#acceso-clave');
      const boton = $('#ver-clave');
      const visible = campo.type === 'text';
      const posicion = campo.selectionStart;

      campo.type = visible ? 'password' : 'text';
      boton.setAttribute('aria-pressed', String(!visible));
      const etiqueta = visible ? 'Mostrar la contraseña' : 'Ocultar la contraseña';
      boton.setAttribute('aria-label', etiqueta);
      boton.setAttribute('title', etiqueta);

      campo.focus();
      try { campo.setSelectionRange(posicion, posicion); } catch (e) { /* sin soporte */ }
    });

    // Al salir del acceso la contraseña vuelve a ocultarse
    $('#btn-entrar').addEventListener('click', () => {
      const campo = $('#acceso-clave');
      if (campo.type === 'text') $('#ver-clave').click();
    });

    $('#btn-salir').addEventListener('click', async () => {
      const btn = $('#btn-salir');
      btn.disabled = true;
      btn.textContent = 'Saliendo…';
      cerrarMenu();
      try {
        await INV.db.sesion.salir();
      } catch (e) {
        console.warn('[BaratoPrimo] Error al cerrar sesión:', e.message);
      }
      location.hash = '';
      // Limpiar campos del formulario de acceso
      $('#acceso-email').value = '';
      $('#acceso-clave').value = '';
      $('#acceso-error').hidden = true;
      btn.disabled = false;
      btn.textContent = 'Cerrar sesión';
      mostrarAcceso();
    });

    $('#btn-reiniciar-demo').addEventListener('click', () => {
      INV.adaptadorDemo.reiniciar();
      avisar('Datos de ejemplo restaurados');
      enrutar();
      revisarAlertas();
    });

    // El logo abre y cierra el panel
    ['#btn-menu', '#btn-menu-movil'].forEach(sel => {
      const b = $(sel);
      if (b) b.addEventListener('click', alternarMenu);
    });
    $('#velo-menu').addEventListener('click', cerrarMenu);

    // Al elegir una sección el panel se retira solo
    $$('.rail__link').forEach(a => a.addEventListener('click', cerrarMenu));

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && menuAbierto()) cerrarMenu();
    });

    // Al ensanchar la ventana el menú vuelve a ser una columna fija
    window.addEventListener('resize', () => {
      if (window.innerWidth > 820 && menuAbierto()) cerrarMenu();
    });

    /* Al crear su primer comercio, la sesión pasa a tener uno: hay que
       rehacer el menú y las alertas sin obligar a volver a entrar. */
    window.addEventListener('sesion-cambiada', async () => {
      const correo = ($('#usuario-correo').textContent || '').trim();
      await prepararSesion(correo);
      enrutar();
      revisarAlertas();
    });

    window.addEventListener('hashchange', enrutar);

    // Las vistas piden recargarse tras guardar; también refrescamos la banda.
    window.addEventListener('recargar-vista', () => { enrutar(); revisarAlertas(); });

    function mostrarModalNuevaClave() {
      INV.ui.abrirModal({
        titulo: 'Establecer nueva contraseña',
        cuerpo: `
          <p style="margin:0 0 14px; font-size:13.5px; color:var(--tinta-2);">
            Ingresa tu nueva contraseña de acceso (mínimo 8 caracteres).
          </p>
          <div class="campo">
            <label for="nueva-clave-input">Nueva contraseña</label>
            <input id="nueva-clave-input" type="password" placeholder="Mínimo 8 caracteres">
          </div>
          <p id="nueva-clave-error" class="error" hidden></p>
        `,
        acciones: [
          {
            texto: 'Actualizar contraseña',
            estilo: 'btn--primario',
            alPulsar: async btn => {
              const pass = ($('#nueva-clave-input') ? $('#nueva-clave-input').value : '');
              const err = $('#nueva-clave-error');
              if (pass.length < 8) {
                if (err) { err.textContent = 'La contraseña debe tener al menos 8 caracteres.'; err.hidden = false; }
                return;
              }
              btn.disabled = true;
              btn.textContent = 'Guardando…';
              try {
                await INV.db.sesion.actualizarClave(pass);
                INV.ui.cerrarModal();
                INV.ui.avisar('Contraseña actualizada con éxito');
              } catch (e) {
                if (err) { err.textContent = e.message; err.hidden = false; }
                btn.disabled = false;
                btn.textContent = 'Actualizar contraseña';
              }
            }
          }
        ]
      });
    }

    if (INV.db.sesion.alCambiar) {
      INV.db.sesion.alCambiar((e, s) => {
        if (e === 'PASSWORD_RECOVERY') {
          mostrarModalNuevaClave();
        } else if (!s) {
          mostrarAcceso();
        }
      });
    }
    arrancar().catch(e => avisar(e.message, 'error'));
  }

  /* Si el documento ya está listo se arranca de inmediato: esperar un
     evento que ya pasó dejaría la aplicación sin escuchadores. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
