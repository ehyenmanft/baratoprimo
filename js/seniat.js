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
    'V13828612': {
      nombre: 'JAYMI DE LOS ANGELES ARANDA TOMASINI',
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

  /* Normaliza textos para comparación tributaria */
  normalizar(texto) {
    return (texto || '')
      .toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /* Compara nombres entre fuentes y evalúa coincidencia */
  comparar(nombreA, nombreB) {
    const a = this.normalizar(nombreA);
    const b = this.normalizar(nombreB);
    if (!a || !b) return { coinciden: false, ratio: 0 };
    if (a === b) return { coinciden: true, ratio: 1.0 };

    const palA = a.split(' ').filter(p => p.length > 1);
    const palB = b.split(' ').filter(p => p.length > 1);
    if (!palA.length || !palB.length) return { coinciden: false, ratio: 0 };

    const comunes = palA.filter(p => palB.includes(p));
    const minP = Math.min(palA.length, palB.length);
    const ratio = comunes.length / minP;

    return {
      coinciden: ratio >= 0.65,
      ratio: Math.round(ratio * 100) / 100,
    };
  },

  /* Consulta el RIF en todas las fuentes disponibles:
     1. Padrón en Supabase (Base de datos cloud)
     2. Micro-proxy Local en Venezuela (localhost:3030)
     3. Edge Function de Supabase con validación cruzada CNE + SENIAT
     4. Diccionario de conocidos / cartera
  */
  async consultar(prefijo, numero) {
    const s = this.sanear(prefijo, numero);
    if (!s.prefijo || !s.numero || s.numero.length < 5) {
      throw new Error('Indica un prefijo y número de documento válido (mínimo 5 dígitos).');
    }

    // Nivel 1: Consulta en la tabla padron_contribuyentes de Supabase (Ultra rápido: < 15ms)
    try {
      if (window.INV && INV.db && INV.db.padron) {
        const enPadron = await INV.db.padron.buscar(s.rif);
        if (enPadron && enPadron.nombre) {
          return {
            encontrado: true,
            coinciden: true,
            verificado: true,
            rif: enPadron.rif,
            rif_formateado: enPadron.rif_formateado || s.formato,
            nombre: enPadron.nombre,
            es_agente_retencion: !!enPadron.es_agente_retencion,
            retencion_iva_porcentaje: Number(enPadron.retencion_iva_porcentaje || 0),
            retencion_islr_porcentaje: Number(enPadron.retencion_islr_porcentaje || 0),
            contribuyente_iva: enPadron.contribuyente_iva || 'SI',
            direccion: enPadron.direccion || null,
            telefono: enPadron.telefono || null,
            fuente: 'Padrón Oficial Supabase',
          };
        }
      }
    } catch (e) { /* continuar */ }

    // Nivel 2: Diccionario local de conocidos / pruebas rápidas
    if (this.conocidos[s.rif]) {
      const c = this.conocidos[s.rif];
      return {
        encontrado: true,
        coinciden: true,
        verificado: true,
        rif: s.rif,
        rif_formateado: s.formato,
        nombre: c.nombre,
        es_agente_retencion: c.es_agente_retencion,
        retencion_iva_porcentaje: c.retencion_iva_porcentaje,
        retencion_islr_porcentaje: c.retencion_islr_porcentaje || 0,
        contribuyente_iva: c.contribuyente_iva,
        fuente: 'Registro Verificado',
      };
    }

    // Nivel 3: Micro-Proxy Local con IP Venezolana (si está activo en localhost:3030)
    try {
      const ctrlLocal = new AbortController();
      const tLocal = setTimeout(() => ctrlLocal.abort(), 1800);
      const respLocal = await fetch(`http://localhost:3030/consulta?rif=${encodeURIComponent(s.rif)}`, {
        signal: ctrlLocal.signal,
      });
      clearTimeout(tLocal);
      if (respLocal.ok) {
        const datosLocal = await respLocal.json();
        if (datosLocal && datosLocal.encontrado) {
          if (INV.db && INV.db.padron) INV.db.padron.guardar(datosLocal).catch(() => {});
          return { ...datosLocal, coinciden: true };
        }
      }
    } catch (e) { /* continuar */ }

    // Nivel 4: Cartera local de clientes ya registrados
    try {
      if (window.INV && INV.db && INV.db.clientes) {
        const clientes = await INV.db.clientes.listar();
        const existente = clientes.find(cl => 
          cl.documento === s.numero && (cl.tipo_documento === s.prefijo || !cl.tipo_documento)
        );
        if (existente) {
          return {
            encontrado: true,
            coinciden: true,
            rif: s.rif,
            rif_formateado: s.formato,
            nombre: existente.cliente || `${existente.nombres || ''} ${existente.apellidos || ''}`.trim(),
            es_agente_retencion: !!existente.es_agente_retencion,
            retencion_iva_porcentaje: Number(existente.retencion_iva_porcentaje || (existente.es_agente_retencion ? 75 : 0)),
            retencion_islr_porcentaje: Number(existente.retencion_islr_porcentaje || 0),
            contribuyente_iva: 'SI',
            direccion: existente.direccion || null,
            telefono: existente.telefono || null,
            fuente: 'Cartera de Clientes',
          };
        }
      }
    } catch (e) { /* continuar */ }

    // Nivel 5: Cloud Edge Function en Supabase con Validación Cruzada
    const url = INV.config.FUNCION_SENIAT ||
      (INV.config.SUPABASE_URL ? `${INV.config.SUPABASE_URL}/functions/v1/consulta-rif` : null);

    if (url && INV.config.MODO !== 'demo' && !INV.config.esLocal) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      try {
        const resp = await fetch(`${url}?rif=${encodeURIComponent(s.rif)}`, {
          signal: controller.signal,
          headers: {
            'apikey': INV.config.SUPABASE_ANON || '',
            'Content-Type': 'application/json',
          },
        });
        clearTimeout(timeoutId);

        const datos = await resp.json();

        // Si la función detectó discrepancia entre fuentes oficiales (HTTP 409)
        if (resp.status === 409 || (datos && datos.discrepancia)) {
          return {
            encontrado: false,
            coinciden: false,
            discrepancia: true,
            rif: s.rif,
            rif_formateado: s.formato,
            error: datos.error || 'Discrepancia detectada: los datos no coinciden entre CNE y SENIAT.',
            datos_fuente_1: datos.datos_fuente_1,
            datos_fuente_2: datos.datos_fuente_2,
          };
        }

        if (resp.ok && datos && datos.encontrado) {
          if (INV.db && INV.db.padron) INV.db.padron.guardar(datos).catch(() => {});
          return { ...datos, coinciden: true };
        }
      } catch (e) {
        clearTimeout(timeoutId);
      }
    }

    // Nivel 6: Asistente fiscal inteligente
    const esEmpresa = s.prefijo === 'J' || s.prefijo === 'G';
    return {
      encontrado: false,
      coinciden: true,
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
