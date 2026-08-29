/* =====================================================================
   BaratoPrimo — Consulta RIF y Agentes de Retención SENIAT
   ---------------------------------------------------------------------
   Consulta en tiempo real al Padrón Fiscal en Supabase y al SENIAT
   (contribuyente.seniat.gob.ve) para obtener Razón Social / Nombre
   y condición de Agente de Retención (75% / 100%).
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
    signal: AbortSignal.timeout(4000),
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
    signal: AbortSignal.timeout(4000),
  });
  if (!resp.ok) throw new Error('Intermediario SENIAT respondió ' + resp.status);
  const texto = await resp.text();
  const res = parsearXmlSeniat(texto, rif);
  if (!res) throw new Error('No se pudo parsear el RIF desde intermediario');
  return { ...res, fuente: 'seniat-proxy' };
}

/* Fuente 3: CNE Registro Electoral para Personas Naturales (V y E) */
function parsearHtmlCne(html: string, prefijo: string, numero: string) {
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
  const rif = `${nac}${numero}`.toUpperCase();
  return {
    encontrado: true,
    rif,
    rif_formateado: `${nac}-${numero}`,
    nombre,
    tipo_persona: 'natural',
    es_agente_retencion: false,
    retencion_iva_porcentaje: 0,
    retencion_islr_porcentaje: 0,
    contribuyente_iva: 'SI',
    direccion: direccion || null,
    fuente: 'cne-registro-electoral',
  };
}

async function desdeCneDirecto(prefijo: string, numero: string) {
  const nac = prefijo.toUpperCase() === 'E' ? 'E' : 'V';
  const url = `http://www.cne.gob.ve/web/registro_electoral/ce.php?nac=${nac}&ced=${numero}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(4000),
  });
  if (!resp.ok) throw new Error('CNE respondió ' + resp.status);
  const html = await resp.text();
  const res = parsearHtmlCne(html, nac, numero);
  if (!res) throw new Error('Cédula no encontrada en CNE');
  return res;
}

async function desdeCneIntermediario(prefijo: string, numero: string) {
  const nac = prefijo.toUpperCase() === 'E' ? 'E' : 'V';
  const url = `https://r.jina.ai/http://www.cne.gob.ve/web/registro_electoral/ce.php?nac=${nac}&ced=${numero}`;
  const resp = await fetch(url, {
    headers: { 'Accept': 'text/plain' },
    signal: AbortSignal.timeout(4000),
  });
  if (!resp.ok) throw new Error('CNE intermediario respondió ' + resp.status);
  const html = await resp.text();
  const res = parsearHtmlCne(html, nac, numero);
  if (!res) throw new Error('No se pudo parsear CNE desde intermediario');
  return res;
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
    return responder({ error: 'Indica un RIF o Cédula válido (ej. V13828612, J000029490)' }, 400);
  }

  const prefijo = rif.slice(0, 1);
  const numero = rif.slice(1);
  const esPersonaNatural = prefijo === 'V' || prefijo === 'E';

  // 1. Consultar en la base de datos de Supabase (padron_contribuyentes)
  const sbUrl = Deno.env.get('SUPABASE_URL') || '';
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (sbUrl && sbKey) {
    try {
      const supabase = createClient(sbUrl, sbKey);
      const { data, error } = await supabase
        .from('padron_contribuyentes')
        .select('*')
        .ilike('rif', rif)
        .limit(1);

      if (!error && data && data.length > 0) {
        const item = data[0];
        return responder({
          encontrado: true,
          rif: item.rif,
          rif_formateado: item.rif_formateado || `${prefijo}-${numero}`,
          nombre: item.nombre,
          es_agente_retencion: !!item.es_agente_retencion,
          retencion_iva_porcentaje: Number(item.retencion_iva_porcentaje || 0),
          retencion_islr_porcentaje: Number(item.retencion_islr_porcentaje || 0),
          contribuyente_iva: item.contribuyente_iva || 'SI',
          direccion: item.direccion || null,
          telefono: item.telefono || null,
          fuente: 'padron-supabase',
        });
      }
    } catch (_e) { /* continuar a búsqueda externa */ }
  }

  // 2. Si no está en el padrón, consultar según tipo de contribuyente
  const errores: string[] = [];

  if (esPersonaNatural) {
    // Para personas naturales: consultar CNE (Registro Electoral) y luego SENIAT
    for (const fuente of [
      () => desdeCneDirecto(prefijo, numero),
      () => desdeCneIntermediario(prefijo, numero),
      () => desdeSeniatDirecto(rif),
      () => desdeSeniatIntermediario(rif),
    ]) {
      try {
        const datos = await fuente();
        // Guardar en Supabase para futuras consultas
        if (sbUrl && sbKey && datos && datos.nombre) {
          try {
            const supabase = createClient(sbUrl, sbKey);
            await supabase.from('padron_contribuyentes').upsert({
              rif: datos.rif,
              rif_formateado: datos.rif_formateado,
              nombre: datos.nombre,
              tipo_persona: 'natural',
              es_agente_retencion: datos.es_agente_retencion,
              retencion_iva_porcentaje: datos.retencion_iva_porcentaje,
              retencion_islr_porcentaje: 0,
              contribuyente_iva: datos.contribuyente_iva,
              direccion: datos.direccion || null,
              fuente: datos.fuente || 'cne-live',
            }, { onConflict: 'rif' });
          } catch (_err) {}
        }
        return responder(datos);
      } catch (e) {
        errores.push((e as Error).message);
      }
    }
  } else {
    // Para empresas / entes jurídicos: consultar SENIAT getContribuyente
    for (const fuente of [
      () => desdeSeniatDirecto(rif),
      () => desdeSeniatIntermediario(rif),
    ]) {
      try {
        const datos = await fuente();
        if (sbUrl && sbKey && datos && datos.nombre) {
          try {
            const supabase = createClient(sbUrl, sbKey);
            await supabase.from('padron_contribuyentes').upsert({
              rif: datos.rif,
              rif_formateado: datos.rif_formateado,
              nombre: datos.nombre,
              tipo_persona: ['J', 'G'].includes(prefijo) ? 'juridica' : 'natural',
              es_agente_retencion: datos.es_agente_retencion,
              retencion_iva_porcentaje: datos.retencion_iva_porcentaje,
              retencion_islr_porcentaje: 0,
              contribuyente_iva: datos.contribuyente_iva,
              fuente: datos.fuente || 'seniat-live',
            }, { onConflict: 'rif' });
          } catch (_err) {}
        }
        return responder(datos);
      } catch (e) {
        errores.push((e as Error).message);
      }
    }
  }

  // 3. Si no respondió ningún servicio externo
  return responder({
    encontrado: false,
    rif,
    error: 'Contribuyente no encontrado en el padrón ni en los servidores oficiales.',
    detalles: errores,
  }, 404);
});

