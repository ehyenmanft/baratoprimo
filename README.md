# BaratoPrimo

<p align="center">
  <img src="img/logo.svg" width="96" height="96" alt="BaratoPrimo">
</p>

Gestión de inventario y facturación para comercios. HTML, CSS y JavaScript
puros: sin compilación, sin `node_modules`, sin paso de build. Se sube por FTP
y funciona.

## Qué hace

- **Inventario** con kardex de movimientos: el stock se deriva de las entradas
  y salidas, nunca se edita a mano.
- **Facturación** con IVA desglosado por renglón, siete formas de pago —incluido
  crédito con cuotas en dólares— y comprobantes con QR.
- **Impresión en formato ticket** de 58 mm, 80 mm o página completa.
- **Multi-comercio**: varios comercios en la misma instalación, con sus datos
  completamente separados.
- **Roles**: super administrador, administrador, operador de inventario,
  facturador y mixto.
- **Gráficas** de flujo, ventas, rotación y capital detenido.

## Cómo probarlo

Abre `index.html` con doble clic. Arranca en modo demo con cuatro meses de
actividad generada y no necesita servidor ni base de datos.

## Como aplicación de Android

Es una PWA instalable: desde el navegador se añade a la pantalla de inicio y se
abre a pantalla completa. Para tener además un APK, se envuelve la misma web en
una Trusted Web Activity — la carcasa no lleva copia del código, así que al
actualizar la web se actualiza la aplicación instalada. Está en
[APK-ANDROID.md](APK-ANDROID.md).

## Cómo ponerlo en producción

Lee [PUESTA-EN-MARCHA.md](PUESTA-EN-MARCHA.md): ocho pasos, del editor SQL de
Supabase hasta la primera factura. El esquema completo está en
`baratoprimo_schema.sql`.

Una vez publicado, `verificar.html` comprueba la instalación y dice qué falta.

## Estructura

```
index.html                 Aplicación
verificar.html             Comprobación de la instalación
baratoprimo_schema.sql     Esquema completo de PostgreSQL
css/app.css                Sistema visual
manifest.webmanifest       Datos de la aplicación instalable
sw.js                      Service worker: guarda el armazón, nunca los datos
img/logo.svg               Marca y su juego de iconos
js/config.js               Credenciales y modo de funcionamiento
js/db.js                   Capa de datos (demo, Drive o Supabase)
js/datos-demo.js           Adaptador local con datos de ejemplo
js/permisos.js             Roles y permisos
js/qr.js                   Generador de códigos QR propio
js/graficos.js             Gráficas SVG sin librerías
js/views/                  Una vista por pantalla
supabase/functions/        Función opcional para administrar contraseñas
```

## Sobre las llaves

`js/config.js` lleva la URL del proyecto y la llave `anon` de Supabase. Esa
llave es pública por diseño: viaja al navegador de cualquiera que abra la
página, y lo que protege los datos son las políticas RLS del esquema.

La llave `service_role` **nunca** debe aparecer en este repositorio ni en
ningún archivo que se suba al servidor: esa sí salta todas las políticas.

## Documentación

- [LEEME.md](LEEME.md) — cómo funciona cada parte y por qué
- [FUNCION-CUENTAS.md](FUNCION-CUENTAS.md) — contraseñas de los operadores
- [PUESTA-EN-MARCHA.md](PUESTA-EN-MARCHA.md) — instalación paso a paso
