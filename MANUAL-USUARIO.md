# 📘 Manual de Usuario Oficial — BaratoPrimo

> **Sistema de Inventario, Facturación Comercial, Control de Créditos y Cuadre de Caja**  
> Diseñado para el comercio ágil y la realidad operativa venezolana.

---

## 📑 Tabla de Contenidos

1. [Introducción, Acceso y Recuperación de Contraseña](#1-introducción-acceso-y-recuperación-de-contraseña)
2. [Roles y Permisos del Negocio](#2-roles-y-permisos-del-negocio)
3. [Tasa Oficial del BCV y Fecha Valor](#3-tasa-oficial-del-bcv-y-fecha-valor)
4. [Pantalla de Inicio (Tablero Operativo)](#4-pantalla-de-inicio-tablero-operativo)
5. [Módulo de Ventas y Facturación (Punto de Venta)](#5-módulo-de-ventas-y-facturación-punto-de-venta)
6. [Ventas a Crédito y Gestión de Cobranzas](#6-ventas-a-crédito-y-gestión-de-cobranzas)
7. [Cartera de Clientes y Búsqueda por Documento (RIF / Cédula)](#7-cartera-de-clientes-y-búsqueda-por-documento-rif--cédula)
8. [Catálogo de Productos e Inventario](#8-catálogo-de-productos-e-inventario)
9. [Movimientos de Almacén y Kardex Inmutable](#9-movimientos-de-almacén-y-kardex-inmutable)
10. [Gráficas y Análisis del Rendimiento Comercial](#10-gráficas-y-análisis-del-rendimiento-comercial)
11. [Cuadre de Caja y Arqueo al Cierre de Turno](#11-cuadre-de-caja-y-arqueo-al-cierre-de-turno)
12. [Configuración de Mi Comercio y Personal](#12-configuración-de-mi-comercio-y-personal)
13. [Preguntas Frecuentes y Buenas Prácticas](#13-preguntas-frecuentes-y-buenas-prácticas)

---

## 1. Introducción, Acceso y Recuperación de Contraseña

BaratoPrimo es una aplicación web progresiva diseñada para funcionar en computadoras fijas de mostrador, laptops, tabletas táctiles y teléfonos inteligentes sin requerir instalaciones complejas.

### Iniciar Sesión
1. Abre el enlace de tu comercio en tu navegador web.
2. Ingresa tu **correo electrónico** y tu **contraseña**.
3. Si deseas comprobar la clave escrita, haz clic en el icono del **ojo** para revelarla.
4. Presiona el botón **"Entrar"**.

### Solicitud de Registro de Nuevo Operador
Si eres un nuevo cajero o empleado:
1. Haz clic en la pestaña superior **"Crear cuenta"**.
2. Escribe tu nombre, apellido, correo corporativo y contraseña deseada.
3. Especifica la sucursal o comercio al que perteneces y el rol solicitado.
4. Presiona **"Solicitar cuenta"**. Un administrador autorizará tu acceso.

### Recuperación de Contraseña
Si no recuerdas tu clave de acceso:
1. Haz clic en el enlace **"¿Olvidaste tu contraseña?"**.
2. Escribe tu correo electrónico registrado.
3. Recibirás un correo con un enlace seguro para crear tu nueva contraseña y entrar al sistema.

---

## 2. Roles y Permisos del Negocio

Para resguardar el dinero y los inventarios, cada usuario tiene asignado un rol específico:

| Rol | Inventario | Modificar Stock / Bajas | Facturar / Cobrar | Anular Facturas | Cuadre de Caja | Gestionar Personal |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Super Administrador** | Total (Todas) | Sí | Sí | Sí | Global y por operador | Total |
| **Administrador de Tienda** | Total (Su tienda) | Sí | Sí | Sí | Auditoría y propio | Operadores de su tienda |
| **Operador Facturador** | Solo consulta | No | Sí | No | Solo su turno | No |
| **Operador de Inventario** | Total | Sí | No | No | No | No |
| **Operador Mixto** | Total | Solo Entradas/Ajustes | Sí | No | Solo su turno | No |

> **Aislamiento Multi-tienda:** Si tu empresa tiene varias sucursales, cada una maneja sus propios clientes, existencias y correlativos de facturación (F-000001) de manera totalmente independiente.

---

## 3. Tasa Oficial del BCV y Fecha Valor

El sistema actualiza de forma automática la tasa oficial del Banco Central de Venezuela (BCV) en dos momentos del día: a las **8:30 am** y a las **2:30 pm**.

* **Cintillo en la barra superior:** Muestra siempre el valor actual del dólar y del euro en bolívares.
* **Fecha Valor:** El BCV publica por la tarde la tasa que regirá legalmente el siguiente día hábil. BaratoPrimo respeta esta fecha para que factures con el valor fiscal correcto.
* **Histórico Cambiario:** Cada factura guarda permanentemente la tasa con la que fue emitida, permitiendo explicar cuentas y reclamos pasados con total exactitud.

---

## 4. Pantalla de Inicio (Tablero Operativo)

Al ingresar al sistema, la pantalla de **Inicio** presenta un resumen ejecutivo en tiempo real:

1. **Indicadores Rápidos (KPIs):**
   * **Existencias totales:** Número de unidades físicas disponibles en tienda.
   * **Alertas de stock:** Artículos agotados o por debajo del mínimo.
   * **Valor del almacén:** Capital total invertido en inventario (Unidades × Costo).
2. **Gráfico de flujo de 30 días:** Muestra la evolución diaria de salidas y ventas del mes.
3. **Existencias que requieren atención:** Lista prioritaria con productos en rojo (Agotado) o naranja (Bajo mínimo).
4. **Panel de Cobranzas Activas:** Cuotas de crédito próximas a vencer o con días de mora, con botón directo de cobro.

---

## 5. Módulo de Ventas y Facturación (Punto de Venta)

El módulo de **Ventas** está optimizado para emitir comprobantes en segundos.

### Paso a Paso para Cobrar una Venta:
1. **Seleccionar o crear cliente:** Búscalo por nombre o cédula/RIF. Si es nuevo, pulsa `+ Nuevo`.
2. **Agregar productos:** Escanea con lector de código de barras o escribe el nombre. Ajusta la cantidad deseada.
3. **Modalidad de Impuesto (IVA):**
   * Soporta productos gravados con 16% y productos **Exentos** de IVA.
   * Interruptor *"El precio ya incluye IVA"*: útil cuando los precios de vitrina ya tienen el impuesto sumado.
4. **Ingresar las Formas de Pago (Pagos Mixtos):**
   * **Tarjeta de Débito:** Ingresa el monto y los últimos dígitos del lote del punto de venta.
   * **Efectivo en Bolívares:** Calcula el vuelto en vivo al ingresar lo que entrega el cliente.
   * **Efectivo en Dólares (USD) o Euros (EUR):** Registra los billetes en divisas y calcula el vuelto en Bs.
   * **Pago Móvil:** Registra banco emisor y número de referencia.
   * **Transferencia Bancaria:** Permite adjuntar comprobantes bancarios.
   * **Retenciones IVA/ISLR:** Aplica los comprobantes de retención para Contribuyentes Especiales.
   * **Crédito:** Fracciona el pago en cuotas financiadas.
5. **Emitir y Confirmar:** El sistema revisa que el stock esté disponible, lo descuenta del almacén y genera el ticket.

### Impresión de Tickets y Compartir Comprobantes:
* **Formatos de impresión:** Compatible con impresoras térmicas de 58 mm, 80 mm o página completa tamaño carta.
* **Código QR fiscal:** Permite a los clientes escanear el ticket con su celular para verificar los detalles.
* **WhatsApp Directo:** Al pulsar `Compartir`, se abre el chat del cliente (con su número internacionalizado) con el desglose listo.

### Anulación de Comprobantes (Solo Administradores):
Si una venta tuvo un error o el cliente devolvió la mercancía:
1. Abre el comprobante y pulsa **"Anular venta"**.
2. Selecciona el motivo de anulación.
3. Escribe el número del comprobante para confirmar.
4. **Resultado:** La mercancía regresa de inmediato al inventario, la venta se excluye de la facturación y se anulan las deudas asociadas.

---

## 6. Ventas a Crédito y Gestión de Cobranzas

BaratoPrimo protege el capital de tu negocio contra la inflación al financiar ventas:

* **Cuotas fijadas en Dólares (USD):** El saldo restante se divide en cuotas fijadas en divisa para no perder poder adquisitivo.
* **Frecuencias de cobro:** Semanal, quincenal o mensual.
* **Recargo por financiamiento (%):** Porcentaje opcional que se suma a las cuotas sin alterar el precio de lista de la mercancía.
* **Cobro a tasa del día:** Al momento del pago, el cliente puede cancelar en bolívares (por pago móvil o débito) o en efectivo según la tasa oficial de ese día.
* **Adelanto inteligente de cuotas:** Si el cliente cancela un monto mayor al mínimo, el sobrante amortiza y liquida las cuotas futuras automáticamente.

---

## 7. Cartera de Clientes y Búsqueda por Documento (RIF / Cédula)

Mantén tu base de clientes organizada y localiza rápidamente su información fiscal y de contacto al momento de vender o registrar:

* **Prefijos de documento:** `V-` (Cédula venezolana), `E-` (Extranjero), `J-` (Jurídico/Empresa), `G-` (Gubernamental), `P-` (Pasaporte).
* **Búsqueda ágil de clientes ("🔍 BUSCAR"):** Al escribir el prefijo y número de cédula o RIF y presionar el botón **"🔍 BUSCAR"**, el sistema verifica si el cliente ya existe en el sistema o padrón comercial y rellena de inmediato:
  * Nombres, apellidos o Razón Social registrada.
  * Número de teléfono de contacto y dirección fiscal.
* **Registro de clientes nuevos:** Si el documento no arroja resultados por ser un cliente nuevo, completa los campos en el formulario y pulsa **Guardar** para incorporarlo permanentemente a tu cartera.
* **Configuración de Agente de Retención:** Si el cliente es una empresa o Sujeto Pasivo Especial que aplica retenciones, activa la casilla *Agente de Retención* y selecciona el porcentaje correspondiente (**75%** o **100%**) para que sus facturas apliquen el descuento tributario exacto.
* **Ficha de cliente:** Consulta el historial completo de compras, estados de cuenta y saldo pendiente.

---

## 8. Catálogo de Productos e Inventario

* **Registro de artículos:** Código SKU/Barras, nombre, categoría, unidad de medida y fotografía.
* **Margen de beneficio comercial:** Al colocar el costo de compra y el precio de venta, el sistema te muestra tu ganancia real en porcentaje (%).
* **Stock Mínimo de Seguridad:** Define el umbral para que el sistema te avise antes de quedarte sin mercancía.
* **Días de Cobertura:** Calcula para cuántos días te alcanza el inventario actual basándose en la velocidad de venta de las últimas 4 semanas.

---

## 9. Movimientos de Almacén y Kardex Inmutable

El inventario de BaratoPrimo nunca se modifica a ciegas. Todo ajuste queda registrado con su responsable.

### Tipos de Movimientos:
1. **Entrada:** Compras a proveedores, reposiciones o devoluciones de clientes.
2. **Salida:** Ventas de mostrador, mermas o productos dañados justificados.
3. **Ajuste:** Corrección tras realizar conteos físicos de almacén.

* **Bloqueo estricto de stock negativo:** Es imposible vender mercancía que el sistema tenga en 0, evitando descuadres en almacén.
* **Kardex:** Detalle cronológico unidad a unidad con saldo acumulado.
* **Exportar a Excel:** Todos los movimientos se pueden descargar en formato `.CSV` compatible con Excel en español.

---

## 10. Gráficas y Análisis del Rendimiento Comercial

Evalúa la marcha de tu negocio sin necesidad de programas externos:
* **Comparativa de Compras vs Ventas:** Evalúa si la inversión en mercancía está rindiendo los ingresos esperados.
* **Productos Más Vendidos:** Ranking por dinero facturado y por volumen de unidades vendidas.
* **Distribución por Categorías:** Muestra qué departamentos representan la mayor parte de tu inventario.
* **Capital Inmovilizado ("Hueso"):** Lista de artículos sin rotación en el último mes para planificar ofertas y recuperar liquidez.

---

## 11. Cuadre de Caja y Arqueo al Cierre de Turno

Al finalizar el turno de caja o la jornada:
1. Ingresa a **Cuadre de caja**.
2. Selecciona el periodo (**Hoy**, **Ayer**, **Semana**, **Mes** o rango libre).
3. **Filtro por vendedor:** El administrador puede auditar a cada cajero de forma individual o ver la caja global de la tienda.
4. **Conciliación de dinero:**
   * **Billetes en gaveta:** Total de Bolívares en efectivo, Dólares en efectivo y Euros en efectivo.
   * **Bancos:** Total en Pago Móvil, puntos de venta (Débito) y Transferencias.
   * **Papeles fiscales:** Comprobantes de retención IVA/ISLR recibidos y créditos otorgados.
5. **Auditoría de Anulaciones:** Revisa qué ventas fueron anuladas durante el turno y por qué motivo.

---

## 12. Configuración de Mi Comercio y Personal

* **Datos de cabecera:** Razón social, RIF, dirección física, teléfono y logotipo de la empresa impreso en cada comprobante.
* **Mensaje de cierre:** Frase personalizada de cortesía al pie del ticket (ej: *"Gracias por preferirnos. Revise su mercancía antes de salir"*).
* **Gestión de Operadores:** Creación de usuarios, asignación de contraseñas, activación y cambio de roles.

---

## 13. Preguntas Frecuentes y Buenas Prácticas

### ¿Qué hago si se va el internet en la tienda?
BaratoPrimo no se cierra; la pantalla permanece disponible y muestra un aviso superior. Por seguridad fiscal y contable, las ventas nuevas se confirman una vez regrese la conexión para evitar colisiones de stock y correlativos.

### ¿Puedo usar pistolas de códigos de barra?
Sí. Cualquier lector USB o Bluetooth funciona de manera automática sin configurar nada.

### ¿Cómo cambio entre modo claro y oscuro?
En la esquina inferior del menú lateral tienes el interruptor de tema (Sol / Luna). Se guardará en tu navegador.

---
*BaratoPrimo — Sistema de Gestión Comercial e Inventario.*
