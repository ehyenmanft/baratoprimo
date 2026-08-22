/* =====================================================================
   Google Drive como base de datos
   ---------------------------------------------------------------------
   Toda la información vive en un único archivo JSON dentro de tu Drive.
   Es el mismo modelo de datos del modo demo, con la carga y el guardado
   apuntando a Drive en vez de al navegador.

   Qué hace falta:
   1. Un ID de cliente OAuth de Google Cloud (tipo "aplicación web"), con
      el dominio donde publiques la app en "orígenes autorizados".
   2. Servir la app por https. Con doble clic en index.html no funciona:
      Google no autoriza el origen file://.

   Límites que conviene tener claros:
   - Un solo archivo: quien guarda de último manda. Sirve para un negocio
     con un operador a la vez, no para varios facturando en paralelo.
   - El token de Google dura una hora; al vencer se vuelve a pedir acceso.
   - Las imágenes de producto se guardan dentro del JSON, así que conviene
     no cargar fotos enormes.
   ===================================================================== */
(function () {

  const ARCHIVO = 'inventario-datos.json';
  const ALCANCE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const SUBIDA = 'https://www.googleapis.com/upload/drive/v3/files';

  let token = null;
  let archivoId = null;
  let bd = null;
  let clienteToken = null;

  /* ---------------- Autenticación ---------------- */

  function cargarGoogle() {
    if (window.google && window.google.accounts) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar la librería de Google. ¿Hay conexión?'));
      document.head.append(s);
    });
  }

  async function conectar() {
    const idCliente = (INV.config.GOOGLE || {}).CLIENT_ID;
    if (!idCliente || idCliente.startsWith('TU-'))
      throw new Error('Falta el ID de cliente de Google en js/config.js');
    if (location.protocol === 'file:')
      throw new Error('Google no autoriza el acceso desde un archivo local: publica la app por https');

    await cargarGoogle();

    token = await new Promise((resolve, reject) => {
      clienteToken = window.google.accounts.oauth2.initTokenClient({
        client_id: idCliente,
        scope: ALCANCE,
        callback: r => r.access_token ? resolve(r.access_token)
                                      : reject(new Error(r.error || 'Acceso denegado')),
        error_callback: e => reject(new Error(e.message || 'No se completó el acceso')),
      });
      clienteToken.requestAccessToken({ prompt: '' });
    });

    await abrirArchivo();
    return true;
  }

  const cabeceras = () => ({ Authorization: 'Bearer ' + token });

  async function pedir(url, opciones = {}) {
    const r = await fetch(url, { ...opciones, headers: { ...cabeceras(), ...(opciones.headers || {}) } });
    if (r.status === 401) { token = null; throw new Error('La sesión con Google venció: vuelve a conectar'); }
    if (!r.ok) throw new Error('Google Drive respondió ' + r.status + ': ' + (await r.text()).slice(0, 140));
    return r;
  }

  /* ---------------- Archivo de datos ---------------- */

  async function abrirArchivo() {
    const consulta = encodeURIComponent(`name='${ARCHIVO}' and trashed=false`);
    const r = await pedir(`${API}?q=${consulta}&fields=files(id,name,modifiedTime)&spaces=drive`);
    const { files } = await r.json();

    if (files && files.length) {
      archivoId = files[0].id;
      const c = await pedir(`${API}/${archivoId}?alt=media`);
      bd = await c.json();
      completarColecciones();
    } else {
      bd = INV.adaptadorDemo.estructuraVacia();
      archivoId = await crearArchivo();
    }
    // A partir de aquí el adaptador demo opera sobre los datos de Drive
    INV.adaptadorDemo.usarEstado(bd, guardar);
    return bd;
  }

  async function crearArchivo() {
    const metadatos = { name: ARCHIVO, mimeType: 'application/json' };
    const cuerpo = new FormData();
    cuerpo.append('metadata', new Blob([JSON.stringify(metadatos)], { type: 'application/json' }));
    cuerpo.append('file', new Blob([JSON.stringify(bd)], { type: 'application/json' }));
    const r = await pedir(`${SUBIDA}?uploadType=multipart&fields=id`, { method: 'POST', body: cuerpo });
    return (await r.json()).id;
  }

  /* Las colecciones que no existan (archivo de una versión anterior) se
     completan igual que en el modo demo. */
  function completarColecciones() {
    const base = INV.adaptadorDemo.estructuraVacia();
    Object.keys(base).forEach(k => { if (!Array.isArray(bd[k])) bd[k] = base[k]; });
  }

  /* Guardar es reescribir el archivo entero. Se agrupan las escrituras
     seguidas para no mandar una petición por cada tecla. */
  let pendiente = null;
  function guardar() {
    if (pendiente) clearTimeout(pendiente);
    return new Promise((resolve, reject) => {
      pendiente = setTimeout(async () => {
        try {
          await pedir(`${SUBIDA}/${archivoId}?uploadType=media`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bd),
          });
          resolve(true);
        } catch (e) {
          if (INV.ui) INV.ui.avisar('No se pudo guardar en Drive: ' + e.message, 'error');
          reject(e);
        }
      }, 400);
    });
  }

  /* ---------------- Adaptador ----------------
     Se reutiliza toda la lógica del modo demo (que es la réplica exacta
     de las vistas y triggers del esquema) y solo se cambia dónde vive el
     estado y cómo se persiste. */
  function construir() {
    return {
      ...INV.adaptadorDemo,
      etiqueta: 'drive',
      conectar,
      conectado: () => !!token && !!archivoId,
      archivo: () => ({ id: archivoId, nombre: ARCHIVO }),
      sesion: {
        actual: async () => (token && archivoId) ? { user: { email: correoGoogle() } } : null,
        entrar: async () => { await conectar(); return { session: { user: { email: correoGoogle() } } }; },
        salir: async () => {
          if (token && window.google) window.google.accounts.oauth2.revoke(token, () => {});
          token = null; archivoId = null; bd = null;
        },
        alCambiar: () => {},
      },
    };
  }

  let correo = '';
  const correoGoogle = () => correo || 'cuenta de Google';

  INV.adaptadorDrive = { construir, conectar, guardar };
})();
