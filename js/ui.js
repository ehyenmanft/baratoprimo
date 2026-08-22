/* Utilidades compartidas por las vistas. */
(function () {
  const $  = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

  const esc = v => String(v ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  const numero = (v, dec = 2) =>
    Number(v ?? 0).toLocaleString('es', { minimumFractionDigits: dec, maximumFractionDigits: dec });

  const cantidad = v => numero(v, Number.isInteger(Number(v)) ? 0 : 3);

  const fecha = v => new Date(v).toLocaleString('es', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  function avisar(texto, tipo = '') {
    const el = document.createElement('div');
    el.className = 'aviso' + (tipo === 'error' ? ' aviso--error' : '');
    el.textContent = texto;
    $('#avisos').append(el);
    setTimeout(() => el.remove(), 4000);
  }

  const modal = () => $('#modal');

  function abrirModal({ titulo, cuerpo, acciones = [] }) {
    $('#modal-titulo').textContent = titulo;
    $('#modal-cuerpo').innerHTML = cuerpo;
    const pie = $('#modal-pie');
    pie.innerHTML = '';
    acciones.forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.estilo || 'btn--secundario');
      b.textContent = a.texto;
      b.addEventListener('click', () => a.alPulsar && a.alPulsar(b));
      pie.append(b);
    });
    modal().hidden = false;
    const primero = $('#modal-cuerpo input, #modal-cuerpo select');
    if (primero) primero.focus();
  }

  function cerrarModal() { modal().hidden = true; }

  const cargando = () => '<div class="vacio">Cargando…</div>';

  const vacio = (titulo, texto, boton = '') =>
    `<div class="vacio"><h4>${esc(titulo)}</h4><p>${esc(texto)}</p>${boton}</div>`;

  /* Barra de stock contra el mínimo: la firma de la interfaz. */
  function medidor(stock, minimo, i = 0) {
    const s = Number(stock), m = Number(minimo);
    const tope = Math.max(m * 2, s, 1);
    const pct = Math.min(100, (s / tope) * 100);
    const clase = s <= 0 ? 'vacio' : s <= m ? 'bajo' : '';
    return `<div class="medidor">
      <div class="medidor__riel"><div class="medidor__barra ${clase}" style="--i:${i}; width:${pct}%"></div></div>
      <span class="medidor__min">mín ${cantidad(m)}</span>
    </div>`;
  }

  function descargarCSV(nombreArchivo, columnas, filas) {
    const escapar = v => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cuerpo = [
      columnas.map(c => escapar(c.titulo)).join(';'),
      ...filas.map(f => columnas.map(c => escapar(c.valor(f))).join(';')),
    ].join('\r\n');

    try {
      // El BOM hace que Excel respete los acentos al abrir el archivo.
      const blob = new Blob(['\uFEFF' + cuerpo], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombreArchivo;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      avisar('Este navegador no permitió la descarga del archivo', 'error');
    }
  }

  let yaEnlazado = false;

  function enlazar() {
    if (yaEnlazado) return;
    yaEnlazado = true;

    $('#modal-cerrar').addEventListener('click', cerrarModal);
    modal().addEventListener('click', e => { if (e.target === modal()) cerrarModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarModal(); });

    $$('.tema button').forEach(b => b.addEventListener('click', () => aplicarTema(b.dataset.tema)));
    aplicarTema(temaGuardado());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enlazar);
  } else {
    enlazar();
  }

  /* ---------------- Tema claro / oscuro ---------------- */
  const CLAVE_TEMA = 'inventario-tema';

  function aplicarTema(tema) {
    document.documentElement.dataset.tema = tema;
    try { localStorage.setItem(CLAVE_TEMA, tema); } catch (e) { /* file:// sin storage */ }
    $$('.tema button').forEach(b => b.classList.toggle('activo', b.dataset.tema === tema));
  }

  function temaGuardado() {
    try {
      const t = localStorage.getItem(CLAVE_TEMA);
      if (t) return t;
    } catch (e) { /* sin storage */ }
    // Sin preferencia guardada, seguimos la del sistema.
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
    } catch (e) { return 'claro'; }
  }

  /* ---------------- Imágenes ----------------
     Se reduce en el navegador antes de guardar: una foto de teléfono son
     varios MB y aquí solo hace falta una miniatura reconocible. */
  function imagenReducida(file, max = 480, calidad = 0.78) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) return reject(new Error('El archivo no es una imagen.'));
      const lector = new FileReader();
      lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      lector.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('No se pudo abrir la imagen.'));
        img.onload = () => {
          const escala = Math.min(1, max / Math.max(img.width, img.height));
          const lienzo = document.createElement('canvas');
          lienzo.width  = Math.round(img.width  * escala);
          lienzo.height = Math.round(img.height * escala);
          lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
          resolve(lienzo.toDataURL('image/jpeg', calidad));
        };
        img.src = lector.result;
      };
      lector.readAsDataURL(file);
    });
  }

  /* Miniatura con respaldo: si no hay imagen, las iniciales del producto. */
  function miniatura(ruta, nombre, clase = 'miniatura') {
    const url = INV.db && INV.db.archivos ? INV.db.archivos.url(ruta) : ruta;
    if (url) return `<img class="${clase}" src="${esc(url)}" alt="${esc(nombre)}" loading="lazy">`;
    const iniciales = String(nombre || '?').trim().split(/\s+/).slice(0, 2)
      .map(x => x[0]).join('').toUpperCase();
    return `<span class="${clase} ${clase}--vacia">${esc(iniciales)}</span>`;
  }

  INV.ui = { $, $$, esc, numero, cantidad, fecha, avisar, abrirModal, cerrarModal,
             cargando, vacio, medidor, descargarCSV,
             aplicarTema, temaGuardado, imagenReducida, miniatura };
})();
