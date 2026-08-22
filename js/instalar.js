/* =====================================================================
   Instalación y estado de conexión
   ---------------------------------------------------------------------
   Registra el service worker, ofrece instalar la aplicación cuando el
   navegador lo permite, y avisa cuando se pierde la conexión: con base
   de datos remota, sin red no se puede guardar nada y más vale decirlo
   antes de que alguien pierda una venta escribiéndola.
   ===================================================================== */
(function () {
  const $ = s => document.querySelector(s);

  /* ---------------- Service worker ---------------- */

  const registrable = 'serviceWorker' in navigator && location.protocol !== 'file:';

  if (registrable) {
    window.addEventListener('load', async () => {
      try {
        const registro = await navigator.serviceWorker.register('sw.js');

        /* Si llega una versión nueva mientras la aplicación está abierta,
           se avisa en vez de cambiarla debajo de los pies: alguien podría
           estar a media venta. */
        registro.addEventListener('updatefound', () => {
          const nuevo = registro.installing;
          if (!nuevo) return;
          nuevo.addEventListener('statechange', () => {
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
              anunciarActualizacion(registro);
            }
          });
        });
      } catch (e) {
        // Sin service worker la aplicación funciona igual, solo que sin
        // arranque instantáneo ni pantalla de respaldo sin conexión.
        console.warn('No se pudo registrar el service worker:', e.message);
      }
    });

    // Cuando el nuevo toma el control, se recarga una sola vez
    let recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recargando) return;
      recargando = true;
      location.reload();
    });
  }

  function anunciarActualizacion(registro) {
    if (!INV.ui) return;
    const aviso = document.createElement('div');
    aviso.className = 'aviso';
    aviso.innerHTML = 'Hay una versión nueva. ' +
      '<button class="btn btn--secundario btn--chico" style="margin-left:8px">Actualizar</button>';
    aviso.querySelector('button').addEventListener('click', () => {
      if (registro.waiting) registro.waiting.postMessage('aplicar-actualizacion');
    });
    $('#avisos').append(aviso);
  }

  /* ---------------- Invitación a instalar ---------------- */

  const CLAVE_RECHAZO = 'baratoprimo-instalar-no';
  let invitacion = null;

  const rechazada = () => {
    try { return localStorage.getItem(CLAVE_RECHAZO) === '1'; }
    catch (e) { return false; }
  };

  window.addEventListener('beforeinstallprompt', evento => {
    // Se retiene el aviso del navegador para ofrecerlo con nuestro diseño
    evento.preventDefault();
    invitacion = evento;
    if (!rechazada()) $('#instalar').hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    $('#instalar').hidden = true;
    invitacion = null;
    if (INV.ui) INV.ui.avisar('BaratoPrimo quedó instalada');
  });

  document.addEventListener('DOMContentLoaded', () => {
    const boton = $('#btn-instalar');
    if (boton) boton.addEventListener('click', async () => {
      if (!invitacion) return;
      $('#instalar').hidden = true;
      invitacion.prompt();
      await invitacion.userChoice;
      invitacion = null;
    });

    const no = $('#btn-no-instalar');
    if (no) no.addEventListener('click', () => {
      $('#instalar').hidden = true;
      try { localStorage.setItem(CLAVE_RECHAZO, '1'); } catch (e) { /* sin almacenamiento */ }
    });

    pintarConexion();
  });

  /* ---------------- Conexión ---------------- */

  function pintarConexion() {
    const banda = $('#sin-conexion');
    if (!banda) return;
    // En modo demo los datos viven en el navegador: la red da igual
    const dependeDeLaRed = INV.db && INV.db.etiqueta !== 'demo';
    banda.hidden = navigator.onLine || !dependeDeLaRed;
  }

  window.addEventListener('online', () => {
    pintarConexion();
    if (INV.ui) INV.ui.avisar('Conexión restablecida');
  });

  window.addEventListener('offline', () => {
    pintarConexion();
    if (INV.ui) INV.ui.avisar('Se perdió la conexión', 'error');
  });

  INV.conexion = { pintar: pintarConexion };
})();
