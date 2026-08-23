/* =====================================================================
   Tasa de cambio
   ---------------------------------------------------------------------
   La tasa del BCV la trae una función del servidor una vez al día y la
   deja en la tabla. Aquí solo se lee, se guarda en el navegador para que
   siga disponible sin conexión, y se decide cuál manda: la oficial o la
   que el comercio haya escrito a mano.

   Regla que gobierna todo lo demás: una tasa vieja se usa, pero se avisa.
   Una tasa inventada, nunca.
   ===================================================================== */
(function () {
  const CLAVE = 'baratoprimo-tasa';

  let oficial = null;   // { moneda, fecha, tasa, fuente, obtenida_en }

  /* ---------------- Guardado local ---------------- */

  function guardar(t) {
    try { localStorage.setItem(CLAVE, JSON.stringify(t)); }
    catch (e) { /* sin almacenamiento: solo memoria */ }
  }

  function recuperar() {
    try {
      const g = localStorage.getItem(CLAVE);
      return g ? JSON.parse(g) : null;
    } catch (e) { return null; }
  }

  /* ---------------- Consulta ---------------- */

  async function cargar() {
    // Lo guardado sirve de inmediato mientras llega lo de la red
    if (!oficial) oficial = recuperar();

    try {
      const t = await INV.db.tasas.vigente('USD');
      if (t && Number(t.tasa) > 0) {
        oficial = t;
        guardar(t);
      }
    } catch (e) {
      // Sin conexión o sin tabla: se sigue con la última conocida
    }
    return oficial;
  }

  /* Días transcurridos desde la fecha de la tasa. La comparación se hace
     con la fecha de Caracas, que es la que usa el BCV. */
  function antiguedad() {
    if (!oficial || !oficial.fecha) return null;
    const hoy = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
    const dias = Math.round(
      (new Date(hoy + 'T00:00:00') - new Date(oficial.fecha + 'T00:00:00')) / 86400000);
    return Math.max(0, dias);
  }

  /* ---------------- Cuál manda ----------------
     El comercio decide si sigue la oficial. Si la sigue pero todavía no
     hay ninguna, cae en la manual, que es mejor que quedarse en cero. */
  function actual() {
    const c = INV.comercio ? INV.comercio.actual() : {};
    const manual = Number(c.tasa_usd || 0);
    const automatica = c.tasa_automatica !== false;

    if (automatica && oficial && Number(oficial.tasa) > 0) {
      return {
        tasa: Number(oficial.tasa),
        origen: 'oficial',
        fecha: oficial.fecha,
        fuente: oficial.fuente,
        dias: antiguedad(),
      };
    }
    return { tasa: manual, origen: manual > 0 ? 'manual' : 'sin_tasa', fecha: null, dias: null };
  }

  const usd = () => actual().tasa;

  /* ---------------- Conversión y presentación ---------------- */

  const aBolivares = montoUsd => {
    const t = usd();
    return t > 0 ? Math.round(Number(montoUsd) * t * 100) / 100 : null;
  };

  const aDolares = montoBs => {
    const t = usd();
    return t > 0 ? Math.round((Number(montoBs) / t) * 100) / 100 : null;
  };

  /* Un precio con su equivalente. Se pasa el monto en la moneda en la que
     está guardado el catálogo y devuelve las dos caras. */
  function dual(monto, opciones = {}) {
    const c = INV.comercio ? INV.comercio.actual() : {};
    const enUsd = (opciones.moneda || c.moneda_precios || 'VES') === 'USD';
    const simbolo = c.moneda || 'Bs';
    const n = INV.ui.numero;

    if (enUsd) {
      const bs = aBolivares(monto);
      return {
        principal: n(monto) + ' $',
        equivalente: bs === null ? null : n(bs) + ' ' + simbolo,
        bolivares: bs, dolares: Number(monto),
      };
    }
    const dol = aDolares(monto);
    return {
      principal: n(monto) + ' ' + simbolo,
      equivalente: dol === null ? null : n(dol) + ' $',
      bolivares: Number(monto), dolares: dol,
    };
  }

  /* Para pintar: "1.234,00 Bs · 30,85 $" */
  function texto(monto, opciones) {
    const d = dual(monto, opciones);
    return d.equivalente ? `${d.principal} · ${d.equivalente}` : d.principal;
  }

  /* En HTML, con el equivalente atenuado */
  function html(monto, opciones) {
    const d = dual(monto, opciones);
    return d.equivalente
      ? `${INV.ui.esc(d.principal)}<span class="equivalente">${INV.ui.esc(d.equivalente)}</span>`
      : INV.ui.esc(d.principal);
  }

  /* Símbolo de la moneda en la que está escrito el catálogo. */
  function simbolo() {
    const c = INV.comercio ? INV.comercio.actual() : {};
    return (c.moneda_precios || 'VES') === 'USD' ? '$' : (c.moneda || 'Bs');
  }

  const catalogoEnDolares = () => {
    const c = INV.comercio ? INV.comercio.actual() : {};
    return (c.moneda_precios || 'VES') === 'USD';
  };

  /* Convierte un precio del catálogo a bolívares, que es la moneda en la
     que se emiten las facturas. Si el catálogo ya está en bolívares, se
     devuelve tal cual. */
  function aFactura(precioCatalogo) {
    if (!catalogoEnDolares()) return Number(precioCatalogo);
    const bs = aBolivares(precioCatalogo);
    return bs === null ? null : bs;
  }

  INV.tasas = {
    cargar, actual, usd, aBolivares, aDolares, dual, texto, html, antiguedad,
    simbolo, catalogoEnDolares, aFactura,
    oficial: () => oficial,
  };
})();
