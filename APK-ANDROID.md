# BaratoPrimo como aplicación de Android

La aplicación ya es una **PWA**: se instala desde el navegador, tiene su icono,
se abre a pantalla completa y arranca al instante. Para tener además un **APK**
que se instale como cualquier otra aplicación, se envuelve esa misma web en una
*Trusted Web Activity* (TWA).

Lo importante de este camino: **el APK no lleva copia del código**. Es una
carcasa de unos 800 KB que abre tu sitio a pantalla completa. Todo —pantallas,
datos, sesiones— sigue viniendo del servidor, así que **cuando actualices la web
se actualiza la aplicación instalada**, sin publicar una versión nueva ni pedirle
a nadie que reinstale nada.

---

## Antes de empezar: tres requisitos

1. **Servida por https.** GitHub Pages ya lo cumple.
2. **Manifiesto e iconos.** Ya están: `manifest.webmanifest`, `sw.js` y los
   iconos de 192 y 512 px, incluidos los *maskable*.
3. **Un dominio cuyo `/.well-known/` puedas controlar.** Es lo único que puede
   darte guerra; está explicado más abajo.

Comprueba primero que el navegador la reconoce: abre la web en Chrome de
escritorio, entra en DevTools → Application → Manifest. Si dice *Installable*,
todo lo demás va a funcionar.

---

## Camino corto: PWABuilder

Sin instalar nada.

1. Entra en **https://www.pwabuilder.com**
2. Pega la dirección de tu aplicación
3. Pulsa **Package for stores → Android**
4. En las opciones marca:
   - *Package ID*: `com.baratoprimo.app`
   - *App name*: BaratoPrimo
   - *Display mode*: Standalone
   - **Signing key: New** — descarga el `.zip` y **guarda bien
     `signing-key.keystore` y sus contraseñas**. Sin ese archivo no podrás
     publicar actualizaciones firmadas de la misma aplicación nunca más.
5. Descarga el paquete. Dentro vienen el `.apk` para instalar directamente y el
   `.aab` para Google Play, más un `assetlinks.json` ya rellenado.

---

## Camino largo: Bubblewrap

Si prefieres hacerlo en tu máquina y controlar cada detalle. Necesitas Node y
un JDK.

```bash
npm install -g @bubblewrap/cli

bubblewrap init --manifest https://ehyenmanft.github.io/baratoprimo/manifest.webmanifest
# Preguntará el package id, el nombre, los colores y creará la clave de firma

bubblewrap build
# Genera app-release-signed.apk y app-release-bundle.aab
```

Para saber la huella de tu certificado, que hace falta en el paso siguiente:

```bash
keytool -list -v -keystore android.keystore -alias android
```

Copia la línea **SHA256**.

---

## El paso que todo el mundo se salta

Android exige demostrar que el APK y el sitio web son de la misma persona. Si no
lo haces, la aplicación se instala y funciona, pero **aparece con la barra de
direcciones del navegador arriba**, y deja de parecer una aplicación.

La prueba es un archivo que debe responder en:

```
https://TU-DOMINIO/.well-known/assetlinks.json
```

En este repositorio hay una plantilla en `.well-known/assetlinks.json`. Solo
tienes que sustituir la huella por la de tu certificado.

**Con GitHub Pages hay un detalle.** El archivo tiene que estar en la raíz del
dominio, no dentro del proyecto:

- Sirve: `https://ehyenmanft.github.io/.well-known/assetlinks.json`
- No sirve: `https://ehyenmanft.github.io/baratoprimo/.well-known/assetlinks.json`

Esa raíz pertenece a tu *sitio de usuario*, que es un repositorio aparte llamado
exactamente `ehyenmanft.github.io`. Si no lo tienes, créalo y pon ahí la carpeta
`.well-known`.

**Si publicas en tu propio dominio** —el de Smartape, por ejemplo— es más
sencillo: subes la carpeta `.well-known` junto al resto y ya está. Es la opción
que recomiendo si vas a repartir el APK.

Para comprobar que quedó bien:

```
https://developers.google.com/digital-asset-links/tools/generator
```

---

## Instalar el APK sin pasar por Google Play

Perfectamente válido para uso interno: pásalo por WhatsApp, correo o un enlace
de descarga. En el teléfono hay que permitir *Instalar aplicaciones desconocidas*
para la aplicación desde la que se abra el archivo.

Si vas a publicarlo en Play, necesitas el `.aab`, una cuenta de desarrollador
(pago único de 25 dólares) y la ficha de la tienda.

---

## Qué pasa sin conexión

El service worker guarda el armazón —el HTML, los estilos, el código y los
iconos— pero **nunca los datos**. Con la aplicación en modo Supabase eso
significa:

- Sin red, la aplicación **abre** y muestra su interfaz.
- Aparece una franja roja: *Sin conexión: los datos que veas pueden estar
  desactualizados y no podrás guardar.*
- En cuanto vuelve la red, la franja desaparece sola.

Esto es deliberado. Un inventario servido desde la caché es un inventario
equivocado, y una venta guardada en el teléfono que nunca llegó al servidor es
peor que una venta no registrada.

---

## Al actualizar la web

Cuando cambies cualquier archivo, **sube el número de `VERSION` en `sw.js`**:

```js
const VERSION = 'baratoprimo-v2';
```

Es lo que hace que los dispositivos ya instalados se enteren. Sin eso pueden
seguir sirviendo la versión guardada durante días. Al detectar una versión nueva,
la aplicación muestra un aviso con un botón *Actualizar* en vez de recargar por
su cuenta: alguien podría estar a media venta.

---

## ¿Y iOS?

Apple no admite TWA. En iPhone la vía es la propia PWA: abrir la web en Safari,
tocar Compartir → *Añadir a pantalla de inicio*. Queda con su icono y se abre a
pantalla completa. Las etiquetas necesarias ya están en `index.html`.
