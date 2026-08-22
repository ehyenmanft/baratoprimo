# BaratoPrimo — gestión de inventario y facturación

HTML, CSS y JS puros.

Sin compilación, sin Node, sin dependencias instaladas. Se abre con doble clic
para validar, y se sube por FTP para producción.

## Puesta en producción

Está en `PUESTA-EN-MARCHA.md`: ocho pasos, del editor SQL de Supabase hasta la
primera factura. La página `verificar.html` comprueba la instalación antes de
abrir la aplicación y dice qué falta si algo no está.

## Validación local

Abre `index.html` con doble clic. Arranca en **modo demo**: seis productos y
trece movimientos de ejemplo, ya cargados. En la pantalla de acceso el usuario
y la contraseña vienen rellenados — pulsa Entrar y listo. No hace falta
Supabase, ni servidor, ni conexión (solo las tipografías se bajan de internet;
sin conexión se ven con la fuente del sistema).

Todo lo que registres se guarda en el navegador. El botón *Restaurar datos de
ejemplo* devuelve el juego original cuando quieras empezar de cero.

El modo demo no es una maqueta con datos falsos pegados: `js/datos-demo.js`
replica en JavaScript las vistas `stock_actual`, `alertas_stock` y `kardex`, y
también el trigger que bloquea el stock negativo. Lo que veas aquí es lo que
hará la base real.

## Pasar a producción

1. Corre `inventario_schema.sql` en el SQL Editor de Supabase. Incluye el
   inventario y el módulo comercial (clientes, ventas y la función
   `registrar_venta`).
2. En Authentication → Users, crea tu usuario con correo y contraseña.
3. En Storage, crea un bucket `inventario` y márcalo como público — es donde
   van las imágenes de producto.
4. En `js/config.js`: pon `MODO: 'supabase'` y llena URL y llave `anon`.
5. Sube todo por FTP a la carpeta pública de Smartape.

La llave `anon` queda visible en el navegador y eso está bien: quien la tenga
solo puede hacer lo que las políticas RLS permitan, y esas exigen sesión
iniciada. Lo que nunca debe salir del servidor es la llave `service_role`.

`config.js` fuerza el modo demo si detecta que la página se abrió como archivo
local, porque Supabase necesita `http` para autenticar.

## Estructura

```
index.html          Shell: acceso + aplicación. Los scripts se cargan en orden.
css/app.css         Sistema visual completo
js/config.js        ← lo único que editas: credenciales y datos del negocio
js/datos-demo.js    Adaptador en memoria + generador de 4 meses de actividad
js/db.js            Elige adaptador; misma API para ambos
js/ui.js            Modal, avisos, formato, medidor, exportación CSV
js/periodos.js      Agrupación temporal: diario, interdiario, semanal, quincenal, mensual
js/graficos.js      Gráficas SVG propias, sin librerías
js/views/           Una vista por pantalla (inicio, productos, producto, movimientos, graficas, kardex)
js/app.js           Sesión, enrutador por hash con parámetros (#/producto/3), alertas
```

## Pantallas

- **Inicio** — el puesto de trabajo: cuatro cifras, una sola gráfica (el flujo
  de 30 días) y, debajo, lo que se usa a diario: las existencias que exigen
  atención y los últimos movimientos, con sus botones de carga y registro. Un
  botón lleva a la pantalla completa de gráficas.
- **Ficha de producto** — se abre al pulsar cualquier micro tarjeta, en Inicio,
  en Productos o en el detalle de Movimientos. Reúne stock, mínimo, costo,
  precio, margen, valor en almacén, salidas del último mes y cobertura estimada
  en días; más la curva de saldo, el nivel contra el mínimo y los últimos
  movimientos. Desde ahí se edita el producto, se registran entrada, salida y
  ajuste con el artículo ya preseleccionado, y se salta a su kardex o a sus
  movimientos filtrados.
- **Movimientos** — reporte por periodo con cinco granularidades (diario,
  interdiario, semanal, quincenal, mensual), rango en chips o fechas manuales y
  filtros por tipo y producto. Resumen agrupado arriba, detalle uno a uno abajo,
  cada uno exportable. Acepta `#/movimientos/ID` para abrirse ya filtrada.
- **Productos** — catálogo y existencias juntos, ordenados por urgencia:
  primero lo que está sin stock, luego lo que está bajo el mínimo.
