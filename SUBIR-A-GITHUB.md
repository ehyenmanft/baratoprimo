# Publicar los cambios en GitHub

El repositorio es https://github.com/ehyenmanft/baratoprimo y el sitio sale en
https://ehyenmanft.github.io/baratoprimo/

## Opción A — arrastrando archivos (sin instalar nada)

1. Descomprime `baratoprimo.zip`
2. Entra en el repositorio → **Add file → Upload files**
3. Arrastra **todo el contenido** de la carpeta, incluidas las subcarpetas
4. Escribe un mensaje de commit y confirma

Dos avisos sobre esta vía:

- La interfaz web de GitHub **no sube carpetas ocultas** al arrastrar. Los
  archivos `.nojekyll`, `.gitignore` y la carpeta `.well-known` hay que crearlos
  a mano con **Add file → Create new file**, escribiendo la ruta completa en el
  nombre (por ejemplo `.well-known/assetlinks.json`).
- Subir no borra lo que ya no existe. Si alguna vez eliminas un archivo del
  proyecto, hay que borrarlo también desde la interfaz.

## Opción B — con git (recomendada)

```bash
git clone https://github.com/ehyenmanft/baratoprimo.git
cd baratoprimo

# Copia aquí todo el contenido del zip, sobrescribiendo

git add -A
git commit -m "PWA instalable, contraseñas de operador, cajas y sincronización"
git push
```

Git sí sube los archivos ocultos y detecta los borrados.

## Después de subir

GitHub Pages tarda entre uno y dos minutos en publicar. Comprueba:

1. `https://ehyenmanft.github.io/baratoprimo/` — que abra la aplicación
2. `https://ehyenmanft.github.io/baratoprimo/manifest.webmanifest` — que
   devuelva el JSON y no un 404
3. `https://ehyenmanft.github.io/baratoprimo/sw.js` — igual
4. `https://ehyenmanft.github.io/baratoprimo/verificar.html` — la comprobación
   de la instalación de Supabase

Si el navegador sigue mostrando la versión vieja, es la caché del service
worker: DevTools → Application → Service Workers → *Unregister*, y recarga.

## Sobre `.nojekyll`

GitHub Pages pasa todo por Jekyll, que **ignora los archivos y carpetas que
empiezan por punto**. Sin ese archivo vacío en la raíz, `.well-known/` no se
publicaría, y ahí es donde va la verificación de dominio que necesita el APK
para abrirse sin la barra del navegador.
