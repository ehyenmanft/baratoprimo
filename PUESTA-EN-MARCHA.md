# BaratoPrimo — puesta en marcha con Supabase

Ocho pasos. Los cuatro primeros son en el panel de Supabase; los otros, en tu
hosting. Calcula veinte minutos.

El proyecto ya viene configurado en `js/config.js` con tu URL y tu llave anon,
en modo `supabase`.

---

## 1. Ejecutar el esquema

Panel de Supabase → **SQL Editor** → New query. Pega el contenido completo de
`inventario_schema.sql` y pulsa Run.

Crea once tablas, seis vistas, las funciones de negocio, las políticas de
seguridad por rol y comercio, y el bucket de imágenes. Al final verás avisos como
`Bucket de imágenes listo` y `Permisos concedidos al rol authenticated`: son
normales.

El archivo está pensado para correr de una sola vez sobre un proyecto nuevo. Si
lo ejecutas dos veces dará errores de "ya existe"; en ese caso, o borras las
tablas antes, o ejecutas solo la parte que falte.

**Los datos de prueba vienen desactivados.** La base arranca vacía: sin
productos, sin clientes, sin ventas. Si quieres cargar algo de ejemplo para
practicar, en la sección 6 del archivo hay dos `insert` comentados.

---

## 2. Crear tu usuario

Panel → **Authentication** → Users → Add user → Create new user.

Pon tu correo y una contraseña, y **marca "Auto Confirm User"**. Si no lo marcas,
Supabase enviará un correo de confirmación y no podrás entrar hasta abrirlo.

---

## 3. Crear el primer comercio y registrarte como super administrador

Este paso es el que más se olvida y deja a todo el mundo fuera. El usuario de
Authentication sirve para entrar; el registro en `operadores` es el que da
permisos, y el comercio asignado es el que decide qué datos ves. Sin las dos
cosas, entras pero no puedes hacer nada.

SQL Editor → New query, con **el mismo correo** del paso anterior:

```sql
insert into comercios (nombre, rif) values ('Mi Comercio', 'J-00000000-0');

insert into operadores (correo, nombre, rol, comercio_id)
values ('tu@correo.com', 'Tu nombre', 'super_admin',
        (select id from comercios order by id limit 1));
```

**Ejecútalo una sola vez.** Si lo repites tendrás dos comercios idénticos, que
en el selector son indistinguibles; en ese caso renombra uno o elimínalo desde
**Comercios**.

Si prefieres no crear el comercio desde SQL, puedes registrarte como
`administrador` sin `comercio_id` y crearlo desde la propia aplicación: al
entrar te recibe el formulario y el comercio queda asignado a tu cuenta. El
`super_admin` sí conviene crearlo con este `insert`, porque es quien reparte los
comercios entre los demás.

El `comercio_id` del super administrador es solo el comercio en el que entra
situado: no pertenece a él y puede salirse con la opción *Ninguno · solo
supervisión*.

Este es el único operador que se crea a mano. El resto —incluidos otros
comercios y otros super administradores— los das de alta desde la aplicación.

---

## 4. Revisar el bucket de imágenes

Panel → **Storage**. Debe existir un bucket llamado `inventario`, marcado como
público. Lo crea el esquema; si no aparece, créalo a mano con ese nombre exacto
y la casilla "Public bucket" activada.

---

## 5. Subir la aplicación

Sube por FTP a la carpeta pública de tu hosting —`wwwroot`, `httpdocs` o como se
llame en Smartape— todo el contenido de la carpeta:

```
index.html
verificar.html
css/app.css
js/…            (todos los archivos y la subcarpeta views)
```

No subas `inventario_schema.sql` ni este archivo: no hacen falta en el servidor
y es mejor que no queden accesibles.

**Tiene que servirse por https.** Supabase no autoriza peticiones desde
`file://`, así que abrir el `index.html` con doble clic no funcionará en modo
producción: la aplicación detecta que es un archivo local y se cae al modo demo.

---

## 6. Verificar

Abre `https://tu-dominio/verificar.html`, escribe tu correo y contraseña, y pulsa
el botón. Comprueba, en este orden:

1. Que la configuración esté cargada y en modo supabase
2. Que el proyecto responda con tu llave
3. Que la sesión abra
4. Que las once tablas y las cinco vistas existan
5. Que tu correo tenga rol de administrador
6. Que el comercio esté configurado
7. Que el bucket de imágenes responda

Todo en verde significa que puedes abrir la aplicación. Cada fallo dice qué
hacer, y varios traen el `insert` listo para copiar.

---

## 7. Configurar el comercio

Entra en `https://tu-dominio/index.html` con tu correo y contraseña, y ve a
**Administración → Mi comercio**. Pon la razón social, el RIF, la dirección, el
teléfono, el IVA que aplicas, las tasas de cambio del día y el ancho de tu
impresora (58 mm, 80 mm o página completa).