- **Gráficas** — todo el análisis: flujo, venta estimada y compras por periodo,
  ranking por unidades y por ingreso, valor por categoría y capital detenido en
  productos sin rotación. Rango y granularidad independientes.
- **Comercio** — los datos del emisor: razón social, RIF, dirección, teléfono,
  mensaje de cierre, IVA y tasas por defecto y formato de impresión. Es lo que
  encabeza cada factura y cada ticket, con vista previa en vivo. Solo el
  administrador puede cambiarlo.
- **Operadores** — alta de usuarios y asignación de rol, con la tabla de lo que
  puede cada uno. No deja eliminar al último administrador activo.
- **Kardex** — historial de un producto con su curva de saldo. Acepta
  `#/kardex/ID`.
- **Clientes** — cartera con documento fiscal partido en prefijo (V, E, J, G, P)
  y número, contacto y dirección. Cada cliente abre su ficha con el histórico de
  compras y los acumulados de facturación e IVA.
- **Ventas** — listado de comprobantes emitidos y elaboración de nuevos. Se elige
  el cliente, se agregan productos con su precio de catálogo (ajustable por
  renglón), se fija la tasa de IVA y se emite. Cada comprobante se abre en
  `#/venta/ID`, se imprime con un botón y lleva su código QR.

Al cargar un producto puedes indicar existencia inicial: entra como movimiento
de entrada, no como un campo suelto, para que el kardex cuadre desde el día uno.

Nada usa `import`/`export`: son scripts clásicos que cuelgan de un espacio de
nombres `INV`. Es la razón por la que el doble clic funciona — el navegador
bloquea los módulos ES bajo `file://` por política de origen.

## Comercios

Una instalación puede llevar varios comercios y **sus datos no se cruzan**: cada
uno tiene su catálogo, su kardex, su cartera de clientes y su numeración de
comprobantes. Dos comercios pueden usar el mismo código de producto o tener al
mismo cliente sin estorbarse, y cada uno empieza a facturar en F-000001.

El aislamiento no depende de que la aplicación filtre bien: cada tabla lleva su
`comercio_id` y las políticas RLS exigen que coincida con el comercio del
operador en sesión. Aunque alguien llame a la API a mano con el identificador de
una fila ajena, no la ve ni la toca.

## Roles

| Rol | Inventario | Dar de baja | Facturar | Anular | Operadores | Comercios |
|---|---|---|---|---|---|---|
| Super administrador | Sí | Sí | Sí | Sí | Sí | Sí |
| Administrador | Sí | Sí | Sí | Sí | Sí | No |
| Operador de inventario | Sí | Sí | No | No | No | No |
| Operador facturador | Solo lectura | No | Sí | No | No | No |
| Operador mixto | Sí | **No** | Sí | No | No | No |

El **super administrador no pertenece a ningún comercio: los supervisa todos.**
Crea y elimina comercios, asigna operadores a cualquiera de ellos y entra a
cualquiera cuando lo necesita. El selector del menú dice *Viendo* en vez de
*Comercio*, e incluye la opción **Ninguno · solo supervisión**, que es su estado
natural: conserva todas sus facultades sin estar dentro de ninguna operación.
Nadie por debajo puede ver su ficha, modificarla, eliminarla ni nombrar a otro.

Los demás roles sí pertenecen a un comercio y es obligatorio asignárselo: solo
verán ese.

La interfaz oculta lo que el rol no puede hacer, pero eso es cortesía, no
seguridad: la barrera real son las políticas RLS del esquema, que se aplican
aunque alguien llame a la API a mano. La restricción del operador mixto va en un
trigger, porque dar de baja un producto es un `update` de la columna `activo` y
no un `delete`.

Tras cargar el esquema, registra tu primer administrador o quedarás sin permisos:

```sql
insert into operadores (correo, nombre, rol)
values ('tu@correo.com', 'Tu nombre', 'administrador');
```

## Compartir comprobantes

El botón Compartir del comprobante ofrece WhatsApp, Telegram y copiar al
portapapeles. El mensaje va como texto plano legible —comercio, número, cliente,
renglones, totales y formas de pago— más el enlace al comprobante cuando la app
está publicada. Si el cliente tiene teléfono registrado, el enlace de WhatsApp
abre directamente su chat: el número se normaliza a formato internacional
(0414… se convierte en 58414…).

