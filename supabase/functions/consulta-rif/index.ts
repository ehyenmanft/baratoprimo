/* =====================================================================
   BaratoPrimo — Consulta RIF y Agentes de Retención SENIAT
   ---------------------------------------------------------------------
   Consulta oficial del SENIAT (contribuyente.seniat.gob.ve) para
   obtener Razón Social / Nombre y condición de Agente de Retención (75% / 100%).

   Desplegar en Supabase:
     npx supabase functions deploy consulta-rif --no-verify-jwt
   ===================================================================== */

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

function limpiarRif(entrada: string): string {
  const r = entrada.toUpperCase().replace(/[^VEJPG0-9]/g, '');
  return r;
}

function parsearXmlSeniat(texto: string, rif: string) {
  const mNombre = texto.match(/<seniat:Nombre>([\s\S]*?)<\/seniat:Nombre>/i) ||
                  texto.match(/Nombre[:\s]*([^\n\r<]+)/i);
  if (!mNombre) return null;

  const nombre = mNombre[1].trim().replace(/\s+/g, ' ');
  if (!nombre || nombre.length < 2) return null;

  const mAgente = texto.match(/<seniat:AgenteRetencionIVA>([\s\S]*?)<\/seniat:AgenteRetencionIVA>/i) ||
                  texto.match(/Agente\s*Retenci[oó]n[:\s]*([A-Z]+)/i);
  const esAgente = (mAgente ? mAgente[1].trim().toUpperCase() : '') === 'SI' ||
                   texto.includes('AGENTE DE RETENCION') ||
                   texto.includes('AGENTE DE RETENCIÓN');

  const mTasa = texto.match(/<seniat:Tasa>([\s\S]*?)<\/seniat:Tasa>/i) ||
                texto.match(/Tasa[:\s]*(\d+)/i);
  let tasa = mTasa ? parseInt(mTasa[1].trim(), 10) : (esAgente ? 75 : 0);
  if (isNaN(tasa) || (tasa !== 75 && tasa !== 100)) {
    tasa = esAgente ? 75 : 0;
  }

  const mIva = texto.match(/<seniat:ContribuyenteIVA>([\s\S]*?)<\/seniat:ContribuyenteIVA>/i);
  const contribuyenteIva = mIva ? mIva[1].trim().toUpperCase() : 'SI';

  const prefijo = rif.slice(0, 1);
  const numero = rif.slice(1);
  const rifFormateado = `${prefijo}-${numero}`;

  return {
    encontrado: true,
    rif,
    rif_formateado: rifFormateado,
    nombre,
    es_agente_retencion: esAgente,
    retencion_iva_porcentaje: esAgente ? (tasa || 75) : 0,
    contribuyente_iva: contribuyenteIva,
  };
}

/* Fuente 1: SENIAT getContribuyente directo */
async function desdeSeniatDirecto(rif: string) {
  const url = `http://contribuyente.seniat.gob.ve/getContribuyente/getContribuyente?p_rif=${rif}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/xml,application/xml,text/html,*/*',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error('SENIAT directo respondió ' + resp.status);
  const texto = await resp.text();
  const res = parsearXmlSeniat(texto, rif);
  if (!res) throw new Error('Respuesta del SENIAT sin datos válidos');
  return { ...res, fuente: 'seniat-directo' };
}

/* Fuente 2: SENIAT getContribuyente vía lector intermediario */
async function desdeSeniatIntermediario(rif: string) {
  const url = `https://r.jina.ai/http://contribuyente.seniat.gob.ve/getContribuyente/getContribuyente?p_rif=${rif}`;
  const resp = await fetch(url, {
    headers: { 'Accept': 'text/plain' },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error('Intermediario SENIAT respondió ' + resp.status);
  const texto = await resp.text();
  const res = parsearXmlSeniat(texto, rif);
  if (!res) throw new Error('No se pudo parsear el RIF desde intermediario');
  return { ...res, fuente: 'seniat-proxy' };
}

/* Fuente 3: Portal SENIAT BuscaRif */
async function desdeSeniatBuscaRif(rif: string) {
  const url = `https://r.jina.ai/http://contribuyente.seniat.gob.ve/BuscaRif/BuscaRif.jsp?p_rif=${rif}`;
  const resp = await fetch(url, {
    headers: { 'Accept': 'text/plain' },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error('BuscaRif respondió ' + resp.status);
  const texto = await resp.text();
  
  const m = texto.match(/Nombre\s*o\s*Razón\s*Social[:\s]*([^\n\r<|]+)/i) ||
            texto.match(/Razón\s*Social[:\s]*([^\n\r<|]+)/i) ||
            texto.match(/Contribuyente[:\s]*([^\n\r<|]+)/i);
  if (!m) throw new Error('No se encontró el nombre en BuscaRif');

  const nombre = m[1].trim().replace(/\s+/g, ' ');
  const esAgente = texto.toUpperCase().includes('AGENTE DE RETENCI');
  const tasa100 = texto.includes('100%');

  const prefijo = rif.slice(0, 1);
  const numero = rif.slice(1);

  return {
    encontrado: true,
    rif,
    rif_formateado: `${prefijo}-${numero}`,
    nombre,
    es_agente_retencion: esAgente,
    retencion_iva_porcentaje: esAgente ? (tasa100 ? 100 : 75) : 0,
    contribuyente_iva: 'SI',
    fuente: 'seniat-buscarif',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  let rawRif = '';

  if (req.method === 'GET') {
    const url = new URL(req.url);
    rawRif = url.searchParams.get('rif') || '';
  } else {
    try {
      const body = await req.json();
      rawRif = body.rif || (body.prefijo && body.numero ? `${body.prefijo}${body.numero}` : '');
    } catch {
      return responder({ error: 'Cuerpo JSON inválido' }, 400);
    }
  }

  const rif = limpiarRif(rawRif);
  if (!rif || rif.length < 5) {
    return responder({ error: 'Indica un RIF o Cédula válido (ej. J403118225, V12345678)' }, 400);
  }

  const errores: string[] = [];

  for (const fuente of [desdeSeniatDirecto, desdeSeniatIntermediario, desdeSeniatBuscaRif]) {
    try {
      const datos = await fuente(rif);
      return responder(datos);
    } catch (e) {
      errores.push(`${fuente.name}: ${(e as Error).message}`);
    }
  }

  return responder({
    encontrado: false,
    error: 'No se pudo consultar el RIF en el SENIAT en este momento',
    detalles: errores,
  }, 404);
});
