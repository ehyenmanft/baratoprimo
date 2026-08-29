/* =====================================================================
   BaratoPrimo — tasa oficial del BCV
   ---------------------------------------------------------------------
   Solo fuentes que publican la tasa OFICIAL del Banco Central (bcv.org.ve).
   Se leen USD, EUR y demás monedas oficiales (CNY, TRY, RUB) con su FECHA VALOR.

   Cada tasa se guarda con su FECHA VALOR —el día desde el que rige—, no
   con la fecha en que se consultó. Es lo que publica el propio BCV y lo
   que permite explicar una factura vieja con la tasa de aquel día.

   Fuentes, en orden:
     1. Lector del portal oficial del BCV (bcv.org.ve vía intermediario),
        que obtiene el portal oficial actualizado al instante sin fallos de certificado TLS.
     2. bcv.org.ve — conexión directa al portal.
     3. bcv.today — espejo del BCV con histórico y tasas futuras publicadas.
     4. ve.dolarapi.com — tasa oficial republicada (respaldo).

   Si las fuentes fallan no se inventa nada: se responde con error y la
   aplicación sigue con la última tasa conocida, avisando de su edad.

   Desplegar: Edge Functions → tasa-bcv
   ===================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/* El BCV escribe los números a la venezolana: 794,99170000 son
   setecientos noventa y cuatro con noventa y nueve. El punto separa miles
   y la coma, decimales. */
function aNumero(texto: unknown): number | null {
  if (texto === null || texto === undefined) return null;
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
const razonable = (t: number | null): t is number => t !== null && t > 1 && t < 100000000;

/* Fecha de Caracas, cuatro horas por detrás de UTC */
const hoyCaracas = () =>
  new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);

const MESES: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09',
  octubre: '10', noviembre: '11', diciembre: '12',
};

/* "Fecha Valor: Lunes, 31 Agosto 2026" → "2026-08-31".
   Es el día desde el que rige la tasa, y no tiene por qué ser hoy: el
   BCV publica por la tarde la que aplicará el siguiente día hábil. */
function fechaValor(html: string): string | null {
  const mContent = html.match(/content=["'](\d{4}-\d{2}-\d{2})T/i);
  if (mContent) return mContent[1];

  const m = html.match(
    /Fecha\s*Valor[:\s]*[^,<]*[,]?\s*(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(\d{4})/i);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  return `${m[3]}-${mes}-${m[1].padStart(2, '0')}`;
}

/* Lee el valor de un bloque de moneda del portal HTML (#dolar, #euro…) */
function monedaDelPortal(html: string, id: string): number | null {
  const ventana = html.match(new RegExp(`id=["']${id}["']([\\s\\S]{0,800})`, 'i'));
  if (!ventana) return null;
  const trozo = ventana[1];

  const conStrong = trozo.match(/<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/i);
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

/* ---------------- Fuente 1: El portal oficial del BCV leído por intermediario ----------------
   El certificado de bcv.org.ve suele hacer que la conexión directa falle desde servidores cloud.
   Este lector descarga el portal oficial directamente y permite leer la última tasa publicada. */
async function desdePortalIndirecto() {
  const respuesta = await fetch('https://r.jina.ai/https://www.bcv.org.ve/', {
    headers: { 'Accept': 'text/plain' },
    signal: AbortSignal.timeout(25000),
  });
  if (!respuesta.ok) throw new Error('El intermediario respondió ' + respuesta.status);

  const texto = await respuesta.text();

  const tras = (etiqueta: string) => {
    const m = texto.match(new RegExp(etiqueta + '[\\s\\S]{0,120}?([\\d]{1,3}(?:\\.[\\d]{3})*,[\\d]+)', 'i'));
    return m ? aNumero(m[1]) : null;
  };

  const usd = tras('USD');
  if (!razonable(usd)) throw new Error('No se encontró el dólar en el texto del portal');

  return {
    usd,
    eur: tras('EUR'),
    cny: tras('CNY'),
    try: tras('TRY'),
    rub: tras('RUB'),
    fecha: fechaValor(texto) || hoyCaracas(),
    fuente: 'bcv-portal',
  };
}

/* ---------------- Fuente 2: El portal del BCV (conexión directa) ---------------- */
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
    cny: monedaDelPortal(html, 'yuan'),
    try: monedaDelPortal(html, 'lira'),
    rub: monedaDelPortal(html, 'rublo'),
    fecha: fechaValor(html) || hoyCaracas(),
    fuente: 'bcv-directo',
  };
}

/* ---------------- Fuente 3: Espejo del BCV (bcv.today) ----------------
   Publica las monedas del portal y su effective_date (fecha valor). */
async function desdeEspejo() {
  const pedir = async (url: string) => {
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const usd = aNumero(d && d.USD);
    return razonable(usd) ? { d, usd } : null;
  };

  const base = new Date(Date.now() - 4 * 3600 * 1000);
  for (let i = 1; i <= 5; i++) {
    const dia = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
    try {
      const futura = await pedir(`https://bcv.today/api/v1/history/${dia}.json`);
      if (futura) {
        return {
          usd: futura.usd,
          eur: aNumero(futura.d.EUR),
          cny: aNumero(futura.d.CNY),
          try: aNumero(futura.d.TRY),
          rub: aNumero(futura.d.RUB),
          fecha: futura.d.effective_date || dia,
          fuente: 'bcv-espejo',
        };
      }
    } catch { /* continuar si el día aún no existe */ }
  }

  const hoy = await pedir('https://bcv.today/api/v1/rate.json');
  if (!hoy) throw new Error('El espejo no traía una tasa reconocible');

  return {
    usd: hoy.usd,
    eur: aNumero(hoy.d.EUR),
    cny: aNumero(hoy.d.CNY),
    try: aNumero(hoy.d.TRY),
    rub: aNumero(hoy.d.RUB),
    fecha: (hoy.d.effective_date || hoy.d.date) || hoyCaracas(),
    fuente: 'bcv-espejo',
  };
}

/* ---------------- Fuente 4: Republicador DolarApi ---------------- */
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
    cny: null,
    try: null,
    rub: null,
    fecha: ((d && d.fechaActualizacion) || '').slice(0, 10) || hoyCaracas(),
    fuente: 'bcv-republicado',
  };
}

