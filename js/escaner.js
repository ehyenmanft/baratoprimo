/* =====================================================================
   BaratoPrimo — Lector de Códigos de Barras y Códigos QR
   ---------------------------------------------------------------------
   Permite escanear con la cámara del dispositivo (móvil, tablet, laptop)
   o mediante pistolas lectoras USB/Bluetooth.
   Soporta EAN-13, EAN-8, Code-128, Code-39, UPC-A, UPC-E, QR Code, etc.
   Funciona 100% offline y cuenta con sonido 'beep' y vibración háptica.
   ===================================================================== */
(function () {
  window.INV = window.INV || {};

  let audioCtx = null;
  function emitirBeep() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!audioCtx) audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1050, audioCtx.currentTime); // Tono agudo y limpio estilo POS
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.09);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.09);
    } catch (e) {}

    if (navigator.vibrate) {
      try { navigator.vibrate(60); } catch (e) {}
    }
  }

  /* ---------------- Detector Universal ---------------- */
  let detectorNativo = null;
  async function obtenerDetector() {
    if (detectorNativo !== null) return detectorNativo;
    if ('BarcodeDetector' in window) {
      try {
        const formatos = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'itf', 'codabar'];
        const soportados = await BarcodeDetector.getSupportedFormats();
        const aUsar = formatos.filter(f => soportados.includes(f));
        if (aUsar.length) {
          detectorNativo = new BarcodeDetector({ formats: aUsar });
          return detectorNativo;
        }
      } catch (e) {}
    }
    detectorNativo = false;
    return false;
  }

  /* Estado del escáner en pantalla */
  let streamActual = null;
  let animId = null;
  let ultimoEscaneado = '';
  let tiempoUltimoEscaneado = 0;

  function detenerCamara() {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    if (streamActual) {
      streamActual.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      streamActual = null;
    }
    const contenedor = document.getElementById('escaner-modal');
    if (contenedor) contenedor.remove();
  }

  /* =====================================================================
     API Principal: abrirModalEscaneo
     ===================================================================== */
  async function abrirModalEscaneo(opciones = {}) {
    const {
      titulo = 'Escanear código de barras o QR',
      descripcion = 'Apunta la cámara hacia el código del empaque o etiqueta.',
      modoContinuo = false,
      onScan = () => {},
      alCerrar = () => {}
    } = opciones;

    detenerCamara(); // Cerrar si había uno previo

    // Crear DOM del modal de escaneo
    const modalEl = document.createElement('div');
    modalEl.id = 'escaner-modal';
    modalEl.className = 'escaner-overlay';
    modalEl.innerHTML = `
      <div class="escaner-caja anim">
        <div class="escaner-cabecera">
          <div>
            <h3 class="escaner-titulo">${titulo}</h3>
            <p class="escaner-desc">${descripcion}</p>
          </div>
          <button type="button" class="btn btn--fantasma btn--chico escaner-btn-cerrar" aria-label="Cerrar">&#10005;</button>
        </div>

        <div class="escaner-visor-wrapper">
          <video id="escaner-video" class="escaner-video" autoplay playsinline muted></video>
          <canvas id="escaner-canvas" hidden></canvas>
          
          <div class="escaner-mira">
            <div class="escaner-esquinas"></div>
            <div class="escaner-laser"></div>
          </div>

          <div id="escaner-status-pill" class="escaner-pill" hidden></div>
        </div>

        <div class="escaner-acciones">
          <button type="button" class="btn btn--secundario btn--chico" id="escaner-btn-torch" hidden>
            🔦 Linterna
          </button>
          <button type="button" class="btn btn--secundario btn--chico" id="escaner-btn-flip" hidden>
            🔄 Cambiar cámara
          </button>
          ${modoContinuo ? `
            <label class="escaner-chk-continuo">
              <input type="checkbox" id="escaner-chk-cont" checked>
              <span>Escaneo continuo</span>
            </label>` : ''}
        </div>

        <div class="escaner-manual">
          <label for="escaner-manual-input">¿Código deteriorado? Escríbelo:</label>
          <div style="display:flex; gap:6px; margin-top:4px">
            <input type="text" id="escaner-manual-input" placeholder="Escribe el código y pulsa Enter" autocomplete="off">
            <button type="button" class="btn btn--primario btn--chico" id="escaner-btn-manual-ok">OK</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modalEl);

    const video = document.getElementById('escaner-video');
    const canvas = document.getElementById('escaner-canvas');
    const btnCerrar = modalEl.querySelector('.escaner-btn-cerrar');
    const btnTorch = document.getElementById('escaner-btn-torch');
    const btnFlip = document.getElementById('escaner-btn-flip');
    const statusPill = document.getElementById('escaner-status-pill');
    const inputManual = document.getElementById('escaner-manual-input');
    const btnManualOk = document.getElementById('escaner-btn-manual-ok');
    const chkContinuo = document.getElementById('escaner-chk-cont');

    let facingMode = 'environment';
    let torchEncendida = false;
    let trackVideo = null;

    const cerrar = () => {
      detenerCamara();
      if (typeof alCerrar === 'function') alCerrar();
    };

    btnCerrar.addEventListener('click', cerrar);
    modalEl.addEventListener('click', e => {
      if (e.target === modalEl) cerrar();
    });

    const procesarCodigo = (codigoCrudo) => {
      if (!codigoCrudo) return;
      const cod = String(codigoCrudo).trim();
      if (!cod) return;

      const ahora = Date.now();
      // Debounce si es el mismo código repetido en menos de 1.5s
      if (cod === ultimoEscaneado && (ahora - tiempoUltimoEscaneado) < 1500) {
        return;
      }
      ultimoEscaneado = cod;
      tiempoUltimoEscaneado = ahora;

      emitirBeep();

      if (statusPill) {
        statusPill.textContent = `✓ Leído: ${cod}`;
        statusPill.className = 'escaner-pill escaner-pill--exito';
        statusPill.hidden = false;
      }

      const continuar = chkContinuo ? chkContinuo.checked : modoContinuo;
      
      try {
        onScan(cod, {
          cerrar,
          mostrarMensaje: (msg, esError = false) => {
            if (!statusPill) return;
            statusPill.textContent = msg;
            statusPill.className = 'escaner-pill ' + (esError ? 'escaner-pill--error' : 'escaner-pill--exito');
            statusPill.hidden = false;
          }
        });
      } catch (err) {
        console.error('[Escaner] Error en callback onScan:', err);
      }

      if (!continuar) {
        setTimeout(cerrar, 250);
      }
    };

    // Envío manual
    const enviarManual = () => {
      const v = inputManual.value.trim();
      if (v) {
        procesarCodigo(v);
        inputManual.value = '';
      }
    };
    btnManualOk.addEventListener('click', enviarManual);
    inputManual.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        enviarManual();
      }
    });

    // Iniciar cámara
    async function iniciarStream() {
      if (streamActual) {
        streamActual.getTracks().forEach(t => t.stop());
      }

      const constraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      try {
        streamActual = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = streamActual;
        await video.play();

        trackVideo = streamActual.getVideoTracks()[0];
        if (trackVideo) {
          const cap = trackVideo.getCapabilities ? trackVideo.getCapabilities() : {};
          if (cap.torch) {
            btnTorch.hidden = false;
            btnTorch.onclick = async () => {
              torchEncendida = !torchEncendida;
              try {
                await trackVideo.applyConstraints({ advanced: [{ torch: torchEncendida }] });
                btnTorch.textContent = torchEncendida ? '🔦 Apagar linterna' : '🔦 Linterna';
              } catch (e) {}
            };
          }
        }

        // Botón flip si hay cámaras múltiples
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevs = devices.filter(d => d.kind === 'videoinput');
        if (videoDevs.length > 1) {
          btnFlip.hidden = false;
          btnFlip.onclick = () => {
            facingMode = facingMode === 'environment' ? 'user' : 'environment';
            iniciarStream();
          };
        }

        bucleEscaneo();
      } catch (err) {
        console.warn('[Escaner] No se pudo acceder a la cámara:', err);
        if (statusPill) {
          statusPill.textContent = 'No se pudo abrir la cámara. Puedes escribir el código abajo.';
          statusPill.className = 'escaner-pill escaner-pill--error';
          statusPill.hidden = false;
        }
      }
    }

    // Bucle de detección frame por frame
    const detector = await obtenerDetector();

    async function bucleEscaneo() {
      if (!streamActual || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animId = requestAnimationFrame(bucleEscaneo);
        return;
      }

      if (detector) {
        try {
          const barcodes = await detector.detect(video);
          if (barcodes && barcodes.length > 0) {
            const primero = barcodes[0];
            if (primero.rawValue) {
              procesarCodigo(primero.rawValue);
            }
          }
        } catch (e) {}
      }

      animId = requestAnimationFrame(bucleEscaneo);
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      iniciarStream();
    } else {
      if (statusPill) {
        statusPill.textContent = 'Este navegador no admite acceso a cámara. Usa el campo manual.';
        statusPill.className = 'escaner-pill escaner-pill--error';
        statusPill.hidden = false;
      }
    }
  }

  /* ---------------- Decodificación desde Imagen / Archivo ---------------- */
  async function leerDesdeImagen(archivo) {
    if (!archivo) throw new Error('No se ha proporcionado ninguna imagen.');
    if (archivo instanceof Blob && !archivo.type.startsWith('image/')) {
      throw new Error('El archivo seleccionado no es una imagen válida.');
    }

    const detector = await obtenerDetector();
    if (!detector) {
      // Si el navegador no soporta BarcodeDetector nativo
      throw new Error('Tu navegador no admite decodificación automática de imágenes. Puedes seleccionar la venta del menú desplegable o escanear con la cámara.');
    }

    // Función auxiliar para detectar en distintas escalas si la imagen es muy grande
    async function detectarEnImagen(imgSource) {
      try {
        const resultados = await detector.detect(imgSource);
        if (resultados && resultados.length > 0 && resultados[0].rawValue) {
          return resultados[0].rawValue;
        }
      } catch (e) {}
      return null;
    }

    // 1. Intentar directamente con ImageBitmap (más rápido y nativo)
    try {
      if (typeof createImageBitmap === 'function' && archivo instanceof Blob) {
        const bitmap = await createImageBitmap(archivo);
        const res = await detectarEnImagen(bitmap);
        if (res) {
          emitirBeep();
          return res;
        }
      }
    } catch (e) {}

    // 2. Intentar cargando como HTMLImageElement y dibujando en Canvas para normalizar
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
      lector.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('No se pudo procesar la imagen cargada.'));
        img.onload = async () => {
          // Intentar directo sobre el elemento img
          let res = await detectarEnImagen(img);
          if (res) {
            emitirBeep();
            return resolve(res);
          }

          // Intentar reescalando a un canvas intermedio (resolución óptima ~800-1200px)
          try {
            const canvas = document.createElement('canvas');
            const maxDim = 1200;
            let ancho = img.naturalWidth || img.width;
            let alto = img.naturalHeight || img.height;
            if (ancho > maxDim || alto > maxDim) {
              if (ancho > alto) {
                alto = Math.round((alto * maxDim) / ancho);
                ancho = maxDim;
              } else {
                ancho = Math.round((ancho * maxDim) / alto);
                alto = maxDim;
              }
            }
            canvas.width = ancho;
            canvas.height = alto;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, ancho, alto);

            res = await detectarEnImagen(canvas);
            if (res) {
              emitirBeep();
              return resolve(res);
            }
          } catch (err) {}

          reject(new Error('No se detectó ningún código QR en la imagen. Asegúrate de que el código esté nítido y bien iluminado.'));
        };
        img.src = lector.result;
      };
      lector.readAsDataURL(archivo);
    });
  }

  /* ---------------- Extracción de Identificador de Venta ---------------- */
  function extraerCodigoVenta(textoCrudo) {
    if (!textoCrudo) return '';
    const str = String(textoCrudo).trim();
    if (!str) return '';

    // Caso 1: URL con hash #/venta/ID (ej: http://.../#/venta/123)
    const matchUrl = str.match(/#\/venta\/([a-zA-Z0-9_\-\.]+)/i);
    if (matchUrl && matchUrl[1]) return decodeURIComponent(matchUrl[1].trim());

    // Caso 2: Resumen legible "VENTA FAC-0001 | Cliente | ..."
    const matchResumen = str.match(/^VENTA\s+([^\|\n\r]+)/i);
    if (matchResumen && matchResumen[1]) return matchResumen[1].trim();

    return str;
  }

  INV.escaner = {
    abrirModalEscaneo,
    emitirBeep,
    detenerCamara,
    leerDesdeImagen,
    extraerCodigoVenta
  };
})();
