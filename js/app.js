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
    const vieja = t.origen === 'oficial' && dias > 0;
    caja.className = 'cinta-tasa' + (vieja ? ' cinta-tasa--vieja' : '');

    const cuando = t.origen !== 'oficial' ? 'tasa propia del comercio'
      : dias === 0 ? 'de hoy'
      : dias === 1 ? 'de ayer'
      : `de hace ${dias} días`;

    caja.innerHTML =
      `<span class="cinta-tasa__etiqueta">Tasa ${t.origen === 'oficial' ? 'BCV' : 'manual'}</span>` +
      `<span class="cinta-tasa__valor">${n(t.tasa, 2)}</span>` +
      `<span>Bs por dólar · ${cuando}</span>` +
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
    $('#btn-entrar').addEventListener('click', async () => {
      const btn = $('#btn-entrar');
      const err = $('#acceso-error');
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Entrando…';
      try {
        /* Se limpia el correo: un espacio al pegarlo o una mayúscula
           suelta no deben costar el acceso. La contraseña no se toca,
           que ahí los espacios pueden ser intencionales. */
        const correo = $('#acceso-email').value.trim().toLowerCase();
        $('#acceso-email').value = correo;

        const r = await INV.db.sesion.entrar(correo, $('#acceso-clave').value);
        await mostrarApp(r.session);
      } catch (e) {
        /* En pantalla, sin pistas sobre si falló el correo o la contraseña:
           quien no entra debe hablar con quien administra, no adivinar.
           En la consola sí va el motivo real, porque quien administra
           necesita distinguir una clave equivocada de un correo sin
           confirmar, y no tiene por qué adivinarlo. */
        const credenciales = /invalid login|invalid credentials|email not confirmed|user not found|incorrect/i;
        const generico = credenciales.test(e.message);

        console.warn('[BaratoPrimo] No se pudo iniciar sesión con "' +
          $('#acceso-email').value.trim() + '": ' + e.message +
          (/email not confirmed/i.test(e.message)
            ? '\n→ La cuenta existe pero no está confirmada. Authentication → Users, o desactiva "Confirm email".'
            : /invalid login|invalid credentials/i.test(e.message)
              ? '\n→ El correo no existe o la contraseña no coincide. Revisa que el correo sea idéntico al registrado, sin puntos ni espacios de más.'
              : ''));

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

    if (INV.db.sesion.alCambiar) INV.db.sesion.alCambiar(s => { if (!s) mostrarAcceso(); });
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
