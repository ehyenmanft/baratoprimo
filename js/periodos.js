/* =====================================================================
   Periodos
   Agrupa movimientos en cubos temporales. Es la base de los reportes:
   la misma función alimenta la tabla resumen y las gráficas del panel.
   ===================================================================== */
(function () {

  const GRANULARIDADES = [
    { id: 'dia',         etiqueta: 'Diario',      dias: 1 },
    { id: 'interdiario', etiqueta: 'Interdiario', dias: 2 },
    { id: 'semana',      etiqueta: 'Semanal',     dias: 7 },
    { id: 'quincena',    etiqueta: 'Quincenal',   dias: 15 },
    { id: 'mes',         etiqueta: 'Mensual',     dias: null },
  ];

  const RANGOS = [
    { id: '7',   etiqueta: '7 días',  dias: 7 },
    { id: '15',  etiqueta: '15 días', dias: 15 },
    { id: '30',  etiqueta: '30 días', dias: 30 },
    { id: '90',  etiqueta: '90 días', dias: 90 },
    { id: '365', etiqueta: '1 año',   dias: 365 },
  ];

  const aMedianoche = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const sumarDias = (d, n) => new Date(aMedianoche(d).getTime() + n * 86400000);

  const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const dm = d => `${d.getDate()} ${MESES[d.getMonth()]}`;

  /* Devuelve los cubos vacíos que cubren [desde, hasta] con la granularidad dada. */
  function cubos(desde, hasta, granularidad) {
    const g = GRANULARIDADES.find(x => x.id === granularidad) || GRANULARIDADES[0];
    const lista = [];

    if (g.id === 'mes') {
      let cursor = new Date(desde.getFullYear(), desde.getMonth(), 1);
      while (cursor <= hasta) {
        const fin = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
        lista.push({
          inicio: new Date(cursor), fin,
          etiqueta: `${MESES[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}`,
          etiquetaLarga: `${MESES[cursor.getMonth()]} ${cursor.getFullYear()}`,
        });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }
      return lista;
    }

    let cursor = aMedianoche(desde);
    const tope = aMedianoche(hasta);
    while (cursor <= tope) {
      const finBruto = sumarDias(cursor, g.dias - 1);
      const fin = new Date(finBruto.getFullYear(), finBruto.getMonth(), finBruto.getDate(), 23, 59, 59, 999);
      lista.push({
        inicio: new Date(cursor), fin,
        etiqueta: g.dias === 1 ? dm(cursor) : `${dm(cursor)}–${dm(finBruto)}`,
        etiquetaLarga: g.dias === 1
          ? cursor.toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric' })
          : `${dm(cursor)} al ${dm(finBruto)}`,
      });
      cursor = sumarDias(cursor, g.dias);
    }
    return lista;
  }

  /* Reparte los movimientos en los cubos y calcula totales por periodo. */
  function agrupar(movimientos, desde, hasta, granularidad) {
    const lista = cubos(desde, hasta, granularidad).map(c => ({
      ...c, entradas: 0, salidas: 0, ajustes: 0, neto: 0,
      cantidadMovimientos: 0, valorEntradas: 0, productos: new Set(),
    }));

    movimientos.forEach(m => {
      const f = new Date(m.fecha);
      const cubo = lista.find(c => f >= c.inicio && f <= c.fin);
      if (!cubo) return;
      const q = Number(m.cantidad);
      if (m.tipo === 'entrada') { cubo.entradas += q; cubo.valorEntradas += q * Number(m.costo_unitario || 0); }
      else if (m.tipo === 'salida') cubo.salidas += -q;
      else cubo.ajustes += q;
      cubo.neto += q;
      cubo.cantidadMovimientos++;
      cubo.productos.add(m.producto_id);
    });

    return lista.map(c => ({ ...c, productos: c.productos.size }));
  }

  INV.periodos = { GRANULARIDADES, RANGOS, cubos, agrupar, sumarDias, aMedianoche };
})();
