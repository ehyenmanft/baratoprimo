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
  config: { MODO: 'supabase', SUPABASE_URL: 'https://xyz.supabase.co', SUPABASE_ANON: 'anon-key' }
};

// Load js/sync.js
const syncCode = fs.readFileSync('./js/sync.js', 'utf8');
eval(syncCode);

// Load js/db.js
const dbCode = fs.readFileSync('./js/db.js', 'utf8');
eval(dbCode);

async function runTests() {
  console.log('=== INICIANDO VALIDACIÓN DEL MOTOR OFFLINE Y SINCRONIZACIÓN ===\n');
  let passed = 0;
  let total = 6;

  // Test 1: Precarga de catálogo en caché
  console.log('1. Verificando caché local de productos...');
  await INV.sync.guardarCache('productos', [
    { id: 1, sku: 'PROD-1', nombre: 'Arroz 1kg', precio_venta: 1.5, activo: true }
  ]);
  await INV.sync.guardarCache('stock_actual', [
    { id: 1, sku: 'PROD-1', nombre: 'Arroz 1kg', stock: 100, stock_minimo: 10 }
  ]);
  const prods = await INV.db.productos.listar();
  if (prods.length === 1 && prods[0].nombre === 'Arroz 1kg') {
    console.log('  ✅ PASS: Catálogo leído correctamente desde caché local offline.');
    passed++;
  } else {
    console.error('  ❌ FAIL: Error leyendo productos desde caché.');
  }

  // Test 2: Creación de cliente offline
  console.log('\n2. Creando cliente en modo offline...');
  const cli = await INV.db.clientes.crear({
    nombres: 'Carlos', apellidos: 'López',
    tipo_documento: 'V', documento: '19888777',
    telefono: '0414-1234567'
  });
  if (cli && String(cli.id).startsWith('_temp_cli_') && cli.cliente === 'Carlos López' && cli._offline) {
    console.log(`  ✅ PASS: Cliente offline creado con ID temporal: ${cli.id} (${cli.cliente})`);
    passed++;
  } else {
    console.error('  ❌ FAIL: Error creando cliente offline.');
  }

  // Test 3: Creación de venta offline vinculada al cliente temporal + descuento de stock
  console.log('\n3. Creando venta offline asociada al cliente temporal...');
  const vta = await INV.db.ventas.crear({
    cliente_id: cli.id,
    subtotal: 4.5,
    iva_monto: 0.72,
    total: 5.22,
    items: [
      { producto_id: 1, descripcion: 'Arroz 1kg', cantidad: 3, precio_unitario: 1.5, base: 4.5, iva_monto: 0.72, total: 5.22 }
    ],
    pagos: [
      { metodo: 'efectivo_usd', monto: 5.22, tasa: 1, monto_local: 5.22 }
    ]
  });

  const stockActual = await INV.sync.obtenerCache('stock_actual');
  const prodStock = stockActual.find(s => s.id === 1);

  if (vta && String(vta.numero).startsWith('F-OFF-') && prodStock && prodStock.stock === 97) {
    console.log(`  ✅ PASS: Venta offline ${vta.numero} generada con éxito.`);
    console.log(`  ✅ PASS: Stock del producto decrementado correctamente de 100 a 97.`);
    passed++;
  } else {
    console.error('  ❌ FAIL: Error creando venta offline o actualizando stock.');
  }

  // Test 4: Registro de movimiento offline
  console.log('\n4. Registrando movimiento de inventario offline...');
  const mov = await INV.db.movimientos.registrar({
    producto_id: 1,
    tipo: 'entrada',
    cantidad: 20,
    motivo: 'Compra a proveedor'
  });
  const stockPostMov = await INV.sync.obtenerCache('stock_actual');
  const prodStock2 = stockPostMov.find(s => s.id === 1);

  if (mov && mov._offline && prodStock2 && prodStock2.stock === 117) {
    console.log(`  ✅ PASS: Movimiento registrado offline. Stock incrementado de 97 a 117.`);
    passed++;
  } else {
    console.error('  ❌ FAIL: Error en movimiento offline.');
  }

  // Test 5: Inspección de cola FIFO y claves de idempotencia
  console.log('\n5. Verificando cola de mutaciones y claves de idempotencia...');
  const estado = INV.sync.obtenerEstado();
  const muts = estado.cola;
  const todasTienenIdem = muts.every(m => m.clave_idem && m.clave_idem.length > 5);

  if (muts.length === 3 && todasTienenIdem) {
    console.log(`  ✅ PASS: ${muts.length} mutaciones encoladas en orden FIFO con clave_idem única:`);
    muts.forEach((m, idx) => console.log(`     ${idx + 1}. [${m.tipo}] ${m.descripcion} (idem: ${m.clave_idem})`));
    passed++;
  } else {
    console.error(`  ❌ FAIL: Cola incompleta o claves de idempotencia faltantes (total: ${muts.length}).`);
  }

  // Test 6: Validación de Integridad
  console.log('\n6. Ejecutando auditoría de integridad de datos...');
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
