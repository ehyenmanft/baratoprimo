/* =====================================================================
   BaratoPrimo — Micro-Proxy Local SENIAT (IP Venezolana)
   ---------------------------------------------------------------------
   Este script corre localmente en cualquier máquina o servidor con
   conexión de internet en Venezuela (CANTV, Fibra, etc.).
   
   Permite consultar directamente al portal del SENIAT sin bloqueo de IP
   y devuelve los datos en JSON listos para BaratoPrimo.

   Uso:
     node proxy-seniat.js
   
   Por defecto escucha en el puerto 3030:
     http://localhost:3030/consulta?rif=V19273163
   ===================================================================== */

const http = require('http');
const https = require('https');
const url = require('url');

const PUERTO = process.env.PORT || 3030;

function parsearXmlSeniat(texto, rif) {
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
    es_agente_retencion: esAgente,
    retencion_iva_porcentaje: esAgente ? (tasa || 75) : 0,
    contribuyente_iva: 'SI',
    fuente: 'seniat-local-proxy',
  };
}

async function consultarSeniat(rif) {
  const target = `http://contribuyente.seniat.gob.ve/getContribuyente/getContribuyente?p_rif=${rif}`;
  return new Promise((resolve, reject) => {
    http.get(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/xml,application/xml,text/html,*/*',
      },
      timeout: 6000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const parsed = parsearXmlSeniat(data, rif);
        if (parsed) resolve(parsed);
        else reject(new Error('Respuesta del SENIAT sin datos válidos'));
      });
    }).on('error', err => reject(err))
      .on('timeout', () => reject(new Error('Timeout conectando con SENIAT')));
  });
}

function parsearHtmlCne(html, prefijo, numero) {
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
    fuente: 'cne-local-proxy',
  };
}

async function consultarCne(prefijo, numero) {
  const nac = prefijo.toUpperCase() === 'E' ? 'E' : 'V';
  const target = `http://www.cne.gob.ve/web/registro_electoral/ce.php?nac=${nac}&ced=${numero}`;
  return new Promise((resolve, reject) => {
    http.get(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 6000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const parsed = parsearHtmlCne(data, nac, numero);
        if (parsed) resolve(parsed);
        else reject(new Error('Cédula no encontrada en CNE'));
      });
    }).on('error', err => reject(err))
      .on('timeout', () => reject(new Error('Timeout conectando con CNE')));
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  if (parsedUrl.pathname === '/consulta' || parsedUrl.pathname === '/') {
    const rawRif = (parsedUrl.query.rif || '').toString().toUpperCase().replace(/[^VEJPG0-9]/g, '');
    if (!rawRif || rawRif.length < 5) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'RIF o Cédula inválido' }));
    }

    const prefijo = rawRif.slice(0, 1);
    const numero = rawRif.slice(1);
    const esNatural = prefijo === 'V' || prefijo === 'E';

    try {
      let datos = null;
      if (esNatural) {
        try {
          datos = await consultarCne(prefijo, numero);
        } catch (_errCne) {
          datos = await consultarSeniat(rawRif);
        }
      } else {
        datos = await consultarSeniat(rawRif);
      }

      res.writeHead(200);
      return res.end(JSON.stringify(datos));
    } catch (e) {
      res.writeHead(502);
      return res.end(JSON.stringify({ encontrado: false, error: e.message }));
    }
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
});

server.listen(PUERTO, () => {
  console.log(`[BaratoPrimo] Micro-proxy SENIAT/CNE activo en http://localhost:${PUERTO}`);
  console.log(`Prueba Persona Natural: http://localhost:${PUERTO}/consulta?rif=V13828612`);
  console.log(`Prueba Persona Jurídica: http://localhost:${PUERTO}/consulta?rif=J000029490`);
});
