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
      return res.end(JSON.stringify({ error: 'RIF inválido' }));
    }

    try {
      const datos = await consultarSeniat(rawRif);
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
  console.log(`[BaratoPrimo] Micro-proxy SENIAT activo en http://localhost:${PUERTO}`);
  console.log(`Prueba: http://localhost:${PUERTO}/consulta?rif=V19273163`);
});
