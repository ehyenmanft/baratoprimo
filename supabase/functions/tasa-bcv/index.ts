/* =====================================================================
   BaratoPrimo — tasa oficial del BCV
   ---------------------------------------------------------------------
   Solo fuentes que publican la tasa OFICIAL del Banco Central. Se quitó
   a propósito el Banco de Venezuela: su JSON trae la mesa de cambio, que
   es la que rige hoy, mientras el BCV publica por la tarde la que regirá
   el siguiente día hábil. Mezclarlas hacía que la aplicación mostrara un
   número distinto al de bcv.org.ve, que es el que la gente compara.

   Cada tasa se guarda con su FECHA VALOR —el día desde el que rige—, no
   con la fecha en que se consultó. Es lo que publica el propio BCV y lo
   que permite explicar una factura vieja con la tasa de aquel día.

   Fuentes, en orden:
     1. bcv.org.ve — la fuente. Se leen USD, EUR y la fecha valor.
     2. bcv.today  — espejo del BCV, mismas monedas y effective_date.
     3. ve.dolarapi.com — tasa oficial republicada, sin euro.

   Si las tres fallan no se inventa nada: se responde con error y la
   aplicación sigue con la última tasa conocida, avisando de su edad.

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

/* El BCV escribe los números a la venezolana: 784,66330000 son
   setecientos ochenta y cuatro con sesenta y seis. El punto separa miles
   y la coma, decimales. */
function aNumero(texto) {
  if (texto === null || texto === undefined) return null;

  // Los espejos ya lo mandan como número: se toma tal cual
  if (typeof texto === 'number') return Number.isFinite(texto) && texto > 0 ? texto : null;

  const limpio = String(texto).trim()
    .replace(/[^\d.,]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = parseFloat(limpio);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* Una tasa fuera de rango casi siempre es un error de lectura, no una
   devaluación. Más vale no guardarla. */
const razonable = t => t !== null && t > 1 && t < 100000000;

/* Fecha de Caracas, cuatro horas por detrás de UTC */
const hoyCaracas = () =>
  new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);

const MESES = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09',
  octubre: '10', noviembre: '11', diciembre: '12',
};

/* "Fecha Valor: Lunes, 24 Agosto 2026" → "2026-08-24".
   Es el día desde el que rige la tasa, y no tiene por qué ser hoy: el
   BCV publica por la tarde la que aplicará el siguiente día hábil. */
function fechaValor(html) {
  const m = html.match(
    /Fecha\s*Valor[:\s]*[^,<]*,?\s*(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(\d{4})/i);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  return `${m[3]}-${mes}-${m[1].padStart(2, '0')}`;
}

/* Lee el valor de un bloque de moneda del portal (#dolar, #euro…) */
function monedaDelPortal(html, id) {
  const ventana = html.match(new RegExp(`id=["']${id}["']([\\s\\S]{0,800})`, 'i'));
  if (!ventana) return null;
  const trozo = ventana[1];

  const conStrong = trozo.match(/<strong>\s*([\d.,]+)\s*<\/strong>/i);
  if (conStrong) {
    const t = aNumero(conStrong[1]);
    if (razonable(t)) return t;
  }

  const cualquiera = trozo.match(/([\d]{1,3}(?:\.[\d]{3})*,[\d]+)/);
  if (cualquiera) {
    const t = aNumero(cualquiera[1]);
    if (razonable(t)) return t;
  }
  return null;
}

/* ---------------- Fuente 1: el portal del BCV ---------------- */
async function desdeBCV() {
  const respuesta = await fetch('https://www.bcv.org.ve/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-VE,es;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!respuesta.ok) throw new Error('BCV respondió ' + respuesta.status);

  const html = await respuesta.text();
  const usd = monedaDelPortal(html, 'dolar');
  if (!razonable(usd)) throw new Error('No se encontró la tasa del dólar en el portal');

  return {
    usd,
    eur: monedaDelPortal(html, 'euro'),
    fecha: fechaValor(html) || hoyCaracas(),
    fuente: 'bcv',
  };
}

/* ---------------- Fuente 2: espejo del BCV ----------------
   Publica exactamente las monedas del portal y su effective_date, que es
   la fecha valor. Se sirve como archivo estático, así que sigue en pie
   cuando el portal del BCV no responde. */
async function desdeEspejo() {
  const respuesta = await fetch('https://bcv.today/api/v1/rate.json', {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!respuesta.ok) throw new Error('El espejo respondió ' + respuesta.status);

  const d = await respuesta.json();
  const usd = aNumero(d && d.USD);
  if (!razonable(usd)) throw new Error('El espejo no traía una tasa reconocible');

  return {
    usd,
    eur: aNumero(d && d.EUR),
    fecha: (d && (d.effective_date || d.date)) || hoyCaracas(),
    fuente: 'bcv-espejo',
  };
}

/* ---------------- Fuente 3: republicador ---------------- */
async function desdeRepublicador() {
  const respuesta = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!respuesta.ok) throw new Error('El republicador respondió ' + respuesta.status);

  const d = await respuesta.json();
  const usd = aNumero(d && (d.promedio || d.venta || d.compra));
  if (!razonable(usd)) throw new Error('El republicador no traía una tasa reconocible');

  return {
    usd,
    eur: null,
    fecha: ((d && d.fechaActualizacion) || '').slice(0, 10) || hoyCaracas(),
    fuente: 'bcv-republicado',
  };
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
  let r = null;

  for (const fuente of [desdeBCV, desdeEspejo, desdeRepublicador]) {
    try {
      r = await fuente();
      break;
    } catch (e) {
      intentos.push({ fuente: fuente.name, error: e.message });
    }
  }

  if (!r) {
    return responder({
      error: 'No se pudo obtener la tasa oficial del BCV de ninguna fuente',
      intentos,
    }, 502);
  }

  const admin = createClient(URL_PROYECTO, LLAVE_SERVICIO);
  const ahora = new Date().toISOString();

  const filas = [{
    moneda: 'USD', fecha: r.fecha, tasa: r.usd, fuente: r.fuente, obtenida_en: ahora,
  }];

  // El euro solo si la fuente lo trae; no se deduce ni se inventa
  if (razonable(r.eur)) {
    filas.push({
      moneda: 'EUR', fecha: r.fecha, tasa: r.eur, fuente: r.fuente, obtenida_en: ahora,
    });
  }

  const { error } = await admin.from('tasas_cambio')
    .upsert(filas, { onConflict: 'moneda,fecha' });

  if (error) return responder({ error: error.message }, 500);

  return responder({
    guardada: true,
    fecha_valor: r.fecha,
    rige_desde_hoy: r.fecha <= hoyCaracas(),
    usd: r.usd,
    eur: razonable(r.eur) ? r.eur : null,
    fuente: r.fuente,
    intentos_fallidos: intentos,
  });
});
