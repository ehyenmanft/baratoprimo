/* =====================================================================
   Generador de códigos QR — modo byte, corrección de errores nivel M.
   ---------------------------------------------------------------------
   Escrito a mano para no depender de una librería externa: el
   comprobante debe poder imprimirse sin conexión. Cubre versiones 1 a 10,
   suficiente para una URL o un resumen de venta (hasta 216 bytes).
   ===================================================================== */
(function () {

  /* ---------------- Aritmética en GF(256) ---------------- */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function tablas() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;      // polinomio primitivo del estándar
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /* Polinomio generador para n codewords de corrección. */
  function generador(n) {
    let poli = [1];
    for (let i = 0; i < n; i++) {
      // Multiplica el polinomio por (x + alfa^i), con el coeficiente
      // principal en el índice 0.
      const nuevo = new Array(poli.length + 1).fill(0);
      for (let j = 0; j < poli.length; j++) {
        nuevo[j]     ^= poli[j];
        nuevo[j + 1] ^= mul(poli[j], EXP[i]);
      }
      poli = nuevo;
    }
    return poli;
  }

  /* Reed-Solomon: devuelve los codewords de corrección de un bloque. */
  function corregir(datos, n) {
    const gen = generador(n);
    const resto = new Array(n).fill(0);
    for (const byte of datos) {
      const factor = byte ^ resto[0];
      resto.shift();
      resto.push(0);
      for (let i = 0; i < n; i++) resto[i] ^= mul(gen[i + 1], factor);
    }
    return resto;
  }

  /* ---------------- Tablas del estándar (nivel M) ----------------
     [codewords de datos, codewords EC por bloque, bloques grupo 1,
      datos por bloque grupo 1, bloques grupo 2, datos por bloque grupo 2] */
  const VERSIONES = {
    1:  [16,  10, 1, 16, 0, 0],
    2:  [28,  16, 1, 28, 0, 0],
    3:  [44,  26, 1, 44, 0, 0],
    4:  [64,  18, 2, 32, 0, 0],
    5:  [86,  24, 2, 43, 0, 0],
    6:  [108, 16, 4, 27, 0, 0],
    7:  [124, 18, 4, 31, 0, 0],
    8:  [154, 22, 2, 38, 2, 39],
    9:  [182, 22, 3, 36, 2, 37],
    10: [216, 26, 4, 43, 1, 44],
  };

  const ALINEACION = {
    1: [], 2: [6,18], 3: [6,22], 4: [6,26], 5: [6,30],
    6: [6,34], 7: [6,22,38], 8: [6,24,42], 9: [6,26,46], 10: [6,28,50],
  };

  /* ---------------- Codificación de los datos ---------------- */
  function bytesDeTexto(texto) {
    return Array.from(new TextEncoder().encode(texto));
  }

  function versionPara(largo) {
    for (let v = 1; v <= 10; v++) {
      const capacidad = VERSIONES[v][0];
      const bitsCuenta = v < 10 ? 8 : 16;
      // 4 bits de modo + cuenta + datos, redondeado a bytes
      if (Math.ceil((4 + bitsCuenta + largo * 8) / 8) <= capacidad) return v;
    }
    throw new Error('El contenido excede la capacidad del QR (máximo 213 bytes).');
  }

  function codewordsDatos(bytes, version) {
    const [capacidad] = VERSIONES[version];
    const bitsCuenta = version < 10 ? 8 : 16;
    const bits = [];
    const empujar = (valor, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >> i) & 1); };

    empujar(0b0100, 4);              // modo byte
    empujar(bytes.length, bitsCuenta);
    bytes.forEach(b => empujar(b, 8));

    // Terminador y relleno hasta completar bytes
    const maxBits = capacidad * 8;
    for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);

    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    }
    // Relleno alterno definido por el estándar
    const RELLENO = [0xEC, 0x11];
    let i = 0;
    while (cw.length < capacidad) cw.push(RELLENO[i++ % 2]);
    return cw;
  }

  /* Divide en bloques, calcula EC e intercala en el orden del estándar. */
  function intercalar(cw, version) {
    const [, ecPorBloque, b1, d1, b2, d2] = VERSIONES[version];
    const bloques = [];
    let p = 0;
    for (let i = 0; i < b1; i++) { bloques.push(cw.slice(p, p + d1)); p += d1; }
    for (let i = 0; i < b2; i++) { bloques.push(cw.slice(p, p + d2)); p += d2; }

    const ec = bloques.map(b => corregir(b, ecPorBloque));

    const salida = [];
    const maxDatos = Math.max(...bloques.map(b => b.length));
    for (let i = 0; i < maxDatos; i++)
      bloques.forEach(b => { if (i < b.length) salida.push(b[i]); });
    for (let i = 0; i < ecPorBloque; i++)
      ec.forEach(b => salida.push(b[i]));
    return salida;
  }

  /* ---------------- Construcción de la matriz ---------------- */
  function nuevaMatriz(tam) {
    const m = [], reservado = [];
    for (let i = 0; i < tam; i++) {
      m.push(new Array(tam).fill(0));
      reservado.push(new Array(tam).fill(false));
    }
    return { m, reservado };
  }

  function ponerBuscador(m, reservado, fila, col) {
    for (let f = -1; f <= 7; f++) {
      for (let c = -1; c <= 7; c++) {
        const y = fila + f, x = col + c;
        if (y < 0 || x < 0 || y >= m.length || x >= m.length) continue;
        const borde = (f >= 0 && f <= 6 && (c === 0 || c === 6)) ||
                      (c >= 0 && c <= 6 && (f === 0 || f === 6));
        const centro = f >= 2 && f <= 4 && c >= 2 && c <= 4;
        m[y][x] = (borde || centro) ? 1 : 0;
        reservado[y][x] = true;
      }
    }
  }

  function ponerAlineacion(m, reservado, version) {
    const centros = ALINEACION[version];
    for (const f of centros) {
      for (const c of centros) {
        // No van sobre los buscadores
        if (reservado[f][c]) continue;
        for (let df = -2; df <= 2; df++) {
          for (let dc = -2; dc <= 2; dc++) {
            m[f + df][c + dc] = (Math.abs(df) === 2 || Math.abs(dc) === 2 || (df === 0 && dc === 0)) ? 1 : 0;
            reservado[f + df][c + dc] = true;
          }
        }
      }
    }
  }

  /* BCH(15,5) para el formato, y BCH(18,6) para la versión. */
  function bitsFormato(mascara) {
    let datos = (0b00 << 3) | mascara;   // 00 = nivel M
    let resto = datos << 10;
    for (let i = 14; i >= 10; i--) if ((resto >> i) & 1) resto ^= 0x537 << (i - 10);
    return ((datos << 10) | resto) ^ 0x5412;
  }

  function bitsVersion(version) {
    let resto = version << 12;
    for (let i = 17; i >= 12; i--) if ((resto >> i) & 1) resto ^= 0x1F25 << (i - 12);
    return (version << 12) | resto;
  }

  const MASCARAS = [
    (f, c) => (f + c) % 2 === 0,
    (f) => f % 2 === 0,
    (f, c) => c % 3 === 0,
    (f, c) => (f + c) % 3 === 0,
    (f, c) => (Math.floor(f / 2) + Math.floor(c / 3)) % 2 === 0,
    (f, c) => ((f * c) % 2) + ((f * c) % 3) === 0,
    (f, c) => (((f * c) % 2) + ((f * c) % 3)) % 2 === 0,
    (f, c) => (((f + c) % 2) + ((f * c) % 3)) % 2 === 0,
  ];

  /* Penalizaciones del estándar: elige la máscara que menos artefactos deja. */
  function penalizacion(m) {
    const n = m.length;
    let total = 0;

    // Regla 1: series de 5 o más del mismo color
    const serie = linea => {
      let p = 0, run = 1;
      for (let i = 1; i < n; i++) {
        if (linea[i] === linea[i - 1]) { run++; }
        else { if (run >= 5) p += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) p += 3 + (run - 5);
      return p;
    };
    for (let i = 0; i < n; i++) {
      total += serie(m[i]);
      total += serie(m.map(f => f[i]));
    }

    // Regla 2: bloques de 2x2
    for (let f = 0; f < n - 1; f++)
      for (let c = 0; c < n - 1; c++)
        if (m[f][c] === m[f][c+1] && m[f][c] === m[f+1][c] && m[f][c] === m[f+1][c+1]) total += 3;

    // Regla 3: patrón similar al buscador
    const P1 = [1,0,1,1,1,0,1,0,0,0,0], P2 = [0,0,0,0,1,0,1,1,1,0,1];
    const coincide = (arr, i, patron) => patron.every((v, k) => arr[i + k] === v);
    for (let i = 0; i < n; i++) {
      const fila = m[i], col = m.map(f => f[i]);
      for (let j = 0; j <= n - 11; j++) {
        if (coincide(fila, j, P1) || coincide(fila, j, P2)) total += 40;
        if (coincide(col, j, P1) || coincide(col, j, P2)) total += 40;
      }
    }

    // Regla 4: desequilibrio entre claro y oscuro
    const oscuros = m.flat().reduce((s, v) => s + v, 0);
    const porcentaje = (oscuros * 100) / (n * n);
    total += Math.floor(Math.abs(porcentaje - 50) / 5) * 10;

    return total;
  }

  /* ---------------- API pública ---------------- */

  /* Devuelve la matriz de módulos (1 = oscuro) para el texto dado. */
  function matriz(texto, mascaraFija = null) {
    const bytes = bytesDeTexto(texto);
    const version = versionPara(bytes.length);
    const datos = intercalar(codewordsDatos(bytes, version), version);
    const tam = version * 4 + 17;

    const { m, reservado } = nuevaMatriz(tam);

    ponerBuscador(m, reservado, 0, 0);
    ponerBuscador(m, reservado, 0, tam - 7);
    ponerBuscador(m, reservado, tam - 7, 0);
    ponerAlineacion(m, reservado, version);

    // Patrones de sincronía
    for (let i = 8; i < tam - 8; i++) {
      const v = i % 2 === 0 ? 1 : 0;
      if (!reservado[6][i]) { m[6][i] = v; reservado[6][i] = true; }
      if (!reservado[i][6]) { m[i][6] = v; reservado[i][6] = true; }
    }

    // Módulo oscuro fijo
    m[tam - 8][8] = 1; reservado[tam - 8][8] = true;

    // Reserva de las zonas de formato
    for (let i = 0; i < 9; i++) {
      if (!reservado[8][i]) reservado[8][i] = true;
      if (!reservado[i][8]) reservado[i][8] = true;
    }
    for (let i = 0; i < 8; i++) {
      reservado[8][tam - 1 - i] = true;
      reservado[tam - 1 - i][8] = true;
    }
    // Reserva de la información de versión (7 en adelante)
    if (version >= 7) {
      for (let i = 0; i < 6; i++)
        for (let j = 0; j < 3; j++) {
          reservado[tam - 11 + j][i] = true;
          reservado[i][tam - 11 + j] = true;
        }
    }

    // Colocación de datos en zigzag, saltando la columna 6
    let bit = 0;
    const totalBits = datos.length * 8;
    const leerBit = () => bit < totalBits ? (datos[bit >> 3] >> (7 - (bit & 7))) & 1 : 0;

    let arriba = true;
    for (let col = tam - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let paso = 0; paso < tam; paso++) {
        const fila = arriba ? tam - 1 - paso : paso;
        for (const c of [col, col - 1]) {
          if (reservado[fila][c]) continue;
          m[fila][c] = leerBit();
          bit++;
        }
      }
      arriba = !arriba;
    }

    // Elección de máscara
    let mejor = null, mejorPena = Infinity;
    for (let k = 0; k < 8; k++) {
      if (mascaraFija !== null && k !== mascaraFija) continue;
      const copia = m.map(f => f.slice());
      for (let f = 0; f < tam; f++)
        for (let c = 0; c < tam; c++)
          if (!reservado[f][c] && MASCARAS[k](f, c)) copia[f][c] ^= 1;

      escribirFormato(copia, tam, k);
      if (version >= 7) escribirVersion(copia, tam, version);

      const pena = penalizacion(copia);
      if (pena < mejorPena) { mejorPena = pena; mejor = copia; }
    }
    return mejor;
  }

  function escribirFormato(m, tam, mascara) {
    const bits = bitsFormato(mascara);
    const leer = i => (bits >> i) & 1;

    // Primera copia: columna 8 hacia abajo, luego fila 8 hacia la izquierda
    for (let i = 0; i <= 5; i++) m[i][8] = leer(i);
    m[7][8] = leer(6);
    m[8][8] = leer(7);
    m[8][7] = leer(8);
    for (let i = 9; i <= 14; i++) m[8][14 - i] = leer(i);

    // Segunda copia: fila 8 por la derecha y columna 8 por abajo
    for (let i = 0; i <= 7; i++) m[8][tam - 1 - i] = leer(i);
    for (let i = 8; i <= 14; i++) m[tam - 15 + i][8] = leer(i);

    m[tam - 8][8] = 1;   // módulo oscuro fijo
  }

  function escribirVersion(m, tam, version) {
    const bits = bitsVersion(version);
    for (let i = 0; i < 18; i++) {
      const b = (bits >> i) & 1;
      const f = Math.floor(i / 3), c = i % 3;
      m[tam - 11 + c][f] = b;
      m[f][tam - 11 + c] = b;
    }
  }

  /* Dibuja el QR como SVG: escala sin pérdida y se imprime nítido. */
  function svg(texto, { tamano = 160, margen = 4, color = '#000' } = {}) {
    const m = matriz(texto);
    const n = m.length;
    const total = n + margen * 2;
    let ruta = '';
    for (let f = 0; f < n; f++)
      for (let c = 0; c < n; c++)
        if (m[f][c]) ruta += `M${c + margen} ${f + margen}h1v1h-1z`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" `
         + `width="${tamano}" height="${tamano}" shape-rendering="crispEdges" role="img" aria-label="Código QR">`
         + `<rect width="${total}" height="${total}" fill="#fff"/>`
         + `<path d="${ruta}" fill="${color}"/></svg>`;
  }

  INV.qr = { matriz, svg };
})();
