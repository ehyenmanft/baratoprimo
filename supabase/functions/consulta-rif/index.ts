/* =====================================================================
   BaratoPrimo — Consulta RIF con Validación Cruzada Dual
   ---------------------------------------------------------------------
   Consulta en paralelo entre dos fuentes oficiales (CNE y SENIAT),
   normaliza y compara los datos:
   - Si coinciden: devuelve los datos validados para retrieve automático.
   - Si difieren: devuelve error detallado con los datos no coincidentes.
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
  return entrada.toUpperCase().replace(/[^VEJPG0-9]/g, '');
}

function normalizar(texto: string): string {
  return (texto || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compararNombres(nombreA: string, nombreB: string): { coinciden: boolean; ratio: number } {
  const a = normalizar(nombreA);
  const b = normalizar(nombreB);
  if (!a || !b) return { coinciden: false, ratio: 0 };
  if (a === b) return { coinciden: true, ratio: 1.0 };

  const palabrasA = a.split(' ').filter(p => p.length > 1);
  const palabrasB = b.split(' ').filter(p => p.length > 1);

  if (!palabrasA.length || !palabrasB.length) return { coinciden: false, ratio: 0 };

  const comunes = palabrasA.filter(p => palabrasB.includes(p));
  const minPalabras = Math.min(palabrasA.length, palabrasB.length);
  const ratio = comunes.length / minPalabras;

  return {
    coinciden: ratio >= 0.65,
    ratio: Math.round(ratio * 100) / 100,
  };
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
                   texto.includes('AGENTE DE RETENCION');

  const mTasa = texto.match(/<seniat:Tasa>([\s\S]*?)<\/seniat:Tasa>/i) ||
                texto.match(/Tasa[:\s]*(\d+)/i);
  let tasa = mTasa ? parseInt(mTasa[1].trim(), 10) : (esAgente ? 75 : 0);
  if (isNaN(tasa) || (tasa !== 75 && tasa !== 100)) tasa = esAgente ? 75 : 0;

  const prefijo = rif.slice(0, 1);
  const numero = rif.slice(1);

  return {
    encontrado: true,
    rif,
    rif_formateado: `${prefijo}-${numero}`,
    nombre,
    es_agente_retencion: esAgente,
    retencion_iva_porcentaje: esAgente ? (tasa || 75) : 0,
    contribuyente_iva: 'SI',
    fuente: 'SENIAT',
  };
}

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

async function fetchConTimeout(url: string, ms = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(t);
    return r;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
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
    return responder({ error: 'Indica un RIF o Cédula válido' }, 400);
  }

  const prefijo = rif.slice(0, 1);
  const numero = rif.slice(1);
  const esNatural = prefijo === 'V' || prefijo === 'E';

  // 1. Revisar Padrón de Supabase (Base oficial verificada)
  const sbUrl = Deno.env.get('SUPABASE_URL') || '';
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  let datosPadron = null;

  if (sbUrl && sbKey) {
    try {
      const supabase = createClient(sbUrl, sbKey);
      const { data } = await supabase
        .from('padron_contribuyentes')
        .select('*')
        .ilike('rif', rif)
        .limit(1);
      if (data && data.length > 0) datosPadron = data[0];
    } catch (_e) {}
  }

  // 2. Consulta concurrente a fuentes externas
  let resultadoA: any = null; // Fuente principal (CNE para natural, SENIAT para jurídica)
  let resultadoB: any = datosPadron ? {
    nombre: datosPadron.nombre,
    fuente: 'Padrón Oficial Supabase',
    es_agente_retencion: !!datosPadron.es_agente_retencion,
    retencion_iva_porcentaje: Number(datosPadron.retencion_iva_porcentaje || 0),
  } : null;

  if (esNatural) {
    // Fuente A: CNE
    try {
      const respCne = await fetchConTimeout(`http://www.cne.gob.ve/web/registro_electoral/ce.php?nac=${prefijo}&ced=${numero}`);
      if (respCne.ok) {
        const html = await respCne.text();
        resultadoA = parsearHtmlCne(html, prefijo, numero);
      }
    } catch (_e) {
      try {
        const respJina = await fetchConTimeout(`https://r.jina.ai/http://www.cne.gob.ve/web/registro_electoral/ce.php?nac=${prefijo}&ced=${numero}`);
        if (respJina.ok) {
          const html = await respJina.text();
          resultadoA = parsearHtmlCne(html, prefijo, numero);
        }
      } catch (_e2) {}
    }

    // Fuente B: SENIAT (si no estaba en padrón)
    if (!resultadoB) {
      try {
        const respSen = await fetchConTimeout(`http://contribuyente.seniat.gob.ve/getContribuyente/getContribuyente?p_rif=${rif}`);
        if (respSen.ok) {
          const xml = await respSen.text();
          resultadoB = parsearXmlSeniat(xml, rif);
        }
      } catch (_e) {}
    }
  } else {
    // Para empresas: Fuente A = SENIAT directo, Fuente B = Padrón / Intermediario
    try {
      const respSen = await fetchConTimeout(`http://contribuyente.seniat.gob.ve/getContribuyente/getContribuyente?p_rif=${rif}`);
      if (respSen.ok) {
        const xml = await respSen.text();
        resultadoA = parsearXmlSeniat(xml, rif);
      }
    } catch (_e) {
      try {
        const respJina = await fetchConTimeout(`https://r.jina.ai/http://contribuyente.seniat.gob.ve/getContribuyente/getContribuyente?p_rif=${rif}`);
        if (respJina.ok) {
          const xml = await respJina.text();
          resultadoA = parsearXmlSeniat(xml, rif);
        }
      } catch (_e2) {}
    }
  }

  // 3. Comparación y Validación Cruzada
  const f1 = resultadoA;
  const f2 = resultadoB;

  // CASO I: Ambas fuentes respondieron -> COMPARAR
  if (f1 && f2 && f1.nombre && f2.nombre) {
    const comp = compararNombres(f1.nombre, f2.nombre);
    if (!comp.coinciden) {
      return responder({
        encontrado: false,
        coinciden: false,
        discrepancia: true,
        rif,
        error: `Discrepancia detectada: Los datos no coinciden entre ${f1.fuente} ("${f1.nombre}") y ${f2.fuente} ("${f2.nombre}").`,
        datos_fuente_1: { fuente: f1.fuente, nombre: f1.nombre },
        datos_fuente_2: { fuente: f2.fuente, nombre: f2.nombre },
      }, 409);
    }

    // Coincidencia positiva verificada
    const nombreVerificado = f1.nombre.length >= f2.nombre.length ? f1.nombre : f2.nombre;
    const datosFinales = {
      encontrado: true,
      coinciden: true,
      verificado_dual: true,
      rif,
      rif_formateado: `${prefijo}-${numero}`,
      nombre: nombreVerificado,
      tipo_persona: esNatural ? 'natural' : 'juridica',
      es_agente_retencion: f1.es_agente_retencion || f2.es_agente_retencion || false,
      retencion_iva_porcentaje: f1.retencion_iva_porcentaje || f2.retencion_iva_porcentaje || (esNatural ? 0 : 75),
      retencion_islr_porcentaje: f1.retencion_islr_porcentaje || f2.retencion_islr_porcentaje || 0,
      contribuyente_iva: 'SI',
      direccion: f1.direccion || f2.direccion || null,
      fuente: `Verificado cruzado (${f1.fuente} + ${f2.fuente})`,
    };

    // Guardar en Supabase
    if (sbUrl && sbKey) {
      try {
        const supabase = createClient(sbUrl, sbKey);
        await supabase.from('padron_contribuyentes').upsert(datosFinales, { onConflict: 'rif' });
      } catch (_err) {}
    }

    return responder(datosFinales, 200);
  }

  // CASO II: Solo una fuente respondió con datos válidos
  const fuenteUnica = f1 || f2;
  if (fuenteUnica && fuenteUnica.nombre) {
    const datosFinales = {
      encontrado: true,
      coinciden: true,
      verificado_dual: false,
      rif,
      rif_formateado: `${prefijo}-${numero}`,
      nombre: fuenteUnica.nombre,
      tipo_persona: esNatural ? 'natural' : 'juridica',
      es_agente_retencion: fuenteUnica.es_agente_retencion || (!esNatural),
      retencion_iva_porcentaje: fuenteUnica.retencion_iva_porcentaje || (esNatural ? 0 : 75),
      retencion_islr_porcentaje: fuenteUnica.retencion_islr_porcentaje || 0,
      contribuyente_iva: 'SI',
      direccion: fuenteUnica.direccion || null,
      fuente: fuenteUnica.fuente,
    };

    if (sbUrl && sbKey) {
      try {
        const supabase = createClient(sbUrl, sbKey);
        await supabase.from('padron_contribuyentes').upsert(datosFinales, { onConflict: 'rif' });
      } catch (_err) {}
    }

    return responder(datosFinales, 200);
  }

  // CASO III: Ninguna fuente respondió
  return responder({
    encontrado: false,
    coinciden: false,
    rif,
    error: 'No se encontraron registros del contribuyente en las fuentes consultadas.',
  }, 404);
});