## Los tres modos de funcionamiento

`MODO`, en `js/config.js`, decide dónde viven los datos:

- **`demo`** — en el navegador. Doble clic en `index.html` y listo.
- **`drive`** — un archivo JSON dentro de tu Google Drive. Necesita un ID de
  cliente OAuth de Google Cloud (tipo "aplicación web", con tu dominio en los
  orígenes autorizados) puesto en `GOOGLE.CLIENT_ID`, y que la app esté servida
  por https: Google no autoriza el origen `file://`. El permiso que se pide es
  `drive.file`, que solo da acceso al archivo que la propia app crea, no al
  resto de tu Drive. Sirve para un negocio con un operador a la vez: se guarda
  el archivo entero en cada cambio y manda quien escribe de último. Los roles
  existen, pero sin base de datos detrás son solo la capa de la interfaz.
- **`supabase`** — PostgreSQL completo, con los permisos aplicados en el
  servidor. Es el único modo donde los roles son una barrera real.

## Cómo funcionan las ventas

- **La tasa de IVA se aplica renglón por renglón**, no sobre el total, para que
  el desglose cuadre al céntimo con lo que ve el cliente. El comprobante muestra
  la escalera completa: subtotal de los productos, IVA y total a pagar.
- **Dos modos de precio.** Por defecto el IVA se suma al precio de catálogo. El
  interruptor *el precio ya incluye IVA* hace lo contrario: desglosa el impuesto
  hacia atrás (base = precio ÷ 1,16) y el total queda igual al precio de lista.
  Elige el que corresponda a cómo tienes cargados los precios.
- **Una venta descuenta inventario.** Cada renglón genera un movimiento de salida
  con la referencia del comprobante, así que aparece en el kardex y en los
  reportes por periodo. Si falta stock, la venta se rechaza entera: en Supabase
  con la función `registrar_venta()` dentro de una transacción, y en modo demo
  validando todo antes de escribir.
- **Un comprobante emitido no se edita ni se borra: se anula.** Solo el
  administrador puede hacerlo. El diálogo pide uno de seis motivos —error de
  facturación, devolución, pago rechazado, no entregada, duplicada u otro con
  explicación obligatoria— y exige teclear el número del comprobante, para que
  nadie anule el equivocado por inercia. La venta queda archivada y marcada, con
  su motivo, su fecha y quién la anuló; los productos vuelven al inventario como
  entradas referenciadas al comprobante, así que el kardex cuenta la historia
  completa. Una venta anulada deja de contar como facturación y como IVA por
  declarar, tanto en el listado como en el histórico del cliente. No se puede
  anular dos veces.
- **Formas de pago.** Una venta admite varias a la vez: débito, efectivo en
  bolívares, en dólares o en euros, pago móvil, transferencia y "otro" con su
  descripción. Débito, pago móvil y transferencia piden los últimos 6 dígitos de
  la operación; los pagos en divisa piden la tasa del día y guardan monto,
  moneda, tasa y equivalente en bolívares por separado, para que el comprobante
  cuadre aunque la tasa cambie mañana. La pantalla muestra en vivo lo pagado y lo
  que falta por cobrar o el vuelto a entregar. Las tasas por defecto están en
  `TASAS`, dentro de `js/config.js`.
- **Emitir pide confirmación.** El botón abre un resumen con el cliente, los
  renglones, los totales y las formas de pago antes de escribir nada; hasta que
  no se confirma no se toca el inventario. Se puede emitir con saldo pendiente:
  queda registrado como tal en la venta y en el ticket.
- **Ventas a crédito.** El método *Crédito* no registra dinero recibido sino lo
  que queda financiado: se indica la inicial que el cliente cancela hoy, la tasa
  de referencia, cuántas cuotas y cada cuánto. El sistema reparte el saldo entre
  las cuotas **en dólares** —el redondeo sobrante va a la última, para que la
  suma cuadre al céntimo— y guarda con la venta su valor referencial en divisa.
  Esa es la razón de expresarlas así: la deuda no se licúa si el bolívar se
  mueve, y al cobrar se convierte a la tasa del día. El plan aparece en el
  comprobante, en el ticket y en el mensaje que se comparte.
