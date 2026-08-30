/* =====================================================================
   BaratoPrimo — service worker
   ---------------------------------------------------------------------
   Regla de oro: se guarda el armazón de la aplicación, nunca los datos.
   Un inventario cacheado es un inventario equivocado, y una venta que
   se sirve desde el disco es una venta que no llegó al servidor. Todo
   lo que vaya a Supabase pasa de largo por aquí.

   Al cambiar cualquier archivo hay que subir VERSION: es lo que hace
   que los dispositivos ya instalados se enteren de la actualización.
   ===================================================================== */

const VERSION = 'baratoprimo-v1.7';

/* El armazón: lo imprescindible para pintar la aplicación sin red. */
const ARMAZON = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './img/logo.svg',
  './img/icono-192.png',
  './img/icono-512.png',
  './img/apple-touch-icon.png',
  './js/config.js',
  './js/sync.js',
  './js/datos-demo.js',
  './js/drive.js',
  './js/db.js',
  './js/ui.js',
  './js/permisos.js',
  './js/tasas.js',
  './js/periodos.js',
  './js/graficos.js',
  './js/qr.js',
  './js/escaner.js',
  './js/seniat.js',
  './js/app.js',
  './js/instalar.js',
  './js/views/inicio.js',
  './js/views/movimientos.js',
  './js/views/kardex.js',
  './js/views/productos.js',
  './js/views/producto.js',
  './js/views/graficas.js',
  './js/views/clientes.js',
  './js/views/ventas.js',
  './js/views/comercio.js',
  './js/views/operadores.js',
  './js/views/comercios.js',
  './js/views/caja.js',
];

/* Servidores que NUNCA se guardan: son datos vivos o sesiones.
   Se comparan por servidor exacto y no por dominio, porque dentro de
   googleapis.com conviven la API de Drive —que jamás debe cachearse— y
   las tipografías, que sí interesa guardar para que la aplicación se vea
   igual sin conexión. */
const SERVIDORES_DE_DATOS = [
  'www.googleapis.com',       // API de Google Drive
  'accounts.google.com',      // acceso con Google
  'oauth2.googleapis.com',
];

const esDeDatos = url =>
  url.hostname.endsWith('.supabase.co') ||   // base, autenticación y archivos
  url.hostname === 'supabase.co' ||
  SERVIDORES_DE_DATOS.includes(url.hostname);

self.addEventListener('install', evento => {
  evento.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll falla entero si un archivo falla; se añaden de uno en uno
    // para que un recurso ausente no impida instalar la aplicación.
    await Promise.all(ARMAZON.map(async ruta => {
      try { await cache.add(new Request(ruta, { cache: 'reload' })); }
      catch (e) { console.warn('No se pudo guardar', ruta); }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', evento => {
  evento.waitUntil((async () => {
    // Fuera las versiones anteriores
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(n => n !== VERSION).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', evento => {
  const peticion = evento.request;

  // Solo GET: un POST a la base jamás debe tocar la caché
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (esDeDatos(url)) return;   // se deja pasar a la red, sin intermediarios

  /* Navegación: primero la red, para que una versión nueva se vea sin
     esperar. Si no hay conexión, se sirve el armazón guardado. */
  if (peticion.mode === 'navigate') {
    evento.respondWith((async () => {
      try {
        const respuesta = await fetch(peticion);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', respuesta.clone());
        return respuesta;
      } catch (e) {
        const cache = await caches.open(VERSION);
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  /* Archivos de la aplicación y tipografías: primero la caché, porque no
     cambian dentro de una versión, y en segundo plano se refrescan. */
  evento.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const guardado = await cache.match(peticion);

    const desdeRed = fetch(peticion).then(respuesta => {
      if (respuesta && respuesta.status === 200 &&
          (url.origin === location.origin || respuesta.type === 'cors' || respuesta.type === 'opaque')) {
        cache.put(peticion, respuesta.clone());
      }
      return respuesta;
    }).catch(() => null);

    return guardado || (await desdeRed) || Response.error();
  })());
});

/* La página puede pedir que se aplique una versión nueva sin recargar. */
self.addEventListener('message', evento => {
  if (evento.data === 'aplicar-actualizacion') self.skipWaiting();
});
