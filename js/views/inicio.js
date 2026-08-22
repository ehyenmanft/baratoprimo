/* =====================================================================
   Inicio — el puesto de trabajo.
   Lo que se hace todos los días: mirar existencias, cargar productos y
   registrar movimientos. Una sola gráfica, la esencial; el resto del
   análisis vive en la pantalla de Gráficas.
   ===================================================================== */
(function () {
  const { $, $$, esc, numero, cantidad, fecha, medidor, cargando, vacio, miniatura,
          avisar, abrirModal, cerrarModal } = INV.ui;
  const G = INV.graficas;
  const P = INV.periodos;

  const RANGO = 30;

  const irA = id => { location.hash = '#/producto/' + id; };

  const fichaProducto = (f, i) => `
    <div class="lista__item" style="--i:${Math.min(i, 20)}" data-abrir="${f.producto_id}" role="button" tabindex="0">
      ${miniatura(f.imagen_path, f.nombre)}
      <span class="lista__nombre">${esc(f.nombre)}
        <span class="lista__sub">${esc(f.sku)} · ${esc(f.categoria ?? 'sin categoría')}</span></span>
      ${medidor(f.stock, f.stock_minimo, Math.min(i, 20))}
      <span class="lista__dato"><b class="${Number(f.stock) <= 0 ? 'neg' : ''}">${cantidad(f.stock)}</b><small>${esc(f.unidad)}</small></span>
    </div>`;

  INV.vistas = INV.vistas || {};
  INV.vistas.inicio = {
    titulo: 'Inicio',
    eyebrow: 'Puesto de trabajo',

    acciones: () => [
      { texto: 'Cargar producto', estilo: 'btn--primario',
        alPulsar: () => INV.vistas.productos.abrirFormulario() },
      { texto: 'Entrada', estilo: 'btn--secundario',
        alPulsar: () => INV.vistas.movimientos.abrirFormulario('entrada') },
      { texto: 'Salida', estilo: 'btn--secundario',
        alPulsar: () => INV.vistas.movimientos.abrirFormulario('salida') },
    ],

    render: async contenedor => {
      contenedor.innerHTML = cargando();

      const hasta = new Date();
      const desde = P.sumarDias(hasta, -(RANGO - 1));

      const [existencias, movs, alertas, cuotas] = await Promise.all([
        INV.db.stock.actual(),
        INV.db.movimientos.listar({ desde: desde.toISOString(), limite: 3000 }),
        INV.db.stock.alertas(),
        INV.db.cuotas.pendientes().catch(() => []),
      ]);

      if (!existencias.length) {
        contenedor.innerHTML = vacio(
          'El almacén está vacío',
          'Carga tu primer producto y registra una entrada para empezar.',
          '<button class="btn btn--primario" id="ini-primero">Cargar producto</button>'
        );
        $('#ini-primero').addEventListener('click', () => INV.vistas.productos.abrirFormulario());
        return;
      }

      const cubos = P.agrupar(movs, desde, hasta, 'interdiario');
      const entradas = movs.filter(m => m.cantidad > 0).reduce((s, m) => s + Number(m.cantidad), 0);
      const salidas  = movs.filter(m => m.cantidad < 0).reduce((s, m) => s - Number(m.cantidad), 0);
      const valor    = existencias.reduce((s, f) => s + Number(f.valor_inventario), 0);

      // Los que exigen atención primero; el resto por nombre.
      const ordenados = [...existencias].sort((a, b) => {
        const p = f => Number(f.stock) <= 0 ? 0 : Number(f.stock) <= Number(f.stock_minimo) ? 1 : 2;
        return p(a) - p(b) || a.nombre.localeCompare(b.nombre);
      });

      const ultimos = await INV.db.movimientos.listar({ limite: 8 });

      contenedor.innerHTML = `
        <div class="mosaico mosaico--auto" style="margin-bottom:14px">
          <div class="metrica metrica--violeta anim" style="--i:0">
            <div class="metrica__etiqueta">Inventario</div>
            <div class="metrica__valor">${numero(valor)}</div>
            <div class="metrica__pie">${existencias.length} productos</div>
          </div>
          <div class="metrica metrica--teal anim" style="--i:1">
            <div class="metrica__etiqueta">Recibido 30 d</div>
            <div class="metrica__valor">${cantidad(entradas)}</div>
            <div class="metrica__pie">unidades</div>
          </div>
          <div class="metrica metrica--frambuesa anim" style="--i:2">
            <div class="metrica__etiqueta">Despachado 30 d</div>
            <div class="metrica__valor">${cantidad(salidas)}</div>
            <div class="metrica__pie">unidades</div>
          </div>
          <div class="metrica metrica--cian anim" style="--i:3">
            <div class="metrica__etiqueta">Por cobrar</div>
            <div class="metrica__valor">${numero(cuotas.reduce((s, q) => s + Number(q.monto_usd), 0))}<span style="font-size:14px"> USD</span></div>
            <div class="metrica__pie">${cuotas.length} cuotas · ${new Set(cuotas.map(q => q.cliente_id)).size} clientes</div>
          </div>
          <div class="metrica metrica--ambar anim" style="--i:4">
            <div class="metrica__etiqueta">Por reponer</div>
            <div class="metrica__valor">${alertas.length}</div>
            <div class="metrica__pie">${alertas.filter(a => Number(a.stock) <= 0).length} sin existencias</div>
          </div>
        </div>

        <div class="ficha anim" style="--i:4; margin-bottom:14px">
          <div class="ficha__cabecera">
            <div>
              <h3 class="ficha__titulo">Flujo de los últimos 30 días</h3>
              <p class="ficha__nota">entradas arriba · salidas abajo</p>
            </div>
            <a class="btn btn--primario btn--chico" href="#/graficas">Ver todas las gráficas</a>
          </div>
          <div class="ficha__cuerpo">
            ${G.flujo(cubos, { alto: 170 })}
            <div class="leyenda-grafica" style="margin-top:12px">
              <span><i style="background:var(--esmeralda)"></i> Entradas</span>
              <span><i style="background:var(--rosa)"></i> Salidas</span>
            </div>
          </div>
        </div>

        ${cuotas.length ? `
        <div class="ficha anim" style="--i:5; margin-bottom:14px">
          <div class="ficha__cabecera">
            <div>
              <h3 class="ficha__titulo">Clientes con cuotas por cobrar</h3>
              <p class="ficha__nota">${vencidas(cuotas).length} vencidas · mínimo por cuota, referencia en dólares</p>
            </div>
          </div>
          <div class="lista lista--cuo">
            ${cuotas.slice(0, 8).map((q, i) => {
              const atraso = Number(q.dias_vencida);
              return `
              <div class="lista__item" style="--i:${i}">
                <span class="lista__nombre">${esc(q.cliente || 'Consumidor final')}
                  <span class="lista__sub">${esc(q.documento || 's/d')}${q.telefono ? ' · ' + esc(q.telefono) : ''}
                    · ${esc(q.comprobante)} · cuota ${q.numero} de ${q.cuotas_totales}</span></span>
                <span class="lista__dato">
                  <b class="${atraso > 0 ? 'neg' : ''}">${new Date(q.vence_en + 'T00:00:00').toLocaleDateString('es')}</b>
                  <small>${atraso > 0 ? atraso + ' días de atraso' : atraso === 0 ? 'vence hoy' : 'en ' + (-atraso) + ' días'}</small></span>
                <span class="lista__dato"><b>${numero(q.monto_usd)}</b><small>USD mínimo</small></span>
                <button class="btn btn--secundario btn--chico" data-cobrar="${q.id}">Cobrar</button>
              </div>`;
            }).join('')}
          </div>
          ${cuotas.length > 8 ? `<div class="ficha__pie" style="text-align:center; font-size:13px; color:var(--tinta-3)">
            y ${cuotas.length - 8} cuotas más</div>` : ''}
        </div>` : ''}

        <div class="mosaico mosaico--2">
          <div class="ficha anim" style="--i:6">
            <div class="ficha__cabecera">
              <div>
                <h3 class="ficha__titulo">Existencias</h3>
                <p class="ficha__nota">pulsa un producto para ver su ficha</p>
              </div>
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
                <input class="buscador" type="search" id="ini-buscar" placeholder="Buscar">
                <button class="btn btn--secundario btn--chico" id="ini-cargar">Cargar</button>
              </div>
            </div>
            <div class="lista lista--stock" id="ini-lista">${ordenados.slice(0, 8).map(fichaProducto).join('')}</div>
            <div class="ficha__pie" style="text-align:center">
              <a class="btn btn--secundario btn--chico" href="#/productos">Ver los ${existencias.length} productos</a>
            </div>
          </div>

          <div class="ficha anim" style="--i:7">
            <div class="ficha__cabecera">
              <div>
                <h3 class="ficha__titulo">Últimos movimientos</h3>
                <p class="ficha__nota">registro más reciente</p>
              </div>
              <button class="btn btn--secundario btn--chico" id="ini-mov">Registrar</button>
            </div>
            ${ultimos.length ? `
              <div class="lista lista--mov">
                ${ultimos.map((m, i) => `
                  <div class="lista__item" style="--i:${i}" data-abrir="${m.producto_id}" role="button" tabindex="0">
                    <span class="pastilla pastilla--${esc(m.tipo)}">${esc(m.tipo)}</span>
                    <span class="lista__nombre">${esc(m.nombre)}
                      <span class="lista__sub">${fecha(m.fecha)} · ${esc(m.motivo ?? 'sin motivo')}</span></span>
                    <span class="lista__dato"><b class="${m.cantidad < 0 ? 'neg' : 'pos'}">${m.cantidad > 0 ? '+' : ''}${cantidad(m.cantidad)}</b><small>cantidad</small></span>
                    <span class="lista__dato"><b>${cantidad(m.saldo)}</b><small>saldo</small></span>
                  </div>`).join('')}
              </div>
              <div class="ficha__pie" style="text-align:center">
                <a class="btn btn--secundario btn--chico" href="#/movimientos">Ver todos los movimientos</a>
              </div>`
            : '<div class="vacio"><h4>Sin movimientos</h4><p>Registra una entrada para empezar.</p></div>'}
          </div>
        </div>`;

      $('#ini-cargar').addEventListener('click', () => INV.vistas.productos.abrirFormulario());
      $('#ini-mov').addEventListener('click', () => INV.vistas.movimientos.abrirFormulario('salida'));

      $('#ini-buscar').addEventListener('input', e => {
        const t = e.target.value.toLowerCase();
        const filtrados = ordenados.filter(f =>
          f.nombre.toLowerCase().includes(t) || f.sku.toLowerCase().includes(t));
        $('#ini-lista').innerHTML = filtrados.length
          ? filtrados.slice(0, 8).map(fichaProducto).join('')
          : '<div class="vacio"><h4>Sin resultados</h4><p>Ningún producto coincide.</p></div>';
        enlazar();
      });

      $$('[data-cobrar]').forEach(b => b.addEventListener('click', ev => {
        ev.stopPropagation();
        cobrar(cuotas.find(q => String(q.id) === b.dataset.cobrar));
      }));

      enlazar();
    },
  };

  const vencidas = cuotas => cuotas.filter(q => Number(q.dias_vencida) > 0);

  /* Registrar el abono de una cuota. El monto se pide en moneda local: la
     deuda está en dólares, pero se cobra a la tasa del día. */
  function cobrar(q) {
    if (!q) return;
    const tasaHoy = INV.comercio ? Number(INV.comercio.actual().tasa_usd || 0) : 0;
    const sugerido = tasaHoy ? (Number(q.monto_usd) * tasaHoy).toFixed(2) : '';

    abrirModal({
      titulo: 'Cobrar cuota ' + q.numero,
      cuerpo: `
        <div class="datos" style="border-radius:var(--r-s); overflow:hidden; margin-bottom:16px">
          <div class="datos__celda" style="grid-column:1 / -1">
            <div class="datos__etiqueta">Cliente</div>
            <div class="datos__valor" style="font-size:15px">${esc(q.cliente || 'Consumidor final')}</div>
            <div class="lista__sub">${esc(q.documento || 's/d')}${q.telefono ? ' · ' + esc(q.telefono) : ''}</div>
          </div>
          <div class="datos__celda">
            <div class="datos__etiqueta">Comprobante</div>
            <div class="datos__valor">${esc(q.comprobante)}</div>
          </div>
          <div class="datos__celda">
            <div class="datos__etiqueta">Cuota</div>
            <div class="datos__valor">${q.numero} de ${q.cuotas_totales}</div>
          </div>
          <div class="datos__celda">
            <div class="datos__etiqueta">Mínimo a abonar</div>
            <div class="datos__valor">${numero(q.monto_usd)} <small>USD</small></div>
          </div>
          <div class="datos__celda">
            <div class="datos__etiqueta">Vence</div>
            <div class="datos__valor" style="font-size:14px">${new Date(q.vence_en + 'T00:00:00').toLocaleDateString('es')}</div>
          </div>
        </div>

        <div class="campos-fila">
          <div class="campo">
            <label for="cb-tasa">Tasa de hoy</label>
            <input id="cb-tasa" type="number" min="0" step="0.0001" value="${tasaHoy || ''}" placeholder="Bs por USD">
          </div>
          <div class="campo">
            <label for="cb-monto">Monto cobrado</label>
            <input id="cb-monto" type="number" min="0.01" step="0.01" value="${sugerido}" placeholder="0,00">
          </div>
        </div>
        <p id="cb-efecto" class="subida__nota" style="margin:-6px 0 14px"></p>
        <div class="campo">
          <label for="cb-metodo">Forma de cobro</label>
          <select id="cb-metodo">
            <option value="efectivo_bs">Efectivo Bs</option>
            <option value="efectivo_usd">Efectivo USD</option>
            <option value="pago_movil">Pago móvil</option>
            <option value="transferencia">Transferencia</option>
            <option value="debito">Débito</option>
          </select>
        </div>
        <div class="campo" style="margin:0">
          <label for="cb-referencia">Referencia — últimos 6 (opcional)</label>
          <input id="cb-referencia" type="text" inputmode="numeric" maxlength="6" placeholder="000000">
        </div>
        <p id="cb-error" class="error" hidden></p>`,
      acciones: [
        { texto: 'Cancelar', alPulsar: cerrarModal },
        { texto: 'Registrar cobro', estilo: 'btn--primario', alPulsar: btn => registrarCobro(q, btn) },
      ],
    });

    $('#cb-tasa').addEventListener('input', () => {
      const t = Number($('#cb-tasa').value);
      if (t > 0) $('#cb-monto').value = (Number(q.monto_usd) * t).toFixed(2);
      efectoDelAbono(q);
    });
    $('#cb-monto').addEventListener('input', () => efectoDelAbono(q));
    efectoDelAbono(q);
  }

  /* Explica en vivo qué pasa con lo que se abona: si cubre el mínimo, si
     falta, o cuántas cuotas siguientes adelanta el excedente. */
  async function efectoDelAbono(q) {
    const caja = $('#cb-efecto');
    if (!caja) return;
    const t = Number($('#cb-tasa').value || 0);
    const monto = Number($('#cb-monto').value || 0);
    if (!t || !monto) { caja.textContent = ''; return; }

    const abonoUsd = monto / t;
    const minimo = Number(q.monto_usd);

    if (abonoUsd + 0.005 < minimo) {
      caja.innerHTML = `<span style="color:var(--rosa)">Faltan
        ${numero(minimo - abonoUsd)} USD para llegar al mínimo de esta cuota.</span>`;
      return;
    }

    let sobra = abonoUsd - minimo;
    if (sobra <= 0.005) {
      caja.innerHTML = `<span style="color:var(--esmeralda)">Cubre el mínimo
        (${numero(minimo)} USD). Quedarán ${q.cuotas_pendientes - 1} cuotas.</span>`;
      return;
    }

    const todas = await INV.db.cuotas.pendientes();
    const siguientes = todas
      .filter(x => x.venta_id === q.venta_id && x.numero > q.numero)
      .sort((a, b) => a.numero - b.numero);

    let adelantadas = 0, resto = sobra;
    for (const s of siguientes) {
      if (resto + 0.005 < Number(s.monto_usd)) break;
      resto -= Number(s.monto_usd);
      adelantadas++;
    }
    caja.innerHTML = `<span style="color:var(--cian)">Abona ${numero(sobra)} USD de más:
      ${adelantadas ? 'adelanta ' + adelantadas + ' cuota' + (adelantadas > 1 ? 's' : '') : 'rebaja la próxima cuota'}${
      adelantadas && resto > 0.005 ? ' y rebaja la siguiente en ' + numero(resto) + ' USD' : ''}.</span>`;
  }

  async function registrarCobro(q, btn) {
    const err = $('#cb-error');
    const monto = Number($('#cb-monto').value);
    const tasa = Number($('#cb-tasa').value || 1);
    if (!monto || monto <= 0) {
      err.textContent = 'Indica el monto cobrado.'; err.hidden = false; return;
    }
    btn.disabled = true;
    try {
      await INV.db.cuotas.pagar(q.id, $('#cb-metodo').value, monto, tasa,
                                $('#cb-referencia').value.replace(/\D/g, '').slice(0, 6) || null);
      cerrarModal();
      avisar('Cuota ' + q.numero + ' de ' + q.comprobante + ' cobrada');
      window.dispatchEvent(new Event('recargar-vista'));
    } catch (e) {
      err.textContent = e.message; err.hidden = false; btn.disabled = false;
    }
  }

  function enlazar() {
    $$('[data-abrir]').forEach(el => {
      const abrir = () => irA(el.dataset.abrir);
      el.addEventListener('click', abrir);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
      });
    });
  }
})();
