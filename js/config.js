/* =====================================================================
   Configuración
   ---------------------------------------------------------------------
   MODO 'demo'     → datos de ejemplo en el navegador. Abre index.html con
                     doble clic y todo funciona: sin servidor, sin cuenta.
   MODO 'supabase' → base de datos real. Requiere servir por http y llenar
                     las credenciales de abajo.
   ===================================================================== */

window.INV = window.INV || {};

INV.config = {
  /* 'demo'     → datos de ejemplo en el navegador (doble clic, sin servidor)
     'drive'    → un archivo JSON en tu Google Drive como base de datos
     'supabase' → base de datos PostgreSQL completa                         */
  MODO: 'supabase',

  /* Encabezado del ticket impreso. Cámbialo por los datos del negocio. */
  NEGOCIO: {
    nombre:    'Mi Comercio, C.A.',
    rif:       'J-00000000-0',
    direccion: 'Av. Principal, Local 1, Caracas',
    telefono:  '0212-0000000',
    mensaje:   '¡Gracias por su compra!',
  },

  /* Ancho del papel del ticket: 58, 80 (milímetros) o 'a4'. */
  TICKET_ANCHO: '80',

  /* Tasa de cambio por defecto para los pagos en divisas. Se puede
     ajustar en cada venta; ponla en 0 si prefieres escribirla siempre. */
  TASAS: { USD: 0, EUR: 0 },

  /* La URL es la del proyecto, sin /rest/v1: el cliente arma esa ruta.
     La llave anon es pública por diseño y viaja al navegador; lo que
     protege los datos son las políticas RLS del esquema. */
  SUPABASE_URL:  'https://goqqmcibcdaeuienjmuy.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvcXFtY2liY2RhZXVpZW5qbXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzg0NTgsImV4cCI6MjEwMjk1NDQ1OH0.ClgYqIQ0k0-BiEDjWLAMJxGw0ZDQ5sqo0jJZ6D9p4zI',
  /* Alternativa nueva de Supabase; funciona igual que la anon.
     SUPABASE_ANON: 'sb_publishable_q9JPKcBiKjS7B6taOs-keA_weG1gLgl', */

  /* Opcional: URL de la función de administración de cuentas, si la
     desplegaste en Supabase (ver FUNCION-CUENTAS.md). Con ella el
     administrador puede además cambiar la contraseña de un operador que
     ya existe. Sin ella se usa el alta normal, que solo sirve para
     cuentas nuevas. */
  FUNCION_CUENTAS: 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/cuentas',

  /* URL de la función para consultar RIF y Agentes de Retención en SENIAT */
  FUNCION_SENIAT: 'https://goqqmcibcdaeuienjmuy.supabase.co/functions/v1/consulta-rif',

  /* Para MODO 'drive': ID de cliente OAuth de Google Cloud, tipo
     "aplicación web", con tu dominio en los orígenes autorizados. */
  GOOGLE: { CLIENT_ID: 'TU-ID-DE-CLIENTE.apps.googleusercontent.com' },
};

// Bajo file:// solo el modo demo funciona: ni Supabase ni Google autorizan
// peticiones desde un archivo local.
INV.config.esLocal = location.protocol === 'file:';
if (INV.config.esLocal && INV.config.MODO !== 'demo') {
  console.warn('Abierto como archivo local: se fuerza el modo demo.');
  INV.config.MODO = 'demo';
}
