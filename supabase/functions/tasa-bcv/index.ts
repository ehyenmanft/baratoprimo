/* =====================================================================
   BaratoPrimo — tasa oficial del dólar
   ---------------------------------------------------------------------
   El navegador no puede consultar el BCV: su sitio no autoriza peticiones
   desde otro dominio. Por eso la consulta se hace aquí, en el servidor, y
   la aplicación lee el resultado de la tabla.

   Tres fuentes en cascada, porque el sitio del BCV se cae con frecuencia
   y su estructura cambia sin aviso:
     1. bcv.org.ve, leyendo el bloque #dolar
     2. Banco de Venezuela, que publica un JSON estable
     3. Una API pública que republica la tasa del BCV

   Si las tres fallan no se inventa nada: se responde con error y la
   aplicación sigue usando la última tasa conocida. Una tasa equivocada
   es peor que una tasa vieja, porque la vieja al menos se nota.

   Desplegar: Edge Functions → Deploy a new function → nombre "tasa-bcv"
   ===================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const responder = (cuerpo, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/* El BCV escribe los números a la venezolana: 236.756,80 son doscientos
   treinta y seis mil. El punto separa miles y la coma, decimales. */
function aNumero(texto) {
  if (!texto) return null;
  const limpio = String(texto).trim()
    .replace(/[^\d.,]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = parseFloat(limpio);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* Comprobación de cordura: una tasa fuera de rango casi siempre es un
   error de lectura, no una devaluación. Más vale no guardarla. */
const razonable = t => t !== null && t > 1 && t < 100000000;

/* ---------------- Fuente 1: el BCV ---------------- */
async function desdeBCV() {
  const respuesta = await fetch('https://www.bcv.org.ve/', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
    signal: AbortSignal.timeout(15000),
  });
  if (!respuesta.ok) throw new Error('BCV respondió ' + respuesta.status);

  const html = await respuesta.text();

  /* Se toma una ventana de texto a partir de id="dolar" y se busca el
     número dentro. No se corta en el primer </div>: el bloque del BCV
     tiene divs anidados y el cierre que aparece antes es el interno, así
     que recortar ahí dejaba fuera la cifra. */
  const ventana = html.match(/id=["']dolar["']([\s\S]{0,800})/i);
  if (ventana) {
    const trozo = ventana[1];

    const conStrong = trozo.match(/<strong>\s*([\d.,]+)\s*<\/strong>/i);
    if (conStrong) {
      const t = aNumero(conStrong[1]);
      if (razonable(t)) return { tasa: t, fuente: 'bcv' };
    }

    // Sin strong: el primer número con formato venezolano que aparezca
    const cualquiera = trozo.match(/([\d]{1,3}(?:\.[\d]{3})*,[\d]+)/);
    if (cualquiera) {
      const t = aNumero(cualquiera[1]);
      if (razonable(t)) return { tasa: t, fuente: 'bcv' };
    }
  }

  // Último recurso dentro del BCV: la tasa suele ir junto a "USD"
  const juntoAUsd = html.match(/USD[\s\S]{0,300}?([\d]{1,3}(?:\.[\d]{3})*,[\d]+)/i);
  if (juntoAUsd) {
    const t = aNumero(juntoAUsd[1]);
    if (razonable(t)) return { tasa: t, fuente: 'bcv' };
  }

  throw new Error('No se encontró la tasa en la página del BCV');
}

/* ---------------- Fuente 2: Banco de Venezuela ----------------
   Publica un JSON estable con la tasa oficial que aplica al menudeo. */
async function desdeBDV() {
  const respuesta = await fetch('https://www.bancodevenezuela.com/files/tasas/tasas2.json', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!respuesta.ok) throw new Error('BDV respondió ' + respuesta.status);

  const datos = await respuesta.json();
  const bruto = datos?.menudeo?.compra?.dolares ?? datos?.menudeo?.dolares;
  const t = aNumero(bruto);
  if (!razonable(t)) throw new Error('El JSON del BDV no traía una tasa reconocible');
  return { tasa: t, fuente: 'bdv' };
}

/* ---------------- Fuente 3: réplica pública ---------------- */
async function desdeRespaldo() {
  const respuesta = await fetch('https://pydolarve.org/api/v2/tipo-cambio?currency=usd', {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!respuesta.ok) throw new Error('El respaldo respondió ' + respuesta.status);

  const datos = await respuesta.json();
  const t = aNumero(datos?.price ?? datos?.monitors?.bcv?.price);
  if (!razonable(t)) throw new Error('El respaldo no traía una tasa reconocible');
  return { tasa: t, fuente: 'respaldo' };
}

Deno.serve(async (peticion) => {
  if (peticion.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const primera = (...nombres) => nombres.map(n => Deno.env.get(n)).find(v => v);
  const URL_PROYECTO   = primera('SUPABASE_URL', 'PROJECT_URL');
  const LLAVE_SERVICIO = primera('SUPABASE_SERVICE_ROLE_KEY', 'SB_SECRET_KEY', 'SERVICE_ROLE_KEY');

  if (!URL_PROYECTO || !LLAVE_SERVICIO) {
    return responder({ error: 'Faltan las variables del proyecto' }, 500);
  }

  const intentos = [];
  let resultado = null;

  for (const fuente of [desdeBCV, desdeBDV, desdeRespaldo]) {
    try {
      resultado = await fuente();
      break;
    } catch (e) {
      intentos.push({ fuente: fuente.name, error: e.message });
    }
  }

  if (!resultado) {
    // Ninguna fuente respondió: no se guarda nada y se explica por qué
    return responder({
      error: 'No se pudo obtener la tasa de ninguna fuente',
      intentos,
    }, 502);
  }

  /* La fecha es la de Caracas, no la del servidor: si la función corre a
     las 02:00 UTC, en Venezuela todavía es el día anterior. */
  const hoy = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);

  const admin = createClient(URL_PROYECTO, LLAVE_SERVICIO);
  const { error } = await admin.from('tasas_cambio').upsert({
    moneda: 'USD',
    fecha: hoy,
    tasa: resultado.tasa,
    fuente: resultado.fuente,
    obtenida_en: new Date().toISOString(),
  }, { onConflict: 'moneda,fecha' });

  if (error) return responder({ error: error.message }, 500);

  return responder({
    guardada: true,
    fecha: hoy,
    tasa: resultado.tasa,
    fuente: resultado.fuente,
    intentos_fallidos: intentos,
  });
});