- **El reparto es un mínimo, no una cifra cerrada.** Saldo ÷ número de cuotas es
  lo que hay que abonar como poco en cada vencimiento. Por debajo se rechaza el
  cobro; por encima, el excedente adelanta las cuotas siguientes: cancela las que
  cubra entera y rebaja el mínimo de la primera que quede a medias. El diálogo de
  cobro dice en vivo qué va a pasar con lo que se abona, y el pago registrado
  deja constancia de qué cuotas adelantó.
- **En una venta a crédito el pendiente se mide en dólares.** El saldo en
  bolívares no sirve de referencia: la deuda está en divisa y cada abono entra a
  la tasa de su día, así que puede quedar por encima o por debajo del total
  original sin que nadie deba nada. El comprobante y el ticket muestran lo que
  falta como cuotas pendientes en USD.
- **Panel de cobranza.** Inicio muestra los clientes con cuotas por cobrar, con
  su documento, teléfono, comprobante, qué cuota toca, cuándo vence y los días de
  atraso, más la métrica del total pendiente en dólares. Desde ahí se registra el
  abono: se propone el monto a la tasa de hoy, se elige la forma de cobro y el
  pago entra en la misma tabla que el resto, así que el saldo de la venta baja
  solo. Anular una venta retira sus cuotas de la cobranza.
- **La impresión sale en formato ticket.** El botón Imprimir del comprobante
  arma un ticket aparte de la pantalla y oculta todo lo demás: sale solo esa
  venta, no la aplicación alrededor. Tres formatos en el propio comprobante —
  rollo térmico de 58 mm, de 80 mm, o página completa con el recibo centrado — y
  el elegido se recuerda. El tamaño de papel se aplica reescribiendo la regla
  `@page` antes de imprimir, que es la única forma de cambiarlo desde JavaScript.
  Los datos del negocio que encabezan el ticket (nombre, RIF, dirección,
  teléfono y mensaje de cierre) están en `NEGOCIO`, dentro de `js/config.js`.
- **El QR se genera en el navegador** con un codificador propio (`js/qr.js`), sin
  librerías ni conexión. Servida por http, apunta a `#/venta/ID`: al escanearlo
  se abre ese comprobante. Abierta como archivo local no hay dirección que
  compartir, así que el QR lleva el resumen legible de la venta (número, cliente,
  documento, fecha y totales).

## Si vienes de una versión anterior

El modo demo detecta los datos guardados por versiones previas y completa las
colecciones que faltan (clientes, ventas) sin tocar los productos y movimientos
que ya habías registrado. Si prefieres empezar limpio, el botón *Restaurar datos
de ejemplo* rehace todo.

## Detalles de comportamiento

- **El stock no se edita.** Se registra una entrada, una salida o un ajuste, y
  el saldo sale de la suma. Un error se corrige con un ajuste inverso.
- **Stock negativo bloqueado**, tanto en el trigger de Postgres como en el
  adaptador demo. El mensaje llega tal cual al formulario.
- **Alertas en vivo**: la banda superior consulta las alertas en cada
  navegación; no hay tarea programada que mantener.
- **CSV con punto y coma y BOM**, que es lo que Excel en español abre bien.
- **Gráficas sin dependencias**: SVG generado en el navegador, hereda la paleta
  desde las variables CSS y funciona sin conexión.
- **Responsive**: en móvil la barra lateral pasa a fila superior deslizable y
  cada micro tarjeta reorganiza sus columnas en vez de desbordarse.
- **Tema claro y oscuro**: el interruptor está al pie del menú. Si nunca lo has
  tocado, sigue la preferencia del sistema; después manda tu elección, que se
  guarda en el navegador. Un script en el `<head>` aplica el tema antes del
  primer pintado para que no haya destello blanco al abrir en oscuro.
- **Imágenes de producto**: se eligen desde el formulario y se reducen en el
  navegador a 480 px antes de guardar, porque una foto de teléfono son varios MB
  y aquí basta una miniatura. En modo demo se guardan como data URL; en
  producción se suben al bucket `inventario` de Supabase como JPG. Los productos
  sin foto muestran sus iniciales.
- **Animación discreta**: las tarjetas entran escalonadas, las barras crecen
  desde su eje y la línea de saldo se traza al aparecer. Todo se desactiva
  automáticamente si el sistema pide movimiento reducido.

## Si el hosting no sirve bien los .js

Con scripts clásicos casi nunca pasa. Si Smartape corre IIS y algo falla,
agrega un `web.config` en la raíz declarando el mime type de `.js`.
