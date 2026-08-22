/* =====================================================================
   Clientes — listado y ficha con histórico de compras.
   El documento fiscal va partido en prefijo y número, como en la cédula
   y el RIF venezolanos: V/E para personas, J/G/P para jurídicos.
   ===================================================================== */
(function () {
  const { $, $$, esc, numero, cantidad, fecha, avisar, abrirModal, cerrarModal,
          cargando, vacio } = INV.ui;

  const PREFIJOS = [
    { id: 'V', etiqueta: 'V — Cédula venezolana' },
    { id: 'E', etiqueta: 'E — Cédula de extranjero' },
    { id: 'J', etiqueta: 'J — RIF jurídico' },
    { id: 'G', etiqueta: 'G — RIF gubernamental' },
    { id: 'P', etiqueta: 'P — Pasaporte' },
  ];

  const iniciales = nombre => String(nombre || '?').trim().split(/\s+/).slice(0, 2)
    .map(x => x[0]).join('').toUpperCase();

  /* ---------------- Formulario ---------------- */

  function abrirFormulario(c = null) {
    abrirModal({
      titulo: c ? 'Editar cliente' : 'Nuevo cliente',
      cuerpo: `
        <div class="campos-fila">
          <div class="campo">
            <label for="cl-nombres">Nombres</label>
            <input id="cl-nombres" type="text" value="${esc(c ? c.nombres : '')}" placeholder="María Fernanda">
          </div>
          <div class="campo">
            <label for="cl-apellidos">Apellidos</label>
            <input id="cl-apellidos" type="text" value="${esc(c ? c.apellidos : '')}" placeholder="Rodríguez Salas">
          </div>
        </div>

        <div class="campo">
          <label for="cl-documento">Documento de identificación fiscal</label>
          <div style="display:grid; grid-template-columns:88px 1fr; gap:8px">
            <select id="cl-prefijo" title="Tipo de documento">
              ${PREFIJOS.map(p => `<option value="${p.id}" ${c && c.tipo_documento === p.id ? 'selected' : ''}>${p.id}-</option>`).join('')}
            </select>
            <input id="cl-documento" type="text" inputmode="numeric"
                   value="${esc(c ? c.documento : '')}" placeholder="18456321">
          </div>
          <span class="subida__nota" id="cl-prefijo-nota" style="margin-top:6px; display:block"></span>
        </div>

        <div class="campo">
          <label for="cl-telefono">Número de contacto</label>
          <input id="cl-telefono" type="tel" value="${esc(c ? (c.telefono ?? '') : '')}" placeholder="0414-5567890">
        </div>

        <div class="campo">
          <label for="cl-direccion">Dirección de residencia</label>
          <textarea id="cl-direccion" rows="2" placeholder="Av. Bolívar, Res. El Parque, Torre A, Apt 5-B, Caracas">${esc(c ? (c.direccion ?? '') : '')}</textarea>
        </div>

        <p id="cl-error" class="error" hidden></p>`,
      acciones: [
        ...(c ? [{ texto: 'Desactivar', alPulsar: () => desactivar(c.id) }] : []),
        { texto: 'Cancelar', alPulsar: cerrarModal },
        { texto: 'Guardar', estilo: 'btn--primario', alPulsar: btn => guardar(c, btn) },
      ],
    });

    const nota = () => {
      const p = PREFIJOS.find(x => x.id === $('#cl-prefijo').value);
      $('#cl-prefijo-nota').textContent = p ? p.etiqueta : '';
    };
    $('#cl-prefijo').addEventListener('change', nota);
    nota();
  }

  async function guardar(c, btn) {
    const err = $('#cl-error');
    const datos = {
      nombres:        $('#cl-nombres').value.trim(),
      apellidos:      $('#cl-apellidos').value.trim(),
      tipo_documento: $('#cl-prefijo').value,
      documento:      $('#cl-documento').value.trim().replace(/[^0-9A-Za-z]/g, ''),
      telefono:       $('#cl-telefono').value.trim() || null,
      direccion:      $('#cl-direccion').value.trim() || null,
    };

    if (!datos.nombres)   { err.textContent = 'El nombre es obligatorio.'; err.hidden = false; return; }
    if (!datos.documento) { err.textContent = 'El documento es obligatorio.'; err.hidden = false; return; }

    btn.disabled = true;
    try {
      c ? await INV.db.clientes.actualizar(c.id, datos) : await INV.db.clientes.crear(datos);
      cerrarModal();
      avisar(c ? 'Cliente actualizado' : 'Cliente registrado');
      window.dispatchEvent(new Event('recargar-vista'));
    } catch (e) {
      err.textContent = e.message.includes('duplicate')
        ? 'Ya hay un cliente registrado con ese documento.'
        : e.message;
      err.hidden = false;
      btn.disabled = false;
    }
  }

  async function desactivar(id) {
    // No se borra: las ventas emitidas deben seguir apuntando al cliente.
    await INV.db.clientes.desactivar(id);
    cerrarModal();
    avisar('Cliente desactivado');
    location.hash = '#/clientes';
    window.dispatchEvent(new Event('recargar-vista'));
  }

  /* ---------------- Listado ---------------- */

  INV.vistas = INV.vistas || {};
  INV.vistas.clientes = {
    titulo: 'Clientes',
    eyebrow: 'Cartera comercial',
    abrirFormulario,

    acciones: () => [
      { texto: 'Nuevo cliente', estilo: 'btn--primario', alPulsar: () => abrirFormulario() },
    ],

    render: async contenedor => {
      contenedor.innerHTML = cargando();
      const [clientes, ventas] = await Promise.all([
        INV.db.clientes.listar(),
        INV.db.ventas.listar({ limite: 1000 }),
      ]);

      if (!clientes.length) {
        contenedor.innerHTML = vacio('Sin clientes registrados',
          'Registra el primero para poder emitir ventas a su nombre.',
          '<button class="btn btn--primario" id="cl-primero">Nuevo cliente</button>');
        $('#cl-primero').addEventListener('click', () => abrirFormulario());
        return;
      }

      const resumen = {};
      ventas.filter(v => !v.anulada).forEach(v => {
        if (!v.cliente_id) return;
        resumen[v.cliente_id] = resumen[v.cliente_id] || { compras: 0, total: 0, ultima: null };
        resumen[v.cliente_id].compras++;
        resumen[v.cliente_id].total += Number(v.total);
        if (!resumen[v.cliente_id].ultima || v.fecha > resumen[v.cliente_id].ultima)
          resumen[v.cliente_id].ultima = v.fecha;
      });

      const facturado = ventas.filter(v => !v.anulada).reduce((s, v) => s + Number(v.total), 0);
      const conCompras = Object.keys(resumen).length;

      const ficha = (c, i) => {
        const r = resumen[c.id] || { compras: 0, total: 0, ultima: null };
        return `
          <div class="lista__item" style="--i:${Math.min(i, 20)}" data-abrir="${c.id}" role="button" tabindex="0">
            <span class="miniatura miniatura--vacia">${esc(iniciales(c.cliente))}</span>
            <span class="lista__nombre">${esc(c.cliente)}
              <span class="lista__sub">${esc(c.documento_completo)}${c.telefono ? ' · ' + esc(c.telefono) : ''}</span></span>
            <span class="lista__dato"><b>${r.compras}</b><small>compras</small></span>
            <span class="lista__dato"><b>${numero(r.total)}</b><small>facturado</small></span>
          </div>`;
      };

      contenedor.innerHTML = `
        <div class="mosaico mosaico--auto" style="margin-bottom:14px">
          <div class="metrica metrica--violeta anim" style="--i:0">
            <div class="metrica__etiqueta">Clientes</div>
            <div class="metrica__valor">${clientes.length}</div>
            <div class="metrica__pie">${conCompras} con compras</div>
          </div>
          <div class="metrica metrica--teal anim" style="--i:1">
            <div class="metrica__etiqueta">Facturado</div>
            <div class="metrica__valor">${numero(facturado)}</div>
            <div class="metrica__pie">histórico total</div>
          </div>
          <div class="metrica metrica--cian anim" style="--i:2">
            <div class="metrica__etiqueta">Ventas</div>
            <div class="metrica__valor">${ventas.filter(v => !v.anulada).length}</div>
            <div class="metrica__pie">comprobantes vigentes</div>
          </div>
          <div class="metrica anim" style="--i:3">
            <div class="metrica__etiqueta">Ticket medio</div>
            <div class="metrica__valor">${ventas.filter(v => !v.anulada).length
              ? numero(facturado / ventas.filter(v => !v.anulada).length) : '—'}</div>
            <div class="metrica__pie">por comprobante</div>
          </div>
        </div>

        <div class="ficha anim" style="--i:4">
          <div class="ficha__cabecera">
            <div>
              <h3 class="ficha__titulo">Cartera</h3>
              <p class="ficha__nota">pulsa un cliente para ver su histórico</p>
            </div>
            <input class="buscador" type="search" id="cl-buscar" placeholder="Buscar por nombre o documento">
          </div>
          <div class="lista lista--cli" id="cl-lista">${clientes.map(ficha).join('')}</div>
        </div>`;

      $('#cl-buscar').addEventListener('input', e => {
        const t = e.target.value.toLowerCase();
        const filtrados = clientes.filter(c =>
          c.cliente.toLowerCase().includes(t) || c.documento.includes(t));
        $('#cl-lista').innerHTML = filtrados.length ? filtrados.map(ficha).join('')
          : '<div class="vacio"><h4>Sin resultados</h4><p>Ningún cliente coincide.</p></div>';
        enlazar();
      });

      enlazar();
    },
  };

  /* ---------------- Ficha de cliente ---------------- */

  let clienteActual = null;

  INV.vistas.cliente = {
    railComo: 'clientes',
    titulo: () => clienteActual ? clienteActual.cliente : 'Cliente',
    eyebrow: () => 'Ficha de cliente',

    acciones: () => [
      { texto: 'Volver', estilo: 'btn--secundario', alPulsar: () => { location.hash = '#/clientes'; } },
    ],

    render: async (contenedor, param) => {
      contenedor.innerHTML = cargando();
      const c = await INV.db.clientes.obtener(param);

      if (!c) {
        contenedor.innerHTML = vacio('Cliente no encontrado',
          'Puede que se haya desactivado o que el enlace esté mal.',
          '<a class="btn btn--primario" href="#/clientes">Ver clientes</a>');
        return;
      }

      clienteActual = c;
      $('#vista-titulo').textContent = c.cliente;

      const ventas = await INV.db.ventas.listar({ clienteId: c.id, limite: 200 });
      // Las anuladas siguen en el histórico, pero no suman a lo facturado.
      const vigentes = ventas.filter(v => !v.anulada);
      const total = vigentes.reduce((s, v) => s + Number(v.total), 0);
      const iva = vigentes.reduce((s, v) => s + Number(v.iva_monto), 0);
      const ultima = vigentes.length ? vigentes[0].fecha : null;

      contenedor.innerHTML = `
        <div class="ficha anim" style="--i:0; margin-bottom:14px">
          <div class="detalle__encabezado">
            <div class="detalle__cara">
              <span class="detalle__foto miniatura--vacia" style="display:grid; place-items:center; font-family:var(--dato); font-weight:700; color:#fff">${esc(iniciales(c.cliente))}</span>
              <div>
                <h2 class="detalle__titulo">${esc(c.cliente)}</h2>
                <div class="detalle__meta">
                  <span>${esc(c.documento_completo)}</span>
                  ${c.telefono ? `<span>${esc(c.telefono)}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="enlaces">
              <button class="btn btn--secundario btn--chico" id="cf-editar">Editar</button>
              <a class="btn btn--fantasma btn--chico" href="#/ventas/nueva">Nueva venta</a>
            </div>
          </div>

          <div class="datos">
            <div class="datos__celda">
              <div class="datos__etiqueta">Documento fiscal</div>
              <div class="datos__valor">${esc(c.documento_completo)}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Contacto</div>
              <div class="datos__valor" style="font-size:14px">${esc(c.telefono ?? '—')}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Compras</div>
              <div class="datos__valor">${vigentes.length}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Total facturado</div>
              <div class="datos__valor">${numero(total)}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">IVA acumulado</div>
              <div class="datos__valor">${numero(iva)}</div>
            </div>
            <div class="datos__celda">
              <div class="datos__etiqueta">Última compra</div>
              <div class="datos__valor" style="font-size:14px">${ultima ? fecha(ultima) : '—'}</div>
            </div>
          </div>

          <div class="ficha__pie">
            <div class="datos__etiqueta">Dirección de residencia</div>
            <div style="font-size:14px; margin-top:4px">${esc(c.direccion ?? 'No registrada')}</div>
          </div>
        </div>

        <div class="ficha anim" style="--i:1">
          <div class="ficha__cabecera">
            <h3 class="ficha__titulo">Histórico de compras</h3>
            <p class="ficha__nota">${ventas.length} comprobantes</p>
          </div>
          ${ventas.length ? `
            <div class="lista lista--ven">
              ${ventas.map((v, i) => `
                <div class="lista__item ${v.anulada ? 'apagado' : ''}" style="--i:${Math.min(i, 20)}"
                     data-venta="${v.id}" role="button" tabindex="0">
                  <span class="pastilla pastilla--${v.anulada ? 'salida' : 'entrada'}">${esc(v.numero)}</span>
                  <span class="lista__nombre">${fecha(v.fecha)}
                    <span class="lista__sub">${v.anulada ? 'ANULADA · ' : ''}${v.renglones} renglones · IVA ${numero(v.iva_tasa, 0)}%</span></span>
                  <span class="lista__dato"><b>${numero(v.subtotal)}</b><small>base</small></span>
                  <span class="lista__dato"><b>${numero(v.total)}</b><small>total</small></span>
                </div>`).join('')}
            </div>`
          : '<div class="vacio"><h4>Sin compras</h4><p>Este cliente todavía no tiene ventas registradas.</p></div>'}
        </div>`;

      $('#cf-editar').addEventListener('click', () => abrirFormulario(c));
      $$('[data-venta]').forEach(el => {
        const ir = () => { location.hash = '#/venta/' + el.dataset.venta; };
        el.addEventListener('click', ir);
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } });
      });
    },
  };

  function enlazar() {
    $$('#cl-lista [data-abrir]').forEach(el => {
      const ir = () => { location.hash = '#/cliente/' + el.dataset.abrir; };
      el.addEventListener('click', ir);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } });
    });
  }
})();