Eso es lo que encabezará cada factura y cada ticket. Hasta que lo cambies, los
comprobantes saldrán a nombre de "Mi Comercio".

---

## 8. Cargar el inventario

En **Productos → Cargar producto**. Al crear cada uno puedes indicar su
existencia inicial, que entra como movimiento de entrada para que el kardex
cuadre desde el primer día.

Con eso ya puedes facturar.

---

## Después: comercios y operadores

**Varios comercios.** En **Administración → Comercios** creas los que hagan
falta. Cada uno es una instalación aparte: su catálogo, su inventario, su
cartera de clientes y su numeración de facturas. Dos comercios pueden usar el
mismo código de producto o tener al mismo cliente sin estorbarse, y cada uno
empieza en F-000001. Como super administrador cambias de uno a otro con
**Trabajar aquí**, o desde el selector del menú.

**Operadores.** En **Administración → Operadores** das de alta al equipo. Para
cada uno hay que elegir su rol y su comercio; solo verá ese. El proceso tiene
dos partes, igual que contigo:

1. Registrarlo en la aplicación (Operadores → Nuevo operador)
2. Crearle el usuario en Supabase → Authentication → Users, con el mismo correo

Al nombrar otro **super administrador**, el comercio es opcional: no pertenece a
ninguno, los supervisa todos. Si le eliges uno, solo decide dónde entra situado
la primera vez.

**La jerarquía no se rompe hacia arriba.** Un administrador manda dentro de su
comercio, pero no ve ni puede modificar la ficha de un super administrador, ni
nombrar a otro, ni crear comercios. Eso está en las políticas de la base, no
solo en la interfaz.

---

## Si algo falla

**"permission denied for table…"** — El esquema no terminó de ejecutarse.
Vuelve a correr la sección 19 (permisos de tabla).

**Entras pero no ves nada y dice "tu cuenta todavía no tiene permisos"** — Falta
el paso 3: registrarte en `operadores` con el mismo correo del usuario de
Authentication.

**Entras, pero todas las pantallas están vacías** — Tu operador no tiene
comercio asignado. Según tu rol, la aplicación reacciona distinto:

- **Administrador**: te recibe el formulario para crear tu comercio, que queda
  asignado a tu cuenta al guardarlo. No hace falta tocar SQL.
- **Super administrador**: te lleva a *Comercios* para que elijas en cuál
  situarte. No perteneces a ninguno, los supervisas todos.
- **Resto de roles**: se te avisa de que no tienes comercio; solo un
  administrador puede asignártelo desde *Operadores*.

**"Tu operador no tiene un comercio asignado"** — Tu cuenta existe y tu rol se
reconoce, pero no cuelga de ningún comercio, así que la base no devuelve datos
en ninguna pantalla. Pasa cuando se registra el operador antes de crear el
comercio. La propia aplicación te lleva a *Mi comercio* y te da el SQL con tu
correo ya puesto; en resumen:

```sql
insert into comercios (nombre, rif) values ('Mi Comercio', 'J-00000000-0');

update operadores
   set comercio_id = (select id from comercios order by id limit 1)
 where correo = 'tu@correo.com';
```

Después vuelve a entrar, para que la sesión tome el comercio.

**"Cannot coerce the result to a single JSON object"** — Es el mismo problema
visto desde PostgREST: una consulta que esperaba una fila recibió cero. Aplica el
arreglo de arriba.

**"No fue posible iniciar sesión. Comuníquese con el administrador."** — Es el
mensaje que ve cualquiera que se equivoque de contraseña: no dice si falló el
correo o la clave, a propósito. Del lado del panel, revisa que el usuario exista
en Authentication y esté confirmado.

**Las imágenes no cargan** — El bucket `inventario` no es público. Panel →
Storage → inventario → Settings → Public bucket.

**La aplicación arranca en modo demo** — Estás abriendo el archivo local en vez
de la dirección https, o `MODO` en `js/config.js` no dice `'supabase'`.

**Nada responde y la consola habla de CORS** — Comprueba que la URL de
`config.js` sea la del proyecto (`https://…supabase.co`) y no la del endpoint
REST (`…/rest/v1/`). El cliente arma esa ruta solo.

---

## Sobre las llaves

La llave anon viaja al navegador de cualquiera que abra la página: es pública
por diseño y no es una filtración. Lo que protege los datos son las políticas
RLS del esquema, que deciden qué puede hacer cada rol.

La que **nunca** debe salir del panel de Supabase es la `service_role`: esa sí
salta todas las políticas. No la pongas en `config.js` ni en ningún archivo que
subas al servidor.

Si en algún momento quieres rotar la llave anon, se hace desde Settings → API y
solo hay que actualizar `js/config.js`.
