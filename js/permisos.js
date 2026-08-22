/* =====================================================================
   Roles y permisos
   ---------------------------------------------------------------------
   Esta es la copia de cortesía: oculta lo que el operador no puede hacer
   para que la interfaz no mienta. La barrera de verdad son las políticas
   RLS del esquema, que se aplican aunque alguien llame a la API a mano.
   ===================================================================== */
(function () {

  const ROLES = [
    {
      id: 'super_admin',
      etiqueta: 'Super administrador',
      descripcion: 'Crea y elimina comercios, asigna operadores a cualquiera y cambia de comercio. Nadie más puede modificarlo.',
      permisos: ['*'],
    },
    {
      id: 'administrador',
      etiqueta: 'Administrador',
      descripcion: 'Todas las funciones de su comercio: ajustes, operadores y anulación de ventas.',
      permisos: ['inventario.ver', 'productos.crear', 'productos.editar', 'productos.eliminar',
                 'movimientos.registrar', 'ventas.emitir', 'ventas.anular',
                 'clientes.gestionar', 'graficas.ver',
                 'ajustes.comercio', 'operadores.gestionar'],
    },
    {
      id: 'operador_inventario',
      etiqueta: 'Operador de inventario',
      descripcion: 'Almacén completo: productos, entradas, salidas y ajustes. No factura.',
      permisos: ['inventario.ver', 'productos.crear', 'productos.editar', 'productos.eliminar',
                 'movimientos.registrar', 'graficas.ver'],
    },
    {
      id: 'operador_facturador',
      etiqueta: 'Operador facturador',
      descripcion: 'Ventas y clientes. Ve el catálogo pero no lo modifica.',
      permisos: ['inventario.ver', 'ventas.emitir', 'clientes.gestionar', 'graficas.ver'],
    },
    {
      id: 'operador_mixto',
      etiqueta: 'Operador mixto',
      descripcion: 'Inventario y facturación, salvo dar de baja productos.',
      permisos: ['inventario.ver', 'productos.crear', 'productos.editar',
                 'movimientos.registrar', 'ventas.emitir', 'clientes.gestionar', 'graficas.ver'],
    },
  ];

  /* 'ventas.anular' no aparece en ninguna lista salvo la del administrador
     (que tiene '*'), así que ningún otro rol lo obtiene. */

  /* Qué vistas puede abrir cada permiso. Lo usa el menú y el enrutador. */
  const VISTAS = {
    inicio:      'inventario.ver',
    productos:   'inventario.ver',
    producto:    'inventario.ver',
    movimientos: 'inventario.ver',
    kardex:      'inventario.ver',
    graficas:    'graficas.ver',
    ventas:      'ventas.emitir',
    venta:       'ventas.emitir',
    clientes:    'clientes.gestionar',
    cliente:     'clientes.gestionar',
    comercio:    'ajustes.comercio',
    operadores:  'operadores.gestionar',
    comercios:   'comercios.gestionar',
  };

  /* Solo el super administrador crea otros super administradores, y solo
     él puede tocar la ficha de uno. */
  const puedeGestionarA = operador =>
    operador.rol !== 'super_admin' || rolActual === 'super_admin';

  /* Operador que entró pero no está registrado en la tabla: la base le
     va a negar todo, así que la interfaz no debe prometerle nada. */
  const SIN_ACCESO = {
    id: 'sin_acceso',
    etiqueta: 'Sin permisos',
    descripcion: 'La cuenta no está registrada como operador.',
    permisos: [],
  };

  let rolActual = 'administrador';

  const definicion = id =>
    id === SIN_ACCESO.id ? SIN_ACCESO : (ROLES.find(r => r.id === id) || ROLES[0]);

  function fijarRol(id) {
    rolActual = definicion(id).id;
  }

  function rol() { return rolActual; }

  function puede(permiso) {
    const d = definicion(rolActual);
    return d.permisos.includes('*') || d.permisos.includes(permiso);
  }

  function puedeVer(vista) {
    const necesario = VISTAS[vista];
    return !necesario || puede(necesario);
  }

  /* Filtra una lista de acciones dejando solo las permitidas. Cada acción
     puede declarar `permiso`; las que no declaran nada pasan siempre. */
  const filtrar = acciones =>
    (acciones || []).filter(a => !a.permiso || puede(a.permiso));

  /* Roles que este operador puede asignar a otro. */
  const rolesAsignables = () =>
    rolActual === 'super_admin' ? ROLES : ROLES.filter(r => r.id !== 'super_admin');

  INV.permisos = { ROLES, VISTAS, SIN_ACCESO, fijarRol, rol, puede, puedeVer,
                   filtrar, definicion, puedeGestionarA, rolesAsignables };
})();
