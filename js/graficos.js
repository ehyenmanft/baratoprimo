/* =====================================================================
   Gráficas
   SVG generado a mano: cero dependencias, funciona sin conexión y hereda
   la paleta desde las variables CSS. Todas son responsivas por viewBox.
   ===================================================================== */
(function () {
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const compacto = v => {
    const n = Math.abs(Number(v));
    if (n >= 1e6) return (v/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
    if (n >= 1e3) return (v/1e3).toFixed(1).replace(/\.0$/,'') + 'k';
    return String(Math.round(v));
  };

  /* -------------------------------------------------------------------
     Flujo del almacén — la gráfica principal.
     Entradas hacia arriba, salidas hacia abajo desde un eje central.
     Un almacén respira: lo que entra y lo que sale se leen de un vistazo,
     y el desbalance entre las dos mitades es la información real.
     ------------------------------------------------------------------- */
  function flujo(cubos, { alto = 260 } = {}) {
    if (!cubos.length) return vacia('Sin movimientos en el periodo');

    const A = 1000, H = alto;
    const mIzq = 46, mDer = 12, mSup = 18, mInf = 34;
    const anchoUtil = A - mIzq - mDer;
    const altoUtil = H - mSup - mInf;
    const ejeY = mSup + altoUtil / 2;

    const tope = Math.max(1, ...cubos.map(c => Math.max(c.entradas, c.salidas)));
    const escala = (altoUtil / 2) / tope;

    const paso = anchoUtil / cubos.length;
    const anchoBarra = Math.min(38, Math.max(4, paso * 0.34));
    const sep = Math.min(4, anchoBarra * 0.18);

    // Solo etiquetamos una parte del eje X para que no se amontone.
    const cada = Math.ceil(cubos.length / 9);

    const barras = cubos.map((c, i) => {
      const cx = mIzq + paso * i + paso / 2;
      const hE = c.entradas * escala;
      const hS = c.salidas * escala;
      const x1 = cx - anchoBarra - sep / 2;
      const x2 = cx + sep / 2;
      return `
        ${c.entradas ? `<rect x="${x1.toFixed(1)}" y="${(ejeY - hE).toFixed(1)}" width="${anchoBarra.toFixed(1)}" height="${hE.toFixed(1)}" rx="3" class="g-entrada" style="animation-delay:${(i*22)}ms"><title>${esc(c.etiquetaLarga)} · entradas ${compacto(c.entradas)}</title></rect>` : ''}
        ${c.salidas ? `<rect x="${x2.toFixed(1)}" y="${ejeY.toFixed(1)}" width="${anchoBarra.toFixed(1)}" height="${hS.toFixed(1)}" rx="3" class="g-salida" style="animation-delay:${(i*22)}ms"><title>${esc(c.etiquetaLarga)} · salidas ${compacto(c.salidas)}</title></rect>` : ''}
        ${i % cada === 0 ? `<text x="${cx.toFixed(1)}" y="${H - 10}" class="g-eje" text-anchor="middle">${esc(c.etiqueta)}</text>` : ''}`;
    }).join('');

    const guias = [1, 0.5].flatMap(f => [
      `<line x1="${mIzq}" x2="${A - mDer}" y1="${ejeY - altoUtil/2*f}" y2="${ejeY - altoUtil/2*f}" class="g-guia"/>`,
      `<line x1="${mIzq}" x2="${A - mDer}" y1="${ejeY + altoUtil/2*f}" y2="${ejeY + altoUtil/2*f}" class="g-guia"/>`,
      `<text x="${mIzq - 8}" y="${ejeY - altoUtil/2*f + 4}" class="g-eje" text-anchor="end">${compacto(tope*f)}</text>`,
      `<text x="${mIzq - 8}" y="${ejeY + altoUtil/2*f + 4}" class="g-eje" text-anchor="end">${compacto(tope*f)}</text>`,
    ]).join('');

    return `<svg viewBox="0 0 ${A} ${H}" class="grafica" preserveAspectRatio="none" role="img" aria-label="Entradas y salidas por periodo">
      ${guias}
      ${barras}
      <line x1="${mIzq}" x2="${A - mDer}" y1="${ejeY}" y2="${ejeY}" class="g-eje-central"/>
    </svg>`;
  }

  /* -------------------------------------------------------------------
     Línea de valor del inventario o de saldo acumulado.
     ------------------------------------------------------------------- */
  function linea(puntos, { alto = 200, clase = 'g-linea' } = {}) {
    if (puntos.length < 2) return vacia('Se necesitan al menos dos periodos');

    const A = 1000, H = alto;
    const mIzq = 48, mDer = 14, mSup = 16, mInf = 30;
    const anchoUtil = A - mIzq - mDer, altoUtil = H - mSup - mInf;

    const vals = puntos.map(p => p.valor);
    const max = Math.max(...vals), min = Math.min(...vals, 0);
    const rango = (max - min) || 1;

    const x = i => mIzq + (anchoUtil / Math.max(1, puntos.length - 1)) * i;
    const y = v => mSup + altoUtil - ((v - min) / rango) * altoUtil;

    const d = puntos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ');
    const area = `${d} L${x(puntos.length-1).toFixed(1)},${mSup+altoUtil} L${mIzq},${mSup+altoUtil} Z`;
    const cada = Math.ceil(puntos.length / 8);

    return `<svg viewBox="0 0 ${A} ${H}" class="grafica" preserveAspectRatio="none" role="img" aria-label="Evolución por periodo">
      ${[0, 0.5, 1].map(f => `
        <line x1="${mIzq}" x2="${A-mDer}" y1="${(mSup+altoUtil*f).toFixed(1)}" y2="${(mSup+altoUtil*f).toFixed(1)}" class="g-guia"/>
        <text x="${mIzq-8}" y="${(mSup+altoUtil*f+4).toFixed(1)}" class="g-eje" text-anchor="end">${compacto(max-(max-min)*f)}</text>`).join('')}
      <path d="${area}" class="g-area"/>
      <path d="${d}" class="${clase}" fill="none"/>
      ${puntos.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.valor).toFixed(1)}" r="3.5" class="g-punto"><title>${esc(p.etiquetaLarga || p.etiqueta)}: ${compacto(p.valor)}</title></circle>`).join('')}
      ${puntos.map((p, i) => i % cada === 0
        ? `<text x="${x(i).toFixed(1)}" y="${H-8}" class="g-eje" text-anchor="middle">${esc(p.etiqueta)}</text>` : '').join('')}
    </svg>`;
  }

  /* -------------------------------------------------------------------
     Barras horizontales — ranking de productos.
     ------------------------------------------------------------------- */
  function ranking(items, { formato = compacto } = {}) {
    if (!items.length) return vacia('Sin datos en el periodo');
    const tope = Math.max(...items.map(i => i.valor)) || 1;

    return `<ul class="ranking">
      ${items.map((i, n) => `
        <li class="ranking__fila" style="--i:${n}">
          <span class="ranking__pos">${String(n + 1).padStart(2, '0')}</span>
          <span class="ranking__nombre" title="${esc(i.nombre)}">${esc(i.nombre)}
            <span class="ranking__sku">${esc(i.sku || '')}</span></span>
          <span class="ranking__riel">
            <span class="ranking__barra" style="--i:${n}; width:${(i.valor / tope * 100).toFixed(1)}%"></span>
          </span>
          <span class="ranking__valor">${formato(i.valor)}</span>
        </li>`).join('')}
    </ul>`;
  }

  /* -------------------------------------------------------------------
     Barra apilada de composición — valor por categoría.
     ------------------------------------------------------------------- */
  function composicion(partes) {
    const total = partes.reduce((s, p) => s + p.valor, 0);
    if (!total) return vacia('Sin valor registrado');

    return `
      <div class="apilada">
        ${partes.map((p, i) => `<span class="apilada__tramo" style="width:${(p.valor/total*100).toFixed(2)}%;background:var(--serie-${i % 6});animation-delay:${i*70}ms" title="${esc(p.nombre)}: ${compacto(p.valor)}"></span>`).join('')}
      </div>
      <ul class="leyenda">
        ${partes.map((p, i) => `
          <li><span class="leyenda__punto" style="background:var(--serie-${i % 6})"></span>
            ${esc(p.nombre)} <b>${(p.valor/total*100).toFixed(0)}%</b></li>`).join('')}
      </ul>`;
  }

  const vacia = texto => `<div class="grafica-vacia">${esc(texto)}</div>`;

  INV.graficas = { flujo, linea, ranking, composicion, compacto };
})();
