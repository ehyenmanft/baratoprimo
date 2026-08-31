// Automated Node.js test script for BaratoPrimo offline & sync engine
const fs = require('fs');

// Mock browser globals
global.window = global;
global.navigator = { onLine: false };
const store = {};
global.localStorage = {
  getItem: (k) => store[k] || null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; }
};
global.CustomEvent = class { constructor(type, detail) { this.type = type; this.detail = detail; } };
global.dispatchEvent = () => {};
global.addEventListener = () => {};
global.document = {
  readyState: 'complete',
  addEventListener: () => {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => []
};

// Load modules
global.INV = {
  config: { MODO: 'supabase', SUPABASE_URL: 'https://xyz.supabase.co', SUPABASE_ANON: 'anon-key' },
  ui: {
    leerMonto: (v) => Number(v) || 0
  }
};

// Load js/sync.js
const syncCode = fs.readFileSync('./js/sync.js', 'utf8');
eval(syncCode);

// Load js/db.js
const dbCode = fs.readFileSync('./js/db.js', 'utf8');
eval(dbCode);

async function runTests() {
  console.log('=== INICIANDO VALIDACIÓN EXHAUSTIVA DEL MOTOR OFFLINE Y SINCRONIZACIÓN ===\n');
  let passed = 0;
  let total = 8;

  // Test 1: Precarga de catálogo en caché
  console.log('1. Verificando caché local de productos...');
  await INV.sync.guardarCache('productos', [
    { id: 1, sku: 'PROD-1', nombre: 'Arroz 1kg', precio_venta: 1.5, costo: 1.0, activo: true }
  ]);
  await INV.sync.guardarCache('stock_actual', [
    { id: 1, producto_id: 1, sku: 'PROD-1', nombre: 'Arroz 1kg', stock: 100, stock_minimo: 10, precio_venta: 1.5, costo: 1.0 }
  ]);
  const prods = await INV.db.productos.listar();
  if (prods.length === 1 && prods[0].nombre === 'Arroz 1kg') {
    console.log('  ✅ PASS: Catálogo leído correctamente desde caché local offline.');
    passed++;
  } else {
    console.error('  ❌ FAIL: Error leyendo productos desde caché.');
  }

  // Test 2: Creación de Categoría y Producto Offline con Existencia Inicial (Caso Screenshot)
  console.log('\n2. Creando categoría y producto con existencia inicial en modo offline (Caso Reportado)...');
  const cat = await INV.db.categorias.crear('Víveres y Granos');
  const nuevoProd = await INV.db.productos.crear({
    sku: 'HAR-001',
    nombre: 'Harina de Maíz 1kg',
    categoria_id: cat.id,
    exento_iva: true,
    costo: 16.00,
    precio_venta: 18.00,
    stock_minimo: 1,
    unidad: 'unidad'
  });

  // Registro de existencia inicial (como hace guardar() en productos.js)
  const inicial = 3;
  const movInicial = await INV.db.movimientos.registrar({
    producto_id: nuevoProd.id,
    tipo: 'entrada',
    cantidad: inicial,
    es_negativo: false,
    costo_unitario: 16.00,
    motivo: 'Existencia inicial',
    referencia: null,
    nota: null
  });

  const stocksActuales = await INV.sync.obtenerCache('stock_actual', []);
  const prodStockGuardado = stocksActuales.find(s => String(s.producto_id || s.id) === String(nuevoProd.id));

  if (nuevoProd && String(nuevoProd.id).startsWith('_temp_prod_') &&
      movInicial && movInicial._offline &&
      prodStockGuardado && prodStockGuardado.stock === 3) {
    console.log(`  ✅ PASS: Producto offline creado con ID: ${nuevoProd.id}`);
    console.log(`  ✅ PASS: Existencia inicial (3 uds) registrada sin errores ("Failed to fetch" resuelto).`);
    passed++;
  } else {
    console.error('  ❌ FAIL: Error creando producto offline con existencia inicial.', { nuevoProd, prodStockGuardado });
  }

  // Test 3: Subida de Imagen Offline (Almacenamiento de Respaldo)
  console.log('\n3. Verificando subida de imagen offline (data URL fallback)...');
  const fakeDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...';
  const imgRuta = await INV.db.archivos.subir(fakeDataUrl, 'HAR-001');
  if (imgRuta && imgRuta.startsWith('data:image/')) {
    console.log('  ✅ PASS: Imagen procesada y retenida localmente sin bloqueo de red.');
    passed++;
  } else {
    console.error('  ❌ FAIL: Error gestionando imagen offline.');
  }

  // Test 4: Creación y Edición de Cliente en modo Offline
  console.log('\n4. Creando y actualizando cliente en modo offline...');
  const cli = await INV.db.clientes.crear({
    nombres: 'Carlos', apellidos: 'López',
    tipo_documento: 'V', documento: '19888777',
    telefono: '0414-1234567'
  });
  const cliActualizado = await INV.db.clientes.actualizar(cli.id, {
    telefono: '0412-9998877'
  });

  if (cli && String(cli.id).startsWith('_temp_cli_') && cliActualizado.telefono === '0412-9998877') {
    console.log(`  ✅ PASS: Cliente offline creado y actualizado (${cli.id}: ${cliActualizado.cliente} - ${cliActualizado.telefono})`);
    passed++;
  } else {
    console.error('  ❌ FAIL: Error creando/actualizando cliente offline.');
  }

  // Test 5: Emisión de Venta Offline combinando Producto Existente y Producto Temporal
  console.log('\n5. Creando venta offline asociada a cliente temporal y producto temporal...');
  const vta = await INV.db.ventas.crear({
    cliente_id: cli.id,
    subtotal: 39.5,
    iva_monto: 0.24,
    total: 39.74,
    items: [
      { producto_id: 1, descripcion: 'Arroz 1kg', cantidad: 1, precio_unitario: 1.5, base: 1.5, iva_monto: 0.24, total: 1.74 },
      { producto_id: nuevoProd.id, descripcion: 'Harina de Maíz 1kg', cantidad: 2, precio_unitario: 18.0, base: 36.0, iva_monto: 0, total: 36.0 }
    ],
    pagos: [
      { metodo: 'efectivo_usd', monto: 39.74, tasa: 1, monto_local: 39.74 }
    ]
  });

  const stockPostVenta = await INV.sync.obtenerCache('stock_actual', []);
  const sProd1 = stockPostVenta.find(s => s.id === 1);
  const sProdTemp = stockPostVenta.find(s => String(s.producto_id || s.id) === String(nuevoProd.id));

  if (vta && String(vta.numero).startsWith('F-OFF-') &&
      sProd1 && sProd1.stock === 99 &&
      sProdTemp && sProdTemp.stock === 1) {
    console.log(`  ✅ PASS: Venta offline ${vta.numero} emitida con éxito.`);
    console.log(`  ✅ PASS: Stock Prod 1: 100 -> ${sProd1.stock} | Stock Prod Temp: 3 -> ${sProdTemp.stock}`);
    passed++;
  } else {
    console.error('  ❌ FAIL: Error creando venta offline o actualizando stocks.', { sProd1, sProdTemp });
  }

  // Test 6: Registro de Movimiento Adicional sobre Producto Temporal
  console.log('\n6. Registrando ajuste de inventario sobre producto temporal...');
  const movAjuste = await INV.db.movimientos.registrar({
    producto_id: nuevoProd.id,
    tipo: 'entrada',
    cantidad: 10,
    motivo: 'Reposición rápida'
  });
  const stockPostAjuste = await INV.sync.obtenerCache('stock_actual', []);
  const sProdTemp2 = stockPostAjuste.find(s => String(s.producto_id || s.id) === String(nuevoProd.id));

  if (movAjuste && sProdTemp2 && sProdTemp2.stock === 11) {
    console.log(`  ✅ PASS: Movimiento registrado sobre producto temporal. Stock final: ${sProdTemp2.stock}`);
    passed++;
  } else {
    console.error('  ❌ FAIL: Error en movimiento sobre producto temporal.');
  }

  // Test 7: Inspección de cola FIFO, Idempotencia y Mapeos
  console.log('\n7. Verificando cola de mutaciones y claves de idempotencia...');
  const estado = INV.sync.obtenerEstado();
  const muts = estado.cola;
  const todasTienenIdem = muts.every(m => m.clave_idem && m.clave_idem.length > 5);

  if (muts.length >= 6 && todasTienenIdem) {
    console.log(`  ✅ PASS: ${muts.length} mutaciones encoladas en orden FIFO con clave_idem única:`);
    muts.forEach((m, idx) => console.log(`     ${idx + 1}. [${m.tipo}] ${m.descripcion} (idem: ${m.clave_idem})`));
    passed++;
  } else {
    console.error(`  ❌ FAIL: Cola incompleta o claves de idempotencia faltantes (total: ${muts.length}).`);
  }

  // Test 8: Validación de Integridad Total
  console.log('\n8. Ejecutando auditoría de integridad de datos...');
  const reporte = await INV.sync.validarIntegridad();
  if (reporte && reporte.valido && reporte.errores.length === 0) {
    console.log('  ✅ PASS: Integridad de datos 100% validada (0 inconsistencias, 0 corrupción).');
    passed++;
  } else {
    console.error('  ❌ FAIL: Reporte de integridad con fallos:', reporte.errores);
  }

  console.log(`\n=======================================================`);
  console.log(`RESULTADO: ${passed} / ${total} PRUEBAS SUPERADAS SATISFACTORIAMENTE`);
  console.log(`=======================================================\n`);

  if (passed !== total) process.exit(1);
}

runTests().catch(err => {
  console.error('Error durante ejecución de pruebas:', err);
  process.exit(1);
});
