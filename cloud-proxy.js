/* =====================================================================
   BaratoPrimo — On-Cloud Serverless Proxy (CNE & SENIAT)
   ---------------------------------------------------------------------
   Micro-servicio universal desplegable en la nube (Cloudflare Workers,
   Deno Deploy, Vercel Serverless, Render, Railway o Node.js).
   
   Permite realizar la consulta oficial a:
   1. CNE (Registro Electoral) para Personas Naturales (V / E)
   2. SENIAT (getContribuyente) para Personas Jurídicas (J / G / C / P)
   3. Validación Cruzada Dual entre ambas fuentes con detección de discrepancia.

   Uso directo (HTTP GET):
     https://<tu-proxy>.workers.dev/?rif=V3475738
     https://<tu-proxy>.workers.dev/?rif=V18487715
     https://<tu-proxy>.workers.dev/?rif=V6465258
   ===================================================================== */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function responder(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function parsearHtmlCne(html, prefijo, numero) {
  if (!html) return null;
  const mNombre = html.match(/Nombre:<\/b><\/td>\s*<td[^>]*><b>([^<]+)<\/b>/i) ||
                  html.match(/<b>Nombre:<\/b>[\s\S]*?<b>([^<]+)<\/b>/i) ||
                  html.match(/Nombre[:\s]*([A-ZÁÉÍÓÚÑ\s]{3,})/i);
  if (!mNombre) return null;

  const nombre = mNombre[1].trim().replace(/\s+/g, ' ');
  if (!nombre || nombre.length < 3 || nombre.includes('No se encuentra')) return null;

  const mEstado = html.match(/Estado:<\/b><\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
  const mMunicipio = html.match(/Municipio:<\/b><\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
  const mParroquia = html.match(/Parroquia:<\/b><\/td>\s*<td[^>]*>([^<]+)<\/td>/i);

  const direccion = [
    mParroquia ? mParroquia[1].trim() : '',
    mMunicipio ? mMunicipio[1].trim() : '',
    mEstado ? mEstado[1].trim() : '',
  ].filter(Boolean).join(', ');

  const nac = prefijo.toUpperCase() === 'E' ? 'E' : 'V';
  return {
    encontrado: true,
    rif: `${nac}${numero}`.toUpperCase(),
    rif_formateado: `${nac}-${numero}`,
    nombre,
    tipo_persona: 'natural',
    es_agente_retencion: false,
    retencion_iva_porcentaje: 0,
    retencion_islr_porcentaje: 0,
    contribuyente_iva: 'SI',
    direccion: direccion || null,
    fuente: 'CNE',
  };
}

function parsearXmlSeniat(texto, rif) {
  if (!texto) return null;
  const mNombre = texto.match(/<seniat:Nombre>([\s\S]*?)<\/seniat:Nombre>/i) ||
                  texto.match(/Nombre[:\s]*([^\n\r<]+)/i);
  if (!mNombre) return null;

  const nombre = mNombre[1].trim().replace(/\s+/g, ' ');
  if (!nombre || nombre.length < 2) return null;

  const mAgente = texto.match(/<seniat:AgenteRetencionIVA>([\s\S]*?)<\/seniat:AgenteRetencionIVA>/i) ||
                  texto.match(/Agente\s*Retenci[oó]n[:\s]*([A-Z]+)/i);
  const esAgente = (mAgente ? mAgente[1].trim().toUpperCase() : '') === 'SI' ||
                   texto.toUpperCase().includes('AGENTE DE RETENCION');

  const mTasa = texto.match(/<seniat:Tasa>([\s\S]*?)<\/seniat:Tasa>/i) ||
                texto.match(/Tasa[:\s]*(\d+)/i);
  let tasa = mTasa ? parseInt(mTasa[1].trim(), 10) : (esAgente ? 75 : 0);
  if (isNaN(tasa) || (tasa !== 75 && tasa !== 100)) tasa = esAgente ? 75 : 0;

  const prefijo = rif.slice(0, 1).toUpperCase();
  const numero = rif.slice(1);

  return {
    encontrado: true,
    rif: rif.toUpperCase(),
    rif_formateado: `${prefijo}-${numero}`,
    nombre,
    tipo_persona: ['J', 'G', 'C'].includes(prefijo) ? 'juridica' : 'natural',
    es_agente_retencion: esAgente,
    retencion_iva_porcentaje: esAgente ? (tasa || 75) : 0,
    retencion_islr_porcentaje: esAgente ? 2 : 0,
    contribuyente_iva: 'SI',
    fuente: 'SENIAT',
  };
}

async function consultar(rifRaw) {
  const limpio = (rifRaw || '').toString().toUpperCase().replace(/[^VEJPG0-9]/g, '');
  if (!limpio || limpio.length < 5) {
    return { error: 'Documento o RIF inválido (mínimo 5 dígitos)' };
  }

  const prefijo = limpio.slice(0, 1);
  const numero = limpio.slice(1);
  const esNatural = prefijo === 'V' || prefijo === 'E';

  let resCne = null;
  let resSeniat = null;

  // Consultar CNE
  if (esNatural) {
    try {
      const respCne = await fetch(`http://www.cne.gob.ve/web/registro_electoral/ce.php?nac=${prefijo}&ced=${numero}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000),
      });
      if (respCne.ok) {
        const html = await respCne.text();
        resCne = parsearHtmlCne(html, prefijo, numero);
      }
    } catch (_e) {}
  }

  // Consultar SENIAT
  try {
    const respSen = await fetch(`http://contribuyente.seniat.gob.ve/getContribuyente/getContribuyente?p_rif=${limpio}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000),
    });
    if (respSen.ok) {
      const xml = await respSen.text();
      resSeniat = parsearXmlSeniat(xml, limpio);
    }
  } catch (_e) {}

  // Validación cruzada
  if (resCne && resSeniat && resCne.nombre && resSeniat.nombre) {
    const a = resCne.nombre.toUpperCase().replace(/[^A-Z]/g, '');
    const b = resSeniat.nombre.toUpperCase().replace(/[^A-Z]/g, '');
    const coinciden = a.includes(b) || b.includes(a);
    if (!coinciden) {
      return {
        encontrado: false,
        coinciden: false,
        discrepancia: true,
        rif: limpio,
        error: `Discrepancia detectada: CNE ("${resCne.nombre}") vs SENIAT ("${resSeniat.nombre}").`,
      };
    }
  }

  const final = resCne || resSeniat;
  if (final && final.nombre) {
    return { ...final, coinciden: true };
  }

  return { encontrado: false, error: 'No se encontraron datos en los servidores oficiales' };
}

// Export para Cloudflare Workers / Deno / Vercel
export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

    const url = new URL(request.url);
    const rif = url.searchParams.get('rif') || url.searchParams.get('cedula') || '';

    const resultado = await consultar(rif);
    const status = resultado.encontrado ? 200 : (resultado.discrepancia ? 409 : 404);
    return responder(resultado, status);
  }
};