Deno.serve(async (peticion) => {
  if (peticion.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const primera = (...nombres: string[]) => nombres.map(n => Deno.env.get(n)).find(v => v);
  const URL_PROYECTO   = primera('SUPABASE_URL', 'PROJECT_URL');
  const LLAVE_SERVICIO = primera('SUPABASE_SERVICE_ROLE_KEY', 'SB_SECRET_KEY', 'SERVICE_ROLE_KEY');

  if (!URL_PROYECTO || !LLAVE_SERVICIO) {
    return responder({ error: 'Faltan las variables del proyecto' }, 500);
  }

  const intentos: Array<{ fuente: string; error: string }> = [];
  let r: {
    usd: number;
    eur: number | null;
    cny?: number | null;
    try?: number | null;
    rub?: number | null;
    fecha: string;
    fuente: string;
  } | null = null;

  for (const fuente of [desdePortalIndirecto, desdeBCV, desdeEspejo, desdeRepublicador]) {
    try {
      r = await fuente();
      break;
    } catch (e) {
      intentos.push({ fuente: fuente.name, error: (e as Error).message });
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

  if (razonable(r.eur)) {
    filas.push({ moneda: 'EUR', fecha: r.fecha, tasa: r.eur, fuente: r.fuente, obtenida_en: ahora });
  }
  if (razonable(r.cny)) {
    filas.push({ moneda: 'CNY', fecha: r.fecha, tasa: r.cny, fuente: r.fuente, obtenida_en: ahora });
  }
  if (razonable(r.try)) {
    filas.push({ moneda: 'TRY', fecha: r.fecha, tasa: r.try, fuente: r.fuente, obtenida_en: ahora });
  }
  if (razonable(r.rub)) {
    filas.push({ moneda: 'RUB', fecha: r.fecha, tasa: r.rub, fuente: r.fuente, obtenida_en: ahora });
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
    cny: razonable(r.cny) ? r.cny : null,
    try: razonable(r.try) ? r.try : null,
    rub: razonable(r.rub) ? r.rub : null,
    fuente: r.fuente,
    intentos_fallidos: intentos,
  });
});
