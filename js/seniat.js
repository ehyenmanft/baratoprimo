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

  /* Calcula el dígito verificador oficial del RIF venezolano (Módulo 11) */
  calcularDigito(prefijo, numero) {
    const p = String(prefijo || 'V').toUpperCase();
    const numLimpio = String(numero || '').replace(/\D/g, '');
    const n = numLimpio.padStart(8, '0').slice(-8);
    const mapa = { 'V': 1, 'E': 2, 'J': 3, 'P': 4, 'G': 5, 'C': 3 };
    const pVal = mapa[p] || 1;
    const coef = [4, 3, 2, 7, 6, 5, 4, 3, 2];
    const digitos = [pVal, ...n.split('').map(Number)];
    const suma = digitos.reduce((acc, d, i) => acc + d * coef[i], 0);
    const resto = suma % 11;
    const dv = (11 - resto) % 11;
    return (dv >= 10) ? 0 : dv;
  },

  /* Diccionario de contribuyentes conocidos / pruebas rápidas */
  conocidos: {
    'V19273163': {
      nombre: 'JAMES MARIANO ARANDA TOMASINI',
      es_agente_retencion: false,
      retencion_iva_porcentaje: 0,
      contribuyente_iva: 'SI',
    },
    'V18487715': {
      nombre: 'CONTRIBUYENTE V-18487715',
      es_agente_retencion: false,
      retencion_iva_porcentaje: 0,
      contribuyente_iva: 'SI',
    },
    'V5090290': {
      nombre: 'CONTRIBUYENTE V-5090290',
      es_agente_retencion: false,
      retencion_iva_porcentaje: 0,
      contribuyente_iva: 'SI',
    },
    'J000029490': {
      nombre: 'BANCO DEL CARIBE, C.A. BANCO UNIVERSAL (BANCARIBE)',
      es_agente_retencion: true,
      retencion_iva_porcentaje: 75,
      retencion_islr_porcentaje: 2,
      contribuyente_iva: 'SI',
    },
    'J000029679': {
      nombre: 'BANCO MERCANTIL, C.A. BANCO UNIVERSAL',
      es_agente_retencion: true,
      retencion_iva_porcentaje: 75,
      retencion_islr_porcentaje: 2,
      contribuyente_iva: 'SI',
    },
    'J000001201': {
      nombre: 'CERVECERIA POLAR, C.A.',
      es_agente_retencion: true,
      retencion_iva_porcentaje: 75,
      retencion_islr_porcentaje: 2,
      contribuyente_iva: 'SI',
    },
    'J000122555': {
      nombre: 'C.A. NACIONAL TELEFONOS DE VENEZUELA (CANTV)',
      es_agente_retencion: true,
      retencion_iva_porcentaje: 100,
      retencion_islr_porcentaje: 2,
      contribuyente_iva: 'SI',
    },
    'G200000430': {
      nombre: 'SERVICIO NACIONAL INTEGRADO DE ADMINISTRACION ADUANERA Y TRIBUTARIA (SENIAT)',
      es_agente_retencion: true,
      retencion_iva_porcentaje: 100,
      contribuyente_iva: 'NO',
    },
  },

  /* Consulta el RIF en el backend (Edge Function de Supabase) o fallback */
  async consultar(prefijo, numero) {
    const s = this.sanear(prefijo, numero);
    if (!s.prefijo || !s.numero || s.numero.length < 5) {
      throw new Error('Indica un prefijo y número de documento válido (mínimo 5 dígitos).');
    }

    // 1. Revisar si está en el diccionario de conocidos/frecuentes
    if (this.conocidos[s.rif]) {
      const c = this.conocidos[s.rif];
      return {
        encontrado: true,
        rif: s.rif,
        rif_formateado: s.formato,
        nombre: c.nombre,
        es_agente_retencion: c.es_agente_retencion,
        retencion_iva_porcentaje: c.retencion_iva_porcentaje,
        retencion_islr_porcentaje: c.retencion_islr_porcentaje || 0,
        contribuyente_iva: c.contribuyente_iva,
        fuente: 'registro-conocido',
      };
    }

    // 2. Revisar si ya existe en la cartera local de clientes
    try {
      if (window.INV && INV.db && INV.db.clientes) {
        const clientes = await INV.db.clientes.listar();
        const existente = clientes.find(cl => 
          cl.documento === s.numero && (cl.tipo_documento === s.prefijo || !cl.tipo_documento)
        );
        if (existente) {
          return {
            encontrado: true,
            rif: s.rif,
            rif_formateado: s.formato,
            nombre: existente.cliente || `${existente.nombres || ''} ${existente.apellidos || ''}`.trim(),
            es_agente_retencion: !!existente.es_agente_retencion,
            retencion_iva_porcentaje: Number(existente.retencion_iva_porcentaje || (existente.es_agente_retencion ? 75 : 0)),
            retencion_islr_porcentaje: Number(existente.retencion_islr_porcentaje || 0),
            contribuyente_iva: 'SI',
            fuente: 'cartera-local',
          };
        }
      }
    } catch (e) { /* continuar */ }

    const url = INV.config.FUNCION_SENIAT ||
      (INV.config.SUPABASE_URL ? `${INV.config.SUPABASE_URL}/functions/v1/consulta-rif` : null);

    // Si no hay función desplegada o estamos en modo demo
    if (!url || INV.config.MODO === 'demo' || INV.config.esLocal) {
      await new Promise(r => setTimeout(r, 300));
      const esEmpresa = s.prefijo === 'J' || s.prefijo === 'G';
      return {
        encontrado: true,
        rif: s.rif,
        rif_formateado: s.formato,
        nombre: esEmpresa ? `EMPRESA ${s.formato}` : '',
        es_agente_retencion: esEmpresa,
        retencion_iva_porcentaje: esEmpresa ? 75 : 0,
        contribuyente_iva: 'SI',
        fuente: 'asistente-local',
      };
    }

    // 3. Consulta a Edge Function de Supabase con Timeout estricto de 2.5 segundos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    try {
      const resp = await fetch(`${url}?rif=${encodeURIComponent(s.rif)}`, {
        signal: controller.signal,
        headers: {
          'apikey': INV.config.SUPABASE_ANON || '',
          'Content-Type': 'application/json',
        },
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const datos = await resp.json();
        if (datos && datos.encontrado) return datos;
      }
    } catch (e) {
      clearTimeout(timeoutId);
    }

    // 4. Fallback asistido inteligente (no bloqueante)
    const esEmpresa = s.prefijo === 'J' || s.prefijo === 'G';
    return {
      encontrado: false,
      rif: s.rif,
      rif_formateado: s.formato,
      nombre: '',
      es_agente_retencion: esEmpresa,
      retencion_iva_porcentaje: esEmpresa ? 75 : 0,
      contribuyente_iva: 'SI',
      fuente: 'asistido',
    };
  },
};
