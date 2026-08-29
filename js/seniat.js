/* =====================================================================
   BaratoPrimo — Conexión y Consulta SENIAT
   ---------------------------------------------------------------------
   Consulta en tiempo real al SENIAT para autocompletar la Razón Social /
   Nombre y la condición de Agente de Retención (75% / 100%).
   ===================================================================== */

window.INV = window.INV || {};

INV.seniat = {
  /* Limpia el RIF quitando guiones, espacios y puntos */
  sanear(prefijo, numero) {
    const p = String(prefijo || '').trim().toUpperCase();
    const n = String(numero || '').trim().replace(/\D/g, '');
    return { prefijo: p, numero: n, rif: `${p}${n}`, formato: `${p}-${n}` };
  },

  /* Consulta el RIF en el backend (Edge Function de Supabase) */
  async consultar(prefijo, numero) {
    const s = this.sanear(prefijo, numero);
    if (!s.prefijo || !s.numero || s.numero.length < 5) {
      throw new Error('Indica un prefijo y número de documento válido.');
    }

    const url = INV.config.FUNCION_SENIAT ||
      (INV.config.SUPABASE_URL ? `${INV.config.SUPABASE_URL}/functions/v1/consulta-rif` : null);

    if (!url || INV.config.MODO === 'demo' || INV.config.esLocal) {
      // En modo demo o sin función configurada, simular respuesta rápida realista
      await new Promise(r => setTimeout(r, 400));
      return {
        encontrado: true,
        rif: s.rif,
        rif_formateado: s.formato,
        nombre: s.prefijo === 'J' || s.prefijo === 'G'
          ? `EMPRESA DEMO ${s.numero}, C.A.`
          : `CIUDADANO DEMO ${s.numero}`,
        es_agente_retencion: s.prefijo === 'J' || s.prefijo === 'G',
        retencion_iva_porcentaje: (s.prefijo === 'J' || s.prefijo === 'G') ? 75 : 0,
        contribuyente_iva: 'SI',
        fuente: 'demo-local',
      };
    }

    try {
      const resp = await fetch(`${url}?rif=${encodeURIComponent(s.rif)}`, {
        headers: {
          'apikey': INV.config.SUPABASE_ANON || '',
          'Content-Type': 'application/json',
        },
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `El SENIAT no respondió (código ${resp.status})`);
      }

      const datos = await resp.json();
      if (!datos || !datos.encontrado) {
        throw new Error(datos.error || 'Documento no encontrado en el SENIAT.');
      }

      return datos;
    } catch (e) {
      throw new Error(e.message || 'No se pudo conectar con el servicio del SENIAT.');
    }
  },
};
