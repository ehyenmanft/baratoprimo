/* =====================================================================
   Cuadre de caja
   ---------------------------------------------------------------------
   Lo que se necesita al cerrar el turno: cuánto entró, por qué vía, quién
   lo cobró y a quién. Con periodos de un día, una semana, una quincena o
   un mes, y salida a CSV o a impresión.

   Quien factura cuadra lo suyo. Quien administra ve el de todo su
   comercio y puede filtrar por operador: es la diferencia entre revisar
   tu caja y auditar la de otro, y por eso son dos permisos distintos.
   ===================================================================== */
(function () {
  const { $, $$, esc, numero, cantidad, fecha, avisar, cargando, vacio } = INV.ui;

  /* Periodos que tienen sentido para cuadrar: los que usa un comercio
     para cerrar turno, semana o quincena. */
  const PERIODOS = [
    { id: 'hoy',      etiqueta: 'Hoy',        dias: 0 },
    { id: 'ayer',     etiqueta: 'Ayer',       dias: 1, soloEseDia: true },
    { id: 'semana',   etiqueta: 'Semana',     dias: 6 },
    { id: 'quincena', etiqueta: 'Quincena',   dias: 14 },
    { id: 'mes',      etiqueta: 'Mes',        dias: 29 },
  ];

  const METODOS = {
    debito: 'Débito', efectivo_bs: 'Efectivo Bs', efectivo_usd: 'Efectivo USD',
    efectivo_eur: 'Efectivo EUR', pago_movil: 'Pago móvil',
    transferencia: 'Transferencia', otro: 'Otro', credito: 'Crédito',
  };

  const estado = { periodo: 'hoy', desde: null, hasta: null, vendedor: '' };

  const aMedianoche = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const finDelDia   = d => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

  /* Rango que cubre el periodo elegido, o el escrito a mano. */
  function rango() {
    if (estado.periodo === 'personalizado' && estado.desde && estado.hasta) {
      return { desde: aMedianoche(new Date(estado.desde + 'T00:00:00')),
               hasta: finDelDia(new Date(estado.hasta + 'T00:00:00')) };
    }
    const p = PERIODOS.find(x => x.id === estado.periodo) || PERIODOS[0];
    const hasta = p.soloEseDia
      ? finDelDia(new Date(Date.now() - 86400000))
      : finDelDia(new Date());
    const desde = aMedianoche(new Date(hasta.getTime() - p.dias * 86400000));
    return { desde, hasta };
  }

  const etiquetaRango = ({ desde, hasta }) => {
    const f = d => d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
    return f(desde) === f(hasta) ? f(desde) : `${f(desde)} — ${f(hasta)}`;
  };

  /* ---------------- Datos ---------------- */

  async function reunir() {
    const { desde, hasta } = rango();

    const [ventas, operadores] = await Promise.all([
      INV.db.ventas.listar({ limite: 2000 }),
      INV.db.operadores.listar().catch(() => []),
    ]);

    const propio = !INV.permisos.puede('caja.ver_todos');
    const yo = (($('#usuario-correo') || {}).textContent || '').trim().toLowerCase();

    let filas = ventas.filter(v => {
      const f = new Date(v.fecha);
      if (f < desde || f > hasta) return false;
      // Quien no audita solo ve lo suyo, aunque escriba la ruta a mano
      if (propio) return (v.vendedor_correo || '').toLowerCase() === yo;
      if (estado.vendedor) return (v.vendedor_correo || '').toLowerCase() === estado.vendedor;
      return true;
    });

    // Los pagos de cada venta, para desglosar por forma de cobro
    const conPagos = await Promise.all(filas.map(async v => {
      if (v.pagos) return v;
      try {
        const completa = await INV.db.ventas.obtener(v.id);
        return { ...v, pagos: completa ? completa.pagos : [] };
      } catch (e) { return { ...v, pagos: [] }; }
    }));

    return { filas: conPagos, operadores, desde, hasta, propio };
  }

  /* Sumas del periodo. Las anuladas se cuentan aparte: no entran en el
     dinero, pero tienen que verse, porque un turno con muchas anulaciones
     es justo lo que hay que poder mirar. */
  function resumir(filas) {
    const vigentes = filas.filter(v => !v.anulada);
    const anuladas = filas.filter(v => v.anulada);

    const porMetodo = {};
    vigentes.forEach(v => (v.pagos || []).forEach(p => {
      const k = p.metodo;
      porMetodo[k] = porMetodo[k] || { metodo: k, monto: 0, operaciones: 0, divisa: 0, moneda: p.moneda };
      porMetodo[k].monto += Number(p.monto_local);
      porMetodo[k].operaciones++;
      if (p.moneda !== 'VES') porMetodo[k].divisa += Number(p.monto);
    }));

    const porVendedor = {};
    vigentes.forEach(v => {
      const k = v.vendedor_correo || 'sin registrar';
      porVendedor[k] = porVendedor[k] || {
        correo: k, nombre: v.vendedor || null, ventas: 0, total: 0, credito: 0,
      };
      porVendedor[k].ventas++;
      porVendedor[k].total += Number(v.total);
      if (v.a_credito) porVendedor[k].credito++;
    });

    const cobrado = vigentes.reduce((s, v) =>
      s + (v.pagos || []).filter(p => p.metodo !== 'credito')
        .reduce((x, p) => x + Number(p.monto_local), 0), 0);

    return {
      ventas: vigentes.length,
      anuladas: anuladas.length,
      montoAnulado: anuladas.reduce((s, v) => s + Number(v.total), 0),
      facturado: vigentes.reduce((s, v) => s + Number(v.total), 0),
      base: vigentes.reduce((s, v) => s + Number(v.subtotal), 0),
      iva: vigentes.reduce((s, v) => s + Number(v.iva_monto), 0),
      cobrado,
      aCredito: vigentes.filter(v => v.a_credito).length,
      porMetodo: Object.values(porMetodo).sort((a, b) => b.monto - a.monto),
      porVendedor: Object.values(porVendedor).sort((a, b) => b.total - a.total),
    };
  }

  /* ---------------- Exportación ---------------- */

  /* Las columnas del cuadre. Se usa el mismo generador de CSV que el
     resto de la aplicación: dos escritores distintos acaban produciendo
     dos formatos distintos, y el que se rompe siempre es el que nadie
     mira. */
  const COLUMNAS = [
    { titulo: 'Comprobante', valor: v => v.numero },
    { titulo: 'Fecha',  valor: v => new Date(v.fecha).toLocaleDateString('es') },
    { titulo: 'Hora',   valor: v => new Date(v.fecha)
        .toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) },
    { titulo: 'Estado', valor: v => v.anulada ? 'ANULADA' : 'Vigente' },
    { titulo: 'Cliente',   valor: v => v.cliente || 'Consumidor final' },
    { titulo: 'Documento', valor: v => v.documento_completo || '' },
    { titulo: 'Vendedor',  valor: v => v.vendedor || v.vendedor_correo || '' },
    { titulo: 'Formas de pago', valor: v => (v.pagos || [])
        .map(p => METODOS[p.metodo] || p.metodo).join(' + ') },
    { titulo: 'Referencias', valor: v => (v.pagos || [])
        .filter(p => p.referencia).map(p => p.referencia).join(' ') },
    { titulo: 'Base',  valor: v => Number(v.subtotal).toFixed(2) },
    { titulo: 'IVA',   valor: v => Number(v.iva_monto).toFixed(2) },
    { titulo: 'Total', valor: v => Number(v.total).toFixed(2) },
    { titulo: 'Tasa Bs/USD', valor: v => Number(v.tasa_referencia || 0).toFixed(4) },
    { titulo: 'Total USD',   valor: v => Number(v.total_usd || 0).toFixed(2) },
    { titulo: 'A crédito',   valor: v => v.a_credito ? 'Sí' : 'No' },
  ];

  const nombreArchivo = (r, ext) => {
    const f = d => d.toISOString().slice(0, 10);
    return `cuadre-${f(r.desde)}${f(r.desde) === f(r.hasta) ? '' : '-a-' + f(r.hasta)}.${ext}`;
  };

  /* ---------------- Pantalla ---------------- */

  INV.vistas.caja = {
    titulo: 'Cuadre de caja',
    eyebrow: 'Cierre de turno',

    acciones: () => [
      { texto: 'Exportar CSV', estilo: 'btn--primario', permiso: 'caja.ver',
        alPulsar: () => exportarCSV() },
    ],

    render: async contenedor => {
      contenedor.innerHTML = cargando();

      const datos = await reunir();
      const r = resumir(datos.filas);
      const rg = { desde: datos.desde, hasta: datos.hasta };
      ultimo = { datos, r, rg };

      const simbolo = (INV.comercio.actual().moneda) || 'Bs';
      const enUsd = m => {
        const d = INV.tasas ? INV.tasas.aDolares(m) : null;
        return d === null ? '' : `<span class="equivalente">${numero(d)} $</span>`;
      };

      contenedor.innerHTML = `
        <div class="ficha anim no-imprimir" style="margin-bottom:14px">
          <div class="ficha__cuerpo" style="padding-top:16px">
            <div class="filtros">
              <div class="segmentado" id="cj-periodo">
                ${PERIODOS.map(p => `
                  <button class="${estado.periodo === p.id ? 'activo' : ''}"
                          data-periodo="${p.id}">${p.etiqueta}</button>`).join('')}
                <button class="${estado.periodo === 'personalizado' ? 'activo' : ''}"
                        data-periodo="personalizado">Otro</button>
              </div>

              <label class="filtro" id="cj-caja-fechas" ${estado.periodo === 'personalizado' ? '' : 'hidden'}>
                <span>Desde</span>
                <input type="date" id="cj-desde" value="${estado.desde || ''}"></label>
              <label class="filtro" ${estado.periodo === 'personalizado' ? '' : 'hidden'}>
                <span>Hasta</span>
                <input type="date" id="cj-hasta" value="${estado.hasta || ''}"></label>

              ${!datos.propio ? `
                <label class="filtro"><span>Operador</span>
                  <select id="cj-vendedor">
                    <option value="">Todos</option>
                    ${datos.operadores.map(o => `
                      <option value="${esc(o.correo.toLowerCase())}"
                        ${estado.vendedor === o.correo.toLowerCase() ? 'selected' : ''}>
                        ${esc(o.nombre)}</option>`).join('')}
                  </select></label>` : ''}
            </div>
            ${datos.propio ? `
              <p class="subida__nota" style="margin-top:10px">
                Estás viendo solo tus ventas. El cuadre de todo el comercio lo ve un administrador.
              </p>` : ''}
          </div>
        </div>

        <div class="reporte">
          <div class="reporte__encabezado">
            <h2>${etiquetaRango(rg)}</h2>
            <p>${datos.propio || estado.vendedor
                  ? 'Operador: ' + esc(nombreVendedor(datos, estado.vendedor))
                  : 'Todos los operadores'}</p>
          </div>

          <div class="mosaico mosaico--auto" style="margin-bottom:14px">
            <div class="metrica metrica--violeta anim" style="--i:0">
              <div class="metrica__etiqueta">Facturado</div>
              <div class="metrica__valor">${numero(r.facturado)}</div>
              <div class="metrica__pie">${r.ventas} venta${r.ventas === 1 ? '' : 's'} · ${simbolo}</div>
            </div>
            <div class="metrica metrica--teal anim" style="--i:1">
              <div class="metrica__etiqueta">Cobrado</div>
              <div class="metrica__valor">${numero(r.cobrado)}</div>
              <div class="metrica__pie">sin contar el crédito</div>
            </div>
            <div class="metrica metrica--naranja anim" style="--i:2">
              <div class="metrica__etiqueta">IVA del periodo</div>
              <div class="metrica__valor">${numero(r.iva)}</div>
              <div class="metrica__pie">base ${numero(r.base)}</div>
            </div>
            <div class="metrica ${r.anuladas ? 'metrica--rosa' : ''} anim" style="--i:3">
              <div class="metrica__etiqueta">Anuladas</div>
              <div class="metrica__valor">${r.anuladas}</div>
              <div class="metrica__pie">${r.anuladas ? numero(r.montoAnulado) + ' no cobrados' : 'ninguna'}</div>
            </div>
          </div>

          <div class="ficha anim" style="--i:4; margin-bottom:14px">
            <div class="ficha__cabecera">
              <div>
                <h3 class="ficha__titulo">Por forma de pago</h3>
                <p class="ficha__nota">así se cuadra el efectivo contra lo que dice el sistema</p>
              </div>
            </div>
            ${r.porMetodo.length ? `
              <div class="lista">
                ${r.porMetodo.map((m, i) => `
                  <div class="lista__item" style="--i:${i}; grid-template-columns:minmax(0,1fr) auto auto">
                    <span class="lista__nombre">${esc(METODOS[m.metodo] || m.metodo)}
                      <span class="lista__sub">${m.operaciones} operación${m.operaciones === 1 ? '' : 'es'}${
                        m.divisa ? ` · ${numero(m.divisa)} en divisa` : ''}</span></span>
                    <span class="lista__dato"><b>${numero(m.monto)}</b><small>${simbolo}</small></span>
                    <span class="lista__dato">${enUsd(m.monto) || '<small>—</small>'}</span>
                  </div>`).join('')}
              </div>` : '<div class="ficha__cuerpo"><p class="ficha__nota">Sin cobros en el periodo.</p></div>'}
          </div>

          ${!datos.propio && r.porVendedor.length > 1 ? `
            <div class="ficha anim" style="--i:5; margin-bottom:14px">
              <div class="ficha__cabecera">
                <h3 class="ficha__titulo">Por operador</h3>
              </div>
              <div class="lista">
                ${r.porVendedor.map((o, i) => `
                  <div class="lista__item" style="--i:${i}; grid-template-columns:minmax(0,1fr) auto auto">
                    <span class="lista__nombre">${esc(o.nombre || o.correo)}
                      <span class="lista__sub">${esc(o.correo)}${
                        o.credito ? ` · ${o.credito} a crédito` : ''}</span></span>
                    <span class="lista__dato"><b>${o.ventas}</b><small>ventas</small></span>
                    <span class="lista__dato"><b>${numero(o.total)}</b><small>${simbolo}</small></span>
                  </div>`).join('')}
              </div>
            </div>` : ''}

          <div class="ficha anim" style="--i:6">
            <div class="ficha__cabecera">
              <div>
                <h3 class="ficha__titulo">Comprobantes del periodo</h3>
                <p class="ficha__nota">${datos.filas.length} en total</p>
              </div>
            </div>
            ${datos.filas.length ? `
              <div class="tabla-envoltura">
                <table class="tabla">
                  <thead><tr>
                    <th>Comprobante</th><th>Hora</th><th>Cliente</th><th>Vendedor</th>
                    <th>Forma de pago</th><th class="num">IVA</th><th class="num">Total</th>
                  </tr></thead>
                  <tbody>
                    ${datos.filas.map(v => `
                      <tr class="${v.anulada ? 'apagado' : ''}" data-ver="${v.id}">
                        <td>${esc(v.numero)}${v.anulada ? ' · ANULADA' : ''}${
                          v.a_credito ? ' · crédito' : ''}</td>
                        <td>${new Date(v.fecha).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td>${esc(v.cliente || 'Consumidor final')}</td>
                        <td>${esc(v.vendedor || v.vendedor_correo || '—')}</td>
                        <td>${esc((v.pagos || []).map(p => METODOS[p.metodo] || p.metodo).join(' + ') || '—')}</td>
                        <td class="num">${numero(v.iva_monto)}</td>
                        <td class="num">${numero(v.total)}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>`
            : vacio('Sin ventas en el periodo',
                    'Cambia el rango de fechas o el operador para ver otros movimientos.')}
          </div>
        </div>`;

      $$('#cj-periodo button').forEach(b => b.addEventListener('click', () => {
        estado.periodo = b.dataset.periodo;
        window.dispatchEvent(new Event('recargar-vista'));
      }));

      ['cj-desde', 'cj-hasta'].forEach(id => {
        const el = $('#' + id);
        if (el) el.addEventListener('change', () => {
          estado.desde = $('#cj-desde').value;
          estado.hasta = $('#cj-hasta').value;
          if (estado.desde && estado.hasta) window.dispatchEvent(new Event('recargar-vista'));
        });
      });

      const sel = $('#cj-vendedor');
      if (sel) sel.addEventListener('change', () => {
        estado.vendedor = sel.value;
        window.dispatchEvent(new Event('recargar-vista'));
      });

      $$('[data-ver]').forEach(tr => tr.addEventListener('click', () => {
        location.hash = '#/venta/' + tr.dataset.ver;
      }));
    },
  };

  /* Lo último que se pintó, para poder exportarlo sin recalcular. */
  let ultimo = null;

  const nombreVendedor = (datos, correo) => {
    if (!correo) {
      const yo = (($('#usuario-correo') || {}).textContent || '').trim();
      const mio = datos.operadores.find(o => o.correo.toLowerCase() === yo.toLowerCase());
      return mio ? mio.nombre : yo;
    }
    const o = datos.operadores.find(x => x.correo.toLowerCase() === correo);
    return o ? o.nombre : correo;
  };

  function exportarCSV() {
    if (!ultimo || !ultimo.datos.filas.length) return avisar('No hay ventas que exportar', 'error');
    INV.ui.descargarCSV(nombreArchivo(ultimo.rg, 'csv'), COLUMNAS, ultimo.datos.filas);
    avisar(`${ultimo.datos.filas.length} comprobantes exportados`);
  }

  INV.vistas.caja.exportarCSV = exportarCSV;
  INV.vistas.caja.COLUMNAS = COLUMNAS;
  INV.vistas.caja.resumir = resumir;
  INV.vistas.caja.PERIODOS = PERIODOS;
  INV.vistas.caja.estado = estado;
  INV.vistas.caja.rango = rango;
})();
