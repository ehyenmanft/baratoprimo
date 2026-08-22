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
    $('#usuario-correo').textContent = s.user.email;
    await prepararSesion(s.user.email);
    if (!location.hash) location.hash = '#/inicio';
    enrutar();
    revisarAlertas();
  }

  /* Resuelve el rol del operador y ajusta menú y permisos. */
  async function prepararSesion(correo) {
    /* Con base de datos real, quien no figure en la tabla de operadores no
       tiene permisos: la base se los va a negar igual, y la interfaz no
       debe ofrecerle botones que no funcionan. En demo y en Drive no hay
       control de acceso real, así que se asume administrador. */
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

    /* Sin comercio en contexto no hay datos que mostrar. Para el super
       administrador eso es normal —supervisa, no opera—, así que se le
       lleva a elegir uno. Para el resto es una instalación a medias. */
    if (!INV.comercio.hay() && rol !== INV.permisos.SIN_ACCESO.id) {
      const supervisa = INV.permisos.puede('comercios.gestionar');
      if (supervisa) {
        if (!location.hash || location.hash === '#/inicio') location.hash = '#/comercios';
      } else if (INV.db.etiqueta === 'supabase') {
        INV.ui.avisar('Tu operador no tiene un comercio asignado', 'error');
        if (!location.hash || location.hash === '#/inicio') location.hash = '#/comercio';
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

  /* ---------------- Menú lateral en móvil ----------------
     En pantallas estrechas el menú se retira fuera de la vista y entra al
     pulsar el logo, tanto el de la barra superior como el del propio panel
     (que ahí sirve para cerrarlo). */

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
      if (!comercios.length) { selector.hidden = true; return; }

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
      selector.hidden = true;
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

  document.addEventListener('DOMContentLoaded', () => {
    $('#btn-entrar').addEventListener('click', async () => {
      const btn = $('#btn-entrar');
      const err = $('#acceso-error');
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Entrando…';
      try {
        const r = await INV.db.sesion.entrar($('#acceso-email').value, $('#acceso-clave').value);
        await mostrarApp(r.session);
      } catch (e) {
        /* Sin pistas sobre si falló el correo o la contraseña: quien no
           entra debe hablar con quien administra, no adivinar. */
        const credenciales = /invalid login|invalid credentials|email not confirmed|user not found|incorrect/i;
        err.textContent = credenciales.test(e.message)
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

    $('#btn-salir').addEventListener('click', async () => {
      await INV.db.sesion.salir();
      location.hash = '';
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

    window.addEventListener('hashchange', enrutar);

    // Las vistas piden recargarse tras guardar; también refrescamos la banda.
    window.addEventListener('recargar-vista', () => { enrutar(); revisarAlertas(); });

    if (INV.db.sesion.alCambiar) INV.db.sesion.alCambiar(s => { if (!s) mostrarAcceso(); });
    arrancar().catch(e => avisar(e.message, 'error'));
  });
})();
